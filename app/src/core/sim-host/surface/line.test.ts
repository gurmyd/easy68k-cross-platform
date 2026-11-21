// Lines of a one-pixel pen: the drawn example and the formula of trap15-b §6.1 (SH1 acceptance,
// ARCHITECTURE.md 9.2).

import { describe, expect, it } from 'vitest';
import type { PixelBuffer } from '../../../contracts';
import { drawLine, walkLine } from './line';
import { createBuffer } from './raster';
import { createMix, setMix } from './rop';
import { countPixels, createRandom, picture, WHITE } from './testing';

const white = () => setMix(createMix(), 4, WHITE);
const xorWhite = () => setMix(createMix(), 14, WHITE);

/** ceil(a / b) for whole numbers of any size, b not 0. */
function ceilDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b; // rounds towards zero
  return a % b !== 0n && a < 0n === b < 0n ? quotient + 1n : quotient;
}

/**
 * The pixels of LineTo exactly as trap15-b §6.1 states them, in exact arithmetic:
 * x-major: for each x from x1 towards x2, excluding x2, (x, y1 + ceil((x - x1) * dy / dx - 1/2));
 * y-major: for each y from y1 towards y2, excluding y2, (x1 + ceil((y - y1) * dx / dy - 1/2), y).
 */
function specPixels(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const pixels: [number, number][] = [];
  if (dx === 0 && dy === 0) return pixels;
  // ceil(n / d - 1/2) = ceil((2n - d) / (2d))
  const across = (n: number, d: number) => Number(ceilDiv(2n * BigInt(n) - BigInt(d), 2n * BigInt(d)));
  if (Math.abs(dx) >= Math.abs(dy)) {
    for (let x = x1; x !== x2; x += Math.sign(dx)) pixels.push([x, y1 + across((x - x1) * dy, dx)]);
  } else {
    for (let y = y1; y !== y2; y += Math.sign(dy)) pixels.push([x1 + across((y - y1) * dx, dy), y]);
  }
  return pixels;
}

/** A buffer with the given pixels white, as far as it has them. */
function plotted(width: number, height: number, pixels: readonly (readonly [number, number])[]): PixelBuffer {
  const buffer = createBuffer(width, height);
  for (const [x, y] of pixels) {
    if (x >= 0 && y >= 0 && x < width && y < height) buffer.data[y * width + x] = 0xffffffff;
  }
  return buffer;
}

function drawn(width: number, height: number, x1: number, y1: number, x2: number, y2: number): PixelBuffer {
  const buffer = createBuffer(width, height);
  drawLine(buffer, x1, y1, x2, y2, white());
  return buffer;
}

