// What opens where (ARCHITECTURE-PLUS P3.4.1): the table for names and contents.

import { describe, expect, it } from 'vitest';
import { BINARY_PROBE_BYTES, blobTypeOf, looksBinary, viewerKindOf, type ViewerKind } from './classify';
import { noticeText, pdfFrameTitle, pdfNoticeText, sizeText } from './texts';

const text = (value: string) => Uint8Array.from(value, (ch) => ch.charCodeAt(0));
/** `length` bytes of 'A' with a zero byte at `zeroAt` (none for -1). */
function filled(length: number, zeroAt: number): Uint8Array {
  const data = new Uint8Array(length).fill(0x41);
  if (zeroAt >= 0) data[zeroAt] = 0;
  return data;
}
const BINARY = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d);

const TABLE: [string, Uint8Array, ViewerKind | null][] = [
  ['/browser/prog.X68', text('START ORG $1000\r\n'), null],
  ['/browser/prog.x68', Uint8Array.of(0x41, 0, 0x42), null], // a zero byte: still text, as in the original
  ['/browser/PROG.L68', BINARY, null],
  ['/browser/PROG.S68', text('S00600004844521B\r\n'), null],
  ['/browser/prog.s68', BINARY, null],
  ['/browser/report.pdf', text('%PDF-1.4\n'), 'pdf'],
  ['/browser/REPORT.PDF', text('%PDF-1.7\n'), 'pdf'],
  ['/browser/pic.png', BINARY, 'picture'],
  ['/browser/pic.JPG', BINARY, 'picture'],
  ['/browser/pic.jpeg', BINARY, 'picture'],
  ['/browser/pic.gif', text('GIF89a'), 'picture'],
  ['/browser/pic.bmp', BINARY, 'picture'],
  ['/browser/pic.webp', BINARY, 'picture'],
  ['/browser/pic.svg', text('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'picture'],
  ['/browser/favicon.ico', BINARY, 'picture'],
  ['/browser/data.bin', BINARY, 'notice'],
  ['/browser/data.bin', text('plain words'), null],
  ['/browser/notes.txt', text('notes\r\n'), null],
  ['/browser/zero-at-8191.dat', filled(9000, BINARY_PROBE_BYTES - 1), 'notice'],
  ['/browser/zero-at-8192.dat', filled(9000, BINARY_PROBE_BYTES), null],
  ['/browser/no-extension', Uint8Array.of(1, 2, 0, 3), 'notice'],
  ['/browser/empty.dat', new Uint8Array(0), null],
  ['/folder/Lab/archive.zip', Uint8Array.of(0x50, 0x4b, 3, 4, 0), 'notice'],
  ['/browser/dir.pdf/prog.asm', text('MOVE.B D0,D1\r\n'), null],
];

describe('viewerKindOf: the table of P3.4.1', () => {
  it.each(TABLE)('%s', (path, bytes, expected) => {
    expect(viewerKindOf(path, bytes)).toBe(expected);
  });

  it('has at least 20 cases', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(20);
  });

  it('looks for a zero byte only in the first 8,192 bytes', () => {
    expect(BINARY_PROBE_BYTES).toBe(8192);
    expect(looksBinary(filled(8192, 8191))).toBe(true);
    expect(looksBinary(filled(20000, 8192))).toBe(false);
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });
});

describe('blobTypeOf (P3.4.2)', () => {
  it.each([
    ['/browser/a.png', 'picture', 'image/png'],
    ['/browser/a.jpg', 'picture', 'image/jpeg'],
    ['/browser/a.JPEG', 'picture', 'image/jpeg'],
    ['/browser/a.gif', 'picture', 'image/gif'],
    ['/browser/a.bmp', 'picture', 'image/bmp'],
    ['/browser/a.webp', 'picture', 'image/webp'],
    ['/browser/a.svg', 'picture', 'image/svg+xml'],
    ['/browser/a.ico', 'picture', 'image/x-icon'],
    ['/browser/a.pdf', 'pdf', 'application/pdf'],
    ['/browser/a.bin', 'notice', 'application/octet-stream'],
  ] as const)('%s (%s) is %s', (path, kind, type) => {
    expect(blobTypeOf(path, kind)).toBe(type);
  });
});

describe('texts (P3.4.2)', () => {
  it('the notices and the frame title, exactly', () => {
    expect(noticeText('data.bin')).toBe(
      '"data.bin" does not look like text. Opened as text, it will probably look like nonsense.',
    );
    expect(pdfNoticeText('report.pdf')).toBe(
      '"report.pdf" cannot be shown here because this browser does not show PDF files.',
    );
    expect(pdfFrameTitle('report.pdf')).toBe('PDF: report.pdf');
  });

  it('the size in the strip', () => {
    expect([0, 1, 999, 1000, 34_567, 999_949, 999_950, 3_400_000].map(sizeText)).toEqual([
      '0 bytes',
      '1 byte',
      '999 bytes',
      '1.0 kB',
      '34.6 kB',
      '999.9 kB',
      '1.0 MB',
      '3.4 MB',
    ]);
  });
});
