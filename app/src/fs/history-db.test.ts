// The history store under Node, on fake-indexeddb with a fake clock and a memory Vfs
// (ARCHITECTURE-PLUS P3.3, P4.4; the unit list of P5 N3). The model test is history-model.test.ts.

import {
  IDBCursor as FakeIDBCursor,
  IDBDatabase as FakeIDBDatabase,
  IDBFactory,
  IDBIndex as FakeIDBIndex,
  IDBObjectStore as FakeIDBObjectStore,
  IDBTransaction as FakeIDBTransaction,
} from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Bytes, HistoryState, SeenFile, Settings, SettingsService, VPath } from '../contracts';
import { DAY, MB, MINUTE } from '../core/history/limits';
import type { PlanEvent } from '../core/history/plans';
import {
  CANNOT_BE_UNDONE,
  STORAGE_TIGHT_TOAST,
  cannotKeepQuestion,
  changedWhileReplacing,
  changedWhileRestoring,
  gitRefused,
  historyNotChanged,
} from '../core/history/texts';
import { browserHistoryDeps, createHistoryService, createHistoryStore, type HistoryStore } from './history-db';
import {
  createMemoryHistoryService,
  createMemoryHistoryStore,
  historyDatabaseOf,
  memoryHistoryDeps,
} from './history-memory';
import { MemoryBackend } from './memory-backend';
import { createVfs } from './vfs';

const START = Date.UTC(2026, 10, 2, 12, 0, 0);
const text = (s: string): Bytes => new TextEncoder().encode(s);
const decode = (b: Bytes) => new TextDecoder().decode(b);

/** Bytes that do not compress: `n` bytes from a seeded generator, no zero byte. */
function noise(n: number, seed = 1): Bytes {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = (x & 0xff) | 1;
  }
  return out;
}

interface Env {
  vfs: ReturnType<typeof createVfs>;
  clock: { t: number; now(): number; wallTime(): Date };
  scheduler: { setTimer(ms: number, fn: () => void): () => void; onFrame(): () => void; advance(ms: number): void };
  settings: SettingsService & { setHistory(on: boolean): void };
  factory: IDBFactory;
  events: PlanEvent[];
  make(options?: {
    quota?: number;
    estimate?: () => Promise<StorageEstimate>;
    locks?: LockManager | null;
    compression?: object;
  }): HistoryStore;
}

function setup(): Env {
  const clock = {
    t: START,
    now() {
      return this.t;
    },
    wallTime() {
      return new Date(this.t);
    },
  };
  let timers: { at: number; fn: () => void }[] = [];
  let mono = 0;
  const scheduler = {
    setTimer(ms: number, fn: () => void) {
      const timer = { at: mono + ms, fn };
      timers.push(timer);
      return () => {
        timers = timers.filter((t) => t !== timer);
      };
    },
    onFrame: () => () => {},
    advance(ms: number) {
      mono += ms;
      const due = timers.filter((t) => t.at <= mono);
      timers = timers.filter((t) => t.at > mono);
      for (const t of due) t.fn();
    },
  };
  let fileTime = START;
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs', now: () => ++fileTime }));
  vfs.mount(new MemoryBackend({ now: () => ++fileTime }));
  let historyOn = true;
  const listeners = new Set<() => void>();
  const settings = {
    get: () => ({ app: { plus: { viewer: true, history: historyOn } } }) as unknown as Settings,
    update: () => {},
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setHistory(on: boolean) {
      historyOn = on;
      for (const l of listeners) l();
    },
  };
  const factory = new IDBFactory();
  const events: PlanEvent[] = [];
  return {
    vfs,
    clock,
    scheduler,
    settings,
    factory,
    events,
    make: (options = {}) =>
      createMemoryHistoryStore(
        {
          vfs,
          clock,
          scheduler,
          settings,
          factory,
          ...(options.quota !== undefined ? { quota: options.quota } : {}),
          ...(options.estimate ? { estimate: options.estimate } : {}),
          ...(options.locks !== undefined ? { locks: options.locks } : {}),
          ...(options.compression ? { compression: options.compression } : {}),
        },
        { schedulePass: false, log: (e) => events.push(e) },
      ),
  };
}

/** Saves a file as the editor would: the write, then the version (P3.3.3). */
async function save(env: Env, history: HistoryStore, path: VPath, data: Bytes): Promise<void> {
  await env.vfs.writeFile(path, data);
  await history.record(path, data, 'saved', env.clock.t);
}

/** P3.2.2's remove: the files of `seen` that are unchanged, then the empty folders. */
function remover(env: Env, root: VPath) {
  return async (seen: readonly SeenFile[]) => {
    for (const file of seen) {
      const now = await env.vfs.stat(file.path);
      if (now && now.mtime === file.mtime && now.size === file.size) await env.vfs.remove(file.path);
    }
    await removeEmpty(env, root);
  };
}

async function removeEmpty(env: Env, dir: VPath): Promise<boolean> {
  const stat = await env.vfs.stat(dir);
  if (!stat) return true;
  if (stat.kind === 'file') return false;
  let empty = true;
  for (const entry of await env.vfs.list(dir)) empty = (await removeEmpty(env, `${dir}/${entry.name}`)) && empty;
  if (empty) await env.vfs.remove(dir);
  return empty;
}

/** Replace's or Restore's write: only over an unchanged file (P3.3.4 step 4). */
function writer(env: Env, path: VPath, data: Bytes, how: 'replace' | 'restore') {
  return async (seen: readonly SeenFile[]) => {
    for (const file of seen) {
      const now = await env.vfs.stat(file.path);
      if (!now || now.mtime !== file.mtime || now.size !== file.size) {
        throw new Error(how === 'replace' ? changedWhileReplacing('prog.X68') : changedWhileRestoring('prog.X68'));
      }
    }
    await env.vfs.writeFile(path, data);
  };
}

const yes = async () => true;
const no = async () => false;
const RESTORE_ALL = { ask: async () => 'replace' as const, fallback: async () => null, confirm: yes };

/** Everything stored, read straight from the database. */
async function dump(factory: IDBFactory) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open('easy68k-history');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const all = (store: string) =>
    new Promise<{ key: IDBValidKey; value: unknown }[]>((resolve, reject) => {
      const out: { key: IDBValidKey; value: unknown }[] = [];
      const r = db.transaction(store, 'readonly').objectStore(store).openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return resolve(out);
        out.push({ key: c.primaryKey, value: c.value });
        c.continue();
      };
      r.onerror = () => reject(r.error);
    });
  const result = {
    files: await all('files'),
    versions: await all('versions'),
    contents: await all('contents'),
    meta: await all('meta'),
  };
  db.close();
  return result;
}

