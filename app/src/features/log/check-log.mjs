// Browser check of logging and the simulator options (ARCHITECTURE.md 9.4, U4). Owner: U4.
//
//   node app/src/features/log/check-log.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright), with the key map of the system it runs on:
//
//   - Log Start and Log Stop are disabled at start-up and follow sim-ui §13.6; the LOGGING label;
//   - Options > Log Output...: the modeless dialog with the original's texts, the memory range for
//     type 3, OK enables Log Start and saves the two types;
//   - Log Start, Trace Into to the halt, `Current Log Stopped.`: the execution log and the output
//     log in the browser store, byte for byte (the example program of sim-ui §13.4);
//   - the `Log File Options` question: Cancel (nothing starts, nothing is written), Append, Replace;
//   - the Rewind and Reload notes after the dialog has been shown with the types selected;
//   - Log Start while a program runs and the file exists, with the question open for seconds:
//     every byte the program writes after the click is in the log, judged exactly from D2 and the
//     PC read while the question is open (the program can be held before any of its instructions);
//   - the same with the program brought before each of the eight instructions of its loop by
//     Trace Into, and the judge failing for that log with a line removed;
//   - the cost of a flush in the real browser store (IndexedDB) with a 30 MB log and a small one;
//   - the Log panel from View > Log; Auto Trace Options; Enable Exceptions and Enable Bit Field (saved at once,
//     still set after a reload of the page); the three font dialogs; Fullscreen Options;
//   - the dialogs pass an accessibility scan; screenshots in the light and the dark theme.
//
// The page object `window.__easy68k` (development builds only, main.tsx) is used to put the test
// programs into the browser store and to read state for the comparisons. The check waits for the
// state it needs (the register fields re-read, a box shown, lines in the log) rather than for fixed
// times, so that a slow runner passes as this PC does; the one fixed pause is the three seconds the
// user takes to answer the question while a program runs.
//
// Every wait has a time limit and a message that names what it waited for: Playwright's actions
// their 30 s default, each call into the page (withLimit/evaluate), each step inside the flush
// measurement, each part (PART_TIMEOUT) and the whole run (RUN_TIMEOUT, before CI's 15-minute step
// limit). A wait that runs out fails its part with that message, and the next part runs.
//
// Screenshots go to build/U4/log-check (git-ignored). Prints "N of M checks passed"; the exit code
// is 0 only if every check passed and no page logged an error. Needs engine/dist (the programs are
// assembled by the real assembler); without it the script says so, and with
// EASY68K_REQUIRE_ENGINES=1 (CI) that is a failure.

/* global console, process, document, window, performance, setTimeout, clearTimeout -- the browser globals are used inside page.evaluate() callbacks */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'U4', 'log-check')));
mkdirSync(outDir, { recursive: true });
const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const LOAD_TIMEOUT = 240_000;
const UI_TIMEOUT = 20_000;
/** A call into the page that reads or writes the browser store (a few files, one flush). */
const STORE_TIMEOUT = 60_000;
/** Writing a 30 MB file into the store and seeing the question it causes (slow WebKit, loaded PC). */
const BIG_FILE_TIMEOUT = 120_000;
/** One whole part (logging, flush, options): a part that is not done by then fails alone. */
const PART_TIMEOUT = 6 * 60_000;
/**
 * The whole check: it ends with a message before CI's step limit (15 minutes) would end it with
 * none, and names the part and the wait it was in.
 */
const RUN_TIMEOUT = 13 * 60_000;

/** What the check is waiting for now, and in which part, for the messages of the time limits. */
let waitingFor = 'the start';
let currentPart = 'set-up';

/**
 * Every wait of this check has a time limit (gate I2 review: the flush step once waited for more
 * than 12 minutes with nothing in the log). Playwright's actions and waitFor have their own 30 s
 * default; page.evaluate and the axe scan have none, so they go through here. On a timeout the
 * error names what was awaited and for how long; the promise left behind is silenced, so that its
 * later rejection (when the context is closed) cannot end the process.
 */
function withLimit(promise, ms, what) {
  waitingFor = what;
  promise.catch(() => {});
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)} s waiting for ${what}`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** page.evaluate with a time limit and a description of what it waits for. */
const evaluate = (page, what, fn, arg, ms = STORE_TIMEOUT) => withLimit(page.evaluate(fn, arg), ms, what);

/** The contexts not closed yet: a part that fails on a time limit leaves its own behind. */
const openContexts = new Set();

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const notes = [];
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}

// --- programs ------------------------------------------------------------------------------------

/** The program of the execution-log examples of sim-ui §13.4 (MOVE.B at listing line 9). */
const HELLO = [
  '*-----------------------------------------------------------',
  '* The program of the execution-log examples of sim-ui 13.4.',
  '*-----------------------------------------------------------',
  '*',
  '*',
  '*',
  '    ORG     $1000',
  'START:',
  '    MOVE.B  #14,D0',
  '    LEA     MSG,A1',
  '    TRAP    #15',
  '    SIMHALT',
  '    ORG     $1012',
  "MSG DC.B    'Hello',0",
  '    END     START',
];
/** Writes "0\r\n1\r\n2\r\n..." for ever, counting in D2. */
const COUNTER = [
  '    ORG     $1000',
  'START:',
  '    MOVEQ   #0,D2',
  'LOOP:',
  '    MOVE.L  D2,D1',
  '    MOVEQ   #3,D0',
  '    TRAP    #15',
  '    LEA     CRLF,A1',
  '    MOVEQ   #14,D0',
  '    TRAP    #15',
  '    ADDQ.L  #1,D2',
  '    BRA     LOOP',
  'CRLF DC.B  13,10,0',
  '    END     START',
];
const SOURCES = { hello: HELLO, count: COUNTER };

/**
 * The eight instructions of the counter's loop, in order: a program that is held (by Pause, by the
 * Log File Options question, by the end of a sub-slice) is held before one of them, and which one
 * decides where the log of a Log Start must begin. The run controller bounds a sub-slice by time
 * as well as by count (errata SH8.md entry 40), so a running program can be held before any of the
 * eight (errata U4.md entry 17).
 */
const COUNTER_PLACES = [
  'MOVE.L D2,D1',
  'MOVEQ #3,D0',
  'TRAP #15 (task 3, the number)',
  'LEA CRLF,A1',
  'MOVEQ #14,D0',
  'TRAP #15 (task 14, CR LF)',
  'ADDQ.L #1,D2',
  'BRA LOOP',
];

/**
 * The address of each of COUNTER_PLACES, read from the counter's listing (listing lines 5 to 12):
 * not written down here, so that a change of the program or of the assembler cannot make them wrong.
 */
function counterAddresses(listing) {
  const text = String.fromCharCode(...listing);
  const byLine = new Map();
  for (const line of text.split('\r\n')) {
    const match = /^([0-9A-F]{8}) {2}[0-9A-F]{4}(?: [0-9A-F]{4,8})*\s+(\d+)\s/.exec(line);
    if (match) byLine.set(Number(match[2]), Number.parseInt(match[1], 16));
  }
  const addresses = COUNTER_PLACES.map((_, i) => byLine.get(5 + i));
  if (addresses.some((a) => a === undefined)) throw new Error(`The counter's listing has no address for lines 5 to 12`);
  return addresses;
}

