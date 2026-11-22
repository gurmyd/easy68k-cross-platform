// Browser check of the whole-program pixel regression (ARCHITECTURE.md 6.5.4). Owner: X3.
//
//   node tests/conformance/examples/check-examples.mjs [--browser chromium|webkit|all] [--out <dir>]
//        [--only <text>] [--screenshots all|none]
//
// "The same programs run in Chromium and WebKit through Playwright; the surface's pixel array, read
// from the session, must have the same hash, and a screenshot of the canvas at 100% zoom must show
// exactly those pixels. This proves that the pixels do not depend on the browser."
//
// What happens, for each of the 34 examples (tests/conformance/examples/catalog.ts) in each browser:
//
//   1. Node assembles the program with the port's assembler (the same call as the Vitest run) and
//      sends the bytes to the page.
//   2. In the page, runner.ts (the same file that runs under Node) runs it in a headless session of
//      the real engine, real host parts, virtual time, to its fixed point: the page's own WebAssembly
//      engine, the page's own arithmetic. The glyphs come from app/public/fonts through fetch.
//   3. The surface's pixel array is hashed in the page. It must equal the committed hash of
//      golden/surfaces.json, which came from the Node run (so: the same hash under Node, Chromium
//      and WebKit), as must the instruction count, the cycle count and the end of the run.
//   4. The page presents the surface on a canvas with the Output panel's own Presenter
//      (app/src/features/output/present.ts) at the surface's size, CSS size equal to the pixel size,
//      device pixel ratio 1: 100% zoom. The canvas is read back (getImageData) and screenshotted by
//      Playwright; the screenshot (a PNG, decoded by png.ts) must hold exactly the pixels the
//      canvas should show: the surface with the prompt overlay over it, `screenHash` of the golden.
//
// The page is not the application: it is an empty document on the development server's origin, so
// that a feature half-built elsewhere cannot fail this check. What it imports is the application's
// code. Screenshots go to build/X3/check (git-ignored) as <browser>-<example>.png; look at them.
//
// Needs engine/dist and the pinned development dependencies (vite, @playwright/test) and nothing
// that depends on the operating system: no fonts of the machine (the glyphs are the atlases), no
// keys, no file paths in the page. Prints "N of M checks passed"; exit code 0 = all passed and no
// console error.

/* global document, ImageData -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'X3', 'check')));
const only = option('--only', '');
const screenshots = option('--screenshots', 'all');
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
if (browserChoice !== 'all' && !Object.hasOwn(BROWSERS, browserChoice)) {
  console.error(`check-examples: --browser must be chromium, webkit or all, not "${browserChoice}"`);
  process.exit(2);
}
if (!['all', 'none'].includes(screenshots)) {
  console.error(`check-examples: --screenshots must be all or none, not "${screenshots}"`);
  process.exit(2);
}
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const engineDist = join(repoRoot, 'engine', 'dist');
const enginesPresent = existsSync(join(engineDist, 'asm68k.wasm')) && existsSync(join(engineDist, 'sim68k.wasm'));
if (!enginesPresent) {
  console.error('check-examples: engine/dist is missing (npm run build:engines or npm run fetch:engines)');
  process.exit(process.env.EASY68K_REQUIRE_ENGINES === '1' ? 1 : 0);
}

/** The first page load of the dev server can take minutes on a busy machine. */
const LOAD_TIMEOUT = 240_000;
const RUN_TIMEOUT = 120_000;
const PAGE_PATH = '__examples-check__.html';
const PAGE_HTML =
  '<!doctype html><meta charset="utf-8"><title>examples check</title>' +
  '<body style="margin:0;background:#444"><canvas id="screen" style="display:block"></canvas></body>';

let failures = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');

// --- what runs in the page ---------------------------------------------------------------------

/**
 * Runs one prepared program in the page and presents its surface on the canvas. `fsPath` is the
 * absolute path of the tests folder as Vite serves it (`/@fs/...`).
 */
