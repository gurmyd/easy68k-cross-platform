// Browser check of the Registers, Listing and Messages panels (ARCHITECTURE.md 9.2, U1). Owner: U1.
//
//   node app/src/features/sim-main/check-sim-main.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives headless Chromium and WebKit
// (Playwright). Most passes start the normal application and then replace it by an application
// with this feature on the session double of testing.ts over the REAL simulator engine, in the real
// shell (app/src/App.tsx), so that the panels can be driven without the rest of Simulator mode. One
// pass (realAppPass) uses the normal application as it is: SH8's real session and run controller,
// the run feature's message boxes and U2's Memory panel. The script checks what unit tests under
// Node cannot show:
//
//   - the three panels render in the Simulator workspace: twenty register fields, the flag caption,
//     the listing with its heading, gutter dots and PC marker, the message lines;
//   - real input: typing into D0 (the field selects itself and overwrites), Backspace in the SR
//     field types a 0, a double-click on a row sets the PC field, gutter clicks toggle breakpoints
//     (the engine's table follows), the gutter's context menu clears them all;
//   - Search > Find... by Ctrl+F: the modeless dialog, Enter and F3, Escape; Ctrl+G;
//   - on the real parts: load, gutter and Run to a breakpoint, the PC row selected again at every
//     trace step, the double-click on A0 opening the Memory panel, the box `Breakpoint Limit
//     Reached!` at the 101st breakpoint, Close emptying the listing;
//   - the third-visible-row scroll of 3.11.4 and the scrolling of a 100,000-row listing (frame
//     times while scrolling by script and by mouse wheel; the best of three runs counts; printed
//     only on CI runners, CI=true, or with --report-frame-times);
//   - both themes (screenshots) and an accessibility scan (axe-core, WCAG 2.0/2.1 A and AA) of the
//     Simulator workspace;
//   - no console errors.
//
// Screenshots go to build/U1/sim-main-check (git-ignored). Exit code 0 = everything passed.

/* global console, process, document, window, performance, requestAnimationFrame, getComputedStyle, TextEncoder, Event, HTMLElement -- page.evaluate() callbacks run in the page */

import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'U1', 'sim-main-check')));
// path.relative, not a string prefix: Windows paths differ in drive-letter case ("c:\" / "C:\").
const fromBuild = relative(join(repoRoot, 'build'), outDir);
if (fromBuild.startsWith('..') || isAbsolute(fromBuild)) {
  console.error(`--out must be below ${join(repoRoot, 'build')}`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

/**
 * Frame times depend on the machine: on CI runners (CI=true; shared, often software rendering) and
 * with --report-frame-times they are printed, not enforced. The page's own work per scroll step is
 * enforced everywhere.
 */
const REPORT_FRAME_TIMES_ONLY = process.env.CI === 'true' || args.includes('--report-frame-times');
/** The dev server transforms every module at the first request; on a slow runner that takes a while. */
const LOAD_TIMEOUT = 180_000;

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const SOURCE = [
  '    ORG $1000',
  'START:',
  '    MOVE.L #5,D1',
  '    ADD.L D0,D1',
  '    MOVEA.L #$2000,A0',
  'LOOP:',
  '    BRA.S LOOP',
  '    SIMHALT',
  '    END START',
];

// --- helpers --------------------------------------------------------------------------

async function openPage(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('crash', () => errors.push('the page crashed'));
  await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, undefined, { timeout: LOAD_TIMEOUT });
  // Replace the application by one with this feature on the session double over the real engine.
  await page.evaluate(
    async ({ theme: themeName, source }) => {
      window.__easy68k.dispose();
      document.getElementById('root')?.remove();
      const root = document.createElement('div');
      root.id = 'root';
      document.body.appendChild(root);
      const [{ App }, appTesting, engineTesting, simMain, double, harness] = await Promise.all([
        import('/src/App.tsx'),
        import('/src/state/testing.ts'),
        import('/src/engine/testing.ts'),
        import('/src/features/sim-main/index.ts'),
        import('/src/features/sim-main/testing.ts'),
        import('/src/features/sim-main/check-harness.tsx'),
      ]);
      const bench = await engineTesting.createTestEngine();
      let session = null;
      const app = appTesting.createTestApplication({
        features: [simMain.feature],
        keyTarget: window,
        services: {
          createSimSession: (ctx) =>
            (session = double.createSessionDouble(ctx, bench, () => engineTesting.createTestEngine())),
        },
      });
      const program = await engineTesting.assembleProgram(source);
      window.__u1 = {
        app,
        session,
        engineTesting,
        program,
        simMainOf: (await import('/src/features/sim-main/model.ts')).simMainOf,
      };
      harness.mountApp(root, App, app);
      await app.ctx.commands.run('app.mode.set', 'simulator');
      await app.ctx.commands.run('app.theme.set', themeName);
      session.controller.loadBytes('/browser/demo/program.S68', program.s68, program.l68);
    },
    { theme, source: SOURCE },
  );
  await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme, {
    timeout: LOAD_TIMEOUT,
  });
  await page.waitForSelector('.e68-listing__row', { timeout: LOAD_TIMEOUT });
  return { context, page, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const { app, session } = window.__u1;
    return {
      selected: app.ctx.store.getState().sim.selectedRow,
      breakpoints: session.engine.breakpoints(),
      pcBox: session.engine.boxText(18),
      d0: session.engine.getRegister(0),
      messages: app.ctx.store.getState().sim.messageLines,
      dialogs: app.ctx.store.getState().dialogs.stack.map((d) => d.id),
    };
  });
const rowLocator = (page, text) => page.locator('.e68-listing__row', { hasText: text }).first();
const rowIndex = async (page, text) => Number(await rowLocator(page, text).getAttribute('data-row'));
const field = (page, box) => page.locator(`.e68-regs input[data-box="${box}"]`);

