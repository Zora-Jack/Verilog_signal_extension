// Token offsets use UTF-16, the same units as TextDocument.offsetAt().
const tokenPattern = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|\x60(?:define|include|ifdef|ifndef|elsif|else|endif|timescale|default_nettype)\b(?:\\\r?\n|[^\r\n])*|\\[^\s]+|\x60[\w$]+|(?:\d[\d_]*)?'[sS]?[bBoOdDhH][0-9a-fA-F_xXzZ?]+|[a-zA-Z_$][\w$]*|[^\s]/g;
const identifier = /^(?:[a-zA-Z_][\w$]*|\\\S+)$/;
const directions = new Set(['input', 'output', 'inout']);
const types = new Set(['wire', 'reg', 'logic', 'tri']);
const modifiers = new Set(['signed', 'unsigned', 'var']);
const paired = { '(': ')', '[': ']', '{': '}' };

function balancedEnd(tokens, i) {
  const close = paired[tokens[i]?.value];
  let depth = 1;
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].value === tokens[i].value) depth++;
    if (tokens[j].value === close && --depth === 0) return j + 1;
  }
  return tokens.length;
}

function expressionEnd(tokens, i) {
  while (i < tokens.length && ![',', ';', ')', 'endmodule'].includes(tokens[i].value)) {
    i = Object.hasOwn(paired, tokens[i].value) ? balancedEnd(tokens, i) : i + 1;
  }
  return i;
}

function readDeclaration(source, tokens, start, mod) {
  let i = start;
  const value = () => tokens[i]?.value;
  const direction = directions.has(value()) ? value() : '';
  if (direction) i++;
  while (types.has(value()) || modifiers.has(value())) i++;
  while (value() === '[') i = balancedEnd(tokens, i);
  const prefix = source.slice(tokens[start].start, tokens[i - 1].end).trim();
  const net = tokens.slice(start, i).some(t => t.value === 'wire' || t.value === 'tri');
  while (i < tokens.length && identifier.test(value()) && !directions.has(value()) && !types.has(value())) {
    const name = tokens[i++];
    while (value() === '[') i = balancedEnd(tokens, i);
    if (value() === '=') {
      const rhs = ++i;
      i = expressionEnd(tokens, rhs);
      if (net && mod.assignments && [',', ';'].includes(value())) mod.assignments.push({ name, rhs, end: i });
    }
    if (![',', ';', ')'].includes(value())) break;
    const body = source.slice(name.start, tokens[i - 1].end);
    const previous = mod.signals.get(name.value);
    // Classic port declarations can separate direction and storage type.
    const qualifiers = !direction && previous?.direction ? previous.direction + ' ' : '';
    mod.signals.set(name.value, {
      offset: name.start, direction: direction || previous?.direction,
      text: qualifiers + prefix + ' ' + body + (value() === ';' ? ';' : '')
    });
    if (value() !== ',') break;
    i++;
  }
  return i;
}

// Each result points into the assignment itself, so separate drivers remain distinguishable.
function readAssign(tokens, start, mod) {
  let i = start;
  while (identifier.test(tokens[i]?.value || '')) {
    const name = tokens[i++];
    while (tokens[i]?.value === '[') i = balancedEnd(tokens, i);
    if (tokens[i]?.value !== '=') return;
    const rhs = ++i;
    i = expressionEnd(tokens, rhs);
    if (![',', ';'].includes(tokens[i]?.value)) return;
    mod.assignments.push({ name, rhs, end: i });
    if (tokens[i++].value !== ',') return;
  }
}

