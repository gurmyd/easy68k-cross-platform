// Browser check of the run feature (ARCHITECTURE.md 9.2, SH8). Owner: SH8.
//
//   node app/src/features/run/check-run.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright). The unit tests of the run controller use virtual time and no
// DOM; this script shows the same things with a real engine load, real display frames and real
// timers:
//
//   - the simulator engine starts in the page and the status bar of Simulator mode shows its state;
//   - a program is loaded from the browser store, started with the Run button and with F9, runs to
//     its halt, and the commands follow the states of 4.8;
//   - a task 23 delay of 50 units takes half a second of real time;
//   - the governor executes about a million instructions per second at the default setting, and
//     far more at Maximum;
//   - the boxes of the simulator (Run To Cursor without a row, the Caution question) and the
//     Execution Speed dialog appear and work, and the dialog passes an accessibility scan;
//   - Execute (a cold start) replaces the engine, several times in a row;
//   - Exit shows `You can close this tab.`
//
// Screenshots go to build/SH8/run-check (git-ignored). Exit code 0 = everything passed. The page
// object `window.__easy68k` that the script uses exists in development builds only (main.tsx).
//
// Needs engine/dist (both engines): the test programs are assembled by the real assembler.

/* global console, process, document, window, performance, setTimeout -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'SH8', 'run-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- test programs, assembled with the real assembler ----------------------------------

const SOURCES = {
  // Prints nothing, counts for ever.
  counter: [
    '        ORG     $1000',
    'START:  MOVEQ   #0,D0',
    'LOOP:   ADDQ.L  #1,D0',
    '        BRA     LOOP',
    '        END     START',
  ],
  // Reads the clock, waits 50 units, reads it again (D6 - D7 = hundredths of a second), halts.
  delay: [
    '        ORG     $1000',
    'START:  MOVEQ   #8,D0',
    '        TRAP    #15',
    '        MOVE.L  D1,D7',
    '        MOVEQ   #50,D1',
    '        MOVEQ   #23,D0',
    '        TRAP    #15',
    '        MOVEQ   #8,D0',
    '        TRAP    #15',
    '        MOVE.L  D1,D6',
    '        SIMHALT',
    '        END     START',
  ],
  // Prints a line (task 13) and halts.
  hello: [
    '        ORG     $1000',
    'START:  LEA     TEXT,A1',
    '        MOVEQ   #13,D0',
    '        TRAP    #15',
    '        SIMHALT',
    "TEXT:   DC.B    'HELLO FROM THE RUN CHECK',0",
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

// --- helpers ------------------------------------------------------------------------------

async function openApp(browser, query = '') {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}${query}`, { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, undefined, { timeout: LOAD_TIMEOUT });
  return { context, page, errors };
}

/** The dev server transforms every module at the first request; on a busy machine that takes a while. */
const LOAD_TIMEOUT = 180_000;

const sim = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().sim);
const statusText = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-e68-status]')].map((cell) => cell.textContent).join(' | '));
const waitForPhase = (page, phase, timeout = 15000) =>
  page.waitForFunction((wanted) => window.__easy68k.ctx.store.getState().sim.phase === wanted, phase, { timeout });
const waitForHalt = (page, timeout = 15000) =>
  page.waitForFunction(
    () => {
      const state = window.__easy68k.ctx.store.getState().sim;
      return state.phase === 'idle' && state.halted;
    },
    undefined,
    { timeout },
  );
const register = (page, reg) => page.evaluate((n) => window.__easy68k.ctx.sim.engine.getRegister(n), reg);
const D0 = 0;
const D6 = 6;
const D7 = 7;

/** Writes the test programs into the browser store of the page and switches to Simulator mode. */
async function prepare(page, programs) {
  await page.evaluate(async (files) => {
    const { ctx } = window.__easy68k;
    for (const [name, program] of Object.entries(files)) {
      await ctx.vfs.writeFile(`/browser/check/${name}.S68`, Uint8Array.from(program.s68));
      await ctx.vfs.writeFile(`/browser/check/${name}.L68`, Uint8Array.from(program.l68));
    }
    await ctx.commands.run('app.mode.set', 'simulator');
  }, programs);
  // The engine is fetched, compiled and started: the phase leaves 'loading'.
  await page.waitForFunction(
    () => {
      const { ctx } = window.__easy68k;
      return ctx.store.getState().sim.phase === 'idle' && ctx.sim.engine.state().hardwareEnabled;
    },
    undefined,
    { timeout: 30000 },
  );
}

