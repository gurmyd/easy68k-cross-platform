// The pixels of TextOut (trap15-b §5.2, §6.7).

import { describe, expect, it } from 'vitest';
import type { Glyph } from '../../../contracts';
import { createBuffer } from './raster';
import { BLACK, BLUE, GREEN, picture, pixelAt, RED, WHITE } from './testing';
import { paintText, textBounds } from './text';

/** A glyph from rows of text: `#` full coverage, `.` none, a digit 1-9 that many tenths of 255. */
function glyph(rows: readonly string[], advance = (rows[0] as string).length): Glyph {
  const width = (rows[0] as string).length;
  const coverage = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x] as string;
      coverage[y * width + x] = ch === '#' ? 255 : ch === '.' ? 0 : Math.round((Number(ch) * 255) / 10);
    }
  });
  return { advance, width, height: rows.length, coverage };
}

const LEGEND = { [BLACK]: '.', [WHITE]: '#', [RED]: 'R', [GREEN]: 'g', [BLUE]: 'b' };
const BAR = glyph(['.#.', '.#.', '.#.']);
const DOT = glyph(['...', '.#.', '...']);

describe('paintText (trap15-b §6.7)', () => {
  it('fills an opaque cell in the background colour and draws the glyphs in the text colour', () => {
    const buffer = createBuffer(10, 6);
    buffer.data.fill(0xff00ff00); // green
    paintText(buffer, 0, 0, 2, 1, [BAR, DOT], RED, WHITE);
    expect(picture(buffer, 0, 0, 10, 6, LEGEND)).toEqual([
      'gggggggggg',
      'ggR#RRRRgg',
      'ggR#RR#Rgg',
      'ggR#RRRRgg',
      'gggggggggg',
      'gggggggggg',
    ]);
  });

  it('the measured cell: two 8 x 15 characters at (10,10) fill exactly x 10-25, y 10-24', () => {
    const blank = { advance: 8, width: 8, height: 15, coverage: new Uint8Array(120) };
    const buffer = createBuffer(40, 40);
    paintText(buffer, 0, 0, 10, 10, [blank, blank], RED, WHITE);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const inCell = x >= 10 && x <= 25 && y >= 10 && y <= 24;
        expect(pixelAt(buffer, x, y), `(${x},${y})`).toBe(inCell ? RED : BLACK);
      }
    }
  });

  it('places each glyph one advance after the one before', () => {
    const narrow = glyph(['#'], 2);
    const buffer = createBuffer(12, 1);
    paintText(buffer, 0, 0, 1, 0, [narrow, narrow, glyph(['#'], 5), narrow], BLACK, WHITE);
    expect(picture(buffer, 0, 0, 12, 1, LEGEND)).toEqual(['.#.#.#....#.']);
  });

  it('coverage between none and full blends the text colour with what is under it', () => {
    const buffer = createBuffer(3, 1);
    paintText(buffer, 0, 0, 0, 0, [glyph(['5.#'])], 0x204060, 0xe0c0a0);
    // 5 tenths = coverage 128: (under * 127 + over * 128 + 127) / 255, per channel
    const half = (under: number, over: number) => Math.floor((under * 127 + over * 128 + 127) / 255);
    const expected = (half(0x20, 0xe0) << 16) | (half(0x40, 0xc0) << 8) | half(0x60, 0xa0);
    expect(pixelAt(buffer, 0, 0)).toBe(expected);
    expect(pixelAt(buffer, 1, 0)).toBe(0x204060);
    expect(pixelAt(buffer, 2, 0)).toBe(0xe0c0a0);
  });

  it('a glyph wider than its advance paints beside the cell, over what is there', () => {
    const slanted = glyph(['..##', '##..'], 2);
    const buffer = createBuffer(8, 2);
    buffer.data.fill(0xff00ff00);
    paintText(buffer, 0, 0, 1, 0, [slanted], RED, WHITE);
    // cell: x 1-2; the glyph reaches x 3-4, where the green stays under the pixels it does not cover
    expect(picture(buffer, 0, 0, 8, 2, LEGEND)).toEqual(['gRR##ggg', 'g##ggggg']);
  });

  it('leaves out whatever falls outside the buffer', () => {
    const buffer = createBuffer(4, 3);
    paintText(buffer, 0, 0, -2, -1, [BAR, BAR, BAR], RED, WHITE);
    expect(picture(buffer, 0, 0, 4, 3, LEGEND)).toEqual(['RR#R', 'RR#R', '....']);
    const untouched = createBuffer(4, 3);
    paintText(untouched, 0, 0, 100, 100, [BAR], RED, WHITE);
    paintText(untouched, 0, 0, -100, -100, [BAR], RED, WHITE);
    expect(picture(untouched, 0, 0, 4, 3, LEGEND)).toEqual(['....', '....', '....']);
  });

  it('paints into a buffer that stands for another part of the surface', () => {
    // a 3 x 3 buffer whose pixel (0,0) is surface pixel (20,10)
    const cell = createBuffer(3, 3);
    paintText(cell, 20, 10, 20, 10, [BAR], RED, WHITE);
    expect(picture(cell, 0, 0, 3, 3, LEGEND)).toEqual(['R#R', 'R#R', 'R#R']);
  });

  it('no glyphs: nothing is painted', () => {
    const buffer = createBuffer(4, 3);
    paintText(buffer, 0, 0, 1, 1, [], RED, WHITE);
    expect(picture(buffer, 0, 0, 4, 3, LEGEND)).toEqual(['....', '....', '....']);
  });
});

describe('textBounds', () => {
  it('is the cell: the advances together by the glyph height', () => {
    expect(textBounds(10, 20, [BAR, DOT])).toEqual({ left: 10, top: 20, right: 16, bottom: 23 });
  });

  it('includes a glyph that reaches past its advance', () => {
    expect(textBounds(1, 0, [glyph(['..##', '##..'], 2)])).toEqual({ left: 1, top: 0, right: 5, bottom: 2 });
  });

  it('is empty for no glyphs', () => {
    const box = textBounds(7, 9, []);
    expect(box.right - box.left).toBe(0);
    expect(box.bottom - box.top).toBe(0);
  });
});