async function scan(page, label) {
  // The whole page is scanned; only findings inside the three panels count (the other regions
  // are placeholders of features that do not exist in this application).
  const scanned = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const mine = (target) =>
    /e68-regs|e68-listing|e68-messages|data-e68-panel="(registers|listing|messages)"/.test(target.join(' '));
  const result = {
    violations: scanned.violations
      .map((v) => ({ ...v, nodes: v.nodes.filter((n) => mine(n.target)) }))
      .filter((v) => v.nodes.length > 0),
  };
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious finding in the three panels`, serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

// --- passes ----------------------------------------------------------------------------

/** Structure, input, gutter, Find, Go to PC; screenshots and scan in one theme. */
async function interactionPass(browser, name, theme) {
  const p = `${name}/${theme}:`;
  const { context, page, errors } = await openPage(browser, theme);

  const labels = await page.locator('label.e68-regs__label').allInnerTexts();
  check(
    `${p} twenty register labels in tab order`,
    labels.join(' ') === 'D0= D1= D2= D3= D4= D5= D6= D7= A0= A1= A2= A3= A4= A5= A6= A7= SR= PC= SS= US=',
    labels.join(' '),
  );
  const caption = await page.locator('.e68-regs__flagtext').textContent();
  check(`${p} flag caption verbatim`, caption === 'T S  INT   XNZVC', JSON.stringify(caption));
  // The caption's 16 characters stand over the 16 bits of the SR field.
  const align = await page.evaluate(() => {
    const text = document.querySelector('.e68-regs__flagtext');
    const flags = text.getBoundingClientRect();
    const input = document.querySelector('.e68-regs input[data-box="19"]');
    const style = getComputedStyle(input);
    const box = input.getBoundingClientRect();
    return {
      flagsLeft: flags.left + parseFloat(getComputedStyle(text).paddingLeft),
      textLeft: box.left + parseFloat(style.paddingLeft),
    };
  });
  check(
    `${p} flag caption starts over the first SR bit`,
    Math.abs(align.flagsLeft - align.textLeft) <= 2,
    JSON.stringify(align),
  );
  const heading = await page.locator('.e68-listing__heading').textContent();
  check(`${p} listing heading`, heading === ' Address  --------Code---------   Line -----------Source----------->>');
  const moveRow = await rowIndex(page, 'MOVE.L #5,D1');
  let s = await state(page);
  check(
    `${p} the start row is selected and carries the PC marker`,
    s.selected === moveRow &&
      (await page.locator(`.e68-listing__row[data-row="${moveRow}"] .e68-listing__pc`).count()) === 1,
  );
  const dots = await page.locator('.e68-listing__dot').count();
  check(`${p} a dot on each of the five instruction rows`, dots === 5, String(dots));
  check(
    `${p} the message area shows the load messages`,
    (await page.locator('.e68-messages').innerText()).includes('.S68 file read successful'),
  );

  await page.screenshot({ path: join(outDir, `${name}-${theme}-loaded.png`) });

  // Gutter: toggle, toggle, context menu.
  const addRow = rowLocator(page, 'ADD.L D0,D1');
  await addRow.locator('.e68-listing__gutter').click();
  s = await state(page);
  check(
    `${p} a gutter click sets a breakpoint`,
    JSON.stringify(s.breakpoints) === '[4098]' && (await addRow.getAttribute('data-bp')) === 'on',
    JSON.stringify(s.breakpoints),
  );
  await addRow.locator('.e68-listing__gutter').click();
  s = await state(page);
  check(
    `${p} a second click clears it`,
    s.breakpoints.length === 0 && (await addRow.getAttribute('data-bp')) === 'off',
  );
  await rowLocator(page, 'MOVEA.L').locator('.e68-listing__gutter').click();
  await rowLocator(page, 'SIMHALT').locator('.e68-listing__gutter').click();
  await page.screenshot({ path: join(outDir, `${name}-${theme}-breakpoints.png`) });
  const labelRow = rowLocator(page, 'LOOP:');
  await labelRow.locator('.e68-listing__gutter').click();
  s = await state(page);
  check(
    `${p} a click beside a row without code does nothing`,
    s.breakpoints.length === 2,
    JSON.stringify(s.breakpoints),
  );
  await rowLocator(page, 'MOVEA.L').locator('.e68-listing__gutter').click({ button: 'right' });
  const item = page.getByRole('menuitem', { name: 'Clear All PC Breakpoints' });
  check(`${p} right click in the gutter offers Clear All PC Breakpoints`, (await item.count()) === 1);
  await item.click();
  s = await state(page);
  check(`${p} Clear All PC Breakpoints removes both`, s.breakpoints.length === 0);

  // Double-click on a row sets the PC field.
  await rowLocator(page, 'BRA.S LOOP').locator('.e68-listing__text').dblclick();
  check(
    `${p} double-click on a row puts its address into the PC field`,
    (await field(page, 18).inputValue()) === '0000100A',
  );

  // Typing into D0: entering the field with the keyboard selects all (AutoSelect), typing
  // overwrites. (VCL's AutoSelect does not act on a mouse click, TCustomEdit.DoEnter; Chromium and
  // WebKit also differ there, so the check enters the field by focus.)
  await field(page, 0).focus();
  await page.keyboard.type('7a');
  check(`${p} typing into D0 overwrites from the left`, (await field(page, 0).inputValue()) === '7A000000');
  s = await state(page);
  check(`${p} the typed D0 reaches the engine at the next Trace Into, not before`, s.d0 === 0);
  await page.evaluate(() => window.__u1.session.controller.rewind());
  check(`${p} a refresh (Rewind) discards the typed D0`, (await field(page, 0).inputValue()) === '00000000');

  // SR: Backspace types a 0 at the caret.
  const sr = field(page, 19);
  await sr.click();
  await page.evaluate(() => document.querySelector('.e68-regs input[data-box="19"]').setSelectionRange(2, 2));
  await page.keyboard.press('Backspace');
  check(
    `${p} SR: Backspace types a 0 at the caret (the S bit)`,
    (await sr.inputValue()) === '0000000000000000',
    await sr.inputValue(),
  );
  check(
    `${p} SR: the A7 field now shows the user stack pointer`,
    (await field(page, 15).inputValue()) === (await field(page, 16).inputValue()),
  );
  await page.evaluate(() => window.__u1.session.controller.rewind());

  // Find: Ctrl+F, type, Enter, F3, Escape.
  await page.locator('.e68-listing__list').focus();
  await page.keyboard.press('Control+f');
  const dialog = page.getByRole('dialog', { name: 'Find' });
  await dialog.waitFor();
  check(`${p} Ctrl+F opens the modeless Find dialog`, (await dialog.getAttribute('aria-modal')) !== 'true');
  const findButton = dialog.getByRole('button', { name: /Find\s+\(F3\)/ });
  check(`${p} Find  (F3) is disabled while the text is empty`, await findButton.isDisabled());
  await page.keyboard.type('move');
  await page.keyboard.press('Enter');
  s = await state(page);
  check(`${p} Enter finds the first row containing "move"`, s.selected === moveRow, String(s.selected));
  await page.keyboard.press('F3');
  const moveaRow = await rowIndex(page, 'MOVEA.L');
  s = await state(page);
  check(`${p} F3 finds the next one`, s.selected === moveaRow, String(s.selected));
  await page.screenshot({ path: join(outDir, `${name}-${theme}-find.png`) });
  await page.keyboard.press('Escape');
  s = await state(page);
  check(`${p} Escape closes the dialog`, s.dialogs.length === 0);

  // Go to PC: a click elsewhere, then Ctrl+G.
  await rowLocator(page, 'No errors').click();
  await page.keyboard.press('Control+g');
  s = await state(page);
  check(`${p} Ctrl+G selects the PC row again`, s.selected === moveRow, String(s.selected));

  // Keyboard: arrows move the selection, Space toggles, Enter sets the PC.
  await page.keyboard.press('ArrowDown');
  s = await state(page);
  check(`${p} ArrowDown moves the selection`, s.selected === moveRow + 1);
  await page.keyboard.press('Space');
  s = await state(page);
  check(
    `${p} Space toggles the selected row's breakpoint`,
    JSON.stringify(s.breakpoints) === '[4098]',
    JSON.stringify(s.breakpoints),
  );
  await page.keyboard.press('Enter');
  check(`${p} Enter sets the PC field from the selected row`, (await field(page, 18).inputValue()) === '00001002');

  // A trace adds a message line and marks changed registers.
  await page.evaluate(() => window.__u1.session.controller.traceInto());
  await page.waitForFunction(() => document.querySelector('.e68-messages').innerText.includes('PC=00001002'));
  check(`${p} a traced instruction appears in the message area`, true);
  // The polite log region that announces new lines: hidden with the kit's e68-sr, but it keeps the
  // trace line's runs of spaces (white-space: pre).
  const announce = await page.evaluate(() => {
    const region = document.querySelector('.e68-messages [role="log"]');
    const style = getComputedStyle(region);
    const box = region.getBoundingClientRect();
    return { text: region.textContent, width: box.width, height: box.height, whiteSpace: style.whiteSpace };
  });
  check(
    `${p} the log region holds the new line, is visually hidden and keeps its spaces`,
    announce.text.includes('PC=00001002') &&
      announce.width <= 1 &&
      announce.height <= 1 &&
      announce.whiteSpace === 'pre',
    JSON.stringify(announce),
  );
  const changed = await page.locator('.e68-regs input[data-changed="true"]').count();
  check(`${p} changed registers are marked`, changed > 0, String(changed));
  await page.screenshot({ path: join(outDir, `${name}-${theme}-traced.png`) });

  await scan(page, `${name} ${theme}`);
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** A 100,000-row listing: third-visible-row positioning and scrolling frame times. */
async function bigListingPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openPage(browser, 'light');
  await page.evaluate(() => {
    const { session, program } = window.__u1;
    const lines = [
      '00001000 Starting Address',
      'Assembler used: EASy68K Editor/Assembler v5.16.01',
      'Created On: 1/1/2026 12:00:00 PM',
    ];
    for (let index = 0; index < 100_000 - 3; index++) {
      const address = (0x1000 + index * 2).toString(16).toUpperCase().padStart(8, '0');
      lines.push(
        `${address}  4E71${' '.repeat(23)}${String(index + 1).padStart(6, ' ')}      NOP   ; row ${index + 3}`,
      );
    }
    const bytes = new TextEncoder().encode(lines.join('\r\n') + '\r\n');
    session.controller.loadBytes('/browser/demo/big.S68', program.s68, bytes);
  });
  await page.waitForFunction(() => window.__u1.app.ctx.sim.listing.rows.length === 100_000);
  const rendered = await page.locator('.e68-listing__row').count();
  check(
    `${p} 100,000 rows, of which only the visible ones are in the page`,
    rendered > 10 && rendered < 200,
    `${rendered} row elements`,
  );

  // Third-visible-row rule: a PC far below the window.
  const target = 76_543;
  await page.evaluate((row) => {
    const { simMainOf, app } = window.__u1;
    const address = (0x1000 + (row - 3) * 2).toString(16).toUpperCase().padStart(8, '0');
    simMainOf(app.ctx).editRegister(18, address);
  }, target);
  // The scroll is applied in a layout effect after React has rendered the new selection.
  await page
    .waitForFunction(
      (row) => {
        const list = document.querySelector('.e68-listing__list');
        const first = document.querySelector('.e68-listing__row');
        return (
          window.__u1.app.ctx.store.getState().sim.selectedRow === row &&
          list !== null &&
          first !== null &&
          list.scrollTop > 0
        );
      },
      target,
      { timeout: 10_000 },
    )
    .catch(() => {});
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const position = await page.evaluate(() => {
    const list = document.querySelector('.e68-listing__list');
    const rowHeight = document.querySelector('.e68-listing__row').getBoundingClientRect().height;
    return {
      top: Math.round(list.scrollTop / rowHeight),
      selected: window.__u1.app.ctx.store.getState().sim.selectedRow,
    };
  });
  check(
    `${p} a typed PC far below selects its row and puts it on the third visible row`,
    position.selected === target && position.selected - position.top === 2,
    JSON.stringify(position),
  );
  await page.screenshot({ path: join(outDir, `${name}-big-listing.png`) });

  // Frame times while scrolling by script, one step per frame, best of three runs: 10 rows per
  // frame (a fast hand on a wheel or a scroll bar) and 187 rows per frame (every row new each frame).
  const measure = (pixels) =>
    page.evaluate(
      (stepPx) =>
        new Promise((done) => {
          const list = document.querySelector('.e68-listing__list');
          list.scrollTop = 0;
          const times = [];
          let last = performance.now();
          let frame = 0;
          const step = () => {
            const now = performance.now();
            times.push(now - last);
            last = now;
            list.scrollTop += stepPx;
            if (++frame < 120) requestAnimationFrame(step);
            else {
              times.shift();
              times.sort((a, b) => a - b);
              done({
                median: times[Math.floor(times.length / 2)],
                p95: times[Math.floor(times.length * 0.95)],
                max: times[times.length - 1],
              });
            }
          };
          requestAnimationFrame(step);
        }),
      pixels,
    );
  const fmt = (r) => `median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms`;
  // The page's own work per scroll step: the scroll handler and React's render of the rows.
  const scriptCost = () =>
    page.evaluate(
      () =>
        new Promise((done) => {
          const list = document.querySelector('.e68-listing__list');
          list.scrollTop = 0;
          const costs = [];
          const step = () => {
            const start = performance.now();
            list.scrollTop += 160;
            list.dispatchEvent(new Event('scroll'));
            void list.querySelector('.e68-listing__row')?.getBoundingClientRect(); // includes layout
            costs.push(performance.now() - start);
            if (costs.length < 60) requestAnimationFrame(step);
            else {
              costs.sort((a, b) => a - b);
              done({ median: costs[30], p95: costs[57] });
            }
          };
          requestAnimationFrame(step);
        }),
    );
  const costs = [];
  for (let run = 0; run < 3; run++) costs.push(await scriptCost());
  const cheapest = costs.reduce((a, b) => (b.p95 < a.p95 ? b : a));
  console.log(
    `        work per 10-row scroll step, three runs: ${costs.map((c) => `median ${c.median.toFixed(1)} ms, p95 ${c.p95.toFixed(1)} ms`).join(' | ')}`,
  );
  check(
    `${p} a scroll step costs the page little (best run p95 under 8 ms)`,
    cheapest.p95 < 8,
    `p95 ${cheapest.p95.toFixed(1)} ms`,
  );

  // Frame times seen by the user, compared with the browser's idle frame rate at the same moment
  // (the machine may be busy): the listing must not add more than two 60 Hz frames.
  for (const [pixels, label] of [
    [160, '10 rows per frame'],
    [3000, '187 rows per frame'],
  ]) {
    const runs = [];
    for (let run = 0; run < 5; run++) {
      const quiet = await measure(0);
      const busy = await measure(pixels);
      runs.push({ quiet, busy });
    }
    const best = runs.reduce((a, b) => (b.busy.p95 - b.quiet.p95 < a.busy.p95 - a.quiet.p95 ? b : a));
    console.log(
      `        ${label}, five runs (idle | scrolling): ${runs.map((r) => `p95 ${r.quiet.p95.toFixed(0)} | ${r.busy.p95.toFixed(0)} ms`).join(', ')}`,
    );
    const ok = best.busy.p95 < 50 || best.busy.p95 - best.quiet.p95 < 34;
    const detail = `scrolling ${fmt(best.busy)}; idle ${fmt(best.quiet)}`;
    if (name === 'chromium' && !REPORT_FRAME_TIMES_ONLY) {
      check(
        `${p} scrolling 100,000 rows at ${label}: frames under 50 ms or at most 34 ms over idle (best run)`,
        ok,
        detail,
      );
    } else {
      // Playwright's WebKit build for Windows: on the busy development machine its scrolling frames
      // took 60-100 ms while the page's own work per step stayed at about 1 ms (measured above), and
      // switching off the gutter's sticky position or the row containment made no difference. The
      // frame figures are reported; the page's own work is the criterion in this browser. On CI
      // runners (shared machines, software rendering) the same holds for Chromium.
      const why = REPORT_FRAME_TIMES_ONLY ? 'reported only on CI runners' : `reported only for ${name}`;
      console.log(`        ${ok ? 'within' : 'NOT within'} the Chromium limit (${why}): ${detail}`);
    }
  }

  const wheel = [];
  for (let run = 0; run < 3; run++) {
    await page.locator('.e68-listing__list').hover();
    const t0 = Date.now();
    for (let index = 0; index < 40; index++) await page.mouse.wheel(0, 2400);
    const elapsed = Date.now() - t0;
    const top = await page.evaluate(() => document.querySelector('.e68-listing__list').scrollTop);
    wheel.push({ elapsed, top });
    await page.evaluate(() => {
      document.querySelector('.e68-listing__list').scrollTop = 0;
    });
  }
  console.log(
    `        40 wheel steps, three runs: ${wheel.map((w) => `${w.elapsed} ms to scrollTop ${Math.round(w.top)}`).join(' | ')}`,
  );
  check(
    `${p} the mouse wheel scrolls the big listing`,
    wheel.every((w) => w.top > 0),
  );
  const rowsAfter = await page.locator('.e68-listing__row').count();
  check(`${p} still only the visible rows after scrolling`, rowsAfter < 200, String(rowsAfter));
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/**
 * The real application (bootstrap, SH8's session and run controller, the run feature's boxes, U2's
 * Memory panel): the panels on the real parts, as gate I1 asked (build/gate1/U1.json).
 */
