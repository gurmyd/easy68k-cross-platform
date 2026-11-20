// easy68k-mac: helpers shared by the engine tests.
//
// The fixtures in ./fixtures are programs written for these tests.  Each has
// its source (.X68) and the assembler's output (.S68, .L68) checked in, so the
// tests need no assembler.  They were assembled with the command-line build
// of the EASy68K assembler (ASM68K v5.15.4).

import { readFileSync } from 'node:fs';
import { createSim, Option, Reg, MapKind } from '../sim68k.mjs';
import { HeadlessHost, drive } from './headless-host.mjs';

const fixtureDir = new URL('./fixtures/', import.meta.url);

/** @param {string} file name inside test/fixtures @returns {Uint8Array} */
export function fixture(file) {
  return new Uint8Array(readFileSync(new URL(file, fixtureDir)));
}

/**
 * @typedef {object} StartOptions
 * @property {boolean} [exceptions] Options > Enable Exceptions
 * @property {boolean} [bitfield]
 * @property {boolean} [listing] load the .L68 too (default true)
 * @property {number} [caseNumber] put this number in D7 (dispatcher fixtures)
 * @property {import('./headless-host.mjs').HeadlessOptions} [host]
 * @property {(sim: import('../sim68k.mjs').Sim68k, host: HeadlessHost) => void} [prepare]
 *   called after the program is loaded and before Run
 */

/**
 * Create a simulator with a headless host and load a fixture.
 * @param {string} name fixture name without extension
 * @param {StartOptions} [options]
 */
export async function start(name, options = {}) {
  const host = new HeadlessHost(options.host);
  const sim = await createSim(host);
  if (options.exceptions) sim.setOption(Option.EXCEPTIONS, 1);
  if (options.bitfield) sim.setOption(Option.BITFIELD, 1);
  sim.load(fixture(`${name}.S68`), options.listing === false ? null : fixture(`${name}.L68`), { name: `${name}.S68` });
  if (options.caseNumber !== undefined) sim.setRegister(Reg.D7, options.caseNumber);
  if (options.prepare) options.prepare(sim, host);
  return { sim, host };
}

/**
 * Load a fixture, press Run and drive it to the end.
 * @param {string} name @param {StartOptions & import('./headless-host.mjs').DriveOptions} [options]
 */
export async function run(name, options = {}) {
  const { sim, host } = await start(name, options);
  sim.cmdRun();
  const result = drive(sim, host, options);
  return { sim, host, result };
}

/** The memory-map ranges that the exc fixture expects. @param {import('../sim68k.mjs').Sim68k} sim */
export function standardMap(sim) {
  sim.setMemoryMap(MapKind.INVALID, { enabled: true, start: 0x5000, end: 0x50FF });
  sim.setMemoryMap(MapKind.READ, { enabled: true, start: 0x6000, end: 0x60FF });
  sim.setMemoryMap(MapKind.ROM, { enabled: true, start: 0x7000, end: 0x70FF });
}

/**
 * The records written by the REC macro of the instruction fixtures:
 * a status-register word followed by a long, from `base` until the first
 * record that is still all $FF.
 * @param {import('../sim68k.mjs').Sim68k} sim @param {number} [base]
 * @returns {{ccr: string, value: number}[]} ccr as five binary digits X N Z V C
 */
export function records(sim, base = 0x4000) {
  const list = [];
  for (let a = base; ; a += 6) {
    const sr = sim.readWord(a), value = sim.readLong(a + 2);
    if (sr === 0xFFFF && value === 0xFFFFFFFF) break;
    list.push({ ccr: (sr & 0x1F).toString(2).padStart(5, '0'), value });
  }
  return list;
}

/** Hexadecimal text of a number, 8 digits. @param {number} v */
export const hex = (v) => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** Message area without the lines that loading a program produces. @param {HeadlessHost} host */
export function runMessages(host) {
  return host.messages.filter((m) => !m.startsWith('S0 = ') && m !== '.S68 file read successful' && m !== 'Unable to open .L68 file.');
}
