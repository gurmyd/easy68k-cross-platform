// The rules of the original Memory window (sim-ui §10, Memory1.cpp) as pure functions. Owner: U2.
//
// Everything here works on numbers and strings only, so that it runs under Node without a DOM.
// The stateful panel model (model.ts) and the React view (MemoryPanel.tsx) use these functions;
// nothing here reads the engine.
//
// Coordinates are the original's character cells: a row is "%08X: " (columns 0-9), sixteen
// "%02X " (columns 10-57) and sixteen ASCII cells (columns 58-73).

/** MEMSIZE of the original: 16 MiB, addresses $000000-$FFFFFF. */
export const MEMSIZE = 0x1000000;

/** Column constants of Memory1.cpp:27-30. */
export const HEX_LEFT = 10;
export const HEX_RIGHT = 56;
export const ASC_LEFT = 58;
export const ASC_RIGHT = 73;
/** Characters in one row: 10 + 16 * 3 + 16. */
export const ROW_CHARS = 74;

/** The column header the original shows above the hex and ASCII columns (Memory1.dfm Label7). */
export const COLUMN_HEADER = '00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 0123456789ABCDEF';

/** Message boxes of the window (sim-ui §10.5). ShowMessage boxes carry the application title. */
export const APPLICATION_TITLE = 'SIM68K';
export const MSG_INVALID_COPY = 'Invalid copy range';
export const MSG_INVALID_FILL = 'Invalid memory range';
export const MSG_INVALID_SAVE = 'Invalid memory range.';
export const MSG_INVALID_SAVE_TITLE = 'Information';
export const MSG_SAVE_FAILED = 'Error saving 68K memory to file.';
export const MSG_SAVE_FAILED_TITLE = 'Information';

