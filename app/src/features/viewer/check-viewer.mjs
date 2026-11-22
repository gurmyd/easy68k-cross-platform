// Browser check of work package N6, the viewer of files that are not text (ARCHITECTURE-PLUS
// P3.4, P5 N6). Owner: N6.
//
//   node app/src/features/viewer/check-viewer.mjs [--browser chromium|webkit|all] [--out <dir>]
//                                                [--dist <built app>] [--skip-build]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright), with the Windows key map on every machine. Four passes
// per browser:
//
//   viewer      the real viewer model and panel, shown in a stand-in for the dock's tab
//               (check-harness.tsx), so that the viewer itself is checked whether or not the dock
//               accepts transient panels: a PDF's frame (a blob: source of type application/pdf
//               whose bytes equal the file's, read back with fetch; no sandbox attribute; its
//               title; the line under the strip), PNG, JPEG and SVG pictures (rendered size scaled
//               to fit and at Actual Size with aria-pressed, alt, the blob's type), a broken
//               picture and a binary file (the notice), Open as Text, Export (a download of the
//               exact bytes, as application/octet-stream), the blob: URL revoked on close, an HTML
//               file with an inline script saved as x.pdf and as x.svg (it runs no script: the
//               localStorage key it would set stays absent; it opens no window), and an axe scan
//               in both themes;
//   pdf-off     with navigator.pdfViewerEnabled false (overridden in the page): the PDF notice
//               with Export instead of the frame;
//   dock        the viewer in the dock (needs N1's dock controller, state/dock.ts): ?open= of a
//               PDF at start-up shows the viewer once the Editor dock attaches and the Editor holds
//               the template document; a picture opened from the document service; a second open
//               selects the same tab; the tab's title; closing revokes the URL; Open as Text from
//               the tab; the `viewer` switch off opens as text; Simulator Open... of an .S68 and
//               EASyBIN's Open Binary are unchanged with the viewer on; an axe scan;
//   production  the production build (vite build with EASY68K_BASE=/easy68k-cross-platform/,
//               served under that sub-path): a PDF, a PNG, a JPEG and an SVG dropped on the window
//               open in the viewer with no Content Security Policy violation and no console error,
//               and the HTML-with-a-script files run nothing and open no window there either;
//               then without a service worker (a first visit, the desktop app): the PDF frame sent
//               to the application's own page and its ?open= address shows its document again
//               within 2 s, with no copy of the application left in it (decision D-c), and a
//               picture's viewer has no frame at all.
//
// Headless browsers do not run a PDF viewer (P3.4.2): the check asserts the frame and its blob,
// never that a PDF is drawn. Screenshots go to build/viewer-check (git-ignored). The page object
// `window.__easy68k` exists in development builds only (main.tsx); the production pass uses only
// what a person can do (a drop). Exit code 0 = every check passed.

/* global console, process, window, document, navigator, Navigator, URL, File, DataTransfer, DragEvent, localStorage, fetch, setTimeout */

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'viewer-check')));
const givenDist = option('--dist', null);
const skipBuild = args.includes('--skip-build');
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const BASE = '/easy68k-cross-platform/';
const SCRIPT_KEY = 'n6-script-ran';

// The texts of features/viewer/texts.ts, exactly (the check is plain JavaScript and cannot import
// the TypeScript module; classify.test.ts asserts the same strings against it).
const TEXTS = {
  openAsText: 'Open as Text',
  export: 'Export',
  actualSize: 'Actual Size',
  pdfHintWeb: 'If the PDF does not appear, use Export and open it with another program.',
  notice: (name) => `"${name}" does not look like text. Opened as text, it will probably look like nonsense.`,
  pdfNotice: (name) => `"${name}" cannot be shown here because this browser does not show PDF files.`,
  frameTitle: (name) => `PDF: ${name}`,
};

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  detail = String(detail).slice(0, 400);
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const notes = [];
function note(text) {
  notes.push(text);
  console.log(`  note ${text}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- files ------------------------------------------------------------------------------------

/** A one-page PDF (the same construction as N0's spike, docs/requests/N0.md 5.4). */
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

/** An HTML document whose inline script, if it ever ran, would leave a trace and open a window. */
const EVIL_HTML = [
  '<!doctype html><html><head><title>x</title></head><body><h1>not a PDF</h1>',
  `<script>try{localStorage.setItem('${SCRIPT_KEY}','inline')}catch(e){}`,
  `try{parent.postMessage('${SCRIPT_KEY}','*')}catch(e){}try{window.open('about:blank#n6')}catch(e){}</script>`,
  `<img src="x" onerror="try{localStorage.setItem('${SCRIPT_KEY}','onerror')}catch(e){}">`,
  '</body></html>',
].join('');
/** An SVG with a script of its own (a picture is only ever shown in an <img>, where none runs). */
const EVIL_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="',
  `try{localStorage.setItem('${SCRIPT_KEY}','svg-onload')}catch(e){}">`,
  `<script>try{localStorage.setItem('${SCRIPT_KEY}','svg-script')}catch(e){}</script>`,
  '<rect width="120" height="80" fill="#c33"/></svg>',
].join('');
const asBytes = (text) => [...Buffer.from(text, 'utf8')];
const SVG_PICTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">' +
  '<rect width="1200" height="800" fill="#2b6cb0"/><circle cx="600" cy="400" r="300" fill="#f6e05e"/></svg>';

// ---- browser helpers -------------------------------------------------------------------------

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/** The Windows key map on every machine, so that the result does not depend on the runner. */
// Configurable: the script runs again in a frame whose first document's window is kept for the next
// same-origin document (HTML's rule for the initial about:blank, which WebKit applies to the PDF
// frame sent to the application's page in escapePass).
function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32', configurable: true });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
}

