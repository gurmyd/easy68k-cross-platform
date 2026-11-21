// Themes (ARCHITECTURE.md 2.8, 1.5; 6.6 "themes"). Owner: X1.

import { expect, test, type App } from '../fixtures';

/** The window background token as the page computes it. */
const background = (app: App) =>
  app.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim().toUpperCase());

async function chooseTheme(app: App, caption: 'System' | 'Light' | 'Dark'): Promise<void> {
  await app.toolbarButton('app.theme.set').click();
  await app.menuItem(app.openMenuList, caption).click();
}

test('the Theme menu offers System, Light and Dark; System is the default', async ({ app }) => {
  await app.toolbarButton('app.theme.set').click();
  const entries = await app.entriesOf(app.openMenuList);
  expect(entries.map((e) => [e.caption, e.role])).toEqual([
    ['System', 'menuitemradio'],
    ['Light', 'menuitemradio'],
    ['Dark', 'menuitemradio'],
  ]);
  expect(entries.map((e) => e.checked)).toEqual([true, false, false]);
  await app.page.keyboard.press('Escape');
});

test('Light and Dark apply the token sets of 2.8 at once, and the choice survives a reload', async ({ app }) => {
  await chooseTheme(app, 'Dark');
  await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => background(app)).toBe('#111418');
  await app.open();
  await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => background(app)).toBe('#111418');
  await chooseTheme(app, 'Light');
  await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => background(app)).toBe('#F3F4F6');
});

test('System follows the colour scheme the browser reports', async ({ app, page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(app)).toBe('#111418');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => background(app)).toBe('#F3F4F6');
});
