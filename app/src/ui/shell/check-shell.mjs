// Browser check of the application shell (ARCHITECTURE.md 9.1, W3 acceptance). Owner: W3.
// The workspaces of Editor and Simulator mode are docks since ARCHITECTURE-PLUS (N1): the checks
// that located today's regions, columns and separators find them in the dock with the same meaning
// (ui/dock/check-dock.mjs checks the dock itself).
//
//   node app/src/ui/shell/check-shell.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright), once with the Windows key map and once with the macOS key map
// (the page is told it runs on a Mac before it starts). It checks what unit tests under Node
// cannot show:
//
//   - the application starts with the real features and shows three modes, without console errors;
//   - the menus and toolbars on screen equal the command tables exactly (captions, access keys,
//     shortcuts, separators, check marks); a command without a handler is disabled; a command with
//     a handler is enabled exactly when its handler says so, also after the handler's answer
//     changes. The commands of the tables that have no handler yet are listed (a note here; the
//     unit test bootstrap.test.ts fails for every one not in its list of owed handlers, gate I2);
//   - the dispatcher cancels the chords of 2.9.3 (`defaultPrevented` on real key events), with the
//     real handlers held back (`commands.observeRuns`) so that no real dialog opens;
//   - key and code pairs of other keyboards (Option chords such as key 'ø' with code 'KeyO', a
//     QWERTZ, an AZERTY and a Russian layout, Insert on the numeric keypad) run the right
//     commands; on Windows Ctrl+Alt+letter follows the key's label; Insert and Ctrl+Shift+. / ,
//     run in the editor and are left to a plain text field, with stand-in handlers and with the
//     real editor's; Ctrl+F4 is left to the browser on Windows and is Log Start on macOS. Where a
//     key must reach a command whatever its real handler says right now, the check puts a
//     recorder in its place for the time of the test (`commands.override`) and restores it;
//   - rule K2 in plain text fields: on the macOS key map Ctrl+A, C, X, Z, Option+Z and V select,
//     copy, cut, undo, redo and paste in an input, in two modes and in a modal dialog (the page
//     does it; a Mac's browser does not), and on the Windows key map they are left to the browser;
//   - no command runs while a modal dialog is open, from a key or from a toolbar button; message
//     boxes return the pressed button; a modal dialog of Simulator mode holds the controller;
//   - settings: a `storage` event updates a second page; two pages that write settings in turn,
//     or while one of them has not yet received the other's write, lose nothing, and of two
//     changes to one setting the later one ends in both pages; the theme and the whole panel
//     layout (visible panels, separators, Output zoom, editor panes) survive a reload;
//   - the window lock of 3.8.6 is held while a page lives and is free after it has closed;
//   - the gallery of the component kit is served at ?gallery;
//   - an accessibility scan (axe-core, WCAG 2.0/2.1 A and AA) of the three modes in both themes.
//
// Screenshots go to build/shell-check (git-ignored). Exit code 0 = everything passed.
//
// The simulator session starts the real engine (engine/dist). Without engine/dist the session's
// "Simulator: ..." errors are expected and ignored, unless EASY68K_REQUIRE_ENGINES=1 (CI), where
// a missing engine fails the check.
//
// The dev server takes a free port of its own, keeps its own Vite cache under the output folder,
// and neither watches files nor reloads the page: other people's edits elsewhere in the tree must
// not reload the page in the middle of a check.
//
// It lives here rather than in tests/ because W3 owns app/src/ui/shell and tests/e2e belongs to
// X1; docs/requests/W3-shell-check.md asks for a CI job. The page object `window.__easy68k` that
// the script uses exists in development builds only (main.tsx).

/* global console, process, document, window, navigator, KeyboardEvent, Navigator -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'shell-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

const engineDist = join(repoRoot, 'engine', 'dist');
const enginesPresent = existsSync(join(engineDist, 'asm68k.wasm')) && existsSync(join(engineDist, 'sim68k.wasm'));
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** The first page load of the dev server can take minutes on a busy machine. */
const LOAD_TIMEOUT = 240_000;

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const notes = [];
/** Something worth reading that is not a failure of the shell (it is listed again at the end). */
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- helpers --------------------------------------------------------------------------

/** Makes the page believe it runs on macOS, so that the application takes the macOS key map. */
function pretendMac() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

/** The same for Windows, so that the script gives the same result on every machine. */
function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function newContext(browser, os, viewport = { width: 1400, height: 900 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(os === 'mac' ? pretendMac : pretendWindows);
  return context;
}

/** Errors of the simulator session that only mean engine/dist is missing (see the header). */
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
  // The simulator session starts its engine right after start-up (errata SH8 entry 21); wait until
  // it has (or, without engine/dist, until it has given up), so that the enabled state of the
  // simulator's commands is the settled one.
  await page
    .waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, { timeout: 60_000 })
    .catch(() => {});
  // Record every key-down AFTER the dispatcher has seen it (same target and phase, added later).
  await page.evaluate(() => {
    window.__keys = [];
    window.__ran = [];
    window.addEventListener(
      'keydown',
      (event) => window.__keys.push({ key: event.key, code: event.code, prevented: event.defaultPrevented }),
      true,
    );
  });
  return { page, errors };
}

const setMode = (page, mode) => page.locator(`.e68-modeswitch [data-mode="${mode}"]`).click();
/** Closes what a test may have left open: menus, then modal dialogs (Escape twice each). */
async function closeOverlays(page) {
  for (let i = 0; i < 4; i++) {
    const open = await page.evaluate(
      () =>
        document.querySelectorAll('[role=menu][data-e68-menu]').length +
        window.__easy68k.ctx.store.getState().dialogs.stack.length,
    );
    if (open === 0) return;
    await page.keyboard.press('Escape');
  }
}
const mode = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().mode);
const ran = (page) => page.evaluate(() => window.__ran.slice());

/** Presses a real key combination and returns whether the page cancelled its key-down. */
async function pressed(page, combination) {
  await page.evaluate(() => {
    window.__keys.length = 0;
  });
  await page.keyboard.press(combination);
  const keys = await page.evaluate(() => window.__keys.slice());
  // The last key-down is the one of the non-modifier key.
  return keys[keys.length - 1]?.prevented ?? null;
}

/** Sends a key-down with exactly the given key and code, as a keyboard of another layout would. */
function sendKey(page, init) {
  return page.evaluate((eventInit) => {
    const target = document.activeElement ?? document.body;
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...eventInit });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
}

/**
 * Puts a recorder in the place of each command's handler (real or none) until restoreRecorders:
 * enabled, and running it records its id in window.__ran. The key tests ask which command a key
 * reaches, whatever the real handler says right now (a Run without a loaded program is disabled).
 */
function installRecorders(page, ids) {
  return page.evaluate((list) => {
    const { commands } = window.__easy68k;
    window.__restore ??= [];
    for (const id of list) window.__restore.push(commands.override(id, { run: () => void window.__ran.push(id) }));
  }, ids);
}

/** Ends every override of installRecorders and holdBackHandlers. */
function restoreRecorders(page) {
  return page.evaluate(() => {
    for (const end of (window.__restore ?? []).splice(0)) end();
  });
}

/**
 * While the returned promise's function is not called, no real handler runs: every command that
 * is about to run is recorded in window.__held and kept from running (commands.observeRuns). Keys
 * can then be pressed without opening the real dialogs.
 */
