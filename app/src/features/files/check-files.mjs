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
//   - the Safari storage notice (R-10), with ?storage-notice=1: in WebKit at the first start, its
//     Export... downloads the whole store, Got it hides it for good (reloads, other windows), the
//     installed app's variant with an empty store and its Import..., both themes, Tab order and
//     names; never in Chromium, never under automation without the parameter, and the panel's
//     layout without it is the one it always had;
//   - no console errors.
//
// Screenshots go to build/FS1/files-check (git-ignored). Exit code 0 = everything passed.
// The page object `window.__easy68k` exists in development builds only (main.tsx).

/* global console, process, window, document, indexedDB, IDBFactory, IDBObjectStore, setTimeout, DataTransfer, DragEvent, File, performance, Navigator, DOMException, URL, TextEncoder, TextDecoder, Buffer, MutationObserver, clearTimeout, navigator, requestAnimationFrame, FileSystemDirectoryHandle, FileSystemFileHandle */

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
let lastStep = '';
const progress = (step) => {
  lastStep = step;
};
async function timedPass(label, run) {
  lastStep = 'start';
  const began = Date.now();
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: did not finish within ${PASS_LIMIT_MS / 1000} s; last step: ${lastStep}`)),
      PASS_LIMIT_MS,
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
    progress(`delay ${delay} ms: opening the page to kill`);
    const victim = await openApp(context);
    const path = `/browser/kill/f${delay}.bin`;
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
    progress(`delay ${delay} ms: opening a new page of the same store`);
    const survivor = await openApp(context);
    progress(`delay ${delay} ms: reading the files in the new page`);
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
    await context.close();
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
      : r.banner.includes('Files are NOT being saved'));
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
  // ARCHITECTURE-PLUS P3.2.3 (N5): the Export button's name says what it will export.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-e68-panel="files"] button[aria-label="Export the folder \\"demo\\" as demo.zip"]').click(),
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
    page.locator('[data-e68-panel="files"] button[aria-label="Export all of My Programs as My Programs.zip"]').click(),
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
  await plainContext.close();

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
    await context.close();
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
  await context.close();

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
  await installedContext.close();

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
  await emptyContext.close();
}

// ---- the stage of additions: the Files panel of ARCHITECTURE-PLUS P3.2 (N5) -------------------------

const FILES = '[data-e68-panel="files"]';
const TREE = `${FILES} [role=tree]`;

/** Runs in the page before the application: the key map of `platform` (tests/e2e/fixtures/keys.ts). */
function pretendPlatform(platform) {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform, configurable: true });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
}

/** A chord of the table (`Shift+Cmd+Z`) as Playwright's key name (tests/e2e/fixtures/keys.ts). */
function playwrightKey(chord) {
  const mods = { Ctrl: 'Control', Alt: 'Alt', Option: 'Alt', Shift: 'Shift', Cmd: 'Meta' };
  const names = { Esc: 'Escape', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
  const parts = chord.split('+');
  const key = parts.pop() ?? '';
  const name = /^[A-Z]$/.test(key) ? `Key${key}` : (names[key] ?? key);
  return [...parts.map((m) => mods[m]), name].join('+');
}

/** A context whose page has the key map of `keys` ('windows' or 'mac'). */
async function keyMapContext(browser, keys, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
    ...options,
  });
  await context.addInitScript(pretendPlatform, keys === 'mac' ? 'MacIntel' : 'Win32');
  return context;
}

/** The names of the selected rows, the focused row's name, and the status line. */
function treeState(page) {
  return page.evaluate((tree) => {
    const element = document.querySelector(tree);
    const rows = [...element.querySelectorAll('[role=treeitem]')];
    const nameOf = (row) => row.querySelector('.e68-files__name')?.textContent ?? '';
    const focusedId = element.getAttribute('aria-activedescendant');
    return {
      selected: rows.filter((row) => row.getAttribute('aria-selected') === 'true').map(nameOf),
      focused: focusedId ? nameOf(document.getElementById(focusedId)) : null,
      count: document.querySelector('[data-e68-panel="files"] .e68-files__count')?.textContent ?? '',
      active: document.activeElement === element,
      multi: element.getAttribute('aria-multiselectable'),
      owns: element.getAttribute('data-e68-own-keys'),
    };
  }, TREE);
}

/** Writes files into the page's Vfs (a path ending in / is a folder). */
function seedFiles(page, paths) {
  return page.evaluate(async (list) => {
    const { vfs } = window.__easy68k.ctx;
    for (const path of list) {
      if (path.endsWith('/')) await vfs.mkdirp(path.slice(0, -1));
      else await vfs.writeFile(path, new TextEncoder().encode(`* ${path}\r\n`));
    }
  }, paths);
}

const exists = (page, path) => page.evaluate(async (p) => (await window.__easy68k.ctx.vfs.stat(p)) !== null, path);

/** Waits until every path of `present` exists and none of `absent` does (polled from here). */
async function waitForPaths(page, present, absent = [], timeout = 15_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate(
      async ({ yes, no }) => {
        const { vfs } = window.__easy68k.ctx;
        for (const p of yes) if ((await vfs.stat(p)) === null) return false;
        for (const p of no) if ((await vfs.stat(p)) !== null) return false;
        return true;
      },
      { yes: present, no: absent },
    );
    if (ok || Date.now() > deadline) return ok;
    await page.waitForTimeout(100);
  }
}

/**
 * Polls `fn(arg)` in the page from here until it resolves truthy (an async predicate cannot go to
 * page.waitForFunction, which takes the Promise itself as truthy and returns at once).
 */
async function waitInPage(page, fn, arg, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page.evaluate(fn, arg);
    if (ok || Date.now() > deadline) return ok;
    await page.waitForTimeout(100);
  }
}

/** Polls the tree's state until `test(state)` holds or the time is up; resolves to the last state. */
async function waitForTree(page, test, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const s = await treeState(page);
    if (test(s) || Date.now() > deadline) return s;
    await page.waitForTimeout(100);
  }
}

async function revealRow(page, path) {
  await page.evaluate(async (p) => {
    const { revealInFilesPanel } = await import('/src/features/files/FilesPanel.tsx');
    revealInFilesPanel(window.__easy68k.ctx, p);
  }, path);
  await page.locator(`${FILES} [role=treeitem][data-e68-path="${path}"][aria-selected=true]`).waitFor();
}

const row = (page, path) => page.locator(`${FILES} [role=treeitem][data-e68-path="${path}"]`);

/**
 * Clicks a row with `mod` held, as the key map's system delivers it. On a Mac the browser turns a
 * Ctrl+click into a right click (a `contextmenu` after the pointer events), so the Windows key
 * map's Ctrl+click, which no real Mac gives, would open the context menu over the tree; there it is
 * dispatched as Windows delivers it (pointer events and a click with ctrlKey, no context menu).
 * EASY68K_FILES_DISPATCH_CTRL=1 takes that path on any system, to check it where no Mac is.
 */
async function modClick(page, path, mod) {
  const dispatch =
    mod === 'Control' && (process.platform === 'darwin' || process.env.EASY68K_FILES_DISPATCH_CTRL === '1');
  if (!dispatch) {
    await row(page, path).click({ modifiers: [mod] });
    return;
  }
  const target = row(page, path);
  await target.scrollIntoViewIfNeeded();
  const pointer = { button: 0, ctrlKey: true, pointerType: 'mouse', isPrimary: true, pointerId: 1 };
  await target.dispatchEvent('pointerdown', { ...pointer, buttons: 1 });
  await target.dispatchEvent('mousedown', { button: 0, buttons: 1, ctrlKey: true });
  await target.dispatchEvent('pointerup', { ...pointer, buttons: 0 });
  await target.dispatchEvent('mouseup', { button: 0, buttons: 0, ctrlKey: true });
  await target.dispatchEvent('click', { button: 0, ctrlKey: true });
}

/** Drags the rows of `from` (as the panel's own drag) onto the row of `to`; `drop` false: hover only. */
function syntheticDrag(page, from, to, { drop = true, hoverMs = 0 } = {}) {
  return page.evaluate(
    async ({ fromPath, toPath, doDrop, wait }) => {
      const find = (p) => document.querySelector(`[data-e68-panel="files"] [data-e68-path="${p}"]`);
      const source = find(fromPath);
      const dt = new DataTransfer();
      // A DataTransfer made by a page keeps no dropEffect outside a real drag: record what the
      // panel's handler sets (the cursor the browser would show).
      let effect = 'none';
      Object.defineProperty(dt, 'dropEffect', {
        get: () => effect,
        set: (value) => {
          effect = value;
        },
        configurable: true,
      });
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 50));
      const target = find(toPath);
      const over = () => {
        const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
        target.dispatchEvent(event);
        return { accepted: event.defaultPrevented, effect: dt.dropEffect };
      };
      let result = over();
      const until = performance.now() + wait;
      while (performance.now() < until) {
        await new Promise((r) => setTimeout(r, 100));
        result = over();
      }
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
      const title = find(toPath)?.getAttribute('title') ?? null;
      const outlined = find(toPath)?.classList.contains('e68-files__row--drop') ?? false;
      if (doDrop)
        find(toPath).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ...result, title, outlined, types: [...dt.types] };
    },
    { fromPath: from, toPath: to, doDrop: drop, wait: hoverMs },
  );
}

/** The chords of a command on the page's key map, as Playwright keys. */
function chordsInPage(page, id) {
  return page.evaluate(async (command) => {
    const { chordsOn } = await import('/src/commands/specs.ts');
    return chordsOn(command, window.__easy68k.ctx.platform.os, false);
  }, id);
}

async function answerBox(page, button) {
  const box = page.locator('[role=alertdialog]').last();
  await box.waitFor({ timeout: 10_000 });
  const textShown = (await box.innerText()).replace(/\s+/g, ' ');
  await box.getByRole('button', { name: button, exact: true }).click();
  await box.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  return textShown;
}

/**
 * P3.2.1 and P1.3 on one key map: Shift+click, Ctrl/Cmd+click, every key of the tree, Ctrl/Cmd+A,
 * the undo and redo chords staying in the tree, Delete with the focus after it, Move To... by
 * keyboard. Screenshots and an axe scan of a multiple selection in both themes.
 */
async function selectionPass(browser, name, keys) {
  const p = `${name} (${keys} keys):`;
  const context = await keyMapContext(browser, keys);
  await context.addInitScript(withoutFileSystemAccess);
  const { page, errors } = await openApp(context);
  const os = await page.evaluate(() => window.__easy68k.ctx.platform.os);
  check(`${p} the page has the ${keys} key map`, os === keys, os);
  const mod = keys === 'mac' ? 'Meta' : 'Control';
  const alt = keys === 'mac' ? 'Alt' : 'Control'; // Option on a Mac, Ctrl elsewhere (P1.3)
  await seedFiles(page, [
    '/browser/sel/a.X68',
    '/browser/sel/b.X68',
    '/browser/sel/c.X68',
    '/browser/sel/d.X68',
    '/browser/sel/sub/x.X68',
  ]);
  await revealRow(page, '/browser/sel/a.X68');

  const state0 = await treeState(page);
  const expectedOwn = keys === 'mac' ? 'Cmd+A Ctrl+A Cmd+Z Ctrl+Z Shift+Cmd+Z Ctrl+Alt+Z' : 'Ctrl+A Ctrl+Z Ctrl+Alt+Z';
  check(
    `${p} the tree is multiselectable and owns exactly the chords of Select All, Undo and Redo`,
    state0.multi === 'true' && state0.owns === expectedOwn,
    `${state0.multi} / ${state0.owns}`,
  );

  // Clicks.
  await row(page, '/browser/sel/a.X68').click();
  await row(page, '/browser/sel/c.X68').click({ modifiers: ['Shift'] });
  let s = await treeState(page);
  check(
    `${p} Shift+click selects the range from the anchor`,
    same(s.selected, ['a.X68', 'b.X68', 'c.X68']),
    JSON.stringify(s),
  );
  check(`${p} a line says "3 items selected"`, s.count === '3 items selected', s.count);
  await modClick(page, '/browser/sel/sub', mod);
  s = await treeState(page);
  check(
    `${p} ${mod}+click adds a row`,
    same(s.selected, ['sub', 'a.X68', 'b.X68', 'c.X68']),
    JSON.stringify(s.selected),
  );
  await modClick(page, '/browser/sel/b.X68', mod);
  s = await treeState(page);
  check(`${p} ${mod}+click removes a row`, same(s.selected, ['sub', 'a.X68', 'c.X68']), JSON.stringify(s.selected));
  await page.screenshot({ path: join(outDir, `${name}-${keys}-multi-selection-light.png`) });
  await scan(page, `${name} ${keys} light Files panel with a multiple selection`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await page.locator(FILES).screenshot({ path: join(outDir, `${name}-${keys}-multi-selection-dark.png`) });
  await scan(page, `${name} ${keys} dark Files panel with a multiple selection`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'light'));

  // Keys (P1.3).
  await row(page, '/browser/sel/a.X68').click();
  await page.locator(TREE).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  s = await treeState(page);
  check(
    `${p} Shift+Down twice extends to three rows`,
    same(s.selected, ['a.X68', 'b.X68', 'c.X68']),
    JSON.stringify(s),
  );
  await page.keyboard.press('Shift+ArrowUp');
  s = await treeState(page);
  check(`${p} Shift+Up takes one back`, same(s.selected, ['a.X68', 'b.X68']), JSON.stringify(s.selected));
  await page.keyboard.press('Shift+End');
  s = await treeState(page);
  check(
    `${p} Shift+End extends to the last row`,
    s.selected[0] === 'a.X68' && s.focused === s.selected.at(-1),
    JSON.stringify(s),
  );
  await page.keyboard.press('Shift+Home');
  s = await treeState(page);
  check(
    `${p} Shift+Home extends to the first row; the store's root is not part of it`,
    !s.selected.includes('My Programs') && s.selected.at(-1) === 'a.X68' && s.focused === 'My Programs',
    JSON.stringify(s),
  );
  await row(page, '/browser/sel/b.X68').click();
  await page.keyboard.press(`${alt}+ArrowDown`);
  s = await treeState(page);
  check(
    `${p} ${alt === 'Alt' ? 'Option' : 'Ctrl'}+Down moves the focus without selecting`,
    same(s.selected, ['b.X68']) && s.focused === 'c.X68',
    JSON.stringify(s),
  );
  await page.keyboard.press(`${alt}+ArrowUp`);
  await page.keyboard.press(`${alt}+ArrowUp`);
  await page.keyboard.press(`${alt}+Space`);
  s = await treeState(page);
  check(
    `${p} ${alt === 'Alt' ? 'Option' : 'Ctrl'}+Space adds the focused row`,
    same(s.selected, ['a.X68', 'b.X68']) && s.focused === 'a.X68',
    JSON.stringify(s),
  );
  await page.keyboard.press('Escape');
  s = await treeState(page);
  check(
    `${p} Esc clears the multiple selection to the focused row`,
    same(s.selected, ['a.X68']),
    JSON.stringify(s.selected),
  );

  // Ctrl/Cmd+A, the undo and redo chords: the tree's, never the editor's.
  await page.locator('.cm-content').first().click();
  await page.keyboard.type('XYZ');
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('XYZ'));
  const editorBefore = await page.evaluate(() => document.querySelector('.cm-content').textContent);
  await row(page, '/browser/sel/a.X68').click();
  await page.locator(TREE).focus();
  for (const chord of await chordsInPage(page, 'ed.edit.selectAll')) {
    await row(page, '/browser/sel/a.X68').click();
    await page.keyboard.press(playwrightKey(chord));
    s = await treeState(page);
    const rowCount = await page.locator(`${FILES} [role=treeitem]:not(.e68-files__row--root)`).count();
    check(
      `${p} ${chord} in the tree selects every visible row (not the editor's text)`,
      s.selected.length === rowCount && s.active,
      `${s.selected.length} of ${rowCount}; tree focused ${s.active}`,
    );
  }
  for (const id of ['ed.edit.undo', 'ed.edit.redo']) {
    for (const chord of await chordsInPage(page, id)) {
      await page.keyboard.press(playwrightKey(chord));
      const after = await page.evaluate(() => document.querySelector('.cm-content').textContent);
      check(
        `${p} ${chord} (${id}) in the tree leaves the editor's text and undo alone`,
        after === editorBefore && after.includes('XYZ'),
        after.slice(0, 60),
      );
    }
  }

  // The question's No has the focus (P3.2.2): Enter answers No and deletes nothing.
  await row(page, '/browser/sel/b.X68').click();
  await page.locator(TREE).focus();
  await page.keyboard.press('Delete');
  const firstBox = page.locator('[role=alertdialog]').last();
  await firstBox.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.activeElement?.closest('[role=alertdialog]') !== null, null, {
    timeout: 5_000,
  });
  const focusedButton = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
  await page.keyboard.press('Enter');
  await firstBox.waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(300);
  const keptB = await exists(page, '/browser/sel/b.X68');
  check(
    `${p} in the Delete question No has the focus; Enter deletes nothing`,
    focusedButton === 'No' && keptB,
    `focused ${JSON.stringify(focusedButton)}; b.X68 still there ${keptB}`,
  );

  // Delete, and the focus after it (P3.2.2): the row after the last deleted row.
  await row(page, '/browser/sel/b.X68').click();
  await page.locator(TREE).focus();
  await page.keyboard.press('Delete');
  const asked = await answerBox(page, 'Yes');
  check(
    `${p} Delete asks "Delete "b.X68"? You can restore it from the Trash."`,
    asked.includes('Delete "b.X68"? You can restore it from the Trash.'),
    asked,
  );
  const deletedB = await waitForPaths(page, [], ['/browser/sel/b.X68']);
  s = await waitForTree(page, (t) => t.focused === 'c.X68' && t.active);
  check(
    `${p} after a delete the focus is on the row after it`,
    deletedB && s.focused === 'c.X68' && s.active,
    `deleted ${deletedB}; ${JSON.stringify(s)}`,
  );
  // The toast's Undo brings it back and puts the focus on its row (P3.2.7).
  const toast = page.locator('.e68-toast', { hasText: 'Deleted "b.X68".' });
  await toast.waitFor({ timeout: 10_000 });
  await toast.getByRole('button', { name: 'Undo' }).click();
  const backB = await waitForPaths(page, ['/browser/sel/b.X68'], [], 10_000);
  s = await waitForTree(page, (t) => t.focused === 'b.X68' && t.active);
  check(
    `${p} the toast's Undo brings it back with the focus on its row`,
    backB && s.focused === 'b.X68' && s.active,
    `back ${backB}; ${JSON.stringify(s)}`,
  );
  if (keys === 'mac') {
    await row(page, '/browser/sel/c.X68').click();
    await page.keyboard.press('Meta+Backspace');
    const macAsked = await answerBox(page, 'No');
    check(`${p} Cmd+Backspace deletes too (asks)`, macAsked.includes('Delete "c.X68"?'), macAsked);
  }

  // Move To... by keyboard: Shift+F10, the access key, arrows, Enter.
  await row(page, '/browser/sel/d.X68').click();
  await page.locator(TREE).focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Files' });
  await menu.waitFor({ timeout: 5000 });
  const items = await menu.getByRole('menuitem').allInnerTexts();
  check(
    `${p} the context menu has Move To..., Earlier Versions... and Undo after the original items`,
    items.some((t) => t.startsWith('Move To...')) &&
      items.some((t) => t.startsWith('Earlier Versions...')) &&
      items.some((t) => /^Undo/.test(t)),
    JSON.stringify(items.map((t) => t.split('\n')[0])),
  );
  await page.keyboard.press('m');
  const moveDialog = page.getByRole('dialog', { name: 'Move To' });
  await moveDialog.waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(outDir, `${name}-${keys}-move-to.png`) });
  await scan(page, `${name} ${keys} Move To dialog`);
  // The list has the focus; type-ahead finds "sub".
  for (let i = 0; i < 20; i++) {
    const current = await moveDialog.locator('[role=option][aria-selected=true]').innerText();
    if (current.trim() === 'sub') break;
    await page.keyboard.press('ArrowDown');
  }
  const button = await moveDialog.getByRole('button', { name: /^(Move|Copy)$/ }).innerText();
  await page.keyboard.press('Enter');
  await waitForPaths(page, ['/browser/sel/sub/d.X68'], ['/browser/sel/d.X68']);
  const afterMove = await page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    const names = async (dir) => (await vfs.list(dir).catch(() => [])).map((e) => e.name).join(',');
    return {
      sel: await names('/browser/sel'),
      sub: await names('/browser/sel/sub'),
      box: document.querySelector('[role=alertdialog]')?.textContent ?? null,
    };
  });
  check(
    `${p} Move To... by keyboard moves d.X68 into sub (button "${button.trim()}")`,
    !(await exists(page, '/browser/sel/d.X68')) &&
      (await exists(page, '/browser/sel/sub/d.X68')) &&
      button.trim() === 'Move',
    JSON.stringify(afterMove),
  );
  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/**
 * P3.2.4 and P3.2.6: dragging rows onto a folder, the 800 ms expand, the copy cursor and tool-tip
 * across stores, the storage line with and without an estimate and its refresh at most once per
 * second, the large import question.
 */