describe('versions (P3.3.3, P3.3.5)', () => {
  it('a save equal to the newest stores nothing', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('one'));
    await save(env, h, '/browser/a.X68', text('one'));
    expect(await h.versions('/browser/a.X68')).toHaveLength(1);
    expect((await dump(env.factory)).versions).toHaveLength(1);
  });

  it('stores identical content in two files once, and deletes it with the last version that names it', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('same'));
    await save(env, h, '/browser/b.X68', text('same'));
    let db = await dump(env.factory);
    expect(db.versions).toHaveLength(2);
    expect(db.contents).toHaveLength(1);
    await h.guard('/browser/a.X68', 'delete', remover(env, '/browser/a.X68'), yes);
    await h.dropTrash((await h.trashItems()).map((i) => i.id));
    expect((await dump(env.factory)).contents).toHaveLength(1);
    await h.clearVersions();
    db = await dump(env.factory);
    expect(db.versions).toHaveLength(0);
    expect(db.contents).toHaveLength(0);
  });

  it('record stores the time it is given, and versions are newest first', async () => {
    const env = setup();
    const h = env.make();
    await env.vfs.writeFile('/browser/a.X68', text('x'));
    await h.record('/browser/a.X68', text('one'), 'opened', START - 60 * MINUTE);
    await h.record('/browser/a.X68', text('two'), 'saved', START);
    const list = await h.versions('/browser/a.X68');
    expect(list.map((v) => [v.time, v.reason])).toEqual([
      [START, 'saved'],
      [START - 60 * MINUTE, 'opened'],
    ]);
    expect(decode(await h.read('/browser/a.X68', list[1]?.seq ?? 0))).toBe('one');
  });

  it('record keeps nothing below .git or for an untracked file', async () => {
    const env = setup();
    const h = env.make();
    for (const path of [
      '/browser/r/.git/HEAD',
      '/browser/p.L68',
      '/memory/a.X68',
      '/browser/big.X68',
      '/browser/b.bin',
    ]) {
      const data = path.endsWith('big.X68')
        ? noise(MB + 1)
        : path.endsWith('.bin')
          ? new Uint8Array([1, 0, 2])
          : text('x');
      await h.record(path, data, 'saved', START);
    }
    expect((await dump(env.factory)).versions).toHaveLength(0);
  });

  it('without CompressionStream contents are stored with enc none', async () => {
    const env = setup();
    const h = env.make({ compression: {} });
    await save(env, h, '/browser/a.X68', text('a'.repeat(5000)));
    const db = await dump(env.factory);
    expect((db.contents[0]?.value as { enc: string; stored: number }).enc).toBe('none');
    expect((db.contents[0]?.value as { stored: number }).stored).toBe(5000);
  });

  it('compresses with deflate-raw and reads the bytes back exactly', async () => {
    const env = setup();
    const h = env.make();
    const data = text('MOVE.L D0,D1\r\n'.repeat(400));
    await save(env, h, '/browser/a.X68', data);
    const db = await dump(env.factory);
    expect((db.contents[0]?.value as { enc: string }).enc).toBe('deflate-raw');
    const [v] = await h.versions('/browser/a.X68');
    expect(await h.read('/browser/a.X68', v?.seq ?? 0)).toEqual(data);
  });

  it('the record queue drops the oldest beyond 16 MB', async () => {
    const env = setup();
    const h = env.make();
    // Six files of 1 MB wait behind a slow estimate; 18 more MB push the oldest out.
    const paths: VPath[] = [];
    for (let i = 0; i < 18; i++) {
      const path = `/browser/f${i}.X68`;
      paths.push(path);
      await env.vfs.writeFile(path, text('x'));
      void h.record(path, noise(MB, i + 1), 'saved', START);
    }
    await h.settled();
    const kept = [];
    for (const path of paths) if ((await h.versions(path)).length > 0) kept.push(path);
    expect(kept.length).toBeLessThan(18);
    expect(kept.length).toBeGreaterThanOrEqual(16);
    expect(kept).toContain('/browser/f17.X68');
  }, 120_000);
});

describe('the thinning schedule on a record (P3.3.4)', () => {
  it('one save every 5 minutes for 24 hours stays at or below 200 and keeps each hour', async () => {
    const env = setup();
    const h = env.make();
    await env.vfs.writeFile('/browser/a.X68', text('0'));
    for (let i = 0; i < 288; i++) {
      env.clock.t = START + i * 5 * MINUTE;
      await h.record('/browser/a.X68', text(`v${i}`), 'saved', env.clock.t);
      const count = (await h.versions('/browser/a.X68')).length;
      expect(count).toBeLessThanOrEqual(200);
    }
    const list = await h.versions('/browser/a.X68');
    expect(list.length).toBeGreaterThan(24);
    // Every hour of the day still has a version.
    const hours = new Set(list.map((v) => Math.floor((v.time - START) / (60 * MINUTE))));
    expect(hours.size).toBe(24);
  }, 120_000);

  it('a version at 59 and at 61 days, with and without being its record newest', async () => {
    const env = setup();
    const h = env.make();
    await env.vfs.writeFile('/browser/a.X68', text('0'));
    await env.vfs.writeFile('/browser/b.X68', text('0'));
    await h.record('/browser/a.X68', text('a59'), 'saved', START - 59 * DAY);
    await h.record('/browser/b.X68', text('b61'), 'saved', START - 61 * DAY);
    await h.globalPass();
    expect((await h.versions('/browser/a.X68')).length).toBe(1);
    expect((await h.versions('/browser/b.X68')).length).toBe(1); // the newest stays
    await h.record('/browser/a.X68', text('a-new'), 'saved', START);
    await h.record('/browser/b.X68', text('b-new'), 'saved', START);
    await h.globalPass();
    expect((await h.versions('/browser/a.X68')).length).toBe(2); // 59 days: kept
    expect((await h.versions('/browser/b.X68')).map((v) => v.time)).toEqual([START]); // 61 days: dropped
  });

  it('an item at 29 days stays and one at 31 days goes', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('a'));
    await save(env, h, '/browser/b.X68', text('b'));
    env.clock.t = START - 31 * DAY;
    await h.guard('/browser/a.X68', 'delete', remover(env, '/browser/a.X68'), yes);
    env.clock.t = START - 29 * DAY;
    await h.guard('/browser/b.X68', 'delete', remover(env, '/browser/b.X68'), yes);
    env.clock.t = START;
    await h.globalPass();
    expect((await h.trashItems()).map((i) => i.path)).toEqual(['/browser/b.X68']);
  });
});

