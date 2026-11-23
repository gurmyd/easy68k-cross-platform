// Browser check of the history store on real IndexedDB (ARCHITECTURE-PLUS P3.3, P5 N3). Owner: N3.
//
//   node app/src/fs/check-history.mjs [--browser chromium|webkit|all] [--out <dir>] [--full]
//
// Starts the Vite development server of app/ on a free port and opens, in headless Chromium and
// WebKit, a blank page of that server in which the store's own modules (fs/history-db.ts, fs/vfs.ts,
// fs/browser-backend.ts, fs/memory-backend.ts) are imported and driven: the real IndexedDB, the real
// crypto.subtle and CompressionStream, Web Locks and BroadcastChannel of the browser. It checks:
//
//   - the same small scenario as the unit tests: versions kept and read back, a folder deleted into
//     the Trash and restored, Earlier Versions' Restore, a move, Delete for Good, Delete Earlier
//     Versions; compression (deflate-raw) gives the bytes back exactly; the database's records are
//     consistent (the totals are the sums of the records, every content is named by a version);
//   - several windows (two pages of one browser): saving the same and different files at once 200
//     times ends with totals equal to the sums of the records; deleting items of B / 6 at once, 50
//     times each, never leaves the Trash half above B / 2; two pages restoring one item at once, on
//     the one real browser file store they share, write the file from the Trash, take the item out
//     of the Trash and leave the records consistent; the pass lock lets one page run the
//     global pass at a time; deleteAll completes while a second page has the database open;
//   - an opened folder with a real directory handle (the origin private file system's): its root is
//     stored with the handle and found again with isSameEntry from another handle object, by a new
//     store; another folder is not taken for it; a Trash item of it names the folder (folderName);
//   - a slow open: while another page keeps a transaction over the database alive, a new page's
//     history is unavailable after 5 s and keeps nothing; when the other page lets go it becomes
//     ready by itself, keeps versions again and records nothing of the time it was unavailable;
//   - Chromium only: after a run like stress run (c) (1 MB files that do not compress; --full for
//     the whole run of 1,000 saves, else 150), the ratio of the growth of estimate().usage to the
//     counted bytes (P3.3.4, "Worst case": if it is above 2, B is divided by it); storage full, with
//     the quota of the origin lowered through the DevTools protocol as features/files/check-files.mjs
//     does: a save of the file succeeds while the history gives way, state() becomes `tight`,
//     meta.notice is written once, later saves keep no versions, and when room returns the history
//     keeps versions again.
//
// Prints "N of M checks passed" and exits 1 on any failure or console error. Nothing is written
// outside --out (default build/history-check), which holds the Vite cache and a screenshot per
// browser. The page is not the application: no feature runs, so nothing else touches the database.

/* global console, process, window, navigator, indexedDB, performance, setTimeout, clearTimeout, crypto, BroadcastChannel, IDBKeyRange, TextEncoder, TextDecoder, URL -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'history-check')));
const full = args.includes('--full');
mkdirSync(outDir, { recursive: true });
const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const PAGE = '/__history-check.html';
const LOAD_TIMEOUT = 240_000;
let baseUrl = '';
let passed = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (ok) passed++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const notes = [];
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}

/** Serves a blank page: the application is not started, only the modules of the store are imported. */
const blankPage = {
  name: 'history-check-page',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== PAGE) return next();
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>History check</title></head><body><p id="out">History check</p></body></html>',
      );
    });
  },
};

// ---- what runs in the page ----------------------------------------------------------------------

/**
 * Installs window.__n3 in the page: setup(options) makes a store over the real browser APIs.
 * `options.files`: 'browser' (the real browser store at /browser) or 'memory' (a memory backend
 * mounted at /browser, so that the estimate counts the history only). `options.quota`: a fake
 * estimate of that quota and no usage (B from it) instead of the browser's. `options.clockOffset`:
 * milliseconds added to the wall clock.
 */
