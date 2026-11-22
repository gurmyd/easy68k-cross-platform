// Browser check of work package FS2: the File System Access backends and their feature
// (ARCHITECTURE.md 9.4, FS2 acceptance). Owner: FS2.
//
//   node app/src/features/files-fsaccess/check-fsaccess.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright).
//
// The seam. An automated browser cannot answer the browser's own pickers or permission prompts.
// Chromium gives real FileSystemDirectoryHandle and FileSystemFileHandle objects without a picker
// in the origin private file system (navigator.storage.getDirectory()), so in Chromium:
//   - window.showDirectoryPicker and window.showOpenFilePicker are replaced, before the page
//     starts, by functions that hand out such handles (the next one the check has queued), or
//     reject with AbortError (Cancel) when none is queued;
//   - for the reload pass, FileSystemHandle.prototype.queryPermission answers "prompt" until
//     requestPermission has been called, and requestPermission rejects with SecurityError unless
//     the page has a user activation (navigator.userActivation.isActive), as Chromium does. It
//     records every request.
// Nothing in the application is changed for the check. What only a person with a real folder can
// prove (the pickers themselves, the real permission prompt after a reload, a real disk) is listed
// in docs/porting/errata/FS2.md under "Manual checks".
//
// Chromium:
//   - the backend contract suite (fs/backend-contract.ts) on directory handles, and on the linked
//     backend with its real IndexedDB copy store;
//   - a write that resolved is in the file (read back through a separate handle), also 5 MB;
//     nothing outside the folder is reachable ('..', backslashes, Vfs.resolve);
//   - a file changed or added by "another program" (written through a separate handle) is found by
//     revalidation as 3.8.4 describes it (list the tree, compare size and modification time), also
//     a change that keeps the size, both by the rule itself and through SH6's real CachedSyncFiles;
//   - the time appendFile takes on a 1 kB and on a 20 MB file, printed (errata FS2.md);
//   - in the application: "Open folder..." mounts the folder and the Open dialog shows it; a
//     document opened from it is saved into it; a change made by another program meanwhile brings
//     the documents' "changed outside this window" question, and No leaves the file alone;
//   - after a reload: the folder is not mounted and no permission is asked without a click; the
//     toast offers it; its button asks (once, readwrite, inside the click) and mounts it;
//   - with the engines (engine/dist): a source in the folder is assembled, its .L68 and .S68 land
//     in the real folder, Execute loads the S-record from there, and the program's own file
//     (TRAP #15 tasks 52, 54, 56) reaches the real folder through the simulator's view of the files;
//   - "From this computer..." links a file: the banner with "Open the containing folder..."; Save
//     writes the real file; after a reload the copy serves; Save from a click asks for access and
//     then refuses because another program changed the file meanwhile (message shown, file
//     unchanged); "Open the containing folder..." reopens the document from the folder;
// WebKit (no File System Access API): no provider, no "Open folder..." button, no /folder or
// /linked mount, no handle database, the Open dialog's "From this computer..." is FS1's; no console
// message at all.
//
// Screenshots go to build/FS2/fsaccess-check (git-ignored). Exit code 0 = everything passed.
// The page object `window.__easy68k` exists in development builds only (main.tsx).

/* global console, process, window, document, navigator, indexedDB, DOMException, FileSystemHandle, sessionStorage, performance, setTimeout, clearTimeout, TextEncoder, TextDecoder */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'FS2', 'fsaccess-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const requireEngines = process.env.EASY68K_REQUIRE_ENGINES === '1';
const enginesPresent = existsSync(join(repoRoot, 'engine', 'dist'));
// Assembling and running a program needs both engines.
const bothEngines = ['asm68k.wasm', 'sim68k.wasm'].every((f) => existsSync(join(repoRoot, 'engine', 'dist', f)));

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  detail = String(detail).slice(0, 400);
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const note = (text) => console.log(`  note ${text}`);

// ---- what runs in the page before the application starts --------------------------------------------

/** Helpers for the origin private file system, and the pickers replaced by queued handles. */
function stubPickers() {
  const opfs = async (path, kind = 'dir', create = true) => {
    let dir = await navigator.storage.getDirectory();
    const parts = path.split('/').filter(Boolean);
    const last = kind === 'file' ? parts.pop() : null;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return last === null ? dir : dir.getFileHandle(last, { create });
  };
  const writeOpfs = async (path, text) => {
    const handle = await opfs(path, 'file');
    const writable = await handle.createWritable();
    await writable.write(new TextEncoder().encode(text));
    await writable.close();
    return handle;
  };
  const readOpfs = async (path) => {
    const handle = await opfs(path, 'file', false);
    return new TextDecoder('latin1').decode(await (await handle.getFile()).arrayBuffer());
  };
  window.__fs2 = { opfs, writeOpfs, readOpfs, dirs: [], files: [], dirCalls: [], fileCalls: [] };
  const abort = () => new DOMException('The user aborted a request.', 'AbortError');
  window.showDirectoryPicker = async (options = {}) => {
    window.__fs2.dirCalls.push({ id: options.id, mode: options.mode, startIn: options.startIn?.name ?? null });
    const next = window.__fs2.dirs.shift();
    if (!next) throw abort();
    return opfs(next, 'dir');
  };
  window.showOpenFilePicker = async (options = {}) => {
    window.__fs2.fileCalls.push({ id: options.id, multiple: options.multiple, types: options.types });
    const next = window.__fs2.files.shift();
    if (!next) throw abort();
    return Promise.all(next.map((path) => opfs(path, 'file', false)));
  };
}

