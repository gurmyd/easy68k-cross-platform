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
//   dockOf(ctx).move('files', { kind: 'edge', side: 'right' })     Move Panel To...
//   dockOf(ctx).setLocked(false), .locked(), .reset(), .describe(), .subscribe(listener)
//
// Without an attached dock (tests under Node, a window before its first render) reveal, park and
// move do nothing; the visibility itself is the settings' (layout.panels), which the dock follows
// when it attaches. The lock state is the setting `layout.dock.locked` (absent = true, D2), so
// locked() and setLocked() work without a dock too.

import type { ReactNode } from 'react';
import type { AppContext, DockLayouts, Mode, Settings } from '../contracts';

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
  /** The moves of P3.1.4; `near` is a panel id, `side` a side of P3.1.4's dialog. */
  move(panel: string, target: { kind: 'tab' | 'beside' | 'edge'; near?: string; side?: string }): void;
  setLocked(on: boolean): void;
  /** The lock state, for the check command `app.layout.lock`; N0's stub returns true (D2). */
  locked(): boolean;
  /** Called after any change of the arrangement or the lock (menus refresh their check state). */
  subscribe(listener: () => void): () => void;
  reset(): void;
  /** The visible panels, open viewers included, with their titles and the group each is in, for
   *  the dialog `layout.move` and the tab menu. */
  describe(): { panel: string; title: string; group: number }[];
  /** N1's addition: counters of development builds and tests (actions the docks dispatched, how
   *  often each panel's content was mounted). Read by the browser check. */
  stats(): DockStats;
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
  /** Closes every transient tab (a mode change, P4.4). */
  closeAllTransients(): void;
  move(panel: string, target: DockMoveTarget): void;
  reset(): void;
  /** The lock setting changed; `announce` is true for the dock of the mode in front. */
  lockChanged(on: boolean, announce: boolean): void;
  describe(): { panel: string; title: string; group: number }[];
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
