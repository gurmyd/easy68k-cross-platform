// Vitest project of the whole-program pixel regression (ARCHITECTURE.md 6.5.4), picked up by
// tests/vitest.workspace.ts (`npm run test:conformance`). Owner: X3.
//
//   npx vitest run --config tests/conformance/examples/vitest.config.ts
//
// Starts no browser: the browser half is check-examples.mjs (`npm run check:examples` once the
// request docs/requests/X3-check-examples.md is applied). The programs need engine/dist; without
// it the tests skip, and fail with EASY68K_REQUIRE_ENGINES=1.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'examples',
    // This folder, also when the file is passed with --config from the repository root.
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    // A limit that catches a hang, not one that measures speed: many suites run on one machine.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
