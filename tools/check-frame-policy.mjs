// Browser check of the two frames of the application under the production policy, with the service
// worker controlling the page (ARCHITECTURE-PLUS P3.4.2 and its CSP paragraph; ARCHITECTURE.md 7.5,
// 7.6; errata H1 11). Owner: N0 (the policy: tools/vite-csp-plugin.mjs and desktop/src/security.ts).
//
//   node tools/check-frame-policy.mjs [--browser chromium|webkit|all] [--out <dir>] [--dist <dir>]
//
// Two decisions meet in the frames, and this check proves that they hold together:
//   - the stage's `frame-src 'self' blob:`, so that the viewer can show a PDF in a frame whose
//     source is its own blob: URL (P3.4.2);
//   - main's service worker rule: a frame navigation is answered only with a page of the help
//     folder from the worker's own cache, never from the network (sw.ts, erratum H1 11).
//
// It makes a production build of app/ under the Pages sub-path /easy68k-cross-platform/ (vite build,
// as pages.yml does; or takes one with --dist) and checks, without a browser:
//   - the built index.html carries exactly one policy tag, before every script and stylesheet, and
//     its policy is exactly that of ARCHITECTURE.md 7.6 with `frame-src 'self'` widened to
//     `frame-src 'self' blob:` (nothing else added, removed or reordered);
//   - the same policy is the one of tools/vite-csp-plugin.mjs and the header of the desktop app
//     (CONTENT_SECURITY_POLICY of desktop/src/security.ts, read from its source: tests/desktop/dev
//     security.spec.ts proves that the running app sends that constant as the header of index.html).
// Then, in headless Chromium (Playwright's full build, which has the PDF viewer) and WebKit, served
// by its own server that decodes the path as GitHub Pages does:
//   - the worker activates and controls the page after a reload; the network is then switched off
//     (Playwright's offline mode, and the server refuses every connection and counts attempts);
//   - offline: Help > Help shows the introduction page in the Help panel's frame;
//   - offline: a PDF and a PNG dropped on the window open in the viewer: the PDF in a frame whose
//     source is a blob: of type application/pdf (in Chromium the PDF viewer's element is inside it),
//     the picture drawn;
//   - nothing else can be brought into either frame: each frame is navigated (as a link in it would)
//     to the application's page, its ?open= address, a help address with an encoded escape, a data:
//     HTML document, another site, and a blob: HTML document with an inline script that the page
//     made itself; none shows the application, none runs a script, nothing of an address below the
//     worker's scope reaches the server. An HTML file with a script saved as x.pdf runs nothing;
//   - no Content Security Policy violation except those the check provokes on purpose (data: and
//     the other site in a frame), and no console error except the refused loads;
//   - without a worker (a first visit; the desktop app has none): the PDF frame sent to the
//     application's page and its ?open= address shows its document again within 2 s and keeps no
//     copy of the application (decision D-c, errata N6 14); a picture's viewer has no frame.
// Screenshots (both themes) go to <out> (default build/frame-policy-check, git-ignored). Prints
// "N of M checks passed"; exit code 0 only if every check passed.

/* global document, window, DataTransfer, DragEvent, HTMLImageElement */

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { CONTENT_SECURITY_POLICY, META_TAG } from './vite-csp-plugin.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const appRoot = join(repoRoot, 'app');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'frame-policy-check')));
const givenDist = option('--dist', null);
mkdirSync(outDir, { recursive: true });

const BASE = '/easy68k-cross-platform/';
const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
/** CI has Playwright's full Chromium (npx playwright install chromium): its PDF checks must run there. */
const requireFullChromium = process.env.CI === 'true' || process.env.EASY68K_REQUIRE_BROWSERS === '1';

/** The policy of ARCHITECTURE.md 7.6, word for word. */
const POLICY_7_6 =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self' " +
  "https://api.github.com; worker-src 'self'; frame-src 'self'; manifest-src 'self'; base-uri 'none'; " +
  "form-action 'none'";
/** The one change of ARCHITECTURE-PLUS P3.4.2 ("frame-src 'self' becomes frame-src 'self' blob:"). */
const EXPECTED_POLICY = POLICY_7_6.replace("frame-src 'self';", "frame-src 'self' blob:;");

