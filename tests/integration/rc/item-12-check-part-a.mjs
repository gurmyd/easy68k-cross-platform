// Release candidate, ARCHITECTURE.md 6.9 item 12 ("Manual: docs/MANUAL-TEST-MAC.md completed for
// the release candidate"). Owner: I3.
//
//   node tests/integration/rc/item-12-check-part-a.mjs [--browser chromium|webkit|all]
//        [--out <dir>] [--dist <dir>] [--keys mac|windows]
//
// The manual is done by a person on a real Mac; this script cannot do it and does not try. It
// checks that a person CAN follow the core of it (part A, and the three test programs the manual
// prints) in the application as it is: it goes through the steps with the macOS key map (default)
// in headless Chromium and WebKit, on the production build served locally, and compares what
// the manual says a person will see with what the application shows:
//
//   - the menus and menu entries the manual names (File > New X68 Source File, Help > Examples...,
//     Project > Assemble Source..., Edit > Paste, Options > Editor Options..., Run > Rewind Program,
//     Reload Program, Log Start, Log Stop, Search > Go to PC, Options > Log Output...) exist, with the
//     shortcuts drawn next to them printed (M2 names Shift+F2..F5);
//   - A1 step by step (Help > Examples..., double-click tutorial1.X68, F9, Execute, F9, the four
//     lines, `Halted`), each step judged as the manual words it;
//   - the examples the manual names are in the Examples folder;
//   - the three test programs, copied from the manual's own code blocks: each assembles without
//     errors; **echo** returns `You typed:   HELLO`; **keys** shows `A down: FF` while A is held and
//     `A down: 0` after; **fonts** prints `Sum: B4818F4C` (the manual's figure).
//
// What only a real Mac, a real Safari and a person can show (the browser's own shortcut handling,
// Fn keys, sound, VoiceOver, Gatekeeper, the downloaded app) stays with the person: see
// docs/MANUAL-TEST-MAC.md. The static completeness of the manual against 6.8 is
// item-12-manual-coverage.mjs (no browser).
//
// --dist takes an existing production build; without it the script builds app/ into <out>/dist.
// Screenshots go to <out> (default build/I3/item-12). Needs engine/dist (with
// EASY68K_REQUIRE_ENGINES=1 a missing engine fails). Exit code 0 = no check failed. About two
// minutes per browser.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSERS,
  repoRoot,
  Report,
  chooseMenu,
  clickOutput,
  dialog,
  enginesPresent,
  focusEditor,
  manualPrograms,
  menuEntries,
  mode,
  openPage,
  outputText,
  parseArgs,
  productionBuild,
  ready,
  replaceText,
  runState,
  serveBuild,
  tabs,
  treeItem,
  until,
  walkA1,
} from './item-07-12-lib.mjs';

const { browsers, keys, outDir, dist: givenDist } = parseArgs(join('I3', 'item-12'));
const report = new Report();

if (!enginesPresent()) {
  console.log('engine/dist is missing: the application cannot assemble or run; nothing is checked.');
  process.exit(process.env.EASY68K_REQUIRE_ENGINES === '1' ? 1 : 0);
}

const programs = manualPrograms();
const MANUAL_TEXT = readFileSync(join(repoRoot, 'docs', 'MANUAL-TEST-MAC.md'), 'utf8');
report.check(
  'the manual prints the three test programs echo, keys and fonts',
  ['echo', 'keys', 'fonts'].every((name) => programs[name]?.includes('END')),
  Object.keys(programs).join(', '),
);

/** Menu entries the manual names, per mode: [menu, caption]. */
const NAMED_ENTRIES = {
  editor: [
    ['File', 'New X68 Source File'],
    ['Help', 'Examples...'],
    ['Project', 'Assemble Source...'],
    ['Edit', 'Paste'],
    ['Options', 'Editor Options...'],
  ],
  simulator: [
    ['Run', 'Rewind Program'],
    ['Run', 'Reload Program'],
    ['Run', 'Log Start'],
    ['Run', 'Log Stop'],
    ['Search', 'Go to PC'],
    ['Options', 'Log Output...'],
    ['Help', 'Examples...'],
  ],
};

