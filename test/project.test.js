const test = require('node:test');
const assert = require('node:assert/strict');
const { indexDocument } = require('../signals');
const { projectLinks, portSteps } = require('../project');

const parse = source => ({ index: indexDocument(source) });
const child = parse('module leaf #(parameter WIDTH=1)(input wire a, output wire y); assign y = a; endmodule');
const parent = parse('module top(input wire p, q, output wire x, z); leaf #(.WIDTH(1)) left(.a(p), .y(x)); leaf right(.a(q), .y(z)); endmodule');
const signal = (file, name) => file.index.modules[0].signals.get(name);

test('a port traversal exits through the same instance, even on a different pin', () => {
  const links = projectLinks([parent, child]);
  const [entry] = portSteps(links, signal(parent, 'q'), []);
  assert.equal(entry.site.name, 'right');
  assert.equal(entry.role, '下游端口');
  const exits = portSteps(links, signal(child, 'y'), entry.route);
  assert.deepEqual(exits.map(s => [s.token.value, s.role, s.route.length]), [['z', '下游端口', 0]]);
  const parents = portSteps(links, signal(child, 'a'), []);
  assert.deepEqual(parents.map(s => [s.site.name, s.token.value, s.role]), [['left','p','上游端口'], ['right','q','上游端口']]);
});

test('ambiguous module definitions and compound actuals do not create false links', () => {
  assert.equal(projectLinks([parent, child, parse(child.index.source)]).size, 0);
  const expr = parse('module t(input wire p, q); leaf u(.a(p & q), .y()); endmodule');
  assert.equal(projectLinks([expr, child]).size, 0);
});
