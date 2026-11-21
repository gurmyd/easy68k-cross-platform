// S-record files written by the real assembler engine, loaded and saved back by the EASyBIN model,
// against the results of the original's own code (docs/porting/easybin.md 0.4, 20.1, 20.2). Owner: B1.
//
// The four programs below are this package's own. Their .S68 files, as the engine writes them, are
// kept in fixtures/ (asm-*.S68). This test assembles the programs again with the real engine and
// checks that the stored files are what the engine writes (needs engine/dist; with
// EASY68K_WRITE_EASYBIN_FIXTURES=1 it writes them). oracle.test.ts runs fixtures/assembler.script on
// the model and compares the transcript with the one the original's code printed.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const fixture = (file: string) => fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url));
const asmBuilt = existsSync(repo('engine/dist/asm68k.wasm')) && existsSync(repo('engine/dist/asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';
const writeFixtures = process.env.EASY68K_WRITE_EASYBIN_FIXTURES === '1';

/** name -> source lines. */
const PROGRAMS: Record<string, string[]> = {
  'asm-hello': [
    '* EASyBIN fixture: a small program with text that has bytes above $7F',
    '        ORG     $1000',
    'START:  LEA     MSG,A1',
    '        MOVE.B  #14,D0',
    '        TRAP    #15',
    '        SIMHALT',
    "MSG     DC.B    'Hello, EASyBIN',$E9,$FC,$7F,$1F,0",
    '        END     START',
  ],
  'asm-sections': [
    '* EASyBIN fixture: S1 and S2 records, data across $10000, an odd start',
    '        ORG     $FFE0',
    'DATA1   DCB.B   80,$A5',
    '        ORG     $123455',
    'DATA2   DC.B    $DE,$AD,$BE,$EF,$01,$23,$45,$67,$89',
    '        ORG     $2004',
    'START   MOVEQ   #1,D0',
    '        SIMHALT',
    '        END     START',
  ],
  'asm-memory': [
    '* EASyBIN fixture: memory-map S0 records and a long block',
    '        MEMORY  ROM     $004000,$004FFF',
    '        MEMORY  INVALID $00F000,$00F0FF',
    '        ORG     $3000',
    'START   MOVE.L  #$12345678,D1',
    '        SIMHALT',
    'TABLE   DCB.W   300,$5A5A',
    '        END     START',
  ],
  'asm-top': [
    '* EASyBIN fixture: data at the top of memory',
    '        ORG     $FFFFE0',
    'TOP     DC.L    1,2,3,4,5,6,7,8',
    '        END     TOP',
  ],
};

describe('assembler S-records', () => {
  it.runIf(enginesRequired && !asmBuilt)('engine/dist holds the assembler (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist/asm68k.wasm or asm68k-loader.mjs is missing.');
  });

  it.skipIf(!asmBuilt)(
    'the stored .S68 fixtures are what the real assembler writes (needs engine/dist)',
    async () => {
      const { assembleProgram } = await import('../../engine/testing');
      for (const [name, lines] of Object.entries(PROGRAMS)) {
        const { s68 } = await assembleProgram(lines);
        const path = fixture(`${name}.S68`);
        if (writeFixtures) writeFileSync(path, s68);
        expect(Buffer.from(readFileSync(path)).equals(Buffer.from(s68)), name).toBe(true);
      }
    },
    60_000,
  );
});
