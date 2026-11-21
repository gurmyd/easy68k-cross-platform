// Browser check of the component kit (ARCHITECTURE.md 9.1 W2 acceptance). Owner: W2.
//
//   node app/src/ui/components/gallery/check-gallery.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port, opens the gallery page in
// headless Chromium and WebKit (Playwright) and, in both themes:
//   - runs an axe-core scan (WCAG 2.0 / 2.1 A and AA) of the page, of an open
//     menu, of an open modal dialog and of an open message box; any finding of
//     impact "serious" or "critical" fails the run;
//   - takes screenshots (default folder: build/gallery-check, git-ignored);
// and, once per browser, drives the keyboard behaviour of 2.11 (menu bar,
// toolbar, tabs, dialog) and of the masked fields (hardware §2.1, sim-ui
// §4.4), the splitter, the lists, the context menu and the toasts. Console
// errors and page errors fail the run too. Exit code 0 = everything passed.
//
// It lives here rather than in tests/ because W2 owns only app/src/styles and
// app/src/ui/components; docs/requests/W2-gallery-check.md asks for a CI job.

/* global console, process, document -- document: inside page.evaluate() callbacks, which run in the page */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'gallery-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const THEMES = ['light', 'dark'];

/** The gallery page on the dev server (set by main). */
let pageUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- helpers ------------------------------------------------------------------------

async function openGallery(browser, theme, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${pageUrl}?theme=${theme}`);
  await page.waitForSelector('[data-gallery-ready]');
  return { context, page, errors };
}

async function scan(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const other = result.violations.filter((v) => !serious.includes(v));
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious finding`, serious.length === 0, describe(serious).join('; '));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
  if (result.incomplete.length) {
    console.log(`        needs review (axe could not decide): ${describe(result.incomplete).join('; ')}`);
  }
}

const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName,
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label'),
      text: (el.textContent ?? '').trim().slice(0, 60),
      testid: el.getAttribute('data-testid'),
      value: el.value ?? null,
      selStart: el.selectionStart ?? null,
      selEnd: el.selectionEnd ?? null,
      inDialog: Boolean(el.closest('[role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]')),
      inToolbar: Boolean(el.closest('[data-testid=editor-toolbar]')),
      expanded: el.getAttribute('aria-expanded'),
      selected: el.getAttribute('aria-selected'),
      activedescendant: el.getAttribute('aria-activedescendant'),
    };
  });
const output = (page) => page.locator('[data-testid=gallery-output]').innerText();

// --- theme pass: scans and screenshots ------------------------------------------------

