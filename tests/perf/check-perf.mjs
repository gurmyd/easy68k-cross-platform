// Performance and speed of the port (ARCHITECTURE.md 6.9 item 9, 9.6 P1, R-13). Owner: P1.
//
//   node tests/perf/check-perf.mjs [--browser chromium|webkit|all] [--out <dir>]
//                                  [--judge auto|strict|report] [--only <part>]... [--runs <n>]
//
//   parts: assembly, calibrate, taskduration, maximum, frames, surface (default: all)
//
//   --bounded-subslice <ms>  an experiment for SH8, not a measurement of the port: while draw.X68
//                            runs, every engine.run() call also ends after <ms> milliseconds, as a
//                            sub-slice bounded by time would (docs/porting/speed.md 4.1). Its
//                            frame figures are printed and never judged.
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright) with the fixed programs of this folder, assembled by the real
// assembler:
//
//   assembly      the largest corpus file is assembled under Node (6.9: "less than one second");
//   calibrate     calibrate.X68 at the default speed and at Maximum, by the program's own clock;
//   taskduration  spin.X68 at the default speed for 30 s: the increase of TaskDuration of the
//                 DevTools protocol's Performance.getMetrics (6.9: less than 4.5 s; Chromium only);
//   maximum       the engine alone (no governor, called back to back for 5 s in total), then
//                 spin.X68 at Maximum for 10 s, then the engine alone once more (the better of
//                 the two blocks is the figure): engine.stepCount (6.9 as corrected on 22 November
//                 2026: at least 100 million and at least 85 % of what the engine alone executes
//                 in 5 s; erratum P1 13);
//   frames        draw.X68: the intervals of requestAnimationFrame timestamps (6.9: 95th
//                 percentile below 20 ms at 60 Hz, below 12 ms with the 120 Hz frame source);
//   surface       surface.X68: a 4096 x 4096 surface is resized, cleared, flood-filled and
//                 presented without a failure, with the memory use and the time of each step.
//
// Frame sources. The 60 Hz and 120 Hz sources are simulated, as 3.11.1 provides for tests: an
// init script replaces the page's requestAnimationFrame with a timer that calls back on a grid of
// 1000/60 or 1000/120 ms and skips the slots the page was too busy for, as a display does. The
// application's scheduler (state/browser.ts) runs on it unchanged. The display's own frames
// (headless Chromium: 60 Hz; the macOS runners of CI: often none) are measured as well, for
// information. The frame intervals are taken from the timestamps the source passes to its
// callbacks, which are the times the callbacks ran.
//
// Judging. A figure the program observes (its own clock, its instruction count, its pixels) is
// judged everywhere. A wall-clock figure is a property of the machine: the thresholds of 6.9 item 9
// are judged where 6.9 sets them, Chromium on Linux (ubuntu-latest), and elsewhere printed with
// "would pass" or "would miss" (--judge strict judges everywhere, --judge report nowhere). Every
// timed figure is the best of several runs, and every run is printed, so that a failure can be
// diagnosed from the log alone. A run on a busy machine can be slower; it cannot be faster, so
// the best run is the machine's figure.
//
// Screenshots and the figures as JSON (perf.json) go to build/P1/perf-check (git-ignored). Exit
// code 0 = every judged check passed. Needs engine/dist; without it the script says so and does
// nothing, and with EASY68K_REQUIRE_ENGINES=1 (CI) that is a failure.

/* global document, window, CanvasRenderingContext2D, HTMLCanvasElement -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import {
  LIMITS,
  bestEngineAlone,
  engineAloneFigure,
  fixed,
  grouped,
  intervalsOf,
  judgeAssembly,
  judgeCalibrate,
  judgeFrames,
  judgeHere,
  judgeMaximum,
  judgeTaskDuration,
  mib,
  parsePs,
  parseWindowsProcesses,
  stepsBetween,
  summarize,
  treeMemory,
} from './perf-verdicts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const appRoot = join(repoRoot, 'app');

// --- arguments ------------------------------------------------------------------------------

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'P1', 'perf-check')));
const judgeOption = option('--judge', 'auto');
const judgeOverride = judgeOption === 'strict' || judgeOption === 'report' ? judgeOption : null;
const ALL_PARTS = ['assembly', 'calibrate', 'taskduration', 'maximum', 'frames', 'surface'];
const onlyParts = args.flatMap((arg, i) => (args[i - 1] === '--only' ? [arg] : []));
const parts = new Set(onlyParts.length > 0 ? onlyParts : ALL_PARTS);
/** Most runs of a timed measurement; the first that passes ends it, the best counts. */
const RUNS = Math.max(1, Number(option('--runs', '3')) || 3);
/** An experiment, not a measurement of the port: see framesPart. 0 = off. */
const BOUND_MS = Math.max(0, Number(option('--bounded-subslice', '0')) || 0);
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
for (const part of parts) if (!ALL_PARTS.includes(part)) throw new Error(`--only ${part}: no such part`);

// --- results --------------------------------------------------------------------------------

let baseUrl = '';
let failures = 0;
const results = [];
const figures = { machine: machine(), parts: {} };

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const note = (text) => console.log(`  --   ${text}`);

/**
 * A threshold of 6.9: judged where `judged` is true, otherwise printed as a note with the outcome
 * it would have had.
 */
function threshold(name, verdict, judged) {
  if (judged) check(name, verdict.ok, verdict.detail);
  else note(`${name}: ${verdict.ok ? 'would pass' : 'would MISS'} (not judged here) - ${verdict.detail}`);
}

/** What the figures were measured on. */
function machine() {
  const list = cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    cpu: list[0]?.model?.trim() ?? 'unknown',
    logicalCpus: list.length,
    memory: mib(totalmem()),
    node: process.version,
    ci: process.env.CI === 'true',
  };
}

// --- programs -------------------------------------------------------------------------------

