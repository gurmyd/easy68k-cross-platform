// Browser check of the Output panel (ARCHITECTURE.md 9.2, SH4 acceptance). Owner: SH4.
//
//   node app/src/features/output/check-output.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the REAL Output panel inside the
// real shell, with the REAL simulator engine running 68000 programs, in headless Chromium and
// WebKit (Playwright). The drawing surface, the text screen and the run controller are written in
// the same wave by other packages, so the page uses the small doubles of ./testing/ for those
// three (./testing/bed.ts says what is real and what is not); everything a key or the mouse passes
// through on its way to the program is the real code. The programs record what they observe in
// 68000 memory (./testing/programs.ts), and the script reads it back.
//
// What it checks, once with the Windows key map and once with the macOS key map where they differ:
//
//   - the panel: header strip, canvas backing store = surface size at device pixel ratios 1 and
//     2, whole-number zoom without smoothing, the prompt overlay, the text mirror, the collapse
//     button, an accessibility scan;
//   - each rule of 2.9.4 with real key events: F9 runs and is not seen by task 19, its key-up is;
//     F2, F4 and Shift+F2 are seen by task 19 and run nothing; Alt+Enter is seen by task 19 and by
//     a key-down interrupt and then toggles full screen; after task 24 the eleven shortcuts reach
//     the program and only the release chord acts; Tab; which key-downs are cancelled;
//   - text: typing, a held letter repeats, a dead-key sequence and a composed character arrive
//     in task 2;
//   - paste: `HELLO` into a task 5 loop stores `HO`, a two-line paste into task 2 fills one
//     input, a paste with LF line ends terminates the line, an empty clipboard;
//   - focus: ioActivated on focus, nothing posted on focus loss, key-ups restored when Meta is
//     released (macOS key map);
//   - mouse: surface coordinates at any zoom, the shift bits, the left button's capture, no
//     context menu;
//   - full screen: by the user, deferred (a program asks without a gesture), refused, ended by
//     the browser, and the window-level full screen of the desktop app.
//
// Keys are HELD while the program is expected to see them (section 6.6): key down, wait for the
// effect in the program's memory, key up.
//
// What real keys cannot do in an automated browser is done with events made in the page: a dead
// key, the keys of a composition, and the paste event with its text (the machine's clipboard is
// never written to). A headless browser whose Fullscreen API does not work gets a stand-in for
// it; the script says which case it found.
//
// Needs the built engines (engine/dist) and the pinned development dependencies, nothing else.
// The dev server runs without hot reload and with its own dependency cache, so that files saved
// meanwhile cannot reload the page. Screenshots go to build/output-check (git-ignored). Prints
// `N of M checks passed`; exit code 0 = everything passed. `--only panel,keys,text,paste,focus,
// mouse,fullscreen` runs some groups only.
//
// It lives here rather than in tests/ because SH4 owns app/src/features/output and tests/e2e
// belongs to a later package (X2).