async function realAppPass(browser, name) {
  const p = `${name}/real application:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('crash', () => errors.push('the page crashed'));
  await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, undefined, { timeout: LOAD_TIMEOUT });

  // Assemble the programs in the page, store them, switch to Simulator mode, wait for the engine.
  await page.evaluate(
    async ({ source }) => {
      const { ctx } = window.__easy68k;
      const engineTesting = await import('/src/engine/testing.ts');
      const nops = ['    ORG $1000', 'START:'];
      for (let index = 0; index < 101; index++) nops.push('    NOP');
      nops.push('    SIMHALT', '    END START');
      const programs = {
        demo: await engineTesting.assembleProgram(source),
        nops: await engineTesting.assembleProgram(nops),
      };
      for (const [file, program] of Object.entries(programs)) {
        await ctx.vfs.writeFile(`/browser/u1check/${file}.S68`, program.s68);
        await ctx.vfs.writeFile(`/browser/u1check/${file}.L68`, program.l68);
      }
      window.__u1real = { simMainOf: (await import('/src/features/sim-main/model.ts')).simMainOf };
      await ctx.commands.run('app.mode.set', 'simulator');
    },
    { source: SOURCE },
  );
  await page.waitForFunction(
    () => {
      const { ctx } = window.__easy68k;
      return ctx.store.getState().sim.phase === 'idle' && ctx.sim.engine.state().hardwareEnabled;
    },
    undefined,
    { timeout: LOAD_TIMEOUT },
  );
  const open = (file) =>
    page.evaluate((path) => window.__easy68k.ctx.sim.controller.open(path, 'open'), `/browser/u1check/${file}.S68`);
  const run = (id) => page.evaluate((command) => window.__easy68k.ctx.commands.run(command), id);
  const real = () =>
    page.evaluate(() => {
      const { ctx } = window.__easy68k;
      return {
        selected: ctx.store.getState().sim.selectedRow,
        storeBreakpoints: ctx.store.getState().sim.breakpoints,
        breakpoints: ctx.sim.engine.breakpoints(),
        rows: ctx.sim.listing.rows.length,
        pc: ctx.sim.controller.snapshot.boxes[18],
      };
    });

  await open('demo');
  await page.waitForSelector('.e68-listing__row', { timeout: 30_000 });
  const moveRow = await rowIndex(page, 'MOVE.L #5,D1');
  let s = await real();
  check(
    `${p} a load shows the listing with the start row selected and marked`,
    s.selected === moveRow &&
      (await page.locator(`.e68-listing__row[data-row="${moveRow}"]`).getAttribute('aria-selected')) === 'true' &&
      (await page.locator(`.e68-listing__row[data-row="${moveRow}"] .e68-listing__pc`).count()) === 1,
    JSON.stringify(s),
  );
  check(`${p} the PC field shows the start address`, (await field(page, 18).inputValue()) === '00001000');
  check(
    `${p} the message area shows the load messages`,
    (await page.locator('.e68-messages').innerText()).includes('.S68 file read successful'),
  );

  // Gutter on the real controller: the engine and the store's mirror follow.
  const addRow = rowLocator(page, 'ADD.L D0,D1');
  await addRow.locator('.e68-listing__gutter').click();
  s = await real();
  check(
    `${p} a gutter click sets the breakpoint in the engine and in AppState.sim.breakpoints`,
    JSON.stringify(s.breakpoints) === '[4098]' &&
      JSON.stringify(s.storeBreakpoints) === '[4098]' &&
      (await addRow.getAttribute('data-bp')) === 'on',
    JSON.stringify(s),
  );
  await run('sim.run.run');
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase === 'idle', undefined, {
    timeout: 15_000,
  });
  s = await real();
  const addIndex = await rowIndex(page, 'ADD.L D0,D1');
  check(
    `${p} Run stops at the breakpoint and the listing selects its row`,
    s.pc === '00001002' && s.selected === addIndex,
    JSON.stringify(s),
  );
  await addRow.locator('.e68-listing__gutter').click();

  // highlight() at every stop: a clicked row gives way to the PC row, even when it did not change.
  await run('sim.run.traceInto'); // ADD.L
  await run('sim.run.traceInto'); // MOVEA.L
  const braRow = await rowIndex(page, 'BRA.S LOOP');
  await rowLocator(page, 'MOVE.L #5,D1').locator('.e68-listing__text').click();
  check(`${p} a click selects a row`, (await real()).selected === moveRow);
  await run('sim.run.traceInto'); // BRA.S LOOP
  await run('sim.run.traceInto'); // BRA.S LOOP again
  await rowLocator(page, 'MOVE.L #5,D1').locator('.e68-listing__text').click();
  await run('sim.run.traceInto'); // the PC row is the same row as before
  s = await real();
  check(
    `${p} after a trace step the PC row is selected again, also when it is the same row`,
    s.selected === braRow &&
      (await page.locator(`.e68-listing__row[data-row="${braRow}"]`).getAttribute('aria-selected')) === 'true',
    JSON.stringify(s),
  );

  // Double-click on A0 (now $2000): U2's Memory panel shows that address.
  await field(page, 8).dblclick();
  const memoryRow = page.locator('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)').first();
  const memoryText = await memoryRow
    .waitFor({ timeout: 10_000 })
    .then(() => memoryRow.innerText())
    .catch((error) => `no Memory panel row: ${error.message.split('\n')[0]}`);
  check(
    `${p} a double-click on A0 shows the Memory panel at that address`,
    memoryText.startsWith('00002000:'),
    memoryText,
  );
  await page.screenshot({ path: join(outDir, `${name}-real-traced.png`) });

  // The 101st breakpoint: the run feature draws the engine's box.
  await open('nops');
  await page.waitForFunction(() => window.__easy68k.ctx.sim.listing.rows.length > 100, undefined, {
    timeout: 15_000,
  });
  const last = await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    const model = window.__u1real.simMainOf(ctx);
    const rows = ctx.sim.listing.rows
      .map((_text, row) => row)
      .filter((row) => row > 2 && ctx.sim.listing.isInstruction(row));
    for (const row of rows.slice(0, 100)) model.toggleBreakpoint(row);
    return rows[100];
  });
  await page.evaluate((row) => {
    const list = document.querySelector('[data-e68-panel="listing"] .e68-listing__list');
    const height = document.querySelector('.e68-listing__row').getBoundingClientRect().height;
    list.scrollTop = Math.max(0, row * height - list.clientHeight / 2);
  }, last);
  const lastGutter = page.locator(`.e68-listing__row[data-row="${last}"] .e68-listing__gutter`);
  await lastGutter.waitFor({ timeout: 10_000 });
  await lastGutter.click();
  const box = page.getByRole('alertdialog').filter({ hasText: 'Breakpoint Limit Reached!' });
  const shown = await box
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check(`${p} the 101st breakpoint shows the box "Breakpoint Limit Reached!"`, shown);
  if (shown) {
    check(
      `${p} the box has the title Error and an OK button`,
      (await box.getByText('Error', { exact: true }).count()) > 0 &&
        (await box.getByRole('button', { name: 'OK' }).count()) === 1,
    );
    await page.screenshot({ path: join(outDir, `${name}-real-breakpoint-limit.png`) });
    await box.getByRole('button', { name: 'OK' }).click();
    await box.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  }
  s = await real();
  check(`${p} the table stays at 100 breakpoints`, s.breakpoints.length === 100, String(s.breakpoints.length));
  const dots = await page.locator('.e68-listing__dot--on').count();
  check(`${p} the visible rows show their breakpoints`, dots > 0, String(dots));

  // Open the same program again while the PC field already reads its start address and the list is
  // scrolled down: the original selects no row (ListBox1->Items->Clear() is LB_RESETCONTENT, and
  // the unchanged PC text runs no regPCChange/highlight(); errata U1.md entry 8) and its list box
  // starts at the top again (LB_RESETCONTENT sets the top index to 0). The next trace step, and
  // Go to PC, select the PC row.
  const scrolledBefore = await page.evaluate(
    () => document.querySelector('[data-e68-panel="listing"] .e68-listing__list').scrollTop,
  );
  await open('nops');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const reopened = await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    return {
      pc: ctx.sim.controller.snapshot.boxes[18],
      engineRow: ctx.sim.engine.listingHighlight,
      selected: ctx.store.getState().sim.selectedRow,
      ariaSelected: document.querySelectorAll('.e68-listing__row[aria-selected="true"]').length,
      scrollTop: document.querySelector('[data-e68-panel="listing"] .e68-listing__list').scrollTop,
    };
  });
  check(
    `${p} the same program opened again at an unchanged PC selects no row, as the original does`,
    reopened.pc === '00001000' && reopened.engineRow === -1 && reopened.selected === -1 && reopened.ariaSelected === 0,
    JSON.stringify(reopened),
  );
  check(
    `${p} ... and its listing starts at the top again (LB_RESETCONTENT)`,
    scrolledBefore > 0 && reopened.scrollTop === 0,
    `scrollTop before ${scrolledBefore}, after ${reopened.scrollTop}`,
  );
  await run('sim.search.gotoPC');
  const firstNop = await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    return ctx.sim.listing.rows.findIndex((text, row) => row > 2 && ctx.sim.listing.isInstruction(row));
  });
  s = await real();
  check(`${p} ... Go to PC then selects the PC row`, s.selected === firstNop && firstNop > 2, JSON.stringify(s));
  await rowLocator(page, 'START:').locator('.e68-listing__text').click();
  await run('sim.run.traceInto');
  s = await real();
  check(
    `${p} ... and so does the next trace step`,
    s.pc === '00001002' && s.selected === firstNop + 1,
    `${JSON.stringify(s)}, first NOP row ${firstNop}`,
  );

  // File > Close: the Caution question, then an empty listing and no selection.
  const closing = run('sim.file.close');
  const caution = page.getByRole('alertdialog').filter({ has: page.getByRole('button', { name: 'Cancel' }) });
  await caution.waitFor({ timeout: 10_000 });
  await caution.getByRole('button', { name: 'OK' }).click();
  await closing;
  await page.waitForFunction(() => window.__easy68k.ctx.sim.listing.rows.length === 0, undefined, {
    timeout: 15_000,
  });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  s = await real();
  check(
    `${p} Close empties the listing and clears the selection`,
    s.rows === 0 && s.selected === -1 && (await page.locator('.e68-listing__row').count()) === 0,
    JSON.stringify(s),
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

// --- part: a narrow or short region (version 1.1; the arrangement work) -------------------------
//
// The panel docked in the Simulator's default arrangement at 1366 x 768 and at 1024 x 700 (and
// SCENARIOS' own extra), and floating at 360 x 280: where its region is smaller than what it holds,
// the panel's own areas scroll and nothing else of the page does; the Tab walk through every
// control lands each one in view (inside the region and inside every scrolling box of the panel
// around it), with every box outside the panel unscrolled (errata N1 26); screenshots of each
// situation in both themes.

/** What the page shows of the panel: its region, its scrolling boxes, the scrolls outside it. */
const nrFacts = (page, panel) =>
  page.evaluate((id) => {
    const region = document.querySelector(`[data-e68-panel="${id}"]`);
    if (!region || !region.checkVisibility()) return null;
    const r = region.getBoundingClientRect();
    const areas = [];
    for (const element of [region, ...region.querySelectorAll('*')]) {
      const style = getComputedStyle(element);
      if (!/(auto|scroll)/.test(style.overflowX + style.overflowY)) continue;
      if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) continue;
      areas.push({
        name: String(element.className).split(' ')[0],
        client: [element.clientWidth, element.clientHeight],
        scroll: [element.scrollWidth, element.scrollHeight],
      });
    }
    let outer = 0;
    for (let element = region.parentElement; element; element = element.parentElement) {
      outer += element.scrollTop + element.scrollLeft;
    }
    return { region: [Math.round(r.width), Math.round(r.height)], areas, outer };
  }, panel);

/** Where the focused element is: in view inside the region and every clipping box of the panel? */
const nrFocused = (page, panel) =>
  page.evaluate((id) => {
    const region = document.querySelector(`[data-e68-panel="${id}"]`);
    let active = document.activeElement;
    if (!region || !active || !region.contains(active)) return null;
    const name = active.getAttribute('aria-label') ?? active.id ?? active.tagName;
    // The memory rows are larger than any view: their cursor cell is what must be seen.
    if (active.classList.contains('e68-memory__rows')) active = active.querySelector('.e68-memory__cursor') ?? active;
    const b = active.getBoundingClientRect();
    let view = region.getBoundingClientRect();
    view = { left: view.left, top: view.top, right: view.right, bottom: view.bottom };
    for (
      let element = active.parentElement;
      element && element !== region.parentElement;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (!/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) continue;
      const e = element.getBoundingClientRect();
      const left = e.left + element.clientLeft;
      const top = e.top + element.clientTop;
      view = {
        left: Math.max(view.left, left),
        top: Math.max(view.top, top),
        right: Math.min(view.right, left + element.clientWidth),
        bottom: Math.min(view.bottom, top + element.clientHeight),
      };
    }
    const seen =
      b.left >= view.left - 1 && b.top >= view.top - 1 && b.right <= view.right + 1 && b.bottom <= view.bottom + 1;
    let outer = 0;
    for (let element = region.parentElement; element; element = element.parentElement) {
      outer += element.scrollTop + element.scrollLeft;
    }
    return {
      name,
      seen,
      outer,
      box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
    };
  }, panel);

/** Tab from the panel's first control until the focus leaves the panel; each stop must be in view. */
async function nrTabWalk(page, panel, backward = false) {
  await page.evaluate(
    ([id, toLast]) => {
      const region = document.querySelector(`[data-e68-panel="${id}"]`);
      for (const element of [region, ...region.querySelectorAll('*')]) {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
      const controls = Array.from(region.querySelectorAll('input, select, button, [tabindex="0"]')).filter(
        (element) => !element.disabled && element.tabIndex >= 0 && element.checkVisibility(),
      );
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      (toLast ? controls[controls.length - 1] : controls[0])?.focus({ preventScroll: true });
    },
    [panel, backward],
  );
  const stops = [];
  for (let i = 0; i < 60; i++) {
    const where = await nrFocused(page, panel);
    if (where === null) break;
    stops.push(where);
    await page.keyboard.press(backward ? 'Shift+Tab' : 'Tab');
  }
  return {
    count: stops.length,
    hidden: stops.filter((stop) => !stop.seen),
    moved: stops.filter((stop) => stop.outer !== 0),
  };
}

async function nrTheme(page, theme) {
  await page.evaluate((t) => window.__easy68k.ctx.commands.run('app.theme.set', t), theme);
  await page.waitForFunction(
    (t) => (document.documentElement.getAttribute('data-theme') === 'dark') === (t === 'dark'),
    theme,
  );
}

/**
 * One panel in each situation. `spec`: { panel, extra (situations of its own: [label, width,
 * height, prepare(page)]), mouse(page, label) (a real wheel and click into the part that was out
 * of view; returns [ok, detail] or null where nothing overflows), keyboard(page) (optional, the
 * panel's own keys) }.
 */
async function narrowRegionPass(browser, name, spec) {
  const p = `${name}/narrow region (${spec.panel}):`;
  const situations = [
    ['docked 1366 x 768', 1366, 768, null],
    ['docked 1024 x 700', 1024, 700, null],
    ...spec.extra,
    [
      'floating 360 x 280',
      1366,
      768,
      (page, panel) =>
        page.evaluate((id) => window.__nrDock().float(id, { x: 420, y: 60, width: 360, height: 280 }), panel),
    ],
  ];
  for (const [label, width, height, prepare] of situations) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(baseUrl, { timeout: 180_000 });
    await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: 180_000 });
    await page.locator('.e68-modeswitch [data-mode="simulator"]').click();
    await page.evaluate(async (id) => {
      const [panels, dock, layout] = await Promise.all([
        import('/src/state/panels.ts'),
        import('/src/state/dock.ts'),
        import('/src/state/layout.ts'),
      ]);
      const { ctx } = window.__easy68k;
      window.__nrDock = () => dock.dockOf(ctx);
      window.__nrLayout = layout;
      panels.showPanel(ctx, id, { focus: true });
    }, spec.panel);
    await page.waitForFunction(
      (id) => document.querySelector(`[data-e68-panel="${id}"]`)?.checkVisibility(),
      spec.panel,
      {
        timeout: 30_000,
      },
    );
    if (prepare) await prepare(page, spec.panel);
    await page.waitForTimeout(600);
    const facts = await nrFacts(page, spec.panel);
    check(
      `${p} ${label}: the panel is shown; only its own boxes may scroll, nothing outside it is scrolled`,
      facts !== null && facts.outer === 0,
      JSON.stringify(facts),
    );
    const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const shot = label.startsWith('floating')
      ? page.locator(`.flexlayout__tab[data-e68-float="${spec.panel}"]`)
      : page.locator('[data-e68-dock="simulator"]');
    for (const theme of ['light', 'dark']) {
      await nrTheme(page, theme);
      await shot.screenshot({ path: join(outDir, `${name}-${spec.panel}-${slug}-${theme}.png`) }).catch((error) => {
        console.log(`        screenshot not taken: ${String(error).split('\n')[0]}`);
      });
    }
    await nrTheme(page, 'light');
    const mouse = await spec.mouse(page, label, facts);
    if (mouse !== null) check(`${p} ${label}: the wheel and a click reach what was out of view`, mouse[0], mouse[1]);
    const forward = await nrTabWalk(page, spec.panel);
    check(
      `${p} ${label}: Tab through every control lands each one in view, nothing outside the panel scrolls`,
      forward.count >= spec.minStops && forward.hidden.length === 0 && forward.moved.length === 0,
      `${forward.count} stops; hidden ${JSON.stringify(forward.hidden.slice(0, 2))}; moved ${forward.moved.length}`,
    );
    const backward = await nrTabWalk(page, spec.panel, true);
    check(
      `${p} ${label}: Shift+Tab back through them, likewise`,
      backward.count >= spec.minStops && backward.hidden.length === 0 && backward.moved.length === 0,
      `${backward.count} stops; hidden ${JSON.stringify(backward.hidden.slice(0, 2))}; moved ${backward.moved.length}`,
    );
    if (spec.keyboard) {
      const keys = await spec.keyboard(page, label);
      if (keys !== null) check(`${p} ${label}: ${keys[2]}`, keys[0], keys[1]);
    }
    const real = errors.filter((text) => !/Failed to load resource.*Timeout was reached/i.test(text));
    check(`${p} ${label}: no console or page errors`, real.length === 0, real.slice(0, 3).join(' | '));
    await closeWithin(context);
  }
}

/** The Registers panel's spec for the narrow-region part. */
const REGISTERS_NARROW = {
  panel: 'registers',
  minStops: 21,
  extra: [
    [
      'docked 1366 x 768, the left column dragged to its smallest',
      1366,
      768,
      (page) =>
        page.evaluate(() =>
          window.__easy68k.ctx.settings.update((settings) =>
            window.__nrLayout.withSplit(settings, 'sim.columns', 0.01),
          ),
        ),
    ],
  ],
  async mouse(page) {
    const area = await page.evaluate(() => {
      const element = document.querySelector('[data-e68-panel="registers"] [data-regs-scroll]');
      const b = element.getBoundingClientRect();
      const grid = element.firstElementChild.getBoundingClientRect();
      return {
        over: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
        view: { left: b.left, top: b.top, width: element.clientWidth, height: element.clientHeight },
        at: [Math.round(grid.left - b.left), Math.round(grid.top - b.top)],
      };
    });
    if (!area.over)
      return [area.at[0] === 0 && area.at[1] === 0, `it fits: nothing scrolls, the fields start at ${area.at}`];
    await page.mouse.move(area.view.left + area.view.width / 2, area.view.top + area.view.height / 2);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(300, 0);
    await page.waitForTimeout(300);
    const a4 = await page.evaluate(() => {
      const element = document.querySelector('[data-e68-panel="registers"] [data-regs-scroll]');
      const field = element.querySelector('[data-box="12"]').getBoundingClientRect();
      const b = element.getBoundingClientRect();
      return {
        scrollLeft: element.scrollLeft,
        inside: field.left >= b.left - 1 && field.right <= b.left + element.clientWidth + 1,
        x: field.left + field.width / 2,
        y: field.top + field.height / 2,
      };
    });
    if (!a4.inside) return [false, JSON.stringify(a4)];
    await page.mouse.click(a4.x, a4.y);
    // Reached: the click puts the focus into A4 (what typing then does is the editing rules',
    // checked by the other passes; with no program loaded the engine keeps the registers).
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-box') ?? null);
    return [
      a4.scrollLeft > 0 && focused === '12',
      `wheel to scrollLeft ${a4.scrollLeft}; the click focused box ${focused}`,
    ];
  },
};
// --- run -------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No HMR: other packages edit files under app/src while this runs, and a reload would end a pass.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false },
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
        for (const theme of ['light', 'dark']) {
          console.log(`\n[${name}, ${theme}]`);
          await interactionPass(browser, name, theme);
        }
        console.log(`\n[${name}, the real application]`);
        await realAppPass(browser, name);
        console.log(`\n[${name}, 100,000 rows]`);
        await bigListingPass(browser, name);
        console.log(`\n[${name}, narrow region]`);
        await narrowRegionPass(browser, name, REGISTERS_NARROW);
      } catch (error) {
        check(
          `${name}: the pass ran to its end`,
          false,
          error instanceof Error ? (error.stack ?? error.message) : String(error),
        );
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
