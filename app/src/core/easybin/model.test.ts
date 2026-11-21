// The EASyBIN window rules of the model (docs/porting/easybin.md 5-9, 20.4, 20.5). Owner: B1.
// The file formats are checked against the original's code in oracle.test.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEMSIZE, TITLE } from './constants';
import { hexValue } from './fields';
import { EasybinModel } from './model';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const text = (s: string) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));

function model(rows = 18): EasybinModel {
  const m = new EasybinModel();
  m.setRows(rows);
  return m;
}

describe('fields', () => {
  it('StrToInt("0x" + text) is a signed 32-bit number', () => {
    expect(hexValue('001000')).toBe(0x1000);
    expect(hexValue('FFFFFFF0')).toBe(-16);
    expect(hexValue('ff')).toBe(255);
    expect(hexValue('')).toBeNull();
    expect(hexValue('123456789')).toBeNull();
  });

  it('start with the blank character 0 and FF in the fill byte', () => {
    const { fields } = model().getState();
    expect(fields).toMatchObject({ startAddress: '00000000', address: '000000', fillByte: 'FF', from: '000000' });
  });
});

describe('the memory display (5)', () => {
  it('rows of `%08X: `, 16 bytes and 16 characters; signed ASCII test', () => {
    const m = model(2);
    m.memory.set([0x41, 0x7e, 0x1f, 0x80, 0x7f, 0x20, 0x00, 0xe9], 0);
    const [first] = m.viewRows();
    expect(first?.addressText).toBe('00000000: ');
    expect(first?.hex.slice(0, 9)).toEqual(['41', '7E', '1F', '80', '7F', '20', '00', 'E9', 'FF']);
    expect(first?.ascii.slice(0, 9).join('')).toBe('A~--\x7f --' + '-');
  });

  it('colours: out of the binary range gray, files 0-3 by (address - first) % split', () => {
    const m = model(1);
    expect(new Set(m.viewRows()[0]?.tones)).toEqual(new Set(['gray'])); // Length 0
    m.setField('firstAddress', '000002');
    m.setField('outLength', '000008');
    expect(m.viewRows()[0]?.tones.slice(0, 11)).toEqual([
      'gray',
      'gray',
      'file0',
      'file0',
      'file0',
      'file0',
      'file0',
      'file0',
      'file0',
      'file0',
      'gray',
    ]);
    m.setSplit(2);
    expect(m.viewRows()[0]?.tones.slice(1, 6)).toEqual(['gray', 'file0', 'file1', 'file0', 'file1']);
    m.setSplit(4);
    expect(m.viewRows()[0]?.tones.slice(2, 8)).toEqual(['file0', 'file1', 'file2', 'file3', 'file0', 'file1']);
  });

  it('rows past $FFFFFF are red with xx; the top row may be $FFFFF0', () => {
    const m = model(3);
    m.setField('address', 'FFFFF0');
    const rows = m.viewRows();
    expect(rows.map((r) => r.addressText)).toEqual(['00FFFFF0: ', '01000000: ', '01000010: ']);
    expect(rows.map((r) => r.invalid)).toEqual([false, true, true]);
    expect(rows[1]?.hex[0]).toBe('xx');
    expect(rows[1]?.tones[0]).toBe('invalid');
  });
});

describe('navigation (6)', () => {
  it('the Address field rounds down to 16 and shows six digits', () => {
    const m = model();
    m.setField('address', '001234');
    expect(m.getState().fields.address).toBe('001230');
    expect(m.getState().memAddr).toBe(0x1230);
    m.setAddressText('00001000'); // eight digits from the program
    expect(m.getState().fields.address).toBe('001000');
  });

  it('Row and Page with the clamps of 6.2', () => {
    const m = model(18);
    m.rowUp();
    expect(m.getState().fields.address).toBe('000000');
    m.rowDown();
    expect(m.getState().fields.address).toBe('000010');
    m.pageDown();
    expect(m.getState().fields.address).toBe('000130');
    m.pageUp();
    m.pageUp();
    expect(m.getState().fields.address).toBe('000000');
    m.setField('address', 'FFFF00');
    m.pageDown();
    expect(m.getState().fields.address).toBe('FFFFF0');
    m.rowDown();
    expect(m.getState().fields.address).toBe('FFFFF0');
  });

  it('the wheel: one row per notch, touchpad deltas add up, a page delta pages', () => {
    const m = model(10);
    m.wheel(100, 0);
    expect(m.getState().memAddr).toBe(0x10);
    m.wheel(60, 0);
    expect(m.getState().memAddr).toBe(0x10);
    m.wheel(60, 0);
    expect(m.getState().memAddr).toBe(0x20);
    m.wheel(-3, 1);
    expect(m.getState().memAddr).toBe(0x10);
    m.wheel(1, 2);
    expect(m.getState().memAddr).toBe(0xb0);
  });
});

