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
}function fingerprintDetails(source, k, windowSize) {
  const tokens = tokenize(source), grams = [];
  for (let i = 0; i <= tokens.length - k; i++) {
    const sequence = tokens.slice(i, i + k);
    grams.push({ hash: crypto.createHash('sha1').update(sequence.join(' ')).digest('hex'), sequence });
  }
  if (!grams.length) return new Map();
  const selected = new Map(), span = Math.min(windowSize, grams.length);
  for (let start = 0; start <= grams.length - span; start++) {
    let minimum = start;
    for (let i = start + 1; i < start + span; i++) if (grams[i].hash <= grams[minimum].hash) minimum = i;
    selected.set(grams[minimum].hash, grams[minimum].sequence);
  }
  return selected;
}
export function fingerprints(source, k = 5, windowSize = 4) {
  return new Set(fingerprintDetails(source, k, windowSize).keys());
}
export function compare(sourceA, sourceB, baseCodeTemplate = '') {
  const templateFingerprints = fingerprints(baseCodeTemplate);
  const a = fingerprintDetails(sourceA, 5, 4), b = fingerprintDetails(sourceB, 5, 4);
  let filteredTemplateFingerprints = 0;
  for (const hash of templateFingerprints) {
    const filteredA = a.delete(hash), filteredB = b.delete(hash);
    if (filteredA || filteredB) filteredTemplateFingerprints++;
  }
  const commonHashes = [...a.keys()].filter(hash => b.has(hash));
  const intersection = commonHashes.length, union = a.size + b.size - intersection;
  const coverageA = a.size ? intersection / a.size : 0, coverageB = b.size ? intersection / b.size : 0;
  return {
    jaccard: union ? +(intersection / union).toFixed(4) : sourceA === sourceB && filteredTemplateFingerprints === 0 ? 1 : 0,
    coverageA: +coverageA.toFixed(4),
    coverageB: +coverageB.toFixed(4),
    similarity: union ? +(Math.max(coverageA, coverageB) * 100).toFixed(2) : sourceA === sourceB && filteredTemplateFingerprints === 0 ? 100 : 0,
    commonTokenSequences: commonHashes.map(hash => a.get(hash)),
  };
}