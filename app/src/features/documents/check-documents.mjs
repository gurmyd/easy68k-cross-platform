// Browser check of work package E1 (documents): what the unit tests under Node can reach only
// through fakes (ARCHITECTURE.md 3.9, 3.9.4, 3.8.5, 1.3.3; editor-ui §1.3, §6, §20.2). Owner: E1.
//
//   node app/src/features/documents/check-documents.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright), with the real document service, editor, file dialogs, drop
// handling and browser store:
//
//   - the application starts with one document `untitled1.x68` holding the template;
//   - text typed in the editor reaches the document: Modified is set, and Save As writes the typed
//     text with the trailer and clears Modified; DocumentService.selection follows the editor's
//     caret and selection;
//   - Save As onto an existing name asks `File exists! OK to overwrite?` (title `Caution!`); No
//     leaves the document unnamed and the file as it was, Yes writes it;
//   - two files dropped on the window open as two documents, in the order of the drop;
//   - Exit with two modified documents: No for the first and Cancel for the second leaves both open,
//     the first still with its edits (editor-ui §1.3);
//   - the unload guard: closing the page while a document is modified raises the browser's
//     "leave site?" question; with nothing modified it does not;
//   - drafts in the browser's real IndexedDB under the real Web Locks: a second window does not
//     offer the drafts of a window that is still open; after that window is gone (closed without
//     its unload handlers, as in a crash) a new window offers them with the exact text, Escape does
//     not dismiss the offer, and Restore brings the document back, modified, with its text;
//   - opening a binary file (ARCHITECTURE-PLUS P3.4.1, N6): the viewer takes it when the dock
//     accepts transient panels, `{ asText: true }` opens it as a document, and with the viewer
//     switched off it opens as text;
//   - drafts held by a read-write transaction that never ends (what a page that died while writing
//     its drafts can leave; E1 errata entry 22): the next page says within 20 s that drafts are
//     off, offers nothing and goes on working; once the transaction has ended a new page offers the
//     draft kept before;
//   - an accessibility scan (axe-core) of the drafts offer, the close prompt and the drafts-off notice;
//   - no console errors.
//
// Screenshots go to build/E1/documents-check (git-ignored). Exit code 0 = everything passed.
// The page object `window.__easy68k` exists in development builds only (main.tsx).

/* global console, process, window, document, indexedDB, navigator, performance, setTimeout, DataTransfer, DragEvent, File, Navigator, TextEncoder */

import { mkdirSync, writeFileSync } from 'node:fs';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'E1', 'documents-check')));
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

/** The Windows key map on every machine, so that the result does not depend on the runner. */
function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendWindows);
  return context;
}

async function openApp(context) {
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
  return { page, errors };
}

/** The documents as the store shows them: [name, modified, path]. */
const documentsOf = (page) =>
  page.evaluate(() =>
    window.__easy68k.ctx.store.getState().documents.items.map((doc) => [doc.name, doc.modified, doc.path]),
  );
const activeText = (page) =>
  page.evaluate(() => {
    const { documents } = window.__easy68k.ctx;
    const active = documents.active();
    return active ? documents.text(active.id) : null;
  });
const readFile = (page, path) =>
  page.evaluate(
    async (p) => Array.from(await window.__easy68k.ctx.vfs.readFile(p), (b) => String.fromCharCode(b)).join(''),
    path,
  );
const writeFile = (page, path, text) =>
  page.evaluate(([p, t]) => window.__easy68k.ctx.vfs.writeFile(p, new TextEncoder().encode(t)), [path, text]);

/** Types into the editor of the active document (the real editor component, E2). */
async function typeInEditor(page, text) {
  const content = page.locator('[data-e68-panel="editor"] .cm-content').first();
  await content.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type(text);
}

/** Starts a command without waiting for it (it may open dialogs). */
const startCommand = (page, id) =>
  page.evaluate((commandId) => {
    window.__commandDone = false;
    void window.__easy68k.ctx.commands.run(commandId).finally(() => {
      window.__commandDone = true;
    });
  }, id);
const commandDone = (page) => page.waitForFunction(() => window.__commandDone === true);

const messageBox = (page) => page.locator('[role=alertdialog]').last();

async function scan(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: no serious finding`,
    serious.length === 0,
    serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`).join('; '),
  );
}

