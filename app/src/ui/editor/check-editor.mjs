// Browser check of the editor component (ARCHITECTURE.md 9.2, E2 acceptance). Owner: E2.
//
//   node app/src/ui/editor/check-editor.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright), with the Windows key map. It checks what unit tests under Node
// cannot show, with real key events going through the application's dispatcher into CodeMirror:
//
//   - the editor area, tab strip and status bar are drawn; `line: column`, `Insert`, the info panel;
//   - Tab with Real Tabs off (Fixed and Assembly stops, note 12), tab characters drawn at columns
//     12, 20 and 44 (measured on screen against blanks), the true visual column in the status bar;
//   - Auto Indent, Insert/Replace (key and status-bar click), Comment / Uncomment / Indent /
//     Outdent from their chords, Undo / Redo (Ctrl+Z in the editor, Ctrl+Alt+Z as a command);
//   - pasted rich text arrives as plain text; Paste from the toolbar and the context menu reads the
//     clipboard (note 45) and, where the browser refuses, shows `Press Ctrl+V to paste`;
//   - the context menu of editor-ui §4.1; two-pane layouts (Tile Horizontally / Vertically,
//     Cascade); Modified dot; marks on characters Windows-1252 lacks; inline assembler markers;
//   - an accessibility scan (axe-core) of the editor area in both themes; no console errors.
//
// Screenshots go to build/E2/editor-check (git-ignored) unless --out says otherwise. Exit code
// 0 = everything passed. The page object `window.__easy68k` and the view hook `e68View` on the
// view's element exist in development builds only.

/* global console, process, document, window, navigator, DataTransfer, ClipboardEvent, Navigator -- browser globals are used inside page.evaluate() callbacks */

import { mkdirSync } from 'node:fs';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'E2', 'editor-check')));
if (!outDir.startsWith(join(repoRoot, 'build'))) {
  console.error('--out must be a folder below build/');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- helpers --------------------------------------------------------------------------

function pretendWindows() {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function openApp(browser, { permissions = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendWindows);
  if (permissions.length) await context.grantPermissions(permissions, { origin: baseUrl });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  // The development server compiles modules on first request, and fifteen packages load this
  // machine: allow the page two minutes to come up, and navigate once more if it did not.
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

const PAGE_READY_MS = 120_000;

/**
 * Replaces the text of the shown document (pane `pane`) and puts the caret at `caret` (or the end).
 * Then waits longer than the history's grouping delay (500 ms), so that what is typed next is an
 * undo step of its own.
 */
async function setText(page, text, caret = null, pane = 0) {
  await page.evaluate(
    ({ text, caret, pane }) => {
      const host = document.querySelector(`.e68-editor__pane[data-pane="${pane}"] [data-e68-document]`);
      const view = host.e68View;
      const at = caret ?? text.length;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: at } });
      view.focus();
    },
    { text, caret, pane },
  );
  await page.waitForTimeout(600);
}

function select(page, anchor, head) {
  return page.evaluate(
    ({ anchor, head }) => {
      const view = document.querySelector('[data-e68-document]').e68View;
      view.dispatch({ selection: { anchor, head } });
      view.focus();
    },
    { anchor, head },
  );
}

const docText = (page, pane = 0) =>
  page.evaluate(
    (pane) =>
      document.querySelector(`.e68-editor__pane[data-pane="${pane}"] [data-e68-document]`).e68View.state.doc.toString(),
    pane,
  );

/** The texts of the status bar of pane 0. */
const status = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.e68-editor__pane[data-pane="0"] .e68-editor__cell')].map(
      (cell) => cell.textContent,
    ),
  );

/** x of the character at `pos` (CodeMirror's own measurement). */
const xAt = (page, pos) =>
  page.evaluate((pos) => document.querySelector('[data-e68-document]').e68View.coordsAtPos(pos)?.left ?? NaN, pos);

const updateSettings = (page, editorPatch) =>
  page.evaluate(
    (patch) => window.__easy68k.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, ...patch } })),
    editorPatch,
  );

/** Changes the tab model of the documents: through the document service when it has `update` (E1). */
const setDocument = (page, patch) =>
  page.evaluate((patch) => {
    const ctx = window.__easy68k.ctx;
    if (typeof ctx.documents.update === 'function') {
      for (const doc of ctx.documents.list()) ctx.documents.update(doc.id, patch);
      return;
    }
    ctx.store.setState((s) => ({
      ...s,
      documents: { ...s.documents, items: s.documents.items.map((d) => ({ ...d, ...patch })) },
    }));
  }, patch);

