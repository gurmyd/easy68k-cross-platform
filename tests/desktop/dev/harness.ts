// Starting and stopping the desktop app for the tests of 6.7.
//
// launchDesktop() starts Electron on desktop/ (the compiled main process) with Playwright's
// Electron support, a fresh user-data folder, and EASY68K_DESKTOP_TEST_WINDOWS so that no window
// appears on the screen or takes the focus (`hidden`), or appears only far off-screen without
// the focus (`inactive`). The page comes from app:// (the production build global-setup.ts
// found) or, with `devServer`, from a Vite development server of app/, where the page exposes
// `window.__easy68k` and the page's own modules can be imported by path.
//
// Every Electron process is closed by its process id when the test is done.
//
// Owner: DV2.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

declare global {
  interface Window {
    // The running application of a development page (app/src/main.tsx). Its type belongs to app/;
    // the tests reach into it only through page.evaluate(). (window.easy68kDesktop is declared by
    // app/src/platform/desktop.ts.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __easy68k?: any;
  }
}

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DESKTOP_DIR = join(REPO, 'desktop');
export const IS_MAC = process.platform === 'darwin';
export const MAC_ONLY = 'only macOS shows this (see tests/desktop/dev/README.md)';

/** The Electron binary of node_modules/electron. */
export function electronPath(): string {
  const require = createRequire(join(REPO, 'desktop', 'package.json'));
  return require('electron') as unknown as string;
}

/** True when engine/dist has both engines; with EASY68K_REQUIRE_ENGINES=1 a missing one is an error. */
export function enginesAvailable(): boolean {
  const dist = join(REPO, 'engine', 'dist');
  const present = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
    existsSync(join(dist, file)),
  );
  if (!present && process.env.EASY68K_REQUIRE_ENGINES === '1') {
    throw new Error('engine/dist is missing, and EASY68K_REQUIRE_ENGINES=1 requires the engines');
  }
  return present;
}

export interface DevServer {
  url: string;
  close(): Promise<void>;
}

/** A Vite development server of app/ on a free port. */
export async function startDevServer(): Promise<DevServer> {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: join(REPO, 'app', 'vite.config.ts'),
    root: join(REPO, 'app'),
    logLevel: 'warn',
    // No file watching: other work in the same tree must not reload the page under a test.
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    await server.close();
    throw new Error('the Vite dev server reported no address');
  }
  return { url, close: () => server.close() };
}

export interface LaunchOptions {
  /** Load the page from this dev server instead of app://. */
  devServer?: DevServer;
  windows?: 'hidden' | 'inactive';
  /** More arguments after the app folder (a file, switches). */
  args?: string[];
  env?: Record<string, string>;
}

export interface Desktop {
  app: ElectronApplication;
  page: Page;
  userData: string;
  /** Console errors and page errors of every window. */
  errors: string[];
  close(): Promise<void>;
}

/** Starts the desktop app and waits for its first window. */
export async function launchDesktop(options: LaunchOptions = {}): Promise<Desktop> {
  const userData = mkdtempSync(join(tmpdir(), 'easy68k-desktop-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.EASY68K_DEV_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    EASY68K_DESKTOP_TEST_WINDOWS: options.windows ?? 'hidden',
    EASY68K_APP_DIST: process.env.EASY68K_APP_DIST ?? join(REPO, 'app', 'dist'),
    ...(options.devServer ? { EASY68K_DEV_SERVER_URL: options.devServer.url } : {}),
    ...options.env,
  });
  const app = await electron.launch({
    executablePath: electronPath(),
    args: [DESKTOP_DIR, `--user-data-dir=${userData}`, ...(options.args ?? [])],
    env,
    cwd: REPO,
    timeout: 120_000,
  });
  const pid = app.process().pid;
  const errors: string[] = [];
  const watch = (page: Page) => {
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  };
  app.on('window', watch);
  let page: Page;
  try {
    page = await app.firstWindow({ timeout: 120_000 });
    watch(page);
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 });
  } catch (error) {
    await stop(app, pid);
    removeQuietly(userData);
    throw error;
  }
  return {
    app,
    page,
    userData,
    errors,
    async close() {
      await stop(app, pid);
      removeQuietly(userData);
    },
  };
}

