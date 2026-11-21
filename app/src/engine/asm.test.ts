// The assembler binding against the real engine (W4 acceptance, 9.1):
// - the mirror tests of 3.2 for engine/asm/asm68k.mjs;
// - smoke.X68 assembles to the native oracle's .S68 byte for byte, and to its .L68 except for the
//   two header lines that name the assembler and the time;
// - the three statements of 3.2 about the module;
// - a `fatal` result is returned, not thrown, also when no instance can be created.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabType, type AsmResult, type Bytes } from '../contracts';
import { createAsmEngine } from './index';
import { fatalResult } from './asm';
import { engineLoadInfo } from './loader';
import { bytesOf, TEST_ASM_OPTIONS, TEST_ASM_TIME, textOf } from './testing';

const repo = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
const asmBuilt = existsSync(repo('engine/dist/asm68k.wasm')) && existsSync(repo('engine/dist/asm68k-loader.mjs'));

/** Suites that load and compile the engines: on a loaded machine they need more than Vitest's 5 s. */
const ENGINE_TIME = { timeout: 60_000 };

/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !asmBuilt)(
  'engine/dist holds the assembler (EASY68K_REQUIRE_ENGINES=1)',
  () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run "npm run build:engines" or "npm run fetch:engines"',
    );
  },
);
const sorted = (values: Iterable<string>) => [...values].sort();

type AsmModule = Record<string, unknown>;
const loadAsmModule = () =>
  import(/* @vite-ignore */ new URL('../../../engine/asm/asm68k.mjs', import.meta.url).href) as Promise<AsmModule>;

/** Source lines as the editor buffer the engine expects: CR LF after every line. */
const source = (...lines: string[]): Bytes => bytesOf(lines.map((line) => `${line}\r\n`).join(''));
const listingLines = (result: AsmResult): string[] => textOf(result.listing ?? []).split('\r\n');

