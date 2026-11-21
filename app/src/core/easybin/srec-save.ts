// Save S-Record: EASyBIN's `saveSRecord` and `finish` (fileIO.cpp:373-490), docs/porting/easybin.md
// 11.2-11.3. Owner: B1.
//
// The file is the original's byte for byte: its own header record, data records of up to 32 bytes
// (S1 while the record starts below $10000, S2 below $1000000, S3 above), an S7 record with the
// Start Address, every line ended with CR LF (the original writes in text mode).

import { MEMSIZE, S0_HEADER, SRECDATA } from './constants';

const hex = (value: number, digits: number) => (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');

/** `finish(sRec, bytes)`: puts the count into characters 2-3 and appends the checksum and LF. */
export function finishRecord(record: string, bytes: number): string {
  const count = hex(bytes & 0xff, 2);
  const body = record.slice(0, 2) + count + record.slice(4);
  let sum = 0;
  for (let i = 0; i < bytes; i++) sum += parseInt(body.substr(2 + i * 2, 2), 16) || 0;
  return `${body.slice(0, 2 + bytes * 2)}${hex(~sum & 0xff, 2)}\n`;
}

/** The range check of saveSRecord (fileIO.cpp:392): false = beep and `Invalid memory range.`. */
export function sRecordRangeValid(from: number, to: number): boolean {
  const outLength = (to - from) >>> 0;
  return !(from >>> 0 > to >>> 0 || outLength >= MEMSIZE);
}

/** The text of the S-record file, LF line ends (before the text-mode CR LF translation). */
export function sRecordText(memory: Uint8Array, from: number, to: number, start: number): string {
  const outLength = (to - from) >>> 0;
  const lines = [finishRecord(S0_HEADER, 0x21)];
  let address = from >>> 0;
  let written = 0;
  while (written < outLength) {
    let record: string;
    let addressBytes: number;
    if ((address & 0xffff) === address) {
      record = `S1  ${hex(address, 4)}`;
      addressBytes = 2;
    } else if ((address & 0xffffff) === address) {
      record = `S2  ${hex(address, 6)}`;
      addressBytes = 3;
    } else {
      record = `S3  ${hex(address, 8)}`;
      addressBytes = 4;
    }
    let data = 0;
    const parts: string[] = [record];
    while (data < SRECDATA && written < outLength) {
      parts.push(hex(memory[address] ?? 0, 2));
      address = (address + 1) >>> 0;
      data++;
      written++;
    }
    lines.push(finishRecord(parts.join(''), data + addressBytes + 1));
  }
  lines.push(finishRecord(`S7  ${hex(start, 8)}`, 5));
  return lines.join('');
}

/** The bytes of the file as the original writes it: CR LF line ends, ASCII. */
export function sRecordFile(memory: Uint8Array, from: number, to: number, start: number): Uint8Array {
  const text = sRecordText(memory, from, to, start).replace(/\n/g, '\r\n');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