/* global console, process, setTimeout, document, window, navigator, KeyboardEvent, Event, InputEvent, CompositionEvent, createImageBitmap, Blob, atob, Element -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { existsSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'output-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

// Every check runs a 68000 program: without the built engines there is nothing to check. As in
// the unit tests, that is a skip, and a failure where EASY68K_REQUIRE_ENGINES is 1 (CI).
const missingEngines = ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].filter(
  (file) => !existsSync(join(repoRoot, 'engine', 'dist', file)),
);
if (missingEngines.length > 0) {
  const required = process.env.EASY68K_REQUIRE_ENGINES === '1';
  console.log(
    `engine/dist lacks ${missingEngines.join(', ')}: run \`npm run build:engines\` or \`npm run fetch:engines\` first.\n` +
      (required ? 'EASY68K_REQUIRE_ENGINES is 1: this is a failure.' : 'Skipped: 0 of 0 checks passed.'),
  );
  process.exit(required ? 1 : 0);
}

/** The harness page on the dev server (set by main). */
let harnessUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
/** A finding that is reported but decides nothing (what a headless browser happens to do). */
const note = (text) => console.log(`  note ${text}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = (value) => `$${value.toString(16).toUpperCase()}`;

// --- the page ---------------------------------------------------------------------------

/**
 * Opens the harness page and mounts the shell with the Output panel on the test bed. Returns the
 * page with functions that reach into it. `os` is the key map; `desktop` makes the page behave
 * as the desktop app (Platform.setFullScreen).
 */
async function openHarness(context, { os = 'windows', desktop = false } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(harnessUrl);
  await page.evaluate(
    async (options) => {
      // What feature code may not import itself (3.1) is put together here, as main.tsx does it.
      await import('/src/styles/index.ts');
      const [{ App }, engine, harness] = await Promise.all([
        import('/src/App.tsx'),
        import('/src/engine/testing.ts'),
        import('/src/features/output/testing/harness.tsx'),
      ]);
      window.__output = await harness.mountOutputHarness({
        createEngine: async (parts) => (await engine.createTestEngine(parts)).engine,
        assemble: (source) => engine.assembleProgram(source),
        App,
        os: options.os,
        desktop: options.desktop,
        container: document.getElementById('root'),
      });
      // Every key and clipboard event AFTER the page's own handlers have seen it.
      window.__events = [];
      for (const type of ['keydown', 'keyup', 'paste', 'contextmenu']) {
        window.addEventListener(type, (event) =>
          window.__events.push({
            type,
            key: event.key,
            code: event.code,
            repeat: event.repeat,
            prevented: event.defaultPrevented,
          }),
        );
      }
    },
    { os, desktop },
  );
  try {
    await page.waitForSelector('.e68-output__canvas', { timeout: 60000 });
  } catch {
    // Say why, and leave a picture: a panel that failed to render shows a notice instead.
    await page.screenshot({ path: join(outDir, 'panel-did-not-appear.png') }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '');
    throw new Error(
      `The Output panel did not appear. Errors: ${errors.join(' | ') || 'none'}. Page text: ${JSON.stringify(text)}`,
    );
  }
  const consts = await page.evaluate(() => {
    const { KEYS, LINES, CHARS, MOUSE, PICTURE } = window.__output.programs;
    return { KEYS, LINES, CHARS, MOUSE, PICTURE };
  });
  const call = (name, ...list) => page.evaluate(([n, a]) => window.__output[n](...a), [name, list]);
  const h = {
    page,
    errors,
    ...consts,
    /** Assembles and loads one of the programs of testing/programs.ts, and presses Run. */
    async start(program, options = {}) {
      await page.evaluate(
        async ([name, programOptions]) => {
          const output = window.__output;
          await output.load(output.programs[name](programOptions));
          output.run();
        },
        [program, options],
      );
    },
    byte: (address) => call('byte', address),
    long: (address) => call('long', address),
    bytes: (address, length) => call('bytes', address, length),
    string: (address) => call('string', address),
    poke: (address, bytes) => call('poke', address, bytes),
    /** Waits until a byte of 68000 memory has the value; false after the time limit. */
    untilByte: (address, value) =>
      page
        .waitForFunction(([a, v]) => window.__output.byte(a) === v, [address, value], { timeout: 30000 })
        .then(
          () => true,
          () => false,
        ),
    untilLong: (address, value) =>
      page
        .waitForFunction(([a, v]) => window.__output.long(a) === v, [address, value], { timeout: 30000 })
        .then(
          () => true,
          () => false,
        ),
    until: (fn, arg) =>
      page.waitForFunction(fn, arg, { timeout: 30000 }).then(
        () => true,
        () => false,
      ),
    commandsRun: () => page.evaluate(() => window.__output.commandsRun.slice()),
    clearCommands: () => page.evaluate(() => void (window.__output.commandsRun.length = 0)),
    /** The entries delivered to the engine so far, as plain data. */
    delivered: () =>
      page.evaluate(() =>
        window.__output.controller.delivered.map((entry) => {
          const plain = { ...entry };
          if (plain.paste) plain.paste = String.fromCharCode(...plain.paste);
          delete plain.fn;
          return plain;
        }),
      ),
    deliveredCount: () => page.evaluate(() => window.__output.controller.delivered.length),
    /** Waits until `count` entries (of the virtual key `vk`, if given) were delivered after the first `from`. */
    untilDelivered: (from, count, vk = null) =>
      h.until(
        ([start, wanted, key]) =>
          window.__output.controller.delivered.slice(start).filter((entry) => key === null || entry.vk === key)
            .length >= wanted,
        [from, count, vk],
      ),
    phase: () => page.evaluate(() => window.__output.controller.phase),
    fullScreen: () => page.evaluate(() => window.__output.fullScreenPhase()),
    /** SimOption.Fullscreen of the engine. */
    engineFullScreen: () => page.evaluate(() => window.__output.engine.getOption(11)),
    /** The key and clipboard events the page saw since the last call. */
    events: () => page.evaluate(() => window.__events.splice(0)),
    hasKeys: () => page.evaluate(() => document.activeElement?.matches('[data-e68-keys="program"]') === true),
    activePanel: () =>
      page.evaluate(() => document.activeElement?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? null),
    /** Gives the panel the keyboard with a real click on the surface. */
    async clickSurface(position = { x: 320, y: 400 }) {
      await page.locator('.e68-output__canvas').click({ position });
      return h.hasKeys();
    },
    /** Gives the panel the keyboard without a user gesture (what host.ioBringToFront() does). */
    async focusWithoutGesture() {
      await page.evaluate(() => document.querySelector('[data-e68-keys="program"]').focus());
      return h.hasKeys();
    },
    /** Dispatches a key event made in the page: for keys Playwright cannot press (a dead key). */
    sendKey: (type, init) =>
      page.evaluate(
        ([eventType, eventInit]) => {
          const event = new KeyboardEvent(eventType, { bubbles: true, cancelable: true, composed: true, ...eventInit });
          // keyCode cannot be set through the constructor; Safari marks composition with 229.
          if (eventInit.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: eventInit.keyCode });
          document.querySelector('[data-e68-keys="program"]').dispatchEvent(event);
          return event.defaultPrevented;
        },
        [type, init],
      ),
    /**
     * The paste chord with a clipboard holding `text`, as a browser delivers it: the key-down,
     * and while the browser handles that key, the paste event; then the key-up. `text` null =
     * an empty clipboard, for which no paste event is fired.
     */
    pasteChord: (text) =>
      page.evaluate(
        ([clipboard, mac]) => {
          const field = document.querySelector('[data-e68-keys="program"]');
          const init = mac
            ? { key: 'v', code: 'KeyV', metaKey: true }
            : { key: 'Insert', code: 'Insert', shiftKey: true };
          const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
          field.dispatchEvent(down);
          let pastePrevented = null;
          if (clipboard !== null && !down.defaultPrevented) {
            const paste = new Event('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(paste, 'clipboardData', { value: { getData: () => clipboard } });
            field.dispatchEvent(paste);
            pastePrevented = paste.defaultPrevented;
          }
          field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }));
          return { downPrevented: down.defaultPrevented, pastePrevented, fieldValue: field.value };
        },
        [text, os === 'mac'],
      ),
    /** Where the canvas is, its backing size and how it is drawn. */
    canvas: () =>
      page.evaluate(() => {
        const canvas = document.querySelector('.e68-output__canvas');
        const rect = canvas.getBoundingClientRect();
        const viewport = document.querySelector('.e68-output__viewport');
        return {
          width: canvas.width,
          height: canvas.height,
          left: rect.left,
          top: rect.top,
          cssWidth: rect.width,
          cssHeight: rect.height,
          rendering: window.getComputedStyle(canvas).imageRendering,
          room: { width: viewport.clientWidth, height: viewport.clientHeight },
          ratio: window.devicePixelRatio,
        };
      }),
    /** A pixel of the canvas's backing store as $RRGGBB. */
    canvasPixel: (x, y) =>
      page.evaluate(
        ([px, py]) => {
          const [r, g, b] = document
            .querySelector('.e68-output__canvas')
            .getContext('2d')
            .getImageData(px, py, 1, 1).data;
          return (r << 16) | (g << 8) | b;
        },
        [x, y],
      ),
    /** Colours ($RRGGBB) of device pixels of a screenshot of the whole page. */
    async screenPixels(points) {
      const png = await page.screenshot();
      return page.evaluate(
        async ([base64, list]) => {
          const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0);
          return list.map(([x, y]) => {
            const [r, g, b] = context.getImageData(x, y, 1, 1).data;
            return (r << 16) | (g << 8) | b;
          });
        },
        [png.toString('base64'), points],
      );
    },
    shot: (file) => page.screenshot({ path: join(outDir, file) }),
  };
  return h;
}

/** Key down, wait for `seen` (a promise of a boolean), key up. Section 6.6: hold keys. */
async function hold(page, keys, seen) {
  for (const key of keys) await page.keyboard.down(key);
  const ok = await seen();
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
  return ok;
}

/** Set per browser by main(): this headless browser has no working Fullscreen API. */
let useFakeFullscreen = false;

async function newContext(browser, extra = {}) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: 'reduce',
    ...extra,
  });
  if (useFakeFullscreen) await context.addInitScript(fakeFullscreenApi);
  return context;
}

const noErrors = (p, h) =>
  check(`${p} no console or page errors`, h.errors.length === 0, h.errors.slice(0, 3).join(' | '));

// --- the panel: structure and presentation ------------------------------------------------

async function presentationPass(browser, name, ratio) {
  const p = `${name}/ratio ${ratio}:`;
  const context = await newContext(browser, { deviceScaleFactor: ratio });
  const h = await openHarness(context);
  const { page, PICTURE } = h;
  await h.start('pictureProgram');
  await h.untilLong(PICTURE.drawn, 1);
  await page.waitForTimeout(100);

  const header = await page.locator('.e68-output__header').innerText();
  check(`${p} header strip: title, size, zoom`, /Output\s+640x480\s+zoom:/.test(header), JSON.stringify(header));
  const choices = await page.locator('.e68-output__header select option').allInnerTexts();
  check(`${p} zoom choices Fit, 100%, 200%`, same(choices, ['Fit', '100%', '200%']), choices.join(', '));
  check(
    `${p} the full-screen button names its key`,
    (await page.locator('.e68-output__header button[aria-label="Full Screen (Alt+Enter)"]').count()) === 1,
  );

  // 2.5: the backing store is exactly the surface; device pixel ratio never changes it.
  await page.locator('.e68-output__header select').selectOption('1');
  let canvas = await h.canvas();
  check(`${p} the page runs at device pixel ratio ${ratio}`, canvas.ratio === ratio, `${canvas.ratio}`);
  check(
    `${p} canvas backing size equals the surface size (640x480)`,
    canvas.width === 640 && canvas.height === 480,
    `${canvas.width}x${canvas.height}`,
  );
  check(
    `${p} 100%: one surface pixel is one CSS pixel`,
    canvas.cssWidth === 640 && canvas.cssHeight === 480,
    `${canvas.cssWidth}x${canvas.cssHeight}`,
  );
  check(`${p} no smoothing (image-rendering: pixelated)`, canvas.rendering === 'pixelated', canvas.rendering);
  check(
    `${p} the surface stands on whole pixels`,
    Number.isInteger(canvas.left) && Number.isInteger(canvas.top),
    `${canvas.left}, ${canvas.top}`,
  );

  // The pixels of the surface are the pixels of the canvas ...
  const { pixel, box } = PICTURE;
  const rgb = (bgr) => ((bgr & 0xff) << 16) | (bgr & 0xff00) | ((bgr >> 16) & 0xff);
  const backing = [
    await h.canvasPixel(pixel.x, pixel.y),
    await h.canvasPixel(pixel.x + 1, pixel.y),
    await h.canvasPixel(box.left, box.top),
    await h.canvasPixel(box.right - 1, box.bottom - 1),
    await h.canvasPixel(box.right, box.bottom),
  ];
  check(
    `${p} the canvas holds the pixels the program drew`,
    same(backing, [rgb(pixel.color), 0, rgb(box.color), rgb(box.color), 0]),
    backing.map(hex).join(' '),
  );
  // ... and on screen each one is a block of equal device pixels with sharp edges.
  const blockOf = async (scale) => {
    canvas = await h.canvas();
    const size = scale * ratio;
    const x0 = Math.round((canvas.left + pixel.x * scale) * ratio);
    const y0 = Math.round((canvas.top + pixel.y * scale) * ratio);
    const inside = [
      [x0, y0],
      [x0 + size - 1, y0],
      [x0, y0 + size - 1],
      [x0 + size - 1, y0 + size - 1],
    ];
    const outside = [
      [x0 - 1, y0],
      [x0 + size, y0],
      [x0, y0 - 1],
      [x0, y0 + size],
    ];
    const colours = await h.screenPixels([...inside, ...outside]);
    return {
      ok: colours.slice(0, 4).every((c) => c === rgb(pixel.color)) && colours.slice(4).every((c) => c === 0),
      text: colours.map(hex).join(' '),
    };
  };
  let block = await blockOf(1);
  check(`${p} 100%: the red pixel is a sharp ${ratio}x${ratio} block on screen`, block.ok, block.text);
  await h.shot(`${name}-ratio${ratio}-100.png`);

  await page.locator('.e68-output__header select').selectOption('2');
  canvas = await h.canvas();
  check(
    `${p} 200%: backing size unchanged, shown at 1280x960`,
    canvas.width === 640 && canvas.height === 480 && canvas.cssWidth === 1280 && canvas.cssHeight === 960,
    `${canvas.width}x${canvas.height} shown ${canvas.cssWidth}x${canvas.cssHeight}`,
  );
  block = await blockOf(2);
  check(`${p} 200%: the red pixel is a sharp ${2 * ratio}x${2 * ratio} block on screen`, block.ok, block.text);
  const scrolls = await page.evaluate(() => {
    const viewport = document.querySelector('.e68-output__viewport');
    return viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight;
  });
  check(`${p} 200% does not fit the panel: the panel scrolls`, scrolls);
  check(
    `${p} the zoom choice is stored (AppSettings.layout.outputZoom)`,
    (await page.evaluate(() => window.__output.ctx.settings.get().app.layout.outputZoom)) === 2,
  );

  await page.locator('.e68-output__header select').selectOption('fit');
  canvas = await h.canvas();
  const fit = Math.max(1, Math.floor(Math.min(canvas.room.width / 640, canvas.room.height / 480)));
  check(
    `${p} Fit: the largest whole-number scale that fits (${fit}x in ${canvas.room.width}x${canvas.room.height})`,
    canvas.cssWidth === 640 * fit && canvas.cssHeight === 480 * fit,
    `${canvas.cssWidth}x${canvas.cssHeight}`,
  );

  // TRAP #15 task 33 changes the size: the canvas follows, and so does the header.
  await h.poke(PICTURE.resize, [1]);
  await h.untilLong(PICTURE.drawn, 2);
  await h.until(() => document.querySelector('.e68-output__canvas').width === 800);
  canvas = await h.canvas();
  check(
    `${p} after task 33 (800x600) the backing size is 800x600`,
    canvas.width === 800 && canvas.height === 600,
    `${canvas.width}x${canvas.height}`,
  );
  check(
    `${p} the header shows the new size`,
    (await page.locator('.e68-output__size').innerText()) === '800x600',
    await page.locator('.e68-output__size').innerText(),
  );
  check(
    `${p} the picture is drawn again on the new surface`,
    (await h.canvasPixel(pixel.x, pixel.y)) === rgb(pixel.color),
  );
  check(
    `${p} Options > Output Window Size checks 800x600`,
    await page.evaluate(() => window.__output.ctx.commands.isChecked('sim.options.size', 1)),
  );
  // The menu command sets a size too (and blacks the surface).
  await page.evaluate(() => window.__output.ctx.commands.run('sim.options.size', 0));
  await h.until(() => document.querySelector('.e68-output__canvas').width === 640);
  canvas = await h.canvas();
  check(`${p} the command Output Window Size > 640x480 sets the size`, canvas.width === 640 && canvas.height === 480);
  check(`${p} ... and the surface is black again`, (await h.canvasPixel(box.left, box.top)) === 0);

  // The text mirror for screen readers follows the text screen (2.11).
  const mirrored = await h.until(
    (text) => document.querySelector('.e68-output [role="log"]')?.textContent.includes(text),
    PICTURE.text,
  );
  check(`${p} the text mirror holds the text the program wrote`, mirrored);
  await h.shot(`${name}-ratio${ratio}-panel.png`);
  noErrors(p, h);
  await context.close();
}

/** The prompt overlay, the collapse button, and an accessibility scan. */
async function panelPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const h = await openHarness(context);
  const { page, LINES } = h;
  await h.start('lineInputProgram');
  await h.until(() => window.__output.controller.phase === 'waitInput');

  // 3.5.3: the prompt is drawn over the presented image, never into the back buffer.
  await page.waitForTimeout(100);
  const overlay = await page.evaluate(() => {
    const { overlay: cell, back } = window.__output.surface;
    if (!cell) return null;
    // Lit pixels inside the prompt's cell: on the canvas, and in the back buffer.
    const { data } = document
      .querySelector('.e68-output__canvas')
      .getContext('2d')
      .getImageData(cell.x, cell.y, cell.width, cell.height);
    let onCanvas = 0;
    let inBuffer = 0;
    for (let y = 0; y < cell.height; y++) {
      for (let x = 0; x < cell.width; x++) {
        if (data[(y * cell.width + x) * 4] > 0) onCanvas++;
        if ((back.data[(cell.y + y) * back.width + cell.x + x] & 0xffffff) !== 0) inBuffer++;
      }
    }
    return { onCanvas, inBuffer };
  });
  check(
    `${p} the input prompt is on the canvas but not in the back buffer`,
    overlay !== null && overlay.onCanvas > 0 && overlay.inBuffer === 0,
    JSON.stringify(overlay),
  );
  check(`${p} a click on the surface gives the program the keyboard`, await h.clickSurface());
  await page.keyboard.type('Hi', { delay: 60 });
  await page.keyboard.press('Enter', { delay: 60 });
  check(
    `${p} typed text arrives in task 2`,
    (await h.untilLong(LINES.count, 1)) && (await h.string(LINES.text)) === 'Hi',
  );
  await h.shot(`${name}-input.png`);

  // An accessibility scan with the panel on screen, in both themes.
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => window.__output.ctx.commands.run('app.theme.set', value), theme);
    await h.until((value) => document.documentElement.getAttribute('data-theme') === value, theme);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const serious = scan.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check(
      `${p} axe, ${theme} theme: no serious finding with the panel on screen`,
      serious.length === 0,
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join('; '),
    );
    await h.shot(`${name}-panel-${theme}.png`);
  }
  check(
    `${p} the canvas is an image with a label; the keys have a labelled field`,
    (await page.locator('canvas.e68-output__canvas[role="img"][aria-label]').count()) === 1 &&
      (await page.locator('textarea[data-e68-keys="program"][data-e68-panel-focus][aria-label]').count()) === 1,
  );

  // The panel can be collapsed, never closed (1.4 note 35); View > Output Window brings it back.
  await page.locator('.e68-output__collapse').click();
  check(`${p} the collapse button collapses the panel`, !(await page.locator('.e68-output').isVisible()));
  await page.evaluate(() => window.__output.ctx.commands.run('sim.view.output'));
  await h.until(() => document.activeElement?.matches('[data-e68-keys="program"]') === true);
  check(
    `${p} View > Output Window shows the panel again and gives it the keyboard`,
    (await page.locator('.e68-output').isVisible()) && (await h.hasKeys()),
  );
  noErrors(p, h);
  await context.close();
}

// --- keys (2.9.4) ---------------------------------------------------------------------------

async function keysPass(browser, name, os) {
  const p = `${name}/${os}:`;
  const mac = os === 'mac';
  const context = await newContext(browser);
  let h = await openHarness(context, { os });
  let { page, KEYS } = h;
  const downs = (vk) => KEYS.downs + vk;
  const ups = (vk) => KEYS.ups + vk;
  await h.start('keyWatchProgram', { keyDownInterrupt: true });
  await h.until(() => window.__output.long(window.__output.programs.KEYS.rounds) > 10);

  check(`${p} a click on the surface gives the panel the keyboard`, await h.clickSurface());
  check(
    `${p} gaining the focus posts ioActivated`,
    await h.until(() => window.__output.controller.delivered.some((entry) => entry.kind === 'ioActivated')),
  );
  await h.events();

  // Rule 2: F9 runs Run and is not seen by task 19; its key-up is.
  await page.keyboard.down('F9');
  const ran = await h.until(() => window.__output.commandsRun.includes('sim.run.run'));
  await page.waitForTimeout(150);
  const downSeen = await h.byte(downs(0x78));
  await page.keyboard.up('F9');
  const upSeen = await h.untilByte(ups(0x78), 1);
  let events = await h.events();
  check(`${p} F9 runs Run`, ran && same(await h.commandsRun(), ['sim.run.run']), (await h.commandsRun()).join(', '));
  check(`${p} F9 is not seen by task 19`, downSeen === 0 && (await h.byte(downs(0x78))) === 0);
  check(`${p} the key-up of F9 is seen by task 19`, upSeen);
  check(`${p} the key-down of F9 is cancelled`, events.find((e) => e.type === 'keydown')?.prevented === true);
  await h.clearCommands();

  // Rule 2, a disabled command: nothing runs, and the key still does not reach the program.
  await page.evaluate(() => window.__output.disabledCommands.add('sim.run.stepOver'));
  await page.keyboard.press('F8', { delay: 80 });
  await h.untilByte(ups(0x77), 1);
  check(
    `${p} F8 with Step Over disabled: nothing runs, the program does not see the key-down`,
    (await h.commandsRun()).length === 0 && (await h.byte(downs(0x77))) === 0,
  );

  // Rule 4: F2, F4 and Shift+F2 are seen by task 19 and run nothing.
  await h.poke(KEYS.watch, [0x00, 0x00, 0x73, 0x71]);
  let seen = await hold(page, ['F2'], () => h.untilLong(KEYS.state, 0x000000ff));
  check(`${p} F2 is seen by task 19 while it is held`, seen && (await h.byte(downs(0x71))) === 1);
  check(`${p} ... and is up again after its release`, await h.untilLong(KEYS.state, 0));
  seen = await hold(page, ['F4'], () => h.untilLong(KEYS.state, 0x0000ff00));
  check(`${p} F4 is seen by task 19 while it is held`, seen && (await h.byte(downs(0x73))) === 1);
  await h.poke(KEYS.watch, [0x00, 0x00, 0x10, 0x71]);
  seen = await hold(page, ['Shift', 'F2'], () => h.untilLong(KEYS.state, 0x0000ffff));
  check(`${p} Shift+F2 is seen by task 19: both keys down`, seen);
  events = await h.events();
  check(
    `${p} F2, F4 and Shift+F2 run nothing: no command, same mode, the keyboard stays in the panel`,
    (await h.commandsRun()).length === 0 &&
      (await page.evaluate(() => window.__output.ctx.store.getState().mode)) === 'simulator' &&
      (await h.hasKeys()),
    (await h.commandsRun()).join(', '),
  );
  check(
    `${p} their key-downs are cancelled`,
    events.filter((e) => e.type === 'keydown').every((e) => e.prevented),
    JSON.stringify(events.filter((e) => e.type === 'keydown' && !e.prevented)),
  );

  // F5 would reload the page: it is cancelled, and it is a key of the program.
  seen = await hold(page, ['F5'], () => h.untilByte(downs(0x74), 1));
  events = await h.events();
  check(
    `${p} F5 goes to the program and the browser's reload is cancelled`,
    seen && events.find((e) => e.type === 'keydown')?.prevented === true,
  );

  // Rule 3: plain Tab and Shift+Tab.
  const before = await h.deliveredCount();
  await page.keyboard.press('Tab', { delay: 60 });
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab', { delay: 60 });
  await page.keyboard.up('Shift');
  await h.untilDelivered(before, 2, 0x09);
  events = await h.events();
  const tabEntries = (await h.delivered()).slice(before).filter((entry) => entry.vk === 0x09);
  check(`${p} Tab and Shift+Tab leave the keyboard in the panel`, await h.hasKeys());
  check(
    `${p} Tab gives the program no key-down and no character, but its key-up`,
    same(
      tabEntries.map((entry) => entry.kind),
      ['keyUp', 'keyUp'],
    ) && (await h.byte(downs(0x09))) === 0,
    JSON.stringify(tabEntries),
  );
  check(
    `${p} the key-downs of Tab are cancelled`,
    events.filter((e) => e.type === 'keydown' && e.key === 'Tab').every((e) => e.prevented),
  );

  // The menu shortcuts of the platform's key map.
  await h.clearCommands();
  const shortcut = mac ? ['Meta', 'KeyO'] : ['Control', 'KeyO'];
  await page.keyboard.down(shortcut[0]);
  await page.keyboard.press(shortcut[1], { delay: 80 });
  await page.keyboard.up(shortcut[0]);
  await h.untilByte(ups(0x4f), 1);
  check(
    `${p} ${mac ? 'Cmd+O' : 'Ctrl+O'} runs Open and is not seen by task 19`,
    same(await h.commandsRun(), ['sim.file.open']) && (await h.byte(downs(0x4f))) === 0,
    (await h.commandsRun()).join(', '),
  );

  // Rule 4: Alt+Enter is seen by task 19 and by a key-down interrupt, and then toggles full screen.
  const interruptsBefore = await h.long(KEYS.interrupts);
  await page.keyboard.down('Alt');
  await page.keyboard.down('Enter');
  const enterSeen = await h.untilByte(downs(0x0d), 1);
  const entered = await h.until(() => window.__output.fullScreenPhase() !== 'windowed');
  const full = await h.until(() => window.__output.fullScreenPhase() === 'full');
  await page.keyboard.up('Enter');
  await page.keyboard.up('Alt');
  check(`${p} ${mac ? 'Option+Return' : 'Alt+Enter'} is seen by task 19`, enterSeen);
  check(
    `${p} ... and by the key-down interrupt (the handler read it with task 19)`,
    (await h.byte(KEYS.interruptDowns + 0x0d)) === 1 && (await h.long(KEYS.interrupts)) >= interruptsBefore + 2,
    `${(await h.long(KEYS.interrupts)) - interruptsBefore} interrupts`,
  );
  check(`${p} ... and then toggles full screen`, entered && full, await h.fullScreen());
  check(`${p} the panel told the engine (SimOption.Fullscreen)`, (await h.engineFullScreen()) === 1);
  const enterEntries = (await h.delivered()).filter((entry) => entry.kind === 'keyDown' && entry.vk === 0x0d);
  check(
    `${p} Alt+Enter carries no character`,
    enterEntries.length > 0 && enterEntries.every((entry) => entry.ch === undefined),
    JSON.stringify(enterEntries),
  );
  await h.shot(`${name}-${os}-fullscreen.png`);
  await page.keyboard.down('Alt');
  await page.keyboard.press('Enter', { delay: 80 });
  await page.keyboard.up('Alt');
  check(
    `${p} ${mac ? 'Option+Return' : 'Alt+Enter'} again leaves full screen`,
    (await h.until(() => window.__output.fullScreenPhase() === 'windowed')) && (await h.engineFullScreen()) === 0,
  );
  noErrors(p, h);
  await page.close();

  // After task 24 the eleven shortcuts reach the program and only the release chord acts.
  h = await openHarness(context, { os });
  ({ page, KEYS } = h);
  await h.start('keyWatchProgram', { keyCommandsOff: true });
  await h.until(() => window.__output.engine.state().keyCommandsDisabled === true);
  await h.clickSurface();
  const eleven = [
    [['F6'], 0x75],
    [['F7'], 0x76],
    [['F8'], 0x77],
    [['F9'], 0x78],
    [['F10'], 0x79],
    [['Control', 'KeyO'], 0x4f],
    [['Control', 'F2'], 0x71],
    [['Control', 'F3'], 0x72],
    [['Control', 'F9'], 0x78],
    [['Control', 'F4'], 0x73],
    [['Control', 'F5'], 0x74],
  ];
  const missed = [];
  for (const [keys, vk] of eleven) {
    await h.poke(KEYS.downs + vk, [0]);
    if (!(await hold(page, keys, () => h.untilByte(KEYS.downs + vk, 1)))) missed.push(keys.join('+'));
  }
  events = await h.events();
  check(`${p} after task 24 the eleven shortcuts reach the program`, missed.length === 0, missed.join(', '));
  check(`${p} ... run nothing ...`, (await h.commandsRun()).length === 0, (await h.commandsRun()).join(', '));
  check(
    `${p} ... and are cancelled, so the browser does not act on them either`,
    events.filter((e) => e.type === 'keydown').every((e) => e.prevented),
    JSON.stringify(events.filter((e) => e.type === 'keydown' && !e.prevented)),
  );
  // The I/O window's own commands do not act either: Alt+Enter is a key, nothing more.
  await h.poke(KEYS.downs + 0x0d, [0]);
  const plainEnter = await hold(page, ['Alt', 'Enter'], () => h.untilByte(KEYS.downs + 0x0d, 1));
  await page.waitForTimeout(150);
  check(
    `${p} after task 24 Alt+Enter reaches the program and does not toggle full screen`,
    plainEnter && (await h.fullScreen()) === 'windowed',
    await h.fullScreen(),
  );
  // Find keeps its shortcut in every case.
  await page.keyboard.down(mac ? 'Meta' : 'Control');
  await page.keyboard.press('KeyF', { delay: 80 });
  await page.keyboard.up(mac ? 'Meta' : 'Control');
  check(
    `${p} after task 24 ${mac ? 'Cmd+F' : 'Ctrl+F'} still runs Find`,
    same(await h.commandsRun(), ['sim.search.find']),
    (await h.commandsRun()).join(', '),
  );
  // The release chord: nothing for the program, the focus moves to the next panel.
  await page.waitForTimeout(100);
  await h.poke(KEYS.downs + 0x4f, [0]); // Ctrl+O above left its marks
  await h.poke(KEYS.ups + 0x4f, [0]);
  await h.events();
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.keyboard.down('KeyO');
  const released = await h.until(() => document.activeElement?.matches('[data-e68-keys="program"]') !== true);
  await page.keyboard.up('KeyO');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  events = await h.events();
  check(
    `${p} ${mac ? 'Ctrl+Option+O' : 'Ctrl+Alt+O'} releases the keyboard: the focus moves to the next panel`,
    released && (await h.activePanel()) === 'listing',
    `focus in ${await h.activePanel()}`,
  );
  check(
    `${p} ... and nothing of the O key reaches the program`,
    (await h.byte(KEYS.downs + 0x4f)) === 0 && (await h.byte(KEYS.ups + 0x4f)) === 0,
  );
  check(
    `${p} ... and its key-down is cancelled`,
    events.find((e) => e.type === 'keydown' && e.code === 'KeyO')?.prevented === true,
  );
  await h.shot(`${name}-${os}-released.png`);
  noErrors(p, h);
  await context.close();
}

