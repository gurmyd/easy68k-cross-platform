#!/usr/bin/env node
// `npm run import:help` (ARCHITECTURE.md 2.7, 9.2 work package H1): imports the HTML Help sources of
// EASy68K v5.16.1 into app/public/help/, where the Help panel serves them in a sandboxed frame.
//
//     node tools/import-help.mjs [--source <folder>] [--out <folder>] [--differences <file>]
//
// Source: reference/src-help/EASy68K_Helpv5.16.1 (git-ignored reference material, read only).
//
// What it does to the original, and nothing else:
//
//   1. Encoding. The pages are Windows-1252 HTML (most declare iso-8859-1, which browsers read as
//      Windows-1252 as well; three declare nothing). Every page, contents.hhc and index.hhk are
//      converted to UTF-8 and every page declares `charset=utf-8` (an existing declaration is
//      changed, a missing one is added in the first bytes). Line ends, spelling, tags and
//      attribute order stay as they are.
//   2. Letter case. Windows does not care about the case of a file name; a web server does. Every
//      href, src and background in a page, and every Local value in contents.hhc and index.hhk, is
//      rewritten to the exact letter case of the file it names (the original has 16 such
//      references in pages and 23 in the two sitemap files). Spaces written as %20 stay %20.
//      Fragments are kept. A reference whose target does not exist is left alone and reported (the
//      original has four: the page 68ks2d.htm, ac-archive.css, a bare "top" and the sitemap entry
//      ..\Helpv1_4\main.htm).
//      The four links of the original that leave the help (three web addresses and the Quick
//      Reference PDF) and have no target get target="_blank" (see fixPage).
//   2a. No script. Every page's head starts with HELP_PAGE_POLICY, a Content-Security-Policy
//      meta element with script-src 'none' (erratum H1 11: in WebKit the Help frame has
//      allow-scripts). A page that, after these changes, holds a script element, an inline event
//      handler attribute, a javascript: address, a refresh, or a link to an address of the site
//      outside the help folder (the application's own page, say) is refused: the import stops
//      with exit code 1 and names the page (pageRefusals). Tags are read as the HTML tokenizer
//      reads them, and svg, math, iframe, object, embed, form, base (other than target="_self"),
//      srcdoc, data: addresses and escaped separators are refused too (pageRefusals lists them).
//      Links to other sites stay as they are; each must open in a new tab (target="_blank").
//   3. Files. Everything the pages use is copied byte for byte (images, style sheets, the Quick
//      Reference PDF). The build files of the help project (help.chm, help.hhp, ez68k.*, compiler
//      logs, Thumbs.db, the folder of program icons) are not copied; no page refers to them
//      (checked: a reference to a file that is left out stops the import).
//
// The 68000 reference pages (folder Reference) are third-party material (decision O-5): they stay
// in their own folder, with an attribution file, so that removing them is one deletion.
//
// Added files (all generated here, none from the original):
//   Port/differences.htm   docs/DIFFERENCES.md rendered as a help page (Help > Differences from
//                          EASy68K); a short note while that document does not exist yet
//   Reference/ATTRIBUTION.txt, README.txt, manifest.json
//
// manifest.json lists every file of the folder (sorted by code unit) and what the import found:
// the references it rewrote and the targets that do not exist. Tests compare every reference
// case-sensitively against that list.
//
// Running the script twice gives identical files, on Windows, macOS and Linux: the output is
// emptied first, directory listings are sorted by code unit (never by locale), file names keep
// the case of the source, and nothing in the output depends on the time or the machine.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Code-unit order: the same on every platform, unlike localeCompare. */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Folders and files of the help project that are not part of the help. Paths relative to the source. */
const EXCLUDED_FOLDERS = ['EASy68K Icons'];
const EXCLUDED_FILES =
  /^(help\.chm|help\.chw|help\.hhp|ez68k\.(ali|h|txt|xls)|Instructions for HTML help\.txt)$|(^|\/)(Thumbs\.db|[^/]*\.log)$/i;
const TEXT_PAGE = /\.html?$/i;
const SITEMAP = /^(contents\.hhc|index\.hhk)$/;

