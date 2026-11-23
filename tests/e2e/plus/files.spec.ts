// The Files panel of the stage: several rows selected, Export and Delete of the selection, Undo
// (ARCHITECTURE-PLUS P3.2.1, P3.2.2, P3.2.3, P3.2.7). Owner: N9.
//
// Bytes are read back as a student takes them out: the Export of the selection (one .zip) and of
// each file.

import { readZip } from '../../../app/src/fs/zip';
import {
  EXPORT_ZIP_NAME,
  deleteQuestion,
  deletedToast,
  exportFileCaption,
  exportSeveralCaption,
  restoreFromTrash,
  selectedCount,
} from '../../../app/src/features/files/texts';
import { crlf, expect, latin1, test, type App } from '../fixtures';
import { download, selectedRows, selectionLine, toast, toastAction } from '../fixtures/plus';

const FILES = [
  { name: 'a.X68', data: crlf('* a', 'A    RTS') },
  { name: 'b.X68', data: crlf('* b', 'B    RTS') },
  { name: 'c.X68', data: crlf('* c', 'C    RTS') },
];

/** Ctrl+click (Cmd+click on the Mac's key map) adds or removes a row (P3.2.1). */
const toggleModifier = (app: App): 'Meta' | 'Control' => (app.keys === 'mac' ? 'Meta' : 'Control');

test('Ctrl+click and Shift+click select several rows; Export of the selection is one .zip with exactly their bytes', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.importFiles(FILES);
  await app.treeItem('a.X68').click();
  await app.treeItem('c.X68').click({ modifiers: [toggleModifier(app)] });
  await expect.poll(() => selectedRows(app)).toEqual(['a.X68', 'c.X68']);
  await expect(selectionLine(app)).toHaveText(selectedCount(2));
  await expect(app.filesPanel.locator('[role=tree]')).toHaveAttribute('aria-multiselectable', 'true');

  const exported = await download(
    app,
    app.filesPanel.getByRole('button', { name: exportSeveralCaption(2), exact: true }),
  );
  // Playwright's WebKit build for Linux reports the spaces of a download's name as underscores
  // (the first run of the stage on GitHub: "EASy68K_export.zip"; main's storage-notice.spec.ts and
  // check-files.mjs know the same of "My Programs.zip"). Every other browser and system reports the name.
  const linuxWebKit = process.platform === 'linux' && test.info().project.name === 'webkit';
  expect(exported.name).toBe(linuxWebKit ? EXPORT_ZIP_NAME.replaceAll(' ', '_') : EXPORT_ZIP_NAME);
  const zip = await readZip(exported.bytes);
  expect(
    zip.entries.filter((entry) => !entry.path.endsWith('/')).map((entry) => [entry.path, latin1(entry.data)]),
  ).toEqual([
    ['a.X68', FILES[0]!.data],
    ['c.X68', FILES[2]!.data],
  ]);

  // Shift+click selects the range from the anchor, the row clicked last without Shift (the Ctrl+click
  // made c.X68 the anchor; a plain click on a.X68 selects it alone and makes it the anchor).
  await app.treeItem('a.X68').click();
  await expect.poll(() => selectedRows(app)).toEqual(['a.X68']);
  await app.treeItem('c.X68').click({ modifiers: ['Shift'] });
  await expect.poll(() => selectedRows(app)).toEqual(['a.X68', 'b.X68', 'c.X68']);
  await expect(selectionLine(app)).toHaveText(selectedCount(3));
  // A plain click selects one row again; the line goes.
  await app.treeItem('b.X68').click();
  await expect.poll(() => selectedRows(app)).toEqual(['b.X68']);
  await expect(selectionLine(app)).toHaveText('');
  await expect(app.filesPanel.getByRole('button', { name: exportFileCaption('b.X68'), exact: true })).toBeVisible();
});

test("Delete of two selected files asks once, moves both to the Trash; the toast's Undo brings both back with their bytes", async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.importFiles(FILES);
  await app.treeItem('a.X68').click();
  await app.treeItem('b.X68').click({ modifiers: [toggleModifier(app)] });
  await expect.poll(() => selectedRows(app)).toEqual(['a.X68', 'b.X68']);

  await app.filesPanel.getByRole('button', { name: 'Delete', exact: true }).click();
  const box = app.messageBox;
  await expect(box).toBeVisible();
  expect(await app.boxText(box)).toContain(
    `${deleteQuestion([
      { name: 'a.X68', isFolder: false, files: 0 },
      { name: 'b.X68', isFolder: false, files: 0 },
    ])} ${restoreFromTrash(false)}`,
  );
  await expect(app.button(box, 'No')).toBeFocused();
  await app.button(box, 'Yes').click();
  await expect(box).toBeHidden();
  await expect(app.treeItem('a.X68')).toHaveCount(0);
  await expect(app.treeItem('b.X68')).toHaveCount(0);
  await expect(app.treeItem('c.X68')).toBeVisible();

  const done = deletedToast(2, null, 0, 0);
  await expect(toast(app, done)).toBeVisible();
  await toastAction(app, done, 'Undo').click();
  await expect(app.treeItem('a.X68')).toBeVisible();
  await expect(app.treeItem('b.X68')).toBeVisible();
  for (const file of FILES) expect(latin1(await app.exportFile(file.name)), file.name).toBe(file.data);
});
