// Browser check of offline use, installation and the Pages sub-path (ARCHITECTURE.md 9.4, DV1
// acceptance). Owner: DV1.
//
//   node app/src/features/pwa/check-pwa.mjs [--browser chromium|webkit|all] [--out <dir>] [--dist <dir>]
//
// It makes a production build of app/ with the base path /easy68k-cross-platform/ (vite build, the same
// command as pages.yml; or takes an existing one with --dist), checks that the build it made was
// already finished by pwaPlugin() in app/vite.config.ts, finishes its two copies (versions A and
// B) with the PWA build step, and serves them with its own static server under /easy68k-cross-platform/ only,
// with GitHub Pages' cache header. A fixture file of this package is added to the build before the step, so that "a static
// file of the build is available offline" does not depend on what app/public holds today. Then, in
// headless Chromium and WebKit (Playwright):
//
//   - first visit: the page, the manifest and its icons load; the service worker registers with the
//     sub-path as its scope and stores every file of the build's precache list, including the six
//     engine files of W4's loader, help, fonts and examples;
//   - network off (Playwright's offline mode, and the server refuses every connection and counts
//     attempts): a reload works; every precached file is served; both engines load, a program is
//     assembled and run; the page opens with ?open= too; no request reaches the server;
//   - a new deployment (the fixture changed): `A new version is available.` appears in both open
//     pages and nothing reloads by itself; `Reload` in one page loads the new version there, while
//     the other page keeps the files of its own version; once it is closed the old cache goes;
//   - installation: the manifest has a name, a start URL, standalone display and PNG icons of 192
//     and 512 pixels; in Chromium, the browser's own parse of the linked manifest (DevTools
//     protocol, Page.getAppManifest) has no critical error, standalone display and every icon -
//     the install prompt itself cannot be driven by Playwright;
//   - no Content Security Policy violation and no console error anywhere.
//
// A browser build without service workers runs the checks that need no worker and reports the
// others as skipped - on Windows only, where some WebKit builds have lacked them (the one of
// Playwright 1.65 has them). On macOS and Linux a missing worker is a failure.
//
// Screenshots go to <out> (default build/pwa-check, git-ignored). Exit code 0 = no check failed.

/* global console, document, window, navigator, caches, fetch, setTimeout, URL, WebAssembly, TextEncoder, MutationObserver -- the browser globals are used inside page.evaluate() callbacks, which run in the page */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { bundleServiceWorker, finishPwaBuild, readServiceWorkerManifest, summarize } from './build/pwa-build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'pwa-check')));
const givenDist = option('--dist', null);
mkdirSync(outDir, { recursive: true });

const BASE = '/easy68k-cross-platform/';
const FIXTURE_URL = 'check/offline-fixture.txt';
const FIXTURE = join(here, 'fixtures', 'offline-fixture.txt');
/** A help page with links out of the help folder (erratum H1 11); import-help would refuse it. */
const FRAME_GUARD_URL = 'help/check/frame-guard.htm';
const FRAME_GUARD = join(here, 'fixtures', 'frame-guard.htm');
const NOTICE = 'A new version is available.';
const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, skipped: false });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
function skip(name, reason) {
  results.push({ name, ok: true, skipped: true });
  console.log(`  skip ${name} - ${reason}`);
}

// --- the build --------------------------------------------------------------------------------

function productionBuild(target) {
  const require = createRequire(join(appRoot, 'package.json'));
  const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  console.log(`Production build with EASY68K_BASE=${BASE} into ${target}`);
  const run = spawnSync(process.execPath, [viteBin, 'build', '--outDir', target, '--logLevel', 'warn'], {
    cwd: appRoot,
    env: { ...process.env, EASY68K_BASE: BASE },
    stdio: 'inherit',
  });
  if (run.status !== 0) throw new Error(`vite build failed with exit code ${run.status}`);
}

/** Copies a build, adds the fixture with the given extra line, and finishes it. */
async function makeSite(dist, target, line, code) {
  rmSync(target, { recursive: true, force: true });
  cpSync(dist, target, { recursive: true });
  mkdirSync(join(target, 'check'), { recursive: true });
  writeFileSync(join(target, ...FIXTURE_URL.split('/')), `${readFileSync(FIXTURE, 'utf8')}${line}\n`);
  mkdirSync(join(target, 'help', 'check'), { recursive: true });
  cpSync(FRAME_GUARD, join(target, ...FRAME_GUARD_URL.split('/')));
  const report = await finishPwaBuild(target, { code });
  return { dir: target, report, manifest: readServiceWorkerManifest(readFileSync(join(target, 'sw.js'), 'utf8')) };
}

