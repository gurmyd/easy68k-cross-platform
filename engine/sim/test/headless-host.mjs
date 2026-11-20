// easy68k-mac: headless-host.mjs - a reference host with no user interface.
//
// It implements the SimHost interface of ../sim68k.mjs for tests and for the
// command-line runner (run-s68.mjs):
//
//   * text output goes to a model of the I/O window's text screen that follows
//     the original's character rules (docs/porting/trap15-tasks-0-59.md
//     sections 3.4-3.7: control characters, cursor clamping, wrap, scrolling,
//     the shadow text array) and to a transcript with the bytes the original
//     would write to its output log;
//   * keyboard input comes from a script (a queue of characters);
//   * files of the 68000 program live in memory;
//   * time is simulated: it advances with the cycle counter and with
//     TRAP #15 task 23 delays, never with the wall clock, so runs repeat exactly;
//   * graphics, sound, serial, network and printer calls are recorded with
//     their arguments (their real implementations belong to the I/O window).
//
// drive() is the loop a host needs around Sim68k.run(): it handles every
// wait state, the auto-interrupt timers and the end of the program.

import { HOST_DEFAULTS, Status, bytesToText, textToBytes } from '../sim68k.mjs';

const MAX_ROWS = 128;
const MAX_COLS = 256;
const ROW_HEIGHT = 15; // Fixedsys 9 at 96 DPI: 8 x 15 pixel cells
const COL_WIDTH = 8;

/**
 * @typedef {object} HeadlessOptions
 * @property {string|Uint8Array|number[]} [keys]
 *   Characters to type. In a string, "\n" stands for the Enter key (13).
 * @property {Record<string, Uint8Array|string>} [files] initial files of the in-memory file system
 * @property {string[]} [readOnlyFiles] names of files that cannot be opened for writing
 * @property {number} [startCentiseconds] time of day at the start, 1/100 s since midnight (default 12:00:00)
 * @property {number} [cyclesPerMillisecond] 68000 clock used to turn cycles into time (default 8000 = 8 MHz)
 * @property {boolean} [textWrap] Options > Output Window Text Wrap (default off)
 * @property {Record<string, any>} [results]
 *   Return values for recorded stubs, by method name: a value, or a function of the arguments.
 * @property {{accepted: boolean, fileName?: string}[]} [dialogReplies] answers for TRAP #15 task 58, in order
 */

