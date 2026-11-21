// Contract: the simulator host (ARCHITECTURE.md 3.3) - the port's replacement for the original's
// windows as seen from the engine. One flat object with one method per engine import; the method
// names are exactly the keys of HOST_DEFAULTS in engine/sim/sim68k.mjs (93 of them).
//
// Rules (3.3.2): a host method returns at once and never calls the engine; it may run before the
// engine object exists. Text is bytes. Where a method "returns a value for a register", returning
// `undefined` leaves the register as it is.
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { Bytes } from './engine';

/** Main window (original: TForm1) and clock. */
export interface HostMain {
  message(text: Bytes): void; // one line for the simulator message area
  messagesClear(): void;
  alert(title: Bytes, text: Bytes): void; // modal box; the engine reports WaitAlert until dismissAlert()
  registersShown(): void; // scrshow(): boxText(), cyclesText, listingHighlight changed
  menuState(state: number): void; // 0 active, 1 busy (sim-ui §3.6)
  focusMain(): void;
  autoTraceTimer(enabled: boolean): void; // while on, call autoTraceTick() at the interval
  keyCommands(enabled: boolean): void; // task 24, simulator reset
  optionChanged(option: number, value: number): void; // 0 exceptions, 1 bit field
  saveSettings(): void; // task 32/5
  caption(text: Bytes): void; // name of the loaded program
  repaint(what: number): void; // RepaintBit combination
  memoryLivePaint(address: number): void; // only while SimOption.MemLive is on
  fontAssign(target: number, source: number): void; // FontTarget, FontSource
  timeCentiseconds(): number; // task 8
}

/** Hardware window (original: THardware). */
export interface HostHardware {
  hardwareUpdate(): void; // redraw digits, LEDs, switches (only while visible)
  hardwareState(hardwareEnabled: boolean, autoIRQ: boolean): void;
  hardwareTimer(level: number, enabled: boolean, intervalMs: number): void;
  hardwareShow(): void; // task 32/0
  hardwareControls(): void; // the engine changed a control: re-read hardware()
}

/** Log window (original: TLog). */
export interface HostLog {
  logWrite(data: Bytes): void; // execution-log bytes, CR LF line ends, header included
  logState(logging: boolean): void; // on false: close the log files
  outputLogWrite(data: Bytes): void; // a note for the output log, raw
}

/** Host files (original: C stdio in SIMOPS2.CPP) and the task 58 dialog. */
export interface HostFiles {
  fileOpen(name: Bytes, mode: number): number; // FileMode; handle > 0, or 0
  fileRead(handle: number, count: number): Bytes | null; // empty at end of file; null on error
  fileWrite(handle: number, data: Bytes): number; // bytes written, -1 on error
  fileSeek(handle: number, offset: number, whence: number): number; // new position, -1 on error
  fileClose(handle: number): boolean;
  fileRemove(name: Bytes): boolean;
  fileDialog(mode: number, title: Bytes, filter: Bytes, fileName: Bytes): void; // answer with fileDialogReply()
}

/** I/O window, text (original: TsimIO; trap15-a §3-§5). */
export interface HostIoText {
  charOut(ch: number): void;
  textOut(text: Bytes): void;
  textOutCR(text: Bytes): void;
  clear(): void;
  getrc(): number | undefined; // (column << 8) | row, for D1.W
  gotorc(row: number, col: number): void;
  setFontProperties(color: number, style: number): void; // task 21: D1.L, D2.L
  getCharAt(row: number, col: number): number | undefined; // task 22, for D1.B
  scrollRect(row: number, col: number, height: number, width: number, direction: number): void;
  setWindowSize(width: number, height: number): void; // 0,0 = keep size; always blacks the surface
  getWindowSize(): [number, number] | undefined;
  setupWindow(fullScreen: boolean): void; // enter or leave full screen
  ioShow(): void; // simIO->Show()
  ioBringToFront(): void; // Run pressed: bring forward and give the keyboard
  inputPrompt(mode: number): void; // prompt timer: 0 off, 1 on, 2 on starting "visible"
  erasePrompt(): void; // blank over the prompt cell
  inputEcho(ch: number, echo: boolean): void; // typed character during line input
  inputBackspace(echo: boolean): void;
  doCRLF(): void;
  invalidate(): void; // repaint the window from the back buffer
}

