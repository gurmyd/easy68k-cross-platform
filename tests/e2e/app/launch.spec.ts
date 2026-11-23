// A file the installed web app is started with (ARCHITECTURE.md 5.7: manifest file handlers,
// "as the desktop association"). Owner: X1. The consumer of the launch queue is DV1's
// (features/pwa/launch.ts); linking the file so that Save writes back is FS2's.
//
// Playwright cannot install the app or double-click a file, so the page is given a launch queue
// before its code runs that hands over a real FileSystemFileHandle, as Chromium does for an
// installed app: one from the origin's private file system, which needs no picker. Only Chromium has
// the File System Access API the link needs.

import type { Page } from '@playwright/test';
import { TRAILER, expect, test } from '../fixtures';

/** Runs in the page before the application: a launch queue with one file of the private file system. */
function launchWith({ name, text }: { name: string; text: string }): void {
  const queue = {
    setConsumer(consumer: (params: { files: unknown[] }) => void) {
      void (async () => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        consumer({ files: [handle] });
      })();
    },
  };
  Object.defineProperty(window, 'launchQueue', { value: queue, configurable: true });
}

/**
 * The file's text, read once. Only call it when the application has no write of the file open: a
 * read that overlaps the application's Save fails in Chromium (the File taken by getFile() is
 * NotReadableError once the writable stream's close replaced the file, and getFileHandle() can
 * meet the moment of the swap as NotFoundError; errata X1.md entry 15).
 */
async function privateFileText(page: Page, name: string): Promise<string> {
  return page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle(fileName)).getFile()).text();
  }, name);
}

test.describe('launched files (installed app, 5.7)', () => {
  test('an .X68 opens in Editor mode as a linked file that Save writes back; the status line hides /linked/', async ({
    app,
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'file handlers and the File System Access API are Chromium only');
    await context.addInitScript(launchWith, { name: 'launched.X68', text: '* launched\r\n' });
    await app.open();
    await expect.poll(() => app.tabNames(), { message: 'the launched file is opened' }).toContain('launched.X68');
    expect(await app.mode()).toBe('editor');
    expect(await app.text()).toBe('* launched\n');
    const windowStatus = page.locator('[data-e68-editor-status="path"]');
    // ARCHITECTURE-PLUS P3.2.5 (N8): the place text of a linked file.
    await expect(windowStatus).toHaveText('launched.X68 - on this computer, edited in place');
    expect(await page.locator('body').innerText()).not.toContain('/linked/');

    await app.replaceText('* saved back');
    expect((await app.tabs()).find((tab) => tab.name === 'launched.X68')?.modified).toBe(true);
    await app.press('ed.file.save');
    // Save is finished when the document is no longer modified: the application's write of the real
    // file has been closed by then (a linked file's Save resolves after the stream's close). Only
    // then is the real file read, once, and its bytes must be exactly the saved text.
    await expect
      .poll(async () => (await app.tabs()).find((tab) => tab.name === 'launched.X68')?.modified, {
        message: 'Save has finished',
      })
      .toBe(false);
    expect(await privateFileText(page, 'launched.X68')).toBe('* saved back\r\n' + TRAILER);
  });
});
