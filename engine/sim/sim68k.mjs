// easy68k-mac: sim68k.mjs - the public JavaScript API of the simulator engine.
//
// The engine is the original Sim68K v5.16.1 core compiled to WebAssembly
// (engine/dist/sim68k.wasm, built by build.mjs).  This module loads it and
// wraps its exports in a class.  It has no dependencies and runs unchanged in
// Node and in browsers.
//
//     import { createSim, Status } from './sim68k.mjs';
//     const sim = await createSim(host);          // host: see SimHost below
//     sim.load(s68Bytes, l68Bytes);               // File > Open
//     sim.cmdRun();                               // Run (F9)
//     let status = sim.run(100000);               // execute, at most 100000 instructions
//
// The engine never blocks and never reads a clock.  Wherever the original
// program waits (keyboard input, a delay, a dialog, a message box) run()
// returns a Status.WAIT_* code; the host does its part and calls run() again.
// README.md explains the model and lists every wait state.
//
// Text is bytes everywhere (Windows-1252, as in the original): programs,
// listings, file names and messages are passed as Uint8Array and are never
// decoded by the engine.  bytesToText() / textToBytes() are for display.

/**
 * Status codes returned by {@link Sim68k#run}, {@link Sim68k#cmdTraceInto} and
 * {@link Sim68k#autoTraceTick}.
 * @readonly
 * @enum {number}
 */
export const Status = Object.freeze({
  /** The instruction budget is used up and the program is still running: call run() again. */
  RUNNING: 0,
  /** Not running: a trace step finished, a breakpoint was reached, the program halted or was paused. */
  STOPPED: 1,
  /** A keyboard read (TRAP #15 task 2, 4, 5 or 18) is waiting. Deliver keys with keyChar(), then run(). */
  WAIT_INPUT: 2,
  /** TRAP #15 task 23 delay. Wait, report the time with delayElapsed(), then run(). */
  WAIT_DELAY: 3,
  /** TRAP #15 task 58 file dialog is open. Answer with fileDialogReply(), then run(). */
  WAIT_HOST: 4,
  /** A modal message box is open (host.alert was called). Call dismissAlert(), then run(). */
  WAIT_ALERT: 5,
  /** The original's "Unexpected error in runLoop": the run loop ended on an internal error. */
  ERROR: 6,
  /** The command was refused because a suspended step must be finished with run() first. */
  BUSY: -1,
});

/** Register numbers for {@link Sim68k#getRegister} / {@link Sim68k#setRegister}. */
export const Reg = Object.freeze({
  D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7,
  A0: 8, A1: 9, A2: 10, A3: 11, A4: 12, A5: 13, A6: 14,
  /** A[7] of the original: the user stack pointer. */
  USP: 15,
  /** A[8] of the original: the supervisor stack pointer. */
  SSP: 16,
  PC: 17,
  SR: 18,
  /** The active stack pointer (USP or SSP according to the S bit). */
  A7: 19,
  /** Read-only: the engine's OLD_PC (address of the instruction being executed). */
  OLD_PC: 20,
});

/** Register text boxes of the main window, for {@link Sim68k#boxText} / {@link Sim68k#editBox}. */
export const Box = Object.freeze({
  D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7,
  A0: 8, A1: 9, A2: 10, A3: 11, A4: 12, A5: 13, A6: 14,
  A7: 15, US: 16, SS: 17, PC: 18, SR: 19,
});

/** Options for {@link Sim68k#setOption} / {@link Sim68k#getOption}. */
export const Option = Object.freeze({
  /** Options > Enable Exceptions (default off). */
  EXCEPTIONS: 0,
  /** Options > Enable Bit Field Instructions (default off). */
  BITFIELD: 1,
  /** SIMHALT recognised (default on; reset to on by every load; the original has no menu item for it). */
  SIMHALT: 2,
  /** Execution log type: 0 disabled, 1 instruction, 2 + registers, 3 + memory. */
  EXEC_LOG_TYPE: 3,
  /** Output log type: 0 disabled, 1 text only. (The output log itself is written by the host.) */
  OUTPUT_LOG_TYPE: 4,
  /** Log Output dialog, "Memory Range to Log", From. */
  LOG_MEM_FROM: 5,
  /** Log Output dialog, "Memory Range to Log", Bytes. */
  LOG_MEM_BYTES: 6,
  /** Auto Trace Options > Disable display update. */
  DISABLE_DISPLAY: 7,
  /** Call host.memoryLivePaint(addr) after every memory write (Memory window "Live"). */
  MEM_LIVE: 8,
  /** Number of the monitor the main window is on (for leaving full screen on a stop). */
  MAIN_MONITOR: 9,
  /** Fullscreen Options: monitor used for full screen (reset to 0 by every simulator reset). */
  FULLSCREEN_MONITOR: 10,
  /** The I/O window is in full-screen mode (the host sets this for Alt+Enter). */
  FULLSCREEN: 11,
});

/** Memory-map kinds for {@link Sim68k#setMemoryMap}. */
export const MapKind = Object.freeze({ ROM: 0, READ: 1, PROTECTED: 2, INVALID: 3 });
/** Hardware devices for {@link Sim68k#setDeviceAddress}. */
export const Device = Object.freeze({ SEG7: 0, LED: 1, SWITCH: 2, PUSH_BUTTON: 3 });
/** Shift-state bits for the mouse methods. */
export const Shift = Object.freeze({ SHIFT: 1, ALT: 2, CTRL: 4, LEFT: 8, RIGHT: 16, MIDDLE: 32, DOUBLE: 64 });
/** Constants of the breakpoint tables (def.h). */
export const Break = Object.freeze({
  PC_REG_TYPE: 0, ADDR_TYPE: 1,
  /** typeId of a register condition: D0-D7 = 0-7, A0-A7 = 8-15, PC = 16. */
  PC_TYPE_ID: 16,
  EQUAL: 0, NOT_EQUAL: 1, GT: 2, GT_EQUAL: 3, LT: 4, LT_EQUAL: 5, NA_OP: 6,
  BYTE: 0, WORD: 1, LONG: 2,
  RW: 0, READ: 1, WRITE: 2, NA_TYPE: 3,
  /** Postfix tokens: 0..99 = condition index, AND, OR. */
  AND: 100, OR: 101,
});
/** Values passed to host.menuState(). */
export const Menu = Object.freeze({ ACTIVE: 0, TRACE: 1 });
/** Bits passed to host.repaint(). */
export const Repaint = Object.freeze({ LISTING: 1, BREAKPOINTS: 2, MEMORY: 4, STACK: 8 });
/** File open modes passed to host.fileOpen(). */
export const FileMode = Object.freeze({ UPDATE: 0, READ: 1, CREATE: 2 });

