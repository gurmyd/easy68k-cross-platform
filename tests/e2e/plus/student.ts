// The long scenario of N9 (ARCHITECTURE-PLUS P5 N9, acceptance): one student's session across the
// packages of the stage. Owner: N9. Run online by history.spec.ts and with the network cut after
// the first load by offline.spec.ts.
//
// A student imports a folder with a PDF, opens the PDF (viewer), opens a source, edits and saves it
// three times, deletes the wrong file, restores it from the Trash, restores the second version from
// Earlier Versions, and the files' bytes equal the expected. Every step asserts what the student
// sees AND the bytes in the store, read back through the application itself (the Files panel's
// Export; the viewer's own blob), so that a failure names the step that broke.

import { expect, test } from '@playwright/test';
import { formatSize } from '../../../app/src/core/history/size';
import { deleteQuestion, deletedToast, restoreFromTrash } from '../../../app/src/features/files/texts';
import { REASON_SHOWN_AS, TRASH_EMPTY, versionsTitle } from '../../../app/src/features/history/texts';
import { EXPORT, PDF_HINT_WEB, pdfFrameTitle, pdfNoticeText, sizeText } from '../../../app/src/features/viewer/texts';
import { TRAILER, crlf, latin1, type App } from '../fixtures';
import {
  blobOf,
  download,
  gridRows,
  importFolder,
  openEarlierVersions,
  openTrash,
  pdfBytes,
  stored,
  toast,
  toastAction,
  viewer,
  watchBlobs,
} from '../fixtures/plus';

/** CR LF for every "\n" of a document's text (ARCHITECTURE.md 3.9.3). */
export const onDisk = (text: string): string => text.replace(/\n/g, '\r\n');

/** The bytes Save writes for an .X68 document whose text is `text` (format.ts encodeFile). */
export const savedBytes = (text: string): string => `${onDisk(text)}\r\n${TRAILER}`;

/**
 * The text the editor shows when it opens the bytes Save wrote for `text`: the original removes
 * the four trailer lines but keeps the empty line Save wrote before them (format.ts stripTrailer,
 * textS.cpp:139-173), so the text gains one "\n".
 */
export const reopenedText = (text: string): string => `${text}\n`;

/** The student's folder. */
export const PROG = crlf('* Lab 3: sum of a table', '    ORG    $1000', 'START:', '    SIMHALT', '    END    START');
export const HELPER = crlf('* helper routines, still needed', 'HELP    RTS');
export const REPORT = pdfBytes('Lab 3 report');

/** The three texts the student saves, one after the other. */
export const EDITS = [1, 2, 3].map(
  (n) =>
    `* Lab 3: sum of a table (attempt ${n})\n    ORG    $1000\nSTART:\n    MOVE.L #${n},D0\n    SIMHALT\n    END    START\n`,
);

/** The bytes of a stored file as text, one character per byte (for readable failure messages). */
async function storedText(app: App, name: string): Promise<string> {
  return latin1(await stored(app, name));
}

/** Waits until the active document is saved (no `Modified` in its status bar, no dot on its tab). */
async function saved(app: App): Promise<void> {
  await expect
    .poll(async () => (await app.status())[1], { message: 'the status bar no longer says Modified' })
    .toBe('');
}

/** The dock's tab of the Editor panel (shown while the Editor's group holds a viewer, P3.1.4). */
export function editorTab(app: App) {
  return app.page.locator('[data-e68-workspace="editor"]').getByRole('tab', { name: 'Editor', exact: true });
}

