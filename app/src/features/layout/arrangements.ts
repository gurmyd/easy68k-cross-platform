// The ready-made arrangements of the Simulator, `View > Layouts` (ARCHITECTURE-PLUS P9.4), as data.
// Owner: M2.
//
//   Classic                            the default arrangement of P3.1.3: what Reset Layout gives
//   Wide Output                        +-----------+---------------------+
//                                      | Registers |                     |
//                                      | Listing   |       Output        |
//                                      | [tools]   |   (whole height)    |
//                                      | Messages  |                     |
//                                      +-----------+---------------------+
//   Output and Hardware Side by Side   +-----------+------------+--------+
//                                      | Registers |            |        |
//                                      | Listing   |   Output   |Hardware|
//                                      | [tools]   |            |        |
//                                      | Messages  |            |        |
//                                      +-----------+------------+--------+
//   Floating Tools                     +-----------+--------+   +------------+
//   (P9.8 point 1: tiled)              | Registers |        |   |  Hardware  |
//                                      | Listing   | Output |   +------------+
//                                      | Messages  |        |   |   Memory   |
//                                      +-----------+--------+   +------------+
//                                      the five tool panels float, each at its own default size
//                                      (TOOL_WINDOW_SIZES), placed by the rule of state/tiling.ts in
//                                      the order Hardware, Memory, Stack, Break Points, Log: from
//                                      the top right down in the room kept for them (Hardware and
//                                      Memory stay there), then Stack, Break Points and Log in
//                                      further columns to the left over the Output panel (P9.9
//                                      point 2), never over the left column (P9.10 point 2), over
//                                      no other window while there is room, then cascaded in the
//                                      room, never over the Hardware window's displays and
//                                      switches; the docked
//                                      panels keep the part of the dock left of the room (`reserve`),
//                                      the Output panel the room for its picture (FLOATING_ROOM)
//
// [tools] is one group with the tool panels as tabs (Memory, Stack, Hardware, Break Points, Log in
// this order; Hardware only in Wide Output). Each arrangement names every panel of the Simulator,
// shown or hidden: a hidden panel takes its place when it is shown (the dock parks it there). None
// shows or hides a panel (P1.1 rule 4) and each keeps the lock (the dock's `arrange` and `reset`).
// The weights are proportions; the Registers group is sized to its content wherever it is alone at
// the top of the left column, as in the default (P3.1.5), so its weight only matters before that.
// The proportions were chosen at 1366 by 768 and 1920 by 1080 (docs/porting/errata/M2.md).

import type { DockNode } from '../../contracts';
import { TOOL_PANELS } from '../../state/layout';
import { MIN_FLOAT_SIZE, type DockArrangement, type DockRect } from '../../state/dock';
import { tileWindows } from '../../state/tiling';

export type ArrangementId = 'classic' | 'wideOutput' | 'sideBySide' | 'floatingTools';

/** The command of each entry of `View > Layouts`, in menu order. */
export const ARRANGEMENT_COMMANDS: Readonly<Record<ArrangementId, `sim.view.layout.${ArrangementId}`>> = {
  classic: 'sim.view.layout.classic',
  wideOutput: 'sim.view.layout.wideOutput',
  sideBySide: 'sim.view.layout.sideBySide',
  floatingTools: 'sim.view.layout.floatingTools',
};

export const ARRANGEMENT_IDS: readonly ArrangementId[] = ['classic', 'wideOutput', 'sideBySide', 'floatingTools'];

/** What an entry does: the default arrangement (Reset Layout), or a stored arrangement. */
export type ArrangementPlan = { kind: 'default' } | { kind: 'arrange'; arrangement: DockArrangement };

/** The proportions (weights) of the arrangements; recorded in erratum M2. */
export const PROPORTIONS = {
  /** Wide Output: the left column and the Output panel. */
  wideColumns: [40, 60],
  /**
   * Output and Hardware Side by Side: left column, Output, Hardware. At 1366 px the Registers
   * panel (467 px) and the Hardware panel (521 px) are shown whole; the Output panel fits its
   * picture into what is left.
   */
  sideColumns: [35, 26, 39],
  /** Left column of both: Registers (content-sized), Listing, the tool group, Messages. */
  leftColumn: [20, 36, 32, 16],
  /** Floating Tools: the left column and the Output panel, as the default (sim.columns 0.5). */
  floatingColumns: [50, 50],
  /** Floating Tools, left column: Registers (content-sized), Listing, Messages (sim.messages 0.16). */
  floatingLeft: [20, 67, 13],
} as const;

