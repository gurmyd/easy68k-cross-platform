// Programs and helpers of the wave 1 integration scenario (ARCHITECTURE.md 9.3). Owner: I1.
//
// Two users:
//   - scenario.test.ts runs the scenario under Node (Vitest) on the headless session of 6.4: the real
//     engine, the real run controller and the real host parts, with virtual time;
//   - check-wave1.mjs loads this module through its dev server (`server.ssrLoadModule`) to assemble
//     the programs it uploads into the page, and to learn what each program does without a user
//     interface, so that it can compare the page with it.
//
// Every .S68 and .L68 is made here with the real assembler (engine/dist) from the official examples
// the application ships (app/public/examples) or from the small programs below. Nothing is copied
// from reference/.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Reg, type Bytes } from '../../../app/src/contracts';
import { VIRTUAL_FRAME_MS } from '../../../app/src/core/run/clock';
import { createHeadlessSession, type HeadlessSession } from '../../../app/src/core/run/headless';
import { createAsmEngine, createSimEngine, releaseSimEngine } from '../../../app/src/engine';
import { TEST_ASM_OPTIONS, TEST_ASM_TIME, bytesOf } from '../../../app/src/engine/testing';
import { mirrorRows } from '../../../app/src/features/output/mirror';
import { MemoryBackend } from '../../../app/src/fs/memory-backend';
import { MemorySyncFiles } from '../../../app/src/fs/sync/memory';
import { createVfs } from '../../../app/src/fs/vfs';

/** The ten official example programs the application ships (Help > Examples...). */
export const OFFICIAL_EXAMPLES = [
  'tutorial1.X68',
  'tutorial2.X68',
  'tutorial3.X68',
  'tutorial4.X68',
  'MACRO.X68',
  'fileio.X68',
  'clockDigital.X68',
  'clockWithSound.X68',
  'graphicSound.X68',
  'mouseWindowSize.X68',
] as const;

/** What tutorial1.X68 prints: 3 + 5, 512 + 8 and 67500 + 520, then `Program End`. */
export const TUTORIAL1_OUTPUT = ['D1 contains: 8', 'D2 contains: 520', 'D3 contains: 68020', 'Program End'];

const EXAMPLES_DIR = fileURLToPath(new URL('../../../app/public/examples/', import.meta.url));
const CORPUS_DIR = fileURLToPath(new URL('../../corpus/official/', import.meta.url));

/** The bytes of a shipped example file (app/public/examples). */
export function exampleBytes(name: string): Bytes {
  return new Uint8Array(readFileSync(`${EXAMPLES_DIR}${name}`));
}

/** The bytes of the same file in the test corpus (tests/corpus/official). */
export function corpusBytes(name: string): Bytes {
  return new Uint8Array(readFileSync(`${CORPUS_DIR}${name}`));
}

