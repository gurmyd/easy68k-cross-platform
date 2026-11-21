// Contract: the file system (ARCHITECTURE.md 3.8). Backends (3.8.1), the Vfs that mounts them,
// the synchronous SyncFiles views of the simulator (3.8.4) and the file dialogs (3.8.5).
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { Scheduler } from './devices';
import type { Bytes } from './engine';

/** Absolute virtual path: "/<mount>/<segment>/..."; '/' separators; letter case as stored. */
export type VPath = string;

export interface FileStat {
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
  readOnly: boolean;
}
export interface DirEntry {
  name: string;
  kind: 'file' | 'dir';
}
export interface BackendChange {
  rel: string;
  kind: 'write' | 'remove';
}

export interface FileSystemBackend {
  readonly mount: string; // "browser", "folder", "linked", "disk", "memory"
  readonly kind: 'browser' | 'fsaccess' | 'disk' | 'memory';
  readonly label: string; // shown in dialogs, e.g. "My Programs"
  stat(rel: string): Promise<FileStat | null>; // rel: path inside the mount, no leading '/'
  readFile(rel: string): Promise<Bytes>;
  writeFile(rel: string, data: Bytes): Promise<void>; // creates parent directories; replaces the file
  /** Adds bytes at the end (creating the file). Cost must depend on data.length, not on the file size. */
  appendFile(rel: string, data: Bytes): Promise<void>;
  remove(rel: string): Promise<void>;
  list(rel: string): Promise<DirEntry[]>;
  mkdirp(rel: string): Promise<void>;
  /** Changes made by someone else (another window, 3.8.6). Absent when the backend cannot know. */
  onExternalChange?(listener: (change: BackendChange) => void): () => void;
}

/**
 * Why a file operation failed. Backends and the Vfs reject with an Error that carries one of these
 * in `code` (fs/vfs.ts: `fsError()`, `isFsError()`); fs/backend-contract.ts checks the codes.
 * Addition of W1 (docs/porting/errata/W1.md): section 3 names no error convention.
 */
export type FsErrorCode =
  | 'not-found' // no such file or directory (also: unknown mount)
  | 'is-directory' // a file operation on a directory
  | 'not-directory' // a directory operation on a file, or a file where a parent directory should be
  | 'read-only' // the file or the backend refuses writing
  | 'invalid-path' // not a VPath, or a name the backend cannot store
  | 'io'; // anything else (quota, permission withdrawn, device error)
export interface FsError extends Error {
  readonly code: FsErrorCode;
}

export interface SnapshotLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
}
export interface DirSnapshot {
  root: VPath;
  files: Map<string, { data: Bytes; mtime: number }>; // key: path relative to root
  skipped: { path: string; reason: 'too-large' | 'too-many' | 'too-deep' | 'unreadable' }[];
}
export interface VfsChange {
  path: VPath;
  kind: 'write' | 'remove';
  origin: 'local' | 'external';
}

/**
 * One implementation only: `createVfs()` of app/src/fs/vfs.ts, which the bootstrap and every test
 * call (a test mounts a MemoryBackend on it). Nothing else implements this interface; code that
 * needs a few members takes `Pick<Vfs, ...>`. That is why a member added later, such as `mkdirp`,
 * can be required (docs/porting/errata/W1.md, entry 12; contracts.test.ts checks it).
 */
export interface Vfs {
  mount(backend: FileSystemBackend): void;
  unmount(mount: string): void;
  backends(): FileSystemBackend[];
  stat(path: VPath): Promise<FileStat | null>;
  readFile(path: VPath): Promise<Bytes>;
  /** writeFile, appendFile and remove on one path run one at a time, in call order. */
  writeFile(path: VPath, data: Bytes): Promise<void>;
  appendFile(path: VPath, data: Bytes): Promise<void>;
  remove(path: VPath): Promise<void>;
  /** Creates the folder and the folders above it; does nothing for a folder that exists. Runs in
   *  the queue of its path like the three above and is reported as a 'write' of the folder.
   *  Added at gate I1 (docs/porting/errata/W1.md, entry 11). */
  mkdirp(path: VPath): Promise<void>;
  list(path: VPath): Promise<DirEntry[]>;
  /** Windows-style lookup of `name` relative to `dir`: '\' and '/' separate, case is ignored when no
   *  exact match exists, ".." is allowed while it stays inside the mount. null = not found or refused. */
  resolve(dir: VPath, name: string): Promise<VPath | null>;
  snapshot(dir: VPath, limits: SnapshotLimits): Promise<DirSnapshot>;
  /** Every change below `prefix`: made through this Vfs ('local') or reported by a backend ('external'). */
  subscribe(prefix: VPath, listener: (change: VfsChange) => void): () => void;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 2000,
  maxFileBytes: 32 << 20,
  maxTotalBytes: 256 << 20,
  maxDepth: 4,
};

