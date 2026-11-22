// The store of earlier versions and the Trash (ARCHITECTURE-PLUS P3.3, P4.4). Owner: N0 > N3.
//
// One IndexedDB database of its own, `easy68k-history` (version 1 for good, P3.3.5), separate from
// the files' database. Everything the store decides is in core/history: the limits, the places, the
// thinning schedule, and the transaction plans (core/history/plans.ts), which this file runs over
// IndexedDB through IdbTx below. This file does phase 1 of every change (P3.3.5): it resolves the
// place, reads the bytes through the Vfs, hashes them with SHA-256 and compresses them, reads the
// storage estimate (B and the `tight` state) and asks the Web Locks which windows are open; then it
// runs ONE read-write transaction whose plan awaits only IndexedDB requests.
//
// The seven properties of P3.3.1 outrank every detailed rule; where the rules left a case open
// (P7, the six open cases), the decision is in docs/porting/errata/N3.md and marked "open case n".
//
// What each member does in each state (P4.4; no member rejects because of the state):
//
//   state, untracked, subscribe, deleteAll   as stated
//   record                                   ready: keeps (P3.3.3); otherwise resolves, keeps nothing
//   guard                                    ready: keeps a copy, else asks; off, tight: asks, then
//                                            step 3; unavailable: asks, then act, no record changes
//   moved, dropTrash, clearVersions, the     ready, off, tight: run; unavailable: resolve without
//   record changes of restoreTrash, the      effect (restoreTrash: gone)
//   global pass
//   versions, read, trashItems, usage        read; unavailable: [] (usage: zeros), read rejects
//
// createHistoryService is what SERVICE_FACTORIES uses; createHistoryStore gives tests the same
// store with a few more members (HistoryStore). fs/history-memory.ts builds it over fake-indexeddb.

import type {
  AppContext,
  Bytes,
  Clock,
  FileSystemBackend,
  HistoryService,
  HistoryState,
  HistoryUsage,
  Scheduler,
  SeenFile,
  SettingsService,
  TrashItemInfo,
  VersionInfo,
  Vfs,
  VPath,
} from '../contracts';
import { basename, isVPath, splitVPath } from '../core/paths/winpath';
import {
  HISTORY_CHANNEL,
  HISTORY_DB_NAME,
  HISTORY_DB_VERSION,
  LARGEST_COPY,
  LARGEST_VERSION,
  OPEN_TIMEOUT,
  PASS_FIRST_DELAY,
  PASS_INTERVAL,
  PASS_LOCK,
  PASS_RECORDS,
  PENDING_TTL,
  PRUNE_TO,
  RECORD_BYTES,
  RECORD_QUEUE_BYTES,
  REARM_FREE,
  WINDOW_LOCK_PREFIX,
  budgetFor,
  freeSpace,
  isTight,
} from '../core/history/limits';
import { belowGit, besideName, isGitName, placeOf, untrackedReason } from '../core/history/places';
import {
  groupItems,
  planCheckMeta,
  planClearMarks,
  planClearVersions,
  planDropItems,
  planDropLiving,
  planExpireTrash,
  planExpireVersions,
  planGuardKeep,
  planGuardSettle,
  planKeepVersion,
  planMoved,
  planNotice,
  planPruneHalf,
  planRestoreDir,
  planRestoreFile,
  Work,
  type GuardFile,
  type NewVersion,
  type PlanEnv,
  type PlanEvent,
  type PruneCursor,
} from '../core/history/plans';
import {
  MetaDamaged,
  countedVersion,
  parseContentRecord,
  parseFileRecord,
  parseTotals,
  parseVersionRecord,
  type ContentRecord,
  type FileRecord,
  type Half,
  type PendingMark,
  type VersionRecord,
} from '../core/history/records';
import type { HistoryTx, Keyed, TimeKey } from '../core/history/store';
import { historySwitchOn } from '../core/history/switch';
import { VERSION_NOT_KEPT, changedWhileReplacing, gitRefused } from '../core/history/texts';

export interface HistoryDeps {
  vfs: Vfs;
  settings: SettingsService;
  clock: Clock;
  scheduler: Scheduler;
  indexedDB: IDBFactory | null;
  IDBKeyRange: typeof IDBKeyRange | null;
  subtle: SubtleCrypto;
  compression: { CompressionStream?: typeof CompressionStream; DecompressionStream?: typeof DecompressionStream };
  locks: LockManager | null;
  channel: (name: string) => BroadcastChannel | null;
  estimate: (() => Promise<StorageEstimate>) | null;
}

/** What tests may add to a store (none of it is used by the application). */
export interface HistoryStoreOptions {
  /** This window's id (random by default). */
  windowId?: string;
  /** The pruning log: every PlanEvent of every transaction of this window. */
  log?: (event: PlanEvent) => void;
  /** Called for every IndexedDB request of the plans (the cost test counts them). */
  onRequest?: (kind: 'read' | 'write') => void;
  /** Makes the ids of records and items (random by default; a test makes them repeatable). */
  newId?: () => string;
  /** Starts the global pass on the scheduler (default true). */
  schedulePass?: boolean;
  /** Gives up an open after 5 s on the scheduler (default true; an IndexedDB in memory always opens). */
  openTimeout?: boolean;
}

/** The history with the members its tests use besides HistoryService. */
export interface HistoryStore extends HistoryService {
  readonly windowId: string;
  /** Runs the global pass now (P3.3.4), under its Web Lock. */
  globalPass(): Promise<void>;
  /** Records that did not parse, skipped and counted (P3.3.7). */
  unreadable(): number;
  /** Why the history is unavailable in this window (P3.3.7's `<detail>`), or null. */
  unavailableDetail(): string | null;
  /** Resolves when every record() call so far has been dealt with. */
  settled(): Promise<void>;
  /** Ends the store as a page that closes ends it: no more passes, the connection and locks go. */
  close(): void;
}

/** With `indexedDB` null the service's state() is 'unavailable'. */
export function createHistoryService(deps: HistoryDeps): HistoryService {
  return createHistoryStore(deps);
}

/** The same store as createHistoryService, with the members of HistoryStore. */
export function createHistoryStore(deps: HistoryDeps, options: HistoryStoreOptions = {}): HistoryStore {
  return new Store(deps, options);
}

/** The deps of the running browser or desktop app, for SERVICE_FACTORIES. */
export function browserHistoryDeps(ctx: AppContext): HistoryDeps {
  const scope = globalThis as typeof globalThis & {
    indexedDB?: IDBFactory;
    IDBKeyRange?: typeof IDBKeyRange;
    CompressionStream?: typeof CompressionStream;
    DecompressionStream?: typeof DecompressionStream;
    BroadcastChannel?: typeof BroadcastChannel;
  };
  const nav = (scope as { navigator?: Partial<Navigator> }).navigator;
  const storage = nav?.storage;
  const compression: HistoryDeps['compression'] = {};
  if (scope.CompressionStream) compression.CompressionStream = scope.CompressionStream;
  if (scope.DecompressionStream) compression.DecompressionStream = scope.DecompressionStream;
  return {
    vfs: ctx.vfs,
    settings: ctx.settings,
    clock: ctx.clock,
    scheduler: ctx.scheduler,
    indexedDB: scope.indexedDB ?? null,
    IDBKeyRange: scope.IDBKeyRange ?? null,
    // crypto.subtle is absent outside a secure context; the store then has no hash and is unavailable.
    subtle: scope.crypto?.subtle as SubtleCrypto,
    compression,
    locks: nav?.locks ?? null,
    channel: (name) => (typeof scope.BroadcastChannel === 'function' ? new scope.BroadcastChannel(name) : null),
    estimate: storage && typeof storage.estimate === 'function' ? () => storage.estimate() : null,
  };
}

