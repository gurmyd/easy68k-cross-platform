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
//   - a task 23 delay of 50 units takes half a second of real time, as exactly as the browser's
//     own timers allow;
//   - the governor executes about a million instructions per second at the default setting, and
//     far more at Maximum;
//   - the boxes of the simulator (Run To Cursor without a row, the Caution question, a box the
//     engine raises) and the Execution Speed dialog appear and work, and the dialog passes an
//     accessibility scan;
//   - the Open dialog holds a running program while it is open (4.4.5);
//   - the page's own events reach the program files (the window loses the focus, the page is
//     closed) and the journal of the program files is kept in the page's storage (3.8.4);
//   - Execute (a cold start) replaces the engine, several times in a row;
//   - Exit shows `You can close this tab.`;
//   - a program named in the URL is loaded and started, and the switches of the URL act without
//     one (5.7; sim-ui §8.1);
//   - a page that gets no display frames at all still runs its program at its speed and keeps
//     delays exact (4.5.5);
//   - the status bar says Halted after a halt, and Stopped once Rewind or Pause has made Run
//     available again.
//
// Screenshots go to build/SH8/run-check (git-ignored). Exit code 0 = everything passed. The page
// object `window.__easy68k` that the script uses exists in development builds only (main.tsx).
//
// Needs engine/dist (both engines): the test programs are assembled by the real assembler. Without
// it the script says so and does nothing; with EASY68K_REQUIRE_ENGINES=1 (CI) that is a failure.
//
// Nothing here depends on the operating system, and no check fails merely because the machine is
// slow, busy or throttled: every wait is for a state; the figures that are times or rates are
// measured several times, the best run counting; a delay is judged against how late the browser's
// own timers were meanwhile, and the instruction rate against what the frames the page really had
// grant (both were missed on the macOS runners of CI, whose Chromium fires timers 20 to 100 ms late
// and delivers frames 120 ms apart, while WebKit there was exact).

/* global console, process, document, window, performance, setTimeout, Event -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { STEADY_GAP_MS, judgeDelays, judgeRate } from './run-verdicts.mjs';

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
  // Sets the stack pointer, then TRAP #15 task 32 with D1 = 0 (show the Hardware window): one
  // engine call that sends StackFrm->Repaint() and then updateDisplay() (the Stack pass).
  trap32: [
    '        ORG     $1000',
    'START:  MOVEA.L #$8000,SP',
    '        MOVEQ   #0,D1',
    '        MOVEQ   #32,D0',
    '        TRAP    #15',
    '        MOVEQ   #1,D2',
    '        SIMHALT',
    '        END     START',
  ],
};

/** True if both engines are built (engine/dist is not in the repository). */
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

// --- helpers ------------------------------------------------------------------------------

const newContext = (browser) => browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });

/**
 * Opens the application in a new page of `context` and waits until it has started. `polling` is
 * for a page without display frames, where Playwright's waits, which follow the frames by
 * default, must look by timer instead (milliseconds).
 */
