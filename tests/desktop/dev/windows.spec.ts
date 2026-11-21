// Windows, files from outside and full screen (6.7, 3.8.6, 5.7, 2.5): `New Window` gives a second
// window with its own simulator; an open-file event reaches the page and opens the document; a
// file on the command line becomes the start-up file; window-level full screen (macOS).
//
// Owner: DV2.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { vpathOfRealPath } from '../../../desktop/src/security';
import {
  enginesAvailable,
  IS_MAC,
  launchDesktop,
  mainHook,
  removeQuietly,
  startDevServer,
  warmUpDevPage,
  type DevServer,
} from './harness';

let server: DevServer;
const scratch = mkdtempSync(join(tmpdir(), 'easy68k-windows-'));

test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startDevServer();
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await server?.close();
  removeQuietly(scratch);
});

test('New Window gives a second window with its own simulator', async () => {
  const desktop = await launchDesktop({ devServer: server });
  try {
    await warmUpDevPage(desktop.page);
    const windowPromise = desktop.app.waitForEvent('window', { timeout: 120_000 });
    await desktop.page.evaluate(() => window.__easy68k.ctx.commands.run('app.window.new'));
    const second = await windowPromise;
    await warmUpDevPage(second);
    const ids = await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id));
    expect(ids).toHaveLength(2);
    expect(await mainHook<number[]>(desktop.app, 'windowIds')).toHaveLength(2);

    const describe = (page: typeof second) =>
      page.evaluate(() => {
        const { ctx } = window.__easy68k;
        return { windowId: ctx.platform.windowId, kind: ctx.platform.kind, mode: ctx.store.getState().mode };
      });
    const first = await describe(desktop.page);
    const other = await describe(second);
    expect(first.kind).toBe('desktop');
    expect(other.kind).toBe('desktop');
    expect(other.windowId).not.toBe(first.windowId);

    // Each window is its own instance: a change of mode in one leaves the other alone ...
    await desktop.page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'simulator'));
    await expect.poll(() => describe(desktop.page).then((d) => d.mode)).toBe('simulator');
    expect((await describe(second)).mode).toBe(first.mode);

    // ... and each has its own simulator engine (a WebAssembly instance in its own renderer). The
    // host is a plain {}: every method it lacks falls back to the engine's default (S5). With the
    // engines present, a window whose engine fails to load fails the test.
    const engine = async (page: typeof second) =>
      page.evaluate(async () => {
        const binding = await import(String('/src/engine/index.ts'));
        const loader = await import(String('/src/engine/loader.ts'));
        try {
          const sim = await binding.createSimEngine({});
          sim.writeBytes(0x2000, [0x12, 0x34]);
          const value = sim.readWord(0x2000);
          const info = loader.engineLoadInfo('sim');
          binding.releaseSimEngine(sim);
          return { value, compilations: info.compilations as number, error: null };
        } catch (error) {
          return { value: null, compilations: null, error: String(error) };
        }
      });
    if (enginesAvailable()) {
      // One compilation per window, not one shared by both.
      expect(await engine(desktop.page)).toEqual({ value: 0x1234, compilations: 1, error: null });
      expect(await engine(second)).toEqual({ value: 0x1234, compilations: 1, error: null });
    } else {
      test
        .info()
        .annotations.push({ type: 'note', description: 'engine/dist is missing: per-window engines not checked' });
    }

    // Each window has its own native menu.
    const menus = await Promise.all(ids.map((id) => mainHook<unknown[] | null>(desktop.app, 'menuDescription', id)));
    expect(menus.every((menu) => Array.isArray(menu) && menu.length > 0)).toBe(true);
    expect(desktop.errors).toEqual([]);
  } finally {
    await desktop.close();
  }
});

test('an open-file event reaches the page as a /disk path, grants its folder and opens the document', async () => {
  const folder = join(scratch, 'opened');
  mkdirSync(folder);
  const file = join(folder, 'tutorial1.X68');
  writeFileSync(file, '\tORG\t$1000\r\n\tEND\t$1000\r\n');
  const desktop = await launchDesktop({ devServer: server });
  try {
    await warmUpDevPage(desktop.page);
    await desktop.page.evaluate(() => {
      const seen: string[][] = [];
      (window as unknown as { __opened: string[][] }).__opened = seen;
      window.__easy68k.ctx.platform.onOpenFiles((files: string[]) => seen.push(files));
    });
    // What macOS does for a file association or a drop on the Dock icon.
    await desktop.app.evaluate(({ app }, path) => {
      app.emit('open-file', { preventDefault() {} }, path);
    }, file);
    const vpath = vpathOfRealPath(file) as string;
    await expect
      .poll(() => desktop.page.evaluate(() => (window as unknown as { __opened: string[][] }).__opened))
      .toEqual([[vpath]]);
    const stat = await desktop.page.evaluate((path) => window.__easy68k.ctx.platform.syncFiles.stat(path), vpath);
    expect(stat).toEqual({ size: 24, readOnly: false });
    // The application opens the document (Editor mode for .X68, 5.7).
    await expect
      .poll(
        () =>
          desktop.page.evaluate(() =>
            window.__easy68k.ctx.documents.list().map((doc: { path: string | null }) => doc.path),
          ),
        { timeout: 20_000, message: 'a document for the opened file (Platform.onOpenFiles has no subscriber yet?)' },
      )
      .toContain(vpath);
  } finally {
    await desktop.close();
  }
});

test('a file on the command line is the start-up file, with the switches after it', async () => {
  const file = join(scratch, 'start.S68');
  writeFileSync(file, 'S00600004844521B\r\n');
  const desktop = await launchDesktop({ devServer: server, args: [file, '/r', '/b'] });
  try {
    await warmUpDevPage(desktop.page);
    const args = await desktop.page.evaluate(() => window.__easy68k.ctx.platform.startupArgs());
    expect(args).toEqual({
      file: vpathOfRealPath(file),
      run: true,
      fullScreen: false,
      exceptions: false,
      bitField: true,
    });
  } finally {
    await desktop.close();
  }
});

test('window-level full screen for the Output panel', async () => {
  test.skip(
    !IS_MAC,
    'macOS only: window-level full screen moves the window into its own Space there; on this OS it would cover the screen of whoever uses the machine',
  );
  const desktop = await launchDesktop({ devServer: server, windows: 'inactive' });
  try {
    await warmUpDevPage(desktop.page);
    const on = await desktop.page.evaluate(() => window.__easy68k.ctx.platform.setFullScreen(true));
    expect(on).toBe(true);
    expect(await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen())).toBe(
      true,
    );
    const off = await desktop.page.evaluate(() => window.__easy68k.ctx.platform.setFullScreen(false));
    expect(off).toBe(true);
    expect(await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen())).toBe(
      false,
    );
  } finally {
    await desktop.close();
  }
});
