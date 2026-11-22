// Browser check of the dock (ARCHITECTURE-PLUS P3.1, P5 N1 acceptance). Owner: N1.
//
//   node app/src/ui/dock/check-dock.mjs [--browser chromium|webkit|all] [--out <dir>] [--only <pass,...>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright), with the Windows key map and with the macOS key map where keys
// matter (the page is told which system it runs on before it starts; keys are pressed through the
// key map of that system, Cmd where Windows has Ctrl). It checks what unit tests under Node cannot
// show, item by item of N1's acceptance list:
//
//   boxes      Lock Layout on (the default): every panel of each mode at today's box within 1 px
//              (today's arithmetic of the shell before the dock, from layout.splits and the
//              Registers panel's height); unlocked: each group's outer box is today's box, its
//              content that minus its strip (the Registers group: its content plus its strip);
//              today's splitter names, also after a tab switch, a splitter drag, a move and a reset,
//              and a font change; the narrow default below 1100 px and back, also after a splitter
//              drag; the drop preview has no animation under prefers-reduced-motion
//   moves      keyboard only, locked and unlocked: Move Panel To... and the tab menu (Move
//              Left/Right/Up/Down, Move Tab Earlier/Later) with their announcements; a transient
//              panel alone in a new group shows its strip and x while locked; the reading order of
//              the groups in three arrangements; every View menu command and its shortcut shows and
//              focuses its panel in three arrangements; F2 cycles in PANEL_CYCLE order in a moved
//              arrangement; closing the focused panel moves the focus (P3.1.8); Lock Layout; a
//              reload keeps the arrangement, a second window keeps its own
//   drags      unlocked: a tab dragged to the five drop places of another group and to each window
//              edge; Esc cancels; a drop of Output into a place under 160 x 120 px is not offered;
//              a tab reordered by dragging; locked: no drag
//   program    F4 and at once F9 from Editor mode on a program that reads keys in full screen; the
//              Hardware panel's switch byte ($E00012) reads $00 after each close (x, Delete, tab
//              menu) and View > Hardware, is not zeroed by a move or by Reset Layout; the Output
//              panel's full screen covers the window in three arrangements (elementFromPoint); a
//              running program receives every key of main 2.9.4 rule 4 and none of rules 1-3 in two
//              arrangements while the layout does not change; no dock action while a program writes
//              output continuously; every panel's content mounted once, never by moves, tab or mode
//              switches; collapsing the Output panel keeps its content mounted
//   editor     the editor's message list is 5, 87, 7 px by the rule; a drag overrides it until the
//              list changes; the Registers group follows its content after a font change
//   frames     View > Memory, Stack and Log have focused their panel by the time the panel is in the
//              page, with today's frames and with frames 130 ms late (GitHub's macOS runners)
//   taborder   Lock Layout on (the default): Tab and Shift+Tab go through the window in main's order,
//              in the three modes, wide and narrow, with and without a tool panel (the lists below,
//              recorded on main); in Chromium the accessibility tree reads the dock in main's order;
//              unlocked, no slot is left; a splitter reached through its slot keeps its keys
//   scan       axe (WCAG 2.0/2.1 A and AA) of each mode in both themes, locked and unlocked: no
//              serious or critical finding; screenshots of both themes
//
// Prints "N of M checks passed" and exits non-zero on any failure or console error. Screenshots go
// to build/dock-check (git-ignored) or --out.

/* global console, process, document, window, getComputedStyle, Navigator, requestAnimationFrame, Element, Event, setTimeout, clearTimeout, MutationObserver */

import { existsSync, mkdirSync } from 'node:fs';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'dock-check')));
const only = option('--only', '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const engineDist = join(repoRoot, 'engine', 'dist');
const enginesPresent = existsSync(join(engineDist, 'asm68k.wasm')) && existsSync(join(engineDist, 'sim68k.wasm'));
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** The first page load of the dev server can take minutes on a busy machine. */
const LOAD_TIMEOUT = 240_000;
const VIEWPORT = { width: 1400, height: 900 };

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

// --- pages ------------------------------------------------------------------------------------

function pretendMac() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}
function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function newContext(browser, os = 'windows', viewport = VIEWPORT, reducedMotion = 'reduce') {
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.addInitScript(os === 'mac' ? pretendMac : pretendWindows);
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
  await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: LOAD_TIMEOUT });
  await page
    .waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, { timeout: 60_000 })
    .catch(() => {});
  await page.evaluate(async () => {
    const [panels, dock, layout] = await Promise.all([
      import('/src/state/panels.ts'),
      import('/src/state/dock.ts'),
      import('/src/state/layout.ts'),
    ]);
    const { ctx } = window.__easy68k;
    window.__dock = {
      panels,
      layout,
      ctx,
      controller: () => dock.dockOf(ctx),
      engine: (mode) => window.__easy68kDock?.[mode],
      shape(mode) {
        const visit = (node) =>
          node === null
            ? 'empty'
            : node.type === 'tabs'
              ? node.panels.join('+')
              : `${node.type}(${node.children.map(visit).join(', ')})`;
        return visit(window.__easy68kDock?.[mode]?.tree() ?? null);
      },
      announced: (mode) => document.querySelector(`[data-e68-dock-live="${mode}"]`)?.textContent ?? '',
      focusedPanel: () => document.activeElement?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? null,
    };
  });
  return { page, errors };
}

const setMode = (page, mode) => page.locator(`.e68-modeswitch [data-mode="${mode}"]`).click();
const mode = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().mode);

/** Waits until a condition evaluated in the page holds (or the time is up); returns whether it did. */
async function until(page, fn, arg, timeout = 10_000) {
  return page
    .waitForFunction(fn, arg, { timeout, polling: 50 })
    .then(() => true)
    .catch(() => false);
}

/** Two animation frames: React has committed and FlexLayout has measured. */
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

/** Lets the layout settle: a few frames and a short pause (a loaded machine is slow). */
async function settle(page) {
  await frames(page, 3);
  await sleep(150);
  await frames(page, 2);
}

// --- what is on screen --------------------------------------------------------------------------

/** The boxes of the shown workspace: regions (visible ones), their groups, splitters, tab lists. */
function screenOf(page) {
  return page.evaluate(() => {
    const ws = document.querySelector('[data-e68-workspace]:not([hidden])');
    const r1 = (value) => Math.round(value * 10) / 10;
    const box = (element) => {
      const b = element.getBoundingClientRect();
      return [r1(b.left), r1(b.top), r1(b.width), r1(b.height)];
    };
    const visible = (element) =>
      typeof element.checkVisibility === 'function'
        ? element.checkVisibility({ visibilityProperty: true })
        : element.offsetParent !== null;
    const groups = Array.from(ws.querySelectorAll('.flexlayout__tabset_container'));
    const groupOf = (element) => {
      const b = element.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const y = b.top + Math.min(b.height / 2, 4);
      return groups.find((group) => {
        const g = group.getBoundingClientRect();
        return x >= g.left && x <= g.right && y >= g.top && y <= g.bottom;
      });
    };
    const regions = {};
    for (const element of ws.querySelectorAll('[data-e68-panel]')) {
      if (!visible(element)) continue;
      const group = groupOf(element);
      regions[element.getAttribute('data-e68-panel')] = {
        box: box(element),
        role: element.getAttribute('role'),
        group: group ? box(group) : null,
        strip: group ? group.querySelector('.flexlayout__tabset_tabbar_outer') !== null : null,
      };
    }
    return {
      workspace: box(ws),
      regions,
      separators: Array.from(ws.querySelectorAll('[role=separator]'))
        .filter(visible)
        .map((element) => ({ name: element.getAttribute('aria-label'), box: box(element) })),
      inert: Array.from(ws.querySelectorAll('.flexlayout__splitter[data-e68-inert]')).length,
      tablists: Array.from(ws.querySelectorAll('[role=tablist]'))
        .filter(visible)
        .map((element) => ({
          name: element.getAttribute('aria-label'),
          tabs: Array.from(element.querySelectorAll('[role=tab]')).map((tab) => tab.textContent.trim()),
        })),
    };
  });
}

/**
 * Today's boxes (the shell before the dock: EditorWorkspace.tsx and SimWorkspace.tsx), computed in
 * the page from layout.splits and the Registers panel's content height, exactly as that shell did.
 */
function todayBoxes(page, workspaceMode, registersHeight) {
  return page.evaluate(
    ([m, registers]) => {
      const { layout, ctx } = window.__dock;
      const settings = ctx.settings.get();
      const ws = document.querySelector(`[data-e68-workspace="${m}"]`).getBoundingClientRect();
      const [x0, y0, W, H] = [ws.left, ws.top, ws.width, ws.height];
      const px = (id, available) => layout.splitPixels(settings, id, available).value;
      const visible = (id) => layout.isPanelVisible(settings, id, ctx.platform.kind);
      const out = {};
      if (m === 'editor') {
        const state = ctx.store.getState();
        const list = layout.messageListOf(state, state.documents.activeId);
        const rule = layout.messagesPaneHeight({ messageCount: list.count, assembled: list.assembled, dragged: null });
        const messages = Math.min(rule, Math.max(87, H - 80));
        const files = visible('files') ? px('editor.files', W) : 0;
        const left = files > 0 ? x0 + files + 1 : x0;
        const width = files > 0 ? W - files - 1 : W;
        if (files > 0) out.files = [x0, y0, files, H];
        out.editor = [left, y0, width, H - 1 - messages];
        out.messages = [left, y0 + H - messages, width, messages];
        return out;
      }
      const narrow = window.matchMedia(`(max-width: ${layout.NARROW_WIDTH - 0.02}px)`).matches;
      const shell = window.__easy68k.shell.getState();
      const tools = layout.TOOL_PANELS.filter(visible);
      // The left column: Registers (its content and today's 1 px border), Listing, Messages.
      const leftWidth = narrow ? W : px('sim.columns', W);
      const leftHeight = narrow ? px('sim.columns', H) : H;
      const main = leftHeight - registers - 1;
      const messages = px('sim.messages', main);
      out.registers = [x0, y0, leftWidth, registers + 1];
      out.listing = [x0, y0 + registers + 1, leftWidth, main - 1 - messages];
      out.messages = [x0, y0 + leftHeight - messages, leftWidth, messages];
      if (narrow) {
        const top = y0 + leftHeight + 1 + 29;
        const height = H - leftHeight - 1 - 29;
        const front =
          shell.outputInFront || tools.length === 0
            ? 'output'
            : shell.activeTool && tools.includes(shell.activeTool)
              ? shell.activeTool
              : tools[0];
        out[front] = [x0, top, W, height];
        return out;
      }
      const right = x0 + leftWidth + 1;
      const width = W - leftWidth - 1;
      if (tools.length === 0) {
        if (!shell.outputCollapsed) out.output = [right, y0, width, H];
        return out;
      }
      const front = shell.activeTool && tools.includes(shell.activeTool) ? shell.activeTool : tools[0];
      if (shell.outputCollapsed) {
        out[front] = [right, y0 + 24 + 29, width, H - 24 - 29];
        return out;
      }
      const toolArea = px('sim.tools', H) - 31 + 29;
      out.output = [right, y0, width, H - 1 - toolArea];
      out[front] = [right, y0 + H - toolArea + 29, width, toolArea - 29];
      return out;
    },
    [workspaceMode, registersHeight],
  );
}

/** Compares boxes within `tolerance` px; returns the differences as text. */
function compareBoxes(actual, expected, tolerance = 1) {
  const problems = [];
  for (const [id, want] of Object.entries(expected)) {
    const have = actual[id];
    if (!have) {
      problems.push(`${id} missing`);
      continue;
    }
    if (have.some((value, index) => Math.abs(value - want[index]) > tolerance)) {
      problems.push(
        `${id} ${JSON.stringify(have)} vs today ${JSON.stringify(want.map((v) => Math.round(v * 10) / 10))}`,
      );
    }
  }
  for (const id of Object.keys(actual)) if (!(id in expected)) problems.push(`${id} not expected`);
  return problems;
}

const regionBoxes = (screen) =>
  Object.fromEntries(Object.entries(screen.regions).map(([id, entry]) => [id, entry.box]));
const registersContent = (screen) => screen.regions.registers?.box[3] ?? 0;

async function showPanels(page, ids, focus = false) {
  await page.evaluate(
    ([list, withFocus]) => {
      for (const id of list) window.__dock.panels.showPanel(window.__dock.ctx, id, { focus: withFocus });
    },
    [ids, focus],
  );
  await settle(page);
}
async function hidePanels(page, ids) {
  await page.evaluate((list) => {
    for (const id of list) window.__dock.panels.hidePanel(window.__dock.ctx, id);
  }, ids);
  await settle(page);
}
const setLocked = async (page, on) => {
  await page.evaluate((value) => window.__dock.controller().setLocked(value), on);
  await settle(page);
};
const resetLayout = async (page) => {
  await page.evaluate(() => window.__dock.controller().reset());
  await settle(page);
};

