// Contract: the run controller and the simulator session (ARCHITECTURE.md 3.11.2). Implemented by
// SH8 (core/run/, features/run/session.ts). Section 4 specifies the behaviour.
//
// Where 3.11.2 writes a class name as a type (`surface: Surface`), this file uses the class's
// interface from devices.ts (`SurfaceApi`), as 3.1 says.
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type {
  GlyphProvider,
  HardwareModelApi,
  InputEvent68k,
  ListingViewApi,
  LogServiceApi,
  OutputKeyboardApi,
  PrinterDeviceApi,
  PrintJob,
  ProgramFilesApi,
  SoundDeviceApi,
  SurfaceApi,
  TextScreenApi,
} from './devices';
import type { Box, Bytes, SimEngine } from './engine';
import type { VPath } from './fs';
import type { SimHost } from './host';

export type SimPhase = 'loading' | 'idle' | 'running' | 'waitInput' | 'waitDelay' | 'waitHost' | 'waitAlert';

/** Where a load comes from. 'execute', 'commandLine' and 'association' start from process-start
 *  state (4.7.1), because the original starts a new simulator process for them. */
export type LoadOrigin = 'open' | 'reload' | 'drop' | 'execute' | 'commandLine' | 'association';

/** Options of RunController.open. Added at gate I1 round 3 (docs/porting/errata/W1.md, entry 13). */
export interface LoadOptions {
  /** The caller has just asked step 2's question with `confirmLoad(origin)` and the user chose OK
   *  (or no question was needed): `open` skips step 2. Default false. */
  confirmed?: boolean;
}

export interface ProgramInfo {
  path: VPath; // the file Reload loads (after Open Data: the data file, sim-ui Q11)
  title: string; // from host.caption()
  hasListing: boolean;
}

export interface RunSnapshot {
  // refreshed after an engine call during which host.registersShown() ran
  boxes: readonly string[]; // 20 texts indexed by Box
  cycles: bigint;
  highlight: number; // engine.listingHighlight
  halted: boolean;
  revision: number; // increases with every refresh
}

export interface PendingAlert {
  title: string;
  text: string;
}

export interface RunController {
  readonly phase: SimPhase;
  readonly held: boolean; // a modal dialog of Simulator mode is open (2.7)
  readonly program: ProgramInfo | null;
  readonly snapshot: RunSnapshot;
  readonly alerts: readonly PendingAlert[]; // message boxes the engine opened, oldest first
  /**
   * True while a run command (Run, Run To Cursor, Step Over, Trace Into, Auto Trace), Pause, Rewind,
   * Reload or a second Execute given now is kept and carried out when the load has ended, instead
   * of being refused: during a load, and from the answer to the Caution question until the load
   * begins (errata SH8.md entries 47 and 48). The run feature enables those commands while it is
   * true. Added after the release-candidate check as an optional member (errata SH8.md entry 50),
   * so that the run feature depends on this contract and not on the SimRunController class: a
   * controller without it keeps nothing, and the commands follow the phase alone.
   */
  readonly keepsCommands?: boolean;
  subscribe(listener: () => void): () => void;

  /* loads: each puts the controller into 'loading'; a request made during 'loading' is ignored */
  /** 4.7. `options` was added at gate I1 round 3 (docs/porting/errata/W1.md, entry 13); see
   *  LoadOptions and confirmLoad. */
  open(path: VPath, origin: LoadOrigin, options?: LoadOptions): Promise<void>;
  /**
   * Step 2 of 4.7 on its own: asks the `Caution` question exactly when `open(path, origin)` would
   * ask it now (holding the program meanwhile), and resolves true when the load may go on (no
   * question was needed, or OK) and false on Cancel. For a caller that must do something between
   * the question and the load, as the original orders it: a dropped `.S68` in a browser is copied
   * into the browser store only after OK (sim-ui §8.4; FS1). The caller then calls
   * `open(path, origin, { confirmed: true })`. Added at gate I1 round 3 as an optional member
   * (docs/porting/errata/W1.md, entry 13): a controller that has it honours `confirmed`, and a
   * caller passes `confirmed` only to a controller that has it.
   */
  confirmLoad?(origin: LoadOrigin): Promise<boolean>;
  openData(path: VPath): Promise<void>;
  reload(): Promise<void>;
  close(): Promise<void>;
  coldStart(): Promise<void>; // process-start state without a program (4.7.1)

