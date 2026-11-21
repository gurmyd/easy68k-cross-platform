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
      "Playwright can grant clipboard access only in Chromium; WebKit's keyboard clipboard is checked by check-editor.mjs (E2)",
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

  test('standard editor keys work: the word-delete key is not swallowed (note 13)', async ({ app, page }) => {
    await given(app, 'hello world');
    await page.keyboard.press(app.keys === 'mac' ? 'Alt+Backspace' : 'Control+Backspace');
    await expect.poll(() => app.text()).toBe('hello ');
  });
});
