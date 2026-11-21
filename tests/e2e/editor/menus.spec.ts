// The Editor's menu bar, toolbar and context menu (ARCHITECTURE.md 1.3.1, 1.3.2, 1.5, notes 9, 14;
// editor-ui §2, §3, §4). Owner: X1.
//
// The expected captions, access keys, order and shortcuts are written here from the specification,
// not read from the application's tables, so that a change of a table is caught.

import { expect, test, type App, type KeyMap } from '../fixtures';

/** A menu row: caption with `&` before the access key, and the shortcut on each key map. */
type Row = [caption: string, windows?: string, mac?: string];

const MENUS: Record<string, Row[]> = {
  File: [
    ['&New X68 Source File'],
    ['&Open File...', 'Ctrl+O', 'Cmd+O'],
    ['&Save', 'Ctrl+S', 'Cmd+S'],
    ['Save &As...', '', 'Shift+Cmd+S'],
    ['&Print', 'Ctrl+P', 'Cmd+P'],
    ['Printer Setup...'],
    ['C&lose File'], // Cmd+W only in the desktop app
    ['E&xit'], // Cmd+Q only in the desktop app
  ],
  Edit: [
    ['&Undo', 'Ctrl+Z', 'Cmd+Z'],
    ['&Redo', 'Ctrl+Alt+Z', 'Shift+Cmd+Z'],
    ['Cu&t', 'Ctrl+X', 'Cmd+X'],
    ['&Copy', 'Ctrl+C', 'Cmd+C'],
    ['&Paste', 'Ctrl+V', 'Cmd+V'],
    ['Select &All', 'Ctrl+A', 'Cmd+A'],
    ['C&omment Selection', 'Ctrl+Alt+C', 'Cmd+/'],
    ['Unco&mment Selection', 'Ctrl+Alt+U', 'Shift+Cmd+/'],
    ['&Find...', 'Ctrl+F', 'Cmd+F'],
    ['Find &Next', 'F3', 'F3'],
    ['Find And &Replace...', 'Ctrl+R', 'Ctrl+R'],
  ],
  Project: [['&Assemble Source...', 'F9', 'F9']],
  Options: [
    ['&Assembler Options...'],
    ['&Editor Options...'], // Cmd+, only in the desktop app
  ],
  Window: [['&Arrange'], ['&Cascade'], ['Tile &Horizontally'], ['&Tile Vertically'], ['&Minimize All']],
  Help: [['Hel&p'], ['&About']],
};

/** Items the port added after the original's items of a menu (1.5), in order. */
const ADDED: Record<string, string[]> = {
  Options: ['Import/Export Settings...'],
  Help: ['Examples...', 'Differences from EASy68K'],
};

const plain = (caption: string) => caption.replace(/&(.)/g, '$1');
const accessKey = (caption: string) => /&(.)/.exec(caption)?.[1] ?? null;
const shortcutOn = (row: Row, keys: KeyMap) => (keys === 'mac' ? row[2] : row[1]) ?? '';

