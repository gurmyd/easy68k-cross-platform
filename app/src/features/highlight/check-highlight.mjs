// Browser check of the syntax highlighter (ARCHITECTURE.md 9.2 E3). Owner: E3.
//
//   node app/src/features/highlight/check-highlight.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port, opens the application in headless Chromium and
// WebKit (Playwright) and mounts CodeMirror views with the highlighter's extension
// (check/harness.ts), using the application's real settings service and theme. It checks what the
// unit tests under Node cannot show: the colours and attributes the browser really draws, in both
// themes, for the Auto preset, a stored preset, a custom preset and Disabled; list documents
// uncoloured; settings changes reaching an open view; a line coloured as soon as it is typed; and
// the time of a viewport pass over a 10,000-line document in the browser.
//
// Screenshots go to build/E3/highlight-check (git-ignored). Exit code 0 = everything passed.

/* global console, process, window, document, requestAnimationFrame, setTimeout -- browser globals inside page.evaluate() */

import { mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'E3', 'highlight-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** A free TCP port on 127.0.0.1, found by asking the system for one. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** The sample: the preview text of the Options dialog plus lines of editor-ui §20.1. */
const SAMPLE = [
  '* Syntax Highlight',
  'START   MOVE.B #1,D0',
  '        Macro/Other',
  '    if <NE> then',
  '    if <NE> tehn',
  "        DC.B 'HELLO'",
  'START:  ORG    $1000   set origin',
  '    BFINS   D0,(A0){4:8}',
  '    BRA     .loop       go back',
].join('\n');

const LINE = { comment: 1, labelCode: 2, unknown: 3, structure: 4, error: 5, directiveText: 6, org: 7, bfins: 8 };

const nextFrames = (page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 20)))),
  );

async function setEditor(page, patch) {
  await page.evaluate((value) => {
    window.__easy68k.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, ...value } }));
  }, patch);
  await nextFrames(page);
}

async function setTheme(page, theme) {
  await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), theme);
  await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
  await nextFrames(page);
}

/** [text, color, weight, style, decoration] of the marks of a line of the source view. */
const styles = (page, line) => page.evaluate((n) => window.__hl.lineStyles(window.__hl.source, n), line);
const colorOf = async (page, line, text) => (await styles(page, line)).find((m) => m[0].includes(text))?.[1];
const content = (page, which) => page.evaluate((w) => window.__hl.contentColors(window.__hl[w]), which);

