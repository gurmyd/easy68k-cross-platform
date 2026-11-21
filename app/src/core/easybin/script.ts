// A small command language that drives the EASyBIN model the way the native oracle drives the
// original's functions (docs/porting/easybin.md 0.4). Owner: B1. Used by the tests: a script and the
// files it names go in, a canonical transcript comes out, and the transcript must equal the one the
// original's code printed for the same script (fixtures/*.expected).
//
//   reset                                        fresh process: memory $FF, empty line buffer
//   loadsrec <file>                              Open S-Record
//   loadbin <file> <First Address> <split>       Open Binary (split 0, 2 or 4)
//   savesrec <file> <From> <To> <Start> <Yes|No> Save S-Record; the answer to `File exists!`
//   savebin <file> <First> <Length> <split> <Yes|No>
//   copy <From> <To> <Size> / fill <From> <To> <byte>
//   digest / dump <address> <count> / touch <file> / remove <file>
//
// Values are field texts (hex digits), exactly as the user would type them.

import { encode } from '../codec/cp1252';
import { MESSAGES, type Split } from './constants';
import { hexText } from './fields';
import { EasybinModel } from './model';

/** FNV-1a, 32 bits, as the oracle computes it. */
function fnv(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, 16777619) >>> 0;
}
export function fnvBytes(bytes: Uint8Array): number {
  let hash = 2166136261;
  for (const byte of bytes) hash = fnv(hash, byte);
  return hash;
}

/** Every byte other than $FF, with its address, hashed (the oracle's `digest`). */
export function memoryDigest(memory: Uint8Array): { hash: number; count: number } {
  let hash = 2166136261;
  let count = 0;
  const words = new Uint32Array(memory.buffer, memory.byteOffset, memory.length >>> 2);
  for (let w = 0; w < words.length; w++) {
    if (words[w] === 0xffffffff) continue;
    for (let a = w * 4; a < w * 4 + 4; a++) {
      const byte = memory[a] as number;
      if (byte === 0xff) continue;
      hash = fnv(hash, a & 0xff);
      hash = fnv(hash, (a >>> 8) & 0xff);
      hash = fnv(hash, (a >>> 16) & 0xff);
      hash = fnv(hash, (a >>> 24) & 0xff);
      hash = fnv(hash, byte);
      count++;
    }
  }
  return { hash, count };
}

/** The oracle's jsonEscape, applied to the message's bytes (Windows-1252). */
export function escapeText(text: string): string {
  let out = '"';
  for (const byte of encode(text).bytes) {
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += '\\\\';
    else if (byte === 0x0a) out += '\\n';
    else if (byte === 0x0d) out += '\\r';
    else if (byte === 0x09) out += '\\t';
    else if (byte < 0x20 || byte >= 0x7f) out += `\\u${byte.toString(16).padStart(4, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out}"`;
}

const hex8 = (value: number) => hexText(value, 8);

function writtenLine(name: string, data: Uint8Array): string {
  let line = `written ${name} ${data.length} ${hex8(fnvBytes(data))}`;
  if (data.length <= 256) line += ` ${Array.from(data, (b) => hexText(b, 2)).join('')}`;
  return line;
}

/** Runs `script` over `files` (bare names; changed in place) and returns the transcript lines. */
export function runScript(script: string, files: Map<string, Uint8Array>): string[] {
  const out: string[] = [];
  let model = new EasybinModel();
  const box = (caption: string, text: string) => out.push(`box ${escapeText(caption)} ${escapeText(text)}`);
  const message = (text: string) => out.push(`message ${escapeText(text)}`);
  const printFile = (name: string) => {
    const data = files.get(name);
    if (data) out.push(writtenLine(name, data));
  };

  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('dir ')) continue;
    out.push(`> ${line}`);
    const [cmd, ...args] = line.split(/\s+/);
    const arg = (i: number) => args[i] ?? '';
    switch (cmd) {
      case 'reset':
        model = new EasybinModel();
        break;
      case 'loadsrec': {
        const data = files.get(arg(0));
        let ok = false;
        if (!data) message(MESSAGES.cannotOpenSrec(arg(0)));
        else {
          const result = model.openSRecord(arg(0), data);
          message(result.message);
          ok = result.ok;
        }
        out.push(
          `result ${ok ? 1 : 0} start=${hex8(model.startAddr)} end=${hex8(model.endAddr)} length=${hex8(model.length)}`,
        );
        break;
      }
      case 'loadbin': {
        model.setField('firstAddress', arg(1));
        model.setSplit(Number(arg(2)) as Split);
        const data = files.get(arg(0));
        if (!data) {
          message(MESSAGES.cannotOpenBinary(arg(0)));
          out.push('result 0');
        } else out.push(`result ${model.openBinary(arg(0), data)}`);
        break;
      }
      case 'savesrec': {
        model.setField('from', arg(1));
        model.setField('to', arg(2));
        model.setField('startAddress', arg(3));
        const plan = model.sRecordPlan();
        if (!plan) {
          out.push('beep');
          box(MESSAGES.invalidRangeTitle, MESSAGES.invalidRange);
        } else {
          let go = true;
          if (files.has(arg(0))) {
            box(MESSAGES.fileExistsTitle, MESSAGES.fileExists);
            go = arg(4) === 'Yes';
          }
          if (go) files.set(arg(0), model.sRecordBytes(plan));
        }
        printFile(arg(0));
        break;
      }
      case 'savebin': {
        model.setField('firstAddress', arg(1));
        model.setField('outLength', arg(2));
        const split = Number(arg(3)) as Split;
        model.setSplit(split);
        const plan = model.binaryPlan();
        const outputs = model.binaryOutputs({ first: 0, length: 0, split }, arg(0));
        if (!plan) {
          out.push('beep');
          box(MESSAGES.invalidRangeTitle, MESSAGES.invalidRange);
        } else {
          const result = model.binaryOutputs(plan, arg(0));
          let go = true;
          if (result.check.some((name) => files.has(name))) {
            box(MESSAGES.fileExistsTitle, MESSAGES.fileExists);
            go = arg(4) === 'Yes';
          }
          if (go) for (const file of result.files) files.set(file.name, file.data);
        }
        for (const file of outputs.files) printFile(file.name);
        break;
      }
      case 'copy':
      case 'fill': {
        model.setField('from', arg(0));
        model.setField('to', arg(1));
        model.setField(cmd === 'copy' ? 'bytes' : 'fillByte', arg(2));
        const result = cmd === 'copy' ? model.copy() : model.fill();
        if (result) message(result);
        else out.push('repaint');
        break;
      }
      case 'digest': {
        const { hash, count } = memoryDigest(model.memory);
        out.push(`digest ${hex8(hash)} ${count}`);
        break;
      }
      case 'dump': {
        const start = parseInt(arg(0), 16);
        const count = Number(arg(1));
        const bytes: string[] = [];
        for (let k = 0; k < count && start + k < model.memory.length; k++)
          bytes.push(` ${hexText(model.memory[start + k] as number, 2)}`);
        out.push(`dump${bytes.join('')}`);
        break;
      }
      case 'touch':
        files.set(arg(0), new Uint8Array([0x78]));
        break;
      case 'remove':
        files.delete(arg(0));
        break;
      default:
        out.push('unknown command');
    }
  }
  return out;
}
