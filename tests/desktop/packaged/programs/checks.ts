// Checks 6, 7 and 8 of ARCHITECTURE.md 6.7, as steps on an application window that shows a
// program opened from a temporary folder. programs.spec.ts runs them in the packaged, fused and
// signed EASy68K.app; each returns every figure it measured and the list of what failed, so that
// a failure can be diagnosed from the CI log alone.
//
// Owner: DV5.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { compareOutputs, createdOn, describeVerdict } from '../../../conformance/asm/compare';
import { registerText } from '../facts';
import type { Expected, Example } from './expected';
import { firstByteDifference, firstDifference, latin1, surfaceHash } from './model';
import {
  assembleActive,
  cyclesShown,
  executeFromStatus,
  messageLines,
  outputCanvas,
  outputRows,
  pcField,
  poll,
  runToHalt,
  traceInto,
  waitForEditorDocument,
  type AssembleStatus,
} from './scenario';

export interface CheckResult {
  /** Every figure the check saw, for the log. */
  facts: Record<string, unknown>;
  /** What did not hold; empty when the check passed. */
  failures: string[];
}

const readIfThere = (path: string): Uint8Array | null => (existsSync(path) ? new Uint8Array(readFileSync(path)) : null);

/** Opened from the folder, assembled with the toolbar: the status dialog says 0 errors, 0 warnings. */
async function openAndAssemble(page: Page, name: Example, result: CheckResult): Promise<AssembleStatus> {
  result.facts.editorStatus = await waitForEditorDocument(page, `${name}.X68`);
  const status = await assembleActive(page);
  result.facts.assembleStatus = status;
  if (status.errors !== '0' || status.warnings !== '0' || !status.executeEnabled) {
    result.failures.push(
      `the status dialog says ${status.errors} errors, ${status.warnings} warnings, Execute ${status.executeEnabled ? 'enabled' : 'disabled'}`,
    );
  }
  return status;
}

/**
 * The .L68 and .S68 the app wrote into the program's folder equal the official files (but the
 * listing's date line, which carries the time of the run: it must be a date of today's run).
 */
async function filesEqualGoldens(
  folder: string,
  name: Example,
  expected: Expected,
  result: CheckResult,
  assembledAt: number,
): Promise<void> {
  const listingPath = join(folder, `${name}.L68`);
  const sRecordPath = join(folder, `${name}.S68`);
  const golden = expected.files[name];
  // The disk backend writes behind the page: wait until both files are there and complete.
  let verdict: ReturnType<typeof compareOutputs> | null = null;
  const settled = await poll(
    15_000,
    () => {
      const listing = readIfThere(listingPath);
      const sRecord = readIfThere(sRecordPath);
      if (!listing || !sRecord) return null;
      verdict = compareOutputs({ listing: golden.listing, sRecord: golden.sRecord }, { listing, sRecord });
      return verdict.equal ? { listing, sRecord } : null;
    },
    200,
  );
  const listing = readIfThere(listingPath);
  const sRecord = readIfThere(sRecordPath);
  result.facts.files = {
    folder,
    [`${name}.L68`]: listing
      ? `${listing.length} bytes, written ${(Date.now() - statSync(listingPath).mtimeMs) | 0} ms ago`
      : 'missing',
    [`${name}.S68`]: sRecord ? `${sRecord.length} bytes` : 'missing',
    'golden sizes': `${golden.listing.length} / ${golden.sRecord.length} bytes`,
  };
  if (!listing || !sRecord) {
    result.failures.push(
      `after 15 s the folder has ${listing ? '' : `no ${name}.L68 `}${sRecord ? '' : `no ${name}.S68`}`.trim(),
    );
    return;
  }
  if (settled === null) {
    result.failures.push(
      `${name}.L68 / ${name}.S68 differ from the official files:\n${verdict ? describeVerdict(verdict) : '?'}`,
    );
  }
  const date = createdOn(listing);
  const dateLine = latin1(listing).split('\r\n')[2] ?? '';
  result.facts.dateLine = dateLine;
  // The date line is the local time of the assembly, to the second (Created On: m/d/yyyy h:mm:ss AM).
  if (date === null || Math.abs(date.getTime() - assembledAt) > 10 * 60_000) {
    result.failures.push(`the listing's date line ${JSON.stringify(dateLine)} is not the time of this run`);
  }
}

