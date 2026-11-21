// Browser check of Find, Find Next and Replace of Editor mode (ARCHITECTURE.md 9.4 E6; editor-ui
// §14, §20.6; note 7). Owner: E6.
//
//   node app/src/features/find/check-find.mjs [--browser chromium|webkit|all] [--out <dir>] [--keys mac|windows]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright), with real key events through the application's
// dispatcher into the dialogs and the editor:
//
//   - Ctrl+F (Cmd+F on a Mac) with a word selected preloads it into the modeless Find dialog, whose
//     `Find  (F3)` button has the focus; Enter finds the next occurrence after the selection and the
//     editor takes the focus; at the end `End of document reached.` and the selection collapses to
//     its start; the following F3 starts from the top (20.6);
//   - without a selection the search starts at the caret (note 7);
//   - Match case and Match whole word only behave as named;
//   - the dialog is modeless: typing in the editor works while it is open; it hides in Simulator
//     mode and comes back in Editor mode; Cancel closes it;
//   - Find And Replace: both boxes take the selection; Replace All D0 -> D1 on three occurrences
//     replaces all three, shows the box once, and one Undo restores the text (20.6);
//   - an accessibility scan (axe-core) of the two dialogs in both themes; no console errors.
//
// KEYS: the page is given the key map of the system the check runs on (macOS on a Mac, Windows
// elsewhere); every command chord is read from the application's chord table (`chordsOn()`), as
// app/src/ui/editor/check-editor.mjs does. Screenshots go to build/E6/find-check unless --out says
// otherwise (always below build/). Exit code 0 = every check passed.

/* global console, process, document, window, Navigator -- browser globals are used inside page.evaluate() callbacks */

import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'E6', 'find-check')));
const fromBuild = relative(join(repoRoot, 'build'), outDir);
if (fromBuild === '' || fromBuild === '..' || fromBuild.startsWith(`..${sep}`) || isAbsolute(fromBuild)) {
  console.error(`--out must be a folder below ${join(repoRoot, 'build')} (given: ${outDir})`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const keysChoice = option('--keys', process.platform === 'darwin' ? 'mac' : 'windows');
if (keysChoice !== 'mac' && keysChoice !== 'windows') {
  console.error('--keys must be mac or windows');
  process.exit(2);
}
if (!['chromium', 'webkit', 'all'].includes(browserChoice)) {
  console.error('--browser must be chromium, webkit or all');
  process.exit(2);
}

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const PAGE_READY_MS = 120_000;

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- helpers --------------------------------------------------------------------------

function pretendSystem(keys) {
  const platform = keys === 'mac' ? 'MacIntel' : 'Win32';
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

const PLAYWRIGHT_MODIFIERS = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Cmd: 'Meta' };
function playwrightKey(chord) {
  const parts = chord.split('+');
  const key = parts.pop();
  const name = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key === 'Esc' ? 'Escape' : key;
  return [...parts.map((modifier) => PLAYWRIGHT_MODIFIERS[modifier]), name].join('+');
}

const chordsOf = (page, id) =>
  page.evaluate(async (id) => {
    const { chordsOn } = await import('/src/commands/specs.ts');
    return chordsOn(id, window.__easy68k.ctx.platform.os, false);
  }, id);

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendSystem, keysChoice);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const ready = async () => {
    await page.goto(baseUrl, { timeout: PAGE_READY_MS });
    await page.waitForSelector('.e68-shell', { timeout: PAGE_READY_MS });
    await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: PAGE_READY_MS });
    await page.waitForSelector('.e68-editor .cm-editor', { timeout: PAGE_READY_MS });
  };
  try {
    await ready();
  } catch (error) {
    console.log(`        the page did not come up (${String(error?.message ?? error).split('\n')[0]}); retrying once`);
    errors.length = 0;
    await ready();
  }
  return { context, page, errors };
}

