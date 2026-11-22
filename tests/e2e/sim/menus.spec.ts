// Simulator mode's menu bar, toolbar, View and Help items, the panel cycle and the option check items
// (ARCHITECTURE.md 1.3.4, 1.3.5 rows "Toolbar", "F1 in the main window ...", "Ctrl+Tab window
// cycle", "Shortcuts act while any simulator window has the focus", "Status bar"; 1.4 notes 10, 11,
// 26, 30, 34; sim-ui §3.1, §3.2, §3.4, §14.1, §16). Owner: X2.
//
// The expected captions, access keys, order and shortcuts are written here from the specification,
// not read from the application's tables, so that a change of a table is caught.

import { expect, test, type App, type KeyMap } from '../fixtures';
import { execute, panel, program, switchMode, view, workspace, step } from './sim';

/** A menu row: caption with `&` before the access key, and the shortcut on each key map. */
type Row = [caption: string, windows?: string, mac?: string];

const MENUS: Record<string, Row[]> = {
  File: [['&Open...', 'Ctrl+O', 'Cmd+O'], ['Open &Data...'], ['&Close'], ['&Printer Setup...'], ['E&xit']],
  Search: [
    ['&Find...', 'Ctrl+F', 'Cmd+F'],
    ['&Go to PC', 'Ctrl+G', 'Cmd+G'],
  ],
  Run: [
    ['&Run', 'F9', 'F9'],
    ['Run To &Cursor', 'Ctrl+F9', 'Ctrl+F9'],
    ['&Auto Trace', 'F10', 'F10'],
    ['&Step Over', 'F8', 'F8'],
    ['&Trace Into', 'F7', 'F7'],
    ['&Pause', 'F6', 'F6'],
    ['R&ewind Program', 'Ctrl+F2', 'Shift+F2'],
    ['Re&load Program', 'Ctrl+F3', 'Shift+F3'],
    // Ctrl+F4 closes a browser tab on Windows and Linux (1.4 note 25): the Shift form is shown there.
    ['L&og Start', 'Shift+F4', 'Shift+F4'],
    ['Lo&g Stop', 'Ctrl+F5', 'Shift+F5'],
  ],
  View: [['&Output Window'], ['&Memory'], ['&Stack'], ['&Hardware'], ['&Break Points'], ['&EASyBIN']],
  Options: [
    ['Source Window Font...'],
    ['Output Window Font...'],
    ['Printer Font...'],
    ['&Log Output...'],
    ['&Enable Exceptions'],
    ['&Auto Trace Options...'],
    ['&Fullscreen Options...'],
    ['Enable &Bit Field Instructions'],
    ['Output Window &Size'],
    ['Output Window Text &Wrap'],
  ],
  Help: [['&Sim68K Help'], ['&About Sim68K']],
};

/** Items the port added after the original's items of a menu (1.5), in order. */
const ADDED: Record<string, string[]> = {
  // ARCHITECTURE-PLUS P3.1.4 (N1): the layout commands, below a separator after Log.
  View: ['Log', 'Move Panel To...', 'Lock Layout', 'Reset Layout'],
  // Serial Ports... is the desktop app's (erratum W3 43): shown greyed in a browser.
  // ARCHITECTURE-PLUS P3.5 (N7): Port Additions..., below a separator, last.
  Options: ['Import/Export Settings...', 'Execution Speed...', 'Serial Ports...', 'Port Additions...'],
  Help: ['Examples...', 'Differences from EASy68K'],
};

/** Added items that a browser shows greyed: they act in the desktop app only (1.5). */
const DESKTOP_ONLY = new Set(['Serial Ports...']);

/** Added items that stand below a separator of their own (1.5), and the item they follow. */
const AFTER_SEPARATOR: Record<string, string> = {
  'Serial Ports...': 'Execution Speed...',
  'Move Panel To...': 'Log',
  'Port Additions...': 'Serial Ports...',
};

const SIZES = [
  '640x480',
  '800x600',
  '1024x768',
  '1280x800',
  '1280x1024',
  '1440x900',
  '1680x1050',
  '1920x1080',
  '1920x1200',
];