describe('guard (P3.3.4)', () => {
  it('a delete keeps the copy in the Trash, and restoring brings it back', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/demo/prog.X68', text('v1'));
    await save(env, h, '/browser/demo/prog.X68', text('v2'));
    await env.vfs.mkdirp('/browser/demo/empty');
    const result = await h.guard('/browser/demo', 'delete', remover(env, '/browser/demo'), no);
    expect(result.outcome).toBe('kept');
    expect(await env.vfs.stat('/browser/demo')).toBeNull();
    const [item] = await h.trashItems();
    expect(item).toMatchObject({ id: result.item, cause: 'deleted', path: '/browser/demo', kind: 'dir', files: 1 });
    expect(item?.restorableInPlace).toBe(true);
    const back = await h.restoreTrash(item?.id ?? '', RESTORE_ALL);
    expect(back).toEqual({ restored: ['/browser/demo/prog.X68'], left: [], lost: [], gone: false });
    expect(decode(await env.vfs.readFile('/browser/demo/prog.X68'))).toBe('v2');
    expect((await env.vfs.stat('/browser/demo/empty'))?.kind).toBe('dir');
    expect((await h.versions('/browser/demo/prog.X68')).length).toBe(2);
    expect(await h.trashItems()).toEqual([]);
    expect((await dump(env.factory)).files.filter((f) => (f.value as { dir?: boolean }).dir)).toEqual([]);
  });

  it('then a new file at the same place: its versions do not include the deleted file', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('old'));
    await h.guard('/browser/a.X68', 'delete', remover(env, '/browser/a.X68'), yes);
    await save(env, h, '/browser/a.X68', text('new'));
    const list = await h.versions('/browser/a.X68');
    expect(list).toHaveLength(1);
    expect(decode(await h.read('/browser/a.X68', list[0]?.seq ?? 0))).toBe('new');
  });

  it('a path that does not exist calls act without confirm; below .git it rejects without act', async () => {
    const env = setup();
    const h = env.make();
    const act = vi.fn(async () => {});
    const confirm = vi.fn(yes);
    expect(await h.guard('/browser/none.X68', 'replace', act, confirm)).toEqual({ outcome: 'kept' });
    expect(act).toHaveBeenCalledWith([]);
    expect(confirm).not.toHaveBeenCalled();
    act.mockClear();
    await env.vfs.writeFile('/browser/repo/.Git/HEAD', text('x'));
    await env.vfs.writeFile('/browser/repo/a.X68', text('x'));
    await expect(h.guard('/browser/repo/.Git/HEAD', 'delete', act, confirm)).rejects.toThrow(/git/i);
    await expect(h.guard('/browser/repo/.Git', 'delete', act, confirm)).rejects.toThrow(/git/i);
    await expect(h.guard('/browser/repo', 'delete', act, confirm)).rejects.toThrow(/git/i);
    expect(act).not.toHaveBeenCalled();
  });

  it('an opened folder that is itself a .git folder: record keeps nothing, guard rejects without act', async () => {
    // Open Folder... or a drop may choose a repository's .git folder: no segment of its paths says
    // .git, but every file in it lies below one (P1.1 rule 2, P3.3.10; the gate, from N5's report).
    const env = setup();
    const folder = new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: '.GIT' });
    Object.assign(folder, { rootHandle: { kind: 'directory', name: '.GIT' } });
    env.vfs.mount(folder);
    const h = env.make();
    await env.vfs.writeFile('/folder/HEAD', text('ref: refs/heads/main'));
    await env.vfs.mkdirp('/folder/refs');
    await h.record('/folder/HEAD', text('ref: refs/heads/main'), 'saved', START);
    await h.record('/folder/prog.X68', text('x'), 'saved', START);
    expect((await dump(env.factory)).versions).toHaveLength(0);
    const act = vi.fn(async () => {});
    const confirm = vi.fn(yes);
    await expect(h.guard('/folder/HEAD', 'delete', act, confirm)).rejects.toThrow(/git/i);
    await expect(h.guard('/folder/refs', 'delete', act, confirm)).rejects.toThrow(/git/i);
    await expect(h.guard('/folder/none.X68', 'replace', act, confirm)).rejects.toThrow(/git/i);
    expect(act).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('an opened .git folder: untracked says git, and no Trash item is restored into it', async () => {
    // N3's review of the gate's change: the store's other members knew a .git folder only by a
    // segment of the path, so untracked() said "tracked" there and a restore into a folder chosen
    // in such a store, or into an item's own place, would have written below .git.
    const env = setup();
    env.vfs.mount(new MemoryBackend({ mount: 'disk', kind: 'disk', label: 'This computer' }));
    const h = env.make();
    await save(env, h, '/disk/lab/p.X68', text('p'));
    const kept = await h.guard('/disk/lab/p.X68', 'delete', remover(env, '/disk/lab/p.X68'), yes);
    env.vfs.unmount('disk');
    const folder = new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: '.git' });
    Object.assign(folder, { rootHandle: { kind: 'directory', name: '.git' } });
    env.vfs.mount(folder);
    expect(h.untracked('/folder/HEAD', 3, text('ref'))).toBe('git');
    expect(h.untracked('/browser/p.X68', 1, text('p'))).toBeNull();
    const fallback = vi.fn(async () => '/folder' as VPath);
    const result = await h.restoreTrash(kept.item ?? '', { ...RESTORE_ALL, fallback });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result.restored).toEqual([]);
    expect(result.left).toEqual(['/folder/p.X68']);
    expect(result.error).toBe(gitRefused('/folder/p.X68', 'below'));
    expect(await env.vfs.list('/folder')).toEqual([]);
    expect((await h.trashItems()).map((i) => i.id)).toEqual([kept.item]);
  });

  it('a copy of 20 MB is kept, one of 20 MB + 1 byte and an item above B / 2 call confirm', async () => {
    const env = setup();
    const h = env.make();
    await env.vfs.writeFile('/browser/a.pdf', noise(20 * MB, 3));
    await env.vfs.writeFile('/browser/b.pdf', noise(20 * MB + 1, 4));
    const confirm = vi.fn(yes);
    expect((await h.guard('/browser/a.pdf', 'delete', remover(env, '/browser/a.pdf'), confirm)).outcome).toBe('kept');
    expect(confirm).not.toHaveBeenCalled();
    expect((await h.guard('/browser/b.pdf', 'delete', remover(env, '/browser/b.pdf'), confirm)).outcome).toBe(
      'not-kept',
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    // A folder of two 18 MB files is 36 MB: above B / 2 = 32 MB, so not kept (whole or not at all).
    await env.vfs.writeFile('/browser/d/x.pdf', noise(18 * MB, 5));
    await env.vfs.writeFile('/browser/d/y.pdf', noise(18 * MB, 6));
    expect((await h.guard('/browser/d', 'delete', remover(env, '/browser/d'), confirm)).outcome).toBe('not-kept');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect((await h.trashItems()).map((i) => i.path)).toEqual(['/browser/a.pdf']);
  }, 120_000);

  it('B with a quota of 400 MB is 40 MB', async () => {
    const env = setup();
    const h = env.make({ quota: 400 * MB });
    expect((await h.usage()).budget).toBe(40 * MB);
    const none = env.make();
    expect((await none.usage()).budget).toBe(64 * MB);
  });

  it('Replace from the Trash over a file with versions', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('first'));
    await h.guard('/browser/a.X68', 'delete', remover(env, '/browser/a.X68'), yes);
    await save(env, h, '/browser/a.X68', text('second-1'));
    await save(env, h, '/browser/a.X68', text('second-2'));
    const [item] = await h.trashItems();
    const out = await h.restoreTrash(item?.id ?? '', RESTORE_ALL);
    expect(out.restored).toEqual(['/browser/a.X68']);
    expect(decode(await env.vfs.readFile('/browser/a.X68'))).toBe('first');
    const list = await h.versions('/browser/a.X68');
    // The copy was the saved version itself (equal bytes store nothing new).
    expect(list.map((v) => v.reason)).toEqual(['saved']);
    const trash = await h.trashItems();
    expect(trash.map((i) => [i.path, i.cause])).toEqual([['/browser/a.X68', 'replaced']]);
    // The replaced file keeps its own versions in its record (two saves; its copy is the newest).
    const db = await dump(env.factory);
    const replaced = db.files.find((f) => (f.value as { trash?: { cause: string } }).trash?.cause === 'replaced');
    expect((replaced?.value as { count: number }).count).toBe(2);
  });

  it('a removal or a write that fails after the keep leaves the versions at the place and no item', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('a'));
    await expect(
      h.guard(
        '/browser/a.X68',
        'delete',
        async () => {
          throw new Error('the disk failed');
        },
        yes,
      ),
    ).rejects.toThrow('the disk failed');
    expect(await h.trashItems()).toEqual([]);
    expect((await h.versions('/browser/a.X68')).length).toBe(1);
    await expect(
      h.guard(
        '/browser/a.X68',
        'replace',
        async () => {
          throw new Error(changedWhileReplacing('a.X68'));
        },
        yes,
      ),
    ).rejects.toThrow(/changed while/);
    expect(await h.trashItems()).toEqual([]);
    expect((await h.versions('/browser/a.X68')).length).toBe(1);
    // A folder: the removed files stay in the Trash, the other one is back.
    await save(env, h, '/browser/d/x.X68', text('x'));
    await save(env, h, '/browser/d/y.X68', text('y'));
    await expect(
      h.guard(
        '/browser/d',
        'delete',
        async () => {
          await env.vfs.remove('/browser/d/x.X68');
          throw new Error('the disk failed');
        },
        yes,
      ),
    ).rejects.toThrow('the disk failed');
    const [item] = await h.trashItems();
    expect(item?.files).toBe(1);
    expect((await h.versions('/browser/d/y.X68')).length).toBe(1);
  });

  it('a folder delete whose act finds one file changed leaves it living, the others in the Trash', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/d/x.X68', text('x'));
    await save(env, h, '/browser/d/y.X68', text('y'));
    const result = await h.guard(
      '/browser/d',
      'delete',
      async (seen) => {
        await env.vfs.writeFile('/browser/d/y.X68', text('changed'));
        await remover(env, '/browser/d')(seen);
      },
      yes,
    );
    expect(result.outcome).toBe('kept');
    expect(decode(await env.vfs.readFile('/browser/d/y.X68'))).toBe('changed');
    const [item] = await h.trashItems();
    expect(item?.files).toBe(1);
    expect((await h.versions('/browser/d/y.X68')).length).toBeGreaterThanOrEqual(1);
  });

  it('guard(restore) of a file above 1 MB keeps nothing and calls confirm', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('small'));
    await env.vfs.writeFile('/browser/a.X68', noise(MB + 10));
    const confirm = vi.fn(yes);
    const result = await h.guard(
      '/browser/a.X68',
      'restore',
      writer(env, '/browser/a.X68', text('small'), 'restore'),
      confirm,
    );
    expect(result.outcome).toBe('not-kept');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(decode(await env.vfs.readFile('/browser/a.X68'))).toBe('small');
    expect((await h.versions('/browser/a.X68')).length).toBe(1); // restore: no record changes
  });

  it.each(['off', 'tight', 'unavailable'] as const)('in state %s guard keeps nothing and asks', async (state) => {
    const env = setup();
    const ready = env.make();
    await save(env, ready, '/browser/a.X68', text('a'));
    await save(env, ready, '/browser/b.X68', text('b'));
    await save(env, ready, '/browser/c.X68', text('c'));
    let h: HistoryStore = ready;
    if (state === 'off') env.settings.setHistory(false);
    if (state === 'tight') h = env.make({ estimate: async () => ({ quota: 100 * MB, usage: 90 * MB }) });
    if (state === 'unavailable') {
      // A store without subtle (not a secure context) is unavailable, whatever the database holds.
      const deps = memoryHistoryDeps({
        vfs: env.vfs,
        clock: env.clock,
        scheduler: env.scheduler,
        settings: env.settings,
        factory: env.factory,
      });
      h = createHistoryStore({ ...deps, subtle: undefined as unknown as SubtleCrypto }, { schedulePass: false });
    }
    if (state === 'tight') await h.usage();
    expect(h.state()).toBe(state);
    const confirm = vi.fn(yes);
    const r1 = await h.guard('/browser/a.X68', 'delete', remover(env, '/browser/a.X68'), confirm);
    const r2 = await h.guard('/browser/b.X68', 'replace', writer(env, '/browser/b.X68', text('B'), 'replace'), confirm);
    const r3 = await h.guard('/browser/c.X68', 'restore', writer(env, '/browser/c.X68', text('C'), 'restore'), confirm);
    expect([r1.outcome, r2.outcome, r3.outcome]).toEqual(['not-kept', 'not-kept', 'not-kept']);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(await ready.trashItems()).toEqual([]);
    if (state !== 'unavailable') {
      // After Yes: the deleted and the replaced file's records are gone; restore keeps its record.
      expect(await ready.versions('/browser/b.X68')).toEqual([]);
      expect((await ready.versions('/browser/c.X68')).length).toBe(1);
      const db = await dump(env.factory);
      expect(db.files.length).toBe(1);
    }
  });

  it('No: nothing is done (declined)', async () => {
    const env = setup();
    const h = env.make();
    env.settings.setHistory(false);
    await env.vfs.writeFile('/browser/a.X68', text('a'));
    const act = vi.fn(async () => {});
    expect(await h.guard('/browser/a.X68', 'delete', act, no)).toEqual({ outcome: 'declined' });
    expect(act).not.toHaveBeenCalled();
  });

  it('deleting a folder whose records hold 0.9 x B / 2 of versions, with 100 kB of current files, is kept', async () => {
    const env = setup();
    const h = env.make({ quota: 40 * MB }); // B = 4 MB, B / 2 = 2 MB
    let i = 0;
    while ((await h.usage()).versionBytes < 0.9 * 2 * MB - 20_000 && i < 500) {
      await save(env, h, `/browser/d/f${i % 12}.X68`, noise(20_000, ++i));
    }
    for (let k = 0; k < 4; k++) await save(env, h, `/browser/d/f${k}.X68`, noise(25_000, 1000 + k));
    for (let k = 4; k < 12; k++) await env.vfs.remove(`/browser/d/f${k}.X68`);
    const before = await h.usage();
    const result = await h.guard('/browser/d', 'delete', remover(env, '/browser/d'), no);
    expect(result.outcome).toBe('kept');
    const after = await h.usage();
    expect(after.trashBytes).toBeLessThanOrEqual(2 * MB);
    expect(after.versionBytes).toBeLessThanOrEqual(2 * MB);
    // The Trash half grew by the copies only (4 records and their newest versions).
    expect(after.trashBytes).toBeLessThan(4 * (25_000 + 512) + 1000);
    expect(after.versionBytes).toBeLessThan(before.versionBytes);
  }, 120_000);

  it('restoring a 20 MB PDF from the Trash removes no version of another record and keeps no version above 1 MB', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('a1'));
    await save(env, h, '/browser/a.X68', text('a2'));
    await env.vfs.writeFile('/browser/doc.pdf', noise(20 * MB, 9));
    await h.guard('/browser/doc.pdf', 'delete', remover(env, '/browser/doc.pdf'), yes);
    const [item] = await h.trashItems();
    expect((await h.restoreTrash(item?.id ?? '', RESTORE_ALL)).restored).toEqual(['/browser/doc.pdf']);
    expect((await h.versions('/browser/a.X68')).length).toBe(2);
    expect(await h.versions('/browser/doc.pdf')).toEqual([]);
    const db = await dump(env.factory);
    expect(db.versions.every((v) => (v.value as { size: number }).size <= MB)).toBe(true);
  }, 120_000);
});

