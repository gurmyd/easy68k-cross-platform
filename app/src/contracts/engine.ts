// Contract: the two engines as the application sees them (ARCHITECTURE.md 3.2).
//
// This is a typed mirror of engine/asm/asm68k.mjs and engine/sim/sim68k.mjs. For
// the engine boundary the engine's own module wins: when a module changes, W4
// changes this mirror (its tests compare the names mechanically). The constant
// objects below carry the same numbers as the modules' Status, Reg, Box, Option,
// MapKind, Device, Shift, Repaint and FileMode objects under the names section 3
// uses; app/src/engine/ (W4) translates where a name differs.
//
// The application never imports the engine modules directly; it imports
// app/src/engine/ (W4), which loads them and gives them these types.
//
// Owner: W1. Contracts import nothing (3.1).

export type Bytes = Uint8Array;

/* ------------------------------------------------------------------ assembler (mirror of asm68k.mjs) */

/** Tab expansion of the listing. asm68k.mjs accepts 0 / 1 as well as 'assembly' / 'fixed'. */
export const TabType = { Assembly: 0, Fixed: 1 } as const;
export type TabType = (typeof TabType)[keyof typeof TabType];

/** Options of one assembly. See editor-ui §11.1 and assembler §2. Keys = asm68k.mjs DEFAULT_OPTIONS. */
export interface AsmOptions {
  generateListing: boolean; // "Generate List File" (decides whether the .L68 is produced)
  generateSRecord: boolean; // "Generate S-Record"   objFlag
  constantsExpanded: boolean; // CEXflag
  bitFieldInstructions: boolean; // BITflag
  crossReference: boolean; // CREflag
  macrosExpanded: boolean; // MEXflag
  structuredExpanded: boolean; // SEXflag
  showWarnings: boolean; // WARflag; hidden warnings are still counted
  tabType: TabType; // of the document being assembled (used by the listing)
  tabSize: number; // of the document being assembled
}

/** One row of the editor's message list. */
export interface AsmMessage {
  /** lineNum of assembler §4.4: 1-based line in the file the message belongs to; 0 for the
   *  uncounted exception rows. */
  line: number;
  severity: 'warning' | 'error';
  code: number; // the engine's status code
  /** Without line end; starts with "ERROR: " or "WARNING: ". */
  text: string;
  /** null = the main document; otherwise the INCLUDE file name as the assembler holds it. */
  file: string | null;
  /** For an include file: the key of `files` it was read from. */
  resolvedFile: string | null;
}

/** A message box the original would have shown during the assembly. */
export interface AsmDialog {
  caption: string;
  text: string;
}

export interface AsmResult {
  listing: Bytes | null; // the .L68 file exactly as the original writes it (CR LF); null if not produced
  listingName: string; // mainName with the extension replaced by ".L68"
  sRecord: Bytes | null; // the .S68 file (CR LF); null if not produced
  sRecordName: string;
  messages: AsmMessage[]; // in the order the editor shows them
  errorCount: number;
  warningCount: number;
  executeEnabled: boolean; // state of the Execute button of the original's status dialog
  dialogs: AsmDialog[]; // in order
  status: number; // the engine's own return value; -1 when `fatal` is set
  /** null normally. Otherwise the run ended abnormally - the original would have ended the whole
   *  editor process, the engine trapped, or no engine instance could be created ("The assembler
   *  could not start: ...") - and the other fields are empty. */
  fatal: string | null;
}

export interface AsmEngine {
  /** Assembles as the original's "Assemble Source" does.
   *  mainName: name of the main source inside the file tree that `files` describes, '/' or '\'
   *    separators, e.g. "demo/prog.X68"; it must be a key of `files`. Its folder is the current
   *    directory of the assembly: INCLUDE and INCBIN names resolve against it.
   *  files: every file the program may read. The entry of mainName is the EDITOR BUFFER as
   *    encodeForAssembler() produces it (3.9.3), not the stored file. The other entries are files as
   *    stored.
   *  timestamp: local date and time for the "Created On:" line; the engine formats it.
   *  Every call runs in a fresh WebAssembly instance of the once-compiled module (assembler §1.8).
   *  Resolves for everything that can happen to a program. Rejects only for arguments this
   *  comment forbids: a mainName that is not a key of `files`, a tabSize that is not an integer
   *  from -99 to 99, an invalid Date. */
  assemble(
    mainName: string,
    files: ReadonlyMap<string, Bytes>,
    options: AsmOptions,
    timestamp: Date,
  ): Promise<AsmResult>;
}

