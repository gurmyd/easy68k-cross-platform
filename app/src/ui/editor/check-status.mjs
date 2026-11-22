// Browser check of package N8 of the stage of additions (ARCHITECTURE-PLUS P5 N8): the texts of
// Editor mode's window status bar (P3.2.5) and the reload offer of P3.3.10. Owner: N8.
//
//   node app/src/ui/editor/check-status.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright):
//
//   - the status bar of a document in My Programs reads `My Programs/demo/prog.X68` (both browsers);
//   - Chromium (File System Access in the origin private file system, the pickers replaced by
//     functions that hand out its handles, as check-fsaccess.mjs does): a file linked with
//     "From this computer..." reads `lab1.X68 - on this computer, edited in place`, and no visible
//     text names the internal folder /linked/; a document of an opened folder shows the folder's
//     place text (printed), and a change "another program" makes to it is offered a reload when the
//     window regains the focus;
//   - two pages of one browser (two windows of the application): a write of the file through the
//     Vfs in one, as Restore does, offers a reload in the other (toast `"prog.X68" was changed
//     outside this window.`, action `Reload`); nothing changes before Reload, Reload loads the new
//     text; a modified document is not offered a reload and keeps its text.
//
// No key chord is pressed (plain characters are typed at the caret), so the check is the same on
// every system. Screenshots go to build/N8-plus/status-check (git-ignored). Exit code 0 = every
// check passed and no page logged an error or a warning. The page object `window.__easy68k` exists
// in development builds only (main.tsx).

/* global console, process, window, document, navigator, DOMException, TextEncoder, TextDecoder, Event */

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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'N8-plus', 'status-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const requireEngines = process.env.EASY68K_REQUIRE_ENGINES === '1';
const enginesPresent = existsSync(join(repoRoot, 'engine', 'dist', 'sim68k.wasm'));

/** The texts of P3.2.5 and P3.3.10 (features/reload-offer/texts.ts, core/places/texts.ts). */
const CHANGED = (name) => `"${name}" was changed outside this window.`;
const RELOAD = 'Reload';
const LINKED_TEXT = 'lab1.X68 - on this computer, edited in place';
const MY_PROGRAMS_TEXT = 'My Programs/demo/prog.X68';
const FOLDER_TEXT = 'Lab/prog.X68 - in the folder "Lab" on this computer';

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

// ---- what runs in the page before the application starts ------------------------------------------

/** The pickers replaced by queued handles of the origin private file system (check-fsaccess.mjs). */
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
  };
  const readOpfs = async (path) => {
    const handle = await opfs(path, 'file', false);
    return new TextDecoder('latin1').decode(await (await handle.getFile()).arrayBuffer());
  };
  window.__n8 = { opfs, writeOpfs, readOpfs, dirs: [], files: [] };
  const abort = () => new DOMException('The user aborted a request.', 'AbortError');
  window.showDirectoryPicker = async () => {
    const next = window.__n8.dirs.shift();
    if (!next) throw abort();
    return opfs(next, 'dir');
  };
  window.showOpenFilePicker = async () => {
    const next = window.__n8.files.shift();
    if (!next) throw abort();
    return Promise.all(next.map((path) => opfs(path, 'file', false)));
  };
}

// ---- helpers --------------------------------------------------------------------------------------------

async function newContext(browser) {
  return browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
}

function watchConsole(page) {
  const messages = [];
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    if (!requireEngines && !enginesPresent && text.startsWith('Simulator:')) return;
    if (/^\[vite\]/.test(text)) return;
    messages.push(`${type}: ${text}`);
  });
  page.on('pageerror', (error) => messages.push(`pageerror: ${String(error)}`));
  return messages;
}

async function openApp(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(240_000);
  const messages = watchConsole(page);
  await page.goto(baseUrl);
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined);
  // Every toast this page shows, in order (the toasts' store of state/dialogs.ts).
  await page.evaluate(() => {
    const { dialogs } = window.__easy68k.ctx;
    const seen = new Set();
    window.__n8toasts = [];
    const record = () => {
      for (const toast of dialogs.toasts.getState()) {
        if (seen.has(toast.id)) continue;
        seen.add(toast.id);
        window.__n8toasts.push({ text: toast.text, action: toast.action?.label ?? null });
      }
    };
    dialogs.toasts.subscribe(record);
    record();
  });
  return { page, messages };
}

