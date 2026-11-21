// The programs and goldens of the wave 2 integration scenario (ARCHITECTURE.md 9.5). Owner: I2.
//
// Plain data and file readers only, no application code, so that check-wave2.mjs can load this
// module through its dev server (`server.ssrLoadModule`) as well as scenario.test.ts (through
// fixtures.ts, which re-exports it). Nothing is copied from reference/: the examples are the ones
// the application ships (app/public/examples), the goldens are the official program's results
// already committed under tests/conformance.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { Bytes } from '../../../app/src/contracts';
import { OFFICIAL_EXAMPLES, exampleBytes } from '../wave1/fixtures';

export { OFFICIAL_EXAMPLES, exampleBytes };

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** Every file Help > Examples... copies into the store: the ten programs and the six sounds. */
export const EXAMPLE_FILES = [
  ...OFFICIAL_EXAMPLES,
  '0.wav',
  '1.wav',
  'chime.wav',
  'roger.wav',
  'tick.wav',
  'tock.wav',
] as const;

/* ------------------------------------------------------------------------------- goldens */

/** The official EASy68K's .L68 and .S68 of a shipped example (T1, tests/conformance/asm/golden). */
export function officialOutputs(example: string): { listing: Bytes; sRecord: Bytes } {
  const dir = `${REPO}tests/conformance/asm/golden/official/${example}/`;
  return {
    listing: new Uint8Array(readFileSync(`${dir}default.L68`)),
    sRecord: new Uint8Array(readFileSync(`${dir}default.S68`)),
  };
}

/** Text as latin-1, one character per byte. */
export function latin1(bytes: Bytes): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
}

/** A listing with its `Created On:` line masked (the clock of the run; assembler Â§6, line 3). */
export const maskListing = (bytes: Bytes): string => latin1(bytes).replace(/^(Created On:)[^\r\n]*/m, '$1<date>');

/** A log with the date of its header masked (tests/conformance/sim/programs.ts, maskArtifact). */
export const maskLog = (bytes: Bytes): string =>
  latin1(bytes).replace(/^(EASy68K (?:execution|output) log file: )[^\r\n]*/, '$1<date>');

/** The log program of the simulator conformance suite whose official logs are committed (T3). */
export const LOG_PROGRAM = 'l04-print';
export function logProgramSource(): Bytes {
  return new Uint8Array(readFileSync(`${REPO}tests/conformance/sim/logs/${LOG_PROGRAM}.X68`));
}
/** The official execution log (type 2) and output log of l04-print.X68 (recipe log:2+out). */
export function officialLogs(): { exec: Bytes; output: Bytes } | null {
  const dir = `${REPO}tests/conformance/sim/golden/logs/`;
  const exec = `${dir}${LOG_PROGRAM}.log2o.RunLog.txt.gz`;
  const output = `${dir}${LOG_PROGRAM}.log2o.OutLog.txt`;
  if (!existsSync(exec) || !existsSync(output)) return null;
  return { exec: new Uint8Array(gunzipSync(readFileSync(exec))), output: new Uint8Array(readFileSync(output)) };
}

/** The original's settings files as it ships them (E4's fixtures, from the official installer). */
export function shippedSettingsFile(name: 'settings.dat' | 'sim68K.dat'): Bytes {
  const file = name === 'settings.dat' ? 'shipped-settings.dat' : 'shipped-sim68K.dat';
  return new Uint8Array(readFileSync(`${REPO}app/src/core/settings/dat-codec/fixtures/${file}`));
}

/** Duration of a PCM .wav in ms from its header (byte rate and data chunk), independent of SH5's code. */
export function wavMs(bytes: Bytes): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (id === 'data') return (Math.min(size, bytes.length - at - 8) * 1000) / byteRate;
    at += 8 + size + (size & 1);
  }
  return Number.NaN;
}

/* ---------------------------------------------------------------------- the scenario's programs */

/** Lines joined with CR LF, as a file of the original's editor. */
export const crlf = (lines: readonly string[]): string => lines.map((line) => `${line}\r\n`).join('');

/**
 * Edit, assemble, Execute: a program that prints the pen position it finds at its start, then its
 * version, and moves the pen away. A cold start (4.7.1) gives every run the pen of a fresh simulator
 * (0,0); a load into the running simulator keeps the pen where the previous run left it (123,45).
 */
