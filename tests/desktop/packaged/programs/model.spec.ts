// Unit tests of the logic of checks 6-8 (model.ts), and the build step that makes their expected
// results (expected.ts) with the real engines. Both run on every system: they need no app.
//
// Owner: DV5.

import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { enginesAvailable } from '../prebuilt';
import { expectedResults } from './expected';
import {
  addressAfterTask,
  bytesAt,
  codeLines,
  firstByteDifference,
  firstDifference,
  latin1,
  loadSRecords,
  surfaceHash,
  symbolValue,
  trimmedRows,
} from './model';

const LISTING = [
  '00000800 Starting Address',
  'Assembler used: EASy68K Editor/Assembler v5.16.01',
  'Created On: 11/21/2026 4:27:15 AM',
  '',
  '00000800                             9      ORG     $800',
  '00000800  43F9 0000084C             11      lea     filename,a1',
  '00000836  303C 0032                 29      move    #50,d0',
  '0000083A  4E4F                      30      trap    #15             close all files',
  '0000083C                            31  ',
  '0000083C  43F9 0000084C             32      lea     filename,a1',
  "00000856= 74 68 69 73 20 69 ...     39  data        dc.b    'this is a test'",
  '0000086E  =00000018                 41  datasize    equ     *-data',
  '',
  'SYMBOL TABLE INFORMATION',
  'Symbol-name         Value',
  '-------------------------',
  'DATA                856',
  'DATASIZE            18',
  '',
].join('\r\n');

test.describe('model', () => {
  test('loadSRecords reads S1 to S3 records and refuses a wrong checksum', () => {
    // From the official fileio.S68: 'test1.txt',0 and the start of 'this is a test'.
    const text =
      'S021000036384B50524F47202020323043524541544544204259204541535936384B6D\r\n' +
      'S124084C74657374312E747874007468697320697320612074657374010203040506070809C6\r\n' +
      'S804000800F3\r\n';
    const memory = loadSRecords(text);
    expect(latin1(bytesAt(memory, 0x84c, 9))).toBe('test1.txt');
    expect(memory.get(0x855)).toBe(0);
    expect(latin1(bytesAt(memory, 0x856, 14))).toBe('this is a test');
    expect(() => bytesAt(memory, 0x86e, 1)).toThrow(/\$86E/);
    expect(loadSRecords('S20800100001020304DD\r\n').get(0x1000)).toBe(1);
    expect(loadSRecords('S30900001000AABBCCDDD8\r\n').get(0x1003)).toBe(0xdd);
    expect(() => loadSRecords('S10508480000AC\r\n')).toThrow(/checksum/);
    expect(() => loadSRecords('hello\r\n')).toThrow(/not an S-record/);
  });

  test('symbolValue reads the symbol table, codeLines and addressAfterTask the statements', () => {
    expect(symbolValue(LISTING, 'data')).toBe(0x856);
    expect(symbolValue(LISTING, 'DATASIZE')).toBe(0x18);
    expect(symbolValue(LISTING, 'buffer')).toBeNull();
    expect(symbolValue('no table', 'data')).toBeNull();
    expect(codeLines(LISTING).map((line) => line.address)).toEqual([0x800, 0x836, 0x83a, 0x83c]);
    expect(codeLines(LISTING)[1]).toEqual({ address: 0x836, code: '303C 0032', source: '    move    #50,d0' });
    expect(addressAfterTask(LISTING, 50)).toEqual({ trap: 0x83a, after: 0x83c });
    expect(addressAfterTask(LISTING, 57)).toBeNull();
  });

  test('surfaceHash is the harness hash of the size and the RGBA bytes', () => {
    const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    const expected = createHash('sha256').update('2x1:').update(rgba).digest('hex');
    expect(surfaceHash(2, 1, rgba)).toBe(expected);
    expect(surfaceHash(1, 2, rgba)).not.toBe(expected);
    expect(() => surfaceHash(3, 1, rgba)).toThrow(/3 x 1/);
  });

  test('trimmedRows, firstDifference and firstByteDifference', () => {
    expect(trimmedRows(['ab  ', 'c\0\0', '   ', ''])).toEqual(['ab', 'c']);
    expect(firstDifference(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(firstDifference(['a', 'b'], ['a'])).toMatch(
      /line 2 of 2 expected \/ 1 actual: expected "b", got "\(none\)"/,
    );
    expect(firstByteDifference(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBeNull();
    expect(firstByteDifference(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toMatch(/offset 1/);
    expect(firstByteDifference(new Uint8Array([1]), new Uint8Array([]))).toMatch(/1 bytes expected, 0 found/);
  });
});

test('build step: the real engines reproduce the official files and give the expected results', async () => {
  test.setTimeout(240_000);
  if (!enginesAvailable()) test.skip(true, 'engine/dist is missing');
  const expected = await expectedResults();
  console.log(
    `tutorial1 headless run: ${expected.tutorial1Run.end}; messages ${JSON.stringify(expected.tutorial1Run.messages)}`,
  );
  console.log(`tutorial1 surface hash ${expected.tutorial1Run.surfaceHash}`);
  console.log(`tutorial1 text rows ${JSON.stringify(expected.tutorial1Run.textRows)}`);
  console.log(
    `fileio writes ${expected.fileio.name}: ${JSON.stringify(latin1(expected.fileio.bytes))}; task 50 TRAP at ` +
      `$${expected.fileio.closeTrap.toString(16)}, then $${expected.fileio.afterClose.toString(16)}`,
  );
  expect(expected.tutorial1Run.end).toBe('halted');
  expect(expected.tutorial1Run.textRows.length).toBeGreaterThan(0);
  expect(expected.fileio.name).toBe('test1.txt');
  expect([...expected.fileio.bytes]).toEqual([
    ...Array.from('this is a test', (c) => c.charCodeAt(0)),
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    0,
  ]);
  expect(expected.fileio.afterClose).toBe(expected.fileio.closeTrap + 2);
});