async function runInPage({ prepared, fsPath }) {
  const base64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const { runExample } = await import(/* @vite-ignore */ `${fsPath}/runner.ts`);
  const { createSimEngine, releaseSimEngine } = await import('/src/engine/index.ts');
  const { AtlasGlyphProvider } = await import('/src/core/sim-host/fonts/atlas-provider.ts');
  const { Presenter, rgbaView } = await import('/src/features/output/present.ts');

  const glyphs = new AtlasGlyphProvider(async (path) => {
    const response = await fetch(`/fonts/${path}`);
    // A development server answers a missing file with its start page; a font file is never HTML.
    if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return null;
    return new Uint8Array(await response.arrayBuffer());
  });

  const program = {
    id: prepared.id,
    stem: prepared.stem,
    s68: base64(prepared.s68),
    l68: base64(prepared.l68),
    files: Object.fromEntries(Object.entries(prepared.files).map(([name, data]) => [name, base64(data)])),
    script: prepared.script,
  };
  const canvas = document.getElementById('screen');
  const readback = { hash: '', width: 0, height: 0 };
  const result = await runExample(
    program,
    { engines: { create: createSimEngine, release: releaseSimEngine }, glyphs },
    (session) => {
      // The Output panel's presentation: the canvas as large as the surface, CSS size the same.
      const context = canvas.getContext('2d', { alpha: false });
      const presenter = new Presenter({
        size: () => ({ width: canvas.width, height: canvas.height }),
        resize: (width, height) => {
          canvas.width = width;
          canvas.height = height;
        },
        image: (pixels, width, height) => new ImageData(rgbaView(pixels), width, height),
        put: (image, dx, dy, sx, sy, width, height) => context.putImageData(image, dx, dy, sx, sy, width, height),
      });
      presenter.frame(session.surface);
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      readback.width = canvas.width;
      readback.height = canvas.height;
      readback.rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    },
  );
  // The hash of the canvas readback is made by the same function as the others, in Node.
  return { result, readback: { width: readback.width, height: readback.height, rgba: pageBase64(readback.rgba) } };

  function pageBase64(values) {
    let text = '';
    for (let i = 0; i < values.length; i += 0x8000) text += String.fromCharCode(...values.subarray(i, i + 0x8000));
    return btoa(text);
  }
}

// --- the Node side -----------------------------------------------------------------------------

