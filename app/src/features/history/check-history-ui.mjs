// Browser check of the Earlier Versions and Trash dialogs (ARCHITECTURE-PLUS P3.3.8; the browser
// items of P5 N4). Owner: N4.
//
//   node app/src/features/history/check-history-ui.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Part 1 starts the Vite development server of app/ on a free port and drives the real application
// in headless Chromium and WebKit (Playwright), in the light and the dark theme:
//
//   - a file is opened and saved twice through the document service, so that the history records
//     `As opened` and `Saved` versions from DocumentService.onWritten (never from the Vfs);
//   - Earlier Versions (ed.file.history): every control is reached with Tab and Shift+Tab (the focus
//     order is printed), the list is operated with the arrows, `Restore` with Enter writes the
//     chosen version and reloads the open document, `Open as New Document` with Enter opens it as a
//     new document, Esc closes the dialog;
//   - the comparison marks every deleted line `-` (left) and every inserted line `+` (right); below
//     700 px of dialog width it is the unified view, with the same marks;
//   - Trash (app.files.trash), with items deleted through ctx.history.guard as the Files panel does:
//     every control reached with Tab, Shift+Down extends the selection, Enter on `Restore` restores
//     the selected items, Enter on `Delete for Good` and on `Empty Trash` asks (the question opens
//     with the focus on `No`; Shift+Tab and Enter answer `Yes`) and drops; Esc closes;
//   - the questions that cannot be undone (Delete for Good, Empty Trash, and Delete History and
//     Trash with a damaged database) open with the focus on `No`, and Enter leaves every Trash item,
//     earlier version and record in place (decided by the architect, errata N4);
//   - a slow open (errata N3): while a first window keeps the history database busy, a second
//     window's Trash dialog shows the text of P3.3.7, and lists the Trash by itself once the first
//     window lets go;
//   - an axe scan (WCAG 2.0/2.1 A and AA) of both dialogs in both themes; no console or page error.
//
// Part 2 makes a production build of app/ (vite build into the output folder; the service worker is
// written by the build), serves it with a static server of its own on a free port, and in both
// browsers: the merge view's chunk is not part of the first load (no modulepreload of it), the
// service worker precaches it, and after the first visit, with the network off (Playwright's
// offline mode and a server that refuses every connection), the chunk loads and draws a comparison
// with its marks.
//
// Keys are pressed as on the system the check runs on: the dialogs' keys (Tab, arrows, Enter, Esc)
// are the same everywhere; the Trash list's Ctrl (macOS Option) chords follow process.platform.
// Screenshots go to <out> (default build/history-ui-check, git-ignored). Prints "N of M checks
// passed"; exit code 0 = everything passed.

/* global console, process, document, window, navigator, caches, indexedDB, setTimeout, TextEncoder, URL -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
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
/** 'all' (default), 'dialogs' (part 1 only) or 'offline' (part 2 only). */
const part = option('--part', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'history-ui-check')));
mkdirSync(outDir, { recursive: true });
const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const onMac = process.platform === 'darwin';
/** The first page load of the dev server can take minutes on a busy machine. */
const LOAD_TIMEOUT = 240_000;
const STEP_TIMEOUT = 60_000;

let failures = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const focusOrders = [];

// --- page helpers ---------------------------------------------------------------------------

const isMissingEngineError = (text) =>
  /Simulator:|sim68k|asm68k|engine\/dist/i.test(text) && !existsSync(join(repoRoot, 'engine', 'dist', 'sim68k.wasm'));

async function openApp(context, baseUrl, errors) {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' && !isMissingEngineError(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined && window.__easy68k.ctx.history !== undefined, null, {
    timeout: LOAD_TIMEOUT,
  });
  return page;
}

/** What has the focus: role, accessible name or text. */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
    const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${role} "${name}"`;
  });

/** Presses Tab until the focus comes back to where it started; returns the order (at most 20). */
async function tabCycle(page, key = 'Tab') {
  const start = await focused(page);
  const order = [start];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(key);
    const now = await focused(page);
    if (now === start) return { order, closed: true };
    order.push(now);
  }
  return { order, closed: false };
}

/** Presses Tab until the focus is on an element matching `test`; false after 20 presses. */
async function tabTo(page, test) {
  for (let i = 0; i < 20; i++) {
    if (test(await focused(page))) return true;
    await page.keyboard.press('Tab');
  }
  return test(await focused(page));
}
const isButton = (caption) => (text) => text.startsWith('button') && text.includes(caption);
const isGrid = (text) => text.startsWith('grid');

const questionGone = (page) =>
  page.waitForFunction(() => document.querySelector('[role=alertdialog]') === null, null, { timeout: STEP_TIMEOUT });

/**
 * A question that cannot be undone is open: No has the focus (decided by the architect, errata N4);
 * Shift+Tab moves to Yes, and Enter presses it.
 */
async function answerYes(page, label) {
  const first = await focused(page);
  check(`${label}: the question opens with the focus on No`, first === 'button "No"', first);
  await page.keyboard.press('Shift+Tab');
  const yes = await focused(page);
  check(`${label}: Shift+Tab moves to Yes`, yes === 'button "Yes"', yes);
  await page.keyboard.press('Enter');
  await questionGone(page);
}

/**
 * A question that cannot be undone is open: No has the focus, and Enter answers it and leaves
 * everything in place (`unchanged` reads the state again and says whether it is as before).
 */
async function enterKeepsAll(page, label, unchanged, shot) {
  const first = await focused(page);
  check(`${label}: the question opens with the focus on No`, first === 'button "No"', first);
  if (shot) await page.screenshot({ path: shot });
  await page.keyboard.press('Enter');
  const closed = await questionGone(page).then(
    () => true,
    () => false,
  );
  check(`${label}: Enter answers the question (No)`, closed);
  const state = await unchanged();
  check(`${label}: Enter left everything in place`, state.ok, state.detail);
}

const dialogOpen = (page, kind) => page.locator(`[data-e68-history="${kind}"][data-loaded="true"]`);
const dialogGone = (page) =>
  page.waitForFunction(() => window.__easy68k.ctx.store.getState().dialogs.stack.length === 0, null, {
    timeout: STEP_TIMEOUT,
  });

async function scan(page, label) {
  const result = await new AxeBuilder({ page })
    .include('[role=dialog]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no finding`, result.violations.length === 0, describe(result.violations).join('; '));
}

