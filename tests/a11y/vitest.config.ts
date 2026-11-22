// Vitest project of the accessibility audit's own logic (ARCHITECTURE.md 9.6 Q1). Owner: Q1.
//
//   npx vitest run --config tests/a11y/vitest.config.ts
//
// Runs the unit tests of tests/a11y/lib (contrast arithmetic, chord spelling, the Safari Tab rule,
// the classification of axe findings, the report's tally) under Node, without a browser. The
// browser half is check-a11y.mjs in this folder. docs/requests/Q1-a11y-ci.md asks for this project
// in `npm run test:conformance` and for the check script in CI.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'a11y',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['lib/**/*.test.mjs'],
    environment: 'node',
  },
});