function parseArgs(argv) {
  const options = {
    source: join(repo, 'reference', 'src-help', 'EASy68K_Helpv5.16.1'),
    out: join(repo, 'app', 'public', 'help'),
    differences: join(repo, 'docs', 'DIFFERENCES.md'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') options.source = resolve(argv[++i] ?? '');
    else if (arg === '--out') options.out = resolve(argv[++i] ?? '');
    else if (arg === '--differences') options.differences = resolve(argv[++i] ?? '');
    else {
      console.error('usage: node tools/import-help.mjs [--source <folder>] [--out <folder>] [--differences <file>]');
      process.exit(arg === '--help' || arg === '-h' ? 0 : 2);
    }
  }
  return options;
}

/** Every file below `root`, as '/'-separated paths relative to it, sorted by code unit. */
function listFiles(root) {
  const found = [];
  const walk = (relative) => {
    const entries = readdirSync(join(root, relative), { withFileTypes: true });
    entries.sort((a, b) => byCodeUnit(a.name, b.name));
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk('');
  return found.sort(byCodeUnit);
}

/** Directory name -> Map(lower-case name -> actual names): what a reference is resolved against. */
function buildIndex(files) {
  const folders = new Map();
  const add = (folder, name) => {
    let names = folders.get(folder);
    if (!names) folders.set(folder, (names = new Map()));
    const key = name.toLowerCase();
    const list = names.get(key) ?? [];
    if (!list.includes(name)) list.push(name);
    names.set(key, list);
  };
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i++) add(parts.slice(0, i).join('/'), parts[i]);
  }
  for (const names of folders.values()) {
    for (const [key, list] of names) {
      if (list.length > 1) throw new Error(`Two names differ only in letter case: ${list.join(', ')} (${key})`);
    }
  }
  return folders;
}

/**
 * Looks a reference up as a case-insensitive file system would, and says how to spell it.
 * `from` is the folder of the referring file ('' for the help root); `value` the reference as
 * written. Returns null when the reference is not a file reference (an address with a scheme, a
 * fragment of the page itself), else { value, rewritten, missing }: `value` is the reference with
 * the letter case fixed, `missing` the target path when it does not exist.
 */