// --- text: typing, repeat, dead keys, composition --------------------------------------------

async function textPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const h = await openHarness(context);
  const { page, LINES } = h;
  const line = (index) => h.string(LINES.text + index * LINES.size);
  const lineBytes = (index, length) => h.bytes(LINES.text + index * LINES.size, length);
  await h.start('lineInputProgram');
  await h.until(() => window.__output.controller.phase === 'waitInput');
  await h.clickSurface();
  await h.events();

  // A held letter repeats (Playwright marks every key-down after the first as a repeat).
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('a');
    await page.waitForTimeout(40);
  }
  await page.keyboard.up('a');
  await page.keyboard.press('Enter', { delay: 60 });
  await h.untilLong(LINES.count, 1);
  let events = (await h.events()).filter((e) => e.type === 'keydown' && e.key === 'a');
  check(`${p} a held letter repeats`, (await line(0)) === 'aaaa', await line(0));
  check(
    `${p} the repeats are real repeats and every one is cancelled (no accent menu, no scrolling)`,
    events.length === 4 && events.slice(1).every((e) => e.repeat) && events.every((e) => e.prevented),
    JSON.stringify(events),
  );
  check(
    `${p} nothing is left in the hidden textarea`,
    (await page.evaluate(() => document.querySelector('[data-e68-keys="program"]').value)) === '',
  );

  // Editing keys: Backspace and Ctrl+H remove a character; Ctrl+I is $09.
  await page.keyboard.type('abX', { delay: 50 });
  await page.keyboard.press('Backspace', { delay: 50 });
  await page.keyboard.type('cY', { delay: 50 });
  await page.keyboard.press('Control+KeyH', { delay: 50 });
  await page.keyboard.press('Control+KeyI', { delay: 50 });
  await page.keyboard.press('Enter', { delay: 60 });
  await h.untilLong(LINES.count, 2);
  check(
    `${p} Backspace and Ctrl+H edit the line; Ctrl+I is $09`,
    same(await lineBytes(1, 5), [0x61, 0x62, 0x63, 0x09, 0]),
  );

  // A dead-key sequence as Chromium on Windows delivers it: the dead key (no character, not
  // cancelled), then a key-down that carries the composed character.
  const deadPrevented = await h.sendKey('keydown', { key: 'Dead', code: 'Quote' });
  await h.sendKey('keyup', { key: 'Dead', code: 'Quote' });
  const composedPrevented = await h.sendKey('keydown', { key: 'é', code: 'KeyE' });
  await h.sendKey('keyup', { key: 'é', code: 'KeyE' });
  check(`${p} the dead key itself is not cancelled; the key that completes it is`, !deadPrevented && composedPrevented);

  // The same sequence as macOS delivers it: the dead key starts a composition, the keys during
  // it are marked (isComposing, keyCode 229), and the browser puts the result into the textarea.
  // Both orders of the two final events occur in browsers.
  const compose = (text, order) =>
    page.evaluate(
      ([result, eventOrder]) => {
        const field = document.querySelector('[data-e68-keys="program"]');
        const fire = (event) => field.dispatchEvent(event);
        const downs = [];
        const key = (init) => {
          const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
          Object.defineProperty(event, 'keyCode', { value: 229 });
          fire(event);
          downs.push(event.defaultPrevented);
        };
        key({ key: 'Dead', code: 'KeyE', altKey: true });
        fire(new CompositionEvent('compositionstart', { bubbles: true }));
        key({ key: result.normalize('NFD')[0], code: 'KeyA', isComposing: true });
        field.value = result;
        const final = {
          compositionend: () => fire(new CompositionEvent('compositionend', { bubbles: true, data: result })),
          input: () => fire(new InputEvent('input', { bubbles: true, data: result, isComposing: false })),
        };
        for (const type of eventOrder) final[type]();
        return { downs, left: field.value };
      },
      [text, order],
    );
  const first = await compose('á', ['compositionend', 'input']);
  const second = await compose('ö', ['input', 'compositionend']);
  check(
    `${p} keys during a composition are not cancelled, and the textarea is emptied`,
    [...first.downs, ...second.downs].every((prevented) => !prevented) && first.left === '' && second.left === '',
  );

  // A composed character that the browser inserts itself (an input method, the emoji picker).
  await page.keyboard.insertText('ñ€');
  await page.keyboard.insertText('日'); // not in Windows-1252: nothing
  await page.keyboard.press('Enter', { delay: 60 });
  await h.untilLong(LINES.count, 3);
  check(
    `${p} a dead-key sequence and composed characters arrive in task 2, each once`,
    same(await lineBytes(2, 6), [0xe9, 0xe1, 0xf6, 0xf1, 0x80, 0]),
    (await lineBytes(2, 8)).map(hex).join(' '),
  );

  // Chromium only: a real composition through the browser's input-method interface.
  if (browser.browserType().name() === 'chromium') {
    const client = await context.newCDPSession(page);
    await client.send('Input.imeSetComposition', { text: 'u', selectionStart: 1, selectionEnd: 1 });
    await client.send('Input.imeSetComposition', { text: 'ü', selectionStart: 1, selectionEnd: 1 });
    await client.send('Input.insertText', { text: 'ü' });
    await page.keyboard.press('Enter', { delay: 60 });
    await h.untilLong(LINES.count, 4);
    check(
      `${p} a composition made by the browser's own input-method machinery arrives once`,
      same(await lineBytes(3, 2), [0xfc, 0]),
      (await lineBytes(3, 4)).map(hex).join(' '),
    );
  }
  await h.shot(`${name}-text.png`);
  noErrors(p, h);
  await context.close();
}

