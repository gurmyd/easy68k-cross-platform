import { describe, expect, it } from 'vitest';
import { makeZip } from './make-zip';
import { assertSafeEntryName, unzip } from './unzip';

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

describe('unzip', () => {
  it('reads stored and deflated entries and folder entries, in the archive order', () => {
    const big = 'MOVE.L  D0,D1\r\n'.repeat(500);
    const entries = unzip(
      makeZip([
        { name: 'Game/', data: '' },
        { name: 'Game/main.X68', data: big },
        { name: 'Game/sound.wav', data: new Uint8Array([0, 255, 128, 13, 10, 26]), method: 0 },
      ]),
    );
    expect(entries.map((entry) => [entry.name, entry.directory])).toEqual([
      ['Game/', true],
      ['Game/main.X68', false],
      ['Game/sound.wav', false],
    ]);
    expect(text(entries[1]?.data ?? new Uint8Array())).toBe(big);
    expect(entries[2]?.data).toEqual(new Uint8Array([0, 255, 128, 13, 10, 26]));
  });

  it('reads an archive that ends in a comment', () => {
    const archive = makeZip([{ name: 'a.txt', data: 'x' }]);
    const withComment = new Uint8Array(archive.length + 5);
    withComment.set(archive);
    withComment[archive.length - 2] = 5; // comment length
    withComment.set(Buffer.from('hello'), archive.length);
    expect(unzip(withComment).map((entry) => entry.name)).toEqual(['a.txt']);
  });

  it('refuses what it cannot check', () => {
    expect(() => unzip(new Uint8Array(100))).toThrow(/not a zip archive/);
    expect(() => unzip(Uint8Array.from(Buffer.from('<html>404 Not Found</html>')))).toThrow(/not a zip archive/);
    expect(() => unzip(makeZip([{ name: 'a.txt', data: 'abc', crc: 1 }]))).toThrow(/a\.txt: wrong CRC-32/);
    expect(() => unzip(makeZip([{ name: 'a.txt', data: 'abc', flags: 1 }]))).toThrow(/encrypted/);
    expect(() => unzip(makeZip([{ name: 'a.txt', data: 'abc', method: 9 as 8 }]))).toThrow(/compression method 9/);
  });

  it('refuses an archive cut off in the middle', () => {
    const archive = makeZip([{ name: 'a.txt', data: 'some text '.repeat(100) }]);
    expect(() => unzip(archive.subarray(0, archive.length - 30))).toThrow(/not a zip archive/);
  });

  it('refuses entry names that leave the target folder', () => {
    for (const name of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/Windows/x', 'C:evil', 'a/..']) {
      expect(() => unzip(makeZip([{ name, data: 'x' }])), name).toThrow(/unsafe path/);
    }
    // A backslash in a stored name is a separator (archives made on Windows) and is checked as one.
    expect(() => unzip(makeZip([{ name: '..\\evil.txt', data: 'x' }]))).toThrow(/unsafe path/);
    expect(unzip(makeZip([{ name: 'a\\b.txt', data: 'x' }]))[0]?.name).toBe('a/b.txt');
  });
});

describe('assertSafeEntryName', () => {
  it('accepts ordinary relative names, also with dots and blanks', () => {
    for (const name of ['a.txt', 'The 3 Programming Language/Str.x68', 'a/b/c..d', '.hidden', 'a/...']) {
      expect(() => assertSafeEntryName(name), name).not.toThrow();
    }
  });

  it('refuses empty, absolute and escaping names', () => {
    for (const name of ['', '/a', '..', 'a\\b', 'x\0y', 'D:/a']) {
      expect(() => assertSafeEntryName(name), JSON.stringify(name)).toThrow();
    }
  });
});
