// Documents: new, open, save with the trailer, Save As, reopen, reload, close prompts, list
// documents, encoding, drop (ARCHITECTURE.md 1.3.1 File rows, 1.3.3, 3.9; editor-ui §6, §16,
// §20.2). Owner: X1.
//
// Bytes are read back with the Files panel's Export... and written with Import... or a drop, so
// what is checked is what a student gets out of the browser.

import { TEMPLATE, TRAILER, bytesOf, crlf, expect, latin1, test, trailer } from '../fixtures';

/** CR LF for every "\n" of a document's text (ARCHITECTURE.md 3.9.3). */
const onDisk = (text: string) => text.replace(/\n/g, '\r\n');

test.describe('new documents', () => {
  test('File > New X68 Source File opens untitled2.x68 with the template, not modified', async ({ app }) => {
    await app.chooseMenu('File', 'New X68 Source File');
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68']);
    const tabs = await app.tabs();
    expect(tabs[1]?.selected).toBe(true);
    expect(tabs[1]?.modified).toBe(false);
    expect(await app.text()).toBe(TEMPLATE);
    expect((await app.status())[1]).toBe('');
  });

  test('untitled numbers increase by one per new document and do not skip (note 15)', async ({ app }) => {
    await app.toolbarButton('ed.file.new').click();
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68', 'untitled3.x68']);
  });
});

test.describe('save', () => {
  test('a new file saved as t.X68 is the template text, one CR LF, then the four trailer lines', async ({ app }) => {
    await app.press('ed.file.save');
    const dialog = app.dialog('Save As');
    await expect(dialog).toBeVisible();
    await app.fileDialogName(dialog, 't', 'Save');
    await expect(dialog).toBeHidden();
    await expect.poll(() => app.tabNames()).toEqual(['t.X68']);
    expect(latin1(await app.exportFile('t.X68'))).toBe(onDisk(TEMPLATE) + '\r\n' + TRAILER);
  });

  test('Save clears Modified; a second Save writes without a dialog', async ({ app, page }) => {
    await app.saveAs('again.X68');
    await app.select(0);
    await page.keyboard.type('* first line\n');
    await expect.poll(async () => (await app.status())[1]).toBe('Modified');
    expect((await app.tabs())[0]?.modified).toBe(true);
    await app.press('ed.file.save');
    await expect.poll(async () => (await app.status())[1]).toBe('');
    expect((await app.tabs())[0]?.modified).toBe(false);
    await expect(app.dialog('Save As')).toHaveCount(0);
    expect(latin1(await app.exportFile('again.X68'))).toBe(onDisk(`* first line\n${TEMPLATE}`) + '\r\n' + TRAILER);
  });

  test('the same text saved as t.ASM has no trailer', async ({ app }) => {
    await app.chooseMenu('File', 'Save As...');
    const dialog = app.dialog('Save As');
    await dialog.getByLabel('Save as type:').selectOption({ index: 1 });
    await app.fileDialogName(dialog, 't.ASM', 'Save');
    await expect(dialog).toBeHidden();
    await expect.poll(() => app.tabNames()).toEqual(['t.ASM']);
    expect(latin1(await app.exportFile('t.ASM'))).toBe(onDisk(TEMPLATE));
  });

  test('Save As shows the two filters of the original', async ({ app }) => {
    await app.chooseMenu('File', 'Save As...');
    const dialog = app.dialog('Save As');
    const options = await dialog.getByLabel('Save as type:').locator('option').allTextContents();
    expect(options.map((text) => text.replace(/\u00a0/g, ' '))).toEqual(['68K Source File  [.X68]', 'Any File  [*.*]']);
    await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
    expect(await app.tabNames()).toEqual(['untitled1.x68']);
  });

  test('Save As onto an existing name asks "File exists! OK to overwrite?"; No keeps the file, Yes writes it', async ({
    app,
  }) => {
    await app.importFiles([{ name: 'old.X68', data: crlf('OLD') }]);
    await app.chooseMenu('File', 'Save As...');
    let dialog = app.dialog('Save As');
    await app.fileDialogName(dialog, 'old.X68', 'Save');
    await expect(app.dialog('Caution!')).toBeVisible();
    expect(await app.boxText(app.dialog('Caution!'))).toContain('File exists! OK to overwrite?');
    await app.button(app.dialog('Caution!'), 'No').click();
    // No: back in the Save As dialog or out of it, the file is untouched and the document unnamed.
    if (await dialog.isVisible()) await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
    expect(await app.tabNames()).toEqual(['untitled1.x68']);
    expect(latin1(await app.exportFile('old.X68'))).toBe(crlf('OLD'));

    await app.chooseMenu('File', 'Save As...');
    dialog = app.dialog('Save As');
    await app.fileDialogName(dialog, 'old.X68', 'Save');
    await app.button(app.dialog('Caution!'), 'Yes').click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => app.tabNames()).toEqual(['old.X68']);
    expect(latin1(await app.exportFile('old.X68'))).toBe(onDisk(TEMPLATE) + '\r\n' + TRAILER);
  });
});