/**
 * The host object: everything the engine asks of its surroundings.  There is
 * one method per WebAssembly import (shim/host.h); the "Original:" note says
 * which call of the Windows program it stands for.  Every method is optional;
 * a missing one does nothing and returns the default given here.
 *
 * Rules: a method returns at once (the engine never waits inside a call) and
 * must not call back into the engine.  Byte arguments are copies and may be
 * kept.  Where a method "returns a value for a register", returning
 * `undefined` leaves the register unchanged.
 *
 * @typedef {object} SimHost
 *
 * @property {(text: Uint8Array) => void} [message]
 *   One entry for the message area of the main window.
 *   Original: Form1->Message->Lines->Add(text).
 * @property {() => void} [messagesClear]
 *   Clear the message area. Original: Form1->Message->Lines->Clear() (program load).
 * @property {(title: Uint8Array, text: Uint8Array) => void} [alert]
 *   A modal message box with an OK button was opened. The engine returns
 *   Status.WAIT_ALERT until dismissAlert() is called.
 *   Original: Application->MessageBox(text, title, MB_OK).
 * @property {() => void} [registersShown]
 *   The displayed registers, cycle count and listing highlight were refreshed;
 *   read them with boxText(), cyclesText and listingHighlight. Original: scrshow().
 * @property {(state: number) => void} [menuState]
 *   Menu.ACTIVE: all run commands available. Menu.TRACE: only Pause, Rewind and
 *   Close. Original: Form1->setMenuActive() / setMenuTrace().
 * @property {() => void} [focusMain]
 *   Bring the main window forward. Original: Form1->SetFocus().
 * @property {(enabled: boolean) => void} [autoTraceTimer]
 *   The auto-trace timer was switched on or off. While on, the host calls
 *   autoTraceTick() at its auto-trace interval (default 200 ms).
 *   Original: Form1->AutoTraceTimer->Enabled.
 * @property {(enabled: boolean) => void} [keyCommands]
 *   TRAP #15 task 24: the simulator's shortcut keys are enabled / disabled.
 *   Original: Form1->restoreMenuTask19() / setMenuTask19().
 * @property {(option: number, value: number) => void} [optionChanged]
 *   The program or a listing directive changed an option (0 = exceptions,
 *   1 = bit field). Original: ExceptionsEnabled->Checked / BitFieldEnabled->Checked.
 * @property {() => void} [saveSettings]
 *   Save the settings file (TRAP #15 task 32/5). Original: Form1->SaveSettings().
 * @property {(text: Uint8Array) => void} [caption]
 *   Name of the loaded program for the title bar. Original: Form1->Caption = name.
 * @property {(what: number) => void} [repaint]
 *   Repaint request, a combination of Repaint.* bits. Original: ListBox1->Repaint(),
 *   BreaksFrm->Repaint(), MemoryFrm->Repaint(), StackFrm->updateDisplay().
 * @property {(address: number) => void} [memoryLivePaint]
 *   A memory write at this address succeeded (only while Option.MEM_LIVE is on).
 *   Original: MemoryFrm->LivePaint(loc).
 * @property {(target: number, source: number) => void} [fontAssign]
 *   Apply the font chosen in dialog `source` (101 output window, 102 listing,
 *   103 printer) to surface `target` (1 I/O back buffer, 2 I/O window, 3 listing,
 *   4 headings, 5 messages, 6 printer). A simulator reset does this, which also
 *   restores the text colour changed by TRAP #15 task 21. Original: TFont::Assign.
 *
 * @property {() => void} [hardwareUpdate]
 *   Redraw the 7-segment display, LEDs and switches from memory / hardware().
 *   Only called while the hardware window is visible. Original: Hardware->update().
 * @property {(hardwareEnabled: boolean, autoIRQ: boolean) => void} [hardwareState]
 *   IRQ and Reset buttons enabled / disabled; label "Automatic Enabled / Disabled".
 *   Original: Hardware->enable() / disable() / autoIRQon() / autoIRQoff().
 * @property {(level: number, enabled: boolean, intervalMs: number) => void} [hardwareTimer]
 *   Auto-interrupt timer `level` (1-7) was enabled, disabled or got a new interval.
 *   While enabled, the host calls timerTick(level) every intervalMs (first tick one
 *   full interval after enabling; 0 = never). Original: IRQ<n>timer->Enabled / ->Interval.
 * @property {() => void} [hardwareShow]
 *   Show the hardware window (TRAP #15 task 32/0). Original: Hardware->Show().
 * @property {() => void} [hardwareControls]
 *   The engine changed a control of the hardware window (memory map from an S0
 *   record, auto-IRQ check box, interval); re-read hardware().
 *
 * @property {(data: Uint8Array) => void} [logWrite]
 *   Bytes for the execution log file, exactly as the original writes them
 *   (CR LF line ends). Original: fprintf(ElogFile, ...).
 * @property {(logging: boolean) => void} [logState]
 *   Logging started / stopped (close the log files on stop).
 *   Original: TLog::startLog() / stopLog().
 * @property {(data: Uint8Array) => void} [outputLogWrite]
 *   A note for the OUTPUT log file ("***** Reset Program Pressed *****").
 *   Original: TLog::addMessage -> fprintf(OlogFile, ...).
 *
 * @property {() => number} [timeCentiseconds]
 *   Local time of day in 1/100 s since midnight, for TRAP #15 task 8. Default 0.
 *   Original: Borland gettime().
 *
 * @property {(name: Uint8Array, mode: number) => number} [fileOpen]
 *   Open a file for the 68000 program. mode: FileMode.UPDATE (must exist,
 *   read/write), READ (must exist, read only), CREATE (create or truncate,
 *   read/write). Returns a handle > 0, or 0. Original: fopen(name, "r+b" / "rb" / "w+b").
 * @property {(handle: number, count: number) => (Uint8Array|null)} [fileRead]
 *   Read up to count bytes at the file position; an empty array at end of
 *   file; null on error. Original: fread.
 * @property {(handle: number, data: Uint8Array) => number} [fileWrite]
 *   Write at the file position; returns the number of bytes written, -1 on error.
 *   Original: fwrite.
 * @property {(handle: number, offset: number, whence: number) => number} [fileSeek]
 *   whence 0 = from start, 1 = from position, 2 = from end. Returns the new
 *   position, -1 on error. Original: fseek.
 * @property {(handle: number) => boolean} [fileClose]
 *   Returns true on success. Original: fclose.
 * @property {(name: Uint8Array) => boolean} [fileRemove]
 *   Delete a file; true on success. Original: remove.
 * @property {(mode: number, title: Uint8Array, filter: Uint8Array, fileName: Uint8Array) => void} [fileDialog]
 *   TRAP #15 task 58: show an Open (mode 0) or Save (mode 1) dialog. Answer
 *   later with fileDialogReply(). Original: OpenDialogIO->Execute() / SaveDialogIO->Execute().
 *
 * @property {(ch: number) => void} [charOut] Original: simIO->charOut(ch).
 * @property {(text: Uint8Array) => void} [textOut] Original: simIO->textOut(str).
 * @property {(text: Uint8Array) => void} [textOutCR] Original: simIO->textOutCR(str).
 * @property {() => void} [clear] Original: simIO->clear().
 * @property {() => (number|undefined)} [getrc]
 *   Cursor position, (column << 8) | row, for D1.W. Original: simIO->getrc(short*).
 * @property {(row: number, col: number) => void} [gotorc] Original: simIO->gotorc(r, c).
 * @property {(color: number, style: number) => void} [setFontProperties]
 *   Original: simIO->setFontProperties(c, s) (TRAP #15 task 21).
 * @property {(row: number, col: number) => (number|undefined)} [getCharAt]
 *   Character at a text position, for D1.B. Original: simIO->getCharAt(r, c, char*).
 * @property {(row: number, col: number, height: number, width: number, direction: number) => void} [scrollRect]
 *   Original: simIO->scrollRect(...) (TRAP #15 task 25).
 * @property {(width: number, height: number) => void} [setWindowSize]
 *   Original: simIO->setWindowSize(w, h); (0, 0) on a simulator reset.
 * @property {() => ([number, number]|undefined)} [getWindowSize]
 *   [width, height] of the output canvas; default [640, 480]. Original: simIO->getWindowSize.
 * @property {(fullScreen: boolean) => void} [setupWindow]
 *   Enter or leave full-screen mode. Original: simIO->fullScreen = ...; simIO->setupWindow().
 * @property {() => void} [ioShow] Show the I/O window. Original: simIO->Show().
 * @property {() => void} [ioBringToFront]
 *   Run was pressed: if the I/O window is visible, bring it forward and give it
 *   the keyboard. Original: if (simIO->Visible) simIO->BringToFront().
 * @property {(mode: number) => void} [inputPrompt]
 *   Prompt blink timer: 0 off, 1 on, 2 on and start with the "visible" phase.
 *   Original: prompt->Enabled / promptVisible.
 * @property {() => void} [erasePrompt]
 *   Draw a blank over the prompt cell. Original: the drawing in simIO->erasePrompt().
 * @property {(ch: number, echo: boolean) => void} [inputEcho]
 *   A character was typed during string / number input: if echo, draw it at the
 *   cursor and write it to the output log; in any case advance the cursor one
 *   column (gotorc(row, col+1)) and repaint. Original: simIOu.cpp:1394-1405.
 * @property {(echo: boolean) => void} [inputBackspace]
 *   Backspace during input: move the cursor back one column (gotorc(row, col-1));
 *   if echo, draw a blank there; repaint. Original: simIOu.cpp:1378-1386.
 * @property {() => void} [doCRLF] Original: simIO->doCRLF().
 * @property {() => void} [invalidate] Repaint the I/O window. Original: this->Invalidate().
 *
 * @property {(color: number) => void} [setLineColor] Task 80.
 * @property {(color: number) => void} [setFillColor] Task 81.
 * @property {(x: number, y: number) => void} [drawPixel] Task 82.
 * @property {(x: number, y: number) => number} [getPixel] Task 83; the result goes to D0.L. Default 0.
 * @property {(x1: number, y1: number, x2: number, y2: number) => void} [line] Task 84.
 * @property {(x: number, y: number) => void} [lineTo] Task 85.
 * @property {(x: number, y: number) => void} [moveTo] Task 86.
 * @property {(x1: number, y1: number, x2: number, y2: number) => void} [rectangle] Task 87.
 * @property {(x1: number, y1: number, x2: number, y2: number) => void} [ellipse] Task 88.
 * @property {(x: number, y: number) => void} [floodFill] Task 89.
 * @property {(x1: number, y1: number, x2: number, y2: number) => void} [unfilledRectangle] Task 90.
 * @property {(x1: number, y1: number, x2: number, y2: number) => void} [unfilledEllipse] Task 91.
 * @property {(mode: number) => void} [setDrawingMode] Task 92 (also 4 then 16 on a simulator reset).
 * @property {(width: number) => void} [setPenWidth] Task 93.
 * @property {() => void} [formPaint] Task 94: present the back buffer. Original: simIO->FormPaint().
 * @property {(text: Uint8Array, x: number, y: number) => void} [drawText] Task 95.
 * @property {() => ([number, number]|undefined)} [getXY] Task 96: pen position for D1.W, D2.W.
 *
 * @property {() => void} [resetSounds] Original: simIO->ResetSounds() (simulator reset).
 * @property {(fileName: Uint8Array) => (number|undefined)} [playSound] Task 70; result for D0.W.
 * @property {(fileName: Uint8Array, waveIndex: number) => void} [loadSound] Task 71.
 * @property {(waveIndex: number) => (number|undefined)} [playSoundMem] Task 72; result for D0.W.
 * @property {(control: number, waveIndex: number) => (number|undefined)} [controlSound] Task 76; result for D0.W.
 * @property {(fileName: Uint8Array) => (number|undefined)} [playSoundDX] Task 73; result for D0.W.
 * @property {(fileName: Uint8Array, waveIndex: number) => (number|undefined)} [loadSoundDX] Task 74; result for D0.W.
 * @property {(waveIndex: number) => (number|undefined)} [playSoundMemDX] Task 75; result for D0.W.
 * @property {(control: number, waveIndex: number) => (number|undefined)} [controlSoundDX] Task 77; result for D0.W.
 *
 * @property {(cid: number, portName: Uint8Array) => (number|undefined)} [initComm] Task 40; result for D0.W.
 * @property {(cid: number, settings: number) => (number|undefined)} [setCommParams] Task 41; result for D0.W.
 * @property {(cid: number, count: number) => (Uint8Array|number)} [commRead]
 *   Task 42, the device read: the bytes received (up to count), or -1 invalid
 *   port number, -3 port not initialised, -2 read error. Default -3.
 *   Original: ReadFile in simIO->readComm; the engine does the rest of readComm.
 * @property {(cid: number, data: Uint8Array) => ({result: number, sent?: number}|undefined)} [sendComm]
 *   Task 43: result for D0.W and the number of bytes sent for D1.B.
 *
 * @property {(settings: number, server: Uint8Array, serverAddress: number) => (number|undefined)} [createNetClient]
 *   Task 100; result for D0.L. server is a copy of the string at serverAddress (A2 & $FFFFFF), a 68000
 *   address: with a host name the host writes the resolved address back over the string there.
 * @property {(settings: number) => (number|undefined)} [createNetServer] Task 101; result for D0.L.
 * @property {(settings: number, dataAddress: number, remoteIP: Uint8Array) => ({result: number, count?: number}|undefined)} [sendNet]
 *   Task 102. dataAddress is a 68000 address. result for D0.L, count for D1.L.
 * @property {(settings: number, bufferAddress: number, senderIPAddress: number) => ({result: number, count?: number}|undefined)} [receiveNet]
 *   Task 103. The host stores the data and the sender's address text in 68000 memory.
 * @property {(d1: number, dataAddress: number, remoteIP: Uint8Array) => ({d0: number, d1?: number}|undefined)} [sendPortNet] Task 106.
 * @property {(d1: number, bufferAddress: number, senderIPAddress: number) => ({d0: number, d1?: number}|undefined)} [receivePortNet] Task 107.
 * @property {(closeIP: number) => (number|undefined)} [closeNetConnection] Task 104; result for D0.L.
 * @property {(localIPAddress: number) => (number|undefined)} [getLocalIP] Task 105; result for D0.L.
 * @property {() => number} [netCloseSockets] Original: netCloseSockets() (simulator reset).
 *
 * @property {() => void} [printerBeginDoc] Task 10. Original: Prntr->BeginDoc().
 * @property {() => void} [printerEndDoc] Original: Prntr->EndDoc().
 * @property {(which: number) => number} [printerMetric]
 *   0 = height of a text row, 1 = width of a character, 2 = page height,
 *   3 = page width, in printer pixels. Default 0.
 * @property {(x: number, y: number, ch: number) => void} [printerTextOut]
 *   Draw one character on the page. Original: Prntr->Canvas->TextOut(x, y, ch).
 */

