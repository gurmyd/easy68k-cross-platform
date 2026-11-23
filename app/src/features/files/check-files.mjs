// Browser check of work package FS1: the browser store, the file dialogs, the Files panel, drops,
// export and import (ARCHITECTURE.md 9.2, FS1 acceptance). Owner: FS1.
//
//   node app/src/features/files/check-files.mjs [--browser chromium|webkit|all] [--out <dir>] [--pass <text>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright). It checks what unit tests under Node cannot show:
//
//   - the backend contract suite (fs/backend-contract.ts) on the real IndexedDB of each browser;
//   - appendFile of 1 kB costs the same on a 20 MB file as on a 1 kB file (best of several runs);
//   - written files survive a reload; two pages on one store: a write in one is listed in the other
//     (Vfs and Files panel) without a reload; appends from both pages lose nothing;
//   - a full storage (Chromium: the quota of the origin lowered through the DevTools protocol;
//     WebKit, which has no such switch: its IndexedDB made to refuse large records with a
//     QuotaExceededError) rejects the save with the clear message, shows it, and keeps the saved
//     file intact;
//   - a page killed in the middle of a write (Chromium: renderer crash; WebKit: page closed at
//     once) leaves every file as it was or as written, never half written, and the next page has
//     the real store with every request answered (or the line says what it waited for); where the
//     browser holds the dead page's transaction, the next page has the stand-in with the text of a
//     store that did not answer, and reloading as that text asks gives the real store within
//     3 minutes (the time is printed; FS1 errata entry 31);
//   - a store held by a read-write transaction that never ends (what a dead page can leave): the
//     next page answers within the 20 s limit with the memory stand-in and says why, and once the
//     transaction has ended a reload has the real store, the whole file and no torn write;
//   - blocked storage (IndexedDB.open throws, as in some private windows): the page still starts,
//     the Files panel says plainly that nothing is being kept;
//   - storage that never answers (IndexedDB.open hangs): the page is shown after the short start-up
//     wait, and the Files panel says the store is still opening;
//   - the Open dialog's five filters and the Save dialog's two; the default extension; the
//     overwrite question's text; "From this computer..." imports into /browser/Imported;
//   - files dropped on the window open in the order of the drop;
//   - Export... of a folder downloads a .zip that the system's archive tool lists and tests
//     (python's zipfile, unzip or bsdtar, whichever exists) and that parses back with every byte;
//     a whole-store export imports through Import... into an empty store with every byte equal;
//   - an accessibility scan (axe-core) of the Files panel and the dialogs, in both themes;
//   - the Safari storage notice (R-10), with ?storage-notice=1: in WebKit at the first start, its
//     Export... downloads the whole store, Got it hides it for good (reloads, other windows), the
//     installed app's variant with an empty store and its Import..., both themes, Tab order and
//     names; never in Chromium, never under automation without the parameter, and the panel's
//     layout without it is the one it always had;
//   - no console errors.
//
// Screenshots go to build/FS1/files-check (git-ignored). Exit code 0 = everything passed.
// The page object `window.__easy68k` exists in development builds only (main.tsx).

/* global console, process, window, document, navigator, indexedDB, IDBFactory, IDBDatabase, IDBObjectStore, setTimeout, DataTransfer, DragEvent, File, performance, Navigator, DOMException, URL, TextEncoder, TextDecoder, Buffer, MutationObserver, clearTimeout */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { closeAtEnd, closeWithin, doneWith, endChecks } from '../../../../tests/browser-checks/ending.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
/** --pass <text>: run only the passes whose label contains it (while working; CI runs them all). */
const onlyPass = option('--pass', '');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'FS1', 'files-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];

/**
 * Every pass has a time limit of its own. page.evaluate has no time limit in Playwright, so a page
 * whose IndexedDB never answers would otherwise hold the check until CI cancels the job, with
 * nothing in the log to say where (config's note on CI run 44937920498: 39 minutes in WebKit after
 * "a page killed in the middle of a write"). A pass that runs out of time fails with the last step
 * it reached (`progress`), and the browser's remaining passes are skipped.
 */
const PASS_LIMIT_MS = 6 * 60_000;
/**
 * The kill pass may wait, at each of its five delays, up to HELD_WAIT_MS (3 min) for a store that a
 * killed page's transaction holds, reloading as the message asks (FS1 errata entry 31): five times
 * (3 min + the 20 s of the stand-in + the pages) at most.
 */
const KILL_PASS_LIMIT_MS = 22 * 60_000;
let lastStep = '';
const progress = (step) => {
  lastStep = step;
};
async function timedPass(label, run, limitMs = PASS_LIMIT_MS) {
  lastStep = 'start';
  const began = Date.now();
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: did not finish within ${limitMs / 1000} s; last step: ${lastStep}`)),
      limitMs,
    );
  });
  const pass = run();
  pass.catch(() => {}); // a pass that ran out of time is abandoned; its later failure is not reported twice
  try {
    await Promise.race([pass, limit]);
  } finally {
    clearTimeout(timer);
  }
  console.log(`  (${label}: ${((Date.now() - began) / 1000).toFixed(1)} s)`);
}
function check(name, ok, detail = '') {
  detail = String(detail).slice(0, 300);
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The trimmed texts of the options a dialog's list shows, once they equal `expected`, or what it
 * shows after `timeout` ms. The list is filled from an asynchronous Vfs.list after the dialog
 * appears, so reading it at once can give [] on a busy machine (gate I1: one WebKit run did).
 */
async function listedOptions(dialog, expected, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const listed = (await dialog.locator('[role=option]').allInnerTexts()).map((s) => s.trim());
    if (same(listed, expected) || Date.now() > deadline) return listed;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

/** Another tab holding a version change, a stuck disk: IndexedDB.open never answers. */
function hangIndexedDB() {
  IDBFactory.prototype.open = function () {
    // When the application began to open its store: the store gives up OPEN_TIMEOUT_MS later.
    if (window.__idbOpenAt === undefined) window.__idbOpenAt = performance.now();
    return {};
  };
  // The page itself notes when the Files panel first says "still opening", measured from the start
  // of opening: on a loaded runner the check's own reading can come after the 20 s limit, and the
  // product's message must still be seen (gate I1 round 3 review). A reading in the page does not
  // depend on how fast Playwright answers.
  const watch = () => {
    const seen = () => {
      if (window.__stillOpeningAt !== undefined || window.__idbOpenAt === undefined) return;
      const text = document.querySelector('[data-e68-panel="files"] [role=alert]')?.textContent ?? '';
      if (text.includes('still opening')) window.__stillOpeningAt = Math.round(performance.now() - window.__idbOpenAt);
    };
    new MutationObserver(seen).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    seen();
  };
  if (document.documentElement) watch();
  else document.addEventListener('DOMContentLoaded', watch, { once: true });
}

/** A browser without the File System Access API (WebKit and Firefox have none). */
function withoutFileSystemAccess() {
  for (const key of ['showOpenFilePicker', 'showDirectoryPicker', 'showSaveFilePicker']) {
    try {
      delete window[key];
      if (key in window) Object.defineProperty(window, key, { value: undefined, configurable: true });
    } catch {
      // A browser whose property cannot be removed keeps it; the check then reports what it sees.
    }
  }
}

/** Some private windows: IndexedDB exists but refuses to open. */
function blockIndexedDB() {
  IDBFactory.prototype.open = function () {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
}

async function newContext(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
    ...options,
  });
  await context.addInitScript(pretendWindows);
  return context;
}

async function openApp(context, { expectErrors = false, query = '' } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}${query}`);
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined);
  await page.waitForSelector('[data-e68-panel="files"] [role=tree]');
  return { page, errors, expectErrors };
}

/** Files of a store as { path: bytes joined } (in the page). */
function storeContents(page, root = '/browser') {
  return page.evaluate(async (start) => {
    const { vfs } = window.__easy68k.ctx;
    const out = {};
    const walk = async (dir) => {
      for (const entry of await vfs.list(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.kind === 'dir') {
          out[`${path}/`] = '';
          await walk(path);
        } else {
          out[path] = Array.from(await vfs.readFile(path)).join(',');
        }
      }
    };
    await walk(start);
    return out;
  }, root);
}

