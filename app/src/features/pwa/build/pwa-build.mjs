// Build step of the offline web app (ARCHITECTURE.md 1.1, 7.5). Owner: DV1.
//
// Runs on a finished production build of app/ (the folder Vite wrote) and:
//
//   1. adds to index.html the web app manifest, the icons, the theme colour and a
//      <meta name="easy68k-service-worker" content="sw.js"> that tells features/pwa to register the
//      worker (no meta, no worker: the development server and a build without this step have none);
//   2. lists every file of the build output except sw.js and source maps, with size and SHA-256 -
//      the precache list is produced from what the build really contains, never written by hand;
//   3. bundles app/src/sw.ts into one classic script with Vite and writes it to sw.js, preceded by
//      `self.__EASY68K_BUILD__ = { version, entries };`. The version is a hash of the list and of
//      the worker's code, so every deployment that changes a file changes sw.js, and the browser
//      installs the new version.
//
// The step is idempotent: running it again on the same folder gives the same files. That matters
// because it runs in two ways:
//
//   - `node app/src/features/pwa/build/finish-build.mjs <outDir>` after `vite build` (pages.yml,
//     and check-pwa.mjs), as long as the Vite configuration does not include it;
//   - `pwaPlugin()` in app/vite.config.ts, at the end of every production build, once the
//     integration gate has applied docs/requests/DV1-vite-plugin.md.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** app/ */
export const APP_DIR = resolve(here, '../../../..');
/** The worker's source. */
export const SW_SOURCE = join(APP_DIR, 'src', 'sw.ts');
/** The worker's file in the build output; its folder is the worker's scope. */
export const SW_FILE = 'sw.js';
/** The meta tag that tells the page where the worker is. */
export const SW_META_NAME = 'easy68k-service-worker';
/** Colour of the browser's title bar for the installed app: the accent of the light theme. */
export const THEME_COLOR = '#0b63ce';

/** The tags added before </head>. Relative URLs: they work at any base path. */
export const HEAD_TAGS = [
  '<link rel="manifest" href="manifest.webmanifest" />',
  '<link rel="icon" href="icons/icon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="icons/icon-32.png" sizes="32x32" type="image/png" />',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />',
  `<meta name="theme-color" content="${THEME_COLOR}" />`,
  `<meta name="${SW_META_NAME}" content="${SW_FILE}" />`,
];

/** Files of the build output that are not stored for offline use. */
export function isPrecached(path) {
  return path !== SW_FILE && !path.endsWith('.map');
}

/** Every file below `dir`, as sorted paths with `/`, relative to `dir`. */
export function listFiles(dir) {
  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  // Sorted by code unit, not by locale, so that the list is the same on every machine.
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A relative path as a URL path: every segment percent-encoded. */
export function urlOf(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** The precache list of a build output folder. */
export function precacheEntries(outDir) {
  return listFiles(outDir)
    .filter(isPrecached)
    .map((path) => {
      const bytes = readFileSync(join(outDir, path));
      return { url: urlOf(path), size: bytes.byteLength, sha256: sha256(bytes) };
    });
}

/** index.html with the tags of HEAD_TAGS; unchanged when they are already there. */
export function patchIndexHtml(html) {
  if (html.includes(`name="${SW_META_NAME}"`)) return html;
  const end = html.search(/<\/head>/i);
  if (end < 0) throw new Error('pwa-build: index.html has no </head>');
  const tags = HEAD_TAGS.map((tag) => `    ${tag}\n`).join('');
  return `${html.slice(0, end).replace(/[ \t]*$/, '')}${tags}  ${html.slice(end)}`;
}

/** The version of a build: a hash of the worker's code and of the precache list. */
export function versionOf(code, entries) {
  return sha256(`${code}\n${JSON.stringify(entries)}`).slice(0, 20);
}

/** The text of sw.js. */
export function serviceWorkerText(code, entries) {
  const manifest = { version: versionOf(code, entries), entries };
  return `self.__EASY68K_BUILD__ = ${JSON.stringify(manifest)};\n${code}`;
}

/** Reads the manifest back from the text of sw.js (for checks). */
export function readServiceWorkerManifest(text) {
  const match = /^self\.__EASY68K_BUILD__ = (.*);\n/.exec(text);
  if (!match) throw new Error('pwa-build: sw.js does not start with the build manifest');
  return JSON.parse(match[1]);
}

/** app/src/sw.ts bundled into one classic script (no import, no export statement). */
export async function bundleServiceWorker() {
  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    root: APP_DIR,
    publicDir: false,
    logLevel: 'warn',
    build: {
      write: false,
      emptyOutDir: false,
      sourcemap: false,
      minify: true,
      target: 'es2022',
      lib: { entry: SW_SOURCE, formats: ['iife'], name: 'easy68kServiceWorker', fileName: () => SW_FILE },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output ?? []);
  const chunk = outputs.find((item) => item.type === 'chunk');
  if (!chunk) throw new Error('pwa-build: bundling app/src/sw.ts produced no script');
  if (/^\s*(?:import|export)\s/m.test(chunk.code)) {
    throw new Error('pwa-build: the bundled service worker still contains an import or export statement');
  }
  return chunk.code;
}

/**
 * Finishes a production build in `outDir` for offline use. Returns what it did, for the log.
 * @param {string} outDir
 * @param {{ code?: string }} [options] `code`: the bundled worker, when the caller has it already
 */
export async function finishPwaBuild(outDir, options = {}) {
  const dir = resolve(outDir);
  const indexFile = join(dir, 'index.html');
  if (!statSync(indexFile, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`pwa-build: ${indexFile} does not exist; run the production build first`);
  }
  const html = readFileSync(indexFile, 'utf8');
  const patched = patchIndexHtml(html);
  if (patched !== html) writeFileSync(indexFile, patched);

  const entries = precacheEntries(dir);
  const code = options.code ?? (await bundleServiceWorker());
  const text = serviceWorkerText(code, entries);
  writeFileSync(join(dir, SW_FILE), text);

  const manifest = readServiceWorkerManifest(text);
  return {
    version: manifest.version,
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    serviceWorkerBytes: Buffer.byteLength(text),
    entries,
  };
}

/** A one-line summary per top-level folder, for logs. */
export function summarize(report) {
  const groups = new Map();
  for (const entry of report.entries) {
    const top = entry.url.includes('/') ? `${decodeURIComponent(entry.url.split('/')[0])}/` : '(root)';
    const group = groups.get(top) ?? { files: 0, bytes: 0 };
    group.files++;
    group.bytes += entry.size;
    groups.set(top, group);
  }
  const lines = [...groups].map(
    ([name, g]) => `  ${name.padEnd(12)} ${String(g.files).padStart(5)} files ${g.bytes} bytes`,
  );
  return [
    `service worker version ${report.version}: ${report.files} files, ${report.bytes} bytes precached; sw.js ${report.serviceWorkerBytes} bytes`,
    ...lines,
  ].join('\n');
}

/**
 * The same step as a Vite plugin, for app/vite.config.ts (docs/requests/DV1-vite-plugin.md):
 * after every production build, the output folder is finished as above.
 * @returns {import('vite').Plugin}
 */
export function pwaPlugin() {
  let outDir = '';
  let failed = false;
  return {
    name: 'easy68k-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    buildEnd(error) {
      if (error) failed = true;
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler(error) {
        // The bundler calls closeBundle after a failed build too. There is no output to finish
        // then, and throwing here would hide the build's own error behind this plugin's.
        if (failed || error) return;
        const report = await finishPwaBuild(outDir);
        this.info?.(summarize(report).split('\n')[0]);
      },
    },
  };
}