/** Records every blob: URL the page makes and revokes, window.open, messages and policy violations. */
function recordPage(scriptKey) {
  window.__n6 = { blobs: [], revoked: [], opened: 0, messages: [], violations: [] };
  const record = window.__n6;
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = create(object);
    record.blobs.push({ url, type: object && typeof object.type === 'string' ? object.type : null });
    return url;
  };
  URL.revokeObjectURL = (url) => {
    record.revoked.push(url);
    revoke(url);
  };
  const open = window.open;
  window.open = function (...rest) {
    record.opened++;
    return open.apply(window, rest);
  };
  window.addEventListener('message', (event) => {
    if (event.data === scriptKey) record.messages.push(String(event.data));
  });
  document.addEventListener('securitypolicyviolation', (event) =>
    record.violations.push(`${event.violatedDirective} ${event.blockedURI}`),
  );
}

/** For the pass pdf-off: the browser says it shows no PDFs. */
function pdfViewerOff() {
  Object.defineProperty(Navigator.prototype, 'pdfViewerEnabled', { get: () => false });
}

async function newContext(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
    // No worker: a first visit before the worker is installed, and the desktop app (escapePass).
    ...(options.noWorker ? { serviceWorkers: 'block' } : {}),
  });
  await context.addInitScript(pretendWindows);
  await context.addInitScript(recordPage, SCRIPT_KEY);
  if (options.pdfOff) await context.addInitScript(pdfViewerOff);
  const popups = [];
  // A window opened by the page has an opener; the pages the check and axe open themselves do not.
  context.on('page', (page) => {
    void page.opener().then((opener) => {
      if (opener) popups.push(page.url());
    });
  });
  return { context, popups };
}

/** Errors that only mean engine/dist is missing on a machine that has not built the engines. */
const engineDist = join(repoRoot, 'engine', 'dist');
const enginesPresent = existsSync(join(engineDist, 'asm68k.wasm')) && existsSync(join(engineDist, 'sim68k.wasm'));
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';
/** CI (and EASY68K_REQUIRE_BROWSERS=1) has Playwright's full Chromium: its PDF checks must run there. */
const requireFullChromium = process.env.CI === 'true' || process.env.EASY68K_REQUIRE_BROWSERS === '1';
const isMissingEngineError = (text) =>
  !enginesPresent &&
  !enginesRequired &&
  /Simulator:|sim68k|asm68k|engine\/dist|Failed to fetch dynamically/i.test(text);

async function openApp(context, url, { dev = true } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(240_000);
  const errors = [];
  page.on('console', (message) => {
    const where = message.location()?.url;
    // Chromium's PDF viewer asks the origin for /favicon.ico, which neither the development server
    // nor the site has; the application never asks for it.
    if (where && /\/favicon\.ico$/.test(where)) return;
    if (message.type() === 'error' && !isMissingEngineError(message.text())) {
      errors.push(`${message.text()}${where ? ` (${where})` : ''}`);
    }
  });
  page.on('pageerror', (error) => {
    if (!isMissingEngineError(String(error))) errors.push(String(error));
  });
  // A failed load is named by its URL (the console says only "Failed to load resource").
  page.on('response', (response) => {
    if (response.status() >= 400 && !isMissingEngineError(response.url()) && !/\/favicon\.ico$/.test(response.url())) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  await page.goto(url);
  await page.waitForSelector('.e68-shell', { timeout: 240_000 });
  if (dev) await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: 240_000 });
  return { page, errors };
}

const writeFile = (page, path, bytes) =>
  page.evaluate(([p, b]) => window.__easy68k.ctx.vfs.writeFile(p, Uint8Array.from(b)), [path, bytes]);

/** A PNG and a JPEG of width x height made by the page's own canvas. */
function makePictures(page, width, height) {
  return page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      g.fillStyle = '#1f6feb';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd33d';
      g.fillRect(w / 4, h / 4, w / 2, h / 2);
      const bytesOf = (type) =>
        new Promise((done) =>
          canvas.toBlob(async (blob) => done(Array.from(new Uint8Array(await blob.arrayBuffer()))), type, 0.9),
        );
      return { png: await bytesOf('image/png'), jpeg: await bytesOf('image/jpeg') };
    },
    [width, height],
  );
}

/** Shows `path` (already in the Vfs) in the stand-in of check-harness.tsx. */
async function mountHarness(page, path) {
  await page.evaluate(async (p) => {
    const { mountViewer } = await import('/src/features/viewer/check-harness.tsx');
    const { ctx } = window.__easy68k;
    window.__n6viewer?.close();
    window.__n6viewer = mountViewer(ctx, p, await ctx.vfs.readFile(p));
  }, path);
  return page.locator('[data-e68-panel="viewer:check"]');
}
const closeHarness = (page) => page.evaluate(() => window.__n6viewer?.close());

/** The blob behind `url`, read back by the page: its type and bytes. */
const readBlob = (page, url) =>
  page.evaluate(async (u) => {
    const blob = await (await fetch(u)).blob();
    return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  }, url);

const recorded = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__n6)));
const scriptTrace = (page) => page.evaluate((key) => localStorage.getItem(key), SCRIPT_KEY);

async function scan(page, label, selector) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: no serious finding`,
    serious.length === 0,
    serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`).join('; '),
  );
}

/** The image's rendered and natural size, once it has decoded (or failed). */
const pictureState = (panel) =>
  panel.evaluate(async (root) => {
    const img = root.querySelector('img');
    if (!img) return null;
    for (let i = 0; i < 100 && !img.complete; i++) await new Promise((r) => setTimeout(r, 50));
    const body = root.querySelector('.e68-viewer__body');
    const box = img.getBoundingClientRect();
    const area = body.getBoundingClientRect();
    return {
      alt: img.getAttribute('alt'),
      src: img.getAttribute('src'),
      natural: [img.naturalWidth, img.naturalHeight],
      shown: [Math.round(box.width), Math.round(box.height)],
      area: [Math.round(area.width), Math.round(area.height)],
      scroll: [body.scrollWidth, body.scrollHeight],
    };
  });

/** The texts of the visible buttons of the strip. */
const stripButtons = (panel) => panel.locator('.e68-viewer__strip button').allInnerTexts();

// ---- passes -----------------------------------------------------------------------------------

