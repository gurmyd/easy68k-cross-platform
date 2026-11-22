// Release candidate (ARCHITECTURE.md 6.9, package I3): the titles of the tests and checks in a
// source file, so that a judge finds a named proof by its exact title and not by a substring of the
// file. Used by item-02-checklists.mjs (item 2) and item-05-parity.mjs (item 5).
//
// A title is the first argument of a call of it, test, describe, suite or check (with modifiers such
// as test.describe, it.skipIf(...), test.fail), written as a string or template literal. A template's
// ${...} parts match any text, and one at the very start that names the browser (`${p} ...`,
// `${browser}: ...`) is left out, because check-*.mjs scripts print each check once per browser. A
// proof matches a title when it equals the whole title with those parts filled in. No browser, no
// network.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { readFileSync } from 'node:fs';

const CALL =
  /\b(?:it|test|describe|suite|check)(?:\s*\.\s*(?:only|skip|todo|fail|fails|fixme|slow|concurrent|sequential|serial|parallel|describe|step|each|skipIf|runIf)(?:\s*\([^()]*(?:\([^()]*\)[^()]*)*\))?)*\s*\(\s*/g;

/** Reads one string or template literal starting at `text[at]`; returns its raw content and parts. */
function literalAt(text, at) {
  const quote = text[at];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let i = at + 1;
  let raw = '';
  const parts = []; // literal pieces between ${...} (template only)
  let piece = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      const next = text[i + 1];
      const value = { n: '\n', t: '\t', r: '\r' }[next] ?? next;
      raw += c + next;
      piece += value;
      i += 2;
      continue;
    }
    if (c === quote) return { raw, parts: [...parts, piece], template: quote === '`', end: i + 1 };
    if (quote === '`' && c === '$' && text[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      raw += text.slice(i, j);
      parts.push(piece);
      piece = '';
      i = j;
      continue;
    }
    if (quote !== '`' && c === '\n') return null;
    raw += c;
    piece += c;
    i += 1;
  }
  return null;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();

/** @returns {{ raw: string, pattern: RegExp }[]} the titles of the file at `path`. */
export function titlesOf(path) {
  if (cache.has(path)) return cache.get(path);
  const text = readFileSync(path, 'utf8');
  const titles = [];
  for (const m of text.matchAll(CALL)) {
    const lit = literalAt(text, m.index + m[0].length);
    if (!lit) continue;
    let parts = lit.parts;
    // A leading ${...} followed by a space or ': ' names the browser of a check script.
    if (lit.template && parts.length > 1 && parts[0] === '' && /^(?::\s*|\s+)/.test(parts[1])) {
      parts = [parts[1].replace(/^(?::\s*|\s+)/, ''), ...parts.slice(2)];
    }
    const pattern = new RegExp(`^${parts.map(escape).join('[\\s\\S]+?')}$`);
    titles.push({ raw: lit.raw, pattern });
  }
  cache.set(path, titles);
  return titles;
}

/** Whether `proof` is exactly the title `t` (its ${...} parts filled in with any text). */
export function titleMatches(t, proof) {
  return t.pattern.test(proof);
}

/** Whether the file at `path` has a test or check whose title is exactly `proof`. */
export function hasTitle(path, proof) {
  return titlesOf(path).some((t) => titleMatches(t, proof));
}
