// Browser check of File > Print of Editor mode: the print document itself (ARCHITECTURE.md 9.4 E6;
// editor-ui §13; note 2). Owner: E6.
//
//   node app/src/features/print/check-print.mjs [--browser chromium|webkit|all] [--out <dir>] [--keys mac|windows]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright). No real print dialog is opened: the page's
// `Platform.print` is replaced, in the page, by a recorder, so the check receives exactly the page
// that would be printed. That page is then loaded on its own and looked at in print media:
//
//   - Ctrl+P (Cmd+P on a Mac) without a selection prints the whole document at once, titled
//     `EASy68K <name>`; tabs are expanded with the document's rule (Assembly stops 12, 20, 44,
//     measured on the rendered page); the page marker line is not printed and starts a new page
//     (Chromium: the PDF of the page has the expected number of pages); black on white in both
//     themes, the document's font; an over-long line is clipped, not wrapped;
//   - with a selection the `Print` range dialog asks first: Selection prints only the selection,
//     Cancel prints nothing;
//   - Printer Setup... hands the same document to the system dialog;
//   - no console errors.
//
// Screenshots go to build/E6/print-check unless --out says otherwise (always below build/). Exit
// code 0 = every check passed.

/* global console, process, document, window, getComputedStyle, Navigator, setTimeout, Event -- browser globals are used inside page.evaluate() callbacks */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'E6', 'print-check')));
const fromBuild = relative(join(repoRoot, 'build'), outDir);
if (fromBuild === '' || fromBuild === '..' || fromBuild.startsWith(`..${sep}`) || isAbsolute(fromBuild)) {
  console.error(`--out must be a folder below ${join(repoRoot, 'build')} (given: ${outDir})`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const keysChoice = option('--keys', process.platform === 'darwin' ? 'mac' : 'windows');
if (keysChoice !== 'mac' && keysChoice !== 'windows') {
  console.error('--keys must be mac or windows');
  process.exit(2);
}
if (!['chromium', 'webkit', 'all'].includes(browserChoice)) {
  console.error('--browser must be chromium, webkit or all');
  process.exit(2);
}

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const PAGE_READY_MS = 120_000;
// The longest wait for one step to show its effect. Generous for GitHub's Mac runner, which is far
// slower than a desktop PC; a step that succeeds returns as soon as its effect is seen.
const STEP_MS = 15_000;
const MARKER = '<------------------------------ PAGE ------------------------------>';

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- helpers --------------------------------------------------------------------------

function pretendSystem(keys) {
  const platform = keys === 'mac' ? 'MacIntel' : 'Win32';
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

/**
 * Runs in every frame (Playwright's init scripts do). Inside a child frame, which is where the
 * web platform's real print path (platform/web.ts) loads the print document, `print()` records
 * what would be printed in the top window and reports `afterprint`, instead of opening the
 * system's print dialog. The top window's own `print()` is left alone.
 */
function recordFramePrint() {
  if (window === window.top) return;
  window.print = () => {
    const top = window.top;
    top.__framePrints = top.__framePrints ?? [];
    top.__framePrints.push({
      title: document.title,
      pages: [...document.querySelectorAll('pre.page')].map((pre) => pre.textContent),
      frameHidden: window.frameElement ? getComputedStyle(window.frameElement).visibility === 'hidden' : null,
    });
    setTimeout(() => window.dispatchEvent(new Event('afterprint')), 0);
  };
}

const PLAYWRIGHT_MODIFIERS = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Cmd: 'Meta' };
function playwrightKey(chord) {
  const parts = chord.split('+');
  const key = parts.pop();
  const name = /^[A-Z]$/.test(key) ? `Key${key}` : key;
  return [...parts.map((modifier) => PLAYWRIGHT_MODIFIERS[modifier]), name].join('+');
}

const chordsOf = (page, id) =>
  page.evaluate(async (id) => {
    const { chordsOn } = await import('/src/commands/specs.ts');
    return chordsOn(id, window.__easy68k.ctx.platform.os, false);
  }, id);

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendSystem, keysChoice);
  await context.addInitScript(recordFramePrint);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const ready = async () => {
    await page.goto(baseUrl, { timeout: PAGE_READY_MS });
    await page.waitForSelector('.e68-shell', { timeout: PAGE_READY_MS });
    await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: PAGE_READY_MS });
    await page.waitForSelector('.e68-editor .cm-editor', { timeout: PAGE_READY_MS });
  };
  try {
    await ready();
  } catch (error) {
    console.log(`        the page did not come up (${String(error?.message ?? error).split('\n')[0]}); retrying once`);
    errors.length = 0;
    await ready();
  }
  // The recorder in place of the system print dialog (nothing is printed, no dialog opens).
  await page.evaluate(() => {
    window.__printed = [];
    window.__realPrint = window.__easy68k.ctx.platform.print;
    window.__easy68k.ctx.platform.print = (html, title) => {
      window.__printed.push({ html, title });
      return Promise.resolve();
    };
  });
  return { context, page, errors };
}

