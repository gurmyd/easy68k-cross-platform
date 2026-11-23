// The scenario of integration gate I2 (ARCHITECTURE.md 9.5) on the real application. Owner: I2.
//
//   node tests/integration/wave2/check-wave2.mjs [--browser chromium|webkit|all] [--out <dir>]
//        [--only examples,cycle,settings,logging,files,breakpoint,replace,error,include,windows,
//                reopen,commands,subpath]
//
// Starts the Vite dev server of app/ on a free port and drives the application in headless
// Chromium (Windows key map) and WebKit (macOS key map) through Playwright, the way a student meets
// it: menus, toolbars, the chords of the application's own chord table (chordsOn() of
// commands/specs.ts), the dialogs, the Files panel and the listing's gutter.
//
//   examples    Help > Examples...; each of the ten official examples is opened from the Files panel,
//               assembled with F9 (the .L68 and .S68 in the store are compared with the official
//               EASy68K's, tests/conformance/asm/golden/official), executed and run to its end or
//               its first input; the Output panel is compared with the headless session of 6.4; the
//               sounds graphicSound.X68 starts are timed
//   cycle       edit, assemble and Execute three times in a row: each Execute is a cold start
//   settings    the original's settings.dat and sim68K.dat imported, a change, both exported, the
//               exports imported in a new browser profile, and Execute obeys them
//   logging     Options > Log Output..., Log Start, Trace Into to the halt: both logs in the store
//               equal the official EASy68K's logs of the same program (tests/conformance/sim)
//   files       a program that writes, closes and reads back a file: the bytes are in the store
//   breakpoint  a gutter click in the listing, Run stops there, Run goes on to the halt
//   replace     Replace All before assembling changes what the program prints
//   error       a program with an error: the message, the marker, the correction
//   include     a program that INCLUDEs a file next to it in the store
//   windows     two windows of the application at once: one store, two simulators, the settings
//   reopen      the page is closed in the middle (a modified document, a running program) and opened
//               again: the draft is offered, the files are there
//   commands    no command id without a handler, in all three modes (9.5 acceptance)
//   subpath     the production build under the published preview's sub-path, as pages.yml makes it:
//               an example opened, assembled, executed and run
//
// The page object `window.__easy68k` (development builds only, main.tsx) is used to READ state for
// the comparisons. Actions go through the interface, with three declared exceptions that a student
// does by typing or by the Files panel and that other checks already cover: writing a source file
// into the store (ctx.vfs.writeFile, the student typed it), opening it in the editor
// (ctx.documents.open, what the Files panel's double-click calls), and placing the caret in the
// editor before typing (the editor view's dispatch).
//
// Screenshots go to build/I2/wave2-check (git-ignored). Prints "N of M checks passed"; the exit code
// is 0 only if every check passed and no page logged an error. Needs engine/dist and the pinned
// development dependencies; the subpath part also runs `vite build` into the output folder.

// The browser globals below are used inside page callbacks, which run in the page.
/* global document, window */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { closeAtEnd, closeWithin, doneWith, endChecks } from '../../browser-checks/ending.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const appRoot = join(repoRoot, 'app');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'I2', 'wave2-check')));
const only = option('--only', '')
  .split(',')
  .filter((part) => part !== '');
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
/** The key map each browser runs with. */
const OS_OF = { chromium: 'windows', webkit: 'mac' };
/** The published preview's sub-path (pages.yml: the repository's name). Any sub-path proves the rule. */
const SUB_PATH = '/easy68k-cross-platform/';

const LOAD_TIMEOUT = 240_000;
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
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const maskCreatedOn = (text) => text.replace(/^(Created On:)[^\r\n]*/m, '$1<date>');
const maskLogDate = (text) => text.replace(/^(EASy68K (?:execution|output) log file: )[^\r\n]*/, '$1<date>');

// --- the page (the helpers of tests/integration/wave1/check-wave1.mjs) -------------------------

function pretendSystem(os) {
  const platform = os === 'mac' ? 'MacIntel' : 'Win32';
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
  // Observation only: every sound the page starts, with the page's clock and the buffer's length.
  window.__sounds = [];
  // Observation only: the audio contexts the page makes, to tell "nothing played" from "no audio here".
  window.__audioContexts = [];
  const Native = window.AudioContext ?? window.webkitAudioContext;
  if (Native) {
    const Recorded = class extends Native {
      constructor(...rest) {
        super(...rest);
        window.__audioContexts.push(this);
      }
    };
    window.AudioContext = Recorded;
    if (window.webkitAudioContext) window.webkitAudioContext = Recorded;
  }
  // Playwright's WebKit on Windows has no Web Audio at all.
  const Source = window.AudioBufferSourceNode;
  if (!Source) return;
  const start = Source.prototype.start;
  Source.prototype.start = function (...rest) {
    // start(when) may schedule the sound ahead of the context's clock: `at` is when it is heard.
    // start(when, offset) with an offset starts a late sound part-way in, as if it had begun
    // `offset` earlier: `at` is when its beginning is (or would have been) heard.
    const ahead = typeof rest[0] === 'number' ? Math.max(0, rest[0] - this.context.currentTime) * 1000 : 0;
    const offset = typeof rest[1] === 'number' ? rest[1] * 1000 : 0;
    window.__sounds.push({
      at: performance.now() + ahead - offset,
      called: performance.now(),
      ahead,
      offset,
      state: this.context.state,
      ms: this.buffer ? this.buffer.duration * 1000 : -1,
    });
    return start.apply(this, rest);
  };
}

async function newContext(browser, os) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendSystem, os);
  // A click on something a dialog covers must fail as a step, not wait for ever.
  context.setDefaultTimeout(STEP_TIMEOUT);
  openContexts.add(context);
  context.on('close', () => openContexts.delete(context));
  return context;
}
/** The contexts of the part that runs: a part that fails leaves screenshots of its pages. */
const openContexts = new Set();
async function shootAndClose(label) {
  let i = 0;
  for (const context of [...openContexts]) {
    for (const page of context.pages()) {
      await page.screenshot({ path: join(outDir, `${label}-failed-${i++}.png`) }).catch(() => {});
      const dialogs = await page
        .locator('[role=dialog], [role=alertdialog]')
        .allInnerTexts()
        .catch(() => []);
      if (dialogs.length > 0)
        console.log(
          `        open dialogs: ${JSON.stringify(dialogs.map((t) => t.replace(/\s+/g, ' ').slice(0, 120)))}`,
        );
    }
    await closeWithin(context);
  }
}

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
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, {
    timeout: 60_000,
  });
  // Observation only: how often the window's simulator was replaced (a cold start, 4.7.1).
  await page.evaluate(() => {
    window.__replaced = 0;
    window.__easy68k.ctx.sim.onEngineReplaced(() => void window.__replaced++);
  });
}

async function openApp(context, url = baseUrl) {
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(url, { timeout: LOAD_TIMEOUT });
  await waitForApp(page);
  return { page, errors };
}

async function menu(page, title, item) {
  await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: new RegExp(`^${title}$`) }).click();
  await page.locator('[role=menu][data-e68-menu] [role^=menuitem]', { hasText: item }).first().click();
}
const setMode = (page, mode) => page.locator(`.e68-modeswitch [data-mode="${mode}"]`).click();
const toolbarButton = (page, id) => page.locator(`.e68-shell__toolbar [data-command="${id}"]`);
const filesRow = (page, name) => page.locator('[data-e68-panel="files"] [role=treeitem]', { hasText: name });
const SIM = '[data-e68-workspace="simulator"]';
const waitFor = (page, predicate, arg, timeout = STEP_TIMEOUT) =>
  page.waitForFunction(predicate, arg, { timeout }).then(
    () => true,
    () => false,
  );
