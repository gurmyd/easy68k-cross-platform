// Browser check of the Memory and Stack panels (ARCHITECTURE.md 9.2, U2). Owner: U2.
//
//   node app/src/features/memory/check-memory-stack.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright), on the real simulator session (features/run) and the real
// engine: test programs are assembled here by the real assembler, written into the browser store
// and loaded with `controller.open`. Memory is changed only the ways a user changes it - typing in
// the panel, Copy and Fill, and running a program - and is read back through the engine. The
// script checks what unit tests under Node cannot show: the rendered rows and their format, the
// number of rows following the panel height, clicking and typing in hex and ASCII, the Address
// field's keys, Fill, Copy and Save (through the real file dialog, with the overwrite question)
// and their message boxes, Live during a run (also at address 0), a static panel during a run
// without Live and its repaint at the stop, the stack's middle row and its aqua / yellow / red
// colours, a scrolled Stack panel that a Memory edit does not re-centre, the cursor's blink (and
// none under reduced motion), both themes, and no console errors.
//
// It uses the development-only page object `window.__easy68k` (main.tsx) to run commands and to
// read the store and the engine. Needs engine/dist (both engines).
//
// Screenshots go to build/U2/check (git-ignored). Exit code 0 = every check passed. A check that
// waits for another package is printed as "wait" and does not fail the run.

/* global console, process, document, window, getComputedStyle -- page.evaluate() callbacks run in the page */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'U2', 'check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];
const waiting = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
/** A check whose outcome depends on another package that has not delivered yet. */
function wait(name, detail) {
  waiting.push(name);
  console.log(`  wait ${name} - ${detail}`);
}

/** The dev server transforms every module at the first request; on a busy machine that takes a while. */
const LOAD_TIMEOUT = 180_000;

// --- test programs, assembled with the real assembler ------------------------------------

const SOURCES = {
  // The bytes of the example row of sim-ui §10.1 at $1000 (MOVE.B #14,D0 / LEA $1012,A1 / TRAP #15).
  example: [
    '        ORG     $1000',
    'START:  DC.B    $10,$3C,$00,$0E,$43,$F9,$00,$00,$10,$12,$4E,$4F',
    '        END     START',
  ],
  // Counts the long word at $24 for ever: a row near address 0 that changes during a run.
  counter: ['        ORG     $1000', 'START:  ADDQ.L  #1,$24', '        BRA     START', '        END     START'],
  // SS = $8000, user mode with US = A7 = $8004, A3 = $8008, eight known bytes at $8000; then a
  // loop that pushes nothing (the stack stays put across a run and a pause).
  stack: [
    '        ORG     $1000',
    'START:  LEA     $8008,A3',
    '        LEA     $8000,A7',
    '        LEA     $8004,A0',
    '        MOVE    A0,USP',
    '        ANDI.W  #$DFFF,SR',
    'LOOP:   BRA     LOOP',
    '        ORG     $8000',
    '        DC.B    $11,$22,$33,$44,$55,$66,$77,$88',
    '        END     START',
  ],
};

async function assemblePrograms() {
  const dist = join(repoRoot, 'engine', 'dist');
  if (!existsSync(join(dist, 'asm68k.wasm')) || !existsSync(join(dist, 'sim68k.wasm'))) {
    throw new Error('engine/dist is missing: run `npm run build:engines` or `npm run fetch:engines` first.');
  }
  const { assemble } = await import(pathToFileURL(join(repoRoot, 'engine', 'asm', 'asm68k.mjs')).href);
  const programs = {};
  for (const [name, lines] of Object.entries(SOURCES)) {
    const source = lines.map((line) => `${line}\r\n`).join('');
    const files = new Map([[`${name}.X68`, Uint8Array.from(source, (ch) => ch.charCodeAt(0))]]);
    const result = await assemble(`${name}.X68`, files, {}, new Date(2026, 0, 1));
    if (result.errorCount > 0 || !result.sRecord || !result.listing) {
      throw new Error(`The test program ${name} does not assemble: ${result.messages.map((m) => m.text).join('; ')}`);
    }
    programs[name] = { s68: [...result.sRecord], l68: [...result.listing] };
  }
  return programs;
}

// --- helpers ----------------------------------------------------------------------------------

