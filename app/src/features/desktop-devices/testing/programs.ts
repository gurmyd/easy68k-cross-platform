// 68000 test programs for the serial and network tasks (TRAP #15 tasks 40-43, 100-107), built
// from a list of steps. Used by the unit tests next to the devices, by the browser check of this
// feature (check-desktop-devices.mjs) and by the desktop tests (tests/desktop/dev/dv4-*.spec.ts),
// which import this file into the page by path. No imports: it must load anywhere.
//
// Every program keeps what a test reads back at fixed addresses:
//   DONE      long, the number of runs since the load once a run has reached its end (1 after
//             the first; Rewind keeps memory, so a second run after Rewind gives 2)
//   RUNS      long, the number of runs started since the load
//   RESULTS   one slot of 8 bytes per saved step: D0.L, then D1.L after the TRAP
//   BUFFER    512 bytes for received data (zero at load)
//   SENDER    32 bytes for a sender's address (task 103, 107; zero at load)
//   STRINGS   the strings of the program, at their own labels
//
// Owner: DV4.

export const DONE = 0x2ff0;
export const RUNS = 0x2ff4;
export const RESULTS = 0x3000;
export const BUFFER = 0x4000;
export const SENDER = 0x4400;
export const SLOT_BYTES = 8;

/** Registers of one TRAP #15 call. `a1`, `a2` name labels: a string of `strings`, `BUFFER` or
 *  `SENDER` (both defined by every program). */
export interface Call {
  task: number;
  /** D0 bits 31..16 (the CID of tasks 40-43). */
  d0High?: number;
  d1?: number;
  a1?: string;
  a2?: string;
}

export type Step =
  /** One call; with `save`, D0 and D1 after it go to that slot. */
  | ({ kind: 'call'; save?: string } & Call)
  /**
   * The call again and again until D0 is not 0 or D1.W is not 0 (a receive that got something or
   * failed), at most `tries` times, with a task 23 delay of `delay` hundredths between tries.
   * `count` saves how many calls were made (D1 of its slot) when given.
   */
  | ({ kind: 'poll'; save: string; tries: number; delay?: number; count?: string } & Call)
  /** Task 42 on `cid` until `want` bytes have been read into BUFFER (each read appends), or a
   *  result other than 0 or 4, at most `tries` times with `delay`. The slot gets the last D0 and
   *  the number of bytes read. */
  | { kind: 'readSerial'; save: string; cid: number; want: number; tries: number; delay?: number }
  /** A task 23 delay of `hundredths`. */
  | { kind: 'delay'; hundredths: number }
  /** D1 := the D1 that slot `from` recorded (answer with the port and count task 107 returned). */
  | { kind: 'd1From'; from: string };

export interface ProgramSpec {
  steps: Step[];
  /** label -> text (stored NUL-terminated). */
  strings?: Record<string, string>;
}

export interface BuiltProgram {
  source: string[];
  /** slot name -> address of its D0; D1 follows at +4. */
  slots: Record<string, number>;
}

const hex = (value: number) => `$${(value >>> 0).toString(16).toUpperCase()}`;

/** A DC.B line for a text: printable ASCII in quotes, everything else as numbers. */
function dcb(label: string, text: string): string {
  const parts: string[] = [];
  let run = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f && ch !== "'") run += ch;
    else {
      if (run) parts.push(`'${run}'`);
      run = '';
      parts.push(String(code & 0xff));
    }
  }
  if (run) parts.push(`'${run}'`);
  parts.push('0');
  return `${label}:${' '.repeat(Math.max(1, 8 - label.length - 1))}DC.B    ${parts.join(',')}`;
}

