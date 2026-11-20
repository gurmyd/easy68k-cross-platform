#!/usr/bin/env node
// `npm run desktop:dev`: the desktop app against the Vite dev server
// (ARCHITECTURE.md 7.2).
//
//     node tools/desktop-dev.mjs [arguments for Electron]
//
// 1. Starts the Vite dev server of app/ with app/vite.config.ts (the same
//    server as `npm run dev`, at http://127.0.0.1:5173/).
// 2. Runs the desktop workspace's `dev` script (compile desktop/src, then
//    `electron . --dev`) with the environment variable
//        EASY68K_DEV_SERVER_URL=http://127.0.0.1:5173/
//    The main process (desktop/src/main.ts, DV2) loads its windows from that
//    address when the variable is set, and from app://easy68k/index.html
//    otherwise. Vite's hot reload then works in the desktop window.
// 3. Stops the dev server when Electron exits, and exits with its status.
//
// The development page is served without the Content Security Policy (7.6);
// the policy is tested against the production build.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = join(repo, 'desktop', 'src', 'main.ts');

if (!existsSync(main)) {
  console.error(
    'desktop:dev: desktop/src/main.ts does not exist yet. The Electron shell is written by work package DV2' +
      ' (ARCHITECTURE.md 9); until then use `npm run dev` for the web app.',
  );
  process.exit(1);
}

const { createServer } = await import('vite');
const server = await createServer({ configFile: join(repo, 'app', 'vite.config.ts'), root: join(repo, 'app') });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) {
  console.error('desktop:dev: the Vite dev server did not report an address');
  await server.close();
  process.exit(1);
}
console.log(`desktop:dev: Vite dev server at ${url}; starting Electron`);

// Run npm the way this script was started (npm sets npm_execpath), so that no
// shell is needed on Windows.
const npmArgs = [
  'run',
  'dev',
  '--workspace',
  'desktop',
  ...(process.argv.length > 2 ? ['--', ...process.argv.slice(2)] : []),
];
const npmCli = process.env.npm_execpath;
const child =
  npmCli && /\.[cm]?js$/.test(npmCli)
    ? spawn(process.execPath, [npmCli, ...npmArgs], {
        cwd: repo,
        stdio: 'inherit',
        env: { ...process.env, EASY68K_DEV_SERVER_URL: url },
      })
    : spawn('npm', npmArgs, {
        cwd: repo,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, EASY68K_DEV_SERVER_URL: url },
      });

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('error', (error) => {
  console.error(`desktop:dev: could not start Electron: ${error.message}`);
  void stop(1);
});
child.on('exit', (code, signal) => void stop(code ?? (signal ? 1 : 0)));
