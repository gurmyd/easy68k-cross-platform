import { describe, expect, it } from 'vitest';
import { byteForCodePoint } from '../../core/codec/cp1252';
import {
  ASC_LEFT,
  ASC_RIGHT,
  HEX_LEFT,
  HEX_RIGHT,
  MEMSIZE,
  ROW_CHARS,
  addressFieldText,
  asciiCell,
  cellAddress,
  fieldValue,
  gotoRC,
  keyCharCode,
  memoryRow,
  memoryRowText,
  moveCell,
  pageDown,
  pageUp,
  planCopy,
  planFill,
  planSave,
  rowDown,
  rowUp,
  topAddressOf,
  typeChar,
  wheelSteps,
} from './rules';

const bytesAt = (base: number, bytes: number[]) => (address: number) => bytes[address - base] ?? 0;

describe('row format (sim-ui §10.1)', () => {
  it('equals the example of the specification', () => {
    const bytes = [0x10, 0x3c, 0x00, 0x0e, 0x43, 0xf9, 0x00, 0x00, 0x10, 0x12, 0x4e, 0x4f, 0xff, 0xff, 0xff, 0xff];
    expect(memoryRowText(0x1000, bytesAt(0x1000, bytes))).toBe(
      '00001000: 10 3C 00 0E 43 F9 00 00 10 12 4E 4F FF FF FF FF -<--C-----NO----',
    );
  });

  it('is 74 characters: address 0-9, hex 10-57, ASCII 58-73', () => {
    const text = memoryRowText(0xfffff0, () => 0x41);
    expect(text).toHaveLength(ROW_CHARS);
    expect(text.slice(0, 10)).toBe('00FFFFF0: ');
    expect(text.slice(10, 58)).toBe('41 '.repeat(16));
    expect(text.slice(58)).toBe('A'.repeat(16));
  });

  it('shows rows at or beyond MEMSIZE in red with xx and - placeholders', () => {
    const row = memoryRow(MEMSIZE, () => {
      throw new Error('must not read beyond MEMSIZE');
    });
    expect(row.addressText).toBe('01000000: ');
    expect(row.addressInvalid).toBe(true);
    expect(row.hex.join('')).toBe('xx '.repeat(16));
    expect(row.ascii.join('')).toBe('-'.repeat(16));
    expect(row.invalid.every(Boolean)).toBe(true);
    expect(memoryRow(MEMSIZE - 16, () => 0).addressInvalid).toBe(false);
  });
});

describe('the ASCII rule: $00-$1F and $80-$FF as "-"', () => {
  it('holds for every byte value', () => {
    for (let b = 0; b < 256; b++) {
      const expected = b >= 0x20 && b <= 0x7f ? String.fromCharCode(b) : '-';
      expect(asciiCell(b), `byte ${b.toString(16)}`).toBe(expected);
    }
    expect(asciiCell(0x7f)).toBe('\x7f');
    expect(asciiCell(0x20)).toBe(' ');
    expect(asciiCell(0x1f)).toBe('-');
    expect(asciiCell(0x80)).toBe('-');
  });
});

describe('navigation (sim-ui §10.2)', () => {
  it('rounds the Address field down to 16 and writes six digits', () => {
    expect(topAddressOf(0x123457)).toBe(0x123450);
    expect(topAddressOf(0x00000f)).toBe(0);
    expect(addressFieldText(0x1230)).toBe('001230');
    expect(addressFieldText(0xfffff0)).toBe('FFFFF0');
    expect(fieldValue('00FF00')).toBe(0xff00);
    expect(fieldValue('FFFFFFFF')).toBe(0xffffffff);
  });

  it('moves by a row with the limits 0 and $FFFFF0', () => {
    expect(rowUp(0x20)).toBe(0x10);
    expect(rowUp(0)).toBe(0);
    expect(rowDown(0x10)).toBe(0x20);
    expect(rowDown(0xffffe0)).toBe(0xfffff0);
    expect(rowDown(0xfffff0)).toBe(0xfffff0);
  });

  it('moves by a page of nRows*16 with the same limits', () => {
    expect(pageUp(0x1000, 10)).toBe(0x1000 - 160);
    expect(pageUp(0x50, 10)).toBe(0);
    expect(pageDown(0x1000, 10)).toBe(0x1000 + 160);
    expect(pageDown(0xffff00, 16)).toBe(0xfffff0);
    // A page that ends below MEMSIZE keeps rows beyond it on screen (they are drawn red).
    expect(pageDown(0xfff000, 40)).toBe(0xfff280);
  });
});

