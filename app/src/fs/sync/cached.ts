// The cached SyncFiles view of the /browser, /linked and /folder mounts (ARCHITECTURE.md 3.8.4):
// prepare(dir) loads the tree into memory, calls act on the copy, changes are written through to
// the Vfs with the write-behind helper.
//
//     const view = new CachedSyncFiles({ vfs, scheduler, message });
//     await view.prepare('/browser/demo');              // loads /browser/demo and its sub-folders
//     const path = view.resolve('/browser/demo', 'DATA.TXT');   // '/browser/demo/data.txt'
//     view.write(path, 0, bytes);                       // in memory now, in storage within 500 ms
//     await view.settled();                             // everything is in storage
//
// What the view may reach: the folders it was asked to prepare and everything below them, each
// down to `limits.maxDepth` levels. A name that leaves them does not resolve (the program gets the
// result of a missing file). Files beyond the limits are not loaded; each is named once in the
// message area as `Not available to the program: <path> (<reason>)` (from a timer, so that the
// load that prepared the folder does not clear it) and cannot be opened, created or removed. A file can be created only in a folder that exists, as fopen() on Windows.
//
// How the copy stays current:
// - Every prepared folder is subscribed to (`vfs.subscribe`). A change made by someone else - a
//   save in the editor, an import in the Files panel, a change in another window (3.8.6) - is read
//   at once and replaces the cached bytes. The view's own writes are recognised and ignored.
// - revalidate() lists the prepared trees again and re-reads every file whose size, modification
//   time or read-only flag changed: for the opened folder, which reports no changes.
//
// How changes reach storage: a changed file is written at most every 500 ms while it keeps
// changing (WriteBehind, one write in flight per file), and at once when settled() is called (the
// program closed a file, execution stopped, the page closes). A change that only adds bytes at the
// end of a file that storage already has is sent as an append, so a long data file costs what was
// added, not its whole size. A write that fails is reported once in the message area and kept: the
// next settled() tries again.
//
// Owner: W1 > SH6.

import {
  DEFAULT_SNAPSHOT_LIMITS,
  type Bytes,
  type CachedSyncFilesDeps,
  type DirEntry,
  type SnapshotLimits,
  type SyncFiles,
  type VfsChange,
  type VPath,
} from '../../contracts';
import { basename, dirname, foldCase, isVPath, matchName, resolveLexically } from '../../core/paths/winpath';
import { fsError } from '../vfs';
import { WriteBehind } from '../write-behind';

export type { CachedSyncFilesDeps } from '../../contracts';

/** The write-behind interval of 3.8.4: a file that keeps changing is written at most this often. */
export const WRITE_BEHIND_MS = 500;

/** Why a file of a prepared folder is not in memory (DirSnapshot's reasons). */
export type UnavailableReason = 'too-large' | 'too-many' | 'too-deep' | 'unreadable';

/** The words of the message `Not available to the program: <path> (<reason>)`. */
export const UNAVAILABLE_REASON_TEXT: Record<UnavailableReason, string> = {
  'too-large': 'too large',
  'too-many': 'too many files',
  'too-deep': 'too deep',
  unreadable: 'unreadable',
};

/** The message for a file or folder beyond the limits (3.8.4). */
export function unavailableMessage(path: VPath, reason: UnavailableReason): string {
  return `Not available to the program: ${path} (${UNAVAILABLE_REASON_TEXT[reason]})`;
}

/** The message for a change the view could not write to storage. */
export function notSavedMessage(path: VPath, error: unknown): string {
  const reason = error instanceof Error && error.message ? error.message : String(error);
  return `A file of the program could not be saved: ${path} (${reason})`;
}