/** Every method name of {@link SimHost}, with the value a missing method returns. */
export const HOST_DEFAULTS = Object.freeze({
  message: undefined, messagesClear: undefined, alert: undefined, registersShown: undefined,
  menuState: undefined, focusMain: undefined, autoTraceTimer: undefined, keyCommands: undefined,
  optionChanged: undefined, saveSettings: undefined, caption: undefined, repaint: undefined,
  memoryLivePaint: undefined, fontAssign: undefined,
  hardwareUpdate: undefined, hardwareState: undefined, hardwareTimer: undefined, hardwareShow: undefined,
  hardwareControls: undefined,
  logWrite: undefined, logState: undefined, outputLogWrite: undefined,
  timeCentiseconds: 0,
  fileOpen: 0, fileRead: null, fileWrite: -1, fileSeek: -1, fileClose: false, fileRemove: false,
  fileDialog: undefined,
  charOut: undefined, textOut: undefined, textOutCR: undefined, clear: undefined, getrc: undefined,
  gotorc: undefined, setFontProperties: undefined, getCharAt: undefined, scrollRect: undefined,
  setWindowSize: undefined, getWindowSize: undefined, setupWindow: undefined, ioShow: undefined,
  ioBringToFront: undefined, inputPrompt: undefined, erasePrompt: undefined, inputEcho: undefined,
  inputBackspace: undefined, doCRLF: undefined, invalidate: undefined,
  setLineColor: undefined, setFillColor: undefined, drawPixel: undefined, getPixel: 0, line: undefined,
  lineTo: undefined, moveTo: undefined, rectangle: undefined, ellipse: undefined, floodFill: undefined,
  unfilledRectangle: undefined, unfilledEllipse: undefined, setDrawingMode: undefined,
  setPenWidth: undefined, formPaint: undefined, drawText: undefined, getXY: undefined,
  resetSounds: undefined, playSound: undefined, loadSound: undefined, playSoundMem: undefined,
  controlSound: undefined, playSoundDX: undefined, loadSoundDX: undefined, playSoundMemDX: undefined,
  controlSoundDX: undefined,
  initComm: undefined, setCommParams: undefined, commRead: -3, sendComm: undefined,
  createNetClient: undefined, createNetServer: undefined, sendNet: undefined, receiveNet: undefined,
  sendPortNet: undefined, receivePortNet: undefined, closeNetConnection: undefined, getLocalIP: undefined,
  netCloseSockets: 0,
  printerBeginDoc: undefined, printerEndDoc: undefined, printerMetric: 0, printerTextOut: undefined,
});

