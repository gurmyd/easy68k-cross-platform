// Vitest project of the CPU catalogue (`npm run test:conformance` picks it up through
// tests/vitest.workspace.ts; ARCHITECTURE.md 6.1 L7, 6.2.1, 8).
//
// It runs the tests of everything work package T4 owns under tests/: this folder (the single-step
// runner, the catalogue, the frozen baseline) and the native-twin tools (tests/oracle/native-twin).
// None of them builds anything or starts a browser. The baseline test runs the whole single-step
// suite (about four minutes) only when it is asked for with EASY68K_SINGLESTEP=1 and the suite has
// been fetched (node tests/conformance/cpu/fetch-suite.mjs); npm run oracle:twins checks the same
// baseline on every run.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cpu',
    // tests/, so that the include patterns can name the oracle folder.
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['conformance/cpu/**/*.test.{ts,mjs}', 'oracle/native-twin/**/*.test.{ts,mjs}'],
    environment: 'node',
    // A limit that catches a hang, not one that measures speed: many suites run on one machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
