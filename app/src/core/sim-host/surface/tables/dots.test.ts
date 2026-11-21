// The round dots of wide pens against the measurements of trap15-b §6.2.

import { describe, expect, it } from 'vitest';
import { dotRows } from './dots';

/** The dot as rows of text, `#` for its pixels, in a square just large enough. */
function drawDot(width: number): string[] {
  const rows = dotRows(width);
  const radius = rows.length - 1;
  const lines: string[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const half = rows[Math.abs(dy)] as number;
    lines.push('.'.repeat(radius - half) + '#'.repeat(2 * half + 1) + '.'.repeat(radius - half));
  }
  return lines;
}

const pixels = (width: number) => dotRows(width).reduce((sum, half, i) => sum + (2 * half + 1) * (i === 0 ? 1 : 2), 0);
const diameter = (width: number) => 2 * dotRows(width).length - 1;

describe('dotRows (trap15-b §6.2)', () => {
  it('widths 2-9 are the measured shapes of the figure', () => {
    expect(drawDot(2)).toEqual(['#']);
    expect(drawDot(3)).toEqual(['.#.', '###', '.#.']);
    expect(drawDot(4)).toEqual(['###', '###', '###']);
    expect(drawDot(5)).toEqual(['.###.', '#####', '#####', '#####', '.###.']);
    expect(drawDot(6)).toEqual(['.###.', '#####', '#####', '#####', '.###.']);
    expect(drawDot(7)).toEqual(['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..']);
    expect(drawDot(8)).toEqual(['.#####.', '#######', '#######', '#######', '#######', '#######', '.#####.']);
    expect(drawDot(9)).toEqual([
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
  });

  it('widths 2-14 have the measured diameters: 1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13', () => {
    expect(Array.from({ length: 13 }, (_, i) => diameter(i + 2))).toEqual([1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13]);
  });

  it('widths 2-14 have the measured pixel counts: 1, 5, 9, 21, 21, 37, 45, 61, 69, 89, 101, 129, 145', () => {
    expect(Array.from({ length: 13 }, (_, i) => pixels(i + 2))).toEqual([
      1, 5, 9, 21, 21, 37, 45, 61, 69, 89, 101, 129, 145,
    ]);
  });

  it('width 11 is the 11 x 11 ellipse of trap15-b §6.4 (left edge offsets 4 2 1 1 0 0 from the top)', () => {
    const offsets = drawDot(11)
      .slice(0, 6)
      .map((row) => row.indexOf('#'));
    expect(offsets).toEqual([4, 2, 1, 1, 0, 0]);
  });

  it('every width 2-255 gives a dot that narrows towards top and bottom and is no wider than the pen', () => {
    for (let width = 2; width <= 255; width++) {
      const rows = dotRows(width);
      expect(rows.length, `width ${width}`).toBeGreaterThan(0);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i] as number, `width ${width}, row ${i}`).toBeLessThanOrEqual(rows[i - 1] as number);
      }
      expect(diameter(width), `width ${width}`).toBeLessThanOrEqual(width);
      expect(2 * (rows[0] as number) + 1, `width ${width}`).toBe(diameter(width)); // as wide as it is high
    }
  }, 60_000);

  it('widths above 14, which nobody measured, are the pixels inside the circle of that diameter', () => {
    for (const width of [15, 16, 40, 255]) {
      const rows = dotRows(width);
      const radius = Math.ceil(width / 2);
      for (let dy = 0; dy <= radius; dy++) {
        for (let dx = 0; dx <= radius; dx++) {
          const inDot = dy < rows.length && dx <= (rows[dy] as number);
          expect(inDot, `width ${width}, (${dx},${dy})`).toBe(4 * (dx * dx + dy * dy) < width * width);
        }
      }
    }
  }, 60_000);
});
