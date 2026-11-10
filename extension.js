const vscode = require('vscode');
const { indexDocument, lookup, directRelations } = require('./signals');

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
  context.subscriptions.push(
    vscode.commands.registerCommand('verilog-signal-trace.directRelations', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const version = doc.version;
      const hit = resolve(doc, editor.selection.start);
      if (!hit) {
        void vscode.window.showInformationMessage('请将光标放在当前模块中已声明的信号名上。');
        return;
      }
      const signal = doc.getText(new vscode.Range(doc.positionAt(hit.start), doc.positionAt(hit.end)));
      const relations = directRelations(getIndex(doc), hit);
      if (!relations.length) {
        void vscode.window.showInformationMessage(`${signal} 在支持的赋值中没有直接上下游。`);
        return;
      }
      const items = [];
      for (const direction of ['上游', '下游']) {
        for (const r of relations.filter(r => r.direction === direction)) {
          const range = new vscode.Range(doc.positionAt(r.token.start), doc.positionAt(r.token.end));
          items.push({ label: `${direction}  ${r.token.value}`, description: `${r.edge || "组合"} · 第 ${range.start.line + 1} 行`, detail: r.detail, range });
        }
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: `${hit.module} · ${signal} 的直接上下游`, placeHolder: '选择一项，跳到对应的赋值语句'
      });
      if (!picked) return;
      if (doc.isClosed || doc.version !== version) {
        void vscode.window.showInformationMessage('源码已变化，请重新查看直接上下游。');
        return;
      }
      const target = await vscode.window.showTextDocument(doc, editor.viewColumn);
      target.selection = new vscode.Selection(picked.range.start, picked.range.end);
      target.revealRange(picked.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }),
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
