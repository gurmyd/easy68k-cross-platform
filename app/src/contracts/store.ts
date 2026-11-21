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
     * `stackRedraw` (entry 12, docs/requests/U2-stack-redraw-bit.md) will count the original's
     * `StackFrm->Repaint()`, after which the Stack panel redraws without re-centring, apart from
     * `updateDisplay()`, which `stack` counts. The engine does not report that call yet, so nothing
     * writes `stackRedraw` and `stack` moves for both; while it is absent, `stack` alone decides.
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