// --- paste -----------------------------------------------------------------------------------

async function pastePass(browser, name, os) {
  const p = `${name}/${os}:`;
  const chord = os === 'mac' ? 'Cmd+V' : 'Shift+Insert';
  const context = await newContext(browser);

  // `HELLO` into a task 5 loop stores `HO`.
  let h = await openHarness(context, { os });
  await h.start('charLoopProgram');
  await h.until(() => window.__output.controller.phase === 'waitInput');
  await h.clickSurface();
  const before = await h.deliveredCount();
  const result = await h.pasteChord('HELLO');
  await h.untilLong(h.CHARS.count, 2);
  await h.page.waitForTimeout(150);
  check(
    `${p} the key-down of ${chord} is not cancelled (the browser must fire paste); the paste event is`,
    result.downPrevented === false && result.pastePrevented === true && result.fieldValue === '',
    JSON.stringify(result),
  );
  check(
    `${p} pasting HELLO into a task 5 loop stores HO`,
    (await h.string(h.CHARS.text)) === 'HO' && (await h.long(h.CHARS.count)) === 2,
    `${JSON.stringify(await h.string(h.CHARS.text))}, ${await h.long(h.CHARS.count)} characters`,
  );
  // (The entries of the click that gave the panel the keyboard may be delivered in between.)
  const chordKey = os === 'mac' ? 0x56 : 0x2d;
  await h.untilDelivered(before, 2, chordKey);
  const entries = (await h.delivered()).slice(before).filter((entry) => entry.vk === chordKey);
  check(
    `${p} key and text reached the engine as one entry, then the key-up`,
    same(
      entries.map((entry) => [entry.kind, entry.paste]),
      [
        ['keyDown', 'HELLO'],
        ['keyUp', undefined],
      ],
    ),
    JSON.stringify(entries),
  );
  if (os === 'windows') {
    // Ctrl+V is not a paste chord on Windows: the original delivers the character $16.
    await h.page.keyboard.press('Control+KeyV', { delay: 60 });
    await h.untilLong(h.CHARS.count, 3);
    check(
      `${p} Ctrl+V gives the program the character $16`,
      same(await h.bytes(h.CHARS.text, 4), [0x48, 0x4f, 0x16, 0]),
    );
  }
  noErrors(p, h);
  await h.page.close();

  // A two-line paste into task 2 fills one input; LF line ends terminate the line.
  h = await openHarness(context, { os });
  const { LINES } = h;
  await h.start('lineInputProgram');
  await h.until(() => window.__output.controller.phase === 'waitInput');
  await h.clickSurface();
  await h.pasteChord('ONE\r\nTWO');
  const one = await h.untilLong(LINES.count, 1);
  await h.page.waitForTimeout(150);
  check(
    `${p} a two-line paste into task 2 fills one input`,
    one && (await h.long(LINES.count)) === 1 && (await h.string(LINES.text)) === 'ONE',
    `${await h.long(LINES.count)} line(s), ${JSON.stringify(await h.string(LINES.text))}`,
  );
  await h.page.keyboard.press('Enter', { delay: 60 });
  await h.untilLong(LINES.count, 2);
  check(
    `${p} of the second line only the last character survives as type-ahead`,
    (await h.string(LINES.text + LINES.size)) === 'O',
    JSON.stringify(await h.string(LINES.text + LINES.size)),
  );
  await h.pasteChord('ABC\nDEF'); // what a browser on macOS or Linux puts on the clipboard
  await h.untilLong(LINES.count, 3);
  check(
    `${p} a paste with LF line ends terminates the line`,
    (await h.string(LINES.text + 2 * LINES.size)) === 'ABC',
    JSON.stringify(await h.string(LINES.text + 2 * LINES.size)),
  );
  // 300 characters give 254 bytes; the 80th key of a line ends it (trap15-a §3.9).
  await h.page.keyboard.press('Enter', { delay: 60 });
  await h.untilLong(LINES.count, 4);
  const sizeBefore = await h.deliveredCount();
  await h.pasteChord('x'.repeat(300));
  await h.untilLong(LINES.count, 5);
  const long = (await h.delivered()).slice(sizeBefore).find((entry) => entry.paste !== undefined);
  check(`${p} a paste of 300 characters delivers 254`, long?.paste.length === 254, `${long?.paste.length}`);
  noErrors(p, h);
  await h.page.close();

  // An empty clipboard fires no paste event: the key goes out alone.
  h = await openHarness(context, { os });
  await h.start('keyWatchProgram');
  await h.clickSurface();
  const count = await h.deliveredCount();
  await h.pasteChord(null);
  const vk = os === 'mac' ? 0x56 : 0x2d;
  check(
    `${p} with an empty clipboard the key-down of ${chord} still reaches the program`,
    await h.untilByte(h.KEYS.downs + vk, 1),
  );
  await h.untilDelivered(count, 2, vk);
  const alone = (await h.delivered()).slice(count).filter((entry) => entry.vk === vk);
  check(
    `${p} ... without text, before its key-up`,
    same(
      alone.map((entry) => [entry.kind, entry.paste]),
      [
        ['keyDown', undefined],
        ['keyUp', undefined],
      ],
    ),
    JSON.stringify(alone),
  );

  // What the browser itself does with the real key. Reading a clipboard changes nothing; what it
  // holds on this machine is unknown, so only the events are looked at.
  await h.events();
  const real = os === 'mac' ? ['Meta', 'KeyV'] : ['Shift', 'Insert'];
  await h.page.keyboard.down(real[0]);
  await h.page.keyboard.press(real[1], { delay: 80 });
  await h.page.keyboard.up(real[0]);
  await h.page.waitForTimeout(200);
  const realEvents = await h.events();
  const realDown = realEvents.find((e) => e.type === 'keydown' && e.code === (os === 'mac' ? 'KeyV' : 'Insert'));
  check(`${p} the real key-down of ${chord} is not cancelled`, realDown?.prevented === false, JSON.stringify(realDown));
  note(
    `${p} this headless browser ${realEvents.some((e) => e.type === 'paste') ? 'fired' : 'did not fire'} a paste event for the real ${chord}`,
  );
  noErrors(p, h);
  await context.close();
}