/** The text of the gutter marks of the comparison, by side. */
const marks = (page) =>
  page.evaluate(() => {
    const view = document.querySelector('.e68-history__view');
    const text = (root) =>
      [...(root?.querySelectorAll('.e68-diff-mark') ?? [])]
        .map((el) => el.textContent)
        .join('')
        .replace(/\n/g, '');
    const editors = [...(view?.querySelectorAll('.cm-editor') ?? [])];
    return {
      merge: view?.querySelector('.cm-mergeView') !== null && view?.querySelector('.cm-mergeView') !== undefined,
      deletedChunk: view?.querySelector('.cm-deletedChunk') !== null,
      editors: editors.length,
      left: editors.length === 2 ? text(editors[0]) : '',
      right: editors.length === 2 ? text(editors[1]) : '',
      all: text(view),
    };
  });

// --- the fixture: a file with versions, items in the Trash --------------------------------------

const V1 = 'start\tMOVE.L\t#1,D0\r\n\tMOVE.L\t#2,D1\r\n\tSIMHALT\r\n\tEND\tstart\r\n';
const V2 = 'start\tMOVE.L\t#1,D0\r\n\tADD.L\tD1,D0\r\n\tSIMHALT\r\n\tEND\tstart\r\n';
const V3 = 'start\tMOVE.L\t#1,D0\r\n\tADD.L\tD1,D0\r\n\tADD.L\tD2,D0\r\n\tSIMHALT\r\n\tEND\tstart\r\n';

/** Opens /browser/hist/prog.X68 (V1) and saves V2 and V3 through the document service. */
function makeVersions(page) {
  return page.evaluate(
    async ({ v1, v2, v3 }) => {
      const { ctx } = window.__easy68k;
      const encode = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
      const path = '/browser/hist/prog.X68';
      await ctx.vfs.writeFile(path, encode(v1));
      const doc = await ctx.documents.open(path);
      const settle = () => new Promise((r) => setTimeout(r, 200));
      for (const next of [v2, v3]) {
        // The editor's own change, as typing would make it (the registry of the document service).
        const text = next.replace(/\r\n/g, '\n');
        const reg = ctx.documents.registry;
        reg.dispatch(doc.id, { changes: { from: 0, to: reg.state(doc.id).doc.length, insert: text } });
        await settle();
        await ctx.documents.save(doc.id);
        await settle();
      }
      for (let i = 0; i < 50; i++) {
        if ((await ctx.history.versions(path)).length >= 3) break;
        await settle();
      }
      return (await ctx.history.versions(path)).map((v) => v.reason);
    },
    { v1: V1, v2: V2, v3: V3 },
  );
}

/** Puts `names` below /browser/trash into the Trash, one item each, as the Files panel deletes. */
function makeTrash(page, names) {
  return page.evaluate(async (list) => {
    const { ctx } = window.__easy68k;
    for (const name of list) {
      const path = `/browser/trash/${name}`;
      await ctx.vfs.writeFile(path, new TextEncoder().encode(`* ${name}\r\n`));
      await ctx.history.guard(
        path,
        'delete',
        async (seen) => {
          for (const file of seen) await ctx.vfs.remove(file.path);
        },
        async () => false,
      );
    }
    return (await ctx.history.trashItems()).length;
  }, names);
}

const readFile = (page, path) =>
  page.evaluate(async (p) => {
    const { ctx } = window.__easy68k;
    const stat = await ctx.vfs.stat(p);
    if (!stat) return null;
    return [...(await ctx.vfs.readFile(p))].map((b) => String.fromCharCode(b)).join('');
  }, path);

// --- part 1: the dialogs in the development server ------------------------------------------------

