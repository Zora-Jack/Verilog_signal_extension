const vscode = require('vscode');
const { indexDocument, lookup, directRelations } = require('./signals');

// Keep a single picker open as the editor selection moves from one hop to the next.
function createPathPicker() {
  const picker = vscode.window.createQuickPick();
  let pending;
  let closed = false;
  function finish(value) {
    const resolve = pending;
    pending = undefined;
    if (resolve) resolve(value);
  }
  picker.onDidAccept(() => finish(picker.selectedItems[0]));
  picker.onDidHide(() => { closed = true; finish(); });
  return {
    pick(items, options) {
      if (closed) return Promise.resolve();
      picker.title = options.title;
      picker.placeholder = options.placeHolder;
      picker.value = '';
      picker.items = items;
      picker.activeItems = [items[0]];
      return new Promise(resolve => {
        pending = resolve;
        picker.show();
      });
    },
    dispose() { picker.dispose(); }
  };
}

function activate(context) {
  const cache = new WeakMap();
  function getIndex(doc) {
    let entry = cache.get(doc);
    if (!entry || entry.version !== doc.version) {
      entry = { version: doc.version, index: indexDocument(doc.getText()) };
      cache.set(doc, entry);
    }
    return entry.index;
  }
  function resolve(doc, position) {
    return lookup(getIndex(doc), doc.offsetAt(position));
  }
  const languages = ['verilog', 'systemverilog'];
  async function trace(multi) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    const version = doc.version;
    const index = getIndex(doc);
    const origin = resolve(doc, editor.selection.start);
    if (!origin) {
      void vscode.window.showInformationMessage('请将光标放在当前模块中已声明的信号名上。');
      return;
    }
    const rangeOf = token => new vscode.Range(doc.positionAt(token.start), doc.positionAt(token.end));
    const signalOf = hit => index.source.slice(hit.start, hit.end);
    const path = [{ hit: origin, range: rangeOf(origin) }];
    const roles = { '上游': '上游数据', '下游': '下游数据', '写入条件': '写入条件', '控制来源': '控制来源', '受控写入': '受控写入', '选择条件': '选择条件', '受控选值': '受控选值' };
    const picker = multi && createPathPicker();
    try {
      for (;;) {
        const current = path.at(-1);
        const items = [];
        if (path.length > 1) items.push({ label: '$(arrow-left) 返回上一步', back: true });
        if (!current.cycle) {
          const rows = directRelations(index, current.hit, multi);
          const order = multi ? ['上游', '控制来源', '选择条件', '下游', '受控写入', '受控选值'] : ['上游', '写入条件', '下游'];
          for (const direction of order) {
            for (const r of rows.filter(row => row.direction === direction)) {
              const range = rangeOf(r.token);
              const next = multi && lookup(index, r.token.start);
              const cycle = next && path.some(frame => frame.hit.declaration === next.declaration);
              const line = offset => doc.positionAt(offset).line + 1;
              let detail = r.detail;
              if (r.writeOffset !== undefined) detail = `第 ${line(r.writeOffset)} 行写入 · ${detail}`;
              if (r.guardOffset !== undefined) detail = `第 ${line(r.guardOffset)} 行条件 · ${detail}`;
              items.push({ label: `${roles[direction]}  ${r.token.label || r.token.value}`,
                description: `${r.edge || '组合'} · 第 ${range.start.line + 1} 行${cycle ? ' · 路径中已出现' : ''}`,
                detail, range, next, cycle, role: roles[direction] });
            }
          }
        }
        if (!items.length) {
          void vscode.window.showInformationMessage(`${signalOf(current.hit)} 在支持的赋值中没有直接上下游。`);
          return;
        }
        const trail = path.map(frame => frame.role ? ` —${frame.role}→ ${signalOf(frame.hit)}` : signalOf(frame.hit)).join('');
        const options = {
          title: `${origin.module} · ${trail}`,
          placeHolder: current.cycle ? '已到达路径中的信号，可返回上一步' :
            multi ? '选择关系跳转并继续展开，Esc 结束追踪' : '选择数据或写入条件，跳到源码'
        };
        const picked = multi ? await picker.pick(items, options) : await vscode.window.showQuickPick(items, options);
        if (!picked) return;
        if (doc.isClosed || doc.version !== version) {
          void vscode.window.showInformationMessage('源码已变化，请重新查询。');
          return;
        }
        if (picked.back) path.pop();
        const range = picked.back ? path.at(-1).range : picked.range;
        const target = multi ? editor : await vscode.window.showTextDocument(doc, editor.viewColumn);
        target.selection = new vscode.Selection(range.start, range.end);
        target.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        if (!multi) return;
        if (!picked.back) {
          if (!picked.next) return;
          path.push({ hit: picked.next, range, role: picked.role, cycle: picked.cycle });
        }
      }
    } finally {
      if (picker) picker.dispose();
    }
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('verilog-signal-trace.directRelations', () => trace(false)),
    vscode.commands.registerCommand('verilog-signal-trace.tracePath', () => trace(true)),
    vscode.languages.registerHoverProvider(languages, {
      provideHover(doc, position) {
        const hit = resolve(doc, position);
        if (!hit) return;
        const contents = new vscode.MarkdownString();
        contents.appendCodeblock(hit.declaration.text, 'verilog');
        const line = doc.positionAt(hit.declaration.offset).line + 1;
        contents.appendText(`模块 ${hit.module} · 第 ${line} 行`);
        return new vscode.Hover(contents, new vscode.Range(doc.positionAt(hit.start), doc.positionAt(hit.end)));
      }
    }),
    vscode.languages.registerDefinitionProvider(languages, {
      provideDefinition(doc, position) {
        const hit = resolve(doc, position);
        if (!hit) return;
        const start = hit.declaration.offset;
        return new vscode.Location(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(start + hit.end - hit.start)));
      }
    })
  );
}

module.exports = { activate };
