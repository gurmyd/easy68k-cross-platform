// Contract: feature modules, the application context and dialogs (ARCHITECTURE.md 3.12.3, 3.12.4).
// Implemented by W3 (bootstrap, features/index.ts, the dialog host) and the feature packages.
//
// Owner: W1. Contracts import nothing but other contracts (3.1). The two outside types this file
// needs are therefore reached without an import:
//   - React.ComponentType through the global `React` namespace that @types/react declares (the
//     reference directive below loads it; it is a type-only reference, not an import);
//   - CodeMirror's Extension as `Extension` below, a structural copy of @codemirror/state's type,
//     so that values of either type are assignable to the other.

/// <reference types="react" />

import type { CommandHandler, CommandId, CommandRegistry } from './commands';
import type { AudioBackend, Clock, Scheduler } from './devices';
import type { DocumentService, DocumentState } from './documents';
import type { AsmEngine, Bytes, SimEngine } from './engine';
import type { CachedSyncFilesDeps, FileDialogs, SyncFiles, Vfs, VPath } from './fs';
import type { HistoryService } from './history';
import type { SimHost } from './host';
import type { Platform } from './platform';
import type { SimSession } from './run';
import type { SettingsService } from './settings';
import type { AppState, Mode, Store } from './store';

/** @codemirror/state's `Extension`, structurally: `{ extension: Extension } | readonly Extension[]`. */
export type Extension = { extension: Extension } | readonly Extension[];

/**
 * What the build tells about the port, from app/src/build-info.ts (7.5; 10.2 O-14: nothing about
 * the repository is hard-coded). Features may not import that file (3.1); they read
 * `AppContext.build`. Added at gate I1 (docs/porting/errata/W1.md, entry 11).
 */
export interface BuildFacts {
  /** Semantic version of the port (root package.json). */
  readonly version: string;
  /** GitHub repository as "owner/name", or null when it is not known. */
  readonly repository: string | null;
}

export interface AppContext {
  store: Store<AppState>;
  commands: CommandRegistry;
  settings: SettingsService;
  dialogs: DialogService;
  platform: Platform;
  vfs: Vfs;
  fileDialogs: FileDialogs;
  documents: DocumentService;
  asm: AsmEngine;
  /** Devices that exist only in a browser; the simulator session takes them from here (3.3.1). */
  devices: { audio: AudioBackend };
  sim: SimSession;
  clock: Clock;
  scheduler: Scheduler;
  /** Editor extensions contributed by other features (highlighting, markers). The editor component
   *  applies every registered source to every document view. Extension is @codemirror/state's type. */
  editorExtensions: { register(source: (doc: DocumentState) => Extension): () => void };
  /** The port's version and repository, for the About boxes and the update check (1.4 note 11).
   *  Added at gate I1 as an optional member; required since gate I2 (errata W1.md entry 14.5):
   *  the bootstrap and createTestApplication fill it. */
  readonly build: BuildFacts;
  /** ARCHITECTURE-PLUS P3.3. Absent in tests that do not need it. */
  readonly history?: HistoryService;
  /** ARCHITECTURE-PLUS P3.4. Absent in tests that do not need it. */
  readonly viewer?: ViewerService;
}

