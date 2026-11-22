// Whole-program pixel regression under Node (ARCHITECTURE.md 6.5.4): every example runs to its fixed
// point in the headless harness and its surface hash must be the committed one. The same programs
// run in Chromium and WebKit in check-examples.mjs, with the same hashes. Owner: X3.
//
// EASY68K_EXAMPLES_REGENERATE=1 writes golden/surfaces.json from the port itself (a baseline, not a
// capture of the original: golden.ts says what that means). Review the diff before committing it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimEngine, releaseSimEngine } from '../../../app/src/engine';
import { createWindowsGlyphs } from '../sim/harness';
import {
  CONFORMANCE_IDS,
  GOLDEN_PATH,
  OFFICIAL_EXAMPLES,
  REPO_ROOT,
  SCENE_NAMES,
  allExamples,
  prepareExample,
  type Example,
} from './catalog';
import { describeDifference, entryOf, readGolden, writeGolden, type GoldenEntry } from './golden';
import { runExample } from './runner';

const enginesBuilt = ['asm68k.wasm', 'sim68k.wasm'].every((name) =>
  existsSync(join(REPO_ROOT, 'engine', 'dist', name)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';
const regenerate = process.env.EASY68K_EXAMPLES_REGENERATE === '1';

describe('the examples of the whole-program pixel regression', () => {
  it('has the ten official examples, twenty conformance programs and the scene programs of 6.5.4', () => {
    expect(OFFICIAL_EXAMPLES).toHaveLength(10);
    expect(new Set(CONFORMANCE_IDS).size).toBe(20);
    expect(SCENE_NAMES.length).toBeGreaterThanOrEqual(1);
  });

  it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
  });
});

describe.skipIf(!enginesBuilt)('whole-program surfaces under Node', () => {
  const examples: Example[] = enginesBuilt ? allExamples() : [];
  const results: Record<string, GoldenEntry> = {};

  afterAll(() => {
    if (regenerate && Object.keys(results).length === examples.length) writeGolden(GOLDEN_PATH, results);
  });

  it('has a golden entry for every example and none for anything else', () => {
    if (regenerate) return;
    expect(Object.keys(readGolden(GOLDEN_PATH).examples).sort()).toEqual(examples.map((e) => e.id).sort());
  });

  // One test per program, so that a failure names the program.
  describe.each(examples.map((example) => [example.id, example] as const))('%s', (_id, example) => {
    it('ends where the golden says and draws the golden picture', async () => {
      const program = await prepareExample(example);
      const glyphs = createWindowsGlyphs();
      const result = await runExample(program, {
        engines: { create: createSimEngine, release: releaseSimEngine },
        glyphs,
      });
      const entry = entryOf(program, example.origin, result);
      results[example.id] = entry;
      expect(result.end, `${example.id}: ${result.messages.join(' | ')}`).not.toBe('waiting for input');
      if (regenerate) return;
      const golden = readGolden(GOLDEN_PATH).examples[example.id];
      expect(golden, `no golden entry for ${example.id}`).toBeDefined();
      const difference = describeDifference(golden as GoldenEntry, entry);
      expect(difference, `${example.id} differs from the golden: ${difference}`).toBeNull();
    }, 120_000);
  });
});
