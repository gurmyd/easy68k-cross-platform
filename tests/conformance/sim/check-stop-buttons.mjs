// Browser check of hardware §13 item 21 (ARCHITECTURE.md 6.9 item 2): "STOP with Exc off ... disables
// the IRQ and Reset buttons (dark-maroon look)". Owner: T3. The headless half (the message, the
// model's disabled state, IRQ clicks doing nothing) is checklist.test.ts "item 21"; this script
// checks the look, which only a browser computes:
//
//   node tests/conformance/sim/check-stop-buttons.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright), in the light and the dark theme: a program whose first
// instruction is STOP #$2000 is assembled by the real assembler, written to the browser store and
// opened with the application's own simulator session (exceptions off, the default); the Hardware
// panel is shown. Before Run every IRQ button and Reset are enabled and not dark maroon; after Run
// (the STOP) all eight are disabled and their computed background and border colours are
// rgb(64, 0, 0) (#400000, hardware §1.1 clDrkMaroon, §3.2), in both themes.
//
// Nothing waits a fixed time: every step waits for the state it expects (up to WAIT ms). Nothing
// depends on the operating system. Needs engine/dist (without it every check fails with a message).
// Screenshots go to build/T3/stop-buttons (git-ignored). Prints "N of M checks passed"; exit code 0
// = everything passed and no console error.

/* global document, window, getComputedStyle -- the browser globals are used inside page.evaluate() callbacks */

import { existsSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'T3', 'stop-buttons')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
if (!browsers.every((name) => name in BROWSERS)) {
  console.error(`--browser must be chromium, webkit or all, not ${browserChoice}`);
  process.exit(2);
}