async function scan(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: no serious finding`,
    serious.length === 0,
    serious
      .map(
        (v) =>
          `${v.id} (${v.nodes.length}): ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`,
      )
      .join('; '),
  );
}

// ---- passes -------------------------------------------------------------------------------------

/** The contract cases and the append cost on the browser's real IndexedDB. */
async function backendPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  const contract = await page.evaluate(async () => {
    const { BACKEND_CONTRACT_CASES } = await import('/src/fs/backend-contract.ts');
    const { BrowserBackend } = await import('/src/fs/browser-backend.ts');
    const out = [];
    let n = 0;
    for (const c of BACKEND_CONTRACT_CASES) {
      const dbName = `easy68k-contract-${n++}`;
      const backend = await BrowserBackend.open({ dbName, channel: null });
      try {
        await c.run(backend);
        out.push({ name: c.name, ok: true });
      } catch (error) {
        out.push({ name: c.name, ok: false, detail: String(error) });
      } finally {
        await backend.close();
        await new Promise((resolveDelete) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = request.onerror = request.onblocked = () => resolveDelete();
        });
      }
    }
    return out;
  });
  for (const r of contract) check(`${p} contract: ${r.name}`, r.ok, r.detail ?? '');

  // Measured up to three times, best run counted: a loaded machine (CI) must not fail the check.
  let timing = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = await page.evaluate(async () => {
      const { BrowserBackend } = await import('/src/fs/browser-backend.ts');
      const dbName = 'easy68k-append-timing';
      const backend = await BrowserBackend.open({ dbName, channel: null });
      const kilobyte = new Uint8Array(1024).fill(65);
      await backend.writeFile('small.bin', kilobyte);
      await backend.writeFile('large.bin', new Uint8Array(20 << 20).fill(66));
      const best = async (rel) => {
        let fastest = Infinity;
        for (let i = 0; i < 12; i++) {
          const start = performance.now();
          await backend.appendFile(rel, kilobyte);
          fastest = Math.min(fastest, performance.now() - start);
        }
        return fastest;
      };
      await best('small.bin');
      const small = await best('small.bin');
      const large = await best('large.bin');
      const size = (await backend.stat('large.bin')).size;
      const whole = await backend.readFile('large.bin');
      await backend.close();
      await new Promise((resolveDelete) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = request.onerror = request.onblocked = () => resolveDelete();
      });
      return { small, large, size, length: whole.length };
    });
    if (!timing || run.large - run.small * 5 < timing.large - timing.small * 5) timing = run;
    if (timing.large < timing.small * 5 + 10) break;
  }
  check(
    `${p} appendFile of 1 kB: the 20 MB file costs no more than the 1 kB file`,
    timing.large < timing.small * 5 + 10,
    `best ${timing.small.toFixed(2)} ms (1 kB file) vs ${timing.large.toFixed(2)} ms (20 MB file)`,
  );
  check(
    `${p} the 20 MB file keeps every appended byte`,
    timing.size === (20 << 20) + 12 * 1024 && timing.length === timing.size,
  );
  check(`${p} backend pass: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** Reload, two pages, full storage. */
async function storePass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const a = await openApp(context);
  const b = await openApp(context);

  // Survives a reload.
  await a.page.evaluate(() =>
    window.__easy68k.ctx.vfs.writeFile(
      '/browser/check/kept.X68',
      Uint8Array.from([0x20, 0x4f, 0x52, 0x47, 0x0d, 0x0a, 0x80, 0xff]),
    ),
  );
  await a.page.reload();
  await a.page.waitForFunction(() => window.__easy68k !== undefined);
  const kept = await a.page.evaluate(async () =>
    Array.from(await window.__easy68k.ctx.vfs.readFile('/browser/check/kept.X68')),
  );
  check(
    `${p} a written file survives a reload, every byte`,
    same(kept, [0x20, 0x4f, 0x52, 0x47, 0x0d, 0x0a, 0x80, 0xff]),
  );
  await a.page.waitForSelector('[data-e68-panel="files"] [role=tree]');

  // Two pages: a write in A is listed in B without a reload.
  await b.page.evaluate(async () => {
    const { revealInFilesPanel } = await import('/src/features/files/FilesPanel.tsx');
    revealInFilesPanel(window.__easy68k.ctx, '/browser/check/kept.X68');
  });
  await a.page.evaluate(() =>
    window.__easy68k.ctx.vfs.writeFile('/browser/check/from-a.X68', new Uint8Array([1, 2, 3])),
  );
  // Polled inside the page: page.waitForFunction cannot take an async predicate (Playwright takes the
  // returned Promise itself as a truthy answer and resolves at once).
  const listed = await b.page.evaluate(async () => {
    const end = Date.now() + 10_000;
    for (;;) {
      const names = (await window.__easy68k.ctx.vfs.list('/browser/check').catch(() => [])).map((e) => e.name);
      if (names.includes('from-a.X68')) return true;
      if (Date.now() > end) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  check(`${p} two pages: a write in one is listed in the other's Vfs without a reload`, listed);
  const row = await b.page
    .locator('[data-e68-panel="files"] [role=treeitem]', { hasText: 'from-a.X68' })
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  check(`${p} two pages: the other page's Files panel shows the new file`, row);
  await b.page.screenshot({ path: join(outDir, `${name}-two-pages.png`) });

  // Appends from both pages at once.
  await Promise.all([
    a.page.evaluate(async () => {
      for (let i = 0; i < 50; i++)
        await window.__easy68k.ctx.vfs.appendFile('/browser/check/both.txt', new Uint8Array([65]));
    }),
    b.page.evaluate(async () => {
      for (let i = 0; i < 50; i++)
        await window.__easy68k.ctx.vfs.appendFile('/browser/check/both.txt', new Uint8Array([66]));
    }),
  ]);
  const both = await a.page.evaluate(async () =>
    Array.from(await window.__easy68k.ctx.vfs.readFile('/browser/check/both.txt')),
  );
  check(
    `${p} two pages appending to one file: nothing lost, nothing corrupted`,
    both.length === 100 && both.filter((x) => x === 65).length === 50,
    `${both.length} bytes`,
  );

  const errors = [...a.errors, ...b.errors].filter((text) => !/Failed to load resource|QuotaExceeded/.test(text));
  check(`${p} store pass: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** Full storage (Chromium: the origin's quota lowered through the DevTools protocol), on a page of its own. */
async function quotaPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const a = await openApp(context);
  const cdp = await context.newCDPSession(a.page);
  const origin = new URL(baseUrl).origin;
  await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 4 * 1024 * 1024 });
  // The quota applies to the database connections opened after the change: reload the page.
  await a.page.reload();
  await a.page.waitForFunction(() => window.__easy68k !== undefined);
  const outcome = await a.page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    await vfs.writeFile('/browser/check/work.X68', new TextEncoder().encode('saved before'));
    let message = null;
    try {
      await vfs.writeFile('/browser/check/work.X68', new Uint8Array(16 << 20).fill(32));
    } catch (error) {
      message = `${error.code}: ${error.message}`;
    }
    const after = new TextDecoder().decode(await vfs.readFile('/browser/check/work.X68'));
    return { message, after: after.length > 40 ? `${after.length} bytes` : after };
  });
  check(
    `${p} full storage: the save is rejected with the clear message`,
    outcome.message !== null && outcome.message.startsWith("io: The browser's storage for this site is full"),
    String(outcome.message),
  );
  check(`${p} full storage: the file saved before is intact`, outcome.after === 'saved before', outcome.after);
  const toast = await a.page
    .locator('.e68-toast', { hasText: 'storage for this site is full' })
    .first()
    .waitFor({ timeout: 3000 })
    .then(
      () => true,
      () => false,
    );
  check(`${p} full storage: the message is shown`, toast);
  await a.page.screenshot({ path: join(outDir, `${name}-storage-full.png`) });
  await cdp.send('Storage.overrideQuotaForOrigin', { origin });
  const errors = a.errors.filter((text) => !/Failed to load resource|QuotaExceeded/.test(text));
  check(`${p} full storage: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/**
 * WebKit has no switch for the quota, so its full storage is made by the browser's own IndexedDB
 * refusing large records with a QuotaExceededError (an init script wraps IDBObjectStore.put). The
 * store's handling - message, toast, saved file intact - then runs in the real browser.
 */
function refuseLargeRecords() {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (value && value.data instanceof Uint8Array && value.data.length > 1 << 20) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    return put.call(this, value, key);
  };
}

async function injectedQuotaPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  await context.addInitScript(refuseLargeRecords);
  const a = await openApp(context);
  const outcome = await a.page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    await vfs.writeFile('/browser/check/work.X68', new TextEncoder().encode('saved before'));
    let message = null;
    try {
      await vfs.writeFile('/browser/check/work.X68', new Uint8Array(4 << 20).fill(32));
    } catch (error) {
      message = `${error.code}: ${error.message}`;
    }
    const after = new TextDecoder().decode(await vfs.readFile('/browser/check/work.X68'));
    const size = (await vfs.stat('/browser/check/work.X68'))?.size;
    return { message, after: after.length > 40 ? `${after.length} bytes` : after, size };
  });
  check(
    `${p} full storage (QuotaExceededError from the browser's IndexedDB): the save is rejected with the clear message`,
    outcome.message !== null && outcome.message.startsWith("io: The browser's storage for this site is full"),
    String(outcome.message),
  );
  check(
    `${p} full storage: the file saved before is intact, also in the index`,
    outcome.after === 'saved before' && outcome.size === 12,
    `${outcome.after}, size ${outcome.size}`,
  );
  const toast = await a.page
    .locator('.e68-toast', { hasText: 'storage for this site is full' })
    .first()
    .waitFor({ timeout: 3000 })
    .then(
      () => true,
      () => false,
    );
  check(`${p} full storage: the message is shown`, toast);
  await a.page.screenshot({ path: join(outDir, `${name}-storage-full.png`) });
  const errors = a.errors.filter((text) => !/Failed to load resource|QuotaExceeded/.test(text));
  check(`${p} full storage: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/**
 * In the page: every indexedDB.open and every transaction, with when it was made and when (and
 * how) it ended, in window.__idbTrace; times in ms from the page's start. The kill pass reads it
 * to say exactly what a page that waits is waiting for (FS1 errata entry 29).
 */
function traceIndexedDB() {
  const log = [];
  window.__idbTrace = log;
  const at = () => Math.round(performance.now());
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    const request = open.apply(this, args);
    const entry = { what: `indexedDB.open("${args[0]}")`, made: at(), ended: null, outcome: 'no answer' };
    log.push(entry);
    for (const type of ['success', 'error', 'blocked']) {
      request.addEventListener(type, () => {
        if (type === 'blocked') entry.blocked = at();
        else [entry.ended, entry.outcome] = [at(), type];
      });
    }
    return request;
  };
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args);
    const entry = { what: `${args[1] ?? 'readonly'} transaction`, made: at(), ended: null, outcome: 'no answer' };
    log.push(entry);
    tx.addEventListener('complete', () => ([entry.ended, entry.outcome] = [at(), 'complete']));
    tx.addEventListener('abort', () => ([entry.ended, entry.outcome] = [at(), `abort ${tx.error?.name ?? ''}`.trim()]));
    return tx;
  };
}

/**
 * What a page of the kill pass is waiting for: the store mounted at /browser and its message,
 * the IndexedDB requests that have not answered or took over a second, and the Web Locks held and
 * waited for. Evaluated without awaiting the store, so it answers while the store hangs.
 */
async function waitingFor(page) {
  return page
    .evaluate(async () => {
      const store = window.__easy68k?.ctx?.vfs?.backends().find((b) => b.mount === 'browser');
      const banner = document.querySelector('[data-e68-panel="files"] [role=alert]')?.textContent ?? '';
      const now = Math.round(performance.now());
      const slow = (window.__idbTrace ?? [])
        .filter((e) => e.ended === null || e.ended - e.made > 1000)
        .map((e) =>
          e.ended === null
            ? `${e.what} made at ${e.made} ms: no answer after ${now - e.made} ms${e.blocked ? ' (blocked)' : ''}`
            : `${e.what} made at ${e.made} ms: ${e.outcome} after ${e.ended - e.made} ms`,
        );
      let locks;
      try {
        const snapshot = await Promise.race([
          navigator.locks.query(),
          new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
        locks = snapshot
          ? `locks held: ${snapshot.held.map((l) => l.name).join(', ') || 'none'}; waited for: ${snapshot.pending.map((l) => l.name).join(', ') || 'none'}`
          : 'navigator.locks.query() did not answer within 2 s';
      } catch (error) {
        locks = `navigator.locks.query() failed: ${error}`;
      }
      const kind = store?.constructor?.name ?? 'none';
      // A request made a moment ago (a merge after the reading) is not a wait; one older than 1 s is.
      const unanswered = (window.__idbTrace ?? []).some((e) => e.ended === null && now - e.made > 1000);
      const text = `store ${kind}${banner ? ` ("${banner.slice(0, 120)}")` : ''}; IndexedDB: ${slow.join('; ') || 'every request answered within 1 s'}; ${locks}`;
      // What a pending store finally gave (it stays mounted at /browser for good).
      const current = store?.current?.constructor?.name ?? null;
      return { kind, current, unanswered, slow: slow.length > 0, text };
    })
    .catch((error) => ({
      kind: 'unknown',
      unanswered: true,
      slow: true,
      text: `the page did not answer either: ${String(error).slice(0, 120)}`,
    }));
}

/**
 * The limit for the reading in the new page: the store gives up OPEN_TIMEOUT_MS (20 s) after it
 * began to open, so a page that still waits after this long waits for something else.
 */
const SURVIVOR_LIMIT_MS = 60_000;
/** How long a page may take to settle its store: the store gives up after 20 s (OPEN_TIMEOUT_MS). */
const SETTLE_LIMIT_MS = 40_000;
/**
 * How long the kill pass reloads a page whose store did not answer, as the message tells the person
 * to ("reload the page in a minute"), before it decides that the promise does not hold (FS1 errata
 * entry 31), and the pause between two reloads.
 */
const HELD_WAIT_MS = 3 * 60_000;
const RELOAD_PAUSE_MS = 5_000;
/**
 * For the proof of the kill pass itself only (it cannot be made on a PC where the browser ends a
 * dead page's transaction at once): EASY68K_FILES_KILL_HOLD_MS=<ms> makes another page hold a
 * read-write transaction on the store for that long after each kill, as WebKit on GitHub's Windows
 * runner does, so that the stand-in, the reloads and (with more than HELD_WAIT_MS) the failure run.
 */
const HOLD_AFTER_KILL_MS = Number(process.env.EASY68K_FILES_KILL_HOLD_MS ?? 0);

/** Opens a page that holds a read-write transaction on the store for `ms`, then aborts it. */
async function holdStore(context, ms) {
  const page = await context.newPage();
  // A document of the same origin that is not the application (whose own store would wait too).
  await page.goto(`${baseUrl}@vite/client`, { waitUntil: 'load' });
  await page.evaluate(
    (holdMs) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('easy68k-files', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction('files', 'readwrite');
          const store = tx.objectStore('files');
          let alive = true;
          const spin = () => {
            store.get('held').onsuccess = () => {
              if (alive) spin();
            };
          };
          spin();
          setTimeout(() => {
            alive = false;
            tx.abort();
          }, holdMs);
          resolve();
        };
      }),
    ms,
  );
  return page;
}

/**
 * The store a page has mounted at /browser once it has settled: a pending store is awaited (it gives
 * up after OPEN_TIMEOUT_MS). { kind, problem, cause }, or null when it did not settle within `limit`.
 */
async function settledStore(page, limit = SETTLE_LIMIT_MS) {
  return page
    .evaluate(async (ms) => {
      const store = window.__easy68k?.ctx?.vfs?.backends().find((b) => b.mount === 'browser');
      let final = store ?? null;
      if (store && typeof store.whenReady === 'function') {
        final = await Promise.race([store.whenReady(), new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
      }
      if (!final) return null;
      return { kind: final.constructor?.name ?? 'unknown', problem: final.problem ?? null, cause: final.cause ?? null };
    }, limit)
    .catch((error) => ({ kind: 'error', problem: String(error).slice(0, 160), cause: null }));
}

/** Reloads a page as a person does and waits for the application and its Files panel. */
async function reloadApp(page) {
  await page.reload({ waitUntil: 'load', timeout: 180_000 });
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined);
  await page.waitForSelector('[data-e68-panel="files"] [role=tree]');
}

/** Reads the two files of one delay in a page: as it was, as written, or missing (in the page). */
function readKilledFiles(page, path) {
  return page.evaluate(async (target) => {
    const { vfs } = window.__easy68k.ctx;
    const out = {};
    for (const file of [target, `${target}.log`]) {
      const stat = await vfs.stat(file);
      if (!stat) {
        out[file] = 'missing';
        continue;
      }
      const bytes = await vfs.readFile(file);
      const text = bytes.length <= 3 ? new TextDecoder().decode(bytes) : null;
      const whole = file.endsWith('.log')
        ? bytes.length === 4096 && bytes.every((b) => b === 65)
        : text === 'old' || (bytes.length === 8 << 20 && bytes.every((b) => b === 78));
      out[file] = `${whole ? 'whole' : 'HALF'} ${bytes.length} bytes, index ${stat.size}`;
      if (stat.size !== bytes.length) out[file] += ' MISMATCH';
    }
    return out;
  }, path);
}

/**
 * A page that dies in the middle of a write (Chromium: the renderer crashed through the DevTools
 * protocol; WebKit: the page closed at once). Afterwards a new page of the same store finds every
 * file either as it was or as written, never half written, and the index agrees with the bytes.
 *
 * The new page gets the real store at once, or - where the browser goes on holding the dead page's
 * transaction (WebKit on GitHub's Windows runner, run 45086295162; FS1 errata entries 29 and 31) -
 * the memory stand-in after OPEN_TIMEOUT_MS with the text of a store that did not answer, which
 * tells the person to reload in a minute. Then the pass does that: it reloads the page every few
 * seconds (each reload a new document, as a person's) for at most HELD_WAIT_MS, and once the store
 * answers it reads the files there, on the real store, and prints how long the store was held. A
 * store that does not answer within that time fails the pass with the trace: the promise would be
 * false in that browser. A page that does not settle at all is reported with what it waits for.
 */
async function killPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  await context.addInitScript(traceIndexedDB);
  const results = [];
  const waits = [];
  const helds = []; // one line per delay whose new page had to wait
  const standInTexts = []; // { delay, ok, text } for every stand-in page met
  let stopped = '';
  for (const delay of [0, 2, 10, 30, 80]) {
    progress(`delay ${delay} ms: opening the page to kill`);
    const victim = await openApp(context);
    const path = `/browser/kill/f${delay}.bin`;
    // The page to kill must write into the real store, or the pass proves nothing.
    const victimStore = await settledStore(victim.page);
    if (victimStore?.kind !== 'BrowserBackend') {
      waits.push(`delay ${delay} ms: the page to kill had no real store: ${(await waitingFor(victim.page)).text}`);
      stopped = `delay ${delay} ms`;
      await victim.page.close().catch(() => {});
      break;
    }
    progress(`delay ${delay} ms: writing "old"`);
    await victim.page.evaluate(
      async (target) => window.__easy68k.ctx.vfs.writeFile(target, new TextEncoder().encode('old')),
      path,
    );
    await victim.page.evaluate(
      ({ target, ms }) => {
        void window.__easy68k.ctx.vfs.writeFile(target, new Uint8Array(8 << 20).fill(78)).catch(() => {});
        void window.__easy68k.ctx.vfs.appendFile(`${target}.log`, new Uint8Array(4096).fill(65)).catch(() => {});
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
      { target: path, ms: delay },
    );
    progress(`delay ${delay} ms: killing the page in the middle of an 8 MB write`);
    const killedAt = Date.now();
    if (name === 'chromium') {
      // Page.crash never answers (the target dies), so it is not awaited: the page's 'crash' event is.
      const crashed = victim.page.waitForEvent('crash', { timeout: 15_000 }).catch(() => null);
      const cdp = await context.newCDPSession(victim.page);
      void cdp.send('Page.crash').catch(() => {});
      await crashed;
      await victim.page.close().catch(() => {});
    } else {
      await victim.page.close({ runBeforeUnload: false });
    }
    const holder = HOLD_AFTER_KILL_MS > 0 ? await holdStore(context, HOLD_AFTER_KILL_MS) : null;
    progress(`delay ${delay} ms: opening a new page of the same store`);
    const survivor = await openApp(context);
    let store = await settledStore(survivor.page);
    const waitedForStore = store?.kind === 'UnsavedBrowserStore';
    if (waitedForStore) {
      // The designed behaviour of a store that did not answer: the stand-in, with exactly its text.
      const trace = (await waitingFor(survivor.page)).text;
      const expected = [
        notAnsweringText('reading the list of files took longer than 20 s'),
        notAnsweringText('opening the database took longer than 20 s'),
      ];
      const ok = store.cause === 'timeout' && expected.includes(store.problem);
      standInTexts.push({ delay, ok, text: `${store.cause}: ${String(store.problem).slice(0, 160)}` });
      const heldAt = Date.now();
      console.log(`       delay ${delay} ms: the store did not answer, the page has the stand-in: ${trace}`);
      // What the message tells the person to do: reload, until the store answers (at most HELD_WAIT_MS).
      let reloads = 0;
      while (store?.kind !== 'BrowserBackend' && Date.now() - heldAt < HELD_WAIT_MS) {
        progress(`delay ${delay} ms: the store is held; reload ${reloads + 1}`);
        await new Promise((resolve) => setTimeout(resolve, RELOAD_PAUSE_MS));
        await reloadApp(survivor.page);
        reloads++;
        store = await settledStore(survivor.page);
      }
      const heldFor = ((Date.now() - killedAt) / 1000).toFixed(1);
      if (store?.kind === 'BrowserBackend') {
        helds.push(
          `delay ${delay} ms: store held ${heldFor} s after the kill; the real store after ${reloads} reloads`,
        );
      } else {
        const last = (await waitingFor(survivor.page)).text;
        waits.push(
          `delay ${delay} ms: the store did not answer within ${HELD_WAIT_MS / 60_000} minutes of reloading (${reloads} reloads, ${heldFor} s after the kill): ${last}`,
        );
        results.push({ [path]: 'NO ANSWER' });
        stopped = `delay ${delay} ms`;
        await closeWithin(survivor.page);
        break;
      }
    } else if (store?.kind !== 'BrowserBackend') {
      const waited = await waitingFor(survivor.page);
      waits.push(`delay ${delay} ms: the new page's store did not settle (${JSON.stringify(store)}): ${waited.text}`);
      results.push({ [path]: 'NO ANSWER' });
      stopped = `delay ${delay} ms`;
      await closeWithin(survivor.page);
      break;
    }
    progress(`delay ${delay} ms: reading the files in the new page`);
    let timer;
    const reading = readKilledFiles(survivor.page, path);
    reading.catch(() => {}); // a reading that ran out of time is abandoned with its page
    const found = await Promise.race([
      reading,
      new Promise((resolveLimit) => {
        timer = setTimeout(() => resolveLimit(null), SURVIVOR_LIMIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    // Where the new page waited: its store, and any IndexedDB request slower than a second.
    const waited = await waitingFor(survivor.page);
    if (found === null) {
      waits.push(`delay ${delay} ms: the new page did not answer within ${SURVIVOR_LIMIT_MS / 1000} s: ${waited.text}`);
      results.push({ [path]: 'NO ANSWER' });
    } else {
      // Waiting that ended (a slow disk) is printed; a store that gave up or a request still unanswered fails.
      // At once the real store must be mounted itself, as before. After the reloads the store may
      // answer only just within its 20 s (the hold ended meanwhile): then the pending store that the
      // page was shown with must have given the real one.
      const real = waited.kind === 'BrowserBackend' || (waitedForStore && waited.current === 'BrowserBackend');
      if (!real || waited.unanswered) waits.push(`delay ${delay} ms: ${waited.text}`);
      else if (waited.slow) console.log(`       delay ${delay} ms, slow but answered: ${waited.text}`);
      results.push(found);
    }
    await closeWithin(survivor.page);
    if (holder) await closeWithin(holder);
    if (!victim.page.isClosed()) await victim.page.close().catch(() => {});
  }
  if (stopped) waits.push(`the delays after ${stopped} were not run`);
  const flat = results.flatMap((r) => Object.values(r));
  check(
    `${p} a page killed in the middle of a write: every file is as it was or as written, and the index agrees`,
    results.length === 5 &&
      flat.every((v) => v === 'missing' || (v.startsWith('whole') && !v.includes('MISMATCH'))) &&
      results.every((r) => !Object.entries(r).some(([k, v]) => !k.endsWith('.log') && v === 'missing')),
    `${flat.join('; ')}${results.length === 5 ? '' : ` (${results.length} of 5 delays read)`}`,
  );
  // A store that did not answer shows the stand-in with the text of that case (STORE_MESSAGES.notAnswering).
  check(
    `${p} a page killed in the middle of a write: a new page whose store did not answer has the stand-in with the exact text`,
    standInTexts.every((s) => s.ok),
    standInTexts.length === 0
      ? 'no new page had to wait'
      : standInTexts.map((s) => `delay ${s.delay} ms: ${s.ok ? 'ok' : 'WRONG'} ${s.text}`).join(' | '),
  );
  // The new page came up with the real store - at once, or after the reloads its message asks for -
  // and no request of it was left unanswered: when one was, the line says what it waited for.
  check(
    `${p} a page killed in the middle of a write: the new page has the real store, at once or after the reload its message asks for, with every request answered`,
    waits.length === 0,
    waits.join(' | ').slice(0, 300) ||
      `store BrowserBackend, ${results.length} of ${results.length}; at once ${results.length - helds.length}${helds.length ? `; ${helds.join('; ')}` : ''}`,
  );
  for (const held of helds) console.log(`       ${held}`);
  for (const wait of waits) console.log(`       ${wait}`);
  await closeWithin(context);
}

/**
 * What a page that died in the middle of a write can leave behind (FS1 errata entry 29): a
 * read-write transaction on the store that the browser does not end. Here another page holds one
 * open for as long as the pass wants, with a torn write in it, by asking for a record each time the
 * last one answered. The next page must come up and answer within OPEN_TIMEOUT_MS (20 s) of opening
 * with the memory stand-in, saying why; once the transaction has ended (aborted, as the browser
 * ends a dead page's), a reload has the real store with the completely written file and without
 * the torn write. Before the repair that next page waited for ever.
 */
async function heldStorePass(browser, name) {
  const p = `${name}:`;
  const OPEN_TIMEOUT_MS = 20_000; // fs/browser-backend.ts
  const context = await newContext(browser);
  await context.addInitScript(traceIndexedDB);
  progress('opening the page that holds the store');
  const holder = await openApp(context);
  await holder.page.evaluate(async () => {
    await window.__easy68k.ctx.vfs.writeFile('/browser/held/kept.X68', new TextEncoder().encode('old'));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('easy68k-files', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        store.put({ size: 8 << 20, mtime: 1, segs: 0 }, ['h', 'held/torn.bin']);
        store.put({ data: new Uint8Array(4).fill(72) }, ['s', 'held/kept.X68', 1]);
        const hold = { alive: true, tx, ended: new Promise((end) => (tx.onabort = tx.oncomplete = end)) };
        window.__hold = hold;
        const spin = () => {
          store.get('held/kept.X68').onsuccess = () => {
            if (hold.alive) spin();
          };
        };
        spin();
        resolve();
      };
    });
  });
  progress('opening a new page while the store is held');
  const next = await openApp(context);
  let timer;
  const reading = next.page.evaluate(async () => {
    const calledAt = performance.now();
    const stat = await window.__easy68k.ctx.vfs.stat('/browser/held/kept.X68');
    const answeredAt = performance.now();
    const openedAt = (window.__idbTrace ?? []).find((e) => e.what.startsWith('indexedDB.open'))?.made ?? null;
    const mounted = window.__easy68k.ctx.vfs.backends().find((b) => b.mount === 'browser');
    // A PendingBrowserStore stands at /browser for good; what it gave is its current store.
    const store = mounted?.current ?? mounted;
    return {
      stat,
      kind: store?.constructor?.name,
      sinceOpen: openedAt === null ? null : Math.round(answeredAt - openedAt),
      afterCall: Math.round(answeredAt - calledAt),
    };
  });
  reading.catch(() => {});
  progress('reading in the new page while the store is held');
  const outcome = await Promise.race([
    reading,
    new Promise((resolveLimit) => {
      timer = setTimeout(() => resolveLimit(null), 90_000);
    }),
  ]).finally(() => clearTimeout(timer));
  const waited = outcome === null ? await waitingFor(next.page) : null;
  const banner = await next.page
    .locator('[data-e68-panel="files"] [role=alert]')
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => '');
  check(
    `${p} a store held by a transaction that never ends: the next page answers within the 20 s limit`,
    outcome !== null &&
      outcome.sinceOpen !== null &&
      (outcome.sinceOpen <= OPEN_TIMEOUT_MS + 10_000 || outcome.afterCall <= 2000),
    outcome === null
      ? `no answer after 90 s: ${waited.text}`
      : `answered ${outcome.sinceOpen} ms after opening began, ${outcome.afterCall} ms after the call`,
  );
  check(
    `${p} a store held for ever: the next page keeps files in memory and says why`,
    outcome?.kind === 'UnsavedBrowserStore' &&
      outcome.stat === null &&
      banner.includes(notAnsweringText('reading the list of files took longer than 20 s')) &&
      !banner.includes('private window'),
    `${outcome?.kind}: ${banner.slice(0, 200)}`,
  );
  await next.page.screenshot({ path: join(outDir, `${name}-store-held.png`) });
  const nextErrors = next.errors.filter((text) => !/Failed to load resource/.test(text));
  check(`${p} a store held for ever: no console errors`, nextErrors.length === 0, nextErrors.slice(0, 3).join(' | '));
  progress('ending the held transaction and reloading');
  await holder.page.evaluate(async () => {
    window.__hold.alive = false;
    window.__hold.tx.abort();
    await window.__hold.ended;
  });
  await next.page.reload();
  await next.page.waitForSelector('[data-e68-panel="files"] [role=tree]');
  const after = await next.page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    const kind = vfs.backends().find((b) => b.mount === 'browser')?.constructor?.name;
    const stat = await vfs.stat('/browser/held/kept.X68');
    const text = stat ? new TextDecoder().decode(await vfs.readFile('/browser/held/kept.X68')) : null;
    const torn = await vfs.stat('/browser/held/torn.bin');
    return { kind, text, size: stat?.size ?? null, torn: torn !== null };
  });
  check(
    `${p} a store held for ever: once the transaction has ended, a reload has the real store, the whole file and no torn write`,
    after.kind === 'BrowserBackend' && after.text === 'old' && after.size === 3 && !after.torn,
    JSON.stringify(after),
  );
  await closeWithin(context);
}

