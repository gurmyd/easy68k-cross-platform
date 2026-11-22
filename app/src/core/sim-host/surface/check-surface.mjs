// Browser check of the drawing surface (ARCHITECTURE.md 3.4, 6.5.4). Owner: SH1.
//
//   node app/src/core/sim-host/surface/check-surface.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// The surface is plain arithmetic on a pixel array and its unit tests run under Node. This script
// shows that a browser changes nothing. It starts the Vite dev server of app/ on a free port (the
// system picks it), opens an empty page in headless Chromium and WebKit (Playwright), imports the
// surface module into it and checks:
//
//   - the fixed scene of testing.ts has the hash the unit tests expect (FIXED_SCENE_HASH): the same
//     pixels as under Node;
//   - the scene of rectangles with every pen width 2-255, which holds every round dot of
//     tables/dots.ts, has the hash the unit tests expect (WIDE_RECTANGLE_SCENE_HASH), which is the
//     hash of the picture Windows GDI drew of it;
//   - the scene of ellipses and wide lines has the same hash in every browser of the run;
//   - the pixel array is what ImageData wants: `putImageData` from the buffer's own memory and
//     `getImageData` back give the same bytes, and the on-screen canvas shows them (3.4,
//     "the canvas only receives finished pixels");
//   - double buffering presents what it should (the window buffer, then the back buffer after
//     task 94), through `takeDirty()` as the Output panel will use it;
//   - a flood fill of a whole 1920 x 1200 surface takes under 30 ms (9.2), best of 15 runs. On a
//     machine that is busy or slow (a CI runner) the limit is instead eight single passes over as
//     many pixels, measured at the same moment, so that the machine alone does not fail the check;
//     the times are printed, and so are, for information only, the times of four ragged pictures;
//   - a sheet of small shapes, four times enlarged, is drawn for a person to look at.
//
// The page is not the application: it is an empty document on the dev server's origin, so that a
// half-built feature elsewhere cannot fail this check. Screenshots of the canvas go to
// build/surface-check (git-ignored); look at them. Exit code 0 = everything passed.
//
// Needs only the pinned development dependencies (vite, @playwright/test); no production build, no
// engines. Nothing in it depends on the operating system: no fonts, no keys, no file paths in the
// page, and the one time limit scales with the machine.

/* global console, process, document, performance, ImageData -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { closeAtEnd, closeWithin, doneWith, endChecks } from '../../../../../tests/browser-checks/ending.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'surface-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
if (browserChoice !== 'all' && !Object.hasOwn(BROWSERS, browserChoice)) {
  console.error(`check-surface: --browser must be chromium, webkit or all, not "${browserChoice}"`);
  process.exit(2);
}
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const PAGE_PATH = '__surface-check__.html';
const PAGE_HTML =
  '<!doctype html><meta charset="utf-8"><title>surface check</title>' +
  '<body style="margin:0;background:#444"><canvas id="screen" style="display:block"></canvas></body>';

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- what runs in the page -------------------------------------------------------------

/** Draws the three scenes and presents the first on the canvas. Returns hashes and comparisons. */
async function scenesInPage() {
  const { Surface } = await import('/src/core/sim-host/surface/surface.ts');
  const {
    drawFixedScene,
    drawShapeScene,
    drawWideRectangleScene,
    hashPixels,
    FIXED_SCENE_HASH,
    WIDE_RECTANGLE_SCENE_HASH,
  } = await import('/src/core/sim-host/surface/testing.ts');

  const surface = new Surface(640, 480);
  drawFixedScene(surface);
  const shapes = new Surface(640, 480);
  drawShapeScene(shapes);
  const wide = new Surface(640, 480);
  drawWideRectangleScene(wide);

  // Present the way the Output panel does: the buffer's own memory as ImageData, the dirty region only.
  const canvas = document.getElementById('screen');
  canvas.width = surface.back.width;
  canvas.height = surface.back.height;
  const context = canvas.getContext('2d');
  const { data, width, height } = surface.back;
  const image = new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height);
  const dirty = surface.takeDirty();
  context.putImageData(image, 0, 0, dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top);
  const back = context.getImageData(0, 0, width, height).data;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let differing = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== back[i]) differing++;

  // One pixel, byte by byte: $00BBGGRR $123456 is red $56, green $34, blue $12, alpha 255.
  const probe = new Surface(640, 480);
  probe.setLineColor(0x123456);
  probe.drawPixel(0, 0);
  const probeBytes = Array.from(new Uint8Array(probe.back.data.buffer, 0, 4));

  return {
    fixedHash: hashPixels(surface.back),
    expectedHash: FIXED_SCENE_HASH,
    wideHash: hashPixels(wide.back),
    expectedWideHash: WIDE_RECTANGLE_SCENE_HASH,
    shapeHash: hashPixels(shapes.back),
    firstDirty: dirty,
    differing,
    probeBytes,
  };
}

