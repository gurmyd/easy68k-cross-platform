// The browser store under Node, on fake-indexeddb (ARCHITECTURE.md 3.8.1, 3.8.6; FS1 acceptance).
// The same contract cases run in Chromium and WebKit through app/src/features/files/check-files.mjs.

import { IDBFactory, IDBKeyRange, IDBObjectStore, forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackendChange, Bytes } from '../contracts';
import { BACKEND_CONTRACT_CASES } from './backend-contract';
import {
  BROWSER_DB_NAME,
  BrowserBackend,
  MAX_SEGMENTS,
  STORE_MESSAGES,
  UnsavedBrowserStore,
  openBrowserStore,
  storageProblem,
  type BrowserBackendDeps,
  type ChannelLike,
  type StoreProblem,
} from './browser-backend';
import { createVfs, isFsError } from './vfs';

const opened: BrowserBackend[] = [];
afterEach(async () => {
  for (const backend of opened.splice(0)) await backend.close();
});

/** Channels that deliver between the backends of one test only (as BroadcastChannel does between windows). */
function channelHub(): (name: string) => ChannelLike {
  const members = new Set<ChannelLike>();
  return () => {
    const channel: ChannelLike = {
      onmessage: null,
      postMessage(message) {
        for (const other of members) {
          if (other === channel) continue;
          // Structured clone and asynchronous delivery, like the real thing.
          const copy = structuredClone(message);
          setTimeout(() => other.onmessage?.({ data: copy }), 0);
        }
      },
      close() {
        members.delete(channel);
      },
    };
    members.add(channel);
    return channel;
  };
}

async function openStore(deps: BrowserBackendDeps = {}): Promise<BrowserBackend> {
  const backend = await BrowserBackend.open({
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
    channel: null,
    ...deps,
  });
  opened.push(backend);
  return backend;
}

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (bytes: Bytes): string => String.fromCharCode(...bytes);