describe('drawLine: GDI LineTo with a one-pixel pen (trap15-b §6.1)', () => {
  it('the drawn example: (0,0) to (8,4), end point not drawn', () => {
    expect(picture(drawn(9, 5, 0, 0, 8, 4), 0, 0, 9, 5)).toEqual([
      '##.......',
      '..##.....',
      '....##...',
      '......##.',
      '.........',
    ]);
  });

  it('the same line backwards has the same pixels, apart from the end that is left out', () => {
    expect(picture(drawn(9, 5, 8, 4, 0, 0), 0, 0, 9, 5)).toEqual([
      '.#.......',
      '..##.....',
      '....##...',
      '......##.',
      '........#',
    ]);
  });

  it('a line of length zero draws nothing', () => {
    expect(countPixels(drawn(9, 5, 3, 2, 3, 2), WHITE)).toBe(0);
  });

  it('horizontal and vertical lines stop one pixel before the end point', () => {
    expect(picture(drawn(8, 1, 1, 0, 6, 0), 0, 0, 8, 1)).toEqual(['.#####..']);
    expect(picture(drawn(8, 1, 6, 0, 1, 0), 0, 0, 8, 1)).toEqual(['..#####.']);
    expect(picture(drawn(1, 6, 0, 1, 0, 5), 0, 0, 1, 6).join('')).toBe('.####.');
    expect(picture(drawn(1, 6, 0, 5, 0, 1), 0, 0, 1, 6).join('')).toBe('..####');
  });

  it('a tie goes to the smaller coordinate: up for slope 1/2, left for slope 2, in every direction', () => {
    // slope 1/2 from (4,4): at x = 5 the ideal line is at y = 4.5 (or 3.5), exactly between two pixels
    expect(specPixels(4, 4, 8, 6)).toEqual([
      [4, 4],
      [5, 4],
      [6, 5],
      [7, 5],
    ]); // 4.5 -> 4, 5.5 -> 5
    expect(specPixels(4, 4, 8, 2)).toEqual([
      [4, 4],
      [5, 3],
      [6, 3],
      [7, 2],
    ]); // 3.5 -> 3, 2.5 -> 2
    expect(specPixels(4, 4, 0, 6)).toEqual([
      [4, 4],
      [3, 4],
      [2, 5],
      [1, 5],
    ]);
    expect(specPixels(4, 4, 0, 2)).toEqual([
      [4, 4],
      [3, 3],
      [2, 3],
      [1, 2],
    ]);
    // slope 2: at y = 5 the ideal line is at x = 4.5 (or 3.5)
    expect(specPixels(4, 4, 6, 8)).toEqual([
      [4, 4],
      [4, 5],
      [5, 6],
      [5, 7],
    ]);
    expect(specPixels(4, 4, 2, 8)).toEqual([
      [4, 4],
      [3, 5],
      [3, 6],
      [2, 7],
    ]);
    expect(specPixels(4, 4, 6, 0)).toEqual([
      [4, 4],
      [4, 3],
      [5, 2],
      [5, 1],
    ]);
    expect(specPixels(4, 4, 2, 0)).toEqual([
      [4, 4],
      [3, 3],
      [3, 2],
      [2, 1],
    ]);
    for (const [x2, y2] of [
      [8, 6],
      [8, 2],
      [0, 6],
      [0, 2],
      [6, 8],
      [2, 8],
      [6, 0],
      [2, 0],
    ] as const) {
      expect(drawn(9, 9, 4, 4, x2, y2).data, `to (${x2},${y2})`).toEqual(plotted(9, 9, specPixels(4, 4, x2, y2)).data);
    }
  });

  it('equals the formula on 4000 random lines, clipped ones and slopes of exactly 1/2 and 2 included', () => {
    const random = createRandom(6_1);
    const width = 64;
    const height = 48;
    for (let n = 0; n < 4000; n++) {
      const x1 = random.int(-40, 104);
      const y1 = random.int(-40, 88);
      let x2 = random.int(-40, 104);
      let y2 = random.int(-40, 88);
      if (n % 10 === 0) {
        // a line of slope exactly 1/2 or 2, in a random direction
        const length = random.int(1, 30);
        const flat = random.int(0, 1) === 1;
        x2 = x1 + random.pick([-1, 1]) * length * (flat ? 2 : 1);
        y2 = y1 + random.pick([-1, 1]) * length * (flat ? 1 : 2);
      }
      const expected = plotted(width, height, specPixels(x1, y1, x2, y2));
      const actual = drawn(width, height, x1, y1, x2, y2);
      if (!sameData(actual, expected)) {
        expect.fail(`(${x1},${y1}) to (${x2},${y2}):\n${picture(actual, 0, 0, width, height).join('\n')}`);
      }
    }
  }, 120_000);

  it('the set of pixels does not depend on the drawing direction, apart from the end left out', () => {
    const random = createRandom(6_2);
    for (let n = 0; n < 500; n++) {
      const [x1, y1, x2, y2] = [random.int(0, 39), random.int(0, 29), random.int(0, 39), random.int(0, 29)];
      const forwards = drawn(40, 30, x1, y1, x2, y2);
      forwards.data[y2 * 40 + x2] = 0xffffffff;
      const backwards = drawn(40, 30, x2, y2, x1, y1);
      backwards.data[y1 * 40 + x1] = 0xffffffff;
      expect(sameData(forwards, backwards), `(${x1},${y1}) to (${x2},${y2})`).toBe(true);
    }
  });

  it('clips lines that come from the far corners of the 16-bit coordinate space', () => {
    const ends: [number, number, number, number][] = [
      [-32768, -32768, 32767, 32767],
      [32767, -32768, -32768, 32767],
      [-32768, 17, 32767, 23],
      [5, -32768, 9, 32767],
      [-32768, -20000, 32767, 30000],
      [32767, 30000, -32768, -20000],
      [-30000, 32767, 20011, -32768],
      [-7, -32768, 60, 32767],
      [-32768, 32767, 63, 0],
      [40, 20, 32767, -32768],
      [40, 20, -32768, 32767],
      [-32768, -32768, -32000, -32000], // nowhere near the surface
      [100, 0, 100, 47], // one column to the right of it
    ];
    for (const [x1, y1, x2, y2] of ends) {
      const expected = plotted(64, 48, specPixels(x1, y1, x2, y2));
      expect(sameData(drawn(64, 48, x1, y1, x2, y2), expected), `(${x1},${y1}) to (${x2},${y2})`).toBe(true);
    }
  }, 120_000);

  it('pen positions beyond 16 bits (after long text) still give the pixels of the formula', () => {
    for (const [x1, y1, x2, y2] of [
      [200000, 7, -3, 31],
      [-150000, -70000, 50, 40],
      [10, 300000, 30, -300000],
    ] as const) {
      const expected = plotted(64, 48, specPixels(x1, y1, x2, y2));
      expect(sameData(drawn(64, 48, x1, y1, x2, y2), expected), `(${x1},${y1}) to (${x2},${y2})`).toBe(true);
    }
  }, 120_000);

  it('combines every pixel once: drawn twice in XOR mode, the line is gone', () => {
    const buffer = createBuffer(40, 30);
    drawLine(buffer, 3, 4, 35, 21, xorWhite());
    expect(countPixels(buffer, WHITE)).toBe(32);
    drawLine(buffer, 3, 4, 35, 21, xorWhite());
    expect(countPixels(buffer, WHITE)).toBe(0);
  });

  it('mode 2 draws nothing', () => {
    const buffer = createBuffer(20, 20);
    drawLine(buffer, 0, 0, 19, 12, setMix(createMix(), 2, WHITE));
    expect(countPixels(buffer, WHITE)).toBe(0);
  });
});