async function openPage(context, query = '', polling = undefined) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}${query}`, { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(
    () => window.__easy68k !== undefined && document.querySelector('.e68-shell') !== null,
    undefined,
    waitOptions(LOAD_TIMEOUT, polling),
  );
  return { context, page, errors };
}

/** The application in a browser context of its own. */
const openApp = async (browser, query = '') => openPage(await newContext(browser), query);

/** The dev server transforms every module at the first request; on a busy machine that takes a while. */
const LOAD_TIMEOUT = 180_000;
/** For something the interface shows in answer to an action. Generous: the machine may be busy. */
const UI_TIMEOUT = 30_000;
const waitOptions = (timeout, polling) => (polling === undefined ? { timeout } : { timeout, polling });

const sim = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().sim);
const statusText = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-e68-status]')].map((cell) => cell.textContent).join(' | '));
const waitForPhase = (page, phase, timeout = UI_TIMEOUT) =>
  page.waitForFunction((wanted) => window.__easy68k.ctx.store.getState().sim.phase === wanted, phase, { timeout });
/**
 * Waits for a halt. The engine's halt flag alone does not say it: it stays set from one halt
 * through Rewind and Open until the next run starts (sim-ui §9.9). A halt also makes the commands
 * busy (menuState 1, §3.6), which Rewind, Open and Pause undo.
 */
const waitForHalt = (page, timeout = UI_TIMEOUT, polling = undefined) =>
  page.waitForFunction(
    () => {
      const state = window.__easy68k.ctx.store.getState().sim;
      return state.phase === 'idle' && state.halted && state.menuState === 1;
    },
    undefined,
    waitOptions(timeout, polling),
  );
const register = (page, reg) => page.evaluate((n) => window.__easy68k.ctx.sim.engine.getRegister(n), reg);
const D0 = 0;
const D6 = 6;
const D7 = 7;

/** Writes the test programs into the browser store of the page and switches to Simulator mode. */
async function prepare(page, programs, polling = undefined) {
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
    waitOptions(LOAD_TIMEOUT, polling),
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

/**
 * Runs the delay program to its halt and returns what its own clock (task 8) says the 50-unit
 * delay took, in hundredths of a second, together with how late the browser's own timers were
 * meanwhile: up to `attempts` runs, ending at the first that is exact.
 *
 * The end of a delay is a timer of the page (4.4.2), so the port cannot end a delay earlier than
 * the browser fires a timer. Most machines fire a 500 ms timer within a few milliseconds; a busy or
 * throttled one (the macOS runners of CI fire Chromium's timers 20 to 100 ms late) does not. Two
 * reference timers of 500 ms, one set just before the program is started and one just after, run
 * alongside the delay, and the later of the two tells how late a timer due at the delay's end can
 * be. A run is exact when it took 50 hundredths, plus one for a delay that straddled one more tick
 * of the clock, plus the hundredths by which the reference timers were late.
 */
async function measureDelay(page, run, polling = undefined, attempts = 5) {
  const runs = [];
  const armReference = (slot) =>
    page.evaluate((key) => {
      const t0 = performance.now();
      window.__sh8References ??= {};
      window.__sh8References[key] = null;
      setTimeout(() => {
        window.__sh8References[key] = performance.now() - t0 - 500;
      }, 500);
    }, slot);
  for (let i = 0; i < attempts; i++) {
    await load(page, 'delay');
    await armReference('before');
    await run();
    await armReference('after');
    await waitForHalt(page, UI_TIMEOUT, polling);
    const late = await page.waitForFunction(
      () => {
        const { before, after } = window.__sh8References;
        // An object, because a timer that was on time gives 0, which waitForFunction takes as "not yet".
        return before !== null && after !== null ? { lateMs: Math.max(before, after, 0) } : false;
      },
      undefined,
      waitOptions(UI_TIMEOUT, polling),
    );
    const { lateMs } = await late.jsonValue();
    // The time of day wraps at midnight (8,640,000 hundredths).
    const took = ((await register(page, D6)) - (await register(page, D7)) + 8_640_000) % 8_640_000;
    const allowed = 51 + Math.ceil(lateMs / 10);
    runs.push({ took, lateMs, allowed });
    if (took >= 50 && took <= allowed) break;
  }
  return runs;
}

/** The pace of the scheduler's watchdog once it has taken over: WATCHDOG_FRAME_MS of state/browser.ts. */
const WATCHDOG_FRAME_MS = 1000 / 60;

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
  // The rate over about a second of display frames. The governor grants 1000 instructions per
  // millisecond between two frames, but never more than 50 ms worth (MAX_CATCHUP_MS, 4.2), and gives
  // the engine at most 8 ms per frame: a frame that comes later than that - a busy machine, a hidden
  // page, a throttled browser - is deliberately not made up in full. `granted` is what the first
  // rule allows for the frames a window really had, and the program must have executed exactly that
  // much (3 %) in one of up to five windows; judgeRate says what may fall short of that and why.
  // On a browser that delivers frames 120 ms apart (Chromium on the macOS runners of CI) the grant,
  // and so the rate, is far below a million per second: that is the design (MAX_CATCHUP_MS), not a
  // fault, and the check judges the rate against the grant, never against the wall clock.
  const windows = [];
  for (let i = 0; i < 5; i++) {
    const run = await page.evaluate(
      (steadyGap) =>
        new Promise((done) => {
          const { engine } = window.__easy68k.ctx.sim;
          let first = null;
          let last = 0;
          let steps = 0;
          let granted = 0;
          let longest = 0;
          let frames = 0;
          let slow = 0;
          const frame = (now) => {
            if (first === null) {
              first = now;
              steps = engine.stepCount;
            } else {
              granted += Math.min(now - last, steadyGap) * 1000;
              longest = Math.max(longest, now - last);
              frames++;
              if (now - last > steadyGap) slow++;
            }
            last = now;
            if (now - first < 1000) window.requestAnimationFrame(frame);
            else done({ executed: (engine.stepCount - steps) >>> 0, ms: now - first, granted, longest, frames, slow });
          };
          window.requestAnimationFrame(frame);
        }),
      STEADY_GAP_MS,
    );
    run.exact = Math.abs(run.executed - run.granted) <= 0.03 * run.granted;
    windows.push(run);
    if (run.exact) break;
  }
  const rate = judgeRate(windows);
  check(`${p} the default speed is a million instructions per second of frame time`, rate.ok, rate.detail);
  for (const note of rate.notes) console.log(`  --   ${p} ${note}`);
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
  // Three measurements of half a second, the best counts. What is asked is "far more than the
  // default speed"; how much more depends on the machine.
  const fastRuns = [];
  for (let i = 0; i < 3; i++) {
    fastRuns.push(
      await page.evaluate(async () => {
        const { engine } = window.__easy68k.ctx.sim;
        const t0 = performance.now();
        const s0 = engine.stepCount;
        await new Promise((r) => setTimeout(r, 500));
        return ((engine.stepCount - s0) >>> 0) / ((performance.now() - t0) / 1000);
      }),
    );
  }
  check(
    `${p} F9 runs; at Maximum the program executes far more than a million instructions per second (best of three)`,
    Math.max(...fastRuns) > 2.5e6,
    fastRuns.map((rate) => Math.round(rate).toLocaleString('en-US')).join(', '),
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
  // At most half of each frame goes to the engine (4.2), so the display keeps most of its frames.
  check(
    `${p} the page keeps its frames while the program runs at Maximum`,
    frames > 15,
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

  // --- a delay in real time, to the halt. A late timer of a busy machine can only make the delay
  //     longer, never shorter: up to five runs, the best counts, and none may be too short.
  const delays = judgeDelays(await measureDelay(page, () => pressInMainWindow(page, 'F9')));
  check(
    `${p} a task 23 delay of 50 units takes half a second, by the program's own clock (best of up to five)`,
    delays.ok,
    delays.detail,
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

  // --- after the halt, Rewind puts the commands back into the active state (sim-ui §3.6) while
  //     the engine's own halt flag stays set until the next run (§9.9): the bar says Stopped.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.rewind'));
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.menuState === 0, undefined, {
    timeout: UI_TIMEOUT,
  });
  const rewound = await sim(page);
  const rewoundStatus = await statusText(page);
  check(
    `${p} after Rewind Run is enabled and the status bar says Stopped (integration scenario, wave 1)`,
    rewoundStatus.startsWith('Stopped | PC=00001000') &&
      (await page.evaluate(() => window.__easy68k.ctx.commands.isEnabled('sim.run.run'))),
    `${rewoundStatus}; halted flag ${rewound.halted}, menuState ${rewound.menuState}`,
  );
  // And once more after a halt, with Pause (F6), which re-enables everything and resets nothing.
  await pressInMainWindow(page, 'F9');
  await waitForHalt(page);
  check(`${p} the next halt says Halted again`, (await statusText(page)).startsWith('Halted'), await statusText(page));

  // --- Run To Cursor without a selected row: the box, and no run
  await pressInMainWindow(page, 'F6');
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.menuState === 0, undefined, {
    timeout: UI_TIMEOUT,
  });
  check(
    `${p} after Pause the status bar says Stopped`,
    (await statusText(page)).startsWith('Stopped'),
    await statusText(page),
  );
  await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, selectedRow: -1 } }));
    void ctx.commands.run('sim.run.runToCursor');
  });
  const box = page.locator('[role=alertdialog]');
  await box.waitFor({ timeout: UI_TIMEOUT });
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
  await box.waitFor({ timeout: UI_TIMEOUT });
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

  // --- the Open dialog holds a running program (4.4.5): the original's modal dialog runs its
  //     message loop inside the run loop's own, so the program stands still while it is open.
  await load(page, 'counter');
  await pressInMainWindow(page, 'F9');
  await waitForPhase(page, 'running');
  await pressInMainWindow(page, 'Control+O'); // a chord of File > Open on every platform
  await page.waitForFunction(() => window.__easy68k.ctx.dialogs.isModalOpen(), undefined, { timeout: UI_TIMEOUT });
  const whileOpen = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    const before = ctx.sim.engine.stepCount;
    await new Promise((r) => setTimeout(r, 300));
    return {
      dialog: ctx.store.getState().dialogs.stack.at(-1)?.id,
      held: ctx.sim.controller.held,
      phase: ctx.sim.controller.phase,
      executed: (ctx.sim.engine.stepCount - before) >>> 0,
    };
  });
  check(
    `${p} File > Open while a program runs: the dialog holds the program, nothing executes`,
    whileOpen.held && whileOpen.phase === 'running' && whileOpen.executed === 0,
    JSON.stringify(whileOpen),
  );
  await page.screenshot({ path: join(outDir, `${name}-open-dialog.png`) });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__easy68k.ctx.dialogs.isModalOpen(), undefined, { timeout: UI_TIMEOUT });
  const afterCancel = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    const before = ctx.sim.engine.stepCount;
    // Until it has executed again, or a generous limit has passed.
    for (let i = 0; i < 100 && ctx.sim.engine.stepCount === before; i++) await new Promise((r) => setTimeout(r, 50));
    return {
      held: ctx.sim.controller.held,
      program: ctx.sim.controller.program?.path,
      executed: (ctx.sim.engine.stepCount - before) >>> 0,
    };
  });
  check(
    `${p} Escape closes the dialog, the program is kept and goes on`,
    !afterCancel.held && afterCancel.program === '/browser/check/counter.S68' && afterCancel.executed > 0,
    JSON.stringify(afterCancel),
  );
  await pressInMainWindow(page, 'F6');
  await waitForPhase(page, 'idle');

  // --- a box the engine raises outside a run (4.4.4): the 101st PC breakpoint, set as the gutter
  //     of the listing sets it. (The next File > Open clears the breakpoints again.)
  const breakpoints = await page.evaluate(() => {
    const { sim } = window.__easy68k.ctx;
    for (let i = 0; i < 101; i++) sim.controller.invoke((engine) => engine.setBreakpoint(0x2000 + 2 * i));
    return sim.engine.breakpoints().length;
  });
  await box.waitFor({ timeout: UI_TIMEOUT });
  const limitText = await box.innerText();
  check(
    `${p} the 101st breakpoint shows the engine's box Breakpoint Limit Reached!`,
    breakpoints === 100 && limitText.includes('Breakpoint Limit Reached!') && limitText.includes('Error'),
    `${breakpoints} breakpoints; ${limitText.replace(/\s+/g, ' ')}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-breakpoint-limit-box.png`) });
  await box.getByRole('button', { name: 'OK' }).click();
  await box.waitFor({ state: 'detached' });
  const afterBox = await page.evaluate(() => {
    const { sim } = window.__easy68k.ctx;
    return {
      alerts: sim.controller.alerts.length,
      engineBox: sim.engine.state().alertOpen,
      phase: sim.controller.phase,
    };
  });
  check(
    `${p} OK closes it for the engine too`,
    afterBox.alerts === 0 && !afterBox.engineBox && afterBox.phase === 'idle',
    JSON.stringify(afterBox),
  );

  // --- the Execution Speed dialog
  await page.evaluate(() => void window.__easy68k.ctx.commands.run('sim.options.speed'));
  const dialog = page.getByRole('dialog', { name: 'Execution Speed' });
  await dialog.waitFor({ timeout: UI_TIMEOUT });
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
  await dialog.waitFor({ timeout: UI_TIMEOUT });
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

  // --- text output: the output device, the fonts and the Output panel belong to other packages
  //     (SH1, SH3, SH4); the session composes their real parts, so a printed line must reach the
  //     surface of the session. How it looks is their checks' business.
  await load(page, 'hello');
  await pressInMainWindow(page, 'F9');
  await waitForHalt(page);
  const lit = await page.evaluate(() => {
    const { data } = window.__easy68k.ctx.sim.surface.back;
    let count = 0;
    for (const pixel of data) if ((pixel & 0xffffff) !== 0) count++;
    return count;
  });
  check(`${p} a printed line reaches the output surface of the session`, lit > 0, `${lit} pixels lit`);
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

  // --- the page's own events reach the program files (3.8.4). The calls are counted in front of
  //     the real parts, which run as they are.
  const pageEvents = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    const { files, log, controller } = ctx.sim;
    const calls = [];
    const watch = (object, method) => {
      const original = object[method];
      object[method] = function (...args) {
        calls.push(method);
        return original.apply(this, args);
      };
      return () => {
        object[method] = original;
      };
    };
    const unwatch = [
      watch(files, 'markStale'),
      watch(files, 'revalidateIfStale'),
      watch(files, 'exitNow'),
      watch(log, 'exit'),
    ];
    // The window loses the focus: files may have changed behind a cached view. The next Run
    // revalidates them before the engine gets the command.
    window.dispatchEvent(new Event('blur'));
    const afterBlur = [...calls];
    controller.run();
    for (let i = 0; i < 200 && controller.phase === 'loading'; i++) await new Promise((r) => setTimeout(r, 10));
    const afterRun = [...calls];
    const ran = controller.phase !== 'idle' || ctx.sim.engine.stepCount > 0;
    controller.pause();
    // The page is closing without notice.
    calls.length = 0;
    window.dispatchEvent(new Event('pagehide'));
    const afterHide = [...calls];
    for (const undo of unwatch) undo();
    return { afterBlur, afterRun, ran, afterHide };
  });
  check(
    `${p} the window loses the focus: the program files are marked stale and the next Run revalidates them`,
    JSON.stringify(pageEvents.afterBlur) === '["markStale"]' &&
      JSON.stringify(pageEvents.afterRun) === '["markStale","revalidateIfStale"]' &&
      pageEvents.ran,
    JSON.stringify(pageEvents),
  );
  check(
    `${p} the page is closed: the program files and the log are written out at once`,
    JSON.stringify(pageEvents.afterHide) === '["exitNow","exit"]',
    JSON.stringify(pageEvents.afterHide),
  );
  const journal = await page.evaluate(() => {
    const key = 'easy68k.sim.journal.v1';
    const { journal: store } = window.__easy68k.ctx.sim.ui;
    const kept = window.localStorage.getItem(key);
    store.write('{"check":true}');
    const stored = window.localStorage.getItem(key);
    const read = store.read();
    store.write(null);
    const removed = window.localStorage.getItem(key);
    if (kept !== null) window.localStorage.setItem(key, kept);
    return { stored, read, removed };
  });
  check(
    `${p} the journal of the program files is kept in the page's storage and removed when it is empty`,
    journal.stored === '{"check":true}' && journal.read === '{"check":true}' && journal.removed === null,
    JSON.stringify(journal),
  );

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

  // The switches act without a program too (sim-ui §8.1: "still processed when argument 1 was not
  // a loadable file"). The file named here does not exist: nothing is loaded and nothing is said,
  // the mode stays, the two options are set, and Run halts at once on memory full of $FF.
  const bare = await openApp(browser, '?open=/browser/check/none.S68&run=1&exceptions=1&bitfield=1');
  await bare.page
    .waitForFunction(
      () => {
        const { ctx } = window.__easy68k;
        return ctx.settings.get().sim.bitField && ctx.store.getState().sim.halted;
      },
      undefined,
      { timeout: LOAD_TIMEOUT },
    )
    .catch(() => {});
  const bareState = await bare.page.evaluate(() => {
    const { ctx } = window.__easy68k;
    const { mode, sim } = ctx.store.getState();
    const { exceptions, bitField } = ctx.settings.get().sim;
    return { mode, program: sim.program, messages: sim.messageLines, halted: sim.halted, exceptions, bitField };
  });
  check(
    `${p} ?open=<no such file>&run=1&exceptions=1&bitfield=1: Editor mode stays, the options are set, Run halts at once`,
    bareState.mode === 'editor' &&
      bareState.program === null &&
      bareState.messages.length === 0 &&
      bareState.halted &&
      bareState.exceptions &&
      bareState.bitField,
    JSON.stringify(bareState),
  );
  check(
    `${p} switches alone: no console or page errors`,
    bare.errors.length === 0,
    bare.errors.slice(0, 3).join(' | '),
  );
  await bare.context.close();

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

  const { page, errors } = await openPage(first.context, '?open=/browser/check/delay.S68&run=1');
  await waitForHalt(page, LOAD_TIMEOUT).catch(() => {});
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