interface CachedFile {
  /** The file's bytes are buf[0, size). buf grows by doubling, so appending is cheap. */
  buf: Uint8Array;
  size: number;
  readOnly: boolean;
  /** Modification time in storage when the bytes were last read or written; NaN = unknown. */
  mtime: number;
  /** Bytes storage holds as far as this view knows, or null when storage has no such file. */
  storedSize: number | null;
  /** Changed since the last write started. */
  dirty: boolean;
  /** Lowest offset changed since the last write started (Infinity: none). */
  dirtyFrom: number;
  /** Counts the changes made through the view: a read from storage that started before a change
   *  must not replace the changed bytes. */
  generation: number;
}

/** What one write to storage does; decided when the write starts (WriteBehind's getter). */
type StorageOp =
  | { kind: 'none' }
  | { kind: 'remove' }
  | { kind: 'write'; data: Bytes; file: CachedFile }
  | { kind: 'append'; data: Bytes; size: number; file: CachedFile };

interface Root {
  path: VPath;
  unsubscribe: () => void;
}

/** One file found while a tree is listed. */
interface Found {
  path: VPath;
  size: number;
  mtime: number;
  readOnly: boolean;
}

const EMPTY = new Uint8Array(0);

export class CachedSyncFiles implements SyncFiles {
  private readonly deps: CachedSyncFilesDeps;
  private readonly limits: SnapshotLimits;
  private readonly roots: Root[] = [];
  /** Files in memory, by their stored spelling. */
  private readonly files = new Map<VPath, CachedFile>();
  /** foldCase(path) -> stored path, for files and folders. */
  private readonly fileByFold = new Map<string, VPath>();
  private readonly dirByFold = new Map<string, VPath>();
  /** Names in each known folder (stored spelling), for resolve(). */
  private readonly children = new Map<VPath, Set<string>>();
  /** Files and folders beyond the limits, by foldCase(path). */
  private readonly unavailable = new Map<string, UnavailableReason>();
  private readonly reported = new Set<string>();
  /** Paths whose change (or removal) has not been handed to storage yet. */
  private readonly dirtyPaths = new Set<VPath>();
  /** Paths removed through the view that storage still has. */
  private readonly removals = new Set<VPath>();
  private readonly timers = new Map<VPath, () => void>();
  /** The op of the write in flight per path (WriteBehind runs one at a time per path). */
  private readonly taken = new Map<VPath, StorageOp>();
  /** foldCase(path) -> changes the Vfs will report for this view's own writes. */
  private readonly ownChanges = new Map<string, number>();
  private readonly failed = new Set<VPath>();
  /** Reads of changes reported by others: per path one in flight and at most one more. */
  private readonly refreshing = new Map<VPath, { again: VfsChange | null }>();
  private readonly refreshes = new Set<Promise<void>>();
  private readonly behind: WriteBehind;

  constructor(deps: CachedSyncFilesDeps) {
    this.deps = deps;
    this.limits = deps.limits ?? DEFAULT_SNAPSHOT_LIMITS;
    this.behind = new WriteBehind(
      (path) => this.store(path),
      (path, error) => this.storeFailed(path, error),
    );
  }

  // ==================================================================== SyncFiles

  get unsettled(): boolean {
    return this.dirtyPaths.size > 0 || this.behind.busy;
  }

