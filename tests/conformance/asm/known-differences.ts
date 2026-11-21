// Runs in which the WebAssembly assembler is known not to reproduce the official output, each with
// its reason and the package that owns the cause. The list is `known-differences.json`.
//
// A known difference is one particular difference, not a licence to differ: every entry records
// what the port produces for the run today (`ours`: the two counts and the hashes of the canonical
// output), and the test fails as soon as the port produces anything else. So
//
// - a listed run that starts to match fails until its entry is removed (the list cannot go stale);
// - a listed run that differs in a new way fails until someone has looked and updated `ours`;
// - a run that differs and is not listed fails.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { Fingerprint, Outcome } from './harness';

export interface KnownDifference {
  /** Program id of the corpus manifest. */
  id: string;
  /** Option label of the run, or `*` for every run of the program. */
  label: string;
  /** What differs and why. */
  reason: string;
  /** The package that owns the cause (`engine/asm`, or `oracle` when the official run is at fault). */
  owner: string;
  /** What the port produces, by option label: the difference that is known. */
  ours: Record<string, Fingerprint>;
}

export const KNOWN_DIFFERENCES: readonly KnownDifference[] = (
  JSON.parse(readFileSync(fileURLToPath(new URL('./known-differences.json', import.meta.url)), 'utf8')) as {
    differences: KnownDifference[];
  }
).differences;

export function knownDifference(
  id: string,
  label: string,
  list: readonly KnownDifference[] = KNOWN_DIFFERENCES,
): KnownDifference | undefined {
  return list.find((entry) => entry.id === id && (entry.label === '*' || entry.label === label));
}

const FINGERPRINT_KEYS = ['errors', 'warnings', 'l68', 's68'] as const;

const sameFingerprint = (a: Fingerprint, b: Fingerprint): boolean => FINGERPRINT_KEYS.every((key) => a[key] === b[key]);

/** The fingerprint as it is written in known-differences.json, for a failure message. */
const show = (fingerprint: Fingerprint): string =>
  JSON.stringify(Object.fromEntries(FINGERPRINT_KEYS.map((key) => [key, fingerprint[key]])));

/**
 * Fails the running test unless the outcome is what is expected of that run: equal to the official
 * output, or different from it in exactly the way `list` records.
 */
export function expectOutcome(outcome: Outcome, list: readonly KnownDifference[] = KNOWN_DIFFERENCES): void {
  const known = knownDifference(outcome.id, outcome.label, list);
  const name = `${outcome.id} (${outcome.label})`;
  if (outcome.verdict === 'differs') {
    if (!known) expect.fail(`${name} differs from the official assembler:\n${outcome.detail ?? ''}`);
    if (!outcome.ours) {
      expect.fail(`${name} is a known difference, but this time nothing was assembled:\n${outcome.detail ?? ''}`);
    }
    const recorded = known.ours[outcome.label];
    if (!recorded) {
      expect.fail(
        `${name} is a known difference, but known-differences.json records no output of the port for the run ` +
          `"${outcome.label}". What the port produces now: "${outcome.label}": ${show(outcome.ours)}`,
      );
    }
    if (!sameFingerprint(recorded, outcome.ours)) {
      expect.fail(
        `${name} is a known difference, but the port no longer produces the recorded output.\n` +
          `  recorded: ${show(recorded)}\n` +
          `  now:      ${show(outcome.ours)}\n` +
          `Against the official output it now differs like this:\n${outcome.detail ?? ''}\n` +
          'When the new difference is understood, update "ours" and "reason" in known-differences.json.',
      );
    }
    return;
  }
  if (known && (outcome.verdict === 'identical' || outcome.verdict === 'identical-masked')) {
    expect.fail(
      `${name} now equals the official output: remove its entry from known-differences.json (${known.reason})`,
    );
  }
}
