// The application's own assembly path against the official EASy68K v5.16.1, over the corpus
// (ARCHITECTURE.md 6.3; 9.4 E5: "what the application writes is byte for byte what the official
// program writes").
//
// For every program of the tracked sets and every option set with an official result, the whole
// path a student's F9 takes runs here under Node:
//
//   the program's folder is written into the browser store (a memory backend at /browser),
//   the source is opened by the real document service (E1: load, trailer, tab model),
//   the Assembler Options of the run are set,
//   assembleDocument (4.9) collects the files from the file system (collect.ts), hands the editor
//   buffer to the real assembler engine and writes the .L68 and .S68 back into the store,
//
// and the two files read back from the store are compared with the official files in
// tests/conformance/asm/golden (or, for a run whose files are not in the repository, with the
// hashes of tests/corpus/manifest.json), with T1's comparison (tests/conformance/asm/compare.ts):
// byte for byte, except the statements with an undefined symbol, where the original encodes
// uninitialised memory. The text handed to the assembler is checked against the hash of the text
// the official editor handed to its own assembler. The status dialog's counts are checked against
// the listing's trailer.
//
// Needs engine/dist; skipped without it, failed without it under EASY68K_REQUIRE_ENGINES=1.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AsmEngine, AsmOptions, EditorSettings } from '../../contracts';
import { encodeForAssembler } from '../../core/documents/format';
import { createAsmEngine } from '../../engine';
import { MemoryBackend } from '../../fs/memory-backend';
import { createTestApplication } from '../../state/testing';
import { canonicalHashes, compareOutputs, createdOn, describeVerdict } from '../../../../tests/conformance/asm/compare';
import { listingOnLabel } from '../../../../tests/oracle/wine/asm/settings';
import {
  REPO,
  goldenDirectory,
  hasOfficialOutput,
  loadManifest,
  outputStem,
  programAvailable,
  readProgram,
  type CorpusProgram,
  type CorpusSet,
  type ExpectedRun,
} from '../../../../tests/corpus/index';
import { createDocumentService } from '../documents';
import { assembleDocument } from './assemble';
import { assembleDeps } from './index';
import { outputPaths } from './options';

