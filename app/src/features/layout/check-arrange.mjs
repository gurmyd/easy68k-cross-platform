// Browser check of version 1.1's finding and ready-made arrangements (ARCHITECTURE-PLUS P9.3, P9.4;
// package M2). Owner: M2.
//
//   node app/src/features/layout/check-arrange.mjs [--browser chromium|webkit|all] [--out <dir>]
//                                                  [--only <pass,...>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright). Passes:
//
//   button    `Arrange Panels` ends the Editor's and the Simulator's toolbar after a separator, the
//             original buttons before it unchanged; it is Lock Layout inverted: pressing it (mouse
//             and keyboard), Lock Layout in the menu, a reload and a second window opened later all
//             agree; its pressed state is in the accessibility tree; its tool-tip names the mode's
//             menu (View, Window); the toolbar stays one Tab stop
//   narrow    at 1366, 1024, 800, 600 and 500 px, in the Editor and the Simulator: every button of
//             1.0.0's row (the toolbar without the added separator and button) has the box it has
//             without them, Arrange Panels covers no other control and its caption stays inside its
//             frame (cut with an ellipsis where the row is too narrow), and where 1.0.0's row left
//             room the row does not overflow; a screenshot of each toolbar
//   tip       a driven browser sees no tip unless the address carries arrange-tip=1; with it: the tip
//             comes when the Simulator is shown, not in the Editor, not while a program runs (it
//             comes back when the program stops), takes no focus, is a polite live region, covers
//             neither the toolbar nor the status bar; Got it and Arrange Panels (which unlocks)
//             close it for good, also in a second window open at the same time and in one opened
//             later and after a reload; a button of it that had the focus gives the focus back;
//             screenshots in both themes
//   layouts   View > Layouts at 1366 x 768 and 1920 x 1080 in both themes, every tool panel shown:
//             the arrangement of each entry (its tree and floating windows), no page scroll, every
//             shown panel inside the window and at least 160 x 96 px, the floating windows of
//             Floating Tools where the rule of P9.8 point 1 puts them (arrangements.ts
//             floatingToolsLayout), below the toolbar and inside the dock, the Hardware panel whole
//             in its window at 1920 x 1080; Floating Tools chosen in the moment of the switch to the
//             Simulator starts at that dock's top right corner; visibility and the lock unchanged;
//             screenshots (sixteen per browser, in <out>/shots)
//   uncovered P9.8 points 1 and 5, measured as the review did (elementFromPoint every 4 px), with
//             a program that has drawn its picture, in both themes: Floating Tools with Hardware and
//             Memory shown at 1920 x 1080 (neither window covers the other, the whole 640 x 480
//             picture and the Hardware displays, lamps, switches and push buttons seen) and at
//             1366 x 768 (those devices and the left 400 px of the picture seen; what overlaps is
//             noted); with all five tool panels shown (the windows placed without overlap do not
//             overlap, the devices seen; at 1920 x 1080 no window covers another, P9.9 point 2; at
//             both sizes no point of the registers, the listing or the message area lies under a
//             floating window, P9.10 point 2; every overlap and what each docked panel keeps seen
//             noted); the Hardware window's content width (P9.9 point 5 from a dock of 1,403 px on,
//             P9.10 point 1: whole at 1920; at 1366 the width left beside the registers and the left
//             400 px of the picture, its content noted); Side by Side (the Output column at least
//             648 px, its whole picture seen; at 1366 x 768 with Memory shown as well, registers,
//             listing, Output and Hardware seen at once, P9.10 point 1); screenshots of each case in
//             <out>/shots
//   room      P9.9 point 4 and P9.10 point 3, at both sizes: Floating Tools keeps the room of its
//             windows; a window dragged out (nothing docked moves while the button is down) shrinks
//             it to the columns that still hold one, when the drag ends; a reload keeps it; with no
//             window in it the docked panels take the whole dock; moved back, the room comes back for
//             its column; Close gives it back; every other layout and Reset Layout clear it, stored
//             and shown; then the review's case in both themes (the Hardware window dragged left by
//             400 px: the room is given back when the windows left in it fill less than half of its
//             height, nothing moves while the button is down, a reload keeps it, dragged back the
//             room comes again); screenshots before and after in <out>/shots
//   program   while a program runs (it drew a picture and reads keys; the Memory panel at an address
//             of the check's choosing): each arrangement keeps the phase, the Output picture, the
//             Memory panel's address and every panel's content instance; with a panel hidden, an
//             arrangement leaves it hidden and showing it puts it at its place of the arrangement;
//             the lock is kept, locked and unlocked
//   menus     the View menu's submenu Layouts by mouse and by its access keys (T, then W)
//   dialog    Move Panel To... As a floating window makes the panel float and focuses it
//
// Prints "N of M checks passed" and exits non-zero on any failure or console error. Screenshots go
// to build/arrange-check (git-ignored) or --out.

/* global console, process, document, window, Navigator, requestAnimationFrame, setTimeout, getComputedStyle */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { closeAtEnd, closeWithin, doneWith, endChecks } from '../../../../tests/browser-checks/ending.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    [
      'Usage: node app/src/features/layout/check-arrange.mjs [--browser chromium|webkit|all] [--out <dir>]',
      '                                                      [--only <pass,...>]',
      '',
      '  --browser  the browsers to drive (default: all)',
      '  --out      where screenshots, proportions.json and the Vite cache go',
      '             (default: build/arrange-check of the repository, git-ignored)',
      '  --only     run only these passes: button, narrow, tip, layouts, uncovered, room, program, menus, dialog',
    ].join('\n'),
  );
  process.exit(0);
}
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'arrange-check')));
const only = option('--only', '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
mkdirSync(join(outDir, 'shots'), { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const engineDist = join(repoRoot, 'engine', 'dist');
const enginesPresent = existsSync(join(engineDist, 'asm68k.wasm')) && existsSync(join(engineDist, 'sim68k.wasm'));
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

const LOAD_TIMEOUT = 240_000;
const VIEWPORT = { width: 1400, height: 900 };
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];
const TOOLS = ['memory', 'stack', 'hardware', 'breakpoints', 'log'];
const SIM_PANELS = ['registers', 'listing', 'messages', 'output', ...TOOLS];
/** Floating Tools: the order the tool panels float in and each window's default size (arrangements.ts). */
const FLOATING_ORDER = ['hardware', 'memory', 'stack', 'breakpoints', 'log'];
/** arrangements.ts FLOATING_ROOM.left and .outputPart: the Registers column and the Output's 400 px with 2 px. */
const FLOATING_LEFT = 478;
const FLOATING_OUTPUT_PART = 402;
const WINDOW_SIZES = {
  hardware: { width: 540, height: 632, keep: 272, inRoom: true },
  memory: { width: 640, height: 356, inRoom: true },
  stack: { width: 300, height: 360 },
  breakpoints: { width: 560, height: 300 },
  log: { width: 440, height: 300 },
};

// The texts, as P9.3, P9.4 and P9.9 point 3 give them (the application's constants are in texts.ts
// and commands/tables/toolbars.ts; they are compared with these in the page).
const TIP_TEXT =
  "You can rearrange this window. Press Arrange Panels to show each panel's tab; then double-click a tab to make the panel float, or drag it to dock it elsewhere. Ready-made layouts are in the View menu.";
const SIM_TOOLTIP = 'Arrange Panels: drag a panel by its tab, or right-click a tab for more (View > Lock Layout)';
const EDITOR_TOOLTIP = 'Arrange Panels: drag a panel by its tab, or right-click a tab for more (Window > Lock Layout)';
const ARRANGEMENTS = [
  { id: 'classic', command: 'sim.view.layout.classic', caption: 'Classic' },
  { id: 'wideOutput', command: 'sim.view.layout.wideOutput', caption: 'Wide Output' },
  { id: 'sideBySide', command: 'sim.view.layout.sideBySide', caption: 'Output and Hardware Side by Side' },
  { id: 'floatingTools', command: 'sim.view.layout.floatingTools', caption: 'Floating Tools' },
];
/** The docked tree of each arrangement with every panel shown (wide window). */
const SHAPES = {
  classic: 'row(column(registers, listing, messages), column(output, memory+stack+hardware+breakpoints+log))',
  wideOutput: 'row(column(registers, listing, memory+stack+hardware+breakpoints+log, messages), output)',
  sideBySide: 'row(column(registers, listing, memory+stack+breakpoints+log, messages), output, hardware)',
  floatingTools: 'row(column(registers, listing, messages), output)',
};

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const notes = [];
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** The proportions measured at each size, for erratum M2 (written to <out>/proportions.json). */
const measured = [];

// --- pages ------------------------------------------------------------------------------------

function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function newContext(browser, viewport = VIEWPORT) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(pretendWindows);
  return context;
}

const isMissingEngineError = (text) =>
  !enginesPresent &&
  !enginesRequired &&
  /Simulator:|sim68k|asm68k|engine\/dist|Failed to fetch dynamically/i.test(text);

async function openApp(context, query = '') {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isMissingEngineError(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (!isMissingEngineError(String(error))) errors.push(String(error));
  });
  await page.goto(`${baseUrl}${query}`, { timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await installHooks(page);
  return { page, errors };
}

/** Waits for the application and gives the check its hooks (window.__arrange); again after a reload. */
async function installHooks(page) {
  await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: LOAD_TIMEOUT });
  await page
    .waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, { timeout: 60_000 })
    .catch(() => {});
  await page.evaluate(async () => {
    const [panels, dock, plus] = await Promise.all([
      import('/src/state/panels.ts'),
      import('/src/state/dock.ts'),
      import('/src/core/plus/settings.ts'),
    ]);
    const { ctx } = window.__easy68k;
    window.__arrange = {
      ctx,
      panels,
      dock: () => dock.dockOf(ctx),
      answered: () => plus.arrangeTipAnswered(ctx.settings.get()),
      shape() {
        const visit = (node) =>
          node === null
            ? 'empty'
            : node.type === 'tabs'
              ? node.panels.join('+')
              : `${node.type}(${node.children.map(visit).join(', ')})`;
        return visit(window.__easy68kDock?.simulator?.tree() ?? null);
      },
    };
  });
}