async function runBrowser(browser, name, baseUrl) {
  const p = `${name}:`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl, { timeout: 120_000 });
  await page.waitForSelector('.e68-shell', { timeout: 120_000 });
  await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: 120_000 });
  await page.evaluate(async (sample) => {
    const harness = await import('/src/features/highlight/check/harness.ts');
    const presets = await import('/src/core/highlight/index.ts');
    const { ctx } = window.__easy68k;
    window.__hl = {
      ...harness,
      presets,
      source: harness.mountView(ctx, sample, 'source', { left: 20, top: 120, width: 600, height: 300 }),
      list: harness.mountView(ctx, sample, 'list', { left: 640, top: 120, width: 600, height: 300 }),
    };
  }, SAMPLE);
  await nextFrames(page);

  // --- Auto, light theme: the original defaults on white.
  await setTheme(page, 'light');
  const light = {
    comment: await colorOf(page, LINE.comment, 'Syntax'),
    label: await colorOf(page, LINE.labelCode, 'START'),
    code: await colorOf(page, LINE.labelCode, 'MOVE'),
    unknown: await colorOf(page, LINE.unknown, 'Macro'),
    structure: await colorOf(page, LINE.structure, 'if'),
    error: await colorOf(page, LINE.error, 'tehn'),
    directive: await colorOf(page, LINE.directiveText, 'DC.B'),
    text: await colorOf(page, LINE.directiveText, 'HELLO'),
  };
  const lightExpected = {
    comment: rgb('#0000FF'),
    label: rgb('#800080'),
    code: rgb('#000000'),
    unknown: rgb('#808000'),
    structure: rgb('#800000'),
    error: rgb('#FF0000'),
    directive: rgb('#008000'),
    text: rgb('#008080'),
  };
  check(
    `${p} Auto, light theme: the eight elements in the original's default colours`,
    JSON.stringify(light) === JSON.stringify(lightExpected),
    JSON.stringify(light),
  );
  const lightContent = await content(page, 'source');
  check(
    `${p} Auto, light theme: white background`,
    lightContent.background === rgb('#FFFFFF'),
    lightContent.background,
  );
  const listLight = await content(page, 'list');
  check(`${p} a list document has no syntax marks`, listLight.marks === 0, `${listLight.marks} marks`);
  check(
    `${p} vector 35 in the browser: only "back" is Comment`,
    JSON.stringify((await styles(page, 9)).filter((m) => m[1] === rgb('#0000FF')).map((m) => m[0])) ===
      JSON.stringify(['back']),
  );
  await page.screenshot({ path: join(outDir, `${name}-auto-light.png`) });

  // --- Auto, dark theme.
  await setTheme(page, 'dark');
  const dark = {
    comment: await colorOf(page, LINE.comment, 'Syntax'),
    label: await colorOf(page, LINE.labelCode, 'START'),
    code: await colorOf(page, LINE.labelCode, 'MOVE'),
    unknown: await colorOf(page, LINE.unknown, 'Macro'),
    structure: await colorOf(page, LINE.structure, 'if'),
    error: await colorOf(page, LINE.error, 'tehn'),
    directive: await colorOf(page, LINE.directiveText, 'DC.B'),
    text: await colorOf(page, LINE.directiveText, 'HELLO'),
  };
  const darkExpected = {
    comment: rgb('#6CB6FF'),
    label: rgb('#D2A8FF'),
    code: rgb('#E6EDF3'),
    unknown: rgb('#D4B24C'),
    structure: rgb('#FF938A'),
    error: rgb('#FF5F56'),
    directive: rgb('#6BC46D'),
    text: rgb('#56D4DD'),
  };
  check(
    `${p} Auto, dark theme: the dark palette of 2.8`,
    JSON.stringify(dark) === JSON.stringify(darkExpected),
    JSON.stringify(dark),
  );
  const darkContent = await content(page, 'source');
  check(`${p} Auto, dark theme: background #1B1F24`, darkContent.background === rgb('#1B1F24'), darkContent.background);
  await page.screenshot({ path: join(outDir, `${name}-auto-dark.png`) });

  // --- No Color, still in the dark theme: stored black on stored white, with attributes.
  await page.evaluate(() => {
    const { presets } = window.__hl;
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      editor: { ...s.editor, colorPreset: 2, styles: presets.NO_COLOR_STYLES, highlightDisabled: false },
    }));
  });
  await nextFrames(page);
  const label = (await styles(page, LINE.labelCode)).find((m) => m[0].includes('START'));
  const unknown = (await styles(page, LINE.unknown)).find((m) => m[0].includes('Macro'));
  const comment = (await styles(page, LINE.comment)).find((m) => m[0].includes('Syntax'));
  const noColorContent = await content(page, 'source');
  check(
    `${p} No Color in the dark theme: stored colours unchanged (black on white)`,
    label?.[1] === rgb('#000000') && noColorContent.background === rgb('#FFFFFF'),
    `${label?.[1]} on ${noColorContent.background}`,
  );
  check(
    `${p} No Color: Label bold, Macro/Other italic + underline, Comment italic`,
    (label?.[2] === '700' || label?.[2] === 'bold') &&
      unknown?.[3] === 'italic' &&
      unknown?.[4] === 'underline' &&
      comment?.[3] === 'italic' &&
      comment?.[4] === 'none',
    JSON.stringify({ label, unknown, comment }),
  );
  await page.screenshot({ path: join(outDir, `${name}-nocolor-dark-theme.png`) });

  // --- Color2.
  await page.evaluate(() => {
    const { presets } = window.__hl;
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      editor: { ...s.editor, colorPreset: 1, styles: presets.COLOR2_STYLES },
    }));
  });
  await nextFrames(page);
  check(
    `${p} Color2: Label navy, Comment green, Text maroon`,
    (await colorOf(page, LINE.labelCode, 'START')) === rgb('#000080') &&
      (await colorOf(page, LINE.comment, 'Syntax')) === rgb('#008000') &&
      (await colorOf(page, LINE.directiveText, 'HELLO')) === rgb('#800000'),
  );

  // --- Custom: a colour and an attribute of one element, a yellow background.
  await page.evaluate(() => {
    const { presets } = window.__hl;
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      editor: {
        ...s.editor,
        colorPreset: 3,
        backgroundColor: 0x00ffff,
        styles: {
          ...presets.COLOR1_STYLES,
          directive: { color: 0xff00ff, bold: false, italic: false, underline: true },
        },
      },
    }));
  });
  await nextFrames(page);
  const directive = (await styles(page, LINE.directiveText)).find((m) => m[0].includes('DC.B'));
  const customContent = await content(page, 'source');
  check(
    `${p} Custom: Directive fuchsia underlined on a yellow background`,
    directive?.[1] === rgb('#FF00FF') && directive?.[4] === 'underline' && customContent.background === rgb('#FFFF00'),
    `${JSON.stringify(directive)} on ${customContent.background}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-custom.png`) });

  // --- Disabled: no marks, everything in the Code colour.
  await page.evaluate(() => {
    const { presets } = window.__hl;
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      editor: { ...s.editor, colorPreset: 4, styles: presets.DISABLED_STYLES, highlightDisabled: true },
    }));
  });
  await nextFrames(page);
  const disabled = await content(page, 'source');
  check(
    `${p} Disabled: no marks, text in the Code colour`,
    disabled.marks === 0 && disabled.color === rgb('#000000'),
    JSON.stringify(disabled),
  );
  await page.screenshot({ path: join(outDir, `${name}-disabled.png`) });

  // --- Back to Auto (light); the bit-field option and typing.
  await page.evaluate(() => {
    const { presets } = window.__hl;
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      editor: {
        ...s.editor,
        colorPreset: 5,
        styles: presets.COLOR1_STYLES,
        highlightDisabled: false,
        backgroundColor: 0xffffff,
      },
    }));
  });
  await setTheme(page, 'light');
  check(`${p} bit-field option on: BFINS is Code`, (await colorOf(page, LINE.bfins, 'BFINS')) === rgb('#000000'));
  await setEditor(page, { assembleBitField: false });
  check(
    `${p} bit-field option off: BFINS is Macro/Other`,
    (await colorOf(page, LINE.bfins, 'BFINS')) === rgb('#808000'),
  );
  await setEditor(page, { assembleBitField: true });

  await page.evaluate(() => {
    const view = window.__hl.source;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n    ENDI    end if' } });
  });
  await nextFrames(page);
  const typed = await styles(page, 10);
  check(
    `${p} a typed line is coloured at once`,
    typed.find((m) => m[0] === 'ENDI')?.[1] === rgb('#800000') &&
      typed.find((m) => m[0].includes('end if'))?.[1] === rgb('#0000FF'),
    JSON.stringify(typed),
  );

  // --- Speed: a 10,000-line document, the viewport pass (acceptance: under 5 ms).
  const timing = await page.evaluate(async () => {
    const block = [
      '* Syntax Highlight',
      'START:  ORG    $1000   set origin',
      "    MOVE.B  #'A',D0     load char",
      'LOOP    DBRA    D0,LOOP',
      '    PRINT   msg     macro call',
      '    IF.B D0 <EQ> #1 THEN.S    do it',
      "MSG     DC.B    'Hello',0     text",
      '    MOVE.L  (A0,D1',
      '    FOR D1 = #1 TO #10 BY #2 DO',
      '    MEMORY  ROM $001000,$002000   my rom',
    ];
    const text = Array.from({ length: 10000 }, (_, i) => block[i % block.length]).join('\n');
    const { ctx } = window.__easy68k;
    const view = window.__hl.mountView(ctx, text, 'source', { left: 20, top: 440, width: 1220, height: 440 });
    view.dispatch({ effects: [], selection: { anchor: view.state.doc.line(5000).from }, scrollIntoView: true });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return window.__hl.timeViewport(view, 25);
  });
  check(
    `${p} 10,000-line document: a viewport pass takes under 5 ms`,
    timing.best < 5,
    `best ${timing.best.toFixed(3)} ms of 25 runs over ${timing.lines} lines`,
  );
  await page.screenshot({ path: join(outDir, `${name}-large.png`) });

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No hot reload and no file watching: other packages edit files in this tree while the check
    // runs, and a reload would destroy the page under test. The CodeMirror packages are optimised
    // up front so that the optimiser does not reload the page when the harness first imports them.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    optimizeDeps: { include: ['@codemirror/state', '@codemirror/view'] },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      console.log(`\n[${name}]`);
      const browser = await BROWSERS[name].launch();
      try {
        await runBrowser(browser, name, baseUrl);
      } catch (error) {
        check(`${name}: the check ran to the end`, false, String(error?.stack ?? error));
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
