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
//                  and values the quoted texts use as examples ("prog.X68", "demo").
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
// A TEMPLATE'S `${...}` STANDS ONLY FOR WHAT THE CODE PUTS THERE. The tool reads the expression and
// follows it through the code (any file of app/src, through its imports):
//   - a literal written in it (`${n === 1 ? 'file' : 'files'}`: "file" or "files"; the operands of a
//     comparison are not), or a template written in it;
//   - a local variable of the function (`const verb = copied ? 'Copied' : 'Moved'`) or a constant of
//     the file or of a file it imports (`${RESTORED_FOLDER}`): what it is given;
//   - a call of a function of the code (`${files(n)}`, `${formatSize(bytes)}`): what that function
//     returns; `.join(', ')` a list of such texts, `.map((x) => f(x))` what `f` returns;
//   - a parameter: a type of string literals (`side: BesideSide`) gives those strings; `number` a
//     number; any other type what the function's callers pass there (every call in its own file and
//     in the files that import it); a parameter that no call of the code fills, and a property of an
//     object (`item.name`), is a value from outside: one of the guide's example names (several joined
//     by "/" for a path) or a number;
//   - `.length`, `.toFixed(...)`, `Math.`..., arithmetic: a number.
// The same expression written twice in one template stands for the same text both times
// (`Export all of ${label} as ${label}.zip`). So `Moved 3 items to demo.` matches
// `${verb} ${count} items to ${target}.` because `verb` is 'Copied' or 'Moved', `count` a number and
// `target` a value from outside, and `Moves 3 items to demo.` or `Moved Trash to demo.` do not. A
// quote as a whole must match a literal, or a template with at least MIN_LITERAL letters and digits
// of its own. A wrong example name that is still in the list is not noticed: which name the
// application really shows (a whole path, or only the file's name) must be checked by a person.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A template needs this many letters and digits of its own to match a quote as a whole: one with
 * fewer (`${n} ${word}`, `${a}, ${b}`) is only a part of other texts.
 */
export const MIN_LITERAL = 2;
export const SECTION_HEADING = '## Beyond the original';
/** The section has well over this many marked texts; fewer means the marks were lost. */
export const MIN_QUOTES = 40;
/** How deep a wildcard may be another template whose wildcards are templates again. */
export const MAX_DEPTH = 6;
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

// ---- reading the code ------------------------------------------------------------------------------

/** Index after the string literal that starts at `i` (its quote), and its value. */
function readQuoted(src, i) {
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

/**
 * The template literal that starts at `i` (its backtick): segments, strings and `{ start, end }` for
 * each `${...}` (the expression's span in `src`). Templates inside an expression go to `found`.
 */
function readTemplate(src, i, found) {
  const segments = [''];
  i++;
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\') {
      const next = src[i + 1];
      segments[segments.length - 1] += next === 'n' ? '\n' : next;
      i += 2;
    } else if (src[i] === '$' && src[i + 1] === '{') {
      const start = i + 2;
      const end = skipExpression(src, start, found);
      segments.push({ start, end: end - 1 }, '');
      i = end;
    } else segments[segments.length - 1] += src[i++];
  }
  return { segments, end: i + 1 };
}

/** Index after the `}` that closes an expression starting at `i`; templates inside go to `found`. */
function skipExpression(src, i, found) {
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const { value, end } = readQuoted(src, i);
      found?.push({ segments: [value], start: i, end });
      i = end;
    } else if (c === '`') {
      const start = i;
      const { segments, end } = readTemplate(src, i, found);
      found?.push({ segments, start, end });
      i = end;
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
  }
  return i;
}

/**
 * Every string literal of a TypeScript source as `{ segments, start, end }`, `a + b` joined into
 * one. Segments are strings and `{ start, end }` for a `${...}`. The literals written inside a
 * template's `${...}` come too, each on its own.
 */
