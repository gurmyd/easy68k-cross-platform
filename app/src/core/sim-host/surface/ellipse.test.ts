// The ellipse, step by step (ellipse.ts), against values read back from Windows GDI. Owner: SH2.
//
// Every expected value here was measured on Windows GDI with a scratch probe (GetPath of the
// ellipse's curve, FlattenPath of it, Polyline and Ellipse drawn into a 32-bit DIB section); the
// pixels of whole ellipses are compared with the committed captures in ellipse.gdi.test.ts.

import { describe, expect, it } from 'vitest';
import { ellipsePolygon, ellipseQuarters, flattenBezier, giqSegment, rasterEllipse } from './ellipse';
import { walkLine } from './line';
import { createRandom } from './testing';
import type { FixPoint } from './widepen';

const SIZE = 80;
const CLIP = { left: 0, top: 0, right: SIZE, bottom: SIZE };

/** Counts of reports per pixel, outline and interior apart. */
function reports(x1: number, y1: number, x2: number, y2: number, penWidth: number, filled: boolean) {
  const outline = new Uint8Array(SIZE * SIZE);
  const interior = new Uint8Array(SIZE * SIZE);
  const order: string[] = [];
  const sink = (counts: Uint8Array, name: string) => (y: number, from: number, to: number) => {
    expect(from).toBeLessThanOrEqual(to);
    if (order[order.length - 1] !== name) order.push(name);
    if (y < 0 || y >= SIZE) return;
    for (let x = Math.max(from, 0); x <= Math.min(to, SIZE - 1); x++)
      counts[y * SIZE + x] = (counts[y * SIZE + x] as number) + 1;
  };
  rasterEllipse(x1, y1, x2, y2, penWidth, CLIP, sink(outline, 'outline'), filled ? sink(interior, 'interior') : null);
  return { outline, interior, order };
}

/** The picture in the notation of trap15-b §6.4: `#` pen, `R` fill (where the pen did not draw). */
function draw(x1: number, y1: number, x2: number, y2: number, penWidth = 1, filled = true): string[] {
  const { outline, interior } = reports(x1, y1, x2, y2, penWidth, filled);
  const rows: string[] = [];
  for (let y = y1 - 1; y <= y2 + 1; y++) {
    let row = '';
    for (let x = x1 - 1; x <= x2 + 1; x++) row += outline[y * SIZE + x] ? '#' : interior[y * SIZE + x] ? 'R' : '.';
    rows.push(row);
  }
  return rows;
}

const points = (list: string): FixPoint[] => {
  const n = list.split(' ').map(Number);
  const out: FixPoint[] = [];
  for (let i = 0; i < n.length; i += 2) out.push({ x: n[i] as number, y: n[i + 1] as number });
  return out;
};

describe('step 1: the four Bezier quarters (GetPath of Ellipse)', () => {
  it('start at the right end, go up first, control points ceil(K rx) in x and floor(K ry) in y', () => {
    // GDI's path for the boxes 3..15 (13 x 13), 3..16 (14 x 14) and 3..34 (32 x 32), in 1/16 pixel.
    const measured: [number, string][] = [
      [13, '240 144 240 91 198 48 144 48 90 48 48 91 48 144 48 197 90 240 144 240 198 240 240 197 240 144'],
      [14, '256 152 256 95 210 48 152 48 94 48 48 95 48 152 48 209 94 256 152 256 210 256 256 209 256 152'],
      [32, '544 296 544 160 433 48 296 48 159 48 48 160 48 296 48 432 159 544 296 544 433 544 544 432 544 296'],
      [10, '192 120 192 81 160 48 120 48 80 48 48 81 48 120 48 159 80 192 120 192 160 192 192 159 192 120'],
    ];
    for (const [n, path] of measured) {
      const q = ellipseQuarters(3, 3, 2 + n, 2 + n);
      const got = [q[0]![0]!, ...q.flatMap((c) => c.slice(1))];
      expect(got, `${n} x ${n}`).toEqual(points(path));
    }
  });
});

