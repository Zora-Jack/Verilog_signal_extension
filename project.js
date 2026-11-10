const { balancedEnd } = require('./signals');

// Build connections only when the instance type resolves to a unique definition.
function projectLinks(files) {
  const definitions = new Map();
  for (const file of files) {
    for (const mod of file.index.modules) {
      definitions.set(mod.name, definitions.has(mod.name) ? null : { file, mod });
    }
  }
  const bySignal = new Map();
  function add(decl, step) {
    if (!bySignal.has(decl)) bySignal.set(decl, []);
    bySignal.get(decl).push(step);
  }
  for (const file of files) {
    const tokens = file.index.tokens;
    let i = 0;
    for (const mod of file.index.modules) {
      while (i < tokens.length && tokens[i].start < mod.start) i++;
      for (; i < tokens.length && tokens[i].start < mod.end; i++) {
        const child = definitions.get(tokens[i].value);
        if (!child || !definitions.get(mod.name) || ![';', 'end', 'endcase'].includes(tokens[i - 1]?.value)) continue;
        if ([...mod.excluded, ...mod.scopes].some(s => s.start <= tokens[i].start && tokens[i].start < s.end)) continue;
        let j = i + 1;
        if (tokens[j]?.value === '#' && tokens[j + 1]?.value === '(') j = balancedEnd(tokens, j + 1);
        const instance = tokens[j++];
        if (!/^[a-zA-Z_][\w$]*$/.test(instance?.value || '') || tokens[j]?.value !== '(') continue;
        const end = balancedEnd(tokens, j);
        if (tokens[end]?.value !== ';') continue;
        const site = { name: instance.value, parent: mod.name, child: child.mod.name };
        for (j++; j < end - 1;) {
          if (tokens[j]?.value !== '.' || tokens[j + 2]?.value !== '(') break;
          const pin = tokens[j + 1];
          const next = balancedEnd(tokens, j + 2);
          const net = tokens[j + 3];
          const formal = child.mod.signals.get(pin.value);
          const actual = mod.signals.get(net?.value);
          if (next === j + 5 && formal?.direction && actual) {
            const port = { value: pin.value, start: formal.offset, end: formal.offset + pin.value.length };
            const common = { site, dir: formal.direction, binding: net, owner: file };
            add(actual, { ...common, down: true, file: child.file, token: port });
            add(formal, { ...common, down: false, file, token: net });
          }
          j = next;
          if (tokens[j]?.value !== ',') break;
          j++;
        }
        i = end;
      }
    }
  }
  return bySignal;
}

function portSteps(links, decl, context) {
  const result = [];
  const last = context.at(-1);
  for (const link of links.get(decl) || []) {
    if (!link.down && last?.down && last.site !== link.site) continue;
    const undo = last && last.site === link.site && last.down !== link.down;
    const route = undo ? context.slice(0, -1) : [...context, link];
    const downstream = link.down ? link.dir === 'input' : link.dir === 'output';
    const role = link.dir === 'inout' ? '双向端口' : downstream ? '下游端口' : '上游端口';
    result.push({ ...link, route, role });
  }
  return result.sort((a, b) => a.site.name.localeCompare(b.site.name) || a.token.start - b.token.start);
}

module.exports = { projectLinks, portSteps };
