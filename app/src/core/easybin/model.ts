// The state and behaviour of the EASyBIN window, without a DOM (docs/porting/easybin.md). Owner: B1.
//
// One model per application window holds the 16 MB memory image, the texts of the fields, the split,
// the cursor and the caption. Every handler of the original's form has a method here with the same
// rules; the feature (app/src/features/easybin) draws the state, asks the questions and moves files.
// Methods that the original ends with a message return it; showing it is the caller's job.
//
// Memory is a Uint8Array that the methods change in place; `revision` counts every change of memory
// or of what is shown, so that the view knows when to draw again.

import { binaryFileContents, binaryFileNames, binaryRangeValid, loadBinary } from './binary';
import { ASC_LEFT, ASC_RIGHT, HEX_LEFT, HEX_RIGHT, MEMSIZE, MESSAGES, TITLE, type Split } from './constants';
import { copyMemory, fillMemory } from './copy-fill';
import { hexText, hexUnsigned, hexValue, INITIAL_FIELDS, type EditableField, type EasybinFields } from './fields';
import { createLineBuffer, loadSRecord } from './srec-load';
import { sRecordFile, sRecordRangeValid } from './srec-save';

export interface EasybinState {
  fields: EasybinFields;
  split: Split;
  /** The original's window title: TITLE, or the name of the file last opened. */
  caption: string;
  /** The top row's address (`memAddr`), unsigned; above $FFFFFF only after section 10.2's case. */
  memAddr: number;
  /** Rows that fit (`nRows`); the view reports it. */
  rows: number;
  /** Cursor: visible row and character column (5.1). */
  row: number;
  col: number;
  /** Bumped on every change of memory or of the rows shown. */
  revision: number;
}

/** What a key in the memory area did (7.2, 7.4). */
export type KeyOutcome = 'done' | 'beep';

export interface SRecordSavePlan {
  from: number;
  to: number;
  start: number;
}
export interface BinarySavePlan {
  first: number;
  length: number;
  split: Split;
}

/** The colour class of a byte on screen (5.2): out of range, file 0..3, or past the end of memory. */
export type ByteTone = 'gray' | 'file0' | 'file1' | 'file2' | 'file3' | 'invalid';

export interface ViewRow {
  address: number;
  /** `%08X: ` */
  addressText: string;
  invalid: boolean;
  /** 16 cells: two hex digits, or `xx` past the end of memory. */
  hex: string[];
  tones: ByteTone[];
  /** 16 characters: the byte itself for $20..$7F, `-` otherwise (5.3). */
  ascii: string[];
}

const initialState = (): EasybinState => ({
  fields: { ...INITIAL_FIELDS },
  split: 0,
  caption: TITLE,
  memAddr: 0,
  rows: 18,
  row: 0,
  col: 0,
  revision: 0,
});

export class EasybinModel {
  /** The 68000 memory image, $FF at start (Form1u.cpp:136-140). */
  readonly memory = new Uint8Array(MEMSIZE).fill(0xff);
  /** `startAddr`, `endAddr`, `length` (Form1u.cpp:38-40). */
  startAddr = 0;
  endAddr = 0;
  length = 0;
  private readonly lbuf = createLineBuffer();
  private state: EasybinState = initialState();
  private readonly listeners = new Set<() => void>();

  getState = (): EasybinState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(change: Partial<EasybinState>, repaint = true): void {
    this.state = { ...this.state, ...change, revision: this.state.revision + (repaint ? 1 : 0) };
    for (const listener of [...this.listeners]) listener();
  }

  private setFields(change: Partial<EasybinFields>, extra: Partial<EasybinState> = {}): void {
    this.update({ fields: { ...this.state.fields, ...change }, ...extra });
  }

  /** Tells the model that memory was changed from outside its methods. */
  touch(): void {
    this.update({});
  }

  // ---------------------------------------------------------------- fields (4, 6.1)

  /** A field's new text, typed by the user or assigned by the program, with its OnChange. */
  setField(name: EditableField, text: string): void {
    if (name === 'address') {
      this.setAddressText(text);
      return;
    }
    this.setFields({ [name]: text });
  }

