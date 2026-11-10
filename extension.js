const vscode = require('vscode');
const { indexDocument, lookup } = require('./signals');

function activate(context) {
  const cache = new WeakMap();
  function resolve(doc, position) {
    let entry = cache.get(doc);
    if (!entry || entry.version !== doc.version) {
      entry = { version: doc.version, index: indexDocument(doc.getText()) };
      cache.set(doc, entry);
    }
    return lookup(entry.index, doc.offsetAt(position));
  }
  const languages = ['verilog', 'systemverilog'];
  context.subscriptions.push(
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
