// Tests of the PWA build step (DV1): index.html tags, the precache list from the build output,
// sw.js, and the bundled worker serving a build's static file with the network off.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_DIR,
  HEAD_TAGS,
  SW_FILE,
  SW_META_NAME,
  THEME_COLOR,
  bundleServiceWorker,
  finishPwaBuild,
  listFiles,
  patchIndexHtml,
  precacheEntries,
  readServiceWorkerManifest,
  serviceWorkerText,
  sha256,
  urlOf,
  versionOf,
} from './pwa-build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '..', 'fixtures', 'offline-fixture.txt');
const PUBLIC = join(APP_DIR, 'public');

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'" />
    <title>EASy68K</title>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A small build output folder: index.html, assets with a source map, a help page, the fixture. */
function fakeBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dv1-pwa-'));
  folders.push(dir);
  const write = (path: string, data: string | Uint8Array) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), data);
  };
  write('index.html', INDEX);
  write('assets/index-abc.js', 'console.log(1)');
  write('assets/index-abc.js.map', '{}');
  write('assets/sim68k-xyz.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  write('help/Quick Reference.htm', '<p>quick</p>');
  mkdirSync(join(dir, 'check'), { recursive: true });
  copyFileSync(FIXTURE, join(dir, 'check', 'offline-fixture.txt'));
  return dir;
}

describe('index.html', () => {
  it('gets the manifest, icon, theme and worker tags before </head>, after the policy', () => {
    const html = patchIndexHtml(INDEX);
    for (const tag of HEAD_TAGS) expect(html).toContain(tag);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('rel="manifest"'));
    expect(html.indexOf(`name="${SW_META_NAME}"`)).toBeLessThan(html.indexOf('</head>'));
    expect(html).toContain(`<meta name="${SW_META_NAME}" content="${SW_FILE}" />`);
  });

  it('is patched once however often the step runs', () => {
    const once = patchIndexHtml(INDEX);
    expect(patchIndexHtml(once)).toBe(once);
  });

  it('refers only to files that exist in app/public, with relative URLs', () => {
    for (const tag of HEAD_TAGS) {
      const href = /href="([^"]+)"/.exec(tag)?.[1];
      if (!href) continue;
      expect(href.startsWith('/') || href.includes(':'), href).toBe(false);
      expect(listFiles(PUBLIC)).toContain(href);
    }
  });
});

describe('precache list', () => {
  it('lists every file of the build output except sw.js and source maps, sorted, with hashes', () => {
    const dir = fakeBuild();
    writeFileSync(join(dir, SW_FILE), 'old worker');
    const entries = precacheEntries(dir);
    expect(entries.map((entry) => entry.url)).toEqual([
      'assets/index-abc.js',
      'assets/sim68k-xyz.wasm',
      'check/offline-fixture.txt',
      'help/Quick%20Reference.htm',
      'index.html',
    ]);
    const fixture = readFileSync(FIXTURE);
    expect(entries[2]).toEqual({ url: 'check/offline-fixture.txt', size: fixture.byteLength, sha256: sha256(fixture) });
  });

  it('percent-encodes each segment of a path', () => {
    expect(urlOf('help/GNU General Public License.htm')).toBe('help/GNU%20General%20Public%20License.htm');
    expect(urlOf('a#b/c?d.txt')).toBe('a%23b/c%3Fd.txt');
  });

  it('changes the version when a file or the worker code changes', () => {
    const entries = [{ url: 'index.html', size: 1, sha256: 'aa' }];
    const other = [{ url: 'index.html', size: 1, sha256: 'bb' }];
    expect(versionOf('code', entries)).toMatch(/^[0-9a-f]{20}$/);
    expect(versionOf('code', entries)).toBe(versionOf('code', entries));
    expect(versionOf('code', other)).not.toBe(versionOf('code', entries));
    expect(versionOf('code2', entries)).not.toBe(versionOf('code', entries));
    const text = serviceWorkerText('void 0;', entries);
    expect(readServiceWorkerManifest(text)).toEqual({ version: versionOf('void 0;', entries), entries });
  });
});

describe('finishPwaBuild', () => {
  it('patches index.html, writes sw.js, and gives the same files when run again', async () => {
    const dir = fakeBuild();
    const report = await finishPwaBuild(dir, { code: 'void 0;' });
    expect(report.files).toBe(5);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const worker = readFileSync(join(dir, SW_FILE), 'utf8');
    const manifest = readServiceWorkerManifest(worker);
    expect(manifest.version).toBe(report.version);
    // The list holds the patched index.html, not the one Vite wrote.
    const index = manifest.entries.find((entry) => entry.url === 'index.html');
    expect(index?.sha256).toBe(sha256(html));
    await finishPwaBuild(dir, { code: 'void 0;' });
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    expect(readFileSync(join(dir, SW_FILE), 'utf8')).toBe(worker);
  });

  it('refuses a folder without a build', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dv1-empty-'));
    folders.push(dir);
    await expect(finishPwaBuild(dir, { code: '' })).rejects.toThrow(/index\.html does not exist/);
  });
});

