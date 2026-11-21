// Browser check of sound (ARCHITECTURE.md 9.4, SH5; 3.7). Owner: SH5.
//
//   node app/src/features/audio/check-audio.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives headless Chromium and WebKit
// (Playwright). Two pages:
//
//   1. A blank page of the script's own, which imports the real Web Audio backend
//      (webaudio-backend.ts) and the real sound device (core/sim-host/audio) from the dev server, with
//      the real clock (RealClock), and the six official sounds of tests/corpus/official.
//        - On load, before Playwright touches the page (its evaluate() counts as a user gesture), the
//          page's own script decodes the six files and runs graphicSound.X68's sequence: task 72 of
//          1.wav, task 72 of 0.wav until D0.W = 1, task 70 of roger.wav until D0.W = 1. Checked: the
//          decoded durations equal those parseWav reads from the headers; no audio context exists
//          and nothing sounds (audio is locked before a gesture); the player becomes free when each
//          sound's duration has passed, by the page's clock.
//        - A click unlocks audio: the context runs, a task 73 sound gives a signal on an analyser
//          node, a task 77 loop sounds on until task 77 command 2 stops it, a cold start stops the
//          task 73 sound.
//        - The context suspended and the browser refusing to resume it (what a background tab or
//          the system may do; the refusal is simulated by replacing the context's resume()): the same
//          timing of the busy flag and nothing sounds; a loop asked for meanwhile starts when the
//          context runs again, a short sound whose time has passed meanwhile is not played late.
//   2. The application itself: its audio backend is the Web Audio one; a click and a key on a page
//      that has played nothing start no audio context; a key in the Output panel (one of the gestures
//      of 3.7) starts one, and it runs.
//
// Timing is measured several times and the best run counts; each measured time is printed. A sound
// must never free the player early (by the page's clock, to 1 ms); late by up to LATE_MS is allowed,
// because the page polls with timers that a busy or slow machine delays. What a headless browser
// cannot show is whether anything is heard: see docs/porting/errata/SH5.md, "Manual test".
//
// Prints "N of M checks passed"; exit code 0 only if every check passed and no page logged an error.
// Screenshots go to build/SH5/audio-check (git-ignored). Needs nothing but the pinned development
// dependencies; it does not need engine/dist or a production build. On Linux, where a CI runner may
// have no audio device, a context that never runs is reported as a note and the steps that need it
// are skipped; elsewhere it fails.

/* global console, process, document, window, fetch, performance, setTimeout, navigator -- the browser globals are used inside page callbacks, which run in the page */

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');
const soundsDir = join(repoRoot, 'tests', 'corpus', 'official');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'SH5', 'audio-check')));
mkdirSync(outDir, { recursive: true });
const cacheDir = join(repoRoot, 'build', 'SH5', 'audio-check-cache', String(process.pid));

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const SOUNDS = ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav'];
/** How late a sound may free the player in the best of RUNS runs (timer polling on a loaded machine). */
const LATE_MS = 120;
const RUNS = 3;
const LOAD_TIMEOUT = 240_000;
const IS_LINUX = process.platform === 'linux';
/** What the page script logs when its own part is done, followed by the results as JSON. */
const DONE_MARK = 'check-audio: page done ';