describe('step 2: flattening (FlattenPath of Ellipse)', () => {
  it('gives GDI vertices for a 20 x 14 box', () => {
    expect(ellipsePolygon(3, 3, 22, 16)).toEqual(
      points(
        '352 152 340 112 308 79 259 56 200 48 141 56 93 79 60 112 48 152 60 192 93 225 141 248 200 256 259 248 308 225 340 192 352 152',
      ),
    );
  });

  it('uses the 64-bit cracker for quarters of 1,024 pixels and more, as GDI does', () => {
    // GDI's vertex count and a checksum of its vertices (without the closing point).
    const checksum = (pts: readonly FixPoint[]) =>
      pts.reduce((s, p, k) => (s * 31 + p.x * 7 + p.y * 13 + k) % 1_000_000_007, 0);
    const measured: [number, number, number, number, number, number][] = [
      [0, 0, 2099, 2099, 128, 993818970],
      [-30000, -100, 30000, 700, 640, 857691069],
      [5, 7, 1500, 90, 108, 448366139],
    ];
    for (const [x1, y1, x2, y2, count, sum] of measured) {
      const polygon = ellipsePolygon(x1, y1, x2, y2).slice(0, -1);
      expect([polygon.length, checksum(polygon)], `${x1},${y1} - ${x2},${y2}`).toEqual([count, sum]);
    }
  });

  it('the switch between the crackers lies between 16,376 and 16,384 sixteenths', () => {
    // Boxes 2,048 and 2,049 pixels wide (quarters 16,376 and 16,384 sixteenths across): GDI's
    // vertices, the first from the 32-bit cracker, the second from the 64-bit one.
    const checksum = (pts: readonly FixPoint[]) =>
      pts.reduce((s, p, k) => (s * 31 + p.x * 7 + p.y * 13 + k) % 1_000_000_007, 0);
    const of = (w: number) => {
      const polygon = ellipsePolygon(0, 0, w - 1, 300).slice(0, -1);
      return [polygon.length, checksum(polygon)];
    };
    expect(of(2048)).toEqual([120, 917272345]);
    expect(of(2049)).toEqual([120, 934552433]);
    // Each quarter goes through one cracker or the other; the points end at the quarter's end.
    const q = ellipseQuarters(0, 0, 2048, 300)[0] as FixPoint[];
    expect(flattenBezier(q).at(-1)).toEqual(q[3]);
  });
});

describe('step 3: cosmetic lines (GIQ)', () => {
  it('with integer end points, draws the pixels of the one-pixel line of trap15-b §6.1 without its end', () => {
    const random = createRandom(0x61);
    for (let n = 0; n < 2000; n++) {
      const [x1, y1, x2, y2] = [random.int(-5, 84), random.int(-5, 84), random.int(-5, 84), random.int(-5, 84)];
      const giq = new Set<string>();
      giqSegment(16 * x1, 16 * y1, 16 * x2, 16 * y2, CLIP, (y, from) => {
        if (from >= 0 && from < SIZE) giq.add(`${from},${y}`); // it may report a column beyond the clip
      });
      const line = new Set<string>();
      walkLine(x1, y1, x2, y2, CLIP, (x, y) => line.add(`${x},${y}`));
      expect([...giq].sort(), `(${x1},${y1}) - (${x2},${y2})`).toEqual([...line].sort());
    }
  });

  it('a segment along the lower-right edge of a diamond to its end does not draw that pixel', () => {
    // From the 4 x 8 box: (4.5, 3) - (3.4375, 4.0625) touches the right corner of pixel (3, 4) and
    // runs along its edge to the end; GDI leaves (3, 4) out.
    const drawn: string[] = [];
    giqSegment(72, 48, 55, 65, CLIP, (y, x) => drawn.push(`${x},${y}`));
    expect(drawn).not.toContain('3,4');
    expect(drawn).toContain('4,3');
  });
});

