// The simulator conformance suite (ARCHITECTURE.md 6.1 layer L4, 6.4): every program of
// tests/conformance/sim is assembled with the port's assembler and run in the port's simulator by the
// headless harness, the way the Wine oracle ran it in the official SIM68K.exe, and what it produced
// (result.bin, the execution log, the output log) is compared byte for byte with the official
// result in golden/ (masked dates only).
//
// A difference fails the test unless known-differences.json lists it with an owner; a listed
// difference that no longer occurs fails too, so that the list stays true. For an artifact of
// programs.ts ARTIFACT_MASKS the entry covers only the masked bytes: the rest must be equal. Owner: T3.
//
//   npx vitest run --config tests/conformance/sim/vitest.config.ts
//   EASY68K_SIM_ONLY=trap15-a      only programs whose id contains the text
//   EASY68K_SIM_REPORT=1           also write MISMATCHES.md (formatted by Prettier); without it, a
//                                  whole run checks that the committed file is what it would write
//   EASY68K_SIM_REPORT_JSON=<path> also write the mismatches as data (owner, program, official and
//                                  port lines; compare.ts mismatchRecords)
//   EASY68K_CONFORMANCE_PARTS=doubles  ProgramFiles and LogService doubles (doubles.ts) instead of
//                                      the classes at their final paths (the default)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  differingLines,
  firstDifference,
  mismatchRecords,
  OWNERS,
  renderMismatchReport,
  type KnownDifferences,
  type Mismatch,
} from './compare';
import { NOT_MODELLED_BY_DOUBLES } from './doubles';
import { assembleConformance, partsMode, runScenario, type AssembledConformance } from './harness';
import {
  ARTIFACT_MASKS,
  GOLDEN_DIR,
  SIM_CONFORMANCE_DIR,
  artifactKey,
  artifactsOf,
  listPrograms,
  loadGoldenManifest,
  maskArtifact,
  maskListing,
  recipeId,
  sha256Hex,
  type ConformanceProgram,
} from './programs';