/** The examples the manual names (A2 K2, A5, B4 F3 and F4, C6). */
const NAMED_EXAMPLES = [
  'tutorial1.X68',
  'tutorial2.X68',
  'clockDigital.X68',
  'graphicSound.X68',
  'clockWithSound.X68',
  'mouseWindowSize.X68',
];

async function checkMenus(page, p, which) {
  for (const [title, caption] of NAMED_ENTRIES[which]) {
    let entry = null;
    let captions;
    try {
      const { entries } = await menuEntries(page, title);
      captions = entries.map((e) => e.caption);
      entry = entries.find((e) => e.caption === caption) ?? null;
    } catch (error) {
      captions = [String(error)];
    }
    await page.keyboard.press('Escape');
    report.check(
      `${p} ${which}: the menu entry ${title} > ${caption} exists`,
      entry !== null,
      entry ? `shortcut drawn: "${entry.shortcut}"` : `menu ${title} has: ${captions.join(', ')}`,
    );
  }
}

/** File > New X68 Source File, the program by Select All and a paste, F9, Execute (manual, "The three test programs"). */
async function assembleAndExecute(page, p, name, source, shot) {
  if ((await mode(page)) !== 'editor') {
    await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Editor', exact: true }).click();
    await until(async () => (await mode(page)) === 'editor', 10_000);
  }
  const before = (await tabs(page)).length;
  await chooseMenu(page, 'File', 'New X68 Source File');
  await until(async () => (await tabs(page)).length === before + 1, 10_000);
  await replaceText(page, keys, source);
  await focusEditor(page);
  await page.keyboard.press('F9');
  const active = (await tabs(page)).find((tab) => tab.selected)?.name ?? '';
  const status = dialog(page, `Assembler Status - ${active}`);
  const shown = await until(() => status.isVisible(), 90_000);
  const text = shown ? (await status.innerText()).replace(/\s+/g, ' ') : '';
  const ok = report.check(
    `${p} ${name}: the program copied from the manual assembles without errors`,
    Boolean(shown) && /Errors:\s*0\b/.test(text),
    text.slice(0, 120),
  );
  if (!ok) {
    await shot(`${name}-assembly`);
    if (shown) await status.getByRole('button', { name: 'Close', exact: true }).click();
    return false;
  }
  await status.getByRole('button', { name: 'Execute', exact: true }).click();
  await until(async () => (await mode(page)) === 'simulator', 30_000);
  await until(() => page.locator('[data-e68-panel="listing"] [role=option]').first().isVisible(), 30_000);
  // A message box after Execute (the original asks before it replaces a loaded program, for example)
  // would have to be in the manual: print it, answer it as a person would, and judge it.
  const box = page.locator('[role=dialog], [role=alertdialog]').last();
  if (await until(() => box.isVisible(), 2_000)) {
    const boxText = (await box.innerText()).replace(/\s+/g, ' ');
    await shot(`${name}-after-execute`);
    // The original's question when a program is still running or waiting (fidelity): a student who
    // runs the three programs one after the other meets it. It must be in the manual.
    const caution = /current debug environment will be lost/.test(boxText);
    report.check(
      `${p} ${name}: a box that appears after Execute is one the manual tells the reader about`,
      caution && MANUAL_TEXT.includes('debug environment will be lost'),
      boxText.slice(0, 200),
    );
    if (!caution) return false;
    await box.getByRole('button', { name: 'OK', exact: true }).click();
    await until(async () => !(await box.isVisible()), 10_000);
    await until(() => page.locator('[data-e68-panel="listing"] [role=option]').first().isVisible(), 30_000);
  }
  await page.keyboard.press('F9');
  return true;
}

const findLine = (pattern) => async (page) => (await outputText(page)).find((line) => pattern.test(line)) ?? null;

