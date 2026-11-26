// Where floating windows are placed without covering one another (ARCHITECTURE-PLUS P9.8 points 1
// and 2). A pure rule: no DOM, no settings. Used by the ready-made arrangement `Floating Tools`
// (features/layout/arrangements.ts) and by the first Float of a panel (ui/dock/engine.ts).
//
//   tileWindows(items, { area, minX, obstacles })
//
// The windows are placed one after the other, in the order given, each at its own size, at the
// first free place of the right part of the dock: the rightmost place first, and in it the top
// one. A place is free when the window lies inside the dock, right of `minX`, and covers neither a
// window placed before nor an obstacle. So the first window takes the top right corner, the next
// ones fill the column below it from the top down, and when a column is full a further column
// opens to the left of it (P9.8 point 1).
//
// Only when a window finds no free place (many windows, a small dock) does it overlap: it is then
// cascaded by 24 px over the last column (the leftmost column placed), and never over the part of
// a window that is marked `keep` (the Hardware window's displays, lamps and switches): it starts
// below that part. Such a window is reported with `overlaps: true`.
//
// A window wider than the free part of the dock (the dock less `minX`) is made narrower, to that
// width, never below MIN_FLOAT_SIZE; a window taller than the dock is made lower likewise.

import { FLOAT_CASCADE_STEP, MIN_FLOAT_SIZE, type DockRect } from './dock';

export interface TileArea {
  width: number;
  height: number;
}

export interface TileItem {
  panel: string;
  width: number;
  height: number;
  /** The height of the window's top part, title bar included, that no later window may cover. */
  keep?: number;
}

export interface TileOptions {
  area: TileArea;
  /** No window is placed left of this x (the part of the dock that stays uncovered). Default 0. */
  minX?: number;
  /** Places that are taken already (other floating windows, a tab strip that must stay seen). */
  obstacles?: readonly DockRect[];
}

export interface TilePlace {
  panel: string;
  rect: DockRect;
  /** True when no free place was found and the window overlaps another (the cascade). */
  overlaps: boolean;
}

const intersects = (a: DockRect, b: DockRect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const unique = (values: number[]): number[] => [...new Set(values.map((value) => Math.round(value)))];

/** The places of `items`, in their order (see the head of this file). */
export function tileWindows(items: readonly TileItem[], options: TileOptions): TilePlace[] {
  const area = {
    width: Math.max(0, Math.floor(options.area.width)),
    height: Math.max(0, Math.floor(options.area.height)),
  };
  const minX = Math.max(0, Math.min(Math.round(options.minX ?? 0), area.width - MIN_FLOAT_SIZE.width));
  const obstacles = (options.obstacles ?? []).map((rect) => ({ ...rect }));
  const placed: (TilePlace & { keep: number })[] = [];
  let overflow = 0;
  for (const item of items) {
    const width = Math.max(MIN_FLOAT_SIZE.width, Math.min(Math.round(item.width), area.width - minX));
    const height = Math.max(MIN_FLOAT_SIZE.height, Math.min(Math.round(item.height), area.height));
    const taken = [...obstacles, ...placed.map((place) => place.rect)];
    const xs = unique([area.width - width, ...taken.map((rect) => rect.x - width)])
      .filter((x) => x >= minX && x + width <= area.width)
      .sort((a, b) => b - a);
    const ys = unique([0, ...taken.map((rect) => rect.y + rect.height)])
      .filter((y) => y >= 0 && y + height <= area.height)
      .sort((a, b) => a - b);
    let rect: DockRect | null = null;
    for (const x of xs) {
      for (const y of ys) {
        const candidate = { x, y, width, height };
        if (!taken.some((other) => intersects(candidate, other))) {
          rect = candidate;
          break;
        }
      }
      if (rect) break;
    }
    if (rect) {
      placed.push({ panel: item.panel, rect, overlaps: false, keep: Math.max(0, item.keep ?? 0) });
      continue;
    }
    overflow++;
    placed.push({
      panel: item.panel,
      rect: cascaded(overflow, width, height, area, minX, placed),
      overlaps: true,
      keep: Math.max(0, item.keep ?? 0),
    });
  }
  return placed.map(({ panel, rect, overlaps }) => ({ panel, rect, overlaps }));
}

/**
 * The `n`-th window that found no free place: 24 px further right and down for each, over the last
 * column (the leftmost of the windows placed without overlap), starting below every kept part of a
 * window it would otherwise cover; inside the dock, made lower where it does not fit below them.
 */
function cascaded(
  n: number,
  width: number,
  height: number,
  area: TileArea,
  minX: number,
  placed: readonly (TilePlace & { keep: number })[],
): DockRect {
  const free = placed.filter((place) => !place.overlaps);
  const column = free.length > 0 ? Math.min(...free.map((place) => place.rect.x)) : area.width - width;
  // 24 px further in for each; narrower where the dock ends, so that the column's left edge stays seen.
  let x = Math.min(column + FLOAT_CASCADE_STEP * n, area.width - MIN_FLOAT_SIZE.width);
  x = Math.max(minX, x);
  const fitted = Math.min(width, area.width - x);
  const kept = placed
    .filter((place) => place.keep > 0)
    .filter((place) => place.rect.x < x + fitted && x < place.rect.x + place.rect.width)
    .map((place) => place.rect.y + place.keep);
  const below = kept.length > 0 ? Math.max(...kept) : 0;
  let y = below + FLOAT_CASCADE_STEP * (kept.length > 0 ? n - 1 : n);
  let h = height;
  if (y + h > area.height) h = Math.max(MIN_FLOAT_SIZE.height, area.height - y);
  if (y + h > area.height) y = Math.max(below, area.height - h);
  if (y + h > area.height) y = Math.max(0, area.height - h);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(MIN_FLOAT_SIZE.width, fitted)),
    height: Math.round(h),
  };
}

/** Whether two rects overlap (more than touching). */
export function rectsOverlap(a: DockRect, b: DockRect): boolean {
  return intersects(a, b);
}
