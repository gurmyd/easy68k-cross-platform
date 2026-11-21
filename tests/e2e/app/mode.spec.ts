// The mode switch (ARCHITECTURE.md 1.1, 2.1, rule K5; 6.6 "mode switch"). Owner: X1.

import { expect, test, type App } from '../fixtures';

const menuTitles = (app: App) =>
  app.page.locator('.e68-shell__menubar .e68-menubar__title').evaluateAll((items) => items.map((i) => i.textContent));

const segment = (app: App, name: string) =>
  app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name });

test('three segments, Editor first and checked; each mode brings its own menu bar and toolbar', async ({ app }) => {
  await expect(app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio')).toHaveText([
    'Editor',
    'Simulator',
    'EASyBIN',
  ]);
  await expect(segment(app, 'Editor')).toHaveAttribute('aria-checked', 'true');
  expect(await menuTitles(app)).toEqual(['File', 'Edit', 'Project', 'Options', 'Window', 'Help']);
  await expect(app.page.getByRole('toolbar', { name: 'Editor toolbar' })).toBeVisible();

  await segment(app, 'Simulator').click();
  await expect.poll(() => app.mode()).toBe('simulator');
  await expect(segment(app, 'Simulator')).toHaveAttribute('aria-checked', 'true');
  expect(await menuTitles(app)).toEqual(['File', 'Search', 'Run', 'View', 'Options', 'Help']);
  await expect(app.page.getByRole('toolbar', { name: 'Simulator toolbar' })).toBeVisible();
  await expect(app.page.getByRole('toolbar', { name: 'Editor toolbar' })).toBeHidden();

  await segment(app, 'EASyBIN').click();
  await expect.poll(() => app.mode()).toBe('easybin');
  await expect(segment(app, 'EASyBIN')).toHaveAttribute('aria-checked', 'true');
});

test('a mode keeps its state while another is in front (2.1)', async ({ app }) => {
  await app.replaceText('* kept while away');
  await segment(app, 'Simulator').click();
  await expect.poll(() => app.mode()).toBe('simulator');
  await segment(app, 'Editor').click();
  await expect.poll(() => app.mode()).toBe('editor');
  await expect.poll(() => app.text()).toBe('* kept while away');
  expect((await app.status())[1]).toBe('Modified');
});

test('F4 cycles Editor > Simulator > EASyBIN > Editor from every mode (K5)', async ({ app }) => {
  await app.focusEditor();
  for (const mode of ['simulator', 'easybin', 'editor']) {
    await app.press('app.mode.next');
    await expect.poll(() => app.mode()).toBe(mode);
  }
});

test('the window title follows the mode', async ({ app, page }) => {
  await expect(page).toHaveTitle(/^EASy68K Editor\/Assembler v5\.16\.01/);
  await segment(app, 'Simulator').click();
  await expect(page).toHaveTitle(/^EASy68K Simulator v5\.16\.1/);
  await segment(app, 'EASyBIN').click();
  await expect(page).toHaveTitle(/^EASyBIN v2\.5\.0/);
});
