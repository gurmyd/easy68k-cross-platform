// State of the shell that is not part of the contracts' AppState (ARCHITECTURE.md 2.3, 2.10; 1.4
// note 4). Owner: W3.
//
// AppState (contracts/store.ts) is a contract and holds what several packages share. A few facts
// belong to the shell alone: which tool tab is in front, whether the Output panel is collapsed,
// a pending request to move the keyboard focus into a panel, and whether the web app has
// "exited". They live in a second small store, one per window. The bootstrap attaches it to the
// AppContext; code that has the context reaches it with shellStateOf(ctx). Feature code normally
// does not need it: state/panels.ts has the functions for showing, hiding and focusing panels.

import type { AppContext, Mode, Store } from '../contracts';
import { createStore } from './store';

export interface ShellState {
  /** The tool tab in front (2.3); null = the first visible one. Since ARCHITECTURE-PLUS (N1) the
   *  dock's selected tabs decide what is in front; the dock keeps this field (and outputInFront)
   *  in step with the selected tab of the group that holds the tool panels (P3.1.5), for the code
   *  that reads them, and starts its default arrangement from them. */
  activeTool: string | null;
  /** The Output panel is collapsed (1.4 note 35: it can be collapsed, never closed). Not persisted:
   *  it is always visible at start (2.4). */
  outputCollapsed: boolean;
  /**
   * Below 1100 px the Output panel is a tab of the tool group (2.3): true while that tab is to be in
   * front, because the Output panel was shown (Run, a keyboard-input task, View > Output Window) or
   * its tab chosen; choosing or showing a tool panel clears it. The wide layout ignores it, so
   * showing the Output panel never changes which tool tab is in front there.
   */
  outputInFront: boolean;
  /** The shell moves the focus into this panel once it is rendered, then clears the request.
   *  `serial` makes two requests for the same panel distinct. */
  focusRequest: { panel: string; serial: number } | null;
  /** Web only (1.4 note 4): Exit has run; the workspace shows `You can close this tab.` */
  exited: boolean;
  /**
   * Window titles that a mode's feature supplies in place of the mode's fixed title (setModeTitle):
   * EASyBIN shows the file opened last, as its original does (docs/requests/B1-window-title.md).
   */
  modeTitles: Partial<Record<Mode, string>>;
}

export function initialShellState(): ShellState {
  return {
    activeTool: null,
    outputCollapsed: false,
    outputInFront: false,
    focusRequest: null,
    exited: false,
    modeTitles: {},
  };
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

/**
 * Sets the title the window shows while `mode` is in front, in place of the mode's fixed title
 * (`EASyBIN v2.5.0`); null puts the fixed title back. The shell appends ` - unofficial port
 * <version>` as to every title (1.3.3). EASyBIN calls it with the full path of the file opened
 * last and with null after New (docs/porting/easybin.md 1.2). In Simulator mode the loaded
 * program's title (AppState.sim.program) comes before the fixed title, and a title set here comes
 * before both.
 */
export function setModeTitle(ctx: AppContext, mode: Mode, title: string | null): void {
  shellStateOf(ctx).setState((state) => {
    if ((state.modeTitles[mode] ?? null) === title) return state;
    const modeTitles = { ...state.modeTitles };
    if (title === null) delete modeTitles[mode];
    else modeTitles[mode] = title;
    return { ...state, modeTitles };
  });
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
