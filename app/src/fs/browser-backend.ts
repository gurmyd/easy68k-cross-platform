// The browser store (ARCHITECTURE.md 3.8.1, 3.8.6): the backend mounted at "/browser", where
// students keep their programs when the port runs in a browser ("My Programs").
//
//     const backend = await BrowserBackend.open();          // IndexedDB of the page
//     vfs.mount(backend);
//
// Storage: the IndexedDB database `easy68k-files`, object store `files`, with out-of-line keys.
// Four kinds of record live in it (docs/porting/errata/FS1.md, entry 1):
//
//   key "<rel>"                 { data: Uint8Array, mtime }   the file's bytes (3.8.1: key = path)
//   key ["h", "<rel>"]          { size, mtime, segs }         the file's head: size, time, segments
//   key ["s", "<rel>", n]       { data: Uint8Array }          appended segment n (1, 2, ...)
//   key ["d", "<rel>"]          { mtime }                     a folder
//
// - A file exists when its head exists. Heads and folders are small, so the in-memory index that
//   answers stat() and list() is loaded at start by reading only those records.
// - appendFile writes one segment record and the head: its cost depends on the appended bytes,
//   never on the file's size. Segments are merged into the file record on the next read (in a
//   transaction of its own, after the read has returned), on the next whole-file write, and as
//   soon as a file has more than MAX_SEGMENTS of them.
// - Every operation is one IndexedDB transaction, so a file is never half written, also when the
//   page dies in the middle or two windows write at once (IndexedDB runs overlapping read-write
//   transactions one after the other, in every window of the origin). A write resolves when its
//   transaction has committed with durability "strict": an acknowledged write is on disk.
// - After every write and remove the backend posts { rel, kind, mtime } on the BroadcastChannel
//   `easy68k.files` (3.8.6 rule 3). Other windows re-read the records below `rel`, update their
//   index and report the change through onExternalChange.
// - Failures reject with an FsError (fs/vfs.ts). A full or blocked storage gives code 'io' and a
//   message a student can act on (STORE_MESSAGES); listeners of onProblem() hear about it too.
//
// createStartupBackends(platform) is what main.tsx mounts at start. Where IndexedDB cannot be
// opened (some private windows, storage blocked for the site) it returns a memory store at
// "/browser" instead, which storageProblem() identifies, so that the Files panel can say plainly
// that nothing is being kept. Start-up waits at most START_WAIT_MS for the database; a store that
// has not answered by then is mounted as a PendingBrowserStore, whose operations wait for it (up to
// OPEN_TIMEOUT_MS, after which it becomes the memory stand-in), so the application is shown at once.
// The time limit covers the reading of the index as well as indexedDB.open, so no wait at start is
// unbounded, not even behind a transaction the browser keeps for a page that died (errata entry 29).
//
// Owner: FS1.

import type { BackendChange, Bytes, DirEntry, FileStat, FileSystemBackend, FsError, Platform } from '../contracts';
import { MemoryBackend } from './memory-backend';
import { fsError, isFsError } from './vfs';

export const BROWSER_DB_NAME = 'easy68k-files';
export const BROWSER_STORE_NAME = 'files';
export const BROWSER_CHANNEL_NAME = 'easy68k.files';
export const BROWSER_STORE_LABEL = 'My Programs';
/** A file with more appended segments than this is merged at once (3.8.1). */
export const MAX_SEGMENTS = 256;
/**
 * How long opening the database and reading its index may take together before the port gives up
 * and keeps files in memory (also when the index waits behind a transaction of a page that died).
 */
export const OPEN_TIMEOUT_MS = 20_000;
/**
 * How long start-up waits for the database before the application is shown anyway. A store that
 * answers later is mounted as a PendingBrowserStore, whose operations wait for it.
 */
export const START_WAIT_MS = 3_000;

/** The texts the port shows when the store cannot keep a file. */
export const STORE_MESSAGES = {
  full: (rel: string) =>
    `The browser's storage for this site is full, so "${rel}" was not saved. ` +
    'Nothing that was saved before has been lost. Delete files you no longer need in the Files panel, ' +
    'or use Export... to keep a copy on this computer, then save again.',
  failed: (rel: string, detail: string) =>
    `The browser could not save "${rel}" (${detail}). Nothing that was saved before has been lost. ` +
    'Use Export... in the Files panel to keep a copy on this computer.',
  closed: 'The browser closed the file store (site data may have been cleared). Reload the page to continue.',
  opening:
    'My Programs is still opening: the browser has not answered yet (another tab of this site may be ' +
    'holding the storage). Your files appear here as soon as it answers; what you open or save meanwhile waits for it.',
  unavailable: (detail: string) =>
    'Files are NOT being saved: this browser does not let the page keep files ' +
    `(${detail.replace(/\.$/, '')}; for example in a private window, or when storage is blocked for this site). ` +
    'Everything you save is lost when this tab closes. Use Export... in the Files panel to keep your work.',
} as const;

