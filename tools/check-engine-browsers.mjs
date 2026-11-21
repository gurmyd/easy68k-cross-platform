#!/usr/bin/env node
// `npm run check:engine-browsers`: the engine binding's browser suite
// (app/src/engine/browser.test.ts, W4) in headless Chromium and WebKit.
//
//     node tools/check-engine-browsers.mjs [arguments for Vitest]
//
// A plain `npm test` skips that suite, so that many test runs on one machine
// do not all start browsers. This script runs it with
//     EASY68K_BROWSERS=chromium,webkit   (unless the variable is already set;
//                                         "all" also means both)
//     EASY68K_REQUIRE_BROWSERS=1         (a browser that is not installed fails)
// on every operating system, without a shell. The browsers come from
// `npx playwright install chromium webkit`; engine/dist must exist
// (`npm run build:engines` or `npm run fetch:engines`). The suite writes its
// memory figures to build/reports/engine-binding-browsers.json.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(repo, 'app');
const require = createRequire(join(app, 'package.json'));
const vitestPackage = require.resolve('vitest/package.json');
const vitest = join(dirname(vitestPackage), JSON.parse(readFileSync(vitestPackage, 'utf8')).bin.vitest);

const env = {
  ...process.env,
  EASY68K_BROWSERS: process.env.EASY68K_BROWSERS || 'chromium,webkit',
  EASY68K_REQUIRE_BROWSERS: '1',
};
console.log(`check:engine-browsers: EASY68K_BROWSERS=${env.EASY68K_BROWSERS} EASY68K_REQUIRE_BROWSERS=1`);

const child = spawn(process.execPath, [vitest, 'run', 'src/engine/browser.test.ts', ...process.argv.slice(2)], {
  cwd: app,
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(`check:engine-browsers: could not start Vitest: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
