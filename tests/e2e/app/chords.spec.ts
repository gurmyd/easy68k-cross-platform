// The browser chords the dispatcher cancels (ARCHITECTURE.md 2.9.3; 6.6 "for the chords of 2.9.3
// that the dispatcher cancels: that defaultPrevented is true on the event"; errata W3.md entry 2).
// Owner: X1.
//
// This proves what the page does with the key. Whether each real browser then keeps quiet (F5 does
// not reload, Ctrl+S does not save the page) is the manual browser shortcut table of 6.8: test
// automation does not pass through the browser's own shortcut handling.

import { expect, playwrightKey, test, type App, type KeyMap } from '../fixtures';

/** The chords of 2.9.3: F5, F6, F7, F10, Ctrl+O/S/P/F/G/R, and on macOS the Cmd forms but Cmd+R. */
function guardedChords(keys: KeyMap): string[] {
  const letters = ['O', 'S', 'P', 'F', 'G', 'R'];
  return [
    'F5',
    'F6',
    'F7',
    'F10',
    ...letters.map((letter) => `Ctrl+${letter}`),
    ...(keys === 'mac' ? letters.filter((letter) => letter !== 'R').map((letter) => `Cmd+${letter}`) : []),
  ];
}

/** Records, for every key-down after the application's own listener, whether it was cancelled. */
async function record(app: App): Promise<void> {
  await app.page.evaluate(() => {
    const log: [string, boolean][] = [];
    (window as unknown as { __keys: typeof log }).__keys = log;
    window.addEventListener(
      'keydown',
      (event) => {
        const chord = [
          event.ctrlKey && 'Ctrl',
          event.metaKey && 'Cmd',
          event.altKey && 'Alt',
          event.shiftKey && 'Shift',
          event.code,
        ]
          .filter(Boolean)
          .join('+');
        log.push([chord, event.defaultPrevented]);
      },
      true,
    );
  });
}

const recorded = (app: App) =>
  app.page.evaluate(() => (window as unknown as { __keys: [string, boolean][] }).__keys.splice(0));

/** Presses each chord where the focus is, closing whatever a command opened, and returns the misses. */
async function pressAll(app: App, chords: string[]): Promise<string[]> {
  const missed: string[] = [];
  for (const chord of chords) {
    await app.page.keyboard.press(playwrightKey(chord));
    const events = await recorded(app);
    const last = events.at(-1);
    if (!last || !last[1]) missed.push(`${chord} (${JSON.stringify(events)})`);
    // A command may have opened a dialog (Open, Save As); close it before the next chord.
    const open = app.page.locator('[role=dialog][aria-modal=true], [role=alertdialog]');
    for (let attempt = 0; attempt < 5 && (await open.count()) > 0; attempt++) {
      // Esc closes most dialogs; a message box without Cancel (EASyBIN's) needs its last button.
      if (attempt === 0) {
        await app.page.keyboard.press('Escape');
        await expect(open)
          .toHaveCount(0, { timeout: 3_000 })
          .catch(() => undefined);
      } else {
        await open.last().locator('.e68-dialog__footer button').last().click();
      }
    }
    await expect(open).toHaveCount(0);
  }
  return missed;
}

test('Editor mode: every chord of 2.9.3 is cancelled, in the editor and in the Files panel', async ({ app }) => {
  await record(app);
  await app.focusEditor();
  expect(await pressAll(app, guardedChords(app.keys))).toEqual([]);
  await app.showFiles();
  await app.filesPanel.getByRole('tree').focus();
  expect(await pressAll(app, guardedChords(app.keys))).toEqual([]);
});

test('Simulator mode: every chord of 2.9.3 is cancelled with the focus on the registers', async ({ app, page }) => {
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Simulator' }).click();
  await expect.poll(() => app.mode()).toBe('simulator');
  await record(app);
  await page.locator('[data-e68-panel="registers"]').locator('input').first().focus();
  expect(await pressAll(app, guardedChords(app.keys))).toEqual([]);
});

test('EASyBIN mode: every chord of 2.9.3 is cancelled', async ({ app, page }) => {
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'EASyBIN' }).click();
  await expect.poll(() => app.mode()).toBe('easybin');
  await record(app);
  await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'EASyBIN' }).focus();
  expect(await pressAll(app, guardedChords(app.keys))).toEqual([]);
});

test('while a modal dialog is open the chords are cancelled too', async ({ app }) => {
  await app.chooseMenu('Help', 'About');
  const dialog = app.dialog('About EASy68K');
  await expect(dialog).toBeVisible();
  await record(app);
  for (const chord of guardedChords(app.keys)) {
    await app.page.keyboard.press(playwrightKey(chord));
    const last = (await recorded(app)).at(-1);
    expect(last?.[1], chord).toBe(true);
    await expect(dialog).toBeVisible();
  }
});
