// Open Binary and Save Binary: EASyBIN's `loadBinary` and `saveBinary` (fileIO.cpp:242-369),
// docs/porting/easybin.md 12-13. Owner: B1.

import { changeFileExt, extractFileExt } from '../paths/winpath';
import { MEMSIZE, type Split } from './constants';

/** The step between the bytes of one file: 1, 2 or 4 (split 0 means one file, step 1). */
export const stepOf = (split: Split): 1 | 2 | 4 => (split === 0 ? 1 : split);

/**
 * `loadBinary(name, split)`: the file's bytes go to `first`, `first + step`, ... while the address
 * is below MEMSIZE. Returns what the original returns: (bytes read + 1) x step - 1, because its
 * `while (!eof)` loop runs once more than there are bytes (quirk Q3); a stop at the end of memory
 * returns (bytes stored) x step - 1. 0 means "nothing happened" to the caller.
 */
export function loadBinary(file: Uint8Array, memory: Uint8Array, first: number, split: Split): number {
  const step = stepOf(split);
  let address = first >>> 0;
  let size = 0;
  let index = 0;
  let eof = false;
  while (!eof && address < MEMSIZE) {
    if (index < file.length) memory[address] = file[index++] as number;
    else eof = true; // this read fails; the byte keeps its value
    address += step;
    size += step;
  }
  return size - 1;
}

/** The range check of saveBinary (fileIO.cpp:287): false = beep and `Invalid memory range.`. */
export function binaryRangeValid(first: number, length: number): boolean {
  return (first + length) >>> 0 < MEMSIZE;
}

/**
 * The four names saveBinary computes for the chosen name (fileIO.cpp:295-303). `written` are the
 * names this split writes; the original asks before replacing if ANY of the four exists (Q5).
 */
export function binaryFileNames(
  fileName: string,
  split: Split,
): { all: [string, string, string, string]; written: string[] } {
  const ext = extractFileExt(fileName);
  const name = (k: number) => changeFileExt(fileName, `_${k}${ext}`);
  const all: [string, string, string, string] = [split === 0 ? fileName : name(0), name(1), name(2), name(3)];
  return { all, written: all.slice(0, stepOf(split)) };
}

/**
 * The contents of the files saveBinary writes (fileIO.cpp:334-355), in the order of `written`.
 * With 2 or 4 files, file k > 0 also gets the byte at first + i + k when that is the address just
 * after the range (the `<= toAddr` test, quirk Q4).
 */
export function binaryFileContents(memory: Uint8Array, first: number, length: number, split: Split): Uint8Array[] {
  const from = first >>> 0;
  const outLength = length >>> 0;
  const toAddr = (from + outLength) >>> 0;
  if (split === 0) return [memory.slice(from, from + outLength)];
  const step = split;
  const files: Uint8Array[] = [];
  for (let k = 0; k < step; k++) {
    // i runs over 0, step, 2*step ... below outLength; file k takes i + k when k == 0 or
    // from + i + k <= toAddr.
    let count = 0;
    for (let i = 0; i < outLength; i += step) if (k === 0 || from + i + k <= toAddr) count++;
    const bytes = new Uint8Array(count);
    let n = 0;
    for (let i = 0; i < outLength; i += step) {
      if (k === 0 || from + i + k <= toAddr) bytes[n++] = memory[from + i + k] as number;
    }
    files.push(bytes);
  }
  return files;
}