/** The viewer itself, in the stand-in for the dock's tab. */
async function viewerPass(browser, name) {
  const p = `${name} viewer:`;
  const { context, popups } = await newContext(browser);
  const { page, errors } = await openApp(context, baseUrl);
  const pdf = pdfBytes('EASy68K viewer check');
  const pictures = await makePictures(page, 1600, 1000);
  await writeFile(page, '/browser/viewer/report.pdf', pdf);
  await writeFile(page, '/browser/viewer/photo.png', pictures.png);
  await writeFile(page, '/browser/viewer/photo.jpg', pictures.jpeg);
  await writeFile(page, '/browser/viewer/drawing.svg', asBytes(SVG_PICTURE));
  await writeFile(page, '/browser/viewer/broken.png', asBytes('this is not a picture'));
  await writeFile(page, '/browser/viewer/data.bin', [0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3, 0, 0, 0x41]);
  await writeFile(page, '/browser/viewer/x.pdf', asBytes(EVIL_HTML));
  await writeFile(page, '/browser/viewer/x.svg', asBytes(EVIL_HTML));
  await writeFile(page, '/browser/viewer/script.svg', asBytes(EVIL_SVG));

  // A PDF: the frame and its blob. A browser that says it shows no PDFs (Playwright's Chromium
  // headless shell) gets the notice instead, which the pass pdf-off checks; here it is a note.
  const pdfViewer = await page.evaluate(() => navigator.pdfViewerEnabled !== false);
  if (!pdfViewer && requireFullChromium && name.startsWith('chromium')) {
    check(`${p} Chromium reports a PDF viewer (required in CI: the PDF frame is checked)`, false);
  } else if (!pdfViewer) note(`${p} this browser reports pdfViewerEnabled false: the PDF frame is not checked in it`);
  const panel = await mountHarness(page, '/browser/viewer/report.pdf');
  if (pdfViewer) await pdfFrameChecks(page, panel, name, pdf);
  else {
    const text = await panel.locator('.e68-viewer__notice-text').innerText();
    check(`${p} without a PDF viewer the PDF notice is shown`, text === TEXTS.pdfNotice('report.pdf'), text);
  }
  await closeHarness(page);

  await picturesChecks(page, name);
  await notices(page, name);
  await securityChecks(page, name, popups);
  check(`${p} no console errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

/** The PDF frame of the viewer pass. */
async function pdfFrameChecks(page, panel, name, pdf) {
  const p = `${name} viewer:`;
  const frame = panel.locator('iframe');
  await frame.waitFor();
  const frameInfo = await frame.evaluate((f) => ({
    src: f.getAttribute('src'),
    title: f.getAttribute('title'),
    sandbox: f.hasAttribute('sandbox'),
    width: f.getBoundingClientRect().width,
    height: f.getBoundingClientRect().height,
  }));
  check(`${p} the PDF is an iframe with a blob: source`, /^blob:/.test(frameInfo.src ?? ''), frameInfo.src);
  check(
    `${p} the frame's title is "PDF: report.pdf"`,
    frameInfo.title === TEXTS.frameTitle('report.pdf'),
    frameInfo.title,
  );
  check(`${p} the frame has no sandbox attribute`, frameInfo.sandbox === false);
  const pdfBlob = await readBlob(page, frameInfo.src);
  check(`${p} the frame's blob has the type application/pdf`, pdfBlob.type === 'application/pdf', pdfBlob.type);
  check(
    `${p} the frame's blob holds exactly the file's bytes`,
    same(pdfBlob.bytes, pdf),
    `${pdfBlob.bytes.length} bytes`,
  );
  const panelBox = await panel.boundingBox();
  check(
    `${p} the frame fills the panel below the strip and the line`,
    frameInfo.width >= (panelBox?.width ?? 0) - 2 && frameInfo.height > (panelBox?.height ?? 0) - 120,
    `frame ${Math.round(frameInfo.width)}x${Math.round(frameInfo.height)}, panel ${panelBox?.width}x${panelBox?.height}`,
  );
  const hint = await panel.locator('.e68-viewer__hint').innerText();
  check(`${p} the line under the strip`, hint === TEXTS.pdfHintWeb, hint);
  const pdfButtons = await stripButtons(panel);
  check(
    `${p} the strip: name, size, Open as Text, Export, no Actual Size for a PDF`,
    same(pdfButtons, [TEXTS.openAsText, TEXTS.export]) &&
      (await panel.locator('.e68-viewer__name').innerText()) === 'report.pdf' &&
      /^\d+ bytes$/.test(await panel.locator('.e68-viewer__size').innerText()),
    `${pdfButtons.join(', ')} / ${await panel.locator('.e68-viewer__size').innerText()}`,
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${name}-pdf.png`) });
  await scan(page, `${name} PDF viewer (light)`, '[data-e68-panel="viewer:check"]');

  // Close: the blob: URL is revoked.
  await closeHarness(page);
  const rec = await recorded(page);
  check(`${p} closing the viewer revokes its blob: URL`, rec.revoked.includes(frameInfo.src), rec.revoked.join(', '));
}

/** PNG, JPEG and SVG pictures of the viewer pass. */
async function picturesChecks(page, name) {
  const p = `${name} viewer:`;
  let panel;

  for (const [file, type, natural] of [
    ['photo.png', 'image/png', [1600, 1000]],
    ['photo.jpg', 'image/jpeg', [1600, 1000]],
    ['drawing.svg', 'image/svg+xml', [1200, 800]],
  ]) {
    panel = await mountHarness(page, `/browser/viewer/${file}`);
    await panel.locator('img').waitFor();
    const fit = await pictureState(panel);
    check(
      `${p} ${file}: only the <img> references the picture's blob (no frame, link, object or embed)`,
      (await page.evaluate(() => document.querySelectorAll('iframe, a[href^="blob:"], object, embed').length)) === 0,
    );
    const blob = await readBlob(page, fit.src);
    check(
      `${p} ${file}: an <img> with alt "${file}" and a blob: source`,
      fit.alt === file && /^blob:/.test(fit.src),
      fit.alt,
    );
    check(`${p} ${file}: the blob's type is ${type}`, blob.type === type, blob.type);
    check(
      `${p} ${file}: decoded at its natural size ${natural.join('x')}`,
      same(fit.natural, natural) || (type === 'image/svg+xml' && fit.natural[0] > 0),
      fit.natural.join('x'),
    );
    check(
      `${p} ${file}: scaled to fit by default (inside the panel, proportions kept)`,
      fit.shown[0] <= fit.area[0] + 1 &&
        fit.shown[1] <= fit.area[1] + 1 &&
        Math.abs(fit.shown[0] / fit.shown[1] - natural[0] / natural[1]) < 0.02,
      `shown ${fit.shown.join('x')} in ${fit.area.join('x')}`,
    );
    const toggle = panel.getByRole('button', { name: TEXTS.actualSize });
    check(
      `${p} ${file}: Actual Size is a toggle, not pressed`,
      (await toggle.getAttribute('aria-pressed')) === 'false',
    );
    await toggle.click();
    const actual = await pictureState(panel);
    check(
      `${p} ${file}: Actual Size pressed shows 1:1 with scroll bars`,
      (await toggle.getAttribute('aria-pressed')) === 'true' &&
        same(actual.shown, natural) &&
        actual.scroll[0] >= natural[0] &&
        actual.scroll[1] >= natural[1],
      `shown ${actual.shown.join('x')}, scroll ${actual.scroll.join('x')}`,
    );
    await page.screenshot({ path: join(outDir, `${name}-${file.replace('.', '-')}-actual.png`) });
    await toggle.click();
    if (file === 'photo.png') {
      await page.screenshot({ path: join(outDir, `${name}-photo-png-fit.png`) });
      await scan(page, `${name} picture viewer (light)`, '[data-e68-panel="viewer:check"]');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: join(outDir, `${name}-photo-png-dark.png`) });
      await scan(page, `${name} picture viewer (dark)`, '[data-e68-panel="viewer:check"]');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    }
    await closeHarness(page);
  }
  const rec = await recorded(page);
  check(
    `${p} pictures made ${rec.blobs.length} blob: URLs, all with an explicit type`,
    rec.blobs.every((blob) => blob.type !== ''),
    JSON.stringify(rec.blobs.map((blob) => blob.type)),
  );
}

