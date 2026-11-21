// Browser check of EASyBIN mode (ARCHITECTURE.md 9.4, B1 acceptance). Owner: B1.
//
//   node app/src/features/easybin/check-easybin.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright). It checks what unit tests under Node cannot show:
//
//   - EASyBIN mode starts without console errors; menus, captions and fields of the original are on
//     screen; the status bar shows the title;
//   - Open S-Record through the menu shortcut and the real file dialog (FS1), the loader's message box,
//     the fields; Save S-Record and Save Binary (4 files) through the real dialogs, the bytes written;
//   - Copy, Fill, the Address field, Row/Page buttons, the arrow keys and typing into the rows;
//   - a file dropped on the window; the About box; Help;
//   - editing anywhere in 16 MB stays responsive: key-down to the next painted frame, measured at three
//     addresses in at least three runs (up to six while none meets the limits), best run counts; a
//     Fill of all 16 MB;
//   - an accessibility scan (axe-core, WCAG 2.0/2.1 A and AA) in both themes;
//   - screenshots of both themes in the output folder (default build/B1/check).
//
// Exit code 0 = everything passed. It lives here because tests/e2e belongs to X1; the integration gate
// adds it to the CI job `browser-checks` (docs/requests/B1-browser-check.md).

/* global console, process, document, window, performance, requestAnimationFrame, setTimeout, MutationObserver, DataTransfer, File, DragEvent */

import { readFileSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');
const fixtures = resolve(appRoot, 'src/core/easybin/fixtures');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'B1', 'check')));
mkdirSync(outDir, { recursive: true });
const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
if (!browsers.every((name) => name in BROWSERS)) {
  console.error(`--browser must be chromium, webkit or all, not ${browserChoice}`);
  process.exit(2);
}

// CI runners (Ubuntu, macOS, Windows) are slower than a desktop, and the first page load makes Vite
// transform the whole application: generous limits for loading, short polls instead of fixed waits.
const LOAD_TIMEOUT = 120_000;
const WAIT = 15_000;

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** The bytes the original writes for the hello program (fixtures/assembler.expected, rt-hello.S68). */
function expectedHelloSave() {
  const line = readFileSync(join(fixtures, 'assembler.expected'), 'latin1')
    .split(/\r?\n/)
    .find((l) => l.startsWith('written rt-hello.S68 '));
  return line.split(' ')[4];
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function openApp(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(baseUrl, { timeout: LOAD_TIMEOUT });
    await page.waitForSelector('.e68-shell', { timeout: LOAD_TIMEOUT });
    await page.waitForFunction(() => window.__easy68k !== undefined, null, { timeout: LOAD_TIMEOUT });
    await page.evaluate((t) => window.__easy68k.ctx.commands.run('app.theme.set', t), theme);
    await page.locator('.e68-modeswitch [data-mode="easybin"]').click({ timeout: WAIT });
    await page.waitForSelector('.e68-easybin__rows', { timeout: LOAD_TIMEOUT });
  } catch (error) {
    await page.screenshot({ path: join(outDir, `${browser.browserType().name()}-${theme}-start-failure.png`) });
    await context.close();
    throw new Error(`EASyBIN mode did not start: ${String(error).split('\n')[0]}; page errors: ${errors.join(' | ')}`, {
      cause: error,
    });
  }
  return { context, page, errors };
}

/** The EASyBIN model of the page (the same module instance the application uses). */
const modelState = (page) =>
  page.evaluate(async () => {
    const { easybinOf } = await import('/src/features/easybin/session.ts');
    const { model } = easybinOf(window.__easy68k.ctx);
    return { ...model.getState() };
  });
const memory = (page, address, count) =>
  page.evaluate(
    async ([a, n]) => {
      const { easybinOf } = await import('/src/features/easybin/session.ts');
      return Array.from(easybinOf(window.__easy68k.ctx).model.memory.subarray(a, a + n));
    },
    [address, count],
  );
const writeStore = (page, path, bytes) =>
  page.evaluate(([p, b]) => window.__easy68k.ctx.vfs.writeFile(p, new Uint8Array(b)), [path, Array.from(bytes)]);
const readStore = (page, path) =>
  page.evaluate(async (p) => {
    try {
      return Array.from(await window.__easy68k.ctx.vfs.readFile(p));
    } catch {
      return null;
    }
  }, path);
