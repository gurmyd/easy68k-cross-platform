// The 68000 program's files (ARCHITECTURE.md 3.8.4): the C library streams of the original over a
// SyncFiles view, and the task 58 dialog.
//
// The engine passes the program's file operations to the host unbuffered and in order (TRAP #15
// tasks 50-59, trap15-a §7). The original opened these files with fopen() and the Borland run-time
// library buffered them, which a program can observe: data written and not closed is not in the
// file yet when the program, or anything else, looks at the file again. This class therefore
// models the stream:
//
// - Names (trap15-a §7.1, §11 item 14): Windows-1252; '\' and '/' separate; relative names resolve
//   against `currentDir`; letter case is ignored when no exact match exists; a name with a drive
//   letter, or with a character Windows refuses in file names, does not resolve. A name that starts
//   with '\' or '/' is accepted when it is a path the port hands out (task 58): a VPath of a mount
//   the program has used, or in the desktop app (a program folder on /disk) a real path.
// - Modes: Update needs an existing, writable file; Read an existing file; Create creates the file
//   or truncates it at once. The engine falls back from Update to Read itself (task 51 result 3).
// - Streams: handles are positive integers, never reused; each stream has its own position; one
//   file may be open in several streams.
// - Write buffering: bytes written through a stream are pending until committed to the view - on
//   close, on a seek, before a read through the same stream, and in whole multiples of
//   STDIO_BUFFER as soon as that many are pending. No other stream and no other host part sees
//   pending bytes.
// - A simulator reset is never seen here (the engine forgets its slots without closing them), so
//   the streams of the old run stay open, with their pending bytes, until exit(): a later remove
//   of such a file fails, and a new open does not see the pending bytes, as on Windows.
// - exit() is the original's process exit (cold start, quit, page close); exitNow() its
//   synchronous form for an abrupt close: what storage does not have yet goes to the journal
//   (journal.ts), which recoverJournal() applies at the next start.
//
// Owner: W1 > SH6.

import {
  FileMode,
  type Bytes,
  type ProgramFilesApi,
  type ProgramFilesDeps,
  type SyncFiles,
  type VPath,
} from '../../../contracts';
import { decode, encode } from '../../codec/cp1252';
import { dirname, hasDriveLetter, isRooted, isVPath, mountOf, splitWindowsName } from '../../paths/winpath';
import { applyEntryBytes, parseJournal, serializeJournal, toBase64, type JournalEntry } from './journal';

export type { ProgramFilesDeps } from '../../../contracts';

export const STDIO_BUFFER = 512; // bytes; Borland BUFSIZ, to be confirmed (O-15)

/** The mount of the desktop app's real file system (3.8.1). */
const DISK_MOUNT = 'disk';

/** Characters Windows does not accept in a file name (besides '\' and '/', which separate). */
// eslint-disable-next-line no-control-regex -- control characters are what this looks for
const INVALID_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/;

interface Stream {
  readonly handle: number;
  readonly path: VPath;
  readonly view: SyncFiles;
  readonly writable: boolean;
  position: number;
  /** Pending bytes: pending[0, pendingLength) belong at pendingStart of the file. */
  pending: Uint8Array;
  pendingLength: number;
  pendingStart: number;
}

/** What changed in one file through one view since the view was last settled (for the journal). */
interface Touch {
  removed: boolean;
  /** Lowest and highest-plus-one offset written (a create counts from 0). */
  lo: number;
  hi: number;
}

/** A path as the program sees it: the real path of a file on the desktop app's disk, else the VPath. */
export function programPathOf(path: VPath): string {
  return path.startsWith(`/${DISK_MOUNT}/`) ? path.slice(DISK_MOUNT.length + 1) : path;
}

