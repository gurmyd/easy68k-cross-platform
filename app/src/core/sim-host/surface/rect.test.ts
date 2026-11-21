// Rectangles: the drawn examples and the three cases of trap15-b §6.3 (SH1 acceptance,
// ARCHITECTURE.md 9.2).

import { describe, expect, it } from 'vitest';
import { createBuffer } from './raster';
import { drawRectangle } from './rect';
import { createMix, setMix, rop } from './rop';
import { dotRows } from './tables/dots';
import { countPixels, createRandom, picture, pixelAt, RED, WHITE } from './testing';

const pen = (mode = 4, color = WHITE) => setMix(createMix(), mode, color);
const fill = (mode = 4, color = RED) => setMix(createMix(), mode, color);

/**
 * What trap15-b §6.3 says about one pixel of the rectangle (x1,y1)-(x2,y2) drawn with a pen of
 * width `penWidth`: 'pen' for the outline, 'fill' for the interior, null for a pixel left alone.
 * 'twice' is the one thing the spec does not have and the GDI capture shows: in a run of a
 * one-pixel pen (case B) the pixels between the two ends are combined with the pen two times.
 * Written pixel by pixel from the text of the spec, on purpose not the way rect.ts cuts the frame
 * into blocks.
 */
function specAt(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  penWidth: number,
): 'pen' | 'twice' | 'fill' | null {
  if (x1 > x2) [x1, x2] = [x2, x1];
  if (y1 > y2) [y1, y2] = [y2, y1];
  const w = Math.max(penWidth, 1);
  const a = Math.floor(w / 2);
  const b = Math.floor((w - 1) / 2);
  const within = (v: number, low: number, high: number) => v >= low && v <= high;
  if (x1 < x2 && y1 < y2) {
    // Case A: the frame between the outer and the inner rectangle, all bounds inclusive.
    if (!within(x, x1 - a, x2 + b) || !within(y, y1 - a, y2 + b)) return null;
    const inner = within(x, x1 + b + 1, x2 - a - 1) && within(y, y1 + b + 1, y2 - a - 1);
    return inner ? 'fill' : 'pen';
  }
  if (x1 === x2 && y1 === y2) {
    // Case C: nothing with width 1, the round dot otherwise.
    if (w === 1) return null;
    const half = dotRows(w)[Math.abs(y - y1)];
    return half !== undefined && Math.abs(x - x1) <= half ? 'pen' : null;
  }
  // Case B.
  if (w === 1) {
    if (!within(x, x1, x2) || !within(y, y1, y2)) return null;
    return (x === x1 && y === y1) || (x === x2 && y === y2) ? 'pen' : 'twice';
  }
  if (y1 === y2) return within(x, x1, x2 - 1) && within(y, y1 - a, y1 + b) ? 'pen' : null;
  return within(x, x1 - a, x1 + b) && within(y, y1, y2 - 1) ? 'pen' : null;
}