/** Double buffering as the panel sees it: what `window ?? back` and `takeDirty()` give at each step. */
async function bufferingInPage() {
  const { Surface } = await import('/src/core/sim-host/surface/surface.ts');
  const canvas = document.getElementById('screen');
  const context = canvas.getContext('2d');
  const surface = new Surface(640, 480);
  canvas.width = 640;
  canvas.height = 480;

  /** One animation frame of the panel: the dirty region from `window ?? back`. */
  const present = () => {
    const dirty = surface.takeDirty();
    if (!dirty) return null;
    const shown = surface.window ?? surface.back;
    const image = new ImageData(
      new Uint8ClampedArray(shown.data.buffer, shown.data.byteOffset, shown.data.byteLength),
      shown.width,
      shown.height,
    );
    context.putImageData(image, 0, 0, dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top);
    return dirty;
  };
  const pixel = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data).join(',');

  const steps = [];
  present();
  surface.setFillColor(0x0000ff); // red
  surface.rectangle(100, 100, 200, 200);
  steps.push({ step: 'drawn while not double buffering', dirty: present(), pixel: pixel(150, 150) });
  surface.setDrawingMode(17);
  surface.setFillColor(0x00ff00); // green
  surface.rectangle(100, 100, 200, 200);
  steps.push({ step: 'drawn while double buffering', dirty: present(), pixel: pixel(150, 150) });
  surface.formPaint();
  steps.push({ step: 'after task 94', dirty: present(), pixel: pixel(150, 150) });
  surface.setFillColor(0xff0000); // blue
  surface.rectangle(100, 100, 200, 200);
  surface.setDrawingMode(16);
  steps.push({ step: 'after mode 16', dirty: present(), pixel: pixel(150, 150) });
  return steps;
}

/**
 * A sheet of small shapes, shown four times enlarged, for a person to look at: lines in sixteen
 * directions, rectangles of the pen widths 1-6, the dots of the pen widths 2-14, circles of 3-16
 * pixels, one line of each width 2-6, and in the bottom row the dots of the pen widths 16, 20, 24,
 * 31, 40 and 47 (one-point rectangles). Returns the number of pixels drawn.
 */
async function specimenInPage() {
  const { Surface } = await import('/src/core/sim-host/surface/surface.ts');
  const surface = new Surface(200, 200);
  for (let step = 0; step < 16; step++) {
    const angle = (step * Math.PI) / 8;
    surface.line(30, 30, 30 + Math.round(26 * Math.cos(angle)), 30 + Math.round(26 * Math.sin(angle)));
  }
  surface.setFillColor(0x0000ff);
  for (let width = 1; width <= 6; width++) {
    surface.setPenWidth(width);
    surface.rectangle(70 + (width - 1) * 21, 6, 82 + (width - 1) * 21, 18);
    surface.unfilledRectangle(70 + (width - 1) * 21, 30, 82 + (width - 1) * 21, 30); // one row high
    surface.line(70 + (width - 1) * 21, 44, 82 + (width - 1) * 21, 50);
  }
  for (let width = 2; width <= 14; width++) {
    surface.setPenWidth(width);
    surface.rectangle(8 + (width - 2) * 15, 72, 8 + (width - 2) * 15, 72); // a one-point rectangle: the dot
  }
  surface.setPenWidth(1);
  let left = 4;
  for (let size = 3; size <= 16; size++) {
    surface.ellipse(left, 92, left + size - 1, 92 + size - 1);
    surface.unfilledEllipse(left, 120, left + size - 1, 120 + Math.ceil(size / 2) - 1);
    left += size + 3;
  }
  for (const [width, x] of [
    [16, 12],
    [20, 34],
    [24, 60],
    [31, 92],
    [40, 133],
    [47, 175],
  ]) {
    surface.setPenWidth(width);
    surface.rectangle(x, 172, x, 172);
  }
  const canvas = document.getElementById('screen');
  canvas.width = 200;
  canvas.height = 200;
  canvas.style.width = '800px';
  canvas.style.height = '800px';
  canvas.style.imageRendering = 'pixelated';
  const { data } = surface.back;
  const image = new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), 200, 200);
  canvas.getContext('2d').putImageData(image, 0, 0);
  let drawn = 0;
  for (let i = 0; i < data.length; i++) if (data[i] !== 0xff000000) drawn++;
  return drawn;
}

