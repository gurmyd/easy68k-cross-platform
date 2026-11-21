// Runs in which the WebAssembly assembler is known not to reproduce the official output, each with
// its reason and the package that owns the cause. The list is `known-differences.json`.
//
// A listed run must still differ: when it starts to match, its test fails until the entry is
// removed, so the list cannot go stale. A run that differs and is not listed fails its test.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { Outcome } from './harness';

export interface KnownDifference {
  /** Program id of the corpus manifest. */
  id: string;
  /** Option label of the run, or `*` for every run of the program. */
  label: string;
  /** What differs and why. */
  reason: string;
  /** The package that owns the cause (`engine/asm`, or `oracle` when the official run is at fault). */
  owner: string;
}

export const KNOWN_DIFFERENCES: readonly KnownDifference[] = (
  JSON.parse(readFileSync(fileURLToPath(new URL('./known-differences.json', import.meta.url)), 'utf8')) as {
    differences: KnownDifference[];
  }
).differences;

export function knownDifference(id: string, label: string): KnownDifference | undefined {
  return KNOWN_DIFFERENCES.find((entry) => entry.id === id && (entry.label === '*' || entry.label === label));
}

/** Fails the running test unless the outcome is what is expected of that run. */
export function expectOutcome(outcome: Outcome): void {
  const known = knownDifference(outcome.id, outcome.label);
  const name = `${outcome.id} (${outcome.label})`;
  if (outcome.verdict === 'differs') {
    if (known) return;
    expect.fail(`${name} differs from the official assembler:\n${outcome.detail ?? ''}`);
  }
  if (known && (outcome.verdict === 'identical' || outcome.verdict === 'identical-masked')) {
    expect.fail(
      `${name} now equals the official output: remove its entry from known-differences.json (${known.reason})`,
    );
  }
}
