// Shared helpers of the release-candidate checks for items 7 and 12 of ARCHITECTURE.md 6.9
// (item-07-check-offline.mjs, item-12-check-part-a.mjs). Owner: I3. Not a check by itself.
//
// What it gives:
//   - parseArgs(): --browser chromium|webkit|all, --out <dir>, --dist <dir>, --keys mac|windows;
//   - productionBuild(): the production build to test - the folder of --dist, or a new
//     `vite build` of app/ into <out>/dist (never app/dist, which other people may be using);
//   - serveBuild(): Vite's preview server with the application's own configuration (its headers,
//     the production Content Security Policy included) on a free port, as tests/e2e/fixtures/serve.mjs;
//   - Report: "ok"/"FAIL"/"known" lines, "N of M checks passed", and the exit code;
//   - page helpers that act through the interface only, as a person does (the production build
//     has no page object): menus, the Files panel, the editor, the Assembler Status dialog, the
//     status bar, and the Output panel's text mirror for screen readers.
//
// Everything is written below build/ (git-ignored). Nothing here depends on Windows: paths are
// joined with node:path, the server takes a free port, keys are Playwright key names.

/* global document, DataTransfer, ClipboardEvent -- used inside page.evaluate() callbacks and init scripts, which run in the page */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');
export const appRoot = join(repoRoot, 'app');

/** Command-line options shared by both checks. */
export function parseArgs(defaultOut) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const browser = option('--browser', 'all');
  if (!['chromium', 'webkit', 'all'].includes(browser))
    throw new Error(`--browser ${browser}: chromium, webkit or all`);
  const keys = option('--keys', 'mac');
  if (!['mac', 'windows'].includes(keys)) throw new Error(`--keys ${keys}: mac or windows`);
  const outDir = resolve(option('--out', join(repoRoot, 'build', defaultOut)));
  mkdirSync(outDir, { recursive: true });
  const dist = option('--dist', null);
  return {
    browsers: browser === 'all' ? ['chromium', 'webkit'] : [browser],
    keys,
    outDir,
    dist: dist && resolve(dist),
  };
}

export const BROWSERS = { chromium, webkit };

/** Whether the engines are built (engine/dist); CI sets EASY68K_REQUIRE_ENGINES=1. */
export function enginesPresent() {
  const dist = join(repoRoot, 'engine', 'dist');
  return existsSync(join(dist, 'asm68k.wasm')) && existsSync(join(dist, 'sim68k.wasm'));
}

/** The production build to test: --dist as given, or a fresh `vite build` into <out>/dist. */
export function productionBuild(dist, outDir) {
  if (dist) {
    if (!existsSync(join(dist, 'index.html'))) throw new Error(`--dist ${dist}: no index.html there`);
    return dist;
  }
  const target = join(outDir, 'dist');
  const require = createRequire(join(appRoot, 'package.json'));
  const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  console.log(`Production build of app/ into ${target}`);
  const run = spawnSync(
    process.execPath,
    [viteBin, 'build', '--outDir', target, '--emptyOutDir', '--logLevel', 'warn'],
    {
      cwd: appRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  if (run.status !== 0) throw new Error(`vite build failed with exit code ${run.status}`);
  return target;
}

/** Serves a production build with the application's own configuration on a free port. */
export async function serveBuild(dist) {
  const server = await preview({
    root: appRoot,
    configFile: join(appRoot, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir: dist },
    preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('the preview server reported no address');
  return { url, close: () => server.close() };
}

/** Collects check results; prints them as the project's other checks do. */
export class Report {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.known = 0;
    this.failures = [];
  }
  check(name, ok, detail = '') {
    const text = detail ? ` - ${detail}` : '';
    if (ok) {
      this.passed += 1;
      console.log(`  ok   ${name}${text}`);
    } else {
      this.failed += 1;
      this.failures.push(name);
      console.log(`  FAIL ${name}${text}`);
    }
    return ok;
  }
  /** A check that fails at a defect already entered with its owner: printed, not counted as a failure. */
  knownDefect(name, ok, ref, detail = '') {
    const text = detail ? ` - ${detail}` : '';
    if (ok) {
      this.passed += 1;
      console.log(`  ok   ${name}${text} (it failed at ${ref}: that defect seems repaired)`);
    } else {
      this.known += 1;
      console.log(`  known ${name}${text} (${ref})`);
    }
  }
  note(text) {
    console.log(`  --   ${text}`);
  }
  finish() {
    const total = this.passed + this.failed;
    const known = this.known ? `; ${this.known} known defect(s) printed as "known", not counted` : '';
    console.log(`\n${this.passed} of ${total} checks passed${this.failed ? `, ${this.failed} failed` : ''}${known}.`);
    if (this.failed) for (const name of this.failures) console.log(`  failed: ${name}`);
    process.exitCode = this.failed ? 1 : 0;
  }
}

/** The value `navigator.platform` reports for a key map (what platform/web.ts detectOs reads). */
export const platformOf = (keys) => (keys === 'mac' ? 'MacIntel' : 'Win32');

/** Runs in the page before the application starts (as tests/e2e/fixtures/keys.ts pretendPlatform). */
export function pretendPlatform(platform) {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform, configurable: true });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
}

/** A new context and page with the chosen key map; console errors and page errors are collected. */
export async function openPage(browser, { keys, serviceWorkers = 'block' }) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    serviceWorkers,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(pretendPlatform, platformOf(keys));
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return { context, page, errors };
}

