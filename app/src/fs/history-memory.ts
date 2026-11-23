// The history over an IndexedDB in memory, for tests (ARCHITECTURE-PLUS P4.4). Owner: N0 > N3.
//
// Imported only by tests and state/testing.ts, never by production code: it imports the
// development dependency fake-indexeddb. There is one implementation of the history: this is
// createHistoryStore of history-db.ts itself, over a fresh fake-indexeddb IDBFactory, with Web
// Locks and a BroadcastChannel that are fakes shared only by the stores of that one factory,
// Node's subtle and CompressionStream, and an estimate of `quota` (none by default: B = 64 MB).
//
// Also exported, for the tests of the history and of the packages built on it (N4, N5, N7):
// historyDatabaseOf(service) gives the IDBFactory a memory history writes to (for
// checkHistoryInvariants of fs/history-model.ts), and createFakeLocks / createChannelHub make the
// fakes a test needs to put several stores (several windows) on one factory.

// The layer rule lets fs/ import no npm package and gives only *.test.ts files the test
// dependencies; this one file is test support, allowed fake-indexeddb by name in eslint.config.js
// (TEST_ONLY_FILE_PACKAGES; docs/requests/N0.md section 7 item 1, errata N3).
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { Clock, HistoryService, Scheduler, Settings, SettingsService, Vfs } from '../contracts';
import { createHistoryStore, type HistoryDeps, type HistoryStore, type HistoryStoreOptions } from './history-db';

/** The real store of history-db.ts over a fresh fake-indexeddb IDBFactory, with fake locks and
 *  channel, Node's subtle and CompressionStream, and an estimate of `quota` (default: none, B = 64 MB). */
export function createMemoryHistoryService(deps: {
  vfs: Vfs;
  clock: Clock;
  scheduler: Scheduler;
  settings?: SettingsService;
  quota?: number;
}): HistoryService {
  const factory = new IDBFactory();
  // No timers of its own: the tests that use it drive time themselves and may count pending
  // timers (the global pass runs when a test calls it through createMemoryHistoryStore).
  const store = createHistoryStore(memoryHistoryDeps({ ...deps, factory }), {
    schedulePass: false,
    openTimeout: false,
  });
  DATABASES.set(store, factory);
  return store;
}

const DATABASES = new WeakMap<HistoryService, IDBFactory>();

/** The fake IndexedDB a service of createMemoryHistoryService keeps its history in. */
export function historyDatabaseOf(service: HistoryService): IDBFactory {
  const factory = DATABASES.get(service);
  if (!factory) throw new Error('historyDatabaseOf: not a service of createMemoryHistoryService');
  return factory;
}

/** The fakes several windows on one factory share. */
interface Shared {
  locks: LockManager;
  hub: ChannelHub;
}
const SHARED = new WeakMap<IDBFactory, Shared>();

function sharedOf(factory: IDBFactory): Shared {
  let shared = SHARED.get(factory);
  if (!shared) {
    shared = { locks: createFakeLocks(), hub: createChannelHub() };
    SHARED.set(factory, shared);
  }
  return shared;
}

/**
 * HistoryDeps over `factory` (a fresh one when absent), with the fakes of that factory: every store
 * made with the same factory sees the same database, the same locks and the same channel, as the
 * windows of one browser do. `estimate` overrides `quota`.
 */