  /** `Address1->Text = text` followed by `Address1Change` (Form1u.cpp:485-499). */
  setAddressText(text: string): void {
    const value = hexUnsigned(text);
    if (value === null) {
      this.setFields({ address: text });
      return;
    }
    const memAddr = (value - (value % 16)) >>> 0;
    this.setFields({ address: hexText(memAddr, 6) }, { memAddr });
  }

  setRows(rows: number): void {
    const n = Math.max(0, Math.floor(rows));
    if (n !== this.state.rows) this.update({ rows: n, row: Math.min(this.state.row, Math.max(0, n - 1)) });
  }

  /** OutputSplitClick (Form1u.cpp:1001-1029). */
  setSplit(split: Split): void {
    if (split !== this.state.split) this.update({ split });
  }

  // ---------------------------------------------------------------- navigation (6.2)

  private topAddress(): number {
    return hexValue(this.state.fields.address) ?? 0;
  }

  rowUp(): void {
    let addr = this.topAddress() - 16;
    if (addr < 0) addr = 0;
    this.setAddressText(hexText(addr, 8));
  }

  rowDown(): void {
    let addr = this.topAddress() + 16;
    if (addr >= MEMSIZE) addr = MEMSIZE - 16;
    this.setAddressText(hexText(addr, 8));
  }

  pageUp(): void {
    let addr = this.topAddress() - this.state.rows * 16;
    if (addr <= 0) addr = 0;
    this.setAddressText(hexText(addr, 8));
  }

  pageDown(): void {
    let addr = this.topAddress() + this.state.rows * 16;
    if (addr >= MEMSIZE) addr = MEMSIZE - 16;
    this.setAddressText(hexText(addr, 8));
  }

  private wheelRest = 0;

  /**
   * The mouse wheel (6.2): the original runs Row down or Row up once per notch. A notch is taken as
   * 100 px of pixel delta or three lines; smaller deltas (touchpads) add up; a page delta pages.
   */
  wheel(deltaY: number, deltaMode: number): void {
    if (deltaMode === 2) {
      if (deltaY > 0) this.pageDown();
      else if (deltaY < 0) this.pageUp();
      return;
    }
    const delta = deltaMode === 1 ? (deltaY * 100) / 3 : deltaY;
    if (Math.sign(delta) !== Math.sign(this.wheelRest)) this.wheelRest = 0; // a change of direction starts afresh
    this.wheelRest += delta;
    while (this.wheelRest >= 100) {
      this.wheelRest -= 100;
      this.rowDown();
    }
    while (this.wheelRest <= -100) {
      this.wheelRest += 100;
      this.rowUp();
    }
  }

  // ---------------------------------------------------------------- cursor and typing (7)

  /** gotoRC (Form1u.cpp:733-765). */
  gotoRC(r: number, c: number): void {
    let row = r;
    let col = c;
    if (row < 0) {
      row = 0;
      this.rowUp();
    } else if (row > this.state.rows - 1) {
      row = Math.max(0, this.state.rows - 1);
      this.rowDown();
    }
    if (col < HEX_LEFT) col = HEX_LEFT;
    else if (col < ASC_LEFT) {
      if (col % 3 === 0) col++;
    } else if (col > ASC_RIGHT) col = ASC_RIGHT;
    this.update({ row, col }, false);
  }

  /** The cursor as it must be before the memory area takes keys: on a cell (the original's first click). */
  ensureCursor(): void {
    if (this.state.col < HEX_LEFT || this.state.row > this.state.rows - 1) this.gotoRC(this.state.row, this.state.col);
  }

  /** FormKeyDown (Form1u.cpp:435-470): arrows and page keys. */
  moveCursor(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'PageUp' | 'PageDown'): void {
    const { row, col } = this.state;
    switch (key) {
      case 'PageUp':
        this.pageUp();
        return;
      case 'PageDown':
        this.pageDown();
        return;
      case 'ArrowUp':
        this.gotoRC(row - 1, col);
        return;
      case 'ArrowDown':
        this.gotoRC(row + 1, col);
        return;
      case 'ArrowLeft': {
        let c = col - 1;
        if (c < 58 && c % 3 === 0) c--;
        this.gotoRC(row, c);
        return;
      }
      case 'ArrowRight':
        this.gotoRC(row, col + 1);
        return;
    }
  }

