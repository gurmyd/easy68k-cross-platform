#!/usr/bin/env node
// The root `postinstall` script: puts the Electron binary into
// node_modules/electron/dist, so that `npm ci` leaves a working Electron on
// macOS, Windows and Linux.
//
//     node tools/install-electron.mjs
//
// Why a script of ours: the `electron` package (45.x) has no install script of
// its own any more. Its binary is downloaded by node_modules/electron/install.js,
// which the package otherwise runs only on the first `require('electron')`.
// That first run would then happen inside a test or `desktop:dev`; doing it at
// install time makes a missing or failed download an install error instead.
// install.js does nothing when the right version is already there, and
// @electron/get keeps the download in its cache (on macOS
// ~/Library/Caches/electron, on Windows %LOCALAPPDATA%\electron\Cache, on
// Linux ~/.cache/electron).
//
// Set ELECTRON_SKIP_BINARY_DOWNLOAD=1 to skip it (the CI jobs that do not
// start Electron do). Nothing happens when the desktop workspace's packages
// are not installed (for example `npm ci --omit=dev`).

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skip = process.env.ELECTRON_SKIP_BINARY_DOWNLOAD;

if (skip && skip !== '0' && skip !== 'false') {
  console.log('install-electron: ELECTRON_SKIP_BINARY_DOWNLOAD is set; the Electron binary is not downloaded.');
  process.exit(0);
}

let installer;
try {
  installer = join(
    dirname(createRequire(join(repo, 'desktop', 'package.json')).resolve('electron/package.json')),
    'install.js',
  );
} catch {
  console.log('install-electron: the electron package is not installed; nothing to do.');
  process.exit(0);
}

const result = spawnSync(process.execPath, [installer], { cwd: repo, stdio: 'inherit' });
if (result.status !== 0) {
  console.error(
    'install-electron: the Electron binary could not be downloaded (see above). The web app does not need it;' +
      ' set ELECTRON_SKIP_BINARY_DOWNLOAD=1 to install without it, or run "node node_modules/electron/install.js" later.',
  );
  process.exit(result.status ?? 1);
}
