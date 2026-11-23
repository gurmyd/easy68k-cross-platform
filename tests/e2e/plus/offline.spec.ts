// "Offline after the first load: everything above works with the network cut" (ARCHITECTURE-PLUS P5
// N9 acceptance; main 6.6). Owner: N9.
//
// Each test loads the application once with the network on, waits until the service worker has
// precached the site and is active, cuts the network, reloads, and then runs a scenario of the
// stage with no network at all: the long scenario (the viewer, the comparison of Earlier Versions,
// whose code is loaded on demand, and the Trash), the two scenarios with two windows (the second
// window is loaded from the worker's cache), and the moved panels across a reload.

import { expect, test } from '../fixtures';
import { reloadOffline } from '../fixtures/plus';
import { movedPanelsSurviveReload } from './arrangement';
import { studentScenario } from './student';
import { restoreOffersReload, saveShowsInOtherDialog } from './windows';

test.describe('offline after the first load', () => {
  test.use({ serviceWorkers: 'allow' });
  // Each test precaches the whole site (about 18.5 MB, 431 files) in a fresh profile. Run in parallel
  // on a loaded machine that ran out of resources in X1's offline suite (errata X1 entry 4), so these
  // run one after the other in one worker, as X1's do.
  test.describe.configure({ mode: 'default' });

  test('the long scenario works with the network cut', async ({ app, context }) => {
    test.setTimeout(420_000);
    try {
      await reloadOffline(app, context);
      await studentScenario(app);
      expect(await app.page.evaluate(() => navigator.onLine), 'still offline at the end').toBe(false);
    } finally {
      await context.setOffline(false);
    }
  });

  test('a restore from Earlier Versions in one window offers a reload in the other, with the network cut', async ({
    app,
    context,
  }) => {
    test.setTimeout(360_000);
    try {
      await reloadOffline(app, context);
      await restoreOffersReload(app);
    } finally {
      await context.setOffline(false);
    }
  });

  test("a save in one window shows a new version in the other's open Earlier Versions dialog, with the network cut", async ({
    app,
    context,
  }) => {
    test.setTimeout(360_000);
    try {
      await reloadOffline(app, context);
      await saveShowsInOtherDialog(app);
    } finally {
      await context.setOffline(false);
    }
  });

  test('panels moved in both modes survive a reload with the network cut', async ({ app, context }) => {
    test.setTimeout(360_000);
    try {
      await reloadOffline(app, context);
      await movedPanelsSurviveReload(app, async () => {
        await app.page.reload();
        await app.ready();
        expect(await app.page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
      });
    } finally {
      await context.setOffline(false);
    }
  });
});
