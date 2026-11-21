// Panel layout persistence (ARCHITECTURE.md 2.3, 2.4, 3.10 AppSettings.layout; 6.6 "panel layout
// persistence"). Owner: X1.

import { expect, test } from '../fixtures';

test('the Files panel stays hidden after a reload once it is hidden', async ({ app }) => {
  await expect(app.filesPanel).toBeVisible();
  await expect(app.toolbarButton('app.files.toggle')).toHaveAttribute('aria-pressed', 'true');
  await app.toolbarButton('app.files.toggle').click();
  await expect(app.filesPanel).toBeHidden();
  await app.open();
  await expect(app.filesPanel).toBeHidden();
  await expect(app.toolbarButton('app.files.toggle')).toHaveAttribute('aria-pressed', 'false');
  await app.toolbarButton('app.files.toggle').click();
  await expect(app.filesPanel).toBeVisible();
});

test('tool panels of Simulator mode shown with the View menu are shown again after a reload; hidden by default', async ({
  app,
  page,
}) => {
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Simulator' }).click();
  await expect.poll(() => app.mode()).toBe('simulator');
  const memory = page.locator('[data-e68-panel="memory"]');
  const stack = page.locator('[data-e68-panel="stack"]');
  await expect(memory).toBeHidden(); // 2.4: Memory, Stack and Hardware hidden by default
  await expect(stack).toBeHidden();
  await app.chooseMenu('View', 'Memory');
  await expect(memory).toBeVisible();
  await app.open();
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Simulator' }).click();
  await expect.poll(() => app.mode()).toBe('simulator');
  await expect(memory).toBeVisible();
  await expect(stack).toBeHidden();
});

test('a dragged splitter keeps its size after a reload', async ({ app, page }) => {
  const splitter = page.getByRole('separator', { name: 'Resize the Files panel' });
  const before = Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  const after = Number(await splitter.getAttribute('aria-valuenow'));
  await app.open();
  await expect
    .poll(async () =>
      Number(await page.getByRole('separator', { name: 'Resize the Files panel' }).getAttribute('aria-valuenow')),
    )
    .toBe(after);
});