const DEFAULT_NAMES = {
  editor: ['Resize the Files panel', 'Resize the Messages panel'],
  simulator: ['Resize the Messages panel', 'Resize the two columns'],
  simulatorTools: ['Resize the Messages panel', 'Resize the two columns', 'Resize the tool panels'],
};
const names = (screen) => screen.separators.map((separator) => separator.name).sort();

// --- pass: boxes ----------------------------------------------------------------------------------

async function boxesPass(browser, name) {
  const p = `${name}/boxes:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  await settle(page);

  // Editor mode, locked (the default).
  let screen = await screenOf(page);
  let today = await todayBoxes(page, 'editor', 0);
  let problems = compareBoxes(regionBoxes(screen), today);
  check(`${p} Editor, locked: every panel at today's box within 1 px`, problems.length === 0, problems.join('; '));
  check(
    `${p} Editor, locked: no tab strip (today's look)`,
    screen.tablists.filter((list) => list.name !== 'Documents').length === 0,
    JSON.stringify(screen.tablists),
  );
  check(
    `${p} Editor: today's splitter names`,
    same(names(screen), [...DEFAULT_NAMES.editor].sort()),
    JSON.stringify(names(screen)),
  );
  await page.screenshot({ path: join(outDir, `${name}-editor-locked.png`) });

  // Simulator mode: Output alone, with tool panels, collapsed.
  await setMode(page, 'simulator');
  await settle(page);
  screen = await screenOf(page);
  const registers = registersContent(screen);
  today = await todayBoxes(page, 'simulator', registers);
  problems = compareBoxes(regionBoxes(screen), today);
  check(`${p} Simulator, locked: every panel at today's box within 1 px`, problems.length === 0, problems.join('; '));
  check(
    `${p} Simulator: today's splitter names; the line below Registers is not a control`,
    same(names(screen), [...DEFAULT_NAMES.simulator].sort()) && screen.inert === 1,
    `${JSON.stringify(names(screen))}, inert ${screen.inert}`,
  );

  await showPanels(page, ['memory', 'log', 'stack']);
  screen = await screenOf(page);
  today = await todayBoxes(page, 'simulator', registers);
  problems = compareBoxes(regionBoxes(screen), today);
  check(
    `${p} Simulator with tool panels, locked: every panel at today's box within 1 px`,
    problems.length === 0,
    problems.join('; '),
  );
  const tools = screen.tablists.find((list) => list.name === 'Tool panels');
  check(
    `${p} the tool group's strip is today's: named Tool panels, Memory Stack Log`,
    same(tools?.tabs, ['Memory', 'Stack', 'Log']),
    JSON.stringify(screen.tablists),
  );
  check(
    `${p} Simulator with tool panels: today's splitter names`,
    same(names(screen), [...DEFAULT_NAMES.simulatorTools].sort()),
    JSON.stringify(names(screen)),
  );
  await page.screenshot({ path: join(outDir, `${name}-simulator-locked.png`) });

  // Names survive a tab switch, a splitter drag and a font change.
  await page.locator('[data-e68-workspace="simulator"] [role=tab]', { hasText: 'Memory' }).click();
  await settle(page);
  screen = await screenOf(page);
  check(
    `${p} the names after a tab switch`,
    same(names(screen), [...DEFAULT_NAMES.simulatorTools].sort()),
    JSON.stringify(names(screen)),
  );
  // The tab strip's keys: the arrows move along it and wrap at its ends, Enter selects.
  const focusedTab = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  await page.locator('[id="flexlayout-tabbutton-simulator:memory"]').focus();
  const tabKeys = [];
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) {
    await page.keyboard.press(key);
    tabKeys.push(await focusedTab());
  }
  await page.keyboard.press('Enter');
  await settle(page);
  const selectedTab = await page.evaluate(
    () =>
      document.querySelector('[data-e68-dock="simulator"] [role=tab][aria-selected="true"]')?.textContent?.trim() ?? '',
  );
  check(
    `${p} the tool strip's arrows move along it and wrap; Enter selects`,
    same(tabKeys, ['Stack', 'Log', 'Memory', 'Log']) && selectedTab === 'Log',
    `${JSON.stringify(tabKeys)}, selected ${selectedTab}`,
  );
  const columns = page.locator(
    '[data-e68-workspace="simulator"] [role=separator][aria-label="Resize the two columns"]',
  );
  const before = (await screenOf(page)).regions.listing.box[2];
  await columns.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await settle(page);
  screen = await screenOf(page);
  const splitStored = await page.evaluate(() => window.__dock.ctx.settings.get().app.layout);
  check(
    `${p} a splitter moved with the arrow keys moves 10 px a press, writes layout.splits and leaves layout.dock absent`,
    Math.abs(screen.regions.listing.box[2] - before - 30) <= 1 &&
      splitStored.dock === undefined &&
      typeof splitStored.splits['sim.columns'] === 'number',
    `${before} -> ${screen.regions.listing.box[2]}, dock ${JSON.stringify(splitStored.dock)}`,
  );
  check(
    `${p} the names after a splitter drag`,
    same(names(screen), [...DEFAULT_NAMES.simulatorTools].sort()),
    JSON.stringify(names(screen)),
  );
  today = await todayBoxes(page, 'simulator', registers);
  problems = compareBoxes(regionBoxes(screen), today);
  check(
    `${p} after the splitter moved: still today's boxes for the stored split`,
    problems.length === 0,
    problems.join('; '),
  );
  // Shift+arrow, Home/End, Enter and a double-click as the kit's Splitter.
  await columns.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await settle(page);
  const afterShift = (await screenOf(page)).regions.listing.box[2];
  await page.keyboard.press('Enter');
  await settle(page);
  const afterEnter = (await screenOf(page)).regions.listing.box[2];
  check(
    `${p} Shift+arrow moves 50 px, Enter restores the default`,
    Math.abs(afterShift - (before + 30 - 50)) <= 1 && Math.abs(afterEnter - before) <= 1,
    `${before} +30 -50 = ${afterShift}, Enter ${afterEnter}`,
  );
  await columns.dblclick();
  await settle(page);

  await page.evaluate(() =>
    window.__dock.ctx.settings.update((s) => ({
      ...s,
      sim: { ...s.sim, listingFont: { ...s.sim.listingFont, size: s.sim.listingFont.size + 4 } },
    })),
  );
  await settle(page);
  screen = await screenOf(page);
  check(
    `${p} the names after a font change`,
    same(names(screen), [...DEFAULT_NAMES.simulatorTools].sort()),
    JSON.stringify(names(screen)),
  );

  // A move: the names become "Resize <panel> and <panel>"; Reset Layout gives today's back.
  await page.evaluate(() =>
    window.__dock.controller().move('memory', { kind: 'beside', near: 'listing', side: 'right' }),
  );
  await settle(page);
  screen = await screenOf(page);
  const moved = names(screen);
  check(
    `${p} after a move, every splitter is named by the panels on its two sides`,
    moved.length >= 3 &&
      moved.every((text) => /^Resize .+ and .+$/.test(text)) &&
      moved.some((text) => text.includes('Listing') && text.includes('Memory')),
    JSON.stringify(moved),
  );
  await resetLayout(page);
  screen = await screenOf(page);
  check(
    `${p} Reset Layout: today's names again`,
    same(names(screen), [...DEFAULT_NAMES.simulatorTools].sort()),
    JSON.stringify(names(screen)),
  );
  await page.evaluate(() =>
    window.__dock.ctx.settings.update((s) => ({
      ...s,
      sim: { ...s.sim, listingFont: { ...s.sim.listingFont, size: s.sim.listingFont.size - 4 } },
    })),
  );
  await settle(page);

  // Collapsed Output: today's bar.
  await hidePanels(page, ['output']);
  screen = await screenOf(page);
  today = await todayBoxes(page, 'simulator', registersContent(screen));
  problems = compareBoxes(regionBoxes(screen), today);
  check(
    `${p} Output collapsed, locked: every panel at today's box within 1 px`,
    problems.length === 0,
    problems.join('; '),
  );
  const bar = await page.locator('[data-e68-workspace="simulator"] .e68-dock__expand').boundingBox();
  check(
    `${p} the collapsed Output panel's bar is 24 px tall at the top of the right column`,
    bar !== null && Math.abs(bar.height - 24) <= 0.5,
    JSON.stringify(bar),
  );
  await showPanels(page, ['output']);

  // Unlocked: each group's outer box is today's box; its content that minus the strip.
  await setLocked(page, false);
  screen = await screenOf(page);
  today = await todayBoxes(page, 'simulator', registersContent(screen));
  const groupProblems = [];
  for (const [id, entry] of Object.entries(screen.regions)) {
    const want = today[id];
    if (!want || !entry.group) {
      groupProblems.push(`${id}: no box`);
      continue;
    }
    if (!entry.strip) groupProblems.push(`${id}: no strip`);
    if (id === 'registers') {
      // Its content plus its strip; the groups below it share the rest.
      if (Math.abs(entry.group[3] - (entry.box[3] + 29)) > 1)
        groupProblems.push(`registers group ${entry.group} content ${entry.box}`);
      continue;
    }
    if (id === 'listing' || id === 'messages') {
      if (Math.abs(entry.box[1] - entry.group[1] - 29) > 1) groupProblems.push(`${id}: content not below its strip`);
      continue;
    }
    const outer = id === want ? want : want;
    // Today's region box of a tool panel is its content below today's strip: the group starts 29 px higher.
    const isTool = ['memory', 'stack', 'hardware', 'breakpoints', 'log'].includes(id);
    const expectedOuter = isTool ? [outer[0], outer[1] - 29, outer[2], outer[3] + 29] : outer;
    if (entry.group.some((value, index) => Math.abs(value - expectedOuter[index]) > 1)) {
      groupProblems.push(`${id} group ${JSON.stringify(entry.group)} vs today ${JSON.stringify(expectedOuter)}`);
    }
    if (Math.abs(entry.box[1] - (entry.group[1] + 29)) > 1 || Math.abs(entry.box[3] - (entry.group[3] - 29)) > 1) {
      groupProblems.push(`${id} content ${JSON.stringify(entry.box)} not its group less the strip`);
    }
  }
  check(
    `${p} unlocked: every group shows its strip, its outer box today's, its content that minus the strip`,
    groupProblems.length === 0,
    groupProblems.join('; '),
  );
  await page.screenshot({ path: join(outDir, `${name}-simulator-unlocked.png`) });
  await setMode(page, 'editor');
  await settle(page);
  screen = await screenOf(page);
  today = await todayBoxes(page, 'editor', 0);
  const editorGroups = [];
  const files = screen.regions.files;
  if (!files?.group || files.group.some((value, index) => Math.abs(value - today.files[index]) > 1)) {
    editorGroups.push(`files group ${JSON.stringify(files?.group)} vs today ${JSON.stringify(today.files)}`);
  }
  // The message list keeps its height by the rule below its strip; the Editor group has the rest.
  const editorGroup = screen.regions.editor?.group;
  const messagesEntry = screen.regions.messages;
  const listHeight = today.messages[3];
  if (
    !messagesEntry ||
    Math.abs(messagesEntry.box[3] - listHeight) > 1 ||
    Math.abs(messagesEntry.group[3] - (listHeight + 29)) > 1
  ) {
    editorGroups.push(`messages ${JSON.stringify(messagesEntry)} vs a list of ${listHeight} px`);
  }
  if (
    !editorGroup ||
    Math.abs(editorGroup[1] - today.editor[1]) > 1 ||
    Math.abs(editorGroup[3] - (today.editor[3] - 29)) > 1
  ) {
    editorGroups.push(
      `editor group ${JSON.stringify(editorGroup)} vs today ${JSON.stringify(today.editor)} less the Messages strip`,
    );
  }
  check(
    `${p} Editor unlocked: Files at today's box; the message list keeps its height below its strip, the Editor group has the rest; every group with its strip`,
    editorGroups.length === 0 && screen.regions.files?.strip && screen.regions.editor?.strip && messagesEntry?.strip,
    editorGroups.join('; '),
  );
  await page.screenshot({ path: join(outDir, `${name}-editor-unlocked.png`) });
  await setLocked(page, true);

  // The narrow default below 1100 px, and back; also after a splitter drag.
  await setMode(page, 'simulator');
  await page.setViewportSize({ width: 1000, height: 900 });
  await settle(page);
  screen = await screenOf(page);
  today = await todayBoxes(page, 'simulator', registersContent(screen));
  problems = compareBoxes(regionBoxes(screen), today);
  check(`${p} below 1100 px: today's narrow layout within 1 px`, problems.length === 0, problems.join('; '));
  const narrowTabs = screen.tablists.map((list) => list.tabs).flat();
  check(
    `${p} below 1100 px: Output is the first tab of the tool group`,
    narrowTabs[0] === 'Output' && narrowTabs.includes('Memory'),
    JSON.stringify(narrowTabs),
  );
  await page.screenshot({ path: join(outDir, `${name}-simulator-narrow.png`) });
  // Today's narrow strip is the tool strip, also with Output alone: its tab list is named Tool panels.
  const shownTools = await page.evaluate(() =>
    ['memory', 'stack', 'log', 'hardware', 'breakpoints'].filter((id) =>
      window.__dock.panels.panelVisible(window.__dock.ctx, id),
    ),
  );
  await hidePanels(page, shownTools);
  screen = await screenOf(page);
  check(
    `${p} below 1100 px without tool panels: the Output tab list keeps today's name Tool panels`,
    screen.tablists.some((list) => list.name === 'Tool panels' && same(list.tabs, ['Output'])),
    JSON.stringify(screen.tablists),
  );
  await showPanels(page, shownTools);
  const narrowColumns = page.locator(
    '[data-e68-workspace="simulator"] [role=separator][aria-label="Resize the two columns"]',
  );
  await narrowColumns.focus();
  await page.keyboard.press('ArrowDown');
  await settle(page);
  await page.setViewportSize(VIEWPORT);
  await settle(page);
  screen = await screenOf(page);
  today = await todayBoxes(page, 'simulator', registersContent(screen));
  problems = compareBoxes(regionBoxes(screen), today);
  const shape = await page.evaluate(() => window.__dock.shape('simulator'));
  check(
    `${p} back above 1100 px after a splitter drag: the wide default, today's boxes`,
    problems.length === 0 && shape.startsWith('row(column(registers, listing, messages), column(output'),
    `${shape}; ${problems.join('; ')}`,
  );

  // No animation of the drop preview under prefers-reduced-motion (the context asks for it).
  const transition = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'flexlayout__outline_rect';
    probe.style.transition = 'top 0.3s, left 0.3s';
    document.querySelector('[data-e68-dock="simulator"] .flexlayout__layout').append(probe);
    const value = getComputedStyle(probe).transitionDuration;
    probe.remove();
    return value;
  });
  check(`${p} prefers-reduced-motion: the drop preview has no transition`, /^0s(, 0s)*$/.test(transition), transition);

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- pass: moves (keyboard only) ------------------------------------------------------------------