describe('the web app manifest and the icons', () => {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    id: string;
    display: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };

  /** Width and height from a PNG's IHDR chunk. */
  const pngSize = (file: string) => {
    const bytes = readFileSync(file);
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  };

  it('is installable from any base path', () => {
    expect(manifest.name).toBe('EASy68K - unofficial web and macOS port');
    expect(manifest.short_name).toBe('EASy68K');
    expect([manifest.start_url, manifest.scope, manifest.id]).toEqual(['./', './', './']);
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe(THEME_COLOR);
  });

  it('names icons that exist, with their real sizes, including 192, 512 and a maskable one', () => {
    for (const icon of manifest.icons) {
      const file = join(PUBLIC, ...icon.src.split('/'));
      if (icon.type === 'image/png') expect(pngSize(file), icon.src).toBe(icon.sizes);
      else expect(readFileSync(file, 'utf8')).toMatch(/^<svg /);
    }
    const sizes = manifest.icons.filter((icon) => icon.purpose === 'any').map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512')).toBe(true);
    expect(pngSize(join(PUBLIC, 'icons', 'apple-touch-icon.png'))).toBe('180x180');
    expect(pngSize(join(PUBLIC, 'icons', 'icon-32.png'))).toBe('32x32');
  });
});

describe('the bundled worker', () => {
  it('is a classic script that, in a service worker, serves a static file of the build offline', async () => {
    const code = await bundleServiceWorker();
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    const dir = fakeBuild();
    await finishPwaBuild(dir, { code });
    const text = readFileSync(join(dir, SW_FILE), 'utf8');

    // A service worker scope: the build output served at /easy68k-mac/.
    const scopeUrl = 'https://example.test/easy68k-mac/';
    let online = true;
    const files = new Map(
      precacheEntries(dir).map((entry) => [
        new URL(entry.url, scopeUrl).href,
        readFileSync(join(dir, ...decodeURIComponent(entry.url).split('/'))),
      ]),
    );
    const caches = new Map<string, Map<string, Response>>();
    const cacheOf = (name: string) => {
      let cache = caches.get(name);
      if (!cache) caches.set(name, (cache = new Map()));
      const key = (request: Request | string) => (typeof request === 'string' ? request : request.url);
      return {
        match: async (request: Request | string) => cache.get(key(request))?.clone(),
        put: async (request: Request | string, response: Response) => {
          cache.set(key(request), new Response(await response.arrayBuffer(), response));
        },
      };
    };
    const listeners = new Map<string, (event: object) => void>();
    const sandbox: Record<string, unknown> = {
      ServiceWorkerGlobalScope: Object.defineProperty(function ServiceWorkerGlobalScope() {}, Symbol.hasInstance, {
        value: () => true,
      }),
      registration: { scope: scopeUrl },
      caches: {
        open: async (name: string) => cacheOf(name),
        keys: async () => [...caches.keys()],
        delete: async (name: string) => caches.delete(name),
      },
      clients: { matchAll: async () => [{ id: 'page' }] },
      crypto: globalThis.crypto,
      fetch: async (input: Request | string) => {
        if (!online) throw new TypeError('Failed to fetch');
        const bytes = files.get(typeof input === 'string' ? input : input.url);
        return bytes ? new Response(new Uint8Array(bytes)) : new Response('', { status: 404 });
      },
      skipWaiting: async () => {},
      addEventListener: (type: string, listener: (event: object) => void) => void listeners.set(type, listener),
      URL,
      Request,
      Response,
      Headers,
    };
    sandbox.self = sandbox;
    runInNewContext(text, sandbox);
    expect([...listeners.keys()].sort()).toEqual(['activate', 'fetch', 'install', 'message']);

    const run = async (type: string, event: object) => {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      await Promise.all(pending);
    };
    await run('install', {});
    await run('activate', {});
    online = false;
    let answer: Promise<Response> | undefined;
    await run('fetch', {
      request: new Request(`${scopeUrl}check/offline-fixture.txt`),
      clientId: 'page',
      resultingClientId: '',
      respondWith: (response: Promise<Response>) => void (answer = response),
    });
    expect(answer).toBeDefined();
    expect(await (await answer)?.text()).toBe(readFileSync(FIXTURE, 'utf8'));
  }, 60_000);
});