/** Size of the 68000 address space in bytes. */
export const MEMORY_SIZE = 0x01000000;

/**
 * Bytes to a string, one character per byte (ISO 8859-1).  Lossless and
 * reversible with {@link textToBytes}; for display only (bytes 0x80-0x9F are
 * Windows-1252 punctuation in the original and need mapping if they matter).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToText(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return text;
}

/**
 * A string to bytes, one byte per character (the low 8 bits of each code unit).
 * @param {string} text
 * @returns {Uint8Array}
 */
export function textToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xFF;
  return bytes;
}

/** @param {SimHost} host */
function completeHost(host) {
  const full = Object.create(null);
  for (const [name, value] of Object.entries(HOST_DEFAULTS)) {
    full[name] = (host && typeof host[name] === 'function') ? host[name].bind(host) : () => value;
  }
  return full;
}

/**
 * @typedef {object} CreateOptions
 * @property {string|URL} [loaderUrl]
 *   Where sim68k-loader.mjs is. Default: ../dist/sim68k-loader.mjs next to this file.
 * @property {(moduleArg: object) => Promise<object>} [createModule]
 *   The default export of sim68k-loader.mjs, if the caller imported it itself
 *   (bundlers, service workers).
 * @property {ArrayBuffer|Uint8Array} [wasmBinary]
 *   The contents of sim68k.wasm, if the caller fetched it itself.
 * @property {WebAssembly.Module} [wasmModule]
 *   sim68k.wasm already compiled: the simulator is a new instance of it, and
 *   the file is neither fetched nor compiled again (Emscripten's instantiateWasm).
 * @property {(file: string) => string} [locateFile]
 *   Maps "sim68k.wasm" to a URL (Emscripten's locateFile).
 */

