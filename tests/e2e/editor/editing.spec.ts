// Editing: tab model, auto indent, comment and indent, Insert/Replace, status bar, undo and redo,
// clipboard (ARCHITECTURE.md 1.3.1 Edit rows, 1.3.2 key rows, 1.3.3 editing rows, 2.4, notes 5, 6,
// 12, 13; editor-ui §8, §20.3). Owner: X1.
//
// Rows that need a setting of the Editor Options dialog (Real Tabs, Auto Indent off) are in
// options.spec.ts, which waits for E4.

import { crlf, expect, test, type App } from '../fixtures';

/** Replaces the text, puts the caret at `caret` (default: the end) and returns. */
async function given(app: App, text: string, caret = text.length): Promise<void> {
  if (text === '') {
    await app.focusEditor();
    await app.page.keyboard.press(`${app.mod}+KeyA`);
    await app.page.keyboard.press('Delete');
    await expect.poll(() => app.text()).toBe('');
  } else {
    await app.replaceText(text);
  }
  await app.select(caret);
}

/** Opens a document whose trailer gives it Assembly tabs. */
async function assemblyDocument(app: App): Promise<void> {
  await app.dropFiles([{ name: 'asm.X68', data: crlf('*', '*~Tab type~0~') }]);
  await expect.poll(() => app.tabNames()).toContain('asm.X68');
  await expect.poll(async () => (await app.status())[4]).toContain('Assembly tabs');
}

test.describe('Tab key (note 12, editor-ui §20.3)', () => {
  test('Real Tabs off, Fixed tabs of 4: Tab at columns 0, 1, 3, 4 inserts 4, 3, 1, 4 blanks', async ({ app, page }) => {
    expect((await app.status())[4]).toContain('Fixed tabs 4');
    for (const [column, blanks] of [
      [0, 4],
      [1, 3],
      [3, 1],
      [4, 4],
    ] as const) {
      const before = 'abcd'.slice(0, column);
      await given(app, before);
      await page.keyboard.press('Tab');
      await expect.poll(() => app.text(), `Tab at column ${column}`).toBe(before + ' '.repeat(blanks));
    }
  });

  test('Real Tabs off, Assembly tabs: Tab at column 0, 5, 13, 21 inserts 12, 7, 7, 23 blanks', async ({
    app,
    page,
  }) => {
    await assemblyDocument(app);
    for (const [column, blanks] of [
      [0, 12],
      [5, 7],
      [13, 7],
      [21, 23],
    ] as const) {
      const before = 'x'.repeat(column);
      await given(app, before);
      await page.keyboard.press('Tab');
      await expect.poll(() => app.text(), `Tab at column ${column}`).toBe(before + ' '.repeat(blanks));
    }
  });

  test('Tab with a selection puts the blanks at its end and collapses it', async ({ app, page }) => {
    await given(app, 'ab');
    await app.select(0, 1);
    await page.keyboard.press('Tab');
    await expect.poll(() => app.text()).toBe('a   b');
    const selection = await app.selection();
    expect(selection.from).toBe(selection.to);
  });

  test('Shift+Tab deletes the blanks before the caret back to the previous stop', async ({ app, page }) => {
    await given(app, 'ab      ');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => app.text()).toBe('ab  ');
  });
});

test.describe('Auto Indent (editor-ui §8.4)', () => {
  test('Enter at the end of an indented line repeats its leading white space; in the middle it adds none', async ({
    app,
    page,
  }) => {
    await given(app, '    MOVE D0,D1');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.text()).toBe('    MOVE D0,D1\n    ');

    await given(app, '\tNOP');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.text()).toBe('\tNOP\n\t');

    await given(app, '    MOVE D0,D1', 8);
    await page.keyboard.press('Enter');
    await expect.poll(() => app.text()).toBe('    MOVE\n D0,D1');
  });
});