describe('cursor and typing (7)', () => {
  it('gotoRC: address column, spaces, past the ASCII column', () => {
    const m = model(4);
    m.place(0, 3);
    expect(m.getState().col).toBe(10);
    m.place(0, 12);
    expect(m.getState().col).toBe(13);
    m.place(0, 57);
    expect(m.getState().col).toBe(58);
    m.place(0, 90);
    expect(m.getState().col).toBe(73);
  });

  it('a click below the last whole row scrolls one row (Q12); row -1 scrolls up', () => {
    const m = model(4);
    m.setField('address', '000100');
    m.place(4, 20);
    expect(m.getState().row).toBe(3);
    expect(m.getState().fields.address).toBe('000110');
    m.place(-1, 20);
    expect(m.getState().row).toBe(0);
    expect(m.getState().fields.address).toBe('000100');
  });

  it('arrow keys at the edges', () => {
    const m = model(4);
    m.place(0, 10);
    m.moveCursor('ArrowLeft');
    expect(m.getState().col).toBe(10);
    m.place(0, 13);
    m.moveCursor('ArrowLeft');
    expect(m.getState().col).toBe(11);
    m.place(0, 58);
    m.moveCursor('ArrowLeft');
    expect(m.getState().col).toBe(56);
    m.moveCursor('ArrowRight');
    expect(m.getState().col).toBe(58);
    m.place(0, 73);
    m.moveCursor('ArrowRight');
    expect(m.getState().col).toBe(73);
    m.moveCursor('ArrowUp'); // scrolls up at address 0: stays
    expect(m.getState()).toMatchObject({ row: 0, memAddr: 0 });
    m.place(3, 20);
    m.moveCursor('ArrowDown');
    expect(m.getState()).toMatchObject({ row: 3, memAddr: 0x10 });
  });

  it('hex typing writes the nibbles and wraps to the next row; other keys beep', () => {
    const m = model(2);
    m.place(0, 10);
    expect(m.typeByte(0x61)).toBe('done'); // 'a'
    expect(m.memory[0]).toBe(0xaf);
    expect(m.getState().col).toBe(11);
    expect(m.typeByte(0x31)).toBe('done');
    expect(m.memory[0]).toBe(0xa1);
    expect(m.getState().col).toBe(13);
    expect(m.typeByte(0x47)).toBe('beep'); // 'G'
    m.place(1, 56);
    m.typeByte(0x32);
    expect(m.memory[0x1f]).toBe(0xf2);
    expect(m.getState()).toMatchObject({ row: 1, col: 10, memAddr: 0x10 }); // scrolled one row
  });

  it('ASCII typing stores any byte, control characters too, and wraps', () => {
    const m = model(2);
    m.place(0, 72);
    m.typeByte(0x08);
    expect(m.memory[14]).toBe(0x08);
    m.typeByte(0xe9);
    expect(m.memory[15]).toBe(0xe9);
    expect(m.getState()).toMatchObject({ row: 1, col: 58 });
  });

  it('typing at an address past the end beeps and does not move', () => {
    const m = model(3);
    m.setField('address', 'FFFFF0');
    m.place(1, 10);
    expect(m.typeByte(0x31)).toBe('beep');
    expect(m.getState()).toMatchObject({ row: 1, col: 10 });
  });

  it('editing anywhere in 16 MB: the last byte', () => {
    const m = model(1);
    m.setField('address', 'FFFFF0');
    m.place(0, 56);
    m.typeByte(0x30);
    expect(m.memory[MEMSIZE - 1]).toBe(0xf0);
  });
});