/** Waits until the store holds `path` (a save writes asynchronously after its dialog closes). */
const waitForStore = (page, path) =>
  page
    .waitForFunction(
      async (p) => {
        try {
          await window.__easy68k.ctx.vfs.readFile(p);
          return true;
        } catch {
          return false;
        }
      },
      path,
      { timeout: WAIT, polling: 50 },
    )
    .catch(() => {}); // the check that reads the file reports what is missing

/** The message box on top: its text, then presses `button`. */
async function answerBox(page, button) {
  const box = page.getByRole('alertdialog').last();
  await box.waitFor({ timeout: WAIT });
  const text = await box
    .locator('.e68-messagebox__text')
    .first()
    .innerText()
    .catch(() => '');
  await box.getByRole('button', { name: button, exact: true }).click();
  return text;
}

/** The FS1 file dialog: types a name relative to the folder it shows and presses the button. */
async function fileDialog(page, name, button) {
  const dialog = page.getByRole('dialog').last();
  await dialog.waitFor({ timeout: WAIT });
  await dialog.getByLabel('File name:').fill(name);
  await dialog.getByRole('button', { name: button, exact: true }).click();
}

const field = (page, label) => page.getByLabel(label, { exact: true });
async function setField(page, label, digits) {
  const input = field(page, label);
  await input.click();
  await input.press('Home');
  await input.pressSequentially(digits);
}

