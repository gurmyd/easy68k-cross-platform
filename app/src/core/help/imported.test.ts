// The imported help (app/public/help, tools/import-help.mjs) against the code that uses it.
//
// Every reference is compared case-sensitively with the LIST of imported files (manifest.json, which
// the test first compares with the folder's real listing), never with a file-system existence check:
// a Windows file system would say yes to "OPTIONS.HTM", a web server says no.

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEYWORDS, UNREACHABLE_CONTEXTS } from './keywords';
import { ENTRY_PAGES } from './context';
import { flattenSitemap, parseLocal, parseSitemap } from './sitemap';
import { classifyLink } from './urls';
// @ts-expect-error -- plain JavaScript module without type declarations
import { pageRefusals } from '../../../../tools/import-help.mjs';

const HELP = new URL('../../../public/help/', import.meta.url);
const read = (path: string): Buffer => readFileSync(new URL(path.split('/').map(encodeURIComponent).join('/'), HELP));
const text = (path: string): string => new TextDecoder('utf-8', { fatal: true }).decode(read(path));

interface Manifest {
  blankTargetsAdded: number;
  rewrittenReferences: { pages: number; 'contents.hhc': number; 'index.hhk': number };
  missingTargets: { in: string; reference: string; target: string }[];
  files: string[];
}
const manifest = JSON.parse(text('manifest.json')) as Manifest;
const FILES = new Set(manifest.files);
const PAGES = manifest.files.filter((file) => /\.html?$/i.test(file));

function listing(folder = ''): string[] {
  return readdirSync(new URL(folder, HELP), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listing(`${folder}${entry.name}/`) : [`${folder}${entry.name}`]))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A reference as the page would resolve it: the target path, or null for an address outside the folder. */
function resolveReference(from: string, value: string): string | null {
  const link = classifyLink(from, value);
  if (link.kind === 'page' || link.kind === 'file') return link.target.page;
  return null;
}

