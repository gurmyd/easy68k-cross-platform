// The rules of floating windows (ARCHITECTURE-PLUS P9.2), as pure functions. Owner: M1.
//
// A floating window is a panel of the dock drawn as a window above the docked panels: its place
// and size are a DockRect relative to the top left corner of its mode's dock (the workspace between
// the toolbar and the status bar; the dock clips what lies outside it, so that is "the application
// window" of P9.2, errata M1 3).
//
//   boundedRect(rect, area, buttons) the place shown: at least 48 px of the title area (the title bar
//                                    less its buttons, P9.8 point 4) inside the dock in every
//                                    direction; moved back, never resized (P9.2, Bounds)
//   sizedRect(rect, edges, dx, dy, min, area)   a resize by the edges and corners (pointer or keyboard)
//   minimumSize(panelMin?)           the panel's own minimum, not less than 160 x 96
//   firstFloatRect(docked, area, others, min, avoid)   the first float: its docked size (at most
//                                    three quarters of the dock) at the first free place of the rule
//                                    of P9.8 point 1 (state/tiling.ts), over no other window and not
//                                    over the strip it came from (P9.8 point 2)
//   keyStep(key, shift)              the arrow keys of Move and Size: 16 px, with Shift 1 px
//   readFloating(raw, mode, readTree)    a mode's stored floating windows, validated (stored.ts), with
//                                    the place each was docked at and the run's origin (errata M1 11)
//
// Nothing here touches the DOM or the settings.

import type { DockNode, DockParked } from '../../contracts';
import { FLOAT_CASCADE_STEP, MIN_FLOAT_SIZE, type DockRect } from '../../state/dock';
import { rectsOverlap, tileWindows } from '../../state/tiling';
import { DOCK_PANELS, type DockMode } from './model';

/** The title bar's height (dock.css `.e68-float__bar`). */
export const TITLE_BAR_HEIGHT = 30;

/** How much of the title bar stays inside the dock in every direction (P9.2). */
export const KEEP_INSIDE = 48;

/** The arrow keys of Move and Size (P9.2): 16 px, with Shift 1 px. */
export const KEY_STEP = 16;
export const FINE_KEY_STEP = 1;

/** A floating window's share of the dock at most, the first time it floats (P9.2). */
export const FIRST_FLOAT_SHARE = 0.75;

export interface Area {
  width: number;
  height: number;
}

/** The edges a resize moves: any of n, s, e, w, as in `nw` for the top left corner. */
export type Edges = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const EDGES: readonly Edges[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const sameRect = (a: DockRect | null | undefined, b: DockRect | null | undefined): boolean =>
  !!a &&
  !!b &&
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

/** The smallest size: the panel's own minimum, and not less than 160 by 96 pixels (P9.2). */
export function minimumSize(panelMin?: { width?: number; height?: number }): { width: number; height: number } {
  return {
    width: Math.max(MIN_FLOAT_SIZE.width, finite(panelMin?.width) ? panelMin.width : 0),
    height: Math.max(MIN_FLOAT_SIZE.height, finite(panelMin?.height) ? panelMin.height : 0),
  };
}

const round = (rect: DockRect): DockRect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
});

/**
 * The width of the buttons at the right end of a title bar (dock.css `.e68-float__button`, measured
 * in Chromium and WebKit): `Dock`, and `Dock` with the `x` of a panel that has one. The title area is
 * the rest of the bar (P9.8 point 4).
 */
export const TITLE_BUTTONS_WIDTH = { dock: 54, dockAndClose: 80 } as const;

/** A floating window's border (dock.css `[data-e68-float]`), inside which its title bar begins. */
export const WINDOW_BORDER = 1;

/** The width of a window's title bar buttons: `closable` for a panel that has an `x`. */
export const titleButtonsWidth = (closable: boolean): number =>
  closable ? TITLE_BUTTONS_WIDTH.dockAndClose : TITLE_BUTTONS_WIDTH.dock;

