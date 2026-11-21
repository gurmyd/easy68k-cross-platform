// Check 4 of ARCHITECTURE.md 6.7: quit with a modified document; the question appears; Cancel keeps
// the app running.
//
// The document is modified by typing into the editor (real key events, which also give the page the
// user activation without which Chromium asks nothing before unloading). Quit is app.quit() in the
// main process, the same call as the Quit item of the application menu (role `quit`), reached
// through the page's bridge (`window.easy68kDesktop.quit()`, Platform.quit). The page's unload guard
// (Platform.confirmBeforeUnload) makes the main process ask (desktop/src/windows.ts
// `will-prevent-unload`): "Leave EASy68K?" with the buttons Leave and Stay, Stay being the cancel
// button (docs/porting/errata/DV2.md entry 12). The question is a native sheet, which the page
// cannot see: it is read and answered through System Events.
//
// Owner: DV3.

import { expect, test } from '@playwright/test';
import {
  IS_MAC,
  launchPackaged,
  nativeWindows,
  NOT_MAC,
  pressDialogButton,
  screenCapture,
  waitFor,
  waitForApplication,
  type RunningApp,
} from './harness';

let running: RunningApp | null = null;

test.afterEach(async () => {
  test.setTimeout(120_000);
  await running?.close();
  running = null;
});

test('quit with a modified document asks first, and Cancel (Stay) keeps the app running', async () => {
  test.skip(!IS_MAC, NOT_MAC);
  test.setTimeout(300_000);
  running = await launchPackaged({ name: 'quit' });
  const { page, pid } = running;
  await waitForApplication(page);

  // Modify the new document of Editor mode by typing into it.
  const editor = page.locator('[data-e68-panel="editor"] .cm-content').first();
  // The editor's own status row (EditorStatusBar.tsx: position, Modified, Insert, ...), not the
  // shell's status bar below it, which shows only the document's name in Editor mode.
  const modified = page.locator('[data-e68-panel="editor"] .e68-editor__cell--modified').first();
  await editor.waitFor({ timeout: 60_000 });
  await editor.click();
  await page.keyboard.type('* modified', { delay: 30 });
  await expect(modified).toHaveText('Modified', { timeout: 30_000 });
  await running.screenshot('modified');

  // Quit, as the application menu's Quit does (app.quit()). Not awaited: the main process is busy
  // with the question until it is answered.
  void page
    .evaluate(() => {
      setTimeout(() => window.easy68kDesktop?.quit(), 100);
    })
    .catch(() => {});

  const question = await waitFor('the question before quitting', 30_000, () => {
    const sheets = nativeWindows(pid).flatMap((window) => window.sheets);
    return sheets.find((sheet) => sheet.buttons.includes('Stay')) ?? null;
  });
  console.log(`question: ${JSON.stringify(question)}`);
  screenCapture('quit-question');
  expect(question.texts.join(' ')).toContain('Leave EASy68K?');
  expect(question.buttons).toEqual(expect.arrayContaining(['Leave', 'Stay']));

  expect(pressDialogButton(pid, 'Stay'), 'the Stay button was pressed').toBe(true);
  await waitFor('the question to close', 15_000, () =>
    nativeWindows(pid).some((window) => window.sheets.some((sheet) => sheet.buttons.includes('Stay'))) ? null : true,
  );

  // Still running: the process, its window and its page, with the document still modified.
  await page.waitForTimeout(3000);
  expect(running.alive(), 'the main process is still running').toBe(true);
  expect(nativeWindows(pid).length, 'the window is still open').toBeGreaterThan(0);
  expect(await page.evaluate(() => 6 * 7)).toBe(42);
  await expect(modified).toHaveText('Modified');
  await running.screenshot('still-running');
});
