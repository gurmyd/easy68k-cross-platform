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

// ---- floating panels and arrangements (version 1.1, ARCHITECTURE-PLUS P9; M3) ----------------------
//
// What a student sees of a floating window (P9.2): a region named `<panel name>, floating` with a
// title bar (a button named by the panel's title, which opens the window's menu), the buttons `Dock`
// and `x`, the panel below it, and its edges and corners to size it with the pointer. Boxes are read
// from the screen (getBoundingClientRect, rounded to whole pixels).

/** A box on the screen, in whole CSS pixels of the page. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The floating window of the panel titled `title` (P9.2: the region `<panel name>, floating`). */
export function floatingWindow(app: App, title: string): Locator {
  return app.page
    .locator('[data-e68-workspace]:not([hidden])')
    .getByRole('region', { name: `${title}, floating`, exact: true });
}

/** The title bar of a floating window: one Tab stop, a button named by the panel's title. */
export function floatingTitle(app: App, title: string): Locator {
  return floatingWindow(app, title).getByRole('button', { name: title, exact: true });
}

/** The names of the floating windows of the shown mode, in the reading order of the page. */
export function floatingWindows(app: App): Promise<string[]> {
  return app.page
    .locator('[data-e68-workspace]:not([hidden]) [role=region][aria-label$=", floating"]')
    .evaluateAll((regions) =>
      regions
        .filter((region) => (region as HTMLElement).checkVisibility())
        .map((region) => (region.getAttribute('aria-label') ?? '').replace(/, floating$/, '')),
    );
}