async function install() {
  const [db, vfsModule, memory, browser, model] = await Promise.all([
    import('/src/fs/history-db.ts'),
    import('/src/fs/vfs.ts'),
    import('/src/fs/memory-backend.ts'),
    import('/src/fs/browser-backend.ts'),
    import('/src/fs/history-model.ts'),
  ]);
  const text = (s) => new TextEncoder().encode(s);
  window.__n3 = {
    db,
    model,
    text,
    async setup(options = {}) {
      const vfs = vfsModule.createVfs();
      if (options.files === 'browser') vfs.mount(await browser.BrowserBackend.open({ channel: null }));
      else vfs.mount(new memory.MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' }));
      const offset = options.clockOffset ?? 0;
      const deps = {
        vfs,
        settings: { get: () => ({ app: {} }), update: () => {}, subscribe: () => () => {} },
        clock: { now: () => performance.now(), wallTime: () => new Date(Date.now() + offset) },
        scheduler: {
          setTimer: (ms, fn) => {
            const t = setTimeout(fn, ms);
            return () => clearTimeout(t);
          },
          onFrame: () => () => {},
        },
        indexedDB,
        IDBKeyRange,
        subtle: crypto.subtle,
        compression: {
          CompressionStream: globalThis.CompressionStream,
          DecompressionStream: globalThis.DecompressionStream,
        },
        locks: navigator.locks ?? null,
        channel: (name) => new BroadcastChannel(name),
        estimate:
          options.quota !== undefined
            ? async () => ({ quota: options.quota, usage: 0 })
            : () => navigator.storage.estimate(),
      };
      const store = db.createHistoryStore(deps, { schedulePass: false });
      window.__n3.store = store;
      window.__n3.vfs = vfs;
      return store.windowId;
    },
    /** Text bytes that do not compress (no zero byte, so that they get versions). */
    noise(size, seed) {
      const out = new Uint8Array(size);
      let x = seed >>> 0 || 1;
      for (let i = 0; i < size; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        out[i] = 32 + ((x >>> 0) % 95);
      }
      return out;
    },
    async save(path, data) {
      await window.__n3.vfs.writeFile(path, data);
      await window.__n3.store.record(path, data, 'saved', Date.now());
    },
    remover(root) {
      const vfs = window.__n3.vfs;
      return async (seen) => {
        for (const file of seen) {
          const now = await vfs.stat(file.path);
          if (now && now.mtime === file.mtime && now.size === file.size) await vfs.remove(file.path);
        }
        const clean = async (dir) => {
          const stat = await vfs.stat(dir);
          if (!stat) return true;
          if (stat.kind === 'file') return false;
          let empty = true;
          for (const entry of await vfs.list(dir)) empty = (await clean(`${dir}/${entry.name}`)) && empty;
          if (empty) await vfs.remove(dir).catch(() => {});
          return empty;
        };
        await clean(root);
      };
    },
    /** The database checked directly: the totals are the sums, every content named, no orphan. */
    async consistent() {
      const snap = await model.readHistoryDatabase(indexedDB);
      const sums = { versions: 0, trash: 0 };
      const named = new Set();
      const problems = [];
      const living = new Set();
      for (const [id, record] of snap.files) {
        const versions = snap.versions.get(id) ?? [];
        sums[record.trash ? 'trash' : 'versions'] += 128;
        for (const v of versions) {
          sums[record.trash && v.seq === record.newestSeq ? 'trash' : 'versions'] += v.stored + 128;
          named.add(v.hash);
          if (!snap.contents.has(v.hash)) problems.push(`no content for ${id}/${v.seq}`);
        }
        if (record.count !== versions.length) problems.push(`count of ${id}`);
        if (record.live) {
          if (living.has(record.live)) problems.push(`two living records of ${record.live}`);
          living.add(record.live);
        }
      }
      for (const hash of snap.contents.keys())
        if (!named.has(hash)) problems.push(`content ${hash.slice(0, 8)} named by no version`);
      for (const id of snap.versions.keys()) if (!snap.files.has(id)) problems.push(`versions without record ${id}`);
      if (snap.totals.versions !== sums.versions || snap.totals.trash !== sums.trash) {
        problems.push(`totals ${JSON.stringify(snap.totals)} but sums ${JSON.stringify(sums)}`);
      }
      return { problems, totals: snap.totals, records: snap.files.size };
    },
  };
}

async function openPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}${PAGE.slice(1)}`, { timeout: LOAD_TIMEOUT });
  await page.evaluate(install);
  return { page, errors };
}

// ---- the checks -------------------------------------------------------------------------------------

async function scenario(context, name) {
  const p = `${name}:`;
  const { page, errors } = await openPage(context);
  await page.evaluate(() => window.__n3.setup({ files: 'browser' }));
  const result = await page.evaluate(async () => {
    const { store, vfs, text, save, remover } = window.__n3;
    const out = {};
    out.state = store.state();
    const source = text('\tMOVE.L\tD0,D1\r\n'.repeat(4000));
    await save('/browser/demo/prog.X68', text('first'));
    await save('/browser/demo/prog.X68', text('second'));
    await save('/browser/demo/prog.X68', source);
    await save('/browser/demo/prog.X68', source); // equal to the newest: stores nothing
    const versions = await store.versions('/browser/demo/prog.X68');
    out.versions = versions.length;
    const back = await store.read('/browser/demo/prog.X68', versions[0].seq);
    out.compressedBack = back.length === source.length && back.every((b, i) => b === source[i]);
    out.oldest = new TextDecoder().decode(
      await store.read('/browser/demo/prog.X68', versions[versions.length - 1].seq),
    );
    // Earlier Versions' Restore: the current content (changed outside, not saved here) is kept as
    // "Before restore".
    await vfs.writeFile('/browser/demo/prog.X68', text('changed by another program'));
    const r = await store.guard(
      '/browser/demo/prog.X68',
      'restore',
      async () => {
        await vfs.writeFile('/browser/demo/prog.X68', text('first'));
      },
      async () => false,
    );
    out.restore = r.outcome;
    out.reasons = (await store.versions('/browser/demo/prog.X68')).map((v) => v.reason);
    // A move: the history follows.
    await vfs.writeFile('/browser/lab/prog.X68', await vfs.readFile('/browser/demo/prog.X68'));
    await vfs.remove('/browser/demo/prog.X68');
    await store.moved('/browser/demo/prog.X68', '/browser/lab/prog.X68');
    out.moved = (await store.versions('/browser/lab/prog.X68')).length;
    // A folder into the Trash and back.
    await save('/browser/lab/other.X68', text('other'));
    await vfs.mkdirp('/browser/lab/empty');
    const d = await store.guard('/browser/lab', 'delete', remover('/browser/lab'), async () => false);
    out.deleted = d.outcome;
    out.gone = (await vfs.stat('/browser/lab')) === null;
    const items = await store.trashItems();
    out.items = items.map((i) => `${i.path} ${i.kind} ${i.files}`);
    const restored = await store.restoreTrash(d.item, {
      ask: async () => 'replace',
      fallback: async () => null,
      confirm: async () => false,
    });
    out.restored = restored.restored.sort();
    out.emptyBack = (await vfs.stat('/browser/lab/empty'))?.kind ?? null;
    out.afterRestore = new TextDecoder().decode(await vfs.readFile('/browser/lab/other.X68'));
    out.versionsBack = (await store.versions('/browser/lab/prog.X68')).length;
    // The database itself: the content is stored compressed.
    const snap = await window.__n3.model.readHistoryDatabase(indexedDB, (s) => [...s.contents.keys()]);
    out.encodings = [...new Set([...snap.contents.values()].map((c) => c.enc))].sort();
    out.consistent = (await window.__n3.consistent()).problems;
    // Delete for Good, Delete Earlier Versions.
    await save('/browser/x.X68', text('x'));
    const x = await store.guard('/browser/x.X68', 'delete', remover('/browser/x.X68'), async () => false);
    await store.dropTrash([x.item]);
    out.afterDrop = (await store.trashItems()).length;
    await store.clearVersions();
    out.afterClear = (await store.usage()).versions;
    out.consistentAfter = (await window.__n3.consistent()).problems;
    return out;
  });
  check(`${p} the history is ready`, result.state === 'ready', result.state);
  check(`${p} three versions kept (an equal save stores nothing)`, result.versions === 3, String(result.versions));
  check(`${p} compression gives the bytes back exactly`, result.compressedBack && result.oldest === 'first');
  check(
    `${p} the content is stored compressed (deflate-raw)`,
    result.encodings.includes('deflate-raw'),
    result.encodings.join(','),
  );
  check(
    `${p} Earlier Versions' Restore keeps the current content first`,
    result.restore === 'kept' && result.reasons.includes('before-restore'),
    `${result.restore} ${result.reasons.join(',')}`,
  );
  check(`${p} the history follows a move`, result.moved === 4, String(result.moved));
  check(
    `${p} a folder goes into the Trash as one item`,
    result.deleted === 'kept' && result.gone && result.items.length === 1 && result.items[0] === '/browser/lab dir 2',
    result.items.join(' | '),
  );
  check(
    `${p} the item is restored with its empty folder`,
    result.restored.join(',') === '/browser/lab/other.X68,/browser/lab/prog.X68' &&
      result.emptyBack === 'dir' &&
      result.afterRestore === 'other',
    `${result.restored.join(',')} ${result.emptyBack}`,
  );
  check(`${p} the restored file keeps its versions`, result.versionsBack === 5, String(result.versionsBack));
  check(`${p} the database is consistent`, result.consistent.length === 0, result.consistent.join('; '));
  check(
    `${p} Delete for Good and Delete Earlier Versions`,
    result.afterDrop === 0 && result.afterClear === 0,
    `${result.afterDrop} ${result.afterClear}`,
  );
  check(
    `${p} the database is consistent after the drops`,
    result.consistentAfter.length === 0,
    result.consistentAfter.join('; '),
  );
  await page.evaluate(() => window.__n3.store.deleteAll());
  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

