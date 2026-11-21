// Bringing a glyph bitmap to another cell size (ARCHITECTURE.md 3.5.1).

import { describe, expect, it } from 'vitest';
import { areaAverage, repeatPixels } from './resample';

describe('repeatPixels', () => {
  it('turns every pixel into a block', () => {
    // 2 x 2 -> 3 times as wide, twice as high
    const source = Uint8Array.from([255, 0, 0, 80]);
    expect([...repeatPixels(source, 2, 2, 3, 2)]).toEqual([
      ...[255, 255, 255, 0, 0, 0],
      ...[255, 255, 255, 0, 0, 0],
      ...[0, 0, 0, 80, 80, 80],
      ...[0, 0, 0, 80, 80, 80],
    ]);
  });

  it('factor one is a copy', () => {
    const source = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const copy = repeatPixels(source, 3, 2, 1, 1);
    expect([...copy]).toEqual([...source]);
    expect(copy).not.toBe(source);
  });
});

describe('areaAverage', () => {
  it('halving averages blocks of four', () => {
    const source = Uint8Array.from([
      ...[255, 255, 0, 0],
      ...[255, 0, 0, 0],
      ...[10, 20, 100, 100],
      ...[30, 40, 100, 100],
    ]);
    // (255+255+255+0)/4 = 191.25, (10+20+30+40)/4 = 25
    expect([...areaAverage(source, 4, 4, 2, 2)]).toEqual([191, 0, 25, 100]);
  });

  it('a whole enlargement gives blocks, like pixel repetition', () => {
    const source = Uint8Array.from([255, 0, 64, 128]);
    expect([...areaAverage(source, 2, 2, 4, 4)]).toEqual([...repeatPixels(source, 2, 2, 2, 2)]);
  });

  it('a factor of one and a half weights each source pixel by the part inside the result pixel', () => {
    // one row 255 0 -> three pixels: all of the first, half of each, all of the second
    expect([...areaAverage(Uint8Array.from([255, 0]), 2, 1, 3, 1)]).toEqual([255, 128, 0]);
    // 3 -> 2: each result pixel covers one and a half source pixels
    expect([...areaAverage(Uint8Array.from([255, 0, 255]), 3, 1, 2, 1)]).toEqual([170, 170]);
  });

  it('keeps full and empty areas exactly full and empty', () => {
    const full = new Uint8Array(7 * 11).fill(255);
    expect(areaAverage(full, 7, 11, 16, 31).every((value) => value === 255)).toBe(true);
    expect(areaAverage(new Uint8Array(7 * 11), 7, 11, 5, 3).every((value) => value === 0)).toBe(true);
  });

  it('gives the size asked for', () => {
    expect(areaAverage(new Uint8Array(14 * 27), 14, 27, 16, 31)).toHaveLength(16 * 31);
  });
});