/** The notices, Export and Open as Text of the viewer pass. */
async function notices(page, name) {
  const p = `${name} viewer:`;
  let panel;

  // A broken picture and a binary file: the notice.
  for (const [file, kind] of [
    ['broken.png', 'a picture that fails to decode'],
    ['data.bin', 'a binary file'],
  ]) {
    panel = await mountHarness(page, `/browser/viewer/${file}`);
    const notice = panel.locator('.e68-viewer__notice-text');
    await notice.waitFor();
    const text = await notice.innerText();
    check(`${p} ${kind} (${file}) shows the notice`, text === TEXTS.notice(file), text);
    const buttons = await panel.locator('.e68-viewer__notice button').allInnerTexts();
    check(
      `${p} ${file}: the notice's buttons Open as Text and Export`,
      same(buttons, [TEXTS.openAsText, TEXTS.export]),
      buttons.join(', '),
    );
    // Each command once in the tab: the strip does not repeat the notice's buttons (errata N6 7).
    const all = await panel.getByRole('button').allInnerTexts();
    check(
      `${p} ${file}: one Open as Text and one Export in the tab (the strip leaves them to the notice)`,
      all.filter((text) => text === TEXTS.openAsText).length === 1 &&
        all.filter((text) => text === TEXTS.export).length === 1,
      all.join(', '),
    );
    check(`${p} ${file}: no <img> is left on screen`, (await panel.locator('img').count()) === 0);
    await page.screenshot({ path: join(outDir, `${name}-${file.replace('.', '-')}-notice.png`) });
    if (file === 'data.bin') {
      await scan(page, `${name} notice (light)`, '[data-e68-panel="viewer:check"]');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: join(outDir, `${name}-notice-dark.png`) });
      await scan(page, `${name} notice (dark)`, '[data-e68-panel="viewer:check"]');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

      // Export: a download of the exact bytes, made from a blob of type application/octet-stream.
      const before = (await recorded(page)).blobs.length;
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        panel.locator('.e68-viewer__notice').getByRole('button', { name: TEXTS.export }).click(),
      ]);
      const saved = join(outDir, `${name}-export-data.bin`);
      await download.saveAs(saved);
      const blobs = (await recorded(page)).blobs.slice(before);
      check(
        `${p} Export downloads the file under its name`,
        download.suggestedFilename() === 'data.bin',
        download.suggestedFilename(),
      );
      check(
        `${p} Export downloads exactly the file's bytes`,
        same([...readFileSync(saved)], [0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3, 0, 0, 0x41]),
      );
      check(
        `${p} Export's blob has the type application/octet-stream`,
        blobs.length === 1 && blobs[0].type === 'application/octet-stream',
        JSON.stringify(blobs),
      );
    }
    await closeHarness(page);
  }

  // Open as Text: the file opens as a document and the viewer closes.
  panel = await mountHarness(page, '/browser/viewer/data.bin');
  await panel.locator('.e68-viewer__notice').getByRole('button', { name: TEXTS.openAsText }).click();
  await page
    .waitForFunction(() =>
      window.__easy68k.ctx.store.getState().documents.items.some((doc) => doc.path === '/browser/viewer/data.bin'),
    )
    .catch(() => {});
  const docs = await page.evaluate(() => window.__easy68k.ctx.store.getState().documents.items.map((doc) => doc.path));
  check(`${p} Open as Text opens the file as a document`, docs.includes('/browser/viewer/data.bin'), docs.join(', '));
  check(`${p} Open as Text closes the viewer`, (await page.evaluate(() => window.__n6viewer.isOpen())) === false);
  await closeHarness(page);
}

