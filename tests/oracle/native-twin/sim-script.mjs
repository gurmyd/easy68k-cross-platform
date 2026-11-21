#!/usr/bin/env node
// The simulator-twin script language, run through the WebAssembly engine (engine/dist/sim68k.wasm,
// through engine/sim/sim68k.mjs). sim-twin/driver.cpp runs the same scripts through the native
// twin; for every script the two transcripts must be byte-identical (ARCHITECTURE.md 6.2.1).
//
//     node tests/oracle/native-twin/sim-script.mjs --script <file> [--out <file>]
//
// The language and the transcript format are described in README.md ("Scripts"). Everything
// here mirrors driver.cpp line by line; a change to one must be made to the other.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

/** Status codes of the engine (engine/sim/shim/easy68k.h). */
export const STATUS = Object.freeze({
  RUNNING: 0,
  STOPPED: 1,
  WAIT_INPUT: 2,
  WAIT_DELAY: 3,
  WAIT_HOST: 4,
  WAIT_ALERT: 5,
  ERROR: 6,
  BUSY: -1,
});
const BUDGET = 1000;
/** At most this many waits are answered per command; a program that waits for ever ends the command. */
const WAIT_LIMIT = 10000;
const STATE_COUNT = 22; // sim_state(0) .. sim_state(SIM_ST_HOST_REQUEST)
const BOX_COUNT = 20;
const REGISTERS = [
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'USP',
  'SSP',
  'PC',
  'SR',
  'A7',
];
const OPTIONS = ['exceptions', 'bitfield', 'simhalt', 'elog', 'olog', 'logmemfrom', 'logmembytes'];

/**
 * How each host method's arguments are written into the transcript, as driver.cpp writes them:
 * i = signed integer, u = unsigned integer, b = 0/1, y = bytes. `null` = not recorded (the file
 * calls, which are real files in the twin, and the execution-log bytes, which `dump log` shows).
 */
export const HOST_FORMATS = Object.freeze({
  message: 'y',
  messagesClear: '',
  alert: 'yy',
  registersShown: '',
  menuState: 'i',
  focusMain: '',
  autoTraceTimer: 'b',
  keyCommands: 'b',
  optionChanged: 'ii',
  saveSettings: '',
  caption: 'y',
  repaint: 'i',
  memoryLivePaint: 'u',
  fontAssign: 'ii',
  hardwareUpdate: '',
  hardwareState: 'bb',
  hardwareTimer: 'ibu',
  hardwareShow: '',
  hardwareControls: '',
  logWrite: null,
  logState: 'b',
  outputLogWrite: 'y',
  timeCentiseconds: '',
  fileOpen: null,
  fileRead: null,
  fileWrite: null,
  fileSeek: null,
  fileClose: null,
  fileRemove: null,
  fileDialog: 'iyyy',
  charOut: 'i',
  textOut: 'y',
  textOutCR: 'y',
  clear: '',
  getrc: '',
  gotorc: 'ii',
  setFontProperties: 'ii',
  getCharAt: 'ii',
  scrollRect: 'iiiii',
  setWindowSize: 'ii',
  getWindowSize: '',
  setupWindow: 'b',
  ioShow: '',
  ioBringToFront: '',
  inputPrompt: 'i',
  erasePrompt: '',
  inputEcho: 'ib',
  inputBackspace: 'b',
  doCRLF: '',
  invalidate: '',
  setLineColor: 'i',
  setFillColor: 'i',
  drawPixel: 'ii',
  getPixel: 'ii',
  line: 'iiii',
  lineTo: 'ii',
  moveTo: 'ii',
  rectangle: 'iiii',
  ellipse: 'iiii',
  floodFill: 'ii',
  unfilledRectangle: 'iiii',
  unfilledEllipse: 'iiii',
  setDrawingMode: 'i',
  setPenWidth: 'i',
  formPaint: '',
  drawText: 'yii',
  getXY: '',
  resetSounds: '',
  playSound: 'y',
  loadSound: 'yi',
  playSoundMem: 'i',
  controlSound: 'ii',
  playSoundDX: 'y',
  loadSoundDX: 'yi',
  playSoundMemDX: 'i',
  controlSoundDX: 'ii',
  initComm: 'iy',
  setCommParams: 'ii',
  commRead: 'ii',
  sendComm: 'iy',
  createNetClient: 'iyu',
  createNetServer: 'i',
  sendNet: 'iuy',
  receiveNet: 'iuu',
  sendPortNet: 'iuy',
  receivePortNet: 'iuu',
  closeNetConnection: 'i',
  getLocalIP: 'u',
  netCloseSockets: '',
  printerBeginDoc: '',
  printerEndDoc: '',
  printerMetric: 'i',
  printerTextOut: 'iii',
});

