const test = require('node:test');
const assert = require('node:assert/strict');
const { createGraph } = require('../graph');
const { indexDocument, lookup } = require('../signals');
const { projectLinks } = require('../project');

test('write and selector edges remain distinct and are reused on reverse expansion', () => {
  const source = 'module m(input clk, en, d, output reg q); always @(posedge clk) begin if(en) q <= d; q <= en ? d : q; end endmodule';
  const file = { uri: 'm.v', index: indexDocument(source) };
  const graph = createGraph(file, lookup(file.index, source.indexOf('en,')), new Map());
  const q = graph.nodes.find(n => n.name === 'q');
  const edges = () => graph.edges.filter(e => e.from === 0 && e.to === q.id);
  assert.deepEqual(edges().map(e => [e.kind, e.token.start]), [
    ['控制写入', source.indexOf('q <= d')], ['控制选值', source.indexOf('q <= en')]
  ]);
  assert.equal(edges()[0].guard.start, source.indexOf('if(en)') + 3);
  graph.expand(q.id);
  graph.expand(q.id);
  assert.equal(edges().length, 2);
  assert.equal(graph.nodes.filter(n => n.name === 'q').length, 1);
  assert.ok(graph.edges.some(e => e.from === q.id && e.to === q.id));
});

test('two instances feeding from the same net expand as separate nodes', () => {
  const top = { uri: 'top.v', index: indexDocument('module top(input p); leaf a(.d(p)); leaf b(.d(p)); endmodule') };
  const leaf = { uri: 'leaf.v', index: indexDocument('module leaf(input d); wire q=d; endmodule') };
  const graph = createGraph(top, lookup(top.index, top.index.source.indexOf('p)')), projectLinks([top, leaf]));
  const pins = graph.nodes.filter(n => n.name === 'd');
  assert.deepEqual(pins.map(n => n.scope), ['top.a', 'top.b']);
  for (const pin of pins) graph.expand(pin.id);
  assert.equal(graph.nodes.filter(n => n.name === 'q').length, 2);
  assert.equal(graph.edges.filter(e => e.kind === '端口').length, 2);
});
