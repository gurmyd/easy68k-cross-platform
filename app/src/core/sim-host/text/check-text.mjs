// Browser check of the text screen (ARCHITECTURE.md 9.2, SH3 acceptance: "the same text gives the
// same pixels under Node, Chromium and WebKit"; 6.5.3: the text grid is Windows'). Owner: SH3.
//
//   node app/src/core/sim-host/text/check-text.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and runs the same things three times: under
// Node (through the dev server's own module loader), in headless Chromium and in headless WebKit
// (Playwright).
//
//   1. The scenarios of pixel-scenario.ts, each on two sets of parts:
//        - the direct scenario: text screen calls (seven font names, five styles, resampled sizes,
//          wrap, scrolling, a rectangle scroll, graphics text, the prompt);
//        - the engine scenario: a 68000 program on the real simulator engine, with the real
//          OutputDevice and TextScreen as its text and graphics host parts;
//      once with the synthetic fonts on the test surface (the Node run must give the hashes fixed
//      in pixel-scenario.ts), and once with the real drawing surface and the fonts of
//      app/public/fonts, which the browsers fetch from the dev server as the application does.
//   2. The text cases of the GDI capture (tests/conformance/gdi, captured on Windows by T2),
//      replayed by gdi-replay.ts as tasks 21 and 95. Node compares its replays with what Windows
//      drew; each browser must give exactly the pictures and pen positions of the Node run.
//
// It checks that
//
//   - each browser gives exactly the pixels of the Node run, the same shadow array and the same
//     cursor and grid;
//   - a canvas that received the pixels with putImageData gives them back with getImageData
//     unchanged (what the Output panel does with them);
//   - the raster-face cases (suite text) equal Windows pixel for pixel and pen for pen, the
//     outline-face cases in their cell rectangles and pen positions; the numbers of the suite of
//     machine-dependent strings (text-control) are printed and not required;
//   - the page had no console or page error.
//
// The page is a blank one of the script's own (not the application), so the check does not depend
// on the state of any other package. The dev server has a cache of its own, takes the port the
// system gives it and does not watch files, so several checks can run on one machine and a file
// saved elsewhere does not reload the page. Nothing in it depends on the operating system: the
// fonts are data files, and the comparisons are of whole numbers. Screenshots of the four canvases
// go to build/text-check (git-ignored); look at them. Exit code 0 = everything passed. It needs
// engine/dist and nothing but the pinned development dependencies.

/* global console, process, document, fetch, ImageData, URL -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const repoRoot = resolve(appRoot, '..');
const fontsDir = join(appRoot, 'public', 'fonts');
const gdiDir = join(repoRoot, 'tests', 'conformance', 'gdi');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'text-check')));
mkdirSync(outDir, { recursive: true });
// The dev server's cache: a folder of this run alone (several checks may run on one machine at the
// same time), outside the screenshots folder, removed at the end.
const cacheDir = join(repoRoot, 'build', 'text-check-cache', String(process.pid));

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const SCENARIO_MODULE = '/src/core/sim-host/text/pixel-scenario.ts';
const REPLAY_MODULE = '/src/core/sim-host/text/gdi-replay.ts';
const PROVIDER_MODULE = '/src/core/sim-host/fonts/atlas-provider.ts';
const ENGINE_TESTING_MODULE = '/src/engine/testing.ts';

/** The four runs of a scenario: [name, what it is in words]. The name is also the canvas id. */
const RUNS = [
  ['direct', 'the direct scenario, synthetic fonts'],
  ['engine', 'the engine scenario, synthetic fonts'],
  ['real-direct', 'the direct scenario, real surface and fonts'],
  ['real-engine', 'the engine scenario, real surface and fonts'],
];
/** The text suites of the GDI capture. */
const SUITES = ['text', 'text-outline', 'text-outline-glyphs', 'text-control'];

