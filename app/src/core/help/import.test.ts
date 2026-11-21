// The import script tools/import-help.mjs: its pure functions, and (where the original sources are
// present: they are git-ignored reference material) a complete import twice into scratch folders.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JavaScript module without type declarations
import { declareUtf8, fixReference, importHelp, renderMarkdown } from '../../../../tools/import-help.mjs';

type Reference = { value: string; rewritten: boolean; missing: string | null } | null;

/** The folder index the script builds: directory -> lower-case name -> actual names. */
function indexOf(files: string[]): Map<string, Map<string, string[]>> {
  const folders = new Map<string, Map<string, string[]>>();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      const names = folders.get(folder) ?? new Map<string, string[]>();
      names.set(parts[i]!.toLowerCase(), [parts[i]!]);
      folders.set(folder, names);
    }
  }
  return folders;
}

const INDEX = indexOf([
  'options.htm',
  'Quick Reference.htm',
  'Directives/org.htm',
  'Reference/68ks1.htm',
  'SIMHELP/IMAGES/Breakpt/ViewBreakptMenu.GIF',
  'StrucControl/ExSyntax.htm',
]);
const fix = (from: string, value: string) => fixReference(INDEX, from, value) as Reference;

describe('fixReference', () => {
  it('leaves a reference with the right case alone', () => {
    expect(fix('', 'options.htm')).toEqual({ value: 'options.htm', rewritten: false, missing: null });
    expect(fix('Directives', '../Options.htm')).toEqual({ value: '../options.htm', rewritten: true, missing: null });
  });

  it('spells every segment as the file system spells it', () => {
    expect(fix('SIMHELP', 'images/Breakpt/viewbreakptmenu.gif')).toEqual({
      value: 'IMAGES/Breakpt/ViewBreakptMenu.GIF',
      rewritten: true,
      missing: null,
    });
    expect(fix('StrucControl', 'exsyntax.htm#top')).toEqual({
      value: 'ExSyntax.htm#top',
      rewritten: true,
      missing: null,
    });
    expect(fix('', 'Directives\\ORG.HTM')).toEqual({ value: 'Directives\\org.htm', rewritten: true, missing: null });
  });

  it('keeps the way spaces are written', () => {
    expect(fix('', 'quick%20reference.htm')?.value).toBe('Quick%20Reference.htm');
    expect(fix('', 'quick reference.htm')?.value).toBe('Quick Reference.htm');
  });

  it('reports a target that does not exist and changes nothing', () => {
    expect(fix('Reference', '68ks2d.htm')).toEqual({
      value: '68ks2d.htm',
      rewritten: false,
      missing: 'Reference/68ks2d.htm',
    });
    expect(fix('', '..\\Helpv1_4\\main.htm')?.missing).toBe('../Helpv1_4/main.htm');
    expect(fix('', 'top')?.missing).toBe('top');
  });

  it('is not a file reference: addresses with a scheme, fragments of the page itself', () => {
    expect(fix('', 'http://www.easy68k.com')).toBeNull();
    expect(fix('', 'mailto:a@b.c')).toBeNull();
    expect(fix('', '#top')).toBeNull();
    expect(fix('', '')).toBeNull();
  });
});

describe('declareUtf8', () => {
  it('changes the declaration that is there, whatever its form', () => {
    expect(declareUtf8('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">')).toBe(
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    );
    expect(declareUtf8('<META content="text/html; charset=iso-8859-1" http-equiv=Content-Type>')).toContain(
      'charset=utf-8',
    );
  });

  it('adds one after <head>, or at the start of a page without a head, with the page’s own line end', () => {
    expect(declareUtf8('<html>\r\n<head>\r\n<title>x</title>')).toBe(
      '<html>\r\n<head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\r\n<title>x</title>',
    );
    expect(declareUtf8('<title>x</title>\n')).toBe(
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n<title>x</title>\n',
    );
  });
});

describe('renderMarkdown (the differences page)', () => {
  it('renders headings, paragraphs, lists, tables and code, and escapes the rest', () => {
    const html = renderMarkdown(
      [
        '# Title',
        '',
        'Some *text* with `code <b>` and [a link](https://example.org/x).',
        '',
        '- one',
        '- two',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '```',
        '<raw> & text',
        '```',
      ].join('\n'),
    );
    expect(html).toContain('<h1 class="heading">Title</h1>');
    expect(html).toContain('<em>text</em>');
    expect(html).toContain('<code>code &lt;b&gt;</code>');
    expect(html).toContain('<a href="https://example.org/x">a link</a>');
    expect(html).toContain('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(html).toContain('<th>a</th><th>b</th>');
    expect(html).toContain('<td>1</td><td>2</td>');
    expect(html).toContain('<pre class="sourcecode">&lt;raw&gt; &amp; text</pre>');
  });

  it('turns no script, no event handler and no link to a local file into markup', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [y](../secret.txt)');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="../');
  });
});

const SOURCE = new URL('../../../../reference/src-help/EASy68K_Helpv5.16.1/', import.meta.url);
const HELP = new URL('../../../public/help/', import.meta.url);

function listing(root: URL, folder = ''): string[] {
  return readdirSync(new URL(folder, root), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listing(root, `${folder}${entry.name}/`) : [`${folder}${entry.name}`]))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('the whole import', () => {
  // The sources are git-ignored reference material: a checkout without them skips this test.
  it.skipIf(!existsSync(SOURCE))(
    'is repeatable and gives the committed files',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'easy68k-help-'));
      try {
        const source = fileURLToPath(SOURCE);
        const a = join(root, 'a');
        const b = join(root, 'b');
        const options = {
          source,
          differences: fileURLToPath(new URL('../../../../docs/DIFFERENCES.md', import.meta.url)),
        };
        importHelp({ ...options, out: a });
        importHelp({ ...options, out: b });
        const names = listing(pathToFileURL(`${a}/`));
        expect(names).toEqual(listing(pathToFileURL(`${b}/`)));
        for (const name of names) {
          expect(readFileSync(join(a, name)).equals(readFileSync(join(b, name))), name).toBe(true);
        }
        // ... and equal to what is committed (the differences page aside: DOC1 changes its source).
        expect(names.filter((name) => name !== 'manifest.json')).toEqual(
          listing(HELP).filter((name) => name !== 'manifest.json'),
        );
        for (const name of names.filter((n) => n !== 'Port/differences.htm' && n !== 'manifest.json')) {
          expect(
            readFileSync(join(a, name)).equals(
              readFileSync(new URL(name.split('/').map(encodeURIComponent).join('/'), HELP)),
            ),
            name,
          ).toBe(true);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
