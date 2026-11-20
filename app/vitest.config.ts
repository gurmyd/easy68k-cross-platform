// Vitest configuration of the application's unit tests (`npm test`).
// Unit tests live next to the code: app/src/**/x.test.ts(x). They run under
// Node with no DOM (ARCHITECTURE.md section 0, rule 5); a test that needs
// IndexedDB imports "fake-indexeddb/auto" itself.

import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'node',
    },
  }),
);