/** CRC-32 (IEEE 802.3, as zlib), for `dump crc`. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 of bytes, continuing from crc (0 to start). */
export function crc32(bytes, crc = 0) {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** Up to this many bytes of a host-call argument are written out; longer ones as #length:CRC. */
const LONG_BYTES = 512;

/** A bytes argument of a host call, as driver.cpp writes it. */
export function formatBytesArgument(bytes) {
  return bytes.length <= LONG_BYTES ? escapeBytes(bytes) : `#${bytes.length}:${hex(crc32(bytes), 8)}`;
}

const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const hex = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

/** Bytes as a transcript string: printable ASCII except " and \ as is, everything else \xHH. */
export function escapeBytes(bytes) {
  let s = '"';
  for (const c of bytes)
    s += c >= 0x20 && c < 0x7f && c !== 0x22 && c !== 0x5c ? String.fromCharCode(c) : `\\x${hex2(c)}`;
  return s + '"';
}

const latin1 = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
const text1 = (bytes) => String.fromCharCode(...bytes);

/**
 * A plain file name a program may open: 1-64 characters A-Z a-z 0-9 . _ -, not starting or ending
 * with '.', and not a Windows device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9, with or without an
 * extension). The twin opens real Windows files, where a trailing dot is dropped ('DATA.TXT.'
 * opens data.txt) and a device name opens the device; neither has a counterpart here, so both
 * sides refuse such names (twin_plain_name in sim-twin/hostfile-native.cpp is the same rule).
 */
export function isPlainName(name) {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(name) || name.endsWith('.')) return false;
  return !/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(name.split('.')[0] ?? '');
}

const hexDigit = (c) => {
  const i = '0123456789abcdef'.indexOf(c.toLowerCase());
  return c.length === 1 ? i : -1;
};

/**
 * Split a script line into tokens: words, or double-quoted strings with the escapes
 * \r \n \t \\ \" \xHH. A string token's text is a Latin-1 string (one character per byte).
 * @returns {{ text: string, quoted: boolean }[]}
 */
export function tokenize(
  line,
  fail = (m) => {
    throw new Error(m);
  },
) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ' ' || line[i] === '\t') {
      i++;
      continue;
    }
    const quoted = line[i] === '"';
    let text = '';
    if (quoted) {
      i++;
      for (;;) {
        if (i >= line.length) fail('unterminated string');
        const c = line[i++];
        if (c === '"') break;
        if (c !== '\\') {
          text += c;
          continue;
        }
        if (i >= line.length) fail('bad escape');
        const e = line[i++];
        if (e === 'r') text += '\r';
        else if (e === 'n') text += '\n';
        else if (e === 't') text += '\t';
        else if (e === '\\' || e === '"') text += e;
        else if (e === 'x' && i + 1 < line.length && hexDigit(line[i]) >= 0 && hexDigit(line[i + 1]) >= 0) {
          text += String.fromCharCode(hexDigit(line[i]) * 16 + hexDigit(line[i + 1]));
          i += 2;
        } else fail('bad escape');
      }
    } else {
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t') text += line[i++];
    }
    tokens.push({ text, quoted });
  }
  return tokens;
}

/** $hex, 0xhex or decimal, optionally negative, wrapped to a signed 32-bit integer. */
export function parseNumber(
  s,
  fail = (m) => {
    throw new Error(m);
  },
) {
  let i = 0;
  let negative = false;
  if (s[i] === '-') {
    negative = true;
    i++;
  }
  let base = 10;
  if (s[i] === '$') {
    base = 16;
    i++;
  } else if (s[i] === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
    base = 16;
    i += 2;
  }
  if (i >= s.length) fail(`bad number: ${s}`);
  let v = 0;
  for (; i < s.length; i++) {
    const d = hexDigit(s[i]);
    if (d < 0 || d >= base) fail(`bad number: ${s}`);
    v = (v * base + d) % 4294967296;
  }
  return (negative ? (4294967296 - v) % 4294967296 : v) | 0;
}