export function scanLiterals(src) {
  const items = []; // literal | '+' | 'other'
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
      const { value, end } = readQuoted(src, i);
      items.push({ segments: [value], start: i, end });
      i = end;
    } else if (c === '`') {
      const start = i;
      const { segments, end } = readTemplate(src, i, inner);
      items.push({ segments, start, end });
      i = end;
    } else {
      if (c === '+' && src[i + 1] !== '+' && src[i - 1] !== '+' && src[i + 1] !== '=') items.push('+');
      else if (!/\s/.test(c)) items.push('other');
      i++;
    }
  }
  const out = [];
  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    if (typeof item === 'string') continue;
    let { segments } = item;
    const { start } = item;
    let { end } = item;
    while (items[k + 1] === '+' && items[k + 2] && typeof items[k + 2] !== 'string') {
      const next = items[k + 2];
      const last = segments.at(-1);
      const first = next.segments[0];
      segments =
        typeof last === 'string' && typeof first === 'string'
          ? [...segments.slice(0, -1), last + first, ...next.segments.slice(1)]
          : [...segments, ...next.segments];
      end = next.end;
      k += 2;
    }
    out.push({ segments, start, end });
  }
  return [...out, ...inner];
}

/** The literals of a source as segments, `null` for each `${...}` (kept for the tests). */
export function parseLiterals(src) {
  return scanLiterals(src).map((l) => l.segments.map((s) => (typeof s === 'string' ? s : null)));
}

// ---- following an expression through the code -------------------------------------------------------

const OPEN = { '(': ')', '[': ']', '{': '}' };

/** Positions in `src[s, e)` at nesting depth 0 (outside brackets and literals) for which `test` is true. */
function topLevel(src, s, e, test) {
  const hits = [];
  let depth = 0;
  for (let i = s; i < e; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      i = readQuoted(src, i).end - 1;
    } else if (c === '`') {
      i = readTemplate(src, i, null).end - 1;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < e && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? e : end + 1;
    } else if (c in OPEN) {
      if (depth === 0 && test(i)) hits.push(i);
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth < 0) break;
    } else if (depth === 0 && test(i)) hits.push(i);
  }
  return hits;
}

/** Index of the bracket that closes the one at `i`. */
function closing(src, i) {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === "'" || c === '"') k = readQuoted(src, k).end - 1;
    else if (c === '`') k = readTemplate(src, k, null).end - 1;
    else if (c in OPEN) depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return src.length;
}

/** The end of the statement or expression that starts at `s`: a `;`, `,` or closing bracket at depth 0. */
function statementEnd(src, s, stops = ';') {
  let depth = 0;
  for (let i = s; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') i = readQuoted(src, i).end - 1;
    else if (c === '`') i = readTemplate(src, i, null).end - 1;
    else if (c in OPEN) depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && stops.includes(c)) return i;
  }
  return src.length;
}

const NUMBER_TEXT = /^\d+(?:\.\d+)?$/;
const emptyDomain = () => ({ lits: new Set(), tpls: [], lists: [], number: false, name: false });
const ANY = () => ({ ...emptyDomain(), number: true, name: true });
const NUMBER_ONLY = () => ({ ...emptyDomain(), number: true });
const NAME_ONLY = () => ({ ...emptyDomain(), name: true });

function merge(into, from) {
  for (const l of from.lits) into.lits.add(l);
  into.tpls.push(...from.tpls);
  into.lists.push(...from.lists);
  into.number ||= from.number;
  into.name ||= from.name;
  return into;
}

/**
 * The code of app/src as far as the tool follows it: files read on demand through `read(path)`,
 * paths with "/" relative to app/src.
 */
export class Code {
  constructor(read, list) {
    this.read = read;
    this.list = list;
    this.cache = new Map();
    this.memo = new Map();
  }

  text(path) {
    if (!this.cache.has(path)) {
      let src;
      try {
        src = this.read(path);
      } catch {
        src = null;
      }
      this.cache.set(path, src === null ? null : src.replace(/\r\n?/g, '\n'));
    }
    return this.cache.get(path);
  }