// ---- passes -------------------------------------------------------------------------------------

/** Start-up, typing, Save As with the overwrite question, drop, Exit with Cancel, unload guard. */
async function documentsPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);

  const start = await documentsOf(page);
  check(`${p} start: one document untitled1.x68, not modified`, same(start, [['untitled1.x68', false, null]]));
  const template = await activeText(page);
  check(`${p} start: the document holds the template`, typeof template === 'string' && template.length > 100);

  // Typing reaches the document.
  await typeInEditor(page, 'ABC');
  await page.waitForFunction(() => window.__easy68k.ctx.documents.active()?.modified === true).catch(() => {});
  check(`${p} typing in the editor sets Modified`, (await documentsOf(page))[0]?.[1] === true);
  check(`${p} typing in the editor changes the document's text`, (await activeText(page))?.startsWith('ABC') === true);

  // DocumentService.selection follows the editor's caret and selection (F1, editor-ui §15.3).
  const selectionOf = () =>
    page.evaluate(() => {
      const { documents } = window.__easy68k.ctx;
      return documents.selection(documents.active().id);
    });
  check(
    `${p} selection: the caret after typing`,
    same(await selectionOf(), { selected: '', caret: 3 }),
    JSON.stringify(await selectionOf()),
  );
  await page.keyboard.press('Shift+Home');
  check(
    `${p} selection: Shift+Home selects the typed text, caret at 0`,
    same(await selectionOf(), { selected: 'ABC', caret: 0 }),
    JSON.stringify(await selectionOf()),
  );
  await page.keyboard.press('End');

  // Save As onto an existing name: the real Save As dialog asks before overwriting.
  await writeFile(page, '/browser/existing.X68', 'OLD\r\n');
  await startCommand(page, 'ed.file.saveAs');
  const dialog = page.locator('[role=dialog][aria-modal=true]').last();
  await dialog.getByLabel('File name:').waitFor();
  await dialog.getByLabel('File name:').fill('existing');
  await dialog.getByRole('button', { name: 'Save' }).click();
  const box = messageBox(page);
  await box.waitFor();
  const boxText = (await box.innerText()).replace(/\s+/g, ' ');
  check(
    `${p} Save As onto an existing name asks "File exists! OK to overwrite?" (Caution!)`,
    boxText.includes('Caution!') && boxText.includes('File exists! OK to overwrite?'),
    boxText,
  );
  await page.screenshot({ path: join(outDir, `${name}-save-as-overwrite.png`) });
  await box.getByRole('button', { name: 'No' }).click();
  await commandDone(page);
  check(`${p} Save As, No: the file is unchanged`, (await readFile(page, '/browser/existing.X68')) === 'OLD\r\n');
  check(
    `${p} Save As, No: the document keeps its name and stays modified`,
    same((await documentsOf(page))[0], ['untitled1.x68', true, null]),
  );

  await startCommand(page, 'ed.file.saveAs');
  await dialog.getByLabel('File name:').waitFor();
  await dialog.getByLabel('File name:').fill('existing');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await box.waitFor();
  await box.getByRole('button', { name: 'Yes' }).click();
  await commandDone(page);
  const saved = await readFile(page, '/browser/existing.X68');
  check(
    `${p} Save As, Yes: the typed text and the trailer are written with CR LF`,
    saved.startsWith('ABC') &&
      saved.endsWith('\r\n*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~\r\n') &&
      !/[^\r]\n/.test(saved),
    JSON.stringify(saved.slice(-90)),
  );
  check(
    `${p} Save As, Yes: the document is existing.X68 and not modified`,
    same((await documentsOf(page))[0], ['existing.X68', false, '/browser/existing.X68']),
    JSON.stringify(await documentsOf(page)),
  );

  // Two files dropped on the window open as two documents, in the order of the drop.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['ZETA\r\n'], 'zeta.X68', { type: 'text/plain' }));
    dt.items.add(new File(['ALPHA\r\n'], 'alpha.X68', { type: 'text/plain' }));
    const target = document.querySelector('[data-e68-panel="editor"]') ?? document.body;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page
    .waitForFunction(() => window.__easy68k.ctx.store.getState().documents.items.length === 3, null, {
      timeout: 15_000,
    })
    .catch(() => {});
  const afterDrop = await documentsOf(page);
  check(
    `${p} drop of two files: both open, in the order of the drop`,
    same(
      afterDrop.slice(1).map(([docName]) => docName),
      ['zeta.X68', 'alpha.X68'],
    ),
    JSON.stringify(afterDrop),
  );
  check(`${p} drop: the last dropped file is the active document`, (await activeText(page)) === 'ALPHA\n');
  await page.screenshot({ path: join(outDir, `${name}-after-drop.png`) });

  // Exit: No for the first modified document, Cancel for the second: nothing closes.
  await page.evaluate(() => {
    const { documents } = window.__easy68k.ctx;
    for (const doc of documents.list().slice(1))
      documents.registry.dispatch(doc.id, { changes: { from: 0, insert: '*' } });
  });
  await startCommand(page, 'ed.file.exit');
  await box.waitFor();
  const firstPrompt = (await box.innerText()).replace(/\s+/g, ' ');
  check(
    `${p} Exit: the close prompt names the first modified document`,
    firstPrompt.includes("File modified, do you wish to save 'zeta.X68' before closing?"),
    firstPrompt,
  );
  await page.screenshot({ path: join(outDir, `${name}-exit-prompt.png`) });
  await scan(page, `${name} close prompt`);
  await box.getByRole('button', { name: 'No' }).click();
  await page.waitForFunction(() => document.querySelector('[role=alertdialog]')?.textContent?.includes('alpha.X68'));
  await messageBox(page).getByRole('button', { name: 'Cancel' }).click();
  await commandDone(page);
  const afterExit = await documentsOf(page);
  check(
    `${p} Exit, No then Cancel: every document stays open, the first with its edits`,
    same(afterExit, [
      ['existing.X68', false, '/browser/existing.X68'],
      ['zeta.X68', true, '/browser/Imported/zeta.X68'],
      ['alpha.X68', true, '/browser/Imported/alpha.X68'],
    ]),
    JSON.stringify(afterExit),
  );
  check(
    `${p} Exit cancelled: the exit screen is not shown`,
    (await page.getByText('You can close this tab.').count()) === 0,
  );

  // Unload guard: modified documents -> the browser asks; nothing modified -> it does not.
  let asked = 0;
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') asked++;
    void d.dismiss().catch(() => {});
  });
  await page.close({ runBeforeUnload: true });
  for (let i = 0; i < 100 && asked === 0; i++) await new Promise((r) => setTimeout(r, 100));
  check(
    `${p} unload guard: closing with modified documents raises "leave site?"`,
    asked === 1 && !page.isClosed(),
    `asked ${asked}`,
  );
  // Undo the edits (back to the saved text clears Modified) and close again.
  await page.evaluate(() => {
    const { documents } = window.__easy68k.ctx;
    for (const doc of documents.list().slice(1)) documents.registry.dispatch(doc.id, { changes: { from: 0, to: 1 } });
  });
  const unmodified = (await documentsOf(page)).every(([, modified]) => !modified);
  check(`${p} undoing to the saved text clears Modified`, unmodified);
  check(`${p} no console errors`, errors.length === 0, errors.join(' | '));
  const closing = page.waitForEvent('close', { timeout: 15_000 }).then(
    () => true,
    () => page.isClosed(),
  );
  await page.close({ runBeforeUnload: true });
  const closed = await closing;
  check(
    `${p} unload guard: with nothing modified the page closes without a question`,
    closed && asked === 1,
    `asked ${asked}`,
  );
  await closeWithin(context);
}

