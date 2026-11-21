// Vitest project of the assembler conformance suite (`npm run test:conformance` picks it up through
// tests/vitest.workspace.ts; ARCHITECTURE.md 6.4, 8).
//
// It runs the tests of everything work package T1 owns under tests/: this folder (the comparison
// with the official assembler and the §3.9 checklist), the corpus manifest (tests/corpus) and the
// code of the two oracles (tests/oracle/wine/common, tests/oracle/wine/asm, tests/oracle/asm-cli),
// whose unit tests live next to it. None of them starts Docker, Wine or a browser.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'asm',
    // tests/, so that the include patterns can name the oracle and corpus folders.
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: [
      'conformance/asm/**/*.test.{ts,mjs}',
      'corpus/**/*.test.{ts,mjs}',
      'oracle/wine/common/**/*.test.{ts,mjs}',
      'oracle/wine/asm/**/*.test.{ts,mjs}',
      'oracle/asm-cli/**/*.test.{ts,mjs}',
    ],
    environment: 'node',
    // A limit that catches a hang, not one that measures speed: many suites run on one machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