let instances = 0;
function newInstanceId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return (
    random ??
    `pf-${(++instances).toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  );
}

export class ProgramFiles implements ProgramFilesApi {
  private readonly deps: ProgramFilesDeps;
  private dir: VPath | null = null;
  private readonly streams = new Map<number, Stream>();
  private nextHandle = 1;
  /** Every view this instance has used, with what changed through it since it was last settled. */
  private readonly touches = new Map<SyncFiles, Map<VPath, Touch>>();
  /** Mounts of the folders the program has been given (absolute names must name one of them). */
  private readonly mounts = new Set<string>();
  private stale = false;
  /** This window's part of the journal. */
  private readonly instanceId = newInstanceId();

  constructor(deps: ProgramFilesDeps) {
    this.deps = deps;
  }

  /** The directory relative names resolve against (the original's current directory). */
  get currentDir(): VPath | null {
    return this.dir;
  }

  /** Pending bytes, or changes not yet in storage. */
  get unsaved(): boolean {
    for (const stream of this.streams.values()) if (stream.pendingLength > 0) return true;
    for (const view of this.touches.keys()) if (view.unsettled) return true;
    return false;
  }

  async setCurrentDir(dir: VPath): Promise<void> {
    this.dir = dir;
    this.mounts.add(mountOf(dir));
    const view = this.deps.viewFor(dir);
    this.viewUsed(view);
    await view.prepare(dir);
  }

  read(name: Bytes): Bytes | null {
    const found = this.locate(name);
    if (!found) return null;
    const stat = found.view.stat(found.path);
    return stat ? found.view.read(found.path, 0, stat.size) : null;
  }

  markStale(): void {
    this.stale = true;
  }

  async revalidateIfStale(): Promise<void> {
    if (!this.stale) return;
    this.stale = false;
    for (const view of [...this.touches.keys()]) await view.revalidate();
  }

  async exit(): Promise<void> {
    this.commitAll();
    this.streams.clear();
    await this.settleViews();
  }

  exitNow(): void {
    // The page may live on (back-forward cache), so the streams stay open: only their bytes go out.
    this.commitAll();
    const settling = this.settleViews();
    const entries = this.journalEntries();
    if (entries.length === 0) return;
    const doc = parseJournal(this.readJournal());
    doc.parts[this.instanceId] = { entries };
    this.writeJournal(serializeJournal(doc));
    // If the page survives and storage gets everything, the part is not needed any more.
    void settling.then(() => {
      if (this.unsaved) return;
      const now = parseJournal(this.readJournal());
      if (!(this.instanceId in now.parts)) return;
      delete now.parts[this.instanceId];
      this.writeJournal(serializeJournal(now));
    });
  }

  async recoverJournal(): Promise<void> {
    const doc = parseJournal(this.readJournal());
    const ids = Object.keys(doc.parts).filter((id) => id !== this.instanceId);
    if (ids.length === 0) return;
    for (const id of ids) {
      for (const entry of (doc.parts[id] as { entries: JournalEntry[] }).entries) await this.applyEntry(entry);
    }
    // Remove what was applied; a part another window wrote meanwhile stays.
    const now = parseJournal(this.readJournal());
    for (const id of ids) delete now.parts[id];
    this.writeJournal(serializeJournal(now));
  }

  resetToStartup(): void {
    // exit() has run before (4.7.1); should it not have, the pending bytes still reach the view.
    this.commitAll();
    this.streams.clear();
    this.dir = null;
    this.mounts.clear();
    this.stale = false;
  }

  /* ================================================================== HostFiles */

  fileOpen(name: Bytes, mode: number): number {
    const found = this.locate(name);
    if (!found) return 0;
    const { view, path } = found;
    const stat = view.stat(path);
    switch (mode) {
      case FileMode.Update:
        if (!stat || stat.readOnly) return 0;
        break;
      case FileMode.Read:
        if (!stat) return 0;
        break;
      case FileMode.Create:
        if (stat?.readOnly || !this.viewCreate(view, path)) return 0;
        break;
      default:
        return 0;
    }
    const handle = this.nextHandle++;
    this.streams.set(handle, {
      handle,
      path,
      view,
      writable: mode !== FileMode.Read,
      position: 0,
      pending: new Uint8Array(0),
      pendingLength: 0,
      pendingStart: 0,
    });
    return handle;
  }

  fileRead(handle: number, count: number): Bytes | null {
    const stream = this.streams.get(handle);
    if (!stream || !Number.isSafeInteger(count) || count < 0) return null;
    if (!this.commit(stream)) return null;
    const data = stream.view.read(stream.path, stream.position, count);
    if (data === null) return null;
    stream.position += data.length;
    return data;
  }

  fileWrite(handle: number, data: Bytes): number {
    const stream = this.streams.get(handle);
    if (!stream || !stream.writable) return -1;
    if (stream.pendingLength === 0) stream.pendingStart = stream.position;
    const needed = stream.pendingLength + data.length;
    if (needed > stream.pending.length) {
      const grown = new Uint8Array(Math.max(needed, stream.pending.length * 2, STDIO_BUFFER));
      grown.set(stream.pending.subarray(0, stream.pendingLength));
      stream.pending = grown;
    }
    stream.pending.set(data, stream.pendingLength);
    stream.pendingLength = needed;
    stream.position += data.length;
    if (stream.pendingLength >= STDIO_BUFFER) {
      const whole = stream.pendingLength - (stream.pendingLength % STDIO_BUFFER);
      if (!this.commit(stream, whole)) return -1;
    }
    return data.length;
  }

  fileSeek(handle: number, offset: number, whence: number): number {
    const stream = this.streams.get(handle);
    if (!stream || !Number.isSafeInteger(offset)) return -1;
    if (!this.commit(stream)) return -1;
    let base: number;
    if (whence === 0) base = 0;
    else if (whence === 1) base = stream.position;
    else if (whence === 2) base = stream.view.stat(stream.path)?.size ?? -1;
    else return -1;
    if (base < 0) return -1;
    const position = base + offset;
    if (position < 0 || !Number.isSafeInteger(position)) return -1;
    stream.position = position;
    return position;
  }

  fileClose(handle: number): boolean {
    const stream = this.streams.get(handle);
    if (!stream) return false;
    const committed = this.commit(stream);
    this.streams.delete(handle);
    // "At once when a handle closes" (3.8.4): the view starts writing what it holds.
    if (stream.view.unsettled) void stream.view.settled().catch(() => {});
    return committed;
  }

  fileRemove(name: Bytes): boolean {
    const found = this.locate(name);
    if (!found) return false;
    // Windows does not delete a file that is open, also in a stream of an earlier run.
    for (const stream of this.streams.values())
      if (stream.view === found.view && stream.path === found.path) return false;
    return this.viewRemove(found.view, found.path);
  }

  fileDialog(mode: number, title: Bytes, filter: Bytes, fileName: Bytes): void {
    void this.runFileDialog(mode, decode(title), decode(filter), decode(fileName));
  }

  /* ================================================================== the task 58 dialog */

  private async runFileDialog(mode: number, title: string, filter: string, initialName: string): Promise<void> {
    let chosen: VPath | null;
    try {
      chosen = await this.deps.showFileDialog(mode, title, filter, initialName);
    } catch {
      chosen = null; // a dialog that fails is a Cancel
    }
    if (chosen !== null && isVPath(chosen)) {
      // The original's file dialogs move the process's current directory to the chosen file's folder.
      try {
        await this.setCurrentDir(dirname(chosen));
      } catch {
        // The folder cannot be prepared: the program gets the path and fails to open it, as on Windows
        // for a file it cannot reach.
      }
      this.deps.post({ kind: 'fileDialogReply', accepted: true, path: encode(programPathOf(chosen)).bytes });
    } else {
      this.deps.post({ kind: 'fileDialogReply', accepted: false, path: null });
    }
  }

  /* ================================================================== names */

  /** The view and the path a program's file name refers to, or null. */
  private locate(name: Bytes): { view: SyncFiles; path: VPath } | null {
    const text = decode(name);
    // A drive letter names no folder of the port; the other characters Windows refuses fail fopen().
    if (text === '' || hasDriveLetter(text) || INVALID_NAME_CHARS.test(text)) return null;
    // Windows drops trailing periods and spaces of every name segment.
    const segments = splitWindowsName(text)
      .map((segment) => (segment === '.' || segment === '..' ? segment : segment.replace(/[. ]+$/, '')))
      .filter((segment) => segment !== '');
    if (segments.length === 0) return null;
    let dir: VPath;
    let rel: string;
    if (isRooted(text)) {
      const disk = this.dir !== null && mountOf(this.dir) === DISK_MOUNT;
      const parts = disk ? [DISK_MOUNT, ...segments] : segments;
      const mount = parts[0] as string;
      if (!this.mounts.has(mount) || parts.length < 2) return null;
      dir = `/${mount}`;
      rel = parts.slice(1).join('\\');
    } else {
      if (this.dir === null) return null;
      dir = this.dir;
      rel = segments.join('\\');
    }
    const view = this.deps.viewFor(dir);
    this.viewUsed(view);
    const path = view.resolve(dir, rel);
    return path === null ? null : { view, path };
  }

  /* ================================================================== committing pending bytes */

  /** Commits the first `count` pending bytes of a stream (default: all); false if the view refused. */
  private commit(stream: Stream, count = stream.pendingLength): boolean {
    if (count <= 0) return true;
    const data = stream.pending.slice(0, count);
    const ok = this.viewWrite(stream.view, stream.path, stream.pendingStart, data);
    stream.pending.copyWithin(0, count, stream.pendingLength);
    stream.pendingLength -= count;
    stream.pendingStart += count;
    return ok;
  }

  /** The pending bytes of every stream, in the order the streams were opened. */
  private commitAll(): void {
    for (const handle of [...this.streams.keys()].sort((a, b) => a - b)) {
      this.commit(this.streams.get(handle) as Stream);
    }
  }

  private async settleViews(): Promise<void> {
    await Promise.all([...this.touches.keys()].map((view) => view.settled().catch(() => {})));
  }

  /* ================================================================== changes through the views */

  private viewUsed(view: SyncFiles): Map<VPath, Touch> {
    let log = this.touches.get(view);
    if (!log) {
      log = new Map();
      this.touches.set(view, log);
    }
    return log;
  }

  /** The record of changes of a view, emptied when the view has written everything to storage. */
  private changeLog(view: SyncFiles): Map<VPath, Touch> {
    const log = this.viewUsed(view);
    if (!view.unsettled) log.clear();
    return log;
  }

  private viewWrite(view: SyncFiles, path: VPath, position: number, data: Bytes): boolean {
    const log = this.changeLog(view);
    const before = view.stat(path)?.size ?? 0;
    if (!view.write(path, position, data)) return false;
    const touch = log.get(path) ?? { removed: false, lo: Infinity, hi: 0 };
    touch.removed = false;
    touch.lo = Math.min(touch.lo, position, before);
    touch.hi = Math.max(touch.hi, position + data.length);
    log.set(path, touch);
    return true;
  }

  private viewCreate(view: SyncFiles, path: VPath): boolean {
    const log = this.changeLog(view);
    if (!view.create(path)) return false;
    log.set(path, { removed: false, lo: 0, hi: 0 });
    return true;
  }

  private viewRemove(view: SyncFiles, path: VPath): boolean {
    const log = this.changeLog(view);
    if (!view.remove(path)) return false;
    log.set(path, { removed: true, lo: Infinity, hi: 0 });
    return true;
  }

  /* ================================================================== the journal */

  /** What storage may not have yet, file by file, as the files must end up. */
  private journalEntries(): JournalEntry[] {
    const entries: JournalEntry[] = [];
    for (const [view, log] of this.touches) {
      if (!view.unsettled) continue;
      for (const [path, touch] of log) {
        const stat = view.stat(path);
        if (touch.removed || !stat) {
          if (!stat) entries.push({ path, remove: true });
          continue;
        }
        const at = Math.min(touch.lo, stat.size);
        const end = Math.max(at, Math.min(touch.hi, stat.size));
        const data = view.read(path, at, end - at) ?? new Uint8Array(0);
        entries.push({ path, size: stat.size, at, data: toBase64(data) });
      }
    }
    return entries;
  }

  private async applyEntry(entry: JournalEntry): Promise<void> {
    if (!isVPath(entry.path)) return;
    const dir = dirname(entry.path);
    const view = this.deps.viewFor(dir);
    try {
      await view.prepare(dir);
    } catch {
      this.deps.message(`Could not restore a file of the program: ${programPathOf(entry.path)}`);
      return;
    }
    const stat = view.stat(entry.path);
    if ('remove' in entry) {
      if (stat) view.remove(entry.path);
    } else {
      const current = stat ? view.read(entry.path, 0, stat.size) : null;
      const wanted = applyEntryBytes(current, entry);
      if (!current || !sameBytes(current, wanted)) {
        if (view.create(entry.path) && view.write(entry.path, 0, wanted)) {
          // written
        } else {
          this.deps.message(`Could not restore a file of the program: ${programPathOf(entry.path)}`);
        }
      }
    }
    await view.settled().catch(() => {});
  }

  private readJournal(): string | null {
    try {
      return this.deps.journal.read();
    } catch {
      return null;
    }
  }

  private writeJournal(text: string | null): void {
    try {
      this.deps.journal.write(text);
    } catch {
      // The store refused (full, or not allowed): nothing more can be done in a closing page.
    }
  }
}

function sameBytes(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