const PAGE_PATH = '__check-audio.html';
const SCRIPT_PATH = '__check-audio.js';
const SOUND_PATH = '__check-audio-sounds';
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>check-audio</title>
<style>body { margin: 16px; background: #202020; color: #e0e0e0; font: 13px/1.4 monospace } button { font: inherit; padding: 6px 12px }</style>
</head>
<body><button id="unlock" type="button">Unlock audio</button><pre id="log"></pre>
<script type="module" src="/${SCRIPT_PATH}"></script></body>
</html>`;

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

// --- the page's own script (runs in the page on load, before Playwright acts) -----------------------

async function pageMain({ soundPath, sounds, runs, doneMark }) {
  const backendModule = await import(/* @vite-ignore */ '/src/features/audio/webaudio-backend.ts');
  const deviceModule = await import(/* @vite-ignore */ '/src/core/sim-host/audio/sound-device.ts');
  const typesModule = await import(/* @vite-ignore */ '/src/core/sim-host/audio/types.ts');
  const clockModule = await import(/* @vite-ignore */ '/src/core/run/clock.ts');
  const state = {};
  window.__audioCheck = state;
  state.log = (text) => {
    document.getElementById('log').textContent += `${text}\n`;
  };
  state.log(navigator.userAgent);
  state.files = new Map();
  for (const name of sounds) {
    const response = await fetch(`/${soundPath}/${name}`);
    state.files.set(name.toUpperCase(), new Uint8Array(await response.arrayBuffer()));
  }
  state.output = backendModule.createBrowserAudioOutput({
    destination(context) {
      state.context = context;
      state.analyser = context.createAnalyser();
      state.analyser.fftSize = 2048;
      state.analyser.connect(context.destination);
      return state.analyser;
    },
  });
  state.backend = new backendModule.WebAudioBackend(state.output, () => performance.now());
  state.clock = new clockModule.RealClock();
  state.messages = [];
  state.device = new deviceModule.SoundDevice({
    backend: state.backend,
    clock: state.clock,
    readProgramFile: (name) => state.files.get(String.fromCharCode(...name).toUpperCase()) ?? null,
    message: (text) => state.messages.push(text),
  });
  state.bytes = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
  state.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  document.getElementById('unlock').addEventListener('click', () => state.backend.resume());

  /** graphicSound.X68's sequence, polling every 2 ms: the two waits, and what sounded. */
  state.sequence = async () => {
    const { device, clock, bytes, sleep, backend, output } = state;
    device.resetToStartup();
    device.loadSound(bytes('1.wav'), 1);
    device.loadSound(bytes('0.wav'), 0);
    const tOne = clock.now();
    const first = device.playSoundMem(1);
    let tries = 0;
    let sounded = 0;
    let running = false;
    const watch = () => {
      sounded = Math.max(sounded, backend.soundingCount());
      running ||= output?.running ?? false;
    };
    while (device.playSoundMem(0) === 0) {
      tries++;
      watch();
      await sleep(2);
    }
    const tZero = clock.now();
    while (device.playSound(bytes('roger.wav')) === 0) {
      tries++;
      watch();
      await sleep(2);
    }
    const tRoger = clock.now();
    watch();
    const result = {
      first,
      tries,
      zeroAfter: tZero - tOne,
      rogerAfter: tRoger - tZero,
      running,
      sounded,
      contextCreated: output?.created ?? false,
      messages: [...state.messages],
    };
    device.resetToStartup();
    state.log(
      `sequence: 0.wav after ${result.zeroAfter.toFixed(2)} ms, roger.wav after ${result.rogerAfter.toFixed(2)} ms, ` +
        `${tries} refused tries, context running: ${running}, most sounding at once: ${sounded}`,
    );
    return result;
  };

  // Decoding
  const decoded = [];
  for (const name of sounds) {
    const bytes = state.files.get(name.toUpperCase());
    const header = typesModule.parseWav(bytes);
    const sound = state.backend.load(bytes);
    const seconds = await state.backend.whenDecoded(sound);
    state.backend.release(sound);
    decoded.push({
      name,
      valid: header.valid,
      headerMs: header.durationMs,
      decodedMs: seconds === null ? null : seconds * 1000,
    });
    state.log(
      `decoded ${name}: header ${header.durationMs.toFixed(3)} ms, decoded ${seconds === null ? 'failed' : (seconds * 1000).toFixed(3)} ms`,
    );
  }
  const afterDecoding = { contextCreated: state.output?.created ?? false };

  // Before any gesture
  const hasUserActivation = 'userActivation' in navigator;
  const activeBefore = hasUserActivation ? navigator.userActivation.hasBeenActive : null;
  const locked = [];
  for (let run = 0; run < runs; run++) locked.push(await state.sequence());
  const webAudio = state.output !== null;
  console.log(doneMark + JSON.stringify({ webAudio, decoded, afterDecoding, hasUserActivation, activeBefore, locked }));
}

/** The page script: pageMain, and a failure reported the same way, so that the check never waits in vain. */
function pageScript() {
  const options = { soundPath: SOUND_PATH, sounds: SOUNDS, runs: RUNS, doneMark: DONE_MARK };
  return `(${pageMain.toString()})(${JSON.stringify(options)}).catch((error) => {
  console.log(${JSON.stringify(DONE_MARK)} + JSON.stringify({ error: String(error && error.stack || error) }));
});`;
}

// --- the dev server ------------------------------------------------------------------------------------

/** Serves the check page, its script and the official sounds. */
function checkPages() {
  const script = pageScript();
  return {
    name: 'check-audio-pages',
    configureServer(server) {
      server.middlewares.use(`/${PAGE_PATH}`, (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(PAGE);
      });
      server.middlewares.use(`/${SCRIPT_PATH}`, (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(script);
      });
      server.middlewares.use(`/${SOUND_PATH}/`, (request, response) => {
        const name = decodeURIComponent((request.url ?? '').replace(/^\//, '').split('?')[0]);
        if (!SOUNDS.includes(name)) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'audio/wav');
        response.end(readFileSync(join(soundsDir, name)));
      });
    },
  };
}

// --- page 1: the backend and the device ------------------------------------------------------------------

/** Checks the runs of the sequence against the header durations; best of the runs for lateness. */
function checkSequence(label, runs, durations) {
  const overshoot = (r) => Math.max(r.zeroAfter - durations.one, r.rogerAfter - durations.zero);
  const best = runs.reduce((a, b) => (overshoot(b) < overshoot(a) ? b : a));
  const neverEarly = runs.every((r) => r.zeroAfter >= durations.one - 1 && r.rogerAfter >= durations.zero - 1);
  const times = runs.map((r) => `${r.zeroAfter.toFixed(1)}/${r.rogerAfter.toFixed(1)}`).join(', ');
  check(
    `${label}: the player is never free before the sound's duration (1.wav ${durations.one.toFixed(2)} ms, 0.wav ${durations.zero.toFixed(2)} ms)`,
    neverEarly && runs.every((r) => r.first === 1),
    `waits in ms (0.wav/roger.wav): ${times}`,
  );
  check(
    `${label}: and free within ${LATE_MS} ms after it, best of ${runs.length}`,
    overshoot(best) < LATE_MS,
    `best run late by ${overshoot(best).toFixed(1)} ms`,
  );
  check(
    `${label}: no message`,
    runs.every((r) => r.messages.length === 0),
    JSON.stringify(runs[0].messages),
  );
  check(
    `${label}: nothing sounds and no audio context runs`,
    runs.every((r) => r.sounded === 0 && !r.running),
    runs.map((r) => `sounded ${r.sounded}, running ${r.running}`).join('; '),
  );
}

