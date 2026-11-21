// Unit tests of the catalogue (catalogue.mjs), the committed baseline and the suite list.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyseFile, compareWithBaseline, readBaseline, THEMES, themeOf } from './catalogue.mjs';
import { gitBlobSha1, readSuite, verify } from './fetch-suite.mjs';

describe('themes', () => {
  it('assigns classes by the first matching rule', () => {
    expect(themeOf('ADD.l [address error]: RAM')).toBe('address-error');
    expect(themeOf('TRAP [TRAP]: Dn PC SSP')).toBe('trap15');
    expect(themeOf('ABCD: CCR SSP')).toBe('a7-byte');
    expect(themeOf('ABCD: CCR')).toBe('bcd');
    expect(themeOf('LEA: An')).toBe('ea24');
    expect(themeOf('ORItoCCR: SR.T SR.unused')).toBe('ccr-system-byte');
    expect(themeOf('ORItoCCR: SR.unused')).toBe('sr-unused');
    expect(themeOf('DIVU [zero divide]: CCR RAM')).toBe('div');
    expect(themeOf('something new: PC')).toBe('other');
    expect(THEMES.at(-1)[0]).toBe('other');
  });
});

describe('analyseFile and the baseline comparison', () => {
  const zeros = {
    d0: 0,
    d1: 0,
    d2: 0,
    d3: 0,
    d4: 0,
    d5: 0,
    d6: 0,
    d7: 0,
    a0: 0,
    a1: 0,
    a2: 0,
    a3: 0,
    a4: 0,
    a5: 0,
    a6: 0,
  };
  const state = { ...zeros, usp: 0, ssp: 0x800, sr: 0x2700, pc: 0xc02, prefetch: [0, 0], ram: [] };
  const tests = [
    { name: 'a', initial: { ...state, pc: 0xc00 }, final: state },
    { name: 'b', initial: { ...state, pc: 0xc00 }, final: { ...state, d1: 7 } },
  ];
  const regs =
    'D0=00000000 D1=00000000 D2=00000000 D3=00000000 D4=00000000 D5=00000000 D6=00000000 D7=00000000 ' +
    'A0=00000000 A1=00000000 A2=00000000 A3=00000000 A4=00000000 A5=00000000 A6=00000000 USP=00000000 SSP=00000800 PC=00000C02 SR=2700 cycles=4';
  const transcript = ['echo test 0', `regs ${regs}`, 'bytes ', 'echo test 1', `regs ${regs}`, 'bytes ', ''].join('\n');

  it('counts deviating tests per class and hashes "<index> <class>"', () => {
    const r = analyseFile('X.json.gz', tests, transcript);
    expect(r).toMatchObject({ tests: 2, deviating: 1, classes: { 'X: Dn': 1 }, fields: { D1: 1 } });
    expect(r.sha256).toBe(createHash('sha256').update('1 X: Dn\n').digest('hex'));
    expect(compareWithBaseline('X.json.gz', r, r)).toEqual([]);
    expect(compareWithBaseline('X.json.gz', r, { ...r, sha256: 'other' })).toEqual([
      'X.json.gz: the same counts, but other tests deviate (hash differs)',
    ]);
    expect(compareWithBaseline('X.json.gz', r, { ...r, deviating: 2, classes: {} })).toHaveLength(2);
    expect(compareWithBaseline('X.json.gz', r, undefined)).toEqual(['X.json.gz: not in baseline.json']);
  });

  it('refuses a transcript with the wrong number of tests', () => {
    expect(() => analyseFile('X.json.gz', tests, 'echo test 0\n')).toThrow(/1 results for 2 tests/);
  });
});

describe('the committed files', () => {
  const suite = readSuite();
  const baseline = readBaseline();

  it('suite.json pins one commit and lists 124 files with size, git blob SHA-1 and SHA-256', () => {
    expect(suite.repository).toBe('SingleStepTests/680x0');
    expect(suite.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(suite.files).toHaveLength(124);
    for (const f of suite.files) {
      expect(f.name).toMatch(/\.json\.gz$/);
      expect(f.gitSha1).toMatch(/^[0-9a-f]{40}$/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('baseline.json covers every file of the suite, holds counts and hashes only, and every class has a theme', () => {
    expect(baseline).not.toBeNull();
    expect(baseline.suite.commit).toBe(suite.commit);
    expect(Object.keys(baseline.files).sort()).toEqual(suite.files.map((f) => f.name).sort());
    let tests = 0;
    for (const r of Object.values(baseline.files)) {
      expect(Object.keys(r).sort()).toEqual(['classes', 'deviating', 'fields', 'sha256', 'tests']);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.values(r.classes).reduce((a, b) => a + b, 0)).toBe(r.deviating);
      for (const cls of Object.keys(r.classes)) expect(themeOf(cls), cls).not.toBe('other');
      tests += r.tests;
    }
    expect(tests).toBeGreaterThan(1_000_000);
  });

  it('checks downloads by size, git blob SHA-1 and SHA-256', () => {
    expect(gitBlobSha1(new Uint8Array(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    const bytes = new TextEncoder().encode('hello\n');
    const file = {
      name: 'x',
      size: 6,
      gitSha1: gitBlobSha1(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    expect(verify(bytes, file)).toBeNull();
    expect(verify(bytes.subarray(1), file)).toMatch(/^size 5/);
    expect(verify(bytes, { ...file, gitSha1: '0'.repeat(40) })).toMatch(/^git blob SHA-1/);
    expect(verify(bytes, { ...file, sha256: '0'.repeat(64) })).toMatch(/^SHA-256/);
  });
});
