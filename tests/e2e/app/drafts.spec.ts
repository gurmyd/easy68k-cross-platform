// Local drafts (ARCHITECTURE.md 3.9.4, 3.8.6 rule 4; 6.6 "drafts"). Owner: X1.

import { TEMPLATE, expect, test } from '../fixtures';
import { DRAFTS_OFFER, crash, draftsCheckDone, waitForDrafts } from '../fixtures/windows';

test('the drafts of a window that is gone are offered at the next start; Restore brings the text back, modified', async ({
  app,
  page,
}) => {
  await app.select(0);
  await page.keyboard.type('DRAFT ');
  await waitForDrafts(app, 1);
  await crash(app);

  const next = await app.openWindow();
  const offer = next.messageBox;
  await expect(offer).toBeVisible();
  await expect(offer.locator('.e68-dialog__title')).toHaveText('EASy68K');
  expect(await next.boxText(offer)).toContain(`${DRAFTS_OFFER} untitled1.x68.`);
  await expect(offer.locator('.e68-dialog__footer').getByRole('button')).toHaveText(['Restore', 'Discard']);
  // Escape does not dismiss the offer: the drafts would be lost silently.
  await next.page.keyboard.press('Escape');
  await expect(offer).toBeVisible();
  await next.button(offer, 'Restore').click();
  await expect(offer).toBeHidden();
  await expect.poll(() => next.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68']);
  await expect.poll(() => next.text()).toBe(`DRAFT ${TEMPLATE}`);
  expect((await next.tabs())[1]?.modified).toBe(true);
});

test('Discard removes the drafts; they are not offered again', async ({ app, page }) => {
  await app.select(0);
  await page.keyboard.type('GONE ');
  await waitForDrafts(app, 1);
  await crash(app);

  const second = await app.openWindow();
  await expect(second.messageBox).toBeVisible();
  await second.button(second.messageBox, 'Discard').click();
  await expect(second.messageBox).toBeHidden();
  expect(await second.tabNames()).toEqual(['untitled1.x68']);
  await waitForDrafts(second, 0);

  const third = await second.openWindow();
  await draftsCheckDone(third);
  await expect(third.page.getByText(DRAFTS_OFFER)).toHaveCount(0);
});

test('a saved document leaves no draft behind', async ({ app, page }) => {
  await app.select(0);
  await page.keyboard.type('X');
  await waitForDrafts(app, 1);
  await app.saveAs('saved.X68');
  await waitForDrafts(app, 0);
});
