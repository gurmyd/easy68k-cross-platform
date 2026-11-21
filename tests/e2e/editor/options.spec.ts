// Assembler Options, Editor Options, presets, the template, settings import and export
// (ARCHITECTURE.md 1.3.1 Options rows, 1.3.3 rows "Assembler Options dialog", "Editor Options
// dialog", "settings.dat", "template.NEW", 3.10, notes 8, 19, 21; editor-ui §8, §11, §12, §20.3,
// §20.5). Owner: X1. The dialogs are E4's (wave 2): every test waits for them (fixtures/pending.ts).

import { crlf, expect, latin1, requirePackage, test, type App } from '../fixtures';

test.beforeEach(async ({ app }) => {
  await requirePackage(app, 'E4');
});

async function assemblerOptions(app: App) {
  await app.chooseMenu('Options', 'Assembler Options...');
  const dialog = app.dialog('EASy68K Assembler Options');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function editorOptions(app: App) {
  await app.chooseMenu('Options', 'Editor Options...');
  const dialog = app.dialog('EASy68K Editor Options');
  await expect(dialog).toBeVisible();
  return dialog;
}

const ASSEMBLER_BOXES: [caption: string, checked: boolean][] = [
  ['Generate List File', true],
  ['Generate S-Record', true],
  ['Show Warnings', true],
  ['Auto Save Modified Source Before Assembling', false],
  ['Assemble Bit Field Instructions', true],
  ['Cross Reference', true],
  ['Constants Expanded', false],
  ['Structured Expanded', false],
  ['Macros Expanded', false],
];

const SIM68K_QUESTION =
  'You have unchecked options that are required for use by the 68000 simulator Sim68K.  Without these options many features of Sim68K will be unavailable.  Do you wish to continue?';

test.describe('Assembler Options (editor-ui §11.1)', () => {
  test('two tabs, the nine check boxes with their defaults, OK and Cancel', async ({ app }) => {
    const dialog = await assemblerOptions(app);
    await expect(dialog.getByRole('tab', { name: 'Assembler Options' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('tab', { name: 'Template' })).toBeVisible();
    for (const [caption, checked] of ASSEMBLER_BOXES) {
      const box = dialog.getByRole('checkbox', { name: caption, exact: true });
      if (checked) await expect(box, caption).toBeChecked();
      else await expect(box, caption).not.toBeChecked();
    }
    await expect(app.button(dialog, 'OK')).toBeVisible();
    await expect(app.button(dialog, 'Cancel')).toBeVisible();
    await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
  });

  test('unchecking Generate List File and pressing OK asks the Sim68K question; No re-checks both boxes', async ({
    app,
  }) => {
    const dialog = await assemblerOptions(app);
    await dialog.getByRole('checkbox', { name: 'Generate List File', exact: true }).uncheck();
    await app.button(dialog, 'OK').click();
    const box = app.messageBox;
    await expect(box).toBeVisible();
    expect(await app.boxText(box)).toContain(SIM68K_QUESTION);
    await app.button(box, 'No').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Generate List File', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Generate S-Record', exact: true })).toBeChecked();
  });

  test('Cancel restores every box (note 8)', async ({ app }) => {
    let dialog = await assemblerOptions(app);
    await dialog.getByRole('checkbox', { name: 'Cross Reference', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Macros Expanded', exact: true }).check();
    await app.button(dialog, 'Cancel').click();
    dialog = await assemblerOptions(app);
    await expect(dialog.getByRole('checkbox', { name: 'Cross Reference', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Macros Expanded', exact: true })).not.toBeChecked();
  });

  test('OK keeps the boxes after a reload (settings are stored)', async ({ app }) => {
    let dialog = await assemblerOptions(app);
    await dialog.getByRole('checkbox', { name: 'Constants Expanded', exact: true }).check();
    await app.button(dialog, 'OK').click();
    await expect(dialog).toBeHidden();
    await app.open();
    dialog = await assemblerOptions(app);
    await expect(dialog.getByRole('checkbox', { name: 'Constants Expanded', exact: true })).toBeChecked();
  });

  test('Template tab: Save Template changes what New puts into a new document (editor-ui §12)', async ({ app }) => {
    const dialog = await assemblerOptions(app);
    await dialog.getByRole('tab', { name: 'Template' }).click();
    const box = dialog.getByRole('textbox');
    await expect(box).toHaveValue(new RegExp(`^\\*-{59}\\n\\* Title`));
    await box.fill('* my template\n    END    START\n');
    await app.button(dialog, 'Save Template').click();
    await app.button(dialog, 'Cancel').click();
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68']);
    await expect.poll(() => app.text()).toBe('* my template\n    END    START\n');
  });
});

test.describe('Editor Options (editor-ui §11.2)', () => {
  test('the General tab: font, size, fixed tab size, tab type, Current File Info, Auto Indent, Real Tabs; OK, Cancel, Help', async ({
    app,
  }) => {
    const dialog = await editorOptions(app);
    await expect(dialog.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Colors' })).toBeVisible();
    await dialog.getByRole('tab', { name: 'General' }).click();
    const font = dialog.getByLabel('New Font:');
    expect((await font.locator('option').allTextContents()).map((s) => s.trim())).toEqual([
      'Courier',
      'Courier New',
      'Fixedsys',
    ]);
    await expect(font).toHaveValue(/Courier New/);
    const size = dialog.getByLabel('New Font Size:');
    expect((await size.locator('option').allTextContents()).map((s) => s.trim())).toEqual([
      '8',
      '9',
      '10',
      '11',
      '12',
      '14',
      '16',
      '18',
    ]);
    await expect(size).toHaveValue('10');
    await expect(dialog.getByLabel('Fixed Tab Size:').first()).toHaveValue('4');
    await expect(dialog.getByRole('radio', { name: 'Fixed Tabs' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Assembly Tabs' })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Auto Indent' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Real Tabs' })).not.toBeChecked();
    const info = await dialog.innerText();
    for (const label of ['Current File Info', 'Font:', 'Font Size:', 'Tab Type:', 'Fixed'])
      expect(info).toContain(label);
    for (const caption of ['OK', 'Cancel', 'Help']) await expect(app.button(dialog, caption)).toBeVisible();
    await font.selectOption({ label: 'Fixedsys' });
    expect((await size.locator('option').allTextContents()).map((s) => s.trim())).toEqual(['9', '18']);
    await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
  });

  test('the Colors tab: elements, attributes, presets with Auto, Print w/Black checked and disabled, 16 colours', async ({
    app,
  }) => {
    const dialog = await editorOptions(app);
    await dialog.getByRole('tab', { name: 'Colors' }).click();
    const elements = dialog.getByRole('listbox', { name: 'Element' });
    await expect(elements.getByRole('option')).toHaveText([
      'Code',
      'Comment',
      'Directive',
      'Label',
      'Macro/Other',
      'Structured',
      'Structure Error',
      'Text',
      'Background',
    ]);
    for (const name of ['Bold', 'Italic', 'Underline'])
      await expect(dialog.getByRole('checkbox', { name })).toBeVisible();
    const presets = (await dialog.getByLabel('Color Presets').locator('option').allTextContents()).map((s) => s.trim());
    for (const preset of ['Color1', 'Color2', 'No Color', 'Custom', 'Disabled', 'Auto'])
      expect(presets).toContain(preset);
    const printBlack = dialog.getByRole('checkbox', { name: 'Print w/Black' });
    await expect(printBlack).toBeChecked();
    await expect(printBlack).toBeDisabled();
    await expect(dialog.getByRole('group', { name: 'Color' }).getByRole('button')).toHaveCount(16);
    await app.button(dialog, 'Cancel').click();
  });

  test('Real Tabs on: Tab stores one tab character', async ({ app, page }) => {
    const dialog = await editorOptions(app);
    await dialog.getByRole('tab', { name: 'General' }).click();
    await dialog.getByRole('checkbox', { name: 'Real Tabs' }).check();
    await app.button(dialog, 'OK').click();
    await app.replaceText('ab');
    await app.select(2);
    await page.keyboard.press('Tab');
    await expect.poll(() => app.text()).toBe('ab\t');
  });

  test('Auto Indent off: Enter adds no white space', async ({ app, page }) => {
    const dialog = await editorOptions(app);
    await dialog.getByRole('tab', { name: 'General' }).click();
    await dialog.getByRole('checkbox', { name: 'Auto Indent' }).uncheck();
    await app.button(dialog, 'OK').click();
    await app.replaceText('    NOP');
    await app.select(7);
    await page.keyboard.press('Enter');
    await expect.poll(() => app.text()).toBe('    NOP\n');
  });

  test('Assembly Tabs and the fixed tab size reach new documents; Cancel changes nothing (note 8)', async ({ app }) => {
    let dialog = await editorOptions(app);
    await dialog.getByRole('tab', { name: 'General' }).click();
    await dialog.getByRole('radio', { name: 'Assembly Tabs' }).check();
    await app.button(dialog, 'Cancel').click();
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(async () => (await app.status())[4]).toContain('Fixed tabs 4');

    dialog = await editorOptions(app);
    await dialog.getByRole('tab', { name: 'General' }).click();
    await dialog.getByRole('radio', { name: 'Assembly Tabs' }).check();
    await app.button(dialog, 'OK').click();
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(async () => (await app.status())[4]).toContain('Assembly tabs');
  });

  test('the No Color preset draws comments black; Auto (default) draws them blue in the light theme', async ({
    app,
  }) => {
    await app.replaceText('* comment');
    const comment = app.content().locator('.e68-syntax__comment').first();
    await expect(comment).toHaveCSS('color', 'rgb(0, 0, 255)');
    const dialog = await editorOptions(app);
    await dialog.getByRole('tab', { name: 'Colors' }).click();
    await dialog.getByLabel('Color Presets').selectOption({ label: 'No Color' });
    await app.button(dialog, 'OK').click();
    await expect(comment).toHaveCSS('color', 'rgb(0, 0, 0)');
  });
});

test.describe('settings import and export (3.10, editor-ui §20.5)', () => {
  /**
   * Options > Import/Export Settings... (E4's dialog `Import/Export Settings`: one row per file of
   * the original with `Import...` and `Export...`, named `Import settings.dat` and so on, a status
   * line and Close). Export and Import go through the active file backend's Save and Open dialogs.
   */
  async function transferDialog(app: App) {
    await app.chooseMenu('Options', 'Import/Export Settings...');
    const dialog = app.dialog('Import/Export Settings');
    await expect(dialog).toBeVisible();
    return dialog;
  }

  /** Export settings.dat into My Programs as `name` and closes the dialog. */
  async function exportSettings(app: App, name: string): Promise<void> {
    const dialog = await transferDialog(app);
    await app.button(dialog, 'Export settings.dat').click();
    const save = app.dialog('Export settings.dat');
    await expect(save).toBeVisible();
    await app.fileDialogName(save, name, 'Save');
    await expect(save).toBeHidden();
    await expect(dialog.getByRole('status')).toHaveText(new RegExp(`^Exported settings\\.dat to .*${name}\\.$`));
    await app.button(dialog, 'Close').click();
    await expect(dialog).toBeHidden();
  }

  test('Import/Export Settings... exports settings.dat with 57 CR LF lines', async ({ app }) => {
    await exportSettings(app, 'exported.dat');
    const text = latin1(await app.exportFile('exported.dat'));
    const lines = text.split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(lines.length - 1).toBe(57);
    expect(text).not.toMatch(/[^\r]\n/);
  });

  test('importing a settings.dat changes the options the dialogs show', async ({ app }) => {
    // Export the current settings, flip "Show Warnings" ($show warnings, line 5 of editor-ui §11.4),
    // put the file into My Programs and import it again.
    await exportSettings(app, 'original.dat');
    const original = latin1(await app.exportFile('original.dat')).split('\r\n');
    // One value per line, `<value>$<name>` (editor-ui §11.4): line 5 is `1$show warnings`.
    const index = original.findIndex((line) => /^[01]\$show warnings$/.test(line));
    expect(index, 'the line "<0 or 1>$show warnings"').toBe(4);
    const wasOn = original[index]!.startsWith('1');
    const changed = [...original];
    changed[index] = `${wasOn ? '0' : '1'}$show warnings`;
    await app.importFiles([{ name: 'changed.dat', data: changed.join('\r\n') }]);
    const dialog = await transferDialog(app);
    await app.button(dialog, 'Import settings.dat').click();
    const open = app.dialog('Import settings.dat');
    await expect(open).toBeVisible();
    await app.fileDialogName(open, 'changed.dat', 'Open');
    await expect(open).toBeHidden();
    await expect(dialog.getByRole('status')).toHaveText(/^Imported settings\.dat from .*changed\.dat\.$/);
    await app.button(dialog, 'Close').click();
    await expect(dialog).toBeHidden();
    const options = await assemblerOptions(app);
    const box = options.getByRole('checkbox', { name: 'Show Warnings', exact: true });
    if (wasOn) await expect(box).not.toBeChecked();
    else await expect(box).toBeChecked();
  });
});

test('Show Warnings off: the warning row is absent but the dialog still counts it (editor-ui §20.4, E4 and E5)', async ({
  app,
}) => {
  await requirePackage(app, 'E5');
  const dialog = await assemblerOptions(app);
  await dialog.getByRole('checkbox', { name: 'Show Warnings', exact: true }).uncheck();
  await app.button(dialog, 'OK').click();
  await app.dropFiles([{ name: 'noend.X68', data: crlf('    ORG    $1000', 'START:', '    SIMHALT') }]);
  await expect.poll(() => app.tabNames()).toContain('noend.X68');
  await app.press('ed.project.assemble');
  const status = app.dialog('Assembler Status - noend.X68');
  await expect(status).toBeVisible();
  expect(await status.innerText()).toMatch(/Warnings:\s*1/);
  await app.button(status, 'Close').click();
  await expect(app.page.getByText('WARNING: END directive missing, starting address not set')).toHaveCount(0);
});