/**
 * Load the engine and start a simulator, in the state the original program is
 * in after start-up without a settings file: memory all $FF, PC 0, SR $2000,
 * USP $00FF0000, SSP $01000000, exceptions off.
 *
 * Note: the host object receives calls already during this function (the
 * start-up reset clears the output window, and so on).
 *
 * @param {SimHost} [host]
 * @param {CreateOptions} [options]
 * @returns {Promise<Sim68k>}
 */
export async function createSim(host = {}, options = {}) {
  let createModule = options.createModule;
  if (!createModule) {
    const url = options.loaderUrl ?? new URL('../dist/sim68k-loader.mjs', import.meta.url);
    createModule = (await import(/* @vite-ignore */ String(url))).default;
  }
  const moduleArg = { host: completeHost(host), simMemoryBase: 0 };
  if (options.wasmBinary) moduleArg.wasmBinary = options.wasmBinary;
  if (options.locateFile) moduleArg.locateFile = options.locateFile;
  const module = await new Promise((resolve, reject) => {
    const wasmModule = options.wasmModule;
    if (wasmModule) {
      // A failed instantiation must reach the caller: the loader would wait for receive() for ever.
      moduleArg.instantiateWasm = (imports, receive) => {
        WebAssembly.instantiate(wasmModule, imports).then((instance) => receive(instance, wasmModule), reject);
        return {};
      };
    }
    createModule(moduleArg).then(resolve, reject);
  });
  module.simMemoryBase = module._sim_memory();
  module._sim_boot();
  return new Sim68k(module);
}

/**
 * @typedef {object} Registers
 * @property {number[]} d  D0-D7 as unsigned 32-bit numbers
 * @property {number[]} a  A0-A6
 * @property {number} usp  user stack pointer
 * @property {number} ssp  supervisor stack pointer
 * @property {number} a7   active stack pointer
 * @property {number} pc
 * @property {number} sr   16 bits
 * @property {bigint} cycles
 */

/**
 * @typedef {object} SimState
 * @property {boolean} runMode   the run loop should keep executing
 * @property {boolean} trace     single-step mode (not the 68000 T bit)
 * @property {boolean} sstep     Step Over in progress
 * @property {boolean} halt      the last step halted the program
 * @property {boolean} inputMode a keyboard read is pending
 * @property {boolean} hardwareEnabled interrupts and the Reset button are accepted
 * @property {boolean} autoIRQ   auto-interrupt master flag
 * @property {boolean} stopInstruction a STOP has executed with exceptions enabled (sticky)
 * @property {boolean} logging
 * @property {boolean} autoTraceTimer
 * @property {number} menuState  Menu.ACTIVE or Menu.TRACE
 * @property {number} phase      0 between instructions, 1 or 2 while a step is suspended
 * @property {number} irq        pending interrupt requests, bit n-1 = level n
 * @property {boolean} alertOpen
 * @property {number} pendingKey one-character type-ahead buffer (0 = empty)
 * @property {boolean} keyCommandsDisabled TRAP #15 task 24
 * @property {number} startPC    start address remembered for Rewind
 * @property {boolean} errflg    double-fault latch
 * @property {number} stepToAddr
 * @property {number} runToAddr
 * @property {boolean} autoTraceInProgress
 * @property {boolean} fileDialogOpen
 */

/** A running simulator. Create it with {@link createSim}. */
export class Sim68k {
  /** @param {object} module the Emscripten module */
  constructor(module) {
    /** @private */
    this._m = module;
    /** @private */
    this._base = module.simMemoryBase;
  }

  // ---- memory ----------------------------------------------------------------

  /**
   * The 16 MB of 68000 memory as a live view; index = address. Reading and
   * writing through it bypasses the memory map and the breakpoint flags, like
   * the original's Memory window.
   * @returns {Uint8Array}
   */
  get memory() {
    return this._m.HEAPU8.subarray(this._base, this._base + MEMORY_SIZE);
  }

  /** @param {number} address @returns {number} */
  readByte(address) { return this._m.HEAPU8[this._base + (address & 0xFFFFFF)]; }
  /** Big-endian word; the address is not checked for oddness. @param {number} address @returns {number} */
  readWord(address) { return (this.readByte(address) << 8) | this.readByte(address + 1); }
  /** Big-endian long, unsigned. @param {number} address @returns {number} */
  readLong(address) { return ((this.readWord(address) << 16) | this.readWord(address + 2)) >>> 0; }
  /** @param {number} address @param {ArrayLike<number>} bytes */
  writeBytes(address, bytes) {
    for (let i = 0; i < bytes.length; i++) this._m.HEAPU8[this._base + ((address + i) & 0xFFFFFF)] = bytes[i];
  }

  // ---- loading ---------------------------------------------------------------

  /**
   * Load a program: File > Open (kind 'open'), Reload (kind 'reload') or
   * drag-and-drop / command line (kind 'drop').  Resets the simulator, fills
   * memory with $FF, loads the S-records and, if given, the listing (which
   * supplies the start address and the "*[sim68k]" directives).  'open'
   * clears the PC breakpoints first; 'open' and 'drop' stop a running log.
   * Messages ("S0 = ...", ".S68 file read successful", errors) arrive through
   * host.message.
   *
   * If a step was suspended (run() had returned WAIT_INPUT or WAIT_DELAY), its
   * remaining part runs on the newly loaded program before this returns, as
   * in the original.
   *
   * @param {Uint8Array|null} s68  contents of the .S68 file; null = the file cannot be opened
   * @param {Uint8Array|null} [l68]  contents of the .L68 file; null = there is none
   * @param {{name?: string|Uint8Array, kind?: 'open'|'reload'|'drop'}} [options]
   *   name is used in messages and the caption only.
   */
  load(s68, l68 = null, options = {}) {
    const kind = { open: 0, reload: 1, drop: 2 }[options.kind ?? 'open'];
    if (kind === undefined) throw new Error(`unknown load kind ${options.kind}`);
    this._stage(0, s68);
    this._stage(1, l68);
    this._withCString(options.name ?? 'program.S68', (name) => this._m._sim_open_file(name, kind));
  }