async function until(page, fn, arg, timeout = 10_000) {
  return page
    .waitForFunction(fn, arg, { timeout, polling: 50 })
    .then(() => true)
    .catch(() => false);
}

const frames = (page, count = 3) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let left = n;
        const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    count,
  );
const settle = async (page) => {
  await frames(page, 4);
  await sleep(120);
  await frames(page, 2);
};

const setMode = (page, mode) => page.locator(`.e68-modeswitch [data-mode="${mode}"]`).click();
const run = (page, id, arg) =>
  page.evaluate(([command, value]) => window.__easy68k.ctx.commands.run(command, value), [id, arg]);
const arrangeButton = (page) => page.locator('.e68-shell__toolbar button[data-command="app.layout.lock"]');
const tip = (page) => page.locator('[data-e68-arrange-tip]');
const locked = (page) => page.evaluate(() => window.__arrange.dock().locked());
const panelsSetting = (page) =>
  page.evaluate(() => JSON.stringify(window.__easy68k.ctx.settings.get().app.layout.panels));

function finish(name, errors) {
  check(`${name}: no console error`, errors.length === 0, errors.slice(0, 3).join(' | '));
}

// --- programs ---------------------------------------------------------------------------------

/** Draws a filled rectangle (TRAP #15 tasks 81 and 87), then reads keys for ever. */
const DRAW_THEN_KEYS = [
  '        ORG     $1000',
  'START:  MOVE.L  #$0000FF00,D1',
  '        MOVEQ   #81,D0',
  '        TRAP    #15',
  '        MOVE.W  #20,D1',
  '        MOVE.W  #20,D2',
  '        MOVE.W  #200,D3',
  '        MOVE.W  #120,D4',
  '        MOVEQ   #87,D0',
  '        TRAP    #15',
  'LOOP:   MOVEQ   #0,D1',
  '        MOVEQ   #19,D0',
  '        TRAP    #15',
  '        BRA     LOOP',
  '        END     START',
];

async function loadProgram(page, name, lines) {
  const path = await page.evaluate(
    async ([n, l]) => {
      const engine = await import('/src/engine/testing.ts');
      const { ctx } = window.__easy68k;
      const { s68, l68 } = await engine.assembleProgram(l);
      const file = `/browser/arrange-check/${n}.S68`;
      await ctx.vfs.writeFile(file, s68);
      await ctx.vfs.writeFile(file.replace(/S68$/, 'L68'), l68);
      if (ctx.sim.controller.phase !== 'idle') ctx.sim.controller.pause();
      ctx.sim.controller.open(file, 'open').catch((error) => console.error('arrange-check: the load failed', error));
      return file;
    },
    [name, lines],
  );
  const end = Date.now() + 90_000;
  for (;;) {
    const loaded = await page.evaluate((file) => {
      const state = window.__easy68k.ctx.store.getState().sim;
      return state.phase === 'idle' && state.program?.path === file;
    }, path);
    if (loaded) return;
    const ok = page.locator('[role=alertdialog] .e68-dialog__footer button', { hasText: 'OK' });
    if ((await ok.count()) > 0) await ok.first().click();
    if (Date.now() > end) throw new Error(`The program ${name} was not loaded within 90 s`);
    await sleep(100);
  }
}

const phase = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().sim.phase);
const runningNow = (page) =>
  until(
    page,
    () => ['running', 'waitInput', 'waitDelay'].includes(window.__easy68k.ctx.store.getState().sim.phase),
    null,
    30_000,
  );

// --- pass: button -----------------------------------------------------------------------------

async function buttonPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  for (const mode of ['editor', 'simulator']) {
    await setMode(page, mode);
    await settle(page);
    const toolbar = await page.evaluate(() => {
      const root = document.querySelector('.e68-shell__toolbar');
      const items = Array.from(root.querySelectorAll('button, [role=separator], .e68-toolbar__spacer'));
      return items.map((element) =>
        element.matches('[role=separator]')
          ? '|'
          : element.matches('.e68-toolbar__spacer')
            ? '<spacer>'
            : (element.getAttribute('data-command') ?? '?'),
      );
    });
    const at = toolbar.indexOf('app.layout.lock');
    check(
      `${p} ${mode}: Arrange Panels is the toolbar's last button before the spacer, after a separator`,
      at > 0 &&
        toolbar[at - 1] === '|' &&
        toolbar[at + 1] === '<spacer>' &&
        toolbar.filter((id) => id === 'app.layout.lock').length === 1,
      JSON.stringify(toolbar),
    );
    const original = await page.evaluate(async (m) => {
      const { TOOLBARS } = await import('/src/commands/tables/toolbars.ts');
      return TOOLBARS[m]
        .slice(0, -2)
        .map((node) => (node.type === 'command' ? node.id : node.type === 'separator' ? '|' : node.type));
    }, mode);
    const onScreen = toolbar.slice(0, at - 1).filter((id) => id !== '?');
    check(
      `${p} ${mode}: the original buttons keep their order before it`,
      same(
        onScreen,
        original.filter((id) => id !== 'logging'),
      ),
      `${JSON.stringify(onScreen)} vs ${JSON.stringify(original)}`,
    );
    const button = arrangeButton(page);
    const described = await button.evaluate((element) => ({
      name: element.getAttribute('aria-label'),
      text: element.textContent,
      pressed: element.getAttribute('aria-pressed'),
      tabIndex: element.tabIndex,
    }));
    check(
      `${p} ${mode}: it reads "Arrange Panels", not pressed while locked (D2)`,
      described.name === 'Arrange Panels' && described.text === 'Arrange Panels' && described.pressed === 'false',
      JSON.stringify(described),
    );
    // Its tool-tip on hover, the mode's menu named.
    await button.hover();
    const tooltip = await until(
      page,
      (text) => Array.from(document.querySelectorAll('[role=tooltip]')).some((element) => element.textContent === text),
      mode === 'editor' ? EDITOR_TOOLTIP : SIM_TOOLTIP,
      5_000,
    );
    const describedBy = await button.evaluate(
      (element) => document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent ?? null,
    );
    check(
      `${p} ${mode}: its tool-tip is the text of P9.3 and describes it`,
      tooltip && describedBy === (mode === 'editor' ? EDITOR_TOOLTIP : SIM_TOOLTIP),
      String(describedBy),
    );
    await page.mouse.move(5, VIEWPORT.height - 5);
  }
  // Mouse: press it, the layout is unlocked, the menu's check follows.
  await arrangeButton(page).click();
  await settle(page);
  const afterClick = await page.evaluate(() => ({
    locked: window.__arrange.dock().locked(),
    checked: window.__easy68k.ctx.commands.isChecked('app.layout.lock'),
  }));
  check(
    `${p} pressing it unlocks the layout and Lock Layout is unchecked`,
    !afterClick.locked && !afterClick.checked && (await arrangeButton(page).getAttribute('aria-pressed')) === 'true',
    JSON.stringify(afterClick),
  );
  const strips = await page.evaluate(
    () => document.querySelectorAll('[data-e68-workspace="simulator"] .flexlayout__tabset_tabbar_outer').length,
  );
  check(`${p} unlocked, every group of the Simulator shows its tab strip`, strips >= 4, String(strips));
  // The accessibility tree names it pressed.
  const pressedRole = await page.getByRole('button', { name: 'Arrange Panels', pressed: true }).count();
  check(`${p} the accessibility tree has the button "Arrange Panels", pressed`, pressedRole === 1, String(pressedRole));
  // The menu: Lock Layout locks again, the button follows.
  await page.locator('.e68-menubar [role=menuitem]', { hasText: 'View' }).click();
  await page.locator('[role=menu] [role=menuitemcheckbox]', { hasText: 'Lock Layout' }).click();
  await settle(page);
  check(
    `${p} View > Lock Layout locks it again; the button is not pressed`,
    (await locked(page)) && (await arrangeButton(page).getAttribute('aria-pressed')) === 'false',
  );
  // Keyboard: the toolbar is one Tab stop; the arrows reach the button, Space presses it.
  const stops = await page.evaluate(() => document.querySelectorAll('.e68-shell__toolbar [tabindex="0"]').length);
  check(`${p} the toolbar is still one Tab stop`, stops === 1, String(stops));
  await page.locator('.e68-shell__toolbar button[data-command="sim.file.open"]').focus();
  let reached = false;
  for (let i = 0; i < 20 && !reached; i++) {
    await page.keyboard.press('ArrowRight');
    reached = await page.evaluate(() => document.activeElement?.getAttribute('data-command') === 'app.layout.lock');
  }
  await page.keyboard.press('Space');
  await settle(page);
  check(
    `${p} the Right arrow reaches it and Space presses it`,
    reached && !(await locked(page)) && (await arrangeButton(page).getAttribute('aria-pressed')) === 'true',
    `reached ${reached}`,
  );
  // A reload and a second window opened later agree (the lock is stored with the layout).
  await page.reload({ timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: LOAD_TIMEOUT });
  await setMode(page, 'simulator');
  await settle(page);
  check(
    `${p} after a reload it is still pressed (unlocked)`,
    (await arrangeButton(page).getAttribute('aria-pressed')) === 'true',
  );
  const second = await openApp(context);
  await setMode(second.page, 'simulator');
  await settle(second.page);
  check(
    `${p} a second window opened later shows it pressed too, and is unlocked`,
    (await arrangeButton(second.page).getAttribute('aria-pressed')) === 'true' &&
      !(await second.page.evaluate(() => window.__arrange.dock().locked())),
  );
  await arrangeButton(second.page).click();
  await settle(second.page);
  check(
    `${p} pressing it in the second window locks that window`,
    (await arrangeButton(second.page).getAttribute('aria-pressed')) === 'false',
  );
  finish(`${p} second window`, second.errors);
  finish(`${p} button`, errors);
  await closeWithin(context);
}