const PROGRAMS = ['calibrate', 'spin', 'draw', 'surface'];

/** True if both engines are built (engine/dist is not in the repository). */
function enginesBuilt() {
  const dist = join(repoRoot, 'engine', 'dist');
  return ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
    existsSync(join(dist, file)),
  );
}

const asmModule = () => import(pathToFileURL(join(repoRoot, 'engine', 'asm', 'asm68k.mjs')).href);

/** The fixed programs, assembled by the real assembler, as { s68, l68 } byte arrays. */
async function assemblePrograms() {
  const { assemble } = await asmModule();
  const programs = {};
  for (const name of PROGRAMS) {
    const file = `${name}.X68`;
    const source = new Uint8Array(readFileSync(join(here, file)));
    const result = await assemble(file, new Map([[file, source]]), {}, new Date(2026, 0, 1));
    if (result.errorCount > 0 || !result.sRecord || !result.listing) {
      throw new Error(`${file} does not assemble: ${result.messages.map((m) => m.text).join('; ')}`);
    }
    programs[name] = { s68: [...result.sRecord], l68: [...result.listing] };
  }
  return programs;
}

// --- page helpers ---------------------------------------------------------------------------

/** The dev server transforms every module at the first request; on a busy machine that takes a while. */
const LOAD_TIMEOUT = 180_000;
const UI_TIMEOUT = 60_000;
const D3 = 3;
const D4 = 4;
const D7 = 7;

/**
 * Replaces requestAnimationFrame with a frame source of `hz` frames per second (3.11.1): the
 * callbacks run on a grid of 1000/hz ms; a slot the page was too busy for is skipped, as a display
 * skips it, and the callbacks get the time they ran. Runs in the page before its scripts.
 */
function frameSourceScript(hz) {
  const period = 1000 / hz;
  const platformSetTimeout = window.setTimeout.bind(window);
  let pending = new Map();
  let handle = 0;
  let armed = false;
  let next = performance.now() + period;
  const fire = () => {
    armed = false;
    const now = performance.now();
    next += period;
    if (next <= now) next += Math.ceil((now - next) / period) * period;
    if (next <= now) next += period;
    const batch = pending;
    pending = new Map();
    for (const callback of batch.values()) {
      try {
        callback(now);
      } catch (error) {
        platformSetTimeout(() => {
          throw error;
        }, 0);
      }
    }
    if (pending.size > 0) arm();
  };
  const arm = () => {
    if (armed) return;
    armed = true;
    platformSetTimeout(fire, Math.max(0, next - performance.now()));
  };
  window.requestAnimationFrame = (callback) => {
    pending.set(++handle, callback);
    arm();
    return handle;
  };
  window.cancelAnimationFrame = (id) => void pending.delete(id);
  window.__p1FrameSource = hz;
}

/** Records the time and size of every putImageData call (the Output panel's presentation). */
function presentRecorderScript() {
  const original = CanvasRenderingContext2D.prototype.putImageData;
  window.__p1Puts = [];
  CanvasRenderingContext2D.prototype.putImageData = function (...rest) {
    const t0 = performance.now();
    const value = original.apply(this, rest);
    const width = rest.length >= 7 ? rest[5] : rest[0].width;
    const height = rest.length >= 7 ? rest[6] : rest[0].height;
    window.__p1Puts.push({ at: t0, ms: performance.now() - t0, width, height, canvas: this.canvas.width });
    return value;
  };
  // And every change of a canvas's size (the backing store is reallocated).
  window.__p1Sizes = [];
  for (const property of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
    Object.defineProperty(HTMLCanvasElement.prototype, property, {
      ...descriptor,
      set(value) {
        const t0 = performance.now();
        descriptor.set.call(this, value);
        window.__p1Sizes.push({ at: t0, ms: performance.now() - t0, property, value });
      },
    });
  }
}

/**
 * A browser context with the frame source `source` ('display' = the browser's own frames, or 60 /
 * 120 for the simulated ones), and the application open in a page of it.
 */
async function openApp(browser, source) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  if (source !== 'display') await context.addInitScript(frameSourceScript, source);
  await context.addInitScript(presentRecorderScript);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(
    () => window.__easy68k !== undefined && document.querySelector('.e68-shell') !== null,
    undefined,
    { timeout: LOAD_TIMEOUT, polling: 100 },
  );
  return { context, page, errors };
}

/** Writes the programs into the browser store of the page and switches to Simulator mode. */
async function prepare(page, programs) {
  await page.evaluate(async (files) => {
    const { ctx } = window.__easy68k;
    for (const [name, program] of Object.entries(files)) {
      await ctx.vfs.writeFile(`/browser/perf/${name}.S68`, Uint8Array.from(program.s68));
      await ctx.vfs.writeFile(`/browser/perf/${name}.L68`, Uint8Array.from(program.l68));
    }
    await ctx.commands.run('app.mode.set', 'simulator');
  }, programs);
  await page.waitForFunction(
    () => {
      const { ctx } = window.__easy68k;
      return ctx.store.getState().sim.phase === 'idle' && ctx.sim.engine.state().hardwareEnabled;
    },
    undefined,
    { timeout: LOAD_TIMEOUT, polling: 100 },
  );
}

/** Sets the speed setting: 'original' (EASy68K-like, the default) or 'max'. */
const setSpeed = (page, mode) =>
  page.evaluate(
    (wanted) =>
      window.__easy68k.ctx.settings.update((s) => ({
        ...s,
        sim: { ...s.sim, speed: { ...s.sim.speed, mode: wanted } },
      })),
    mode,
  );

/** Loads a program and starts it with the Run command. */
async function loadAndRun(page, name) {
  await openProgram(page, name);
  await runLoaded(page);
}

const openProgram = (page, name) =>
  page.evaluate((file) => window.__easy68k.ctx.sim.controller.open(`/browser/perf/${file}.S68`, 'open'), name);

