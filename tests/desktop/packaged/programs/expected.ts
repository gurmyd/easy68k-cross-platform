// The expected results of checks 6-8 (ARCHITECTURE.md 6.7), made in the same job as the checks:
//
//   1. tutorial1.X68 and fileio.X68, the official examples the app ships (app/public/examples),
//      are assembled by the real assembler engine (engine/dist) exactly as the official editor
//      hands them to its assembler: `editorLoad` of the assembler conformance suite (trailer lines
//      removed, CR LF), the options of a fresh installation (SHIPPED_OPTIONS) with the file's own
//      tab settings, and the time of the official listing's date line. The result must equal the
//      official EASy68K v5.16.1 output committed in tests/conformance/asm/golden/official byte
//      for byte; nothing is committed by this package.
//   2. The headless harness of 6.4 (tests/conformance/sim/harness.ts) runs tutorial1.S68 with the
//      application's own glyphs and default simulator settings: its message lines, the hash of
//      its surface and its text rows are what the packaged app must show after Execute and Run.
//   3. What fileio.X68 writes into test1.txt is read off its S-record file and listing: the bytes
//      at the label `data`, `datasize` of them; and where its PC is right after task 50 closes
//      the file (the program deletes the file with task 57 right after that).
//
// Everything is written below build/desktop-packaged/programs/ for the log and the uploaded
// artifact. `expectedResults()` does the work once per process.
//
// Owner: DV5.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AsmOptions } from '../../../../app/src/contracts';
import { DEFAULT_SIM_SETTINGS } from '../../../../app/src/core/settings/defaults';
import { createAsmEngine } from '../../../../app/src/engine/index';
import { compareOutputs, createdOn, describeVerdict, editorLoad } from '../../../conformance/asm/compare';
import { runScenario, type Outcome } from '../../../conformance/sim/harness';
import { SHIPPED_OPTIONS } from '../../../oracle/wine/asm/settings';
import { OUT_DIR, REPO } from '../harness';
import { addressAfterTask, bytesAt, latin1, loadSRecords, symbolValue, trimmedRows } from './model';

export const PROGRAMS_DIR = join(OUT_DIR, 'programs');
/** The official examples the checks open. */
export const EXAMPLES = ['tutorial1', 'fileio'] as const;
export type Example = (typeof EXAMPLES)[number];

export interface ExpectedFiles {
  /** The source as shipped in the app (app/public/examples/<name>.X68). */
  source: Uint8Array;
  /** The official EASy68K v5.16.1 .L68 and .S68 (default options), which the engine reproduced. */
  listing: Uint8Array;
  sRecord: Uint8Array;
}

export interface ExpectedRun {
  /** The message area at the end of the run, line by line. */
  messages: string[];
  /** SHA-256 of `<w>x<h>:` and the surface's pixels (harness.ts `collect`). */
  surfaceHash: string;
  /** The text grid at the end, trailing blanks and blank rows removed. */
  textRows: string[];
  end: Outcome['end'];
}

export interface ExpectedFileio {
  /** The file the program writes and closes. */
  name: string;
  bytes: Uint8Array;
  /** The address of the TRAP #15 of task 50 and of the instruction after it. */
  closeTrap: number;
  afterClose: number;
}

export interface Expected {
  files: Record<Example, ExpectedFiles>;
  tutorial1Run: ExpectedRun;
  fileio: ExpectedFileio;
}

const GOLDEN = join(REPO, 'tests', 'conformance', 'asm', 'golden', 'official');

const readBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

