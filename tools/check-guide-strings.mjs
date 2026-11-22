#!/usr/bin/env node
// N10: checks that every caption and text the user guide quotes in its section "Beyond the original"
// is exactly a text of the code.
//
//     node tools/check-guide-strings.mjs [--guide <file>]
//
// HOW THE GUIDE MARKS A QUOTED TEXT (the same rules stand in a comment at the head of the section):
//   **bold**       a caption: a menu item, a button, a column, the title of a dialog. A menu path is
//                  written **Menu > Item** and every part of it is checked. Emphasis is written *italic*.
//   `one backtick` a text the application shows (a question, a message, a status line).
//   ``two``        anything else in code type (file names, chords): not checked.
//   Example names: a line of the section's head comment that lists, separated by commas, the names
//                  of files and folders the quoted texts use as examples ("prog.X68", "demo").
// Only the section between the heading "## Beyond the original" and the next "## " heading is read,
// and HTML comments are not quotes. What is marked is compared; what is not marked is not.
//
// WHAT IT IS COMPARED WITH: every string and template literal of the texts.ts files of the stage of
// additions (STAGE_TEXTS below: the ten that ARCHITECTURE-PLUS P5 names), of
// `app/src/commands/specs.ts` (the captions of the commands) and of the menu tables
// `app/src/commands/tables/*-menu.ts` (the names of the menus, Window, View, File, Options, which
// specs.ts does not hold; docs/porting/errata/N10.md). The texts.ts files cannot be imported by Node:
// they import each other without file extensions. So they are read by a small tokenizer here: it
// skips comments, reads '...', "..." and `...` (also a template written inside the `${...}` of
// another), and joins literals written with `+`. A caption's access key (`&`) is dropped, because the
// guide shows captions without it; runs of spaces and line breaks count as one space.
//
// A TEMPLATE'S `${...}` is a wildcard, and a wildcard may stand only for
//   - a number, alone or with one of the words NUMBER_WORDS after it ("14 files", "3.4 MB");
//   - one of the guide's example names, or several joined by "/", with or without double quotes;
//   - another text of the code (a literal, or a template matched by these same rules), or a list of
//     such texts separated by ", " (the Delete question names several items that way).
// So `Moved 3 items to demo.` matches `${verb} ${count} items to ${target}.` because "Moved" is a
// literal of the code, "3" a number and "demo" an example name, and `Moves 3 items to demo.` does
// not. A quote as a whole must match a literal, or a template with at least MIN_LITERAL letters and
// digits of its own. A wrong example name that is still in the list is not noticed: which name the
// application really shows (a whole path, or only the file's name) must be checked by a person.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A template needs this many letters and digits of its own to match a quote as a whole: one with
 * fewer (`${n} ${word}`, `${a}, ${b}`) is only a part of other texts. "to" in `${verb} ${name} to
 * ${target}.` is enough, because its wildcards are bound by the rules above.
 */
export const MIN_LITERAL = 2;
export const SECTION_HEADING = '## Beyond the original';
/** The section has well over this many marked texts; fewer means the marks were lost. */
export const MIN_QUOTES = 40;
/** How deep a wildcard may be another template whose wildcards are templates again. */
export const MAX_DEPTH = 4;
/** The words the code's counts and sizes put after a number (formatSize, files(), items(), count()). */
export const NUMBER_WORDS = [
  'byte',
  'bytes',
  'kB',
  'MB',
  'GB',
  'file',
  'files',
  'item',
  'items',
  'version',
  'versions',
];
/** The texts.ts files of the stage of additions (P5), relative to app/src. */
export const STAGE_TEXTS = [
  'ui/dock/texts.ts',
  'features/layout/texts.ts',
  'features/files/texts.ts',
  'features/history/texts.ts',
  'features/viewer/texts.ts',
  'features/additions/texts.ts',
  'features/reload-offer/texts.ts',
  'core/history/texts.ts',
  'core/places/texts.ts',
  'core/trash-restore/texts.ts',
];

// ---- reading the code's literals ------------------------------------------------------------------

/** Index after the `}` that closes a `${` whose body starts at `i`; templates inside go to `found`. */
function skipExpression(src, i, found) {
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const { value, end } = skipQuoted(src, i);
      found.push([value]);
      i = end;
    } else if (c === '`') {
      const { segments, end } = readTemplate(src, i, found);
      found.push(segments);
      i = end;
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
  }
  return i;
}

function skipQuoted(src, i) {
  const quote = src[i];
  let value = '';
  i++;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') {
      const next = src[i + 1];
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
    } else value += src[i++];
  }
  return { value, end: i + 1 };
}