/** The toolbar of sim-ui §3.2: command ids and hints, left to right. */
const TOOLBAR: [id: string, hint: string][] = [
  ['sim.file.open', 'Open'],
  ['sim.run.run', 'Run'],
  ['sim.run.runToCursor', 'Run To Cursor'],
  ['sim.run.autoTrace', 'Auto Trace'],
  ['sim.run.stepOver', 'Step Over'],
  ['sim.run.traceInto', 'Trace Into'],
  ['sim.run.pause', 'Pause'],
  ['sim.run.rewind', 'Rewind Program'],
  ['sim.run.reload', 'Reload Program'],
  ['sim.run.logStart', 'Log Start'],
  ['sim.run.logStop', 'Log Stop'],
];

const plain = (caption: string) => caption.replace(/&(.)/g, '$1');
const accessKey = (caption: string) => /&(.)/.exec(caption)?.[1] ?? null;
const shownKey = (caption: string, keys: KeyMap) => (keys === 'mac' ? null : accessKey(caption));
const shortcutOn = (row: Row, keys: KeyMap) => (keys === 'mac' ? row[2] : row[1]) ?? '';

const simulatorMode = (app: App) => switchMode(app, 'Simulator');

/** The id of the panel that holds the keyboard focus. */
async function focusedPanel(app: App): Promise<string | null> {
  return app.page.evaluate(() => {
    const element = document.activeElement?.closest('[data-e68-panel]');
    return element instanceof HTMLElement ? (element.dataset.e68Panel ?? null) : null;
  });
}

/** The page the Help panel shows (its frame's address), or null. */
async function helpPage(app: App): Promise<string | null> {
  const frame = app.page.locator('[data-e68-panel="help"] iframe');
  if ((await frame.count()) === 0) return null;
  // The panel may move its frame from page to page without changing the src attribute.
  const content = await (await frame.first().elementHandle())?.contentFrame();
  return content?.url() ?? frame.first().getAttribute('src');
}

test.describe('menu bar', () => {
  test.beforeEach(async ({ app }) => {
    await simulatorMode(app);
  });

  test('the six menus of Sim68K, in order, with their access keys (not shown on macOS)', async ({ app }) => {
    const titles = await app.page
      .locator('.e68-shell__menubar .e68-menubar__title')
      .evaluateAll((items) =>
        items.map((item) => [item.textContent, item.querySelector('.e68-mnemonic')?.textContent ?? null]),
      );
    expect(titles).toEqual(
      ['&File', '&Search', '&Run', '&View', '&Options', '&Help'].map((caption) => [
        plain(caption),
        shownKey(caption, app.keys),
      ]),
    );
  });

  for (const [title, rows] of Object.entries(MENUS)) {
    test(`${title}: the original's items in order, with this key map's shortcuts, then the port's additions`, async ({
      app,
    }) => {
      const menu = await app.openMenu(title);
      const entries = await app.entriesOf(menu);
      const original = entries.slice(0, rows.length);
      expect(original.map((e) => e.caption)).toEqual(rows.map(([caption]) => plain(caption)));
      expect(original.map((e) => e.shortcut)).toEqual(rows.map((row) => shortcutOn(row, app.keys)));
      const keys = await menu
        .locator(':scope > [role^=menuitem]')
        .evaluateAll((items) => items.map((item) => item.querySelector('.e68-mnemonic')?.textContent ?? null));
      expect(keys.slice(0, rows.length)).toEqual(rows.map(([caption]) => shownKey(caption, app.keys)));
      const added = entries.slice(rows.length);
      expect(added.map((e) => e.caption)).toEqual(ADDED[title] ?? []);
      // Each added item is enabled in a browser, except the desktop app's, which is greyed.
      expect(added.map((e) => [e.caption, e.disabled])).toEqual(
        (ADDED[title] ?? []).map((caption) => [caption, DESKTOP_ONLY.has(caption)]),
      );
      // The order of items and separators: an item of AFTER_SEPARATOR follows its item and a separator.
      const sequence = await menu
        .locator(':scope > [role^=menuitem], :scope > [role=separator]')
        .evaluateAll((items) =>
          items.map((item) =>
            item.getAttribute('role') === 'separator'
              ? '-'
              : (item.querySelector('.e68-menu__caption')?.textContent ?? ''),
          ),
        );
      for (const caption of ADDED[title] ?? []) {
        const before = AFTER_SEPARATOR[caption];
        if (!before) continue;
        const at = sequence.indexOf(caption);
        expect(sequence.slice(at - 2, at + 1), `${caption} below a separator after ${before}`).toEqual([
          before,
          '-',
          caption,
        ]);
      }
      await app.page.keyboard.press('Escape');
    });
  }
});

