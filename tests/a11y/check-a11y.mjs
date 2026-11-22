// The accessibility and keyboard audit of the application (ARCHITECTURE.md 2.9-2.11, 9.6 Q1).
// Owner: Q1.
//
//   node tests/a11y/check-a11y.mjs [--browser chromium|webkit|all] [--out <dir>]
//        [--only scan,structure,contrast,walk-edit,walk-run]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit through Playwright. Parts:
//
//   scan       axe-core (WCAG 2.0 and 2.1, A and AA) over every mode and every dialog, in the light
//              and the dark theme; the dialog rules of 2.11 for each dialog (lib/scan.mjs)
//   structure  the other rules of 2.11: menu bar and menus by keyboard, toolbars, panels as named
//              regions, the tool tabs, live regions, register labels, the Output canvas and its
//              text mirror, a visible focus on every tab stop, breakpoints not by colour alone,
//              reduced motion (lib/structure.mjs)
//   contrast   the contrast of the original's own colours (syntax colours, listing gutter,
//              Hardware panel) and of the dark Auto palette, with the numbers (lib/contrast-part.mjs)
//   walk-edit  keyboard-only walk-through "edit, assemble, fix an error" (lib/walk.mjs)
//   walk-run   keyboard-only walk-through "run, answer input, leave the Output panel with the
//              release chord, set a breakpoint, step" (lib/walk.mjs)
//
// The walk-throughs run on the Windows key map and on the macOS key map in both browsers; the
// chords come from the application's own table (chordsOn() of app/src/commands/specs.ts). On the
// macOS key map Tab outside modal dialogs moves only between the stops Safari's default setting
// allows (lib/keys.mjs isSafariTabStop), so that the result is the same on every system.
//
// Findings: serious and critical axe findings fail the check unless they are a known defect
// entered in docs/integration/rc.md (lib/findings.mjs KNOWN) or text in a colour of the original
// (docs/differences/Q1.md). Prints "N of M checks passed"; the exit code is 0 only if every check
// passed. Screenshots go to build/Q1/a11y-check (git-ignored).
//
// Needs engine/dist for the simulator parts; without it they are skipped with a note, unless
// EASY68K_REQUIRE_ENGINES=1 (CI), where a missing engine fails the check.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { enginesPresent as hasEngines, startServer } from './lib/app.mjs';
import { contrastPart } from './lib/contrast-part.mjs';
import { KNOWN, KNOWN_CHECKS, unusedKnown } from './lib/findings.mjs';
import { createReport } from './lib/report.mjs';
import { ROUTED_DIALOGS, scanPart } from './lib/scan.mjs';
import { structurePart } from './lib/structure.mjs';
import { walkEdit, walkRun } from './lib/walk.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const appRoot = join(repoRoot, 'app');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'Q1', 'a11y-check')));
const PARTS = ['scan', 'structure', 'contrast', 'walk-edit', 'walk-run'];
const only = option('--only', PARTS.join(','))
  .split(',')
  .filter((part) => part !== '');
for (const part of only) {
  if (!PARTS.includes(part)) {
    console.error(`Unknown part "${part}"; the parts are ${PARTS.join(', ')}`);
    process.exit(2);
  }
}
const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];
if (!browsers.every((name) => name in BROWSERS)) {
  console.error(`--browser takes chromium, webkit or all, not "${browserChoice}"`);
  process.exit(2);
}
/** The key map each browser's scan runs with (the walk-throughs take both). */
const SCAN_OS = { chromium: 'windows', webkit: 'mac' };

const enginesPresent = hasEngines(repoRoot);
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

async function main() {
  if (!enginesPresent && enginesRequired) {
    console.error('engine/dist is missing and EASY68K_REQUIRE_ENGINES=1: the simulator cannot start.');
    process.exit(1);
  }
  const report = createReport({ knownChecks: KNOWN_CHECKS });
  const { baseUrl, stop } = await startServer({ appRoot, outDir });
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}\nRunner: ${process.platform}`);
  if (!enginesPresent) console.log('engine/dist is missing: the simulator parts are skipped.');
  const findings = [];
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      console.log(`\n=== ${name} ${browser.version()}`);
      const common = { browser, name, baseUrl, report, outDir, enginesPresent };
      // A part that throws is one failure; the parts after it still run.
      const part = async (label, body) => {
        try {
          await body();
        } catch (error) {
          report.check(
            `${name}: ${label} ran to the end`,
            false,
            String(error?.stack ?? error)
              .split('\n')
              .slice(0, 5)
              .join(' | '),
          );
        }
      };
      try {
        if (only.includes('scan')) {
          await part('scan', async () => {
            const result = await scanPart({ ...common, os: SCAN_OS[name] });
            findings.push(...result.findings);
            const unrouted = result.registered.filter((id) => !ROUTED_DIALOGS.includes(id));
            report.check(
              `${name}: every dialog the features register has a route in the audit`,
              unrouted.length === 0,
              unrouted.join(', '),
            );
            const missed = result.registered.filter((id) => !result.covered.has(id));
            report.check(
              `${name}: every registered dialog was scanned (${result.registered.length})`,
              missed.length === 0,
              missed.join(', '),
            );
          });
        }
        if (only.includes('structure')) {
          for (const os of ['windows', 'mac']) await part(`structure (${os})`, () => structurePart({ ...common, os }));
        }
        if (only.includes('contrast')) await part('contrast', () => contrastPart(common));
        for (const os of ['windows', 'mac']) {
          if (only.includes('walk-edit')) await part(`walk-edit (${os})`, () => walkEdit({ ...common, os }));
          if (only.includes('walk-run')) {
            if (enginesPresent) await part(`walk-run (${os})`, () => walkRun({ ...common, os }));
            else report.note(`${name}/${os}: walk-run skipped, engine/dist is missing`);
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await stop();
  }
  if (only.includes('scan') && findings.length > 0) {
    for (const entry of unusedKnown(findings, KNOWN)) {
      report.note(
        `known defect ${entry.id} (${entry.owner}) was not seen in this run: repaired? Remove it from lib/findings.mjs`,
      );
    }
  }
  if (report.notes.length > 0)
    console.log(`\nNotes (not failures):\n${report.notes.map((text) => `  - ${text}`).join('\n')}`);
  console.log(`\n${report.summary()}`);
  process.exit(report.failures ? 1 : 0);
}

await main();