/** An HTML file with an inline script as x.pdf and x.svg, and an SVG with a script. */
async function securityChecks(page, name, popups) {
  const p = `${name} viewer:`;
  for (const file of ['x.pdf', 'x.svg', 'script.svg']) {
    await mountHarness(page, `/browser/viewer/${file}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(outDir, `${name}-security-${file.replace('.', '-')}.png`) });
    const frames = page.frames().map((f) => f.url());
    const rec = await recorded(page);
    check(
      `${p} security: ${file} runs no script (the key "${SCRIPT_KEY}" stays absent, no message)`,
      (await scriptTrace(page)) === null && rec.messages.length === 0,
      `key=${await scriptTrace(page)} messages=${rec.messages.length}`,
    );
    check(
      `${p} security: ${file} opens no window`,
      popups.length === 0 && rec.opened === 0,
      `popups ${popups.join(', ')} window.open ${rec.opened}; frames ${frames.join(' | ')}`,
    );
    await closeHarness(page);
  }
}

/** navigator.pdfViewerEnabled false: the PDF notice with Export instead of the frame. */
async function pdfOffPass(browser, name) {
  const p = `${name} pdf-off:`;
  const { context } = await newContext(browser, { pdfOff: true });
  const { page, errors } = await openApp(context, baseUrl);
  check(
    `${p} the page reports pdfViewerEnabled false`,
    (await page.evaluate(() => navigator.pdfViewerEnabled)) === false,
  );
  await writeFile(page, '/browser/viewer/report.pdf', pdfBytes('off'));
  const panel = await mountHarness(page, '/browser/viewer/report.pdf');
  const notice = panel.locator('.e68-viewer__notice-text');
  await notice.waitFor();
  check(`${p} the PDF notice`, (await notice.innerText()) === TEXTS.pdfNotice('report.pdf'), await notice.innerText());
  const buttons = await panel.locator('.e68-viewer__notice button').allInnerTexts();
  check(`${p} the notice has Export`, buttons.includes(TEXTS.export), buttons.join(', '));
  check(`${p} no frame is shown`, (await panel.locator('iframe').count()) === 0);
  check(`${p} no line under the strip without a frame`, (await panel.locator('.e68-viewer__hint').count()) === 0);
  await page.screenshot({ path: join(outDir, `${name}-pdf-off.png`) });
  await scan(page, `${name} PDF notice`, '[data-e68-panel="viewer:check"]');
  await closeHarness(page);
  check(`${p} no console errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

const DOCK_VIEWER = '[data-e68-panel^="viewer:"]:not([data-e68-panel="viewer:check"])';

/** The viewer in N1's dock. */
async function dockPass(browser, name) {
  const p = `${name} dock:`;
  const { context, popups } = await newContext(browser);
  const first = await openApp(context, baseUrl);
  const accepts = await first.page.evaluate(async () => {
    const { dockOf } = await import('/src/state/dock.ts');
    return dockOf(window.__easy68k.ctx).acceptsTransient();
  });
  if (!accepts) {
    check(
      `${p} the dock accepts transient panels (N1's controller in state/dock.ts)`,
      false,
      "acceptsTransient() is false: N0's stub of state/dock.ts is in the tree, N1's dock is not; the dock checks cannot run",
    );
    await context.close();
    return;
  }
  const pdf = pdfBytes('start-up');
  await writeFile(first.page, '/browser/viewer/start.pdf', pdf);
  const pictures = await makePictures(first.page, 640, 400);
  await writeFile(first.page, '/browser/viewer/pic.png', pictures.png);
  await writeFile(first.page, '/browser/prog.S68', asBytes('S00600004844521B\r\nS1071000303C00FFA1\r\nS9031000EC\r\n'));
  await writeFile(first.page, '/browser/viewer/data.bin', [1, 0, 2, 0, 3]);
  await first.page.close();

  // ?open= at start-up: the viewer once the Editor dock attaches; the Editor holds the template.
  const { page, errors } = await openApp(context, `${baseUrl}?open=/browser/viewer/start.pdf`);
  const viewer = page.locator(DOCK_VIEWER);
  const shown = await viewer
    .first()
    .locator('iframe')
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(`${p} ?open=/browser/viewer/start.pdf at start-up shows the viewer`, shown);
  const startDocs = await page.evaluate(() => {
    const { ctx } = window.__easy68k;
    const docs = ctx.store.getState().documents.items;
    return {
      docs: docs.map((doc) => [doc.name, doc.modified, doc.path]),
      template: docs[0] ? ctx.documents.text(docs[0].id) === ctx.settings.get().editor.template : false,
    };
  });
  check(
    `${p} at start-up the Editor holds the template document`,
    same(startDocs.docs, [['untitled1.x68', false, null]]) && startDocs.template,
    JSON.stringify(startDocs),
  );
  if (shown) {
    const src = await viewer.first().locator('iframe').getAttribute('src');
    const blob = await readBlob(page, src);
    check(
      `${p} the start-up PDF's frame: blob of type application/pdf with the file's bytes`,
      blob.type === 'application/pdf' && same(blob.bytes, pdf),
    );
    check(
      `${p} the viewer's element has the role tabpanel`,
      (await viewer.first().getAttribute('role')) === 'tabpanel',
    );
  }
  await page.screenshot({ path: join(outDir, `${name}-dock-startup.png`) });

  // A picture through the document service; a second open selects the same tab.
  const opened = await page.evaluate(() => window.__easy68k.ctx.documents.open('/browser/viewer/pic.png'));
  check(`${p} open() of a picture returns null (no document)`, opened === null);
  await page
    .locator(`${DOCK_VIEWER} img[alt="pic.png"]`)
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  const describe = () =>
    page.evaluate(async () => {
      const { dockOf } = await import('/src/state/dock.ts');
      return dockOf(window.__easy68k.ctx)
        .describe()
        .filter((entry) => entry.panel.startsWith('viewer:'));
    });
  const tabs = await describe();
  check(
    `${p} the tabs are titled with the files' names`,
    same(tabs.map((tab) => tab.title).sort(), ['pic.png', 'start.pdf']),
    JSON.stringify(tabs),
  );
  check(
    `${p} a viewer tab is in the group that holds the editor`,
    await page.evaluate(async () => {
      const { dockOf } = await import('/src/state/dock.ts');
      const list = dockOf(window.__easy68k.ctx).describe();
      const editor = list.find((entry) => entry.panel === 'editor');
      const viewers = list.filter((entry) => entry.panel.startsWith('viewer:'));
      return viewers.length > 0 && viewers.every((entry) => entry.group === editor?.group);
    }),
  );
  await page.evaluate(() => window.__easy68k.ctx.documents.open('/browser/viewer/pic.png'));
  check(`${p} a second open of the same path selects its tab (no second viewer)`, (await describe()).length === 2);
  await page.screenshot({ path: join(outDir, `${name}-dock-picture.png`) });
  if ((await page.locator(DOCK_VIEWER).count()) > 0) await scan(page, `${name} dock viewer`, DOCK_VIEWER);
  else check(`${p} a viewer tab is on screen for the axe scan`, false, 'no element [data-e68-panel^="viewer:"]');

  // Closing revokes the URL.
  const picId = (await describe()).find((tab) => tab.title === 'pic.png')?.panel;
  const picSrc = await page.locator(`${DOCK_VIEWER} img[alt="pic.png"]`).getAttribute('src');
  await page.evaluate(async (id) => {
    const { dockOf } = await import('/src/state/dock.ts');
    dockOf(window.__easy68k.ctx).closeTransient(id);
  }, picId);
  const rec = await recorded(page);
  check(
    `${p} closing a viewer tab revokes its blob: URL`,
    rec.revoked.includes(picSrc),
    `${picSrc} in ${rec.revoked.join(', ')}`,
  );
  check(`${p} the closed viewer is gone`, (await describe()).length === 1);

  // Open as Text from the tab.
  await page.evaluate(() => window.__easy68k.ctx.documents.open('/browser/viewer/data.bin'));
  const binViewer = page.locator(DOCK_VIEWER, { hasText: TEXTS.notice('data.bin') });
  await binViewer.waitFor({ timeout: 15_000 }).catch(() => {});
  await binViewer.locator('.e68-viewer__notice').getByRole('button', { name: TEXTS.openAsText }).click();
  await page
    .waitForFunction(() =>
      window.__easy68k.ctx.store.getState().documents.items.some((doc) => doc.path === '/browser/viewer/data.bin'),
    )
    .catch(() => {});
  const afterText = await describe();
  check(
    `${p} Open as Text in a tab opens the document and closes the viewer`,
    afterText.every((tab) => tab.title !== 'data.bin') &&
      (await page.evaluate(() =>
        window.__easy68k.ctx.store.getState().documents.items.some((doc) => doc.path === '/browser/viewer/data.bin'),
      )),
    JSON.stringify(afterText),
  );

  // Opening it again (an ordinary Open) while it is open as text: the viewer shows it, and the text
  // document the person has open stays open, unchanged (nothing a person has open is closed by an
  // Open; the gate's finding).
  const again = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    const before = ctx.store.getState().documents.items.find((doc) => doc.path === '/browser/viewer/data.bin');
    const result = await ctx.documents.open('/browser/viewer/data.bin');
    const after = ctx.store.getState().documents.items.find((doc) => doc.path === '/browser/viewer/data.bin');
    return { result: result === null ? null : 'document', before: before?.id ?? null, after: after?.id ?? null };
  });
  await page
    .locator(DOCK_VIEWER, { hasText: TEXTS.notice('data.bin') })
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  const againTabs = await describe();
  check(
    `${p} an Open of a file that is open as text shows the viewer and keeps the text document open`,
    again.result === null &&
      again.before !== null &&
      again.after === again.before &&
      againTabs.some((tab) => tab.title === 'data.bin'),
    `${JSON.stringify(again)}; ${JSON.stringify(againTabs)}`,
  );
  await page.evaluate(async () => {
    const { dockOf } = await import('/src/state/dock.ts');
    const dock = dockOf(window.__easy68k.ctx);
    for (const tab of dock.describe()) if (tab.title === 'data.bin') dock.closeTransient(tab.panel);
  });

  // Simulator Open... of an .S68 and EASyBIN's Open Binary are unchanged with the viewer on.
  const blobsBefore = (await recorded(page)).blobs.length;
  const sim = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    const dialogs = ctx.fileDialogs;
    const original = dialogs.open;
    try {
      await ctx.commands.run('app.mode.set', 'simulator');
      dialogs.open = async () => ['/browser/prog.S68'];
      await ctx.commands.run('sim.file.open');
      for (let i = 0; i < 100 && ctx.store.getState().sim.phase === 'loading'; i++)
        await new Promise((r) => setTimeout(r, 50));
      const program = ctx.store.getState().sim.program;
      await ctx.commands.run('app.mode.set', 'easybin');
      dialogs.open = async () => ['/browser/viewer/data.bin'];
      await ctx.commands.run('bin.file.openBinary');
      await ctx.commands.run('app.mode.set', 'editor');
      return { program: program ? (program.path ?? program.title ?? 'loaded') : null };
    } finally {
      dialogs.open = original;
    }
  });
  const blobsAfter = (await recorded(page)).blobs.slice(blobsBefore);
  check(
    `${p} Simulator Open... of an .S68 and EASyBIN's Open Binary open no viewer`,
    // A mode change closes the viewers (P4.4), so only new tabs for these files would count.
    (await describe()).every((tab) => tab.title !== 'prog.S68' && tab.title !== 'data.bin') &&
      blobsAfter.every((blob) => blob.type !== 'application/pdf' && !String(blob.type).startsWith('image/')),
    JSON.stringify({ sim, blobsAfter }),
  );
  if (enginesPresent) check(`${p} Simulator Open... still loads the .S68`, sim.program !== null, JSON.stringify(sim));
  else note(`${p} engine/dist is missing: whether the simulator loaded the .S68 is not checked`);

  // The viewer switch off: a PDF opens as text.
  const asText = await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    ctx.settings.update((s) => ({ ...s, app: { ...s.app, plus: { viewer: false, history: true } } }));
    const doc = await ctx.documents.open('/browser/viewer/start.pdf');
    ctx.settings.update((s) => ({ ...s, app: { ...s.app, plus: { viewer: true, history: true } } }));
    return doc ? doc.path : null;
  });
  check(`${p} with the viewer switch off a PDF opens as text`, asText === '/browser/viewer/start.pdf', `${asText}`);
  check(`${p} no window was opened`, popups.length === 0 && (await recorded(page)).opened === 0, popups.join(', '));
  check(`${p} no console errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---- the production build ---------------------------------------------------------------------

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

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.htm': 'text/html',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

/** Serves `root` under BASE only, like a project site of GitHub Pages. */
function serveStatic(root) {
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = url.pathname;
    }
    if (!path.startsWith(BASE)) {
      response.writeHead(path === BASE.slice(0, -1) ? 301 : 404, path === BASE.slice(0, -1) ? { location: BASE } : {});
      response.end();
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
      response.writeHead(404);
      response.end();
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    response.end(body);
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
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

/** What the frame of a viewer shows now, read from the page (`selector` finds the viewer's panel). */
const viewerFrameState = (page, selector) =>
  page.evaluate((css) => {
    const panel = document.querySelector(css);
    const frames = panel ? [...panel.querySelectorAll('iframe')] : [];
    const frame = frames[0] ?? null;
    let href;
    let app = false;
    try {
      href = frame?.contentWindow?.location.href ?? null;
      const doc = frame?.contentDocument;
      app = doc ? doc.querySelector('#root, .e68-shell, link[rel=manifest]') !== null : false;
    } catch {
      href = '(not readable)';
    }
    return {
      panel: panel !== null,
      frames: frames.length,
      src: frame?.getAttribute('src') ?? null,
      generation: frame?.getAttribute('data-e68-viewer-frame') ?? null,
      href,
      app,
    };
  }, selector);

/**
 * Decision D-c of the stage's gate (errata N6 14): the PDF frame never shows anything but the
 * viewer's document. The page runs without a service worker (as on a first visit before the worker
 * is installed, and as the desktop app always does), so nothing refuses the frame's navigation to
 * the application's own page: the frame is sent there (as a link inside the PDF or a script would),
 * and its document must be back within two seconds, with no copy of the application left in it, the
 * tab still open and nothing shown about it. A picture's viewer has no frame at all (an <img>
 * cannot be sent anywhere): asserted too.
 */
async function escapePass(browser, name, origin) {
  const p = `${name} production, no worker:`;
  const { context } = await newContext(browser, { noWorker: true });
  try {
    const { page, errors } = await openApp(context, `${origin}${BASE}`, { dev: false });
    const pictures = await makePictures(page, 400, 300);
    const stamp = `${name}-escape`;
    await dropFiles(page, [{ name: `${stamp}-report.pdf`, bytes: pdfBytes('escape'), type: 'application/pdf' }]);
    await page.locator('[data-e68-panel^="viewer:"] iframe').first().waitFor({ timeout: 30_000 });
    await dropFiles(page, [{ name: `${stamp}-photo.png`, bytes: pictures.png, type: 'image/png' }]);
    await page.locator('[data-e68-panel^="viewer:"] img').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await escapeChecks(page, p, origin, stamp);
    check(`${p} no console error`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}

async function escapeChecks(page, p, origin, stamp) {
  const controlled = await page.evaluate(() => navigator.serviceWorker?.controller != null);
  check(`${p} escape: no service worker controls the page`, !controlled);
  const pdf = page.locator('[data-e68-panel^="viewer:"]', { has: page.locator('iframe') }).filter({
    hasText: `${stamp}-report.pdf`,
  });
  const id = await pdf.first().getAttribute('data-e68-panel');
  const selector = `[data-e68-panel="${id}"]`;
  const before = await viewerFrameState(page, selector);
  const texts = await page.locator(selector).innerText();
  for (const [label, address] of [
    ["the application's page", `${origin}${BASE}index.html`],
    ["the application's ?open= address", `${origin}${BASE}?open=/browser/demo.X68`],
  ]) {
    await page.evaluate(
      (css) => document.querySelector(`${css} iframe`)?.setAttribute('data-e68-check-old', ''),
      selector,
    );
    const started = Date.now();
    await page.evaluate(
      ([css, url]) => document.querySelector(`${css} iframe`).contentWindow.location.replace(url),
      [selector, address],
    );
    // Back: the frame shows its blob again (Chromium reads it; WebKit reads about:blank for its own
    // PDF) and is a fresh frame, and the old one is gone.
    let state = null;
    let back = -1;
    while (Date.now() - started < 5000) {
      state = await viewerFrameState(page, selector);
      const old = await page.evaluate(() => document.querySelector('[data-e68-check-old]') !== null);
      if (!old && state.frames === 1 && !state.app && state.src === before.src && state.href !== address) {
        back = Date.now() - started;
        break;
      }
      await page.waitForTimeout(50);
    }
    check(
      `${p} escape: the PDF frame sent to ${label} shows its document again within 2 s`,
      back >= 0 && back <= 2000,
      `${back < 0 ? 'not back after 5 s' : `${back} ms`}: ${JSON.stringify(state)}`,
    );
    await page.waitForTimeout(3000);
    const later = await viewerFrameState(page, selector);
    const shells = await page.evaluate(() => document.querySelectorAll('.e68-shell').length);
    check(
      `${p} escape: after ${label}, 3 s later no copy of the application is in the frame, the tab is open and shows nothing new`,
      later.panel &&
        later.frames === 1 &&
        !later.app &&
        later.src === before.src &&
        later.href !== address &&
        shells === 1 &&
        (await page.locator(selector).innerText()) === texts,
      `${JSON.stringify(later)} shells=${shells}`,
    );
  }
  const picture = page.locator('[data-e68-panel^="viewer:"]', { has: page.locator('img') }).filter({
    hasText: `${stamp}-photo.png`,
  });
  const pictureFacts = await picture.first().evaluate((panel) => ({
    frames: panel.querySelectorAll('iframe, object, embed, frame').length,
    src: panel.querySelector('img')?.getAttribute('src') ?? '',
  }));
  check(
    `${p} escape: a picture's viewer has no frame that could be sent anywhere, only its <img> of a blob:`,
    pictureFacts.frames === 0 && /^blob:/.test(pictureFacts.src),
    JSON.stringify(pictureFacts),
  );
}