const dist = (file: string) => fileURLToPath(new URL(`../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const KNOWN_PATH = join(SIM_CONFORMANCE_DIR, 'known-differences.json');
const REPORT_PATH = join(SIM_CONFORMANCE_DIR, 'MISMATCHES.md');
const known: KnownDifferences = existsSync(KNOWN_PATH)
  ? (JSON.parse(readFileSync(KNOWN_PATH, 'utf8')) as KnownDifferences)
  : {};
const manifest = loadGoldenManifest();
const only = process.env.EASY68K_SIM_ONLY;
const programs = listPrograms().filter((p) => !only || p.id.includes(only));

function golden(name: string): Uint8Array | null {
  const gz = name.endsWith('.RunLog.txt');
  const path = join(GOLDEN_DIR, name + (gz ? '.gz' : ''));
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return new Uint8Array(gz ? gunzipSync(bytes) : bytes);
}

const mismatches: Mismatch[] = [];
const seen = new Set<string>();
const skipped: string[] = [];
/** Listed differences that are equal once the bytes of ARTIFACT_MASKS are masked. */
const maskedEqual: { key: string; known: KnownDifferences[string] | null; masked: string }[] = [];
let compared = 0;
let equal = 0;

describe('known-differences.json', () => {
  it('names only programs, recipes and artifacts that exist, each with an owner and a cause', () => {
    const all = new Map(listPrograms().map((p) => [p.id, p]));
    for (const [key, entry] of Object.entries(known)) {
      const [id, recipe, kind] = key.split('|');
      const program = all.get(id ?? '');
      expect(program, key).toBeDefined();
      expect(
        artifactsOf(program as ConformanceProgram).some((a) => a.recipe === recipe && a.kind === kind),
        key,
      ).toBe(true);
      // The engine or a host package: the party that acts on it (compare.ts OWNERS).
      expect(Object.keys(OWNERS), key).toContain(entry.owner);
      expect(entry.summary.length, key).toBeGreaterThan(10);
    }
  });

  it('lists every artifact whose bytes the comparison masks (programs.ts ARTIFACT_MASKS)', () => {
    expect(Object.keys(ARTIFACT_MASKS).filter((key) => !known[key])).toEqual([]);
  });
});

describe.skipIf(!enginesBuilt || manifest === null)(
  'the port against the official SIM68K.exe (needs engine/dist)',
  () => {
    const assembled = new Map<string, AssembledConformance>();

    beforeAll(async () => {
      for (const program of programs) assembled.set(program.id, await assembleConformance(program));
    }, 600_000);

    it('every program assembles to the S-record file of the official assembler', () => {
      const differing: string[] = [];
      for (const program of programs) {
        const record = manifest?.programs[program.id];
        if (!record?.s68Sha256) continue;
        const mine = assembled.get(program.id) as AssembledConformance;
        if (sha256Hex(mine.s68) !== record.s68Sha256) differing.push(`${program.id}.S68`);
        if (record.l68Sha256 && sha256Hex(maskListing(mine.l68)) !== record.l68Sha256)
          differing.push(`${program.id}.L68`);
      }
      expect(differing).toEqual([]);
    });

    for (const program of programs) {
      it(
        program.id,
        async () => {
          const record = manifest?.programs[program.id];
          const unknown: string[] = [];
          for (const recipe of program.recipes) {
            const artifacts = artifactsOf(program).filter((a) => a.recipe === recipeId(recipe));
            const entry = record?.recipes[recipeId(recipe)];
            if (entry?.status !== 'ok' || (partsMode({}) === 'doubles' && NOT_MODELLED_BY_DOUBLES[program.id])) {
              skipped.push(`${program.id}:${recipeId(recipe)}`);
              continue;
            }
            const outcome = await runScenario({
              program: assembled.get(program.id) as AssembledConformance,
              recipe,
              exceptions: program.switches.some((s) => s.toLowerCase() === '/e'),
              bitField: program.switches.some((s) => s.toLowerCase() === '/b'),
            });
            expect(outcome.reports, `${program.id}: failures of the session`).toEqual([]);
            for (const artifact of artifacts) {
              const official = golden(artifact.golden);
              expect(official, `golden ${artifact.golden}`).not.toBeNull();
              const port =
                artifact.kind === 'result'
                  ? outcome.files['result.bin']
                  : artifact.kind === 'runlog'
                    ? outcome.execLog
                    : outcome.outputLog;
              const key = artifactKey(program.id, artifact.recipe, artifact.kind);
              seen.add(key);
              compared += 1;
              const officialText = maskArtifact(artifact.kind, official as Uint8Array, key);
              const portText = port
                ? maskArtifact(artifact.kind, port, key)
                : `<no ${artifact.kind}: the run ended ${outcome.end}>`;
              const difference = firstDifference(officialText, portText);
              if (difference === null) {
                equal += 1;
                const mask = ARTIFACT_MASKS[key];
                if (mask) {
                  maskedEqual.push({
                    key,
                    known: known[key] ?? null,
                    masked: `lines ${mask.lines.join(', ')} from column ${mask.fromColumn}: ${mask.reason}`,
                  });
                } else if (known[key]) {
                  unknown.push(`${key}: listed in known-differences.json but now equal; remove the entry`);
                }
                continue;
              }
              mismatches.push({
                key,
                program,
                recipe: artifact.recipe,
                kind: artifact.kind,
                difference,
                known: known[key] ?? null,
                lines: differingLines(officialText, portText),
              });
              // A masked artifact's entry covers only the masked bytes (erratum T3 19): any difference
              // left after masking is a new one, as for an artifact that is not listed at all.
              if (!known[key] || ARTIFACT_MASKS[key]) {
                unknown.push(
                  `${key}: line ${difference.line}${ARTIFACT_MASKS[key] ? ' (outside the bytes ARTIFACT_MASKS masks)' : ''}\n  official: ${JSON.stringify(difference.expected)}\n  port:     ${JSON.stringify(difference.actual)}\n  (run ended: ${outcome.end}; messages: ${JSON.stringify(outcome.messages.slice(-3))})`,
                );
              }
            }
          }
          expect(unknown, program.items.join('; ')).toEqual([]);
        },
        300_000,
      );
    }

    const pendingEntries = () =>
      Object.entries(known)
        .filter(([key]) => {
          const [id = '', recipe = ''] = key.split('|');
          // Listed but without an official result yet (not: skipped because of the doubles).
          return skipped.includes(`${id}:${recipe}`) && manifest?.programs[id]?.recipes[recipe]?.status !== 'ok';
        })
        .map(([key, entry]) => ({ key, known: entry }));
    const partsText = () =>
      partsMode({}) === 'final'
        ? 'the classes at their final paths'
        : 'ProgramFiles and LogService doubles (doubles.ts), every other part at its final path';
    // The report as committed: rendered, then formatted by the repository's Prettier configuration
    // (format:check reads the file, so it is written formatted).
    const report = async () =>
      format(
        renderMismatchReport(mismatches, {
          programs: programs.length,
          runs: compared,
          equal,
          skipped,
          parts: partsText(),
          metrics: "Wine's cells (harness.ts WINE_CELLS)",
          pending: pendingEntries(),
          masked: [...maskedEqual].sort((a, b) => (a.key < b.key ? -1 : 1)),
        }),
        { ...((await resolveConfig(REPORT_PATH)) ?? {}), filepath: REPORT_PATH },
      );

    // MISMATCHES.md is generated (EASY68K_SIM_REPORT=1) and committed; this keeps it from going stale
    // (gate I3 round 4: it lacked b19 and b20 and showed old texts). Judged only on a whole run with
    // the classes at their final paths, the run the committed file describes; it runs after every
    // program above (the tests of a file run in order).
    it.skipIf(Boolean(only) || partsMode({}) !== 'final' || process.env.EASY68K_SIM_REPORT === '1')(
      'MISMATCHES.md is what this run writes (regenerate it with EASY68K_SIM_REPORT=1)',
      async () => {
        const committed = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, 'utf8').replace(/\r\n/g, '\n') : '';
        expect(
          committed === (await report()),
          'tests/conformance/sim/MISMATCHES.md is stale: run EASY68K_SIM_REPORT=1 npx vitest run --config tests/conformance/sim/vitest.config.ts and commit it',
        ).toBe(true);
      },
    );

    afterAll(async () => {
      const pending = pendingEntries();
      const parts = partsText();
      const jsonPath = process.env.EASY68K_SIM_REPORT_JSON;
      if (jsonPath) {
        const data = {
          written: new Date().toISOString(),
          parts,
          programs: programs.length,
          artifactsCompared: compared,
          equal,
          notCompared: skipped,
          mismatches: mismatchRecords(mismatches, pending),
        };
        writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`);
      }
      if (process.env.EASY68K_SIM_REPORT !== '1') return;
      writeFileSync(REPORT_PATH, await report());
    });
  },
);
