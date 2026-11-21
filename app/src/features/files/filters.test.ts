// Filters, the default extension rule and file names (editor-ui §6.2, §6.4; sim-ui §8.3).

import { describe, expect, it } from 'vitest';
import {
  EDITOR_DEFAULT_EXT,
  EDITOR_OPEN_FILTERS,
  EDITOR_SAVE_FILTERS,
  OVERWRITE_TEXT,
  OVERWRITE_TITLE,
  SIM_OPEN_FILTERS,
  acceptFor,
  applyDefaultExtension,
  invalidNameReason,
  matchesFilter,
  normalizeDefaultExt,
  parseWindowsFilter,
} from './filters';

describe('the filters of the original dialogs', () => {
  it('Open File has the five filters of mainS.dfm, X68 first', () => {
    expect(EDITOR_OPEN_FILTERS).toEqual([
      { label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] },
      { label: '68K Source  [.ASM] [.M68]', patterns: ['*.ASM', '*.M68'] },
      { label: 'EASy68K Listing  [.L68]', patterns: ['*.L68'] },
      { label: '68K S Record  [.S68]', patterns: ['*.S68'] },
      { label: 'Any File  [*.*]', patterns: ['*.*'] },
    ]);
  });

  it('Save As has the two filters of mainS.dfm', () => {
    expect(EDITOR_SAVE_FILTERS).toEqual([
      { label: '68K Source File  [.X68]', patterns: ['*.X68'] },
      { label: 'Any File  [*.*]', patterns: ['*.*'] },
    ]);
  });

  it('the simulator opens S-Records (5.4)', () => {
    expect(SIM_OPEN_FILTERS.map((f) => f.label)).toEqual(['EASy68K S-Record (*.S68)', 'All Files (*.*)']);
  });

  it('the overwrite question has the original text', () => {
    expect([OVERWRITE_TITLE, OVERWRITE_TEXT]).toEqual(['Caution!', 'File exists! OK to overwrite?']);
  });
});

describe('matchesFilter', () => {
  const [x68, asm, , s68, any] = EDITOR_OPEN_FILTERS;
  it('matches without regard to letter case', () => {
    expect(matchesFilter('prog.X68', x68)).toBe(true);
    expect(matchesFilter('prog.x68', x68)).toBe(true);
    expect(matchesFilter('prog.X68.bak', x68)).toBe(false);
    expect(matchesFilter('lib.m68', asm)).toBe(true);
    expect(matchesFilter('lib.Asm', asm)).toBe(true);
    expect(matchesFilter('prog.L68', asm)).toBe(false);
    expect(matchesFilter('PROG.S68', s68)).toBe(true);
  });
  it('*.* matches every name, also one without a dot', () => {
    expect(matchesFilter('README', any)).toBe(true);
    expect(matchesFilter('a.b.c', any)).toBe(true);
  });
  it('? is one character; regular expression characters are literal', () => {
    expect(matchesFilter('a1.txt', { label: '', patterns: ['a?.txt'] })).toBe(true);
    expect(matchesFilter('a12.txt', { label: '', patterns: ['a?.txt'] })).toBe(false);
    expect(matchesFilter('a(1).txt', { label: '', patterns: ['a(1).*'] })).toBe(true);
    expect(matchesFilter('axtxt', { label: '', patterns: ['a.txt'] })).toBe(false);
  });
});

describe('the default extension rule (editor-ui §6.4)', () => {
  it("normalises the original's malformed DefaultExt '*.X68'", () => {
    expect(normalizeDefaultExt(EDITOR_DEFAULT_EXT)).toBe('.X68');
    expect(normalizeDefaultExt('X68')).toBe('.X68');
    expect(normalizeDefaultExt('.bin')).toBe('.bin');
    expect(normalizeDefaultExt('')).toBe('');
    expect(normalizeDefaultExt('*.*')).toBe('');
  });
  it('appends .X68 to a name without extension while the first filter is selected', () => {
    const request = { defaultExt: EDITOR_DEFAULT_EXT };
    expect(applyDefaultExtension('prog', request, 0)).toBe('prog.X68');
    expect(applyDefaultExtension('prog.asm', request, 0)).toBe('prog.asm');
    expect(applyDefaultExtension('prog.', request, 0)).toBe('prog.');
    expect(applyDefaultExtension('prog', request, 1)).toBe('prog');
    expect(applyDefaultExtension('prog', { defaultExt: '' }, 0)).toBe('prog');
  });
});

describe('names and accept', () => {
  it('refuses names Windows cannot store', () => {
    expect(invalidNameReason('prog.X68')).toBeNull();
    expect(invalidNameReason('Übung 1')).toBeNull();
    for (const bad of [
      '',
      '  ',
      'a/b',
      'a\\b',
      'a:b',
      'a*b',
      'a?b',
      'a"b',
      'a<b',
      'a>b',
      'a|b',
      'end.',
      'end ',
      'CON',
      'nul.txt',
      'com1',
    ]) {
      expect(invalidNameReason(bad), bad).not.toBeNull();
    }
  });
  it('accept lists the extensions of a filter, or nothing for *.*', () => {
    expect(acceptFor(EDITOR_OPEN_FILTERS[1])).toBe('.asm,.m68');
    expect(acceptFor(EDITOR_OPEN_FILTERS[4])).toBe('');
  });
  it('parses the Windows filter strings of task 58', () => {
    expect(parseWindowsFilter('Text files|*.txt;*.log|All|*.*')).toEqual([
      { label: 'Text files', patterns: ['*.txt', '*.log'] },
      { label: 'All', patterns: ['*.*'] },
    ]);
    expect(parseWindowsFilter('')).toEqual([{ label: 'All Files (*.*)', patterns: ['*.*'] }]);
  });
});