async function holdBackHandlers(page) {
  await page.evaluate(() => {
    window.__held = [];
    window.__stopHolding = window.__easy68k.commands.observeRuns((id) => {
      // The mode switch runs app.mode.set: the check changes modes meanwhile.
      if (id === 'app.mode.set') return false;
      window.__held.push(id);
      return true;
    });
  });
  return () => page.evaluate(() => window.__stopHolding?.());
}

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
  check(`axe ${label}: no serious finding`, serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

// --- the checks ------------------------------------------------------------------------

/** Start-up, the three modes, menus and toolbars against the tables. */
async function structurePass(browser, name, os) {
  const p = `${name}/${os}:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);

  check(
    `${p} the page reports the expected platform`,
    (await page.evaluate(() => window.__easy68k.ctx.platform.os)) === (os === 'mac' ? 'mac' : 'windows'),
  );
  check(`${p} starts in Editor mode`, (await mode(page)) === 'editor');
  const segments = await page.locator('.e68-modeswitch [role=radio]').allInnerTexts();
  check(
    `${p} the mode switch offers three modes`,
    same(segments, ['Editor', 'Simulator', 'EASyBIN']),
    segments.join(', '),
  );
  const title = await page.title();
  check(
    `${p} window title`,
    /^EASy68K Editor\/Assembler v5\.16\.01 - unofficial port \d+\.\d+\.\d+/.test(title),
    title,
  );

  // Mode by mode: what the tables say, resolved in the page by the application's own code at the
  // moment of the comparison, against what is on screen. The state can still change (the session
  // finishing its start), so a comparison is repeated for a few seconds before it counts as failed.
  const handlerless = new Set();
  for (const item of ['editor', 'simulator', 'easybin']) {
    await setMode(page, item);
    check(`${p} ${item} mode is shown`, (await mode(page)) === item);
    const shown = await page.locator('[data-e68-workspace]:not([hidden])').getAttribute('data-e68-workspace');
    check(`${p} ${item}: only its workspace is visible`, shown === item, `${shown}`);

    // Toolbar: every button of the table, in order, with its hint as accessible name, enabled
    // exactly when the command has a handler that reports it enabled.
    let toolbar;
    let toolbarExpected;
    let wrongButtons;
    for (const deadline = Date.now() + 10_000; ;) {
      ({ toolbar, toolbarExpected, wrongButtons } = await page.evaluate(
        async ([mode]) => {
          const { resolveToolbar } = await import('/src/commands/menus.ts');
          const { ctx, commands } = window.__easy68k;
          const env = { os: ctx.platform.os, desktop: false, state: ctx.store.getState(), commands };
          // Enabled = it has a handler and the handler says so (no handler: disabled, 3.12.2).
          const enabled = (id) => commands.hasHandler(id) && commands.isEnabled(id);
          const expected = resolveToolbar(mode, env).flatMap((entry) =>
            entry.type === 'button'
              ? [`${entry.label}${enabled(entry.id) ? '' : ' (disabled)'}`]
              : entry.type === 'separator'
                ? ['|']
                : [],
          );
          const root = document.querySelector('.e68-shell__toolbar');
          const buttons = Array.from(root.querySelectorAll('button[data-command], [role=separator]')).filter(
            (element) => element.getAttribute('data-command') !== 'app.theme.set',
          );
          const onScreen = buttons.map((element) =>
            element.matches('[role=separator]')
              ? '|'
              : `${element.getAttribute('aria-label')}${element.disabled ? ' (disabled)' : ''}`,
          );
          const wrong = buttons
            .filter((element) => element.matches('button[data-command]'))
            .filter((element) => element.disabled === enabled(element.getAttribute('data-command')))
            .map((element) => element.getAttribute('data-command'));
          return { toolbar: onScreen, toolbarExpected: expected, wrongButtons: wrong };
        },
        [item],
      ));
      if ((same(toolbar, toolbarExpected) && wrongButtons.length === 0) || Date.now() > deadline) break;
      await page.waitForTimeout(200);
    }
    check(
      `${p} ${item}: toolbar equals the table`,
      same(toolbar, toolbarExpected),
      same(toolbar, toolbarExpected) ? '' : `${JSON.stringify(toolbar)} expected ${JSON.stringify(toolbarExpected)}`,
    );
    check(
      `${p} ${item}: every toolbar button is enabled exactly when its command has a handler that reports it enabled`,
      wrongButtons.length === 0,
      wrongButtons.join(', '),
    );

    // Menus: open each one with the mouse and read what is on screen.
    const expectedMenus = () =>
      page.evaluate(
        async ([mode]) => {
          const { resolveMenus } = await import('/src/commands/menus.ts');
          const { ctx, commands } = window.__easy68k;
          const env = { os: ctx.platform.os, desktop: false, state: ctx.store.getState(), commands };
          const enabled = (id) => commands.hasHandler(id) && commands.isEnabled(id);
          // The caption as the kit shows it: '&&' is a literal '&', '&x' underlines x.
          const strip = (caption) => caption.replace(/&(.)/g, '$1');
          const without = [];
          const flat = (nodes) =>
            nodes.flatMap((node) => {
              if (node.type === 'separator') return ['---'];
              if (node.type === 'submenu') return [`${strip(node.caption)} >`];
              if (!commands.hasHandler(node.id)) without.push(node.id);
              const mark = node.kind === 'action' ? '' : node.checked ? ' [x]' : ' [ ]';
              return [
                `${strip(node.caption)}${mark}${node.shortcut ? ` [${node.shortcut}]` : ''}${enabled(node.id) ? '' : ' (disabled)'}`,
              ];
            });
          const menus = resolveMenus(mode, env).map((menu) => ({
            title: strip(menu.caption),
            items: flat(menu.items),
          }));
          // Which access key each menu title shows (the letter after '&').
          const keys = resolveMenus(mode, env).map((menu) => /&([^&])/.exec(menu.caption)?.[1] ?? '');
          return { menus, keys, without };
        },
        [item],
      );
    const initial = await expectedMenus();
    for (const id of initial.without) handlerless.add(id);
    const titles = await page.locator('.e68-shell__menubar [role=menuitem]').allTextContents();
    check(
      `${p} ${item}: menu bar titles`,
      same(
        titles,
        initial.menus.map((menu) => menu.title),
      ),
      titles.join(', '),
    );
    if (os !== 'mac') {
      const underlined = await page
        .locator('.e68-shell__menubar [role=menuitem]')
        .evaluateAll((elements) =>
          elements.map((element) => element.querySelector('.e68-mnemonic, u')?.textContent ?? ''),
        );
      check(
        `${p} ${item}: menu titles underline their access keys`,
        same(underlined, initial.keys),
        `${JSON.stringify(underlined)} expected ${JSON.stringify(initial.keys)}`,
      );
    }
    let menusEqual = true;
    let detail = '';
    for (const [index] of initial.menus.entries()) {
      await page.locator('.e68-shell__menubar [role=menuitem]').nth(index).click();
      const popup = page.locator('[role=menu][data-e68-menu]').first();
      await popup.waitFor();
      let items;
      let wanted;
      for (const deadline = Date.now() + 5_000; ;) {
        items = await popup.evaluate((root) =>
          Array.from(root.children).flatMap((element) => {
            if (element.matches('[role=separator]')) return ['---'];
            const role = element.getAttribute('role');
            if (!role || !role.startsWith('menuitem')) return [];
            const caption = element.querySelector('.e68-menu__caption')?.textContent ?? element.textContent ?? '';
            const shortcut = element.querySelector('.e68-menu__shortcut')?.textContent ?? '';
            const submenu = element.getAttribute('aria-haspopup') === 'menu';
            const disabled = element.getAttribute('aria-disabled') === 'true';
            const checkable = role === 'menuitemcheckbox' || role === 'menuitemradio';
            const mark = checkable ? (element.getAttribute('aria-checked') === 'true' ? ' [x]' : ' [ ]') : '';
            return [
              `${caption.trim()}${submenu ? ' >' : ''}${mark}${shortcut ? ` [${shortcut.trim()}]` : ''}${disabled && !submenu ? ' (disabled)' : ''}`,
            ];
          }),
        );
        wanted = (await expectedMenus()).menus[index]?.items ?? [];
        if (same(items, wanted) || Date.now() > deadline) break;
        await page.waitForTimeout(200);
      }
      if (!same(items, wanted)) {
        menusEqual = false;
        detail = `${initial.menus[index]?.title}: ${JSON.stringify(items)} expected ${JSON.stringify(wanted)}`;
      }
      if (index === 0 && item !== 'easybin')
        await page.screenshot({ path: join(outDir, `${name}-${os}-${item}-menu.png`) });
      await closeOverlays(page);
    }
    check(
      `${p} ${item}: menus on screen equal the tables (captions, check marks, shortcuts, enabled exactly when the handler says so)`,
      menusEqual,
      detail,
    );
    await page.screenshot({ path: join(outDir, `${name}-${os}-${item}.png`) });
  }
  if (os === 'windows') {
    note(
      `${name}: commands of the menus without a handler yet (${handlerless.size}): ${[...handlerless].sort().join(', ')}`,
    );
  }

  // A command whose handler changes its answer: the toolbar and the menu follow it, once the store
  // has told them (CommandHandler.enabled, contracts/commands.ts).
  await setMode(page, 'editor');
  await page.evaluate(() => {
    window.__flag = true;
    window.__restore ??= [];
    window.__restore.push(
      window.__easy68k.commands.override('ed.file.save', { run: () => {}, enabled: () => window.__flag }),
    );
  });
  const saveButton = page.locator('.e68-shell__toolbar [data-command="ed.file.save"]');
  const enabledNow = await saveButton.isEnabled();
  await page.evaluate(() => {
    window.__flag = false;
    window.__easy68k.ctx.store.setState((state) => ({ ...state }));
  });
  await page
    .waitForFunction(
      () => document.querySelector('.e68-shell__toolbar [data-command="ed.file.save"]')?.disabled === true,
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  const disabledAfter = await saveButton.isDisabled();
  await page.locator('.e68-shell__menubar [role=menuitem]').first().click();
  const saveItem = page.locator('[role=menu][data-e68-menu] [role^=menuitem]', { hasText: /^Save/ }).first();
  const itemDisabled = (await saveItem.getAttribute('aria-disabled')) === 'true';
  await closeOverlays(page);
  await restoreRecorders(page);
  check(
    `${p} a handler that changes its answer: the Save button and menu item follow it`,
    enabledNow && disabledAfter && itemDisabled,
    `enabled=${enabledNow} then disabled=${disabledAfter}, menu item disabled=${itemDisabled}`,
  );

  // Regions of 2.2 and 2.3.
  const regions = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-e68-workspace]')).map((workspace) => [
      workspace.getAttribute('data-e68-workspace'),
      Array.from(workspace.querySelectorAll('[data-e68-panel]')).map((region) => region.getAttribute('data-e68-panel')),
    ]),
  );
  check(
    `${p} the workspaces have the regions of 2.2 and 2.3`,
    same(regions, [
      ['editor', ['files', 'editor', 'messages']],
      ['simulator', ['registers', 'listing', 'messages', 'output']],
      ['easybin', ['easybin']],
    ]),
    JSON.stringify(regions),
  );

  // F4 cycles the modes (rule K5).
  await setMode(page, 'editor');
  await page.keyboard.press('F4');
  const afterOne = await mode(page);
  await page.keyboard.press('F4');
  const afterTwo = await mode(page);
  await page.keyboard.press('F4');
  check(
    `${p} F4 cycles Editor > Simulator > EASyBIN > Editor`,
    same([afterOne, afterTwo, await mode(page)], ['simulator', 'easybin', 'editor']),
  );

  // Alt+letter opens a menu on Windows and Linux; macOS has no menu access keys.
  await page.locator('.e68-modeswitch [data-mode="editor"]').focus();
  await page.keyboard.press('Alt+f');
  const opened = await page.locator('[role=menu][data-e68-menu]').count();
  check(
    `${p} Alt+F ${os === 'mac' ? 'opens no menu' : 'opens the File menu'}`,
    os === 'mac' ? opened === 0 : opened === 1,
    `${opened} menu(s)`,
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** The commands of the editor's own keys (EDITOR_FOCUS_COMMANDS in app/src/commands/tables/keys.ts). */
const EDITOR_FOCUS_IDS = ['ed.edit.toggleInsert', 'ed.edit.indent', 'ed.edit.outdent'];

/** The chords of 2.9.3 and recorded key and code pairs. */
async function keyboardPass(browser, name, os) {
  const p = `${name}/${os}:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  const mac = os === 'mac';

  // 2.9.3: F5, F6, F7, F10 and Ctrl+O/S/P/F/G/R are cancelled, whatever the mode, whether their
  // command is enabled or not. On macOS the Cmd forms too. The real handlers are held back, so
  // that Ctrl+O and the others do not open their dialogs.
  const guarded = [
    'F5',
    'F6',
    'F7',
    'F10',
    'Control+KeyO',
    'Control+KeyS',
    'Control+KeyP',
    'Control+KeyF',
    'Control+KeyG',
    'Control+KeyR',
  ];
  if (mac) guarded.push('Meta+KeyO', 'Meta+KeyS', 'Meta+KeyP', 'Meta+KeyF', 'Meta+KeyG');
  const stopHolding = await holdBackHandlers(page);
  for (const item of ['editor', 'simulator', 'easybin']) {
    await setMode(page, item);
    await page.locator(`.e68-modeswitch [data-mode="${item}"]`).focus();
    const notCancelled = [];
    const inMode = (await mode(page)) === item;
    for (const combination of guarded) {
      if ((await pressed(page, combination)) !== true) notCancelled.push(combination);
    }
    check(
      `${p} ${item}: the chords of 2.9.3 have defaultPrevented`,
      inMode && notCancelled.length === 0,
      inMode ? notCancelled.join(', ') : `the mode is ${await mode(page)}`,
    );
  }
  // F1 in EASyBIN mode is EASyBIN Help (docs/requests/B1-keys.md), on the mode switch.
  await setMode(page, 'easybin');
  await page.locator('.e68-modeswitch [data-mode="easybin"]').focus();
  await page.evaluate(() => {
    window.__held.length = 0;
  });
  const f1Cancelled = await pressed(page, 'F1');
  const f1Ran = await page.evaluate(() => window.__held.slice());
  check(
    `${p} easybin: F1 runs EASyBIN Help`,
    f1Cancelled === true && same(f1Ran, ['bin.help.help']),
    `cancelled=${f1Cancelled} ran=${f1Ran.join(',')}`,
  );
  // In the Address field EASyBIN's own F1 handler (from before F1 was bound) may run it a second
  // time; that is B1's to remove, so it is reported, not failed.
  const address = page.locator('[data-e68-workspace="easybin"] input[aria-label="Address"]').first();
  if ((await address.count()) > 0) {
    await address.focus();
    await page.evaluate(() => {
      window.__held.length = 0;
    });
    await page.keyboard.press('F1');
    const inField = await page.evaluate(() => window.__held.slice());
    if (!same(inField, ['bin.help.help'])) {
      note(`${p} F1 in EASyBIN's Address field ran ${inField.join(', ') || 'nothing'} (B1: once is right)`);
    }
  }
  await stopHolding();
  await closeOverlays(page);

  // Keys that are not the application's stay untouched.
  await setMode(page, 'editor');
  await page.evaluate(() => document.activeElement?.blur());
  const untouched = [];
  for (const combination of ['KeyA', 'F12', 'Control+KeyL', 'ArrowDown']) {
    if ((await pressed(page, combination)) !== false) untouched.push(combination);
  }
  check(`${p} other keys are not cancelled`, untouched.length === 0, untouched.join(', '));
  check(
    `${p} still on the same page after F5 and Ctrl+R (no reload)`,
    (await page.evaluate(() => Array.isArray(window.__ran))) === true,
  );

  // Real keys reach the commands of the mode. Recorders stand in for the real handlers.
  const ids = [
    'ed.file.open',
    'ed.file.save',
    'ed.file.saveAs',
    'ed.edit.undo',
    'ed.edit.redo',
    'ed.edit.comment',
    'ed.edit.uncomment',
    'ed.edit.findNext',
    'ed.project.assemble',
    'sim.file.open',
    'sim.run.run',
    'sim.run.rewind',
    'sim.run.logStart',
    'sim.search.find',
  ];
  await installRecorders(page, ids);
  // The editor's own keys (Insert, Ctrl+Shift+. and ,): stand-ins enabled only while a stand-in
  // editor has the focus, as E2's real handlers are while the real editor has it (tested below).
  // A stand-in editor and a plain text field are added to the page.
  await page.evaluate((list) => {
    const field = document.createElement('input');
    field.type = 'text';
    field.setAttribute('aria-label', 'check-shell text field');
    field.dataset.checkField = '';
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('aria-label', 'check-shell stand-in editor');
    editor.dataset.checkEditor = '';
    document.body.append(field, editor);
    const { commands } = window.__easy68k;
    const inEditor = () => Boolean(document.activeElement?.closest('[data-check-editor]'));
    for (const id of list) {
      window.__restore.push(commands.override(id, { run: () => void window.__ran.push(id), enabled: inEditor }));
    }
  }, EDITOR_FOCUS_IDS);
  await setMode(page, 'editor');
  await page.locator('.e68-modeswitch [data-mode="editor"]').focus();
  const cmd = mac ? 'Meta' : 'Control';
  await page.keyboard.press(`${cmd}+KeyS`);
  await page.keyboard.press('F9');
  await setMode(page, 'simulator');
  await page.locator('.e68-modeswitch [data-mode="simulator"]').focus();
  await page.keyboard.press('F9');
  await page.keyboard.press('Shift+F2');
  await page.keyboard.press('Shift+F4');
  await page.keyboard.press(`${cmd}+KeyO`);
  check(
    `${p} real keys run the commands of the mode`,
    same(await ran(page), [
      'ed.file.save',
      'ed.project.assemble',
      'sim.run.run',
      'sim.run.rewind',
      'sim.run.logStart',
      'sim.file.open',
    ]),
    (await ran(page)).join(', '),
  );

  // Key and code pairs of other keyboards (app/src/commands/key-fixtures.ts).
  await setMode(page, 'editor');
  await page.locator('.e68-modeswitch [data-mode="editor"]').focus();
  await page.evaluate(() => {
    window.__ran.length = 0;
  });
  const none = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  const pairs = mac
    ? [
        [
          'Ctrl+Option+Z: key Ω, code KeyZ',
          { ...none, key: 'Ω', code: 'KeyZ', ctrlKey: true, altKey: true },
          'ed.edit.redo',
        ],
        [
          'Ctrl+Option+C: key ç, code KeyC',
          { ...none, key: 'ç', code: 'KeyC', ctrlKey: true, altKey: true },
          'ed.edit.comment',
        ],
        [
          'Ctrl+Option+U: key Dead, code KeyU',
          { ...none, key: 'Dead', code: 'KeyU', ctrlKey: true, altKey: true },
          'ed.edit.uncomment',
        ],
        ['Shift+Cmd+S', { ...none, key: 's', code: 'KeyS', shiftKey: true, metaKey: true }, 'ed.file.saveAs'],
        ['Cmd+/: code Slash', { ...none, key: '/', code: 'Slash', metaKey: true }, 'ed.edit.comment'],
        [
          'Shift+Cmd+/: key ?',
          { ...none, key: '?', code: 'Slash', shiftKey: true, metaKey: true },
          'ed.edit.uncomment',
        ],
        ['Cmd+G', { ...none, key: 'g', code: 'KeyG', metaKey: true }, 'ed.edit.findNext'],
        [
          'Russian layout, Ctrl + the O position: key щ',
          { ...none, key: 'щ', code: 'KeyO', ctrlKey: true },
          'ed.file.open',
        ],
      ]
    : [
        [
          'QWERTZ, Ctrl + the key labelled Z: code KeyY',
          { ...none, key: 'z', code: 'KeyY', ctrlKey: true },
          'ed.edit.undo',
        ],
        // Ctrl+Alt+letter follows the label on Windows, as the original's accelerators do.
        [
          'QWERTZ, Ctrl+Alt + the key labelled Z: key z, code KeyY',
          { ...none, key: 'z', code: 'KeyY', ctrlKey: true, altKey: true },
          'ed.edit.redo',
        ],
        [
          'QWERTZ, Ctrl+Alt + the key labelled C: key c, code KeyC',
          { ...none, key: 'c', code: 'KeyC', ctrlKey: true, altKey: true },
          'ed.edit.comment',
        ],
        [
          'QWERTZ, Ctrl+Alt + the key labelled U: key u, code KeyU',
          { ...none, key: 'u', code: 'KeyU', ctrlKey: true, altKey: true },
          'ed.edit.uncomment',
        ],
        [
          'AZERTY, Ctrl+Alt + the key labelled Z: key z, code KeyW',
          { ...none, key: 'z', code: 'KeyW', ctrlKey: true, altKey: true },
          'ed.edit.redo',
        ],
        [
          'Russian layout, Ctrl + the O position: key щ',
          { ...none, key: 'щ', code: 'KeyO', ctrlKey: true },
          'ed.file.open',
        ],
        [
          'Russian layout, Ctrl + the S position: key ы',
          { ...none, key: 'ы', code: 'KeyS', ctrlKey: true },
          'ed.file.save',
        ],
        [
          'Russian layout, Ctrl+Alt + the C position: key с',
          { ...none, key: 'с', code: 'KeyC', ctrlKey: true, altKey: true },
          'ed.edit.comment',
        ],
        ['Ctrl+Alt+U', { ...none, key: 'u', code: 'KeyU', ctrlKey: true, altKey: true }, 'ed.edit.uncomment'],
        [
          'Insert on the keypad (0 with NumLock off), in the editor: key Insert, code Numpad0',
          { ...none, key: 'Insert', code: 'Numpad0' },
          'ed.edit.toggleInsert',
          '[data-check-editor]',
        ],
      ];
  for (const [label, init, command, where] of pairs) {
    await page.locator(where ?? '.e68-modeswitch [data-mode="editor"]').focus();
    await page.evaluate(() => {
      window.__ran.length = 0;
    });
    const cancelled = await sendKey(page, init);
    const result = await ran(page);
    check(
      `${p} ${label} runs ${command}`,
      cancelled === true && same(result, [command]),
      `cancelled=${cancelled} ran=${result.join(',')}`,
    );
  }
  // Option+O alone is text (ø), not a chord of any command: it is left alone.
  if (mac) {
    const cancelled = await sendKey(page, { ...none, key: 'ø', code: 'KeyO', altKey: true });
    check(`${p} Option+O (key ø, code KeyO) is left to the page`, cancelled === false);
  } else {
    // The key at the US Z position is labelled Y (QWERTZ) or W (AZERTY): Ctrl+Alt on it is no
    // command. AltGr characters (German AltGr+Q, French AltGr+à: @) stay text.
    const notCommands = [
      ['QWERTZ, Ctrl+Alt + the key labelled Y: key y, code KeyZ', { key: 'y', code: 'KeyZ' }],
      ['AZERTY, Ctrl+Alt + the key labelled W: key w, code KeyZ', { key: 'w', code: 'KeyZ' }],
      ['QWERTZ, AltGr+Q: key @, code KeyQ', { key: '@', code: 'KeyQ' }],
      ['AZERTY, AltGr+à: key @, code Digit0', { key: '@', code: 'Digit0' }],
    ];
    for (const [label, keys] of notCommands) {
      await page.locator('.e68-modeswitch [data-mode="editor"]').focus();
      await page.evaluate(() => {
        window.__ran.length = 0;
      });
      const cancelled = await sendKey(page, { ...none, ...keys, ctrlKey: true, altKey: true });
      const result = await ran(page);
      check(
        `${p} ${label} runs nothing and is left to the page`,
        cancelled === false && result.length === 0,
        `cancelled=${cancelled} ran=${result.join(',')}`,
      );
    }
  }

  // Insert and Ctrl+Shift+. / , belong to the editor control (EDITOR_FOCUS_COMMANDS). With
  // handlers that are enabled only while the editor has the focus (the stand-ins above), the keys
  // run in the editor and reach a plain text field untouched; on a button they are cancelled as
  // before (2.9.1 step 4).
  const editorKeys = [
    mac
      ? ['Ctrl+Shift+I', { ...none, key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true }, 'ed.edit.toggleInsert']
      : ['Insert', { ...none, key: 'Insert', code: 'Insert' }, 'ed.edit.toggleInsert'],
    ['Ctrl+Shift+.', { ...none, key: '>', code: 'Period', ctrlKey: true, shiftKey: true }, 'ed.edit.indent'],
    ['Ctrl+Shift+,', { ...none, key: '<', code: 'Comma', ctrlKey: true, shiftKey: true }, 'ed.edit.outdent'],
  ];
  for (const [label, init, command] of editorKeys) {
    await page.locator('.e68-modeswitch [data-mode="editor"]').focus();
    await page.evaluate(() => {
      window.__ran.length = 0;
    });
    const onButton = await sendKey(page, init);
    const onButtonRan = await ran(page);
    check(
      `${p} ${label} on a button outside the editor is cancelled and runs nothing`,
      onButton === true && onButtonRan.length === 0,
      `cancelled=${onButton} ran=${onButtonRan.join(',')}`,
    );
    for (const where of ['field', 'editor']) {
      await page.locator(where === 'field' ? '[data-check-field]' : '[data-check-editor]').focus();
      await page.evaluate(() => {
        window.__ran.length = 0;
      });
      const cancelled = await sendKey(page, init);
      const result = await ran(page);
      check(
        where === 'field'
          ? `${p} ${label} in a text field outside the editor is left to the field`
          : `${p} ${label} in the editor runs ${command}`,
        where === 'field' ? cancelled === false && result.length === 0 : cancelled === true && same(result, [command]),
        `cancelled=${cancelled} ran=${result.join(',')}`,
      );
    }
  }

  // Ctrl+F4 (2.9.3): the browsers of Windows and Linux keep it (it closes the tab), so the page
  // leaves it alone; a browser on macOS delivers it, and there it is the original's Log Start.
  await setMode(page, 'simulator');
  await page.locator('.e68-modeswitch [data-mode="simulator"]').focus();
  await page.evaluate(() => {
    window.__ran.length = 0;
  });
  const ctrlF4Cancelled = await sendKey(page, { ...none, key: 'F4', code: 'F4', ctrlKey: true });
  const ctrlF4Ran = await ran(page);
  check(
    mac ? `${p} Ctrl+F4 runs Log Start in a browser on macOS` : `${p} Ctrl+F4 is left to the browser on Windows`,
    mac
      ? ctrlF4Cancelled === true && same(ctrlF4Ran, ['sim.run.logStart'])
      : !ctrlF4Cancelled && ctrlF4Ran.length === 0,
    `cancelled=${ctrlF4Cancelled} ran=${ctrlF4Ran.join(',')}`,
  );
  await restoreRecorders(page);

  // The same editor keys with E2's real handlers and the real editor (CodeMirror): they run in
  // the editor and are left to the plain text field. The real handlers only look on: nothing is
  // held back, so Insert really toggles Insert / Replace (pressed twice, it ends as it began).
  await setMode(page, 'editor');
  const realEditor = page.locator('[data-e68-workspace="editor"] .cm-content').first();
  if ((await realEditor.count()) === 0) {
    check(`${p} the real editor is on screen (.cm-content)`, false, 'no .cm-content in Editor mode');
  } else {
    await page.evaluate(() => {
      window.__seen = [];
      window.__stopSeeing = window.__easy68k.commands.observeRuns((id) => void window.__seen.push(id));
    });
    const insertKey = mac ? 'Control+Shift+KeyI' : 'Insert';
    for (const where of ['editor', 'field']) {
      await (where === 'editor' ? realEditor : page.locator('[data-check-field]')).click();
      const seen = [];
      const cancelled = [];
      for (const combination of [insertKey, insertKey]) {
        await page.evaluate(() => {
          window.__seen.length = 0;
        });
        cancelled.push(await pressed(page, combination));
        seen.push(...(await page.evaluate(() => window.__seen.slice())));
      }
      check(
        where === 'editor'
          ? `${p} ${mac ? 'Ctrl+Shift+I' : 'Insert'} in the real editor runs E2's ed.edit.toggleInsert`
          : `${p} ${mac ? 'Ctrl+Shift+I' : 'Insert'} with E2's handler is left to a plain text field`,
        where === 'editor'
          ? same(cancelled, [true, true]) && same(seen, ['ed.edit.toggleInsert', 'ed.edit.toggleInsert'])
          : same(cancelled, [false, false]) && seen.length === 0,
        `cancelled=${cancelled.join(',')} ran=${seen.join(',')}`,
      );
    }
    await page.evaluate(() => window.__stopSeeing());
  }
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-check-field], [data-check-editor]')) element.remove();
  });

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/**
 * Rule K2 in plain text fields (errata W3.md entry 34). On the macOS key map the dispatcher
 * performs Ctrl+A, C, X, Z, Option+Z and V itself in an input or textarea (a Mac's browser treats
 * only the Cmd forms as editing keys), in every mode and in a modal dialog. Each check tests the
 * effect (the selection, the field's value, the browser's own `copy` / `cut` event, the pasted text)
 * and that the key was cancelled, so it passes only where the page did the work: on the macOS
 * runner the browser does nothing for these keys by itself. On the Windows key map the keys are
 * left to the browser (not cancelled), which edits on its own on Windows and Linux.
 */
