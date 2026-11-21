// Browser check of the Hardware panel (ARCHITECTURE.md 9.2, SH7). Owner: SH7.
//
//   node app/src/features/hardware/check-hardware.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright). What unit tests under Node cannot show:
//
//   1. In the application as it starts, before any program: View > Hardware shows the panel with every
//      control of hardware §5 (64 segments, 8 LEDs, bit labels, 8 switches, 8 push buttons, four
//      address fields with their '00' prefix, 7 IRQ buttons with 7 check boxes and the Automatic
//      label, the Auto Interval field and level list, Reset, and the Memory Map rows); an
//      accessibility scan of the panel in both themes.
//   2. With the application's own simulator session (features/run, SH8: the real engine, the real
//      HardwareModel, the real run controller and timers): programs assembled by the real assembler
//      are written to the browser store and opened with File > Open. Then: segments and LEDs follow
//      a running program; the panel repaints after a write that causes no host call (writeBytes
//      through the queue); a real click on a switch sets its bit; a held push button reads 0 and is
//      released by pointer up and by pointer cancel; typing an address colours conflicting fields
//      red; showing the panel zeroes the switch byte and keeps the pictures; the auto-interrupt
//      settings reach the engine; the Automatic label follows Run and Pause; IRQ and Reset are
//      disabled after SIMHALT.
//
// Nothing waits a fixed time: every step waits for the state it expects (up to WAIT ms), so a slow
// CI runner only makes the check slower. Nothing depends on the operating system.
//
// Without engine/dist part 1 still runs and the expected engine-load errors are printed but not
// counted; part 2 is skipped, or fails when EASY68K_REQUIRE_ENGINES=1. --without-engines behaves so
// on a machine that has the engines, without touching engine/dist: the page's requests for
// engine/dist get the answer a server without them gives, chosen by --engine-answer:
//   vite (default)  what the Vite development server answers for a missing file (measured with
//                   Vite 8): 404 to the module import, 200 text/html (its index.html) to fetch().
//   html            200 text/html to every request, as a static host with a start-page fallback.
//   404             404 to every request, as a plain static host.
// Every answer to an engine/dist request is printed, so a failure can be read from a CI log alone.
//
// Screenshots go to build/SH7/hardware-check (git-ignored). Prints "N of M checks passed"; exit
// code 0 = everything passed and no console error. "Failed to load resource ... Timeout was reached"
// (WebKit, when the development server is slow to transform a module on a loaded machine) is printed
// but not counted: a resource that really failed makes the checks of the panel fail instead.
//
// The development server uses a dependency cache of its own below --out, so checks running at the
// same time do not share one. When it re-bundles its dependencies while the page loads (a fresh
// cache, as on every CI runner), the page may get a 504 "Outdated Optimize Dep" or two copies of
// React ("Invalid hook call"); the page is then loaded again, up to three times.

/* global console, process, document, window, getComputedStyle, PointerEvent, setTimeout -- the browser globals are used inside page.evaluate() callbacks */

import { existsSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'SH7', 'hardware-check')));
mkdirSync(outDir, { recursive: true });
/**
 * --without-engines: behave as on a machine without engine/dist. Every request for a file of
 * engine/dist gets the answer --engine-answer names (see the header) and part 2 is skipped (or
 * fails, see below). This proves the run without engines on a machine that has them, without
 * touching engine/dist.
 */
const withoutEngines = args.includes('--without-engines');
const engineAnswer = option('--engine-answer', 'vite');
if (!['vite', 'html', '404'].includes(engineAnswer)) {
  console.error(`--engine-answer must be vite, html or 404, not ${engineAnswer}`);
  process.exit(2);
}

/** Part 2 needs both engines; without them it is skipped, or fails when EASY68K_REQUIRE_ENGINES=1. */
const enginesBuilt =
  !withoutEngines &&
  ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((file) =>
    existsSync(join(repoRoot, 'engine', 'dist', file)),
  );

/** A request for a file of engine/dist (the development server serves it under /@fs/.../engine/dist/). */
const isEngineFile = (url) => /\/engine\/dist\//.test(url);

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
/** The console and page errors of the page opened last (printed when a pass stops early). */
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