const tabs = (panels: readonly string[], weight: number, selected?: string): DockNode => ({
  type: 'tabs',
  weight,
  panels: [...panels],
  selected: selected !== undefined && panels.includes(selected) ? selected : (panels[0] ?? ''),
});

/**
 * The selected tab of a tool group: the tool panel `front` (the one in front now) when the group
 * holds it, else the first of the group that `shown` reports shown, else the first.
 */
function frontTool(panels: readonly string[], front: string | null, shown: (panel: string) => boolean): string {
  if (front !== null && panels.includes(front)) return front;
  return panels.find(shown) ?? panels[0] ?? '';
}

function leftColumn(tools: readonly string[], selected: string, weight: number): DockNode {
  const [registers, listing, group, messages] = PROPORTIONS.leftColumn;
  return {
    type: 'column',
    weight,
    children: [
      tabs(['registers'], registers),
      tabs(['listing'], listing),
      tabs(tools, group, selected),
      tabs(['messages'], messages),
    ],
  };
}

/**
 * Floating Tools: the order in which the tool panels float (also their reading order, and the order
 * in which they are placed, P9.8 point 1) and the default size of each window, title bar and border
 * included, in CSS pixels. Each size is what the panel needs to show its content (measured in
 * Chromium and WebKit: the Hardware panel's content is 522 by 595, its window 540 by 627; the
 * Memory panel's sixteen bytes a row need 622 px and its rows fill the height it is given); the
 * lists (Stack, Break Points, Log) get a size that shows several rows. The Hardware window and the
 * Memory window below it fit one column of the dock at 1920 by 1080 (993 px high). `keep` is the
 * Hardware window's top part, title bar included, that holds its displays, lamps, switches and push
 * buttons: no window is ever placed over it (P9.8 point 1). Erratum M2.
 */
export const FLOATING_TOOLS_ORDER = ['hardware', 'memory', 'stack', 'breakpoints', 'log'] as const;
/**
 * `inRoom`: the Hardware and the Memory window stay in the room kept for the windows, right of the
 * Output panel (the promise of P9.8 point 1 for them); the other three go on to further columns at
 * the left, over the docked panels, before any window overlaps another (P9.9 point 2).
 */
export const TOOL_WINDOW_SIZES: Readonly<
  Record<(typeof FLOATING_TOOLS_ORDER)[number], { width: number; height: number; keep?: number; inRoom?: boolean }>
> = {
  hardware: { width: 540, height: 632, keep: 272, inRoom: true },
  memory: { width: 640, height: 356, inRoom: true },
  stack: { width: 300, height: 360 },
  breakpoints: { width: 560, height: 300 },
  log: { width: 440, height: 300 },
};

/**
 * The room of Floating Tools (P9.8 point 1), CSS pixels. The left column keeps at least the width
 * the Registers panel needs to be shown whole (`left`); the Output panel keeps the left part of what
 * was its column: its whole picture at 100 % with its frame (`outputWhole`) where the tool windows
 * then still get at least `toolsLeast` (the Hardware panel's displays, lamps and switches), else the
 * left 400 px of the picture (`outputPart`). Where the whole picture leaves the room narrower than
 * the Hardware window's content (`hardwareWhole`: 521 px and the window's border, measured in
 * Chromium and WebKit), the room takes from the Output panel's share up to that width, as far as the
 * left 400 px of the picture stay uncovered (P9.9 point 5). The tool windows are placed right of that.
 */
export const FLOATING_ROOM = {
  left: 478,
  outputWhole: 648,
  outputPart: 402,
  toolsLeast: 360,
  hardwareWhole: 523,
} as const;

/**
 * The width of the room kept for the windows of Floating Tools in a dock `width` px wide (P9.8
 * point 1, P9.9 point 5, P9.10 point 1): the dock less the left column and the whole picture; where
 * that is narrower than the Hardware window's content, up to that content's width, taken from the
 * Output panel as far as its left 400 px stay: so the window is whole from a dock of 1,403 px on
 * (478 + 402 + 523), and in a narrower dock it gets what is left beside the registers and the left
 * 400 px of the picture and scrolls inside itself; never less than the Hardware displays and
 * switches need.
 */