/** Assembles `files[main]` with the default options of a fresh installation. */
async function assemble(main: string, files: Record<string, Bytes>, options = TEST_ASM_OPTIONS): Promise<AsmResult> {
  const asm = await createAsmEngine();
  return asm.assemble(main, new Map(Object.entries(files)), options, TEST_ASM_TIME);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- mirror -------------------------------------------------------------------------------------

describe('mirror of engine/asm/asm68k.mjs (3.2)', ENGINE_TIME, () => {
  it('AsmOptions has exactly the keys of DEFAULT_OPTIONS', async () => {
    const { DEFAULT_OPTIONS } = (await loadAsmModule()) as { DEFAULT_OPTIONS: Record<string, unknown> };
    // TEST_ASM_OPTIONS is declared as AsmOptions, so it has every key of the interface and no other.
    expect(sorted(Object.keys(TEST_ASM_OPTIONS))).toEqual(sorted(Object.keys(DEFAULT_OPTIONS)));
  });

  it('TEST_ASM_OPTIONS are the defaults of the module (a fresh EASy68K installation)', async () => {
    const { DEFAULT_OPTIONS } = (await loadAsmModule()) as { DEFAULT_OPTIONS: Record<string, unknown> };
    expect(TEST_ASM_OPTIONS).toEqual({ ...DEFAULT_OPTIONS, tabType: TabType.Fixed }); // the module spells it 'fixed'
  });

  it.skipIf(!asmBuilt)('AsmResult has exactly the keys of a real result (needs engine/dist)', async () => {
    const result = await assemble('t.X68', { 't.X68': source('START NOP', '      END START') });
    // fatalResult() returns an object literal declared as AsmResult: every key of the interface.
    const ours = fatalResult({ changeFileExt: (name) => name }, 't.X68', 'x');
    expect(sorted(Object.keys(result))).toEqual(sorted(Object.keys(ours)));
    expect(result).toMatchObject({ errorCount: 0, warningCount: 0, executeEnabled: true, status: 0, fatal: null });
    expect(result.listingName).toBe('t.L68');
    expect(result.sRecordName).toBe('t.S68');
    expect(result.listing).toBeInstanceOf(Uint8Array);
    expect(result.sRecord).toBeInstanceOf(Uint8Array);
  });

  it.skipIf(!asmBuilt)('a message has the fields of AsmMessage (needs engine/dist)', async () => {
    const result = await assemble('t.X68', { 't.X68': source('START NOP', '      BOGUS', '      END START') });
    expect(result.messages).toEqual([
      { line: 2, severity: 'error', code: 0x402, text: 'ERROR: Invalid opcode', file: null, resolvedFile: null },
    ]);
    expect(result).toMatchObject({ errorCount: 1, executeEnabled: false });
  });
});

// ---- the oracle ---------------------------------------------------------------------------------

describe.skipIf(!asmBuilt)('createAsmEngine with the real engine (needs engine/dist)', ENGINE_TIME, () => {
  describe('smoke.X68 against the native oracle (asy68k.exe, toolchain §4, §5)', () => {
    // The oracle's outputs for tests/oracle/asm-cli/smoke-test/smoke.X68, embedded at the end of this
    // file. The command-line oracle expands tabs as "Assembly" tabs (assembler §9.4.4).
    const smoke = new Uint8Array(readFileSync(repo('tests/oracle/asm-cli/smoke-test/smoke.X68')));
    const run = () =>
      createAsmEngine().then((asm) =>
        asm.assemble(
          'smoke.X68',
          new Map([['smoke.X68', smoke]]),
          { ...TEST_ASM_OPTIONS, tabType: TabType.Assembly },
          new Date(2026, 10, 20, 19, 9, 32),
        ),
      );

    it('the .S68 is the oracle byte for byte', async () => {
      const result = await run();
      expect(result).toMatchObject({ errorCount: 0, warningCount: 0, fatal: null });
      expect(textOf(result.sRecord ?? [])).toBe(ORACLE_S68.map((line) => `${line}\r\n`).join(''));
      expect(result.sRecord?.length).toBe(706);
    });

    it('the .L68 is the oracle except for line 2 (assembler name) and line 3 (time)', async () => {
      const lines = listingLines(await run());
      expect(lines.length).toBe(ORACLE_L68.length + 1); // the last line ends in CR LF as well
      expect(lines.at(-1)).toBe('');
      const masked = (all: readonly string[]) => all.map((line, index) => (index === 1 || index === 2 ? '' : line));
      expect(masked(lines.slice(0, -1))).toEqual(masked(ORACLE_L68));
      // Line 2 is where a 5.16.1 listing must differ from the oracle, which is version 5.15.4.
      expect(ORACLE_L68[1]).toBe('Assembler used: ASy68K Assembler v5.15.04');
      expect(lines[1]).toBe('Assembler used: EASy68K Editor/Assembler v5.16.01');
      // Line 3: the engine formats the given time as the original does; here it is the oracle's.
      expect(lines[2]).toBe(ORACLE_L68[2]);
    });
  });

  // ---- the three statements of 3.2 ----------------------------------------------------------------

  describe('statement 1: Windows text mode is emulated inside; the application passes raw bytes', () => {
    const program = ['START   MOVEQ   #1,D0', '        SIMHALT', '        END     START'];

    it('output has CR LF line ends whatever the input has', async () => {
      const crlf = await assemble('p.X68', { 'p.X68': bytesOf(program.join('\r\n') + '\r\n') });
      const lf = await assemble('p.X68', { 'p.X68': bytesOf(program.join('\n') + '\n') });
      expect(textOf(lf.sRecord ?? [])).toBe(textOf(crlf.sRecord ?? []));
      expect(textOf(lf.listing ?? [])).toBe(textOf(crlf.listing ?? []));
      for (const output of [crlf.sRecord, crlf.listing]) {
        const text = textOf(output ?? []);
        expect(text.endsWith('\r\n')).toBe(true);
        expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/); // no lone CR or LF
      }
    });

    it('CR LF and Ctrl-Z in an include file are handled as Windows does: Ctrl-Z ends the file', async () => {
      const result = await assemble('p.X68', {
        'p.X68': source('START   NOP', '        INCLUDE inc.x68', '        END     START'),
        'inc.x68': bytesOf('        MOVEQ   #2,D1\r\n\x1a        BOGUS\r\n'),
      });
      expect(result).toMatchObject({ errorCount: 0, fatal: null }); // BOGUS was never read
      const listing = listingLines(result).join('\n');
      expect(listing).toContain('MOVEQ   #2,D1');
      expect(listing).not.toContain('BOGUS');
    });

    it('the macro temp file counts two bytes per line end (symbol-table values, assembler §9.4.2)', async () => {
      const first = ['        MOVEQ   #1,D0', '        MOVEQ   #2,D1', '        ENDM'];
      const result = await assemble('p.X68', {
        'p.X68': source(
          'ONE     MACRO',
          ...first,
          'TWO     MACRO',
          '        NOP',
          '        ENDM',
          'START   ONE',
          '        TWO',
          '        END     START',
        ),
      });
      expect(result.errorCount).toBe(0);
      // The value of a macro symbol is the offset of its body in the temp file: the lines of the
      // earlier bodies, each with CR LF.
      const withCrLf = first.reduce((sum, line) => sum + line.length + 2, 0);
      const symbols = listingLines(result).filter((line) => /^(ONE|TWO)\s/.test(line));
      expect(symbols).toEqual(['ONE                 0', `TWO                 ${withCrLf.toString(16).toUpperCase()}`]);
    });
  });

  describe('statement 2: INCLUDE and INCBIN names resolve against the supplied files', () => {
    it('without regard to letter case, with \\ and / equivalent and .. resolved, from the folder of mainName', async () => {
      const result = await assemble('course/lab1/prog.X68', {
        'course/lab1/prog.X68': source(
          'START   NOP',
          "        INCLUDE 'Macros\\IO.x68'", // stored as course/lab1/MACROS/io.X68
          '        INCLUDE ../shared/data.x68', // upper-cased by the assembler; stored in mixed case
          "DATA    INCBIN  '..\\Shared/blob.bin'",
          '        END     START',
        ),
        'course\\lab1\\MACROS\\io.X68': source('        MOVEQ   #3,D3'),
        'course/Shared/Data.X68': source('        MOVEQ   #4,D4', '        BOGUS'),
        'COURSE/SHARED/BLOB.BIN': Uint8Array.of(0xde, 0xad, 0xbe, 0xef),
      });
      // Both includes were found (their code is listed) and the binary went into the S-record.
      const listing = listingLines(result).join('\n');
      expect(listing).toContain('MOVEQ   #3,D3');
      expect(listing).toContain('MOVEQ   #4,D4');
      expect(textOf(result.sRecord ?? [])).toContain('DEADBEEF');
      // The one error is the deliberate one in the second include; it names the key it was read from.
      expect(result.messages).toEqual([
        {
          line: 2,
          severity: 'error',
          code: 0x402,
          text: 'ERROR: Invalid opcode',
          file: '../SHARED/DATA.X68',
          resolvedFile: 'course/Shared/Data.X68',
        },
      ]);
    });

    // Gate I2 (E5's review): the engine's own lookup already resolves these as Win32 does; when E5's
    // scan supplies the file, it is found.
    it("'..' after a folder that does not exist, and a trailing dot, resolve as on Windows", async () => {
      const result = await assemble('p/prog.X68', {
        'p/prog.X68': source(
          'START   NOP',
          "        INCLUDE 'q\\..\\lib1.x68'", // p/q does not exist
          "        INCLUDE 'lib2.x68.'",
          '        END     START',
        ),
        'p/lib1.x68': source('        MOVEQ   #1,D1'),
        'p/lib2.x68': source('        MOVEQ   #2,D2'),
      });
      expect(result.messages).toEqual([]);
      const listing = listingLines(result).join('\n');
      expect(listing).toContain('MOVEQ   #1,D1');
      expect(listing).toContain('MOVEQ   #2,D2');
    });

    it('a name that no supplied file has is the original\'s "Unable to access specified file"', async () => {
      const result = await assemble('prog.X68', {
        'prog.X68': source('START   NOP', '        INCLUDE missing.x68', '        END     START'),
        'other/missing.x68': source('        NOP'), // not in the folder of the main file
      });
      expect(result.messages.map((message) => message.text)).toEqual(['ERROR: Unable to access specified file']);
    });

    it('the main source is found whatever the case and separators of mainName; outputs are named after it', async () => {
      const asm = await createAsmEngine();
      const files = new Map([['Demo\\Prog.X68', source('START   NOP', '        END     START')]]);
      const result = await asm.assemble('demo/prog.x68', files, TEST_ASM_OPTIONS, TEST_ASM_TIME);
      expect(result).toMatchObject({ errorCount: 0, listingName: 'demo/prog.L68', sRecordName: 'demo/prog.S68' });
    });
  });

  describe('statement 3: every assembly runs in a fresh instance of the once-compiled module', () => {
    it('state of one assembly does not reach the next (assembler §1.8)', async () => {
      // Without END the start address is whatever the last run left: 0 in a fresh instance.
      const withEnd = source('        ORG     $2000', 'START   NOP', '        END     START');
      const withoutEnd = source('        ORG     $3000', '        NOP');
      const asm = await createAsmEngine();
      const run = (bytes: Bytes) => asm.assemble('p.X68', new Map([['p.X68', bytes]]), TEST_ASM_OPTIONS, TEST_ASM_TIME);
      expect(listingLines(await run(withEnd))[0]).toBe('00002000 Starting Address');
      const second = await run(withoutEnd);
      expect(listingLines(second)[0]).toBe('00000000 Starting Address');
      expect(textOf(second.sRecord ?? [])).toContain('S804000000FB');
      // An unterminated false IFEQ leaves a counter behind in the original; not here.
      const dirty = await run(source('        IFEQ    1', '        NOP'));
      expect(dirty.fatal).toBeNull();
      const clean = await run(
        source('        IFEQ    1', '        BOGUS', '        ENDC', 'START   NOP', '        END     START'),
      );
      expect(clean.errorCount).toBe(0);
      expect(listingLines(clean).join('\n')).toContain('START   NOP');
    });

    it('the .wasm is compiled once; each assembly instantiates that module once', async () => {
      const asm = await createAsmEngine();
      const compile = vi.spyOn(WebAssembly, 'compile');
      const instantiate = vi.spyOn(WebAssembly, 'instantiate');
      const files = new Map([['p.X68', source('START   NOP', '        END     START')]]);
      for (let i = 0; i < 5; i++) await asm.assemble('p.X68', files, TEST_ASM_OPTIONS, TEST_ASM_TIME);
      await (await createAsmEngine()).assemble('p.X68', files, TEST_ASM_OPTIONS, TEST_ASM_TIME); // a second engine object
      expect(compile).not.toHaveBeenCalled();
      expect(instantiate).toHaveBeenCalledTimes(6);
      const modules = new Set(instantiate.mock.calls.map(([module]) => module));
      expect(modules.size).toBe(1);
      expect([...modules][0]).toBeInstanceOf(WebAssembly.Module);
      expect(engineLoadInfo('asm').compilations).toBe(1);
    });

    it('500 consecutive assemblies succeed', async () => {
      const asm = await createAsmEngine();
      const files = new Map([
        ['p.X68', source('        ORG     $1000', 'START   MOVEQ   #1,D0', '        SIMHALT', '        END     START')],
      ]);
      let sRecord = '';
      for (let i = 0; i < 500; i++) {
        const result = await asm.assemble('p.X68', files, TEST_ASM_OPTIONS, TEST_ASM_TIME);
        if (result.fatal !== null || result.errorCount !== 0) throw new Error(`assembly ${i}: ${result.fatal}`);
        if (i === 0) sRecord = textOf(result.sRecord ?? []);
        else if (textOf(result.sRecord ?? []) !== sRecord) throw new Error(`assembly ${i} gave another S-record`);
      }
      expect(sRecord).toContain('S804001000EB');
    });
  });

  // ---- fatal results ------------------------------------------------------------------------------

  describe('a run that ends abnormally is a `fatal` result, not an exception', () => {
    const files = { 'p.X68': source('START   NOP', '        END     START') };

    it('a trap inside the engine: the module reports it, the binding passes it on', async () => {
      const real = WebAssembly.instantiate.bind(WebAssembly) as (
        m: WebAssembly.Module,
        i?: WebAssembly.Imports,
      ) => Promise<WebAssembly.Instance>;
      // Hand the module an instance whose ez_assemble traps.
      vi.spyOn(WebAssembly, 'instantiate').mockImplementationOnce((async (
        module: WebAssembly.Module,
        imports?: WebAssembly.Imports,
      ) => {
        const instance = await real(module, imports);
        const exports = {
          ...instance.exports,
          ez_assemble: () => {
            throw new WebAssembly.RuntimeError('unreachable');
          },
        };
        return { exports };
      }) as unknown as typeof WebAssembly.instantiate);
      const result = await assemble('p.X68', files);
      expect(result.fatal).toBe('The assembler stopped abnormally: unreachable');
      expect(result).toMatchObject({
        listing: null,
        sRecord: null,
        messages: [],
        dialogs: [],
        errorCount: 0,
        warningCount: 0,
        executeEnabled: false,
        status: -1,
        listingName: 'p.L68',
        sRecordName: 'p.S68',
      });
      expect((await assemble('p.X68', files)).fatal).toBeNull(); // the next assembly is unaffected
    });

    it('no instance can be created: a fatal result, nothing unhandled, and the next assembly works', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        vi.spyOn(WebAssembly, 'instantiate').mockRejectedValueOnce(
          new RangeError('WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new instance'),
        );
        const result = await assemble('course/p.X68', { 'course/p.X68': files['p.X68'] });
        expect(result.fatal).toBe(
          'The assembler could not start: WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new instance',
        );
        expect(result).toMatchObject({
          listing: null,
          sRecord: null,
          messages: [],
          executeEnabled: false,
          status: -1,
          listingName: 'course/p.L68',
          sRecordName: 'course/p.S68',
        });
        // WebAssembly.instantiate is itself again, and the next assembly works
        expect((await assemble('p.X68', files)).fatal).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('arguments the contract forbids are the only thing assemble() rejects for', async () => {
      const asm = await createAsmEngine();
      const map = new Map(Object.entries(files));
      await expect(asm.assemble('other.X68', map, TEST_ASM_OPTIONS, TEST_ASM_TIME)).rejects.toThrow(
        'files has no entry for the main source "other.X68"',
      );
      await expect(asm.assemble('p.X68', map, { ...TEST_ASM_OPTIONS, tabSize: 100 }, TEST_ASM_TIME)).rejects.toThrow(
        RangeError,
      );
      await expect(asm.assemble('p.X68', map, TEST_ASM_OPTIONS, new Date(NaN))).rejects.toThrow(RangeError);
      expect((await asm.assemble('p.X68', map, TEST_ASM_OPTIONS, TEST_ASM_TIME)).fatal).toBeNull();
    });
  });

  describe('what ARCHITECTURE.md 10.3 asks W4 to confirm about the module', () => {
    const program = { 'p.X68': source('        ORG     $1000', 'START   NOP', '        END     START') };

    it('executeEnabled means "no errors": it is true even when no S-record was produced', async () => {
      const result = await assemble('p.X68', program, {
        ...TEST_ASM_OPTIONS,
        generateSRecord: false,
        generateListing: false,
      });
      expect(result).toMatchObject({ listing: null, sRecord: null, errorCount: 0, executeEnabled: true });
      // the names are given all the same
      expect([result.listingName, result.sRecordName]).toEqual(['p.L68', 'p.S68']);
    });

    it('the main source is the entry of `files` under mainName, taken as the editor buffer', async () => {
      // A last line without a line end is assembled as the editor would have saved it: with one.
      const complete = await assemble('p.X68', program);
      const unterminated = await assemble('p.X68', {
        'p.X68': bytesOf('        ORG     $1000\r\nSTART   NOP\r\n        END     START'),
      });
      expect(textOf(unterminated.listing ?? [])).toBe(textOf(complete.listing ?? []));
      expect(textOf(unterminated.sRecord ?? [])).toBe(textOf(complete.sRecord ?? []));
    });

    it('hidden warnings are still counted', async () => {
      const warn = { 'p.X68': source('        ORG     $1001', 'START   NOP', '        END     START') };
      const shown = await assemble('p.X68', warn);
      const hidden = await assemble('p.X68', warn, { ...TEST_ASM_OPTIONS, showWarnings: false });
      expect(shown.messages).toMatchObject([
        {
          line: 1,
          severity: 'warning',
          text: 'WARNING: Origin value is odd (Location counter set to next highest address)',
        },
      ]);
      expect(shown).toMatchObject({ warningCount: 1, errorCount: 0, executeEnabled: true });
      expect(hidden.messages).toEqual([]);
      expect(hidden).toMatchObject({ warningCount: 1, errorCount: 0, executeEnabled: true });
    });
  });
});

// ---- the oracle's outputs -----------------------------------------------------------------------
//
// Written by build/oracle/asm-cli-5.15.4/bin/asy68k.exe (tools/build-asm-oracle.ps1) for
// tests/oracle/asm-cli/smoke-test/smoke.X68 on 2026-11-20; both files end every line in CR LF.

/* prettier-ignore */
const ORACLE_S68: readonly string[] = [
  'S021000036384B50524F47202020323043524541544544204259204541535936384B6D',
  'S12310004FF90000800048E7FFFE43F900002000103C000E4E4F43F900002010103C000DC0',
  'S12310204E4F4282323C000160000006D4415241B27C00056FF6B47C000F6600000C43F949',
  'S1231040000020276000000843F90000202E103C000D4E4F7603534367066100003060F6FA',
  'S1211060B63C00046C000006520360F4E28AB4BC0000002162F64CDF7FFF48B9020557',
  'S10F107E0000205823C200002068FFFF7F',
  'S1051088FFFF64',
  'S10B108CD48251CCFFFC4E7527',
  'S124200048656C6C6F2C203638303030210D0A00497427732061202271756F746564222073E4',
  'S12420217472696E670073756D206F6B0073756D206261640000010002000300044142FFFF00',
  'S11920420021DEADBEEF0000100041424344000000150000000AF2',
  'S10B206CFFFFFFFFFFFFFFFF70',
  'S804001000EB',
];

/* prettier-ignore */
const ORACLE_L68: readonly string[] = [
  '00001000 Starting Address',
  'Assembler used: ASy68K Assembler v5.15.04',
  'Created On: 11/20/2026 7:09:32 PM',
  '',
  '00000000                             1  *-----------------------------------------------------------',
  '00000000                             2  * Title      : Toolchain smoke test',
  '00000000                             3  * Written by : EASy68K macOS port team',
  '00000000                             4  * Description: Small but varied program. It is assembled by the native',
  '00000000                             5  *              oracle (asy68k.exe) and by the WebAssembly build of the',
  '00000000                             6  *              same sources, and the .L68 / .S68 outputs are compared.',
  '00000000                             7  *-----------------------------------------------------------',
  '00000000  =0000000D                  8  CR      EQU     $0D',
  '00000000  =0000000A                  9  LF      EQU     $0A',
  '00000000  =00000005                 10  COUNT   EQU     5                   number of FOR iterations',
  '00000000  =00008000                 11  STACK   EQU     $8000',
  '00000000  =00000021                 12  SQUARE  EQU     COUNT*COUNT+(STACK>>12)',
  '00000000                            13  ',
  '00000000                            14  * print the string at \\1 with TRAP #15 task \\2',
  '00000000                            15  PRINT   MACRO',
  '00000000                            16          LEA     \\1,A1',
  '00000000                            17          MOVE.B  #\\2,D0',
  '00000000                            18          TRAP    #15',
  '00000000                            19          ENDM',
  '00000000                            20  ',
  '00001000                            21          ORG     $1000',
  '00001000                            22  START:                              ; first instruction of program',
  '00001000  4FF9 00008000             23          LEA     STACK,SP',
  '00001006  48E7 FFFE                 24          MOVEM.L D0-D7/A0-A6,-(SP)   save everything',
  '0000100A                            25m         PRINT   HELLO,14',
  '00001016                            26m         PRINT   MSG2,13',
  '00001022                            27  ',
  '00001022  4282                      28          CLR.L   D2',
  '00001024                            29          FOR.W   D1 = #1 TO #COUNT DO',
  '0000102C  D441                      30              ADD.W   D1,D2',
  '0000102E                            31          ENDF',
  '00001036                            32  ',
  '00001036                            33          IF.W D2 <EQ> #15 THEN',
  '0000103E  43F9 00002027             34              LEA     OKMSG,A1',
  '00001044                            35          ELSE',
  '00001048  43F9 0000202E             36              LEA     BADMSG,A1',
  '0000104E                            37          ENDI',
  '0000104E  103C 000D                 38          MOVE.B  #13,D0',
  '00001052  4E4F                      39          TRAP    #15',
  '00001054                            40  ',
  '00001054  7603                      41          MOVEQ   #3,D3',
  '00001056  5343                      42  LOOP    SUBQ.W  #1,D3               backward branch target',
  '00001058  6706                      43          BEQ.S   DONE                forward short branch',
  '0000105A  6100 0030                 44          BSR     DOUBLE              forward subroutine call',
  '0000105E  60F6                      45          BRA     LOOP                backward branch',
  '00001060                            46  DONE    WHILE.B D3 <LT> #4 DO',
  '00001068  5203                      47              ADDQ.B  #1,D3',
  '0000106A                            48          ENDW',
  '0000106C                            49          REPEAT',
  '0000106C  E28A                      50              LSR.L   #1,D2',
  '0000106E                            51          UNTIL.L D2 <LS> #SQUARE DO',
  '00001076  4CDF 7FFF                 52              MOVEM.L (SP)+,D0-D7/A0-A6       tab-separated line',
  '0000107A  48B9 0205 00002058        53          MOVEM.W D0/D2/A1,BUFFER',
  '00001082  23C2 00002068             54          MOVE.L  D2,RESULT',
  '00001088  FFFF FFFF                 55          SIMHALT',
  '0000108C                            56  ',
  '0000108C  D482                      57  DOUBLE  ADD.L   D2,D2',
  '0000108E  51CC FFFC                 58          DBRA    D4,DOUBLE           backward DBcc',
  '00001092  4E75                      59          RTS',
  '00001094                            60  ',
  '00002000                            61          ORG     $2000',
  '00002000= 48 65 6C 6C 6F 2C ...     62  HELLO   DC.B    \'Hello, 68000!\',CR,LF,0',
  '00002010= 49 74 27 73 20 61 ...     63  MSG2    DC.B    \'It\'\'s a "quoted" string\',0',
  '00002027= 73 75 6D 20 6F 6B 00      64  OKMSG   DC.B    \'sum ok\',0',
  '0000202E= 73 75 6D 20 62 61 ...     65  BADMSG  DC.B    \'sum bad\',0',
  '00002036= 0001 0002 0003 0...       66  WORDS   DC.W    1,$2,%11,@4,\'AB\',-1,SQUARE',
  '00002044= DEADBEEF 00001000 ...     67  LONGS   DC.L    $DEADBEEF,START,\'ABCD\',COUNT*4+1,DONE-LOOP',
  '00002058                            68  BUFFER  DS.B    15',
  '00002068                            69  RESULT  DS.L    1',
  '0000206C= FFFF FFFF FFFF FFFF       70  TABLE   DCB.W   4,$FFFF',
  '00002074                            71          END     START',
  '',
  'No errors detected',
  'No warnings generated',
  '',
  '',
  'SYMBOL TABLE INFORMATION',
  'Symbol-name         Value',
  '-------------------------',
  'BADMSG              202E',
  'BUFFER              2058',
  'COUNT               5',
  'CR                  D',
  'DONE                1060',
  'DOUBLE              108C',
  'HELLO               2000',
  'LF                  A',
  'LONGS               2044',
  'LOOP                1056',
  'MSG2                2010',
  'OKMSG               2027',
  'PRINT               0',
  'RESULT              2068',
  'SQUARE              21',
  'STACK               8000',
  'START               1000',
  'TABLE               206C',
  'WORDS               2036',
  '_00000000           1048',
  '_00000001           104E',
  '_10000000           1060',
  '_10000001           106C',
  '_20000000           102C',
  '_20000001           1030',
  '_30000000           106C',
];