export class HeadlessHost {
  /** @param {HeadlessOptions} [options] */
  constructor(options = {}) {
    /** Message area lines, as text (one character per byte). @type {string[]} */
    this.messages = [];
    /** Message boxes shown. @type {{title: string, text: string}[]} */
    this.alerts = [];
    /** Every call of a recorded stub. @type {{name: string, args: any[]}[]} */
    this.calls = [];
    /** Bytes written to the execution log. @type {number[]} */
    this.execLog = [];
    /** Bytes written to the output-log notes (host.outputLogWrite). @type {number[]} */
    this.outputLogNotes = [];
    /** The bytes the original would write to its output log (see charOut). @type {number[]} */
    this.transcript = [];
    /** Number of scrshow() notifications. */
    this.registersShownCount = 0;
    this.menu = 0;
    this.logging = false;
    this.autoTraceTimerOn = false;
    this.keyCommandsEnabled = true;
    this.hardwareEnabled = true;
    this.autoIRQ = false;
    this.captionText = '';
    this.beeps = 0;

    // ---- text screen ----
    this.canWidth = 640;
    this.canHeight = 480;
    this.textWrap = options.textWrap ?? false;
    this.text = new Uint8Array(MAX_ROWS * MAX_COLS).fill(0x20);
    this.row = 0;
    this.col = 0;
    this._measure();

    // ---- keyboard script ----
    /** @type {number[]} */
    this.keys = [];
    if (options.keys !== undefined) this.type(options.keys);

    // ---- files ----
    /** @type {Map<string, Uint8Array>} */
    this.files = new Map();
    for (const [name, data] of Object.entries(options.files ?? {})) {
      this.files.set(HeadlessHost.fileKey(name), typeof data === 'string' ? textToBytes(data) : data);
    }
    this.readOnlyFiles = new Set((options.readOnlyFiles ?? []).map((n) => HeadlessHost.fileKey(n)));
    /** @type {Map<number, {key: string, position: number, writable: boolean}>} */
    this.handles = new Map();
    this.nextHandle = 1;

    // ---- clock and timers ----
    this.timeMs = 0;
    this.startCentiseconds = options.startCentiseconds ?? 12 * 60 * 60 * 100;
    this.cyclesPerMillisecond = options.cyclesPerMillisecond ?? 8000;
    /** Auto-interrupt timers by level 1..7. @type {{enabled: boolean, intervalMs: number, deadline: number}[]} */
    this.timers = [];
    for (let level = 0; level <= 7; level++) this.timers.push({ enabled: false, intervalMs: 1000, deadline: Infinity });

    this.results = options.results ?? {};
    this.dialogReplies = (options.dialogReplies ?? []).slice();
    /** Dialog requests seen. @type {{mode: number, title: string, filter: string, fileName: string}[]} */
    this.dialogs = [];

    // Every host method without an implementation below becomes a recording stub.
    for (const name of Object.keys(HOST_DEFAULTS)) {
      if (typeof this[name] === 'function') continue;
      this[name] = (...args) => {
        this.calls.push({ name, args });
        const result = this.results[name];
        return typeof result === 'function' ? result(...args) : (result !== undefined ? result : HOST_DEFAULTS[name]);
      };
    }
  }

  // ---- helpers for tests -----------------------------------------------------

  /** Append characters to the keyboard script. @param {string|Uint8Array|number[]} keys */
  type(keys) {
    if (typeof keys === 'string') {
      for (const ch of keys) this.keys.push(ch === '\n' ? 13 : ch.charCodeAt(0) & 0xFF);
    } else {
      for (const k of keys) this.keys.push(k & 0xFF);
    }
  }
  /** Everything printed, as the output log would have it. @returns {string} */
  get outputText() { return bytesToText(Uint8Array.from(this.transcript)); }
  /** @returns {string} */
  get execLogText() { return bytesToText(Uint8Array.from(this.execLog)); }
  /** The visible text rows, right-trimmed. @returns {string[]} */
  screenLines() {
    const lines = [];
    for (let r = 0; r < this.textRows; r++) {
      const start = r * this.textCols;
      lines.push(bytesToText(this.text.subarray(start, start + this.textCols)).replace(/ +$/, ''));
    }
    return lines;
  }
  /** Calls of one recorded stub. @param {string} name @returns {any[][]} */
  callsOf(name) { return this.calls.filter((c) => c.name === name).map((c) => c.args); }
  /** File-system key of a name: case-insensitive, "\" = "/", no leading "./". @param {string|Uint8Array} name */
  static fileKey(name) {
    const text = typeof name === 'string' ? name : bytesToText(name);
    return text.replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
  }
  /** @param {string} name @returns {Uint8Array|undefined} */
  file(name) { return this.files.get(HeadlessHost.fileKey(name)); }

  // ---- main window -------------------------------------------------------------

  message(text) { this.messages.push(bytesToText(text)); }
  messagesClear() { this.messages.length = 0; }
  alert(title, text) { this.alerts.push({ title: bytesToText(title), text: bytesToText(text) }); }
  registersShown() { this.registersShownCount++; }
  menuState(state) { this.menu = state; }
  autoTraceTimer(enabled) { this.autoTraceTimerOn = enabled; }
  keyCommands(enabled) { this.keyCommandsEnabled = enabled; }
  caption(text) { this.captionText = bytesToText(text); }
  repaint() {}
  focusMain() {}
  ioShow() {}
  ioBringToFront() {}
  invalidate() {}
  inputPrompt() {}
  erasePrompt() {}