const statusText = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-e68-status]')].map((cell) => cell.textContent).join(' | '));

const PLAYWRIGHT_MODIFIERS = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Cmd: 'Meta' };
function playwrightKey(chord) {
  const parts = chord.split('+');
  const key = parts.pop();
  const name = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key === 'Esc' ? 'Escape' : key;
  return [...parts.map((modifier) => PLAYWRIGHT_MODIFIERS[modifier]), name].join('+');
}
/** The chords of a command on the page's key map, from the application's own table. */
const chordsOf = (page, id) =>
  page.evaluate(async (id) => {
    const { chordsOn } = await import('/src/commands/specs.ts');
    return chordsOn(id, window.__easy68k.ctx.platform.os, false);
  }, id);
async function pressCommand(page, id) {
  const chords = await chordsOf(page, id);
  if (chords.length === 0) throw new Error(`${id} has no chord on this key map`);
  await page.keyboard.press(playwrightKey(chords[0]), { delay: 60 });
}

async function outputRows(page) {
  const rows = await page
    .locator(`${SIM} [data-e68-panel="output"] [role=log] > div`)
    .evaluateAll((elements) => elements.map((element) => (element.textContent ?? '').replace(/\s+$/, '')));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}
async function outputBecomes(page, expected, timeout = 6000) {
  for (const deadline = Date.now() + timeout; ;) {
    const rows = await outputRows(page);
    if (same(rows, expected) || Date.now() > deadline) return rows;
    await page.waitForTimeout(150);
  }
}

// --- the editor, the assembler, Execute --------------------------------------------------------

const writeText = (page, path, text) =>
  page.evaluate(
    ([path, text]) =>
      window.__easy68k.ctx.vfs.writeFile(
        path,
        Uint8Array.from(text, (c) => c.charCodeAt(0)),
      ),
    [path, text],
  );
const writeBytes = (page, path, bytes) =>
  page.evaluate(
    ([path, bytes]) => window.__easy68k.ctx.vfs.writeFile(path, Uint8Array.from(bytes)),
    [path, [...bytes]],
  );
const readBytes = (page, path) =>
  page.evaluate(async (path) => {
    const { vfs } = window.__easy68k.ctx;
    return (await vfs.stat(path)) ? [...(await vfs.readFile(path))] : null;
  }, path);
async function openDocument(page, path) {
  const id = await withLimit(
    page.evaluate(async (path) => (await window.__easy68k.ctx.documents.open(path))?.id ?? null, path),
    STEP_TIMEOUT,
    'hung',
  );
  if (id === 'hung') {
    const shown = await page.locator('[role=dialog], [role=alertdialog]').allInnerTexts();
    throw new Error(`opening ${path} did not finish; dialogs: ${JSON.stringify(shown)}`);
  }
  return id;
}
const activeText = (page) =>
  page.evaluate(() => {
    const id = window.__easy68k.ctx.store.getState().documents.activeId;
    return document.querySelector(`[data-e68-document="${id}"]`)?.e68View.state.doc.toString() ?? null;
  });
async function focusEditor(page) {
  await page.evaluate(() => {
    const id = window.__easy68k.ctx.store.getState().documents.activeId;
    document.querySelector(`[data-e68-document="${id}"]`).e68View.focus();
  });
}
/** Selects `from`..`to` of the active document (the caret placed as a click would). */
const selectRange = (page, from, to) =>
  page.evaluate(
    ([from, to]) => {
      const id = window.__easy68k.ctx.store.getState().documents.activeId;
      const view = document.querySelector(`[data-e68-document="${id}"]`).e68View;
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
      view.focus();
    },
    [from, to],
  );

const statusDialog = (page) => page.locator('[role=dialog].e68-asm-status');
/** F9 on the active document with the key map's first chord; the status dialog's contents. */
async function assemble(page) {
  await setMode(page, 'editor');
  await focusEditor(page);
  await pressCommand(page, 'ed.project.assemble');
  const dialog = statusDialog(page);
  await dialog.waitFor({ timeout: 60_000 });
  return {
    title: await dialog.locator('.e68-dialog__title').innerText(),
    warnings: await dialog.locator('[data-e68-count=warnings]').innerText(),
    errors: await dialog.locator('[data-e68-count=errors]').innerText(),
    executeEnabled: await dialog
      .locator('.e68-dialog__footer')
      .getByRole('button', { name: 'Execute', exact: true })
      .isEnabled(),
  };
}
async function closeStatus(page, button) {
  await statusDialog(page).locator('.e68-dialog__footer').getByRole('button', { name: button, exact: true }).click();
  await statusDialog(page).waitFor({ state: 'detached', timeout: STEP_TIMEOUT });
}
/** The status dialog's Execute; the Caution question answered OK. True when `s68` is loaded and idle. */
async function execute(page, s68) {
  await closeStatus(page, 'Execute');
  await page.waitForTimeout(150);
  const caution = page.locator('[role=alertdialog]', { hasText: 'debug environment will be lost' });
  if ((await caution.count()) > 0) await caution.getByRole('button', { name: 'OK' }).click();
  return waitFor(
    page,
    (path) => {
      const s = window.__easy68k.ctx.store.getState();
      return s.mode === 'simulator' && s.sim.program?.path === path && s.sim.phase === 'idle';
    },
    s68,
    60_000,
  );
}

/** Run with the toolbar until the program halts, stops or waits for input, or `ms` pass. */
async function run(page, ms = 8000, button = 'sim.run.run') {
  const before = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount);
  await toolbarButton(page, button).click();
  await waitFor(
    page,
    (steps) => {
      const { ctx } = window.__easy68k;
      const s = ctx.store.getState().sim;
      if (ctx.sim.engine.stepCount === steps) return false;
      return s.phase === 'idle' || s.phase === 'waitInput';
    },
    before,
    ms,
  );
  await page.waitForTimeout(300);
  return endOf(page);
}
const endOf = (page) =>
  page.evaluate(() => {
    const s = window.__easy68k.ctx.store.getState().sim;
    if (s.phase === 'idle') return window.__easy68k.ctx.sim.controller.snapshot.halted ? 'halted' : 'stopped';
    return s.phase === 'waitInput' ? 'waiting for input' : s.phase === 'running' ? 'still running' : 'waiting';
  });
async function pauseAndAnswer(page) {
  for (const button of await page.locator('[role=alertdialog] button').all()) await button.click().catch(() => {});
  if ((await page.evaluate(() => window.__easy68k.ctx.store.getState().sim.phase)) !== 'idle') {
    await toolbarButton(page, 'sim.run.pause').click();
    await waitFor(page, () => window.__easy68k.ctx.store.getState().sim.phase === 'idle', null, 5000);
  }
}
const replaced = (page) => page.evaluate(() => window.__replaced);
/** `promise`, or `fallback` after `ms`. */
const withLimit = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((resolveLate) => setTimeout(() => resolveLate(fallback), ms))]);
/** True when the page's main thread answers within five seconds (a page in an endless loop does not). */
const responsive = (page) =>
  withLimit(
    page.evaluate(() => true),
    5000,
    false,
  );
/** A part may take this long; past it, it counts as hanging (the page's main thread may be stuck). */
const PART_TIMEOUT = 600_000;

// --- the parts ---------------------------------------------------------------------------------