export function penProgram(version: number): string[] {
  return [
    '        ORG     $1000',
    'START:  MOVEQ   #0,D1',
    '        MOVEQ   #0,D2',
    '        MOVEQ   #96,D0          pen position into D1.W, D2.W',
    '        TRAP    #15',
    '        MOVE.L  D2,D7',
    '        MOVEQ   #3,D0           X',
    '        TRAP    #15',
    "        MOVE.B  #',',D1",
    '        MOVEQ   #6,D0',
    '        TRAP    #15',
    '        MOVE.L  D7,D1',
    '        MOVEQ   #3,D0           Y',
    '        TRAP    #15',
    '        LEA     MSG,A1',
    '        MOVEQ   #13,D0',
    '        TRAP    #15',
    '        MOVE.W  #123,D1',
    '        MOVE.W  #45,D2',
    '        MOVEQ   #86,D0          move the pen away',
    '        TRAP    #15',
    '        SIMHALT',
    `MSG:    DC.B    ' version ${version}',0`,
    '        END     START',
  ];
}
/** What penProgram(version) prints after a cold start, and after a plain load over a finished run. */
export const penOutput = (version: number, cold = true): string => `${cold ? '0,0' : '123,45'} version ${version}`;

/** A program with one error in line 4 (an unknown opcode), and its correction. */
export const ERROR_PROGRAM = [
  '        ORG     $1000',
  'START:  LEA     MSG,A1',
  '        MOVEQ   #13,D0',
  '        TRAPP   #15',
  '        SIMHALT',
  "MSG:    DC.B    'corrected',0",
  '        END     START',
];
export const ERROR_LINE = 4;
export const ERROR_TEXT = 'ERROR: Invalid opcode';
export const CORRECTED_LINE = '        TRAP    #15';

/** A main program and the file it includes from the same folder of the store. */
export const INCLUDE_MAIN = [
  '        ORG     $1000',
  'START:  LEA     GREETING,A1',
  '        MOVEQ   #13,D0',
  '        TRAP    #15',
  '        SIMHALT',
  "        INCLUDE 'strings.X68'",
  '        END     START',
];
export const INCLUDE_LIB = ["GREETING: DC.B   'hello from an include file',0"];
export const INCLUDE_OUTPUT = 'hello from an include file';

/** Writes a file, closes it, and leaves it there: the bytes must reach the store. */
export const FILE_PROGRAM = [
  '        ORG     $1000',
  'START:  LEA     NAME,A1',
  '        MOVE.W  #52,D0          open new file',
  '        TRAP    #15',
  '        LEA     DATA,A1',
  '        MOVE.L  #DATAEND-DATA,D2',
  '        MOVE.W  #54,D0          write',
  '        TRAP    #15',
  '        MOVE.W  #56,D0          close',
  '        TRAP    #15',
  '        LEA     NAME,A1',
  '        MOVE.W  #51,D0          open existing file',
  '        TRAP    #15',
  '        LEA     BUFFER,A1',
  '        MOVE.L  #80,D2',
  '        MOVE.W  #53,D0          read',
  '        TRAP    #15',
  '        MOVE.W  D2,D1           the number of bytes read',
  '        MOVE.W  #56,D0          close',
  '        TRAP    #15',
  '        LEA     BUFFER,A1',
  '        MOVEQ   #0,D0           print what was read, D1.W bytes',
  '        TRAP    #15',
  '        SIMHALT',
  "NAME:   DC.B    'written.txt',0",
  "DATA:   DC.B    'bytes from a 68000 program'",
  'DATAEND:',
  'BUFFER: DS.B    80',
  '        END     START',
];
export const FILE_NAME = 'written.txt';
export const FILE_TEXT = 'bytes from a 68000 program';

/** Find and replace before assembling: Replace All changes both numbers, and so what it prints. */
export const REPLACE_PROGRAM = [
  '        ORG     $1000',
  'START:  MOVE.L  #1234,D1',
  '        MOVEQ   #3,D0',
  '        TRAP    #15',
  '        MOVE.L  #1234,D1',
  '        MOVEQ   #3,D0',
  '        TRAP    #15',
  '        SIMHALT',
  '        END     START',
];
export const REPLACE_FIND = '#1234';
export const REPLACE_WITH = '#4321';
export const REPLACE_BEFORE = '12341234';
export const REPLACE_AFTER = '43214321';
