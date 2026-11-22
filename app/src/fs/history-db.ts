// The store of earlier versions and the Trash (ARCHITECTURE-PLUS P3.3, P4.4). Owner: N0 > N3.
//
// STUB of N0. The exports below have their final signatures (P4.4: N3 may not change them). Until
// N3 is merged, createHistoryService returns a service whose state() is always 'unavailable' and
// whose members do what P4.4's table of states gives for 'unavailable':
//
//   state, untracked, subscribe, deleteAll   as stated
//   record                                   resolves, keeps nothing
//   guard                                    keeps nothing: asks, then act; no record changes
//   moved, dropTrash, clearVersions          resolve without effect
//   restoreTrash                             resolves { gone: true }, writes nothing
//   versions, trashItems                     resolve []
//   usage                                    resolves zeros
//   read                                     rejects (every version is gone)
//
// No member rejects because of the state, so that no file command fails because of it.

import type {
  AppContext,
  Bytes,
  Clock,
  HistoryService,
  HistoryState,
  HistoryUsage,
  Scheduler,
  SeenFile,
  SettingsService,
  Vfs,
  VPath,
} from '../contracts';
import { isVPath, splitVPath } from '../core/paths/winpath';

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

/** The largest file given automatic versions (P3.3.4). */
const LARGEST_VERSIONED = 1 << 20;
/** How far a zero byte makes a file "not text" (P3.3.3, P3.4.1). */
const TEXT_PROBE = 8192;

/** True when a segment of `path` is a folder named .git, in any letter case (P3.3.10). */
function belowGit(path: VPath): boolean {
  const segments = path.split('/');
  return segments.slice(1, -1).some((segment) => segment.toLowerCase() === '.git');
}

/** Why `path` gets no automatic versions, or null (P3.3.3; P4.4 `untracked`). */
function untrackedReason(
  path: VPath,
  size: number,
  head: Bytes,
): 'generated' | 'too-large' | 'not-text' | 'git' | 'memory' | null {
  if (isVPath(path) && splitVPath(path).mount === 'memory') return 'memory';
  if (belowGit(path)) return 'git';
  if (/\.(?:l68|s68)$/i.test(path)) return 'generated';
  if (size > LARGEST_VERSIONED) return 'too-large';
  if (head.subarray(0, TEXT_PROBE).includes(0)) return 'not-text';
  return null;
}

/** The files below `path` (or `path` itself) as guard reads them in phase 1. */
async function seenFiles(vfs: Vfs, path: VPath): Promise<SeenFile[]> {
  const stat = await vfs.stat(path).catch(() => null);
  if (!stat) return [];
  if (stat.kind === 'file') return [{ path, mtime: stat.mtime, size: stat.size }];
  const seen: SeenFile[] = [];
  for (const entry of await vfs.list(path).catch(() => [])) {
    seen.push(...(await seenFiles(vfs, `${path}/${entry.name}`)));
  }
  return seen;
}

const NO_USAGE: HistoryUsage = { versions: 0, versionBytes: 0, trashItems: 0, trashBytes: 0, budget: 0 };

/** With `indexedDB` null the service's state() is 'unavailable'. */
export function createHistoryService(deps: HistoryDeps): HistoryService {
  const state: HistoryState = 'unavailable';
  return {
    state: () => state,
    untracked: untrackedReason,
    record: async () => {},
    async guard(path, _how, act, confirm) {
      if (belowGit(path)) throw new Error(`"${path}" is below a .git folder: nothing there is changed.`);
      const seen = await seenFiles(deps.vfs, path);
      if (seen.length === 0 && !(await deps.vfs.stat(path).catch(() => null))) {
        await act(seen);
        return { outcome: 'kept' };
      }
      if (!(await confirm())) return { outcome: 'declined' };
      await act(seen);
      return { outcome: 'not-kept' };
    },
    versions: async () => [],
    read: async (path, seq) => {
      throw new Error(`Version ${seq} of "${path}" is no longer kept.`);
    },
    trashItems: async () => [],
    restoreTrash: async () => ({ restored: [], left: [], lost: [], gone: true }),
    dropTrash: async () => {},
    moved: async () => {},
    clearVersions: async () => {},
    deleteAll: async () => {},
    usage: async () => ({ ...NO_USAGE }),
    subscribe: () => () => {},
  };
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
