// The File System Access backends (ARCHITECTURE.md 3.8.1): what the port uses in Chromium browsers
// to work on files of the student's own computer.
//
//   /folder   FolderBackend   a folder the student chose with showDirectoryPicker(). Every call
//                             goes to the real folder at that moment; nothing is cached, so a file
//                             another program changed or added is seen by the next stat() or list().
//   /linked   LinkedBackend   single files the student opened with showOpenFilePicker(). Each gets
//                             a folder /linked/<id>/ holding a copy (the program directory of 3.8.2,
//                             where the .L68, the .S68 and a program's files go) and the file handle
//                             to save back to. Save writes the real file first, then the copy.
//
//     const folder = new FolderBackend(directoryHandle);     // any FileSystemDirectoryHandle
//     vfs.mount(folder);
//
// Rules for the student's files:
// - An acknowledged write is in the file: writeFile resolves after the writable stream has been
//   closed, which is when Chromium moves the written data into place (it writes a swap file and
//   replaces the file on close, so a file is never half written).
// - A file changed by another program is never overwritten silently. stat() reports the real
//   modification time, which the documents compare before saving (3.8.6 rule 3), and the linked
//   backend refuses to write a real file whose time differs from the last one it saw (the case in
//   which stat() could not look at the real file, because the browser had not granted access yet).
// - Nothing outside the chosen folder is reachable: paths are checked segment by segment ("..",
//   ".", empty segments and backslashes are refused), and a directory handle cannot name its
//   parent.
//
// The handles are kept in the IndexedDB database `easy68k-fsaccess` (HandleStore), so that the
// folder and the linked files can be used again after a reload. The browser asks for permission
// again then (queryPermission is "prompt"); requestPermission needs a click, so the feature
// (features/files-fsaccess) asks for it in one. createStartupBackends() mounts the linked files at
// start, and the folder too when the browser still grants access to it.
//
// The File System Access API exists in Chromium browsers only. Where it does not (Safari, Firefox),
// and in the desktop app, createStartupBackends() returns nothing and touches no storage.
//
// Owner: FS2.

import type { BackendChange, Bytes, DirEntry, FileStat, FileSystemBackend, FsError, Platform } from '../contracts';
import { foldCase, sameName } from '../core/paths/winpath';
import { openStartupStore, type ChannelLike } from './browser-backend';
import { MemoryBackend } from './memory-backend';
import { fsError, isFsError } from './vfs';

// ---- the parts of the File System Access API the backends use -----------------------------------
// Structural types, so that the real handles of Chromium and the fakes of the unit tests
// (features/files-fsaccess/fake-handles.ts) both fit. TypeScript's DOM library lacks the
// permission methods and the pickers.

export type FsaPermissionMode = 'read' | 'readwrite';
export type FsaPermissionState = 'granted' | 'denied' | 'prompt';

export interface FsaHandleBase {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  isSameEntry?(other: FsaHandle): Promise<boolean>;
  queryPermission?(descriptor: { mode: FsaPermissionMode }): Promise<FsaPermissionState>;
  requestPermission?(descriptor: { mode: FsaPermissionMode }): Promise<FsaPermissionState>;
}