  async prepare(dir: VPath): Promise<void> {
    if (!isVPath(dir)) throw fsError('invalid-path', `not a virtual path: "${dir}"`);
    const covering = this.rootOf(dir);
    if (covering && this.dirByFold.has(foldCase(dir))) return; // loaded and kept current already
    const stat = await this.deps.vfs.stat(dir);
    if (!stat) throw fsError('not-found', `no such folder: ${dir}`);
    if (stat.kind !== 'dir') throw fsError('not-directory', `not a folder: ${dir}`);
    if (covering) {
      // A folder below a prepared one that this view did not know yet: load it into the same root.
      await this.loadTree(dir, this.depthBelow(covering.path, dir));
      return;
    }
    // Subscribe first, so that nothing changed while the tree loads is missed.
    const root: Root = { path: dir, unsubscribe: this.deps.vfs.subscribe(dir, (change) => this.changed(change)) };
    this.roots.push(root);
    await this.loadTree(dir, 0);
    // Prepared folders below the new one are part of it now.
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const other = this.roots[i] as Root;
      if (other !== root && isBelowFold(other.path, dir)) {
        other.unsubscribe();
        this.roots.splice(i, 1);
      }
    }
  }

  async revalidate(): Promise<void> {
    for (const root of [...this.roots]) {
      const listed = await this.listTree(root.path, 0);
      const seen = new Set<VPath>();
      for (const dir of listed.dirs) this.addDir(dir);
      for (const found of listed.files) {
        seen.add(found.path);
        const cached = this.lookupFile(found.path);
        if (cached && this.files.get(cached)?.dirty) continue; // the program's change wins
        const file = cached ? this.files.get(cached) : undefined;
        if (file && file.size === found.size && file.mtime === found.mtime && file.readOnly === found.readOnly)
          continue;
        if (cached && this.behind.isPending(cached)) continue; // our own write is landing
        await this.reload(found);
      }
      for (const { path, reason } of listed.skipped) this.markUnavailable(path, reason);
      // Files that are gone from storage (and not changed by the program meanwhile).
      for (const path of [...this.files.keys()]) {
        if (!isBelowFold(path, root.path) || seen.has(path)) continue;
        const file = this.files.get(path) as CachedFile;
        if (file.dirty || this.behind.isPending(path) || file.storedSize === null) continue;
        this.dropFile(path);
      }
    }
  }

  resolve(dir: VPath, name: string): VPath | null {
    if (typeof dir !== 'string' || typeof name !== 'string' || !isVPath(dir)) return null;
    const lexical = resolveLexically(dir, name);
    if (lexical === null) return null;
    const root = this.rootOf(lexical);
    if (!root) return null;
    // Below the root, take the stored spelling of every segment that exists; keep the rest as given.
    const rest = lexical.length > root.path.length ? lexical.slice(root.path.length + 1) : '';
    let path: VPath = root.path;
    for (const segment of rest === '' ? [] : rest.split('/')) {
      const match = matchName(this.children.get(path) ?? [], segment);
      path = `${path}/${match ?? segment}`;
    }
    return path;
  }

  stat(path: VPath): { size: number; readOnly: boolean } | null {
    const file = this.fileAt(path);
    return file ? { size: file.size, readOnly: file.readOnly } : null;
  }

  read(path: VPath, position: number, count: number): Bytes | null {
    const file = this.fileAt(path);
    if (!file || !isCount(position) || !isCount(count)) return null;
    const start = Math.min(position, file.size);
    return file.buf.slice(start, Math.min(start + count, file.size));
  }

  write(path: VPath, position: number, data: Bytes): boolean {
    const file = this.fileAt(path);
    if (!file || file.readOnly || !isCount(position) || !(data instanceof Uint8Array)) return false;
    const end = position + data.length;
    const from = Math.min(position, file.size); // a gap before position becomes zero bytes
    if (end > file.buf.length) {
      const grown = new Uint8Array(Math.max(end, file.buf.length * 2, 64));
      grown.set(file.buf.subarray(0, file.size));
      file.buf = grown;
    } else if (position > file.size) {
      file.buf.fill(0, file.size, position); // bytes left over from before a truncation
    }
    file.buf.set(data, position);
    file.size = Math.max(file.size, end);
    this.touched(this.lookupFile(path) as VPath, file, from);
    return true;
  }

  create(path: VPath): boolean {
    if (typeof path !== 'string' || !isVPath(path) || !this.rootOf(path)) return false;
    if (this.unavailable.has(foldCase(path)) || this.dirByFold.has(foldCase(path))) return false;
    const stored = this.lookupFile(path);
    if (stored) {
      const file = this.files.get(stored) as CachedFile;
      if (file.readOnly) return false;
      file.size = 0;
      this.touched(stored, file, 0);
      return true;
    }
    const parent = this.dirByFold.get(foldCase(dirname(path)));
    if (!parent) return false; // fopen() does not create folders
    const created: VPath = `${parent}/${basename(path)}`;
    const file: CachedFile = {
      buf: EMPTY,
      size: 0,
      readOnly: false,
      mtime: Number.NaN,
      storedSize: null,
      dirty: false,
      dirtyFrom: Infinity,
      generation: 0,
    };
    this.putFile(created, file);
    // A removal of the same name that has not reached storage yet: the write below replaces it.
    this.removals.delete(created);
    this.touched(created, file, 0);
    return true;
  }

  remove(path: VPath): boolean {
    const stored = typeof path === 'string' ? this.lookupFile(path) : null;
    if (!stored) return false;
    const file = this.files.get(stored) as CachedFile;
    if (file.readOnly) return false;
    this.dropFile(stored);
    if (file.storedSize !== null || this.behind.isPending(stored)) {
      this.removals.add(stored);
      this.dirtyPaths.add(stored);
      this.arm(stored);
    } else {
      this.dirtyPaths.delete(stored);
      this.disarm(stored);
    }
    return true;
  }

  async settled(): Promise<void> {
    for (const path of [...this.dirtyPaths]) {
      this.disarm(path);
      this.behind.schedule(path, () => this.take(path));
    }
    await this.behind.settled();
  }

  // ==================================================================== beyond the contract

  /** The folders this view has prepared (each with everything below it). */
  get preparedRoots(): readonly VPath[] {
    return this.roots.map((root) => root.path);
  }

  /** Resolves when every change reported by others so far has been read into memory (tests). */
  async whenCurrent(): Promise<void> {
    while (this.refreshes.size > 0) await Promise.all([...this.refreshes]);
  }

  /** Stops listening to the Vfs and the timers; pending changes are not written. */
  dispose(): void {
    for (const root of this.roots.splice(0)) root.unsubscribe();
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }

  // ==================================================================== writing to storage

  /** A change through the view: remember it and arm the write-behind timer. */
  private touched(path: VPath, file: CachedFile, from: number): void {
    file.dirty = true;
    file.dirtyFrom = Math.min(file.dirtyFrom, from);
    if (file.size < (file.storedSize ?? 0)) file.dirtyFrom = 0; // a truncation rewrites the file
    file.generation++;
    this.dirtyPaths.add(path);
    this.arm(path);
  }

  private arm(path: VPath): void {
    if (this.timers.has(path)) return;
    const cancel = this.deps.scheduler.setTimer(WRITE_BEHIND_MS, () => {
      this.timers.delete(path);
      this.behind.schedule(path, () => this.take(path));
    });
    this.timers.set(path, cancel);
  }

  private disarm(path: VPath): void {
    this.timers.get(path)?.();
    this.timers.delete(path);
  }

  /** WriteBehind's getter: decides what the write that starts now does. */
  private take(path: VPath): Bytes {
    this.dirtyPaths.delete(path);
    const file = this.files.get(path);
    let op: StorageOp;
    if (!file) {
      op = this.removals.delete(path) ? { kind: 'remove' } : { kind: 'none' };
    } else if (!file.dirty) {
      op = { kind: 'none' };
    } else if (file.storedSize !== null && file.dirtyFrom >= file.storedSize && file.size > file.storedSize) {
      op = { kind: 'append', data: file.buf.slice(file.storedSize, file.size), size: file.size, file };
    } else {
      op = { kind: 'write', data: file.buf.slice(0, file.size), file };
    }
    if (file) {
      file.dirty = false;
      file.dirtyFrom = Infinity;
    }
    this.taken.set(path, op);
    return op.kind === 'write' || op.kind === 'append' ? op.data : EMPTY;
  }

  /** WriteBehind's writer: performs the op take() chose. */
  private async store(path: VPath): Promise<void> {
    const op = this.taken.get(path) ?? { kind: 'none' };
    this.taken.delete(path);
    if (op.kind === 'none') return;
    const { vfs } = this.deps;
    const key = foldCase(path);
    this.ownChanges.set(key, (this.ownChanges.get(key) ?? 0) + 1);
    try {
      if (op.kind === 'remove') await vfs.remove(path);
      else if (op.kind === 'append') await vfs.appendFile(path, op.data);
      else await vfs.writeFile(path, op.data);
    } catch (error) {
      this.forgetOwnChange(key); // a failed mutation is not reported by the Vfs
      throw error;
    }
    this.failed.delete(path);
    if (op.kind === 'remove') return;
    const size = op.kind === 'append' ? op.size : op.data.length;
    op.file.storedSize = size;
    const stat = await vfs.stat(path).catch(() => null);
    if (stat && this.files.get(path) === op.file) op.file.mtime = stat.mtime;
  }

  private storeFailed(path: VPath, error: unknown): void {
    // Keep the change: the whole file is written again at the next settled().
    const file = this.files.get(path);
    if (file) {
      file.dirty = true;
      file.dirtyFrom = 0;
      file.storedSize = null;
      this.dirtyPaths.add(path);
    } else if (!this.removals.has(path)) {
      this.removals.add(path);
      this.dirtyPaths.add(path);
    }
    if (!this.failed.has(path)) {
      this.failed.add(path);
      this.say(notSavedMessage(path, error));
    }
  }

  private forgetOwnChange(key: string): void {
    const count = (this.ownChanges.get(key) ?? 0) - 1;
    if (count > 0) this.ownChanges.set(key, count);
    else this.ownChanges.delete(key);
  }

  // ==================================================================== changes made by others

  private changed(change: VfsChange): void {
    const key = foldCase(change.path);
    if (change.origin === 'local' && (this.ownChanges.get(key) ?? 0) > 0) {
      this.forgetOwnChange(key);
      return;
    }
    const running = this.refreshing.get(change.path);
    if (running) {
      running.again = change;
      return;
    }
    const state = { again: null as VfsChange | null };
    this.refreshing.set(change.path, state);
    const work = (async () => {
      let next: VfsChange | null = change;
      while (next) {
        await this.refresh(next).catch(() => {});
        next = state.again;
        state.again = null;
      }
      this.refreshing.delete(change.path);
    })();
    this.refreshes.add(work);
    void work.finally(() => this.refreshes.delete(work));
  }

  /** Brings the copy of one changed path (a file or a folder) up to date with storage. */
  private async refresh(change: VfsChange): Promise<void> {
    const { vfs } = this.deps;
    const stat = change.kind === 'remove' ? null : await vfs.stat(change.path).catch(() => null);
    if (!stat) {
      // Removed: drop what the program has not changed meanwhile.
      for (const path of [...this.files.keys()]) {
        if (!isBelowFold(path, change.path)) continue;
        const file = this.files.get(path) as CachedFile;
        if (file.dirty || this.behind.isPending(path)) continue;
        this.dropFile(path);
      }
      for (const [key, dir] of [...this.dirByFold]) {
        if (isBelowFold(dir, change.path)) this.dropDir(key, dir);
      }
      return;
    }
    const root = this.rootOf(change.path);
    if (!root) return;
    if (stat.kind === 'dir') {
      const listed = await this.listTree(change.path, this.depthBelow(root.path, change.path));
      for (const dir of listed.dirs) this.addDir(dir);
      for (const found of listed.files) if (!this.lookupFile(found.path)) await this.reload(found);
      for (const { path, reason } of listed.skipped) this.markUnavailable(path, reason);
      return;
    }
    const depth = this.depthBelow(root.path, dirname(change.path));
    if (depth > this.limits.maxDepth) return;
    await this.reload({ path: change.path, size: stat.size, mtime: stat.mtime, readOnly: stat.readOnly });
  }

  /** Reads one file from storage into memory, unless the program changes it meanwhile. */
  private async reload(found: Found): Promise<void> {
    const before = this.lookupFile(found.path);
    const generation = before ? (this.files.get(before) as CachedFile).generation : -1;
    if (found.size > this.limits.maxFileBytes || this.totalBytes(before) + found.size > this.limits.maxTotalBytes) {
      if (before) this.dropFile(before);
      this.markUnavailable(found.path, 'too-large');
      return;
    }
    let data: Bytes;
    try {
      data = await this.deps.vfs.readFile(found.path);
    } catch {
      return; // gone again, or unreadable for now: the next change or revalidate() tries again
    }
    const now = this.lookupFile(found.path);
    if (now && (this.files.get(now) as CachedFile).generation !== generation) return; // changed by the program
    if (now && (this.files.get(now) as CachedFile).dirty) return;
    const stored = now ?? this.spell(found.path);
    if (!this.dirByFold.has(foldCase(dirname(stored)))) this.addDir(dirname(stored));
    this.unavailable.delete(foldCase(stored));
    const file: CachedFile = {
      buf: data,
      size: data.length,
      readOnly: found.readOnly,
      mtime: found.mtime,
      storedSize: data.length,
      dirty: false,
      dirtyFrom: Infinity,
      generation: generation + 1,
    };
    if (now) this.files.set(now, file);
    else this.putFile(stored, file);
  }

  // ==================================================================== loading trees

  /** Loads the tree below `dir` (which lies `depth` levels below its root) into memory. */
  private async loadTree(dir: VPath, depth: number): Promise<void> {
    const listed = await this.listTree(dir, depth);
    for (const path of listed.dirs) this.addDir(path);
    let count = this.files.size;
    let total = this.totalBytes(null);
    for (const found of listed.files) {
      const existing = this.lookupFile(found.path);
      if (existing) continue; // already in memory, and kept current since
      if (count >= this.limits.maxFiles) {
        this.markUnavailable(found.path, 'too-many');
        continue;
      }
      if (found.size > this.limits.maxFileBytes || total + found.size > this.limits.maxTotalBytes) {
        this.markUnavailable(found.path, 'too-large');
        continue;
      }
      let data: Bytes;
      try {
        data = await this.deps.vfs.readFile(found.path);
      } catch {
        this.markUnavailable(found.path, 'unreadable');
        continue;
      }
      if (this.lookupFile(found.path)) continue; // a change reported meanwhile was read first
      this.putFile(found.path, {
        buf: data,
        size: data.length,
        readOnly: found.readOnly,
        mtime: found.mtime,
        storedSize: data.length,
        dirty: false,
        dirtyFrom: Infinity,
        generation: 0,
      });
      count++;
      total += data.length;
    }
    for (const { path, reason } of listed.skipped) this.markUnavailable(path, reason);
  }

  /**
   * Lists a tree breadth first with sorted names, as Vfs.snapshot does, without reading file
   * contents. `depth` is how far `dir` already lies below its root; folders deeper than
   * limits.maxDepth below the root are reported as skipped.
   */
  private async listTree(
    dir: VPath,
    depth: number,
  ): Promise<{ dirs: VPath[]; files: Found[]; skipped: { path: VPath; reason: UnavailableReason }[] }> {
    const { vfs } = this.deps;
    const dirs: VPath[] = [dir];
    const files: Found[] = [];
    const skipped: { path: VPath; reason: UnavailableReason }[] = [];
    const queue: { path: VPath; depth: number }[] = [{ path: dir, depth }];
    while (queue.length > 0) {
      const next = queue.shift() as { path: VPath; depth: number };
      let entries: DirEntry[];
      try {
        entries = await vfs.list(next.path);
      } catch {
        if (next.path !== dir) skipped.push({ path: next.path, reason: 'unreadable' });
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        const path: VPath = `${next.path}/${entry.name}`;
        if (entry.kind === 'dir') {
          if (next.depth + 1 > this.limits.maxDepth) skipped.push({ path, reason: 'too-deep' });
          else {
            dirs.push(path);
            queue.push({ path, depth: next.depth + 1 });
          }
          continue;
        }
        const stat = await vfs.stat(path).catch(() => null);
        if (!stat || stat.kind !== 'file') {
          skipped.push({ path, reason: 'unreadable' });
          continue;
        }
        files.push({ path, size: stat.size, mtime: stat.mtime, readOnly: stat.readOnly });
      }
    }
    return { dirs, files, skipped };
  }

  // ==================================================================== the index

  private rootOf(path: VPath): Root | undefined {
    return this.roots.find((root) => isBelowFold(path, root.path));
  }

  private depthBelow(root: VPath, path: VPath): number {
    return path.length <= root.length ? 0 : path.slice(root.length + 1).split('/').length;
  }

  private fileAt(path: VPath): CachedFile | undefined {
    if (typeof path !== 'string') return undefined;
    const stored = this.lookupFile(path);
    return stored ? this.files.get(stored) : undefined;
  }

  private lookupFile(path: VPath): VPath | null {
    if (this.files.has(path)) return path;
    return this.fileByFold.get(foldCase(path)) ?? null;
  }

  /** A path in the stored spelling of the folders that exist. */
  private spell(path: VPath): VPath {
    const parent = this.dirByFold.get(foldCase(dirname(path)));
    return parent ? `${parent}/${basename(path)}` : path;
  }

  private putFile(path: VPath, file: CachedFile): void {
    this.files.set(path, file);
    this.fileByFold.set(foldCase(path), path);
    this.childrenOf(dirname(path)).add(basename(path));
  }

  private dropFile(path: VPath): void {
    this.files.delete(path);
    this.fileByFold.delete(foldCase(path));
    this.children.get(dirname(path))?.delete(basename(path));
  }

  private addDir(dir: VPath): void {
    const root = this.rootOf(dir);
    for (let d = dir; ; d = dirname(d)) {
      const key = foldCase(d);
      if (this.dirByFold.has(key)) break;
      this.dirByFold.set(key, d);
      this.unavailable.delete(key);
      if (d !== root?.path && dirname(d) !== d) this.childrenOf(dirname(d)).add(basename(d));
      if (!root || d === root.path || dirname(d) === d) break;
    }
  }

  private dropDir(key: string, dir: VPath): void {
    this.dirByFold.delete(key);
    this.children.delete(dir);
    this.children.get(dirname(dir))?.delete(basename(dir));
  }

  private childrenOf(dir: VPath): Set<string> {
    let set = this.children.get(dir);
    if (!set) {
      set = new Set();
      this.children.set(dir, set);
    }
    return set;
  }

  private markUnavailable(path: VPath, reason: UnavailableReason): void {
    const key = foldCase(path);
    this.unavailable.set(key, reason);
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.say(unavailableMessage(path, reason));
  }

  /**
   * Messages go out from a timer, not at once: a folder is prepared while a program loads, and the
   * load empties the message area right after (4.7); the message must come after that.
   */
  private say(text: string): void {
    this.deps.scheduler.setTimer(0, () => this.deps.message(text));
  }

  private totalBytes(except: VPath | null): number {
    let total = 0;
    for (const [path, file] of this.files) if (path !== except) total += file.size;
    return total;
  }
}

/** True if `path` is `prefix` or lies below it, without regard to letter case. */
function isBelowFold(path: VPath, prefix: VPath): boolean {
  if (path === prefix) return true;
  const a = foldCase(path);
  const b = foldCase(prefix);
  return a === b || a.startsWith(`${b}/`);
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
