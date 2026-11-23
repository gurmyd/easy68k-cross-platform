// Contract: commands (ARCHITECTURE.md 3.12.2). Registry and tables: W3 (app/src/commands/).
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { AppContext } from './features';
import type { VPath } from './fs';
import type { AppState, Mode } from './store';

export type CommandId = string; // every id of section 1.3; the union lives in commands/ids.ts
export interface CommandSpec {
  id: CommandId;
  mode: Mode | 'app';
  caption: string; // original caption with '&'
  hint?: string; // toolbar tool-tip
  kind: 'action' | 'check' | 'radio';
  /** notInOutput: the chords among them that the port added (K3, K5); they are not active while the
   *  Output panel has the keyboard (2.9.4).
   *  win, mac and desktopOnly are read through chordsOn(id, os, desktop) and
   *  isDesktopOnly(id, chord, os) of app/src/commands/specs.ts, never directly: desktopOnly is one
   *  list for both key maps, and specs.ts knows which of its chords are desktop-only on Windows and
   *  Linux alone (errata W3.md, entry 3). */
  keys: { win: string[]; mac: string[]; desktopOnly?: string[]; notInOutput?: string[] };
  suppressedByTask24: boolean; // one of the eleven of sim-ui §3.5
  icon?: string;
}
export interface CommandHandler {
  run(ctx: AppContext, arg?: unknown): void | Promise<void>;
  /** Default true. Menus and toolbars ask again whenever the store notifies. A handler whose answer
   *  depends on something outside the store (the editor's undo history, selection or focus) makes
   *  them ask again with `ctx.store.setState((state) => ({ ...state }))`, a new state object with
   *  the same contents (docs/porting/errata/W1.md, entry 11). `arg`: the argument of the run that
   *  asks (CommandRegistry.run passes it on), absent when a menu, a toolbar or a key asks; added by
   *  the stage of additions for `ed.file.history { path }` (docs/requests/N4-history-ui.md item 6). */
  enabled?(state: AppState, ctx: AppContext, arg?: unknown): boolean;
  checked?(state: AppState, ctx: AppContext, arg?: unknown): boolean;
}
/** Options of CommandRegistry.run. Added at gate I1 (docs/porting/errata/W1.md, entry 11). */
export interface CommandRunOptions {
  /**
   * Run the command although a modal dialog is open. Only the code of the open dialog itself passes
   * it, for its Help button and F1 (editor-ui §15.2: the option dialogs open `options.htm`). The key
   * dispatcher, toolbars, menus and the native menu never pass it, so the rule of 2.9.1 holds for
   * everything the user can do outside the dialog.
   */
  allowInModal?: boolean;
}
/**
 * The argument of the command `app.files.toggle` that shows the Files panel (it never hides it
 * then) and reveals `reveal` in its tree: `ctx.commands.run('app.files.toggle', { reveal })`.
 * Help > Examples... in a browser copies the examples to /browser/Examples and "shows it in the
 * Files panel" (5.8). Without an argument the command toggles the panel, as before. Added at gate
 * I1 round 2 (docs/porting/errata/W1.md, entry 12).
 */
export interface FilesRevealArg {
  reveal: VPath;
}
export interface CommandRegistry {
  spec(id: CommandId): CommandSpec;
  register(id: CommandId, handler: CommandHandler): void; // exactly one handler per id
  /** Does nothing when the command is disabled and while a modal dialog is open (2.9.1), unless
   *  `options.allowInModal` is set (see CommandRunOptions). */
  run(id: CommandId, arg?: unknown, options?: CommandRunOptions): Promise<void>;
  /** `arg`: as for CommandHandler.enabled; run() asks with its own argument. */
  isEnabled(id: CommandId, arg?: unknown): boolean;
  isChecked(id: CommandId, arg?: unknown): boolean;
}