async function main() {
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
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    const { allExamples, prepareExample, GOLDEN_PATH, EXAMPLES_DIR } = await server.ssrLoadModule(
      '/@fs/' + join(here, 'catalog.ts').replaceAll('\\', '/'),
    );
    const { readGolden, entryOf, describeDifference } = await server.ssrLoadModule(
      '/@fs/' + join(here, 'golden.ts').replaceAll('\\', '/'),
    );
    const { decodePng } = await server.ssrLoadModule('/@fs/' + join(here, 'png.ts').replaceAll('\\', '/'));
    const { hashRgba } = await server.ssrLoadModule('/@fs/' + join(here, 'runner.ts').replaceAll('\\', '/'));
    const golden = readGolden(GOLDEN_PATH).examples;
    const fsPath = '/@fs/' + EXAMPLES_DIR.replaceAll('\\', '/').replace(/\/$/, '');

    const examples = allExamples().filter((example) => only === '' || example.id.includes(only));
    console.log(`${examples.length} examples, browsers: ${browsers.join(', ')}`);
    check(
      'the golden file and the catalog list the same examples',
      same(
        Object.keys(golden).sort(),
        allExamples()
          .map((e) => e.id)
          .sort(),
      ),
    );
    const prepared = new Map();
    for (const example of examples) prepared.set(example.id, await prepareExample(example));

    /** The screen hashes each browser measured, for the comparison of the browsers with each other. */
    const measured = new Map();
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        // Device pixel ratio 1 and a window larger than the largest surface of the examples: 100% zoom.
        const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
        const errors = [];
        context.setDefaultTimeout(RUN_TIMEOUT);
        await context.route(`**/${PAGE_PATH}`, (route) => route.fulfill({ contentType: 'text/html', body: PAGE_HTML }));
        const page = await context.newPage();
        page.on('console', (message) => {
          // The development server's own hot-reload client complains that there is no socket (hot reload
          // is off on purpose, and the server's port is 0 in the address it was told): not the application.
          const text = message.text();
          if (process.env.X3_ALL_ERRORS && message.type() === 'error') console.log(`        console error: ${text}`);
          if (
            message.type() === 'error' &&
            !/WebSocket connection to|[vite] failed to connect|your current setup:|Check out your Vite|Failed to send error to Vite server/.test(
              text,
            )
          ) {
            errors.push(text);
          }
        });
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(`${baseUrl}${PAGE_PATH}`, { timeout: LOAD_TIMEOUT });

        for (const example of examples) {
          const label = `${name}: ${example.id}`;
          try {
            const started = Date.now();
            const { result, readback } = await page.evaluate(runInPage, {
              prepared: toTransfer(prepared.get(example.id)),
              fsPath,
            });
            const entry = entryOf(prepared.get(example.id), example.origin, result);
            const difference = describeDifference(golden[example.id], entry);
            check(
              `${label}: the surface in the page has the committed hash and run`,
              difference === null,
              difference ??
                `${result.surfaceHash.slice(0, 12)} ${result.end}, ${result.instructions} instructions, ${Date.now() - started} ms`,
            );
            measured.set(`${name}/${example.id}`, result.surfaceHash);

            const read = new Uint8Array(Buffer.from(readback.rgba, 'base64'));
            check(
              `${label}: the canvas reads back the pixels it should show`,
              readback.width === result.width &&
                readback.height === result.height &&
                hashRgba(readback.width, readback.height, read) === golden[example.id].screenHash,
              `${readback.width}x${readback.height}`,
            );

            const png = await page.locator('#screen').screenshot({ type: 'png', animations: 'disabled' });
            if (screenshots === 'all')
              writeFileSync(join(outDir, `${name}-${example.id.replaceAll('/', '_')}.png`), png);
            const shot = decodePng(png);
            const sizeOk = shot.width === result.width && shot.height === result.height;
            check(
              `${label}: the screenshot of the canvas at 100% zoom is ${result.width}x${result.height}`,
              sizeOk,
              `${shot.width}x${shot.height}`,
            );
            if (sizeOk) {
              const shotHash = hashRgba(shot.width, shot.height, shot.rgba);
              check(
                `${label}: the screenshot shows exactly the pixels of the surface`,
                shotHash === golden[example.id].screenHash,
                shotHash === golden[example.id].screenHash
                  ? shotHash.slice(0, 12)
                  : describeScreenshot(shot.rgba, read),
              );
            }
          } catch (error) {
            check(
              `${label} ran to the end`,
              false,
              String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            );
          }
        }
        check(`${name}: the page logged no console error`, errors.length === 0, errors.slice(0, 3).join(' | '));
        await closeWithin(context);
      } finally {
        await doneWith(browser, { last: name === browsers.at(-1) });
      }
    }

    if (browsers.length > 1) {
      for (const example of examples) {
        const hashes = browsers.map((name) => measured.get(`${name}/${example.id}`));
        check(
          `${example.id}: the same surface hash in ${browsers.join(' and ')}`,
          hashes.every((hash) => hash !== undefined && hash === hashes[0]),
          hashes.map((h) => h?.slice(0, 12)).join(' / '),
        );
      }
    }
  } finally {
    closeAtEnd(server);
  }
  console.log(`\n${total - failures} of ${total} checks passed`);
  await endChecks(failures === 0 ? 0 : 1);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The program as the page takes it: bytes as base64. */
function toTransfer(program) {
  return {
    id: program.id,
    stem: program.stem,
    s68: toBase64(program.s68),
    l68: toBase64(program.l68),
    files: Object.fromEntries(Object.entries(program.files).map(([name, data]) => [name, toBase64(data)])),
    script: program.script,
  };
}

/** How the screenshot differs from the canvas readback: the number of pixels and the first. */
function describeScreenshot(shot, expected) {
  let count = 0;
  let first = -1;
  for (let i = 0; i < Math.min(shot.length, expected.length); i += 4) {
    if (shot[i] !== expected[i] || shot[i + 1] !== expected[i + 1] || shot[i + 2] !== expected[i + 2]) {
      count++;
      if (first < 0) first = i / 4;
    }
  }
  return `${count} pixels differ from the canvas readback; first at index ${first}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