/** Best-of-15 time of a flood fill of a whole 1920 x 1200 surface, and of one plain pass over it. */
async function timingInPage() {
  const { Surface } = await import('/src/core/sim-host/surface/surface.ts');
  const surface = new Surface(640, 480);
  surface.resize(1920, 1200);
  const fills = [];
  const passes = [];
  let filled = true;
  for (let run = 0; run < 15; run++) {
    surface.resize(0, 0); // black again
    surface.setFillColor(run % 2 ? 0x0000ff : 0x00ff00);
    let start = performance.now();
    surface.floodFill(960, 600);
    fills.push(performance.now() - start);
    filled &&= surface.getPixel(0, 0) !== 0 && surface.getPixel(1919, 1199) !== 0;

    const data = surface.back.data;
    start = performance.now();
    for (let i = 0; i < data.length; i++) data[i] = (data[i] & 0x00ffff00) ^ 0xff0000ff;
    passes.push(performance.now() - start);
  }
  return { fill: Math.min(...fills), pass: Math.min(...passes), fills, filled };
}

/**
 * For information: the best-of-5 flood fill times of four ragged 1920 x 1200 pictures, each filled
 * from a pixel of its black region. Nothing is asserted about them (errata SH1 entry 12).
 */
async function raggedTimingInPage() {
  const { Surface } = await import('/src/core/sim-host/surface/surface.ts');
  const WIDTH = 1920;
  const HEIGHT = 1200;
  const WHITE = 0xffffffff;
  // Name, where the fill starts, and which pixels are white (null: one pixel in ten, at random).
  const pictures = [
    [
      '40-pixel cells, walls with one gap each',
      1,
      1,
      (x, y) => (x % 40 === 0 && y % 40 !== 20) || (y % 40 === 0 && x % 40 !== 20),
    ],
    ['10 % random pixels', 0, 0, null],
    ['every second pixel of every second row', 0, 0, (x, y) => y % 2 === 1 && x % 2 === 1],
    [
      'vertical one-pixel stripes with one gap each',
      0,
      0,
      (x, y) => x % 2 === 1 && y !== (x % 4 === 1 ? 0 : HEIGHT - 1),
    ],
  ];
  const surface = new Surface(640, 480);
  surface.resize(WIDTH, HEIGHT);
  const results = [];
  for (const [name, startX, startY, wall] of pictures) {
    let best = Infinity;
    let painted = 0;
    for (let run = 0; run < 5; run++) {
      surface.resize(0, 0); // black again
      const data = surface.back.data;
      if (wall) {
        for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (wall(x, y)) data[y * WIDTH + x] = WHITE;
      } else {
        let seed = 12345;
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
          if ((seed >>> 16) % 100 < 10) data[i] = WHITE;
        }
      }
      data[startY * WIDTH + startX] = 0xff000000; // the start pixel is black in every picture
      surface.setFillColor(0x0000ff);
      const start = performance.now();
      surface.floodFill(startX, startY);
      best = Math.min(best, performance.now() - start);
      painted = 0;
      for (let i = 0; i < data.length; i++) if (data[i] === 0xff0000ff) painted++;
    }
    results.push({ name, best, painted });
  }
  return results;
}

// --- per browser -----------------------------------------------------------------------

