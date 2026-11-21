// Open S-Record: EASyBIN's `loadSrec` (fileIO.cpp:102-235), docs/porting/easybin.md 10.3. Owner: B1.
//
// A line-by-line emulation of the original, including what it does with malformed files: the byte
// count and the checksum are ignored; a line that does not start with `S` is read as the previous
// line's record type on the stale rest of the line buffer; an S5 record stores its count bytes; a
// line longer than 514 characters is split. The line buffer `lbuf` is a global of the original and
// keeps its bytes from one load to the next, so the caller passes the same buffer every time.

import { MEMSIZE, MESSAGES } from './constants';
import { LineReader, at, scanHex, stringEnd, textModeBytes } from './cstring';
import { decode } from '../codec/cp1252';

/** `char lbuf[MAXBUF + 1]` with `MAXBUF = 515` (fileIO.cpp:18-19). */
export const LBUF_SIZE = 516;
const MAXBUF = 515;

export function createLineBuffer(): Uint8Array {
  return new Uint8Array(LBUF_SIZE);
}

export type SRecLoadResult =
  | {
      ok: true;
      /** The lowest address written (what the original puts in `startAddr`, quirk Q1). */
      startAddr: number;
      endAddr: number;
      /** highAddr - lowAddr + 1, unsigned 32-bit. */
      length: number;
      /** The ShowMessage text. */
      message: string;
    }
  | { ok: false; message: string };

/** The C string at `from` of the buffer, decoded for a message (Windows-1252). */
function cString(buffer: Uint8Array, from: number): string {
  return decode(buffer.subarray(from, Math.min(stringEnd(buffer, from), buffer.length)));
}

/**
 * Loads `file` (its bytes as stored) into `memory`. Memory written before an error stays written,
 * as in the original. `lbuf` is the persistent line buffer (createLineBuffer()).
 */
export function loadSRecord(file: Uint8Array, memory: Uint8Array, lbuf: Uint8Array): SRecLoadResult {
  const reader = new LineReader(textModeBytes(file));
  let line = 0;
  let endOfFile = false;
  let sType = 0;
  let loc = 0; // uninitialised in the original; see docs/porting/easybin.md 10.3
  let lowAddr = 0xffffffff;
  let highAddr = 0;
  let sByte = 0; // s_byte[0]: keeps its value when sscanf converts nothing
  let s0 = '';
  let errorStr = '';
  let error = false;

  while (reader.next(lbuf, MAXBUF)) {
    line++;
    // sscanf(lbuf, "S%c%2x", &s_type, &bytecount): s_type changes only when the line starts with S
    // and has a second character.
    if (at(lbuf, 0) === 0x53 && at(lbuf, 1) !== 0) sType = at(lbuf, 1);
    let bufptr = 4;
    switch (sType) {
      case 0x30: {
        // '0'
        const bufend = stringEnd(lbuf, bufptr);
        bufptr += 4;
        s0 += 'S0 = ';
        for (;;) {
          const scanned = scanHex(lbuf, bufptr, 2);
          if (scanned.result === 0) break;
          if (scanned.result === 1) sByte = scanned.value & 0xff;
          bufptr += 2;
          if (bufptr + 2 >= bufend) break;
          s0 += sByte >= 0x20 && sByte <= 0x7e ? String.fromCharCode(sByte) : '.';
        }
        s0 += '\n';
        break;
      }
      case 0x31:
      case 0x32:
      case 0x33: {
        // '1', '2', '3': 4, 6 or 8 address digits
        const digits = (sType - 0x30 + 1) * 2;
        const scanned = scanHex(lbuf, bufptr, digits);
        if (scanned.result !== 1) error = true;
        else {
          loc = scanned.value;
          bufptr += digits;
        }
        break;
      }
      case 0x35: // '5': ignored, but the data step below still runs
        break;
      case 0x37:
      case 0x38:
      case 0x39: {
        // '7', '8', '9': 8, 6 or 4 digits of the start address
        const digits = (0x3a - sType) * 2 + 2;
        const scanned = scanHex(lbuf, bufptr, digits);
        if (scanned.result !== 1) error = true;
        else {
          loc = scanned.value;
          endOfFile = true; // startAddr = loc; overwritten below on success
        }
        break;
      }
      default:
        error = true;
    }
    if (endOfFile || error) break;

    // The data step (fileIO.cpp:192-209), for every record type that got here.
    const bufend = stringEnd(lbuf, bufptr);
    for (;;) {
      const scanned = scanHex(lbuf, bufptr, 2);
      if (scanned.result === 0) break;
      if (scanned.result === 1) sByte = scanned.value & 0xff;
      bufptr += 2;
      if (bufptr + 2 >= bufend) break;
      if (loc > MEMSIZE - 1) {
        errorStr = MESSAGES.addressExceeds;
        error = true;
        break;
      }
      if (loc < lowAddr) lowAddr = loc;
      if (loc > highAddr) highAddr = loc;
      memory[loc] = sByte;
      loc = (loc + 1) >>> 0;
    }
    if (error) break;
  }

  if (error) {
    return { ok: false, message: MESSAGES.invalidData(errorStr, line, cString(lbuf, 0)) };
  }
  return {
    ok: true,
    startAddr: lowAddr,
    endAddr: highAddr,
    length: (highAddr - lowAddr + 1) >>> 0,
    message: MESSAGES.srecLoaded(s0),
  };
}