/** What getFile() gives: a File. */
export interface FsaFile {
  readonly size: number;
  readonly lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FsaWritable {
  write(data: Bytes): Promise<void>;
  seek(position: number): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface FsaFileHandle extends FsaHandleBase {
  readonly kind: 'file';
  getFile(): Promise<FsaFile>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FsaWritable>;
}

export interface FsaDirectoryHandle extends FsaHandleBase {
  readonly kind: 'directory';
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsaDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, FsaHandle]>;
  /** The path of a handle inside this folder, or null (Chromium). */
  resolve?(possibleDescendant: FsaHandle): Promise<string[] | null>;
}

export type FsaHandle = FsaFileHandle | FsaDirectoryHandle;

/** True where the File System Access pickers exist (Chromium browsers in a secure context). */
export function fsAccessSupported(scope: unknown = globalThis): boolean {
  const s = scope as { showDirectoryPicker?: unknown; showOpenFilePicker?: unknown } | null | undefined;
  return typeof s?.showDirectoryPicker === 'function' && typeof s?.showOpenFilePicker === 'function';
}

/**
 * Whether the browser grants `mode` access to `handle`. With `ask`, a "prompt" state is turned
 * into the browser's question (requestPermission), which works only while the page has a user
 * activation (a click or a key press shortly before); without one the answer is false.
 */
export async function hasPermission(handle: FsaHandleBase, mode: FsaPermissionMode, ask: boolean): Promise<boolean> {
  try {
    if (typeof handle.queryPermission !== 'function') return true;
    if ((await handle.queryPermission({ mode })) === 'granted') return true;
    if (!ask || typeof handle.requestPermission !== 'function') return false;
    // Without a user activation the browser refuses at once (SecurityError); do not even try.
    const activation = (globalThis.navigator as { userActivation?: { isActive: boolean } } | undefined)?.userActivation;
    if (activation && !activation.isActive) return false;
    return (await handle.requestPermission({ mode })) === 'granted';
  } catch {
    return false; // no user activation, or the handle is gone
  }
}

// ---- texts ----------------------------------------------------------------------------------------

/** The messages of failed operations, written for the student (they reach the documents' message boxes). */
export const FSACCESS_MESSAGES = {
  notAllowed: (where: string) =>
    `The browser does not allow this page to use "${where}" at the moment. ` +
    'Open the folder or the file again (File > Open), and allow access when the browser asks.',
  inUse: (rel: string) =>
    `"${rel}" could not be written because another program is using it. Close it there and try again.`,
  full: (rel: string) => `"${rel}" could not be written: the disk is full.`,
  failed: (rel: string, detail: string) => `"${rel}" could not be used (${detail}).`,
  linkedChanged: (name: string) =>
    `"${name}" has been changed by another program since this window last read it, so it was not saved. ` +
    'Use Reload to see the other version, or Save As to keep yours under another name.',
  linkedGone: (name: string) =>
    `"${name}" no longer exists on this computer (it was moved, renamed or deleted), so it was not saved. ` +
    'Use Save As to save it again.',
} as const;

// ---- paths and errors -----------------------------------------------------------------------------

/** Throws 'invalid-path' unless rel is a path inside the mount ('' allowed only if allowRoot). */
function checkRel(rel: string, allowRoot: boolean): void {
  if (rel === '') {
    if (allowRoot) return;
    throw fsError('invalid-path', 'the root of a mount is not a file');
  }
  if (rel.startsWith('/') || rel.endsWith('/') || rel.includes('\\') || rel.includes('\0'))
    throw fsError('invalid-path', `invalid path: "${rel}"`);
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') throw fsError('invalid-path', `invalid path: "${rel}"`);
  }
}

function splitRel(rel: string): { parent: string; name: string } {
  const slash = rel.lastIndexOf('/');
  return slash < 0 ? { parent: '', name: rel } : { parent: rel.slice(0, slash), name: rel.slice(slash + 1) };
}

function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : 'Error';
}

function errorText(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : errorName(error);
}

/**
 * Turns a DOMException of the File System Access API into an FsError. `role` says what the failing
 * call looked up: a folder on the way ('dir') or the entry itself ('file'), which decides what a
 * TypeMismatchError (a file where a folder is wanted, or the reverse) means.
 */
function toFsError(error: unknown, rel: string, role: 'dir' | 'file', where: string): FsError {
  if (isFsError(error)) return error;
  switch (errorName(error)) {
    case 'NotFoundError':
      return fsError('not-found', `no such file or folder: ${rel}`);
    case 'TypeMismatchError':
      return role === 'dir'
        ? fsError('not-directory', `not a folder: a file is in the way of ${rel}`)
        : fsError('is-directory', `is a folder: ${rel}`);
    case 'TypeError':
      return fsError('invalid-path', `a name the folder cannot hold: ${rel}`);
    case 'NotAllowedError':
    case 'SecurityError':
      return fsError('io', FSACCESS_MESSAGES.notAllowed(where));
    case 'NoModificationAllowedError':
      return fsError('io', FSACCESS_MESSAGES.inUse(rel));
    case 'QuotaExceededError':
      return fsError('io', FSACCESS_MESSAGES.full(rel));
    default:
      return fsError('io', FSACCESS_MESSAGES.failed(rel, errorText(error)));
  }
}

/** Writes `data` as the whole content of `handle` and closes the stream (the data is then in the file). */
async function writeWhole(handle: FsaFileHandle, data: Bytes): Promise<void> {
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(data);
  } catch (error) {
    await writable.abort?.(error).catch(() => {});
    throw error;
  }
  await writable.close();
}