/** The key that the platform's Ctrl is (Cmd on the macOS key map). */
const PANEL_ORDER = (page, workspaceMode) =>
  page.evaluate((m) => {
    const dock = document.querySelector(`[data-e68-dock="${m}"]`);
    const dom = Array.from(dock.querySelectorAll('[data-e68-panel]')).map((element) =>
      element.getAttribute('data-e68-panel'),
    );
    const tree = window.__dock.engine(m).tree();
    const visit = (node) => (node.type === 'tabs' ? node.panels : node.children.flatMap(visit));
    return { dom, tree: visit(tree) };
  }, workspaceMode);

/** The reading order (P3.1.8): the DOM order of the panels is the tree's (rows left to right, columns top to bottom), and agrees with their boxes. */
async function readingOrder(page, workspaceMode) {
  const { dom, tree } = await PANEL_ORDER(page, workspaceMode);
  const boxes = await page.evaluate((m) => {
    const dock = document.querySelector(`[data-e68-dock="${m}"]`);
    const out = {};
    for (const element of dock.querySelectorAll('.flexlayout__tabset_container')) {
      const b = element.getBoundingClientRect();
      for (const button of element.querySelectorAll('.flexlayout__tab_button'))
        out[button.id] = [b.left, b.top, b.right, b.bottom];
    }
    // Groups without a strip: the tab's own content box.
    for (const element of dock.querySelectorAll('.flexlayout__tab[data-e68-dock-tab]')) {
      const b = element.getBoundingClientRect();
      const id = `flexlayout-tabbutton-${element.getAttribute('data-e68-dock-tab')}`;
      if (!out[id] && b.width > 0) out[id] = [b.left, b.top, b.right, b.bottom];
    }
    return out;
  }, workspaceMode);
  // A later panel never lies wholly above and to the left of an earlier one's group.
  const prefix = `flexlayout-tabbutton-${workspaceMode}:`;
  const boxOf = (panel) => boxes[`${prefix}${panel}`];
  let geometry = true;
  for (let i = 0; i < tree.length; i++) {
    for (let j = i + 1; j < tree.length; j++) {
      const a = boxOf(tree[i]);
      const b = boxOf(tree[j]);
      if (a && b && b[2] <= a[0] + 1 && b[3] <= a[1] + 1) geometry = false;
    }
  }
  return {
    ok: same(dom, tree) && geometry,
    detail: `DOM ${dom.join(',')}; tree ${tree.join(',')}; geometry ${geometry}`,
  };
}

/** Selects an option of a closed <select> with the keyboard: types its title. */
async function typeOption(page, title) {
  await page.keyboard.type(title, { delay: 20 });
  await sleep(1100); // the select's type-ahead forgets after a second
}

/**
 * Move Panel To... with the keyboard only: the menu by its access keys (Windows key map) or the
 * command (macOS has no menu access keys), then the dialog's controls with Tab, the arrows and
 * typed titles, and Enter.
 */
async function moveWithDialog(page, os, workspaceMode, move) {
  if (os === 'mac') {
    page.evaluate(() => window.__easy68k.ctx.commands.run('app.layout.move')).catch(() => {});
  } else {
    await page.keyboard.press(workspaceMode === 'editor' ? 'Alt+w' : 'Alt+v');
    await page.locator('[role=menu][data-e68-menu]').first().waitFor({ timeout: 5000 });
    await page.keyboard.press('v');
  }
  const dialog = page.locator('[role=dialog]', { hasText: 'Move Panel' });
  await dialog.waitFor({ timeout: 10_000 });
  await settle(page);
  // The first control is the Panel list.
  const first = await page.evaluate(() => document.activeElement?.tagName);
  if (first !== 'SELECT') await page.keyboard.press('Tab');
  await typeOption(page, move.panel);
  await page.keyboard.press('Tab'); // the chosen place (one tab stop for the three radios)
  const steps = { tab: 0, beside: 1, edge: 2 }[move.place];
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown');
  // Tab goes on to the lists of the chosen place (document order: each place's lists follow it).
  if (move.place === 'tab') {
    await page.keyboard.press('Tab');
    await typeOption(page, move.near);
  } else if (move.place === 'beside') {
    await page.keyboard.press('Tab');
    await typeOption(page, move.near);
    await page.keyboard.press('Tab');
    await typeOption(page, move.side);
  } else {
    await page.keyboard.press('Tab');
    await typeOption(page, move.side);
  }
  // A list keeps Enter for itself: Tab to OK, then Enter.
  for (let i = 0; i < 8; i++) {
    if ((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'OK') break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached', timeout: 10_000 });
  await settle(page);
}

/** The tab menu of a panel with the keyboard: focus its tab, Shift+F10, arrows to the item, Enter. */
async function tabMenu(page, workspaceMode, panel, caption) {
  const tab = page.locator(`[id="flexlayout-tabbutton-${workspaceMode}:${panel}"]`);
  await tab.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('[role=menu][data-e68-menu]').first();
  await menu.waitFor({ timeout: 5000 });
  const items = await menu.locator('[role^=menuitem]').evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.textContent.trim(),
      disabled: element.getAttribute('aria-disabled') === 'true',
    })),
  );
  for (let i = 0; i < 12; i++) {
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (focused === caption) break;
    await page.keyboard.press('ArrowDown');
  }
  const target = items.find((item) => item.text === caption);
  if (!target || target.disabled) {
    await page.keyboard.press('Escape');
    return { items, chosen: false };
  }
  await page.keyboard.press('Enter');
  await settle(page);
  return { items, chosen: true };
}

const announced = (page, workspaceMode) =>
  page
    .waitForFunction(
      (m) => (document.querySelector(`[data-e68-dock-live="${m}"]`)?.textContent ?? '') !== '',
      workspaceMode,
      { timeout: 3000 },
    )
    .then(() => page.evaluate((m) => document.querySelector(`[data-e68-dock-live="${m}"]`).textContent, workspaceMode))
    .catch(() => '');