export function fixReference(index, from, value) {
  if (value === '' || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//'))
    return null;
  const hash = value.indexOf('#');
  const path = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? '' : value.slice(hash);
  const pieces = path.split(/([\\/])/); // names and the separators between them, kept as written
  const here = from === '' ? [] : from.split('/');
  let rewritten = false;
  for (let i = 0; i < pieces.length; i += 2) {
    const piece = pieces[i];
    if (piece === '' || piece === '.') continue;
    if (piece === '..') {
      if (here.length === 0) return { value, rewritten: false, missing: pieces.slice(i).join('').replace(/\\/g, '/') };
      here.pop();
      continue;
    }
    let name;
    try {
      name = decodeURIComponent(piece);
    } catch {
      name = piece;
    }
    const known = index.get(here.join('/'))?.get(name.toLowerCase());
    if (!known)
      return {
        value,
        rewritten,
        missing:
          [...here, name].join('/') +
          pieces
            .slice(i + 1)
            .join('')
            .replace(/\\/g, '/'),
      };
    const actual = known[0];
    if (actual !== name) {
      pieces[i] = piece.includes('%') ? actual.replace(/ /g, '%20') : actual;
      rewritten = true;
    }
    here.push(actual);
  }
  return { value: pieces.join('') + fragment, rewritten, missing: null };
}

/** Converts Windows-1252 bytes to text; fails on the five bytes that have no character. */
function decodeWindows1252(bytes, file) {
  const text = new TextDecoder('windows-1252').decode(bytes);
  if (/[\u0080-\u009f]/.test(text)) throw new Error(`${file}: a byte without a Windows-1252 character`);
  return text;
}

const META_CHARSET = '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">';

/** Declares UTF-8 in a page: changes the existing declaration, else adds one in the first bytes. */
export function declareUtf8(html) {
  const declaration = /(<meta\b[^>]*\bcharset\s*=\s*)([\w-]+)/i;
  if (declaration.test(html)) return html.replace(declaration, '$1utf-8');
  const head = /<head\b[^>]*>/i.exec(html);
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  if (head)
    return `${html.slice(0, head.index + head[0].length)}${eol}${META_CHARSET}${html.slice(head.index + head[0].length)}`;
  return `${META_CHARSET}${eol}${html}`;
}

/**
 * Rewrites href, src and background attributes of a page (letter case, see fixReference). A link
 * that leaves the help pages (a web address, or a file that is not a page, such as the Quick
 * Reference PDF) and has no target of its own gets target="_blank": the Help panel's frame is
 * sandboxed, and a PDF or another site cannot be shown in it, but a new tab can (the sandbox
 * allows popups). The original's other web links already have it.
 */
function fixPage(html, file, index, note) {
  const from = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  return html.replace(/<[A-Za-z][^>]*>/g, (tag) => {
    let leaves = false;
    const fixed = tag.replace(
      /(\b(?:href|src|background)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>"']+))/gi,
      (whole, prefix, quoted, double, single, bare) => {
        const value = double ?? single ?? bare;
        const isLink = /^<a\b/i.test(tag) && /^href/i.test(prefix);
        if (isLink && /^https?:/i.test(value)) leaves = true;
        const result = fixReference(index, from, value);
        if (!result) return whole;
        if (result.missing !== null) note.missing.push({ from: file, value, target: result.missing });
        else if (isLink && !/\.html?$/i.test(result.value.replace(/#.*$/, ''))) leaves = true;
        if (!result.rewritten) return whole;
        note.rewritten++;
        const quote = double !== undefined ? '"' : single !== undefined ? "'" : '';
        return `${prefix}${quote}${result.value}${quote}`;
      },
    );
    if (leaves && !/\starget\s*=/i.test(tag)) {
      note.targets++;
      return fixed.replace(/^<a\b/i, (name) => `${name} target="_blank"`);
    }
    return fixed;
  });
}

/** Rewrites the Local values of a sitemap (contents.hhc, index.hhk). */
function fixSitemap(text, index, note) {
  return text.replace(/(<param\s+name="Local"\s+value=")([^"]*)(")/gi, (whole, before, value, after) => {
    const result = fixReference(index, '', value);
    if (!result) return whole;
    if (result.missing !== null) note.missing.push({ from: '', value, target: result.missing });
    if (!result.rewritten) return whole;
    note.rewritten++;
    return `${before}${result.value}${after}`;
  });
}

/* ------------------------------------------------------------------ no script in a help page */

/**
 * The policy every page's head starts with (erratum H1 11, ARCHITECTURE.md 7.6): in WebKit the Help
 * frame's sandbox has allow-scripts (WebKit sends the navigations of a frame without it to no
 * service worker, so Help could not be offline), and this policy keeps every script out of the
 * page all the same: no script element, no event handler attribute and no javascript: address runs.
 */
export const HELP_PAGE_POLICY = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`;

/**
 * Puts HELP_PAGE_POLICY in front of everything else in the page's head: right after `<head>`, or,
 * in a page without a head tag (two of the original's), after the doctype, comments and `<html>`
 * that may come first, where the parser opens the head itself. Nothing else changes.
 */
export function insertPolicy(html) {
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const head = /<head\b[^>]*>/i.exec(html);
  let at;
  if (head) at = head.index + head[0].length;
  else {
    const lead = /^(?:\uFEFF)?(?:\s+|<!--[\s\S]*?-->|<!doctype\b[^>]*>|<html\b[^>]*>)*/i.exec(html);
    at = lead ? lead[0].length : 0;
  }
  const before = html.slice(0, at);
  const after = html.slice(at);
  // After a tag on the same line, the policy gets a line of its own; at the very start it is the first line.
  return at === 0 ? `${HELP_PAGE_POLICY}${eol}${after}` : `${before}${eol}${HELP_PAGE_POLICY}${after}`;
}

/**
 * The named character references this script reads (the ones an address could be spelt with:
 * punctuation, separators, white space). A browser knows over two thousand; an address attribute
 * that holds any other one cannot be judged here and is refused (pageRefusals).
 */
const NAMED_REFERENCES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  semi: ';',
  comma: ',',
  period: '.',
  sol: '/',
  bsol: '\\',
  percnt: '%',
  num: '#',
  quest: '?',
  excl: '!',
  equals: '=',
  plus: '+',
  commat: '@',
  lowbar: '_',
  lpar: '(',
  rpar: ')',
  tab: '\t',
  newline: '\n',
};

/**
 * Character references decoded in one pass, as the browser reads an attribute value: numeric
 * ones (a value the HTML parser replaces gives U+FFFD) and NAMED_REFERENCES, with or without the
 * semicolon. `unknown` is true when a named reference outside that list was met (it is left as
 * written).
 */
export function decodeCharacterReferences(text) {
  let unknown = false;
  const decoded = text.replace(/&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([A-Za-z][A-Za-z0-9]*));?/g, (whole, hex, dec, name) => {
    if (name !== undefined) {
      const value = NAMED_REFERENCES[name.toLowerCase()];
      if (value === undefined) unknown = true;
      return value ?? whole;
    }
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
    const replaced = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
    return replaced ? '�' : String.fromCodePoint(code);
  });
  return { text: decoded, unknown };
}

/** The HTML tokenizer's white space (a CR is a line feed after the input stream's preprocessing). */
const HTML_SPACE = /[\t\n\f\r ]/;

/**
 * The tag that starts at `html[start]` (a `<` followed by a letter, or by `/` and a letter), read
 * the way the HTML tokenizer reads it: the tag name, then attributes, each name ending at white
 * space, `/`, `>` or `=`, and a new name starting after white space, after a `/` and right after a
 * closing quote (`<a href="x"onclick=y>`, `<img src="x"/onerror=y>`, `<body/onload=y>`). Values
 * are quoted (up to the same quote, `>` included) or unquoted (up to white space or `>`, a `/` or a
 * quote included). Returns { name, endTag, attributes: [{ name, value }], text }, names in lower
 * case, values as written (null for an attribute without one). A tag that the input ends inside is
 * read up to the end (the browser drops it; reading it anyway only finds more).
 */
export function readTag(html, start) {
  let i = start + 1;
  const endTag = html[i] === '/';
  if (endTag) i++;
  let name = '';
  while (i < html.length && !HTML_SPACE.test(html[i]) && html[i] !== '/' && html[i] !== '>') name += html[i++];
  const attributes = [];
  let attribute = null;
  let quote = '';
  let state = 'before-name';
  for (; i < html.length; i++) {
    const c = html[i];
    if (state === 'before-name') {
      if (HTML_SPACE.test(c) || c === '/') continue;
      if (c === '>') break;
      attribute = { name: c.toLowerCase(), value: null };
      attributes.push(attribute);
      state = 'name';
    } else if (state === 'name') {
      if (c === '=') state = 'before-value';
      else if (HTML_SPACE.test(c) || c === '/' || c === '>') {
        state = 'after-name';
        i--;
      } else attribute.name += c.toLowerCase();
    } else if (state === 'after-name') {
      if (HTML_SPACE.test(c)) continue;
      if (c === '/') state = 'before-name';
      else if (c === '=') state = 'before-value';
      else if (c === '>') break;
      else {
        state = 'before-name';
        i--;
      }
    } else if (state === 'before-value') {
      if (HTML_SPACE.test(c)) continue;
      if (c === '>') break;
      attribute.value = '';
      if (c === '"' || c === "'") {
        quote = c;
        state = 'quoted';
      } else {
        state = 'unquoted';
        i--;
      }
    } else if (state === 'quoted') {
      if (c === quote) state = 'after-quoted';
      else attribute.value += c;
    } else if (state === 'unquoted') {
      if (HTML_SPACE.test(c)) state = 'before-name';
      else if (c === '>') break;
      else attribute.value += c;
    } else {
      // after a quoted value: white space, '/' and anything else start the next name
      if (c === '>') break;
      state = 'before-name';
      if (!HTML_SPACE.test(c) && c !== '/') i--;
    }
  }
  return { name: name.toLowerCase(), endTag, attributes, text: html.slice(start, Math.min(i + 1, html.length)) };
}

/**
 * Every tag of a page: one for every `<` followed by a letter or by `/` and a letter, wherever it
 * stands - in a comment, in the text of a style or title element, inside an attribute value - each
 * read on its own from its `<` (readTag). The browser reads only some of these as tags (it ends a
 * comment at `-->` and also at `--!>`, and reads no markup in a style element); reading all of
 * them finds every tag the browser reads, whatever its context, and possibly more.
 */
function tagsOf(html) {
  const tags = [];
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i + 1)) {
    if (/^<\/?[A-Za-z]/.test(html.slice(i, i + 3))) tags.push(readTag(html, i));
  }
  return tags;
}

/** Elements that run script, show another document, send a form or carry a foreign namespace. */
const REFUSED_ELEMENTS = new Set([
  'script',
  'svg',
  'math',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'fencedframe',
  'form',
  'isindex',
]);

/** http-equiv values a page may have: the declarations of type, language and policy. */
const ALLOWED_HTTP_EQUIV = new Set(['content-type', 'content-language', 'content-security-policy']);

/** The attributes that name an address (the URL attributes of HTML, and the old ones). */
const ADDRESS_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'imagesrcset',
  'background',
  'action',
  'formaction',
  'data',
  'poster',
  'lowsrc',
  'dynsrc',
  'longdesc',
  'cite',
  'ping',
  'manifest',
  'codebase',
  'archive',
  'classid',
  'usemap',
  'icon',
  'profile',
  'itemid',
  'xlink:href',
  'xml:base',
]);

/** The addresses an address attribute names: one, or a list for srcset, ping and archive. */
function addressesOf(name, value) {
  if (name === 'srcset' || name === 'imagesrcset')
    return value
      .split(',')
      .map((candidate) => candidate.trim().split(/[\t\n\f\r ]+/)[0] ?? '')
      .filter((address) => address !== '');
  if (name === 'ping' || name === 'archive') return value.split(/[\t\n\f\r ,]+/).filter((address) => address !== '');
  return [value];
}

/** Schemes of addresses on other sites (they open in a new tab, as they always did). */
const OTHER_SITE = /^(https?|mailto|ftp|news):/i;

/**
 * Where an address of a help page points, for the frame's rule (erratum H1 11): 'help' (a file of
 * the help folder, or a fragment), 'other-site' (a web or mail address, or a network-path
 * reference), 'outside' (an address of this site outside the help folder: the application, a file of
 * the build) or 'scheme' (javascript:, data:, blob:, file: and any other scheme).
 * `file` is the page, relative to the help folder.
 */
export function addressKind(file, value) {
  // As the URL parser reads it: tabs and line ends removed, C0 controls and spaces trimmed at the ends.
  const address = decodeCharacterReferences(value)
    .text.replace(/[\t\n\r]/g, '')
    // eslint-disable-next-line no-control-regex -- the C0 controls are what the URL parser trims
    .replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
  if (address === '' || address.startsWith('#')) return 'help';
  if (/^[\\/]{2}/.test(address)) return 'other-site';
  // A special scheme without "//" after it ("https:../index.html"): the URL parser reads the rest
  // relative to the page when the page has the same scheme, so on this site it may name a file
  // outside the help folder. Judged by that reading; where it stays in the folder, the address may
  // still name another site (a page served with the other scheme), so it counts as one.
  const special = /^(https?|ftp|wss?):(?![\\/]{2})/i.exec(address);
  if (special) {
    const relative = addressKind(file, address.slice(special[0].length));
    return relative === 'help' ? 'other-site' : relative;
  }
  if (OTHER_SITE.test(address)) return 'other-site';
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) return 'scheme';
  // The path as a server may read it: a server that decodes %2F (GitHub Pages does) reads
  // "..%2Findex.html" as "../index.html". An escaped separator, dot or percent sign, an escape
  // that does not decode, or a control character: an address that leaves the folder as far as
  // this script can tell (gate I3 round 4).
  const path = address.replace(/[?#].*$/s, '');
  // eslint-disable-next-line no-control-regex -- a control character has no place in a help address
  if (/%(2f|5c|2e|25|00)/i.test(path) || /[\x00-\x1f\x7f]/.test(path)) return 'encoded';
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return 'encoded';
  }
  const folder = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/') + 1)}` : '';
  const page = new URL(folder.split('/').map(encodeURIComponent).join('/'), 'https://site.invalid/help/');
  const inHelp = (spelling) => {
    const url = new URL(spelling.replace(/\\/g, '/'), page);
    return url.origin === 'https://site.invalid' && url.pathname.startsWith('/help/');
  };
  // Both readings must stay in the folder: the address as written and as the server decodes it.
  return inHelp(path) && inHelp(decoded.split('/').map(encodeURIComponent).join('/')) ? 'help' : 'outside';
}

/** An event handler attribute's name (`onload`, `OnError`, ...). */
const HANDLER_NAME = /^on[a-z]/i;
/**
 * An event handler attribute however it is written, read more widely than the tokenizer: `on...=`
 * after white space, a slash or a quote, also where the tokenizer sees part of a value (so that
 * `<img src=x.gif/onerror=go()>`, an unquoted src a browser does not read as a handler, is refused
 * too: the import cannot tell what a page meant).
 */
const HANDLER_ANYWHERE = /[\s/"']on[a-z]+\s*=/i;

/**
 * What a page holds that the Help frame must never get (erratum H1 11; gate I3 round 4), after the
 * import's own changes. Every tag is read as the HTML tokenizer reads it, wherever it stands
 * (tagsOf, readTag), and refused for:
 *   - an element that runs script, shows another document, sends a form or carries a foreign
 *     namespace (REFUSED_ELEMENTS: script, svg, math, iframe, frame, object, embed, form, ...);
 *   - an event handler attribute (a name `on...`, after white space, a slash or a closing quote;
 *     HANDLER_ANYWHERE also outside the tokenizer's reading) and a srcdoc attribute;
 *   - a base element other than `<base target="_self">` (eight pages of the original have that);
 *   - a meta element whose http-equiv is not content-type, content-language or
 *     content-security-policy (a refresh above all);
 *   - `javascript:` or `vbscript:` anywhere in the tag, character references read;
 *   - an address (ADDRESS_ATTRIBUTES) with a scheme that is not a web or mail address (javascript:,
 *     data:, blob:, ...), with a named character reference the script cannot read, with an escaped
 *     separator, dot or percent sign, or of this site outside the help folder (addressKind);
 *   - a link (a, area) to another site that would open in the frame: it must have target="_blank".
 * Each finding names the tag. Empty for a page that may be imported.
 */
export function pageRefusals(file, html) {
  const found = [];
  const add = (text) => {
    if (!found.includes(text)) found.push(text);
  };
  for (const tag of tagsOf(html)) {
    const short = tag.text.length > 80 ? `${tag.text.slice(0, 77)}...` : tag.text;
    if (!tag.endTag && tag.name === 'script') add('a script element');
    else if (!tag.endTag && REFUSED_ELEMENTS.has(tag.name)) add(`a ${tag.name} element in ${short}`);
    const names = tag.attributes.map((attribute) => attribute.name);
    if (names.some((name) => HANDLER_NAME.test(name)) || HANDLER_ANYWHERE.test(tag.text))
      add(`an event handler attribute in ${short}`);
    if (names.includes('srcdoc')) add(`a srcdoc attribute in ${short}`);
    const value = (name) => decodeCharacterReferences(tag.attributes.find((a) => a.name === name)?.value ?? '').text;
    if (!tag.endTag && tag.name === 'base') {
      const onlySelf = names.length === 1 && names[0] === 'target' && value('target').trim().toLowerCase() === '_self';
      if (!onlySelf) add(`a base element other than <base target="_self"> in ${short}`);
    }
    if (!tag.endTag && tag.name === 'meta' && names.includes('http-equiv')) {
      const equiv = value('http-equiv').trim().toLowerCase();
      if (equiv === 'refresh') add(`a refresh in ${short}`);
      else if (!ALLOWED_HTTP_EQUIV.has(equiv)) add(`a meta element with http-equiv="${equiv}" in ${short}`);
    }
    // Anywhere in the tag (an address attribute, a style's url(), ...), character references read.
    const script = /(java|vb)script:/i.test(decodeCharacterReferences(tag.text).text.replace(/[\t\n\r]/g, ''));
    if (script) add(`a javascript: address in ${short}`);
    for (const attribute of tag.attributes) {
      if (!ADDRESS_ATTRIBUTES.has(attribute.name) || attribute.value === null) continue;
      if (decodeCharacterReferences(attribute.value).unknown) {
        add(`an address with a character reference the import cannot read in ${short}`);
        continue;
      }
      for (const address of addressesOf(attribute.name, decodeCharacterReferences(attribute.value).text)) {
        const kind = addressKind(file, address);
        if (kind === 'scheme') {
          if (!script) add(`an address with a scheme the frame may not show in ${short}`);
        } else if (kind === 'encoded') {
          add(`an address with an escaped slash, backslash, dot or percent sign in ${short}`);
        } else if (kind === 'outside') {
          add(`a link to an address of this site outside the help folder in ${short}`);
        } else if (kind === 'other-site' && attribute.name === 'href' && (tag.name === 'a' || tag.name === 'area')) {
          if (value('target').trim().toLowerCase() !== '_blank')
            add(`a link to another site that would open in the frame (no target="_blank") in ${short}`);
        }
      }
    }
  }
  return found;
}

/** Stops the import with the page's name when the page holds anything pageRefusals finds. */
function refuseUnsafe(file, html) {
  const found = pageRefusals(file, html);
  if (found.length > 0) {
    const error = new Error(`${file}: refused, the page holds ${found.join('; ')}`);
    error.refusedPage = file;
    throw error;
  }
  return html;
}

/* ------------------------------------------------------------------ generated pages */

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown: code, bold, italic, links. Everything else is text. */
function inline(text) {
  const codes = [];
  const mark = String.fromCharCode(0xe000); // a private-use character stands in for a code span
  let html = escapeHtml(text).replace(
    /`([^`]+)`/g,
    (_, code) => `${mark}${codes.push(`<code>${code}</code>`) - 1}${mark}`,
  );
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, target) =>
      /^(https?:|mailto:)/i.test(target) ? `<a href="${target}">${label}</a>` : label,
    );
  return html.replace(new RegExp(`${mark}(\\d+)${mark}`, 'g'), (_, n) => codes[Number(n)]);
}

/** A small Markdown renderer: headings, paragraphs, lists, code blocks, quotes, tables. */
export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlockStart = (line) => /^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s|>|\|)/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
    } else if (/^```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre class="sourcecode">${escapeHtml(body.join('\n'))}</pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = /^#+/.exec(line)[0].length;
      const cls = level === 1 ? 'heading' : 'subheading';
      out.push(`<h${level} class="${cls}">${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
      i++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i + 1]))
          item += ` ${lines[++i].trim()}`;
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>\n${items.join('\n')}\n</${ordered ? 'ol' : 'ul'}>`);
    } else if (/^\|/.test(line)) {
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(lines[i]);
      const cells = (row) =>
        row
          .replace(/^\||\|\s*$/g, '')
          .split('|')
          .map((cell) => cell.trim());
      const body = rows.filter((row) => !/^\|[\s:|-]+\|?\s*$/.test(row)).map(cells);
      const [head, ...rest] = body;
      out.push(
        `<table border="1" cellpadding="3" cellspacing="0">\n<tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>\n${rest
          .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('\n')}\n</table>`,
      );
    } else if (/^>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) quote.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
    } else {
      const paragraph = [];
      for (; i < lines.length && lines[i].trim() !== '' && (paragraph.length === 0 || !isBlockStart(lines[i])); i++)
        paragraph.push(lines[i].trim());
      out.push(`<p class="text">${inline(paragraph.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

function differencesPage(differencesFile) {
  let body;
  let title = 'Differences from EASy68K';
  if (existsSync(differencesFile)) {
    const markdown = readFileSync(differencesFile, 'utf8');
    const first = /^#\s+(.+)$/m.exec(markdown);
    if (first) title = first[1].replace(/[`*]/g, '');
    body = renderMarkdown(markdown);
  } else {
    body =
      '<h1 class="heading">Differences from EASy68K</h1>\n<p class="text">The list of differences between this port and EASy68K v5.16.1 ' +
      'is not part of this build yet (docs/DIFFERENCES.md did not exist when the help was imported).</p>';
  }
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    HELP_PAGE_POLICY,
    META_CHARSET,
    `<title>${escapeHtml(title)}</title>`,
    '<link href="../edit68k.css" rel="stylesheet" type="text/css">',
    '</head>',
    '<body class="text">',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const ATTRIBUTION = `The pages in this folder are the 68000 reference pages that come with the help of
EASy68K v5.16.1: the "68000 Reference Guide" by Jimmy Mardell (credited on the Credits page of the
help), which in turn describes the Motorola M68000 Family Programmer's Reference Manual. The
EASy68K distribution includes them under its general notice (the GNU General Public License,
page "GNU General Public License"); the pages themselves carry no licence text of their own.

They are third-party material and are kept in this folder alone so that they can be removed in
one step: delete the folder "Reference" (and its entries in contents.hhc and index.hhk). The
keyword table of the editor then falls back to the introduction page for the instruction names.

The files are the originals except for the conversion to UTF-8 and the letter case of file
references (see ../README.txt).
`;

const README = `The help of EASy68K v5.16.1 (HTML Help sources), imported by tools/import-help.mjs.

Do not edit these files: they are generated. Run "npm run import:help" to regenerate them (the
original sources are read from reference/src-help, which is not part of the repository).

Changes made to the originals (nothing else is changed):
  - pages, contents.hhc and index.hhk are converted from Windows-1252 to UTF-8, and each page
    declares charset=utf-8;
  - every href, src, background and Local value is spelled with the exact letter case of the file
    it names (Windows does not care, web servers do);
  - the build files of the help project and the program icons are left out;
  - four links get target="_blank" (excode.htm, quickStart.htm, GNU General Public License.htm,
    Quick Reference.htm: the three web addresses and the PDF), because the frame that shows the
    pages cannot open a PDF or another site itself.
  - every page starts its head with <meta http-equiv="Content-Security-Policy"
    content="script-src 'none'">, so that no script can run in it; the import refuses a page with
    a script, an event handler attribute, a javascript: address or a link to an address of the
    site outside this folder.

Added: EASy68KQuickRef.pdf (copied from the help project because Quick Reference.htm links to it),
Port/differences.htm (the port's list of differences, rendered from docs/DIFFERENCES.md),
Reference/ATTRIBUTION.txt, this file and manifest.json (the list of files and what the import
found: rewritten references and targets that do not exist in the original).

EASy68K is distributed under the GNU General Public License; see "GNU General Public License.htm".
`;

/* ------------------------------------------------------------------ the import */

export function importHelp({ source, out, differences }) {
  const all = listFiles(source);
  const included = all.filter((file) => {
    if (EXCLUDED_FOLDERS.some((folder) => file.startsWith(`${folder}/`))) return false;
    return !EXCLUDED_FILES.test(file);
  });
  const excluded = all.filter((file) => !included.includes(file));
  const generated = ['Port/differences.htm', 'README.txt', 'Reference/ATTRIBUTION.txt'];
  const index = buildIndex([...included, ...generated]);

  rmSync(out, { recursive: true, force: true });

  const pageNote = { rewritten: 0, targets: 0, missing: [] };
  const sitemapNote = { rewritten: 0, missing: [] };
  const sitemapNotes = {};
  for (const file of included) {
    const bytes = readFileSync(join(source, file));
    let output = bytes;
    if (TEXT_PAGE.test(file)) {
      const html = decodeWindows1252(bytes, file);
      output = Buffer.from(refuseUnsafe(file, insertPolicy(fixPage(declareUtf8(html), file, index, pageNote))), 'utf8');
    } else if (SITEMAP.test(file)) {
      const note = { rewritten: 0, missing: [] };
      const text = decodeWindows1252(bytes, file);
      output = Buffer.from(fixSitemap(text, index, note), 'utf8');
      sitemapNotes[file] = note;
      sitemapNote.rewritten += note.rewritten;
      sitemapNote.missing.push(...note.missing.map((entry) => ({ ...entry, from: file })));
    }
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), output);
  }
  // The reference of a page to a file that was left out would be a defect of this script.
  const leftOut = new Set(excluded.map((file) => file.toLowerCase()));
  for (const entry of [...pageNote.missing, ...sitemapNote.missing]) {
    if (leftOut.has(entry.target.toLowerCase()))
      throw new Error(`${entry.from}: refers to ${entry.target}, which is not imported`);
  }

  const extra = {
    'Port/differences.htm': differencesPage(differences),
    'README.txt': README,
    'Reference/ATTRIBUTION.txt': ATTRIBUTION,
  };
  for (const [file, text] of Object.entries(extra)) {
    if (TEXT_PAGE.test(file)) refuseUnsafe(file, text); // the rendered Differences page too
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), text.replace(/\r\n/g, '\n'));
  }

  const files = [...included, ...generated].sort(byCodeUnit);
  const missing = [...pageNote.missing, ...sitemapNote.missing].map((m) => ({
    in: m.from,
    reference: m.value,
    target: m.target,
  }));
  const manifest = {
    rewrittenReferences: {
      pages: pageNote.rewritten,
      'contents.hhc': sitemapNotes['contents.hhc']?.rewritten ?? 0,
      'index.hhk': sitemapNotes['index.hhk']?.rewritten ?? 0,
    },
    blankTargetsAdded: pageNote.targets,
    missingTargets: missing,
    files,
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    excluded,
    bytes: files.reduce((sum, file) => sum + (file === 'manifest.json' ? 0 : readFileSync(join(out, file)).length), 0),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  let imported;
  try {
    imported = importHelp(options);
  } catch (error) {
    // A refused page (erratum H1 11) or any other failure: the message names the file; exit 1.
    console.error(`import-help: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const { manifest, excluded } = imported;
  const r = manifest.rewrittenReferences;
  console.log(`import-help: ${manifest.files.length} files -> ${options.out}`);
  console.log(
    `  references rewritten to the letter case of their target: ${r.pages} in pages, ${r['contents.hhc']} in contents.hhc, ${r['index.hhk']} in index.hhk`,
  );
  console.log(`  not copied (${excluded.length}): ${excluded.join(', ')}`);
  console.log(`  targets that do not exist (${manifest.missingTargets.length}):`);
  for (const m of manifest.missingTargets) console.log(`    ${m.in}: "${m.reference}"`);
}