async function productionPass(browser, name, origin) {
  const p = `${name} production:`;
  const { context, popups } = await newContext(browser);
  const { page, errors } = await openApp(context, `${origin}${BASE}`, { dev: false });
  const policy = await page.evaluate(
    () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
  );
  check(
    `${p} the page carries the policy with frame-src 'self' blob:`,
    policy.includes("frame-src 'self' blob:"),
    policy,
  );
  const pictures = await makePictures(page, 800, 500);
  const stamp = name; // unique names per browser (each context has its own storage anyway)
  const benign = [
    { name: `${stamp}-report.pdf`, bytes: pdfBytes('production'), type: 'application/pdf', selector: 'iframe' },
    { name: `${stamp}-photo.png`, bytes: pictures.png, type: 'image/png', selector: 'img' },
    { name: `${stamp}-photo.jpg`, bytes: pictures.jpeg, type: 'image/jpeg', selector: 'img' },
    { name: `${stamp}-drawing.svg`, bytes: asBytes(SVG_PICTURE), type: 'image/svg+xml', selector: 'img' },
  ];
  for (const file of benign) {
    await dropFiles(page, [file]);
    const viewer = page.locator('[data-e68-panel^="viewer:"]', { has: page.locator(file.selector) }).filter({
      hasText: file.name,
    });
    const shown = await viewer
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check(
      `${p} ${file.name} dropped on the window opens in the viewer`,
      shown,
      shown ? '' : "no viewer appeared (is N1's dock in the tree?)",
    );
    if (!shown) continue;
    const src = await viewer.first().locator(file.selector).getAttribute('src');
    check(`${p} ${file.name}: its source is a blob: URL`, /^blob:/.test(src ?? ''), src);
    const rec = await recorded(page);
    const blob = rec.blobs.find((entry) => entry.url === src);
    check(`${p} ${file.name}: the blob's type is ${file.type}`, blob?.type === file.type, JSON.stringify(blob));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(outDir, `${name}-production-${file.name.replace(/\W/g, '-')}.png`) });
  }
  const rec = await recorded(page);
  check(
    `${p} no Content Security Policy violation with the viewers open`,
    rec.violations.length === 0,
    rec.violations.join(' | '),
  );
  check(`${p} no console error with the viewers open`, errors.length === 0, errors.join(' | '));

  // The HTML with a script, as x.pdf and x.svg, under the production policy.
  for (const file of [
    { name: `${stamp}-x.pdf`, bytes: asBytes(EVIL_HTML), type: 'application/pdf' },
    { name: `${stamp}-x.svg`, bytes: asBytes(EVIL_HTML), type: 'image/svg+xml' },
  ]) {
    await dropFiles(page, [file]);
    await page.waitForTimeout(2500);
    const trace = await scriptTrace(page);
    const after = await recorded(page);
    check(
      `${p} security: ${file.name} runs no script and opens no window`,
      trace === null && after.messages.length === 0 && after.opened === 0 && popups.length === 0,
      `key=${trace} messages=${after.messages.length} window.open=${after.opened} popups=${popups.join(', ')}`,
    );
  }
  await context.close();
}