const waitUntil = (page, predicate, timeout) =>
  page.waitForFunction(predicate, null, { timeout, polling: 20 }).then(
    () => true,
    () => false,
  );

/** The largest absolute sample the analyser sees within `ms`. */
function peakWithin(page, ms) {
  return page.evaluate(async (limit) => {
    const state = window.__audioCheck;
    const data = new Float32Array(state.analyser.fftSize);
    let peak = 0;
    const end = performance.now() + limit;
    while (performance.now() < end && peak < 0.01) {
      state.analyser.getFloatTimeDomainData(data);
      for (const sample of data) peak = Math.max(peak, Math.abs(sample));
      await state.sleep(10);
    }
    return peak;
  }, ms);
}

async function checkBackendPage(browserName, page, pageResult) {
  check(`${browserName}: the page script ran`, !pageResult.error, pageResult.error ?? '');
  if (pageResult.error) return;
  const ms = Object.fromEntries(pageResult.decoded.map((row) => [row.name, row.headerMs]));
  const durations = { one: ms['1.wav'], zero: ms['0.wav'] };

  if (!pageResult.webAudio) {
    // Playwright's WebKit on Windows is built without Web Audio. The backend then plays nothing, and
    // the program's view must be the same. Safari on macOS has Web Audio: there it is required.
    if (process.platform === 'darwin') check(`${browserName}: the browser has Web Audio`, false, 'no AudioContext');
    note(`${browserName} has no Web Audio here (no AudioContext): only the program's view is checked`);
    checkSequence(`${browserName}, without Web Audio`, pageResult.locked, durations);
    return;
  }

  // 1. Decoding, and the sequence before any gesture (run by the page itself)
  for (const row of pageResult.decoded) {
    check(
      `${browserName}: ${row.name} decodes to the duration of its header`,
      row.valid && row.decodedMs !== null && Math.abs(row.decodedMs - row.headerMs) <= 1,
      `header ${row.headerMs.toFixed(3)} ms, decoded ${row.decodedMs === null ? 'failed' : row.decodedMs.toFixed(3)} ms`,
    );
  }
  check(`${browserName}: decoding starts no audio context`, pageResult.afterDecoding.contextCreated === false);
  if (!pageResult.hasUserActivation) note(`${browserName} has no navigator.userActivation`);
  else if (pageResult.activeBefore) note(`${browserName}: the page counted as activated before any gesture`);
  checkSequence(`${browserName}, before any gesture`, pageResult.locked, durations);
  check(
    `${browserName}, before any gesture: no audio context was created`,
    pageResult.locked.every((r) => !r.contextCreated),
  );

  // 2. A click unlocks audio
  await page.click('#unlock');
  const running = await waitUntil(page, () => window.__audioCheck.output.running, 5_000);
  if (!running && IS_LINUX) {
    note(
      `${browserName}: the audio context did not run after a click (no audio device on this Linux machine?); the steps that need it are skipped`,
    );
    return;
  }
  check(`${browserName}: a click (a user gesture) makes the audio context run`, running);
  if (!running) return;

  const d0 = await page.evaluate(() => window.__audioCheck.device.playSoundDX(window.__audioCheck.bytes('roger.wav')));
  const sounds = await waitUntil(page, () => window.__audioCheck.backend.soundingCount() === 1, 3_000);
  check(`${browserName}: task 73 of roger.wav: D0.W = 1, it sounds once decoded`, d0 === 1 && sounds, `D0.W = ${d0}`);
  const peak = await peakWithin(page, 1500);
  check(
    `${browserName}: the analyser in front of the speakers sees its signal`,
    peak >= 0.01,
    `peak ${peak.toFixed(4)}`,
  );

  const loop = await page.evaluate(async () => {
    const { device, bytes, backend, sleep } = window.__audioCheck;
    const out = {};
    out.load = device.loadSoundDX(bytes('tick.wav'), 0);
    out.loop = device.controlSoundDX(1, 0);
    await sleep(400); // much longer than tick.wav: only a loop is still sounding
    out.soundingLooping = backend.soundingCount();
    out.stop = device.controlSoundDX(2, 0);
    out.soundingStopped = backend.soundingCount();
    device.resetToStartup();
    out.soundingAfterColdStart = backend.soundingCount();
    return out;
  });
  check(
    `${browserName}: task 77 loop sounds on past its length; command 2 stops it; a cold start stops the task 73 sound`,
    loop.load === 1 &&
      loop.loop === 1 &&
      loop.soundingLooping === 2 &&
      loop.stop === 1 &&
      loop.soundingStopped === 1 &&
      loop.soundingAfterColdStart === 0,
    JSON.stringify(loop),
  );

  // 3. A suspended context that the browser will not resume
  await page.evaluate(async () => {
    const state = window.__audioCheck;
    await state.context.suspend();
    state.context.resume = () => Promise.resolve(); // the refusal; removed again below
  });
  check(`${browserName}: the context is suspended`, !(await page.evaluate(() => window.__audioCheck.output.running)));
  const suspended = [];
  for (let run = 0; run < RUNS; run++) suspended.push(await page.evaluate(() => window.__audioCheck.sequence()));
  checkSequence(`${browserName}, audio suspended`, suspended, durations);
  const waiting = await page.evaluate(async () => {
    const { device, bytes, backend, sleep } = window.__audioCheck;
    // Playbacks of the sequences above that ended by the program's clock still wait in the backend
    // until it finds their time over; count only the two new ones.
    const before = backend.waitingCount();
    device.loadSoundDX(bytes('tock.wav'), 1);
    device.controlSoundDX(1, 1); // a loop
    device.loadSoundDX(bytes('tick.wav'), 2);
    device.playSoundMemDX(2); // 107 ms, once
    await sleep(500);
    return { waiting: backend.waitingCount() - before, sounding: backend.soundingCount() };
  });
  await page.evaluate(() => delete window.__audioCheck.context.resume);
  await page.click('#unlock');
  const resumed = await waitUntil(page, () => window.__audioCheck.output.running, 5_000);
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({
    waiting: window.__audioCheck.backend.waitingCount(),
    sounding: window.__audioCheck.backend.soundingCount(),
  }));
  check(
    `${browserName}: while suspended a loop and a short sound wait; on resume the loop sounds and the short sound, whose time is over, does not`,
    waiting.waiting === 2 && waiting.sounding === 0 && resumed && after.waiting === 0 && after.sounding === 1,
    `suspended ${JSON.stringify(waiting)}, resumed ${resumed} ${JSON.stringify(after)}`,
  );
  await page.evaluate(() => window.__audioCheck.device.resetToStartup());
}

