// Finishes a production build of app/ for offline use: manifest and icon tags in index.html, the
// precache list, sw.js. Owner: DV1. See pwa-build.mjs.
//
//   node app/src/features/pwa/build/finish-build.mjs [outDir]     (default: app/dist)
//
// Since gate I1, app/vite.config.ts runs the same step at the end of every production build
// (pwaPlugin(), docs/requests/DV1-vite-plugin.md). This command stays for a build made some other
// way and as pages.yml's safety net; on a finished build it changes nothing (idempotent).

/* global console */

import process from 'node:process';
import { join } from 'node:path';
import { APP_DIR, finishPwaBuild, summarize } from './pwa-build.mjs';

const outDir = process.argv[2] ?? join(APP_DIR, 'dist');
try {
  const report = await finishPwaBuild(outDir);
  console.log(summarize(report));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
