// The wide-pen stroke. These tests hold for the stub (the band without caps) and for any stroke that
// replaces it; the measured GDI strokes of trap15-b §6.2 are at the end, skipped until SH2 delivers.

import { describe, expect, it } from 'vitest';
import { createRandom } from './testing';
import { strokeWideLine } from './widepen';

const CLIP = { left: 0, top: 0, right: 100, bottom: 40 };

/** The stroke as a count of visits per pixel, in a 100 x 40 picture. */
function visits(x1: number, y1: number, x2: number, y2: number, width: number): Uint8Array {
  const counts = new Uint8Array(CLIP.right * CLIP.bottom);
  strokeWideLine(x1, y1, x2, y2, width, CLIP, (y, from, to) => {
    if (from > to) throw new Error(`an empty run in row ${y}: ${from}..${to}`);
    if (y < 0 || y >= CLIP.bottom) return;
    for (let x = Math.max(from, 0); x <= Math.min(to, CLIP.right - 1); x++) {
      counts[y * CLIP.right + x] = (counts[y * CLIP.right + x] as number) + 1;
    }
  });
  return counts;
}

function drawing(counts: Uint8Array, left: number, top: number, right: number, bottom: number): string[] {
  const rows: string[] = [];
  for (let y = top; y < bottom; y++) {
    let row = '';
    for (let x = left; x < right; x++) row += counts[y * CLIP.right + x] ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

describe('strokeWideLine', () => {
  it('reports every pixel of a stroke exactly once, whatever the direction and the width', () => {
    const random = createRandom(6_2);
    for (let n = 0; n < 600; n++) {
      const [x1, y1, x2, y2] = [random.int(-10, 109), random.int(-10, 49), random.int(-10, 109), random.int(-10, 49)];
      const counts = visits(x1, y1, x2, y2, random.int(2, 14));
      expect(Math.max(...counts), `(${x1},${y1}) to (${x2},${y2})`).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it('across a horizontal or vertical line the stroke covers c-a .. c+b: widths 2-6 as measured', () => {
    // trap15-b §6: width 2 covers c-1..c, width 3 c-1..c+1, width 4 c-2..c+1, width 5 c-2..c+2, 6 c-3..c+2
    const expected: Record<number, [number, number]> = { 2: [-1, 0], 3: [-1, 1], 4: [-2, 1], 5: [-2, 2], 6: [-3, 2] };
    for (const [width, [low, high]] of Object.entries(expected)) {
      const flat = visits(20, 20, 60, 20, Number(width));
      const tall = visits(50, 5, 50, 35, Number(width));
      for (let offset = -6; offset <= 6; offset++) {
        const inside = offset >= low && offset <= high;
        expect(flat[(20 + offset) * CLIP.right + 40] === 1, `width ${width}, row offset ${offset}`).toBe(inside);
        expect(tall[20 * CLIP.right + 50 + offset] === 1, `width ${width}, column offset ${offset}`).toBe(inside);
      }
    }
  });

  it('covers both end points', () => {
    const random = createRandom(6_5);
    for (let n = 0; n < 200; n++) {
      const [x1, y1, x2, y2] = [random.int(5, 94), random.int(5, 34), random.int(5, 94), random.int(5, 34)];
      const counts = visits(x1, y1, x2, y2, random.int(2, 9));
      expect(counts[y1 * CLIP.right + x1], `start of (${x1},${y1}) to (${x2},${y2})`).toBe(1);
      expect(counts[y2 * CLIP.right + x2], `end of (${x1},${y1}) to (${x2},${y2})`).toBe(1);
    }
  }, 60_000);

  it('a line of length zero is the round dot of the pen', () => {
    expect(drawing(visits(10, 10, 10, 10, 5), 7, 7, 14, 14)).toEqual([
      '.......',
      '..###..',
      '.#####.',
      '.#####.',
      '.#####.',
      '..###..',
      '.......',
    ]);
    expect(drawing(visits(10, 10, 10, 10, 2), 8, 8, 13, 13)).toEqual(['.....', '.....', '..#..', '.....', '.....']);
  });

  it('a line that crosses the 16-bit coordinate space is clipped, not walked', () => {
    const counts = visits(-32768, -32768, 32767, 32767, 7);
    expect(counts[20 * CLIP.right + 20]).toBe(1);
    expect(counts[20 * CLIP.right + 30]).toBe(0);
    expect(Math.max(...counts)).toBe(1);
  });

  // The strokes GDI draws, measured (trap15-b §6.2): horizontal lines from x to x+10 at y = 5 with the
  // widths 2, 3, 4, 5, 6, starting at x = 5, 25, 45, 65, 85. The stub lacks the round caps and, for
  // even widths, leaves the start corner of the top row in. For SH2 to switch on.
  it.skip('the measured strokes of trap15-b §6.2 (SH2: needs round caps)', () => {
    const counts = new Uint8Array(CLIP.right * CLIP.bottom);
    [5, 25, 45, 65, 85].forEach((x, i) => {
      const one = visits(x, 5, x + 10, 5, i + 2);
      for (let k = 0; k < counts.length; k++) counts[k] = (counts[k] as number) + (one[k] as number);
    });
    expect(drawing(counts, 0, 2, 100, 8)).toEqual([
      '......................................................................................##########....',
      '..............................................##########........#############.......#############...',
      '......##########.........###########........#############......###############.....###############..',
      '.....###########........#############.......#############......###############.....###############..',
      '.........................###########........#############......###############.....###############..',
      '................................................................#############.......#############...',
    ]);
  });
});