// --- pass: narrow -----------------------------------------------------------------------------

/** The window widths at which the toolbar is checked (the closing pass of version 1.1). */
const NARROW_WIDTHS = [1366, 1024, 800, 600, 500];

/**
 * The toolbar's items in the page: every button, separator and the LOGGING label, with its box
 * (CSS px, two decimals), and the Arrange Panels button's caption box. With `without` the button
 * and the separator before it are taken out of the row (display: none on the toolbar's children
 * that hold them) before measuring, which is the row 1.0.0 draws: version 1.1 adds exactly those
 * two items to it (toolbars.ts), so the original's buttons must have the same boxes either way.
 */
function measureToolbar(page, without) {
  return page.evaluate(async (hide) => {
    const root = document.querySelector('.e68-shell__toolbar');
    const button = root.querySelector('button[data-command="app.layout.lock"]');
    let holder = button;
    while (holder.parentElement !== root) holder = holder.parentElement;
    const separator = holder.previousElementSibling;
    for (const element of [holder, separator]) element.style.display = hide ? 'none' : '';
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const box = (element) => {
      const r = element.getBoundingClientRect();
      const round = (v) => Math.round(v * 100) / 100;
      return { left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom) };
    };
    const items = Array.from(root.querySelectorAll('button, [role=separator], .e68-shell__logging'))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        id: element.matches('[role=separator]')
          ? '|'
          : element.matches('.e68-shell__logging')
            ? 'logging'
            : (element.getAttribute('data-command') ?? element.getAttribute('aria-label') ?? '?'),
        box: box(element),
      }));
    const caption = button.querySelector('.e68-button__caption');
    const result = {
      items,
      arrange: hide ? null : box(button),
      caption: hide || !caption ? null : box(caption),
      captionCut: hide || !caption ? false : caption.scrollWidth > caption.clientWidth + 0.5,
      toolbar: { client: root.clientWidth, scroll: root.scrollWidth },
      // The free room of the row: what its spacer takes (zero where the row is full).
      room: Math.round(root.querySelector('.e68-toolbar__spacer')?.getBoundingClientRect().width ?? 0),
      page: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
    };
    for (const element of [holder, separator]) element.style.display = '';
    return result;
  }, without);
}

const overlaps = (a, b) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const inside = (a, b) =>
  a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;

async function narrowPass(browser, name) {
  const p = `${name}:`;
  for (const width of NARROW_WIDTHS) {
    const context = await newContext(browser, { width, height: 700 });
    const { page, errors } = await openApp(context);
    for (const mode of ['editor', 'simulator']) {
      await setMode(page, mode);
      await settle(page);
      const before = await measureToolbar(page, true);
      const now = await measureToolbar(page, false);
      const at = `${p} ${width} px, ${mode}:`;
      // The original's buttons (everything before the added separator) keep their boxes (P1.1).
      const added = now.items.findIndex((item) => item.id === 'app.layout.lock');
      const was = before.items.slice(0, added - 1);
      const is = now.items.slice(0, added - 1);
      check(
        `${at} every button of 1.0.0's row is where 1.0.0 draws it`,
        same(was, is),
        same(was, is) ? `${was.length} items` : JSON.stringify({ was, is }).slice(0, 600),
      );
      // The caption is drawn inside the button's frame, and the frame over no other control.
      const others = now.items.filter((item) => item.id !== 'app.layout.lock');
      const hit = others.filter((item) => overlaps(item.box, now.arrange)).map((item) => item.id);
      check(
        `${at} Arrange Panels covers no other control and its caption stays inside its frame`,
        hit.length === 0 && now.caption !== null && inside(now.caption, now.arrange),
        JSON.stringify({ hit, arrange: now.arrange, caption: now.caption }),
      );
      check(
        `${at} the button is at least as wide as an icon button`,
        now.arrange.right - now.arrange.left >= 27.5,
        JSON.stringify(now.arrange),
      );
      // Where 1.0.0's row fitted with room for the addition at its smallest, nothing overflows.
      const room = before.room - Math.max(0, before.toolbar.scroll - before.toolbar.client);
      if (room >= 40) {
        // The page is no wider than 1.0.0's row makes it: on a system with wider fonts (DejaVu Sans,
        // Ubuntu) the menu bar and its mode switch already make 1.0.0's page 534 px wide at 500 px
        // (errata M2 entry 10); what the addition must not do is widen it further.
        check(
          `${at} the row fits (1.0.0 left ${room} px)`,
          now.toolbar.scroll <= now.toolbar.client && now.page.scroll <= Math.max(now.page.client, before.page.scroll),
          JSON.stringify({ toolbar: now.toolbar, page: now.page, pageWithout: before.page }),
        );
      } else {
        note(
          `${at} 1.0.0's row already fills the toolbar (room ${room} px); toolbar ${JSON.stringify(now.toolbar)}, caption cut ${now.captionCut}`,
        );
      }
      if (now.captionCut)
        note(`${at} the caption is cut with an ellipsis (${Math.round(now.arrange.right - now.arrange.left)} px)`);
      await page
        .locator('.e68-shell__toolbar')
        .screenshot({ path: join(outDir, 'shots', `${name}-toolbar-${mode}-${width}.png`) });
    }
    finish(`${p} ${width} px narrow`, errors);
    await closeWithin(context);
  }
}

// --- pass: tip --------------------------------------------------------------------------------

async function tipBox(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-e68-arrange-tip]');
    const box = (element) => {
      const r = element?.getBoundingClientRect();
      return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
    };
    return {
      tip: box(host?.firstElementChild),
      toolbar: box(document.querySelector('.e68-shell__toolbar')),
      status: box(document.querySelector('.e68-statusbar')),
      role: host?.getAttribute('role'),
      live: host?.getAttribute('aria-live'),
      text: host?.querySelector('p')?.textContent ?? null,
      buttons: Array.from(host?.querySelectorAll('button') ?? []).map((button) => button.textContent),
      overflow:
        document.documentElement.scrollWidth > window.innerWidth ||
        document.documentElement.scrollHeight > window.innerHeight,
    };
  });
}