/** Something went wrong in a way the user must hear about (the Files feature shows it). */
export interface StoreProblem {
  kind: 'full' | 'failed' | 'closed';
  rel: string;
  message: string;
}

/** What the backend needs from its surroundings; every member has a browser default. */
export interface BrowserBackendDeps {
  indexedDB?: IDBFactory;
  /** The IDBKeyRange class of the same IndexedDB implementation. */
  keyRange?: typeof IDBKeyRange;
  /** A BroadcastChannel (or a stand-in); null = this backend hears of no other window. */
  channel?: ((name: string) => ChannelLike) | null;
  /** Clock for modification times (milliseconds). */
  now?: () => number;
  dbName?: string;
  label?: string;
  /** Milliseconds before open() gives up; default OPEN_TIMEOUT_MS. */
  openTimeoutMs?: number;
}

/** The part of BroadcastChannel the backend uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** What one window tells the others after a change (3.8.6 rule 3). */
export interface StoreBroadcast {
  rel: string;
  kind: 'write' | 'remove';
  mtime: number;
}

interface FileMeta {
  kind: 'file';
  size: number;
  mtime: number;
  segs: number;
}
interface DirMeta {
  kind: 'dir';
  mtime: number;
}
type Meta = FileMeta | DirMeta;

interface HeadRecord {
  size: number;
  mtime: number;
  segs: number;
}
interface FileRecord {
  data: Uint8Array;
  mtime: number;
}
interface SegmentRecord {
  data: Uint8Array;
}
interface DirRecord {
  mtime: number;
}

/** The object store as the backend's transactions use it (see BrowserBackend.transaction). */
interface StoreOps {
  get(key: IDBValidKey): IDBRequest;
  getAll(query: IDBKeyRange): IDBRequest<unknown[]>;
  openCursor(query: IDBKeyRange): IDBRequest<IDBCursorWithValue | null>;
  put(value: unknown, key: IDBValidKey): void;
  delete(key: IDBValidKey | IDBKeyRange): void;
}

const headKey = (rel: string): IDBValidKey => ['h', rel];
const dirKey = (rel: string): IDBValidKey => ['d', rel];
const segKey = (rel: string, n: number): IDBValidKey => ['s', rel, n];

