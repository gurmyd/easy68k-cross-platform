// Flood fill: the rules of trap15-b §6.6 and the speed criterion (SH1 acceptance, ARCHITECTURE.md 9.2).

import { describe, expect, it } from 'vitest';
import type { PixelBuffer } from '../../../contracts';
import { floodFill } from './flood';
import { createBuffer } from './raster';
import { createMix, rop, setMix } from './rop';
import { BLACK, countPixels, createRandom, GREEN, picture, RED, WHITE } from './testing';

const red = (mode = 4) => setMix(createMix(), mode, RED);

/** A buffer from rows of text: `.` black, `#` white, `R` red, `g` green. */
function fromPicture(rows: readonly string[]): PixelBuffer {
  const colors: Record<string, number> = { '.': BLACK, '#': WHITE, R: RED, g: GREEN };
  const buffer = createBuffer((rows[0] as string).length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++)
      buffer.data[y * buffer.width + x] = (0xff000000 | (colors[row[x] as string] as number)) >>> 0;
  });
  return buffer;
}

const LEGEND = { [BLACK]: '.', [WHITE]: '#', [RED]: 'R', [GREEN]: 'g' };
const show = (buffer: PixelBuffer) => picture(buffer, 0, 0, buffer.width, buffer.height, LEGEND);

/**
 * The region of trap15-b §6.6, found the slow and obvious way: every pixel reachable from (x, y)
 * through left, right, upper and lower neighbours of the start pixel's colour. Paints it with
 * `value` and returns the number of pixels.
 */
function referenceFill(buffer: PixelBuffer, x: number, y: number, value: number): number {
  const { width, height, data } = buffer;
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const target = data[y * width + x] as number;
  const seen = new Uint8Array(width * height);
  const queue = [y * width + x];
  seen[queue[0] as number] = 1;
  for (let next = 0; next < queue.length; next++) {
    const index = queue[next] as number;
    const px = index % width;
    const neighbours = [
      px > 0 ? index - 1 : -1,
      px < width - 1 ? index + 1 : -1,
      index >= width ? index - width : -1,
      index < width * (height - 1) ? index + width : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour >= 0 && !seen[neighbour] && data[neighbour] === target) {
        seen[neighbour] = 1;
        queue.push(neighbour);
      }
    }
  }
  for (const index of queue) data[index] = value;
  return queue.length;
}

