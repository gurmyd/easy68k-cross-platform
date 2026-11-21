// Tests of the editor's print document (editor-ui §13.1, §8.1). Owner: E6.

import { describe, expect, it } from 'vitest';
import { TabType } from '../../contracts';
import {
  NEW_PAGE_MARKER,
  PrintTabSizeError,
  blanksForTab,
  buildPrintDocument,
  escapeHtml,
  expandTabs,
  printFontFamily,
  printFontSize,
  printLines,
  splitPages,
  type PrintSource,
} from './index';

const A = TabType.Assembly;
const F = TabType.Fixed;

describe('blanksForTab (editor-ui §8.1)', () => {
  it('Assembly tabs go to 12, 20 and 44, with 0 at exactly 12 and 20 and 0 or less from 44', () => {
    expect(blanksForTab(0, A, 4)).toBe(12);
    expect(blanksForTab(11, A, 4)).toBe(1);
    expect(blanksForTab(12, A, 4)).toBe(0);
    expect(blanksForTab(13, A, 4)).toBe(7);
    expect(blanksForTab(20, A, 4)).toBe(0);
    expect(blanksForTab(21, A, 4)).toBe(23);
    expect(blanksForTab(43, A, 4)).toBe(1);
    expect(blanksForTab(44, A, 4)).toBe(0);
    expect(blanksForTab(50, A, 4)).toBe(-6);
  });
  it('fixed tabs go to the next multiple of the size, 1 to size blanks', () => {
    expect(blanksForTab(0, F, 4)).toBe(4);
    expect(blanksForTab(3, F, 4)).toBe(1);
    expect(blanksForTab(4, F, 4)).toBe(4);
    expect(blanksForTab(9, F, 8)).toBe(7);
  });
  it('a fixed size of 0 is the division by zero of the original', () => {
    expect(() => blanksForTab(3, F, 0)).toThrow(PrintTabSizeError);
    // Assembly tabs never use the size.
    expect(blanksForTab(3, A, 0)).toBe(9);
  });
});

describe('expandTabs (replaceTabs, textS.cpp:498-534)', () => {
  it('leaves a text without tabs alone', () => {
    expect(expandTabs('MOVE.B D0,D1\nRTS', A, 4)).toBe('MOVE.B D0,D1\nRTS');
  });
  it('expands Assembly tabs to the label, opcode, operand and comment columns', () => {
    const out = expandTabs('START\tMOVE.B\t#1,D0\t* one', A, 4);
    expect(out).toBe(`${'START'.padEnd(12)}${'MOVE.B'.padEnd(8)}${'#1,D0'.padEnd(24)}* one`);
    expect(out.indexOf('MOVE.B')).toBe(12);
    expect(out.indexOf('#1,D0')).toBe(20);
    expect(out.indexOf('* one')).toBe(44);
  });
  it('a tab at column 12 or 20 vanishes (no blank, the tab is still removed)', () => {
    expect(expandTabs(`${'L'.repeat(12)}\tX`, A, 4)).toBe(`${'L'.repeat(12)}X`);
    expect(expandTabs(`${'L'.repeat(20)}\tX`, A, 4)).toBe(`${'L'.repeat(20)}X`);
  });
  it('beyond 44 a tab vanishes and moves the counted column back (x += t)', () => {
    // At column 50 the tab is worth -6: x becomes 44, so "ab" ends at 46 and the next tab is -2.
    const line = `${'c'.repeat(50)}\tab\tZ`;
    expect(expandTabs(line, A, 4)).toBe(`${'c'.repeat(50)}abZ`);
    // After the column went back to 44, a tab is worth 0 again, not a stop beyond.
    expect(expandTabs(`${'c'.repeat(46)}\t\tq`, A, 4)).toBe(`${'c'.repeat(46)}q`);
  });
  it('expands fixed tabs with the document size and restarts the column on every line', () => {
    expect(expandTabs('a\tb\n\tc', F, 4)).toBe('a   b\n    c');
    expect(expandTabs('abcd\te', F, 4)).toBe('abcd    e');
    expect(expandTabs('\t\t', F, 3)).toBe('      ');
  });
  it('counts a carriage return as a character, as the original text does', () => {
    expect(expandTabs('a\r\tb', F, 4)).toBe('a\r  b');
  });
  it('a negative fixed size writes no blank and moves the column back, as the C++ arithmetic does', () => {
    // size -4: t = -4 - (x % -4); at x = 1, x % -4 = 1, t = -5 -> x = -4; then t = -4 - (-0) = -4.
    expect(expandTabs('a\t\tb', F, -4)).toBe('ab');
  });
  it('throws for fixed size 0 only when there is a tab character', () => {
    expect(() => expandTabs('a\tb', F, 0)).toThrow(PrintTabSizeError);
    expect(expandTabs('no tabs', F, 0)).toBe('no tabs');
  });
  it('the first line of a selection counts from column 0 (the temporary control holds only it)', () => {
    // Selected from the middle of "LABEL\tMOVE": the printed copy is "\tMOVE", column 0.
    expect(expandTabs('\tMOVE', A, 4)).toBe(`${' '.repeat(12)}MOVE`);
  });
});