test.describe('Comment, Uncomment, Indent, Outdent (note 6, editor-ui §8.5)', () => {
  test('Comment Selection puts * in column 0 of each selected line; Uncomment removes one * only there', async ({
    app,
  }) => {
    await given(app, 'a\nb\nc\nd');
    await app.select(0, 5);
    await app.press('ed.edit.comment');
    await expect.poll(() => app.text()).toBe('*a\n*b\n*c\nd');
    await app.select(0, 8);
    await app.press('ed.edit.uncomment');
    await expect.poll(() => app.text()).toBe('a\nb\nc\nd');

    // Only where column 0 is `*`: ` *x` keeps its star, `**y` loses one.
    await given(app, ' *x\n**y');
    await app.select(0, 7);
    await app.press('ed.edit.uncomment');
    await expect.poll(() => app.text()).toBe(' *x\n*y');
  });

  test('every chord of Comment and Uncomment on this key map acts', async ({ app }) => {
    for (const chord of app.chords('ed.edit.comment')) {
      await given(app, 'a');
      await app.select(0, 1);
      await app.pressChord(chord);
      await expect.poll(() => app.text(), chord).toBe('*a');
    }
    for (const chord of app.chords('ed.edit.uncomment')) {
      await given(app, '*a');
      await app.select(0, 2);
      await app.pressChord(chord);
      await expect.poll(() => app.text(), chord).toBe('a');
    }
  });

  test('the toolbar buttons Comment Selection and Uncomment Selection act on the selected lines', async ({ app }) => {
    await given(app, 'one\ntwo');
    await app.select(0, 7);
    await app.toolbarButton('ed.edit.comment').click();
    await expect.poll(() => app.text()).toBe('*one\n*two');
    await app.select(0, 9);
    await app.toolbarButton('ed.edit.uncomment').click();
    await expect.poll(() => app.text()).toBe('one\ntwo');
  });

  test('Ctrl+Shift+. adds and Ctrl+Shift+, removes one space per selected line', async ({ app }) => {
    await given(app, 'a\nb');
    await app.select(0, 3);
    await app.press('ed.edit.indent');
    await expect.poll(() => app.text()).toBe(' a\n b');
    await app.select(0, 5);
    await app.press('ed.edit.outdent');
    await expect.poll(() => app.text()).toBe('a\nb');
  });
});

test.describe('Insert and Replace', () => {
  test('the Insert key (Ctrl+Shift+I on a Mac) switches the status bar and overtypes; a click on the cell switches back', async ({
    app,
    page,
  }) => {
    await given(app, 'abc', 0);
    expect((await app.status())[2]).toBe('Insert');
    await app.press('ed.edit.toggleInsert');
    await expect.poll(async () => (await app.status())[2]).toBe('Replace');
    await page.keyboard.type('Z');
    await expect.poll(() => app.text()).toBe('Zbc');
    await app
      .pane()
      .getByRole('button', { name: /mode; click to switch/ })
      .click();
    await expect.poll(async () => (await app.status())[2]).toBe('Insert');
    await app.select(1);
    await page.keyboard.type('Y');
    await expect.poll(() => app.text()).toBe('ZYbc');
  });

  test('overwrite typing is undoable (note 5)', async ({ app, page }) => {
    await given(app, 'abc', 0);
    await app.press('ed.edit.toggleInsert');
    await page.keyboard.type('X');
    await expect.poll(() => app.text()).toBe('Xbc');
    await page.keyboard.press(`${app.mod}+KeyZ`);
    await expect.poll(() => app.text()).toBe('abc');
  });
});

test.describe('status bar (note 17, editor-ui §7.2)', () => {
  test('line: column follows the caret; Modified after an edit and empty after Save', async ({ app, page }) => {
    await app.saveAs('status.X68');
    expect((await app.status())[1]).toBe('');
    await given(app, 'ab\ncd', 4);
    await expect.poll(async () => (await app.status())[0]).toBe('2: 2');
    expect((await app.status())[1]).toBe('Modified');
    await app.select(0);
    await expect.poll(async () => (await app.status())[0]).toBe('1: 1');
    await page.keyboard.press('End');
    await expect.poll(async () => (await app.status())[0]).toBe('1: 3');
    await app.press('ed.file.save');
    await expect.poll(async () => (await app.status())[1]).toBe('');
  });

  test('the column is the true visual column across a tab character', async ({ app }) => {
    await given(app, '\tX');
    // Fixed tabs of 4: the tab ends at column 4, X is column 5, the caret after it column 6.
    await expect.poll(async () => (await app.status())[0]).toBe('1: 6');
  });

  test('the information cell shows encoding, line ends and tab mode', async ({ app }) => {
    expect((await app.status())[4]).toBe('Windows-1252  CR LF  Fixed tabs 4');
  });
});

