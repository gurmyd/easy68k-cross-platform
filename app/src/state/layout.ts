// Panel layout: which panels exist, which are visible, where the separators stand
// (ARCHITECTURE.md 2.2-2.4, 3.10 `AppSettings.layout`). Owner: W3.
//
// The layout has exactly the regions drawn in sections 2.2 and 2.3; panels are not floating
// windows and there is no docking. What is stored per window is small: `panels[id].visible` and
// `splits[id]` (a fraction 0..1). Everything here is a pure function of the settings; the shell
// (ui/shell) draws the regions and state/panels.ts changes the settings.

import type { AppState, Platform, Settings } from '../contracts';

/** The panel ids of section 2.4. */
export const PANEL_IDS = [
  'registers',
  'listing',
  'messages',
  'output',
  'memory',
  'stack',
  'hardware',
  'breakpoints',
  'log',
  'files',
  'help',
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/**
 * Regions of the shell that are filled like panels but are not panels of section 2.4: the editor
 * area of Editor mode, the EASyBIN workspace, and the status bar of each mode. A feature fills
 * one by listing a PanelSpec with this id (FeatureModule.panels).
 */
export const REGION_IDS = ['editor', 'easybin', 'status'] as const;
export type RegionId = (typeof REGION_IDS)[number];

/** Titles of the panels; a PanelSpec's own title replaces them once its feature exists. */
export const PANEL_TITLES: Record<PanelId | RegionId, string> = {
  registers: 'Registers',
  listing: 'Listing',
  messages: 'Messages',
  output: 'Output',
  memory: 'Memory',
  stack: 'Stack',
  hardware: 'Hardware',
  breakpoints: 'Break Points',
  log: 'Log',
  files: 'Files',
  help: 'Help',
  editor: 'Editor',
  easybin: 'EASyBIN',
  status: 'Status',
};

/** The tool tabs under the Output panel, in tab order (2.3). */
export const TOOL_PANELS = ['memory', 'stack', 'hardware', 'breakpoints', 'log'] as const;
export type ToolPanelId = (typeof TOOL_PANELS)[number];

/**
 * The panel cycle of the original's Ctrl+Tab (sim-ui §3.4): Main > I/O > Memory > Stack >
 * Hardware > Break Points > Main, with the Log panel last (section 1.3.5). `listing` stands for
 * the main window (Registers, Listing, Messages).
 */
export const PANEL_CYCLE = ['listing', 'output', 'memory', 'stack', 'hardware', 'breakpoints', 'log'] as const;

/** Panels that are part of the main window and never hidden. */
const ALWAYS_VISIBLE: readonly string[] = ['registers', 'listing', 'messages', 'output'];

/**
 * Whether a panel is visible when nothing is stored for it (2.4): the tool panels and Help are
 * hidden, as their windows are in the original; the Files panel is shown in a browser and hidden
 * in the desktop app (2.2).
 */
export function defaultPanelVisible(id: string, kind: Platform['kind']): boolean {
  if (ALWAYS_VISIBLE.includes(id)) return true;
  if (id === 'files') return kind === 'web';
  return false;
}

/**
 * Whether a panel is visible: what is stored for it, otherwise the default. The entries of
 * `layout.panels` come from storage as they were written (the settings store does not check a
 * table with free keys), so an entry that is not `{ visible: true | false }` counts as not stored.
 */
export function isPanelVisible(settings: Settings, id: string, kind: Platform['kind']): boolean {
  if (ALWAYS_VISIBLE.includes(id)) return true;
  const stored: unknown = settings.app.layout.panels[id]?.visible;
  return typeof stored === 'boolean' ? stored : defaultPanelVisible(id, kind);
}

/** `settings` with the panel shown or hidden. Unknown keys of the panel's entry are kept. */
export function withPanelVisible(settings: Settings, id: string, visible: boolean): Settings {
  const layout = settings.app.layout;
  if (layout.panels[id]?.visible === visible) return settings;
  return {
    ...settings,
    app: {
      ...settings.app,
      layout: { ...layout, panels: { ...layout.panels, [id]: { ...layout.panels[id], visible } } },
    },
  };
}

/** The separators of the shell: the fraction of the available length that the sized pane takes. */
export const SPLITS = {
  /** Editor mode: width of the Files panel (left). */
  'editor.files': { fraction: 0.18, min: 140, minRest: 320 },
  /** Simulator mode: width of the left column (the original main window). */
  'sim.columns': { fraction: 0.5, min: 360, minRest: 320 },
  /** Simulator mode, left column: height of the Messages panel (bottom). */
  'sim.messages': { fraction: 0.16, min: 40, minRest: 120 },
  /** Simulator mode, right column: height of the tool tabs (bottom). */
  'sim.tools': { fraction: 0.4, min: 120, minRest: 160 },
  /** Any mode: width of the Help panel (right edge). */
  'app.help': { fraction: 0.32, min: 240, minRest: 360 },
} as const;
export type SplitId = keyof typeof SPLITS;

/** The stored fraction of a separator, or its default. */
export function splitFraction(settings: Settings, id: SplitId): number {
  const stored = settings.app.layout.splits[id];
  return typeof stored === 'number' && stored > 0 && stored < 1 ? stored : SPLITS[id].fraction;
}

export function withSplit(settings: Settings, id: SplitId, fraction: number): Settings {
  const layout = settings.app.layout;
  const value = Math.min(Math.max(fraction, 0.02), 0.98);
  if (layout.splits[id] === value) return settings;
  return { ...settings, app: { ...settings.app, layout: { ...layout, splits: { ...layout.splits, [id]: value } } } };
}

/**
 * Size in px of the pane a separator sizes, and the limits of its movement, for a container of
 * `available` px. The pane keeps `min` px and leaves at least `minRest` px to its neighbour where
 * the container is large enough for both.
 */
export function splitPixels(
  settings: Settings,
  id: SplitId,
  available: number,
): { value: number; min: number; max: number; defaultValue: number } {
  const spec = SPLITS[id];
  const min = Math.min(spec.min, Math.max(available, 0));
  const max = Math.max(min, available - spec.minRest);
  const clamp = (fraction: number) => Math.round(Math.min(Math.max(fraction * available, min), max));
  return { value: clamp(splitFraction(settings, id)), min, max, defaultValue: clamp(spec.fraction) };
}

/**
 * Height of the editor's message list (editor-ui §7.3; section 2.2): 5 px before the first
 * assembly, at least 87 px while it holds messages, 7 px after a clean assembly or after
 * `Clear Error Messages`. `dragged` is the height the user gave the list with the separator since
 * the list last changed, or null.
 */
export function messagesPaneHeight(input: {
  messageCount: number;
  assembled: boolean;
  dragged: number | null;
}): number {
  const { messageCount, assembled, dragged } = input;
  if (messageCount > 0) return Math.max(MESSAGES_OPEN_MIN, dragged ?? MESSAGES_OPEN_MIN);
  const collapsed = assembled ? MESSAGES_CLEAN : MESSAGES_INITIAL;
  return dragged === null ? collapsed : Math.max(MESSAGES_INITIAL, dragged);
}

/**
 * What `messagesPaneHeight` needs to know of the active document `id`: how many rows its list
 * holds, and whether the list has been used at all. A list is used once an assembly has given the
 * document a summary, or has written or cleared its rows: an include file's document gets rows (and
 * an empty list after `Clear Error Messages`, or when the next assembly clears it) without a summary
 * of its own, and its empty list is then 7 px, as the assembled document's is (editor-ui §4.2;
 * errata E5.md entry 8). `list` changes whenever the list is replaced or cleared.
 */
export function messageListOf(
  state: Pick<AppState, 'messages' | 'assemble'>,
  id: string | null,
): { count: number; assembled: boolean; list: string } {
  const summary = id === null ? undefined : state.assemble[id];
  const messages = id === null ? undefined : state.messages[id];
  return {
    count: messages?.length ?? 0,
    assembled: summary !== undefined || messages !== undefined,
    list: `${id ?? ''}/${summary?.at ?? ''}/${messages?.length ?? 0}`,
  };
}
export const MESSAGES_INITIAL = 5;
export const MESSAGES_CLEAN = 7;
export const MESSAGES_OPEN_MIN = 87;

/** Below this window width the simulator's right column moves under the left one (2.3). */
export const NARROW_WIDTH = 1100;