const SCRIPT_KEY = 'frame-policy-script-ran';
/** An HTML document whose script, if it ever ran, would leave a trace in localStorage. */
const EVIL_HTML = [
  '<!doctype html><html><head><title>evil</title></head><body><h1>not a PDF</h1>',
  `<script>try{localStorage.setItem('${SCRIPT_KEY}','inline')}catch(e){}</script>`,
  `<img src="x" onerror="try{localStorage.setItem('${SCRIPT_KEY}','onerror')}catch(e){}">`,
  '</body></html>',
].join('');
const HELP_TITLE = 'Easy68k Introduction';

let failures = 0;
let total = 0;
function check(name, ok, detail = '') {
  total++;
  if (!ok) failures++;
  const text = String(detail).slice(0, 500);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${text ? ` - ${text}` : ''}`);
}
function note(text) {
  console.log(`  note ${text}`);
}

// ---- the policy, without a browser -------------------------------------------------------------

/** CONTENT_SECURITY_POLICY of desktop/src/security.ts, read from its source (Node cannot run that file). */
function desktopPolicy() {
  const source = readFileSync(join(repoRoot, 'desktop', 'src', 'security.ts'), 'utf8');
  const block = /export const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join\('; '\);/.exec(source);
  if (!block) return null;
  const items = [...block[1].matchAll(/^\s*"([^"]*)",?\s*$/gm)].map((match) => match[1]);
  return items.join('; ');
}

function staticChecks(dist) {
  check(
    "policy: tools/vite-csp-plugin.mjs gives 7.6's policy with frame-src 'self' blob: and nothing else changed",
    CONTENT_SECURITY_POLICY === EXPECTED_POLICY,
    CONTENT_SECURITY_POLICY,
  );
  const desktop = desktopPolicy();
  check(
    "policy: the desktop app's header (desktop/src/security.ts) is the same policy",
    desktop === EXPECTED_POLICY,
    String(desktop),
  );
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)];
  check(
    'build: index.html carries exactly one policy tag, and it is that policy',
    tags.length === 1 && tags[0][1] === EXPECTED_POLICY && html.includes(META_TAG),
    tags.map((tag) => tag[1]).join(' || '),
  );
  const tag = html.indexOf(META_TAG);
  const first = html.search(/<script\b|<link\b/i);
  check('build: the policy tag precedes every script and stylesheet', tag >= 0 && (first < 0 || tag < first));
  check('build: the build has its service worker (sw.js)', existsSync(join(dist, 'sw.js')));
}

// ---- the build and the server ------------------------------------------------------------------

function productionBuild(target) {
  const require = createRequire(join(appRoot, 'package.json'));
  const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  console.log(`Production build with EASY68K_BASE=${BASE} into ${target}`);
  rmSync(target, { recursive: true, force: true });
  const run = spawnSync(process.execPath, [viteBin, 'build', '--outDir', target, '--logLevel', 'warn'], {
    cwd: appRoot,
    env: { ...process.env, EASY68K_BASE: BASE },
    stdio: 'inherit',
  });
  if (run.status !== 0) throw new Error(`vite build failed with exit code ${run.status}`);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

/** Serves `root` under BASE only, decoding the path as GitHub Pages does (%2F is a slash there). */
function startServer(root) {
  const state = { down: false, attempts: [], log: [] };
  const server = createServer((request, response) => {
    if (state.down) {
      state.attempts.push(request.url ?? '');
      request.socket.destroy();
      return;
    }
    state.log.push(request.url ?? '');
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
    let file = normalize(join(root, path.slice(BASE.length)));
    if (!file.startsWith(root + sep) && file !== root) {
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
      'cache-control': 'max-age=600',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ server, state, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// ---- files -------------------------------------------------------------------------------------

/** A one-page PDF (the construction of N0's spike, docs/requests/N0.md 5.4). */
function pdfBytes(label) {
  const t = `BT /F1 36 Tf 72 700 Td (${label}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${t.length} >>\nstream\n${t}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return [...Buffer.from(pdf, 'latin1')];
}

/** A 2x2 PNG, made in the page (a canvas), so that no binary file is needed. */
const makePng = (page) =>
  page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 200;
    const g = canvas.getContext('2d');
    g.fillStyle = '#2b6cb0';
    g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#f6e05e';
    g.fillRect(80, 50, 160, 100);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });

// ---- page helpers ------------------------------------------------------------------------------