/** I/O window, graphics (trap15-b §4-§7). */
export interface HostIoGraphics {
  setLineColor(color: number): void;
  setFillColor(color: number): void;
  drawPixel(x: number, y: number): void;
  getPixel(x: number, y: number): number; // $00BBGGRR, or $FFFFFFFF outside the surface
  line(x1: number, y1: number, x2: number, y2: number): void;
  lineTo(x: number, y: number): void;
  moveTo(x: number, y: number): void;
  rectangle(x1: number, y1: number, x2: number, y2: number): void;
  ellipse(x1: number, y1: number, x2: number, y2: number): void;
  floodFill(x: number, y: number): void;
  unfilledRectangle(x1: number, y1: number, x2: number, y2: number): void;
  unfilledEllipse(x1: number, y1: number, x2: number, y2: number): void;
  setDrawingMode(mode: number): void; // task 92: 0-15 pen mode, 16/17 buffering, 18-255 table
  setPenWidth(width: number): void;
  formPaint(): void; // task 94
  drawText(text: Bytes, x: number, y: number): void; // task 95
  getXY(): [number, number] | undefined; // task 96: the window pen
}

/** Sound (trap15-b §11). undefined = leave D0 as it is. */
export interface HostSound {
  resetSounds(): void;
  playSound(fileName: Bytes): number | undefined; // task 70
  loadSound(fileName: Bytes, waveIndex: number): void; // task 71
  playSoundMem(waveIndex: number): number | undefined; // task 72
  controlSound(control: number, waveIndex: number): number | undefined; // task 76
  playSoundDX(fileName: Bytes): number | undefined; // task 73
  loadSoundDX(fileName: Bytes, waveIndex: number): number | undefined; // task 74
  playSoundMemDX(waveIndex: number): number | undefined; // task 75
  controlSoundDX(control: number, waveIndex: number): number | undefined; // task 77
}

/** Serial ports (trap15-a §6). */
export interface HostSerial {
  initComm(cid: number, portName: Bytes): number | undefined; // task 40, result for D0.W
  setCommParams(cid: number, settings: number): number | undefined; // task 41
  commRead(cid: number, count: number): Bytes | number; // task 42: bytes, or -1 / -2 / -3
  sendComm(cid: number, data: Bytes): { result: number; sent?: number } | undefined; // task 43
}

/** Network (trap15-b §12). Addresses are 68000 addresses; the host reads and writes engine.memory. */
export interface HostNet {
  /** Task 100. serverAddress is the 68000 address of the server string; the engine binding adds it
   *  (see the note under 3.3.4). */
  createNetClient(settings: number, server: Bytes, serverAddress?: number): number | undefined;
  createNetServer(settings: number): number | undefined; // task 101
  sendNet(settings: number, dataAddress: number, remoteIP: Bytes): { result: number; count?: number } | undefined;
  receiveNet(
    settings: number,
    bufferAddress: number,
    senderIPAddress: number,
  ): { result: number; count?: number } | undefined;
  sendPortNet(d1: number, dataAddress: number, remoteIP: Bytes): { d0: number; d1?: number } | undefined;
  receivePortNet(d1: number, bufferAddress: number, senderIPAddress: number): { d0: number; d1?: number } | undefined;
  closeNetConnection(closeIP: number): number | undefined; // task 104
  getLocalIP(localIPAddress: number): number | undefined; // task 105
  netCloseSockets(): number; // simulator reset
}

/** Printer page device (task 10). */
export interface HostPrinter {
  printerBeginDoc(): void;
  printerEndDoc(): void;
  printerMetric(which: number): number; // PrinterMetric, in printer pixels
  printerTextOut(x: number, y: number, ch: number): void;
}

/** The object given to createSim(): every method of every part, in one flat object. */
export type SimHost = HostMain &
  HostHardware &
  HostLog &
  HostFiles &
  HostIoText &
  HostIoGraphics &
  HostSound &
  HostSerial &
  HostNet &
  HostPrinter;