/** The box of an element as drawn, or null when it is not drawn. */
export async function screenBox(locator: Locator): Promise<ScreenBox | null> {
  if ((await locator.count()) === 0) return null;
  const box = await locator.first().evaluate((element) => {
    if (!(element as HTMLElement).checkVisibility()) return null;
    const rect = element.getBoundingClientRect();
    return rect.width === 0 || rect.height === 0
      ? null
      : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  return (
    box && { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
  );
}

/** The box of the shown mode's dock: the workspace between the toolbar and the status bar. */
export async function dockBox(app: App): Promise<ScreenBox> {
  const box = await screenBox(app.page.locator('[data-e68-workspace]:not([hidden]) [data-e68-dock]'));
  expect(box, 'the dock of the shown mode is drawn').not.toBeNull();
  return box!;
}

/**
 * Drags with the primary button from `from` by `dx`, `dy`, as a hand on a mouse or a trackpad does:
 * pressed, moved in steps, released.
 */
export async function dragBy(app: App, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  const mouse = app.page.mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await mouse.up();
}

/** A point of a floating window's title bar, on its name (not on Dock or x). */
export async function titlePoint(app: App, title: string): Promise<{ x: number; y: number }> {
  const box = await screenBox(floatingTitle(app, title));
  expect(box, `the title bar of ${title} is drawn`).not.toBeNull();
  return { x: box!.x + Math.min(20, box!.width / 2), y: box!.y + box!.height / 2 };
}

/** The tab of a panel in the dock of the shown mode (a group that shows its strip). */
export function panelTab(app: App, title: string): Locator {
  return app.page.locator('[data-e68-workspace]:not([hidden])').getByRole('tab', { name: title, exact: true });
}

/**
 * Chooses `caption` in the open menu with the keyboard (Down until it has the focus, then Enter), as
 * a student without a mouse does. Returns the captions of the menu's items, in order.
 */
async function chooseInOpenMenu(app: App, caption: string): Promise<string[]> {
  const menu = app.openMenuList;
  await menu.waitFor();
  const items = await menu
    .locator('[role^=menuitem]')
    .evaluateAll((elements) => elements.map((element) => (element.textContent ?? '').trim()));
  expect(items, `the menu has ${caption}`).toContain(caption);
  for (let i = 0; i < items.length; i++) {
    const focused = await app.page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
    if (focused === caption) break;
    await app.page.keyboard.press('ArrowDown');
  }
  await expect.poll(() => app.page.evaluate(() => (document.activeElement?.textContent ?? '').trim())).toBe(caption);
  await app.page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  return items;
}

/**
 * The tab menu of a panel (P3.1.4, P9.2): opened with a right click on its tab (`mouse`) or with
 * Shift+F10 on the focused tab (`keyboard`); `caption` is chosen with the keyboard. Returns the
 * menu's captions.
 */
export async function tabMenu(
  app: App,
  title: string,
  caption: string,
  how: 'mouse' | 'keyboard' = 'mouse',
): Promise<string[]> {
  const tab = panelTab(app, title);
  await expect(tab, `the tab of ${title} is shown`).toBeVisible();
  if (how === 'mouse') await tab.click({ button: 'right' });
  else {
    await tab.focus();
    await app.page.keyboard.press('Shift+F10');
  }
  return chooseInOpenMenu(app, caption);
}

/**
 * The menu of a floating window's title bar (P9.2): the title bar focused (a Tab stop), Shift+F10,
 * then `caption` chosen with the keyboard. Returns the menu's captions.
 */
export async function windowMenu(app: App, title: string, caption: string): Promise<string[]> {
  await floatingTitle(app, title).focus();
  await expect(floatingTitle(app, title)).toBeFocused();
  await app.page.keyboard.press('Shift+F10');
  return chooseInOpenMenu(app, caption);
}

/** Chooses an entry of the Simulator's `View > Layouts` (P9.4) with the mouse. */
export async function chooseLayout(app: App, caption: string): Promise<void> {
  const menu = await app.openMenu('View');
  await app.menuItem(menu, 'Layouts').click();
  const submenu = app.openMenuList;
  await expect(app.menuItem(submenu, caption)).toBeVisible();
  await app.menuItem(submenu, caption).click();
  await expect(app.page.locator('[role=menu][data-e68-menu]')).toHaveCount(0);
}

/** The captions of the entries of `View > Layouts`, as drawn (the menus are closed again). */
export async function layoutEntries(app: App): Promise<string[]> {
  const menu = await app.openMenu('View');
  await app.menuItem(menu, 'Layouts').click();
  const submenu = app.openMenuList;
  await expect(submenu).not.toHaveAttribute('aria-label', 'View');
  const entries = (await app.entriesOf(submenu)).map((entry) => entry.caption);
  await app.page.keyboard.press('Escape');
  await app.page.keyboard.press('Escape');
  await expect(app.page.locator('[role=menu][data-e68-menu]')).toHaveCount(0);
  return entries;
}

/**
 * The address's query that lets a browser driven by a test see the tip of P9.3 as a person sees it
 * (`?arrange-tip=1`, ARRANGE_TIP_PARAM of features/layout/texts.ts). Without it a driven browser
 * never shows the tip (errata M2), so that the suites of 1.0.0 see the window they always saw.
 */
export const ARRANGE_TIP_QUERY = '?arrange-tip=1';

/**
 * Opens the application (again) as a person's browser that may show the tip of P9.3. The profile is
 * the test's fresh one, which has not answered the tip. Every later reload of a tip test must use
 * this too, or the tip would be absent for the driven browser alone and prove nothing.
 */
export async function openWithTip(app: App, query = ''): Promise<void> {
  await reopen(app, query ? `${ARRANGE_TIP_QUERY}&${query.replace(/^\?/, '')}` : ARRANGE_TIP_QUERY);
}

/**
 * The three files the simulator engine is made of (app/src/engine/loader.ts): its interface module,
 * its Emscripten loader and its WebAssembly, by the names of a production build
 * (`assets/sim68k-<hash>.mjs`, `assets/sim68k-loader-<hash>.mjs`, `assets/sim68k-<hash>.wasm`) or
 * of the development server (`engine/sim/sim68k.mjs`, `engine/dist/sim68k-loader.mjs`, ...).
 */
const SIM_ENGINE_FILES = [/\/sim68k(?!-loader)[^/]*\.mjs$/, /\/sim68k-loader[^/]*\.mjs$/, /\/sim68k[^/]*\.wasm$/];

/**
 * Waits until the page holds the simulator engine's files: the browser's own record of what the
 * page fetched (Resource Timing) names each of SIM_ENGINE_FILES with its response complete. In
 * Simulator mode it also waits for the application's own signal that the engine was created: the
 * status bar's run state is no longer `Loading` (the phase of the start, controller.ts `start`).
 * Editor mode draws no such state (the status bar of the run feature is the Simulator's), hence the
 * files.
 */
export async function simEngineLoaded(app: App): Promise<void> {
  await expect
    .poll(
      () =>
        app.page.evaluate(
          (sources) => {
            const done = performance
              .getEntriesByType('resource')
              .filter((entry) => (entry as PerformanceResourceTiming).responseEnd > 0)
              .map((entry) => entry.name.split(/[?#]/)[0] ?? '');
            return sources.filter((source) => !done.some((name) => new RegExp(source).test(name)));
          },
          SIM_ENGINE_FILES.map((pattern) => pattern.source),
        ),
      { timeout: 60_000, message: "the simulator engine's files are fetched (none is missing)" },
    )
    .toEqual([]);
  if ((await app.mode()) === 'simulator') {
    await expect(app.page.locator('[data-e68-status="run"]'), 'the simulator has started').not.toHaveText('Loading', {
      timeout: 60_000,
    });
  }
}

/**
 * Reloads the application (with `query`) once the simulator engine of the page is loaded. A reload
 * made right after the start interrupts the simulator engine's module while it is still being
 * fetched, and WebKit logs that as the page's console error ("The simulator engine could not be
 * created: ... Importing a module script failed", seen once in 65 runs). A person does not reload
 * within that moment; the test waits for that state (simEngineLoaded), not for a time.
 */
export async function reopen(app: App, query = ''): Promise<void> {
  await simEngineLoaded(app);
  await app.open(query);
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