/**
 * An IDBFactory over `inner` whose next `failing` read-write transactions abort before their first
 * request completes, and whose deleteDatabase fails while `deleteFails` is set.
 */
function abortingFactory(inner: IDBFactory) {
  const control = { failing: 0, deleteFails: false };
  const wrap = (db: IDBDatabase) => {
    const original = db.transaction.bind(db);
    (db as { transaction: unknown }).transaction = (
      names: string | string[],
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) => {
      const tx = original(names, mode, options);
      if (mode === 'readwrite' && control.failing > 0) {
        control.failing--;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  };
  const factory = {
    open(name: string, version?: number) {
      const request = version === undefined ? inner.open(name) : inner.open(name, version);
      request.addEventListener('success', () => wrap(request.result));
      return request;
    },
    deleteDatabase(name: string) {
      if (!control.deleteFails) return inner.deleteDatabase(name);
      const request = { error: new Error('the disk refused'), onsuccess: null, onerror: null, onblocked: null } as {
        error: Error;
        onerror: (() => void) | null;
      };
      setTimeout(() => request.onerror?.(), 0);
      return request as unknown as IDBOpenDBRequest;
    },
    cmp: (a: unknown, b: unknown) => inner.cmp(a, b),
    databases: () => inner.databases(),
  } as IDBFactory;
  return { factory, control };
}

/** historyNotChanged(<the browser's reason>), exactly. */
const NOT_CHANGED = new RegExp(
  `^${historyNotChanged('@@')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('@@', '.+')}$`,
);

describe('when a transaction fails: retried, then rejected, never reported as done (errata N3)', () => {
  const make = (env: Env, factory: IDBFactory) =>
    createMemoryHistoryStore(
      { vfs: env.vfs, clock: env.clock, scheduler: env.scheduler, settings: env.settings, factory },
      { schedulePass: false },
    );

  it('moved: an aborted change is tried again and the history follows (seed 7064)', async () => {
    const env = setup();
    const { factory, control } = abortingFactory(env.factory);
    const h = make(env, factory);
    await save(env, h, '/browser/d/x.X68', text('x'));
    await env.vfs.writeFile('/browser/e/x.X68', text('x'));
    await env.vfs.remove('/browser/d/x.X68');
    control.failing = 1;
    await h.moved('/browser/d/x.X68', '/browser/e/x.X68');
    expect(control.failing).toBe(0);
    expect((await h.versions('/browser/e/x.X68')).length).toBe(1);
    expect(await h.versions('/browser/d/x.X68')).toEqual([]);
  });

  it('moved that cannot be made rejects; the history stays whole at the old place', async () => {
    const env = setup();
    const { factory, control } = abortingFactory(env.factory);
    const h = make(env, factory);
    await save(env, h, '/browser/d/x.X68', text('x'));
    const before = await dump(env.factory);
    control.failing = 99;
    await expect(h.moved('/browser/d/x.X68', '/browser/e/x.X68')).rejects.toThrow(NOT_CHANGED);
    expect(control.failing).toBe(96); // three tries
    control.failing = 0;
    expect(await dump(env.factory)).toEqual(before);
    expect((await h.versions('/browser/d/x.X68')).length).toBe(1);
  });

  it('dropTrash and clearVersions reject when they cannot drop; what is listed is still there', async () => {
    const env = setup();
    const { factory, control } = abortingFactory(env.factory);
    const h = make(env, factory);
    await save(env, h, '/browser/p.X68', text('p1'));
    await save(env, h, '/browser/p.X68', text('p2'));
    await save(env, h, '/browser/q.X68', text('q'));
    await h.guard('/browser/q.X68', 'delete', remover(env, '/browser/q.X68'), yes);
    const [item] = await h.trashItems();
    control.failing = 99;
    await expect(h.dropTrash([item?.id ?? ''])).rejects.toThrow(NOT_CHANGED);
    await expect(h.clearVersions()).rejects.toThrow(NOT_CHANGED);
    control.failing = 0;
    expect((await h.trashItems()).map((i) => i.id)).toEqual([item?.id]);
    expect((await h.versions('/browser/p.X68')).length).toBe(2);
    // Once a try goes through, they do their work.
    control.failing = 2;
    await h.dropTrash([item?.id ?? '']);
    await h.clearVersions();
    expect(await h.trashItems()).toEqual([]);
    expect(await h.versions('/browser/p.X68')).toEqual([]);
  });

  it('deleteAll rejects when the browser does not delete the database, and the history stays', async () => {
    const env = setup();
    const { factory, control } = abortingFactory(env.factory);
    const h = make(env, factory);
    await save(env, h, '/browser/p.X68', text('p1'));
    control.deleteFails = true;
    await expect(h.deleteAll()).rejects.toThrow(historyNotChanged('the disk refused'));
    control.deleteFails = false;
    expect((await h.versions('/browser/p.X68')).length).toBe(1);
    await h.deleteAll();
    expect(await h.versions('/browser/p.X68')).toEqual([]);
  });
});

describe('moved and restore (P3.3.5)', () => {
  it('moved with a change of letter case in the browser store changes only the spelling', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('a'));
    const before = await dump(env.factory);
    await env.vfs.writeFile('/browser/A.X68', text('a'));
    await env.vfs.remove('/browser/a.X68');
    await h.moved('/browser/a.X68', '/browser/A.X68');
    const after = await dump(env.factory);
    const b = before.files[0]?.value as { place: string; spelling: string };
    const a = after.files[0]?.value as { place: string; spelling: string };
    expect(a).toEqual({ ...b, spelling: '/browser/A.X68' });
  });

  it('moved changes one record per file, and the history follows', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/d/x.X68', text('x'));
    await save(env, h, '/browser/d/y.X68', text('y'));
    await save(env, h, '/browser/other.X68', text('o'));
    const writes: string[] = [];
    const before = await dump(env.factory);
    await h.moved('/browser/d', '/browser/e');
    const after = await dump(env.factory);
    for (const f of after.files) {
      const old = before.files.find((b) => b.key === f.key);
      if (JSON.stringify(old?.value) !== JSON.stringify(f.value)) writes.push(String(f.key));
    }
    expect(writes).toHaveLength(2);
    expect((await h.versions('/browser/e/x.X68')).length).toBe(1);
    expect(await h.versions('/browser/d/x.X68')).toEqual([]);
  });

  it('moved and a restore onto a place held by a living record send that record to the Trash as Replaced', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/x.X68', text('x'));
    await save(env, h, '/browser/y.X68', text('y'));
    await env.vfs.remove('/browser/y.X68'); // a program removed it: its record stays living
    await env.vfs.writeFile('/browser/y.X68', text('x'));
    await env.vfs.remove('/browser/x.X68');
    await h.moved('/browser/x.X68', '/browser/y.X68');
    const trash = await h.trashItems();
    expect(trash.map((i) => [i.path, i.cause])).toEqual([['/browser/y.X68', 'replaced']]);
    expect(decode(await h.read('/browser/y.X68', (await h.versions('/browser/y.X68'))[0]?.seq ?? 0))).toBe('x');
    // A restore onto a place held by a living record whose file is gone.
    await save(env, h, '/browser/z.X68', text('z1'));
    await h.guard('/browser/z.X68', 'delete', remover(env, '/browser/z.X68'), yes);
    await save(env, h, '/browser/z.X68', text('z2'));
    await env.vfs.remove('/browser/z.X68');
    const z = (await h.trashItems()).find((i) => i.path === '/browser/z.X68' && i.cause === 'deleted');
    await h.restoreTrash(z?.id ?? '', RESTORE_ALL);
    expect((await h.trashItems()).filter((i) => i.path === '/browser/z.X68').map((i) => i.cause)).toEqual(['replaced']);
  });

  it('a restore of an item whose record re-entered the Trash as another item changes no record', async () => {
    const env = setup();
    const a = env.make();
    const b = env.make();
    await save(env, a, '/browser/x.X68', text('x'));
    await a.guard('/browser/x.X68', 'delete', remover(env, '/browser/x.X68'), yes);
    const [first] = await a.trashItems();
    // b restores it and deletes it again: the record is now in another item.
    await b.restoreTrash(first?.id ?? '', RESTORE_ALL);
    await b.guard('/browser/x.X68', 'delete', remover(env, '/browser/x.X68'), yes);
    const before = await dump(env.factory);
    const out = await a.restoreTrash(first?.id ?? '', RESTORE_ALL);
    expect(out.gone).toBe(true);
    expect(await dump(env.factory)).toEqual(before);
  });

  it('restoreTrash: gone, dropped while it runs, cancel, empty folders, before() skips', async () => {
    const env = setup();
    const h = env.make();
    expect((await h.restoreTrash('no-such-item', RESTORE_ALL)).gone).toBe(true);
    for (const n of ['a', 'b', 'c']) await save(env, h, `/browser/d/${n}.X68`, text(n));
    await env.vfs.mkdirp('/browser/d/empty');
    const { item } = await h.guard('/browser/d', 'delete', remover(env, '/browser/d'), yes);
    // Dropped while it runs: the file being written stays written, no record changes.
    let dropped = false;
    const out1 = await h.restoreTrash(item ?? '', {
      ...RESTORE_ALL,
      before: async () => {
        if (!dropped) {
          dropped = true;
          await h.dropTrash([item ?? '']);
        }
        return 'write';
      },
    });
    expect(out1.restored).toEqual(['/browser/d/a.X68', '/browser/d/b.X68', '/browser/d/c.X68']);
    expect(await h.versions('/browser/d/a.X68')).toEqual([]);
    // Cancel: only the files not yet written stay in the Trash; before() skips never reach guard.
    await env.vfs.writeFile('/browser/d/b.X68', text('B-now'));
    const { item: item2 } = await h.guard('/browser/d', 'delete', remover(env, '/browser/d'), yes);
    await env.vfs.writeFile('/browser/d/b.X68', text('in the way'));
    const guard = vi.spyOn(h, 'guard');
    const out2 = await h.restoreTrash(item2 ?? '', {
      ask: async () => 'cancel',
      fallback: async () => null,
      confirm: yes,
      before: async (p) => (p.endsWith('c.X68') ? 'skip' : 'write'),
    });
    expect(out2.restored).toEqual(['/browser/d/a.X68']);
    expect(out2.left.sort()).toEqual(['/browser/d/b.X68', '/browser/d/c.X68']);
    expect(guard).not.toHaveBeenCalled();
    expect(await env.vfs.stat('/browser/d/empty')).toBeNull(); // stopped: the folders wait
    // The second restore asks only about what was left, then creates the empty folder.
    const asked: VPath[] = [];
    const out3 = await h.restoreTrash(item2 ?? '', { ...RESTORE_ALL, ask: async (p) => (asked.push(p), 'beside') });
    expect(asked).toEqual(['/browser/d/b.X68']);
    expect(out3.restored.sort()).toEqual(['/browser/d/b (restored).X68', '/browser/d/c.X68']);
    expect((await env.vfs.stat('/browser/d/empty'))?.kind).toBe('dir');
    expect(await h.trashItems()).toEqual([]);
  });

  it('a 3-file restore with the second file skipped, then a second restore asks only about it', async () => {
    const env = setup();
    const h = env.make();
    for (const n of ['a', 'b', 'c']) await save(env, h, `/browser/d/${n}.X68`, text(n));
    const { item } = await h.guard('/browser/d', 'delete', remover(env, '/browser/d'), yes);
    for (const n of ['a', 'b', 'c']) await env.vfs.writeFile(`/browser/d/${n}.X68`, text('there'));
    const out = await h.restoreTrash(item ?? '', {
      ...RESTORE_ALL,
      before: async (p) => (p.endsWith('b.X68') ? 'skip' : 'write'),
    });
    expect(out.left).toEqual(['/browser/d/b.X68']);
    const asked: VPath[] = [];
    await h.restoreTrash(item ?? '', { ...RESTORE_ALL, ask: async (p) => (asked.push(p), 'replace') });
    expect(asked).toEqual(['/browser/d/b.X68']);
  });

  it('a store that is not mounted asks fallback', async () => {
    const env = setup();
    const h = env.make();
    env.vfs.mount(new MemoryBackend({ mount: 'disk', kind: 'disk', label: 'This computer' }));
    await save(env, h, '/disk/lab/p.X68', text('p'));
    const { item } = await h.guard('/disk/lab/p.X68', 'delete', remover(env, '/disk/lab/p.X68'), yes);
    env.vfs.unmount('disk');
    const [info] = await h.trashItems();
    expect(info?.restorableInPlace).toBe(false);
    expect((await h.restoreTrash(item ?? '', RESTORE_ALL)).left).toEqual(['/disk/lab/p.X68']);
    const out = await h.restoreTrash(item ?? '', { ...RESTORE_ALL, fallback: async () => '/browser/Restored' });
    expect(out.restored).toEqual(['/browser/Restored/p.X68']);
    expect(decode(await env.vfs.readFile('/browser/Restored/p.X68'))).toBe('p');
  });

  it('an item of an opened folder that is not open names the folder (P3.3.8, folderName)', async () => {
    const env = setup();
    const h = env.make();
    env.vfs.mount(new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Lab' }));
    await save(env, h, '/folder/p.X68', text('p'));
    await h.guard('/folder/p.X68', 'delete', remover(env, '/folder/p.X68'), yes);
    const [open] = await h.trashItems();
    expect(open?.restorableInPlace).toBe(true);
    env.vfs.unmount('folder');
    const [info] = await h.trashItems();
    expect(info?.restorableInPlace).toBe(false);
    expect(info?.folderName).toBe('Lab');
    // restoreTrash hands the same name to fallback.
    let offered: unknown;
    await h.restoreTrash(info?.id ?? '', {
      ...RESTORE_ALL,
      fallback: async (item) => ((offered = item.folderName), null),
    });
    expect(offered).toBe('Lab');
    // An item of the browser store has none.
    await save(env, h, '/browser/q.X68', text('q'));
    await h.guard('/browser/q.X68', 'delete', remover(env, '/browser/q.X68'), yes);
    const browserItem = (await h.trashItems()).find((i) => i.path === '/browser/q.X68');
    expect(browserItem && 'folderName' in browserItem).toBe(false);
  });
});