async function textFieldKeysPass(browser, name, os) {
  const p = `${name}/${os}:`;
  const context = await newContext(browser, os);
  if (name === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl.replace(/\/$/, '') });
  }
  const { page, errors } = await openApp(context);
  // For a failure on a CI runner: the system the browser really runs on.
  console.log(
    `        runner: ${process.platform}; browser: ${await page.evaluate(() => navigator.userAgent)}; key map: ${await page.evaluate(() => window.__easy68k.ctx.platform.os)}`,
  );
  await page.evaluate(() => {
    window.__clip = [];
    const record = (event) => {
      const field = event.target;
      const text =
        field && typeof field.value === 'string' ? field.value.slice(field.selectionStart, field.selectionEnd) : '';
      window.__clip.push(`${event.type}:${text}`);
    };
    document.addEventListener('copy', record, true);
    document.addEventListener('cut', record, true);
    // The input types of the field's changes, for a failure on a CI runner (errata W3.md entry 36).
    window.__inputs = [];
    document.addEventListener('input', (event) => window.__inputs.push(event.inputType || '?'), true);
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'check-shell K2 field');
    input.dataset.checkK2 = '';
    document.body.append(input);
  });
  const state = (selector = '[data-check-k2]') =>
    page.evaluate((sel) => {
      const field = document.querySelector(sel);
      return {
        value: field.value,
        start: field.selectionStart,
        end: field.selectionEnd,
        clip: window.__clip.slice(),
        inputs: window.__inputs.slice(-12),
        focused: document.activeElement === field,
      };
    }, selector);
  const show = (s) =>
    `value=${JSON.stringify(s.value)} selection=${s.start}..${s.end} events=${s.clip.join(',')} inputs=${s.inputs.join(',')}`;
  const field = page.locator('[data-check-k2]');

  if (os !== 'mac') {
    await setMode(page, 'editor');
    await field.click();
    await page.keyboard.type('abc def');
    const left = [];
    for (const combination of ['Control+KeyA', 'Control+KeyC', 'Control+KeyZ']) {
      if ((await pressed(page, combination)) !== false) left.push(combination);
    }
    check(`${p} Ctrl+A, C and Z in a text field are left to the browser`, left.length === 0, left.join(', '));
    check(`${p} no console or page errors (text fields)`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await closeWithin(context);
    return;
  }

  for (const item of ['editor', 'simulator']) {
    await setMode(page, item);
    await page.evaluate(() => {
      const input = document.querySelector('[data-check-k2]');
      input.value = '';
      window.__clip.length = 0;
      window.__inputs.length = 0;
    });
    await field.click();
    await page.keyboard.type('abc def');
    const selectAll = await pressed(page, 'Control+KeyA');
    let s = await state();
    check(
      `${p} ${item}: Ctrl+A in a text field selects all of it`,
      selectAll === true && s.start === 0 && s.end === 7 && s.value === 'abc def',
      `cancelled=${selectAll} ${show(s)}`,
    );
    const copy = await pressed(page, 'Control+KeyC');
    s = await state();
    check(
      `${p} ${item}: Ctrl+C in a text field copies the selection`,
      copy === true && s.clip.includes('copy:abc def') && s.value === 'abc def',
      `cancelled=${copy} ${show(s)}`,
    );
    await page.evaluate(() => document.querySelector('[data-check-k2]').setSelectionRange(4, 7));
    const cut = await pressed(page, 'Control+KeyX');
    s = await state();
    check(
      `${p} ${item}: Ctrl+X in a text field cuts the selection`,
      cut === true && s.clip.includes('cut:def') && s.value === 'abc ',
      `cancelled=${cut} ${show(s)}`,
    );
    const undo = await pressed(page, 'Control+KeyZ');
    s = await state();
    check(
      `${p} ${item}: Ctrl+Z in a text field undoes the cut`,
      undo === true && s.value === 'abc def',
      `cancelled=${undo} ${show(s)}`,
    );
    const redo = await pressed(page, 'Control+Alt+KeyZ');
    s = await state();
    check(
      `${p} ${item}: Ctrl+Option+Z in a text field redoes it`,
      redo === true && s.value === 'abc ',
      `cancelled=${redo} ${show(s)}`,
    );
    // Two undos: the cut, then the typing before it (a value set by a script is where it starts).
    const undoTwice = [await pressed(page, 'Control+KeyZ'), await pressed(page, 'Control+KeyZ')];
    s = await state();
    check(
      `${p} ${item}: Ctrl+Z twice takes back the cut and then the typing`,
      undoTwice.every((cancelled) => cancelled === true) && s.value === '',
      `cancelled=${undoTwice.join(',')} ${show(s)}`,
    );
  }

  // Ctrl+V: the page asks the browser for the clipboard (note 45). Chromium has the permission
  // here and must paste; another browser may refuse, and then the toast must say so.
  await setMode(page, 'editor');
  const clipboardSet = await page.evaluate(() =>
    navigator.clipboard.writeText('D7').then(
      () => true,
      () => false,
    ),
  );
  await field.click();
  await page.evaluate(() => {
    const input = document.querySelector('[data-check-k2]');
    input.value = 'move.l ';
    input.setSelectionRange(7, 7);
  });
  const paste = await pressed(page, 'Control+KeyV');
  const outcome = await page
    .waitForFunction(
      () => {
        if (document.querySelector('[data-check-k2]').value === 'move.l D7') return 'pasted';
        return document.body.innerText.includes('Press Cmd+V to paste') ? 'toast' : false;
      },
      null,
      { timeout: 10_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => 'nothing within 10 s');
  const pasted = await state();
  check(
    `${p} Ctrl+V in a text field pastes${name === 'chromium' ? '' : ', or says "Press Cmd+V to paste" when refused'}`,
    paste === true && (name === 'chromium' ? outcome === 'pasted' : outcome === 'pasted' || outcome === 'toast'),
    `cancelled=${paste} clipboard set=${clipboardSet} outcome=${outcome} ${show(pasted)}`,
  );
  if (outcome === 'pasted') {
    const undoPaste = await pressed(page, 'Control+KeyZ');
    const s = await state();
    check(
      `${p} Ctrl+Z takes back the paste`,
      undoPaste === true && s.value === 'move.l ',
      `cancelled=${undoPaste} ${show(s)}`,
    );
  }
  await closeOverlays(page);

  // In a modal dialog: a field inside a message box.
  await page.evaluate(() => {
    void window.__easy68k.ctx.dialogs.messageBox({ title: 'Check', text: 'K2', icon: 'information', buttons: ['OK'] });
  });
  await page.waitForSelector('[role=alertdialog][aria-modal=true]');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'check-shell K2 dialog field');
    input.dataset.checkK2Dialog = '';
    document.querySelector('[role=alertdialog]').append(input);
    window.__clip.length = 0;
  });
  await page.locator('[data-check-k2-dialog]').click();
  await page.keyboard.type('xyz');
  const dialogAll = await pressed(page, 'Control+KeyA');
  const dialogCut = await pressed(page, 'Control+KeyX');
  const inDialog = await state('[data-check-k2-dialog]');
  check(
    `${p} in a modal dialog: Ctrl+A and Ctrl+X in a text field select and cut`,
    dialogAll === true && dialogCut === true && inDialog.value === '' && inDialog.clip.includes('cut:xyz'),
    `cancelled=${dialogAll},${dialogCut} ${show(inDialog)}`,
  );
  const dialogUndo = await pressed(page, 'Control+KeyZ');
  const undoneInDialog = await state('[data-check-k2-dialog]');
  check(
    `${p} in a modal dialog: Ctrl+Z takes back the cut`,
    dialogUndo === true && undoneInDialog.value === 'xyz',
    `cancelled=${dialogUndo} ${show(undoneInDialog)}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-mac-k2-dialog.png`) });
  await closeOverlays(page);

  check(`${p} no console or page errors (text fields)`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

/** Modal dialogs: nothing runs, message boxes answer, the controller is held. */
async function dialogPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser, 'windows');
  const { page, errors } = await openApp(context);
  await installRecorders(page, ['ed.file.save', 'sim.run.run']);
  await page.locator('.e68-modeswitch [data-mode="editor"]').focus();

  await page.keyboard.press('Control+KeyS');
  check(`${p} Ctrl+S runs Save while no dialog is open`, same(await ran(page), ['ed.file.save']));
  const saveButton = page.locator('.e68-shell__toolbar [data-command="ed.file.save"]');
  check(`${p} the Save button is enabled while its handler reports it enabled`, await saveButton.isEnabled());
  await saveButton.click();
  check(`${p} the toolbar button runs Save`, same(await ran(page), ['ed.file.save', 'ed.file.save']));

  // A message box (Yes / No).
  await page.evaluate(() => {
    window.__answer = null;
    void window.__easy68k.ctx.dialogs
      .messageBox({
        title: 'Caution',
        text: 'A program is running.  Stop it?',
        icon: 'confirmation',
        buttons: ['Yes', 'No'],
      })
      .then((button) => {
        window.__answer = button;
      });
  });
  await page.waitForSelector('[role=alertdialog][aria-modal=true]');
  check(
    `${p} a message box shows its title and text`,
    (await page.locator('[role=alertdialog]').innerText()).includes('A program is running.'),
  );
  const cancelled = await pressed(page, 'Control+KeyS');
  await page.keyboard.press('F9');
  // A click that reaches the button although the dialog covers it (a script, an assistive tool).
  await saveButton.evaluate((button) => button.click());
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'simulator'));
  check(
    `${p} modal dialog open: no command runs from a key, a toolbar button or the registry`,
    same(await ran(page), ['ed.file.save', 'ed.file.save']) && (await mode(page)) === 'editor',
    (await ran(page)).join(', '),
  );
  check(`${p} modal dialog open: Ctrl+S is still cancelled`, cancelled === true);
  await page.screenshot({ path: join(outDir, `${name}-message-box.png`) });
  await page.locator('[role=alertdialog] button', { hasText: 'No' }).click();
  await page.waitForFunction(() => window.__answer !== null);
  check(`${p} the message box returns the pressed button`, (await page.evaluate(() => window.__answer)) === 'No');
  await page.keyboard.press('Control+KeyS');
  check(`${p} commands run again after the dialog has closed`, (await ran(page)).length === 3);

  // Enter presses the default button (the first); an OK box closes on Escape.
  await page.evaluate(() => {
    window.__answer = null;
    void window.__easy68k.ctx.dialogs
      .messageBox({ title: 'Information', text: 'Current Log Stopped.', icon: 'information', buttons: ['OK'] })
      .then((button) => {
        window.__answer = button;
      });
  });
  await page.waitForSelector('[role=alertdialog][aria-modal=true]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__answer !== null);
  check(`${p} an OK box answers OK on Escape`, (await page.evaluate(() => window.__answer)) === 'OK');

  // MessageBoxRequest.defaultButton (docs/requests/N5-default-button.md): without it Yes has the
  // focus and Enter answers Yes, as before; with defaultButton 'No' (ARCHITECTURE-PLUS P3.3.4) No
  // has the focus and Enter answers No.
  for (const [defaultButton, expected] of [
    [undefined, 'Yes'],
    ['No', 'No'],
  ]) {
    await page.evaluate((named) => {
      window.__answer = null;
      const request = { title: 'Delete', text: 'This cannot be undone.', icon: 'warning', buttons: ['Yes', 'No'] };
      void window.__easy68k.ctx.dialogs
        .messageBox(named ? { ...request, defaultButton: named } : request)
        .then((button) => {
          window.__answer = button;
        });
    }, defaultButton ?? null);
    await page.waitForSelector('[role=alertdialog][aria-modal=true]');
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__answer !== null);
    const answer = await page.evaluate(() => window.__answer);
    check(
      `${p} a Yes/No box with defaultButton ${defaultButton ?? '(none)'}: the focus is on ${expected} and Enter answers ${expected}`,
      focused === expected && answer === expected,
      `focus on "${focused}", answer ${answer}`,
    );
  }

  // Simulator mode: a modal dialog holds the controller (4.4.5).
  await setMode(page, 'simulator');
  const before = await page.evaluate(() => window.__easy68k.ctx.sim.controller.held);
  await page.evaluate(() => {
    window.__answer = null;
    void window.__easy68k.ctx.dialogs
      .messageBox({ title: 'Caution', text: 'Close?', icon: 'confirmation', buttons: ['Yes', 'No'] })
      .then((button) => {
        window.__answer = button;
      });
  });
  await page.waitForSelector('[role=alertdialog][aria-modal=true]');
  const during = await page.evaluate(() => window.__easy68k.ctx.sim.controller.held);
  await page.keyboard.press('F9');
  await page.locator('[role=alertdialog] button', { hasText: 'Yes' }).click();
  await page.waitForFunction(() => window.__answer !== null);
  const after = await page.evaluate(() => window.__easy68k.ctx.sim.controller.held);
  check(
    `${p} Simulator mode: a modal dialog holds the controller and releases it`,
    same([before, during, after], [false, true, false]),
    `${before} ${during} ${after}`,
  );
  check(`${p} Simulator mode: F9 did not run while the dialog was open`, !(await ran(page)).includes('sim.run.run'));

  // A modal dialog's own code may open help (allowInModal), and the Help drawer is then drawn above
  // the dialog's backdrop (docs/requests/H1-help-from-dialogs.md).
  await setMode(page, 'editor');
  await page.evaluate(() => {
    void window.__easy68k.ctx.dialogs.messageBox({ title: 'Options', text: 'Help?', icon: 'none', buttons: ['OK'] });
  });
  await page.waitForSelector('[role=alertdialog][aria-modal=true]');
  const helpRefused = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    await ctx.commands.run('ed.help.help', 'options.htm');
    return document.querySelector('.e68-shell__body > [data-e68-panel="help"]') === null;
  });
  await page.evaluate(() => window.__easy68k.ctx.commands.run('ed.help.help', 'options.htm', { allowInModal: true }));
  const helpOnTop = await page
    .waitForFunction(
      () => {
        const region = document.querySelector('.e68-shell__body > [data-e68-panel="help"]');
        if (!region) return false;
        const box = region.getBoundingClientRect();
        if (box.width < 20) return false;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 20);
        return hit !== null && region.contains(hit);
      },
      null,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: join(outDir, `${name}-help-over-dialog.png`) });
  check(
    `${p} a modal dialog: help opens only from the dialog's own code, and the Help drawer is above the backdrop`,
    helpRefused && helpOnTop,
    `refused without allowInModal=${helpRefused}, drawer on top=${helpOnTop}`,
  );
  await closeOverlays(page);
  await page.evaluate(async () => {
    const { hidePanel } = await import('/src/state/panels.ts');
    hidePanel(window.__easy68k.ctx, 'help');
  });

  // A mode's own window title (docs/requests/B1-window-title.md) and the build on the context
  // (docs/requests/H1-build-info.md).
  await setMode(page, 'easybin');
  const titles = await page.evaluate(async () => {
    const { setModeTitle } = await import('/src/state/shell.ts');
    const { ctx } = window.__easy68k;
    const before = document.title;
    setModeTitle(ctx, 'easybin', '/browser/demo.S68');
    const during = document.title;
    setModeTitle(ctx, 'easybin', null);
    return { before, during, after: document.title, build: ctx.build };
  });
  check(
    `${p} EASyBIN's window title can show the file opened last, and New puts the fixed title back`,
    /^EASyBIN v2\.5\.0 - unofficial port /.test(titles.before) &&
      /^\/browser\/demo\.S68 - unofficial port /.test(titles.during) &&
      titles.after === titles.before,
    `${titles.before} | ${titles.during} | ${titles.after}`,
  );
  check(
    `${p} the context carries the build's version and repository`,
    typeof titles.build?.version === 'string' &&
      titles.before.endsWith(titles.build.version) &&
      (titles.build.repository === null || /^[^/\s]+\/[^/\s]+$/.test(titles.build.repository)),
    JSON.stringify(titles.build),
  );

  // A toast.
  await page.evaluate(() => window.__easy68k.ctx.dialogs.toast('The program is waiting for keyboard input'));
  check(`${p} a toast appears`, (await page.locator('.e68-toast').count()) === 1);
  // One that stays until it is dismissed (docs/requests/DV1-toast-duration.md): still there after
  // the kit's default of 8 s would have closed it, with the pointer and the focus elsewhere.
  await page.mouse.move(5, 5);
  await page.evaluate(() =>
    window.__easy68k.dialogs.toast('A new version is available.', { label: 'Reload', run: () => {} }, { duration: 0 }),
  );
  await page.waitForTimeout(9000);
  const toastTexts = await page.locator('.e68-toast').allInnerTexts();
  check(
    `${p} a toast with duration 0 stays; one without closes after the kit's default`,
    toastTexts.length === 1 && toastTexts[0].includes('A new version is available.'),
    JSON.stringify(toastTexts),
  );

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await closeWithin(context);
}