/** Assembles one shipped example as the official editor does and checks it against the golden. */
async function reproduceOfficial(name: Example): Promise<ExpectedFiles> {
  const source = readBytes(join(REPO, 'app', 'public', 'examples', `${name}.X68`));
  const goldenListing = readBytes(join(GOLDEN, `${name}.X68`, 'default.L68'));
  const goldenSRecord = readBytes(join(GOLDEN, `${name}.X68`, 'default.S68'));
  const load = editorLoad(source);
  const options: AsmOptions = { ...SHIPPED_OPTIONS };
  if (load.tabType !== undefined) options.tabType = load.tabType;
  if (load.tabSize !== undefined) options.tabSize = load.tabSize;
  const time = createdOn(goldenListing);
  if (time === null) throw new Error(`${name}: the official listing has no date line`);
  const main = `${name}.X68`;
  const result = await (await createAsmEngine()).assemble(main, new Map([[main, load.text]]), options, time);
  if (result.fatal !== null) throw new Error(`${main}: ${result.fatal}`);
  if (result.errorCount !== 0 || !result.listing || !result.sRecord) {
    throw new Error(`${main}: ${result.errorCount} error(s): ${result.messages.map((m) => m.text).join('; ')}`);
  }
  const ours = { listing: result.listing, sRecord: result.sRecord };
  const verdict = compareOutputs({ listing: goldenListing, sRecord: goldenSRecord }, ours);
  const exact =
    Buffer.compare(Buffer.from(goldenListing), Buffer.from(result.listing)) === 0 &&
    Buffer.compare(Buffer.from(goldenSRecord), Buffer.from(result.sRecord)) === 0;
  if (!verdict.equal || !exact) {
    throw new Error(
      `${main}: the real assembler does not reproduce the official output (tests/conformance/asm/golden):\n` +
        describeVerdict(verdict),
    );
  }
  writeFileSync(join(PROGRAMS_DIR, `${name}.X68`), source);
  writeFileSync(join(PROGRAMS_DIR, `${name}.L68`), result.listing);
  writeFileSync(join(PROGRAMS_DIR, `${name}.S68`), result.sRecord);
  return { source, listing: result.listing, sRecord: result.sRecord };
}

/** tutorial1 in the headless harness, as the app's Execute and Run would run it. */
async function headlessTutorial1(files: ExpectedFiles): Promise<ExpectedRun> {
  const outcome = await runScenario({
    program: { stem: 'tutorial1', s68: files.sRecord, l68: files.listing, files: {} },
    recipe: { kind: 'report' },
    // The app draws with its own glyphs (app/public/fonts), not the Wine cells of the oracle runs.
    metrics: 'windows',
    settings: {
      autoTraceIntervalMs: DEFAULT_SIM_SETTINGS.autoTraceIntervalMs,
      disableDisplay: DEFAULT_SIM_SETTINGS.disableDisplay,
    },
    timeLimitMs: 30_000,
  });
  if (outcome.reports.length > 0) throw new Error(`the headless run reported: ${outcome.reports.join('; ')}`);
  return {
    messages: [...outcome.messages],
    surfaceHash: outcome.surfaceHash,
    textRows: trimmedRows(outcome.textRows),
    end: outcome.end,
  };
}

/** What fileio.X68 writes, from its own S-records and listing. */
function fileioFacts(files: ExpectedFiles): ExpectedFileio {
  const listing = latin1(files.listing);
  const memory = loadSRecords(latin1(files.sRecord));
  const data = symbolValue(listing, 'data');
  const size = symbolValue(listing, 'datasize');
  const name = symbolValue(listing, 'filename');
  if (data === null || size === null || name === null) {
    throw new Error('fileio.L68 has no symbols data, datasize and filename');
  }
  let fileName = '';
  for (let address = name; memory.get(address) !== 0; address++) {
    const byte = memory.get(address);
    if (byte === undefined) throw new Error('the file name of fileio.X68 has no terminating zero');
    fileName += String.fromCharCode(byte);
  }
  const close = addressAfterTask(listing, 50);
  if (close === null) throw new Error('fileio.L68 has no MOVE #50,D0 followed by TRAP #15');
  return { name: fileName, bytes: bytesAt(memory, data, size), closeTrap: close.trap, afterClose: close.after };
}

let made: Promise<Expected> | null = null;

/** Makes (once per process) and returns the expected results; writes them for the log. */
export function expectedResults(): Promise<Expected> {
  made ??= (async () => {
    mkdirSync(PROGRAMS_DIR, { recursive: true });
    const tutorial1 = await reproduceOfficial('tutorial1');
    const fileio = await reproduceOfficial('fileio');
    const expected: Expected = {
      files: { tutorial1, fileio },
      tutorial1Run: await headlessTutorial1(tutorial1),
      fileio: fileioFacts(fileio),
    };
    const summary = {
      tutorial1Run: expected.tutorial1Run,
      fileio: { ...expected.fileio, bytes: latin1(expected.fileio.bytes) },
    };
    writeFileSync(join(PROGRAMS_DIR, 'expected.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return expected;
  })();
  return made;
}