async function dragAndStoragePass(browser, name) {
  const p = `${name}:`;
  const context = await keyMapContext(browser, 'windows');
  await context.addInitScript(withoutFileSystemAccess);
  const { page, errors } = await openApp(context);
  await seedFiles(page, [
    '/browser/drag/a.X68',
    '/browser/drag/b.X68',
    '/browser/drag/into/x.X68',
    '/browser/drag/closed/y.X68',
  ]);
  await revealRow(page, '/browser/drag/a.X68');
  await page.evaluate(async () => {
    const { MemoryBackend } = await import('/src/fs/memory-backend.ts');
    window.__easy68k.ctx.vfs.mount(new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Folder: Lab' }));
  });
  await row(page, '/folder').waitFor({ timeout: 10_000 });

  // Drag to move, onto a folder row.
  await row(page, '/browser/drag/a.X68').click();
  await modClick(page, '/browser/drag/b.X68', 'Control');
  await revealRow(page, '/browser/drag/into').catch(() => {});
  await row(page, '/browser/drag/a.X68').click();
  await modClick(page, '/browser/drag/b.X68', 'Control');
  const moved = await syntheticDrag(page, '/browser/drag/b.X68', '/browser/drag/into');
  await waitForPaths(
    page,
    ['/browser/drag/into/a.X68', '/browser/drag/into/b.X68'],
    ['/browser/drag/a.X68', '/browser/drag/b.X68'],
  );
  await page
    .locator('.e68-toast', { hasText: 'Moved 2 items to into.' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  check(
    `${p} dragging two selected rows onto a folder moves both (drag type ${moved.types.join(', ')}, outlined ${moved.outlined})`,
    (await exists(page, '/browser/drag/into/a.X68')) &&
      (await exists(page, '/browser/drag/into/b.X68')) &&
      !(await exists(page, '/browser/drag/a.X68')) &&
      moved.effect === 'move' &&
      moved.outlined &&
      same(moved.types, ['application/x-e68-paths']),
    JSON.stringify(moved),
  );
  const movedToast = await page.locator('.e68-toast', { hasText: 'Moved 2 items to into.' }).count();
  check(`${p} the toast "Moved 2 items to into." with Undo`, movedToast === 1);

  // A folder row under the pointer for 800 ms opens.
  await row(page, '/browser/drag/into/a.X68').click();
  const early = await syntheticDrag(page, '/browser/drag/into/a.X68', '/browser/drag/closed', {
    drop: false,
    hoverMs: 400,
  });
  const earlyOpen = await row(page, '/browser/drag/closed').getAttribute('aria-expanded');
  const late = await syntheticDrag(page, '/browser/drag/into/a.X68', '/browser/drag/closed', {
    drop: false,
    hoverMs: 1200,
  });
  const lateOpen = await row(page, '/browser/drag/closed').getAttribute('aria-expanded');
  check(
    `${p} a folder row under the pointer opens after 800 ms (closed at 400 ms, open at 1200 ms)`,
    earlyOpen === 'false' && lateOpen === 'true' && early.accepted && late.accepted,
    `${earlyOpen} / ${lateOpen}`,
  );

  // Across stores: the copy cursor and the target's tool-tip; the drop copies.
  const across = await syntheticDrag(page, '/browser/drag/into/a.X68', '/folder');
  await waitForPaths(page, ['/folder/a.X68']);
  check(
    `${p} across stores the drag shows the copy cursor and "Copy to Lab" (P3.2.5's name of the folder); the drop copies`,
    across.effect === 'copy' &&
      across.title === 'Copy to Lab' &&
      (await exists(page, '/folder/a.X68')) &&
      (await exists(page, '/browser/drag/into/a.X68')),
    JSON.stringify(across),
  );
  // Refused targets: a folder into itself; "Opened from this computer" is never shown without links.
  const self = await syntheticDrag(page, '/browser/drag/into', '/browser/drag/into', { drop: false });
  check(`${p} a folder cannot be dropped into itself`, !self.accepted, JSON.stringify(self));

  // The storage line, with the browser's estimate.
  const line = page.locator(`${FILES} [data-e68-storage-line]`);
  await page.waitForFunction(
    () => /^This site uses /.test(document.querySelector('[data-e68-storage-line]')?.textContent ?? ''),
    null,
    { timeout: 10_000 },
  );
  const lineText = await line.innerText();
  check(
    `${p} the storage line: "This site uses ... in this browser - Earlier versions and Trash: ... - About ... free"`,
    /^This site uses \d+(\.\d)? (bytes|kB|MB|GB) in this browser - Earlier versions and Trash: \d+(\.\d)? (bytes|kB|MB|GB) - About \d+(\.\d)? (bytes|kB|MB|GB) free$/.test(
      lineText.trim(),
    ),
    lineText,
  );
  // At most once per second, however many changes arrive (measured by the page's own clock).
  const refreshes = await page.evaluate(async () => {
    const element = document.querySelector('[data-e68-storage-line]');
    const times = [];
    const observer = new MutationObserver(() => times.push(performance.now()));
    observer.observe(element, { attributes: true, attributeFilter: ['data-e68-storage-refreshes'] });
    const { vfs } = window.__easy68k.ctx;
    const started = performance.now();
    for (let i = 0; i < 40; i++) {
      await vfs.writeFile(`/browser/drag/burst${i % 4}.X68`, new TextEncoder().encode(`* ${i}\r\n`));
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 1500));
    observer.disconnect();
    const gaps = times.slice(1).map((t, i) => Math.round(t - times[i]));
    return { count: times.length, gaps, spanMs: Math.round(performance.now() - started) };
  });
  check(
    `${p} the storage line is refreshed after changes, at most once per second`,
    refreshes.count >= 1 && refreshes.gaps.every((gap) => gap >= 950),
    JSON.stringify(refreshes),
  );
  // It is a button that opens the Storage group of Port Additions (P3.5).
  const ran = await page.evaluate(async () => {
    const { commands } = window.__easy68k.ctx;
    const calls = [];
    const real = commands.run.bind(commands);
    commands.run = (id, arg) => {
      calls.push([id, arg]);
      return id === 'app.additions.options' ? Promise.resolve() : real(id, arg);
    };
    document.querySelector('[data-e68-storage-line]').click();
    await new Promise((r) => setTimeout(r, 100));
    commands.run = real;
    return calls;
  });
  check(
    `${p} the storage line runs app.additions.options with { group: 'storage' }`,
    same(ran, [['app.additions.options', { group: 'storage' }]]),
    JSON.stringify(ran),
  );

  // The question before a large import (101 files).
  await row(page, '/browser').click();
  await page.locator(`${FILES} button[aria-label="Import..."]`).click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: /Files or \.zip/ }).click(),
  ]);
  await chooser.setFiles(
    Array.from({ length: 101 }, (_, i) => ({
      name: `many${i}.X68`,
      mimeType: 'text/plain',
      buffer: Buffer.from('* x\r\n'),
    })),
  );
  const largeText = await answerBox(page, 'No');
  check(
    `${p} importing 101 files asks first, with the free space; No imports nothing`,
    /^Import Import 101 files \(505 bytes\) into My Programs\? The browser has about \d+(\.\d)? (kB|MB|GB) free for this site\./.test(
      largeText,
    ) && !(await exists(page, '/browser/many0.X68')),
    largeText,
  );
  await page.locator(FILES).screenshot({ path: join(outDir, `${name}-storage-line.png`) });
  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();

  // A page without navigator.storage.estimate: only the history's part.
  const bare = await keyMapContext(browser, 'windows');
  await bare.addInitScript(() => {
    if (window.StorageManager) delete window.StorageManager.prototype.estimate;
  });
  const second = await openApp(bare);
  await second.page.waitForTimeout(1500);
  const bareText = (await second.page.locator(`${FILES} [data-e68-storage-line]`).innerText()).trim();
  check(
    `${p} without an estimate the line says only "Earlier versions and Trash: ..."`,
    /^Earlier versions and Trash: \d+(\.\d)? (bytes|kB|MB|GB)$/.test(bareText),
    bareText,
  );
  check(
    `${p} no console errors without an estimate`,
    second.errors.length === 0,
    second.errors.slice(0, 3).join(' | '),
  );
  await bare.close();
}