async function dialogsPass(browser, name, theme, baseUrl) {
  const p = `${name} ${theme}:`;
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: 'reduce',
    colorScheme: theme,
  });
  const errors = [];
  try {
    const page = await openApp(context, baseUrl, errors);
    const reasons = await makeVersions(page);
    check(
      `${p} opening and two saves recorded Saved, Saved, As opened (from onWritten)`,
      reasons.join(',') === 'saved,saved,opened',
      reasons.join(','),
    );

    // ---- Earlier Versions
    await page.evaluate(() => void window.__easy68k.ctx.commands.run('ed.file.history'));
    await dialogOpen(page, 'versions').waitFor({ timeout: STEP_TIMEOUT });
    const title = await page
      .locator('[role=dialog] [id]')
      .first()
      .innerText()
      .catch(() => '');
    check(
      `${p} the dialog is titled Earlier Versions of prog.X68`,
      (await page.locator('[role=dialog]').innerText()).includes('Earlier Versions of prog.X68'),
      title,
    );
    await page.waitForSelector('.e68-history__view .cm-editor', { timeout: STEP_TIMEOUT });
    const rows = await page.locator('.e68-history__grid [role=row][data-row]').allInnerTexts();
    check(
      `${p} three versions listed, newest first, with their kinds`,
      rows.length === 3 && /Saved/.test(rows[0]) && /As opened/.test(rows[2]),
      rows.map((r) => r.replace(/\s+/g, ' ')).join(' | '),
    );
    const forward = await tabCycle(page, 'Tab');
    const backward = await tabCycle(page, 'Shift+Tab');
    focusOrders.push(`${p} Earlier Versions, Tab: ${forward.order.join(' > ')}`);
    check(
      `${p} Earlier Versions: Tab goes round every control and back`,
      forward.closed &&
        forward.order.some(isGrid) &&
        ['Restore', 'Open as New Document', 'Close'].every((c) => forward.order.some(isButton(c))),
      forward.order.join(' > '),
    );
    check(
      `${p} Earlier Versions: Shift+Tab goes round the same controls`,
      backward.closed && backward.order.length === forward.order.length,
      backward.order.join(' > '),
    );

    // The newest version against the file now: no change. Down: the second (V2) against V3.
    check(`${p} reached the list with Tab`, await tabTo(page, isGrid));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelectorAll('.e68-history__view .e68-diff-mark').length > 0, null, {
      timeout: STEP_TIMEOUT,
    });
    let m = await marks(page);
    check(
      `${p} side by side: the inserted line is marked + on the right, nothing - on the left`,
      m.merge && m.editors === 2 && m.right === '+' && m.left === '',
      JSON.stringify(m),
    );
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(
      () => document.querySelectorAll('.e68-history__view .e68-diff-mark--deleted').length > 0,
      null,
      { timeout: STEP_TIMEOUT },
    );
    m = await marks(page);
    // The saved versions end with the font and tab trailer, shown as it is in the file (P3.3.8).
    check(
      `${p} As opened against now: one line - on the left, the two new lines and the trailer + on the right`,
      m.left === '-' && /^\+{2,}$/.test(m.right),
      JSON.stringify(m),
    );
    await page.screenshot({ path: join(outDir, `${name}-${theme}-versions.png`) });
    await scan(page, `${p} Earlier Versions`);

    // Restore the version As opened with Enter on Restore. The file is first changed elsewhere (a
    // write through the Vfs, as a program's would be: no version), so that the bytes Restore writes
    // over differ from the newest version and are kept as `Before restore` (an equal content is
    // not kept twice, P3.3.3).
    await page.evaluate(async (text) => {
      const { ctx } = window.__easy68k;
      await ctx.vfs.writeFile('/browser/hist/prog.X68', new Uint8Array([...text].map((c) => c.charCodeAt(0))));
    }, `${V3}* changed elsewhere\r\n`);
    check(`${p} reached Restore with Tab`, await tabTo(page, isButton('Restore')));
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      async () => {
        if (document.querySelector('[role=alertdialog]')) return true;
        const { ctx } = window.__easy68k;
        const v = await ctx.history.versions('/browser/hist/prog.X68');
        return v[0]?.reason === 'before-restore';
      },
      null,
      { timeout: STEP_TIMEOUT },
    );
    const box = await page
      .locator('[role=alertdialog]')
      .innerText()
      .catch(() => '');
    check(`${p} Restore asked nothing (a copy was kept)`, box === '', box.replace(/\s+/g, ' '));
    if (box) await page.keyboard.press('Enter');
    check(`${p} Enter on Restore wrote the version As opened`, (await readFile(page, '/browser/hist/prog.X68')) === V1);
    const docText = await page.evaluate(() => {
      const { ctx } = window.__easy68k;
      const doc = ctx.documents.list().find((d) => d.path === '/browser/hist/prog.X68');
      return doc ? ctx.documents.text(doc.id) : null;
    });
    check(
      `${p} the open, unmodified document was reloaded`,
      docText === V1.replace(/\r\n/g, '\n'),
      JSON.stringify(docText),
    );
    await page
      .waitForFunction(
        () =>
          /Before restore/.test(
            document.querySelector('.e68-history__grid [role=row][data-row="0"]')?.textContent ?? '',
          ),
        null,
        { timeout: STEP_TIMEOUT },
      )
      .catch(() => {});
    const kinds = await page.locator('.e68-history__grid [role=row][data-row]').allInnerTexts();
    check(
      `${p} the list follows: Before restore first`,
      /Before restore/.test(kinds[0] ?? ''),
      kinds.map((r) => r.replace(/\s+/g, ' ')).join(' | '),
    );

    // With the history switched off, Restore asks the question of P3.3.4 ("This cannot be
    // undone."), and No has the focus: Enter answers No and nothing is written.
    const setHistory = (on) =>
      page.evaluate(
        (on) =>
          window.__easy68k.ctx.settings.update((s) => ({
            ...s,
            app: { ...s.app, plus: { ...s.app.plus, history: on } },
          })),
        on,
      );
    await setHistory(false);
    await page.waitForFunction(() => window.__easy68k.ctx.history.state() === 'off', null, { timeout: STEP_TIMEOUT });
    check(`${p} reached Restore with Tab (history off)`, await tabTo(page, isButton('Restore')));
    await page.keyboard.press('Enter');
    const offQuestion = page.locator('[role=alertdialog]');
    await offQuestion.waitFor({ timeout: STEP_TIMEOUT });
    const questionText = (await offQuestion.innerText()).replace(/\s+/g, ' ');
    await page
      .waitForFunction(() => document.activeElement?.textContent?.trim() === 'No', null, { timeout: 5_000 })
      .catch(() => {});
    const questionFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
    check(
      `${p} history off: Restore asks the question of P3.3.4 and No has the focus`,
      /cannot keep a copy of the current "prog\.X68"\. Restore the earlier version anyway\? This cannot be undone\./.test(
        questionText,
      ) && questionFocus === 'No',
      `focus ${questionFocus}: ${questionText}`,
    );
    await page.keyboard.press('Enter');
    await offQuestion.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT });
    check(
      `${p} history off: Enter on the question answers No; the file is unchanged`,
      (await readFile(page, '/browser/hist/prog.X68')) === V1,
    );
    await setHistory(true);
    await page.waitForFunction(() => window.__easy68k.ctx.history.state() === 'ready', null, { timeout: STEP_TIMEOUT });

    // Open as New Document with Enter (the newest Saved version, V3).
    await tabTo(page, isGrid);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    check(`${p} reached Open as New Document with Tab`, await tabTo(page, isButton('Open as New Document')));
    const before = await page.evaluate(() => window.__easy68k.ctx.documents.list().length);
    await page.keyboard.press('Enter');
    await dialogGone(page);
    await page
      .waitForFunction(
        (n) => {
          const { ctx } = window.__easy68k;
          const doc = ctx.documents.active();
          const text = doc ? ctx.documents.text(doc.id) : '';
          return (
            ctx.documents.list().length === n + 1 &&
            doc &&
            !doc.hasName &&
            text.includes('ADD.L\tD2,D0') &&
            !text.includes('*~Font')
          );
        },
        before,
        { timeout: STEP_TIMEOUT },
      )
      .then(
        () => check(`${p} Enter on Open as New Document opened an untitled document with the version's text`, true),
        async () =>
          check(
            `${p} Enter on Open as New Document opened an untitled document with the version's text`,
            false,
            await page.evaluate(() => {
              const { ctx } = window.__easy68k;
              const doc = ctx.documents.active();
              return JSON.stringify({
                count: ctx.documents.list().length,
                name: doc?.name,
                text: doc ? ctx.documents.text(doc.id).slice(0, 60) : null,
              });
            }),
          ),
      );

    // Esc closes.
    await page.evaluate(() => {
      const { ctx } = window.__easy68k;
      const doc = ctx.documents.list().find((d) => d.path === '/browser/hist/prog.X68');
      ctx.documents.activate(doc.id);
      void ctx.commands.run('ed.file.history');
    });
    await dialogOpen(page, 'versions').waitFor({ timeout: STEP_TIMEOUT });
    await page.keyboard.press('Escape');
    await dialogGone(page).then(
      () => check(`${p} Esc closes Earlier Versions`, true),
      () => check(`${p} Esc closes Earlier Versions`, false),
    );

    // ---- Trash
    const count = await makeTrash(page, ['a.X68', 'b.X68', 'c.X68']);
    check(`${p} three items in the Trash`, count === 3, String(count));
    await page.evaluate(() => void window.__easy68k.ctx.commands.run('app.files.trash'));
    await dialogOpen(page, 'trash').waitFor({ timeout: STEP_TIMEOUT });
    await page
      .locator('[data-e68-history=trash] [role=grid] [role=row][data-row]')
      .first()
      .waitFor({ timeout: STEP_TIMEOUT });
    const trashForward = await tabCycle(page, 'Tab');
    const trashBackward = await tabCycle(page, 'Shift+Tab');
    focusOrders.push(`${p} Trash, Tab: ${trashForward.order.join(' > ')}`);
    check(
      `${p} Trash: Tab goes round every control and back`,
      trashForward.closed &&
        trashForward.order.some(isGrid) &&
        ['Restore', 'Delete for Good', 'Empty Trash', 'Close'].every((c) => trashForward.order.some(isButton(c))),
      trashForward.order.join(' > '),
    );
    check(
      `${p} Trash: Shift+Tab goes round the same controls`,
      trashBackward.closed && trashBackward.order.length === trashForward.order.length,
      trashBackward.order.join(' > '),
    );
    const grid = page.locator('[data-e68-history=trash] [role=grid]');
    check(`${p} Trash list is aria-multiselectable`, (await grid.getAttribute('aria-multiselectable')) === 'true');
    await page.screenshot({ path: join(outDir, `${name}-${theme}-trash.png`) });
    await scan(page, `${p} Trash`);

    // Shift+Down: the two newest items; Restore with Enter.
    await tabTo(page, isGrid);
    await page.keyboard.press('Shift+ArrowDown');
    const selectedNames = await grid.locator('[role=row][aria-selected=true]').allInnerTexts();
    check(
      `${p} Shift+Down selects two items`,
      selectedNames.length === 2,
      selectedNames.map((r) => r.replace(/\s+/g, ' ')).join(' | '),
    );
    // Ctrl (Option) + Down and + Space add the third, and again remove it.
    await page.keyboard.press(onMac ? 'Alt+ArrowDown' : 'Control+ArrowDown');
    await page.keyboard.press(onMac ? 'Alt+Space' : 'Control+Space');
    check(
      `${p} ${onMac ? 'Option' : 'Ctrl'}+Space adds the focused item`,
      (await grid.locator('[role=row][aria-selected=true]').count()) === 3,
    );
    await page.keyboard.press(onMac ? 'Alt+Space' : 'Control+Space');
    check(
      `${p} ${onMac ? 'Option' : 'Ctrl'}+Space again removes it`,
      (await grid.locator('[role=row][aria-selected=true]').count()) === 2,
    );
    check(`${p} reached Restore with Tab`, await tabTo(page, isButton('Restore')));
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      async () =>
        document.querySelector('[role=alertdialog]') !== null ||
        (await window.__easy68k.ctx.history.trashItems()).length === 1,
      null,
      { timeout: STEP_TIMEOUT },
    );
    const restoreBox = await page
      .locator('[role=alertdialog]')
      .innerText()
      .catch(() => '');
    check(
      `${p} Restore from the Trash asked nothing (the places are free)`,
      restoreBox === '',
      restoreBox.replace(/\s+/g, ' '),
    );
    if (restoreBox) await page.keyboard.press('Enter');
    const restored = await Promise.all(['a.X68', 'b.X68', 'c.X68'].map((n) => readFile(page, `/browser/trash/${n}`)));
    const remaining = await page.evaluate(async () =>
      (await window.__easy68k.ctx.history.trashItems()).map((i) => i.path),
    );
    check(
      `${p} Enter on Restore restored the two newest items (b, c) and left a`,
      restored[0] === null && restored[1] === '* b.X68\r\n' && restored[2] === '* c.X68\r\n',
      JSON.stringify({ restored, remaining }),
    );

    // Delete for Good: Enter, the question (No has the focus), Shift+Tab to Yes, Enter.
    await page.waitForFunction(
      () => document.querySelectorAll('[data-e68-history=trash] [role=row][data-row]').length === 1,
      null,
      { timeout: STEP_TIMEOUT },
    );
    check(`${p} reached Delete for Good with Tab`, await tabTo(page, isButton('Delete for Good')));
    await page.keyboard.press('Enter');
    await page.locator('[role=alertdialog]').waitFor({ timeout: STEP_TIMEOUT });
    const question = await page.locator('[role=alertdialog]').innerText();
    check(
      `${p} Delete for Good asks "Delete the selected item for good?"`,
      question.includes('Delete the selected item for good?'),
      question.replace(/\s+/g, ' '),
    );
    await answerYes(page, `${p} Delete for Good`);
    await page.waitForFunction(async () => (await window.__easy68k.ctx.history.trashItems()).length === 0, null, {
      timeout: STEP_TIMEOUT,
    });
    await page.locator('[data-e68-history=trash] .e68-history__empty').waitFor({ timeout: STEP_TIMEOUT });
    check(
      `${p} the Trash is empty: its empty state`,
      (await page.locator('[data-e68-history=trash]').innerText()).includes('The Trash is empty.'),
    );

    // Empty Trash: two more items, Enter, Shift+Tab to Yes, Enter.
    await makeTrash(page, ['d.X68', 'e.X68']);
    await page.waitForFunction(
      () => document.querySelectorAll('[data-e68-history=trash] [role=row][data-row]').length === 2,
      null,
      { timeout: STEP_TIMEOUT },
    );
    check(`${p} reached Empty Trash with Tab`, await tabTo(page, isButton('Empty Trash')));
    await page.keyboard.press('Enter');
    await page.locator('[role=alertdialog]').waitFor({ timeout: STEP_TIMEOUT });
    const emptyQuestion = await page.locator('[role=alertdialog]').innerText();
    check(
      `${p} Empty Trash asks with the count and the size`,
      /Delete everything in the Trash for good\? \(2 items, [\d.]+ (bytes|kB)\)/.test(
        emptyQuestion.replace(/\s+/g, ' '),
      ),
      emptyQuestion.replace(/\s+/g, ' '),
    );
    await answerYes(page, `${p} Empty Trash`);
    await page.waitForFunction(async () => (await window.__easy68k.ctx.history.trashItems()).length === 0, null, {
      timeout: STEP_TIMEOUT,
    });
    check(`${p} Enter on Yes emptied the Trash`, true);
    await page.keyboard.press('Escape');
    await dialogGone(page).then(
      () => check(`${p} Esc closes the Trash`, true),
      () => check(`${p} Esc closes the Trash`, false),
    );
    check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