/**
 * The texts of fs/browser-backend.ts STORE_MESSAGES (errata FS1 entry 30): a store that did not
 * answer in time (`notAnswering`), and the end of the text of a store that is refused (`unavailable`).
 */
const notAnsweringText = (detail) =>
  "Files are NOT being saved right now: the browser's storage did not answer " +
  `(${detail}; another tab of this site, or a page that was closed during a save, may still be holding it). ` +
  'The programs you saved before are still in the browser: reload the page in a minute to see them. ' +
  'What you save until then is lost when this tab closes. Use Export... in the Files panel to keep it.';
const REFUSED_TEXT_END =
  '; for example in a private window, or when storage is blocked for this site). ' +
  'Everything you save is lost when this tab closes. Use Export... in the Files panel to keep your work.';

/** IndexedDB refuses to open (a private window): the page works and says nothing is kept. */
async function blockedPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  await context.addInitScript(blockIndexedDB);
  const { page, errors } = await openApp(context);
  const banner = await page
    .locator('[data-e68-panel="files"] [role=alert]')
    .innerText()
    .catch(() => '');
  check(
    `${p} blocked storage: the Files panel says files are not being saved, with the text of a refused store`,
    banner.startsWith('Files are NOT being saved: this browser does not let the page keep files (') &&
      banner.includes(REFUSED_TEXT_END),
    banner.slice(0, 300),
  );
  const kind = await page.evaluate(
    () => window.__easy68k.ctx.vfs.backends().find((b) => b.mount === 'browser')?.constructor.name,
  );
  check(
    `${p} blocked storage: a stand-in store at /browser keeps the session working`,
    kind === 'UnsavedBrowserStore',
    String(kind),
  );
  const works = await page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    await vfs.writeFile('/browser/x.txt', new Uint8Array([7]));
    return Array.from(await vfs.readFile('/browser/x.txt'));
  });
  check(`${p} blocked storage: saving still works for the session`, same(works, [7]));
  await page.screenshot({ path: join(outDir, `${name}-blocked-storage.png`) });
  check(`${p} blocked storage: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/**
 * IndexedDB.open never answers (review FS1, defect 2): the application is shown after the short
 * start-up wait (START_WAIT_MS, 3 s), not after the 20 s time limit, and the Files panel says the
 * store is still opening.
 */
async function hangingPass(browser, name) {
  const p = `${name}:`;
  // A timing criterion on a busy machine: up to three attempts, the best one counts (gate rule). One
  // WebKit run on the shared PC took 26.6 s from page load to the shell, because the page's own
  // modules arrived that slowly, while the other runs took about 3.5 s.
  let best = null;
  const timings = [];
  const readings = [];
  const OPEN_TIMEOUT_MS = 20_000; // fs/browser-backend.ts
  for (let attempt = 0; attempt < 3; attempt++) {
    const context = await newContext(browser);
    await context.addInitScript(hangIndexedDB);
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    // Measured from the moment the page has loaded its modules (the dev server's first transform of
    // a cold cache can take longer than the whole wait on a slow runner).
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 180_000 });
    const loadedAt = Date.now();
    await page.waitForSelector('.e68-shell', { timeout: 60_000 });
    const shownAfter = Date.now() - loadedAt;
    timings.push(shownAfter);
    // Read at once: 20 s after opening began, the pending store gives way to the memory stand-in.
    await page.waitForSelector('[data-e68-panel="files"] [role=tree]');
    // The banner and how long ago opening began, read together in the page.
    const { banner, sinceOpen, kind, stillOpeningAt } = await page.evaluate(() => ({
      banner: document.querySelector('[data-e68-panel="files"] [role=alert]')?.innerText ?? '',
      sinceOpen: window.__idbOpenAt === undefined ? null : Math.round(performance.now() - window.__idbOpenAt),
      kind: window.__easy68k.ctx.vfs.backends().find((b) => b.mount === 'browser')?.constructor.name,
      stillOpeningAt: window.__stillOpeningAt ?? null,
    }));
    readings.push({ sinceOpen, banner, stillOpeningAt });
    if (best === null || shownAfter < best.shownAfter) {
      await page.screenshot({ path: join(outDir, `${name}-store-opening.png`) });
      best = { errors, shownAfter, kind };
    }
    await closeWithin(context);
    if (
      best.shownAfter < 15_000 &&
      readings.some((r) => r.stillOpeningAt !== null && r.stillOpeningAt < OPEN_TIMEOUT_MS)
    )
      break;
  }
  const { errors, shownAfter, kind } = best;
  // What the product guarantees (fs/browser-backend.ts): until OPEN_TIMEOUT_MS (20 s) after opening
  // began, the panel says the store is still opening; after that the store has given up and says
  // that nothing is being kept. On a loaded machine the panel can be read only after the 20 s (a
  // WebKit run on the shared PC: shown 7.8 s after load, read after the store had given up), and
  // then the given-up message is the right one. Every reading must match its time; the detail lists
  // them, and says so when no reading came before the limit.
  const fits = (r) =>
    r.sinceOpen !== null &&
    (r.sinceOpen < OPEN_TIMEOUT_MS
      ? r.banner.includes('still opening')
      : r.banner.includes(notAnsweringText('opening the database took longer than 20 s')));
  const early = readings.filter((r) => r.sinceOpen !== null && r.sinceOpen < OPEN_TIMEOUT_MS).length;
  const described = readings
    .map((r) => `${r.sinceOpen} ms: ${r.banner.slice(0, 40)} (page saw "still opening" at ${r.stillOpeningAt} ms)`)
    .join(' | ');
  check(
    `${p} IndexedDB that never answers: the application is shown well before the 20 s time limit`,
    shownAfter < 15_000,
    `shown ${shownAfter} ms after the page loaded (attempts: ${timings.join(', ')} ms)`,
  );
  check(
    `${p} IndexedDB that never answers: the Files panel says the store is still opening (or, after 20 s, that it gave up)`,
    readings.length > 0 && readings.every(fits),
    `${early ? '' : 'no reading of the check itself before the 20 s limit (machine loaded); '}read after opening began: ${described}`,
  );
  // Always required: the "still opening" message itself was on screen before the limit, as the
  // page recorded it (not only the given-up message after it).
  check(
    `${p} IndexedDB that never answers: "still opening" was shown before the 20 s limit`,
    readings.some((r) => r.stillOpeningAt !== null && r.stillOpeningAt < OPEN_TIMEOUT_MS),
    `first seen by the page at ${readings.map((r) => r.stillOpeningAt).join(', ')} ms after opening began (attempts)`,
  );
  check(
    `${p} IndexedDB that never answers: a pending store stands at /browser`,
    kind === 'PendingBrowserStore',
    String(kind),
  );
  check(`${p} store opening: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
}