/** Every proper ancestor folder of rel, outermost first: "a/b/c" -> ["a", "a/b"]. */
function ancestors(rel: string): string[] {
  const parts = rel.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

function parentOf(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return slash < 0 ? '' : rel.slice(0, slash);
}

function nameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

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

function concat(parts: readonly Uint8Array[], size?: number): Uint8Array {
  const total = size ?? parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function errorName(error: unknown): string {
  return (error as { name?: unknown } | null)?.name === undefined ? 'Error' : String((error as { name: unknown }).name);
}

function isQuota(error: unknown): boolean {
  const name = errorName(error);
  return name === 'QuotaExceededError' || (error as { code?: unknown } | null)?.code === 22;
}

/**
 * The browser store. Create it with BrowserBackend.open(); close() ends it (tests, a second store
 * in one page).
 */
export class BrowserBackend implements FileSystemBackend {
  readonly mount = 'browser';
  readonly kind = 'browser' as const;
  readonly label: string;

  private readonly index = new Map<string, Meta>();
  private readonly children = new Map<string, Set<string>>();
  private readonly listeners = new Set<(change: BackendChange) => void>();
  private readonly problemListeners = new Set<(problem: StoreProblem) => void>();
  private readonly channel: ChannelLike | null;
  private readonly clock: () => number;
  private lastTime = 0;
  private closed = false;
  /** Index refreshes for changes of other windows, one after the other. */
  private refreshes: Promise<void> = Promise.resolve();
  /** Merges running in the background, so that close() can wait for them. */
  private readonly background = new Set<Promise<void>>();
  private readonly merging = new Set<string>();

  private constructor(
    private readonly db: IDBDatabase,
    private readonly range: typeof IDBKeyRange,
    deps: BrowserBackendDeps,
  ) {
    this.label = deps.label ?? BROWSER_STORE_LABEL;
    this.clock = deps.now ?? (() => Date.now());
    this.index.set('', { kind: 'dir', mtime: this.time() });
    this.children.set('', new Set());
    db.onversionchange = () => {
      // Another page wants a newer database version: let it have it.
      db.close();
      this.closed = true;
    };
    db.onclose = () => {
      this.closed = true;
      this.problem({ kind: 'closed', rel: '', message: STORE_MESSAGES.closed });
    };
    const make = deps.channel === undefined ? defaultChannel : deps.channel;
    this.channel = make ? make(BROWSER_CHANNEL_NAME) : null;
    if (this.channel) {
      this.channel.onmessage = (event) => this.received(event.data);
    }
  }

  /**
   * Opens (and if need be creates) the store and loads its index. Rejects if IndexedDB fails, or
   * if the two together take longer than `openTimeoutMs` (OPEN_TIMEOUT_MS): the time limit covers
   * the reading of the index too, because a read-write transaction that the browser still keeps for
   * a page that died in the middle of a write holds up every later transaction on the store, for
   * as long as the browser keeps it (CI run 45034021673; docs/porting/errata/FS1.md entry 29). The
   * rejection names the step that waited. A database or an index that answers after the time limit
   * is closed at once.
   */
  static async open(deps: BrowserBackendDeps = {}): Promise<BrowserBackend> {
    const factory = deps.indexedDB ?? globalThis.indexedDB;
    const range = deps.keyRange ?? globalThis.IDBKeyRange;
    if (!factory || !range) throw fsError('io', 'IndexedDB does not exist here');
    const timeoutMs = deps.openTimeoutMs ?? OPEN_TIMEOUT_MS;
    let step: 'opening the database' | 'reading the list of files' = 'opening the database';
    let gaveUp = false;
    let backend: BrowserBackend | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        gaveUp = true;
        backend?.abandon();
        reject(fsError('io', `${step} took longer than ${timeoutMs / 1000} s`));
      }, timeoutMs);
    });
    const opening = (async () => {
      const db = await openDatabase(factory, deps.dbName ?? BROWSER_DB_NAME, () => gaveUp);
      backend = new BrowserBackend(db, range, deps);
      step = 'reading the list of files';
      try {
        await backend.loadIndex();
      } catch (error) {
        backend.abandon();
        throw error;
      }
      if (gaveUp) backend.abandon(); // answered too late: the page already runs without the store
      return backend;
    })();
    opening.catch(() => {}); // after the time limit its outcome is not wanted
    try {
      return await Promise.race([opening, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- FileSystemBackend --------------------------------------------------------------------

  async stat(rel: string): Promise<FileStat | null> {
    checkRel(rel, true);
    const meta = this.index.get(rel);
    if (!meta) return null;
    return meta.kind === 'file'
      ? { kind: 'file', size: meta.size, mtime: meta.mtime, readOnly: false }
      : { kind: 'dir', size: 0, mtime: meta.mtime, readOnly: false };
  }

  async readFile(rel: string): Promise<Bytes> {
    checkRel(rel, true);
    if (rel === '') throw fsError('is-directory', 'the root is a folder');
    const result = await this.transaction<{ data: Uint8Array; segs: number }>('readonly', rel, (store, t) => {
      const head = store.get(headKey(rel));
      const dir = store.get(dirKey(rel));
      const file = store.get(rel);
      const segments = store.getAll(this.segRange(rel));
      segments.onsuccess = () => {
        const h = head.result as HeadRecord | undefined;
        if (!h) {
          t.fail(
            dir.result ? fsError('is-directory', `is a folder: ${rel}`) : fsError('not-found', `no such file: ${rel}`),
          );
          return;
        }
        const base = (file.result as FileRecord | undefined)?.data ?? new Uint8Array(0);
        const segs = segments.result as SegmentRecord[];
        t.done({ data: segs.length === 0 ? base : concat([base, ...segs.map((s) => s.data)]), segs: segs.length });
      };
    });
    if (result.segs > 0) this.scheduleMerge(rel);
    return result.data;
  }

  async writeFile(rel: string, data: Bytes): Promise<void> {
    checkRel(rel, false);
    const copy = data.slice();
    const mtime = this.time();
    const created = await this.transaction<string[]>('readwrite', rel, (store, t) => {
      this.prepareParents(store, t, rel, mtime, (createdDirs) => {
        store.delete(this.segRange(rel));
        store.put({ data: copy, mtime } satisfies FileRecord, rel);
        store.put({ size: copy.length, mtime, segs: 0 } satisfies HeadRecord, headKey(rel));
        t.done(createdDirs);
      });
    });
    this.addDirs(created, mtime);
    this.setMeta(rel, { kind: 'file', size: copy.length, mtime, segs: 0 });
    this.broadcast({ rel, kind: 'write', mtime });
  }

  async appendFile(rel: string, data: Bytes): Promise<void> {
    checkRel(rel, false);
    const copy = data.slice();
    const mtime = this.time();
    const { created, head } = await this.transaction<{ created: string[]; head: HeadRecord }>(
      'readwrite',
      rel,
      (store, t) => {
        this.prepareParents(store, t, rel, mtime, (createdDirs) => {
          const request = store.get(headKey(rel));
          request.onsuccess = () => {
            const old = request.result as HeadRecord | undefined;
            if (!old) store.put({ data: new Uint8Array(0), mtime } satisfies FileRecord, rel);
            const head: HeadRecord = { size: old?.size ?? 0, mtime, segs: old?.segs ?? 0 };
            if (copy.length > 0) {
              head.segs += 1;
              head.size += copy.length;
              store.put({ data: copy } satisfies SegmentRecord, segKey(rel, head.segs));
            }
            store.put(head, headKey(rel));
            t.done({ created: createdDirs, head });
          };
        });
      },
    );
    this.addDirs(created, mtime);
    this.setMeta(rel, { kind: 'file', size: head.size, mtime: head.mtime, segs: head.segs });
    this.broadcast({ rel, kind: 'write', mtime });
    if (head.segs > MAX_SEGMENTS) this.scheduleMerge(rel);
  }

  async remove(rel: string): Promise<void> {
    checkRel(rel, false);
    const mtime = this.time();
    await this.transaction<void>('readwrite', rel, (store, t) => {
      const head = store.get(headKey(rel));
      const dir = store.get(dirKey(rel));
      dir.onsuccess = () => {
        if (head.result) {
          store.delete(rel);
          store.delete(headKey(rel));
          store.delete(this.segRange(rel));
        } else if (dir.result) {
          store.delete(dirKey(rel));
          const { range } = this;
          const lo = `${rel}/`;
          const hi = `${rel}0`; // '0' is the character after '/'
          store.delete(range.bound(lo, hi, false, true));
          store.delete(range.bound(['h', lo], ['h', hi], false, true));
          store.delete(range.bound(['d', lo], ['d', hi], false, true));
          store.delete(range.bound(['s', lo], ['s', hi], false, true));
        } else {
          t.fail(fsError('not-found', `no such file or folder: ${rel}`));
          return;
        }
        t.done();
      };
    });
    this.dropSubtree(rel);
    this.broadcast({ rel, kind: 'remove', mtime });
  }

  async list(rel: string): Promise<DirEntry[]> {
    checkRel(rel, true);
    const meta = this.index.get(rel);
    if (!meta) throw fsError('not-found', `no such folder: ${rel}`);
    if (meta.kind === 'file') throw fsError('not-directory', `not a folder: ${rel}`);
    const prefix = rel === '' ? '' : `${rel}/`;
    const entries: DirEntry[] = [];
    for (const name of this.children.get(rel) ?? []) {
      const child = this.index.get(prefix + name);
      if (child) entries.push({ name, kind: child.kind });
    }
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async mkdirp(rel: string): Promise<void> {
    checkRel(rel, true);
    if (rel === '') return;
    const meta = this.index.get(rel);
    if (meta?.kind === 'dir') return;
    const mtime = this.time();
    const created = await this.transaction<string[]>('readwrite', rel, (store, t) => {
      this.prepareFolders(store, t, [...ancestors(rel), rel], mtime, (dirs) => t.done(dirs));
    });
    this.addDirs(created, mtime);
    if (created.length > 0) this.broadcast({ rel, kind: 'write', mtime });
  }

  onExternalChange(listener: (change: BackendChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---- beyond the contract --------------------------------------------------------------------

  /** Problems the user must be told about (storage full, store closed by the browser). */
  onProblem(listener: (problem: StoreProblem) => void): () => void {
    this.problemListeners.add(listener);
    return () => {
      this.problemListeners.delete(listener);
    };
  }

  /** Resolves when background merges and index refreshes have finished. */
  async idle(): Promise<void> {
    for (;;) {
      const refreshes = this.refreshes;
      await Promise.all([...this.background, refreshes]);
      if (this.background.size === 0 && refreshes === this.refreshes) return;
    }
  }

  /** Waits for background work, then closes the channel and the database. */
  async close(): Promise<void> {
    await this.idle().catch(() => {});
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
    this.closed = true;
    this.db.onclose = null;
    this.db.close();
  }

  /**
   * Ends a store that open() gave up on, without waiting: nothing has used it yet. IDBDatabase.close
   * lets a transaction already made (the index's) finish and then closes the connection, so that it
   * holds up no version change of another page.
   */
  private abandon(): void {
    this.closed = true;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
    this.db.onclose = null;
    this.db.close();
  }

  /** Number of appended segments of a file not merged yet (tests). */
  segmentsOf(rel: string): number {
    const meta = this.index.get(rel);
    return meta?.kind === 'file' ? meta.segs : 0;
  }

  // ---- internals ------------------------------------------------------------------------------

  private time(): number {
    this.lastTime = Math.max(Math.floor(this.clock()), this.lastTime + 1);
    return this.lastTime;
  }

  private segRange(rel: string): IDBKeyRange {
    return this.range.bound(segKey(rel, 0), segKey(rel, Infinity));
  }

  /**
   * Runs `body` in one transaction. The body finishes it with t.done(value) or t.fail(error); the
   * promise settles when the transaction has completed (committed) or aborted.
   */
  private transaction<T>(
    mode: IDBTransactionMode,
    rel: string,
    body: (store: StoreOps, t: { done(value: T): void; fail(error: FsError): void }) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed) {
        reject(fsError('io', STORE_MESSAGES.closed));
        return;
      }
      let tx: IDBTransaction;
      try {
        tx =
          mode === 'readwrite'
            ? this.db.transaction(BROWSER_STORE_NAME, mode, { durability: 'strict' })
            : this.db.transaction(BROWSER_STORE_NAME, mode);
      } catch (error) {
        reject(this.translate(error, rel, mode));
        return;
      }
      let result: { value: T } | null = null;
      let failure: FsError | null = null;
      tx.oncomplete = () => {
        if (failure) reject(failure);
        else if (result) resolve(result.value);
        else reject(fsError('io', `internal error: the transaction for "${rel}" ended without a result`));
      };
      tx.onabort = () => reject(failure ?? this.translate(tx.error, rel, mode));
      // A request error aborts the transaction; onabort reports it.
      tx.onerror = (event) => {
        if (!failure && isQuota((event.target as IDBRequest | null)?.error)) {
          failure = this.translate((event.target as IDBRequest).error, rel, mode);
        }
      };
      const fail = (error: FsError) => {
        if (failure) return;
        failure = error;
        try {
          tx.abort();
        } catch {
          // already finished
        }
      };
      try {
        const store = tx.objectStore(BROWSER_STORE_NAME);
        // Writes that throw (quota in some browsers, a closed store) fail the transaction cleanly
        // instead of escaping from a request callback.
        const ops: StoreOps = {
          get: (key) => store.get(key),
          getAll: (query) => store.getAll(query),
          openCursor: (query) => store.openCursor(query),
          put: (value, key) => {
            if (failure) return;
            try {
              store.put(value, key);
            } catch (error) {
              fail(this.translate(error, rel, mode));
            }
          },
          delete: (key) => {
            if (failure) return;
            try {
              store.delete(key);
            } catch (error) {
              fail(this.translate(error, rel, mode));
            }
          },
        };
        body(ops, {
          done: (value: T) => {
            if (!failure) result = { value };
          },
          fail,
        });
      } catch (error) {
        failure = isFsError(error) ? error : this.translate(error, rel, mode);
        try {
          tx.abort();
        } catch {
          // already finished
        }
      }
    });
  }

  /** An FsError for an IndexedDB failure; storage problems are also told to onProblem listeners. */
  private translate(error: unknown, rel: string, mode: IDBTransactionMode): FsError {
    if (isFsError(error)) return error;
    if (isQuota(error)) {
      const message = STORE_MESSAGES.full(rel);
      this.problem({ kind: 'full', rel, message });
      return fsError('io', message);
    }
    if (this.closed || errorName(error) === 'InvalidStateError') {
      return fsError('io', STORE_MESSAGES.closed);
    }
    const detail = `${errorName(error)}: ${(error as { message?: unknown } | null)?.message ?? String(error)}`;
    const message = STORE_MESSAGES.failed(rel, detail);
    if (mode === 'readwrite') this.problem({ kind: 'failed', rel, message });
    return fsError('io', message);
  }

  private problem(problem: StoreProblem): void {
    for (const listener of [...this.problemListeners]) {
      try {
        listener(problem);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  /**
   * Checks inside a transaction that `rel` may be written as a file: it is not a folder, and no
   * ancestor is a file. Creates the missing ancestor folders. Then calls next(created folders).
   */
  private prepareParents(
    store: StoreOps,
    t: { fail(error: FsError): void },
    rel: string,
    mtime: number,
    next: (created: string[]) => void,
  ): void {
    const dir = store.get(dirKey(rel));
    dir.onsuccess = () => {
      if (dir.result) {
        t.fail(fsError('is-directory', `is a folder: ${rel}`));
        return;
      }
      this.prepareFolders(store, t, ancestors(rel), mtime, next);
    };
  }

  /** Makes sure each of `folders` (outermost first) is a folder; fails if one is a file. */
  private prepareFolders(
    store: StoreOps,
    t: { fail(error: FsError): void },
    folders: readonly string[],
    mtime: number,
    next: (created: string[]) => void,
  ): void {
    if (folders.length === 0) {
      next([]);
      return;
    }
    const heads = folders.map((folder) => store.get(headKey(folder)));
    const dirs = folders.map((folder) => store.get(dirKey(folder)));
    // Requests of one transaction complete in the order they were made: the last one is last.
    (dirs[dirs.length - 1] as IDBRequest).onsuccess = () => {
      const created: string[] = [];
      const time = mtime;
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i] as string;
        if ((heads[i] as IDBRequest).result) {
          t.fail(fsError('not-directory', `not a folder: ${folder}`));
          return;
        }
        if (!(dirs[i] as IDBRequest).result) {
          store.put({ mtime: time } satisfies DirRecord, dirKey(folder));
          created.push(folder);
        }
      }
      next(created);
    };
  }

  private setMeta(rel: string, meta: Meta): void {
    this.index.set(rel, meta);
    if (rel === '') return;
    const parent = parentOf(rel);
    let set = this.children.get(parent);
    if (!set) {
      set = new Set();
      this.children.set(parent, set);
    }
    set.add(nameOf(rel));
    if (meta.kind === 'dir' && !this.children.has(rel)) this.children.set(rel, new Set());
  }

  private addDirs(dirs: readonly string[], mtime: number): void {
    for (const dir of dirs) if (this.index.get(dir)?.kind !== 'dir') this.setMeta(dir, { kind: 'dir', mtime });
  }

  /** Forgets rel and everything below it. */
  private dropSubtree(rel: string): void {
    const meta = this.index.get(rel);
    if (!meta) return;
    if (meta.kind === 'dir') {
      for (const name of [...(this.children.get(rel) ?? [])]) this.dropSubtree(`${rel}/${name}`);
      this.children.delete(rel);
    }
    this.index.delete(rel);
    this.children.get(parentOf(rel))?.delete(nameOf(rel));
  }

  /** Reads the heads and folders at and below `rel` (all of them for ''). */
  private readSubtree(store: StoreOps, rel: string, done: (metas: Map<string, Meta>) => void): void {
    const metas = new Map<string, Meta>();
    const { range } = this;
    const collect = (cursorRange: IDBKeyRange, next: () => void) => {
      const request = store.openCursor(cursorRange);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          next();
          return;
        }
        const key = cursor.key as [string, string];
        if (key[0] === 'h') {
          const head = cursor.value as HeadRecord;
          metas.set(key[1], { kind: 'file', size: head.size, mtime: head.mtime, segs: head.segs });
        } else {
          metas.set(key[1], { kind: 'dir', mtime: (cursor.value as DirRecord).mtime });
        }
        cursor.continue();
      };
    };
    if (rel === '') {
      collect(range.bound(['d'], ['e'], false, true), () =>
        collect(range.bound(['h'], ['i'], false, true), () => done(metas)),
      );
      return;
    }
    const lo = `${rel}/`;
    const hi = `${rel}0`;
    const head = store.get(headKey(rel));
    const dir = store.get(dirKey(rel));
    dir.onsuccess = () => {
      if (head.result) {
        const h = head.result as HeadRecord;
        metas.set(rel, { kind: 'file', size: h.size, mtime: h.mtime, segs: h.segs });
      } else if (dir.result) {
        metas.set(rel, { kind: 'dir', mtime: (dir.result as DirRecord).mtime });
      }
      collect(range.bound(['d', lo], ['d', hi], false, true), () =>
        collect(range.bound(['h', lo], ['h', hi], false, true), () => done(metas)),
      );
    };
  }

  /** Puts what readSubtree found for `rel` into the index, replacing what was there. */
  private applySubtree(rel: string, metas: Map<string, Meta>): void {
    if (rel === '') {
      for (const name of [...(this.children.get('') ?? [])]) this.dropSubtree(name);
    } else {
      this.dropSubtree(rel);
    }
    // Folders first, outermost first, so that every parent exists before its children.
    const entries = [...metas.entries()].sort(([a, ma], [b, mb]) =>
      ma.kind !== mb.kind ? (ma.kind === 'dir' ? -1 : 1) : a.split('/').length - b.split('/').length,
    );
    for (const [path, meta] of entries) {
      for (const ancestor of ancestors(path)) {
        if (!this.index.has(ancestor)) this.setMeta(ancestor, { kind: 'dir', mtime: meta.mtime });
      }
      this.setMeta(path, meta);
    }
  }

  private async loadIndex(): Promise<void> {
    const metas = await this.transaction<Map<string, Meta>>('readonly', '', (store, t) => {
      this.readSubtree(store, '', (found) => t.done(found));
    });
    this.applySubtree('', metas);
  }

  private broadcast(message: StoreBroadcast): void {
    if (!this.channel || this.closed) return;
    try {
      this.channel.postMessage(message);
    } catch {
      // A closed channel: the other windows will see the change at their next start.
    }
  }

  /** A message of another window: re-read what changed, then tell the listeners. */
  private received(data: unknown): void {
    const message = data as Partial<StoreBroadcast> | null;
    if (!message || typeof message.rel !== 'string' || (message.kind !== 'write' && message.kind !== 'remove')) return;
    const rel = message.rel;
    const kind = message.kind;
    try {
      checkRel(rel, false);
    } catch {
      return;
    }
    this.refreshes = this.refreshes.then(async () => {
      if (this.closed) return;
      try {
        const metas = await this.transaction<Map<string, Meta>>('readonly', rel, (store, t) => {
          this.readSubtree(store, rel, (found) => t.done(found));
        });
        this.applySubtree(rel, metas);
      } catch {
        return; // the store is gone; nothing to report
      }
      for (const listener of [...this.listeners]) {
        try {
          listener({ rel, kind });
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    });
  }

  /** Merges the segments of a file into its file record, in the background. */
  private scheduleMerge(rel: string): void {
    if (this.merging.has(rel) || this.closed) return;
    this.merging.add(rel);
    const work = this.merge(rel)
      .catch(() => {
        // Nothing is lost when a merge fails (storage full): the segments stay as they are.
      })
      .finally(() => {
        this.merging.delete(rel);
        this.background.delete(work);
      });
    this.background.add(work);
  }

  private async merge(rel: string): Promise<void> {
    const merged = await this.transaction<HeadRecord | null>('readwrite', rel, (store, t) => {
      const head = store.get(headKey(rel));
      const file = store.get(rel);
      const segments = store.getAll(this.segRange(rel));
      segments.onsuccess = () => {
        const h = head.result as HeadRecord | undefined;
        const segs = segments.result as SegmentRecord[];
        if (!h || segs.length === 0) {
          t.done(null);
          return;
        }
        const base = (file.result as FileRecord | undefined)?.data ?? new Uint8Array(0);
        const data = concat([base, ...segs.map((s) => s.data)]);
        store.put({ data, mtime: h.mtime } satisfies FileRecord, rel);
        store.delete(this.segRange(rel));
        const next: HeadRecord = { size: data.length, mtime: h.mtime, segs: 0 };
        store.put(next, headKey(rel));
        t.done(next);
      };
    });
    if (merged) {
      const meta = this.index.get(rel);
      if (meta?.kind === 'file' && meta.mtime === merged.mtime) meta.segs = 0;
    }
  }
}

function defaultChannel(name: string): ChannelLike {
  if (typeof BroadcastChannel === 'undefined') {
    return { postMessage: () => {}, close: () => {}, onmessage: null };
  }
  return new BroadcastChannel(name) as unknown as ChannelLike;
}

/**
 * Opens the database. The time limit is BrowserBackend.open's; `tooLate()` says that it has passed,
 * and a database that answers after it is closed at once.
 */
function openDatabase(factory: IDBFactory, name: string, tooLate: () => boolean): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, 1);
    } catch (error) {
      finish(() => reject(fsError('io', `${errorName(error)}: ${String((error as Error)?.message ?? error)}`)));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BROWSER_STORE_NAME)) db.createObjectStore(BROWSER_STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (tooLate()) {
        db.close(); // too late: the page already runs without the store
        finish(() => reject(fsError('io', 'the database answered after the time limit')));
        return;
      }
      finish(() => resolve(db));
    };
    request.onerror = () => {
      const error = request.error;
      finish(() => reject(fsError('io', `${errorName(error)}: ${error?.message ?? 'unknown error'}`)));
    };
    request.onblocked = () => {
      // An older version is open elsewhere; the open continues once that page lets go.
    };
  });
}