const ATTRIBUTE = /\b(?:href|src|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;

/** Every reference of a page that names a file of the help folder (or a file that is not there). */
function referencesOf(page: string): string[] {
  const found: string[] = [];
  for (const tag of text(page).matchAll(/<[A-Za-z][^>]*>/g)) {
    for (const attribute of tag[0].matchAll(ATTRIBUTE)) {
      const value = attribute[1] ?? attribute[2] ?? attribute[3] ?? '';
      if (value === '' || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//'))
        continue;
      found.push(value);
    }
  }
  return found;
}

describe('the imported help folder', { timeout: 60_000 }, () => {
  it('has the list of files that the manifest records (code-unit order, nothing else)', () => {
    expect(listing().filter((file) => file !== 'manifest.json')).toEqual(manifest.files);
    expect([...manifest.files]).toEqual([...manifest.files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('keeps the third-party reference pages in a folder of their own, with attribution', () => {
    expect(FILES.has('Reference/ATTRIBUTION.txt')).toBe(true);
    expect(manifest.files.filter((file) => file.startsWith('Reference/')).length).toBeGreaterThan(90);
    // Nothing outside the folder is part of the reference guide: the pages that name it are the
    // original's own contents and keyword table, which the import does not touch.
    expect(manifest.files.filter((file) => /^68ks/i.test(file))).toEqual([]);
  });

  it('rewrote the references that differ in letter case (16 in pages, 23 in the sitemaps)', () => {
    expect(manifest.rewrittenReferences).toEqual({ pages: 16, 'contents.hhc': 20, 'index.hhk': 3 });
  });

  it('names every reference of every page with the exact case of an imported file', () => {
    const unresolved: string[] = [];
    for (const page of PAGES) {
      for (const value of referencesOf(page)) {
        const target = resolveReference(page, value);
        if (target !== null && !FILES.has(target)) unresolved.push(`${page} -> ${value} (${target})`);
      }
    }
    // The original's four references to files that do not exist (three here, one in index.hhk).
    expect(unresolved.sort()).toEqual([
      'GNU General Public License.htm -> ac-archive.css (ac-archive.css)',
      'Reference/68ks1.htm -> 68ks2d.htm (Reference/68ks2d.htm)',
      'file_operations.htm -> top (top)',
    ]);
  });

  it('reports exactly the four targets that do not exist', () => {
    expect(manifest.missingTargets.map((entry) => `${entry.in}: ${entry.target}`)).toEqual([
      'GNU General Public License.htm: ac-archive.css',
      'Reference/68ks1.htm: Reference/68ks2d.htm',
      'file_operations.htm: top',
      'index.hhk: ../Helpv1_4/main.htm',
    ]);
    for (const entry of manifest.missingTargets) expect(FILES.has(entry.target)).toBe(false);
  });

  it('is UTF-8 throughout, and every page says so', () => {
    for (const page of PAGES) {
      const html = text(page); // fatal decoder: throws on a byte that is not UTF-8
      expect(html, page).not.toMatch(/charset\s*=\s*(windows-1252|iso-8859-1)/i);
      expect(html.slice(0, 1024), page).toMatch(/<meta\b[^>]*charset\s*=\s*utf-8/i);
      expect(html, page).not.toMatch(/[\u0080-\u009f�]/);
    }
    expect(text('credits.htm')).toContain('Jimmy Mårdell');
    expect([...text('fileio.htm')].filter((char) => char === ' ').length).toBe(133);
    expect(read('credits.htm').includes(0xe5)).toBe(false); // the Windows-1252 byte of å is gone
  });

  it('keeps the original line ends and content (CR LF, tags, attributes)', () => {
    const credits = text('credits.htm');
    expect(credits.split('\n').length).toBeGreaterThan(20);
    expect(credits.split('\n').every((line, index, lines) => index === lines.length - 1 || line.endsWith('\r'))).toBe(
      true,
    );
    expect(credits).toContain('<base target="_self">');
    expect(credits).toContain('<a href="GNU%20General%20Public%20License.htm">');
  });

  it('opens every link that leaves the help (web address, PDF) in a new tab by its own target', () => {
    let leaving = 0;
    for (const page of PAGES) {
      for (const tag of text(page).matchAll(/<a\b[^>]*>/gi)) {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i.exec(tag[0]);
        const value = href?.[1] ?? href?.[2] ?? href?.[3] ?? '';
        const target = /^https?:/i.test(value) ? value : resolveReference(page, value);
        const leaves = /^https?:/i.test(value) || (target !== null && FILES.has(target) && !/\.html?$/i.test(target));
        if (!leaves) continue;
        leaving++;
        expect(tag[0], page).toMatch(/\starget\s*=\s*["']?_blank/i);
      }
    }
    expect(leaving).toBeGreaterThanOrEqual(7);
    expect(manifest.blankTargetsAdded).toBe(4); // the original has the other ones
  });

  it('starts the head of every page with the policy script-src none, and no page holds a script (erratum H1 11)', () => {
    const POLICY = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`;
    // Every .htm and .html file below the folder, from the folder's own listing (not the manifest).
    const pages = listing().filter((file) => /\.html?$/i.test(file));
    expect(pages).toEqual(PAGES);
    expect(pages.length).toBe(161);
    for (const page of pages) {
      const html = text(page);
      // What may come before the first element of the head: the doctype, comments, white space and
      // the html and head start tags (in a page without a head tag the parser opens the head at the
      // first element; nothing that would start the body may come first).
      const lead = /^(?:\s+|<!--[\s\S]*?-->|<!doctype\b[^>]*>|<html\b[^>]*>|<head\b[^>]*>)*/i.exec(html)?.[0] ?? '';
      expect(html.slice(lead.length, lead.length + POLICY.length), page).toBe(POLICY);
      expect(html.split(POLICY).length - 1, page).toBe(1);
      // None of the three, with character references read; comments are read too (a browser also
      // ends a comment at "--!>"). Each tag is taken from its "<" twice: up to the first ">", and
      // up to the first ">" outside quotes. An attribute name starts after white space, a slash or
      // a quote (gate I3 round 4: <img src="x"/onerror=...>, <body/onload=...>, <a href="x"onclick=...>).
      expect(html, page).not.toMatch(/<script\b/i);
      const plain = /<[^>]*>?/y;
      const quoted = /<(?:[^>"']|"[^"]*"|'[^']*')*>?/y;
      const read = (pattern: RegExp, at: number) => {
        pattern.lastIndex = at;
        return pattern.exec(html)?.[0] ?? '';
      };
      const starts = [...html.matchAll(/<(?=\/?[A-Za-z])/g)].map((m) => m.index);
      for (const tag of starts.flatMap((at) => [read(plain, at), read(quoted, at)])) {
        expect(tag, page).not.toMatch(/[\s/"']on[a-z]+\s*=/i);
        const decoded = tag
          .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
          .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
          .replace(/[\t\n\r]/g, '');
        expect(decoded, page).not.toMatch(/javascript:/i);
      }
    }
  });

  it('gives the import no reason to refuse a page: no link leaves the help folder for the site', () => {
    for (const page of PAGES) expect(pageRefusals(page, text(page)), page).toEqual([]);
  });

  it('contains no script and nothing that fetches from another address', () => {
    for (const page of PAGES) {
      const html = text(page);
      expect(html, page).not.toMatch(
        /<(script|iframe|object|embed|svg|math|form|frame|frameset|applet)\b|\ssrcdoc\s*=/i,
      );
      // A base element only as <base target="_self">, and no meta refresh.
      for (const base of html.matchAll(/<base\b[^>]*>/gi)) expect(base[0], page).toBe('<base target="_self">');
      expect(html, page).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);
      for (const tag of html.matchAll(/<[A-Za-z][^>]*>/g)) expect(tag[0], page).not.toMatch(/[\s/"']on[a-z]+\s*=/i);
    }
  });
});

describe('the sitemap files', { timeout: 60_000 }, () => {
  const contents = parseSitemap(text('contents.hhc'));
  const index = parseSitemap(text('index.hhk'));

  it('give a contents tree equal to contents.hhc (names and nesting read a second way)', () => {
    // Second reading: line by line, the depth from the <UL> and </UL> lines and the title from the
    // first Name parameter of each entry.
    const expected: { name: string; depth: number; page: string | null }[] = [];
    let depth = -1;
    let pending: { name: string; page: string | null } | null = null;
    const flush = () => {
      if (pending) expected.push({ ...pending, depth });
      pending = null;
    };
    for (const line of text('contents.hhc').split(/\r?\n/)) {
      if (/<UL>/i.test(line)) {
        depth++;
        // an entry that opens a list is one level up
        if (pending) {
          expected.push({ ...pending, depth: depth - 1 });
          pending = null;
        }
      } else if (/<\/UL>/i.test(line)) {
        flush();
        depth--;
      } else if (/<LI>/i.test(line)) {
        flush();
        pending = { name: '', page: null };
      } else {
        const name = /name="Name"\s+value="([^"]*)"/i.exec(line);
        if (name && pending && pending.name === '')
          pending.name = name[1]!
            .replace(/&amp;/g, '&')
            .replace(/&aring;/g, 'å')
            .replace(/&reg;/g, '®');
        const local = /name="Local"\s+value="([^"]*)"/i.exec(line);
        if (local && pending) pending.page = parseLocal(local[1]!).page;
      }
    }
    flush();
    const actual = flattenSitemap(contents).map(({ node, depth: d }) => ({
      name: node.name,
      depth: d,
      page: node.target?.page ?? null,
    }));
    expect(actual).toEqual(expected);
    expect(actual.length).toBe(84);
  });

  it('has the eleven books of editor-ui §15.1 at the top', () => {
    expect(contents.map((node) => node.name)).toEqual([
      'Introduction',
      'Editor/Assembler Operation',
      'Assembler Commands',
      'Simulator Operation',
      'Simulator I/O',
      'EASyBIN Binary/S-Record File Utility',
      'ASCII Chart',
      '68000 Quick Reference',
      'GNU General Public License',
      'Credits',
      "Jimmy Mårdell's 68000 Reference Guide",
    ]);
  });

  it('lead only to imported pages, except the one entry the original has broken', () => {
    const entries = [...flattenSitemap(contents), ...flattenSitemap(index)].filter(({ node }) => node.target !== null);
    expect(entries.length).toBe(74 + 152);
    const unknown = entries.filter(({ node }) => !FILES.has(node.target!.page)).map(({ node }) => node.target!.page);
    expect(unknown).toEqual(['../Helpv1_4/main.htm']);
  });
});

describe('the keyword table against the imported pages', { timeout: 60_000 }, () => {
  it('has 197 keywords, each resolving to an imported page', () => {
    expect(KEYWORDS.length).toBe(197);
    for (const [keyword, , page] of KEYWORDS) expect(FILES.has(page), `${keyword}: ${page}`).toBe(true);
    for (const [context, page] of UNREACHABLE_CONTEXTS) expect(FILES.has(page), `${context}: ${page}`).toBe(true);
  });

  it('opens an imported page from every entry point', () => {
    for (const page of Object.values(ENTRY_PAGES)) expect(FILES.has(page), page).toBe(true);
  });
});