/** The dialogs, "From this computer...", drops, export and import, accessibility. */
async function uiPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  // FS1's dialogs as a browser without the File System Access API has them (WebKit, Firefox): in
  // Chromium FS2 (features/files-fsaccess) replaces "From this computer..." with the system picker,
  // which Playwright cannot answer, and adds "Open folder..."; FS2's own check covers those.
  await context.addInitScript(withoutFileSystemAccess);
  const { page, errors } = await openApp(context);
  await page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    const enc = (text) => new TextEncoder().encode(text);
    await vfs.writeFile('/browser/demo/prog.X68', enc('\tORG\t$1000\r\n'));
    await vfs.writeFile('/browser/demo/lib.ASM', enc('lib'));
    await vfs.writeFile('/browser/demo/prog.L68', enc('listing'));
    await vfs.writeFile('/browser/demo/prog.S68', enc('S0'));
    await vfs.writeFile('/browser/demo/inc/macros.X68', enc('MACRO'));
    await vfs.writeFile(
      '/browser/demo/all.bin',
      Uint8Array.from({ length: 2048 }, (_, i) => i & 0xff),
    );
    await vfs.writeFile('/browser/Ãœbung 1/PrÃ¼fung.X68', enc('x'));
    window.__filters = await import('/src/features/files/filters.ts');
  });

  // Open dialog: the five filters, a typed name.
  await page.evaluate(() => {
    window.__result = undefined;
    void window.__easy68k.ctx.fileDialogs
      .open({
        title: 'Open File',
        filters: [...window.__filters.EDITOR_OPEN_FILTERS],
        multiple: false,
        startDir: '/browser/demo',
      })
      .then((r) => {
        window.__result = r;
      });
  });
  const dialog = page.locator('[role=dialog][aria-modal=true]');
  await dialog.waitFor();
  check(`${p} Open dialog: title "Open File"`, (await dialog.locator('h2').innerText()) === 'Open File');
  const typeOptions = await dialog
    .locator('select')
    .nth(1)
    .locator('option')
    .allInnerTexts()
    .then((list) => list.map((s) => s.replace(/\u00a0/g, ' ')));
  check(
    `${p} Open dialog: the five filters`,
    same(typeOptions, [
      'EASy68K Source  [.X68]',
      '68K Source  [.ASM] [.M68]',
      'EASy68K Listing  [.L68]',
      '68K S Record  [.S68]',
      'Any File  [*.*]',
    ]),
    JSON.stringify(typeOptions),
  );
  const listed = await listedOptions(dialog, ['inc', 'prog.X68']);
  check(
    `${p} Open dialog: the first filter shows folders and .X68 files`,
    same(listed, ['inc', 'prog.X68']),
    JSON.stringify(listed),
  );
  await dialog.locator('select').nth(1).selectOption({ index: 1 });
  const asmListed = await listedOptions(dialog, ['inc', 'lib.ASM']);
  check(`${p} Open dialog: the ASM filter`, same(asmListed, ['inc', 'lib.ASM']), JSON.stringify(asmListed));
  const note = await dialog.locator('.e68-filedialog__note').innerText();
  // In Chromium FS2 replaces the 'upload' provider with one that links the chosen files instead of
  // copying them (FS2 review): the note describes the copy only for FS1's own provider.
  const uploadCopies = await page.evaluate(async () => {
    const { isImportingUpload } = await import('/src/features/files/providers.ts');
    const provider = window.__easy68k.ctx.fileDialogs.registry?.get('upload');
    return provider ? isImportingUpload(provider) : null;
  });
  const copySentence = 'From this computer... copies files from this computer into';
  check(
    `${p} Open dialog: states where files are kept, and describes "From this computer..." only where it copies`,
    note.includes('keeps your files in its own storage') && note.includes(copySentence) === (uploadCopies === true),
    `FS1's copying provider registered: ${uploadCopies}; note: ${note}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-open-dialog.png`) });
  await scan(page, `${name} open dialog`);
  await dialog.getByLabel('File name:').fill('PROG.x68');
  // Exactly "Open": in Chromium FS2's provider adds a button "Open folder..." to the dialog.
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(
    `${p} Open dialog: a typed name opens the stored file`,
    same(await page.evaluate(() => window.__result), ['/browser/demo/prog.X68']),
  );

  // OpenRequest.initialName (TRAP #15 task 58, gate I2): the File name field starts with it.
  await page.evaluate(() => {
    window.__result = undefined;
    void window.__easy68k.ctx.fileDialogs
      .open({
        title: 'Open File',
        filters: [...window.__filters.EDITOR_OPEN_FILTERS],
        multiple: false,
        initialName: 'data.txt',
      })
      .then((r) => {
        window.__result = r;
      });
  });
  await dialog.waitFor();
  const startName = await dialog.getByLabel('File name:').inputValue();
  check(
    `${p} Open dialog: the File name field starts with the request's initialName`,
    startName === 'data.txt',
    startName,
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => window.__result !== undefined);

  // "From this computer...": imports into /browser/Imported.
  await page.evaluate(() => {
    window.__result = undefined;
    void window.__easy68k.ctx.fileDialogs
      .open({ title: 'Open File', filters: [...window.__filters.EDITOR_OPEN_FILTERS], multiple: false })
      .then((r) => {
        window.__result = r;
      });
  });
  await dialog.waitFor();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'From this computer...' }).click(),
  ]);
  await chooser.setFiles({ name: 'upload.X68', mimeType: 'text/plain', buffer: Buffer.from('\tEND\tSTART\r\n') });
  await page.waitForFunction(() => window.__result !== undefined);
  const uploaded = await page.evaluate(async () => [
    window.__result,
    new TextDecoder().decode(await window.__easy68k.ctx.vfs.readFile('/browser/Imported/upload.X68')),
  ]);
  check(
    `${p} From this computer...: copied into /browser/Imported and opened`,
    same(uploaded, [['/browser/Imported/upload.X68'], '\tEND\tSTART\r\n']),
    JSON.stringify(uploaded),
  );

  // Save dialog: two filters, default extension, overwrite question.
  const saveRequest = () =>
    page.evaluate(() => {
      window.__result = undefined;
      void window.__easy68k.ctx.fileDialogs
        .save({
          title: 'Save As',
          filters: [...window.__filters.EDITOR_SAVE_FILTERS],
          defaultExt: '*.X68',
          suggested: '/browser/demo/untitled1.x68',
        })
        .then((r) => {
          window.__result = r;
        });
    });
  await saveRequest();
  await dialog.waitFor();
  const saveTypes = await dialog
    .locator('select')
    .nth(1)
    .locator('option')
    .allInnerTexts()
    .then((list) => list.map((s) => s.replace(/\u00a0/g, ' ')));
  check(
    `${p} Save dialog: the two filters`,
    same(saveTypes, ['68K Source File  [.X68]', 'Any File  [*.*]']),
    JSON.stringify(saveTypes),
  );
  check(
    `${p} Save dialog: starts with the suggested name`,
    (await dialog.getByLabel('File name:').inputValue()) === 'untitled1.x68',
  );
  await dialog.getByLabel('File name:').fill('newprog');
  await page.screenshot({ path: join(outDir, `${name}-save-dialog.png`) });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(
    `${p} Save dialog: the default extension .X68 is appended`,
    (await page.evaluate(() => window.__result)) === '/browser/demo/newprog.X68',
  );

  await saveRequest();
  await dialog.waitFor();
  await dialog.getByLabel('File name:').fill('prog');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const box = page.locator('[role=alertdialog]');
  await box.waitFor();
  const boxText = await box.innerText();
  check(
    `${p} Save dialog: "Caution!" asks "File exists! OK to overwrite?"`,
    boxText.includes('Caution!') && boxText.includes('File exists! OK to overwrite?'),
    boxText.replace(/\s+/g, ' '),
  );
  await page.screenshot({ path: join(outDir, `${name}-overwrite.png`) });
  await scan(page, `${name} overwrite question`);
  await box.getByRole('button', { name: 'No', exact: true }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(`${p} Save dialog: No abandons the save`, (await page.evaluate(() => window.__result)) === null);
  check(
    `${p} Save dialog: the dialog is not shown again`,
    await page
      .locator('[role=dialog][aria-modal=true]')
      .first()
      .waitFor({ state: 'detached', timeout: 5000 })
      .then(
        () => true,
        () => false,
      ),
  );

  // The folder chooser without a native dialog (FileDialogs.chooseFolder; errata FS1 entry 16):
  // only folders are listed, a typed existing folder is taken, OK with no name takes the folder shown.
  const chooseFolder = () =>
    page.evaluate(() => {
      window.__result = undefined;
      void window.__easy68k.ctx.fileDialogs
        .chooseFolder({ title: 'Copy the Examples to', startDir: '/browser/demo' })
        .then((r) => {
          window.__result = r;
        });
    });
  await chooseFolder();
  await dialog.waitFor();
  const folderListed = await listedOptions(dialog, ['inc']);
  check(`${p} folder chooser: lists only the folders`, same(folderListed, ['inc']), JSON.stringify(folderListed));
  await page.screenshot({ path: join(outDir, `${name}-folder-chooser.png`) });
  await dialog.getByLabel('Folder name:').fill('INC');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(
    `${p} folder chooser: a typed existing folder is taken, not entered`,
    (await page.evaluate(() => window.__result)) === '/browser/demo/inc',
    String(await page.evaluate(() => window.__result)),
  );
  await chooseFolder();
  await dialog.waitFor();
  await listedOptions(dialog, ['inc']);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(
    `${p} folder chooser: OK with no name takes the folder shown`,
    (await page.evaluate(() => window.__result)) === '/browser/demo',
    String(await page.evaluate(() => window.__result)),
  );

  // A drop in Editor mode: the files open in the order of the drop.
  await page.evaluate(() => {
    window.__opened = [];
    window.__easy68k.ctx.documents.open = async (path) => {
      window.__opened.push(path);
      return null;
    };
    const dt = new DataTransfer();
    dt.items.add(new File(['second'], 'zeta.X68', { type: 'text/plain' }));
    dt.items.add(new File(['first'], 'alpha.X68', { type: 'text/plain' }));
    const target = document.querySelector('[data-e68-panel="editor"]') ?? document.body;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForFunction(() => window.__opened.length === 2, null, { timeout: 5000 }).catch(() => {});
  const opened = await page.evaluate(() => window.__opened);
  check(
    `${p} drop: the files open in the order of the drop`,
    same(opened, ['/browser/Imported/zeta.X68', '/browser/Imported/alpha.X68']),
    JSON.stringify(opened),
  );

  // A dropped .S68 in Simulator mode (W1-load-confirm item 2): the controller's confirmLoad('drop')
  // comes before the copy; on Cancel nothing is copied; on OK the copy is opened with
  // { confirmed: true }. The controller's open is recorded instead of loading (no engine needed).
  const simDrop = await page.evaluate(async () => {
    const ctx = window.__easy68k.ctx;
    const controller = ctx.sim.controller;
    const log = [];
    const realConfirm = controller.confirmLoad;
    const realOpen = controller.open;
    const hasConfirm = typeof realConfirm === 'function';
    let answer = false;
    controller.confirmLoad = async (origin) => {
      log.push(`confirm ${origin} copied=${(await ctx.vfs.stat('/browser/Imported/dropped.S68')) !== null}`);
      return answer;
    };
    controller.open = async (path, origin, options) =>
      void log.push(`open ${path} ${origin} ${JSON.stringify(options)}`);
    const previousMode = ctx.store.getState().mode;
    ctx.store.setState((s) => ({ ...s, mode: 'simulator' }));
    const drop = () => {
      const dt = new DataTransfer();
      dt.items.add(new File(['S00600004844521B'], 'dropped.S68', { type: 'application/octet-stream' }));
      document.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    };
    const until = async (test) => {
      for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 50));
    };
    drop();
    await until(() => log.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    const afterCancel = (await ctx.vfs.stat('/browser/Imported/dropped.S68')) !== null;
    answer = true;
    drop();
    await until(() => log.some((l) => l.startsWith('open')));
    controller.confirmLoad = realConfirm;
    controller.open = realOpen;
    ctx.store.setState((s) => ({ ...s, mode: previousMode }));
    return { hasConfirm, log, afterCancel };
  });
  check(
    `${p} drop in Simulator mode: Caution (confirmLoad) before the copy; Cancel copies nothing; OK opens the copy confirmed`,
    simDrop.hasConfirm &&
      !simDrop.afterCancel &&
      same(simDrop.log, [
        'confirm drop copied=false',
        'confirm drop copied=false',
        'open /browser/Imported/dropped.S68 drop {"confirmed":true}',
      ]),
    JSON.stringify(simDrop),
  );

  // The Files panel: select demo, Export... downloads demo.zip.
  await page.evaluate(async () => {
    const { revealInFilesPanel } = await import('/src/features/files/FilesPanel.tsx');
    revealInFilesPanel(window.__easy68k.ctx, '/browser/demo');
  });
  await page.locator('[data-e68-panel="files"] [role=treeitem][aria-selected=true]', { hasText: 'demo' }).waitFor();

  // Q1-1 (2.10): Cancel in New Folder... and in Rename (F2) leaves the focus where it was before the
  // dialog opened: on the button, and on the tree. Only a folder that was made moves it to the tree.
  const focusAfterCancel = async (open) => {
    await open();
    const nameDialog = page.getByRole('dialog');
    await nameDialog.waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await nameDialog.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(300); // the panel's own follow-up, if any, runs after the dialog closed
    return page.evaluate(() => {
      const a = document.activeElement;
      return a
        ? `${a.tagName.toLowerCase()}[${a.getAttribute('role') ?? ''}] ${a.getAttribute('aria-label') ?? ''}`
        : 'none';
    });
  };
  const newFolderButton = page.locator('[data-e68-panel="files"] button[aria-label="New Folder..."]');
  const afterNewFolder = await focusAfterCancel(async () => {
    await newFolderButton.focus();
    await page.keyboard.press('Enter');
  });
  check(
    `${p} New Folder...: Cancel leaves the focus on the button (Q1-1)`,
    afterNewFolder === 'button[] New Folder...',
    afterNewFolder,
  );
  const afterRename = await focusAfterCancel(async () => {
    await page.locator('[data-e68-panel="files"] [role=tree]').focus();
    await page.keyboard.press('F2');
  });
  check(`${p} Rename (F2): Cancel leaves the focus on the tree`, afterRename.startsWith('div[tree]'), afterRename);
  const afterMade = await (async () => {
    await newFolderButton.focus();
    await page.keyboard.press('Enter');
    const nameDialog = page.getByRole('dialog');
    await nameDialog.waitFor({ timeout: 5000 });
    await nameDialog.getByRole('textbox').fill('made by check');
    await page.keyboard.press('Enter');
    await nameDialog.waitFor({ state: 'hidden', timeout: 5000 });
    await page
      .locator('[data-e68-panel="files"] [role=treeitem][aria-selected=true]', { hasText: 'made by check' })
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? 'none');
    const made = await page.evaluate(
      async () => (await window.__easy68k.ctx.vfs.stat('/browser/demo/made by check'))?.kind,
    );
    await page.evaluate(() => window.__easy68k.ctx.vfs.remove('/browser/demo/made by check'));
    return { focus, made };
  })();
  check(
    `${p} New Folder...: OK makes the folder and moves the focus to the tree`,
    afterMade.made === 'dir' && afterMade.focus === 'tree',
    JSON.stringify(afterMade),
  );
  await page.evaluate(async () => {
    const { revealInFilesPanel } = await import('/src/features/files/FilesPanel.tsx');
    revealInFilesPanel(window.__easy68k.ctx, '/browser/demo');
  });
  await page.locator('[data-e68-panel="files"] [role=treeitem][aria-selected=true]', { hasText: 'demo' }).waitFor();
  await page.screenshot({ path: join(outDir, `${name}-files-panel-light.png`) });
  await scan(page, `${name} light editor with Files panel`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-e68-panel="files"] button[aria-label="Export..."]').click(),
  ]);
  const zipPath = join(outDir, `${name}-demo.zip`);
  await download.saveAs(zipPath);
  check(
    `${p} Export...: a folder downloads as demo.zip`,
    download.suggestedFilename() === 'demo.zip',
    download.suggestedFilename(),
  );
  const { readZip } = await import(new URL('../../fs/zip.ts', import.meta.url).href);
  const parsed = await readZip(new Uint8Array(readFileSync(zipPath)));
  const zipNames = parsed.entries.map((e) => e.path);
  check(
    `${p} Export...: the .zip parses back with the folder's files`,
    same(
      zipNames,
      [
        'demo/',
        'demo/inc/',
        'demo/inc/macros.X68',
        'demo/all.bin',
        'demo/lib.ASM',
        'demo/newprog.X68',
        'demo/prog.L68',
        'demo/prog.S68',
        'demo/prog.X68',
      ].filter((n) => n !== 'demo/newprog.X68' || zipNames.includes(n)),
    ) && Array.from(parsed.entries.find((e) => e.path === 'demo/all.bin').data).every((b, i) => b === (i & 0xff)),
    JSON.stringify(zipNames),
  );
  const tool = archiveToolCheck(zipPath);
  check(`${p} Export...: the system's archive tool reads the .zip (${tool.tool})`, tool.ok, tool.detail);

  // Whole store: export, then import into an empty store (a fresh context) with every byte equal.
  await page.evaluate(async () => {
    const { revealInFilesPanel } = await import('/src/features/files/FilesPanel.tsx');
    revealInFilesPanel(window.__easy68k.ctx, '/browser');
  });
  await page
    .locator('[data-e68-panel="files"] [role=treeitem][aria-selected=true]', { hasText: 'My Programs' })
    .waitFor();
  // The name the page gives the download (the link's download attribute), recorded as it is clicked.
  await page.evaluate(() => {
    window.__downloadNames = [];
    const anchor = window.HTMLAnchorElement.prototype;
    const click = anchor.click;
    anchor.click = function () {
      if (this.download) window.__downloadNames.push(this.download);
      return click.call(this);
    };
  });
  const [storeDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-e68-panel="files"] button[aria-label="Export..."]').click(),
  ]);
  const storeZip = join(outDir, `${name}-store.zip`);
  await storeDownload.saveAs(storeZip);
  const requestedNames = await page.evaluate(() => window.__downloadNames);
  // Playwright's WebKit build for Linux reports the spaces of the name as underscores (CI run
  // 44913261966: "My_Programs.zip"); Chromium on Linux and WebKit on macOS and Windows report
  // "My Programs.zip". Playwright passes WebKit's Playwright.downloadFilenameSuggested through
  // unchanged, and the page's own download attribute is recorded above, so the check holds the
  // application to the name it asks for and accepts only that one rewrite, only there (errata
  // FS1.md, entry 18). The detail names the browser build so a CI log alone settles who renamed it.
  const suggested = storeDownload.suggestedFilename();
  check(
    `${p} Export... of the store root downloads "My Programs.zip"`,
    same(requestedNames, ['My Programs.zip']) &&
      (suggested === 'My Programs.zip' ||
        (name === 'webkit' && process.platform === 'linux' && suggested === 'My_Programs.zip')),
    `page asked for ${JSON.stringify(requestedNames)}, the browser suggests ${JSON.stringify(suggested)}` +
      ` (${name} ${browser.version()} on ${process.platform})`,
  );
  const before = await storeContents(page);

  // app.files.toggle with FilesRevealArg (Help > Examples... uses it): hide the panel, then ask for
  // a path; the panel comes back with that path selected, and asking again never hides it.
  const filesPanel = page.locator('[data-e68-panel="files"]');
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.files.toggle'));
  await filesPanel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  const hiddenFirst = !(await filesPanel.isVisible());
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.__easy68k.ctx.commands.run('app.files.toggle', { reveal: '/browser/demo/inc' }));
  }
  const revealed = await page
    .locator('[data-e68-panel="files"] [role=treeitem][aria-selected=true]', { hasText: 'inc' })
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(
    `${p} app.files.toggle { reveal } shows the hidden panel and selects the path`,
    hiddenFirst && revealed && (await filesPanel.isVisible()),
    `hidden first: ${hiddenFirst}, selected: ${JSON.stringify(
      await page.locator('[data-e68-panel="files"] [role=treeitem][aria-selected=true]').allTextContents(),
    )}`,
  );

  // Dark theme screenshot and scan of the panel.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await page.screenshot({ path: join(outDir, `${name}-files-panel-dark.png`) });
  await scan(page, `${name} dark editor with Files panel`);
  check(`${p} ui pass: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);

  const fresh = await newContext(browser);
  const second = await openApp(fresh);
  const empty = await storeContents(second.page);
  check(
    `${p} a new context starts with an empty store`,
    Object.keys(empty).length === 0,
    JSON.stringify(empty).slice(0, 80),
  );
  await second.page.locator('[data-e68-panel="files"] [role=treeitem]', { hasText: 'My Programs' }).click();
  await second.page.locator('[data-e68-panel="files"] button[aria-label="Import..."]').click();
  const [storeChooser] = await Promise.all([
    second.page.waitForEvent('filechooser'),
    second.page.getByRole('menuitem', { name: /Files or \.zip/ }).click(),
  ]);
  await storeChooser.setFiles(storeZip);
  await second.page
    .locator('.e68-toast', { hasText: 'Imported' })
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  const after = await storeContents(second.page);
  const equal = same(after, before);
  check(
    `${p} a whole-store export imports into an empty store with every byte equal`,
    equal,
    equal
      ? `${Object.keys(after).length} entries`
      : `${Object.keys(after).length} vs ${Object.keys(before).length} entries`,
  );
  await second.page.screenshot({ path: join(outDir, `${name}-imported-store.png`) });

  // Import > Folder... through the browser's chooser. A real browser asks "Upload N files to this
  // site?" after the chooser has closed, so the window has the focus back seconds before the files
  // arrive; the import once gave up after one second and dropped them without a word.
  const folderDir = join(outDir, `${name}-folder-to-import`);
  rmSync(folderDir, { recursive: true, force: true });
  mkdirSync(join(folderDir, 'sub'), { recursive: true });
  writeFileSync(join(folderDir, 'one.X68'), '\tORG\t$1000\r\nSTART:\tSIMHALT\r\n\tEND\tSTART\r\n');
  writeFileSync(join(folderDir, 'sub', 'two.X68'), '* two\r\n');
  const folderName = `${name}-folder-to-import`;
  await second.page.locator('[data-e68-panel="files"] [role=treeitem]', { hasText: 'My Programs' }).click();
  await second.page.locator('[data-e68-panel="files"] button[aria-label="Import..."]').click();
  const [folderChooser] = await Promise.all([
    second.page.waitForEvent('filechooser'),
    second.page.getByRole('menuitem', { name: /Folder/ }).click(),
  ]);
  await second.page.evaluate(() => window.dispatchEvent(new window.Event('focus')));
  await second.page.waitForTimeout(2500);
  let folderError = '';
  await folderChooser.setFiles(folderDir).catch((error) => {
    folderError = String(error).slice(0, 160);
  });
  const wantOne = `/browser/${folderName}/one.X68`;
  const wantTwo = `/browser/${folderName}/sub/two.X68`;
  let withFolder = {};
  for (let i = 0; i < 40; i++) {
    withFolder = await storeContents(second.page);
    if (wantOne in withFolder && wantTwo in withFolder) break;
    await second.page.waitForTimeout(250);
  }
  check(
    `${p} Import > Folder... keeps the folder's files when they arrive seconds after the chooser closed`,
    wantOne in withFolder && wantTwo in withFolder,
    folderError ||
      Object.keys(withFolder)
        .filter((key) => key.includes(folderName))
        .join(', ') ||
      'nothing of the folder was imported',
  );

  // Import > Files or .zip... the same way: the window has the focus back seconds before the browser
  // hands the files over (a file fetched from iCloud Drive or a network share first). The import
  // gave up one second after the focus came back and dropped them (errata FS1.md entry 27).
  await second.page.locator('[data-e68-panel="files"] [role=treeitem]', { hasText: 'My Programs' }).click();
  await second.page.locator('[data-e68-panel="files"] button[aria-label="Import..."]').click();
  const [lateChooser] = await Promise.all([
    second.page.waitForEvent('filechooser'),
    second.page.getByRole('menuitem', { name: /Files or \.zip/ }).click(),
  ]);
  await second.page.evaluate(() => window.dispatchEvent(new window.Event('focus')));
  await second.page.waitForTimeout(2500);
  await lateChooser.setFiles({ name: 'late.X68', mimeType: 'text/plain', buffer: Buffer.from('* late\r\n') });
  let lateImported = false;
  for (let i = 0; i < 40 && !lateImported; i++) {
    lateImported = '/browser/late.X68' in (await storeContents(second.page));
    if (!lateImported) await second.page.waitForTimeout(250);
  }
  check(`${p} Import > Files... keeps a file that arrives seconds after the chooser closed`, lateImported);

  // A chooser the person cancels ends the choice ('cancel'): a headless browser cancels a chooser that
  // nothing intercepts. The hidden input goes, and the next Import works.
  await second.page.locator('[data-e68-panel="files"] button[aria-label="Import..."]').click();
  await second.page.getByRole('menuitem', { name: /Files or \.zip/ }).click();
  let inputs = -1;
  for (let i = 0; i < 40; i++) {
    inputs = await second.page.locator('input[type=file]').count();
    if (inputs === 0) break;
    await second.page.waitForTimeout(250);
  }
  check(
    `${p} a cancelled file chooser ends the choice (its input is removed)`,
    inputs === 0,
    `${inputs} file inputs left`,
  );
  check(`${p} import pass: no console errors`, second.errors.length === 0, second.errors.slice(0, 3).join(' | '));
  await fresh.close();
}