// ---- when IndexedDB cannot be used ------------------------------------------------------------------

/** The store of a page where IndexedDB failed: files live in memory until the tab closes. */
export class UnsavedBrowserStore extends MemoryBackend {
  readonly problem: string;
  constructor(detail: string) {
    super({ mount: 'browser', kind: 'browser', label: BROWSER_STORE_LABEL });
    this.problem = STORE_MESSAGES.unavailable(detail);
  }
}

/**
 * The browser store while the database has not answered yet (START_WAIT_MS passed at start-up).
 * Every operation waits for the store that opening finally gives - the real BrowserBackend, or
 * the UnsavedBrowserStore when opening fails or times out (OPEN_TIMEOUT_MS) - and then goes to it.
 * Listeners of external changes and problems are passed on to that store.
 */
export class PendingBrowserStore implements FileSystemBackend {
  readonly mount = 'browser';
  readonly kind = 'browser' as const;
  readonly label: string;
  private target: FileSystemBackend | null = null;
  private readonly ready: Promise<FileSystemBackend>;
  private readonly changeListeners = new Set<(change: BackendChange) => void>();
  private readonly problemListeners = new Set<(problem: StoreProblem) => void>();
  private readonly settledListeners = new Set<() => void>();

  /** `opening` must not reject (openBrowserStore never does). */
  constructor(opening: Promise<FileSystemBackend>, label = BROWSER_STORE_LABEL) {
    this.label = label;
    this.ready = opening.then((backend) => {
      this.target = backend;
      backend.onExternalChange?.((change) => {
        for (const listener of [...this.changeListeners]) listener(change);
      });
      if (backend instanceof BrowserBackend) {
        backend.onProblem((problem) => {
          for (const listener of [...this.problemListeners]) listener(problem);
        });
      }
      for (const listener of [...this.settledListeners]) {
        try {
          listener();
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
      this.settledListeners.clear();
      return backend;
    });
  }

  /** The store opening gave, or null while it has not answered. */
  get current(): FileSystemBackend | null {
    return this.target;
  }

  /** Resolves with the store opening gave. */
  whenReady(): Promise<FileSystemBackend> {
    return this.ready;
  }

  /** Called once when opening has given its store (at once if it already has). */
  onSettled(listener: () => void): () => void {
    if (this.target) {
      queueMicrotask(listener);
      return () => {};
    }
    this.settledListeners.add(listener);
    return () => {
      this.settledListeners.delete(listener);
    };
  }

  async stat(rel: string): Promise<FileStat | null> {
    return (await this.ready).stat(rel);
  }
  async readFile(rel: string): Promise<Bytes> {
    return (await this.ready).readFile(rel);
  }
  async writeFile(rel: string, data: Bytes): Promise<void> {
    return (await this.ready).writeFile(rel, data);
  }
  async appendFile(rel: string, data: Bytes): Promise<void> {
    return (await this.ready).appendFile(rel, data);
  }
  async remove(rel: string): Promise<void> {
    return (await this.ready).remove(rel);
  }
  async list(rel: string): Promise<DirEntry[]> {
    return (await this.ready).list(rel);
  }
  async mkdirp(rel: string): Promise<void> {
    return (await this.ready).mkdirp(rel);
  }

  onExternalChange(listener: (change: BackendChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /** As BrowserBackend.onProblem, once the real store is there. */
  onProblem(listener: (problem: StoreProblem) => void): () => void {
    this.problemListeners.add(listener);
    return () => {
      this.problemListeners.delete(listener);
    };
  }
}

/**
 * The message to show about the backend mounted at /browser: that it keeps nothing, or that it is
 * still opening; null when all is well.
 */
export function storageProblem(backend: FileSystemBackend | undefined): string | null {
  if (backend instanceof PendingBrowserStore) {
    const current = backend.current;
    return current === null ? STORE_MESSAGES.opening : storageProblem(current);
  }
  return backend instanceof UnsavedBrowserStore ? backend.problem : null;
}

/**
 * Tells `listener` when storageProblem(backend) may have changed (a pending store has opened or
 * given up). Returns the function that stops listening.
 */
export function onStorageStateChange(backend: FileSystemBackend | undefined, listener: () => void): () => void {
  return backend instanceof PendingBrowserStore ? backend.onSettled(listener) : () => {};
}

/**
 * Tells `listener` the messages the user must see about the store: a write the browser refused
 * (BrowserBackend.onProblem), and, for a store that was still opening at start, that it gave up
 * and keeps nothing. Returns the function that stops listening.
 */
export function onStoreProblem(
  backend: FileSystemBackend | undefined,
  listener: (message: string) => void,
): () => void {
  if (backend instanceof BrowserBackend) return backend.onProblem((problem) => listener(problem.message));
  if (backend instanceof PendingBrowserStore) {
    const stopProblems = backend.onProblem((problem) => listener(problem.message));
    const stopSettled = backend.onSettled(() => {
      const problem = storageProblem(backend);
      if (problem) listener(problem);
    });
    return () => {
      stopProblems();
      stopSettled();
    };
  }
  return () => {};
}

/** Opens the browser store, or the memory stand-in when that fails (3.8.1). */
export async function openBrowserStore(deps: BrowserBackendDeps = {}): Promise<FileSystemBackend> {
  try {
    return await BrowserBackend.open(deps);
  } catch (error) {
    const detail = isFsError(error)
      ? error.message
      : `${errorName(error)}: ${String((error as Error)?.message ?? error)}`;
    return new UnsavedBrowserStore(detail);
  }
}

/**
 * The browser store for start-up: the store itself when it opens within `startWaitMs`, otherwise a
 * PendingBrowserStore, so that the application is shown without waiting up to OPEN_TIMEOUT_MS for
 * a database that does not answer (another tab holding a version change, a busy disk).
 */
export async function openStartupStore(
  deps: BrowserBackendDeps = {},
  startWaitMs: number = START_WAIT_MS,
): Promise<FileSystemBackend> {
  const opening = openBrowserStore(deps);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), startWaitMs);
  });
  const first = await Promise.race([opening, waited]);
  clearTimeout(timer);
  return first ?? new PendingBrowserStore(opening, deps.label ?? BROWSER_STORE_LABEL);
}

/**
 * The backends main.tsx mounts at start (docs/porting/errata/W3.md): the browser store, in the
 * browser and in the desktop app alike. Also asks the browser to keep the site's storage when it
 * runs short of space (navigator.storage.persist), because students keep coursework here.
 */
export async function createStartupBackends(_platform: Platform): Promise<FileSystemBackend[]> {
  const backend = await openStartupStore();
  const real = backend instanceof PendingBrowserStore ? backend.whenReady() : Promise.resolve(backend);
  void real.then((store) => {
    if (!(store instanceof BrowserBackend)) return;
    try {
      const storage = (globalThis.navigator as Navigator | undefined)?.storage;
      if (storage?.persist) void storage.persist().catch(() => {});
    } catch {
      // not available: the store works without it
    }
  });
  return [backend];
}
