// Browser check of the text screen (ARCHITECTURE.md 9.2, SH3 acceptance: "the same text gives the
// same pixels under Node, Chromium and WebKit"). Owner: SH3.
//
//   node app/src/core/sim-host/text/check-text.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port. It then runs the two scenarios of
// pixel-scenario.ts three times: under Node (through the dev server's own module loader), in
// headless Chromium and in headless WebKit (Playwright):
//
//   - the direct scenario: text screen calls with the synthetic fonts (seven font names, five
//     styles, resampled sizes, wrap, scrolling, a rectangle scroll, graphics text, the prompt);
//   - the engine scenario: a 68000 program on the real simulator engine, with the real
//     OutputDevice and TextScreen as its text and graphics host parts.
//
// It checks that
//
//   - the Node run gives the hashes fixed in pixel-scenario.ts (EXPECTED_HASHES);
//   - each browser gives exactly the pixels of the Node run, the same shadow array and the same
//     cursor and grid;
//   - a canvas that received the pixels with putImageData gives them back with getImageData
//     unchanged (what the Output panel will do with them);
//   - the page had no console or page error.
//
// The page is a blank one of the script's own (not the application), so the check does not depend
// on the state of any other package. Screenshots of the two canvases go to build/text-check
// (git-ignored); look at them. Exit code 0 = everything passed. It needs nothing but the pinned
// development dependencies.

/* global console, process, document, ImageData -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'text-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const SCENARIO_MODULE = '/src/core/sim-host/text/pixel-scenario.ts';
const ENGINE_TESTING_MODULE = '/src/engine/testing.ts';
const PAGE_PATH = '__check-text.html';
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>check-text</title>
<style>body { margin: 8px; background: #404040; color: #fff; font: 12px sans-serif } canvas { display: block; image-rendering: pixelated; margin-bottom: 8px }</style>
</head>
<body><div>direct scenario</div><canvas id="direct"></canvas><div>engine scenario</div><canvas id="engine"></canvas></body>
</html>`;

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A port nobody listens on, chosen by the operating system. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

/** A Vite plugin that makes the dev server answer PAGE_PATH with the script's own blank page. */
function blankPage() {
  return {
    name: 'check-text-page',
    configureServer(server) {
      server.middlewares.use(`/${PAGE_PATH}`, (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(PAGE);
      });
    },
  };
}

/** What is compared between the environments: everything of a scenario result but the pixels. */
const summary = (result) => ({
  size: [result.width, result.height],
  screen: result.screenHash,
  back: result.backHash,
  rows: result.rows,
  state: result.state,
});

/** Runs both scenarios in the page, shows them in the two canvases, and reads the canvases back. */
async function runInPage(page, s68) {
  return page.evaluate(
    async ({ scenarioModule, engineTestingModule, program }) => {
      const scenario = await import(/* @vite-ignore */ scenarioModule);
      const helpers = await import(/* @vite-ignore */ engineTestingModule);
      const outcome = {};
      const runs = {
        direct: () => scenario.runDirectScenario(),
        engine: () => scenario.runEngineScenario(helpers, Uint8Array.from(program)),
      };
      for (const [name, run] of Object.entries(runs)) {
        const result = await run();
        const canvas = document.getElementById(name);
        canvas.width = result.width;
        canvas.height = result.height;
        const context = canvas.getContext('2d');
        // The pixel array is the ImageData's byte order already (3.4): no conversion.
        const bytes = new Uint8ClampedArray(result.screen.buffer, result.screen.byteOffset, result.screen.byteLength);
        context.putImageData(new ImageData(bytes, result.width, result.height), 0, 0);
        const readBack = context.getImageData(0, 0, result.width, result.height).data;
        outcome[name] = {
          width: result.width,
          height: result.height,
          screenHash: result.screenHash,
          backHash: result.backHash,
          rows: result.rows,
          state: result.state,
          canvasHash: scenario.hashPixels(
            new Uint32Array(readBack.buffer, readBack.byteOffset, readBack.byteLength / 4),
          ),
        };
      }
      return outcome;
    },
    { scenarioModule: SCENARIO_MODULE, engineTestingModule: ENGINE_TESTING_MODULE, program: Array.from(s68) },
  );
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    server: { port, strictPort: true, host: '127.0.0.1' },
    plugins: [blankPage()],
  });
  await server.listen();
  const baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Dev server: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    // ---- Node: the reference ----
    console.log('\n[node]');
    const scenario = await server.ssrLoadModule(SCENARIO_MODULE);
    const helpers = await server.ssrLoadModule(ENGINE_TESTING_MODULE);
    const program = await helpers.assembleProgram(scenario.PIXEL_PROGRAM);
    const node = {
      direct: scenario.runDirectScenario(),
      engine: await scenario.runEngineScenario(helpers, program.s68),
    };
    for (const name of ['direct', 'engine']) {
      const expected = scenario.EXPECTED_HASHES[name];
      const actual = { screen: node[name].screenHash, back: node[name].backHash };
      check(`node: the ${name} scenario gives the fixed pixels`, same(actual, expected), JSON.stringify(actual));
      const ink = node[name].screen.reduce((count, pixel) => count + (pixel !== 0xff000000 ? 1 : 0), 0);
      check(`node: the ${name} scenario drew something`, ink > 10000, `${ink} pixels are not black`);
    }

    // ---- the browsers ----
    for (const browserName of browsers) {
      console.log(`\n[${browserName}]`);
      const browser = await BROWSERS[browserName].launch();
      try {
        const context = await browser.newContext({ viewport: { width: 700, height: 1040 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(`${baseUrl}${PAGE_PATH}`);

        const inPage = await runInPage(page, program.s68);
        for (const name of ['direct', 'engine']) {
          const expected = summary(node[name]);
          const actual = summary(inPage[name]);
          check(
            `${browserName}: the ${name} scenario has the pixels of the Node run`,
            actual.screen === expected.screen && actual.back === expected.back && same(actual.size, expected.size),
            `screen ${actual.screen}, back buffer ${actual.back}`,
          );
          check(
            `${browserName}: the ${name} scenario has the shadow array of the Node run`,
            same(actual.rows, expected.rows),
          );
          check(
            `${browserName}: the ${name} scenario ends with the cursor and grid of the Node run`,
            same(actual.state, expected.state),
            JSON.stringify(actual.state),
          );
          check(
            `${browserName}: a canvas gives the ${name} pixels back unchanged (putImageData, getImageData)`,
            inPage[name].canvasHash === expected.screen,
            inPage[name].canvasHash,
          );
          await page.locator(`#${name}`).screenshot({ path: join(outDir, `${browserName}-${name}.png`) });
        }
        check(`${browserName}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
        await context.close();
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
