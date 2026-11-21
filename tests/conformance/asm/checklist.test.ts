// The test checklist of docs/porting/assembler.md section 3.9 (ARCHITECTURE.md 6.4): one test per
// item, named after the item. An item is proved by the programs checklist/checklist.json names for
// it: each is assembled by the WebAssembly assembler with every option set it has and compared with
// the output of the official EDIT68K.exe v5.16.1 (tests/conformance/asm/golden/).
//
// The conformance programs no item names (further quirks, the RichEdit stress files) are compared
// in the last group. A per-file report is written to build/reports/asm-conformance-checklist.json.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadManifest, type CorpusProgram } from '../../corpus/index';
import { asmBuilt, compareAndRecord, writeReport, type Outcome } from './harness';
import { expectOutcome } from './known-differences';

interface Checklist {
  sections: { title: string; items: { item: string; programs: string[] }[] }[];
}

const checklist = JSON.parse(
  readFileSync(fileURLToPath(new URL('./checklist/checklist.json', import.meta.url)), 'utf8'),
) as Checklist;
const programs = loadManifest().programs.filter((program) => program.set === 'conformance');

/** `line-01` -> the checklist program whose folder starts with it; `richedit/x` -> that file. */
function resolve(reference: string): CorpusProgram {
  const matches = reference.startsWith('richedit/')
    ? programs.filter((program) => program.id === `${reference}.X68`)
    : programs.filter((program) => program.id.startsWith(`checklist/${reference}-`));
  if (matches.length !== 1) {
    throw new Error(`checklist.json names "${reference}", which matches ${matches.length} programs of the manifest`);
  }
  return matches[0] as CorpusProgram;
}

// A program proves several items; it is assembled once.
const cache = new Map<string, Promise<Outcome>>();
function compareOnce(program: CorpusProgram, label: string): Promise<Outcome> {
  const key = `${program.id}#${label}`;
  let outcome = cache.get(key);
  if (!outcome) {
    outcome = compareAndRecord(program, label);
    cache.set(key, outcome);
  }
  return outcome;
}

const runsOf = (program: CorpusProgram): [string, boolean][] =>
  Object.entries(program.runs).map(([label, run]) => [label, run.status === 'ok']);

async function compareProgram(program: CorpusProgram): Promise<void> {
  for (const [label, hasResult] of runsOf(program)) {
    if (hasResult) expectOutcome(await compareOnce(program, label));
  }
}

const named = new Set<string>();

describe('the checklist names programs that exist', () => {
  it('every reference of checklist.json resolves to one program of the manifest', () => {
    for (const section of checklist.sections) {
      for (const { item, programs: references } of section.items) {
        expect(references.length, item).toBeGreaterThan(0);
        for (const reference of references) expect(() => resolve(reference), `${item}: ${reference}`).not.toThrow();
      }
    }
  });
});

describe.skipIf(!asmBuilt)(
  'assembler §3.9 test checklist against the official EASy68K v5.16.1 (needs engine/dist)',
  () => {
    for (const section of checklist.sections) {
      describe(section.title, () => {
        for (const { item, programs: references } of section.items) {
          const proving = references.map(resolve);
          for (const program of proving) named.add(program.id);
          const withResult = proving.filter((program) => runsOf(program).some(([, hasResult]) => hasResult));
          if (withResult.length === 0) {
            it.skip(`${item} - the official program gave no result for any program of this item`, () => {});
            continue;
          }
          it(
            item,
            async () => {
              for (const program of proving) await compareProgram(program);
            },
            120_000,
          );
        }
      });
    }

    describe('conformance programs beyond the checklist', () => {
      // The groups above have run by now (Vitest collects in order), so `named` is complete.
      for (const program of programs.filter((candidate) => !named.has(candidate.id))) {
        const title = program.origin.replace(/^written for this project \([^)]*\)(: )?/, '');
        const name = title === '' ? program.id : `${program.id}: ${title}`;
        if (!runsOf(program).some(([, hasResult]) => hasResult)) {
          it.skip(`${name} - no result of the official program: ${Object.values(program.runs)[0]?.reason ?? 'unknown'}`, () => {});
          continue;
        }
        it(
          name,
          async () => {
            await compareProgram(program);
          },
          120_000,
        );
      }
    });

    afterAll(() => {
      console.log(writeReport('asm-conformance-checklist'));
    });
  },
);