describe('cursor placement (gotoRC, sim-ui §10.3)', () => {
  it('keeps the cursor out of the address column', () => {
    expect(gotoRC(0, 0, 10)).toEqual({ row: 0, col: HEX_LEFT, scroll: 0 });
    expect(gotoRC(0, 9, 10)).toEqual({ row: 0, col: HEX_LEFT, scroll: 0 });
  });

  it('moves the cursor off the separator space after each hex byte', () => {
    expect(gotoRC(0, 12, 10).col).toBe(13);
    expect(gotoRC(0, 15, 10).col).toBe(16);
    expect(gotoRC(0, 57, 10).col).toBe(ASC_LEFT);
    expect(gotoRC(0, 11, 10).col).toBe(11);
  });

  it('clamps the ASCII column and scrolls one row at the top and bottom', () => {
    expect(gotoRC(0, 90, 10).col).toBe(ASC_RIGHT);
    expect(gotoRC(-1, 20, 10)).toEqual({ row: 0, col: 20, scroll: -1 });
    expect(gotoRC(10, 20, 10)).toEqual({ row: 9, col: 20, scroll: 1 });
  });

  it('moves with the arrow keys, skipping the separators', () => {
    const place = (row: number, col: number, key: Parameters<typeof moveCell>[1]) => {
      const moved = moveCell({ row, col }, key);
      const { row: r, col: c } = gotoRC(moved.row, moved.col, 10);
      return [r, c];
    };
    expect(place(0, 13, 'ArrowLeft')).toEqual([0, 11]);
    expect(place(0, 11, 'ArrowLeft')).toEqual([0, 10]);
    expect(place(0, 10, 'ArrowLeft')).toEqual([0, 10]);
    expect(place(0, ASC_LEFT, 'ArrowLeft')).toEqual([0, HEX_RIGHT]);
    expect(place(0, 11, 'ArrowRight')).toEqual([0, 13]);
    expect(place(0, HEX_RIGHT, 'ArrowRight')).toEqual([0, ASC_LEFT]);
    expect(place(0, ASC_RIGHT, 'ArrowRight')).toEqual([0, ASC_RIGHT]);
    expect(place(3, 20, 'ArrowUp')).toEqual([2, 20]);
    expect(place(3, 20, 'ArrowDown')).toEqual([4, 20]);
  });

  it('maps a cell to its address in the hex and the ASCII area', () => {
    expect(cellAddress(0x1000, { row: 0, col: 10 })).toBe(0x1000);
    expect(cellAddress(0x1000, { row: 0, col: 11 })).toBe(0x1000);
    expect(cellAddress(0x1000, { row: 1, col: 56 })).toBe(0x101f);
    expect(cellAddress(0x1000, { row: 2, col: 58 })).toBe(0x1020);
    expect(cellAddress(0x1000, { row: 2, col: 73 })).toBe(0x102f);
  });
});

describe('editing rules (FormKeyPress, sim-ui §10.3)', () => {
  const current = () => 0xab;

  it('replaces the high nibble, then the low nibble, and advances', () => {
    expect(typeChar(0x1000, { row: 0, col: 10 }, 0x35, current)).toEqual({
      kind: 'write',
      address: 0x1000,
      value: 0x5b,
      next: { row: 0, col: 11 },
    });
    expect(typeChar(0x1000, { row: 0, col: 11 }, 0x63 /* 'c' */, current)).toEqual({
      kind: 'write',
      address: 0x1000,
      value: 0xac,
      next: { row: 0, col: 12 },
    });
  });

  it('wraps from the last byte of a row to the first byte of the next', () => {
    const result = typeChar(0x1000, { row: 0, col: HEX_RIGHT }, 0x30, current);
    expect(result).toMatchObject({ kind: 'write', address: 0x100f, value: 0xa0, next: { row: 1, col: HEX_LEFT } });
  });

  it('beeps for a key that is not a hex digit in the hex area', () => {
    expect(typeChar(0x1000, { row: 0, col: 10 }, 0x47 /* G */, current)).toEqual({ kind: 'beep' });
    expect(typeChar(0x1000, { row: 0, col: 10 }, 0x0d, current)).toEqual({ kind: 'beep' });
  });

  it('stores the raw character in the ASCII area, control characters included', () => {
    expect(typeChar(0x1000, { row: 0, col: ASC_LEFT }, 0x0d, current)).toEqual({
      kind: 'write',
      address: 0x1000,
      value: 0x0d,
      next: { row: 0, col: ASC_LEFT + 1 },
    });
    expect(typeChar(0x1000, { row: 0, col: ASC_RIGHT }, 0x41, current)).toMatchObject({
      address: 0x100f,
      value: 0x41,
      next: { row: 1, col: ASC_LEFT },
    });
  });

  it('beeps for an address at or beyond MEMSIZE', () => {
    expect(typeChar(0xfffff0, { row: 1, col: 10 }, 0x31, current)).toEqual({ kind: 'beep' });
    expect(typeChar(0xfffff0, { row: 1, col: ASC_LEFT }, 0x31, current)).toEqual({ kind: 'beep' });
  });

  it('turns keys into the characters FormKeyPress receives', () => {
    const none = { ctrl: false, alt: false, meta: false };
    expect(keyCharCode('Enter', none, byteForCodePoint)).toBe(0x0d);
    expect(keyCharCode('Backspace', none, byteForCodePoint)).toBe(0x08);
    expect(keyCharCode('Escape', none, byteForCodePoint)).toBe(0x1b);
    expect(keyCharCode('a', none, byteForCodePoint)).toBe(0x61);
    expect(keyCharCode('é', none, byteForCodePoint)).toBe(0xe9);
    expect(keyCharCode('€', none, byteForCodePoint)).toBe(0x80);
    expect(keyCharCode('一', none, byteForCodePoint)).toBe(null);
    expect(keyCharCode('ArrowLeft', none, byteForCodePoint)).toBe(null);
    expect(keyCharCode('c', { ctrl: true, alt: false, meta: false }, byteForCodePoint)).toBe(0x03);
    expect(keyCharCode('v', { ctrl: false, alt: false, meta: true }, byteForCodePoint)).toBe(null);
    // AltGr on Windows reports Ctrl+Alt: the character counts.
    expect(keyCharCode('@', { ctrl: true, alt: true, meta: false }, byteForCodePoint)).toBe(0x40);
  });
});