// --- settings in two pages (3.8.6 rule 2; errata W3 entry 26) ---------------------------------

const SETTINGS_KEY = 'easy68k.settings.v1';

/** Sets one setting ('editor.fontSize') through page's settings service; resolves to the page's clock after. */
const updateSettings = (page, path, value) =>
  page.evaluate(
    ([name, argument]) => {
      const [section, key] = name.split('.');
      window.__easy68k.ctx.settings.update((s) => ({ ...s, [section]: { ...s[section], [key]: argument } }));
      return Date.now();
    },
    [path, value],
  );

const FONT_SIZE = 'editor.fontSize';
const REAL_TABS = 'editor.realTabs';
const BIT_FIELD = 'sim.bitField';

/**
 * Waits until both pages store and show `expected` ({ 'editor.fontSize': 14, ... }). Resolves to
 * null when they do, or to what they showed last when they still do not after `timeoutMs`.
 */
async function settingsSettle(pages, expected, timeoutMs = 15_000) {
  const paths = Object.keys(expected);
  const wanted = Object.values(expected);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const views = [];
    for (const page of pages) {
      views.push(
        await page.evaluate(
          ([key, list]) => {
            const at = (document, path) => path.split('.').reduce((node, name) => node?.[name], document);
            const stored = JSON.parse(window.localStorage.getItem(key) ?? '{}');
            const shown = window.__easy68k.ctx.settings.get();
            return list.map((path) => [at(stored, path), at(shown, path)]);
          },
          [SETTINGS_KEY, paths],
        ),
      );
    }
    const settled = views.every((view) =>
      view.every(([stored, shown], index) => same(stored, wanted[index]) && same(shown, wanted[index])),
    );
    if (settled) return null;
    if (Date.now() > deadline) {
      const named = views.map((view, page) =>
        Object.fromEntries(view.map(([stored, shown], index) => [paths[index], { page, stored, shown }])),
      );
      return `want ${JSON.stringify(expected)}, have ${JSON.stringify(named)}`;
    }
    await pages[0].waitForTimeout(50);
  }
}