/** Check 6: tutorial1.X68 opened from a temporary folder, assembled; .L68 and .S68 in that folder. */
export async function check6(page: Page, folder: string, expected: Expected): Promise<CheckResult> {
  const result: CheckResult = { facts: {}, failures: [] };
  const assembledAt = Date.now();
  await openAndAssemble(page, 'tutorial1', result);
  await filesEqualGoldens(folder, 'tutorial1', expected, result, assembledAt);
  return result;
}

/**
 * Check 7: Execute (from the status dialog of check 6), Run; the message area and the hash of the
 * output surface equal the headless harness's for the same program. `screenshot` stores a picture.
 */
export async function check7(
  page: Page,
  expected: Expected,
  screenshot: (label: string) => Promise<string | null>,
): Promise<CheckResult> {
  const result: CheckResult = { facts: {}, failures: [] };
  const want = expected.tutorial1Run;
  await executeFromStatus(page, 0x1000);
  result.facts.loaded = `PC ${await pcField(page).inputValue()}`;
  const ranAt = Date.now();
  // Halted with the Cycles count above zero: the program has run to its end (scenario.ts).
  const state = await runToHalt(page);
  const haltedAt = Date.now();
  result.facts.run = `${state} ${haltedAt - ranAt} ms after Run, ${await cyclesShown(page).catch(() => '?')} cycles`;
  if (state !== 'Halted') result.failures.push(`after Run the status bar says "${state}", not "Halted"`);

  // The message area.
  const messages = await poll(
    10_000,
    async () => {
      const shown = await messageLines(page);
      return firstDifference(want.messages, shown.lines) === null && shown.total === shown.lines.length ? shown : null;
    },
    200,
  );
  const shown = messages ?? (await messageLines(page));
  result.facts.messages = shown;
  result.facts.expectedMessages = want.messages;
  if (messages === null) {
    const hint = shown.lines.includes('Unable to open .L68 file.')
      ? ' (the simulator did not find the .L68 that check 6 saw in the folder: docs/porting/errata/DV5.md, defect D1)'
      : '';
    result.failures.push(
      `the message area differs from the headless run: ${firstDifference(want.messages, shown.lines) ?? `${shown.total} lines in the list, ${shown.lines.length} rendered`}${hint}`,
    );
  }

  // The output surface: the canvas shows the surface once per display frame, so wait for it.
  let last: { hash: string; width: number; height: number; shown: string } | null = null;
  const surface = await poll(
    20_000,
    async () => {
      const canvas = await outputCanvas(page);
      last = {
        hash: surfaceHash(canvas.width, canvas.height, canvas.rgba),
        width: canvas.width,
        height: canvas.height,
        shown: `${canvas.shownWidth} x ${canvas.shownHeight} CSS px`,
      };
      return last.hash === want.surfaceHash ? last : null;
    },
    250,
  );
  result.facts.surface = last;
  result.facts.expectedSurfaceHash = want.surfaceHash;
  if (surface === null) {
    result.failures.push(
      `the output surface's hash ${(last as { hash: string } | null)?.hash ?? '(none)'} is not the headless run's ${want.surfaceHash}`,
    );
  }
  // The text mirror follows the screen at most twice per second, in a display frame (2.11,
  // features/output/mirror.ts MIRROR_INTERVAL_MS), so it can lag the canvas by half a second and
  // more: wait for it too (errata DV5.md entry 14: read once, it was still empty on the faster
  // Apple Silicon runner although the canvas already showed every line).
  let rows: string[] = [];
  const mirrored = await poll(
    20_000,
    async () => {
      rows = await outputRows(page);
      return firstDifference(want.textRows, rows) === null ? rows : null;
    },
    100,
  );
  result.facts.outputRows = rows;
  result.facts.outputRowsShown = mirrored ? `${Date.now() - haltedAt} ms after the halt was seen` : 'not within 20 s';
  const rowsDiffer = firstDifference(want.textRows, rows);
  if (rowsDiffer !== null) result.failures.push(`the Output panel's text differs from the headless run: ${rowsDiffer}`);
  result.facts.screenshot = await screenshot('tutorial1-halted');
  return result;
}