/** Drafts in the real IndexedDB under the real Web Locks (3.9.4). */
async function draftsPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const first = await openApp(context);
  await typeInEditor(first.page, 'DRAFT ');
  // The draft is written two seconds after the last change.
  const draftCount = () =>
    first.page.evaluate(
      () =>
        new Promise((resolveCount) => {
          const open = indexedDB.open('easy68k.drafts', 1);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('drafts')) return resolveCount(0);
            const req = db.transaction('drafts', 'readonly').objectStore('drafts').count();
            req.onsuccess = () => {
              resolveCount(req.result);
              db.close();
            };
            req.onerror = () => resolveCount(-1);
          };
          open.onerror = () => resolveCount(-1);
        }),
    );
  let count = 0;
  for (let i = 0; i < 60 && count < 1; i++) {
    await first.page.waitForTimeout(500);
    count = await draftCount();
  }
  check(`${p} drafts: a modified document is written to IndexedDB easy68k.drafts`, count === 1, `records ${count}`);

  // A second window while the first is alive: no offer.
  const second = await openApp(context);
  // The second window's check is over when its lock easy68k.drafts.check.<windowId> is gone (it
  // waits up to 3 s for a window that may have just ended; E1 errata entry 21), and no window offers.
  await second.page.waitForFunction(
    async () =>
      ((await navigator.locks.query()).held ?? []).every((lock) => !lock.name?.startsWith('easy68k.drafts.check.')),
    null,
    { timeout: 30_000, polling: 100 },
  );
  await second.page.evaluate(() => navigator.locks.request('easy68k.drafts.offer', () => {}));
  check(
    `${p} drafts: a second window does not offer the drafts of a window that is still open`,
    (await second.page.getByText('Unsaved changes from your last session').count()) === 0,
  );
  check(`${p} drafts: no console errors in the second window`, second.errors.length === 0, second.errors.join(' | '));
  await second.page.close({ runBeforeUnload: false });

  // The first window goes away without its unload handlers (as in a crash).
  check(`${p} drafts: no console errors in the first window`, first.errors.length === 0, first.errors.join(' | '));
  await first.page.close({ runBeforeUnload: false });

  const third = await openApp(context);
  const offer = third.page.locator('[role=alertdialog]', { hasText: 'Unsaved changes' });
  const shown = await offer
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(`${p} drafts: a new window offers the drafts of the window that is gone`, shown);
  if (shown) {
    const text = (await offer.innerText()).replace(/\s+/g, ' ');
    check(
      `${p} drafts: the offer's title and text`,
      text.includes('EASy68K') && text.includes('Unsaved changes from your last session were found for untitled1.x68.'),
      text,
    );
    check(
      `${p} drafts: the buttons Restore and Discard`,
      (await offer.getByRole('button', { name: 'Restore' }).count()) === 1 &&
        (await offer.getByRole('button', { name: 'Discard' }).count()) === 1,
    );
    await third.page.screenshot({ path: join(outDir, `${name}-drafts-offer.png`) });
    await scan(third.page, `${name} drafts offer`);
    await third.page.keyboard.press('Escape');
    await third.page.waitForTimeout(300);
    check(`${p} drafts: Escape does not dismiss the offer`, (await offer.count()) === 1);
    await offer.getByRole('button', { name: 'Restore' }).click();
    await third.page
      .waitForFunction(() => window.__easy68k.ctx.store.getState().documents.items.length === 2)
      .catch(() => {});
    const docs = await documentsOf(third.page);
    const restoredText = await activeText(third.page);
    check(
      `${p} drafts: Restore brings the document back, modified, under a free untitled name`,
      same(docs, [
        ['untitled1.x68', false, null],
        ['untitled2.x68', true, null],
      ]),
      JSON.stringify(docs),
    );
    check(`${p} drafts: the restored document has the typed text`, restoredText?.startsWith('DRAFT ') === true);
    await third.page.screenshot({ path: join(outDir, `${name}-drafts-restored.png`) });
  }
  check(`${p} drafts: no console errors in the new window`, third.errors.length === 0, third.errors.join(' | '));
  await third.page.close({ runBeforeUnload: false });
  await closeWithin(context);
}