/** Starts the loaded program with the Run command and waits until it has executed something. */
async function runLoaded(page) {
  const before = await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    const steps = ctx.sim.engine.stepCount;
    void ctx.commands.run('sim.run.run');
    return steps;
  });
  // Running, or (a short program) already executed and halted again.
  await page.waitForFunction(
    (steps) => {
      const { ctx } = window.__easy68k;
      return ctx.store.getState().sim.phase !== 'idle' || ctx.sim.engine.stepCount !== steps;
    },
    before,
    { timeout: UI_TIMEOUT, polling: 50 },
  );
}

const pause = (page) => page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.pause'));

const waitForHalt = (page, timeout = UI_TIMEOUT) =>
  page.waitForFunction(
    () => {
      const state = window.__easy68k.ctx.store.getState().sim;
      return state.phase === 'idle' && state.halted;
    },
    undefined,
    { timeout, polling: 100 },
  );

const registers = (page, list) =>
  page.evaluate((regs) => regs.map((r) => window.__easy68k.ctx.sim.engine.getRegister(r) >>> 0), list);

/** Samples engine.stepCount every 50 ms for `ms` and returns the instructions executed. */
const countSteps = (page, ms) =>
  page.evaluate(
    (windowMs) =>
      new Promise((done) => {
        const { sim } = window.__easy68k.ctx;
        const samples = [sim.engine.stepCount >>> 0];
        const t0 = performance.now();
        const sample = () => {
          samples.push(sim.engine.stepCount >>> 0);
          if (performance.now() - t0 < windowMs) setTimeout(sample, 50);
          else done({ samples, ms: performance.now() - t0, phase: sim.controller.phase });
        };
        setTimeout(sample, 50);
      }),
    ms,
  );

/** requestAnimationFrame timestamps for `ms`, and how many passes draw.X68 made meanwhile (D7). */
const recordFrames = (page, ms) =>
  page.evaluate(
    (windowMs) =>
      new Promise((done) => {
        const { engine } = window.__easy68k.ctx.sim;
        const stamps = [];
        const passes0 = engine.getRegister(7) >>> 0;
        const steps0 = engine.stepCount >>> 0;
        const t0 = performance.now();
        const frame = (now) => {
          stamps.push(now);
          if (performance.now() - t0 < windowMs) window.requestAnimationFrame(frame);
          else {
            done({
              stamps,
              passes: ((engine.getRegister(7) >>> 0) - passes0) >>> 0,
              steps: ((engine.stepCount >>> 0) - steps0) >>> 0,
              ms: performance.now() - t0,
            });
          }
        };
        window.requestAnimationFrame(frame);
      }),
    ms,
  );

/** The memory of the browser processes this script started (every descendant of this process). */
function browserMemory() {
  let rows;
  try {
    if (process.platform === 'win32') {
      const out = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 },
      );
      rows = parseWindowsProcesses(out.stdout);
    } else {
      const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 });
      rows = parsePs(out.stdout);
    }
  } catch {
    return null;
  }
  const tree = treeMemory(rows, process.pid);
  const self = rows.find((row) => row.pid === process.pid)?.bytes ?? 0;
  return { bytes: tree.bytes - self, processes: tree.processes - 1 };
}

const sourceName = (source) => (source === 'display' ? "the display's own frames" : `the ${source} Hz frame source`);
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) }).catch(() => {});

// --- parts ----------------------------------------------------------------------------------

/** 6.9: assembling the largest corpus file takes less than one second under Node. */
async function assemblyPart() {
  console.log('\n[node, assembly]');
  const { assemble, loadEditorText } = await asmModule();
  const corpus = join(repoRoot, 'tests', 'corpus');
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.x68$/i.test(entry.name)) sources.push({ path, bytes: statSync(path).size });
    }
  };
  walk(corpus);
  sources.sort((a, b) => b.bytes - a.bytes);
  const largest = sources[0];
  // The largest file, and the program that includes it (pacman-mc68000's MAIN.X68 includes GFX.X68).
  const folder = dirname(largest.path);
  const files = new Map();
  for (const entry of readdirSync(folder)) {
    if (/\.x68$/i.test(entry)) files.set(entry, new Uint8Array(readFileSync(join(folder, entry))));
  }
  const cases = [{ label: relative(corpus, largest.path).replaceAll('\\', '/'), main: largest.path }];
  const largestName = largest.path.split(/[\\/]/).pop().toUpperCase();
  const textOf = (bytes) => new TextDecoder('latin1').decode(bytes).toUpperCase();
  const including = [...files.keys()].find(
    (name) =>
      name.toUpperCase() !== largestName &&
      /INCLUDE\s+\S*/.test(textOf(files.get(name))) &&
      textOf(files.get(name)).includes(largestName) &&
      /^MAIN\.X68$/i.test(name),
  );
  if (including) {
    cases.push({
      label: `${relative(corpus, join(folder, including)).replaceAll('\\', '/')}, which includes it`,
      main: join(folder, including),
    });
  }

  const judged = judgeHere({ platform: process.platform, browser: 'chromium', override: judgeOverride });
  figures.parts.assembly = [];
  for (const { label, main } of cases) {
    const name = main.split(/[\\/]/).pop();
    // The main source as the editor hands it over (its font and tab trailer removed).
    const editor = loadEditorText(files.get(name));
    const set = new Map(files);
    set.set(name, editor.text);
    const options = {};
    if (editor.tabType !== null) options.tabType = editor.tabType;
    if (editor.tabSize !== null) options.tabSize = editor.tabSize;
    const runs = [];
    let lines = 0;
    let errors = 0;
    for (let i = 0; i < RUNS + 2; i++) {
      const t0 = performance.now();
      const result = await assemble(name, set, options, new Date(2026, 0, 1));
      runs.push({ ms: performance.now() - t0 });
      lines = result.listing ? result.listing.filter((byte) => byte === 10).length : 0;
      errors = result.errorCount;
    }
    // The engine module is compiled once per process (here: before, for the fixed programs), and
    // every call gets a fresh instance (W4). A cold start in a new process is printed too.
    const verdict = judgeAssembly(runs);
    const cold = coldAssembly(
      main,
      [...files.keys()].map((file) => join(folder, file)),
    );
    figures.parts.assembly.push({ label, bytes: statSync(main).size, runs, cold, errors, lines });
    threshold(
      `assembling ${label}, ${grouped(statSync(main).size)} bytes, takes less than a second under Node`,
      verdict,
      judged,
    );
    note(
      `${label}: ${errors} errors, ${grouped(lines)} listing lines; in a new Node process, with loading and ` +
        `compiling the engine: ${cold ? `${fixed(cold.totalMs, 0)} ms (the call itself ${fixed(cold.assembleMs, 0)} ms)` : 'failed'}`,
    );
  }
}

