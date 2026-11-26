// The rule of P9.8 point 1: floating windows placed side by side from the top right, no window
// over another while there is room, the cascade only when there is not, never over a kept part.

import { describe, expect, it } from 'vitest';
import { FLOAT_CASCADE_STEP, MIN_FLOAT_SIZE } from './dock';
import { keptRoom, rectsOverlap, tileWindows, type TileItem } from './tiling';

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

  it('without `further`, nothing is placed left of minX (P9.8)', () => {
    const area = { width: 1920, height: 993 };
    const places = tileWindows([item('a', 540, 632), item('b', 640, 356), item('c', 300, 360)], { area, minX: 1126 });
    expect(places[2]!.overlaps).toBe(true);
    expect(places.every((place) => place.rect.x >= 1126)).toBe(true);
  });

  it('with `further` (P9.9 point 2): a full room opens further columns at its left, over the docked panels, before any overlap', () => {
    const area = { width: 1920, height: 993 };
    const items = [
      item('hardware', 540, 632, 272),
      item('memory', 640, 356),
      item('stack', 300, 360),
      item('breakpoints', 560, 300),
      item('log', 440, 300),
    ];
    const places = tileWindows(items, { area, minX: 1126, further: true });
    expect(places.every((place) => !place.overlaps)).toBe(true);
    expect(noTwoOverlap(places.map((place) => place.rect))).toBe(true);
    // The first two fill the room; Stack goes to the top of the next column at its left.
    expect(places.slice(0, 2).every((place) => place.rect.x >= 1126)).toBe(true);
    expect(places[2]!.rect).toEqual({ x: 1080, y: 0, width: 300, height: 360 });
    expect(places.slice(2).every((place) => place.rect.x < 1126)).toBe(true);
  });

  it('a window marked inRoom never leaves the room: it is cascaded in it instead', () => {
    const area = { width: 1366, height: 681 };
    const [hardware, memory, stack] = tileWindows(
      [item('hardware', 540, 632, 272), { ...item('memory', 640, 356), inRoom: true }, item('stack', 300, 360)],
      { area, minX: 880, further: true },
    );
    expect(hardware!.rect).toEqual({ x: 880, y: 0, width: 486, height: 632 });
    expect(memory!.overlaps).toBe(true);
    expect(memory!.rect.x).toBeGreaterThanOrEqual(880);
    expect(memory!.rect.y).toBe(272);
    // Stack is not marked: it goes to a further column, over no window.
    expect(stack!.overlaps).toBe(false);
    expect(stack!.rect.x + stack!.rect.width).toBeLessThanOrEqual(880);
    expect(rectsOverlap(stack!.rect, memory!.rect)).toBe(false);
  });

  it('the cascade, when a further column has no room either, stays over the room, not over the docked panels', () => {
    const area = { width: 1000, height: 400 };
    const places = tileWindows([item('a', 300, 400), item('b', 700, 400), item('c', 300, 300)], {
      area,
      minX: 700,
      further: true,
    });
    expect(places[1]!.overlaps).toBe(false);
    expect(places[1]!.rect.x).toBe(0);
    expect(places[2]!.overlaps).toBe(true);
    expect(places[2]!.rect.x).toBeGreaterThanOrEqual(700);
  });

  it('is pure and the same for the same input', () => {
    const items = [item('hardware', 540, 632, 272), item('memory', 640, 356), item('log', 440, 300)];
    expect(tileWindows(items, { area: AREA, minX: 1118 })).toEqual(tileWindows(items, { area: AREA, minX: 1118 }));
  });
});

describe('keptRoom (P9.9 point 4)', () => {
  const hardware = { x: 1380, y: 0, width: 540, height: 632 };
  const memory = { x: 1280, y: 632, width: 640, height: 356 };

  it('is the room while its windows lie in it', () => {
    expect(keptRoom(640, 1920, [hardware, memory])).toBe(640);
  });

  it('shrinks to the columns that still hold a window', () => {
    // Memory moved out to the left: the Hardware column is kept.
    expect(keptRoom(640, 1920, [hardware, { ...memory, x: 300 }])).toBe(540);
    // Hardware moved out: Memory's column (the wider one) is kept.
    expect(keptRoom(640, 1920, [{ ...hardware, x: 200, y: 300 }, memory])).toBe(640);
    // Memory moved further right inside the room: the room follows it.
    expect(keptRoom(640, 1920, [{ ...memory, x: 1500 }])).toBe(420);
  });

  it('is given back whole when no shown window lies in it: no empty strip', () => {
    expect(keptRoom(640, 1920, [])).toBe(0);
    expect(keptRoom(640, 1920, [{ ...hardware, x: 100 }])).toBe(0);
    // A window whose left edge is left of the room does not hold it, even if it reaches into it.
    expect(keptRoom(640, 1920, [{ ...hardware, x: 1200 }])).toBe(0);
  });

  it('never grows beyond the room the arrangement kept, and is 0 without one', () => {
    expect(keptRoom(640, 1920, [{ ...hardware, x: 1000 }, hardware])).toBe(540);
    expect(keptRoom(0, 1920, [hardware])).toBe(0);
    expect(keptRoom(640, 0, [hardware])).toBe(0);
    // A window pushed past the right edge still lies in the room.
    expect(keptRoom(640, 1920, [{ ...hardware, x: 1872 }])).toBe(48);
  });
});