async function run(browser, name, baseUrl, shapeHashes) {
  // One CSS pixel is one device pixel, so that the screenshots show the canvas pixel for pixel.
  const context = await browser.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route(`**/${PAGE_PATH}`, (route) => route.fulfill({ contentType: 'text/html', body: PAGE_HTML }));
  // A cold dev server on a slow runner transforms the modules on first request: allow it time.
  page.setDefaultTimeout(120_000);
  await page.goto(`${baseUrl}${PAGE_PATH}`);

  const scenes = await page.evaluate(scenesInPage);
  check(
    `${name}: the fixed scene has the pixels it has under Node`,
    scenes.fixedHash === scenes.expectedHash,
    `hash ${scenes.fixedHash}, expected ${scenes.expectedHash}`,
  );
  check(
    `${name}: the scene of rectangles with every pen width 2-255 has the pixels it has under Node and on GDI`,
    scenes.wideHash === scenes.expectedWideHash,
    `hash ${scenes.wideHash}, expected ${scenes.expectedWideHash}`,
  );
  shapeHashes.push(scenes.shapeHash);
  check(
    `${name}: the scene of ellipses and wide lines has the same pixels as in the other browsers`,
    shapeHashes.every((hash) => hash === shapeHashes[0]),
    `hash ${scenes.shapeHash}`,
  );
  check(
    `${name}: a new surface reports itself completely dirty`,
    JSON.stringify(scenes.firstDirty) === JSON.stringify({ left: 0, top: 0, right: 640, bottom: 480 }),
    JSON.stringify(scenes.firstDirty),
  );
  check(
    `${name}: putImageData from the buffer's memory and getImageData give the same bytes`,
    scenes.differing === 0,
    `${scenes.differing} bytes differ`,
  );
  check(
    `${name}: a pixel $123456 is stored as the bytes red, green, blue, alpha`,
    scenes.probeBytes.join(',') === '86,52,18,255',
    scenes.probeBytes.join(','),
  );
  await page.locator('#screen').screenshot({ path: join(outDir, `${name}-fixed-scene.png`) });

  const steps = await page.evaluate(bufferingInPage);
  const expected = {
    'drawn while not double buffering': ['255,0,0,255', true],
    'drawn while double buffering': ['255,0,0,255', false], // the screen keeps its picture
    'after task 94': ['0,255,0,255', true],
    'after mode 16': ['0,0,255,255', true],
  };
  for (const { step, dirty, pixel } of steps) {
    const [color, changed] = expected[step];
    check(
      `${name}: ${step}, the canvas shows ${color}`,
      pixel === color && (dirty !== null) === changed,
      `pixel ${pixel}, dirty ${JSON.stringify(dirty)}`,
    );
  }
  await page.locator('#screen').screenshot({ path: join(outDir, `${name}-double-buffering.png`) });

  const timing = await page.evaluate(timingInPage);
  check(`${name}: the flood fill filled the whole 1920 x 1200 surface`, timing.filled);
  check(
    `${name}: a 1920 x 1200 flood fill takes under 30 ms`,
    timing.fill < 30 || timing.fill < 8 * timing.pass,
    `best of 15: ${timing.fill.toFixed(1)} ms (runs ${timing.fills.map((t) => t.toFixed(0)).join(' ')}); ` +
      `one plain pass over the pixels: ${timing.pass.toFixed(1)} ms`,
  );
  for (const { name: picture, best, painted } of await page.evaluate(raggedTimingInPage)) {
    console.log(`  info ${name}: flood fill of ${picture}: best of 5 ${best.toFixed(1)} ms, ${painted} pixels painted`);
  }

  const drawn = await page.evaluate(specimenInPage);
  check(`${name}: the specimen sheet is drawn (see ${name}-specimen.png)`, drawn > 3000, `${drawn} pixels`);
  await page.locator('#screen').screenshot({ path: join(outDir, `${name}-specimen.png`) });

  check(`${name}: no console errors`, errors.length === 0, errors.join(' | '));
  await closeWithin(context);
}

// --- run -------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // A cache of its own: several checks may run on one machine at the same time.
    cacheDir: join(outDir, 'vite-cache'),
    // Port 0: the system picks a free one. No file watching and no hot reload: nothing here needs
    // them, and a file saved elsewhere in the tree must not disturb the check.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    // No dependency scan: the surface imports no package, and a scan reads the whole application
    // from index.html, so a file half-saved elsewhere printed a scan error, and a late discovery can
    // answer "504 Outdated Optimize Dep" to a module the page asked for.
    optimizeDeps: { noDiscovery: true, entries: [] },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Dev server: ${baseUrl}\nScreenshots: ${outDir}`);

  const shapeHashes = [];
  try {
    for (const name of browsers) {
      console.log(`\n[${name}]`);
      const browser = await BROWSERS[name].launch();
      try {
        await run(browser, name, baseUrl, shapeHashes);
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