async function until(page, fn, arg, timeout = 20_000) {
  const start = Date.now();
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch (error) {
    note(`waited ${Date.now() - start} ms in vain: ${String(error?.message ?? error).split('\n')[0]}`);
    return false;
  }
}

const statusText = (page) =>
  page.evaluate(() => document.querySelector('[data-e68-editor-status="path"]')?.textContent ?? null);

const editorText = (page) =>
  page.evaluate(() => {
    const { documents } = window.__easy68k.ctx;
    const active = documents.active();
    return active ? documents.text(active.id) : null;
  });

const toastsSeen = (page) => page.evaluate(() => window.__n8toasts);

/** Writes a file through the page's Vfs and opens it as the active document. */
async function openThrough(page, path, text) {
  await page.evaluate(
    async ({ path, text }) => {
      const { vfs, documents } = window.__easy68k.ctx;
      await vfs.writeFile(
        path,
        Uint8Array.from(text, (c) => c.charCodeAt(0)),
      );
      await documents.open(path);
    },
    { path, text },
  );
  return until(page, (target) => window.__easy68k.ctx.documents.active()?.path === target, path);
}

/** The status bar text, once it names something (the store updates the bar asynchronously). */
async function settledStatus(page, wanted) {
  await until(
    page,
    (text) => document.querySelector('[data-e68-editor-status="path"]')?.textContent === text,
    wanted,
    10_000,
  );
  return statusText(page);
}