async function themePass(browser, name, theme) {
  console.log(`\n[${name}, ${theme}]`);
  const { context, page, errors } = await openGallery(browser, theme);
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check(`${name} ${theme}: data-theme is applied`, applied === theme, `data-theme=${applied}`);
  await page.waitForTimeout(150);
  await scan(page, `${name} ${theme} page`);
  await page.screenshot({ path: join(outDir, `${name}-${theme}-full.png`), fullPage: true });

  // An open menu.
  await page.locator('[data-testid=editor-menubar] [role=menuitem]').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('[role=menu][data-e68-menu]:not(.e68-menu--inline)');
  await scan(page, `${name} ${theme} open menu`);
  await page.locator('[data-testid=editor-menubar]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `${name}-${theme}-menu.png`) });
  await page.keyboard.press('Escape');

  // A modal dialog and a message box.
  await page.locator('[data-testid=open-modal]').click();
  await page.waitForSelector('[role=dialog][aria-modal=true]');
  await scan(page, `${name} ${theme} modal dialog`);
  await page.screenshot({ path: join(outDir, `${name}-${theme}-dialog.png`) });
  await page.keyboard.press('Escape');
  await page.locator('[data-testid=open-message-confirmation]').click();
  await page.waitForSelector('[role=alertdialog][aria-modal=true]');
  await scan(page, `${name} ${theme} message box`);
  await page.screenshot({ path: join(outDir, `${name}-${theme}-messagebox.png`) });
  await page.keyboard.press('Escape');

  // Narrow window.
  await page.setViewportSize({ width: 760, height: 900 });
  await page.screenshot({ path: join(outDir, `${name}-${theme}-narrow.png`) });

  check(`${name} ${theme}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- keyboard pass -----------------------------------------------------------------

async function keyboardPass(browser, name) {
  console.log(`\n[${name}, keyboard]`);
  const { context, page, errors } = await openGallery(browser, 'light');
  const k = (key) => page.keyboard.press(key);
  const p = `${name}:`;

  // Toolbar (2.11): one tab stop, arrows, Home / End, disabled skipped, Tab leaves.
  const stops = await page.locator('[data-testid=editor-toolbar] [tabindex="0"]').count();
  check(`${p} toolbar has exactly one tab stop`, stops === 1, `${stops}`);
  await page.locator('[data-testid=editor-toolbar] [tabindex="0"]').focus();
  let a = await active(page);
  check(`${p} toolbar tab stop is the first button`, a?.label === 'New', a?.label);
  await k('ArrowRight');
  a = await active(page);
  check(`${p} toolbar Right moves to Open`, a?.label === 'Open (Ctrl+O)', a?.label);
  await k('End');
  a = await active(page);
  check(`${p} toolbar End goes to Assemble`, a?.label === 'Assemble Source (F9)', a?.label);
  await k('ArrowRight');
  a = await active(page);
  check(`${p} toolbar Right wraps to New`, a?.label === 'New', a?.label);
  await page.locator('[data-testid=editor-toolbar] [aria-label="Paste (Ctrl+V)"]').focus();
  await k('ArrowLeft');
  a = await active(page);
  check(`${p} toolbar Left skips the disabled Copy and Cut`, a?.label === 'Find (Ctrl+F)', a?.label);
  await k('Tab');
  a = await active(page);
  check(`${p} toolbar Tab leaves the toolbar`, a !== null && !a.inToolbar, a?.label ?? a?.text);
  await page.keyboard.down('Shift');
  await k('Tab');
  await page.keyboard.up('Shift');
  a = await active(page);
  check(`${p} toolbar Shift+Tab comes back to the last used button`, a?.label === 'Find (Ctrl+F)', a?.label);

  // Menu bar (2.11).
  await page.locator('[data-testid=open-find]').focus();
  await page.locator('[data-testid=editor-menubar] [role=menuitem]').first().focus();
  await k('ArrowRight');
  a = await active(page);
  check(`${p} menubar Right moves to Edit`, a?.text === 'Edit' && a?.expanded === 'false', `${a?.text} ${a?.expanded}`);
  await k('ArrowDown');
  a = await active(page);
  check(`${p} menubar Down opens Edit on its first item`, a?.role === 'menuitem' && a.text.startsWith('Undo'), a?.text);
  await k('ArrowDown');
  a = await active(page);
  check(`${p} menu Down reaches the disabled Redo`, a?.text.startsWith('Redo'), a?.text);
  await k('ArrowRight');
  a = await active(page);
  check(`${p} menu Right opens the next menu (Project)`, a?.text.startsWith('Assemble Source'), a?.text);
  await k('Escape');
  a = await active(page);
  const menus = await page.locator('[role=menu][data-e68-menu]:not(.e68-menu--inline)').count();
  check(`${p} Escape closes the menu, focus on its title`, menus === 0 && a?.text === 'Project', `${menus} ${a?.text}`);
  await k('o');
  a = await active(page);
  check(`${p} access key O opens Options`, a?.text.startsWith('Assembler Options'), a?.text);
  await k('ArrowDown');
  await k('Enter');
  a = await active(page);
  const out = await output(page);
  check(`${p} Enter chooses Editor Options`, out.includes('ed.options.editor'), out);
  check(
    `${p} the focus goes back to where it was before the menu bar`,
    a?.testid === 'open-find',
    a?.testid ?? a?.text,
  );
  await page.locator('[data-testid=editor-menubar] [role=menuitem]').first().focus();
  await k('ArrowDown');
  await k('x');
  const exitOut = await output(page);
  check(`${p} a letter inside a menu chooses its item (E&xit)`, exitOut.includes('ed.file.exit'), exitOut);

  // Context menu: Shift+F10 opens at the focused element, Escape gives the focus back.
  await page.locator('[data-testid=context-target]').focus();
  await page.keyboard.down('Shift');
  await k('F10');
  await page.keyboard.up('Shift');
  a = await active(page);
  check(
    `${p} Shift+F10 opens the context menu on its first item`,
    a?.role === 'menuitem' && a.text.startsWith('Undo'),
    a?.text,
  );
  await k('Escape');
  a = await active(page);
  check(`${p} Escape closes the context menu, focus back`, a?.testid === 'context-target', a?.testid ?? a?.text);

  // Tabs (2.11).
  const docTabs = page.locator('#tabs [role=tablist]').first();
  await docTabs.locator('[aria-selected=true]').focus();
  await k('ArrowRight');
  a = await active(page);
  check(
    `${p} tabs Right selects and focuses macros.X68`,
    a?.role === 'tab' && a.selected === 'true' && a.text.includes('macros'),
    a?.text,
  );
  await k('End');
  a = await active(page);
  check(`${p} tabs End selects the last tab`, a?.text.includes('demo.L68') && a.selected === 'true', a?.text);
  await k('ArrowRight');
  a = await active(page);
  check(`${p} tabs Right wraps to the first tab`, a?.text.includes('demo.X68') && a.selected === 'true', a?.text);
  const tabStops = await docTabs.locator('[role=tab][tabindex="0"]').count();
  check(`${p} the tab list is one tab stop`, tabStops === 1, `${tabStops}`);
  await k('Delete');
  await page.waitForTimeout(50);
  const remaining = await docTabs.locator('[role=tab]').count();
  a = await active(page);
  check(
    `${p} Delete closes the tab and focuses its neighbour`,
    remaining === 2 && a?.role === 'tab',
    `${remaining} ${a?.text}`,
  );

  // Modal dialog (2.7, 2.11).
  await page.locator('[data-testid=open-modal]').click();
  a = await active(page);
  check(`${p} the modal dialog takes the focus (default button)`, a?.inDialog && a.text === 'OK', a?.text);
  let escaped = false;
  for (let i = 0; i < 12; i++) {
    await k('Tab');
    if (!(await active(page))?.inDialog) escaped = true;
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('Shift');
    await k('Tab');
    await page.keyboard.up('Shift');
    if (!(await active(page))?.inDialog) escaped = true;
  }
  check(`${p} Tab and Shift+Tab stay inside the modal dialog`, !escaped);
  await page.locator('body').click({ position: { x: 5, y: 300 }, force: true });
  a = await active(page);
  check(`${p} a click on the backdrop leaves the focus in the dialog`, a?.inDialog === true, a?.text);
  const listingBefore = await page.locator('[role=dialog] input[type=checkbox]').first().isChecked();
  await page.keyboard.down('Alt');
  await k('KeyL');
  await page.keyboard.up('Alt');
  const listingAfter = await page.locator('[role=dialog] input[type=checkbox]').first().isChecked();
  check(
    `${p} Alt+L toggles 'Generate &Listing file'`,
    listingBefore !== listingAfter,
    `${listingBefore} -> ${listingAfter}`,
  );
  await page.locator('[data-testid=open-nested]').click();
  a = await active(page);
  check(`${p} a message box over the dialog takes the focus`, a?.text === 'OK', a?.text);
  await k('Escape');
  a = await active(page);
  const dialogs = await page.locator('[aria-modal=true]').count();
  check(
    `${p} Escape closes only the message box; focus back in the dialog`,
    dialogs === 1 && a?.inDialog,
    `${dialogs} ${a?.text}`,
  );
  await k('Escape');
  a = await active(page);
  check(
    `${p} Escape closes the dialog and the focus returns to the opener`,
    a?.testid === 'open-modal',
    a?.testid ?? a?.text,
  );
  check(`${p} Escape reported Cancel`, (await output(page)).includes('Assembler Options: Cancel'));
  await page.locator('[data-testid=open-modal]').click();
  await page.locator('[role=dialog] input[type=checkbox]').first().focus();
  await k('Enter');
  check(`${p} Enter in a check box presses the default button`, (await output(page)).includes('Assembler Options: OK'));

  // Message boxes.
  await page.locator('[data-testid=open-message-confirmation]').click();
  await k('n');
  check(`${p} message box: the access key N answers No`, (await output(page)).includes('Confirm: No'));
  await page.locator('[data-testid=open-message-error]').click();
  await k('Escape');
  const stillOpen = await page.locator('[role=alertdialog][aria-modal=true]').count();
  check(`${p} a Yes/No message box ignores Escape`, stillOpen === 1, `${stillOpen}`);
  await k('Enter');
  check(`${p} Enter presses the focused default button (Yes)`, (await output(page)).includes('Error: Yes'));

  // Masked fields (hardware §2.1, sim-ui §4.4).
  const beeps = async () => Number(await page.locator('[data-testid=beep-count]').innerText());
  const d0 = page.locator('[data-testid=reg-d0]');
  await d0.focus();
  a = await active(page);
  check(
    `${p} register field selects everything on focus`,
    a?.selStart === 0 && a.selEnd === 8,
    `${a?.selStart}-${a?.selEnd}`,
  );
  await page.keyboard.type('e0');
  a = await active(page);
  check(
    `${p} typing e0 over a selected register gives E0000000`,
    a?.value === 'E0000000' && a.selStart === 2,
    `${a?.value} @${a?.selStart}`,
  );
  check(
    `${p} the value reaches the owner at once`,
    (await page.locator('[data-testid=readout-d0]').innerText()) === String(0xe0000000),
  );
  await k('7');
  await k('Backspace');
  a = await active(page);
  check(
    `${p} Backspace leaves a 0 and moves left`,
    a?.value === 'E0000000' && a.selStart === 2,
    `${a?.value} @${a?.selStart}`,
  );
  const before = await beeps();
  await k('g');
  a = await active(page);
  check(
    `${p} a non-hex key is refused with a beep`,
    a?.value === 'E0000000' && (await beeps()) === before + 1,
    a?.value,
  );
  await k('Home');
  await k('Delete');
  a = await active(page);
  check(
    `${p} Delete leaves a 0 and keeps the caret`,
    a?.value === '00000000' && a.selStart === 0,
    `${a?.value} @${a?.selStart}`,
  );
  await k('End');
  const beforeEnd = await beeps();
  await k('1');
  a = await active(page);
  check(
    `${p} a key at the end of the field is refused`,
    a?.value === '00000000' && (await beeps()) === beforeEnd + 1,
    a?.value,
  );

  const sr = page.locator('[data-testid=reg-sr]');
  await sr.focus();
  await sr.evaluate((el) => el.setSelectionRange(1, 1));
  await k('1');
  a = await active(page);
  check(
    `${p} SR: 1 overwrites at the caret`,
    a?.value === '0110000000000000' && a.selStart === 2,
    `${a?.value} @${a?.selStart}`,
  );
  await sr.evaluate((el) => el.setSelectionRange(2, 2));
  await k('Backspace');
  a = await active(page);
  check(
    `${p} SR: Backspace types 0 at the caret and moves right`,
    a?.value === '0100000000000000' && a.selStart === 3,
    `${a?.value} @${a?.selStart}`,
  );
  await sr.evaluate((el) => el.setSelectionRange(0, 0));
  const srBeeps = await beeps();
  await k('7');
  a = await active(page);
  check(
    `${p} SR: an invalid key types 0 with a beep`,
    a?.value === '0100000000000000' && a.selStart === 1 && (await beeps()) === srBeeps + 1,
    `${a?.value} @${a?.selStart}`,
  );
  check(`${p} SR readout follows`, (await page.locator('[data-testid=readout-sr]').innerText()).startsWith('$4000'));

  const interval = page.locator('[data-testid=hw-interval]');
  await interval.focus();
  await interval.evaluate((el) => el.setSelectionRange(0, 0));
  await k('5');
  a = await active(page);
  check(`${p} interval: typing 5 over 00001000 gives 50001000`, a?.value === '50001000', a?.value);
  const seg = page.locator('[data-testid=hw-seg]');
  await seg.focus();
  await seg.evaluate((el) => el.select());
  await page.keyboard.type('E0');
  a = await active(page);
  check(`${p} address: E0 into a cleared field gives E00000`, a?.value === 'E00000', a?.value);

  // Splitter.
  const splitter = page.locator('#splitters [role=separator]').first();
  await splitter.focus();
  const valueNow = async () => Number(await splitter.getAttribute('aria-valuenow'));
  await k('ArrowRight');
  check(`${p} splitter Right adds 10 px`, (await valueNow()) === 270, String(await valueNow()));
  await page.keyboard.down('Shift');
  await k('ArrowLeft');
  await page.keyboard.up('Shift');
  check(`${p} splitter Shift+Left takes 50 px`, (await valueNow()) === 220, String(await valueNow()));
  await k('Home');
  check(`${p} splitter Home goes to the minimum`, (await valueNow()) === 120, String(await valueNow()));
  await k('Enter');
  check(`${p} splitter Enter restores the default`, (await valueNow()) === 260, String(await valueNow()));
  await splitter.scrollIntoViewIfNeeded();
  const box = await splitter.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
  }
  check(`${p} splitter drag moves it`, (await valueNow()) === 300, String(await valueNow()));

  // List box and grid.
  const listbox = page.locator('#lists [role=listbox]').first();
  await listbox.focus();
  await k('ArrowDown');
  a = await active(page);
  const selected = await page.locator(`#${a?.activedescendant?.replace(/:/g, '\\:')}`).innerText();
  check(`${p} list box Down selects the next option`, selected === 'Directive', selected);
  await k('l');
  a = await active(page);
  const typed = await page.locator(`#${a?.activedescendant?.replace(/:/g, '\\:')}`).innerText();
  check(`${p} list box type-ahead L selects Label`, typed === 'Label', typed);
  const grid = page.locator('#lists [role=grid]').first();
  await grid.focus();
  await k('ArrowDown');
  await k('Enter');
  check(`${p} grid Down + Enter goes to line 14`, (await output(page)).includes('Go to line 14'));

  // Toast.
  await page.locator('[data-testid=show-toast]').click();
  const toast = await page.locator('.e68-toasts:not(.e68-toasts--inline) .e68-toast').count();
  check(`${p} a toast appears in the live region`, toast === 1, `${toast}`);

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- run ------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    server: { port: 5199, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5199;
  pageUrl = `http://127.0.0.1:${port}/src/ui/components/gallery/gallery.html`;
  console.log(`Gallery: ${pageUrl}\nScreenshots: ${outDir}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        for (const theme of THEMES) await themePass(browser, name, theme);
        await keyboardPass(browser, name);
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
