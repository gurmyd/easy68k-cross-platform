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
//   - after printing the focus is back where it was and every guarded chord is heard;
//   - in a browser that never reports `afterprint` the hidden frame and the focus are given back
//     as soon as the print dialog is known to be gone, and the frame stays while it is open;
//   - no console errors.
//
// Screenshots go to build/E6/print-check unless --out says otherwise (always below build/). Exit
// code 0 = every check passed.

/* global console, process, document, window, getComputedStyle, Navigator, setTimeout, Event, performance -- browser globals are used inside page.evaluate() callbacks */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { closeAtEnd, closeWithin, doneWith, endChecks } from '../../../../tests/browser-checks/ending.mjs';

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
  const nativePrint = window.print.bind(window);
  window.print = () => {
    const top = window.top;
    // The focus pass's "dialog never shown": print() refuses (as a browser that blocks it does).
    if (top.__framePrintThrows) throw new Error('print() refused');
    // The pass "a browser that never reports afterprint" (afterprintPass) picks how print() behaves:
    // 'native' the browser's own print(); 'silent' returns without a dialog and without afterprint;
    // 'dialog' returns with a print dialog still open (as a browser whose print() does not wait
    // for its dialog): the page has no focus (hasFocus() false, the frame's window hears blur)
    // until the pass calls top.__closePrintDialog('top' | 'frame' | 'quietly'), and no afterprint.
    const mode = top.__framePrintMode;
    if (mode === 'native') {
      top.__framePrints = top.__framePrints ?? [];
      top.__framePrints.push({ title: document.title, at: top.performance.now(), native: true });
      return nativePrint();
    }
    top.__framePrints = top.__framePrints ?? [];
    top.__framePrints.push({
      title: document.title,
      pages: [...document.querySelectorAll('pre.page')].map((pre) => pre.textContent),
      frameHidden: window.frameElement ? getComputedStyle(window.frameElement).visibility === 'hidden' : null,
      at: top.performance.now(),
    });
    if (mode === 'silent') return;
    if (mode === 'dialog') {
      const frameWindow = window;
      const topHasFocus = top.document.hasFocus.bind(top.document);
      const frameHasFocus = document.hasFocus.bind(document);
      top.document.hasFocus = () => false;
      document.hasFocus = () => false;
      frameWindow.dispatchEvent(new Event('blur'));
      top.__closePrintDialog = (to) => {
        top.document.hasFocus = topHasFocus;
        document.hasFocus = frameHasFocus;
        top.__closePrintDialog = undefined;
        top.__printDialogClosedAt = top.performance.now();
        if (to === 'top') top.dispatchEvent(new Event('focus'));
        if (to === 'frame') frameWindow.dispatchEvent(new Event('focus'));
      };
      return;
    }
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

async function openApp(browser, keys = keysChoice) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendSystem, keys);
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
  await closeWithin(context);
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
  await closeWithin(context);
}

/** The chords the dispatcher cancels (ARCHITECTURE.md 2.9.3), as tests/e2e/app/chords.spec.ts. */
function guardedChords(keys) {
  const letters = ['O', 'S', 'P', 'F', 'G', 'R'];
  return [
    'F5',
    'F6',
    'F7',
    'F10',
    ...letters.map((letter) => `Ctrl+${letter}`),
    ...(keys === 'mac' ? letters.filter((letter) => letter !== 'R').map((letter) => `Cmd+${letter}`) : []),
  ];
}

/**
 * After printing the keyboard focus is back where it was, in the top document, and the next chord
 * is heard by the application (errata/E6.md; CI run 45034018006). The real print path of the web
 * platform runs (the hidden frame; its print() recorded and answered with `afterprint`, which is
 * what a browser reports whether its dialog was confirmed or cancelled), from the editor and from
 * the Files panel's tree, on the key map `keys`; then every chord of 2.9.3 is pressed and must be
 * heard and cancelled, each after the print it may have started has finished. Also: Cancel in the
 * range question, a print() that refuses (no dialog shown), the printer error box, Printer Setup.
 */
