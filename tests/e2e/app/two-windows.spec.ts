// Two windows on one store (ARCHITECTURE.md 3.8.6, 3.9.3, 3.9.4; 6.6 "two windows on one store: a
// file saved in one appears in the other, the save-conflict question, settings, drafts not offered
// twice"). Owner: X1.
//
// The windows are two pages of one browser context, which share storage, Web Locks and
// BroadcastChannels as two tabs of one browser profile do.

import { crlf, expect, requirePackage, test, type App } from '../fixtures';
import { DRAFTS_OFFER, crash, draftsCheckDone, waitForDrafts, withDraftsDiagnosis } from '../fixtures/windows';

const background = (app: App) =>
  app.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim().toUpperCase());

test('a file saved in one window appears in the other without a reload', async ({ app }) => {
  const other = await app.openWindow();
  await other.showFiles();
  await expect(other.treeItem('shared.X68')).toHaveCount(0);
  await app.saveAs('shared.X68');
  await expect(other.treeItem('shared.X68')).toBeVisible();
  await other.treeItem('shared.X68').dblclick();
  await expect.poll(() => other.tabNames()).toContain('shared.X68');
});

test('saving over a file another window changed asks "has been changed outside this window"; No keeps it, Yes overwrites', async ({
  app,
  page,
}) => {
  // Two windows, an import and three exports: slow in WebKit on a loaded machine.
  test.setTimeout(240_000);
  await app.importFiles([{ name: 'both.X68', data: crlf('START') }]);
  await app.openFile('both.X68');
  const other = await app.openWindow();
  await other.openFile('both.X68');

  // The first window saves first.
  await app.select(0);
  await page.keyboard.type('* first window\n');
  await app.press('ed.file.save');
  await expect.poll(async () => (await app.status())[1]).toBe('');

  // The second window, which loaded the file before that save, is asked.
  await other.select(0);
  await other.page.keyboard.type('* second window\n');
  await other.press('ed.file.save');
  const box = other.messageBox;
  await expect(box).toBeVisible();
  expect(await other.boxText(box)).toContain("'both.X68' has been changed outside this window. Save anyway?");
  await expect(box.locator('.e68-dialog__footer').getByRole('button')).toHaveText(['Yes', 'No']);
  await other.button(box, 'No').click();
  await expect(box).toBeHidden();
  expect((await other.status())[1]).toBe('Modified');
  expect(Buffer.from(await app.exportFile('both.X68')).toString('latin1')).toMatch(/^\* first window\r\nSTART\r\n/);

  await other.press('ed.file.save');
  await other.button(other.messageBox, 'Yes').click();
  await expect.poll(async () => (await other.status())[1]).toBe('');
  expect(Buffer.from(await app.exportFile('both.X68')).toString('latin1')).toMatch(/^\* second window\r\nSTART\r\n/);
});

test('a theme chosen in one window reaches the other at once (settings, rule 2)', async ({ app }) => {
  const other = await app.openWindow();
  await app.toolbarButton('app.theme.set').click();
  await app.menuItem(app.openMenuList, 'Dark').click();
  await expect.poll(() => background(app)).toBe('#111418');
  await expect.poll(() => background(other)).toBe('#111418');
  await other.toolbarButton('app.theme.set').click();
  await other.menuItem(other.openMenuList, 'Light').click();
  await expect.poll(() => background(app)).toBe('#F3F4F6');
});

test('an editor setting changed in one window takes effect in the other at once (rule 2, E4)', async ({ app }) => {
  await requirePackage(app, 'E4');
  const other = await app.openWindow();
  await app.chooseMenu('Options', 'Editor Options...');
  const dialog = app.dialog('EASy68K Editor Options');
  await dialog.getByRole('tab', { name: 'General' }).click();
  await dialog.getByRole('checkbox', { name: 'Real Tabs' }).check();
  await app.button(dialog, 'OK').click();
  await other.replaceText('ab');
  await other.select(2);
  await other.page.keyboard.press('Tab');
  await expect.poll(() => other.text()).toBe('ab\t');
});

test('the panel layout of a window that is already open stays as it is when another changes it (rule 2)', async ({
  app,
}) => {
  const other = await app.openWindow();
  await app.toolbarButton('app.files.toggle').click();
  await expect(app.filesPanel).toBeHidden();
  // The other window keeps its Files panel; a window opened now takes the stored layout.
  await expect(other.filesPanel).toBeVisible();
  const third = await app.openWindow();
  await expect(third.filesPanel).toBeHidden();
});

test('drafts: a window does not offer the drafts of a window that is still open', async ({ app, page }) => {
  await app.select(0);
  await page.keyboard.type('ALIVE ');
  await waitForDrafts(app, 1);
  const other = await app.openWindow();
  await draftsCheckDone(other);
  await expect(other.page.getByText(DRAFTS_OFFER)).toHaveCount(0);
  await expect(app.page.getByText(DRAFTS_OFFER)).toHaveCount(0);
});

test('drafts: two windows that start together after a crash offer the drafts exactly once', async ({ app, page }) => {
  await app.select(0);
  test.setTimeout(240_000); // four windows
  await page.keyboard.type('CRASHED ');
  await waitForDrafts(app, 1);
  // A window that stays open (not the crashed one) is there to open the next two.
  const keeper = await app.openWindow();
  await draftsCheckDone(keeper);
  await crash(app);

  const [first, second] = await Promise.all([keeper.openWindow(), keeper.openWindow()]);
  const windows = [keeper, first, second];
  const offers = () =>
    Promise.all([first, second].map((w) => w.page.getByText(DRAFTS_OFFER).count())).then(([a, b]) => a! + b!);
  // Exactly one of the two offers (the other waits for the offer lock). On failure the message says
  // what each window saw (E1 errata entry 19: a crashed window's lock can be listed for a moment).
  await withDraftsDiagnosis(windows, () =>
    expect.poll(offers, { message: 'exactly one window offers the drafts' }).toBe(1),
  );
  const offering = (await first.page.getByText(DRAFTS_OFFER).count()) === 1 ? first : second;
  const quiet = offering === first ? second : first;
  await offering.button(offering.messageBox, 'Restore').click();
  await expect(offering.messageBox).toBeHidden();
  await withDraftsDiagnosis(windows, async () => {
    await draftsCheckDone(quiet);
    await expect(quiet.page.getByText(DRAFTS_OFFER)).toHaveCount(0);
    await expect(keeper.page.getByText(DRAFTS_OFFER)).toHaveCount(0);
    await expect.poll(() => offering.tabNames()).toContain('untitled2.x68');
    // The work is kept: one draft, now the offering window's, with the crashed window's text.
    await waitForDrafts(offering, 1);
  });
});