test.describe('open', () => {
  test('the Open dialog offers the five filters of the original, the first preselected', async ({ app }) => {
    await app.press('ed.file.open');
    const dialog = app.dialog('Open File');
    await expect(dialog).toBeVisible();
    const select = dialog.getByLabel('Files of type:');
    const options = await select.locator('option').allTextContents();
    expect(options.map((text) => text.replace(/\u00a0/g, ' '))).toEqual([
      'EASy68K Source  [.X68]',
      '68K Source  [.ASM] [.M68]',
      'EASy68K Listing  [.L68]',
      '68K S Record  [.S68]',
      'Any File  [*.*]',
    ]);
    expect(await select.evaluate((element: HTMLSelectElement) => element.selectedIndex)).toBe(0);
    await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
  });

  test('a file opens with its trailer removed and its font and tab values taken (editor-ui §20.2)', async ({ app }) => {
    await app.importFiles([
      { name: 'prog.X68', data: crlf('* program', '    END    START', '') + trailer('Courier New', 10, 1, 4) },
      { name: 'asm.X68', data: crlf('* assembly tabs', '*~Tab type~0~') },
    ]);
    await app.openFile('prog.X68');
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'prog.X68']);
    expect(await app.text()).toBe('* program\n    END    START\n\n');
    expect((await app.status())[4]).toContain('Fixed tabs 4');

    // Only `*~Tab type~0~` as the last line: Assembly tabs, the line removed, the rest from the options.
    await app.openFile('asm.X68');
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'prog.X68', 'asm.X68']);
    expect(await app.text()).toBe('* assembly tabs\n');
    expect((await app.status())[4]).toContain('Assembly tabs');
  });

  test('opening an open, modified file asks to discard; No keeps the edits, Yes reopens it', async ({ app, page }) => {
    await app.importFiles([{ name: 'twice.X68', data: crlf('ORIGINAL') }]);
    await app.openFile('twice.X68');
    await expect.poll(() => app.text()).toBe('ORIGINAL\n');
    await app.select(0);
    await page.keyboard.type('EDIT ');
    await app.openFile('twice.X68');
    const box = app.messageBox;
    await expect(box).toBeVisible();
    expect(await app.boxText(box)).toContain('twice.X68 is already open. Do you want to discard changes and reopen?');
    await expect(box.locator('.e68-dialog__title')).toHaveText('Confirm');
    await app.button(box, 'No').click();
    await expect(box).toBeHidden();
    expect(await app.text()).toBe('EDIT ORIGINAL\n');

    await app.openFile('twice.X68');
    await app.button(app.messageBox, 'Yes').click();
    await expect.poll(() => app.text()).toBe('ORIGINAL\n');
    expect(await app.tabNames()).toEqual(['untitled1.x68', 'twice.X68']);
    expect((await app.status())[1]).toBe('');
  });

  test('a list document (.L68) opens without highlighting, stays editable and saves without a trailer', async ({
    app,
    page,
  }) => {
    const listing = crlf(
      '00001000                             1  * comment line',
      '00001000  4E71                       2      NOP',
    );
    await app.importFiles([{ name: 'prog.L68', data: listing }]);
    await app.openFile('prog.L68', 'EASy68K Listing  [.L68]'.replace('  ', ' \u00a0'));
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'prog.L68']);
    await expect(app.content().locator('[class*="e68-syntax__"]')).toHaveCount(0);
    await app.select(0);
    await page.keyboard.type('X');
    await app.press('ed.file.save');
    await expect.poll(async () => (await app.status())[1]).toBe('');
    expect(latin1(await app.exportFile('prog.L68'))).toBe('X' + listing);
  });

  test('two files dropped on the window open as two documents, in the order of the drop', async ({ app }) => {
    await app.dropFiles([
      { name: 'zeta.X68', data: crlf('ZETA') },
      { name: 'alpha.X68', data: crlf('ALPHA') },
    ]);
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'zeta.X68', 'alpha.X68']);
    expect(await app.text()).toBe('ALPHA\n');
  });

  test('bytes 0x80-0xFF in a DC.B string survive an open and save round trip (Windows-1252)', async ({ app, page }) => {
    let high = '';
    for (let byte = 0x80; byte <= 0xff; byte++) high += String.fromCharCode(byte);
    const source = crlf(`MSG     DC.B    '${high.replace(/'/g, "''")}',0`, '    END    MSG');
    await app.importFiles([{ name: 'high.ASM', data: source }]);
    await app.openFile('high.ASM', '68K Source  [.ASM] [.M68]'.replace(/ {2}/g, ' \u00a0'));
    await expect.poll(() => app.tabNames()).toContain('high.ASM');
    await app.select(0);
    await page.keyboard.type('*');
    await app.press('ed.file.save');
    await expect.poll(async () => (await app.status())[1]).toBe('');
    expect(Buffer.from(await app.exportFile('high.ASM')).equals(Buffer.from(bytesOf('*' + source)))).toBe(true);
  });

  test('the tab shows the file name, a dot while modified, and the full path as its tool-tip', async ({
    app,
    page,
  }) => {
    await app.saveAs('named.X68');
    let tab = (await app.tabs())[0];
    expect(tab?.name).toBe('named.X68');
    expect(tab?.title).toMatch(/\/named\.X68$/);
    expect(tab?.title).not.toBe('named.X68');
    expect(tab?.modified).toBe(false);
    await app.select(0);
    await page.keyboard.type('x');
    await expect.poll(async () => (await app.tabs())[0]?.modified).toBe(true);
    tab = (await app.tabs())[0];
    expect(tab?.name).toBe('named.X68');
  });
});