/**
 * The questions that cannot be undone (Delete for Good, Empty Trash, Delete History and Trash) open
 * with the focus on No, and Enter leaves every Trash item and every earlier version in place
 * (decided by the architect, errata N4). Delete History and Trash is offered when the history is
 * unavailable (P3.3.7): its `meta` record is damaged in the browser's own IndexedDB and the page
 * reloaded, as a damaged database would be found; after the No, Yes deletes it and the history
 * works again.
 */
async function defaultNoPass(browser, name, baseUrl) {
  const p = `${name} default No:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  try {
    const page = await openApp(context, baseUrl, errors);
    const reasons = await makeVersions(page);
    check(`${p} the file has three earlier versions`, reasons.length === 3, reasons.join(','));
    await makeTrash(page, ['f.X68', 'g.X68']);
    const kept = async () => {
      const now = await page.evaluate(async () => {
        const { history } = window.__easy68k.ctx;
        return {
          trash: (await history.trashItems()).length,
          versions: (await history.versions('/browser/hist/prog.X68')).length,
        };
      });
      return { ok: now.trash === 2 && now.versions === 3, detail: JSON.stringify(now) };
    };

    await page.evaluate(() => void window.__easy68k.ctx.commands.run('app.files.trash'));
    await dialogOpen(page, 'trash').waitFor({ timeout: STEP_TIMEOUT });
    await page
      .locator('[data-e68-history=trash] [role=grid] [role=row][data-row]')
      .first()
      .waitFor({ timeout: STEP_TIMEOUT });
    for (const [caption, text, shot] of [
      ['Delete for Good', 'Delete the selected item for good?', 'delete-for-good'],
      ['Empty Trash', 'Delete everything in the Trash for good? (2 items,', 'empty-trash'],
    ]) {
      check(`${p} reached ${caption} with Tab`, await tabTo(page, isButton(caption)));
      await page.keyboard.press('Enter');
      await page.locator('[role=alertdialog]').waitFor({ timeout: STEP_TIMEOUT });
      const question = (await page.locator('[role=alertdialog]').innerText()).replace(/\s+/g, ' ');
      check(`${p} ${caption} asks its question`, question.includes(text), question);
      await enterKeepsAll(page, `${p} ${caption}`, kept, join(outDir, `${name}-default-no-${shot}.png`));
    }
    await page.keyboard.press('Escape');
    await dialogGone(page);

    // A damaged `meta` record: the history is unavailable after the reload (P3.3.7).
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('easy68k-history');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('meta', 'readwrite');
            tx.objectStore('meta').put('damaged', 'totals');
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload({ timeout: LOAD_TIMEOUT });
    await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
    await page.waitForFunction(() => window.__easy68k?.ctx.history?.state() === 'unavailable', null, {
      timeout: STEP_TIMEOUT,
    });
    /** The records in the database, read past the service (which cannot read them now). */
    const records = () =>
      page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open('easy68k-history');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction(['files', 'versions'], 'readonly');
              const files = tx.objectStore('files').count();
              const versions = tx.objectStore('versions').count();
              tx.oncomplete = () => {
                db.close();
                resolve({ files: files.result, versions: versions.result });
              };
              tx.onerror = () => reject(tx.error);
            };
          }),
      );
    const before = await records();
    check(
      `${p} the damaged database still holds the records`,
      before.files > 0 && before.versions > 0,
      JSON.stringify(before),
    );
    await page.evaluate(() => void window.__easy68k.ctx.commands.run('app.files.trash'));
    await dialogOpen(page, 'trash').waitFor({ timeout: STEP_TIMEOUT });
    check(`${p} reached Delete History and Trash with Tab`, await tabTo(page, isButton('Delete History and Trash')));
    await page.keyboard.press('Enter');
    await page.locator('[role=alertdialog]').waitFor({ timeout: STEP_TIMEOUT });
    const question = (await page.locator('[role=alertdialog]').innerText()).replace(/\s+/g, ' ');
    check(
      `${p} Delete History and Trash asks its question`,
      question.includes(
        'Delete all earlier versions and everything in the Trash for good? Your current files are not affected.',
      ),
      question,
    );
    await enterKeepsAll(
      page,
      `${p} Delete History and Trash`,
      async () => {
        const now = await records();
        const state = await page.evaluate(() => window.__easy68k.ctx.history.state());
        return {
          ok: now.files === before.files && now.versions === before.versions && state === 'unavailable',
          detail: JSON.stringify({ ...now, state }),
        };
      },
      join(outDir, `${name}-default-no-delete-history.png`),
    );
    // And Yes still deletes it: the history works again, the current file is untouched.
    check(`${p} Delete History and Trash again with Tab`, await tabTo(page, isButton('Delete History and Trash')));
    await page.keyboard.press('Enter');
    await page.locator('[role=alertdialog]').waitFor({ timeout: STEP_TIMEOUT });
    await answerYes(page, `${p} Delete History and Trash`);
    const recovered = await page
      .waitForFunction(
        async () => {
          const { history } = window.__easy68k.ctx;
          return history.state() !== 'unavailable' && (await history.trashItems()).length === 0;
        },
        null,
        { timeout: STEP_TIMEOUT },
      )
      .then(
        () => true,
        () => false,
      );
    check(`${p} Yes deleted the history and it works again`, recovered);
    check(
      `${p} the current file is untouched`,
      // The editor saves its text and the original's settings lines after it.
      ((await readFile(page, '/browser/hist/prog.X68')) ?? '').startsWith(V3),
      JSON.stringify(await readFile(page, '/browser/hist/prog.X68')),
    );
    check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

/**
 * In the page: keeps a read-write transaction over the whole history database alive until
 * window.__holding is set false, so that another window cannot open the history meanwhile
 * (a slow open, P3.3.5). window.__txDone resolves when the transaction has ended.
 */
function holdHistory() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('easy68k-history');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const names = [...db.objectStoreNames];
      const tx = db.transaction(names, 'readwrite');
      const store = tx.objectStore(names[0]);
      window.__holding = true;
      const spin = () => {
        if (window.__holding) store.get('easy68k-check-nothing').onsuccess = spin;
      };
      spin();
      window.__txDone = new Promise((done) => {
        tx.oncomplete = () => {
          db.close();
          done('complete');
        };
        tx.onabort = () => done(`aborted: ${tx.error?.name}`);
      });
      resolve();
    };
  });
}

/**
 * A slow open (P3.3.5, errata N3 "A slow open"), as a student sees it: while the first window keeps
 * the history database busy, a second window's history does not open within 5 s, and its Trash
 * dialog shows the text of P3.3.7; when the first window lets go, the same dialog, still open,
 * shows the Trash's item without being opened again.
 */
async function slowOpenPass(browser, name, baseUrl) {
  const p = `${name} slow open:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  try {
    const first = await openApp(context, baseUrl, errors);
    const count = await makeTrash(first, ['slow.X68']);
    check(`${p} the first window has one item in the Trash`, count === 1, String(count));
    await first.evaluate(holdHistory);
    const second = await openApp(context, baseUrl, errors);
    const unavailable = await second
      .waitForFunction(() => window.__easy68k.ctx.history.state() === 'unavailable', null, { timeout: STEP_TIMEOUT })
      .then(
        () => true,
        () => false,
      );
    check(`${p} the second window's history is unavailable while the first holds the database`, unavailable);
    await second.evaluate(() => void window.__easy68k.ctx.commands.run('app.files.trash'));
    await dialogOpen(second, 'trash').waitFor({ timeout: STEP_TIMEOUT });
    const message = 'The history cannot be read (the browser did not open it within 5 s). Your files are not affected.';
    const before = (await second.locator('[data-e68-history=trash]').innerText()).replace(/\s+/g, ' ');
    check(`${p} the Trash dialog shows the text of P3.3.7`, before.includes(message), before);
    await second.screenshot({ path: join(outDir, `${name}-slow-open-unavailable.png`) });
    const released = await first.evaluate(async () => {
      window.__holding = false;
      return window.__txDone;
    });
    const row = second.locator('[data-e68-history=trash] [role=grid] [role=row][data-row]').first();
    const listed = await row.waitFor({ timeout: STEP_TIMEOUT }).then(
      () => true,
      () => false,
    );
    const after = (await second.locator('[data-e68-history=trash]').innerText()).replace(/\s+/g, ' ');
    check(
      `${p} when the first window lets go, the open dialog lists the item, without the text of P3.3.7`,
      listed && after.includes('slow.X68') && !after.includes(message),
      `transaction ${released}; ${after.slice(0, 300)}`,
    );
    const state = await second.evaluate(() => window.__easy68k.ctx.history.state());
    check(`${p} the second window's history is ready again`, state === 'ready', state);
    // The Files panel's line (P3.2.6, refreshed at most once per second) counts the Trash again.
    const line = await second
      .waitForFunction(
        () => {
          const text = document.querySelector('[data-e68-storage-line]')?.textContent ?? '';
          return /Earlier versions and Trash: [1-9]/.test(text) ? text : false;
        },
        null,
        { timeout: STEP_TIMEOUT },
      )
      .then(
        (handle) => handle.jsonValue(),
        async () => second.evaluate(() => document.querySelector('[data-e68-storage-line]')?.textContent ?? null),
      );
    check(
      `${p} the Files panel's line counts the Trash again`,
      /Earlier versions and Trash: [1-9]/.test(line ?? ''),
      String(line),
    );
    await second.screenshot({ path: join(outDir, `${name}-slow-open-ready.png`) });
    await second.keyboard.press('Escape');
    await dialogGone(second).then(
      () => check(`${p} Esc closes the Trash`, true),
      () => check(`${p} Esc closes the Trash`, false),
    );
    check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

/** Below 700 px of dialog width: the unified view, with the same marks. */
async function unifiedPass(browser, name, baseUrl) {
  const p = `${name} narrow:`;
  const context = await browser.newContext({ viewport: { width: 660, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  try {
    const page = await openApp(context, baseUrl, errors);
    await makeVersions(page);
    await page.evaluate(() => void window.__easy68k.ctx.commands.run('ed.file.history'));
    await dialogOpen(page, 'versions').waitFor({ timeout: STEP_TIMEOUT });
    const width = await page.locator('[role=dialog]').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await tabTo(page, isGrid);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(
      () => document.querySelectorAll('.e68-history__view .e68-diff-mark--deleted').length > 0,
      null,
      { timeout: STEP_TIMEOUT },
    );
    const m = await marks(page);
    check(
      `${p} a dialog ${width} px wide shows the unified view (one editor, deleted lines as a block)`,
      width < 700 && !m.merge && m.editors === 1 && m.deletedChunk,
      JSON.stringify({ width, ...m }),
    );
    check(
      `${p} the unified view marks the deleted line - and the inserted lines +`,
      m.all.split('').filter((c) => c === '-').length === 1 && m.all.split('').filter((c) => c === '+').length >= 2,
      m.all,
    );
    await page.screenshot({ path: join(outDir, `${name}-unified.png`) });
    await scan(page, `${p} Earlier Versions, unified`);
    check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

// --- part 2: the merge chunk offline (production build, service worker) ---------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.htm': 'text/html',
  '.txt': 'text/plain',
};

function productionBuild(target) {
  const require = createRequire(join(appRoot, 'package.json'));
  const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  rmSync(target, { recursive: true, force: true });
  console.log(`Production build into ${target}`);
  const run = spawnSync(
    process.execPath,
    [viteBin, 'build', '--outDir', target, '--emptyOutDir', '--logLevel', 'warn'],
    {
      cwd: appRoot,
      env: { ...process.env, EASY68K_BASE: '/' },
      stdio: 'inherit',
    },
  );
  if (run.status !== 0) throw new Error(`vite build failed with exit code ${run.status}`);
}

function startStatic(root) {
  const state = { down: false, attempts: 0 };
  const server = createHttpServer((request, response) => {
    if (state.down) {
      state.attempts++;
      request.socket.destroy();
      return;
    }
    let path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'max-age=600',
    });
    response.end(body);
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done({ server, state, origin: `http://127.0.0.1:${server.address().port}` })),
  );
}

/** The chunk of merge-view.ts: the one asset that holds its gutter's class name. */
function findMergeChunk(dist) {
  const assets = join(dist, 'assets');
  return (
    readdirSync(assets).find(
      (file) => file.endsWith('.js') && readFileSync(join(assets, file), 'utf8').includes('e68-diff-gutter'),
    ) ?? null
  );
}

async function offlinePass(browser, name, site) {
  const p = `${name} offline:`;
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    site.state.down = false;
    await page.goto(`${site.origin}/`, { timeout: LOAD_TIMEOUT });
    await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
    if (!(await page.evaluate(() => 'serviceWorker' in navigator))) {
      check(
        `${p} service workers are available`,
        process.platform === 'win32',
        `${name} has no navigator.serviceWorker`,
      );
      if (process.platform === 'win32')
        console.log(`  note ${name} on Windows has no service worker: the offline check is skipped here`);
      return;
    }
    const scope = await page.evaluate(
      () =>
        new Promise((done, fail) => {
          const started = Date.now();
          const poll = async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration?.active?.state === 'activated') return done(registration.scope);
            if (Date.now() - started > 120_000) return fail(new Error('no activated worker after 120 s'));
            setTimeout(poll, 200);
          };
          void poll();
        }),
    );
    check(`${p} the service worker is activated`, typeof scope === 'string', String(scope));
    const chunkUrl = `assets/${site.chunk}`;
    const precached = await page.evaluate(async (url) => {
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        if (await cache.match(new URL(url, document.baseURI).href)) return true;
      }
      return false;
    }, chunkUrl);
    check(`${p} the merge chunk ${site.chunk} is precached after the first visit`, precached);

    site.state.down = true;
    site.state.attempts = 0;
    await context.setOffline(true);
    await page.reload({ timeout: LOAD_TIMEOUT });
    await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
    const drawn = await page.evaluate(async (url) => {
      const module = await import(new URL(url, document.baseURI).href);
      const parent = document.createElement('div');
      parent.style.width = '900px';
      document.body.append(parent);
      for (const value of Object.values(module)) {
        if (typeof value !== 'function') continue;
        try {
          value(parent, {
            before: 'a\nb\n',
            now: 'a\nB\nc\n',
            unified: false,
            fontFamily: 'monospace',
            fontSize: '10pt',
            beforeLabel: 'before',
            nowLabel: 'Now',
          });
        } catch {
          continue;
        }
        if (parent.querySelector('.cm-mergeView')) break;
      }
      await new Promise((r) => setTimeout(r, 300));
      const marksText = [...parent.querySelectorAll('.e68-diff-mark')].map((el) => el.textContent).join('');
      return { merge: parent.querySelector('.cm-mergeView') !== null, marks: marksText };
    }, chunkUrl);
    check(
      `${p} with the network off the merge chunk loads and draws a comparison with its marks`,
      drawn.merge && drawn.marks.includes('-') && drawn.marks.includes('+'),
      JSON.stringify(drawn),
    );
    check(`${p} no request reached the server`, site.state.attempts === 0, String(site.state.attempts));
    check(`${p} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
    site.state.down = false;
  }
}

// --- main -----------------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(outDir, 'vite-cache'),
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  let site = null;
  try {
    for (const name of part === 'offline' ? [] : browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        for (const run of [
          ['light', () => dialogsPass(browser, name, 'light', baseUrl)],
          ['dark', () => dialogsPass(browser, name, 'dark', baseUrl)],
          ['narrow', () => unifiedPass(browser, name, baseUrl)],
          ['default No', () => defaultNoPass(browser, name, baseUrl)],
          ['slow open', () => slowOpenPass(browser, name, baseUrl)],
        ]) {
          try {
            await run[1]();
          } catch (error) {
            check(
              `${name} ${run[0]}: the pass ran to the end`,
              false,
              String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            );
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }

  // Part 2.
  const dist = join(outDir, 'dist');
  if (part !== 'dialogs')
    try {
      productionBuild(dist);
      const chunk = findMergeChunk(dist);
      check('the production build has a chunk of its own for the merge view', chunk !== null, String(chunk));
      const index = readFileSync(join(dist, 'index.html'), 'utf8');
      check(
        'the merge chunk is not part of the first load (index.html neither loads nor preloads it)',
        chunk !== null && !index.includes(chunk),
      );
      if (chunk) {
        const serve = await startStatic(dist);
        site = { ...serve, chunk };
        for (const name of browsers) {
          const browser = await BROWSERS[name].launch();
          try {
            await offlinePass(browser, name, site);
          } catch (error) {
            check(
              `${name} offline: the pass ran to the end`,
              false,
              String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            );
          } finally {
            await browser.close();
          }
        }
      }
    } catch (error) {
      check('the production build and the offline pass ran', false, String(error?.message ?? error));
    } finally {
      site?.server.close();
    }

  console.log('\nFocus order (Tab), as the checks found it:');
  for (const line of focusOrders) console.log(`  ${line}`);
  console.log(`\n${total - failures} of ${total} checks passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