/**
 * A page that gets no display frames: a hidden tab, a minimised or covered window (4.5.5). Here
 * requestAnimationFrame never calls back. The scheduler's watchdog then delivers the "frames"
 * from a timer, so the program keeps running, and a delay keeps exact time because its end has a
 * timer of its own. The watchdog ticks at the pace of a display, so the program runs at its speed;
 * the rate is judged against the ticks the page really had, as with frames (judgeRate). (A real
 * hidden tab is slower: there the browser also slows the timers down, 4.5.5.)
 */
async function noFramesPass(browser, name, programs) {
  const p = `${name}:`;
  const polling = 100;
  const context = await newContext(browser);
  await context.addInitScript((paceMs) => {
    let handle = 0;
    window.requestAnimationFrame = () => ++handle;
    window.cancelAnimationFrame = () => {};
    // Records when the scheduler's watchdog delivers a "frame" (a timer of WATCHDOG_FRAME_MS,
    // state/browser.ts), so that the rate below can be judged against the ticks the page really
    // had, as the pass with frames judges it against the frames.
    window.__sh8WatchdogTicks = [];
    const platformSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delayMs, ...rest) =>
      typeof callback === 'function' && Math.abs(Number(delayMs) - paceMs) < 0.01
        ? platformSetTimeout(
            (...callbackArgs) => {
              window.__sh8WatchdogTicks.push(performance.now());
              return callback(...callbackArgs);
            },
            delayMs,
            ...rest,
          )
        : platformSetTimeout(callback, delayMs, ...rest);
  }, WATCHDOG_FRAME_MS);
  const { page, errors } = await openPage(context, '', polling);
  await prepare(page, programs, polling);
  const run = () => page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));

  const delays = judgeDelays(await measureDelay(page, run, polling));
  check(
    `${p} without display frames a task 23 delay of 50 units still takes half a second (best of up to five)`,
    delays.ok,
    delays.detail,
  );

  await load(page, 'counter');
  await run();
  // The watchdog stands in for the display at the pace of one (4.5.5, docs/requests/
  // SH8-frame-watchdog.md), and each of its ticks is a frame to the governor. So the rule of the
  // pass with frames holds here too: the program executes what the ticks it had grant, which is a
  // million instructions per second while the timers keep the pace. Windows of two seconds, up to
  // five, the first exact one ends the measurement.
  const windows = [];
  for (let i = 0; i < 5; i++) {
    const measured = await page.evaluate(async (steadyGap) => {
      const { engine } = window.__easy68k.ctx.sim;
      const ticks = window.__sh8WatchdogTicks;
      const t0 = performance.now();
      const s0 = engine.stepCount;
      const before = ticks.length;
      await new Promise((r) => setTimeout(r, 2000));
      const executed = (engine.stepCount - s0) >>> 0;
      const ms = performance.now() - t0;
      // The ticks of the window, each granting the time since the tick before it, capped.
      let granted = 0;
      let longest = 0;
      let slow = 0;
      for (let k = Math.max(before, 1); k < ticks.length; k++) {
        const gap = ticks[k] - ticks[k - 1];
        granted += Math.min(gap, steadyGap) * 1000;
        longest = Math.max(longest, gap);
        if (gap > steadyGap) slow++;
      }
      return { executed, ms, granted, longest, frames: ticks.length - before, slow };
    }, STEADY_GAP_MS);
    measured.exact = measured.granted > 0 && Math.abs(measured.executed - measured.granted) <= 0.03 * measured.granted;
    windows.push(measured);
    if (measured.exact) break;
  }
  const verdict = judgeRate(windows);
  check(
    `${p} without display frames the default speed is still a million instructions per second of watchdog time`,
    verdict.ok,
    verdict.detail,
  );
  for (const note of verdict.notes) console.log(`  --   ${p} ${note}`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.pause'));
  check(`${p} no frames: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/**
 * The Stack panel and the repaints of one engine call (gate I2, the major defect carried from gate
 * I1 round 3). A trace over TRAP #15 task 32 with D1 = 0 shows the Hardware window, whose FormShow
 * redraws the Stack window where it is (StackFrm->Repaint()); the same trace then ends with
 * updateDisplay(), which re-centres it on the stack pointer. The original ends re-centred; the port
 * used to stay where the user had scrolled the panel.
 */
async function stackPass(browser, name, programs) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  await prepare(page, programs);
  await load(page, 'trap32');
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.stack'));
  const rowSelector = '[data-e68-panel="stack"] .e68-stack__row:not(.e68-stack__measure)';
  await page.waitForSelector(rowSelector, { timeout: UI_TIMEOUT });
  const middle = () =>
    page.evaluate((selector) => {
      const rows = [...document.querySelectorAll(selector)];
      return rows[Math.trunc(rows.length / 2)]?.textContent?.slice(0, 8) ?? '';
    }, rowSelector);
  const trace = async () => {
    const before = (await sim(page)).regsRevision;
    await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.traceInto'));
    await page.waitForFunction((rev) => window.__easy68k.ctx.store.getState().sim.regsRevision > rev, before, {
      timeout: UI_TIMEOUT,
    });
  };
  await trace(); // MOVEA.L #$8000,SP
  await page.waitForFunction(
    ({ selector }) => {
      const rows = [...document.querySelectorAll(selector)];
      return rows[Math.trunc(rows.length / 2)]?.textContent?.startsWith('00008000');
    },
    { selector: rowSelector },
    { timeout: UI_TIMEOUT },
  );
  await trace(); // MOVEQ #0,D1
  await trace(); // MOVEQ #32,D0
  const centred = await middle();
  const stackPanel = page.locator('[data-e68-panel="stack"]');
  await stackPanel.getByRole('button', { name: 'Higher addresses' }).click();
  await stackPanel.getByRole('button', { name: 'Higher addresses' }).click();
  const scrolled = await middle();
  check(
    `${p} the Stack panel is centred on SP = 00008000 and scrolls two rows`,
    centred === '00008000' && scrolled === '00008008',
    `${centred} -> ${scrolled}`,
  );
  const before = (await sim(page)).repaint;
  await trace(); // TRAP #15, task 32, D1 = 0
  const after = (await sim(page)).repaint;
  // The Hardware window may now be in front of the Stack panel; the panel keeps its rows.
  const now = await middle();
  check(
    `${p} a trace over TRAP #15 task 32/0 re-centres the scrolled Stack panel on SP`,
    now === '00008000',
    `middle row ${now}; repaint.stack ${before?.stack} -> ${after?.stack}, ` +
      `stackRedraw ${before?.stackRedraw} -> ${after?.stackRedraw}`,
  );
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.stack'));
  await page.screenshot({ path: join(outDir, `${name}-stack-after-trap32.png`) });
  check(`${p} stack: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- run ----------------------------------------------------------------------------------------

async function main() {
  if (!enginesBuilt()) {
    const required = process.env.EASY68K_REQUIRE_ENGINES === '1';
    console.log(
      `engine/dist is incomplete: run \`npm run build:engines\` or \`npm run fetch:engines\` first. ${
        required ? 'EASY68K_REQUIRE_ENGINES is 1: that is a failure.' : 'Nothing was checked.'
      }`,
    );
    process.exit(required ? 1 : 0);
  }
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
          ['no display frames', noFramesPass],
          ['stack', stackPass],
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
