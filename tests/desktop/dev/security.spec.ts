// The settings of 7.6 in the running app, against the production build under app:// (6.7): web
// preferences, permission handlers, navigation and window-open blocking, protocol privileges and
// content types, the Content Security Policy, the preload script's single object.
//
// Owner: DV2.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DESKTOP_BRIDGE_KEYS } from '../../../app/src/platform/desktop';
import { CONTENT_SECURITY_POLICY } from '../../../desktop/src/security';
import { DESKTOP_DIR, launchDesktop, REPO, type Desktop } from './harness';

let desktop: Desktop;
let startupErrors: string[] = [];

test.beforeAll(async () => {
  test.setTimeout(300_000);
  desktop = await launchDesktop();
  // Let the application finish starting (lazy chunks, the first render), then keep what it said.
  await desktop.page.locator('#root > *').first().waitFor({ timeout: 60_000 });
  await desktop.page.waitForTimeout(2000);
  startupErrors = [...desktop.errors];
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
});

function distAsset(pattern: RegExp): string {
  const dist = process.env.EASY68K_APP_DIST as string;
  const name = readdirSync(join(dist, 'assets')).find((file) => pattern.test(file));
  if (!name) throw new Error(`no asset matching ${pattern} in ${dist}/assets`);
  return name;
}

test('the window loads app://easy68k/index.html with the web preferences of 7.6', async () => {
  expect(desktop.page.url()).toBe('app://easy68k/index.html');
  const prefs = await desktop.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return null;
    return {
      // getLastWebPreferences() exists at run time but is missing from Electron's type declarations.
      ...(
        window.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
      ).getLastWebPreferences(),
      // Not part of getLastWebPreferences(); 4.5.5.
      backgroundThrottling: window.webContents.getBackgroundThrottling(),
    };
  });
  expect(prefs).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    backgroundThrottling: false,
  });
  // ARCHITECTURE-PLUS P3.4.2, R5: the application window has Electron's PDF viewer, for the
  // viewer's blob: frame. getLastWebPreferences() does not report `plugins` (Electron 45), so the
  // effect is read in the page instead: Chromium reports the built-in viewer only while plugins are
  // on (errata N0). The constant itself is checked in unit.spec.ts.
  const pdfViewer = await desktop.page.evaluate(() => navigator.pdfViewerEnabled);
  console.log(`app window: navigator.pdfViewerEnabled = ${String(pdfViewer)}`);
  expect(pdfViewer).toBe(true);
});

test('the page has no require and no process, and exactly the documented bridge', async () => {
  const facts = await desktop.page.evaluate(() => ({
    require: typeof (window as unknown as Record<string, unknown>)['require'],
    process: typeof (window as unknown as Record<string, unknown>)['process'],
    module: typeof (window as unknown as Record<string, unknown>)['module'],
    keys: Object.keys(window.easy68kDesktop ?? {}).sort(),
    devices: Object.keys(window.easy68kDesktop?.devices ?? {}).sort(),
    frozen: (() => {
      const bridge = window.easy68kDesktop as unknown as Record<string, unknown>;
      try {
        bridge['injected'] = 1;
      } catch {
        // a frozen object throws in strict code
      }
      return bridge['injected'] === undefined;
    })(),
  }));
  expect(facts.require).toBe('undefined');
  expect(facts.process).toBe('undefined');
  expect(facts.module).toBe('undefined');
  expect(facts.keys).toEqual([...DESKTOP_BRIDGE_KEYS].sort());
  expect(facts.devices).toEqual(['on', 'request']);
  expect(facts.frozen).toBe(true);
});

