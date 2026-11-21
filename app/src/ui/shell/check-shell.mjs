// Browser check of the application shell (ARCHITECTURE.md 9.1, W3 acceptance). Owner: W3.
//
//   node app/src/ui/shell/check-shell.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright), once with the Windows key map and once with the macOS key map
// (the page is told it runs on a Mac before it starts). It checks what unit tests under Node
// cannot show:
//
//   - the application starts with the stub services and shows three modes, without console errors;
//   - the menus and toolbars on screen equal the command tables, and every command without a
//     handler is disabled;
//   - the dispatcher cancels the chords of 2.9.3 (`defaultPrevented` on real key events);
//   - key and code pairs of other keyboards (Option chords such as key 'ø' with code 'KeyO', a
//     QWERTZ and a Russian layout, Insert on the numeric keypad) run the right commands; Ctrl+F4
//     is left to the browser on Windows and is Log Start on macOS;
//   - no command runs while a modal dialog is open, from a key or from a toolbar button; message
//     boxes return the pressed button; a modal dialog of Simulator mode holds the controller;
//   - settings: a `storage` event updates a second page; the theme and the whole panel layout
//     (visible panels, separators, Output zoom, editor panes) survive a reload;
//   - the window lock of 3.8.6 is held while a page lives and is free after it has closed;
//   - the gallery of the component kit is served at ?gallery;
//   - an accessibility scan (axe-core, WCAG 2.0/2.1 A and AA) of the three modes in both themes.
//
// Screenshots go to build/shell-check (git-ignored). Exit code 0 = everything passed.
//
// It lives here rather than in tests/ because W3 owns app/src/ui/shell and tests/e2e belongs to
// X1; docs/requests/W3-shell-check.md asks for a CI job. The page object `window.__easy68k` that
// the script uses exists in development builds only (main.tsx).