// ---- the Safari storage notice (R-10) ---------------------------------------------------------------

const NOTICE = '[data-e68-panel="files"] [role=note]';
/** Shows the notice under automation as for a person (storage-notice.ts STORAGE_NOTICE_PARAM). */
const NOTICE_QUERY = '?storage-notice=1';

/** The page runs as the installed app: `(display-mode: standalone)` matches (Playwright cannot install). */
function pretendInstalled() {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    if (!/display-mode:\s*standalone/.test(query)) return original(query);
    return {
      matches: true,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    };
  };
}

/** Where the parts of the Files panel are, in CSS pixels (rounded), and the notice's own box. */
function filesGeometry(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    return {
      panel: box('[data-e68-panel="files"] .e68-files'),
      strip: box('[data-e68-panel="files"] .e68-files__strip'),
      tree: box('[data-e68-panel="files"] [role=tree]'),
      notice: box('[data-e68-panel="files"] [role=note]'),
    };
  });
}

/** What the notice shows and says, and what the product's constants are (read in the page). */
function noticeFacts(page) {
  return page.evaluate(async () => {
    const texts = await import('/src/features/files/storage-notice.ts');
    const note = document.querySelector('[data-e68-panel="files"] [role=note]');
    const tree = document.querySelector('[data-e68-panel="files"] [role=tree]');
    return {
      constants: {
        tab: texts.STORAGE_NOTICE_TAB_TEXT,
        installed: texts.STORAGE_NOTICE_INSTALLED_TEXT,
        label: texts.STORAGE_NOTICE_LABEL,
      },
      shown: note !== null,
      kind: note?.getAttribute('data-e68-storage-notice') ?? null,
      label: note?.getAttribute('aria-label') ?? null,
      text: note?.querySelector('p')?.textContent ?? null,
      buttons: note ? [...note.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
      above: note && tree ? note.getBoundingClientRect().bottom <= tree.getBoundingClientRect().top + 0.5 : false,
      focusInside: note ? note.contains(document.activeElement) : false,
      seen: window.__easy68k.ctx.settings.get().app.storageNoticeSeen ?? null,
    };
  });
}

/** A description of the focused element, for the Tab order. */
function focusedName(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return 'none';
    if (element.getAttribute('role') === 'tree') return 'tree';
    const inNote = element.closest('[role=note]') !== null;
    const name = element.getAttribute('aria-label') ?? element.textContent.trim();
    return `${inNote ? 'notice ' : ''}${element.tagName.toLowerCase()} ${name}`.slice(0, 60);
  });
}

