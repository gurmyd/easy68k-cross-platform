// Find, Find Next, Find And Replace (ARCHITECTURE.md 1.3.1 Edit rows, 1.3.3 rows "Find dialog" and
// "Replace dialog", note 7; editor-ui §14, §16, §20.6). Owner: X1. The feature is E6's (wave 2):
// every test waits for it (fixtures/pending.ts).

import { expect, requirePackage, test, type App } from '../fixtures';

test.beforeEach(async ({ app }) => {
  await requirePackage(app, 'E6');
});

/** Opens the Find dialog with the keyboard and returns it. */
async function openFind(app: App) {
  await app.focusEditor();
  await app.press('ed.edit.find');
  const dialog = app.dialog('Find');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Dismisses the information box `End of document reached.` and checks its text. */
async function endOfDocument(app: App): Promise<void> {
  const box = app.messageBox;
  await expect(box).toBeVisible();
  expect(await app.boxText(box)).toContain('End of document reached.');
  await app.button(box, 'OK').click();
  await expect(box).toBeHidden();
}

test.describe('Find', () => {
  test('the dialog: Find what, the two options, "Find  (F3)" disabled while empty, Cancel; modeless', async ({
    app,
    page,
  }) => {
    await app.replaceText('text');
    await app.select(0);
    const dialog = await openFind(app);
    await expect(dialog).not.toHaveAttribute('aria-modal', 'true');
    const what = dialog.getByLabel('Find what:');
    await expect(what).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Match whole word only' })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Match case' })).not.toBeChecked();
    const find = dialog.getByRole('button', { name: 'Find  (F3)', exact: true });
    await what.fill('');
    await expect(find).toBeDisabled();
    await what.fill('x');
    await expect(find).toBeEnabled();
    // Modeless: the editor still takes typing while the dialog is open.
    await app.select(0);
    await page.keyboard.type('Q');
    await expect.poll(() => app.text()).toBe('Qtext');
    await expect(dialog).toBeVisible();
    await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
  });

  test('a selected word preloads the dialog; Enter finds the next one; at the end the box; F3 then starts at the top', async ({
    app,
    page,
  }) => {
    await app.replaceText('D0 x D0 y D0');
    await app.select(0, 2);
    const dialog = await openFind(app);
    await expect(dialog.getByLabel('Find what:')).toHaveValue('D0');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.selection()).toMatchObject({ from: 5, to: 7 });
    await dialog.getByRole('button', { name: 'Find  (F3)', exact: true }).click();
    await expect.poll(() => app.selection()).toMatchObject({ from: 10, to: 12 });
    await dialog.getByRole('button', { name: 'Find  (F3)', exact: true }).click();
    await endOfDocument(app);
    await app.button(dialog, 'Cancel').click();
    await app.focusEditor();
    await app.press('ed.edit.findNext');
    await expect.poll(() => app.selection()).toMatchObject({ from: 0, to: 2 });
  });

  test('without a selection the search starts at the caret (note 7)', async ({ app }) => {
    await app.replaceText('D0 x D0 y D0');
    await app.select(4);
    const dialog = await openFind(app);
    await dialog.getByLabel('Find what:').fill('D0');
    await dialog.getByRole('button', { name: 'Find  (F3)', exact: true }).click();
    await expect.poll(() => app.selection()).toMatchObject({ from: 5, to: 7 });
  });

  test('Match case and Match whole word only behave as named', async ({ app }) => {
    await app.replaceText('d0 LOOPD0 D0');
    await app.select(0);
    const dialog = await openFind(app);
    await dialog.getByLabel('Find what:').fill('D0');
    await dialog.getByRole('checkbox', { name: 'Match case' }).check();
    await dialog.getByRole('button', { name: 'Find  (F3)', exact: true }).click();
    await expect.poll(() => app.selection()).toMatchObject({ from: 7, to: 9 });
    await app.select(0);
    await dialog.getByRole('checkbox', { name: 'Match whole word only' }).check();
    await dialog.getByRole('button', { name: 'Find  (F3)', exact: true }).click();
    await expect.poll(() => app.selection()).toMatchObject({ from: 10, to: 12 });
  });

  test('the toolbar button and the Edit menu open the Find dialog', async ({ app }) => {
    await app.toolbarButton('ed.edit.find').click();
    await expect(app.dialog('Find')).toBeVisible();
    await app.button(app.dialog('Find'), 'Cancel').click();
    await app.chooseMenu('Edit', 'Find...');
    await expect(app.dialog('Find')).toBeVisible();
  });
});

test.describe('Replace', () => {
  test('the dialog: both boxes take the selection; Find Next, Replace and Replace All disabled while empty', async ({
    app,
  }) => {
    await app.replaceText('MOVE D0,D1');
    await app.select(5, 7);
    await app.focusEditor();
    await app.press('ed.edit.replace');
    const dialog = app.dialog('Replace');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Find what:')).toHaveValue('D0');
    await expect(dialog.getByLabel('Replace with')).toHaveValue('D0');
    await dialog.getByLabel('Find what:').fill('');
    for (const name of ['Find Next', 'Replace', 'Replace All'])
      await expect(dialog.getByRole('button', { name, exact: true })).toBeDisabled();
    await expect(dialog.getByRole('checkbox', { name: 'Match whole word only' })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Match case' })).toBeVisible();
    await app.button(dialog, 'Cancel').click();
    await expect(dialog).toBeHidden();
  });

  test('Replace All D0 -> D1 replaces all three and ends with the end-of-document box', async ({ app }) => {
    await app.replaceText('    MOVE D0,D2\n    ADD D0,D3\n    CLR D0');
    await app.select(0);
    await app.chooseMenu('Edit', 'Find And Replace...');
    const dialog = app.dialog('Replace');
    await dialog.getByLabel('Find what:').fill('D0');
    await dialog.getByLabel('Replace with').fill('D1');
    await dialog.getByRole('button', { name: 'Replace All', exact: true }).click();
    await endOfDocument(app);
    await expect.poll(() => app.text()).toBe('    MOVE D1,D2\n    ADD D1,D3\n    CLR D1');
  });

  test('Replace replaces a match and selects the next; a selection that is not a match is not replaced (note 7)', async ({
    app,
  }) => {
    await app.replaceText('aa D0 bb D0');
    await app.select(0, 2); // "aa": not a match
    await app.chooseMenu('Edit', 'Find And Replace...');
    const dialog = app.dialog('Replace');
    await dialog.getByLabel('Find what:').fill('D0');
    await dialog.getByLabel('Replace with').fill('D7');
    const replace = dialog.getByRole('button', { name: 'Replace', exact: true });
    await replace.click();
    // Note 7 (editor-ui §14.3 and the deviation table) settles only that "aa" is not replaced.
    // Whether that press already replaces the first D0 or first only selects it is left open; E6
    // replaces it. Either way, one more press at most leaves the first D0 replaced and the
    // next match selected.
    // Wait until the press has moved the selection off "aa": to the first D0 (only found) or to the
    // second (the first replaced).
    await expect.poll(async () => (await app.selection()).from).toBeGreaterThan(0);
    expect(await app.text()).toMatch(/^aa D[07] bb D0$/);
    if ((await app.selection()).from === 3) {
      expect(await app.text()).toBe('aa D0 bb D0');
      await replace.click();
    }
    await expect.poll(() => app.text()).toBe('aa D7 bb D0');
    await expect.poll(() => app.selection()).toMatchObject({ from: 9, to: 11 });
  });
});