function pretendWindows() {
  Object.defineProperty(window.Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(window.Navigator.prototype, 'userAgentData', { get: () => undefined });
}

/** Opens the application, writes the programs into the browser store and waits for the engine. */
async function openApp(browser, programs, { reducedMotion = 'reduce', theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, reducedMotion });
  await context.addInitScript(pretendWindows);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, undefined, { timeout: LOAD_TIMEOUT });
  await page.evaluate(
    async ([value, files]) => {
      const { ctx } = window.__easy68k;
      for (const [name, program] of Object.entries(files)) {
        await ctx.vfs.writeFile(`/browser/u2check/${name}.S68`, Uint8Array.from(program.s68));
        await ctx.vfs.writeFile(`/browser/u2check/${name}.L68`, Uint8Array.from(program.l68));
      }
      await ctx.commands.run('app.theme.set', value);
      await ctx.commands.run('app.mode.set', 'simulator');
    },
    [theme, programs],
  );
  await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
  // The engine is fetched, compiled and started (a cold start that replaces the stand-in engine).
  await page.waitForFunction(
    () => {
      const { ctx } = window.__easy68k;
      return ctx.store.getState().sim.phase === 'idle' && ctx.sim.engine.state().hardwareEnabled;
    },
    undefined,
    { timeout: LOAD_TIMEOUT },
  );
  return { context, page, errors };
}

const run = (page, id, arg) => page.evaluate(([c, a]) => window.__easy68k.ctx.commands.run(c, a), [id, arg]);
const sim = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().sim);
const waitForPhase = (page, phase, timeout = 30_000) =>
  page.waitForFunction((wanted) => window.__easy68k.ctx.store.getState().sim.phase === wanted, phase, { timeout });

/** Loads a test program through the real controller and waits until it is ready. */
async function load(page, name) {
  await page.evaluate((file) => window.__easy68k.ctx.sim.controller.open(`/browser/u2check/${file}.S68`, 'open'), name);
  await waitForPhase(page, 'idle');
  const program = (await sim(page)).program;
  if (program?.path !== `/browser/u2check/${name}.S68`)
    throw new Error(`${name} did not load: ${JSON.stringify(program)}`);
}

/** Runs the loaded program for a moment and stops it (a stop is a scrshow: the panels refresh). */
async function runAndPause(page, ms = 300) {
  await run(page, 'sim.run.run');
  await waitForPhase(page, 'running');
  await page.waitForTimeout(ms);
  await run(page, 'sim.run.pause');
  await waitForPhase(page, 'idle');
}

const memoryRows = (page) =>
  page.$$eval('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)', (rows) =>
    rows.map((row) => row.textContent),
  );
const stackRows = (page) =>
  page.$$eval('[data-e68-panel="stack"] .e68-stack__row:not(.e68-stack__measure)', (rows) =>
    rows.map((row) => row.textContent),
  );
const stackMiddle = async (page) => {
  const rows = await stackRows(page);
  return rows[Math.trunc(rows.length / 2)];
};
const byte = (page, address) => page.evaluate((a) => window.__easy68k.ctx.sim.engine.memory[a], address);

/** Clicks the character cell (row, col) of the memory rows. */
async function clickCell(page, row, col) {
  const box = await page.locator('[data-e68-panel="memory"] .e68-memory__measure').boundingBox();
  const rows = await page.locator('[data-e68-panel="memory"] .e68-memory__rows').boundingBox();
  const cw = box.width / 10;
  const rh = box.height;
  // The measuring cell sits where the first character of the rows is (after the padding).
  await page.mouse.click(box.x + col * cw + cw / 2, rows.y + row * rh + rh / 2);
}

async function typeField(page, label, text) {
  const field = page.locator(`[data-e68-panel="memory"] input[aria-label="${label}"]`);
  await field.click();
  await field.press('Home');
  await field.pressSequentially(text);
}