  /** FormMouseDown (Form1u.cpp:769-785): the character cell that was clicked. */
  place(row: number, col: number): void {
    this.gotoRC(row, col);
  }

  /** The address the cursor stands on (7.4 step 1), as the original's `int`. */
  cursorAddress(): { address: number; hex: boolean; low: boolean } {
    const { row, col } = this.state;
    let address = this.topAddress() + row * 16;
    if (col <= HEX_RIGHT) {
      address += Math.trunc((col - HEX_LEFT) / 3);
      return { address, hex: true, low: (col - HEX_LEFT) % 3 === 1 };
    }
    return { address: address + col - ASC_LEFT, hex: false, low: false };
  }

  /** FormKeyPress (Form1u.cpp:823-896) with the character's byte (Windows-1252). */
  typeByte(byte: number): KeyOutcome {
    const { address, hex, low } = this.cursorAddress();
    if (address >>> 0 >= MEMSIZE) return 'beep';
    let { row, col } = this.state;
    if (hex) {
      const key = byte >= 0x61 && byte <= 0x7a ? byte - 0x20 : byte;
      let data: number;
      if (key >= 0x30 && key <= 0x39) data = key - 0x30;
      else if (key >= 0x41 && key <= 0x46) data = key - 0x41 + 10;
      else return 'beep';
      const old = this.memory[address] as number;
      this.memory[address] = low ? (old & 0xf0) | data : (old & 0x0f) | (data << 4);
      col++;
      if (col > HEX_RIGHT) {
        col = HEX_LEFT;
        row++;
      }
    } else {
      this.memory[address] = byte & 0xff;
      col++;
      if (col > ASC_RIGHT) {
        col = ASC_LEFT;
        row++;
      }
    }
    this.gotoRC(row, col);
    this.touch();
    return 'done';
  }

  // ---------------------------------------------------------------- the display (5)

  /** The rows FormPaint draws: `rows` rows from memAddr, with their colours. */
  viewRows(): ViewRow[] {
    const { fields, split, rows } = this.state;
    const outFirst = hexUnsigned(fields.firstAddress) ?? 0;
    const outLength = hexUnsigned(fields.outLength) ?? 0;
    const outLast = outLength === 0 ? 0 : (outFirst + outLength - 1) >>> 0;
    const result: ViewRow[] = [];
    let addr = this.state.memAddr >>> 0;
    for (let r = 0; r < rows; r++) {
      const hex: string[] = [];
      const tones: ByteTone[] = [];
      const ascii: string[] = [];
      for (let i = 0; i < 16; i++) {
        const a = addr + i; // the original adds in unsigned int but compares before any wrap matters
        if (a >= MEMSIZE) {
          hex.push('xx');
          tones.push('invalid');
          ascii.push('-');
          continue;
        }
        const byte = this.memory[a] as number;
        hex.push(hexText(byte, 2));
        if (a < outFirst || a > outLast || outLength === 0) tones.push('gray');
        else if (split === 0) tones.push('file0');
        else tones.push(`file${(a - outFirst) % split}` as ByteTone);
        ascii.push(byte >= 0x20 && byte <= 0x7f ? String.fromCharCode(byte) : '-');
      }
      result.push({ address: addr, addressText: `${hexText(addr, 8)}: `, invalid: addr >= MEMSIZE, hex, tones, ascii });
      addr = (addr + 16) >>> 0;
    }
    return result;
  }

  // ---------------------------------------------------------------- File > New (9)

  /** NewExecute after OK (Form1u.cpp:359-374). */
  newEnvironment(): void {
    this.memory.fill(0xff);
    this.length = 0;
    this.startAddr = 0;
    this.endAddr = 0;
    this.update({
      caption: TITLE,
      fields: {
        ...this.state.fields,
        startAddress: '00000000',
        lastAddress: '000000',
        s68Length: '000000',
        address: '000000',
        firstAddress: '000000',
        outLength: '000000',
      },
      memAddr: 0,
      split: 0,
    });
  }

  // ---------------------------------------------------------------- Open S-Record (10)