async function readWhole(handle: FsaFileHandle): Promise<{ data: Bytes; file: FsaFile }> {
  const file = await handle.getFile();
  return { data: new Uint8Array(await file.arrayBuffer()), file };
}

/** Chromium's swap files, `<name>.crswap`, exist beside a file while it is being written. */
const SWAP_SUFFIX = '.crswap';

// ---- /folder ------------------------------------------------------------------------------------------

export const FOLDER_MOUNT = 'folder';
export const LINKED_MOUNT = 'linked';

export interface FolderBackendOptions {
  /** Default "folder". Tests mount several. */
  mount?: string;
  /** Default `Folder: <name of the folder>`. */
  label?: string;
}

/** The label of an opened folder in the dialogs and the Files panel. */
export function folderLabel(name: string): string {
  return `Folder: ${name}`;
}

/**
 * A folder of the student's computer (or any FileSystemDirectoryHandle, such as the origin private
 * file system in tests). No change events exist for it (3.8.1); readers that cache, such as the
 * simulator's view, revalidate by listing and comparing size and modification time (3.8.4).
 *
 * appendFile writes through a writable stream that keeps the existing data; Chromium copies the
 * file into its swap file for that, so an append costs time in proportion to the file's size, not
 * only to the appended bytes (docs/porting/errata/FS2.md).
 */
export class FolderBackend implements FileSystemBackend {
  readonly mount: string;
  readonly kind = 'fsaccess' as const;
  readonly label: string;

  constructor(
    readonly handle: FsaDirectoryHandle,
    options: FolderBackendOptions = {},
  ) {
    this.mount = options.mount ?? FOLDER_MOUNT;
    this.label = options.label ?? folderLabel(handle.name);
  }

  async stat(rel: string): Promise<FileStat | null> {
    checkRel(rel, true);
    if (rel === '') return { kind: 'dir', size: 0, mtime: 0, readOnly: false };
    const { parent, name } = splitRel(rel);
    let dir: FsaDirectoryHandle;
    try {
      dir = await this.dir(parent, false);
    } catch (error) {
      if (isFsError(error, 'not-found') || isFsError(error, 'not-directory')) return null;
      throw error;
    }
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      return { kind: 'file', size: file.size, mtime: file.lastModified, readOnly: false };
    } catch (error) {
      if (errorName(error) === 'NotFoundError') return null;
      if (errorName(error) !== 'TypeMismatchError') throw toFsError(error, rel, 'file', this.handle.name);
    }
    try {
      await dir.getDirectoryHandle(name);
      return { kind: 'dir', size: 0, mtime: 0, readOnly: false };
    } catch (error) {
      if (errorName(error) === 'NotFoundError' || errorName(error) === 'TypeMismatchError') return null;
      throw toFsError(error, rel, 'dir', this.handle.name);
    }
  }

  async readFile(rel: string): Promise<Bytes> {
    checkRel(rel, true);
    if (rel === '') throw fsError('is-directory', 'the root is a folder');
    const file = await this.fileHandle(rel, false);
    try {
      return (await readWhole(file)).data;
    } catch (error) {
      throw toFsError(error, rel, 'file', this.handle.name);
    }
  }

  async writeFile(rel: string, data: Bytes): Promise<void> {
    checkRel(rel, false);
    const copy = data.slice(); // the caller may change its array while the write waits
    return this.inTurn(rel, async () => {
      const file = await this.fileHandle(rel, true);
      try {
        await writeWhole(file, copy);
      } catch (error) {
        throw toFsError(error, rel, 'file', this.handle.name);
      }
    });
  }

  async appendFile(rel: string, data: Bytes): Promise<void> {
    checkRel(rel, false);
    const copy = data.slice();
    return this.inTurn(rel, async () => {
      const file = await this.fileHandle(rel, true);
      if (copy.length === 0) return; // the file exists now; nothing to add
      try {
        const size = (await file.getFile()).size;
        const writable = await file.createWritable({ keepExistingData: true });
        try {
          await writable.seek(size);
          await writable.write(copy);
        } catch (error) {
          await writable.abort?.(error).catch(() => {});
          throw error;
        }
        await writable.close();
      } catch (error) {
        throw toFsError(error, rel, 'file', this.handle.name);
      }
    });
  }

  async remove(rel: string): Promise<void> {
    checkRel(rel, false);
    const { parent, name } = splitRel(rel);
    const dir = await this.dir(parent, false);
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch (error) {
      throw toFsError(error, rel, 'file', this.handle.name);
    }
  }

  async list(rel: string): Promise<DirEntry[]> {
    checkRel(rel, true);
    const dir = await this.dir(rel, false);
    const out: DirEntry[] = [];
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file' && name.endsWith(SWAP_SUFFIX)) continue;
        out.push({ name, kind: handle.kind === 'directory' ? 'dir' : 'file' });
      }
    } catch (error) {
      throw toFsError(error, rel, 'dir', this.handle.name);
    }
    return out;
  }

  async mkdirp(rel: string): Promise<void> {
    checkRel(rel, true);
    await this.dir(rel, true);
  }

  // ---- internals ----------------------------------------------------------------------

  /** The write running or waiting last on each file (key: the path with its letter case folded). */
  private readonly writes = new Map<string, Promise<void>>();

  /**
   * Runs the writes of one file one after the other. A writable stream starts from a copy of the
   * file taken when it is created and replaces the file on close, so two overlapping appends would
   * each start from the old content and the second close would drop the first one's data. The Vfs
   * already serialises the writes it is given; this protects callers that use the backend directly.
   */
  private inTurn(rel: string, write: () => Promise<void>): Promise<void> {
    const key = foldCase(rel);
    const before = this.writes.get(key) ?? Promise.resolve();
    const mine = before.then(write, write);
    const settled = mine.catch(() => {});
    this.writes.set(key, settled);
    void settled.then(() => {
      if (this.writes.get(key) === settled) this.writes.delete(key);
    });
    return mine;
  }

  /** The folder at rel, walking down from the root one checked segment at a time. */
  private async dir(rel: string, create: boolean): Promise<FsaDirectoryHandle> {
    let dir = this.handle;
    if (rel === '') return dir;
    for (const segment of rel.split('/')) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create });
      } catch (error) {
        throw toFsError(error, rel, 'dir', this.handle.name);
      }
    }
    return dir;
  }

  private async fileHandle(rel: string, create: boolean): Promise<FsaFileHandle> {
    const { parent, name } = splitRel(rel);
    const dir = await this.dir(parent, create);
    try {
      return await dir.getFileHandle(name, { create });
    } catch (error) {
      throw toFsError(error, rel, 'file', this.handle.name);
    }
  }
}

