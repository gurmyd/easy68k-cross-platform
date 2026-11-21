// Vitest project of the wave 1 integration scenario under Node (ARCHITECTURE.md 9.3, 6.4). Owner: I1.
//
//   npx vitest run --config tests/integration/wave1/vitest.config.ts
//
// It runs scenario.test.ts: the real engines and the real host parts in the headless session, no
// browser. The browser half of the scenario is check-wave1.mjs in this folder.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration-wave1',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    environment: 'node',
    // A limit that catches a hang, not one that measures speed: many suites run on one machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