/** Synchronous access to files, for the simulator's host file calls (3.8.4). */
export interface SyncFiles {
  /** Makes the tree below `dir` available. A cached view loads it; a direct view checks access only. */
  prepare(dir: VPath): Promise<void>;
  /** Brings a cached view up to date with storage; a no-op for views that are always current. */
  revalidate(): Promise<void>;
  /** Windows-style lookup as Vfs.resolve, but for a file that need not exist yet.
   *  null = the name is malformed or leaves what the view may reach. */
  resolve(dir: VPath, name: string): VPath | null;
  stat(path: VPath): { size: number; readOnly: boolean } | null; // null = no such file
  read(path: VPath, position: number, count: number): Bytes | null; // short at end of file; null on error
  write(path: VPath, position: number, data: Bytes): boolean; // a gap before position reads as zero bytes
  create(path: VPath): boolean; // new empty file, or truncate
  remove(path: VPath): boolean;
  /** Resolves when every change made through this view is in storage. A cached view starts its
   *  pending writes at once when this is called; it does not wait for the write-behind timer (the
   *  run controller calls it when a program stops, 4.2). */
  settled(): Promise<void>;
  readonly unsettled: boolean; // for the unload guard
}

/**
 * Constructor argument of CachedSyncFiles (app/src/fs/sync/cached.ts, W1 > SH6), the cached view of
 * the /browser, /linked and /folder mounts (3.8.4). Section 3 gives the class but not its
 * constructor; W1 fixed it (docs/porting/errata/W1.md).
 */
export interface CachedSyncFilesDeps {
  vfs: Vfs;
  /** The write-behind timer of 3.8.4 (at most every 500 ms per file). */
  scheduler: Scheduler;
  /** For "Not available to the program: <path> (<reason>)" in the simulator message area. */
  message: (text: string) => void;
  /** Defaults to DEFAULT_SNAPSHOT_LIMITS. */
  limits?: SnapshotLimits;
}

/* ------------------------------------------------------------------ file dialogs (3.8.5) */
// FS1 implements these in features/files/dialogs.ts and features/files/providers.ts. They are
// declared here because AppContext.fileDialogs (3.12.3) needs the type and contracts import nothing
// from features (docs/porting/errata/W1.md).

export interface FileFilter {
  label: string;
  patterns: string[];
} // e.g. ["*.X68"]
export interface OpenRequest {
  title: string;
  filters: FileFilter[];
  multiple: boolean;
  startDir?: VPath;
}
/** A caller's own question for a file that exists already (SaveRequest.overwritePrompt). */
export interface OverwritePrompt {
  title: string; // e.g. "Alert"
  text: string; // e.g. "File exists! OK to replace?"; asked with Yes and No
}
export interface SaveRequest {
  title: string;
  filters: FileFilter[];
  /** The extension a typed name without one receives. The dialog accepts "X68", ".X68" and the
   *  original's "*.X68" alike. */
  defaultExt: string;
  suggested?: VPath;
  /**
   * The question asked when the chosen file exists. Absent: the dialog's own, the editor's
   * `File exists! OK to overwrite?` (title `Caution!`). An object: this question instead (the
   * Memory panel's `File exists! OK to replace?`, title `Alert`). null: the dialog asks nothing,
   * because the caller asks afterwards itself (EASyBIN). A native dialog that asks on its own
   * (macOS) cannot be told otherwise; the port then adds no question of its own.
   * Added at gate I1 (docs/porting/errata/W1.md, entry 11).
   */
  overwritePrompt?: OverwritePrompt | null;
}
/** A request for a folder (FileDialogs.chooseFolder). Added at gate I1. */
export interface FolderRequest {
  title: string;
  startDir?: VPath;
}
export interface FileSourceProvider {
  id: string; // "browser", "folder", "upload", "native"
  label: string; // button or list caption
  available(): boolean;
  open?(request: OpenRequest): Promise<VPath[] | null>;
  save?(request: SaveRequest): Promise<VPath | null>;
  /** Added at gate I1: the provider's own folder chooser (the `native` provider of the desktop app,
   *  from Platform.nativeFileDialogs). */
  chooseFolder?(request: FolderRequest): Promise<VPath | null>;
}
export interface FileDialogs {
  open(request: OpenRequest): Promise<VPath[] | null>; // null = cancelled
  save(request: SaveRequest): Promise<VPath | null>; // overwrite already confirmed (SaveRequest.overwritePrompt)
  registerProvider(provider: FileSourceProvider): () => void;
  /**
   * Asks for a folder, which may be a new one (Help > Examples in the desktop app, 5.8). Resolves
   * to the folder's path, created if it did not exist, or null when cancelled.
   * Added at gate I1 as an optional member (docs/porting/errata/W1.md, entry 11): a caller tests
   * for it, and FS1's service has it.
   */
  chooseFolder?(request: FolderRequest): Promise<VPath | null>;
}