/* global console, process, document, window, navigator, KeyboardEvent, Navigator -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { mkdirSync } from 'node:fs';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'shell-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
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

async function openApp(context, query = '') {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}${query}`);
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined);
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

/** Gives handlers to commands that have none yet; each records its id in window.__ran. */
function registerRecorders(page, ids) {
  return page.evaluate((list) => {
    const { commands } = window.__easy68k;
    for (const id of list) {
      if (!commands.hasHandler(id)) commands.register(id, { run: () => void window.__ran.push(id) });
    }
  }, ids);
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

  // What the tables say, resolved in the page by the application's own code.
  const expected = await page.evaluate(async () => {
    const { resolveMenus, resolveToolbar } = await import('/src/commands/menus.ts');
    const { ctx, commands } = window.__easy68k;
    const env = { os: ctx.platform.os, desktop: false, state: ctx.store.getState(), commands };
    const strip = (caption) => caption.replace(/&(.)/g, '$1');
    const flat = (nodes) =>
      nodes.flatMap((node) =>
        node.type === 'separator'
          ? ['---']
          : node.type === 'submenu'
            ? [`${strip(node.caption)} >`]
            : [
                `${strip(node.caption)}${node.shortcut ? ` [${node.shortcut}]` : ''}${node.enabled ? '' : ' (disabled)'}`,
              ],
      );
    const result = {};
    for (const item of ['editor', 'simulator', 'easybin']) {
      result[item] = {
        menus: resolveMenus(item, env).map((menu) => ({ title: strip(menu.caption), items: flat(menu.items) })),
        toolbar: resolveToolbar(item, env).flatMap((entry) =>
          entry.type === 'button'
            ? [`${entry.label}${entry.enabled ? '' : ' (disabled)'}`]
            : entry.type === 'separator'
              ? ['|']
              : [],
        ),
      };
    }
    return result;
  });

  for (const item of ['editor', 'simulator', 'easybin']) {
    await setMode(page, item);
    check(`${p} ${item} mode is shown`, (await mode(page)) === item);
    const shown = await page.locator('[data-e68-workspace]:not([hidden])').getAttribute('data-e68-workspace');
    check(`${p} ${item}: only its workspace is visible`, shown === item, `${shown}`);

    // Toolbar: every button of the table, in order, with its hint as accessible name.
    const toolbar = await page.locator('.e68-shell__toolbar').evaluate((root) =>
      Array.from(root.querySelectorAll('button[data-command], [role=separator]'))
        .filter((element) => element.getAttribute('data-command') !== 'app.theme.set')
        .map((element) =>
          element.matches('[role=separator]')
            ? '|'
            : `${element.getAttribute('aria-label')}${element.disabled ? ' (disabled)' : ''}`,
        ),
    );
    check(
      `${p} ${item}: toolbar equals the table`,
      same(toolbar, expected[item].toolbar),
      same(toolbar, expected[item].toolbar) ? '' : JSON.stringify(toolbar),
    );
    const enabledButtons = toolbar.filter((entry) => entry !== '|' && !entry.endsWith('(disabled)'));
    check(
      `${p} ${item}: every toolbar command without a handler is disabled`,
      enabledButtons.length === 0,
      enabledButtons.join(', '),
    );

    // Menus: open each one with the mouse and read what is on screen.
    const titles = await page.locator('.e68-shell__menubar [role=menuitem]').allTextContents();
    check(
      `${p} ${item}: menu bar titles`,
      same(
        titles,
        expected[item].menus.map((menu) => menu.title),
      ),
      titles.join(', '),
    );
    let menusEqual = true;
    let detail = '';
    const enabledItems = [];
    for (const [index, menu] of expected[item].menus.entries()) {
      await page.locator('.e68-shell__menubar [role=menuitem]').nth(index).click();
      const popup = page.locator('[role=menu][data-e68-menu]').first();
      await popup.waitFor();
      const items = await popup.evaluate((root) =>
        Array.from(root.children).flatMap((element) => {
          if (element.matches('[role=separator]')) return ['---'];
          const role = element.getAttribute('role');
          if (!role || !role.startsWith('menuitem')) return [];
          const caption = element.querySelector('.e68-menu__caption')?.textContent ?? element.textContent ?? '';
          const shortcut = element.querySelector('.e68-menu__shortcut')?.textContent ?? '';
          const submenu = element.getAttribute('aria-haspopup') === 'menu';
          const disabled = element.getAttribute('aria-disabled') === 'true';
          return [
            `${caption.trim()}${submenu ? ' >' : ''}${shortcut ? ` [${shortcut.trim()}]` : ''}${disabled && !submenu ? ' (disabled)' : ''}`,
          ];
        }),
      );
      if (!same(items, menu.items)) {
        menusEqual = false;
        detail = `${menu.title}: ${JSON.stringify(items)} expected ${JSON.stringify(menu.items)}`;
      }
      enabledItems.push(
        ...items.filter((entry) => entry !== '---' && !entry.endsWith(' >') && !entry.endsWith('(disabled)')),
      );
      if (index === 0 && item !== 'easybin')
        await page.screenshot({ path: join(outDir, `${name}-${os}-${item}-menu.png`) });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    check(`${p} ${item}: menus on screen equal the tables`, menusEqual, detail);
    check(
      `${p} ${item}: every menu command without a handler is disabled`,
      enabledItems.length === 0,
      enabledItems.join(', '),
    );
    await page.screenshot({ path: join(outDir, `${name}-${os}-${item}.png`) });
  }

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
  await context.close();
}

/** The chords of 2.9.3 and recorded key and code pairs. */
async function keyboardPass(browser, name, os) {
  const p = `${name}/${os}:`;
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context);
  const mac = os === 'mac';

  // 2.9.3: F5, F6, F7, F10 and Ctrl+O/S/P/F/G/R are cancelled, whatever the mode, also while no
  // command has a handler. On macOS the Cmd forms too.
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
  for (const item of ['editor', 'simulator', 'easybin']) {
    await setMode(page, item);
    const notCancelled = [];
    for (const combination of guarded) {
      if ((await pressed(page, combination)) !== true) notCancelled.push(combination);
    }
    check(
      `${p} ${item}: the chords of 2.9.3 have defaultPrevented`,
      notCancelled.length === 0,
      notCancelled.join(', '),
    );
  }
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

  // Real keys run commands once they have handlers.
  const ids = [
    'ed.file.open',
    'ed.file.save',
    'ed.file.saveAs',
    'ed.edit.undo',
    'ed.edit.redo',
    'ed.edit.comment',
    'ed.edit.uncomment',
    'ed.edit.findNext',
    'ed.edit.toggleInsert',
    'ed.project.assemble',
    'sim.file.open',
    'sim.run.run',
    'sim.run.rewind',
    'sim.run.logStart',
    'sim.search.find',
  ];
  await registerRecorders(page, ids);
  await setMode(page, 'editor');
  const cmd = mac ? 'Meta' : 'Control';
  await page.keyboard.press(`${cmd}+KeyS`);
  await page.keyboard.press('F9');
  await setMode(page, 'simulator');
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
        [
          'QWERTZ, Ctrl+Alt + the Z position: key y',
          { ...none, key: 'y', code: 'KeyZ', ctrlKey: true, altKey: true },
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
          'Insert on the keypad (0 with NumLock off): key Insert, code Numpad0',
          { ...none, key: 'Insert', code: 'Numpad0' },
          'ed.edit.toggleInsert',
        ],
      ];
  for (const [label, init, command] of pairs) {
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

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** Modal dialogs: nothing runs, message boxes answer, the controller is held. */
async function dialogPass(browser, name) {
  const p = `${name}:`;
  const context = await newContext(browser, 'windows');
  const { page, errors } = await openApp(context);
  await registerRecorders(page, ['ed.file.save', 'sim.run.run']);
  await page.locator('.e68-modeswitch [data-mode="editor"]').focus();

  await page.keyboard.press('Control+KeyS');
  check(`${p} Ctrl+S runs Save while no dialog is open`, same(await ran(page), ['ed.file.save']));
  const saveButton = page.locator('.e68-shell__toolbar [data-command="ed.file.save"]');
  check(`${p} the Save button is enabled once the command has a handler`, await saveButton.isEnabled());
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

  // A toast.
  await page.evaluate(() => window.__easy68k.ctx.dialogs.toast('The program is waiting for keyboard input'));
  check(`${p} a toast appears`, (await page.locator('.e68-toast').count()) === 1);

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
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

  // Two pages writing in turn do not lose each other's settings.
  await a.page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, fontSize: 14 } })),
  );
  await b.page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({ ...s, sim: { ...s.sim, bitField: true } })),
  );
  await a.page.evaluate(() =>
    window.__easy68k.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, realTabs: true } })),
  );
  const stored = await a.page.evaluate(() => JSON.parse(window.localStorage.getItem('easy68k.settings.v1') ?? '{}'));
  check(
    `${p} settings survive two pages writing in turn`,
    stored.editor?.fontSize === 14 &&
      stored.editor?.realTabs === true &&
      stored.sim?.bitField === true &&
      stored.app?.theme === 'dark',
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
  const widthOf = () =>
    a.page
      .locator('[data-e68-workspace="simulator"] .e68-simws__column')
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
  await a.page.waitForFunction(() => document.querySelector('.e68-simws')?.getAttribute('data-narrow') === 'true');
  const stacked = await a.page.evaluate(() => {
    const [left, right] = Array.from(
      document.querySelectorAll('[data-e68-workspace="simulator"] .e68-simws__column'),
    ).map((element) => element.getBoundingClientRect());
    return right.top >= left.bottom - 1 && Math.abs(right.left - left.left) <= 1;
  });
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
  await context.close();
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
    await context.close();
  }

  const context = await newContext(browser, 'windows');
  const page = await context.newPage();
  await page.goto(`${baseUrl}?gallery`);
  const gallery = await page.waitForSelector('[data-gallery-ready]', { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  check(`${p} ?gallery shows the component kit's gallery`, gallery && (await page.locator('.e68-shell').count()) === 0);
  await context.close();
}

// --- run -------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    server: { port: 5198, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5198;
  baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        for (const os of ['windows', 'mac']) {
          console.log(`\n[${name}, ${os} key map]`);
          await structurePass(browser, name, os);
          await keyboardPass(browser, name, os);
        }
        console.log(`\n[${name}, dialogs]`);
        await dialogPass(browser, name);
        console.log(`\n[${name}, two pages]`);
        await windowsPass(browser, name);
        console.log(`\n[${name}, accessibility and gallery]`);
        await scanPass(browser, name);
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
