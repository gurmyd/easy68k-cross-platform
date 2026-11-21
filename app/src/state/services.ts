// What the bootstrap hands to the features that provide services (ARCHITECTURE.md 3.12.3).
// Owner: W3.
//
// Four services of the AppContext are created by features, each through a factory with a fixed
// name that its `index.ts` exports. The bootstrap calls them in the order of 3.12.3; a factory may
// keep `ctx` but must not use a service that comes later in that order while it is being called.
//
// Feature code may not import app/src/engine or app/src/fs (3.1). The simulator session needs two
// things from there, so the bootstrap passes them in as `SimSessionEnv`.

import type {
  AppContext,
  AudioBackend,
  CachedSyncFilesDeps,
  DocumentService,
  FileDialogs,
  SimEngine,
  SimHost,
  SimSession,
  SyncFiles,
} from '../contracts';

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
}