/** Records policy violations and the blob: URLs the page makes, from the first script on. */
function watchPage() {
  window.__framePolicy = { violations: [], blobs: [] };
  document.addEventListener('securitypolicyviolation', (event) => {
    window.__framePolicy.violations.push(`${event.violatedDirective} ${event.blockedURI}`);
  });
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = create(object);
    window.__framePolicy.blobs.push({ url, type: object?.type ?? null, size: object?.size ?? -1 });
    return url;
  };
}
/** The violations recorded since the last call (they are taken out of the record). */
const takeViolations = (page) => page.evaluate(() => window.__framePolicy?.violations.splice(0) ?? []);
const blobOf = (page, url) =>
  page.evaluate((src) => window.__framePolicy?.blobs.find((b) => b.url === src) ?? null, url);
const scriptTrace = (page) => page.evaluate((key) => localStorage.getItem(key), SCRIPT_KEY);

/** Console messages that a refused frame navigation or a refused load causes; nothing else may appear. */
const REFUSED =
  /^Failed to load resource|net::ERR_|WebKit encountered an internal error|^Response served by service worker is an error|^Cannot load |^Blocked script execution|^Refused to (frame|load|execute|run)|Content Security Policy|^Not allowed to load local resource|sandboxed and the 'allow-scripts' permission is not set|Unsafe attempt to load URL|^Framing '.*' violates/i;

