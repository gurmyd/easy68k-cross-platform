// `npm run desktop:test -- dev` (ARCHITECTURE.md 6.7): the desktop app started from source with
// Playwright's Electron support. Runs in CI on macos-15 (job desktop-dev); everything that can run
// on Windows and Linux runs there too, and the tests that only macOS can show are skipped with
// their reason (see README.md in this folder).
//
// One worker: every test starts its own Electron, which is heavy, and some tests touch shared
// things (the system clipboard).
//
// Environment:
//   EASY68K_APP_DIST              a production build of app/ to serve under app:// (default: the
//                                 one global-setup.ts builds into build/desktop-dev/dist)
//   EASY68K_DESKTOP_SKIP_BUILD=1  reuse build/desktop-dev/dist and desktop/dist as they are
//   EASY68K_REQUIRE_ENGINES=1     (CI) a missing engine/dist fails the engine tests
//
// Owner: DV2.

import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  outputDir: '../../../build/desktop-dev/test-results',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  // Electron starts slowly on a loaded machine; a test fails on a hang, not on slowness.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: '../../../build/desktop-dev/report' }]] : 'list',
});