/**
 * Opening a binary file (ARCHITECTURE-PLUS P3.4.1; this pass is N6's): with the viewer on and a dock
 * that accepts transient panels, open() shows the viewer and opens no document; `{ asText: true }`
 * opens it as a document; with the viewer off it opens as text, as in the original.
 */
async function binaryPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  await page.evaluate(() =>
    window.__easy68k.ctx.vfs.writeFile('/browser/data.bin', Uint8Array.of(0x7f, 0x45, 0x4c, 0x46, 0, 1, 0, 2)),
  );
  const accepts = await page.evaluate(async () => {
    const { dockOf } = await import('/src/state/dock.ts');
    return dockOf(window.__easy68k.ctx).acceptsTransient();
  });
  const opened = await page.evaluate(async () => {
    const doc = await window.__easy68k.ctx.documents.open('/browser/data.bin');
    return doc ? doc.path : null;
  });
  if (accepts) {
    check(`${p} binary file: open() hands it to the viewer and opens no document`, opened === null, `${opened}`);
    const shown = await page
      .locator('[data-e68-panel^="viewer:"]', { hasText: 'does not look like text' })
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check(`${p} binary file: the viewer shows its notice`, shown);
    await page.screenshot({ path: join(outDir, `${name}-binary-viewer.png`) });
  } else {
    check(`${p} binary file without a dock for viewers: it opens as text`, opened === '/browser/data.bin', `${opened}`);
  }
  const asText = await page.evaluate(async () => {
    const doc = await window.__easy68k.ctx.documents.open('/browser/data.bin', { asText: true });
    return doc ? [doc.name, doc.path, doc.kind] : null;
  });
  check(
    `${p} binary file: open(path, { asText: true }) opens it as a document`,
    same(asText, ['data.bin', '/browser/data.bin', 'source']),
    JSON.stringify(asText),
  );
  const switchedOff = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    ctx.settings.update((s) => ({ ...s, app: { ...s.app, plus: { viewer: false, history: true } } }));
    await ctx.vfs.writeFile('/browser/other.bin', Uint8Array.of(1, 0, 2));
    const doc = await ctx.documents.open('/browser/other.bin');
    return doc ? doc.path : null;
  });
  check(
    `${p} binary file with the viewer switched off: it opens as text`,
    switchedOff === '/browser/other.bin',
    `${switchedOff}`,
  );
  check(`${p} binary file: no console errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

/**
 * What a page that died in the middle of writing its drafts can leave behind (E1 errata entry 22;
 * FS1 entry 29 for the browser store): a read-write transaction on the drafts store that the browser
 * does not end. Here another page holds one open, with a torn draft in it, by asking for a record
 * each time the last one answered; before that it leaves a complete draft of a window that is gone.
 * The next page must say within DRAFTS_TIMEOUT_MS (20 s) of its start that drafts are off, offer
 * nothing and go on working; once the transaction has ended, a new page offers the complete draft.
 * Before the repair the next page said nothing and its check of drafts never ended.
 */
async function heldDraftsPass(browser, name) {
  const p = `${name}:`;
  const DRAFTS_TIMEOUT_MS = 20_000; // features/documents/drafts.ts
  const context = await newContext(browser);
  const holder = await openApp(context);
  await typeInEditor(holder.page, 'GONE ');
  // The holder's draft is written two seconds after the last change.
  const countDrafts = () =>
    holder.page.evaluate(
      () =>
        new Promise((resolveCount) => {
          const open = indexedDB.open('easy68k.drafts', 1);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('drafts')) return (resolveCount(0), db.close());
            const req = db.transaction('drafts', 'readonly').objectStore('drafts').count();
            req.onsuccess = () => (resolveCount(req.result), db.close());
            req.onerror = () => (resolveCount(-1), db.close());
          };
          open.onerror = () => resolveCount(-1);
        }),
    );
  let count = 0;
  for (let i = 0; i < 60 && count < 1; i++) {
    await holder.page.waitForTimeout(500);
    count = await countDrafts();
  }
  check(`${p} drafts held for ever: the holder's draft is written first`, count === 1, `records ${count}`);
  // The holder's draft, copied as the draft of a window that is gone; then the held transaction.
  await holder.page.evaluate(
    () =>
      new Promise((resolveHeld, reject) => {
        const open = indexedDB.open('easy68k.drafts', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const copy = db.transaction('drafts', 'readwrite');
          const all = copy.objectStore('drafts').getAll();
          all.onsuccess = () => {
            const [record] = all.result;
            if (!record) return reject(new Error('the holder has no draft'));
            copy.objectStore('drafts').put({ ...record, windowId: 'gone-window', key: `gone-window/${record.docId}` });
          };
          copy.onerror = () => reject(copy.error);
          copy.oncomplete = () => {
            const tx = db.transaction('drafts', 'readwrite');
            const store = tx.objectStore('drafts');
            store.put({
              key: 'dead/torn',
              windowId: 'dead',
              docId: 'torn',
              order: 0,
              state: null,
              text: '',
              mtime: null,
            });
            const hold = { alive: true, tx, ended: new Promise((end) => (tx.onabort = tx.oncomplete = end)) };
            window.__holdDrafts = hold;
            const spin = () => {
              store.get('dead/torn').onsuccess = () => {
                if (hold.alive) spin();
              };
            };
            spin();
            resolveHeld();
          };
        };
      }),
  );

  const next = await openApp(context);
  const notice = next.page.getByText('NOT being kept as drafts');
  const shown = await notice
    .first()
    .waitFor({ timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  const sinceStart = Math.round(await next.page.evaluate(() => performance.now()));
  check(
    `${p} drafts held by a transaction that never ends: the next page says within the 20 s limit that drafts are off`,
    shown && sinceStart <= DRAFTS_TIMEOUT_MS + 10_000,
    shown ? `shown ${sinceStart} ms after the page started` : `no notice after ${sinceStart} ms`,
  );
  const text = shown ? (await notice.first().innerText()).replace(/\s+/g, ' ') : '';
  check(
    `${p} drafts held for ever: the notice's text`,
    text.includes(
      'Unsaved changes are NOT being kept as drafts in this window: the browser did not answer ' +
        '(reading the drafts took longer than 20 s; another tab of this site may be holding the storage). ' +
        'Save your work to keep it. Drafts kept before stay for a later start.',
    ),
    text,
  );
  const checking = await next.page.evaluate(async () =>
    ((await navigator.locks.query()).held ?? [])
      .map((lock) => lock.name)
      .filter((lockName) => lockName?.startsWith('easy68k.drafts.')),
  );
  check(
    `${p} drafts held for ever: the check of drafts has ended and nothing is offered`,
    checking.length === 0 && (await next.page.getByText('Unsaved changes from your last session').count()) === 0,
    `drafts locks held: ${JSON.stringify(checking)}`,
  );
  await typeInEditor(next.page, 'STILL ');
  check(
    `${p} drafts held for ever: the editor goes on working`,
    (await documentsOf(next.page))[0]?.[1] === true && (await activeText(next.page))?.startsWith('STILL ') === true,
  );
  await next.page.screenshot({ path: join(outDir, `${name}-drafts-held.png`) });
  if (shown) await scan(next.page, `${name} drafts off notice`);
  check(`${p} drafts held for ever: no console errors`, next.errors.length === 0, next.errors.join(' | '));
  await next.page.close({ runBeforeUnload: false });

  // The browser ends the dead page's transaction: a new page is offered the complete draft.
  await holder.page.evaluate(async () => {
    window.__holdDrafts.alive = false;
    window.__holdDrafts.tx.abort();
    await window.__holdDrafts.ended;
  });
  const after = await openApp(context);
  const offer = after.page.locator('[role=alertdialog]', { hasText: 'Unsaved changes' });
  const offered = await offer
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const offerText = offered ? (await offer.innerText()).replace(/\s+/g, ' ') : '';
  check(
    `${p} drafts held for ever: once the transaction has ended, a new page offers the draft kept before`,
    offerText.includes('Unsaved changes from your last session were found for untitled1.x68.') &&
      (await after.page.getByText('NOT being kept as drafts').count()) === 0,
    offerText || 'no offer',
  );
  await after.page.screenshot({ path: join(outDir, `${name}-drafts-held-ended.png`) });
  if (offered) await offer.getByRole('button', { name: 'Discard' }).click();
  check(`${p} drafts held for ever: no console errors after`, after.errors.length === 0, after.errors.join(' | '));
  check(
    `${p} drafts held for ever: no console errors in the holder`,
    holder.errors.length === 0,
    holder.errors.join(' | '),
  );
  await after.page.close({ runBeforeUnload: false });
  await holder.page.close({ runBeforeUnload: false });
  await closeWithin(context);
}

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
        for (const [label, pass] of [
          ['documents', documentsPass],
          ['drafts', draftsPass],
          ['binary', binaryPass],
          ['drafts held by a transaction that never ends', heldDraftsPass],
        ]) {
          console.log(`\n[${name}, ${label}]`);
          try {
            await pass(browser, name);
          } catch (error) {
            check(`${name}: the ${label} pass ran to the end`, false, String(error?.stack ?? error).slice(0, 400));
          }
        }
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