describe('the halves never take room from each other (P3.3.4)', () => {
  it('with the versions half full, 100 saves never remove a Trash item; with the Trash full, 10 deletes never remove an earlier version', async () => {
    const env = setup();
    const h = env.make({ quota: 40 * MB }); // B = 4 MB (below 32 MB of quota storage is tight)
    for (let i = 0; i < 3; i++) {
      await env.vfs.writeFile(`/browser/t${i}.X68`, noise(200_000, 50 + i));
      await h.guard(`/browser/t${i}.X68`, 'delete', remover(env, `/browser/t${i}.X68`), yes);
    }
    const items = (await h.trashItems()).length;
    for (let i = 0; i < 100; i++) await save(env, h, `/browser/s${i % 7}.X68`, noise(60_000, 100 + i));
    expect((await h.trashItems()).length).toBe(items);
    expect(env.events.some((e) => e.kind === 'prune' && e.half === 'versions')).toBe(true);
    const versions = (await h.usage()).versions;
    env.events.length = 0;
    for (let i = 0; i < 10; i++) {
      await env.vfs.writeFile(`/browser/u${i}.X68`, noise(600_000, 200 + i));
      await h.guard(`/browser/u${i}.X68`, 'delete', remover(env, `/browser/u${i}.X68`), yes);
    }
    expect(env.events.filter((e) => e.kind === 'prune' && e.half === 'trash').length).toBeGreaterThan(0);
    expect(env.events.some((e) => e.kind === 'prune' && e.livingVersions > 0)).toBe(false);
    expect((await h.usage()).versions).toBe(versions);
  }, 120_000);

  it('admission prunes a half down to 0.9 x B / 2', async () => {
    const env = setup();
    const h = env.make({ quota: 40 * MB });
    for (let i = 0; i < 40; i++) {
      await env.vfs.writeFile(`/browser/t${i}.X68`, noise(200_000, 300 + i));
      await h.guard(`/browser/t${i}.X68`, 'delete', remover(env, `/browser/t${i}.X68`), yes);
      const usage = await h.usage();
      expect(usage.trashBytes).toBeLessThanOrEqual(2 * MB);
      if (env.events.some((e) => e.kind === 'prune')) {
        expect(usage.trashBytes).toBeLessThanOrEqual(0.9 * 2 * MB);
        return;
      }
    }
    throw new Error('no pruning happened');
  }, 120_000);
});

