// Browser check of the Break Points panel (ARCHITECTURE.md 2.6, 9.4 U3). Owner: U3.
//
//   node app/src/features/breakpoints/check-breakpoints.mjs [--browser chromium|webkit|all] [--out <dir>]
//                                                            [--without-engines]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright). What the unit tests under Node cannot show:
//
//   1. In the application as it starts: View > Break Points shows the panel with its three groups,
//      49 numbered rows per grid and every button disabled, and puts the focus into the Registers
//      grid. With real clicks and keys: a double-click shows the editors in the first free row;
//      Enter in an editor and the Set button store the row (Enter in an empty Expression editor
//      does nothing, as the original's disabled Set); the Expression Builder's buttons follow
//      the grammar of sim-ui §12.2 and build `R1 AND A1`; the original's message boxes (`Select a
//      Valid Row.`, `Invalid PC/Reg Breakpoint. ...`); Clear of a condition that an expression uses
//      asks for confirmation, removes that expression and renumbers the others; Escape hides the
//      editors without storing. Screenshots and an accessibility scan in both themes.
//   2. With the application's own simulator session (features/run, SH8: the real engine and run
//      controller): a program assembled by the real assembler is opened with File > Open; a write
//      condition entered in the panel stops it after the BSR that pushed its return address (message
//      `break point at 1014`); a cold start empties the grids and the program then runs to its end.
//
// Nothing waits a fixed time: every step waits for the state it expects (up to WAIT ms). Nothing
// depends on the operating system: the check uses clicks, Enter and Escape only.
//
// Without engine/dist (or with --without-engines) part 1 still runs and the expected engine-load
// errors are printed but not counted; part 2 is skipped, or fails when EASY68K_REQUIRE_ENGINES=1.
//
// Screenshots go to build/U3/breakpoints-check (git-ignored). Prints "N of M checks passed"; exit
// code 0 = everything passed and no console error.

/* global console, process, document, window, setTimeout -- the browser globals are used inside page.evaluate() callbacks */

import { existsSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'U3', 'breakpoints-check')));
mkdirSync(outDir, { recursive: true });
const withoutEngines = args.includes('--without-engines');

const enginesBuilt =
  !withoutEngines &&
  ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((file) =>
    existsSync(join(repoRoot, 'engine', 'dist', file)),
  );
const isEngineFile = (url) => /\/engine\/dist\//.test(url);

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let pageErrors = [];
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** A free TCP port, found by asking the system for one. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

const LOAD_TIMEOUT = 180_000;
const WAIT = 30_000;

const isLoadTimeout = (text) => /Failed to load resource.*Timeout was reached/i.test(text);
const isMissingEngine = (text) =>
  !enginesBuilt &&
  ((/Failed to load resource/i.test(text) && isEngineFile(text)) ||
    /simulator engine could not be created/i.test(text));

function reportErrors(prefix, errors) {
  const ignored = (text) => isLoadTimeout(text) || isMissingEngine(text);
  const timeouts = errors.filter(isLoadTimeout);
  const missing = errors.filter(isMissingEngine);
  const real = errors.filter((text) => !ignored(text));
  if (timeouts.length) console.log(`        not counted: ${timeouts.length} x "${timeouts[0]}"`);
  if (missing.length) console.log(`        not counted (no engines): ${missing.length} x "${missing[0]}"`);
  check(`${prefix} no console or page errors`, real.length === 0, real.slice(0, 3).join(' | '));
}