const hex = (value: number, digits: number) => (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');

/**
 * The ASCII cell of a byte: the byte itself when `memory[addr] >= ' '` as a signed char, else '-'.
 * So $00-$1F and $80-$FF are '-', and $20-$7F are the character, including $7F (Memory1.cpp:113-117).
 */
export function asciiCell(byte: number): string {
  const b = byte & 0xff;
  return b >= 0x20 && b <= 0x7f ? String.fromCharCode(b) : '-';
}

/** One painted row: the text and which parts are red (rows at or beyond MEMSIZE). */
export interface MemoryRow {
  address: number;
  /** "%08X: " */
  addressText: string;
  /** Sixteen "%02X " cells, or "xx " beyond MEMSIZE. */
  hex: string[];
  /** Sixteen ASCII cells, or '-' beyond MEMSIZE. */
  ascii: string[];
  /** The address is at or beyond MEMSIZE: the address is red. */
  addressInvalid: boolean;
  /** Per byte: its address is at or beyond MEMSIZE (red "xx " and '-'). */
  invalid: boolean[];
}

/**
 * The row at `address` as FormPaint draws it (Memory1.cpp:67-124). `byteAt(a)` is asked only for
 * addresses below MEMSIZE.
 */
export function memoryRow(address: number, byteAt: (address: number) => number): MemoryRow {
  const hexCells: string[] = [];
  const asciiCells: string[] = [];
  const invalid: boolean[] = [];
  for (let i = 0; i < 16; i++) {
    const a = address + i;
    if (a >= MEMSIZE) {
      hexCells.push('xx ');
      asciiCells.push('-');
      invalid.push(true);
    } else {
      const b = byteAt(a) & 0xff;
      hexCells.push(`${hex(b, 2)} `);
      asciiCells.push(asciiCell(b));
      invalid.push(false);
    }
  }
  return {
    address,
    addressText: `${hex(address, 8)}: `,
    hex: hexCells,
    ascii: asciiCells,
    addressInvalid: address >= MEMSIZE,
    invalid,
  };
}

/** The row as one string of ROW_CHARS characters (the format of sim-ui §10.1). */
export function memoryRowText(address: number, byteAt: (address: number) => number): string {
  const row = memoryRow(address, byteAt);
  return row.addressText + row.hex.join('') + row.ascii.join('');
}

/* ------------------------------------------------------------------ navigation (sim-ui §10.2) */

/** Address1Change: the field's value rounded down to a multiple of 16 (Memory1.cpp:49-63). */
export function topAddressOf(value: number): number {
  const v = value >>> 0;
  return v - (v % 16);
}

/** The Address field's text for a top-row address: "%06lX" (six digits; the field holds six). */
export function addressFieldText(address: number): string {
  return hex(address, 6).slice(-6);
}

/** Row spin up, wheel up, Up in the Address field: 16 bytes lower, not below 0. */
export function rowUp(address: number): number {
  return Math.max(0, address - 16);
}

/** Row spin down, wheel down, Down in the Address field: 16 bytes higher; at MEMSIZE: MEMSIZE - 16. */
export function rowDown(address: number): number {
  const next = address + 16;
  return next >= MEMSIZE ? MEMSIZE - 16 : next;
}

/** Page spin up, Page Up: nRows * 16 bytes lower, not below 0. */
export function pageUp(address: number, rows: number): number {
  const next = address - rows * 16;
  return next <= 0 ? 0 : next;
}

/** Page spin down, Page Down: nRows * 16 bytes higher; at MEMSIZE: MEMSIZE - 16. */
export function pageDown(address: number, rows: number): number {
  const next = address + rows * 16;
  return next >= MEMSIZE ? MEMSIZE - 16 : next;
}

/* ------------------------------------------------------------------ the cursor (sim-ui §10.3) */

export interface Cell {
  row: number;
  col: number;
}

/** What gotoRC did: the cell, and -1 / +1 when the view had to move one row up / down. */
export interface PlacedCell extends Cell {
  scroll: -1 | 0 | 1;
}

/**
 * gotoRC (Memory1.cpp:309-335): keeps the row inside the view (moving the view one row at the
 * edges) and the column out of the address column and the separator spaces.
 */
export function gotoRC(row: number, col: number, rows: number): PlacedCell {
  let scroll: -1 | 0 | 1 = 0;
  let r = row;
  let c = col;
  const last = Math.max(0, rows - 1);
  if (r < 0) {
    r = 0;
    scroll = -1;
  } else if (r > last) {
    r = last;
    scroll = 1;
  }
  if (c < HEX_LEFT) c = HEX_LEFT;
  else if (c < ASC_LEFT) {
    if (c % 3 === 0) c++;
  } else if (c > ASC_RIGHT) c = ASC_RIGHT;
  return { row: r, col: c, scroll };
}

/** The cursor keys of FormKeyDown (Memory1.cpp:470-510), before gotoRC. */
export function moveCell(cell: Cell, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): Cell {
  switch (key) {
    case 'ArrowUp':
      return { row: cell.row - 1, col: cell.col };
    case 'ArrowDown':
      return { row: cell.row + 1, col: cell.col };
    case 'ArrowLeft': {
      let col = cell.col - 1;
      if (col < ASC_LEFT && col % 3 === 0) col--;
      return { row: cell.row, col };
    }
    case 'ArrowRight':
      return { row: cell.row, col: cell.col + 1 };
  }
}

/** The address a cell stands for (FormKeyPress, Memory1.cpp:405-417). */
export function cellAddress(top: number, cell: Cell): number {
  const base = top + cell.row * 16;
  return cell.col <= HEX_RIGHT ? base + Math.trunc((cell.col - HEX_LEFT) / 3) : base + (cell.col - ASC_LEFT);
}

/** Result of a typed character. */
export type TypedResult =
  /** The original beeps and changes nothing. */
  | { kind: 'beep' }
  /** Store `value` at `address`, then place the cursor on `next` (before gotoRC). */
  | { kind: 'write'; address: number; value: number; next: Cell };

/**
 * A character typed on the form (FormKeyPress, Memory1.cpp:397-467). `code` is the 8-bit
 * character the key produced (Windows-1252); `current` is the byte now stored at the cell's
 * address (asked only when the address is valid).
 */
export function typeChar(top: number, cell: Cell, code: number, current: (address: number) => number): TypedResult {
  const address = cellAddress(top, cell);
  if (address >= MEMSIZE) return { kind: 'beep' };
  if (cell.col <= HEX_RIGHT) {
    const ch = String.fromCharCode(code & 0xff).toUpperCase();
    let nibble: number;
    if (ch >= '0' && ch <= '9') nibble = ch.charCodeAt(0) - 0x30;
    else if (ch >= 'A' && ch <= 'F') nibble = ch.charCodeAt(0) - 0x41 + 10;
    else return { kind: 'beep' };
    const low = (cell.col - HEX_LEFT) % 3 !== 0;
    const byte = current(address) & 0xff;
    const value = low ? (byte & 0xf0) | nibble : (byte & 0x0f) | (nibble << 4);
    let col = cell.col + 1;
    let row = cell.row;
    if (col > HEX_RIGHT) {
      col = HEX_LEFT;
      row++;
    }
    return { kind: 'write', address, value, next: { row, col } };
  }
  let col = cell.col + 1;
  let row = cell.row;
  if (col > ASC_RIGHT) {
    col = ASC_LEFT;
    row++;
  }
  return { kind: 'write', address, value: code & 0xff, next: { row, col } };
}

/* ------------------------------------------------------------------ Copy, Fill, Save (sim-ui §10.5) */

export type CopyPlan =
  /** Nothing is copied; the box `Invalid copy range` appears. */
  | { kind: 'invalid' }
  /**
   * Copy `count` bytes from `from` to `to` as memmove does (both directions of the original are
   * memmove-equivalent). `stopped`: the original reached MEMSIZE part-way, copied `count` bytes
   * and then showed `Invalid copy range`.
   */
  | { kind: 'copy'; from: number; to: number; count: number; stopped: boolean };

/** CopyClick (Memory1.cpp:523-570) with the field values From, To and Bytes. */
export function planCopy(from: number, to: number, bytes: number): CopyPlan {
  const f = from >>> 0;
  const t = to >>> 0;
  const n = bytes >>> 0;
  if (t === f || n === 0) return { kind: 'invalid' };
  if (f < t) {
    // fromAddr += bytes - 1, toAddr += bytes - 1 in unsigned arithmetic. An end address that
    // wraps past 2^32 would make the original index outside its memory array (a crash); the port
    // reports the range as invalid instead (docs/differences/U2.md).
    const fromEnd = f + n - 1;
    const toEnd = t + n - 1;
    if (toEnd >= MEMSIZE || fromEnd >= MEMSIZE) return { kind: 'invalid' };
    return { kind: 'copy', from: f, to: t, count: n, stopped: false };
  }
  // From > To: upward one byte at a time, stopping where From + i reaches MEMSIZE (From is the
  // larger address, so it reaches it first).
  const room = f >= MEMSIZE ? 0 : MEMSIZE - f;
  if (n <= room) return { kind: 'copy', from: f, to: t, count: n, stopped: false };
  return { kind: 'copy', from: f, to: t, count: room, stopped: true };
}

export type FillPlan =
  /** From > To: nothing happens and no message is shown. */
  | { kind: 'none' }
  /** Write `data` at `from`; `stopped`: the box `Invalid memory range` follows. */
  | { kind: 'fill'; from: number; data: Uint8Array; stopped: boolean };

/**
 * FillClick (Memory1.cpp:588-614): From through To inclusive with the 4-byte pattern of the
 * Bytes field, most significant byte first.
 */
export function planFill(from: number, to: number, bytes: number): FillPlan {
  const f = from >>> 0;
  const t = to >>> 0;
  if (f > t) return { kind: 'none' };
  const pattern = [(bytes >>> 24) & 0xff, (bytes >>> 16) & 0xff, (bytes >>> 8) & 0xff, bytes & 0xff];
  const end = Math.min(t, MEMSIZE - 1);
  const length = f >= MEMSIZE ? 0 : end - f + 1;
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) data[i] = pattern[i % 4] ?? 0;
  return { kind: 'fill', from: f, data, stopped: t >= MEMSIZE };
}