test('Output Window Size: nine radio items, the check mark follows the real size, the surface takes it', async ({
  app,
}) => {
  await simulatorMode(app);
  const sizes = async () => {
    const menu = await app.openMenu('Options');
    await app.menuItem(menu, 'Output Window Size').click();
    const sub = app.openMenuList;
    await expect(sub).toBeVisible();
    const entries = await app.entriesOf(sub);
    return { sub, entries };
  };
  const first = await sizes();
  expect(first.entries.map((e) => e.caption)).toEqual(SIZES);
  expect(first.entries.map((e) => e.role)).toEqual(SIZES.map(() => 'menuitemradio'));
  expect(first.entries.filter((e) => e.checked).map((e) => e.caption)).toEqual(['640x480']);
  await app.menuItem(first.sub, '800x600').click();
  await expect(panel(app, 'output').locator('.e68-output__size')).toHaveText('800x600');
  await expect
    .poll(() =>
      panel(app, 'output')
        .locator('canvas')
        .evaluate((c: HTMLCanvasElement) => `${c.width}x${c.height}`),
    )
    .toBe('800x600');
  const second = await sizes();
  expect(second.entries.filter((e) => e.checked).map((e) => e.caption)).toEqual(['800x600']);
  await app.page.keyboard.press('Escape');
  await app.page.keyboard.press('Escape');
});

test('the toolbar: eleven buttons in the original order with its hints and this key map shortcut', async ({ app }) => {
  await simulatorMode(app);
  const ids = await app.page
    .locator('.e68-shell__toolbar [data-command^="sim."]')
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('data-command')));
  expect(ids).toEqual(TOOLBAR.map(([id]) => id));
  for (const [id, hint] of TOOLBAR) {
    const shortcut = shortcutOn(
      Object.values(MENUS)
        .flat()
        .find(([caption]) => plain(caption).replace(/\.\.\.$/, '') === hint) ?? [hint],
      app.keys,
    );
    await expect(app.toolbarButton(id), id).toHaveAccessibleName(shortcut ? `${hint} (${shortcut})` : hint);
  }
  // No log file is open: no LOGGING label.
  await expect(app.page.locator('.e68-shell__toolbar').getByText('LOGGING', { exact: true })).toHaveCount(0);
});

test('View shows and focuses each tool panel; Output Window focuses the Output panel', async ({ app }) => {
  await simulatorMode(app);
  for (const [caption, id] of [
    ['Memory', 'memory'],
    ['Stack', 'stack'],
    ['Hardware', 'hardware'],
    ['Break Points', 'breakpoints'],
    ['Log', 'log'],
  ] as const) {
    await view(app, caption, id);
    await expect.poll(() => focusedPanel(app), `View > ${caption} focuses its panel`).toBe(id);
  }
  // The Output panel can be collapsed, not closed (1.4 note 35); View > Output Window shows it again.
  await panel(app, 'output').getByRole('button', { name: 'Collapse the Output panel' }).click();
  await expect(panel(app, 'output').locator('canvas')).toBeHidden();
  await app.chooseMenu('View', 'Output Window');
  await expect(panel(app, 'output').locator('canvas')).toBeVisible();
  await expect.poll(() => focusedPanel(app)).toBe('output');
});

test('View > EASyBIN switches to EASyBIN mode (note 26)', async ({ app }) => {
  await simulatorMode(app);
  await app.chooseMenu('View', 'EASyBIN');
  await expect.poll(() => app.mode()).toBe('easybin');
});

test('F2 moves through the visible panels in the order of the original Ctrl+Tab; Ctrl+Alt+O leaves the Output panel (note 30)', async ({
  app,
  page,
}) => {
  await execute(app, program('    SIMHALT'));
  await view(app, 'Memory', 'memory');
  await view(app, 'Stack', 'stack');
  await view(app, 'Hardware', 'hardware');
  await view(app, 'Break Points', 'breakpoints');
  await panel(app, 'listing').locator('[role=listbox]').focus();
  const seen: (string | null)[] = [];
  await app.press('sim.panel.next');
  await expect.poll(() => focusedPanel(app)).toBe('output');
  seen.push(await focusedPanel(app));
  // F2 belongs to the program in the Output panel (K5): the release chord moves on.
  await app.press('sim.output.releaseKeyboard');
  await expect.poll(() => focusedPanel(app)).toBe('memory');
  seen.push(await focusedPanel(app));
  for (const next of ['stack', 'hardware', 'breakpoints', 'listing']) {
    await app.press('sim.panel.next');
    await expect.poll(() => focusedPanel(app), `F2 after ${seen.at(-1)}`).toBe(next);
    seen.push(next);
  }
  expect(seen).toEqual(['output', 'memory', 'stack', 'hardware', 'breakpoints', 'listing']);
  void page;
});