// --- focus -----------------------------------------------------------------------------------

async function focusPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  let h = await openHarness(context);
  let { page, KEYS } = h;
  await h.start('keyWatchProgram');
  await h.clickSurface();
  await h.poke(KEYS.watch, [0, 0, 0, 0x25]); // the Left arrow

  await page.keyboard.down('ArrowLeft');
  check(`${p} a held arrow key is down for task 19`, await h.untilLong(KEYS.state, 0xff));
  const before = await h.deliveredCount();
  // The focus leaves: a click into the Listing panel.
  await page.locator('[data-e68-panel="listing"]').click();
  await page.waitForTimeout(200);
  check(`${p} the focus is in another panel`, !(await h.hasKeys()) && (await h.activePanel()) === 'listing');
  check(
    `${p} nothing is posted on focus loss`,
    (await h.deliveredCount()) === before,
    JSON.stringify((await h.delivered()).slice(before)),
  );
  check(`${p} the key stays down for task 19, as in the original`, (await h.long(KEYS.state)) === 0xff);
  await page.keyboard.up('ArrowLeft'); // released elsewhere: the program never hears of it
  await page.waitForTimeout(100);
  check(`${p} a key-up outside the panel is not delivered`, (await h.deliveredCount()) === before);

  await h.clickSurface();
  check(
    `${p} ioActivated on focus: the key table is cleared`,
    (await h.untilLong(KEYS.state, 0)) &&
      (await h.delivered()).slice(before).some((entry) => entry.kind === 'ioActivated'),
    JSON.stringify((await h.delivered()).slice(before, before + 3)),
  );
  noErrors(p, h);
  await page.close();

  // macOS sends no key-up for a key released while Command is held.
  h = await openHarness(context, { os: 'mac' });
  ({ page, KEYS } = h);
  await h.start('keyWatchProgram');
  await h.clickSurface();
  await h.poke(KEYS.watch, [0, 0, 0, 0x27]); // the Right arrow
  await page.keyboard.down('Meta');
  await page.keyboard.down('ArrowRight');
  check(
    `${p} macOS key map: an arrow pressed with Command held is down for task 19`,
    await h.untilLong(KEYS.state, 0xff),
  );
  // The arrow's own key-up never comes (it is still "pressed" for Playwright); Command goes up.
  await page.keyboard.up('Meta');
  check(
    `${p} key-ups are restored when Meta is released`,
    (await h.untilLong(KEYS.state, 0)) && (await h.byte(KEYS.ups + 0x27)) === 1,
  );
  await page.keyboard.up('ArrowRight');
  noErrors(p, h);
  await context.close();
}

