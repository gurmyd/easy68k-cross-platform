// How the original programs read their settings files, byte for byte (editor-ui §11.4, sim-ui
// §14.3; optionsS.cpp:228-912, SIM68Ku.cpp:1551-2034). Owner: E4.
//
// Both loaders read with `ifstream::getline(buffer, 256)` into a `char buffer[257]` that lives for
// the whole load, and test each line with C string functions:
//
//   - an on/off line:  `strcmp(&buffer[1], "$name")`, then `buffer[0] == '1'`;
//   - a value line:    index = 0; `while (buffer[index] != '$' && index < LIMIT) temp[index] = ...`,
//                      then `strcmp(&buffer[index], "$name")` and the value `temp` (a C string).
//     LIMIT is 256 in most loops and `strlen(buffer)` in some of the simulator's.
//
// This module reproduces those operations on bytes, so that every file the original accepts or
// rejects is accepted or rejected alike, including the corner cases that follow from C:
//
//   - The file is read in text mode: CR LF becomes LF before getline sees it; a lone CR stays.
//   - getline stores at most 255 bytes and a terminating NUL. A line of more than 255 bytes puts the
//     stream into its fail state (C++98 27.6.1.3): that line is seen truncated, and every later
//     read, like every read after the end of the file, stores an empty string (a NUL at buffer[0]).
//   - Bytes the current line does not overwrite keep what an earlier, longer line left in the
//     buffer (it is never cleared). A value scan that finds no '$' within the current line runs on
//     into those bytes, exactly as the original's loop does.
//   - A NUL inside a line ends it for strcmp and for `temp` (the shipped sim68K.dat has NUL bytes).
//   - atoi: C's rules (blanks, sign, digits; anything else ends the number; no digits = 0). A value
//     beyond 32 bits wraps, as the 32-bit library does in practice (unverified on the binary).

import type { Bytes } from '../../../contracts';
import { decode } from '../../codec/cp1252';

/** `SIZE` of both loaders: getline(buffer, SIZE) stores at most SIZE - 1 bytes. */
export const LINE_SIZE = 256;

const LF = 0x0a;
const CR = 0x0d;
const DOLLAR = 0x24;

/** The lines of a file as text-mode reading delivers them: split at LF, a CR before an LF removed. */
function textModeLines(bytes: Bytes): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== LF) continue;
    const end = i > start && bytes[i - 1] === CR ? i - 1 : i;
    lines.push(bytes.subarray(start, end));
    start = i + 1;
  }
  // The last line has no LF; getline still delivers it (and sets eofbit). Nothing after a final LF.
  if (start < bytes.length) {
    const end = bytes[bytes.length - 1] === CR ? bytes.length - 1 : bytes.length;
    lines.push(bytes.subarray(start, end));
  }
  return lines;
}

/**
 * The loader's view of a settings file: `next()` is one `File.getline(buffer, SIZE)`, and the
 * other methods are the C operations the loaders apply to `buffer` afterwards.
 */
export class DatReader {
  /** char buffer[SIZE + 1]; its first contents are unknown in the original, zero here. */
  readonly buffer = new Uint8Array(LINE_SIZE + 1);
  private readonly lines: Uint8Array[];
  private position = 0;
  private failed = false;

  constructor(bytes: Bytes) {
    this.lines = textModeLines(bytes);
  }

  /** One getline: the next line into the buffer, NUL-terminated; an empty string once failed. */
  next(): void {
    const line = this.failed ? undefined : this.lines[this.position++];
    if (line === undefined) {
      this.failed = true;
      this.buffer[0] = 0;
      return;
    }
    const stored = Math.min(line.length, LINE_SIZE - 1);
    this.buffer.set(line.subarray(0, stored), 0);
    this.buffer[stored] = 0;
    // More than SIZE - 1 bytes before the delimiter: failbit, and every later read fails.
    if (line.length > LINE_SIZE - 1) this.failed = true;
  }

  /** strlen(buffer + offset). */
  strlen(offset = 0): number {
    let i = offset;
    while (i < this.buffer.length && this.buffer[i] !== 0) i++;
    return i - offset;
  }

  /** `!strcmp(&buffer[offset], text)` for an ASCII text. */
  equals(offset: number, text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      if (offset + i >= this.buffer.length || this.buffer[offset + i] !== text.charCodeAt(i)) return false;
    }
    return offset + text.length < this.buffer.length && this.buffer[offset + text.length] === 0;
  }

  /** The first byte as the signed `char` of the original (a NUL is 0, $FF is -1). */
  firstChar(): number {
    const byte = this.buffer[0] as number;
    return byte > 127 ? byte - 256 : byte;
  }

  /** An on/off line: whether `&buffer[1]` is `$name`. */
  isFlagLine(name: string): boolean {
    return this.equals(1, `$${name}`);
  }

  /**
   * A value line: the scan `while (buffer[index] != '$' && index < limit)`, then the test of
   * `&buffer[index]` against `$name`. Returns `temp` as bytes (up to its first NUL) when the name
   * matches, otherwise null. `limit` is 'size' (256) or 'strlen' (strlen(buffer), evaluated once
   * per test as the original's loop evaluates it, which gives the same result).
   */
  valueOf(name: string, limit: 'size' | 'strlen' = 'size'): Uint8Array | null {
    const bound = limit === 'size' ? LINE_SIZE : this.strlen(0);
    let index = 0;
    while (this.buffer[index] !== DOLLAR && index < bound) index++;
    if (!this.equals(index, `$${name}`)) return null;
    let end = 0;
    while (end < index && this.buffer[end] !== 0) end++;
    return this.buffer.slice(0, end);
  }
}

/** A C string of the file as text (Windows-1252). */
export function cText(bytes: Uint8Array): string {
  return decode(bytes);
}

/** C's atoi on a C string: optional blanks, an optional sign, decimal digits; wraps at 32 bits. */
export function atoi(bytes: Uint8Array): number {
  let i = 0;
  const isSpace = (b: number | undefined) => b === 0x20 || (b !== undefined && b >= 0x09 && b <= 0x0d);
  while (isSpace(bytes[i])) i++;
  let negative = false;
  if (bytes[i] === 0x2b || bytes[i] === 0x2d) {
    negative = bytes[i] === 0x2d;
    i++;
  }
  let value = 0;
  while (i < bytes.length && (bytes[i] as number) >= 0x30 && (bytes[i] as number) <= 0x39) {
    value = (Math.imul(value, 10) + ((bytes[i] as number) - 0x30)) | 0;
    i++;
  }
  return negative ? -value | 0 : value;
}
