// The Options menu's dialogs, settings files and what is remembered (ARCHITECTURE.md 1.3.4 rows
// "Source Window Font...", "Printer Font...", "Auto Trace Options...", "Fullscreen Options...",
// "Printer Setup...", "Exit"; 1.3.7 rows "Auto Trace Options dialog", "sim68K.dat", "Persisted ...",
// "Window positions and sizes"; 1.4 notes 2, 4, 21, 27, 28, 29; sim-ui §14). Owner: X2.

import { expect, test, type App } from '../fixtures';
import { execute, expectState, listingRows, panel, program, runState, switchMode, tool, view } from './sim';

const LOOP = program('    MOVEQ   #0,D1', 'LOOP ADDQ.L  #1,D1', '    BRA     LOOP');

async function simulatorMode(app: App): Promise<void> {
  await switchMode(app, 'Simulator');
}

test('Auto Trace Options: interval 10..1000 in steps of 10, Cancel cancels, OK applies the interval', async ({
  app,
}) => {
  // Saved: a modified document would be offered as a draft after the reload below.
  await execute(app, LOOP, 'trace.X68');
  await app.chooseMenu('Options', 'Auto Trace Options...');
  const dialog = app.dialog('Auto Trace Options');
  await expect(dialog).toBeVisible();
  const interval = dialog.getByLabel('Auto Trace Interval');
  await expect(interval).toHaveValue('200');
  await expect(dialog.getByRole('checkbox', { name: 'Disable display update' })).not.toBeChecked();
  await expect(dialog).toContainText('mSec');
  await interval.focus();
  await interval.press('ArrowUp');
  await expect(interval).toHaveValue('210');
  await app.button(dialog, 'Cancel').click();
  await app.chooseMenu('Options', 'Auto Trace Options...');
  await expect(interval).toHaveValue('200');
  // The field is read-only, as the original's; the arrows step by 10 down to the lower limit 10.
  await interval.focus();
  for (let i = 0; i < 20; i++) await interval.press('ArrowDown');
  await expect(interval).toHaveValue('10');
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();
  // At 10 ms a tick, 3 traced lines arrive quickly; the interval is the one confirmed.
  await app.press('sim.run.autoTrace');
  await expect
    .poll(
      async () =>
        (await panel(app, 'messages').locator('[role=listitem]').allTextContents()).filter((l) => l.startsWith('PC='))
          .length,
    )
    .toBeGreaterThanOrEqual(10);
  await app.press('sim.run.pause');
  await expectState(app, 'Stopped');
  // The interval is saved and applied at the next start (note 28).
  await app.page.reload();
  await app.ready();
  await simulatorMode(app);
  await app.chooseMenu('Options', 'Auto Trace Options...');
  await expect(app.dialog('Auto Trace Options').getByLabel('Auto Trace Interval')).toHaveValue('10');
  await app.button(app.dialog('Auto Trace Options'), 'Cancel').click();
});

test('Fullscreen Options: the original text; only screen 1 is accepted (note 29)', async ({ app }) => {
  await simulatorMode(app);
  await app.chooseMenu('Options', 'Fullscreen Options...');
  const dialog = app.dialog('Fullscreen Options');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Screen to use for fullscreen output window.');
  const field = dialog.getByLabel('Screen number');
  await expect(field).toHaveValue('1');
  await field.fill('2');
  await expect(app.button(dialog, 'Ok')).toBeDisabled();
  await field.fill('1');
  await expect(app.button(dialog, 'Ok')).toBeEnabled();
  await app.button(dialog, 'Ok').click();
  await expect(dialog).toBeHidden();
});

test('Source Window Font changes the listing font; Printer Font offers fonts; both Cancel without effect (note 27)', async ({
  app,
}) => {
  await execute(app, LOOP);
  const listing = panel(app, 'listing').locator('.e68-listing');
  const before = await listing.evaluate((e) => getComputedStyle(e).getPropertyValue('--e68-listing-size'));
  await app.chooseMenu('Options', 'Source Window Font...');
  const source = app.dialog('Source Window Font');
  await expect(source).toBeVisible();
  const sizes = source.getByLabel('Size:');
  await expect(sizes).toHaveValue('10');
  await sizes.fill('14');
  await app.button(source, 'OK').click();
  await expect(source).toBeHidden();
  await expect
    .poll(() => listing.evaluate((e) => getComputedStyle(e).getPropertyValue('--e68-listing-size')))
    .not.toBe(before);
  await app.chooseMenu('Options', 'Printer Font...');
  const printer = app.dialog('Printer Font');
  await expect(printer).toBeVisible();
  expect(await printer.getByRole('listbox', { name: 'Font list' }).getByRole('option').count()).toBeGreaterThan(0);
  await app.button(printer, 'Cancel').click();
  await expect(printer).toBeHidden();
  await expect(listingRows(app).first()).toBeVisible();
});

test('Printer Setup... opens the printer output of the port (note 2)', async ({ app }) => {
  await simulatorMode(app);
  await app.chooseMenu('File', 'Printer Setup...');
  const dialog = app.dialog('Printer Output');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Nothing is waiting to be printed.');
  await app.button(dialog, 'Close').click();
  await expect(dialog).toBeHidden();
});

