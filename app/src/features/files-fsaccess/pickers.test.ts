import { describe, expect, it } from 'vitest';
import { isPickerCancel, pickerTypes } from './pickers';

describe('pickerTypes', () => {
  it('turns the editor filters into picker types in order, leaving "*.*" to the picker', () => {
    expect(
      pickerTypes([
        { label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] },
        { label: '68K Source  [.ASM] [.M68]', patterns: ['*.ASM', '*.M68'] },
        { label: 'Any File  [*.*]', patterns: ['*.*'] },
      ]),
    ).toEqual([
      { description: 'EASy68K Source [.X68]', accept: { 'text/plain': ['.X68'] } },
      { description: '68K Source [.ASM] [.M68]', accept: { 'text/plain': ['.ASM', '.M68'] } },
    ]);
  });

  it('drops patterns the picker cannot express, and filters left with none', () => {
    expect(
      pickerTypes([
        { label: 'odd', patterns: ['data?.txt', 'x*', '*', '*.a b', '*.waytoolongextension'] },
        { label: 'two-part', patterns: ['*.tar.gz', ' *.txt ', '*.txt'] },
      ]),
    ).toEqual([{ description: 'two-part', accept: { 'text/plain': ['.tar.gz', '.txt'] } }]);
  });

  it('isPickerCancel recognises AbortError only', () => {
    expect(isPickerCancel(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isPickerCancel(new DOMException('no gesture', 'SecurityError'))).toBe(false);
    expect(isPickerCancel(null)).toBe(false);
  });
});
