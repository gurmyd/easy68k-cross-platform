// Lines of a wide pen (widepen.ts), against what Windows GDI drew and widened. Owner: SH2.
//
// The polygons below are GDI's WidenPath read back with GetPath (28.4 fixed point, relative to the
// line's start); the strokes are the figures of trap15-b §6.2. Whole lines in every direction and
// drawing mode are compared with the committed captures by tests/conformance/gdi/surface.test.ts
// (suites widelines, polylines, modes, clip, pens).

import { describe, expect, it } from 'vitest';
import { emitDot } from './raster';
import { penDot } from './tables/dots';
import { createRandom } from './testing';
import { fillPolygons, strokeWideLine, widenSegment, type FixPoint } from './widepen';

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

const pairs = (list: readonly (readonly [number, number])[]): FixPoint[] => list.map(([x, y]) => ({ x, y }));
/** Without repeated points (GDI's path repeats a point where a line of length zero turns). */
const distinct = (pts: readonly FixPoint[]) =>
  pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y);

describe('widenSegment: the polygon GDI fills (WidenPath)', () => {
  it('equals GDI for horizontal, diagonal and steep lines', () => {
    const measured: [number, FixPoint, FixPoint, [number, number][]][] = [
      [
        7,
        { x: 0, y: 0 },
        { x: 160, y: 0 },
        [
          [0, -56],
          [-39, -38],
          [-55, 0],
          [-39, 38],
          [0, 56],
          [160, 56],
          [199, 38],
          [215, 0],
          [199, -38],
          [160, -56],
        ],
      ],
      [
        7,
        { x: 0, y: 0 },
        { x: 160, y: 160 },
        [
          [40, -40],
          [0, -55],
          [-39, -38],
          [-55, 0],
          [-40, 40],
          [120, 200],
          [160, 215],
          [199, 198],
          [215, 160],
          [200, 120],
        ],
      ],
      [
        3,
        { x: 0, y: 0 },
        { x: 48, y: 160 },
        [
          [24, -8],
          [7, -23],
          [-7, -23],
          [-23, -7],
          [-24, 8],
          [24, 168],
          [41, 183],
          [55, 183],
          [71, 167],
          [72, 152],
        ],
      ],
      [
        2,
        { x: 0, y: 0 },
        { x: 160, y: 48 },
        [
          [8, -16],
          [-7, -15],
          [-15, 0],
          [-8, 16],
          [152, 64],
          [167, 63],
          [175, 48],
          [168, 32],
        ],
      ],
    ];
    for (const [width, p0, p1, path] of measured) {
      expect(widenSegment(width, p0, p1), `width ${width} to (${p1.x},${p1.y})`).toEqual(pairs(path));
    }
  });

  it('breaks ties between two guide vertices as GDI does (vertical lines, a 45-degree tie)', () => {
    expect(widenSegment(4, { x: 0, y: 0 }, { x: 0, y: 320 })).toEqual(
      pairs([
        [32, 8],
        [31, -7],
        [23, -23],
        [7, -31],
        [-7, -31],
        [-23, -23],
        [-32, -8],
        [-32, 312],
        [-31, 327],
        [-23, 343],
        [-7, 351],
        [7, 351],
        [23, 343],
        [32, 328],
      ]),
    );
    expect(widenSegment(4, { x: 0, y: 320 }, { x: 0, y: 0 })).toEqual(
      pairs([
        [-32, 328],
        [-23, 343],
        [-7, 351],
        [7, 351],
        [23, 343],
        [31, 327],
        [32, 312],
        [32, -8],
        [23, -23],
        [7, -31],
        [-7, -31],
        [-23, -23],
        [-31, -7],
        [-32, 8],
      ]),
    );
    // Width 59 towards (770, -638) pixels: two guide vertices are exactly equally far.
    expect(widenSegment(59, { x: 0, y: 0 }, { x: 12320, y: -10208 })).toEqual(
      pairs([
        [-264, -392],
        [-333, -332],
        [-390, -263],
        [-434, -182],
        [-461, -94],
        [-471, 0],
        [-461, 94],
        [-434, 182],
        [-390, 263],
        [-333, 332],
        [-263, 390],
        [-183, 434],
        [-94, 461],
        [0, 471],
        [94, 461],
        [183, 434],
        [264, 392],
        [12584, -9816],
        [12653, -9876],
        [12710, -9945],
        [12754, -10026],
        [12781, -10114],
        [12791, -10208],
        [12781, -10302],
        [12754, -10390],
        [12710, -10471],
        [12653, -10540],
        [12583, -10598],
        [12503, -10642],
        [12414, -10669],
        [12320, -10679],
        [12226, -10669],
        [12137, -10642],
        [12056, -10600],
      ]),
    );
  });

  it('breaks a tie next to a nib vertex on the x axis by the sign of dy (the directions of gate I2)', () => {
    // GDI's WidenPath of a line from (0,0) one step of (dx, dy) pixels long, read back with GetPath
    // by T2's `gdi-capture nibs` (tests/conformance/gdi/golden/nibs.json, "ties"). In these directions
    // one of the two tied guide vertices lies on the x axis; the rule of the other ties (by the sign
    // of dx) took the wrong one, which drew strokes up to 15 pixels off (lines from (50,50)).
    const measured: [number, number, number, string][] = [
      [2, -1, 2, '8,16 15,0 7,-15 -8,-16 -24,16 -31,32 -23,47 -8,48'],
      [2, 1, -2, '-16,0 -7,15 7,15 16,0 32,-32 23,-47 9,-47 0,-32'],
      [2, -2, 4, '8,16 15,0 7,-15 -8,-16 -40,48 -47,64 -39,79 -24,80'],
      [7, -16, 39, '40,40 55,0 39,-38 0,-55 -40,-40 -296,584 -311,624 -295,662 -256,679 -216,664'],
      [7, 16, -39, '-56,0 -39,38 0,55 39,38 56,0 312,-624 295,-662 256,-679 217,-662 200,-624'],
      [9, -7, 17, '48,48 71,0 50,-50 0,-71 -48,-48 -160,224 -183,272 -162,322 -112,343 -64,320'],
      [9, 7, -17, '-72,0 -50,50 0,71 50,50 72,0 184,-272 162,-322 112,-343 62,-322 40,-272'],
      [11, -13, 31, '64,64 87,0 61,-61 0,-87 -64,-64 -272,432 -295,496 -269,557 -208,583 -144,560'],
      [11, 13, -31, '-88,0 -61,61 0,87 61,61 88,0 296,-496 269,-557 208,-583 147,-557 120,-496'],
      [
        12,
        -7,
        17,
        '72,72 95,0 67,-67 37,-87 0,-95 -37,-87 -72,-72 -184,200 -207,272 -179,339 -149,359 -112,367 -75,359 -40,344',
      ],
      [
        12,
        7,
        -17,
        '-96,0 -67,67 -37,87 0,95 37,87 67,67 96,0 208,-272 179,-339 149,-359 112,-367 75,-359 45,-339 16,-272',
      ],
    ];
    for (const [width, dx, dy, path] of measured) {
      const gdi = path.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
      expect(widenSegment(width, { x: 0, y: 0 }, { x: 16 * dx, y: 16 * dy }), `width ${width} (${dx},${dy})`).toEqual(
        pairs(gdi),
      );
    }
  });

  it('a line of length zero is widened as a line pointing in +x', () => {
    expect(distinct(widenSegment(6, { x: 0, y: 0 }, { x: 0, y: 0 }))).toEqual(
      pairs([
        [8, -48],
        [-7, -47],
        [-23, -39],
        [-39, -23],
        [-47, -7],
        [-47, 7],
        [-39, 23],
        [-23, 39],
        [-8, 48],
        [7, 47],
        [23, 39],
        [39, 23],
        [47, 7],
        [47, -7],
        [39, -23],
        [23, -39],
        [8, -48],
      ]),
    );
  });

  it('a line of length zero fills exactly the measured dot of its pen, for every width 2-255', () => {
    // Two tables measured separately (tables/pens.ts and tables/dots.ts) agree.
    const clip = { left: -200, top: -200, right: 200, bottom: 200 };
    for (let width = 2; width <= 255; width++) {
      const filled: string[] = [];
      fillPolygons([widenSegment(width, { x: 0, y: 0 }, { x: 0, y: 0 })], clip, (y, a, b) =>
        filled.push(`${y}:${a}..${b}`),
      );
      const dot: string[] = [];
      emitDot(penDot(width), 0, 0, (y, a, b) => dot.push(`${y}:${a}..${b}`));
      expect(filled, `width ${width}`).toEqual(dot);
    }
  }, 60_000);
});