test('the page started the application with the desktop platform', async () => {
  // The production build has no window.__easy68k; the start-up error text would replace the page.
  await expect(desktop.page.locator('#root')).not.toHaveText(/could not start/, { timeout: 60_000 });
  await expect(desktop.page.locator('#root > *').first()).toBeVisible({ timeout: 60_000 });
  // For a person to look at (build/ is not tracked). The window is hidden, so the picture is taken
  // by the main process; a machine that cannot paint hidden windows leaves it out.
  const png = await desktop.app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const image = window ? await window.webContents.capturePage() : null;
    return image && !image.isEmpty() ? image.toPNG().toString('base64') : null;
  });
  if (png) {
    const dir = join(REPO, 'build', 'desktop-dev', 'screens');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app-protocol-start.png'), Buffer.from(png, 'base64'));
  }
});

// DV1 (features/pwa): no service worker is registered when the platform is the desktop app (7.4).
test('no service worker is registered in the desktop app', async () => {
  const facts = await desktop.page.evaluate(async () => {
    if (!('serviceWorker' in navigator))
      return { registrations: 0, controlled: false, why: 'no navigator.serviceWorker' };
    let registrations = 0;
    let why = 'getRegistrations() answered';
    try {
      registrations = (await navigator.serviceWorker.getRegistrations()).length;
    } catch (error) {
      // app:// is not a scheme service workers are allowed for (protocol.ts privileges), so the
      // browser refuses even to list them: none can exist.
      why = `getRegistrations() refused: ${String(error)}`;
    }
    return { registrations, controlled: navigator.serviceWorker.controller !== null, why };
  });
  expect(facts.registrations).toBe(0);
  expect(facts.controlled).toBe(false);
  test.info().annotations.push({ type: 'note', description: facts.why });
});

test('every permission request of the page is denied', async () => {
  const results = await desktop.page.evaluate(async () => {
    const outcome = async (run: () => Promise<unknown>) => {
      try {
        return `granted: ${String(await run())}`;
      } catch (error) {
        return `refused: ${(error as Error).name}`;
      }
    };
    return {
      notification: await Notification.requestPermission(),
      media: await outcome(() => navigator.mediaDevices.getUserMedia({ audio: true })),
      clipboardRead: await outcome(() => navigator.clipboard.readText()),
      geolocation: await new Promise<string>((resolve) =>
        navigator.geolocation.getCurrentPosition(
          () => resolve('granted'),
          (error) => resolve(`refused: ${error.code}`),
          { timeout: 5000 },
        ),
      ),
      midi: await outcome(() => navigator.requestMIDIAccess()),
      serial: await outcome(() =>
        (navigator as unknown as { serial: { requestPort(): Promise<unknown> } }).serial.requestPort(),
      ),
    };
  });
  expect(results.notification).toBe('denied');
  expect(results.media).toMatch(/^refused/);
  expect(results.clipboardRead).toMatch(/^refused/);
  expect(results.geolocation).toMatch(/^refused/);
  expect(results.midi).toMatch(/^refused/);
  expect(results.serial).toMatch(/^refused/);
});

test('navigation to another URL is cancelled', async () => {
  const { page } = desktop;
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(1500);
  expect(page.url()).toBe('app://easy68k/index.html');
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'file:///etc/hosts';
    link.textContent = 'x';
    document.body.append(link);
    link.click();
    link.remove();
  });
  await page.waitForTimeout(1500);
  expect(page.url()).toBe('app://easy68k/index.html');
});

test('window.open is denied; allow-listed links go to the system browser, others nowhere', async () => {
  const { app, page } = desktop;
  // Record what would open in the system browser instead of opening it.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as Record<string, unknown>)['__opened'] = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  const results = await page.evaluate(() => [
    window.open('https://example.com/') === null,
    window.open('https://github.com/gurmyd/easy68k-mac') === null,
    window.open('app://easy68k/index.html') === null,
  ]);
  expect(results).toEqual([true, true, true]);
  await page.waitForTimeout(500);
  const state = await app.evaluate(({ BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().length,
    opened: (globalThis as Record<string, unknown>)['__opened'] as string[],
  }));
  expect(state.windows).toBe(1);
  expect(state.opened).toEqual(['https://github.com/gurmyd/easy68k-mac']);
});

