// The round dots of wide pens: the table against what was measured on GDI (trap15-b §6.2 for the
// widths 2-14; the capture of gate I1 for all widths 2-255, errata SH1 entry 14).

import { describe, expect, it } from 'vitest';
import { MAX_DOT_WIDTH, MIN_DOT_WIDTH, penDot, rectangleDot, type Dot } from './dots';

/** The dot as rows of text, `#` for its pixels, in a square just large enough. */
function drawDot(dot: Dot): string[] {
  const { reach, left, right } = dot;
  const lines: string[] = [];
  for (let i = 0; i <= 2 * reach; i++) {
    const first = (left[i] as number) + reach;
    const last = (right[i] as number) + reach;
    lines.push('.'.repeat(first) + '#'.repeat(last - first + 1) + '.'.repeat(2 * reach - last));
  }
  return lines;
}

const pixels = (dot: Dot): number => dot.left.reduce((sum, first, i) => sum + (dot.right[i] as number) - first + 1, 0);
const diameter = (dot: Dot): number => 2 * dot.reach + 1;
const widths = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * A checksum of all dots of the widths 2-255 (FNV-1a over width, row, first and last pixel of every
 * row, four bytes each, low byte first) and their number of pixels. The expected values below were
 * computed by the same rule from the pictures GDI drew, before they were turned into the table.
 */
function checksum(dotOf: (width: number) => Dot): { hash: string; pixels: number } {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  };
  let count = 0;
  for (let width = MIN_DOT_WIDTH; width <= MAX_DOT_WIDTH; width++) {
    const dot = dotOf(width);
    for (let i = 0; i <= 2 * dot.reach; i++) {
      mix(width);
      mix(i - dot.reach);
      mix(dot.left[i] as number);
      mix(dot.right[i] as number);
    }
    count += pixels(dot);
  }
  return { hash: (hash >>> 0).toString(16).padStart(8, '0'), pixels: count };
}

