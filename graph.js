const { lookup, directRelations } = require('./signals');
const { portSteps } = require('./project');

const types = {
  '上游': ['数据', true], '下游': ['数据', false],
  '控制来源': ['控制写入', true], '受控写入': ['控制写入', false],
  '选择条件': ['控制选值', true], '受控选值': ['控制选值', false]
};

function createGraph(file, origin, links) {
  const nodes = [], edges = [];
  const nodeIds = new Map(), edgeIds = new Set();
  function node(file, hit, route, layer) {
    const key = JSON.stringify([String(file.uri), hit.declaration.offset,
      route.map(s => [s.site.parent, s.site.name, s.down])]);
    if (nodeIds.has(key)) return nodes[nodeIds.get(key)];
    const id = nodes.length;
    const scope = route.reduce((path, s) => s.down ? path + '.' + s.site.name : s.site.parent, origin.module);
    const n = { id, file, hit, route, scope, layer, expanded: false,
      name: file.index.source.slice(hit.start, hit.end) };
    nodeIds.set(key, id);
    nodes.push(n);
    return n;
  }
  function connect(from, to, kind, owner, token, guard, detail) {
    const key = JSON.stringify([from.id, to.id, kind, String(owner.uri), token.start, guard?.start]);
    if (edgeIds.has(key)) return;
    edgeIds.add(key);
    edges.push({ id: edges.length, from: from.id, to: to.id, kind, owner, token, guard, detail,
      line: owner.index.source.slice(0, token.start).split('\n').length });
  }
  function expand(id) {
    const n = nodes[id];
    if (!n || n.expanded) return;
    n.expanded = true;
    for (const r of directRelations(n.file.index, n.hit, true)) {
      const [kind, incoming] = types[r.direction];
      const hit = lookup(n.file.index, r.token.start);
      if (!hit) continue;
      const other = node(n.file, hit, n.route, n.layer + (incoming ? -1 : 1));
      connect(incoming ? other : n, incoming ? n : other, kind, n.file, r.write, r.guard, r.detail);
    }
    for (const step of portSteps(links, n.hit.declaration, n.route)) {
      const hit = lookup(step.file.index, step.token.start);
      if (!hit) continue;
      const incoming = step.role === '上游端口' || (step.dir === 'inout' && !step.down);
      const other = node(step.file, hit, step.route, n.layer + (incoming ? -1 : 1));
      connect(incoming ? other : n, incoming ? n : other, step.dir === 'inout' ? '双向端口' : '端口',
        step.owner, step.binding, undefined, step.site.parent + '.' + step.site.name);
    }
  }
  node(file, origin, [], 0);
  expand(0);
  return { nodes, edges, expand };
}

module.exports = { createGraph };
