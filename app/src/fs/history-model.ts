// Test support: the reference model of the safety net, its command driver and the checker of the
// seven properties (ARCHITECTURE-PLUS P3.3.1; the model test of P5 N3). Owner: N3.
//
// Imported only by tests (fs/history-model.test.ts, and N5's tests, which run the checker after
// their own commands). It imports no npm package: the test passes the IndexedDB to use.
//
// The model holds what must be true, independently of the store:
//
//   files      the expected current files (path -> bytes). Every change a command makes goes
//              through `model.vfs`, which applies it to the real Vfs and to `files`; the history
//              gets `model.storeVfs`, whose writes are allowed only where a Trash restore is
//              expected to write, with the bytes the model predicts (property 1).
//   promises   each copy the store promised (a `guard` that resolved `kept` and whose `act`
//              removed or overwrote a file): path, bytes, half, time. A promise leaves the list only
//              by a cause the model applies itself (a drop the person asked for, expiry, `Yes`
//              without a copy, a restore that put the bytes back, ...); a promise that the store
//              lost otherwise must be explained by pruning, which the checker verifies against
//              the rules of P3.3.4 with its own schedule and the database read directly
//              (`explainLoss`): the half needed room, and what went went in that half's order.
//
// `model.watch(history)` wraps a HistoryService so that every guard and restore is booked in the
// model; checkHistoryInvariants(db, vfs, model) checks the seven properties and returns the
// violations (an empty list when all hold).

import type {
  Bytes,
  DirEntry,
  FileStat,
  FileSystemBackend,
  HistoryService,
  SeenFile,
  TrashItemInfo,
  Vfs,
  VPath,
} from '../contracts';
import { DAY, HOUR, MINUTE, RECORD_BYTES, TRASH_AGE, VERSION_AGE, LARGEST_VERSION } from '../core/history/limits';
import { besideName, placeOf, touchesGit, untrackedReason } from '../core/history/places';
import { isVPath, splitVPath } from '../core/paths/winpath';
import { createVfs } from './vfs';

// ---- the database, read directly ------------------------------------------------------------------

interface DbFile {
  place: string;
  live?: string;
  spelling: string;
  newestSeq: number;
  newestHash: string;
  lastSeq: number;
  count: number;
  bytes: number;
  dir?: boolean;
  trash?: { item: string; at: number; cause: string; path: string; pending?: { window: string; at: number } };
}
interface DbVersion {
  file: string;
  seq: number;
  time: number;
  hash: string;
  size: number;
  stored: number;
  reason: string;
}
interface DbContent {
  enc: string;
  data: Uint8Array;
  size: number;
  stored: number;
}

/** Everything in `easy68k-history`, as stored. */
export interface DbSnapshot {
  files: Map<string, DbFile>;
  versions: Map<string, DbVersion[]>;
  /** Every stored content by hash; its record only where it was asked for (null otherwise). */
  contents: Map<string, DbContent | null>;
  totals: { versions: number; trash: number };
  notice: unknown;
}

/** Reads the whole history database of `factory` (read-only). */
/**
 * Reads the whole history database of `factory` (read-only). Contents are listed by hash; the
 * bytes are read only for the hashes `wantData` names (reading every content after every step
 * would cost more than the rest of the model test).
 */
export async function readHistoryDatabase(
  factory: IDBFactory,
  wantData: (snapshot: DbSnapshot) => Iterable<string> = () => [],
): Promise<DbSnapshot> {
  const db = await connection(factory);
  const empty: DbSnapshot = {
    files: new Map(),
    versions: new Map(),
    contents: new Map(),
    totals: { versions: 0, trash: 0 },
    notice: undefined,
  };
  if (!db) return empty;
  try {
    if (!db.objectStoreNames.contains('files')) return empty;
    const tx = db.transaction(['files', 'versions', 'contents', 'meta'], 'readonly');
    const get = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const all = async (name: string) => {
      const store = tx.objectStore(name);
      const [keys, values] = await Promise.all([get(store.getAllKeys()), get(store.getAll())]);
      return keys.map((key, i) => ({ key, value: values[i] as unknown }));
    };
    const keys = new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = tx.objectStore('contents').getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [files, versions, contents, meta] = await Promise.all([all('files'), all('versions'), keys, all('meta')]);
    const snapshot: DbSnapshot = { ...empty, files: new Map(), versions: new Map(), contents: new Map() };
    for (const { key, value } of files) snapshot.files.set(String(key), value as DbFile);
    for (const { value } of versions) {
      const v = value as DbVersion;
      const list = snapshot.versions.get(v.file) ?? [];
      list.push(v);
      snapshot.versions.set(v.file, list);
    }
    for (const key of contents) snapshot.contents.set(String(key), null);
    for (const { key, value } of meta) {
      if (key === 'totals') snapshot.totals = value as { versions: number; trash: number };
      if (key === 'notice') snapshot.notice = value;
    }
    const wanted = [...new Set(wantData(snapshot))].filter((hash) => snapshot.contents.has(hash));
    if (wanted.length > 0) {
      const read = db.transaction('contents', 'readonly').objectStore('contents');
      await Promise.all(
        wanted.map(
          (hash) =>
            new Promise<void>((resolve, reject) => {
              const request = read.get(hash);
              request.onsuccess = () => {
                snapshot.contents.set(hash, request.result as DbContent);
                resolve();
              };
              request.onerror = () => reject(request.error);
            }),
        ),
      );
    }
    return snapshot;
  } catch {
    CONNECTIONS.delete(factory);
    return empty;
  }
}

/** One read-only connection per database, kept open between checks; it lets go on versionchange. */
const CONNECTIONS = new WeakMap<IDBFactory, Promise<IDBDatabase | null>>();

function connection(factory: IDBFactory): Promise<IDBDatabase | null> {
  let found = CONNECTIONS.get(factory);
  if (!found) {
    found = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('easy68k-history');
      request.onupgradeneeded = () => {
        // Not created yet: an empty snapshot. Creating the stores here would be a write, so abort.
        request.transaction?.abort();
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          CONNECTIONS.delete(factory);
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(() => {
      CONNECTIONS.delete(factory);
      return null;
    });
    CONNECTIONS.set(factory, found);
  }
  return found;
}

/** A record of the `roots` store (P3.3.5): an opened folder's handle, or null and its name. */
interface DbRoot {
  handle: unknown;
  name: string;
}

/** The `roots` store of `factory`, in key order, as the store's cursor reads it (read-only). */
async function readRoots(factory: IDBFactory): Promise<[string, DbRoot][]> {
  const db = await connection(factory);
  if (!db || !db.objectStoreNames.contains('roots')) return [];
  try {
    const store = db.transaction('roots', 'readonly').objectStore('roots');
    const get = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const [keys, values] = await Promise.all([get(store.getAllKeys()), get(store.getAll())]);
    const out: [string, DbRoot][] = [];
    keys.forEach((key, i) => {
      const value = values[i] as DbRoot | undefined;
      if (value && typeof value === 'object' && typeof value.name === 'string') out.push([String(key), value]);
    });
    return out;
  } catch {
    CONNECTIONS.delete(factory);
    return [];
  }
}

/**
 * The rootId the store gives `backend` (fs/history-db.ts findRoot, P4.3): the first record, in key
 * order, of the same handle (`isSameEntry`), or without a handle of the same name; null when the
 * store has made none yet.
 */
async function rootIdIn(roots: readonly [string, DbRoot][], backend: FileSystemBackend): Promise<string | null> {
  const handle = (backend as { rootHandle?: unknown }).rootHandle ?? null;
  for (const [id, record] of roots) {
    if (handle === null) {
      if (record.handle === null && record.name === backend.label) return id;
      continue;
    }
    const same = (record.handle as { isSameEntry?: (other: unknown) => Promise<boolean> } | null)?.isSameEntry;
    if (typeof same !== 'function') continue;
    if (await Promise.resolve(same.call(record.handle, handle)).catch(() => false)) return id;
  }
  return null;
}

/** Stands for the root of an opened folder the store has not given a rootId yet (no record names it). */
const ROOT_NOT_YET = '?';

// ---- small helpers ----------------------------------------------------------------------------------

/** The hash and the inflation the checker uses; a test may give faster ones of the same results. */
export const MODEL_CODEC = {
  sha256: async (data: Bytes): Promise<ArrayBuffer> => globalThis.crypto.subtle.digest('SHA-256', data as BufferSource),
  inflateRaw: null as ((data: Bytes) => Bytes) | null,
};

async function sha256(data: Bytes): Promise<string> {
  const digest = await MODEL_CODEC.sha256(data);
  let out = '';
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, '0');
  return out;
}

