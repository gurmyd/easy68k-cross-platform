// The per-window dock controller (ARCHITECTURE-PLUS P3.1.5, P4.4). Owner: N0 > N1.
//
// state/panels.ts calls it to show, hide and focus panels; features reach the dock only through
// here (the viewer opens its transient tabs with openTransient, features/layout moves panels). It
// imports neither ui/dock nor flexlayout-react: each mounted dock (ui/dock/DockWorkspace.tsx, one
// for Editor mode and one for Simulator mode) attaches itself with attachDock() and the controller
// routes every request to the dock of the panel's mode.
//
//   dockOf(ctx).reveal('memory')        showPanel: the tab is put back and selected
//   dockOf(ctx).park('memory')          hidePanel: the tab goes, its place is remembered
//   dockOf(ctx).present('memory')       focusPanel: selects the panel's tab first
//   dockOf(ctx).openTransient({...})    a viewer tab in the group of the Editor panel; called
//                                       before the Editor dock has attached, it is queued and
//                                       applied when the dock attaches (P4.4)
//   dockOf(ctx).documentShown()         a document was opened or chosen, or an Editor command
//                                       changed what the editor area shows: a viewer's tab in
//                                       front of the Editor's gives way to it (errata N1 28)
//   dockOf(ctx).move('files', { kind: 'edge', side: 'right' })     Move Panel To...
//   dockOf(ctx).setLocked(false), .locked(), .reset(), .describe(), .subscribe(listener)
//
// Without an attached dock (tests under Node, a window before its first render) reveal, park and
// move do nothing; the visibility itself is the settings' (layout.panels), which the dock follows
// when it attaches. The lock state is the setting `layout.dock.locked` (absent = true, D2), so
// locked() and setLocked() work without a dock too.

import type { ReactNode } from 'react';
import type { AppContext, CommandHandler, DockLayouts, DockNode, Mode, Settings } from '../contracts';

export interface DockController {
  reveal(id: string, options?: { select?: boolean }): void; // showPanel
  park(id: string): void; // hidePanel (never for 'output')
  present(id: string): boolean; // focusPanel: selects its tab
  /** True for N1's controller, also before DockWorkspace has attached a model; false for N0's stub. */
  acceptsTransient(): boolean;
  openTransient(spec: {
    id: `viewer:${number}`;
    title: string;
    tooltip: string;
    render(): ReactNode;
    onClose(): void;
  }): boolean; // false: acceptsTransient() is false
  selectTransient(id: string): boolean;
  closeTransient(id: string): void;
  /**
   * N1's addition (errata N1 28): a document was made the one a person works on (the document
   * service's `shown`), or an Editor command changed what the editor area shows (Cascade, Tile,
   * the split commands, Close File). When a viewer's tab is in front of the Editor's in its group, the Editor's
   * tab comes forward; otherwise nothing happens. Without the Editor dock it does nothing.
   */
  documentShown(): void;
  /** The moves of P3.1.4; `near` is a panel id, `side` a side of P3.1.4's dialog. */
  move(panel: string, target: { kind: 'tab' | 'beside' | 'edge'; near?: string; side?: string }): void;
  setLocked(on: boolean): void;
  /** The lock state, for the check command `app.layout.lock`; N0's stub returns true (D2). */
  locked(): boolean;
  /** Called after any change of the arrangement or the lock (menus refresh their check state). */
  subscribe(listener: () => void): () => void;
  reset(): void;
  /** The visible panels, open viewers included, with their titles and the group each is in, for
   *  the dialog `layout.move` and the tab menu. A floating panel (version 1.1) is listed after the
   *  docked ones with `group: 0` and `floating: true`; it is no target of a move. */
  describe(): DockDescription[];
  /** N1's addition: counters of development builds and tests (actions the docks dispatched, how
   *  often each panel's content was mounted). Read by the browser check. */
  stats(): DockStats;

  // --- version 1.1: floating panels (ARCHITECTURE-PLUS P9.2, P9.4; M1) ---------------------------

  /**
   * Makes `panel` (a panel of the mode in front, or of its own mode) a floating window. `rect`
   * absent: the place and size it had when it floated last, else its docked size (at most three
   * quarters of the dock in either direction) cascaded from the last floating window. A panel that
   * floats already is moved to `rect` (when given) and brought to the front. A hidden panel is
   * recorded as floating and floats when it is shown (P1.1 rule 4: visibility is never changed).
   * Does nothing when the panel cannot float (canFloat). Works locked or not (D8).
   */
  float(panel: string, rect?: DockRect): void;
  /** Docks a floating panel at the place it was docked at last (that group gone: its default place). */
  dock(panel: string): void;
  /** The floating windows of `mode` (default: the mode in front), in the order they were made to float. */
  floating(mode?: DockMode): DockFloating[];
  /** Whether `panel` can float now: a docked panel of a dock mode that is not the last docked one. */
  canFloat(panel: string): boolean;
  /**
   * Puts every panel of `arrangement.mode` where the arrangement says (P9.4); shows and hides no
   * panel, keeps the lock. An arrangement that does not name every panel of the mode exactly once
   * (or lacks a panel that cannot be closed) is refused: nothing changes and false is returned.
   */
  arrange(arrangement: DockArrangement): boolean;
}