/**
 * Chromium is started as Playwright's full Chromium in the new headless mode (channel 'chromium'),
 * which has the browser's own PDF viewer and reports navigator.pdfViewerEnabled true, as Chrome and
 * Edge do; Playwright's default headless shell has no PDF viewer (docs/requests/N0.md 5.1). Where
 * that build is not installed, the headless shell is used and the PDF frame becomes a note.
 */
async function launch(name) {
  if (name === 'chromium') {
    try {
      return await chromium.launch({ channel: 'chromium' });
    } catch (error) {
      const why = String(error).split('\n')[0];
      // In CI the full build is installed (npx playwright install chromium): there a missing build
      // must not turn the PDF frame's checks into a note (the gate's reviewer).
      if (requireFullChromium) check(`chromium: Playwright's full Chromium starts (required in CI)`, false, why);
      else note(`Chromium's full build could not start (${why}); using the headless shell`);
    }
  }
  return BROWSERS[name].launch();
}

// ---- main -------------------------------------------------------------------------------------

async function main() {
  const port = await freePort();
  // A cache of its own, emptied first: optimized dependencies left from an older tree (a new
  // dependency such as flexlayout-react) would need a page reload, which this check turns off.
  rmSync(join(outDir, 'vite-cache'), { recursive: true, force: true });
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(outDir, 'vite-cache'),
    // No hot reload: other packages' files change while this runs, and a reload would reset the pages.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  let dist = givenDist ? resolve(givenDist) : join(outDir, 'dist');
  let staticServer = null;
  try {
    for (const name of browsers) {
      const browser = await launch(name);
      try {
        for (const [label, pass] of [
          ['viewer', viewerPass],
          ['pdf-off', pdfOffPass],
          ['dock', dockPass],
        ]) {
          console.log(`\n[${name}, ${label}]`);
          try {
            await pass(browser, name);
          } catch (error) {
            check(`${name}: the ${label} pass ran to the end`, false, String(error?.stack ?? error));
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }

  // The production pass, against a build served under the Pages sub-path.
  try {
    if (!givenDist && !skipBuild) {
      rmSync(dist, { recursive: true, force: true });
      productionBuild(dist);
    }
    if (!existsSync(join(dist, 'index.html'))) throw new Error(`no production build at ${dist}`);
    staticServer = await serveStatic(dist);
    console.log(`\nProduction build: ${staticServer.origin}${BASE} (from ${dist})`);
    for (const name of browsers) {
      const browser = await launch(name);
      try {
        console.log(`\n[${name}, production]`);
        await productionPass(browser, name, staticServer.origin);
        console.log(`\n[${name}, production without a worker]`);
        await escapePass(browser, name, staticServer.origin);
      } catch (error) {
        check(`${name}: the production pass ran to the end`, false, String(error?.stack ?? error));
      } finally {
        await browser.close();
      }
    }
  } catch (error) {
    check('the production pass could start', false, String(error?.stack ?? error));
  } finally {
    staticServer?.server.close();
  }

  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ results, notes }, null, 2));
  const passed = results.filter((r) => r.ok).length;
  if (notes.length) console.log(`\nNotes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