describe('the whole ellipse with a one-pixel pen', () => {
  it('draws the figures of trap15-b §6.4 (10 x 10, 12 x 12, 20 x 6)', () => {
    expect(draw(2, 2, 11, 11)).toEqual([
      '............',
      '.....##.....',
      '...##RR##...',
      '..#RRRRRR#..',
      '..#RRRRRR#..',
      '.#RRRRRRRR#.',
      '.#RRRRRRRR#.',
      '..#RRRRRR#..',
      '..#RRRRRR#..',
      '...##RR##...',
      '.....##.....',
      '............',
    ]);
    expect(draw(2, 2, 13, 13).slice(1, 13)).toEqual([
      '......##......',
      '...###RR###...',
      '..#RRRRRRRR#..',
      '..#RRRRRRRR#..',
      '..#RRRRRRRR#..',
      '.#RRRRRRRRRR#.',
      '.#RRRRRRRRRR#.',
      '..#RRRRRRRR#..',
      '..#RRRRRRRR#..',
      '..#RRRRRRRR#..',
      '...###RR###...',
      '......##......',
    ]);
    expect(draw(2, 2, 21, 7).slice(1, 7)).toEqual([
      '.......#########......',
      '..#####RRRRRRRRR####..',
      '.#RRRRRRRRRRRRRRRRRR#.',
      '.#RRRRRRRRRRRRRRRRRR#.',
      '..#####RRRRRRRR#####..',
      '.......########.......',
    ]);
  });

  it('fills first, then strokes', () => {
    expect(reports(5, 5, 30, 20, 1, true).order).toEqual(['interior', 'outline']);
  });

  it('visits pixels as often as GDI (its XOR picture): a 1 x 8 box there and back, the 2 x 2 box once', () => {
    const { outline } = reports(10, 10, 10, 17, 1, false);
    const column = Array.from({ length: 8 }, (_, i) => outline[(10 + i) * SIZE + 10]! % 2);
    expect(column).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
    const square = reports(10, 10, 11, 11, 1, false).outline;
    expect(
      [square[10 * SIZE + 10], square[11 * SIZE + 10], square[10 * SIZE + 11], square[11 * SIZE + 11]].map(
        (n) => n! % 2,
      ),
    ).toEqual([1, 1, 0, 0]);
  });

  it('a box of one point draws nothing with a one-pixel pen and the round dot with a wider one', () => {
    expect(draw(10, 10, 10, 10, 1).join('')).not.toMatch(/[#R]/);
    expect(draw(10, 10, 10, 10, 5).length).toBe(3);
    const dot = reports(10, 10, 10, 10, 5, true).outline;
    expect(dot.reduce((n, v) => n + v, 0)).toBe(21); // trap15-b §6.2: 21 pixels for width 5
  });

  it('clips to the surface and never reports a row outside it', () => {
    const rows = new Set<number>();
    rasterEllipse(
      -30000,
      -20000,
      30000,
      2000,
      1,
      CLIP,
      (y) => rows.add(y),
      (y) => rows.add(y),
    );
    expect([...rows].every((y) => y >= 0 && y < SIZE)).toBe(true);
    expect(rows.size).toBeGreaterThan(0);
  });
});

describe('wide pens', () => {
  it('the interior leaves out the outline: every pixel once, outline or interior', () => {
    const random = createRandom(0x64);
    for (let n = 0; n < 200; n++) {
      const [x1, y1] = [random.int(5, 30), random.int(5, 30)];
      const [x2, y2] = [x1 + random.int(0, 40), y1 + random.int(0, 40)];
      for (const copyMode of [false, true]) {
        const out = new Uint8Array(SIZE * SIZE);
        const sink = (y: number, from: number, to: number) => {
          for (let x = Math.max(from, 0); x <= Math.min(to, SIZE - 1); x++)
            out[y * SIZE + x] = (out[y * SIZE + x] as number) + 1;
        };
        rasterEllipse(x1, y1, x2, y2, random.int(2, 9), CLIP, sink, sink, copyMode);
        expect(Math.max(...out), `${x1},${y1} - ${x2},${y2}`).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);

  it('a filled ellipse in Copy mode takes the flattened outline, otherwise the curve (they differ)', () => {
    // GDI: Ellipse(40, 40, 59, 73) with a pen 5 wide (the box 40..58 by 40..72) draws a pen pixel at
    // (50, 38) only when the ellipse is filled in Copy mode.
    const at = (copyMode: boolean, x: number, y: number) => {
      const out = new Uint8Array(100 * 100);
      const sink = (yy: number, from: number, to: number) => {
        for (let xx = from; xx <= to; xx++) out[yy * 100 + xx] = 1;
      };
      rasterEllipse(40, 40, 58, 72, 5, { left: 0, top: 0, right: 100, bottom: 100 }, sink, () => {}, copyMode);
      return out[y * 100 + x];
    };
    expect([at(true, 50, 38), at(false, 50, 38)]).toEqual([1, 0]);
  });

  it('where two one-segment quarters meet, the join is a line join (tiny boxes, GDI pictures)', () => {
    // Captured on Windows GDI: Ellipse with a null brush in R2_XORPEN, box from (18, 18), shown with a
    // margin of 6 pixels; `#` is every pixel the pen changed. Each quarter of these boxes flattens to
    // one segment, and GDI joins the segments at the four ends as it joins two lines (the nib's own
    // vertices on the axes, not the curve's guide vertices); the guide vertices drew one to four
    // pixels too many here before (verification of SH2, round 1).
    const cases: [number, number, number, string[]][] = [
      [3, 3, 2, ['.......#.......', '......###......', '......###......', '......###......']],
      [4, 3, 2, ['.......#........', '......####......', '......####......', '......####......']],
      [
        2,
        3,
        8,
        [
          '....######....',
          '...#######....',
          '...########...',
          '...########...',
          '...########...',
          '...########...',
          '...########...',
          '...#######....',
          '....######....',
        ],
      ],
      [
        3,
        3,
        9,
        [
          '.......#.......',
          '....######.....',
          '...########....',
          '...#########...',
          '...#########...',
          '..###########..',
          '...#########...',
          '...#########...',
          '...########....',
          '....######.....',
          '.......#.......',
        ],
      ],
      [
        3,
        2,
        9,
        [
          '.......#.......',
          '....######.....',
          '...#########...',
          '...#########...',
          '..###########..',
          '..###########..',
          '...#########...',
          '...#########...',
          '....######.....',
          '.......#.......',
        ],
      ],
    ];
    for (const [w, h, pen, want] of cases) {
      const outline = new Uint8Array(SIZE * SIZE);
      rasterEllipse(
        18,
        18,
        18 + w - 1,
        18 + h - 1,
        pen,
        CLIP,
        (y, from, to) => {
          for (let x = from; x <= to; x++) outline[y * SIZE + x] = 1;
        },
        null,
      );
      const rows: string[] = [];
      for (let y = 12; y <= 18 + h - 1 + 6; y++) {
        let row = '';
        for (let x = 12; x <= 18 + w - 1 + 6; x++) row += outline[y * SIZE + x] ? '#' : '.';
        rows.push(row);
      }
      const drawn = rows.filter((r) => r.includes('#'));
      expect(drawn, `${w} x ${h}, pen ${pen}`).toEqual(want);
    }
  });
});