/**
 * Page `b` blocks its main thread for `busyMs` (so that it cannot take in other pages' writes),
 * page `a` sets `pathA` meanwhile, and then `b` reads the stored font size and sets `pathB`
 * from the same task. Tells whether the race happened as intended: `b` read after `a` had written
 * (by the clock both share) and still saw the old font size.
 */
async function raceWithBusyPage(a, b, busyMs, pathA, valueA, pathB, valueB, fontSizeOfA) {
  const blocked = b.evaluate(
    ([ms, key, path, argument]) =>
      new Promise((resolve) => {
        window.setTimeout(() => {
          const busyFrom = Date.now();
          while (Date.now() < busyFrom + ms) {
            // Keep the page busy: the other page's write cannot reach this page's copy now.
          }
          const readAt = Date.now();
          const seen = JSON.parse(window.localStorage.getItem(key) ?? '{}').editor?.fontSize;
          const [section, name] = path.split('.');
          window.__easy68k.ctx.settings.update((s) => ({ ...s, [section]: { ...s[section], [name]: argument } }));
          resolve({ busyFrom, readAt, seen });
        }, 0);
      }),
    [busyMs, SETTINGS_KEY, pathB, valueB],
  );
  // Give page B time to start its block before A writes; a slower machine gets a longer block.
  await a.waitForTimeout(Math.min(busyMs / 4, 1000));
  const wroteAt = await updateSettings(a, pathA, valueA);
  const { busyFrom, readAt, seen } = await blocked;
  return { ordered: busyFrom <= wroteAt && wroteAt < readAt, stale: seen !== fontSizeOfA };
}