/**
 * R-10: the notice above the tree, in WebKit only, under automation only with storage-notice=1; its
 * Export... downloads the whole store, Got it hides it for this browser (also after a reload); the
 * installed app with an empty store shows the other variant with Import...; both themes; reachable
 * with Tab and named; the panel's layout without the notice is the one it always had.
 */
async function storageNoticePass(browser, name) {
  const p = `${name}: storage notice:`;
  const safariEngine = name === 'webkit';

  // Without the parameter, automation hides the notice: every other check sees the panel it saw.
  progress('without the parameter');
  const plainContext = await newContext(browser);
  const plain = await openApp(plainContext);
  await plain.page.waitForTimeout(500);
  const plainGeometry = await filesGeometry(plain.page);
  check(
    `${p} without storage-notice=1 an automated browser sees no notice`,
    plainGeometry.notice === null && (await plain.page.locator(NOTICE).count()) === 0,
    JSON.stringify(plainGeometry.notice),
  );
  check(`${p} plain page: no console errors`, plain.errors.length === 0, plain.errors.slice(0, 3).join(' | '));
  await closeWithin(plainContext);

  progress('first start with the parameter');
  const context = await newContext(browser);
  const opened = await openApp(context, { query: NOTICE_QUERY });
  const { page } = opened;
  if (!safariEngine) {
    await page.waitForTimeout(1000);
    const geometry = await filesGeometry(page);
    check(
      `${p} with storage-notice=1 Chromium shows no notice (only Safari's engine has the rule)`,
      geometry.notice === null,
      JSON.stringify(geometry.notice),
    );
    check(
      `${p} the Files panel's layout is unchanged when the notice is absent`,
      same(geometry, plainGeometry),
      `${JSON.stringify(geometry)} vs ${JSON.stringify(plainGeometry)}`,
    );
    check(`${p} no console errors`, opened.errors.length === 0, opened.errors.slice(0, 3).join(' | '));
    await closeWithin(context);
    return;
  }

  await page.locator(NOTICE).waitFor({ timeout: 15_000 });
  const first = await noticeFacts(page);
  check(
    `${p} shown at the first start, above the tree, with the tab text and Export... and Got it`,
    first.kind === 'tab' &&
      first.text === first.constants.tab &&
      same(first.buttons, ['Export...', 'Got it']) &&
      first.above,
    JSON.stringify({ kind: first.kind, buttons: first.buttons, above: first.above, text: first.text }),
  );
  check(
    `${p} named for a screen reader (role note, "${first.constants.label}") and takes no focus`,
    first.label === first.constants.label && !first.focusInside,
    `label ${JSON.stringify(first.label)}, focus inside: ${first.focusInside}, focused: ${await focusedName(page)}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-storage-notice-light.png`) });
  await page
    .locator('[data-e68-panel="files"]')
    .screenshot({ path: join(outDir, `${name}-storage-notice-panel-light.png`) });
  await scan(page, `${name} light Files panel with the storage notice`);

  // Keyboard: from the strip, Tab reaches Export... and Got it, then the tree; Shift+Tab goes back.
  progress('keyboard');
  await page.locator('[data-e68-panel="files"] .e68-files__strip button').first().focus();
  const order = [await focusedName(page)];
  for (let i = 0; i < 8 && order[order.length - 1] !== 'tree'; i++) {
    await page.keyboard.press('Tab');
    order.push(await focusedName(page));
  }
  const exportAt = order.indexOf('notice button Export...');
  const gotItAt = order.indexOf('notice button Got it');
  const treeAt = order.indexOf('tree');
  check(
    `${p} Tab from the strip reaches Export..., then Got it, then the tree`,
    exportAt > 0 && gotItAt === exportAt + 1 && treeAt === gotItAt + 1,
    order.join(' > '),
  );
  await page.keyboard.press('Shift+Tab');
  const back = await focusedName(page);
  check(`${p} Shift+Tab from the tree goes back to Got it`, back === 'notice button Got it', back);

  // Export...: the whole store as "My Programs.zip", with every file's bytes.
  progress('export');
  const files = {
    'top.X68': [42, 32, 116, 111, 112, 13, 10],
    'kept/prog.X68': Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff),
  };
  await page.evaluate(async (entries) => {
    const { vfs } = window.__easy68k.ctx;
    for (const [rel, bytes] of Object.entries(entries)) {
      if (rel.includes('/')) await vfs.mkdirp(`/browser/${rel.slice(0, rel.lastIndexOf('/'))}`);
      await vfs.writeFile(`/browser/${rel}`, new Uint8Array(bytes));
    }
  }, files);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(NOTICE).getByRole('button', { name: 'Export...' }).click(),
  ]);
  const zipPath = join(outDir, `${name}-notice-store.zip`);
  await download.saveAs(zipPath);
  const suggested = download.suggestedFilename();
  const { readZip } = await import(new URL('../../fs/zip.ts', import.meta.url).href);
  const parsed = await readZip(new Uint8Array(readFileSync(zipPath)));
  const zipped = Object.fromEntries(
    parsed.entries.filter((entry) => !entry.path.endsWith('/')).map((entry) => [entry.path, Array.from(entry.data)]),
  );
  check(
    `${p} Export... downloads the whole store as a .zip with every file's bytes`,
    (suggested === 'My Programs.zip' || (process.platform === 'linux' && suggested === 'My_Programs.zip')) &&
      same(Object.keys(zipped).sort(), Object.keys(files).sort()) &&
      Object.entries(files).every(([rel, bytes]) => same(zipped[rel], bytes)),
    `${suggested}: ${JSON.stringify(Object.keys(zipped))}`,
  );
  check(`${p} the notice stays after Export... (only Got it hides it)`, (await page.locator(NOTICE).count()) === 1);

  // Dark theme.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await page
    .locator('[data-e68-panel="files"]')
    .screenshot({ path: join(outDir, `${name}-storage-notice-panel-dark.png`) });
  await scan(page, `${name} dark Files panel with the storage notice`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'light'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');

  // Got it: hidden, remembered, the panel's layout as without the notice, and after a reload too.
  progress('got it');
  await page.locator(NOTICE).getByRole('button', { name: 'Got it' }).focus();
  await page.keyboard.press('Enter');
  await page.locator(NOTICE).waitFor({ state: 'detached', timeout: 10_000 });
  const after = await filesGeometry(page);
  const seen = await page.evaluate(() => window.__easy68k.ctx.settings.get().app.storageNoticeSeen);
  const focusAfter = await focusedName(page);
  check(
    `${p} Got it hides the notice, remembers it and leaves the keyboard in the tree`,
    after.notice === null && seen === true && focusAfter === 'tree',
    `seen ${seen}, focus ${focusAfter}`,
  );
  check(
    `${p} without the notice the panel has the layout of a page that never showed it`,
    same(after, plainGeometry),
    `${JSON.stringify(after)} vs ${JSON.stringify(plainGeometry)}`,
  );
  await page.reload();
  await page.waitForSelector('[data-e68-panel="files"] [role=tree]');
  await page.waitForFunction(() => window.__easy68k !== undefined);
  await page.waitForTimeout(1000);
  check(`${p} not shown again after a reload once acknowledged`, (await page.locator(NOTICE).count()) === 0);
  const second = await openApp(context, { query: NOTICE_QUERY });
  await second.page.waitForTimeout(1000);
  check(`${p} nor in another window of the same browser`, (await second.page.locator(NOTICE).count()) === 0);
  check(
    `${p} no console errors`,
    opened.errors.length === 0 && second.errors.length === 0,
    [...opened.errors, ...second.errors].slice(0, 3).join(' | '),
  );
  await closeWithin(context);

  // The installed app with an empty store: the other variant; Import... brings the .zip over.
  progress('installed app');
  const installedContext = await newContext(browser);
  await installedContext.addInitScript(pretendInstalled);
  const installed = await openApp(installedContext, { query: NOTICE_QUERY });
  await installed.page.locator(NOTICE).waitFor({ timeout: 15_000 });
  const inApp = await noticeFacts(installed.page);
  check(
    `${p} installed app, empty store: one sentence with Import... and Got it`,
    inApp.kind === 'installed' &&
      inApp.text === inApp.constants.installed &&
      same(inApp.buttons, ['Import...', 'Got it']) &&
      inApp.above &&
      !inApp.focusInside,
    JSON.stringify({ kind: inApp.kind, buttons: inApp.buttons, text: inApp.text }),
  );
  await installed.page
    .locator('[data-e68-panel="files"]')
    .screenshot({ path: join(outDir, `${name}-storage-notice-installed-light.png`) });
  await scan(installed.page, `${name} light Files panel with the installed app's notice`);
  await installed.page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await installed.page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await installed.page
    .locator('[data-e68-panel="files"]')
    .screenshot({ path: join(outDir, `${name}-storage-notice-installed-dark.png`) });
  await scan(installed.page, `${name} dark Files panel with the installed app's notice`);
  const [chooser] = await Promise.all([
    installed.page.waitForEvent('filechooser'),
    installed.page.locator(NOTICE).getByRole('button', { name: 'Import...' }).click(),
  ]);
  await chooser.setFiles(zipPath);
  let brought = {};
  for (let i = 0; i < 40; i++) {
    brought = await storeContents(installed.page);
    if ('/browser/kept/prog.X68' in brought && '/browser/top.X68' in brought) break;
    await installed.page.waitForTimeout(250);
  }
  check(
    `${p} installed app: Import... brings the exported .zip into its own store with every byte`,
    brought['/browser/top.X68'] === files['top.X68'].join(',') &&
      brought['/browser/kept/prog.X68'] === files['kept/prog.X68'].join(','),
    JSON.stringify(Object.keys(brought)),
  );
  check(
    `${p} installed app: the notice stays after the import until Got it`,
    (await installed.page.locator(NOTICE).count()) === 1,
  );
  await installed.page.reload();
  await installed.page.waitForSelector('[data-e68-panel="files"] [role=tree]');
  await installed.page.waitForTimeout(1000);
  check(
    `${p} installed app: a store with programs shows no notice after a reload`,
    (await installed.page.locator(NOTICE).count()) === 0,
  );
  check(
    `${p} installed app: no console errors`,
    installed.errors.length === 0,
    installed.errors.slice(0, 3).join(' | '),
  );
  await closeWithin(installedContext);

  // The installed app's Got it is remembered too (the store stays empty, so only that hides it).
  progress('installed app, got it');
  const emptyContext = await newContext(browser);
  await emptyContext.addInitScript(pretendInstalled);
  const empty = await openApp(emptyContext, { query: NOTICE_QUERY });
  await empty.page.locator(NOTICE).waitFor({ timeout: 15_000 });
  await empty.page.locator(NOTICE).getByRole('button', { name: 'Got it' }).click();
  await empty.page.locator(NOTICE).waitFor({ state: 'detached', timeout: 10_000 });
  await empty.page.reload();
  await empty.page.waitForSelector('[data-e68-panel="files"] [role=tree]');
  await empty.page.waitForTimeout(1000);
  check(
    `${p} installed app: Got it is remembered with the store still empty`,
    (await empty.page.locator(NOTICE).count()) === 0 && Object.keys(await storeContents(empty.page)).length === 0,
  );
  await closeWithin(emptyContext);
}