async function setText(page, text, anchor = 0, head = anchor) {
  await page.evaluate(
    ({ text, anchor, head }) => {
      const view = document.querySelector('[data-e68-document]').e68View;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor, head } });
      view.focus();
    },
    { text, anchor, head },
  );
}

const printedJobs = (page) => page.evaluate(() => window.__printed);
async function waitJobs(page, count) {
  return page
    .waitForFunction((count) => window.__printed.length >= count, count, { timeout: STEP_MS })
    .then(
      () => true,
      () => false,
    );
}

/** Loads a print document on its own page, in print media; returns facts measured there. */
async function inspect(browser, html, name, { dark = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 1200 },
    colorScheme: dark ? 'dark' : 'light',
  });
  const page = await context.newPage();
  await page.setContent(html);
  await page.emulateMedia({ media: 'print', colorScheme: dark ? 'dark' : 'light' });
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  const facts = await page.evaluate(() => {
    const pres = [...document.querySelectorAll('pre.page')];
    const style = pres[0] ? getComputedStyle(pres[0]) : null;
    const body = getComputedStyle(document.body);
    // The x of a character, measured with a Range, relative to its line's start.
    const columnX = (pre, lineIndex, column) => {
      const text = pre.firstChild;
      const lines = pre.textContent.split('\n');
      let offset = 0;
      for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1;
      const range = document.createRange();
      range.setStart(text, offset + column);
      range.setEnd(text, offset + column + 1);
      const start = document.createRange();
      start.setStart(text, offset);
      start.setEnd(text, offset + 1);
      return range.getBoundingClientRect().left - start.getBoundingClientRect().left;
    };
    return {
      title: document.title,
      pages: pres.map((pre) => pre.textContent),
      color: style?.color,
      background: body.backgroundColor,
      fontFamily: style?.fontFamily,
      fontSize: style?.fontSize,
      whiteSpace: style?.whiteSpace,
      overflowX: style?.overflowX,
      breakBefore: pres.slice(1).map((pre) => getComputedStyle(pre).breakBefore),
      clipped: pres.some((pre) => pre.scrollWidth > pre.clientWidth),
      widthOfPage: pres[0]?.clientWidth ?? 0,
      // Measured only on a first line long enough (the document of the main pass).
      ...(pres[0] && pres[0].textContent.split('\n')[0].length > 45
        ? { x12: columnX(pres[0], 0, 12), x20: columnX(pres[0], 0, 20), x44: columnX(pres[0], 0, 44) }
        : { x12: 0, x20: 0, x44: 0 }),
      scripts: document.querySelectorAll('script, link, img, iframe').length,
    };
  });
  let pdfPages = null;
  if (browser.browserType().name() === 'chromium') {
    const pdf = await page.pdf({ format: 'A4' });
    writeFileSync(join(outDir, `${name}.pdf`), pdf);
    pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  }
  await context.close();
  return { ...facts, pdfPages };
}

const BLACK = 'rgb(0, 0, 0)';
const WHITE = 'rgb(255, 255, 255)';

// --- the checks ------------------------------------------------------------------------

