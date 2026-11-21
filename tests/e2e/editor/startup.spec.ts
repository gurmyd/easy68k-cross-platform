// Editor mode at start-up and the start-up arguments of the web (ARCHITECTURE.md 1.3.3 row
// "Start-up", 5.7; editor-ui §1, §12). Owner: X1.

import { TEMPLATE, crlf, expect, test } from '../fixtures';

test.describe('start-up', () => {
  test('one new document from the template, not modified, title with the port name', async ({ app, page }) => {
    expect(await app.mode()).toBe('editor');
    expect(await app.tabNames()).toEqual(['untitled1.x68']);
    expect(await app.text()).toBe(TEMPLATE);
    const [position, modified, insert] = await app.status();
    expect([position, modified, insert]).toEqual(['1: 1', '', 'Insert']);
    expect((await app.tabs())[0]?.modified).toBe(false);
    await expect(page).toHaveTitle(/^EASy68K Editor\/Assembler v5\.16\.01 - unofficial port \d+\.\d+\.\d+/);
  });

  test('?open=<path> opens a file of the browser store in Editor mode', async ({ app }) => {
    await app.importFiles([{ name: 'start.X68', data: crlf('* opened by the URL', '    END    START') }]);
    await app.open('?open=/browser/start.X68');
    expect(await app.mode()).toBe('editor');
    await expect(app.tab('start.X68')).toBeVisible();
    await expect.poll(() => app.text()).toBe('* opened by the URL\n    END    START\n');
  });
});
