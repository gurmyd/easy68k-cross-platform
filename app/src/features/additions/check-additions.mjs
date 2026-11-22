// Browser check of work package N7 (Options > Port Additions..., ARCHITECTURE-PLUS P3.5): the dialog
// drawn and used in the real application, with the real history store of the page (N3) and the
// browser's storage estimate. The unit tests under Node (additions.test.ts) reach the dialog only
// through its actions and figures. Owner: N7.
//
//   node app/src/features/additions/check-additions.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives headless Chromium and WebKit
// (Playwright):
//
//   - the menu item at the end of the Editor's and the Simulator's Options menus opens the modal
//     dialog `Port Additions`; every text of P3.5 (boxes, group, labels, the sentence about clearing
//     the site's data, the buttons);
//   - OK stores `app.plus`, Cancel and Escape do not;
//   - `{ group: 'storage' }` puts the focus on `Empty Trash`; without it the focus is on the first box;
//   - the figures: My Programs follows a file written while the dialog is open; Earlier versions and
//     Trash follow the store; the site line with an estimate (the page's own, and a fixed one for
//     the exact text) and without one (navigator.storage.estimate removed before the page loads);
//   - Empty Trash and Delete Earlier Versions ask their questions, No keeps everything, Yes acts at
//     once (the figures change while the dialog stays open), and Cancel afterwards keeps the effect;
//   - the desktop variant of the group's texts (the page's platform kind set to 'desktop');
//   - an accessibility scan (axe-core) in the light and the dark theme; no console errors.
//
// Nothing here assumes Windows: the only keys pressed are Escape and Tab-free clicks; every wait is
// for a condition, with limits sized for GitHub's slower Mac runner. Needs neither engine/dist nor a
// production build. Screenshots go to build/N7-plus/additions-check (git-ignored).
// Exit code 0 = everything passed. `window.__easy68k` exists in development builds only.

/* global console, process, window, document, navigator, TextEncoder, TextDecoder */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'N7-plus', 'additions-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

// The texts of P3.5 (and P3.3.8 for Empty Trash), written here from the document, not read from
// texts.ts, so that a change of the texts is caught.
const TEXT = {
  title: 'Port Additions',
  viewer: 'Show PDF files and pictures in a viewer instead of as text',
  history: 'Keep earlier versions of saved files and a Trash for deleted files',
  group: 'Storage',
  clearing: "Clearing this site's data in the browser removes My Programs, earlier versions and the Trash.",
  desktop: "Earlier versions and Trash are kept in the app's own storage.",
  deleteVersions: 'Delete all earlier versions of all files for good? Your current files are not affected.',
};

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  detail = String(detail).slice(0, 500);
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

async function openApp(context, init) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  if (init) await page.addInitScript(init);
  await page.goto(baseUrl);
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined && window.__easy68k.ctx.documents.active() !== null);
  return { page, errors };
}

/** Starts a command without waiting for it (it opens a dialog). */
const startCommand = (page, id, arg) =>
  page.evaluate(
    ([commandId, argument]) => {
      window.__commandDone = false;
      void window.__easy68k.ctx.commands.run(commandId, argument ?? undefined).finally(() => {
        window.__commandDone = true;
      });
    },
    [id, arg ?? null],
  );
const commandDone = (page) => page.waitForFunction(() => window.__commandDone === true);

const dialogOf = (page) =>
  page.locator('[role=dialog]', { has: page.locator('.e68-dialog__title', { hasText: /^Port Additions$/ }) });
const messageBox = (page) => page.locator('[role=alertdialog]').last();
const plus = (page) => page.evaluate(() => window.__easy68k.ctx.settings.get().app.plus ?? null);
const textOf = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();

/** The lines of the Storage group as shown: label and figure, or the sentence. */
async function lines(dialog) {
  await dialog.locator('[data-e68-additions=figures][data-e68-ready=true]').waitFor();
  return dialog
    .locator('[data-e68-figure]')
    .evaluateAll((all) =>
      all.map((line) => [line.getAttribute('data-e68-figure'), line.textContent.replace(/\s+/g, ' ').trim()]),
    );
}
async function lineOf(dialog, id) {
  const found = (await lines(dialog)).find(([key]) => key === id);
  return found ? found[1] : null;
}
/** Waits until the line `id` matches `pattern`; returns the text then (or the last seen). */
async function waitLine(dialog, id, pattern, timeout = 60_000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await lineOf(dialog, id);
    if (last !== null && pattern.test(last)) return last;
    await dialog.page().waitForTimeout(100);
  }
  return last;
}

