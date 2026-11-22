// Release candidate, ARCHITECTURE.md 6.9 item 7 ("Offline: the offline test passes; the app
// installs in Chromium"). Owner: I3.
//
//   node tests/integration/rc/item-07-check-offline.mjs [--browser chromium|webkit|all]
//        [--out <dir>] [--dist <dir>] [--keys mac|windows]
//
// What a person would do, on the production build served locally with the application's own
// headers (Vite's preview server and app/vite.config.ts, on a free port): load the page once, wait
// for the service worker, switch the network off, reload, and then do check A1 of
// docs/MANUAL-TEST-MAC.md offline: Help > Examples..., open tutorial1.X68, assemble with F9,
// Execute, run with F9, read the four lines in the Output panel and "Halted". Then Help > Help
// offline (its frame's text). In Chromium also what installation needs: the manifest's fields and
// icons, and the browser's own reading of it over the DevTools protocol (Page.getAppManifest without
// errors, Page.getInstallabilityErrors). The install prompt itself cannot be driven by Playwright.
//
// It complements, and does not replace, the two tests the item names: tests/e2e/app/offline.spec.ts
// (X1, in `npm run test:e2e`, both browsers on three systems in CI's e2e jobs) and
// app/src/features/pwa/check-pwa.mjs (DV1, `npm run check:pwa`, CI job browser-checks, group
// simulator). Its own point: the whole first workflow of a student works offline, through the
// interface only, on a build without the Pages sub-path.
//
// Help offline in WebKit fails today at a known defect (docs/requests/H1-help-offline-webkit.md,
// errata X1 entry 12): that check is printed as "known" and does not fail the run; when it passes
// the line says the defect seems repaired.
//
// --dist takes an existing production build (for example `npx vite build --outDir <dir>` from
// app/); without it the script builds app/ into <out>/dist. Screenshots and the log go to <out>
// (default build/I3/item-07). Needs engine/dist (with EASY68K_REQUIRE_ENGINES=1 a missing engine
// fails). Exit code 0 = no check failed. About two minutes per browser.

/* global caches, document -- used inside page.evaluate() callbacks, which run in the page */

import { join } from 'node:path';
import {
  BROWSERS,
  Report,
  chooseMenu,
  enginesPresent,
  mode,
  openPage,
  parseArgs,
  productionBuild,
  ready,
  serveBuild,
  until,
  walkA1,
} from './item-07-12-lib.mjs';

const { browsers, keys, outDir, dist: givenDist } = parseArgs(join('I3', 'item-07'));
const report = new Report();

if (!enginesPresent()) {
  console.log('engine/dist is missing: the application cannot assemble or run; nothing is checked.');
  process.exit(process.env.EASY68K_REQUIRE_ENGINES === '1' ? 1 : 0);
}

const dist = productionBuild(givenDist, outDir);
const server = await serveBuild(dist);
console.log(`Site: ${server.url} (build ${dist}), key map ${keys}\nScreenshots: ${outDir}`);