/**
 * Check 8: fileio.X68 opened from a temporary folder, assembled, executed and traced instruction by
 * instruction: the file it writes is in the folder with the expected bytes as soon as TRAP #15
 * task 50 has closed it. (The program deletes the file with task 57 two instructions later; Run
 * then shows that too.)
 */
export async function check8(page: Page, folder: string, expected: Expected): Promise<CheckResult> {
  const result: CheckResult = { facts: {}, failures: [] };
  const want = expected.fileio;
  const file = join(folder, want.name);
  const assembledAt = Date.now();
  await openAndAssemble(page, 'fileio', result);
  await filesEqualGoldens(folder, 'fileio', expected, result, assembledAt);
  await executeFromStatus(page, 0x800);

  // Trace Into up to the TRAP #15 of task 50, noting what the folder holds after each step.
  const trace: string[] = [];
  let pc = await pcField(page).inputValue();
  for (let step = 0; step < 40 && pc !== registerText(want.closeTrap); step++) {
    pc = await traceInto(page, pc);
    const bytes = readIfThere(file);
    trace.push(`${pc}:${bytes ? bytes.length : '-'}`);
  }
  result.facts.trace = `PC:size of ${want.name} after each Trace Into: ${trace.join(' ')}`;
  if (pc !== registerText(want.closeTrap)) {
    result.failures.push(`Trace Into never reached the TRAP #15 of task 50 at ${registerText(want.closeTrap)}`);
    return result;
  }
  const beforeClose = readIfThere(file);
  result.facts.beforeClose = beforeClose ? JSON.stringify(latin1(beforeClose)) : 'no file';

  // The close: one more Trace Into executes the TRAP #15 of task 50.
  pc = await traceInto(page, pc);
  const closedAt = Date.now();
  if (pc !== registerText(want.afterClose)) {
    result.failures.push(`after the TRAP of task 50 the PC is ${pc}, not ${registerText(want.afterClose)}`);
  }
  const written = await poll(
    5000,
    () => {
      const bytes = readIfThere(file);
      return bytes && firstByteDifference(want.bytes, bytes) === null ? bytes : null;
    },
    20,
  );
  const elapsed = written ? Date.now() - closedAt : null;
  const seen = readIfThere(file);
  result.facts.afterClose = {
    file,
    bytes: seen ? JSON.stringify(latin1(seen)) : 'no file',
    expected: JSON.stringify(latin1(want.bytes)),
    msAfterThePcMoved: elapsed,
  };
  if (written === null || elapsed === null) {
    result.failures.push(
      `5 s after task 50 closed it, ${want.name} ${seen ? `differs: ${firstByteDifference(want.bytes, seen)}` : 'is not in the folder'}`,
    );
  } else if (elapsed > 1000) {
    // The PC field moves when the page has the engine's new state, after the close returned.
    result.failures.push(`${want.name} was complete only ${elapsed} ms after the close`);
  }

  // The rest of the program deletes the file (task 57), as the original does.
  const state = await runToHalt(page);
  const gone = await poll(5000, () => (existsSync(file) ? null : true), 50);
  result.facts.end = `${state}; ${want.name} ${gone ? 'deleted by task 57' : 'still there'}`;
  if (state !== 'Halted') result.failures.push(`after Run the status bar says "${state}", not "Halted"`);
  if (gone === null) result.failures.push(`${want.name} is still in the folder after task 57 deleted it`);
  return result;
}