/** Every official example: Files panel, F9, the official files, Execute, Run. */
async function examplesPart(browser, name, os, fx) {
  const p = `${name}/examples:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await menu(page, 'Help', /^Examples/);
  await waitFor(
    page,
    () => document.querySelector('[data-e68-panel="files"] [role=treeitem][aria-selected=true]') !== null,
  );
  if ((await filesRow(page, 'tutorial1.X68').count()) === 0) await filesRow(page, 'Examples').first().dblclick();
  await filesRow(page, 'tutorial1.X68').first().waitFor({ timeout: STEP_TIMEOUT });
  let firstExecute = true;
  for (const source of fx.examples) {
    const stem = source.replace(/\.X68$/, '');
    const before = errors.length;
    await setMode(page, 'editor');
    await filesRow(page, new RegExp(`^\\s*${source.replace('.', '\\.')}\\s*$`))
      .first()
      .dblclick();
    const opened = await waitFor(
      page,
      (file) => {
        const s = window.__easy68k.ctx.store.getState();
        return s.documents.items.find((doc) => doc.id === s.documents.activeId)?.name === file;
      },
      source,
    );
    const status = await assemble(page);
    const listing = await readBytes(page, `/browser/Examples/${stem}.L68`);
    const sRecord = await readBytes(page, `/browser/Examples/${stem}.S68`);
    const official = fx.official[source];
    const listingSame = listing !== null && maskCreatedOn(latin1(listing)) === official.listing;
    const sRecordSame = sRecord !== null && latin1(sRecord) === official.sRecord;
    check(
      `${p} ${source}: opened from the Files panel, F9 gives 0 errors and 0 warnings, the official .L68 (but its date) and .S68`,
      opened && status.errors === '0' && status.warnings === '0' && listingSame && sRecordSame,
      `${status.title}; errors ${status.errors}, warnings ${status.warnings}; .L68 ${listingSame ? 'equal' : listing ? 'DIFFERS' : 'missing'}, .S68 ${sRecordSame ? 'equal' : sRecord ? 'DIFFERS' : 'missing'}`,
    );
    const coldBefore = await replaced(page);
    const soundsBefore = await page.evaluate(() => window.__sounds.length);
    if (source === 'graphicSound.X68') {
      // Observation only (SH5's request): what the whole-file reads of the sound tasks cost. The
      // program's last loop asks task 70 for roger.wav until the player is free, and the sound
      // device reads the file through ProgramFiles.read at every try. One object per window (3.3).
      await page.evaluate(() => {
        const files = window.__easy68k.ctx.sim.files;
        const read = files.read.bind(files);
        window.__reads = { calls: 0, ms: 0, longest: 0, bytes: 0 };
        files.read = (fileName) => {
          const t0 = performance.now();
          const result = read(fileName);
          const spent = performance.now() - t0;
          window.__reads.calls++;
          window.__reads.ms += spent;
          window.__reads.longest = Math.max(window.__reads.longest, spent);
          window.__reads.bytes += result ? result.length : 0;
          return result;
        };
      });
    }
    const loaded = await execute(page, `/browser/Examples/${stem}.S68`);
    const cold = (await replaced(page)) - coldBefore;
    check(
      `${p} ${source}: Execute loads it${firstExecute ? '' : ' in a new simulator (a cold start)'}`,
      loaded && (firstExecute || cold === 1),
      `${cold} cold start(s); ${JSON.stringify((await page.evaluate(() => window.__easy68k.ctx.store.getState().sim.program)) ?? null)}`,
    );
    if (firstExecute && cold === 0)
      note(`${p} the first Execute of a new window made no cold start (4.7.1 skips it while nothing has changed)`);
    firstExecute = false;
    const expected = fx.outcomes[source];
    const settled = expected.end === 'halted' || expected.end === 'waiting for input';
    const end = await run(page, settled ? 15_000 : 3000);
    const rows = settled ? await outputBecomes(page, expected.text) : await outputRows(page);
    if (settled) {
      check(
        `${p} ${source}: Run ends as in the headless session (${expected.end}) with the same text in the Output panel`,
        end === expected.end && same(rows, expected.text),
        `${end}; ${JSON.stringify(rows.slice(0, 4))}`,
      );
    } else {
      check(
        `${p} ${source}: Run keeps it running, as in the headless session`,
        end !== 'halted' && end !== 'stopped',
        end,
      );
    }
    if (source === 'graphicSound.X68') {
      const started = (await page.evaluate(() => window.__sounds)).slice(soundsBefore);
      const nameOf = (ms) => fx.sounds.find((sound) => Math.abs(sound.ms - ms) < 2)?.name ?? `${ms.toFixed(0)} ms`;
      const list = started.map((sound) => ({ name: nameOf(sound.ms), at: sound.at }));
      const contexts = await page.evaluate(() => window.__audioContexts.map((context) => context.state));
      note(
        `${p} graphicSound.X68 sounds (start() called at page ms, +scheduled ahead, -offset into the sound, context state): ${started
          .map(
            (sound) =>
              `${nameOf(sound.ms)}@${sound.called.toFixed(0)}+${sound.ahead.toFixed(0)}-${sound.offset.toFixed(0)} ${sound.state}`,
          )
          .join(', ')}`,
      );
      const reads = await page.evaluate(() => window.__reads ?? null);
      if (reads) {
        note(
          `${p} graphicSound.X68: ProgramFiles.read for the sound tasks: ${reads.calls} calls, ${reads.ms.toFixed(1)} ms in all ` +
            `(mean ${((reads.ms / Math.max(1, reads.calls)) * 1000).toFixed(0)} us, longest ${reads.longest.toFixed(2)} ms), ` +
            `${(reads.bytes / 1024).toFixed(0)} KiB returned`,
        );
      }
      const at = (wav) => list.find((sound) => sound.name === wav)?.at ?? Number.NaN;
      const d1 = fx.sounds.find((sound) => sound.name === '1.wav').ms;
      const d0 = fx.sounds.find((sound) => sound.name === '0.wav').ms;
      const gap1 = at('0.wav') - at('1.wav');
      const gap0 = at('roger.wav') - at('0.wav');
      // A sound starts when the player is free again: not before the one before it has ended, and
      // within a few display frames after it (the program polls task 72; a loaded runner is slow).
      const detail = `started ${list.map((sound) => sound.name).join(', ') || 'nothing'}; 0.wav ${gap1.toFixed(0)} ms after 1.wav (lasts ${d1.toFixed(0)}), roger.wav ${gap0.toFixed(0)} ms after 0.wav (lasts ${d0.toFixed(0)}); audio contexts ${JSON.stringify(contexts)}`;
      if (started.length === 0 && !contexts.includes('running')) {
        // The backend plays only on a running context (it waits for a gesture or a device). A
        // headless browser without an audio device never runs one: nothing can be heard here.
        note(`${p} graphicSound.X68: no audio context runs in this browser, so no sound could be timed - ${detail}`);
      } else {
        check(
          `${p} graphicSound.X68: 1.wav, 0.wav and roger.wav play one after the other, each when the one before has ended`,
          gap1 >= d1 - 5 && gap1 <= d1 + 250 && gap0 >= d0 - 5 && gap0 <= d0 + 250,
          detail,
        );
      }
    }
    if (source === 'fileio.X68') {
      const left = await readBytes(page, '/browser/Examples/test1.txt');
      check(
        `${p} fileio.X68: the file it writes, reads and deletes is gone again`,
        left === null,
        left ? `${left.length} bytes left` : '',
      );
    }
    check(
      `${p} ${source}: no console or page errors`,
      errors.length === before,
      errors.slice(before, before + 2).join(' | '),
    );
    await page.screenshot({ path: join(outDir, `${name}-examples-${stem}.png`) });
    await pauseAndAnswer(page);
  }
  await closeWithin(context);
}

/** Edit, assemble and Execute three times in a row: each Execute is a cold start. */
async function cyclePart(browser, name, os, fx) {
  const p = `${name}/cycle:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await writeText(page, '/browser/cycle/pen.X68', fx.programs.pen0);
  await openDocument(page, '/browser/cycle/pen.X68');
  const outputs = [];
  const colds = [];
  for (let version = 1; version <= 3; version++) {
    await setMode(page, 'editor');
    const text = await activeText(page);
    const at = text.indexOf('version ') + 'version '.length;
    await selectRange(page, at, at + 1);
    await page.keyboard.type(String(version));
    const status = await assemble(page);
    const before = await replaced(page);
    const loaded = await execute(page, '/browser/cycle/pen.S68');
    colds.push((await replaced(page)) - before);
    const end = await run(page);
    outputs.push(`${end}: ${(await outputBecomes(page, [fx.programs.penOutput[version]])).join('|')}`);
    if (status.errors !== '0' || !loaded) outputs.push(`(F9 ${JSON.stringify(status)}, loaded ${loaded})`);
  }
  check(
    `${p} three edits, each assembled and executed, print their own version from a fresh pen (0,0)`,
    same(
      outputs,
      [1, 2, 3].map((version) => `halted: ${fx.programs.penOutput[version]}`),
    ),
    JSON.stringify(outputs),
  );
  check(
    `${p} the second and third Execute each replace the simulator (a cold start)`,
    colds[1] === 1 && colds[2] === 1,
    `cold starts per Execute ${JSON.stringify(colds)}`,
  );
  // The control: File > Open of the same program over the finished run is no cold start.
  await toolbarButton(page, 'sim.file.open').click();
  const dialog = page.locator('[role=dialog][aria-modal=true]');
  await dialog.waitFor({ timeout: STEP_TIMEOUT });
  await dialog.locator('[role=option]', { hasText: 'pen.S68' }).first().click();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: STEP_TIMEOUT });
  await run(page);
  const rows = await outputBecomes(page, [fx.programs.penOutputWarm]);
  check(
    `${p} the control: File > Open over the finished run keeps the pen where the run left it`,
    same(rows, [fx.programs.penOutputWarm]),
    JSON.stringify(rows),
  );
  await page.screenshot({ path: join(outDir, `${name}-cycle.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

const dialogNamed = (page, title) => page.getByRole('dialog', { name: title, exact: true });
/** Import/Export Settings, one button, through the port's Open or Save dialog. */
async function transfer(page, button, fileName) {
  const dialog = dialogNamed(page, 'Import/Export Settings');
  if ((await dialog.count()) === 0) {
    await menu(page, 'Options', /^Import\/Export Settings/);
    await dialog.waitFor({ timeout: STEP_TIMEOUT });
  }
  const statusLine = dialog.locator('[role=status]');
  const before = (await statusLine.count()) > 0 ? await statusLine.innerText() : '';
  await dialog.getByRole('button', { name: button }).click();
  const files = dialogNamed(page, button);
  await files.waitFor({ timeout: STEP_TIMEOUT });
  await files.getByLabel('File name:').fill(fileName);
  await files.getByRole('button', { name: button.startsWith('Import') ? 'Open' : 'Save', exact: true }).click();
  // The status line names the file of THIS step: wait until it is no longer the line before it.
  const name = button.replace(/^(Import|Export) /, '');
  await waitFor(
    page,
    ([old, file]) => {
      const text = document.querySelector('[role=dialog] [role=status]')?.textContent ?? '';
      return text !== old && /^(Imported|Exported)/.test(text) && text.includes(file);
    },
    [before, name],
  );
  const text = await statusLine.innerText().catch(() => '');
  return text;
}
async function closeTransfer(page) {
  const dialog = dialogNamed(page, 'Import/Export Settings');
  await dialog.locator('.e68-dialog__footer').getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'detached', timeout: STEP_TIMEOUT });
}

/** Settings export and import with the original's files, and Execute obeying them. */
async function settingsPart(browser, name, os, fx) {
  const p = `${name}/settings:`;
  const first = await newContext(browser, os);
  const a = await openApp(first);
  await writeBytes(a.page, '/browser/settings.dat', fx.settings.editor);
  await writeBytes(a.page, '/browser/sim68K.dat', fx.settings.sim);
  const importedEditor = await transfer(a.page, 'Import settings.dat', 'settings.dat');
  const importedSim = await transfer(a.page, 'Import sim68K.dat', 'sim68K.dat');
  await closeTransfer(a.page);
  const shipped = await a.page.evaluate(() => window.__easy68k.ctx.settings.get());
  check(
    `${p} the shipped settings.dat and sim68K.dat are imported`,
    importedEditor.startsWith('Imported settings.dat') &&
      importedSim.startsWith('Imported sim68K.dat') &&
      shipped.editor.fontSize === 10,
    `${importedEditor} / ${importedSim}; font size ${shipped.editor.fontSize}, exceptions ${shipped.sim.exceptions}`,
  );
  // A change a program can see: Options > Enable Exceptions in the simulator's menu.
  await setMode(a.page, 'simulator');
  await menu(a.page, 'Options', /Enable Exceptions/);
  await a.page.waitForTimeout(300);
  const changed = await a.page.evaluate(() => window.__easy68k.ctx.settings.get().sim.exceptions);
  const exportedEditor = await transfer(a.page, 'Export settings.dat', 'exported-settings');
  const exportedSim = await transfer(a.page, 'Export sim68K.dat', 'exported-sim');
  await closeTransfer(a.page);
  const editorFile = await readBytes(a.page, '/browser/exported-settings.dat');
  const simFile = await readBytes(a.page, '/browser/exported-sim.dat');
  check(
    `${p} Enable Exceptions changes the setting; both files are exported into the store`,
    changed === !shipped.sim.exceptions && editorFile !== null && simFile !== null,
    `${exportedEditor} / ${exportedSim}; exceptions ${shipped.sim.exceptions} -> ${changed}`,
  );
  const settingsA = await a.page.evaluate(() => window.__easy68k.ctx.settings.get());
  check(`${p} no console or page errors in the first profile`, a.errors.length === 0, a.errors.slice(0, 3).join(' | '));
  await closeWithin(first);

  // A new browser profile: an empty store and default settings, as a second student's machine.
  const second = await newContext(browser, os);
  const b = await openApp(second);
  await writeBytes(b.page, '/browser/exported-settings.dat', editorFile ?? []);
  await writeBytes(b.page, '/browser/exported-sim.dat', simFile ?? []);
  await transfer(b.page, 'Import settings.dat', 'exported-settings.dat');
  await transfer(b.page, 'Import sim68K.dat', 'exported-sim.dat');
  const settingsB = await b.page.evaluate(() => window.__easy68k.ctx.settings.get());
  const reExported = await transfer(b.page, 'Export sim68K.dat', 'again-sim');
  await closeTransfer(b.page);
  const again = await readBytes(b.page, '/browser/again-sim.dat');
  check(
    `${p} in a new profile the exports give the same settings, and exporting again gives the same sim68K.dat`,
    same(settingsB.sim, settingsA.sim) && same(settingsB.editor, settingsA.editor) && same(again, simFile),
    `${reExported}; sim equal ${same(settingsB.sim, settingsA.sim)}, editor equal ${same(settingsB.editor, settingsA.editor)}, bytes equal ${same(again, simFile)}`,
  );
  // Execute after the import obeys it: the status bar names the exceptions option (4.7.1 step 4).
  await writeText(b.page, '/browser/prog.X68', fx.programs.trivial);
  await openDocument(b.page, '/browser/prog.X68');
  const shownStatus = [];
  for (let i = 0; i < 2; i++) {
    await assemble(b.page);
    await execute(b.page, '/browser/prog.S68');
    await b.page.waitForTimeout(300);
    shownStatus.push(
      (await b.page.evaluate(() => window.__easy68k.ctx.sim.engine.getOption(0))) +
        ' / ' +
        (await statusText(b.page)).split(' | ').find((cell) => cell.startsWith('exceptions')),
    );
  }
  const wanted = changed ? 'exceptions on' : 'exceptions off';
  check(
    `${p} the first Execute after the import obeys it (${wanted})`,
    shownStatus[0].endsWith(wanted),
    `engine option / status bar: ${shownStatus[0]}`,
  );
  check(`${p} the second Execute obeys it too`, shownStatus[1].endsWith(wanted), shownStatus[1]);
  await b.page.screenshot({ path: join(outDir, `${name}-settings.png`) });
  check(
    `${p} no console or page errors in the second profile`,
    b.errors.length === 0,
    b.errors.slice(0, 3).join(' | '),
  );
  await closeWithin(second);
}

/** Logging with both logs, against the official logs of the same program. */
async function loggingPart(browser, name, os, fx) {
  const p = `${name}/logging:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  const dir = '/browser/logs';
  await writeBytes(page, `${dir}/${fx.log.name}.X68`, fx.log.source);
  await openDocument(page, `${dir}/${fx.log.name}.X68`);
  await assemble(page);
  await execute(page, `${dir}/${fx.log.name}.S68`);
  await menu(page, 'Options', /^Log Output/);
  const dialog = dialogNamed(page, 'Log Output');
  await dialog.waitFor({ timeout: STEP_TIMEOUT });
  const names = [await dialog.getByTestId('log-exec-name').inputValue()];
  await dialog.getByRole('radio', { name: 'Instruction and Registers', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Text Only' }).check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await dialog.waitFor({ state: 'detached', timeout: STEP_TIMEOUT });
  await toolbarButton(page, 'sim.run.logStart').click();
  const logging = await waitFor(page, () => window.__easy68k.ctx.sim.log.state.logging === true);
  check(
    `${p} Log Output... names the logs after the program; Log Start starts logging`,
    names[0] === `${dir}/${fx.log.name}_RunLog.txt` && logging,
    `${names[0]}; logging ${logging}`,
  );
  // Run at full speed writes no execution log (sim-ui 13.4): Trace Into to the halt, as the oracle traced.
  const boxes = [];
  for (let i = 0; i < 80; i++) {
    const box = page.locator('[role=alertdialog]');
    if ((await box.count()) > 0) {
      boxes.push((await box.first().innerText()).replace(/\s+/g, ' '));
      await box.first().getByRole('button', { name: 'OK' }).click();
    }
    const state = await page.evaluate(() => ({
      halted: window.__easy68k.ctx.sim.controller.snapshot.halted,
      logging: window.__easy68k.ctx.sim.log.state.logging,
    }));
    if (state.halted && boxes.length > 0) break;
    if (state.halted) {
      // The halt's box comes with or just after the last step: wait for it, do not trace on.
      await box
        .first()
        .waitFor({ timeout: 5000 })
        .catch(() => {});
      continue;
    }
    // The halt's box can open between the look above and this click; the button is then disabled
    // and the click would wait its whole time. A short limit, and back to the top of the loop,
    // where the box is collected.
    await toolbarButton(page, 'sim.run.traceInto')
      .click({ timeout: 1500 })
      .catch(() => {});
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1500);
  const exec = await readBytes(page, `${dir}/${fx.log.name}_RunLog.txt`);
  const output = await readBytes(page, `${dir}/${fx.log.name}_OutLog.txt`);
  check(
    `${p} the halt says Current Log Stopped.`,
    boxes.some((box) => box.includes('Current Log Stopped.')),
    JSON.stringify(boxes),
  );
  const ours = exec ? maskLogDate(latin1(exec)).split('\r\n') : [];
  const theirs = maskLogDate(fx.log.exec).split('\r\n');
  const firstDiff = ours.findIndex((line, i) => line !== theirs[i]);
  check(
    `${p} the execution log in the store equals the official EASy68K's (type 2), line for line`,
    exec !== null && firstDiff === -1 && ours.length === theirs.length,
    exec === null
      ? 'no file'
      : `${ours.length} lines, official ${theirs.length}${firstDiff >= 0 ? `; first difference at line ${firstDiff + 1}: ours ${JSON.stringify(ours[firstDiff])}, official ${JSON.stringify(theirs[firstDiff])}` : ''}`,
  );
  check(
    `${p} the output log in the store equals the official EASy68K's`,
    output !== null && maskLogDate(latin1(output)) === maskLogDate(fx.log.output),
    output === null ? 'no file' : JSON.stringify(latin1(output).slice(0, 120)),
  );
  await page.screenshot({ path: join(outDir, `${name}-logging.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** Assembles, executes and runs a program written into the store; its Output panel text. */
async function assembleAndRun(page, path, text) {
  if (text !== undefined) {
    await writeText(page, path, text);
    await openDocument(page, path);
  }
  const status = await assemble(page);
  const loaded = status.executeEnabled ? await execute(page, path.replace(/\.X68$/, '.S68')) : false;
  const end = loaded ? await run(page) : 'not loaded';
  return { status, loaded, end };
}

async function filesPart(browser, name, os, fx) {
  const p = `${name}/files:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  const { end } = await assembleAndRun(page, '/browser/files/writer.X68', fx.programs.file);
  const rows = await outputBecomes(page, [fx.programs.fileText]);
  check(
    `${p} the program writes, closes and reads back its file, and prints what it read`,
    end === 'halted' && same(rows, [fx.programs.fileText]),
    `${end}; ${JSON.stringify(rows)}`,
  );
  let stored = null;
  for (let i = 0; i < 30 && stored === null; i++) {
    stored = await readBytes(page, `/browser/files/${fx.programs.fileName}`);
    if (stored === null) await page.waitForTimeout(200);
  }
  check(
    `${p} the file is in the browser store next to the program, with its bytes`,
    stored !== null && latin1(stored) === fx.programs.fileText,
    stored ? JSON.stringify(latin1(stored)) : 'missing',
  );
  await setMode(page, 'editor');
  // The Files panel: shown with its toolbar button if it is hidden, the folder opened.
  if (!(await page.locator('[data-e68-panel="files"]').first().isVisible()))
    await toolbarButton(page, 'app.files.toggle').click();
  const folder = filesRow(page, /^\s*files\s*$/).first();
  await folder.waitFor({ timeout: STEP_TIMEOUT }).catch(() => {});
  if ((await filesRow(page, fx.programs.fileName).count()) === 0) await folder.dblclick().catch(() => {});
  await filesRow(page, fx.programs.fileName)
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  const listed = await filesRow(page, fx.programs.fileName).count();
  check(`${p} the Files panel lists it in the program's folder`, listed > 0, `${listed} row(s)`);
  await page.screenshot({ path: join(outDir, `${name}-files.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

async function breakpointPart(browser, name, os, fx) {
  const p = `${name}/breakpoint:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await writeBytes(page, '/browser/bp/tutorial1.X68', fx.tutorial1);
  await openDocument(page, '/browser/bp/tutorial1.X68');
  await assemble(page);
  await execute(page, '/browser/bp/tutorial1.S68');
  const row = page.locator('.e68-listing__row', { hasText: /lea\s+textD3,a1/i }).first();
  // The listing renders the rows on screen only: scroll down with the mouse wheel until it is there.
  const listingBox = await page.locator(`${SIM} [data-e68-panel="listing"]`).boundingBox();
  for (let i = 0; i < 40 && (await row.count()) === 0 && listingBox; i++) {
    await page.mouse.move(listingBox.x + listingBox.width / 2, listingBox.y + listingBox.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(100);
  }
  await row.locator('.e68-listing__gutter').click();
  const set = await page.evaluate(() => [...window.__easy68k.ctx.sim.engine.breakpoints()]);
  const rowAddress = Number.parseInt((await row.innerText()).trim().slice(0, 8), 16);
  check(
    `${p} a gutter click on the row sets a PC breakpoint at its address`,
    same(set, [rowAddress]) && (await row.getAttribute('data-bp')) === 'on',
    `${JSON.stringify(set)} for ${rowAddress}`,
  );
  const firstEnd = await run(page);
  const pc = await page.evaluate(() => window.__easy68k.ctx.sim.engine.getRegister(17) >>> 0);
  const rows = await outputBecomes(page, ['D1 contains: 8', 'D2 contains: 520']);
  check(
    `${p} Run stops at the breakpoint, before the third line is printed, with its row selected`,
    firstEnd === 'stopped' &&
      pc === rowAddress &&
      same(rows, ['D1 contains: 8', 'D2 contains: 520']) &&
      (await row.getAttribute('aria-selected')) === 'true',
    `${firstEnd} at ${pc.toString(16)}; ${JSON.stringify(rows)}; selected ${await row.getAttribute('aria-selected')}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-breakpoint.png`) });
  const secondEnd = await run(page);
  const all = await outputBecomes(page, fx.tutorial1Output);
  check(
    `${p} Run goes on to the halt`,
    secondEnd === 'halted' && same(all, fx.tutorial1Output),
    `${secondEnd}; ${JSON.stringify(all)}`,
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

async function replacePart(browser, name, os, fx) {
  const p = `${name}/replace:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await assembleAndRun(page, '/browser/replace/numbers.X68', fx.programs.replace);
  const before = await outputBecomes(page, [fx.programs.replaceBefore]);
  await setMode(page, 'editor');
  await selectRange(page, 0, 0);
  await pressCommand(page, 'ed.edit.replace');
  const dialog = page.getByRole('dialog', { name: 'Replace', exact: true });
  await dialog.waitFor({ timeout: STEP_TIMEOUT });
  await dialog.getByLabel('Find what:').fill(fx.programs.replaceFind);
  await dialog.getByLabel('Replace with').fill(fx.programs.replaceWith);
  await dialog.getByRole('button', { name: 'Replace All' }).click();
  const box = page.getByRole('alertdialog').filter({ hasText: 'End of document reached.' });
  const ended = await box
    .waitFor({ timeout: STEP_TIMEOUT })
    .then(() => true)
    .catch(() => false);
  if (ended) await box.getByRole('button', { name: 'OK' }).click();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  const text = (await activeText(page)) ?? '';
  const count = text.split(fx.programs.replaceWith).length - 1;
  const { end } = await assembleAndRun(page, '/browser/replace/numbers.X68');
  const after = await outputBecomes(page, [fx.programs.replaceAfter]);
  check(
    `${p} Replace All changes both numbers before F9, and the program prints the new ones`,
    same(before, [fx.programs.replaceBefore]) &&
      ended &&
      count === 2 &&
      end === 'halted' &&
      same(after, [fx.programs.replaceAfter]),
    `before ${JSON.stringify(before)}; end box ${ended}; ${count} replaced; after ${end} ${JSON.stringify(after)}`,
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

async function errorPart(browser, name, os, fx) {
  const p = `${name}/error:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await writeText(page, '/browser/err/broken.X68', fx.programs.error);
  await openDocument(page, '/browser/err/broken.X68');
  const status = await assemble(page);
  check(
    `${p} F9: Errors: 1, Execute disabled`,
    status.errors === '1' && !status.executeEnabled,
    JSON.stringify(status),
  );
  await closeStatus(page, 'Close');
  const rowsLocator = page.locator(
    '[data-e68-workspace="editor"] [data-e68-panel="messages"] .e68-asm-messages [role=row][data-row]',
  );
  await rowsLocator.first().waitFor({ timeout: STEP_TIMEOUT });
  const rows = await rowsLocator.evaluateAll((elements) =>
    elements.map((row) => [...row.querySelectorAll('[role=gridcell]')].map((cell) => cell.textContent)),
  );
  const marker = await page.locator(`.e68-marker--error[title="${fx.programs.errorText}"]`).count();
  check(
    `${p} the Messages panel names the line and the error, and the line has its marker`,
    same(rows, [[String(fx.programs.errorLine), fx.programs.errorText]]) && marker === 1,
    `${JSON.stringify(rows)}; ${marker} marker(s)`,
  );
  await page.screenshot({ path: join(outDir, `${name}-error.png`) });
  await rowsLocator.first().locator('[role=gridcell]').nth(1).dblclick();
  await page.waitForTimeout(300);
  check(`${p} after the double-click on the message the page still answers`, await responsive(page));
  const selected = await withLimit(
    page.evaluate(() => {
      const id = window.__easy68k.ctx.store.getState().documents.activeId;
      const { state } = document.querySelector(`[data-e68-document="${id}"]`).e68View;
      return state.sliceDoc(state.selection.main.from, state.selection.main.to);
    }),
    5000,
    '(no answer)',
  );
  await page.keyboard.type(fx.programs.corrected);
  check(
    `${p} after typing the correction the page still answers`,
    await responsive(page),
    `the selection was ${JSON.stringify(selected)}`,
  );
  const corrected = ((await activeText(page)) ?? '').split(/\r?\n/)[fx.programs.errorLine - 1];
  const { status: second, end } = await assembleAndRun(page, '/browser/err/broken.X68');
  const out = await outputBecomes(page, ['corrected']);
  check(
    `${p} a double-click on the message selects the line; the typed correction assembles and runs`,
    corrected === fx.programs.corrected && second.errors === '0' && end === 'halted' && same(out, ['corrected']),
    `line ${JSON.stringify(corrected)}; ${JSON.stringify(second)}; ${end} ${JSON.stringify(out)}`,
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

async function includePart(browser, name, os, fx) {
  const p = `${name}/include:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await writeText(page, '/browser/inc/strings.X68', fx.programs.includeLib);
  const { status, end } = await assembleAndRun(page, '/browser/inc/main.X68', fx.programs.includeMain);
  const out = await outputBecomes(page, [fx.programs.includeOutput]);
  check(
    `${p} a program that INCLUDEs a file next to it in the store assembles and prints the included text`,
    status.errors === '0' && status.warnings === '0' && end === 'halted' && same(out, [fx.programs.includeOutput]),
    `${JSON.stringify(status)}; ${end} ${JSON.stringify(out)}`,
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** Two windows of the application at once (3.8.6): one store, two simulators. */
async function windowsPart(browser, name, os, fx) {
  const p = `${name}/windows:`;
  const context = await newContext(browser, os);
  const one = await openApp(context);
  const two = await openApp(context);
  await writeText(one.page, '/browser/two/shared.X68', fx.programs.penText(7));
  await openDocument(one.page, '/browser/two/shared.X68');
  // Window one edits and saves; window two opens the file and finds the edit.
  const text = await activeText(one.page);
  const at = text.indexOf('version ') + 'version '.length;
  await selectRange(one.page, at, at + 1);
  await one.page.keyboard.type('8');
  await pressCommand(one.page, 'ed.file.save');
  await one.page.waitForTimeout(800);
  const seen = await waitFor(
    two.page,
    async () => {
      const { vfs } = window.__easy68k.ctx;
      if (!(await vfs.stat('/browser/two/shared.X68'))) return false;
      const bytes = await vfs.readFile('/browser/two/shared.X68');
      return String.fromCharCode(...bytes).includes("version 8'");
    },
    null,
    30_000,
  );
  check(`${p} a file saved in one window is in the store of the other`, seen);
  await openDocument(two.page, '/browser/two/shared.X68');
  const theirs = await activeText(two.page);
  check(
    `${p} the other window opens it with the edit`,
    (theirs ?? '').includes("version 8'"),
    JSON.stringify((theirs ?? '').slice(0, 40)),
  );
  // Both assemble and run at the same time, each in its own simulator.
  await assemble(one.page);
  await execute(one.page, '/browser/two/shared.S68');
  await writeText(two.page, '/browser/two/other.X68', fx.programs.penText(9));
  await openDocument(two.page, '/browser/two/other.X68');
  await assemble(two.page);
  await execute(two.page, '/browser/two/other.S68');
  const [endOne, endTwo] = await Promise.all([run(one.page), run(two.page)]);
  const outOne = await outputBecomes(one.page, [fx.programs.penOutput[8]]);
  const outTwo = await outputBecomes(two.page, [fx.programs.penOutput[9]]);
  check(
    `${p} each window runs its own program in its own simulator`,
    endOne === 'halted' &&
      endTwo === 'halted' &&
      same(outOne, [fx.programs.penOutput[8]]) &&
      same(outTwo, [fx.programs.penOutput[9]]),
    `${endOne} ${JSON.stringify(outOne)} / ${endTwo} ${JSON.stringify(outTwo)}`,
  );
  // A setting changed in one window reaches the other.
  const before = await two.page.evaluate(() => window.__easy68k.ctx.settings.get().sim.exceptions);
  await menu(one.page, 'Options', /Enable Exceptions/);
  const reached = await waitFor(
    two.page,
    (old) => window.__easy68k.ctx.settings.get().sim.exceptions === !old,
    before,
    30_000,
  );
  check(`${p} Enable Exceptions in one window reaches the other window's settings`, reached);
  await one.page.screenshot({ path: join(outDir, `${name}-windows-one.png`) });
  await two.page.screenshot({ path: join(outDir, `${name}-windows-two.png`) });
  check(
    `${p} no console or page errors`,
    one.errors.length + two.errors.length === 0,
    [...one.errors, ...two.errors].slice(0, 3).join(' | '),
  );
  await closeWithin(context);
}

/** The page is closed in the middle and opened again. */
async function reopenPart(browser, name, os, fx) {
  const p = `${name}/reopen:`;
  const context = await newContext(browser, os);
  const first = await openApp(context);
  await writeText(first.page, '/browser/reopen/pen.X68', fx.programs.pen0);
  await openDocument(first.page, '/browser/reopen/pen.X68');
  const { end } = await assembleAndRun(first.page, '/browser/reopen/pen.X68');
  // A modified document when the page goes.
  console.log(`        step: ran ${end}; now the edit`);
  await setMode(first.page, 'editor');
  const text = await activeText(first.page);
  const at = text.indexOf('version ') + 'version '.length;
  await selectRange(first.page, at, at + 1);
  await first.page.keyboard.type('5');
  await first.page.waitForTimeout(3000); // the draft is written two seconds after the last change
  console.log('        step: closing the page');
  await first.page.close({ runBeforeUnload: false });
  console.log('        step: opening a new page');
  // The offer is a modal message box: it holds the run controller (4.4.5), so the simulator's
  // start waits for the answer, and the page is taken as up only after it.
  const again = { page: await context.newPage() };
  again.errors = watch(again.page);
  await again.page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await again.page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  console.log('        step: the new page is up');
  const offer = again.page.locator('[role=alertdialog]', { hasText: 'Unsaved changes from your last session' });
  const offered = await offer
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (offered) await offer.getByRole('button', { name: 'Restore' }).click();
  await waitForApp(again.page);
  const restored = await again.page.evaluate(() => {
    const s = window.__easy68k.ctx.store.getState();
    return s.documents.items.map((doc) => ({ name: doc.name, modified: doc.modified }));
  });
  const restoredText = (await activeText(again.page)) ?? '';
  check(
    `${p} after closing the page with a modified document, the new page offers its draft and Restore brings the edit back`,
    end === 'halted' && offered && restoredText.includes("version 5'"),
    `first run ${end}; offered ${offered}; documents ${JSON.stringify(restored)}`,
  );
  const s68 = await readBytes(again.page, '/browser/reopen/pen.S68');
  await setMode(again.page, 'simulator');
  check(
    `${p} the assembled program is still in the store, and the new page starts with no program loaded`,
    s68 !== null && (await again.page.evaluate(() => window.__easy68k.ctx.store.getState().sim.program)) === null,
  );
  await again.page.screenshot({ path: join(outDir, `${name}-reopen.png`) });
  check(
    `${p} no console or page errors`,
    first.errors.length + again.errors.length === 0,
    [...first.errors, ...again.errors].slice(0, 3).join(' | '),
  );
  await closeWithin(context);
}

/**
 * The nine commands of the stage of additions (ARCHITECTURE-PLUS P3.6). N0 declared them without
 * handlers and this part let them be without one while they were disabled (errata N0 entry 9); every
 * one has its handler now (the gate of the stage), so they are held to the rule of 9.5 like every
 * other id, and this part also checks that all nine are command ids.
 */
const PLUS_COMMANDS = [
  'app.layout.move',
  'app.layout.lock',
  'app.layout.reset',
  'ed.window.splitRight',
  'ed.window.splitDown',
  'ed.window.unsplit',
  'ed.file.history',
  'app.files.trash',
  'app.additions.options',
];

/** 9.5: no command id without a handler, in each of the three modes. */
async function commandsPart(browser, name, os) {
  const p = `${name}/commands:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  for (const mode of ['editor', 'simulator', 'easybin']) {
    await setMode(page, mode);
    await page.waitForTimeout(500);
    const found = await page.evaluate(
      ({ mode, plus }) => {
        const { commands, store } = window.__easy68k.ctx;
        const ids = commands.ids();
        const missing = ids.filter((id) => !commands.hasHandler(id));
        const ofMode = ids.filter((id) => [mode, 'app'].includes(commands.spec(id).mode));
        return {
          mode: store.getState().mode,
          all: ids.length,
          ofMode: ofMode.length,
          missing,
          missingOfMode: missing.filter((id) => ofMode.includes(id)),
          plusNotIds: plus.filter((id) => !ids.includes(id)),
        };
      },
      { mode, plus: PLUS_COMMANDS },
    );
    check(
      `${p} in ${mode} mode every command id of the mode and of the application has a handler`,
      found.mode === mode && found.missingOfMode.length === 0,
      `${found.ofMode} ids of ${mode} and app; without a handler: ${JSON.stringify(found.missingOfMode)}`,
    );
    if (mode === 'easybin') {
      check(
        `${p} no command id at all is without a handler`,
        found.missing.length === 0,
        `${found.all} ids; without a handler: ${JSON.stringify(found.missing)}`,
      );
      check(
        `${p} the nine commands of the stage of additions (P3.6) are command ids, each with its handler`,
        found.plusNotIds.length === 0 && PLUS_COMMANDS.every((id) => !found.missing.includes(id)),
        `not ids: ${JSON.stringify(found.plusNotIds)}; without a handler: ${JSON.stringify(found.missing.filter((id) => PLUS_COMMANDS.includes(id)))}`,
      );
    }
  }
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

// --- the production build under the preview's sub-path -----------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

function buildForSubPath(target) {
  const require = createRequire(join(appRoot, 'package.json'));
  const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  rmSync(target, { recursive: true, force: true });
  console.log(`Production build with EASY68K_BASE=${SUB_PATH} into ${target}`);
  const built = spawnSync(process.execPath, [viteBin, 'build', '--outDir', target, '--logLevel', 'warn'], {
    cwd: appRoot,
    env: { ...process.env, EASY68K_BASE: SUB_PATH },
    stdio: 'inherit',
  });
  if (built.status !== 0) throw new Error(`vite build failed with exit code ${built.status}`);
  // The step pages.yml runs after the build.
  const finished = spawnSync(process.execPath, [join(appRoot, 'src/features/pwa/build/finish-build.mjs'), target], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (finished.status !== 0) throw new Error(`finish-build failed with exit code ${finished.status}`);
}

/** Serves `root` under SUB_PATH only, as GitHub Pages serves a project site. */
function serveSubPath(root) {
  const outside = [];
  const server = createHttpServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!path.startsWith(SUB_PATH)) {
      outside.push(path);
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('404: outside the site');
      return;
    }
    let file = normalize(join(root, path.slice(SUB_PATH.length)));
    if (!file.startsWith(root + sep) && file !== root) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      outside.push(`${path} (missing)`);
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('404');
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    response.end(body);
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveServer({
        origin: `http://127.0.0.1:${address.port}`,
        outside,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

let site = null;
/** The preview's path a visitor takes, by the interface alone (a production build has no page object). */
async function subpathPart(browser, name, os, fx) {
  const p = `${name}/subpath:`;
  if (!site) {
    const dist = join(outDir, 'dist');
    buildForSubPath(dist);
    site = await serveSubPath(dist);
    console.log(`Site: ${site.origin}${SUB_PATH}`);
  }
  const context = await newContext(browser, os);
  const page = await context.newPage();
  const errors = watch(page);
  const outsideBefore = site.outside.length;
  await page.goto(`${site.origin}${SUB_PATH}`, { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await menu(page, 'Help', /^Examples/);
  await filesRow(page, 'Examples').first().waitFor({ timeout: 60_000 });
  if ((await filesRow(page, 'tutorial1.X68').count()) === 0) await filesRow(page, 'Examples').first().dblclick();
  await filesRow(page, 'tutorial1.X68').first().dblclick();
  await page.locator('.e68-editor .cm-content').first().waitFor({ timeout: STEP_TIMEOUT });
  await page.waitForTimeout(500);
  await toolbarButton(page, 'ed.project.assemble').click();
  await statusDialog(page).waitFor({ timeout: 60_000 });
  const title = await statusDialog(page).locator('.e68-dialog__title').innerText();
  const errorsShown = await statusDialog(page).locator('[data-e68-count=errors]').innerText();
  await statusDialog(page).locator('.e68-dialog__footer').getByRole('button', { name: 'Execute', exact: true }).click();
  const loaded = await page
    .locator(`${SIM} .e68-listing__row`)
    .first()
    .waitFor({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(500);
  await toolbarButton(page, 'sim.run.run').click();
  const rows = await outputBecomes(page, fx.tutorial1Output, 20_000);
  check(
    `${p} under ${SUB_PATH}: Help > Examples..., tutorial1.X68 from the Files panel, Assemble, Execute and Run print its four lines`,
    title === 'Assembler Status - tutorial1.X68' && errorsShown === '0' && loaded && same(rows, fx.tutorial1Output),
    `${title}, errors ${errorsShown}, listing ${loaded}; ${JSON.stringify(rows)}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-subpath.png`) });
  const outside = site.outside.slice(outsideBefore);
  check(
    `${p} no request leaves the sub-path or misses a file`,
    outside.length === 0,
    JSON.stringify(outside.slice(0, 5)),
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

const PARTS = {
  examples: examplesPart,
  cycle: cyclePart,
  settings: settingsPart,
  logging: loggingPart,
  files: filesPart,
  breakpoint: breakpointPart,
  replace: replacePart,
  error: errorPart,
  include: includePart,
  windows: windowsPart,
  reopen: reopenPart,
  commands: commandsPart,
  subpath: subpathPart,
};

// --- fixtures ----------------------------------------------------------------------------------

async function buildFixtures(server) {
  const load = (file) => server.ssrLoadModule(`/@fs/${file.replaceAll('\\', '/')}`);
  const wave1 = await load(join(here, '..', 'wave1', 'fixtures.ts'));
  const programs = await load(join(here, 'programs.ts'));
  const sounds = ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav'];
  const extraFiles = Object.fromEntries(sounds.map((file) => [file, wave1.exampleBytes(file)]));
  const outcomes = {};
  const official = {};
  for (const source of wave1.OFFICIAL_EXAMPLES) {
    const program = await wave1.assembleExample(source);
    outcomes[source] = await wave1.runHeadless(program, { seconds: 5, extraFiles });
    const files = programs.officialOutputs(source);
    official[source] = { listing: maskCreatedOn(latin1(files.listing)), sRecord: latin1(files.sRecord) };
  }
  const logs = programs.officialLogs();
  if (!logs) throw new Error('the official logs of the log program are not in tests/conformance/sim/golden/logs');
  const penText = (version) => programs.crlf(programs.penProgram(version));
  return {
    examples: [...wave1.OFFICIAL_EXAMPLES],
    outcomes,
    official,
    sounds: sounds.map((file) => ({ name: file, ms: programs.wavMs(wave1.exampleBytes(file)) })),
    tutorial1: [...wave1.exampleBytes('tutorial1.X68')],
    tutorial1Output: wave1.TUTORIAL1_OUTPUT,
    settings: {
      editor: [...programs.shippedSettingsFile('settings.dat')],
      sim: [...programs.shippedSettingsFile('sim68K.dat')],
    },
    log: {
      name: programs.LOG_PROGRAM,
      source: [...programs.logProgramSource()],
      exec: latin1(logs.exec),
      output: latin1(logs.output),
    },
    programs: {
      pen0: penText(0),
      penText,
      penOutput: Object.fromEntries([1, 2, 3, 5, 7, 8, 9].map((version) => [version, programs.penOutput(version)])),
      penOutputWarm: programs.penOutput(3, false),
      trivial: programs.crlf(['    ORG $1000', 'START:', '    SIMHALT', '    END START']),
      file: programs.crlf(programs.FILE_PROGRAM),
      fileName: programs.FILE_NAME,
      fileText: programs.FILE_TEXT,
      replace: programs.crlf(programs.REPLACE_PROGRAM),
      replaceFind: programs.REPLACE_FIND,
      replaceWith: programs.REPLACE_WITH,
      replaceBefore: programs.REPLACE_BEFORE,
      replaceAfter: programs.REPLACE_AFTER,
      error: programs.crlf(programs.ERROR_PROGRAM),
      errorLine: programs.ERROR_LINE,
      errorText: programs.ERROR_TEXT,
      corrected: programs.CORRECTED_LINE,
      includeMain: programs.crlf(programs.INCLUDE_MAIN),
      includeLib: programs.crlf(programs.INCLUDE_LIB),
      includeOutput: programs.INCLUDE_OUTPUT,
    },
  };
}

// --- run ---------------------------------------------------------------------------------------

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
    cacheDir: join(outDir, 'vite-cache'),
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    const fx = await buildFixtures(server);
    console.log('What the official examples do in the headless session (real engine, virtual time):');
    for (const [source, outcome] of Object.entries(fx.outcomes)) {
      console.log(`  ${source.padEnd(20)} ${outcome.end.padEnd(18)} ${JSON.stringify(outcome.text.slice(0, 3))}`);
    }
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      const os = OS_OF[name] ?? 'windows';
      try {
        for (const [part, runPart] of Object.entries(PARTS)) {
          if (only.length > 0 && !only.includes(part)) continue;
          console.log(`\n[${name}, ${os} key map, ${part}]`);
          const began = Date.now();
          try {
            const hung = Symbol('hung');
            const outcome = await withLimit(runPart(browser, name, os, fx), PART_TIMEOUT, hung);
            if (outcome === hung) throw new Error(`the part did not finish within ${PART_TIMEOUT / 1000} s`);
          } catch (error) {
            check(
              `${name}/${part}: ran to the end`,
              false,
              String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            );
            await shootAndClose(`${name}-${part}`);
          }
          console.log(`        (${part}: ${((Date.now() - began) / 1000).toFixed(1)} s)`);
        }
      } finally {
        await doneWith(browser, { last: name === browsers.at(-1) });
      }
    }
  } finally {
    closeAtEnd(server);
    closeAtEnd(site, 'the sub-path site');
  }

  if (notes.length > 0) console.log(`\nNotes (not failures):\n${notes.map((text) => `  - ${text}`).join('\n')}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
