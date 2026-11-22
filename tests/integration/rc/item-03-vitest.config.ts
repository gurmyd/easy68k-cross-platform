// Vitest configuration of the release candidate's item 3 evidence (ARCHITECTURE.md 6.9 item 3, 6.5).
// Owner: I3. Its name does not match tests/integration/*/vitest.config.ts, so npm run test:integration
// does not pick it up; run it on purpose:
//
//   npx vitest run --config tests/integration/rc/item-03-vitest.config.ts
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'rc-item-03',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['item-03-*.test.ts'],
    environment: 'node',
    // The tests are in file order: the last one prints the collected figures.
    sequence: { concurrent: false },
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