// ---- IndexedDB ----------------------------------------------------------------------------------

const STORES = ['files', 'versions', 'contents', 'meta'] as const;

/** Creates the stores and indexes of P3.3.5 (version 1, for good). */
function upgrade(db: IDBDatabase): void {
  const names = db.objectStoreNames;
  if (!names.contains('meta')) db.createObjectStore('meta');
  if (!names.contains('roots')) db.createObjectStore('roots');
  if (!names.contains('files')) {
    const files = db.createObjectStore('files');
    files.createIndex('byLive', 'live', { unique: true });
    files.createIndex('byItem', 'trash.item');
    // [at, item]: oldest first, and an item's records together (errata N3, entry "records").
    files.createIndex('byTrashed', ['trash.at', 'trash.item']);
  }
  if (!names.contains('versions')) {
    const versions = db.createObjectStore('versions', { keyPath: ['file', 'seq'] });
    // [time, file, seq]: a total order, so that pruning can go on from where it stopped.
    versions.createIndex('byTime', ['time', 'file', 'seq']);
    versions.createIndex('byHash', 'hash');
  }
  if (!names.contains('contents')) db.createObjectStore('contents');
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** HistoryTx over one IndexedDB transaction. */
class IdbTx implements HistoryTx {
  private readonly files: IDBObjectStore;
  private readonly versionsStore: IDBObjectStore;
  private readonly contents: IDBObjectStore;
  private readonly metaStore: IDBObjectStore;

  constructor(
    transaction: IDBTransaction,
    private readonly range: typeof IDBKeyRange,
    private readonly skipped: (store: string, key: unknown) => void,
    private readonly onRequest?: (kind: 'read' | 'write') => void,
  ) {
    this.files = transaction.objectStore('files');
    this.versionsStore = transaction.objectStore('versions');
    this.contents = transaction.objectStore('contents');
    this.metaStore = transaction.objectStore('meta');
  }

  private read<T>(request: IDBRequest<T>): Promise<T> {
    this.onRequest?.('read');
    return done(request);
  }

  private write(): void {
    this.onRequest?.('write');
  }

  /** The records of an index range with their keys: two requests, whatever their number. */
  private async walk(index: string, range: IDBKeyRange | null, limit?: number): Promise<Keyed<FileRecord>[]> {
    const source = this.files.index(index);
    const [values, keys] = await Promise.all([
      this.read(source.getAll(range, limit)),
      this.read(source.getAllKeys(range, limit)),
    ]);
    const out: Keyed<FileRecord>[] = [];
    values.forEach((raw, i) => {
      const value = parseFileRecord(raw);
      if (value) out.push({ id: String(keys[i]), value });
      else this.skipped('files', keys[i]);
    });
    return out;
  }

  async file(id: string): Promise<FileRecord | null> {
    const value = await this.read(this.files.get(id));
    if (value === undefined) return null;
    const record = parseFileRecord(value);
    if (!record) this.skipped('files', id);
    return record;
  }

  async living(place: string): Promise<Keyed<FileRecord> | null> {
    const found = await this.walk('byLive', this.range.only(place), 1);
    return found[0] ?? null;
  }

  livingFrom(prefix: string): Promise<Keyed<FileRecord>[]> {
    return this.walk('byLive', this.range.bound(prefix, prefix + String.fromCharCode(0xffff)));
  }

  livingPage(after: string | null, limit: number): Promise<Keyed<FileRecord>[]> {
    return this.walk('byLive', after === null ? null : this.range.lowerBound(after, true), limit);
  }

  item(item: string): Promise<Keyed<FileRecord>[]> {
    return this.walk('byItem', this.range.only(item));
  }

  trashed(): Promise<Keyed<FileRecord>[]> {
    return this.walk('byTrashed', null);
  }

  trashedBefore(before: number, limit: number): Promise<Keyed<FileRecord>[]> {
    return this.walk('byTrashed', this.range.upperBound([before], true), limit);
  }

  putFile(id: string, record: FileRecord): void {
    this.write();
    this.files.put(record, id);
  }

  deleteFile(id: string): void {
    this.write();
    this.files.delete(id);
  }

  private parsedVersions(values: unknown[]): VersionRecord[] {
    const out: VersionRecord[] = [];
    for (const value of values) {
      const version = parseVersionRecord(value);
      if (version) out.push(version);
      else this.skipped('versions', value);
    }
    return out;
  }

  async versions(file: string): Promise<VersionRecord[]> {
    const values = await this.read(this.versionsStore.getAll(this.range.bound([file, 0], [file, Infinity])));
    return this.parsedVersions(values);
  }

  async version(file: string, seq: number): Promise<VersionRecord | null> {
    const value = await this.read(this.versionsStore.get([file, seq]));
    if (value === undefined) return null;
    const version = parseVersionRecord(value);
    if (!version) this.skipped('versions', [file, seq]);
    return version;
  }

  async versionsByTime(after: TimeKey | null, limit: number, before?: number): Promise<VersionRecord[]> {
    const lower = after ? [...after] : null;
    const upper = before === undefined ? null : [before];
    const range =
      lower && upper
        ? this.range.bound(lower, upper, true, true)
        : lower
          ? this.range.lowerBound(lower, true)
          : upper
            ? this.range.upperBound(upper, true)
            : null;
    if (lower && upper && this.cmpAfter(lower, upper)) return [];
    const values = await this.read(this.versionsStore.index('byTime').getAll(range, limit));
    return this.parsedVersions(values);
  }

  /** True when `lower` is not below `upper` (an empty range, which bound() would throw for). */
  private cmpAfter(lower: unknown[], upper: unknown[]): boolean {
    const a = lower[0] as number;
    const b = upper[0] as number;
    return a >= b;
  }

  putVersion(version: VersionRecord): void {
    this.write();
    this.versionsStore.put(version);
  }

  deleteVersion(file: string, seq: number): void {
    this.write();
    this.versionsStore.delete([file, seq]);
  }

  hashUsers(hash: string): Promise<number> {
    return this.read(this.versionsStore.index('byHash').count(this.range.only(hash)));
  }

  versionCount(): Promise<number> {
    return this.read(this.versionsStore.count());
  }

  async hasContent(hash: string): Promise<boolean> {
    return (await this.read(this.contents.count(this.range.only(hash)))) > 0;
  }

  async content(hash: string): Promise<ContentRecord | null> {
    const value = await this.read(this.contents.get(hash));
    if (value === undefined) return null;
    const content = parseContentRecord(value);
    if (!content) this.skipped('contents', hash);
    return content;
  }

  putContent(hash: string, content: ContentRecord): void {
    this.write();
    this.contents.put(content, hash);
  }

  deleteContent(hash: string): void {
    this.write();
    this.contents.delete(hash);
  }

  meta(key: 'totals' | 'notice'): Promise<unknown> {
    return this.read(this.metaStore.get(key));
  }

  putMeta(key: 'totals' | 'notice', value: unknown): void {
    this.write();
    this.metaStore.put(value, key);
  }
}

// ---- helpers ------------------------------------------------------------------------------------

function errorName(error: unknown): string {
  return String((error as { name?: unknown } | null)?.name ?? 'Error');
}

function errorText(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : String(error);
}

function isQuota(error: unknown): boolean {
  return errorName(error) === 'QuotaExceededError' || (error as { code?: unknown } | null)?.code === 22;
}

function hex(buffer: ArrayBuffer): string {
  let out = '';
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, '0');
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Sends `data` through a transform stream (CompressionStream, DecompressionStream). */
async function pump(
  stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
  data: Bytes,
) {
  const writer = stream.writable.getWriter();
  const writing = writer.write(data as BufferSource).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    if (value) parts.push(value);
  }
  await writing;
  return concat(parts);
}