/**
 * The settings rounds of the two-page pass. `inTurn`: the pages write one after the other, as a
 * person switching windows does (ten rounds). `stale`: page B writes while page A's newer write
 * has certainly not reached it, which the old service lost every time. `same`: both change the
 * font size, B later; every page and the store must end with B's value.
 */
async function settingsRounds(a, b) {
  const pages = [a, b];
  const result = {};

  let failure = null;
  let round = 0;
  for (; round < 10 && failure === null; round++) {
    const fontSize = 10 + round;
    const flag = round % 2 === 0;
    await updateSettings(a, FONT_SIZE, fontSize);
    await updateSettings(b, BIT_FIELD, flag);
    await updateSettings(a, REAL_TABS, flag);
    const expected = {
      'editor.fontSize': fontSize,
      'editor.realTabs': flag,
      'sim.bitField': flag,
      'app.theme': 'dark',
    };
    failure = await settingsSettle(pages, expected);
    if (failure !== null) failure = `round ${round + 1}: ${failure}`;
  }
  result.inTurn = { ok: failure === null, detail: failure ?? `${round} rounds` };

  // The race is set up by blocking page B; if a slow machine lets A's write come after B's read,
  // the round is repeated with a longer block, up to four tries. What must hold is that nothing is
  // lost. Whether B really read an old copy depends on the browser (pages that share one copy of
  // the storage never do): the detail says how often it did, and a browser in which it never did
  // passes with a note rather than failing a product that lost nothing.
  failure = null;
  let proven = 0;
  let tries = 0;
  for (let busyMs = 600; proven < 2 && tries < 4 && failure === null; tries++) {
    const fontSize = 30 + tries;
    const flag = tries % 2 === 0;
    const race = await raceWithBusyPage(a, b, busyMs, FONT_SIZE, fontSize, BIT_FIELD, flag, fontSize);
    if (race.ordered && race.stale) proven++;
    if (!race.ordered) busyMs = Math.min(busyMs * 2, 8000);
    failure = await settingsSettle(pages, { 'editor.fontSize': fontSize, 'sim.bitField': flag, 'app.theme': 'dark' });
    if (failure !== null) failure = `try ${tries + 1} (B read ${race.stale ? 'the old' : 'the new'} value): ${failure}`;
  }
  result.stale = {
    ok: failure === null,
    detail:
      failure ??
      (proven > 0
        ? `B wrote from an out-of-date copy in ${proven} of ${tries} tries`
        : `nothing lost; note: B never read an out-of-date copy in ${tries} tries, so the race was not produced`),
  };

  failure = null;
  proven = 0;
  tries = 0;
  for (let busyMs = 600; proven < 1 && tries < 3 && failure === null; tries++) {
    const fontA = 40 + tries;
    const fontB = 50 + tries;
    const race = await raceWithBusyPage(a, b, busyMs, FONT_SIZE, fontA, FONT_SIZE, fontB, fontA);
    if (race.ordered && race.stale) proven++;
    if (!race.ordered) busyMs = Math.min(busyMs * 2, 8000);
    failure = await settingsSettle(pages, { 'editor.fontSize': fontB });
    if (failure !== null) failure = `try ${tries + 1}: ${failure}`;
  }
  result.same = {
    ok: failure === null,
    detail:
      failure ??
      (proven > 0
        ? `B changed it from an out-of-date copy in ${proven} of ${tries} tries`
        : `B's later value won; note: B never read an out-of-date copy in ${tries} tries`),
  };

  // A document without stamps, written straight into page A's storage (a tool, the developer tools):
  // it replaces the settings in every page, also in A, which hears of it only through B's next write.
  await a.evaluate(
    ([key]) =>
      window.localStorage.setItem(
        key,
        JSON.stringify({ version: 1, editor: { fontSize: 21 }, app: { theme: 'dark' } }),
      ),
    [SETTINGS_KEY],
  );
  await b
    .waitForFunction(() => window.__easy68k.ctx.settings.get().editor.fontSize === 21, null, { timeout: 15_000 })
    .catch(() => {});
  await updateSettings(b, BIT_FIELD, true);
  failure = await settingsSettle(pages, { 'editor.fontSize': 21, 'sim.bitField': true, 'app.theme': 'dark' });
  result.foreign = { ok: failure === null, detail: failure ?? '' };
  return result;
}