async function focusPass(browser, name, keys) {
  const p = `${name}, ${keys} key map, focus:`;
  const { context, page, errors } = await openApp(browser, keys);
  await page.evaluate(() => {
    window.__easy68k.ctx.platform.print = window.__realPrint;
    window.__framePrints = [];
    window.__heard = [];
    // After the application's own listener (registered at start-up), as in chords.spec.ts.
    window.addEventListener('keydown', (event) => window.__heard.push(event.defaultPrevented), true);
  });
  const printChords = await chordsOf(page, 'ed.file.print');
  const settled = () =>
    page
      .waitForFunction(
        () => document.querySelector('iframe[srcdoc][aria-hidden="true"]') === null && document.hasFocus(),
        null,
        { polling: 50, timeout: STEP_MS },
      )
      .then(
        () => true,
        () => false,
      );
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return a
        ? `${a.tagName.toLowerCase()}.${a.className}${a.getAttribute('role') ? `[${a.getAttribute('role')}]` : ''}`
        : 'none';
    });
  const closeDialogs = async () => {
    const open = page.locator('[role=dialog][aria-modal=true], [role=alertdialog]');
    for (let attempt = 0; attempt < 5 && (await open.count()) > 0; attempt++) {
      if (attempt === 0) await page.keyboard.press('Escape');
      else await open.last().locator('.e68-dialog__footer button').last().click();
      await open
        .first()
        .waitFor({ state: 'detached', timeout: 3_000 })
        .catch(() => undefined);
    }
  };
  const places = {
    editor: async () => {
      await page.locator('.e68-editor .cm-content').first().focus();
    },
    'Files tree': async () => {
      const panel = page.locator('[data-e68-panel="files"]');
      if (!(await panel.isVisible()))
        await page.locator('.e68-shell__toolbar [data-command="app.files.toggle"]').click();
      await panel.getByRole('tree').focus();
    },
  };

  for (const [place, focusIt] of Object.entries(places)) {
    for (const chord of printChords) {
      await focusIt();
      const before = await focused();
      const prints = await page.evaluate(() => window.__framePrints.length);
      await page.keyboard.press(playwrightKey(chord));
      const printedNow = await page
        .waitForFunction((n) => window.__framePrints.length > n, prints, { timeout: STEP_MS })
        .then(
          () => true,
          () => false,
        );
      const back = await settled();
      const after = await focused();
      check(
        `${p} ${chord} in the ${place} prints; afterwards the focus is back on ${before} in the top document`,
        printedNow && back && after === before,
        `printed=${printedNow} settled=${back} focus ${after}`,
      );
    }
    const missed = [];
    for (const chord of guardedChords(keys)) {
      await page.evaluate(() => window.__heard.splice(0));
      await page.keyboard.press(playwrightKey(chord));
      const heard = await page.evaluate(() => window.__heard.splice(0));
      if (heard.at(-1) !== true) missed.push(`${chord} ${JSON.stringify(heard)}`);
      await closeDialogs();
      if (!(await settled())) missed.push(`${chord}: the print it started did not finish`);
    }
    check(
      `${p} after printing in the ${place} every chord of 2.9.3 is heard and cancelled`,
      missed.length === 0,
      missed.join(', '),
    );
  }

  // The editor again, for the other ways a print ends.
  const editorBack = async (what, act) => {
    await places.editor();
    const before = await focused();
    await act();
    const back = await settled();
    const after = await focused();
    check(`${p} ${what}: the focus is back on ${before}`, back && after === before, `settled=${back} focus ${after}`);
  };
  const dialog = page.getByRole('dialog', { name: 'Print', exact: true });
  await editorBack('Cancel in the range question', async () => {
    await setText(page, 'a\nb\n', 0, 1);
    await page.keyboard.press(playwrightKey(printChords[0]));
    await dialog.waitFor({ timeout: STEP_MS });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: STEP_MS });
  });
  await editorBack('Selection in the range question, then the print dialog', async () => {
    await setText(page, 'a\nb\n', 0, 1);
    await page.keyboard.press(playwrightKey(printChords[0]));
    await dialog.waitFor({ timeout: STEP_MS });
    await dialog.getByLabel('Selection').check();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await dialog.waitFor({ state: 'detached', timeout: STEP_MS });
  });
  await editorBack('a print() that refuses (no print dialog shown)', async () => {
    await setText(page, 'a\nb\n', 0);
    await page.evaluate(() => (window.__framePrintThrows = true));
    await page.keyboard.press(playwrightKey(printChords[0]));
    await page.waitForFunction(() => document.querySelector('iframe[srcdoc][aria-hidden="true"]') === null, null, {
      polling: 50,
      timeout: STEP_MS,
    });
    await page.evaluate(() => (window.__framePrintThrows = false));
  });
  await editorBack('the printer error box (fixed tab size 0), answered with OK', async () => {
    await page.evaluate(() => {
      const ctx = window.__easy68k.ctx;
      ctx.documents.update?.(ctx.store.getState().documents.activeId, { tabType: 1, tabSize: 0 });
    });
    await setText(page, 'a\tb\n', 0);
    await page.keyboard.press(playwrightKey(printChords[0]));
    const box = page.getByRole('alertdialog');
    const shown = await box.waitFor({ timeout: STEP_MS }).then(
      () => true,
      () => false,
    );
    if (!shown) throw new Error('the printer error box did not open');
    await box.getByRole('button', { name: 'OK' }).click();
    await box.waitFor({ state: 'detached', timeout: STEP_MS });
    await page.evaluate(() => {
      const ctx = window.__easy68k.ctx;
      ctx.documents.update?.(ctx.store.getState().documents.activeId, { tabType: 0, tabSize: 8 });
    });
  });
  await editorBack('Printer Setup...', async () => {
    await page.evaluate(() => void window.__easy68k.ctx.commands.run('ed.file.printerSetup'));
  });
  await page.screenshot({ path: join(outDir, `${name}-${keys}-focus-after-print.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/**
 * A browser that never reports `afterprint` (Playwright's WebKit is one): the web platform must not
 * keep the hidden frame, and with it the keyboard focus, until its 60-second fallback; it ends the
 * print as soon as the dialog is known to be gone, and not before (errata/W3.md entry 44). Through
 * the real print path, from the editor: print() returning without a dialog, the browser's own
 * print(), and a print dialog that stays open after print() returned and then closes (the top
 * window hears focus; the frame's window hears it; the page just has the focus again; a click in
 * the page; a key). While that dialog is open the frame stays in the page.
 */
async function afterprintPass(browser, name) {
  const p = `${name}, no afterprint:`;
  const { context, page, errors } = await openApp(browser, 'windows');
  await page.evaluate(() => {
    window.__easy68k.ctx.platform.print = window.__realPrint;
    window.__framePrints = [];
    window.__heard = [];
    window.addEventListener('keydown', (event) => window.__heard.push(event.defaultPrevented), true);
  });
  const printChord = playwrightKey((await chordsOf(page, 'ed.file.print'))[0]);
  // After the print dialog closes, the platform ends the print in about a second at most; these
  // limits leave room for a slow runner and are far below the 60-second fallback.
  const NO_DIALOG_MS = 5_000;
  const AFTER_CLOSE_MS = 3_000;
  const DIALOG_OPEN_MS = 2_500;
  const FRAME = 'iframe[srcdoc][aria-hidden="true"]';
  const editor = page.locator('.e68-editor .cm-content').first();
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}.${a.className}` : 'none';
    });
  const frameGoneAt = (timeout) =>
    page
      .waitForFunction((frame) => (document.querySelector(frame) === null ? performance.now() : false), FRAME, {
        polling: 20,
        timeout,
      })
      .then(
        (handle) => handle.jsonValue(),
        () => null,
      );
  const settled = (timeout) =>
    page
      .waitForFunction((frame) => document.querySelector(frame) === null && document.hasFocus(), FRAME, {
        polling: 50,
        timeout,
      })
      .then(
        () => true,
        () => false,
      );
  /** Prints from the editor in `mode`; resolves with the print() call's time and the focus before. */
  const start = async (mode) => {
    await setText(page, 'MOVE.L #1,D0\n', 0);
    await editor.focus();
    const before = await focused();
    const n = await page.evaluate((mode) => {
      window.__framePrintMode = mode;
      window.__printDialogClosedAt = undefined;
      return window.__framePrints.length;
    }, mode);
    await page.keyboard.press(printChord);
    const at = await page
      .waitForFunction((n) => window.__framePrints[n]?.at ?? false, n, { timeout: STEP_MS })
      .then(
        (handle) => handle.jsonValue(),
        () => null,
      );
    if (at === null) throw new Error(`print() of the frame was not called (${mode})`);
    return { at, before };
  };
  const heardAfter = async () => {
    await page.evaluate(() => window.__heard.splice(0));
    await page.keyboard.press('Control+KeyF');
    const heard = await page.evaluate(() => window.__heard.splice(0));
    await page.keyboard.press('Escape');
    return heard.at(-1) === true;
  };

  for (const mode of ['silent', 'native']) {
    const what = mode === 'silent' ? 'print() returns without a dialog' : "the browser's own print()";
    const { at, before } = await start(mode);
    const gone = await frameGoneAt(STEP_MS);
    const back = await settled(STEP_MS);
    const after = await focused();
    const ms = gone === null ? null : Math.round(gone - at);
    check(
      `${p} ${what}: the frame is gone and the focus is back on ${before} within ${NO_DIALOG_MS / 1000} s`,
      ms !== null && ms <= NO_DIALOG_MS && back && after === before,
      `frame gone after ${ms ?? `more than ${STEP_MS}`} ms, settled=${back}, focus ${after}`,
    );
    check(`${p} ${what}: then Ctrl+F is heard by the application`, await heardAfter());
  }

  for (const close of ['top', 'frame', 'quietly']) {
    const how = {
      top: 'the top window hears focus',
      frame: "the frame's window hears focus",
      quietly: 'the page just has the focus again',
    }[close];
    const { before } = await start('dialog');
    await page.waitForTimeout(DIALOG_OPEN_MS);
    const kept = await page.evaluate((frame) => document.querySelector(frame) !== null, FRAME);
    check(`${p} while the print dialog is open (${DIALOG_OPEN_MS} ms) the frame stays in the page`, kept);
    await page.evaluate((to) => window.__closePrintDialog?.(to), close);
    const closedAt = await page.evaluate(() => window.__printDialogClosedAt);
    const gone = await frameGoneAt(STEP_MS);
    const back = await settled(STEP_MS);
    const after = await focused();
    const ms = gone === null ? null : Math.round(gone - closedAt);
    check(
      `${p} the dialog closes, ${how}: the frame is gone and the focus is back on ${before} within ${AFTER_CLOSE_MS / 1000} s`,
      ms !== null && ms <= AFTER_CLOSE_MS && back && after === before,
      `frame gone ${ms ?? `more than ${STEP_MS}`} ms after the close, settled=${back}, focus ${after}`,
    );
  }

  for (const input of ['click', 'key']) {
    const how = input === 'click' ? 'a click in the page' : 'a key';
    const { before } = await start('dialog');
    await page.waitForTimeout(300);
    const inputAt = await page.evaluate(() => performance.now());
    if (input === 'click') await page.locator('.e68-statusbar__cell').first().click();
    else await page.keyboard.press('Shift');
    const gone = await frameGoneAt(STEP_MS);
    // What the page looks like then; hasFocus() stays false until the stand-in dialog is closed.
    await page.evaluate(() => window.__closePrintDialog?.('quietly'));
    const back = await settled(STEP_MS);
    const after = await focused();
    const ms = gone === null ? null : Math.round(gone - inputAt);
    // A click goes where the person clicked (the status bar takes no focus); a key gives it back.
    const where = input === 'click' ? 'in the top document' : `back on ${before}`;
    const placed = input === 'click' ? !after.startsWith('iframe') : after === before;
    check(
      `${p} ${how} after print() returned tells the dialog is gone: the frame is gone within ${AFTER_CLOSE_MS / 1000} s, the focus ${where}`,
      ms !== null && ms <= AFTER_CLOSE_MS && back && placed,
      `frame gone ${ms ?? `more than ${STEP_MS}`} ms after the ${input}, settled=${back}, focus ${after}`,
    );
  }
  await page.evaluate(() => (window.__framePrintMode = undefined));
  await page.screenshot({ path: join(outDir, `${name}-no-afterprint-focus.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
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
        console.log(`\n[${name}, a browser that never reports afterprint]`);
        try {
          await afterprintPass(browser, name);
        } catch (error) {
          check(
            `${name}: the pass without afterprint ran to its end`,
            false,
            String(error?.stack ?? error)
              .split('\n')
              .slice(0, 4)
              .join(' | '),
          );
        }
        for (const keys of ['windows', 'mac']) {
          console.log(`\n[${name}, ${keys} key map, focus after printing]`);
          try {
            await focusPass(browser, name, keys);
          } catch (error) {
            check(
              `${name}, ${keys} key map: the focus pass ran to its end`,
              false,
              String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            );
          }
        }
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