  // ---- log ------------------------------------------------------------------------

  logWrite(data) { for (const b of data) this.execLog.push(b); }
  logState(logging) { this.logging = logging; }
  outputLogWrite(data) { for (const b of data) this.outputLogNotes.push(b); }

  // ---- clock and timers --------------------------------------------------------------

  timeCentiseconds() { return (this.startCentiseconds + Math.floor(this.timeMs / 10)) % 8640000; }
  hardwareState(enabled, autoIRQ) {
    this.hardwareEnabled = enabled;
    this.autoIRQ = autoIRQ;
  }
  hardwareTimer(level, enabled, intervalMs) {
    const timer = this.timers[level];
    timer.enabled = enabled;
    timer.intervalMs = intervalMs;
    // A Windows timer first fires one full interval after it is (re)started; 0 never fires.
    timer.deadline = (enabled && intervalMs > 0) ? this.timeMs + intervalMs : Infinity;
  }
  /** Time of the next timer tick, Infinity if no timer runs. @returns {number} */
  nextDeadline() { return Math.min(...this.timers.map((t) => t.deadline)); }
  /**
   * Advance simulated time and deliver the timer ticks that fall due.
   * @param {import('../sim68k.mjs').Sim68k} sim @param {number} ms
   */
  advance(sim, ms) {
    const target = this.timeMs + ms;
    for (;;) {
      let due = 0;
      for (let level = 1; level <= 7; level++) {
        if (this.timers[level].deadline <= target && (due === 0 || this.timers[level].deadline < this.timers[due].deadline)) due = level;
      }
      if (due === 0) break;
      const timer = this.timers[due];
      this.timeMs = Math.max(this.timeMs, timer.deadline);
      timer.deadline += timer.intervalMs;
      sim.timerTick(due); // may change the timers through hardwareTimer()
    }
    this.timeMs = target;
  }

  // ---- files ----------------------------------------------------------------------------

  fileOpen(name, mode) {
    const key = HeadlessHost.fileKey(name);
    const exists = this.files.has(key);
    if (mode === 2) { // create or truncate
      if (this.readOnlyFiles.has(key)) return 0;
      this.files.set(key, new Uint8Array(0));
    } else if (!exists || (mode === 0 && this.readOnlyFiles.has(key))) {
      return 0;
    }
    const handle = this.nextHandle++;
    this.handles.set(handle, { key, position: 0, writable: mode !== 1 });
    return handle;
  }
  fileRead(handle, count) {
    const h = this.handles.get(handle);
    const data = h && this.files.get(h.key);
    if (!data) return null;
    const chunk = data.slice(Math.min(h.position, data.length), Math.min(h.position + count, data.length));
    h.position += chunk.length;
    return chunk;
  }
  fileWrite(handle, bytes) {
    const h = this.handles.get(handle);
    if (!h || !h.writable || !this.files.has(h.key)) return -1;
    let data = this.files.get(h.key);
    const end = h.position + bytes.length;
    if (end > data.length) {
      const grown = new Uint8Array(end);
      grown.set(data);
      data = grown;
      this.files.set(h.key, data);
    }
    data.set(bytes, h.position);
    h.position = end;
    return bytes.length;
  }
  fileSeek(handle, offset, whence) {
    const h = this.handles.get(handle);
    const data = h && this.files.get(h.key);
    if (!data) return -1;
    const position = (whence === 0 ? 0 : whence === 1 ? h.position : data.length) + offset;
    if (position < 0) return -1;
    h.position = position;
    return position;
  }
  fileClose(handle) { return this.handles.delete(handle); }
  fileRemove(name) { return this.files.delete(HeadlessHost.fileKey(name)); }
  fileDialog(mode, title, filter, fileName) {
    this.dialogs.push({ mode, title: bytesToText(title), filter: bytesToText(filter), fileName: bytesToText(fileName) });
  }