// --- mouse -----------------------------------------------------------------------------------

async function mousePass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const h = await openHarness(context);
  const { page, MOUSE } = h;
  await h.start('mouseWatchProgram');
  // 200 %: two CSS pixels per surface pixel, and the surface does not fit, which must not matter.
  await page.locator('.e68-output__header select').selectOption('2');
  await page.waitForTimeout(100);
  const canvas = await h.canvas();
  const client = (x, y) => [canvas.left + 2 * x + 1, canvas.top + 2 * y + 1];
  const position = (x, y) => ((y << 16) | (x & 0xffff)) >>> 0;
  const LEFT = 1;
  const RIGHT = 2;
  const DOUBLE = 8;
  const SHIFT = 16;

  await page.mouse.move(...client(10, 20));
  check(
    `${p} a move reports the surface pixel under the pointer, whatever the zoom`,
    await h.untilLong(MOUSE.currentPosition, position(10, 20)),
    hex(await h.long(MOUSE.currentPosition)),
  );
  await page.keyboard.down('Shift');
  await page.mouse.down();
  check(
    `${p} a press: Left and Shift in the current state and in the "down" snapshot`,
    (await h.untilLong(MOUSE.down, LEFT | SHIFT)) && (await h.long(MOUSE.current)) === (LEFT | SHIFT),
    `${hex(await h.long(MOUSE.down))} ${hex(await h.long(MOUSE.current))}`,
  );
  await page.keyboard.up('Shift');
  check(`${p} the press gives the panel the keyboard`, await h.hasKeys());

  // The left button captures: positions beyond the surface, left of it and above it.
  await page.mouse.move(canvas.left - 30, canvas.top - 20);
  const outside = await h.untilLong(MOUSE.currentPosition, position(-15, -10));
  check(
    `${p} a left drag reports positions outside the surface, not clamped`,
    outside,
    hex(await h.long(MOUSE.currentPosition)),
  );
  await page.mouse.up();
  check(
    `${p} the release is reported where it happens, with no button left (rule 2)`,
    (await h.untilLong(MOUSE.upPosition, position(-15, -10))) &&
      (await h.long(MOUSE.up)) === 0 &&
      (await h.long(MOUSE.current)) === 0,
    `${hex(await h.long(MOUSE.upPosition))} ${hex(await h.long(MOUSE.up))}`,
  );

  // A double-click: Double on the second press only (rule 3).
  await page.mouse.move(...client(40, 50));
  await page.mouse.click(...client(40, 50), { clickCount: 2, delay: 40 });
  check(
    `${p} a double-click sets Double in the "down" snapshot, never in the "up" snapshot`,
    (await h.untilLong(MOUSE.down, LEFT | DOUBLE)) &&
      // The last release clears the current state; it reaches the program an input edge later.
      (await h.untilLong(MOUSE.current, 0)) &&
      (await h.long(MOUSE.up)) === 0 &&
      (await h.long(MOUSE.down)) === (LEFT | DOUBLE),
    `${hex(await h.long(MOUSE.down))} ${hex(await h.long(MOUSE.up))} ${hex(await h.long(MOUSE.current))}`,
  );

  // The right button: reported, and no context menu.
  await h.events();
  await page.mouse.click(...client(60, 70), { button: 'right', delay: 60 });
  const menus = (await h.events()).filter((e) => e.type === 'contextmenu');
  check(
    `${p} a right click is reported as Right at its position`,
    (await h.untilLong(MOUSE.down, RIGHT)) && (await h.long(MOUSE.downPosition)) === position(60, 70),
    `${hex(await h.long(MOUSE.down))} ${hex(await h.long(MOUSE.downPosition))}`,
  );
  check(
    `${p} the context menu is suppressed`,
    menus.every((e) => e.prevented),
    JSON.stringify(menus),
  );
  // The right button does not capture: beside the surface nothing is reported.
  await page.mouse.move(...client(5, 5));
  await page.mouse.down({ button: 'right' });
  await h.untilLong(MOUSE.downPosition, position(5, 5));
  await page.mouse.move(canvas.left - 30, canvas.top + 10);
  await page.waitForTimeout(150);
  check(
    `${p} the right button does not capture: no positions from outside the surface`,
    (await h.long(MOUSE.currentPosition)) === position(5, 5) ||
      (await h.long(MOUSE.currentPosition)) === position(0, 5),
    hex(await h.long(MOUSE.currentPosition)),
  );
  await page.mouse.up({ button: 'right' });
  noErrors(p, h);
  await context.close();
}

