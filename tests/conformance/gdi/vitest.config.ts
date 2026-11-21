// Vitest project of the GDI conformance suite (ARCHITECTURE.md 6.4, 6.5), picked up by
// tests/vitest.workspace.ts. Owner: T2.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'gdi',
    // This folder, also when the file is passed with --config from the repository root (otherwise
    // the include below would pick up every test of the tree).
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    // The suites read 26,000 reference pictures; give every test room on a loaded machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