// ---- where the handles are kept ---------------------------------------------------------------------

export const HANDLE_DB_NAME = 'easy68k-fsaccess';
export const HANDLE_STORE_NAME = 'handles';
/** The key of the opened folder's record. */
export const FOLDER_KEY = 'folder';
/** How long opening the handle database may take before the port keeps handles in memory only. */
export const HANDLE_DB_TIMEOUT_MS = 3_000;

/** A small key-value store for handles (IndexedDB keeps FileSystemHandle objects, Chromium). */
export interface HandleStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** The record of the opened folder. */
export interface FolderRecord {
  handle: FsaDirectoryHandle;
  name: string;
}

/** For tests, and where IndexedDB cannot be used (the handles are then forgotten at a reload). */
export class MemoryHandleStore implements HandleStore {
  private readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/** The IndexedDB database `easy68k-fsaccess`, object store `handles`, key = a string. */
export class IndexedDbHandleStore implements HandleStore {
  private constructor(private readonly db: IDBDatabase) {
    db.onversionchange = () => db.close();
  }

  /** Opens the database; rejects when IndexedDB fails or takes longer than `timeoutMs`. */
  static open(
    factory: IDBFactory = globalThis.indexedDB,
    name = HANDLE_DB_NAME,
    timeoutMs = HANDLE_DB_TIMEOUT_MS,
  ): Promise<IndexedDbHandleStore> {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        done = true;
        reject(new Error('IndexedDB did not answer'));
      }, timeoutMs);
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(name, 1);
      } catch (error) {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(HANDLE_STORE_NAME)) {
          request.result.createObjectStore(HANDLE_STORE_NAME);
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (done) request.result.close();
        else resolve(new IndexedDbHandleStore(request.result));
      };
      request.onerror = () => {
        clearTimeout(timer);
        if (!done) reject(request.error ?? new Error('IndexedDB failed'));
      };
    });
  }

  get<T>(key: string): Promise<T | undefined> {
    return this.run<T | undefined>('readonly', (store) => store.get(key));
  }
  async put(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (store) => store.put(value, key));
  }
  async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key));
  }
  async keys(): Promise<string[]> {
    const keys = await this.run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    return keys.filter((key): key is string => typeof key === 'string');
  }

  close(): void {
    this.db.close();
  }

  /** One transaction; resolves with the request's result once the transaction has committed. */
  private run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(HANDLE_STORE_NAME, mode, { durability: 'strict' });
      const request = op(transaction.objectStore(HANDLE_STORE_NAME));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('IndexedDB failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
}