  /**
   * File > Open Data: load S-records into memory without resetting anything.
   * @param {Uint8Array|null} s68
   * @param {string|Uint8Array} [name]
   * @returns {boolean} false if the file could not be read at all
   */
  loadData(s68, name = 'data.S68') {
    this._stage(0, s68);
    return this._withCString(name, (ptr) => this._m._sim_open_data(ptr)) === 0;
  }

  /** File > Close (after the user confirmed): clears the listing, resets the simulator, clears PC breakpoints. */
  close() { this._m._sim_close_file(); }

  /**
   * Rewind Program (Ctrl+F2): PC = start address, simulator reset. Memory is
   * NOT restored. A suspended step is finished on the reset machine.
   */
  rewind() { this._m._sim_rewind(); }

  // ---- run control -------------------------------------------------------------

  /** Run (F9). Sets up a free run; execute it with run(). */
  cmdRun() { this._m._sim_cmd_run(); }
  /**
   * Run To Cursor (Ctrl+F9) with the listing line the user selected.
   * @param {number} listingLine index into the listing (0-based)
   */
  cmdRunToCursor(listingLine) { this._m._sim_cmd_run_to_cursor(listingLine); }
  /**
   * Run To Cursor for a host without a listing: run until the PC equals address.
   * @param {number} address
   */
  cmdRunToAddress(address) { this._m._sim_cmd_run_to_address(address); }
  /** Step Over (F8). Execute with run(). */
  cmdStepOver() { this._m._sim_cmd_step_over(); }
  /**
   * Trace Into (F7): executes one instruction now.
   * @returns {number} a Status; a WAIT_* code means the step is suspended, finish it with run()
   */
  cmdTraceInto() { return this._m._sim_cmd_trace(); }
  /**
   * Pause (F6). Stops a running program between two instructions (the next
   * run() returns STOPPED). During a keyboard read or a delay it ends the
   * wait and finishes the suspended step; a cancelled keyboard read leaves
   * the program without its input (original behaviour).
   */
  cmdPause() { this._m._sim_cmd_pause(); }
  /** Auto Trace (F10): switches the auto-trace timer on (host.autoTraceTimer(true)). */
  cmdAutoTrace() { this._m._sim_cmd_auto_trace(); }
  /** One tick of the auto-trace timer. @returns {number} a Status */
  autoTraceTick() { return this._m._sim_auto_trace_tick(); }

  /**
   * Execute. Finishes a suspended step first, then runs while the program is
   * in run mode, for at most maxInstructions new instructions.
   * @param {number} [maxInstructions]
   * @returns {number} a Status
   */
  run(maxInstructions = 100000) { return this._m._sim_run(maxInstructions); }
  /**
   * Number of instruction steps completed since the simulator was created,
   * modulo 2^32. (Not part of the original; for budgets and speed control.)
   * @returns {number}
   */
  get stepCount() { return this._m._sim_step_count() >>> 0; }

  // ---- ending a wait state -------------------------------------------------------

  /** The user closed the message box(es) reported by host.alert. */
  dismissAlert() { this._m._sim_alert_dismissed(); }
  /** TRAP #15 task 23: number of 1/100 s periods still to wait. @returns {number} */
  get delayRemaining() { return this._m._sim_delay_remaining() >>> 0; }
  /** TRAP #15 task 23: report that so many 1/100 s periods have passed. @param {number} periods */
  delayElapsed(periods) { this._m._sim_delay_elapsed(periods >>> 0); }
  /**
   * TRAP #15 task 58: the dialog was closed.
   * @param {boolean} accepted false = cancelled
   * @param {Uint8Array|string} [fileName] the chosen path
   */
  fileDialogReply(accepted, fileName = '') {
    this._withCString(fileName, (ptr) => this._m._sim_file_dialog_reply(accepted ? 1 : 0, ptr));
  }

  // ---- keyboard and mouse of the I/O window ----------------------------------------

  /**
   * A character was typed in the I/O window (Windows WM_CHAR: Enter = 13,
   * Backspace = 8). Completes or feeds a pending keyboard read, or goes to the
   * one-character type-ahead buffer.
   * @param {number} ch 0-255
   */
  keyChar(ch) { this._m._sim_key_char(ch & 0xFF); }
  /**
   * A key went down in the I/O window.
   * @param {number} virtualKey Windows virtual-key code
   * @returns {boolean} true if the simulator's own key commands (Alt+Enter, paste ...) are enabled
   */
  keyDown(virtualKey) { return this._m._sim_key_down(virtualKey & 0xFF) !== 0; }
  /** @param {number} virtualKey */
  keyUp(virtualKey) { this._m._sim_key_up(virtualKey & 0xFF); }
  /** The I/O window was activated: the key-state table is cleared. */
  ioActivated() { this._m._sim_io_activated(); }
  /** @param {number} x @param {number} y @param {number} shift combination of Shift.* bits (buttons and modifier keys) */
  mouseDown(x, y, shift) { this._m._sim_mouse(0, shift, x, y); }
  /** @param {number} x @param {number} y @param {number} shift */
  mouseUp(x, y, shift) { this._m._sim_mouse(1, shift, x, y); }
  /** @param {number} x @param {number} y @param {number} shift only SHIFT, ALT, CTRL are used */
  mouseMove(x, y, shift) { this._m._sim_mouse(2, shift, x, y); }

  // ---- CPU state -------------------------------------------------------------------