// --- full screen (2.5) ------------------------------------------------------------------------

/** What the headless browser does with a real full-screen request made inside a click. */
async function probeFullScreen(browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(harnessUrl);
  await page.evaluate(() => {
    window.__probe = 'none';
    document.addEventListener('click', () => {
      if (!document.fullscreenEnabled) return void (window.__probe = 'disabled');
      document.documentElement.requestFullscreen().then(
        () => (window.__probe = document.fullscreenElement ? 'entered' : 'no element'),
        (error) => (window.__probe = `rejected: ${error?.message ?? error}`),
      );
    });
  });
  await page.mouse.click(50, 50);
  await page.waitForFunction(() => window.__probe !== 'none', null, { timeout: 5000 }).catch(() => {});
  const result = await page.evaluate(() => window.__probe);
  await context.close();
  return result === 'none' ? 'never settled' : result;
}

/**
 * A stand-in for the browser's Fullscreen API, for a headless browser that has none: the same
 * calls, promises and `fullscreenchange` events, without a screen behind them.
 */
function fakeFullscreenApi() {
  let element = null;
  const change = (next) => {
    element = next;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
  Element.prototype.requestFullscreen = function request() {
    if (!navigator.userActivation?.isActive) return Promise.reject(new TypeError('Not allowed without a user gesture'));
    return new Promise((done) =>
      setTimeout(() => {
        change(this);
        done();
      }, 0),
    );
  };
  document.exitFullscreen = () =>
    new Promise((done) =>
      setTimeout(() => {
        change(null);
        done();
      }, 0),
    );
}

async function fullScreenPass(browser, name) {
  const p = `${name}:`;
  const fresh = async (options) => {
    const context = await newContext(browser);
    return { context, h: await openHarness(context, options) };
  };
  const isFull = (h) => h.until(() => window.__output.fullScreenPhase() === 'full');
  const isWindowed = (h) => h.until(() => window.__output.fullScreenPhase() === 'windowed');
  /** The panel covers the window, black, with the surface centred at a whole-number scale. */
  const layout = (h) =>
    h.page.evaluate(() => {
      const panel = document.querySelector('.e68-output').getBoundingClientRect();
      const canvas = document.querySelector('.e68-output__canvas').getBoundingClientRect();
      const style = window.getComputedStyle(document.querySelector('.e68-output'));
      return {
        covers:
          panel.left === 0 &&
          panel.top === 0 &&
          panel.width === window.innerWidth &&
          panel.height === window.innerHeight,
        header: window.getComputedStyle(document.querySelector('.e68-output__header')).display,
        background: style.backgroundColor,
        scale: canvas.width / 640,
        fit: Math.max(1, Math.floor(Math.min(window.innerWidth / 640, window.innerHeight / 480))),
        centred:
          Math.abs(canvas.left - (window.innerWidth - canvas.width) / 2) <= 0.5 &&
          Math.abs(canvas.top - (window.innerHeight - canvas.height) / 2) <= 0.5,
        rootIsFullscreen: document.fullscreenElement === document.documentElement,
        window: `${window.innerWidth}x${window.innerHeight}`,
      };
    });

  /** Waits until the full-screen layout has settled: the panel covers the window, the surface is centred. */
  const laidOutFull = (h) =>
    h.until(() => {
      const panel = document.querySelector('.e68-output').getBoundingClientRect();
      const canvas = document.querySelector('.e68-output__canvas').getBoundingClientRect();
      return (
        panel.width === window.innerWidth &&
        panel.height === window.innerHeight &&
        Math.abs(canvas.left - (window.innerWidth - canvas.width) / 2) <= 0.5 &&
        Math.abs(canvas.top - (window.innerHeight - canvas.height) / 2) <= 0.5
      );
    });

  // 1. The user toggles with the button.
  let { context, h } = await fresh();
  await h.start('pictureProgram');
  await h.clickSurface();
  await h.page.locator('.e68-output__header button[aria-label^="Full Screen"]').click();
  check(`${p} the full-screen button enters full screen`, await isFull(h), await h.fullScreen());
  await laidOutFull(h);
  let state = await layout(h);
  check(`${p} the Fullscreen API shows the page's root element`, state.rootIsFullscreen);
  check(
    `${p} the panel covers the window, the header strip is gone`,
    state.covers && state.header === 'none',
    JSON.stringify(state),
  );
  check(
    `${p} the surface is centred, scaled by the largest whole number that fits (${state.fit}x in ${state.window}), black around it`,
    state.scale === state.fit && state.centred && state.background === 'rgb(0, 0, 0)',
    JSON.stringify(state),
  );
  check(`${p} the engine knows (SimOption.Fullscreen = 1)`, (await h.engineFullScreen()) === 1);
  check(
    `${p} the store knows (AppState.sim.output.fullScreen)`,
    await h.page.evaluate(() => window.__output.ctx.store.getState().sim.output.fullScreen),
  );
  check(
    `${p} the full-screen panel has the keyboard`,
    await h.until(() => document.activeElement?.matches('[data-e68-keys="program"]') === true),
  );
  await h.shot(`${name}-fullscreen-button.png`);

  // A dialog opened meanwhile (a program's file dialog, a message box) is on top and usable.
  await h.page.evaluate(() => {
    window.__answer = window.__output.ctx.dialogs.messageBox({
      title: 'Information',
      text: 'A box over the full-screen surface',
      icon: 'information',
      buttons: ['OK'],
    });
  });
  await h.page.waitForSelector('[role=alertdialog]');
  const onTop = await h.page.evaluate(() => {
    const box = document.querySelector('[role=alertdialog]').getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 10);
    return hit?.closest('[role=alertdialog]') !== null;
  });
  check(`${p} a message box opened in full screen is drawn above the surface`, onTop);
  await h.shot(`${name}-fullscreen-dialog.png`);
  await h.page.locator('[role=alertdialog] button', { hasText: 'OK' }).click();
  await h.until(() => document.querySelector('[role=alertdialog]') === null);

  // 2. Full screen ends without the port asking (the browser's Esc, a tab switch).
  await h.page.evaluate(() => document.exitFullscreen());
  check(
    `${p} full screen ended by the browser: the panel is windowed again`,
    await isWindowed(h),
    await h.fullScreen(),
  );
  check(
    `${p} ... and the engine's flag is set back`,
    (await h.until(() => window.__output.engine.getOption(11) === 0)) &&
      !(await h.page.evaluate(() => window.__output.ctx.store.getState().sim.output.fullScreen)),
  );
  await h.until(() => window.getComputedStyle(document.querySelector('.e68-output__header')).display !== 'none');
  state = await layout(h);
  check(`${p} ... and the header strip is back`, state.header !== 'none' && !state.covers);
  noErrors(p, h);
  await context.close();

  // 3. Deferred: a program asks (task 33) while no user gesture is active. Everything this
  // script does to a page counts as a user gesture there for a few seconds (the automation
  // channel says so), so the requests are made by the pages themselves, later: four pages are
  // prepared, then left alone until their gestures have run out.
  // (Browsers keep a gesture "active" for five seconds.) Starting the program is the last thing
  // done to its page; Run gives the panel the keyboard by itself.
  const GESTURE_RUNS_OUT_MS = 6500;
  const a = await fresh();
  const b = await fresh();
  const c = await fresh();
  const d = await fresh();
  for (const { h: page } of [a, b, d]) {
    await page.start('keyWatchProgram', { askFullScreen: true, askFullScreenAfter: GESTURE_RUNS_OUT_MS / 10 });
  }
  await c.h.start('mouseWatchProgram');
  await c.h.page.evaluate(
    (ms) => setTimeout(() => window.__output.ctx.commands.run('sim.output.fullscreen', true), ms),
    GESTURE_RUNS_OUT_MS,
  ); // the /f switch
  await new Promise((done) => setTimeout(done, GESTURE_RUNS_OUT_MS + 1500));

  ({ context, h } = a);
  const prompt = h.page.locator('.e68-output__prompt');
  check(
    `${p} a program asks without a gesture: the request waits`,
    (await h.fullScreen()) === 'waiting' && (await h.engineFullScreen()) === 1,
    await h.fullScreen(),
  );
  check(
    `${p} the panel shows "Press any key or click to enter full screen"`,
    (await prompt.count()) === 1 && (await prompt.innerText()) === 'Press any key or click to enter full screen',
  );
  await h.shot(`${name}-fullscreen-waiting.png`);
  // The request is dropped if the program asks for windowed mode first.
  await h.poke(h.KEYS.askWindowed, [1]);
  check(
    `${p} the request is dropped when the program asks for windowed mode`,
    (await isWindowed(h)) && (await prompt.count()) === 0,
  );
  noErrors(p, h);
  await context.close();

  // ... and carried out by the next key, which the program receives as well.
  ({ context, h } = b);
  const waitingForKey = (await h.fullScreen()) === 'waiting' && (await h.hasKeys());
  await h.page.keyboard.down('KeyA');
  const byKey = await isFull(h);
  const keySeen = await h.untilByte(h.KEYS.downs + 0x41, 1);
  await h.page.keyboard.up('KeyA');
  check(`${p} the next key enters full screen`, waitingForKey && byKey, await h.fullScreen());
  check(`${p} ... and is delivered to the program as well`, keySeen);
  check(`${p} ... and the prompt is gone`, (await h.page.locator('.e68-output__prompt').count()) === 0);
  noErrors(p, h);
  await context.close();

  // ... or by a click on the surface.
  ({ context, h } = c);
  check(
    `${p} the command without a gesture (the /f switch) waits as well`,
    (await h.fullScreen()) === 'waiting',
    await h.fullScreen(),
  );
  const box = await h.canvas();
  await h.page.mouse.click(box.left + 20, box.top + 30);
  check(`${p} a click on the surface enters full screen`, await isFull(h), await h.fullScreen());
  check(
    `${p} ... and is delivered to the program as well`,
    await h.untilLong(h.MOUSE.downPosition, ((30 << 16) | 20) >>> 0),
    hex(await h.long(h.MOUSE.downPosition)),
  );
  noErrors(p, h);
  await context.close();

  // ... or by the full-screen button, which then does not toggle straight back.
  ({ context, h } = d);
  const waitingForButton = (await h.fullScreen()) === 'waiting';
  await h.page.locator('.e68-output__header button[aria-label^="Full Screen"]').click();
  const byButton = await isFull(h);
  await h.page.waitForTimeout(300);
  check(
    `${p} the full-screen button carries out a waiting request and stays in full screen`,
    waitingForButton && byButton && (await h.fullScreen()) === 'full',
    await h.fullScreen(),
  );
  noErrors(p, h);
  await context.close();

  // 4. Refused although a gesture was present: the original's failure box.
  ({ context, h } = await fresh());
  await h.start('keyWatchProgram');
  await h.page.evaluate(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Fullscreen request denied'));
  });
  await h.page.locator('.e68-output__header button[aria-label^="Full Screen"]').click();
  const boxShown = await h.page.waitForSelector('[role=alertdialog]', { timeout: 10000 }).then(
    () => true,
    () => false,
  );
  const boxText = boxShown ? await h.page.locator('[role=alertdialog]').innerText() : '';
  check(
    `${p} a refused request shows the original's box, title Information`,
    boxShown &&
      boxText.includes('Information') &&
      boxText.includes(
        "Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.",
      ),
    JSON.stringify(boxText),
  );
  await h.shot(`${name}-fullscreen-refused.png`);
  check(
    `${p} ... and stays windowed, with the engine's flag cleared`,
    (await h.fullScreen()) === 'windowed' && (await h.engineFullScreen()) === 0,
  );
  if (boxShown) await h.page.locator('[role=alertdialog] button', { hasText: 'OK' }).click();
  // Embedded without permission: the browser says so beforehand.
  await h.page.evaluate(() =>
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false }),
  );
  await h.page.locator('.e68-output__header button[aria-label^="Full Screen"]').click();
  check(
    `${p} where the page may not go full screen at all, the box comes at once`,
    await h.page.waitForSelector('[role=alertdialog]', { timeout: 10000 }).then(
      () => true,
      () => false,
    ),
  );
  noErrors(p, h);
  await context.close();

  // 5. The desktop app: the window goes full screen, the panel fills it; no gesture is needed.
  ({ context, h } = await fresh({ desktop: true }));
  await h.start('keyWatchProgram', { askFullScreen: true });
  check(
    `${p} desktop app: a program's request enters at once through Platform.setFullScreen`,
    (await isFull(h)) && same(await h.page.evaluate(() => window.__output.windowFullScreen), [true]),
    JSON.stringify(await h.page.evaluate(() => window.__output.windowFullScreen)),
  );
  await laidOutFull(h);
  state = await layout(h);
  check(
    `${p} desktop app: the panel fills the window, black, the surface centred at a whole-number scale`,
    state.covers && state.header === 'none' && state.scale === state.fit && state.centred,
    JSON.stringify(state),
  );
  check(`${p} desktop app: the Fullscreen API of the page is not used`, !state.rootIsFullscreen);
  await h.shot(`${name}-desktop-fullscreen.png`);
  await h.poke(h.KEYS.askWindowed, [1]);
  check(
    `${p} desktop app: the program's request for windowed mode leaves`,
    (await isWindowed(h)) && same(await h.page.evaluate(() => window.__output.windowFullScreen), [true, false]),
  );
  noErrors(p, h);
  await context.close();
}