describe('File > New (9) and the opens (10.2, 12.1)', () => {
  it('New: memory $FF, the fields of section 9, split 1 file; From/To kept', () => {
    const m = model();
    m.memory[5] = 0;
    m.setSplit(4);
    m.setField('from', '001000');
    m.openSRecord('/browser/a.S68', fixture('asm-hello.S68'));
    m.newEnvironment();
    const state = m.getState();
    expect(m.memory[5]).toBe(0xff);
    expect(m.memory[0x1000]).toBe(0xff);
    expect(state.split).toBe(0);
    expect(state.caption).toBe(TITLE);
    expect(state.fields).toMatchObject({
      startAddress: '00000000',
      lastAddress: '000000',
      s68Length: '000000',
      address: '000000',
      firstAddress: '000000',
      outLength: '000000',
      from: '001000',
    });
  });

  it('Open S-Record fills the six fields and the caption', () => {
    const m = model();
    expect(m.openSRecord('/browser/demo/asm-hello.S68', fixture('asm-hello.S68')).ok).toBe(true);
    expect(m.getState().caption).toBe('/browser/demo/asm-hello.S68');
    expect(m.getState().fields).toMatchObject({
      startAddress: '00001000',
      lastAddress: '001022',
      s68Length: '000023',
      address: '001000',
      firstAddress: '001000',
      outLength: '000023',
    });
  });

  it('First Address is the start rounded down to 16 (Q2)', () => {
    const m = model();
    m.openSRecord('odd', text('S1051004AABB91\r\n'));
    expect(m.getState().fields).toMatchObject({ startAddress: '00001004', address: '001000', firstAddress: '001000' });
  });

  it('an S-record without data leaves eight digits (Q16)', () => {
    const m = model(2);
    m.openSRecord('empty', fixture('only-s0-s8.S68'));
    expect(m.getState().fields).toMatchObject({
      startAddress: 'FFFFFFFF',
      address: 'FFFFFFF0',
      firstAddress: 'FFFFFFF0',
      s68Length: '000002',
      lastAddress: '000000',
    });
    const rows = m.viewRows();
    expect(rows[0]?.addressText).toBe('FFFFFFF0: ');
    expect(rows[0]?.invalid).toBe(true);
    expect(rows[1]?.addressText).toBe('00000000: '); // the unsigned address wraps
    m.rowDown();
    expect(m.getState().fields.address).toBe('000000');
  });

  it('a failed open changes no field', () => {
    const m = model();
    const before = m.getState().fields;
    expect(m.openSRecord('bad', fixture('bad-type4.S68')).ok).toBe(false);
    expect(m.getState().fields).toEqual(before);
    expect(m.memory[0x1000]).toBe(1); // the records before the error stay
  });

  it('Open Binary: Start Address 0, the top row at First Address, Length; an empty file does nothing', () => {
    const m = model();
    m.setField('firstAddress', '002005');
    expect(m.openBinary('/browser/x.BIN', fixture('bin5.BIN'))).toBe(5);
    expect(m.getState().fields).toMatchObject({ startAddress: '00000000', address: '002000', outLength: '000005' });
    expect(m.getState().caption).toBe('/browser/x.BIN');
    const before = m.getState();
    expect(m.openBinary('/browser/e.BIN', fixture('bin0.BIN'))).toBe(0);
    expect(m.getState().caption).toBe(before.caption);
  });
});

describe('save plans', () => {
  it('the confirmation text of Save S-Record', () => {
    const m = model();
    m.setField('from', '001000');
    m.setField('to', '001023');
    m.setField('startAddress', '00001000');
    expect(m.sRecordConfirmText()).toBe(
      'S-Record file information:\n\nFrom:$001000  To:$001023\nStart Address:$00001000\n\nCreate S-Record?',
    );
    expect(m.sRecordPlan()).toEqual({ from: 0x1000, to: 0x1023, start: 0x1000 });
    m.setField('to', '000FFF');
    expect(m.sRecordPlan()).toBeNull();
  });

  it('binary names and the range check', () => {
    const m = model();
    m.setField('firstAddress', 'FFFFF0');
    m.setField('outLength', '000010');
    expect(m.binaryPlan()).toBeNull();
    m.setField('outLength', '00000F');
    m.setSplit(2);
    const plan = m.binaryPlan();
    expect(plan).not.toBeNull();
    const out = m.binaryOutputs(plan!, '/browser/p/prog.BIN');
    expect(out.check).toEqual([
      '/browser/p/prog_0.BIN',
      '/browser/p/prog_1.BIN',
      '/browser/p/prog_2.BIN',
      '/browser/p/prog_3.BIN',
    ]);
    expect(out.files.map((f) => [f.name, f.data.length])).toEqual([
      ['/browser/p/prog_0.BIN', 8],
      ['/browser/p/prog_1.BIN', 8],
    ]);
    m.setSplit(0);
    expect(m.binaryOutputs(m.binaryPlan()!, '/browser/p/prog.BIN').files.map((f) => f.name)).toEqual([
      '/browser/p/prog.BIN',
    ]);
  });
});