test.describe('undo and redo (note 5)', () => {
  test('Undo reverses typing, a paste and a comment, each paste and comment as one step; Redo restores', async ({
    app,
    page,
  }) => {
    await given(app, 'base');
    await app.saveAs('undo.X68');
    await app.paste(' PASTED');
    await expect.poll(() => app.text()).toBe('base PASTED');
    await page.keyboard.press(`${app.mod}+KeyZ`);
    await expect.poll(() => app.text()).toBe('base');

    await app.select(0, 4);
    await app.press('ed.edit.comment');
    await expect.poll(() => app.text()).toBe('*base');
    await page.keyboard.press(`${app.mod}+KeyZ`);
    await expect.poll(() => app.text()).toBe('base');

    for (const chord of app.chords('ed.edit.redo')) {
      await app.focusEditor();
      await app.pressChord(chord);
      await expect.poll(() => app.text(), chord).toBe('*base');
      await page.keyboard.press(`${app.mod}+KeyZ`);
      await expect.poll(() => app.text()).toBe('base');
    }

    // Typing: undone back to the saved text, which also clears Modified.
    await app.select(4);
    await page.keyboard.type('xyz');
    await expect.poll(() => app.text()).toBe('basexyz');
    for (let i = 0; i < 5 && (await app.text()) !== 'base'; i++) await page.keyboard.press(`${app.mod}+KeyZ`);
    expect(await app.text()).toBe('base');
    await expect.poll(async () => (await app.status())[1]).toBe('');
  });

  // The failure of the test above on GitHub's macOS runner (and in a Debian container: " PASTEDbase")
  // was a product defect, not a paste in two steps: on a slow machine the focus that the Save As
  // dialog gives back moved the caret to the start of the document (errata E2.md entry 16; X1.md
  // entry 10). A CPU slowed down through the DevTools protocol shows it on any machine: before the
  // repair 7 of 8 such runs failed.
  test('after Save As on a slow machine the caret stays where it was (Chromium, CPU slowed 16 times)', async ({
    app,
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the DevTools protocol that slows the CPU is Chromium only');
    await given(app, 'base');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 16 });
    try {
      await app.saveAs('slow.X68');
      const caret = (await app.selection()).head;
      await app.paste(' PASTED');
      await expect.poll(() => app.text()).not.toBe('base');
      expect({ caret, text: await app.text() }).toEqual({ caret: 4, text: 'base PASTED' });
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  });

  test('Undo and Redo of the toolbar and the Edit menu', async ({ app }) => {
    await given(app, 'one');
    await app.paste(' two');
    await expect.poll(() => app.text()).toBe('one two');
    await app.toolbarButton('ed.edit.undo').click();
    await expect.poll(() => app.text()).toBe('one');
    await app.toolbarButton('ed.edit.redo').click();
    await expect.poll(() => app.text()).toBe('one two');
    await app.chooseMenu('Edit', 'Undo');
    await expect.poll(() => app.text()).toBe('one');
    await app.chooseMenu('Edit', 'Redo');
    await expect.poll(() => app.text()).toBe('one two');
  });
});

