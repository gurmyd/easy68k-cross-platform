// Files that are not text (ARCHITECTURE-PLUS P3.4, P3.5): the picture viewer, the notice, Open as
// Text, viewers after a reload, and the `viewer` switch of Port Additions. Owner: N9.
//
// The PDF viewer is part of the long scenario (history.spec.ts, student.ts step 2): the frame with
// a `blob:` of type application/pdf holding the file's bytes where the browser shows PDFs, the
// notice with Export where `navigator.pdfViewerEnabled` is false (P3.4.2).

import { ADDITIONS_TITLE } from '../../../app/src/features/additions/texts';
import { ACTUAL_SIZE, EXPORT, OPEN_AS_TEXT, noticeText, sizeText } from '../../../app/src/features/viewer/texts';
import { expect, test } from '../fixtures';
import { blobOf, download, pdfBytes, pngBytes, viewer, watchBlobs } from '../fixtures/plus';

const PICTURE = pngBytes(40, 30);
/** A file with a zero byte in its first 8,192 bytes and no extension the viewer knows (P3.4.1). */
const DATA = new Uint8Array([0x45, 0x36, 0x38, 0x00, 0x01, 0x02, 0xff, 0x0d, 0x0a]);
const PDF = pdfBytes('not as text');

test('a picture opens in the viewer: the blob holds its bytes, Actual Size toggles, Export gives the file', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.importFiles([{ name: 'diagram.png', data: PICTURE }]);
  await watchBlobs(app);
  await app.treeItem('diagram.png').dblclick();
  const panel = viewer(app, 'diagram.png');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.e68-viewer__size')).toHaveText(sizeText(PICTURE.length));
  expect(await app.tabNames(), 'a viewer is not a document').not.toContain('diagram.png');

  const picture = panel.getByRole('img', { name: 'diagram.png', exact: true });
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([40, 30]);
  const src = (await picture.getAttribute('src')) ?? '';
  expect(src).toMatch(/^blob:/);
  const blob = await blobOf(app, src);
  expect(blob?.type).toBe('image/png');
  expect(new Uint8Array(blob!.bytes)).toEqual(PICTURE);

  const actual = panel.getByRole('button', { name: ACTUAL_SIZE, exact: true });
  await expect(actual).toHaveAttribute('aria-pressed', 'false');
  await actual.click();
  await expect(actual).toHaveAttribute('aria-pressed', 'true');
  // 1:1: the picture is drawn at its own size.
  await expect
    .poll(() =>
      picture.evaluate((img) => [
        Math.round(img.getBoundingClientRect().width),
        Math.round(img.getBoundingClientRect().height),
      ]),
    )
    .toEqual([40, 30]);
  await actual.click();
  await expect(actual).toHaveAttribute('aria-pressed', 'false');

  const exported = await download(app, panel.getByRole('button', { name: EXPORT, exact: true }));
  expect(exported.name).toBe('diagram.png');
  expect(exported.bytes).toEqual(PICTURE);
  // The stored file is unchanged by viewing it.
  expect(await app.exportFile('diagram.png')).toEqual(PICTURE);
});

test('a file that is not text shows the notice; Open as Text opens it as a document and closes the viewer', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.importFiles([{ name: 'data.bin', data: DATA }]);
  await app.treeItem('data.bin').dblclick();
  const panel = viewer(app, 'data.bin');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.e68-viewer__notice-text')).toHaveText(noticeText('data.bin'));
  const exported = await download(app, panel.getByRole('button', { name: EXPORT, exact: true }));
  expect(exported.bytes).toEqual(DATA);

  await panel.getByRole('button', { name: OPEN_AS_TEXT, exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await app.tabs()).find((tab) => tab.selected)?.name).toBe('data.bin');
  expect(await app.exportFile('data.bin'), 'opening as text changes nothing in the file').toEqual(DATA);
});

test('viewers are not part of the stored arrangement: after a reload they are closed, the documents stay', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.importFiles([{ name: 'diagram.png', data: PICTURE }]);
  await app.treeItem('diagram.png').dblclick();
  await expect(viewer(app, 'diagram.png')).toBeVisible();
  await app.open();
  await expect(app.shell).toBeVisible();
  await expect(app.page.locator('[data-e68-panel^="viewer:"]')).toHaveCount(0);
  await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68']);
});

test('with the viewer switched off in Port Additions, a PDF opens as text, as in the original', async ({ app }) => {
  test.setTimeout(180_000);
  await app.importFiles([{ name: 'notes.pdf', data: PDF }]);
  await app.chooseMenu('Options', 'Port Additions...');
  const dialog = app.dialog(ADDITIONS_TITLE);
  await expect(dialog).toBeVisible();
  const box = dialog.getByRole('checkbox', { name: 'Show PDF files and pictures in a viewer instead of as text' });
  await expect(box).toBeChecked();
  await box.uncheck();
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();

  await app.treeItem('notes.pdf').dblclick();
  await expect.poll(async () => (await app.tabs()).find((tab) => tab.selected)?.name).toBe('notes.pdf');
  await expect(app.page.locator('[data-e68-panel^="viewer:"]')).toHaveCount(0);
  await expect.poll(() => app.text()).toContain('%PDF-1.4');
  expect(await app.exportFile('notes.pdf')).toEqual(PDF);
});
