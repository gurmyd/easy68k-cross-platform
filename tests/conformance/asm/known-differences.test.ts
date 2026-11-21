// The rule of known-differences.ts: a listed run must differ from the official output in exactly the
// recorded way (T1 review, gate I1: the first version accepted any difference of a listed run).

import { describe, expect, it } from 'vitest';
import type { Fingerprint, Outcome } from './harness';
import { KNOWN_DIFFERENCES, expectOutcome, type KnownDifference } from './known-differences';

const RECORDED: Fingerprint = { errors: 1, warnings: 0, l68: 'a'.repeat(64), s68: 'b'.repeat(64) };
const LIST: KnownDifference[] = [
  { id: 'checklist/x', label: '*', reason: 'test entry', owner: 'engine/asm', ours: { default: RECORDED } },
];

const outcome = (verdict: Outcome['verdict'], ours?: Fingerprint, label = 'default'): Outcome => ({
  id: 'checklist/x',
  label,
  verdict,
  detail: 'line 4 differs',
  ...(ours ? { ours } : {}),
});

describe('expectOutcome', () => {
  it('accepts a listed run that differs in the recorded way', () => {
    expect(() => expectOutcome(outcome('differs', { ...RECORDED }), LIST)).not.toThrow();
  });

  it('fails a listed run that differs in a new way, and names the new values', () => {
    const other = { ...RECORDED, s68: 'c'.repeat(64) };
    expect(() => expectOutcome(outcome('differs', other), LIST)).toThrow(/no longer produces the recorded output/);
    expect(() => expectOutcome(outcome('differs', { ...RECORDED, errors: 2 }), LIST)).toThrow(/"errors":2/);
  });

  it('fails a listed run when nothing was assembled or no output is recorded for its option set', () => {
    expect(() => expectOutcome(outcome('differs'), LIST)).toThrow(/nothing was assembled/);
    expect(() => expectOutcome(outcome('differs', RECORDED, 'mex'), LIST)).toThrow(/records no output/);
  });

  it('fails a listed run that now matches, and an unlisted run that differs', () => {
    expect(() => expectOutcome(outcome('identical', RECORDED), LIST)).toThrow();
    expect(() => expectOutcome({ ...outcome('differs', RECORDED), id: 'checklist/y' }, LIST)).toThrow(
      /differs from the official assembler/,
    );
    expect(() => expectOutcome({ ...outcome('identical', RECORDED), id: 'checklist/y' }, LIST)).not.toThrow();
  });

  it('every entry of known-differences.json records the output of the port for at least one option set', () => {
    for (const entry of KNOWN_DIFFERENCES) {
      expect(Object.keys(entry.ours).length, entry.id).toBeGreaterThan(0);
      for (const fingerprint of Object.values(entry.ours)) {
        expect(fingerprint.l68 ?? '', entry.id).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});