  /** @param {number} reg a Reg value @returns {number} unsigned (16 bits for SR, else 32) */
  getRegister(reg) { return this._m._sim_reg_get(reg) >>> 0; }
  /**
   * Set a register and its text box, as if the value had been typed into the
   * box and taken over at once. OLD_PC is not touched.
   * @param {number} reg a Reg value @param {number} value
   */
  setRegister(reg, value) { this._m._sim_reg_set(reg, value | 0); }
  /** @returns {Registers} */
  registers() {
    const d = [], a = [];
    for (let i = 0; i < 8; i++) d.push(this.getRegister(Reg.D0 + i));
    for (let i = 0; i < 7; i++) a.push(this.getRegister(Reg.A0 + i));
    return {
      d, a, usp: this.getRegister(Reg.USP), ssp: this.getRegister(Reg.SSP), a7: this.getRegister(Reg.A7),
      pc: this.getRegister(Reg.PC), sr: this.getRegister(Reg.SR), cycles: this.cycles,
    };
  }
  /**
   * The text a register box of the main window shows: 8 hex digits, or 16
   * binary digits for Box.SR. It is refreshed only when the original refreshes
   * its display (host.registersShown), so it can lag behind the registers.
   * @param {number} box a Box value @returns {string}
   */
  boxText(box) { return bytesToText(this._cString(this._m._sim_box_text(box))); }
  /**
   * The user typed in a register box. As in the original, D0-D7, SR and PC
   * change only the text (taken over by the next Run / Step Over / Trace Into,
   * lost at the next display refresh); A0-A6, A7, US and SS are written
   * through at once. Editing SR takes effect at once for the Protected
   * memory-map test, which reads the displayed S bit.
   * @param {number} box a Box value @param {string} text
   * @returns {boolean} false if the text is not a number
   */
  editBox(box, text) { return this._withCString(text, (ptr) => this._m._sim_box_edit(box, ptr)) === 0; }
  /** The cycle counter. @returns {bigint} */
  get cycles() { return (BigInt(this._m._sim_cycles_hi() >>> 0) << 32n) | BigInt(this._m._sim_cycles_lo() >>> 0); }
  /** The cycle display of the main window: low 32 bits in decimal, or "Overflow" above 2^48-1. @returns {string} */
  get cyclesText() { return bytesToText(this._cString(this._m._sim_cycles_text())); }
  /** The Clear Cycles button. */
  clearCycles() { this._m._sim_cycles_clear(); }

  /** @returns {SimState} */
  state() {
    const s = (n) => this._m._sim_state(n);
    return {
      runMode: s(0) !== 0, trace: s(1) !== 0, sstep: s(2) !== 0, halt: s(3) !== 0, inputMode: s(4) !== 0,
      hardwareEnabled: s(5) !== 0, autoIRQ: s(6) !== 0, stopInstruction: s(7) !== 0, logging: s(8) !== 0,
      autoTraceTimer: s(9) !== 0, menuState: s(10), phase: s(11), irq: s(12), alertOpen: s(13) !== 0,
      pendingKey: s(14), keyCommandsDisabled: s(15) !== 0, startPC: s(16) >>> 0, errflg: s(17) !== 0,
      stepToAddr: s(18) >>> 0, runToAddr: s(19) >>> 0, autoTraceInProgress: s(20) !== 0, fileDialogOpen: s(21) !== 0,
    };
  }

  // ---- options -----------------------------------------------------------------------

  /** @param {number} option an Option value @param {number|boolean} value */
  setOption(option, value) { this._m._sim_set_option(option, Number(value)); }
  /** @param {number} option an Option value @returns {number} */
  getOption(option) { return this._m._sim_get_option(option); }

  // ---- execution log -------------------------------------------------------------------

  /**
   * The Log Output dialog was opened. The original remembers the two log
   * types at that moment and uses those remembered values to decide whether
   * Rewind / Reload write their "***** ... Pressed *****" note.
   */
  logDialogOpened() { this._m._sim_log_dialog_opened(); }
  /**
   * Log Start. Writes the header line of the execution log (if a log type is
   * selected) and switches logging on. Only single-stepped instructions are
   * logged, as in the original.
   * @param {string|Uint8Array} timeString date and time for the header, as
   *   DateTimeToStr(Now()) prints it on Windows, e.g. "11/20/2026 1:07:46 PM"
   */
  startLog(timeString) { this._withCString(timeString, (ptr) => this._m._sim_log_start(ptr)); }
  /** Log Stop. */
  stopLog() { this._m._sim_log_stop(); }

  // ---- hardware window ---------------------------------------------------------------------

  /**
   * An IRQ button, or an armed key / mouse source: request interrupt `level`.
   * @param {number} level 1-7
   * @returns {boolean} true if the program is (now) running and run() must be called
   */
  irq(level) { return this._m._sim_irq(level) !== 0; }
  /** The Reset button. @returns {boolean} true if run() must be called */
  hardwareReset() { return this._m._sim_hw_reset() !== 0; }
  /**
   * Auto-interrupt timer `level` fired (ignored unless that timer is enabled).
   * @param {number} level 1-7 @returns {boolean} true if run() must be called
   */
  timerTick(level) { return this._m._sim_hw_timer_tick(level) !== 0; }
  /** A toggle switch was clicked. @param {number} n 0-7 */
  switchClick(n) { this._m._sim_hw_switch(n); }
  /** A push button was pressed or released. @param {number} n 0-7 @param {boolean} down */
  pushButton(n, down) { this._m._sim_hw_button(n, down ? 1 : 0); }
  /**
   * The user changed a device address box.
   * @param {number} device a Device value
   * @param {number} address 0-$FFFFFF
   * @param {{commit?: boolean}} [options] commit: also Enter / focus loss, which
   *   writes $00 to the switch byte or $FF to the push-button byte (those two boxes only)
   */
  setDeviceAddress(device, address, options = {}) {
    this._hwText(device, address);
    if (options.commit) this._m._sim_hw_commit(device);
  }
  /**
   * The user changed a row of the Memory Map group.
   * @param {number} kind a MapKind value
   * @param {{enabled?: boolean, start?: number, end?: number}} row start and end are inclusive
   */
  setMemoryMap(kind, row) {
    if (row.start !== undefined) this._hwText(4 + 2 * kind, row.start);
    if (row.end !== undefined) this._hwText(5 + 2 * kind, row.end);
    if (row.enabled !== undefined) this._m._sim_hw_set_check(20 + kind, row.enabled ? 1 : 0);
  }
  /** The check box under IRQ button `level`. @param {number} level 1-7 @param {boolean} checked */
  setAutoIrq(level, checked) { this._m._sim_hw_set_check(30 + level, checked ? 1 : 0); }
  /** The "IRQ" combo box of the Auto Interval group. @param {number} level 1-7 */
  selectAutoIrq(level) { this._m._sim_hw_auto_select(level - 1); }
  /** The interval box: sets the interval of the selected level. @param {number} ms */
  setAutoInterval(ms) { this._m._sim_hw_auto_interval(ms >>> 0); }
  /**
   * The hardware window was shown or hidden. Showing it sets the switch byte
   * to 0, as in the original.
   * @param {boolean} visible
   */
  setHardwareVisible(visible) { this._m._sim_hw_set_visible(visible ? 1 : 0); }
  /**
   * State of the hardware window's controls.
   * @returns {{seg7: number, led: number, switches: number, pushButtons: number,
   *   map: {enabled: boolean, start: number, end: number}[],
   *   auto: {checked: boolean, timerEnabled: boolean, intervalMs: number}[],
   *   switchOn: boolean[], visible: boolean, selectedAutoIrq: number, intervalBox: number}}
   *   map is indexed by MapKind; auto by level (index 0 unused); switchOn by switch number
   */
  hardware() {
    const g = (n) => this._m._sim_hw_get(n);
    const map = [], auto = [null], switchOn = [];
    for (let k = 0; k < 4; k++) map.push({ enabled: g(20 + k) !== 0, start: g(4 + 2 * k), end: g(5 + 2 * k) });
    for (let n = 1; n <= 7; n++) auto.push({ checked: g(30 + n) !== 0, timerEnabled: g(40 + n) !== 0, intervalMs: g(50 + n) >>> 0 });
    for (let n = 0; n < 8; n++) switchOn.push(g(60 + n) !== 0);
    return {
      seg7: g(0), led: g(1), switches: g(2), pushButtons: g(3), map, auto, switchOn,
      visible: g(70) !== 0, selectedAutoIrq: g(71) + 1, intervalBox: g(72) >>> 0,
    };
  }