async function tipPass(browser, name) {
  const p = `${name}:`;
  // A driven browser without the parameter: never.
  {
    const context = await newContext(browser);
    const { page, errors } = await openApp(context);
    await setMode(page, 'simulator');
    await settle(page);
    await sleep(300);
    check(`${p} without arrange-tip=1 a driven browser sees no tip`, (await tip(page).count()) === 0);
    finish(`${p} tip (automated)`, errors);
    await closeWithin(context);
  }
  const context = await newContext(browser);
  const { page, errors } = await openApp(context, '?arrange-tip=1');
  await settle(page);
  await sleep(300);
  check(`${p} the tip is not shown in the Editor`, (await tip(page).count()) === 0);
  // The focus stays where it was when the tip comes.
  await setMode(page, 'simulator');
  await page.locator('.e68-shell__toolbar button[data-command="sim.file.open"]').focus();
  const before = await page.evaluate(() => document.activeElement?.getAttribute('data-command'));
  const came = await until(page, () => document.querySelector('[data-e68-arrange-tip] p') !== null, null, 10_000);
  const box = await tipBox(page);
  check(`${p} the tip comes when the Simulator is shown`, came, JSON.stringify(box));
  check(
    `${p} its text and buttons are P9.3's`,
    box.text === TIP_TEXT && same(box.buttons, ['Arrange Panels', 'Got it']),
    JSON.stringify(box),
  );
  check(`${p} it is a polite live region (role status)`, box.role === 'status' && box.live === 'polite');
  const after = await page.evaluate(() => document.activeElement?.getAttribute('data-command'));
  check(`${p} it took no focus`, before === 'sim.file.open' && after === before, `${before} -> ${after}`);
  check(
    `${p} it covers neither the toolbar nor the status bar, and the page does not scroll`,
    box.tip !== null &&
      box.tip.top >= box.toolbar.bottom &&
      box.tip.bottom <= box.status.top &&
      box.tip.left >= 0 &&
      box.tip.right <= VIEWPORT.width &&
      !box.overflow,
    JSON.stringify(box),
  );
  for (const theme of ['light', 'dark']) {
    await run(page, 'app.theme.set', theme);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
    await settle(page);
    await page.screenshot({ path: join(outDir, `${name}-tip-${theme}.png`) });
  }
  await run(page, 'app.theme.set', 'light');
  // A second window open at the same time shows it too.
  const second = await openApp(context, '?arrange-tip=1');
  await setMode(second.page, 'simulator');
  check(
    `${p} a second window open at the same time shows it too`,
    await until(second.page, () => document.querySelector('[data-e68-arrange-tip] p') !== null, null, 10_000),
  );
  // Not while a program runs; back when it stops.
  if (enginesPresent) {
    await loadProgram(page, 'tip-keys', DRAW_THEN_KEYS);
    await settle(page);
    const shownIdle = (await tip(page).count()) === 1;
    await run(page, 'sim.run.run');
    await runningNow(page);
    const gone = await until(page, () => document.querySelector('[data-e68-arrange-tip]') === null, null, 5_000);
    await sleep(500);
    const stillGone = (await tip(page).count()) === 0;
    check(
      `${p} not while a program runs or waits for input`,
      shownIdle && gone && stillGone,
      JSON.stringify({ shownIdle, gone, stillGone, phase: await phase(page) }),
    );
    await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());
    check(
      `${p} it comes back when the program stops`,
      await until(page, () => document.querySelector('[data-e68-arrange-tip] p') !== null, null, 10_000),
      String(await phase(page)),
    );
  } else {
    note('engine/dist is missing: the tip was not checked while a program runs');
  }
  // A button of it that had the focus gives the focus back; Got it keeps the lock.
  await page.locator('.e68-shell__toolbar button[data-command="sim.file.open"]').focus();
  await tip(page).getByRole('button', { name: 'Got it' }).focus();
  await page.keyboard.press('Enter');
  await settle(page);
  const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-command'));
  check(`${p} Got it closes it`, (await tip(page).count()) === 0);
  check(`${p} the focus went back to where it was`, focusBack === 'sim.file.open', String(focusBack));
  check(
    `${p} Got it is remembered for the profile and keeps the lock`,
    (await page.evaluate(() => window.__arrange.answered())) && (await locked(page)),
  );
  check(
    `${p} the second window's tip went away with it`,
    await until(second.page, () => document.querySelector('[data-e68-arrange-tip]') === null, null, 10_000),
  );
  finish(`${p} tip, second window`, second.errors);
  await page.reload({ timeout: LOAD_TIMEOUT });
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await setMode(page, 'simulator');
  await settle(page);
  await sleep(400);
  const third = await openApp(context, '?arrange-tip=1');
  await setMode(third.page, 'simulator');
  await settle(third.page);
  await sleep(400);
  check(
    `${p} it never comes again: not after a reload, not in a window opened later`,
    (await tip(page).count()) === 0 && (await tip(third.page).count()) === 0,
  );
  finish(`${p} tip, third window`, third.errors);
  finish(`${p} tip`, errors);
  await closeWithin(context);

  // Arrange Panels unlocks the layout and closes it for good.
  const other = await newContext(browser);
  const fresh = await openApp(other, '?arrange-tip=1');
  await setMode(fresh.page, 'simulator');
  await until(fresh.page, () => document.querySelector('[data-e68-arrange-tip] p') !== null, null, 10_000);
  await tip(fresh.page).getByRole('button', { name: 'Arrange Panels' }).click();
  await settle(fresh.page);
  check(
    `${p} Arrange Panels unlocks the layout, closes the tip and is remembered`,
    !(await locked(fresh.page)) &&
      (await tip(fresh.page).count()) === 0 &&
      (await fresh.page.evaluate(() => window.__arrange.answered())) &&
      (await arrangeButton(fresh.page).getAttribute('aria-pressed')) === 'true',
  );
  finish(`${p} tip (Arrange Panels)`, fresh.errors);
  await closeWithin(other);
}

// --- pass: layouts ----------------------------------------------------------------------------

async function showAllTools(page) {
  await page.evaluate((tools) => {
    for (const id of tools) window.__arrange.panels.showPanel(window.__arrange.ctx, id, { focus: false });
  }, TOOLS);
  await settle(page);
}

/** Every shown panel of the Simulator: its box, whether it floats; the dock's and the bars' boxes. */
function measure(page) {
  return page.evaluate((panels) => {
    const box = (element) => {
      const r = element?.getBoundingClientRect();
      return r
        ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
        : null;
    };
    const dock = document.querySelector('[data-e68-dock="simulator"]');
    const out = {};
    const tabs = {};
    for (const id of panels) {
      const element = dock?.querySelector(`[data-e68-panel="${id}"]`);
      if (!element || element.getClientRects().length === 0) {
        // A panel behind another tab of its group is reached by its tab.
        const tab = document.getElementById(`flexlayout-tabbutton-simulator:${id}`);
        if (tab && tab.getClientRects().length > 0) tabs[id] = box(tab);
        continue;
      }
      const floatWindow = element.closest('[data-e68-float]');
      let widest = 0;
      for (const child of element.querySelectorAll('*')) widest = Math.max(widest, child.scrollWidth);
      out[id] = {
        box: box(element),
        floating: floatWindow !== null,
        window: floatWindow ? box(floatWindow) : null,
        widest,
      };
    }
    return {
      panels: out,
      tabs,
      dock: box(dock),
      toolbar: box(document.querySelector('.e68-shell__toolbar')),
      status: box(document.querySelector('.e68-statusbar')),
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      },
    };
  }, SIM_PANELS);
}

/**
 * Floating Tools chosen in the same moment as the switch from the Editor to the Simulator (the
 * Simulator's dock not laid out yet): the windows cascade from the Simulator dock's top right, not
 * from a size of before (verify round 1: x 816 instead of 982 at 1366 px, a fallback size).
 */
async function sameMomentCheck(browser, name) {
  const context = await newContext(browser, SIZES[0]);
  const { page, errors } = await openApp(context);
  const constants = await page.evaluate(async () => {
    const { FLOATING_TOOLS_ORDER, TOOL_WINDOW_SIZES } = await import('/src/features/layout/arrangements.ts');
    return { order: FLOATING_TOOLS_ORDER, sizes: TOOL_WINDOW_SIZES };
  });
  check(
    `${name}: the check's Floating Tools order and sizes are the application's`,
    same(constants.order, FLOATING_ORDER) && FLOATING_ORDER.every((id) => same(constants.sizes[id], WINDOW_SIZES[id])),
    JSON.stringify(constants),
  );
  const result = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    const switched = ctx.commands.run('app.mode.set', 'simulator');
    const arranged = ctx.commands.run('sim.view.layout.floatingTools');
    await switched;
    await arranged;
    const box = document.querySelector('[data-e68-dock="simulator"]').getBoundingClientRect();
    return { dock: Math.round(box.width), windows: window.__arrange.dock().floating() };
  });
  const first = result.windows[0];
  check(
    `${name}: Floating Tools chosen as the window switches to the Simulator places its first window in the Simulator dock's top right corner (P9.8 point 1)`,
    first !== undefined &&
      first.panel === FLOATING_ORDER[0] &&
      Math.abs(first.rect.x + first.rect.width - result.dock) <= 1 &&
      first.rect.y === 0,
    JSON.stringify({ dock: result.dock, first }),
  );
  await run(page, 'sim.view.layout.classic');
  finish(`${name}: layouts at the switch`, errors);
  await closeWithin(context);
}