/** After a reload, the browser asks again (see the header). Switched on by sessionStorage 'fs2-prompt'. */
function stubPermissions() {
  const proto = FileSystemHandle.prototype;
  const realQuery = proto.queryPermission;
  window.__fs2permission = { requests: [], granted: false };
  proto.queryPermission = async function (descriptor) {
    if (sessionStorage.getItem('fs2-prompt') === '1' && !window.__fs2permission.granted) return 'prompt';
    return realQuery ? realQuery.call(this, descriptor) : 'granted';
  };
  proto.requestPermission = async function (descriptor) {
    window.__fs2permission.requests.push({ mode: descriptor?.mode, active: navigator.userActivation?.isActive });
    if (!navigator.userActivation?.isActive) {
      throw new DOMException('User activation is required to request permissions.', 'SecurityError');
    }
    window.__fs2permission.granted = true;
    return 'granted';
  };
}

// ---- helpers ------------------------------------------------------------------------------------------

async function newContext(browser) {
  return browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
}

function watchConsole(page) {
  const messages = [];
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    if (!requireEngines && !enginesPresent && text.startsWith('Simulator:')) return;
    // Vite's own development messages are not the application's.
    if (/^\[vite\]/.test(text)) return;
    messages.push(`${type}: ${text}`);
  });
  page.on('pageerror', (error) => messages.push(`pageerror: ${String(error)}`));
  return messages;
}

async function openApp(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  const messages = watchConsole(page);
  await page.goto(baseUrl);
  await waitForApp(page);
  return { page, messages };
}

async function waitForApp(page) {
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined);
}

const mounts = (page) => page.evaluate(() => window.__easy68k.ctx.vfs.backends().map((b) => b.mount));

async function until(page, fn, arg, timeout = 15_000) {
  const start = Date.now();
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch (error) {
    // Printed so that a failure can be diagnosed from a CI log: a timeout, or the predicate threw.
    note(`waited ${Date.now() - start} ms in vain: ${String(error?.message ?? error).split('\n')[0]}`);
    return false;
  }
}

/** Opens the port's Open dialog (as File > Open does) and returns its locator. */
async function openDialog(page) {
  await page.evaluate(() => {
    window.__fs2open = window.__easy68k.ctx.fileDialogs.open({
      title: 'Open File',
      filters: [
        { label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] },
        { label: 'Any File  [*.*]', patterns: ['*.*'] },
      ],
      multiple: false,
    });
  });
  const dialog = page.locator('[role=dialog]').filter({ hasText: 'Look in' }).last();
  await dialog.waitFor();
  return dialog;
}

/** The message box whose text contains `text`. */
function messageBox(page, text) {
  return page.locator('[role=dialog], [role=alertdialog]').filter({ hasText: text }).last();
}

/** The text of the active document's editor. */
const editorText = (page) => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');

/** Types into the active editor (no shortcut needed: plain characters at the caret). */
async function typeInEditor(page, text) {
  await page.locator('.cm-content').first().click();
  await page.keyboard.type(text);
  // The document service hears of the change asynchronously; Save before that has nothing to save.
  await until(
    page,
    (typed) => {
      const { documents } = window.__easy68k.ctx;
      const active = documents.active();
      return active !== null && active.modified && documents.text(active.id).includes(typed);
    },
    text,
  );
}

/** Save from the toolbar button: a real click, as a student saves. */
async function saveFromToolbar(page) {
  const button = page.locator('[data-command="ed.file.save"]').first();
  await until(
    page,
    () => !document.querySelector('[data-command="ed.file.save"]')?.matches(':disabled,[aria-disabled=true]'),
  );
  await button.click();
}

// ---- Chromium: the backends on real directory handles ----------------------------------------------------