export function memoryHistoryDeps(deps: {
  vfs: Vfs;
  clock: Clock;
  scheduler: Scheduler;
  settings?: SettingsService;
  quota?: number;
  factory?: IDBFactory;
  estimate?: HistoryDeps['estimate'];
  locks?: LockManager | null;
  subtle?: SubtleCrypto;
  compression?: HistoryDeps['compression'];
}): HistoryDeps {
  const factory = deps.factory ?? new IDBFactory();
  const shared = sharedOf(factory);
  const { quota } = deps;
  const scope = globalThis as typeof globalThis & {
    CompressionStream?: typeof CompressionStream;
    DecompressionStream?: typeof DecompressionStream;
  };
  const compression: HistoryDeps['compression'] = {};
  if (scope.CompressionStream) compression.CompressionStream = scope.CompressionStream;
  if (scope.DecompressionStream) compression.DecompressionStream = scope.DecompressionStream;
  return {
    vfs: deps.vfs,
    settings: deps.settings ?? defaultSettings(),
    clock: deps.clock,
    scheduler: deps.scheduler,
    indexedDB: factory,
    IDBKeyRange,
    subtle: deps.subtle ?? (globalThis.crypto?.subtle as SubtleCrypto),
    compression: deps.compression ?? compression,
    locks: deps.locks === undefined ? shared.locks : deps.locks,
    channel: (name) => shared.hub.open(name),
    estimate:
      deps.estimate !== undefined ? deps.estimate : quota === undefined ? null : async () => ({ quota, usage: 0 }),
  };
}

/** createHistoryStore over memoryHistoryDeps, for tests that need the HistoryStore members. */
export function createMemoryHistoryStore(
  deps: Parameters<typeof memoryHistoryDeps>[0],
  options: HistoryStoreOptions = {},
): HistoryStore {
  const full = memoryHistoryDeps(deps);
  const store = createHistoryStore(full, options);
  DATABASES.set(store, full.indexedDB as IDBFactory);
  return store;
}

/** Settings whose `history` switch is on (the default), for a service made without settings. */
function defaultSettings(): SettingsService {
  const settings = { app: {} } as unknown as Settings;
  return { get: () => settings, update: () => {}, subscribe: () => () => {} };
}

// ---- fakes ----------------------------------------------------------------------------------------

/**
 * Web Locks in one page: exclusive locks granted in the order asked, `ifAvailable` answered at
 * once, and query() listing what is held. Enough for the pass lock and the windows' locks.
 */
export function createFakeLocks(): LockManager & { held(): string[] } {
  const held = new Map<string, number>();
  const waiting = new Map<string, (() => void)[]>();
  const release = (name: string) => {
    const count = (held.get(name) ?? 1) - 1;
    if (count > 0) held.set(name, count);
    else held.delete(name);
    const next = waiting.get(name)?.shift();
    if (next) next();
  };
  const acquire = async (name: string): Promise<void> => {
    if (!held.has(name)) {
      held.set(name, 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const queue = waiting.get(name) ?? [];
      queue.push(() => {
        held.set(name, 1);
        resolve();
      });
      waiting.set(name, queue);
    });
  };
  const locks = {
    async request(name: string, ...args: unknown[]): Promise<unknown> {
      const callback = args[args.length - 1] as (lock: Lock | null) => unknown;
      const options = (args.length > 1 ? args[0] : {}) as LockOptions;
      if (options.ifAvailable && held.has(name)) return callback(null);
      await acquire(name);
      try {
        return await callback({ name, mode: 'exclusive' } as Lock);
      } finally {
        release(name);
      }
    },
    async query(): Promise<LockManagerSnapshot> {
      return { held: [...held.keys()].map((name) => ({ name, mode: 'exclusive', clientId: 'fake' })), pending: [] };
    },
    held: () => [...held.keys()],
  };
  return locks as unknown as LockManager & { held(): string[] };
}

/** BroadcastChannels in one process: a message posted on one reaches the others of the same name. */
export interface ChannelHub {
  open(name: string): BroadcastChannel;
}

export function createChannelHub(): ChannelHub {
  const channels = new Map<string, Set<FakeChannel>>();
  class FakeChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    private closed = false;
    constructor(readonly name: string) {
      const set = channels.get(name) ?? new Set<FakeChannel>();
      set.add(this);
      channels.set(name, set);
    }
    postMessage(data: unknown): void {
      if (this.closed) return;
      const copy = structuredClone(data);
      for (const other of channels.get(this.name) ?? []) {
        if (other === this) continue;
        queueMicrotask(() => other.onmessage?.({ data: copy } as MessageEvent));
      }
    }
    close(): void {
      this.closed = true;
      channels.get(this.name)?.delete(this);
    }
  }
  return { open: (name) => new FakeChannel(name) as unknown as BroadcastChannel };
}