async function movesPass(browser, name, os) {
  const p = `${name}/${os}/moves:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  await settle(page);
  const shape = (m) => page.evaluate((x) => window.__dock.shape(x), m);
  const stored = () => page.evaluate(() => window.__dock.ctx.settings.get().app.layout);

  // Locked (the default): Move Panel To... still moves a panel and keeps the lock.
  const order0 = await readingOrder(page, 'editor');
  check(`${p} the default arrangement's reading order follows the panels' places`, order0.ok, order0.detail);
  await page.evaluate(() => window.__dock.panels.focusPanel(window.__dock.ctx, 'files'));
  await settle(page);
  await moveWithDialog(page, os, 'editor', { panel: 'Files', place: 'edge', side: 'Right' });
  let layout = await stored();
  check(
    `${p} locked: Move Panel To... (keyboard) moves Files to the right edge, keeps the lock, keeps the panels' visibility`,
    (await shape('editor')) === 'row(column(editor, messages), files)' &&
      layout.dock?.locked !== false &&
      layout.panels.files?.visible !== false,
    `${await shape('editor')} ${JSON.stringify(layout.dock?.locked)}`,
  );
  check(
    `${p} the move is announced`,
    (await announced(page, 'editor')) === 'Files moved to the right edge of the window.',
    await announced(page, 'editor'),
  );
  check(
    `${p} the focus is in the moved panel`,
    (await page.evaluate(() => window.__dock.focusedPanel())) === 'files',
    String(await page.evaluate(() => window.__dock.focusedPanel())),
  );
  const order1 = await readingOrder(page, 'editor');
  check(`${p} after the move the reading order follows the places`, order1.ok, order1.detail);

  await moveWithDialog(page, os, 'editor', { panel: 'Messages', place: 'beside', near: 'Files', side: 'Below' });
  check(
    `${p} beside a panel, below`,
    (await shape('editor')) === 'row(editor, column(files, messages))',
    await shape('editor'),
  );
  check(
    `${p} ...announced`,
    (await announced(page, 'editor')) === 'Messages moved beside Files, below.',
    await announced(page, 'editor'),
  );
  await moveWithDialog(page, os, 'editor', { panel: 'Files', place: 'tab', near: 'Editor' });
  check(
    `${p} into the group of a panel, as a tab`,
    (await shape('editor')) === 'row(editor+files, messages)',
    await shape('editor'),
  );
  check(
    `${p} ...announced`,
    (await announced(page, 'editor')) === 'Files moved into the group of Editor.',
    await announced(page, 'editor'),
  );
  const order2 = await readingOrder(page, 'editor');
  check(`${p} the reading order in a third arrangement`, order2.ok, order2.detail);
  await page.screenshot({ path: join(outDir, `${name}-${os}-editor-moved-locked.png`) });

  // The tab menu, keyboard only: the group of Editor and Files shows its strip while locked.
  let menu = await tabMenu(page, 'editor', 'files', 'Move Tab Earlier');
  check(
    `${p} tab menu: Move Tab Earlier`,
    (await shape('editor')) === 'row(files+editor, messages)',
    `${await shape('editor')} ${JSON.stringify(menu.items)}`,
  );
  check(
    `${p} ...announced`,
    (await announced(page, 'editor')) === 'Files moved to position 1 of its group.',
    await announced(page, 'editor'),
  );
  menu = await tabMenu(page, 'editor', 'files', 'Move Tab Earlier');
  check(
    `${p} Move Tab Earlier is disabled at the first place`,
    !menu.chosen && menu.items.find((item) => item.text === 'Move Tab Earlier')?.disabled === true,
    JSON.stringify(menu.items),
  );
  check(
    `${p} the tab menu lists Move To..., Move Left/Right/Up/Down, Move Tab Earlier/Later and Close (Files can be closed)`,
    same(
      menu.items.map((item) => item.text),
      ['Move To...', 'Move Left', 'Move Right', 'Move Up', 'Move Down', 'Move Tab Earlier', 'Move Tab Later', 'Close'],
    ),
    JSON.stringify(menu.items.map((item) => item.text)),
  );
  await tabMenu(page, 'editor', 'files', 'Move Tab Later');
  check(
    `${p} tab menu: Move Tab Later`,
    (await shape('editor')) === 'row(editor+files, messages)',
    await shape('editor'),
  );
  await tabMenu(page, 'editor', 'files', 'Move Right');
  check(
    `${p} tab menu: Move Right (beside the neighbouring group)`,
    (await shape('editor')) === 'row(editor, messages, files)',
    await shape('editor'),
  );
  check(
    `${p} ...announced`,
    (await announced(page, 'editor')) === 'Files moved beside Messages, right.',
    await announced(page, 'editor'),
  );
  await setLocked(page, false);
  await tabMenu(page, 'editor', 'files', 'Move Left');
  check(`${p} unlocked: Move Left`, (await shape('editor')) === 'row(editor, files, messages)', await shape('editor'));
  await tabMenu(page, 'editor', 'messages', 'Move Down');
  check(
    `${p} unlocked: Move Down (no group below: the bottom edge)`,
    (await shape('editor')) === 'column(row(editor, files), messages)',
    await shape('editor'),
  );
  check(
    `${p} ...announced`,
    (await announced(page, 'editor')) === 'Messages moved to the bottom edge of the window.',
    await announced(page, 'editor'),
  );
  await tabMenu(page, 'editor', 'messages', 'Move Up');
  check(`${p} unlocked: Move Up`, (await shape('editor')).includes('messages'), await shape('editor'));
  await moveWithDialog(page, os, 'editor', { panel: 'Files', place: 'edge', side: 'Left' });
  check(
    `${p} unlocked: Move Panel To..., the left edge`,
    (await shape('editor')).startsWith('row(files'),
    await shape('editor'),
  );
  layout = await stored();
  check(
    `${p} the lock stays as it was (unlocked) after the moves`,
    layout.dock?.locked === false,
    JSON.stringify(layout.dock?.locked),
  );
  await setLocked(page, true);

  // A transient test panel moved alone into a new group while locked shows its strip and its x.
  await page.evaluate(() =>
    window.__dock.controller().openTransient({
      id: 'viewer:91',
      title: 'test.bin',
      tooltip: 'My Programs/test.bin',
      render: () => null,
      onClose: () => {
        window.__closed91 = true;
      },
    }),
  );
  await settle(page);
  await page.evaluate(() =>
    window.__dock.controller().move('viewer:91', { kind: 'beside', near: 'messages', side: 'below' }),
  );
  await settle(page);
  const transient = await page.evaluate(() => {
    const button = document.getElementById('flexlayout-tabbutton-editor:viewer:91');
    const group = button?.closest('.flexlayout__tabset');
    return {
      strip: button !== null && button.checkVisibility(),
      alone: group?.querySelectorAll('.flexlayout__tab_button').length ?? 0,
      close: button?.querySelector('.flexlayout__tab_button_trailing') !== null,
      title: button?.getAttribute('title'),
    };
  });
  check(
    `${p} a transient panel alone in a new group while locked shows its strip and its x`,
    transient.strip && transient.alone === 1 && transient.close,
    JSON.stringify(transient),
  );
  // The viewer's tab names the viewer's own element, its tab panel, which the tab labels.
  const viewerPanel = await page.evaluate(() => {
    const button = document.getElementById('flexlayout-tabbutton-editor:viewer:91');
    const panel = document.getElementById(button?.getAttribute('aria-controls') ?? '');
    return {
      role: panel?.getAttribute('role') ?? null,
      panel: panel?.getAttribute('data-e68-panel') ?? null,
      labelled: panel?.getAttribute('aria-labelledby') === button?.id,
    };
  });
  check(
    `${p} the viewer's tab controls the viewer's own tab panel, which the tab labels`,
    viewerPanel.role === 'tabpanel' && viewerPanel.panel === 'viewer:91' && viewerPanel.labelled,
    JSON.stringify(viewerPanel),
  );
  await page.locator('[id="flexlayout-tabbutton-editor:viewer:91"]').focus();
  await page.keyboard.press('Delete');
  await settle(page);
  check(
    `${p} Delete on its tab closes the viewer (onClose runs)`,
    await page.evaluate(
      () => window.__closed91 === true && document.getElementById('flexlayout-tabbutton-editor:viewer:91') === null,
    ),
  );
  check(`${p} the viewer was never stored`, !JSON.stringify(await stored()).includes('viewer'));

  // Persistence: the arrangement survives a reload; a second window keeps its own.
  const before = await shape('editor');
  await page.reload();
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68kDock?.editor !== undefined);
  await page.evaluate(async () => {
    const [panels, dock, layout] = await Promise.all([
      import('/src/state/panels.ts'),
      import('/src/state/dock.ts'),
      import('/src/state/layout.ts'),
    ]);
    const { ctx } = window.__easy68k;
    window.__dock = {
      panels,
      layout,
      ctx,
      controller: () => dock.dockOf(ctx),
      engine: (m) => window.__easy68kDock?.[m],
      shape(m) {
        const visit = (node) =>
          node === null
            ? 'empty'
            : node.type === 'tabs'
              ? node.panels.join('+')
              : `${node.type}(${node.children.map(visit).join(', ')})`;
        return visit(window.__easy68kDock?.[m]?.tree() ?? null);
      },
      focusedPanel: () => document.activeElement?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? null,
    };
  });
  await settle(page);
  check(
    `${p} the arrangement survives a reload`,
    (await shape('editor')) === before,
    `${before} -> ${await shape('editor')}`,
  );
  const second = await openApp(context);
  await settle(second.page);
  const secondShape = await second.page.evaluate(() => window.__dock.shape('editor'));
  await second.page.evaluate(() => window.__dock.controller().reset());
  await settle(second.page);
  await settle(page);
  check(
    `${p} a second window starts with the layout stored last and keeps its own (its Reset does not move this one's panels)`,
    secondShape === before && (await shape('editor')) === before,
    `${secondShape} / ${await shape('editor')}`,
  );
  await second.page.close();
  await resetLayout(page);
  check(
    `${p} Reset Layout: today's arrangement`,
    (await shape('editor')) === 'row(files, column(editor, messages))',
    await shape('editor'),
  );

  // Simulator: three arrangements; View menu commands show and focus their panels; F2 cycles.
  await setMode(page, 'simulator');
  await settle(page);
  const VIEW_CAPTIONS = {
    'sim.view.memory': 'Memory',
    'sim.view.stack': 'Stack',
    'sim.view.hardware': 'Hardware',
    'sim.view.breakpoints': 'Break Points',
    'sim.view.log': 'Log',
    'sim.view.output': 'Output Window',
  };
  const viewCommands = [
    ['sim.view.memory', 'memory'],
    ['sim.view.stack', 'stack'],
    ['sim.view.hardware', 'hardware'],
    ['sim.view.breakpoints', 'breakpoints'],
    ['sim.view.log', 'log'],
    ['sim.view.output', 'output'],
  ];
  const arrangements = [
    ['default', async () => {}],
    [
      'tools beside the listing',
      async () => {
        await page.evaluate(() => {
          const dock = window.__dock.controller();
          dock.move('memory', { kind: 'beside', near: 'listing', side: 'right' });
          dock.move('stack', { kind: 'edge', side: 'left' });
        });
      },
    ],
    [
      'output with the tools',
      async () => {
        await page.evaluate(() => window.__dock.controller().move('output', { kind: 'tab', near: 'log' }));
      },
    ],
  ];
  for (const [label, arrange] of arrangements) {
    await arrange();
    await settle(page);
    const shown = [];
    for (const [command, panel] of viewCommands) {
      // The View menu with the mouse (the commands have no shortcuts in keys.ts).
      await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: 'View' }).click();
      await page
        .locator(
          `[role=menu][data-e68-menu] [data-command="${command}"], [role=menu][data-e68-menu] [role^=menuitem]:has-text("${VIEW_CAPTIONS[command]}")`,
        )
        .first()
        .click();
      await until(page, (id) => window.__dock.focusedPanel() === id, panel, 5000);
      const state = await page.evaluate((id) => {
        const region = Array.from(
          document.querySelectorAll(`[data-e68-workspace="simulator"] [data-e68-panel="${id}"]`),
        ).find((element) => element.checkVisibility());
        return { visible: region !== undefined, focused: window.__dock.focusedPanel() };
      }, panel);
      if (!state.visible || state.focused !== panel) shown.push(`${panel}: ${JSON.stringify(state)}`);
    }
    check(`${p} ${label}: every View menu command shows and focuses its panel`, shown.length === 0, shown.join('; '));
    const order = await readingOrder(page, 'simulator');
    check(`${p} ${label}: the reading order follows the places`, order.ok, order.detail);
  }
  note(
    `${name}/${os}: the View menu's panel commands have no shortcut in commands/tables/keys.ts; F2 and Ctrl+Tab cycle the panels`,
  );

  // F2 cycles in PANEL_CYCLE order in the moved arrangement. The Output panel takes F2 itself
  // (main 2.9.4 rule 4): from there the release chord goes on (Ctrl+Alt+O, Ctrl+Option+O).
  await page.evaluate(() => window.__dock.panels.focusPanel(window.__dock.ctx, 'listing'));
  await settle(page);
  const cycle = [];
  for (let i = 0; i < 7; i++) {
    const here = await page.evaluate(() => window.__dock.focusedPanel());
    await page.keyboard.press(here === 'output' ? 'Control+Alt+KeyO' : 'F2');
    await settle(page);
    cycle.push(await page.evaluate(() => window.__dock.focusedPanel()));
  }
  check(
    `${p} F2 (and the release chord in Output) cycles Main > Output > Memory > Stack > Hardware > Break Points > Log > Main in a moved arrangement`,
    same(cycle, ['output', 'memory', 'stack', 'hardware', 'breakpoints', 'log', 'listing']),
    JSON.stringify(cycle),
  );

  // Closing the focused panel moves the focus (P3.1.8): to the selected panel of its group, or,
  // when the group is gone, to the Registers panel.
  await page.evaluate(() => window.__dock.panels.focusPanel(window.__dock.ctx, 'hardware'));
  await settle(page);
  await page.locator('[id="flexlayout-tabbutton-simulator:hardware"]').focus();
  await page.keyboard.press('Delete');
  await settle(page);
  const afterClose = await page.evaluate(() => ({
    focused: window.__dock.focusedPanel(),
    shape: window.__dock.shape('simulator'),
  }));
  check(
    `${p} closing the focused Hardware panel: the focus goes to the selected panel of its group`,
    afterClose.focused !== null && afterClose.focused !== 'hardware' && !afterClose.shape.includes('hardware'),
    JSON.stringify(afterClose),
  );
  await page.evaluate(() => window.__dock.panels.focusPanel(window.__dock.ctx, 'stack'));
  await settle(page);
  await page.locator('[id="flexlayout-tabbutton-simulator:stack"]').focus();
  await page.keyboard.press('Delete');
  await settle(page);
  check(
    `${p} closing the focused Stack panel, alone in its group: the focus goes to the Registers panel`,
    (await page.evaluate(() => window.__dock.focusedPanel())) === 'registers',
    String(await page.evaluate(() => window.__dock.focusedPanel())),
  );
  await resetLayout(page);

  // Lock Layout: today's strips only, no drag; the check in the menu follows.
  const lockChecked = async () => {
    await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: 'View' }).click();
    const item = page.locator('[role=menu][data-e68-menu] [role=menuitemcheckbox]', { hasText: 'Lock Layout' }).first();
    const value = await item.getAttribute('aria-checked');
    await page.keyboard.press('Escape');
    return value;
  };
  const checkedLocked = await lockChecked();
  await setLocked(page, false);
  const checkedUnlocked = await lockChecked();
  await setLocked(page, true);
  check(
    `${p} View > Lock Layout is checked while locked and not while unlocked`,
    checkedLocked === 'true' && checkedUnlocked === 'false',
    `${checkedLocked} / ${checkedUnlocked}`,
  );
  const strips = await page.evaluate(
    () => document.querySelectorAll('[data-e68-dock="simulator"] .flexlayout__tabset_tabbar_outer').length,
  );
  const draggable = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-e68-dock="simulator"] .flexlayout__tab_button')).map((button) =>
      button.getAttribute('draggable'),
    ),
  );
  check(`${p} locked: only the tool group shows a strip`, strips === 1, `${strips} strips`);
  check(
    `${p} locked: tabs cannot be dragged (FlexLayout's model)`,
    await page.evaluate(() => {
      const model = window.__dock.engine('simulator').model;
      let any = false;
      model.visitNodes((node) => {
        if (node.getType() === 'tab' && node.isEnableDrag()) any = true;
      });
      return !any;
    }),
    JSON.stringify(draggable),
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- pass: drags ----------------------------------------------------------------------------------

/** Drags with the pointer from `from` to `to` (page coordinates); `before` runs while the pointer is over the target. */
async function dragPointer(page, from, to, before) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await sleep(120);
  await page.mouse.move(to.x + 1, to.y + 1, { steps: 2 });
  if (before) await before();
  await page.mouse.up();
  await settle(page);
}

const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function tabBox(page, workspaceMode, panel) {
  return page.locator(`[id="flexlayout-tabbutton-${workspaceMode}:${panel}"]`).boundingBox();
}
async function groupContentBox(page, workspaceMode, panel) {
  return page.evaluate(
    ([m, id]) => {
      const region = Array.from(document.querySelectorAll(`[data-e68-dock="${m}"] [data-e68-panel="${id}"]`)).find(
        (element) => element.checkVisibility(),
      );
      const holder = region?.closest('.flexlayout__tab');
      if (!holder) return null;
      const b = holder.getBoundingClientRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    },
    [workspaceMode, panel],
  );
}