/** Assembles `main` once in a new Node process: the time from importing the engine to the result. */
function coldAssembly(main, includeFiles) {
  const script = `
    const t0 = performance.now();
    const { assemble, loadEditorText } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'engine', 'asm', 'asm68k.mjs')).href)});
    const { readFileSync } = await import('node:fs');
    const { basename } = await import('node:path');
    const [main, ...others] = process.argv.slice(1);
    const files = new Map(others.map((file) => [basename(file), new Uint8Array(readFileSync(file))]));
    const editor = loadEditorText(files.get(basename(main)));
    files.set(basename(main), editor.text);
    const t1 = performance.now();
    await assemble(basename(main), files, {}, new Date(2026, 0, 1));
    const t2 = performance.now();
    console.log(JSON.stringify({ totalMs: t2 - t0, assembleMs: t2 - t1 }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, main, ...includeFiles], {
    encoding: 'utf8',
    maxBuffer: 16 * 2 ** 20,
  });
  try {
    return JSON.parse(child.stdout.trim().split('\n').pop());
  } catch {
    return null;
  }
}

/** calibrate.X68 at the default speed and at Maximum, by the program's own clock. */
async function calibratePart(browser, name, programs) {
  console.log(`\n[${name}, calibrate]`);
  const judged = judgeHere({ platform: process.platform, browser: name, override: judgeOverride });
  const { context, page, errors } = await openApp(browser, 60);
  await prepare(page, programs);
  const runs = {};
  for (const mode of ['original', 'max']) {
    await setSpeed(page, mode);
    await loadAndRun(page, 'calibrate');
    await waitForHalt(page, 120_000);
    const [instructions, hundredths, ips] = await registers(page, [D4, D3, D7]);
    runs[mode] = { instructions, hundredths, ips };
    if (mode === 'original') {
      check(
        `${name}: calibrate.X68 counts whole blocks and divides correctly`,
        judgeCalibrate(runs[mode]).ok,
        judgeCalibrate(runs[mode]).detail,
      );
      threshold(
        `${name}: at the default speed calibrate.X68 reports 1,000,000 instructions per second by its own clock (2 %)`,
        judgeCalibrate(runs[mode], { expected: 1_000_000, tolerance: 0.02 }),
        judged,
      );
    } else {
      const verdict = judgeCalibrate(runs[mode]);
      check(`${name}: at Maximum calibrate.X68 runs and reports`, verdict.ok, verdict.detail);
    }
    await shot(page, `${name}-calibrate-${mode}`);
  }
  figures.parts[`calibrate-${name}`] = runs;
  check(`${name}: calibrate: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** 6.9: at the default speed, over 30 s of spin.X68, TaskDuration grows by less than 4.5 s. */
async function taskDurationPart(browser, name, programs) {
  if (name !== 'chromium') {
    note(`${name}: TaskDuration is a metric of Chromium's DevTools protocol; not measured in ${name}`);
    return;
  }
  const judged = judgeHere({ platform: process.platform, browser: name, override: judgeOverride });
  figures.parts.taskduration = {};
  for (const source of [60, 120, 'display']) {
    console.log(`\n[${name}, TaskDuration, ${sourceName(source)}]`);
    const { context, page, errors } = await openApp(browser, source);
    await prepare(page, programs);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const taskDuration = async () =>
      (await cdp.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? NaN;
    await setSpeed(page, 'original');
    await loadAndRun(page, 'spin');
    await page.waitForTimeout(2000);
    // The judged sources are measured up to twice: the window is 30 s.
    const runs = [];
    const attempts = source === 120 ? 1 : Math.min(RUNS, 2);
    for (let i = 0; i < attempts; i++) {
      const before = await taskDuration();
      const steps0 = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount >>> 0);
      const t0 = Date.now();
      await page.waitForTimeout(LIMITS.taskDurationWindowSeconds * 1000);
      const after = await taskDuration();
      const steps1 = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount >>> 0);
      const wall = (Date.now() - t0) / 1000;
      // Scaled to exactly 30 s: the window is a little longer than asked for.
      const seconds = ((after - before) * LIMITS.taskDurationWindowSeconds) / wall;
      runs.push({ seconds, wall, rate: ((steps1 - steps0) >>> 0) / wall });
      if (seconds < LIMITS.taskDurationSeconds) break;
    }
    figures.parts.taskduration[source] = runs;
    const verdict = judgeTaskDuration(runs);
    const rates = runs.map((run) => grouped(run.rate)).join(', ');
    const title = `${name}: spin.X68 at the default speed with ${sourceName(source)}: TaskDuration grows by less than ${LIMITS.taskDurationSeconds} s in ${LIMITS.taskDurationWindowSeconds} s`;
    // 6.9 sets the threshold for the default speed with the display's frames (60 Hz in
    // ubuntu-latest's headless Chromium); the simulated 60 Hz source is judged the same way. At
    // 120 Hz the work per frame is done twice as often, and the figure is printed for information
    // (docs/porting/speed.md; errata P1.md entry 3).
    if (source === 120) note(`${title}: ${verdict.ok ? 'passes' : 'misses'} (for information) - ${verdict.detail}`);
    else threshold(title, verdict, judged);
    note(
      `${name}, ${sourceName(source)}: meanwhile the program executed ${rates} instructions per second of wall time`,
    );
    const running = await page.evaluate(() => window.__easy68k.ctx.sim.controller.phase);
    check(`${name}, ${sourceName(source)}: spin.X68 was still running`, running === 'running', running);
    await pause(page);
    check(
      `${name}, ${sourceName(source)}: no console or page errors`,
      errors.length === 0,
      errors.slice(0, 3).join(' | '),
    );
    await context.close();
  }
}

