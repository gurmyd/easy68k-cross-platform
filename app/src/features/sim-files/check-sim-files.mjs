// Browser check of the program's files, the task 58 dialog and the printer output (ARCHITECTURE.md
// 9.4, SH6). Owner: SH6.
//
//   node app/src/features/sim-files/check-sim-files.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright): the application's own simulator session (features/run)
// with the real engine, the real browser store (IndexedDB) and the cached view of the program's
// folder (fs/sync/cached.ts). Programs assembled by the real assembler are written to the browser
// store and opened with the run controller. What unit tests under Node cannot show:
//
//   1. A program writes and closes a file: when it halts the bytes are in IndexedDB.
//   2. Liveness: a program reads input.txt, which does not exist; a SECOND PAGE of the same browser
//      writes it (BroadcastChannel, 3.8.6); Rewind and Run read it without a reload. Then the first
//      page saves a new version through its Vfs, as the editor saves: Rewind and Run read that.
//   3. Task 58: the application's file dialog appears with the program's title while the program
//      waits (phase waitHost, modal); Cancel gives D1 = 0; Open with a typed name gives D1 = 1 and
//      the path; the Save dialog (default title "Save As") with a new name, which task 52 creates.
//   4. Task 10: a form feed ends a job; the Printer Output dialog opens by itself without holding
//      the program, shows the page, and Print... hands the job to Platform.print; File > Printer
//      Setup... (the menu) opens the dialog modal. Screenshots and an accessibility scan in both themes.
//   5. Closing the tab: a program leaves a file open with unwritten bytes and halts; the page is
//      closed; a new page starts and the bytes are in the file (exitNow at pagehide, the journal,
//      recoverJournal at the start).
//
// Every step waits for the state it expects (up to WAIT ms); the two liveness steps repeat Rewind and
// Run up to 20 times, 100 ms apart, until the program reads the new bytes. Nothing depends on the
// operating system: no chords are pressed (Escape and clicks only).
//
// Needs engine/dist (both engines): without it the check prints "skipped", or fails when
// EASY68K_REQUIRE_ENGINES=1. Needs no production build. Screenshots go to build/SH6/sim-files-check
// (git-ignored). Prints "N of M checks passed"; exit code 0 = everything passed and no console error.
//
// Platform.print is replaced in the page by a recorder for step 4: a real print dialog cannot be
// answered in a headless browser. What reaches it is checked (the job's document); the browser's
// own printing of a document is the platform's (W3) and is not what this check is about.

/* global console, process, document, window, setTimeout, localStorage -- the browser globals are used inside page.evaluate() callbacks */

import { existsSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const outDir = resolve(option('--out', join(repoRoot, 'build', 'SH6', 'sim-files-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
const enginesBuilt = ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((file) =>
  existsSync(join(repoRoot, 'engine', 'dist', file)),
);

/** The first load of the development server transforms every module; on a busy machine that takes a while. */
const LOAD_TIMEOUT = 240_000;
/** How long a step waits for the state it expects. */
const WAIT = 30_000;
const DIR = '/browser/sh6check';
const RESULTS = 0x5000;

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}
const firstLine = (text) => String(text).split('\n')[0];

/** A free TCP port, found by asking the system for one. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** WebKit's message when the development server answered a module request too late: not counted. */
const isLoadTimeout = (text) => /Failed to load resource.*Timeout was reached/i.test(text);

function reportErrors(prefix, errors) {
  const timeouts = errors.filter(isLoadTimeout);
  const real = errors.filter((text) => !isLoadTimeout(text));
  if (timeouts.length) console.log(`        not counted: ${timeouts.length} x "${timeouts[0]}"`);
  check(`${prefix} no console or page errors`, real.length === 0, real.slice(0, 3).join(' | '));
  for (const text of real.slice(3)) console.log(`        also counted: ${text}`);
}

/** Waits until `fn(arg)` is true in the page; false instead of an exception when it never is. */
const until = (page, fn, arg, timeout = WAIT) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );

/* ------------------------------------------------------------------ programs */

const trap = (task) => [`        MOVE.L  #${task},D0`, '        TRAP    #15'];
const program = (body, data) => [
  '        ORG     $1000',
  `START:  LEA     $${RESULTS.toString(16)},A5`,
  ...body,
  '        SIMHALT',
  ...data,
  '        DS.W    0',
  'BUF:    DS.B    300',
  '        END     START',
];

const SOURCES = {
  writer: program(
    [
      '        LEA     OUT,A1',
      ...trap(52),
      '        MOVE.L  D1,D6',
      '        LEA     TEXT,A1',
      '        MOVEQ   #10,D2',
      ...trap(54),
      '        MOVE.L  D6,D1',
      ...trap(56),
      '        MOVE.L  D0,(A5)+',
    ],
    ["OUT:    DC.B    'out.txt',0", "TEXT:   DC.B    'HELLO FILE',0"],
  ),
  reader: program(
    [
      '        CLR.B   BUF',
      '        LEA     INPUT,A1',
      ...trap(51),
      '        MOVE.L  D0,(A5)+',
      '        LEA     BUF,A1',
      '        MOVEQ   #40,D2',
      ...trap(53),
      '        MOVE.L  D2,(A5)+',
      ...trap(50),
    ],
    ["INPUT:  DC.B    'INPUT.TXT',0"],
  ),
  dialog: program(
    [
      // Open dialog, answered with Cancel
      '        MOVEQ   #0,D1',
      '        LEA     TITLE,A1',
      '        LEA     FILTER,A2',
      '        LEA     PATH,A3',
      ...trap(58),
      '        MOVE.L  D1,(A5)+',
      // Open dialog, answered with input.txt; the program opens the path it got
      '        CLR.B   PATH',
      '        MOVEQ   #0,D1',
      '        LEA     TITLE,A1',
      '        LEA     FILTER,A2',
      '        LEA     PATH,A3',
      ...trap(58),
      '        MOVE.L  D1,(A5)+',
      '        LEA     PATH,A1',
      ...trap(51),
      '        MOVE.L  D0,(A5)+',
      ...trap(50),
      // Save dialog with the default title and no filter: a new name, created by task 52
      '        CLR.B   PATH',
      '        MOVEQ   #1,D1',
      '        MOVE.L  #0,A1',
      '        MOVE.L  #0,A2',
      '        LEA     PATH,A3',
      ...trap(58),
      '        MOVE.L  D1,(A5)+',
      '        LEA     PATH,A1',
      ...trap(52),
      '        MOVE.L  D0,(A5)+',
      '        LEA     SAVED,A1',
      '        MOVEQ   #5,D2',
      ...trap(54),
      ...trap(50),
    ],
    [
      "TITLE:  DC.B    'Pick a data file',0",
      "FILTER: DC.B    '*.txt',0",
      "SAVED:  DC.B    'SAVED',0",
      '        DS.W    0',
      'PATH:   DS.B    256',
    ],
  ),
  printer: program(
    ['        LEA     PAGE,A1', ...trap(10)],
    ["PAGE:   DC.B    'HELLO PRINTER',13,10,'SECOND LINE',12,0"],
  ),
  pending: program(
    ['        LEA     LEFT,A1', ...trap(52), '        LEA     TEXT,A1', '        MOVEQ   #10,D2', ...trap(54)],
    ["LEFT:   DC.B    'left.txt',0", "TEXT:   DC.B    'NOT CLOSED',0"],
  ),
};

async function assemblePrograms() {
  const { assemble } = await import(pathToFileURL(join(repoRoot, 'engine', 'asm', 'asm68k.mjs')).href);
  const programs = {};
  for (const [name, lines] of Object.entries(SOURCES)) {
    const source = lines.map((line) => `${line}\r\n`).join('');
    const files = new Map([[`${name}.X68`, Uint8Array.from(source, (ch) => ch.charCodeAt(0))]]);
    const result = await assemble(`${name}.X68`, files, {}, new Date(2026, 0, 1));
    if (result.errorCount > 0 || !result.sRecord || !result.listing) {
      throw new Error(`The test program ${name} does not assemble: ${result.messages.map((m) => m.text).join('; ')}`);
    }
    programs[name] = { s68: [...result.sRecord], l68: [...result.listing] };
  }
  return programs;
}

/* ------------------------------------------------------------------ the page */

async function openPage(context, { initScript } = {}) {
  const page = await context.newPage();
  if (initScript) await page.addInitScript(initScript);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  let outdated = false;
  page.on('response', (response) => {
    if (response.status() === 504) outdated = true;
    // A module the development server could not transform (for a CI log: which one).
    if (response.status() >= 500 && response.status() !== 504) {
      console.log(`        ${response.status()} from the development server: ${response.url()}`);
    }
  });
  for (let attempt = 1; ; attempt++) {
    outdated = false;
    errors.length = 0;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
    const started = Date.now();
    let ready = false;
    const reoptimized = () => outdated || errors.some((text) => /Invalid hook call/i.test(text));
    while (!ready && !reoptimized() && Date.now() - started < LOAD_TIMEOUT) {
      ready = await page
        .evaluate(() => window.__easy68k !== undefined && document.querySelector('.e68-shell') !== null)
        .catch(() => false);
      if (!ready) await new Promise((wake) => setTimeout(wake, 250));
    }
    if (ready && !reoptimized()) break;
    if (!reoptimized() || attempt >= 3) {
      throw new Error(`the application did not start (attempt ${attempt}): ${errors.slice(0, 3).join(' | ')}`);
    }
    console.log('        the development server bundled its dependencies again; loading the page again');
  }
  return { page, errors };
}

/** Simulator mode, and the session's engine running. */
async function simulatorReady(page) {
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.mode.set', 'simulator'));
  return until(page, () => window.__easy68k.ctx.store.getState().sim.phase === 'idle', undefined, LOAD_TIMEOUT);
}

async function writePrograms(page, programs) {
  await page.evaluate(
    async ([dir, files]) => {
      const { ctx } = window.__easy68k;
      for (const [name, program] of Object.entries(files)) {
        await ctx.vfs.writeFile(`${dir}/${name}.S68`, Uint8Array.from(program.s68));
        await ctx.vfs.writeFile(`${dir}/${name}.L68`, Uint8Array.from(program.l68));
      }
    },
    [DIR, programs],
  );
}

/** File > Open through the run controller; waits for the end of the load. */
async function openProgram(page, name) {
  await page.evaluate(
    ([dir, file]) => window.__easy68k.ctx.sim.controller.open(`${dir}/${file}.S68`, 'open'),
    [DIR, name],
  );
  return until(
    page,
    ([dir, file]) => {
      const sim = window.__easy68k.ctx.store.getState().sim;
      return sim.phase === 'idle' && sim.program?.path === `${dir}/${file}.S68`;
    },
    [DIR, name],
  );
}

const runToHalt = async (page) => {
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
  return until(page, () => {
    const sim = window.__easy68k.ctx.store.getState().sim;
    return sim.phase === 'idle' && sim.halted;
  });
};

const rewindAndRun = async (page) => {
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.rewind());
  return runToHalt(page);
};

/** Long words the program stored at RESULTS. */
const results68 = (page, count) =>
  page.evaluate(
    ([base, n]) => {
      const m = window.__easy68k.ctx.sim.engine.memory;
      return Array.from({ length: n }, (_, i) => {
        const a = base + i * 4;
        return ((m[a] << 24) | (m[a + 1] << 16) | (m[a + 2] << 8) | m[a + 3]) >>> 0;
      });
    },
    [RESULTS, count],
  );

/** A file of the browser store as text, or null. */
const storedText = (page, path) =>
  page.evaluate(async (p) => {
    const { vfs } = window.__easy68k.ctx;
    if (!(await vfs.stat(p))) return null;
    return String.fromCharCode(...(await vfs.readFile(p)));
  }, path);

const untilStored = async (page, path, text) => {
  const ok = await until(
    page,
    async ([p, t]) => {
      const { vfs } = window.__easy68k.ctx;
      return (await vfs.stat(p)) !== null && String.fromCharCode(...(await vfs.readFile(p))) === t;
    },
    [path, text],
  );
  return ok;
};

/** The bytes at a label of the loaded program (from the listing's symbol table). */
const labelText = (page, label, length) =>
  page.evaluate(
    ([name, n]) => {
      const { sim } = window.__easy68k.ctx;
      const row = sim.listing.rows.find((r) => new RegExp(`^${name}\\s+[0-9A-F]+$`).test(r.trim()));
      if (!row) return null;
      const address = parseInt(row.trim().split(/\s+/)[1], 16);
      return String.fromCharCode(...sim.engine.memory.slice(address, address + n)).replace(/\0.*$/s, '');
    },
    [label, length],
  );

async function screenshot(locator, file) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await locator.screenshot({ path: join(outDir, file), timeout: WAIT });
      return;
    } catch (error) {
      console.log(`        screenshot ${file} not taken (attempt ${attempt}): ${firstLine(error)}`);
    }
  }
}