const load = (page, name, origin = 'open') =>
  page.evaluate(
    ([file, how]) => window.__easy68k.ctx.sim.controller.open(`/browser/check/${file}.S68`, how),
    [name, origin],
  );

/**
 * Presses a key with the focus in the Listing region, where the simulator's shortcuts act
 * (2.9.1). Run gives the keyboard to the Output panel, whose keys follow that panel's own rules
 * (2.9.4), so the shortcuts are pressed from the main window, as after a click on the listing.
 */
async function pressInMainWindow(page, key) {
  await page.evaluate(() => {
    const regions = [...document.querySelectorAll('[data-e68-panel="listing"]')];
    regions.find((region) => region.closest('[hidden]') === null)?.focus({ preventScroll: true });
  });
  await page.keyboard.press(key);
}

/** The button of a command in the toolbar of the mode in front. */
const toolbarButton = (page, id) => page.locator(`.e68-shell [role=toolbar] [data-command="${id}"]:visible`).first();

// --- passes ---------------------------------------------------------------------------------

async function runPass(browser, name, programs) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  await prepare(page, programs);

  // --- start-up state and the status bar
  const start = await sim(page);
  check(
    `${p} the engine starts and the store mirrors start-up state`,
    start.phase === 'idle' && start.menuState === 0 && start.program === null,
  );
  const status0 = await statusText(page);
  check(
    `${p} the status bar shows run state, PC, speed and the option flags`,
    status0 === 'Stopped | PC=00000000 | speed: EASy68K-like | exceptions off | bit field off',
    status0,
  );
  check(
    `${p} the status bar is in the shell's status bar`,
    (await page.locator('footer.e68-statusbar [data-e68-status=run]').count()) === 1,
  );

  // --- load
  await load(page, 'counter');
  const loaded = await sim(page);
  check(
    `${p} a program loads from the browser store with its listing`,
    loaded.program?.path === '/browser/check/counter.S68' &&
      loaded.program.hasListing &&
      loaded.messageLines.includes('.S68 file read successful'),
    JSON.stringify(loaded.program),
  );
  check(
    `${p} the window title is the program's name`,
    (await page.title()).startsWith('/browser/check/counter.S68'),
    await page.title(),
  );
  check(
    `${p} the status bar shows the start address`,
    (await statusText(page)).includes('PC=00001000'),
    await statusText(page),
  );
  await page.screenshot({ path: join(outDir, `${name}-loaded.png`) });

  // --- Run from the toolbar, the governor on real frames
  const runButton = toolbarButton(page, 'sim.run.run');
  const hasToolbar = (await runButton.count()) > 0;
  if (hasToolbar) await runButton.click();
  else await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));
  check(`${p} the Run button of the toolbar starts the program`, hasToolbar && (await sim(page)).phase === 'running');
  check(`${p} the status bar says Running`, (await statusText(page)).startsWith('Running'), await statusText(page));
  // The rate over about a second of display frames, three times; the best run counts, because the
  // machine may be busy. The governor grants 1000 instructions per millisecond between two frames,
  // but never more than 50 ms worth (MAX_CATCHUP_MS, 4.2): a frame that comes later than that - a
  // busy machine, a hidden page - is deliberately not made up. `granted` is what that rule allows
  // for the frames this run really had; the program must have executed exactly that much.
  const runs = [];
  for (let i = 0; i < 3; i++) {
    runs.push(
      await page.evaluate(
        () =>
          new Promise((done) => {
            const { engine } = window.__easy68k.ctx.sim;
            let first = null;
            let last = 0;
            let steps = 0;
            let granted = 0;
            let longest = 0;
            const frame = (now) => {
              if (first === null) {
                first = now;
                steps = engine.stepCount;
              } else {
                granted += Math.min(now - last, 50) * 1000;
                longest = Math.max(longest, now - last);
              }
              last = now;
              if (now - first < 1000) window.requestAnimationFrame(frame);
              else done({ executed: (engine.stepCount - steps) >>> 0, ms: now - first, granted, longest });
            };
            window.requestAnimationFrame(frame);
          }),
      ),
    );
  }
  const rateOf = (run) => run.executed / (run.ms / 1000);
  const best = runs.reduce((a, b) => (Math.abs(rateOf(a) - 1e6) < Math.abs(rateOf(b) - 1e6) ? a : b));
  const describe = (run) =>
    `${Math.round(rateOf(run)).toLocaleString('en-US')}/s (longest frame gap ${Math.round(run.longest)} ms)`;
  check(
    `${p} the default speed is a million instructions per second of frame time (best of three)`,
    runs.some((run) => Math.abs(run.executed - run.granted) <= 0.03 * run.granted),
    runs.map(describe).join(', '),
  );
  if (rateOf(best) < 0.95e6) {
    console.log(`  --   ${p} below a million per second because frames came more than 50 ms apart (a busy machine)`);
  }
  const busy = await page.evaluate(() =>
    ['sim.run.run', 'sim.run.traceInto', 'sim.run.pause', 'sim.run.rewind'].map((id) =>
      window.__easy68k.ctx.commands.isEnabled(id),
    ),
  );
  check(
    `${p} while it runs, Run and Trace Into are disabled, Pause and Rewind enabled`,
    JSON.stringify(busy) === '[false,false,true,true]',
    JSON.stringify(busy),
  );

  // --- Pause with F6, Trace Into with F7 (the dispatcher runs this feature's handlers)
  await pressInMainWindow(page, 'F6');
  await waitForPhase(page, 'idle');
  const paused = await register(page, D0);
  await page.waitForTimeout(150);
  check(`${p} F6 pauses the program`, (await register(page, D0)) === paused && paused > 1000, String(paused));
  const regs0 = (await sim(page)).regsRevision;
  await pressInMainWindow(page, 'F7');
  check(`${p} F7 traces one instruction and the registers are refreshed`, (await sim(page)).regsRevision > regs0);

  // --- Maximum speed
  await page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      sim: { ...s.sim, speed: { mode: 'max', instructionsPerSecond: s.sim.speed.instructionsPerSecond } },
    })),
  );
  await pressInMainWindow(page, 'F9');
  await waitForPhase(page, 'running');
  const fast = await page.evaluate(async () => {
    const { engine } = window.__easy68k.ctx.sim;
    const t0 = performance.now();
    const s0 = engine.stepCount;
    await new Promise((r) => setTimeout(r, 500));
    return ((engine.stepCount - s0) >>> 0) / ((performance.now() - t0) / 1000);
  });
  check(
    `${p} F9 runs; at Maximum the program executes several million instructions per second`,
    fast > 3e6,
    Math.round(fast).toLocaleString('en-US'),
  );
  check(
    `${p} the status bar shows the speed setting`,
    (await statusText(page)).includes('speed: Maximum'),
    await statusText(page),
  );
  const frames = await page.evaluate(
    () =>
      new Promise((resolveFrames) => {
        let count = 0;
        const t0 = performance.now();
        const tick = () => {
          count++;
          if (performance.now() - t0 < 500) window.requestAnimationFrame(tick);
          else resolveFrames(count / ((performance.now() - t0) / 1000));
        };
        window.requestAnimationFrame(tick);
      }),
  );
  check(
    `${p} the page keeps its frames while the program runs at Maximum`,
    frames > 20,
    `${Math.round(frames)} frames per second`,
  );
  await pressInMainWindow(page, 'F6');
  await waitForPhase(page, 'idle');
  await page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      sim: { ...s.sim, speed: { mode: 'original', instructionsPerSecond: 1000000 } },
    })),
  );

  // --- a delay in real time, to the halt. Three runs, the best counts: a late timer of a busy
  //     machine can only make the delay longer.
  const delays = [];
  for (let i = 0; i < 3; i++) {
    await load(page, 'delay');
    await pressInMainWindow(page, 'F9');
    await waitForHalt(page);
    delays.push((await register(page, D6)) - (await register(page, D7)));
  }
  const shortest = Math.min(...delays);
  check(
    `${p} a task 23 delay of 50 units takes half a second, by the program's own clock (best of three)`,
    shortest >= 50 && shortest <= 51,
    `${delays.join(', ')} hundredths of a second`,
  );
  const halted = await page.evaluate(() =>
    ['sim.run.run', 'sim.run.traceInto', 'sim.file.open', 'sim.run.reload', 'sim.run.pause'].map((id) =>
      window.__easy68k.ctx.commands.isEnabled(id),
    ),
  );
  check(
    `${p} after the halt Run and Trace are disabled, Open, Reload and Pause enabled`,
    JSON.stringify(halted) === '[false,false,true,true,true]',
    JSON.stringify(halted),
  );
  check(`${p} the status bar says Halted`, (await statusText(page)).startsWith('Halted'), await statusText(page));
  await page.screenshot({ path: join(outDir, `${name}-halted.png`) });

  // --- Run To Cursor without a selected row: the box, and no run
  await pressInMainWindow(page, 'F6');
  await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, selectedRow: -1 } }));
    void ctx.commands.run('sim.run.runToCursor');
  });
  const box = page.locator('[role=alertdialog]');
  await box.waitFor({ timeout: 5000 });
  const boxText = await box.innerText();
  check(
    `${p} Run To Cursor without a row shows the original's box`,
    boxText.includes('Invalid Run-To-Cursor Selection') && boxText.includes('Error'),
    boxText.replace(/\s+/g, ' '),
  );
  await page.screenshot({ path: join(outDir, `${name}-run-to-cursor-box.png`) });
  await box.getByRole('button', { name: 'OK' }).click();
  await box.waitFor({ state: 'detached' });
  check(
    `${p} OK closes the box and nothing ran`,
    (await sim(page)).phase === 'idle' &&
      (await page.evaluate(() => window.__easy68k.ctx.sim.controller.alerts.length)) === 0,
  );

  // --- the Caution question of Close
  await page.evaluate(() => void window.__easy68k.ctx.commands.run('sim.file.close'));
  await box.waitFor({ timeout: 5000 });
  const caution = await box.innerText();
  check(
    `${p} Close asks the Caution question`,
    caution.includes('Caution') &&
      caution.includes('The current debug environment will be lost, click OK to continue.'),
    caution.replace(/\s+/g, ' '),
  );
  await box.getByRole('button', { name: 'Cancel' }).click();
  await box.waitFor({ state: 'detached' });
  check(
    `${p} Cancel keeps the program`,
    (await page.evaluate(() => window.__easy68k.ctx.sim.engine.listingLineCount)) > 0,
  );

  // --- the Execution Speed dialog
  await page.evaluate(() => void window.__easy68k.ctx.commands.run('sim.options.speed'));
  const dialog = page.getByRole('dialog', { name: 'Execution Speed' });
  await dialog.waitFor({ timeout: 5000 });
  await page.screenshot({ path: join(outDir, `${name}-speed-dialog.png`) });
  const scan = await new AxeBuilder({ page })
    .include('[role=dialog]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  check(
    `${p} the Execution Speed dialog passes the accessibility scan`,
    scan.violations.length === 0,
    scan.violations.map((v) => v.id).join(', '),
  );
  await dialog.locator('label').filter({ hasText: 'Custom' }).click();
  const field = dialog.getByRole('textbox');
  await field.fill('abc');
  check(
    `${p} OK is disabled while the custom rate is not a number`,
    await dialog.getByRole('button', { name: 'OK' }).isDisabled(),
  );
  await field.fill('250000');
  await page.screenshot({ path: join(outDir, `${name}-speed-dialog-custom.png`) });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await dialog.waitFor({ state: 'detached' });
  const speed = await page.evaluate(() => window.__easy68k.ctx.settings.get().sim.speed);
  check(
    `${p} OK stores the custom speed`,
    speed.mode === 'custom' && speed.instructionsPerSecond === 250000,
    JSON.stringify(speed),
  );
  check(
    `${p} the status bar follows`,
    (await statusText(page)).includes('speed: 250,000 instructions/s'),
    await statusText(page),
  );
  await page.evaluate(() => void window.__easy68k.ctx.commands.run('sim.options.speed'));
  await dialog.waitFor({ timeout: 5000 });
  await dialog.locator('label').filter({ hasText: 'Maximum' }).click();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  check(
    `${p} Escape cancels the dialog and changes nothing`,
    (await page.evaluate(() => window.__easy68k.ctx.settings.get().sim.speed.mode)) === 'custom',
  );
  await page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      sim: { ...s.sim, speed: { mode: 'original', instructionsPerSecond: 1000000 } },
    })),
  );

  // --- text output, for information: the output device, the fonts and the Output panel belong to
  //     other packages; this only reports whether a printed line reaches the surface of the session.
  await load(page, 'hello');
  await pressInMainWindow(page, 'F9');
  await waitForHalt(page);
  const lit = await page.evaluate(() => {
    const { data } = window.__easy68k.ctx.sim.surface.back;
    let count = 0;
    for (const pixel of data) if ((pixel & 0xffffff) !== 0) count++;
    return count;
  });
  console.log(
    `  --   ${p} a printed line lights ${lit} pixels of the output surface (0 = the output parts are not there yet)`,
  );
  await page.screenshot({ path: join(outDir, `${name}-text-output.png`) });
  await pressInMainWindow(page, 'F6');

  // --- Execute: a cold start replaces the engine, several times
  const replaced = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    let count = 0;
    const stop = ctx.sim.onEngineReplaced(() => count++);
    const first = ctx.sim.engine;
    for (let i = 0; i < 5; i++) await ctx.sim.controller.open('/browser/check/delay.S68', 'execute');
    stop();
    return {
      count,
      replacedEngine: ctx.sim.engine !== first,
      phase: ctx.store.getState().sim.phase,
      pc: ctx.sim.controller.snapshot.boxes[18],
    };
  });
  check(
    `${p} Execute five times: five new engines, loaded and not started`,
    replaced.count === 5 && replaced.replacedEngine && replaced.phase === 'idle' && replaced.pc === '00001000',
    JSON.stringify(replaced),
  );

  // --- dark theme
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await page.screenshot({ path: join(outDir, `${name}-dark.png`) });
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'light'));

  // --- Exit
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.file.exit'));
  const exitText = await page
    .locator('.e68-shell__exit')
    .innerText()
    .catch(() => '');
  check(`${p} Exit shows the empty workspace`, exitText.includes('You can close this tab.'), exitText);

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** A program named in the URL is loaded in Simulator mode and started by run=1 (5.7). */
async function startupPass(browser, name, programs) {
  const p = `${name}:`;
  // A first page puts the program into the browser store; a second page of the same browser
  // context is then opened with the start-up arguments. That needs a store that outlives a page:
  // with the memory backend that stands in until the real one exists there is nothing to show.
  const first = await openApp(browser);
  await prepare(first.page, programs); // also waits until the engine is there, so that leaving the page aborts nothing
  const persisted = await first.page.evaluate(() =>
    window.__easy68k.ctx.vfs.backends().some((backend) => backend.mount === 'browser' && backend.kind === 'browser'),
  );
  if (!persisted) {
    console.log(`  --   ${p} the browser store is the memory backend: the ?open= start cannot be shown yet`);
    await first.context.close();
    return;
  }
  await first.page.close();

  const page = await first.context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}?open=/browser/check/delay.S68&run=1`, { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, undefined, { timeout: LOAD_TIMEOUT });
  await waitForHalt(page, 30000).catch(() => {});
  const state = await page.evaluate(() => ({
    mode: window.__easy68k.ctx.store.getState().mode,
    sim: window.__easy68k.ctx.store.getState().sim,
  }));
  check(
    `${p} ?open=...S68&run=1 opens Simulator mode, loads the program and runs it to its halt`,
    state.mode === 'simulator' && state.sim.program?.path === '/browser/check/delay.S68' && state.sim.halted,
    JSON.stringify({ mode: state.mode, program: state.sim.program, halted: state.sim.halted }),
  );
  check(`${p} start-up: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await first.context.close();
}

// --- run ----------------------------------------------------------------------------------------

async function main() {
  const programs = await assemblePrograms();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // A cache of its own: several checks may run on one machine at the same time.
    cacheDir: join(outDir, 'vite-cache'),
    // Port 0: the system picks a free one. No file watching and no hot reload: a file saved
    // elsewhere in the tree must not reload the page in the middle of a check.
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
        for (const [title, pass] of [
          ['run', runPass],
          ['start-up arguments', startupPass],
        ]) {
          console.log(`\n[${name}, ${title}]`);
          try {
            await pass(browser, name, programs);
          } catch (error) {
            check(`${name}: the ${title} pass ran to its end`, false, String(error).split('\n')[0]);
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