/**
 * What the engine alone executes in 5 s, as 6.9 item 9 says it (erratum P1 13): spin.X68 without the
 * governor, in calls of one million instructions (through invoke(), the controller's door for an
 * engine call) made back to back until the calls have taken LIMITS.maximumEngineSeconds in total,
 * after one call that is not counted (the engine's code is compiled and warm before the counted
 * ones; a cold figure would be lower and make the share easier to reach). Returns the calls,
 * { steps, ms } each; engineAloneFigure makes the figure. The program is loaded and stopped; it is
 * opened again afterwards by the caller.
 */
async function engineAloneCalls(page) {
  await openProgram(page, 'spin');
  return page.evaluate(
    (totalMs) =>
      new Promise((done) => {
        const { controller } = window.__easy68k.ctx.sim;
        controller.invoke((engine) => {
          const calls = [];
          engine.cmdRun();
          engine.run(1_000_000);
          let spent = 0;
          while (spent < totalMs) {
            const s0 = engine.stepCount >>> 0;
            const t0 = performance.now();
            engine.run(1_000_000);
            const ms = performance.now() - t0;
            calls.push({ steps: ((engine.stepCount >>> 0) - s0) >>> 0, ms });
            spent += ms;
          }
          engine.cmdPause();
          done(calls);
        });
      }),
    LIMITS.maximumEngineSeconds * 1000,
  );
}

/**
 * 6.9 item 9 as corrected on 22 November 2026 (erratum P1 13): at Maximum, engine.stepCount advances
 * in 10 s by at least 100 million, and by at least 85 % of what the engine alone executes in 5 s on
 * the same runner in the same job (the half of each frame that the governor gives the engine,
 * SLICE_FRAME_SHARE = 0.5). The engine-alone figure is the best of two 5 s blocks in the page of the
 * 60 Hz run (bestEngineAlone): one before any Maximum run and one after the 60 Hz runs, so that both
 * sides of the share are a best of several. The Maximum runs stop early once the verdict passes
 * against the first block; if it then fails against the best of both, further runs follow (up to
 * RUNS in all). The 60 Hz frame source is the judged figure; the 120 Hz one is printed with its
 * verdict, for information.
 */
async function maximumPart(browser, name, programs) {
  const judged = judgeHere({ platform: process.platform, browser: name, override: judgeOverride });
  figures.parts[`maximum-${name}`] = {};
  let engineRate = Number.NaN;
  const blocks = [];
  /** One 5 s block of the engine alone, printed and checked; the best block so far becomes engineRate. */
  const measureEngineAlone = async (page, when) => {
    const alone = engineAloneFigure(await engineAloneCalls(page));
    blocks.push(alone);
    const best = bestEngineAlone(blocks);
    engineRate = best?.rate ?? Number.NaN;
    figures.parts[`maximum-${name}`].engineAloneBlocks = blocks;
    figures.parts[`maximum-${name}`].engineAlone = best;
    // "engine-alone block", not "the engine alone": the summary line below is the one the
    // release-candidate judge (tests/integration/rc/item-09-perf-verdict.mjs) reads first.
    note(
      `${name}: engine-alone block ${blocks.length}, ${when} (spin.X68, no governor, ${alone.calls} calls of run(1,000,000) back to back in ` +
        `${fixed(alone.ms / 1000, 2)} s): ${grouped(alone.inWindow)} instructions in ${LIMITS.maximumEngineSeconds} s ` +
        `(${grouped(alone.rate)} per second; for information, the calls' rates: best ${grouped(alone.bestBurst)}, ` +
        `median ${grouped(alone.medianBurst)} per second); at Maximum the governor gives it ${fixed(100 * 0.5, 0)} % of each ` +
        `frame (SLICE_FRAME_SHARE), so 10 s at Maximum can give about that at best`,
    );
    check(
      `${name}: engine-alone block ${blocks.length} (${when}) ran for ${LIMITS.maximumEngineSeconds} s in total`,
      alone.complete,
      `${fixed(alone.ms, 0)} ms`,
    );
  };
  /** Maximum runs of 10 s each until the verdict passes against engineRate or RUNS runs are made. */
  const maximumRuns = async (page, runs) => {
    await setSpeed(page, 'max');
    await loadAndRun(page, 'spin');
    await page.waitForTimeout(1000);
    while (runs.length < RUNS) {
      const { samples, ms, phase } = await countSteps(page, LIMITS.maximumWindowSeconds * 1000);
      // Scaled to exactly 10 s.
      const steps = (stepsBetween(samples) * LIMITS.maximumWindowSeconds * 1000) / ms;
      runs.push({ steps, ms, phase });
      if (judgeMaximum(runs, engineRate).ok) break;
    }
    await pause(page);
  };
  for (const source of [60, 120]) {
    console.log(`\n[${name}, Maximum, ${sourceName(source)}]`);
    const { context, page, errors } = await openApp(browser, source);
    await prepare(page, programs);
    if (source === 60) await measureEngineAlone(page, 'before the Maximum runs');
    const runs = [];
    await maximumRuns(page, runs);
    if (source === 60) {
      await measureEngineAlone(page, 'after the Maximum runs');
      note(
        `${name}: the engine alone, the best of ${blocks.length} blocks of ${LIMITS.maximumEngineSeconds} s: ` +
          `${grouped(engineRate)} instructions per second (blocks ${blocks.map((block) => grouped(block.rate)).join(', ')})`,
      );
      // Judged against a higher figure than the early stop was: more runs, up to RUNS in all.
      if (!judgeMaximum(runs, engineRate).ok && runs.length < RUNS) await maximumRuns(page, runs);
    }
    figures.parts[`maximum-${name}`][source] = runs;
    const verdict = judgeMaximum(runs, engineRate);
    figures.parts[`maximum-${name}`][`verdict${source}`] = { ...verdict, engineRate };
    const title =
      `${name}: spin.X68 at Maximum with ${sourceName(source)}: at least ${grouped(LIMITS.maximumSteps)} instructions in ` +
      `${LIMITS.maximumWindowSeconds} s and at least ${fixed(100 * LIMITS.maximumShareOfEngine, 0)} % of the engine alone in ${LIMITS.maximumEngineSeconds} s`;
    if (source === 120) note(`${title}: ${verdict.ok ? 'passes' : 'misses'} (for information) - ${verdict.detail}`);
    else threshold(title, verdict, judged);
    check(
      `${name}, ${sourceName(source)}: spin.X68 ran at Maximum throughout`,
      runs.every((run) => run.phase === 'running' && run.steps > 0),
    );
    check(
      `${name}, ${sourceName(source)}: no console or page errors`,
      errors.length === 0,
      errors.slice(0, 3).join(' | '),
    );
    await context.close();
  }
}

