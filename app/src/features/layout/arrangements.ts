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
//   Floating Tools                     Classic for Registers, Listing, Messages and Output; the
//                                      five tool panels float, cascaded from the top right, each at
//                                      its own default size (TOOL_WINDOW_SIZES: what the panel needs
//                                      to show its content; the Hardware panel whole, without
//                                      scrolling, at 1366 by 768), Hardware first (at the back, the
//                                      highest place of the cascade, where it fits), then Memory,
//                                      Stack, Break Points and Log in front
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
import { FLOAT_CASCADE_STEP, MIN_FLOAT_SIZE, type DockArrangement, type DockRect } from '../../state/dock';

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
 * Floating Tools: the order in which the tool panels float (the first at the back, the last in
 * front; also their reading order) and the default size of each window, title bar included, in CSS
 * pixels. Each size is what the panel needs to show its content (measured in Chromium and WebKit:
 * the Hardware panel needs 522 by 627, the Memory panel's sixteen bytes a row 622 px), with a few
 * pixels to spare for other systems' fonts; the lists (Stack, Break Points, Log) get a size that
 * shows several rows. The Hardware panel comes first so that it has the highest place of the
 * cascade, the only one where it fits whole in the dock at 1366 by 768 (681 px high). Erratum M2.
 */
export const FLOATING_TOOLS_ORDER = ['hardware', 'memory', 'stack', 'breakpoints', 'log'] as const;
export const TOOL_WINDOW_SIZES: Readonly<
  Record<(typeof FLOATING_TOOLS_ORDER)[number], { width: number; height: number }>
> = {
  hardware: { width: 540, height: 640 },
  memory: { width: 640, height: 360 },
  stack: { width: 300, height: 360 },
  breakpoints: { width: 560, height: 300 },
  log: { width: 440, height: 300 },
};

/** The size of a Simulator dock, CSS pixels. */
export interface DockArea {
  width: number;
  height: number;
}

/**
 * The windows of Floating Tools in a dock of `area`: cascaded from the top right, the first
 * FLOAT_CASCADE_STEP px in from the corner, each next one a step further left and down, each at its
 * default size, made smaller only where the dock is too small for it (never below MIN_FLOAT_SIZE),
 * so that every window lies inside the dock.
 */
export function floatingToolRects(area: DockArea): { panel: string; rect: DockRect }[] {
  return FLOATING_TOOLS_ORDER.map((panel, index) => {
    const step = FLOAT_CASCADE_STEP * (index + 1);
    const size = TOOL_WINDOW_SIZES[panel];
    const width = Math.max(MIN_FLOAT_SIZE.width, Math.min(size.width, Math.floor(area.width) - 2 * step));
    const height = Math.max(MIN_FLOAT_SIZE.height, Math.min(size.height, Math.floor(area.height) - step));
    const x = Math.max(0, Math.floor(area.width) - step - width);
    return { panel, rect: { x, y: step, width, height } };
  });
}

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
      const [left, output, hardware] = PROPORTIONS.sideColumns;
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
      const [left, right] = PROPORTIONS.floatingColumns;
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
          // Each at its default size, cascaded from the top right (P9.4).
          floating: input.area ? floatingToolRects(input.area) : FLOATING_TOOLS_ORDER.map((panel) => ({ panel })),
          cascade: 'top-right',
        },
      };
    }
  }
}