/** Replaces the text of the shown document and selects anchor..head (default: caret at 0). */
async function setText(page, text, anchor = 0, head = anchor) {
  await page.evaluate(
    ({ text, anchor, head }) => {
      const view = document.querySelector('[data-e68-document]').e68View;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor, head } });
      view.focus();
    },
    { text, anchor, head },
  );
  // Longer than the history's grouping delay, so that what follows is an undo step of its own.
  await page.waitForTimeout(600);
}

async function select(page, anchor, head = anchor) {
  await page.evaluate(
    ({ anchor, head }) => {
      const view = document.querySelector('[data-e68-document]').e68View;
      view.dispatch({ selection: { anchor, head } });
      view.focus();
    },
    { anchor, head },
  );
}

const selection = (page) =>
  page.evaluate(() => {
    const main = document.querySelector('[data-e68-document]').e68View.state.selection.main;
    return [main.from, main.to];
  });
const docText = (page) =>
  page.evaluate(() => document.querySelector('[data-e68-document]').e68View.state.doc.toString());
const editorFocused = (page) => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const findDialog = (page) => page.getByRole('dialog', { name: 'Find', exact: true });
const replaceDialog = (page) => page.getByRole('dialog', { name: 'Replace', exact: true });
const endBox = (page) => page.getByRole('alertdialog').filter({ hasText: 'End of document reached.' });