async function scan(page, selector, label) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  check(
    `axe ${label}: no serious finding`,
    serious.length === 0,
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join('; '),
  );
}

/* ------------------------------------------------------------------ the passes */

async function pass(browser, name, programs) {
  const p = `${name}:`;
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, reducedMotion: 'reduce' });
  const { page, errors } = await openPage(context);
  await writePrograms(page, programs);
  check(`${p} the simulator session starts with the real engine`, await simulatorReady(page));

  // 1. A written and closed file is in IndexedDB when the program halts.
  check(`${p} the writer program loads`, await openProgram(page, 'writer'));
  check(`${p} the writer program runs to its halt`, await runToHalt(page));
  check(`${p} task 56 succeeded`, ((await results68(page, 1))[0] & 0xffff) === 0);
  check(
    `${p} out.txt is in the browser store with the 10 bytes`,
    await untilStored(page, `${DIR}/out.txt`, 'HELLO FILE'),
    `${JSON.stringify(await storedText(page, `${DIR}/out.txt`))}`,
  );

  // 2. Liveness: another page writes input.txt; Rewind and Run read it.
  check(`${p} the reader program loads`, await openProgram(page, 'reader'));
  await runToHalt(page);
  check(`${p} without input.txt task 51 gives 2`, ((await results68(page, 1))[0] & 0xffff) === 2);
  const second = await openPage(context);
  await second.page.evaluate(
    (path) =>
      window.__easy68k.ctx.vfs.writeFile(
        path,
        Uint8Array.from('written by page two', (c) => c.charCodeAt(0)),
      ),
    `${DIR}/input.txt`,
  );
  // The first page hears of it through the browser store's broadcast (3.8.6).
  const heard = await until(
    page,
    async (path) => (await window.__easy68k.ctx.vfs.stat(path)) !== null,
    `${DIR}/input.txt`,
  );
  check(`${p} the first page's store hears of the file written by page two`, heard);
  let found = false;
  let shown = null;
  for (let attempt = 0; attempt < 20 && !found; attempt++) {
    // The cached view reads the broadcast file at once; Rewind and Run as the student would.
    await rewindAndRun(page);
    const [d0, d2] = await results68(page, 2);
    shown = { d0: d0 & 0xffff, d2, text: (await labelText(page, 'BUF', 40))?.slice(0, d2) ?? null };
    found = shown.d0 === 0 && shown.text === 'written by page two';
    if (!found) await page.waitForTimeout(100);
  }
  check(`${p} Rewind and Run read the file page two wrote, without a reload`, found, JSON.stringify(shown));
  reportErrors(`${p} page two:`, second.errors);
  await second.page.close();
  await page.evaluate(
    (path) =>
      window.__easy68k.ctx.vfs.writeFile(
        path,
        Uint8Array.from('saved as the editor saves', (c) => c.charCodeAt(0)),
      ),
    `${DIR}/input.txt`,
  );
  found = false;
  for (let attempt = 0; attempt < 20 && !found; attempt++) {
    await rewindAndRun(page);
    const [, d2] = await results68(page, 2);
    shown = (await labelText(page, 'BUF', 40))?.slice(0, d2) ?? null;
    found = shown === 'saved as the editor saves';
    if (!found) await page.waitForTimeout(100);
  }
  check(`${p} a save through the Vfs is read by the next Rewind and Run`, found, JSON.stringify(shown));

  // 3. Task 58.
  check(`${p} the dialog program loads`, await openProgram(page, 'dialog'));
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
  const openDialog = page.getByRole('dialog', { name: 'Pick a data file' });
  check(
    `${p} task 58 shows the file dialog with the program's title`,
    await openDialog.waitFor({ timeout: WAIT }).then(
      () => true,
      () => false,
    ),
  );
  check(
    `${p} the program waits (waitHost) and no command can be given (modal)`,
    await page.evaluate(
      () =>
        window.__easy68k.ctx.store.getState().sim.phase === 'waitHost' && window.__easy68k.ctx.dialogs.isModalOpen(),
    ),
  );
  check(
    `${p} the dialog offers the program's filter`,
    await page.evaluate(() => document.querySelector('.e68-filedialog')?.textContent?.includes('*.txt') ?? false),
  );
  await screenshot(page.locator('.e68-filedialog'), `${name}-task58-open.png`);
  await openDialog.getByRole('button', { name: 'Cancel' }).click();
  // The second dialog: type the name and press Open.
  const again = page.getByRole('dialog', { name: 'Pick a data file' });
  await until(page, () => window.__easy68k.ctx.store.getState().dialogs.stack.length === 2, undefined); // sim.fileDialog + file.open
  await again.getByLabel('File name:').fill('input.txt');
  await again.getByRole('button', { name: 'Open', exact: true }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save As' });
  check(
    `${p} the Save dialog appears with the default title "Save As"`,
    await saveDialog.waitFor({ timeout: WAIT }).then(
      () => true,
      () => false,
    ),
  );
  await screenshot(page.locator('.e68-filedialog'), `${name}-task58-save.png`);
  await saveDialog.getByLabel('File name:').fill('saved.txt');
  await saveDialog.getByRole('button', { name: 'Save', exact: true }).click();
  check(
    `${p} the dialog program halts`,
    await until(page, () => {
      const sim = window.__easy68k.ctx.store.getState().sim;
      return sim.phase === 'idle' && sim.halted;
    }),
  );
  const [cancelD1, okD1, openD0, saveD1, createD0] = await results68(page, 5);
  check(`${p} Cancel: D1 = 0`, cancelD1 === 0, `${cancelD1}`);
  check(`${p} Open: D1 = 1`, okD1 === 1, `${okD1}`);
  const path = await labelText(page, 'PATH', 256);
  check(`${p} the path at (A3) is the port's own`, path === `${DIR}/saved.txt`, `${path}`); // PATH holds the Save answer now
  check(`${p} task 51 opened the chosen file by its path`, (openD0 & 0xffff) === 0, `${openD0}`);
  check(
    `${p} Save: D1 = 1, and task 52 created the file`,
    saveD1 === 1 && (createD0 & 0xffff) === 0,
    `${saveD1} ${createD0}`,
  );
  check(`${p} saved.txt is in the browser store`, await untilStored(page, `${DIR}/saved.txt`, 'SAVED'));
  check(
    `${p} the current directory is the chosen file's folder`,
    (await page.evaluate(() => window.__easy68k.ctx.sim.files.currentDir)) === DIR,
  );

  // 4. Task 10 and the Printer Output dialog.
  await page.evaluate(() => {
    window.__printed = [];
    window.__easy68k.ctx.platform.print = async (html, title) => {
      window.__printed.push({ html, title });
    };
  });
  check(`${p} the printer program loads`, await openProgram(page, 'printer'));
  await runToHalt(page);
  const printer = page.getByRole('dialog', { name: 'Printer Output' });
  check(
    `${p} a form feed ends the job and the Printer Output dialog opens by itself`,
    await printer.waitFor({ timeout: WAIT }).then(
      () => true,
      () => false,
    ),
  );
  check(
    `${p} the dialog does not hold the program (modeless)`,
    await page.evaluate(() => !window.__easy68k.ctx.dialogs.isModalOpen()),
  );
  const preview = await page.evaluate(() => document.querySelector('.e68-printer-output__page')?.textContent ?? null);
  check(`${p} the dialog shows the page`, preview === 'HELLO PRINTER\nSECOND LINE', JSON.stringify(preview));
  await screenshot(printer, `${name}-printer-light.png`);
  await scan(page, '[role=dialog]', `${name} Printer Output, light`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await screenshot(printer, `${name}-printer-dark.png`);
  await scan(page, '[role=dialog]', `${name} Printer Output, dark`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'light'));
  await printer.getByRole('button', { name: 'Print...' }).click();
  const printed = await until(page, () => window.__printed.length === 1);
  const job = await page.evaluate(() => window.__printed[0] ?? null);
  check(
    `${p} Print... hands the job to Platform.print`,
    printed &&
      job.title === 'EASy68K printer output 1' &&
      job.html.includes('@page { size: 8.5in 11in') &&
      job.html.includes('left:1.0617in;top:1.0000in">H</span>'),
    job ? job.title : 'nothing printed',
  );
  check(
    `${p} the printed job leaves the list`,
    await until(page, () => document.querySelector('.e68-printer-output__empty') !== null),
  );
  await printer.locator('button.e68-button', { hasText: 'Close' }).click();
  await page.locator('.e68-shell__menubar [role=menuitem]', { hasText: /^File$/ }).click();
  await page
    .locator('[role=menu] [role^=menuitem]', { hasText: /Printer Setup/ })
    .first()
    .click();
  check(
    `${p} File > Printer Setup... opens the Printer Output dialog, modal`,
    await printer.waitFor({ timeout: WAIT }).then(
      () => page.evaluate(() => window.__easy68k.ctx.dialogs.isModalOpen()),
      () => false,
    ),
  );
  await page.keyboard.press('Escape');
  check(`${p} Escape closes it`, await until(page, () => !window.__easy68k.ctx.dialogs.isModalOpen()));

  // 5. Closing the tab with unwritten bytes.
  check(`${p} the pending program loads`, await openProgram(page, 'pending'));
  await runToHalt(page);
  check(`${p} the program left bytes unwritten`, await page.evaluate(() => window.__easy68k.ctx.sim.files.unsaved));
  reportErrors(`${p} first page:`, errors);
  await page.close(); // pagehide: exitNow()
  const next = await openPage(context, {
    initScript: () => {
      try {
        window.__journalAtStart = localStorage.getItem('easy68k.sim.journal.v1');
      } catch {
        window.__journalAtStart = null;
      }
    },
  });
  await simulatorReady(next.page);
  const kept = await untilStored(next.page, `${DIR}/left.txt`, 'NOT CLOSED');
  const journal = await next.page.evaluate(() => window.__journalAtStart);
  check(
    `${p} after closing the tab the unwritten bytes are in the file`,
    kept,
    `${JSON.stringify(await storedText(next.page, `${DIR}/left.txt`))}; journal at the start: ${journal ? 'yes' : 'no'}`,
  );
  check(
    `${p} the journal is empty after the start`,
    await until(next.page, () => localStorage.getItem('easy68k.sim.journal.v1') === null),
  );
  reportErrors(`${p} the page after the close:`, next.errors);
  // Leave the browser store as it was found.
  await next.page.evaluate(async (dir) => {
    const { vfs } = window.__easy68k.ctx;
    for (const entry of await vfs.list(dir)) await vfs.remove(`${dir}/${entry.name}`);
    await vfs.remove(dir).catch(() => {});
  }, DIR);
  await context.close();
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    cacheDir: join(outDir, 'vite-cache'),
    // No hot reload: other packages edit files while this runs.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  console.log(
    `System: ${process.platform} ${process.arch}, Node ${process.version}; engines: ${
      enginesBuilt ? 'engine/dist holds both engines' : 'engine/dist is missing'
    }; EASY68K_REQUIRE_ENGINES=${process.env.EASY68K_REQUIRE_ENGINES ?? '(not set)'}`,
  );
  try {
    if (!enginesBuilt) {
      if (process.env.EASY68K_REQUIRE_ENGINES === '1') {
        check('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', false, 'run npm run build:engines');
      } else console.log('  skipped: engine/dist is missing (npm run build:engines)');
    } else {
      const programs = await assemblePrograms();
      for (const name of browsers) {
        const browser = await BROWSERS[name].launch();
        try {
          console.log(`\n${name} ${browser.version()}`);
          await pass(browser, name, programs);
        } catch (error) {
          check(`${name}: the check ran to its end`, false, String(error?.stack ?? error));
        } finally {
          await browser.close();
        }
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
