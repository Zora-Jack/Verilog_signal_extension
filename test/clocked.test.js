const test = require('node:test');
const assert = require('node:assert/strict');
const { indexDocument, lookup, directRelations } = require('../signals');

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
  const rows = directRelations(index, hit);
  assert.deepEqual(rows.map(r => [r.token.value, r.token.start, r.edge]), [
    ['a', source.indexOf('q <= a;') + 5, '@(posedge clk or negedge rst)'],
    ['b', source.indexOf('q <= b;') + 5, '@(posedge clk or negedge rst)']
  ]);
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