try {
  for (const name of browsers) {
    console.log(`\n[${name}]`);
    const browser = await BROWSERS[name].launch();
    try {
      const { context, page, errors } = await openPage(browser, { keys, serviceWorkers: 'allow' });
      const shot = (label) => page.screenshot({ path: join(outDir, `${name}-${label}.png`) });
      const p = `${name}:`;

      // --- first load -------------------------------------------------------------------------
      await page.goto(server.url);
      await ready(page);
      report.check(
        `${p} the first load shows the application`,
        (await page.title()).startsWith('EASy68K'),
        await page.title(),
      );
      const state = await until(
        () =>
          page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated'),
        180_000,
        500,
      );
      report.check(
        `${p} the service worker is activated after the first load (it precaches the whole site)`,
        Boolean(state),
      );
      const cached = await page.evaluate(async () => {
        let files = 0;
        for (const key of await caches.keys()) files += (await (await caches.open(key)).keys()).length;
        return files;
      });
      report.note(`${p} files in the page's caches: ${cached}`);

      // --- installation (Chromium) -------------------------------------------------------------
      const manifestUrl = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.href ?? null);
      const manifest = manifestUrl ? await page.evaluate(async (url) => (await fetch(url)).json(), manifestUrl) : null;
      const sizes = (manifest?.icons ?? []).flatMap((icon) => (icon.sizes ?? '').split(' '));
      report.check(
        `${p} the manifest has a name, a start URL, standalone display and icons of 192 and 512 pixels`,
        Boolean(manifest) &&
          String(manifest.name).includes('EASy68K') &&
          Boolean(manifest.start_url) &&
          manifest.display === 'standalone' &&
          sizes.includes('192x192') &&
          sizes.includes('512x512'),
        manifest
          ? `name "${manifest.name}", start_url "${manifest.start_url}", display ${manifest.display}, sizes ${sizes.join(' ')}`
          : 'no manifest',
      );
      if (name === 'chromium') {
        const cdp = await context.newCDPSession(page);
        const parsed = await cdp.send('Page.getAppManifest');
        const critical = (parsed.errors ?? []).filter((error) => error.critical);
        report.check(
          `${p} Chromium's own parse of the manifest (Page.getAppManifest) has no critical error`,
          Boolean(parsed.url) && critical.length === 0,
          `url ${parsed.url}, ${parsed.errors?.length ?? 0} error(s)${parsed.errors?.length ? `: ${JSON.stringify(parsed.errors)}` : ''}`,
        );
        const installability = await cdp
          .send('Page.getInstallabilityErrors')
          .catch((error) => ({ failed: String(error) }));
        report.note(
          `${p} Page.getInstallabilityErrors: ${JSON.stringify(installability)} (headless Chromium answers this without judging installation fully; see check-pwa.mjs)`,
        );
        await cdp.detach();
      }

      // --- offline ----------------------------------------------------------------------------
      await context.setOffline(true);
      await page.reload();
      await ready(page);
      report.check(
        `${p} offline: the reload brings the application back`,
        (await page.title()).startsWith('EASy68K'),
        await page.title(),
      );
      report.check(
        `${p} offline: the page is controlled by the service worker`,
        await page.evaluate(() => navigator.serviceWorker.controller !== null),
      );
      await shot('offline-reloaded');
      await walkA1(page, report, `${p} offline `, shot, { manualWording: false });

      // Help > Help offline (the help pages are precached; WebKit's sandboxed frame is the known defect).
      const errorsBeforeHelp = errors.length;
      await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Editor', exact: true }).click();
      await until(async () => (await mode(page)) === 'editor', 10_000);
      await chooseMenu(page, 'Help', 'Help');
      const helpLength = await until(
        () =>
          page
            .locator('[data-e68-panel="help"] iframe')
            .first()
            .evaluate((frame) => frame.contentDocument?.body?.textContent?.length ?? 0),
        20_000,
      );
      const helpOk = (helpLength ?? 0) > 100;
      await shot('offline-help');
      if (name === 'webkit')
        report.knownDefect(
          `${p} offline: Help > Help shows the help page's text`,
          helpOk,
          'WebKit sends no navigation of a frame sandboxed without scripts to the worker; docs/requests/H1-help-offline-webkit.md, owner H1',
          `${helpLength ?? 0} characters`,
        );
      else
        report.check(`${p} offline: Help > Help shows the help page's text`, helpOk, `${helpLength ?? 0} characters`);

      // In WebKit the failed load of the help frame (the known defect above) logs "Failed to load
      // resource: WebKit encountered an internal error"; only that message, and only after Help > Help.
      const ownErrors = errors.filter(
        (text, index) =>
          !(
            name === 'webkit' &&
            !helpOk &&
            index >= errorsBeforeHelp &&
            /WebKit encountered an internal error/.test(text)
          ),
      );
      report.check(`${p} no console or page errors`, ownErrors.length === 0, ownErrors.slice(0, 3).join(' | '));
      if (ownErrors.length !== errors.length)
        report.note(`${p} console errors of the known WebKit help defect: ${errors.length - ownErrors.length}`);
      await context.setOffline(false);
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
report.finish();