test.describe('menu bar', () => {
  test('the six menus of the original, in order, with their access keys', async ({ app }) => {
    const titles = await app.page
      .locator('.e68-shell__menubar .e68-menubar__title')
      .evaluateAll((items) =>
        items.map((item) => [item.textContent, item.querySelector('.e68-mnemonic')?.textContent ?? null]),
      );
    expect(titles).toEqual([
      ['File', 'F'],
      ['Edit', 'E'],
      ['Project', 'P'],
      ['Options', 'O'],
      ['Window', 'W'],
      ['Help', 'H'],
    ]);
  });

  for (const [title, rows] of Object.entries(MENUS)) {
    test(`${title}: the original's items in order, with access keys and this key map's shortcuts`, async ({ app }) => {
      const menu = await app.openMenu(title);
      const entries = await app.entriesOf(menu);
      const original = entries.slice(0, rows.length);
      expect(original.map((e) => e.caption)).toEqual(rows.map(([caption]) => plain(caption)));
      expect(original.map((e) => e.shortcut)).toEqual(rows.map((row) => shortcutOn(row, app.keys)));
      const keys = await menu
        .locator(':scope > [role^=menuitem]')
        .evaluateAll((items) => items.map((item) => item.querySelector('.e68-mnemonic')?.textContent ?? null));
      expect(keys.slice(0, rows.length)).toEqual(rows.map(([caption]) => accessKey(caption)));
      const added = ADDED[title];
      if (added) expect(entries.slice(rows.length).map((e) => e.caption)).toEqual(added);
      await app.page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    });
  }

  test('Window: Arrange and Minimize All are shown and always disabled; the documents follow with a check on the active one (note 9)', async ({
    app,
  }) => {
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames()).toHaveLength(2);
    const entries = await app.menuEntries('Window');
    expect(entries.find((e) => e.caption === 'Arrange')?.disabled).toBe(true);
    expect(entries.find((e) => e.caption === 'Minimize All')?.disabled).toBe(true);
    const documents = entries.slice(5);
    expect(documents.map((e) => [e.caption, e.role, e.checked])).toEqual([
      ['1 untitled1.x68', 'menuitemradio', false],
      ['2 untitled2.x68', 'menuitemradio', true],
    ]);
    await app.chooseMenu('Window', '1 untitled1.x68');
    await expect.poll(async () => (await app.tabs()).find((tab) => tab.selected)?.name).toBe('untitled1.x68');
    const after = (await app.menuEntries('Window')).slice(5);
    expect(after.map((e) => e.checked)).toEqual([true, false]);
  });

  test('the menus open from the keyboard: Alt+letter on Windows and Linux (note 14), arrows and Enter', async ({
    app,
    page,
  }) => {
    test.skip(app.keys === 'mac', 'macOS has no menu access keys (1.3.2)');
    await app.focusEditor();
    await page.keyboard.press('Alt+KeyF');
    await expect(app.openMenuList).toBeVisible();
    expect((await app.entriesOf(app.openMenuList))[0]?.caption).toBe('New X68 Source File');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await app.entriesOf(app.openMenuList))[0]?.caption).toBe('Undo');
    await page.keyboard.press('Escape');
    await expect(app.page.locator('[role=menu][data-e68-menu]')).toHaveCount(0);
    await page.keyboard.press('Alt+KeyF');
    await expect(app.openMenuList).toBeVisible();
    await page.keyboard.press('Enter'); // the first item: New X68 Source File
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68']);
  });
});

test.describe('toolbar (editor-ui §3)', () => {
  const BUTTONS: [id: string, hint: string, windows: string, mac: string][] = [
    ['ed.file.new', 'New X68 Source File', '', ''],
    ['|', '', '', ''],
    ['ed.file.open', 'Open File', 'Ctrl+O', 'Cmd+O'],
    ['ed.file.save', 'Save File', 'Ctrl+S', 'Cmd+S'],
    ['ed.file.print', 'Print', 'Ctrl+P', 'Cmd+P'],
    ['|', '', '', ''],
    ['ed.edit.find', 'Find', 'Ctrl+F', 'Cmd+F'],
    ['|', '', '', ''],
    ['ed.edit.cut', 'Cut', 'Ctrl+X', 'Cmd+X'],
    ['ed.edit.copy', 'Copy', 'Ctrl+C', 'Cmd+C'],
    ['ed.edit.paste', 'Paste', 'Ctrl+V', 'Cmd+V'],
    ['|', '', '', ''],
    ['ed.edit.undo', 'Undo', 'Ctrl+Z', 'Cmd+Z'],
    ['ed.edit.redo', 'Redo', 'Ctrl+Alt+Z', 'Shift+Cmd+Z'],
    ['|', '', '', ''],
    ['ed.edit.comment', 'Comment Selection', 'Ctrl+Alt+C', 'Cmd+/'],
    ['ed.edit.uncomment', 'Uncomment Selection', 'Ctrl+Alt+U', 'Shift+Cmd+/'],
    ['|', '', '', ''],
    ['ed.project.assemble', 'Assemble Source', 'F9', 'F9'],
  ];

  test("13 buttons and 6 separators in the original order, named by their hint and this key map's shortcut", async ({
    app,
  }) => {
    const items = await app.page.locator('.e68-shell__toolbar').evaluate((toolbar) => {
      const out: string[][] = [];
      for (const element of toolbar.querySelectorAll('[data-command], [role=separator]')) {
        if (element.getAttribute('role') === 'separator') out.push(['|', '']);
        else out.push([element.getAttribute('data-command') ?? '', element.getAttribute('aria-label') ?? '']);
      }
      return out;
    });
    // The mode's own buttons: from New X68 Source File to Assemble Source (the Files and Theme
    // buttons are the port's additions around them, 1.5).
    const first = items.findIndex(([id]) => id === 'ed.file.new');
    const last = items.findIndex(([id]) => id === 'ed.project.assemble');
    const own = items.slice(first, last + 1);
    expect(own.map(([id]) => id)).toEqual(BUTTONS.map(([id]) => id));
    expect(own.filter(([id]) => id !== '|')).toHaveLength(13);
    expect(own.filter(([id]) => id === '|')).toHaveLength(6);
    const names = own.filter(([id]) => id !== '|').map(([, name]) => name);
    expect(names).toEqual(
      BUTTONS.filter(([id]) => id !== '|').map(([, hint, windows, mac]) => {
        const shortcut = app.keys === 'mac' ? mac : windows;
        return shortcut ? `${hint} (${shortcut})` : hint;
      }),
    );
  });

  test('New and Open act from the toolbar', async ({ app }) => {
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68']);
    await app.toolbarButton('ed.file.open').click();
    await expect(app.dialog('Open File')).toBeVisible();
    await app.page.keyboard.press('Escape');
    await expect(app.dialog('Open File')).toBeHidden();
  });
});