export function floatingRoomWidth(width: number): number {
  const room = FLOATING_ROOM;
  const whole = width - room.left - room.outputWhole;
  const part = width - room.left - room.outputPart;
  let region = whole;
  if (region < room.hardwareWhole) region = Math.max(region, Math.min(room.hardwareWhole, part));
  if (region < room.toolsLeast) region = Math.max(room.toolsLeast, part);
  return region;
}

/** The size of a Simulator dock, CSS pixels. */
export interface DockArea {
  width: number;
  height: number;
}

/** Floating Tools in a dock of a size: the windows, the room kept for them and the docked columns. */
export interface FloatingToolsLayout {
  /** Every tool panel, in FLOATING_TOOLS_ORDER, with its window. */
  windows: { panel: string; rect: DockRect; overlaps: boolean }[];
  /** The width at the right of the dock that the docked panels leave to the windows (DockArrangement.reserve). */
  reserve: number;
  /** The docked row: the left column's width and the Output panel's, in the rest of the dock. */
  columns: [number, number];
}

/**
 * Floating Tools in a dock of `area` (P9.8 point 1): the tool panels that are shown are placed
 * first, in the order Hardware, Memory, Stack, Break Points, Log, by the rule of state/tiling.ts
 * (each at its default size, no window over another, the room at the right of the dock from the top
 * down; when it is full, Stack, Break Points and Log go to further columns at its left over the
 * Output panel, P9.9 point 2, but never over the docked left column, P9.10 point 2, while Hardware
 * and Memory stay in the room; the cascade over the room's last column only when there is no free
 * place, never over the Hardware window's displays and switches); the hidden ones then get their
 * places by the same rule, which they take when they are shown. The docked panels keep the part of
 * the dock left of the room.
 */
export function floatingToolsLayout(
  area: DockArea,
  shown: (panel: string) => boolean = () => true,
): FloatingToolsLayout {
  const width = Math.floor(area.width);
  const room = FLOATING_ROOM;
  const minX = Math.max(0, width - floatingRoomWidth(width));
  const order = [
    ...FLOATING_TOOLS_ORDER.filter((panel) => shown(panel)),
    ...FLOATING_TOOLS_ORDER.filter((panel) => !shown(panel)),
  ];
  // The docked left column's width for the docked panels' share `docked`: the Registers panel whole
  // and the whole picture where the dock has room for both, else the Registers panel whole.
  const leftOf = (docked: number) =>
    docked - room.left >= room.outputWhole ? docked - room.outputWhole : Math.min(room.left, docked);
  // Further columns lie right of the docked left column (P9.10 point 2). That column's width
  // depends on the room the windows keep, which depends on where they are placed: start from the
  // narrowest it can be (the whole room kept) and widen until the two agree.
  let furtherFromX = leftOf(minX);
  let places = tileWindows(
    order.map((panel) => ({ panel, ...TOOL_WINDOW_SIZES[panel] })),
    { area: { width, height: Math.floor(area.height) }, minX, further: true, furtherFromX },
  );
  let reserve: number;
  let leftColumn: number;
  for (let round = 0; ; round++) {
    // The room kept is that of the windows placed in it (those of further columns lie over docked panels).
    const left = Math.min(
      width,
      ...places.filter((place) => !place.overlaps && place.rect.x >= minX).map((place) => place.rect.x),
    );
    // The docked panels keep at least the Registers column and a narrow Output panel.
    reserve = Math.max(0, Math.min(width - left, width - room.left - MIN_FLOAT_SIZE.width));
    leftColumn = leftOf(width - reserve);
    if (leftColumn <= furtherFromX || round === 4) break;
    furtherFromX = leftColumn;
    places = tileWindows(
      order.map((panel) => ({ panel, ...TOOL_WINDOW_SIZES[panel] })),
      { area: { width, height: Math.floor(area.height) }, minX, further: true, furtherFromX },
    );
  }
  const windows = FLOATING_TOOLS_ORDER.map((panel) => {
    const place = places.find((entry) => entry.panel === panel)!;
    return { panel, rect: place.rect, overlaps: place.overlaps };
  });
  const docked = width - reserve;
  return { windows, reserve, columns: [leftColumn, Math.max(1, docked - leftColumn)] };
}