/** Logs, in the page, every write and remove made through a FileSystemHandle of the origin's private file system. */
function logHandleWrites() {
  window.__fsLog = [];
  const where = async (handle, name) => {
    const root = await navigator.storage.getDirectory();
    const parts = (await root.resolve(handle)) ?? ['?'];
    return [...parts, ...(name === undefined ? [] : [name])].join('/');
  };
  const dir = FileSystemDirectoryHandle.prototype;
  const file = FileSystemFileHandle.prototype;
  const getFile = dir.getFileHandle;
  dir.getFileHandle = async function (name, options) {
    if (options?.create) window.__fsLog.push(`create ${await where(this, name)}`);
    return getFile.call(this, name, options);
  };
  const getDir = dir.getDirectoryHandle;
  dir.getDirectoryHandle = async function (name, options) {
    if (options?.create) window.__fsLog.push(`mkdir ${await where(this, name)}`);
    return getDir.call(this, name, options);
  };
  const removeEntry = dir.removeEntry;
  dir.removeEntry = async function (name, options) {
    window.__fsLog.push(`remove ${await where(this, name)}`);
    return removeEntry.call(this, name, options);
  };
  const createWritable = file.createWritable;
  file.createWritable = async function (options) {
    window.__fsLog.push(`write ${await where(this)}`);
    return createWritable.call(this, options);
  };
}