  run(): void;
  runToCursor(row: number): void; // row = selected listing row, -1 = none
  stepOver(): void;
  traceInto(): void;
  autoTrace(): void;
  pause(): void;
  rewind(): void;
  dismissAlerts(): void; // the user closed the box(es)

  /** Queue used by host parts and panels; delivered between instructions (4.3). */
  post(entry: InputEvent68k | ControllerRequest): void;
  /** For interface code: run an engine method that changes state. It runs at once when no engine
   *  call is in progress and the phase is not 'loading'; otherwise it is queued as a 'call' entry.
   *  Interface code never calls a state-changing engine method directly. */
  invoke(fn: (engine: SimEngine) => void): void;
  /** While at least one hold is active nothing calls engine.run() (2.7). Returns the release. */
  hold(): () => void;

  editBox(box: Box, text: string): void; // Registers panel: forwarded to the engine at once
  /** Memory panel: direct write of one byte. The engine reports nothing for it, so the controller
   *  bumps `liveRevision` itself; the Hardware, Memory and Stack panels redraw on that, the Stack
   *  panel without re-centring (sim-ui §10.3, §11.4). Interface code that writes memory with
   *  `invoke((engine) => engine.writeBytes(...))` bumps `liveRevision` itself. */
  pokeMemory(address: number, value: number): void;
  clearCycles(): void; // engine.clearCycles(), then the snapshot is refreshed (4.8)
}

export type ControllerRequest =
  | { kind: 'irq'; level: number }
  | { kind: 'hwReset' }
  | { kind: 'timerTick'; level: number }
  | { kind: 'autoTraceTick' }
  | { kind: 'pushButton'; bit: number; down: boolean }
  | { kind: 'switchClick'; bit: number }
  | { kind: 'fileDialogReply'; accepted: boolean; path: Bytes | null }
  | { kind: 'call'; fn: (engine: SimEngine) => void }; // any other engine call a host part needs

export interface SimSession {
  // one per window; created by features/run/session.ts
  /** The current engine instance. A cold start replaces it: always read the property, never keep it.
   *  Until the first engine exists, and between two engines, it is a stand-in that reads as a
   *  simulator in start-up state and ignores commands; `controller.phase` is 'loading' meanwhile. */
  readonly engine: SimEngine;
  readonly host: SimHost; // one object for the life of the window, given to every instance
  readonly controller: RunController;
  readonly surface: SurfaceApi;
  readonly text: TextScreenApi;
  readonly keyboard: OutputKeyboardApi;
  readonly sound: SoundDeviceApi;
  readonly hardware: HardwareModelApi;
  readonly listing: ListingViewApi;
  readonly log: LogServiceApi;
  readonly files: ProgramFilesApi;
  readonly printer: PrinterDeviceApi;
  readonly glyphs: GlyphProvider;
  /** Fires after a cold start has replaced the engine and reset every part. */
  onEngineReplaced(listener: () => void): () => void;

  /* ---- added at gate I1 (docs/porting/errata/W1.md, entry 11). Optional in this round: the real
     session (features/run, SH8) has both; a stand-in session may leave them out. ---- */

  /** The print jobs of TRAP #15 task 10 that have finished (PrinterDeps.submit), oldest first, for
   *  the Printer Output dialog (features/sim-files, SH6). */
  readonly printJobs?: readonly PrintJob[];
  /** Fires when a print job has finished. Returns the unsubscribe function. */
  onPrintJob?(listener: (job: PrintJob) => void): () => void;
}
