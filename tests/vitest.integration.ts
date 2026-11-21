// `npm run test:integration`: the Node halves of the integration scenarios (ARCHITECTURE.md 9.3,
// 9.5, 9.8; owners I1, I2, I3).
//
// Picks up every tests/integration/<gate>/vitest.config.ts by glob, as tests/vitest.workspace.ts
// does for the conformance suites; each folder's configuration belongs to its gate, so a new
// scenario needs no change here. The browser halves are check scripts (npm run check:wave1).
// While no scenario exists the run says so and succeeds with no tests.

import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_GLOB = 'integration/*/vitest.config.ts';
const found = globSync(PROJECT_GLOB, { cwd: root });

if (found.length === 0) {
  console.log(`test:integration: no scenario yet (${PROJECT_GLOB} under tests/) - nothing to run`);
}

export default defineConfig({
  test: {
    root,
    passWithNoTests: true,
    ...(found.length > 0 ? { projects: found.map((file) => `./${file.replaceAll('\\', '/')}`) } : { include: [] }),
  },
});
