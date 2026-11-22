// Helpers for the end-to-end suites of the stage of additions (ARCHITECTURE-PLUS P5 N9,
// tests/e2e/plus). Owner: N9. Added beside X1's harness; nothing of it changes an existing helper.
//
// Everything here acts through the interface of the production build, as X1's page object does:
// the Files panel's strip and context menu, the menus, the dialogs and toasts the stage adds. Bytes
// are read back the way a student takes them out of the browser: the Files panel's Export (a
// download), or, for a viewer, the blob the viewer's own frame shows (P3.4.2: "Automation checks
// that the iframe exists with a blob: of type application/pdf holding the file's bytes").
//
//   import { importFolder, toast, ... } from '../fixtures/plus';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type { BrowserContext, Locator } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { PASS_LOCK } from '../../../app/src/core/history/limits';
import { bytesOf, escapeRegExp, readDownload, type App, type FileSpec } from './app';

// ---- sample files -------------------------------------------------------------------------------

/** A valid one-page PDF that shows `text` (built as N0's spike built it, docs/requests/N0.md 5.4). */
export function pdfBytes(text: string): Uint8Array {
  const stream = `BT /F1 36 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytesOf(pdf);
}

/** A valid PNG of `width` x `height` pixels, a horizontal ramp of red over blue (RGB, no filter). */
export function pngBytes(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, no filter method, no interlace
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set([Math.round((255 * x) / Math.max(1, width - 1)), 0, 255], row + 1 + x * 3);
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ---- files ------------------------------------------------------------------------------------

/** How many folders importFolder has written in this worker (each import gets a folder of its own). */
let folders = 0;

/**
 * Imports a folder into "My Programs" with the Files panel's Import... > Folder..., as a student
 * chooses a folder of their computer. The folder is written below the test's output folder first
 * (Playwright hands a chosen directory to an `<input webkitdirectory>` with each file's
 * `webkitRelativePath`). `files` are paths relative to the folder ("prog.X68", "docs/report.pdf").
 */
export async function importFolder(app: App, folder: string, files: FileSpec[]): Promise<void> {
  const root = test.info().outputPath(`import-${process.pid}-${++folders}`, folder);
  for (const file of files) {
    const path = join(root, ...file.name.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytesOf(file.data));
  }
  await app.showFiles();
  await app.treeItem('My Programs').click();
  await app.filesPanel.getByRole('button', { name: 'Import...' }).click();
  const [chooser] = await Promise.all([
    app.page.waitForEvent('filechooser', { timeout: 60_000 }),
    app.page.getByRole('menuitem', { name: /^Folder\.\.\./ }).click(),
  ]);
  await chooser.setFiles(root);
  // The import reveals the first file it wrote (FilesPanel.tsx doImport), which opens the folder.
  await expect(app.treeItem(folder)).toBeVisible();
  await expect(app.treeItem(folder)).toHaveAttribute('aria-expanded', 'true');
  for (const file of files) await expect(app.treeItem(file.name.split('/').pop()!)).toBeVisible();
}

/** The bytes of a file of the Files panel, downloaded with its Export button (X1's exportFile). */
export function stored(app: App, name: string): Promise<Uint8Array> {
  return app.exportFile(name);
}

/** Right-clicks a row of the Files tree and chooses an entry of its context menu (plain caption). */
export async function filesContextMenu(app: App, row: string, caption: string): Promise<void> {
  await app.showFiles();
  await app.treeItem(row).click({ button: 'right' });
  const menu = app.openMenuList;
  await menu.waitFor();
  await app.menuItem(menu, caption).click();
}

/** The names of the selected rows of the Files tree, in the tree's order. */
export function selectedRows(app: App): Promise<string[]> {
  return app.filesPanel
    .locator('[role=treeitem][aria-selected=true] .e68-files__name')
    .evaluateAll((names) => names.map((name) => name.textContent ?? ''));
}

/** The Files panel's line below its strip (`5 items selected`, P3.2.1). */
export function selectionLine(app: App): Locator {
  return app.filesPanel.locator('p.e68-files__count[role=status]');
}

// ---- toasts -----------------------------------------------------------------------------------

/** The toast whose text is exactly `text`. */
export function toast(app: App, text: string): Locator {
  return app.page
    .locator('.e68-toast')
    .filter({ has: app.page.locator('.e68-toast__text', { hasText: new RegExp(`^${escapeRegExp(text)}$`) }) });
}

/** The action button of the toast whose text is exactly `text` (`Undo`, `Reload`). */
export function toastAction(app: App, text: string, action: string): Locator {
  return toast(app, text).locator('.e68-toast__action', { hasText: new RegExp(`^${escapeRegExp(action)}$`) });
}

// ---- the history dialogs (P3.3.8) ---------------------------------------------------------------

/** One row of a history dialog's list as drawn: the texts of its cells. */
export async function gridRows(dialog: Locator): Promise<string[][]> {
  return dialog
    .locator('[role=grid] [role=row][data-row]')
    .evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll('[role=gridcell]')).map((cell) => cell.textContent ?? '')),
    );
}

/** Waits until a history dialog has read its list (`data-loaded` on its body, N4). */
export async function historyLoaded(dialog: Locator): Promise<void> {
  await expect(dialog.locator('[data-e68-history][data-loaded=true]')).toHaveCount(1);
}

/** Opens Earlier Versions of a file of the Files panel from its context menu; returns the dialog. */
export async function openEarlierVersions(app: App, name: string): Promise<Locator> {
  await filesContextMenu(app, name, 'Earlier Versions...');
  const dialog = app.dialog(`Earlier Versions of ${name}`);
  await expect(dialog).toBeVisible();
  await historyLoaded(dialog);
  return dialog;
}

/**
 * Takes the history's pass lock (`easy68k.history.pass`, P3.3.4) in a window and holds it until the
 * returned function is called; resolves once the lock is granted. Every window of the profile runs
 * its global pass only when it gets that lock (`ifAvailable`), and skips the pass otherwise; a pass
 * also tells the window's open history dialogs to read their lists again. While the lock is held, a
 * dialog of another window therefore learns of a change ONLY through the message between the windows
 * (BroadcastChannel `easy68k.history`), never from its own timer (the first pass ten seconds after a
 * window starts, then every ten minutes). The same hold as app/src/fs/check-history.mjs makes; a
 * lock is shared state of the profile, nothing of the application is called. If another window's
 * pass holds the lock at the call, the call waits until that pass is over.
 */
export async function holdHistoryPass(app: App): Promise<() => Promise<void>> {
  await app.page.evaluate(
    (name) =>
      new Promise<void>((granted) => {
        const holder = globalThis as unknown as { __n9ReleasePass?: () => void };
        void navigator.locks.request(
          name,
          () =>
            new Promise<void>((release) => {
              holder.__n9ReleasePass = release;
              granted();
            }),
        );
      }),
    PASS_LOCK,
  );
  return async () => {
    await app.page.evaluate(() => (globalThis as unknown as { __n9ReleasePass?: () => void }).__n9ReleasePass?.());
  };
}

/** The names of the Web Locks held in the profile now (`navigator.locks.query()`, published state). */
export async function heldLocks(app: App): Promise<string[]> {
  return app.page.evaluate(async () => ((await navigator.locks.query()).held ?? []).map((lock) => lock.name ?? ''));
}

/** Opens the Trash with the Files panel's strip button `Trash...`; returns the dialog. */
export async function openTrash(app: App): Promise<Locator> {
  await app.showFiles();
  await app.filesPanel.getByRole('button', { name: 'Trash...', exact: true }).click();
  const dialog = app.dialog('Trash');
  await expect(dialog).toBeVisible();
  await historyLoaded(dialog);
  return dialog;
}

// ---- the viewer (P3.4.2) ------------------------------------------------------------------------

/** The viewer panel (transient dock panel `viewer:<n>`) that shows the file `name`. */
export function viewer(app: App, name: string): Locator {
  return app.page
    .locator('[data-e68-panel^="viewer:"]')
    .filter({ has: app.page.locator('.e68-viewer__name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) });
}

/**
 * From now on, the page remembers the Blob behind each `blob:` URL it makes. The production policy's
 * `connect-src` does not allow `blob:`, so the page cannot `fetch` a viewer's URL back (WebKit says
 * "Refused to connect to blob:..."); instead `URL.createObjectURL` is watched, and blobOf reads the
 * very Blob the viewer handed to its frame. Nothing of the application is called or changed.
 */
export async function watchBlobs(app: App): Promise<void> {
  await app.page.evaluate(() => {
    const holder = globalThis as unknown as { __n9Blobs?: Map<string, Blob> };
    if (holder.__n9Blobs) return;
    const blobs = new Map<string, Blob>();
    holder.__n9Blobs = blobs;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = create(object);
      if (object instanceof Blob) blobs.set(url, object);
      return url;
    };
  });
}

/** The type and bytes of a `blob:` URL the page made after watchBlobs; null when it was not seen. */
export function blobOf(app: App, url: string): Promise<{ type: string; bytes: number[] } | null> {
  return app.page.evaluate(async (u) => {
    const blob = (globalThis as unknown as { __n9Blobs?: Map<string, Blob> }).__n9Blobs?.get(u);
    if (!blob) return null;
    return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  }, url);
}

/** Clicks a button that starts a download and returns the downloaded bytes. */
export async function download(app: App, button: Locator): Promise<{ name: string; bytes: Uint8Array }> {
  const [file] = await Promise.all([app.page.waitForEvent('download', { timeout: 60_000 }), button.click()]);
  return { name: file.suggestedFilename(), bytes: await readDownload(file) };
}

// ---- the dock (P3.1) -------------------------------------------------------------------------------

/** The box of a panel's region (`data-e68-panel`) of the shown workspace, rounded to whole pixels. */
export async function regionBox(
  app: App,
  panel: string,
): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
  return app.page.evaluate((id) => {
    const element = document.querySelector(`[data-e68-workspace]:not([hidden]) [data-e68-panel="${id}"]`);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    return {
      left: Math.round(box.left),
      top: Math.round(box.top),
      right: Math.round(box.right),
      bottom: Math.round(box.bottom),
    };
  }, panel);
}

/**
 * Moves a panel with `Move Panel To...` (P3.1.4): the menu item (`menu` is the menu that holds it:
 * `Window` in Editor mode, `View` in Simulator mode), then the dialog `Move Panel`.
 */
export async function movePanel(
  app: App,
  menu: 'Window' | 'View',
  panel: string,
  place: { edge: 'Left' | 'Right' | 'Top' | 'Bottom' } | { beside: string; side: 'Left' | 'Right' | 'Above' | 'Below' },
): Promise<void> {
  await app.chooseMenu(menu, 'Move Panel To...');
  const dialog = app.dialog('Move Panel');
  await expect(dialog).toBeVisible();
  const list = (name: string) => dialog.getByRole('combobox', { name, exact: true });
  await list('Panel:').selectOption({ label: panel });
  if ('edge' in place) {
    await dialog.getByRole('radio', { name: 'At the edge of the window:', exact: true }).check();
    await list('Edge').selectOption({ label: place.edge });
  } else {
    await dialog.getByRole('radio', { name: 'Beside', exact: true }).check();
    await list('Beside panel').selectOption({ label: place.beside });
    await list('Side').selectOption({ label: place.side });
  }
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();
}

/** The text of the dock's polite live region of a mode (P3.1.8). */
export function dockAnnouncement(app: App, mode: 'editor' | 'simulator'): Promise<string> {
  return app.page.evaluate((m) => document.querySelector(`[data-e68-dock-live="${m}"]`)?.textContent ?? '', mode);
}

/** Switches the mode with the mode switch, as a student does, and waits for it. */
export async function switchMode(app: App, mode: 'Editor' | 'Simulator'): Promise<void> {
  await app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: mode }).click();
  await expect.poll(() => app.mode()).toBe(mode.toLowerCase());
}

// ---- offline (main 6.6, P5 N9 "offline after the first load") -------------------------------------

/**
 * Waits for the service worker to be active, cuts the network and reloads: the application must
 * come back from the worker's cache. The same steps as X1's offline suite (tests/e2e/app/offline.spec.ts);
 * the context must allow service workers (`test.use({ serviceWorkers: 'allow' })`).
 */
export async function reloadOffline(app: App, context: BrowserContext): Promise<void> {
  const page = app.page;
  expect(await page.evaluate(() => 'serviceWorker' in navigator)).toBe(true);
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null), {
      timeout: 120_000,
      message: 'the service worker is activated (it precaches the whole site first)',
    })
    .toBe('activated');
  await context.setOffline(true);
  await page.reload();
  await app.ready();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'the worker controls the page').toBe(
    true,
  );
  expect(await page.evaluate(() => navigator.onLine), 'the page sees no network').toBe(false);
}