// --- the static server ------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
};

/** Serves `root` under BASE only, like a project site of GitHub Pages. */
function startServer() {
  const state = { root: '', down: false, attempts: [], requests: 0 };
  const server = createServer((request, response) => {
    if (state.down) {
      state.attempts.push(request.url);
      request.socket.destroy();
      return;
    }
    state.requests++;
    const url = new URL(request.url ?? '/', 'http://localhost');
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = url.pathname;
    }
    if (path === BASE.slice(0, -1)) {
      response.writeHead(301, { location: BASE });
      response.end();
      return;
    }
    if (!path.startsWith(BASE)) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('404: outside the site');
      return;
    }
    let file = normalize(join(state.root, path.slice(BASE.length)));
    if (!file.startsWith(state.root + sep) && file !== state.root) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('404');
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.byteLength,
      // GitHub Pages sends this; the worker must not take stale files from the HTTP cache.
      'cache-control': 'max-age=600',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveServer({ server, state, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

// --- page helpers -----------------------------------------------------------------------------

/** Collects violations of the policy from the first script on. */
function watchPolicy() {
  window.__dv1Violations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__dv1Violations.push(`${event.violatedDirective} ${event.blockedURI}`);
  });
}

async function openPage(context, url, errors) {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location()?.url ?? ''})`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url);
  await page.waitForSelector('.e68-shell', { timeout: 60_000 });
  return page;
}

/**
 * What a web app manifest lacks of the installation criteria that do not depend on the browser
 * (name, start URL, standalone display, PNG icons of 192 and 512 pixels).
 */
function installCriteriaMissing(manifest) {
  const missing = [];
  if (!manifest.name && !manifest.short_name) missing.push('name');
  if (!manifest.start_url) missing.push('start_url');
  if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display))
    missing.push(`display ${manifest.display}`);
  const sizes = new Set(
    (manifest.icons ?? [])
      .filter((icon) => icon.type === 'image/png' && (icon.purpose ?? 'any').split(/\s+/).includes('any'))
      .flatMap((icon) => String(icon.sizes ?? '').split(/\s+/)),
  );
  for (const size of ['192x192', '512x512']) if (!sizes.has(size)) missing.push(`PNG icon ${size}`);
  return missing;
}

/** Sets window.__dv1NoticeSeen once a toast with the given text appears in the page. */
function watchNotice(text) {
  window.__dv1NoticeSeen = false;
  const look = () => {
    const found = [...document.querySelectorAll('.e68-toast')].some((toast) => toast.textContent?.includes(text));
    if (found) window.__dv1NoticeSeen = true;
    return found;
  };
  if (look()) return;
  const observer = new MutationObserver(() => {
    if (look()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

const violations = (page) => page.evaluate(() => window.__dv1Violations ?? []);

/** Waits until the registration has an active worker in the state 'activated'. */
function waitActivated(page) {
  return page.evaluate(
    () =>
      new Promise((resolveWait, rejectWait) => {
        const started = Date.now();
        const poll = async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration?.active?.state === 'activated') return resolveWait(registration.scope);
          if (Date.now() - started > 120_000) return rejectWait(new Error('no activated worker after 120 s'));
          setTimeout(poll, 200);
        };
        void poll();
      }),
  );
}

const fetchText = (page, url) =>
  page.evaluate(async (target) => {
    const response = await fetch(target);
    return { status: response.status, text: await response.text() };
  }, url);

/** Fetches every entry from the page and compares sizes; returns the failures. */
const fetchAll = (page, base, entries) =>
  page.evaluate(
    async ({ base: root, list }) => {
      const failed = [];
      for (const entry of list) {
        try {
          const response = await fetch(new URL(entry.url, root).href);
          const size = (await response.arrayBuffer()).byteLength;
          if (response.status !== 200 || size !== entry.size) failed.push(`${entry.url} ${response.status} ${size}`);
        } catch (error) {
          failed.push(`${entry.url} ${String(error)}`);
        }
      }
      return failed;
    },
    { base, list: entries },
  );

/** Loads both engines from the page's own origin, assembles a program and runs it. */
const runEngines = (page, urls) =>
  page.evaluate(async (files) => {
    const compile = async (url) => WebAssembly.compile(await (await fetch(url)).arrayBuffer());
    const asm = await import(files.asmApi);
    await asm.initAssembler({ wasmModule: await compile(files.asmWasm), loaderUrl: files.asmLoader });
    const source = '    ORG    $1000\r\nSTART  MOVE.L #$12345678,D0\r\n    SIMHALT\r\n    END    START\r\n';
    const result = await asm.assemble(
      'offline.X68',
      new Map([['offline.X68', new TextEncoder().encode(source)]]),
      {},
      new Date(2026, 0, 1),
    );
    const sim = await import(files.simApi);
    const engine = await sim.createSim({}, { loaderUrl: files.simLoader, wasmModule: await compile(files.simWasm) });
    engine.load(result.sRecord);
    engine.cmdRun();
    let status = sim.Status.RUNNING;
    for (let i = 0; i < 100 && status === sim.Status.RUNNING; i++) status = engine.run(100_000);
    return { errors: result.errorCount, status, d0: engine.registers().d[0] };
  }, urls);

/** The six engine files of the precache list (docs/ENGINE-BINDING.md 2: hashed names in assets/). */
function engineFiles(entries, origin) {
  const find = (pattern) => entries.find((entry) => pattern.test(entry.url))?.url;
  const names = {
    asmApi: find(/^assets\/asm68k-[\w-]+\.mjs$/),
    asmLoader: find(/^assets\/asm68k-loader-[\w-]+\.mjs$/),
    asmWasm: find(/^assets\/asm68k-[\w-]+\.wasm$/),
    simApi: find(/^assets\/sim68k-[\w-]+\.mjs$/),
    simLoader: find(/^assets\/sim68k-loader-[\w-]+\.mjs$/),
    simWasm: find(/^assets\/sim68k-[\w-]+\.wasm$/),
  };
  // The loader also matches the API pattern; keep the API names free of "-loader-".
  if (names.asmApi?.includes('-loader-')) names.asmApi = find(/^assets\/asm68k-(?!loader-)[\w-]+\.mjs$/);
  if (names.simApi?.includes('-loader-')) names.simApi = find(/^assets\/sim68k-(?!loader-)[\w-]+\.mjs$/);
  const urls = Object.fromEntries(
    Object.entries(names).map(([key, url]) => [key, url ? `${origin}${BASE}${url}` : undefined]),
  );
  return { names, urls, complete: Object.values(names).every(Boolean) };
}

// --- the Help frame shows Help and nothing else (erratum H1 11) ---------------------------------

/** What the Help panel's frame shows, read from the page (the frame's document may be an error page). */
const helpFrameState = (page) =>
  page.evaluate(() => {
    const element = document.querySelector('[data-e68-panel="help"] iframe');
    if (!element) return null;
    let href;
    try {
      href = element.contentWindow?.location.href ?? null;
    } catch {
      href = '(not readable: an error page)';
    }
    const doc = element.contentDocument;
    return {
      sandbox: element.getAttribute('sandbox'),
      href,
      title: doc?.title ?? null,
      scripts: doc ? doc.querySelectorAll('script').length : 0,
      app: doc ? doc.querySelector('#root, .e68-shell, link[rel=manifest]') !== null : false,
      text: (doc?.body?.textContent ?? '').trim().slice(0, 60),
    };
  });

/**
 * A help page with links to the application's own page, clicked in the Help frame while the worker
 * controls the page (in WebKit the frame has allow-scripts then): the frame must not load the
 * application. A link to another help page must still work.
 */
async function frameGuardPass(p, page, base, errors) {
  const before = errors.length;
  await page
    .locator('.e68-shell__menubar .e68-menubar__title')
    .filter({ hasText: /^Help$/ })
    .click();
  const menu = page.locator('[role=menu][data-e68-menu]').last();
  await menu
    .locator(':scope > [role^=menuitem]')
    .filter({ has: page.locator('.e68-menu__caption', { hasText: /^Help$/ }) })
    .click();
  const frame = page.locator('[data-e68-panel="help"] iframe');
  await frame.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-e68-panel="help"] iframe')?.contentDocument?.title === 'Easy68k Introduction',
    undefined,
    { timeout: 30_000 },
  );
  const webkit = (await page.evaluate(() => navigator.vendor)) === 'Apple Computer, Inc.';
  const sandbox = await frame.getAttribute('sandbox');
  check(
    `${p} Help frame: allow-scripts only in WebKit under the worker (erratum H1 11)`,
    sandbox ===
      (webkit
        ? 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox'
        : 'allow-same-origin allow-popups allow-popups-to-escape-sandbox'),
    String(sandbox),
  );
  const show = async () => {
    await frame.evaluate((element, url) => element.contentWindow.location.replace(url), `${base}${FRAME_GUARD_URL}`);
    await page.waitForFunction(
      () => document.querySelector('[data-e68-panel="help"] iframe')?.contentDocument?.title === 'Frame guard',
      undefined,
      { timeout: 30_000 },
    );
  };
  const inner = page.frameLocator('[data-e68-panel="help"] iframe');
  for (const id of ['to-app', 'to-root']) {
    await show();
    await inner.locator(`#${id}`).click();
    // The navigation ends in an error page at once; give a page that would load (and boot) time to.
    await page.waitForTimeout(3000);
    const state = await helpFrameState(page);
    check(
      `${p} Help frame: a link to the application's page (${id}) does not load the application in the frame`,
      state !== null && !state.app && state.scripts === 0 && !/EASy68K/.test(state.title ?? ''),
      JSON.stringify(state),
    );
  }
  await show();
  await inner.locator('#to-help').click();
  await page
    .waitForFunction(
      () => document.querySelector('[data-e68-panel="help"] iframe')?.contentDocument?.title === 'Easy68k Introduction',
      undefined,
      { timeout: 30_000 },
    )
    .then(
      () => check(`${p} Help frame: a link to another help page still loads it`, true),
      async () =>
        check(
          `${p} Help frame: a link to another help page still loads it`,
          false,
          JSON.stringify(await helpFrameState(page)),
        ),
    );
  // The refused navigations are reported by the browser as failed loads; nothing else may be.
  const during = errors.splice(before);
  const unexpected = during.filter(
    (text) =>
      !/^Failed to load resource|net::ERR_FAILED|WebKit encountered an internal error|^Response served by service worker is an error|^Cannot load /i.test(
        text,
      ),
  );
  console.log(
    `        console messages of the refused frame navigations: ${during.length}${during.length ? ` (${[...new Set(during)].join(' | ')})` : ''}`,
  );
  errors.push(...unexpected);
  await page.locator('[data-e68-panel="help"]').getByRole('button', { name: 'Close Help' }).click();
}