test.describe('clipboard and selection', () => {
  test('pasted rich text arrives as plain text', async ({ app }) => {
    await given(app, '');
    await app.paste('    MOVE.B  D0,D1', 0, '<b style="color:red">    MOVE.B</b>  <i>D0,D1</i>');
    await expect.poll(() => app.text()).toBe('    MOVE.B  D0,D1');
    await expect(app.content().locator('b, i')).toHaveCount(0);
  });

  test('Select All selects the whole document, from its chord and from the Edit menu', async ({ app, page }) => {
    await given(app, 'line one\nline two', 0);
    await page.keyboard.press(`${app.mod}+KeyA`);
    expect(await app.selection()).toMatchObject({ from: 0, to: 17 });
    await app.select(0);
    await app.chooseMenu('Edit', 'Select All');
    await expect.poll(async () => (await app.selection()).to).toBe(17);
    expect((await app.selection()).from).toBe(0);
  });

  test('Cut and Copy are disabled without a selection and enabled with one', async ({ app }) => {
    await given(app, 'text', 0);
    await expect(app.toolbarButton('ed.edit.cut')).toBeDisabled();
    await expect(app.toolbarButton('ed.edit.copy')).toBeDisabled();
    await app.select(0, 2);
    await expect(app.toolbarButton('ed.edit.cut')).toBeEnabled();
    await expect(app.toolbarButton('ed.edit.copy')).toBeEnabled();
  });

  test('Cut, Copy and Paste with the keyboard move text through the clipboard', async ({ app, page, browserName }) => {
    test.skip(
      browserName !== 'chromium',
      "Playwright can grant the system clipboard only in Chromium; the application's part is shown in both browsers by the tests 'clipboard: ...' below, the exchange with other programs is manual (ARCHITECTURE.md 6.8)",
    );
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await given(app, 'alpha beta');
    await app.select(0, 6);
    await app.press('ed.edit.cut');
    await expect.poll(() => app.text()).toBe('beta');
    await app.select(4);
    await app.press('ed.edit.paste');
    await expect.poll(() => app.text()).toBe('betaalpha ');
    await app.select(0, 4);
    await app.press('ed.edit.copy');
    await app.select(10);
    await app.press('ed.edit.paste');
    await expect.poll(() => app.text()).toBe('betaalpha beta');
  });

  test('a paste event inserts its text at the caret as one undo step: CR LF and CR as line breaks, tabs kept', async ({
    app,
    page,
  }) => {
    await given(app, 'AB', 1);
    await app.saveAs('paste.X68');
    // As a browser delivers Ctrl+V or Cmd+V: a paste event carrying the clipboard's text. Real Tabs
    // is off (Fixed tabs 4), and a pasted tab character still stays a tab (editor-ui §8.7).
    await app.paste('one\r\ntwo\rthree\tfour');
    await expect.poll(() => app.text()).toBe('Aone\ntwo\nthree\tfourB');
    expect(await app.selection()).toMatchObject({ from: 19, to: 19 });
    await page.keyboard.press(`${app.mod}+KeyZ`);
    await expect.poll(() => app.text()).toBe('AB');
    await expect.poll(async () => (await app.status())[1]).toBe('');
    // Over a selection: the selection is replaced, the caret ends after the pasted text.
    await app.select(0, 2);
    await app.paste('xy');
    await expect.poll(() => app.text()).toBe('xy');
    expect(await app.selection()).toMatchObject({ from: 2, to: 2 });
  });

  test('standard editor keys work: the word-delete key is not swallowed (note 13)', async ({ app, page }) => {
    await given(app, 'hello world');
    await page.keyboard.press(app.keys === 'mac' ? 'Alt+Backspace' : 'Control+Backspace');
    await expect.poll(() => app.text()).toBe('hello ');
  });
});

// ---- The application's part of the clipboard, in every browser -------------------------------
//
// Playwright can give a page the system clipboard only in Chromium (the test above). What the
// application itself does can be shown in both browsers without it: the copy and cut events that
// the editor answers carry the selected text in their clipboardData (a listener of the page
// records what the application put there; the browser then writes it to the system clipboard), and
// a paste event carrying text, as a browser delivers it, is inserted. The exchange with other
// programs through the real clipboard is the manual list's (ARCHITECTURE.md 6.8).

/** One clipboard event as the page saw it after the application had answered it. */
interface ClipRecord {
  type: string;
  text: string;
  handled: boolean;
}

