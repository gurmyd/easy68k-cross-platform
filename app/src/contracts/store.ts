// Contract: the application store (ARCHITECTURE.md 3.12.1). Implemented by W3 (app/src/state/).
// Large or fast-changing data (memory, pixels, listing rows, log tails, register values) is not in
// the store; components read it from SimSession when the matching revision counter changes.
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { DocumentState } from './documents';
import type { DialogInstance } from './features';
import type { VPath } from './fs';
import type { ProgramInfo, SimPhase } from './run';
import type { Settings } from './settings';

export interface Store<S> {
  getState(): S;
  setState(update: (state: S) => S): void; // synchronous; listeners run after the update
  subscribe(listener: () => void): () => void;
}
export interface AppState {
  mode: Mode;
  documents: { items: DocumentState[]; activeId: string | null };
  messages: Record<string, EditorMessage[]>; // key = document id
  assemble: Record<string, AssembleSummary>; // key = document id; last result
  /** Writers of `sim` (docs/porting/errata/W1.md, entry 11): the simulator session (SH8,
   *  features/run/mirror.ts) writes every member except `selectedRow`, which is the Listing
   *  panel's (3.11.4). `output.fullScreen` has a second writer, the Output panel (see below). */
  sim: {
    program: ProgramInfo | null;
    phase: SimPhase;
    menuState: 0 | 1; // 0 active, 1 busy (sim-ui §3.6)
    /** The engine's raw halt flag (`RunSnapshot.halted`, `SimStateFlags.halt`), copied as it is.
     *  A simulator reset (sim-ui §9.9: start-up, Open, Reload, Close, Rewind) does not clear it;
     *  only the next run does. It therefore does not say whether the commands are blocked: that is
     *  `menuState` (sim-ui §3.6). Text such as "Halted" in the status bar takes both into account
     *  (docs/porting/errata/W1.md, entry 13). */
    halted: boolean;
    autoTrace: boolean;
    keyCommands: boolean;
    logging: boolean;
    regsRevision: number; // bump = register fields and cycle counter re-read the snapshot
    viewRevision: number; // bump = listing highlight, Stack, non-live Memory refresh (4.6)
    liveRevision: number; // bump at most once per frame: memory / hardware changed
    selectedRow: number; // listing selection ("cursor"), -1 = none
    messageLines: string[];
    breakpoints: number[]; // engine.breakpoints(), mirrored by the session
    /** width, height: the size of the surface's back buffer; textWrap: TextState.textWrap; all three
     *  mirrored by the session once per frame (the Output panel writes the same values right after
     *  its own commands). fullScreen: "full screen is on, or asked for". The session writes it when
     *  the engine asks (host.setupWindow) and at a cold start (false); the Output panel writes it
     *  when the user toggles full screen or the browser ends it (2.5). */
    output: { width: number; height: number; fullScreen: boolean; textWrap: boolean };
    /**
     * How often the engine has named each panel in host.repaint(what) (4.6, RepaintBit): a panel
     * re-reads its data, and the Stack panel re-centres, when its own counter moves.
     * `viewRevision` still moves with every one of them. Added at gate I1 as an optional member
     * (docs/porting/errata/W1.md, entry 11): while it is absent a panel falls back on `viewRevision`.
     * `stackRedraw` (entries 12 and 13, docs/requests/U2-stack-redraw-bit.md) counts
     * `RepaintBit.StackRedraw`, which the engine sends together with `RepaintBit.Stack` for the
     * original's `StackFrm->Repaint()`; `updateDisplay()` sends `Stack` alone. So `stack` moves for
     * both, and the Stack panel re-centres only when `stack` moved by more than `stackRedraw` did;
     * otherwise it redraws where it is (sim-ui §11.4). While `stackRedraw` is absent (a session that
     * does not count it yet), `stack` alone decides.
     */
    repaint?: { listing: number; breakpoints: number; memory: number; stack: number; stackRedraw?: number };
  };
  dialogs: { stack: DialogInstance[] };
  settings: Settings; // mirror of SettingsService
}
export type Mode = 'editor' | 'simulator' | 'easybin';
export interface EditorMessage {
  file: VPath | null;
  line: number;
  text: string;
  severity: 'error' | 'warning';
}
export interface AssembleSummary {
  errors: number;
  warnings: number;
  hasSRecord: boolean;
  hasListing: boolean;
  at: number;
}
