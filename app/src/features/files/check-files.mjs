// Browser check of work package FS1: the browser store, the file dialogs, the Files panel, drops,
// export and import (ARCHITECTURE.md 9.2, FS1 acceptance). Owner: FS1.
//
//   node app/src/features/files/check-files.mjs [--browser chromium|webkit|all] [--out <dir>]
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
//     once) leaves every file as it was or as written, never half written;
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
//   - no console errors.
//
// Screenshots go to build/FS1/files-check (git-ignored). Exit code 0 = everything passed.
// The page object `window.__easy68k` exists in development builds only (main.tsx).

/* global console, process, window, document, indexedDB, IDBFactory, IDBObjectStore, setTimeout, DataTransfer, DragEvent, File, performance, Navigator, DOMException, URL, TextEncoder, TextDecoder, Buffer */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'FS1', 'files-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];
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
    return {};
  };
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

async function openApp(context, { expectErrors = false } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl);
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
  await context.close();
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
  await context.close();
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
  await context.close();
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
  await context.close();
}

/**
 * A page that dies in the middle of a write (Chromium: the renderer crashed through the DevTools
 * protocol; WebKit: the page closed at once). Afterwards a new page of the same store finds every
 * file either as it was or as written, never half written, and the index agrees with the bytes.
 */
async function killPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const results = [];
  for (const delay of [0, 2, 10, 30, 80]) {
    const victim = await openApp(context);
    const path = `/browser/kill/f${delay}.bin`;
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
    const survivor = await openApp(context);
    const found = await survivor.page.evaluate(async (target) => {
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
    results.push(found);
    await survivor.page.close();
    if (!victim.page.isClosed()) await victim.page.close().catch(() => {});
  }
  const flat = results.flatMap((r) => Object.values(r));
  check(
    `${p} a page killed in the middle of a write: every file is as it was or as written, and the index agrees`,
    flat.every((v) => v === 'missing' || (v.startsWith('whole') && !v.includes('MISMATCH'))) &&
      results.every((r) => !Object.entries(r).some(([k, v]) => !k.endsWith('.log') && v === 'missing')),
    flat.join('; '),
  );
  await context.close();
}

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
    `${p} blocked storage: the Files panel says files are not being saved`,
    banner.includes('Files are NOT being saved'),
    banner.slice(0, 80),
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
  await context.close();
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
    const banner = await page
      .locator('[data-e68-panel="files"] [role=alert]')
      .innerText()
      .catch(() => '');
    const kind = await page.evaluate(
      () => window.__easy68k.ctx.vfs.backends().find((b) => b.mount === 'browser')?.constructor.name,
    );
    if (best === null || shownAfter < best.shownAfter) {
      await page.screenshot({ path: join(outDir, `${name}-store-opening.png`) });
      best = { errors, shownAfter, banner, kind };
    }
    await context.close();
    if (best.shownAfter < 15_000) break;
  }
  const { errors, shownAfter, banner, kind } = best;
  check(
    `${p} IndexedDB that never answers: the application is shown well before the 20 s time limit`,
    shownAfter < 15_000,
    `shown ${shownAfter} ms after the page loaded (attempts: ${timings.join(', ')} ms)`,
  );
  check(
    `${p} IndexedDB that never answers: the Files panel says the store is still opening`,
    banner.includes('still opening'),
    banner.slice(0, 80),
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
    await vfs.writeFile('/browser/Übung 1/Prüfung.X68', enc('x'));
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
  check(
    `${p} Open dialog: states where files are kept`,
    note.includes('keeps your files in its own storage') && note.includes('From this computer...'),
    note,
  );
  await page.screenshot({ path: join(outDir, `${name}-open-dialog.png`) });
  await scan(page, `${name} open dialog`);
  await dialog.getByLabel('File name:').fill('PROG.x68');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(
    `${p} Open dialog: a typed name opens the stored file`,
    same(await page.evaluate(() => window.__result), ['/browser/demo/prog.X68']),
  );

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
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(
    `${p} Save dialog: the default extension .X68 is appended`,
    (await page.evaluate(() => window.__result)) === '/browser/demo/newprog.X68',
  );

  await saveRequest();
  await dialog.waitFor();
  await dialog.getByLabel('File name:').fill('prog');
  await dialog.getByRole('button', { name: 'Save' }).click();
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
  await box.getByRole('button', { name: 'No' }).click();
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
  await dialog.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => window.__result !== undefined);
  check(
    `${p} folder chooser: a typed existing folder is taken, not entered`,
    (await page.evaluate(() => window.__result)) === '/browser/demo/inc',
    String(await page.evaluate(() => window.__result)),
  );
  await chooseFolder();
  await dialog.waitFor();
  await listedOptions(dialog, ['inc']);
  await dialog.getByRole('button', { name: 'OK' }).click();
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

  // The Files panel: select demo, Export... downloads demo.zip.
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
  // WebKit on Linux (WebKitGTK) turns the spaces of a suggested download name into underscores
  // itself (CI run 44913261966: "My_Programs.zip"); the name the page asked for is what FS1 controls.
  const suggested = storeDownload.suggestedFilename();
  check(
    `${p} Export... of the store root downloads "My Programs.zip"`,
    same(requestedNames, ['My Programs.zip']) &&
      (suggested === 'My Programs.zip' ||
        (name === 'webkit' && process.platform === 'linux' && suggested === 'My_Programs.zip')),
    `page asked for ${JSON.stringify(requestedNames)}, the browser suggests ${JSON.stringify(suggested)}`,
  );
  const before = await storeContents(page);

  // Dark theme screenshot and scan of the panel.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await page.screenshot({ path: join(outDir, `${name}-files-panel-dark.png`) });
  await scan(page, `${name} dark editor with Files panel`);
  check(`${p} ui pass: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();

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
  check(`${p} import pass: no console errors`, second.errors.length === 0, second.errors.slice(0, 3).join(' | '));
  await fresh.close();
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
        console.log(`\n[${name}, backend]`);
        await backendPass(browser, name);
        console.log(`\n[${name}, store]`);
        await storePass(browser, name);
        console.log(`\n[${name}, blocked storage]`);
        await blockedPass(browser, name);
        console.log(`\n[${name}, storage that does not answer]`);
        await hangingPass(browser, name);
        console.log(`\n[${name}, full storage]`);
        if (name === 'chromium') await quotaPass(browser, name);
        else await injectedQuotaPass(browser, name);
        console.log(`\n[${name}, a page killed in the middle of a write]`);
        await killPass(browser, name);
        console.log(`\n[${name}, dialogs, panel, drop, export, import]`);
        await uiPass(browser, name);
      } catch (error) {
        check(`${name}: the pass ran to the end`, false, String(error?.stack ?? error).slice(0, 400));
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  for (const file of ['chromium-demo.zip', 'webkit-demo.zip']) rmSync(join(outDir, `${file}.tmp`), { force: true });
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
