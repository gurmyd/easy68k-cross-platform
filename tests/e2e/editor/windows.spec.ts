// The tab model of the editor area and the Window menu's layouts (ARCHITECTURE.md 1.3.1 Window
// rows, 1.3.3 row "MDI child windows", 2.2, 2.4, note 9). Owner: X1.

import { expect, test, type App } from '../fixtures';

const layout = (app: App) => app.page.locator('.e68-editor').getAttribute('data-layout');

test.describe('documents as tabs', () => {
  test('one tab per document in the order of opening; a click on a tab activates it', async ({ app }) => {
    await app.toolbarButton('ed.file.new').click();
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'untitled2.x68', 'untitled3.x68']);
    expect((await app.tabs()).map((tab) => tab.selected)).toEqual([false, false, true]);
    await app.tab('untitled1.x68').click();
    await expect.poll(async () => (await app.tabs()).map((tab) => tab.selected)).toEqual([true, false, false]);
    // The status bar names the active document.
    await expect(app.pane().getByRole('group', { name: 'Status of untitled1.x68' })).toBeVisible();
  });

  test('each document keeps its own text, caret and Insert/Replace state', async ({ app, page }) => {
    await app.replaceText('first');
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames()).toHaveLength(2);
    await app.replaceText('second');
    await app.press('ed.edit.toggleInsert');
    await expect.poll(async () => (await app.status())[2]).toBe('Replace');
    await app.tab('untitled1.x68').click();
    await expect.poll(() => app.text()).toBe('first');
    expect((await app.status())[2]).toBe('Insert');
    await app.tab('untitled2.x68').click();
    await expect.poll(() => app.text()).toBe('second');
    expect((await app.status())[2]).toBe('Replace');
    await page.keyboard.press('Escape');
  });
});

test.describe('Window menu layouts (note 9)', () => {
  test('Tile Horizontally and Tile Vertically show two panes; Cascade one pane with every document as a tab', async ({
    app,
  }) => {
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames()).toHaveLength(2);
    expect(await layout(app)).toBe('one');

    await app.chooseMenu('Window', 'Tile Horizontally');
    await expect.poll(() => layout(app)).toBe('horizontal');
    await expect(app.pane(1)).toBeVisible();
    const top = await app.pane(0).boundingBox();
    const bottom = await app.pane(1).boundingBox();
    expect(bottom!.y).toBeGreaterThan(top!.y + top!.height - 2);
    const both = [...(await app.tabNames(0)), ...(await app.tabNames(1))].sort();
    expect(both).toEqual(['untitled1.x68', 'untitled2.x68']);

    await app.chooseMenu('Window', 'Tile Vertically');
    await expect.poll(() => layout(app)).toBe('vertical');
    const left = await app.pane(0).boundingBox();
    const right = await app.pane(1).boundingBox();
    expect(right!.x).toBeGreaterThan(left!.x + left!.width - 2);

    await app.chooseMenu('Window', 'Cascade');
    await expect.poll(() => layout(app)).toBe('one');
    await expect(app.pane(1)).toHaveCount(0);
    expect((await app.tabNames(0)).sort()).toEqual(['untitled1.x68', 'untitled2.x68']);
  });

  test('a new document opens in the active pane', async ({ app }) => {
    await app.toolbarButton('ed.file.new').click();
    await app.chooseMenu('Window', 'Tile Vertically');
    await expect.poll(() => layout(app)).toBe('vertical');
    await app.content(1).click();
    await app.toolbarButton('ed.file.new').click();
    await expect.poll(() => app.tabNames(1)).toContain('untitled3.x68');
    expect(await app.tabNames(0)).not.toContain('untitled3.x68');
  });
});