async function layoutsPass(browser, name) {
  const p = `${name}:`;
  await sameMomentCheck(browser, name);
  for (const size of SIZES) {
    const context = await newContext(browser, size);
    const { page, errors } = await openApp(context);
    await setMode(page, 'simulator');
    await settle(page);
    await showAllTools(page);
    for (const theme of ['light', 'dark']) {
      await run(page, 'app.theme.set', theme);
      await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
      for (const lockedState of theme === 'light' ? [true, false] : [true]) {
        await page.evaluate((on) => window.__arrange.dock().setLocked(on), lockedState);
        await settle(page);
        for (const arrangement of ARRANGEMENTS) {
          const label = `${p} ${size.width}x${size.height} ${theme}${lockedState ? '' : ' unlocked'} ${arrangement.caption}`;
          const panelsBefore = await panelsSetting(page);
          await run(page, arrangement.command);
          await settle(page);
          await settle(page);
          const shape = await page.evaluate(() => window.__arrange.shape());
          const floating = await page.evaluate(() =>
            window.__arrange
              .dock()
              .floating()
              .map((window) => window.panel),
          );
          const expectedFloating = arrangement.id === 'floatingTools' ? FLOATING_ORDER : [];
          check(
            `${label}: the arrangement of P9.4`,
            shape === SHAPES[arrangement.id] && same(floating, expectedFloating),
            `${shape} floating ${JSON.stringify(floating)}`,
          );
          check(
            `${label}: no panel shown or hidden, the lock kept`,
            (await panelsSetting(page)) === panelsBefore && (await locked(page)) === lockedState,
          );
          const m = await measure(page);
          const shown = Object.keys(m.panels);
          const problems = [];
          if (m.scroll.width > m.scroll.innerWidth || m.scroll.height > m.scroll.innerHeight) {
            problems.push(`page scrolls ${JSON.stringify(m.scroll)}`);
          }
          const inside = (b) =>
            b.x >= m.dock.x - 1 &&
            b.y >= m.dock.y - 1 &&
            b.x + b.w <= m.dock.x + m.dock.w + 1 &&
            b.y + b.h <= m.dock.y + m.dock.h + 1;
          for (const id of SIM_PANELS) {
            if (shown.includes(id)) continue;
            if (!m.tabs[id]) problems.push(`${id} is neither on the screen nor reachable by its tab`);
            else if (!inside(m.tabs[id])) problems.push(`the tab of ${id} leaves the dock`);
          }
          for (const [id, entry] of Object.entries(m.panels)) {
            const b = entry.window ?? entry.box;
            if (!inside(b)) problems.push(`${id} leaves the dock ${JSON.stringify(b)} dock ${JSON.stringify(m.dock)}`);
            if (b.y < m.toolbar.y + m.toolbar.h) problems.push(`${id} covers the toolbar`);
            // The Messages panel's least height is its splitter's (SPLITS 'sim.messages': 40 px).
            const least = id === 'messages' ? { w: 160, h: 40 } : { w: 160, h: 96 };
            if (entry.box.w < least.w || entry.box.h < least.h)
              problems.push(`${id} is ${entry.box.w} x ${entry.box.h}`);
          }
          // The Registers panel is shown whole wherever it is docked (the original's main window).
          const registers = m.panels.registers;
          if (registers && registers.widest > registers.box.w + 1) {
            problems.push(`the Registers panel is cut: ${registers.widest} > ${registers.box.w}`);
          }
          const hardware = m.panels.hardware;
          if (hardware && !hardware.floating && hardware.widest > hardware.box.w + 1 && size.width >= 1366) {
            note(`${label}: the Hardware panel scrolls inside itself (${hardware.widest} px in ${hardware.box.w} px)`);
          }
          if (arrangement.id === 'floatingTools') {
            // Each window where the rule of P9.8 point 1 puts it (arrangements.ts floatingToolsLayout,
            // every tool panel shown), at its default size where the room allows.
            const expected = await page.evaluate(
              async (area) => {
                const { floatingToolsLayout } = await import('/src/features/layout/arrangements.ts');
                return floatingToolsLayout(area);
              },
              { width: m.dock.w, height: m.dock.h },
            );
            for (const { panel: id, rect } of expected.windows) {
              const w = m.panels[id]?.window;
              if (!w) problems.push(`${id} does not float`);
              else if (
                Math.abs(w.x - (m.dock.x + rect.x)) > 1 ||
                Math.abs(w.y - (m.dock.y + rect.y)) > 1 ||
                Math.abs(w.w - rect.width) > 1 ||
                Math.abs(w.h - rect.height) > 1
              ) {
                problems.push(
                  `the window of ${id} is not at its place: ${JSON.stringify(w)}, rule ${JSON.stringify(rect)}`,
                );
              }
            }
            // Where the dock is tall enough for the Hardware window (1920 by 1080), nothing of the
            // Hardware panel scrolls; at 1366 by 768 its window is as wide as the room right of the
            // Output's 400 px, and its displays, lamps and switches are checked in the pass uncovered.
            if (size.width >= 1920) {
              const scrolls = await page.evaluate(() => {
                const panel = document.querySelector('[data-e68-dock="simulator"] [data-e68-panel="hardware"]');
                return Array.from([panel, ...panel.querySelectorAll('*')])
                  .filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)
                  .filter(
                    (e) => getComputedStyle(e).overflowY !== 'visible' || getComputedStyle(e).overflowX !== 'visible',
                  )
                  .map(
                    (e) =>
                      `${e.className || e.tagName} ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight}`,
                  );
              });
              if (scrolls.length > 0) problems.push(`the floating Hardware panel scrolls: ${scrolls.join(', ')}`);
            }
          }
          check(
            `${label}: every shown panel usable, inside the window, no page scroll`,
            problems.length === 0,
            problems.join('; '),
          );
          if (lockedState) {
            const file = `${name}-${size.width}x${size.height}-${theme}-${arrangement.id}.png`;
            await page.screenshot({ path: join(outDir, 'shots', file) });
            measured.push({
              browser: name,
              size: `${size.width}x${size.height}`,
              theme,
              arrangement: arrangement.id,
              panels: m.panels,
              dock: m.dock,
            });
          }
        }
      }
    }
    await run(page, 'app.theme.set', 'light');
    await run(page, 'sim.view.layout.classic');
    await settle(page);
    finish(`${p} layouts ${size.width}x${size.height}`, errors);
    await closeWithin(context);
  }
}

// --- pass: uncovered (P9.8 points 1 and 5) ---------------------------------------------------

/**
 * What a person sees of the Output picture, the Hardware panel's displays, lamps, switches and push
 * buttons, and of each floating window, measured as the reviewer did: elementFromPoint on a grid of
 * points every 4 px over each region. `canvas`: the share of the picture's points that hit the
 * picture, and how many px of it from its left edge are uncovered in every row; `devices`: the
 * share of the points of the four device blocks that hit the Hardware panel; `overlaps`: each pair
 * of shown floating windows whose boxes overlap, with the area.
 */