/** The handle store of the page: IndexedDB, or memory when IndexedDB cannot be opened. */
export async function openHandleStore(factory?: IDBFactory): Promise<HandleStore> {
  try {
    return await IndexedDbHandleStore.open(factory ?? globalThis.indexedDB);
  } catch {
    return new MemoryHandleStore();
  }
}

// ---- /linked ------------------------------------------------------------------------------------------

/** The record of one linked file, key `link:<id>`. */
export interface LinkRecord {
  id: string;
  /** The file's name as the browser gave it; the copy is `<id>/<name>`. */
  name: string;
  handle: FsaFileHandle;
  /** Size and modification time of the real file when this window last read or wrote it. */
  size: number;
  mtime: number;
}

export const LINK_KEY_PREFIX = 'link:';
export const LINKED_LABEL = 'Linked files';

export interface LinkedBackendDeps {
  /** Where the copies live: a browser store of its own (createStartupBackends). Its mount is ignored. */
  copies: FileSystemBackend;
  handles: HandleStore;
  /** A new id for a linked file's folder; default 8 random hexadecimal digits. */
  newId?: () => string;
}

function randomId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Single files opened from the student's computer (3.8.2, "Linked single file"). The folder
 * `/linked/<id>/` is a folder of a browser store; only its file `<name>` is tied to the real file:
 *
 * - stat() of it reports the real file's size and time while the browser grants read access, and
 *   otherwise the copy's size with the time last seen of the real file;
 * - readFile() reads the real file (and refreshes the copy) while access is granted, otherwise the
 *   copy;
 * - writeFile() writes the real file and then the copy. It asks the browser for write access first
 *   (which works within a click or key press, as Save is), and refuses when the real file's size or
 *   time differs from what this window last saw, so that another program's change is never
 *   overwritten without the question the documents ask (3.8.6 rule 3);
 * - remove() removes the copy and forgets the link; the real file stays where it is.
 *
 * Everything else in `/linked/<id>/` (listings, S-records, a program's files) lives in the copy store
 * only; the Files panel does not show /linked, and Export is how such a file leaves the browser.
 */
export class LinkedBackend implements FileSystemBackend {
  readonly mount = LINKED_MOUNT;
  readonly kind = 'fsaccess' as const;
  readonly label = LINKED_LABEL;

  private readonly copies: FileSystemBackend;
  private readonly handles: HandleStore;
  private readonly newId: () => string;
  private readonly records = new Map<string, LinkRecord>();

  constructor(deps: LinkedBackendDeps) {
    this.copies = deps.copies;
    this.handles = deps.handles;
    this.newId = deps.newId ?? randomId;
  }

  /**
   * Links a file the student picked and returns the path to open, `/linked/<id>/<name>`. A file
   * that is linked already keeps its folder (its copy is refreshed from the real file).
   */
  async link(handle: FsaFileHandle): Promise<string> {
    for (const record of await this.allRecords()) {
      const same = await Promise.resolve(record.handle.isSameEntry?.(handle)).catch(() => false);
      if (same === true) {
        await this.refresh(record, handle);
        return `/${LINKED_MOUNT}/${record.id}/${record.name}`;
      }
    }
    let id = this.newId();
    while ((await this.record(id)) !== null) id = this.newId();
    const record: LinkRecord = { id, name: handle.name, handle, size: 0, mtime: 0 };
    checkRel(`${id}/${handle.name}`, false);
    const { data, file } = await readWhole(handle).catch((error: unknown) => {
      throw toFsError(error, handle.name, 'file', handle.name);
    });
    await this.copies.writeFile(`${id}/${record.name}`, data);
    record.size = file.size;
    record.mtime = file.lastModified;
    await this.save(record);
    return `/${LINKED_MOUNT}/${id}/${record.name}`;
  }

  /** The link of a path of this mount (`<id>/...`), or null. */
  async linkOf(rel: string): Promise<LinkRecord | null> {
    const id = rel.split('/')[0] ?? '';
    return id === '' ? null : this.record(id);
  }

  async stat(rel: string): Promise<FileStat | null> {
    checkRel(rel, true);
    const record = await this.mainRecord(rel);
    if (!record) return this.copies.stat(rel);
    if (await hasPermission(record.handle, 'read', false)) {
      try {
        const file = await record.handle.getFile();
        await this.seen(record, file);
        return { kind: 'file', size: file.size, mtime: file.lastModified, readOnly: false };
      } catch (error) {
        if (errorName(error) === 'NotFoundError') return null;
        throw toFsError(error, rel, 'file', record.name);
      }
    }
    const copy = await this.copies.stat(rel);
    return copy ? { ...copy, mtime: record.mtime } : null;
  }

  async readFile(rel: string): Promise<Bytes> {
    checkRel(rel, true);
    const record = await this.mainRecord(rel);
    if (!record) return this.copies.readFile(rel);
    // Asked for read and write at once, so that a later Save needs no second question.
    if (
      (await hasPermission(record.handle, 'read', false)) ||
      (await hasPermission(record.handle, 'readwrite', true))
    ) {
      let read: { data: Bytes; file: FsaFile };
      try {
        read = await readWhole(record.handle);
      } catch (error) {
        throw toFsError(error, rel, 'file', record.name);
      }
      await this.copies.writeFile(rel, read.data).catch(() => {}); // the copy follows; the real file is what counts
      await this.seen(record, read.file);
      return read.data;
    }
    return this.copies.readFile(rel);
  }

  async writeFile(rel: string, data: Bytes): Promise<void> {
    checkRel(rel, false);
    const record = await this.mainRecord(rel);
    if (!record) return this.copies.writeFile(rel, data);
    await this.writeReal(record, rel, data.slice());
  }

  async appendFile(rel: string, data: Bytes): Promise<void> {
    checkRel(rel, false);
    const record = await this.mainRecord(rel);
    if (!record) return this.copies.appendFile(rel, data);
    const copy = data.slice();
    const before = await this.readFile(rel);
    const joined = new Uint8Array(before.length + copy.length);
    joined.set(before, 0);
    joined.set(copy, before.length);
    await this.writeReal(record, rel, joined);
  }

  async remove(rel: string): Promise<void> {
    checkRel(rel, false);
    const record = await this.linkOf(rel);
    const main = record !== null && (await this.mainRecord(rel)) !== null;
    await this.copies.remove(rel);
    if (record && (main || !rel.includes('/'))) await this.forget(record.id);
  }

  list(rel: string): Promise<DirEntry[]> {
    checkRel(rel, true);
    return this.copies.list(rel);
  }

  mkdirp(rel: string): Promise<void> {
    checkRel(rel, true);
    return this.copies.mkdirp(rel);
  }

  onExternalChange(listener: (change: BackendChange) => void): () => void {
    return this.copies.onExternalChange?.(listener) ?? (() => {});
  }

  // ---- internals ----------------------------------------------------------------------

  private async writeReal(record: LinkRecord, rel: string, data: Bytes): Promise<void> {
    if (!(await hasPermission(record.handle, 'readwrite', true))) {
      throw fsError('io', FSACCESS_MESSAGES.notAllowed(record.name));
    }
    let current: FsaFile;
    try {
      current = await record.handle.getFile();
    } catch (error) {
      if (errorName(error) === 'NotFoundError') throw fsError('io', FSACCESS_MESSAGES.linkedGone(record.name));
      throw toFsError(error, rel, 'file', record.name);
    }
    if (current.lastModified !== record.mtime || current.size !== record.size) {
      throw fsError('io', FSACCESS_MESSAGES.linkedChanged(record.name));
    }
    try {
      await writeWhole(record.handle, data);
      await this.seen(record, await record.handle.getFile());
    } catch (error) {
      throw toFsError(error, rel, 'file', record.name);
    }
    await this.copies.writeFile(rel, data).catch(() => {}); // the real file has it; the copy is refreshed on the next read
  }

  /** The record if rel names a linked file itself (`<id>/<name>`, letter case ignored), else null. */
  private async mainRecord(rel: string): Promise<LinkRecord | null> {
    const parts = rel.split('/');
    if (parts.length !== 2) return null;
    const record = await this.record(parts[0] as string);
    if (!record) return null;
    const name = parts[1] as string;
    return name === record.name || sameName(name, record.name) ? record : null;
  }

  private async record(id: string): Promise<LinkRecord | null> {
    const known = this.records.get(id);
    if (known) return known;
    let stored: LinkRecord | undefined;
    try {
      stored = await this.handles.get<LinkRecord>(`${LINK_KEY_PREFIX}${id}`);
    } catch {
      stored = undefined;
    }
    if (!stored || typeof stored !== 'object' || !stored.handle) return null;
    this.records.set(id, stored);
    return stored;
  }

  private async allRecords(): Promise<LinkRecord[]> {
    const keys = await this.handles.keys().catch((): string[] => []);
    const out: LinkRecord[] = [];
    for (const key of keys) {
      if (!key.startsWith(LINK_KEY_PREFIX)) continue;
      const record = await this.record(key.slice(LINK_KEY_PREFIX.length));
      if (record) out.push(record);
    }
    return out;
  }

  /** Re-links an already linked file: takes the newer handle and refreshes the copy. */
  private async refresh(record: LinkRecord, handle: FsaFileHandle): Promise<void> {
    record.handle = handle;
    try {
      const { data, file } = await readWhole(handle);
      await this.copies.writeFile(`${record.id}/${record.name}`, data);
      record.size = file.size;
      record.mtime = file.lastModified;
    } catch {
      // the copy stays as it was
    }
    await this.save(record);
  }

  /** Remembers the size and time of the real file this window has now read or written. */
  private async seen(record: LinkRecord, file: FsaFile): Promise<void> {
    if (record.size === file.size && record.mtime === file.lastModified) return;
    record.size = file.size;
    record.mtime = file.lastModified;
    await this.save(record);
  }

  private async save(record: LinkRecord): Promise<void> {
    this.records.set(record.id, record);
    try {
      await this.handles.put(`${LINK_KEY_PREFIX}${record.id}`, { ...record });
    } catch {
      // kept in memory for this page; after a reload the link is gone and its copy stays
    }
  }

  private async forget(id: string): Promise<void> {
    this.records.delete(id);
    await this.handles.delete(`${LINK_KEY_PREFIX}${id}`).catch(() => {});
  }
}

// ---- start-up ---------------------------------------------------------------------------------------

/** The browser store that holds the copies of linked files (a database of its own, not My Programs). */
export const LINKED_DB_NAME = 'easy68k-linked';
export const LINKED_CHANNEL_NAME = 'easy68k.linked';

/** The handle store of the page, opened once (createStartupBackends and the feature share it). */
let pageHandles: Promise<HandleStore> | null = null;
export function pageHandleStore(): Promise<HandleStore> {
  pageHandles ??= openHandleStore();
  return pageHandles;
}

/** The copy store of linked files: IndexedDB `easy68k-linked`, or memory when that fails. */
export async function openLinkedCopies(): Promise<FileSystemBackend> {
  // Its own channel: the windows' copy stores talk to each other, never to My Programs.
  const channel =
    typeof BroadcastChannel === 'function'
      ? (): ChannelLike => new BroadcastChannel(LINKED_CHANNEL_NAME) as unknown as ChannelLike
      : null;
  try {
    return await openStartupStore({ dbName: LINKED_DB_NAME, label: LINKED_LABEL, channel });
  } catch {
    return new MemoryBackend({ mount: LINKED_MOUNT, kind: 'memory', label: LINKED_LABEL });
  }
}

/** The stored folder, or null. */
export async function storedFolder(handles: HandleStore): Promise<FolderRecord | null> {
  try {
    const record = await handles.get<FolderRecord>(FOLDER_KEY);
    return record && typeof record === 'object' && record.handle?.kind === 'directory' ? record : null;
  } catch {
    return null;
  }
}

/**
 * The backends main.tsx mounts at start (it picks up every `fs/*-backend.ts` by this name): in a
 * browser with the File System Access API, the linked files, and the opened folder of the last
 * visit when the browser still grants access to it (otherwise the feature offers to open it again).
 * Elsewhere nothing, without touching any storage.
 */
export async function createStartupBackends(platform: Platform): Promise<FileSystemBackend[]> {
  if (platform.kind !== 'web' || !fsAccessSupported()) return [];
  const handles = await pageHandleStore();
  const backends: FileSystemBackend[] = [new LinkedBackend({ copies: await openLinkedCopies(), handles })];
  const folder = await storedFolder(handles);
  if (folder && (await hasPermission(folder.handle, 'readwrite', false))) {
    backends.push(new FolderBackend(folder.handle));
  }
  return backends;
}