test('F1 opens the help page of the panel that has the focus (note 10)', async ({ app }) => {
  await execute(app, program('    SIMHALT'));
  await panel(app, 'listing').locator('[role=listbox]').focus();
  await app.press('sim.help.context');
  await expect.poll(() => helpPage(app)).toMatch(/SIMHELP\/BasicOperation\.htm/i);
  for (const [caption, id, page] of [
    ['Memory', 'memory', 'Memory'],
    ['Stack', 'stack', 'Stack'],
    ['Hardware', 'hardware', 'Hardware'],
    ['Break Points', 'breakpoints', 'AdvBreakpoints'],
  ] as const) {
    await view(app, caption, id);
    await expect.poll(() => focusedPanel(app), `View > ${caption} focuses its panel`).toBe(id);
    await app.press('sim.help.context');
    await expect
      .poll(() => helpPage(app), `F1 in the ${caption} panel`)
      .toMatch(new RegExp(`SIMHELP/${page}\\.htm`, 'i'));
  }
});

test('Help > Sim68K Help opens the simulator page; About Sim68K shows the original texts and the notice', async ({
  app,
}) => {
  await simulatorMode(app);
  await app.chooseMenu('Help', 'Sim68K Help');
  await expect.poll(() => helpPage(app)).toMatch(/SIMHELP\/BasicOperation\.htm/i);
  await app.chooseMenu('Help', 'About Sim68K');
  const about = app.page.locator('[role=dialog]').filter({ hasText: 'EASy68K Simulator v5.16.1' });
  await expect(about).toBeVisible();
  const text = await about.innerText();
  for (const line of [
    'GUI implemenation: Charles Kelly',
    'Original simulator code: Paul McKee',
    'Simulator code modification: Charles Kelly, Eric Nelson',
    'www.easy68k.com',
    'Use the EASy68K forum to submit bug reports.',
  ]) {
    expect(text, `the About box contains "${line}"`).toContain(line);
  }
  expect(text, 'the port names itself unofficial (note 11)').toMatch(/unofficial/i);
  await app.button(about, 'OK').click();
  await expect(about).toBeHidden();
});

test('Help > Differences from EASy68K (added) opens the port page of differences in the Help panel', async ({
  app,
}) => {
  await simulatorMode(app);
  await app.chooseMenu('Help', 'Differences from EASy68K');
  await expect.poll(() => helpPage(app)).toMatch(/Port\/differences\.htm/i);
});

test('Enable Exceptions and Enable Bit Field Instructions are check items shown in the status bar (note 34)', async ({
  app,
}) => {
  await simulatorMode(app);
  const exceptions = app.page.locator('[data-e68-status="exceptions"]');
  const bitField = app.page.locator('[data-e68-status="bitField"]');
  await expect(exceptions).toHaveText('exceptions off');
  await expect(bitField).toHaveText('bit field off');
  await app.chooseMenu('Options', 'Enable Exceptions');
  await expect(exceptions).toHaveText('exceptions on');
  await app.chooseMenu('Options', 'Enable Bit Field Instructions');
  await expect(bitField).toHaveText('bit field on');
  const entries = await app.menuEntries('Options');
  expect(entries.find((e) => e.caption === 'Enable Exceptions')?.checked).toBe(true);
  expect(entries.find((e) => e.caption === 'Enable Bit Field Instructions')?.checked).toBe(true);
  expect(entries.find((e) => e.caption === 'Output Window Text Wrap')?.checked).toBe(false);
  await expect(app.page.locator('[data-e68-status="speed"]')).toHaveText('speed: EASy68K-like');
});

test('a run shortcut acts while another simulator panel has the focus', async ({ app }) => {
  await execute(app, program('    MOVE.L  #$AA,D3', '    SIMHALT'));
  await view(app, 'Memory', 'memory');
  await expect.poll(() => focusedPanel(app)).toBe('memory');
  await step(app);
  await expect(panel(app, 'registers').locator('input[data-box="3"]')).toHaveValue('000000AA');
  await expect(workspace(app)).toBeVisible();
});