/**
 * The one correct beginning of the counter's log after a Log Start while the program is held
 * before place `place` (an index of COUNTER_PLACES) with D2 = `d2`: what the program writes next.
 *   - before the MOVE, the MOVEQ #3 or the first TRAP: the number d2 is not written yet: "d2 CR LF";
 *   - before the LEA, the MOVEQ #14 or the second TRAP: d2 is written, its CR LF not: "CR LF", then
 *     "d2+1 CR LF";
 *   - before the ADDQ: line d2 is complete, D2 not yet counted on: "d2+1 CR LF";
 *   - before the BRA: D2 is already counted on, line d2-1 is complete: "d2 CR LF".
 */
function counterLogStart(place, d2) {
  if (place <= 2) return { lead: '', first: d2 };
  if (place <= 5) return { lead: '\r\n', first: d2 + 1 };
  if (place === 6) return { lead: '', first: d2 + 1 };
  return { lead: '', first: d2 };
}

/**
 * Judges the body of the counter's output log (after its header) exactly: it begins as
 * counterLogStart says, then holds consecutive numbers each with its CR LF, at least `minLines` of
 * them, and ends either after a CR LF or with the whole next number (Log Stop holds the program
 * between two instructions, so nothing else can be the last thing written).
 */
function judgeCounterLog(body, place, d2, minLines = 10) {
  const { lead, first } = counterLogStart(place, d2);
  const where = `held before ${COUNTER_PLACES[place] ?? `an address outside the loop (place ${place})`} with D2 = ${d2}`;
  const describe = `${where}, so the log must begin ${JSON.stringify(`${lead}${first}\r\n`)}`;
  if (place < 0 || place >= COUNTER_PLACES.length) return { ok: false, detail: describe };
  if (!body.startsWith(lead))
    return { ok: false, detail: `${describe}; it begins ${JSON.stringify(body.slice(0, 24))}` };
  const pieces = body.slice(lead.length).split('\r\n');
  const tail = pieces.pop();
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i] !== String(first + i)) {
      return {
        ok: false,
        detail: `${describe}; line ${i + 1} after the click is ${JSON.stringify(pieces[i])}, not ${first + i} (it begins ${JSON.stringify(body.slice(0, 24))})`,
      };
    }
  }
  if (tail !== '' && tail !== String(first + pieces.length)) {
    return {
      ok: false,
      detail: `${describe}; it ends with ${JSON.stringify(tail)}, not "" or "${first + pieces.length}"`,
    };
  }
  if (pieces.length < minLines) return { ok: false, detail: `${describe}; only ${pieces.length} lines` };
  return { ok: true, detail: `${where}: ${pieces.length} lines from ${JSON.stringify(body.slice(0, 16))}` };
}

/** The log with its line `index` (0 the first after the click) removed, to prove the judge fails. */
function withoutLine(body, place, d2, index) {
  const { lead } = counterLogStart(place, d2);
  const pieces = body.slice(lead.length).split('\r\n');
  pieces.splice(index, 1);
  return lead + pieces.join('\r\n');
}

/** The execution log of sim-ui §13.4, type 1, after its header. */
const TYPE1_BODY = [
  'PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0',
  'PC=00001004  Code=43F9 00001012          Line=   10      LEA     MSG,A1',
  'PC=0000100A  Code=4E4F                   Line=   11      TRAP    #15',
  'PC=0000100C  Code=FFFF FFFF              Line=   12      SIMHALT',
]
  .map((line) => `${line}\r\n`)
  .join('');
const EXEC_HEADER = /^EASy68K execution log file: \d{1,2}\/\d{1,2}\/\d{4}( \d{1,2}:\d\d:\d\d [AP]M)?\r\n\r\n/;
const OUTPUT_HEADER = /^EASy68K output log file: \d{1,2}\/\d{1,2}\/\d{4}( \d{1,2}:\d\d:\d\d [AP]M)?\r\n\r\n/;

function enginesBuilt() {
  const dist = join(repoRoot, 'engine', 'dist');
  return ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
    existsSync(join(dist, file)),
  );
}

async function assemblePrograms() {
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

// --- the page ------------------------------------------------------------------------------------

async function newContext(browser, colorScheme = 'light') {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: 'reduce',
    colorScheme,
  });
  openContexts.add(context);
  context.on('close', () => openContexts.delete(context));
  return context;
}

/** Closes what a failed part left open, each within a time limit. */
async function closeLeftContexts() {
  for (const context of [...openContexts]) {
    await withLimit(context.close(), UI_TIMEOUT, 'a browser context of the failed part to close').catch((error) =>
      note(String(error.message ?? error)),
    );
    openContexts.delete(context);
  }
}

async function openPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await waitForApp(page);
  return { page, errors };
}

async function waitForApp(page) {
  await page.waitForFunction(
    () => window.__easy68k !== undefined && document.querySelector('.e68-shell') !== null,
    undefined,
    { timeout: LOAD_TIMEOUT },
  );
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', undefined, {
    timeout: 60_000,
  });
}

const SIM = '[data-e68-workspace="simulator"]';
const toolbarButton = (page, id) => page.locator(`.e68-shell__toolbar [data-command="${id}"]`);
const loggingLabel = (page) => page.locator('.e68-shell__toolbar .e68-toolbar__logging');
const dialogNamed = (page, name) => page.getByRole('dialog', { name });
const alertBox = (page) => page.locator('[role=alertdialog]');

/** Opens a menu of the menu bar and chooses an item, with the mouse. */
async function menu(page, title, item) {
  await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: new RegExp(`^${title}$`) }).click();
  await page.locator('[role=menu][data-e68-menu] [role^=menuitem]', { hasText: item }).first().click();
}

/** The check mark of a menu item (aria-checked), read with the menu open, then the menu closed. */
async function menuChecked(page, title, item) {
  await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: new RegExp(`^${title}$`) }).click();
  const entry = page.locator('[role=menu][data-e68-menu] [role^=menuitem]', { hasText: item }).first();
  const checked = await entry.getAttribute('aria-checked');
  await page.keyboard.press('Escape');
  return checked === 'true';
}

const setMode = (page, mode) => page.locator(`.e68-modeswitch [data-mode="${mode}"]`).click();