describe('drawRectangle (trap15-b §6.3)', () => {
  it('the drawn examples: (2,2)-(8,6), (12,2)-(12,6), (16,2)-(20,2), (24,2)-(24,2), (28,2)-(29,3), (33,2)-(35,4)', () => {
    const buffer = createBuffer(39, 8);
    for (const [x1, y1, x2, y2] of [
      [2, 2, 8, 6],
      [12, 2, 12, 6],
      [16, 2, 20, 2],
      [24, 2, 24, 2],
      [28, 2, 29, 3],
      [33, 2, 35, 4],
    ] as const) {
      drawRectangle(buffer, x1, y1, x2, y2, 1, pen(), fill());
    }
    expect(picture(buffer, 0, 2, 39, 7)).toEqual([
      '..#######...#...#####.......##...###...',
      '..#RRRRR#...#...............##...#R#...',
      '..#RRRRR#...#....................###...',
      '..#RRRRR#...#..........................',
      '..#######...#..........................',
    ]);
    // and nothing outside the rows the spec shows
    expect(picture(buffer, 0, 0, 39, 2)).toEqual(['.'.repeat(39), '.'.repeat(39)]);
    expect(picture(buffer, 0, 7, 39, 8)).toEqual(['.'.repeat(39)]);
  });

  it('task 90 leaves the interior untouched', () => {
    const buffer = createBuffer(12, 9);
    buffer.data.fill(0xff00ff00); // green
    drawRectangle(buffer, 2, 2, 8, 6, 1, pen(), null);
    expect(picture(buffer, 0, 0, 12, 9, { 0x00ff00: 'g', [WHITE]: '#' })).toEqual([
      'gggggggggggg',
      'gggggggggggg',
      'gg#######ggg',
      'gg#ggggg#ggg',
      'gg#ggggg#ggg',
      'gg#ggggg#ggg',
      'gg#######ggg',
      'gggggggggggg',
      'gggggggggggg',
    ]);
  });

  it('reversed corners are swapped per axis', () => {
    const straight = createBuffer(20, 20);
    drawRectangle(straight, 3, 4, 15, 12, 3, pen(), fill());
    for (const [x1, y1, x2, y2] of [
      [15, 12, 3, 4],
      [15, 4, 3, 12],
      [3, 12, 15, 4],
    ] as const) {
      const other = createBuffer(20, 20);
      drawRectangle(other, x1, y1, x2, y2, 3, pen(), fill());
      expect(other.data, `(${x1},${y1})-(${x2},${y2})`).toEqual(straight.data);
    }
  });

  it('pen width 0 draws like pen width 1', () => {
    const zero = createBuffer(20, 20);
    const one = createBuffer(20, 20);
    drawRectangle(zero, 3, 4, 15, 12, 0, pen(), fill());
    drawRectangle(one, 3, 4, 15, 12, 1, pen(), fill());
    expect(zero.data).toEqual(one.data);
  });

  it('case A with a wide pen: a square-cornered frame c-a .. c+b around each side', () => {
    // width 4: a = 2, b = 1. Outer 2..13 by 2..9; inner 6..9 by 6..5 is empty, so everything is outline.
    const all = createBuffer(16, 12);
    drawRectangle(all, 4, 4, 12, 8, 4, pen(), fill());
    expect(picture(all, 0, 0, 16, 12)).toEqual([
      '................',
      '................',
      '..############..',
      '..############..',
      '..############..',
      '..############..',
      '..############..',
      '..############..',
      '..############..',
      '..############..',
      '................',
      '................',
    ]);
    // width 3: a = 1, b = 1. Outer 3..13 by 3..10, inner 6..10 by 6..7.
    const framed = createBuffer(17, 14);
    drawRectangle(framed, 4, 4, 12, 9, 3, pen(), fill());
    expect(picture(framed, 0, 0, 17, 14)).toEqual([
      '.................',
      '.................',
      '.................',
      '...###########...',
      '...###########...',
      '...###########...',
      '...###RRRRR###...',
      '...###RRRRR###...',
      '...###########...',
      '...###########...',
      '...###########...',
      '.................',
      '.................',
      '.................',
    ]);
    // width 2: a = 1, b = 0. Outer 3..12 by 3..9, inner 5..10 by 5..7: thicker towards the top left.
    const two = createBuffer(16, 13);
    drawRectangle(two, 4, 4, 12, 9, 2, pen(), fill());
    expect(picture(two, 0, 0, 16, 13)).toEqual([
      '................',
      '................',
      '................',
      '...##########...',
      '...##########...',
      '...##RRRRRR##...',
      '...##RRRRRR##...',
      '...##RRRRRR##...',
      '...##########...',
      '...##########...',
      '................',
      '................',
      '................',
    ]);
  });

  it('case B with a wide pen: a flat-ended bar that leaves out its far end', () => {
    // horizontal, width 3: x1 .. x2-1 by y-1 .. y+1
    const flat = createBuffer(14, 7);
    drawRectangle(flat, 3, 3, 10, 3, 3, pen(), fill());
    expect(picture(flat, 0, 0, 14, 7)).toEqual([
      '..............',
      '..............',
      '...#######....',
      '...#######....',
      '...#######....',
      '..............',
      '..............',
    ]);
    // vertical, width 4: x-2 .. x+1 by y1 .. y2-1
    const tall = createBuffer(9, 9);
    drawRectangle(tall, 4, 2, 4, 7, 4, pen(), fill());
    expect(picture(tall, 0, 0, 9, 9)).toEqual([
      '.........',
      '.........',
      '..####...',
      '..####...',
      '..####...',
      '..####...',
      '..####...',
      '.........',
      '.........',
    ]);
    // the far end is the larger coordinate, whichever corner was given first
    const reversed = createBuffer(14, 7);
    drawRectangle(reversed, 10, 3, 3, 3, 3, pen(), fill());
    expect(reversed.data).toEqual(flat.data);
  });

  it('case C: one point draws nothing with pen width 1', () => {
    const buffer = createBuffer(9, 9);
    drawRectangle(buffer, 4, 4, 4, 4, 1, pen(), fill());
    drawRectangle(buffer, 4, 4, 4, 4, 0, pen(), fill());
    expect(countPixels(buffer, WHITE) + countPixels(buffer, RED)).toBe(0);
  });

  it('case C with a wide pen: the round dots of trap15-b §6.2, widths 2-9, as drawn there', () => {
    const buffer = createBuffer(100, 16);
    [6, 18, 30, 42, 54, 66, 78, 90].forEach((x, i) => drawRectangle(buffer, x, 10, x, 10, i + 2, pen(), fill()));
    expect(picture(buffer, 0, 6, 100, 15)).toEqual([
      '.........................................................................................###........',
      '.................................................................###........#####......#######......',
      '.........................................###.........###........#####......#######.....#######......',
      '..................#..........###........#####.......#####......#######.....#######....#########.....',
      '......#..........###.........###........#####.......#####......#######.....#######....#########.....',
      '..................#..........###........#####.......#####......#######.....#######....#########.....',
      '.........................................###.........###........#####......#######.....#######......',
      '.................................................................###........#####......#######......',
      '.........................................................................................###........',
    ]);
    expect(countPixels(buffer, WHITE)).toBe(1 + 5 + 9 + 21 + 21 + 37 + 45 + 61);
  });

  it('equals the three cases pixel by pixel on 6000 random rectangles, pen widths 0-12, clipped ones included', () => {
    const random = createRandom(6_3);
    const width = 48;
    const height = 40;
    const counts = { A: 0, B: 0, C: 0 };
    for (let n = 0; n < 6000; n++) {
      const x1 = random.int(-20, 67);
      const y1 = random.int(-20, 59);
      let x2 = random.int(-20, 67);
      let y2 = random.int(-20, 59);
      // one rectangle in four is degenerate: case B or C
      if (n % 4 === 1) x2 = x1;
      if (n % 4 === 2) y2 = y1;
      if (n % 8 === 3) [x2, y2] = [x1, y1];
      // one in three is small, so that the frame swallows the interior
      if (n % 3 === 0 && x1 !== x2) x2 = x1 + random.int(-6, 6);
      if (n % 3 === 0 && y1 !== y2) y2 = y1 + random.int(-6, 6);
      const penWidth = random.int(0, 12);
      const filled = random.int(0, 1) === 1;
      counts[x1 !== x2 && y1 !== y2 ? 'A' : x1 === x2 && y1 === y2 ? 'C' : 'B']++;

      const buffer = createBuffer(width, height);
      drawRectangle(buffer, x1, y1, x2, y2, penWidth, pen(), filled ? fill() : null);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const part = specAt(x, y, x1, y1, x2, y2, penWidth);
          const expected = part === 'pen' || part === 'twice' ? WHITE : part === 'fill' && filled ? RED : 0;
          if (pixelAt(buffer, x, y) !== expected) {
            expect.fail(
              `(${x1},${y1})-(${x2},${y2}) width ${penWidth} ${filled ? 'filled' : 'outline'}: pixel (${x},${y})\n` +
                picture(buffer, 0, 0, width, height).join('\n'),
            );
          }
        }
      }
    }
    expect(counts.A).toBeGreaterThan(1500);
    expect(counts.B).toBeGreaterThan(1500);
    expect(counts.C).toBeGreaterThan(300);
  }, 120_000);

  it('case B with a one-pixel pen is drawn there and back: the ends once, the pixels between twice (GDI capture)', () => {
    const on = (background: number, draw: (buffer: ReturnType<typeof createBuffer>) => void) => {
      const buffer = createBuffer(64, 48);
      buffer.data.fill((0xff000000 | background) >>> 0);
      draw(buffer);
      return buffer;
    };
    // GDI case rects-05458: mode 6 (P | ~D), pen $FF0000 on $336699, task 90, (26,17)-(5,17)
    const flat = on(0x336699, (buffer) => drawRectangle(buffer, 26, 17, 5, 17, 1, pen(6, 0xff0000), null));
    expect(pixelAt(flat, 5, 17)).toBe(0xff9966); // P | ~D
    expect(pixelAt(flat, 26, 17)).toBe(0xff9966);
    for (let x = 6; x <= 25; x++) expect(pixelAt(flat, x, 17), `x ${x}`).toBe(0xff6699); // P | ~(P | ~D)
    expect(countPixels(flat, 0x336699)).toBe(64 * 48 - 22);
    // GDI case rects-08454: the same mode, pen $00FF00, task 87, vertical (55,4)-(55,33)
    const tall = on(0x336699, (buffer) => drawRectangle(buffer, 55, 4, 55, 33, 1, pen(6, 0x00ff00), fill(6, 0x00ff00)));
    expect(pixelAt(tall, 55, 4)).toBe(0xccff66);
    expect(pixelAt(tall, 55, 33)).toBe(0xccff66);
    for (let y = 5; y <= 32; y++) expect(pixelAt(tall, 55, y), `y ${y}`).toBe(0x33ff99);
    // modes 3 and 14: twice is nothing, so only the two ends change (GDI cases modes-00035, -00145)
    for (const mode of [3, 14, 15]) {
      const run = on(0x336699, (buffer) => drawRectangle(buffer, 20, 20, 20, 30, 0, pen(mode, 0x0f0ff0), null));
      expect(countPixels(run, 0x336699), `mode ${mode}`).toBe(64 * 48 - 2);
      expect(pixelAt(run, 20, 20), `mode ${mode}`).toBe(rop(mode, 0x0f0ff0, 0x336699));
      expect(pixelAt(run, 20, 30), `mode ${mode}`).toBe(rop(mode, 0x0f0ff0, 0x336699));
    }
    // a run of two pixels has no pixels between its ends
    const pair = on(0x336699, (buffer) => drawRectangle(buffer, 10, 10, 11, 10, 1, pen(14, 0xffffff), null));
    expect(pixelAt(pair, 10, 10)).toBe(0xcc9966);
    expect(pixelAt(pair, 11, 10)).toBe(0xcc9966);
    // an end that lies off the surface is simply not there (GDI case rects-00707, mode 15)
    const cut = on(0x336699, (buffer) => drawRectangle(buffer, 22, 23, 69, 23, 0, pen(15, 0xc0c0c0), null));
    expect(countPixels(cut, 0x336699)).toBe(64 * 48 - 1);
    expect(pixelAt(cut, 22, 23)).toBe(0x0c59a6);
    // wide pens draw their bar once
    const bar = on(0x336699, (buffer) => drawRectangle(buffer, 10, 10, 20, 10, 3, pen(14, 0xffffff), null));
    expect(countPixels(bar, 0xcc9966)).toBe(10 * 3);
  });

  it('combines outline and interior once each (but for that case): every one of the 16 operations, every case, pen widths 0-12', () => {
    const random = createRandom(6_4);
    const width = 40;
    const height = 32;
    const background = 0x336699;
    const penColor = 0x0f0ff0;
    const fillColor = 0xf0f00f;
    for (let n = 0; n < 1600; n++) {
      const mode = n % 16;
      const x1 = random.int(-6, 45);
      const y1 = random.int(-6, 37);
      const x2 = n % 5 === 0 ? x1 : random.int(-6, 45);
      const y2 = n % 7 === 0 ? y1 : random.int(-6, 37);
      const penWidth = random.int(0, 12);
      const buffer = createBuffer(width, height);
      buffer.data.fill((0xff000000 | background) >>> 0);
      drawRectangle(buffer, x1, y1, x2, y2, penWidth, pen(mode, penColor), fill(mode, fillColor));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const part = specAt(x, y, x1, y1, x2, y2, penWidth);
          const once = rop(mode, penColor, background);
          const expected =
            part === 'pen'
              ? once
              : part === 'twice'
                ? rop(mode, penColor, once)
                : part === 'fill'
                  ? rop(mode, fillColor, background)
                  : background;
          if (pixelAt(buffer, x, y) !== expected) {
            expect.fail(`mode ${mode}, (${x1},${y1})-(${x2},${y2}) width ${penWidth}: pixel (${x},${y})`);
          }
        }
      }
    }
  }, 120_000);

  it('clips a rectangle far larger than the surface, and one that misses it', () => {
    const huge = createBuffer(32, 24);
    drawRectangle(huge, -32768, -32768, 32767, 32767, 5, pen(), fill());
    expect(countPixels(huge, RED)).toBe(32 * 24); // all interior
    const edge = createBuffer(32, 24);
    drawRectangle(edge, -32768, 10, 32767, 32767, 1, pen(), fill());
    expect(picture(edge, 0, 9, 32, 12)).toEqual(['.'.repeat(32), '#'.repeat(32), 'R'.repeat(32)]);
    const missed = createBuffer(32, 24);
    drawRectangle(missed, 100, 100, 200, 200, 12, pen(), fill());
    drawRectangle(missed, -200, -200, -100, -100, 12, pen(), fill());
    expect(countPixels(missed, 0)).toBe(32 * 24);
  });
});
