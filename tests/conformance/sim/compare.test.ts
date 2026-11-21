// Unit tests of the mismatch data (compare.ts): what the owners repair from. Owner: T3.

import { describe, expect, it } from 'vitest';
import { differingLines, firstDifference, mismatchRecords, OWNERS, type Mismatch } from './compare';
import type { ConformanceProgram } from './programs';

describe('differingLines', () => {
  it('lists every differing line, not only the first, and the missing ones', () => {
    expect(differingLines('a\nb\nc\nd', 'a\nB\nc\nD\ne')).toEqual([
      { line: 2, official: 'b', port: 'B' },
      { line: 4, official: 'd', port: 'D' },
      { line: 5, official: '<end of file>', port: 'e' },
    ]);
    expect(differingLines('same', 'same')).toEqual([]);
    expect(differingLines('1\n2\n3', 'x\ny\nz', 2)).toHaveLength(2);
  });
});

describe('mismatchRecords', () => {
  it('gives owner, program, recipe, artifact and the lines of each mismatch, then the pending ones', () => {
    const difference = firstDifference('D0=0\n', 'D0=1\n');
    expect(difference).not.toBeNull();
    const mismatch: Mismatch = {
      key: 'trap15-a/a51-files-read-after-write|report|result',
      program: { id: 'trap15-a/a51-files-read-after-write' } as ConformanceProgram,
      recipe: 'report',
      kind: 'result',
      difference: difference as NonNullable<typeof difference>,
      known: { owner: 'SH6', summary: 'read after write', unconfirmed: 'run on Windows' },
      lines: differingLines('D0=0\n', 'D0=1\n'),
    };
    const unknown: Mismatch = {
      key: 'x/y|log:2|runlog',
      program: mismatch.program,
      recipe: 'log:2',
      kind: 'runlog',
      difference: mismatch.difference,
      known: null,
    };
    const records = mismatchRecords(
      [mismatch, unknown],
      [{ key: 'x/z|outlog|outlog', known: { owner: 'engine', summary: 'waits for a golden' } }],
    );
    expect(records[0]).toEqual({
      owner: 'SH6',
      ownerName: OWNERS.SH6,
      program: 'trap15-a/a51-files-read-after-write',
      recipe: 'report',
      artifact: 'result',
      state: 'measured',
      unconfirmed: 'run on Windows',
      cause: 'read after write',
      evidence: null,
      lines: [{ line: 1, official: 'D0=0', port: 'D0=1' }],
    });
    // Without lines, the first difference stands for them; without an entry, no owner.
    expect(records[1]).toMatchObject({ owner: null, cause: 'not yet assigned', recipe: 'log:2', artifact: 'runlog' });
    expect(records[1]?.lines).toEqual([{ line: 1, official: 'D0=0', port: 'D0=1' }]);
    expect(records[2]).toMatchObject({ owner: 'engine', state: 'pending', program: 'x/z', lines: [] });
  });
});