async function scan(page, label) {
  const result = await new AxeBuilder({ page })
    .include('.e68-shell')
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

// --- the passes --------------------------------------------------------------------------------

async function functionalPass(browser, name, theme) {
  const { page } = await openApp(browser, theme).then((opened) => (current = opened));
  try {
    await functionalSteps(name, theme);
  } catch (error) {
    await page.screenshot({ path: join(outDir, `${name}-${theme}-failure.png`) });
    throw error;
  } finally {
    await current.context.close();
  }
}

let current = null;

async function functionalSteps(name, theme) {
  const p = `${name}/${theme}:`;
  const { page, errors } = current;

  // Structure.
  const menus = await page.getByRole('menubar').getByRole('menuitem').allTextContents();
  check(`${p} menu bar File, Help`, menus.map((m) => m.replace(/\s+/g, '')).join(',') === 'File,Help', menus.join(','));
  for (const text of [
    'S-Record File',
    'Binary Input/Output Split',
    'Binary File(s)',
    'Start Address:',
    'Last Address:',
    'First Address:',
    'File Split:',
    'Row',
    'Page',
  ]) {
    check(`${p} caption "${text}" on screen`, (await page.getByText(text, { exact: false }).count()) > 0);
  }
  check(
    `${p} status bar shows EASyBIN v2.5.0`,
    (await page.locator('.e68-statusbar').innerText()).includes('EASyBIN v2.5.0'),
  );
  const firstRow = await page.locator('.e68-easybin__row:not(.e68-easybin__measure)').first().innerText();
  check(
    `${p} first row of an empty memory`,
    firstRow.startsWith('00000000: FF FF FF') && firstRow.trimEnd().endsWith('----------------'),
    firstRow,
  );

  // Open S-Record with Ctrl+O, the real dialog and message box.
  await writeStore(page, '/browser/b1-hello.S68', readFileSync(join(fixtures, 'asm-hello.S68')));
  await page.locator('.e68-easybin__rows').click();
  await page.keyboard.press('Control+O');
  await fileDialog(page, 'b1-hello.S68', 'Open');
  const loaded = await answerBox(page, 'OK');
  check(
    `${p} Open S-Record message`,
    loaded.includes('S Record loaded successfully.') && loaded.includes('S0 = 68KPROG   20CREATED BY EASY68K'),
    loaded.replace(/\n/g, '|'),
  );
  let state = await modelState(page);
  check(
    `${p} fields after the open`,
    state.fields.lastAddress === '001022' && state.fields.address === '001000' && state.fields.outLength === '000023',
    JSON.stringify(state.fields),
  );
  check(
    `${p} status bar shows the file`,
    (await page.locator('.e68-statusbar').innerText()).includes('/browser/b1-hello.S68'),
  );
  await page.screenshot({ path: join(outDir, `${name}-${theme}-loaded.png`) });

  // Save S-Record: From/To typed, Ctrl+R, confirmation, dialog.
  await setField(page, 'From', '001000');
  await setField(page, 'To', '001023');
  await page.locator('.e68-easybin__rows').click();
  await page.keyboard.press('Control+R');
  const confirm = await answerBox(page, 'Yes');
  check(
    `${p} Save S-Record confirmation text`,
    confirm.includes('From:$001000  To:$001023') && confirm.includes('Start Address:$00001000'),
    confirm.replace(/\n/g, '|'),
  );
  await fileDialog(page, 'b1-out.S68', 'Save');
  await waitForStore(page, '/browser/b1-out.S68');
  const saved = await readStore(page, '/browser/b1-out.S68');
  const savedHex = saved ? saved.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('') : '';
  check(
    `${p} Save S-Record writes the original's bytes`,
    savedHex === expectedHelloSave(),
    saved ? `${saved.length} bytes` : 'no file',
  );

  // Save Binary with 4 files through the group's button.
  await page.getByText('4 Files - Every 4th Byte', { exact: true }).click();
  await setField(page, 'First Address', '001000');
  await setField(page, 'Length of the binary files', '000023');
  await page.getByRole('button', { name: 'Save Binary...' }).click();
  await fileDialog(page, 'b1-rom.BIN', 'Save');
  await waitForStore(page, '/browser/b1-rom_3.BIN');
  const parts = [];
  for (let k = 0; k < 4; k++) parts.push(await readStore(page, `/browser/b1-rom_${k}.BIN`));
  check(
    `${p} Save Binary writes rom_0..rom_3 (9, 9, 9, 9 bytes: 35 + the byte after, Q4)`,
    parts.every((x) => x !== null) && parts.map((x) => x.length).join(',') === '9,9,9,9',
    parts.map((x) => (x ? x.length : 'missing')).join(','),
  );
  const mem = await memory(page, 0x1000, 36);
  check(
    `${p} rom_1 holds every 4th byte from $1001`,
    parts[1] && parts[1].join(',') === mem.filter((_, i) => i % 4 === 1).join(','),
  );
  await page.screenshot({ path: join(outDir, `${name}-${theme}-split4.png`) });

  // Fill and Copy.
  await setField(page, 'From', '002000');
  await setField(page, 'To', '00200F');
  await setField(page, 'Fill byte', '5A');
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  check(
    `${p} Fill writes From..To inclusive`,
    (await memory(page, 0x1fff, 18)).join(',') === [0xff, ...Array(16).fill(0x5a), 0xff].join(','),
  );
  await setField(page, 'From', '002000');
  await setField(page, 'To', '002008');
  await setField(page, 'Size', '000010');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  check(
    `${p} Copy overlapping upwards`,
    (await memory(page, 0x2000, 0x19)).join(',') === [...Array(0x18).fill(0x5a), 0xff].join(','),
  );
  await setField(page, 'To', '002000');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const copyMessage = await answerBox(page, 'OK');
  check(`${p} Copy onto itself: Invalid copy range`, copyMessage.includes('Invalid copy range'), copyMessage);

  // Address field, Row/Page, keys.
  await setField(page, 'Address', '002004');
  state = await modelState(page);
  check(`${p} Address field rounds down to 16`, state.fields.address === '002000', state.fields.address);
  await page.getByRole('button', { name: 'Row down' }).click();
  state = await modelState(page);
  check(
    `${p} Row down moves 16 bytes and focuses the rows`,
    state.fields.address === '002010' &&
      (await page.evaluate(() => document.activeElement?.classList.contains('e68-easybin__rows'))),
  );
  await page.getByRole('button', { name: 'Page down' }).click();
  state = await modelState(page);
  check(
    `${p} Page down moves nRows * 16`,
    parseInt(state.fields.address, 16) === 0x2010 + state.rows * 16,
    `${state.fields.address}, ${state.rows} rows`,
  );
  await setField(page, 'Address', '003000');
  const rows = page.locator('.e68-easybin__rows');
  const box = await rows.boundingBox();
  const cell = await page.locator('.e68-easybin__measure').boundingBox();
  const cw = cell.width / 10;
  const ch = cell.height;
  await page.mouse.click(box.x + 4 + cw * 10.5, box.y + ch * 0.5);
  await page.keyboard.type('12AB');
  await page.keyboard.press('ArrowRight');
  check(`${p} typing hex digits at a clicked cell`, (await memory(page, 0x3000, 2)).join(',') === '18,171');
  await page.mouse.click(box.x + 4 + cw * 58.5, box.y + ch * 1.5);
  await page.keyboard.type('Hi!');
  check(`${p} typing into the ASCII column`, (await memory(page, 0x3010, 3)).join(',') === '72,105,33');
  await page.keyboard.press('G');
  await page.mouse.click(box.x + 4 + cw * 20.5, box.y + ch * 0.5);
  await page.keyboard.press('G'); // refused in the hex columns (beep)
  check(`${p} a non-hex key changes nothing`, (await memory(page, 0x3003, 1))[0] === 0xff);
  await page.screenshot({ path: join(outDir, `${name}-${theme}-edited.png`) });

  // A dropped file that is not an S-record (one file, so that the bytes are consecutive).
  await page.getByText('1 File - All Bytes', { exact: true }).click();
  await setField(page, 'First Address', '004000');
  const dropped = await page.evaluate(() => {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([0x4e, 0x71, 0x4e, 0x75])], 'code.BIN'));
      const target = document.querySelector('.e68-easybin__rows');
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return 'sent';
    } catch (error) {
      return String(error);
    }
  });
  if (dropped === 'sent') {
    const first = await answerBox(page, 'OK');
    const second = await answerBox(page, 'OK');
    check(
      `${p} drop: loader message, then Opening as binary file.`,
      first.includes('Invalid data on line 1') && second.includes('Opening as binary file.'),
      `${first.replace(/\n/g, '|')} / ${second}`,
    );
    await page.waitForFunction(
      async () => {
        const { easybinOf } = await import('/src/features/easybin/session.ts');
        return easybinOf(window.__easy68k.ctx).model.getState().caption === 'code.BIN';
      },
      null,
      { timeout: WAIT, polling: 50 },
    );
    check(
      `${p} drop: loaded at First Address`,
      (await memory(page, 0x4000, 4)).join(',') === '78,113,78,117',
      (await memory(page, 0x4000, 4)).join(','),
    );
  } else {
    check(`${p} drop could be simulated`, false, dropped);
  }

  // The scan comes before Help: axe waits for frames, and the help page is a sandboxed frame.
  await scan(page, `${name} ${theme}`);

  // About and Help.
  await page.locator('[role=menubar] > [role=menuitem]', { hasText: 'Help' }).click();
  await page.locator('[role=menu] [role=menuitem]', { hasText: 'About EASyBIN' }).click();
  const about = page.getByRole('dialog', { name: 'About EASyBIN' });
  await about.waitFor({ timeout: WAIT });
  const aboutText = await about.innerText();
  check(
    `${p} About box texts`,
    aboutText.includes('EASyBIN v2.5.0') &&
      aboutText.includes('By: Chuck Kelly') &&
      aboutText.includes('Use the EASy68K forum to report undocumented features.'),
  );
  await page.screenshot({ path: join(outDir, `${name}-${theme}-about.png`) });
  await about.getByRole('button', { name: 'OK' }).click();
  await page.locator('.e68-easybin__rows').click();
  await page.keyboard.press('F1');
  await page
    .waitForFunction(
      () =>
        (document.querySelector('[data-e68-panel="help"] iframe')?.getAttribute('src') ?? '').includes('easybin.htm'),
      null,
      { timeout: WAIT, polling: 50 },
    )
    .catch(() => {}); // the check below reports what the panel shows
  const helpSrc = await page.evaluate(
    () => document.querySelector('[data-e68-panel="help"] iframe')?.getAttribute('src') ?? '',
  );
  check(`${p} F1 opens easybin.htm in the Help panel`, helpSrc.includes('easybin.htm'), helpSrc);
  await page.screenshot({ path: join(outDir, `${name}-${theme}-help.png`) });

  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
}

