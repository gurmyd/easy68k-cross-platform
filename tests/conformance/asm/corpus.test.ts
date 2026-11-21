// L2 of the test strategy (ARCHITECTURE.md 6.1): the WebAssembly assembler over the example corpus,
// compared file by file with what the official EDIT68K.exe v5.16.1 produced under Wine.
//
// One test per program and option set. The expected results are in tests/corpus/manifest.json
// (hashes for every run) and tests/conformance/asm/golden/ (the files, for the sets that may be
// redistributed). The `site` set is compared when tools/fetch-site-examples.mjs has fetched it and
// skipped otherwise. A per-file report is written to build/reports/asm-conformance-corpus.json.

import { afterAll, describe, expect, it } from 'vitest';
import { hasOfficialOutput, loadManifest, programAvailable, type CorpusSet } from '../../corpus/index';
import { asmBuilt, compareAndRecord, enginesRequired, writeReport } from './harness';
import { expectOutcome } from './known-differences';

const manifest = loadManifest();
const SETS: readonly CorpusSet[] = ['official', 'github-mit', 'site'];

describe('the corpus manifest', () => {
  it('lists the three example sets of 6.3', () => {
    const count = (set: CorpusSet): number => manifest.programs.filter((program) => program.set === set).length;
    // official 10; pacman-mc68000 24 + 68k-assembly-learning 18; site 134 (6.3).
    expect({ official: count('official'), github: count('github-mit'), site: count('site') }).toEqual({
      official: 10,
      github: 42,
      site: 134,
    });
  });

  it.runIf(enginesRequired && !asmBuilt)('engine/dist holds the assembler (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist/asm68k.wasm or asm68k-loader.mjs is missing: ' +
        'run `npm run build:engines` first. Without the variable the comparison is skipped.',
    );
  });
});

describe.skipIf(!asmBuilt)('the WebAssembly assembler against the official EASy68K v5.16.1 (needs engine/dist)', () => {
  for (const set of SETS) {
    describe(`set ${set}`, () => {
      for (const program of manifest.programs.filter((candidate) => candidate.set === set)) {
        for (const [label, run] of Object.entries(program.runs)) {
          const name = `${program.id} (${label})`;
          if (!hasOfficialOutput(run)) {
            it.skip(`${name} - no result of the official program: ${run.reason ?? 'unknown'}`, () => {});
            continue;
          }
          it.skipIf(!programAvailable(program))(
            name,
            async () => {
              expectOutcome(await compareAndRecord(program, label));
            },
            120_000,
          );
        }
      }
    });
  }

  afterAll(() => {
    console.log(writeReport('asm-conformance-corpus'));
  });
});
