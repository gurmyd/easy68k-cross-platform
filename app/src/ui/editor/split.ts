// The editor split (ARCHITECTURE-PLUS P3.1.4, P3.1.7; work package N2). Owner: N2.
//
// Three commands of the Editor's Window menu give the two-pane model of panes.ts (E2) the names a
// student from another editor looks for. The original's Cascade, Tile Horizontally and Tile
// Vertically keep their behaviour; these are defined in terms of them:
//
//   ed.window.splitRight   one pane: what Tile Vertically does (layout 'vertical', tilePanes);
//                          two panes side by side: the active document moves to the other pane;
//                          two panes one above the other: side by side, and the active document
//                          moves to the other pane
//   ed.window.splitDown    the same with 'horizontal' (one above the other)
//   ed.window.unsplit      what Cascade does (layout 'one'; which pane holds what is kept)
//
// The layout is the setting `AppSettings.layout.editorPanes`; the pane of each document is the
// window's PaneModel. `splitEditor` is the pure rule; `runSplit` applies it to a model and the
// setting. Dragging a document's tab onto the other pane (EditorPane, EditorArea) moves it with
// `moveToPane`, which builds on `moveToOtherPane`.

import type { AppContext, Settings } from '../../contracts';
import {
  moveToOtherPane,
  syncPanes,
  tilePanes,
  type PaneIndex,
  type PaneLayout,
  type PaneModel,
  type PaneState,
} from './panes';
import { editorSession } from './session';

export type SplitCommand = 'splitRight' | 'splitDown' | 'unsplit';

export interface SplitResult {
  readonly panes: PaneState;
  readonly layout: PaneLayout;
}

/** The layout a split command makes, from any layout. */
const TARGET: Readonly<Record<SplitCommand, PaneLayout>> = {
  splitRight: 'vertical',
  splitDown: 'horizontal',
  unsplit: 'one',
};

/**
 * What a split command does to the panes and the layout. `ids` are the open documents in the
 * order of opening, `activeId` the active document.
 */
export function splitEditor(
  command: SplitCommand,
  panes: PaneState,
  layout: PaneLayout,
  ids: readonly string[],
  activeId: string | null,
): SplitResult {
  const target = TARGET[command];
  // Cascade: one pane; the pane of each document is kept for the next Tile.
  if (command === 'unsplit') return { panes, layout: target };
  // One pane: what Tile Vertically / Tile Horizontally does (E2's setLayout from 'one').
  if (layout === 'one') return { panes: tilePanes(panes, ids, activeId), layout: target };
  // Two panes: the active document goes to the other pane (and the orientation becomes the
  // command's own).
  const synced = syncPanes(panes, ids, activeId);
  const moved = activeId !== null && ids.includes(activeId) ? moveToOtherPane(synced, activeId) : synced;
  return { panes: moved, layout: target };
}

/** Whether a split command is enabled (P3.1.4): Split while a document is open, Close Split while there are two panes. */
export function splitEnabled(command: SplitCommand, layout: PaneLayout, hasDocument: boolean): boolean {
  return command === 'unsplit' ? layout !== 'one' : hasDocument;
}

/** What `runSplit` works on: the window's pane model and the layout setting. */
export interface SplitTarget {
  readonly panes: PaneModel;
  layout(): PaneLayout;
  setLayout(layout: PaneLayout): void;
  /** The open documents in the order of opening. */
  ids(): readonly string[];
  activeId(): string | null;
}

/** Runs a split command on a pane model and the layout setting. */
export function runSplit(command: SplitCommand, target: SplitTarget): void {
  const layout = target.layout();
  const result = splitEditor(command, target.panes.state, layout, target.ids(), target.activeId());
  target.panes.set(() => result.panes);
  if (result.layout !== layout) target.setLayout(result.layout);
}

/** The split operations of one window, as the commands of features/editor use them. */
export interface SplitActions {
  run(command: SplitCommand): void;
  enabled(command: SplitCommand): boolean;
}

/** The split target of the window `ctx` belongs to: its editor session's panes and its settings. */
export function splitTargetOf(ctx: AppContext): SplitTarget {
  return {
    panes: editorSession(ctx).panes,
    layout: () => ctx.settings.get().app.layout.editorPanes as PaneLayout,
    setLayout: (layout) =>
      ctx.settings.update((settings: Settings): Settings => ({
        ...settings,
        app: { ...settings.app, layout: { ...settings.app.layout, editorPanes: layout } },
      })),
    ids: () => ctx.store.getState().documents.items.map((doc) => doc.id),
    activeId: () => ctx.store.getState().documents.activeId ?? ctx.documents.active()?.id ?? null,
  };
}

/** The split operations of the window `ctx` belongs to. */
export function splitActionsOf(ctx: AppContext): SplitActions {
  return {
    run: (command) => runSplit(command, splitTargetOf(ctx)),
    enabled: (command) => {
      const target = splitTargetOf(ctx);
      return splitEnabled(command, target.layout(), target.activeId() !== null);
    },
  };
}

// ---- moving a document by dragging its tab

/** The drag type of a document tab (P5 N2). */
export const DOCUMENT_DRAG_TYPE = 'application/x-e68-document';

/**
 * Puts a document's pane at `index`; nothing changes when it is there already, so a drop that
 * reaches both the strip and the pane around it moves the document once.
 */
export function moveToPane(state: PaneState, id: string, index: PaneIndex): PaneState {
  const from = state.pane[id] ?? state.activePane;
  return from === index ? state : moveToOtherPane(state, id);
}

/**
 * The data a dragged document tab carries: the window's own token and the document id, so that a
 * tab dragged from another application window (whose ids mean other documents) moves nothing.
 */
export function documentDragData(windowToken: string, id: string): string {
  return JSON.stringify({ window: windowToken, id });
}

/** The document id of a drag's data, or null when it is not a document tab of this window. */
export function readDocumentDrag(windowToken: string, data: string): string | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null) return null;
    const { window, id } = value as { window?: unknown; id?: unknown };
    return window === windowToken && typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

const tokens = new WeakMap<AppContext, string>();
let tokenCount = 0;

/** A token for the window `ctx` belongs to, unique within this page and across pages. */
export function windowTokenOf(ctx: AppContext): string {
  let token = tokens.get(ctx);
  if (token === undefined) {
    tokenCount += 1;
    token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${tokenCount}`;
    tokens.set(ctx, token);
  }
  return token;
}
