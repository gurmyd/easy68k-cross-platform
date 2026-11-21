// The scenario of integration gate I1 (ARCHITECTURE.md 9.3) on the real application. Owner: I1.
//
//   node tests/integration/wave1/check-wave1.mjs [--browser chromium|webkit|all] [--out <dir>]
//                                                [--only student,prompt,trace,hardware,draw,tour,reload]
//
// Starts the Vite dev server of app/ on a free port and drives the application in headless
// Chromium and WebKit (Playwright) the way a student meets it: through the menus, the toolbar,
// the file dialogs, the Files panel and the keyboard. Nothing is replaced by a test double; the
// page object `window.__easy68k` (development builds only, main.tsx) is used to READ state for the
// comparisons, never to act.
//
//   student    Help > Examples..., open tutorial1.X68 in the editor; import a prebuilt .S68 and
//              .L68; File > Open in the simulator; run to the halt with text output; Rewind and run
//              again; Close and open again; close the document and open it again; change it and
//              save it with the keyboard (the bytes in the store are checked)
//   prompt     a task 2 prompt takes typed text; a program that waits for one key
//   trace      Run, Pause, Trace Into, Step Over; the Registers, Listing, Memory and Stack panels follow
//   hardware   the Hardware panel follows a running program, and the program follows its switches
//   draw       a program that draws: the pixels are on the canvas
//   tour       every official example is loaded (the listing must mark the PC row) and run; the page
//              is compared with the headless session; a running program must not be called halted
//   reload     the page is reloaded: the files are still there, the program runs again
//
// Chromium runs with the Windows key map and WebKit with the macOS key map (the page is told so
// before it starts), so that the result is the same on every machine.
//
// The .S68 and .L68 files are assembled here with the real assembler from the official examples
// in app/public/examples and from the small programs of fixtures.ts (loaded through the dev server,
// which also runs each program in the headless session of 6.4 to learn what it prints).
//
// Screenshots go to build/I1/wave1-check (git-ignored). Prints "N of M checks passed"; the exit
// code is 0 only if every check passed and no page logged an error. Needs engine/dist.

/* global document, window -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const appRoot = join(repoRoot, 'app');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'I1', 'wave1-check')));
const only = option('--only', '')
  .split(',')
  .filter((part) => part !== '');
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
/** The key map each browser runs with. */
const OS_OF = { chromium: 'windows', webkit: 'mac' };

/** The first page load of the dev server can take minutes on a busy machine. */
const LOAD_TIMEOUT = 240_000;
/** How long a step of the interface may take before it counts as hanging. */
const STEP_TIMEOUT = 20_000;

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const notes = [];
/** Something worth reading that is not a failure (listed again at the end). */
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = (value, digits = 8) => (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');

// --- the page ---------------------------------------------------------------------------------

function pretendMac() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}
function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function newContext(browser, os) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(os === 'mac' ? pretendMac : pretendWindows);
  return context;
}

/** Console errors and warnings of a page, and uncaught errors. */
function watch(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

async function waitForApp(page) {
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: LOAD_TIMEOUT });
  // The simulator session starts its engine right after start-up.
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, {
    timeout: 60_000,
  });
}

async function openApp(context) {
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await waitForApp(page);
  return { page, errors };
}

// --- what a student does ------------------------------------------------------------------------

/** Opens a menu of the menu bar and chooses an item, with the mouse. */
async function menu(page, title, item) {
  await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: new RegExp(`^${title}$`) }).click();
  await page.locator('[role=menu][data-e68-menu] [role^=menuitem]', { hasText: item }).first().click();
}

const setMode = (page, mode) => page.locator(`.e68-modeswitch [data-mode="${mode}"]`).click();
const toolbarButton = (page, id) => page.locator(`.e68-shell__toolbar [data-command="${id}"]`);
const filesRow = (page, name) => page.locator('[data-e68-panel="files"] [role=treeitem]', { hasText: name });
const modalDialog = (page) => page.locator('[role=dialog][aria-modal=true]');

/** A key press that a polling program can see (6.6: hold keys). */
const press = (page, key) => page.keyboard.press(key, { delay: 60 });

/** Imports files into "My Programs" through the Files panel: Import... > Files or .zip... */
async function importFiles(page, files) {
  await setMode(page, 'editor');
  await filesRow(page, 'My Programs').first().click();
  await page.locator('[data-e68-panel="files"] button[aria-label="Import..."]').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: STEP_TIMEOUT }),
    page.getByRole('menuitem', { name: /Files or \.zip/ }).click(),
  ]);
  await chooser.setFiles(
    files.map((file) => ({ name: file.name, mimeType: 'application/octet-stream', buffer: Buffer.from(file.data) })),
  );
  const toast = page.locator('.e68-toast', { hasText: `Imported ${files.length} file` });
  await toast.first().waitFor({ timeout: STEP_TIMEOUT });
  return toast.first().innerText();
}

/** The two files of an assembled program, as the Files panel imports them. */
const filesOf = (program) => [
  { name: program.s68Name, data: program.s68 },
  { name: program.l68Name, data: program.l68 },
];

/** Answers the simulator's `Caution` question with OK if it is on screen. */
async function answerCaution(page) {
  const box = page.locator('[role=alertdialog]');
  if ((await box.count()) > 0) await box.getByRole('button', { name: 'OK' }).click();
}

/**
 * Simulator: File > Open, the given way ('menu', 'toolbar' or 'key'), then the file in the port's
 * Open dialog. Returns what the dialog showed.
 */
async function openProgram(page, name, how = 'toolbar', os = 'windows') {
  if (how === 'menu') await menu(page, 'File', /^Open\.\.\./);
  else if (how === 'key') {
    await page.locator('[data-e68-workspace="simulator"] [data-e68-panel="listing"] [data-e68-panel-focus]').focus();
    await press(page, os === 'mac' ? 'Meta+KeyO' : 'Control+KeyO');
  } else await toolbarButton(page, 'sim.file.open').click();
  await page.waitForTimeout(150);
  await answerCaution(page);
  const dialog = modalDialog(page);
  await dialog.waitFor({ timeout: STEP_TIMEOUT });
  const shown = {
    title: await dialog.locator('h2').innerText(),
    listed: await dialog.locator('[role=option]').allInnerTexts(),
    filter: await dialog
      .locator('select')
      .last()
      .evaluate((select) => select.selectedOptions[0]?.textContent ?? ''),
  };
  await dialog.locator('[role=option]', { hasText: name }).first().click();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: STEP_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, {
    timeout: STEP_TIMEOUT,
  });
  return shown;
}

// --- what is on screen ---------------------------------------------------------------------------