/**
 * Removes a temporary folder. On Windows the helper processes of Chromium may hold files of the
 * user-data folder for a moment after the main process has ended; a folder that cannot be removed
 * is left to the system's temporary-file cleanup.
 */
export function removeQuietly(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // left behind in the temporary folder
  }
}

/** Closes the app, and ends its main process by id if it does not go. */
async function stop(app: ElectronApplication, pid: number | undefined): Promise<void> {
  await Promise.race([app.close().catch(() => {}), new Promise((done) => setTimeout(done, 15_000))]);
  if (pid !== undefined) {
    try {
      process.kill(pid, 0);
      process.kill(pid);
    } catch {
      // already gone
    }
  }
}

/**
 * Waits until the development page has started the application (`window.__easy68k`) and has
 * stopped reloading: Vite reloads the page once when it has optimised a dependency it found late.
 * Settled = the same document still holds the application three seconds later.
 */
export async function waitForApplication(page: Page): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      await page.waitForFunction(() => window.__easy68k !== undefined, null, {
        timeout: Math.max(1000, deadline - Date.now()),
      });
      const marker = Math.random().toString(36).slice(2);
      await page.evaluate((m) => {
        (window as unknown as Record<string, unknown>)['__e68Settled'] = m;
      }, marker);
      await page.waitForTimeout(3000);
      const still = await page.evaluate(
        (m) => (window as unknown as Record<string, unknown>)['__e68Settled'] === m && window.__easy68k !== undefined,
        marker,
      );
      if (still) return;
    } catch (error) {
      // "Execution context was destroyed": the page reloaded meanwhile; wait for the new one.
      if (Date.now() > deadline) throw error;
    }
    if (Date.now() > deadline) throw new Error('the development page did not settle within 180 s');
  }
}

/** The page modules the tests import by path (disk, menu and windows specs). */
const TEST_MODULES = [
  '/src/fs/backend-contract.ts',
  '/src/fs/disk-backend.ts',
  '/src/commands/native-menu.ts',
  '/src/state/panels.ts',
  '/src/engine/index.ts',
  '/src/engine/loader.ts',
];

/**
 * Imports every page module the tests use and waits until the page has settled again: a module
 * that brings a dependency Vite has not optimised yet makes Vite reload the page, which must
 * happen before the tests, not in the middle of one.
 */
export async function warmUpDevPage(page: Page): Promise<void> {
  await waitForApplication(page);
  await page
    .evaluate(async (modules) => {
      for (const path of modules) await import(path);
      // Every mode once: a mode's panels load code of their own.
      const { commands } = window.__easy68k.ctx;
      for (const mode of ['simulator', 'easybin', 'editor']) {
        await commands.run('app.mode.set', mode);
        await new Promise((done) => setTimeout(done, 500));
      }
    }, TEST_MODULES)
    .catch(() => {
      // a reload during the imports: waited for below
    });
  await page.waitForTimeout(2000);
  await waitForApplication(page);
}

/** Calls a function of the main process's test hooks (desktop/src/main.ts installTestHooks). */
export function mainHook<T>(app: ElectronApplication, name: string, ...args: unknown[]): Promise<T> {
  return app.evaluate(
    (_electron, [hook, list]) => {
      const hooks = (globalThis as Record<string, unknown>)['__easy68kDesktopTest'] as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      const value = hooks[hook as string];
      return (typeof value === 'function' ? value(...(list as unknown[])) : value) as never;
    },
    [name, args] as const,
  ) as Promise<T>;
}

/** The id of the BrowserWindow that shows `page`. */
export async function windowIdOf(app: ElectronApplication, page: Page): Promise<number> {
  const url = page.url();
  const title = `e68-window-${Math.random().toString(36).slice(2)}`;
  const previous = await page.evaluate((marker) => {
    const old = document.title;
    document.title = marker;
    return old;
  }, title);
  try {
    return await app.evaluate(
      ({ BrowserWindow }, [marker, pageUrl]) => {
        const found = BrowserWindow.getAllWindows().find(
          (window) => window.webContents.getTitle() === marker && window.webContents.getURL() === pageUrl,
        );
        return found ? found.id : -1;
      },
      [title, url] as const,
    );
  } finally {
    await page.evaluate((old) => {
      document.title = old;
    }, previous);
  }
}