const PAGE_PATH = '__check-text.html';
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>check-text</title>
<style>body { margin: 8px; background: #404040; color: #fff; font: 12px sans-serif } canvas { display: block; image-rendering: pixelated; margin-bottom: 8px }</style>
</head>
<body>${RUNS.map(([name, words]) => `<div>${words}</div><canvas id="${name}"></canvas>`).join('')}</body>
</html>`;

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

/** The references of the text suites: each case of tests/conformance/gdi/cases.ts with GDI's picture and pen. */
async function loadReferences() {
  // The two modules have no imports and only erasable types, so Node loads them as they are.
  const { generateCases } = await import(pathToFileURL(join(gdiDir, 'cases.ts')).href);
  const { decodePack, decodePix } = await import(pathToFileURL(join(gdiDir, 'pix.ts')).href);
  const byId = new Map(generateCases().map((c) => [c.id, c]));
  const references = {};
  for (const suite of SUITES) {
    const pack = decodePack(new Uint8Array(readFileSync(join(gdiDir, 'golden', `${suite}.pixpack.gz`))));
    references[suite] = pack.cases.map((packed) => {
      const c = byId.get(packed.id);
      if (!c) throw new Error(`${suite}: the reference ${packed.id} has no case in cases.ts`);
      return { case: c, image: decodePix(packed.pix), pen: packed.pen };
    });
  }
  return references;
}

/**
 * Runs everything in the page: loads the fonts with fetch, runs the four scenarios, shows them in
 * the four canvases and reads the canvases back, and replays the GDI cases.
 */
async function runInPage(page, s68, suites) {
  return page.evaluate(
    async ({ modules, program, runs, suites }) => {
      const scenario = await import(/* @vite-ignore */ modules.scenario);
      const replay = await import(/* @vite-ignore */ modules.replay);
      const provider = await import(/* @vite-ignore */ modules.provider);
      const helpers = await import(/* @vite-ignore */ modules.engineTesting);

      // The fonts, as the application loads them: a fetch relative to the page.
      const asked = new Set();
      const fonts = new provider.AtlasGlyphProvider(async (path) => {
        asked.add(path);
        const response = await fetch(new URL(`fonts/${path}`, document.baseURI));
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      });
      await fonts.ready;

      const s68 = Uint8Array.from(program);
      const run = {
        direct: () => scenario.runDirectScenario(),
        engine: () => scenario.runEngineScenario(helpers, s68),
        'real-direct': () => scenario.runDirectScenario(scenario.realParts(fonts)),
        'real-engine': () => scenario.runEngineScenario(helpers, s68, scenario.realParts(fonts)),
      };
      const scenarios = {};
      for (const name of runs) {
        const result = await run[name]();
        const canvas = document.getElementById(name);
        canvas.width = result.width;
        canvas.height = result.height;
        const context = canvas.getContext('2d');
        // The pixel array is the ImageData's byte order already (3.4): no conversion.
        const bytes = new Uint8ClampedArray(result.screen.buffer, result.screen.byteOffset, result.screen.byteLength);
        context.putImageData(new ImageData(bytes, result.width, result.height), 0, 0);
        const readBack = context.getImageData(0, 0, result.width, result.height).data;
        scenarios[name] = {
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

      const digests = {};
      for (const [suite, cases] of Object.entries(suites)) digests[suite] = replay.digestReplays(cases, fonts);
      return { fonts: { problems: [...fonts.problems], files: asked.size }, scenarios, digests };
    },
    {
      modules: {
        scenario: SCENARIO_MODULE,
        replay: REPLAY_MODULE,
        provider: PROVIDER_MODULE,
        engineTesting: ENGINE_TESTING_MODULE,
      },
      program: Array.from(s68),
      runs: RUNS.map(([name]) => name),
      suites,
    },
  );
}

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir,
    // Port 0: the system picks a free one. No file watching and no hot reload: a file saved
    // elsewhere in the tree must not reload the page in the middle of the check.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    plugins: [blankPage()],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Dev server: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    // ---- Node: the reference ----
    console.log('\n[node]');
    const scenario = await server.ssrLoadModule(SCENARIO_MODULE);
    const replay = await server.ssrLoadModule(REPLAY_MODULE);
    const provider = await server.ssrLoadModule(PROVIDER_MODULE);
    const helpers = await server.ssrLoadModule(ENGINE_TESTING_MODULE);
    const program = await helpers.assembleProgram(scenario.PIXEL_PROGRAM);

    // The fonts of app/public/fonts through the application's provider, read from the folder.
    const asked = new Set();
    const fonts = new provider.AtlasGlyphProvider(async (path) => {
      asked.add(path);
      try {
        return new Uint8Array(await readFile(join(fontsDir, path)));
      } catch {
        return null;
      }
    });
    await fonts.ready;
    check(
      'node: the fonts of app/public/fonts load without a problem',
      fonts.problems.length === 0 && asked.size > 100,
      `${asked.size} files${fonts.problems.length ? `; ${fonts.problems.slice(0, 3).join(' | ')}` : ''}`,
    );

    const node = {
      direct: scenario.runDirectScenario(),
      engine: await scenario.runEngineScenario(helpers, program.s68),
      'real-direct': scenario.runDirectScenario(scenario.realParts(fonts)),
      'real-engine': await scenario.runEngineScenario(helpers, program.s68, scenario.realParts(fonts)),
    };
    for (const name of ['direct', 'engine']) {
      const expected = scenario.EXPECTED_HASHES[name];
      const actual = { screen: node[name].screenHash, back: node[name].backHash };
      check(`node: the ${name} scenario gives the fixed pixels`, same(actual, expected), JSON.stringify(actual));
    }
    for (const [name, words] of RUNS) {
      const ink = node[name].screen.reduce((count, pixel) => count + (pixel !== 0xff000000 ? 1 : 0), 0);
      check(`node: ${words}: something was drawn`, ink > 10000, `${ink} pixels are not black`);
    }

    // ---- Node against Windows: the text cases of the GDI capture ----
    console.log('\n[node against the GDI capture]');
    const references = await loadReferences();
    const outlineIndex = JSON.parse(readFileSync(join(fontsDir, 'scalable', 'index.json'), 'utf8'));
    // Point sizes at which the proportional substitute has Windows' own letter widths: the sizes
    // of its atlases, and 0, whose cell is the cell of 12 points.
    const measuredSizes = new Set([0, ...outlineIndex.atlases.filter((a) => a.face === 'Arial').map((a) => a.size)]);
    const fontOf = (reference) => replay.fontOfCase(reference.case);
    const outline = references['text-outline'];
    const groups = [
      ['text: raster faces, every pixel and the pen position', references.text, 'pixels', true],
      [
        'text-outline: Courier New, Lucida Console, Consolas, cell rectangles and pen positions',
        outline.filter((r) => !replay.isProportionalName(fontOf(r).name)),
        'cells',
        true,
      ],
      [
        'text-outline: the proportional substitute at the sizes that have an atlas, cell rectangles and pen positions',
        outline.filter((r) => replay.isProportionalName(fontOf(r).name) && measuredSizes.has(fontOf(r).size)),
        'cells',
        true,
      ],
      [
        'text-outline: the proportional substitute at sizes without an atlas, pen positions (letter widths are estimated; reported, not required)',
        outline.filter((r) => replay.isProportionalName(fontOf(r).name) && !measuredSizes.has(fontOf(r).size)),
        'pens',
        false,
      ],
      [
        'text-outline-glyphs: outline faces with visible glyphs, pen positions',
        references['text-outline-glyphs'],
        'pens',
        true,
      ],
      [
        'text-control: strings Windows draws from a fallback font (machine-dependent; reported, not required)',
        references['text-control'],
        'pixels',
        false,
      ],
    ];
    for (const [name, cases, how, required] of groups) {
      const score = replay.scoreReplays(cases, fonts, how);
      const numbers =
        how === 'pens'
          ? `pen equal in ${score.pensEqual} of ${score.cases} cases`
          : `${score.equal} of ${score.cases} cases equal (pictures ${score.picturesEqual}, pens ${score.pensEqual})`;
      const first = required && score.differences.length ? `; first: ${score.differences[0]}` : '';
      check(`node: ${name}`, (!required || score.equal === score.cases) && score.cases > 0, numbers + first);
    }
    const suites = Object.fromEntries(SUITES.map((suite) => [suite, references[suite].map((r) => r.case)]));
    const digests = Object.fromEntries(SUITES.map((suite) => [suite, replay.digestReplays(suites[suite], fonts)]));

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

        const inPage = await runInPage(page, program.s68, suites);
        check(
          `${browserName}: the fonts load with fetch without a problem, the same files as under Node`,
          inPage.fonts.problems.length === 0 && inPage.fonts.files === asked.size,
          `${inPage.fonts.files} files${inPage.fonts.problems.length ? `; ${inPage.fonts.problems.slice(0, 3).join(' | ')}` : ''}`,
        );
        for (const [name, words] of RUNS) {
          const expected = summary(node[name]);
          const actual = summary(inPage.scenarios[name]);
          check(
            `${browserName}: ${words}: the pixels of the Node run`,
            actual.screen === expected.screen && actual.back === expected.back && same(actual.size, expected.size),
            `screen ${actual.screen}, back buffer ${actual.back}`,
          );
          check(`${browserName}: ${words}: the shadow array of the Node run`, same(actual.rows, expected.rows));
          check(
            `${browserName}: ${words}: the cursor and grid of the Node run`,
            same(actual.state, expected.state),
            JSON.stringify(actual.state),
          );
          check(
            `${browserName}: ${words}: a canvas gives the pixels back unchanged (putImageData, getImageData)`,
            inPage.scenarios[name].canvasHash === expected.screen,
            inPage.scenarios[name].canvasHash,
          );
          await page.locator(`#${name}`).screenshot({ path: join(outDir, `${browserName}-${name}.png`) });
        }
        for (const suite of SUITES) {
          check(
            `${browserName}: the ${suites[suite].length} cases of ${suite} give the pictures and pen positions of the Node run`,
            inPage.digests[suite] === digests[suite],
            inPage.digests[suite],
          );
        }
        check(`${browserName}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
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
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