  // ---- text screen (simIOu.cpp:811-1144) ----------------------------------------------------

  _measure() {
    this.textRows = Math.min(Math.floor(this.canHeight / ROW_HEIGHT), MAX_ROWS);
    this.textCols = Math.min(Math.floor(this.canWidth / COL_WIDTH), MAX_COLS);
  }
  setWindowSize(width, height) {
    if (width === 0 && height === 0) return; // keep the current size
    this.canHeight = Math.max(height, 480);
    this.canWidth = Math.max(width, 640);
    this._measure();
  }
  getWindowSize() { return [this.canWidth, this.canHeight]; }
  clear() {
    this.text.fill(0x20);
    this.row = 0;
    this.col = 0;
  }
  _scroll() {
    for (let i = 0; i < this.textRows - 1; i++) {
      this.text.copyWithin(i * this.textCols, (i + 1) * this.textCols, (i + 2) * this.textCols);
    }
    this.text.fill(0x20, (this.textRows - 1) * this.textCols, this.textRows * this.textCols);
  }
  gotorc(r, c) {
    if (r < 0) r = 0;
    else if (ROW_HEIGHT * r > this.canHeight - ROW_HEIGHT) {
      this._scroll(); // one row, however far below the bottom r is
      r = Math.floor(this.canHeight / ROW_HEIGHT) - 1;
    }
    if (c < 0) c = 0;
    else if (COL_WIDTH * c > this.canWidth - COL_WIDTH && this.textWrap) {
      this.doCRLF(); // uses the current row, not r (original quirk)
      return;
    }
    this.row = Math.min(r, MAX_ROWS - 1);
    this.col = Math.min(c, MAX_COLS - 1);
  }
  doCRLF() {
    this.col = 0;
    this.row++;
    this.gotorc(this.row, this.col);
    this.transcript.push(0x0A); // the output log gets "\n" only
  }
  charOut(ch) {
    switch (ch) {
      case 0x07: this.beeps++; break;
      case 0x08: this.col--; this.transcript.push(ch); break;
      case 0x09: this.col += 5; this.transcript.push(ch); break;
      case 0x0A: this.row++; this.transcript.push(ch); break;
      case 0x0B: this.row += 4; this.transcript.push(ch); break;
      case 0x0C: this.clear(); this.transcript.push(ch); break;
      case 0x0D: this.col = 0; this.transcript.push(ch); break;
      default:
        if (ch >= 0x20) { // $20-$FF print; $00-$06 and $0E-$1F are ignored
          this.text[this.row * this.textCols + this.col] = ch;
          this.col++;
          this.transcript.push(ch);
        }
    }
    this.gotorc(this.row, this.col);
  }
  textOut(text) { for (const ch of text) this.charOut(ch); }
  textOutCR(text) {
    this.textOut(text);
    this.doCRLF();
  }
  getrc() {
    const signed = (v) => (v << 24) >> 24; // (char) of the original
    return (((signed(this.col) << 8) | signed(this.row)) << 16) >> 16;
  }
  getCharAt(r, c) {
    if (r >= MAX_ROWS) r = MAX_ROWS - 1;
    if (c >= MAX_COLS) c = MAX_COLS - 1;
    return this.text[r * this.textCols + c];
  }
  inputEcho(ch, echo) {
    if (echo) this.transcript.push(ch); // drawn, logged, but not stored in the text array
    this.gotorc(this.row, this.col + 1);
  }
  inputBackspace() { this.gotorc(this.row, this.col - 1); }
}

/**
 * @typedef {object} DriveOptions
 * @property {number} [maxInstructions] stop after about this many instructions (default 50 million)
 * @property {number} [slice] instructions per call of run() (default 20000)
 * @property {number} [maxSimulatedMs] stop when simulated time exceeds this (default 1 hour)
 * @property {number} [maxWallMs] stop after this much real time (default: no limit)
 */