async function backendPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, messages } = await openApp(context);

  const contract = await page.evaluate(async () => {
    const { BACKEND_CONTRACT_CASES } = await import('/src/fs/backend-contract.ts');
    const { FolderBackend, LinkedBackend, MemoryHandleStore } = await import('/src/fs/fsaccess-backend.ts');
    const { BrowserBackend } = await import('/src/fs/browser-backend.ts');
    const root = await navigator.storage.getDirectory();
    const out = [];
    let n = 0;
    for (const c of BACKEND_CONTRACT_CASES) {
      const dirName = `contract-${n++}`;
      const dir = await root.getDirectoryHandle(dirName, { create: true });
      try {
        await c.run(new FolderBackend(dir));
        out.push({ name: `folder: ${c.name}`, ok: true });
      } catch (error) {
        out.push({ name: `folder: ${c.name}`, ok: false, detail: String(error) });
      } finally {
        await root.removeEntry(dirName, { recursive: true });
      }
      const dbName = `fs2-linked-contract-${n}`;
      const copies = await BrowserBackend.open({ dbName, channel: null });
      try {
        await c.run(new LinkedBackend({ copies, handles: new MemoryHandleStore() }));
        out.push({ name: `linked: ${c.name}`, ok: true });
      } catch (error) {
        out.push({ name: `linked: ${c.name}`, ok: false, detail: String(error) });
      } finally {
        await copies.close();
        await new Promise((done) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = request.onerror = request.onblocked = () => done();
        });
      }
    }
    return out;
  });
  for (const r of contract) check(`${p} contract ${r.name}`, r.ok, r.detail ?? '');

  const durable = await page.evaluate(async () => {
    const { FolderBackend } = await import('/src/fs/fsaccess-backend.ts');
    const { createVfs } = await import('/src/fs/vfs.ts');
    const root = await navigator.storage.getDirectory();
    const backend = new FolderBackend(await root.getDirectoryHandle('durable', { create: true }));
    const big = Uint8Array.from({ length: 5 << 20 }, (_, i) => (i * 7) & 0xff);
    await backend.writeFile('sub/big.bin', big);
    // Read back through handles of our own, as another reader of the disk would.
    const fresh = await (
      await (await navigator.storage.getDirectory()).getDirectoryHandle('durable')
    ).getDirectoryHandle('sub');
    const back = new Uint8Array(await (await (await fresh.getFileHandle('big.bin')).getFile()).arrayBuffer());
    const sameBytes = back.length === big.length && back.every((b, i) => b === big[i]);
    const outside = [];
    for (const rel of ['..', '../x', 'a/../../x', 'a\\..\\x', '/x']) {
      try {
        await backend.writeFile(rel, new Uint8Array(1));
        outside.push(`${rel}: written`);
      } catch (error) {
        if (error.code !== 'invalid-path') outside.push(`${rel}: ${error.code}`);
      }
    }
    const vfs = createVfs();
    vfs.mount(backend);
    const resolved = await vfs.resolve('/folder/sub', '..\\..\\..\\durable\\sub\\big.bin');
    await root.removeEntry('durable', { recursive: true });
    return { sameBytes, outside, resolved };
  });
  check(
    `${p} a 5 MB write that resolved is in the file, byte for byte (read through another handle)`,
    durable.sameBytes,
  );
  check(
    `${p} '..', backslashes and absolute names reach nothing outside the folder`,
    durable.outside.length === 0,
    durable.outside.join('; '),
  );
  check(`${p} Vfs.resolve does not climb out of /folder`, durable.resolved === null, String(durable.resolved));

  const revalidation = await page.evaluate(async () => {
    const { FolderBackend } = await import('/src/fs/fsaccess-backend.ts');
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('reval', { create: true });
    const backend = new FolderBackend(dir);
    const enc = (text) => new TextEncoder().encode(text);
    await backend.writeFile('a.txt', enc('aaaa'));
    await backend.writeFile('same.txt', enc('1111'));
    await backend.writeFile('sub/b.txt', enc('b'));
    // 3.8.4 for /folder: list the tree, re-read every file whose size or modification time changed.
    const fingerprint = async () => {
      const out = new Map();
      const walk = async (rel) => {
        for (const entry of await backend.list(rel)) {
          const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
          if (entry.kind === 'dir') await walk(path);
          else {
            const stat = await backend.stat(path);
            out.set(path, `${stat.size}/${stat.mtime}`);
          }
        }
      };
      await walk('');
      return out;
    };
    const before = await fingerprint();
    await new Promise((r) => setTimeout(r, 20));
    // "Another program": handles of its own, not the backend.
    const other = await (await navigator.storage.getDirectory()).getDirectoryHandle('reval');
    const write = async (d, fileName, text) => {
      const w = await (await d.getFileHandle(fileName, { create: true })).createWritable();
      await w.write(enc(text));
      await w.close();
    };
    await write(other, 'a.txt', 'AAAAAA');
    await write(other, 'same.txt', '2222');
    await write(await other.getDirectoryHandle('sub'), 'c.txt', 'new');
    const after = await fingerprint();
    const changed = [...after]
      .filter(([k, v]) => before.has(k) && before.get(k) !== v)
      .map(([k]) => k)
      .sort();
    const added = [...after.keys()].filter((k) => !before.has(k)).sort();
    const reread = new TextDecoder().decode(await backend.readFile('same.txt'));
    await root.removeEntry('reval', { recursive: true });
    return { changed, added, reread };
  });
  check(
    `${p} revalidation finds the changed files, also one whose size stayed the same`,
    JSON.stringify(revalidation.changed) === JSON.stringify(['a.txt', 'same.txt']),
    JSON.stringify(revalidation.changed),
  );
  check(
    `${p} revalidation finds the added file`,
    JSON.stringify(revalidation.added) === JSON.stringify(['sub/c.txt']),
    JSON.stringify(revalidation.added),
  );
  check(`${p} the re-read gives the other program's bytes`, revalidation.reread === '2222', revalidation.reread);

  // The same with the simulator's real view of the files (SH6's CachedSyncFiles) on /folder.
  const view = await page.evaluate(async () => {
    const { FolderBackend } = await import('/src/fs/fsaccess-backend.ts');
    const { CachedSyncFiles } = await import('/src/fs/sync/cached.ts');
    const { createVfs } = await import('/src/fs/vfs.ts');
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('view', { create: true });
    const vfs = createVfs();
    vfs.mount(new FolderBackend(dir));
    const enc = (text) => new TextEncoder().encode(text);
    await vfs.writeFile('/folder/a.txt', enc('aaaa'));
    await vfs.writeFile('/folder/gone.txt', enc('g'));
    await vfs.writeFile('/folder/sub/b.txt', enc('b'));
    const sync = new CachedSyncFiles({
      vfs,
      scheduler: {
        onFrame: () => () => {},
        setTimer: (ms, fn) => {
          const id = setTimeout(fn, ms);
          return () => clearTimeout(id);
        },
      },
      message: () => {},
    });
    await sync.prepare('/folder');
    const read = (path) => {
      const stat = sync.stat(path);
      return stat ? new TextDecoder().decode(sync.read(path, 0, stat.size)) : null;
    };
    await new Promise((r) => setTimeout(r, 20));
    const other = await (await navigator.storage.getDirectory()).getDirectoryHandle('view');
    const write = async (d, fileName, text) => {
      const w = await (await d.getFileHandle(fileName, { create: true })).createWritable();
      await w.write(enc(text));
      await w.close();
    };
    await write(other, 'a.txt', 'AAAA');
    await write(await other.getDirectoryHandle('sub'), 'c.txt', 'new');
    await other.removeEntry('gone.txt');
    const before = read('/folder/a.txt');
    await sync.revalidate();
    const out = {
      before,
      changed: read('/folder/a.txt'),
      added: read('/folder/sub/c.txt'),
      removed: sync.stat('/folder/gone.txt'),
    };
    sync.dispose();
    await root.removeEntry('view', { recursive: true });
    return out;
  });
  check(
    `${p} SH6's CachedSyncFiles on /folder: revalidate() reads a same-size change, an added file, drops a removed one`,
    view.before === 'aaaa' && view.changed === 'AAAA' && view.added === 'new' && view.removed === null,
    JSON.stringify(view),
  );

  // appendFile: Chromium copies the file for every writable stream that keeps its data (errata FS2.md).
  let best = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = await page.evaluate(async () => {
      const { FolderBackend } = await import('/src/fs/fsaccess-backend.ts');
      const root = await navigator.storage.getDirectory();
      const backend = new FolderBackend(await root.getDirectoryHandle('append', { create: true }));
      const kilobyte = new Uint8Array(1024).fill(65);
      await backend.writeFile('small.bin', kilobyte);
      await backend.writeFile('large.bin', new Uint8Array(20 << 20).fill(66));
      const fastest = async (rel) => {
        let min = Infinity;
        for (let i = 0; i < 6; i++) {
          const start = performance.now();
          await backend.appendFile(rel, kilobyte);
          min = Math.min(min, performance.now() - start);
        }
        return min;
      };
      const small = await fastest('small.bin');
      const large = await fastest('large.bin');
      const size = (await backend.stat('large.bin')).size;
      await root.removeEntry('append', { recursive: true });
      return { small, large, size };
    });
    if (!best || run.small + run.large < best.small + best.large) best = run;
  }
  check(`${p} appendFile keeps every byte of a 20 MB file`, best.size === (20 << 20) + 6 * 1024, String(best.size));
  note(
    `${p} appendFile of 1 kB, best of 3x6: ${best.small.toFixed(1)} ms on a 1 kB file, ${best.large.toFixed(1)} ms on a 20 MB file ` +
      '(Chromium copies the file into its swap file; errata FS2.md, entry 3)',
  );

  check(`${p} backend pass: no console errors or warnings`, messages.length === 0, messages.slice(0, 3).join(' | '));
  await closeWithin(context);
}

