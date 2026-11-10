const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const { createGraph } = require('./graph');

function showGraph(context, editor, file, hit, links) {
  const graph = createGraph(file, hit, links);
  const column = editor.viewColumn;
  const assets = vscode.Uri.joinPath(context.extensionUri, 'webview');
  const panel = vscode.window.createWebviewPanel('verilogSignalGraph', '关系图 · ' + graph.nodes[0].name,
    vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [assets] });
  const view = panel.webview;
  const nonce = randomBytes(18).toString('base64');
  let revision = 0;
  const asset = name => view.asWebviewUri(vscode.Uri.joinPath(assets, name));
  function render() {
    return view.postMessage({
      revision, canUndo: graph.canUndo,
      nodes: graph.nodes.map(({ id, name, scope, layer, expanded }) => ({ id, name, scope, layer, expanded })),
      edges: graph.edges.map(({ id, from, to, kind, line, detail, guard }) =>
        ({ id, from, to, kind, line, detail, hasGuard: Boolean(guard) }))
    });
  }
  async function documentFor(file) {
    const doc = await vscode.workspace.openTextDocument(file.uri);
    if (doc.getText() === file.index.source) return doc;
    void vscode.window.showWarningMessage('RTL 已修改，请从源码重新绘制关系图。');
  }
  async function jump(file, start, end) {
    const doc = await documentFor(file);
    if (doc) await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false,
      selection: new vscode.Range(doc.positionAt(start), doc.positionAt(end)) });
  }
  const subscription = view.onDidReceiveMessage(async msg => {
    try {
      if (msg?.action === 'ready') return await render();
      if (msg?.revision !== revision) return await render();
      if (msg.action === 'undo') {
        if (graph.canUndo) { graph.undo(); revision++; }
        return await render();
      }
      if (!Number.isSafeInteger(msg?.id) || msg.id < 0) return;
      if (msg.action === 'expand' || msg.action === 'declare') {
        const n = graph.nodes[msg.id];
        if (!n) return;
        if (msg.action === 'declare') return await jump(n.file, n.hit.declaration.offset, n.hit.declaration.offset + n.name.length);
        if (await documentFor(n.file) && msg.revision === revision && !n.expanded) {
          graph.expand(n.id);
          revision++;
          await render();
        }
      } else if (msg.action === 'edge' || msg.action === 'guard') {
        const e = graph.edges[msg.id];
        const token = msg.action === 'edge' ? e?.token : e?.guard;
        if (token) await jump(e.owner, token.start, token.end);
      }
    } catch (error) {
      void vscode.window.showWarningMessage('关系图操作失败。' + error.message);
    }
  });
  panel.onDidDispose(() => subscription.dispose());
  view.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${view.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${asset('graph.css')}"></head>
<body><header><h1></h1><span>单击展开 · Ctrl+单击查看声明 · 点击关系跳转</span></header>
<nav aria-label="关系图操作"><button id="undo" disabled>撤销展开</button><button id="clear" hidden>清除聚焦</button><span id="pair" role="status"></span></nav>
<main><div id="stage"><svg id="wires" aria-hidden="true"></svg><div id="layers"></div></div></main>
<script nonce="${nonce}" src="${asset('graph.js')}"></script></body></html>`;
}

module.exports = { showGraph };