/** Two pages on one origin: settings, layout, the window lock. */
async function windowsPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser, 'windows');
  const a = await openApp(context);
  const b = await openApp(context);
  const theme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const locksOf = (page) =>
    page.evaluate(async () => {
      if (!navigator.locks?.query) return null;
      const snapshot = await navigator.locks.query();
      return (snapshot.held ?? [])
        .map((lock) => lock.name)
        .filter((lockName) => lockName.startsWith('easy68k.window.'));
    });
  const idOf = (page) => page.evaluate(() => window.__easy68k.ctx.platform.windowId);

  // The window lock (3.8.6 rule 1).
  const idA = await idOf(a.page);
  const idB = await idOf(b.page);
  await a.page.evaluate(() => window.__easy68k.windowLock);
  await b.page.evaluate(() => window.__easy68k.windowLock);
  const held = await locksOf(b.page);
  check(`${p} two pages have different window ids`, idA !== idB && /^[0-9a-f]{24}$/.test(idA));
  check(
    `${p} each page holds its window lock`,
    held !== null && held.includes(`easy68k.window.${idA}`) && held.includes(`easy68k.window.${idB}`),
    JSON.stringify(held),
  );

  // The theme button; a storage event updates the other page.
  await a.page.locator('[data-command="app.theme.set"]').click();
  await a.page.locator('[role=menu] [role=menuitemradio]', { hasText: 'Dark' }).click();
  check(`${p} the theme button sets the dark theme`, (await theme(a.page)) === 'dark');
  await b.page
    .waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 5000 })
    .catch(() => {});
  check(
    `${p} a storage event updates the other page`,
    (await theme(b.page)) === 'dark',
    `data-theme=${await theme(b.page)}`,
  );

  // Settings written by two pages at about the same time (3.8.6 rule 2; errata W3 entry 26). A page
  // does not see another page's localStorage write at once, so a page can write the whole document
  // from an out-of-date copy; the service then puts the lost setting back once the other page's
  // write reaches it. Every round therefore waits, with a limit, until both pages show and store
  // every value; an old service that loses a setting never gets there.
  const rounds = await settingsRounds(a.page, b.page);
  check(`${p} settings survive two pages writing in turn`, rounds.inTurn.ok, rounds.inTurn.detail);
  check(
    `${p} a page writing from an out-of-date copy loses no other page's setting`,
    rounds.stale.ok,
    rounds.stale.detail,
  );
  check(`${p} two pages changing one setting at once end with the later value`, rounds.same.ok, rounds.same.detail);
  check(
    `${p} a settings document written from outside, without stamps, reaches both pages`,
    rounds.foreign.ok,
    rounds.foreign.detail,
  );

  // Panel layout: show a tool panel, move a separator, reload.
  await setMode(a.page, 'simulator');
  await a.page.evaluate(async () => {
    const { showPanel } = await import('/src/state/panels.ts');
    showPanel(window.__easy68k.ctx, 'memory');
  });
  await a.page.waitForSelector('[data-e68-workspace="simulator"] [data-e68-panel="memory"]');
  const focusedPanel = await a.page.evaluate(
    () => document.activeElement?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? null,
  );
  check(`${p} showing a panel moves the focus into it`, focusedPanel === 'memory', `${focusedPanel}`);
  const tabs = await a.page.locator('[data-e68-workspace="simulator"] [role=tab]').allInnerTexts();
  check(
    `${p} the Memory panel appears as a tool tab`,
    same(
      tabs.map((text) => text.trim()),
      ['Memory'],
    ),
    tabs.join(', '),
  );
  check(
    `${p} the other open page keeps its own layout`,
    (await b.page.locator('[data-e68-panel="memory"]').count()) === 0,
  );

  const separator = a.page.locator(
    '[data-e68-workspace="simulator"] [role=separator][aria-label="Resize the two columns"]',
  );
  // The left column's width: the Listing panel spans it (the workspace is a dock since
  // ARCHITECTURE-PLUS, N1; the default arrangement keeps today's columns).
  const widthOf = () =>
    a.page
      .locator('[data-e68-workspace="simulator"] [data-e68-panel="listing"]')
      .first()
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));
  const widthBefore = await widthOf();
  await separator.focus();
  for (let i = 0; i < 5; i++) await a.page.keyboard.press('ArrowRight');
  const widthAfter = await widthOf();
  check(
    `${p} the separator moves with the arrow keys`,
    widthAfter === widthBefore + 50,
    `${widthBefore} -> ${widthAfter}`,
  );
  await a.page.screenshot({ path: join(outDir, `${name}-simulator-tools-dark.png`) });

  // The two layout settings without a control of their own in the shell (the Output panel and the
  // editor set them). The Output zoom is 'fit', 1 or 2: a number must come back as that number.
  await a.page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({
      ...s,
      app: { ...s.app, layout: { ...s.app.layout, outputZoom: 2, editorPanes: 'vertical' } },
    })),
  );

  await a.page.reload();
  await a.page.waitForSelector('.e68-shell');
  await setMode(a.page, 'simulator');
  const layoutReloaded = await a.page.evaluate(() => window.__easy68k.ctx.settings.get().app.layout);
  check(
    `${p} the Output zoom survives a reload`,
    layoutReloaded.outputZoom === 2,
    JSON.stringify(layoutReloaded.outputZoom),
  );
  check(
    `${p} the editor pane arrangement survives a reload`,
    layoutReloaded.editorPanes === 'vertical',
    JSON.stringify(layoutReloaded.editorPanes),
  );
  check(`${p} the theme survives a reload`, (await theme(a.page)) === 'dark');
  check(
    `${p} the visible tool panel survives a reload`,
    (await a.page.locator('[data-e68-workspace="simulator"] [data-e68-panel="memory"]').count()) === 1,
  );
  const widthReloaded = await widthOf();
  check(
    `${p} the separator position survives a reload`,
    Math.abs(widthReloaded - widthAfter) <= 1,
    `${widthAfter} -> ${widthReloaded}`,
  );

  // Double-click restores the default split.
  await a.page
    .locator('[data-e68-workspace="simulator"] [role=separator][aria-label="Resize the two columns"]')
    .dblclick();
  const widthDefault = await widthOf();
  check(
    `${p} a double-click on the separator restores the default`,
    Math.abs(widthDefault - widthBefore) <= 1,
    `${widthDefault} vs ${widthBefore}`,
  );

  // Closing the tool tab hides the panel; the narrow layout puts the columns under each other.
  await a.page.locator('[data-e68-workspace="simulator"] [role=tab]').first().focus();
  await a.page.keyboard.press('Delete');
  await a.page.waitForFunction(
    () => document.querySelector('[data-e68-workspace="simulator"] [data-e68-panel="memory"]') === null,
  );
  check(
    `${p} closing a tool tab hides its panel`,
    (await a.page.evaluate(() => window.__easy68k.ctx.settings.get().app.layout.panels.memory?.visible)) === false,
  );
  await a.page.setViewportSize({ width: 1000, height: 900 });
  // The left column (Registers, Listing, Messages) and below it the right one (the Output panel).
  const columns = () =>
    a.page.evaluate(() => {
      const box = (id) =>
        document.querySelector(`[data-e68-workspace="simulator"] [data-e68-panel="${id}"]`)?.getBoundingClientRect();
      const left = { top: box('registers').top, bottom: box('messages').bottom, left: box('listing').left };
      const right = box('output');
      return right.top >= left.bottom - 1 && Math.abs(right.left - left.left) <= 1;
    });
  await a.page.waitForFunction(
    () => {
      const box = (id) =>
        document.querySelector(`[data-e68-workspace="simulator"] [data-e68-panel="${id}"]`)?.getBoundingClientRect();
      return box('output').top >= box('messages').bottom - 1;
    },
    null,
    { timeout: 15_000 },
  );
  const stacked = await columns();
  const narrowTabs = await a.page.locator('[data-e68-workspace="simulator"] [role=tab]').allInnerTexts();
  check(`${p} below 1100 px the right column moves under the left one`, stacked === true);
  check(
    `${p} below 1100 px the Output panel is a tab of the tool group`,
    same(
      narrowTabs.map((text) => text.trim()),
      ['Output'],
    ),
    narrowTabs.join(', '),
  );
  // Showing the Output panel (Run, a keyboard-input task, View > Output Window) brings its tab to
  // the front while a tool tab is selected (SH4's finding).
  await a.page.evaluate(async () => {
    const { showPanel } = await import('/src/state/panels.ts');
    showPanel(window.__easy68k.ctx, 'memory');
  });
  await a.page.waitForSelector('[data-e68-workspace="simulator"] [data-e68-panel="memory"]:not([hidden])');
  await a.page.evaluate(async () => {
    const { showPanel } = await import('/src/state/panels.ts');
    showPanel(window.__easy68k.ctx, 'output');
  });
  const outputInFront = await a.page
    .waitForFunction(
      () => {
        const output = document.querySelector('[data-e68-workspace="simulator"] [data-e68-panel="output"]');
        const selected = document.querySelector('[data-e68-workspace="simulator"] [role=tab][aria-selected="true"]');
        return output !== null && output.closest('[hidden]') === null && selected?.textContent?.trim() === 'Output'
          ? (document.activeElement?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? 'none')
          : false;
      },
      null,
      { timeout: 5000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => false);
  check(
    `${p} below 1100 px showing the Output panel brings its tab in front of a tool tab and focuses it`,
    outputInFront === 'output',
    `${outputInFront}`,
  );
  await a.page.screenshot({ path: join(outDir, `${name}-simulator-narrow.png`) });

  // The lock of a closed page is free (3.8.6: "a lock that is no longer held means its window is gone").
  await a.page.close();
  await b.page.waitForTimeout(300);
  const afterClose = await locksOf(b.page);
  check(
    `${p} the lock of a closed page is released`,
    afterClose !== null &&
      !afterClose.includes(`easy68k.window.${idA}`) &&
      afterClose.includes(`easy68k.window.${idB}`),
    JSON.stringify(afterClose),
  );

  check(
    `${p} no console or page errors`,
    a.errors.length + b.errors.length === 0,
    [...a.errors, ...b.errors].slice(0, 3).join(' | '),
  );
  await closeWithin(context);
}

