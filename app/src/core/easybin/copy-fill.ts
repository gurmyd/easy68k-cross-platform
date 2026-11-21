// Copy and Fill: EASyBIN's `CopyClick` and `FillClick` (Form1u.cpp:899-991), docs/porting/easybin.md
// 14. Owner: B1.

import { MEMSIZE, MESSAGES } from './constants';

/** The message the original shows, or null when the operation finished without one. */
export type EditOutcome = { message: string | null };

/**
 * Copy `bytes` bytes from `from` to `to`. Upwards copies run from the top down, so overlapping
 * ranges copy correctly; a downward copy that runs past the end stops there with the message and
 * keeps what it had copied (quirk Q10).
 */
export function copyMemory(memory: Uint8Array, from: number, to: number, bytes: number): EditOutcome {
  let fromAddr = from >>> 0;
  let toAddr = to >>> 0;
  const count = bytes >>> 0;
  if (toAddr === fromAddr || count === 0) return { message: MESSAGES.invalidCopy };
  if (fromAddr < toAddr) {
    fromAddr = (fromAddr + count - 1) >>> 0;
    toAddr = (toAddr + count - 1) >>> 0;
    if (toAddr >= MEMSIZE || fromAddr >= MEMSIZE) return { message: MESSAGES.invalidCopy };
    memory.copyWithin(toAddr - count + 1, fromAddr - count + 1, fromAddr + 1);
    return { message: null };
  }
  for (let i = 0; i < count; i++) {
    if (toAddr + i >= MEMSIZE || fromAddr + i >= MEMSIZE) return { message: MESSAGES.invalidCopy };
    memory[toAddr + i] = memory[fromAddr + i] as number;
  }
  return { message: null };
}

/** Fill `from` up to and including `to` with `byte`; nothing when from > to. */
export function fillMemory(memory: Uint8Array, from: number, to: number, byte: number): EditOutcome {
  const fromAddr = from >>> 0;
  const toAddr = to >>> 0;
  if (fromAddr > toAddr) return { message: null };
  if (toAddr >= MEMSIZE) {
    // Unreachable with six-digit fields (docs/porting/easybin.md 14.2); kept as the original does it.
    memory.fill(byte & 0xff, fromAddr, MEMSIZE);
    return { message: MESSAGES.invalidFill };
  }
  memory.fill(byte & 0xff, fromAddr, toAddr + 1);
  return { message: null };
}