const dist = productionBuild(givenDist, outDir);
const server = await serveBuild(dist);
console.log(`Site: ${server.url} (build ${dist}), key map ${keys}\nScreenshots: ${outDir}`);

try {
  for (const name of browsers) {
    console.log(`\n[${name}, ${keys} key map]`);
    const browser = await BROWSERS[name].launch();
    try {
      const { context, page, errors } = await openPage(browser, { keys });
      const shot = (label) => page.screenshot({ path: join(outDir, `${name}-${label}.png`) });
      const p = `${name}:`;
      await page.goto(server.url);
      await ready(page);
      report.check(`${p} the application starts in Editor mode`, (await mode(page)) === 'editor');
      await checkMenus(page, p, 'editor');

      // --- A1 -----------------------------------------------------------------------------------
      await walkA1(page, report, `${p} `, shot);
      await checkMenus(page, p, 'simulator');

      // --- the examples the manual names --------------------------------------------------------
      await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Editor', exact: true }).click();
      await until(async () => (await mode(page)) === 'editor', 10_000);
      const missing = [];
      for (const file of NAMED_EXAMPLES)
        if (!(await until(() => treeItem(page, file).isVisible(), 5_000))) missing.push(file);
      report.check(
        `${p} the examples the manual names are in the Examples folder`,
        missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')}` : NAMED_EXAMPLES.join(', '),
      );

      // --- echo -----------------------------------------------------------------------------------
      if (await assembleAndExecute(page, p, 'echo', programs.echo, shot)) {
        const prompt = await until(() => findLine(/^Type a line:/)(page), 30_000);
        report.check(`${p} echo: F9 shows the prompt "Type a line: "`, Boolean(prompt), JSON.stringify(prompt));
        await clickOutput(page);
        for (const key of ['H', 'E', 'L', 'L', 'O']) await page.keyboard.press(`Shift+Key${key}`, { delay: 60 });
        await page.keyboard.press('Enter', { delay: 60 });
        const typed = await until(() => findLine(/^You typed:/)(page), 20_000);
        report.check(
          `${p} echo: after HELLO and Return the line is "You typed:   HELLO" (three spaces)`,
          typed === 'You typed:   HELLO',
          JSON.stringify(typed),
        );
        await shot('echo');
      }

      // --- keys -----------------------------------------------------------------------------------
      if (await assembleAndExecute(page, p, 'keys', programs.keys, shot)) {
        await until(() => findLine(/released\/pressed:/)(page), 20_000);
        await clickOutput(page);
        await page.keyboard.down('KeyA');
        const down = await until(async () => {
          const lines = (await outputText(page)).filter((line) => line.startsWith('released/pressed'));
          return lines.length && /A down: FF$/.test(lines.at(-1)) ? lines.at(-1) : null;
        }, 15_000);
        await page.keyboard.up('KeyA');
        const up = await until(async () => {
          const lines = (await outputText(page)).filter((line) => line.startsWith('released/pressed'));
          return lines.length && /A down: 0$/.test(lines.at(-1)) && /41/.test(lines.at(-1)) ? lines.at(-1) : null;
        }, 15_000);
        report.check(`${p} keys: while A is held the last line ends "A down: FF"`, Boolean(down), JSON.stringify(down));
        report.check(
          `${p} keys: after A is released it says "A down: 0" with $41 as the released code`,
          Boolean(up),
          JSON.stringify(up),
        );
        await shot('keys');
      }

      // --- fonts ----------------------------------------------------------------------------------
      if (await assembleAndExecute(page, p, 'fonts', programs.fonts, shot)) {
        const halted = await until(async () => (await runState(page)) === 'Halted', 120_000, 500);
        const sum = await until(() => findLine(/^Sum: /)(page), 15_000);
        report.check(
          `${p} fonts: it halts and prints "Sum: B4818F4C", the manual's figure`,
          Boolean(halted) && sum === 'Sum: B4818F4C',
          JSON.stringify(sum),
        );
        await shot('fonts');
      }

      report.check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
report.finish();
