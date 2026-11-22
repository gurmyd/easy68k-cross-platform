// Browser check of work package E4 (Options dialogs and settings files): the three dialogs drawn
// and used in the real application, which the unit tests under Node reach only through their
// models (ARCHITECTURE.md 3.10, 1.4 note 8; editor-ui §11.1, §11.2). Owner: E4.
//
//   node app/src/features/options/check-options.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives headless Chromium and WebKit
// (Playwright) with the real shell, document service, editor, file dialogs and help:
//
//   - Editor Options: every caption of both tabs, Colors first and the last tab again later;
//     element, attributes, swatches, presets and the preview; F1 and Help open options.htm above
//     the dialog; Cancel (Escape) restores everything, also while another window writes a setting;
//     OK writes the settings and the active document's font and tabs and leaves Modified alone;
//     the dialog in the dark theme;
//   - Assembler Options: modeless, every caption and tool-tip; OK with an unchecked box asks the
//     Sim68K question, No re-checks both boxes and keeps the dialog open; Cancel restores; OK
//     writes; the template box takes a Tab and Save Template writes the template;
//   - Import/Export Settings: the shipped settings.dat imported through the real Open dialog
//     reaches a second window; sim68K.dat exported through the real Save dialog has its raw bytes;
//   - an accessibility scan (axe-core) of each dialog; no console errors.
//
// Nothing here assumes Windows: no chord but Escape, Tab and the Help key is pressed, and the Help
// key is read from the application's chord table for the system the page runs on (chordsOn());
// every wait is for a condition, with limits sized for GitHub's slower Mac runner. Needs neither
// engine/dist nor a production build. Screenshots go to build/E4/options-check (git-ignored).
// Exit code 0 = everything passed. `window.__easy68k` exists in development builds only.

/* global console, process, window, document, getComputedStyle */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { closeAtEnd, closeWithin, doneWith, endChecks } from '../../../../tests/browser-checks/ending.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');
const fixtures = resolve(appRoot, 'src/core/settings/dat-codec/fixtures');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'E4', 'options-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  detail = String(detail).slice(0, 400);
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

async function openApp(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl);
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined && window.__easy68k.ctx.documents.active() !== null);
  return { page, errors };
}

/** Starts a command without waiting for it (it opens a dialog). */
const startCommand = (page, id) =>
  page.evaluate((commandId) => {
    window.__commandDone = false;
    void window.__easy68k.ctx.commands.run(commandId).finally(() => {
      window.__commandDone = true;
    });
  }, id);
const commandDone = (page) => page.waitForFunction(() => window.__commandDone === true);

const editorSettings = (page) => page.evaluate(() => window.__easy68k.ctx.settings.get().editor);
const updateEditor = (page, patch) =>
  page.evaluate((p) => {
    window.__easy68k.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, ...p } }));
  }, patch);
const dialogByTitle = (page, title) => page.locator('[role=dialog]', { has: page.locator('h2', { hasText: title }) });
const openDialogIds = (page) =>
  page.evaluate(() => window.__easy68k.ctx.store.getState().dialogs.stack.map((d) => d.id));

const PLAYWRIGHT_MODIFIERS = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Cmd: 'Meta' };
/**
 * The Help key of the system the page runs on, read from the application's chord table
 * (`chordsOn()` of app/src/commands/specs.ts), as Playwright's key name. Today F1 on every system.
 */
async function helpKey(page) {
  const { os, chords } = await page.evaluate(async () => {
    const { chordsOn } = await import('/src/commands/specs.ts');
    const os = window.__easy68k.ctx.platform.os;
    return { os, chords: chordsOn('ed.help.help', os, false) };
  });
  const chord = chords[0];
  if (!chord) throw new Error(`ed.help.help has no chord on ${os}`);
  const parts = chord.split('+');
  const key = parts.pop();
  return { os, chord, key: [...parts.map((m) => PLAYWRIGHT_MODIFIERS[m] ?? m), key].join('+') };
}

/**
 * The page that the Help drawer shows, if it is open and on top of the point it covers. A slow
 * runner may take long to load the help page, so an expected page is waited for up to a minute.
 */