/** Accessibility scans and the gallery route. */
async function scanPass(browser, name) {
  const p = `${name}:`;
  for (const themeName of ['light', 'dark']) {
    const context = await newContext(browser, 'windows');
    const { page, errors } = await openApp(context);
    await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), themeName);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, themeName);
    for (const item of ['editor', 'simulator', 'easybin']) {
      await setMode(page, item);
      await scan(page, `${name} ${themeName} ${item}`);
    }
    await page.evaluate(() => {
      void window.__easy68k.ctx.dialogs.messageBox({
        title: 'Caution',
        text: 'Sure?',
        icon: 'warning',
        buttons: ['Yes', 'No'],
      });
    });
    await page.waitForSelector('[role=alertdialog]');
    await scan(page, `${name} ${themeName} message box`);
    check(`${p} ${themeName}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await closeWithin(context);
  }

  const context = await newContext(browser, 'windows');
  const page = await context.newPage();
  await page.goto(`${baseUrl}?gallery`);
  const gallery = await page.waitForSelector('[data-gallery-ready]', { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  check(`${p} ?gallery shows the component kit's gallery`, gallery && (await page.locator('.e68-shell').count()) === 0);
  await closeWithin(context);
}

// --- run -------------------------------------------------------------------------------

async function main() {
  if (!enginesPresent && enginesRequired) {
    console.error('engine/dist is missing and EASY68K_REQUIRE_ENGINES=1: the simulator session cannot start.');
    process.exit(1);
  }
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // A cache of its own: several checks may run on one machine at the same time.
    cacheDir: join(outDir, 'vite-cache'),
    // Port 0: the system picks a free one. No file watching and no hot reload (see the header).
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
        // A pass that throws is one failure; the passes after it still run.
        const pass = async (label, run) => {
          try {
            await run();
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
        };
        for (const os of ['windows', 'mac']) {
          console.log(`\n[${name}, ${os} key map]`);
          await pass(`structure (${os})`, () => structurePass(browser, name, os));
          await pass(`keyboard (${os})`, () => keyboardPass(browser, name, os));
          await pass(`text field keys (${os})`, () => textFieldKeysPass(browser, name, os));
        }
        console.log(`\n[${name}, dialogs]`);
        await pass('dialogs', () => dialogPass(browser, name));
        console.log(`\n[${name}, two pages]`);
        await pass('two pages', () => windowsPass(browser, name));
        console.log(`\n[${name}, accessibility and gallery]`);
        await pass('accessibility and gallery', () => scanPass(browser, name));
      } finally {
        await doneWith(browser, { last: name === browsers.at(-1) });
      }
    }
  } finally {
    closeAtEnd(server);
  }

  if (notes.length > 0) console.log(`\nNotes (not failures):\n${notes.map((text) => `  - ${text}`).join('\n')}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
