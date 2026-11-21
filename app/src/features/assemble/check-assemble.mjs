// Browser check of the Assemble feature (ARCHITECTURE.md 9.4 E5; editor-ui Â§20.4). Owner: E5.
//
//   node app/src/features/assemble/check-assemble.mjs [--browser chromium|webkit|all] [--out <dir>] [--keys mac|windows]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright): the real editor, document service, file system (the browser
// store), assembler engine and simulator session. Needs engine/dist (both engines); no production
// build.
//
// KEYS. The page gets the key map of the system the check runs on (macOS on a Mac, Windows
// elsewhere); every chord pressed is read from the application's chord table (`chordsOn()` of
// app/src/commands/specs.ts). `--keys` overrides the choice, for diagnosis.
//
// What it checks, as a student sees it:
//   - F9 on the template: `Assembler Status - untitled1.x68`, `Warnings:` 0, `Errors:` 0, Execute
//     enabled, `untitled1.L68` and `untitled1.S68` in the browser store; the message list stays
//     collapsed (7 px);
//   - one bad opcode (the toolbar button): `Errors:` 1, Execute disabled; one row `3` /
//     `ERROR: Invalid opcode`, the list at least 87 px, columns `Line ` and `Error Message`, an
//     inline marker; double-click selects the line in the editor and focuses it; the context menu's
//     `Clear Error Messages` empties the list and removes the marker;
//   - no END with Show Warnings off: `Warnings:` 1 and no row;
//   - a message of an include file opens it in a tab, its row is in its own list, the assembled
//     document stays active;
//   - Load L68 opens `<name>.L68` in a new tab as a list document;
//   - Execute switches to Simulator mode and loads `<name>.S68` in a fresh simulator without
//     running it (PC at the start address, phase idle); with a program waiting for input, the
//     `Caution` question comes first and Cancel keeps the old program (note 20);
//   - an accessibility scan (axe-core) of the message list and of the status dialog in both
//     themes; no console errors.
//
// Screenshots go to build/E5/assemble-check (git-ignored) unless --out says otherwise. Exit code
// 0 = everything passed.

/* global console, process, document, window, Navigator -- browser globals are used inside page.evaluate() callbacks */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'E5', 'assemble-check')));
const fromBuild = relative(join(repoRoot, 'build'), outDir);
if (fromBuild === '' || fromBuild === '..' || fromBuild.startsWith(`..${sep}`) || isAbsolute(fromBuild)) {
  console.error(`--out must be a folder below ${join(repoRoot, 'build')} (given: ${outDir})`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const keysChoice = option('--keys', process.platform === 'darwin' ? 'mac' : 'windows');
if (keysChoice !== 'mac' && keysChoice !== 'windows') {
  console.error('--keys must be mac or windows');
  process.exit(2);
}

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
if (!browsers.every((name) => name in BROWSERS)) {
  console.error('--browser must be chromium, webkit or all');
  process.exit(2);
}

// Both engines are needed (the assembler for F9, the simulator for Execute). Without engine/dist
// the check is skipped, and it fails instead under EASY68K_REQUIRE_ENGINES=1 (CI).
const ENGINE_FILES = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'];
const missing = ENGINE_FILES.filter((file) => !existsSync(join(repoRoot, 'engine', 'dist', file)));
if (missing.length > 0) {
  const required = process.env.EASY68K_REQUIRE_ENGINES === '1';
  console.log(
    `engine/dist lacks ${missing.join(', ')}: ${required ? 'FAIL (EASY68K_REQUIRE_ENGINES=1)' : 'check skipped'}.\n0 of ${required ? 1 : 0} checks passed.`,
  );
  process.exit(required ? 1 : 0);
}

/** The first page load of the dev server can take minutes on a busy machine. */
const PAGE_READY_MS = 180_000;
/** How long one step of the interface may take before it counts as hanging. */
const STEP_MS = 30_000;

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- the page -----------------------------------------------------------------------------------

function pretendSystem(keys) {
  const platform = keys === 'mac' ? 'MacIntel' : 'Win32';
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

const PLAYWRIGHT_MODIFIERS = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Cmd: 'Meta' };
function playwrightKey(chord) {
  const parts = chord.split('+');
  const key = parts.pop();
  const name = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key;
  return [...parts.map((modifier) => PLAYWRIGHT_MODIFIERS[modifier]), name].join('+');
}

const chordsOf = (page, id) =>
  page.evaluate(async (id) => {
    const { chordsOn } = await import('/src/commands/specs.ts');
    return chordsOn(id, window.__easy68k.ctx.platform.os, false);
  }, id);

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendSystem, keysChoice);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const ready = async () => {
    await page.goto(baseUrl, { timeout: PAGE_READY_MS });
    await page.waitForSelector('.e68-shell', { timeout: PAGE_READY_MS });
    await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: PAGE_READY_MS });
    await page.waitForSelector('.e68-editor .cm-editor', { timeout: PAGE_READY_MS });
    // The simulator session starts its engine right after start-up.
    await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, {
      timeout: PAGE_READY_MS,
    });
  };
  try {
    await ready();
  } catch (error) {
    console.log(`        the page did not come up (${String(error?.message ?? error).split('\n')[0]}); retrying once`);
    errors.length = 0;
    await ready();
  }
  return { context, page, errors };
}