const sim = (page) =>
  page.evaluate(() => {
    const s = window.__easy68k.ctx.store.getState().sim;
    return { phase: s.phase, halted: s.halted, menuState: s.menuState, program: s.program, messages: s.messageLines };
  });
const waitFor = (page, predicate, arg, timeout = STEP_TIMEOUT) =>
  page.waitForFunction(predicate, arg, { timeout }).then(
    () => true,
    () => false,
  );
const waitForHalt = (page, timeout = STEP_TIMEOUT) =>
  waitFor(
    page,
    () => {
      const s = window.__easy68k.ctx.store.getState().sim;
      return s.phase === 'idle' && s.halted;
    },
    null,
    timeout,
  );
const waitForPhase = (page, phase, timeout = STEP_TIMEOUT) =>
  waitFor(page, (wanted) => window.__easy68k.ctx.store.getState().sim.phase === wanted, phase, timeout);

const SIM = '[data-e68-workspace="simulator"]';
const statusText = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-e68-status]')].map((cell) => cell.textContent).join(' | '));

/** The register fields on screen, by their labels: { D0: '00000000', ..., PC, SR, SS, US }. */
const registerFields = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-e68-panel="registers"] label')].map((label) => [
        (label.textContent ?? '').replace('=', '').trim(),
        document.getElementById(label.htmlFor)?.value ?? null,
      ]),
    ),
  );
/** The registers of the engine (read only), in the form of the fields. */
const engineRegisters = (page) =>
  page.evaluate(() => {
    const { engine } = window.__easy68k.ctx.sim;
    const h = (value) => (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const out = {};
    for (let i = 0; i < 8; i++) out[`D${i}`] = h(engine.getRegister(i));
    for (let i = 0; i < 7; i++) out[`A${i}`] = h(engine.getRegister(8 + i));
    out.A7 = h(engine.getRegister(19));
    out.PC = h(engine.getRegister(17));
    return out;
  });
const engineBytes = (page, address, count) =>
  page.evaluate(([at, n]) => [...window.__easy68k.ctx.sim.engine.memory.subarray(at, at + n)], [address, count]);

/** The highlighted row of the listing as it is on screen ('' when none is rendered). */
const highlightedRow = (page) =>
  page.evaluate(
    () => document.querySelector('[data-e68-panel="listing"] [role=option][aria-selected=true]')?.textContent ?? '',
  );
const cyclesShown = (page) => page.locator(`${SIM} .e68-regs__cycles`).innerText();

/** The text of the Output panel as assistive technology reads it: rows without trailing blanks. */
async function outputRows(page) {
  // One element per row; textContent keeps the spaces of a row (innerText would collapse them).
  const rows = await page
    .locator(`${SIM} [data-e68-panel="output"] [role=log] > div`)
    .evaluateAll((elements) => elements.map((element) => (element.textContent ?? '').replace(/\s+$/, '')));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}
/** Waits until the Output panel's text equals `expected` (its mirror follows twice a second). */
async function outputBecomes(page, expected, timeout = 6000) {
  for (const deadline = Date.now() + timeout; ;) {
    const rows = await outputRows(page);
    if (same(rows, expected) || Date.now() > deadline) return rows;
    await page.waitForTimeout(150);
  }
}
/** The colour of one pixel of the Output canvas as 'BBGGRR' (the simulator's order). */
const canvasPixel = (page, x, y) =>
  page.evaluate(
    ([px, py]) => {
      const canvas = document.querySelector('.e68-output__canvas');
      const data = canvas.getContext('2d').getImageData(px, py, 1, 1).data;
      return [data[2], data[1], data[0]].map((part) => part.toString(16).toUpperCase().padStart(2, '0')).join('');
    },
    [x, y],
  );
/** How many pixels of a band of the Output canvas are not black. */
const litPixels = (page, y0, y1) =>
  page.evaluate(
    ([top, bottom]) => {
      const canvas = document.querySelector('.e68-output__canvas');
      const data = canvas.getContext('2d').getImageData(0, top, canvas.width, bottom - top).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 0) lit++;
      return lit;
    },
    [y0, y1],
  );
const focusPlace = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return `${element?.tagName.toLowerCase() ?? 'none'} in ${element?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? 'no panel'}`;
  });

/** Shows a tool panel through the View menu and returns its region. */
async function showTool(page, caption, id) {
  await menu(page, 'View', new RegExp(`^${caption}`));
  const region = page.locator(`${SIM} [data-e68-panel="${id}"]`);
  await region.waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  return region;
}
/**
 * Types an address into the Memory panel's Address field the way its mask takes it: Home, then the
 * six digits over the old ones, then Enter. (Select All differs between the key maps, and
 * Playwright's WebKit on Windows does not take Cmd+A as Select All.)
 */
async function goToAddress(page, digits) {
  const address = page.locator(`${SIM} [data-e68-panel="memory"] input[aria-label="Address"]`);
  await address.click();
  await address.press('Home');
  await address.pressSequentially(digits, { delay: 40 });
  await address.press('Enter');
  await page.waitForTimeout(300);
  return address.inputValue();
}

/** The rows of the Memory panel: { '00001000': 'FF FF ...' }. */
const memoryRows = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.e68-memory__row:not(.e68-memory__measure)')].map((row) => [
        (row.querySelector('.e68-memory__addr')?.textContent ?? '').replace(':', '').trim(),
        (row.querySelector('.e68-memory__hex')?.textContent ?? '').trim(),
      ]),
    ),
  );
/** The rows of the Stack panel: { '00FFFFFC': 'FF FF FF FF' }. */
const stackRows = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.e68-stack__row:not(.e68-stack__measure)')].map((row) => [
        (row.querySelector('.e68-stack__addr')?.textContent ?? '').replace(':', '').trim(),
        [...row.querySelectorAll('.e68-stack__byte')].map((cell) => (cell.textContent ?? '').trim()).join(' '),
      ]),
    ),
  );
const bytesText = (bytes) => bytes.map((byte) => hex(byte, 2)).join(' ');
/** A source text as the editor holds it: LF line ends, without the settings lines (`*~Font name~...~`) at its end. */
const withoutTrailer = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\*~[^~]+~[^~]*~$/.test(line))
    .join('\n')
    .replace(/\n+$/, '');

/**
 * Starts the program with `start` and waits until it has executed something and stands halted.
 * (`sim.halted` alone is not enough: it is still set from the run before.)
 */
async function runToHalt(page, start, timeout = STEP_TIMEOUT) {
  const before = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount);
  await start();
  return waitFor(
    page,
    (steps) => {
      const { ctx } = window.__easy68k;
      const s = ctx.store.getState().sim;
      return s.phase === 'idle' && s.halted && ctx.sim.engine.stepCount !== steps;
    },
    before,
    timeout,
  );
}