/** 6.9: frame intervals while draw.X68 runs: p95 below 20 ms at 60 Hz, below 12 ms at 120 Hz. */
async function framesPart(browser, name, programs) {
  // An experiment changes what is measured: its figures are never judged.
  const judged = BOUND_MS === 0 && judgeHere({ platform: process.platform, browser: name, override: judgeOverride });
  figures.parts[`frames-${name}`] = {};
  for (const source of [60, 120, 'display']) {
    console.log(`\n[${name}, frames, ${sourceName(source)}]`);
    const { context, page, errors } = await openApp(browser, source);
    await prepare(page, programs);
    // The page alone, before the program runs: what the frame source and the browser give.
    const idle = summarize(intervalsOf((await recordFrames(page, 2000)).stamps));
    await setSpeed(page, 'original');
    await loadAndRun(page, 'draw');
    await page.waitForTimeout(1000);
    const runs = [];
    // For the explanation: how long each engine.run() call of the controller takes (a call cannot
    // be interrupted, and the controller looks at the clock only between calls, 4.2).
    // With --bounded-subslice <ms> (an experiment for SH8, errata P1.md entry 9) a call also ends
    // once it has run for that long, in steps of 16 instructions: what a sub-slice bounded by time
    // would do. Without it the call is passed through unchanged.
    await page.evaluate((boundMs) => {
      const { engine } = window.__easy68k.ctx.sim;
      const original = engine.run;
      const bounded = function (n = 1) {
        const t0 = performance.now();
        const s0 = this.stepCount >>> 0;
        let status;
        do {
          const done = ((this.stepCount >>> 0) - s0) >>> 0;
          status = original.call(this, Math.min(16, n - done));
        } while (status === 0 && ((this.stepCount >>> 0) - s0) >>> 0 < n && performance.now() - t0 < boundMs);
        return status;
      };
      window.__p1Runs = [];
      try {
        engine.run = function (...rest) {
          const t0 = performance.now();
          const s0 = this.stepCount >>> 0;
          const status = boundMs > 0 ? bounded.apply(this, rest) : original.apply(this, rest);
          window.__p1Runs.push({ ms: performance.now() - t0, steps: ((this.stepCount >>> 0) - s0) >>> 0 });
          return status;
        };
      } catch {
        // A frozen engine object: no figures per call, the frames are measured all the same.
      }
    }, BOUND_MS);
    for (let i = 0; i < RUNS; i++) {
      await page.evaluate(() => void (window.__p1Runs.length = 0));
      const { stamps, passes, steps, ms } = await recordFrames(page, 5000);
      const calls = await page.evaluate(() => window.__p1Runs.splice(0));
      const callMs = summarize(calls.map((call) => call.ms));
      runs.push({
        ...summarize(intervalsOf(stamps)),
        passes,
        rate: steps / (ms / 1000),
        engineCalls: calls.length,
        engineMs: calls.reduce((sum, call) => sum + call.ms, 0),
        callP95: callMs.p95,
        callMax: callMs.max,
        stepsPerCall: calls.length ? calls.reduce((sum, call) => sum + call.steps, 0) / calls.length : 0,
      });
      note(
        `${name}, ${sourceName(source)}, run ${i + 1}: engine.run() ${grouped(calls.length)} calls of ${grouped(runs.at(-1).stepsPerCall)} ` +
          `instructions on average, ${fixed(runs.at(-1).engineMs / (ms / 1000), 0)} ms per second in them, one call p95 ${fixed(callMs.p95, 1)} ms, ` +
          `longest ${fixed(callMs.max, 1)} ms; frames p95 ${fixed(runs.at(-1).p95, 1)} ms`,
      );
      const hz = source === 'display' ? 60 : source;
      if (runs.at(-1).p95 < LIMITS.frameP95Ms[hz]) break;
    }
    figures.parts[`frames-${name}`][source] = { idle, runs };
    const shown = await page.evaluate(() => {
      const canvas = document.querySelector('.e68-output__canvas');
      return canvas !== null && canvas.getClientRects().length > 0 ? `${canvas.width}x${canvas.height}` : 'hidden';
    });
    check(
      `${name}, ${sourceName(source)}: draw.X68 draws and the Output panel presents it`,
      runs.every((run) => run.passes > 0 && run.count > 0) && shown === '640x480',
      `canvas ${shown}; ${runs.map((run) => `${grouped(run.passes)} passes, ${grouped(run.rate)} instructions/s`).join('; ')}`,
    );
    note(
      `${name}, ${sourceName(source)}: with no program running the intervals were median ${fixed(idle.median, 2)}, p95 ${fixed(idle.p95, 2)}, max ${fixed(idle.max, 1)} ms`,
    );
    if (source === 'display') {
      // 6.9's "at 60 Hz" is the display of ubuntu-latest's headless Chromium, which gives 60 Hz.
      if (runs[0].count === 0) note(`${name}: the display delivered no frames (the scheduler's watchdog stands in)`);
      else {
        threshold(
          `${name}: frame intervals while draw.X68 runs, ${sourceName(source)} (${fixed(1000 / idle.median, 0)} Hz): 95th percentile below ${LIMITS.frameP95Ms[60]} ms`,
          judgeFrames(runs, 60),
          judged && Math.abs(idle.median - 1000 / 60) < 2,
        );
      }
    } else {
      threshold(
        `${name}: frame intervals while draw.X68 runs, ${sourceName(source)}: 95th percentile below ${LIMITS.frameP95Ms[source]} ms`,
        judgeFrames(runs, source),
        judged,
      );
    }
    await shot(page, `${name}-draw-${source}`);
    await pause(page);
    check(
      `${name}, ${sourceName(source)}: no console or page errors`,
      errors.length === 0,
      errors.slice(0, 3).join(' | '),
    );
    await context.close();
  }
}

