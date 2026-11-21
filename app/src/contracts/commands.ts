// Contract: commands (ARCHITECTURE.md 3.12.2). Registry and tables: W3 (app/src/commands/).
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { AppContext } from './features';
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
  enabled?(state: AppState, ctx: AppContext): boolean; // default true
  checked?(state: AppState, ctx: AppContext, arg?: unknown): boolean;
}
export interface CommandRegistry {
  spec(id: CommandId): CommandSpec;
  register(id: CommandId, handler: CommandHandler): void; // exactly one handler per id
  /** Does nothing when the command is disabled and while a modal dialog is open (2.9.1). */
  run(id: CommandId, arg?: unknown): Promise<void>;
  isEnabled(id: CommandId): boolean;
  isChecked(id: CommandId, arg?: unknown): boolean;
}