/** The development server transforms every module at the first request; on a busy machine that takes a while. */
const LOAD_TIMEOUT = 180_000;
/** How long a step waits for the state it expects. */
const WAIT = 30_000;

/** WebKit's message when the development server answered a module request too late (see the header). */
const isLoadTimeout = (text) => /Failed to load resource.*Timeout was reached/i.test(text);

/**
 * The browsers' messages about a file they could not load or use. Chromium: "Failed to load resource:
 * ... 404" and, for a module answered with text/html, "Failed to load module script: Expected a
 * JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"". WebKit:
 * "Failed to load resource", "... is not a valid JavaScript MIME type", "Importing a module script
 * failed". Neither names the file in the text; openApp appends the location's URL.
 */
const isLoadFailure = (text) =>
  /Failed to load (resource|module script)|MIME type|Importing a module script failed/i.test(text);

/**
 * Without engine/dist the simulator session cannot fetch its engine when Simulator mode opens: the
 * browser reports the failed requests of engine/dist and the session reports "The simulator engine
 * could not be created". That is the expected outcome then, not a defect of the panel, so it is
 * printed but not counted, but only when the message names a file of engine/dist (or is the
 * session's own report). With the engines present it is counted.
 */
const isMissingEngine = (text) =>
  !enginesBuilt && ((isLoadFailure(text) && isEngineFile(text)) || /simulator engine could not be created/i.test(text));

/** The "no console or page errors" check of a pass. */
function reportErrors(prefix, errors) {
  const ignored = (text) => isLoadTimeout(text) || isMissingEngine(text);
  const timeouts = errors.filter(isLoadTimeout);
  const missing = errors.filter(isMissingEngine);
  const real = errors.filter((text) => !ignored(text));
  if (timeouts.length) console.log(`        not counted: ${timeouts.length} x "${timeouts[0]}"`);
  for (const text of missing) console.log(`        not counted (no engines): "${firstLine(text)}"`);
  check(`${prefix} no console or page errors`, real.length === 0, real.slice(0, 3).join(' | '));
  // Every counted error in full, so that a failure on a CI runner can be read from its log alone.
  for (const text of real.slice(3)) console.log(`        also counted: ${text}`);
}

/** The first line of a message (the stack follows on the next lines). */
const firstLine = (text) => text.split('\n')[0];

/** Waits until `fn(arg)` is true in the page; false instead of an exception when it never is. */
const until = (page, fn, arg, timeout = WAIT) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );

/** Waits until `predicate(panel)` is true for what the panel shows (readPanelInPage). */
const untilPanel = (page, predicate, timeout = WAIT) =>
  page
    .waitForFunction(
      `(() => { const panel = window.__hwRead(); return !!panel && (${predicate})(panel); })()`,
      undefined,
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );

function pretendWindows() {
  Object.defineProperty(window.Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(window.Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1300 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendWindows);
  if (withoutEngines) {
    await context.route(
      (url) => isEngineFile(url.pathname),
      async (route) => {
        // The answer of a server without engine/dist (see --engine-answer in the header). The Vite
        // development server answers a module import (resource type "script") with 404 and a fetch()
        // with its index.html.
        const notFound =
          engineAnswer === '404' || (engineAnswer === 'vite' && route.request().resourceType() === 'script');
        if (notFound) await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
        else {
          const index = await route.fetch({ url: baseUrl });
          await route.fulfill({ status: 200, contentType: 'text/html', body: await index.text() });
        }
      },
    );
  }
  const page = await context.newPage();
  const errors = [];
  pageErrors = errors;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The browsers' messages about a file they could not load name no URL; the location does.
    const url = message.location()?.url ?? '';
    const text = message.text();
    errors.push(isLoadFailure(text) && url && !text.includes(url) ? `${text} (${url})` : text);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  // When the development server finds a dependency it has not pre-bundled yet (a fresh cache on a
  // CI runner, or a file another package just saved), it bundles again and answers the requests of
  // the page already loading with 504 "Outdated Optimize Dep", or the page gets modules of the old
  // and the new bundles and React stops with "Invalid hook call" (two copies of React). With hot
  // reload off the page never recovers by itself, so it is loaded again; the next load gets the new
  // bundles.
  let outdated;
  page.on('response', (response) => {
    if (response.status() === 504) outdated = true;
    // Every answer to a request for engine/dist, for the CI log.
    if (isEngineFile(new URL(response.url()).pathname)) {
      const type = response.headers()['content-type'] ?? 'no content type';
      console.log(`        engine/dist request: ${response.status()} ${type} ${response.url()}`);
    }
  });
  const reoptimized = () => outdated || errors.some((text) => /Invalid hook call/i.test(text));
  for (let attempt = 1; ; attempt++) {
    outdated = false;
    errors.length = 0;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    const started = Date.now();
    let ready = false;
    while (!ready && !reoptimized() && Date.now() - started < LOAD_TIMEOUT) {
      ready = await page
        .evaluate(() => window.__easy68k !== undefined && document.querySelector('.e68-shell') !== null)
        .catch(() => false);
      if (!ready) await new Promise((wake) => setTimeout(wake, 250));
    }
    // A page that started but met an invalid hook call on the way is not trusted either.
    if (ready && !reoptimized()) break;
    if (!reoptimized() || attempt >= 3) {
      throw new Error(`the application did not start (attempt ${attempt}): ${errors.slice(0, 3).join(' | ')}`);
    }
    const why = outdated ? '504 Outdated Optimize Dep' : 'Invalid hook call';
    console.log(`        the development server bundled its dependencies again (${why}); loading the page again`);
  }
  return { context, page, errors };
}

async function scanPanel(page, label) {
  const result = await new AxeBuilder({ page })
    .include('.e68-hw')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious finding in the panel`, serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

/** What the panel shows, read from the DOM (runs in the page). */
function readPanelInPage() {
  const root = document.querySelector('.e68-hw');
  if (!root) return null;
  const all = (selector) => Array.from(root.querySelectorAll(selector));
  const litSegments = (digit) =>
    all(`[data-digit="${digit}"] rect`)
      .filter((r) => r.classList.contains('e68-hw__lamp--on'))
      .map((r) => r.getAttribute('data-segment'))
      .join('');
  return {
    segments: all('rect[data-segment]').length,
    digits: [0, 1, 2, 3, 4, 5, 6, 7].map(litSegments),
    leds: all('circle[data-led]').length,
    ledsOn: all('circle[data-led]')
      .filter((c) => c.classList.contains('e68-hw__lamp--on'))
      .map((c) => Number(c.getAttribute('data-led'))),
    bitLabels: all('.e68-hw__device--switches .e68-hw__bit').map((e) => e.textContent),
    switches: all('[data-switch]').map((e) => e.getAttribute('aria-checked')),
    pushButtons: all('[data-pb]').length,
    addresses: all('input[data-hw-address]').map((e) => e.value),
    prefixes: all('.e68-hw__address .e68-masked__prefix').map((e) => e.textContent),
    addressLabels: all('.e68-hw__address .e68-field-label__text').map((e) => e.textContent),
    irq: all('[data-irq]').map((e) => `${e.getAttribute('data-irq')}${e.disabled ? 'd' : ''}`),
    reset: all('button[aria-label="Reset"]').map((e) => (e.disabled ? 'disabled' : 'enabled')),
    autoChecks: all('input[data-auto]').map((e) => e.checked),
    autoLabel: root.querySelector('[data-hw-auto-label]')?.textContent ?? null,
    interval: root.querySelector('input[data-hw-interval]')?.value ?? null,
    level: root.querySelector('select[data-hw-level]')?.value ?? null,
    levelOptions: all('select[data-hw-level] option').map((o) => o.textContent),
    legends: all('legend').map((e) => e.textContent),
    mapChecks: all('input[data-map]').length,
    mapFields: all('input[data-map-start], input[data-map-end]').map((e) => e.value),
    mapLabels: all('.e68-hw__map .e68-checkbox, .e68-hw__map label').map((e) => e.textContent.trim()),
    notes: all('.e68-hw__note').map((e) => e.textContent),
    heads: all('.e68-hw__map-head').map((e) => e.textContent),
    units: all('.e68-hw__unit').map((e) => e.textContent),
    invalid: all('input[data-hw-address]').map((e) => e.getAttribute('aria-invalid') === 'true'),
  };
}

const readPanel = (page) => page.evaluate(readPanelInPage);

/** Makes readPanelInPage callable inside waitForFunction as window.__hwRead. */
const installReader = (page) => page.evaluate(`window.__hwRead = ${readPanelInPage.toString()};`);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Screenshots of the panel: its upper part and, scrolled into view, the Memory Map group. */
async function shoot(page, base) {
  await page.locator('.e68-hw__devices').scrollIntoViewIfNeeded();
  await screenshot(page.locator('.e68-hw'), `${base}.png`);
  await page.locator('.e68-hw__group--map').scrollIntoViewIfNeeded();
  await screenshot(page.locator('.e68-hw__group--map'), `${base}-map.png`);
}

/**
 * One screenshot, tried twice. A screenshot is a record for a person, not a check: on a loaded
 * machine WebKit once timed out taking one (locator.screenshot: Timeout 30000ms exceeded) while
 * every check of the panel passed. A screenshot that fails twice is printed, not counted; what the
 * panel shows is checked from the DOM.
 */
async function screenshot(locator, file) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await locator.screenshot({ path: join(outDir, file), timeout: WAIT });
      return;
    } catch (error) {
      console.log(`        screenshot ${file} not taken (attempt ${attempt}): ${firstLine(String(error))}`);
    }
  }
}

/** Part 1: the panel in the application as it starts, before any program. */
async function shellPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  await page.locator('.e68-modeswitch [data-mode="simulator"]').click();
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.hardware'));
  const shown = await page.waitForSelector('.e68-hw', { timeout: WAIT }).then(
    () => true,
    () => false,
  );
  check(`${p} View > Hardware shows the Hardware panel`, shown);
  const panel = await readPanel(page);
  if (!panel) {
    await context.close();
    return;
  }
  check(`${p} 8 digits of 8 segments`, panel.segments === 64, `${panel.segments}`);
  check(`${p} 8 LEDs`, panel.leds === 8, `${panel.leds}`);
  check(
    `${p} bit labels 7..0`,
    same(panel.bitLabels, ['7', '6', '5', '4', '3', '2', '1', '0']),
    panel.bitLabels.join(),
  );
  check(`${p} 8 toggle switches, all off`, same(panel.switches, new Array(8).fill('false')), panel.switches.join());
  check(`${p} 8 push buttons`, panel.pushButtons === 8);
  check(
    `${p} four address fields 00 + E00000, E00010, E00012, E00014 labelled Address:`,
    same(panel.addresses, ['E00000', 'E00010', 'E00012', 'E00014']) &&
      same(panel.prefixes, ['00', '00', '00', '00']) &&
      same(panel.addressLabels, ['Address:', 'Address:', 'Address:', 'Address:']),
    `${panel.addresses.join()} ${panel.prefixes.join()} ${panel.addressLabels.join()}`,
  );
  check(
    `${p} IRQ buttons 7..1 and Reset`,
    same(panel.irq, ['7', '6', '5', '4', '3', '2', '1']) && same(panel.reset, ['enabled']),
    `${panel.irq.join()} ${panel.reset.join()}`,
  );
  check(`${p} 7 automatic check boxes`, panel.autoChecks.length === 7);
  check(`${p} Automatic label`, /^Automatic/.test(panel.autoLabel ?? ''), `${panel.autoLabel}`);
  check(
    `${p} interval field and level list`,
    panel.interval === '00001000' &&
      same(panel.levelOptions, ['1', '2', '3', '4', '5', '6', '7', '']) &&
      same(panel.units, ['mS', ' IRQ']),
    `${panel.interval} ${panel.levelOptions.join('|')} ${JSON.stringify(panel.units)}`,
  );
  check(
    `${p} groups " Interrupt ", Auto Interval, Reset, Memory Map`,
    same(panel.legends, [' Interrupt ', 'Auto Interval', 'Reset', 'Memory Map']),
    JSON.stringify(panel.legends),
  );
  check(
    `${p} Memory Map: 4 check boxes, 8 fields 000000, Start:/End:, the four notes`,
    panel.mapChecks === 4 &&
      same(panel.mapFields, new Array(8).fill('000000')) &&
      same(panel.heads, ['Start:', 'End:']) &&
      same(panel.notes, ['Writes are ignored', 'Bus error on write', 'Supervisor access', 'Bus error on access']),
    `${panel.mapChecks} ${panel.mapFields.join()} ${panel.notes.join('|')}`,
  );
  await shoot(page, `${name}-light-startup`);
  await scanPanel(page, `${name} light`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await shoot(page, `${name}-dark-startup`);
  await scanPanel(page, `${name} dark`);
  reportErrors(p, errors);
  await context.close();
}

/** The programs of part 2, assembled under Node by the real assembler (engine/asm/asm68k.mjs). */
const SOURCES = {
  display: [
    '        ORG     $1000',
    'START   MOVE.B  #$3F,$E00000',
    '        MOVE.B  #$A5,$E00010',
    'LOOP    BRA     LOOP',
    '        END     START',
  ],
  halt: ['        ORG     $1000', 'START   NOP', '        SIMHALT', '        END     START'],
};

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

/**
 * Writes the programs into the browser store, switches to Simulator mode and waits until the
 * application's own simulator session (features/run, SH8) has fetched and started its engine.
 */
async function prepare(page, programs) {
  await page.evaluate(async (files) => {
    const { ctx } = window.__easy68k;
    for (const [name, program] of Object.entries(files)) {
      await ctx.vfs.writeFile(`/browser/hwcheck/${name}.S68`, Uint8Array.from(program.s68));
      await ctx.vfs.writeFile(`/browser/hwcheck/${name}.L68`, Uint8Array.from(program.l68));
    }
    await ctx.commands.run('app.mode.set', 'simulator');
  }, programs);
  await page.waitForFunction(
    () => {
      const { ctx } = window.__easy68k;
      return ctx.store.getState().sim.phase === 'idle' && ctx.sim.engine.state().hardwareEnabled;
    },
    undefined,
    { timeout: LOAD_TIMEOUT },
  );
}

/** File > Open of a program written by `prepare`, through the session's run controller; waits for the end of the load. */
async function openProgram(page, name) {
  await page.evaluate((file) => window.__easy68k.ctx.sim.controller.open(`/browser/hwcheck/${file}.S68`, 'open'), name);
  return until(
    page,
    (file) => {
      const sim = window.__easy68k.ctx.store.getState().sim;
      return sim.phase === 'idle' && sim.program?.path === `/browser/hwcheck/${file}.S68`;
    },
    name,
  );
}

/** A byte of the current engine's memory. */
const byte = (page, address) => page.evaluate((a) => window.__easy68k.ctx.sim.engine.memory[a], address);

/** Writes bytes through the run controller's queue, as the Memory panel's Copy and Fill do (no host call). */
const writeBytes = (page, address, bytes) =>
  page.evaluate(
    ([a, b]) => window.__easy68k.ctx.sim.controller.invoke((engine) => engine.writeBytes(a, b)),
    [address, bytes],
  );

/** Shows or hides the panel as the shell does (state/panels.ts). */
const setPanel = (page, visible) =>
  page.evaluate(async (show) => {
    const panels = await import('/src/state/panels.ts');
    const { ctx } = window.__easy68k;
    if (show) panels.showPanel(ctx, 'hardware', { focus: false });
    else panels.hidePanel(ctx, 'hardware');
  }, visible);

/** Part 2: the panel on the application's real simulator session. */
async function enginePass(browser, name, programs) {
  const p = `${name} (real engine):`;
  const { context, page, errors } = await openApp(browser);
  await prepare(page, programs);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.hardware'));
  await page.waitForSelector('.e68-hw', { timeout: WAIT });
  await installReader(page);
  check(
    `${p} the session's HardwareModel is the engine's host part`,
    await page.evaluate(() => {
      const { sim } = window.__easy68k.ctx;
      return typeof sim.hardware.view === 'function' && sim.hardware.view(sim.engine).controls !== undefined;
    }),
  );
  check(
    `${p} the engine's form is visible after the panel was shown`,
    await until(page, () => window.__easy68k.ctx.sim.engine.hardware().visible),
  );

  check(`${p} File > Open loads the display program`, await openProgram(page, 'display'));
  const lit = await untilPanel(
    page,
    (panel) => panel.digits.every((d) => d === 'abcdefgh') && panel.ledsOn.length === 8,
  );
  let panel = await readPanel(page);
  check(
    `${p} after a load all segments and LEDs are lit (memory $FF)`,
    lit,
    `${panel.digits.join(' ')} ${panel.ledsOn.join()}`,
  );

  await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
  await untilPanel(page, (panel) => panel.digits[0] === 'abcdef' && panel.ledsOn.join() === '7,5,2,0');
  panel = await readPanel(page);
  check(`${p} MOVE.B #$3F,$E00000 shows "0" on the leftmost digit`, panel.digits[0] === 'abcdef', panel.digits[0]);
  check(`${p} MOVE.B #$A5,$E00010 lights LEDs 7, 5, 2, 0`, same(panel.ledsOn, [7, 5, 2, 0]), panel.ledsOn.join());
  check(
    `${p} Run: Automatic Enabled`,
    await untilPanel(page, (panel) => panel.autoLabel === 'Automatic Enabled'),
    `${(await readPanel(page)).autoLabel}`,
  );

  await writeBytes(page, 0xe00000, [0x06]);
  check(
    `${p} a write without a host call repaints the panel (writeBytes)`,
    await untilPanel(page, (panel) => panel.digits[0] === 'bc'),
    (await readPanel(page)).digits[0],
  );

  await page.locator('[data-switch="3"]').click();
  const switched = await until(page, () => window.__easy68k.ctx.sim.engine.memory[0xe00012] === 0x08);
  const drawn = await untilPanel(page, (panel) => panel.switches[4] === 'true');
  panel = await readPanel(page);
  check(
    `${p} clicking switch 3 sets bit 3 and draws it on`,
    switched && drawn,
    `${(await byte(page, 0xe00012)).toString(16)} ${panel.switches.join()}`,
  );

  const pushByteIs = (wanted) => window.__easy68k.ctx.sim.engine.memory[0xe00014] === wanted;
  await page.locator('[data-pb="2"]').hover();
  await page.mouse.down();
  const held = await until(page, pushByteIs, 0xfb);
  const heldValue = await byte(page, 0xe00014);
  await page.mouse.up();
  const released = await until(page, pushByteIs, 0xff);
  check(
    `${p} holding push button 2 reads $FB, releasing $FF`,
    held && released,
    `${heldValue} ${await byte(page, 0xe00014)}`,
  );

  await page.evaluate(() => {
    window.__lastPointer = null;
    document.addEventListener('pointerdown', (event) => (window.__lastPointer = event.pointerId), true);
  });
  await page.locator('[data-pb="4"]').hover();
  await page.mouse.down();
  const heldCancel = await until(page, pushByteIs, 0xef);
  const heldCancelValue = await byte(page, 0xe00014);
  await page.evaluate(() => {
    const button = document.querySelector('[data-pb="4"]');
    button.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__lastPointer ?? 1, bubbles: true }));
  });
  const afterCancel = await until(page, pushByteIs, 0xff);
  const afterCancelValue = await byte(page, 0xe00014);
  await page.mouse.up();
  check(
    `${p} pointer cancel releases a held push button`,
    heldCancel && afterCancel,
    `${heldCancelValue} ${afterCancelValue}`,
  );

  // Conflict colouring: put the LEDs onto the switch byte.
  const led = page.locator('input[data-hw-address="1"]');
  await led.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('E00012');
  await untilPanel(page, (panel) => panel.invalid.join() === 'false,true,true,false');
  panel = await readPanel(page);
  const colours = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.e68-hw input[data-hw-address]'));
    const probe = document.createElement('span');
    probe.style.color = 'var(--c-danger)';
    document.querySelector('.e68-hw').appendChild(probe);
    const danger = getComputedStyle(probe).color;
    probe.remove();
    return { danger, fields: inputs.map((input) => getComputedStyle(input).color) };
  });
  check(
    `${p} typing E00012 into the LED address colours the LED and switch fields red`,
    panel.addresses[1] === 'E00012' &&
      same(panel.invalid, [false, true, true, false]) &&
      colours.fields[1] === colours.danger &&
      colours.fields[2] === colours.danger &&
      colours.fields[0] !== colours.danger,
    `${panel.addresses.join()} ${panel.invalid.join()} ${colours.fields.join(' / ')} danger ${colours.danger}`,
  );
  check(
    `${p} the engine took the address`,
    await until(page, () => window.__easy68k.ctx.sim.engine.hardware().led === 0xe00012),
  );
  await shoot(page, `${name}-light-conflict`);
  await page.keyboard.press('Home');
  await page.keyboard.type('E00010');
  check(
    `${p} fixing the address clears the colours`,
    await untilPanel(page, (panel) => panel.invalid.every((invalid) => !invalid)),
    (await readPanel(page)).invalid.join(),
  );

  // Showing the panel: switch byte $00, pictures kept.
  await setPanel(page, false);
  await until(page, () => !window.__easy68k.ctx.sim.engine.hardware().visible);
  await writeBytes(page, 0xe00012, [0x5a]);
  await until(page, () => window.__easy68k.ctx.sim.engine.memory[0xe00012] === 0x5a);
  await setPanel(page, true);
  await page.waitForSelector('.e68-hw', { timeout: WAIT });
  const zeroed = await until(page, () => window.__easy68k.ctx.sim.engine.memory[0xe00012] === 0);
  const kept = await untilPanel(page, (panel) => panel.switches[4] === 'true');
  check(
    `${p} showing the panel zeroes the switch byte and keeps the switch pictures`,
    zeroed && kept,
    `${await byte(page, 0xe00012)} ${(await readPanel(page)).switches.join()}`,
  );

  // Auto interval through the panel: level 1 is selected, check box 1, interval 500.
  // A real click on the check box itself (the kit's Checkbox lets pointer events reach its input).
  await page.locator('input[data-auto="1"]').check({ timeout: WAIT });
  const interval = page.locator('input[data-hw-interval]');
  await interval.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('00000500');
  const armed = await until(page, () => {
    const auto = window.__easy68k.ctx.sim.engine.hardware().auto[1];
    return auto.checked && auto.intervalMs === 500 && auto.timerEnabled;
  });
  check(
    `${p} check box 1 and interval 500 reach the engine; the timer runs during the run`,
    armed,
    JSON.stringify(await page.evaluate(() => window.__easy68k.ctx.sim.engine.hardware().auto[1])),
  );

  await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());
  check(
    `${p} Pause: Automatic Disabled`,
    await untilPanel(page, (panel) => panel.autoLabel === 'Automatic Disabled'),
    `${(await readPanel(page)).autoLabel}`,
  );

  check(`${p} File > Open loads the SIMHALT program`, await openProgram(page, 'halt'));
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
  await until(page, () => {
    const sim = window.__easy68k.ctx.store.getState().sim;
    return sim.phase === 'idle' && sim.halted;
  });
  check(
    `${p} after SIMHALT the IRQ and Reset buttons are disabled`,
    await untilPanel(
      page,
      (panel) => panel.irq.every((entry) => entry.endsWith('d')) && panel.reset.join() === 'disabled',
    ),
    `${(await readPanel(page)).irq.join()} ${(await readPanel(page)).reset.join()}`,
  );
  await shoot(page, `${name}-light-halted`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await shoot(page, `${name}-dark-halted`);
  await scanPanel(page, `${name} dark, real engine`);
  reportErrors(p, errors);
  await context.close();
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // A dependency cache of its own (see the header): checks running at the same time must not
    // re-bundle each other's dependencies.
    cacheDir: join(outDir, 'vite-cache'),
    // No hot reload: fourteen other packages edit files while this runs, and a reload would
    // remount the panel in the middle of a check.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  // What decides the run, for a CI log.
  console.log(
    `System: ${process.platform} ${process.arch}, Node ${process.version}; engines: ${
      enginesBuilt
        ? 'engine/dist holds both engines'
        : withoutEngines
          ? `left out (--without-engines, --engine-answer ${engineAnswer})`
          : 'engine/dist is missing'
    }; EASY68K_REQUIRE_ENGINES=${process.env.EASY68K_REQUIRE_ENGINES ?? '(not set)'}`,
  );
  const programs = enginesBuilt ? await assemblePrograms() : null;
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        console.log(`\n${name} ${browser.version()}`);
        console.log(`\n[${name}, shell]`);
        await shellPass(browser, name);
        console.log(`\n[${name}, real engine]`);
        if (programs) await enginePass(browser, name, programs);
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