export type SavePlan =
  /** Beep and the box `Invalid memory range.` titled `Information`. */
  | { kind: 'invalid' }
  /** Ask for a file and write `length` bytes from `from`. */
  | { kind: 'save'; from: number; length: number };

/** SaveClick (Memory1.cpp:625-659): `bytes = To - From + 1` as a signed int. */
export function planSave(from: number, to: number): SavePlan {
  const f = from >>> 0;
  const t = to >>> 0;
  const length = (t - f + 1) | 0;
  if (length <= 0 || t >= MEMSIZE) return { kind: 'invalid' };
  return { kind: 'save', from: f, length };
}

/* ------------------------------------------------------------------ keys and the wheel */

/**
 * The 8-bit character FormKeyPress would receive for a key, or null for a key that produces none.
 * `key` is KeyboardEvent.key; `encode` maps a code point to its Windows-1252 byte (null if none).
 * Enter, Backspace and Escape produce $0D, $08 and $1B as in the original; Ctrl+letter produces
 * the control character ($01-$1A).
 */
export function keyCharCode(
  key: string,
  modifiers: { ctrl: boolean; alt: boolean; meta: boolean },
  encode: (codePoint: number) => number | null,
): number | null {
  if (modifiers.meta) return null;
  if (key === 'Enter') return 0x0d;
  if (key === 'Backspace') return 0x08;
  if (key === 'Escape') return 0x1b;
  if (modifiers.ctrl && !modifiers.alt) {
    return /^[a-z]$/i.test(key) ? key.toUpperCase().charCodeAt(0) & 0x1f : null;
  }
  const points = Array.from(key);
  if (points.length !== 1) return null;
  const point = points[0]?.codePointAt(0);
  return point === undefined ? null : encode(point);
}

/**
 * Wheel steps: one row per notch. `accumulated` carries the remainder between events (trackpads
 * send many small events). A notch is 100 pixels (Chromium, WebKit) or 3 lines (deltaMode 1).
 */
export function wheelSteps(accumulated: number, deltaY: number, deltaMode: number): { steps: number; rest: number } {
  const unit = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
  const total = accumulated + deltaY / unit;
  const steps = Math.trunc(total);
  return { steps, rest: total - steps };
}

/** Parses the text of a hex field the way the original reads it: StrToInt("0x" + EditText). */
export function fieldValue(text: string): number {
  const value = parseInt(text, 16);
  return Number.isNaN(value) ? 0 : value >>> 0;
}