describe('penDot and rectangleDot (trap15-b §6.2, GDI capture)', () => {
  it('widths 2-9 are the measured shapes of the figure, for lines and rectangles alike', () => {
    for (const dotOf of [penDot, rectangleDot]) {
      expect(drawDot(dotOf(2))).toEqual(['#']);
      expect(drawDot(dotOf(3))).toEqual(['.#.', '###', '.#.']);
      expect(drawDot(dotOf(4))).toEqual(['###', '###', '###']);
      expect(drawDot(dotOf(5))).toEqual(['.###.', '#####', '#####', '#####', '.###.']);
      expect(drawDot(dotOf(6))).toEqual(['.###.', '#####', '#####', '#####', '.###.']);
      expect(drawDot(dotOf(7))).toEqual(['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..']);
      expect(drawDot(dotOf(8))).toEqual(['.#####.', '#######', '#######', '#######', '#######', '#######', '.#####.']);
      expect(drawDot(dotOf(9))).toEqual([
        '...###...',
        '.#######.',
        '.#######.',
        '#########',
        '#########',
        '#########',
        '.#######.',
        '.#######.',
        '...###...',
      ]);
    }
  });

  it('widths 2-14 have the measured diameters: 1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13', () => {
    expect(widths(2, 14).map((width) => diameter(penDot(width)))).toEqual([1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13]);
  });

  it('widths 2-20 have the measured pixel counts', () => {
    expect(widths(2, 20).map((width) => pixels(penDot(width)))).toEqual([
      1, 5, 9, 21, 21, 37, 45, 61, 69, 89, 101, 129, 145, 177, 189, 221, 241, 277, 303,
    ]);
  });

  it('width 11 is the 11 x 11 ellipse of trap15-b §6.4 (left edge offsets 4 2 1 1 0 0 from the top)', () => {
    const offsets = drawDot(penDot(11))
      .slice(0, 6)
      .map((row) => row.indexOf('#'));
    expect(offsets).toEqual([4, 2, 1, 1, 0, 0]);
  });

  it('width 16 is not the disc of that diameter: GDI fills a polygon (the measured dot)', () => {
    expect(drawDot(penDot(16))).toEqual([
      '....#######....',
      '...#########...',
      '.#############.',
      '.#############.',
      '###############',
      '###############',
      '###############',
      '###############',
      '###############',
      '###############',
      '###############',
      '.#############.',
      '.#############.',
      '...#########...',
      '....#######....',
    ]);
    // The pixels inside the circle of diameter 16 would make the second row and the second last row
    // two pixels longer (193 pixels in all); the measured dot has 189.
    expect(pixels(penDot(16))).toBe(189);
  });

  it('width 20 is lopsided: the rows 7 above and 7 below the centre end one pixel early (the measured dot)', () => {
    for (const dotOf of [penDot, rectangleDot]) {
      expect(drawDot(dotOf(20))).toEqual([
        '.....#########.....',
        '....###########....',
        '..##############...',
        '..###############..',
        '.#################.',
        '###################',
        '###################',
        '###################',
        '###################',
        '###################',
        '###################',
        '###################',
        '###################',
        '###################',
        '.#################.',
        '..###############..',
        '..##############...',
        '....###########....',
        '.....#########.....',
      ]);
    }
  });

  it('every width 2-255: 2k + 1 rows around the point, the centre row the widest, unbroken rows that narrow outwards', () => {
    for (let width = MIN_DOT_WIDTH; width <= MAX_DOT_WIDTH; width++) {
      for (const dot of [penDot(width), rectangleDot(width)]) {
        const k = Math.floor((width - 1) / 2);
        expect(dot.reach, `width ${width}`).toBe(k);
        expect(dot.left.length, `width ${width}`).toBe(2 * k + 1);
        expect(dot.right.length, `width ${width}`).toBe(2 * k + 1);
        expect([dot.left[k], dot.right[k]], `width ${width}: centre row`).toEqual([-k, k]);
        for (let i = 0; i <= 2 * k; i++) {
          const first = dot.left[i] as number;
          const last = dot.right[i] as number;
          // every row has the pixel above or below the point itself, and stays inside the square
          expect(first <= 0 && last >= 0 && first >= -k && last <= k, `width ${width}, row ${i - k}`).toBe(true);
          // towards the centre row, rows never get narrower at either end
          const inner = i < k ? i + 1 : i > k ? i - 1 : i;
          expect(first >= (dot.left[inner] as number), `width ${width}, row ${i - k}: left end`).toBe(true);
          expect(last <= (dot.right[inner] as number), `width ${width}, row ${i - k}: right end`).toBe(true);
        }
      }
    }
  }, 60_000);

  it('the whole table is what GDI drew: checksum and pixel total of the capture, widths 2-255', () => {
    expect(checksum(penDot)).toEqual({ hash: '54f12d1f', pixels: 4337763 });
    expect(checksum(rectangleDot)).toEqual({ hash: 'cba760ab', pixels: 4337737 });
  }, 60_000);

  it('a one-point rectangle differs from the pen dot at fifteen widths, by one pixel near the top and one near the bottom', () => {
    const differing = widths(MIN_DOT_WIDTH, MAX_DOT_WIDTH).filter(
      (width) => drawDot(penDot(width)).join() !== drawDot(rectangleDot(width)).join(),
    );
    expect(differing).toEqual([47, 151, 157, 163, 199, 201, 221, 223, 225, 227, 243, 245, 247, 249, 251]);
    // Width 47 (rows -23 .. 23): the pen's second row and second last row cover -7 .. 7; the
    // rectangle's second row lacks the first of those pixels and its second last row the last.
    const pen = penDot(47);
    const rectangle = rectangleDot(47);
    expect([pen.left[1], pen.right[1], pen.left[45], pen.right[45]]).toEqual([-7, 7, -7, 7]);
    expect([rectangle.left[1], rectangle.right[1], rectangle.left[45], rectangle.right[45]]).toEqual([-6, 7, -7, 6]);
    expect(pixels(pen) - pixels(rectangle)).toBe(2);
    for (const i of widths(0, 46).filter((row) => row !== 1 && row !== 45)) {
      expect([rectangle.left[i], rectangle.right[i]], `row ${i - 23}`).toEqual([pen.left[i], pen.right[i]]);
    }
  });

  it('a width outside 2-255 takes the nearest dot, and a dot is decoded once', () => {
    expect(penDot(0)).toBe(penDot(2));
    expect(penDot(1)).toBe(penDot(2));
    expect(penDot(256)).toBe(penDot(255));
    expect(rectangleDot(1000)).toBe(rectangleDot(255));
    expect(penDot(100)).toBe(penDot(100));
    expect(rectangleDot(100)).toBe(penDot(100)); // no row of its own at this width: the same dot
    expect(rectangleDot(47)).not.toBe(penDot(47));
  });
});
