const { lookup, directRelations } = require('./signals');
const { portSteps } = require('./project');

const types = {
  '上游': ['数据', true], '下游': ['数据', false],
  '控制来源': ['控制写入', true], '受控写入': ['控制写入', false],
  '选择条件': ['控制选值', true], '受控选值': ['控制选值', false]
};

function createGraph(file, origin, links) {
  const nodes = [], edges = [];
  const history = [];
  const nodeIds = new Map(), edgeIds = new Set();
  function descriptor(file, hit, route, layer) {
    const routeKey = route.map(s => [s.site.parent, s.site.name, s.down]);
    const key = JSON.stringify([String(file.uri), hit.declaration.offset, routeKey]);
    const scope = route.reduce((path, s) => s.down ? path + '.' + s.site.name : s.site.parent, origin.module);
    return { key, file, hit, route, scope, layer, expanded: false,
      name: file.index.source.slice(hit.start, hit.end) };
  }
  function node(file, hit, route, layer) {
    const n = descriptor(file, hit, route, layer);
    const { key } = n;
    if (nodeIds.has(key)) return nodes[nodeIds.get(key)];
    const id = nodes.length;
    n.id = id;
    nodeIds.set(key, id);
    nodes.push(n);
    return n;
  }
  function connect(edges, edgeIds, from, to, kind, owner, token, guard, detail) {
    const key = JSON.stringify([from.id, to.id, kind, String(owner.uri), token.start, guard?.start]);
    if (edgeIds.has(key)) return;
    edgeIds.add(key);
    edges.push({ id: edges.length, key, from: from.id, to: to.id, kind, owner, token, guard, detail,
      line: owner.index.source.slice(0, token.start).split('\n').length });
  }
  function expand(id) {
    const n = nodes[id];
    if (!n || n.expanded) return;
    if (id !== 0) history.push({ node: n, nodeCount: nodes.length, edgeCount: edges.length });
    n.expanded = true;
    visit(n, node, (...args) => connect(edges, edgeIds, ...args));
  }
  function visit(n, findNode, add) {
    for (const r of directRelations(n.file.index, n.hit, true)) {
      const [kind, incoming] = types[r.direction];
      const hit = lookup(n.file.index, r.token.start);
      if (!hit) continue;
      const other = findNode(n.file, hit, n.route, n.layer + (incoming ? -1 : 1));
      if (other) add(incoming ? other : n, incoming ? n : other, kind, n.file, r.write, r.guard, r.detail);
    }
    for (const step of portSteps(links, n.hit.declaration, n.route)) {
      const hit = lookup(step.file.index, step.token.start);
      if (!hit) continue;
      const incoming = step.role === '上游端口' || (step.dir === 'inout' && !step.down);
      const other = findNode(step.file, hit, step.route, n.layer + (incoming ? -1 : 1));
      if (other) add(incoming ? other : n, incoming ? n : other, step.dir === 'inout' ? '双向端口' : '端口',
        step.owner, step.binding, undefined, step.site.parent + '.' + step.site.name);
    }
  }
  function undo() {
    const last = history.pop();
    if (!last) return;
    for (const e of edges.splice(last.edgeCount)) edgeIds.delete(e.key);
    for (const n of nodes.splice(last.nodeCount)) nodeIds.delete(n.key);
    last.node.expanded = false;
  }
  function candidates() {
    const choices = new Map(), contexts = new Map();
    for (const n of nodes) {
      const mod = n.file.index.modules.find(m => m.start <= n.hit.start && n.hit.start < m.end);
      const context = JSON.stringify([String(n.file.uri), mod.start, n.route.map(s => [s.site.parent, s.site.name, s.down])]);
      if (contexts.has(context)) continue;
      contexts.set(context, true);
      for (const decl of mod.signals.values()) {
        const hit = lookup(n.file.index, decl.offset);
        if (!hit) continue;
        const choice = descriptor(n.file, hit, n.route, 0);
        choices.set(choice.key, choice);
      }
    }
    return choices;
  }
  function focus(first, second) {
    const pair = [first, second].map((n, id) => ({ ...n, id, layer: id }));
    const matches = new Map(pair.map(n => [n.key, n]));
    const found = [], keys = new Set();
    for (const n of pair) {
      visit(n, (...args) => matches.get(descriptor(...args).key), (from, to, ...args) => {
        if (from !== to) connect(found, keys, from, to, ...args);
      });
    }
    return { nodes: pair, edges: found };
  }
  node(file, origin, [], 0);
  expand(0);
  return { nodes, edges, expand, undo, candidates, focus, get canUndo() { return history.length > 0; } };
}

module.exports = { createGraph };
