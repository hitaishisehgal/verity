import crypto from 'node:crypto';

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { i++; continue; }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (source.startsWith('/*', i)) { i += 2; while (i < source.length && !source.startsWith('*/', i)) i++; i = Math.min(source.length, i + 2); continue; }
    if (char === '#') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (char === '"' || char === "'") {
      const delimiter = source.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
      i += delimiter.length;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source.startsWith(delimiter, i)) { i += delimiter.length; break; }
        i++;
      }
      tokens.push('STR');
      continue;
    }
    const identifier = source.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (identifier) { tokens.push(identifier[0]); i += identifier[0].length; continue; }
    const number = source.slice(i).match(/^\d+(?:\.\d+)?/);
    if (number) { tokens.push(number[0]); i += number[0].length; continue; }
    const operator = source.slice(i).match(/^(?:===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|->|=>|::)/);
    if (operator) { tokens.push(operator[0]); i += operator[0].length; continue; }
    tokens.push(char);
    i++;
  }
  return tokens;
}export function fingerprints(source, k = 5, windowSize = 4) {
  const tokens = tokenize(source), hashes = [];
  for (let i = 0; i <= tokens.length - k; i++) hashes.push(crypto.createHash('sha1').update(tokens.slice(i, i + k).join(' ')).digest('hex'));
  if (!hashes.length) return new Set();
  const selected = new Set(), span = Math.min(windowSize, hashes.length);
  for (let start = 0; start <= hashes.length - span; start++) {
    let minimum = start;
    for (let i = start + 1; i < start + span; i++) if (hashes[i] <= hashes[minimum]) minimum = i;
    selected.add(hashes[minimum]);
  }
  return selected;
}
export function compare(sourceA, sourceB) {
  const a = fingerprints(sourceA), b = fingerprints(sourceB);
  const intersection = [...a].filter(hash => b.has(hash)).length, union = a.size + b.size - intersection;
  return { jaccard: union ? +(intersection / union).toFixed(4) : (sourceA === sourceB ? 1 : 0), coverageA: a.size ? +(intersection / a.size).toFixed(4) : 0, coverageB: b.size ? +(intersection / b.size).toFixed(4) : 0, similarity: +(Math.max(a.size ? intersection / a.size : 0, b.size ? intersection / b.size : 0) * 100).toFixed(2) };
}