/** Key-down to the next painted frame, in ms: `count` keys typed at the cursor. */
async function measureTyping(page, count) {
  await page.evaluate(() => {
    window.__lat = [];
    if (window.__latInstalled) return;
    window.__latInstalled = true;
    const rows = document.querySelector('.e68-easybin__rows');
    let started = 0;
    rows.addEventListener(
      'keydown',
      () => {
        started = performance.now();
      },
      true,
    );
    new MutationObserver(() => {
      if (!started) return;
      const t0 = started;
      started = 0;
      // after the next frame has been produced
      requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t0), 0));
    }).observe(rows, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const keys = '0123456789ABCDEF';
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(keys[i % 16]);
    await page.waitForTimeout(25);
  }
  // Every key repaints; wait for the last frames instead of a fixed time (a slow runner lags).
  await page.waitForFunction((n) => window.__lat.length >= n, count, { timeout: WAIT, polling: 50 }).catch(() => {}); // a missing measurement shows up as n < 100 in the check
  return page.evaluate(() => window.__lat.slice());
}

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
};
const percentile = (list, p) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? NaN;
};

async function performancePass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser, 'light');
  await page.setViewportSize({ width: 1280, height: 1000 });
  // At least three runs, up to six while none meets the limits, and the best run counts: a loaded
  // machine (or a slow CI runner) gets more chances instead of a failure from one unlucky run.
  const meets = (r) => r.n >= 100 && r.median < 50 && r.p95 < 100;
  const runs = [];
  for (let run = 0; run < 6 && (run < 3 || !runs.some(meets)); run++) {
    const all = [];
    for (const address of ['000000', '7FFF80', 'FFFF00']) {
      await setField(page, 'Address', address);
      const rows = page.locator('.e68-easybin__rows');
      const box = await rows.boundingBox();
      const cell = await page.locator('.e68-easybin__measure').boundingBox();
      await page.mouse.click(box.x + 4 + (cell.width / 10) * 10.5, box.y + cell.height * 0.5);
      all.push(...(await measureTyping(page, 40)));
    }
    runs.push({ median: median(all), p95: percentile(all, 95), max: Math.max(...all), n: all.length });
  }
  const best = runs.find(meets) ?? runs.reduce((a, b) => (b.median < a.median ? b : a));
  const describe = (r) =>
    `median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keys`;
  console.log(`        runs: ${runs.map(describe).join(' | ')}`);
  check(
    `${p} editing at $000000, $7FFF80, $FFFF00: key-down to painted frame, best run (${describe(best)})`,
    meets(best),
  );

  // Typing into the Address field jumps anywhere at once.
  const jumps = [];
  for (const address of ['ABCDE0', '123450', 'FFFFF0', '000100', '800000']) {
    const t = await page.evaluate(async (a) => {
      const input = document.querySelector('input[aria-label="Address"]');
      const { easybinOf } = await import('/src/features/easybin/session.ts');
      const { model } = easybinOf(window.__easy68k.ctx);
      const t0 = performance.now();
      model.setField('address', a);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return {
        ms: performance.now() - t0,
        shown: document.querySelector('.e68-easybin__row:not(.e68-easybin__measure)').textContent.slice(0, 8),
        value: input.value,
      };
    }, address);
    jumps.push(t);
  }
  check(
    `${p} the Address field shows any address at once (median ${median(jumps.map((j) => j.ms)).toFixed(1)} ms, worst ${Math.max(...jumps.map((j) => j.ms)).toFixed(1)} ms)`,
    // The median, not every jump: one jump slowed by garbage collection or a busy runner is load.
    median(jumps.map((j) => j.ms)) < 200 &&
      jumps.map((j) => j.shown).join(',') === '00ABCDE0,00123450,00FFFFF0,00000100,00800000',
    jumps.map((j) => j.shown).join(','),
  );

  // Fill all 16 MB through the button, three times, best run.
  const fills = [];
  for (let run = 0; run < 3; run++) {
    await setField(page, 'From', '000000');
    await setField(page, 'To', 'FFFFFF');
    await setField(page, 'Fill byte', run % 2 ? '00' : 'A5');
    const ms = await page.evaluate(async () => {
      const button = [...document.querySelectorAll('.e68-easybin button')].find((b) => b.textContent === 'Fill');
      const t0 = performance.now();
      button.click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return performance.now() - t0;
    });
    fills.push(ms);
  }
  const lastByte = (await memory(page, 0xffffff, 1))[0];
  check(
    `${p} Fill of all 16 MB (best ${Math.min(...fills).toFixed(1)} ms of ${fills.map((f) => f.toFixed(0)).join(', ')})`,
    Math.min(...fills) < 500 && lastByte === 0xa5,
  );
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** Runs a pass; an exception counts as one failed check and the next pass still runs. */
async function guarded(label, pass) {
  try {
    await pass();
  } catch (error) {
    check(`${label}: the pass ran to its end`, false, String(error).split('\n')[0]);
  }
}

// --- run -----------------------------------------------------------------------------------------

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No HMR and no file watching: other packages edit files in this working tree while the check
    // runs, and a reload in the middle of a pass would lose the page's state.
    // strictPort false: should another process take the free port first, Vite moves on to the next.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch({ timeout: LOAD_TIMEOUT });
      try {
        for (const theme of ['light', 'dark']) {
          console.log(`\n[${name}, ${theme}]`);
          await guarded(`${name}/${theme}`, () => functionalPass(browser, name, theme));
        }
        console.log(`\n[${name}, responsiveness]`);
        await guarded(name, () => performancePass(browser, name));
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