function collectErrors(page, errors) {
  page.on('console', (message) => {
    const where = message.location()?.url ?? '';
    // Chromium's PDF viewer asks the origin for /favicon.ico; the application never does.
    if (/\/favicon\.ico$/.test(where)) return;
    if (message.type() === 'error') errors.push(`${message.text()}${where ? ` (${where})` : ''}`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));
}

/** Waits until the registration has an active worker in the state 'activated'. */
const waitActivated = (page) =>
  page.evaluate(
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

/** Help > Help through the menu bar, as a person does; waits for the introduction page. */
async function openHelp(page) {
  await page
    .locator('.e68-shell__menubar .e68-menubar__title')
    .filter({ hasText: /^Help$/ })
    .click();
  const menu = page.locator('[role=menu][data-e68-menu]').last();
  await menu
    .locator(':scope > [role^=menuitem]')
    .filter({ has: page.locator('.e68-menu__caption', { hasText: /^Help$/ }) })
    .click();
  await page.locator('[data-e68-panel="help"] iframe').waitFor({ timeout: 30_000 });
  return page
    .waitForFunction(
      (title) => document.querySelector('[data-e68-panel="help"] iframe')?.contentDocument?.title === title,
      HELP_TITLE,
      { timeout: 30_000 },
    )
    .then(
      () => true,
      () => false,
    );
}

/** Drops files on the window, as a person drags them from the desktop. */
const dropFiles = (page, files) =>
  page.evaluate((list) => {
    const dt = new DataTransfer();
    for (const { name, bytes, type } of list) dt.items.add(new File([Uint8Array.from(bytes)], name, { type }));
    const target = document.querySelector('[data-e68-panel="editor"]') ?? document.body;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);

/** What a frame (found by `selector`) shows, read from the page; an error page may not be readable. */
const frameState = (page, selector) =>
  page.evaluate((css) => {
    const element = document.querySelector(css);
    if (!element) return null;
    let href;
    try {
      href = element.contentWindow?.location.href ?? null;
    } catch {
      href = '(not readable)';
    }
    let doc;
    try {
      doc = element.contentDocument;
    } catch {
      doc = null;
    }
    return {
      href,
      title: doc?.title ?? null,
      contentType: doc?.contentType ?? null,
      scripts: doc ? doc.querySelectorAll('script').length : 0,
      app: doc ? doc.querySelector('#root, .e68-shell, link[rel=manifest]') !== null : false,
      global: Boolean(
        element.contentWindow &&
        (() => {
          try {
            return (
              element.contentWindow.__easy68k !== undefined ||
              element.contentWindow.document.querySelector('.e68-shell') !== null
            );
          } catch {
            return false;
          }
        })(),
      ),
      text: (doc?.body?.textContent ?? '').trim().slice(0, 60),
    };
  }, selector);

/** Navigates a frame itself (as a link in it would), and gives a page that would load and boot time. */
async function navigateFrame(page, selector, url) {
  await page.evaluate(
    ([css, target]) => {
      const element = document.querySelector(css);
      try {
        element.contentWindow.location.replace(target);
      } catch {
        // A frame whose document is not readable any more (an error page): set its source instead.
        element.src = target;
      }
    },
    [selector, url],
  );
  await page.waitForTimeout(3000);
  return frameState(page, selector);
}

/** A blob: HTML document with an inline script, made by the page itself (frame-src allows blob:). */
const makeHtmlBlob = (page) =>
  page.evaluate((html) => URL.createObjectURL(new Blob([html], { type: 'text/html' })), EVIL_HTML);

/** The addresses each frame is sent to; none may show the application or run a script. */
//
// `refused`: the policy itself refuses the frame (a violation of frame-src is expected and is the
// only one allowed). `inScope`: below the worker's scope, so the worker must answer it alone.
// `ownBlob`: frame-src allows blob:, so a blob: document the page itself made does load; what must
// hold is that it is not the application and that no script of it runs (it inherits the page's
// policy, P3.4.2). Only the page's own code can make such an address: a link in a help page or a
// PDF cannot name a blob: URL it was never given.
function strangers(base, origin, blobUrl) {
  return [
    { label: "the application's page", url: `${base}index.html`, inScope: true },
    { label: 'the scope itself', url: base, inScope: true },
    { label: '?open=', url: `${base}?open=/browser/demo.X68`, inScope: true },
    { label: 'help/..%2Findex.html', url: `${base}help/..%2Findex.html`, inScope: true },
    { label: 'the site outside the scope', url: `${origin}/`, inScope: false },
    {
      label: 'a data: HTML document',
      url: `data:text/html,${encodeURIComponent(EVIL_HTML)}`,
      refused: /^frame-src( data)?\s*$/,
    },
    { label: 'another site', url: 'https://example.com/', refused: /^frame-src https:\/\/example\.com/ },
    { label: "a blob: HTML document of the page's own", url: blobUrl, ownBlob: true },
  ];
}

async function strangerPass(p, page, frameName, selector, base, serve) {
  const blobUrl = await makeHtmlBlob(page);
  await takeViolations(page);
  for (const stranger of strangers(base, serve.origin, blobUrl)) {
    await page.evaluate((key) => localStorage.removeItem(key), SCRIPT_KEY);
    const asked = serve.state.attempts.length;
    const state = await navigateFrame(page, selector, stranger.url);
    const reached = serve.state.attempts.slice(asked).filter((line) => !/\/sw\.js(\?|$)/.test(line));
    const trace = await scriptTrace(page);
    const seen = await takeViolations(page);
    const wrongViolations = seen.filter((line) => !stranger.refused?.test(line));
    const refusedByPolicy = stranger.refused ? seen.some((line) => stranger.refused.test(line)) : true;
    check(
      `${p} ${frameName}: ${stranger.label} shows nothing of the application and runs no script` +
        (stranger.inScope ? ', and nothing reaches the server' : '') +
        (stranger.refused ? ', refused by frame-src' : ''),
      state !== null &&
        !state.app &&
        !state.global &&
        (stranger.ownBlob || state.scripts === 0) &&
        trace === null &&
        !/EASy68K/.test(state.title ?? '') &&
        (!stranger.inScope || reached.length === 0) &&
        refusedByPolicy &&
        wrongViolations.length === 0,
      `${JSON.stringify(state)} trace=${trace} violations=[${seen.join(' | ')}]` +
        `${reached.length ? `; reached the server: ${reached.join(', ')}` : ''}`,
    );
  }
}

/**
 * Before a worker controls the page (the first visit), nothing answers a frame navigation but the
 * server, and the same holds in the desktop app, which has no worker. The Help frame then has no
 * allow-scripts (H1), but the PDF frame has no sandbox at all (P3.4.2: a sandbox blocks the
 * browsers' PDF viewers), and the policy allows the application's own origin in it. Decision D-c of
 * the stage's gate (errata N6 14, N0 11): the viewer puts its document back whenever the frame is
 * found to show something else. This pass sends the PDF frame to the application's page and to its
 * ?open= address without a worker, and checks that the document is back within two seconds, that no
 * copy of the application stays in the frame, and that the server saw only what the frame was sent
 * to; a picture's viewer has no frame (an <img> only).
 */
async function firstVisitPass(name, browser, serve) {
  const p = `${name}, first visit without a worker:`;
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
  try {
    await context.addInitScript(watchPage);
    const page = await context.newPage();
    await page.goto(`${serve.origin}${BASE}`, { timeout: 240_000 });
    await page.waitForSelector('.e68-shell', { timeout: 240_000 });
    check(`${p} no worker controls the page`, await page.evaluate(() => navigator.serviceWorker?.controller == null));
    await dropFiles(page, [{ name: `${name}-first.pdf`, bytes: pdfBytes('first visit'), type: 'application/pdf' }]);
    const viewer = page.locator('[data-e68-panel^="viewer:"]', { has: page.locator('iframe') }).first();
    await viewer.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    const panel = `[data-e68-panel="${await viewer.getAttribute('data-e68-panel')}"]`;
    const selector = `${panel} iframe`;
    const src = await page.locator(selector).getAttribute('src');
    for (const [label, address] of [
      ["the application's page", `${serve.origin}${BASE}index.html`],
      ["the application's ?open= address", `${serve.origin}${BASE}?open=/browser/demo.X68`],
    ]) {
      await page.evaluate((css) => document.querySelector(css)?.setAttribute('data-check-old', ''), selector);
      const started = Date.now();
      await page.evaluate(
        ([css, url]) => document.querySelector(css).contentWindow.location.replace(url),
        [selector, address],
      );
      let back = -1;
      let state = null;
      while (Date.now() - started < 5000) {
        state = await frameState(page, selector);
        const old = await page.evaluate(() => document.querySelector('[data-check-old]') !== null);
        const nowSrc = await page.locator(selector).getAttribute('src');
        if (!old && state && !state.app && !state.global && state.href !== address && nowSrc === src) {
          back = Date.now() - started;
          break;
        }
        await page.waitForTimeout(50);
      }
      check(
        `${p} the PDF frame sent to ${label} shows its document again within 2 s`,
        back >= 0 && back <= 2000,
        `${back < 0 ? 'not back after 5 s' : `${back} ms`}: ${JSON.stringify(state)}`,
      );
      await page.waitForTimeout(3000);
      const later = await frameState(page, selector);
      const frames = await page.locator(`${panel} iframe`).count();
      const shells = await page.evaluate(() => document.querySelectorAll('.e68-shell').length);
      check(
        `${p} after ${label}, 3 s later no copy of the application is in the frame`,
        later !== null && !later.app && !later.global && later.href !== address && frames === 1 && shells === 1,
        `${JSON.stringify(later)} frames=${frames} shells=${shells}`,
      );
    }
    await dropFiles(page, [{ name: `${name}-first.png`, bytes: await makePng(page), type: 'image/png' }]);
    const picture = page.locator('[data-e68-panel^="viewer:"]', { has: page.locator('img') }).first();
    await picture.waitFor({ timeout: 30_000 });
    const facts = await picture.evaluate((element) => ({
      frames: element.querySelectorAll('iframe, object, embed, frame').length,
      src: element.querySelector('img')?.getAttribute('src') ?? '',
    }));
    check(
      `${p} a picture's viewer has no frame that could be sent anywhere, only its <img> of a blob:`,
      facts.frames === 0 && /^blob:/.test(facts.src),
      JSON.stringify(facts),
    );
  } catch (error) {
    check(
      `${p} the pass ran to the end`,
      false,
      String(error?.stack ?? error)
        .split('\n')
        .slice(0, 3)
        .join(' | '),
    );
  } finally {
    await context.close();
  }
}

// ---- one browser -------------------------------------------------------------------------------

async function launch(name) {
  if (name === 'chromium') {
    try {
      return { browser: await chromium.launch({ channel: 'chromium' }), fullChromium: true };
    } catch (error) {
      const why = String(error).split('\n')[0];
      if (requireFullChromium) check("chromium: Playwright's full Chromium starts (required in CI)", false, why);
      else note(`Chromium's full build could not start (${why}); using the headless shell, which has no PDF viewer`);
    }
  }
  return { browser: await BROWSERS[name].launch(), fullChromium: false };
}

async function browserPass(name, serve) {
  const p = `${name}:`;
  const { browser, fullChromium } = await launch(name);
  const errors = [];
  try {
    const context = await browser.newContext({
      serviceWorkers: 'allow',
      viewport: { width: 1400, height: 900 },
      reducedMotion: 'reduce',
      colorScheme: 'light',
    });
    await context.addInitScript(watchPage);
    const base = `${serve.origin}${BASE}`;
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    collectErrors(page, errors);
    await page.goto(base, { timeout: 240_000 });
    await page.waitForSelector('.e68-shell', { timeout: 240_000 });
    const policy = await page.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
    );
    check(`${p} the page runs under the policy`, policy === EXPECTED_POLICY, policy);
    if (!(await page.evaluate(() => 'serviceWorker' in navigator))) {
      check(`${p} service workers are available`, false, `${name} on ${process.platform}`);
      return;
    }
    const scope = await waitActivated(page).catch((error) => `error: ${error.message}`);
    check(`${p} the worker is activated with the sub-path as its scope`, scope === base, String(scope));

    // Offline from here: the server refuses every connection, and the browser is offline.
    serve.state.down = true;
    await context.setOffline(true);
    await page.reload({ timeout: 240_000 });
    await page.waitForSelector('.e68-shell', { timeout: 240_000 });
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
    check(`${p} offline: the reloaded page is controlled by the worker`, controlled);
    const startAttempts = serve.state.attempts.filter((line) => !/\/sw\.js(\?|$)/.test(line));
    check(`${p} offline: nothing of the page reached the server`, startAttempts.length === 0, startAttempts.join(', '));

    // ---- Help, offline
    const helpShown = await openHelp(page);
    const helpFrame = '[data-e68-panel="help"] iframe';
    check(
      `${p} offline: Help > Help shows "${HELP_TITLE}" in the Help frame`,
      helpShown,
      JSON.stringify(await frameState(page, helpFrame)),
    );
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `${name}-light-help-offline.png`) });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `${name}-dark-help-offline.png`) });
    await page.emulateMedia({ colorScheme: 'light' });
    const startViolations = await takeViolations(page);
    check(
      `${p} offline: no Content Security Policy violation from the start to Help shown`,
      startViolations.length === 0,
      startViolations.join(' | '),
    );
    // A control first: navigating the frame works at all, offline, to another help page. Without it
    // a frame that kept its page after a stranger (WebKit keeps the old document when the worker
    // refuses a navigation) would prove nothing.
    const control = await navigateFrame(page, helpFrame, `${base}help/credits.htm`);
    check(
      `${p} the Help frame: offline, another help page (credits.htm) loads in it when the frame is sent there`,
      control?.title === 'Credits',
      JSON.stringify(control),
    );
    if (helpShown) await strangerPass(p, page, 'the Help frame', helpFrame, base, serve);
    // A help page still loads in it afterwards (the frame is not broken, only guarded).
    const backToHelp = await navigateFrame(page, helpFrame, `${base}help/main.htm`);
    check(
      `${p} the Help frame: a help page still loads after them`,
      backToHelp?.title === HELP_TITLE,
      JSON.stringify(backToHelp),
    );
    await page.locator('[data-e68-panel="help"]').getByRole('button', { name: 'Close Help' }).click();

    // ---- the viewer, offline
    const png = await makePng(page);
    const files = [
      {
        name: `${name}-report.pdf`,
        bytes: pdfBytes(`frame policy ${name}`),
        type: 'application/pdf',
        selector: 'iframe',
      },
      { name: `${name}-photo.png`, bytes: png, type: 'image/png', selector: 'img' },
    ];
    let pdfFrame = null;
    for (const file of files) {
      await dropFiles(page, [file]);
      const viewer = page
        .locator('[data-e68-panel^="viewer:"]', { has: page.locator(file.selector) })
        .filter({ hasText: file.name })
        .first();
      const shown = await viewer
        .waitFor({ timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      check(`${p} offline: ${file.name} dropped on the window opens in the viewer`, shown);
      if (!shown) continue;
      const panelId = await viewer.getAttribute('data-e68-panel');
      const selector = `[data-e68-panel="${panelId}"] ${file.selector}`;
      // connect-src has no blob:, so the blob is not fetched back; its type and size are recorded
      // when the page makes it (watchPage).
      const facts = await page.evaluate((css) => {
        const element = document.querySelector(css);
        return {
          src: element?.getAttribute('src') ?? '',
          drawn: element instanceof HTMLImageElement ? element.complete && element.naturalWidth > 0 : null,
          sandbox: element?.getAttribute('sandbox') ?? null,
        };
      }, selector);
      const blob = await blobOf(page, facts.src);
      check(
        `${p} offline: ${file.name}: its source is a blob: of type ${file.type} with the file's size`,
        /^blob:/.test(facts.src) && blob?.type === file.type && blob?.size === file.bytes.length,
        `${JSON.stringify(facts)} ${JSON.stringify(blob)}`,
      );
      if (file.selector === 'img') {
        check(`${p} offline: ${file.name} is drawn`, facts.drawn === true, JSON.stringify(facts));
      } else {
        pdfFrame = selector;
        await page.waitForTimeout(2000);
        const inside = await page.evaluate((css) => {
          const element = document.querySelector(css);
          try {
            return { readable: true, contentType: element.contentDocument?.contentType ?? null };
          } catch (error) {
            return { readable: false, error: String(error) };
          }
        }, selector);
        if (name === 'chromium' && fullChromium) {
          // Chromium's PDF viewer is a frame of its own extension inside the blob: document.
          const frameHandle = await page.locator(selector).elementHandle();
          const viewerFrame = await frameHandle?.contentFrame();
          const viewerChildren = (viewerFrame?.childFrames() ?? []).map((child) => child.url());
          check(
            `${p} offline: the PDF frame holds Chromium's PDF viewer`,
            inside.contentType === 'application/pdf' &&
              viewerChildren.some((url) => /^chrome-extension:\/\/[a-z]+\/index\.html$/.test(url)),
            `${JSON.stringify(inside)} children=${viewerChildren.join(', ')}`,
          );
        } else {
          // Playwright's WebKit reports a PDF viewer and draws nothing (errata N0 entry 6); the frame
          // and its blob are what can be asserted there.
          note(`${name}: the PDF frame's document: ${JSON.stringify(inside)} (no drawn PDF is expected here)`);
        }
        check(`${p} offline: the PDF frame has no sandbox attribute (P3.4.2)`, facts.sandbox === null);
      }
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(outDir, `${name}-light-${file.name.replace(/\W/g, '-')}.png`) });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(outDir, `${name}-dark-${file.name.replace(/\W/g, '-')}.png`) });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    const viewerViolations = await takeViolations(page);
    check(
      `${p} offline: no Content Security Policy violation with the viewers open`,
      viewerViolations.length === 0,
      viewerViolations.join(' | '),
    );

    // An HTML file with a script, saved as x.pdf: the viewer's blob has type application/pdf.
    await page.evaluate((key) => localStorage.removeItem(key), SCRIPT_KEY);
    await dropFiles(page, [
      { name: `${name}-x.pdf`, bytes: [...Buffer.from(EVIL_HTML, 'utf8')], type: 'application/pdf' },
    ]);
    await page.waitForTimeout(3000);
    check(`${p} offline: an HTML file with a script saved as x.pdf runs no script`, (await scriptTrace(page)) === null);

    if (pdfFrame) await strangerPass(p, page, 'the PDF frame', pdfFrame, base, serve);

    const left = await takeViolations(page);
    check(`${p} no other Content Security Policy violation`, left.length === 0, left.join(' | '));
    const unexpected = errors.filter((text) => !REFUSED.test(text));
    console.log(`        console errors of the refused loads: ${errors.length - unexpected.length}`);
    check(
      `${p} no console or page error but the refused loads`,
      unexpected.length === 0,
      unexpected.slice(0, 3).join(' | '),
    );
    await context.setOffline(false);
    serve.state.down = false;
    await context.close();
    await firstVisitPass(name, browser, serve);
  } catch (error) {
    check(`${p} the pass ran to the end`, false, String(error?.stack ?? error));
  } finally {
    serve.state.down = false;
    await browser.close();
  }
}

// ---- main --------------------------------------------------------------------------------------

async function main() {
  const dist = resolve(givenDist ?? join(outDir, 'dist'));
  if (!givenDist) productionBuild(dist);
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist} holds no build`);
  staticChecks(dist);
  const serve = await startServer(dist);
  console.log(`Site: ${serve.origin}${BASE}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      console.log(`\n[${name}]`);
      await browserPass(name, serve);
    }
  } finally {
    serve.server.closeAllConnections?.();
    await new Promise((done) => serve.server.close(done));
  }
  console.log(`\n${total - failures} of ${total} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
