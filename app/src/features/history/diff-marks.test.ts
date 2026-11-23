// N4's gutter marks of the comparison (ARCHITECTURE-PLUS P3.3.8): `-` for each deleted line of the
// earlier version, `+` for each inserted line of the file now, from @codemirror/merge's chunks.

import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { changedLines, deletedLineCount, linesOf } from './diff-marks';

const doc = (text: string) => Text.of(text.split('\n'));
const marks = (before: string, now: string) => {
  const a = doc(before);
  const b = doc(now);
  const result = changedLines(Chunk.build(a, b), a, b);
  return { deleted: [...result.deleted].sort((x, y) => x - y), inserted: [...result.inserted].sort((x, y) => x - y) };
};

describe('changedLines', () => {
  it('an inserted line is +, a deleted line is -', () => {
    expect(marks('a\nb\nc', 'a\nb\nX\nc')).toEqual({ deleted: [], inserted: [3] });
    expect(marks('a\nb\nc\nd', 'a\nc\nd')).toEqual({ deleted: [2], inserted: [] });
  });

  it('a changed line is - on the left and + on the right', () => {
    expect(marks('one\ntwo\nthree', 'one\nTWO\nthree')).toEqual({ deleted: [2], inserted: [2] });
  });

  it('several chunks, at the start and at the end', () => {
    // Files end with a line break, so lines added at the end are whole lines.
    expect(marks('a\nb\nc\nd\ne\n', 'Z\nb\nc\nd\ne\nf\ng\n')).toEqual({ deleted: [1], inserted: [1, 6, 7] });
    // Without one, the last line itself changes (it gains a line break), as the merge view's own
    // highlighting shows it: the marks follow the package's chunks.
    expect(marks('a\ne', 'a\ne\nf')).toEqual({ deleted: [2], inserted: [2, 3] });
  });

  it('identical texts have no marks', () => {
    expect(marks('same\ntext', 'same\ntext')).toEqual({ deleted: [], inserted: [] });
  });

  it('linesOf and deletedLineCount', () => {
    const a = doc('x\ny\nz');
    expect(linesOf(a, 0, 0)).toEqual([]);
    expect(linesOf(a, 2, 6)).toEqual([2, 3]);
    expect(linesOf(a, 2, 99)).toEqual([2, 3]);
    const [chunk] = Chunk.build(doc('a\nb\nc\nd'), doc('a\nd'));
    expect(deletedLineCount(chunk!, doc('a\nb\nc\nd'))).toBe(2);
  });
});
