// The C library calls EASyBIN's S-record loader is built on, emulated on bytes (docs/porting/easybin.md
// 10.3, 0.4). Owner: B1.
//
// - text-mode reading of `fopen(name, "rt")`: CR LF is read as LF, a Ctrl-Z byte ends the file;
// - `fgets(lbuf, 515, fp)` into a buffer that keeps its old bytes beyond the new terminator (the
//   loader reads them on short lines, a quirk the port reproduces);
// - `sscanf(p, "%<w>x")` with the return values the loader's `while` loops depend on: 1 = one value
//   converted, 0 = matching failure, -1 = the string ended before anything was converted.
//
// The `sscanf` rules are those of the Microsoft C library, measured on it (the Borland library of the
// original is expected to agree on everything a well-formed S-record contains; the details of a sign
// or a `0x` inside a record are UNVERIFIED, docs/porting/easybin.md 10.3).

/** Bytes as a text-mode read returns them: CR LF becomes LF, the first Ctrl-Z ends the file. */
export function textModeBytes(file: Uint8Array): Uint8Array {
  const out = new Uint8Array(file.length);
  let n = 0;
  for (let i = 0; i < file.length; i++) {
    const byte = file[i] as number;
    if (byte === 0x1a) break;
    if (byte === 0x0d && file[i + 1] === 0x0a) continue;
    out[n++] = byte;
  }
  return out.subarray(0, n);
}

/** `fgets` over text-mode bytes: one line (with its LF) of at most `size - 1` bytes per call. */
export class LineReader {
  private position = 0;
  constructor(private readonly text: Uint8Array) {}

  /** Copies the next line and a terminating 0 into `buffer`; false at the end of the file. */
  next(buffer: Uint8Array, size: number): boolean {
    if (this.position >= this.text.length) return false;
    let n = 0;
    while (n < size - 1 && this.position < this.text.length) {
      const byte = this.text[this.position++] as number;
      buffer[n++] = byte;
      if (byte === 0x0a) break;
    }
    buffer[n] = 0;
    return true;
  }
}

/** The byte at `index` of a C buffer; past its end everything reads as 0. */
export function at(buffer: Uint8Array, index: number): number {
  return index >= 0 && index < buffer.length ? (buffer[index] as number) : 0;
}

/** strlen-style end: the index of the first 0 at or after `from`. */
export function stringEnd(buffer: Uint8Array, from: number): number {
  let end = from;
  while (at(buffer, end) !== 0) end++;
  return end;
}

const isSpace = (c: number) => c === 0x20 || (c >= 0x09 && c <= 0x0d);
function hexDigit(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

export interface ScanResult {
  /** sscanf's return value: 1, 0 or -1 (EOF). */
  result: 1 | 0 | -1;
  /** The converted value as an unsigned 32-bit number (only when result is 1). */
  value: number;
}

/**
 * `sscanf(buffer + from, "%<width>x", &value)`: white space skipped (not counted), an optional sign
 * and an optional `0x` prefix inside the width, then hex digits up to the width.
 */
export function scanHex(buffer: Uint8Array, from: number, width: number): ScanResult {
  let p = from;
  while (isSpace(at(buffer, p))) p++;
  if (at(buffer, p) === 0) return { result: -1, value: 0 };
  let w = width;
  let negative = false;
  const sign = at(buffer, p);
  if (sign === 0x2b || sign === 0x2d) {
    negative = sign === 0x2d;
    p++;
    w--;
  }
  if (w >= 2 && at(buffer, p) === 0x30 && (at(buffer, p + 1) | 0x20) === 0x78) {
    p += 2;
    w -= 2;
  }
  let digits = 0;
  let value = 0;
  while (w > 0) {
    const d = hexDigit(at(buffer, p));
    if (d < 0) break;
    value = (value * 16 + d) >>> 0;
    p++;
    w--;
    digits++;
  }
  if (digits === 0) return { result: at(buffer, p) === 0 ? -1 : 0, value: 0 };
  return { result: 1, value: negative ? -value >>> 0 : value };
}