/** The files and empty folders below `path` (or `path` itself), as guard reads them (P3.3.4). */
async function walk(vfs: Vfs, path: VPath, files: SeenFile[], dirs: VPath[]): Promise<void> {
  const stat = await vfs.stat(path).catch(() => null);
  if (!stat) return;
  if (stat.kind === 'file') {
    files.push({ path, mtime: stat.mtime, size: stat.size });
    return;
  }
  const entries = await vfs.list(path).catch(() => []);
  if (entries.length === 0) {
    dirs.push(path);
    return;
  }
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    await walk(vfs, `${path}/${entry.name}`, files, dirs);
  }
}

const NO_USAGE: HistoryUsage = { versions: 0, versionBytes: 0, trashItems: 0, trashBytes: 0, budget: 0 };
const NO_VERSION = VERSION_NOT_KEPT;

/** A record() call waiting in the queue (P3.3.5). */
interface Queued {
  path: VPath;
  data: Bytes;
  reason: 'saved' | 'opened' | 'before-import';
  time: number;
  resolve: () => void;
}

/** A file of guard, read in phase 1. */
interface ReadFile {
  seen: SeenFile;
  data: Bytes;
}

/** The roots store's value (P3.3.5). */
interface RootRecord {
  handle: unknown;
  name: string;
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

// ---- the store ------------------------------------------------------------------------------------

class Store implements HistoryStore {
  readonly windowId: string;
  private readonly newId: () => string;
  private failure: string | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private openDb: IDBDatabase | null = null;
  private closed = false;
  private budget = budgetFor(undefined);
  private tightEstimate = false;
  /** A history transaction failed with QuotaExceededError (P3.3.4): tight until room is seen. */
  private quotaTight = false;
  private lastState: HistoryState;
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;
  private readonly cancelSettings: () => void;
  private cancelTimer: (() => void) | null = null;
  private releaseWindowLock: (() => void) | null = null;
  /** Items between guard's keep and its settle in this window (open case 2). */
  private readonly active = new Set<string>();
  /** Items this window is restoring from (P3.3.4). */
  private readonly restoring = new Set<string>();
  private readonly skippedKeys = new Set<string>();
  private queue: Queued[] = [];
  private queuedBytes = 0;
  private pumping: Promise<void> | null = null;
  private readonly roots = new WeakMap<FileSystemBackend, Promise<string | null>>();