/**
 * A floating window's place and size in CSS pixels, relative to the top left corner of its mode's
 * dock (the workspace between the toolbar and the status bar), P9.2.
 */
export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A floating window (P9.2). `visible` is the panel's visibility (layout.panels), never changed here. */
export interface DockFloating {
  panel: string;
  rect: DockRect;
  visible: boolean;
}

/**
 * A ready-made arrangement of a mode (P9.4): every panel of the mode, shown or hidden, with its
 * place. A panel is either in `docked` (a stored tree, P4.2; weights are proportions, as stored)
 * or in `floating`. A hidden panel in `docked` takes its place when it is shown (its place is
 * parked from the tree, as for Reset Layout). `docked` must hold every panel that cannot be closed
 * that does not float (FIXED_PANELS of ui/dock/model.ts: Editor `editor`, `messages`; Simulator
 * `registers`, `listing`, `messages`, `output`).
 */
export interface DockArrangement {
  mode: DockMode;
  docked: DockNode;
  /**
   * The floating panels, in the order they are made to float. An entry without `rect` gets the
   * dock's default floating size (DEFAULT_FLOAT_SIZE, at most three quarters of the dock), cascaded
   * from `cascade` (default 'top-left'): the first at that corner of the dock, each next one
   * 24 px further in.
   */
  floating: { panel: string; rect?: DockRect }[];
  cascade?: 'top-left' | 'top-right';
}

/** The default size of a floating window that is given no size (P9.4 `Floating Tools`). */
export const DEFAULT_FLOAT_SIZE = { width: 360, height: 280 } as const;

/** The smallest floating window (P9.2): not less than 160 by 96 pixels. */
export const MIN_FLOAT_SIZE = { width: 160, height: 96 } as const;

/** The step of a cascade (P9.2, P9.4). */
export const FLOAT_CASCADE_STEP = 24;

/** A panel of DockController.describe(). */
export interface DockDescription {
  panel: string;
  title: string;
  /** The group's number in reading order, from 1; 0 for a floating panel. */
  group: number;
  floating?: true;
}

/** The spec of a transient tab (a viewer, P3.1.2). */
export type TransientSpec = Parameters<DockController['openTransient']>[0];

/** A move of P3.1.4. */
export type DockMoveTarget = Parameters<DockController['move']>[1];

/** The two modes that have a dock (P3.1.1: EASyBIN has one panel and no layout commands). */
export type DockMode = Extract<Mode, 'editor' | 'simulator'>;

export interface DockStats {
  /** Actions each dock dispatched to its model (including the ones FlexLayout made from a drag). */
  actions: Record<DockMode, number>;
  /** How many distinct instances of each panel's content were mounted, by `<mode>:<panel>`. */
  mounts: Record<string, number>;
}

/** What a mounted dock gives the controller (ui/dock/DockWorkspace.tsx). */
export interface DockLive {
  readonly mode: DockMode;
  /** The panel (or viewer) is a tab of this dock now. */
  has(id: string): boolean;
  reveal(id: string, select: boolean): void;
  park(id: string): void;
  present(id: string): boolean;
  openTransient(spec: TransientSpec): void;
  selectTransient(id: string): boolean;
  closeTransient(id: string): void;
  /** DockController.documentShown, for the Editor dock (the Simulator's does nothing). */
  documentShown(): void;
  /** Closes every transient tab (a mode change, P4.4). */
  closeAllTransients(): void;
  move(panel: string, target: DockMoveTarget): void;
  reset(): void;
  /** The lock setting changed; `announce` is true for the dock of the mode in front. */
  lockChanged(on: boolean, announce: boolean): void;
  describe(): DockDescription[];
  /** Version 1.1 (M1): optional, so that a dock without floating windows still attaches. */
  float?(panel: string, rect?: DockRect): void;
  dock?(panel: string): void;
  floating?(): DockFloating[];
  canFloat?(panel: string): boolean;
  arrange?(arrangement: DockArrangement): boolean;
}

