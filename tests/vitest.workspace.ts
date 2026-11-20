// `npm run test:conformance` (ARCHITECTURE.md 7.2, 8).
//
// Picks up every tests/conformance/<suite>/vitest.config.ts by glob; each
// suite's configuration belongs to the package that owns the folder, so a new
// suite needs no change here. tests/parity/vitest.config.ts (X2, the unit test
// on matrix.json) is picked up the same way.
//
// Vitest 4 and later have no separate "workspace" file; this file keeps the
// path the architecture names and declares the suites as `test.projects`.
// Vitest refuses a projects list that matches nothing, so while no suite
// exists the run says so and succeeds with no tests.

import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_GLOBS = ['conformance/*/vitest.config.ts', 'parity/vitest.config.ts'];
const found = PROJECT_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: root }));

if (found.length === 0) {
  console.log(`test:conformance: no suite yet (${PROJECT_GLOBS.join(', ')} under tests/) - nothing to run`);
}

export default defineConfig({
  test: {
    root,
    passWithNoTests: true,
    ...(found.length > 0 ? { projects: found.map((file) => `./${file.replaceAll('\\', '/')}`) } : { include: [] }),
  },
});