function equalBytes(a: Bytes | undefined, b: Bytes | undefined): boolean {
  if (!a || !b || a.length !== b.length) return a === b;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function inflate(content: DbContent): Promise<Bytes> {
  const data = new Uint8Array(content.data.buffer, content.data.byteOffset, content.data.byteLength);
  if (content.enc === 'none') return data.slice();
  if (MODEL_CODEC.inflateRaw) return MODEL_CODEC.inflateRaw(data);
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data as BufferSource).then(() => writer.close());
  const parts: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const counted = (v: { stored: number }) => v.stored + RECORD_BYTES;

/** The model's own thinning schedule (P3.3.4), written apart from core/history/schedule.ts. */
export function modelScheduleKeeps(
  versions: readonly { seq: number; time: number }[],
  now: number,
  newestSeq: number,
  widths: readonly [number, number][] = [
    [5, 1],
    [15, 1],
    [30, 1],
    [60, 1],
    [60, 2],
    [60, 4],
  ],
  cap = 200,
): Set<number> {
  const order = [...versions].sort((a, b) => b.time - a.time || b.seq - a.seq);
  const attempt = (minutes: number, hours: number) => {
    const keep = new Set<number>();
    for (const v of order) if (v.seq === newestSeq) keep.add(v.seq);
    const young = order.filter((v) => now - v.time <= VERSION_AGE);
    young.slice(0, 10).forEach((v) => keep.add(v.seq));
    const seen = new Set<string>();
    for (const v of young) {
      const age = Math.max(0, now - v.time);
      const width = age < DAY ? minutes * MINUTE : age < 7 * DAY ? hours * HOUR : DAY;
      const key = `${age < DAY ? 'a' : age < 7 * DAY ? 'b' : 'c'}:${Math.floor(v.time / width)}`;
      if (!seen.has(key)) {
        seen.add(key);
        keep.add(v.seq);
      }
    }
    return keep;
  };
  let keep = new Set<number>();
  for (const [minutes, hours] of widths) {
    keep = attempt(minutes, hours);
    if (keep.size <= cap) return keep;
  }
  const oldest = order.filter((v) => keep.has(v.seq)).reverse();
  for (const v of oldest) if (keep.size > cap && v.seq !== newestSeq) keep.delete(v.seq);
  return keep;
}

// ---- the model ------------------------------------------------------------------------------------

/** A copy the store promised. */
export interface Promised {
  id: number;
  half: 'trash' | 'versions';
  /** Trash: the file's path when it was deleted or replaced; versions: the file's path now. */
  path: VPath;
  bytes: Bytes;
  hash: string;
  time: number;
  /** The Trash item (half 'trash'). */
  item?: string;
  /** The record that held it at the last check (half 'versions'). */
  holder?: string;
}

/** What the driver tells the checker about the step that just ran. */
export interface StepNote {
  /** A global pass ran in this step. */
  pass: boolean;
  /** The wall clock of the step. */
  now: number;
  /** B as the windows read it in this step. */
  budget: number;
}

export interface HistoryModel {
  /** The commands' view of the files: every change is applied to `files` too. */
  readonly vfs: Vfs;
  /** The history's view: its writes are allowed only where a restore is expected to write. */
  readonly storeVfs: Vfs;
  readonly files: Map<VPath, Bytes>;
  readonly promises: Promised[];
  /** Violations found while the commands ran (act after declined, a write below .git, ...). */
  readonly violations: string[];
  /** Reads the real files into `files` (once at the start). */
  adoptFiles(): Promise<void>;
  /** Wraps a history so that guard, restoreTrash, moved and the drops are booked in the model. */
  watch(history: HistoryService): HistoryService;
  /** Before each step: what the checker needs to know about it. */
  note(step: Partial<StepNote>): void;
  /** Removes promises (a cause the model applies itself). */
  release(test: (p: Promised) => boolean): void;
  /** Called by the driver when B fell: property 4 holds again from the end of the next pass. */
  budgetFell(): void;
  /** Mounts a backend on the real Vfs and on both views (the views see only what is mounted
   *  through the model after it was made). */
  mount(backend: FileSystemBackend): void;
  unmount(name: string): void;
  /** The IndexedDB the history writes to, when the model may read it (restores of items no
   *  promise describes; the root of an opened folder). */
  readonly database?: () => IDBFactory;
  /**
   * The place of `path` (P4.3) as the store keys it: `/folder/<rel>` through the rootId the store
   * gave the opened folder (read with refreshRoots), null where the store tracks nothing (`/memory`,
   * a `/folder` path while no folder is open).
   */
  place(path: VPath): string | null;
  /** Reads the opened folder's rootId from the database again (`factory`, else `database`). */
  refreshRoots(factory?: IDBFactory): Promise<void>;
  /** @internal */
  state: ModelState;
}

/** @internal */
export interface ModelState {
  step: StepNote;
  before: DbSnapshot | null;
  budgetFallen: boolean;
  /** (record:seq:hash) read back through the API already. */
  verified: Set<string>;
  /** The record each file had when its rows were last read back. */
  rows: Map<VPath, string>;
  /** The Trash when trashItems() was last read back. */
  trashSignature: string;
  /** The restores running now: the paths each may write (with the bytes it must write) and the
   *  folders below which it may create folders. */
  restores: Set<{ writes: Map<VPath, Bytes[]>; folders: Set<VPath> }>;
  nextId: number;
  history: HistoryService[];
  /** Trash items the person dropped in this step (Delete for Good, Empty Trash). */
  dropped: Set<string>;
  /** At most what guard copies that went back to living after act counted in the Trash (bytes). */
  transient: number;
  /** The Trash copies promised in this step (several deletes in one step, an Undo of a Copy). */
  stepPromises: Promised[];
  /** Items a restore took files from in this step (pruning leaves them alone, P3.3.4). */
  stepRestoring: Set<string>;
  /** Commands of this stage are running (no write below .git is allowed then). */
  stageCommand: number;
  /** The rootId of each mounted backend that has one in the store (the opened folder), by mount. */
  roots: Map<string, string>;
}

/** Bytes read before, by path: read again only when the modification time or size changed. */
const READ_CACHE = new WeakMap<Vfs, Map<VPath, { mtime: number; size: number; data: Bytes }>>();

async function listFiles(vfs: Vfs, dir: VPath, out: Map<VPath, Bytes>): Promise<void> {
  const stat = await vfs.stat(dir).catch(() => null);
  if (!stat) return;
  if (stat.kind === 'file') {
    let cache = READ_CACHE.get(vfs);
    if (!cache) {
      cache = new Map();
      READ_CACHE.set(vfs, cache);
    }
    const known = cache.get(dir);
    if (known && known.mtime === stat.mtime && known.size === stat.size) {
      out.set(dir, known.data);
      return;
    }
    const data = await vfs.readFile(dir);
    cache.set(dir, { mtime: stat.mtime, size: stat.size, data });
    out.set(dir, data);
    return;
  }
  for (const entry of await vfs.list(dir).catch(() => [])) await listFiles(vfs, `${dir}/${entry.name}`, out);
}

/** The files of every mount except /memory. */
export async function currentFiles(vfs: Vfs): Promise<Map<VPath, Bytes>> {
  const out = new Map<VPath, Bytes>();
  for (const backend of vfs.backends()) {
    if (backend.mount === 'memory') continue;
    await listFiles(vfs, `/${backend.mount}`, out);
  }
  return out;
}

export function createHistoryModel(
  raw: Vfs,
  database?: () => IDBFactory,
  faults: ModelFaults = { vfs: null },
): HistoryModel {
  const files = new Map<VPath, Bytes>();
  const promises: Promised[] = [];
  const violations: string[] = [];
  const state: ModelState = {
    step: { pass: false, now: 0, budget: 64 << 20 },
    before: null,
    budgetFallen: false,
    verified: new Set(),
    rows: new Map(),
    trashSignature: '',
    restores: new Set(),
    nextId: 1,
    history: [],
    dropped: new Set(),
    transient: 0,
    stepPromises: [],
    stepRestoring: new Set(),
    stageCommand: 0,
    roots: new Map(),
  };

  const removeBelow = (path: VPath) => {
    for (const key of [...files.keys()]) if (key === path || key.startsWith(`${path}/`)) files.delete(key);
  };

  const commandHooks: VfsHooks = {
    afterWrite(path, data) {
      if (state.stageCommand > 0 && touchesGit(path))
        violations.push(`a command of the stage wrote below .git: ${path}`);
      files.set(path, data.slice());
    },
    afterRemove(path) {
      if (state.stageCommand > 0 && touchesGit(path))
        violations.push(`a command of the stage removed below .git: ${path}`);
      removeBelow(path);
    },
  };
  const storeHooks: VfsHooks = {
    beforeWrite(path, data) {
      const expected = [...state.restores].flatMap((r) => r.writes.get(path) ?? []);
      if (touchesGit(path)) violations.push(`the history wrote below .git: ${path}`);
      if (expected.length === 0) violations.push(`the history wrote "${path}", which no restore asked for`);
      else if (!expected.some((bytes) => equalBytes(bytes, data))) {
        violations.push(`the history wrote other bytes to "${path}" than the copy it kept`);
      }
    },
    afterWrite(path, data) {
      files.set(path, data.slice());
    },
    beforeRemove(path) {
      violations.push(`the history removed "${path}" by itself`);
    },
    afterRemove(path) {
      removeBelow(path);
    },
    beforeMkdir(path) {
      if (touchesGit(path)) violations.push(`the history created a folder below .git: ${path}`);
      const roots = [...state.restores].flatMap((r) => [...r.folders]);
      if (!roots.some((root) => path === root || path.startsWith(`${root}/`))) {
        violations.push(`the history created the folder "${path}", which no restore asked for`);
      }
    },
  };
  const commandVfs = hookedVfs(raw, commandHooks, faults);
  const storeVfs = hookedVfs(raw, storeHooks, faults);

  const model: HistoryModel = {
    vfs: commandVfs,
    storeVfs,
    files,
    promises,
    violations,
    state,
    ...(database ? { database } : {}),
    place(path) {
      if (!isVPath(path)) return null;
      const { mount } = splitVPath(path);
      if (mount !== 'folder') return placeOf(path);
      // As the store does (history-db.ts place): no opened folder, no place.
      if (!raw.backends().some((b) => b.mount === 'folder')) return null;
      return placeOf(path, state.roots.get('folder') ?? ROOT_NOT_YET);
    },
    async refreshRoots(factory) {
      const source = factory ?? database?.();
      const backend = raw.backends().find((b) => b.mount === 'folder');
      if (!source || !backend) {
        state.roots.delete('folder');
        return;
      }
      const id = await rootIdIn(await readRoots(source), backend);
      if (id === null) state.roots.delete('folder');
      else state.roots.set('folder', id);
    },
    async adoptFiles() {
      files.clear();
      for (const [path, data] of await currentFiles(raw)) files.set(path, data);
    },
    note(step) {
      state.dropped.clear();
      state.transient = 0;
      state.stepPromises = [];
      state.stepRestoring = new Set();
      state.step = { ...state.step, pass: false, ...step };
    },
    release(test) {
      for (let i = promises.length - 1; i >= 0; i--) if (test(promises[i] as Promised)) promises.splice(i, 1);
    },
    budgetFell() {
      state.budgetFallen = true;
    },
    mount(backend) {
      raw.mount(backend);
      commandVfs.mount(new HookedBackend(backend, commandHooks, faults));
      storeVfs.mount(new HookedBackend(backend, storeHooks, faults));
    },
    unmount(name) {
      raw.unmount(name);
      commandVfs.unmount(name);
      storeVfs.unmount(name);
    },
    watch(history) {
      state.history.push(history);
      return watchHistory(model, history);
    },
  };
  return model;
}

interface VfsHooks {
  beforeWrite?(path: VPath, data: Bytes): void;
  afterWrite?(path: VPath, data: Bytes): void;
  beforeRemove?(path: VPath): void;
  afterRemove?(path: VPath): void;
  beforeMkdir?(path: VPath): void;
}

/** A Vfs fault the driver arms: the next write or remove of either view fails. */
export interface ModelFaults {
  vfs: 'write' | 'remove' | null;
}

/**
 * A backend over another that tells `hooks` of every change made through it (and fails one when
 * `faults` says so). The model's two views are Vfs's of createVfs() over such backends, so that
 * fs/vfs.ts stays the one implementation of Vfs (contracts.test.ts).
 */
class HookedBackend implements FileSystemBackend {
  constructor(
    private readonly inner: FileSystemBackend,
    private readonly hooks: VfsHooks,
    private readonly faults: ModelFaults,
  ) {}

  get mount(): string {
    return this.inner.mount;
  }
  get kind(): FileSystemBackend['kind'] {
    return this.inner.kind;
  }
  get label(): string {
    return this.inner.label;
  }
  get rootHandle(): unknown {
    return (this.inner as { rootHandle?: unknown }).rootHandle;
  }

  private path(rel: string): VPath {
    return rel === '' ? `/${this.inner.mount}` : `/${this.inner.mount}/${rel}`;
  }

  private fail(kind: 'write' | 'remove', rel: string): void {
    if (this.faults.vfs !== kind) return;
    this.faults.vfs = null;
    throw new Error(`The disk refused to ${kind} "${this.path(rel)}".`);
  }

  stat(rel: string): Promise<FileStat | null> {
    return this.inner.stat(rel);
  }
  readFile(rel: string): Promise<Bytes> {
    return this.inner.readFile(rel);
  }
  list(rel: string): Promise<DirEntry[]> {
    return this.inner.list(rel);
  }
  async writeFile(rel: string, data: Bytes): Promise<void> {
    this.fail('write', rel);
    this.hooks.beforeWrite?.(this.path(rel), data);
    await this.inner.writeFile(rel, data);
    this.hooks.afterWrite?.(this.path(rel), data);
  }
  async appendFile(rel: string, data: Bytes): Promise<void> {
    this.fail('write', rel);
    await this.inner.appendFile(rel, data);
    this.hooks.afterWrite?.(this.path(rel), await this.inner.readFile(rel));
  }
  async remove(rel: string): Promise<void> {
    this.fail('remove', rel);
    this.hooks.beforeRemove?.(this.path(rel));
    await this.inner.remove(rel);
    this.hooks.afterRemove?.(this.path(rel));
  }
  async mkdirp(rel: string): Promise<void> {
    this.hooks.beforeMkdir?.(this.path(rel));
    await this.inner.mkdirp(rel);
  }
}

/** A Vfs of createVfs() over hooked views of `raw`'s backends. */
function hookedVfs(raw: Vfs, hooks: VfsHooks, faults: ModelFaults): Vfs {
  const vfs = createVfs();
  for (const backend of raw.backends()) vfs.mount(new HookedBackend(backend, hooks, faults));
  return vfs;
}

/** The wrapper of model.watch: books guards, restores and drops in the model. */
function watchHistory(model: HistoryModel, history: HistoryService): HistoryService {
  const { state, files, promises, violations } = model;
  const keep = async (p: Omit<Promised, 'id' | 'hash'>) => {
    const promised = { ...p, id: state.nextId++, hash: await sha256(p.bytes) };
    promises.push(promised);
    if (p.half === 'trash') state.stepPromises.push(promised);
  };
  const releaseVersionsAt = async (paths: readonly VPath[]) => {
    await model.refreshRoots();
    const places = new Set(paths.map((path) => model.place(path)).filter((place) => place !== null));
    model.release((p) => p.half === 'versions' && places.has(model.place(p.path) ?? ''));
  };
  const stage = async <T>(fn: () => Promise<T>): Promise<T> => {
    state.stageCommand++;
    try {
      return await fn();
    } finally {
      state.stageCommand--;
    }
  };

  const guard: HistoryService['guard'] = (path, how, act, confirm) =>
    stage(async () => {
      let answered: boolean | null = null;
      let confirmedBeforeAct = false;
      let acted = false;
      let actResolved = false;
      let atAct = new Map<VPath, Bytes>();
      const result = await history
        .guard(
          path,
          how,
          async (seen: readonly SeenFile[]) => {
            if (answered === false) violations.push(`guard called act after "${path}" was declined`);
            acted = true;
            confirmedBeforeAct = answered === true;
            atAct = new Map(
              seen.flatMap((file) => (files.has(file.path) ? [[file.path, files.get(file.path) as Bytes]] : [])),
            );
            await act(seen);
            actResolved = true;
          },
          async () => {
            const answer = await confirm();
            answered = answer;
            return answer;
          },
        )
        .catch((error: unknown) => {
          return { failed: error } as const;
        });
      // What act removed (delete) or overwrote (replace, restore). A file another window changed
      // while act ran is not act's doing: act leaves it (P3.3.4 step 4). A Replace or Restore whose
      // act resolved overwrote its file, also with the same bytes (open case 5: "for a replace or a
      // restore, when act resolved"; seed 10480, a move onto a copy of itself).
      const touched = [...atAct.entries()].filter(([file, bytes]) =>
        how === 'delete' ? !files.has(file) : actResolved || !equalBytes(files.get(file), bytes),
      );
      const outcome = 'failed' in result ? null : result.outcome;
      if (outcome === 'declined' && acted) violations.push(`guard of "${path}" declined after act ran`);
      if (outcome === 'not-kept' && touched.length > 0 && !confirmedBeforeAct) {
        violations.push(`guard of "${path}" removed or overwrote files without a copy and without a Yes`);
      }
      if ((outcome === 'kept' || outcome === null) && touched.length > 0 && answered === null) {
        // Kept: every file act removed or overwrote has its copy (property 2).
        for (const [file, bytes] of touched) {
          if (how === 'restore') {
            await keep({ half: 'versions', path: file, bytes, time: state.step.now });
          } else {
            const item = 'failed' in result ? undefined : result.item;
            if (!item) violations.push(`guard of "${path}" removed "${file}" and kept no Trash item`);
            else await keep({ half: 'trash', path: file, bytes, time: state.step.now, item });
          }
        }
        // A file that went into the Trash takes its earlier versions with it (open case 6).
        if (how !== 'restore') await releaseVersionsAt(touched.map(([file]) => file));
      }
      if (outcome === 'not-kept' && how !== 'restore') await releaseVersionsAt(touched.map(([file]) => file));
      if (how !== 'restore') {
        for (const [file, bytes] of atAct) {
          if (!touched.some(([t]) => t === file)) state.transient += bytes.length + 2 * RECORD_BYTES;
        }
      }
      if ('failed' in result) throw result.failed;
      return result;
    });

  const restoreTrash: HistoryService['restoreTrash'] = (id, options) =>
    stage(async () => {
      // What the store may write: the copies of the item's records, read from the database when
      // the model knows it (a page closed during a delete leaves an item no promise describes),
      // else the promises of the item.
      const mine: { path: VPath; bytes: Bytes; promise?: Promised }[] = promises
        .filter((p) => p.half === 'trash' && p.item === id)
        .map((p) => ({ path: p.path, bytes: p.bytes, promise: p }));
      if (model.database) {
        const db = await readHistoryDatabase(model.database(), (snap) => {
          const out: string[] = [];
          for (const [fileId, record] of snap.files) {
            if (record.trash?.item !== id) continue;
            const copy = (snap.versions.get(fileId) ?? []).find((v) => v.seq === record.newestSeq);
            if (copy) out.push(copy.hash);
          }
          return out;
        });
        for (const [fileId, record] of db.files) {
          if (record.trash?.item !== id || record.dir) continue;
          const copy = (db.versions.get(fileId) ?? []).find((v) => v.seq === record.newestSeq);
          const content = copy ? db.contents.get(copy.hash) : undefined;
          if (!content || mine.some((m) => m.path === record.spelling)) continue;
          mine.push({ path: record.spelling, bytes: await inflate(content) });
        }
      }
      const items = await history.trashItems();
      const info = items.find((i) => i.id === id);
      const itemsBefore = new Set(items.map((i) => i.id));
      state.stepRestoring.add(id);
      const confirmed = new Set<VPath>();
      const answers = new Map<VPath, string>();
      const before = new Map(files);
      const allowed = (target: VPath) => {
        // The store may write the copy at its place, beside it, or below a fallback folder. Of
        // several files that could land there (prog.X68 written beside as prog (restored).X68
        // next to a file of that name), the one whose bytes the place holds now is the one written.
        const fits = mine.filter((p) => {
          if (target === p.path || [1, 2, 3, 4, 5, 6].some((n) => besideName(p.path, n) === target)) return true;
          if (!fallbackRoot || !info) return false;
          const rel = info.kind === 'file' ? '' : p.path.slice(info.path.length);
          const top = info.path.slice(info.path.lastIndexOf('/'));
          // In the folder chosen too, a taken name may be answered with `beside` (seed 9397).
          const there: VPath = `${fallbackRoot}${top}${rel}`;
          return target === there || [1, 2, 3, 4, 5, 6].some((n) => besideName(there, n) === target);
        });
        return fits.find((p) => equalBytes(p.bytes, files.get(target))) ?? fits[0] ?? null;
      };
      let fallbackRoot: VPath | null = null;
      const expect = { writes: new Map<VPath, Bytes[]>(), folders: new Set<VPath>() };
      const allow = (path: VPath, bytes: Bytes) => expect.writes.set(path, [...(expect.writes.get(path) ?? []), bytes]);
      state.restores.add(expect);
      for (const p of mine) {
        allow(p.path, p.bytes);
        for (let n = 1; n <= 6; n++) allow(besideName(p.path, n), p.bytes);
      }
      if (info) expect.folders.add(info.path);
      const result = await history
        .restoreTrash(id, {
          ...options,
          ask: async (path) => {
            const answer = await options.ask(path);
            answers.set(path, answer);
            return answer;
          },
          fallback: async (item: TrashItemInfo) => {
            const folder = await options.fallback(item);
            fallbackRoot = folder;
            if (folder) {
              expect.folders.add(folder);
              for (const p of mine) {
                const target =
                  item.kind === 'file'
                    ? `${folder}${item.path.slice(item.path.lastIndexOf('/'))}`
                    : `${folder}${item.path.slice(item.path.lastIndexOf('/'))}${p.path.slice(item.path.length)}`;
                allow(target, p.bytes);
                for (let n = 1; n <= 6; n++) allow(besideName(target, n), p.bytes);
              }
            }
            return folder;
          },
          confirm: async (path) => {
            const answer = await options.confirm(path);
            if (answer) confirmed.add(path);
            return answer;
          },
        })
        .finally(() => state.restores.delete(expect));
      if (globalThis.process?.env?.EASY68K_HISTORY_DEBUG)
        console.log(
          'RESTORE',
          JSON.stringify({
            id,
            mine: mine.map((m) => [m.path, m.bytes.length, !!m.promise]),
            fallbackRoot,
            result,
            answers: [...answers],
            confirmed: [...confirmed],
            found: result.restored.map((t) => allowed(t)?.path ?? null),
          }),
        );
      for (const target of result.restored) {
        const found = allowed(target);
        if (!found) {
          violations.push(`restoreTrash wrote "${target}", which is not a file of item ${id}`);
          continue;
        }
        // The copy is the current file again: its promise is kept (the file holds its bytes).
        if (found.promise) {
          const id1 = found.promise.id;
          model.release((q) => q.id === id1);
        }
        const old = before.get(target);
        if (old && answers.get(target) === 'replace') {
          if (confirmed.has(target)) {
            await releaseVersionsAt([target]);
          } else {
            // The item this restore made (other Replaced items of the same path may be older).
            const replaced = (await history.trashItems()).find(
              (i) => i.cause === 'replaced' && i.path === target && !itemsBefore.has(i.id),
            );
            if (replaced)
              await keep({ half: 'trash', path: target, bytes: old, time: state.step.now, item: replaced.id });
            else violations.push(`restoreTrash replaced "${target}" without a copy and without a Yes`);
            await releaseVersionsAt([target]);
          }
        }
      }
      return result;
    });

  return {
    ...history,
    state: () => history.state(),
    untracked: (path, size, head) => history.untracked(path, size, head),
    record: (path, data, reason, time) => history.record(path, data, reason, time),
    versions: (path) => history.versions(path),
    read: (path, seq) => history.read(path, seq),
    trashItems: () => history.trashItems(),
    subscribe: (listener) => history.subscribe(listener),
    usage: () => history.usage(),
    guard,
    restoreTrash,
    // A member that rejects did not do its work (errata N3, "When a transaction fails"): the model
    // keeps what it promised as it was, and the step's command goes on as its caller does.
    async dropTrash(ids) {
      await history.dropTrash(ids);
      for (const id of ids) state.dropped.add(id);
      const gone = new Set(ids);
      model.release((p) => p.half === 'trash' && gone.has(p.item ?? ''));
    },
    async moved(from, to) {
      // Rejected: the records stayed at `from`, and so do the promises.
      await stage(() => history.moved(from, to));
      // The history follows by place (P4.3: the browser store ignores letter case).
      await model.refreshRoots();
      const fromPlace = model.place(from);
      for (const p of promises) {
        const place = model.place(p.path);
        if (p.half !== 'versions' || !fromPlace || !place) continue;
        if (place === fromPlace || place.startsWith(`${fromPlace}/`)) p.path = to + p.path.slice(from.length);
      }
    },
    async clearVersions() {
      try {
        await history.clearVersions();
      } finally {
        // The person asked for every earlier version to go: also when it rejects after some batches,
        // what went had a cause (what stayed is still readable, and checked as such by (5) and (6)).
        model.release((p) => p.half === 'versions');
      }
    },
    async deleteAll() {
      await history.deleteAll();
      model.release(() => true);
    },
  };
}

// ---- the checker -----------------------------------------------------------------------------------

/**
 * The seven properties of P3.3.1, checked after a step: `db` is the IndexedDB the history writes
 * to (for createMemoryHistoryService, historyDatabaseOf of fs/history-memory.ts), `vfs` the real
 * Vfs, `model` the model the commands booked into. Returns the violations (empty when all hold).
 */
/** Byte arrays of the model already found equal to the file's bytes. */
const SAME = new WeakMap<Bytes, Bytes>();

export async function checkHistoryInvariants(db: IDBFactory, vfs: Vfs, model: HistoryModel): Promise<string[]> {
  const out = [...model.violations];
  model.violations.length = 0;
  const { state } = model;
  // The bytes of the Trash copies not read back yet (property 6).
  const after = await readHistoryDatabase(db, (snap) => {
    const out: string[] = [];
    for (const [fileId, record] of snap.files) {
      if (!record.trash || record.dir) continue;
      const copy = (snap.versions.get(fileId) ?? []).find((v) => v.seq === record.newestSeq);
      if (copy && !state.verified.has(`${fileId}:${copy.seq}:${copy.hash}`)) out.push(copy.hash);
    }
    return out;
  });
  // The opened folder's places go through its rootId, as the store keys them (P4.3).
  await model.refreshRoots(db);
  const before = state.before;
  const limit = Math.floor(state.step.budget / 2);

  // (1) The files are the model's files: only the stated effects of the commands happened.
  const real = await currentFiles(vfs);
  for (const [path, bytes] of real) {
    if (!model.files.has(path)) out.push(`(1) "${path}" exists but no command made it`);
    else {
      // Compared once per pair of byte arrays: neither changes after it is made.
      const expected = model.files.get(path) as Bytes;
      if (SAME.get(expected) !== bytes) {
        if (!equalBytes(expected, bytes)) out.push(`(1) "${path}" holds bytes no command wrote`);
        else SAME.set(expected, bytes);
      }
    }
  }
  const mounted = new Set(vfs.backends().map((b) => b.mount));
  for (const path of model.files.keys()) {
    // A store that is not mounted now (the desktop disk out of reach) keeps its files unseen.
    if (!real.has(path) && mounted.has(path.split('/')[1] ?? ''))
      out.push(`(1) "${path}" is gone but no command removed it`);
  }

  // (5) Nothing is unreachable, and every record is counted right.
  const recomputed = { versions: 0, trash: 0 };
  const living = new Map<string, string>();
  const hashes = new Set<string>();
  for (const [id, record] of after.files) {
    const versions = after.versions.get(id) ?? [];
    if (record.live !== undefined) {
      if (record.live !== record.place) out.push(`(5) record ${id}: live is not its place`);
      if (living.has(record.live)) out.push(`(5) two living records of ${record.live}`);
      living.set(record.live, id);
      if (record.dir) out.push(`(5) the dir record ${id} is living`);
      if (record.trash) out.push(`(5) record ${id} is living and in the Trash`);
    } else if (!record.trash || typeof record.trash.item !== 'string') {
      out.push(`(5) record ${id} is neither living nor in a Trash item`);
    }
    if (record.trash && !record.dir && !versions.some((v) => v.seq === record.newestSeq)) {
      out.push(`(5) record ${id} in the Trash has no copy`);
    }
    if (record.count !== versions.length)
      out.push(`(5) record ${id}: count ${record.count}, versions ${versions.length}`);
    const bytes = RECORD_BYTES + versions.reduce((n, v) => n + counted(v), 0);
    if (record.bytes !== bytes) out.push(`(5) record ${id}: bytes ${record.bytes}, counted ${bytes}`);
    const newest = versions.reduce<DbVersion | null>((best, v) => (!best || v.seq > best.seq ? v : best), null);
    if (newest && (newest.seq !== record.newestSeq || newest.hash !== record.newestHash)) {
      out.push(`(5) record ${id}: newestSeq/newestHash do not match its newest version`);
    }
    if (newest && record.lastSeq < newest.seq) out.push(`(5) record ${id}: lastSeq below a seq`);
    if (versions.length === 0 && !record.dir) out.push(`(5) record ${id} has no version`);
    recomputed[record.trash ? 'trash' : 'versions'] += RECORD_BYTES;
    for (const v of versions) {
      recomputed[record.trash && v.seq === record.newestSeq ? 'trash' : 'versions'] += counted(v);
      hashes.add(v.hash);
      if (!after.contents.has(v.hash)) out.push(`(5) version ${id}/${v.seq} names a content that is not stored`);
    }
  }
  for (const id of after.versions.keys())
    if (!after.files.has(id)) out.push(`(5) versions of a record that does not exist: ${id}`);
  for (const hash of after.contents.keys())
    if (!hashes.has(hash)) out.push(`(5) the content ${hash.slice(0, 12)} is named by no version`);

  // (4) Bounded, and the totals are the sums of the records.
  if (after.totals.versions !== recomputed.versions || after.totals.trash !== recomputed.trash) {
    out.push(`(4) totals ${JSON.stringify(after.totals)} but the records sum to ${JSON.stringify(recomputed)}`);
  }
  if (state.step.pass) state.budgetFallen = false;
  if (!state.budgetFallen) {
    if (after.totals.versions > limit)
      out.push(`(4) the versions half holds ${after.totals.versions} > B / 2 = ${limit}`);
    if (after.totals.trash > limit) out.push(`(4) the Trash half holds ${after.totals.trash} > B / 2 = ${limit}`);
  }

  // (2) Nothing current is destroyed without a copy: every promise is kept, or its loss explained.
  const byItem = new Map<string, [string, DbFile][]>();
  for (const entry of after.files) {
    const item = entry[1].trash?.item;
    if (item) byItem.set(item, [...(byItem.get(item) ?? []), entry]);
  }
  if (globalThis.process?.env?.EASY68K_HISTORY_DEBUG) {
    for (const p of model.promises) {
      if (p.half !== 'versions') continue;
      const holders = [...after.files]
        .filter(([fid]) => (after.versions.get(fid) ?? []).some((v) => v.hash === p.hash))
        .map(([fid, r]) => `${fid}@${r.live ?? `trash:${r.trash?.item}`}`);
      console.log(
        `HOLDERS ${p.id} ${model.place(p.path)} living=${living.get(model.place(p.path) ?? '')} ${holders.join(' ')}`,
      );
    }
  }
  const filePlaces = new Set([...model.files.keys()].map((path) => model.place(path) ?? ''));
  for (const p of [...model.promises]) {
    let found = false;
    if (p.half === 'trash') {
      for (const [id, record] of byItem.get(p.item ?? '') ?? []) {
        const copy = (after.versions.get(id) ?? []).find((v) => v.seq === record.newestSeq);
        if (copy && copy.hash === p.hash) found = true;
      }
    } else {
      // The record of the file holds it: the living record of its place, or the record that held it
      // at the last check (`holder`) wherever that record is now: in the Trash while its file still
      // exists (a page closed during a delete, P3.3.4; the file may have moved since, seed 14580), or
      // living where a restore wrote its copy (beside a name taken meanwhile, in a folder chosen;
      // seed 4590), whose path the promise then takes. Not any other record that happens to hold the
      // same bytes (a copy of the file deleted elsewhere): that would hide the step in which the
      // file's own record lost the version (seed 9490).
      const place = model.place(p.path) ?? '';
      const holds = (fid: string | undefined): fid is string =>
        !!fid && (after.versions.get(fid) ?? []).some((v) => v.hash === p.hash);
      const live = living.get(place);
      if (holds(live)) {
        p.holder = live;
        found = true;
      } else if (holds(p.holder)) {
        const record = after.files.get(p.holder) as DbFile;
        if (record.live === undefined) found = true;
        else if (record.live !== place && filePlaces.has(record.live)) {
          // Living elsewhere only where a file is: a record left at a place that holds no file (a
          // move whose history did not follow, but reported that it did) hides the version from
          // the file's Earlier Versions, and is a loss (seed 7064 against the store as it was).
          p.path = record.spelling as VPath;
          found = true;
        }
      }
    }
    if (found) continue;
    const why = explainLoss(p, before, after, state, model.place(p.path));
    if (why) model.release((q) => q.id === p.id);
    else {
      const held =
        p.half === 'trash'
          ? (byItem.get(p.item ?? '') ?? []).map(([id, r]) => {
              const copy = (after.versions.get(id) ?? []).find((v) => v.seq === r.newestSeq);
              return `${r.spelling}${r.dir ? ' (folder)' : ''} copy ${copy?.hash.slice(0, 8) ?? 'none'}`;
            })
          : (after.versions.get(living.get(model.place(p.path) ?? '') ?? '') ?? []).map(
              (v) => `${v.seq}:${v.hash.slice(0, 8)}`,
            );
      if (globalThis.process?.env?.EASY68K_HISTORY_DEBUG) {
        const show = (s: DbSnapshot | null) =>
          [...(s?.files ?? new Map<string, DbFile>()).entries()]
            .map(
              ([id, r]) =>
                `${id} ${JSON.stringify(r)} v=${(s?.versions.get(id) ?? []).map((v) => `${v.seq}:${v.hash.slice(0, 8)}@${v.time}`).join(',')}`,
            )
            .join('\n');
        console.log(`BEFORE\n${show(before)}\nAFTER\n${show(after)}`);
      }
      out.push(
        `(2) the ${p.half === 'trash' ? `Trash copy (item ${p.item})` : 'earlier version'} of "${p.path}" (${p.hash.slice(0, 8)}, ${p.bytes.length} bytes) kept at ${p.time} is gone without a cause; the store holds: ${held.join(', ') || 'nothing'}`,
      );
    }
  }

  // (6) What is shown can be restored.
  // The window opened last (an earlier one may have been closed).
  for (const history of [...state.history].reverse()) {
    if (history.state() === 'unavailable') continue;
    // A file whose record (and so whose rows) did not change since the last check was read back
    // then; its rows are read again only when its record or its path changed.
    const seen = new Map<VPath, string>();
    for (const path of model.files.keys()) {
      const data = model.files.get(path) as Bytes;
      if (untrackedReason(path, data.length, data) === 'memory') continue;
      const id = living.get(model.place(path) ?? '');
      const record = id ? after.files.get(id) : undefined;
      const signature = `${id}:${record?.newestSeq}:${record?.count}:${record?.lastSeq}`;
      seen.set(path, signature);
      if (state.rows.get(path) === signature) continue;
      const rows = await history.versions(path);
      if (rows.length !== (record?.count ?? 0))
        out.push(`(6) versions("${path}") lists ${rows.length} of ${record?.count ?? 0}`);
      for (const row of rows) {
        const stored = (after.versions.get(id ?? '') ?? []).find((v) => v.seq === row.seq);
        if (!stored) {
          out.push(`(6) versions("${path}") lists ${row.seq}, which the database does not hold`);
          continue;
        }
        const key = `${id}:${row.seq}:${stored.hash}`;
        if (state.verified.has(key)) continue;
        try {
          const bytes = await history.read(path, row.seq);
          if (bytes.length !== stored.size || (await sha256(bytes)) !== stored.hash)
            out.push(`(6) read("${path}", ${row.seq}) gives other bytes`);
          else state.verified.add(key);
        } catch (error) {
          out.push(`(6) read("${path}", ${row.seq}) failed: ${String(error)}`);
        }
      }
    }
    state.rows = seen;
    // The Trash as listed: read again only when a record in it changed.
    const trashSignature = JSON.stringify(
      [...byItem.entries()].map(([item, records]) => [item, records.map(([id, r]) => [id, r.newestSeq, r.count])]),
    );
    if (trashSignature === state.trashSignature) break;
    state.trashSignature = trashSignature;
    const items = await history.trashItems();
    if (items.length !== byItem.size)
      out.push(`(6) trashItems lists ${items.length} items, the database holds ${byItem.size}`);
    for (const item of items) {
      const records = byItem.get(item.id) ?? [];
      if (records.length === 0) out.push(`(6) trashItems lists ${item.id}, which has no record`);
      for (const [id, record] of records) {
        if (record.dir) continue;
        const copy = (after.versions.get(id) ?? []).find((v) => v.seq === record.newestSeq);
        const content = copy ? after.contents.get(copy.hash) : undefined;
        if (!copy || !content) continue; // reported by (5)
        const key = `${id}:${copy.seq}:${copy.hash}`;
        if (state.verified.has(key)) continue;
        const bytes = await inflate(content).catch(() => null);
        if (!bytes || bytes.length !== copy.size || (await sha256(bytes)) !== copy.hash) {
          out.push(`(6) the copy of "${record.spelling}" in the Trash does not read back`);
        } else state.verified.add(key);
      }
    }
    break; // one window's view is enough: they share the database
  }
  for (const [, record] of after.files) {
    if (touchesGit(record.spelling)) out.push(`(7) the history keeps "${record.spelling}", which is in a .git folder`);
  }
  state.before = after;
  return out;
}

/**
 * Why promise `p` may be gone, by the rules of P3.3.4 applied by the model, or null: expiry, the
 * schedule and the cap on its record, or pruning of its half in that half's order by a change that
 * needed the room (or a pass while the half was above B / 2, or the lowering when storage is tight).
 */
function explainLoss(
  p: Promised,
  before: DbSnapshot | null,
  after: DbSnapshot,
  state: ModelState,
  place: string | null,
): string | null {
  const { now, budget, pass } = state.step;
  const limit = Math.floor(budget / 2);
  if (pass && p.half === 'trash' && p.time < now - TRASH_AGE) return 'expired';
  if (!before) return null;
  const lowered =
    pass &&
    JSON.stringify(before.notice) !== JSON.stringify(after.notice) &&
    (after.notice as { armed?: boolean } | undefined)?.armed === false;
  // What the step added to each half.
  const added = { versions: 0, trash: 0 };
  for (const [id, record] of after.files) {
    const old = before.files.get(id);
    const oldVersions = new Set((before.versions.get(id) ?? []).map((v) => v.seq));
    if (!old) added[record.trash ? 'trash' : 'versions'] += RECORD_BYTES;
    for (const v of after.versions.get(id) ?? []) {
      const half = record.trash && v.seq === record.newestSeq ? 'trash' : 'versions';
      const wasHalf = old ? (old.trash && v.seq === old.newestSeq ? 'trash' : 'versions') : null;
      if (!oldVersions.has(v.seq) || wasHalf !== half) added[half] += counted(v);
    }
    if (old && !!old.trash !== !!record.trash) added[record.trash ? 'trash' : 'versions'] += RECORD_BYTES;
    // A copy that moved back with its record (a restore, or guard giving a place back) is admitted
    // to the versions half when it can be kept at all (D-e, errata N3): at most 1 MB, and its record
    // and copy at most B / 2 (everything else in the half may be pruned for it). Admitted, it counts
    // as added also when the step removed it again; one that cannot be kept adds nothing, and
    // nothing may be pruned for it.
    if (old?.trash && !record.trash) {
      const copy = (before.versions.get(id) ?? []).find((v) => v.seq === old.newestSeq);
      if (copy && !(after.versions.get(id) ?? []).some((v) => v.seq === copy.seq) && keepable(copy, limit))
        added.versions += counted(copy);
    }
  }
  // The same rule for a record of an item being restored that went altogether (a living record
  // without versions is not kept, open case 4).
  for (const [id, old] of before.files) {
    if (!old.trash || after.files.has(id) || !state.stepRestoring.has(old.trash.item)) continue;
    const copy = (before.versions.get(id) ?? []).find((v) => v.seq === old.newestSeq);
    if (copy && keepable(copy, limit)) added.versions += counted(copy);
  }
  // Copies guard kept in this step whose records went back to living after act (files act left,
  // a failed act) passed Trash admission on their way: they count as what the step added there.
  added.trash += state.transient;
  // Items kept in this step and pruned again within it (by a later change of the same step) were
  // in the Trash half when that change was admitted (their stored size is at most their bytes).
  for (const q of state.stepPromises) {
    if (![...after.files.values()].some((r) => r.trash?.item === q.item))
      added.trash += q.bytes.length + 2 * RECORD_BYTES;
  }
  const needed = (half: 'versions' | 'trash') =>
    lowered || (pass && before.totals[half] > limit) || before.totals[half] + added[half] > limit || state.budgetFallen;
  if (p.half === 'trash') {
    if (globalThis.process?.env?.EASY68K_HISTORY_DEBUG)
      console.log(
        'NEEDED',
        JSON.stringify({
          before: before.totals,
          added,
          after: after.totals,
          limit,
          pass,
          lowered,
          fallen: state.budgetFallen,
          item: p.item,
          older: [...before.files.values()]
            .filter((r) => r.trash)
            .map((r) => [
              r.trash?.item,
              r.trash?.at,
              !!r.trash?.pending,
              [...after.files.values()].some((x) => x.trash?.item === r.trash?.item),
            ]),
        }),
      );
    if (!needed('trash')) return null;
    // Oldest item first: every item older than p's that was there before is gone too, unless pending.
    // The time the item went into the Trash (one kept in this very step is not in `before`).
    let at = p.time;
    for (const record of before.files.values()) {
      if (record.trash && record.trash.item === p.item) at = Math.min(at, record.trash.at);
    }
    for (const record of before.files.values()) {
      const mark = record.trash;
      if (!mark || mark.at >= at || mark.pending || state.stepRestoring.has(mark.item)) continue;
      if ([...after.files.values()].some((r) => r.trash?.item === mark.item)) return null;
    }
    return 'pruned oldest first';
  }
  // Versions half: its record in the step before (place: the place of p.path, model.place).
  const holds = (id: string) => (before.versions.get(id) ?? []).some((v) => v.hash === p.hash);
  const entry =
    [...before.files.entries()].find(([id, r]) => r.live === place && holds(id)) ??
    [...before.files.entries()].find(([id]) => id === p.holder && holds(id)) ??
    [...before.files.entries()].find(([, r]) => r.live === place);
  if (!entry) return before.totals.trash + added.trash > limit || needed('versions') ? 'its record left' : null;
  const mark = entry[1].trash;
  if (mark && !after.files.has(entry[0])) {
    // Its record was in the Trash and went with its item.
    if (state.dropped.has(mark.item) || (pass && mark.at < now - TRASH_AGE) || needed('trash')) return 'its item went';
  }
  const [id, record] = entry;
  const old = before.versions.get(id) ?? [];
  const mine = old.find((v) => v.hash === p.hash);
  if (!mine) return null;
  // Expiry goes by the version's own time: a copy equal to the newest version is that version
  // (P3.3.5: a save equal to the newest stores nothing), which may be older than the promise.
  if (pass && mine.time < now - VERSION_AGE && mine.seq !== record.newestSeq) return 'expired';
  // The record was pushed out of its place and its copy did not fit the Trash (open case 1).
  if (!after.files.has(id) && before.totals.trash + added.trash + counted(mine) > limit)
    return 'pushed out without room';
  // The schedule and the cap after a version kept for it.
  const newer = (after.versions.get(id) ?? []).filter((v) => !old.some((o) => o.seq === v.seq));
  if (newer.length > 0) {
    const all = [...old, ...newer];
    const newest = all.reduce((best, v) => (v.seq > best.seq ? v : best));
    for (const added1 of newer) {
      const upTo = all.filter((v) => v.seq <= added1.seq);
      if (!modelScheduleKeeps(upTo, now, added1.seq).has(mine.seq)) return 'thinned';
    }
    if (!modelScheduleKeeps(all, now, newest.seq).has(mine.seq)) return 'thinned';
  }
  if (!needed('versions')) return null;
  // Pruning step 1: the widened schedule on its record.
  if (!modelScheduleKeeps(old, now, record.newestSeq, [[60, 4]], Infinity).has(mine.seq)) return 'widened schedule';
  // Pruning step 2: oldest first. Every version of the half older than it is gone too.
  for (const [otherId, versions] of before.versions) {
    const other = before.files.get(otherId);
    if (!other) continue;
    for (const v of versions) {
      if (other.trash && v.seq === other.newestSeq) continue;
      // A copy that went into the Trash half in this step (the step's own delete kept it before the
      // pruning) was no longer in the versions half (seed 3694).
      const otherAfter = after.files.get(otherId);
      if (otherAfter?.trash && v.seq === otherAfter.newestSeq) continue;
      if (v.time > mine.time || (v.time === mine.time && (otherId > id || (otherId === id && v.seq >= mine.seq))))
        continue;
      if ((after.versions.get(otherId) ?? []).some((w) => w.seq === v.seq)) return null;
    }
  }
  return 'pruned oldest first';
}

/**
 * True when a copy moving back from the Trash with its record can be kept in the versions half
 * (P3.3.4, D-e): at most 1 MB, and its record and copy together at most B / 2 = `limit`.
 */
function keepable(copy: DbVersion, limit: number): boolean {
  return copy.size <= LARGEST_VERSION && RECORD_BYTES + counted(copy) <= limit;
}

/** The largest version the versions half admits, for the driver. */
export const MODEL_LARGEST_VERSION = LARGEST_VERSION;

// ---- the command driver -------------------------------------------------------------------------------
//
// Seeded sequences of the commands of P3.2.2 (Delete), P3.2.4 (Move, Copy, Rename, Import),
// P3.2.7 (Undo) and P3.3.8 (Earlier Versions' Restore, the Trash's Restore, Delete for Good, Empty
// Trash), and what happens around them: saves and opens, the switch, the clock and the global
// pass, a second window whose steps run at the same time, a transaction aborted in the middle, a
// Vfs write or remove that fails, a page closed (also between guard's keep and its act), B lowered,
// storage made tight, a store unmounted. Each command follows its section step by step as the Files
// panel and the dialogs do (N4, N5), with `confirm` and the questions answered from the seed.

/** A random generator from a seed (mulberry32): the same seed gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The settings the driver's windows read the `history` switch from. */
export interface DriverSettings {
  get(): never;
  update(): void;
  subscribe(listener: () => void): () => void;
}

/** What the driver controls of the world around the history. */
export interface DriverWorld {
  /** The quota the estimate gives (undefined: no estimate, B = 64 MB). */
  quota: number | undefined;
  usage: number;
  /** The wall clock (ms since 1970). */
  now: number;
  /** The Vfs the history uses (model.storeVfs, with the faults). */
  storeVfs: Vfs;
  /** The IndexedDB with the faults (a transaction aborted in the middle). */
  factory: IDBFactory;
  clock: { now(): number; wallTime(): Date };
  settings: DriverSettings;
}

/** A store of history-db.ts as the driver needs it. */
export interface DriverStore extends HistoryService {
  globalPass(): Promise<void>;
  settled(): Promise<void>;
  close(): void;
}

export interface DriverOptions {
  seed: number;
  steps: number;
  /** A fresh IndexedDB for this sequence. */
  factory: IDBFactory;
  /** The IndexedDB the checker reads (default: `factory`), for a store that has its own. */
  database?: () => IDBFactory;
  /** Opens a window: a store over world.factory, world.storeVfs, world.clock, world.settings and
   *  an estimate of world.quota and world.usage. */
  openWindow(world: DriverWorld): DriverStore;
  /** Two windows, aborted transactions and closed pages (false: one window and none of these, as
   *  for createMemoryHistoryService). */
  windows: boolean;
  /** Called after every step with its text. */
  trace?: (step: number, text: string) => void;
}

export interface DriverResult {
  failure: { step: number; text: string; violations: string[] } | null;
  steps: string[];
  stats: Record<string, number>;
}

const START_TIME = Date.UTC(2026, 10, 2, 9, 0, 0);
const MB_ = 1 << 20;

function budgetOf(quota: number | undefined): number {
  return quota === undefined ? 64 * MB_ : Math.min(64 * MB_, Math.floor(quota * 0.1));
}

/** Runs one seeded sequence and checks the seven properties after every step. */
export async function runModelSequence(options: DriverOptions): Promise<DriverResult> {
  const { MemoryBackend } = await import('./memory-backend');
  const random = seededRandom(options.seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const chance = (p: number) => random() < p;
  // Choices added after a seed range was searched draw from a stream of their own, so that every
  // seed keeps the sequence of steps it had (a seed named in a regression case replays the steps
  // that once failed).
  const later = seededRandom(options.seed + 0x9e3779b9);
  const stats: Record<string, number> = {};
  const count = (key: string) => {
    stats[key] = (stats[key] ?? 0) + 1;
  };

  const switchState = { on: true };
  const listeners = new Set<() => void>();
  const world: DriverWorld = {
    now: START_TIME,
    quota: chance(0.5) ? 40 * MB_ : chance(0.5) ? undefined : 120 * MB_,
    usage: 0,
    clock: { now: () => world.now, wallTime: () => new Date(world.now) },
    storeVfs: undefined as never, // set below, once the model exists
    factory: null as unknown as IDBFactory,
    settings: {
      get: () => ({ app: { plus: { viewer: true, history: switchState.on } } }) as never,
      update: () => {},
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
  let fileTime = START_TIME;
  const raw = createVfs();
  raw.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs', now: () => ++fileTime }));
  const diskBackend = new MemoryBackend({ mount: 'disk', kind: 'disk', label: 'This computer', now: () => ++fileTime });
  raw.mount(diskBackend);

  const faults = { vfs: null as 'write' | 'remove' | null, abortAfter: -1, abortEvery: false };
  const model = createHistoryModel(raw, () => (options.database ?? (() => options.factory))(), faults);
  world.storeVfs = model.storeVfs;
  world.factory = abortingFactory(options.factory, faults);

  const windows: { store: DriverStore; history: HistoryService }[] = [];
  const open = () => {
    const store = options.openWindow(world);
    return { store, history: model.watch(store) };
  };
  windows.push(open());
  if (options.windows) windows.push(open());

  const folders: VPath[] = ['/browser/a', '/browser/b', '/disk/lab'];
  // Sources mostly; now and then a PDF of 0.5 to 1 MB and a picture (not text).
  const names = [
    'p.X68',
    'q.X68',
    'r.X68',
    'p.X68',
    'q.X68',
    'r.X68',
    'p.X68',
    'q.X68',
    'r.X68',
    's.X68',
    's.X68',
    't.X68',
    't.X68',
    'pic.png',
    'pic.png',
    'big.pdf',
  ];
  type Undo = {
    kind: 'delete' | 'move' | 'copy';
    items?: { id: string; path: VPath }[];
    pairs?: [VPath, VPath][];
    copies?: VPath[];
    replaced?: { id: string; path: VPath }[];
  };
  const undo: Undo[] = [];
  const pushUndo = (entry: Undo) => {
    undo.push(entry);
    if (undo.length > 20) undo.shift();
  };
  /** The browser store compares names without letter case (FS1): a name that differs only in case
   *  from a file there names that file. The memory backend of the test does not, so the driver does. */
  const canon = (path: VPath): VPath => {
    if (!path.startsWith('/browser/')) return path;
    const place = model.place(path);
    for (const key of model.files.keys()) if (model.place(key) === place) return key;
    return path;
  };
  const filesIn = (folder: VPath) =>
    [...model.files.keys()].filter((p) => p.startsWith(`${folder}/`) && !touchesGit(p));
  const anyFile = (folder: VPath) => {
    const list = filesIn(folder);
    return list.length ? pick(list) : null;
  };
  const content = (path: VPath): Bytes => {
    const old = model.files.get(path);
    if (path.endsWith('.png')) return binaryBytes(random, 200 + Math.floor(random() * 4000));
    if (path.endsWith('.pdf') || chance(0.02)) return noiseBytes(random, (0.5 + random() / 2) * MB_);
    if (old && old.length < 60_000 && old.length > 0 && old[0] !== 0x89 && chance(0.7)) return editText(random, old);
    return sourceText(random, 2_000 + Math.floor(random() * 12_000));
  };
  /** P3.3.4: `confirm` asks when the first question promised the Trash; otherwise Yes at once. */
  const confirmFor = (_w: HistoryService, asked: string) =>
    asked === 'ready' ? async () => chance(0.6) : async () => true;

  /** P3.2.2's remove: the unchanged files of `seen`, then the folders of the item left empty. */
  const remover = (root: VPath, during?: () => Promise<void>) => async (seen: readonly SeenFile[]) => {
    if (during) await during();
    for (const file of seen) {
      const now = await model.vfs.stat(file.path).catch(() => null);
      if (now && now.mtime === file.mtime && now.size === file.size) await model.vfs.remove(file.path);
    }
    await removeEmptyFolders(model.vfs, root);
  };
  /** Replace's and Restore's write: only over an unchanged file (P3.3.4 step 4). */
  const writer = (path: VPath, data: Bytes, how: 'replace' | 'restore') => async (seen: readonly SeenFile[]) => {
    for (const file of seen) {
      const now = await model.vfs.stat(file.path).catch(() => null);
      if (!now || now.mtime !== file.mtime || now.size !== file.size) {
        const name = path.slice(path.lastIndexOf('/') + 1);
        throw new Error(
          how === 'replace'
            ? `"${name}" changed while it was being replaced. It was not replaced.`
            : `"${name}" changed while it was being restored. It was not restored.`,
        );
      }
    }
    await model.vfs.writeFile(path, data);
  };
  const restoreOptions = (w: HistoryService) => {
    const asked = w.state();
    return {
      ask: async () => pick(['replace', 'replace', 'beside', 'cancel'] as const),
      fallback: async () => (chance(0.5) ? '/browser/Restored' : null),
      confirm: async () => asked !== 'ready' || chance(0.6),
      before: async () => (chance(0.1) ? ('skip' as const) : ('write' as const)),
    };
  };

  /** Writes a file onto `target` as Move, Copy and Import do: a Replace goes through guard. */
  const put = async (w: HistoryService, target: VPath, data: Bytes, replaced: { id: string; path: VPath }[]) => {
    if (!model.files.has(target)) {
      await model.vfs.writeFile(target, data);
      return true;
    }
    const answer = pick(['yes', 'yes', 'no', 'cancel']);
    if (answer !== 'yes') return answer === 'no' ? false : null;
    const result = await w.guard(target, 'replace', writer(target, data, 'replace'), confirmFor(w, w.state()));
    if (result.item) replaced.push({ id: result.item, path: target });
    return result.outcome !== 'declined';
  };

  /** `avoid`: the folder another window works in at the same time (steps of two windows at once
   *  touch different folders, so that the model can follow both). */
  type Command = [number, string, (w: HistoryService, folder: VPath, avoid: VPath | null) => Promise<string>];
  const commands: Command[] = [
    [
      26,
      'save',
      async (w, folder) => {
        const path = canon(`${folder}/${pick(names)}`);
        const data = content(path);
        await model.vfs.writeFile(path, data);
        // P3.3.3: the version is taken afterwards; the save never waits for it.
        void w.record(path, data, 'saved', world.now).catch(() => model.violations.push('(3) record() rejected'));
        return `save ${path} (${data.length} bytes)`;
      },
    ],
    [
      4,
      'open',
      async (w, folder) => {
        const path = anyFile(folder);
        if (!path) return 'open (nothing)';
        void w.record(path, model.files.get(path) as Bytes, 'opened', world.now);
        return `open ${path}`;
      },
    ],
    [
      12,
      'delete',
      async (w, folder) => {
        const target = chance(0.3) ? folder : anyFile(folder);
        if (!target || (!model.files.has(target) && !filesIn(target).length)) return 'delete (nothing)';
        if (chance(0.15)) return `delete ${target}: No to the question`;
        if (target === folder && chance(0.3)) await model.vfs.mkdirp(`${folder}/empty${Math.floor(random() * 3)}`);
        // A save into the folder between guard's phase 1 and its act (another window, a program).
        const during =
          target === folder && chance(0.2)
            ? async () => {
                await model.vfs.writeFile(canon(`${folder}/${pick(names)}`), sourceText(random, 3000));
              }
            : undefined;
        const result = await w
          .guard(target, 'delete', remover(target, during), confirmFor(w, w.state()))
          .catch((e: unknown) => ({ outcome: `rejected (${String(e)})`, item: undefined as string | undefined }));
        if (result.outcome === 'kept' && result.item)
          pushUndo({ kind: 'delete', items: [{ id: result.item, path: target }] });
        count(`delete ${result.outcome.split(' ')[0]}`);
        return `delete ${target}: ${result.outcome}`;
      },
    ],
    [
      6,
      'earlier',
      async (w, folder) => {
        const path = anyFile(folder);
        if (!path) return 'earlier versions (nothing)';
        const rows = await w.versions(path);
        if (rows.length === 0) return `earlier versions of ${path}: none`;
        const row = pick(rows);
        let bytes: Bytes;
        try {
          bytes = await w.read(path, row.seq);
        } catch {
          return `earlier versions of ${path}: ${row.seq} is no longer kept`;
        }
        const result = await w
          .guard(path, 'restore', writer(path, bytes, 'restore'), confirmFor(w, w.state()))
          .catch((e: unknown) => ({ outcome: `rejected (${String(e)})` }));
        count(`restore ${result.outcome.split(' ')[0]}`);
        return `restore ${path} to version ${row.seq}: ${result.outcome}`;
      },
    ],
    [
      8,
      'trash',
      async (w, folder, avoid) => {
        const items = (await listTrash(w)).filter(
          (i) => !avoid || i.path === folder || i.path.startsWith(`${folder}/`),
        );
        if (items.length === 0) return 'trash restore (empty)';
        const item = pick(items);
        const out = await w.restoreTrash(item.id, restoreOptions(w));
        count(out.gone ? 'trash gone' : 'trash ran');
        return `trash restore ${item.path}: ${out.restored.length} restored, ${out.left.length} left, ${out.lost.length} lost${out.error ? ` (${out.error})` : ''}`;
      },
    ],
    [
      5,
      'rename',
      async (w, folder) => {
        const from = anyFile(folder);
        if (!from) return 'rename (nothing)';
        const name = from.slice(from.lastIndexOf('/') + 1);
        const caseOnly = chance(0.4);
        const to = caseOnly
          ? `${from.slice(0, from.lastIndexOf('/'))}/${name === name.toUpperCase() ? name.toLowerCase() : name.toUpperCase()}`
          : `${folder}/n${Math.floor(random() * 4)}${name}`;
        if (to === from || (model.place(to) !== model.place(from) && (model.files.has(to) || canon(to) !== to)))
          return `rename ${from}: the name is taken`;
        const data = model.files.get(from) as Bytes;
        await model.vfs.writeFile(to, data);
        await model.vfs.remove(from);
        // As the Files panel does (N5): a history that did not follow does not undo the rename.
        await w.moved(from, to).catch(() => {});
        pushUndo({ kind: 'move', pairs: [[from, to]] });
        return `rename ${from} -> ${to}`;
      },
    ],
    [
      6,
      'move',
      async (w, folder, avoid) => {
        const copy = chance(0.4);
        const source = chance(0.3) ? folder : anyFile(folder);
        if (!source) return 'move (nothing)';
        const store = source.split('/')[1];
        const targets = folders.filter(
          (f) =>
            f !== folder &&
            f !== avoid &&
            (copy || f.split('/')[1] === store) &&
            raw.backends().some((b) => b.mount === f.split('/')[1]),
        );
        if (targets.length === 0) return 'move (no target)';
        const into = pick(targets);
        const top = source.slice(source.lastIndexOf('/'));
        const list = source === folder ? filesIn(folder) : [source];
        const replaced: { id: string; path: VPath }[] = [];
        const done: [VPath, VPath][] = [];
        const merge = source === folder && filesIn(`${into}${top}`).length > 0;
        for (const file of list) {
          const target = canon(`${into}${top}${file.slice(source.length)}`);
          const wrote = await put(w, target, model.files.get(file) as Bytes, replaced).catch(() => false);
          if (wrote === null) break;
          if (wrote) done.push([file, target]);
        }
        if (!copy) {
          for (const [file] of done) await model.vfs.remove(file).catch(() => {});
          if (source === folder) await removeEmptyFolders(model.vfs, folder);
          // P3.2.4: once for each file moved; a folder moved without a merge may call it once.
          if (source === folder && !merge && done.length === list.length)
            await w.moved(source, `${into}${top}`).catch(() => {});
          else for (const [file, target] of done) await w.moved(file, target).catch(() => {});
          pushUndo({ kind: 'move', pairs: done, replaced });
        } else {
          pushUndo({ kind: 'copy', copies: done.map(([, t]) => t), replaced });
        }
        return `${copy ? 'copy' : 'move'} ${source} -> ${into}: ${done.length} of ${list.length}`;
      },
    ],
    [
      4,
      'import',
      async (w, folder) => {
        const path = canon(`${folder}/${pick(names)}`);
        const data = content(path);
        if (model.files.has(path)) {
          if (chance(0.3)) return `import ${path}: No`;
          // P3.3.4: the import's keep is automatic and not awaited.
          void w.record(path, model.files.get(path) as Bytes, 'before-import', world.now);
        }
        await model.vfs.writeFile(path, data);
        return `import ${path}`;
      },
    ],
    [
      5,
      'undo',
      async (w, _folder, avoid) => {
        if (avoid) return 'undo (not while another window works)';
        const last = undo.pop();
        if (!last) return 'undo (nothing)';
        if (last.kind === 'delete') {
          for (const item of last.items ?? []) await w.restoreTrash(item.id, restoreOptions(w));
        } else if (last.kind === 'move') {
          // P3.2.7: moving back never replaces anything.
          for (const [from, to] of [...(last.pairs ?? [])].reverse()) {
            if (model.files.has(from) || !model.files.has(to)) continue;
            await model.vfs.writeFile(from, model.files.get(to) as Bytes);
            await model.vfs.remove(to);
            await w.moved(to, from).catch(() => {});
          }
        } else {
          for (const copy of last.copies ?? []) {
            if (!model.files.has(copy)) continue;
            await w.guard(copy, 'delete', remover(copy), confirmFor(w, w.state())).catch(() => {});
          }
        }
        for (const item of last.replaced ?? []) await w.restoreTrash(item.id, restoreOptions(w));
        return `undo ${last.kind}`;
      },
    ],
    [
      2,
      'drop',
      async (w) => {
        const items = await listTrash(w);
        if (items.length === 0) return 'delete for good (empty)';
        const chosen = items.filter(() => chance(0.4));
        await w.dropTrash(chosen.map((i) => i.id));
        return `delete for good: ${chosen.length} items`;
      },
    ],
    [
      1,
      'empty',
      async (w) => {
        const items = await listTrash(w);
        await w.dropTrash(items.map((i) => i.id));
        return `empty trash: ${items.length} items`;
      },
    ],
    [
      1,
      'clear',
      async (w) => {
        await w.clearVersions();
        return 'delete earlier versions';
      },
    ],
    [
      2,
      'program',
      async (_w, folder) => {
        // A 68000 program or another application removes a file: no command of this stage.
        const path = anyFile(folder);
        if (!path) return 'a program removes (nothing)';
        await model.vfs.remove(path);
        return `a program removes ${path}`;
      },
    ],
    [
      1,
      'git',
      async (w) => {
        const path = pick(['/browser/repo/.git/HEAD', '/browser/repo/.git', '/browser/repo']);
        let acted = false;
        const rejected = await w
          .guard(
            path,
            'delete',
            async () => {
              acted = true;
            },
            async () => true,
          )
          .then(
            () => false,
            () => true,
          );
        if (!rejected || acted) model.violations.push(`(7) guard of ${path} did not reject without act`);
        return `guard of ${path}: rejected`;
      },
    ],
  ];
  const weights = commands.reduce((n, [w]) => n + w, 0);
  const run = async (w: HistoryService, folder: VPath, avoid: VPath | null = null) => {
    let r = random() * weights;
    let chosen = commands[0] as Command;
    for (const entry of commands) {
      r -= entry[0];
      if (r < 0) {
        chosen = entry;
        break;
      }
    }
    count(chosen[1]);
    return chosen[2](w, folder, avoid);
  };
  const diskMounted = () => raw.backends().some((b) => b.mount === 'disk');

  type Event = [number, string, () => Promise<string>];
  const events: Event[] = [
    [
      2,
      'switch',
      async () => {
        switchState.on = !switchState.on;
        for (const listener of [...listeners]) listener();
        return `the history switch ${switchState.on ? 'on' : 'off'}`;
      },
    ],
    [
      5,
      'clock',
      async () => {
        const ms = pick([MINUTE, 10 * MINUTE, HOUR, 5 * HOUR, DAY, 3 * DAY, 9 * DAY, 31 * DAY, 40 * DAY]);
        world.now += ms;
        model.note({ pass: true, now: world.now, budget: budgetOf(world.quota) });
        await pick(windows).store.globalPass();
        return `the clock moves ${Math.round(ms / MINUTE)} min; a global pass`;
      },
    ],
    [
      options.windows ? 9 : 0,
      'together',
      async () => {
        // Two windows at once, on different folders: their steps interleave at every await.
        const [a, b] = windows;
        if (!a || !b) return 'together (one window)';
        const texts = await Promise.all([
          run(a.history, folders[0] as VPath, folders[1] as VPath),
          run(b.history, folders[1] as VPath, folders[0] as VPath),
        ]);
        return `together: ${texts.join(' | ')}`;
      },
    ],
    [
      options.windows ? 1 : 0,
      'abort',
      async () => {
        faults.abortAfter = 1 + Math.floor(random() * 8);
        // Now and then every read-write transaction of the step aborts (a disk that keeps refusing):
        // a member that cannot do its work even when it tries again must say so, not resolve as if
        // it had (errata N3, "When a transaction fails"), and the seven properties still hold.
        faults.abortEvery = later() < 0.25;
        const w = pick(windows).history;
        const folder = pick(folders.slice(0, 2));
        let text: string;
        try {
          text = await run(w, folder);
        } finally {
          faults.abortAfter = -1;
        }
        if (faults.abortEvery) {
          faults.abortEvery = false;
          count('abort every');
          return `with every transaction aborted in the middle: ${text}`;
        }
        return `with a transaction aborted in the middle: ${text}`;
      },
    ],
    [
      1,
      'vfsfail',
      async () => {
        faults.vfs = chance(0.5) ? 'write' : 'remove';
        const text = await run(pick(windows).history, pick(folders.slice(0, 2)));
        const which = faults.vfs ?? 'operation';
        faults.vfs = null;
        return `with a failing Vfs ${which}: ${text}`;
      },
    ],
    [
      options.windows ? 1 : 0,
      'close',
      async () => {
        const index = Math.floor(random() * windows.length);
        const old = windows[index] as (typeof windows)[number];
        const target = anyFile(pick(folders.slice(0, 2)));
        let text = `window ${index} closes`;
        if (target && chance(0.5)) {
          // Closed between guard's keep and its act: the item stays, the file stays (P3.3.4).
          await old.history
            .guard(
              target,
              'delete',
              async () => {
                old.store.close();
                throw new Error('the page was closed');
              },
              async () => false,
            )
            .catch(() => {});
          text += ` while deleting ${target}`;
        } else {
          await old.store.settled();
          old.store.close();
        }
        windows[index] = open();
        return text;
      },
    ],
    [
      options.windows ? 1 : 0,
      'budget',
      async () => {
        const before = budgetOf(world.quota);
        world.quota = pick([33 * MB_, 40 * MB_, 64 * MB_, 640 * MB_, undefined]);
        if (world.usage > 0 && world.quota !== undefined) world.usage = world.quota - 20 * MB_;
        if (budgetOf(world.quota) < before) model.budgetFell();
        return `the quota is ${world.quota === undefined ? 'unknown' : `${world.quota / MB_} MB`}`;
      },
    ],
    [
      options.windows ? 1 : 0,
      'tight',
      async () => {
        if (world.quota === undefined) world.quota = 640 * MB_;
        world.usage = world.usage > 0 ? 0 : world.quota - 20 * MB_;
        return world.usage > 0 ? 'storage becomes tight' : 'storage has room again';
      },
    ],
    [
      options.windows ? 1 : 0,
      'unmount',
      async () => {
        if (diskMounted()) {
          model.unmount('disk');
          return 'the disk is not reachable';
        }
        model.mount(diskBackend);
        return 'the disk is reachable again';
      },
    ],
  ];
  const eventWeight = events.reduce((n, [w]) => n + w, 0);

  const steps: string[] = [];
  // A Git repository, saved before (Save is unchanged below .git): no command may touch it.
  await raw.writeFile('/browser/repo/.git/HEAD', sourceText(random, 40));
  await raw.writeFile('/browser/repo/main.X68', sourceText(random, 400));
  await model.adoptFiles();
  model.note({ now: world.now, budget: budgetOf(world.quota) });
  const database = options.database ?? (() => options.factory);
  await checkHistoryInvariants(database(), raw, model);
  for (let step = 1; step <= options.steps; step++) {
    model.note({ now: world.now, budget: budgetOf(world.quota) });
    let text: string;
    try {
      if (random() < eventWeight / (eventWeight + weights * 1.5)) {
        let r = random() * eventWeight;
        let chosen = events[0] as Event;
        for (const entry of events) {
          if (entry[0] === 0) continue;
          r -= entry[0];
          if (r < 0) {
            chosen = entry;
            break;
          }
        }
        count(chosen[1]);
        text = await chosen[2]();
      } else {
        text = await run(pick(windows).history, pick(diskMounted() ? folders : folders.slice(0, 2)));
      }
    } catch (error) {
      text = `a step failed: ${String(error)}`;
      count('failed');
    }
    faults.abortEvery = false;
    for (const w of windows) await w.store.settled();
    faults.abortAfter = -1;
    faults.vfs = null;
    steps.push(text);
    options.trace?.(step, text);
    if (globalThis.process?.env?.EASY68K_HISTORY_DEBUG)
      console.log(
        `STEP ${step}: ${text}\nPROMISES ${model.promises.map((p) => `${p.id}:${p.half}:${p.path}:${p.hash.slice(0, 8)}${p.item ? `:${p.item}` : ''}`).join(' ')}`,
      );
    const violations = await checkHistoryInvariants(database(), raw, model);
    if (violations.length > 0) {
      for (const w of windows) w.store.close();
      return { failure: { step, text, violations }, steps, stats };
    }
  }
  for (const w of windows) w.store.close();
  return { failure: null, steps, stats };
}

/** The Trash in an order that does not depend on the random ids of the items (a seed repeats). */
async function listTrash(w: HistoryService): Promise<TrashItemInfo[]> {
  const items = await w.trashItems();
  return items.sort(
    (a, b) =>
      a.deletedAt - b.deletedAt ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      a.files - b.files ||
      a.bytes - b.bytes,
  );
}

async function removeEmptyFolders(vfs: Vfs, dir: VPath): Promise<boolean> {
  const stat = await vfs.stat(dir).catch(() => null);
  if (!stat) return true;
  if (stat.kind === 'file') return false;
  let empty = true;
  for (const entry of await vfs.list(dir).catch(() => [])) {
    empty = (await removeEmptyFolders(vfs, `${dir}/${entry.name}`)) && empty;
  }
  if (empty) await vfs.remove(dir).catch(() => {});
  return empty;
}

function sourceText(random: () => number, size: number): Bytes {
  const words = ['MOVE.L', 'D0,D1', 'ADD.W', '#1,D2', 'BRA', 'LOOP', 'TRAP', '#15', '*', 'comment', 'START:', 'END'];
  let out = '';
  while (out.length < size) {
    out += `${words[Math.floor(random() * words.length)]} ${words[Math.floor(random() * words.length)]}\r\n`;
  }
  return new TextEncoder().encode(out.slice(0, size));
}

/** An edit of 1 to 20 lines of a text (P5 N3: each save an edit of 1 to 20 lines). */
export function editText(random: () => number, old: Bytes): Bytes {
  const lines = new TextDecoder().decode(old).split('\r\n');
  const edits = 1 + Math.floor(random() * 20);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(random() * (lines.length + 1));
    const kind = random();
    if (kind < 0.4) lines.splice(at, 1, `\tMOVE.B #${Math.floor(random() * 256)},D${Math.floor(random() * 8)}`);
    else if (kind < 0.7) lines.splice(at, 0, `* edit ${Math.floor(random() * 1e6)}`);
    else lines.splice(at, 1);
  }
  return new TextEncoder().encode(lines.join('\r\n'));
}

/** Bytes that do not compress (a PDF, a picture). */
export function noiseBytes(random: () => number, size: number): Bytes {
  const out = new Uint8Array(Math.floor(size));
  for (let i = 0; i < out.length; i += 4) {
    const n = Math.floor(random() * 4294967296);
    out[i] = n & 0xff;
    out[i + 1] = (n >>> 8) & 0xff;
    out[i + 2] = (n >>> 16) & 0xff;
    out[i + 3] = (n >>> 24) & 0xff;
  }
  return out;
}

function binaryBytes(random: () => number, size: number): Bytes {
  const out = noiseBytes(random, size);
  out[0] = 0x89;
  out[1] = 0;
  return out;
}

/**
 * An IDBFactory whose next read-write transaction is aborted after `faults.abortAfter` requests
 * (a transaction aborted in the middle), or every one while `faults.abortEvery` is set. It wraps
 * the databases the factory opens.
 */
function abortingFactory(factory: IDBFactory, faults: { abortAfter: number; abortEvery: boolean }): IDBFactory {
  const wrapDb = (db: IDBDatabase) => {
    const original = db.transaction.bind(db);
    const transaction = (names: string | string[], mode?: IDBTransactionMode, opts?: IDBTransactionOptions) => {
      const tx = original(names, mode, opts);
      if (mode !== 'readwrite' || faults.abortAfter <= 0) return tx;
      let left = faults.abortAfter;
      if (!faults.abortEvery) faults.abortAfter = -1;
      const objectStore = tx.objectStore.bind(tx);
      const countRequest = () => {
        if (--left === 0) {
          queueMicrotask(() => {
            try {
              tx.abort();
            } catch {
              // finished already
            }
          });
        }
      };
      (tx as { objectStore: IDBTransaction['objectStore'] }).objectStore = (name: string) => {
        const store = objectStore(name);
        return new Proxy(store, {
          get(target, key) {
            const value = Reflect.get(target, key, target) as unknown;
            if (typeof value !== 'function') return value;
            if (key === 'index') {
              return (indexName: string) => {
                const index = target.index(indexName);
                return new Proxy(index, {
                  get(t, k) {
                    const v = Reflect.get(t, k, t) as unknown;
                    if (typeof v !== 'function') return v;
                    return (...args: unknown[]) => {
                      const result = (v as (...a: unknown[]) => unknown).apply(t, args);
                      countRequest();
                      return result;
                    };
                  },
                });
              };
            }
            return (...args: unknown[]) => {
              const result = (value as (...a: unknown[]) => unknown).apply(target, args);
              countRequest();
              return result;
            };
          },
        });
      };
      return tx;
    };
    (db as { transaction: unknown }).transaction = transaction;
    return db;
  };
  return {
    open(name: string, version?: number) {
      const request = version === undefined ? factory.open(name) : factory.open(name, version);
      request.addEventListener('success', () => wrapDb(request.result));
      return request;
    },
    deleteDatabase: (name: string) => factory.deleteDatabase(name),
    cmp: (a: unknown, b: unknown) => factory.cmp(a, b),
    databases: () => factory.databases(),
  } as IDBFactory;
}