// --- run -------------------------------------------------------------------------------------

/** The passes in order: [group for --only, title, function]. */
const PASSES = [
  ['panel', 'the panel, device pixel ratio 1', (browser, name) => presentationPass(browser, name, 1)],
  ['panel', 'the panel, device pixel ratio 2', (browser, name) => presentationPass(browser, name, 2)],
  ['panel', 'the panel: prompt, collapse, accessibility', panelPass],
  ['keys', 'keys, Windows key map', (browser, name) => keysPass(browser, name, 'windows')],
  ['keys', 'keys, macOS key map', (browser, name) => keysPass(browser, name, 'mac')],
  ['text', 'text', textPass],
  ['paste', 'paste, Windows key map', (browser, name) => pastePass(browser, name, 'windows')],
  ['paste', 'paste, macOS key map', (browser, name) => pastePass(browser, name, 'mac')],
  ['focus', 'focus', focusPass],
  ['mouse', 'mouse', mousePass],
  ['fullscreen', 'full screen', fullScreenPass],
];
/** --only panel,keys,...: run some groups only (while working on the script). */
const only = option('--only', '') ? option('--only', '').split(',') : null;

function freePort() {
  return new Promise((done, fail) => {
    const server = createNetServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // The page must not reload while it is being checked, whatever is edited meanwhile; and the
    // cache of prepared dependencies is this run's own, so that other dev servers cannot swap it.
    cacheDir: join(outDir, '.vite'),
    server: { port: await freePort(), strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  harnessUrl = `http://127.0.0.1:${port}/src/features/output/testing/harness.html`;
  console.log(`Harness: ${harnessUrl}\nScreenshots: ${outDir}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        useFakeFullscreen = false;
        const probe = await probeFullScreen(browser);
        useFakeFullscreen = probe !== 'entered';
        console.log(`\n[${name}]`);
        note(
          `a real full-screen request in this headless browser: ${probe}` +
            (useFakeFullscreen ? ' - the checks use a stand-in for the Fullscreen API' : ''),
        );
        for (const [group, title, run] of PASSES) {
          if (only && !only.includes(group)) continue;
          console.log(`\n[${name}, ${title}]`);
          try {
            await run(browser, name);
          } catch (error) {
            // A pass that broke off counts as a failure; the others still run.
            check(`${name}, ${title}: ran to its end`, false, String(error?.message ?? error).split('\n')[0]);
          }
        }
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