/** Programs of the scenario that no official example covers. Lines without line ends. */
export const OWN_SOURCES = {
  // A task 2 prompt: asks for a name, reads a line, greets.
  prompt: [
    '        ORG     $1000',
    'START:  LEA     ASK,A1',
    '        MOVEQ   #14,D0          text at (A1), no new line',
    '        TRAP    #15',
    '        LEA     BUFFER,A1',
    '        MOVEQ   #2,D0           read a line into (A1), its length into D1.W',
    '        TRAP    #15',
    '        MOVE.W  D1,D7',
    '        LEA     HELLO,A1',
    '        MOVEQ   #14,D0',
    '        TRAP    #15',
    '        LEA     BUFFER,A1',
    '        MOVEQ   #13,D0          text at (A1) with a new line',
    '        TRAP    #15',
    '        SIMHALT',
    "ASK:    DC.B    'What is your name? ',0",
    "HELLO:  DC.B    'Hello, ',0",
    'BUFFER: DS.B    82',
    '        END     START',
  ],
  // Waits for one key (task 5), then shows it again (task 6).
  keywait: [
    '        ORG     $1000',
    'START:  LEA     ASK,A1',
    '        MOVEQ   #14,D0',
    '        TRAP    #15',
    '        MOVEQ   #5,D0           one character into D1.B',
    '        TRAP    #15',
    '        MOVE.B  D1,D6',
    '        LEA     GOT,A1',
    '        MOVEQ   #14,D0',
    '        TRAP    #15',
    '        MOVE.B  D6,D1',
    '        MOVEQ   #6,D0           the character in D1.B',
    '        TRAP    #15',
    '        SIMHALT',
    "ASK:    DC.B    'Press a key: ',0",
    "GOT:    DC.B    ' - you pressed ',0",
    '        END     START',
  ],
  // Draws: a red filled rectangle with a green outline, a blue line, one white pixel.
  draw: [
    '        ORG     $1000',
    'START:  MOVE.L  #$0000FF00,D1   pen green ($00BBGGRR)',
    '        MOVEQ   #80,D0',
    '        TRAP    #15',
    '        MOVE.L  #$000000FF,D1   fill red',
    '        MOVEQ   #81,D0',
    '        TRAP    #15',
    '        MOVE.W  #40,D1          left',
    '        MOVE.W  #30,D2          top',
    '        MOVE.W  #200,D3         right',
    '        MOVE.W  #120,D4         bottom',
    '        MOVEQ   #87,D0          filled rectangle',
    '        TRAP    #15',
    '        MOVE.L  #$00FF0000,D1   pen blue',
    '        MOVEQ   #80,D0',
    '        TRAP    #15',
    '        MOVE.W  #300,D1',
    '        MOVE.W  #200,D2',
    '        MOVE.W  #500,D3',
    '        MOVE.W  #200,D4',
    '        MOVEQ   #84,D0          line',
    '        TRAP    #15',
    '        MOVE.L  #$00FFFFFF,D1   pen white',
    '        MOVEQ   #80,D0',
    '        TRAP    #15',
    '        MOVE.W  #320,D1',
    '        MOVE.W  #400,D2',
    '        MOVEQ   #82,D0          one pixel',
    '        TRAP    #15',
    '        SIMHALT',
    '        END     START',
  ],
  // Counts for ever through a subroutine: something to pause, step and trace, with a stack.
  counter: [
    '        ORG     $1000',
    'START:  MOVEQ   #0,D0',
    'LOOP:   ADDQ.L  #1,D0',
    '        BSR     SUB',
    '        MOVE.L  D0,COUNT',
    '        BRA     LOOP',
    'SUB:    MOVE.L  D0,D1',
    '        RTS',
    'COUNT:  DS.L    1',
    '        END     START',
  ],
  // Hardware: shows "12" on the display, then copies the toggle switches to the LEDs for ever.
  hardware: [
    '        ORG     $1000',
    'START:  MOVE.B  #$06,$E00000    leftmost digit: segments b and c',
    '        MOVE.B  #$5B,$E00002    second digit: a b d e g',
    'LOOP:   MOVE.B  $E00012,D0      the toggle switches',
    '        MOVE.B  D0,$E00010      to the LEDs',
    '        BRA     LOOP',
    '        END     START',
  ],
} as const;
export type OwnProgram = keyof typeof OWN_SOURCES;

export interface Assembled {
  /** The name of the source file, e.g. `tutorial1.X68`. */
  source: string;
  /** The file names of the two outputs, e.g. `tutorial1.S68`. */
  s68Name: string;
  l68Name: string;
  s68: Bytes;
  l68: Bytes;
  warnings: number;
}

/** Assembles `source` under its own name with the options of a fresh installation. Throws on errors. */
export async function assemble(name: string, source: Bytes): Promise<Assembled> {
  const asm = await createAsmEngine();
  const result = await asm.assemble(name, new Map([[name, source]]), TEST_ASM_OPTIONS, TEST_ASM_TIME);
  if (result.fatal !== null) throw new Error(`${name}: ${result.fatal}`);
  if (result.errorCount > 0 || !result.sRecord || !result.listing) {
    const messages = result.messages.map((message) => `line ${message.line}: ${message.text}`).join('; ');
    throw new Error(`${name} does not assemble: ${result.errorCount} error(s): ${messages}`);
  }
  const stem = name.replace(/\.[^.]*$/, '');
  return {
    source: name,
    s68Name: `${stem}.S68`,
    l68Name: `${stem}.L68`,
    s68: result.sRecord,
    l68: result.listing,
    warnings: result.warningCount,
  };
}

export const assembleExample = (name: string): Promise<Assembled> => assemble(name, exampleBytes(name));

export function assembleOwn(name: OwnProgram): Promise<Assembled> {
  const text = OWN_SOURCES[name].map((line) => `${line}\r\n`).join('');
  return assemble(`${name}.X68`, bytesOf(text));
}

/** The folder of the programs in the headless session's file system. */
export const HEADLESS_DIR = '/memory/wave1';

/** A headless session (6.4) with the program in its file system, not yet loaded. */
export async function headlessWith(program: Assembled, extraFiles: Record<string, Bytes> = {}) {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend());
  await vfs.writeFile(`${HEADLESS_DIR}/${program.s68Name}`, program.s68);
  await vfs.writeFile(`${HEADLESS_DIR}/${program.l68Name}`, program.l68);
  for (const [name, data] of Object.entries(extraFiles)) await vfs.writeFile(`${HEADLESS_DIR}/${name}`, data);
  const session = await createHeadlessSession({
    engines: { create: createSimEngine, release: releaseSimEngine },
    vfs,
    viewFor: () => new MemorySyncFiles(),
  });
  return { session, vfs, path: `${HEADLESS_DIR}/${program.s68Name}` };
}