/**
 * Waits until `predicate` holds in the page; false after `timeout`, with a note that names what was
 * awaited, so that a slow step is visible in the log even where the caller goes on.
 */
const waitFor = (page, what, predicate, arg, timeout = UI_TIMEOUT) => {
  waitingFor = what;
  return page.waitForFunction(predicate, arg, { timeout }).then(
    () => true,
    () => {
      note(`waited ${Math.round(timeout / 1000)} s for ${what}: not seen`);
      return false;
    },
  );
};

/** Puts the programs into the browser store and opens one in the simulator (setup, not checked). */
async function putPrograms(page, programs) {
  await evaluate(
    page,
    'the test programs to be written into the browser store',
    async (all) => {
      const { ctx } = window.__easy68k;
      for (const [name, program] of Object.entries(all)) {
        await ctx.vfs.writeFile(`/browser/logcheck/${name}.S68`, Uint8Array.from(program.s68));
        await ctx.vfs.writeFile(`/browser/logcheck/${name}.L68`, Uint8Array.from(program.l68));
      }
    },
    programs,
  );
}
async function openProgram(page, name) {
  await evaluate(
    page,
    `the simulator to open ${name}.S68`,
    (file) => window.__easy68k.ctx.sim.controller.open(`/browser/logcheck/${file}.S68`, 'open'),
    name,
  );
  await waitFor(
    page,
    `the load of ${name}.S68 to finish`,
    () => window.__easy68k.ctx.store.getState().sim.phase !== 'loading',
    undefined,
  );
}

const readText = (page, path) =>
  evaluate(
    page,
    `${path} to be read from the browser store`,
    async (p) => {
      const { ctx } = window.__easy68k;
      if ((await ctx.vfs.stat(p)) === null) return null;
      const bytes = await ctx.vfs.readFile(p);
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return text;
    },
    path,
  );
const writeText = (page, path, text) =>
  evaluate(
    page,
    `${path} to be written into the browser store`,
    ([p, t]) =>
      window.__easy68k.ctx.vfs.writeFile(
        p,
        Uint8Array.from(t, (ch) => ch.charCodeAt(0)),
      ),
    [path, text],
  );
const removeFile = (page, path) =>
  evaluate(
    page,
    `${path} to be removed from the browser store`,
    async (p) => {
      const { ctx } = window.__easy68k;
      if ((await ctx.vfs.stat(p)) !== null) await ctx.vfs.remove(p);
    },
    path,
  );
const logState = (page) =>
  evaluate(page, 'the log service state', () => ({ ...window.__easy68k.ctx.sim.log.state }), undefined, UI_TIMEOUT);
/** Flushes until nothing is left unsaved; each flush within the page has its own limit. */
const settled = (page) =>
  evaluate(
    page,
    'the log to be flushed into the browser store',
    async (limitMs) => {
      const { log } = window.__easy68k.ctx.sim;
      for (let i = 0; i < 20 && log.unsaved; i++) {
        const done = await Promise.race([
          log.flush().then(
            () => true,
            () => true,
          ),
          new Promise((resolve) => setTimeout(() => resolve(false), limitMs)),
        ]);
        if (!done) return false;
      }
      return !log.unsaved;
    },
    STORE_TIMEOUT / 2,
  ).then((ok) => {
    if (!ok) note(`the log still had unsaved bytes after flushing (a flush took more than ${STORE_TIMEOUT / 2000} s)`);
    return ok;
  });
const enabled = async (page, id) => !(await toolbarButton(page, id).isDisabled());

/** Presses one of the command's chords on the page's key map, preferring one with `prefer` in it. */
async function pressCommandKey(page, id, prefer) {
  const chords = await evaluate(
    page,
    `the chords of ${id} (commands/specs.ts)`,
    async (command) => {
      const { chordsOn } = await import('/src/commands/specs.ts');
      return chordsOn(command, window.__easy68k.ctx.platform.os, false);
    },
    id,
  );
  const chord = chords.find((c) => c.includes(prefer)) ?? chords[0];
  const parts = chord.split('+');
  const key = parts.pop();
  const MOD = { Ctrl: 'Control', Shift: 'Shift', Alt: 'Alt', Option: 'Alt', Cmd: 'Meta' };
  await page.keyboard.press([...parts.map((m) => MOD[m] ?? m), key].join('+'));
  return chord;
}