describe('printLines and splitPages', () => {
  it('counts lines like the edit control: no empty line after a final line break', () => {
    expect(printLines('')).toEqual([]);
    expect(printLines('a\nb\n')).toEqual(['a', 'b']);
    expect(printLines('a\n\n')).toEqual(['a', '']);
    expect(printLines('a\nb')).toEqual(['a', 'b']);
  });
  it('the marker line is not printed and starts a new page', () => {
    expect(splitPages(['a', NEW_PAGE_MARKER, 'b', 'c'])).toEqual([['a'], ['b', 'c']]);
  });
  it('only a line that is exactly the marker counts', () => {
    const near = [` ${NEW_PAGE_MARKER}`, `${NEW_PAGE_MARKER} `, NEW_PAGE_MARKER.toLowerCase(), 'PAGE'];
    expect(splitPages(near)).toEqual([near]);
  });
  it('a marker on the first line gives an empty first page; two in a row an empty page between', () => {
    expect(splitPages([NEW_PAGE_MARKER, 'a'])).toEqual([[], ['a']]);
    expect(splitPages(['a', NEW_PAGE_MARKER, NEW_PAGE_MARKER, 'b'])).toEqual([['a'], [], ['b']]);
  });
  it('a marker on the last line starts no page; a page already started stays', () => {
    expect(splitPages(['a', NEW_PAGE_MARKER])).toEqual([['a']]);
    expect(splitPages(['a', NEW_PAGE_MARKER, NEW_PAGE_MARKER])).toEqual([['a'], []]);
    expect(splitPages([NEW_PAGE_MARKER])).toEqual([[]]);
  });
  it('an empty text is one empty page', () => {
    expect(splitPages([])).toEqual([[]]);
  });
});

describe('buildPrintDocument', () => {
  const source = (over: Partial<PrintSource> = {}): PrintSource => ({
    text: 'START\tORG\t$1000\n\tEND\tSTART\n',
    tabType: A,
    tabSize: 4,
    fontName: 'Courier New',
    fontSize: 10,
    file: '/browser/demo/prog.X68',
    ...over,
  });

  it('is titled EASy68K and the path, and holds the expanded text in the document font', () => {
    const doc = buildPrintDocument(source());
    expect(doc.title).toBe('EASy68K /browser/demo/prog.X68');
    expect(doc.pages).toEqual([
      [`${'START'.padEnd(12)}${'ORG'.padEnd(8)}$1000`, `${' '.repeat(12)}${'END'.padEnd(8)}START`],
    ]);
    expect(doc.html).toContain('<title>EASy68K /browser/demo/prog.X68</title>');
    expect(doc.html).toContain('font-family: "Courier New", "Courier New", Courier, monospace');
    expect(doc.html).toContain('font-size: 10pt');
    expect(doc.html).not.toContain('\t');
  });
  it('is monochrome: black on white, no colour other than those, no script, no outside resource', () => {
    const { html } = buildPrintDocument(source());
    const colours = html.match(/#[0-9a-f]{3,6}\b/gi) ?? [];
    expect(new Set(colours.map((c) => c.toLowerCase()))).toEqual(new Set(['#fff', '#000']));
    expect(html).toContain('color-scheme" content="light"');
    expect(html).not.toMatch(/<script|<link|<img|url\(|@import|src=/i);
  });
  it('no header, no line numbers, no word wrap: the lines are the text itself in <pre>', () => {
    const { html } = buildPrintDocument(source({ text: 'x'.repeat(300) }));
    expect(html).toContain('white-space: pre;');
    expect(html).toContain('overflow: hidden;');
    expect(html).toContain(`<pre class="page">\n${'x'.repeat(300)}</pre>`);
    expect(html.match(/<pre/g)).toHaveLength(1);
  });
  it('one block per page with a forced break between them', () => {
    const { html, pages } = buildPrintDocument(source({ text: `one\n${NEW_PAGE_MARKER}\ntwo\n` }));
    expect(pages).toEqual([['one'], ['two']]);
    expect(html).toContain('<pre class="page">\none</pre>\n<pre class="page">\ntwo</pre>');
    expect(html).toContain('.page + .page { break-before: page; page-break-before: always; }');
  });
  it('an empty page holds one blank so that it is printed; an empty first line survives the parser', () => {
    const { html } = buildPrintDocument(source({ text: `${NEW_PAGE_MARKER}\n\nb` }));
    expect(html).toContain('<pre class="page">\n </pre>\n<pre class="page">\n\nb</pre>');
  });
  it('escapes the text and the title', () => {
    const doc = buildPrintDocument(source({ text: 'a<b>&"c"', file: 'untitled1.x68<x>' }));
    expect(doc.html).toContain('a&lt;b&gt;&amp;&quot;c&quot;');
    expect(doc.html).toContain('<title>EASy68K untitled1.x68&lt;x&gt;</title>');
    expect(doc.title).toBe('EASy68K untitled1.x68<x>');
  });
  it('fixed tab size 0 with a tab fails as the original print job does', () => {
    expect(() => buildPrintDocument(source({ tabType: F, tabSize: 0 }))).toThrow(PrintTabSizeError);
  });
  it('uses the stored font name and a sane size', () => {
    expect(printFontFamily('Fixedsys')).toBe('"Fixedsys", "Courier New", Courier, monospace');
    expect(printFontFamily('Bad"; } body { x')).toBe('"Bad  body  x", "Courier New", Courier, monospace');
    expect(printFontFamily('')).toBe('"Courier New", Courier, monospace');
    expect(printFontSize(12)).toBe(12);
    expect(printFontSize(0)).toBe(10);
    expect(printFontSize(Number.NaN)).toBe(10);
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });
});
