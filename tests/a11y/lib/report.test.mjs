// Owner: Q1.
import { describe, expect, it } from 'vitest';
import { createReport } from './report.mjs';

function quiet(knownChecks = []) {
  const lines = [];
  return { report: createReport({ log: (text) => lines.push(text), knownChecks }), lines };
}

describe('createReport', () => {
  it('counts passes and failures and prints "N of M checks passed"', () => {
    const { report, lines } = quiet();
    expect(report.check('one', true)).toBe(true);
    expect(report.check('two', false, 'why')).toBe(false);
    expect(report.failures).toBe(1);
    expect(report.summary()).toBe('1 of 2 checks passed, 1 failed.');
    expect(lines).toEqual(['  ok   one', '  FAIL two - why']);
  });

  it('prints a check that fails at a known defect as known, not as a failure', () => {
    const { report, lines } = quiet([{ id: 'Q1-7', owner: 'U1', match: /breakpoint/ }]);
    expect(report.check('a breakpoint is told', false, 'silent')).toBe(false);
    expect(report.failures).toBe(0);
    expect(lines[0]).toBe('  known a breakpoint is told - Q1-7 (U1): silent');
    expect(report.summary()).toBe(
      '1 of 1 checks passed (1 of them at a known defect of docs/integration/rc.md: Q1-7).',
    );
  });

  it('notes when a check of a known defect passes (the entry can go)', () => {
    const { report } = quiet([{ id: 'Q1-7', owner: 'U1', match: /breakpoint/ }]);
    report.check('a breakpoint is told', true);
    expect(report.notes).toEqual(['"a breakpoint is told" passes: known defect Q1-7 (U1) seems repaired']);
  });
});