const until = (page, fn, arg, timeout = WAIT) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1200 }, reducedMotion: 'reduce' });
  if (withoutEngines) {
    await context.route(
      (url) => isEngineFile(url.pathname),
      (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }),
    );
  }
  const page = await context.newPage();
  const errors = [];
  pageErrors = errors;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location()?.url ?? '';
    const text = message.text();
    errors.push(/Failed to load resource/i.test(text) && url && !text.includes(url) ? `${text} (${url})` : text);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  let outdated;
  page.on('response', (response) => {
    if (response.status() === 504) outdated = true;
  });
  for (let attempt = 1; ; attempt++) {
    outdated = false;
    errors.length = 0;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    const started = Date.now();
    let ready = false;
    while (!ready && !outdated && Date.now() - started < LOAD_TIMEOUT) {
      ready = await page
        .evaluate(() => window.__easy68k !== undefined && document.querySelector('.e68-shell') !== null)
        .catch(() => false);
      if (!ready) await new Promise((wake) => setTimeout(wake, 250));
    }
    if (ready) break;
    if (!outdated || attempt >= 3) {
      throw new Error(`the application did not start (attempt ${attempt}): ${errors.slice(0, 3).join(' | ')}`);
    }
    console.log('        the development server bundled its dependencies again; loading the page again');
  }
  return { context, page, errors };
}

