// Helpers for tests of the drawing surface: pictures as text, the way trap15-b §6 draws its
// examples, a repeatable random source, a hash of a picture, and two fixed scenes. For the unit
// tests next to this file, for check-surface.mjs (which draws the scenes in real browsers) and for
// any other test that looks at surface pixels; never imported by the application.
//
// Owner: SH1.

import type { Glyph, PixelBuffer, SurfaceApi } from '../../../contracts';

/** Colours as the surface stores and returns them, $00BBGGRR. */
export const BLACK = 0x000000;
export const WHITE = 0xffffff;
export const RED = 0x0000ff;
export const GREEN = 0x00ff00;
export const BLUE = 0xff0000;

/** The colour ($00BBGGRR) of pixel (x, y) of a buffer. */
export function pixelAt(buffer: PixelBuffer, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) throw new RangeError(`no pixel (${x}, ${y})`);
  return (buffer.data[y * buffer.width + x] as number) & 0xffffff;
}

/**
 * The rows `top` .. `bottom - 1` of a buffer as text, columns `left` .. `right - 1`, one character
 * per pixel. `legend` gives the character of each colour; the default is the notation of
 * trap15-b §6: `.` black, `#` white (the default pen), `R` red. Any other colour is `?`.
 */
export function picture(
  buffer: PixelBuffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
  legend: Readonly<Record<number, string>> = { [BLACK]: '.', [WHITE]: '#', [RED]: 'R' },
): string[] {
  const rows: string[] = [];
  for (let y = top; y < bottom; y++) {
    let row = '';
    for (let x = left; x < right; x++) row += legend[pixelAt(buffer, x, y)] ?? '?';
    rows.push(row);
  }
  return rows;
}

/** How many pixels of the buffer have the colour. */
export function countPixels(buffer: PixelBuffer, color: number): number {
  const pixel = (0xff000000 | color) >>> 0;
  let count = 0;
  for (let i = 0; i < buffer.data.length; i++) if (buffer.data[i] === pixel) count++;
  return count;
}

/** A 32-bit hash (FNV-1a over the pixel values) of a buffer's size and pixels, as 8 hex digits. */
export function hashPixels(buffer: PixelBuffer): string {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  };
  mix(buffer.width);
  mix(buffer.height);
  for (let i = 0; i < buffer.data.length; i++) mix(buffer.data[i] as number);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A repeatable source of random whole numbers (mulberry32). */
export function createRandom(seed: number): {
  int(low: number, high: number): number;
  pick<T>(items: readonly T[]): T;
} {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** A whole number from `low` to `high`, both included. */
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number],
  };
}

/** A glyph in the default text cell, 8 x 15 pixels, with the given pixels (x, y) set. */
export function cellGlyph(marks: readonly (readonly [number, number])[] = []): Glyph {
  const coverage = new Uint8Array(8 * 15);
  for (const [x, y] of marks) coverage[y * 8 + x] = 255;
  return { advance: 8, width: 8, height: 15, coverage };
}

/** A small square, as a stand-in for a letter. */
export const LETTER_GLYPH = cellGlyph([
  [3, 3],
  [4, 3],
  [3, 4],
  [4, 4],
]);

/** A bar low in the cell, as a stand-in for the prompt's underscore. */
export const UNDERSCORE_GLYPH = cellGlyph([1, 2, 3, 4, 5, 6].map((x) => [x, 12] as const));

/**
 * The hash (`hashPixels`) of the back buffer after `drawFixedScene` on a new 640 x 480 surface.
 * The scene uses only what SH1 owns - thin lines, rectangles of the measured pen widths, pixels,
 * flood fills, drawing modes, text, block copies - so the value changes only if one of those rules
 * changes. The unit tests check it under Node and check-surface.mjs in Chromium and WebKit: the
 * pixels do not depend on where the code runs.
 */
export const FIXED_SCENE_HASH = 'ddc19409';

/** Draws the fixed scene: 400 calls with coordinates on and off the surface. */
export function drawFixedScene(surface: SurfaceApi): void {
  const random = createRandom(2026);
  for (let n = 0; n < 400; n++) {
    const [x1, y1, x2, y2] = [random.int(-40, 680), random.int(-40, 520), random.int(-40, 680), random.int(-40, 520)];
    surface.setLineColor(random.int(0, 0xffffff));
    surface.setFillColor(random.int(0, 0xffffff));
    surface.setDrawingMode(random.pick([4, 4, 4, 4, 14, 10, 12, 3, 7, 5, 200, 22]));
    const kind = n % 8;
    if (kind === 0) {
      surface.setPenWidth(1);
      surface.line(x1, y1, x2, y2);
    } else if (kind === 1) {
      surface.setPenWidth(1);
      surface.lineTo(x2, y2);
    } else if (kind === 2) {
      surface.setPenWidth(random.int(0, 9));
      surface.rectangle(x1, y1, x2, y2);
    } else if (kind === 3) {
      surface.setPenWidth(random.int(0, 9));
      surface.unfilledRectangle(x1, y1, x1 + random.int(-30, 30), y1 + random.int(-30, 30));
    } else if (kind === 4) {
      surface.drawPixel(x1, y1);
    } else if (kind === 5) {
      surface.floodFill(x1, y1);
    } else if (kind === 6) {
      surface.textOut(x1, y1, [LETTER_GLYPH, UNDERSCORE_GLYPH], 16, random.int(0, 0xffffff), 'both');
    } else {
      surface.copyRect(
        { left: x1, top: y1, right: x1 + 100, bottom: y1 + 60 },
        { left: x2, top: y2, right: x2 + 100, bottom: y2 + 60 },
      );
    }
  }
}

/**
 * Draws a scene of ellipses and wide lines of every pen width, in several drawing modes. Their
 * pixels are SH2's (ellipse.ts, widepen.ts), so this scene has no fixed hash; it serves to compare
 * one environment with another.
 */
export function drawShapeScene(surface: SurfaceApi): void {
  const random = createRandom(88);
  for (let n = 0; n < 200; n++) {
    const [x1, y1, x2, y2] = [random.int(-40, 680), random.int(-40, 520), random.int(-40, 680), random.int(-40, 520)];
    surface.setLineColor(random.int(0, 0xffffff));
    surface.setFillColor(random.int(0, 0xffffff));
    surface.setDrawingMode(random.pick([4, 4, 4, 14, 10, 7]));
    surface.setPenWidth(random.int(0, 14));
    const kind = n % 4;
    if (kind === 0) surface.line(x1, y1, x2, y2);
    else if (kind === 1) surface.ellipse(x1, y1, x2, y2);
    else if (kind === 2) surface.unfilledEllipse(x1, y1, x1 + random.int(-90, 90), y1 + random.int(-90, 90));
    else surface.lineTo(x2, y2);
  }
}
