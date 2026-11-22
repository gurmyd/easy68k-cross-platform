// The import script tools/import-help.mjs: its pure functions, and (where the original sources are
// present: they are git-ignored reference material) a complete import twice into scratch folders.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HELP_PAGE_POLICY,
  addressKind,
  declareUtf8,
  fixReference,
  importHelp,
  insertPolicy,
  pageRefusals,
  readTag,
  renderMarkdown,
  // @ts-expect-error -- plain JavaScript module without type declarations
} from '../../../../tools/import-help.mjs';

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

describe('no script in a help page (erratum H1 11)', () => {
  const POLICY = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`;

  it('the policy is script-src none, put first in the head, with the page\u2019s own line end', () => {
    expect(HELP_PAGE_POLICY).toBe(POLICY);
    expect(insertPolicy('<html>\r\n<head>\r\n<meta charset>\r\n')).toBe(
      `<html>\r\n<head>\r\n${POLICY}\r\n<meta charset>\r\n`,
    );
    expect(insertPolicy('<HTML><HEAD><TITLE>x</TITLE>')).toBe(`<HTML><HEAD>\n${POLICY}<TITLE>x</TITLE>`);
    // A page without a head tag (excode.htm, Quick Reference.htm): first in the document.
    expect(insertPolicy('<meta charset>\r\n<title>x</title>')).toBe(`${POLICY}\r\n<meta charset>\r\n<title>x</title>`);
    expect(insertPolicy('<!DOCTYPE html>\n<html>\n<title>x</title>')).toBe(
      `<!DOCTYPE html>\n<html>\n\n${POLICY}<title>x</title>`,
    );
  });

  it('refuses a script element, an event handler, a javascript: address and a refresh', () => {
    expect(pageRefusals('a.htm', '<p>text</p>')).toEqual([]);
    expect(pageRefusals('a.htm', '<p>x</p><SCRIPT src="x.js"></SCRIPT>')).toEqual(['a script element']);
    expect(pageRefusals('a.htm', '<body onload="go()">')[0]).toMatch(/^an event handler attribute in <body/);
    expect(pageRefusals('a.htm', '<img src=x.gif OnError=go()>')[0]).toMatch(/^an event handler attribute/);
    expect(pageRefusals('a.htm', '<a href="javascript:go()">')).toEqual([
      'a javascript: address in <a href="javascript:go()">',
    ]);
    expect(pageRefusals('a.htm', '<a href=" JaVaScRiPt:go()">')).toHaveLength(1);
    expect(pageRefusals('a.htm', '<a href="jav&#x09;ascript&#58;go()">')).toHaveLength(1);
    expect(pageRefusals('a.htm', '<a href="&#106;avascript:go()">')).toHaveLength(1);
    expect(pageRefusals('a.htm', '<p style="background:url(javascript:go())">')).toHaveLength(1);
    expect(pageRefusals('a.htm', '<meta http-equiv="refresh" content="0;url=main.htm">')[0]).toMatch(/^a refresh/);
    // Text about these things is text.
    expect(pageRefusals('a.htm', '<p>Use onclick= or javascript: in a page</p>')).toEqual([]);
    // A tag in a comment is read too: a browser ends a comment at "--!>" as well, so what looks
    // like a comment to a simple reading may not be one (gate I3 round 4).
    expect(pageRefusals('a.htm', '<!-- x --!><script>go()</script> -->')).toEqual(['a script element']);
    expect(pageRefusals('a.htm', '<!-- <img src=x onerror=go()> -->')[0]).toMatch(/^an event handler attribute/);
    // ... and in the text of a style element, where "<!--" starts no comment.
    expect(pageRefusals('a.htm', '<style><!--</style><img src=x onerror=go()>--></style>')).toHaveLength(1);
    // The policy element itself passes.
    expect(pageRefusals('a.htm', insertPolicy('<head><title>x</title>'))).toEqual([]);
  });

  // Review of gate I3 round 3: an attribute name also starts right after a "/" or a closing quote.
  it('refuses an event handler however the tokenizer finds its name', () => {
    for (const page of [
      '<img src="x.gif"/onerror=alert(1)>',
      '<body/onload=alert(1)>',
      '<a href="x.htm"onclick=alert(1)>x</a>',
      "<a href='x.htm'onclick=alert(1)>x</a>",
      '<img src=x.gif/onerror=alert(1)>', // a browser reads one unquoted src; refused all the same
      '<img\tsrc="x.gif"\fonerror=alert(1)>',
      '<p\nonclick=go()>',
      '<img src="x.gif" ONERROR = "go()">',
      '<a title="a > b" onclick=go()>x</a>', // ">" in a quoted value does not end the tag
      '<a title="x"/ onclick=go()>',
      '<x =onclick onclick=go()>',
      '<a href="x.htm" onclick>',
    ])
      expect(pageRefusals('a.htm', page), page).toContainEqual(
        expect.stringMatching(/^an event handler attribute in </),
      );
    expect(pageRefusals('a.htm', '<p>one=1, only = 2, <b>Condition Only ===</b></p>')).toEqual([]);
  });

  it('readTag reads attributes as the HTML tokenizer does', () => {
    const names = (html: string) => readTag(html, 0).attributes.map((a: { name: string }) => a.name);
    expect(names('<img src="x.gif"/onerror=alert(1)>')).toEqual(['src', 'onerror']);
    expect(names('<body/onload=alert(1)>')).toEqual(['onload']);
    expect(names('<a href="x.htm"onclick=alert(1)>')).toEqual(['href', 'onclick']);
    expect(names('<img src=x.gif/onerror=alert(1)>')).toEqual(['src']);
    expect(readTag('<img src=x.gif/onerror=alert(1)>', 0).attributes[0]?.value).toBe('x.gif/onerror=alert(1)');
    expect(names('<a title="a > b" onclick=go()>')).toEqual(['title', 'onclick']);
    expect(readTag("<A HREF = 'X'>", 0)).toMatchObject({ name: 'a', attributes: [{ name: 'href', value: 'X' }] });
    expect(readTag('</p>', 0)).toMatchObject({ name: 'p', endTag: true });
  });

  it('refuses every other way a page could run script or leave the help folder', () => {
    const refused = (page: string, pattern: RegExp) =>
      expect(pageRefusals('a.htm', page), page).toContainEqual(expect.stringMatching(pattern));
    // elements that run script, show another document or send a form
    refused('<svg><script>go()</script></svg>', /^a script element$/);
    refused('<svg><a href="../index.html">x</a></svg>', /^a svg element/);
    refused('<svg/onload=go()>', /^a svg element/);
    refused('<math><mtext></mtext></math>', /^a math element/);
    refused('<iframe src="main.htm"></iframe>', /^a iframe element/);
    refused('<frameset><frame src="main.htm"></frameset>', /^a frameset element/);
    refused('<object data="main.htm"></object>', /^a object element/);
    refused('<embed src="main.htm">', /^a embed element/);
    refused('<applet code="x"></applet>', /^a applet element/);
    refused('<form action="main.htm"><button>go</button></form>', /^a form element/);
    refused('<button formaction="../index.html">go</button>', /outside the help folder/);
    refused('<iframe srcdoc="&lt;script&gt;go()&lt;/script&gt;">', /^a srcdoc attribute/);
    // base and meta
    refused('<base href="../">', /^a base element other than/);
    refused('<base href="/" target="_self">', /^a base element other than/);
    refused('<base target="_top">', /^a base element other than/);
    refused('<meta http-equiv="refresh" content="0;url=../index.html">', /^a refresh/);
    refused('<meta http-equiv=REFRESH content=0>', /^a refresh/);
    refused('<meta http-equiv="&#82;efresh" content=0>', /^a refresh/);
    refused('<meta http-equiv="set-cookie" content="a=b">', /^a meta element with http-equiv="set-cookie"/);
    // javascript: and data: in any letter case, with references, escapes and white space
    for (const href of [
      'javascript:go()',
      'JAVASCRIPT:go()',
      ' \u0001javascript:go()',
      'java\tscript:go()',
      'java&Tab;script:go()',
      'java&NewLine;script:go()',
      'javascript&colon;go()',
      '&#x6A;avascript:go()',
      '&#X6a;avascript:go()',
      '&#0000106;avascript:go()',
      'vbscript:go()',
    ])
      refused(`<a href="${href}">x</a>`, /^a javascript: address/);
    for (const href of [
      'data:text/html,<script>go()</script>',
      'DATA:text/html;base64,PHNjcmlwdD4=',
      'blob:x',
      'file:///c:/x',
    ])
      refused(`<a href="${href}">x</a>`, /^an address with a scheme the frame may not show/);
    refused('<img srcset="x.gif 1x, data:image/gif,x 2x">', /^an address with a scheme/);
    // escaped separators, dots and percent signs, and references the import cannot read
    for (const href of [
      '..%2Findex.html',
      '..%2findex.html',
      '..%5Cindex.html',
      '%2e%2e/index.html',
      '..%252Findex.html',
    ])
      refused(`<a href="${href}">x</a>`, /^an address with an escaped slash/);
    refused('<a href="..&sol;index.html">x</a>', /outside the help folder/);
    refused('<a href="&period;&period;/index.html">x</a>', /outside the help folder/);
    refused('<a href="..&slash;index.html">x</a>', /^an address with a character reference the import cannot read/);
    refused('<a href="https://example.org/">x</a>', /^a link to another site that would open in the frame/);
    refused('<a href="https://example.org/" target="_self">x</a>', /^a link to another site that would open/);
    refused('<link rel="stylesheet" href="/assets/x.css">', /outside the help folder/);
    refused('<a href="x.htm" ping="../index.html">x</a>', /outside the help folder/);
    // and what stays allowed
    for (const page of [
      '<base target="_self">',
      '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
      '<meta http-equiv=Content-Language content="en-us">',
      '<a href="GNU%20General%20Public%20License.htm#top">x</a>',
      '<a href="https://example.org/" target="_blank">x</a>',
      '<a href="mailto:a@b.c" target="_BLANK">x</a>',
      '<a href="x.htm?a=1&amp;b=%2F">x</a>',
      '<img src="Reference/x.gif" alt="&copy; 2004">',
    ])
      expect(pageRefusals('a.htm', page), page).toEqual([]);
  });

  it('refuses a link to an address of the site outside the help folder; other sites stay', () => {
    expect(addressKind('main.htm', 'options.htm')).toBe('help');
    expect(addressKind('Directives/org.htm', '../options.htm#top')).toBe('help');
    expect(addressKind('Directives/org.htm', '..\\Quick%20Reference.htm')).toBe('help');
    expect(addressKind('main.htm', 'GNU General Public License.htm')).toBe('help');
    expect(addressKind('main.htm', '#top')).toBe('help');
    expect(addressKind('main.htm', '../index.html')).toBe('outside');
    expect(addressKind('main.htm', '..')).toBe('outside');
    expect(addressKind('main.htm', '../')).toBe('outside');
    expect(addressKind('Directives/org.htm', '../../index.html')).toBe('outside');
    expect(addressKind('main.htm', '/index.html')).toBe('outside');
    expect(addressKind('main.htm', '\\index.html')).toBe('outside');
    expect(addressKind('main.htm', '../Helpv1_4/main.htm')).toBe('outside');
    expect(addressKind('main.htm', '../helpx/main.htm')).toBe('outside');
    expect(addressKind('main.htm', 'http://www.easy68k.com/')).toBe('other-site');
    expect(addressKind('main.htm', 'https://github.com/x')).toBe('other-site');
    expect(addressKind('main.htm', 'mailto:a@b.c')).toBe('other-site');
    expect(addressKind('main.htm', '//example.org/x')).toBe('other-site');
    expect(addressKind('main.htm', 'javascript:go()')).toBe('scheme');
    expect(addressKind('main.htm', 'data:text/html,x')).toBe('scheme');
    expect(addressKind('main.htm', 'blob:x')).toBe('scheme');
    expect(pageRefusals('main.htm', '<a href="../index.html">the app</a>')).toEqual([
      'a link to an address of this site outside the help folder in <a href="../index.html">',
    ]);
    expect(pageRefusals('main.htm', '<img src="/assets/x.png">')).toHaveLength(1);
    expect(pageRefusals('main.htm', '<a href="http://www.easy68k.com/" target="_blank">site</a>')).toEqual([]);
  });

  it('reads a special scheme without "//" relative to the page, as the URL parser does', () => {
    // On an https site "https:../index.html" is the application's index.html (review, round 5).
    expect(addressKind('main.htm', 'https:../index.html')).toBe('outside');
    expect(addressKind('main.htm', 'HTTP:..\\index.html')).toBe('outside');
    expect(addressKind('main.htm', 'https:/index.html')).toBe('outside');
    expect(addressKind('Directives/org.htm', 'https:../../index.html')).toBe('outside');
    expect(addressKind('main.htm', 'https:..%2Findex.html')).toBe('encoded');
    expect(addressKind('main.htm', 'https:javascript:go()')).toBe('scheme');
    // Inside the folder by that reading, another site by the other: a link needs target="_blank".
    expect(addressKind('Directives/org.htm', 'https:../options.htm')).toBe('other-site');
    expect(addressKind('main.htm', 'https://site.example/../index.html')).toBe('other-site');
    expect(pageRefusals('main.htm', '<a href="https:../index.html" target="_blank">app</a>')).toEqual([
      'a link to an address of this site outside the help folder in <a href="https:../index.html" target="_blank">',
    ]);
    expect(pageRefusals('main.htm', '<a href="https:options.htm">x</a>')).toEqual([
      'a link to another site that would open in the frame (no target="_blank") in <a href="https:options.htm">',
    ]);
  });

  it('the script stops with exit code 1 and the name of a refused page', () => {
    const root = mkdtempSync(join(tmpdir(), 'easy68k-help-refuse-'));
    try {
      const source = join(root, 'src');
      mkdirSync(join(source, 'sub'), { recursive: true });
      writeFileSync(
        join(source, 'main.htm'),
        '<html><head><title>ok</title></head><body><a href="sub/bad.htm">x</a></body></html>',
      );
      writeFileSync(
        join(source, 'sub', 'bad.htm'),
        '<html><head><title>bad</title></head><body><a href="../../index.html">app</a></body></html>',
      );
      const script = fileURLToPath(new URL('../../../../tools/import-help.mjs', import.meta.url));
      const run = spawnSync(
        process.execPath,
        [script, '--source', source, '--out', join(root, 'out'), '--differences', join(root, 'none.md')],
        { encoding: 'utf8' },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        'sub/bad.htm: refused, the page holds a link to an address of this site outside the help folder',
      );
      writeFileSync(
        join(source, 'sub', 'bad.htm'),
        '<html><head><title>bad</title></head><body onload="x()"></body></html>',
      );
      const again = spawnSync(
        process.execPath,
        [script, '--source', source, '--out', join(root, 'out'), '--differences', join(root, 'none.md')],
        { encoding: 'utf8' },
      );
      expect(again.status).toBe(1);
      expect(again.stderr).toContain('sub/bad.htm: refused, the page holds an event handler attribute');
      // The three forms of the review of gate I3 round 3, and an encoded slash.
      for (const [body, reason] of [
        ['<img src="x.gif"/onerror=alert(1)>', 'an event handler attribute'],
        ['<body/onload=alert(1)>', 'an event handler attribute'],
        ['<a href="x.htm"onclick=alert(1)>x</a>', 'an event handler attribute'],
        ['<a href="..%2Findex.html">app</a>', 'an address with an escaped slash'],
      ]) {
        writeFileSync(
          join(source, 'sub', 'bad.htm'),
          `<html><head><title>bad</title></head><body>${body}</body></html>`,
        );
        const form = spawnSync(
          process.execPath,
          [script, '--source', source, '--out', join(root, 'out'), '--differences', join(root, 'none.md')],
          { encoding: 'utf8' },
        );
        expect(form.status, body).toBe(1);
        expect(form.stderr, body).toContain(`sub/bad.htm: refused, the page holds ${reason}`);
      }
      writeFileSync(
        join(source, 'sub', 'bad.htm'),
        '<html><head><title>fine</title></head><body><p>fine</p></body></html>',
      );
      const fine = spawnSync(
        process.execPath,
        [script, '--source', source, '--out', join(root, 'out'), '--differences', join(root, 'none.md')],
        { encoding: 'utf8' },
      );
      expect(fine.status, fine.stderr).toBe(0);
      expect(readFileSync(join(root, 'out', 'sub', 'bad.htm'), 'utf8')).toContain(`<head>\n${POLICY}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
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