/** The windows of Floating Tools in a dock of `area`, every tool panel shown (floatingToolsLayout). */
export function floatingToolRects(area: DockArea): { panel: string; rect: DockRect }[] {
  return floatingToolsLayout(area).windows.map(({ panel, rect }) => ({ panel, rect }));
}

/**
 * Output and Hardware Side by Side in a dock `width` px wide (P9.8 point 5): the left column keeps
 * its share; the Output column gets at least 648 px (the picture at 100 % and its frame) before the
 * Hardware column gets more than its own minimum; the Hardware panel scrolls inside itself.
 */
export function sideBySideColumns(width: number): [number, number, number] {
  const [leftShare, outputShare, hardwareShare] = PROPORTIONS.sideColumns;
  const total = leftShare + outputShare + hardwareShare;
  // The columns share the dock less its two splitters (1 px each), as the weights do.
  const room = Math.max(0, width - 2);
  const left = Math.round((room * leftShare) / total);
  let output = Math.round((room * outputShare) / total);
  let hardware = room - left - output;
  if (output < FLOATING_ROOM.outputWhole) {
    const give = Math.min(FLOATING_ROOM.outputWhole - output, Math.max(0, hardware - SIDE_HARDWARE_LEAST));
    output += give;
    hardware -= give;
  }
  return [left, output, hardware];
}

/** The Hardware column's own minimum in Side by Side: a floating window's least width (P9.2). */
export const SIDE_HARDWARE_LEAST = MIN_FLOAT_SIZE.width;

export interface ArrangementInput {
  /** The tool panel in front now (ShellState.activeTool), if any. */
  front?: string | null;
  /** Whether a panel is shown (layout.panels). */
  shown?: (panel: string) => boolean;
  /**
   * The Simulator dock's size now. Floating Tools places its windows by it; without it (no page:
   * the unit tests) the windows are left to the dock's own cascade at its default size.
   */
  area?: DockArea | null;
}

/** What the entry `id` does. */
export function arrangementPlan(id: ArrangementId, input: ArrangementInput = {}): ArrangementPlan {
  const front = input.front ?? null;
  const shown = input.shown ?? (() => false);
  switch (id) {
    case 'classic':
      return { kind: 'default' };
    case 'wideOutput': {
      const tools = [...TOOL_PANELS];
      const [left, right] = PROPORTIONS.wideColumns;
      return {
        kind: 'arrange',
        arrangement: {
          mode: 'simulator',
          docked: {
            type: 'row',
            weight: 100,
            children: [leftColumn(tools, frontTool(tools, front, shown), left), tabs(['output'], right)],
          },
          floating: [],
        },
      };
    }
    case 'sideBySide': {
      const tools = TOOL_PANELS.filter((panel) => panel !== 'hardware');
      // By the dock's width where it is known (P9.8 point 5), else the proportions.
      const [left, output, hardware] = input.area
        ? sideBySideColumns(Math.floor(input.area.width))
        : PROPORTIONS.sideColumns;
      return {
        kind: 'arrange',
        arrangement: {
          mode: 'simulator',
          docked: {
            type: 'row',
            weight: 100,
            children: [
              leftColumn(tools, frontTool(tools, front, shown), left),
              tabs(['output'], output),
              tabs(['hardware'], hardware),
            ],
          },
          floating: [],
        },
      };
    }
    case 'floatingTools': {
      const layout = input.area ? floatingToolsLayout(input.area, shown) : null;
      const [left, right] = layout ? layout.columns : PROPORTIONS.floatingColumns;
      const [registers, listing, messages] = PROPORTIONS.floatingLeft;
      return {
        kind: 'arrange',
        arrangement: {
          mode: 'simulator',
          docked: {
            type: 'row',
            weight: 100,
            children: [
              {
                type: 'column',
                weight: left,
                children: [tabs(['registers'], registers), tabs(['listing'], listing), tabs(['messages'], messages)],
              },
              tabs(['output'], right),
            ],
          },
          // Each at its default size, side by side from the top right (P9.8 point 1); without the
          // dock's size, the dock places them by the same rule.
          floating: layout
            ? layout.windows.map(({ panel, rect }) => ({ panel, rect }))
            : FLOATING_TOOLS_ORDER.map((panel) => ({ panel })),
          cascade: 'top-right',
          ...(layout ? { reserve: layout.reserve } : {}),
        },
      };
    }
  }
}