/** The viewer of files that are not text (ARCHITECTURE-PLUS P3.4, P4.4); AppContext.viewer. */
export interface ViewerService {
  /** True when `path` with these bytes is to be shown by the viewer: the `viewer` switch is on, the
   *  table of P3.4.1 says so, and `dockOf(ctx).acceptsTransient()` is true. */
  wants(path: VPath, bytes: Bytes): boolean;
  /** Opens or selects the viewer of `path`; reaches the dock only through state/dock.ts, and only
   *  when called, never while the factory runs. */
  show(path: VPath, bytes: Bytes): void;
}
export interface PanelSpec {
  id: string;
  title: string;
  mode: Mode;
  component: React.ComponentType;
}
export interface FeatureModule {
  id: string;
  commands?: Record<CommandId, CommandHandler>;
  panels?: PanelSpec[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a module lists dialogs of every props/result type (3.12.3)
  dialogs?: Record<string, React.ComponentType<DialogProps<any, any>>>;
  /** Called once after every service exists. May return a dispose function. */
  init?(ctx: AppContext): void | (() => void);
}

/* ------------------------------------------------------------------ service factories (3.12.3) */
// Four services of the AppContext are created by features, each through a factory with a fixed
// name that its `index.ts` exports. The bootstrap calls them in the order of 3.12.3; a factory may
// keep `ctx` but must not use a service that comes later in that order while it is being called.
// Feature code may not import app/src/engine or app/src/fs (3.1). The simulator session needs two
// things from there, so the bootstrap passes them in as `SimSessionEnv` (errata W3.md, entry 10).
// Moved here from app/src/state/services.ts (W3), which re-exports them.

/** The two functions of app/src/engine/index.ts for the simulator (3.2). */
export interface SimEngineFactory {
  /** A new simulator in start-up state. The host receives calls while this runs (3.3.2). */
  create(host: SimHost): Promise<SimEngine>;
  /** Drops the binding's references to an instance; it must not be used afterwards. */
  release(engine: SimEngine): void;
}

/** What the simulator session cannot import itself. */
export interface SimSessionEnv {
  engines: SimEngineFactory;
  /**
   * A cached synchronous view of the browser store, an opened folder or linked files, for
   * `ProgramFilesDeps.viewFor` (3.8.4; `CachedSyncFiles` of app/src/fs/sync/cached.ts). The disk of
   * the desktop app needs none: its view is `ctx.platform.syncFiles`.
   */
  createCachedSyncFiles(deps: CachedSyncFilesDeps): SyncFiles;
}

/** The factories of the service-providing features, by their fixed names. */
export interface ServiceFactories {
  /** features/files (owner FS1) */
  createFileDialogs(ctx: AppContext): FileDialogs;
  /** features/documents (owner E1) */
  createDocumentService(ctx: AppContext): DocumentService;
  /** features/audio (owner SH5) */
  createAudioBackend(ctx: AppContext): AudioBackend;
  /** features/run (owner SH8) */
  createSimSession(ctx: AppContext, env: SimSessionEnv): SimSession;
  /** fs/history-db.ts (N3), ARCHITECTURE-PLUS P4.4 */
  createHistoryService?(ctx: AppContext): HistoryService;
  /** features/viewer (N6), ARCHITECTURE-PLUS P4.4 */
  createViewerService?(ctx: AppContext): ViewerService;
}

/* ------------------------------------------------------------------ dialogs (3.12.4) */

export interface DialogProps<P, R> {
  props: P;
  close(result: R): void;
}
export interface DialogInstance {
  key: number;
  id: string;
  props: unknown;
  modal: boolean;
}
export interface MessageBoxRequest {
  title: string;
  text: string;
  icon: 'none' | 'information' | 'confirmation' | 'warning' | 'error';
  buttons: ('OK' | 'Cancel' | 'Yes' | 'No' | 'Replace' | 'Append')[];
}
/** Options of DialogService.toast. Added at gate I1 (docs/porting/errata/W1.md, entry 11). */
export interface ToastOptions {
  /** How long the toast stays, in milliseconds. 0 = until it is dismissed or its action is used.
   *  Absent = the component kit's default (8 s, longer while it has the pointer or the focus). */
  duration?: number;
}
export interface DialogService {
  /** holdsProgram: hold the run controller while the dialog is open (4.4.5). Default: true for a
   *  modal dialog opened while the mode is 'simulator', false otherwise. */
  open<P, R>(id: string, props: P, options?: { modal?: boolean; holdsProgram?: boolean }): Promise<R>;
  messageBox(request: MessageBoxRequest, options?: { holdsProgram?: boolean }): Promise<string>; // resolves to the button caption
  toast(text: string, action?: { label: string; run(): void }, options?: ToastOptions): void;
  isModalOpen(): boolean;
}

/* ------------------------------------------------------------------ dialogs one package opens for another (2.7) */
// The simulator session (SH8) opens two dialogs that other packages draw, because the callbacks
// that need them (ProgramFilesDeps.showFileDialog, LogDeps.askFileExists) are the session's to
// supply and a feature may not import another feature. Both sides compile against these props and
// results. Added at gate I1 (docs/porting/errata/W1.md, entry 11). A dialog id that nobody has
// registered counts as Cancel.

/** Props of the dialog `sim.fileDialog` (features/sim-files, SH6): TRAP #15 task 58. */
export interface SimFileDialogProps {
  /** 0 = Open, 1 = Save (trap15-a task 58). */
  mode: number;
  title: string;
  /** The program's filter string, "description|pattern|...". */
  filter: string;
  initialName: string;
}
/** Result of `sim.fileDialog`: the chosen file, or null for Cancel. */
export type SimFileDialogResult = VPath | null;

/** Props of the dialog `sim.logFileExists` (features/log, U4): a log file exists already (sim-ui §13). */
export interface LogFileExistsProps {
  kind: 'exec' | 'output';
  fileName: string;
}
/** Result of `sim.logFileExists`. */
export type LogFileExistsResult = 'Replace' | 'Append' | 'Cancel';