/** Opens the port's Open dialog (as File > Open does) and returns its locator. */
async function openDialog(page) {
  await page.evaluate(() => {
    window.__n8open = window.__easy68k.ctx.fileDialogs.open({
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

/** The toast on screen with this text, and its action button. */
const toastWith = (page, text) => page.locator('.e68-toast').filter({ hasText: text }).last();

// ---- both browsers: My Programs, and two windows ------------------------------------------------------

async function myProgramsPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, messages } = await openApp(context);
  const opened = await openThrough(page, '/browser/demo/prog.X68', '* in My Programs\r\n\tEND\t$1000\r\n');
  check(`${p} a document of My Programs opens`, opened);
  const shown = await settledStatus(page, MY_PROGRAMS_TEXT);
  check(`${p} its status bar reads "${MY_PROGRAMS_TEXT}"`, shown === MY_PROGRAMS_TEXT, JSON.stringify(shown));
  await page.screenshot({ path: join(outDir, `${name}-my-programs-status.png`) });
  check(
    `${p} My Programs pass: no console errors or warnings`,
    messages.length === 0,
    messages.slice(0, 3).join(' | '),
  );
  await context.close();
}

async function twoWindowsPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const one = await openApp(context);
  const two = await openApp(context);
  const path = '/browser/two/prog.X68';
  const opened = await openThrough(two.page, path, '* before\r\n');
  check(`${p} the second window opens ${path}`, opened);
  await two.page.waitForTimeout(500); // the toasts of opening (none expected) have come
  const before = await toastsSeen(two.page);

  // The first window writes the file through its Vfs, as Earlier Versions' Restore does.
  await one.page.evaluate(
    (target) =>
      window.__easy68k.ctx.vfs.writeFile(
        target,
        Uint8Array.from('* restored\r\n', (c) => c.charCodeAt(0)),
      ),
    path,
  );
  const toast = toastWith(two.page, CHANGED('prog.X68'));
  const offered = await toast.waitFor({ timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  const seen = await toastsSeen(two.page);
  check(
    `${p} the other window offers a reload: "${CHANGED('prog.X68')}" with "${RELOAD}"`,
    offered && seen.slice(before.length).some((t) => t.text === CHANGED('prog.X68') && t.action === RELOAD),
    JSON.stringify(seen),
  );
  check(
    `${p} ... and the first window, which wrote the file, offers nothing`,
    !(await toastsSeen(one.page)).some((t) => t.text === CHANGED('prog.X68')),
    JSON.stringify(await toastsSeen(one.page)),
  );
  const unchanged = await editorText(two.page);
  check(`${p} nothing is reloaded before Reload is chosen`, unchanged === '* before\n', JSON.stringify(unchanged));
  await two.page.screenshot({ path: join(outDir, `${name}-reload-offered.png`) });
  if (offered) {
    await toast.getByRole('button', { name: RELOAD, exact: true }).click();
    const reloaded = await until(two.page, () => {
      const { documents } = window.__easy68k.ctx;
      const active = documents.active();
      return active !== null && documents.text(active.id) === '* restored\n' && !active.modified;
    });
    check(`${p} Reload loads the new text, not modified`, reloaded, JSON.stringify(await editorText(two.page)));
    const editorShows = await two.page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');
    check(`${p} ... and the editor shows it`, editorShows.includes('* restored'), JSON.stringify(editorShows));
    await two.page.screenshot({ path: join(outDir, `${name}-reloaded.png`) });
  }

  // A modified document is left alone: its Save asks (main 3.8.6 rule 3).
  await two.page.locator('.cm-content').first().click();
  await two.page.keyboard.type('QQ');
  const modified = await until(two.page, () => window.__easy68k.ctx.documents.active()?.modified === true);
  check(`${p} the document is modified after typing`, modified);
  const countBefore = (await toastsSeen(two.page)).filter((t) => t.text === CHANGED('prog.X68')).length;
  await one.page.evaluate(
    (target) =>
      window.__easy68k.ctx.vfs.writeFile(
        target,
        Uint8Array.from('* again\r\n', (c) => c.charCodeAt(0)),
      ),
    path,
  );
  // The change reaches the other window within moments (it did above); wait well beyond that.
  const arrived = await until(
    two.page,
    async (target) => {
      const bytes = await window.__easy68k.ctx.vfs.readFile(target);
      return String.fromCharCode(...bytes) === '* again\r\n';
    },
    path,
  );
  await two.page.waitForTimeout(2_000);
  const countAfter = (await toastsSeen(two.page)).filter((t) => t.text === CHANGED('prog.X68')).length;
  const kept = await editorText(two.page);
  check(
    `${p} a modified document is not offered a reload and keeps its text`,
    arrived && countAfter === countBefore && kept.includes('QQ') && kept.includes('restored'),
    `change arrived: ${arrived}; offers ${countBefore} -> ${countAfter}; text ${JSON.stringify(kept)}`,
  );

  const messages = [...one.messages, ...two.messages];
  check(
    `${p} two windows pass: no console errors or warnings`,
    messages.length === 0,
    messages.slice(0, 3).join(' | '),
  );
  await context.close();
}

// ---- Chromium: a linked file and an opened folder -----------------------------------------------------

async function linkedPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  await context.addInitScript(stubPickers);
  const { page, messages } = await openApp(context);

  await page.evaluate(() => window.__n8.writeOpfs('home/course/lab1.X68', '* linked\r\n\tEND\t$1000\r\n'));
  const dialog = await openDialog(page);
  await page.evaluate(() => window.__n8.files.push(['home/course/lab1.X68']));
  await dialog.getByRole('button', { name: 'From this computer...' }).click();
  const linked = await until(page, () => window.__n8open.then((r) => Array.isArray(r)));
  const path = linked ? ((await page.evaluate(() => window.__n8open))?.[0] ?? '') : '';
  check(`${p} "From this computer..." links lab1.X68`, /^\/linked\/[0-9a-f]{8}\/lab1\.X68$/.test(path), path);
  await page.evaluate((target) => window.__easy68k.ctx.documents.open(target), path);
  await until(page, (target) => window.__easy68k.ctx.documents.active()?.path === target, path);
  const shown = await settledStatus(page, LINKED_TEXT);
  check(`${p} the linked file's status bar reads "${LINKED_TEXT}"`, shown === LINKED_TEXT, JSON.stringify(shown));
  const visible = await page.evaluate(() => document.body.innerText);
  check(
    `${p} no visible text names the internal folder /linked/`,
    !visible.includes('/linked/'),
    visible.match(/.{0,40}\/linked\/.{0,40}/)?.[0] ?? 'none',
  );
  await page.screenshot({ path: join(outDir, `${name}-linked-status.png`) });

  // An opened folder: its place text, and a change by another program found on the focus.
  await page.evaluate(() => window.__n8.writeOpfs('Lab/prog.X68', '* in the folder\r\n'));
  const folderDialog = await openDialog(page);
  await page.evaluate(() => window.__n8.dirs.push('Lab'));
  await folderDialog.getByRole('button', { name: 'Open folder...' }).click();
  const mounted = await until(page, () => window.__easy68k.ctx.vfs.backends().some((b) => b.mount === 'folder'));
  check(`${p} "Open folder..." mounts the folder Lab`, mounted);
  await folderDialog
    .getByRole('button', { name: 'Cancel' })
    .click()
    .catch(() => {});
  await page.evaluate(() => window.__easy68k.ctx.documents.open('/folder/prog.X68'));
  await until(page, () => window.__easy68k.ctx.documents.active()?.path === '/folder/prog.X68');
  await until(
    page,
    () => (document.querySelector('[data-e68-editor-status="path"]')?.textContent ?? '').includes('prog.X68'),
    undefined,
    10_000,
  );
  const folderShown = await statusText(page);
  const label = await page.evaluate(() => window.__easy68k.ctx.vfs.backends().find((b) => b.mount === 'folder')?.label);
  // The exact text of P3.2.5 (the backend's label is "Folder: Lab"; the place text leaves out the
  // "Folder: ", docs/requests/N8-folder-place-text.md).
  check(
    `${p} the opened folder's status bar reads ${JSON.stringify(FOLDER_TEXT)}, never /folder/`,
    folderShown === FOLDER_TEXT,
    `${JSON.stringify(folderShown)} (the folder's label is ${JSON.stringify(label)})`,
  );
  await page.screenshot({ path: join(outDir, `${name}-folder-status.png`) });

  const before = (await toastsSeen(page)).length;
  await page.waitForTimeout(50); // a later modification time
  await page.evaluate(() => window.__n8.writeOpfs('Lab/prog.X68', '* changed by git\r\n'));
  // The window regains the focus (an opened folder reports no changes of its own).
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const toast = toastWith(page, CHANGED('prog.X68'));
  const offered = await toast.waitFor({ timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  check(
    `${p} a change of the opened folder's file by another program is offered a reload on the focus`,
    offered &&
      (await toastsSeen(page)).slice(before).some((t) => t.text === CHANGED('prog.X68') && t.action === RELOAD),
    JSON.stringify(await toastsSeen(page)),
  );
  if (offered) {
    await toast.getByRole('button', { name: RELOAD, exact: true }).click();
    const reloaded = await until(page, () => {
      const { documents } = window.__easy68k.ctx;
      const active = documents.active();
      return active !== null && documents.text(active.id) === '* changed by git\n';
    });
    check(`${p} ... and Reload loads it`, reloaded, JSON.stringify(await editorText(page)));
    await page.screenshot({ path: join(outDir, `${name}-folder-reloaded.png`) });
  }

  check(
    `${p} linked and folder pass: no console errors or warnings`,
    messages.length === 0,
    messages.slice(0, 3).join(' | '),
  );
  await context.close();
}

// ---- run ----------------------------------------------------------------------------------------------

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
        console.log(`\n[${name}, My Programs]`);
        await myProgramsPass(browser, name);
        console.log(`\n[${name}, two windows]`);
        await twoWindowsPass(browser, name);
        if (name === 'chromium') {
          console.log(`\n[${name}, a linked file and an opened folder]`);
          await linkedPass(browser, name);
        } else {
          note(`${name}: no File System Access API, so no linked file or opened folder (Chromium checks them)`);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