/** Waits for a message box, returns its text and answers it with `button`. */
async function messageBox(page, text, button = 'OK') {
  const dialog = page.locator('[role=alertdialog]');
  const shown = await dialog.waitFor({ timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  const content = shown ? await dialog.innerText() : '';
  if (shown) await dialog.getByRole('button', { name: button }).click();
  await dialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  return shown && content.includes(text) ? content.replace(/\s+/g, ' ').trim() : `missing: ${content}`;
}

// --- passes -----------------------------------------------------------------------------------

async function memoryPass(browser, programs, name, theme) {
  const p = `${name}/${theme}:`;
  const { context, page, errors } = await openApp(browser, programs, { theme });
  await load(page, 'example');

  await run(page, 'sim.view.memory', '00001000');
  await page.waitForSelector('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check(`${p} View > Memory focuses the Address field`, focused === 'Address', String(focused));
  const rows = await memoryRows(page);
  check(
    `${p} first row equals the example of sim-ui §10.1`,
    rows[0] === '00001000: 10 3C 00 0E 43 F9 00 00 10 12 4E 4F FF FF FF FF -<--C-----NO----',
    rows[0],
  );
  const fit = await page.evaluate(() => {
    const rowsBox = document.querySelector('[data-e68-panel="memory"] .e68-memory__rows');
    const measure = rowsBox.querySelector('.e68-memory__measure').getBoundingClientRect().height;
    return Math.floor(rowsBox.clientHeight / measure);
  });
  check(`${p} the number of rows follows the panel height`, rows.length === fit && fit >= 3, `${rows.length} / ${fit}`);
  check(
    `${p} the column header stands over the hex and ASCII columns`,
    (await page.locator('[data-e68-panel="memory"] .e68-memory__header').textContent()) ===
      '          00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 0123456789ABCDEF',
  );

  // Typing in the hex area: click on the space after byte 1 (column 15) puts the cursor on byte 2's high nibble.
  await clickCell(page, 0, 15);
  await page.keyboard.type('ab');
  check(`${p} typed hex digits change the byte in the engine`, (await byte(page, 0x1002)) === 0xab);
  check(
    `${p} the row repaints after the edit`,
    (await memoryRows(page))[0]?.startsWith('00001000: 10 3C AB 0E'),
    (await memoryRows(page))[0],
  );
  const cursorShown = await page.evaluate(() => {
    const cursor = document.querySelector('.e68-memory__cursor');
    return cursor ? getComputedStyle(cursor).visibility : 'none';
  });
  check(`${p} the cursor frame is shown while the rows have the focus`, cursorShown === 'visible', cursorShown);
  const blink = await page.evaluate(
    () => getComputedStyle(document.querySelector('.e68-memory__cursor')).animationName,
  );
  check(`${p} the cursor does not blink under reduced motion`, blink === 'none', blink);
  await page.keyboard.type('g');
  check(`${p} a non-hex key in the hex area changes nothing`, (await byte(page, 0x1003)) === 0x0e);

  // ASCII area: Enter stores $0D.
  await clickCell(page, 1, 58);
  await page.keyboard.press('Enter');
  check(`${p} Enter in the ASCII area stores $0D`, (await byte(page, 0x1010)) === 0x0d);
  await page.keyboard.type('Hi');
  check(
    `${p} typed characters appear in the ASCII column`,
    (await memoryRows(page))[1]?.endsWith('-Hi-------------'),
    (await memoryRows(page))[1],
  );
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('7');
  check(`${p} Left from the ASCII column goes to the last hex nibble`, (await byte(page, 0x101f)) === 0xf7);

  // Address field keys.
  const address = page.locator('[data-e68-panel="memory"] input[aria-label="Address"]');
  await address.click();
  await address.press('ArrowDown');
  check(`${p} Down in the Address field moves one row`, (await address.inputValue()) === '001010');
  await address.press('PageDown');
  const paged = await address.inputValue();
  check(
    `${p} Page Down moves one page`,
    paged === (0x1010 + rows.length * 16).toString(16).toUpperCase().padStart(6, '0'),
    paged,
  );
  await address.press('Home');
  await address.pressSequentially('00200F');
  check(`${p} the Address field is rounded down to 16`, (await address.inputValue()) === '002000');

  // Fill, Copy.
  await typeField(page, 'From', '002000');
  await typeField(page, 'To', '002005');
  await typeField(page, 'Bytes', '12345678');
  await page.locator('[data-e68-panel="memory"] button', { hasText: 'Fill' }).click();
  check(
    `${p} Fill writes the 4-byte pattern From..To`,
    (await memoryRows(page))[0]?.startsWith('00002000: 12 34 56 78 12 34 FF') && (await byte(page, 0x2005)) === 0x34,
    (await memoryRows(page))[0],
  );
  await typeField(page, 'To', '002000');
  await page.locator('[data-e68-panel="memory"] button', { hasText: 'Copy' }).click();
  const copyBox = await messageBox(page, 'Invalid copy range');
  check(`${p} Copy with To = From shows "Invalid copy range" (SIM68K)`, copyBox.includes('SIM68K'), copyBox);
  await typeField(page, 'To', '002008');
  await typeField(page, 'Bytes', '00000004');
  await page.locator('[data-e68-panel="memory"] button', { hasText: 'Copy' }).click();
  check(
    `${p} Copy copies Bytes bytes From -> To`,
    (await memoryRows(page))[0]?.startsWith('00002000: 12 34 56 78 12 34 FF FF 12 34 56 78') &&
      (await byte(page, 0x200b)) === 0x78,
    (await memoryRows(page))[0],
  );

  // Save: an invalid range, then From..To through the real file dialog, then the overwrite question.
  await typeField(page, 'To', '001FFF');
  const saveButton = page.locator('[data-e68-panel="memory"] button[aria-label="Save"]');
  await saveButton.click();
  const saveBox = await messageBox(page, 'Invalid memory range.');
  check(
    `${p} Save with To < From shows "Invalid memory range." (Information)`,
    saveBox.includes('Information'),
    saveBox,
  );
  await page.evaluate(() => {
    // Observes (does not change) the file dialog, to learn the path it answered.
    const dialogs = window.__easy68k.ctx.fileDialogs;
    const save = dialogs.save.bind(dialogs);
    window.__u2saved = [];
    dialogs.save = async (request) => {
      const path = await save(request);
      window.__u2saved.push(path);
      return path;
    };
  });
  await typeField(page, 'To', '002007');
  const fileDialog = page.locator('[role=dialog][aria-modal=true]');
  const saveAs = async () => {
    await saveButton.click();
    await fileDialog.waitFor();
    await fileDialog.getByLabel('File name:').fill('u2memory');
    await fileDialog.getByRole('button', { name: 'Save' }).click();
  };
  await saveAs();
  await page.waitForFunction(() => window.__u2saved.length === 1);
  const written = await page.evaluate(async () => {
    const path = window.__u2saved[0];
    // The panel writes after the dialog has answered.
    for (let i = 0; i < 50; i++) {
      try {
        return { path, bytes: [...(await window.__easy68k.ctx.vfs.readFile(path))] };
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
    }
    return { path, bytes: null };
  });
  check(
    `${p} Save writes From..To inclusive as a binary file with the extension .bin`,
    /\/u2memory\.bin$/i.test(written.path ?? '') &&
      JSON.stringify(written.bytes) === JSON.stringify([0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0xff, 0xff]),
    JSON.stringify(written),
  );
  await saveAs();
  const replaceBox = await messageBox(page, 'File exists! OK to replace?', 'No');
  check(
    `${p} Save over an existing file asks "File exists! OK to replace?" (Alert)`,
    replaceBox.includes('Alert'),
    replaceBox,
  );
  await page.waitForFunction(() => window.__u2saved.length === 2);
  check(`${p} No abandons the save`, (await page.evaluate(() => window.__u2saved[1])) === null);

  // Live during a run, with the top row at address 0; without Live the panel stays as painted.
  await load(page, 'counter');
  await address.click();
  await address.press('Home');
  await address.pressSequentially('000000');
  const live = page.locator('[data-e68-panel="memory"] .e68-memory__side .e68-checkbox');
  await live.click();
  await run(page, 'sim.run.run');
  await waitForPhase(page, 'running');
  const rowAt20 = async () => (await memoryRows(page))[2] ?? '';
  /** The counter's four bytes ($24..$27) as the panel prints them. */
  const counterText = () =>
    page.evaluate(() =>
      [...window.__easy68k.ctx.sim.engine.memory.slice(0x24, 0x28)]
        .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' '),
    );
  /** Waits (up to 10 s, the machine may be slow) until row $20 differs from `text`. */
  const rowChangedFrom = (text) =>
    page
      .waitForFunction(
        (old) => {
          const rows = [
            ...document.querySelectorAll('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)'),
          ];
          return (rows[2]?.textContent ?? old) !== old;
        },
        text,
        { timeout: 10_000 },
      )
      .then(
        () => true,
        () => false,
      );
  const live0 = await rowAt20();
  const liveSeen = await rowChangedFrom(live0);
  const live1 = await rowAt20();
  const liveAgain = await rowChangedFrom(live1);
  const live2 = await rowAt20();
  check(
    `${p} Live repaints a changing row during a run while the top row is address 0`,
    liveSeen && liveAgain,
    `${live0.slice(0, 34)} | ${live1.slice(0, 34)} | ${live2.slice(0, 34)}`,
  );
  await live.click();
  await page.waitForTimeout(100);
  const static1 = await rowAt20();
  const engine1 = await counterText();
  await page.waitForTimeout(400);
  const static2 = await rowAt20();
  const engine2 = await counterText();
  check(
    `${p} without Live the panel stays as painted during a run`,
    static1 === static2 && engine1 !== engine2,
    `${static1.slice(0, 34)} | ${static2.slice(0, 34)} (engine $24: ${engine1} -> ${engine2})`,
  );
  await run(page, 'sim.run.pause');
  await waitForPhase(page, 'idle');
  const stopped = await rowAt20();
  const engineStopped = await counterText();
  check(
    `${p} the stop repaints the panel`,
    stopped.startsWith(`00000020: FF FF FF FF ${engineStopped} `) && stopped !== static2,
    stopped.slice(0, 34),
  );

  await page.locator('[data-e68-panel="memory"]').screenshot({ path: join(outDir, `${name}-${theme}-memory.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function stackPass(browser, programs, name, theme) {
  const p = `${name}/${theme}:`;
  const { context, page, errors } = await openApp(browser, programs, { theme });
  await load(page, 'stack');
  await runAndPause(page);
  const registers = await page.evaluate(() => {
    const r = window.__easy68k.ctx.sim.engine.registers();
    return { a3: r.a[3], ssp: r.ssp, a7: r.a7 };
  });
  check(
    `${p} the program set SS = $8000, A7 = US = $8004, A3 = $8008`,
    registers.ssp === 0x8000 && registers.a7 === 0x8004 && registers.a3 === 0x8008,
    JSON.stringify(registers),
  );
  // The Invalid range of the memory map, as the Hardware panel sets it.
  await page.evaluate(() =>
    window.__easy68k.ctx.sim.controller.invoke((engine) =>
      engine.setMemoryMap(3, { enabled: true, start: 0x8001, end: 0x8002 }),
    ),
  );
  await run(page, 'sim.view.stack');
  await page.waitForSelector('[data-e68-panel="stack"] .e68-stack__row:not(.e68-stack__measure)');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  check(`${p} View > Stack focuses the View list`, focused === 'SELECT', String(focused));
  const info = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-e68-panel="stack"] .e68-stack__row:not(.e68-stack__measure)')];
      const middle = rows[Math.trunc(rows.length / 2)];
      const style = (el) => (el ? { bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color } : null);
      return {
        count: rows.length,
        middle: middle?.textContent,
        reg: style(document.querySelector('[data-e68-panel="stack"] [data-mark="reg"]')),
        sp: style(document.querySelector('[data-e68-panel="stack"] [data-mark="sp"]')),
        regText: document.querySelector('[data-e68-panel="stack"] [data-mark="reg"]')?.textContent,
        spText: document.querySelector('[data-e68-panel="stack"] [data-mark="sp"]')?.textContent,
        invalid: [...document.querySelectorAll('[data-e68-panel="stack"] [data-invalid="true"]')].map((el) => ({
          text: el.textContent,
          fg: getComputedStyle(el).color,
        })),
      };
    });
  let state = await info();
  check(`${p} rows fill the panel`, state.count >= 5, String(state.count));
  check(`${p} SS ($8000) is on the middle row`, state.middle === '00008000: 11 22 33 44 ', state.middle);
  check(
    `${p} aqua marks the selected register's byte`,
    state.reg?.bg === 'rgb(0, 255, 255)' && state.regText === '11 ',
    JSON.stringify(state.reg),
  );
  check(
    `${p} yellow marks the active stack pointer's byte`,
    state.sp?.bg === 'rgb(255, 255, 0)' && state.spText === '55 ',
    JSON.stringify(state.sp),
  );
  check(`${p} black text on the marks`, state.reg?.fg === 'rgb(0, 0, 0)' && state.sp?.fg === 'rgb(0, 0, 0)');
  check(
    `${p} red text for the Invalid range`,
    state.invalid.map((i) => i.text).join('') === '22 33 ' &&
      state.invalid.every((i) => /^rgb\((1[6-9]\d|2\d\d), /.test(i.fg)),
    JSON.stringify(state.invalid),
  );
  await page.locator('[data-e68-panel="stack"] select').selectOption('3');
  state = await info();
  check(`${p} choosing A3 centres on A3`, state.middle?.startsWith('00008008: '), state.middle);
  const spin = page.locator('[data-e68-panel="stack"] button[aria-label="Lower addresses"]');
  await spin.click();
  state = await info();
  check(`${p} the spin button moves one row`, state.middle?.startsWith('00008004: '), state.middle);

  // A run does not refresh the panel; the stop re-centres it.
  const before = await stackRows(page);
  await run(page, 'sim.run.run');
  await waitForPhase(page, 'running');
  await page.waitForTimeout(300);
  const during = await stackRows(page);
  check(`${p} the panel is not refreshed during a run`, JSON.stringify(during) === JSON.stringify(before));
  await run(page, 'sim.run.pause');
  await waitForPhase(page, 'idle');
  check(`${p} a stop re-centres`, (await stackMiddle(page))?.startsWith('00008008: '), await stackMiddle(page));
  await page.locator('[data-e68-panel="stack"]').screenshot({ path: join(outDir, `${name}-${theme}-stack.png`) });

  // A Memory edit redraws the Stack panel without re-centring it (sim-ui §11.4).
  await spin.click();
  await spin.click();
  await spin.click();
  const scrolled = await stackMiddle(page); // 00007FFC
  await run(page, 'sim.view.memory', '00007FF0');
  await page.waitForSelector('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)');
  const revisions = await sim(page);
  await clickCell(page, 0, 10 + 3 * 12); // byte $7FFC, high nibble
  await page.keyboard.type('9');
  const after = await sim(page);
  check(`${p} the Memory edit reaches the engine`, (await byte(page, 0x7ffc)) === 0x9f);
  await run(page, 'sim.view.stack');
  const middleAfter = await stackMiddle(page);
  const kept = middleAfter === '00007FFC: 9F FF FF FF ' && scrolled?.startsWith('00007FFC: ');
  const named = `${p} a Memory edit redraws a scrolled Stack panel without re-centring it`;
  if (kept) check(named, true, middleAfter);
  else if (after.repaint === undefined && after.viewRevision !== revisions.viewRevision) {
    // The session's pokeMemory moves viewRevision and does not publish sim.repaint yet, so the
    // panel cannot tell this write from a scrshow (docs/porting/errata/U2.md, C2).
    wait(
      named,
      `waiting for SH8 to publish sim.repaint or to stop bumping viewRevision in pokeMemory (${middleAfter})`,
    );
  } else check(named, false, `${scrolled} -> ${middleAfter}`);

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function motionPass(browser, programs, name) {
  const { context, page, errors } = await openApp(browser, programs, { reducedMotion: 'no-preference' });
  await load(page, 'example');
  await run(page, 'sim.view.memory', '00001000');
  await page.waitForSelector('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)');
  await clickCell(page, 0, 10);
  const blink = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.e68-memory__cursor'));
    return `${style.animationName} ${style.animationDuration}`;
  });
  check(`${name}: the cursor blinks at 500 ms (1 s period)`, blink === 'e68-memory-blink 1s', blink);
  await page.screenshot({ path: join(outDir, `${name}-simulator.png`) });
  check(`${name}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function main() {
  const programs = await assemblePrograms();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // A cache of its own, so that another dev server optimising dependencies at the same time
    // cannot make this page reload.
    cacheDir: join(outDir, 'vite-cache'),
    // No file watching and no hot reload: other packages edit files in this tree while the
    // script runs, and a reload in the middle of a check would destroy the page's state.
    // Port 0: the system picks a free port.
    server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const { port } = server.httpServer.address();
  baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        for (const theme of ['light', 'dark']) {
          console.log(`\n[${name}, ${theme}: Memory panel]`);
          await memoryPass(browser, programs, name, theme);
          console.log(`\n[${name}, ${theme}: Stack panel]`);
          await stackPass(browser, programs, name, theme);
        }
        console.log(`\n[${name}, motion]`);
        await motionPass(browser, programs, name);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(
    `\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.` +
      (waiting.length ? ` ${waiting.length} waiting for another package.` : ''),
  );
  process.exit(failures ? 1 : 0);
}

await main();
