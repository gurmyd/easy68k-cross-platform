// Tests of the search and replace rules (editor-ui §14.2, §14.3, §20.6; note 7). Owner: E6.

import { describe, expect, it } from 'vitest';
import {
  findFrom,
  findNext,
  isWordChar,
  matchesAt,
  replace,
  searchStart,
  selectionIsMatch,
  type FindOptions,
  type ReplaceRequest,
} from './search';

const plain: FindOptions = { wholeWord: false, matchCase: false };
const caseOnly: FindOptions = { wholeWord: false, matchCase: true };
const wordOnly: FindOptions = { wholeWord: true, matchCase: false };
const caret = (at: number) => ({ from: at, to: at });

describe('matching', () => {
  it('ignores case unless Match case is on', () => {
    expect(matchesAt('move.b d0,d1', 0, 'MOVE', plain)).toBe(true);
    expect(matchesAt('move.b d0,d1', 0, 'MOVE', caseOnly)).toBe(false);
    expect(matchesAt('MOVE.B', 0, 'MOVE', caseOnly)).toBe(true);
    // Windows-1252 letters fold as well.
    expect(matchesAt('ÉTÉ', 0, 'été', plain)).toBe(true);
  });
  it('Match whole word only needs a non-word character (or the text edge) on both sides', () => {
    expect(matchesAt('D0', 0, 'D0', wordOnly)).toBe(true);
    expect(matchesAt('MOVE D0,D1', 5, 'D0', wordOnly)).toBe(true);
    expect(matchesAt('XD0', 1, 'D0', wordOnly)).toBe(false);
    expect(matchesAt('D00', 0, 'D0', wordOnly)).toBe(false);
    expect(matchesAt('D0_', 0, 'D0', wordOnly)).toBe(false);
    expect(matchesAt('#D0.', 1, 'D0', wordOnly)).toBe(true);
    expect(matchesAt('a\nD0\n', 2, 'D0', wordOnly)).toBe(true);
  });
  it('word characters are letters, digits and the underscore', () => {
    expect(['a', 'Z', '7', '_', 'é'].every((ch) => isWordChar(ch))).toBe(true);
    expect([' ', ',', '.', '#', '$', '\n', undefined, ''].some((ch) => isWordChar(ch))).toBe(false);
  });
  it('an empty query never matches', () => {
    expect(findFrom('abc', '', 0, plain)).toBe(-1);
    expect(matchesAt('abc', 0, '', plain)).toBe(false);
  });
  it('findFrom finds the first match at or after the start, forward only', () => {
    expect(findFrom('ab ab ab', 'ab', 0, plain)).toBe(0);
    expect(findFrom('ab ab ab', 'ab', 1, plain)).toBe(3);
    expect(findFrom('ab ab ab', 'ab', 7, plain)).toBe(-1);
    expect(findFrom('ab ab ab', 'AB', 1, caseOnly)).toBe(-1);
    expect(findFrom('xab ab', 'ab', 0, wordOnly)).toBe(4);
  });
});

describe('where a search starts (14.2 with note 7)', () => {
  it('after a selection; at the caret without one; at the top right after End of document reached', () => {
    expect(searchStart({ selection: { from: 3, to: 6 }, restart: false })).toBe(6);
    expect(searchStart({ selection: { from: 3, to: 6 }, restart: true })).toBe(6);
    expect(searchStart({ selection: caret(4), restart: false })).toBe(4);
    expect(searchStart({ selection: caret(4), restart: true })).toBe(0);
  });
  it('the 20.6 sequence: a selected word, Enter finds the next one, then the end, then F3 from the top', () => {
    const text = 'LOOP MOVE D0,D1\n BRA LOOP\n DBRA D2,LOOP\n';
    // "LOOP" selected on line 2 (offset 21-25).
    let selection = findNext(text, 'LOOP', plain, { selection: { from: 21, to: 25 }, restart: false });
    expect(selection).toEqual({ from: 35, to: 39 });
    // The next search from there fails: End of document reached; the selection collapses to its start.
    expect(findNext(text, 'LOOP', plain, { selection: selection!, restart: false })).toBeNull();
    // The following F3 starts from the top.
    selection = findNext(text, 'LOOP', plain, { selection: caret(35), restart: true });
    expect(selection).toEqual({ from: 0, to: 4 });
  });
  it('a selection that is a match is recognised under the options', () => {
    expect(selectionIsMatch('MOVE d0', { from: 5, to: 7 }, 'D0', plain)).toBe(true);
    expect(selectionIsMatch('MOVE d0', { from: 5, to: 7 }, 'D0', caseOnly)).toBe(false);
    expect(selectionIsMatch('MOVE d0', { from: 4, to: 7 }, 'D0', plain)).toBe(false);
    expect(selectionIsMatch('xd0', { from: 1, to: 3 }, 'D0', wordOnly)).toBe(false);
  });
});