/** The whole scenario. */
export async function studentScenario(app: App): Promise<void> {
  const page = app.page;

  await test.step('1. the student imports the folder "lab" with a PDF and two sources', async () => {
    await importFolder(app, 'lab', [
      { name: 'prog.X68', data: PROG },
      { name: 'helper.X68', data: HELPER },
      { name: 'report.pdf', data: REPORT },
    ]);
    expect(await storedText(app, 'prog.X68')).toBe(PROG);
    expect(await storedText(app, 'helper.X68')).toBe(HELPER);
    expect(await stored(app, 'report.pdf')).toEqual(REPORT);
  });

  await test.step("2. opening report.pdf shows the viewer, not text, with the file's bytes", async () => {
    await watchBlobs(app);
    await app.treeItem('report.pdf').dblclick();
    const panel = viewer(app, 'report.pdf');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.e68-viewer__size')).toHaveText(sizeText(REPORT.length));
    // A viewer is not a document (P3.4.2): no document tab was opened for it.
    expect(await app.tabNames()).not.toContain('report.pdf');
    // P3.4.2: the frame where the browser shows PDFs; where navigator.pdfViewerEnabled is false (the
    // browser downloads PDFs instead, as Playwright's Chromium headless shell reports), the notice
    // with Export instead of the frame. Either way the file's bytes are what the student gets.
    const shows = await page.evaluate(() => navigator.pdfViewerEnabled !== false);
    if (shows) {
      const frame = panel.locator('iframe');
      await expect(frame).toHaveAttribute('title', pdfFrameTitle('report.pdf'));
      expect(await frame.getAttribute('sandbox'), 'a sandboxed frame blocks the PDF viewer (P3.4.2)').toBeNull();
      const src = (await frame.getAttribute('src')) ?? '';
      expect(src).toMatch(/^blob:/);
      const blob = await blobOf(app, src);
      expect(blob, 'the frame shows a blob the viewer made').not.toBeNull();
      expect(blob!.type).toBe('application/pdf');
      expect(new Uint8Array(blob!.bytes)).toEqual(REPORT);
      await expect(panel.locator('.e68-viewer__hint')).toHaveText(PDF_HINT_WEB);
    } else {
      await expect(panel.locator('iframe')).toHaveCount(0);
      await expect(panel.locator('.e68-viewer__notice-text')).toHaveText(pdfNoticeText('report.pdf'));
    }
    const exported = await download(app, panel.getByRole('button', { name: EXPORT, exact: true }));
    expect(exported.name).toBe('report.pdf');
    expect(exported.bytes).toEqual(REPORT);
  });

  await test.step('3. opening prog.X68 opens it as text in the editor, in front of the viewer', async () => {
    await app.treeItem('prog.X68').dblclick();
    await expect.poll(async () => (await app.tabs()).find((tab) => tab.selected)?.name).toBe('prog.X68');
    await expect.poll(() => app.text()).toBe(PROG.replace(/\r\n/g, '\n'));
    // What the student sees: the source they opened. The viewer is a tab of the Editor's group
    // (P3.4.2); a document opened while the viewer's tab is in front must still be shown (main
    // 3.9: the opened document is the one shown; P1.2: the editor behaves exactly as today). A soft
    // expectation, so that a failure here is reported and the later steps still run: the student
    // then brings the Editor to the front with its tab, as they would.
    const shown = () => app.content().evaluate((element) => element.checkVisibility({ visibilityProperty: true }));
    await expect
      .configure({ soft: true })
      .poll(shown, { message: "the opened document is shown, not hidden behind the viewer's tab" })
      .toBe(true);
    if (!(await shown())) await editorTab(app).click();
    await expect.poll(shown).toBe(true);
  });

  for (const [index, text] of EDITS.entries()) {
    await test.step(`4.${index + 1}. edit and save number ${index + 1}: the file holds exactly the saved text`, async () => {
      await app.replaceText(text);
      await expect.poll(async () => (await app.status())[1]).toBe('Modified');
      await app.press('ed.file.save');
      await saved(app);
      expect(await storedText(app, 'prog.X68')).toBe(savedBytes(text));
    });
  }

  await test.step('5. the student deletes helper.X68 by mistake: asked, then it goes to the Trash', async () => {
    await app.treeItem('helper.X68').click();
    await app.filesPanel.getByRole('button', { name: 'Delete', exact: true }).click();
    const box = app.messageBox;
    await expect(box).toBeVisible();
    await expect(box.locator('.e68-dialog__title')).toHaveText('Delete');
    expect(await app.boxText(box)).toContain(
      `${deleteQuestion([{ name: 'helper.X68', isFolder: false, files: 0 }])} ${restoreFromTrash(true)}`,
    );
    await expect(app.button(box, 'No'), 'No has the focus (P3.2.2)').toBeFocused();
    await app.button(box, 'Yes').click();
    await expect(box).toBeHidden();
    await expect(toast(app, deletedToast(1, 'helper.X68', 0, 0))).toBeVisible();
    await expect(toastAction(app, deletedToast(1, 'helper.X68', 0, 0), 'Undo')).toBeVisible();
    await expect(app.treeItem('helper.X68')).toHaveCount(0);
    // The other files are untouched.
    expect(await storedText(app, 'prog.X68')).toBe(savedBytes(EDITS[2]!));
  });

  await test.step('6. Trash... lists helper.X68 as Deleted; Restore puts it back with its bytes', async () => {
    const trash = await openTrash(app);
    await expect
      .poll(async () => (await gridRows(trash)).map((row) => [row[0], row[2]]))
      .toEqual([['helper.X68', 'Deleted']]);
    await trash.locator('[role=grid] [role=row][data-row="0"]').click();
    await expect(trash.locator('[role=row][data-row="0"]')).toHaveAttribute('aria-selected', 'true');
    await app.button(trash, 'Restore').click();
    await expect(trash.locator('.e68-history__empty')).toHaveText(TRASH_EMPTY);
    await app.button(trash, 'Close').click();
    await expect(trash).toBeHidden();
    await expect(app.treeItem('helper.X68')).toBeVisible();
    expect(await storedText(app, 'helper.X68')).toBe(HELPER);
  });

  await test.step('7. Earlier Versions of prog.X68 lists the three saves and the file as opened', async () => {
    const dialog = await openEarlierVersions(app, 'prog.X68');
    await expect(dialog.locator('.e68-dialog__title')).toHaveText(versionsTitle('prog.X68'));
    // Newest first (P3.3.8): Kept, Size, Kind.
    await expect
      .poll(async () => (await gridRows(dialog)).map((row) => [row[1], row[2]]))
      .toEqual([
        [formatSize(savedBytes(EDITS[2]!).length), REASON_SHOWN_AS.saved],
        [formatSize(savedBytes(EDITS[1]!).length), REASON_SHOWN_AS.saved],
        [formatSize(savedBytes(EDITS[0]!).length), REASON_SHOWN_AS.saved],
        [formatSize(PROG.length), REASON_SHOWN_AS.opened],
      ]);
    await app.button(dialog, 'Close').click();
    await expect(dialog).toBeHidden();
  });

  await test.step('8. Restore of the second save: the file and the open document hold it again', async () => {
    const dialog = await openEarlierVersions(app, 'prog.X68');
    await expect.poll(async () => (await gridRows(dialog)).length).toBe(4);
    // The second save is the second row (newest first: save 3, save 2, save 1, as opened).
    const second = dialog.locator('[role=grid] [role=row][data-row="1"]');
    await second.click();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    // The comparison shows the version on the left and the file now on the right (P3.3.8).
    await expect(dialog.locator('.e68-history__heading--now')).toHaveText('Now');
    await expect(dialog.locator('.e68-history__view')).toContainText('(attempt 2)');
    await app.button(dialog, 'Restore').click();
    // The open, unmodified document is reloaded (P3.3.8): the editor shows the second save's text.
    await expect.poll(() => app.text(), { message: 'the open document was reloaded' }).toBe(reopenedText(EDITS[1]!));
    await app.button(dialog, 'Close').click();
    await expect(dialog).toBeHidden();
    await saved(app);
    expect(await storedText(app, 'prog.X68')).toBe(savedBytes(EDITS[1]!));
  });

  await test.step('9. at the end every file of the folder holds exactly the expected bytes', async () => {
    expect(await storedText(app, 'prog.X68')).toBe(savedBytes(EDITS[1]!));
    expect(await storedText(app, 'helper.X68')).toBe(HELPER);
    expect(await stored(app, 'report.pdf')).toEqual(REPORT);
    // Nothing else appeared in the folder (no history or metadata file, P1.1 rule 2).
    const names = await app.filesPanel
      .locator('[role=treeitem][aria-level="3"] .e68-files__name')
      .evaluateAll((list) => list.map((name) => name.textContent ?? ''));
    expect(names.sort()).toEqual(['helper.X68', 'prog.X68', 'report.pdf']);
  });
}
