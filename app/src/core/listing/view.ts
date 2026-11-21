// The listing pane's cached, decoded copy of the engine's listing (ARCHITECTURE.md 3.11.4).
//
// The simulator engine holds the listing (the raw lines of the .L68 file, or the nine-line notice
// when there is none) and decides which row is the current instruction (`listingHighlight`). This
// class keeps the rows as text, so that the Listing panel can draw 100,000 rows without asking
// the engine for each one, and holds the three pure rules of the original's listing pane:
//
//   isInstruction(row)   sim-ui §6.2, SIM68Ku.cpp:856-864
//   addressOf(row)       the first 8 characters as a hex number ("0x" + SubString(1, 8))
//   find(text, fromRow)  sim-ui §6.7, SIM68Ku.cpp:818-851 (the search part; the "next" state of
//                        the Find dialog belongs to the dialog, features/sim-main/find-model.ts)
//
// `refresh()` re-reads every row. The run controller calls it after a load, a close and a cold
// start (4.7, 4.7.1, 4.8); nothing else changes the rows. Each refresh makes a new `rows` array,
// so a panel can tell by identity that the listing was replaced.
//
// Owner: W1 > U1.

import type { ListingViewApi, SimEngine } from '../../contracts';
import { decode } from '../codec/cp1252';

/** Rows 0-2 are the listing's header; the original's callers skip them (sim-ui §6.1, §6.2). */
export const FIRST_BODY_ROW = 3;

const CR = 13;
const LF = 10;

/** The bytes of one row without a trailing line end (the engine gives none; this is defensive). */
function withoutLineEnd(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === CR || bytes[end - 1] === LF)) end--;
  return end === bytes.length ? bytes : bytes.subarray(0, end);
}

/**
 * Windows-1252 text of one row. Listing rows are nearly always plain ASCII, which decodes much
 * faster through String.fromCharCode; anything else goes through the codec.
 */
function decodeRow(bytes: Uint8Array): string {
  if (bytes.length > 4096) return decode(bytes);
  for (let index = 0; index < bytes.length; index++) {
    if ((bytes[index] as number) >= 0x80) return decode(bytes);
  }
  return String.fromCharCode.apply(null, bytes as unknown as number[]);
}

/**
 * The original's `toupper` over a `std::string` (SIM68Ku.cpp:810-813): ASCII letters only. A byte
 * of $80 or more is a negative `char` there, which the C library's `toupper` leaves alone.
 */
export function upperAscii(text: string): string {
  return text.replace(/[a-z]+/g, (letters) => letters.toUpperCase());
}

/**
 * sim-ui §6.2 on one row text, with the original's 1-based positions: the address starts with
 * `00`, position 11 holds object code, and neither position 9 nor 11 is `=`.
 *
 * The original indexes an AnsiString, which raises an exception for a position past the end; no
 * listing line the assembler writes that starts with `00` is that short. Here a missing position
 * counts as "no object code", so such a row is not an instruction row.
 */
export function isInstructionText(text: string): boolean {
  if (!text.startsWith('00') || text.length < 11) return false;
  const p9 = text[8];
  const p11 = text[10];
  return p11 !== ' ' && p9 !== '=' && p11 !== '=';
}

/** `StrToInt("0x" + first 8 characters)`: null when they are not 8 hex digits. */
export function addressOfText(text: string): number | null {
  const head = text.slice(0, 8);
  if (!/^[0-9A-Fa-f]{8}$/.test(head)) return null;
  return Number.parseInt(head, 16);
}

export class ListingView implements ListingViewApi {
  private current: readonly string[] = [];

  constructor(private readonly engine: () => SimEngine) {}

  /** Windows-1252 decoded, no line ends. A new array after every refresh(). */
  get rows(): readonly string[] {
    return this.current;
  }

  /** Re-reads all rows from the engine that is current now (a cold start replaces it). */
  refresh(): void {
    const engine = this.engine();
    const count = engine.listingLineCount;
    const rows = new Array<string>(count);
    for (let index = 0; index < count; index++) rows[index] = decodeRow(withoutLineEnd(engine.listingLine(index)));
    this.current = Object.freeze(rows);
  }

  /** sim-ui §6.2. Callers that act on a row (gutter, Run To Cursor) also require row > 2. */
  isInstruction(row: number): boolean {
    const text = this.current[row];
    return text !== undefined && isInstructionText(text);
  }

  /** The first 8 characters as hex; null for a row that does not exist or does not start so. */
  addressOf(row: number): number | null {
    const text = this.current[row];
    return text === undefined ? null : addressOfText(text);
  }

  /**
   * The first row at or after `fromRow` whose whole raw text contains `text`, ignoring the case of
   * ASCII letters; -1 if there is none (no wrap-around). The search never looks at the three
   * header rows: a `fromRow` below 3 starts at row 3, as the original's restart does.
   *
   * An empty `text` matches the first row searched (`std::string::find("")` is 0); the Find
   * dialog never searches for it.
   */
  find(text: string, fromRow: number): number {
    const wanted = upperAscii(text);
    const rows = this.current;
    for (let row = Math.max(FIRST_BODY_ROW, Math.trunc(fromRow)); row < rows.length; row++) {
      if (upperAscii(rows[row] ?? '').includes(wanted)) return row;
    }
    return -1;
  }
}
