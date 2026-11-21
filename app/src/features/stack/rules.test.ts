import { describe, expect, it } from 'vitest';
import { STACK_CHOICES, centreOn, scrollMid, stackRegister, stackRowText, stackRows, stackWheelSteps } from './rules';

const off = { enabled: false, start: 0, end: 0 };
const zero = () => 0;

describe('which stack (sim-ui §11.2)', () => {
  it('offers A0..A6, US, SS and indexes A[] directly', () => {
    expect([...STACK_CHOICES]).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'US', 'SS']);
    const registers = { a: [10, 11, 12, 13, 14, 15, 16], usp: 0xff0000, ssp: 0x1000000 };
    expect(stackRegister(registers, 0)).toBe(10);
    expect(stackRegister(registers, 6)).toBe(16);
    expect(stackRegister(registers, 7)).toBe(0xff0000);
    expect(stackRegister(registers, 8)).toBe(0x1000000);
  });

  it('forces the middle address even, as C int arithmetic does', () => {
    expect(centreOn(0x1001)).toEqual({ aregAddr: 0x1001, midAddr: 0x1000 });
    expect(centreOn(0x1000)).toEqual({ aregAddr: 0x1000, midAddr: 0x1000 });
    // A negative int rounds towards zero: -1 % 2 == -1, so -1 becomes 0.
    expect(centreOn(0xffffffff)).toEqual({ aregAddr: -1, midAddr: 0 });
  });
});

describe('drawing (sim-ui §11.3)', () => {
  it('puts the selected pointer on the middle row, lower addresses above', () => {
    const rows = stackRows({ midAddr: 0xfefffc, aregAddr: 0xfefffc, rows: 5, a7: 0, invalid: off, byteAt: zero });
    expect(rows.map((row) => row.address)).toEqual([0xfefff4, 0xfefff8, 0xfefffc, 0xff0000, 0xff0004]);
    expect(rows[2]?.bytes[0]?.mark).toBe('reg');
    expect(rows[2]?.bytes.slice(1).every((byte) => byte.mark === null)).toBe(true);
  });

  it('formats a row as "%08X: " and four "%02hX "', () => {
    const bytes = [0x00, 0x00, 0x10, 0x0a];
    const [row] = stackRows({
      midAddr: 0xfefffc,
      aregAddr: 0,
      rows: 1,
      a7: 0,
      invalid: off,
      byteAt: (address) => bytes[address - 0xfefffc] ?? 0,
    });
    expect(stackRowText(row!)).toBe('00FEFFFC: 00 00 10 0A ');
  });

  it('at reset (SS = $01000000): nothing aqua, yellow on the middle row at 00000000', () => {
    const { aregAddr, midAddr } = centreOn(0x1000000);
    const rows = stackRows({ midAddr, aregAddr, rows: 7, a7: 0x1000000, invalid: off, byteAt: zero });
    expect(rows[3]?.address).toBe(0);
    expect(rows[2]?.address).toBe(0xfffffc);
    expect(rows.flatMap((row) => row.bytes).filter((byte) => byte.mark === 'reg')).toEqual([]);
    const yellow = rows.flatMap((row) => row.bytes).filter((byte) => byte.mark === 'sp');
    expect(yellow.map((byte) => byte.address)).toEqual([0]);
    expect(rows[3]?.bytes[0]?.mark).toBe('sp');
  });

  it('aqua wins over yellow; only the single byte at the pointer is coloured', () => {
    const rows = stackRows({ midAddr: 0x8000, aregAddr: 0x8000, rows: 3, a7: 0x8000, invalid: off, byteAt: zero });
    expect(rows[1]?.bytes.map((byte) => byte.mark)).toEqual(['reg', null, null, null]);
    const both = stackRows({ midAddr: 0x8000, aregAddr: 0x8000, rows: 3, a7: 0x1008002, invalid: off, byteAt: zero });
    // The active stack pointer is masked to 24 bits: $01008002 marks $008002.
    expect(both[1]?.bytes.map((byte) => byte.mark)).toEqual(['reg', null, 'sp', null]);
  });

  it('red text for bytes inside the enabled Invalid range only', () => {
    const rows = stackRows({
      midAddr: 0x100,
      aregAddr: 0,
      rows: 1,
      a7: 0,
      invalid: { enabled: true, start: 0x101, end: 0x102 },
      byteAt: zero,
    });
    expect(rows[0]?.bytes.map((byte) => byte.invalid)).toEqual([false, true, true, false]);
    const disabled = stackRows({
      midAddr: 0x100,
      aregAddr: 0,
      rows: 1,
      a7: 0,
      invalid: { enabled: false, start: 0x101, end: 0x102 },
      byteAt: zero,
    });
    expect(disabled[0]?.bytes.some((byte) => byte.invalid)).toBe(false);
  });

  it('wraps addresses within 24 bits', () => {
    const rows = stackRows({ midAddr: 4, aregAddr: 4, rows: 5, a7: 0, invalid: off, byteAt: (a) => a & 0xff });
    expect(rows.map((row) => row.address)).toEqual([0xfffffc, 0, 4, 8, 12]);
    expect(rows[0]?.bytes.map((byte) => byte.value)).toEqual([0xfc, 0xfd, 0xfe, 0xff]);
  });

  it('scrolls by one row of four bytes and counts wheel notches', () => {
    expect(scrollMid(0x100, -1)).toBe(0xfc);
    expect(scrollMid(0x100, 1)).toBe(0x104);
    expect(stackWheelSteps(0, 100, 0)).toEqual({ steps: 1, rest: 0 });
    expect(stackWheelSteps(0, -3, 1)).toEqual({ steps: -1, rest: 0 });
  });
});
