// The two short scenarios of N9 with two windows (ARCHITECTURE-PLUS P3.3.8, P3.3.10; P5 N9
// acceptance). Owner: N9. Run online by history.spec.ts and with the network cut after the first
// load by offline.spec.ts.
//
// The windows are two pages of one browser context, which share storage, Web Locks and
// BroadcastChannels as two tabs of one browser profile do (X1's convention, fixtures/windows.ts).

import { expect, test } from '@playwright/test';
import { PASS_LOCK } from '../../../app/src/core/history/limits';
import { formatSize } from '../../../app/src/core/history/size';
import { REASON_SHOWN_AS } from '../../../app/src/features/history/texts';
import { RELOAD_ACTION, changedOutsideText } from '../../../app/src/features/reload-offer/texts';
import { crlf, latin1, type App } from '../fixtures';
import { gridRows, heldLocks, holdHistoryPass, openEarlierVersions, toast, toastAction } from '../fixtures/plus';
import { EDITS, reopenedText, savedBytes } from './student';

const START = crlf('* shared between two windows', '    ORG    $1000', '    END    $1000');

/** Opens `shared.X68` of the Files panel in the window. */
async function openShared(app: App): Promise<void> {
  await app.showFiles();
  await expect(app.treeItem('shared.X68')).toBeVisible();
  await app.treeItem('shared.X68').dblclick();
  await expect.poll(async () => (await app.tabs()).find((tab) => tab.selected)?.name).toBe('shared.X68');
}

/** Replaces the text of the active document and saves it; waits until the save is done. */
async function editAndSave(app: App, text: string): Promise<void> {
  await app.replaceText(text);
  await app.press('ed.file.save');
  await expect.poll(async () => (await app.status())[1]).toBe('');
}

/** A restore from Earlier Versions in one window offers a reload in the other (P3.3.8, P3.3.10). */
export async function restoreOffersReload(app: App): Promise<void> {
  await test.step('the first window saves shared.X68 twice; the second opens it', async () => {
    await app.importFiles([{ name: 'shared.X68', data: START }]);
    await openShared(app);
    await editAndSave(app, EDITS[0]!);
    await editAndSave(app, EDITS[1]!);
  });
  const other = await app.openWindow();
  await test.step('the second window shows the second save, unmodified', async () => {
    await openShared(other);
    await expect.poll(() => other.text()).toBe(reopenedText(EDITS[1]!));
    expect((await other.status())[1]).toBe('');
  });

  await test.step('the first window restores the first save from Earlier Versions', async () => {
    const dialog = await openEarlierVersions(app, 'shared.X68');
    await expect
      .poll(async () => (await gridRows(dialog)).map((row) => row[2]))
      .toEqual([REASON_SHOWN_AS.saved, REASON_SHOWN_AS.saved, REASON_SHOWN_AS.opened]);
    await dialog.locator('[role=grid] [role=row][data-row="1"]').click();
    await expect(dialog.locator('[role=row][data-row="1"]')).toHaveAttribute('aria-selected', 'true');
    await app.button(dialog, 'Restore').click();
    await expect
      .poll(() => app.text(), { message: 'the restoring window reloads its own document' })
      .toBe(reopenedText(EDITS[0]!));
    await app.button(dialog, 'Close').click();
    await expect(dialog).toBeHidden();
  });

  await test.step('the second window offers a reload, and Reload shows the restored text', async () => {
    const text = changedOutsideText('shared.X68');
    await expect(toast(other, text)).toBeVisible();
    // The restoring window is not asked: it reloaded its document itself. Checked only now, once
    // the other window has shown its offer, so that the change has reached both windows: a check
    // right after Close would be true at any instant, even if the offer arrived a moment later.
    await expect(toast(app, text), 'the restoring window offers no reload').toHaveCount(0);
    expect(await other.text(), 'nothing changes before Reload is chosen').toBe(reopenedText(EDITS[1]!));
    await toastAction(other, text, RELOAD_ACTION).click();
    await expect.poll(() => other.text(), { message: 'Reload shows the restored text' }).toBe(reopenedText(EDITS[0]!));
    expect((await other.status())[1]).toBe('');
    expect(latin1(await other.exportFile('shared.X68'))).toBe(savedBytes(EDITS[0]!));
  });
}

/** A save in one window shows a new version in the other's open Earlier Versions dialog (P3.3.8). */
export async function saveShowsInOtherDialog(app: App): Promise<void> {
  await app.importFiles([{ name: 'shared.X68', data: START }]);
  await openShared(app);
  await editAndSave(app, EDITS[0]!);

  // A window's open history dialog reads its list again on every change it hears of: a message from
  // another window, and also its own window's global pass (ten seconds after the window starts, then
  // every ten minutes), which would bring the new row without any message. The pass lock is taken
  // before the second window exists, so that window never runs a pass during the test (P3.3.4: a
  // window that does not get the lock skips the pass): the new row can only come from the message.
  const releasePass = await holdHistoryPass(app);
  try {
    const other = await app.openWindow();
    await other.showFiles();
    const dialog = await openEarlierVersions(other, 'shared.X68');
    await expect
      .poll(async () => (await gridRows(dialog)).map((row) => [row[1], row[2]]))
      .toEqual([
        [formatSize(savedBytes(EDITS[0]!).length), REASON_SHOWN_AS.saved],
        [formatSize(START.length), REASON_SHOWN_AS.opened],
      ]);
    expect(await heldLocks(other), 'the pass lock is still held when the first window saves').toContain(PASS_LOCK);

    // The first window saves again while the dialog stays open in the other (BroadcastChannel
    // easy68k.history, P3.3.8).
    await editAndSave(app, EDITS[2]!);
    await expect
      .poll(async () => (await gridRows(dialog)).map((row) => [row[1], row[2]]), {
        message: 'the open dialog of the other window lists the new version',
      })
      .toEqual([
        [formatSize(savedBytes(EDITS[2]!).length), REASON_SHOWN_AS.saved],
        [formatSize(savedBytes(EDITS[0]!).length), REASON_SHOWN_AS.saved],
        [formatSize(START.length), REASON_SHOWN_AS.opened],
      ]);
    // The new row is the third attempt: its comparison shows it.
    await dialog.locator('[role=grid] [role=row][data-row="0"]').click();
    await expect(dialog.locator('.e68-history__view')).toContainText('(attempt 3)');
    await other.button(dialog, 'Close').click();
    await expect(dialog).toBeHidden();
  } finally {
    await releasePass();
  }
}