async function shot(page, name) {
  await page.screenshot({ path: join(outDir, `${name}.png`) });
}

async function scan(page, label) {
  const result = await new AxeBuilder({ page })
    .include('.e68-editor')
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

async function editingPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);

  // Structure.
  const tabs = await page.locator('.e68-editor [role=tab]').allInnerTexts();
  check(
    `${p} the tab strip shows the document`,
    tabs.length === 1 && tabs[0].includes('untitled1.x68'),
    JSON.stringify(tabs),
  );
  await page.locator('.e68-editor .cm-content').click();
  await page.keyboard.press('Control+Home');
  const start = await status(page);
  check(
    `${p} status bar: 1: 1, empty, Insert, empty, info`,
    JSON.stringify(start) === JSON.stringify(['1: 1', '', 'Insert', '', 'Windows-1252  CR LF  Fixed tabs 4']),
    JSON.stringify(start),
  );
  await shot(page, `${name}-start`);

  // Tab, Fixed tabs, size 4 (20.3).
  const fixed = [];
  for (const column of [0, 1, 3, 4]) {
    await setText(page, 'x'.repeat(column));
    await page.keyboard.press('Tab');
    fixed.push((await docText(page)).length - column);
  }
  check(
    `${p} Fixed 4: Tab at columns 0, 1, 3, 4 inserts 4, 3, 1, 4 spaces`,
    JSON.stringify(fixed) === '[4,3,1,4]',
    JSON.stringify(fixed),
  );
  check(`${p} Tab stores no tab character`, !(await docText(page)).includes('\t'));
  check(
    `${p} the focus stays in the editor after Tab`,
    await page.evaluate(() => document.activeElement?.classList.contains('cm-content')),
  );

  // Assembly tabs: a typing session lands on 12, 20, 44; Tab at 12 goes on to 20 (note 12).
  await setDocument(page, { tabType: 0 });
  await page.waitForFunction(() =>
    document.querySelector('.e68-editor__cell--info')?.textContent?.includes('Assembly tabs'),
  );
  await setText(page, '');
  await page.keyboard.type('START:');
  await page.keyboard.press('Tab');
  await page.keyboard.type('MOVE.B');
  await page.keyboard.press('Tab');
  await page.keyboard.type('#14,D0');
  await page.keyboard.press('Tab');
  await page.keyboard.type('* comment');
  const typed = await docText(page);
  check(
    `${p} Assembly tabs: label 0, opcode 12, operand 20, comment 44`,
    typed.indexOf('MOVE.B') === 12 && typed.indexOf('#14') === 20 && typed.indexOf('*') === 44,
    JSON.stringify(typed),
  );
  const assembly = [];
  for (const column of [0, 5, 12, 13, 20, 21, 44]) {
    await setText(page, 'x'.repeat(column));
    await page.keyboard.press('Tab');
    assembly.push((await docText(page)).length - column);
  }
  check(
    `${p} Assembly: Tab at 0, 5, 12, 13, 20, 21, 44 inserts 12, 7, 8, 7, 24, 23, 4`,
    JSON.stringify(assembly) === '[12,7,8,7,24,23,4]',
    JSON.stringify(assembly),
  );
  await setText(page, '        |', 8);
  await page.keyboard.press('Shift+Tab');
  check(
    `${p} Shift+Tab deletes the blanks back to the previous stop`,
    (await docText(page)) === '|',
    JSON.stringify(await docText(page)),
  );

  // Real Tabs on: a tab character, drawn to columns 12, 20, 44.
  await updateSettings(page, { realTabs: true });
  await setText(page, '');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('X');
  check(
    `${p} Real Tabs on: Tab stores tab characters`,
    (await docText(page)) === '\t\t\tX',
    JSON.stringify(await docText(page)),
  );
  check(
    `${p} status bar: true visual column after three tabs and X is 46`,
    (await status(page))[0] === '1: 46',
    (await status(page))[0],
  );
  const lines = [
    '\tA',
    '\t\tB',
    '\t\t\tC',
    'START:\tMOVE\tD0\tcomment',
    `${' '.repeat(12)}A`,
    `${' '.repeat(20)}B`,
    `${' '.repeat(44)}C`,
  ];
  await setText(page, lines.join('\n'), 0);
  const offsets = [];
  let pos = 0;
  for (const line of lines) {
    offsets.push(pos);
    pos += line.length + 1;
  }
  const lineStart = await xAt(page, 0);
  const col = async (line, index) => (await xAt(page, offsets[line] + index)) - lineStart;
  const ref12 = await col(4, 12);
  const ref20 = await col(5, 20);
  const ref44 = await col(6, 44);
  const near = (a, b) => Math.abs(a - b) <= 1;
  check(
    `${p} tab characters are drawn at columns 12, 20, 44`,
    near(await col(0, 1), ref12) && near(await col(1, 2), ref20) && near(await col(2, 3), ref44),
    JSON.stringify([await col(0, 1), ref12, await col(1, 2), ref20, await col(2, 3), ref44]),
  );
  check(
    `${p} after a label the tabs reach 12, 20 and 44`,
    near(await col(3, 7), ref12) && near(await col(3, 12), ref20) && near(await col(3, 15), ref44),
    JSON.stringify([await col(3, 7), await col(3, 12), await col(3, 15)]),
  );
  await shot(page, `${name}-assembly-tabs`);
  await updateSettings(page, { realTabs: false });
  await setDocument(page, { tabType: 1 });

  // Auto Indent (20.3).
  await setText(page, '    NOP');
  await page.keyboard.press('Enter');
  check(
    `${p} Auto Indent: Enter at the end keeps the four blanks`,
    (await docText(page)) === '    NOP\n    ',
    JSON.stringify(await docText(page)),
  );
  check(`${p} status bar after it: 2: 5`, (await status(page))[0] === '2: 5', (await status(page))[0]);
  await setText(page, '    MOVE D0,D1', 8);
  await page.keyboard.press('Enter');
  check(
    `${p} Enter in the middle adds no white space`,
    (await docText(page)) === '    MOVE\n D0,D1',
    JSON.stringify(await docText(page)),
  );
  await updateSettings(page, { autoIndent: false });
  await setText(page, '    NOP');
  await page.keyboard.press('Enter');
  check(
    `${p} Auto Indent off: no white space`,
    (await docText(page)) === '    NOP\n',
    JSON.stringify(await docText(page)),
  );
  await updateSettings(page, { autoIndent: true });
  // Enter with any modifiers gets the same treatment (editor-ui §5.2 rule 11).
  for (const chord of ['Control+Enter', 'Alt+Enter', 'Shift+Enter', 'Control+Alt+Enter']) {
    await setText(page, '    NOP');
    await page.keyboard.press(chord);
    check(
      `${p} ${chord} inserts a line break with the auto indent`,
      (await docText(page)) === '    NOP\n    ',
      JSON.stringify(await docText(page)),
    );
  }

  // Status bar position with a selection: the END of the selection, made either way (§7.2).
  await setText(page, 'abcdef', 4);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  check(
    `${p} a selection made backwards shows the end of the selection: 1: 5`,
    (await status(page))[0] === '1: 5',
    (await status(page))[0],
  );
  await setText(page, 'abcdef');
  await page.keyboard.press('Shift+Home');
  check(
    `${p} Shift+Home from the end of a line shows the end of the selection: 1: 7`,
    (await status(page))[0] === '1: 7',
    (await status(page))[0],
  );

  // Ctrl+X and Ctrl+C without a selection do nothing; with one they cut and copy it (§8.7).
  await page.evaluate(() => {
    window.__e68Clip = [];
    // Bubble phase on window: runs after CodeMirror's own handler on the content element.
    for (const type of ['cut', 'copy']) {
      window.addEventListener(type, (event) =>
        window.__e68Clip.push(`${type}:${event.clipboardData?.getData('text/plain') ?? ''}`),
      );
    }
  });
  const clipLog = () => page.evaluate(() => window.__e68Clip.splice(0));
  await setText(page, 'line1\nline2\nline3', 8);
  await page.keyboard.press('Control+x');
  await page.keyboard.press('Control+c');
  const emptyLog = await clipLog();
  check(
    `${p} Ctrl+X and Ctrl+C with no selection change neither the text nor the clipboard`,
    (await docText(page)) === 'line1\nline2\nline3' && emptyLog.every((entry) => /^(cut|copy):$/.test(entry)),
    `${JSON.stringify(await docText(page))} ${JSON.stringify(emptyLog)}`,
  );
  await select(page, 6, 11);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+x');
  const selLog = await clipLog();
  check(
    `${p} Ctrl+C and Ctrl+X with a selection copy and cut it`,
    (await docText(page)) === 'line1\n\nline3' && JSON.stringify(selLog) === '["copy:line2","cut:line2"]',
    `${JSON.stringify(await docText(page))} ${JSON.stringify(selLog)}`,
  );

  // Insert / Replace.
  await setText(page, 'abc', 1);
  await page.keyboard.press('Insert');
  check(
    `${p} Insert switches the status bar to Replace`,
    (await status(page))[2] === 'Replace',
    (await status(page))[2],
  );
  await page.keyboard.type('X');
  check(`${p} Replace mode overwrites`, (await docText(page)) === 'aXc', JSON.stringify(await docText(page)));
  await page.keyboard.press('Control+z');
  check(`${p} overwrite typing is undoable`, (await docText(page)) === 'abc', JSON.stringify(await docText(page)));
  await page.locator('.e68-editor__cell--insert').click();
  check(
    `${p} a click on the status-bar cell switches back to Insert`,
    (await status(page))[2] === 'Insert',
    (await status(page))[2],
  );
  check(
    `${p} the click leaves the focus in the editor`,
    await page.evaluate(() => document.activeElement?.classList.contains('cm-content')),
  );

  // Comment, Uncomment, Indent, Outdent, Undo, Redo through their chords.
  await setText(page, 'A\nB\nC');
  await select(page, 0, 5);
  await page.keyboard.press('Control+Alt+c');
  check(
    `${p} Ctrl+Alt+C comments the three lines`,
    (await docText(page)) === '*A\n*B\n*C',
    JSON.stringify(await docText(page)),
  );
  await page.keyboard.press('Control+z');
  check(
    `${p} Ctrl+Z undoes the comment in one step`,
    (await docText(page)) === 'A\nB\nC',
    JSON.stringify(await docText(page)),
  );
  await page.keyboard.press('Control+Alt+z');
  check(`${p} Ctrl+Alt+Z redoes it`, (await docText(page)) === '*A\n*B\n*C', JSON.stringify(await docText(page)));
  await page.keyboard.press('Control+Alt+u');
  check(`${p} Ctrl+Alt+U uncomments`, (await docText(page)) === 'A\nB\nC', JSON.stringify(await docText(page)));
  await page.keyboard.press('Control+Shift+Period');
  check(
    `${p} Ctrl+Shift+. indents by one blank`,
    (await docText(page)) === ' A\n B\n C',
    JSON.stringify(await docText(page)),
  );
  await page.keyboard.press('Control+Shift+Comma');
  check(
    `${p} Ctrl+Shift+, outdents by one blank`,
    (await docText(page)) === 'A\nB\nC',
    JSON.stringify(await docText(page)),
  );
  await setText(page, 'A\n');
  await page.keyboard.type('xyz');
  await page.keyboard.press('Control+z');
  check(
    `${p} typed characters are one undo step (note 5)`,
    (await docText(page)) === 'A\n',
    JSON.stringify(await docText(page)),
  );

  // Modified.
  check(`${p} status bar shows Modified after edits`, (await status(page))[1] === 'Modified', (await status(page))[1]);
  check(
    `${p} the tab shows the modified dot`,
    (await page.locator('.e68-editor [role=tab] .e68-tabs__dot').count()) === 1,
  );

  // Pasted rich text arrives as plain text (20.3).
  await setText(page, '');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/html', '<b>bold</b>&nbsp;<i>text</i>');
    data.setData('text/plain', 'bold text\r\nline 2');
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector('.cm-content').dispatchEvent(event);
  });
  check(
    `${p} pasted rich text arrives as plain text with LF`,
    (await docText(page)) === 'bold text\nline 2',
    JSON.stringify(await docText(page)),
  );

  // Characters Windows-1252 lacks.
  await setText(page, 'MOVE.B #1,D0 ; a→b é');
  const marks = await page.locator('.e68-not1252').evaluateAll((list) => list.map((m) => [m.textContent, m.title]));
  check(
    `${p} a character without a Windows-1252 byte is marked, with the hover text`,
    marks.length === 1 && marks[0][0] === '→' && marks[0][1] === 'Not in Windows-1252: saved as ?',
    JSON.stringify(marks),
  );

  // Inline markers.
  await setText(page, '    ORG $1000\n    MOVE.B #14,DO\n    SIMHALT', 0);
  await page.evaluate(() =>
    window.__easy68k.ctx.store.setState((s) => ({
      ...s,
      messages: {
        ...s.messages,
        [s.documents.activeId]: [{ file: null, line: 2, text: 'ERROR: Undefined symbol', severity: 'error' }],
      },
    })),
  );
  await page.waitForSelector('.e68-squiggle--error');
  check(
    `${p} an assembler message draws a squiggle and a gutter mark`,
    (await page.locator('.e68-squiggle--error').count()) >= 1 &&
      (await page.locator('.e68-marker--error[title="ERROR: Undefined symbol"]').count()) === 1,
  );
  await select(page, 20, 20);
  const tip = await page
    .locator('.e68-marker-tip')
    .textContent({ timeout: 3000 })
    .catch(() => null);
  check(`${p} the message appears while the caret is on the line`, tip === 'ERROR: Undefined symbol', String(tip));
  await shot(page, `${name}-markers`);
  await page.evaluate(() => window.__easy68k.ctx.store.setState((s) => ({ ...s, messages: {} })));
  await page.waitForFunction(() => document.querySelectorAll('.e68-squiggle').length === 0);
  check(
    `${p} clearing the messages removes the markers`,
    (await page.locator('.e68-marker[title^="ERROR"]').count()) === 0,
  );

  // Context menu (editor-ui §4.1).
  await setText(page, 'context');
  await page.locator('.e68-editor .cm-content').click({ button: 'right' });
  await page.waitForSelector('[role=menu]');
  const items = await page
    .locator('[role=menu] [role=menuitem]')
    .evaluateAll((list) => list.map((item) => item.textContent.replace(/Ctrl\+.*$/, '').trim()));
  check(
    `${p} the context menu lists the nine items of editor-ui §4.1`,
    JSON.stringify(items) ===
      JSON.stringify([
        'Undo',
        'Redo',
        'Cut',
        'Copy',
        'Paste',
        'Select All',
        'Comment Selection',
        'Uncomment Selection',
        'Reload File',
      ]),
    JSON.stringify(items),
  );
  await shot(page, `${name}-context-menu`);
  await page.keyboard.press('Escape');

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function panesPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  // A second document: New of the document service. The wave-0 stub service has only one; then a
  // second one is added to the store (the editor shows it with an empty text).
  const count = await page.evaluate(() => {
    const ctx = window.__easy68k.ctx;
    ctx.documents.newSource();
    return ctx.store.getState().documents.items.length;
  });
  if (count < 2) {
    await page.evaluate(() =>
      window.__easy68k.ctx.store.setState((s) => ({
        ...s,
        documents: {
          items: [
            ...s.documents.items,
            { ...s.documents.items[0], id: 'check-2', name: 'second.X68', path: '/browser/second.X68' },
          ],
          activeId: 'check-2',
        },
      })),
    );
  }
  await page.waitForFunction(() => document.querySelectorAll('.e68-editor [role=tab]').length === 2);
  const run = (id) => page.evaluate((id) => window.__easy68k.ctx.commands.run(id), id);
  const boxes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.e68-editor__pane')].map((pane) => {
        const r = pane.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          editor: !!pane.querySelector('.cm-editor'),
        };
      }),
    );

  await run('ed.window.tileV');
  await page.waitForFunction(() => document.querySelectorAll('.e68-editor__pane').length === 2);
  let b = await boxes();
  check(
    `${p} Tile Vertically: two panes side by side, each with an editor`,
    b.length === 2 && b[0].y === b[1].y && b[1].x > b[0].x + 100 && b[0].editor && b[1].editor,
    JSON.stringify(b),
  );
  await shot(page, `${name}-tile-vertically`);
  await run('ed.window.tileH');
  await page.waitForFunction(() => document.querySelector('.e68-editor')?.getAttribute('data-layout') === 'horizontal');
  b = await boxes();
  check(
    `${p} Tile Horizontally: two panes one above the other`,
    b.length === 2 && b[0].x === b[1].x && b[1].y > b[0].y + 60 && b[0].editor && b[1].editor,
    JSON.stringify(b),
  );
  await shot(page, `${name}-tile-horizontally`);
  await run('ed.window.cascade');
  await page.waitForFunction(() => document.querySelectorAll('.e68-editor__pane').length === 1);
  check(`${p} Cascade: one pane with both tabs`, (await page.locator('.e68-editor [role=tab]').count()) === 2);
  const windowMenuDisabled = await page.evaluate(() => [
    window.__easy68k.ctx.commands.isEnabled('ed.window.arrange'),
    window.__easy68k.ctx.commands.isEnabled('ed.window.minimizeAll'),
  ]);
  check(`${p} Arrange and Minimize All are disabled`, JSON.stringify(windowMenuDisabled) === '[false,false]');
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function pastePass(browser, name) {
  const p = `${name}:`;
  // Granted: Paste from the toolbar and the context menu read the clipboard (note 45).
  if (name === 'chromium') {
    const { context, page, errors } = await openApp(browser, { permissions: ['clipboard-read', 'clipboard-write'] });
    await setText(page, 'A|B', 2);
    await page.evaluate(() => navigator.clipboard.writeText('PASTED\r\nTEXT'));
    await page.getByRole('button', { name: /^Paste/ }).click();
    await page.waitForFunction(() =>
      document.querySelector('[data-e68-document]').e68View.state.doc.toString().includes('PASTED'),
    );
    check(
      `${p} toolbar Paste inserts the clipboard text at the caret, CR LF as LF`,
      (await docText(page)) === 'A|PASTED\nTEXTB',
      JSON.stringify(await docText(page)),
    );
    await page.evaluate(() => navigator.clipboard.writeText('ctx'));
    await page.locator('.e68-editor .cm-content').click({ button: 'right' });
    await page.locator('[role=menu] [role=menuitem]', { hasText: 'Paste' }).click();
    await page.waitForFunction(() =>
      document.querySelector('[data-e68-document]').e68View.state.doc.toString().includes('ctx'),
    );
    check(`${p} context-menu Paste inserts the clipboard text`, (await docText(page)).includes('ctx'));
    // Copy from the toolbar puts the selection on the clipboard.
    await setText(page, 'copy me');
    await select(page, 0, 4);
    await page.getByRole('button', { name: /^Copy/ }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check(`${p} toolbar Copy copies the selection`, copied === 'copy', JSON.stringify(copied));
    check(`${p} no console or page errors (granted)`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
  // Refused (no permission in Chromium; WebKit without a person to press its Paste callout).
  {
    const { context, page, errors } = await openApp(browser);
    await setText(page, 'AB', 1);
    await page.getByRole('button', { name: /^Paste/ }).click();
    const toast = await page
      .getByText('Press Ctrl+V to paste')
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
    const text = await docText(page);
    check(
      `${p} refused clipboard: the toast says Press Ctrl+V to paste and nothing is inserted`,
      toast && text === 'AB',
      `toast=${toast} text=${JSON.stringify(text)}`,
    );
    await shot(page, `${name}-paste-refused`);
    // The keyboard chord still pastes through the browser's own event (simulated here, as above).
    check(
      `${p} no console or page errors (refused)`,
      errors.filter((e) => !/clipboard|NotAllowed|permission/i.test(e)).length === 0,
      errors.slice(0, 3).join(' | '),
    );
    await context.close();
  }
}

async function themePass(browser, name) {
  for (const themeName of ['light', 'dark']) {
    const { context, page, errors } = await openApp(browser);
    await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), themeName);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, themeName);
    await setText(page, '*  Title : demo\nSTART:  ORG     $1000\n\tMOVE.B\t#14,D0\t; tab\n    SIMHALT →', 20);
    await scan(page, `${name} ${themeName} editor area`);
    await shot(page, `${name}-${themeName}`);
    check(`${name}: ${themeName}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
}

// --- run -------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No file watching and no hot reload: other packages edit files while this runs, and a reload
    // in the middle of a check would destroy the page under it.
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
      // Each pass opens its own page; one that stops early is reported and the others still run,
      // so the number of checks printed is the same on every run that does not crash.
      const passes = [
        ['editing', editingPass],
        ['panes', panesPass],
        ['paste from the menu', pastePass],
        ['themes and accessibility', themePass],
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