function uncovered(page) {
  return page.evaluate(() => {
    const dock = document.querySelector('[data-e68-dock="simulator"]');
    const grid = (box, hits) => {
      let seen = 0;
      let total = 0;
      const columns = [];
      for (let x = 2; x < box.width; x += 4) {
        let column = true;
        for (let y = 2; y < box.height; y += 4) {
          total++;
          const px = box.left + x;
          const py = box.top + y;
          const inside = px >= 0 && py >= 0 && px < window.innerWidth && py < window.innerHeight;
          if (inside && hits(document.elementFromPoint(px, py))) seen++;
          else column = false;
        }
        columns.push(column);
      }
      let left = 0;
      for (const column of columns) {
        if (!column) break;
        left += 4;
      }
      return { share: total ? Math.round((1000 * seen) / total) / 10 : 0, left: Math.min(left, Math.round(box.width)) };
    };
    const canvas = dock.querySelector('[data-e68-panel="output"] canvas');
    const hardware = dock.querySelector('[data-e68-panel="hardware"]');
    // The four device blocks: the 7-segment display, the lamps, the switches, the push buttons (each
    // is followed by its address field, which is not one of them).
    const deviceBlocks = hardware
      ? Array.from(hardware.querySelectorAll('.e68-hw__devices > .e68-hw__device')).filter(
          (element) => element.getClientRects().length > 0,
        )
      : [];
    let devicesSeen = 0;
    let devicesTotal = 0;
    for (const block of deviceBlocks) {
      const r = grid(block.getBoundingClientRect(), (hit) => hit !== null && hardware.contains(hit));
      const box = block.getBoundingClientRect();
      const n = Math.ceil((box.width - 2) / 4) * Math.ceil((box.height - 2) / 4);
      devicesSeen += (r.share / 100) * n;
      devicesTotal += n;
    }
    const windows = Array.from(dock.querySelectorAll('.flexlayout__tab[data-e68-float]')).map((element) => {
      const r = element.getBoundingClientRect();
      return { panel: element.getAttribute('data-e68-float'), x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const overlaps = [];
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const a = windows[i];
        const b = windows[j];
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (w > 0.5 && h > 0.5) overlaps.push(`${a.panel}/${b.panel} ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    const canvasBox = canvas?.getBoundingClientRect();
    // What each docked panel keeps visible (the share of its region's points that hit itself), and
    // the share of its points that lie under a floating window (P9.10 point 2).
    const docked = {};
    const underWindow = {};
    for (const region of Array.from(dock.querySelectorAll('[data-e68-panel]'))) {
      if (region.closest('.flexlayout__tab[data-e68-float]') || !region.checkVisibility()) continue;
      const box = region.getBoundingClientRect();
      const id = region.getAttribute('data-e68-panel');
      docked[id] = grid(box, (hit) => hit !== null && region.contains(hit)).share;
      underWindow[id] = grid(
        box,
        (hit) => hit !== null && hit.closest('.flexlayout__tab[data-e68-float]') !== null,
      ).share;
    }
    // The Hardware window's content: its width and the width it needs (P9.9 point 5).
    const hwScroll = dock.querySelector('.flexlayout__tab[data-e68-float="hardware"] .e68-hw-scroll');
    return {
      docked,
      underWindow,
      hardwareContent: hwScroll ? [hwScroll.clientWidth, hwScroll.scrollWidth] : null,
      canvas: canvas ? grid(canvasBox, (hit) => hit === canvas) : null,
      canvasSize: canvasBox ? [Math.round(canvasBox.width), Math.round(canvasBox.height)] : null,
      devices: devicesTotal ? Math.round((1000 * devicesSeen) / devicesTotal) / 10 : null,
      deviceBlocks: deviceBlocks.length,
      windows: windows.map(
        (w) => `${w.panel} ${Math.round(w.x)},${Math.round(w.y)} ${Math.round(w.w)}x${Math.round(w.h)}`,
      ),
      overlaps,
    };
  });
}

/** Shows the tool panels of `shown` and hides the others. */
async function setShown(page, shown) {
  await page.evaluate(
    ([tools, list]) => {
      for (const id of tools) {
        if (list.includes(id)) window.__arrange.panels.showPanel(window.__arrange.ctx, id, { focus: false });
        else window.__arrange.panels.hidePanel(window.__arrange.ctx, id);
      }
    },
    [TOOLS, shown],
  );
  await settle(page);
}

async function uncoveredPass(browser, name) {
  const p = `${name}:`;
  for (const size of SIZES) {
    const context = await newContext(browser, size);
    const { page, errors } = await openApp(context);
    await setMode(page, 'simulator');
    await settle(page);
    if (enginesPresent) {
      await loadProgram(page, 'uncovered', DRAW_THEN_KEYS);
      await run(page, 'sim.run.run');
      await runningNow(page);
    } else {
      note('engine/dist is missing: the Output picture is empty in the screenshots of the pass uncovered');
    }
    const at = `${size.width}x${size.height}`;
    for (const theme of ['light', 'dark']) {
      await run(page, 'app.theme.set', theme);
      await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
      // Hardware and Memory shown (the reviewer's case, P9.8 point 1).
      await setShown(page, ['hardware', 'memory']);
      await run(page, 'sim.view.layout.floatingTools');
      await settle(page);
      await settle(page);
      const two = await uncovered(page);
      await page.screenshot({
        path: join(outDir, 'shots', `${name}-${at}-${theme}-floating-tools-hardware-memory.png`),
      });
      const label = `${p} ${at} ${theme} Floating Tools, Hardware and Memory shown`;
      if (size.width >= 1920) {
        check(
          `${label}: neither window covers the other`,
          two.windows.length === 2 && two.overlaps.length === 0,
          JSON.stringify({ windows: two.windows, overlaps: two.overlaps }),
        );
      } else {
        // At 1366 by 768 the Memory window has no free place right of the Output's 400 px: it is
        // cascaded over the Hardware window's column, below its displays (P9.8 point 1).
        check(`${label}: both windows float`, two.windows.length === 2, JSON.stringify(two.windows));
        note(`${label}: windows ${two.windows.join('; ')}; overlaps ${two.overlaps.join('; ') || 'none'}`);
      }
      // P9.9 point 5 from a dock of 1,403 px on (P9.10 point 1): the Hardware window's content, its
      // width against the width it needs.
      note(
        `${label}: the Hardware window's content ${two.hardwareContent?.[0]} px wide, it needs ${two.hardwareContent?.[1]} px; docked panels seen ${JSON.stringify(two.docked)}`,
      );
      if (size.width >= 1403) {
        check(
          `${label}: from a dock of 1,403 px on, the Hardware window holds its whole content (P9.9 point 5, P9.10 point 1)`,
          two.hardwareContent !== null && two.hardwareContent[1] <= two.hardwareContent[0],
          JSON.stringify(two.hardwareContent),
        );
      } else {
        // In a narrower dock the window takes the width left beside the registers and the left 400 px
        // of the picture, and its panel scrolls inside itself (P9.10 point 1).
        const hw = await page.evaluate(() => {
          const dockBox = document.querySelector('[data-e68-dock="simulator"]').getBoundingClientRect();
          const w = document.querySelector('.flexlayout__tab[data-e68-float="hardware"]').getBoundingClientRect();
          return { x: Math.round(w.left - dockBox.left), width: Math.round(w.width), dock: Math.round(dockBox.width) };
        });
        check(
          `${label}: in a dock narrower than 1,403 px the Hardware window takes the width left beside the registers and the left 400 px of the picture (P9.10 point 1)`,
          hw.x + hw.width === hw.dock &&
            hw.width === hw.dock - FLOATING_LEFT - FLOATING_OUTPUT_PART &&
            (two.canvas?.left ?? 0) >= 400 &&
            two.hardwareContent !== null &&
            two.hardwareContent[1] > two.hardwareContent[0],
          JSON.stringify({ hw, canvas: two.canvas, content: two.hardwareContent }),
        );
      }
      check(
        `${label}: the Hardware panel's displays, lamps, switches and push buttons are uncovered`,
        two.deviceBlocks === 4 && two.devices === 100,
        JSON.stringify({ devices: two.devices, blocks: two.deviceBlocks }),
      );
      if (size.width >= 1920) {
        check(
          `${label}: the whole Output picture at 100 % (640 by 480) is uncovered`,
          two.canvas?.share === 100 && two.canvasSize?.[0] === 640 && two.canvasSize?.[1] === 480,
          JSON.stringify({ canvas: two.canvas, size: two.canvasSize }),
        );
      } else {
        check(
          `${label}: at least the left 400 px of the Output picture are uncovered`,
          (two.canvas?.left ?? 0) >= 400,
          JSON.stringify({ canvas: two.canvas, size: two.canvasSize }),
        );
      }
      // All five tool panels shown: say exactly what overlaps what.
      await setShown(page, TOOLS);
      await run(page, 'sim.view.layout.floatingTools');
      await settle(page);
      await settle(page);
      const five = await uncovered(page);
      await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-${theme}-floating-tools-all-five.png`) });
      const rule = await page.evaluate(
        async (area) => {
          const { floatingToolsLayout } = await import('/src/features/layout/arrangements.ts');
          return floatingToolsLayout(area).windows.map((w) => [w.panel, w.overlaps]);
        },
        await page.evaluate(() => {
          const r = document.querySelector('[data-e68-dock="simulator"]').getBoundingClientRect();
          return { width: r.width, height: r.height };
        }),
      );
      const freeOnes = rule.filter(([, overlapping]) => !overlapping).map(([panel]) => panel);
      const freeOverlaps = five.overlaps.filter((pair) => {
        const [a, b] = pair.split(' ')[0].split('/');
        return freeOnes.includes(a) && freeOnes.includes(b);
      });
      check(
        `${p} ${at} ${theme} Floating Tools, all five shown: the windows placed without overlap do not overlap; the Hardware displays uncovered`,
        five.windows.length === 5 && freeOverlaps.length === 0 && five.devices === 100,
        JSON.stringify({ free: freeOnes, overlaps: five.overlaps, devices: five.devices }),
      );
      if (size.width >= 1920) {
        // P9.9 point 2: further columns at the left before any overlap; at 1920 by 1080 none.
        check(
          `${p} ${at} ${theme} Floating Tools, all five shown: no floating window covers another (P9.9 point 2)`,
          five.windows.length === 5 && five.overlaps.length === 0 && freeOnes.length === 5,
          JSON.stringify({ windows: five.windows, overlaps: five.overlaps }),
        );
      }
      // P9.10 point 2: further columns never lie over the left column, at either size.
      const leftColumn = ['registers', 'listing', 'messages'];
      check(
        `${p} ${at} ${theme} Floating Tools, all five shown: registers, listing and message area are uncovered: no point of them under a floating window (P9.10 point 2)`,
        leftColumn.every((id) => five.underWindow[id] === 0),
        JSON.stringify({ underWindow: five.underWindow, seen: five.docked }),
      );
      note(
        `${p} ${at} ${theme} Floating Tools, all five shown: windows ${five.windows.join('; ')}; placed without overlap ${freeOnes.join(', ')}; overlaps ${five.overlaps.join('; ') || 'none'}; Output picture ${five.canvas?.share}% uncovered, left ${five.canvas?.left} px; docked panels seen ${JSON.stringify(five.docked)}; under a floating window ${JSON.stringify(five.underWindow)}`,
      );
      // Output and Hardware Side by Side (P9.8 point 5): the Output column shows the whole picture.
      await setShown(page, ['hardware', 'memory']);
      await run(page, 'sim.view.layout.sideBySide');
      await settle(page);
      await settle(page);
      const side = await uncovered(page);
      const widths = await page.evaluate(() => {
        const w = (id) =>
          Math.round(
            document.querySelector(`[data-e68-dock="simulator"] [data-e68-panel="${id}"]`)?.getBoundingClientRect()
              .width ?? 0,
          );
        return { output: w('output'), hardware: w('hardware') };
      });
      await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-${theme}-side-by-side.png`) });
      check(
        `${p} ${at} ${theme} Side by Side: the Output column is at least 648 px and its whole picture is seen`,
        widths.output >= 648 && side.canvas?.share === 100,
        JSON.stringify({ widths, canvas: side.canvas }),
      );
      // P9.10 point 1 (the guide's sentence): on a small screen Side by Side shows registers,
      // listing, output and hardware at once, here with the Memory panel shown as well.
      const together = ['registers', 'listing', 'output', 'hardware', 'memory'];
      check(
        `${p} ${at} ${theme} Side by Side with Hardware and Memory shown: registers, listing, output and hardware are seen at once, and the Memory panel (P9.10 point 1)`,
        together.every((id) => (side.docked[id] ?? 0) >= 95),
        JSON.stringify({ seen: side.docked, devices: side.devices }),
      );
      note(
        `${p} ${at} ${theme} Side by Side, Hardware and Memory shown: docked panels seen ${JSON.stringify(side.docked)}; widths ${JSON.stringify(widths)}; Hardware devices ${side.devices}%; picture ${side.canvas?.share}%`,
      );
      await run(page, 'sim.view.layout.classic');
      await settle(page);
    }
    await run(page, 'app.theme.set', 'light');
    if (enginesPresent) await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());
    finish(`${p} uncovered ${at}`, errors);
    await closeWithin(context);
  }
}

// --- pass: room (P9.9 point 4, P9.10 point 3) ---------------------------------------------------

/** The docked panels' boxes, the room the dock keeps now and the floating windows. */
const roomState = (page) =>
  page.evaluate(() => {
    const dock = document.querySelector('[data-e68-dock="simulator"]');
    const d = dock.getBoundingClientRect();
    const boxes = {};
    for (const region of Array.from(dock.querySelectorAll('[data-e68-panel]'))) {
      if (region.closest('.flexlayout__tab[data-e68-float]') || !region.checkVisibility()) continue;
      const b = region.getBoundingClientRect();
      boxes[region.getAttribute('data-e68-panel')] = [b.x - d.x, b.y - d.y, b.width, b.height].map(Math.round);
    }
    const windows = {};
    for (const window of Array.from(dock.querySelectorAll('.flexlayout__tab[data-e68-float]'))) {
      const b = window.getBoundingClientRect();
      windows[window.getAttribute('data-e68-float')] = [b.x - d.x, b.y - d.y, b.width, b.height].map(Math.round);
    }
    // The docked panels' right edge: where the room begins (the dock's width with no room).
    const right = Math.max(...Object.values(boxes).map(([x, , w]) => x + w));
    return {
      room: Number(dock.getAttribute('data-e68-reserve') ?? 0),
      dockWidth: Math.round(d.width),
      dockHeight: Math.round(d.height),
      right,
      boxes,
      windows,
    };
  });