/** #400000, the colour of a disabled IRQ or Reset button (hardware §1.1 clDrkMaroon, §3.2). */
const DARK_MAROON = 'rgb(64, 0, 0)';
/** The development server transforms every module at the first request; on a busy machine that takes a while. */
const LOAD_TIMEOUT = 180_000;
/** How long a step waits for the state it expects. */
const WAIT = 30_000;
const FOLDER = '/browser/t3stop';

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failures++;
  // The details (every button's colours) are long: printed in full for a failure only.
  const shown = ok && detail.length > 120 ? `${detail.slice(0, 117)}...` : detail;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${shown ? ` - ${shown}` : ''}`);
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

/** Waits until `fn(arg)` is true in the page; false instead of an exception when it never is. */
const until = (page, fn, arg, timeout = WAIT) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );

function pretendWindows() {
  Object.defineProperty(window.Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(window.Navigator.prototype, 'userAgentData', { get: () => undefined });
}

/** The test program, assembled under Node by the real assembler (engine/asm/asm68k.mjs). */
async function assembleStop() {
  const { assemble } = await import(pathToFileURL(join(repoRoot, 'engine', 'asm', 'asm68k.mjs')).href);
  const lines = ['        ORG     $1000', 'START   STOP    #$2000', '        SIMHALT', '        END     START'];
  const source = lines.map((line) => `${line}\r\n`).join('');
  const files = new Map([['stop.X68', Uint8Array.from(source, (ch) => ch.charCodeAt(0))]]);
  const result = await assemble('stop.X68', files, {}, new Date(2026, 0, 1));
  if (result.errorCount > 0 || !result.sRecord || !result.listing) {
    throw new Error(`the test program does not assemble: ${result.messages.map((m) => m.text).join('; ')}`);
  }
  return { s68: [...result.sRecord], l68: [...result.listing] };
}

/** The opened application; reloads once or twice when the development server re-bundles (504, two Reacts). */
async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1300 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendWindows);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  let outdated = false;
  page.on('response', (response) => {
    if (response.status() === 504) outdated = true;
  });
  const reoptimized = () => outdated || errors.some((text) => /Invalid hook call/i.test(text));
  for (let attempt = 1; ; attempt++) {
    outdated = false;
    errors.length = 0;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    const ready = await until(
      page,
      () => window.__easy68k !== undefined && document.querySelector('.e68-shell') !== null,
      undefined,
      LOAD_TIMEOUT,
    );
    if (ready && !reoptimized()) break;
    if (!reoptimized() || attempt >= 3) {
      throw new Error(`the application did not start (attempt ${attempt}): ${errors.slice(0, 3).join(' | ')}`);
    }
    console.log('        the development server bundled its dependencies again; loading the page again');
  }
  return { context, page, errors };
}

/** The eight buttons (IRQ 7..1, Reset): disabled flag and computed colours (runs in the page). */
function readButtonsInPage() {
  const buttons = [
    ...Array.from(document.querySelectorAll('.e68-hw [data-irq]')),
    ...Array.from(document.querySelectorAll('.e68-hw button[aria-label="Reset"]')),
  ];
  return buttons.map((button) => {
    const style = getComputedStyle(button);
    return {
      name: button.getAttribute('data-irq') ?? 'Reset',
      disabled: button.disabled,
      background: style.backgroundColor,
      borders: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
    };
  });
}

const describeButtons = (buttons) =>
  buttons.map((b) => `${b.name}${b.disabled ? 'd' : ''} ${b.background} [${b.borders.join(' ')}]`).join('; ');

async function pass(browser, name, program) {
  const { context, page, errors } = await openApp(browser);
  try {
    await page.evaluate(
      async ([folder, files]) => {
        const { ctx } = window.__easy68k;
        await ctx.vfs.writeFile(`${folder}/stop.S68`, Uint8Array.from(files.s68));
        await ctx.vfs.writeFile(`${folder}/stop.L68`, Uint8Array.from(files.l68));
        await ctx.commands.run('app.mode.set', 'simulator');
      },
      [FOLDER, program],
    );
    const started = await until(
      page,
      () => {
        const { ctx } = window.__easy68k;
        return ctx.store.getState().sim.phase === 'idle' && ctx.sim?.engine?.state().hardwareEnabled;
      },
      undefined,
      LOAD_TIMEOUT,
    );
    check(`${name}: the simulator session started`, started);
    if (!started) return;
    const exceptions = await page.evaluate(() => window.__easy68k.ctx.settings.get().sim.exceptions);
    check(`${name}: exceptions are off (the default)`, exceptions === false, `sim.exceptions = ${exceptions}`);
    await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.hardware'));
    await page.waitForSelector('.e68-hw [data-irq]', { timeout: WAIT });
    await page.evaluate((path) => window.__easy68k.ctx.sim.controller.open(path, 'open'), `${FOLDER}/stop.S68`);
    const loaded = await until(
      page,
      (path) => {
        const sim = window.__easy68k.ctx.store.getState().sim;
        return sim.phase === 'idle' && sim.program?.path === path;
      },
      `${FOLDER}/stop.S68`,
    );
    check(`${name}: File > Open loads the STOP program`, loaded);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') {
        // Back to a fresh load for the second theme: the buttons are enabled again.
        await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
        await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
        await page.evaluate((path) => window.__easy68k.ctx.sim.controller.open(path, 'open'), `${FOLDER}/stop.S68`);
      }
      const p = `${name} ${theme}:`;
      const enabled = await until(page, () =>
        Array.from(document.querySelectorAll('.e68-hw [data-irq], .e68-hw button[aria-label="Reset"]')).every(
          (b) => !b.disabled,
        ),
      );
      let buttons = await page.evaluate(readButtonsInPage);
      check(
        `${p} before Run IRQ 7..1 and Reset are enabled and not dark maroon`,
        enabled && buttons.length === 8 && buttons.every((b) => !b.disabled && b.background !== DARK_MAROON),
        describeButtons(buttons),
      );
      await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
      const disabled = await until(page, () => {
        const all = Array.from(document.querySelectorAll('.e68-hw [data-irq], .e68-hw button[aria-label="Reset"]'));
        return all.length === 8 && all.every((b) => b.disabled);
      });
      buttons = await page.evaluate(readButtonsInPage);
      check(`${p} after the STOP all eight buttons are disabled`, disabled, describeButtons(buttons));
      check(
        `${p} a disabled IRQ or Reset button is a flat dark-maroon square: background and borders ${DARK_MAROON}`,
        buttons.length === 8 &&
          buttons.every((b) => b.background === DARK_MAROON && b.borders.every((c) => c === DARK_MAROON)),
        describeButtons(buttons),
      );
      try {
        await page.locator('.e68-hw').screenshot({ path: join(outDir, `${name}-${theme}-stopped.png`), timeout: WAIT });
      } catch (error) {
        console.log(`        screenshot not taken: ${String(error).split('\n')[0]}`);
      }
    }
  } finally {
    check(`${name}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await closeWithin(context);
  }
}

let baseUrl = '';

async function main() {
  const enginesBuilt = ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((file) =>
    existsSync(join(repoRoot, 'engine', 'dist', file)),
  );
  console.log(
    `System: ${process.platform} ${process.arch}, Node ${process.version}; engines: ${
      enginesBuilt ? 'engine/dist holds both engines' : 'engine/dist is missing'
    }`,
  );
  if (!enginesBuilt) {
    check('engine/dist holds both engines', false, 'run npm run build:engines');
    console.log(`\n0 of 1 checks passed, 1 failed.`);
    process.exit(1);
  }
  const program = await assembleStop();
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(outDir, 'vite-cache'),
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        console.log(`\n${name} ${browser.version()}`);
        await pass(browser, name, program);
      } catch (error) {
        check(`${name}: the check ran to its end`, false, String(error?.stack ?? error));
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
