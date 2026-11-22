import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { TabType } from '../../contracts';
import { NOT_1252_TEXT, unmappableRanges } from './cp1252-marks';
import { fontFamilyFor, fontSizeFor } from './fonts';
import { statusTexts, windowStatusText } from './status';

const at = (text: string, pos: number) => EditorState.create({ doc: text, selection: EditorSelection.cursor(pos) });

describe('status bar (editor-ui §7.2, note 17, 20.3)', () => {
  const fixed = { tabType: TabType.Fixed, tabSize: 4, modified: false, insertMode: true };

  it('`line: column` starts at 1: 1', () => {
    expect(statusTexts(at('', 0), fixed).position).toBe('1: 1');
  });

  it('the column is the true visual column: tabs expand with the document stops', () => {
    const text = 'X\n\tMOVE';
    expect(statusTexts(at(text, text.length), fixed).position).toBe('2: 9');
    expect(statusTexts(at(text, text.length), { ...fixed, tabType: TabType.Assembly }).position).toBe('2: 17');
    // Two tabs with Assembly stops: 12 then 20 (the original counted tabs and used the global size).
    const two = 'ABCDEFGHIJKLMN\tX';
    expect(statusTexts(at(two, two.length), { ...fixed, tabType: TabType.Assembly }).position).toBe('1: 22');
  });

  it('with a selection, the position is the end of the selection in either direction (§7.2)', () => {
    const range = (anchor: number, head: number) =>
      EditorState.create({ doc: 'abcdef', selection: EditorSelection.single(anchor, head) });
    expect(statusTexts(range(1, 4), fixed).position).toBe('1: 5');
    // Made backwards (anchor 4, head 1, e.g. Shift+Left three times): still the end.
    expect(statusTexts(range(4, 1), fixed).position).toBe('1: 5');
    // Shift+Home from the end of the line selects the whole line: the end is the line's end.
    expect(statusTexts(range(6, 0), fixed).position).toBe('1: 7');
  });

  it('Modified after an edit, empty otherwise; Insert / Replace', () => {
    expect(statusTexts(at('a', 0), { ...fixed, modified: true }).modified).toBe('Modified');
    expect(statusTexts(at('a', 0), fixed).modified).toBe('');
    expect(statusTexts(at('a', 0), fixed).insert).toBe('Insert');
    expect(statusTexts(at('a', 0), { ...fixed, insertMode: false }).insert).toBe('Replace');
  });

  it('the information panel: encoding, line ends, tab mode', () => {
    expect(statusTexts(at('a', 0), fixed).info).toBe('Windows-1252  CR LF  Fixed tabs 4');
    expect(statusTexts(at('a', 0), { ...fixed, tabType: TabType.Assembly }).info).toBe(
      'Windows-1252  CR LF  Assembly tabs',
    );
  });
});

describe('characters Windows-1252 cannot store (3.9.3)', () => {
  it('marks characters without a byte and nothing else', () => {
    expect(unmappableRanges('MOVE.B #1,D0 ; ÄÖÜ € ™ ‰')).toEqual([]);
    // The five undefined bytes decode to C1 controls and round-trip, so they are not marked.
    expect(unmappableRanges('\u0081\u008d\u008f\u0090\u009d')).toEqual([]);
    expect(unmappableRanges('a→b')).toEqual([{ from: 1, to: 2 }]);
    // A surrogate pair is one character.
    expect(unmappableRanges('x😀y')).toEqual([{ from: 1, to: 3 }]);
    expect(unmappableRanges('Ā\u0080')).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ]);
  });

  it('hover text', () => {
    expect(NOT_1252_TEXT).toBe('Not in Windows-1252: saved as ?');
  });
});

describe('display font (2.4)', () => {
  it('uses the stored name with the monospace stack as fallback; the name is never rewritten', () => {
    expect(fontFamilyFor('Courier New')).toBe('"Courier New", var(--font-mono)');
    expect(fontFamilyFor('Fixedsys')).toBe('"Fixedsys", var(--font-mono)');
    expect(fontFamilyFor('')).toBe('var(--font-mono)');
    expect(fontFamilyFor('a"b')).toBe('"ab", var(--font-mono)');
    expect(fontSizeFor(10)).toBe('10pt');
    expect(fontSizeFor(0)).toBe('10pt');
  });
});

describe("Editor mode's window status bar (gate I2 review: no /linked/<id>/)", () => {
  it('shows a linked file under the store label, never the internal folder', () => {
    expect(windowStatusText('/linked/21d878e9/prog.X68', 'prog.X68')).toBe('Linked files/prog.X68');
    expect(windowStatusText('/linked/21d878e9/sub/prog.X68', 'prog.X68', 'Linked')).toBe('Linked/sub/prog.X68');
    expect(windowStatusText('/linked/21d878e9', 'x')).toBe('Linked files');
  });

  it('shows any other path as it is, and the name of a document without a file', () => {
    expect(windowStatusText('/browser/demo/prog.X68', 'prog.X68')).toBe('/browser/demo/prog.X68');
    expect(windowStatusText('/browser/linked/a/prog.X68', 'prog.X68')).toBe('/browser/linked/a/prog.X68');
    expect(windowStatusText(null, 'untitled1.x68')).toBe('untitled1.x68');
  });
});
