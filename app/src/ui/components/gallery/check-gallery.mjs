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

/* global console, process, document, window -- document, window: inside page.evaluate() callbacks, which run in the page */

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
  // Explicit limits: the machines that run this are often under heavy load.
  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(60_000);
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
  const analyze = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  let result;
  try {
    result = await analyze();
  } catch (error) {
    // Seen once in WebKit on a loaded machine: the injected axe script was not there yet
    // ("window.axe.runPartial" undefined). One retry; a second failure ends the run.
    if (!/window\.axe/.test(String(error))) throw error;
    console.log(`        axe was not ready (${String(error).split('\n')[0]}); retrying once`);
    await page.waitForTimeout(500);
    result = await analyze();
  }
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

  // Tab and Shift+Tab in an open menu close it, and the focus moves on from the menu bar in
  // document order: to where Tab and Shift+Tab from the bar's own title go.
  const firstTitle = page.locator('[data-testid=editor-menubar] [role=menuitem]').first();
  const describeFocus = (f) => (f ? `${f.tag} ${f.testid ?? f.label ?? f.text}` : 'nothing');
  const fromTitle = {};
  for (const combo of ['Tab', 'Shift+Tab']) {
    await firstTitle.focus();
    await k(combo);
    fromTitle[combo] = await active(page);
  }
  for (const combo of ['Tab', 'Shift+Tab']) {
    await firstTitle.focus();
    await k('ArrowDown');
    await k(combo);
    a = await active(page);
    const stillOpen = await page.locator('[role=menu][data-e68-menu]:not(.e68-menu--inline)').count();
    const expected = fromTitle[combo];
    check(
      `${p} ${combo} in an open menu closes it and moves on from the menu bar`,
      stillOpen === 0 &&
        a !== null &&
        a.tag !== 'BODY' &&
        expected?.tag !== 'BODY' &&
        JSON.stringify(a) === JSON.stringify(expected),
      `${stillOpen} open; focus on ${describeFocus(a)}, ${combo} from the title goes to ${describeFocus(expected)}`,
    );
  }

  // The same with tab stops a hand-made list of focusable elements misjudges, next to the bar:
  // after it a hidden button, a button in a disabled fieldset, a closed <details> (its summary is
  // the next stop) and a later button with tabindex 3; before it a plaintext-only contenteditable.
  await page.evaluate(() => {
    const bar = document.querySelector('[data-testid=editor-menubar]');
    const after = document.createElement('div');
    after.setAttribute('data-probe', '');
    after.innerHTML =
      '<button style="visibility:hidden">hidden</button>' +
      '<fieldset disabled><button>in disabled fieldset</button></fieldset>' +
      '<details><summary data-testid="probe-summary">summary</summary><button>inside</button></details>' +
      '<button tabindex="3">tabindex 3</button>';
    const before = document.createElement('div');
    before.setAttribute('data-probe', '');
    before.innerHTML = '<div contenteditable="plaintext-only" data-testid="probe-editable">editable</div>';
    bar.after(after);
    bar.before(before);
  });
  for (const combo of ['Tab', 'Shift+Tab']) {
    await firstTitle.focus();
    await k(combo);
    const expected = await active(page);
    await firstTitle.focus();
    await k('ArrowDown');
    await k(combo);
    a = await active(page);
    const wanted = combo === 'Tab' ? 'probe-summary' : 'probe-editable';
    check(
      `${p} ${combo} in an open menu goes where the browser's Tab goes, past unusual tab stops`,
      a?.testid === wanted && JSON.stringify(a) === JSON.stringify(expected),
      `focus on ${describeFocus(a)}, ${combo} from the title goes to ${describeFocus(expected)}`,
    );
  }
  await page.evaluate(() => document.querySelectorAll('[data-probe]').forEach((element) => element.remove()));

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
  // aria-controls names a panel that is in the page, on the selected tab only (lazy panels).
  const controls = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role=tab][aria-controls]')).map((tab) => ({
      selected: tab.getAttribute('aria-selected'),
      present: document.getElementById(tab.getAttribute('aria-controls') ?? '') !== null,
    })),
  );
  check(
    `${p} only selected tabs carry aria-controls, and it names a rendered panel`,
    controls.length > 0 && controls.every((c) => c.selected === 'true' && c.present),
    JSON.stringify(controls),
  );
  await k('Delete');
  // Tabs focuses the neighbour in the next animation frame, which a loaded runner can delay
  // well past a fixed pause (WebKit on ubuntu-latest): wait for it, up to 3 s.
  const waitStart = Date.now();
  await page
    .waitForFunction(() => document.activeElement?.getAttribute('role') === 'tab', null, { timeout: 3000 })
    .catch(() => console.log(`        no tab had the focus ${Date.now() - waitStart} ms after Delete`));
  const remaining = await docTabs.locator('[role=tab]').count();
  a = await active(page);
  check(
    `${p} Delete closes the tab and focuses its neighbour`,
    remaining === 2 && a?.role === 'tab',
    `${remaining} tabs left; focus on ${a?.tag} role=${a?.role} "${a?.text.slice(0, 30)}"`,
  );

  // Modal dialog (2.7, 2.11). The dialog moves the focus on every Tab and Shift+Tab itself
  // (errata W2 entry 13): Safari with the macOS default setting skips buttons and check boxes, so a
  // dialog that left the moves in the middle of its list to the browser lost the focus there. The
  // checks below would catch that in any browser: a listener on window (after the dialog's handler)
  // records whether each Tab was cancelled, and the visit order is compared with the dialog's
  // controls as the page lists them.
  await page.evaluate(() => {
    window.__e68tabs = [];
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') window.__e68tabs.push(event.defaultPrevented);
    });
    window.__e68name = (el) => {
      if (!el) return 'nothing';
      if (el === document.body) return 'BODY';
      const label =
        el.getAttribute('aria-label') ??
        (el.labels && el.labels[0] ? el.labels[0].textContent : null) ??
        el.textContent ??
        '';
      const role = el.getAttribute('role');
      const where = el.closest('[aria-modal=true]') ? '' : ' (outside the dialog)';
      return `${el.tagName.toLowerCase()}${el.type && el.tagName === 'INPUT' ? `[${el.type}]` : ''}${
        role ? `[${role}]` : ''
      } "${label.trim().slice(0, 30)}"${where}`;
    };
  });
  const focusName = () => page.evaluate(() => window.__e68name(document.activeElement));
  const tabLog = () => page.evaluate(() => window.__e68tabs.splice(0));
  const press = async (combo, count, names) => {
    for (let i = 0; i < count; i++) {
      await k(combo);
      names.push(await focusName());
    }
  };
  await page.locator('[data-testid=open-modal]').click();
  a = await active(page);
  check(`${p} the modal dialog takes the focus (default button)`, a?.inDialog && a.text === 'OK', a?.text);
  // The dialog's dialogControls in document order: what Tab must visit, whatever the browser's own Tab does.
  const dialogControls = await page.evaluate(() => {
    const box = document.querySelector('[role=dialog][aria-modal=true]');
    const candidates = box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]');
    return Array.from(candidates)
      .filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0)
      .map((el) => window.__e68name(el));
  });
  const start = dialogControls.indexOf(await focusName());
  const n = dialogControls.length;
  console.log(`        dialog controls (${n}): ${dialogControls.join(', ')}`);
  await tabLog();
  const forward = [];
  await press('Tab', n, forward);
  const wantForward = dialogControls.map((_, j) => dialogControls[(start + 1 + j) % n]);
  check(
    `${p} Tab from the default button visits every control of the dialog once, in order`,
    n >= 4 && start >= 0 && JSON.stringify(forward) === JSON.stringify(wantForward),
    `expected ${wantForward.join(' > ')}; got ${forward.join(' > ')}`,
  );
  const backward = [];
  await press('Shift+Tab', n, backward);
  const wantBackward = dialogControls.map((_, j) => dialogControls[(((start - 1 - j) % n) + n) % n]);
  check(
    `${p} Shift+Tab visits them in the reverse order`,
    n >= 4 && start >= 0 && JSON.stringify(backward) === JSON.stringify(wantBackward),
    `expected ${wantBackward.join(' > ')}; got ${backward.join(' > ')}`,
  );
  const cancelled = await tabLog();
  check(
    `${p} the dialog handles every Tab and Shift+Tab itself (each key cancelled)`,
    cancelled.length === 2 * n && cancelled.every(Boolean),
    `cancelled per key: ${cancelled.map((c) => (c ? 'y' : 'n')).join('')}`,
  );
  const wandering = [];
  await press('Tab', 12, wandering);
  await press('Shift+Tab', 12, wandering);
  check(
    `${p} Tab and Shift+Tab stay inside the modal dialog`,
    wandering.every((name) => dialogControls.includes(name)),
    `focus went ${wandering.join(' > ')}`,
  );
  for (const [combo, want] of [
    ['Tab', dialogControls[0]],
    ['Shift+Tab', dialogControls[n - 1]],
  ]) {
    await page.evaluate(() => document.activeElement?.blur());
    const blurred = await focusName();
    await k(combo);
    const got = await focusName();
    check(
      `${p} ${combo} with the focus on the body goes back into the dialog`,
      blurred === 'BODY' && got === want,
      `after blur the focus was on ${blurred}; ${combo} went to ${got}, expected ${want}`,
    );
  }
  await tabLog();
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
  // A group box's access key (GroupBox 'Ass&embler') moves the focus to the group's first control
  // and changes nothing (errata W2 entry 22).
  await page.locator('[role=dialog][aria-modal=true] [data-e68-default]').focus();
  await page.keyboard.down('Alt');
  await k('KeyE');
  await page.keyboard.up('Alt');
  const onFirstOfGroup = await page.evaluate(
    () => document.activeElement === document.querySelector('[data-testid=modal-groupbox] input'),
  );
  a = await active(page);
  const listingAfterGroup = await page.locator('[role=dialog] input[type=checkbox]').first().isChecked();
  check(
    `${p} Alt+E (group box 'Ass&embler') focuses the group's first control and changes nothing`,
    onFirstOfGroup && listingAfterGroup === listingAfter,
    `focus on ${a?.tag} ${a?.role ?? ''} '${a?.text}', checked ${listingAfter} -> ${listingAfterGroup}`,
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

  // A modal dialog with controls that cannot take the focus (visibility: hidden, inside a disabled
  // fieldset) and controls that lose it (disabled or removed when pressed). Tab must pass over them
  // and go on from where a lost control was, never stay in place (errata W2 entry 13).
  await page.locator('[data-testid=open-awkward]').click();
  await page.waitForSelector('[data-testid=awkward-body]', { timeout: 5000 });
  const awkwardNames = () =>
    page.evaluate(() => {
      const box = document.querySelector('[role=dialog][aria-modal=true]');
      const button = (text) => Array.from(box.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
      const field = box.querySelector('[data-testid=awkward-body] input:not([aria-label])');
      return {
        name: window.__e68name(field),
        disable: window.__e68name(button('Disable me')),
        remove: window.__e68name(button('Remove me')),
        three: window.__e68name(button('Three')),
        ok: window.__e68name(button('OK')),
        cancel: window.__e68name(button('Cancel')),
      };
    });
  const aw = await awkwardNames();
  a = await active(page);
  check(`${p} hidden controls: the dialog opens on its default button`, a?.inDialog && a.text === 'OK', a?.text);
  // The last stop is a container that hands its focus to its child "Inner" (followups item 1): the
  // dialog must count it as taken, not skip it.
  const inner = await page.evaluate(() =>
    window.__e68name(document.querySelector('[data-testid=awkward-handoff] button')),
  );
  await tabLog();
  const awForward = [];
  await press('Tab', 7, awForward);
  const awWantForward = [aw.cancel, aw.name, aw.disable, aw.remove, aw.three, inner, aw.ok];
  check(
    `${p} hidden controls: Tab passes over the hidden button and the disabled fieldset, and stops at a container that hands the focus to its child`,
    JSON.stringify(awForward) === JSON.stringify(awWantForward),
    `expected ${awWantForward.join(' > ')}; got ${awForward.join(' > ')}`,
  );
  const awBackward = [];
  await press('Shift+Tab', 7, awBackward);
  const awWantBackward = [inner, aw.three, aw.remove, aw.disable, aw.name, aw.cancel, aw.ok];
  check(
    `${p} hidden controls: Shift+Tab passes over them in the reverse order`,
    JSON.stringify(awBackward) === JSON.stringify(awWantBackward),
    `expected ${awWantBackward.join(' > ')}; got ${awBackward.join(' > ')}`,
  );
  const awCancelled = await tabLog();
  check(
    `${p} hidden controls: each key cancelled`,
    awCancelled.length === 14 && awCancelled.every(Boolean),
    `cancelled per key: ${awCancelled.map((c) => (c ? 'y' : 'n')).join('')}`,
  );
  let landed;
  // From the child, Shift+Tab goes on from its container (not back into the container).
  await page.locator('[data-testid=awkward-handoff] button').focus();
  await k('Shift+Tab');
  landed = await focusName();
  check(
    `${p} hidden controls: Shift+Tab from the child of the hand-off container goes to the control before it`,
    landed === aw.three,
    `Shift+Tab went to ${landed}, expected ${aw.three}`,
  );
  // A focused control that is disabled: the browser may keep the focus on it, so the check takes it
  // away (blur) and makes sure the focus is on the body before Shift+Tab (followups item 4).
  await page.locator('[role=dialog] button', { hasText: 'Disable me' }).focus();
  await k('Space');
  await page.evaluate(() => document.activeElement?.blur());
  const afterDisable = await focusName();
  await k('Shift+Tab');
  landed = await focusName();
  check(
    `${p} Shift+Tab with the focus on the body after the focused button was disabled goes to its previous neighbour`,
    afterDisable === 'BODY' && landed === aw.name,
    `after Space and blur the focus was on ${afterDisable} (expected BODY); Shift+Tab went to ${landed}, expected ${aw.name}`,
  );
  await page.locator('[role=dialog] button', { hasText: 'Remove me' }).focus();
  await k('Space');
  const afterRemove = await focusName();
  await k('Tab');
  landed = await focusName();
  check(
    `${p} Tab after the focused button was removed goes to its next neighbour`,
    landed === aw.three,
    `after Space the focus was on ${afterRemove}; Tab went to ${landed}, expected ${aw.three}`,
  );
  // A Tab that an input method is composing with belongs to it (synthetic keydown: a real IME
  // cannot be driven headless). The same synthetic Tab without isComposing must be taken.
  await page.locator('[data-testid=awkward-body] input:not([aria-label])').focus();
  const synthetic = async (isComposing) =>
    page.evaluate((composing) => {
      const target = document.activeElement;
      const event = new window.KeyboardEvent('keydown', {
        key: 'Tab',
        code: 'Tab',
        isComposing: composing,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return { cancelled: event.defaultPrevented, focus: window.__e68name(document.activeElement) };
    }, isComposing);
  const ime = await synthetic(true);
  check(
    `${p} a Tab while an input method composes is left to it`,
    !ime.cancelled && ime.focus === aw.name,
    `cancelled=${ime.cancelled}, focus on ${ime.focus}`,
  );
  const plain = await synthetic(false);
  check(
    `${p} the same synthetic Tab without composition is taken by the dialog`,
    plain.cancelled && plain.focus === aw.three,
    `cancelled=${plain.cancelled}, focus on ${plain.focus}, expected ${aw.three}`,
  );
  await k('Escape');
  const layers = () => page.locator('[aria-modal=true]').count();
  check(
    `${p} hidden controls: Escape closes the dialog`,
    (await layers()) === 0,
    `${await layers()} modal layers open`,
  );

  // Focus moved outside after the focused control was disabled (followups item 2): the dialog gives
  // it back to that control, which refuses it, so it must go on to the next neighbour.
  await page.locator('[data-testid=open-awkward]').click();
  await page.waitForSelector('[data-testid=awkward-body]', { timeout: 5000 });
  await page.locator('[role=dialog] button', { hasText: 'Disable me' }).focus();
  await k('Space');
  await page.evaluate(() => document.querySelector('[data-testid=open-modal]').focus());
  landed = await focusName();
  check(
    `${p} focus moved outside after the focused button was disabled comes back to its next neighbour`,
    landed === aw.remove,
    `focus on ${landed}, expected ${aw.remove}`,
  );
  // Keys pressed with the focus on the body (followups item 3): access keys, Enter and Escape still
  // reach the top-most modal dialog.
  await page.evaluate(() => document.activeElement?.blur());
  const onBody = await focusName();
  await k('r');
  const removeLeft = await page.locator('[role=dialog] button', { hasText: 'Remove me' }).count();
  check(
    `${p} with the focus on the body the access key R presses 'Remove me'`,
    onBody === 'BODY' && removeLeft === 0,
    `focus was on ${onBody}; ${removeLeft} 'Remove me' buttons left`,
  );
  await page.evaluate(() => document.activeElement?.blur());
  const onBody2 = await focusName();
  await k('Enter');
  check(
    `${p} with the focus on the body Enter presses the default button (OK)`,
    onBody2 === 'BODY' && (await layers()) === 0,
    `focus was on ${onBody2}; ${await layers()} modal layers open`,
  );
  // If Enter on the body failed, close the dialog the ordinary way so the next check still runs.
  if ((await layers()) > 0) await page.locator('[aria-modal=true] button', { hasText: /^Cancel$/ }).click();
  await page.locator('[data-testid=open-awkward]').click();
  await page.waitForSelector('[data-testid=awkward-body]', { timeout: 5000 });
  await page.evaluate(() => document.activeElement?.blur());
  const onBody3 = await focusName();
  await k('Escape');
  check(
    `${p} with the focus on the body Escape cancels the dialog`,
    onBody3 === 'BODY' && (await layers()) === 0,
    `focus was on ${onBody3}; ${await layers()} modal layers open`,
  );
  if ((await layers()) > 0) await page.locator('[aria-modal=true] button', { hasText: /^Cancel$/ }).click();

  // The owner's key handler (Dialog onKeyDown, errata W2 entry 18): it sees F1 inside the box and on
  // the body, and a key it cancels is not acted on by the dialog.
  await page.locator('[data-testid=open-awkward]').click();
  await page.waitForSelector('[data-testid=awkward-body]', { timeout: 5000 });
  await page.locator('[data-testid=awkward-body] input:not([aria-label])').focus();
  await k('F1');
  check(
    `${p} the dialog's owner receives F1 pressed inside the dialog`,
    (await output(page)).includes('Hidden controls: F1 inside'),
    await output(page),
  );
  await page.evaluate(() => document.activeElement?.blur());
  const onBody4 = await focusName();
  await k('F1');
  check(
    `${p} the dialog's owner receives F1 pressed with the focus on the body`,
    onBody4 === 'BODY' && (await output(page)).includes('Hidden controls: F1 on the body'),
    `focus was on ${onBody4}; ${await output(page)}`,
  );
  await page.evaluate(() => document.activeElement?.blur());
  await k('t');
  const afterT = await focusName();
  check(
    `${p} a key the owner cancels (T on the body) is not taken by the dialog as an access key`,
    afterT === 'BODY' && (await output(page)).includes('Hidden controls: T taken by the owner'),
    `focus on ${afterT}; ${await output(page)}`,
  );
  await k('Escape');
  if ((await layers()) > 0) await page.locator('[aria-modal=true] button', { hasText: /^Cancel$/ }).click();

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
    `${a?.value} @${a?.selStart} (Home must put the caret at 0)`,
  );
  await k('End');
  const beforeEnd = await beeps();
  await k('1');
  a = await active(page);
  check(
    `${p} a key at the end of the field is refused`,
    a?.value === '00000000' && (await beeps()) === beforeEnd + 1,
    `${a?.value} @${a?.selStart}`,
  );
  // Home and End are the field's own on every system (errata W2 entry 12), with Shift too.
  const selection = () =>
    d0.evaluate((el) => `${el.value} [${el.selectionStart},${el.selectionEnd}] ${el.selectionDirection}`);
  await d0.evaluate((el) => el.setSelectionRange(3, 3));
  await k('Shift+Home');
  let sel = await selection();
  check(`${p} Shift+Home selects from the caret to the start`, sel === '00000000 [0,3] backward', sel);
  await k('Shift+End');
  sel = await selection();
  check(`${p} Shift+End then selects from the same anchor to the end`, sel === '00000000 [3,8] forward', sel);
  await k('Home');
  sel = await selection();
  check(`${p} Home drops the selection, caret at the start`, sel.startsWith('00000000 [0,0]'), sel);
  if (process.platform === 'darwin') {
    // The Mac's own keys stay the browser's: Cmd+Right / Cmd+Left go to the ends of the field.
    await d0.evaluate((el) => el.setSelectionRange(3, 3));
    await k('Meta+ArrowRight');
    sel = await selection();
    check(`${p} macOS: Cmd+Right moves the caret to the end`, sel.startsWith('00000000 [8,8]'), sel);
    await k('Meta+ArrowLeft');
    sel = await selection();
    check(`${p} macOS: Cmd+Left moves the caret to the start`, sel.startsWith('00000000 [0,0]'), sel);
  }

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

  // TextArea (errata W2 entry 24): the frame draws the focus ring, Enter adds a line, long lines
  // do not wrap (the box scrolls sideways), the label names the box.
  const area = page.locator('[data-testid=textarea-sample] textarea').first();
  await area.scrollIntoViewIfNeeded();
  await area.focus();
  // The caret goes to the end by script: the key for that differs between the systems' text boxes.
  await area.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await k('Enter');
  await page.keyboard.type('X');
  const areaState = await area.evaluate((el) => {
    const frame = el.closest('.e68-textarea');
    const style = window.getComputedStyle(frame);
    return {
      lastLine: el.value.split('\n').at(-1),
      lines: el.value.split('\n').length,
      ring: style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2,
      noWrap: el.scrollWidth > el.clientWidth + 1,
      scrollsDown: el.scrollHeight > el.clientHeight + 1,
      name: el.labels?.[0]?.querySelector('.e68-field-label__text')?.textContent ?? '',
      height: Math.round(frame.getBoundingClientRect().height),
    };
  });
  check(
    `${p} text area: focus ring on its frame, Enter adds a line, no wrapping, scrolls, labelled`,
    areaState.lastLine === 'X' &&
      areaState.lines === 15 &&
      areaState.ring &&
      areaState.noWrap &&
      areaState.scrollsDown &&
      areaState.name === 'Template:' &&
      areaState.height === 132,
    JSON.stringify(areaState),
  );

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

  // A grid with a set height scrolls itself (it holds the focus; U3's request), keeps its header
  // row at the top and shows the selected row below the header, never under it.
  const tall = page.locator('#lists .e68-gallery__scroll-grid');
  await tall.scrollIntoViewIfNeeded();
  await tall.focus();
  const gridView = () =>
    tall.evaluate((el) => {
      const head = el.querySelector('.e68-grid__head').getBoundingClientRect();
      const row = el.querySelector('[role=row][aria-selected=true]')?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const body = el.querySelector('.e68-grid__body');
      return {
        scrollTop: Math.round(el.scrollTop),
        scrolls: el.scrollHeight > el.clientHeight,
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        headAtTop: Math.abs(head.top - box.top) <= 2,
        rowBelowHead: row ? row.top >= head.bottom - 1 && row.bottom <= box.bottom + 1 : false,
        selected: el.querySelector('[role=row][aria-selected=true]')?.getAttribute('data-row'),
      };
    });
  await k('Control+End');
  const atEnd = await gridView();
  check(
    `${p} tall grid: Ctrl+End scrolls the grid itself to row 49; header stays at the top`,
    atEnd.selected === '48' &&
      atEnd.scrolls &&
      !atEnd.bodyScrolls &&
      atEnd.scrollTop > 0 &&
      atEnd.headAtTop &&
      atEnd.rowBelowHead,
    JSON.stringify(atEnd),
  );
  await k('Control+Home');
  await k('PageDown');
  await k('PageDown');
  await k('PageUp');
  const paged = await gridView();
  check(
    `${p} tall grid: Page Down, Page Down, Page Up leaves the selected row below the header`,
    paged.selected === '6' && paged.headAtTop && paged.rowBelowHead,
    JSON.stringify(paged),
  );

  // Tree view keys (treeViewKeyAction, drawn by the gallery as a caller would).
  const tree = page.locator('[data-testid=tree-sample]');
  const treeFocus = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el?.getAttribute('role') === 'treeitem'
        ? `${el.textContent.replace(/[▸▾]/g, '').trim()} ${el.getAttribute('aria-expanded') ?? '-'}`
        : `not a tree item: ${el?.tagName}`;
    });
  await tree.locator('[role=treeitem][tabindex="0"]').focus();
  const treeSteps = [];
  for (const key of [
    'ArrowDown',
    'ArrowDown',
    'ArrowRight',
    'ArrowRight',
    'ArrowLeft',
    'ArrowLeft',
    'End',
    'ArrowLeft',
  ]) {
    await k(key);
    treeSteps.push(await treeFocus());
  }
  const treeWant = [
    'demo.X68 -',
    'macros false',
    'macros true',
    'io.X68 -',
    'macros true',
    'macros false',
    'Examples false',
    'Examples false',
  ];
  check(
    `${p} tree: Down, Right opens and enters, Left goes up and closes, End`,
    JSON.stringify(treeSteps) === JSON.stringify(treeWant),
    `expected ${treeWant.join(' > ')}; got ${treeSteps.join(' > ')}`,
  );
  await k('Home');
  await k('ArrowDown');
  await k('Enter');
  check(`${p} tree: Enter on a leaf activates it`, (await output(page)).includes('Tree: open My Programs/demo.X68'));
  check(
    `${p} tree: one tab stop`,
    (await tree.locator('[role=treeitem][tabindex="0"]').count()) === 1,
    `${await tree.locator('[role=treeitem][tabindex="0"]').count()}`,
  );

  // A click into an auto-selecting masked field puts the caret where the click is and selects
  // nothing, as the VCL does (TCustomEdit.DoEnter skips SelectAll while the left button is down);
  // the focus from the keyboard still selects everything (checked above).
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  const d1 = page.locator('[data-testid=reg-d0]');
  await d1.scrollIntoViewIfNeeded();
  const d1box = await d1.boundingBox();
  if (d1box) await page.mouse.click(d1box.x + d1box.width / 2, d1box.y + d1box.height / 2);
  a = await active(page);
  check(
    `${p} register field: a mouse click does not select the text (caret only)`,
    a?.testid === 'reg-d0' && a.selStart === a.selEnd,
    `${a?.testid} ${a?.selStart}-${a?.selEnd}`,
  );

  // The drawn box of a check box lets the pointer through to the input (SH7's note): a test tool's
  // check() on the input itself works.
  const firstBox = page.locator('#choices input[type=checkbox]:not(:disabled)').first();
  const wasChecked = await firstBox.isChecked();
  let boxError = '';
  try {
    if (wasChecked) await firstBox.uncheck({ timeout: 5000 });
    else await firstBox.check({ timeout: 5000 });
  } catch (error) {
    boxError = String(error).split('\n')[0];
  }
  check(
    `${p} a check box's input takes a click on its own position (Playwright check())`,
    boxError === '' && (await firstBox.isChecked()) !== wasChecked,
    boxError || `checked ${wasChecked} -> ${await firstBox.isChecked()}`,
  );

  // Toast.
  await page.locator('[data-testid=show-toast]').click();
  const toast = await page.locator('.e68-toasts:not(.e68-toasts--inline) .e68-toast').count();
  check(`${p} a toast appears in the live region`, toast === 1, `${toast}`);

  // A long action caption ('Open the containing folder...', FS2's note) goes on a line of its own
  // and overlaps neither the text nor the close button; a short one stays on the text's line.
  const toastBoxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.e68-toasts--inline .e68-toast')).map((toast) => {
      const rect = (sel) => {
        const r = toast.querySelector(sel)?.getBoundingClientRect();
        return r ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null;
      };
      return {
        layout: toast.getAttribute('data-layout'),
        toast: toast.getBoundingClientRect().toJSON(),
        text: rect('.e68-toast__text'),
        action: rect('.e68-toast__action'),
        caption: rect('.e68-toast__action .e68-button__caption'),
        close: rect('.e68-toast__close'),
      };
    }),
  );
  const overlaps = (a, b) => a && b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  const withAction = toastBoxes.filter((t) => t.action);
  const bad = withAction.filter(
    (t) =>
      overlaps(t.action, t.text) ||
      overlaps(t.action, t.close) ||
      t.caption.l < t.action.l - 0.5 ||
      t.caption.r > t.action.r + 0.5 ||
      t.action.r > t.toast.right + 0.5,
  );
  const long = withAction.find((t) => t.layout === 'stacked');
  check(
    `${p} toasts: an action never overlaps the text or the close button, and its caption fits its button`,
    withAction.length >= 2 && bad.length === 0,
    JSON.stringify(bad.length ? bad : withAction.map((t) => t.layout)),
  );
  check(
    `${p} toasts: the long action 'Open the containing folder...' sits under the text, at the right`,
    Boolean(long) && long.action.t >= long.text.b - 0.5 && withAction.some((t) => t.layout === 'inline'),
    JSON.stringify(long ?? withAction),
  );

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// --- run ------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // Port 0: the system picks a free port (many checks run at once on one machine).
    server: { port: 0, strictPort: true, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  pageUrl = `http://127.0.0.1:${port}/src/ui/components/gallery/gallery.html`;
  console.log(`Gallery: ${pageUrl}\nScreenshots: ${outDir}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch({ timeout: 120_000 });
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