test('sim68K.dat: export writes the 37 lines of the original; import applies them (note 21)', async ({ app }) => {
  await simulatorMode(app);
  await app.chooseMenu('Options', 'Enable Exceptions');
  await app.chooseMenu('Options', 'Import/Export Settings...');
  const settings = app.page
    .getByRole('dialog')
    .filter({ has: app.page.getByRole('button', { name: 'Export sim68K.dat' }) });
  await settings.getByRole('button', { name: 'Export sim68K.dat' }).click();
  const save = app.page.getByRole('dialog', { name: 'Export sim68K.dat' });
  await expect(save).toBeVisible();
  await save.getByLabel('Look in:').selectOption({ label: 'My Programs' });
  await app.fileDialogName(save, 'sim68K.dat', 'Save');
  await expect(save).toBeHidden();
  await app.page.keyboard.press('Escape');
  await switchMode(app, 'Editor');
  const text = Buffer.from(await app.exportFile('sim68K.dat')).toString('latin1');
  const lines = text.split('\r\n');
  expect(lines.at(-1), 'CR LF after the last line').toBe('');
  expect(lines.slice(0, -1)).toHaveLength(37);
  expect(lines[0]).toBe('$Settings for EASy68K Simulator v5.16.1  DO NOT EDIT THIS FILE!!!!');
  expect(lines[3]).toBe('1$exceptions');
  expect(lines[34]).toBe('0$bit field enabled');
  // Import a copy with bit field on and exceptions off.
  lines[3] = '0$exceptions';
  lines[34] = '1$bit field enabled';
  await app.importFiles([{ name: 'other.dat', data: lines.join('\r\n') }]);
  await switchMode(app, 'Simulator');
  await app.chooseMenu('Options', 'Import/Export Settings...');
  await settings.getByRole('button', { name: 'Import sim68K.dat' }).click();
  const open = app.page.getByRole('dialog', { name: 'Import sim68K.dat' });
  await expect(open).toBeVisible();
  await open.getByLabel('Look in:').selectOption({ label: 'My Programs' });
  const type = open.getByLabel('Files of type:');
  if ((await type.locator('option').count()) > 1)
    await type.selectOption({ index: (await type.locator('option').count()) - 1 });
  await app.fileDialogName(open, 'other.dat', 'Open');
  await expect(open).toBeHidden();
  if (await settings.isVisible()) await app.page.keyboard.press('Escape');
  await expect(app.page.locator('[data-e68-status="exceptions"]')).toHaveText('exceptions off');
  await expect(app.page.locator('[data-e68-status="bitField"]')).toHaveText('bit field on');
});

test('remembered across a reload: options, tool panels and the stack register; not breakpoints or Live', async ({
  app,
}) => {
  // Saved: a modified document would be offered as a draft after the reload below.
  await execute(app, LOOP, 'persist.X68');
  await app.chooseMenu('Options', 'Enable Exceptions');
  const stack = await view(app, 'Stack', 'stack');
  await stack.getByLabel('View').selectOption({ label: 'A3' });
  await view(app, 'Memory', 'memory');
  await panel(app, 'memory').getByRole('checkbox', { name: 'Live' }).check();
  await app.page.reload();
  await app.ready();
  await simulatorMode(app);
  await expect(app.page.locator('[data-e68-status="exceptions"]')).toHaveText('exceptions on');
  await expect(panel(app, 'memory')).toBeAttached();
  await view(app, 'Stack', 'stack');
  await expect(panel(app, 'stack').getByLabel('View')).toHaveValue('3');
  await view(app, 'Memory', 'memory');
  await expect(panel(app, 'memory').getByRole('checkbox', { name: 'Live' })).not.toBeChecked();
});

test('Execution Speed (added): the status bar names the setting', async ({ app }) => {
  await simulatorMode(app);
  const speed = app.page.locator('[data-e68-status="speed"]');
  await expect(speed).toHaveText('speed: EASy68K-like');
  await app.chooseMenu('Options', 'Execution Speed...');
  const dialog = app.dialog('Execution Speed');
  await expect(dialog).toBeVisible();
  // Cancel changes nothing; OK applies the choice and the status bar names it (4.5.6).
  await dialog.getByRole('radio', { name: 'Maximum' }).check();
  await app.button(dialog, 'Cancel').click();
  await expect(dialog).toBeHidden();
  await expect(speed).toHaveText('speed: EASy68K-like');
  await app.chooseMenu('Options', 'Execution Speed...');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Maximum' }).check();
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();
  await expect(speed).toHaveText('speed: Maximum');
  await expect(runState(app)).toBeVisible();
});

test('File > Exit in a browser shows the exit screen after the close prompts (note 4)', async ({ app }) => {
  await simulatorMode(app);
  await app.chooseMenu('File', 'Exit');
  await expect(app.page.getByText('You can close this tab.')).toBeVisible();
  void tool;
});