const asmBuilt =
  existsSync(join(REPO, 'engine', 'dist', 'asm68k.wasm')) &&
  existsSync(join(REPO, 'engine', 'dist', 'asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** The sets of 9.4 E5 ("official and github"), and the tracked conformance programs as well. */
const SETS: readonly CorpusSet[] = ['official', 'github-mit', 'conformance'];

/** Where the port's assembler is known to differ from the official one (T1's list, owner engine/asm). */
const KNOWN_DIFFERENCES = new Set(
  (
    JSON.parse(readFileSync(join(REPO, 'tests', 'conformance', 'asm', 'known-differences.json'), 'utf8')) as {
      differences: { id: string }[];
    }
  ).differences.map((entry) => entry.id),
);

/** The Assembler Options of a run as Editor settings (the option names of the settings file). */
function editorPatch(options: Partial<AsmOptions>): Partial<EditorSettings> {
  const patch: Partial<EditorSettings> = {};
  if (options.generateListing !== undefined) patch.generateList = options.generateListing;
  if (options.generateSRecord !== undefined) patch.generateSRecord = options.generateSRecord;
  if (options.showWarnings !== undefined) patch.showWarnings = options.showWarnings;
  if (options.crossReference !== undefined) patch.crossReference = options.crossReference;
  if (options.macrosExpanded !== undefined) patch.macrosExpanded = options.macrosExpanded;
  if (options.structuredExpanded !== undefined) patch.structuredExpanded = options.structuredExpanded;
  if (options.constantsExpanded !== undefined) patch.constantsExpanded = options.constantsExpanded;
  if (options.bitFieldInstructions !== undefined) patch.assembleBitField = options.bitFieldInstructions;
  if (options.tabType !== undefined) patch.tabType = options.tabType;
  if (options.tabSize !== undefined) patch.fixedTabSize = options.tabSize;
  return patch;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const FIXED_TIME = new Date(2026, 10, 20, 12, 0, 0);

function readGolden(program: CorpusProgram, label: string, run: ExpectedRun, extension: string): Uint8Array | null {
  const path = join(goldenDirectory(program), `${outputStem(label, run)}.${extension}`);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

interface Tally {
  runs: number;
  identical: number;
  masked: number;
  skipped: string[];
}
const tally: Tally = { runs: 0, identical: 0, masked: 0, skipped: [] };

let engine: Promise<AsmEngine> | undefined;

/** One program, one option set, through the application's path; returns why it failed, or null. */
async function throughTheApplication(program: CorpusProgram, label: string, run: ExpectedRun): Promise<string | null> {
  const asm = await (engine ??= createAsmEngine());
  const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
  const app = createTestApplication({ services: { createDocumentService }, backends: [backend], asm });
  const ctx = app.ctx;
  ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, ...editorPatch(run.options) } }));

  // The program's folder in the browser store.
  const { mainName, files } = readProgram(program);
  const root = '/browser/corpus';
  for (const [key, data] of files) await ctx.vfs.writeFile(`${root}/${key}`, data);
  const mainPath = `${root}/${mainName}`;
  const doc = await ctx.documents.open(mainPath);
  if (!doc) return `the document service did not open ${mainPath}`;

  // The text the application hands to the assembler is the text the official editor handed over.
  const buffer = encodeForAssembler(ctx.documents.text(doc.id));
  if (run.received !== undefined && sha256(buffer) !== run.received) {
    if (run.receivedFile) {
      // Wine's RichEdit handed over another text than the editor's documented load (E1's corpus
      // test lists these files); the application hands over the documented one.
      tally.skipped.push(`${program.id} (${label}): the text received under Wine differs from the documented load`);
      tally.runs--;
      return null;
    }
    return 'the editor text differs from the text the official assembler received';
  }

  const goldenListing = run.golden ? readGolden(program, label, run, 'L68') : null;
  const goldenSRecord = run.golden ? readGolden(program, label, run, 'S68') : null;
  const time = (goldenListing ? createdOn(goldenListing) : null) ?? FIXED_TIME;
  const boxes: string[] = [];
  const outcome = await assembleDocument(
    {
      ...assembleDeps(ctx),
      clock: { now: () => 0, wallTime: () => time },
      messageBox: async (request) => {
        boxes.push(`${request.title}: ${request.text}`);
        return 'OK';
      },
    },
    doc.id,
  );
  if (outcome.kind !== 'done') return `the assembly ended with "${outcome.kind}"`;
  if (boxes.length > 0) return `message boxes: ${boxes.join(' | ')}`;
  if (run.errors !== null && outcome.status.errors !== run.errors) {
    return `Errors: official ${run.errors}, the status dialog ${outcome.status.errors}`;
  }
  if (run.warnings !== null && outcome.status.warnings !== run.warnings) {
    return `Warnings: official ${run.warnings}, the status dialog ${outcome.status.warnings}`;
  }

  // What the application wrote, read back from the store.
  const outputs = outputPaths(mainPath);
  const readBack = async (path: string) => ((await ctx.vfs.stat(path)) ? ctx.vfs.readFile(path) : null);
  const ours = { listing: await readBack(outputs.listing), sRecord: await readBack(outputs.sRecord) };

  // A run without a listing (Generate Listing off) masks by the official listing of the same options
  // with the listing on (T1 erratum 20).
  const companion = listingOnLabel(run.options);
  const companionRun = companion === null ? undefined : program.runs[companion];
  const maskingListing =
    ours.listing === null && companion !== null && companionRun?.golden
      ? readGolden(program, companion, companionRun, 'L68')
      : null;
  if (run.golden) {
    if ((run.l68 !== null && goldenListing === null) || (run.s68 !== null && goldenSRecord === null)) {
      return 'golden files missing';
    }
    const verdict = compareOutputs({ listing: goldenListing, sRecord: goldenSRecord, maskingListing }, ours);
    if (!verdict.equal) return describeVerdict(verdict);
    const same = (a: Uint8Array | null, b: Uint8Array | null) =>
      a === null || b === null ? a === b : Buffer.compare(a, b) === 0;
    const exact = same(goldenListing, ours.listing) && same(goldenSRecord, ours.sRecord);
    if (!exact && !verdict.undefinedSymbols) return 'the files differ outside the masked statements (the date line?)';
    if (exact) tally.identical++;
    else tally.masked++;
    return null;
  }
  const hashes = canonicalHashes({ ...ours, maskingListing });
  if (hashes.l68 !== run.l68 || hashes.s68 !== run.s68) return 'the canonical hashes differ from the manifest';
  if (hashes.undefinedSymbols) tally.masked++;
  else tally.identical++;
  return null;
}

const manifest = loadManifest();

describe('engine/dist', () => {
  it.runIf(enginesRequired && !asmBuilt)('holds the assembler (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist/asm68k.wasm or asm68k-loader.mjs is missing: ' +
        'run `npm run build:engines` first. Without the variable the corpus run is skipped.',
    );
  });
});

describe.skipIf(!asmBuilt)('the corpus through F9 of the application (needs engine/dist)', () => {
  for (const set of SETS) {
    const programs = manifest.programs.filter((program) => program.set === set);
    it(`set ${set}: every run with an official result gives the official .L68 and .S68`, async () => {
      const failures: string[] = [];
      let runs = 0;
      for (const program of programs) {
        for (const [label, run] of Object.entries(program.runs)) {
          const name = `${program.id} (${label})`;
          if (!hasOfficialOutput(run)) {
            tally.skipped.push(`${name}: no official result`);
            continue;
          }
          if (!programAvailable(program)) {
            failures.push(`${name}: the source is missing`);
            continue;
          }
          if (KNOWN_DIFFERENCES.has(program.id)) {
            tally.skipped.push(`${name}: a known difference of the assembler engine`);
            continue;
          }
          runs++;
          tally.runs++;
          const failure = await throughTheApplication(program, label, run);
          if (failure !== null) failures.push(`${name}: ${failure}`);
        }
      }
      expect(failures).toEqual([]);
      // Exact: the default runs and the eight single-option runs of tests/corpus/option-subset.json
      // (T1 errata 20 and 21). A run that vanishes from the manifest, or loses its official result,
      // fails here; a run added on purpose changes these numbers with it.
      if (set === 'official') expect(runs).toBe(68);
      if (set === 'github-mit') expect(runs).toBe(146);
    }, 600_000);
  }

  afterAll(() => {
    console.log(
      `E5 corpus: ${tally.runs} runs through the application: ${tally.identical} byte for byte, ` +
        `${tally.masked} equal after masking undefined symbols; ${tally.skipped.length} skipped`,
    );
    for (const line of tally.skipped) console.log(`  skipped: ${line}`);
  });
});