async function axe(page, label, p) {
  const scan = await withLimit(
    new AxeBuilder({ page })
      .include('[role=dialog], [role=alertdialog]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze(),
    STORE_TIMEOUT,
    `the accessibility scan of ${label}`,
  );
  check(
    `${p} ${label} passes the accessibility scan`,
    scan.violations.length === 0,
    scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('; '),
  );
}

/** Answers the engine's `Current Log Stopped.` box with OK. */
async function answerLogStopped(page, p) {
  const box = alertBox(page);
  const shown = await box
    .waitFor({ timeout: UI_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  const text = shown ? await box.innerText() : '';
  check(
    `${p} the halt shows \`Current Log Stopped.\``,
    shown && text.includes('Current Log Stopped.'),
    text.replace(/\s+/g, ' '),
  );
  if (shown) await box.getByRole('button', { name: 'OK' }).click();
  await box.waitFor({ state: 'detached', timeout: UI_TIMEOUT }).catch(() => {});
}

const regsRevision = (page) =>
  evaluate(
    page,
    'the register fields revision',
    () => window.__easy68k.ctx.store.getState().sim.regsRevision,
    undefined,
    UI_TIMEOUT,
  );
/** A small read of page state, with the short limit. */
const read = (page, what, fn, arg) => evaluate(page, what, fn, arg, UI_TIMEOUT);

/**
 * One Trace Into with the toolbar, waiting until the step is shown (the register fields are re-read,
 * or a box is up) rather than for a fixed time: a slow runner may take longer than this PC.
 */
async function traceOnce(page) {
  const before = await regsRevision(page);
  await toolbarButton(page, 'sim.run.traceInto').click(); // waits until the button is enabled
  const shown = await waitFor(
    page,
    'Trace Into to show its step (the register fields re-read, or a box)',
    (revision) =>
      window.__easy68k.ctx.store.getState().sim.regsRevision !== revision ||
      document.querySelector('[role=alertdialog]') !== null,
    before,
  );
  if (!shown) throw new Error(`Trace Into showed no step within ${UI_TIMEOUT} ms`);
}

/** Trace Into with the toolbar until the program halts. */
async function traceToHalt(page, steps) {
  for (let i = 0; i < steps; i++) await traceOnce(page);
}

/**
 * Clicks a toolbar command that resets the simulator (Rewind, Reload) and waits until the reset is
 * shown (the register fields are re-read, the simulator idle), not for a fixed time.
 */
async function resetWith(page, id) {
  const before = await regsRevision(page);
  await toolbarButton(page, id).click();
  const done = await waitFor(
    page,
    `${id} to reset the simulator (fields re-read, phase idle)`,
    (revision) => {
      const { sim } = window.__easy68k.ctx.store.getState();
      return sim.regsRevision !== revision && sim.phase === 'idle';
    },
    before,
  );
  return done;
}

/** Where the program is held: D2 and the PC, read together (one call into the page). */
const heldAt = (page, when) =>
  read(page, `D2 and the PC ${when}`, () => {
    const { engine } = window.__easy68k.ctx.sim;
    return { d2: engine.getRegister(2), pc: engine.getRegister(17) }; // Reg.D2, Reg.PC
  });

/**
 * After Append (or Replace) on the counter's question: lets the program write 30 lines into the
 * log, stops the log and the run, and judges the output log in the store against `held`, the D2
 * and PC read while the question was open. The file held `an older log` before.
 */
async function countedLog(page, addresses, held) {
  // Until the program has written some lines into the log (by the log's own count, not a pause).
  await waitFor(
    page,
    'the program to write 30 lines into the log',
    () => window.__easy68k.ctx.sim.log.tail('output', 40).length >= 30,
    undefined,
  );
  await toolbarButton(page, 'sim.run.logStop').click();
  await toolbarButton(page, 'sim.run.pause').click();
  await waitFor(page, 'the run to be paused', () => window.__easy68k.ctx.store.getState().sim.phase === 'idle');
  await settled(page);
  const counted = (await readText(page, '/browser/logcheck/count_OutLog.txt')) ?? '';
  const prefix = /^an older log\r\nEASy68K output log file: [^\r]*\r\n\r\n/;
  if (!prefix.test(counted)) {
    return {
      ok: false,
      detail: `the file does not begin with the older log and a header: ${JSON.stringify(counted.slice(0, 80))}`,
    };
  }
  const body = counted.replace(prefix, '');
  const place = addresses.indexOf(held.pc);
  return { ...judgeCounterLog(body, place, held.d2), body, place };
}

// --- the parts -----------------------------------------------------------------------------------

async function loggingPart(browser, name, programs) {
  const p = `${name}/logging:`;
  const addresses = counterAddresses(programs.count.l68);
  const context = await newContext(browser);
  const { page, errors } = await openPage(context);
  const shot = (label) => page.screenshot({ path: join(outDir, `${name}-${label}.png`) });
  await setMode(page, 'simulator');
  await putPrograms(page, programs);

  check(
    `${p} Log Start and Log Stop are disabled at start-up, no LOGGING label`,
    !(await enabled(page, 'sim.run.logStart')) &&
      !(await enabled(page, 'sim.run.logStop')) &&
      (await loggingLabel(page).count()) === 0,
  );

  await openProgram(page, 'hello');
  const names = await logState(page);
  check(
    `${p} Open sets the default names; Log Start stays disabled while both types are Disabled`,
    names.execFileName === '/browser/logcheck/hello_RunLog.txt' &&
      names.outputFileName === '/browser/logcheck/hello_OutLog.txt' &&
      !(await enabled(page, 'sim.run.logStart')),
    `${names.execFileName}, ${names.outputFileName}`,
  );

  // --- Options > Log Output...
  await menu(page, 'Options', /^Log Output/);
  const dialog = dialogNamed(page, 'Log Output');
  await dialog.waitFor({ timeout: UI_TIMEOUT });
  const texts = await dialog.innerText();
  const wanted = [
    'Execution Log File Name:',
    'Execution Log Type',
    'Disabled',
    'Instruction only',
    'Instruction and Registers',
    'Instruction, Registers and Memory',
    'Output Log File Name:',
    'Output Log Type',
    'Text Only',
    'OK',
    'Cancel',
  ];
  const missing = wanted.filter((text) => !texts.includes(text));
  check(`${p} the Log Output dialog has the original's texts`, missing.length === 0, missing.join(', '));
  check(
    `${p} the Log Output dialog is modeless (no aria-modal) and shows the names`,
    (await dialog.getAttribute('aria-modal')) !== 'true' &&
      (await dialog.getByTestId('log-exec-name').inputValue()) === '/browser/logcheck/hello_RunLog.txt',
  );
  check(`${p} the memory range is hidden for Disabled`, (await dialog.getByTestId('log-mem-range').count()) === 0);
  await dialog.getByRole('radio', { name: 'Instruction, Registers and Memory' }).check();
  const memShown = (await dialog.getByTestId('log-mem-range').count()) === 1;
  check(`${p} the memory range appears for type 3`, memShown);
  await shot('log-output-type3');
  await axe(page, 'the Log Output dialog', p);
  await dialog.getByRole('radio', { name: 'Instruction only', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Text Only' }).check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await dialog.waitFor({ state: 'detached', timeout: UI_TIMEOUT });
  const saved = await read(page, 'the saved settings', () => window.__easy68k.ctx.settings.get().sim);
  check(
    `${p} OK enables Log Start and saves the two types`,
    (await enabled(page, 'sim.run.logStart')) && saved.execLogType === 1 && saved.outputLogType === 1,
    `exec ${saved.execLogType}, output ${saved.outputLogType}`,
  );

  // --- Log Start (no file yet), Trace Into to the halt
  await removeFile(page, '/browser/logcheck/hello_RunLog.txt');
  await removeFile(page, '/browser/logcheck/hello_OutLog.txt');
  await toolbarButton(page, 'sim.run.logStart').click();
  const logging = await loggingLabel(page)
    .waitFor({ timeout: UI_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  check(
    `${p} Log Start: LOGGING shown, Log Start disabled, Log Stop enabled`,
    logging && !(await enabled(page, 'sim.run.logStart')) && (await enabled(page, 'sim.run.logStop')),
  );
  await shot('logging');
  await traceToHalt(page, 4);
  await answerLogStopped(page, p);
  check(
    `${p} after the halt: no LOGGING label, Log Start enabled, Log Stop disabled`,
    (await loggingLabel(page).count()) === 0 &&
      (await enabled(page, 'sim.run.logStart')) &&
      !(await enabled(page, 'sim.run.logStop')),
  );
  await settled(page);
  const exec = await readText(page, '/browser/logcheck/hello_RunLog.txt');
  const output = await readText(page, '/browser/logcheck/hello_OutLog.txt');
  check(
    `${p} the execution log in the store is the example of sim-ui §13.4 (type 1), byte for byte`,
    exec !== null && EXEC_HEADER.test(exec) && exec.replace(EXEC_HEADER, '') === TYPE1_BODY,
    JSON.stringify(exec?.slice(0, 120)),
  );
  check(
    `${p} the output log holds its header and Hello`,
    output !== null && OUTPUT_HEADER.test(output) && output.replace(OUTPUT_HEADER, '') === 'Hello',
    JSON.stringify(output),
  );

  // --- the Log panel, from View > Log
  await menu(page, 'View', /^Log$/);
  const panel = page.locator(`${SIM} [data-e68-panel="log"]`);
  const panelShown = await panel
    .waitFor({ state: 'visible', timeout: UI_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  const panelFocused = await read(page, 'the focus of the Log panel', () =>
    Boolean(document.activeElement?.closest('[data-e68-panel="log"]')),
  );
  check(`${p} View > Log shows the Log panel and gives it the focus`, panelShown && panelFocused);
  const panelWanted = ['Stopped', 'hello_RunLog.txt', 'hello_OutLog.txt', 'Line=   12      SIMHALT', 'Hello'];
  await waitFor(
    page,
    'the Log panel to show the state, both names and the last lines',
    (wanted) => {
      const element = document.querySelector('[data-e68-panel="log"]');
      return element !== null && wanted.every((text) => element.innerText.includes(text));
    },
    panelWanted,
  );
  const panelText = panelShown ? await panel.innerText() : '';
  check(
    `${p} the Log panel shows the state, both names and the last lines`,
    panelWanted.every((text) => panelText.includes(text)),
    panelText.replace(/\s+/g, ' ').slice(0, 200),
  );
  // An execution-log line is seen whole, up to its source text (the pane is the panel's width).
  const lineWhole = await read(page, 'the place of SIMHALT in the Log panel', () => {
    const pre = document.querySelector('[data-e68-panel="log"] .e68-logpanel__text');
    if (!pre) return { ok: false, detail: 'no text' };
    const range = document.createRange();
    const node = [...pre.childNodes].find((n) => n.nodeType === 3);
    if (!node) return { ok: false, detail: 'empty' };
    const at = node.textContent.indexOf('SIMHALT');
    if (at < 0) return { ok: false, detail: 'no SIMHALT' };
    range.setStart(node, at);
    range.setEnd(node, at + 'SIMHALT'.length);
    const word = range.getBoundingClientRect();
    const box = pre.getBoundingClientRect();
    return {
      ok: word.right <= box.right && word.left >= box.left,
      detail: `SIMHALT at ${Math.round(word.left)}..${Math.round(word.right)}, pane ${Math.round(box.left)}..${Math.round(box.right)}`,
    };
  });
  check(`${p} the Log panel shows an execution-log line whole`, lineWhole.ok, lineWhole.detail);
  await shot('log-panel');

  // --- the question: Cancel
  await resetWith(page, 'sim.run.rewind');
  const before = await readText(page, '/browser/logcheck/hello_RunLog.txt');
  await toolbarButton(page, 'sim.run.logStart').click();
  const question = dialogNamed(page, 'Log File Options');
  await question.waitFor({ timeout: UI_TIMEOUT });
  const qText = await question.innerText();
  check(
    `${p} Log File Options: \`Execution Log File exists!\`, Replace, Append, Cancel`,
    qText.includes('Execution Log File exists!') &&
      ['Replace', 'Append', 'Cancel'].every((b) => qText.includes(b)) &&
      (await question.getAttribute('aria-modal')) === 'true',
    qText.replace(/\s+/g, ' '),
  );
  await shot('log-file-options');
  await axe(page, 'the Log File Options question', p);
  await question.getByRole('button', { name: 'Cancel' }).click();
  await question.waitFor({ state: 'detached', timeout: UI_TIMEOUT });
  // Cancel gives Log Start back once start() has finished.
  await waitFor(
    page,
    'Log Start to be enabled again after Cancel',
    () => window.__easy68k.ctx.sim.log.state.startEnabled,
    undefined,
  );
  const afterCancel = await logState(page);
  check(
    `${p} Cancel: logging stays off, the engine is not logging, the file is unchanged`,
    !afterCancel.logging &&
      !(await read(page, 'the engine logging flag', () => window.__easy68k.ctx.sim.engine.state().logging)) &&
      (await loggingLabel(page).count()) === 0 &&
      (await readText(page, '/browser/logcheck/hello_RunLog.txt')) === before &&
      (await enabled(page, 'sim.run.logStart')),
  );

  // --- Append (execution log), Replace (output log); the notes after the dialog was shown
  await menu(page, 'Options', /^Log Output/);
  await dialog.waitFor({ timeout: UI_TIMEOUT });
  await dialog.getByRole('button', { name: 'Cancel' }).click(); // shown with both types selected
  await dialog.waitFor({ state: 'detached', timeout: UI_TIMEOUT });
  await toolbarButton(page, 'sim.run.logStart').click();
  await question.waitFor({ timeout: UI_TIMEOUT });
  await question.getByRole('button', { name: 'Append' }).click();
  const second = dialogNamed(page, 'Log File Options');
  await waitFor(
    page,
    "the output log's question",
    () => document.body.innerText.includes('Output Log File exists!'),
    undefined,
  );
  check(`${p} then the output log's question`, (await second.innerText()).includes('Output Log File exists!'));
  await second.getByRole('button', { name: 'Replace' }).click();
  await loggingLabel(page).waitFor({ timeout: UI_TIMEOUT });
  await traceOnce(page);
  await resetWith(page, 'sim.run.rewind');
  await resetWith(page, 'sim.run.reload');
  // Log Stop with the keyboard, from the Listing panel.
  await page.locator(`${SIM} [data-e68-panel="listing"] [data-e68-panel-focus]`).focus();
  const chord = await pressCommandKey(page, 'sim.run.logStop', 'Shift');
  await waitFor(page, 'Log Stop to stop the log', () => !window.__easy68k.ctx.sim.log.state.logging, undefined);
  check(`${p} Log Stop with ${chord} stops the log`, !(await logState(page)).logging);
  await settled(page);
  const appended = await readText(page, '/browser/logcheck/hello_RunLog.txt');
  const replaced = await readText(page, '/browser/logcheck/hello_OutLog.txt');
  check(
    `${p} Append kept the earlier execution log and added a header, an entry and both notes`,
    appended !== null &&
      appended.startsWith(before ?? '\u0000') &&
      (appended.match(/EASy68K execution log file:/g) ?? []).length === 2 &&
      appended.includes('\r\n***** Reset Program Pressed *****\r\n') &&
      appended.includes('\r\n***** Reload Program Pressed *****\r\n'),
    JSON.stringify(appended?.slice((before ?? '').length)),
  );
  check(
    `${p} Replace started the output log afresh, with both notes as bare LF`,
    replaced !== null &&
      OUTPUT_HEADER.test(replaced) &&
      replaced.replace(OUTPUT_HEADER, '') ===
        '\n***** Reset Program Pressed *****\n\n***** Reload Program Pressed *****\n',
    JSON.stringify(replaced),
  );

  // --- Log Start during a run, the file exists, the question stays open
  await openProgram(page, 'count');
  await writeText(page, '/browser/logcheck/count_OutLog.txt', 'an older log\r\n');
  await read(page, 'the log types to be set (output log only)', () => {
    const { log } = window.__easy68k.ctx.sim;
    log.applyDialog({ ...log.state, execType: 0, outputType: 1 });
  });
  await toolbarButton(page, 'sim.run.run').click();
  await waitFor(
    page,
    'the counter program to pass D2 = 500',
    () => window.__easy68k.ctx.sim.engine.getRegister(2) > 500,
    undefined,
  );
  await toolbarButton(page, 'sim.run.logStart').click();
  await question.waitFor({ timeout: UI_TIMEOUT });
  const asked = await heldAt(page, 'while the question is open');
  await page.waitForTimeout(3000); // the user takes their time
  const later = await heldAt(page, 'three seconds later');
  check(
    `${p} the program stands still while the question is open`,
    asked.d2 === later.d2 && asked.pc === later.pc,
    `D2 ${asked.d2} -> ${later.d2}, PC $${asked.pc.toString(16)} -> $${later.pc.toString(16)}`,
  );
  await question.getByRole('button', { name: 'Append' }).click();
  const judged = await countedLog(page, addresses, asked);
  check(`${p} Log Start during a run: every byte written after the click is in the log`, judged.ok, judged.detail);

  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/**
 * Log Start with the counter held before each of the eight instructions of its loop (brought there
 * with Trace Into), then Run: the log must begin exactly where counterLogStart says for the D2 and
 * PC read while the question is open, and the same judge must fail for that log with its first line
 * or a later line removed. This proves the judge of the run case above, where the place is wherever
 * the run controller happened to hold the program (errata U4.md entry 17).
 */
async function placesPart(browser, name, programs) {
  const p = `${name}/places:`;
  const addresses = counterAddresses(programs.count.l68);
  const context = await newContext(browser);
  const { page, errors } = await openPage(context);
  await setMode(page, 'simulator');
  await putPrograms(page, programs);
  await openProgram(page, 'count');
  await read(page, 'the log types to be set (output log only)', () => {
    const { log } = window.__easy68k.ctx.sim;
    log.applyDialog({ ...log.state, execType: 0, outputType: 1 });
  });
  const question = dialogNamed(page, 'Log File Options');
  for (let place = 0; place < COUNTER_PLACES.length; place++) {
    const what = `${p} held before ${COUNTER_PLACES[place]}`;
    if (place > 0) await resetWith(page, 'sim.run.rewind');
    // From START: one step for MOVEQ #0,D2, then `place` steps into the loop.
    for (let i = 0; i <= place; i++) await traceOnce(page);
    await writeText(page, '/browser/logcheck/count_OutLog.txt', 'an older log\r\n');
    await toolbarButton(page, 'sim.run.logStart').click();
    await question.waitFor({ timeout: UI_TIMEOUT });
    const held = await heldAt(page, 'while the question is open');
    const there = held.pc === addresses[place];
    await question.getByRole('button', { name: 'Append' }).click();
    await loggingLabel(page).waitFor({ timeout: UI_TIMEOUT });
    await toolbarButton(page, 'sim.run.run').click();
    const judged = await countedLog(page, addresses, held);
    check(
      `${what}: Trace Into brought it there, and the log begins as computed from D2 and the PC`,
      there && judged.ok,
      `${there ? '' : `PC $${held.pc.toString(16)}, not $${addresses[place].toString(16)}; `}${judged.detail}`,
    );
    const body = judged.body ?? '';
    const firstGone = judgeCounterLog(withoutLine(body, judged.place, held.d2, 0), judged.place, held.d2);
    const laterGone = judgeCounterLog(withoutLine(body, judged.place, held.d2, 5), judged.place, held.d2);
    check(
      `${what}: the same log with its first line or its sixth line removed fails`,
      judged.body !== undefined && !firstGone.ok && !laterGone.ok,
      `first removed: ${firstGone.detail}; sixth removed: ${laterGone.detail}`,
    );
  }
  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** Flush cost in the real browser store: a 30 MB log against a small one. */
async function flushPart(browser, name, programs) {
  const p = `${name}/flush:`;
  const context = await newContext(browser);
  const { page, errors } = await openPage(context);
  await setMode(page, 'simulator');
  await putPrograms(page, programs);
  await openProgram(page, 'hello');
  // `dir`: a folder of its own, or the loaded program's folder, whose cached copy for the program
  // (3.8.4, CachedSyncFiles) follows every change of the file.
  // Every step inside the page has a limit of its own and returns what it was waiting for, so
  // that a slow store fails this part with a reason instead of waiting for ever (gate I2 review:
  // WebKit once waited here more than 12 minutes, in the 30 MB case of the program's folder, where
  // the question can take longer than the 20 s the loop once allowed, and nobody answered it).
  const measure = async (size, dir = '/browser/logcheck-big') => {
    const label = `${size >= 1024 * 1024 ? `${size / 1024 / 1024} MB` : `${size} bytes`} in ${dir}`;
    const result = await evaluate(
      page,
      `the flush measurement (${label})`,
      async ([bytes, folder, bigMs, storeMs]) => {
        const { ctx } = window.__easy68k;
        const { log } = ctx.sim;
        const path = `${folder}/hello_OutLog.txt`;
        const within = (promise, ms) =>
          Promise.race([
            promise.then(
              (value) => ({ done: true, value }),
              (error) => ({ done: true, error: String(error?.message ?? error) }),
            ),
            new Promise((resolve) => setTimeout(() => resolve({ done: false }), ms)),
          ]);
        const phases = {};
        let t = performance.now();
        const written = await within(ctx.vfs.writeFile(path, new Uint8Array(bytes).fill(0x41)), bigMs);
        phases.writeMs = Math.round(performance.now() - t);
        if (!written.done) return { reason: `the ${bytes}-byte file was not written within ${bigMs} ms`, phases };
        if (written.error) return { reason: `writing the file failed: ${written.error}`, phases };
        log.applyDialog({ ...log.state, execType: 0, outputType: 1, outputFileName: path });
        // The file exists: start() asks Log File Options; Append is pressed here.
        t = performance.now();
        let startSettled = false;
        const started = log.start();
        started.then(
          () => (startSettled = true),
          () => (startSettled = true),
        );
        let answered = false;
        const deadline = performance.now() + bigMs;
        while (!startSettled && performance.now() < deadline) {
          const button = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent === 'Append');
          if (button) {
            button.click();
            answered = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        phases.questionMs = Math.round(performance.now() - t);
        if (!answered && !startSettled) {
          return { reason: `the Log File Options question was not shown within ${bigMs} ms after Log Start`, phases };
        }
        const outcome = await within(started, storeMs);
        phases.startMs = Math.round(performance.now() - t);
        if (!outcome.done) return { reason: `log.start() did not resolve within ${storeMs} ms after Append`, phases };
        if (outcome.value !== true) {
          return {
            reason: answered
              ? `log.start() resolved ${outcome.error ?? outcome.value} after Append`
              : `log.start() resolved ${outcome.error ?? outcome.value} before any question was shown`,
            phases,
          };
        }
        const chunk = new Uint8Array(8192).fill(0x42);
        const times = [];
        for (let i = 0; i < 30; i++) {
          log.outputWrite(chunk);
          const t0 = performance.now();
          const flushed = await within(log.flush(), storeMs);
          if (!flushed.done) {
            log.stop();
            return { reason: `flush ${i + 1} of 30 did not finish within ${storeMs} ms`, phases };
          }
          times.push(performance.now() - t0);
        }
        log.stop();
        const last = await within(log.flush(), storeMs);
        if (!last.done) return { reason: `the flush after Log Stop did not finish within ${storeMs} ms`, phases };
        const stat = await within(ctx.vfs.stat(path), storeMs);
        const size = stat.done ? (stat.value?.size ?? -1) : -1;
        times.sort((a, b) => a - b);
        return { median: times[15], size, phases };
      },
      [size, dir, BIG_FILE_TIMEOUT, STORE_TIMEOUT],
      // the page's own limits, one after the other at most, and a margin
      2 * BIG_FILE_TIMEOUT + 3 * STORE_TIMEOUT,
    );
    if (result.reason) return { ...result, reason: `${label}: ${result.reason} (${JSON.stringify(result.phases)})` };
    return result;
  };

  let best = Infinity;
  let detail = '';
  for (let attempt = 0; attempt < 3 && best >= 2; attempt++) {
    const small = await measure(1024);
    const big = small.reason ? small : await measure(30 * 1024 * 1024);
    if (small.reason || big.reason) {
      detail = small.reason ?? big.reason;
      break;
    }
    const ratio = big.median / Math.max(small.median, 0.1);
    best = Math.min(best, ratio);
    detail = `small ${small.median.toFixed(2)} ms, 30 MB ${big.median.toFixed(2)} ms per flush (ratio ${ratio.toFixed(2)}); sizes ${small.size}, ${big.size}; 30 MB file written in ${big.phases.writeMs} ms, question after ${big.phases.questionMs} ms`;
    note(`${p} ${detail}`);
    if (big.size < 30 * 1024 * 1024 + 30 * 8192) detail += ' (the file is shorter than what was written)';
  }
  check(`${p} a 30 MB log costs the same per flush as a small one (IndexedDB)`, best < 3, detail);
  // The same in the program's folder, where the log goes by default: reported, not judged here.
  // That it ends, with a result or a reason, is judged.
  const smallThere = await measure(1024, '/browser/logcheck');
  const bigThere = smallThere.reason ? smallThere : await measure(30 * 1024 * 1024, '/browser/logcheck');
  if (!smallThere.reason && !bigThere.reason) {
    note(
      `${p} in the loaded program's folder: small ${smallThere.median.toFixed(2)} ms, 30 MB ${bigThere.median.toFixed(2)} ms per flush (the program's cached copy of the folder reads the whole file again after each append); 30 MB file written in ${bigThere.phases.writeMs} ms, question after ${bigThere.phases.questionMs} ms`,
    );
  }
  check(
    `${p} the measurement in the loaded program's folder ends within its time limits`,
    !smallThere.reason && !bigThere.reason,
    smallThere.reason ?? bigThere.reason ?? '',
  );
  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function optionsPart(browser, name, colorScheme) {
  const p = `${name}/options (${colorScheme}):`;
  const context = await newContext(browser, colorScheme);
  const { page, errors } = await openPage(context);
  const shot = (label) => page.screenshot({ path: join(outDir, `${name}-${colorScheme}-${label}.png`) });
  await setMode(page, 'simulator');

  // --- Auto Trace Options
  await menu(page, 'Options', /^Auto Trace Options/);
  const auto = dialogNamed(page, 'Auto Trace Options');
  await auto.waitFor({ timeout: UI_TIMEOUT });
  const autoText = await auto.innerText();
  const field = auto.getByRole('spinbutton');
  check(
    `${p} Auto Trace Options: interval 200 mSec, read-only, \`Disable display update\``,
    autoText.includes('Auto Trace Interval') &&
      autoText.includes('mSec') &&
      autoText.includes('Disable display update') &&
      (await field.inputValue()) === '200' &&
      (await field.getAttribute('readonly')) !== null,
  );
  await shot('auto-trace');
  await axe(page, 'the Auto Trace Options dialog', p);
  await field.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await auto.getByRole('checkbox').check();
  await auto.getByRole('button', { name: 'Cancel' }).click();
  await auto.waitFor({ state: 'detached' });
  let sim = await read(page, 'the saved settings', () => window.__easy68k.ctx.settings.get().sim);
  check(`${p} Cancel changes nothing`, sim.autoTraceIntervalMs === 200 && sim.disableDisplay === false);
  await menu(page, 'Options', /^Auto Trace Options/);
  await auto.waitFor({ timeout: UI_TIMEOUT });
  await field.focus();
  await page.keyboard.press('ArrowUp');
  await auto.getByRole('checkbox').check();
  await auto.getByRole('button', { name: 'OK' }).click();
  await auto.waitFor({ state: 'detached' });
  sim = await read(page, 'the saved settings', () => window.__easy68k.ctx.settings.get().sim);
  check(
    `${p} OK saves the interval (step 10) and the check box`,
    sim.autoTraceIntervalMs === 210 && sim.disableDisplay === true,
    `${sim.autoTraceIntervalMs} ms, ${sim.disableDisplay}`,
  );

  // --- Enable Exceptions, Enable Bit Field: saved at once, still set after a reload
  await menu(page, 'Options', /^Enable Exceptions/);
  await menu(page, 'Options', /^Enable Bit Field Instructions/);
  const engineOptions = () =>
    read(page, 'the engine options Exceptions and Bit Field', () => {
      const { engine } = window.__easy68k.ctx.sim;
      return [engine.getOption(0), engine.getOption(1)];
    });
  const [exc, bit] = await engineOptions();
  check(
    `${p} Enable Exceptions and Enable Bit Field: checked, the engine follows`,
    (await menuChecked(page, 'Options', /^Enable Exceptions/)) &&
      (await menuChecked(page, 'Options', /^Enable Bit Field/)) &&
      exc === 1 &&
      bit === 1,
    `engine ${exc}, ${bit}`,
  );
  await page.reload({ timeout: LOAD_TIMEOUT });
  await waitForApp(page);
  await setMode(page, 'simulator');
  sim = await read(page, 'the saved settings', () => window.__easy68k.ctx.settings.get().sim);
  const [exc2, bit2] = await engineOptions();
  check(
    `${p} both are still set after a reload of the page (saved at once)`,
    sim.exceptions && sim.bitField && exc2 === 1 && bit2 === 1 && sim.autoTraceIntervalMs === 210,
  );
  await menu(page, 'Options', /^Enable Exceptions/);
  await menu(page, 'Options', /^Enable Bit Field Instructions/);

  // --- Output Window Font
  await menu(page, 'Options', /^Output Window Font/);
  const font = dialogNamed(page, 'Output Window Font');
  await font.waitFor({ timeout: UI_TIMEOUT });
  const fonts = await font.getByRole('listbox', { name: 'Font', exact: true }).getByRole('option').allInnerTexts();
  check(
    `${p} Output Window Font lists the five measured fonts`,
    JSON.stringify(fonts) === JSON.stringify(['Fixedsys', 'Courier', 'Courier New', 'Lucida Console', 'Consolas']),
    fonts.join(', '),
  );
  await font.getByRole('option', { name: 'Consolas' }).click();
  const size = font.getByRole('spinbutton');
  await size.fill('12');
  await size.press('Tab');
  await font.getByRole('listbox', { name: 'Font style' }).getByRole('option', { name: 'Bold', exact: true }).click();
  await shot('output-font');
  await axe(page, 'the Output Window Font dialog', p);
  await font.getByRole('button', { name: 'OK' }).click();
  await font.waitFor({ state: 'detached' });
  const after = await read(page, 'the saved output font and the text screen font', () => ({
    saved: window.__easy68k.ctx.settings.get().sim.outputFont,
    screen: window.__easy68k.ctx.sim.text.state.optionsFont,
  }));
  check(
    `${p} OK saves name and size and gives the Output panel the font (TextScreen.setOptionsFont)`,
    after.saved.name === 'Consolas' &&
      after.saved.size === 12 &&
      after.screen.name === 'Consolas' &&
      after.screen.size === 12 &&
      after.screen.bold === true,
    JSON.stringify(after),
  );

  // --- Source Window Font, Printer Font
  await menu(page, 'Options', /^Source Window Font/);
  const source = dialogNamed(page, 'Source Window Font');
  await source.waitFor({ timeout: UI_TIMEOUT });
  await source.getByRole('option', { name: 'Lucida Console' }).click();
  await source.getByRole('button', { name: 'OK' }).click();
  await source.waitFor({ state: 'detached' });
  await menu(page, 'Options', /^Printer Font/);
  const printer = dialogNamed(page, 'Printer Font');
  await printer.waitFor({ timeout: UI_TIMEOUT });
  await printer.getByRole('textbox', { name: 'Font:' }).fill('Arial');
  await printer.getByRole('button', { name: 'OK' }).click();
  await printer.waitFor({ state: 'detached' });
  sim = await read(page, 'the saved settings', () => window.__easy68k.ctx.settings.get().sim);
  check(
    `${p} Source Window Font and Printer Font are saved`,
    sim.listingFont.name === 'Lucida Console' && sim.printerFont.name === 'Arial',
    `${sim.listingFont.name}, ${sim.printerFont.name}`,
  );

  // --- Fullscreen Options
  await menu(page, 'Options', /^Fullscreen Options/);
  const full = dialogNamed(page, 'Fullscreen Options');
  await full.waitFor({ timeout: UI_TIMEOUT });
  const fullText = await full.locator('p').textContent();
  const screen = full.getByRole('textbox', { name: 'Screen number' });
  const okButton = full.getByRole('button', { name: 'Ok' });
  const okWithOne = (await screen.inputValue()) === '1' && !(await okButton.isDisabled());
  await screen.fill('2');
  const okWithTwo = !(await okButton.isDisabled());
  check(
    `${p} Fullscreen Options: the original's text (double spaces kept), Ok only for screen 1`,
    fullText === 'Screen to use for fullscreen output window.  Primary screen = 1  Secondary screens = 2 and up.' &&
      okWithOne &&
      !okWithTwo,
    JSON.stringify(fullText),
  );
  await shot('fullscreen-options');
  await axe(page, 'the Fullscreen Options dialog', p);
  await full.getByRole('button', { name: 'Cancel' }).click();
  await full.waitFor({ state: 'detached' });

  check(`${p} no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- run -----------------------------------------------------------------------------------------

async function main() {
  if (!enginesBuilt()) {
    const required = process.env.EASY68K_REQUIRE_ENGINES === '1';
    console.log(
      `engine/dist is missing: run \`npm run build:engines\` first. ${required ? 'EASY68K_REQUIRE_ENGINES is 1: that is a failure.' : 'Nothing was checked.'}`,
    );
    process.exit(required ? 1 : 0);
  }
  // The run's own limit: ends the process with what it was waiting for, before CI's step limit
  // would end it with nothing in the log.
  const watchdog = setTimeout(() => {
    console.log(
      `\nFAIL the check did not finish within ${RUN_TIMEOUT / 60_000} minutes: in the part [${currentPart}], waiting for ${waitingFor}.`,
    );
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed} of ${results.length + 1} checks passed, ${failures + 1} failed.`);
    process.exit(1);
  }, RUN_TIMEOUT);
  watchdog.unref();
  const programs = await assemblePrograms();
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
  baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      currentPart = `${name}, launch`;
      const browser = await withLimit(BROWSERS[name].launch(), LOAD_TIMEOUT, `${name} to start`);
      try {
        for (const [part, run] of [
          ['logging', () => loggingPart(browser, name, programs)],
          ['places', () => placesPart(browser, name, programs)],
          ['flush', () => flushPart(browser, name, programs)],
          ['options light', () => optionsPart(browser, name, 'light')],
          ['options dark', () => optionsPart(browser, name, 'dark')],
        ]) {
          console.log(`\n[${name}, ${part}]`);
          currentPart = `${name}, ${part}`;
          try {
            await withLimit(run(), PART_TIMEOUT, `the part [${name}, ${part}] to finish`);
          } catch (error) {
            check(
              `${name}/${part}: ran to the end`,
              false,
              `${String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | ')} (last wait: ${waitingFor})`,
            );
            await closeLeftContexts();
          }
        }
      } finally {
        await withLimit(browser.close(), UI_TIMEOUT * 3, `${name} to close`).catch((error) => note(error.message));
      }
    }
  } finally {
    await withLimit(server.close(), UI_TIMEOUT, 'the dev server to close').catch((error) => note(error.message));
  }
  if (notes.length > 0) console.log(`\nNotes (not failures):\n${notes.map((text) => `  - ${text}`).join('\n')}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
