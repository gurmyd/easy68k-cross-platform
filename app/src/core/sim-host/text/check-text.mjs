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
//     outline-face cases in their cell rectangles and pen positions; in the suite text-control the
//     bytes Windows draws from a fallback font ($01-$08 $0B $0E-$1B) equal Windows wherever the two
//     captured Windows agree (pens; pictures where those agree too; erratum T2 25), the other cases
//     of text-control and the suites text-path and text-path-euro (Windows' Unicode text path; gate
//     I3, item 3b) equal Windows pixel for pixel and pen for pen but the smoothed euro sign
//     (erratum T2 26) - for the euro sign where Windows gives its width whatever it drew before
//     (golden/text-path-euro-pens.json; erratum T2 29) - and the numbers of the whole of text-control,
//     of the history-dependent euro texts and of text-path-formfeed ($0C on the text path, not
//     modelled; erratum T2 27) are printed and not required;
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
import { closeAtEnd, closeWithin, doneWith, endChecks } from '../../../../../tests/browser-checks/ending.mjs';

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
const SUITES = [
  'text',
  'text-outline',
  'text-outline-zero',
  'text-outline-glyphs',
  'text-control',
  'text-path',
  'text-path-euro',
  'text-path-formfeed',
];

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
  // The pens of texts with $80 on the path that Windows gives in every history (erratum T2 29).
  const pinned = JSON.parse(readFileSync(join(gdiDir, 'golden', 'text-path-euro-pens.json'), 'utf8'));
  references.euroPens = new Map(
    pinned.cases.map(([face, size, style, hex, pen]) => [`${face}|${size}|${style}|${hex}`, pen]),
  );
  // The same text-control cases as a second Windows drew them (10.0.26100, GitHub's runner; erratum
  // T2 25): for the bytes Windows draws from a fallback font, 6.5.3 holds the port to what both agree on.
  const runner = decodePack(
    new Uint8Array(readFileSync(join(gdiDir, 'golden', 'windows-10.0.26100', 'text-control.pixpack.gz'))),
  );
  references.runner = new Map(
    runner.cases.map((packed) => [packed.id, { image: decodePix(packed.pix), pen: packed.pen }]),
  );
  return references;
}

/** The bytes Windows draws, in the raster faces, from a fallback font ($01-$08, $0B, $0E-$1B; cases.ts FALLBACK_BYTES). */
const FALLBACK_BYTES = [1, 2, 3, 4, 5, 6, 7, 8, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];

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
    // A text whose drawn bytes are all $7F gets the fallback font's cell height on Windows, which was
    // not measured (docs/porting/errata/T2.md section 2): only its pen is compared.
    const ZERO_WIDTH = [0x09, 0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f];
    const drawsOnlyDel = (reference) =>
      reference.case.ops.some(
        (o) => o.op === 'text' && o.bytes.includes(0x7f) && o.bytes.every((b) => b === 0x7f || ZERO_WIDTH.includes(b)),
      );
    const control = references['text-control'];
    const fallback = control.filter((r) =>
      r.case.ops.some((o) => o.op === 'text' && o.bytes.some((b) => FALLBACK_BYTES.includes(b))),
    );
    const others = control.filter((r) => !fallback.includes(r));
    const hasEuro = (r) => replay.euroInk(r.case, fonts) !== null;
    // A case of one text whose pen Windows gives in every history (golden/text-path-euro-pens.json;
    // gdi-references.test.ts checks that those pens are the committed references').
    const euroHeld = (r) => {
      const font = fontOf(r);
      const text = r.case.ops.find((o) => o.op === 'text');
      const hex = text.bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
      return references.euroPens.has(`${font.name}|${font.size}|${font.style}|${hex}`);
    };
    const onRunner = (r) => references.runner.get(r.case.id);
    const samePen = (r) => onRunner(r).pen[0] === r.pen[0] && onRunner(r).pen[1] === r.pen[1];
    const samePicture = (r) =>
      onRunner(r).image.pixels.every((p, i) => (p & 0xffffff) === (r.image.pixels[i] & 0xffffff));
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
        'text-outline-zero: zero-width bytes and $7F in Courier New, Lucida Console, Consolas, cell rectangles and pen positions',
        references['text-outline-zero'].filter((r) => !drawsOnlyDel(r)),
        'cells',
        true,
      ],
      [
        'text-outline-zero: texts that draw only $7F, pen positions (the cell height of the fallback font is not measured)',
        references['text-outline-zero'].filter(drawsOnlyDel),
        'pens',
        true,
      ],
      [
        'text-outline-glyphs: outline faces with visible glyphs, pen positions',
        references['text-outline-glyphs'],
        'pens',
        true,
      ],
      [
        'text-control: the bytes $01-$08 $0B $0E-$1B, pen positions where the two captured Windows agree (6.5.3, erratum T2 25)',
        fallback.filter(samePen),
        'pens',
        true,
      ],
      [
        'text-control: the bytes $01-$08 $0B $0E-$1B, every pixel and the pen where the two captured Windows draw the same',
        fallback.filter((r) => samePen(r) && samePicture(r)),
        'pixels',
        true,
      ],
      [
        `text-control: the bytes $01-$08 $0B $0E-$1B, all ${fallback.length} cases (the two Windows draw ${fallback.filter((r) => !samePicture(r)).length} of them differently; reported, not required)`,
        fallback,
        'pixels',
        false,
      ],
      [
        "text-control: the other cases (drawn the same by both captured Windows; Windows' text path, gate I3 item 3b), every pixel and the pen",
        others.filter((r) => !hasEuro(r)),
        'pixels',
        true,
      ],
      [
        'text-control: the other cases with $80 on the text path, the pen and every pixel but the smoothed euro sign, where Windows gives that pen in every history (6.5.3, errata T2 26 and T2 29)',
        others.filter((r) => hasEuro(r) && euroHeld(r)),
        'but-euro',
        true,
      ],
      [
        'text-control: the other cases with $80 on the text path whose pen depends on what Windows drew before (Courier; reported, not required)',
        others.filter((r) => hasEuro(r) && !euroHeld(r)),
        'but-euro',
        false,
      ],
      [
        "text-path: Windows' text path (the zero-width bar, italic itemization, undefined bytes, control texts), every pixel and the pen",
        references['text-path'],
        'pixels',
        true,
      ],
      [
        'text-path-euro: $80 on the text path, the pen and every pixel but the smoothed euro sign, where Windows gives that pen in every history (erratum T2 29)',
        references['text-path-euro'].filter(euroHeld),
        'but-euro',
        true,
      ],
      [
        'text-path-euro: the Courier texts whose pen depends on what Windows drew before, against the capture in order of size (reported, not required)',
        references['text-path-euro'].filter((r) => !euroHeld(r)),
        'but-euro',
        false,
      ],
      [
        'text-path-formfeed: $0C on the text path, every pixel and the pen (a smoothed fallback glyph, not modelled: a known difference, reported, not required; erratum T2 27)',
        references['text-path-formfeed'],
        'pixels',
        false,
      ],
      [
        'text-path-formfeed: $0C on the text path, pen positions (reported, not required)',
        references['text-path-formfeed'],
        'pens',
        false,
      ],
      ['text-control: all cases, every pixel (reported, not required)', control, 'pixels', false],
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
        await closeWithin(context);
      } finally {
        await doneWith(browser, { last: browserName === browsers.at(-1) });
      }
    }
  } finally {
    closeAtEnd(server);
    rmSync(cacheDir, { recursive: true, force: true });
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
