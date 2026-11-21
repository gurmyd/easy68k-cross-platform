import { describe, expect, it } from 'vitest';
import {
  basename,
  changeFileExt,
  childPath,
  dirname,
  extractFileExt,
  foldCase,
  hasDriveLetter,
  isVPath,
  isWithin,
  joinVPath,
  matchName,
  mountOf,
  relativeTo,
  resolveLexically,
  sameName,
  splitVPath,
  splitWindowsName,
} from './winpath';

describe('VPath', () => {
  it.each([
    ['/browser', true],
    ['/browser/demo/prog.X68', true],
    ['/disk/Users/me/My Programs/a b.X68', true],
    ['', false],
    ['/', false],
    ['browser/demo', false],
    ['/browser/', false],
    ['/browser//demo', false],
    ['/browser/./demo', false],
    ['/browser/../demo', false],
    ['/browser\\demo', false],
  ])('isVPath(%j) = %s', (path, expected) => {
    expect(isVPath(path)).toBe(expected);
  });

  it('splits and joins', () => {
    expect(splitVPath('/browser/demo/prog.X68')).toEqual({ mount: 'browser', rel: 'demo/prog.X68' });
    expect(splitVPath('/memory')).toEqual({ mount: 'memory', rel: '' });
    expect(joinVPath('browser', 'demo/prog.X68')).toBe('/browser/demo/prog.X68');
    expect(joinVPath('browser', '')).toBe('/browser');
    expect(mountOf('/folder/x')).toBe('folder');
    expect(childPath('/browser/demo', 'sub', 'x.txt')).toBe('/browser/demo/sub/x.txt');
    expect(() => joinVPath('browser', '../x')).toThrow(TypeError);
    expect(() => splitVPath('relative')).toThrow(TypeError);
  });

  it('dirname and basename', () => {
    expect(dirname('/browser/demo/prog.X68')).toBe('/browser/demo');
    expect(dirname('/browser/prog.X68')).toBe('/browser');
    expect(dirname('/browser')).toBe('/browser');
    expect(basename('/browser/demo/prog.X68')).toBe('prog.X68');
    expect(basename('/browser')).toBe('browser');
  });

  it('isWithin and relativeTo use exact letter case', () => {
    expect(isWithin('/browser/demo/x', '/browser/demo')).toBe(true);
    expect(isWithin('/browser/demo', '/browser/demo')).toBe(true);
    expect(isWithin('/browser/demo2/x', '/browser/demo')).toBe(false);
    expect(isWithin('/browser/Demo/x', '/browser/demo')).toBe(false);
    expect(relativeTo('/browser/demo', '/browser/demo/sub/x.txt')).toBe('sub/x.txt');
    expect(relativeTo('/browser/demo', '/browser/demo')).toBe('');
    expect(relativeTo('/browser/demo', '/browser/other')).toBeNull();
  });
});

describe('file names', () => {
  it('extensions as the VCL handles them', () => {
    expect(extractFileExt('prog.X68')).toBe('.X68');
    expect(extractFileExt('demo.v2\\prog')).toBe('');
    expect(extractFileExt('a/b.c/d')).toBe('');
    expect(changeFileExt('demo/prog.X68', '.L68')).toBe('demo/prog.L68');
    expect(changeFileExt('demo.v2/prog', '.S68')).toBe('demo.v2/prog.S68');
    expect(changeFileExt('prog.tar.gz', '.L68')).toBe('prog.tar.L68');
  });

  it('compares without regard to case, keeping the length', () => {
    expect(foldCase('Prüfung.x68')).toBe('PRÜFUNG.X68');
    expect(foldCase('straße')).toBe('STRAßE'); // ß has no one-character upper case
    expect(sameName('PROG.x68', 'prog.X68')).toBe(true);
    expect(sameName('prog1', 'prog2')).toBe(false);
  });

  it('matchName prefers the exact spelling', () => {
    expect(matchName(['DATA.TXT', 'data.txt'], 'data.txt')).toBe('data.txt');
    expect(matchName(['Data.Txt', 'DATA.TXT'], 'data.txt')).toBe('Data.Txt');
    expect(matchName(['a', 'b'], 'c')).toBeNull();
  });

  it('drive letters and separators', () => {
    expect(hasDriveLetter('C:\\x')).toBe(true);
    expect(hasDriveLetter('c:x')).toBe(true);
    expect(hasDriveLetter('x:')).toBe(true);
    expect(hasDriveLetter('data:x')).toBe(false);
    expect(splitWindowsName('a\\b//c\\')).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveLexically', () => {
  it.each([
    ['data.txt', '/browser/demo/data.txt'],
    ['sub\\data.txt', '/browser/demo/sub/data.txt'],
    ['sub/data.txt', '/browser/demo/sub/data.txt'],
    ['sub\\\\data.txt', '/browser/demo/sub/data.txt'],
    ['.\\data.txt', '/browser/demo/data.txt'],
    ['sub\\..\\data.txt', '/browser/demo/data.txt'],
    ['..\\other\\x.X68', '/browser/other/x.X68'],
    ['..', '/browser'],
    ['.', '/browser/demo'],
    ['Mixed\\CASE.txt', '/browser/demo/Mixed/CASE.txt'],
  ])('/browser/demo + %j = %j', (name, expected) => {
    expect(resolveLexically('/browser/demo', name)).toBe(expected);
  });

  it.each([
    ['..\\..\\x', 'leaves the mount'],
    ['C:\\data.txt', 'drive letter'],
    ['c:data.txt', 'drive-relative'],
    ['\\data.txt', 'rooted with \\'],
    ['/data.txt', 'rooted with /'],
    ['\\\\server\\share\\x', 'UNC'],
    ['', 'empty'],
  ])('/browser/demo + %j = null (%s)', (name) => {
    expect(resolveLexically('/browser/demo', name)).toBeNull();
  });
});