describe('Copy (sim-ui §10.5)', () => {
  it('refuses To == From and Bytes == 0', () => {
    expect(planCopy(0x1000, 0x1000, 4)).toEqual({ kind: 'invalid' });
    expect(planCopy(0x1000, 0x2000, 0)).toEqual({ kind: 'invalid' });
  });

  it('From < To: both end addresses must be below MEMSIZE, nothing copied otherwise', () => {
    expect(planCopy(0x1000, 0x1002, 8)).toEqual({ kind: 'copy', from: 0x1000, to: 0x1002, count: 8, stopped: false });
    expect(planCopy(0x1000, 0xfffffc, 4)).toEqual({
      kind: 'copy',
      from: 0x1000,
      to: 0xfffffc,
      count: 4,
      stopped: false,
    });
    expect(planCopy(0x1000, 0xfffffc, 5)).toEqual({ kind: 'invalid' });
    expect(planCopy(0x10, 0x20, 0xfffffff0)).toEqual({ kind: 'invalid' });
  });

  it('From > To: copies upward and stops where From reaches MEMSIZE', () => {
    expect(planCopy(0x2000, 0x1000, 0x10)).toEqual({
      kind: 'copy',
      from: 0x2000,
      to: 0x1000,
      count: 0x10,
      stopped: false,
    });
    expect(planCopy(0xfffff8, 0x1000, 0x10)).toEqual({
      kind: 'copy',
      from: 0xfffff8,
      to: 0x1000,
      count: 8,
      stopped: true,
    });
    expect(planCopy(0xfffff8, 0x1000, 8)).toEqual({
      kind: 'copy',
      from: 0xfffff8,
      to: 0x1000,
      count: 8,
      stopped: false,
    });
  });
});

describe('Fill (sim-ui §10.5)', () => {
  it('repeats the 4-byte pattern from From through To inclusive, most significant byte first', () => {
    const plan = planFill(0x1000, 0x1009, 0x12345678);
    expect(plan.kind).toBe('fill');
    if (plan.kind !== 'fill') return;
    expect([...plan.data]).toEqual([0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0x56, 0x78, 0x12, 0x34]);
    expect(plan.from).toBe(0x1000);
    expect(plan.stopped).toBe(false);
  });

  it('typing only FF at the left of the Bytes field gives FF 00 00 00', () => {
    const plan = planFill(0, 7, fieldValue('FF000000'));
    expect(plan.kind === 'fill' && [...plan.data]).toEqual([0xff, 0, 0, 0, 0xff, 0, 0, 0]);
  });

  it('does nothing and says nothing when From > To; fills one byte when From == To', () => {
    expect(planFill(0x10, 0x0f, 0)).toEqual({ kind: 'none' });
    const one = planFill(0x10, 0x10, 0xaabbccdd);
    expect(one.kind === 'fill' && [...one.data]).toEqual([0xaa]);
  });
});

describe('Save (sim-ui §10.5)', () => {
  it('refuses To < From', () => {
    expect(planSave(0x1001, 0x1000)).toEqual({ kind: 'invalid' });
  });
  it('saves From through To inclusive', () => {
    expect(planSave(0x1000, 0x1000)).toEqual({ kind: 'save', from: 0x1000, length: 1 });
    expect(planSave(0, 0xffffff)).toEqual({ kind: 'save', from: 0, length: MEMSIZE });
  });
});

describe('the mouse wheel', () => {
  it('gives one row per notch and keeps the remainder', () => {
    expect(wheelSteps(0, 100, 0)).toEqual({ steps: 1, rest: 0 });
    expect(wheelSteps(0, -300, 0)).toEqual({ steps: -3, rest: 0 });
    const first = wheelSteps(0, 60, 0);
    expect(first.steps).toBe(0);
    expect(wheelSteps(first.rest, 60, 0).steps).toBe(1);
    expect(wheelSteps(0, 3, 1)).toEqual({ steps: 1, rest: 0 });
  });
});