// Visit statement heads only: "<=" inside a condition or an RHS is a comparison.
function readClockedBlock(source, tokens, start, mod) {
  const at = i => tokens[i]?.value;
  if (at(start) !== '@' || at(start + 1) !== '(') return;
  const body = balancedEnd(tokens, start + 1);
  const events = tokens.slice(start + 2, body - 1).map(t => t.value).join(' ');
  if (!/^(?:posedge|negedge) [\w$]+(?: (?:or|,) (?:posedge|negedge) [\w$]+)*$/.test(events)) return;
  const edge = source.slice(tokens[start].start, tokens[body - 1].end).replace(/\s+/g, ' ');

  function condition(start, end, prefix) {
    const first = tokens[start].start;
    const last = tokens[end - 1].end;
    const value = source.slice(first, last);
    return { value, start: first, end: last, operands: tokens.slice(start, end), label: prefix + value.replace(/\s+/g, ' ') };
  }

  function statement(i, guards) {
    const head = at(i);
    if (head === 'begin') {
      i += at(i + 1) === ':' ? 3 : 1;
      while (at(i) && at(i) !== 'end' && at(i) !== 'endmodule') i = statement(i, guards);
      return i + (at(i + 1) === ':' ? 3 : 1);
    }
    if (['unique', 'unique0', 'priority'].includes(head)) return statement(i + 1, guards);
    if (head === 'if' && at(i + 1) === '(') {
      const end = balancedEnd(tokens, i + 1);
      if (at(end - 1) !== ')' || end <= i + 3) return end;
      const predicate = condition(i + 2, end - 1, 'if · ');
      i = statement(end, [...guards, predicate]);
      if (at(i) !== 'else') return i;
      const otherwise = { ...predicate, label: 'else · 未进入 if (' + predicate.value.replace(/\s+/g, ' ') + ')' };
      return statement(i + 1, [...guards, otherwise]);
    }
    if (['for', 'while', 'repeat'].includes(head) && at(i + 1) === '(') {
      return statement(balancedEnd(tokens, i + 1), guards);
    }
    if (['case', 'casez', 'casex'].includes(head) && at(i + 1) === '(') {
      const close = balancedEnd(tokens, i + 1);
      if (at(close - 1) !== ')') return close;
      const selector = source.slice(tokens[i].start, tokens[close - 1].end).replace(/\s+/g, ' ');
      const selectorTokens = tokens.slice(i + 2, close - 1);
      i = close;
      while (at(i) && at(i) !== 'endcase' && at(i) !== 'endmodule') {
        const first = i;
        if (at(i) === 'default') {
          i++;
        } else {
          let ternary = 0;
          while (at(i) && !['endcase', 'endmodule'].includes(at(i))) {
            if (at(i) === ':' && !ternary) break;
            if (at(i) === '?') ternary++;
            if (at(i) === ':') ternary--;
            i = Object.hasOwn(paired, at(i)) ? balancedEnd(tokens, i) : i + 1;
          }
        }
        if (at(i) === 'endcase' || at(i) === 'endmodule') break;
        if (first === i || !at(i)) return i + 1;
        const branch = condition(first, i, selector + ' → ');
        branch.operands = selectorTokens.concat(tokens[close - 1], branch.operands);
        i = statement(at(i) === ':' ? i + 1 : i, [...guards, branch]);
      }
      return i + 1;
    }
    let op = i + 1;
    while (at(op) === '[') op = balancedEnd(tokens, op);
    const rhs = op + 2;
    let end = i;
    while (at(end) && ![';', 'end', 'endcase', 'endmodule'].includes(at(end))) {
      end = Object.hasOwn(paired, at(end)) ? balancedEnd(tokens, end) : end + 1;
    }
    if (identifier.test(head || '') && at(op) === '<' && at(op + 1) === '=' &&
        tokens[op].end === tokens[op + 1].start && rhs < end && at(end) === ';' &&
        !['#', '@'].includes(at(rhs))) {
      mod.assignments.push({ name: tokens[i], rhs, end, edge, guards });
    }
    return end + 1;
  }
  statement(body, []);
}

// At each nesting level a ternary predicate starts at the current subexpression.
function ternarySelectors(tokens, start, end) {
  const ranges = [];
  const starts = [start];
  for (let i = start; i < end; i++) {
    const value = tokens[i].value;
    if (Object.hasOwn(paired, value)) starts.push(i + 1);
    else if ([')', ']', '}'].includes(value)) starts.pop();
    else if (['?', ':', ','].includes(value)) {
      if (value === '?') ranges.push([starts.at(-1), i]);
      starts[starts.length - 1] = i + 1;
    }
  }
  return ranges;
}