async function windows(context, name) {
  const p = `${name}:`;
  const a = await openPage(context);
  const b = await openPage(context);
  // B = 3.2 MB (a quota of 32 MB, no usage): small enough that the halves fill.
  const quota = 32 * 1024 * 1024;
  for (const page of [a.page, b.page])
    await page.evaluate((q) => window.__n3.setup({ files: 'memory', quota: q }), quota);
  // Saving the same and different files at once, 200 times each.
  await Promise.all(
    [a.page, b.page].map((page, k) =>
      page.evaluate(async (k) => {
        const { save, noise } = window.__n3;
        for (let i = 0; i < 200; i++) {
          const path = i % 2 === 0 ? '/browser/same.X68' : `/browser/w${k}/f${i % 7}.X68`;
          await save(path, noise(2000 + (i % 13) * 997, k * 1000 + i + 1));
        }
      }, k),
    ),
  );
  const after = await a.page.evaluate(() => window.__n3.consistent());
  check(
    `${p} two pages saving 200 times at once: totals equal the sums of the records`,
    after.problems.length === 0,
    after.problems.join('; ') || JSON.stringify(after.totals),
  );
  // Deleting items of B / 6 at once, 50 times each: the Trash half never above B / 2.
  const size = Math.floor((quota * 0.1) / 6) - 2048;
  const peaks = await Promise.all(
    [a.page, b.page].map((page, k) =>
      page.evaluate(
        async ({ k, size }) => {
          const { store, vfs, noise, remover } = window.__n3;
          let peak = 0;
          let kept = 0;
          for (let i = 0; i < 50; i++) {
            const path = `/browser/del${k}/f${i}.pdf`;
            await vfs.writeFile(path, noise(size, 7000 + k * 100 + i));
            const r = await store.guard(path, 'delete', remover(path), async () => true);
            if (r.outcome === 'kept') kept++;
            const usage = await store.usage();
            peak = Math.max(peak, usage.trashBytes);
          }
          return { peak, kept, budget: (await store.usage()).budget };
        },
        { k, size },
      ),
    ),
  );
  const half = peaks[0].budget / 2;
  check(
    `${p} two pages deleting items of B / 6 at once: the Trash half stays at or below B / 2`,
    peaks.every((x) => x.peak <= half) && peaks.every((x) => x.kept > 0),
    `peaks ${peaks.map((x) => x.peak).join(', ')} of ${half}; kept ${peaks.map((x) => x.kept).join(', ')}`,
  );
  const afterDeletes = await a.page.evaluate(() => window.__n3.consistent());
  check(
    `${p} the records are consistent after the deletes`,
    afterDeletes.problems.length === 0,
    afterDeletes.problems.join('; '),
  );
  // Two pages restoring one item at once, on ONE file store: both pages mount the real browser
  // store (its IndexedDB database is the origin's, shared by the pages), so the page that comes
  // second finds the file the first one wrote, and its ask/guard('replace') runs against it.
  for (const page of [a.page, b.page])
    await page.evaluate((q) => window.__n3.setup({ files: 'browser', quota: q }), quota);
  const item = await a.page.evaluate(async () => {
    const { save, store, remover, text } = window.__n3;
    await save('/browser/r/one.X68', text('from the trash'));
    return (await store.guard('/browser/r/one.X68', 'delete', remover('/browser/r/one.X68'), async () => true)).item;
  });
  const goneFirst = await b.page.evaluate(async () => (await window.__n3.vfs.stat('/browser/r/one.X68')) === null);
  const restores = await Promise.all(
    [a.page, b.page].map((page) =>
      page.evaluate(async (id) => {
        const { store } = window.__n3;
        const asked = [];
        const out = await store.restoreTrash(id, {
          ask: async (path) => (asked.push(path), 'replace'),
          fallback: async () => null,
          confirm: async () => true,
        });
        return {
          restored: out.restored,
          left: out.left,
          lost: out.lost,
          gone: out.gone,
          error: out.error ?? null,
          asked,
        };
      }, item),
    ),
  );
  // Both pages read the one file store.
  const written = await Promise.all(
    [a.page, b.page].map((page) =>
      page.evaluate(async () => {
        const { vfs } = window.__n3;
        const stat = await vfs.stat('/browser/r/one.X68');
        return stat ? new TextDecoder().decode(await vfs.readFile('/browser/r/one.X68')) : null;
      }),
    ),
  );
  const consistent = await a.page.evaluate(() => window.__n3.consistent());
  const leftInTrash = await a.page.evaluate(
    async (id) => (await window.__n3.store.trashItems()).filter((i) => i.id === id).length,
    item,
  );
  check(
    `${p} two pages restoring one item at once on one file store: the file is written from the Trash, the item leaves the Trash, the records stay consistent`,
    goneFirst &&
      written.every((w) => w === 'from the trash') &&
      restores.some((r) => r.restored.length === 1) &&
      restores.every((r) => r.error === null) &&
      leftInTrash === 0 &&
      consistent.problems.length === 0,
    `deleted first: ${goneFirst}; both pages read ${JSON.stringify(written)}; ${JSON.stringify(restores)}; item in the Trash: ${leftInTrash}; ${consistent.problems.join('; ')}`,
  );
  // The pass lock: while page a holds it, page b's pass does nothing; then it runs.
  await b.page.evaluate(() =>
    window.__n3.setup({ files: 'memory', quota: 32 * 1024 * 1024, clockOffset: 31 * 86400000 }),
  );
  await a.page.evaluate(async () => {
    const { save, store, remover, text } = window.__n3;
    await save('/browser/old.X68', text('old'));
    await store.guard('/browser/old.X68', 'delete', remover('/browser/old.X68'), async () => true);
    window.__release = null;
    void navigator.locks.request('easy68k.history.pass', () => new Promise((resolve) => (window.__release = resolve)));
    while (!window.__release) await new Promise((r) => setTimeout(r, 10));
  });
  const whileHeld = await b.page.evaluate(async () => {
    await window.__n3.store.globalPass();
    return (await window.__n3.store.trashItems()).filter((i) => i.path === '/browser/old.X68').length;
  });
  await a.page.evaluate(() => window.__release());
  const afterRelease = await b.page.evaluate(async () => {
    await window.__n3.store.globalPass();
    return (await window.__n3.store.trashItems()).filter((i) => i.path === '/browser/old.X68').length;
  });
  check(
    `${p} the pass lock lets one page run the global pass at a time`,
    whileHeld === 1 && afterRelease === 0,
    `${whileHeld} then ${afterRelease}`,
  );
  // deleteAll with a second page open.
  await b.page.evaluate(() => window.__n3.store.usage()); // b holds an open connection
  const deleted = await a.page
    .evaluate(async () => {
      const started = performance.now();
      await Promise.race([
        window.__n3.store.deleteAll(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('deleteAll did not complete in 20 s')), 20000)),
      ]);
      return { ms: Math.round(performance.now() - started), usage: await window.__n3.store.usage() };
    })
    .catch((error) => ({ error: String(error) }));
  const bAfter = await b.page.evaluate(async () => (await window.__n3.store.trashItems()).length).catch(() => -1);
  check(
    `${p} deleteAll completes with a second page open`,
    !deleted.error && deleted.usage.versions === 0 && bAfter === 0,
    JSON.stringify(deleted) + ` b sees ${bAfter} items`,
  );
  const errors = [...a.errors, ...b.errors];
  check(`${p} several windows: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await a.page.close();
  await b.page.close();
}

/**
 * A slow open (P3.3.5, errata N3 "A slow open"): page a keeps a read-write transaction over the
 * whole history database alive, so that page b's store cannot check its `meta` within the 5 s.
 * Page b's history is then unavailable and a save there keeps nothing; once page a lets go, page b's
 * history becomes ready by itself (its listeners hear it), a save keeps a version, nothing of the
 * time it was unavailable appears, and the database is consistent.
 */
async function slowOpen(context, name) {
  const p = `${name}: slow open:`;
  const a = await openPage(context);
  const b = await openPage(context);
  await a.page.evaluate(async () => {
    await window.__n3.setup({ files: 'memory' });
    await window.__n3.store.usage(); // the database exists, with its stores
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('easy68k-history');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readwrite');
    const store = tx.objectStore(names[0]);
    window.__holding = true;
    window.__held = 0;
    const spin = () => {
      if (!window.__holding) return;
      window.__held++;
      store.get('easy68k-check-nothing').onsuccess = spin;
    };
    spin();
    window.__txDone = new Promise((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve('complete');
      };
      tx.onabort = () => resolve(`aborted: ${tx.error?.name}`);
    });
  });
  const during = await b.page.evaluate(async () => {
    const started = performance.now();
    await window.__n3.setup({ files: 'memory' });
    const { store, save, text } = window.__n3;
    window.__states = [];
    store.subscribe(() => window.__states.push(store.state()));
    while (store.state() === 'ready' && performance.now() - started < 15000)
      await new Promise((r) => setTimeout(r, 50));
    const out = {
      state: store.state(),
      detail: store.unavailableDetail(),
      ms: Math.round(performance.now() - started),
    };
    await save('/browser/slow.X68', text('saved while unavailable'));
    out.versionsMeanwhile = (await store.versions('/browser/slow.X68')).length;
    return out;
  });
  check(
    `${p} the history is unavailable after 5 s while another page holds the database`,
    during.state === 'unavailable' && /within 5 s/.test(during.detail ?? '') && during.ms >= 4900,
    JSON.stringify(during),
  );
  check(`${p} a save meanwhile keeps nothing`, during.versionsMeanwhile === 0, String(during.versionsMeanwhile));
  const released = await a.page.evaluate(async () => {
    window.__holding = false;
    return { requests: window.__held, tx: await window.__txDone };
  });
  const after = await b.page.evaluate(async () => {
    const started = performance.now();
    const { store, save, text } = window.__n3;
    while (store.state() !== 'ready' && performance.now() - started < 20000)
      await new Promise((r) => setTimeout(r, 50));
    const out = { state: store.state(), ms: Math.round(performance.now() - started), states: [...window.__states] };
    out.versionsBefore = (await store.versions('/browser/slow.X68')).length;
    await save('/browser/slow.X68', text('saved when ready'));
    const versions = await store.versions('/browser/slow.X68');
    out.versions = versions.map((v) => v.reason);
    out.back = versions.length
      ? new TextDecoder().decode(await store.read('/browser/slow.X68', versions[0].seq))
      : null;
    out.consistent = (await window.__n3.consistent()).problems;
    return out;
  });
  check(
    `${p} when the other page lets go, the history becomes ready by itself and its listeners hear it`,
    after.state === 'ready' &&
      after.states.includes('unavailable') &&
      after.states[after.states.length - 1] === 'ready',
    `${JSON.stringify(after)}; page a: ${JSON.stringify(released)}`,
  );
  check(
    `${p} then a save keeps a version, and nothing of the time it was unavailable is recorded`,
    after.versionsBefore === 0 && after.versions.join(',') === 'saved' && after.back === 'saved when ready',
    JSON.stringify(after),
  );
  check(`${p} the database is consistent`, after.consistent.length === 0, after.consistent.join('; '));
  await b.page.evaluate(() => window.__n3.store.deleteAll());
  const errors = [...a.errors, ...b.errors];
  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await a.page.close();
  await b.page.close();
}

async function ratio(context) {
  const { page, errors } = await openPage(context);
  await page.evaluate(() => window.__n3.setup({ files: 'memory' }));
  const saves = full ? 1000 : 150;
  const out = await page.evaluate(async (saves) => {
    const { store, save, noise, remover, vfs } = window.__n3;
    const before = (await navigator.storage.estimate()).usage;
    for (let i = 0; i < saves; i++) await save(`/browser/big/f${i % 200}.X68`, noise(1024 * 1024 - 64, i + 1));
    for (let i = 0; i < Math.max(10, saves / 10); i++) {
      const folder = `/browser/del/d${i}`;
      for (let k = 0; k < 5; k++)
        await vfs.writeFile(`${folder}/p${k}.X68`, noise(1024 * 1024 - 200, 100000 + i * 10 + k));
      await store.guard(folder, 'delete', remover(folder), async () => true);
    }
    const usage = await store.usage();
    const counted = usage.versionBytes + usage.trashBytes;
    const after = (await navigator.storage.estimate()).usage;
    return { growth: after - before, counted, usage };
  }, saves);
  const r = out.growth / out.counted;
  check(
    `chromium: run (c) ${full ? 'in full' : `scaled (${saves} saves)`}: usage growth and counted bytes measured`,
    Number.isFinite(r) && out.counted > 0,
    `growth ${(out.growth / 1048576).toFixed(1)} MB, counted ${(out.counted / 1048576).toFixed(1)} MB`,
  );
  note(
    `chromium: estimate().usage grew ${(out.growth / 1048576).toFixed(1)} MB for ${(out.counted / 1048576).toFixed(1)} MB counted: ratio ${r.toFixed(2)}${r > 2 ? ' (above 2: P3.3.4 says B is to be divided by it)' : ' (at or below 2: B stays)'}`,
  );
  await page.evaluate(() => window.__n3.store.deleteAll());
  check('chromium: run (c): no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

async function storageFull(context) {
  const { page, errors } = await openPage(context);
  const cdp = await context.newCDPSession(page);
  const origin = new URL(baseUrl).origin;
  const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
  // 20 MB free: below the 32 MB of P3.3.4, so storage is tight, while a source still fits. Chromium
  // enforces the lowered quota but its estimate() keeps reporting the disk's (seen on 159), so the
  // page reports the lowered quota as a full disk's estimate would.
  const quota = usage + 20 * 1024 * 1024;
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: quota });
  await page.reload();
  await page.evaluate(install);
  await page.evaluate((quota) => {
    const real = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => ({ ...(await real()), quota });
  }, quota);
  await page.evaluate(() => window.__n3.setup({ files: 'browser' }));
  const tight = await page.evaluate(async () => {
    const { store, save, text, vfs } = window.__n3;
    await save('/browser/full/a.X68', text('a first version'));
    const saved = new TextDecoder().decode(await vfs.readFile('/browser/full/a.X68'));
    const state = store.state();
    const read = async () => JSON.stringify((await window.__n3.model.readHistoryDatabase(indexedDB)).notice ?? null);
    const notice0 = await read();
    await store.globalPass();
    const notice1 = await read();
    await store.globalPass();
    const notice2 = await read();
    await save('/browser/full/a.X68', text('a second version'));
    const versions = (await store.versions('/browser/full/a.X68')).length;
    return { saved, state, notice0, notice1, notice2, versions, stateAfter: store.state() };
  });
  check('chromium: storage full: the save of the file succeeds', tight.saved === 'a first version', tight.saved);
  check(
    'chromium: storage full: state() becomes tight',
    tight.state === 'tight' && tight.stateAfter === 'tight',
    `${tight.state} ${tight.stateAfter}`,
  );
  check(
    'chromium: storage full: meta.notice is written once',
    tight.notice0 === 'null' && /"armed":false/.test(tight.notice1) && tight.notice1 === tight.notice2,
    `${tight.notice0} / ${tight.notice1} / ${tight.notice2}`,
  );
  check('chromium: storage full: later saves keep no versions', tight.versions === 0, String(tight.versions));
  await cdp.send('Storage.overrideQuotaForOrigin', { origin });
  await page.reload();
  await page.evaluate(install);
  await page.evaluate(() => window.__n3.setup({ files: 'browser' }));
  const room = await page.evaluate(async () => {
    const { store, save, text } = window.__n3;
    await store.globalPass();
    const notice = JSON.stringify((await window.__n3.model.readHistoryDatabase(indexedDB)).notice ?? null);
    await save('/browser/full/a.X68', text('a third version'));
    return { state: store.state(), notice, versions: (await store.versions('/browser/full/a.X68')).length };
  });
  check(
    'chromium: storage full: when room returns, the lowering is armed again and versions are kept',
    room.state === 'ready' && /"armed":true/.test(room.notice) && room.versions === 1,
    JSON.stringify(room),
  );
  await page.screenshot({ path: join(outDir, 'chromium-history.png') });
  await page.evaluate(() => window.__n3.store.deleteAll());
  const relevant = errors.filter((text) => !/QuotaExceeded|Failed to load resource/.test(text));
  check('chromium: storage full: no console errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  await page.close();
}

/** A history transaction refused for the quota (P3.3.4), in a fresh page whose estimate says nothing. */
async function quotaError(context) {
  const { page, errors } = await openPage(context);
  const cdp = await context.newCDPSession(page);
  const origin = new URL(baseUrl).origin;
  // A history transaction that fails with QuotaExceededError makes the state tight (P3.3.4), even
  // where the estimate says nothing: 3 MB of quota left, a delete of a 16 MB file.
  const usage2 = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: usage2 + 3 * 1024 * 1024 });
  await page.reload();
  await page.evaluate(install);
  await page.evaluate(() => window.__n3.setup({ files: 'memory', quota: 10 * 1024 * 1024 * 1024 }));
  const failed = await page.evaluate(async () => {
    const { store, vfs, noise, remover } = window.__n3;
    await vfs.writeFile('/browser/big.pdf', noise(16 * 1024 * 1024, 9));
    let asked = false;
    const result = await store.guard(
      '/browser/big.pdf',
      'delete',
      remover('/browser/big.pdf'),
      async () => (asked = true),
    );
    return {
      outcome: result.outcome,
      asked,
      state: store.state(),
      gone: (await vfs.stat('/browser/big.pdf')) === null,
    };
  });
  check(
    'chromium: storage full: a history transaction refused for the quota keeps nothing, asks, and makes the state tight',
    failed.outcome === 'not-kept' && failed.asked && failed.state === 'tight' && failed.gone,
    JSON.stringify(failed),
  );
  await cdp.send('Storage.overrideQuotaForOrigin', { origin });
  const relevant = errors.filter((text) => !/QuotaExceeded|Failed to load resource/.test(text));
  check('chromium: quota refused: no console errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  await page.close();
}

// ---- main ---------------------------------------------------------------------------------------------

/**
 * An opened folder with a real FileSystemDirectoryHandle (the origin private file system's, which
 * has the same interface as a folder the student picks): its root is stored in the roots store with
 * the handle, found again with isSameEntry from another handle object of the same folder (also by a
 * new store that reads the handle back from IndexedDB, as a new page would), not found for another
 * folder; and a Trash item of it names the folder (folderName) when it is not open.
 */
async function openedFolder(context, name) {
  const p = `${name}:`;
  const { page, errors } = await openPage(context);
  await page.evaluate(() => window.__n3.setup({ files: 'memory' }));
  const out = await page.evaluate(async () => {
    let step = 'import';
    try {
      return await run();
    } catch (error) {
      return { failed: `${step}: ${error?.name}: ${error?.message}` };
    }
    async function run() {
      const { FolderBackend } = await import('/src/fs/fsaccess-backend.ts');
      let root;
      try {
        root = await navigator.storage.getDirectory();
      } catch (error) {
        return { noFolders: `navigator.storage.getDirectory(): ${error?.name}: ${error?.message}` };
      }
      step = 'getDirectoryHandle';
      const lab = await root.getDirectoryHandle('lab', { create: true });
      await root.getDirectoryHandle('other', { create: true });
      const { vfs, store, remover, text } = window.__n3;
      vfs.mount(new FolderBackend(lab, { mount: 'folder' }));
      step = 'writeFile through FolderBackend';
      await vfs.writeFile('/folder/prog.X68', text('in lab'));
      step = 'the history';
      await store.record('/folder/prog.X68', text('in lab'), 'saved', Date.now());
      const kept = await store.versions('/folder/prog.X68');
      const deleted = await store.guard('/folder/prog.X68', 'delete', remover('/folder/prog.X68'), async () => true);
      const info = (items) => items.map((i) => ({ in: i.restorableInPlace, folder: i.folderName ?? null }));
      vfs.unmount('folder');
      const closed = info(await store.trashItems());
      // Another handle object of the same folder, in a new store (a new page: the roots come from
      // IndexedDB, with their handles).
      await window.__n3.setup({ files: 'memory' });
      const again = await (await navigator.storage.getDirectory()).getDirectoryHandle('lab');
      window.__n3.vfs.mount(new FolderBackend(again, { mount: 'folder' }));
      const reopened = info(await window.__n3.store.trashItems());
      window.__n3.vfs.unmount('folder');
      const other = await (await navigator.storage.getDirectory()).getDirectoryHandle('other');
      window.__n3.vfs.mount(new FolderBackend(other, { mount: 'folder' }));
      const otherFolder = info(await window.__n3.store.trashItems());
      return { versions: kept.length, outcome: deleted.outcome, closed, reopened, otherFolder };
    }
  });
  if (out.noFolders) {
    // The test fixture is missing, not the store failing: Playwright's WebKit on Windows rejects
    // navigator.storage.getDirectory() (UnknownError). The store's side is checked in Chromium.
    note(
      `${name}: this browser gives the page no origin private file system (${out.noFolders}); the opened-folder pass did not run`,
    );
    check(`${p} opened folder: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
    return;
  }
  if (out.failed) {
    check(`${p} opened folder (real directory handle) ran to the end`, false, out.failed);
    await page.close();
    return;
  }
  check(
    `${p} opened folder (real directory handle): a version is kept and a delete goes to the Trash`,
    out.versions === 1 && out.outcome === 'kept',
    JSON.stringify(out),
  );
  check(
    `${p} opened folder: not open, the item names the folder`,
    out.closed.length === 1 && out.closed[0].in === false && out.closed[0].folder === 'lab',
    JSON.stringify(out.closed),
  );
  check(
    `${p} opened folder: the same folder through another handle, in a new store, is found with isSameEntry`,
    out.reopened.length === 1 && out.reopened[0].in === true,
    JSON.stringify(out.reopened),
  );
  check(
    `${p} opened folder: another folder is not taken for it`,
    out.otherFolder.length === 1 && out.otherFolder[0].in === false && out.otherFolder[0].folder === 'lab',
    JSON.stringify(out.otherFolder),
  );
  check(`${p} opened folder: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(outDir, 'vite-cache'),
    plugins: [blankPage],
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`History check: ${baseUrl}${PAGE.slice(1)}\nOutput: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        const pass = async (label, run) => {
          const context = await browser.newContext();
          try {
            await run(context);
          } catch (error) {
            check(
              `${name}: ${label} ran to the end`,
              false,
              String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            );
          } finally {
            await context.close();
          }
        };
        await pass('the scenario', (context) => scenario(context, name));
        await pass('several windows', (context) => windows(context, name));
        await pass('opened folder', (context) => openedFolder(context, name));
        await pass('slow open', (context) => slowOpen(context, name));
        if (name === 'chromium') {
          await pass('run (c)', (context) => ratio(context));
          await pass('storage full', (context) => storageFull(context));
          await pass('quota refused', (context) => quotaError(context));
        } else {
          const context = await browser.newContext();
          const { page } = await openPage(context);
          await page.screenshot({ path: join(outDir, `${name}-history.png`) });
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  console.log(`\n${passed} of ${total} checks passed`);
  if (notes.length) console.log(`Notes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
