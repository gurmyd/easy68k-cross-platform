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

  test('offline, Help > Help shows the introduction page; a link to another page and the Differences page work', async ({
    app,
    page,
    context,
    browserName,
  }) => {
    // Erratum H1 11 (docs/requests/H1-help-offline-webkit.md): WebKit sends no navigation of a frame
    // sandboxed without allow-scripts to the service worker, so the Help frame has allow-scripts in
    // WebKit while the worker controls the page; every help page forbids scripts by its own policy.
    // This test failed in WebKit before (X1 errata 12) and must pass in both browsers now.
    const panel = page.locator('[data-e68-panel="help"]');
    const title = panel.locator('.e68-help__title');
    const frame = panel.locator('iframe');
    /** The length of the text the frame shows (0 while it shows nothing or an error). */
    const shown = () =>
      frame.evaluate((element: HTMLIFrameElement) => element.contentDocument?.body?.textContent?.length ?? 0);
    try {
      await reloadOffline(app, page, context);
      const vendor = await page.evaluate(() => navigator.vendor);
      await app.chooseMenu('Help', 'Help');
      await expect(title).toHaveText('Easy68k Introduction');
      await expect.poll(shown, { message: 'the introduction page is shown offline' }).toBeGreaterThan(100);
      expect(await frame.getAttribute('sandbox')).toBe(
        browserName === 'webkit' && vendor === 'Apple Computer, Inc.'
          ? 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox'
          : 'allow-same-origin allow-popups allow-popups-to-escape-sandbox',
      );

      // A link from one page to another: Quick Start (found with the filter), then its link to the
      // Simulator I/O page, in the frame. (Not Credits: its licence page refers to the original's
      // missing ac-archive.css, which the browser reports as a failed load.)
      const contents = panel.getByRole('button', { name: 'Contents' });
      if ((await contents.getAttribute('aria-pressed')) !== 'true') await contents.click();
      await expect(contents).toHaveAttribute('aria-pressed', 'true');
      await panel.getByLabel('Filter the contents by title').fill('Quick Start');
      await panel.locator('.e68-help__tree [role=treeitem]', { hasText: /^\s*Quick Start$/ }).click();
      await expect(title).toHaveText('Quick Start');
      await expect.poll(shown, { message: 'Quick Start is shown offline' }).toBeGreaterThan(100);
      await page
        .frameLocator('[data-e68-panel="help"] iframe')
        .getByRole('link', { name: 'Simulator I/O' })
        .first()
        .click();
      await expect(title).toHaveText('Simulator Environment');
      await expect.poll(shown, { message: 'the page reached by the link is shown offline' }).toBeGreaterThan(1000);
      // Help > Differences from EASy68K: the port's own page.
      await app.chooseMenu('Help', 'Differences from EASy68K');
      await expect(title).toHaveText('Differences from EASy68K');
      await expect
        .poll(() => frame.evaluate((element: HTMLIFrameElement) => element.contentDocument?.body?.textContent ?? ''), {
          message: 'the Differences page is shown offline',
        })
        .toContain('Differences from EASy68K');
      expect(await shown()).toBeGreaterThan(1000);
      // No script ran in any of these pages: each one forbids scripts by its own policy.
      const policy = await frame.evaluate(
        (element: HTMLIFrameElement) => element.contentDocument?.head?.firstElementChild?.outerHTML ?? null,
      );
      expect(policy).toBe(`<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`);
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