/** Drags a floating window by its title by (dx, dy); `during` runs before the button is let go. */
async function dragTitle(page, panel, dx, dy, during) {
  const t = await page.locator(`[data-e68-float-title="${panel}"]`).boundingBox();
  const from = { x: t.x + Math.min(40, t.width / 2), y: t.y + t.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await settle(page);
  const result = during ? await during() : null;
  await page.mouse.up();
  await settle(page);
  return result;
}

/**
 * P9.9 point 4: the room kept for the windows of Floating Tools shrinks to the columns that still
 * hold a shown window when a move, a size, Dock or Close ends; nothing moves while a window is being
 * dragged; a reload keeps it; Reset Layout and every other layout clear it. Screenshots before and
 * after in <out>/shots.
 */
async function roomPass(browser, name) {
  for (const size of SIZES) {
    const at = `${size.width}x${size.height}`;
    const p = `${name}: room ${at}`;
    const context = await newContext(browser, size);
    const { page, errors } = await openApp(context);
    await setMode(page, 'simulator');
    await settle(page);
    await setShown(page, ['hardware', 'memory']);
    await run(page, 'sim.view.layout.floatingTools');
    await settle(page);
    await settle(page);
    const start = await roomState(page);
    await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-room-0-floating-tools.png`) });
    check(
      `${p}: Floating Tools keeps the room of its windows: the docked panels end where the windows begin`,
      start.room > 0 && Math.abs(start.right - (start.dockWidth - start.room)) <= 1,
      JSON.stringify(start),
    );
    // Memory dragged out of the room to the left (down-left over the docked panels): while the
    // pointer is down nothing of the docked panels moves; when it is let go the room shrinks to the
    // Hardware window's column (at 1366 the Hardware window is the room: it stays).
    const memory = start.windows.memory;
    const during = await dragTitle(page, 'memory', -(memory[0] - 40), 0, () => roomState(page));
    check(
      `${p}: while the Memory window is being dragged, the docked panels do not move`,
      JSON.stringify(during.boxes) === JSON.stringify(start.boxes) && during.room === start.room,
      JSON.stringify({ during: during.boxes, start: start.boxes, room: [during.room, start.room] }),
    );
    const afterMemory = await roomState(page);
    const hardware = afterMemory.windows.hardware;
    await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-room-1-memory-moved.png`) });
    check(
      `${p}: Memory moved out, the room shrinks to the column that still holds a window (Hardware's)`,
      afterMemory.room === start.dockWidth - hardware[0] && Math.abs(afterMemory.right - hardware[0]) <= 1,
      JSON.stringify({ room: afterMemory.room, right: afterMemory.right, hardware }),
    );
    // A reload keeps what was there.
    await page.reload({ timeout: LOAD_TIMEOUT });
    await installHooks(page);
    await setMode(page, 'simulator');
    await settle(page);
    await settle(page);
    const reloaded = await roomState(page);
    check(
      `${p}: a reload keeps the room, the windows and the docked panels`,
      reloaded.room === afterMemory.room &&
        JSON.stringify(reloaded.windows) === JSON.stringify(afterMemory.windows) &&
        JSON.stringify(reloaded.boxes) === JSON.stringify(afterMemory.boxes),
      JSON.stringify({ reloaded, afterMemory }),
    );
    // The Hardware window dragged down and to the left (the review's case): no window lies in the
    // room any more, and no empty strip is left: the docked panels take the whole dock.
    await dragTitle(page, 'hardware', -(hardware[0] - 300), 40);
    const afterHardware = await roomState(page);
    await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-room-2-hardware-moved.png`) });
    check(
      `${p}: Hardware moved out as well, the room is given back: the docked panels take the whole dock`,
      afterHardware.room === 0 && Math.abs(afterHardware.right - afterHardware.dockWidth) <= 1,
      JSON.stringify({ room: afterHardware.room, right: afterHardware.right, windows: afterHardware.windows }),
    );
    // Moved back to the right edge, it lies in the room again (the room never grows past the
    // arrangement's), and its x hides it: the room goes with it.
    const moved = afterHardware.windows.hardware;
    await dragTitle(page, 'hardware', afterHardware.dockWidth - (moved[0] + moved[2]), -40);
    const back = await roomState(page);
    check(
      `${p}: moved back to the right edge, the room comes back for its column, never wider than the arrangement's`,
      back.room > 0 && back.room <= start.room && Math.abs(back.right - (back.dockWidth - back.room)) <= 1,
      JSON.stringify({ room: back.room, right: back.right, windows: back.windows }),
    );
    await page
      .locator('.flexlayout__tab[data-e68-float="hardware"]')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await settle(page);
    const closed = await roomState(page);
    check(
      `${p}: its x (Close) hides it, and the room is given back`,
      closed.room === 0 && Math.abs(closed.right - closed.dockWidth) <= 1,
      JSON.stringify({ room: closed.room, right: closed.right }),
    );
    // Every other layout and Reset Layout clear it; Floating Tools again keeps it.
    await setShown(page, ['hardware', 'memory']);
    for (const [command, kept] of [
      ['sim.view.layout.floatingTools', true],
      ['sim.view.layout.wideOutput', false],
      ['sim.view.layout.floatingTools', true],
      ['sim.view.layout.sideBySide', false],
      ['sim.view.layout.floatingTools', true],
      ['sim.view.layout.classic', false],
      ['sim.view.layout.floatingTools', true],
      ['app.layout.reset', false],
    ]) {
      await run(page, command);
      await settle(page);
      await settle(page);
      const now = await roomState(page);
      const stored = await page.evaluate(
        () => window.__easy68k.ctx.settings.get().app.layout.dock?.floating?.simulator?.reserve ?? 0,
      );
      check(
        `${p}: ${command} ${kept ? 'keeps a room for its windows' : 'clears the room'}`,
        kept ? now.room > 0 && stored > 0 : now.room === 0 && stored === 0 && Math.abs(now.right - now.dockWidth) <= 1,
        JSON.stringify({ room: now.room, stored, right: now.right }),
      );
    }
    // P9.10 point 3, the review's case, in both themes: Floating Tools with Hardware and Memory, the
    // Hardware window dragged left by 400 px (and down by 80). The windows left in the room (Memory)
    // then fill less than half of its height at 1920 x 1080: the room is given back when the drag
    // ends, nothing moves while the button is down, a reload keeps it; dragged back, the windows in
    // the room fill half of its height again and the room comes back. At 1366 x 768 the Memory window
    // alone fills more than half of the dock's height (356 of 681 px): the room is kept for it.
    for (const theme of ['light', 'dark']) {
      await run(page, 'app.theme.set', theme);
      await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
      await run(page, 'sim.view.layout.floatingTools');
      await settle(page);
      await settle(page);
      const begin = await roomState(page);
      await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-${theme}-room-3-review-start.png`) });
      const fill = (state) => {
        const start = state.dockWidth - begin.room;
        const rows = Object.values(state.windows)
          .filter(([x]) => x >= start)
          .map(([, y, , h]) => [Math.max(0, y), Math.min(state.dockHeight, y + h)])
          .sort((a, b) => a[0] - b[0]);
        let covered = 0;
        let end = 0;
        for (const [top, bottom] of rows) {
          if (bottom <= end) continue;
          covered += bottom - Math.max(top, end);
          end = bottom;
        }
        return covered;
      };
      const whileHeld = await dragTitle(page, 'hardware', -400, 80, () => roomState(page));
      check(
        `${p} ${theme}: the review's case: while the Hardware window is being dragged left, nothing docked moves`,
        JSON.stringify(whileHeld.boxes) === JSON.stringify(begin.boxes) && whileHeld.room === begin.room,
        JSON.stringify({ during: whileHeld.boxes, start: begin.boxes, room: [whileHeld.room, begin.room] }),
      );
      const dragged = await roomState(page);
      await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-${theme}-room-4-review-dragged.png`) });
      const left = fill(dragged);
      const half = 2 * left >= dragged.dockHeight;
      check(
        `${p} ${theme}: the review's case: the windows left in the room fill ${left} of ${dragged.dockHeight} px; ${half ? 'at least half: the room is kept for them' : 'less than half: the room is given back and the docked panels take the whole dock'} (P9.10 point 3)`,
        half
          ? dragged.room > 0 && Math.abs(dragged.right - (dragged.dockWidth - dragged.room)) <= 1
          : dragged.room === 0 && Math.abs(dragged.right - dragged.dockWidth) <= 1,
        JSON.stringify({ room: dragged.room, right: dragged.right, windows: dragged.windows, left }),
      );
      if (size.width >= 1920) {
        check(
          `${p} ${theme}: the review's case at 1920 x 1080: the room is given back (no empty block beside the Output panel)`,
          dragged.room === 0 && !half,
          JSON.stringify({ room: dragged.room, left }),
        );
      }
      note(
        `${p} ${theme}: the review's case: before room ${begin.room}, docked right edge ${begin.right}, windows ${JSON.stringify(begin.windows)}; after the drag room ${dragged.room}, docked right edge ${dragged.right}, windows ${JSON.stringify(dragged.windows)}, the room's windows fill ${left} of ${dragged.dockHeight} px`,
      );
      await page.reload({ timeout: LOAD_TIMEOUT });
      await installHooks(page);
      await setMode(page, 'simulator');
      await settle(page);
      await settle(page);
      const again = await roomState(page);
      check(
        `${p} ${theme}: the review's case: a reload keeps the room, the windows and the docked panels`,
        again.room === dragged.room &&
          JSON.stringify(again.windows) === JSON.stringify(dragged.windows) &&
          JSON.stringify(again.boxes) === JSON.stringify(dragged.boxes),
        JSON.stringify({ again, dragged }),
      );
      // Dragged back (by the same 400 px right and 80 px up): Hardware and Memory lie in the room
      // again and fill more than half of its height: the room comes back by the same rule.
      await dragTitle(page, 'hardware', 400, -80);
      const back = await roomState(page);
      await page.screenshot({ path: join(outDir, 'shots', `${name}-${at}-${theme}-room-5-review-back.png`) });
      check(
        `${p} ${theme}: the review's case: dragged back, the windows in the room fill ${fill(back)} of ${back.dockHeight} px and the room comes back as it was`,
        back.room === begin.room &&
          2 * fill(back) >= back.dockHeight &&
          JSON.stringify(back.boxes) === JSON.stringify(begin.boxes),
        JSON.stringify({
          room: back.room,
          begin: begin.room,
          boxes: back.boxes,
          start: begin.boxes,
          windows: back.windows,
        }),
      );
    }
    await run(page, 'app.theme.set', 'light');
    finish(`${p}`, errors);
    await closeWithin(context);
  }
}