async function dragsPass(browser, name) {
  const p = `${name}/drags:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  await setMode(page, 'simulator');
  await settle(page);
  await showPanels(page, ['memory', 'stack', 'log']);
  const shape = () => page.evaluate(() => window.__dock.shape('simulator'));
  const groupOfPanel = (panel) =>
    page.evaluate((id) => {
      const tree = window.__dock.engine('simulator').tree();
      const visit = (node) => (node.type === 'tabs' ? [node] : node.children.flatMap(visit));
      return visit(tree).find((group) => group.panels.includes(id))?.panels ?? [];
    }, panel);

  // Locked: a tab cannot be dragged.
  const before = await shape();
  let source = await tabBox(page, 'simulator', 'memory');
  let target = await groupContentBox(page, 'simulator', 'listing');
  await dragPointer(page, centre(source), centre(target));
  check(`${p} locked: dragging a tab moves nothing`, (await shape()) === before, await shape());

  await setLocked(page, false);
  const announcedText = () =>
    page.evaluate(() => document.querySelector('[data-e68-dock-live="simulator"]')?.textContent ?? '');

  // The five drop places of another group.
  const places = [
    [
      'the middle (into the group)',
      (b) => centre(b),
      (group) => group.includes('listing') && group.includes('memory'),
      'Memory moved into the group of Listing.',
    ],
    [
      'its left edge',
      (b) => ({ x: b.x + b.width * 0.08, y: b.y + b.height / 2 }),
      (group) => same(group, ['memory']),
      'Memory moved beside Listing, left.',
    ],
    [
      'its right edge',
      (b) => ({ x: b.x + b.width * 0.92, y: b.y + b.height / 2 }),
      (group) => same(group, ['memory']),
      'Memory moved beside Listing, right.',
    ],
    [
      'its top edge',
      (b) => ({ x: b.x + b.width / 2, y: b.y + b.height * 0.08 }),
      (group) => same(group, ['memory']),
      'Memory moved beside Listing, above.',
    ],
    [
      'its bottom edge',
      (b) => ({ x: b.x + b.width / 2, y: b.y + b.height * 0.92 }),
      (group) => same(group, ['memory']),
      'Memory moved beside Listing, below.',
    ],
  ];
  for (const [label, at, ok, words] of places) {
    await resetLayout(page);
    source = await tabBox(page, 'simulator', 'memory');
    target = await groupContentBox(page, 'simulator', 'listing');
    await dragPointer(page, centre(source), at(target));
    const group = await groupOfPanel('memory');
    const tree = await shape();
    const near =
      tree.includes('listing, memory') || tree.includes('memory, listing') || tree.includes('listing+memory');
    check(`${p} a tab dragged to ${label} of another group lands there`, ok(group) && near, `${tree}`);
    check(`${p} ...and the drop is announced`, (await announcedText()) === words, await announcedText());
  }
  await page.screenshot({ path: join(outDir, `${name}-simulator-dragged.png`) });

  // The four edges of the window.
  const edges = [
    [
      'left',
      (b) => ({ x: b.x + 4, y: b.y + b.height / 2 }),
      (tree) => tree.startsWith('row(memory,'),
      'Memory moved to the left edge of the window.',
    ],
    [
      'right',
      (b) => ({ x: b.x + b.width - 4, y: b.y + b.height / 2 }),
      (tree) => tree.endsWith(', memory)'),
      'Memory moved to the right edge of the window.',
    ],
    [
      'top',
      (b) => ({ x: b.x + b.width / 2, y: b.y + 4 }),
      (tree) => tree.startsWith('column(memory,'),
      'Memory moved to the top edge of the window.',
    ],
    [
      'bottom',
      (b) => ({ x: b.x + b.width / 2, y: b.y + b.height - 4 }),
      (tree) => tree.startsWith('column(') && tree.endsWith(', memory)'),
      'Memory moved to the bottom edge of the window.',
    ],
  ];
  for (const [side, at, ok, words] of edges) {
    await resetLayout(page);
    source = await tabBox(page, 'simulator', 'memory');
    const dock = await page.locator('[data-e68-dock="simulator"]').boundingBox();
    await dragPointer(page, centre(source), at(dock));
    const tree = await shape();
    check(`${p} a tab dragged to the ${side} edge of the window docks along it`, ok(tree), tree);
    check(`${p} ...announced`, (await announcedText()) === words, await announcedText());
  }

  // Output into a large group is a drop.
  await resetLayout(page);
  source = await tabBox(page, 'simulator', 'output');
  target = await groupContentBox(page, 'simulator', 'listing');
  await dragPointer(page, centre(source), centre(target));
  check(`${p} Output into a large group is a drop`, (await groupOfPanel('output')).includes('listing'), await shape());

  // Reorder by dragging along the strip.
  await resetLayout(page);
  const log = await tabBox(page, 'simulator', 'log');
  const memory = await tabBox(page, 'simulator', 'memory');
  await dragPointer(page, centre(log), { x: memory.x + 4, y: memory.y + memory.height / 2 });
  check(
    `${p} a tab dragged along its strip to the front changes the order`,
    same(await groupOfPanel('log'), ['log', 'memory', 'stack']),
    JSON.stringify(await groupOfPanel('log')),
  );
  check(
    `${p} ...announced`,
    (await announcedText()) === 'Log moved to position 1 of its group.',
    await announcedText(),
  );
  const stack = await tabBox(page, 'simulator', 'stack');
  const memoryNow = await tabBox(page, 'simulator', 'memory');
  await dragPointer(page, centre(memoryNow), { x: stack.x + stack.width * 0.8, y: stack.y + stack.height / 2 });
  check(
    `${p} ...and back along it`,
    same(await groupOfPanel('log'), ['log', 'stack', 'memory']),
    JSON.stringify(await groupOfPanel('log')),
  );

  // A drop of Output into a place smaller than 160 x 120 px is not offered (the Messages group is 99 px tall).
  await resetLayout(page);
  const smallShape = await shape();
  source = await tabBox(page, 'simulator', 'output');
  target = await groupContentBox(page, 'simulator', 'messages');
  let outline = null;
  await dragPointer(page, centre(source), centre(target), async () => {
    // Over the Messages group no outline is offered; give a slow engine time to drop the preview
    // it drew on the way there (WebKit lags a few dragover events).
    for (let i = 0; i < 15; i++) {
      outline = await page.evaluate(() => {
        const element = document.querySelector('[data-e68-dock="simulator"] .flexlayout__outline_rect');
        if (!element || !element.checkVisibility({ visibilityProperty: true })) return null;
        const b = element.getBoundingClientRect();
        return [b.left, b.top, b.width, b.height];
      });
      if (outline === null) break;
      await page.mouse.move(centre(target).x + (i % 2), centre(target).y);
      await sleep(100);
    }
  });
  check(
    `${p} Output over a group under 160 x 120 px: no drop offered, nothing moves`,
    outline === null && (await groupOfPanel('output')).length === 1 && (await shape()) === smallShape,
    `outline ${JSON.stringify(outline)}, ${await shape()}`,
  );

  // Esc cancels a drag: nothing moves, and FlexLayout ends its drag (no outline, no overlay). The
  // drag after an Escape is not checked: Playwright's emulated drag session does not always deliver
  // the next drag's dragenter after an emulated Escape (seen in both browsers on this PC).
  await resetLayout(page);
  const resetShape = await shape();
  source = await tabBox(page, 'simulator', 'memory');
  target = await groupContentBox(page, 'simulator', 'listing');
  await dragPointer(page, centre(source), centre(target), () => page.keyboard.press('Escape'));
  const afterEscape = await shape();
  const ended = await until(
    page,
    () =>
      document.querySelector('[data-e68-dock="simulator"] .flexlayout__outline_rect') === null &&
      !Array.from(document.querySelectorAll('[data-e68-dock="simulator"] .flexlayout__layout_overlay')).some(
        (element) => element.checkVisibility(),
      ),
    null,
    3000,
  );
  check(
    `${p} Esc cancels a drag (nothing moves; the drop preview is gone)`,
    afterEscape === resetShape && ended,
    `${afterEscape}, ended ${ended}`,
  );

  // The arrangement is stored; visibility unchanged by any of it.
  const layout = await page.evaluate(() => window.__dock.ctx.settings.get().app.layout);
  check(
    `${p} drags change no panel's visibility`,
    ['memory', 'stack', 'log'].every((id) => layout.panels[id]?.visible === true) &&
      layout.panels.hardware?.visible !== true,
    JSON.stringify(layout.panels),
  );
  await resetLayout(page);
  await setLocked(page, true);
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- pass: programs --------------------------------------------------------------------------------

/**
 * A stand-in for the browser's Fullscreen API where a headless browser has none (the same as
 * features/output/check-output.mjs): the calls, promises and `fullscreenchange` events.
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

/** The programs of this pass (68000 source lines for the real assembler). */
const PROGRAMS = {
  // TRAP #15 task 19 for ever: [vk] = 1 at $3100 + vk once a key went down; with `full`, it asks for
  // full screen first (task 33, D1.L = 2).
  keys: (full) => [
    '        ORG     $1000',
    ...(full ? ['START:  MOVEQ   #2,D1', '        MOVEQ   #33,D0', '        TRAP    #15'] : ['START:']),
    'LOOP:   MOVEQ   #0,D1',
    '        MOVEQ   #19,D0',
    '        TRAP    #15',
    '        MOVEQ   #0,D2',
    '        MOVE.B  D1,D2',
    '        LEA     DOWNS,A0',
    '        MOVE.B  #1,0(A0,D2.W)',
    '        BRA     LOOP',
    '        ORG     $3100',
    'DOWNS   DCB.B   256,0',
    '        END     START',
  ],
  // Reads the Hardware panel's switch byte ($E00012) into $3000 whenever $3002 is set by the check.
  switches: () => [
    '        ORG     $1000',
    'START:  TST.B   ASK',
    '        BEQ     START',
    '        MOVE.B  $E00012,RESULT',
    '        ADDQ.B  #1,READS',
    '        CLR.B   ASK',
    '        BRA     START',
    '        ORG     $3000',
    'RESULT  DC.B    $FF',
    'READS   DC.B    0',
    'ASK     DC.B    0',
    '        END     START',
  ],
  // Writes text for ever (TRAP #15 task 14).
  text: () => [
    '        ORG     $1000',
    'START:  LEA     MSG,A1',
    '        MOVEQ   #14,D0',
    '        TRAP    #15',
    '        BRA     START',
    "MSG     DC.B    'The quick brown fox jumps over the lazy dog. ',0",
    '        END     START',
  ],
};

async function installPrograms(page) {
  await page.evaluate(async (programs) => {
    const engine = await import('/src/engine/testing.ts');
    const { ctx } = window.__easy68k;
    let loads = 0;
    window.__programs = {
      async load(name, lines) {
        const { s68, l68 } = await engine.assembleProgram(lines);
        const path = `/browser/dock-check/${name}-${++loads}.S68`;
        await ctx.vfs.writeFile(path, s68);
        await ctx.vfs.writeFile(path.replace(/S68$/, 'L68'), l68);
        if (ctx.sim.controller.phase !== 'idle') ctx.sim.controller.pause();
        ctx.sim.controller.open(path, 'open').catch((error) => console.error('dock-check: the load failed', error));
        return path;
      },
      byte: (address) => ctx.sim.engine.readByte(address),
      poke: (address, bytes) => ctx.sim.controller.invoke((target) => target.writeBytes(address, bytes)),
      phase: () => ctx.sim.controller.phase,
    };
    void programs;
  }, null);
}

async function loadProgram(page, name, lines) {
  const path = await page.evaluate(([n, l]) => window.__programs.load(n, l), [name, lines]);
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

const running = (page) =>
  until(page, () => ['running', 'waitInput', 'waitDelay'].includes(window.__programs.phase()), null, 20_000);

/** The Output panel covers the window: elementFromPoint at the four corners and the centre. */
const coversWindow = (page) =>
  page.evaluate(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const points = [
      [2, 2],
      [w - 3, 2],
      [2, h - 3],
      [w - 3, h - 3],
      [w / 2, h / 2],
    ];
    const misses = points.filter(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-e68-panel="output"]') == null,
    );
    return misses.length === 0
      ? ''
      : JSON.stringify(misses.map(([x, y]) => [x, y, document.elementFromPoint(x, y)?.className]));
  });

const VK = {
  a: 0x41,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  Escape: 0x1b,
  Delete: 0x2e,
  ArrowLeft: 0x25,
  Tab: 0x09,
  F7: 0x76,
  O: 0x4f,
};
const downs = (page) =>
  page.evaluate(() => Array.from({ length: 256 }, (_, vk) => window.__programs.byte(0x3100 + vk)));