/** The text of the Output panel: the rows of the text screen up to the last one that is not empty. */
export function screenText(session: Pick<HeadlessSession, 'text'>): string[] {
  const rows = mirrorRows(session.text.state).map((row) => row.replace(/\s+$/, ''));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

export interface RegisterValues {
  d: number[];
  a: number[];
  pc: number;
  sr: number;
}

export function registersOf(session: Pick<HeadlessSession, 'engine'>): RegisterValues {
  const { engine } = session;
  const data = [Reg.D0, Reg.D1, Reg.D2, Reg.D3, Reg.D4, Reg.D5, Reg.D6, Reg.D7];
  const address = [Reg.A0, Reg.A1, Reg.A2, Reg.A3, Reg.A4, Reg.A5, Reg.A6, Reg.A7];
  return {
    d: data.map((reg) => engine.getRegister(reg) >>> 0),
    a: address.map((reg) => engine.getRegister(reg) >>> 0),
    pc: engine.getRegister(Reg.PC) >>> 0,
    sr: engine.getRegister(Reg.SR) & 0xffff,
  };
}

/**
 * Advances virtual time frame by frame until `done()` or until `limitMs` have passed. Message boxes
 * of the engine are answered with OK, as a student would. True when `done()` became true.
 */
export function advanceUntil(session: HeadlessSession, done: () => boolean, limitMs = 10_000): boolean {
  for (let elapsed = 0; ; elapsed += VIRTUAL_FRAME_MS) {
    if (session.controller.alerts.length > 0) session.controller.dismissAlerts();
    if (done()) return true;
    if (elapsed >= limitMs) return false;
    session.time.advance(VIRTUAL_FRAME_MS);
  }
}

/** Types text into the Output panel's keyboard, as key presses; `\n` is the Enter key. */
export function typeText(session: HeadlessSession, text: string): void {
  const plain = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false };
  for (const ch of text) {
    const key = ch === '\n' ? 'Enter' : ch;
    const code = ch === '\n' ? 'Enter' : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : ch === ' ' ? 'Space' : '';
    const event = { key, code, ...plain, shiftKey: /[A-Z]/.test(ch) };
    session.keyboard.keydown(event, false);
    session.time.advance(VIRTUAL_FRAME_MS);
    session.keyboard.keyup(event);
    session.time.advance(VIRTUAL_FRAME_MS);
  }
}

export interface HeadlessOutcome {
  /** How the run ended within the time given. */
  end: 'halted' | 'stopped' | 'waiting for input' | 'still running' | 'waiting';
  phase: string;
  text: string[];
  registers: RegisterValues;
  messages: string[];
  /** Failures the session reported (they go to the console in the application). */
  reports: string[];
  /** Message boxes of the engine that were answered with OK on the way. */
  alerts: string[];
}

/**
 * Loads the program into a headless session, presses Run and lets `seconds` of virtual time pass
 * at most. At each keyboard wait the next entry of `typed` is typed; with none left the run ends
 * as 'waiting for input'.
 */
export async function runHeadless(
  program: Assembled,
  options: { typed?: string[]; seconds?: number; extraFiles?: Record<string, Bytes> } = {},
): Promise<HeadlessOutcome> {
  const { session, path } = await headlessWith(program, options.extraFiles);
  const alerts: string[] = [];
  try {
    const { controller } = session;
    await controller.open(path, 'open');
    controller.run();
    const typed = [...(options.typed ?? [])];
    const limit = (options.seconds ?? 5) * 1000;
    let end: HeadlessOutcome['end'] = 'still running';
    for (let elapsed = 0; elapsed < limit; elapsed += VIRTUAL_FRAME_MS) {
      for (const alert of controller.alerts) alerts.push(`${alert.title}: ${alert.text}`);
      if (controller.alerts.length > 0) controller.dismissAlerts();
      if (controller.phase === 'idle') {
        end = controller.snapshot.halted ? 'halted' : 'stopped';
        break;
      }
      if (controller.phase === 'waitInput') {
        const next = typed.shift();
        if (next === undefined) {
          end = 'waiting for input';
          break;
        }
        typeText(session, next);
        continue;
      }
      session.time.advance(VIRTUAL_FRAME_MS);
    }
    if (end === 'still running' && controller.phase !== 'running') end = 'waiting';
    return {
      end,
      phase: controller.phase,
      text: screenText(session),
      registers: registersOf(session),
      messages: [...session.messages()],
      reports: session.reports.map((report) => `${report.what}: ${String(report.error)}`),
      alerts,
    };
  } finally {
    session.dispose();
  }
}