// --- the pass of one browser ------------------------------------------------------------------

async function browserPass(name, serve, siteA, siteB) {
  const p = `${name}:`;
  const browser = await BROWSERS[name].launch();
  const errors = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1280, height: 800 } });
    await context.addInitScript(watchPolicy);
    serve.state.root = siteA.dir;
    const base = `${serve.origin}${BASE}`;

    // ---- first visit
    const page1 = await openPage(context, base, errors);
    check(`${p} the app starts under ${BASE}`, (await page1.title()).startsWith('EASy68K'), await page1.title());
    const manifestHref = await page1.evaluate(() => document.querySelector('link[rel=manifest]')?.href ?? null);
    check(`${p} index.html links the web app manifest`, manifestHref === `${base}manifest.webmanifest`, manifestHref);
    const manifest = await page1.evaluate(async (href) => (await fetch(href)).json(), manifestHref);
    const icons = await page1.evaluate(
      async ({ href, list }) =>
        Promise.all(
          list.map(async (icon) => {
            const response = await fetch(new URL(icon.src, href));
            return `${icon.src} ${response.status} ${response.headers.get('content-type')}`;
          }),
        ),
      { href: manifestHref, list: manifest.icons },
    );
    check(
      `${p} the manifest's icons load`,
      icons.length >= 4 && icons.every((line) => / 200 image\//.test(line)),
      icons.join(', '),
    );
    const missing = installCriteriaMissing(manifest);
    check(`${p} the manifest has what installation needs`, missing.length === 0, missing.join('; '));

    const hasWorkers = await page1.evaluate(() => 'serviceWorker' in navigator);
    if (!hasWorkers) {
      const reason = `${name} on ${process.platform} has no navigator.serviceWorker`;
      if (process.platform === 'win32') {
        console.log(`  note ${reason}: the offline and update checks need a worker and are skipped here`);
        for (const item of ['worker registers', 'offline reload', 'engines offline', 'update notice']) {
          skip(`${p} ${item}`, reason);
        }
      } else {
        check(`${p} service workers are available`, false, reason);
      }
      check(`${p} no Content Security Policy violation`, (await violations(page1)).length === 0);
      check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await page1.screenshot({ path: join(outDir, `${name}-online.png`) });
      await context.close();
      return;
    }

    const scope = await waitActivated(page1).catch((error) => `error: ${error.message}`);
    check(`${p} the worker is activated with the sub-path as its scope`, scope === base, String(scope));
    const entries = siteA.manifest.entries;
    const cached = await page1.evaluate(async (version) => {
      const names = await caches.keys();
      const cache = await caches.open(`easy68k-v-${version}`);
      return { names, count: (await cache.keys()).length };
    }, siteA.manifest.version);
    check(
      `${p} every file of the precache list is stored (${entries.length})`,
      cached.count === entries.length && cached.names.includes(`easy68k-v-${siteA.manifest.version}`),
      `${cached.count} stored, caches ${cached.names.join(', ')}`,
    );
    const engines = engineFiles(entries, serve.origin);
    check(
      `${p} the precache list holds the six engine files`,
      engines.complete,
      Object.values(engines.names).join(', '),
    );
    const folders = ['help/', 'fonts/', 'examples/'].map(
      (folder) => `${folder} ${entries.filter((entry) => entry.url.startsWith(folder)).length}`,
    );
    console.log(`        precached per folder: ${folders.join(', ')}`);
    check(
      `${p} the first page is not taken over by the worker (it keeps the files it loaded)`,
      (await page1.evaluate(() => navigator.serviceWorker.controller)) === null,
    );
    await page1.screenshot({ path: join(outDir, `${name}-online.png`) });

    // ---- network off
    serve.state.down = true;
    serve.state.attempts = [];
    await context.setOffline(true);
    await page1.reload();
    await page1.waitForSelector('.e68-shell', { timeout: 60_000 });
    check(`${p} offline: a reload works`, (await page1.title()).startsWith('EASy68K'));
    check(
      `${p} offline: the reloaded page is served by the worker`,
      (await page1.evaluate(() => navigator.serviceWorker.controller !== null)) === true,
    );
    const failed = await fetchAll(page1, base, entries);
    check(
      `${p} offline: all ${entries.length} precached files are served with their sizes`,
      failed.length === 0,
      failed.slice(0, 5).join('; '),
    );
    const fixture = await fetchText(page1, `${base}${FIXTURE_URL}`);
    check(
      `${p} offline: the fixture file of the build is served`,
      fixture.status === 200 && fixture.text.endsWith('version A\n'),
      `${fixture.status}`,
    );
    for (const [folder, sample] of [
      ['help', entries.find((entry) => entry.url.startsWith('help/') && entry.url.endsWith('.htm'))],
      ['fonts', entries.find((entry) => entry.url.startsWith('fonts/'))],
      ['examples', entries.find((entry) => entry.url.startsWith('examples/'))],
    ]) {
      if (!sample) {
        console.log(`  note the build contains no ${folder}/ file today`);
        continue;
      }
      const response = await fetchText(page1, `${base}${sample.url}`);
      check(
        `${p} offline: ${folder} (${decodeURIComponent(sample.url)})`,
        response.status === 200,
        `${response.status}`,
      );
    }
    if (engines.complete) {
      const run = await runEngines(page1, engines.urls).catch((error) => ({ error: String(error) }));
      check(
        `${p} offline: both engines load, assemble and run a program`,
        run.errors === 0 && run.status === 1 && run.d0 === 0x12345678,
        JSON.stringify(run),
      );
    }
    const opened = await openPage(context, `${base}?open=/browser/demo.X68`, errors);
    check(`${p} offline: the page opens with ?open=`, (await opened.title()).startsWith('EASy68K'));
    await opened.screenshot({ path: join(outDir, `${name}-offline.png`) });
    await opened.close();
    // The browser's own update check of the worker script is not covered by Playwright's offline
    // mode (it reached the refusing server in Chromium); it fails as it would offline, harmlessly.
    const other = serve.state.attempts.filter((url) => url !== `${BASE}sw.js`);
    check(`${p} offline: no request of the page reached the server`, other.length === 0, other.join(', '));
    console.log(`        update checks of sw.js refused while offline: ${serve.state.attempts.length - other.length}`);
    await context.setOffline(false);
    serve.state.down = false;

    // ---- the Help frame shows Help and nothing else (page 1 is controlled by the worker now)
    await frameGuardPass(p, page1, base, errors);

    // ---- installation: the manifest as Chromium itself parsed it (DevTools protocol). The install
    // prompt cannot be driven, and Page.getInstallabilityErrors answers [] in headless Chromium
    // even for a page without a manifest, so it proves nothing and is not used.
    if (name === 'chromium') {
      const cdp = await context.newCDPSession(page1);
      const parsed = await cdp.send('Page.getAppManifest').catch((error) => ({ error: String(error) }));
      const manifestErrors = (parsed.errors ?? []).filter((item) => item.critical);
      const seen = parsed.manifest ?? {};
      const iconCount = Array.isArray(seen.icons) ? seen.icons.length : 0;
      check(
        `${p} Chromium parses the linked manifest without critical errors, standalone, with its icons`,
        !parsed.error &&
          parsed.url === manifestHref &&
          manifestErrors.length === 0 &&
          seen.display === 'kStandalone' &&
          iconCount === manifest.icons.length &&
          seen.startUrl === base,
        parsed.error ??
          `url ${parsed.url}, display ${seen.display}, start ${seen.startUrl}, ${iconCount} icons` +
            `${manifestErrors.length ? `, errors: ${manifestErrors.map((item) => item.message).join('; ')}` : ''}`,
      );
      await cdp.detach();
    }

    // ---- a new deployment
    const page2 = await openPage(context, base, errors);
    await page1.evaluate(() => {
      window.__dv1Marker = 'page1';
    });
    await page2.evaluate(() => {
      window.__dv1Marker = 'page2';
    });
    // Each page records the notice's appearance itself, and the pointer is put on page 1's notice
    // as soon as it is there. Since gate I1 the notice stays until it is answered (duration 0,
    // docs/requests/DV1-toast-duration.md), which page 2 shows below; page 1 keeps the pointer
    // anyway, so that its steps do not depend on that.
    for (const page of [page1, page2]) await page.evaluate(watchNotice, NOTICE);
    serve.state.root = siteB.dir;
    await page1.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    const noticeIn = (page) =>
      page
        .waitForFunction(() => window.__dv1NoticeSeen === true, undefined, { timeout: 90_000 })
        .then(
          () => true,
          () => false,
        );
    const notice1 = page1.locator('.e68-toast', { hasText: NOTICE }).first();
    let seen2At = 0;
    const [seen1, seen2] = await Promise.all([
      noticeIn(page1).then(async (seen) => {
        if (seen) await notice1.hover({ timeout: 10_000 }).catch(() => {});
        return seen;
      }),
      noticeIn(page2).then((seen) => {
        seen2At = Date.now();
        return seen;
      }),
    ]);
    check(`${p} update: page 1 shows "${NOTICE}"`, seen1);
    check(`${p} update: page 2 shows it too`, seen2);
    await page1.waitForTimeout(1000); // the toast's entry animation
    await page1.screenshot({ path: join(outDir, `${name}-update-notice.png`) });
    await page1.waitForTimeout(5000);
    const markers = [await page1.evaluate(() => window.__dv1Marker), await page2.evaluate(() => window.__dv1Marker)];
    check(`${p} update: neither page reloads by itself`, markers.join() === 'page1,page2', markers.join());
    const stillA = await fetchText(page1, `${base}${FIXTURE_URL}`);
    check(`${p} update: until Reload, page 1 keeps version A`, stillA.text.endsWith('version A\n'));

    const reloaded = page1.waitForEvent('load', { timeout: 60_000 });
    await notice1.getByRole('button', { name: 'Reload' }).click({ timeout: 30_000 });
    await reloaded;
    await page1.waitForSelector('.e68-shell', { timeout: 60_000 });
    const afterReload = await fetchText(page1, `${base}${FIXTURE_URL}`);
    check(
      `${p} update: Reload loads version B in page 1`,
      (await page1.evaluate(() => window.__dv1Marker)) === undefined && afterReload.text.endsWith('version B\n'),
    );
    const page2After = await fetchText(page2, `${base}${FIXTURE_URL}`);
    check(
      `${p} update: page 2 is not reloaded and keeps the files of version A`,
      (await page2.evaluate(() => window.__dv1Marker)) === 'page2' && page2After.text.endsWith('version A\n'),
      page2After.text.trim().split('\n').pop(),
    );
    // Page 2's notice has had neither the pointer nor the focus. A toast of the kit's default
    // duration would have closed after 8 s; the update notice must still be there.
    const sinceNotice = Date.now() - seen2At;
    if (sinceNotice < 10_000) await page2.waitForTimeout(10_000 - sinceNotice);
    const lasting = await page2.locator('.e68-toast', { hasText: NOTICE }).count();
    check(
      `${p} update: page 2's notice is still there after 10 s without the pointer (it stays until answered)`,
      seen2 && lasting === 1,
      `${lasting} notice(s) after ${Math.round((Date.now() - seen2At) / 1000)} s`,
    );
    await page2.screenshot({ path: join(outDir, `${name}-update-notice-lasting.png`) });
    await page2.close();
    // A page is forgotten 10 s after it was recorded at the earliest (CLIENT_GRACE_MS in sw.ts).
    await page1.waitForTimeout(11_000);
    await page1.reload();
    await page1.waitForSelector('.e68-shell', { timeout: 60_000 });
    const left = await page1.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith('easy68k-v-')));
    check(
      `${p} update: once page 2 is closed only the new version's cache is left`,
      left.length === 1 && left[0] === `easy68k-v-${siteB.manifest.version}`,
      left.join(', '),
    );

    const policy = [...(await violations(page1))];
    check(`${p} no Content Security Policy violation`, policy.length === 0, policy.slice(0, 3).join(' | '));
    check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  } finally {
    await browser.close();
  }
}

