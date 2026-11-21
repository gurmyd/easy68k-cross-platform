// Vitest project of the wave 2 integration scenario under Node (ARCHITECTURE.md 9.5, 6.4). Owner: I2.
//
//   npx vitest run --config tests/integration/wave2/vitest.config.ts
//
// It runs scenario.test.ts: the application built under Node with the real services, features,
// engines and host parts, no browser. The browser half of the scenario is check-wave2.mjs in this
// folder. `npm run test:integration` picks this project up by its file name.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration-wave2',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    environment: 'node',
    // A limit that catches a hang, not one that measures speed: many suites run on one machine.
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
