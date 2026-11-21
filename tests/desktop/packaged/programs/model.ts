// Pure logic of the packaged-app program checks 6-8 (ARCHITECTURE.md 6.7): reading S-records and
// listings, the hash of an output surface, the comparison of two lists of lines. No app, no
// engine, no file system: model.spec.ts tests all of it on any system.
//
// Owner: DV5.

import { createHash } from 'node:crypto';

/** Bytes as text, one character per byte (what .L68 and .S68 files hold: Windows-1252, CR LF). */
export function latin1(bytes: ArrayLike<number>): string {
  let text = '';
  for (let index = 0; index < bytes.length; index++) text += String.fromCharCode(bytes[index] as number);
  return text;
}

/**
 * The memory an S-record file loads: address -> byte, from its S1, S2 and S3 records. A record
 * whose checksum is wrong, or a line that is not a record, is an error (the files are the
 * assembler's, so either means a broken file).
 */
export function loadSRecords(text: string): Map<number, number> {
  const memory = new Map<number, number>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const match = /^S([0-9])((?:[0-9A-F]{2})+)$/i.exec(line);
    if (!match) throw new Error(`line ${index + 1} is not an S-record: ${JSON.stringify(line)}`);
    const type = Number(match[1]);
    const bytes = (match[2] as string).match(/../g)!.map((pair) => parseInt(pair, 16));
    const count = bytes[0] as number;
    if (count !== bytes.length - 1)
      throw new Error(`line ${index + 1}: the count says ${count} bytes, the record has ${bytes.length - 1}`);
    const sum = bytes.slice(0, -1).reduce((total, byte) => total + byte, 0);
    if ((~sum & 0xff) !== bytes[bytes.length - 1]) throw new Error(`line ${index + 1}: wrong checksum`);
    const addressBytes = type === 1 ? 2 : type === 2 ? 3 : type === 3 ? 4 : 0;
    if (addressBytes === 0) continue; // S0 header, S5 count, S7-S9 termination
    let address = 0;
    for (let i = 1; i <= addressBytes; i++) address = address * 256 + (bytes[i] as number);
    const data = bytes.slice(1 + addressBytes, -1);
    data.forEach((byte, offset) => memory.set(address + offset, byte));
  }
  return memory;
}

/** `length` bytes from `address` of a loaded memory; a byte no record set is an error. */
export function bytesAt(memory: ReadonlyMap<number, number>, address: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let offset = 0; offset < length; offset++) {
    const byte = memory.get(address + offset);
    if (byte === undefined) throw new Error(`no S-record sets $${(address + offset).toString(16).toUpperCase()}`);
    out[offset] = byte;
  }
  return out;
}

/** A symbol's value from the listing's SYMBOL TABLE INFORMATION (names are upper case there). */
export function symbolValue(listing: string, name: string): number | null {
  const lines = listing.split(/\r?\n/);
  const table = lines.indexOf('SYMBOL TABLE INFORMATION');
  if (table < 0) return null;
  for (const line of lines.slice(table + 1)) {
    const entry = /^(\S+)\s+([0-9A-F]+)$/.exec(line);
    if (entry && entry[1] === name.toUpperCase()) return parseInt(entry[2] as string, 16);
  }
  return null;
}

/** A statement line of a listing that produced code: its address, its code and its source text. */
export interface CodeLine {
  address: number;
  code: string;
  source: string;
}

/**
 * The listing's lines that carry object code, in order. The format is the original's
 * (`00000800  43F9 0000084C       11      lea     filename,a1`): address, code, line number, source.
 */
export function codeLines(listing: string): CodeLine[] {
  const result: CodeLine[] = [];
  for (const line of listing.split(/\r?\n/)) {
    const match = /^([0-9A-F]{8}) {2}((?:[0-9A-F]{4} ?)+)\s+\d+ {2}(.*)$/.exec(line);
    if (match) {
      result.push({
        address: parseInt(match[1] as string, 16),
        code: (match[2] as string).trim(),
        source: match[3] as string,
      });
    }
  }
  return result;
}

/**
 * Where the PC is right after the program's "close all files" (TRAP #15 task 50): the address
 * of the code line that follows the first `TRAP #15` after a `MOVE #50,D0` (fileio.X68:
 * `move #50,d0` / `trap #15` / `lea filename,a1`). Null when the listing has no such sequence.
 */
export function addressAfterTask(listing: string, task: number): { trap: number; after: number } | null {
  const lines = codeLines(listing);
  const load = new RegExp(`^\\s*move(?:\\.[bwl])?\\s+#${task}\\s*,\\s*d0\\b`, 'i');
  const start = lines.findIndex((line) => load.test(line.source));
  if (start < 0) return null;
  for (let index = start + 1; index < lines.length - 1; index++) {
    if (/^\s*trap\s+#15\b/i.test((lines[index] as CodeLine).source)) {
      return { trap: (lines[index] as CodeLine).address, after: (lines[index + 1] as CodeLine).address };
    }
  }
  return null;
}

/**
 * The hash of an output surface as the headless harness of 6.4 computes it
 * (tests/conformance/sim/harness.ts): SHA-256 of `<width>x<height>:` followed by the pixels in
 * memory order. A pixel is a little-endian $AABBGGRR word there, so its bytes are R, G, B, A:
 * exactly the RGBA bytes a 2D canvas returns from getImageData for the same picture.
 */
export function surfaceHash(width: number, height: number, rgba: Uint8Array): string {
  if (rgba.length !== width * height * 4) {
    throw new Error(`${rgba.length} bytes are not the pixels of a ${width} x ${height} surface`);
  }
  const hash = createHash('sha256');
  hash.update(`${width}x${height}:`);
  hash.update(rgba);
  return hash.digest('hex');
}

/** Rows of a text grid without their trailing blanks, and without the blank rows at the end. */
export function trimmedRows(rows: readonly string[]): string[] {
  const result = rows.map((row) => row.replace(/[ \0]+$/, ''));
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  return result;
}

/** Null when the two lists are equal; otherwise where they first differ, for the log. */
export function firstDifference(expected: readonly string[], actual: readonly string[]): string | null {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index++) {
    if (expected[index] !== actual[index]) {
      return (
        `line ${index + 1} of ${expected.length} expected / ${actual.length} actual: ` +
        `expected ${JSON.stringify(expected[index] ?? '(none)')}, got ${JSON.stringify(actual[index] ?? '(none)')}`
      );
    }
  }
  return null;
}

/** Null when the byte arrays are equal; otherwise the first differing offset, for the log. */
export function firstByteDifference(expected: Uint8Array, actual: Uint8Array): string | null {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index++) {
    if (expected[index] !== actual[index]) {
      const show = (bytes: Uint8Array) => JSON.stringify(latin1(bytes.subarray(Math.max(0, index - 16), index + 16)));
      return (
        `${expected.length} bytes expected, ${actual.length} found; first difference at offset ${index}: ` +
        `expected ${show(expected)}, found ${show(actual)}`
      );
    }
  }
  return null;
}