async function shot(page, name) {
  await page.screenshot({ path: join(outDir, `${name}.png`) });
}

/** Replaces the text of the active document and puts the focus into its editor. */
const setText = (page, text) =>
  page.evaluate((text) => {
    const ctx = window.__easy68k.ctx;
    const id = ctx.store.getState().documents.activeId;
    const view = document.querySelector(`[data-e68-document="${id}"]`).e68View;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    view.focus();
  }, text);

/** Writes a file into the browser store. */
const writeFile = (page, path, text) =>
  page.evaluate(
    ([path, text]) =>
      window.__easy68k.ctx.vfs.writeFile(
        path,
        Uint8Array.from(text, (c) => c.charCodeAt(0)),
      ),
    [path, text],
  );

const exists = (page, path) =>
  page.evaluate(async (path) => (await window.__easy68k.ctx.vfs.stat(path))?.kind === 'file', path);

const openDocument = (page, path) =>
  page.evaluate(async (path) => {
    const doc = await window.__easy68k.ctx.documents.open(path);
    return doc?.id ?? null;
  }, path);

const editorFocus = async (page) => {
  await page.evaluate(() => {
    const ctx = window.__easy68k.ctx;
    const id = ctx.store.getState().documents.activeId;
    document.querySelector(`[data-e68-document="${id}"]`).e68View.focus();
  });
};

const statusDialog = (page) => page.locator('[role=dialog].e68-asm-status');

/** The status dialog's title, counts and Execute state, once it is shown. */
async function readStatus(page) {
  const dialog = statusDialog(page);
  await dialog.waitFor({ timeout: STEP_MS });
  return {
    title: await dialog.locator('.e68-dialog__title').innerText(),
    labels: await dialog.locator('dt').allInnerTexts(),
    warnings: await dialog.locator('[data-e68-count=warnings]').innerText(),
    errors: await dialog.locator('[data-e68-count=errors]').innerText(),
    executeEnabled: await dialog
      .locator('.e68-dialog__footer')
      .getByRole('button', { name: 'Execute', exact: true })
      .isEnabled(),
    buttons: await dialog.locator('.e68-dialog__footer button').allInnerTexts(),
  };
}

const closeStatus = async (page, button = 'Close') => {
  await statusDialog(page).locator('.e68-dialog__footer').getByRole('button', { name: button, exact: true }).click();
  await statusDialog(page).waitFor({ state: 'detached', timeout: STEP_MS });
};

const messagesRegion = (page) => page.locator('[data-e68-workspace="editor"] [data-e68-panel="messages"]');
const messageRows = (page) => messagesRegion(page).locator('.e68-asm-messages [role=row][data-row]');
const regionHeight = (page) => messagesRegion(page).evaluate((element) => element.getBoundingClientRect().height);

const activeDoc = (page) =>
  page.evaluate(() => {
    const state = window.__easy68k.ctx.store.getState();
    return state.documents.items.find((doc) => doc.id === state.documents.activeId) ?? null;
  });

/** How often Assemble was pressed: the chords of the table take turns (on a Mac F9 and Cmd+B). */
let assemblePresses = 0;
async function pressAssemble(page) {
  const chords = await chordsOf(page, 'ed.project.assemble');
  const chord = chords[assemblePresses++ % chords.length];
  await editorFocus(page);
  await page.keyboard.press(playwrightKey(chord));
}

