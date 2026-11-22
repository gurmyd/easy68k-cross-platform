// The application in a headless browser, for the accessibility audit (tests/a11y/check-a11y.mjs).
// Owner: Q1.
//
// Starts the Vite development server of app/ on a free port and opens the real application in
// Chromium or WebKit with the Windows or the macOS key map (the page is told which system it runs
// on before it starts, as app/src/ui/shell/check-shell.mjs does). The page object
// `window.__easy68k` (development builds only, app/src/main.tsx) is used to READ state; the
// walk-throughs act through the keyboard alone.

/* global document, window -- used inside page callbacks, which run in the page */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { isSafariTabStop, playwrightKey } from './keys.mjs';

/** The first page load of the dev server can take minutes on a busy machine. */
export const LOAD_TIMEOUT = 240_000;
/** One step of a walk-through (a dialog appearing, an assembly, a program reaching its input). */
export const STEP_TIMEOUT = 30_000;

/**
 * Starts the dev server; returns its base URL and a function that stops it.
 * @param {{ appRoot: string, outDir: string }} options
 */
export async function startServer({ appRoot, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // A cache of its own: several checks may run on one machine at the same time.
    cacheDir: join(outDir, 'vite-cache'),
    // Port 0: the system picks a free one. No file watching and no reload: other people's edits
    // elsewhere in the tree must not reload the page in the middle of a walk-through.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (typeof address !== 'object' || !address) throw new Error('The dev server has no address');
  return { baseUrl: `http://127.0.0.1:${address.port}/`, stop: () => server.close() };
}

/** Whether engine/dist holds both engines. */
export const enginesPresent = (repoRoot) =>
  existsSync(join(repoRoot, 'engine', 'dist', 'asm68k.wasm')) &&
  existsSync(join(repoRoot, 'engine', 'dist', 'sim68k.wasm'));

function pretendSystem(os) {
  const platform = os === 'mac' ? 'MacIntel' : 'Win32';
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

/**
 * A browser context with the key map of `os`.
 * @param {import('@playwright/test').Browser} browser
 * @param {'windows' | 'mac'} os
 * @param {{ reducedMotion?: 'reduce' | 'no-preference', colorScheme?: 'light' | 'dark' }} [options]
 */
export async function newContext(browser, os, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    reducedMotion: options.reducedMotion ?? 'reduce',
    colorScheme: options.colorScheme ?? 'light',
  });
  await context.addInitScript(pretendSystem, os);
  context.setDefaultTimeout(STEP_TIMEOUT);
  return context;
}

/**
 * Opens the application and waits until it has started (the simulator session included).
 * `query` (for example `?storage-notice=1`) is appended to the address.
 * `errors` collects console errors and page errors.
 */
export async function openApp(context, baseUrl, query = '') {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${baseUrl}${query}`, { timeout: LOAD_TIMEOUT });
  await waitForApp(page);
  return { page, errors };
}

export async function waitForApp(page) {
  await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: LOAD_TIMEOUT });
  await page.waitForFunction(() => window.__easy68k.ctx.store.getState().sim.phase !== 'loading', null, {
    timeout: 60_000,
  });
}

/** `predicate` in the page becomes truthy within `timeout`; resolves true or false. */
export const waitFor = (page, predicate, arg, timeout = STEP_TIMEOUT) =>
  page.waitForFunction(predicate, arg, { timeout }).then(
    () => true,
    () => false,
  );

/** The current mode. */
export const modeOf = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().mode);

/** The ids of the open dialogs, bottom first. */
export const dialogStack = (page) =>
  page.evaluate(() => window.__easy68k.ctx.store.getState().dialogs.stack.map((dialog) => dialog.id));

/** A short description of the focused element, for the log and for failures. */
export const focusOf = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return { what: 'body', panel: null, dialog: null };
    const panel = element.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? null;
    const box = element.closest('[role=dialog], [role=alertdialog]');
    const dialog = box
      ? (document.getElementById(box.getAttribute('aria-labelledby') ?? '')?.textContent ?? '?')
      : null;
    const name =
      element.getAttribute('aria-label') ?? (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
    return { what: `${role} "${name}"`, panel, dialog };
  });
export const describeFocus = (focus) =>
  `${focus.what}${focus.panel ? ` in panel ${focus.panel}` : ''}${focus.dialog ? ` in dialog "${focus.dialog}"` : ''}`;

/** The chords of a command on the page's key map, from the application's own table (browser, not desktop). */
export const chordsOf = (page, id) =>
  page.evaluate(async (commandId) => {
    const { chordsOn } = await import('/src/commands/specs.ts');
    return chordsOn(commandId, window.__easy68k.ctx.platform.os, false);
  }, id);

/**
 * Presses the first chord of a command on the page's key map, held for 60 ms (6.6: "hold keys").
 * Returns the chord pressed.
 */
export async function pressCommand(page, id) {
  const chords = await chordsOf(page, id);
  if (chords.length === 0) throw new Error(`${id} has no chord on this key map`);
  await page.keyboard.press(playwrightKey(chords[0]), { delay: 60 });
  return chords[0];
}

/** The modifier of the platform's editing chords: Cmd on the macOS key map, Ctrl elsewhere. */
export const primary = (os) => (os === 'mac' ? 'Meta' : 'Control');

/**
 * Tab (or Shift+Tab) as the browser of the key map moves it: on the macOS key map, Tab is
 * pressed again while the focus is on an element Safari would have skipped (keys.mjs). Returns
 * how many presses it took.
 */
export async function tab(page, os, backward = false) {
  const key = backward ? 'Shift+Tab' : 'Tab';
  for (let presses = 1; presses <= 80; presses++) {
    await page.keyboard.press(key);
    if (os !== 'mac') return presses;
    const focused = await page.evaluateHandle(() => document.activeElement ?? document.body);
    const onBody = await focused.evaluate((element) => element === document.body);
    const stops = onBody || (await focused.evaluate(isSafariTabStop));
    await focused.dispose();
    if (stops) return presses;
  }
  throw new Error('Tab found no stop in 80 presses');
}

/** Tabs until `predicate(focus)` holds, at most `limit` stops; returns the focus or null. */
export async function tabUntil(page, os, predicate, limit = 40, backward = false) {
  for (let i = 0; i < limit; i++) {
    await tab(page, os, backward);
    const focus = await focusOf(page);
    if (predicate(focus)) return focus;
  }
  return null;
}

/** The text of the active document's editor. */
export const editorText = (page) =>
  page.evaluate(() => {
    const id = window.__easy68k.ctx.store.getState().documents.activeId;
    return document.querySelector(`[data-e68-document="${id}"]`)?.e68View.state.doc.toString() ?? null;
  });

/**
 * Types a program into the focused editor line by line with the keyboard. The editor's Auto
 * Indent gives a new line the leading blanks of the line before (2.4); a line that starts further
 * left selects those blanks first (Shift+Home) and types over them, as a person would.
 */
export async function typeLines(page, lines) {
  let indent = 0;
  for (const line of lines) {
    const want = /^ */.exec(line)[0].length;
    if (want < indent) {
      await page.keyboard.press('Shift+Home');
      await page.keyboard.type(line);
    } else {
      await page.keyboard.type(line.slice(indent));
    }
    indent = want;
    await page.keyboard.press('Enter');
  }
}

/** Screenshot below the output folder. */
export const shoot = (page, outDir, name) => page.screenshot({ path: join(outDir, `${name}.png`) }).catch(() => {});