/**
 * In-memory files of the 68000 program with the semantics of the twin's real files
 * (fopen "r+b" / "rb" / "w+b" on a case-insensitive file system, unbuffered). A file is open in at
 * most one stream: a second open of it fails, and so does its removal, until the stream is closed
 * (the twin keeps the same rule in sim-twin/hostfile-native.cpp). What Windows does with two
 * streams on one file has no counterpart here, so neither side allows it.
 */
export class Sandbox {
  constructor() {
    /** @type {Map<string, { name: string, data: Uint8Array }>} key = lower-case name */
    this.files = new Map();
    /** @type {Map<number, { key: string, pos: number, readOnly: boolean }>} */
    this.handles = new Map();
    this.nextHandle = 1;
  }
  put(name, data) {
    const key = name.toLowerCase();
    const existing = this.files.get(key);
    this.files.set(key, { name: existing ? existing.name : name, data });
  }
  open(nameBytes, mode) {
    const name = text1(nameBytes);
    if (!isPlainName(name)) return 0;
    const key = name.toLowerCase();
    if (this.isOpen(key)) return 0;
    if (mode === 2) this.put(name, new Uint8Array(0));
    else if (!this.files.has(key)) return 0;
    const handle = this.nextHandle++;
    this.handles.set(handle, { key, pos: 0, readOnly: mode === 1 });
    return handle;
  }
  read(handle, count) {
    const h = this.handles.get(handle);
    if (!h) return null;
    const data = this.files.get(h.key)?.data ?? new Uint8Array(0);
    const part = data.slice(Math.min(h.pos, data.length), Math.min(h.pos + count, data.length));
    h.pos += part.length;
    return part;
  }
  write(handle, bytes) {
    const h = this.handles.get(handle);
    if (!h || h.readOnly) return -1;
    const file = this.files.get(h.key);
    if (!file) return -1;
    const end = h.pos + bytes.length;
    if (end > file.data.length) {
      const grown = new Uint8Array(end);
      grown.set(file.data);
      file.data = grown;
    }
    file.data.set(bytes, h.pos);
    h.pos = end;
    return bytes.length;
  }
  seek(handle, offset, whence) {
    const h = this.handles.get(handle);
    if (!h) return -1;
    const size = this.files.get(h.key)?.data.length ?? 0;
    const base = whence === 0 ? 0 : whence === 1 ? h.pos : size;
    const position = base + offset;
    if (position < 0) return -1;
    h.pos = position;
    return position;
  }
  close(handle) {
    return this.handles.delete(handle);
  }
  remove(nameBytes) {
    const name = text1(nameBytes);
    return isPlainName(name) && !this.isOpen(name.toLowerCase()) && this.files.delete(name.toLowerCase());
  }
  /** Whether a stream on the file with this lower-case name is open. */
  isOpen(key) {
    for (const h of this.handles.values()) if (h.key === key) return true;
    return false;
  }
  /** The `dump files` lines. */
  dump() {
    const files = [...this.files.values()].sort((a, b) =>
      a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0,
    );
    return [
      `files ${files.length}`,
      ...files.map((f) => `file ${escapeBytes(latin1(f.name))} ${f.data.length} ${[...f.data].map(hex2).join('')}`),
    ];
  }
}

let cachedCreateSim = null;
async function loadCreateSim() {
  if (!cachedCreateSim)
    cachedCreateSim = (await import(pathToFileURL(join(repo, 'engine', 'sim', 'sim68k.mjs')).href)).createSim;
  return cachedCreateSim;
}

/**
 * Run a script through the WebAssembly engine.
 * @param {string} script the script text (Latin-1: one character per byte)
 * @param {{ scriptDir?: string, wasmModule?: WebAssembly.Module }} [options]
 * @returns {Promise<string>} the transcript, each line ending in "\n"
 */