test.describe('context menus (editor-ui §4)', () => {
  test('the editor context menu holds the nine items of the original, Reload File last', async ({ app }) => {
    await app.content().click({ button: 'right' });
    const entries = await app.entriesOf(app.openMenuList);
    expect(entries.map((e) => e.caption)).toEqual([
      'Undo',
      'Redo',
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Comment Selection',
      'Uncomment Selection',
      'Reload File',
    ]);
    await app.page.keyboard.press('Escape');
    await expect(app.page.locator('[role=menu][data-e68-menu]')).toHaveCount(0);
  });

  test('Comment Selection from the context menu acts on the selection', async ({ app }) => {
    await app.replaceText('a\nb');
    await app.select(0, 3);
    await app.content().click({ button: 'right', position: { x: 5, y: 5 } });
    // A right-click keeps a selection it lands outside of only in some editors; select again.
    if ((await app.selection()).to - (await app.selection()).from !== 3) {
      await app.page.keyboard.press('Escape');
      await app.select(0, 3);
      await app.content().click({ button: 'right', position: { x: 2, y: 2 } });
    }
    await app.menuItem(app.openMenuList, 'Comment Selection').click();
    await expect.poll(() => app.text()).toBe('*a\n*b');
  });
});

/** Opens the About box from the Help menu. */
async function about(app: App) {
  await app.chooseMenu('Help', 'About');
  const dialog = app.dialog('About EASy68K');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Help and About (notes 10, 11)', () => {
  test('Help > Help opens the Help panel at the introduction page (main.htm)', async ({ app }) => {
    await app.chooseMenu('Help', 'Help');
    const panel = app.page.locator('[data-e68-panel="help"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.e68-help__title')).toHaveText('Easy68k Introduction');
    await expect
      .poll(() =>
        panel.locator('iframe').evaluate((frame: HTMLIFrameElement) => frame.contentWindow?.location.pathname),
      )
      .toMatch(/\/help\/main\.htm$/);
  });

  test('F1 in the editor opens the help page of the word at the caret (editor-ui §15.3)', async ({ app, page }) => {
    await app.replaceText('    MOVE.B  D0,D1');
    await app.select(6);
    await page.keyboard.press('F1');
    const panel = app.page.locator('[data-e68-panel="help"]');
    await expect(panel).toBeVisible();
    await expect
      .poll(() =>
        panel.locator('iframe').evaluate((frame: HTMLIFrameElement) => frame.contentWindow?.location.pathname),
      )
      .toMatch(/\/help\/Reference\/68ks4d\.htm$/);
  });

  test('About: the original credits and the port notice; Enter presses OK, Esc closes too', async ({ app, page }) => {
    let dialog = await about(app);
    const text = await dialog.innerText();
    for (const line of [
      'EASy68K Editor/Assembler v5.16.01',
      'GUI design: Tim Larson',
      'Original assembler code: Paul McKee',
      'Modifications and New Features: Charles Kelly',
      'Check for update?',
      'unofficial web and macOS port',
    ])
      expect(text).toContain(line);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    dialog = await about(app);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