// --- the parts of the scenario -----------------------------------------------------------------

/** Open an official example in the editor; load a prebuilt .S68 and .L68; run to the halt. */
async function studentPart(browser, name, os, fx) {
  const p = `${name}/student:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  const shot = (label) => page.screenshot({ path: join(outDir, `${name}-student-${label}.png`) });

  check(
    `${p} the application starts in Editor mode`,
    (await page.evaluate(() => window.__easy68k.ctx.store.getState().mode)) === 'editor',
  );

  // --- Help > Examples..., then the example from the Files panel
  await menu(page, 'Help', /^Examples/);
  const toast = page.locator('.e68-toast', { hasText: 'examples' });
  const toastShown = await toast
    .first()
    .waitFor({ timeout: STEP_TIMEOUT })
    .then(
      () => true,
      () => false,
    );
  check(
    `${p} Help > Examples... says where the examples are`,
    toastShown,
    toastShown ? await toast.first().innerText() : 'no toast',
  );
  await filesRow(page, 'Examples').first().dblclick();
  await filesRow(page, 'tutorial1.X68').first().waitFor({ timeout: STEP_TIMEOUT });
  const listed = (await page.locator('[data-e68-panel="files"] [role=treeitem]').allInnerTexts()).slice(2).sort();
  check(
    `${p} the Files panel lists the sixteen shipped example files`,
    same(listed, [...fx.shipped].sort()),
    `${listed.length} files`,
  );
  await filesRow(page, 'tutorial1.X68').first().dblclick();
  const opened = await waitFor(page, () => window.__easy68k.ctx.documents.active()?.name === 'tutorial1.X68', null);
  check(`${p} a double-click opens tutorial1.X68 in the editor`, opened);
  const documentState = await page.evaluate(() => {
    const { documents } = window.__easy68k.ctx;
    const active = documents.active();
    return {
      text: active ? documents.text(active.id) : '',
      modified: active?.modified,
      tab: document.querySelector('[data-e68-panel="editor"] [role=tab][aria-selected=true]')?.textContent ?? '',
      firstLine: document.querySelector('[data-e68-panel="editor"] .cm-line')?.textContent ?? '',
      coloured: document.querySelectorAll('[data-e68-panel="editor"] .cm-line span[class]').length,
      status: document.querySelector('[data-e68-panel="editor"] .e68-editor__status')?.textContent ?? '',
    };
  });
  check(
    `${p} the editor holds the text of the official file, unmodified`,
    withoutTrailer(documentState.text) === withoutTrailer(fx.tutorial1Text) && documentState.modified === false,
    `${documentState.text.length} characters, modified=${documentState.modified}`,
  );
  check(
    `${p} the tab is named tutorial1.X68 and the first line is on screen`,
    documentState.tab.includes('tutorial1.X68') && documentState.firstLine.startsWith('*-----'),
    `${documentState.tab} | ${documentState.firstLine.slice(0, 20)}`,
  );
  check(`${p} the text is syntax-coloured`, documentState.coloured > 20, `${documentState.coloured} coloured spans`);
  await shot('1-example-in-editor');

  // --- the prebuilt files come in through the Files panel
  const imported = await importFiles(page, filesOf(fx.examples['tutorial1.X68']));
  check(
    `${p} Import... takes tutorial1.S68 and tutorial1.L68 into My Programs`,
    /Imported 2 files/.test(imported),
    imported,
  );
  check(
    `${p} both files are in the Files panel`,
    (await filesRow(page, 'tutorial1.S68').count()) === 1 && (await filesRow(page, 'tutorial1.L68').count()) === 1,
  );

  // --- Simulator: File > Open
  await setMode(page, 'simulator');
  const dialogShown = await openProgram(page, 'tutorial1.S68', 'menu', os);
  check(
    `${p} File > Open shows the Open dialog with the S-Record filter and the .S68 file only`,
    dialogShown.title === 'Open' &&
      dialogShown.filter === 'EASy68K S-Record (*.S68)' &&
      dialogShown.listed.includes('tutorial1.S68') &&
      !dialogShown.listed.includes('tutorial1.L68'),
    JSON.stringify(dialogShown),
  );
  const loaded = await sim(page);
  check(
    `${p} the program is loaded with its listing`,
    loaded.program?.path === '/browser/tutorial1.S68' && loaded.program.hasListing === true,
    JSON.stringify(loaded.program),
  );
  check(
    `${p} the message area reads ".S68 file read successful"`,
    (await page.locator(`${SIM} [data-e68-panel="messages"] [role=list]`).innerText()).includes(
      '.S68 file read successful',
    ),
  );
  const title = await page.title();
  check(`${p} the window title names the program`, title.includes('tutorial1.S68'), title);
  const fields0 = await registerFields(page);
  check(`${p} the PC field shows the start address`, fields0.PC === '00001000', `PC=${fields0.PC}`);
  const row0 = await highlightedRow(page);
  check(`${p} the listing highlights the first instruction`, row0.startsWith('00001000  123C 0003'), row0.slice(0, 60));
  check(
    `${p} the status bar shows the start address`,
    (await statusText(page)).includes('PC=00001000'),
    await statusText(page),
  );
  await shot('2-program-loaded');

  // --- Run to the halt
  const halted = await runToHalt(page, () => toolbarButton(page, 'sim.run.run').click());
  check(`${p} Run: the program runs to its halt`, halted, JSON.stringify(await sim(page)));
  const rows = await outputBecomes(page, fx.tutorial1Output);
  check(
    `${p} the Output panel shows the four lines of the program`,
    same(rows, fx.tutorial1Output),
    JSON.stringify(rows),
  );
  check(
    `${p} the text is drawn on the canvas`,
    (await litPixels(page, 0, 64)) > 500,
    `${await litPixels(page, 0, 64)} lit pixels in the first four rows`,
  );
  const fields = await registerFields(page);
  const engine = await engineRegisters(page);
  const differing = Object.keys(engine).filter((key) => fields[key] !== engine[key]);
  check(
    `${p} the register fields show the engine's registers (D2 = 520, D3 = 68020)`,
    differing.length === 0 && fields.D2 === '00000208' && fields.D3 === '000109B4',
    differing.map((key) => `${key}: field ${fields[key]} engine ${engine[key]}`).join(', '),
  );
  check(`${p} the cycle counter counted`, Number(await cyclesShown(page)) > 0, await cyclesShown(page));
  check(`${p} the status bar says Halted`, (await statusText(page)).startsWith('Halted'), await statusText(page));
  const enabledAfterHalt = await page.evaluate(() =>
    ['sim.run.run', 'sim.run.traceInto', 'sim.run.pause', 'sim.run.rewind', 'sim.file.open'].map((id) =>
      window.__easy68k.ctx.commands.isEnabled(id),
    ),
  );
  check(
    `${p} after the halt Run and Trace Into are disabled; Pause, Rewind and Open are enabled (4.8)`,
    same(enabledAfterHalt, [false, false, true, true, true]),
    JSON.stringify(enabledAfterHalt),
  );
  await shot('3-halted');

  // --- Rewind and run again (sim-ui 9.10: the Output panel is cleared, memory is kept)
  await toolbarButton(page, 'sim.run.rewind').click();
  await waitFor(page, () => window.__easy68k.ctx.sim.engine.getRegister(17) === 0x1000, null);
  const rewound = await registerFields(page);
  const clearedRows = await outputBecomes(page, []);
  check(
    `${p} Rewind: PC back at the start, registers cleared, Output panel cleared`,
    rewound.PC === '00001000' && rewound.D2 === '00000000' && clearedRows.length === 0,
    `PC=${rewound.PC} D2=${rewound.D2} output=${JSON.stringify(clearedRows)}`,
  );
  check(
    `${p} Rewind: the canvas is blank again`,
    (await litPixels(page, 0, 64)) === 0,
    `${await litPixels(page, 0, 64)} lit pixels`,
  );
  const statusRewound = await statusText(page);
  check(`${p} Rewind: the status bar no longer says Halted`, !statusRewound.startsWith('Halted'), statusRewound);
  const runEnabled = await toolbarButton(page, 'sim.run.run').isEnabled();
  check(`${p} Rewind: Run is enabled again`, runEnabled);
  // F9 from the listing, where a student's focus is after a click on it.
  await page.locator(`${SIM} [data-e68-panel="listing"] [data-e68-panel-focus]`).click();
  const secondRun = await runToHalt(page, () => press(page, 'F9'));
  check(`${p} F9 runs the program a second time to its halt`, secondRun, JSON.stringify(await sim(page)));
  const again = await outputBecomes(page, fx.tutorial1Output);
  check(`${p} the second run prints the four lines once`, same(again, fx.tutorial1Output), JSON.stringify(again));
  check(
    `${p} Run moved the keyboard to the Output panel`,
    (await focusPlace(page)) === 'textarea in output',
    await focusPlace(page),
  );

  // --- Close and open again (sim-ui 8.5)
  await menu(page, 'File', /^Close/);
  await page.waitForTimeout(200);
  await answerCaution(page);
  const closed = await waitFor(page, () => window.__easy68k.ctx.sim.listing.rows.length === 0, null);
  const rowsOnScreen = await page.locator(`${SIM} [data-e68-panel="listing"] [role=option]`).count();
  check(`${p} File > Close empties the listing`, closed && rowsOnScreen === 0, `${rowsOnScreen} rows on screen`);
  await openProgram(page, 'tutorial1.S68', 'key', os);
  const reopened = await sim(page);
  check(
    `${p} ${os === 'mac' ? 'Cmd+O' : 'Ctrl+O'} opens the program again with its listing`,
    reopened.program?.hasListing === true && (await highlightedRow(page)).startsWith('00001000'),
    JSON.stringify(reopened.program),
  );
  const statusReopened = await statusText(page);
  check(
    `${p} the status bar of the freshly loaded program does not say Halted`,
    !statusReopened.startsWith('Halted'),
    statusReopened,
  );
  const thirdRun = await runToHalt(page, () => toolbarButton(page, 'sim.run.run').click());
  check(`${p} the reopened program runs to its halt`, thirdRun);
  const third = await outputBecomes(page, fx.tutorial1Output);
  check(`${p} and prints the same four lines`, same(third, fx.tutorial1Output), JSON.stringify(third));

  // --- back in the editor: the document is still there; close it and open it again from File > Open File
  await setMode(page, 'editor');
  const still = await page.evaluate(() => window.__easy68k.ctx.documents.active()?.name);
  check(`${p} back in Editor mode the example is still open`, still === 'tutorial1.X68', String(still));
  await page.locator('[data-e68-panel="editor"] [role=tab][aria-selected=true] .e68-tabs__close').click();
  const gone = await waitFor(
    page,
    () => !window.__easy68k.ctx.store.getState().documents.items.some((item) => item.name === 'tutorial1.X68'),
    null,
    5000,
  );
  check(`${p} the tab's close button closes the document without a question (it was not changed)`, gone);
  await toolbarButton(page, 'ed.file.open').click();
  const dialog = modalDialog(page);
  const dialogOpen = await dialog.waitFor({ timeout: STEP_TIMEOUT }).then(
    () => true,
    () => false,
  );
  check(
    `${p} Open in the editor's toolbar shows the Open File dialog`,
    dialogOpen && (await dialog.locator('h2').innerText()) === 'Open File',
  );
  if (dialogOpen) {
    // The dialog starts in My Programs or, after a document from a folder, in that folder.
    await page.waitForTimeout(500);
    if ((await dialog.locator('[role=option]', { hasText: 'tutorial1.X68' }).count()) === 0) {
      await dialog.locator('[role=option]', { hasText: 'Examples' }).first().dblclick();
    }
    await dialog.locator('[role=option]', { hasText: 'tutorial1.X68' }).first().waitFor({ timeout: STEP_TIMEOUT });
    await dialog.locator('[role=option]', { hasText: 'tutorial1.X68' }).first().dblclick();
    await dialog.waitFor({ state: 'detached', timeout: STEP_TIMEOUT });
    const back = await waitFor(page, () => window.__easy68k.ctx.documents.active()?.name === 'tutorial1.X68', null);
    check(`${p} the document opens again from the dialog`, back);
  }
  await shot('4-editor-again');

  // --- a change, saved with the keyboard: the bytes in the store (documents, editor, file store)
  await page
    .locator('[data-e68-panel="editor"] .cm-line')
    .first()
    .click({ position: { x: 2, y: 5 } });
  await press(page, 'Home');
  await page.keyboard.type('* edited by the check', { delay: 20 });
  await press(page, 'Enter');
  const modifiedNow = await page.evaluate(() => window.__easy68k.ctx.documents.active()?.modified);
  await press(page, os === 'mac' ? 'Meta+KeyS' : 'Control+KeyS');
  const saved = await waitFor(page, () => window.__easy68k.ctx.documents.active()?.modified === false, null);
  const bytes = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    const active = ctx.documents.active();
    const data = active?.path ? await ctx.vfs.readFile(active.path) : new Uint8Array();
    return { path: active?.path ?? null, data: [...data] };
  });
  const savedText = Buffer.from(bytes.data).toString('latin1');
  check(
    `${p} ${os === 'mac' ? 'Cmd+S' : 'Ctrl+S'} saves the changed example where it was opened, with CR LF line ends and the settings lines`,
    modifiedNow === true &&
      saved &&
      bytes.path === '/browser/Examples/tutorial1.X68' &&
      savedText.startsWith('* edited by the check\r\n*-----') &&
      !/[^\r]\n/.test(savedText) &&
      /\*~Font name~[^~]*~\r\n/.test(savedText),
    `modified before ${modifiedNow}, saved ${saved}, path ${bytes.path}, ${bytes.data.length} bytes, starts ${JSON.stringify(savedText.slice(0, 40))}, ends ${JSON.stringify(savedText.slice(-60))}`,
  );

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** A task 2 prompt, and a program that waits for one key. */
async function promptPart(browser, name, os, fx) {
  const p = `${name}/prompt:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await importFiles(page, [...filesOf(fx.own.prompt), ...filesOf(fx.own.keywait)]);
  await setMode(page, 'simulator');

  await openProgram(page, 'prompt.S68', 'toolbar', os);
  await toolbarButton(page, 'sim.run.run').click();
  const waiting = await waitForPhase(page, 'waitInput');
  check(`${p} the program stops at its task 2 prompt`, waiting, JSON.stringify(await sim(page)));
  const asked = await outputBecomes(page, ['What is your name?']);
  check(`${p} the prompt text is on screen`, same(asked, ['What is your name?']), JSON.stringify(asked));
  check(
    `${p} the keyboard is in the Output panel without a click`,
    (await focusPlace(page)) === 'textarea in output',
    await focusPlace(page),
  );
  const before = await litPixels(page, 0, 16);
  await page.keyboard.type('Ada', { delay: 80 });
  await page.waitForTimeout(300);
  const typed = await litPixels(page, 0, 16);
  check(
    `${p} what is typed is echoed on the canvas`,
    typed > before + 20,
    `${before} lit pixels before, ${typed} after`,
  );
  await page.screenshot({ path: join(outDir, `${name}-prompt-typed.png`) });
  check(`${p} the program still waits until Enter`, (await sim(page)).phase === 'waitInput');
  await press(page, 'Enter');
  check(
    `${p} Enter ends the input and the program runs to its halt`,
    await waitForHalt(page),
    JSON.stringify(await sim(page)),
  );
  const expected = fx.outcomes.prompt.text;
  const rows = await outputBecomes(page, expected);
  check(
    `${p} the program answers with what was typed (as in the headless session)`,
    same(rows, expected),
    JSON.stringify(rows),
  );
  const length = await page.evaluate(() => window.__easy68k.ctx.sim.engine.getRegister(7) & 0xffff);
  check(`${p} task 2 returned the length 3`, length === 3, String(length));
  await page.screenshot({ path: join(outDir, `${name}-prompt-answered.png`) });

  // Backspace and a second line: type a mistake, correct it.
  await toolbarButton(page, 'sim.run.rewind').click();
  await toolbarButton(page, 'sim.run.run').click();
  await waitForPhase(page, 'waitInput');
  await page.keyboard.type('Grx', { delay: 80 });
  await press(page, 'Backspace');
  await page.keyboard.type('ace', { delay: 80 });
  await press(page, 'Enter');
  await waitForHalt(page);
  const corrected = await outputBecomes(page, ['What is your name?', 'Hello, Grace']);
  check(
    `${p} Backspace corrects the input`,
    same(corrected, ['What is your name?', 'Hello, Grace']),
    JSON.stringify(corrected),
  );

  // A program that waits for one key.
  await openProgram(page, 'keywait.S68', 'menu', os);
  await toolbarButton(page, 'sim.run.run').click();
  check(`${p} the key program waits for a key`, await waitForPhase(page, 'waitInput'), JSON.stringify(await sim(page)));
  await page.waitForTimeout(400);
  check(`${p} it keeps waiting while nothing is pressed`, (await sim(page)).phase === 'waitInput');
  await press(page, 'k');
  check(`${p} one key lets it run to its halt`, await waitForHalt(page), JSON.stringify(await sim(page)));
  const keyRows = await outputBecomes(page, fx.outcomes.keywait.text);
  check(
    `${p} it shows the key (as in the headless session)`,
    same(keyRows, fx.outcomes.keywait.text),
    JSON.stringify(keyRows),
  );
  const d6 = await page.evaluate(() => window.__easy68k.ctx.sim.engine.getRegister(6) & 0xff);
  check(`${p} the program received the code of "k"`, d6 === 'k'.charCodeAt(0), String(d6));

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** Run, Pause, Trace Into, Step Over; the Registers, Listing, Memory and Stack panels follow. */
async function tracePart(browser, name, os, fx) {
  const p = `${name}/trace:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await importFiles(page, filesOf(fx.own.counter));
  await setMode(page, 'simulator');
  await openProgram(page, 'counter.S68', 'toolbar', os);
  const { bsr, sub, count } = fx.counterAddresses;

  // Run, then Pause with F6 where the focus is: in the Output panel (2.9.4 rule 2).
  await toolbarButton(page, 'sim.run.run').click();
  check(`${p} Run starts the program`, await waitForPhase(page, 'running'));
  check(`${p} the status bar says Running`, (await statusText(page)).startsWith('Running'), await statusText(page));
  await page.waitForTimeout(400);
  const focus = await focusPlace(page);
  await press(page, 'F6');
  const paused = await waitForPhase(page, 'idle');
  check(`${p} F6 pauses it (focus was: ${focus})`, paused, JSON.stringify(await sim(page)));
  const d0 = await page.evaluate(() => window.__easy68k.ctx.sim.engine.getRegister(0) >>> 0);
  await page.waitForTimeout(300);
  const d0Later = await page.evaluate(() => window.__easy68k.ctx.sim.engine.getRegister(0) >>> 0);
  check(`${p} nothing executes after Pause`, d0 > 100 && d0 === d0Later, `D0 ${d0} then ${d0Later}`);
  const sameAsEngine = async (label) => {
    const fields = await registerFields(page);
    const engine = await engineRegisters(page);
    const differing = Object.keys(engine).filter((key) => fields[key] !== engine[key]);
    const row = await highlightedRow(page);
    check(
      `${p} ${label}: the register fields and the highlighted listing row are the engine's`,
      differing.length === 0 && row.startsWith(engine.PC),
      `${differing.map((key) => `${key}: field ${fields[key]} engine ${engine[key]}`).join(', ')} row "${row.slice(0, 40)}"`,
    );
    return engine;
  };
  await sameAsEngine('after Pause');

  // The tool panels, opened from the View menu while the program is paused.
  await showTool(page, 'Stack', 'stack');
  await showTool(page, 'Memory', 'memory');
  await goToAddress(page, '001000');
  const memory0 = await memoryRows(page);
  const program16 = bytesText(await engineBytes(page, 0x1000, 16));
  check(
    `${p} the Memory panel shows the program at 00001000`,
    memory0['00001000'] === program16,
    `${memory0['00001000']} / engine ${program16}`,
  );

  // Trace Into (F7 from the listing) up to the BSR, then into the subroutine.
  await page.locator(`${SIM} [data-e68-panel="listing"] [data-e68-panel-focus]`).focus(); // focus() and not a click: a click selects the row under the mouse
  let engine = await engineRegisters(page);
  for (let i = 0; i < 8 && engine.PC !== hex(bsr); i++) {
    await press(page, 'F7');
    await page.waitForTimeout(120);
    engine = await engineRegisters(page);
  }
  check(`${p} F7 traces instruction by instruction to the BSR`, engine.PC === hex(bsr), `PC=${engine.PC}`);
  await sameAsEngine('at the BSR');
  const cyclesBefore = Number(await cyclesShown(page));
  const spBefore = Number.parseInt(engine.A7, 16);
  await toolbarButton(page, 'sim.run.traceInto').click();
  await page.waitForTimeout(200);
  engine = await sameAsEngine('after Trace Into at the BSR');
  check(
    `${p} Trace Into enters the subroutine`,
    engine.PC === hex(sub) && engine.A7 === hex(spBefore - 4),
    `PC=${engine.PC} A7=${engine.A7}`,
  );
  check(
    `${p} the cycle counter went on`,
    Number(await cyclesShown(page)) > cyclesBefore,
    `${cyclesBefore} then ${await cyclesShown(page)}`,
  );
  await page.locator(`${SIM} [role=tab]`, { hasText: 'Stack' }).click();
  await page.waitForTimeout(300);
  const stack = await stackRows(page);
  check(
    `${p} the Stack panel shows the return address at the stack pointer`,
    stack[hex(spBefore - 4)] === bytesText([0, 0, ((bsr + 4) >> 8) & 0xff, (bsr + 4) & 0xff]),
    `row ${hex(spBefore - 4)}: ${stack[hex(spBefore - 4)]} (rows ${Object.keys(stack).slice(0, 3).join(', ')}...)`,
  );
  await page.screenshot({ path: join(outDir, `${name}-trace-stack.png`) });

  // One round later, Step Over (F8) at the BSR runs the whole subroutine.
  await page.locator(`${SIM} [data-e68-panel="listing"] [data-e68-panel-focus]`).focus(); // focus() and not a click: a click selects the row under the mouse
  for (let i = 0; i < 12 && (i === 0 || engine.PC !== hex(bsr)); i++) {
    await press(page, 'F7');
    await page.waitForTimeout(120);
    engine = await engineRegisters(page);
  }
  await press(page, 'F8');
  await waitForPhase(page, 'idle');
  await page.waitForTimeout(200);
  engine = await sameAsEngine('after Step Over at the BSR');
  check(
    `${p} F8 steps over the subroutine`,
    engine.PC === hex(bsr + 4) && engine.A7 === hex(spBefore),
    `PC=${engine.PC} A7=${engine.A7}`,
  );

  // The next instruction stores the counter: the Memory panel follows without being asked.
  await page.locator(`${SIM} [role=tab]`, { hasText: 'Memory' }).click();
  await goToAddress(page, hex(count & ~0xf, 6));
  await page.locator(`${SIM} [data-e68-panel="listing"] [data-e68-panel-focus]`).focus(); // focus() and not a click: a click selects the row under the mouse
  await press(page, 'F7');
  await page.waitForTimeout(300);
  const rowAddress = hex(count & ~0xf);
  const shownRow = (await memoryRows(page))[rowAddress];
  const engineRow = bytesText(await engineBytes(page, count & ~0xf, 16));
  const stored = await engineBytes(page, count, 4);
  check(
    `${p} the Memory panel follows the trace step that stored the counter`,
    shownRow === engineRow && bytesText(stored) === bytesText([...Buffer.from(engine.D0, 'hex')]),
    `row ${rowAddress}: ${shownRow} / engine ${engineRow}; COUNT=${bytesText(stored)} D0=${engine.D0}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-trace-memory.png`) });

  // Auto Trace (F10) moves the highlight by itself; Pause ends it.
  const pcBefore = (await engineRegisters(page)).PC;
  const stepsBeforeAuto = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount);
  await press(page, 'F10');
  await page.waitForTimeout(1200);
  const autoStatus = await statusText(page);
  await toolbarButton(page, 'sim.run.pause').click();
  await waitForPhase(page, 'idle');
  await page.waitForTimeout(200);
  const stepsAtPause = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount);
  await page.waitForTimeout(400);
  const stepsLater = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount);
  const afterAuto = await sameAsEngine('after Auto Trace and Pause');
  check(
    `${p} Auto Trace (F10) executed instructions one by one, the status bar said so, and Pause stopped it`,
    stepsAtPause > stepsBeforeAuto &&
      stepsAtPause - stepsBeforeAuto < 1000 &&
      stepsLater === stepsAtPause &&
      autoStatus.startsWith('Auto trace'),
    `steps ${stepsBeforeAuto} -> ${stepsAtPause} -> ${stepsLater}; PC ${pcBefore} then ${afterAuto.PC}; status "${autoStatus}"`,
  );

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** The Hardware panel follows a running program, and the program follows its switches. */
async function hardwarePart(browser, name, os, fx) {
  const p = `${name}/hardware:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await importFiles(page, filesOf(fx.own.hardware));
  await setMode(page, 'simulator');
  await openProgram(page, 'hardware.S68', 'toolbar', os);
  const panel = await showTool(page, 'Hardware', 'hardware');
  const label = (prefix) => panel.locator(`svg[aria-label^="${prefix}"]`).getAttribute('aria-label');
  const display0 = await label('7-segment display');
  await toolbarButton(page, 'sim.run.run').click();
  await waitForPhase(page, 'running');
  const followed = await waitFor(
    page,
    () =>
      (
        document
          .querySelector('[data-e68-panel="hardware"] svg[aria-label^="7-segment display"]')
          ?.getAttribute('aria-label') ?? ''
      ).includes(': 06 5B'),
    null,
    5000,
  );
  check(
    `${p} the 7-segment display follows the running program`,
    followed,
    `before: ${display0}; now: ${await label('7-segment display')}`,
  );
  const ledsFollow = await waitFor(
    page,
    () =>
      document.querySelector('[data-e68-panel="hardware"] svg[aria-label^="LEDs"]')?.getAttribute('aria-label') ===
      'LEDs: 00000000',
    null,
    5000,
  );
  check(
    `${p} the LEDs show the switches the program copies to them (all off)`,
    ledsFollow,
    String(await label('LEDs')),
  );
  await panel.locator('[role=switch][aria-label="Switch 0"]').click();
  const switched = await waitFor(
    page,
    () =>
      document.querySelector('[data-e68-panel="hardware"] svg[aria-label^="LEDs"]')?.getAttribute('aria-label') ===
      'LEDs: 00000001',
    null,
    5000,
  );
  check(
    `${p} a click on Switch 0 reaches the running program and comes back on LED 0`,
    switched,
    String(await label('LEDs')),
  );
  check(
    `${p} the switch shows as on`,
    (await panel.locator('[role=switch][aria-label="Switch 0"]').getAttribute('aria-checked')) === 'true',
  );
  await panel.locator('[role=switch][aria-label="Switch 7"]').click();
  const both = await waitFor(
    page,
    () =>
      document.querySelector('[data-e68-panel="hardware"] svg[aria-label^="LEDs"]')?.getAttribute('aria-label') ===
      'LEDs: 10000001',
    null,
    5000,
  );
  check(`${p} Switch 7 as well: LEDs 10000001`, both, String(await label('LEDs')));
  await page.screenshot({ path: join(outDir, `${name}-hardware.png`) });
  await toolbarButton(page, 'sim.run.pause').click();
  await waitForPhase(page, 'idle');
  // The Memory panel shows the same bytes at the display's address.
  await showTool(page, 'Memory', 'memory');
  await goToAddress(page, 'E00000');
  const row = (await memoryRows(page))['00E00000'] ?? '';
  check(`${p} the Memory panel shows the display bytes at 00E00000`, row.startsWith('06 FF 5B'), row);
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** A program that draws. */
async function drawPart(browser, name, os, fx) {
  const p = `${name}/draw:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await importFiles(page, filesOf(fx.own.draw));
  await setMode(page, 'simulator');
  await openProgram(page, 'draw.S68', 'toolbar', os);
  await toolbarButton(page, 'sim.run.run').click();
  check(`${p} the drawing program runs to its halt`, await waitForHalt(page), JSON.stringify(await sim(page)));
  await page.waitForTimeout(300);
  const pixels = {
    'inside the rectangle (fill red)': [100, 80, '0000FF'],
    'its left edge (pen green)': [40, 80, '00FF00'],
    'on the line (pen blue)': [400, 200, 'FF0000'],
    'the single pixel (white)': [320, 400, 'FFFFFF'],
    'the background': [600, 440, '000000'],
  };
  for (const [what, [x, y, colour]] of Object.entries(pixels)) {
    const got = await canvasPixel(page, x, y);
    check(`${p} canvas pixel ${x},${y}, ${what}`, got === colour, `${got}, expected ${colour}`);
  }
  await page.screenshot({ path: join(outDir, `${name}-draw.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** Every official example: loaded, run for a moment, compared with the headless session. */
async function tourPart(browser, name, os, fx) {
  const p = `${name}/tour:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  const sounds = fx.sounds.map((sound) => ({ name: sound.name, data: sound.data }));
  await importFiles(page, [...Object.values(fx.examples).flatMap(filesOf), ...sounds]);
  await setMode(page, 'simulator');
  for (const source of Object.keys(fx.examples)) {
    const program = fx.examples[source];
    const expected = fx.outcomes[source];
    const before = errors.length;
    await openProgram(page, program.s68Name, 'toolbar', os);
    const loaded = await sim(page);
    await page.waitForTimeout(300);
    const pcRow = await page.evaluate(() => {
      const { ctx } = window.__easy68k;
      const row = ctx.sim.controller.snapshot.highlight;
      return {
        row,
        selected: ctx.store.getState().sim.selectedRow,
        text: ctx.sim.listing.rows[row] ?? '',
        pc: (ctx.sim.engine.getRegister(17) >>> 0).toString(16).toUpperCase().padStart(8, '0'),
      };
    });
    const rowOnScreen = await highlightedRow(page);
    check(
      `${p} ${source}: after the load the listing highlights the row of the PC`,
      pcRow.text.startsWith(pcRow.pc) && pcRow.selected === pcRow.row && rowOnScreen.trimEnd() === pcRow.text.trimEnd(),
      `PC ${pcRow.pc}; engine row ${pcRow.row} "${pcRow.text.slice(0, 40)}"; selected row ${pcRow.selected}; on screen "${rowOnScreen.slice(0, 40)}"`,
    );
    const stepsBefore = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount);
    await toolbarButton(page, 'sim.run.run').click();
    // Halted and waiting programs settle at once, the others keep running.
    await waitFor(
      page,
      (steps) => {
        const { ctx } = window.__easy68k;
        const s = ctx.store.getState().sim;
        if (ctx.sim.engine.stepCount === steps) return false;
        return (s.phase === 'idle' && s.halted) || s.phase === 'waitInput';
      },
      stepsBefore,
      expected.end === 'halted' || expected.end === 'waiting for input' ? 8000 : 2500,
    );
    await page.waitForTimeout(700);
    const state = await sim(page);
    const end =
      state.phase === 'idle'
        ? state.halted
          ? 'halted'
          : 'stopped'
        : state.phase === 'waitInput'
          ? 'waiting for input'
          : state.phase;
    const rows = await outputRows(page);
    const settled = expected.end === 'halted' || expected.end === 'waiting for input';
    const alerts = await page.locator('[role=alertdialog]').allInnerTexts();
    check(
      `${p} ${source}: loads with its listing and ${settled ? `ends as in the headless session (${expected.end})` : 'keeps running'}`,
      loaded.program?.hasListing === true && (settled ? end === expected.end : end !== 'halted' && end !== 'stopped'),
      `${end}${alerts.length ? `; box: ${alerts.join(' / ').replace(/\s+/g, ' ')}` : ''}`,
    );
    if (settled) {
      check(
        `${p} ${source}: the Output panel's text equals the headless session's`,
        same(rows, expected.text),
        JSON.stringify(rows.slice(0, 6)),
      );
    } else {
      note(`${p} ${source} after about three seconds: ${end}; text ${JSON.stringify(rows.slice(0, 3))}`);
      // A running program: nothing on screen may say that it has halted.
      await toolbarButton(page, 'sim.run.run').hover();
      await page.waitForTimeout(1500);
      const tips = await page.locator('[role=tooltip]').allInnerTexts();
      const status = await statusText(page);
      check(
        `${p} ${source}: while it runs, neither the status bar nor the Run button's tool-tip says it has halted`,
        !status.startsWith('Halted') && !tips.some((tip) => /halted/i.test(tip)),
        `status "${status}"; tool-tips ${JSON.stringify(tips)}; AppState.sim.halted=${state.halted}`,
      );
      await page.mouse.move(0, 400);
    }
    check(
      `${p} ${source}: no console or page errors`,
      errors.length === before,
      errors.slice(before, before + 2).join(' | '),
    );
    await page.screenshot({ path: join(outDir, `${name}-tour-${source.replace('.X68', '')}.png`) });
    for (const box of await page.locator('[role=alertdialog] button').all()) await box.click().catch(() => {});
    // Stop it, whatever it does, the way a student would: Pause, then Rewind.
    await toolbarButton(page, 'sim.run.pause').click();
    await waitForPhase(page, 'idle', 5000);
    await toolbarButton(page, 'sim.run.rewind').click();
    await page.waitForTimeout(200);
  }
  await context.close();
}

/** The page is reloaded: the files are still in the browser store and the program runs again. */
async function reloadPart(browser, name, os, fx) {
  const p = `${name}/reload:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await importFiles(page, filesOf(fx.examples['MACRO.X68']));
  await setMode(page, 'simulator');
  await openProgram(page, 'MACRO.S68', 'toolbar', os);
  await toolbarButton(page, 'sim.run.run').click();
  await waitForHalt(page);
  await page.reload({ timeout: LOAD_TIMEOUT });
  await waitForApp(page);
  const mode = await page.evaluate(() => window.__easy68k.ctx.store.getState().mode);
  note(
    `${p} after a reload the application is in ${mode} mode with ${(await sim(page)).program ? 'a' : 'no'} program loaded`,
  );
  await setMode(page, 'simulator');
  const shown = await openProgram(page, 'MACRO.S68', 'toolbar', os);
  check(
    `${p} after a reload the imported program is still in My Programs`,
    shown.listed.includes('MACRO.S68'),
    JSON.stringify(shown.listed),
  );
  await toolbarButton(page, 'sim.run.run').click();
  check(`${p} it runs to its halt again`, await waitForHalt(page), JSON.stringify(await sim(page)));
  const rows = await outputBecomes(page, fx.outcomes['MACRO.X68'].text);
  check(`${p} with the same output`, same(rows, fx.outcomes['MACRO.X68'].text), JSON.stringify(rows));

  // A second page of the same browser: the same store, its own simulator.
  const second = await openApp(context);
  await setMode(second.page, 'simulator');
  const listedThere = await openProgram(second.page, 'MACRO.S68', 'toolbar', os);
  check(`${p} a second page sees the same file`, listedThere.listed.includes('MACRO.S68'));
  await toolbarButton(second.page, 'sim.run.run').click();
  check(`${p} and runs it on its own`, await waitForHalt(second.page));
  check(
    `${p} no console or page errors`,
    errors.length + second.errors.length === 0,
    [...errors, ...second.errors].slice(0, 3).join(' | '),
  );
  await context.close();
}

const PARTS = {
  student: studentPart,
  prompt: promptPart,
  trace: tracePart,
  hardware: hardwarePart,
  draw: drawPart,
  tour: tourPart,
  reload: reloadPart,
};

// --- fixtures: assembled with the real assembler, run in the headless session -----------------

async function buildFixtures(server) {
  const module = await server.ssrLoadModule(`/@fs/${join(here, 'fixtures.ts').replaceAll('\\', '/')}`);
  const plain = (program) => ({ ...program, s68: [...program.s68], l68: [...program.l68] });
  const examples = {};
  const outcomes = {};
  const sounds = ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav'].map((file) => ({
    name: file,
    data: [...module.exampleBytes(file)],
  }));
  const extraFiles = Object.fromEntries(sounds.map((sound) => [sound.name, Uint8Array.from(sound.data)]));
  for (const source of module.OFFICIAL_EXAMPLES) {
    const program = await module.assembleExample(source);
    examples[source] = plain(program);
    outcomes[source] = await module.runHeadless(program, { seconds: 5, extraFiles });
  }
  const own = {};
  for (const source of ['prompt', 'keywait', 'draw', 'counter', 'hardware'])
    own[source] = await module.assembleOwn(source);
  outcomes.prompt = await module.runHeadless(own.prompt, { typed: ['Ada\n'] });
  outcomes.keywait = await module.runHeadless(own.keywait, { typed: ['k'] });
  // The addresses of the counter program, from its listing.
  const listing = Buffer.from(own.counter.l68).toString('latin1').split(/\r?\n/);
  const addressOf = (pattern) => Number.parseInt((listing.find((row) => pattern.test(row)) ?? '').slice(0, 8), 16);
  const counterAddresses = {
    bsr: addressOf(/\bBSR\s+SUB/),
    sub: addressOf(/\bSUB:\s+MOVE\.L/),
    count: addressOf(/\bCOUNT:\s+DS\.L/),
  };
  return {
    examples,
    own: Object.fromEntries(Object.entries(own).map(([key, program]) => [key, plain(program)])),
    outcomes,
    sounds,
    counterAddresses,
    shipped: [...module.OFFICIAL_EXAMPLES, ...sounds.map((sound) => sound.name)],
    tutorial1Text: Buffer.from(module.exampleBytes('tutorial1.X68')).toString('latin1'),
    tutorial1Output: module.TUTORIAL1_OUTPUT,
  };
}

// --- run -------------------------------------------------------------------------------------

async function main() {
  const dist = join(repoRoot, 'engine', 'dist');
  if (!existsSync(join(dist, 'asm68k.wasm')) || !existsSync(join(dist, 'sim68k.wasm'))) {
    console.error('engine/dist is missing: run `npm run build:engines` or `npm run fetch:engines` first.');
    process.exit(1);
  }
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // A cache of its own: several checks may run on one machine at the same time.
    cacheDir: join(outDir, 'vite-cache'),
    // Port 0: the system picks a free one. No file watching and no hot reload: other people's
    // edits elsewhere in the tree must not reload the page in the middle of a check.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    const fx = await buildFixtures(server);
    console.log('What the programs do in the headless session (real engine, virtual time):');
    for (const [source, outcome] of Object.entries(fx.outcomes)) {
      console.log(`  ${source.padEnd(20)} ${outcome.end.padEnd(18)} ${JSON.stringify(outcome.text.slice(0, 3))}`);
    }
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      const os = OS_OF[name] ?? 'windows';
      try {
        for (const [part, run] of Object.entries(PARTS)) {
          if (only.length > 0 && !only.includes(part)) continue;
          console.log(`\n[${name}, ${os} key map, ${part}]`);
          // A part that throws (a step that hangs runs into its time limit) is one failure; the
          // parts after it still run.
          try {
            await run(browser, name, os, fx);
          } catch (error) {
            check(
              `${name}/${part}: ran to the end`,
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

  if (notes.length > 0) console.log(`\nNotes (not failures):\n${notes.map((text) => `  - ${text}`).join('\n')}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