  /** loadSrec and, when it succeeds, OpenSRecordFile's field updates (Form1u.cpp:202-224). */
  openSRecord(name: string, file: Uint8Array): { ok: boolean; message: string } {
    const result = loadSRecord(file, this.memory, this.lbuf);
    if (!result.ok) {
      this.touch();
      return { ok: false, message: result.message };
    }
    this.startAddr = result.startAddr;
    this.endAddr = result.endAddr;
    this.length = result.length;
    const startAddress = hexText(this.startAddr, 8);
    this.setFields({ startAddress }, { caption: name });
    this.setAddressText(startAddress);
    const address = this.state.fields.address;
    const length = hexText(this.length, 6);
    this.setFields({
      firstAddress: address,
      s68Length: length,
      outLength: length,
      lastAddress: hexText(this.endAddr, 6),
    });
    return { ok: true, message: result.message };
  }

  /** The message for a file Open S-Record cannot read (fileIO.cpp:115). */
  static cannotOpenSRecord(name: string): string {
    return MESSAGES.cannotOpenSrec(name);
  }

  // ---------------------------------------------------------------- Open Binary (12)

  /** loadBinary and OpenBinFile's field updates (Form1u.cpp:316-326). Returns the size; 0 = nothing. */
  openBinary(name: string, file: Uint8Array): number {
    const first = hexUnsigned(this.state.fields.firstAddress) ?? 0;
    const size = loadBinary(file, this.memory, first, this.state.split);
    if (size === 0) {
      this.touch();
      return 0;
    }
    this.length = size >>> 0;
    this.update({ caption: name, fields: { ...this.state.fields, startAddress: '00000000' } });
    this.setAddressText(this.state.fields.firstAddress);
    this.setFields({ outLength: hexText(this.length, 6) });
    return size;
  }

  // ---------------------------------------------------------------- Save S-Record (11)

  /** The text of the confirmation box (Form1u.cpp:291-293). */
  sRecordConfirmText(): string {
    const { from, to, startAddress } = this.state.fields;
    return MESSAGES.srecConfirm(from, to, startAddress);
  }

  /** saveSRecord's range check (fileIO.cpp:387-396); null = beep and `Invalid memory range.`. */
  sRecordPlan(): SRecordSavePlan | null {
    const from = hexUnsigned(this.state.fields.from) ?? 0;
    const to = hexUnsigned(this.state.fields.to) ?? 0;
    if (!sRecordRangeValid(from, to)) return null;
    return { from, to, start: hexUnsigned(this.state.fields.startAddress) ?? 0 };
  }

  sRecordBytes(plan: SRecordSavePlan): Uint8Array {
    return sRecordFile(this.memory, plan.from, plan.to, plan.start);
  }

  // ---------------------------------------------------------------- Save Binary (13)

  /** saveBinary's range check (fileIO.cpp:282-291); null = beep and `Invalid memory range.`. */
  binaryPlan(): BinarySavePlan | null {
    const first = hexUnsigned(this.state.fields.firstAddress) ?? 0;
    const length = hexUnsigned(this.state.fields.outLength) ?? 0;
    if (!binaryRangeValid(first, length)) return null;
    return { first, length, split: this.state.split };
  }

  /** The names to check and the files to write for the chosen file name. */
  binaryOutputs(
    plan: BinarySavePlan,
    fileName: string,
  ): { check: string[]; files: { name: string; data: Uint8Array }[] } {
    const names = binaryFileNames(fileName, plan.split);
    const contents = binaryFileContents(this.memory, plan.first, plan.length, plan.split);
    return {
      check: [...names.all],
      files: names.written.map((name, k) => ({ name, data: contents[k] as Uint8Array })),
    };
  }

  // ---------------------------------------------------------------- Copy, Fill (14)

  copy(): string | null {
    const { from, to, bytes } = this.state.fields;
    const outcome = copyMemory(this.memory, hexUnsigned(from) ?? 0, hexUnsigned(to) ?? 0, hexUnsigned(bytes) ?? 0);
    this.touch();
    return outcome.message;
  }

  fill(): string | null {
    const { from, to, fillByte } = this.state.fields;
    const outcome = fillMemory(
      this.memory,
      hexUnsigned(from) ?? 0,
      hexUnsigned(to) ?? 0,
      (hexValue(fillByte) ?? 0) & 0xff,
    );
    this.touch();
    return outcome.message;
  }
}