/** Waits for the `End of document reached.` box; true when it came. Leaves it open. */
async function waitEndBox(page) {
  return endBox(page)
    .waitFor({ timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
}

/** Closes the box with Enter (its OK button has the focus) and waits until it is gone. */
async function closeEndBox(page) {
  await page.keyboard.press('Enter');
  await endBox(page).waitFor({ state: 'detached', timeout: 8000 });
}

const waitSelection = (page, expected) =>
  page
    .waitForFunction(
      (expected) => {
        const main = document.querySelector('[data-e68-document]').e68View.state.selection.main;
        return main.from === expected[0] && main.to === expected[1];
      },
      expected,
      { timeout: 8000 },
    )
    .then(
      () => true,
      () => false,
    );

async function shot(page, name) {
  await page.screenshot({ path: join(outDir, `${name}.png`) });
}

async function scan(page, label, selector) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious finding`, serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

// --- the checks ------------------------------------------------------------------------

const LOOP_TEXT = 'LOOP MOVE D0,D1\n BRA LOOP\n DBRA D2,LOOP\n';

async function findPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  const findChords = await chordsOf(page, 'ed.edit.find');
  const nextChords = await chordsOf(page, 'ed.edit.findNext');
  console.log(`        chords: find ${findChords.join(' / ')}, find next ${nextChords.join(' / ')}`);

  for (const [index, chord] of findChords.entries()) {
    // 20.6, first item: a word selected, Ctrl+F, Enter.
    await setText(page, LOOP_TEXT, 21, 25);
    await page.keyboard.press(playwrightKey(chord));
    const shown = await findDialog(page)
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    check(`${p} ${chord} opens the Find dialog`, shown);
    const input = findDialog(page).getByLabel('Find what:');
    check(`${p} ${chord}: the selected word is the Find text`, (await input.inputValue()) === 'LOOP');
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    check(
      `${p} ${chord}: the Find  (F3) button has the focus`,
      focused.includes('Find  (F3)'),
      JSON.stringify(focused),
    );
    if (index === 0) await shot(page, `${name}-find-dialog`);
    await page.keyboard.press('Enter');
    check(`${p} Enter selects the next occurrence after the selection`, await waitSelection(page, [35, 39]));
    check(`${p} the editor has the focus after a match`, await editorFocused(page));
    if (index === 0) await shot(page, `${name}-found`);
    // F3 (and every other Find Next chord): End of document reached, then from the top.
    const next = nextChords[index % nextChords.length];
    await page.keyboard.press(playwrightKey(next));
    const box = await waitEndBox(page);
    check(`${p} ${next} at the end shows End of document reached.`, box);
    if (index === 0 && box) await shot(page, `${name}-end-of-document`);
    if (box) await closeEndBox(page);
    check(
      `${p} the selection collapsed to its start`,
      await waitSelection(page, [35, 35]),
      JSON.stringify(await selection(page)),
    );
    await page.keyboard.press(playwrightKey(next));
    check(`${p} the following ${next} starts from the top`, await waitSelection(page, [0, 4]));
    if (index < findChords.length - 1) {
      await findDialog(page).getByRole('button', { name: 'Cancel' }).click();
      await findDialog(page).waitFor({ state: 'detached', timeout: 8000 });
    }
  }

  // Note 7: without a selection from the caret.
  await setText(page, 'D0 D0 D0', 2);
  const input = findDialog(page).getByLabel('Find what:');
  await input.fill('D0');
  await findDialog(page).getByRole('button', { name: 'Find  (F3)' }).click();
  check(`${p} without a selection the search starts at the caret (note 7)`, await waitSelection(page, [3, 5]));

  // Match case and whole word.
  await setText(page, 'd0 xD0 D00 D0');
  await input.fill('D0');
  await findDialog(page).getByLabel('Match case').check();
  await findDialog(page).getByLabel('Match whole word only').check();
  await select(page, 0);
  await findDialog(page).getByRole('button', { name: 'Find  (F3)' }).click();
  check(`${p} Match case + whole word find only the exact word`, await waitSelection(page, [11, 13]));
  await findDialog(page).getByLabel('Match whole word only').uncheck();
  await select(page, 0);
  await findDialog(page).getByRole('button', { name: 'Find  (F3)' }).click();
  check(`${p} Match case alone finds D0 inside xD0`, await waitSelection(page, [4, 6]));
  await findDialog(page).getByLabel('Match case').uncheck();
  await select(page, 0);
  await findDialog(page).getByRole('button', { name: 'Find  (F3)' }).click();
  check(`${p} without options d0 matches D0`, await waitSelection(page, [0, 2]));

  // An empty box disables the button.
  await input.fill('');
  check(
    `${p} the button is disabled while the box is empty`,
    await findDialog(page).getByRole('button', { name: 'Find  (F3)' }).isDisabled(),
  );
  await input.fill('xD0');

  // Modeless: the editor takes typing while the dialog is open.
  await select(page, 0);
  await page.keyboard.type('Q');
  check(`${p} the editor takes typing while the dialog is open (modeless)`, (await docText(page)).startsWith('Qd0'));

  // Simulator mode hides the dialog; Editor mode shows it again with its text.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'simulator'));
  const hidden = await findDialog(page)
    .waitFor({ state: 'detached', timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  check(`${p} the dialog is not shown in Simulator mode`, hidden);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'editor'));
  await findDialog(page).waitFor({ timeout: 8000 });
  check(`${p} back in Editor mode the dialog is there with its text`, (await input.inputValue()) === 'xD0');

  await findDialog(page).getByRole('button', { name: 'Cancel' }).click();
  const closed = await findDialog(page)
    .waitFor({ state: 'detached', timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
  check(`${p} Cancel closes the dialog`, closed);
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function replacePass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  const replaceChords = await chordsOf(page, 'ed.edit.replace');
  const undoChords = await chordsOf(page, 'ed.edit.undo');
  console.log(`        chords: replace ${replaceChords.join(' / ')}, undo ${undoChords.join(' / ')}`);

  const original = ' MOVE.L D0,(A0)\n ADD.W D0,D2\n CLR.B D0\n';
  for (const [index, chord] of replaceChords.entries()) {
    await setText(page, original, 8, 10);
    await page.keyboard.press(playwrightKey(chord));
    const shown = await replaceDialog(page)
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    check(`${p} ${chord} opens the Replace dialog`, shown);
    const what = replaceDialog(page).getByLabel('Find what:');
    const withText = replaceDialog(page).getByLabel('Replace with');
    check(
      `${p} ${chord}: both boxes take the selection`,
      (await what.inputValue()) === 'D0' && (await withText.inputValue()) === 'D0',
    );
    await withText.fill('D1');
    await select(page, 0);
    if (index === 0) await shot(page, `${name}-replace-dialog`);
    await replaceDialog(page).getByRole('button', { name: 'Replace All' }).click();
    const box = await waitEndBox(page);
    check(`${p} Replace All ends with End of document reached.`, box);
    const boxes = await page.getByRole('alertdialog').count();
    check(`${p} the box is shown once`, boxes === 1, String(boxes));
    if (box) await closeEndBox(page);
    const replaced = await docText(page);
    check(
      `${p} Replace All D0 -> D1 replaced all three occurrences`,
      replaced === ' MOVE.L D1,(A0)\n ADD.W D1,D2\n CLR.B D1\n',
      JSON.stringify(replaced),
    );
    // One Undo restores the text.
    await page.locator('.e68-editor .cm-content').click();
    await page.keyboard.press(playwrightKey(undoChords[index % undoChords.length]));
    await page.waitForTimeout(200);
    check(`${p} one Undo restores the text`, (await docText(page)) === original, JSON.stringify(await docText(page)));
    await replaceDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await replaceDialog(page).waitFor({ state: 'detached', timeout: 8000 });
  }

  // Replace: a selected match is replaced and the next one selected; a non-matching selection is not.
  await setText(page, 'D0 xx D0 D0', 0, 5);
  await page.keyboard.press(playwrightKey(replaceChords[0]));
  await replaceDialog(page).waitFor({ timeout: 8000 });
  await replaceDialog(page).getByLabel('Find what:').fill('D0');
  await replaceDialog(page).getByLabel('Replace with').fill('D7');
  await select(page, 0, 5);
  await replaceDialog(page).getByRole('button', { name: 'Replace', exact: true }).click();
  await waitSelection(page, [6, 8]);
  check(
    `${p} Replace leaves a non-matching selection and replaces the next match (note 7)`,
    (await docText(page)) === 'D7 xx D0 D0' && same(await selection(page), [6, 8]),
    `${JSON.stringify(await docText(page))} ${JSON.stringify(await selection(page))}`,
  );
  await replaceDialog(page).getByRole('button', { name: 'Replace', exact: true }).click();
  await waitSelection(page, [9, 11]);
  check(`${p} Replace on the selected match replaces it and selects the next`, (await docText(page)) === 'D7 xx D7 D0');

  // Both dialogs at once, in both themes, with an accessibility scan.
  await page.keyboard.press(playwrightKey((await chordsOf(page, 'ed.edit.find'))[0]));
  await findDialog(page).waitFor({ timeout: 8000 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), theme);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
    await shot(page, `${name}-both-dialogs-${theme}`);
    await scan(page, `${name} ${theme} Find dialog`, '.e68-find-dialog--find');
    await scan(page, `${name} ${theme} Replace dialog`, '.e68-find-dialog--replace');
  }
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.e68-find-dialog')].map((element) => {
      const r = element.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, right: Math.round(window.innerWidth - r.right) };
    }),
  );
  check(
    `${p} the two dialogs sit at the top right without covering each other`,
    boxes.length === 2 &&
      boxes.every((b) => b.right < 80) &&
      (boxes[0].bottom <= boxes[1].top || boxes[1].bottom <= boxes[0].top),
    JSON.stringify(boxes),
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- run -------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No file watching and no hot reload: other packages edit files while this runs.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      const passes = [
        ['find', findPass],
        ['replace', replacePass],
      ];
      try {
        for (const [label, pass] of passes) {
          console.log(`\n[${name}, ${label}]`);
          try {
            await pass(browser, name);
          } catch (error) {
            check(
              `${name}: the ${label} pass ran to its end`,
              false,
              String(error?.stack ?? error)
                .split('\n')
                .slice(0, 4)
                .join(' | '),
            );
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
