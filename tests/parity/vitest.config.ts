// Vitest project of the parity matrix (ARCHITECTURE.md 6.6; owner X2). `npm run test:conformance` picks
// it up through tests/vitest.workspace.ts. It reads documents and test files only: no engine, no browser.
//
//   npx vitest run --config tests/parity/vitest.config.ts

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'parity',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
