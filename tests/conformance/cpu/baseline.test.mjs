// The frozen baseline of the CPU catalogue (ARCHITECTURE.md 6.1 L7): every file of the 68000
// single-step suite run through the WebAssembly simulator must give exactly the outcome recorded
// in baseline.json (counts per class and the per-file hash).
//
// It takes about four minutes, so it runs only with EASY68K_SINGLESTEP=1, and needs the suite in
// build/singlestep (node tests/conformance/cpu/fetch-suite.mjs) and engine/dist. With
// EASY68K_SINGLESTEP=1 a missing suite fails instead of skipping, and with
// EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails. `npm run oracle:twins` checks the
// same baseline on every run.
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runScript } from '../../oracle/native-twin/sim-script.mjs';
import { analyseFile, compareWithBaseline, readBaseline } from './catalogue.mjs';
import { presentFiles, readSuite } from './fetch-suite.mjs';
import { readSuiteFile, scriptFor } from './singlestep.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const enginesBuilt =
  existsSync(join(repo, 'engine', 'dist', 'sim68k.wasm')) &&
  existsSync(join(repo, 'engine', 'dist', 'sim68k-loader.mjs'));
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';
const wanted = process.env.EASY68K_SINGLESTEP === '1';
const paths = wanted ? presentFiles() : null;

describe('CPU catalogue baseline', () => {
  it.runIf(enginesRequired && wanted && !enginesBuilt)(
    'engine/dist holds the simulator (EASY68K_REQUIRE_ENGINES=1)',
    () => {
      expect.fail(
        'EASY68K_REQUIRE_ENGINES is 1 but engine/dist/sim68k.wasm is missing: run `npm run build:engines` first.',
      );
    },
  );
  it.runIf(wanted && !paths)('the single-step suite is present (EASY68K_SINGLESTEP=1)', () => {
    expect.fail(
      'EASY68K_SINGLESTEP is 1 but the suite is not in build/singlestep: run node tests/conformance/cpu/fetch-suite.mjs.',
    );
  });

  const baseline = readBaseline();
  const names = readSuite().files.map((f) => f.name);
  for (const name of names) {
    it.skipIf(!paths || !enginesBuilt)(
      `${name} matches baseline.json`,
      async () => {
        const path = paths.find((p) => basename(p) === name);
        const tests = readSuiteFile(path);
        const result = analyseFile(name, tests, await runScript(scriptFor(tests)));
        expect(compareWithBaseline(name, result, baseline.files[name])).toEqual([]);
      },
      300_000,
    );
  }
});