describe('states and the database (P3.3.5, P3.3.7, P4.4)', () => {
  it('the table of states: each member in each state', async () => {
    const env = setup();
    const ready = env.make();
    await save(env, ready, '/browser/a.X68', text('a'));
    const tight = env.make({ estimate: async () => ({ quota: 100 * MB, usage: 80 * MB }) });
    await tight.usage();
    for (const state of ['ready', 'off', 'tight'] as HistoryState[]) {
      env.settings.setHistory(state !== 'off');
      const h = state === 'tight' ? tight : ready;
      expect(h.state()).toBe(state);
      const before = (await h.versions('/browser/a.X68')).length;
      await h.record('/browser/a.X68', text(`r-${state}`), 'saved', START);
      expect((await h.versions('/browser/a.X68')).length).toBe(state === 'ready' ? before + 1 : before);
      // moved, dropTrash, clearVersions and the pass run in off and tight too; reads read.
      expect((await h.usage()).versions).toBeGreaterThan(0);
      expect(await h.trashItems()).toEqual([]);
    }
    env.settings.setHistory(true);
    // unavailable: an IDBFactory of null.
    const none = createHistoryService({
      ...browserHistoryDeps({
        vfs: env.vfs,
        settings: env.settings,
        clock: env.clock,
        scheduler: env.scheduler,
      } as never),
    });
    expect(none.state()).toBe('unavailable');
    await expect(none.record('/browser/a.X68', text('x'), 'saved', 1)).resolves.toBeUndefined();
    expect(await none.versions('/browser/a.X68')).toEqual([]);
    expect(await none.trashItems()).toEqual([]);
    expect(await none.usage()).toEqual({ versions: 0, versionBytes: 0, trashItems: 0, trashBytes: 0, budget: 0 });
    await expect(none.read('/browser/a.X68', 1)).rejects.toThrow();
    expect(await none.restoreTrash('x', RESTORE_ALL)).toEqual({ restored: [], left: [], lost: [], gone: true });
    for (const p of [
      none.dropTrash(['x']),
      none.moved('/browser/a', '/browser/b'),
      none.clearVersions(),
      none.deleteAll(),
    ]) {
      await expect(p).resolves.toBeUndefined();
    }
    const act = vi.fn(async () => {});
    expect(await none.guard('/browser/a.X68', 'delete', act, yes)).toEqual({ outcome: 'not-kept' });
    expect(act).toHaveBeenCalled();
  });

  it.each(['off', 'tight'] as const)(
    'in state %s moved, dropTrash, clearVersions and a restore change records',
    async (state) => {
      const env = setup();
      const ready = env.make();
      await save(env, ready, '/browser/a.X68', text('a1'));
      await save(env, ready, '/browser/a.X68', text('a2'));
      await save(env, ready, '/browser/b.X68', text('b'));
      await save(env, ready, '/browser/c.X68', text('c'));
      const { item: b } = await ready.guard('/browser/b.X68', 'delete', remover(env, '/browser/b.X68'), yes);
      const { item: c } = await ready.guard('/browser/c.X68', 'delete', remover(env, '/browser/c.X68'), yes);
      let h: HistoryStore = ready;
      if (state === 'off') env.settings.setHistory(false);
      else {
        h = env.make({ estimate: async () => ({ quota: 100 * MB, usage: 90 * MB }) });
        await h.usage();
      }
      expect(h.state()).toBe(state);
      await env.vfs.writeFile('/browser/z.X68', await env.vfs.readFile('/browser/a.X68'));
      await env.vfs.remove('/browser/a.X68');
      await h.moved('/browser/a.X68', '/browser/z.X68');
      expect((await h.versions('/browser/z.X68')).length).toBe(2);
      expect((await h.restoreTrash(b ?? '', RESTORE_ALL)).restored).toEqual(['/browser/b.X68']);
      expect((await h.versions('/browser/b.X68')).length).toBe(1); // the copy moved back by admission
      await h.dropTrash([c ?? '']);
      expect(await h.trashItems()).toEqual([]);
      await h.clearVersions();
      expect((await h.usage()).versions).toBe(0);
    },
  );

  it('re-importing a folder with a .git of 300 files and five 5 MB PDFs keeps nothing and removes nothing', async () => {
    const env = setup();
    const h = env.make({ quota: 40 * MB });
    await save(env, h, '/browser/other.X68', text('o1'));
    await save(env, h, '/browser/other.X68', text('o2'));
    const files: [VPath, Bytes][] = [];
    for (let i = 0; i < 300; i++) files.push([`/browser/repo/.git/objects/${i}`, text(`object ${i}`)]);
    for (let i = 0; i < 5; i++) files.push([`/browser/repo/doc${i}.pdf`, noise(5 * MB, 600 + i)]);
    for (const [path, data] of files) await env.vfs.writeFile(path, data);
    const before = await dump(env.factory);
    // Import with Replace: the import's keep (P3.3.4) for each file it replaces, then the write.
    for (const [path, data] of files) {
      await h.record(path, await env.vfs.readFile(path), 'before-import', env.clock.t);
      await env.vfs.writeFile(path, data);
    }
    await h.settled();
    const after = await dump(env.factory);
    expect(after.versions).toEqual(before.versions);
    expect(after.files).toEqual(before.files);
    expect(env.events.filter((e) => e.kind === 'prune')).toEqual([]);
  }, 120_000);

  it('over 1,000 saves at the budget a half is pruned at most once per 0.1 x B / 2 of new counted bytes', async () => {
    const env = setup();
    const h = env.make({ quota: 40 * MB }); // B / 2 = 2 MB
    for (let i = 0; i < 1000; i++) {
      env.clock.t += 7 * MINUTE;
      await save(env, h, `/browser/s${i % 40}.X68`, noise(20_000 + (i % 7) * 1000, 9000 + i));
    }
    const prunes = env.events.filter((e) => e.kind === 'prune' && e.half === 'versions').length;
    // Each kept version adds its stored size plus 128; the noise does not compress.
    const added = Array.from({ length: 1000 }, (_, i) => 20_000 + (i % 7) * 1000 + 128).reduce(
      (a, b) => a + b,
      128 * 40,
    );
    const tenth = 0.1 * 2 * MB;
    expect(prunes).toBeGreaterThan(0);
    expect(prunes).toBeLessThanOrEqual(Math.ceil(added / tenth));
  }, 120_000);

  it('the global pass runs in state off; locks null: the pass still runs', async () => {
    const env = setup();
    const h = env.make({ locks: null });
    await save(env, h, '/browser/a.X68', text('a'));
    await h.guard('/browser/a.X68', 'delete', remover(env, '/browser/a.X68'), yes);
    env.settings.setHistory(false);
    env.clock.t += 31 * DAY;
    await h.globalPass();
    expect(await h.trashItems()).toEqual([]);
  });

  it('an open that never completes gives unavailable after 5 s (fake clock)', async () => {
    const env = setup();
    const never = {
      open: () => ({}) as IDBOpenDBRequest,
      deleteDatabase: () => ({}) as IDBOpenDBRequest,
      cmp: () => 0,
    } as unknown as IDBFactory;
    const h = createMemoryHistoryStore(
      { vfs: env.vfs, clock: env.clock, scheduler: env.scheduler, settings: env.settings, factory: never as never },
      { schedulePass: false },
    );
    expect(h.state()).toBe('ready');
    env.scheduler.advance(4999);
    await Promise.resolve();
    expect(h.state()).toBe('ready');
    env.scheduler.advance(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.state()).toBe('unavailable');
    expect(h.unavailableDetail()).toMatch(/5 s/);
  });

  it('a record that does not parse is skipped and counted; a meta that does not parse gives unavailable, and deleteAll recovers', async () => {
    const env = setup();
    const h = env.make();
    await save(env, h, '/browser/a.X68', text('a'));
    await save(env, h, '/browser/b.X68', text('b'));
    await h.guard('/browser/b.X68', 'delete', remover(env, '/browser/b.X68'), yes);
    h.close();
    await poke(
      env.factory,
      'files',
      (store) =>
        new Promise<void>((resolve) => {
          const r = store.openCursor();
          r.onsuccess = () => {
            const c = r.result;
            if (!c) return resolve();
            if ((c.value as { trash?: unknown }).trash) c.update({ ...(c.value as object), count: -1 });
            c.continue();
          };
        }),
    );
    const again = env.make();
    expect(await again.trashItems()).toEqual([]);
    expect(again.unreadable()).toBe(1);
    expect((await again.versions('/browser/a.X68')).length).toBe(1);
    again.close();
    await poke(env.factory, 'meta', async (store) => void store.put('not totals', 'totals'));
    const third = env.make();
    await third.usage();
    expect(third.state()).toBe('unavailable');
    expect(third.unavailableDetail()).toMatch(/damaged/);
    await third.deleteAll();
    expect(third.state()).toBe('ready');
    await save(env, third, '/browser/a.X68', text('fresh'));
    expect((await third.versions('/browser/a.X68')).length).toBe(1);
  });

  it('the lowering when storage becomes tight happens once until free space was above 64 MB, and meta.notice records it', async () => {
    const env = setup();
    let usage = 0;
    const h = env.make({ estimate: async () => ({ quota: 1000 * MB, usage }) });
    for (let i = 0; i < 20; i++) await save(env, h, `/browser/f${i}.X68`, noise(50_000, 400 + i));
    const full = (await h.usage()).versionBytes;
    usage = 990 * MB; // tight
    env.events.length = 0;
    await h.globalPass();
    expect(h.state()).toBe('tight');
    const lowered = (await h.usage()).versionBytes;
    expect(lowered).toBeLessThanOrEqual(full / 2);
    const notice = (await dump(env.factory)).meta.find((m) => m.key === 'notice')?.value as {
      armed: boolean;
      halvedAt?: number;
    };
    expect(notice).toEqual({ armed: false, halvedAt: env.clock.t });
    await h.globalPass();
    expect((await h.usage()).versionBytes).toBe(lowered);
    // Nothing new is kept while tight.
    await save(env, h, '/browser/new.X68', text('new'));
    expect(await h.versions('/browser/new.X68')).toEqual([]);
    usage = 0; // room again: armed; then tight again: lowered once more
    await h.globalPass();
    expect(h.state()).toBe('ready');
    usage = 990 * MB;
    await h.globalPass();
    expect((await h.usage()).versionBytes).toBeLessThanOrEqual(lowered / 2 + 1);
  });

  it('a fake IndexedDB that fails any request issued after a non-IndexedDB await passes every operation', async () => {
    // fake-indexeddb ends a transaction as soon as control returns to the event loop with nothing
    // pending, so any request after an await on something else (a timer, a hash) throws
    // TransactionInactiveError. Several members catch every error and resolve (moved, dropTrash,
    // clearVersions, the global pass), so a rejection would not show such a failure: the spy is
    // on fake-indexeddb itself and counts every request that throws and every transaction that
    // aborts, whoever catches it; and each member's effect is checked as well.
    const env = setup();
    const spy = spyOnIndexedDb();
    try {
      // The spy sees the failure it is there for: a request after a timer inside a transaction.
      await expect(foreignAwaitInTransaction(env.factory)).rejects.toThrow();
      expect(spy.failures.length).toBeGreaterThan(0);
      spy.failures.length = 0;

      const h = env.make();
      await save(env, h, '/browser/d/a.X68', text('a'));
      await save(env, h, '/browser/d/b.X68', text('b'));
      expect((await h.versions('/browser/d/a.X68')).map((v) => v.reason)).toEqual(['saved']);
      await h.guard('/browser/d/a.X68', 'replace', writer(env, '/browser/d/a.X68', text('A'), 'replace'), yes);
      expect((await h.trashItems()).map((i) => i.cause)).toEqual(['replaced']);
      await h.guard('/browser/d/a.X68', 'restore', writer(env, '/browser/d/a.X68', text('a'), 'restore'), yes);
      expect((await h.versions('/browser/d/a.X68')).map((v) => v.reason)).toContain('before-restore');
      for (const n of ['a', 'b']) {
        await env.vfs.writeFile(`/browser/e/${n}.X68`, await env.vfs.readFile(`/browser/d/${n}.X68`));
        await env.vfs.remove(`/browser/d/${n}.X68`);
      }
      await env.vfs.remove('/browser/d');
      await h.moved('/browser/d', '/browser/e');
      expect(await h.versions('/browser/d/b.X68')).toEqual([]);
      expect((await h.versions('/browser/e/b.X68')).length).toBe(1);
      const { item } = await h.guard('/browser/e', 'delete', remover(env, '/browser/e'), yes);
      expect(item).toBeDefined();
      expect(await env.vfs.stat('/browser/e/a.X68')).toBeNull();
      const out = await h.restoreTrash(item ?? '', RESTORE_ALL);
      expect(out.restored.sort()).toEqual(['/browser/e/a.X68', '/browser/e/b.X68']);
      await h.globalPass();
      expect((await h.versions('/browser/e/a.X68')).length).toBeGreaterThan(0);
      await h.clearVersions();
      expect(await h.versions('/browser/e/a.X68')).toEqual([]);
      expect(await h.versions('/browser/e/b.X68')).toEqual([]);
      expect((await h.trashItems()).length).toBeGreaterThan(0);
      await h.dropTrash((await h.trashItems()).map((i) => i.id));
      expect(await h.trashItems()).toEqual([]);
      const usage = await h.usage();
      expect([usage.versions, usage.trashItems, usage.trashBytes]).toEqual([0, 0, 0]);
      // A plan that went on after its transaction ended issues its next request later (when its
      // foreign await ends), after the member already resolved: let such stragglers run.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(spy.failures).toEqual([]);
      expect(h.unavailableDetail()).toBeNull();
      expect(h.unreadable()).toBe(0);
    } finally {
      spy.restore();
    }
  });

  it('the texts of P3.3.4, exactly', () => {
    expect(cannotKeepQuestion('delete', 'prog.X68', false)).toBe(
      'EASy68K cannot keep a copy of "prog.X68" in the Trash. Delete it anyway? This cannot be undone.',
    );
    expect(cannotKeepQuestion('replace', 'prog.X68', false)).toBe(
      'EASy68K cannot keep a copy of the current "prog.X68". Replace it anyway? This cannot be undone.',
    );
    expect(cannotKeepQuestion('restore', 'prog.X68', false)).toBe(
      'EASy68K cannot keep a copy of the current "prog.X68". Restore the earlier version anyway? This cannot be undone.',
    );
    expect(cannotKeepQuestion('undo-copy', 'prog.X68', false)).toBe(
      'EASy68K cannot keep a copy of "prog.X68" in the Trash. Remove the copy anyway? This cannot be undone.',
    );
    expect(changedWhileReplacing('prog.X68')).toBe(
      '"prog.X68" changed while it was being replaced. It was not replaced.',
    );
    expect(changedWhileRestoring('prog.X68')).toBe(
      '"prog.X68" changed while it was being restored. It was not restored.',
    );
    expect(CANNOT_BE_UNDONE).toBe('This cannot be undone.');
    expect(STORAGE_TIGHT_TOAST).toBe(
      "The browser's storage for this site is nearly full. To keep room for your files, EASy68K keeps no new earlier versions or Trash items until there is room again, and removes its oldest ones.",
    );
  });

  it('createMemoryHistoryService is the real store, and historyDatabaseOf gives its database', async () => {
    const env = setup();
    const h = createMemoryHistoryService({ vfs: env.vfs, clock: env.clock, scheduler: env.scheduler });
    expect(h.state()).toBe('ready');
    await env.vfs.writeFile('/browser/a.X68', text('a'));
    await h.record('/browser/a.X68', text('a'), 'saved', START);
    expect((await h.versions('/browser/a.X68')).length).toBe(1);
    expect((await dump(historyDatabaseOf(h))).versions).toHaveLength(1);
  });

  it('the cost of a save does not grow with the history (counted)', async () => {
    const env = setup();
    let reads = 0;
    let writes = 0;
    const h = createMemoryHistoryStore(
      { vfs: env.vfs, clock: env.clock, scheduler: env.scheduler, settings: env.settings, factory: env.factory },
      { schedulePass: false, onRequest: (k) => (k === 'read' ? reads++ : writes++) },
    );
    await env.vfs.writeFile('/browser/a.X68', text('x'));
    const cost: [number, number][] = [];
    for (let i = 0; i < 1000; i++) {
      env.clock.t = START + i * DAY * 0; // all within one 5-minute slot: the record stays small
      reads = 0;
      writes = 0;
      await h.record('/browser/a.X68', text(`v${i}`), 'saved', env.clock.t);
      cost.push([reads, writes]);
    }
    // After the first ten (the record grows to its steady size) every save costs the same.
    const steady = cost.slice(20);
    expect(new Set(steady.map((c) => c.join('/'))).size).toBe(1);
    expect(cost[999]?.[0]).toBeLessThanOrEqual((cost[1]?.[0] ?? 0) + 3);
  }, 120_000);
});

