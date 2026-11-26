// The rule of P9.8 point 1: floating windows placed side by side from the top right, no window
// over another while there is room, the cascade only when there is not, never over a kept part.

import { describe, expect, it } from 'vitest';
import { FLOAT_CASCADE_STEP, MIN_FLOAT_SIZE } from './dock';
import { rectsOverlap, tileWindows, type TileItem } from './tiling';

const AREA = { width: 1920, height: 993 };
const item = (panel: string, width: number, height: number, keep?: number): TileItem => ({
  panel,
  width,
  height,
  ...(keep === undefined ? {} : { keep }),
});

const noTwoOverlap = (rects: { x: number; y: number; width: number; height: number }[]) =>
  rects.every((a, i) => rects.every((b, j) => i === j || !rectsOverlap(a, b)));

describe('tileWindows (P9.8 point 1)', () => {
  it('the first window takes the top right corner of the dock, at its own size', () => {
    const [first] = tileWindows([item('hardware', 540, 632)], { area: AREA });
    expect(first).toEqual({ panel: 'hardware', rect: { x: 1380, y: 0, width: 540, height: 632 }, overlaps: false });
  });

  it('the next ones fill the column from the top down, right-aligned', () => {
    const places = tileWindows([item('hardware', 540, 632), item('memory', 640, 356)], { area: AREA });
    expect(places.map((place) => place.rect)).toEqual([
      { x: 1380, y: 0, width: 540, height: 632 },
      { x: 1280, y: 632, width: 640, height: 356 },
    ]);
    expect(noTwoOverlap(places.map((place) => place.rect))).toBe(true);
  });

  it('a full column opens a further column to the left', () => {
    const places = tileWindows([item('a', 400, 700), item('b', 300, 400), item('c', 300, 400)], { area: AREA });
    expect(places.map((place) => [place.rect.x, place.rect.y])).toEqual([
      [1520, 0],
      [1220, 0],
      [1220, 400],
    ]);
    expect(places.every((place) => !place.overlaps)).toBe(true);
    expect(noTwoOverlap(places.map((place) => place.rect))).toBe(true);
  });

  it('no window is placed left of minX; a window wider than the room is made narrower', () => {
    const [only] = tileWindows([item('hardware', 540, 632)], { area: { width: 1366, height: 681 }, minX: 880 });
    expect(only!.rect).toEqual({ x: 880, y: 0, width: 486, height: 632 });
  });

  it('only when there is no free place: cascaded 24 px over the last column, below every kept part', () => {
    const area = { width: 1366, height: 681 };
    const places = tileWindows([item('hardware', 540, 632, 272), item('memory', 640, 356), item('stack', 300, 360)], {
      area,
      minX: 880,
    });
    const [hardware, memory, stack] = places;
    expect(hardware!.overlaps).toBe(false);
    expect(memory!.overlaps).toBe(true);
    expect(stack!.overlaps).toBe(true);
    // Over the last column (x 880), 24 px further in for each, below the kept part (y 0 + 272).
    expect([memory!.rect.x, memory!.rect.y]).toEqual([880 + FLOAT_CASCADE_STEP, 272]);
    expect([stack!.rect.x, stack!.rect.y]).toEqual([880 + 2 * FLOAT_CASCADE_STEP, 272 + FLOAT_CASCADE_STEP]);
    // Never over the kept part of the Hardware window, and inside the dock.
    const kept = { x: hardware!.rect.x, y: 0, width: hardware!.rect.width, height: 272 };
    for (const place of [memory!, stack!]) {
      expect(rectsOverlap(place.rect, kept)).toBe(false);
      expect(place.rect.x + place.rect.width).toBeLessThanOrEqual(area.width);
      expect(place.rect.y + place.rect.height).toBeLessThanOrEqual(area.height);
      expect(place.rect.width).toBeGreaterThanOrEqual(MIN_FLOAT_SIZE.width);
    }
  });

  it('obstacles are avoided like windows (the first Float, P9.8 point 2)', () => {
    const strip = { x: 960, y: 0, width: 960, height: 29 };
    const [place] = tileWindows([item('x', 400, 300)], { area: AREA, obstacles: [strip] });
    expect(place!.rect).toEqual({ x: 1520, y: 29, width: 400, height: 300 });
  });

  it('a window taller than the dock is made lower, never below the minimum', () => {
    const [place] = tileWindows([item('x', 300, 5000)], { area: { width: 800, height: 500 } });
    expect(place!.rect.height).toBe(500);
    const [tiny] = tileWindows([item('x', 10, 10)], { area: AREA });
    expect([tiny!.rect.width, tiny!.rect.height]).toEqual([MIN_FLOAT_SIZE.width, MIN_FLOAT_SIZE.height]);
  });

  it('is pure and the same for the same input', () => {
    const items = [item('hardware', 540, 632, 272), item('memory', 640, 356), item('log', 440, 300)];
    expect(tileWindows(items, { area: AREA, minX: 1118 })).toEqual(tileWindows(items, { area: AREA, minX: 1118 }));
  });
});
