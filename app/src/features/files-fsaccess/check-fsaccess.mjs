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
//     a change that keeps the size; the stub CachedSyncFiles of SH6 is not used (see the result);
//   - the time appendFile takes on a 1 kB and on a 20 MB file, printed (errata FS2.md);
//   - in the application: "Open folder..." mounts the folder and the Open dialog shows it; a
//     document opened from it is saved into it; a change made by another program meanwhile brings
//     the documents' "changed outside this window" question, and No leaves the file alone;
//   - after a reload: the folder is not mounted and no permission is asked without a click; the
//     toast offers it; its button asks (once, readwrite, inside the click) and mounts it;
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

/* global console, process, window, document, navigator, indexedDB, DOMException, FileSystemHandle, sessionStorage, performance, setTimeout, TextEncoder, TextDecoder */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'FS2', 'fsaccess-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const requireEngines = process.env.EASY68K_REQUIRE_ENGINES === '1';
const enginesPresent = existsSync(join(repoRoot, 'engine', 'dist'));

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
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
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
  await context.close();
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
  const saved = await until(page, () => window.__fs2.readOpfs('course/prog.X68').then((t) => t.includes('ZZ')));
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
  if (asked) await question.getByRole('button', { name: 'No' }).click();
  await page.waitForTimeout(300);
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

  check(`${p} folder pass: no console errors or warnings`, messages.length === 0, messages.slice(0, 3).join(' | '));
  await context.close();
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
  await page.screenshot({ path: join(outDir, `${name}-linked-banner.png`) });
  await typeInEditor(page, 'QQ');
  await saveFromToolbar(page);
  const saved = await until(page, () => window.__fs2.readOpfs('home/lab1/prog.X68').then((t) => t.includes('QQ')));
  check(`${p} Save writes the real file`, saved);
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
  // that fires after the page's transient activation has expired (5 s in Chromium), and nothing
  // else touches the page meanwhile.
  await page.evaluate((target) => {
    setTimeout(() => void window.__easy68k.ctx.documents.open(target), 6_500);
  }, path);
  await page.waitForTimeout(9_000);
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
  await context.close();
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
  await context.close();
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
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