describe('floodFill (trap15-b §6.6)', () => {
  it('fills the pixels connected to the start through horizontal and vertical neighbours', () => {
    const buffer = fromPicture(['..........', '.#######..', '.#.....#..', '.#.....#..', '.#######..', '..........']);
    expect(floodFill(buffer, 3, 2, red())).toEqual({ left: 2, top: 2, right: 7, bottom: 4 });
    expect(show(buffer)).toEqual(['..........', '.#######..', '.#RRRRR#..', '.#RRRRR#..', '.#######..', '..........']);
  });

  it('is 4-connected: a one-pixel diagonal line is a boundary', () => {
    const buffer = fromPicture(['#.....', '.#....', '..#...', '...#..', '....#.', '.....#']);
    floodFill(buffer, 5, 0, red());
    expect(show(buffer)).toEqual(['#RRRRR', '.#RRRR', '..#RRR', '...#RR', '....#R', '.....#']);
  });

  it('the surface edge bounds the region', () => {
    const buffer = createBuffer(7, 5);
    expect(floodFill(buffer, 0, 0, red())).toEqual({ left: 0, top: 0, right: 7, bottom: 5 });
    expect(countPixels(buffer, RED)).toBe(35);
  });

  it('a start point outside the surface does nothing', () => {
    const buffer = createBuffer(7, 5);
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [7, 0],
      [0, 5],
      [-32768, 32767],
      [32767, -32768],
    ] as const) {
      expect(floodFill(buffer, x, y, red())).toBeNull();
    }
    expect(countPixels(buffer, BLACK)).toBe(35);
  });

  it('the target is the exact colour of the start pixel: a colour one bit away is a boundary', () => {
    const buffer = createBuffer(5, 1);
    buffer.data[2] = 0xff000001;
    floodFill(buffer, 0, 0, red());
    expect(Array.from(buffer.data, (pixel) => pixel & 0xffffff)).toEqual([RED, RED, 0x000001, BLACK, BLACK]);
  });

  it('a region that already has the fill colour is painted again: nothing shows in Copy mode ...', () => {
    const buffer = fromPicture(['.RRR.', '.RRR.']);
    expect(floodFill(buffer, 2, 0, red())).toBeNull();
    expect(show(buffer)).toEqual(['.RRR.', '.RRR.']);
  });

  it('... but in mode 14 it becomes black', () => {
    const buffer = fromPicture(['.RRR.', '.RRR.']);
    floodFill(buffer, 2, 0, red(14));
    expect(show(buffer)).toEqual(['.....', '.....']);
  });

  it('paints through the drawing mode: each of the 16 operations, each pixel combined once', () => {
    for (let mode = 0; mode < 16; mode++) {
      const buffer = fromPicture(['g.g..', 'ggg.g', '.g.gg']);
      const fill = setMix(createMix(), mode, 0xf0f00f);
      floodFill(buffer, 0, 0, fill);
      const painted = rop(mode, 0xf0f00f, GREEN);
      // The region is the six connected green pixels on the left; the three on the right stay green.
      if (painted === GREEN) {
        expect(show(buffer), `mode ${mode}`).toEqual(['g.g..', 'ggg.g', '.g.gg']);
      } else if (painted === BLACK) {
        expect(show(buffer), `mode ${mode}`).toEqual(['.....', '....g', '...gg']);
      } else {
        const legend = { ...LEGEND, [painted]: 'P' };
        expect(picture(buffer, 0, 0, 5, 3, legend), `mode ${mode}`).toEqual(['P.P..', 'PPP.g', '.P.gg']);
      }
    }
  });

  it('mode 2 changes nothing', () => {
    const buffer = fromPicture(['..#..', '.....']);
    expect(floodFill(buffer, 0, 0, red(2))).toBeNull();
    expect(show(buffer)).toEqual(['..#..', '.....']);
  });

  it('follows a winding corridor and leaves enclosed islands alone', () => {
    const buffer = fromPicture([
      '.#.......#',
      '.#.#####.#',
      '.#.#...#.#',
      '.#.#.#.#.#',
      '.#...#...#',
      '.#########',
      '..........',
    ]);
    floodFill(buffer, 2, 0, red());
    expect(show(buffer)).toEqual([
      '.#RRRRRRR#',
      '.#R#####R#',
      '.#R#RRR#R#',
      '.#R#R#R#R#',
      '.#RRR#RRR#',
      '.#########',
      '..........',
    ]);
  });

  it('equals the obvious breadth-first fill on 1000 random pictures', () => {
    const random = createRandom(6_6);
    const palette = [BLACK, WHITE, RED, GREEN];
    for (let n = 0; n < 1000; n++) {
      const width = random.int(1, 40);
      const height = random.int(1, 30);
      const buffer = createBuffer(width, height);
      // noise of two to four colours, sparse or dense, so that regions are large or ragged
      const colors = random.int(2, 4);
      const density = random.pick([3, 10, 25, 50]);
      for (let i = 0; i < buffer.data.length; i++) {
        const color = random.int(0, 99) < density ? (palette[random.int(1, colors - 1)] as number) : BLACK;
        buffer.data[i] = (0xff000000 | color) >>> 0;
      }
      const x = random.int(-2, width + 1);
      const y = random.int(-2, height + 1);
      const mode = random.pick([4, 4, 4, 14, 3, 10, 7]);
      const fill = setMix(createMix(), mode, 0x00ffff);
      const expected = { width, height, data: buffer.data.slice() };
      const inside = x >= 0 && y >= 0 && x < width && y < height;
      if (inside) {
        const before = expected.data[y * width + x] as number;
        referenceFill(expected, x, y, (0xff000000 | rop(mode, 0x00ffff, before & 0xffffff)) >>> 0);
      }
      const before = buffer.data.slice();
      const box = floodFill(buffer, x, y, fill);
      expect(buffer.data, `picture ${n}`).toEqual(expected.data);
      // the box is exactly the bounding box of what changed
      let [left, top, right, bottom] = [width, height, 0, 0];
      for (let i = 0; i < before.length; i++) {
        if (before[i] === buffer.data[i]) continue;
        left = Math.min(left, i % width);
        right = Math.max(right, (i % width) + 1);
        top = Math.min(top, Math.floor(i / width));
        bottom = Math.max(bottom, Math.floor(i / width) + 1);
      }
      expect(box, `picture ${n}`).toEqual(right === 0 ? null : { left, top, right, bottom });
    }
  }, 120_000);

  it('fills a comb of 2000 one-pixel teeth (many more seeds than the first allocation)', () => {
    const width = 4001;
    const buffer = createBuffer(width, 3);
    for (let x = 1; x < width; x += 2) buffer.data[2 * width + x] = 0xffffffff; // teeth: every other pixel of row 2
    floodFill(buffer, 0, 0, red());
    expect(countPixels(buffer, RED)).toBe(2 * width + 2001);
    expect(countPixels(buffer, WHITE)).toBe(2000);
  });
});

