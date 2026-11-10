const test = require('node:test');
const assert = require('node:assert/strict');
const { indexDocument, lookup, directRelations } = require('../signals');

test('a guard, a mux selector, and a data operand have distinct reversible links', () => {
  const source = `module m(input wire clk, en, d, output reg q);
    always @(posedge clk) begin
      if (en) q <= d;
      q <= en ? en : d;
      case (en)
        0: q <= d;
      endcase
    end
    endmodule`;
  const index = indexDocument(source);
  const from = offset => directRelations(index, lookup(index, offset), true);
  const enable = from(source.indexOf('en,'));
  assert.deepEqual(enable.map(r => [r.direction, r.detail]), [
    ['受控写入', 'if · en · q <= d'],
    ['受控选值', 'q <= en ? en : d'],
    ['下游', 'q <= en ? en : d'],
    ['受控写入', 'case (en) → 0 · q <= d']
  ]);
  const upstream = from(source.indexOf('reg q') + 4).filter(r => r.token.value === 'en');
  assert.deepEqual(upstream.map(r => [r.direction, r.token.start]), [
    ['控制来源', source.indexOf('if (en)') + 4],
    ['选择条件', source.indexOf('en ?')],
    ['上游', source.indexOf('en :')],
    ['控制来源', source.indexOf('case (en)') + 6]
  ]);
});

test('clocked data dependencies keep their assignment site and exclude branch predicates', () => {
  const source = `module m(input wire clk, rst, a, b, output reg q);
    always_ff @(posedge clk or negedge rst)
      if (!rst) q <= a;
      else if (a <= b) q <= b;
    always @(*) begin
      q = a;
    end
    always @(negedge clk) begin : shadow
      reg a;
      q <= a;
    end
    endmodule`;
  const index = indexDocument(source);
  const hit = lookup(index, source.indexOf('reg q') + 4);
  const relations = directRelations(index, hit);
  const rows = relations.filter(r => r.direction === '上游');
  assert.deepEqual(rows.map(r => [r.token.value, r.token.start, r.edge]), [
    ['a', source.indexOf('q <= a;') + 5, '@(posedge clk or negedge rst)'],
    ['b', source.indexOf('q <= b;') + 5, '@(posedge clk or negedge rst)']
  ]);
  assert.deepEqual(relations.filter(r => r.direction === '写入条件').map(r => [r.token.label, r.detail]), [
    ['if · !rst', 'q <= a'],
    ['else · 未进入 if (!rst)', 'q <= b'],
    ['if · a <= b', 'q <= b']
  ]);
});

test('case labels and if guards stay with their own writes, including constant writes', () => {
  const source = `module m(input wire clk, a, b, output reg q);
    always @(posedge clk) casez ({a,b})
      2'b1?, 2'b01: if (b) q <= a;
      default: q <= 0;
    endcase
    endmodule`;
  const index = indexDocument(source);
  const rows = directRelations(index, lookup(index, source.indexOf('reg q') + 4));
  const guards = rows.filter(r => r.direction === '写入条件');
  assert.deepEqual(guards.map(r => [r.token.value, r.detail]), [
    ["2'b1?, 2'b01", 'q <= a'], ['b', 'q <= a'], ['default', 'q <= 0']
  ]);
  for (const {token} of guards) assert.equal(index.source.slice(token.start, token.end), token.value);
});

test('a single edge-triggered statement ends before the next process', () => {
  const source = `module m(input wire clk, d, output reg q, output reg other);
    always @(negedge clk) q <= d;
    initial other <= d;
    endmodule`;
  const index = indexDocument(source);
  const hit = lookup(index, source.indexOf(', d') + 2);
  assert.deepEqual(directRelations(index, hit).map(r => [r.token.value, r.edge]), [
    ['q', '@(negedge clk)']
  ]);
});
