// Token offsets use UTF-16, the same units as TextDocument.offsetAt().
const tokenPattern = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|\x60(?:define|include|ifdef|ifndef|elsif|else|endif|timescale|default_nettype)\b(?:\\\r?\n|[^\r\n])*|\\[^\s]+|\x60[\w$]+|[a-zA-Z_$][\w$]*|[^\s]/g;
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

function directRelations(index, hit) {
  const mod = index.modules.find(m => m.start <= hit.start && hit.start < m.end);
  const tokens = index.tokens;
  const signal = index.source.slice(hit.start, hit.end);
  const results = [];
  if (mod?.signals.get(signal) !== hit.declaration) return results;
  for (const { name, rhs, end } of mod.assignments) {
    if (!mod.signals.has(name.value)) continue;
    const seen = new Set();
    for (let i = rhs; i < end; i++) {
      const t = tokens[i];
      if (!mod.signals.has(t.value) || seen.has(t.value)) continue;
      if (tokens[i - 1]?.value === '.' || ['.', '('].includes(tokens[i + 1]?.value)) continue;
      seen.add(t.value);
      const detail = index.source.slice(name.start, tokens[end - 1].end).replace(/\s+/g, ' ');
      if (name.value === signal) results.push({ direction: '上游', token: t, detail });
      if (t.value === signal) results.push({ direction: '下游', token: name, detail });
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

module.exports = { indexDocument, lookup, directRelations };
