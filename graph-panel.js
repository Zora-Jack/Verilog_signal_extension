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
  let focused;
  const asset = name => view.asWebviewUri(vscode.Uri.joinPath(assets, name));
  function render() {
    const model = focused || graph;
    return view.postMessage({
      revision, focused: Boolean(focused), canUndo: graph.canUndo,
      nodes: model.nodes.map(({ id, name, scope, layer, expanded }) => ({ id, name, scope, layer, expanded })),
      edges: model.edges.map(({ id, from, to, kind, line, detail, guard }) =>
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
      if (msg.action === 'clear') {
        focused = undefined;
        revision++;
        return await render();
      }
      if (msg.action === 'choices') {
        return await view.postMessage({ choices: [...graph.candidates().values()].map(n => ({
          key: n.key, text: n.scope + '.' + n.name
        })), origin: graph.nodes[0].key, revision });
      }
      if (msg.action === 'pair' || msg.action === 'selectPair') {
        let a, b;
        if (msg.action === 'selectPair') {
          const choices = graph.candidates();
          a = choices.get(msg.first);
          b = choices.get(msg.second);
        } else {
          const e = graph.edges[msg.id];
          if (focused || !e) return;
          a = graph.nodes[e.from];
          b = graph.nodes[e.to];
        }
        if (!a || !b || a.key === b.key) return;
        for (const f of new Set([a.file, b.file])) if (!await documentFor(f)) return;
        if (msg.revision !== revision) return;
        focused = graph.focus(a, b);
        revision++;
        return await render();
      }
      if (msg.action === 'undo') {
        if (!focused && graph.canUndo) { graph.undo(); revision++; }
        return await render();
      }
      if (!Number.isSafeInteger(msg?.id) || msg.id < 0) return;
      if (msg.action === 'expand' || msg.action === 'declare') {
        const n = (focused || graph).nodes[msg.id];
        if (!n) return;
        if (msg.action === 'declare') return await jump(n.file, n.hit.declaration.offset, n.hit.declaration.offset + n.name.length);
        if (!focused && await documentFor(n.file) && msg.revision === revision && !n.expanded) {
          graph.expand(n.id);
          revision++;
          await render();
        }
      } else if (msg.action === 'edge' || msg.action === 'guard') {
        const e = (focused || graph).edges[msg.id];
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
<nav aria-label="关系图操作"><button id="undo" disabled>撤销展开</button><button id="choose" disabled>选择信号对</button><button id="clear" hidden>清除聚焦</button><span id="pair" role="status"></span></nav>
<dialog><form method="dialog"><label>信号一 <select id="first"></select></label><label>信号二 <select id="second"></select></label><button value="cancel">取消</button><button id="apply" value="apply">查询直接关系</button></form></dialog>
<main><div id="stage"><svg id="wires" aria-hidden="true"></svg><div id="layers"></div></div></main>
<script nonce="${nonce}" src="${asset('graph.js')}"></script></body></html>`;
}

module.exports = { showGraph };
