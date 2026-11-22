// Browser check of the feature desktop-devices (ARCHITECTURE.md 3.3.4, 9.6 DV4). Owner: DV4.
//
//   node app/src/features/desktop-devices/check-desktop-devices.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// The serial ports and the network exist in the desktop app only. This check proves that the web
// build still gives a 68000 program the values of note 37 of 1.4 (the original's own "not
// available" results): it starts the Vite dev server of app/ on a free port, opens the real
// application in headless Chromium and WebKit (Playwright), and in each
//
//   - checks that the platform offers no serial and no network device (Platform.serial and
//     Platform.net are null), so that the simulator uses NullSerial and NullNet;
//   - assembles, loads and runs a program that calls every serial and network task once
//     (testing/programs.ts noteThirtySevenProgram) and compares D0 of every call with note 37:
//     task 40 = 2, tasks 41-43 = 3, tasks 100 and 101 = $276B0002, 102 and 106 = $276D0001,
//     103 and 107 = 0 with 0 bytes, 104 and 105 = $276D0001;
//   - checks that the run left no error in the console.
//
// Every value is printed. A screenshot of the Simulator mode after the run goes to
// build/DV4/desktop-devices-check (git-ignored). Exit code 0 = everything passed.
//
// Needs engine/dist (both engines): the program is assembled by the real assembler. Without it the
// script says so and does nothing; with EASY68K_REQUIRE_ENGINES=1 (CI) that is a failure. Nothing
// here depends on the operating system or on the machine's speed: every wait is for a state.

/* global console, process, window */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'DV4', 'desktop-devices-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
if (browsers.some((name) => !(name in BROWSERS))) {
  console.error(`--browser must be chromium, webkit or all, not ${browserChoice}`);
  process.exit(2);
}

const LOAD_TIMEOUT = 120_000;
const enginesPresent = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(join(repoRoot, 'engine', 'dist', file)),
);
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const hex = (n) => `$${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

async function browserPass(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
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
    await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, {
      timeout: LOAD_TIMEOUT,
    });

    const platform = await page.evaluate(() => {
      const { platform } = window.__easy68k.ctx;
      return { kind: platform.kind, serial: platform.serial, net: platform.net };
    });
    check(
      `${name}: the web platform has no serial and no network device`,
      platform.kind === 'web' && platform.serial === null && platform.net === null,
      JSON.stringify(platform),
    );

    // Assemble and run the program in the page, as File > Open and Run do.
    const run = await page.evaluate(async () => {
      const [engine, programs] = await Promise.all([
        import(String('/src/engine/testing.ts')),
        import(String('/src/features/desktop-devices/testing/programs.ts')),
      ]);
      const { ctx } = window.__easy68k;
      await ctx.commands.run('app.mode.set', 'simulator');
      const program = programs.noteThirtySevenProgram();
      const { s68, l68 } = await engine.assembleProgram(program.source);
      const path = `/browser/dv4-check/note37-${Date.now()}.S68`;
      await ctx.vfs.writeFile(path, s68);
      await ctx.vfs.writeFile(path.replace(/S68$/, 'L68'), l68);
      await ctx.sim.controller.open(path, 'open', { confirmed: true });
      ctx.sim.controller.run();
      return { slots: program.slots, expected: programs.NOTE_37, done: programs.DONE };
    });
    await page.waitForFunction((done) => window.__easy68k.ctx.sim.engine.readLong(done) >>> 0 === 1, run.done, {
      timeout: LOAD_TIMEOUT,
    });
    const got = await page.evaluate((slots) => {
      const engine = window.__easy68k.ctx.sim.engine;
      return Object.fromEntries(
        Object.entries(slots).map(([slot, at]) => [
          slot,
          { d0: engine.readLong(at) >>> 0, d1: engine.readLong(at + 4) >>> 0 },
        ]),
      );
    }, run.slots);
    for (const [slot, value] of Object.entries(run.expected)) {
      const actual = got[slot]?.d0;
      check(
        `${name}: ${slot} gives D0 = ${hex(value)}`,
        actual === value,
        `D0 = ${hex(actual ?? 0)}, D1 = ${hex(got[slot]?.d1 ?? 0)}`,
      );
    }
    check(
      `${name}: tasks 103 and 107 report 0 bytes`,
      got.receive?.d1 === 0 && got.receivePort?.d1 === 0,
      `D1 = ${hex(got.receive?.d1 ?? -1)}, ${hex(got.receivePort?.d1 ?? -1)}`,
    );
    const screenshot = join(outDir, `${name}-note37.png`);
    await page.screenshot({ path: screenshot });
    console.log(`        screenshot: ${screenshot}`);
    check(`${name}: no console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
  } finally {
    await context.close();
  }
}

async function main() {
  if (!enginesPresent) {
    if (enginesRequired) {
      console.error('engine/dist is missing and EASY68K_REQUIRE_ENGINES=1: the check needs both engines.');
      process.exit(1);
    }
    console.log('engine/dist is missing: nothing to check (build or fetch the engines first).');
    process.exit(0);
  }
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
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      console.log(`\n[${name}]`);
      const browser = await BROWSERS[name].launch();
      try {
        await browserPass(browser, name);
      } catch (error) {
        check(
          `${name}: the pass ran to the end`,
          false,
          String(error?.stack ?? error)
            .split('\n')
            .slice(0, 4)
            .join(' | '),
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