// --- run --------------------------------------------------------------------------------------

async function main() {
  let dist = givenDist ? resolve(givenDist) : join(outDir, 'dist');
  if (!givenDist) productionBuild(dist);
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist} holds no build`);
  dist = resolve(dist);
  // Every production build is finished by the Vite configuration itself (pwaPlugin() in
  // app/vite.config.ts since gate I1), before this check finishes its copies once more.
  if (!givenDist) {
    const builtHtml = readFileSync(join(dist, 'index.html'), 'utf8');
    check(
      'build: vite build alone writes sw.js and the worker and manifest tags (pwaPlugin)',
      existsSync(join(dist, 'sw.js')) &&
        builtHtml.includes('name="easy68k-service-worker"') &&
        builtHtml.includes('rel="manifest"'),
    );
  }

  const code = await bundleServiceWorker();
  const siteA = await makeSite(dist, join(outDir, 'site-a'), 'version A', code);
  const siteB = await makeSite(dist, join(outDir, 'site-b'), 'version B', code);
  console.log(summarize(siteA.report));

  const serve = await startServer();
  console.log(`Site: ${serve.origin}${BASE}\nScreenshots: ${outDir}`);
  serve.state.root = siteA.dir;
  try {
    // The sub-path is the only place the site exists.
    const root = await fetch(`${serve.origin}/`);
    check('server: nothing is served outside the sub-path', root.status === 404, `${root.status}`);
    const html = await (await fetch(`${serve.origin}${BASE}`)).text();
    check(
      'build: index.html refers to its files under the sub-path',
      html.includes(`src="${BASE}assets/`) && html.includes('name="easy68k-service-worker"'),
    );
    for (const name of browsers) {
      console.log(`\n[${name}]`);
      await browserPass(name, serve, siteA, siteB);
    }
  } finally {
    serve.server.closeAllConnections?.();
    await new Promise((done) => serve.server.close(done));
  }

  const counted = results.filter((r) => !r.skipped);
  const passed = counted.filter((r) => r.ok).length;
  const skipped = results.length - counted.length;
  console.log(
    `\n${passed} of ${counted.length} checks passed${failures ? `, ${failures} failed` : ''}` +
      `${skipped ? `; ${skipped} skipped (no service worker in this browser build)` : ''}.`,
  );
  process.exit(failures ? 1 : 0);
}

await main();