/**
 * The place a window is shown at: moved (never resized) so that at least 48 px of its title area
 * (the title bar less its buttons at the right end, `buttons` px wide; P9.8 point 4) are inside the
 * dock horizontally and the whole title bar vertically (it is shorter than 48 px). When the dock is
 * narrower than 48 px nothing can hold; the window is then put at the left edge.
 */
export function boundedRect(rect: DockRect, area: Area, buttons = 0): DockRect {
  const title = Math.max(0, rect.width - Math.max(0, buttons));
  const keep = Math.min(KEEP_INSIDE, title > 0 ? title : rect.width);
  // The title area's right end (x + title) at least `keep` from the dock's left edge; its left end
  // (x) at most `keep` from the right edge.
  const minX = keep - (title > 0 ? title : rect.width);
  // The title area (given by its buttons) begins inside the window's 1 px border.
  const maxX = Math.max(minX, area.width - keep - (buttons > 0 && title > 0 ? WINDOW_BORDER : 0));
  const maxY = Math.max(0, area.height - TITLE_BAR_HEIGHT);
  return round({
    ...rect,
    x: Math.min(Math.max(rect.x, minX), maxX),
    y: Math.min(Math.max(rect.y, 0), maxY),
  });
}

/**
 * A resize: the given edges move by dx, dy; the window keeps its minimum size (the opposite edge
 * stays where it is) and its title bar stays reachable (the top edge does not go above the dock,
 * nor below its bottom less the title bar).
 */