describe('walkLine', () => {
  it('visits the pixels of the line in drawing order, without the end point', () => {
    const everything = { left: -100, top: -100, right: 100, bottom: 100 };
    for (const [x1, y1, x2, y2] of [
      [0, 0, 8, 4],
      [8, 4, 0, 0],
      [3, 9, -2, -5],
      [-3, 2, 7, 2],
      [5, 5, 5, -4],
      [1, 1, 1, 1],
    ] as const) {
      const visited: [number, number][] = [];
      walkLine(x1, y1, x2, y2, everything, (x, y) => visited.push([x, y]));
      expect(visited, `(${x1},${y1}) to (${x2},${y2})`).toEqual(specPixels(x1, y1, x2, y2));
    }
  });

  it('visits only what lies inside the clip rectangle', () => {
    const random = createRandom(6_3);
    for (let n = 0; n < 1000; n++) {
      const [x1, y1, x2, y2] = [random.int(-60, 60), random.int(-60, 60), random.int(-60, 60), random.int(-60, 60)];
      const left = random.int(-30, 20);
      const top = random.int(-30, 20);
      const clip = { left, top, right: left + random.int(0, 40), bottom: top + random.int(0, 40) };
      const visited: [number, number][] = [];
      walkLine(x1, y1, x2, y2, clip, (x, y) => visited.push([x, y]));
      const expected = specPixels(x1, y1, x2, y2).filter(
        ([x, y]) => x >= clip.left && x < clip.right && y >= clip.top && y < clip.bottom,
      );
      expect(visited, `(${x1},${y1}) to (${x2},${y2}) in ${JSON.stringify(clip)}`).toEqual(expected);
    }
  });
});

function sameData(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
