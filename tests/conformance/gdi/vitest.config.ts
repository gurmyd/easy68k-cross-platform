// Vitest project of the GDI conformance suite (ARCHITECTURE.md 6.4, 6.5), picked up by
// tests/vitest.workspace.ts. Owner: T2.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'gdi',
    include: ['**/*.test.ts'],
    environment: 'node',
    // The suites read 26,000 reference pictures; give every test room on a loaded machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
