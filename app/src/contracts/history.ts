// Contract: the safety net of earlier versions and a Trash (ARCHITECTURE-PLUS P3.3, P4.4).
// Implemented by app/src/fs/history-db.ts (N3); used through AppContext.history.
//
// Owner: N0 (the stage of additions). Contracts import nothing but other contracts (3.1).

import type { Bytes } from './engine';
import type { VPath } from './fs';

export type VersionReason =
  'saved' | 'opened' | 'before-import' | 'before-restore' | 'before-replace' | 'before-delete';
export interface VersionInfo {
  seq: number;
  time: number;
  size: number;
  reason: VersionReason;
}
export interface TrashItemInfo {
  id: string;
  deletedAt: number;
  cause: 'deleted' | 'replaced';
  path: VPath;
  kind: 'file' | 'dir';
  files: number;
  /** Counted bytes in the Trash half: its records and their copies (P3.3.4). */
  bytes: number;
  /** False when its store is not mounted now (P3.3.8). */
  restorableInPlace: boolean;
}
/** `versions`, `versionBytes`: the versions half; `trashItems`, `trashBytes`: the Trash half (P3.3.4). */
export interface HistoryUsage {
  versions: number;
  versionBytes: number;
  trashItems: number;
  trashBytes: number;
  budget: number;
}
/** A file as guard read it in phase 1 (P3.3.4). */
export interface SeenFile {
  path: VPath;
  mtime: number;
  size: number;
}
/** 'off': the `history` switch is off. 'tight': storage is nearly full. In 'off', 'tight' and
 *  'unavailable' nothing new is kept (P3.3.4). */
export type HistoryState = 'ready' | 'off' | 'tight' | 'unavailable';

export interface HistoryService {
  state(): HistoryState;
  /** Why `path` gets no automatic versions, or null when it does (P3.3.3). 'git': below a folder
   *  named .git, any letter case; 'memory': in /memory. */
  untracked(path: VPath, size: number, head: Bytes): 'generated' | 'too-large' | 'not-text' | 'git' | 'memory' | null;
  /** Keeps an automatic version (P3.3.3) unless it equals the newest; `time` is when the bytes were
   *  written or read (the version's time). Never throws; never awaited by a save or an import;
   *  queued (at most 16 MB waiting, P3.3.5). */
  record(path: VPath, data: Bytes, reason: 'saved' | 'opened' | 'before-import', time: number): Promise<void>;
  /** The only way a command of this stage removes or overwrites a current file (P3.3.4): reads the
   *  current files of `path` (for 'delete' a file or a folder) as `seen`, keeps a copy of their
   *  bytes, for 'delete' and 'replace' puts their records into the Trash as one item, then calls
   *  `act(seen)`, which touches only files of `seen` that are unchanged. When no copy can be kept,
   *  calls `act` only if `confirm()` resolves true; then, for 'delete' and 'replace' only, drops the
   *  records of the files of `seen` (P3.3.4 step 3); for 'restore' no record changes. After `act`,
   *  records of files it did not remove or overwrite go back to living, and a rejection is passed
   *  on. Rejects without calling `act` for a path below .git. `item`: the Trash item, for 'kept'
   *  with 'delete' or 'replace' when `seen` is not empty. */
  guard(
    path: VPath,
    how: 'delete' | 'replace' | 'restore',
    act: (seen: readonly SeenFile[]) => Promise<void>,
    confirm: () => Promise<boolean>,
  ): Promise<{ outcome: 'kept' | 'not-kept' | 'declined'; item?: string }>;
  versions(path: VPath): Promise<VersionInfo[]>; // newest first
  read(path: VPath, seq: number): Promise<Bytes>;
  trashItems(): Promise<TrashItemInfo[]>; // newest first
  /** Writes a Trash item back through the Vfs (P3.3.8). Reads the item and its bytes once; `gone`
   *  when it is no longer in the Trash then, and nothing is written. For each file, in the order of
   *  P3.3.4: before(), ask() when the place is taken ('replace' writes through guard(..., 'replace',
   *  ..., () => confirm(path))), the write, the record back to living, after(). 'cancel', a skip, a
   *  No or a failed write leave the files not yet written in the Trash; a failed write ends the
   *  restore with its message in `error`. `left`: files not written whose records are still in the
   *  item when the restore ends; `lost`: files not written whose records are no longer there. The
   *  item's empty folders are created with its last file. */
  restoreTrash(
    id: string,
    options: {
      ask(path: VPath): Promise<'replace' | 'beside' | 'cancel'>;
      /** Asked when the item's store is not mounted; the folder to restore into, or null. */
      fallback(item: TrashItemInfo): Promise<VPath | null>;
      /** The question of P3.3.4 when no copy of a file to be replaced can be kept. */
      confirm(path: VPath): Promise<boolean>;
      /** Asked before each write; 'skip' leaves the file out (an open, modified document). */
      before?(path: VPath): Promise<'write' | 'skip'>;
      /** Called after each write (the caller reloads an open, unmodified document). */
      after?(path: VPath): Promise<void>;
    },
  ): Promise<{ restored: VPath[]; left: VPath[]; lost: VPath[]; gone: boolean; error?: string }>;
  /** Deletes the items, their records and versions (P3.3.5). */
  dropTrash(ids: readonly string[]): Promise<void>;
  /** A file, or a folder moved without a merge, of the history moved (Files panel rename or move,
   *  P3.2.4, P3.3.5). */
  moved(from: VPath, to: VPath): Promise<void>;
  /** Deletes every version of the versions half (`Delete Earlier Versions`, P3.3.5). */
  clearVersions(): Promise<void>;
  deleteAll(): Promise<void>; // deletes the database
  usage(): Promise<HistoryUsage>;
  subscribe(listener: () => void): () => void; // any change, from this window or another
}