const helpShowsOptions = (page, timeout = 60_000) =>
  page
    .waitForFunction(
      () => {
        const region = document.querySelector('.e68-shell__body > [data-e68-panel="help"]');
        if (!region) return false;
        const frame = region.querySelector('iframe');
        const box = region.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 20);
        return (
          frame !== null &&
          ((frame.getAttribute('src') ?? '').includes('options.htm') || frame.title.includes('Options')) &&
          hit !== null &&
          region.contains(hit)
        );
      },
      null,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
const closeHelp = (page) =>
  page.evaluate(async () => {
    const { hidePanel } = await import('/src/state/panels.ts');
    hidePanel(window.__easy68k.ctx, 'help');
  });

async function scan(page, label) {
  // The Editor Options preview shows the original's colours as they are (2.8: stored presets are
  // used unchanged, like the Output surface), olive on white included; it is excluded here.
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-e68-options=preview]')
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: no serious finding`,
    serious.length === 0,
    serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`).join('; '),
  );
}

const textOf = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();

// ---- Editor Options ---------------------------------------------------------------------------

async function editorOptionsPass(browser, name) {
  const p = `${name}: Editor Options:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const { page, errors } = await openApp(context);
  const second = await openApp(context);
  const before = await editorSettings(page);

  await startCommand(page, 'ed.options.editor');
  const dialog = dialogByTitle(page, 'EASy68K Editor Options');
  await dialog.waitFor();
  check(`${p} modal, titled EASy68K Editor Options`, (await dialog.getAttribute('aria-modal')) === 'true');
  const tabs = await dialog.getByRole('tab').allInnerTexts();
  check(`${p} tabs General and Colors`, same(tabs, ['General', 'Colors']), JSON.stringify(tabs));
  check(
    `${p} Colors is shown the first time`,
    (await dialog.getByRole('tab', { name: 'Colors' }).getAttribute('aria-selected')) === 'true',
  );
  const buttons = (await dialog.locator('.e68-dialog__footer button').allInnerTexts()).map((t) => t.trim());
  check(`${p} buttons OK, Cancel, Help`, same(buttons, ['OK', 'Cancel', 'Help']), JSON.stringify(buttons));

  // Colors tab.
  const elements = await dialog.getByRole('listbox').getByRole('option').allInnerTexts();
  check(
    `${p} Element list`,
    same(elements, [
      'Code',
      'Comment',
      'Directive',
      'Label',
      'Macro/Other',
      'Structured',
      'Structure Error',
      'Text',
      'Background',
    ]),
    JSON.stringify(elements),
  );
  const presets = await dialog.getByLabel('Color Presets').locator('option').allInnerTexts();
  check(
    `${p} Color Presets: the five of the original, then Auto (shown: Auto)`,
    same(presets, ['Color1', 'Color2', 'No Color', 'Custom', 'Disabled', 'Auto']) &&
      (await dialog.getByLabel('Color Presets').inputValue()) === '5',
    JSON.stringify(presets),
  );
  const colorsText = await textOf(dialog);
  check(
    `${p} Colors captions`,
    [
      'Element',
      'Text Attributes',
      'Bold',
      'Italic',
      'Underline',
      'Color Presets',
      'Print w/Black',
      'Color',
      'Preview',
    ].every((caption) => colorsText.includes(caption)),
    colorsText,
  );
  const printBlack = dialog.getByLabel('Print w/Black');
  check(`${p} Print w/Black checked and disabled`, (await printBlack.isChecked()) && (await printBlack.isDisabled()));
  const swatches = await dialog
    .locator('.e68-options__swatch')
    .evaluateAll((all) => all.map((b) => [b.getAttribute('aria-label'), getComputedStyle(b).backgroundColor]));
  check(
    `${p} sixteen swatches, row by row, clBlack .. clWhite`,
    swatches.length === 16 &&
      swatches[0][0] === 'clBlack' &&
      swatches[8][1] === 'rgb(160, 160, 164)' &&
      swatches[15][0] === 'clWhite' &&
      swatches[15][1] === 'rgb(255, 255, 255)',
    JSON.stringify(swatches),
  );
  const preview = await dialog.locator('[data-e68-options=preview]').innerText();
  check(
    `${p} preview text`,
    preview.split('\n').filter(Boolean).join('|') ===
      "* Syntax Highlight|START   MOVE.B #1,D0|        Macro/Other|    if <NE> then|    of <NE> tehn|        DC.B 'HELLO'",
    JSON.stringify(preview),
  );
  await page.screenshot({ path: join(outDir, `${name}-editor-options-colors.png`) });
  await scan(page, `${name} Editor Options (Colors)`);

  // Element, attribute, swatch, preset.
  const elementStyle = (element) =>
    dialog.locator(`[data-e68-options=preview] [data-element=${element}]`).evaluate((s) => {
      const c = getComputedStyle(s);
      return [c.color, c.fontWeight, c.fontStyle, c.textDecorationLine];
    });
  await dialog.getByRole('listbox').getByRole('option', { name: 'Macro/Other' }).click();
  await dialog.getByLabel('Bold').check();
  const afterBold = await elementStyle('unknown');
  check(
    `${p} Bold on Macro/Other: the preview's Macro/Other is bold, the preset Custom`,
    afterBold[1] === '700' && (await dialog.getByLabel('Color Presets').inputValue()) === '3',
    JSON.stringify(afterBold),
  );
  await dialog.locator('.e68-options__swatch[aria-label=clRed]').click();
  check(`${p} a swatch colours the selected element`, (await elementStyle('unknown'))[0] === 'rgb(255, 0, 0)');
  await dialog.getByRole('listbox').getByRole('option', { name: 'Background' }).click();
  await dialog.locator('.e68-options__swatch[aria-label=clYellow]').click();
  const background = await dialog
    .locator('[data-e68-options=preview]')
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  check(`${p} a swatch on Background colours the preview's background`, background === 'rgb(255, 255, 0)', background);
  await dialog.getByLabel('Color Presets').selectOption('2');
  const mono = [await elementStyle('comment'), await elementStyle('directive'), await elementStyle('unknown')];
  const backgroundAfterPreset = await dialog
    .locator('[data-e68-options=preview]')
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  check(
    `${p} No Color: all black, Comment italic, Directive bold, Macro/Other italic and underlined; boxes cleared; background kept`,
    mono[0][0] === 'rgb(0, 0, 0)' &&
      mono[0][2] === 'italic' &&
      mono[1][1] === '700' &&
      mono[2][2] === 'italic' &&
      mono[2][3] === 'underline' &&
      !(await dialog.getByLabel('Bold').isChecked()) &&
      (await dialog.getByRole('listbox').getByRole('option', { selected: true }).count()) === 0 &&
      backgroundAfterPreset === 'rgb(255, 255, 0)',
    JSON.stringify([mono, backgroundAfterPreset]),
  );

  // General tab.
  await dialog.getByRole('tab', { name: 'General' }).click();
  const generalText = await textOf(dialog);
  check(
    `${p} General captions`,
    [
      'New File Settings',
      'New Font:',
      'New Font Size:',
      'Fixed Tab Size:',
      'Assembly Tabs',
      'Fixed Tabs',
      'Current File Info',
      'Font:',
      'Font Size:',
      'Tab Type:',
      'Environment',
      'Auto Indent',
      'Real Tabs',
    ].every((caption) => generalText.includes(caption)),
    generalText,
  );
  const info = await dialog.locator('[data-e68-options=current-file] dd').allInnerTexts();
  check(
    `${p} Current File Info of the active document`,
    same(info, ['Courier New', '10', '4', 'Fixed']),
    JSON.stringify(info),
  );
  const fonts = await dialog.getByLabel('New Font:').locator('option').allInnerTexts();
  check(
    `${p} New Font: Courier, Courier New, Fixedsys; shown Courier New 10; Fixed Tabs; Auto Indent on`,
    same(fonts, ['Courier', 'Courier New', 'Fixedsys']) &&
      (await dialog.getByLabel('New Font:').inputValue()) === 'Courier New' &&
      (await dialog.getByLabel('New Font Size:').inputValue()) === '10' &&
      (await dialog.getByRole('radio', { name: 'Fixed Tabs' }).isChecked()) &&
      (await dialog.getByLabel('Auto Indent').isChecked()) &&
      !(await dialog.getByLabel('Real Tabs').isChecked()),
  );
  await dialog.getByLabel('New Font:').selectOption('Fixedsys');
  const fixedsysSizes = await dialog.getByLabel('New Font Size:').locator('option').allInnerTexts();
  check(`${p} Fixedsys offers 9 and 18`, same(fixedsysSizes, ['9', '18']), JSON.stringify(fixedsysSizes));
  await dialog.getByLabel('Real Tabs').check();
  await page.screenshot({ path: join(outDir, `${name}-editor-options-general.png`) });
  await scan(page, `${name} Editor Options (General)`);

  // Help and F1 open options.htm above the dialog.
  await dialog.getByRole('button', { name: 'Help' }).click();
  check(`${p} Help opens options.htm above the dialog`, await helpShowsOptions(page));
  await page.screenshot({ path: join(outDir, `${name}-editor-options-help.png`) });
  await closeHelp(page);
  const help = await helpKey(page);
  await dialog.getByLabel('Real Tabs').focus();
  await page.keyboard.press(help.key);
  check(`${p} ${help.chord} (Help key on ${help.os}) opens options.htm above the dialog`, await helpShowsOptions(page));
  await closeHelp(page);
  check(`${p} the dialog is still open after Help`, (await openDialogIds(page)).includes('options.editor'));

  // Another window writes while the dialog is open; then Cancel (Escape).
  await updateEditor(second.page, { showWarnings: false });
  await page.waitForFunction(() => window.__easy68k.ctx.settings.get().editor.showWarnings === false);
  await dialog.getByLabel('Real Tabs').focus();
  await page.keyboard.press('Escape');
  await commandDone(page);
  const afterCancel = await editorSettings(page);
  const expected = { ...before, showWarnings: false };
  check(
    `${p} Cancel restores everything; the other window's change made meanwhile stays`,
    same(afterCancel, expected) && same(await editorSettings(second.page), expected),
    JSON.stringify(Object.keys(afterCancel).filter((k) => !same(afterCancel[k], expected[k]))),
  );
  const docAfterCancel = await page.evaluate(() => window.__easy68k.ctx.documents.active());
  check(`${p} Cancel leaves the document's font alone`, docAfterCancel.fontName === 'Courier New');

  // The last tab again; OK writes.
  await updateEditor(page, { colorPreset: 5 });
  await startCommand(page, 'ed.options.editor');
  await dialog.waitFor();
  check(
    `${p} the tab shown last time (General) is shown again`,
    (await dialog.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')) === 'true',
  );
  await dialog.getByLabel('New Font:').selectOption('Courier');
  await dialog.getByLabel('New Font Size:').selectOption('15');
  await dialog.getByRole('radio', { name: 'Assembly Tabs' }).check();
  await dialog.getByLabel('Auto Indent').uncheck();
  await dialog.getByRole('tab', { name: 'Colors' }).click();
  await dialog.getByLabel('Color Presets').selectOption('1');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await commandDone(page);
  const afterOk = await editorSettings(page);
  check(
    `${p} OK writes the font, size, tab type, Auto Indent and the Color2 preset`,
    afterOk.fontName === 'Courier' &&
      afterOk.fontSize === 15 &&
      afterOk.tabType === 0 &&
      afterOk.autoIndent === false &&
      afterOk.colorPreset === 1 &&
      afterOk.styles.comment.color === 0x008000 &&
      afterOk.showWarnings === false,
    JSON.stringify([afterOk.fontName, afterOk.fontSize, afterOk.tabType, afterOk.autoIndent, afterOk.colorPreset]),
  );
  const doc = await page.evaluate(() => window.__easy68k.ctx.documents.active());
  check(
    `${p} OK gives the active document the font and tabs and leaves Modified alone`,
    doc.fontName === 'Courier' && doc.fontSize === 15 && doc.tabType === 0 && doc.modified === false,
    JSON.stringify(doc),
  );
  await second.page.waitForFunction(() => window.__easy68k.ctx.settings.get().editor.colorPreset === 1);
  check(`${p} the other window has OK's settings`, (await editorSettings(second.page)).fontName === 'Courier');

  // The dialog in the dark theme.
  await page.evaluate(() => window.__easy68k.ctx.settings.update((s) => ({ ...s, app: { ...s.app, theme: 'dark' } })));
  await updateEditor(page, { colorPreset: 5 });
  await startCommand(page, 'ed.options.editor');
  await dialog.waitFor();
  const darkBackground = await dialog
    .locator('[data-e68-options=preview]')
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  check(
    `${p} dark theme: the Auto preview uses the dark palette (#1B1F24)`,
    darkBackground === 'rgb(27, 31, 36)',
    darkBackground,
  );
  await page.screenshot({ path: join(outDir, `${name}-editor-options-dark.png`) });
  await scan(page, `${name} Editor Options (dark)`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await commandDone(page);

  check(
    `${p} no console errors`,
    errors.length === 0 && second.errors.length === 0,
    [...errors, ...second.errors].join(' | '),
  );
  await closeWithin(context);
}

// ---- Assembler Options ------------------------------------------------------------------------

async function assemblerOptionsPass(browser, name) {
  const p = `${name}: Assembler Options:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const { page, errors } = await openApp(context);
  const before = await editorSettings(page);

  await startCommand(page, 'ed.options.assembler');
  const dialog = dialogByTitle(page, 'EASy68K Assembler Options');
  await dialog.waitFor();
  check(
    `${p} modeless`,
    (await dialog.getAttribute('aria-modal')) === null &&
      !(await page.evaluate(() => window.__easy68k.ctx.dialogs.isModalOpen())),
  );
  const tabs = await dialog.getByRole('tab').allInnerTexts();
  check(
    `${p} tabs Assembler Options and Template, the first selected`,
    same(tabs, ['Assembler Options', 'Template']) &&
      (await dialog.getByRole('tab', { name: 'Assembler Options' }).getAttribute('aria-selected')) === 'true',
  );
  const checks = await dialog
    .locator('label.e68-checkbox')
    .evaluateAll((all) => all.map((l) => [l.innerText.trim(), l.title || null, l.querySelector('input').checked]));
  check(
    `${p} nine check boxes with captions, tool-tips and defaults`,
    same(checks, [
      ['Generate List File', 'Generates a list file upon assembly [RECOMMENDED]', true],
      ['Auto Save Modified Source Before Assembling', 'If checked source will be saved before assembly', false],
      ['Generate S-Record', 'Generate a S-Record file upon assembly  [RECOMENDED]', true],
      ['Assemble Bit Field Instructions', null, true],
      ['Show Warnings', null, true],
      ['Cross Reference', 'Cross Reference list file', true],
      ['Structured Expanded', 'Expand macros in list file', false],
      ['Constants Expanded', 'Expand constants in list file', false],
      ['Macros Expanded', 'Expand macros in list file', false],
    ]),
    JSON.stringify(checks),
  );
  const groups = await dialog.locator('legend').allInnerTexts();
  check(`${p} groups`, same(groups, ['Assembler Options', 'List File Options']), JSON.stringify(groups));
  const ok = dialog.getByRole('button', { name: 'OK' });
  check(
    `${p} OK has the tool-tip Save Settings; Cancel is C&ancel`,
    (await ok.getAttribute('title')) === 'Save Settings' &&
      (await dialog.locator('.e68-dialog__footer button').nth(1).innerText()).trim() === 'Cancel',
  );
  await page.screenshot({ path: join(outDir, `${name}-assembler-options.png`) });
  await scan(page, `${name} Assembler Options`);

  // The Sim68K question; No re-checks both boxes and keeps the dialog open.
  await dialog.getByLabel('Generate List File').uncheck();
  await dialog.getByLabel('Show Warnings').uncheck();
  await ok.click();
  const box = page.locator('[role=alertdialog]').last();
  await box.waitFor();
  const question = await textOf(box);
  check(
    `${p} OK with Generate List File unchecked asks the Sim68K question (Information, Yes/No)`,
    question.includes('Information') &&
      question.includes(
        'You have unchecked options that are required for use by the 68000 simulator Sim68K. Without these options many features of Sim68K will be unavailable. Do you wish to continue?',
      ) &&
      (await box.getByRole('button').allInnerTexts()).map((t) => t.trim()).join(',') === 'Yes,No',
    question,
  );
  await page.screenshot({ path: join(outDir, `${name}-assembler-question.png`) });
  await box.getByRole('button', { name: 'No' }).click();
  await box.waitFor({ state: 'detached' });
  check(
    `${p} No: both boxes re-checked, the dialog stays open, nothing written`,
    (await dialog.getByLabel('Generate List File').isChecked()) &&
      (await dialog.getByLabel('Generate S-Record').isChecked()) &&
      !(await dialog.getByLabel('Show Warnings').isChecked()) &&
      same(await editorSettings(page), before),
  );
  // The Help key opens options.htm, not main.htm: the dialog's box lists it in data-e68-own-keys,
  // so the shell's key dispatcher leaves it to the dialog (docs/requests/E4-dialog-help-key.md).
  const help = await helpKey(page);
  const owns = await dialog.getAttribute('data-e68-own-keys');
  check(
    `${p} the dialog box owns ${help.chord} (data-e68-own-keys)`,
    (owns ?? '').split(' ').includes(help.chord),
    owns,
  );
  for (const [where, target] of [
    ['a check box', dialog.getByLabel('Show Warnings')],
    ['the Cancel button', dialog.getByRole('button', { name: 'Cancel' })],
  ]) {
    await target.focus();
    await page.keyboard.press(help.key);
    check(
      `${p} ${help.chord} (Help key on ${help.os}) on ${where} of the modeless dialog opens options.htm`,
      await helpShowsOptions(page),
    );
    await page.screenshot({ path: join(outDir, `${name}-assembler-help.png`) });
    await closeHelp(page);
  }
  check(`${p} the dialog is still open after Help`, (await openDialogIds(page)).includes('options.assembler'));
  // Cancel restores.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await commandDone(page);
  check(`${p} Cancel writes nothing`, same(await editorSettings(page), before));

  // OK writes; the Template tab.
  await startCommand(page, 'ed.options.assembler');
  await dialog.waitFor();
  check(`${p} shown again: the box shows the stored value`, await dialog.getByLabel('Show Warnings').isChecked());
  await dialog.getByLabel('Macros Expanded').check();
  await dialog.getByRole('tab', { name: 'Template' }).click();
  const area = dialog.locator('textarea');
  check(`${p} Template holds the template`, (await area.inputValue()) === before.template);
  const font = await area.evaluate((e) => getComputedStyle(e).fontFamily);
  check(`${p} Template is in the Editor Options font`, font.includes('Courier New'), font);
  await area.focus();
  await area.evaluate((e) => e.setSelectionRange(0, 0));
  await page.keyboard.press('Tab');
  await page.keyboard.type('X');
  check(`${p} Tab types a tab character in the template`, (await area.inputValue()).startsWith('\tX*---'));
  await page.screenshot({ path: join(outDir, `${name}-assembler-template.png`) });
  await dialog.getByRole('button', { name: 'Save Template' }).click();
  check(`${p} Save Template writes the template at once`, (await editorSettings(page)).template.startsWith('\tX*---'));
  await ok.click();
  await commandDone(page);
  const after = await editorSettings(page);
  check(
    `${p} OK writes the boxes`,
    after.macrosExpanded === true && after.showWarnings === true,
    JSON.stringify(after.macrosExpanded),
  );
  check(`${p} no console errors`, errors.length === 0, errors.join(' | '));
  await closeWithin(context);
}

// ---- Import/Export Settings -------------------------------------------------------------------

async function transferPass(browser, name) {
  const p = `${name}: Import/Export Settings:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const { page, errors } = await openApp(context);
  const second = await openApp(context);
  const shipped = Array.from(readFileSync(join(fixtures, 'shipped-settings.dat')));
  await page.evaluate(
    (bytes) => window.__easy68k.ctx.vfs.writeFile('/browser/settings.dat', Uint8Array.from(bytes)),
    shipped,
  );
  await updateEditor(page, { fontSize: 14, realTabs: true, colorPreset: 5 });

  await startCommand(page, 'ed.options.transfer');
  const dialog = dialogByTitle(page, 'Import/Export Settings');
  await dialog.waitFor();
  const text = await textOf(dialog);
  check(
    `${p} three files with Import... and Export..., and Close`,
    [
      'settings.dat',
      'sim68K.dat',
      'template.NEW',
      'Editor/Assembler settings',
      'Simulator settings',
      'New file template',
    ].every((t) => text.includes(t)) &&
      (await dialog.getByRole('button', { name: /^Import / }).count()) === 3 &&
      (await dialog.getByRole('button', { name: /^Export / }).count()) === 3,
    text,
  );
  await page.screenshot({ path: join(outDir, `${name}-transfer.png`) });
  await scan(page, `${name} Import/Export Settings`);

  // Import settings.dat through the real Open dialog.
  await dialog.getByRole('button', { name: 'Import settings.dat' }).click();
  const open = dialogByTitle(page, 'Import settings.dat');
  await open.waitFor();
  await open.getByLabel('File name:').fill('settings.dat');
  await open.getByRole('button', { name: 'Open', exact: true }).click();
  await dialog.locator('[role=status]', { hasText: 'Imported' }).waitFor();
  check(
    `${p} status after the import`,
    (await dialog.locator('[role=status]').innerText()) === 'Imported settings.dat from /browser/settings.dat.',
  );
  const imported = await editorSettings(page);
  check(
    `${p} the shipped settings.dat sets the "Shipped file" values`,
    imported.fontSize === 10 &&
      imported.realTabs === false &&
      imported.colorPreset === -1 &&
      imported.styles.comment.color === 16711680,
    JSON.stringify([imported.fontSize, imported.realTabs, imported.colorPreset]),
  );
  const reached = await second.page
    .waitForFunction(() => window.__easy68k.ctx.settings.get().editor.colorPreset === -1, null, { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  check(`${p} the import reaches the other window`, reached);
  await updateEditor(second.page, { lineNumbers: false });
  await page.waitForFunction(() => window.__easy68k.ctx.settings.get().editor.lineNumbers === false);
  check(
    `${p} the other window's next write does not undo the import`,
    (await editorSettings(page)).fontSize === 10 && (await editorSettings(second.page)).fontSize === 10,
  );

  // Export sim68K.dat through the real Save dialog.
  await dialog.getByRole('button', { name: 'Export sim68K.dat' }).click();
  const save = dialogByTitle(page, 'Export sim68K.dat');
  await save.waitFor();
  await save.getByLabel('File name:').fill('exported');
  await save.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.locator('[role=status]', { hasText: 'Exported' }).waitFor();
  const status = await dialog.locator('[role=status]').innerText();
  const bytes = await page.evaluate(async () =>
    Array.from(await window.__easy68k.ctx.vfs.readFile('/browser/exported.dat')),
  );
  const lines = [];
  let start = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) {
      lines.push(bytes.slice(start, i));
      start = i + 2;
    }
  }
  check(
    `${p} the exported sim68K.dat: 37 lines, the v5.16.1 header, raw bytes on lines 2, 3 and 34`,
    status === 'Exported sim68K.dat to /browser/exported.dat.' &&
      lines.length === 37 &&
      String.fromCharCode(...lines[0]) === '$Settings for EASy68K Simulator v5.16.1  DO NOT EDIT THIS FILE!!!!' &&
      lines[1][0] === 0 &&
      lines[2][0] === 0 &&
      lines[33][0] === 0 &&
      String.fromCharCode(...lines[1].slice(1)) === '$exec log',
    `${status} / ${lines.length} lines`,
  );
  await page.screenshot({ path: join(outDir, `${name}-transfer-done.png`) });
  await dialog.locator('.e68-dialog__footer').getByRole('button', { name: 'Close' }).click();
  await commandDone(page);

  // From Simulator mode as well.
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'simulator'));
  await startCommand(page, 'sim.options.transfer');
  await dialog.waitFor();
  check(
    `${p} opens from the Simulator's Options menu as well`,
    (await openDialogIds(page)).includes('settings.transfer'),
  );
  await page.keyboard.press('Escape');
  await commandDone(page);

  check(
    `${p} no console errors`,
    errors.length === 0 && second.errors.length === 0,
    [...errors, ...second.errors].join(' | '),
  );
  await closeWithin(context);
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(repoRoot, 'build', 'E4', 'vite-cache'),
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
          ['Editor Options', editorOptionsPass],
          ['Assembler Options', assemblerOptionsPass],
          ['Import/Export Settings', transferPass],
        ]) {
          console.log(`\n[${name}, ${label}]`);
          try {
            await pass(browser, name);
          } catch (error) {
            check(`${name}: the ${label} pass ran to the end`, false, String(error?.stack ?? error).slice(0, 600));
          }
        }
      } finally {
        await doneWith(browser, { last: name === browsers.at(-1) });
      }
    }
  } finally {
    closeAtEnd(server);
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  await endChecks(failures ? 1 : 0);
}

await main();
