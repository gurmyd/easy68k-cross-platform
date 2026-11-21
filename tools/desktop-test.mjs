#!/usr/bin/env node
// `npm run desktop:test -- <suite>`: the desktop tests of ARCHITECTURE.md 6.7.
//
//     node tools/desktop-test.mjs dev       [arguments for Playwright]
//     node tools/desktop-test.mjs packaged  [arguments for Playwright]
//
// Runs `playwright test --config tests/desktop/<suite>/playwright.config.ts`
// from the repository root, without a shell, so that it works the same on
// every OS. `dev` tests the development build, `packaged` a built .app (DV2,
// DV3 write the suites). A suite whose configuration does not exist yet is an
// error with a message saying so.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITES = ['dev', 'packaged'];
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [suite, ...rest] = process.argv.slice(2);

if (!suite || !SUITES.includes(suite)) {
  console.error(`desktop:test: name the suite: npm run desktop:test -- ${SUITES.join('|')} [Playwright arguments]`);
  process.exit(2);
}
const config = join(repo, 'tests', 'desktop', suite, 'playwright.config.ts');
if (!existsSync(config)) {
  console.error(
    `desktop:test: ${relative(repo, config).split('\\').join('/')} does not exist yet. The desktop tests are` +
      ' written by work packages DV2 and DV3 (ARCHITECTURE.md 6.7, 9).',
  );
  process.exit(1);
}

const require = createRequire(join(repo, 'tests', 'package.json'));
const playwrightPackage = require.resolve('@playwright/test/package.json');
const cli = join(dirname(playwrightPackage), JSON.parse(readFileSync(playwrightPackage, 'utf8')).bin.playwright);

const child = spawn(process.execPath, [cli, 'test', '--config', config, ...rest], { cwd: repo, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(`desktop:test: could not start Playwright: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