export function sizedRect(
  rect: DockRect,
  edges: Edges,
  dx: number,
  dy: number,
  min: { width: number; height: number },
  area: Area,
): DockRect {
  let { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;
  if (edges.includes('e')) width = Math.max(min.width, width + dx);
  if (edges.includes('s')) height = Math.max(min.height, height + dy);
  if (edges.includes('w')) {
    x = Math.min(x + dx, right - min.width);
    width = right - x;
  }
  if (edges.includes('n')) {
    y = Math.min(Math.max(0, y + dy), bottom - min.height);
    y = Math.min(y, Math.max(0, area.height - TITLE_BAR_HEIGHT));
    height = bottom - y;
  }
  // The left edge may not take the title bar out of reach on the right.
  if (edges.includes('w') && x > area.width - KEEP_INSIDE) {
    x = Math.max(0, area.width - KEEP_INSIDE);
    width = Math.max(min.width, right - x);
  }
  return round({ x, y, width, height });
}

/** A size of at most three quarters of the dock in either direction, and at least the minimum. */
export function firstSizeWithin(
  size: { width: number; height: number },
  area: Area,
  min: { width: number; height: number } = minimumSize(),
) {
  return {
    width: Math.max(min.width, Math.min(size.width, Math.floor(area.width * FIRST_FLOAT_SHARE))),
    height: Math.max(min.height, Math.min(size.height, Math.floor(area.height * FIRST_FLOAT_SHARE))),
  };
}

/**
 * The first float of a panel (P9.2 as corrected by P9.8 point 2): the size it had while docked (at
 * most three quarters of the dock), at the first free place of the rule of P9.8 point 1
 * (state/tiling.ts: the right part of the dock from the top down, then further columns to the left)
 * where it covers none of `others` (the floating windows shown) and not `avoid` (the tab strip of the
 * group it came from). Where there is no free place: cascaded 24 px from the last of `others` (from
 * the top left when that would leave the dock), moved below `avoid` where it would cover it. Shown
 * within the bounds.
 */
export function firstFloatRect(
  docked: DockRect | null,
  area: Area,
  others: readonly DockRect[],
  min: { width: number; height: number } = minimumSize(),
  avoid: DockRect | null = null,
): DockRect {
  const base = docked ?? { x: 0, y: 0, width: area.width / 2, height: area.height / 2 };
  const size = firstSizeWithin(base, area, min);
  const obstacles = avoid ? [...others, avoid] : [...others];
  const [place] = tileWindows([{ panel: '', ...size }], { area, obstacles });
  if (place && !place.overlaps) return boundedRect(place.rect, area);
  const last = others.length > 0 ? others[others.length - 1]! : null;
  let x = (last?.x ?? 0) + FLOAT_CASCADE_STEP;
  let y = (last?.y ?? 0) + FLOAT_CASCADE_STEP;
  // A cascade that would leave the dock starts again at the top left.
  if (x + size.width > area.width || y + size.height > area.height) {
    x = FLOAT_CASCADE_STEP;
    y = FLOAT_CASCADE_STEP;
  }
  const rect = { x, y, ...size };
  if (avoid && rectsOverlap(rect, avoid)) rect.y = avoid.y + avoid.height;
  return boundedRect(rect, area);
}

/** The move or size of one arrow key (P9.2), or null for another key. */
export function keyStep(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? FINE_KEY_STEP : KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * Where a panel was docked, as the dock understands places (park.ts `placeOf`): a tab of a group
 * (the group's panels in their order, the panel among them), or a group of its own beside a
 * subtree (the subtree's panels, the side the panel is on, the share of their common space the
 * panel had).
 */
export type DockPlace =
  { side: 'tab'; panels: string[] } | { side: 'left' | 'right' | 'above' | 'below'; panels: string[]; share: number };

/** A floating window as stored (P9.2 Persistence): the panel, its rect and where it was docked. */
export interface StoredWindow {
  panel: string;
  rect: DockRect;
  /** The parked place of P3.1.8 (next to which panel, on which side); the announcement's words. */
  home?: DockParked;
  /** The place it was docked at last (errata M1 7). */
  place?: DockPlace;
}

/**
 * The docked arrangement a run of Float and Dock started from (errata M1 11): `tree` is the docked
 * tree before the first of the panels floated (no viewers), `wasDefault` whether that was the
 * default arrangement, `last` the tree the last Float or Dock of the run stored. While the stored
 * tree has the shape of `last`, nothing else changed the arrangement, and a panel of `tree` that
 * floats docks to its place in `tree` among the panels docked now.
 */
export interface FloatOrigin {
  tree: DockNode;
  wasDefault: boolean;
  last: DockNode;
}

/** A mode's floating windows (in the order they were made to float) and the remembered rects. */
export interface StoredFloating {
  windows: StoredWindow[];
  /** The last rect of each panel that floated before and is docked now ("after that it remembers its own"). */
  remembered: Record<string, DockRect>;
  /** The arrangement the windows floated from (absent: none known). */
  origin?: FloatOrigin;
  /**
   * The width, CSS px, at the right of the dock that the docked panels leave to the floating windows
   * (an arrangement's `reserve`, P9.8 point 1; absent: none). It applies while a window is shown.
   */
  reserve?: number;
}

export const EMPTY_FLOATING: StoredFloating = { windows: [], remembered: {} };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SIDES: readonly string[] = ['tab', 'left', 'right', 'above', 'below'];

/** A stored rect, or null when it is not one: four finite numbers, a size above 0. */
export function readRect(raw: unknown): DockRect | null {
  if (!isObject(raw)) return null;
  const { x, y, width, height } = raw;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width <= 0 || height <= 0) return null;
  if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || width > 1e6 || height > 1e6) return null;
  const min = minimumSize();
  return { x, y, width: Math.max(min.width, width), height: Math.max(min.height, height) };
}

/**
 * A mode's stored floating windows, or null when any part is malformed: a window of a panel that is
 * not a panel of the mode (viewers are never stored), a panel listed twice, a rect that is not one.
 * Absent: none. The remembered rects keep only the valid ones (they are a convenience).
 */
export function readFloating(
  raw: unknown,
  mode: DockMode,
  readTree: (raw: unknown) => DockNode | undefined = () => undefined,
): StoredFloating | null {
  if (raw === undefined) return { windows: [], remembered: {} };
  if (!isObject(raw)) return null;
  const windows: StoredWindow[] = [];
  const seen = new Set<string>();
  if (raw.windows !== undefined) {
    if (!Array.isArray(raw.windows)) return null;
    for (const entry of raw.windows) {
      if (!isObject(entry) || typeof entry.panel !== 'string') return null;
      const panel = entry.panel;
      if (!DOCK_PANELS[mode].includes(panel) || seen.has(panel)) return null;
      const rect = readRect(entry.rect);
      if (rect === null) return null;
      seen.add(panel);
      const home = entry.home;
      const window: StoredWindow = { panel, rect };
      if (
        isObject(home) &&
        typeof home.near === 'string' &&
        typeof home.side === 'string' &&
        SIDES.includes(home.side)
      ) {
        window.home = { near: home.near, side: home.side as DockParked['side'] };
      }
      const place = readPlace(entry.place, mode);
      if (place) window.place = place;
      windows.push(window);
    }
  }
  const remembered: Record<string, DockRect> = {};
  if (isObject(raw.remembered)) {
    for (const [panel, value] of Object.entries(raw.remembered)) {
      const rect = readRect(value);
      if (rect && DOCK_PANELS[mode].includes(panel)) remembered[panel] = rect;
    }
  }
  // The origin is a convenience as well: kept only when both its trees can be read.
  const result: StoredFloating = { windows, remembered };
  if (isObject(raw.origin)) {
    const tree = readTree(raw.origin.tree);
    const last = readTree(raw.origin.last);
    if (tree && last) result.origin = { tree, wasDefault: raw.origin.wasDefault === true, last };
  }
  // So is the room kept for the windows: a whole number of pixels above 0, else none.
  if (finite(raw.reserve) && raw.reserve > 0 && raw.reserve < 1e5 && windows.length > 0) {
    result.reserve = Math.round(raw.reserve);
  }
  return result;
}

/** A stored place, or undefined when it is not one (it is then not used). */
function readPlace(raw: unknown, mode: DockMode): DockPlace | undefined {
  if (!isObject(raw) || typeof raw.side !== 'string' || !SIDES.includes(raw.side)) return undefined;
  const panels = raw.panels;
  if (!Array.isArray(panels) || panels.length === 0 || panels.length > DOCK_PANELS[mode].length) return undefined;
  if (!panels.every((panel) => typeof panel === 'string' && DOCK_PANELS[mode].includes(panel))) return undefined;
  if (raw.side === 'tab') return { side: 'tab', panels: [...(panels as string[])] };
  if (!finite(raw.share) || raw.share <= 0 || raw.share >= 1) return undefined;
  return {
    side: raw.side as 'left' | 'right' | 'above' | 'below',
    panels: [...(panels as string[])],
    share: raw.share,
  };
}

/** What is written back for a mode: nothing when it has neither windows nor remembered rects. */
export function storedFloating(floating: StoredFloating): StoredFloating | undefined {
  if (floating.windows.length === 0 && Object.keys(floating.remembered).length === 0) return undefined;
  return {
    windows: floating.windows.map((window) => ({
      panel: window.panel,
      rect: round(window.rect),
      ...(window.home ? { home: window.home } : {}),
      ...(window.place ? { place: window.place } : {}),
    })),
    remembered: Object.fromEntries(Object.entries(floating.remembered).map(([panel, rect]) => [panel, round(rect)])),
    // An origin belongs to windows that float; with none it has nothing left to do.
    ...(floating.origin && floating.windows.length > 0 ? { origin: floating.origin } : {}),
    ...(floating.reserve && floating.reserve > 0 && floating.windows.length > 0
      ? { reserve: Math.round(floating.reserve) }
      : {}),
  };
}

/**
 * The z-order of the windows: `stack` lists the panels from the back to the front. Each window's
 * z-index is above the dock's splitters (FlexLayout's 10) and below the kit's modeless dialogs
 * (`--z-modeless`, 20), whose value less one is the full screen's (dock.css).
 */
export function zIndexOf(stack: readonly string[], panel: string): number {
  const at = stack.indexOf(panel);
  return 11 + Math.max(0, Math.min(at, 7));
}

/** `stack` with `panel` at the front. */
export function raised(stack: readonly string[], panel: string): string[] {
  return [...stack.filter((id) => id !== panel), panel];
}