/** What attachDock() returns to the dock. */
export interface DockAttachment {
  /** Tells the controller's subscribers that the arrangement changed. */
  changed(): void;
  /** Counts an action the dock dispatched (development builds and tests). */
  countAction(): void;
  /** Records that an instance of a panel's content was mounted. */
  countMount(panel: string, instance: object): void;
  detach(): void;
}

/** Panels that exist only in Editor mode or only in Simulator mode (P3.1.2). Others: the mode in front. */
const EDITOR_ONLY = new Set(['files', 'editor']);
const SIMULATOR_ONLY = new Set(['registers', 'listing', 'output', 'memory', 'stack', 'hardware', 'breakpoints', 'log']);

/**
 * The mode whose dock holds `id`; `messages` belongs to the mode in front. Null for what is not a
 * dock panel: the Help drawer, the EASyBIN workspace, the status bars (P3.1.5).
 */
export function dockModeOf(id: string, current: Mode): DockMode | null {
  if (/^viewer:\d+$/.test(id) || EDITOR_ONLY.has(id)) return 'editor';
  if (SIMULATOR_ONLY.has(id)) return 'simulator';
  if (id !== 'messages') return null;
  return current === 'editor' || current === 'simulator' ? current : null;
}

/** The stored lock state: `layout.dock.locked`, absent or malformed = true (D2). */
export function lockedIn(settings: Settings): boolean {
  const dock: unknown = settings.app.layout.dock;
  if (typeof dock !== 'object' || dock === null) return true;
  const locked = (dock as { locked?: unknown }).locked;
  return typeof locked === 'boolean' ? locked : true;
}

/** `settings` with `layout.dock.locked` set (the rest of the stored dock is kept as it is). */
export function withLocked(settings: Settings, on: boolean): Settings {
  const layout = settings.app.layout;
  const stored: unknown = layout.dock;
  if (lockedIn(settings) === on) return settings;
  const base: DockLayouts =
    typeof stored === 'object' && stored !== null && (stored as { version?: unknown }).version === 1
      ? (stored as DockLayouts)
      : { version: 1 };
  return { ...settings, app: { ...settings.app, layout: { ...layout, dock: { ...base, locked: on } } } };
}

interface ControllerState {
  lives: Map<DockMode, DockLive>;
  queue: Map<string, TransientSpec>;
  listeners: Set<() => void>;
  stats: DockStats;
  /** Instances of panel content seen, by `<mode>:<panel>`. */
  instances: Map<string, WeakSet<object>>;
}