async function until(condition: () => boolean | Promise<boolean>, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('the backend contract (fake-indexeddb)', () => {
  for (const c of BACKEND_CONTRACT_CASES) {
    it(c.name, async () => c.run(await openStore()), 20_000);
  }
});

describe('BrowserBackend', { timeout: 60_000 }, () => {
  it('is mounted at /browser as "My Programs"', async () => {
    const backend = await openStore();
    expect([backend.mount, backend.kind, backend.label]).toEqual(['browser', 'browser', 'My Programs']);
  });

  it('keeps files, folders and appended data when the store is opened again (another page load)', async () => {
    const factory = new IDBFactory();
    const first = await openStore({ indexedDB: factory });
    await first.writeFile('demo/prog.X68', ascii('MOVE.B #1,D0'));
    await first.mkdirp('empty/inner');
    await first.appendFile('demo/prog_RunLog.txt', ascii('one'));
    await first.appendFile('demo/prog_RunLog.txt', ascii('two'));
    const mtime = (await first.stat('demo/prog.X68'))?.mtime;
    await first.close();

    const second = await openStore({ indexedDB: factory });
    expect(await second.list('')).toEqual([
      { name: 'demo', kind: 'dir' },
      { name: 'empty', kind: 'dir' },
    ]);
    expect(await second.list('empty')).toEqual([{ name: 'inner', kind: 'dir' }]);
    expect(await second.stat('demo/prog.X68')).toEqual({ kind: 'file', size: 12, mtime, readOnly: false });
    expect((await second.stat('demo/prog_RunLog.txt'))?.size).toBe(6);
    expect(text(await second.readFile('demo/prog_RunLog.txt'))).toBe('onetwo');
    expect(text(await second.readFile('demo/prog.X68'))).toBe('MOVE.B #1,D0');
  });

  it('uses the database and object store of 3.8.1, with the file bytes under the path', async () => {
    const factory = new IDBFactory();
    const backend = await openStore({ indexedDB: factory });
    await backend.writeFile('a/b.X68', ascii('xy'));
    await backend.close();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(BROWSER_DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect([...db.objectStoreNames]).toEqual(['files']);
    const value = await new Promise<{ data: Uint8Array; mtime: number }>((resolve) => {
      const request = db.transaction('files').objectStore('files').get('a/b.X68');
      request.onsuccess = () => resolve(request.result);
    });
    expect(text(value.data)).toBe('xy');
    expect(typeof value.mtime).toBe('number');
    db.close();
  });

  it('merges appended segments on the next read, and at once beyond 256 segments', async () => {
    const backend = await openStore();
    for (let i = 0; i < 10; i++) await backend.appendFile('log.txt', ascii(String(i)));
    expect(backend.segmentsOf('log.txt')).toBe(10);
    expect(text(await backend.readFile('log.txt'))).toBe('0123456789');
    await backend.idle();
    expect(backend.segmentsOf('log.txt')).toBe(0);
    expect(text(await backend.readFile('log.txt'))).toBe('0123456789');

    for (let i = 0; i <= MAX_SEGMENTS; i++) await backend.appendFile('big.txt', ascii('x'));
    await backend.idle();
    expect(backend.segmentsOf('big.txt')).toBe(0);
    expect((await backend.stat('big.txt'))?.size).toBe(MAX_SEGMENTS + 1);
    expect((await backend.readFile('big.txt')).length).toBe(MAX_SEGMENTS + 1);
  }, 60_000);

  it('a merge does not change the modification time', async () => {
    const backend = await openStore();
    await backend.appendFile('t.txt', ascii('a'));
    await backend.appendFile('t.txt', ascii('b'));
    const before = (await backend.stat('t.txt'))?.mtime;
    await backend.readFile('t.txt');
    await backend.idle();
    expect((await backend.stat('t.txt'))?.mtime).toBe(before);
  });

  it('appendFile of 1 kB costs the same for a 20 MB file as for a 1 kB file', async () => {
    const backend = await openStore();
    const kilobyte = new Uint8Array(1024).fill(0x41);
    await backend.writeFile('small.bin', kilobyte);
    await backend.writeFile('large.bin', new Uint8Array(20 << 20).fill(0x42));
    // Best of several runs: the machine is shared with other test runs.
    const best = async (rel: string) => {
      let fastest = Infinity;
      for (let run = 0; run < 15; run++) {
        const start = performance.now();
        await backend.appendFile(rel, kilobyte);
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    await best('small.bin'); // warm up
    const small = await best('small.bin');
    const large = await best('large.bin');
    console.log(`appendFile 1 kB: best ${small.toFixed(2)} ms on a 1 kB file, ${large.toFixed(2)} ms on a 20 MB file`);
    // A cost proportional to the file would be about 20000 times larger.
    expect(large).toBeLessThan(small * 5 + 5);
    expect((await backend.stat('large.bin'))?.size).toBe((20 << 20) + 15 * 1024);
  }, 120_000);

  it('two windows on one store: a write in one is listed in the other without a reload', async () => {
    const factory = new IDBFactory();
    const hub = channelHub();
    const a = await openStore({ indexedDB: factory, channel: hub });
    const b = await openStore({ indexedDB: factory, channel: hub });
    const vfsB = createVfs();
    vfsB.mount(b);
    const seen: string[] = [];
    vfsB.subscribe('/browser', (change) => seen.push(`${change.origin} ${change.kind} ${change.path}`));

    await a.writeFile('demo/prog.X68', ascii('ORG $1000'));
    await until(async () => (await b.list('')).some((entry) => entry.name === 'demo'), 'b lists demo');
    expect(await b.list('demo')).toEqual([{ name: 'prog.X68', kind: 'file' }]);
    expect(text(await b.readFile('demo/prog.X68'))).toBe('ORG $1000');
    expect((await b.stat('demo/prog.X68'))?.mtime).toBe((await a.stat('demo/prog.X68'))?.mtime);
    await until(() => seen.length > 0, 'b reports the change');
    expect(seen).toEqual(['external write /browser/demo/prog.X68']);

    await a.appendFile('demo/log.txt', ascii('12'));
    await until(async () => (await b.stat('demo/log.txt'))?.size === 2, 'b sees the appended size');

    await a.remove('demo');
    await until(async () => (await b.stat('demo')) === null, 'b forgets the removed folder');
    expect(await b.list('')).toEqual([]);
    expect(seen).toContain('external remove /browser/demo');
  });

  it('two windows appending to one file at once lose nothing and corrupt nothing', async () => {
    const factory = new IDBFactory();
    const hub = channelHub();
    const a = await openStore({ indexedDB: factory, channel: hub });
    const b = await openStore({ indexedDB: factory, channel: hub });
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      writes.push(a.appendFile('shared.txt', ascii('a')));
      writes.push(b.appendFile('shared.txt', ascii('b')));
    }
    await Promise.all(writes);
    const content = text(await a.readFile('shared.txt'));
    expect(content.length).toBe(200);
    expect([...content].filter((c) => c === 'a').length).toBe(100);
    await until(async () => (await b.stat('shared.txt'))?.size === 200, 'b sees the final size');
  }, 60_000);

  it('a full storage rejects with a clear message and keeps the saved file intact', async () => {
    const backend = await openStore();
    const problems: StoreProblem[] = [];
    backend.onProblem((problem) => problems.push(problem));
    await backend.writeFile('work/prog.X68', ascii('saved before'));

    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (key === 'work/prog.X68' || (Array.isArray(key) && key[0] === 's')) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return put.call(this, value, key);
    } as typeof put;
    try {
      const error = await backend.writeFile('work/prog.X68', ascii('a new version')).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isFsError(error, 'io')).toBe(true);
      expect((error as Error).message).toBe(STORE_MESSAGES.full('work/prog.X68'));
      const appendError = await backend.appendFile('work/prog.X68', ascii('more')).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isFsError(appendError, 'io')).toBe(true);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    expect(text(await backend.readFile('work/prog.X68'))).toBe('saved before');
    expect((await backend.stat('work/prog.X68'))?.size).toBe(12);
    expect(problems.map((p) => p.kind)).toEqual(['full', 'full']);
    expect(problems[0]?.message).toContain('was not saved');
  });

  it('a store the browser closes (site data cleared) rejects writes with a clear message', async () => {
    const factory = new IDBFactory();
    const backend = await openStore({ indexedDB: factory });
    const problems: StoreProblem[] = [];
    backend.onProblem((problem) => problems.push(problem));
    // fake-indexeddb's declaration names the class where it means an instance.
    forceCloseDatabase((backend as unknown as { db: never }).db);
    const error = await backend.writeFile('x.txt', ascii('x')).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isFsError(error, 'io')).toBe(true);
    expect((error as Error).message).toBe(STORE_MESSAGES.closed);
    expect(problems.map((p) => p.kind)).toContain('closed');
  });

  it('a page where IndexedDB is blocked gets a memory store at /browser and a clear message', async () => {
    const blocked = {
      open() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const backend = await openBrowserStore({ indexedDB: blocked, keyRange: IDBKeyRange, channel: null });
    expect(backend).toBeInstanceOf(UnsavedBrowserStore);
    expect([backend.mount, backend.kind, backend.label]).toEqual(['browser', 'browser', 'My Programs']);
    const problem = storageProblem(backend);
    expect(problem).toContain('Files are NOT being saved');
    expect(problem).toContain('SecurityError');
    // The stand-in still works for the session.
    await backend.writeFile('a.txt', ascii('ok'));
    expect(text(await backend.readFile('a.txt'))).toBe('ok');
  });

  it('a page where opening never finishes gives up after the time limit', async () => {
    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    const backend = await openBrowserStore({ indexedDB: hanging, keyRange: IDBKeyRange, openTimeoutMs: 50 });
    expect(storageProblem(backend)).toContain('took longer than');
  });

  it('storageProblem is null for the real store', async () => {
    expect(storageProblem(await openStore())).toBeNull();
  });

  it('rejects names it cannot store', async () => {
    const backend = await openStore();
    for (const rel of ['/a', 'a/', 'a//b', 'a\\b', 'a/../b', './a', 'nul\0x']) {
      const error = await backend.writeFile(rel, ascii('x')).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isFsError(error, 'invalid-path'), rel).toBe(true);
    }
  });

  it('removing a folder leaves files with a similar name alone', async () => {
    const backend = await openStore();
    await backend.writeFile('ab/x.txt', ascii('1'));
    await backend.writeFile('ab0.txt', ascii('2'));
    await backend.writeFile('ab.txt', ascii('3'));
    await backend.writeFile('abc/y.txt', ascii('4'));
    await backend.appendFile('ab/log.txt', ascii('5'));
    await backend.remove('ab');
    expect((await backend.list('')).map((e) => e.name)).toEqual(['ab.txt', 'ab0.txt', 'abc']);
    expect(await backend.stat('ab/log.txt')).toBeNull();
  });

  it('reports no change of its own window through onExternalChange', async () => {
    const hub = channelHub();
    const backend = await openStore({ channel: hub });
    const changes: BackendChange[] = [];
    backend.onExternalChange((change) => changes.push(change));
    await backend.writeFile('own.txt', ascii('x'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([]);
  });
});