/**
 * Records every cut and copy event of the page (bubble phase on window: after the editor's own
 * handler) and returns a function that takes the records made so far.
 */
async function recordClipboard(app: App): Promise<() => Promise<ClipRecord[]>> {
  await app.page.evaluate(() => {
    const log: ClipRecord[] = [];
    (window as unknown as { __e68Clip: ClipRecord[] }).__e68Clip = log;
    for (const type of ['cut', 'copy']) {
      window.addEventListener(type, (event) =>
        log.push({
          type,
          text: (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '',
          handled: event.defaultPrevented,
        }),
      );
    }
  });
  return () => app.page.evaluate(() => (window as unknown as { __e68Clip: ClipRecord[] }).__e68Clip.splice(0));
}

/** Waits for the next recorded clipboard events and returns them. */
async function nextEvents(take: () => Promise<ClipRecord[]>, count = 1): Promise<ClipRecord[]> {
  const seen: ClipRecord[] = [];
  await expect
    .poll(async () => {
      seen.push(...(await take()));
      return seen.length;
    })
    .toBeGreaterThanOrEqual(count);
  return seen;
}

/**
 * Opens the editor's context menu with a right-click in the middle of the selection. On a Mac a
 * right-click selects the word under the pointer (both engines' Mac editing behaviour), so the
 * tests select whole words: the selection is then the same on every system.
 */
async function contextMenuOnSelection(app: App): Promise<void> {
  const point = await app.pane().evaluate((pane) => {
    const view = viewIn(pane) as unknown as {
      state: { selection: { main: { from: number; to: number } } };
      coordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null;
    };
    const { from, to } = view.state.selection.main;
    const box = view.coordsAtPos(Math.floor((from + to) / 2));
    return box && { x: box.left, y: (box.top + box.bottom) / 2 };
  });
  if (!point) throw new Error('contextMenuOnSelection: the selection is not on screen');
  await app.page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(app.openMenuList).toBeVisible();
}

/** Paste from the Edit menu, the toolbar and the context menu (note 45), by name. */
function pasteWays(app: App): [way: string, act: () => Promise<void>][] {
  return [
    ['Edit menu', () => app.chooseMenu('Edit', 'Paste')],
    ['toolbar', () => app.toolbarButton('ed.edit.paste').click()],
    [
      'context menu',
      async () => {
        await contextMenuOnSelection(app);
        await app.menuItem(app.openMenuList, 'Paste').click();
      },
    ],
  ];
}

/** The toast that says the browser refused the clipboard; it is closed again. */
async function expectPasteRefused(app: App): Promise<void> {
  const text = app.keys === 'mac' ? 'Press Cmd+V to paste' : 'Press Ctrl+V to paste';
  const toast = app.page.locator('.e68-toast').filter({ hasText: text });
  await expect(toast).toBeVisible();
  await toast.locator('.e68-toast__close').click();
  await expect(toast).toHaveCount(0);
}

test.describe('clipboard: what the application hands to the browser (both browsers)', () => {
  test('Cut and Copy with every chord of this key map put the selected text into the event; Cut is one undo step', async ({
    app,
    page,
  }) => {
    const take = await recordClipboard(app);
    for (const [index, chord] of app.chords('ed.edit.copy').entries()) {
      await given(app, 'alpha beta');
      await app.select(0, 6);
      await app.pressChord(chord);
      expect(await nextEvents(take), chord).toEqual([{ type: 'copy', text: 'alpha ', handled: true }]);
      expect(await app.text(), chord).toBe('alpha beta');

      const cutChord = app.chords('ed.edit.cut')[index] ?? app.chords('ed.edit.cut')[0]!;
      await app.select(6, 10);
      await app.pressChord(cutChord);
      expect(await nextEvents(take), cutChord).toEqual([{ type: 'cut', text: 'beta', handled: true }]);
      await expect.poll(() => app.text(), cutChord).toBe('alpha ');
      await page.keyboard.press(`${app.mod}+KeyZ`);
      await expect.poll(() => app.text(), `${cutChord}, then Undo`).toBe('alpha beta');
    }
  });

  test('Cut and Copy from the Edit menu, the toolbar and the context menu put the selected text into the event', async ({
    app,
    page,
  }) => {
    const take = await recordClipboard(app);
    const ways: [string, (id: 'ed.edit.cut' | 'ed.edit.copy', caption: string) => Promise<void>][] = [
      ['Edit menu', (_id, caption) => app.chooseMenu('Edit', caption)],
      ['toolbar', (id) => app.toolbarButton(id).click()],
      [
        'context menu',
        async (_id, caption) => {
          await contextMenuOnSelection(app);
          await app.menuItem(app.openMenuList, caption).click();
        },
      ],
    ];
    for (const [way, act] of ways) {
      await given(app, 'alpha beta');
      await app.select(0, 5);
      await act('ed.edit.copy', 'Copy');
      expect(await nextEvents(take), `Copy from the ${way}`).toEqual([{ type: 'copy', text: 'alpha', handled: true }]);
      expect(await app.text()).toBe('alpha beta');

      await app.select(6, 10);
      await act('ed.edit.cut', 'Cut');
      expect(await nextEvents(take), `Cut from the ${way}`).toEqual([{ type: 'cut', text: 'beta', handled: true }]);
      await expect.poll(() => app.text(), `Cut from the ${way}`).toBe('alpha ');
      await app.focusEditor();
      await page.keyboard.press(`${app.mod}+KeyZ`);
      await expect.poll(() => app.text(), `Cut from the ${way}, then Undo`).toBe('alpha beta');
    }
  });

  test('Paste from the Edit menu, the toolbar and the context menu asks for the clipboard during the click and inserts its text as one undo step', async ({
    app,
    page,
  }) => {
    // The browser's answer is given by the test, as Safari gives it once the person confirms its
    // Paste callout (note 45). Recorded with each request: whether the page still had the click's
    // user activation (navigator.userActivation.isActive), which Safari requires before it shows
    // the callout at all; a request made after an await that lost it would be refused.
    await page.evaluate(() => {
      const state = { text: '', asked: [] as (boolean | null)[] };
      (window as unknown as { __e68Read: typeof state }).__e68Read = state;
      Object.defineProperty(navigator.clipboard, 'readText', {
        configurable: true,
        value: () => {
          const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
          state.asked.push(activation ? activation.isActive : null);
          return Promise.resolve(state.text);
        },
      });
    });
    const answer = (text: string) =>
      page.evaluate((value) => {
        (window as unknown as { __e68Read: { text: string } }).__e68Read.text = value;
      }, text);
    const asked = () =>
      page.evaluate(() =>
        (window as unknown as { __e68Read: { asked: (boolean | null)[] } }).__e68Read.asked.splice(0),
      );
    for (const [way, act] of pasteWays(app)) {
      await given(app, 'one two');
      await app.select(4, 7);
      await answer(`${way}\r\nline 2\tTAB`);
      await act();
      await expect.poll(() => app.text(), `Paste from the ${way}`).toBe(`one ${way}\nline 2\tTAB`);
      expect(await app.selection(), `Paste from the ${way}: the caret after the text`).toMatchObject({
        from: 4 + way.length + '\nline 2\tTAB'.length,
        to: 4 + way.length + '\nline 2\tTAB'.length,
      });
      expect(await asked(), `Paste from the ${way} asks the browser once, while the click's activation lasts`).toEqual([
        true,
      ]);
      await app.focusEditor();
      await page.keyboard.press(`${app.mod}+KeyZ`);
      await expect.poll(() => app.text(), `Paste from the ${way}, then Undo`).toBe('one two');
    }
  });

  test('Paste from the Edit menu, the toolbar and the context menu without clipboard access says Press Ctrl+V (Cmd+V) to paste', async ({
    app,
  }) => {
    for (const [way, act] of pasteWays(app)) {
      await given(app, 'one two');
      await app.select(4, 7);
      await act();
      await test.step(`Paste from the ${way}`, () => expectPasteRefused(app));
      expect(await app.text(), `Paste from the ${way}`).toBe('one two');
    }
  });
});

// ---- Alt+letter opens the menus (1.3.2, note 14) ----------------------------------------------
//
// Both key maps on every system, so that the row is shown in both browsers wherever the suite runs
// (the menu bar's access keys are the application's own handling of the key, not the browser's).

/** The six menus with their access key and their first item (editor-ui §2). */
const MENU_KEYS = [
  ['F', 'New X68 Source File'],
  ['E', 'Undo'],
  ['P', 'Assemble Source...'],
  ['O', 'Assembler Options...'],
  ['W', 'Arrange'],
  ['H', 'Help'],
] as const;

test.describe('Alt+letter and the menus (1.3.2, note 14)', () => {
  test.describe('Windows and Linux key map', () => {
    test.use({ keys: 'windows' });

    test('Alt+F, Alt+E, Alt+P, Alt+O, Alt+W and Alt+H open their menus; arrows move between them, Enter chooses', async ({
      app,
      page,
    }) => {
      for (const [letter, first] of MENU_KEYS) {
        await app.focusEditor();
        await page.keyboard.press(`Alt+Key${letter}`);
        await expect(app.openMenuList, `Alt+${letter}`).toBeVisible();
        expect((await app.entriesOf(app.openMenuList))[0]?.caption, `Alt+${letter}`).toBe(first);
        await page.keyboard.press('Escape');
        await expect(page.locator('[role=menu][data-e68-menu]'), `Alt+${letter}, then Esc`).toHaveCount(0);
      }
      await app.focusEditor();
      await page.keyboard.press('Alt+KeyF');
      await expect(app.openMenuList).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await app.entriesOf(app.openMenuList))[0]?.caption).toBe('Undo');
      await page.keyboard.press('ArrowLeft');
      await expect.poll(async () => (await app.entriesOf(app.openMenuList))[0]?.caption).toBe('New X68 Source File');
      await page.keyboard.press('Enter'); // the first item: New X68 Source File
      await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68']);
    });
  });

  test.describe('macOS key map', () => {
    test.use({ keys: 'mac' });

    test('Option+F, E, P, O, W and H open no menu: macOS has no menu mnemonics', async ({ app, page }) => {
      await given(app, '');
      for (const [index, [letter]] of MENU_KEYS.entries()) {
        await page.keyboard.press(`Alt+Key${letter}`);
        // A key typed next reaches the editor only if the chord opened no menu (an open menu would
        // take it): the check waits for that key instead of for a fixed time.
        await page.keyboard.type('x');
        await expect
          .poll(async () => (await app.text()).split('x').length - 1, `Option+${letter}, then x`)
          .toBe(index + 1);
        await expect(page.locator('[role=menu][data-e68-menu]'), `Option+${letter}`).toHaveCount(0);
        await expect(app.content(), `Option+${letter} leaves the focus in the editor`).toBeFocused();
      }
      expect(await app.tabNames()).toEqual(['untitled1.x68']);
    });
  });
});

test.describe('clipboard: the Ctrl forms of the macOS key map (rule K2), in both browsers', () => {
  test.use({ keys: 'mac' });

  test('Ctrl+C and Ctrl+X put the selected text into the event; Ctrl+V without clipboard access says Press Cmd+V to paste', async ({
    app,
    page,
  }) => {
    const take = await recordClipboard(app);
    await given(app, 'alpha beta');
    await app.select(0, 6);
    await app.pressChord('Ctrl+C');
    expect(await nextEvents(take)).toEqual([{ type: 'copy', text: 'alpha ', handled: true }]);
    await app.select(6, 10);
    await app.pressChord('Ctrl+X');
    expect(await nextEvents(take)).toEqual([{ type: 'cut', text: 'beta', handled: true }]);
    await expect.poll(() => app.text()).toBe('alpha ');
    await page.keyboard.press('Meta+KeyZ');
    await expect.poll(() => app.text()).toBe('alpha beta');
    await app.select(1, 2);
    await app.pressChord('Ctrl+V');
    await expectPasteRefused(app);
    expect(await app.text()).toBe('alpha beta');
  });
});
