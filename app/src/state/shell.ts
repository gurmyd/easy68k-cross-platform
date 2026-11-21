// State of the shell that is not part of the contracts' AppState (ARCHITECTURE.md 2.3, 2.10; 1.4
// note 4). Owner: W3.
//
// AppState (contracts/store.ts) is a contract and holds what several packages share. A few facts
// belong to the shell alone: which tool tab is in front, whether the Output panel is collapsed,
// a pending request to move the keyboard focus into a panel, and whether the web app has
// "exited". They live in a second small store, one per window. The bootstrap attaches it to the
// AppContext; code that has the context reaches it with shellStateOf(ctx). Feature code normally
// does not need it: state/panels.ts has the functions for showing, hiding and focusing panels.

import type { AppContext, Store } from '../contracts';
import { createStore } from './store';

export interface ShellState {
  /** The tool tab in front (2.3); null = the first visible one. */
  activeTool: string | null;
  /** The Output panel is collapsed (1.4 note 35: it can be collapsed, never closed). Not persisted:
   *  it is always visible at start (2.4). */
  outputCollapsed: boolean;
  /** The shell moves the focus into this panel once it is rendered, then clears the request.
   *  `serial` makes two requests for the same panel distinct. */
  focusRequest: { panel: string; serial: number } | null;
  /** Web only (1.4 note 4): Exit has run; the workspace shows `You can close this tab.` */
  exited: boolean;
}

export function initialShellState(): ShellState {
  return { activeTool: null, outputCollapsed: false, focusRequest: null, exited: false };
}

const stores = new WeakMap<object, Store<ShellState>>();

/** Creates the shell state of a window and ties it to its context. Called once by the bootstrap. */
export function attachShellState(ctx: AppContext): Store<ShellState> {
  const store = createStore(initialShellState());
  stores.set(ctx, store);
  return store;
}

/** The shell state of the window that `ctx` belongs to. */
export function shellStateOf(ctx: AppContext): Store<ShellState> {
  const store = stores.get(ctx);
  if (!store) throw new Error('This AppContext has no shell state: it was not created by bootstrap()');
  return store;
}

/** The text of the empty workspace after Exit in a browser (1.4 note 4). */
export const EXIT_TEXT = 'You can close this tab.';

/**
 * Web: what `Exit` shows when its work is done (close prompts, settings saved, logs stopped): an
 * empty workspace with the text `You can close this tab.`, because a page cannot close its own
 * tab. The handlers of `ed.file.exit`, `sim.file.exit` and `bin.file.exit` call this in a browser
 * and `platform.quit()` in the desktop app.
 */
export function showExitScreen(ctx: AppContext): void {
  shellStateOf(ctx).setState((state) => (state.exited ? state : { ...state, exited: true }));
}