function directRelations(index, hit, expandControls = false) {
  const mod = index.modules.find(m => m.start <= hit.start && hit.start < m.end);
  const tokens = index.tokens;
  const signal = index.source.slice(hit.start, hit.end);
  const results = [];
  if (mod?.signals.get(signal) !== hit.declaration) return results;
  function moduleSignal(t) {
    return mod.signals.has(t.value) && !mod.scopes.some(s =>
      s.start <= t.start && t.start < s.end && s.signals.has(t.value));
  }
  for (const { name, rhs, end, edge, guards = [] } of mod.assignments) {
    if (!moduleSignal(name)) continue;
    const seen = new Set();
    const selectors = expandControls ? ternarySelectors(tokens, rhs, end) : [];
    const detail = index.source.slice(name.start, tokens[end - 1].end).replace(/\s+/g, ' ');
    for (let i = rhs; i < end; i++) {
      const t = tokens[i];
      if (!moduleSignal(t)) continue;
      if (tokens[i - 1]?.value === '.' || ['.', '('].includes(tokens[i + 1]?.value)) continue;
      const selector = selectors.find(([start, stop]) => start <= i && i < stop);
      const key = (selector ? 'select:' : 'data:') + t.value;
      if (seen.has(key)) continue;
      seen.add(key);
      if (selector) {
        if (name.value === signal) results.push({ direction: '选择条件', token: t, detail, edge, writeOffset: name.start });
        if (t.value === signal) results.push({ direction: '受控选值', token: name, detail, edge, guardOffset: t.start });
        continue;
      }
      if (name.value === signal) results.push({ direction: '上游', token: t, detail, edge });
      if (t.value === signal) results.push({ direction: '下游', token: name, detail, edge });
    }
    for (const guard of guards) {
      if (!expandControls && name.value === signal) {
        results.push({ direction: '写入条件', token: guard, detail, edge, writeOffset: name.start });
      }
      if (!expandControls) continue;
      const controls = new Set();
      for (const [i, operand] of guard.operands.entries()) {
        if (!moduleSignal(operand) || controls.has(operand.value)) continue;
        if (guard.operands[i - 1]?.value === '.' || ['.', '('].includes(guard.operands[i + 1]?.value)) continue;
        controls.add(operand.value);
        const evidence = guard.label + ' · ' + detail;
        if (name.value === signal) results.push({ direction: '控制来源', token: operand, detail: evidence, edge, writeOffset: name.start });
        if (operand.value === signal) results.push({ direction: '受控写入', token: name, detail: evidence, edge, guardOffset: guard.start });
      }
    }
  }
  return results;
}

function indexDocument(source) {
  const tokens = [];
  for (const match of source.matchAll(tokenPattern)) {
    const value = match[0];
    if (/^(?:\/\/|\/\*|\x60(?:define|include|ifdef|ifndef|elsif|else|endif|timescale|default_nettype)\b)/.test(value)) continue;
    tokens.push({ value, start: match.index, end: match.index + value.length });
  }
  const modules = [];
  let mod;
  let skipUntil;
  let blocks = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.value === 'module') {
      const nameIndex = ['automatic', 'static'].includes(tokens[i + 1]?.value) ? i + 2 : i + 1;
      mod = { name: tokens[nameIndex]?.value, start: t.start, end: source.length, signals: new Map(), excluded: [], scopes: [], assignments: [] };
      modules.push(mod);
      blocks = [];
      skipUntil = undefined;
    } else if (t.value === 'endmodule') {
      if (mod) mod.end = t.end;
      mod = undefined;
    } else if (mod) {
      if (skipUntil) {
        if (t.value === skipUntil) {
          mod.excluded.at(-1).end = t.end;
          skipUntil = undefined;
        }
      } else if (['function', 'task', 'generate'].includes(t.value)) {
        skipUntil = 'end' + t.value;
        mod.excluded.push({ start: t.start, end: source.length });
      } else if (t.value === 'begin') {
        const scope = { start: t.start, end: source.length, signals: new Map() };
        blocks.push(scope);
        mod.scopes.push(scope);
      } else if (t.value === 'end') {
        const scope = blocks.pop();
        if (scope) scope.end = t.end;
      } else if (!blocks.length && ['always', 'always_ff'].includes(t.value)) {
        readClockedBlock(source, tokens, i + 1, mod);
      } else if (!blocks.length && t.value === 'assign') {
        readAssign(tokens, i + 1, mod);
      } else if (directions.has(t.value) || types.has(t.value)) {
        i = Math.max(i, readDeclaration(source, tokens, i, blocks.at(-1) || mod) - 1);
      }
    }
  }
  return { source, modules, tokens };
}

function lookup({ modules, tokens }, offset) {
  const mod = modules.find(m => m.start <= offset && offset < m.end);
  if (!mod || mod.excluded.some(r => r.start <= offset && offset < r.end)) return;
  let lo = 0, hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tokens[mid].end <= offset) lo = mid + 1;
    else hi = mid;
  }
  const t = tokens[lo];
  if (!t || offset < t.start || tokens[lo - 1]?.value === '.') return;
  const scope = mod.scopes.findLast(s => s.start <= offset && offset < s.end && s.signals.has(t.value));
  const declaration = (scope || mod).signals.get(t.value);
  if (declaration) return { module: mod.name, declaration, start: t.start, end: t.end };
}

module.exports = { indexDocument, lookup, directRelations, balancedEnd };
