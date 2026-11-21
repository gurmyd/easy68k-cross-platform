// Which document is in which pane of the editor area (ARCHITECTURE.md 2.2, 1.4 note 9). Owner: E2.
//
// The original's MDI child windows become tabs. `Cascade` gives one pane with every document as a
// tab; `Tile Horizontally` two panes one above the other; `Tile Vertically` two panes side by side
// (`AppSettings.layout.editorPanes`: 'one' | 'horizontal' | 'vertical'). Each document is in exactly
// one pane; a new document opens in the active pane, the pane of the active document.
//
// This is plain data with pure functions; the editor area keeps one `PaneModel` per window.

export type PaneLayout = 'one' | 'horizontal' | 'vertical';
export type PaneIndex = 0 | 1;

export interface PaneState {
  /** The pane of each document that has been placed; a document not listed is in the active pane. */
  readonly pane: Readonly<Record<string, PaneIndex>>;
  /** The pane that new documents go to. */
  readonly activePane: PaneIndex;
  /** The document each pane showed last, to come back to when the active document is elsewhere. */
  readonly shown: readonly [string | null, string | null];
}

export const INITIAL_PANES: PaneState = { pane: {}, activePane: 0, shown: [null, null] };

export interface PaneView {
  /** The documents of the pane, in the order of opening. */
  ids: string[];
  /** The document the pane shows, or null when it holds none. */
  selected: string | null;
}

/**
 * Places documents that are new since the last call (into the active pane) and forgets closed
 * ones. `ids` is the order of opening; `activeId` the active document.
 */
export function syncPanes(state: PaneState, ids: readonly string[], activeId: string | null): PaneState {
  const pane: Record<string, PaneIndex> = {};
  let changed = false;
  for (const id of ids) {
    const known = state.pane[id];
    if (known === undefined) changed = true;
    pane[id] = known ?? state.activePane;
  }
  if (Object.keys(state.pane).some((id) => !(id in pane))) changed = true;
  let activePane = state.activePane;
  const activeIn = activeId === null ? undefined : pane[activeId];
  if (activeIn !== undefined && activeIn !== activePane) {
    activePane = activeIn;
    changed = true;
  }
  let shown = state.shown;
  if (activeId !== null && activeIn !== undefined && shown[activeIn] !== activeId) {
    shown = activeIn === 0 ? [activeId, shown[1]] : [shown[0], activeId];
    changed = true;
  }
  if (!changed) return state;
  return { pane, activePane, shown };
}

/** The two panes as the area draws them. With the layout 'one' everything is in pane 0. */
export function paneViews(
  state: PaneState,
  layout: PaneLayout,
  ids: readonly string[],
  activeId: string | null,
): [PaneView, PaneView] {
  const views: [PaneView, PaneView] = [
    { ids: [], selected: null },
    { ids: [], selected: null },
  ];
  for (const id of ids) {
    const index: PaneIndex = layout === 'one' ? 0 : (state.pane[id] ?? state.activePane);
    views[index].ids.push(id);
  }
  for (const index of [0, 1] as const) {
    const view = views[index];
    if (activeId !== null && view.ids.includes(activeId)) view.selected = activeId;
    else {
      const last = layout === 'one' ? null : state.shown[index];
      view.selected = last !== null && view.ids.includes(last) ? last : (view.ids[view.ids.length - 1] ?? null);
    }
  }
  return views;
}

/**
 * Going from one pane to two (Tile): when every document is in one pane and there are at least
 * two, the active document moves to the other pane, so both panes show something.
 */
export function tilePanes(state: PaneState, ids: readonly string[], activeId: string | null): PaneState {
  const synced = syncPanes(state, ids, activeId);
  const used = new Set(ids.map((id) => synced.pane[id] ?? synced.activePane));
  if (used.size !== 1 || ids.length < 2 || activeId === null) return synced;
  const from = synced.pane[activeId] ?? synced.activePane;
  const to: PaneIndex = from === 0 ? 1 : 0;
  const rest = ids.filter((id) => id !== activeId);
  const other = rest[rest.length - 1] ?? null;
  return {
    pane: { ...synced.pane, [activeId]: to },
    activePane: to,
    shown: to === 1 ? [other, activeId] : [activeId, other],
  };
}

/** Moves a document to the other pane (the tab's context menu). */
export function moveToOtherPane(state: PaneState, id: string): PaneState {
  const from = state.pane[id] ?? state.activePane;
  const to: PaneIndex = from === 0 ? 1 : 0;
  return {
    pane: { ...state.pane, [id]: to },
    activePane: to,
    shown: to === 1 ? [state.shown[0], id] : [id, state.shown[1]],
  };
}

/** Makes a pane the active one (a click into an empty pane: the next New or Open goes there). */
export function activatePane(state: PaneState, index: PaneIndex): PaneState {
  return state.activePane === index ? state : { ...state, activePane: index };
}

/** The pane model of one window. */
export class PaneModel {
  private current: PaneState = INITIAL_PANES;
  private readonly listeners = new Set<() => void>();

  get state(): PaneState {
    return this.current;
  }

  set(update: (state: PaneState) => PaneState): void {
    const next = update(this.current);
    if (next === this.current) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