// --- pass: program ----------------------------------------------------------------------------

async function programPass(browser, name) {
  const p = `${name}:`;
  if (!enginesPresent) {
    note('engine/dist is missing: the program pass was skipped');
    return;
  }
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  await setMode(page, 'simulator');
  await settle(page);
  await showAllTools(page);
  await loadProgram(page, 'arrange-keys', DRAW_THEN_KEYS);
  await run(page, 'sim.run.run');
  await runningNow(page);
  const address = page.locator('[data-e68-dock="simulator"] [data-e68-panel="memory"] input[aria-label="Address"]');
  await run(page, 'sim.view.memory');
  await settle(page);
  await address.selectText();
  await page.keyboard.type('002000', { delay: 60 });
  await page.keyboard.press('Enter');
  await settle(page);
  await sleep(400);
  const snapshot = () =>
    page.evaluate(() => {
      const memory = document.querySelector('[data-e68-dock="simulator"] [data-e68-panel="memory"]');
      const canvas = document.querySelector('[data-e68-dock="simulator"] [data-e68-panel="output"] canvas');
      let picture;
      try {
        const url = canvas?.toDataURL() ?? 'none';
        let hash = 0;
        for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) | 0;
        picture = `${canvas?.width}x${canvas?.height}:${url.length}:${hash}`;
      } catch (error) {
        picture = String(error);
      }
      return {
        address: memory?.querySelector('input[aria-label="Address"]')?.value ?? null,
        picture,
        mounts: window.__arrange.dock().stats().mounts,
      };
    });
  const before = await snapshot();
  for (const arrangement of [...ARRANGEMENTS.slice(1), ARRANGEMENTS[0]]) {
    await run(page, arrangement.command);
    await settle(page);
    const now = await snapshot();
    const ph = await phase(page);
    check(
      `${p} while a program runs, ${arrangement.caption} keeps the program's state (phase, Output picture, Memory address, every panel's content)`,
      ['running', 'waitInput', 'waitDelay'].includes(ph) && same(now, before),
      JSON.stringify({ ph, before, now }),
    );
  }
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());
  // A hidden panel takes its place of the arrangement when it is shown.
  await page.evaluate(() => window.__arrange.panels.hidePanel(window.__arrange.ctx, 'hardware'));
  await settle(page);
  const panelsBefore = await panelsSetting(page);
  await run(page, 'sim.view.layout.sideBySide');
  await settle(page);
  const hiddenShape = await page.evaluate(() => window.__arrange.shape());
  check(
    `${p} Side by Side with Hardware hidden leaves it hidden`,
    (await panelsSetting(page)) === panelsBefore &&
      hiddenShape === 'row(column(registers, listing, memory+stack+breakpoints+log, messages), output)',
    hiddenShape,
  );
  await run(page, 'sim.view.hardware');
  await settle(page);
  const shownShape = await page.evaluate(() => window.__arrange.shape());
  check(`${p} shown again, Hardware is in its column right of Output`, shownShape === SHAPES.sideBySide, shownShape);
  await page.evaluate(() => window.__arrange.panels.hidePanel(window.__arrange.ctx, 'stack'));
  await run(page, 'sim.view.layout.floatingTools');
  await settle(page);
  const floatsHidden = await page.evaluate(() => window.__arrange.dock().floating());
  const stackEntry = floatsHidden.find((window) => window.panel === 'stack');
  check(
    `${p} Floating Tools with Stack hidden: Stack is a hidden floating window`,
    stackEntry !== undefined &&
      stackEntry.visible === false &&
      (await page.locator('[data-e68-dock="simulator"] [data-e68-panel="stack"]').isVisible()) === false,
    JSON.stringify(floatsHidden.map((window) => [window.panel, window.visible])),
  );
  await run(page, 'sim.view.stack');
  await settle(page);
  const stackFloating = await page.evaluate(() => {
    const element = document.querySelector('[data-e68-dock="simulator"] [data-e68-panel="stack"]');
    return element?.closest('[data-e68-float]') !== null && element.getClientRects().length > 0;
  });
  check(`${p} shown again, Stack floats where the arrangement put it`, stackFloating);
  await run(page, 'sim.view.layout.classic');
  await settle(page);
  check(
    `${p} Classic docks every panel again (Reset Layout)`,
    (await page.evaluate(() => window.__arrange.dock().floating().length)) === 0 &&
      (await page.evaluate(() => window.__arrange.shape())) === SHAPES.classic,
    await page.evaluate(() => window.__arrange.shape()),
  );
  finish(`${p} program`, errors);
  await closeWithin(context);
}

// --- pass: menus ------------------------------------------------------------------------------

async function menusPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  await setMode(page, 'simulator');
  await settle(page);
  await showAllTools(page);
  await page.locator('.e68-menubar [role=menuitem]', { hasText: 'View' }).click();
  const layouts = page.locator('[role=menu] [role=menuitem]', { hasText: 'Layouts' });
  await layouts.hover();
  await layouts.click().catch(() => {});
  const entries = page
    .locator('[role=menu] [role=menuitem]')
    .filter({ hasText: /^(Classic|Wide Output|Output and Hardware Side by Side|Floating Tools)/ });
  await until(page, () => document.querySelectorAll('[role=menu]').length >= 2, null, 5_000);
  const captions = await entries.allTextContents();
  check(
    `${p} View > Layouts lists the four entries in order`,
    same(
      captions.map((text) => text.trim()),
      ARRANGEMENTS.map((entry) => entry.caption),
    ),
    JSON.stringify(captions),
  );
  await page.locator('[role=menu] [role=menuitem]', { hasText: 'Wide Output' }).click();
  await settle(page);
  check(
    `${p} choosing Wide Output with the mouse arranges it`,
    (await page.evaluate(() => window.__arrange.shape())) === SHAPES.wideOutput,
  );
  // The access keys: Alt+V opens View, T the submenu, F Floating Tools.
  await page.locator('[data-e68-dock="simulator"] [data-e68-panel="registers"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+v');
  await until(page, () => document.querySelector('[role=menu]') !== null, null, 5_000);
  await page.keyboard.press('t');
  await until(page, () => document.querySelectorAll('[role=menu]').length >= 2, null, 5_000);
  await page.keyboard.press('f');
  await settle(page);
  const viaKeys = await page.evaluate(() => window.__arrange.dock().floating().length);
  check(`${p} Alt+V, T, F (the access keys) applies Floating Tools`, viaKeys === TOOLS.length, String(viaKeys));
  await run(page, 'sim.view.layout.classic');
  finish(`${p} menus`, errors);
  await closeWithin(context);
}

// --- pass: dialog -----------------------------------------------------------------------------

async function dialogPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  await setMode(page, 'simulator');
  await settle(page);
  await showAllTools(page);
  void run(page, 'app.layout.move', { panel: 'memory' });
  const dialog = page.getByRole('dialog', { name: 'Move Panel' });
  await dialog.waitFor({ timeout: 10_000 });
  const radio = dialog.getByRole('radio', { name: 'As a floating window' });
  check(`${p} Move Panel To... has the place "As a floating window"`, (await radio.count()) === 1);
  await radio.check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await settle(page);
  const result = await page.evaluate(() => ({
    floating: window.__arrange
      .dock()
      .floating()
      .map((window) => window.panel),
    focused: document.activeElement?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? null,
  }));
  check(
    `${p} OK makes the Memory panel float and puts the focus into it`,
    same(result.floating, ['memory']) && result.focused === 'memory',
    JSON.stringify(result),
  );
  // The panel that floats is listed; the docked lists do not offer it.
  void run(page, 'app.layout.move', { panel: 'stack' });
  await dialog.waitFor({ timeout: 10_000 });
  const besideOptions = await dialog
    .getByRole('combobox', { name: 'Beside panel' })
    .evaluate((select) => Array.from(select.options).map((option) => option.value));
  check(
    `${p} a floating panel is no target of a move`,
    !besideOptions.includes('memory'),
    JSON.stringify(besideOptions),
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await run(page, 'app.layout.reset');
  finish(`${p} dialog`, errors);
  await closeWithin(context);
}

const PASSES = {
  button: buttonPass,
  narrow: narrowPass,
  tip: tipPass,
  layouts: layoutsPass,
  uncovered: uncoveredPass,
  room: roomPass,
  program: programPass,
  menus: menusPass,
  dialog: dialogPass,
};

async function main() {
  if (!enginesPresent && enginesRequired) {
    console.error('engine/dist is missing and EASY68K_REQUIRE_ENGINES=1: the simulator session cannot start.');
    process.exit(1);
  }
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(outDir, 'vite-cache'),
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  baseUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  if (!enginesPresent) console.log('engine/dist is missing: the simulator session will not start (ignored).');
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        for (const [label, pass] of Object.entries(PASSES)) {
          if (only.length > 0 && !only.includes(label)) continue;
          console.log(`\n[${name}, ${label}]`);
          try {
            await pass(browser, name);
          } catch (error) {
            check(
              `${name}: ${label} ran to the end`,
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
  if (measured.length > 0) writeFileSync(join(outDir, 'proportions.json'), JSON.stringify(measured, null, 1));
  if (notes.length > 0) console.log(`\nNotes (not failures):\n${notes.map((text) => `  - ${text}`).join('\n')}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
