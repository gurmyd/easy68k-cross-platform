// `npm run desktop:test -- packaged` (ARCHITECTURE.md 6.7): the checks of the built, fused and
// signed EASy68K.app. They run in release.yml on macos-15 (arm64) and macos-15-intel (x64), after
// `npm run desktop:dist`. See README.md in this folder.
//
// Three projects:
//   unit       the logic of desktop/scripts, release.yml and this harness; any system, no app
//   prebuilt   assembles the programs the checks open with the real assembler (engine/dist)
//   packaged   checks 1-5 of 6.7 (DV3) and checks 6-8 in programs/ (DV5); macOS only, after prebuilt
//
// One worker: each check starts the app, whose windows appear on the runner's screen.
//
// Environment: EASY68K_PACKAGED_APP, EASY68K_EXPECTED_ARCH, EASY68K_EXPECT_SIGNATURE (harness.ts).
//
// Owner: DV3.

import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: '.',
  outputDir: '../../../build/desktop-packaged/test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  // A packaged app starts slowly on a loaded runner; a check fails on a hang, not on slowness.
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: '../../../build/desktop-packaged/report' }]]
    : 'list',
  projects: [
    { name: 'unit', testMatch: ['unit.spec.ts'] },
    { name: 'prebuilt', testMatch: ['prebuilt.setup.ts'] },
    {
      name: 'packaged',
      testMatch: [
        'bundle.spec.ts',
        'launch.spec.ts',
        'association.spec.ts',
        'quit.spec.ts',
        'minimise.spec.ts',
        'programs/**/*.spec.ts',
      ],
      dependencies: ['prebuilt'],
    },
  ],
});