/** Opens the application without waiting for the Files panel (it may be hidden, or absent in Simulator mode). */
async function openAppAnyMode(context, query = '') {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}${query}`);
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined);
  return { page, errors };
}

const TOAST = '.e68-toast';

/** The toasts of a page: text and buttons. */
const toastsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.e68-toast')].map((toast) => ({
      text: toast.querySelector('.e68-toast__text')?.textContent ?? toast.textContent ?? '',
      buttons: [...toast.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent.trim()),
    })),
  );

/** Writes a file into /browser through the Vfs, as Save and a program's file tasks do. */
const writeIntoStore = (page, path, bytes) =>
  page.evaluate(([target, data]) => window.__easy68k.ctx.vfs.writeFile(target, new Uint8Array(data)), [path, bytes]);

/**
 * R-10, third round (errata FS1.md entry 28): a document must not become the only copy without the
 * notice having been on the screen. When the Files panel is hidden (its visibility is remembered)
 * or absent (a first visit that starts in Simulator mode), the first write into the browser's store
 * shows the same text as a note that stays until it is answered; Got it there is the panel's Got it.
 * Nothing of this in Chromium, or once the panel has shown the notice.
 */
async function firstWriteNoticePass(browser, name) {
  const p = `${name}: storage notice at the first write:`;
  const safariEngine = name === 'webkit';
  const texts = { tab: null };

  // 1. The Files panel hidden before the first start with the parameter (its visibility is remembered).
  progress('panel hidden');
  const context = await newContext(browser);
  const before = await openApp(context);
  await before.page.evaluate(() => window.__easy68k.ctx.commands.run('app.files.toggle'));
  await before.page.waitForSelector('[data-e68-panel="files"] [role=tree]', { state: 'detached', timeout: 10_000 });
  await before.page.close();
  const hidden = await openAppAnyMode(context, NOTICE_QUERY);
  const { page } = hidden;
  texts.tab = await page.evaluate(
    async () => (await import('/src/features/files/storage-notice.ts')).STORAGE_NOTICE_TAB_TEXT,
  );
  await page.waitForTimeout(1000);
  check(
    `${p} the Files panel is hidden at the start (remembered), so the panel's notice is not on the screen`,
    (await page.locator('[data-e68-panel="files"] [role=tree]').count()) === 0 &&
      (await page.locator(NOTICE).count()) === 0,
  );
  check(`${p} nothing is shown before anything is written`, (await page.locator(TOAST).count()) === 0);
  await writeIntoStore(page, '/browser/only-copy.X68', [42, 13, 10]);
  if (!safariEngine) {
    await page.waitForTimeout(1500);
    check(
      `${p} Chromium shows no note at the first write`,
      (await page.locator(TOAST).count()) === 0,
      JSON.stringify(await toastsOf(page)),
    );
    check(`${p} no console errors`, hidden.errors.length === 0, hidden.errors.slice(0, 3).join(' | '));
    await closeWithin(context);
    return;
  }
  await page.locator(TOAST).first().waitFor({ timeout: 15_000 });
  const shown = await toastsOf(page);
  check(
    `${p} panel hidden: the first file written shows the notice's text with Got it`,
    shown.length === 1 && shown[0].text.includes(texts.tab) && shown[0].buttons.includes('Got it'),
    JSON.stringify(shown),
  );
  await page.screenshot({ path: join(outDir, `${name}-storage-notice-first-write.png`) });
  await page.waitForTimeout(9000); // longer than a toast of the kit's default duration (8 s)
  check(`${p} the note stays until it is answered`, (await page.locator(TOAST).count()) === 1);
  await writeIntoStore(page, '/browser/second.X68', [42, 13, 10]);
  await page.waitForTimeout(1000);
  check(`${p} shown once: a second write adds nothing`, (await page.locator(TOAST).count()) === 1);
  await page.locator(TOAST).getByRole('button', { name: 'Got it' }).click();
  await page.locator(TOAST).waitFor({ state: 'detached', timeout: 10_000 });
  const seen = await page.evaluate(() => window.__easy68k.ctx.settings.get().app.storageNoticeSeen);
  check(`${p} Got it in the note is the panel's Got it (remembered for this browser)`, seen === true, String(seen));
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.files.toggle'));
  await page.waitForSelector('[data-e68-panel="files"] [role=tree]');
  await page.waitForTimeout(500);
  check(`${p} and the panel, shown again, has no notice`, (await page.locator(NOTICE).count()) === 0);
  check(`${p} panel hidden: no console errors`, hidden.errors.length === 0, hidden.errors.slice(0, 3).join(' | '));
  await closeWithin(context);

  // 2. A first visit that starts in Simulator mode (?open= a program), where there is no Files panel.
  progress('simulator mode');
  const simContext = await newContext(browser);
  const prepare = await openApp(simContext);
  // An S-record of ORG $1000, SIMHALT, put into the store by a page without the parameter (no notice).
  const record = 'S1071000FFFFFFFFEC\r\nS9031000EC\r\n';
  await writeIntoStore(
    prepare.page,
    '/browser/start.S68',
    [...record].map((c) => c.charCodeAt(0)),
  );
  await prepare.page.waitForTimeout(500);
  check(
    `${p} a write without the parameter shows no note (automation)`,
    (await prepare.page.locator(TOAST).count()) === 0,
  );
  await prepare.page.close();
  const sim = await openAppAnyMode(simContext, `?open=/browser/start.S68&${NOTICE_QUERY.slice(1)}`);
  await sim.page.waitForFunction(() => window.__easy68k.ctx.store.getState().mode === 'simulator', undefined, {
    timeout: 30_000,
  });
  await sim.page.waitForTimeout(1000);
  check(
    `${p} Simulator mode at the start: no Files panel, no notice, no note yet`,
    !(await sim.page.locator('[data-e68-panel="files"] [role=tree]').first().isVisible()) &&
      (await sim.page.locator(TOAST).count()) === 0,
    JSON.stringify(await toastsOf(sim.page)),
  );
  await writeIntoStore(sim.page, '/browser/output.txt', [79, 75, 13, 10]);
  await sim.page
    .locator(TOAST)
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  const inSim = await toastsOf(sim.page);
  check(
    `${p} Simulator mode: the first file written shows the notice's text with Got it`,
    inSim.length === 1 && inSim[0].text.includes(texts.tab) && inSim[0].buttons.includes('Got it'),
    JSON.stringify(inSim),
  );
  await sim.page.screenshot({ path: join(outDir, `${name}-storage-notice-first-write-simulator.png`) });
  await scan(sim.page, `${name} Simulator mode with the storage note`);
  check(`${p} Simulator mode: no console errors`, sim.errors.length === 0, sim.errors.slice(0, 3).join(' | '));
  await closeWithin(simContext);

  // 3. The panel showed the notice: the first write needs no note of its own.
  progress('panel visible');
  const visibleContext = await newContext(browser);
  const visible = await openApp(visibleContext, { query: NOTICE_QUERY });
  await visible.page.locator(NOTICE).waitFor({ timeout: 15_000 });
  await writeIntoStore(visible.page, '/browser/a.X68', [42, 13, 10]);
  await visible.page.waitForTimeout(1500);
  check(
    `${p} with the notice on the screen in the panel, a write shows no note`,
    (await visible.page.locator(TOAST).count()) === 0,
  );
  await closeWithin(visibleContext);
}