/**
 * A 4096 x 4096 surface: resize, clear, flood fill and present without a failure, with the memory
 * use and the time of each step (9.6 P1; R-13 for the time of the flood fill).
 */
async function surfacePart(browser, name, programs) {
  console.log(`\n[${name}, 4096 x 4096 surface]`);
  const { context, page, errors } = await openApp(browser, 'display');
  await prepare(page, programs);
  await openProgram(page, 'surface');
  await page.waitForTimeout(500);
  // Times of the surface's own steps, measured around the methods of the session's surface.
  await page.evaluate(() => {
    const { surface } = window.__easy68k.ctx.sim;
    window.__p1Steps = [];
    for (const method of ['resize', 'fillBlack', 'floodFill', 'setFillColor']) {
      const original = surface[method];
      surface[method] = function (...rest) {
        const t0 = performance.now();
        const value = original.apply(this, rest);
        window.__p1Steps.push({ method, at: t0, ms: performance.now() - t0 });
        return value;
      };
    }
    // Frame gaps from now on (R-13), each with the time it ended.
    window.__p1Gaps = [];
    window.__p1GapsOn = true;
    let last = performance.now();
    const frame = (now) => {
      if (!window.__p1GapsOn) return;
      window.__p1Gaps.push({ at: now, ms: now - last });
      last = now;
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  });
  const memoryBefore = browserMemory();
  const heapBefore = name === 'chromium' ? await jsHeap(context, page) : null;
  const startedAt = await page.evaluate(() => performance.now());
  await runLoaded(page);
  let halted = true;
  await waitForHalt(page, 120_000).catch(() => {
    halted = false;
  });
  check(
    `${name}: surface.X68 runs to its halt`,
    halted,
    JSON.stringify(await page.evaluate(() => window.__easy68k.ctx.store.getState().sim.phase)),
  );
  // Presented: the canvas has the surface's size and a putImageData of the whole of it was made.
  const presented = await page
    .waitForFunction(
      () => {
        const canvas = document.querySelector('.e68-output__canvas');
        return canvas?.width === 4096 && window.__p1Puts.some((put) => put.canvas === 4096) ? true : false;
      },
      undefined,
      { timeout: UI_TIMEOUT, polling: 100 },
    )
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1500);
  // The frame gaps and the steps' times first, before the scan below adds work of its own.
  const timing = await page.evaluate(() => {
    window.__p1GapsOn = false;
    return {
      gaps: window.__p1Gaps,
      steps: window.__p1Steps,
      puts: window.__p1Puts.filter((put) => put.canvas === 4096),
      sizes: window.__p1Sizes.filter((size) => size.value === 4096),
    };
  });
  const state = await page.evaluate(() => {
    const { surface, engine } = window.__easy68k.ctx.sim;
    const { back } = surface;
    let other = 0;
    for (let i = 0; i < back.data.length; i++) if (back.data[i] !== 0xff00c000) other++;
    const canvas = document.querySelector('.e68-output__canvas');
    const context2d = canvas.getContext('2d');
    const at = (x, y) => [...context2d.getImageData(x, y, 1, 1).data];
    return {
      size: [back.width, back.height],
      window: surface.window === null ? null : [surface.window.width, surface.window.height],
      other,
      canvas: [canvas.width, canvas.height],
      pixels: [at(0, 0), at(4095, 4095), at(2048, 2048), at(17, 3001)],
      registers: [3, 4, 5, 6, 7, 10, 11].map((r) => engine.getRegister(r) >>> 0),
      sizeText: document.querySelector('.e68-output__size')?.textContent ?? '',
    };
  });
  const memoryAfter = browserMemory();
  const heapAfter = name === 'chromium' ? await jsHeap(context, page) : null;
  const [d3, d4, d5, d6, d7, a2, a3] = state.registers;
  check(
    `${name}: TRAP #15 task 33 makes the surface 4096 x 4096 and reports it`,
    d3 === 0x10001000 && state.size.join('x') === '4096x4096' && state.sizeText.includes('4096'),
    `D3=${d3.toString(16)}, surface ${state.size.join('x')}, header "${state.sizeText}"`,
  );
  check(
    `${name}: the flood fill paints all 16,777,216 pixels; task 83 reads them back`,
    state.other === 0 && a2 === 0xc000 && a3 === 0xc000,
    `${grouped(state.other)} pixels of another colour; A2=${a2.toString(16)}, A3=${a3.toString(16)}`,
  );
  const green = (pixel) => pixel[0] === 0 && pixel[1] === 0xc0 && pixel[2] === 0 && pixel[3] === 255;
  check(
    `${name}: the Output panel presents the whole 4096 x 4096 surface`,
    presented && state.canvas.join('x') === '4096x4096' && state.pixels.every(green),
    `canvas ${state.canvas.join('x')}, pixels ${JSON.stringify(state.pixels)}, ${timing.puts.length} presentations of the large canvas`,
  );
  const after = (at) => `at ${fixed(at - startedAt, 0)}`;
  const by = (method) =>
    timing.steps
      .filter((step) => step.method === method)
      .map((step) => `${fixed(step.ms, 1)} (${after(step.at)})`)
      .join(', ') || '-';
  note(
    `${name}: times in the page, in ms (and ms after Run) - resize ${by('resize')}, clear ${by('fillBlack')}, ` +
      `flood fill ${by('floodFill')}, canvas size ${timing.sizes.map((size) => `${size.property} ${fixed(size.ms, 1)} (${after(size.at)})`).join(', ')}, ` +
      `presentation ${timing.puts.map((put) => `${fixed(put.ms, 1)} (${after(put.at)}, ${put.width}x${put.height})`).join(', ')}`,
  );
  const hundredths = (from, to) => ((to - from + 8_640_000) % 8_640_000) / 100;
  note(
    `${name}: by the program's own clock - resize ${fixed(hundredths(d7, d6), 2)} s, clear ${fixed(hundredths(d6, d5), 2)} s, flood fill ${fixed(hundredths(d5, d4), 2)} s`,
  );
  const sinceRun = timing.gaps.filter((gap) => gap.at > startedAt);
  const longest = [...sinceRun].sort((a, b) => b.ms - a.ms).slice(0, 3);
  note(
    `${name}: frame gaps from Run to 1.5 s after the presentation: ${sinceRun.length} frames, the longest ` +
      `${longest.map((gap) => `${fixed(gap.ms, 0)} ms (ending ${fixed(gap.at - startedAt, 0)} ms after Run)`).join(', ')} ` +
      `(R-13: no action unless a frame exceeds 100 ms outside the calls the original also blocks in)`,
  );
  const memory =
    memoryBefore && memoryAfter
      ? `browser processes ${mib(memoryBefore.bytes)} -> ${mib(memoryAfter.bytes)} (+${mib(memoryAfter.bytes - memoryBefore.bytes)}, ${memoryAfter.processes} processes)`
      : 'browser processes: not measurable here';
  const heap = heapBefore !== null && heapAfter !== null ? `; JS heap ${mib(heapBefore)} -> ${mib(heapAfter)}` : '';
  const darwinWebKit =
    process.platform === 'darwin' && name === 'webkit'
      ? " (on macOS WebKit's web content process is not a child of this script and is not counted)"
      : '';
  note(
    `${name}: memory - pixel buffers 4096 x 4096 x 4 = 64.0 MiB each (back buffer; the canvas's backing store holds another); ${memory}${heap}${darwinWebKit}`,
  );
  figures.parts[`surface-${name}`] = { state, timing, memoryBefore, memoryAfter, heapBefore, heapAfter };
  await shot(page, `${name}-surface-4096`);
  check(`${name}: surface: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** Chromium's JS heap in use (Performance.getMetrics JSHeapUsedSize), in bytes. */
async function jsHeap(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  return metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? null;
}

// --- run ------------------------------------------------------------------------------------

async function main() {
  console.log(
    `Machine: ${figures.machine.cpu}, ${figures.machine.logicalCpus} logical CPUs, ${figures.machine.memory}, ` +
      `${figures.machine.platform}/${figures.machine.arch}, Node ${figures.machine.node}${figures.machine.ci ? ', CI' : ''}`,
  );
  console.log(
    `Judging the thresholds of 6.9 item 9: ${judgeOverride ?? 'auto (Chromium on Linux only)'}; at most ${RUNS} runs of each timed figure, the best counts`,
  );
  if (BOUND_MS > 0) {
    console.log(
      `EXPERIMENT: every engine.run() call while draw.X68 runs ends after ${BOUND_MS} ms (--bounded-subslice); ` +
        'the frame figures show what a time-bounded sub-slice would give, not what the port does',
    );
  }
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
  if (parts.has('assembly')) await assemblyPart();

  const browserParts = ALL_PARTS.filter((part) => part !== 'assembly' && parts.has(part));
  if (browserParts.length > 0) {
    const server = await createServer({
      configFile: join(appRoot, 'vite.config.ts'),
      root: appRoot,
      logLevel: 'warn',
      // A cache of its own: several checks may run on one machine at the same time.
      cacheDir: join(outDir, 'vite-cache'),
      // Port 0: the system picks a free one. No file watching and no hot reload.
      server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
    baseUrl = `http://127.0.0.1:${address.port}/`;
    console.log(`Application: ${baseUrl}\nScreenshots and figures: ${outDir}`);
    const passes = {
      calibrate: calibratePart,
      taskduration: taskDurationPart,
      maximum: maximumPart,
      frames: framesPart,
      surface: surfacePart,
    };
    try {
      for (const name of browsers) {
        const browser = await BROWSERS[name].launch();
        try {
          figures.machine[name] = browser.version();
          for (const part of browserParts) {
            try {
              await passes[part](browser, name, programs);
            } catch (error) {
              check(`${name}: the ${part} part ran to its end`, false, String(error).split('\n')[0]);
            }
          }
        } finally {
          await browser.close();
        }
      }
    } finally {
      await server.close();
    }
  }

  writeFileSync(join(outDir, 'perf.json'), `${JSON.stringify(figures, null, 2)}\n`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