  /** The file a relative import names, or null. */
  module(from, spec) {
    if (!spec.startsWith('.')) return null;
    const parts = from.split('/').slice(0, -1);
    for (const p of spec.split('/')) {
      if (p === '..') parts.pop();
      else if (p !== '.') parts.push(p);
    }
    const base = parts.join('/');
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`])
      if (/\.tsx?$/.test(cand) && this.text(cand) !== null) return cand;
    return null;
  }

  /** `local name -> { path, name }` of a file's imports and re-exports from another file. */
  imports(path) {
    const key = `imports|${path}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const map = new Map();
    const src = this.text(path) ?? '';
    for (const m of src.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const target = this.module(path, m[2]);
      if (!target) continue;
      for (const part of m[1].split(',')) {
        const names = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/);
        if (!names[0]) continue;
        map.set((names[1] ?? names[0]).trim(), { path: target, name: names[0].trim() });
      }
    }
    this.memo.set(key, map);
    return map;
  }

  /** The top-level declarations of a file: `{ name, start, end }`, each up to the next. */
  declarations(path) {
    const key = `decls|${path}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const src = this.text(path) ?? '';
    const starts = [
      ...src.matchAll(
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|type|interface|class|enum)\s+(\w+)/gm,
      ),
    ].map((m) => ({ name: m[1], start: m.index }));
    const decls = starts.map((d, k) => ({ ...d, end: k + 1 < starts.length ? starts[k + 1].start : src.length }));
    this.memo.set(key, decls);
    return decls;
  }

  /** The declaration that `name` means in `path` (its own, or one it imports): `{ path, decl }`. */
  find(path, name, seen = 0) {
    if (seen > 8) return null;
    const own = this.declarations(path).find((d) => d.name === name);
    if (own) return { path, decl: own };
    const imported = this.imports(path).get(name);
    return imported ? this.find(imported.path, imported.name, seen + 1) : null;
  }

  enclosing(path, pos) {
    return this.declarations(path).findLast((d) => d.start <= pos) ?? { name: '', start: 0, end: pos };
  }

  /** What the expression `src[s, e)` of `path` can put into a text: a domain. */
  resolve(path, s, e) {
    const key = `${path}|${s}|${e}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const result = emptyDomain();
    this.memo.set(key, result); // a cycle adds nothing
    merge(result, this.compute(path, s, e));
    return result;
  }

  compute(path, s, e) {
    const src = this.text(path);
    while (s < e && /\s/.test(src[s])) s++;
    while (e > s && /\s/.test(src[e - 1])) e--;
    let expr = src.slice(s, e);
    // Casts and non-null assertions.
    const cast = /\s+as\s+(?:const|[\w.<>[\]| ]+)$/.exec(expr) ?? /!$/.exec(expr);
    if (cast) return this.resolve(path, s, e - cast[0].length);
    if (expr.startsWith('(') && closing(src, s) === e - 1) return this.resolve(path, s + 1, e - 1);

    // A ternary: its two branches.
    const question = topLevel(
      src,
      s,
      e,
      (i) => src[i] === '?' && src[i + 1] !== '?' && src[i + 1] !== '.' && src[i - 1] !== '?',
    );
    if (question.length > 0) {
      const q = question[0];
      let nested = 0;
      const colon = topLevel(src, q + 1, e, (i) => {
        if (src[i] === '?' && src[i + 1] !== '?' && src[i + 1] !== '.' && src[i - 1] !== '?') nested++;
        else if (src[i] === ':') {
          if (nested === 0) return true;
          nested--;
        }
        return false;
      })[0];
      if (colon !== undefined) return merge(this.resolve(path, q + 1, colon), this.resolve(path, colon + 1, e));
    }
    // `a ?? b`, `a || b`.
    const alt = topLevel(
      src,
      s,
      e,
      (i) => (src[i] === '?' && src[i + 1] === '?') || (src[i] === '|' && src[i + 1] === '|'),
    );
    if (alt.length > 0) {
      const out = emptyDomain();
      let from = s;
      for (const at of alt) {
        merge(out, this.resolve(path, from, at));
        from = at + 2;
      }
      return merge(out, this.resolve(path, from, e));
    }
    // One literal.
    if (/^['"`]/.test(expr)) {
      const lits = scanLiterals(expr);
      if (lits.length > 0 && lits[0].start === 0 && lits[0].end === expr.length) {
        const out = emptyDomain();
        const segments = lits[0].segments.map((seg) =>
          typeof seg === 'string' ? seg : { start: seg.start + s, end: seg.end + s },
        );
        if (segments.every((seg) => typeof seg === 'string')) out.lits.add(normalise(segments.join(''), false));
        else out.tpls.push({ path, segments });
        return out;
      }
    }
    // Arithmetic: a number.
    if (topLevel(src, s, e, (i) => '+-*/%'.includes(src[i]) && !(src[i] === '/' && /[/*]/.test(src[i + 1]))).length > 0)
      return NUMBER_ONLY();
    // `x.join(sep)`: a list.
    const join = /\.join\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)$/.exec(expr);
    if (join) {
      const elements = this.resolve(path, s, e - join[0].length);
      return { ...emptyDomain(), lists: [{ domain: elements, sep: join[2] }] };
    }
    // `x.map((y) => f(y))`: what `f` gives.
    const map = /\.map\(\s*(?:\(\s*\w*\s*(?::[^)]*)?\)|\w+)\s*=>\s*/.exec(expr);
    if (
      map &&
      closing(src, s + map.index + 4) === e - 1 &&
      topLevel(src, s, e, (i) => i === s + map.index + 4).length > 0
    )
      return this.resolve(path, s + map.index + map[0].length, e - 1);
    // Numbers.
    if (/\.(?:length|size|toFixed\([^)]*\)|indexOf\([^)]*\))$|^(?:Math\.|Number\(|String\(|\d)/.test(expr))
      return NUMBER_ONLY();
    // Text helpers that keep the text.
    const keep = /\.(?:slice|trim|trimStart|trimEnd|toString)\([^()]*\)$/.exec(expr);
    if (keep) return this.resolve(path, s, e - keep[0].length);
    // An array literal: each of its elements.
    if (expr.startsWith('[') && closing(src, s) === e - 1) {
      const out = emptyDomain();
      let from = s + 1;
      for (const at of [...topLevel(src, s + 1, e - 1, (i) => src[i] === ','), e - 1]) {
        if (src.slice(from, at).trim() !== '') merge(out, this.resolve(path, from, at));
        from = at + 1;
      }
      return out;
    }
    // An element of a list.
    if (expr.endsWith(']')) {
      const open = topLevel(src, s, e, (i) => src[i] === '[').at(-1);
      if (open !== undefined && open > s) return this.resolve(path, s, open);
    }
    // A call of a function of the code.
    const call = /^(\w+)\s*\(/.exec(expr);
    if (call && closing(src, s + call[0].length - 1) === e - 1) {
      const found = this.find(path, call[1]);
      return found ? this.results(found.path, found.decl) : ANY();
    }
    // A member of a constant object of the code (`TAB_MENU.label`, `ANNOUNCE.reset`).
    const member = /^(\w+)\.(\w+)$/.exec(expr);
    if (member) {
      const found = this.find(path, member[1]);
      if (found) {
        const dsrc = this.text(found.path);
        const prop = new RegExp(String.raw`[{,]\s*['"]?${member[2]}['"]?\s*:\s*`, 'g');
        prop.lastIndex = found.decl.start;
        const m = prop.exec(dsrc);
        if (m && m.index < found.decl.end) {
          const from = m.index + m[0].length;
          return this.resolve(found.path, from, statementEnd(dsrc, from, ','));
        }
      }
      return ANY();
    }
    if (/^\w+$/.test(expr)) return this.identifier(path, s, expr);
    return ANY();
  }

  /** What an identifier at `pos` stands for: a local, a parameter, or a declaration of the code. */
  identifier(path, pos, name) {
    const src = this.text(path);
    const decl = this.enclosing(path, pos);
    const region = src.slice(decl.start, pos);
    // A local variable (or a destructured one) of the function, and later assignments to it.
    const out = emptyDomain();
    let local = false;
    const def = new RegExp(
      String.raw`\b(?:const|let|var)\s+(?:${name}\b\s*(?::[^=;]+)?|\[[^\]]*\b${name}\b[^\]]*\]\s*)=(?!=)|(?<![\w.$])${name}\s*=(?![=>])`,
      'g',
    );
    for (const m of region.matchAll(def)) {
      if (decl.start + m.index === decl.start && decl.name === name) continue;
      const from = decl.start + m.index + m[0].length;
      merge(out, this.resolve(path, from, statementEnd(src, from)));
      local = true;
    }
    if (local) return out;
    // A parameter.
    const param = this.parameter(path, decl, pos, name);
    if (param) return param;
    // A declaration of this file or of one it imports.
    const found = this.find(path, name);
    if (found && !(found.path === path && found.decl.start === decl.start)) {
      const dsrc = this.text(found.path);
      const head = new RegExp(String.raw`^[^=]*?\b${name}\b\s*(?::[^=]+)?=(?!=)`).exec(
        dsrc.slice(found.decl.start, found.decl.end),
      );
      if (head && /\b(?:const|let|var)\b/.test(head[0])) {
        const from = found.decl.start + head[0].length;
        return this.resolve(found.path, from, statementEnd(dsrc, from));
      }
    }
    return ANY();
  }

  /** The domain of a parameter `name` of the function around `pos`, or null if it is none. */
  parameter(path, decl, pos, name) {
    const src = this.text(path);
    const re = new RegExp(String.raw`[(,]\s*(?:readonly\s+)?${name}\b\s*\??\s*(?::\s*([^,)=]+?))?\s*(?=[,)=])`, 'g');
    // The nearest declaration with a type; an untyped one (`(item) =>`) only if there is none (a call
    // `f(name)` earlier in the function looks like an untyped parameter too).
    let hit = null;
    let untyped = null;
    for (const m of src.slice(decl.start, pos).matchAll(re)) {
      if (m[1]) hit = m;
      else untyped = m;
    }
    hit ??= untyped;
    if (!hit) return null;
    const type = (hit[1] ?? '').trim();
    const lits = [...type.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
    if (lits.length > 0) {
      const out = emptyDomain();
      for (const l of lits) out.lits.add(l);
      return out;
    }
    if (/^number\b/.test(type)) return NUMBER_ONLY();
    if (/^\w+$/.test(type) && !['string', 'boolean', 'unknown', 'any'].includes(type)) {
      const alias = this.find(path, type);
      if (alias) {
        const text = this.text(alias.path).slice(alias.decl.start, alias.decl.end);
        const body = /\btype\s+\w+\s*=\s*([^;]+);/.exec(text);
        const members = body ? [...body[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]) : [];
        if (members.length > 0 && body[1].replace(/'[^']*'|"[^"]*"|\|/g, '').trim() === '') {
          const out = emptyDomain();
          for (const l of members) out.lits.add(l);
          return out;
        }
      }
    }
    // The function's name and the parameter's place, then its callers.
    const at = decl.start + hit.index;
    const open = src.lastIndexOf('(', at + 1) === at ? at : this.openParen(src, decl.start, at);
    const index = topLevel(src, open + 1, at + 1, (i) => src[i] === ',').length;
    const before = src.slice(Math.max(decl.start, open - 200), open);
    const fname =
      /function\s+(\w+)\s*(?:<[^>]*>)?\s*$/.exec(before)?.[1] ??
      /\b(\w+)\s*(?::[^=()]*)?=\s*(?:async\s*)?$/.exec(before)?.[1] ??
      /\b(\w+)\s*:\s*(?:async\s*)?$/.exec(before)?.[1];
    const callers = fname ? this.callers(path, fname, index, decl, open) : null;
    if (callers) return callers;
    return type === '' ? ANY() : NAME_ONLY();
  }

  openParen(src, from, at) {
    let depth = 0;
    for (let i = at; i >= from; i--) {
      if (src[i] === ')') depth++;
      else if (src[i] === '(') {
        if (depth === 0) return i;
        depth--;
      }
    }
    return at;
  }

  /** What the calls of `fname` (declared in `path`) pass as argument `index`; null if none is found. */
  callers(path, fname, index, decl, open) {
    const files = [path];
    for (const other of this.list()) {
      if (other === path) continue;
      const imp = this.imports(other).get(fname);
      if (imp && imp.path === path) files.push(other);
    }
    const out = emptyDomain();
    let any = false;
    for (const file of files) {
      const src = this.text(file);
      if (!src) continue;
      for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.$])${fname}\s*\(`, 'g'))) {
        const paren = m.index + m[0].length - 1;
        if (file === path && paren === open) continue;
        if (/\bfunction\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
        const close = closing(src, paren);
        const commas = topLevel(src, paren + 1, close, (i) => src[i] === ',');
        const bounds = [paren, ...commas, close];
        if (index + 1 >= bounds.length) continue;
        merge(out, this.resolve(file, bounds[index] + 1, bounds[index + 1]));
        any = true;
      }
    }
    return any ? out : null;
  }

  /** What a function (or constant) of the code gives: its arrow body, its `return`s, its value. */
  results(path, decl) {
    const key = `results|${path}|${decl.start}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const out = emptyDomain();
    this.memo.set(key, out);
    const src = this.text(path);
    const text = src.slice(decl.start, decl.end);
    const fn = /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*(?:<[^>]*>)?\s*\(/.exec(text);
    let body = null;
    if (fn) {
      const close = closing(src, decl.start + fn[0].length - 1);
      body = src.indexOf('{', close);
    } else {
      const eq = /^[^=]*?=(?!=)\s*/.exec(text);
      if (!eq) return out;
      const from = decl.start + eq[0].length;
      if (src[from] === '(' || /^(?:async\s*)?\w+\s*=>/.test(src.slice(from, from + 40))) {
        const close = src[from] === '(' ? closing(src, from) : from;
        const arrow = src.indexOf('=>', close);
        let b = arrow + 2;
        while (/\s/.test(src[b])) b++;
        if (src[b] === '{') body = b;
        else merge(out, this.resolve(path, b, statementEnd(src, b)));
      } else merge(out, this.resolve(path, from, statementEnd(src, from)));
    }
    if (body !== null && body >= 0) {
      const end = closing(src, body);
      for (const m of src.slice(body, end).matchAll(/\breturn\s+/g)) {
        const from = body + m.index + m[0].length;
        merge(out, this.resolve(path, from, statementEnd(src, from)));
      }
    }
    return out;
  }
}

// ---- matching ----------------------------------------------------------------------------------------

const normalise = (text, trim = true) => {
  const t = text.replace(/\s+/g, ' ');
  return trim ? t.trim() : t;
};
/** A caption's access key: `&` before a character, `&&` is one `&`. */
const dropAccessKey = (text) => text.replace(/&(.)/g, (_, c) => c);

/**
 * `matches(text)` is true when the text is exactly a literal of `literals`, or matches one of its
 * templates by the rules at the head of this file. `literals` are `{ segments }` as loadLiterals
 * gives them: strings, and for a wildcard `{ domain }` (a domain of the code), or `null`, which
 * stands for a value from outside (an example name or a number). `examples` are the guide's example
 * names.
 */
export function buildMatcher(literals, examples = [], code = null) {
  const exact = new Set();
  const templates = [];
  const names = new Set(examples.map((n) => normalise(n)).filter(Boolean));
  const isName = (text) => text.split('/').every((part) => names.has(part));
  const prepared = new Map();

  function prepare(t) {
    if (prepared.has(t)) return prepared.get(t);
    const parts = t.segments.map((seg) => {
      if (typeof seg === 'string') return dropAccessKey(seg).replace(/\s+/g, ' ');
      if (seg === null) return { key: null, domain: ANY() };
      if (seg.domain) return { key: seg.key ?? null, domain: seg.domain };
      const src = code.text(t.path);
      return {
        key: src.slice(seg.start, seg.end).replace(/\s+/g, ''),
        domain: code.resolve(t.path, seg.start, seg.end),
      };
    });
    const own = t.segments
      .filter((s) => typeof s === 'string')
      .join('')
      .replace(/[^\p{L}\p{N}]/gu, '').length;
    const p = { parts, own };
    prepared.set(t, p);
    return p;
  }

  for (const lit of literals) {
    if (lit.segments.every((s) => typeof s === 'string')) {
      const text = normalise(dropAccessKey(lit.segments.join('')));
      if (text) exact.add(text);
    } else templates.push(lit);
  }

  /** Does `text` from `ti` on match `parts` from `si` on, with the wildcards bound so far? */
  function fits(parts, si, text, ti, depth, bound) {
    if (si === parts.length) return ti === text.length;
    const part = parts[si];
    if (typeof part === 'string') {
      return text.startsWith(part, ti) && fits(parts, si + 1, text, ti + part.length, depth, bound);
    }
    if (part.key !== null && bound.has(part.key)) {
      const value = bound.get(part.key);
      return text.startsWith(value, ti) && fits(parts, si + 1, text, ti + value.length, depth, bound);
    }
    const next = parts[si + 1];
    for (let end = ti; end <= text.length; end++) {
      if (typeof next === 'string' && next !== '' && !text.startsWith(next, end)) continue;
      if (next === undefined && end !== text.length) continue;
      const value = text.slice(ti, end);
      if (!inDomain(value, part.domain, depth)) continue;
      const more = part.key === null ? bound : new Map(bound).set(part.key, value);
      if (fits(parts, si + 1, text, end, depth, more)) return true;
    }
    return false;
  }

  function inDomain(value, domain, depth) {
    if (domain.number && NUMBER_TEXT.test(value)) return true;
    if (domain.name && value !== '' && isName(value)) return true;
    if (domain.lits.has(value) || [...domain.lits].some((l) => normalise(dropAccessKey(l), false) === value))
      return true;
    if (depth >= MAX_DEPTH) return false;
    if (domain.tpls.some((t) => fits(prepare(t).parts, 0, value, 0, depth + 1, new Map()))) return true;
    return domain.lists.some(
      ({ domain: element, sep }) =>
        value !== '' && value.split(sep).every((piece) => inDomain(piece, element, depth + 1)),
    );
  }

  return (raw) => {
    const text = normalise(raw);
    if (exact.has(text)) return true;
    return templates.some((t) => {
      const { parts, own } = prepare(t);
      if (own < MIN_LITERAL) return false;
      const trimmed = parts.map((p, k) =>
        typeof p !== 'string' ? p : k === 0 ? p.trimStart() : k === parts.length - 1 ? p.trimEnd() : p,
      );
      return fits(trimmed, 0, text, 0, 0, new Map());
    });
  };
}

/** The files whose literals the guide's texts are compared with, relative to app/src. */
export function sourceFiles(repoRoot) {
  // The toolbar table holds the caption and tool tips of version 1.1's `Arrange Panels` (P9.3), which
  // the layer rules keep out of a feature's texts.ts (commands may not import features; errata M3).
  const files = [...STAGE_TEXTS, 'commands/specs.ts', 'commands/tables/toolbars.ts'];
  for (const name of readdirSync(join(repoRoot, 'app', 'src', 'commands', 'tables')))
    if (/-menu\.ts$/.test(name)) files.push(`commands/tables/${name}`);
  return files.map((p) => join(repoRoot, 'app', 'src', ...p.split('/')));
}

/** Every non-test .ts and .tsx file below app/src, with "/" and relative to it. */
function appFiles(src) {
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, r);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) out.push(r);
    }
  };
  walk(src, '');
  return out;
}

/** A Code over files given in memory: `{ 'features/x/texts.ts': '...' }` (for the tests). */
export function codeFrom(files) {
  return new Code(
    (p) => (p in files ? files[p] : null),
    () => Object.keys(files),
  );
}

/** The literals of `paths` (relative to app/src) in `code`, as buildMatcher takes them. */
export function literalsOf(code, paths) {
  const lists = [];
  for (const path of paths) {
    const src = code.text(path);
    if (src === null) throw new Error(`no such file: app/src/${path}`);
    for (const lit of scanLiterals(src)) lists.push({ path, segments: lit.segments });
  }
  return lists;
}

/** The literals of the source files of the repository, and the code they are followed through. */
export function loadLiterals(repoRoot) {
  const src = join(repoRoot, 'app', 'src');
  let all = null;
  const code = new Code(
    (p) => readFileSync(join(src, ...p.split('/')), 'utf8'),
    () => (all ??= appFiles(src)),
  );
  const paths = sourceFiles(repoRoot).map((f) => f.slice(src.length + 1).replace(/\\/g, '/'));
  const lists = literalsOf(code, paths);
  lists.code = code;
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
      names.push(
        ...m[1]
          .split(',')
          .map((n) => normalise(n))
          .filter(Boolean),
      );
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
  const matches = buildMatcher(literals, extractExamples(guide), literals.code ?? null);
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
