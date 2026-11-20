// `npm run test:e2e` (ARCHITECTURE.md 6.6, 7.2): Playwright in Chromium and
// WebKit against the production build served locally by `vite preview`.
//
// Test files are found by glob, so suites need no change here:
//   tests/e2e/**/*.spec.ts    X1 (editor, app), X2 (sim)
//   tests/a11y/**/*.spec.ts   Q1
// The desktop tests (tests/desktop/dev, tests/desktop/packaged) have their own
// configurations in their folders and run through `npm run desktop:test`.
//
// Written by W0; owned by X1 from wave 1 on.
//
// Environment:
//   CI                set by GitHub Actions: no retries of a reused server,
//                     the build is expected to exist (the job builds first)
//   E2E_SKIP_BUILD=1  locally: serve the existing app/dist without rebuilding

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = Boolean(process.env.CI);
const skipBuild = isCI || process.env.E2E_SKIP_BUILD === '1';

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'a11y/**/*.spec.ts'],
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: skipBuild ? 'npm run preview' : 'npm run build && npm run preview',
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
