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
    breakpoints: number[];
    output: { width: number; height: number; fullScreen: boolean; textWrap: boolean };
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