/** Waits until the shell is drawn and, in Editor mode, the editor. */
export async function ready(page) {
  await page.locator('.e68-shell').waitFor({ timeout: 90_000 });
  if ((await page.locator('.e68-shell').getAttribute('data-mode')) === 'editor') {
    await page.locator('.e68-editor').first().waitFor({ timeout: 90_000 });
  }
}

export const mode = (page) => page.locator('.e68-shell').getAttribute('data-mode');

/** Polls `probe` until it returns a truthy value or `timeout` ms pass; returns the last value. */
export async function until(probe, timeout = 30_000, interval = 200) {
  const end = Date.now() + timeout;
  let value;
  for (;;) {
    try {
      value = await probe();
    } catch {
      value = undefined;
    }
    if (value || Date.now() > end) return value;
    await new Promise((done) => setTimeout(done, interval));
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens a menu of the menu bar and returns its entries (caption and shortcut as drawn). */
export async function menuEntries(page, title) {
  await page
    .locator('.e68-shell__menubar .e68-menubar__title')
    .filter({ hasText: new RegExp(`^${escapeRegExp(title)}$`) })
    .click();
  const menu = page.locator('[role=menu][data-e68-menu]').last();
  await menu.waitFor();
  const entries = await menu.locator(':scope > [role^=menuitem]').evaluateAll((items) =>
    items.map((item) => ({
      caption: item.querySelector('.e68-menu__caption')?.textContent ?? '',
      shortcut: item.querySelector('.e68-menu__shortcut')?.textContent ?? '',
      disabled: item.getAttribute('aria-disabled') === 'true',
    })),
  );
  return { menu, entries };
}

/** Chooses `caption` in the menu `title`; throws when the entry is not there. */
export async function chooseMenu(page, title, caption) {
  const { menu, entries } = await menuEntries(page, title);
  if (!entries.some((entry) => entry.caption === caption)) {
    await page.keyboard.press('Escape');
    throw new Error(`menu ${title} has no entry "${caption}" (it has: ${entries.map((e) => e.caption).join(', ')})`);
  }
  await menu
    .locator(':scope > [role^=menuitem]')
    .filter({ has: page.locator('.e68-menu__caption', { hasText: new RegExp(`^${escapeRegExp(caption)}$`) }) })
    .click();
}

/** A row of the Files panel's tree by its name. */
export function treeItem(page, name) {
  return page
    .locator('[data-e68-panel="files"] [role=treeitem]')
    .filter({ has: page.locator('.e68-files__name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) })
    .first();
}

/** The document tabs of the first editor pane. */
export async function tabs(page) {
  return page.locator('.e68-editor__pane[data-pane="0"] [role=tab]').evaluateAll((list) =>
    list.map((tab) => ({
      name: tab.querySelector('.e68-tabs__label')?.textContent ?? '',
      selected: tab.getAttribute('aria-selected') === 'true',
    })),
  );
}

/** Gives the editor of the first pane the focus. */
export async function focusEditor(page) {
  const content = page.locator('.e68-editor__pane[data-pane="0"] .cm-content');
  await content.click({ position: { x: 40, y: 10 } });
}

/** Replaces the text of the active document as the manual says: Select All, then a paste. */
export async function replaceText(page, keys, text) {
  await focusEditor(page);
  await page.keyboard.press(keys === 'mac' ? 'Meta+KeyA' : 'Control+KeyA');
  await page.locator('.e68-editor__pane[data-pane="0"] .cm-content').evaluate((element, plain) => {
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** A dialog by its exact title. */
export function dialog(page, title) {
  return page
    .locator('[role=dialog], [role=alertdialog]')
    .filter({ has: page.locator('.e68-dialog__title', { hasText: new RegExp(`^${escapeRegExp(title)}$`) }) });
}

/** The status bar's run state in Simulator mode (Stopped, Running, Halted, ...). */
export const runState = (page) =>
  page
    .locator('[data-e68-status="run"]')
    .textContent()
    .then((text) => (text ?? '').trim());

const NBSP = new RegExp(String.fromCharCode(160), 'g');

/** The Output panel's text mirror, one string per line, trailing blanks removed. */
export async function outputText(page) {
  const rows = await page
    .locator(
      '[data-e68-workspace="simulator"] [data-e68-panel="output"] [role=log][aria-label="Text of the Output panel"] > div',
    )
    .allTextContents();
  return rows.map((row) => row.replace(NBSP, ' ').replace(/\s+$/, ''));
}

/** The program's keyboard: clicks into the Output panel (as the manual says) and waits for its field. */
export async function clickOutput(page) {
  await page
    .locator('[data-e68-workspace="simulator"] [data-e68-panel="output"] canvas')
    .first()
    .click({ position: { x: 20, y: 20 } });
  await until(() => page.evaluate(() => document.activeElement?.getAttribute('data-e68-keys') === 'program'));
}

/** The four lines tutorial1.X68 writes (docs/MANUAL-TEST-MAC.md A1 step 6). */
export const TUTORIAL1_LINES = ['D1 contains: 8', 'D2 contains: 520', 'D3 contains: 68020', 'Program End'];

/**
 * Check A1 of docs/MANUAL-TEST-MAC.md step by step, as written there: Help > Examples..., double-click
 * tutorial1.X68, F9, Execute, F9, the four lines and `Halted`. Returns whether every step held.
 */
export async function walkA1(page, report, prefix, shot, { manualWording = true } = {}) {
  let all = true;
  const step = (name, ok, detail) => {
    all = report.check(`${prefix}A1: ${name}`, ok, detail) && all;
    return ok;
  };
  await chooseMenu(page, 'Help', 'Examples...');
  const folder = await until(() => treeItem(page, 'Examples').isVisible(), 30_000);
  step('step 2: Help > Examples... shows the Files panel with a folder Examples', Boolean(folder));
  await shot('a1-examples');
  const file = treeItem(page, 'tutorial1.X68');
  let listed = await until(() => file.isVisible(), 10_000);
  const expanded = await treeItem(page, 'Examples').getAttribute('aria-expanded');
  const wording =
    'step 3 as written: tutorial1.X68 is listed in the panel right after Help > Examples... (the manual says "Double-click tutorial1.X68")';
  if (manualWording) step(wording, Boolean(listed), `folder Examples aria-expanded=${expanded}`);
  else
    report.note(
      `${prefix}A1: ${wording}: ${listed ? 'yes' : 'no'} (folder Examples aria-expanded=${expanded}; judged by item-12-check-part-a.mjs)`,
    );
  if (!listed && folder) {
    // What a person does next: open the folder (Right arrow on the selected folder, or its arrow).
    await treeItem(page, 'Examples').click();
    await page.keyboard.press('ArrowRight');
    listed = await until(() => file.isVisible(), 10_000);
    report.note(
      `${prefix}A1: after a click on Examples and Right arrow, tutorial1.X68 is ${listed ? '' : 'still not '}listed`,
    );
  }
  if (!listed) return false;
  await file.dblclick();
  const opened = await until(
    async () => (await tabs(page)).find((tab) => tab.selected)?.name === 'tutorial1.X68',
    30_000,
  );
  step('step 3: a double-click opens it in the editor', Boolean(opened), JSON.stringify(await tabs(page)));
  await shot('a1-editor');
  await focusEditor(page);
  await page.keyboard.press('F9');
  const status = dialog(page, 'Assembler Status - tutorial1.X68');
  const shown = await until(() => status.isVisible(), 90_000);
  const text = shown ? (await status.innerText()).replace(/\s+/g, ' ') : '';
  step(
    'step 4: F9 opens "Assembler Status - tutorial1.X68" with 0 warnings and 0 errors',
    Boolean(shown) && /Warnings:\s*0\b/.test(text) && /Errors:\s*0\b/.test(text),
    text.slice(0, 160),
  );
  await shot('a1-assembler-status');
  if (!shown) return false;
  await status.getByRole('button', { name: 'Execute', exact: true }).click();
  const simulator = await until(async () => (await mode(page)) === 'simulator', 30_000);
  const listing = await until(
    () => page.locator('[data-e68-panel="listing"] [role=option]').first().isVisible(),
    30_000,
  );
  step('step 5: Execute switches to Simulator mode with the program loaded', Boolean(simulator && listing));
  // Step 6 says only "Press F9": no click in between (the focus goes to the Listing, Q1-2).
  await until(async () => (await runState(page)) !== '', 10_000);
  await page.keyboard.press('F9');
  const halted = await until(async () => (await runState(page)) === 'Halted', 60_000);
  const lines = await until(async () => {
    const out = await outputText(page);
    return TUTORIAL1_LINES.every((line) => out.includes(line)) ? out : null;
  }, 15_000);
  step(
    'step 6: F9 runs it: the four lines in the Output panel and "Halted" in the status bar',
    Boolean(halted && lines),
    `state "${await runState(page)}", output ${JSON.stringify((await outputText(page)).filter(Boolean))}`,
  );
  await shot('a1-halted');
  return all;
}

/** The code blocks of docs/MANUAL-TEST-MAC.md after "## The three test programs": echo, keys, fonts. */
export function manualPrograms() {
  const text = readFileSync(join(repoRoot, 'docs', 'MANUAL-TEST-MAC.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('## The three test programs');
  const end = text.indexOf('## Part A');
  const section = text.slice(start, end);
  const programs = {};
  for (const match of section.matchAll(/^\*\*(echo|keys|fonts)\*\*[\s\S]*?^```\n([\s\S]*?)^```/gm))
    programs[match[1]] = match[2];
  return programs;
}