// ---- Chromium: the opened folder in the application ------------------------------------------------------

async function folderPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  await context.addInitScript(stubPickers);
  await context.addInitScript(stubPermissions);
  const { page, messages } = await openApp(context);

  await page.evaluate(() => window.__fs2.writeOpfs('course/prog.X68', '* first\r\n\tEND\t$1000\r\n'));
  check(
    `${p} at start /linked is mounted and /folder is not`,
    (await mounts(page)).includes('linked') && !(await mounts(page)).includes('folder'),
    JSON.stringify(await mounts(page)),
  );

  const dialog = await openDialog(page);
  const buttons = await dialog.locator('.e68-filedialog__providers button').allInnerTexts();
  check(
    `${p} the Open dialog shows "From this computer..." and "Open folder..."`,
    JSON.stringify(buttons.map((b) => b.trim())) === JSON.stringify(['From this computer...', 'Open folder...']),
    JSON.stringify(buttons),
  );
  // "From this computer..." links here (FS2's provider), so the note must not say it copies files.
  const chromiumNote = await dialog.locator('.e68-filedialog__note').innerText();
  check(
    `${p} the dialog's note does not say "From this computer..." copies into My Programs`,
    !chromiumNote.includes('/Imported') && chromiumNote.includes('Open folder...'),
    chromiumNote,
  );
  await page.evaluate(() => window.__fs2.dirs.push('course'));
  await dialog.getByRole('button', { name: 'Open folder...' }).click();
  const shown = await until(page, () =>
    [...document.querySelectorAll('[role=dialog] [role=option]')].some((o) => o.textContent.includes('prog.X68')),
  );
  check(
    `${p} "Open folder..." mounts the folder and the dialog lists it`,
    shown && (await mounts(page)).includes('folder'),
  );
  const pickerCall = await page.evaluate(() => window.__fs2.dirCalls[0]);
  check(
    `${p} the folder picker is asked for read and write access`,
    pickerCall?.mode === 'readwrite',
    JSON.stringify(pickerCall),
  );
  const lookIn = await dialog.locator('select').first().inputValue();
  check(`${p} "Look in" shows the folder`, lookIn === '/folder', lookIn);
  await page.screenshot({ path: join(outDir, `${name}-open-folder.png`) });
  await dialog.locator('[role=option]').filter({ hasText: 'prog.X68' }).dblclick();
  const chosen = await page.evaluate(() => window.__fs2open);
  check(
    `${p} the dialog returns the file of the folder`,
    JSON.stringify(chosen) === JSON.stringify(['/folder/prog.X68']),
    JSON.stringify(chosen),
  );

  await page.evaluate(() => window.__easy68k.ctx.documents.open('/folder/prog.X68'));
  await until(page, () => (document.querySelector('.cm-content')?.textContent ?? '').includes('first'));
  await typeInEditor(page, 'ZZ');
  // Save from the toolbar (a real click).
  await saveFromToolbar(page);
  const saved = await until(page, () =>
    window.__fs2.readOpfs('course/prog.X68').then(
      (t) => t.includes('ZZ'),
      () => false,
    ),
  );
  check(`${p} Save writes the document into the real folder`, saved);
  const fileText = await page.evaluate(() => window.__fs2.readOpfs('course/prog.X68'));
  check(
    `${p} ... with CR LF line ends`,
    fileText.includes('\r\n') && !/[^\r]\n/.test(fileText),
    JSON.stringify(fileText.slice(0, 60)),
  );
  await page.screenshot({ path: join(outDir, `${name}-folder-saved.png`) });

  // Another program changes the file; the next Save asks first, and No leaves the file alone.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 30)));
  await page.evaluate(() => window.__fs2.writeOpfs('course/prog.X68', '* changed by another program\r\n'));
  await typeInEditor(page, 'YY');
  await saveFromToolbar(page);
  const question = messageBox(page, 'has been changed outside this window');
  const asked = await question.waitFor({ timeout: 15_000 }).then(
    () => true,
    () => false,
  );
  check(
    `${p} a change by another program brings "'prog.X68' has been changed outside this window. Save anyway?"`,
    asked && (await question.innerText()).includes("'prog.X68' has been changed outside this window. Save anyway?"),
  );
  await page.screenshot({ path: join(outDir, `${name}-folder-changed-outside.png`) });
  if (asked) {
    await question.getByRole('button', { name: 'No' }).click();
    await question.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  }
  check(
    `${p} ... No keeps the document modified`,
    await page.evaluate(() => window.__easy68k.ctx.documents.active()?.modified === true),
  );
  check(
    `${p} ... and No leaves the other program's file as it is`,
    (await page.evaluate(() => window.__fs2.readOpfs('course/prog.X68'))) === '* changed by another program\r\n',
  );

  // Reload: the browser asks again.
  await page.evaluate(() => sessionStorage.setItem('fs2-prompt', '1'));
  await page.reload();
  await waitForApp(page);
  const offer = page.getByRole('button', { name: 'Open folder', exact: true });
  const offered = await offer.waitFor({ timeout: 15_000 }).then(
    () => true,
    () => false,
  );
  check(
    `${p} after a reload the folder is not mounted while the browser asks again`,
    !(await mounts(page)).includes('folder'),
  );
  check(
    `${p} ... a toast offers 'The folder "course" was open the last time. Open it again?'`,
    offered && (await page.getByText('The folder "course" was open the last time. Open it again?').count()) > 0,
  );
  check(
    `${p} ... and nothing is asked without a click`,
    (await page.evaluate(() => window.__fs2permission.requests.length)) === 0,
  );
  await page.screenshot({ path: join(outDir, `${name}-reopen-toast.png`) });
  if (offered) await offer.click();
  const remounted = await until(page, () => window.__easy68k.ctx.vfs.backends().some((b) => b.mount === 'folder'));
  const requests = await page.evaluate(() => window.__fs2permission.requests);
  check(
    `${p} the toast's button asks once for read and write, inside the click, and mounts the folder`,
    remounted && requests.length === 1 && requests[0].mode === 'readwrite' && requests[0].active === true,
    JSON.stringify(requests),
  );
  const reread = await page.evaluate(async () =>
    new TextDecoder().decode(await window.__easy68k.ctx.vfs.readFile('/folder/prog.X68')),
  );
  check(`${p} ... and its files are there`, reread === '* changed by another program\r\n', JSON.stringify(reread));

  check(
    `${p} ... and the Files panel lists it`,
    await page
      .locator('[data-e68-panel="files"] [role=tree]')
      .getByText('Folder: course')
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      ),
  );

  await studentInFolder(page, p, name);

  check(`${p} folder pass: no console errors or warnings`, messages.length === 0, messages.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** A program whose source lies in the opened folder writes a file of its own there (TRAP #15 52, 54, 56). */
const HELLO_SOURCE = [
  '    ORG    $1000',
  'START:',
  '    LEA    NAME,A1',
  '    MOVE.B #52,D0',
  '    TRAP   #15',
  '    LEA    TEXT,A1',
  '    MOVE.L #5,D2',
  '    MOVE.B #54,D0',
  '    TRAP   #15',
  '    MOVE.B #56,D0',
  '    TRAP   #15',
  '    SIMHALT',
  "NAME DC.B 'out.txt',0",
  "TEXT DC.B 'HELLO'",
  '    END    START',
  '',
].join('\r\n');

/**
 * As a student works with the real neighbours: the assembler writes the listing and the S-record
 * beside the source in the opened folder (E5), Execute loads the S-record from there, and the
 * program's own file goes through the simulator's view of the files (SH6) into the real folder.
 */
async function studentInFolder(page, p, name) {
  if (!bothEngines && !requireEngines) {
    note(`${p} engine/dist lacks an engine: assembling and running a program from the folder is skipped`);
    return;
  }
  await page.evaluate((source) => window.__fs2.writeOpfs('course/hello.X68', source), HELLO_SOURCE);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'editor'));
  await page.evaluate(() => window.__easy68k.ctx.documents.open('/folder/hello.X68'));
  await until(page, () => window.__easy68k.ctx.documents.active()?.path === '/folder/hello.X68');
  await page.evaluate(() => void window.__easy68k.ctx.commands.run('ed.project.assemble'));
  const status = page.locator('[role=dialog].e68-asm-status');
  const assembled = await status.waitFor({ timeout: 60_000 }).then(
    () => true,
    () => false,
  );
  const errors = assembled ? await status.locator('[data-e68-count=errors]').innerText() : '?';
  const outputs = await page.evaluate(async () => {
    const out = {};
    for (const file of ['hello.L68', 'hello.S68']) {
      out[file] = await window.__fs2.readOpfs(`course/${file}`).then(
        (t) => t.length,
        () => null,
      );
    }
    return out;
  });
  check(
    `${p} assembling a source of the folder writes hello.L68 and hello.S68 into the real folder`,
    assembled && errors === '0' && outputs['hello.L68'] > 0 && outputs['hello.S68'] > 0,
    `errors ${errors}, ${JSON.stringify(outputs)}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-folder-assembled.png`) });
  if (!assembled) return;
  await status.locator('.e68-dialog__footer').getByRole('button', { name: 'Execute', exact: true }).click();
  const loaded = await until(
    page,
    () => window.__easy68k.ctx.store.getState().sim.program?.path === '/folder/hello.S68',
    undefined,
    60_000,
  );
  check(`${p} Execute loads /folder/hello.S68`, loaded);
  if (!loaded) return;
  await page.evaluate(() => void window.__easy68k.ctx.commands.run('sim.run.run'));
  // The simulator's view writes behind (3.8.4, at most every 500 ms per file); wait for the bytes.
  const started = Date.now();
  const written = await until(
    page,
    () =>
      window.__fs2.readOpfs('course/out.txt').then(
        (t) => t === 'HELLO',
        () => false,
      ),
    undefined,
    30_000,
  );
  note(`${p} out.txt reached the real folder ${Date.now() - started} ms after Run`);
  check(`${p} the program's file out.txt is written into the real folder`, written);
  const listed = await page.evaluate(async () =>
    (await window.__easy68k.ctx.vfs.list('/folder')).map((e) => e.name).sort(),
  );
  check(
    `${p} ... and the folder holds the source, its outputs and the program's file`,
    ['hello.L68', 'hello.S68', 'hello.X68', 'out.txt'].every((f) => listed.includes(f)),
    JSON.stringify(listed),
  );
  await page.screenshot({ path: join(outDir, `${name}-folder-program-ran.png`) });
}