function createDockController(ctx: AppContext, state: ControllerState): DockController {
  const currentMode = (): Mode => ctx.store.getState().mode;
  const liveFor = (id: string): DockLive | undefined => {
    const mode = dockModeOf(id, currentMode());
    return mode === null ? undefined : state.lives.get(mode);
  };
  const front = (): DockLive | undefined => {
    const mode = currentMode();
    return mode === 'editor' || mode === 'simulator' ? state.lives.get(mode) : undefined;
  };
  const notify = () => {
    for (const listener of [...state.listeners]) listener();
  };

  return {
    reveal(id, options = {}) {
      liveFor(id)?.reveal(id, options.select !== false);
    },
    park(id) {
      if (id === 'output') return; // P3.1.5: the Output panel only collapses
      liveFor(id)?.park(id);
    },
    present(id) {
      return liveFor(id)?.present(id) ?? false;
    },
    acceptsTransient: () => true,
    openTransient(spec) {
      const live = state.lives.get('editor');
      if (live) live.openTransient(spec);
      else state.queue.set(spec.id, spec);
      return true;
    },
    selectTransient(id) {
      const live = state.lives.get('editor');
      if (live) return live.selectTransient(id);
      return state.queue.has(id);
    },
    closeTransient(id) {
      const live = state.lives.get('editor');
      if (live) {
        live.closeTransient(id);
        return;
      }
      const queued = state.queue.get(id);
      if (!queued) return;
      state.queue.delete(id);
      try {
        queued.onClose();
      } catch (error) {
        console.error(error);
      }
    },
    documentShown() {
      state.lives.get('editor')?.documentShown();
    },
    move(panel, target) {
      liveFor(panel)?.move(panel, target);
    },
    setLocked(on) {
      ctx.settings.update((settings) => withLocked(settings, on));
      const mode = currentMode();
      for (const live of state.lives.values()) live.lockChanged(on, live.mode === mode);
      notify();
    },
    locked: () => lockedIn(ctx.settings.get()),
    subscribe(listener) {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
    reset() {
      front()?.reset();
      notify();
    },
    describe: () => front()?.describe() ?? [],
    float(panel, rect) {
      liveFor(panel)?.float?.(panel, rect);
    },
    dock(panel) {
      liveFor(panel)?.dock?.(panel);
    },
    floating(mode) {
      const live = mode === undefined ? front() : state.lives.get(mode);
      return live?.floating?.() ?? [];
    },
    canFloat(panel) {
      return liveFor(panel)?.canFloat?.(panel) ?? false;
    },
    arrange(arrangement) {
      const live = state.lives.get(arrangement.mode);
      const done = live?.arrange?.(arrangement) ?? false;
      if (done) notify();
      return done;
    },
    stats: () => ({
      actions: { ...state.stats.actions },
      mounts: { ...state.stats.mounts },
    }),
  };
}

interface Entry {
  controller: DockController;
  state: ControllerState;
}

const entries = new WeakMap<AppContext, Entry>();

function entryOf(ctx: AppContext): Entry {
  let entry = entries.get(ctx);
  if (!entry) {
    const state: ControllerState = {
      lives: new Map(),
      queue: new Map(),
      listeners: new Set(),
      stats: { actions: { editor: 0, simulator: 0 }, mounts: {} },
      instances: new Map(),
    };
    entry = { controller: createDockController(ctx, state), state };
    entries.set(ctx, entry);
  }
  return entry;
}

/** The panel named by a command's argument `{ panel }`, else the one that holds the focus. */
function panelArg(arg: unknown): string | null {
  const asked = typeof arg === 'object' && arg !== null ? (arg as { panel?: unknown }).panel : undefined;
  if (typeof asked === 'string') return asked;
  const active = globalThis.document?.activeElement as { closest?(selector: string): Element | null } | null;
  const region = typeof active?.closest === 'function' ? active.closest('[data-e68-panel]') : null;
  return region?.getAttribute('data-e68-panel') ?? null;
}

const inDockMode = (state: { mode: string }) => state.mode === 'editor' || state.mode === 'simulator';

function canFloatArg(ctx: AppContext, arg: unknown): boolean {
  const panel = panelArg(arg);
  return panel !== null && dockOf(ctx).canFloat(panel);
}

/**
 * The handlers of the two commands of P9.5 that M1 owns (no chord, P1.3): `app.layout.float`
 * (`&Float`, the tab menu, with `{ panel }`) and `app.layout.dock` (`&Dock`, a floating window's
 * title bar and its menu, with `{ panel }`). Without `panel`, the panel that holds the focus.
 * They are registered by the feature of the layout commands (features/layout/index.ts spreads
 * this object into its commands), because a command's handler comes from a feature (3.12.3).
 */
export const DOCK_COMMANDS: Record<'app.layout.float' | 'app.layout.dock', CommandHandler> = {
  'app.layout.float': {
    run: (ctx, arg) => {
      const panel = panelArg(arg);
      if (panel !== null) dockOf(ctx).float(panel);
    },
    // Asked with an argument (the tab menu): whether that panel can float now.
    enabled: (state, ctx, arg) => inDockMode(state) && (arg === undefined || canFloatArg(ctx, arg)),
  },
  'app.layout.dock': {
    run: (ctx, arg) => {
      const panel = panelArg(arg);
      if (panel !== null) dockOf(ctx).dock(panel);
    },
    enabled: (state, ctx, arg) =>
      inDockMode(state) &&
      (arg === undefined ||
        dockOf(ctx)
          .floating()
          .some((window) => window.panel === panelArg(arg))),
  },
};

/** The dock controller of the window of `ctx` (one per context). */
export function dockOf(ctx: AppContext): DockController {
  return entryOf(ctx).controller;
}

/**
 * Attaches a mounted dock. The transient tabs queued before the Editor dock attached are opened
 * in it now, in the order they were requested. Returns the dock's handle; detach() is its unmount.
 */
export function attachDock(ctx: AppContext, live: DockLive): DockAttachment {
  const { state } = entryOf(ctx);
  state.lives.set(live.mode, live);
  if (live.mode === 'editor' && state.queue.size > 0) {
    const queued = [...state.queue.values()];
    state.queue.clear();
    for (const spec of queued) live.openTransient(spec);
  }
  const notify = () => {
    for (const listener of [...state.listeners]) listener();
  };
  notify();
  return {
    changed: notify,
    countAction() {
      state.stats.actions[live.mode]++;
    },
    countMount(panel, instance) {
      const key = `${live.mode}:${panel}`;
      let seen = state.instances.get(key);
      if (!seen) {
        seen = new WeakSet();
        state.instances.set(key, seen);
      }
      if (seen.has(instance)) return;
      seen.add(instance);
      state.stats.mounts[key] = (state.stats.mounts[key] ?? 0) + 1;
    },
    detach() {
      if (state.lives.get(live.mode) === live) state.lives.delete(live.mode);
      notify();
    },
  };
}