/**
 * @typedef {object} DriveResult
 * @property {'stopped'|'input'|'budget'|'time'|'error'} reason
 *   stopped: the program is not running (halted, breakpoint, trace step, pause);
 *   input: it waits for keyboard input and the script is empty;
 *   budget / time: a limit of DriveOptions was reached while it was still running;
 *   error: the engine reported Status.ERROR
 * @property {number} status the last Status
 * @property {number} slices number of run() calls
 */

/**
 * Run the simulator until the program stops, needs input that the script
 * cannot supply, or a limit is reached.  The caller issues the command first
 * (sim.cmdRun(), sim.cmdStepOver(), ...), or nothing to continue.
 *
 * @param {import('../sim68k.mjs').Sim68k} sim
 * @param {HeadlessHost} host
 * @param {DriveOptions} [options]
 * @returns {DriveResult}
 */
export function drive(sim, host, options = {}) {
  const maxInstructions = options.maxInstructions ?? 50_000_000;
  const slice = options.slice ?? 20000;
  const maxSimulatedMs = options.maxSimulatedMs ?? 3_600_000;
  const wallStart = Date.now();
  let budget = maxInstructions;
  let slices = 0;
  let idleTicks = 0;
  let status = Status.STOPPED;
  for (;;) {
    const before = sim.cycles;
    const stepsBefore = sim.stepCount;
    status = sim.run(Math.min(slice, Math.max(budget, 0)));
    slices++;
    budget -= (sim.stepCount - stepsBefore) >>> 0;
    const after = sim.cycles;
    // Simulated time follows the cycle counter (which the program can reset).
    const elapsedCycles = after >= before ? after - before : after;
    if (elapsedCycles > 0n) host.advance(sim, Number(elapsedCycles) / host.cyclesPerMillisecond);

    switch (status) {
      case Status.RUNNING:
        idleTicks = 0;
        if (budget <= 0) return { reason: 'budget', status, slices };
        break;
      case Status.WAIT_ALERT:
        sim.dismissAlert(); // the box was recorded by host.alert()
        break;
      case Status.WAIT_INPUT: {
        if (host.keys.length === 0) return { reason: 'input', status, slices };
        while (host.keys.length > 0 && sim.state().inputMode) sim.keyChar(host.keys.shift());
        break;
      }
      case Status.WAIT_DELAY: {
        // Sleep(10) per period; stop at the next timer tick so that it is
        // delivered at the right moment of the delay.
        const untilTimer = Math.max(1, Math.ceil((host.nextDeadline() - host.timeMs) / 10));
        const periods = Math.min(sim.delayRemaining, untilTimer);
        sim.delayElapsed(periods);
        host.advance(sim, periods * 10);
        break;
      }
      case Status.WAIT_HOST: {
        const reply = host.dialogReplies.shift() ?? { accepted: false };
        sim.fileDialogReply(reply.accepted, reply.fileName ?? '');
        break;
      }
      case Status.STOPPED: {
        // Stopped, but an auto-interrupt timer may wake it (STOP instruction).
        const deadline = host.nextDeadline();
        if (deadline === Infinity || !host.hardwareEnabled || sim.state().trace) return { reason: 'stopped', status, slices };
        host.advance(sim, deadline - host.timeMs);
        // A tick that does not start the program (masked after STOP) leaves it
        // stopped; give up after a while.
        if (!sim.state().runMode && ++idleTicks > 1000) return { reason: 'stopped', status, slices };
        break;
      }
      default:
        return { reason: 'error', status, slices };
    }
    if (host.timeMs > maxSimulatedMs) return { reason: 'time', status, slices };
    if (options.maxWallMs !== undefined && Date.now() - wallStart > options.maxWallMs) return { reason: 'time', status, slices };
  }
}