test.describe('reload and close', () => {
  test('Reload File on a modified document asks "is modified"; Yes reloads the stored text', async ({ app, page }) => {
    await app.importFiles([{ name: 'rel.X68', data: crlf('STORED') }]);
    await app.openFile('rel.X68');
    await app.select(0);
    await page.keyboard.type('CHANGED ');
    await app.content().click({ button: 'right' });
    await app.menuItem(app.openMenuList, 'Reload File').click();
    const box = app.messageBox;
    await expect(box).toBeVisible();
    expect(await app.boxText(box)).toContain('rel.X68 is modified. Do you want to discard changes and reopen?');
    await app.button(box, 'No').click();
    expect(await app.text()).toBe('CHANGED STORED\n');
    await app.content().click({ button: 'right' });
    await app.menuItem(app.openMenuList, 'Reload File').click();
    await app.button(app.messageBox, 'Yes').click();
    await expect.poll(() => app.text()).toBe('STORED\n');
    expect((await app.status())[1]).toBe('');
  });

  test('Close File on a modified document asks Yes/No/Cancel with the exact text; Cancel keeps it, No closes it', async ({
    app,
    page,
  }) => {
    await app.select(0);
    await page.keyboard.type('* edit\n');
    await app.chooseMenu('File', 'Close File');
    const box = app.messageBox;
    await expect(box).toBeVisible();
    expect(await app.boxText(box)).toContain("File modified, do you wish to save 'untitled1.x68' before closing?");
    await expect(box.locator('.e68-dialog__footer').getByRole('button')).toHaveText(['Yes', 'No', 'Cancel']);
    await app.button(box, 'Cancel').click();
    await expect(box).toBeHidden();
    expect(await app.tabNames()).toEqual(['untitled1.x68']);
    expect(await app.text()).toBe(`* edit\n${TEMPLATE}`);

    await app.chooseMenu('File', 'Close File');
    await app.button(app.messageBox, 'No').click();
    await expect.poll(() => app.tabNames()).toEqual([]);
  });

  test('Close with Yes saves the document being closed; a cancelled Save As cancels the close (note 3)', async ({
    app,
    page,
  }) => {
    // Unnamed: Yes opens Save As; Cancel there keeps the document open.
    await app.select(0);
    await page.keyboard.type('* unnamed\n');
    await app.chooseMenu('File', 'Close File');
    await app.button(app.messageBox, 'Yes').click();
    const dialog = app.dialog('Save As');
    await expect(dialog).toBeVisible();
    await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
    expect(await app.tabNames()).toEqual(['untitled1.x68']);

    // Named and not active: the closing document is the one saved.
    await app.importFiles([{ name: 'keep.X68', data: crlf('KEEP') }]);
    await app.openFile('keep.X68');
    await app.select(0);
    await page.keyboard.type('* saved by close\n');
    await app.tab('untitled1.x68').click();
    await app.tab('keep.X68').locator('.e68-tabs__close').click();
    await app.button(app.messageBox, 'Yes').click();
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68']);
    expect(latin1(await app.exportFile('keep.X68'))).toBe(crlf('* saved by close', 'KEEP', '') + TRAILER);
  });

  test('Exit runs the close prompts, then shows "You can close this tab." (note 4)', async ({ app, page }) => {
    await app.select(0);
    await page.keyboard.type('x');
    await app.chooseMenu('File', 'Exit');
    await expect(app.messageBox).toBeVisible();
    expect(await app.boxText()).toContain("File modified, do you wish to save 'untitled1.x68' before closing?");
    await app.button(app.messageBox, 'Cancel').click();
    await expect(page.getByText('You can close this tab.')).toHaveCount(0);
    expect(await app.tabNames()).toEqual(['untitled1.x68']);

    await app.chooseMenu('File', 'Exit');
    await app.button(app.messageBox, 'No').click();
    await expect(page.getByText('You can close this tab.')).toBeVisible();
  });
});
