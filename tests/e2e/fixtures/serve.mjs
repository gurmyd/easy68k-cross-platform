// Serves a production build of the web application for the end-to-end tests (ARCHITECTURE.md 6.6).
// Owner: X1.
//
//   node tests/e2e/fixtures/serve.mjs --dist <folder> --port <n>
//
// Vite's preview server with the application's own configuration (app/vite.config.ts), so the
// pages get the same headers as `npm run preview`, the production Content Security Policy
// included. tests/playwright.config.ts starts it as its web server and stops it at the end.
// It runs until it is stopped.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '../../../app');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dist = resolve(option('--dist') ?? join(appDir, 'dist'));
const port = Number(option('--port') ?? '0');

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`serve.mjs: no production build in ${dist}`);
  process.exit(2);
}

const server = await preview({
  root: appDir,
  configFile: join(appDir, 'vite.config.ts'),
  logLevel: 'warn',
  build: { outDir: dist },
  preview: { host: '127.0.0.1', port, strictPort: port !== 0, open: false },
});
console.log(`serving ${dist} at ${server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`}`);

const stop = () => {
  server.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