/** A template literal as segments: strings, and `null` for each `${...}`. */
function readTemplate(src, i, found) {
  const segments = [''];
  i++;
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\') {
      const next = src[i + 1];
      segments[segments.length - 1] += next === 'n' ? '\n' : next;
      i += 2;
    } else if (src[i] === '$' && src[i + 1] === '{') {
      i = skipExpression(src, i + 2, found);
      segments.push(null, '');
    } else segments[segments.length - 1] += src[i++];
  }
  return { segments, end: i + 1 };
}

/**
 * Every string literal of a TypeScript source as segments, `a + b` joined into one. The literals
 * written inside a template's `${...}` come too, each on its own.
 */
export function parseLiterals(src) {
  const items = []; // { segments } | '+' | 'other'
  const inner = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === "'" || c === '"') {
      const { value, end } = skipQuoted(src, i);
      items.push({ segments: [value] });
      i = end;
    } else if (c === '`') {
      const { segments, end } = readTemplate(src, i, inner);
      items.push({ segments });
      i = end;
    } else {
      if (c === '+' && src[i + 1] !== '+' && src[i - 1] !== '+') items.push('+');
      else if (!/\s/.test(c)) items.push('other');
      i++;
    }
  }
  const out = [];
  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    if (typeof item === 'string') continue;
    let segments = [...item.segments];
    while (items[k + 1] === '+' && items[k + 2] && typeof items[k + 2] !== 'string') {
      const next = items[k + 2].segments;
      segments = [...segments.slice(0, -1), (segments.at(-1) ?? '') + (next[0] ?? ''), ...next.slice(1)];
      k += 2;
    }
    out.push(segments);
  }
  return [...out, ...inner];
}

const normalise = (text) => text.replace(/\s+/g, ' ').trim();
/** A caption's access key: `&` before a character, `&&` is one `&`. */
const dropAccessKey = (text) => text.replace(/&(.)/g, (_, c) => c);
const ownLetters = (segments) =>
  segments
    .filter((s) => s !== null)
    .join('')
    .replace(/[^\p{L}\p{N}]/gu, '').length;

/** A template ready for matching: literal parts with spaces collapsed, the ends trimmed. */
function prepare(segments) {
  const parts = [];
  for (const s of segments) {
    if (s === null) parts.push(null);
    else parts.push(dropAccessKey(s).replace(/\s+/g, ' '));
  }
  if (typeof parts[0] === 'string') parts[0] = parts[0].trimStart();
  const last = parts.length - 1;
  if (typeof parts[last] === 'string') parts[last] = parts[last].trimEnd();
  const literals = parts.filter((p) => typeof p === 'string' && p.trim() !== '').map((p) => p.trim());
  return { parts, literals, own: ownLetters(segments) };
}

const NUMBER = new RegExp(String.raw`^\d+(?:[.,]\d+)?(?: (?:${NUMBER_WORDS.join('|')}))?$`);

/**
 * `matches(text)` is true when the text is exactly a literal of `literalLists`, or matches one of its
 * templates by the rules at the head of this file. `examples` are the guide's example names.
 */
export function buildMatcher(literalLists, examples = []) {
  const exact = new Set();
  const templates = [];
  for (const segments of literalLists) {
    if (segments.every((s) => s !== null)) {
      const text = normalise(dropAccessKey(segments.join('')));
      if (text) exact.add(text);
    } else templates.push(prepare(segments));
  }
  const names = new Set(examples.map(normalise).filter(Boolean));
  const isName = (text) => {
    const bare = text.length > 1 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
    return bare.split('/').every((part) => names.has(part));
  };
  const memo = new Map();

  /** Does `text` from `ti` on match the template's parts from `si` on? */
  function fits(parts, si, text, ti, depth) {
    if (si === parts.length) return ti === text.length;
    const part = parts[si];
    if (part !== null) return text.startsWith(part, ti) && fits(parts, si + 1, text, ti + part.length, depth);
    const next = parts[si + 1];
    for (let end = ti + 1; end <= text.length; end++) {
      if (typeof next === 'string' && next !== '' && !text.startsWith(next, end)) continue;
      if (next === undefined && end !== text.length) continue;
      if (wildcard(text.slice(ti, end), depth) && fits(parts, si + 1, text, end, depth)) return true;
    }
    return false;
  }

  function wildcard(raw, depth) {
    const text = raw.trim();
    if (!text) return false;
    if (NUMBER.test(text) || isName(text)) return true;
    if (codeText(text, depth + 1, false)) return true;
    if (text.includes(', ')) {
      return text
        .split(', ')
        .every((piece) => NUMBER.test(piece) || isName(piece) || codeText(piece, depth + 1, false));
    }
    return false;
  }

  function codeText(text, depth, whole) {
    if (exact.has(text)) return true;
    if (depth > MAX_DEPTH) return false;
    const key = `${whole ? 'w' : depth}|${text}`;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, false); // a template that would need itself again does not match
    const result = templates.some(
      (t) =>
        (!whole || t.own >= MIN_LITERAL) &&
        t.literals.every((l) => text.includes(l)) &&
        fits(t.parts, 0, text, 0, depth),
    );
    memo.set(key, result);
    return result;
  }

  return (text) => codeText(normalise(text), 0, true);
}

