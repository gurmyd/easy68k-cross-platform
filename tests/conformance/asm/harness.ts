// The comparison itself: one program of the corpus, one option set, through the WebAssembly
// assembler, against what the official EDIT68K.exe v5.16.1 produced (ARCHITECTURE.md 6.1 layer L2).
//
// The assembler is the application's own binding (`app/src/engine`), so what is tested is what the
// application runs. The input is the text the official editor handed to its assembler: for nearly
// every program that is what `editorLoad` computes from the source file, and the manifest's hash of
// the captured text proves it; where Wine's editor did something else, the captured text itself is
// in the golden folder and is used instead.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AsmEngine, AsmOptions, AsmResult } from '../../../app/src/contracts';
import { createAsmEngine } from '../../../app/src/engine';
import {
  REPO,
  goldenDirectory,
  programAvailable,
  readProgram,
  sha256Hex,
  type CorpusProgram,
  type ExpectedRun,
} from '../../corpus/index';
import { SHIPPED_OPTIONS } from '../../oracle/wine/asm/settings';
import { canonicalHashes, compareOutputs, createdOn, describeVerdict, editorLoad } from './compare';

/** True when the assembler engine is built (engine/dist is not in the repository). */
export const asmBuilt =
  existsSync(join(REPO, 'engine', 'dist', 'asm68k.wasm')) &&
  existsSync(join(REPO, 'engine', 'dist', 'asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
export const enginesRequired = process.env['EASY68K_REQUIRE_ENGINES'] === '1';

export type Verdict =
  /** Both files byte for byte, the date line included (or, for a run kept as hashes, hash for hash). */
  | 'identical'
  /** Equal after masking the statements with an undefined symbol (uninitialised memory in the original). */
  | 'identical-masked'
  | 'differs'
  /** The automation has no output of the official program for this run. */
  | 'no-oracle-result'
  /** The program's source is not on this machine (the `site` set before it is fetched). */
  | 'not-available';

export interface Outcome {
  id: string;
  label: string;
  verdict: Verdict;
  /** For `differs`: what differs. For the two "no comparison" verdicts: why. */
  detail?: string;
}

/** The time used for the `Created On:` line when no golden listing supplies one. */
const FIXED_TIME = new Date(2026, 10, 20, 12, 0, 0);

let engine: Promise<AsmEngine> | undefined;

function readGolden(directory: string, label: string, extension: string): Uint8Array | null {
  const path = join(directory, `${label}.${extension}`);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

function countsDiffer(run: ExpectedRun, result: AsmResult): string | null {
  if (run.errors !== null && run.errors !== result.errorCount) {
    return `error count: official ${run.errors}, ours ${result.errorCount}`;
  }
  if (run.warnings !== null && run.warnings !== result.warningCount) {
    return `warning count: official ${run.warnings}, ours ${result.warningCount}`;
  }
  return null;
}

/** Assembles `program` with the options of its run `label` and compares with the official result. */
export async function compareRun(program: CorpusProgram, label: string): Promise<Outcome> {
  const run = program.runs[label];
  const base = { id: program.id, label };
  if (!run) return { ...base, verdict: 'differs', detail: `the manifest has no run "${label}"` };
  if (run.status !== 'ok') return { ...base, verdict: 'no-oracle-result', detail: run.reason ?? 'unknown' };
  if (!programAvailable(program)) {
    return { ...base, verdict: 'not-available', detail: 'not on this machine: node tools/fetch-site-examples.mjs' };
  }

  const golden = goldenDirectory(program);
  const { mainName, files } = readProgram(program);
  const source = files.get(mainName) as Uint8Array;
  const load = editorLoad(source);
  const text = run.receivedFile ? readGolden(golden, label, 'received.txt') : load.text;
  if (text === null) return { ...base, verdict: 'differs', detail: `${label}.received.txt is missing in ${golden}` };
  if (sha256Hex(text) !== run.received) {
    return { ...base, verdict: 'differs', detail: 'the editor text is not the text the official assembler received' };
  }
  files.set(mainName, text);

  // The document's tab settings: Editor Options (the run's options), unless the file's trailer says otherwise.
  const options: AsmOptions = { ...SHIPPED_OPTIONS, ...run.options };
  if (load.tabType !== undefined) options.tabType = load.tabType;
  if (load.tabSize !== undefined) options.tabSize = load.tabSize;

  const goldenListing = run.golden ? readGolden(golden, label, 'L68') : null;
  const goldenSRecord = run.golden ? readGolden(golden, label, 'S68') : null;
  // With the official listing's own time the date line is compared too, not masked.
  const officialTime = goldenListing ? createdOn(goldenListing) : null;
  const time = officialTime ?? FIXED_TIME;

  engine ??= createAsmEngine();
  const result = await (await engine).assemble(mainName, files, options, time);
  if (result.fatal !== null)
    return { ...base, verdict: 'differs', detail: `the assembler ended abnormally: ${result.fatal}` };
  const counts = countsDiffer(run, result);
  if (counts) return { ...base, verdict: 'differs', detail: counts };

  const ours = { listing: result.listing, sRecord: result.sRecord };
  const hashes = canonicalHashes(ours);
  const hashesEqual = hashes.l68 === run.l68 && hashes.s68 === run.s68;

  if (run.golden) {
    if ((run.l68 !== null && goldenListing === null) || (run.s68 !== null && goldenSRecord === null)) {
      return { ...base, verdict: 'differs', detail: `the golden files of "${label}" are missing in ${golden}` };
    }
    const verdict = compareOutputs({ listing: goldenListing, sRecord: goldenSRecord }, ours);
    if (!verdict.equal) return { ...base, verdict: 'differs', detail: describeVerdict(verdict) };
    if (!hashesEqual)
      return { ...base, verdict: 'differs', detail: 'the golden files do not have the hashes of the manifest' };
    const same = (a: Uint8Array | null, b: Uint8Array | null): boolean =>
      a === null || b === null ? a === b : Buffer.compare(a, b) === 0;
    const exact = same(goldenListing, ours.listing) && same(goldenSRecord, ours.sRecord);
    if (!exact && !verdict.undefinedSymbols && officialTime !== null) {
      return { ...base, verdict: 'differs', detail: 'the date line differs (the format of "Created On:")' };
    }
    return { ...base, verdict: exact || !verdict.undefinedSymbols ? 'identical' : 'identical-masked' };
  }
  if (!hashesEqual) {
    return {
      ...base,
      verdict: 'differs',
      detail:
        `hash of the canonical output: .L68 ${hashes.l68 === run.l68 ? 'equal' : 'differs'}, ` +
        `.S68 ${hashes.s68 === run.s68 ? 'equal' : 'differs'} (the official files of this run are not in the repository)`,
    };
  }
  return { ...base, verdict: hashes.undefinedSymbols ? 'identical-masked' : 'identical' };
}

const outcomes: Outcome[] = [];

/** `compareRun`, with the outcome kept for the per-file report. */
export async function compareAndRecord(program: CorpusProgram, label: string): Promise<Outcome> {
  const outcome = await compareRun(program, label);
  outcomes.push(outcome);
  return outcome;
}

/**
 * Writes the per-file report of everything compared so far in this test file to
 * `build/reports/<name>.json` and returns its summary line.
 */
export function writeReport(name: string): string {
  const count = (verdict: Verdict): number => outcomes.filter((outcome) => outcome.verdict === verdict).length;
  const summary = {
    runs: outcomes.length,
    identical: count('identical'),
    identicalMasked: count('identical-masked'),
    differs: count('differs'),
    noOracleResult: count('no-oracle-result'),
    notAvailable: count('not-available'),
  };
  const path = join(REPO, 'build', 'reports', `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ summary, runs: outcomes }, null, 1)}\n`);
  return (
    `${summary.runs} runs compared with the official assembler: ${summary.identical} identical, ` +
    `${summary.identicalMasked} identical after masking undefined symbols, ${summary.differs} differ, ` +
    `${summary.noOracleResult} without an official result, ${summary.notAvailable} not on this machine ` +
    `(build/reports/${name}.json)`
  );
}