export async function runScript(script, options = {}) {
  const scriptDir = options.scriptDir ?? process.cwd();
  const out = [];
  const line = (s) => out.push(s);
  let hostLog = true;
  let timeValue = 0;
  const keys = [];
  const dialogReplies = [];
  const sandbox = new Sandbox();
  const logBytes = [];
  let lineNumber = 0;
  const fail = (what) => {
    throw new Error(`script line ${lineNumber}: ${what}`);
  };

  // ---- the host ------------------------------------------------------------------------
  /** @type {Record<string, (...args: any[]) => undefined>} one recorder per recorded method */
  const rec = {};
  for (const [name, format] of Object.entries(HOST_FORMATS)) {
    if (format === null) continue;
    rec[name] = (...args) => {
      if (hostLog) {
        let s = `@${name}`;
        for (let k = 0; k < format.length; k++) {
          const v = args[k];
          const f = format[k];
          s +=
            ' ' +
            (f === 'y'
              ? formatBytesArgument(v)
              : f === 'b'
                ? v
                  ? '1'
                  : '0'
                : f === 'u'
                  ? String(v >>> 0)
                  : String(v | 0));
        }
        line(s);
      }
      return undefined;
    };
  }
  // The answers of driver.cpp, which are the defaults of sim68k.mjs (HOST_DEFAULTS).
  const host = { ...rec };
  host.timeCentiseconds = () => {
    rec.timeCentiseconds();
    return timeValue;
  };
  host.getWindowSize = () => {
    rec.getWindowSize();
    return [640, 480];
  };
  host.getPixel = (x, y) => {
    rec.getPixel(x, y);
    return 0;
  };
  host.commRead = (cid, n) => {
    rec.commRead(cid, n);
    return -3;
  };
  host.netCloseSockets = () => {
    rec.netCloseSockets();
    return 0;
  };
  host.printerMetric = (which) => {
    rec.printerMetric(which);
    return 0;
  };
  host.logWrite = (data) => {
    for (const b of data) logBytes.push(b);
  };
  host.fileOpen = (name, mode) => sandbox.open(name, mode);
  host.fileRead = (handle, count) => sandbox.read(handle, count);
  host.fileWrite = (handle, data) => sandbox.write(handle, data);
  host.fileSeek = (handle, offset, whence) => sandbox.seek(handle, offset, whence);
  host.fileClose = (handle) => sandbox.close(handle);
  host.fileRemove = (name) => sandbox.remove(name);

  const createSim = await loadCreateSim();
  const sim = await createSim(host, options.wasmModule ? { wasmModule: options.wasmModule } : {});
  const m = sim._m; // the raw exports, for the few calls sim68k.mjs wraps differently

  // ---- helpers ---------------------------------------------------------------------------
  const resolvePath = (p) => (p.length > 1 && (p[1] === ':' || p[0] === '\\' || p[0] === '/') ? p : join(scriptDir, p));
  const readFile = (p) => {
    try {
      return new Uint8Array(readFileSync(resolvePath(p)));
    } catch {
      return fail(`cannot read: ${p}`);
    }
  };
  const baseName = (p) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1);
  const num = (t) => parseNumber(t.text, fail);
  const steps = () => sim.stepCount;

  const settle = (initial, startSteps, limit) => {
    let status = initial;
    for (let waits = 0; ; waits++) {
      if (waits === WAIT_LIMIT) {
        line(`wait-limit ${status}`);
        return status;
      }
      if (status === STATUS.WAIT_ALERT) {
        line('wait alert');
        sim.dismissAlert();
      } else if (status === STATUS.WAIT_DELAY) {
        const remaining = sim.delayRemaining;
        line(`wait delay ${remaining}`);
        sim.delayElapsed(remaining);
      } else if (status === STATUS.WAIT_HOST) {
        line('wait host');
        const reply = dialogReplies.shift();
        if (reply) sim.fileDialogReply(reply.accepted, latin1(reply.name));
        else sim.fileDialogReply(false, '');
      } else if (status === STATUS.WAIT_INPUT) {
        if (keys.length === 0) {
          line('wait input-exhausted');
          return status;
        }
        sim.keyChar(keys.shift());
      } else if (status === STATUS.RUNNING) {
        if ((steps() - startSteps) >>> 0 >= limit) {
          line('limit');
          return status;
        }
      } else {
        return status;
      }
      const done = (steps() - startSteps) >>> 0;
      const left = done >= limit ? 0 : limit - done;
      status = sim.run(Math.min(left, BUDGET));
    }
  };
  const reportStatus = (status, startSteps) => line(`status ${status} steps ${(steps() - startSteps) >>> 0}`);

  const dump = (t) => {
    if (t.length < 2) fail('dump what?');
    const what = t[1].text;
    const mem = sim.memory;
    if (what === 'regs') {
      let s = 'regs';
      for (let r = 0; r < 18; r++) s += ` ${REGISTERS[r]}=${hex(m._sim_reg_get(r), 8)}`;
      const cycles = (BigInt(m._sim_cycles_hi() >>> 0) << 32n) | BigInt(m._sim_cycles_lo() >>> 0);
      s += ` SR=${hex(m._sim_reg_get(18) & 0xffff, 4)} cycles=${cycles}`;
      line(s);
    } else if (what === 'state') {
      let s = 'state';
      for (let i = 0; i < STATE_COUNT; i++) s += ` ${m._sim_state(i) | 0}`;
      line(s);
    } else if (what === 'boxes') {
      let s = 'boxes';
      for (let i = 0; i < BOX_COUNT; i++) s += ' ' + escapeBytes(latin1(sim.boxText(i)));
      line(s);
    } else if (what === 'log') {
      line(`log ${escapeBytes(logBytes)}`);
    } else if (what === 'files') {
      for (const l of sandbox.dump()) line(l);
    } else if (what === 'mem') {
      if (t.length !== 4) fail('dump mem <address> <length>');
      const addr = num(t[2]) & 0xffffff;
      const len = num(t[3]);
      for (let done = 0; done < len; done += 32) {
        let s = `mem ${hex((addr + done) & 0xffffff, 6)} `;
        for (let i = done; i < len && i < done + 32; i++) s += hex2(mem[(addr + i) & 0xffffff]);
        line(s);
      }
    } else if (what === 'crc') {
      if (t.length !== 4) fail('dump crc <address> <length>');
      const addr = num(t[2]) & 0xffffff;
      const len = num(t[3]) >>> 0;
      let crc;
      if (addr + len <= mem.length) crc = crc32(mem.subarray(addr, addr + len));
      else {
        crc = 0;
        for (let i = 0; i < len; i++) crc = crc32([mem[(addr + i) & 0xffffff]], crc);
      }
      line(`crc ${hex(addr, 6)} ${len} ${hex(crc, 8)}`);
    } else if (what === 'bytes') {
      let s = 'bytes ';
      for (let i = 2; i < t.length; i++) s += hex2(mem[num(t[i]) & 0xffffff]);
      line(s);
    } else fail(`unknown dump: ${what}`);
  };

  const command = (t) => {
    const c = t[0].text;
    if (c === 'option') {
      if (t.length !== 3) fail('option <name> <value>');
      const o = OPTIONS.indexOf(t[1].text);
      if (o < 0) fail(`unknown option: ${t[1].text}`);
      m._sim_set_option(o, num(t[2]));
    } else if (c === 'load' || c === 'loaddata') {
      if (t.length < 2) fail('load <s68> [<l68>|-] [name]');
      const haveS68 = t[1].text !== '-';
      const s68 = haveS68 ? readFile(t[1].text) : null;
      const l68 = c === 'load' && t.length >= 3 && t[2].text !== '-' ? readFile(t[2].text) : null;
      const nameAt = c === 'load' ? 3 : 2;
      const name = t.length > nameAt ? t[nameAt].text : haveS68 ? baseName(t[1].text) : 'program.S68';
      if (c === 'loaddata') {
        line(sim.loadData(s68, latin1(name)) ? 'loaddata ok' : 'loaddata fail');
        return;
      }
      sim.load(s68, l68, { name: latin1(name), kind: 'open' });
    } else if (c === 'file') {
      if (t.length !== 3) fail('file <name> <path>');
      const data = readFile(t[2].text);
      if (!isPlainName(t[1].text)) fail(`not a plain file name: ${t[1].text}`);
      sandbox.put(t[1].text, data);
    } else if (c === 'reg') {
      if (t.length !== 3) fail('reg <name> <value>');
      const r = REGISTERS.indexOf(t[1].text);
      if (r < 0) fail(`unknown register: ${t[1].text}`);
      m._sim_reg_set(r, num(t[2]));
    } else if (c === 'poke') {
      if (t.length !== 3 || t[2].text.length % 2) fail('poke <address> <hex bytes>');
      const addr = num(t[1]);
      const h = t[2].text;
      const mem = sim.memory;
      for (let i = 0; i < h.length; i += 2) {
        const hi = hexDigit(h[i]);
        const lo = hexDigit(h[i + 1]);
        if (hi < 0 || lo < 0) fail(`bad hex bytes: ${h}`);
        mem[(addr + i / 2) & 0xffffff] = hi * 16 + lo;
      }
    } else if (c === 'keys') {
      if (t.length !== 2) fail('keys <string>');
      for (const ch of t[1].text) keys.push(ch.charCodeAt(0) & 0xff);
    } else if (c === 'time') {
      if (t.length !== 2) fail('time <centiseconds>');
      timeValue = num(t[1]) >>> 0;
    } else if (c === 'dialog') {
      if (t.length === 3 && t[1].text === 'accept') dialogReplies.push({ accepted: true, name: t[2].text });
      else if (t.length === 2 && t[1].text === 'cancel') dialogReplies.push({ accepted: false, name: '' });
      else fail('dialog accept <name> | dialog cancel');
    } else if (c === 'run') {
      if (t.length !== 2) fail('run <max steps>');
      const start = steps();
      sim.cmdRun();
      reportStatus(settle(sim.run(0), start, num(t[1]) >>> 0), start);
    } else if (c === 'trace') {
      if (t.length !== 2) fail('trace <count>');
      const n = num(t[1]);
      const start = steps();
      let status = STATUS.STOPPED;
      for (let i = 0; i < n; i++) {
        const before = steps();
        status = settle(sim.cmdTraceInto(), before, 0);
      }
      reportStatus(status, start);
    } else if (c === 'pause') {
      sim.cmdPause();
    } else if (c === 'rewind') {
      sim.rewind();
    } else if (c === 'irq') {
      if (t.length !== 2) fail('irq <level>');
      const start = steps();
      if (m._sim_irq(num(t[1])) !== 0) reportStatus(settle(sim.run(0), start, 0x7fffffff), start);
    } else if (c === 'logdialog') {
      sim.logDialogOpened();
    } else if (c === 'logstart') {
      if (t.length !== 2) fail('logstart <time text>');
      sim.startLog(latin1(t[1].text));
    } else if (c === 'logstop') {
      sim.stopLog();
    } else if (c === 'hostlog') {
      if (t.length !== 2) fail('hostlog on|off');
      hostLog = t[1].text === 'on';
    } else if (c === 'echo') {
      line(['echo', ...t.slice(1).map((x) => x.text)].join(' '));
    } else if (c === 'dump') {
      dump(t);
    } else fail(`unknown command: ${c}`);
  };

  const lines = script.split('\n');
  for (let l of lines) {
    lineNumber++;
    if (l.endsWith('\r')) l = l.slice(0, -1);
    const trimmed = l.replace(/^[ \t]+/, '');
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const tokens = tokenize(l, fail);
    if (tokens.length) command(tokens);
  }
  return out.length ? out.join('\n') + '\n' : '';
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const scriptPath = arg('--script');
  if (!scriptPath) {
    console.error('usage: node sim-script.mjs --script <file> [--out <file>]');
    process.exit(2);
  }
  runScript(readFileSync(scriptPath, 'latin1'), { scriptDir: dirname(resolve(scriptPath)) })
    .then((transcript) => {
      const outPath = arg('--out');
      if (outPath) writeFileSync(outPath, transcript, 'latin1');
      else process.stdout.write(Buffer.from(transcript, 'latin1'));
    })
    .catch((error) => {
      console.error(String(error instanceof Error ? error.message : error));
      process.exit(2);
    });
}
