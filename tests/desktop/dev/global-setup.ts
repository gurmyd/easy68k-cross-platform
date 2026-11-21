// Before the desktop development-build tests (6.7):
//
// 1. Compiles desktop/src into desktop/dist (the Electron main process and preload script).
// 2. Finds the production build of app/ that app:// serves:
//    - EASY68K_APP_DIST when set (it must exist);
//    - in CI, app/dist, which the job builds before it runs these tests (`npm run build`);
//    - otherwise a build of its own in build/desktop-dev/dist (never app/dist, which other work
//      on the same machine may be using), reused when EASY68K_DESKTOP_SKIP_BUILD=1.
//    Workers read the result from process.env.EASY68K_APP_DIST.
//
// Owner: DV2.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { REPO } from './harness';

function run(what: string, args: string[], cwd: string): void {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${what} failed (exit ${result.status ?? result.signal})`);
  console.log(`desktop-dev setup: ${what} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

export default async function globalSetup(): Promise<void> {
  const require = createRequire(join(REPO, 'package.json'));
  const skipBuild = process.env.EASY68K_DESKTOP_SKIP_BUILD === '1';

  if (!skipBuild || !existsSync(join(REPO, 'desktop', 'dist', 'main.js'))) {
    const tsc = require.resolve('typescript/bin/tsc');
    run('compile desktop/src', [tsc, '-p', join(REPO, 'desktop', 'tsconfig.json'), '--noEmit', 'false'], REPO);
  }

  let dist = process.env.EASY68K_APP_DIST ? resolve(process.env.EASY68K_APP_DIST) : '';
  if (dist) {
    if (!existsSync(join(dist, 'index.html'))) throw new Error(`EASY68K_APP_DIST has no index.html: ${dist}`);
  } else if (process.env.CI) {
    dist = join(REPO, 'app', 'dist');
    if (!existsSync(join(dist, 'index.html'))) throw new Error('app/dist is missing: run `npm run build` first');
  } else {
    dist = join(REPO, 'build', 'desktop-dev', 'dist');
    if (!skipBuild || !existsSync(join(dist, 'index.html'))) {
      const vite = join(require.resolve('vite/package.json'), '..', 'bin', 'vite.js');
      run('production build of app/', [vite, 'build', '--outDir', dist, '--emptyOutDir'], join(REPO, 'app'));
    }
  }
  process.env.EASY68K_APP_DIST = dist;
  console.log(`desktop-dev setup: app:// serves ${dist}`);
}
