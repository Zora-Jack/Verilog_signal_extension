const vscode = require('vscode');
const { projectLinks, portSteps } = require('./project');
const { indexDocument, lookup, directRelations } = require('./signals');

// Keep a single picker open as the editor selection moves from one hop to the next.
function createPathPicker() {
  const picker = vscode.window.createQuickPick();
  picker.ignoreFocusOut = true;
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
  async function loadProject(doc, origin) {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) return new Map();
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{v,sv,vh,svh}'));
    const open = new Map(vscode.workspace.textDocuments.map(d => [d.uri.toString(), d]));
    const files = [origin];
    for (const uri of uris) {
      if (uri.toString() === doc.uri.toString()) continue;
      const buffer = open.get(uri.toString());
      const index = buffer ? getIndex(buffer) : indexDocument(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8').replace(/^\uFEFF/, ''));
      files.push({ uri, index });
    }
    return projectLinks(files);
  }
  async function trace(multi) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    const column = editor.viewColumn;
    const index = getIndex(doc);
    const origin = resolve(doc, editor.selection.start);
    if (!origin) {
      void vscode.window.showInformationMessage('请将光标放在当前模块中已声明的信号名上。');
      return;
    }
    const file = { uri: doc.uri, index };
    let links = new Map();
    if (multi) {
      try {
        links = await loadProject(doc, file);
      } catch (error) {
        void vscode.window.showWarningMessage('无法建立工作区端口索引，将继续模块内追踪。' + error.message);
      }
    }
    const signalOf = frame => frame.file.index.source.slice(frame.hit.start, frame.hit.end);
    const path = [{ hit: origin, token: origin, file, route: [] }];
    const sameRoute = (a, b) => a.length === b.length && a.every((v, i) => v.site === b[i].site && v.down === b[i].down);
    let currentEditor = editor;
    const roles = { '上游': '上游数据', '下游': '下游数据', '写入条件': '写入条件', '控制来源': '控制来源', '受控写入': '受控写入', '选择条件': '选择条件', '受控选值': '受控选值' };
    const picker = multi && createPathPicker();
    try {
      for (;;) {
        const current = path.at(-1);
        const doc = currentEditor.document;
        if (doc.getText() !== current.file.index.source) {
          void vscode.window.showInformationMessage('源码已变化，请重新查询。');
          return;
        }
        const index = current.file.index;
        const items = [];
        if (path.length > 1) items.push({ label: '$(arrow-left) 返回上一步', back: true });
        if (!current.cycle) {
          const rows = directRelations(index, current.hit, multi);
          const order = multi ? ['上游', '控制来源', '选择条件', '下游', '受控写入', '受控选值'] : ['上游', '写入条件', '下游'];
          for (const direction of order) {
            for (const r of rows.filter(row => row.direction === direction)) {
              const rowLine = doc.positionAt(r.token.start).line + 1;
              const next = multi && lookup(index, r.token.start);
              const cycle = next && path.some(frame => frame.hit.declaration === next.declaration && sameRoute(frame.route, current.route));
              const line = offset => doc.positionAt(offset).line + 1;
              let detail = r.detail;
              if (r.writeOffset !== undefined) detail = `第 ${line(r.writeOffset)} 行写入 · ${detail}`;
              if (r.guardOffset !== undefined) detail = `第 ${line(r.guardOffset)} 行条件 · ${detail}`;
              items.push({ label: `${roles[direction]}  ${r.token.label || r.token.value}`,
                description: `${r.edge || '组合'} · 第 ${rowLine} 行${cycle ? ' · 路径中已出现' : ''}`,
                detail, token: r.token, file: current.file, route: current.route, next, cycle, role: roles[direction] });
            }
          }
          if (multi) {
            for (const step of portSteps(links, current.hit.declaration, current.route)) {
              const next = lookup(step.file.index, step.token.start);
              if (!next) continue;
              const cycle = path.some(f => f.hit.declaration === next.declaration && sameRoute(f.route, step.route));
              const instance = step.site.parent + '.' + step.site.name;
              const role = step.role + ' · ' + instance;
              const bindingLine = step.owner.index.source.slice(0, step.binding.start).split('\n').length;
              items.push({ label: role + ' → ' + next.module + '.' + step.token.value,
                description: step.dir + (cycle ? ' · 路径中已出现' : ''),
                detail: vscode.workspace.asRelativePath(step.owner.uri) + ' · 第 ' + bindingLine + ' 行连接',
                next, file: step.file, token: step.token, route: step.route, role, cycle });
            }
          }
        }
        if (!items.length) {
          void vscode.window.showInformationMessage(`${signalOf(current)} 在支持的赋值中没有直接上下游。`);
          return;
        }
        const trail = path.map(frame => frame.role ? ` —${frame.role}→ ${signalOf(frame)}` : signalOf(frame)).join('');
        const options = {
          title: `${origin.module} · ${trail}`,
          placeHolder: current.cycle ? '已到达路径中的信号，可返回上一步' :
            multi ? '选择关系跳转并继续展开，Esc 结束追踪' : '选择数据或写入条件，跳到源码'
        };
        const picked = multi ? await picker.pick(items, options) : await vscode.window.showQuickPick(items, options);
        if (!picked) return;
        if (doc.isClosed || doc.getText() !== index.source) {
          void vscode.window.showInformationMessage('源码已变化，请重新查询。');
          return;
        }
        if (picked.back) path.pop();
        const frame = picked.back ? path.at(-1) : picked;
        const targetDoc = frame.file === current.file ? doc : await vscode.workspace.openTextDocument(frame.file.uri);
        if (targetDoc.getText() !== frame.file.index.source) {
          void vscode.window.showInformationMessage('目标文件已变化，请重新查询。');
          return;
        }
        if (targetDoc !== doc || !multi) {
          currentEditor = await vscode.window.showTextDocument(targetDoc, { viewColumn: column, preserveFocus: !!multi, preview: false });
        }
        const range = new vscode.Range(targetDoc.positionAt(frame.token.start), targetDoc.positionAt(frame.token.end));
        currentEditor.selection = new vscode.Selection(range.start, range.end);
        currentEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        if (!multi) return;
        if (!picked.back) path.push({ ...picked, hit: picked.next });

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