  constructor(
    private readonly deps: HistoryDeps,
    private readonly options: HistoryStoreOptions,
  ) {
    this.windowId = options.windowId ?? randomId();
    this.newId = options.newId ?? randomId;
    if (!deps.indexedDB || !deps.IDBKeyRange) this.failure = 'this browser gives the page no IndexedDB';
    else if (!deps.subtle || typeof deps.subtle.digest !== 'function') {
      this.failure = 'the page is not in a secure context, so it cannot compute the hashes of files';
    }
    this.lastState = this.state();
    this.cancelSettings = deps.settings.subscribe(() => this.stateMayHaveChanged());
    let channel: BroadcastChannel | null;
    try {
      channel = deps.channel(HISTORY_CHANNEL);
    } catch {
      channel = null;
    }
    this.channel = channel;
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { kind?: unknown } | null;
        if (data && data.kind === 'changed') this.emit();
      };
    }
    if (deps.locks && this.failure === null) {
      // Held while this window is open: other windows honour this window's marks (open case 2).
      void deps.locks
        .request(
          WINDOW_LOCK_PREFIX + this.windowId,
          () =>
            new Promise<void>((resolve) => {
              this.releaseWindowLock = resolve;
            }),
        )
        .catch(() => {});
    }
    if (options.schedulePass !== false && this.failure === null) this.schedule(PASS_FIRST_DELAY);
    if (this.failure === null) void this.database().catch(() => {});
  }

  // ---- state ----------------------------------------------------------------------------------

  state(): HistoryState {
    if (this.failure !== null) return 'unavailable';
    if (!this.switchOn()) return 'off';
    if (this.tightEstimate || this.quotaTight) return 'tight';
    return 'ready';
  }

  private switchOn(): boolean {
    try {
      return historySwitchOn(this.deps.settings.get());
    } catch {
      return true;
    }
  }

  private stateMayHaveChanged(): void {
    const now = this.state();
    if (now !== this.lastState) {
      this.lastState = now;
      this.emit();
    }
  }

  private fail(detail: string): void {
    if (this.failure !== null) return;
    this.failure = detail;
    this.stateMayHaveChanged();
  }

  unavailableDetail(): string | null {
    return this.failure;
  }

  unreadable(): number {
    return this.skippedKeys.size;
  }

  untracked(path: VPath, size: number, head: Bytes) {
    return untrackedReason(path, size, head);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // a listener's failure is its own
      }
    }
  }

  /** Tells this window's listeners and the other windows that the history changed. */
  private changed(places: readonly string[] = []): void {
    this.emit();
    try {
      this.channel?.postMessage({ kind: 'changed', places: [...places] });
    } catch {
      // a closed channel: other windows learn of it at their next read
    }
  }

  // ---- the database ---------------------------------------------------------------------------

  private database(): Promise<IDBDatabase> {
    if (this.failure !== null) return Promise.reject(new Error(this.failure));
    if (this.closed) return Promise.reject(new Error('the history was closed'));
    if (!this.dbPromise) {
      const promise = this.open().then(
        (db) => {
          this.openDb = db;
          db.onversionchange = () => {
            // deleteAll in another window, or a later format: let it have the database (P3.3.5).
            db.close();
            if (this.dbPromise === promise) this.dbPromise = null;
            this.openDb = null;
          };
          db.onclose = () => {
            if (this.dbPromise === promise) this.dbPromise = null;
            this.openDb = null;
          };
          return db;
        },
        (error: unknown) => {
          if (this.dbPromise === promise) this.dbPromise = null;
          if (error instanceof MetaDamaged) this.fail(error.message);
          else this.fail(errorText(error));
          throw error;
        },
      );
      this.dbPromise = promise;
    }
    return this.dbPromise;
  }

  private open(): Promise<IDBDatabase> {
    const factory = this.deps.indexedDB as IDBFactory;
    return new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      const timed = this.options.openTimeout !== false;
      const cancel = !timed
        ? () => {}
        : this.deps.scheduler.setTimer(OPEN_TIMEOUT, () => {
            if (settled) return;
            settled = true;
            reject(new Error(`the browser did not open it within ${OPEN_TIMEOUT / 1000} s`));
          });
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cancel();
        fn();
      };
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        // P3.3.7: a `meta` record that does not parse makes the history unavailable.
        this.transact(db, 'readonly', (tx) => planCheckMeta(tx)).then(
          () => finish(() => resolve(db)),
          (error: unknown) => {
            db.close();
            finish(() => reject(error));
          },
        );
      };
      request.onerror = () => finish(() => reject(request.error ?? new Error('the database could not be opened')));
      request.onblocked = () => {
        // An older connection elsewhere: the open goes on once it lets go (or the timer ends it).
      };
    });
  }

  /** Runs `plan` in one transaction of `db` and resolves with its value once the transaction completed. */
  private transact<T>(db: IDBDatabase, mode: IDBTransactionMode, plan: (tx: HistoryTx) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction([...STORES], mode);
      } catch (error) {
        reject(error);
        return;
      }
      let result: { value: T } | null = null;
      let failure: unknown = null;
      transaction.oncomplete = () => {
        if (failure !== null) reject(failure);
        else if (result) resolve(result.value);
        else reject(new Error('internal error: a history transaction ended without a result'));
      };
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('the transaction was aborted'));
      const tx = new IdbTx(
        transaction,
        this.deps.IDBKeyRange as typeof IDBKeyRange,
        (store, key) => this.skippedKeys.add(`${store}:${JSON.stringify(key)}`),
        this.options.onRequest,
      );
      plan(tx).then(
        (value) => {
          result = { value };
        },
        (error: unknown) => {
          failure = error;
          try {
            transaction.abort();
          } catch {
            // already finished; oncomplete or onabort reports it
          }
        },
      );
    });
  }

  /** Runs a plan; a QuotaExceededError makes the state tight (P3.3.4). */
  private async run<T>(mode: IDBTransactionMode, plan: (tx: HistoryTx) => Promise<T>): Promise<T> {
    const db = await this.database();
    try {
      return await this.transact(db, mode, plan);
    } catch (error) {
      if (isQuota(error)) {
        this.quotaTight = true;
        this.stateMayHaveChanged();
      } else if (error instanceof MetaDamaged) {
        this.fail(error.message);
      } else if (errorName(error) === 'InvalidStateError' && this.openDb === null) {
        // The connection closed (versionchange) between the open and the transaction: once more.
        return this.transact(await this.database(), mode, plan);
      }
      throw error;
    }
  }

  // ---- phase 1 ----------------------------------------------------------------------------------

  /** Reads the estimate and the open windows, and makes the environment of one change. */
  private async phase1(): Promise<PlanEnv> {
    await this.readEstimate();
    let held: Set<string> | null = null;
    let queriedAt = 0;
    const locks = this.deps.locks;
    if (locks && typeof locks.query === 'function') {
      queriedAt = this.now();
      try {
        const snapshot = await locks.query();
        held = new Set((snapshot.held ?? []).map((lock) => lock.name ?? ''));
      } catch {
        held = null;
      }
    }
    const now = this.now();
    return {
      now,
      budget: this.budget,
      window: this.windowId,
      honored: (mark: PendingMark, item: string) => {
        if (mark.window === this.windowId) return this.active.has(item);
        if (held) return held.has(WINDOW_LOCK_PREFIX + mark.window) || mark.at >= queriedAt;
        return now - mark.at < PENDING_TTL;
      },
      restoring: this.restoring,
      newId: this.newId,
      log: this.options.log,
    };
  }

  private estimateFree: number | null = null;

  private async readEstimate(): Promise<void> {
    let estimate: StorageEstimate | null = null;
    if (this.deps.estimate) {
      try {
        estimate = await this.deps.estimate();
      } catch {
        estimate = null;
      }
    }
    this.budget = budgetFor(estimate?.quota);
    this.tightEstimate = isTight(estimate);
    this.estimateFree = freeSpace(estimate);
    this.stateMayHaveChanged();
  }

  private now(): number {
    return this.deps.clock.wallTime().getTime();
  }

  /** The place of `path` (P4.3), with the root of an opened folder; null when not tracked. */
  private async place(path: VPath): Promise<string | null> {
    if (!isVPath(path)) return null;
    // Everything in an opened folder that is itself a .git folder lies below .git (P3.3.10).
    if (this.storeIsGit(path)) return null;
    const { mount } = splitVPath(path);
    if (mount !== 'folder') return placeOf(path);
    const backend = this.deps.vfs.backends().find((b) => b.mount === 'folder');
    if (!backend) return null;
    return placeOf(path, await this.rootOf(backend));
  }

  /**
   * True when the store of `path` is a folder of the student's computer that is itself named .git
   * (any letter case): Open Folder... or a drop chose a repository's .git folder, so every path in
   * it lies below .git although no segment of it says so (P1.1 rule 2, P3.3.10).
   */
  private storeIsGit(path: VPath): boolean {
    const { mount } = splitVPath(path);
    const backend = this.deps.vfs.backends().find((b) => b.mount === mount) as
      { rootHandle?: { name?: unknown } | null } | undefined;
    const name = backend?.rootHandle?.name;
    return typeof name === 'string' && isGitName(name);
  }

  /** The rootId of a mounted folder, found with isSameEntry or made new (P3.3.5, P4.3). */
  private rootOf(backend: FileSystemBackend): Promise<string | null> {
    let found = this.roots.get(backend);
    if (!found) {
      found = this.findRoot(backend).catch(() => null);
      this.roots.set(backend, found);
      void found.then((id) => {
        if (id === null) this.roots.delete(backend);
      });
    }
    return found;
  }

  private async findRoot(backend: FileSystemBackend): Promise<string | null> {
    const db = await this.database();
    const handle = (backend as { rootHandle?: unknown }).rootHandle ?? null;
    const records = await this.rootRecords(db);
    for (const [id, record] of records) {
      if (handle === null) {
        if (record.handle === null && record.name === backend.label) return id;
        continue;
      }
      const same = (record.handle as { isSameEntry?: (other: unknown) => Promise<boolean> } | null)?.isSameEntry;
      if (typeof same !== 'function') continue;
      if (await Promise.resolve(same.call(record.handle, handle)).catch(() => false)) return id;
    }
    const id = this.newId();
    const name = (handle as { name?: unknown } | null)?.name;
    await this.putRoot(db, id, { handle, name: typeof name === 'string' && handle !== null ? name : backend.label });
    return id;
  }

  private rootRecords(db: IDBDatabase): Promise<[string, RootRecord][]> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('roots', 'readonly');
      const request = transaction.objectStore('roots').openCursor();
      const out: [string, RootRecord][] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const value = cursor.value as RootRecord | undefined;
        if (value && typeof value === 'object' && typeof value.name === 'string') out.push([String(cursor.key), value]);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private putRoot(db: IDBDatabase, id: string, record: RootRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('roots', 'readwrite');
      transaction.objectStore('roots').put(record, id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  }

  /** SHA-256 and compression of one content (phase 1, P3.3.5, P3.3.6). */
  private async prepare(data: Bytes, reason: NewVersion['reason'], time: number): Promise<NewVersion> {
    const hash = hex(await this.deps.subtle.digest('SHA-256', data as BufferSource));
    return { hash, size: data.length, content: await this.compress(data), time, reason };
  }

  private async compress(data: Bytes): Promise<ContentRecord> {
    const { CompressionStream: Compress, DecompressionStream: Decompress } = this.deps.compression;
    if (Compress && Decompress && data.length > 0) {
      try {
        const packed = await pump(new Compress('deflate-raw'), data);
        if (packed.length < data.length) {
          return { enc: 'deflate-raw', data: packed, size: data.length, stored: packed.length };
        }
      } catch {
        // stored as it is
      }
    }
    const copy = data.slice();
    return { enc: 'none', data: copy, size: copy.length, stored: copy.length };
  }

  private async decompress(content: ContentRecord): Promise<Bytes> {
    const data = new Uint8Array(content.data.buffer, content.data.byteOffset, content.data.byteLength);
    if (content.enc === 'none') return data.slice();
    const Decompress = this.deps.compression.DecompressionStream;
    if (!Decompress) throw new Error('this browser cannot read a compressed version');
    return pump(new Decompress('deflate-raw'), data);
  }

  // ---- record ---------------------------------------------------------------------------------

  record(path: VPath, data: Bytes, reason: 'saved' | 'opened' | 'before-import', time: number): Promise<void> {
    try {
      if (this.state() !== 'ready' || this.closed) return Promise.resolve();
      if (untrackedReason(path, data.length, data) !== null) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const entry: Queued = { path, data: data.slice(), reason, time, resolve };
        this.queue.push(entry);
        this.queuedBytes += entry.data.length;
        // P3.3.5: at most 16 MB waiting; a new entry beyond that drops the oldest waiting ones.
        while (this.queuedBytes > RECORD_QUEUE_BYTES && this.queue.length > 1) {
          const oldest = this.queue.shift() as Queued;
          this.queuedBytes -= oldest.data.length;
          oldest.resolve();
        }
        this.pump();
      });
    } catch {
      return Promise.resolve();
    }
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = (async () => {
      for (;;) {
        const entry = this.queue.shift();
        if (!entry) break;
        this.queuedBytes -= entry.data.length;
        try {
          await this.keepAutomatic(entry);
        } catch {
          // P3.3.4: an automatic version that is not kept is left out, and nothing is said.
        }
        entry.resolve();
      }
      this.pumping = null;
    })();
  }

  async settled(): Promise<void> {
    while (this.pumping) await this.pumping;
  }

  private async keepAutomatic(entry: Queued): Promise<void> {
    if (this.state() !== 'ready') return;
    const env = await this.phase1();
    if (this.state() !== 'ready') return;
    const place = await this.place(entry.path);
    if (!place) return;
    const version = await this.prepare(entry.data, entry.reason, entry.time);
    const outcome = await this.run('readwrite', (tx) =>
      planKeepVersion(tx, env, { place, spelling: entry.path, version }),
    );
    if (outcome !== 'same') this.changed([place]);
  }

  // ---- guard ----------------------------------------------------------------------------------

  async guard(
    path: VPath,
    how: 'delete' | 'replace' | 'restore',
    act: (seen: readonly SeenFile[]) => Promise<void>,
    confirm: () => Promise<boolean>,
  ): Promise<{ outcome: 'kept' | 'not-kept' | 'declined'; item?: string }> {
    if (belowGit(path) || this.storeIsGit(path)) throw new Error(gitRefused(path, 'below'));
    const stat = await this.deps.vfs.stat(path).catch(() => null);
    if (!stat) {
      // P3.3.4 step 1: nothing to keep and nothing to ask.
      await act([]);
      return { outcome: 'kept' };
    }
    if (stat.kind === 'dir' && isGitName(basename(path))) {
      throw new Error(gitRefused(path, 'is'));
    }
    const seen: SeenFile[] = [];
    const dirs: VPath[] = [];
    await walk(this.deps.vfs, path, seen, dirs);
    if (seen.some((file) => belowGit(file.path)) || dirs.some((dir) => isGitName(basename(dir)) || belowGit(dir))) {
      throw new Error(gitRefused(path, 'holds'));
    }
    const startState = this.state();
    let kept: { item?: string } | null = null;
    let readFiles: ReadFile[] | null = null;
    if (startState === 'ready') {
      try {
        readFiles = await this.readSeen(seen, how);
        if (readFiles) kept = await this.keepCopy(path, how, readFiles, dirs);
      } catch {
        kept = null;
      }
    }
    const current = readFiles ? readFiles.map((file) => file.seen) : seen;
    if (!kept) return this.withoutCopy(how, current, act, confirm, startState);
    const item = kept.item;
    if (item) this.active.add(item);
    let failure: { error: unknown } | null = null;
    try {
      await act(current);
    } catch (error) {
      failure = { error };
    }
    if (item) {
      const untouched = await this.untouched(how, current, dirs, failure === null);
      await this.settle(item, untouched);
      this.active.delete(item);
      this.changed();
    }
    if (failure) throw failure.error;
    return item ? { outcome: 'kept', item } : { outcome: 'kept' };
  }

  /**
   * Phase 1 of guard: the bytes of every file of `seen`, each read between two equal stats so that
   * its `seen` entry describes exactly those bytes. Null when no copy can be kept (P3.3.4: above
   * 20 MB, above 1 MB for `restore`, more than B / 2 together).
   */
  private async readSeen(seen: SeenFile[], how: 'delete' | 'replace' | 'restore'): Promise<ReadFile[] | null> {
    const largest = how === 'restore' ? LARGEST_VERSION : LARGEST_COPY;
    let total = 0;
    for (const file of seen) {
      if (file.size > largest) return null;
      total += file.size;
    }
    if (total > this.budget / 2) return null;
    const out: ReadFile[] = [];
    for (const file of seen) {
      let entry: ReadFile | null = null;
      let before = file;
      for (let attempt = 0; attempt < 3 && !entry; attempt++) {
        const data = await this.deps.vfs.readFile(file.path).catch(() => null);
        const after = await this.deps.vfs.stat(file.path).catch(() => null);
        if (!data || !after || after.kind !== 'file') break;
        const now: SeenFile = { path: file.path, mtime: after.mtime, size: after.size };
        if (now.mtime === before.mtime && now.size === before.size && data.length === now.size)
          entry = { seen: now, data };
        before = now;
      }
      if (!entry) {
        const exists = await this.deps.vfs.stat(file.path).catch(() => null);
        if (exists) return null; // a file that keeps changing: no copy, the question instead
        continue; // gone meanwhile: act has nothing to remove
      }
      if (entry.seen.size > largest) return null;
      out.push(entry);
    }
    return out;
  }

  /** Step 2 of guard: one transaction keeps the copy (P3.3.4). Null when it was not kept. */
  private async keepCopy(
    path: VPath,
    how: 'delete' | 'replace' | 'restore',
    files: readonly ReadFile[],
    dirs: readonly VPath[],
  ): Promise<{ item?: string } | null> {
    const env = await this.phase1();
    if (this.state() !== 'ready') return null;
    const prepared: GuardFile[] = [];
    const places = new Set<string>();
    for (const file of files) {
      const place = await this.place(file.seen.path);
      if (!place) return null; // a store the history cannot key (an opened folder without a root)
      if (places.has(place)) return null;
      places.add(place);
      const reason = how === 'delete' ? 'before-delete' : how === 'replace' ? 'before-replace' : 'before-restore';
      prepared.push({ place, spelling: file.seen.path, version: await this.prepare(file.data, reason, env.now) });
    }
    if (how === 'restore') {
      if (prepared.length === 0) return {};
      const file = prepared[0] as GuardFile;
      const outcome = await this.run('readwrite', (tx) => planKeepVersion(tx, env, file));
      if (outcome === 'no-room') return null;
      this.changed([file.place]);
      return {};
    }
    const dirPlaces: { place: string; spelling: VPath }[] = [];
    for (const dir of dirs) {
      const place = await this.place(dir);
      if (!place) return null;
      dirPlaces.push({ place, spelling: dir });
    }
    if (prepared.length === 0 && dirPlaces.length === 0) return {};
    const item = this.newId();
    const ok = await this.run('readwrite', (tx) =>
      planGuardKeep(tx, env, {
        item,
        path,
        cause: how === 'delete' ? 'deleted' : 'replaced',
        files: prepared,
        dirs: dirPlaces,
      }),
    );
    if (!ok) return null;
    this.changed([...places]);
    return { item };
  }

  /** The places of the files and folders `act` did not remove or overwrite (P3.3.4 step 4). */
  private async untouched(
    how: 'delete' | 'replace' | 'restore',
    seen: readonly SeenFile[],
    dirs: readonly VPath[],
    resolved: boolean,
  ): Promise<Set<string>> {
    const out = new Set<string>();
    for (const file of seen) {
      let left: boolean;
      if (how === 'delete') left = (await this.deps.vfs.stat(file.path).catch(() => null)) !== null;
      else left = !resolved;
      if (left) {
        const place = await this.place(file.path).catch(() => null);
        if (place) out.add(place);
      }
    }
    for (const dir of dirs) {
      if ((await this.deps.vfs.stat(dir).catch(() => null)) !== null) {
        const place = await this.place(dir).catch(() => null);
        if (place) out.add(place);
      }
    }
    return out;
  }

  /** Step 4's transaction, tried three times: the item's untouched records back, the marks cleared. */
  private async settle(item: string, untouched: ReadonlySet<string>): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const env = await this.phase1();
        await this.run('readwrite', (tx) => planGuardSettle(tx, env, { item, untouched }));
        return;
      } catch {
        if (this.failure !== null) return;
      }
    }
  }

  /** Step 3 of guard: the question, then `act`, then the records of what `act` removed are dropped. */
  private async withoutCopy(
    how: 'delete' | 'replace' | 'restore',
    seen: readonly SeenFile[],
    act: (seen: readonly SeenFile[]) => Promise<void>,
    confirm: () => Promise<boolean>,
    startState: HistoryState,
  ): Promise<{ outcome: 'not-kept' | 'declined' }> {
    if (!(await confirm())) return { outcome: 'declined' };
    let failure: { error: unknown } | null = null;
    try {
      await act(seen);
    } catch (error) {
      failure = { error };
    }
    if (how !== 'restore' && startState !== 'unavailable' && this.failure === null && seen.length > 0) {
      // Open case 5: only the files `act` removed or overwrote lose their earlier versions.
      const untouched = await this.untouched(how, seen, [], failure === null);
      const gone: string[] = [];
      for (const file of seen) {
        const place = await this.place(file.path).catch(() => null);
        if (place && !untouched.has(place)) gone.push(place);
      }
      if (gone.length > 0) {
        try {
          const env = await this.phase1();
          await this.run('readwrite', (tx) => planDropLiving(tx, env, gone));
          this.changed(gone);
        } catch {
          // the history could not be changed: its records stay, nothing current is touched
        }
      }
    }
    if (failure) throw failure.error;
    return { outcome: 'not-kept' };
  }

  // ---- reading ----------------------------------------------------------------------------------

  async versions(path: VPath): Promise<VersionInfo[]> {
    if (this.failure !== null) return [];
    try {
      const place = await this.place(path);
      if (!place) return [];
      const list = await this.run('readonly', async (tx) => {
        const live = await tx.living(place);
        return live ? tx.versions(live.id) : [];
      });
      return list
        .sort((a, b) => b.time - a.time || b.seq - a.seq)
        .map((v) => ({ seq: v.seq, time: v.time, size: v.size, reason: v.reason }));
    } catch {
      return [];
    }
  }

  async read(path: VPath, seq: number): Promise<Bytes> {
    if (this.failure !== null) throw new Error(NO_VERSION);
    const place = await this.place(path).catch(() => null);
    if (!place) throw new Error(NO_VERSION);
    const content = await this.run('readonly', async (tx) => {
      const live = await tx.living(place);
      const version = live ? await tx.version(live.id, seq) : null;
      return version ? { version, content: await tx.content(version.hash) } : null;
    }).catch(() => null);
    if (!content || !content.content) throw new Error(NO_VERSION);
    const bytes = await this.decompress(content.content);
    if (bytes.length !== content.version.size) throw new Error(NO_VERSION);
    return bytes;
  }

  async trashItems(): Promise<TrashItemInfo[]> {
    if (this.failure !== null) return [];
    try {
      const groups = await this.run('readonly', async (tx) => {
        const work = await Work.start(tx, this.readEnv());
        const out: { group: ReturnType<typeof groupItems>[number]; bytes: number }[] = [];
        for (const group of groupItems(await tx.trashed()))
          out.push({ group, bytes: await work.itemBytes(group.records) });
        return out;
      });
      const infos: TrashItemInfo[] = [];
      for (const { group, bytes } of groups) infos.push(await this.itemInfo(group, bytes));
      return infos.sort((a, b) => b.deletedAt - a.deletedAt || (a.id < b.id ? 1 : -1));
    } catch {
      return [];
    }
  }

  /** The environment of a read-only plan. */
  private readEnv(): PlanEnv {
    return {
      now: this.now(),
      budget: this.budget,
      window: this.windowId,
      honored: () => true,
      restoring: this.restoring,
      newId: this.newId,
    };
  }

  private async itemInfo(group: ReturnType<typeof groupItems>[number], bytes: number): Promise<TrashItemInfo> {
    const first = group.records[0]?.value as FileRecord;
    const mark = first.trash as NonNullable<FileRecord['trash']>;
    const files = group.records.filter(({ value }) => !value.dir).length;
    const kind = group.records.length === 1 && !first.dir && first.spelling === mark.path ? 'file' : 'dir';
    const info: TrashItemInfo = {
      id: group.item,
      deletedAt: mark.at,
      cause: mark.cause,
      path: mark.path,
      kind,
      files,
      bytes,
      restorableInPlace: await this.inPlace(first.place),
    };
    // The opened folder's name, for P3.3.8's `"prog.X68" was in the folder "Lab", which is not
    // open.` (errata N3, "restoreTrash").
    const folderName = first.place.startsWith('folder:') ? await this.rootName(first.place) : null;
    if (folderName !== null) info.folderName = folderName;
    return info;
  }

  /** The name the roots store keeps for the opened folder of `place` (`folder:<rootId>/...`). */
  private async rootName(place: string): Promise<string | null> {
    const slash = place.indexOf('/');
    const id = place.slice('folder:'.length, slash < 0 ? undefined : slash);
    try {
      const records = await this.rootRecords(await this.database());
      return records.find(([key]) => key === id)?.[1].name ?? null;
    } catch {
      return null;
    }
  }

  /** True when the store of `place` is mounted now, for an opened folder the same folder (P3.3.8). */
  private async inPlace(place: string): Promise<boolean> {
    const scheme = place.slice(0, place.indexOf(':'));
    const backend = this.deps.vfs.backends().find((b) => b.mount === scheme);
    if (!backend) return false;
    if (scheme !== 'folder') return true;
    const root = await this.rootOf(backend);
    return root !== null && place.startsWith(`folder:${root}/`);
  }

  async usage(): Promise<HistoryUsage> {
    if (this.failure !== null) return { ...NO_USAGE };
    try {
      await this.readEstimate();
      const budget = this.budget;
      return await this.run('readonly', async (tx) => {
        const totals = parseTotals(await tx.meta('totals'));
        const all = await tx.versionCount();
        const trashed = await tx.trashed();
        const copies = trashed.filter(({ value }) => !value.dir && value.count > 0).length;
        return {
          versions: all - copies,
          versionBytes: totals.versions,
          trashItems: new Set(trashed.map(({ value }) => value.trash?.item)).size,
          trashBytes: totals.trash,
          budget,
        };
      });
    } catch {
      return { ...NO_USAGE };
    }
  }

  // ---- restore from the Trash -------------------------------------------------------------------

  async restoreTrash(
    id: string,
    options: Parameters<HistoryService['restoreTrash']>[1],
  ): Promise<{ restored: VPath[]; left: VPath[]; lost: VPath[]; gone: boolean; error?: string }> {
    const nothing = { restored: [], left: [], lost: [], gone: true };
    if (this.failure !== null) return nothing;
    // The item is read once, with the bytes of its files (P3.3.8).
    let read: { record: Keyed<FileRecord>; version: VersionRecord | null; content: ContentRecord | null }[];
    try {
      read = await this.run('readonly', async (tx) => {
        const out: { record: Keyed<FileRecord>; version: VersionRecord | null; content: ContentRecord | null }[] = [];
        for (const record of await tx.item(id)) {
          const version = record.value.dir ? null : await tx.version(record.id, record.value.newestSeq);
          out.push({ record, version, content: version ? await tx.content(version.hash) : null });
        }
        return out;
      });
    } catch {
      return nothing;
    }
    if (read.length === 0) return nothing;
    const group = { item: id, at: read[0]?.record.value.trash?.at ?? 0, records: read.map(({ record }) => record) };
    const bytes = read.reduce((sum, { version }) => sum + RECORD_BYTES + (version ? countedVersion(version) : 0), 0);
    const info = await this.itemInfo(group, bytes);
    // Where it goes: its place, or a folder the person chooses when its store is not mounted.
    let base: ((spelling: VPath) => VPath) | null = (spelling) => spelling;
    if (!info.restorableInPlace) {
      const folder = await options.fallback(info);
      if (folder === null) {
        base = null;
      } else {
        const top = basename(info.path);
        base = (spelling) =>
          info.kind === 'file' ? `${folder}/${top}` : `${folder}/${top}${spelling.slice(info.path.length)}`;
      }
    }
    const files = read
      .filter(({ record }) => !record.value.dir)
      .sort((a, b) => (a.record.value.spelling < b.record.value.spelling ? -1 : 1));
    const folders = read.filter(({ record }) => record.value.dir);
    const restored: VPath[] = [];
    const notWritten: { record: string; path: VPath }[] = [];
    let error: string | undefined;
    if (!base) {
      for (const { record } of files) notWritten.push({ record: record.id, path: record.value.spelling });
      return this.endRestore(id, restored, notWritten, error);
    }
    this.restoring.add(id);
    try {
      let stopped = false;
      for (const { record, version, content } of files) {
        const target = base(record.value.spelling);
        if (stopped) {
          notWritten.push({ record: record.id, path: target });
          continue;
        }
        const step = await this.restoreOne(id, record, version, content, target, options);
        if (step.kind === 'written') {
          restored.push(step.path);
          continue;
        }
        notWritten.push({ record: record.id, path: target });
        if (step.kind === 'cancel') stopped = true;
        if (step.kind === 'failed') {
          stopped = true;
          error = step.message;
        }
      }
      if (!stopped) {
        // The item's empty folders are created with its last file (P3.3.8).
        for (const { record } of folders) {
          const target = base(record.value.spelling);
          try {
            await this.deps.vfs.mkdirp(target);
          } catch (e) {
            error = errorText(e);
            break;
          }
          try {
            const env = await this.phase1();
            await this.run('readwrite', (tx) => planRestoreDir(tx, env, { record: record.id, item: id }));
          } catch {
            // the folder exists; its record stays in the Trash, which loses nothing
          }
        }
      }
    } finally {
      this.restoring.delete(id);
    }
    return this.endRestore(id, restored, notWritten, error);
  }

  /** One file of a restore, in the order of P3.3.4: before(), ask(), the write, the record, after(). */
  private async restoreOne(
    item: string,
    record: Keyed<FileRecord>,
    version: VersionRecord | null,
    content: ContentRecord | null,
    target: VPath,
    options: Parameters<HistoryService['restoreTrash']>[1],
  ): Promise<{ kind: 'written'; path: VPath } | { kind: 'left' | 'cancel' } | { kind: 'failed'; message: string }> {
    if (!version || !content) return { kind: 'left' };
    let bytes: Bytes;
    try {
      bytes = await this.decompress(content);
    } catch (e) {
      return { kind: 'failed', message: errorText(e) };
    }
    let path = target;
    if (options.before && (await options.before(path)) === 'skip') return { kind: 'left' };
    if (await this.deps.vfs.stat(path).catch(() => null)) {
      const answer = await options.ask(path);
      if (answer === 'cancel') return { kind: 'cancel' };
      if (answer === 'beside') {
        let n = 1;
        path = besideName(target, n);
        while (await this.deps.vfs.stat(path).catch(() => null)) path = besideName(target, ++n);
      } else {
        let message: string | null = null;
        try {
          const outcome = await this.guard(
            path,
            'replace',
            async (seen) => {
              for (const file of seen) {
                const now = await this.deps.vfs.stat(file.path);
                if (!now || now.mtime !== file.mtime || now.size !== file.size) {
                  throw new Error(changedWhileReplacing(basename(file.path)));
                }
              }
              await this.deps.vfs.writeFile(path, bytes);
            },
            () => options.confirm(path),
          );
          if (outcome.outcome === 'declined') return { kind: 'left' };
        } catch (e) {
          message = errorText(e);
        }
        if (message !== null) return { kind: 'failed', message };
        return this.afterWrite(item, record, path, options);
      }
    }
    try {
      await this.deps.vfs.writeFile(path, bytes);
    } catch (e) {
      return { kind: 'failed', message: errorText(e) };
    }
    return this.afterWrite(item, record, path, options);
  }

  private async afterWrite(
    item: string,
    record: Keyed<FileRecord>,
    path: VPath,
    options: Parameters<HistoryService['restoreTrash']>[1],
  ): Promise<{ kind: 'written'; path: VPath }> {
    try {
      const place = await this.place(path);
      if (place) {
        const env = await this.phase1();
        await this.run('readwrite', (tx) =>
          planRestoreFile(tx, env, { record: record.id, item, place, spelling: path }),
        );
        this.changed([place]);
      }
    } catch {
      // the file is written; its record stays in the Trash (a record whose file exists, P3.3.3)
    }
    try {
      await options.after?.(path);
    } catch {
      // the caller's reload is its own
    }
    return { kind: 'written', path };
  }

  /** `left` and `lost` of the files not written (P4.4). */
  private async endRestore(
    item: string,
    restored: VPath[],
    notWritten: { record: string; path: VPath }[],
    error: string | undefined,
  ) {
    const left: VPath[] = [];
    const lost: VPath[] = [];
    if (notWritten.length > 0) {
      let still: Set<string>;
      try {
        still = await this.run('readonly', async (tx) => new Set((await tx.item(item)).map(({ id }) => id)));
      } catch {
        still = new Set(notWritten.map(({ record }) => record));
      }
      for (const { record, path } of notWritten) (still.has(record) ? left : lost).push(path);
    }
    this.changed();
    return error === undefined ? { restored, left, lost, gone: false } : { restored, left, lost, gone: false, error };
  }

  // ---- other changes ------------------------------------------------------------------------------

  async dropTrash(ids: readonly string[]): Promise<void> {
    if (this.failure !== null || ids.length === 0) return;
    try {
      const env = await this.phase1();
      await this.run('readwrite', (tx) => planDropItems(tx, env, ids));
      this.changed();
    } catch {
      // nothing current is touched either way
    }
  }

  async moved(from: VPath, to: VPath): Promise<void> {
    if (this.failure !== null) return;
    try {
      const fromPlace = await this.place(from);
      const toPlace = await this.place(to);
      if (!fromPlace || !toPlace) return;
      const env = await this.phase1();
      const count = await this.run('readwrite', (tx) => planMoved(tx, env, { fromPlace, toPlace, to }));
      if (count > 0) this.changed([fromPlace, toPlace]);
    } catch {
      // R10: the history of a file that moved twice at once stays where one move left it
    }
  }

  async clearVersions(): Promise<void> {
    if (this.failure !== null) return;
    try {
      const env = await this.phase1();
      while (await this.run('readwrite', (tx) => planClearVersions(tx, env, PASS_RECORDS / 2))) {
        // the next batch
      }
      this.changed();
    } catch {
      // what was done stays done
    }
  }

  async deleteAll(): Promise<void> {
    const factory = this.deps.indexedDB;
    if (!factory) return;
    const pending = this.dbPromise;
    this.dbPromise = null;
    if (pending) {
      try {
        (await pending).close();
      } catch {
        // it never opened
      }
    }
    this.openDb = null;
    await new Promise<void>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.deleteDatabase(HISTORY_DB_NAME);
      } catch {
        resolve();
        return;
      }
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => {
        // Other windows close their connection on versionchange (P3.3.5); the delete then goes on.
      };
    });
    // P3.3.7: deleting the database is how an unavailable history recovers.
    if (this.deps.subtle && typeof this.deps.subtle.digest === 'function') this.failure = null;
    this.quotaTight = false;
    this.skippedKeys.clear();
    this.stateMayHaveChanged();
    this.changed();
  }

  // ---- the global pass ----------------------------------------------------------------------------

  private schedule(delay: number): void {
    if (this.closed) return;
    this.cancelTimer = this.deps.scheduler.setTimer(delay, () => {
      this.cancelTimer = null;
      const hidden = (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState === 'hidden';
      const run = hidden ? Promise.resolve() : this.globalPass();
      void run.catch(() => {}).then(() => this.schedule(PASS_INTERVAL));
    });
  }

  async globalPass(): Promise<void> {
    if (this.failure !== null || this.closed) return;
    const locks = this.deps.locks;
    if (!locks) {
      await this.pass();
      return;
    }
    await locks.request(PASS_LOCK, { ifAvailable: true }, async (lock) => {
      if (lock) await this.pass(); // a window that does not get the lock skips the pass (P3.3.4)
    });
  }

  private async pass(): Promise<void> {
    let env = await this.phase1();
    if (this.failure !== null) return;
    let changed = false;
    try {
      // Marks that protect nothing any more (open case 2).
      changed =
        (await this.run('readwrite', (tx) => planClearMarks(tx, env, (mark, item) => !env.honored(mark, item)))) > 0;
      // Expiry: items older than 30 days, versions older than 60 days.
      while ((await this.run('readwrite', (tx) => planExpireTrash(tx, env, PASS_RECORDS))) > 0) changed = true;
      let after: TimeKey | null = null;
      do {
        const from: TimeKey | null = after;
        after = await this.run('readwrite', (tx) => planExpireVersions(tx, env, from, PASS_RECORDS));
        changed = true;
      } while (after);
      // The lowering when storage is tight (P3.3.4).
      const tight = this.tightEstimate || this.quotaTight;
      const roomy = this.estimateFree !== null && this.estimateFree > REARM_FREE;
      const targets = await this.run('readwrite', (tx) => planNotice(tx, env, { tight, roomy, now: env.now }));
      // A refusal for the quota keeps the state tight until a pass sees room again (or has no
      // estimate to tell, and tries again).
      if (roomy || this.estimateFree === null) this.quotaTight = false;
      if (targets) {
        await this.pruneHalf(env, 'versions', targets.versions, 'lower');
        await this.pruneHalf(env, 'trash', targets.trash, 'lower');
        changed = true;
      }
      // B fell: a half above B / 2 is pruned in its order.
      env = await this.phase1();
      const totals = await this.run('readonly', async (tx) => parseTotals(await tx.meta('totals')));
      const limit = Math.floor(env.budget / 2);
      for (const half of ['versions', 'trash'] as const) {
        if (totals[half] > limit) {
          await this.pruneHalf(env, half, Math.floor(PRUNE_TO * limit), 'pass');
          changed = true;
        }
      }
    } finally {
      this.stateMayHaveChanged();
      if (changed) this.changed();
    }
  }

  private async pruneHalf(env: PlanEnv, half: Half, target: number, by: 'pass' | 'lower'): Promise<void> {
    const cursor: PruneCursor = { step: 1, afterPlace: null, afterTime: null };
    for (let rounds = 0; rounds < 100_000; rounds++) {
      const finished = await this.run('readwrite', (tx) =>
        planPruneHalf(tx, env, { half, target, by, limit: PASS_RECORDS, cursor }),
      );
      if (finished) return;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.cancelSettings();
    this.releaseWindowLock?.();
    this.releaseWindowLock = null;
    try {
      this.channel?.close();
    } catch {
      // closed already
    }
    const pending = this.dbPromise;
    this.dbPromise = null;
    if (pending) void pending.then((db) => db.close()).catch(() => {});
    this.listeners.clear();
  }
}
