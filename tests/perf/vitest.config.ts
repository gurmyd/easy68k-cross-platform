// Vitest project of the performance package under Node (ARCHITECTURE.md 9.6, P1). Owner: P1.
//
//   npx vitest run --config tests/perf/vitest.config.ts
//
// It runs the unit tests of this folder: the verdicts of check-perf.mjs (no browser, no engine)
// and the four fixed programs on the real engines with virtual time (programs.test.ts; skipped
// without engine/dist, a failure with EASY68K_REQUIRE_ENGINES=1). The measurements themselves
// need a browser: check-perf.mjs. No runner picks this project up by itself yet: see
// docs/requests/P1-perf-scripts.md.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'perf',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    environment: 'node',
    // A limit that catches a hang, not one that measures speed: many suites run on one machine.
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