/** Lists and tests a .zip with whatever archive tool this system has. */
function archiveToolCheck(zipPath) {
  const attempts = [
    ['python', ['-m', 'zipfile', '-t', zipPath], 'python zipfile'],
    ['python3', ['-m', 'zipfile', '-t', zipPath], 'python3 zipfile'],
    ['unzip', ['-t', zipPath], 'unzip -t'],
    ['tar', ['-tf', zipPath], 'bsdtar -tf'],
  ];
  for (const [command, commandArgs, label] of attempts) {
    try {
      const output = execFileSync(command, commandArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });
      const ok = label.startsWith('bsdtar')
        ? output.includes('demo/prog.X68')
        : !/error|bad/i.test(output) || /No errors/i.test(output);
      return { ok, tool: label, detail: output.trim().split(/\r?\n/).slice(0, 3).join(' / ') };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (
        error.status !== undefined &&
        error.status !== 0 &&
        command.startsWith('python') &&
        /No module|not found/i.test(String(error.stderr))
      )
        continue;
      return { ok: false, tool: label, detail: String(error.stderr || error.message).slice(0, 200) };
    }
  }
  return { ok: false, tool: 'none', detail: 'no archive tool found (python, unzip or bsdtar)' };
}

// ---- run ------------------------------------------------------------------------------------------

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No hot reload: other packages' files change while this runs, and a reload would reset the pages.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        const passes = [
          ['backend', backendPass],
          ['store', storePass],
          ['blocked storage', blockedPass],
          ['storage that does not answer', hangingPass],
          ['full storage', name === 'chromium' ? quotaPass : injectedQuotaPass],
          ['a page killed in the middle of a write', killPass],
          ['a store held by a transaction that never ends', heldStorePass],
          ['dialogs, panel, drop, export, import', uiPass],
          ['the Safari storage notice', storageNoticePass],
          ['the storage notice at the first write', firstWriteNoticePass],
        ];
        for (const [label, pass] of passes) {
          if (onlyPass && !label.includes(onlyPass)) continue;
          console.log(`\n[${name}, ${label}]`);
          const limit = pass === killPass ? KILL_PASS_LIMIT_MS : PASS_LIMIT_MS;
          await timedPass(`${name}, ${label}`, () => pass(browser, name), limit);
        }
      } catch (error) {
        check(`${name}: the pass ran to the end`, false, String(error?.stack ?? error).slice(0, 400));
      } finally {
        await doneWith(browser, { last: name === browsers.at(-1) });
      }
    }
  } finally {
    closeAtEnd(server);
  }
  for (const file of ['chromium-demo.zip', 'webkit-demo.zip']) rmSync(join(outDir, `${file}.tmp`), { force: true });
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
