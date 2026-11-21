// Vitest project of the simulator conformance suite (`npm run test:conformance` picks it up through
// tests/vitest.workspace.ts; ARCHITECTURE.md 6.4, 8). Owner: T3.
//
// It runs the tests of everything T3 owns under tests/: this folder (the comparison of the port with
// the official SIM68K.exe results, the harness, the checklist items) and the host-side code of the
// simulator oracle (tests/oracle/wine/sim). None of them starts Docker, Wine or a browser. The
// comparison needs engine/dist; without it the tests skip (and fail with EASY68K_REQUIRE_ENGINES=1).
//
//   npx vitest run --config tests/conformance/sim/vitest.config.ts

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'sim',
    // tests/, so that the include patterns can name the oracle folder.
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['conformance/sim/**/*.test.{ts,mjs}', 'oracle/wine/sim/**/*.test.{ts,mjs}'],
    environment: 'node',
    // A limit that catches a hang, not one that measures speed: many suites run on one machine.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
