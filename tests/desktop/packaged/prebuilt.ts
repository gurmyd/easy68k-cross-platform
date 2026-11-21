// The prebuilt programs of the packaged-app checks (ARCHITECTURE.md 6.7 checks 3 and 5): .S68 and
// .L68 files made by the real assembler engine (engine/dist) when the checks run, never committed.
//
//   tutorial1   the official example app/public/examples/tutorial1.X68 (check 3)
//   delay300    waits in a task 23 delay of 300 units and measures the delay with its own clock
//               (task 8): the elapsed hundredths of a second end up in D7 (check 5)
//
// prebuilt.setup.ts writes them into build/desktop-packaged/prebuilt/ before the checks; the checks
// copy what they need into a temporary folder of their own.
//
// Owner: DV3.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAsmEngine } from '../../../app/src/engine/index';
import { TEST_ASM_OPTIONS } from '../../../app/src/engine/testing';
import { srecordStart } from './facts';
import { OUT_DIR, REPO } from './harness';

export const PREBUILT_DIR = join(OUT_DIR, 'prebuilt');

/** check 5: a task 23 delay of 300 units (3 s, 4.4.2), timed by the program with task 8. */
export const DELAY_SOURCE = [
  '* Waits in a task 23 delay of 300 units (3 seconds) and measures it with task 8.',
  '* D7 = elapsed hundredths of a second by the time of day; D6 = the time before the delay.',
  '        ORG     $1000',
  'START:  MOVE.L  #8,D0           task 8: hundredths of a second since midnight in D1',
  '        TRAP    #15',
  '        MOVE.L  D1,D6',
  '        MOVE.L  #300,D1         300 units of 10 ms',
  '        MOVE.L  #23,D0          task 23: delay',
  '        TRAP    #15',
  '        MOVE.L  #8,D0',
  '        TRAP    #15',
  '        SUB.L   D6,D1',
  '        MOVE.L  D1,D7',
  '        SIMHALT',
  '        END     START',
];

export interface PrebuiltProgram {
  /** The base name: <name>.S68 and <name>.L68 are in PREBUILT_DIR. */
  name: string;
  /** The start address (the S-record file's termination record). */
  start: number;
}

export type PrebuiltManifest = Record<'tutorial1' | 'delay300', PrebuiltProgram>;

const MANIFEST = join(PREBUILT_DIR, 'manifest.json');

/** True when engine/dist has both engines; EASY68K_REQUIRE_ENGINES=1 makes a missing one an error. */
export function enginesAvailable(): boolean {
  const dist = join(REPO, 'engine', 'dist');
  const present = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
    existsSync(join(dist, file)),
  );
  if (!present && process.env.EASY68K_REQUIRE_ENGINES === '1') {
    throw new Error('engine/dist is missing, and EASY68K_REQUIRE_ENGINES=1 requires the engines');
  }
  return present;
}

/** Assembles one program with the real assembler and writes <name>.X68, .S68 and .L68. */
async function assemble(name: string, source: Uint8Array): Promise<PrebuiltProgram> {
  const asm = await createAsmEngine();
  const main = `${name}.X68`;
  const result = await asm.assemble(main, new Map([[main, source]]), TEST_ASM_OPTIONS, new Date());
  if (result.fatal !== null) throw new Error(`${main}: ${result.fatal}`);
  if (result.errorCount > 0 || !result.sRecord || !result.listing) {
    const messages = result.messages.map((message) => `line ${message.line}: ${message.text}`).join('\n');
    throw new Error(`${main}: ${result.errorCount} error(s)\n${messages}`);
  }
  writeFileSync(join(PREBUILT_DIR, main), source);
  writeFileSync(join(PREBUILT_DIR, `${name}.S68`), result.sRecord);
  writeFileSync(join(PREBUILT_DIR, `${name}.L68`), result.listing);
  const start = srecordStart(Buffer.from(result.sRecord).toString('latin1'));
  if (start === null) throw new Error(`${name}.S68 has no termination record`);
  return { name, start };
}

/** Makes every prebuilt program and the manifest. */
export async function makePrebuilt(): Promise<PrebuiltManifest> {
  mkdirSync(PREBUILT_DIR, { recursive: true });
  const tutorial = new Uint8Array(readFileSync(join(REPO, 'app', 'public', 'examples', 'tutorial1.X68')));
  const delay = Uint8Array.from(DELAY_SOURCE.map((line) => `${line}\r\n`).join(''), (c) => c.charCodeAt(0));
  const manifest: PrebuiltManifest = {
    tutorial1: await assemble('tutorial1', tutorial),
    delay300: await assemble('delay300', delay),
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** The manifest prebuilt.setup.ts wrote. */
export function prebuiltManifest(): PrebuiltManifest {
  if (!existsSync(MANIFEST)) {
    throw new Error(`${MANIFEST} is missing: the project "prebuilt" (prebuilt.setup.ts) makes it`);
  }
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as PrebuiltManifest;
}

/** Copies a program's .S68 and .L68 into a new temporary folder; returns the path of the .S68. */
export function programInFreshFolder(program: PrebuiltProgram): string {
  const folder = mkdtempSync(join(tmpdir(), `easy68k-${program.name}-`));
  for (const extension of ['S68', 'L68']) {
    copyFileSync(join(PREBUILT_DIR, `${program.name}.${extension}`), join(folder, `${program.name}.${extension}`));
  }
  return join(folder, `${program.name}.S68`);
}