// ---- Chromium: a linked file in the application ----------------------------------------------------------

async function linkedPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  await context.addInitScript(stubPickers);
  await context.addInitScript(stubPermissions);
  const { page, messages } = await openApp(context);

  await page.evaluate(() => window.__fs2.writeOpfs('home/lab1/prog.X68', '* linked\r\n\tEND\t$1000\r\n'));
  const dialog = await openDialog(page);
  await page.evaluate(() => window.__fs2.files.push(['home/lab1/prog.X68']));
  await dialog.getByRole('button', { name: 'From this computer...' }).click();
  const linked = await until(page, () => window.__fs2open.then((r) => Array.isArray(r)));
  const paths = linked ? await page.evaluate(() => window.__fs2open) : null;
  const path = paths?.[0] ?? '';
  check(
    `${p} "From this computer..." links the file as /linked/<id>/prog.X68`,
    /^\/linked\/[0-9a-f]{8}\/prog\.X68$/.test(path),
    JSON.stringify(paths),
  );
  const types = await page.evaluate(() => window.__fs2.fileCalls[0]?.types);
  check(
    `${p} the file picker offers the dialog's filters`,
    JSON.stringify(types) ===
      JSON.stringify([{ description: 'EASy68K Source [.X68]', accept: { 'text/plain': ['.X68'] } }]),
    JSON.stringify(types),
  );
  const banner = page.getByRole('button', { name: 'Open the containing folder...' });
  check(
    `${p} the banner offers "Open the containing folder..."`,
    await banner.waitFor({ timeout: 10_000 }).then(
      () => true,
      () => false,
    ),
  );

  await page.evaluate((target) => window.__easy68k.ctx.documents.open(target), path);
  await until(page, () => (document.querySelector('.cm-content')?.textContent ?? '').includes('linked'));
  // The long caption of 3.8.2 must fit its button and leave the banner's text readable.
  const layout = await page.evaluate(() => {
    const action = [...document.querySelectorAll('.e68-toast__action')].find((b) =>
      b.textContent.includes('Open the containing folder...'),
    );
    const toast = action?.closest('.e68-toast');
    const textBox = toast?.querySelector('.e68-toast__text')?.getBoundingClientRect();
    const box = action?.getBoundingClientRect();
    if (!action || !textBox || !box) return null;
    const overlaps =
      box.left < textBox.right && textBox.left < box.right && box.top < textBox.bottom && textBox.top < box.bottom;
    return { fits: action.scrollWidth <= action.clientWidth + 1, overlaps };
  });
  check(
    `${p} the banner's button holds its whole caption and does not cover the text`,
    layout !== null && layout.fits && !layout.overlaps,
    JSON.stringify(layout),
  );
  await page.screenshot({ path: join(outDir, `${name}-linked-banner.png`) });
  // ARCHITECTURE-PLUS P3.2.5 (N5): the Files panel now lists the linked file by its name under
  // "Opened from this computer", edited in place.
  const listedRow = page.locator(`[data-e68-panel="files"] [role=treeitem][data-e68-path="${path}"]`);
  const listed = await listedRow.waitFor({ timeout: 10_000 }).then(
    () => listedRow.innerText(),
    () => null,
  );
  check(
    `${p} ... and the Files panel lists it by its name under "Opened from this computer"`,
    listed !== null && listed.replace(/\s+/g, ' ').trim() === 'prog.X68 edited in place',
    JSON.stringify(listed),
  );
  // Gate I2 review: the port's internal folder of a linked file is never shown, the status lines
  // included; Editor mode's window status line reads "prog.X68 - on this computer, edited in place"
  // (ARCHITECTURE-PLUS P3.2.5, N8).
  const visible = await page.evaluate(() => ({
    text: document.body.innerText,
    status: document.querySelector('[data-e68-editor-status="path"]')?.textContent ?? null,
  }));
  check(
    `${p} no visible text names /linked/; the status line reads "prog.X68 - on this computer, edited in place"`,
    !visible.text.includes('/linked/') && visible.status === 'prog.X68 - on this computer, edited in place',
    `status ${JSON.stringify(visible.status)}; ` +
      (visible.text.match(/.{0,40}\/linked\/.{0,40}/)?.[0] ?? 'no /linked/ in the text'),
  );
  await typeInEditor(page, 'QQ');
  await saveFromToolbar(page);
  const saved = await until(page, () =>
    window.__fs2.readOpfs('home/lab1/prog.X68').then(
      (t) => t.includes('QQ'),
      () => false,
    ),
  );
  check(`${p} Save writes the real file`, saved);
  // The backend writes the real file first and the copy after it; the Save is over when the
  // document is no longer modified. Reading the copy before that would race with its write.
  await until(page, () => window.__easy68k.ctx.documents.active()?.modified === false);
  const copy = await page.evaluate(
    async (target) =>
      new TextDecoder('latin1').decode(
        await window.__easy68k.ctx.vfs
          .backends()
          .find((b) => b.mount === 'linked')
          .copies.readFile(target.slice(8)),
      ),
    path,
  );
  const real = await page.evaluate(() => window.__fs2.readOpfs('home/lab1/prog.X68'));
  check(`${p} ... and the copy beside the program's outputs`, copy === real, `${copy.length} vs ${real.length}`);

  // Reload: the copy serves; a Save from a click asks for access, finds the other program's change, refuses.
  await page.evaluate(() => sessionStorage.setItem('fs2-prompt', '1'));
  await page.reload();
  await waitForApp(page);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 30)));
  await page.evaluate(() => window.__fs2.writeOpfs('home/lab1/prog.X68', '* edited elsewhere\r\n'));
  // Playwright's page.evaluate() runs with a user gesture, so the document is opened from a timer
  // once the page's transient activation has expired (about 5 s in Chromium; polled, not assumed),
  // and this one evaluate is the only thing that touches the page until the document is open.
  const activationWait = await page.evaluate(
    (target) =>
      new Promise((done, fail) => {
        const start = performance.now();
        const tick = () => {
          const waited = performance.now() - start;
          if (navigator.userActivation?.isActive !== false) {
            if (waited > 60_000) fail(new Error('the user activation did not expire within 60 s'));
            else setTimeout(tick, 100);
            return;
          }
          window.__easy68k.ctx.documents.open(target).then(() => done(Math.round(waited)), fail);
        };
        setTimeout(tick, 100);
      }),
    path,
  );
  note(`${p} the page's user activation expired after ${activationWait} ms; the document was opened then`);
  const fromCopy = await until(page, () => (document.querySelector('.cm-content')?.textContent ?? '').includes('QQ'));
  check(
    `${p} after a reload, without access, the document opens from the copy`,
    fromCopy,
    (await editorText(page)).slice(0, 80),
  );
  check(
    `${p} ... and nothing is asked without a click`,
    (await page.evaluate(() => window.__fs2permission.requests.length)) === 0,
    JSON.stringify(await page.evaluate(() => window.__fs2permission.requests)),
  );
  await typeInEditor(page, 'RR');
  await saveFromToolbar(page);
  const refusal = messageBox(page, 'changed by another program since this window last read it');
  const refused = await refusal.waitFor({ timeout: 15_000 }).then(
    () => true,
    () => false,
  );
  const requests = await page.evaluate(() => window.__fs2permission.requests);
  check(
    `${p} Save from a click asks for read and write access inside the click`,
    requests.some((r) => r.mode === 'readwrite' && r.active === true),
    JSON.stringify(requests),
  );
  check(`${p} ... and refuses to overwrite the other program's change, with a message`, refused);
  // The message names the file itself; the store's internal path (/linked/<id>/...) is not shown.
  const refusalText = refused ? await refusal.innerText() : '';
  check(
    `${p} ... whose text does not show the internal path /linked/<id>/`,
    refused && !refusalText.includes('/linked/') && refusalText.includes('"prog.X68"'),
    refusalText.replace(/\s+/g, ' ').trim(),
  );
  await page.screenshot({ path: join(outDir, `${name}-linked-refused.png`) });
  if (refused) await refusal.getByRole('button', { name: 'OK' }).click();
  check(
    `${p} ... the real file keeps the other program's text`,
    (await page.evaluate(() => window.__fs2.readOpfs('home/lab1/prog.X68'))) === '* edited elsewhere\r\n',
  );

  // "Open the containing folder...": reopen a fresh link of the file and move it into the folder.
  // Close the modified document without saving (not awaited in the page: it asks first).
  await page.evaluate((target) => {
    const { documents } = window.__easy68k.ctx;
    for (const doc of documents.list()) if (doc.path === target) void documents.close(doc.id);
  }, path);
  const discard = messageBox(page, 'prog.X68');
  if (
    await discard.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await discard.getByRole('button', { name: 'No' }).click();
  }
  await until(page, (target) => !window.__easy68k.ctx.documents.list().some((d) => d.path === target), path);
  await page.evaluate(() => {
    window.__fs2.files.push(['home/lab1/prog.X68']);
    window.__fs2.dirs.push('home');
  });
  const dialog2 = await openDialog(page);
  await dialog2.getByRole('button', { name: 'From this computer...' }).click();
  await until(page, () => window.__fs2open.then((r) => Array.isArray(r)));
  const again = (await page.evaluate(() => window.__fs2open))?.[0];
  check(`${p} linking the same file again keeps its folder`, again === path, String(again));
  await page.evaluate((target) => window.__easy68k.ctx.documents.open(target), again);
  await until(page, () => (document.querySelector('.cm-content')?.textContent ?? '').includes('edited elsewhere'));
  await page.getByRole('button', { name: 'Open the containing folder...' }).last().click();
  const moved = await until(page, () => window.__easy68k.ctx.documents.active()?.path === '/folder/lab1/prog.X68');
  check(
    `${p} "Open the containing folder..." reopens the document from the folder`,
    moved,
    String(await page.evaluate(() => window.__easy68k.ctx.documents.active()?.path)),
  );
  check(
    `${p} ... and the Files panel lists the folder`,
    await page
      .locator('[data-e68-panel="files"] [role=tree]')
      .getByText('Folder: home')
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      ),
  );
  await page.screenshot({ path: join(outDir, `${name}-containing-folder.png`) });

  check(`${p} linked pass: no console errors or warnings`, messages.length === 0, messages.slice(0, 3).join(' | '));
  await closeWithin(context);
}

