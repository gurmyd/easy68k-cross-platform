// The rules of the original Stack window (sim-ui §11, Stack1.cpp) as pure functions. Owner: U2.
//
// The original keeps `midAddr` and `AregAddr` in C `int` variables and masks only the row
// addresses to 24 bits (ADDRMASK). The functions below reproduce that arithmetic exactly, which
// is where the quirks of sim-ui §11.3 come from (at reset SS = $01000000, so nothing is aqua and
// the yellow mark sits on the middle row at address 00000000).

import type { MapRow, Registers } from '../../contracts';

export const ADDRMASK = 0x00ffffff;

/** The nine entries of the `View` list, by index (Stack1.dfm:107-127); index 8 (SS) is the default. */
export const STACK_CHOICES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'US', 'SS'] as const;
export const DEFAULT_STACK_CHOICE = 8;

const hex = (value: number, digits: number) => (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');

/** `A[index]` of the original: 0-6 A0-A6, 7 the user stack pointer, 8 the supervisor stack pointer. */
export function stackRegister(registers: Pick<Registers, 'a' | 'usp' | 'ssp'>, index: number): number {
  if (index === 7) return registers.usp >>> 0;
  if (index === 8) return registers.ssp >>> 0;
  return (registers.a[index] ?? 0) >>> 0;
}

/** updateDisplay(): `stackAddr = A[i]; AregAddr = stackAddr; stackAddr -= stackAddr % 2; midAddr = stackAddr`. */
export function centreOn(value: number): { aregAddr: number; midAddr: number } {
  const s = value | 0; // int
  return { aregAddr: s, midAddr: (s - (s % 2)) | 0 }; // C's % truncates toward zero, as JS's does
}

/** The spin button and the mouse wheel, `steps` rows: up (-1) shows lower addresses (midAddr -= 4). */
export function scrollMid(midAddr: number, steps: number): number {
  return (midAddr + steps * 4) | 0;
}

export interface StackByte {
  address: number;
  value: number;
  /** "%02hX " */
  text: string;
  /** Background: 'reg' (aqua) = the selected register's address; 'sp' (yellow) = the active stack pointer. */
  mark: 'reg' | 'sp' | null;
  /** Red text: the Hardware panel's Invalid range is enabled and contains the address. */
  invalid: boolean;
}

export interface StackRow {
  address: number;
  /** "%08X: " */
  addressText: string;
  bytes: StackByte[];
}

export interface StackPaintInput {
  midAddr: number;
  aregAddr: number;
  /** The visible rows (ClientHeight / rowHeight). */
  rows: number;
  /** `A[a_reg(7)]`: the active stack pointer. */
  a7: number;
  /** The Hardware panel's Invalid memory range (`InvalidMap`, `InvalidStart`, `InvalidEnd`). */
  invalid: MapRow;
  byteAt: (address: number) => number;
}

/** DisplayStack() (Stack1.cpp:72-120): the selected pointer's address is on the middle row. */
export function stackRows(input: StackPaintInput): StackRow[] {
  const { midAddr, aregAddr, rows, invalid, byteAt } = input;
  const a7 = (input.a7 & ADDRMASK) >>> 0;
  const midRow = Math.trunc(rows / 2);
  let dispAddr = ((midAddr - midRow * 4) | 0) & ADDRMASK;
  const out: StackRow[] = [];
  for (let r = 0; r < rows; r++) {
    const bytes: StackByte[] = [];
    for (let i = 0; i < 4; i++) {
      const address = dispAddr + i; // not masked, as in the original
      const value = byteAt(address & ADDRMASK) & 0xff;
      const mark = address === aregAddr ? 'reg' : address === a7 ? 'sp' : null;
      const isInvalid = invalid.enabled && address >= invalid.start && address <= invalid.end;
      bytes.push({ address, value, text: `${hex(value, 2)} `, mark, invalid: isInvalid });
    }
    out.push({ address: dispAddr, addressText: `${hex(dispAddr, 8)}: `, bytes });
    dispAddr = (dispAddr + 4) & ADDRMASK;
  }
  return out;
}

/** A row as text: "%08X: " and four "%02hX ", for example "00FEFFFC: 00 00 10 0A ". */
export function stackRowText(row: StackRow): string {
  return row.addressText + row.bytes.map((byte) => byte.text).join('');
}

/** Wheel steps as in the Memory panel: one row per notch (100 px, or 3 lines). */
export function stackWheelSteps(
  accumulated: number,
  deltaY: number,
  deltaMode: number,
): { steps: number; rest: number } {
  const unit = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
  const total = accumulated + deltaY / unit;
  const steps = Math.trunc(total);
  return { steps, rest: total - steps };
}