async function programPass(browser, name) {
  const p = `${name}/program:`;
  if (!enginesPresent) {
    note(`${name}: engine/dist is missing, the program checks did not run`);
    return;
  }
  const context = await newContext(browser);
  await context.addInitScript(fakeFullscreenApi);
  const { page, errors } = await openApp(context);
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase === 'idle', null, {
    timeout: LOAD_TIMEOUT,
  });
  await installPrograms(page);
  await settle(page);

  // From Editor mode, F4 and at once F9 on a program that reads keys and asks for full screen: the
  // Simulator dock lays its panels out on the first switch, the key typed reaches the program and
  // the full screen covers the window.
  const mountedBefore = await page.evaluate(
    () => document.querySelector('[data-e68-dock="simulator"] [data-e68-panel="output"]') !== null,
  );
  await loadProgram(page, 'keys-full', PROGRAMS.keys(true));
  check(
    `${p} before the first switch the Simulator dock has not mounted its panels`,
    !mountedBefore && (await mode(page)) === 'editor',
  );
  await page.keyboard.press('F4');
  await page.keyboard.press('F9');
  await running(page);
  await until(page, () => document.activeElement?.matches('[data-e68-keys="program"]') === true, null, 10_000);
  await page.keyboard.press('a');
  const reached = await until(page, (vk) => window.__programs.byte(0x3100 + vk) === 1, VK.a, 10_000);
  const full = await until(
    page,
    () => document.querySelector('.e68-output[data-fullscreen="true"]') !== null,
    null,
    10_000,
  );
  await settle(page);
  const covered = full ? await coversWindow(page) : 'no full screen';
  await page.screenshot({ path: join(outDir, `${name}-f4-f9-fullscreen.png`) });
  check(
    `${p} F4 and at once F9 from Editor mode: the key typed reaches the program`,
    reached,
    `focus in ${await page.evaluate(() => window.__dock.focusedPanel())}`,
  );
  check(`${p} ...and the program's full screen covers the window`, full && covered === '', covered);
  await page.keyboard.press('Alt+Enter');
  await until(page, () => document.querySelector('.e68-output[data-fullscreen="true"]') === null, null, 10_000);
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());
  await settle(page);

  // The full screen in three arrangements (Alt+Enter in the Output panel).
  await showPanels(page, ['memory', 'stack', 'log']);
  const arrangements = [
    ['default', async () => {}],
    [
      'Output a tab of the tool group',
      () => page.evaluate(() => window.__dock.controller().move('output', { kind: 'tab', near: 'memory' })),
    ],
    [
      'Output at the left edge',
      () => page.evaluate(() => window.__dock.controller().move('output', { kind: 'edge', side: 'left' })),
    ],
  ];
  await loadProgram(page, 'keys', PROGRAMS.keys(false));
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));
  await running(page);
  for (const [label, arrange] of arrangements) {
    await arrange();
    await settle(page);
    await page.evaluate(() => window.__dock.panels.focusPanel(window.__dock.ctx, 'output'));
    await until(page, () => document.activeElement?.matches('[data-e68-keys="program"]') === true, null, 5000);
    await page.keyboard.press('Alt+Enter');
    const entered = await until(
      page,
      () => document.querySelector('.e68-output[data-fullscreen="true"]') !== null,
      null,
      10_000,
    );
    await settle(page);
    const miss = entered ? await coversWindow(page) : 'no full screen';
    check(
      `${p} ${label}: the Output panel's full screen covers the window (elementFromPoint at the corners and the centre)`,
      entered && miss === '',
      miss,
    );
    await page.screenshot({ path: join(outDir, `${name}-fullscreen-${label.replace(/\W+/g, '-')}.png`) });
    await page.keyboard.press('Alt+Enter');
    await until(page, () => document.querySelector('.e68-output[data-fullscreen="true"]') === null, null, 10_000);
  }

  // A running program receives every key of main 2.9.4 rule 4 and none of rules 1-3, in two
  // arrangements; the layout does not change while it types.
  for (const [label, arrange] of [
    ['Output at the left edge', async () => {}],
    ['the default arrangement', () => resetLayout(page)],
  ]) {
    await arrange();
    await loadProgram(page, `keys-${label.length}`, PROGRAMS.keys(false));
    await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));
    await running(page);
    await page.evaluate(() => window.__dock.panels.focusPanel(window.__dock.ctx, 'output'));
    await until(page, () => document.activeElement?.matches('[data-e68-keys="program"]') === true, null, 5000);
    const before = await page.evaluate(() => ({
      shape: window.__dock.shape('simulator'),
      actions: window.__dock.controller().stats().actions.simulator,
      panels: JSON.stringify(window.__easy68k.ctx.settings.get().app.layout.panels),
    }));
    for (const key of ['a', 'F1', 'F2', 'F3', 'F4', 'F5', 'Escape', 'Shift+F2', 'Delete', 'ArrowLeft']) {
      await page.keyboard.press(key);
      await sleep(60);
    }
    for (const key of ['Tab', 'Shift+Tab', 'F7']) {
      await page.keyboard.press(key);
      await sleep(60);
    }
    await sleep(300);
    const seen = await downs(page);
    const after = await page.evaluate(() => ({
      shape: window.__dock.shape('simulator'),
      actions: window.__dock.controller().stats().actions.simulator,
      panels: JSON.stringify(window.__easy68k.ctx.settings.get().app.layout.panels),
      mode: window.__easy68k.ctx.store.getState().mode,
      focus: document.activeElement?.matches('[data-e68-keys="program"]') === true,
    }));
    const delivered = ['a', 'F1', 'F2', 'F3', 'F4', 'F5', 'Escape', 'Delete', 'ArrowLeft'].filter(
      (key) => seen[VK[key]] !== 1,
    );
    const withheld = ['Tab', 'F7'].filter((key) => seen[VK[key]] === 1);
    check(
      `${p} ${label}: every key of rule 4 reaches the program (F1-F5, Esc, Delete, the arrows, letters)`,
      delivered.length === 0,
      `missing ${delivered.join(', ')}`,
    );
    check(
      `${p} ${label}: Tab, Shift+Tab (rule 3) and F7 (rule 2) do not`,
      withheld.length === 0,
      `delivered ${withheld.join(', ')}`,
    );
    check(
      `${p} ${label}: the layout did not change while the program got the keys (no action, same tree, same visibility, still Simulator mode, the focus still in Output)`,
      after.shape === before.shape &&
        after.actions === before.actions &&
        after.panels === before.panels &&
        after.mode === 'simulator' &&
        after.focus,
      JSON.stringify({ before, after }),
    );
    // Rule 1: the release chord leaves the panel and reaches no program.
    await page.keyboard.press('Control+Alt+KeyO');
    await sleep(300);
    const released = await page.evaluate(() => ({
      focus: window.__dock.focusedPanel(),
      o: window.__programs.byte(0x3100 + 0x4f),
    }));
    check(
      `${p} ${label}: the release chord (rule 1) moves the focus on and is not delivered`,
      released.focus !== 'output' && released.o !== 1,
      JSON.stringify(released),
    );
    await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());
  }

  // While a program writes output continuously, the dock dispatches no action.
  await loadProgram(page, 'text', PROGRAMS.text());
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));
  await running(page);
  await sleep(500);
  const actions0 = await page.evaluate(() => window.__dock.controller().stats().actions.simulator);
  await sleep(2500);
  const actions1 = await page.evaluate(() => window.__dock.controller().stats().actions.simulator);
  const written = await page.evaluate(() => window.__easy68k.ctx.sim.controller.phase);
  check(
    `${p} while a program writes output continuously the dock dispatches no action`,
    actions0 === actions1 && written === 'running',
    `${actions0} -> ${actions1} (${written})`,
  );
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());

  // The Hardware panel's switch byte: closing it three ways and showing it again zeroes it (that
  // is the panel's "shown" effect, P1.1 rule 4); moving it and Reset Layout do not.
  await loadProgram(page, 'switches', PROGRAMS.switches());
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));
  await running(page);
  const readSwitches = async () => {
    const reads = await page.evaluate(() => window.__programs.byte(0x3001));
    await page.evaluate(() => window.__programs.poke(0x3002, [1]));
    await until(page, (n) => window.__programs.byte(0x3001) === ((n + 1) & 0xff), reads, 10_000);
    return page.evaluate(() => window.__programs.byte(0x3000));
  };
  // Switch 3 on (a real click; a switch shown on already is clicked twice).
  const setSwitch = async () => {
    for (let i = 0; i < 2; i++) {
      if ((await page.evaluate(() => window.__programs.byte(0xe00012) & 0x08)) !== 0) return;
      await page.locator('[data-e68-workspace="simulator"] [data-switch="3"]').click();
      if (await until(page, () => (window.__programs.byte(0xe00012) & 0x08) !== 0, null, 3000)) return;
    }
  };
  const viewHardware = async () => {
    await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: 'View' }).click();
    await page
      .locator('[role=menu][data-e68-menu] [role^=menuitem]', { hasText: /^Hardware/ })
      .first()
      .click();
    await settle(page);
  };
  await showPanels(page, ['hardware'], true);
  const results = [];
  for (const [how, close] of [
    [
      'its x',
      async () =>
        page.locator('[id="flexlayout-tabbutton-simulator:hardware"] .flexlayout__tab_button_trailing').click(),
    ],
    [
      'Delete on its tab',
      async () => {
        await page.locator('[id="flexlayout-tabbutton-simulator:hardware"]').focus();
        await page.keyboard.press('Delete');
      },
    ],
    ['the tab menu', async () => tabMenu(page, 'simulator', 'hardware', 'Close')],
  ]) {
    await setSwitch();
    const set = await readSwitches();
    await close();
    await settle(page);
    const hidden = await page.evaluate(
      () => window.__easy68k.ctx.settings.get().app.layout.panels.hardware?.visible === false,
    );
    await viewHardware();
    const read = await readSwitches();
    results.push(`${how}: set ${set.toString(16)}, hidden ${hidden}, after View > Hardware ${read.toString(16)}`);
    check(
      `${p} close Hardware with ${how}, then View > Hardware: the program reads the switch byte $00`,
      set === 0x08 && hidden && read === 0,
      results[results.length - 1],
    );
  }
  await setSwitch();
  await page.evaluate(() =>
    window.__dock.controller().move('hardware', { kind: 'beside', near: 'listing', side: 'right' }),
  );
  await settle(page);
  const afterMove = await readSwitches();
  check(`${p} moving the Hardware panel does not zero the switch byte`, afterMove === 0x08, afterMove.toString(16));
  await resetLayout(page);
  const afterReset = await readSwitches();
  check(`${p} Reset Layout leaves the switch byte as it was`, afterReset === 0x08, afterReset.toString(16));
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.pause());

  // Mounts: every panel's content mounted once, also across moves, tab switches, mode switches and
  // the Output panel collapsed and expanded (a mount counter of development builds).
  const counted = ['registers', 'listing', 'messages', 'output', 'memory', 'stack', 'log'];
  const mounts0 = await page.evaluate(() => window.__dock.controller().stats().mounts);
  await page.evaluate(() => {
    const dock = window.__dock.controller();
    dock.setLocked(false);
    dock.move('stack', { kind: 'edge', side: 'top' });
    dock.move('output', { kind: 'tab', near: 'listing' });
    dock.move('memory', { kind: 'beside', near: 'registers', side: 'right' });
  });
  await settle(page);
  for (const tab of ['Memory', 'Log', 'Output', 'Listing']) {
    const button = page.locator('[data-e68-workspace="simulator"] [role=tab]', { hasText: tab }).first();
    if ((await button.count()) > 0) await button.click();
  }
  await setMode(page, 'editor');
  await settle(page);
  await setMode(page, 'simulator');
  await resetLayout(page);
  await hidePanels(page, ['output']);
  await showPanels(page, ['output']);
  await setLocked(page, true);
  const mounts1 = await page.evaluate(() => window.__dock.controller().stats().mounts);
  const once = counted.filter((id) => mounts1[`simulator:${id}`] !== 1);
  check(
    `${p} every panel's content was mounted once, and moves, tab switches, mode switches, Reset Layout, Lock Layout and collapsing Output mounted none again`,
    once.length === 0 && counted.every((id) => mounts0[`simulator:${id}`] === mounts1[`simulator:${id}`]),
    JSON.stringify({ mounts0, mounts1 }),
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- pass: the editor's message list and the Registers group ----------------------------------------

const messagesHeight = (page) =>
  page.evaluate(() => {
    const region = document.querySelector('[data-e68-dock="editor"] [data-e68-panel="messages"]');
    return region ? Math.round(region.getBoundingClientRect().height * 10) / 10 : -1;
  });

/** Sets the active document's message list and assembly summary, as an assembly does (the store). */
function setMessages(page, count, assembled) {
  return page.evaluate(
    ([n, done]) => {
      const { ctx } = window.__easy68k;
      ctx.store.setState((state) => {
        const id = state.documents.activeId;
        const messages = { ...state.messages };
        const assemble = { ...state.assemble };
        if (n === null) delete messages[id];
        else
          messages[id] = Array.from({ length: n }, (_, i) => ({
            file: null,
            line: i + 1,
            text: `ERROR: test ${i}`,
            severity: 'error',
          }));
        if (done) assemble[id] = { errors: n ?? 0, warnings: 0, hasSRecord: false, hasListing: false, at: Date.now() };
        else delete assemble[id];
        return { ...state, messages, assemble };
      });
    },
    [count, assembled],
  );
}

async function editorPass(browser, name) {
  const p = `${name}/editor:`;
  const context = await newContext(browser);
  const { page, errors } = await openApp(context);
  await settle(page);
  const heights = [await messagesHeight(page)];
  await setMessages(page, 3, true);
  await settle(page);
  heights.push(await messagesHeight(page));
  await setMessages(page, 0, true);
  await settle(page);
  heights.push(await messagesHeight(page));
  check(
    `${p} the editor's message list is 5 px, then 87 px with messages, then 7 px after a clean assembly`,
    same(heights, [5, 87, 7]),
    JSON.stringify(heights),
  );

  // A drag of the splitter above it overrides the rule until the list changes; never stored.
  await setMessages(page, 2, true);
  await settle(page);
  const splitter = page.locator('[data-e68-dock="editor"] [role=separator][aria-label="Resize the Messages panel"]');
  await splitter.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  await settle(page);
  const dragged = await messagesHeight(page);
  const box = await splitter.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  const pointer = await messagesHeight(page);
  const stored = await page.evaluate(() => JSON.stringify(window.__easy68k.ctx.settings.get().app.layout));
  await setMessages(page, 4, true);
  await settle(page);
  const changed = await messagesHeight(page);
  check(
    `${p} a drag of the splitter above it (keys, then the pointer) overrides the rule until the list changes, and is never stored`,
    Math.abs(dragged - 137) <= 1 &&
      pointer > dragged + 40 &&
      Math.abs(changed - 87) <= 1 &&
      !stored.includes('"dock"') &&
      !stored.includes('messages":'),
    `rule 87, keys ${dragged}, pointer ${pointer}, list changed ${changed}`,
  );

  // The Registers group follows the panel's content height after a font change.
  await setMode(page, 'simulator');
  await settle(page);
  const measure = () =>
    page.evaluate(() => {
      const registers = document
        .querySelector('[data-e68-dock="simulator"] [data-e68-panel="registers"]')
        .getBoundingClientRect();
      const listing = document
        .querySelector('[data-e68-dock="simulator"] [data-e68-panel="listing"]')
        .getBoundingClientRect();
      const content = document.querySelector('[data-e68-dock="simulator"] [data-e68-panel="registers"]').scrollHeight;
      return {
        height: Math.round(registers.height * 10) / 10,
        content,
        listingTop: Math.round(listing.top * 10) / 10,
        bottom: Math.round(registers.bottom * 10) / 10,
      };
    });
  const small = await measure();
  await page.addStyleTag({
    content: '[data-e68-panel="registers"] * { font-size: 17px !important; line-height: 1.6 !important; }',
  });
  await settle(page);
  await settle(page);
  const large = await measure();
  check(
    `${p} after a font change the Registers group follows its content (taller, the Listing directly below it)`,
    large.height > small.height + 10 &&
      Math.abs(large.listingTop - (large.bottom + 1)) <= 1 &&
      large.content <= large.height + 1,
    `${JSON.stringify(small)} -> ${JSON.stringify(large)}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-registers-font.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- pass: accessibility scan ------------------------------------------------------------------------

async function scan(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious or critical finding`, serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

async function scanPass(browser, name) {
  const p = `${name}/scan:`;
  for (const themeName of ['light', 'dark']) {
    const context = await newContext(browser);
    const { page, errors } = await openApp(context);
    await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), themeName);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, themeName);
    for (const locked of [true, false]) {
      await setLocked(page, locked);
      for (const item of ['editor', 'simulator']) {
        await setMode(page, item);
        await settle(page);
        if (item === 'simulator') await showPanels(page, ['memory', 'log']);
        const label = `${name} ${themeName} ${item} ${locked ? 'locked' : 'unlocked'}`;
        await scan(page, label);
        await page.screenshot({
          path: join(outDir, `${name}-${themeName}-${item}-${locked ? 'locked' : 'unlocked'}.png`),
        });
      }
    }
    await setMode(page, 'easybin');
    await scan(page, `${name} ${themeName} easybin`);
    check(`${p} ${themeName}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
}

// --- pass: few display frames ------------------------------------------------------------------------

/** Delivers animation frames 130 ms late, as GitHub's macOS runners do at times (longest gaps of 133 ms). */
function slowFrames() {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => setTimeout(() => raf(callback), 130);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
}

/**
 * A View menu command focuses its panel when the panel is on screen, not one frame later: on a
 * runner with few frames the panel was there for a frame without the focus, and check-memory-stack
 * read `null` and `TEXTAREA` on macOS (run 45020779731). The focus is read as soon as the panel's
 * content is in the page, once with today's frames and once with frames 130 ms late.
 */
async function framesPass(browser, name) {
  const p = `${name}/frames:`;
  for (const slow of [false, true]) {
    const context = await newContext(browser);
    if (slow) await context.addInitScript(slowFrames);
    const { page, errors } = await openApp(context);
    await setMode(page, 'simulator');
    await settle(page);
    const cases = [
      ['sim.view.memory', 'memory'],
      ['sim.view.stack', 'stack'],
      ['sim.view.log', 'log'],
    ];
    for (const [command, panel] of cases) {
      const seen = await page.evaluate(
        async ([id, region]) => {
          const describe = (el) =>
            !el || el === document.body
              ? String(el?.tagName ?? null)
              : `${el.tagName}[${el.getAttribute('aria-label') ?? ''}] in ${el.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? '-'}`;
          // The first moment the panel's content is in the page: a mutation observer, which runs
          // before any later task (a check's poll, a frame) could look.
          const first = new Promise((done) => {
            const look = () => {
              const content = document.querySelector(
                `[data-e68-workspace="simulator"] [data-e68-panel="${region}"] [data-e68-panel-focus], [data-e68-workspace="simulator"] [data-e68-panel="${region}"] select`,
              );
              if (content && content.checkVisibility?.() !== false) {
                observer.disconnect();
                // The task that rendered the panel has ended: whatever a check reads now.
                setTimeout(() => done(describe(document.activeElement)), 0);
                return true;
              }
              return false;
            };
            const observer = new MutationObserver(look);
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          });
          void window.__easy68k.ctx.commands.run(id);
          return first;
        },
        [command, panel],
      );
      const ok =
        panel === 'memory'
          ? seen.startsWith('INPUT[Address]')
          : panel === 'stack'
            ? seen.startsWith('SELECT')
            : seen.endsWith(' in log');
      check(
        `${p} ${slow ? 'frames 130 ms late' : "today's frames"}: View > ${panel} has focused its panel when the panel appears`,
        ok,
        seen,
      );
      await hidePanels(page, [panel]);
    }
    check(
      `${p} ${slow ? 'frames 130 ms late' : "today's frames"}: no console or page errors`,
      errors.length === 0,
      errors.slice(0, 3).join(' | '),
    );
    await context.close();
  }
}

// --- pass: today's Tab order and reading order with Lock Layout on --------------------------------

// The Tab order of main (b247e17, the faithful port without the dock), recorded in Chromium and
// WebKit with fresh storage, the Windows key map and Lock Layout's default (the two browsers gave
// the same list; c:\easy64k\build\tab-plus\probe.mjs). Each entry is `role|name|panel` of the
// focused element ('-' outside the panels); a leading `~` marks an element that is not a tab stop
// of Safari on a Mac (a button or a check box without an explicit tabindex; tests/a11y isSafariTabStop),
// which a browser that does not stop at buttons skips. Every list is the whole order: a walk with
// Tab goes through it from the start of the page until the body or the Output panel's key field
// (which keeps Tab for the running program), a walk with Shift+Tab from the end of the page back.
// In the editor the walk presses Esc first, as a keyboard user does (the editor keeps Tab).
const REGISTER_INPUTS = Array(19).fill('input||registers');
const OUTPUT_KEYS = 'textarea|Keyboard of the running program. Ctrl+Alt+O moves to the next panel.|output';
const MEMORY_PANEL = [
  'input|Address|memory',
  'input|From|memory',
  'input|To|memory',
  'input|Bytes|memory',
  '~button|Copy|memory',
  '~button|Fill|memory',
  '~button|Save|memory',
  'group|Memory contents|memory',
  '~button|Row up|memory',
  '~button|Row down|memory',
  '~button|Page up|memory',
  '~button|Page down|memory',
  '~input|Live|memory',
];
const SIM_LEFT = [
  'menuitem|File|-',
  'radio|Simulator|-',
  'button|Open (Ctrl+O)|-',
  ...REGISTER_INPUTS,
  '~button|Clear Cycles|registers',
  'input||registers',
  'listbox|Listing|listing',
  'separator|Resize the Messages panel|-',
  'list|Messages|messages',
  'separator|Resize the two columns|-',
];
const MAIN_TAB_ORDER = {
  editor: [
    'menuitem|File|-',
    'radio|Editor|-',
    'button|Files|-',
    'button|New Folder...|files',
    'tree|Files|files',
    // The stage's own addition to the Files panel (P3.2, N5): its storage line.
    '~button|This site uses *|files',
    'separator|Resize the Files panel|-',
    'tab|untitled1.x68|editor',
    'textbox|untitled1.x68|editor',
    'separator|Resize the Messages panel|-',
    'grid|Assembler messages|messages',
  ],
  'simulator wide': [
    ...SIM_LEFT,
    'select|Fit100%200%|output',
    '~button|Full Screen (Alt+Enter)|output',
    '~button|Collapse the Output panel|output',
    'region|Output picture|output',
    OUTPUT_KEYS,
  ],
  'simulator wide, Memory shown': [
    ...SIM_LEFT,
    'select|Fit100%200%|output',
    '~button|Full Screen (Alt+Enter)|output',
    '~button|Collapse the Output panel|output',
    'region|Output picture|output',
    OUTPUT_KEYS,
    'separator|Resize the tool panels|-',
    'tab|Memory|-',
    ...MEMORY_PANEL,
  ],
  'simulator narrow': [
    ...SIM_LEFT,
    'tab|Output|-',
    'select|Fit100%200%|output',
    '~button|Full Screen (Alt+Enter)|output',
    'region|Output picture|output',
    OUTPUT_KEYS,
  ],
  'simulator narrow, Memory shown': [...SIM_LEFT, 'tab|Memory|-', ...MEMORY_PANEL],
  easybin: [
    'menuitem|File|-',
    'radio|EASyBIN|-',
    'button|Theme|-',
    'input|Start Address|easybin',
    '~button|Open S-Record...|easybin',
    '~input||easybin',
    'input|First Address|easybin',
    'input|Length of the binary files|easybin',
    '~button|Save Binary...|easybin',
    'input|From|easybin',
    'input|To|easybin',
    'input|Size|easybin',
    '~button|Copy|easybin',
    'input|Fill byte|easybin',
    '~button|Fill|easybin',
    'input|Address|easybin',
    'group|Memory|easybin',
    '~button|Row up|easybin',
    '~button|Row down|easybin',
    '~button|Page up|easybin',
    '~button|Page down|easybin',
  ],
};

// The reading order of main in Chromium's accessibility tree (CDP Accessibility.getFullAXTree) for
// the dock's parts: named separators, tab lists, tabs, tab panels, regions and the panels' main
// controls. The dock's tab panels hold the panel's PanelRegion, which keeps its own name inside
// (P3.1.8): a region right after a tab panel of the same name is that, and is not counted.
const SIM_LEFT_READ = [
  'region|Registers',
  'region|Listing',
  'listbox|Listing',
  'separator|Resize the Messages panel',
  'region|Messages',
  'list|Messages',
  'log|',
  'separator|Resize the two columns',
];
const MAIN_READING_ORDER = {
  editor: [
    'region|Files',
    'tree|Files',
    'separator|Resize the Files panel',
    'region|Editor',
    'tablist|Documents',
    'tab|untitled1.x68',
    'tabpanel|untitled1.x68',
    'separator|Resize the Messages panel',
    'region|Messages',
    'grid|Assembler messages',
    'log|',
    'region|Notifications',
  ],
  'simulator wide': [
    ...SIM_LEFT_READ,
    'region|Output',
    'region|Output picture',
    'log|Text of the Output panel',
    'region|Notifications',
  ],
  'simulator wide, Memory shown': [
    ...SIM_LEFT_READ,
    'region|Output',
    'region|Output picture',
    'log|Text of the Output panel',
    'separator|Resize the tool panels',
    'tablist|Tool panels',
    'tab|Memory',
    'tabpanel|Memory',
    'region|Notifications',
  ],
  'simulator narrow': [
    ...SIM_LEFT_READ,
    'tablist|Tool panels',
    'tab|Output',
    'tabpanel|Output',
    'region|Output picture',
    'log|Text of the Output panel',
    'region|Notifications',
  ],
  'simulator narrow, Memory shown': [
    ...SIM_LEFT_READ,
    'tablist|Tool panels',
    'tab|Output',
    'tab|Memory',
    'tabpanel|Memory',
    'region|Notifications',
  ],
  easybin: ['region|EASyBIN', 'region|Notifications'],
};

/** The focused element as `role|name|panel` (the entries of MAIN_TAB_ORDER). */
function focusEntry() {
  const e = document.activeElement;
  if (!e || e === document.body) return { entry: 'body', editor: false };
  const role = e.getAttribute('role') ?? e.tagName.toLowerCase();
  let name = e.getAttribute('aria-label');
  if (!name && e.getAttribute('aria-labelledby')) {
    name = e
      .getAttribute('aria-labelledby')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
  }
  if (!name) name = e.getAttribute('title') ?? (e.textContent ?? '').trim().slice(0, 24);
  const panel = e.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? '-';
  return { entry: `${role}|${name}|${panel}`, editor: e.isContentEditable === true };
}

const entryMatches = (expected, actual) => {
  const want = expected.replace(/^~/, '');
  if (!want.includes('*')) return want === actual;
  const [head, tail] = want.split('*');
  return actual.startsWith(head) && actual.endsWith(tail);
};

/**
 * Tab (or Shift+Tab) from the start (the end) of the page; the focused elements in order, up to
 * the body, the Output panel's key field or `until`.
 */
async function walkTabs(page, backward, until = null, beforeKeys = false) {
  await page.evaluate(
    ({ atEnd, beforeKeys }) => {
      // The sequential navigation starts where this element is (the page's start or end, or just
      // before the Output panel's key field, which keeps Tab and Shift+Tab for the running program).
      const mark = document.createElement('span');
      mark.tabIndex = -1;
      mark.setAttribute('data-e68-walk-mark', '');
      const keys = beforeKeys ? document.querySelector('[data-e68-panel="output"] textarea') : null;
      if (keys) keys.before(mark);
      else if (atEnd) document.body.append(mark);
      else document.body.prepend(mark);
      mark.focus();
      if (!keys) mark.remove();
    },
    { atEnd: backward, beforeKeys },
  );
  const seen = [];
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press(backward ? 'Shift+Tab' : 'Tab');
    if (i === 0) await page.evaluate(() => document.querySelector('[data-e68-walk-mark]')?.remove());
    const focus = await page.evaluate(focusEntry);
    seen.push(focus.entry);
    if (focus.entry === 'body' || focus.entry.startsWith('textarea|') || focus.entry === until) break;
    if (focus.editor) await page.keyboard.press('Escape');
  }
  return seen;
}

/** The walk a list predicts: up to the body or the Output panel's key field. */
function predictedWalk(list, backward, buttonsStop) {
  const stops = list.filter((entry) => buttonsStop || !entry.startsWith('~'));
  const ordered = backward ? [...stops].reverse() : stops;
  const keys = ordered.findIndex((entry) => entry.startsWith('textarea|'));
  return keys >= 0 ? ordered.slice(0, keys + 1) : [...ordered, 'body'];
}

function compareWalk(label, expected, actual) {
  const ok = expected.length === actual.length && expected.every((entry, i) => entryMatches(entry, actual[i]));
  let detail = `${actual.length} stops`;
  if (!ok) {
    const at = expected.findIndex((entry, i) => !entryMatches(entry, actual[i] ?? ''));
    const from = Math.max(0, at - 2);
    detail = `differs at ${at}: expected ${JSON.stringify(expected.slice(from, at + 4).map((e) => e.replace(/^~/, '')))}, got ${JSON.stringify(actual.slice(from, at + 4))}`;
  }
  check(label, ok, detail);
}

/** Chromium only: the dock's part of the accessibility tree in reading order. */
async function readingOrderOf(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const roles = new Set(['tab', 'tablist', 'region', 'tabpanel', 'tree', 'grid', 'listbox', 'list', 'log']);
    const out = [];
    const visit = (node) => {
      const role = node.role?.value;
      const name = node.name?.value ?? '';
      if (!node.ignored && (roles.has(role) || (role === 'separator' && name !== ''))) {
        const entry = `${role}|${name}`;
        // The PanelRegion inside a dock tab panel of the same name (P3.1.8).
        if (!(role === 'region' && out[out.length - 1] === `tabpanel|${name}`)) out.push(entry);
      }
      for (const child of node.childIds ?? []) {
        const next = byId.get(child);
        if (next) visit(next);
      }
    };
    if (nodes[0]) visit(nodes[0]);
    return out;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Whether Tab stops at a plain button here (Safari on a Mac does not; Playwright's WebKit elsewhere does). */
async function buttonsAreTabStops(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<input id="a"><button id="b">b</button><input id="c">');
    await page.focus('#a');
    await page.keyboard.press('Tab');
    return (await page.evaluate(() => document.activeElement?.id)) === 'b';
  } finally {
    await context.close();
  }
}

/**
 * P1.2 and P3.1.8, the gate's major finding: with Lock Layout on (the default), Tab and the reading
 * order go through the window exactly as on main, in the three modes, wide and narrow; Shift+Tab
 * the same backwards. The splitters and the shown strips are reached through their slots (order.ts,
 * errata N1 25). Unlocked, FlexLayout's own elements are tab stops again and no slot is left; locked
 * again, today's order is back.
 */
async function tabOrderPass(browser, name) {
  const p = `${name}/taborder:`;
  const buttonsStop = await buttonsAreTabStops(browser);
  note(`${name}: Tab ${buttonsStop ? 'stops' : 'does not stop'} at plain buttons in this browser`);
  const cases = [
    { label: 'editor', mode: 'editor', viewport: VIEWPORT },
    { label: 'editor', mode: 'editor', viewport: { width: 1000, height: 800 }, narrow: true },
    { label: 'simulator wide', mode: 'simulator', viewport: VIEWPORT },
    { label: 'simulator wide, Memory shown', mode: 'simulator', viewport: VIEWPORT, memory: true },
    { label: 'simulator narrow', mode: 'simulator', viewport: { width: 1000, height: 800 } },
    {
      label: 'simulator narrow, Memory shown',
      mode: 'simulator',
      viewport: { width: 1000, height: 800 },
      memory: true,
    },
    { label: 'easybin', mode: 'easybin', viewport: VIEWPORT },
    { label: 'easybin', mode: 'easybin', viewport: { width: 1000, height: 800 }, narrow: true },
  ];
  for (const item of cases) {
    const tag = `${p} ${item.label}${item.narrow ? ' (1000 px)' : ''}`;
    const context = await newContext(browser, 'windows', item.viewport);
    const { page, errors } = await openApp(context);
    try {
      const locked = await page.evaluate(() => window.__dock.controller().locked());
      check(`${tag}: Lock Layout is on by default`, locked === true);
      if (item.mode !== 'editor') await setMode(page, item.mode);
      await settle(page);
      if (item.memory) {
        await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.memory'));
        await settle(page);
      }
      const list = MAIN_TAB_ORDER[item.label];
      for (const backward of [false, true]) {
        const walk = await walkTabs(page, backward);
        compareWalk(
          `${tag}: ${backward ? 'Shift+Tab' : 'Tab'} goes through the window as on main`,
          predictedWalk(list, backward, buttonsStop),
          walk,
        );
      }
      // The key field ends a walk (it keeps Tab and Shift+Tab), so a Shift+Tab walk from the end
      // of a page that shows it covers only what follows it: a second walk goes back from just
      // before the key field to the start of the page.
      const keysAt = list.findIndex((entry) => entry.startsWith('textarea|'));
      if (keysAt > 0) {
        const walk = await walkTabs(page, true, null, true);
        compareWalk(
          `${tag}: Shift+Tab from the Output panel's key field back to the start goes as on main`,
          predictedWalk(list.slice(0, keysAt), true, buttonsStop),
          walk,
        );
      }
      if (name === 'chromium') {
        const read = await readingOrderOf(page);
        const want = MAIN_READING_ORDER[item.label];
        check(
          `${tag}: the reading order (accessibility tree) is main's`,
          same(read, want),
          same(read, want) ? '' : `expected ${JSON.stringify(want)}, got ${JSON.stringify(read)}`,
        );
      }
      // Each selected tab names its tab panel (aria-controls), which is labelled by the tab: the
      // tabpanel role moved to the content's wrapper while locked (errata N1 25), so must the name.
      const tabs = await page.evaluate(() =>
        [...document.querySelectorAll('[data-e68-workspace] [role="tab"][aria-selected="true"]')]
          .filter((tab) => tab.checkVisibility())
          .map((tab) => {
            const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
            return {
              tab: tab.textContent.trim(),
              role: panel?.getAttribute('role') ?? null,
              labelled: panel?.getAttribute('aria-labelledby') === tab.id,
            };
          }),
      );
      check(
        `${tag}: each selected tab controls its tab panel, which the tab labels`,
        // Editor mode has its documents' strip; the simulator a strip with a tool panel or narrow.
        (item.mode === 'editor' || (item.mode === 'simulator' && (item.memory || item.label.includes('narrow')))
          ? tabs.length > 0
          : true) && tabs.every((tab) => tab.role === 'tabpanel' && tab.labelled),
        JSON.stringify(tabs),
      );
      // The focus ring of a splitter or a tab reached through its slot is drawn on it, where it is.
      const shot = { editor: 'separator|Resize the Files panel|-', 'simulator narrow, Memory shown': 'tab|Memory|-' };
      if (shot[item.label] && !item.narrow) {
        const reached = await walkTabs(page, false, shot[item.label]);
        const ring = await page.evaluate(() => {
          const e = document.activeElement;
          return e ? getComputedStyle(e).outlineStyle : 'none';
        });
        check(
          `${tag}: ${shot[item.label].split('|')[0]} reached by Tab shows its focus ring`,
          reached[reached.length - 1] === shot[item.label] && ring !== 'none',
          `outline ${ring}`,
        );
        await page.screenshot({ path: join(outDir, `${name}-taborder-${item.mode}-focus.png`) });
      }
      if (item.label === 'simulator wide, Memory shown') {
        // Unlocked: FlexLayout's splitters and tabs are tab stops of their own, no slot is left.
        await setLocked(page, false);
        const unlocked = await page.evaluate(() => {
          const ws = document.querySelector('[data-e68-workspace="simulator"]');
          return {
            slots: ws.querySelectorAll('[data-e68-dock-slot]').length,
            relocated: ws.querySelectorAll('[data-e68-relocated]').length,
            splitters: [...ws.querySelectorAll('.flexlayout__splitter[role="separator"]')].map((s) => s.tabIndex),
            tabs: [...ws.querySelectorAll('.flexlayout__tab_button[aria-selected="true"]')].map((t) => t.tabIndex),
          };
        });
        check(
          `${tag}: unlocked, no slot is left and the splitters and selected tabs are tab stops`,
          unlocked.slots === 0 &&
            unlocked.relocated === 0 &&
            unlocked.splitters.length > 0 &&
            unlocked.splitters.every((t) => t === 0) &&
            unlocked.tabs.length > 0 &&
            unlocked.tabs.every((t) => t === 0),
          JSON.stringify(unlocked),
        );
        await setLocked(page, true);
        const again = await walkTabs(page, true);
        compareWalk(
          `${tag}: locked again, Shift+Tab goes through the window as on main`,
          predictedWalk(list, true, buttonsStop),
          again,
        );
        // The keys of a splitter reached through its slot are the splitter's own (P3.1.1).
        const moved = await page.evaluate(async () => {
          const ws = document.querySelector('[data-e68-workspace="simulator"]');
          const splitter = [...ws.querySelectorAll('.flexlayout__splitter[role="separator"]')].find(
            (s) => s.getAttribute('aria-label') === 'Resize the tool panels',
          );
          return splitter ? splitter.getBoundingClientRect().top : null;
        });
        const back = await walkTabs(page, true, 'separator|Resize the tool panels|-');
        const onSplitter = back[back.length - 1] === 'separator|Resize the tool panels|-';
        await page.keyboard.press('ArrowDown');
        await settle(page);
        const after = await page.evaluate(() => {
          const ws = document.querySelector('[data-e68-workspace="simulator"]');
          const splitter = [...ws.querySelectorAll('.flexlayout__splitter[role="separator"]')].find(
            (s) => s.getAttribute('aria-label') === 'Resize the tool panels',
          );
          return splitter ? splitter.getBoundingClientRect().top : null;
        });
        check(
          `${tag}: the splitter reached with Shift+Tab moves with Down`,
          onSplitter && moved !== null && after !== null && after > moved,
          `on splitter ${onSplitter}, top ${moved} -> ${after}`,
        );
      }
      check(`${tag}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally {
      await context.close();
    }
  }
}

// --- run -----------------------------------------------------------------------------------------

const PASSES = {
  boxes: (browser, name) => boxesPass(browser, name),
  'moves:windows': (browser, name) => movesPass(browser, name, 'windows'),
  'moves:mac': (browser, name) => movesPass(browser, name, 'mac'),
  drags: (browser, name) => dragsPass(browser, name),
  program: (browser, name) => programPass(browser, name),
  editor: (browser, name) => editorPass(browser, name),
  frames: (browser, name) => framesPass(browser, name),
  taborder: (browser, name) => tabOrderPass(browser, name),
  scan: (browser, name) => scanPass(browser, name),
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
        for (const [label, run] of Object.entries(PASSES)) {
          if (only.length > 0 && !only.includes(label.split(':')[0])) continue;
          console.log(`\n[${name}, ${label}]`);
          try {
            await run(browser, name);
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
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  if (notes.length > 0) console.log(`\nNotes (not failures):\n${notes.map((text) => `  - ${text}`).join('\n')}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