// ---- WebKit: absent without a trace ---------------------------------------------------------------------

async function absentPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, messages } = await openApp(context);
  const api = await page.evaluate(() => ({
    picker: typeof window.showDirectoryPicker,
    opfs: typeof navigator.storage?.getDirectory,
  }));
  check(`${p} the browser has no showDirectoryPicker`, api.picker === 'undefined', JSON.stringify(api));
  check(
    `${p} neither /folder nor /linked is mounted`,
    !(await mounts(page)).some((m) => m === 'folder' || m === 'linked'),
    JSON.stringify(await mounts(page)),
  );
  const dialog = await openDialog(page);
  const buttons = (await dialog.locator('.e68-filedialog__providers button').allInnerTexts()).map((b) => b.trim());
  check(
    `${p} the Open dialog has no "Open folder..." button; "From this computer..." is FS1's import`,
    JSON.stringify(buttons) === JSON.stringify(['From this computer...']),
    JSON.stringify(buttons),
  );
  const noteText = await dialog.locator('.e68-filedialog__note').innerText();
  check(`${p} the dialog's note does not mention Open folder...`, !noteText.includes('Open folder'), noteText);
  await page.screenshot({ path: join(outDir, `${name}-open-dialog.png`) });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const databases = await page.evaluate(async () =>
    indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : null,
  );
  check(
    `${p} no handle or copy database was created`,
    Array.isArray(databases) && !databases.includes('easy68k-fsaccess') && !databases.includes('easy68k-linked'),
    JSON.stringify(databases),
  );
  check(`${p} no console message at all`, messages.length === 0, messages.slice(0, 3).join(' | '));
  await closeWithin(context);
}

// ---- run --------------------------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(outDir, 'vite-cache'),
    // Port 0: the system picks a free one. No file watching and no hot reload: other people's edits
    // must not reload the page in the middle of a check.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        if (name === 'chromium') {
          console.log(`\n[${name}, backends on directory handles]`);
          await backendPass(browser, name);
          console.log(`\n[${name}, opened folder]`);
          await folderPass(browser, name);
          console.log(`\n[${name}, linked file]`);
          await linkedPass(browser, name);
        } else {
          console.log(`\n[${name}, without the File System Access API]`);
          await absentPass(browser, name);
        }
      } catch (error) {
        check(`${name}: the pass ran to the end`, false, String(error?.stack ?? error));
      } finally {
        await doneWith(browser, { last: name === browsers.at(-1) });
      }
    }
  } finally {
    closeAtEnd(server);
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
