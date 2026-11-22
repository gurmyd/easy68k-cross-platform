// The Safari storage notice of the Files panel (ARCHITECTURE.md 10.1 risk R-10; errata FS1.md entry
// 28). Owner: X1. Under automation the notice is hidden unless the address carries
// storage-notice=1, which shows it as for a person; FS1's check-files.mjs covers the installed-app
// variant, the Tab order and both themes.

import { expect, test } from '../fixtures';
import { readZip } from '../../../app/src/fs/zip';
import {
  STORAGE_NOTICE_LABEL,
  STORAGE_NOTICE_TAB_TEXT,
  STORAGE_NOTICE_PARAM,
} from '../../../app/src/features/files/storage-notice';

const QUERY = `?${STORAGE_NOTICE_PARAM}=1`;

test('without storage-notice=1 an automated browser sees no storage notice', async ({ app }) => {
  await app.showFiles();
  await expect(app.treeItem('My Programs')).toBeVisible();
  await expect(app.filesPanel.getByRole('note')).toHaveCount(0);
});

test("in Safari's engine the notice is there at the first start; Export... downloads the store, Got it hides it for good", async ({
  app,
  browserName,
}) => {
  await app.open(QUERY);
  await app.showFiles();
  const notice = app.filesPanel.getByRole('note', { name: STORAGE_NOTICE_LABEL });
  if (browserName !== 'webkit') {
    // Only WebKit deletes a site's storage after seven days; the parameter does not change that.
    await expect(app.treeItem('My Programs')).toBeVisible();
    await expect(app.filesPanel.getByRole('note')).toHaveCount(0);
    return;
  }
  await expect(notice).toBeVisible();
  await expect(notice.locator('p')).toHaveText(STORAGE_NOTICE_TAB_TEXT);

  await app.importFiles([{ name: 'kept.X68', data: '* kept\r\n' }]);
  const [download] = await Promise.all([
    app.page.waitForEvent('download', { timeout: 60_000 }),
    notice.getByRole('button', { name: 'Export...' }).click(),
  ]);
  expect(['My Programs.zip', 'My_Programs.zip']).toContain(download.suggestedFilename());
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const zip = await readZip(new Uint8Array(await readFile(path)));
  const entries = zip.entries.filter((entry) => !entry.path.endsWith('/'));
  expect(entries.map((entry) => entry.path)).toEqual(['kept.X68']);
  expect(Buffer.from(entries[0]!.data).toString('latin1')).toBe('* kept\r\n');
  await expect(notice).toBeVisible();

  await notice.getByRole('button', { name: 'Got it' }).click();
  await expect(app.filesPanel.getByRole('note')).toHaveCount(0);
  await app.open(QUERY);
  await app.showFiles();
  await expect(app.treeItem('My Programs')).toBeVisible();
  await expect(app.filesPanel.getByRole('note')).toHaveCount(0);
});