  // ---- breakpoints -----------------------------------------------------------------------------

  /** Set a PC breakpoint. @param {number} address @returns {boolean} false if the table (100) is full */
  setBreakpoint(address) { return this._m._sim_bp_set(address | 0) === 0; }
  /** @param {number} address */
  clearBreakpoint(address) { this._m._sim_bp_clear(address | 0); }
  clearAllBreakpoints() { this._m._sim_bp_clear(-1); }
  /** @returns {number[]} the PC breakpoints in table order */
  breakpoints() {
    const list = [];
    for (let i = 0, n = this._m._sim_bp_count(); i < n; i++) list.push(this._m._sim_bp_get(i) >>> 0);
    return list;
  }
  /**
   * One row of the advanced-breakpoint condition tables. Index 0-49: PC /
   * register conditions; 50-99: memory conditions. A condition has an effect
   * only through an enabled expression that refers to it.
   * @param {number} index 0-99
   * @param {{enabled?: boolean, id?: number, type: number, typeId: number, op: number, value: number,
   *   size: number, readWrite?: number}} c  type: Break.PC_REG_TYPE or ADDR_TYPE; typeId: register
   *   number (0-7 D, 8-15 A, 16 PC) or memory address; op: Break.EQUAL ...; size: Break.BYTE / WORD /
   *   LONG; readWrite: Break.RW / READ / WRITE / NA_TYPE (memory conditions)
   */
  setBreakCondition(index, c) {
    this._m._sim_bp_cond_set(index, (c.enabled ?? true) ? 1 : 0, c.id ?? index, c.type, c.typeId | 0, c.op, c.value | 0, c.size, c.readWrite ?? 0);
  }
  /**
   * One row of the expression table.
   * @param {number} index 0-49
   * @param {{enabled?: boolean, id?: number, count?: number, postfix: number[]}} e
   *   postfix: condition indexes (0-99) and Break.AND / Break.OR in postfix order, at most 10;
   *   count: the expression must be true this many times before it breaks (default 1);
   *   id: counter slot, the 1-based row number in the original (default index + 1)
   * @returns {boolean} false if the row was refused (malformed postfix)
   */
  setBreakExpression(index, e) {
    const m = this._m, scratch = m._sim_scratch_ints() >> 2;
    if (e.postfix.length > 10) return false;
    e.postfix.forEach((token, i) => { m.HEAP32[scratch + i] = token; });
    return m._sim_bp_expr_set(index, (e.enabled ?? true) ? 1 : 0, e.id ?? index + 1, e.count ?? 1, scratch << 2, e.postfix.length) === 0;
  }
  /**
   * Number of rows in use in the three tables. Only expressions 0..expressions-1 are tested.
   * @param {{registers?: number, addresses?: number, expressions: number}} counts
   */
  setBreakCounts(counts) { this._m._sim_bp_counts(counts.registers ?? 0, counts.addresses ?? 0, counts.expressions); }

  // ---- listing -------------------------------------------------------------------------------------

  /** Number of lines in the listing pane. @returns {number} */
  get listingLineCount() { return this._m._sim_listing_count(); }
  /** @param {number} index @returns {Uint8Array} the bytes of one listing line (a copy) */
  listingLine(index) {
    const ptr = this._m._sim_listing_line(index), length = this._m._sim_listing_line_length(index);
    return this._m.HEAPU8.slice(ptr, ptr + length);
  }
  /** Index of the highlighted listing line (the current instruction), -1 if none. @returns {number} */
  get listingHighlight() { return this._m._sim_listing_highlight(); }

  // ---- internals -------------------------------------------------------------------------------------

  /** @private */
  _stage(which, data) {
    if (data === null || data === undefined) return;
    if (!(data instanceof Uint8Array)) throw new TypeError('program files must be given as Uint8Array (bytes)');
    const ptr = this._m._sim_stage(which, data.length);
    if (!ptr) throw new Error('out of memory while loading');
    this._m.HEAPU8.set(data, ptr);
  }

  /** @private */
  _hwText(control, address) {
    const text = (address >>> 0).toString(16).toUpperCase().padStart(6, '0');
    this._withCString(text, (ptr) => this._m._sim_hw_set_text(control, ptr));
  }

  /** @private @param {string|Uint8Array} text @param {(ptr: number) => any} fn */
  _withCString(text, fn) {
    const bytes = (typeof text === 'string') ? textToBytes(text) : text;
    const ptr = this._m._malloc(bytes.length + 1);
    try {
      this._m.HEAPU8.set(bytes, ptr);
      this._m.HEAPU8[ptr + bytes.length] = 0;
      return fn(ptr);
    } finally {
      this._m._free(ptr);
    }
  }

  /** @private @param {number} ptr @returns {Uint8Array} */
  _cString(ptr) {
    let end = ptr;
    while (this._m.HEAPU8[end] !== 0) end++;
    return this._m.HEAPU8.subarray(ptr, end);
  }
}