async function scan(page, selector, label) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious finding`, serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

// --- passes --------------------------------------------------------------------------------------

const BAD = '    ORG $1000\nSTART:\n    FOO D0\n    SIMHALT\n    END START\n';
const NO_END = '    ORG $1000\n    NOP\n';

async function assemblePass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);

  // F9 on the template.
  const first = await activeDoc(page);
  check(`${p} the start-up document is untitled1.x68`, first?.name === 'untitled1.x68', first?.name);
  await pressAssemble(page);
  const status = await readStatus(page);
  check(
    `${p} F9 on the template: Assembler Status - untitled1.x68, Warnings: 0, Errors: 0, Execute enabled`,
    status.title === 'Assembler Status - untitled1.x68' &&
      JSON.stringify(status.labels) === '["Warnings:","Errors:"]' &&
      status.warnings === '0' &&
      status.errors === '0' &&
      status.executeEnabled,
    JSON.stringify(status),
  );
  check(
    `${p} the buttons are Execute, Load L68, Close, left to right`,
    JSON.stringify(status.buttons.map((b) => b.replace(/\s+/g, ''))) === '["Execute","LoadL68","Close"]',
    JSON.stringify(status.buttons),
  );
  await shot(page, `${name}-status-template`);
  await page.keyboard.press('Escape');
  await statusDialog(page).waitFor({ state: 'detached', timeout: STEP_MS });
  check(`${p} Escape closes the status dialog`, (await statusDialog(page).count()) === 0);
  check(
    `${p} untitled1.L68 and untitled1.S68 are in the browser store`,
    (await exists(page, '/browser/Untitled/untitled1.L68')) && (await exists(page, '/browser/Untitled/untitled1.S68')),
  );
  const cleanHeight = await regionHeight(page);
  check(
    `${p} after a clean assembly the message list is 7 px high`,
    Math.round(cleanHeight) === 7,
    String(cleanHeight),
  );

  // One bad opcode, assembled with the toolbar button.
  await setText(page, BAD);
  await page.locator('.e68-shell__toolbar [data-command="ed.project.assemble"]').click();
  const bad = await readStatus(page);
  check(
    `${p} one bad opcode: Errors: 1, Warnings: 0, Execute disabled`,
    bad.errors === '1' && bad.warnings === '0' && !bad.executeEnabled,
    JSON.stringify(bad),
  );
  await shot(page, `${name}-status-error`);
  await closeStatus(page);
  await messageRows(page).first().waitFor({ timeout: STEP_MS });
  const rows = await messageRows(page).evaluateAll((elements) =>
    elements.map((row) => [...row.querySelectorAll('[role=gridcell]')].map((cell) => cell.textContent)),
  );
  check(
    `${p} the message list has one row: 3 / ERROR: Invalid opcode`,
    JSON.stringify(rows) === '[["3","ERROR: Invalid opcode"]]',
    JSON.stringify(rows),
  );
  const headers = await messagesRegion(page).locator('[role=columnheader]').allTextContents();
  check(
    `${p} the columns are "Line " and "Error Message"`,
    JSON.stringify(headers) === '["Line ","Error Message"]',
    JSON.stringify(headers),
  );
  const openHeight = await regionHeight(page);
  check(`${p} the message list opens to at least 87 px`, openHeight >= 86.5, String(openHeight));
  check(
    `${p} the tool-tip is "double click error to highlight in source"`,
    (await messagesRegion(page).locator('.e68-asm-messages').getAttribute('title')) ===
      'double click error to highlight in source',
  );
  check(
    `${p} an inline error marker is drawn on the line, with the message as its text`,
    (await page.locator('.e68-marker--error[title="ERROR: Invalid opcode"]').count()) === 1 &&
      (await page.locator('.e68-squiggle--error[title="ERROR: Invalid opcode"]').count()) >= 1,
  );
  await shot(page, `${name}-messages`);

  await messageRows(page).first().locator('[role=gridcell]').nth(1).dblclick();
  await page.waitForTimeout(200);
  const selected = await page.evaluate(() => {
    const ctx = window.__easy68k.ctx;
    const id = ctx.store.getState().documents.activeId;
    const view = document.querySelector(`[data-e68-document="${id}"]`).e68View;
    const { from, to } = view.state.selection.main;
    return { text: view.state.sliceDoc(from, to), focused: view.hasFocus };
  });
  check(
    `${p} double-click selects the line and focuses the editor`,
    selected.text === '    FOO D0' && selected.focused,
    JSON.stringify(selected),
  );
  await shot(page, `${name}-double-click`);

  await messageRows(page).first().click({ button: 'right' });
  const clear = page.getByRole('menuitem', { name: /Clear Error Messages/ });
  await clear.waitFor({ timeout: STEP_MS });
  await shot(page, `${name}-context-menu`);
  await clear.click();
  await page.waitForTimeout(200);
  check(`${p} Clear Error Messages empties the list`, (await messageRows(page).count()) === 0);
  // The marker gutter keeps one hidden spacer marker without a title (ui/editor/markers.ts).
  const MARKERS = '.e68-marker[title^="ERROR"], .e68-squiggle[title^="ERROR"]';
  const markersLeft = await page
    .waitForFunction((selector) => document.querySelectorAll(selector).length === 0, MARKERS, {
      timeout: 3000,
    })
    .then(() => [])
    .catch(() =>
      page.evaluate(
        (selector) =>
          [...document.querySelectorAll(selector)].map(
            (element) => `${element.className} in ${element.parentElement?.className}`,
          ),
        MARKERS,
      ),
    );
  check(`${p} ... and removes the marker`, markersLeft.length === 0, JSON.stringify(markersLeft));
  const clearedHeight = await regionHeight(page);
  check(`${p} ... and collapses the list to 7 px`, Math.round(clearedHeight) === 7, String(clearedHeight));

  // No END, Show Warnings off.
  await page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, showWarnings: false } })),
  );
  await setText(page, NO_END);
  await pressAssemble(page);
  const noEnd = await readStatus(page);
  check(
    `${p} no END, Show Warnings off: Warnings: 1, Errors: 0`,
    noEnd.warnings === '1' && noEnd.errors === '0',
    JSON.stringify(noEnd),
  );
  await closeStatus(page);
  check(`${p} ... and no row`, (await messageRows(page).count()) === 0);
  await page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, showWarnings: true } })),
  );
  await pressAssemble(page);
  const shown = await readStatus(page);
  await closeStatus(page);
  const warnRows = await messageRows(page).allTextContents();
  check(
    `${p} with Show Warnings on: the row WARNING: END directive missing, starting address not set`,
    shown.warnings === '1' &&
      warnRows.length === 1 &&
      warnRows[0].includes('WARNING: END directive missing, starting address not set'),
    JSON.stringify(warnRows),
  );

  // Include file messages.
  await writeFile(page, '/browser/e5check/Lib.x68', '* library\r\n    BADOP\r\n');
  await writeFile(page, '/browser/e5check/main.X68', '    ORG $1000\r\n    INCLUDE lib.x68\r\n    END $1000\r\n');
  const mainId = await openDocument(page, '/browser/e5check/main.X68');
  await pressAssemble(page);
  const inc = await readStatus(page);
  check(
    `${p} include: the dialog names the assembled document`,
    inc.title === 'Assembler Status - main.X68' && inc.errors === '1',
    JSON.stringify(inc),
  );
  await closeStatus(page);
  const afterInclude = await page.evaluate(() => {
    const state = window.__easy68k.ctx.store.getState();
    const lib = state.documents.items.find((doc) => doc.path === '/browser/e5check/Lib.x68');
    return {
      activeId: state.documents.activeId,
      lib: lib?.id ?? null,
      libMessages: lib ? state.messages[lib.id] : null,
    };
  });
  check(
    `${p} include: the include file is open in a tab and the assembled document stays active`,
    afterInclude.lib !== null && afterInclude.activeId === mainId,
    JSON.stringify(afterInclude),
  );
  check(
    `${p} include: its row (line 2) is in the include file's own list`,
    JSON.stringify(afterInclude.libMessages?.map((m) => [m.line, m.text])) === '[[2,"ERROR: Invalid opcode"]]',
  );
  await page.locator('[role=tab]', { hasText: 'Lib.x68' }).first().click();
  await messageRows(page).first().waitFor({ timeout: STEP_MS });
  await shot(page, `${name}-include`);

  // Load L68.
  await writeFile(
    page,
    '/browser/e5check/run.X68',
    '    ORG $1000\r\nSTART:\r\n    MOVE.L #$12345678,D1\r\n    SIMHALT\r\n    END START\r\n',
  );
  await openDocument(page, '/browser/e5check/run.X68');
  await pressAssemble(page);
  await readStatus(page);
  await closeStatus(page, 'Load L68');
  await page.waitForFunction(
    () => window.__easy68k.ctx.store.getState().documents.items.some((doc) => doc.path === '/browser/e5check/run.L68'),
    null,
    { timeout: STEP_MS },
  );
  const listing = await activeDoc(page);
  check(
    `${p} Load L68 opens run.L68 in a new tab as a list document`,
    listing?.name === 'run.L68' && listing?.kind === 'list',
    JSON.stringify(listing),
  );
  await shot(page, `${name}-load-l68`);

  // Execute: a fresh simulator, the S-record loaded, not running.
  await page.locator('[role=tab]', { hasText: 'run.X68' }).first().click();
  await pressAssemble(page);
  await readStatus(page);
  await closeStatus(page, 'Execute');
  await page.waitForFunction(
    () => {
      const state = window.__easy68k.ctx.store.getState();
      return state.sim.program?.path === '/browser/e5check/run.S68' && state.sim.phase === 'idle';
    },
    null,
    { timeout: STEP_MS },
  );
  const sim = await page.evaluate(() => {
    const ctx = window.__easy68k.ctx;
    const state = ctx.store.getState();
    return {
      mode: state.mode,
      phase: state.sim.phase,
      pc: ctx.sim.engine.getRegister(17),
      d1: ctx.sim.engine.getRegister(1),
    };
  });
  check(
    `${p} Execute: Simulator mode, run.S68 loaded, PC at the start, not run (D1 untouched)`,
    sim.mode === 'simulator' && sim.phase === 'idle' && sim.pc === 0x1000 && sim.d1 === 0,
    JSON.stringify(sim),
  );
  await shot(page, `${name}-execute`);

  // Execute while a program waits for input: the Caution question first.
  await writeFile(
    page,
    '/browser/e5check/wait.X68',
    '    ORG $2000\r\nSTART:\r\n    MOVE.B #4,D0\r\n    TRAP #15\r\n    SIMHALT\r\n    END START\r\n',
  );
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'editor'));
  await openDocument(page, '/browser/e5check/wait.X68');
  await pressAssemble(page);
  await readStatus(page);
  await closeStatus(page, 'Execute');
  await page.waitForFunction(
    () => window.__easy68k.ctx.store.getState().sim.program?.path === '/browser/e5check/wait.S68',
    null,
    { timeout: STEP_MS },
  );
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase === 'waitInput', null, {
    timeout: STEP_MS,
  });
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'editor'));
  await page.locator('[role=tab]', { hasText: 'run.X68' }).first().click();
  await pressAssemble(page);
  await readStatus(page);
  await closeStatus(page, 'Execute');
  const caution = page.locator('[role=alertdialog]', {
    hasText: 'The current debug environment will be lost, click OK to continue.',
  });
  await caution.waitFor({ timeout: STEP_MS });
  const cautionTitle = await caution.locator('.e68-dialog__title').innerText();
  check(`${p} Execute while a program waits: the Caution question`, cautionTitle === 'Caution', cautionTitle);
  await shot(page, `${name}-caution`);
  await caution.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);
  const kept = await page.evaluate(() => {
    const state = window.__easy68k.ctx.store.getState();
    return { path: state.sim.program?.path, phase: state.sim.phase };
  });
  check(
    `${p} ... Cancel keeps the waiting program`,
    kept.path === '/browser/e5check/wait.S68' && kept.phase === 'waitInput',
    JSON.stringify(kept),
  );
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'editor'));
  await pressAssemble(page);
  await readStatus(page);
  await closeStatus(page, 'Execute');
  await caution.waitFor({ timeout: STEP_MS });
  await caution.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(
    () => {
      const state = window.__easy68k.ctx.store.getState();
      return state.sim.program?.path === '/browser/e5check/run.S68' && state.sim.phase === 'idle';
    },
    null,
    { timeout: STEP_MS },
  );
  const fresh = await page.evaluate(() => window.__easy68k.ctx.sim.engine.getRegister(17));
  check(`${p} ... OK loads the new program afresh (PC $1000)`, fresh === 0x1000, String(fresh));

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function themePass(browser, name) {
  for (const themeName of ['light', 'dark']) {
    const { context, page, errors } = await openApp(browser);
    await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), themeName);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, themeName);
    await setText(page, BAD.replace('SIMHALT\n', 'SIMHALT\n    BAR\n'));
    await pressAssemble(page);
    await readStatus(page);
    await scan(page, '.e68-asm-status', `${name} ${themeName} status dialog`);
    await shot(page, `${name}-${themeName}-status`);
    await closeStatus(page);
    await messageRows(page).first().waitFor({ timeout: STEP_MS });
    await scan(page, '[data-e68-workspace="editor"] [data-e68-panel="messages"]', `${name} ${themeName} message list`);
    await shot(page, `${name}-${themeName}-messages`);
    check(`${name}: ${themeName}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
}

// --- run -----------------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No file watching and no hot reload: other packages edit files while this runs.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}\nKeys: ${keysChoice}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      const passes = [
        ['assemble', assemblePass],
        ['themes and accessibility', themePass],
      ];
      try {
        for (const [label, pass] of passes) {
          console.log(`\n[${name}, ${label}]`);
          try {
            await pass(browser, name);
          } catch (error) {
            check(
              `${name}: the ${label} pass ran to its end`,
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

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