export function buildProgram(spec: ProgramSpec): BuiltProgram {
  const slots: Record<string, number> = {};
  const slotOf = (name: string) => {
    if (!(name in slots)) slots[name] = RESULTS + SLOT_BYTES * Object.keys(slots).length;
    return slots[name] as number;
  };
  // RUNS counts the starts since the load (Rewind keeps memory, Reload loads it again); DONE gets
  // the count at the end, so a test sees each run finish.
  const lines: string[] = ['        ORG     $1000', 'START:', `        ADDQ.L  #1,${hex(RUNS)}`];
  const emit = (line: string) => lines.push(`        ${line}`);
  let label = 0;

  const setUp = (call: Call) => {
    if (call.d1 !== undefined) emit(`MOVE.L  #${hex(call.d1)},D1`);
    if (call.a1) emit(`LEA     ${call.a1},A1`);
    if (call.a2) emit(`LEA     ${call.a2},A2`);
    emit(`MOVE.L  #${hex(((call.d0High ?? 0) << 16) | call.task)},D0`);
    emit('TRAP    #15');
  };
  const save = (name: string) => {
    const at = slotOf(name);
    emit(`MOVE.L  D0,${hex(at)}`);
    emit(`MOVE.L  D1,${hex(at + 4)}`);
  };
  const delay = (hundredths: number) => {
    emit(`MOVE.L  #${hundredths},D1`);
    emit('MOVE.L  #23,D0');
    emit('TRAP    #15');
  };

  for (const step of spec.steps) {
    if (step.kind === 'call') {
      setUp(step);
      if (step.save) save(step.save);
    } else if (step.kind === 'poll') {
      const loop = `P${label++}`;
      const done = `${loop}D`;
      emit(`MOVE.L  #${step.tries},D7`);
      emit('MOVEQ   #0,D6');
      lines.push(`${loop}:`);
      emit('ADDQ.L  #1,D6');
      setUp(step);
      save(step.save);
      emit('TST.L   D0');
      emit(`BNE     ${done}`);
      emit('TST.W   D1');
      emit(`BNE     ${done}`);
      if (step.delay) delay(step.delay);
      emit('SUBQ.L  #1,D7');
      emit(`BNE     ${loop}`);
      lines.push(`${done}:`);
      if (step.count) emit(`MOVE.L  D6,${hex(slotOf(step.count) + 4)}`);
    } else if (step.kind === 'readSerial') {
      const loop = `R${label++}`;
      const done = `${loop}D`;
      const next = `${loop}N`;
      const at = slotOf(step.save);
      emit(`MOVE.L  #${step.tries},D7`);
      emit('MOVEQ   #0,D6');
      lines.push(`${loop}:`);
      emit(`LEA     ${hex(BUFFER)},A1`);
      emit('ADDA.L  D6,A1');
      emit(`MOVE.L  #${step.want},D1`);
      emit('SUB.L   D6,D1');
      emit(`MOVE.L  #${hex((step.cid << 16) | 42)},D0`);
      emit('TRAP    #15');
      emit(`MOVE.L  D0,${hex(at)}`);
      emit('MOVE.W  D0,D5');
      emit(`BEQ     ${next}`);
      emit('CMP.W   #4,D5');
      emit(`BNE     ${done}`);
      lines.push(`${next}:`);
      emit('MOVEQ   #0,D5');
      emit('MOVE.B  D1,D5');
      emit('ADD.L   D5,D6');
      emit(`CMP.L   #${step.want},D6`);
      emit(`BEQ     ${done}`);
      if (step.delay) delay(step.delay);
      emit('SUBQ.L  #1,D7');
      emit(`BNE     ${loop}`);
      lines.push(`${done}:`);
      emit(`MOVE.L  D6,${hex(at + 4)}`);
    } else if (step.kind === 'd1From') {
      emit(`MOVE.L  ${hex(slotOf(step.from) + 4)},D1`);
    } else {
      delay(step.hundredths);
    }
  }
  emit(`MOVE.L  ${hex(RUNS)},${hex(DONE)}`);
  emit('SIMHALT');

  lines.push(`        ORG     ${hex(DONE)}`);
  lines.push('        DC.L    0,0');
  const slotCount = Math.max(1, Object.keys(slots).length);
  lines.push(`        ORG     ${hex(RESULTS)}`);
  lines.push(`        DCB.L   ${slotCount * 2},0`);
  lines.push(`        ORG     ${hex(BUFFER)}`);
  lines.push('BUFFER: DCB.B   512,0');
  lines.push(`        ORG     ${hex(SENDER)}`);
  lines.push('SENDER: DCB.B   32,0');
  lines.push('        ORG     $5000');
  for (const [name, text] of Object.entries(spec.strings ?? {})) {
    lines.push(dcb(name, text));
    lines.push('        DS.W    0');
  }
  lines.push('        END     START');
  return { source: lines, slots };
}

/** D1 of tasks 100 and 101: the port in the high word, the protocol (0 UDP, 1 TCP) in the low byte. */
export function netSettings(port: number, protocol: 0 | 1 | number): number {
  return ((port & 0xffff) << 16) | (protocol & 0xff);
}

/** The values of note 37 of ARCHITECTURE.md 1.4 (a browser: no serial ports, no network), as the
 *  program built by noteThirtySevenProgram() records them. */
export const NOTE_37 = {
  initComm: 2,
  setCommParams: 3,
  readComm: 3,
  sendComm: 3,
  createClient: 0x276b0002,
  createServer: 0x276b0002,
  send: 0x276d0001,
  receive: 0,
  sendPort: 0x276d0001,
  receivePort: 0,
  close: 0x276d0001,
  localIp: 0x276d0001,
} as const;

/** Every serial and network task once, as a program in a browser runs them (note 37). */
export function noteThirtySevenProgram(): BuiltProgram {
  return buildProgram({
    strings: { PORT: 'COM1', HOST: '127.0.0.1', DATA: 'HELLO' },
    steps: [
      { kind: 'call', task: 40, a1: 'PORT', save: 'initComm' },
      { kind: 'call', task: 41, d1: 0, save: 'setCommParams' },
      { kind: 'call', task: 42, d1: 4, a1: 'BUFFER', save: 'readComm' },
      { kind: 'call', task: 43, d1: 5, a1: 'DATA', save: 'sendComm' },
      { kind: 'call', task: 100, d1: netSettings(4000, 0), a2: 'HOST', save: 'createClient' },
      { kind: 'call', task: 101, d1: netSettings(4000, 0), save: 'createServer' },
      { kind: 'call', task: 102, d1: 5, a1: 'DATA', a2: 'HOST', save: 'send' },
      { kind: 'call', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receive' },
      { kind: 'call', task: 106, d1: netSettings(4000, 5), a1: 'DATA', a2: 'HOST', save: 'sendPort' },
      { kind: 'call', task: 107, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receivePort' },
      { kind: 'call', task: 104, save: 'close' },
      { kind: 'call', task: 105, a2: 'SENDER', save: 'localIp' },
    ],
  });
}