test('app:// is privileged: fetch works, content types come from the table, the policy is a header', async () => {
  const loader = distAsset(/^sim68k-loader-.*\.mjs$/);
  const wasm = distAsset(/^sim68k-.*\.wasm$/);
  const result = await desktop.page.evaluate(
    async ([loaderName, wasmName]) => {
      const head = async (url: string) => {
        try {
          const response = await fetch(url);
          return {
            status: response.status,
            type: response.headers.get('content-type'),
            csp: response.headers.get('content-security-policy'),
          };
        } catch {
          // Another origin without CORS headers: the page may not even see the status.
          return { status: -1, type: null, csp: null };
        }
      };
      return {
        index: await head('app://easy68k/index.html'),
        loader: await head(`app://easy68k/assets/${loaderName}`),
        wasm: await head(`app://easy68k/assets/${wasmName}`),
        relative: await head(`./assets/${loaderName}`),
        missing: await head('app://easy68k/no-such-file.html'),
        unknownType: await head('app://easy68k/index.exe'),
        escape: await head('app://easy68k/..%2f..%2fpackage.json'),
        otherHost: await head('app://elsewhere/index.html'),
      };
    },
    [loader, wasm] as const,
  );
  expect(result.index).toEqual({ status: 200, type: 'text/html; charset=utf-8', csp: CONTENT_SECURITY_POLICY });
  expect(result.loader.status).toBe(200);
  expect(result.loader.type).toMatch(/^text\/javascript/);
  expect(result.wasm).toMatchObject({ status: 200, type: 'application/wasm' });
  expect(result.relative.status).toBe(200);
  expect(result.missing.status).toBe(404);
  expect(result.unknownType.status).toBe(403);
  expect(result.escape.status).toBeGreaterThanOrEqual(400);
  expect([403, -1]).toContain(result.otherHost.status);
  // The handler itself refuses the other host (seen from the main process, without CORS).
  const fromMain = await desktop.app.evaluate(
    async ({ net }) => (await net.fetch('app://elsewhere/index.html')).status,
  );
  expect(fromMain).toBe(403);
});

test('the page loads without a Content Security Policy violation and without errors', async () => {
  // What the page reported while it started, before any test provoked a violation on purpose.
  expect(startupErrors).toEqual([]);
  // The policy is in force: an inline script is refused.
  const blocked = await desktop.page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const onViolation = () => resolve(true);
        document.addEventListener('securitypolicyviolation', onViolation, { once: true });
        const script = document.createElement('script');
        script.textContent = 'window.__inline = 1';
        document.head.append(script);
        setTimeout(() => resolve((window as unknown as { __inline?: number }).__inline === undefined), 1000);
      }),
  );
  expect(blocked).toBe(true);
});

test('IPC from a window that is not an application window is refused', async () => {
  // A window with the same preload script that the app did not create as an application window
  // (and that shows another page): every handler must refuse it.
  const preload = join(DESKTOP_DIR, 'dist', 'preload.js');
  const replies = await desktop.app.evaluate(async ({ BrowserWindow }, preloadPath) => {
    const stranger = new BrowserWindow({
      show: false,
      webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true },
    });
    await stranger.loadURL('data:text/html,<p>stranger</p>');
    const result = await stranger.webContents.executeJavaScript(`(async () => {
      const b = window.easy68kDesktop;
      return {
        startup: await b.startup(),
        fs: await b.fs('stat', 'x'),
        fsSync: b.fsSync('stat', 'x'),
        create: b.fsSync('create', 'x'),
        device: b.devices.request('serial.open', 'COM1'),
        fullScreen: await b.setFullScreen(true),
        dialog: await b.showOpenDialog({ title: 'x', filters: [], multiple: false }),
      };
    })()`);
    stranger.destroy();
    return result as Record<string, unknown>;
  }, preload);
  expect(replies).toEqual({
    startup: null,
    fs: { ok: false, code: 'io', message: 'refused: unknown sender' },
    fsSync: null,
    create: false,
    device: undefined,
    fullScreen: false,
    dialog: null,
  });
});
