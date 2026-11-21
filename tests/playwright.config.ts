// `npm run test:e2e` (ARCHITECTURE.md 6.6, 7.2): Playwright in Chromium and WebKit against the
// production build served locally. Owner: X1 (written by W0).
//
// Test files are found by glob, so suites need no change here:
//   tests/e2e/**/*.spec.ts    X1 (fixtures, editor, app), X2 (sim)
//   tests/a11y/**/*.spec.ts   Q1
// The desktop tests (tests/desktop/dev, tests/desktop/packaged) have their own configurations in
// their folders and run through `npm run desktop:test`.
//
// The build is served by tests/e2e/fixtures/serve.mjs (Vite's preview server, which also sends the
// production Content Security Policy) on a port it is given. The port is free when this file is
// first read and is passed to the workers in E2E_PORT, so the runner, its workers and the server
// agree on it and several runs can share one machine.
//
// Environment:
//   CI                set by GitHub Actions: no retries, the build must exist (the job builds first)
//   E2E_SKIP_BUILD=1  locally: serve the existing app/dist without rebuilding
//   E2E_DIST=<dir>    serve this build instead of app/dist, without rebuilding (for example a build
//                     made with `npx vite build --outDir <dir>` from app/)
//   E2E_PORT=<n>      serve on this port instead of a free one
//   E2E_KEYS=mac|windows  the key map the page is given; default: the system the tests run on
//                     (tests/e2e/fixtures/keys.ts). For diagnosis only: the browser's own
//                     clipboard keys follow the real system.
//
// Examples (from the repository root):
//   npm run test:e2e -- --project chromium
//   E2E_DIST=build/X1/dist npx playwright test --config tests/playwright.config.ts --workers=4
//   ... --repeat-each=20 --project webkit        (the stability criterion of 6.9 item 10)

import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(testsDir, '..');
const isCI = Boolean(process.env.CI);
const dist = process.env.E2E_DIST ? resolve(repoDir, process.env.E2E_DIST) : join(repoDir, 'app', 'dist');
const build = !isCI && !process.env.E2E_DIST && process.env.E2E_SKIP_BUILD !== '1';

/** A TCP port that is free on 127.0.0.1 now. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

// Workers inherit the runner's environment, so they read the port the runner chose.
if (!process.env.E2E_PORT) process.env.E2E_PORT = String(await freePort());
const port = Number(process.env.E2E_PORT);

if (!build && !existsSync(join(dist, 'index.html'))) {
  throw new Error(`No production build in ${dist}. Run "npm run build" first, or set E2E_DIST.`);
}

const serve = `node "${join(testsDir, 'e2e', 'fixtures', 'serve.mjs')}" --dist "${dist}" --port ${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'a11y/**/*.spec.ts'],
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  // A flaky test must show as a failure (6.9 item 10: 20 repetitions without one).
  retries: 0,
  // Fifteen engineers share the development machine and GitHub's macOS runner is slow: the limits
  // are generous, and no test waits for a fixed time, so a fast machine is not slowed down.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1400, height: 900 },
    reducedMotion: 'reduce',
    // A click waits for two stable animation frames; a loaded machine can take long to give them.
    actionTimeout: 45_000,
    navigationTimeout: 60_000,
    // The service worker precaches the whole site (about 17 MB) in every new context; only the
    // offline test (e2e/app/offline.spec.ts) allows it.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 900 } } },
  ],
  webServer: {
    command: build ? `npm run build && ${serve}` : serve,
    cwd: repoDir,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