async function scan(page, label) {
  const result = await new AxeBuilder({ page })
    .include('[role=dialog]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: no serious finding`,
    serious.length === 0,
    serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`).join('; '),
  );
}

/** A size as the stage's texts write it: formatSize of core/history/size.ts, the project's one
 *  formatter (P3.2.6), imported in the page. */
async function formatSizeIn(page, bytes) {
  return page.evaluate(async (n) => (await import('/src/core/history/size.ts')).formatSize(n), bytes);
}

// ---- the dialog --------------------------------------------------------------------------------

async function dialogPass(browser, name) {
  const p = `${name}:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const { page, errors } = await openApp(context);

  // From the Editor's Options menu: the last item, below a separator.
  await page
    .locator('.e68-shell__menubar .e68-menubar__title')
    .filter({ hasText: /^Options$/ })
    .click();
  const menu = page.locator('[role=menu][data-e68-menu]').last();
  await menu.waitFor();
  const sequence = await menu
    .locator(':scope > [role^=menuitem], :scope > [role=separator]')
    .evaluateAll((items) =>
      items.map((item) =>
        item.getAttribute('role') === 'separator' ? '-' : (item.querySelector('.e68-menu__caption')?.textContent ?? ''),
      ),
    );
  check(
    `${p} Editor Options menu ends with a separator and Port Additions...`,
    same(sequence.slice(-2), ['-', 'Port Additions...']),
    JSON.stringify(sequence),
  );
  const item = menu
    .locator(':scope > [role^=menuitem]')
    .filter({ has: page.locator('.e68-menu__caption', { hasText: /^Port Additions\.\.\.$/ }) });
  check(`${p} the item is enabled`, (await item.getAttribute('aria-disabled')) !== 'true');
  await item.click();
  const dialog = dialogOf(page);
  await dialog.waitFor();
  check(`${p} modal, titled Port Additions`, (await dialog.getAttribute('aria-modal')) === 'true');
  const ids = await page.evaluate(() => window.__easy68k.ctx.store.getState().dialogs.stack.map((d) => d.id));
  check(`${p} the dialog is plus.options`, same(ids, ['plus.options']), JSON.stringify(ids));

  // Every text.
  const viewer = dialog.getByRole('checkbox', { name: TEXT.viewer });
  const history = dialog.getByRole('checkbox', { name: TEXT.history });
  check(`${p} the two boxes, both checked by default`, (await viewer.isChecked()) && (await history.isChecked()));
  const keys = await dialog
    .locator('input[type=checkbox]')
    .evaluateAll((all) => all.map((box) => box.getAttribute('data-e68-mnemonic')));
  check(`${p} access keys S and K`, same(keys, ['s', 'k']), JSON.stringify(keys));
  const legend = await dialog.locator('legend').allInnerTexts();
  check(
    `${p} the group Storage`,
    same(
      legend.map((t) => t.trim()),
      [TEXT.group],
    ),
    JSON.stringify(legend),
  );
  const shown = await lines(dialog);
  check(
    `${p} the lines of the group in order (with an estimate)`,
    same(
      shown.map(([id]) => id),
      ['programs', 'versions', 'trash', 'site', 'clearing'],
    ) &&
      /^My Programs: \d+ files?, [\d.]+ (bytes?|kB|MB|GB)$/.test(shown[0][1]) &&
      /^Earlier versions: \d+ versions?, [\d.]+ (bytes?|kB|MB|GB)$/.test(shown[1][1]) &&
      /^Trash: \d+ items?, [\d.]+ (bytes?|kB|MB|GB)$/.test(shown[2][1]) &&
      /^This site uses [\d.]+ (bytes?|kB|MB|GB) in this browser, about [\d.]+ (bytes?|kB|MB|GB) free$/.test(
        shown[3][1],
      ) &&
      shown[4][1] === TEXT.clearing,
    JSON.stringify(shown),
  );
  const buttons = (await dialog.locator('button:not(.e68-dialog__close)').allInnerTexts()).map((t) => t.trim());
  check(
    `${p} buttons Empty Trash, Delete Earlier Versions, OK, Cancel`,
    same(buttons, ['Empty Trash', 'Delete Earlier Versions', 'OK', 'Cancel']),
    JSON.stringify(buttons),
  );
  // Without an argument the kit's rule holds: the focus starts on the default button (OK).
  await page
    .waitForFunction(() => document.activeElement?.textContent?.trim() === 'OK', null, { timeout: 15_000 })
    .catch(() => {});
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
  check(`${p} without an argument the focus starts on the default button OK`, focused === 'OK', String(focused));
  await page.screenshot({ path: join(outDir, `${name}-dialog-light.png`) });
  await scan(page, `${name} Port Additions (light)`);

  // Cancel stores nothing; Escape neither.
  const before = await plus(page);
  await viewer.click();
  check(`${p} a click unchecks the box`, !(await viewer.isChecked()));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  check(`${p} Cancel stores nothing`, same(await plus(page), before), JSON.stringify(await plus(page)));
  await startCommand(page, 'app.additions.options');
  await dialog.waitFor();
  check(`${p} the box is shown checked again after Cancel`, await viewer.isChecked());
  await history.click();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await commandDone(page);
  check(`${p} Escape stores nothing`, same(await plus(page), before), JSON.stringify(await plus(page)));

  // OK stores app.plus.
  await startCommand(page, 'app.additions.options');
  await dialog.waitFor();
  await viewer.click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await commandDone(page);
  const stored = await plus(page);
  check(
    `${p} OK stores app.plus (viewer off)`,
    stored?.viewer === false && stored?.history !== false,
    JSON.stringify(stored),
  );
  await startCommand(page, 'app.additions.options');
  await dialog.waitFor();
  check(`${p} the dialog shows the stored switch`, !(await viewer.isChecked()) && (await history.isChecked()));
  await viewer.click();
  await history.click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await commandDone(page);
  const stored2 = await plus(page);
  const state = await page.evaluate(() => window.__easy68k.ctx.history?.state() ?? null);
  check(
    `${p} OK stores both switches (viewer on, history off) and the store follows: state off`,
    same(stored2, { viewer: true, history: false }) && state === 'off',
    `${JSON.stringify(stored2)} state ${state}`,
  );
  await startCommand(page, 'app.additions.options');
  await dialog.waitFor();
  await history.click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await commandDone(page);
  check(`${p} history switched on again`, (await plus(page))?.history === true, JSON.stringify(await plus(page)));

  // { group: 'storage' }: the focus on Empty Trash.
  await startCommand(page, 'app.additions.options', { group: 'storage' });
  await dialog.waitFor();
  await page
    .waitForFunction(() => document.activeElement?.textContent?.trim() === 'Empty Trash', null, { timeout: 15_000 })
    .catch(() => {});
  const focus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
  check(`${p} { group: 'storage' } puts the focus on Empty Trash`, focus === 'Empty Trash', String(focus));

  // The figures follow the store and My Programs while the dialog is open.
  const programs0 = await lineOf(dialog, 'programs');
  const counted = await page.evaluate(async () => {
    const vfs = window.__easy68k.ctx.vfs;
    let files = 0;
    let bytes = 0;
    const walk = async (dir) => {
      for (const entry of await vfs.list(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.kind === 'dir') await walk(path);
        else {
          files++;
          bytes += (await vfs.stat(path)).size;
        }
      }
    };
    await walk('/browser');
    await vfs.writeFile('/browser/n7-check/added.X68', new Uint8Array(3000).fill(65));
    return { files: files + 1, bytes: bytes + 3000 };
  });
  const expectedPrograms = `My Programs: ${counted.files} file${counted.files === 1 ? '' : 's'}, ${await formatSizeIn(page, counted.bytes)}`;
  const programs1 = await waitLine(
    dialog,
    'programs',
    new RegExp(`^${expectedPrograms.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  );
  check(
    `${p} My Programs follows a file written while the dialog is open`,
    programs1 === expectedPrograms,
    `${programs0} -> ${programs1} (expected ${expectedPrograms})`,
  );

  // Versions and a Trash item through the page's own store.
  await page.evaluate(async () => {
    const { vfs, history } = window.__easy68k.ctx;
    const bytes = (text) => new TextEncoder().encode(text);
    await vfs.writeFile('/browser/n7-check/kept.X68', bytes('one'));
    await history.record('/browser/n7-check/kept.X68', bytes('one'), 'saved', Date.now() - 2000);
    await vfs.writeFile('/browser/n7-check/kept.X68', bytes('two'));
    await history.record('/browser/n7-check/kept.X68', bytes('two'), 'saved', Date.now() - 1000);
    await vfs.writeFile('/browser/n7-check/kept.X68', bytes('three'));
    await history.record('/browser/n7-check/kept.X68', bytes('three'), 'saved', Date.now());
    await vfs.writeFile('/browser/n7-check/gone.X68', bytes('gone for now'));
    await history.guard(
      '/browser/n7-check/gone.X68',
      'delete',
      async () => vfs.remove('/browser/n7-check/gone.X68'),
      async () => true,
    );
  });
  const usage = await page.evaluate(() => window.__easy68k.ctx.history.usage());
  const versionsExpected = `Earlier versions: ${usage.versions} version${usage.versions === 1 ? '' : 's'}, ${await formatSizeIn(page, usage.versionBytes)}`;
  const trashExpected = `Trash: ${usage.trashItems} item${usage.trashItems === 1 ? '' : 's'}, ${await formatSizeIn(page, usage.trashBytes)}`;
  const esc = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const versionsShown = await waitLine(dialog, 'versions', esc(versionsExpected));
  const trashShown = await waitLine(dialog, 'trash', esc(trashExpected));
  check(
    `${p} Earlier versions and Trash follow the store (usage())`,
    versionsShown === versionsExpected && trashShown === trashExpected && usage.trashItems === 1 && usage.versions > 0,
    `${versionsShown} | ${trashShown} | ${JSON.stringify(usage)}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-dialog-figures.png`) });

  // Empty Trash: No keeps the item; Yes empties it at once.
  const emptyButton = dialog.getByRole('button', { name: 'Empty Trash', exact: true });
  await emptyButton.click();
  let box = messageBox(page);
  await box.waitFor();
  const question = await textOf(box.locator('.e68-messagebox__text'));
  const expectedQuestion = `Delete everything in the Trash for good? (1 item, ${await formatSizeIn(page, usage.trashBytes)})`;
  const boxTitle = await textOf(box.locator('.e68-dialog__title'));
  const boxButtons = (await box.locator('button:not(.e68-dialog__close)').allInnerTexts()).map((t) => t.trim());
  check(
    `${p} Empty Trash asks "${expectedQuestion}" (Yes, No), titled Empty Trash`,
    question === expectedQuestion && boxTitle === 'Empty Trash' && same(boxButtons, ['Yes', 'No']),
    `${boxTitle}: ${question} ${JSON.stringify(boxButtons)}`,
  );
  await page.screenshot({ path: join(outDir, `${name}-empty-trash-question.png`) });
  await box.getByRole('button', { name: 'No', exact: true }).click();
  await box.waitFor({ state: 'hidden' });
  check(`${p} No keeps the Trash`, (await page.evaluate(() => window.__easy68k.ctx.history.usage())).trashItems === 1);
  await emptyButton.click();
  box = messageBox(page);
  await box.waitFor();
  await box.getByRole('button', { name: 'Yes', exact: true }).click();
  await box.waitFor({ state: 'hidden' });
  const trashAfter = await waitLine(dialog, 'trash', /^Trash: 0 items, 0 bytes$/);
  const usageAfterTrash = await page.evaluate(() => window.__easy68k.ctx.history.usage());
  check(
    `${p} Yes empties the Trash at once, the dialog stays open, the versions stay`,
    trashAfter === 'Trash: 0 items, 0 bytes' &&
      usageAfterTrash.trashItems === 0 &&
      usageAfterTrash.versions === usage.versions &&
      (await dialog.isVisible()),
    `${trashAfter} ${JSON.stringify(usageAfterTrash)}`,
  );
  // With nothing in the Trash: the empty-state text, OK.
  await emptyButton.click();
  box = messageBox(page);
  await box.waitFor();
  const emptyText = await textOf(box.locator('.e68-messagebox__text'));
  check(
    `${p} Empty Trash with nothing in it says the Trash is empty`,
    emptyText.startsWith('The Trash is empty. ') &&
      same(
        (await box.locator('button:not(.e68-dialog__close)').allInnerTexts()).map((t) => t.trim()),
        ['OK'],
      ),
    emptyText,
  );
  await box.getByRole('button', { name: 'OK', exact: true }).click();
  await box.waitFor({ state: 'hidden' });

  // Delete Earlier Versions.
  const deleteButton = dialog.getByRole('button', { name: 'Delete Earlier Versions', exact: true });
  await deleteButton.click();
  box = messageBox(page);
  await box.waitFor();
  const question2 = await textOf(box.locator('.e68-messagebox__text'));
  check(
    `${p} Delete Earlier Versions asks the question of P3.5 (Yes, No)`,
    question2 === TEXT.deleteVersions &&
      (await textOf(box.locator('.e68-dialog__title'))) === 'Delete Earlier Versions' &&
      same(
        (await box.locator('button:not(.e68-dialog__close)').allInnerTexts()).map((t) => t.trim()),
        ['Yes', 'No'],
      ),
    question2,
  );
  await box.getByRole('button', { name: 'No', exact: true }).click();
  await box.waitFor({ state: 'hidden' });
  check(
    `${p} No keeps the versions`,
    (await page.evaluate(() => window.__easy68k.ctx.history.usage())).versions === usage.versions,
  );
  await deleteButton.click();
  box = messageBox(page);
  await box.waitFor();
  await box.getByRole('button', { name: 'Yes', exact: true }).click();
  await box.waitFor({ state: 'hidden' });
  const versionsAfter = await waitLine(dialog, 'versions', /^Earlier versions: 0 versions, 0 bytes$/);
  check(
    `${p} Yes deletes the earlier versions at once; the current file is unchanged`,
    versionsAfter === 'Earlier versions: 0 versions, 0 bytes' &&
      (await page.evaluate(async () =>
        new TextDecoder().decode(await window.__easy68k.ctx.vfs.readFile('/browser/n7-check/kept.X68')),
      )) === 'three',
    String(versionsAfter),
  );
  // Cancel afterwards: the buttons acted already, Cancel undoes nothing.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await commandDone(page);
  const final = await page.evaluate(() => window.__easy68k.ctx.history.usage());
  check(
    `${p} Cancel after the buttons keeps their effect`,
    final.versions === 0 && final.trashItems === 0,
    JSON.stringify(final),
  );

  // The dark theme.
  await page.evaluate(() => window.__easy68k.ctx.settings.update((s) => ({ ...s, app: { ...s.app, theme: 'dark' } })));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await startCommand(page, 'app.additions.options');
  await dialog.waitFor();
  await lines(dialog);
  await page.screenshot({ path: join(outDir, `${name}-dialog-dark.png`) });
  await scan(page, `${name} Port Additions (dark)`);
  await page.keyboard.press('Escape');
  await commandDone(page);
  await page.evaluate(() => window.__easy68k.ctx.settings.update((s) => ({ ...s, app: { ...s.app, theme: 'light' } })));

  // From the Simulator's Options menu.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'simulator'));
  await page
    .locator('.e68-shell__menubar .e68-menubar__title')
    .filter({ hasText: /^Options$/ })
    .click();
  const simMenu = page.locator('[role=menu][data-e68-menu]').last();
  await simMenu.waitFor();
  const simSequence = await simMenu
    .locator(':scope > [role^=menuitem], :scope > [role=separator]')
    .evaluateAll((items) =>
      items.map((item) =>
        item.getAttribute('role') === 'separator' ? '-' : (item.querySelector('.e68-menu__caption')?.textContent ?? ''),
      ),
    );
  check(
    `${p} Simulator Options menu ends with a separator and Port Additions...`,
    same(simSequence.slice(-2), ['-', 'Port Additions...']),
    JSON.stringify(simSequence),
  );
  await simMenu
    .locator(':scope > [role^=menuitem]')
    .filter({ has: page.locator('.e68-menu__caption', { hasText: /^Port Additions\.\.\.$/ }) })
    .click();
  await dialog.waitFor();
  check(`${p} opens in Simulator mode`, await dialog.isVisible());
  await page.screenshot({ path: join(outDir, `${name}-dialog-simulator.png`) });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  // The desktop variant of the texts: the page's platform kind set to 'desktop'.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'editor'));
  const changed = await page.evaluate(() => {
    const platform = window.__easy68k.ctx.platform;
    try {
      Object.defineProperty(platform, 'kind', { value: 'desktop', configurable: true, writable: true });
    } catch {
      return false;
    }
    return platform.kind === 'desktop';
  });
  if (!changed) {
    check(`${p} desktop variant (could not set the page's platform kind)`, false);
  } else {
    await startCommand(page, 'app.additions.options');
    await dialog.waitFor();
    const desktopLines = await lines(dialog);
    check(
      `${p} desktop variant: My Programs (the browser store exists here), the two halves, then the app-storage sentence`,
      same(
        desktopLines.map(([id]) => id),
        ['programs', 'versions', 'trash', 'desktop'],
      ) && desktopLines[3][1] === TEXT.desktop,
      JSON.stringify(desktopLines),
    );
    await page.screenshot({ path: join(outDir, `${name}-dialog-desktop.png`) });
    await page.keyboard.press('Escape');
    await commandDone(page);
    await page.evaluate(() => {
      Object.defineProperty(window.__easy68k.ctx.platform, 'kind', {
        value: 'web',
        configurable: true,
        writable: true,
      });
    });
  }

  await page.evaluate(async () => {
    const vfs = window.__easy68k.ctx.vfs;
    for (const name of ['added.X68', 'kept.X68']) await vfs.remove(`/browser/n7-check/${name}`).catch(() => {});
    await vfs.remove('/browser/n7-check').catch(() => {});
  });
  check(`${p} no console errors`, errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---- the estimate --------------------------------------------------------------------------------

async function estimatePass(browser, name) {
  const p = `${name}: estimate:`;
  // A fixed estimate, for the exact text of P3.5's example.
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    const { page, errors } = await openApp(context, () => {
      // On the prototype: WebKit ignores a property defined on the navigator.storage object itself.
      const proto = navigator.storage && Object.getPrototypeOf(navigator.storage);
      if (proto) {
        Object.defineProperty(proto, 'estimate', {
          configurable: true,
          value: async () => ({ usage: 7.9 * 1024 * 1024, quota: 7.9 * 1024 * 1024 + 1.8 * 1024 * 1024 * 1024 }),
        });
      }
    });
    await startCommand(page, 'app.additions.options');
    const dialog = dialogOf(page);
    await dialog.waitFor();
    const site = await lineOf(dialog, 'site');
    check(
      `${p} a fixed estimate gives "This site uses 7.9 MB in this browser, about 1.8 GB free"`,
      site === 'This site uses 7.9 MB in this browser, about 1.8 GB free',
      String(site),
    );
    await page.keyboard.press('Escape');
    await commandDone(page);
    check(`${p} no console errors (fixed estimate)`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
  // No estimate: the line is left out.
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    const { page, errors } = await openApp(context, () => {
      const proto = navigator.storage && Object.getPrototypeOf(navigator.storage);
      if (proto) Object.defineProperty(proto, 'estimate', { configurable: true, value: undefined });
    });
    const absent = await page.evaluate(() => typeof navigator.storage?.estimate !== 'function');
    await startCommand(page, 'app.additions.options');
    const dialog = dialogOf(page);
    await dialog.waitFor();
    const shown = await lines(dialog);
    check(
      `${p} without navigator.storage.estimate the site line is left out`,
      absent &&
        same(
          shown.map(([id]) => id),
          ['programs', 'versions', 'trash', 'clearing'],
        ),
      `estimate absent: ${absent}; ${JSON.stringify(shown)}`,
    );
    await page.screenshot({ path: join(outDir, `${name}-dialog-no-estimate.png`) });
    await page.keyboard.press('Escape');
    await commandDone(page);
    check(`${p} no console errors (no estimate)`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(repoRoot, 'build', 'N7-plus', 'vite-cache'),
    // No hot reload: other packages' files change while this runs, and a reload would reset the pages.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        for (const [label, pass] of [
          ['Port Additions', dialogPass],
          ['storage estimate', estimatePass],
        ]) {
          console.log(`\n[${name}, ${label}]`);
          try {
            await pass(browser, name);
          } catch (error) {
            check(`${name}: the ${label} pass ran to the end`, false, String(error?.stack ?? error).slice(0, 600));
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
