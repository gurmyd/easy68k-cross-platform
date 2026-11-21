// The text mirror for screen readers (ARCHITECTURE.md 2.5, 2.11).

import { describe, expect, it } from 'vitest';
import { MIRROR_INTERVAL_MS, mirrorRows, sameRows } from './mirror';

/** A shadow array with `lines` written at the stride `cols`, blanks elsewhere. */
function screen(cols: number, rows: number, lines: Record<number, string>, blank = 0x20) {
  const text = new Uint8Array(32768).fill(blank);
  for (const [row, line] of Object.entries(lines)) {
    for (let i = 0; i < line.length; i++) text[Number(row) * cols + i] = line.charCodeAt(i);
  }
  return { text, textCols: cols, textRows: rows };
}

describe('mirrorRows', () => {
  it('gives one row per line, without trailing blanks and without the empty rows below the text', () => {
    expect(mirrorRows(screen(80, 30, { 0: 'HELLO', 2: '  indented  ' }))).toEqual(['HELLO', '', '  indented']);
  });

  it('reads the array with the stride of the current grid', () => {
    const state = screen(40, 10, { 1: 'second row' });
    expect(mirrorRows(state)).toEqual(['', 'second row']);
    // The same bytes read with another stride are other rows (3.5.2: stride aliasing).
    expect(mirrorRows({ ...state, textCols: 20 })).toEqual(['', '', 'second row']);
  });

  it('decodes Windows-1252', () => {
    const state = screen(80, 5, {});
    state.text.set([0xe9, 0x80, 0x41], 0);
    expect(mirrorRows(state)).toEqual(['é€A']);
  });

  it('an untouched screen is empty, whether it holds blanks or NUL bytes', () => {
    expect(mirrorRows(screen(80, 30, {}))).toEqual([]);
    expect(mirrorRows(screen(80, 30, {}, 0))).toEqual([]);
  });

  it('respects the limits of the grid (128 rows, 256 columns) and a grid without columns', () => {
    const state = screen(256, 128, { 127: 'last' });
    expect(mirrorRows(state).length).toBe(128);
    expect(mirrorRows({ ...state, textRows: 1000, textCols: 1000 }).length).toBe(128);
    expect(mirrorRows({ ...state, textCols: 0 })).toEqual([]);
  });
});

describe('sameRows', () => {
  it('compares line by line', () => {
    expect(sameRows(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameRows(['a', 'b'], ['a'])).toBe(false);
    expect(sameRows(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sameRows([], [])).toBe(true);
  });
});

it('the mirror refreshes twice per second', () => {
  expect(MIRROR_INTERVAL_MS).toBe(500);
});