async function scanPanel(page, label) {
  const result = await new AxeBuilder({ page })
    .include('.e68-bp')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  // Every finding counts. (Until gate I2 the DataGrid's scrolling body was reported as
  // scrollable-region-focusable and not counted; W2 made the focused grid the scroll container:
  // docs/requests/U3-datagrid-scroll-region.md, errata W2 entry 20.)
  const violations = result.violations;
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious finding in the panel`, serious.length === 0, describe(serious).join('; '));
  const other = violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

/** What the panel shows, read from the DOM (runs in the page). */
function readPanelInPage() {
  const root = document.querySelector('.e68-bp');
  if (!root) return null;
  const grid = (id) => {
    const element = root.querySelector(`[data-bp-group="${id}"] [role="grid"]`);
    const rows = Array.from(element.querySelectorAll('[role="row"][data-row]'));
    const editorRow = rows.find((row) => row.querySelector('.e68-bp__editor, [data-bp-draft]'));
    return {
      label: element.getAttribute('aria-label'),
      headers: Array.from(element.querySelectorAll('[role="columnheader"]')).map((h) => h.textContent),
      rowCount: rows.length,
      numbers: rows.map((row) => row.querySelector('[role="rowheader"]')?.textContent),
      rows: rows
        .filter((row) => row !== editorRow)
        .map((row) => Array.from(row.querySelectorAll('[role="gridcell"]')).map((cell) => cell.textContent))
        .filter((cells) => cells.some((text) => text !== '')),
      editingRow: editorRow ? Number(editorRow.getAttribute('data-row')) : -1,
      focusMark: element.hasAttribute('data-e68-panel-focus'),
    };
  };
  return {
    legends: Array.from(root.querySelectorAll('legend')).map((l) => l.textContent),
    registers: grid('registers'),
    memory: grid('memory'),
    expressions: grid('expressions'),
    buttons: Object.fromEntries(
      Array.from(root.querySelectorAll('[data-bp-button]')).map((b) => [b.getAttribute('data-bp-button'), !b.disabled]),
    ),
    enabled: Array.from(root.querySelectorAll('[data-bp-button]'))
      .filter((b) => !b.disabled)
      .map((b) => b.getAttribute('data-bp-button'))
      .sort(),
    /** The enabled buttons of the Expression Builder group (its Set / Clear / Clear All and the builder row). */
    exprEnabled: Array.from(root.querySelectorAll('[data-bp-group="expressions"] [data-bp-button]'))
      .filter((b) => !b.disabled)
      .map((b) => b.getAttribute('data-bp-button'))
      .sort(),
    draft: root.querySelector('[data-bp-draft]')?.textContent ?? null,
    regField: root.querySelector('input[data-bp-field="reg"]')?.value ?? null,
    memField: root.querySelector('input[data-bp-field="mem"]')?.value ?? null,
    focused: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? null,
  };
}

const readPanel = (page) => page.evaluate(readPanelInPage);
const installReader = (page) => page.evaluate(`window.__bpRead = ${readPanelInPage.toString()};`);
const untilPanel = (page, predicate, timeout = WAIT) =>
  page
    .waitForFunction(
      `(() => { const panel = window.__bpRead(); return !!panel && (${predicate})(panel); })()`,
      undefined,
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A cell of a grid. */
const cell = (page, grid, row, column = 0) =>
  page.locator(`[data-bp-group="${grid}"] [role="row"][data-row="${row}"] [role="gridcell"]`).nth(column);
const button = (page, name) => page.locator(`[data-bp-button="${name}"]`);

/** The open message box: its title and text; null when none is open. */
const messageBox = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('[role="alertdialog"]');
    if (!box) return null;
    return {
      title: box.querySelector('.e68-dialog__title')?.textContent ?? '',
      text: box.querySelector('.e68-messagebox__text')?.textContent ?? '',
      buttons: Array.from(box.querySelectorAll('button'))
        .map((b) => b.textContent.trim())
        .filter((t) => t !== '' && t !== '×'),
    };
  });
const waitMessageBox = (page) =>
  page
    .waitForSelector('[role="alertdialog"]', { timeout: WAIT })
    .then(() => messageBox(page))
    .catch(() => null);
async function answer(page, caption) {
  await page.locator('[role="alertdialog"] button', { hasText: new RegExp(`^${caption}$`) }).click();
  await page.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: WAIT }).catch(() => undefined);
}

/** Types into a masked field: click it, go to its start, type the digits. */
async function typeInto(page, locator, text) {
  await locator.click();
  await page.keyboard.press('Home');
  await page.keyboard.type(text);
}

/** Screenshots of the panel as it shows, and of the Expression Builder group scrolled into view. */
async function shoot(page, base) {
  await page.locator('.e68-bp').screenshot({ path: join(outDir, `${base}.png`) });
  const group = page.locator('[data-bp-group="expressions"]');
  await group.scrollIntoViewIfNeeded();
  await group.screenshot({ path: join(outDir, `${base}-expressions.png`) });
  await page.locator('[data-bp-group="registers"]').scrollIntoViewIfNeeded();
}

/** Opens the panel in Simulator mode. */
async function showPanel(page) {
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'simulator'));
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.breakpoints'));
  const shown = await page.waitForSelector('.e68-bp', { timeout: WAIT }).then(
    () => true,
    () => false,
  );
  if (shown) await installReader(page);
  // The application's own start is a cold start, which empties the grids when it ends (4.7.1):
  // wait for it before entering anything. Without engines the phase still leaves 'loading'.
  await until(page, () => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', undefined, LOAD_TIMEOUT);
  return shown;
}

/** Part 1: the panel and its editors in the application as it starts. */
async function shellPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  check(`${p} View > Break Points shows the panel`, await showPanel(page));
  let panel = await readPanel(page);
  if (!panel) {
    await closeWithin(context);
    return;
  }
  check(
    `${p} three groups Registers, Memory, Expression Builder`,
    same(panel.legends, ['Registers', 'Memory', 'Expression Builder']),
    JSON.stringify(panel.legends),
  );
  check(
    `${p} the columns of sim-ui §12.2`,
    same(panel.registers.headers, ['Row', 'PC/Reg', 'Op', 'Value', 'Size']) &&
      same(panel.memory.headers, ['Row', 'Address', 'Op', 'Value', 'Size', 'R/W']) &&
      same(panel.expressions.headers, ['Row', 'Enabled', 'Expression', 'Count']),
    `${panel.registers.headers.join('|')} / ${panel.memory.headers.join('|')} / ${panel.expressions.headers.join('|')}`,
  );
  check(
    `${p} 49 numbered rows per grid, all empty`,
    [panel.registers, panel.memory, panel.expressions].every(
      (g) => g.rowCount === 49 && g.numbers[0] === '1' && g.numbers[48] === '49' && g.rows.length === 0,
    ),
  );
  check(`${p} every button disabled at start`, panel.enabled.length === 0, panel.enabled.join());
  check(
    `${p} the focus is in the Registers grid`,
    (await until(page, () => document.activeElement?.getAttribute('aria-label') === 'Register conditions')) &&
      panel.registers.focusMark,
    `${(await readPanel(page)).focused}`,
  );
  await shoot(page, `${name}-light-empty`);

  // A register condition: double-click row 6 -> the editors stand in row 1.
  await cell(page, 'registers', 5).dblclick();
  check(
    `${p} a double-click beyond the defined rows edits the first free row; Set on, Clear off`,
    await untilPanel(
      page,
      (s) => s.registers.editingRow === 0 && s.buttons['registers-set'] && !s.buttons['registers-clear'],
    ),
    JSON.stringify((await readPanel(page)).buttons),
  );
  await page.locator('[aria-label="PC/Reg of row 1"]').selectOption({ label: 'D0' });
  await page.locator('[aria-label="Op of row 1"]').selectOption({ label: '>=' });
  await typeInto(page, page.locator('[aria-label="Value of row 1"]'), '00000005');
  await page.keyboard.press('Enter');
  check(
    `${p} Enter in an editor stores the row: D0 >= 00000005 L`,
    await untilPanel(page, (s) => s.registers.editingRow === -1 && s.registers.rows.length === 1),
    JSON.stringify((await readPanel(page)).registers.rows),
  );
  panel = await readPanel(page);
  check(
    `${p} the stored row`,
    same(panel.registers.rows[0], ['D0', '>=', '00000005', 'L']),
    JSON.stringify(panel.registers.rows),
  );
  check(
    `${p} Clear and Clear All are enabled with a defined row`,
    panel.buttons['registers-clear'] && panel.buttons['registers-clearAll'] && !panel.buttons['registers-set'],
  );

  // A second register condition, then Escape on a third discards it.
  await cell(page, 'registers', 1).dblclick();
  await page.locator('[aria-label="PC/Reg of row 2"]').selectOption({ label: 'PC' });
  await button(page, 'registers-set').click();
  await untilPanel(page, (s) => s.registers.rows.length === 2);
  await cell(page, 'registers', 2).dblclick();
  await untilPanel(page, (s) => s.registers.editingRow === 2);
  await page.locator('[aria-label="PC/Reg of row 3"]').focus();
  await page.keyboard.press('Escape');
  check(
    `${p} Escape hides the editors without storing`,
    await untilPanel(page, (s) => s.registers.editingRow === -1 && s.registers.rows.length === 2),
    JSON.stringify((await readPanel(page)).registers.rows),
  );

  // A memory condition.
  await cell(page, 'memory', 0).dblclick();
  await page.waitForSelector('[aria-label="Address of row 1"]', { timeout: WAIT });
  await typeInto(page, page.locator('[aria-label="Address of row 1"]'), '00007FFC');
  await page.locator('[aria-label="R/W of row 1"]').selectOption({ label: 'Write' });
  await page.locator('[aria-label="Op of row 1"]').last().selectOption({ label: 'N/A' });
  await button(page, 'memory-set').click();
  check(
    `${p} the Memory row: 00007FFC N/A 00000000 L Write`,
    await untilPanel(page, (s) => s.memory.rows.length === 1),
    JSON.stringify((await readPanel(page)).memory.rows),
  );
  panel = await readPanel(page);
  check(`${p} the stored memory row`, same(panel.memory.rows[0], ['00007FFC', 'N/A', '00000000', 'L', 'Write']));

  // A click on a register row puts its number into the builder field (clamped to the defined rows).
  await cell(page, 'registers', 1).click();
  const second = await untilPanel(page, (s) => s.regField === '02');
  await cell(page, 'registers', 20).click();
  const clamped = await untilPanel(page, (s) => s.regField === '02');
  await cell(page, 'registers', 0).click();
  check(
    `${p} a click copies the row number into the builder field, clamped (02, 02, 01)`,
    second && clamped && (await untilPanel(page, (s) => s.regField === '01')),
    `${(await readPanel(page)).regField}`,
  );

  // An expression: the grammar of the builder buttons.
  await cell(page, 'expressions', 3).dblclick();
  check(
    `${p} editing an expression: only PC/Reg, Memory and ( are enabled; Set is off`,
    await untilPanel(page, (s) => JSON.stringify(s.exprEnabled) === JSON.stringify(['lparen', 'mem', 'reg'])),
    (await readPanel(page)).exprEnabled.join(),
  );
  // Enter stands for Set, which is disabled for an empty expression: no message box, the editors
  // stay (review of U3; errata U3.md entry 2). A message box would be modal and block the click on
  // PC/Reg that follows, so the next check also shows that none opened.
  await page.locator('[aria-label="Count of row 1"]').press('Enter');
  await button(page, 'reg').click();
  check(
    `${p} Enter in an empty expression editor does nothing (no "Fields missing")`,
    (await untilPanel(page, (s) => s.draft === ' R1  ' && s.expressions.editingRow === 0)) &&
      (await messageBox(page)) === null,
    JSON.stringify({ box: await messageBox(page), draft: (await readPanel(page)).draft }),
  );
  check(
    `${p} after R1: AND, OR, Backspace and Set`,
    await untilPanel(
      page,
      (s) => JSON.stringify(s.exprEnabled) === JSON.stringify(['and', 'backspace', 'expressions-set', 'or']),
    ),
    (await readPanel(page)).exprEnabled.join(),
  );
  await button(page, 'and').click();
  await typeInto(page, page.locator('input[data-bp-field="mem"]'), '01');
  await button(page, 'mem').click();
  check(
    `${p} the draft reads " R1   AND  A1 "`,
    await untilPanel(page, (s) => s.draft === ' R1   AND  A1 '),
    JSON.stringify((await readPanel(page)).draft),
  );
  await button(page, 'backspace').click();
  const afterBackspace = await untilPanel(page, (s) => s.draft === ' R1   AND ');
  await button(page, 'mem').click();
  check(
    `${p} Backspace removes exactly one token`,
    afterBackspace && (await untilPanel(page, (s) => s.draft === ' R1   AND  A1 ')),
    JSON.stringify((await readPanel(page)).draft),
  );
  await button(page, 'expressions-set').click();
  check(
    `${p} Set stores ON |  R1   AND  A1  | 01`,
    await untilPanel(page, (s) => s.expressions.rows.length === 1),
    JSON.stringify((await readPanel(page)).expressions.rows),
  );
  panel = await readPanel(page);
  check(`${p} the stored expression`, same(panel.expressions.rows[0], ['ON', ' R1   AND  A1 ', '01']));

  // A second expression R2.
  await cell(page, 'expressions', 1).dblclick();
  await typeInto(page, page.locator('input[data-bp-field="reg"]'), '02');
  await button(page, 'reg').click();
  await button(page, 'expressions-set').click();
  await untilPanel(page, (s) => s.expressions.rows.length === 2);

  // Messages.
  await cell(page, 'expressions', 10).click();
  await button(page, 'expressions-clear').click();
  let box = await waitMessageBox(page);
  check(
    `${p} Clear on an empty row: "Select a Valid Row." (title Error)`,
    box?.title === 'Error' && box?.text === 'Select a Valid Row.' && same(box?.buttons, ['OK']),
    JSON.stringify(box),
  );
  await shoot(page, `${name}-light-message`);
  await answer(page, 'OK');
  await cell(page, 'expressions', 5).dblclick();
  await typeInto(page, page.locator('input[data-bp-field="reg"]'), '07');
  await button(page, 'reg').click();
  box = await waitMessageBox(page);
  check(
    `${p} PC/Reg with an undefined number: the original's message`,
    box?.text === 'Invalid PC/Reg Breakpoint. Set PC/Reg in Registers area first.',
    JSON.stringify(box),
  );
  await answer(page, 'OK');
  check(
    `${p} after the refused append nothing was added: AND / OR stay disabled`,
    await untilPanel(page, (s) => s.draft === '' && !s.buttons.and),
    JSON.stringify((await readPanel(page)).draft),
  );
  await cell(page, 'expressions', 0).click();
  check(
    `${p} a click on another row hides the editors`,
    await untilPanel(page, (s) => s.expressions.editingRow === -1),
  );

  // Clear of register condition 1, which expression 1 uses: confirmation, removal, renumbering.
  await cell(page, 'registers', 0).click();
  await button(page, 'registers-clear').click();
  box = await waitMessageBox(page);
  check(
    `${p} Clear of a used condition asks first`,
    box?.text === 'Expression 1 uses this condition and is removed with it.' && same(box?.buttons, ['OK', 'Cancel']),
    JSON.stringify(box),
  );
  await shoot(page, `${name}-light-confirm`);
  await answer(page, 'Cancel');
  panel = await readPanel(page);
  check(`${p} Cancel keeps everything`, panel.registers.rows.length === 2 && panel.expressions.rows.length === 2);
  await button(page, 'registers-clear').click();
  await waitMessageBox(page);
  await answer(page, 'OK');
  check(
    `${p} OK: the row is removed, expression 1 with it, and R2 is renumbered R1`,
    await untilPanel(
      page,
      (s) =>
        s.registers.rows.length === 1 &&
        s.registers.rows[0][0] === 'PC' &&
        JSON.stringify(s.expressions.rows) === JSON.stringify([['ON', ' R1  ', '01']]),
    ),
    JSON.stringify((await readPanel(page)).expressions.rows),
  );
  await shoot(page, `${name}-light-filled`);
  await scanPanel(page, `${name} light`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await cell(page, 'memory', 0).dblclick();
  await page.waitForSelector('[aria-label="Address of row 1"]', { timeout: WAIT });
  await shoot(page, `${name}-dark-editing`);
  await scanPanel(page, `${name} dark, editing`);
  reportErrors(p, errors);
  await closeWithin(context);
}

const SOURCE = [
  '        ORG     $1000',
  'START   MOVEA.L #$8000,A7',
  '        MOVE.B  #$AA,$3000',
  '        BSR     SUB',
  '        SIMHALT',
  'SUB     RTS',
  '        END     START',
];

async function assembleProgram() {
  const { assemble } = await import(pathToFileURL(join(repoRoot, 'engine', 'asm', 'asm68k.mjs')).href);
  const source = SOURCE.map((line) => `${line}\r\n`).join('');
  const files = new Map([['bpcheck.X68', Uint8Array.from(source, (ch) => ch.charCodeAt(0))]]);
  const result = await assemble('bpcheck.X68', files, {}, new Date(2026, 0, 1));
  if (result.errorCount > 0 || !result.sRecord || !result.listing) {
    throw new Error(`The test program does not assemble: ${result.messages.map((m) => m.text).join('; ')}`);
  }
  return { s68: [...result.sRecord], l68: [...result.listing] };
}

/** Part 2: the panel on the application's real simulator session. */
async function enginePass(browser, name, program) {
  const p = `${name} (real engine):`;
  const { context, page, errors } = await openApp(browser);
  await page.evaluate(async (file) => {
    const { ctx } = window.__easy68k;
    await ctx.vfs.writeFile('/browser/bpcheck/bpcheck.S68', Uint8Array.from(file.s68));
    await ctx.vfs.writeFile('/browser/bpcheck/bpcheck.L68', Uint8Array.from(file.l68));
  }, program);
  await showPanel(page);
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase === 'idle', undefined, {
    timeout: LOAD_TIMEOUT,
  });
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.open('/browser/bpcheck/bpcheck.S68', 'open'));
  check(
    `${p} File > Open loads the program`,
    await until(page, () => {
      const sim = window.__easy68k.ctx.store.getState().sim;
      return sim.phase === 'idle' && sim.program?.path === '/browser/bpcheck/bpcheck.S68';
    }),
  );

  // Memory condition $7FFC, Write, and the expression A1.
  await cell(page, 'memory', 0).dblclick();
  await page.waitForSelector('[aria-label="Address of row 1"]', { timeout: WAIT });
  await typeInto(page, page.locator('[aria-label="Address of row 1"]'), '00007FFC');
  await page.locator('[aria-label="R/W of row 1"]').selectOption({ label: 'Write' });
  await page.locator('[aria-label="Op of row 1"]').selectOption({ label: 'N/A' });
  await page.locator('[aria-label="Address of row 1"]').press('Enter');
  await untilPanel(page, (s) => s.memory.rows.length === 1);
  await cell(page, 'expressions', 0).dblclick();
  await typeInto(page, page.locator('input[data-bp-field="mem"]'), '01');
  await button(page, 'mem').click();
  await button(page, 'expressions-set').click();
  check(`${p} the expression A1 is stored`, await untilPanel(page, (s) => s.expressions.rows.length === 1));

  await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
  const stopped = await until(page, () => {
    const { ctx } = window.__easy68k;
    const sim = ctx.store.getState().sim;
    return sim.phase === 'idle' && ctx.sim.engine.registers().pc === 0x1014;
  });
  const state = await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    const sim = ctx.store.getState().sim;
    return { pc: ctx.sim.engine.registers().pc.toString(16), halted: sim.halted, lines: sim.messageLines.slice(-3) };
  });
  check(
    `${p} Run stops after the BSR that wrote $7FFC (PC $1014, "break point at 1014")`,
    stopped && !state.halted && state.lines.some((line) => line.includes('break point at 1014')),
    JSON.stringify(state),
  );
  await shoot(page, `${name}-light-stopped`);
  // The whole window: the panel beside its neighbours (listing, registers, messages) at the stop.
  await page.screenshot({ path: join(outDir, `${name}-window-stopped.png`) });

  await page.evaluate(() => window.__easy68k.ctx.sim.controller.coldStart());
  check(
    `${p} after a cold start the grids are empty`,
    await untilPanel(page, (s) => s.registers.rows.length + s.memory.rows.length + s.expressions.rows.length === 0),
  );
  await until(page, () => window.__easy68k.ctx.store.getState().sim.phase === 'idle');
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.open('/browser/bpcheck/bpcheck.S68', 'open'));
  await until(page, () => window.__easy68k.ctx.store.getState().sim.program?.path === '/browser/bpcheck/bpcheck.S68');
  await until(page, () => window.__easy68k.ctx.store.getState().sim.phase === 'idle');
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
  check(
    `${p} and the program then runs to its SIMHALT`,
    await until(page, () => {
      const sim = window.__easy68k.ctx.store.getState().sim;
      return sim.phase === 'idle' && sim.halted;
    }),
  );
  reportErrors(p, errors);
  await closeWithin(context);
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  const program = enginesBuilt ? await assembleProgram() : null;
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        console.log(`\n[${name}, panel]`);
        await shellPass(browser, name);
        console.log(`\n[${name}, real engine]`);
        if (program) await enginePass(browser, name, program);
        else if (process.env.EASY68K_REQUIRE_ENGINES === '1') {
          check(
            `${name}: engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)`,
            false,
            'run npm run build:engines',
          );
        } else console.log('  skipped: engine/dist is missing (npm run build:engines)');
      } catch (error) {
        check(`${name}: the check ran to its end`, false, String(error?.stack ?? error));
        if (pageErrors.length) console.log(`        page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
      } finally {
        await doneWith(browser, { last: name === browsers.at(-1) });
      }
    }
  } finally {
    closeAtEnd(server);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