describe('replace (14.3 with note 7)', () => {
  const request = (over: Partial<ReplaceRequest>): ReplaceRequest => ({
    text: '',
    selection: caret(0),
    restart: false,
    query: 'D0',
    replacement: 'D1',
    options: plain,
    all: false,
    ...over,
  });
  const apply = (text: string, changes: { from: number; to: number; insert: string }[]) => {
    let out = text;
    for (const change of [...changes].reverse()) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
    return out;
  };

  it('Replace All D0 -> D1 on three occurrences replaces all three and ends at the end of the document', () => {
    const text = ' MOVE.L D0,(A0)\n ADD.W D0,D2\n CLR.B D0\n';
    const result = replace(request({ text, all: true }));
    expect(result.text).toBe(' MOVE.L D1,(A0)\n ADD.W D1,D2\n CLR.B D1\n');
    expect(result.changes).toHaveLength(3);
    expect(apply(text, result.changes)).toBe(result.text);
    expect(result.endReached).toBe(true);
    // The last replacement is selected until the box has been shown.
    expect(result.selection).toEqual({ from: 36, to: 38 });
  });
  it('Replace with nothing selected finds the first match from the caret, replaces it and selects the next', () => {
    const text = 'D0 D0 D0';
    const result = replace(request({ text, selection: caret(1) }));
    expect(result.text).toBe('D0 D1 D0');
    expect(result.selection).toEqual({ from: 6, to: 8 });
    expect(result.endReached).toBe(false);
  });
  it('Replace right after End of document reached starts from the top', () => {
    const result = replace(request({ text: 'D0 x', selection: caret(4), restart: true }));
    expect(result.text).toBe('D1 x');
    expect(result.endReached).toBe(true);
  });
  it('Replace with a selected match replaces exactly it', () => {
    const result = replace(request({ text: 'D0 D0', selection: { from: 3, to: 5 } }));
    expect(result.text).toBe('D0 D1');
    expect(result.endReached).toBe(true);
  });
  it('a selection that is not a match is not replaced: the next match from its start is (note 7)', () => {
    const result = replace(request({ text: 'MOVE D0,D0', selection: { from: 0, to: 4 } }));
    expect(result.text).toBe('MOVE D1,D0');
    expect(result.selection).toEqual({ from: 8, to: 10 });
    // No match at all: nothing changes, End of document reached, the caret goes to the selection's start.
    const none = replace(request({ text: 'MOVE A0', selection: { from: 2, to: 4 } }));
    expect(none.changes).toEqual([]);
    expect(none.text).toBe('MOVE A0');
    expect(none.endReached).toBe(true);
    expect(none.selection).toEqual(caret(2));
  });
  it('an empty replacement does not skip a match that begins right after the deleted one (note 7)', () => {
    const result = replace(request({ text: 'xyxyZ', query: 'xy', replacement: '', all: true }));
    expect(result.text).toBe('Z');
    expect(result.changes).toEqual([
      { from: 0, to: 2, insert: '' },
      { from: 2, to: 4, insert: '' },
    ]);
    // Single Replace: the caret stays where the match was and the next match is selected at once.
    const one = replace(request({ text: 'xyxyZ', query: 'xy', replacement: '' }));
    expect(one.text).toBe('xyZ');
    expect(one.selection).toEqual({ from: 0, to: 2 });
  });
  it('Replace All goes from the selection to the end only, never wrapping', () => {
    const result = replace(request({ text: 'D0 D0 D0', selection: caret(3), all: true }));
    expect(result.text).toBe('D0 D1 D1');
  });
  it('a replacement that contains the search text is not searched again', () => {
    const result = replace(request({ text: 'a a', query: 'a', replacement: 'aa', all: true }));
    expect(result.text).toBe('aa aa');
  });
  it('Replace All keeps the options: whole words, case', () => {
    const text = 'D0 d0 D00 xD0';
    expect(replace(request({ text, options: wordOnly, all: true })).text).toBe('D1 D1 D00 xD0');
    expect(replace(request({ text, options: caseOnly, all: true })).text).toBe('D1 d0 D10 xD1');
  });
  it('changes are in the coordinates of the original text even when the lengths differ', () => {
    const text = 'ab-ab-ab';
    const result = replace(request({ text, query: 'ab', replacement: 'XYZ', all: true }));
    expect(result.text).toBe('XYZ-XYZ-XYZ');
    expect(apply(text, result.changes)).toBe(result.text);
  });
});
