'use strict';
const api = acquireVsCodeApi();
const stage = document.querySelector('#stage');
const layers = document.querySelector('#layers');
const svg = document.querySelector('#wires');
let edges = [];
function element(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text || '';
  return el;
}
function button(className, text, action, id, title) {
  const b = element('button', className, text);
  b.dataset.id = id;
  b.dataset.action = action;
  b.title = title;
  return b;
}
stage.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b) return;
  const action = b.dataset.action === 'expand' && (event.ctrlKey || event.metaKey) ? 'declare' : b.dataset.action;
  api.postMessage({ action, id: Number(b.dataset.id) });
});
function draw() {
  svg.replaceChildren();
  const box = stage.getBoundingClientRect();
  svg.setAttribute('width', box.width);
  svg.setAttribute('height', box.height);
  for (const edge of edges) {
    const a = document.getElementById('n' + edge.from).getBoundingClientRect();
    const b = document.getElementById('e' + edge.id).getBoundingClientRect();
    const forward = a.right < b.left;
    const loop = Math.abs(a.left - b.left) < 5;
    const x = (forward || loop ? a.right : a.left) - box.left;
    const y = a.top + a.height / 2 - box.top;
    const tx = (forward ? b.left : b.right) - box.left;
    const ty = b.top + b.height / 2 - box.top;
    const bend = forward || loop ? 27 : -27;
    const endBend = forward ? -27 : 27;
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', `M${x} ${y} C${x+bend} ${y},${tx+endBend} ${ty},${tx} ${ty} m${forward?-5:5} -3 l${forward?5:-5} 3 l${forward?-5:5} 3`);
    path.setAttribute('class', edge.kind.startsWith('控制') ? 'control' : 'data');
    svg.append(path);
  }
}
window.addEventListener('message', ({data}) => {
  const {nodes} = data;
  edges = data.edges;
  document.querySelector('h1').textContent = nodes[0].name;
  const focus = document.activeElement.dataset;
  layers.replaceChildren();
  const groups = new Map();
  for (const n of nodes) {
    if (!groups.has(n.layer)) groups.set(n.layer, element('section', 'layer'));
    const card = element('article', n.id === 0 ? 'origin' : '');
    const node = button('node', n.name, 'expand', n.id, n.scope + '.' + n.name);
    node.id = 'n' + n.id;
    node.dataset.expanded = String(n.expanded);
    node.prepend(element('small', 'scope', n.scope));
    card.append(node);
    for (const edge of edges.filter(e => e.to === n.id)) {
      const row = element('div', 'relation');
      row.id = 'e' + edge.id;
      const label = button('edge', edge.kind + ' · L' + edge.line, 'edge', edge.id, edge.detail);
      label.dataset.from = nodes[edge.from].name;
      label.prepend(element('small', 'edge-source', nodes[edge.from].name));
      row.append(label);
      if (edge.hasGuard) row.append(button('guard', '条件', 'guard', edge.id, edge.detail));
      card.append(row);
    }
    groups.get(n.layer).append(card);
  }
  for (const key of [...groups.keys()].sort((a,b)=>a-b)) layers.append(groups.get(key));
  if (focus.action && focus.id) {
    layers.querySelector(`[data-action="${focus.action}"][data-id="${focus.id}"]`)?.focus({preventScroll:true});
  }
  draw();
});
new ResizeObserver(draw).observe(layers);
api.postMessage({action:'ready'});