// --- page 2: the application -------------------------------------------------------------------------

/** Counts the audio contexts the page creates (an init script, before the application's code). */
function countContexts() {
  const Original = window.AudioContext;
  if (!Original) return;
  window.__audioContexts = [];
  window.AudioContext = class extends Original {
    constructor(...rest) {
      super(...rest);
      window.__audioContexts.push(this);
    }
  };
}

async function checkApplication(browserName, context, baseUrl) {
  await context.addInitScript(countContexts);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
    await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
    await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: LOAD_TIMEOUT });

    const kind = await page.evaluate(() => {
      const audio = window.__easy68k.ctx.devices.audio;
      return { resumeIfWanted: typeof audio.resumeIfWanted, waitingCount: typeof audio.waitingCount };
    });
    check(
      `${browserName}, application: ctx.devices.audio is the Web Audio backend`,
      kind.resumeIfWanted === 'function' && kind.waitingCount === 'function',
      JSON.stringify(kind),
    );
    if (!(await page.evaluate(() => Array.isArray(window.__audioContexts)))) {
      note(
        `${browserName}, application: no Web Audio in this browser build; the steps with an audio context are skipped`,
      );
      await page.screenshot({ path: join(outDir, `${browserName}-application.png`) });
      check(
        `${browserName}, application: no console or page errors`,
        errors.length === 0,
        errors.slice(0, 3).join(' | '),
      );
      await page.close();
      return;
    }

    await page.locator('.e68-shell').click({ position: { x: 300, y: 300 } });
    await page.keyboard.press('Shift');
    check(
      `${browserName}, application: a click and a key on a page that has played nothing start no audio context`,
      (await page.evaluate(() => window.__audioContexts.length)) === 0,
    );

    await page.locator('.e68-modeswitch [data-mode="simulator"]').click();
    const output = page
      .locator('[data-e68-workspace="simulator"] [data-e68-panel="output"] [data-e68-panel-focus]')
      .first();
    await output.waitFor({ timeout: 20_000 });
    await output.focus();
    await page.keyboard.press('a');
    const started = await waitUntil(page, () => window.__audioContexts.length === 1, 5_000);
    const runs = await waitUntil(page, () => window.__audioContexts[0]?.state === 'running', 5_000);
    const states = await page.evaluate(() => window.__audioContexts.map((c) => c.state));
    if (started && !runs && IS_LINUX)
      note(`${browserName}, application: the context was created but did not run (no audio device?)`);
    else {
      check(
        `${browserName}, application: a key in the Output panel starts the audio context, and it runs`,
        started && runs,
        JSON.stringify(states),
      );
    }
    await page.screenshot({ path: join(outDir, `${browserName}-application.png`) });
  } catch (error) {
    check(`${browserName}, application: the steps ran`, false, String(error).split('\n')[0]);
  }
  check(`${browserName}, application: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir,
    // Port 0: the system picks a free one. No file watching and no hot reload.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    plugins: [checkPages()],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Dev server: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    for (const browserName of browsers) {
      console.log(`\n[${browserName}]`);
      const browser = await BROWSERS[browserName].launch();
      try {
        const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        let resolveDone;
        const done = new Promise((resolve) => (resolveDone = resolve));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
          if (message.text().startsWith(DONE_MARK)) resolveDone(JSON.parse(message.text().slice(DONE_MARK.length)));
        });
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(`${baseUrl}${PAGE_PATH}`, { timeout: LOAD_TIMEOUT });
        const pageResult = await Promise.race([
          done,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('the page script did not finish')), LOAD_TIMEOUT),
          ),
        ]);
        await checkBackendPage(browserName, page, pageResult);
        await page.screenshot({ path: join(outDir, `${browserName}-backend.png`) });
        check(`${browserName}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
        await page.close();

        await checkApplication(browserName, context, baseUrl);
        await context.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
    rmSync(cacheDir, { recursive: true, force: true });
  }

  const passed = results.filter((result) => result.ok).length;
  if (notes.length) console.log(`\nNotes:\n${notes.map((text) => `  ${text}`).join('\n')}`);
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