describe('fillPolygons', () => {
  it('takes a pixel whose centre is on a left or top edge, not one on a right or bottom edge', () => {
    // The square from (16, 16) to (48, 48) in 1/16 pixel: pixel centres 1, 2 (3 is on the right edge).
    const runs: string[] = [];
    fillPolygons(
      [
        pairs([
          [16, 16],
          [48, 16],
          [48, 48],
          [16, 48],
        ]),
      ],
      { left: 0, top: 0, right: 10, bottom: 10 },
      (y, a, b) => runs.push(`${y}:${a}..${b}`),
    );
    expect(runs).toEqual(['1:1..2', '2:1..2']);
  });

  it('fills two contours by the nonzero rule: an inner contour in the same direction adds nothing', () => {
    const outer = pairs([
      [0, 0],
      [160, 0],
      [160, 160],
      [0, 160],
    ]);
    const sameWay = pairs([
      [48, 48],
      [112, 48],
      [112, 112],
      [48, 112],
    ]);
    const count = (contours: FixPoint[][]) => {
      let n = 0;
      fillPolygons(contours, { left: 0, top: 0, right: 20, bottom: 20 }, (_y, a, b) => (n += b - a + 1));
      return n;
    };
    expect(count([outer])).toBe(100);
    expect(count([outer, sameWay])).toBe(100);
    expect(count([outer, [...sameWay].reverse()])).toBe(100 - 16);
  });
});

describe('strokeWideLine', () => {
  it('reports every pixel of a stroke exactly once, whatever the direction and the width', () => {
    const random = createRandom(6_2);
    for (let n = 0; n < 600; n++) {
      const [x1, y1, x2, y2] = [random.int(-10, 109), random.int(-10, 49), random.int(-10, 109), random.int(-10, 49)];
      const counts = visits(x1, y1, x2, y2, random.int(2, 255));
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

  it('a line that crosses the 16-bit coordinate space is clipped, not walked', () => {
    const counts = visits(-32768, -32768, 32767, 32767, 7);
    expect(counts[20 * CLIP.right + 20]).toBe(1);
    expect(counts[20 * CLIP.right + 30]).toBe(0);
    expect(Math.max(...counts)).toBe(1);
  });

  it('draws the measured strokes of trap15-b §6.2', () => {
    // Horizontal lines from x to x + 10 at y = 5 with the widths 2, 3, 4, 5, 6, from x = 5, 25, 45, 65, 85.
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
