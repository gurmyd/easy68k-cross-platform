// Checks 6, 7 and 8 of ARCHITECTURE.md 6.7, in the packaged, fused and ad-hoc signed EASy68K.app
// (release.yml, jobs mac-arm64 and mac-x64), with DV3's harness (../harness.ts: the app's own binary
// with --remote-debugging-port and a fresh --user-data-dir, attached over CDP):
//
//   6  tutorial1.X68 from a temporary folder (given on the command line, 5.7: Editor mode opens
//      it), assembled with the toolbar: tutorial1.L68 and tutorial1.S68 appear in that folder and
//      equal the official EASy68K v5.16.1 files (the listing but its date line)
//   7  Execute, Run: the message area and the hash of the output surface equal what the headless
//      harness of 6.4 computes for the same program in the same job; a screenshot is stored
//   8  fileio.X68 the same way, then Trace Into: the file it writes is on disk with the expected
//      bytes as soon as TRAP #15 task 50 has closed it
//
// The expected results are made in the same job by expected.ts (the real engines; compared with
// the committed goldens there). Every figure is printed. Screenshots and logs go to
// build/desktop-packaged/, which release.yml uploads.
//
// Owner: DV5.

import { copyFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { IS_MAC, launchPackaged, NOT_MAC, REPO, waitForApplication, type RunningApp } from '../harness';
import { check6, check7, check8, type CheckResult } from './checks';
import { expectedResults, type Example } from './expected';

/** A new temporary folder holding the shipped example's source; returns the folder and the file. */
function exampleInFreshFolder(name: Example): { folder: string; file: string } {
  // realpath: /var/folders/... is a link to /private/var/folders/...; the app names the real path.
  const folder = realpathSync(mkdtempSync(join(tmpdir(), `easy68k-${name}-`)));
  const file = join(folder, `${name}.X68`);
  copyFileSync(join(REPO, 'app', 'public', 'examples', `${name}.X68`), file);
  return { folder, file };
}

function report(check: string, result: CheckResult): void {
  console.log(`${check}: ${result.failures.length === 0 ? 'passed' : `${result.failures.length} failure(s)`}`);
  for (const [key, value] of Object.entries(result.facts)) console.log(`  ${key}: ${JSON.stringify(value)}`);
  for (const failure of result.failures) console.log(`  FAILED: ${failure}`);
}

test.describe('tutorial1.X68 (checks 6 and 7)', () => {
  test.describe.configure({ mode: 'serial' });
  let running: RunningApp | null = null;
  let check6Passed = false;

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await running?.close();
    running = null;
  });

  test('check 6: tutorial1.X68 opened from a temporary folder and assembled: .L68 and .S68 there equal the goldens', async () => {
    test.skip(!IS_MAC, NOT_MAC);
    test.setTimeout(300_000);
    const expected = await expectedResults();
    const { folder, file } = exampleInFreshFolder('tutorial1');
    running = await launchPackaged({ name: 'programs-tutorial1', file });
    await waitForApplication(running.page);
    await running.screenshot('opened');
    let result: CheckResult;
    try {
      result = await check6(running.page, folder, expected);
    } finally {
      console.log(`check 6 screenshot: ${await running.screenshot('assembled')}`);
    }
    report('check 6', result);
    expect(result.failures, 'check 6').toEqual([]);
    expect(running.errors, 'console errors of the page').toEqual([]);
    check6Passed = true;
  });

  test('check 7: Execute and Run: the message area and the surface hash equal the headless harness', async () => {
    test.skip(!IS_MAC, NOT_MAC);
    test.setTimeout(300_000);
    expect(check6Passed, 'check 7 executes what check 6 assembled').toBe(true);
    const expected = await expectedResults();
    const app = running as RunningApp;
    let result: CheckResult;
    try {
      result = await check7(app.page, expected, (label) => app.screenshot(label));
    } finally {
      console.log(`check 7 screenshot: ${await app.screenshot('end')}`);
    }
    report('check 7', result);
    expect(result.failures, 'check 7').toEqual([]);
    expect(app.errors, 'console errors of the page').toEqual([]);
  });
});

test.describe('fileio.X68 (check 8)', () => {
  let running: RunningApp | null = null;

  test.afterEach(async () => {
    test.setTimeout(120_000);
    await running?.close();
    running = null;
  });

  test('check 8: the file fileio.X68 writes is on disk with the expected bytes as soon as it is closed', async () => {
    test.skip(!IS_MAC, NOT_MAC);
    test.setTimeout(300_000);
    const expected = await expectedResults();
    const { folder, file } = exampleInFreshFolder('fileio');
    running = await launchPackaged({ name: 'programs-fileio', file });
    await waitForApplication(running.page);
    let result: CheckResult;
    try {
      result = await check8(running.page, folder, expected);
    } finally {
      console.log(`check 8 screenshot: ${await running.screenshot('end')}`);
    }
    report('check 8', result);
    expect(result.failures, 'check 8').toEqual([]);
    expect(running.errors, 'console errors of the page').toEqual([]);
  });
});
