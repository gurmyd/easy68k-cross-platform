// Unit tests of run-singlestep.mjs, the entry point of the weekly `singlestep` job in oracle.yml
// (no suite, no engine needed: only the guards are exercised here; the check itself is
// run-catalogue.mjs, whose functions catalogue.test.mjs and baseline.test.mjs cover).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runSingleStep, simulatorBuilt } from './run-singlestep.mjs';

describe('run-singlestep.mjs', () => {
  const empty = mkdtempSync(join(tmpdir(), 't4-nosim-'));
  afterAll(() => rmSync(empty, { recursive: true, force: true }));

  it('only checks: it refuses to rewrite the baseline', async () => {
    const lines = [];
    expect(await runSingleStep(['--write-baseline'], { root: empty, env: {}, log: (l) => lines.push(l) })).toBe(2);
    expect(lines.join('\n')).toMatch(/only checks/);
  });

  it('skips without engine/dist, and fails without it when EASY68K_REQUIRE_ENGINES=1', async () => {
    expect(simulatorBuilt(empty)).toBe(false);
    const lines = [];
    const log = (l) => lines.push(l);
    expect(await runSingleStep([], { root: empty, env: {}, log })).toBe(0);
    expect(await runSingleStep([], { root: empty, env: { EASY68K_REQUIRE_ENGINES: '1' }, log })).toBe(1);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/EASY68K_REQUIRE_ENGINES is 1/);
  });
});