/** The files whose literals the guide's texts are compared with. */
export function sourceFiles(repoRoot) {
  const src = join(repoRoot, 'app', 'src');
  const files = STAGE_TEXTS.map((p) => join(src, ...p.split('/')));
  files.push(join(src, 'commands', 'specs.ts'));
  const tables = join(src, 'commands', 'tables');
  for (const name of readdirSync(tables)) if (/-menu\.ts$/.test(name)) files.push(join(tables, name));
  return files;
}

export function loadLiterals(repoRoot) {
  const lists = [];
  for (const file of sourceFiles(repoRoot)) lists.push(...parseLiterals(readFileSync(file, 'utf8')));
  return lists;
}

// ---- reading the guide ------------------------------------------------------------------------------

const blank = (text) => text.replace(/[^\n]/g, ' ');

function sectionOf(guide) {
  const text = guide.replace(/\r\n?/g, '\n');
  const start = text.indexOf(`\n${SECTION_HEADING}\n`);
  if (start < 0) throw new Error(`the guide has no section "${SECTION_HEADING}"`);
  const from = start + 1;
  const next = text.indexOf('\n## ', from + SECTION_HEADING.length);
  return { text, from, to: next < 0 ? text.length : next };
}

/** The example names that the section's comments declare after "Example names:". */
export function extractExamples(guide) {
  const { text, from, to } = sectionOf(guide);
  const names = [];
  for (const comment of text.slice(from, to).matchAll(/<!--([\s\S]*?)-->/g)) {
    for (const m of comment[1].matchAll(/Example names:([\s\S]*?)(?:\n\s*\n|$)/g))
      names.push(...m[1].split(',').map(normalise).filter(Boolean));
  }
  return names;
}

/**
 * The marked texts of the section: `{ kind: 'caption' | 'text', text, line }`. A menu path gives one
 * caption per part.
 */
export function extractQuotes(guide) {
  const { text, from, to } = sectionOf(guide);
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  let section = text.slice(from, to);
  section = section.replace(/<!--[\s\S]*?-->/g, blank).replace(/``[^`]*``/g, blank);
  const quotes = [];
  const marked = [];
  for (const m of section.matchAll(/`([^`]+)`/g)) {
    marked.push([m.index, m.index + m[0].length]);
    quotes.push({ kind: 'text', text: m[1], line: lineOf(from + m.index) });
  }
  const insideText = (index) => marked.some(([a, b]) => index >= a && index < b);
  for (const m of section.matchAll(/\*\*([\s\S]+?)\*\*/g)) {
    if (insideText(m.index)) continue;
    for (const part of normalise(m[1]).split(' > '))
      quotes.push({ kind: 'caption', text: part, line: lineOf(from + m.index) });
  }
  return quotes.sort((a, b) => a.line - b.line);
}

/** The quotes that are not a text of the code; `literals` as loadLiterals gives them. */
export function checkGuide(guide, literals) {
  const quotes = extractQuotes(guide);
  const matches = buildMatcher(literals, extractExamples(guide));
  return { quotes, failures: quotes.filter((q) => !matches(q.text)) };
}

// ---- command line -----------------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let guidePath = join(repo, 'docs', 'USER-GUIDE.md');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--guide' && args[i + 1]) guidePath = resolve(args[++i]);
    else {
      console.error('usage: node tools/check-guide-strings.mjs [--guide <file>]');
      process.exit(2);
    }
  }
  if (!existsSync(guidePath)) {
    console.error(`no such file: ${guidePath}`);
    process.exit(2);
  }
  const { quotes, failures } = checkGuide(readFileSync(guidePath, 'utf8'), loadLiterals(repo));
  for (const f of failures)
    console.error(`line ${f.line}: not a text of the code (${f.kind}): ${JSON.stringify(f.text)}`);
  const ok = quotes.length - failures.length;
  console.log(`${ok} of ${quotes.length} quoted texts of "${SECTION_HEADING.slice(3)}" are exactly the code's`);
  if (quotes.length < MIN_QUOTES) {
    console.error(`only ${quotes.length} marked texts found, fewer than ${MIN_QUOTES}: the marks were lost`);
    process.exit(1);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
