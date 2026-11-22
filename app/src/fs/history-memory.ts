// The history over an IndexedDB in memory, for tests (ARCHITECTURE-PLUS P4.4). Owner: N0 > N3.
//
// Imported only by tests and state/testing.ts, never by production code: N3's version imports the
// development dependency fake-indexeddb.
//
// STUB of N0: until N3 is merged this is createHistoryService of history-db.ts without an
// IndexedDB, whose state() is 'unavailable' (history-db.ts says what each member does then). The
// signature is final.

import type { Clock, HistoryService, Scheduler, SettingsService, Vfs } from '../contracts';
import { createHistoryService } from './history-db';

/** The real store of history-db.ts over a fresh fake-indexeddb IDBFactory, with fake locks and
 *  channel, Node's subtle and CompressionStream, and an estimate of `quota` (default: none, B = 64 MB). */
export function createMemoryHistoryService(deps: {
  vfs: Vfs;
  clock: Clock;
  scheduler: Scheduler;
  settings?: SettingsService;
  quota?: number;
}): HistoryService {
  const settings: SettingsService = deps.settings ?? {
    get: () => {
      throw new Error('createMemoryHistoryService: no settings service was given');
    },
    update: () => {},
    subscribe: () => () => {},
  };
  const { quota } = deps;
  return createHistoryService({
    vfs: deps.vfs,
    settings,
    clock: deps.clock,
    scheduler: deps.scheduler,
    indexedDB: null,
    IDBKeyRange: null,
    subtle: globalThis.crypto?.subtle as SubtleCrypto,
    compression: {},
    locks: null,
    channel: () => null,
    estimate: quota === undefined ? null : async () => ({ quota, usage: 0 }),
  });
}
