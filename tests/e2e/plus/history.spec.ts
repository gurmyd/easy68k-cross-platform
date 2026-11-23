// The safety net, across packages and across windows (ARCHITECTURE-PLUS P3.2, P3.3, P3.4, P3.3.8,
// P3.3.10; P5 N9 acceptance). Owner: N9. The same scenarios run with the network cut after the
// first load in offline.spec.ts.

import { test } from '../fixtures';
import { studentScenario } from './student';
import { restoreOffersReload, saveShowsInOtherDialog } from './windows';

test('a student imports a folder, views its PDF, saves three times, deletes by mistake and gets everything back', async ({
  app,
}) => {
  // About thirty steps through the interface with eleven downloads: slow in WebKit on a loaded machine.
  test.setTimeout(300_000);
  await studentScenario(app);
});

test('a restore from Earlier Versions in one window offers a reload in the other, which then shows the restored text', async ({
  app,
}) => {
  test.setTimeout(240_000);
  await restoreOffersReload(app);
});

test("two windows: a save in one shows a new version in the other's open Earlier Versions dialog", async ({ app }) => {
  test.setTimeout(240_000);
  await saveShowsInOtherDialog(app);
});
