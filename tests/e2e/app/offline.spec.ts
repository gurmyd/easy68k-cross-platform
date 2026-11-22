// Offline reload after the first load, and the installed-app manifest (ARCHITECTURE.md 1.1, 5.7,
// 7.5; 6.6 "offline reload after first load, installed-app manifest"). Owner: X1. The service
// worker and the manifest are DV1's; DV1's own check (check-pwa.mjs) covers every precached file.

import { expect, test, type App } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';

/** Waits for the service worker, turns the network off and reloads; the application must come back. */
async function reloadOffline(app: App, page: Page, context: BrowserContext): Promise<void> {
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
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page).toHaveTitle(/^EASy68K Editor\/Assembler/);
}

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });
  // Each test precaches the whole site (430 files, about 17.8 MB) in a fresh profile. Run in parallel
  // on a loaded machine they ran out of resources (net::ERR_INSUFFICIENT_RESOURCES, or no activated
  // worker after 120 s: gate I2 round 1 review), so the two run one after the other in one worker
  // (errata X1 entry 4). Other suites still run beside them.
  test.describe.configure({ mode: 'default' });

  test('after one load, a reload with the network off brings the application back and the editor works', async ({
    app,
    page,
    context,
  }) => {
    try {
      await reloadOffline(app, page, context);
      await app.replaceText('* typed offline');
      expect(await app.text()).toBe('* typed offline');
    } finally {
      await context.setOffline(false);
    }
  });

  test('offline, Help > Help shows the introduction page in the help frame', async ({
    app,
    page,
    context,
    browserName,
  }) => {
    // Cause found (errata X1 entry 12, H1 entry, docs/requests/H1-help-offline-webkit.md): WebKit
    // does not send the navigation of a frame sandboxed WITHOUT allow-scripts to the service
    // worker at all. Online that frame's page comes from the network (Playwright reports
    // fromServiceWorker false for it, true for the same page in a frame with allow-scripts, and
    // true in Chromium for every sandbox); offline it fails with "WebKit encountered an internal
    // error". The help frame is sandboxed without scripts on purpose (ARCHITECTURE.md 7.6), so
    // the repair is a security decision of the architect, asked in that request. The rule depends
    // on the frame's sandbox and holds online too, so it is the engine's, not Playwright's offline
    // switch: real Safari is expected to behave the same; MANUAL-TEST-MAC.md W1 checks it. When the frame is repaired, this test
    // reports "expected to fail, but passed": then this line goes.
    test.fail(
      browserName === 'webkit',
      'WebKit sends no navigation of a frame sandboxed without allow-scripts to the service worker (X1 errata 12)',
    );
    try {
      await reloadOffline(app, page, context);
      await app.chooseMenu('Help', 'Help');
      await expect(page.locator('[data-e68-panel="help"] .e68-help__title')).toHaveText('Easy68k Introduction');
      await expect
        .poll(() =>
          page
            .locator('[data-e68-panel="help"] iframe')
            .evaluate((frame: HTMLIFrameElement) => frame.contentDocument?.body?.textContent?.length ?? 0),
        )
        .toBeGreaterThan(100);
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe('installed-app manifest', () => {
  test('the page links a manifest that an installation needs: name, start URL, standalone display, icons', async ({
    app,
    page,
  }) => {
    expect(await app.mode()).toBe('editor');
    const href = await page.evaluate(() => document.querySelector<HTMLLinkElement>('link[rel=manifest]')?.href ?? null);
    expect(href).not.toBeNull();
    const manifest = await page.evaluate(async (url) => (await fetch(url)).json(), href!);
    expect(String(manifest.name)).toContain('EASy68K');
    expect(manifest.start_url).toBeTruthy();
    expect(['standalone', 'minimal-ui', 'fullscreen']).toContain(manifest.display);
    const sizes: string[] = (manifest.icons ?? []).flatMap((icon: { sizes?: string }) => (icon.sizes ?? '').split(' '));
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    const statuses = await page.evaluate(
      async ({ url, icons }) =>
        Promise.all(icons.map(async (icon: { src: string }) => (await fetch(new URL(icon.src, url))).status)),
      { url: href!, icons: manifest.icons },
    );
    expect(statuses.every((status: number) => status === 200)).toBe(true);
  });

  test('the manifest declares file handlers for .x68, .l68 and .s68 (5.7)', async ({ app, page }) => {
    // The launch queue that consumes them is features/pwa/launch.ts (DV1 erratum 13); what it does
    // with a launched file is tests/e2e/app/launch.spec.ts.
    expect(await app.mode()).toBe('editor');
    const href = await page.evaluate(() => document.querySelector<HTMLLinkElement>('link[rel=manifest]')?.href ?? null);
    const manifest = await page.evaluate(async (url) => (await fetch(url)).json(), href!);
    const extensions = JSON.stringify(manifest.file_handlers ?? []).toLowerCase();
    for (const extension of ['.x68', '.l68', '.s68']) expect(extensions).toContain(extension);
  });
});