/**
 * Chromium, an opened folder on a fake directory handle (the origin private file system, as
 * check-fsaccess.mjs does) with a log of every write and remove: the root's text, Delete keeps a
 * Trash copy, delete, move, copy, rename and a Trash restore touch only the files they name and
 * nothing below .git; a linked file listed by its name and removed from the list, its real file
 * untouched.
 */
async function openedFolderPass(browser, name) {
  const p = `${name}: opened folder:`;
  const context = await keyMapContext(browser, 'windows');
  await context.addInitScript(logHandleWrites);
  const { page, errors } = await openApp(context);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const write = async (path, content) => {
      const parts = path.split('/');
      let d = root;
      for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
      const f = await d.getFileHandle(parts.at(-1), { create: true });
      const w = await f.createWritable();
      await w.write(new TextEncoder().encode(content));
      await w.close();
    };
    for (const path of [
      'Lab/prog.X68',
      'Lab/demo/a.X68',
      'Lab/demo/b.X68',
      'Lab/repo/.git/HEAD',
      'Lab/repo/main.X68',
      'Lab/other/keep.X68',
      'Outside/lab1.X68',
    ])
      await write(path, `* ${path}\r\n`);
    const lab = await root.getDirectoryHandle('Lab');
    const { FolderBackend } = await import('/src/fs/fsaccess-backend.ts');
    window.__easy68k.ctx.vfs.mount(new FolderBackend(lab));
    window.__fsLog.length = 0;
  });
  await row(page, '/folder').waitFor({ timeout: 10_000 });
  const rootRow = await page.evaluate(() => {
    const r = document.querySelector('[data-e68-panel="files"] [data-e68-path="/folder"]');
    const repo = document.querySelector('[data-e68-panel="files"] [data-e68-path="/folder/repo"]');
    return {
      text: r?.innerText.replace(/\s+/g, ' ').trim(),
      title: r?.getAttribute('title'),
      repo: repo?.getAttribute('title'),
    };
  });
  check(
    `${p} the root reads "Folder: Lab on this computer" with its tool-tip`,
    rootRow.text === 'Folder: Lab on this computer' &&
      rootRow.title === 'Files here are the files of the folder "Lab" on this computer.',
    JSON.stringify(rootRow),
  );
  await revealRow(page, '/folder/repo/main.X68');
  const listedGit = await page.locator(`${FILES} [role=treeitem]`, { hasText: '.git' }).count();
  const repoTitle = await row(page, '/folder/repo').getAttribute('title');
  check(
    `${p} .git is not listed; the repository's row says "Git repository (its .git folder is not shown)"`,
    listedGit === 0 && repoTitle.endsWith('\nGit repository (its .git folder is not shown)'),
    `${listedGit} rows; ${JSON.stringify(repoTitle)}`,
  );
  const log = () => page.evaluate(() => window.__fsLog.splice(0));
  // A write or remove names one of `allowed`; `mkdir` of a folder above one of them is the backend
  // finding its way there (getDirectoryHandle with create of a folder that exists).
  const onlyNamed = (entries, allowed) =>
    entries.every((e) =>
      e.startsWith('mkdir ')
        ? allowed.some((a) => a.startsWith(`${e.slice(6)}/`))
        : allowed.some((a) => e.endsWith(` ${a}`)),
    );
  const gitTouched = [];
  const note = (entries) => gitTouched.push(...entries.filter((e) => /\/\.git(\/|$)/i.test(e)));

  // Delete from it: a copy in the Trash; only Lab/prog.X68 removed.
  await row(page, '/folder/prog.X68').click();
  await page.locator(TREE).focus();
  await page.keyboard.press('Delete');
  const asked = await answerBox(page, 'Yes');
  await waitForPaths(page, [], ['/folder/prog.X68']);
  await page.waitForTimeout(300);
  const trash = await page.evaluate(async () => (await window.__easy68k.ctx.history.trashItems()).map((i) => i.path));
  let entries = await log();
  note(entries);
  check(
    `${p} Delete says where it deletes and keeps a Trash copy; it removes only the file it names`,
    asked.includes(
      'It is deleted from the folder "Lab" on this computer. A copy stays in the Trash of EASy68K for up to 30 days.',
    ) &&
      same(trash, ['/folder/prog.X68']) &&
      same(entries, ['remove Lab/prog.X68']),
    `${asked} | ${JSON.stringify(trash)} | ${JSON.stringify(entries)}`,
  );

  // Trash restore writes only the file it names.
  await page.evaluate(async () => {
    const { history } = window.__easy68k.ctx;
    const [item] = await history.trashItems();
    await history.restoreTrash(item.id, {
      ask: async () => 'cancel',
      fallback: async () => null,
      confirm: async () => false,
    });
  });
  entries = await log();
  note(entries);
  check(
    `${p} a Trash restore writes only the file it names`,
    (await exists(page, '/folder/prog.X68')) && entries.length > 0 && onlyNamed(entries, ['Lab/prog.X68']),
    JSON.stringify(entries),
  );

  // Move (drag within the folder): writes the target, removes the source, nothing else.
  await revealRow(page, '/folder/demo/a.X68');
  await revealRow(page, '/folder/other/keep.X68');
  await row(page, '/folder/demo/a.X68').click();
  await syntheticDrag(page, '/folder/demo/a.X68', '/folder/other');
  await waitForPaths(page, ['/folder/other/a.X68'], ['/folder/demo/a.X68'], 10_000);
  await page.waitForTimeout(300);
  entries = await log();
  note(entries);
  check(
    `${p} a move writes and removes only the files it names`,
    onlyNamed(entries, ['Lab/other/a.X68', 'Lab/demo/a.X68']) && entries.includes('remove Lab/demo/a.X68'),
    JSON.stringify(entries),
  );

  // Copy (to My Programs): nothing written or removed in the folder.
  await row(page, '/folder/demo/b.X68').click();
  await syntheticDrag(page, '/folder/demo/b.X68', '/browser');
  await waitForPaths(page, ['/browser/b.X68'], [], 10_000);
  await page.waitForTimeout(300);
  entries = await log();
  note(entries);
  check(`${p} a copy to My Programs writes nothing in the folder`, entries.length === 0, JSON.stringify(entries));

  // Rename, and a change of letter case only (through its temporary name, gone at the end).
  await revealRow(page, '/folder/demo/b.X68');
  await page.locator(TREE).focus();
  await page.keyboard.press('F2');
  let nameDialog = page.getByRole('dialog', { name: 'Rename' });
  await nameDialog.waitFor();
  await nameDialog.getByRole('textbox').fill('c.X68');
  await page.keyboard.press('Enter');
  const renamed = await waitInPage(page, async () => {
    const names = (await window.__easy68k.ctx.vfs.list('/folder/demo')).map((e) => e.name);
    return names.includes('c.X68') && !names.includes('b.X68');
  });
  await page.waitForTimeout(300);
  entries = await log();
  note(entries);
  check(
    `${p} a rename writes and removes only the files it names`,
    renamed &&
      onlyNamed(entries, ['Lab/demo/b.X68', 'Lab/demo/c.X68']) &&
      entries.includes('remove Lab/demo/b.X68') &&
      entries.some((e) => e.endsWith(' Lab/demo/c.X68')),
    `renamed ${renamed}; ${JSON.stringify(entries)}`,
  );
  await revealRow(page, '/folder/demo/c.X68');
  await page.locator(TREE).focus();
  await page.keyboard.press('F2');
  nameDialog = page.getByRole('dialog', { name: 'Rename' });
  await nameDialog.waitFor();
  await nameDialog.getByRole('textbox').fill('C.X68');
  await page.keyboard.press('Enter');
  const caseRenamed = await waitInPage(page, async () => {
    const names = (await window.__easy68k.ctx.vfs.list('/folder/demo')).map((e) => e.name);
    return names.length === 1 && names[0] === 'C.X68';
  });
  check(`${p} the change of letter case is made`, caseRenamed);
  await page.waitForTimeout(300);
  entries = await log();
  note(entries);
  const leftovers = await page.evaluate(async () =>
    (await window.__easy68k.ctx.vfs.list('/folder/demo')).map((e) => e.name),
  );
  check(
    `${p} a change of letter case passes through its temporary name only, which is gone at the end`,
    entries.length > 0 &&
      entries.every((e) => /^mkdir Lab\/demo$|Lab\/demo\/(c\.X68|C\.X68|C\.X68\.renaming-\d+)$/.test(e)) &&
      same(leftovers, ['C.X68']),
    `${JSON.stringify(entries)} | ${JSON.stringify(leftovers)}`,
  );

  // The repository: not deleted, moved or renamed; .git never touched.
  await row(page, '/folder/repo').click();
  await page.locator(TREE).focus();
  await page.keyboard.press('Delete');
  const refusal = await answerBox(page, 'OK');
  await page.keyboard.press('F2');
  const renameRefusal = await answerBox(page, 'OK');
  await syntheticDrag(page, '/folder/repo', '/folder/other');
  const moveRefusal = await answerBox(page, 'OK');
  entries = await log();
  note(entries);
  check(
    `${p} a folder that holds .git is not deleted, renamed or moved, with the texts of P3.2.2 and P3.2.4`,
    refusal.includes(
      'The folder "repo" holds a Git repository. Nothing was deleted. Delete it with your own tools if you are sure.',
    ) &&
      renameRefusal.includes('The folder "repo" holds a Git repository. Rename it with your own tools.') &&
      moveRefusal.includes('The folder "repo" holds a Git repository. Move it with your own tools.') &&
      entries.length === 0,
    `${refusal} | ${renameRefusal} | ${moveRefusal} | ${JSON.stringify(entries)}`,
  );

  // No name becomes .git (P1.1 rule 2, verify round 2 of N5): Rename of a folder to .git and .GIT,
  // and New Folder .Git, are refused with the text of errata N5 entry 15 and asked again; Esc then
  // leaves everything as it was, on the disk as in the tree.
  const { gitNameRefused } = await page.evaluate(async () => {
    const texts = await import('/src/features/files/texts.ts');
    return { gitNameRefused: ['.git', '.GIT', '.Git'].map((n) => texts.gitNameRefused(n)) };
  });
  await revealRow(page, '/folder/other');
  const gitAnswers = [];
  for (const typed of ['.git', '.GIT']) {
    await page.locator(TREE).focus();
    await page.keyboard.press('F2');
    nameDialog = page.getByRole('dialog', { name: 'Rename' });
    await nameDialog.waitFor();
    await nameDialog.getByRole('textbox').fill(typed);
    await page.keyboard.press('Enter');
    gitAnswers.push(await answerBox(page, 'OK'));
    await nameDialog.waitFor(); // asked again
    await page.keyboard.press('Escape');
    await nameDialog.waitFor({ state: 'detached' });
  }
  await page.locator(FILES).getByRole('button', { name: 'New Folder...' }).click();
  const folderDialog = page.getByRole('dialog', { name: 'New Folder' });
  await folderDialog.waitFor();
  await folderDialog.getByRole('textbox').fill('.Git');
  await page.keyboard.press('Enter');
  gitAnswers.push(await answerBox(page, 'OK'));
  await folderDialog.waitFor();
  await page.keyboard.press('Escape');
  await folderDialog.waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  entries = await log();
  note(entries);
  const afterGit = await page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    return {
      other: (await vfs.list('/folder/other')).map((e) => e.name),
      top: (await vfs.list('/folder')).map((e) => e.name).sort(),
      rowShown: document.querySelector('[data-e68-panel="files"] [data-e68-path="/folder/other"]') !== null,
    };
  });
  check(
    `${p} Rename to .git or .GIT and New Folder .Git are refused with the text and asked again; nothing is written`,
    gitAnswers.length === 3 &&
      gitAnswers.every((t, i) => t.includes(gitNameRefused[i])) &&
      entries.length === 0 &&
      afterGit.rowShown &&
      afterGit.other.length > 0 &&
      !afterGit.top.some((n) => n.toLowerCase() === '.git'),
    `${JSON.stringify(gitAnswers)} | ${JSON.stringify(entries)} | ${JSON.stringify(afterGit)}`,
  );
  check(`${p} no command wrote or removed a path below .git`, gitTouched.length === 0, JSON.stringify(gitTouched));

  // A linked file: listed by its name, removed from the list, the real file untouched.
  const linkedOk = await page.evaluate(async () => {
    const linked = window.__easy68k.ctx.vfs.backends().find((b) => b.mount === 'linked');
    if (!linked) return null;
    const root = await navigator.storage.getDirectory();
    const handle = await (await root.getDirectoryHandle('Outside')).getFileHandle('lab1.X68');
    window.__linkedPath = await linked.link(handle);
    // As "From this computer..." does: the linked file is opened as a document.
    await window.__easy68k.ctx.documents.open(window.__linkedPath);
    window.__fsLog.length = 0;
    return window.__linkedPath;
  });
  if (linkedOk === null) {
    check(`${p} the linked store is mounted in Chromium`, false, 'no /linked backend');
  } else {
    const linkedRow = page.locator(`${FILES} [role=treeitem][data-e68-path="${linkedOk}"]`);
    await linkedRow.waitFor({ timeout: 10_000 });
    const shown = await page.evaluate((path) => {
      const r = document.querySelector(`[data-e68-panel="files"] [data-e68-path="${path}"]`);
      const root = document.querySelector('[data-e68-panel="files"] [data-e68-path="/linked"]');
      return {
        text: r.innerText.replace(/\s+/g, ' ').trim(),
        title: r.getAttribute('title'),
        root: root?.innerText.trim(),
      };
    }, linkedOk);
    check(
      `${p} a linked file is listed by its name under "Opened from this computer", "edited in place"`,
      shown.text === 'lab1.X68 edited in place' &&
        shown.title === 'Saving writes to the file "lab1.X68" on this computer.' &&
        shown.root === 'Opened from this computer',
      JSON.stringify(shown),
    );
    await page.locator(FILES).screenshot({ path: join(outDir, `${name}-opened-folder-and-linked.png`) });
    await linkedRow.click();
    await page.locator(TREE).focus();
    await page.keyboard.press('Delete');
    const removeText = await answerBox(page, 'Yes');
    await linkedRow.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    const real = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const f = await (await (await root.getDirectoryHandle('Outside')).getFileHandle('lab1.X68')).getFile();
      return new TextDecoder().decode(await f.arrayBuffer());
    });
    entries = await log();
    check(
      `${p} Remove from List: the question of P3.2.2, the row goes, the real file stays as it was`,
      removeText.includes('Remove "lab1.X68" from the Files panel? The file on this computer is not changed.') &&
        (await linkedRow.count()) === 0 &&
        real === '* Outside/lab1.X68\r\n' &&
        !entries.some((e) => e.includes('Outside/')),
      `${removeText} | ${JSON.stringify(real)} | ${JSON.stringify(entries)}`,
    );
  }
  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
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
          ['dialogs, panel, drop, export, import', uiPass],
          ['the Safari storage notice', storageNoticePass],
          // ARCHITECTURE-PLUS P3.2 (N5): both key maps on every system.
          ['selection and keys, Windows key map', (b, n) => selectionPass(b, n, 'windows')],
          ['selection and keys, macOS key map', (b, n) => selectionPass(b, n, 'mac')],
          ['drag, storage line, large import', dragAndStoragePass],
          ...(name === 'chromium' ? [['opened folder with a write log', openedFolderPass]] : []),
        ];
        for (const [label, pass] of passes) {
          if (onlyPass && !label.includes(onlyPass)) continue;
          console.log(`\n[${name}, ${label}]`);
          // A pass that throws is reported with its name and the whole message (Playwright's call
          // log says what was in the way), and the next pass still runs: a CI log of another
          // system must be enough to find the cause.
          try {
            await timedPass(`${name}, ${label}`, () => pass(browser, name));
          } catch (error) {
            check(`${name}, ${label}: the pass ran to the end`, false, String(error?.stack ?? error).slice(0, 3000));
          }
        }
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