/* ------------------------------------------------------------------ simulator (mirror of sim68k.mjs) */

/** sim68k.mjs `Status` (RUNNING, STOPPED, WAIT_INPUT, WAIT_DELAY, WAIT_HOST, WAIT_ALERT, ERROR, BUSY). */
export const RunStatus = {
  Running: 0, // budget used up, program still running: call run() again
  Stopped: 1, // trace step done, breakpoint, halt, pause
  WaitInput: 2, // tasks 2, 4, 5, 18: deliver keys with keyChar(), then run()
  WaitDelay: 3, // task 23: report time with delayElapsed(), then run()
  WaitHost: 4, // task 58 dialog open: fileDialogReply(), then run()
  WaitAlert: 5, // a message box is open (host.alert): dismissAlert(), then run()
  Error: 6, // the original's "Unexpected error in runLoop"
  Busy: -1, // command refused because a step is suspended; nothing happened
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

/** sim68k.mjs `Reg` (OldPC is the module's OLD_PC; read-only). */
export const Reg = {
  D0: 0,
  D1: 1,
  D2: 2,
  D3: 3,
  D4: 4,
  D5: 5,
  D6: 6,
  D7: 7,
  A0: 8,
  A1: 9,
  A2: 10,
  A3: 11,
  A4: 12,
  A5: 13,
  A6: 14,
  USP: 15,
  SSP: 16,
  PC: 17,
  SR: 18,
  A7: 19,
  OldPC: 20,
} as const;
export type Reg = (typeof Reg)[keyof typeof Reg];

/** The twenty register text boxes of the original main window (sim68k.mjs `Box`). */
export const Box = {
  D0: 0,
  D1: 1,
  D2: 2,
  D3: 3,
  D4: 4,
  D5: 5,
  D6: 6,
  D7: 7,
  A0: 8,
  A1: 9,
  A2: 10,
  A3: 11,
  A4: 12,
  A5: 13,
  A6: 14,
  A7: 15,
  US: 16,
  SS: 17,
  PC: 18,
  SR: 19,
} as const;
export type Box = (typeof Box)[keyof typeof Box];

/** sim68k.mjs `Option` (EXCEPTIONS, BITFIELD, SIMHALT, EXEC_LOG_TYPE, ...). */
export const SimOption = {
  Exceptions: 0,
  BitField: 1,
  SimHalt: 2,
  ExecLogType: 3,
  OutputLogType: 4,
  LogMemFrom: 5,
  LogMemBytes: 6,
  DisableDisplay: 7,
  MemLive: 8,
  MainMonitor: 9,
  FullscreenMonitor: 10,
  Fullscreen: 11,
} as const;
export type SimOption = (typeof SimOption)[keyof typeof SimOption];

/** sim68k.mjs `MapKind` (ROM, READ, PROTECTED, INVALID). */
export const MapKind = { Rom: 0, Read: 1, Protected: 2, Invalid: 3 } as const;
export type MapKind = (typeof MapKind)[keyof typeof MapKind];
/** sim68k.mjs `Device` (SEG7, LED, SWITCH, PUSH_BUTTON). */
export const HwDevice = { Seg7: 0, Led: 1, Switch: 2, PushButton: 3 } as const;
export type HwDevice = (typeof HwDevice)[keyof typeof HwDevice];

/** Shift-state bits of the mouse methods (the VCL's TShiftState; sim68k.mjs `Shift`). */
export const ShiftBit = { Shift: 1, Alt: 2, Ctrl: 4, Left: 8, Right: 16, Middle: 32, Double: 64 } as const;
/** Bits of SimHost.repaint() (sim68k.mjs `Repaint`). */
export const RepaintBit = { Listing: 1, Breakpoints: 2, Memory: 4, Stack: 8 } as const;
/** Modes of SimHost.fileOpen(): fopen "r+b", "rb", "w+b" (sim68k.mjs `FileMode`). */
export const FileMode = { Update: 0, Read: 1, Create: 2 } as const;
/** Arguments of SimHost.fontAssign(). */
export const FontTarget = { IoBackBuffer: 1, IoWindow: 2, Listing: 3, Headings: 4, Messages: 5, Printer: 6 } as const;
export const FontSource = { IoDialog: 101, ListingDialog: 102, PrinterDialog: 103 } as const;
/** Arguments of SimHost.printerMetric(). */
export const PrinterMetric = { RowHeight: 0, ColWidth: 1, PageHeight: 2, PageWidth: 3 } as const;

/** What Sim68k.state() returns (sim68k.mjs `SimState`). */
export interface SimStateFlags {
  runMode: boolean;
  trace: boolean;
  sstep: boolean;
  halt: boolean;
  inputMode: boolean;
  hardwareEnabled: boolean;
  autoIRQ: boolean;
  stopInstruction: boolean;
  logging: boolean;
  autoTraceTimer: boolean;
  menuState: number;
  phase: number;
  irq: number;
  alertOpen: boolean;
  pendingKey: number;
  keyCommandsDisabled: boolean;
  startPC: number;
  errflg: boolean;
  stepToAddr: number;
  runToAddr: number;
  autoTraceInProgress: boolean;
  fileDialogOpen: boolean;
}

export interface MapRow {
  enabled: boolean;
  start: number;
  end: number;
}

export interface Registers {
  d: number[]; // D0-D7, unsigned 32-bit
  a: number[]; // A0-A6, unsigned 32-bit
  usp: number;
  ssp: number;
  a7: number;
  pc: number;
  sr: number;
  cycles: bigint;
}

/** State of the controls of the original hardware form, as the engine holds it. */
export interface HardwareControls {
  seg7: number; // the four device addresses
  led: number;
  switches: number;
  pushButtons: number;
  map: MapRow[]; // indexed by MapKind
  auto: ({ checked: boolean; timerEnabled: boolean; intervalMs: number } | null)[]; // index 1..7
  switchOn: boolean[]; // picture state, index = bit
  visible: boolean;
  selectedAutoIrq: number; // 1..7, 8 = the empty entry
  intervalBox: number;
}

/** One row of the Registers or Memory grid of the Break Points panel (sim-core §7.2). */
export interface BreakCondition {
  enabled?: boolean;
  id?: number;
  type: number; // 0 PC/register, 1 memory address
  typeId: number; // register: 0-7 D0-D7, 8-15 A0-A7, 16 PC; memory: the address
  op: number; // 0 ==, 1 !=, 2 >, 3 >=, 4 <, 5 <=, 6 N/A
  value: number;
  size: number; // 0 B, 1 W, 2 L
  readWrite?: number; // 0 R/W, 1 Read, 2 Write, 3 N/A (memory only)
}
/** One row of the Expression Builder grid (sim-core §7.3). Tokens: 0-99 condition slot, 100 AND, 101 OR. */
export interface BreakExpression {
  enabled?: boolean;
  id?: number;
  count?: number;
  postfix: number[];
}

export type LoadKind = 'open' | 'reload' | 'drop';

/** The instance createSim() returns (class Sim68k). Every method is synchronous and returns at once. */
export interface SimEngine {
  /* memory: direct access, bypasses the memory map and the breakpoint flags (like the Memory window) */
  readonly memory: Uint8Array; // live 16 MiB view; re-read the property, never cache it
  readByte(address: number): number;
  readWord(address: number): number;
  readLong(address: number): number;
  writeBytes(address: number, bytes: ArrayLike<number>): void;

  /* loading: the engine keeps the listing, applies its start address and "*[sim68k]" directives.
     load(), close(), rewind() and cmdPause() end a pending wait and finish a suspended step themselves. */
  load(s68: Bytes | null, l68?: Bytes | null, options?: { name?: string | Bytes; kind?: LoadKind }): void;
  loadData(s68: Bytes | null, name?: string | Bytes): boolean; // File > Open Data
  close(): void; // File > Close, after the question
  rewind(): void;

  /* run control */
  cmdRun(): void;
  cmdRunToCursor(listingLine: number): void;
  cmdRunToAddress(address: number): void;
  cmdStepOver(): void;
  cmdTraceInto(): RunStatus;
  cmdPause(): void;
  cmdAutoTrace(): void; // switches the auto-trace timer on
  autoTraceTick(): RunStatus; // one tick of that timer
  /** Finishes a suspended step first, then executes at most maxInstructions NEW instructions while
   *  the program is in run mode. run(0) therefore finishes a suspended step and starts nothing. */
  run(maxInstructions?: number): RunStatus;
  readonly stepCount: number; // instruction steps completed, modulo 2^32

  /* ending a wait state */
  dismissAlert(): void;
  readonly delayRemaining: number;
  delayElapsed(periods: number): void; // periods of 10 ms
  fileDialogReply(accepted: boolean, fileName?: Bytes | string): void;

  /* keyboard and mouse of the I/O window */
  keyChar(ch: number): void; // FormKeyPress: one 8-bit character
  keyDown(virtualKey: number): boolean; // FormKeyDown; true = simulator key commands enabled
  keyUp(virtualKey: number): void;
  ioActivated(): void; // FormActivate: clears the key table of task 19
  mouseDown(x: number, y: number, shift: number): void;
  mouseUp(x: number, y: number, shift: number): void;
  mouseMove(x: number, y: number, shift: number): void;

  /* CPU state and the register boxes */
  getRegister(reg: Reg): number;
  setRegister(reg: Reg, value: number): void; // register and its box; OLD_PC untouched
  registers(): Registers;
  boxText(box: Box): string; // what the box shows; refreshed when the original refreshes
  editBox(box: Box, text: string): boolean; // the user typed in a box (sim-ui §4.4 rules inside)
  readonly cycles: bigint;
  readonly cyclesText: string; // the original's display text
  clearCycles(): void;
  state(): SimStateFlags;

  /* options and logging */
  setOption(option: SimOption, value: number | boolean): void;
  getOption(option: SimOption): number;
  logDialogOpened(): void; // the snapshot of sim-ui Q24
  startLog(timeString: string | Bytes): void; // writes the execution-log header through host.logWrite
  stopLog(): void;

  /* hardware form: the engine holds its controls and logic (hardware §2-§4) */
  irq(level: number): boolean; // IRQ button; true = call run()
  hardwareReset(): boolean;
  timerTick(level: number): boolean; // an auto-interrupt timer fired
  switchClick(n: number): void;
  pushButton(n: number, down: boolean): void;
  setDeviceAddress(device: HwDevice, address: number, options?: { commit?: boolean }): void;
  setMemoryMap(kind: MapKind, row: Partial<MapRow>): void;
  setAutoIrq(level: number, checked: boolean): void;
  selectAutoIrq(level: number): void;
  setAutoInterval(ms: number): void;
  setHardwareVisible(visible: boolean): void; // showing zeroes the switch byte
  hardware(): HardwareControls;

  /* breakpoints */
  setBreakpoint(address: number): boolean; // false = table of 100 full
  clearBreakpoint(address: number): void;
  clearAllBreakpoints(): void;
  breakpoints(): number[];
  setBreakCondition(index: number, condition: BreakCondition): void; // 0-49 register, 50-99 memory
  setBreakExpression(index: number, expression: BreakExpression): boolean;
  setBreakCounts(counts: { registers?: number; addresses?: number; expressions: number }): void;

  /* listing pane */
  readonly listingLineCount: number;
  listingLine(index: number): Bytes;
  readonly listingHighlight: number; // the engine's selected row (current instruction), -1 = none
}
