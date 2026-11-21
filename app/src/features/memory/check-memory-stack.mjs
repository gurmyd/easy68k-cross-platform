// Browser check of the Memory and Stack panels (ARCHITECTURE.md 9.2, U2). Owner: U2.
//
//   node app/src/features/memory/check-memory-stack.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite dev server of app/ on a free port and drives the real application in headless
// Chromium and WebKit (Playwright). Until the real simulator session (SH8) exists the application
// runs on the inert session of wave zero; the script gives that session's controller the two
// behaviours the contract states for these panels (`pokeMemory` writes the byte, `invoke` runs
// the function) and sets registers and the memory map on its engine object, through the
// development-only page object `window.__easy68k`. It checks what unit tests under Node cannot
// show: the rendered rows and their format, the number of rows following the panel height,
// clicking and typing in hex and ASCII, the Address field's keys, Fill, Copy and Save with their
// message boxes, Live, the stack's middle row and its aqua / yellow / red colours, the cursor's
// blink (and none under reduced motion), both themes, and no console errors.
//
// Screenshots go to build/U2/check (git-ignored). Exit code 0 = every check passed.

/* global console, process, document, window, getComputedStyle -- page.evaluate() callbacks run in the page */

import { mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'U2', 'check')));
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

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function pretendWindows() {
  Object.defineProperty(window.Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(window.Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function openApp(browser, { reducedMotion = 'reduce', theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, reducedMotion });
  await context.addInitScript(pretendWindows);
  const page = await context.newPage();
  // The first load makes Vite transform the whole application; the machine may be busy.
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl);
  await page.waitForSelector('.e68-shell');
  await page.waitForFunction(() => window.__easy68k !== undefined);
  await page.evaluate(async (value) => {
    const { ctx } = window.__easy68k;
    await ctx.commands.run('app.theme.set', value);
    await ctx.commands.run('app.mode.set', 'simulator');
    // The two controller behaviours of the contract (3.11.2) that these panels use.
    const session = ctx.sim;
    session.controller.pokeMemory = (address, byte) => {
      session.engine.memory[address] = byte;
    };
    session.controller.invoke = (fn) => fn(session.engine);
    // The inert engine of wave zero ignores writeBytes; the real one writes memory.
    session.engine.writeBytes = (address, bytes) => session.engine.memory.set(bytes, address);
    const memory = session.engine.memory;
    memory.set([0x10, 0x3c, 0x00, 0x0e, 0x43, 0xf9, 0x00, 0x00, 0x10, 0x12, 0x4e, 0x4f], 0x1000);
  }, theme);
  await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
  page.setDefaultTimeout(30_000);
  return { context, page, errors };
}

const run = (page, id, arg) => page.evaluate(([c, a]) => window.__easy68k.ctx.commands.run(c, a), [id, arg]);
const rowTexts = (page) =>
  page.$$eval('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)', (rows) =>
    rows.map((row) => row.textContent),
  );
const byte = (page, address) => page.evaluate((a) => window.__easy68k.ctx.sim.engine.memory[a], address);
const bumpView = (page) =>
  page.evaluate(() =>
    window.__easy68k.ctx.store.setState((s) => ({ ...s, sim: { ...s.sim, viewRevision: s.sim.viewRevision + 1 } })),
  );

/** Clicks the character cell (row, col) of the memory rows. */
async function clickCell(page, row, col) {
  const box = await page.locator('[data-e68-panel="memory"] .e68-memory__measure').boundingBox();
  const rows = await page.locator('[data-e68-panel="memory"] .e68-memory__rows').boundingBox();
  const cw = box.width / 10;
  const rh = box.height;
  // The measuring cell sits where the first character of the rows is (after the padding).
  await page.mouse.click(box.x + col * cw + cw / 2, rows.y + row * rh + rh / 2);
}

async function typeField(page, label, text) {
  const field = page.locator(`[data-e68-panel="memory"] input[aria-label="${label}"]`);
  await field.click();
  await field.press('Home');
  await field.pressSequentially(text);
}

async function messageBox(page, text) {
  const dialog = page.locator('[role=alertdialog]');
  const shown = await dialog.waitFor({ timeout: 5000 }).then(
    () => true,
    () => false,
  );
  const content = shown ? await dialog.innerText() : '';
  if (shown) await dialog.getByRole('button', { name: 'OK' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  return shown && content.includes(text) ? content : `missing: ${content}`;
}

async function memoryPass(browser, name, theme) {
  const p = `${name}/${theme}:`;
  const { context, page, errors } = await openApp(browser, { theme });

  await run(page, 'sim.view.memory', '00001000');
  await page.waitForSelector('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check(`${p} View > Memory focuses the Address field`, focused === 'Address', String(focused));
  const rows = await rowTexts(page);
  check(
    `${p} first row equals the example of sim-ui §10.1`,
    rows[0] === '00001000: 10 3C 00 0E 43 F9 00 00 10 12 4E 4F FF FF FF FF -<--C-----NO----',
    rows[0],
  );
  const fit = await page.evaluate(() => {
    const rowsBox = document.querySelector('[data-e68-panel="memory"] .e68-memory__rows');
    const measure = rowsBox.querySelector('.e68-memory__measure').getBoundingClientRect().height;
    return Math.floor(rowsBox.clientHeight / measure);
  });
  check(`${p} the number of rows follows the panel height`, rows.length === fit && fit >= 3, `${rows.length} / ${fit}`);
  check(
    `${p} the column header stands over the hex and ASCII columns`,
    (await page.locator('[data-e68-panel="memory"] .e68-memory__header').textContent()) ===
      '          00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 0123456789ABCDEF',
  );

  // Typing in the hex area: click on the space after byte 1 (column 15) puts the cursor on byte 2's high nibble.
  await clickCell(page, 0, 15);
  await page.keyboard.type('ab');
  check(`${p} typed hex digits change the byte under the cursor`, (await byte(page, 0x1002)) === 0xab);
  check(
    `${p} the row repaints after the edit`,
    (await rowTexts(page))[0]?.startsWith('00001000: 10 3C AB 0E'),
    (await rowTexts(page))[0],
  );
  const cursorShown = await page.evaluate(() => {
    const cursor = document.querySelector('.e68-memory__cursor');
    return cursor ? getComputedStyle(cursor).visibility : 'none';
  });
  check(`${p} the cursor frame is shown while the rows have the focus`, cursorShown === 'visible', cursorShown);
  const blink = await page.evaluate(
    () => getComputedStyle(document.querySelector('.e68-memory__cursor')).animationName,
  );
  check(`${p} the cursor does not blink under reduced motion`, blink === 'none', blink);
  await page.keyboard.type('g');
  check(`${p} a non-hex key in the hex area changes nothing`, (await byte(page, 0x1003)) === 0x0e);

  // ASCII area: Enter stores $0D.
  await clickCell(page, 1, 58);
  await page.keyboard.press('Enter');
  check(`${p} Enter in the ASCII area stores $0D`, (await byte(page, 0x1010)) === 0x0d);
  await page.keyboard.type('Hi');
  check(
    `${p} typed characters appear in the ASCII column`,
    (await rowTexts(page))[1]?.endsWith('-Hi-------------'),
    (await rowTexts(page))[1],
  );
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('7');
  check(`${p} Left from the ASCII column goes to the last hex nibble`, (await byte(page, 0x101f)) === 0xf7);

  // Address field keys.
  const address = page.locator('[data-e68-panel="memory"] input[aria-label="Address"]');
  await address.click();
  await address.press('ArrowDown');
  check(`${p} Down in the Address field moves one row`, (await address.inputValue()) === '001010');
  await address.press('PageDown');
  const paged = await address.inputValue();
  check(
    `${p} Page Down moves one page`,
    paged === (0x1010 + rows.length * 16).toString(16).toUpperCase().padStart(6, '0'),
    paged,
  );
  await address.press('Home');
  await address.pressSequentially('00200F');
  check(`${p} the Address field is rounded down to 16`, (await address.inputValue()) === '002000');

  // Fill, Copy, Save.
  await typeField(page, 'From', '002000');
  await typeField(page, 'To', '002005');
  await typeField(page, 'Bytes', '12345678');
  const fields = await page.$$eval('[data-e68-panel="memory"] .e68-memory__strip input', (inputs) =>
    inputs.map((input) => input.value).join(' '),
  );
  await page.locator('[data-e68-panel="memory"] button', { hasText: 'Fill' }).click();
  check(
    `${p} Fill writes the 4-byte pattern From..To`,
    (await rowTexts(page))[0]?.startsWith('00002000: 12 34 56 78 12 34 FF'),
    `${(await rowTexts(page))[0]} (fields ${fields})`,
  );
  await typeField(page, 'To', '002000');
  await page.locator('[data-e68-panel="memory"] button', { hasText: 'Copy' }).click();
  const copyBox = await messageBox(page, 'Invalid copy range');
  check(`${p} Copy with To = From shows "Invalid copy range" (SIM68K)`, copyBox.includes('SIM68K'), copyBox);
  await typeField(page, 'To', '002008');
  await typeField(page, 'Bytes', '00000004');
  await page.locator('[data-e68-panel="memory"] button', { hasText: 'Copy' }).click();
  check(
    `${p} Copy copies Bytes bytes From -> To`,
    (await rowTexts(page))[0]?.startsWith('00002000: 12 34 56 78 12 34 FF FF 12 34 56 78'),
    (await rowTexts(page))[0],
  );
  await typeField(page, 'To', '001FFF');
  await page.locator('[data-e68-panel="memory"] button[aria-label="Save"]').click();
  const saveBox = await messageBox(page, 'Invalid memory range.');
  check(
    `${p} Save with To < From shows "Invalid memory range." (Information)`,
    saveBox.includes('Information'),
    saveBox,
  );

  // Live at address 0.
  await address.click();
  await address.press('Home');
  await address.pressSequentially('000000');
  const live = page.locator('[data-e68-panel="memory"] .e68-memory__side .e68-checkbox');
  await live.click();
  await page.evaluate(() => {
    window.__easy68k.ctx.sim.engine.memory[0x21] = 0x5a;
  });
  await page.waitForTimeout(200);
  check(
    `${p} Live repaints a changed row while the top row is address 0`,
    (await rowTexts(page))[2]?.startsWith('00000020: FF 5A'),
    (await rowTexts(page))[2],
  );
  await live.click();
  await page.evaluate(() => {
    window.__easy68k.ctx.sim.engine.memory[0x22] = 0x5b;
  });
  await page.waitForTimeout(200);
  check(
    `${p} without Live the panel stays as painted`,
    (await rowTexts(page))[2]?.startsWith('00000020: FF 5A FF'),
    (await rowTexts(page))[2],
  );
  await bumpView(page);
  check(
    `${p} a stop (viewRevision) repaints`,
    (await rowTexts(page))[2]?.startsWith('00000020: FF 5A 5B'),
    (await rowTexts(page))[2],
  );

  await page.locator('[data-e68-panel="memory"]').screenshot({ path: join(outDir, `${name}-${theme}-memory.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function stackPass(browser, name, theme) {
  const p = `${name}/${theme}:`;
  const { context, page, errors } = await openApp(browser, { theme });
  await page.evaluate(() => {
    const engine = window.__easy68k.ctx.sim.engine;
    const registers = engine.registers();
    engine.registers = () => ({ ...registers, a: [0, 0, 0, 0x8008, 0, 0, 0], ssp: 0x8000, a7: 0x8004 });
    const hardware = engine.hardware();
    engine.hardware = () => {
      const map = hardware.map.map((row) => ({ ...row }));
      map[3] = { enabled: true, start: 0x8001, end: 0x8002 };
      return { ...hardware, map };
    };
    engine.memory.set([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88], 0x8000);
  });
  await run(page, 'sim.view.stack');
  await page.waitForSelector('[data-e68-panel="stack"] .e68-stack__row:not(.e68-stack__measure)');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  check(`${p} View > Stack focuses the View list`, focused === 'SELECT', String(focused));
  const info = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-e68-panel="stack"] .e68-stack__row:not(.e68-stack__measure)')];
      const middle = rows[Math.trunc(rows.length / 2)];
      const style = (el) => (el ? { bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color } : null);
      return {
        count: rows.length,
        middle: middle?.textContent,
        reg: style(document.querySelector('[data-e68-panel="stack"] [data-mark="reg"]')),
        sp: style(document.querySelector('[data-e68-panel="stack"] [data-mark="sp"]')),
        regText: document.querySelector('[data-e68-panel="stack"] [data-mark="reg"]')?.textContent,
        spText: document.querySelector('[data-e68-panel="stack"] [data-mark="sp"]')?.textContent,
        invalid: [...document.querySelectorAll('[data-e68-panel="stack"] [data-invalid="true"]')].map((el) => ({
          text: el.textContent,
          fg: getComputedStyle(el).color,
        })),
      };
    });
  let state = await info();
  check(`${p} rows fill the panel`, state.count >= 5, String(state.count));
  check(`${p} SS ($8000) is on the middle row`, state.middle === '00008000: 11 22 33 44 ', state.middle);
  check(
    `${p} aqua marks the selected register's byte`,
    state.reg?.bg === 'rgb(0, 255, 255)' && state.regText === '11 ',
    JSON.stringify(state.reg),
  );
  check(
    `${p} yellow marks the active stack pointer's byte`,
    state.sp?.bg === 'rgb(255, 255, 0)' && state.spText === '55 ',
    JSON.stringify(state.sp),
  );
  check(`${p} black text on the marks`, state.reg?.fg === 'rgb(0, 0, 0)' && state.sp?.fg === 'rgb(0, 0, 0)');
  check(
    `${p} red text for the Invalid range`,
    state.invalid.map((i) => i.text).join('') === '22 33 ' &&
      state.invalid.every((i) => /^rgb\((1[6-9]\d|2\d\d), /.test(i.fg)),
    JSON.stringify(state.invalid),
  );
  await page.locator('[data-e68-panel="stack"] select').selectOption('3');
  state = await info();
  check(
    `${p} choosing A3 centres on A3`,
    state.middle === '00008008: 00 00 00 00 ' || state.middle?.startsWith('00008008: '),
    state.middle,
  );
  await page.locator('[data-e68-panel="stack"] button[aria-label="Lower addresses"]').click();
  state = await info();
  check(`${p} the spin button moves one row`, state.middle?.startsWith('00008004: '), state.middle);
  await bumpView(page);
  state = await info();
  check(`${p} a stop re-centres`, state.middle?.startsWith('00008008: '), state.middle);
  await page.locator('[data-e68-panel="stack"]').screenshot({ path: join(outDir, `${name}-${theme}-stack.png`) });
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function motionPass(browser, name) {
  const { context, page, errors } = await openApp(browser, { reducedMotion: 'no-preference' });
  await run(page, 'sim.view.memory', '00001000');
  await page.waitForSelector('[data-e68-panel="memory"] .e68-memory__row:not(.e68-memory__measure)');
  await clickCell(page, 0, 10);
  const blink = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.e68-memory__cursor'));
    return `${style.animationName} ${style.animationDuration}`;
  });
  check(`${name}: the cursor blinks at 500 ms (1 s period)`, blink === 'e68-memory-blink 1s', blink);
  await page.screenshot({ path: join(outDir, `${name}-simulator.png`) });
  check(`${name}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No file watching and no hot reload: other packages edit files in this tree while the
    // script runs, and a reload in the middle of a check would destroy the page's state.
    server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        for (const theme of ['light', 'dark']) {
          console.log(`\n[${name}, ${theme}: Memory panel]`);
          await memoryPass(browser, name, theme);
          console.log(`\n[${name}, ${theme}: Stack panel]`);
          await stackPass(browser, name, theme);
        }
        console.log(`\n[${name}, motion]`);
        await motionPass(browser, name);
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