describe('speed (ARCHITECTURE.md 9.2: a 1920x1200 flood fill takes under 30 ms)', () => {
  /** Best time of several runs, in milliseconds. */
  function best(runs: number, prepare: () => PixelBuffer, run: (buffer: PixelBuffer) => void): number {
    let fastest = Infinity;
    for (let n = 0; n < runs; n++) {
      const buffer = prepare();
      const start = performance.now();
      run(buffer);
      fastest = Math.min(fastest, performance.now() - start);
    }
    return fastest;
  }

  /**
   * What this machine can do at this moment: one pass over as many pixels that reads and writes
   * each of them. Fifteen engineers share the machine while the packages are built, and a time
   * limit alone would fail when it is busy; the fill may instead take a fixed multiple of this.
   */
  function yardstick(pixels: number): number {
    return best(
      7,
      () => createBuffer(pixels, 1),
      (buffer) => {
        const data = buffer.data;
        for (let i = 0; i < data.length; i++) data[i] = ((data[i] as number) & 0x00ffff00) ^ 0xff0000ff;
      },
    );
  }

  const cases: [string, () => PixelBuffer, number, number][] = [
    ['an empty surface', () => createBuffer(1920, 1200), 960, 600],
    [
      'a surface divided into 40-pixel cells by walls with one gap each',
      () => {
        const buffer = createBuffer(1920, 1200);
        for (let y = 0; y < 1200; y++) {
          for (let x = 0; x < 1920; x++) {
            const wall = (x % 40 === 0 && y % 40 !== 20) || (y % 40 === 0 && x % 40 !== 20);
            if (wall) buffer.data[y * 1920 + x] = 0xffffffff;
          }
        }
        return buffer;
      },
      961,
      601,
    ],
  ];

  for (const [name, prepare, x, y] of cases) {
    it(`${name}: the best of 9 runs is under 30 ms`, () => {
      const fill = best(9, prepare, (buffer) => {
        const box = floodFill(buffer, x, y, red());
        if (!box || box.right - box.left < 1900 || box.bottom - box.top < 1190) throw new Error('not filled');
      });
      const pass = yardstick(1920 * 1200);
      // Under 30 ms on a quiet machine. On a busy one, at most 8 single passes over the pixels.
      expect(fill < 30 || fill < 8 * pass, `flood fill ${fill.toFixed(1)} ms, one pass ${pass.toFixed(1)} ms`).toBe(
        true,
      );
    }, 120_000);
  }
});