async function printPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  const printChords = await chordsOf(page, 'ed.file.print');
  console.log(`        chords: print ${printChords.join(' / ')}`);

  const longLine = `* ${'long line '.repeat(30)}END`;
  const text = [
    'START\tORG\t$1000\t* program start',
    '\tMOVE.B\t#14,D0',
    longLine,
    MARKER,
    'PAGE2\tTRAP\t#15',
    `\tEND\tSTART`,
    '',
  ].join('\n');
  await page.evaluate(() => {
    const ctx = window.__easy68k.ctx;
    const id = ctx.store.getState().documents.activeId;
    ctx.documents.update?.(id, { tabType: 0 });
  });

  for (const [index, chord] of printChords.entries()) {
    await setText(page, text, 0);
    await page.keyboard.press(playwrightKey(chord));
    const got = await waitJobs(page, index + 1);
    check(`${p} ${chord} without a selection goes straight to the print dialog`, got);
    const rangeDialogs = await page.getByRole('dialog', { name: 'Print', exact: true }).count();
    check(`${p} ${chord}: no range question without a selection`, rangeDialogs === 0, String(rangeDialogs));
  }
  const jobs = await printedJobs(page);
  const job = jobs[0];
  const docName = await page.evaluate(() => window.__easy68k.ctx.documents.active().name);
  check(`${p} the job is titled EASy68K and the document`, job?.title === `EASy68K ${docName}`, job?.title);
  writeFileSync(join(outDir, `${name}-document.html`), job?.html ?? '');

  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light';
    if (dark) {
      await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
      await setText(page, text, 0);
      await page.keyboard.press(playwrightKey(printChords[0]));
      await waitJobs(page, jobs.length + 1);
    }
    const html = (await printedJobs(page)).at(-1).html;
    const facts = await inspect(browser, html, `${name}-print-${theme}`, { dark });
    const expectedFirst = [
      `${'START'.padEnd(12)}${'ORG'.padEnd(8)}${'$1000'.padEnd(24)}* program start`,
      `${' '.repeat(12)}${'MOVE.B'.padEnd(8)}#14,D0`,
      longLine,
    ].join('\n');
    const expectedSecond = `${'PAGE2'.padEnd(12)}${'TRAP'.padEnd(8)}#15\n${' '.repeat(12)}${'END'.padEnd(8)}START`;
    check(
      `${p} ${theme}: tabs expanded with the Assembly rule; the marker line is not printed`,
      JSON.stringify(facts.pages) === JSON.stringify([expectedFirst, expectedSecond]),
      JSON.stringify(facts.pages).slice(0, 300),
    );
    check(
      `${p} ${theme}: the page after the marker starts on a new page`,
      facts.breakBefore.join() === 'page',
      facts.breakBefore.join(),
    );
    if (facts.pdfPages !== null) {
      check(`${p} ${theme}: the PDF of the print document has 2 pages`, facts.pdfPages === 2, String(facts.pdfPages));
    }
    // The same width per character up to each stop: x / column agrees within 1 %.
    const perChar = [facts.x12 / 12, facts.x20 / 20, facts.x44 / 44];
    check(
      `${p} ${theme}: the opcode, operand and comment columns are at 12, 20 and 44 character widths`,
      facts.x12 > 0 && perChar.every((w) => Math.abs(w - perChar[0]) / perChar[0] < 0.01),
      `x12 ${facts.x12.toFixed(1)}, x20 ${facts.x20.toFixed(1)}, x44 ${facts.x44.toFixed(1)} px`,
    );
    check(
      `${p} ${theme}: monochrome, black text on white`,
      facts.color === BLACK && facts.background === WHITE,
      `${facts.color} on ${facts.background}`,
    );
    check(
      `${p} ${theme}: the document font (Courier New 10 pt)`,
      /^"?Courier New"?/.test(facts.fontFamily ?? '') && Math.abs(parseFloat(facts.fontSize) - (10 * 4) / 3) < 0.01,
      `${facts.fontFamily} ${facts.fontSize}`,
    );
    check(
      `${p} ${theme}: no word wrap; the over-long line is clipped`,
      facts.whiteSpace === 'pre' && facts.overflowX === 'hidden' && facts.clipped,
      `${facts.whiteSpace} ${facts.overflowX} clipped=${facts.clipped}`,
    );
    check(`${p} ${theme}: no script, link, image or frame`, facts.scripts === 0, String(facts.scripts));
  }
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'light'));

  // A selection: the range question; Selection prints only it (its first line counted from 0).
  const before = (await printedJobs(page)).length;
  await setText(page, text, 5, 15); // "\tORG\t$1000"
  await page.keyboard.press(playwrightKey(printChords[0]));
  const dialog = page.getByRole('dialog', { name: 'Print', exact: true });
  const asked = await dialog.waitFor({ timeout: STEP_MS }).then(
    () => true,
    () => false,
  );
  check(`${p} with a selection the Print range question comes first`, asked);
  if (asked) {
    await page.screenshot({ path: join(outDir, `${name}-range-dialog.png`) });
    const allChecked = await dialog.getByLabel('All').isChecked();
    check(`${p} All is preselected`, allChecked);
    await dialog.getByLabel('Selection').check();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await waitJobs(page, before + 1);
    const html = (await printedJobs(page)).at(-1).html;
    const facts = await inspect(browser, html, `${name}-print-selection`);
    check(
      `${p} Selection prints only the selection, its first line counted from column 0`,
      JSON.stringify(facts.pages) === JSON.stringify([`${' '.repeat(12)}${'ORG'.padEnd(8)}$1000`]),
      JSON.stringify(facts.pages),
    );
    // Cancel prints nothing.
    await setText(page, text, 5, 15);
    await page.keyboard.press(playwrightKey(printChords[0]));
    await dialog.waitFor({ timeout: STEP_MS });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: STEP_MS });
  }

  // Printer Setup: the same system dialog, for the whole document. It is also what proves that
  // Cancel printed nothing, without a pause: the next job to arrive must be Printer Setup's.
  const count = (await printedJobs(page)).length;
  await page.evaluate(() => window.__easy68k.ctx.commands.run('ed.file.printerSetup'));
  await waitJobs(page, count + 1);
  const all = await printedJobs(page);
  const setup = all.at(-1);
  check(`${p} Printer Setup... opens the system print dialog with the document`, setup?.html === job?.html);
  if (asked) {
    check(
      `${p} Cancel in the range question prints nothing`,
      all.length === before + 2,
      `${all.length - before} jobs after the range question (expected 2: Selection, Printer Setup)`,
    );
  }

  // The real print path of the web platform: the hidden frame with the print document, whose
  // print() (recorded, see recordFramePrint) is where the system dialog would open; the job
  // finishes on afterprint and the frame is removed.
  await page.evaluate(() => {
    window.__framePrints = [];
    window.__easy68k.ctx.platform.print = window.__realPrint;
  });
  await setText(page, text, 0);
  await page.keyboard.press(playwrightKey(printChords[0]));
  const framed = await page
    .waitForFunction(() => window.__framePrints.length >= 1, null, { timeout: STEP_MS })
    .then(
      () => true,
      () => false,
    );
  const framePrint = await page.evaluate(() => window.__framePrints[0] ?? null);
  check(
    `${p} the web platform prints from a hidden frame holding the print document`,
    framed &&
      framePrint?.frameHidden === true &&
      framePrint.title === job?.title &&
      framePrint.pages.length === 2 &&
      framePrint.pages[1].startsWith('PAGE2'),
    JSON.stringify(framePrint)?.slice(0, 200),
  );
  const frameGone = await page
    .waitForFunction((title) => ![...document.querySelectorAll('iframe')].some((f) => f.title === title), job?.title, {
      timeout: STEP_MS,
    })
    .then(
      () => true,
      () => false,
    );
  check(`${p} after the print dialog closes the frame is removed`, frameGone);

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- run -------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        console.log(`\n[${name}, print]`);
        try {
          await printPass(browser, name);
        } catch (error) {
          check(
            `${name}: the print pass ran to its end`,
            false,
            String(error?.stack ?? error)
              .split('\n')
              .slice(0, 4)
              .join(' | '),
          );
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