/** Changes the stored database directly (a damaged record). */
async function poke(factory: IDBFactory, store: string, fn: (store: IDBObjectStore) => Promise<void>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const r = factory.open('easy68k-history');
    r.onsuccess = () => resolve(r.result);
  });
  const tx = db.transaction(store, 'readwrite');
  await fn(tx.objectStore(store));
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
  });
  db.close();
}

/**
 * Counts, on fake-indexeddb's own classes, every request method that throws (an inactive
 * transaction: TransactionInactiveError) and every transaction that aborts, whatever code catches
 * the error afterwards.
 */
function spyOnIndexedDb(): { failures: string[]; restore(): void } {
  const failures: string[] = [];
  const undo: (() => void)[] = [];
  const wrap = (proto: object, names: readonly string[], label: string) => {
    for (const name of names) {
      const own = proto as Record<string, unknown>;
      const original = own[name];
      if (typeof original !== 'function') continue;
      own[name] = function (this: unknown, ...args: unknown[]) {
        try {
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } catch (error) {
          failures.push(`${label}.${name}: ${String(error)}`);
          throw error;
        }
      };
      undo.push(() => {
        own[name] = original;
      });
    }
  };
  const requests = [
    'get',
    'getAll',
    'getAllKeys',
    'getKey',
    'put',
    'add',
    'delete',
    'clear',
    'count',
    'openCursor',
    'openKeyCursor',
  ];
  wrap(FakeIDBObjectStore.prototype, [...requests, 'index'], 'IDBObjectStore');
  wrap(FakeIDBIndex.prototype, requests, 'IDBIndex');
  wrap(FakeIDBCursor.prototype, ['continue', 'advance', 'continuePrimaryKey', 'update', 'delete'], 'IDBCursor');
  wrap(FakeIDBTransaction.prototype, ['objectStore'], 'IDBTransaction');
  const dbProto = FakeIDBDatabase.prototype as unknown as { transaction: (...a: unknown[]) => IDBTransaction };
  const transaction = dbProto.transaction;
  dbProto.transaction = function (this: unknown, ...args: unknown[]) {
    const tx = transaction.apply(this, args);
    tx.addEventListener('abort', () => failures.push(`transaction aborted: ${String(tx.error)}`));
    return tx;
  };
  undo.push(() => {
    dbProto.transaction = transaction;
  });
  return {
    failures,
    restore: () => {
      for (const step of undo.reverse()) step();
    },
  };
}

/** A transaction that issues a request after a timer: what the spy must see. */
async function foreignAwaitInTransaction(factory: IDBFactory): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open('easy68k-history-spy-probe');
    r.onupgradeneeded = () => r.result.createObjectStore('s');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    const tx = db.transaction('s', 'readwrite');
    const store = tx.objectStore('s');
    store.put(1, 'a');
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.put(2, 'b'); // the transaction has committed by now: this throws
  } finally {
    db.close();
  }
}
