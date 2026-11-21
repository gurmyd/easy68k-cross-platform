// LogService with the real engine, the real run controller and the real host parts, headless
// (ARCHITECTURE.md 3.3.5, 5.5, 6.4; sim-ui §13.4, §13.5).
//
//   - the three execution-log examples of sim-ui §13.4 and the output-log example of §13.5, byte
//     for byte;
//   - the execution and output logs that the official SIM68K.exe wrote under Wine
//     (build/ground-truth/sim/log, git-ignored; skipped where the folder is missing), from the
//     programs of tests/oracle/wine/sim/tests;
//   - Log Start while a program runs and the file exists: every byte the program writes after the
//     click is in the log, however long the question stays open;
//   - a flush of a 30 MB log costs what a flush of a small one costs.
//
// Skipped when engine/dist is missing; fails instead when EASY68K_REQUIRE_ENGINES=1 (CI).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg, type Bytes, type FileSystemBackend, type Vfs, type VPath } from '../../../contracts';
import { createSimEngine, releaseSimEngine } from '../../../engine';
import { assembleProgram, type AssembledProgram } from '../../../engine/testing';
import { BrowserBackend } from '../../../fs/browser-backend';
import { MemoryBackend } from '../../../fs/memory-backend';
import { MemorySyncFiles } from '../../../fs/sync/memory';
import { createVfs } from '../../../fs/vfs';
import { VirtualTime } from '../../run/clock';
import { createHeadlessSession, type HeadlessOptions, type HeadlessSession } from '../../run/headless';
import { asciiBytes } from './format';
import { LogService } from './log-service';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const dist = (file: string) => here(`../../../../../engine/dist/${file}`);
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const GROUND_TRUTH = here('../../../../../build/ground-truth/sim/log');
const REPO = here('../../../../..');
/** Where the programs of those logs were when the logs were made (T1's layout; T3 moves them). */
const ORACLE_PROGRAMS = 'tests/oracle/wine/sim/tests';
const groundTruthPresent = existsSync(GROUND_TRUTH);

/**
 * The source of a program of the Wine logs, exactly as it was when the logs were made: from the
 * working tree, or else from the last commit that had it (T3 moves the programs and changes their
 * comment lines, which shifts the `Line=` numbers of the listing). null when neither is available.
 */
function oracleSource(program: string): string | null {
  const relative = `${ORACLE_PROGRAMS}/${program}.X68`;
  if (existsSync(`${REPO}/${relative}`)) return readFileSync(`${REPO}/${relative}`, 'latin1');
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: REPO, encoding: 'latin1', stdio: ['ignore', 'pipe', 'ignore'] });
    const commit = git('log', '-1', '--format=%H', '--diff-filter=AM', '--', relative).trim();
    return commit === '' ? null : git('show', `${commit}:${relative}`);
  } catch {
    return null;
  }
}

const LONG = 120_000;
const ENGINE_TEST_TIMEOUT = 120_000;
/** The date of the examples of sim-ui §13.4 and §13.5. */
const EXAMPLE_DATE = new Date(2026, 10, 20, 15, 4, 5);

const text = (bytes: Bytes): string => {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
};
/** A literal example of the spec, written with LF line ends, as the CR LF bytes of the file. */
const crlf = (lines: readonly string[]): string => lines.map((line) => `${line}\r\n`).join('');

/** The program of the examples of sim-ui §13.4: MOVE.B at listing line 9, MSG at $1012. */
const EXAMPLE_SOURCE = [
  '*-----------------------------------------------------------',
  '* The program of the execution-log examples of sim-ui 13.4.',
  '*-----------------------------------------------------------',
  '*',
  '*',
  '*',
  '    ORG     $1000',
  'START:',
  '    MOVE.B  #14,D0',
  '    LEA     MSG,A1',
  '    TRAP    #15',
  '    SIMHALT',
  '    ORG     $1012',
  "MSG DC.B    'Hello',0",
  '    END     START',
];

/** The program of the output-log example of sim-ui §13.5: task 14 `Hello`, task 13 `World`. */
const OUTPUT_SOURCE = [
  '    ORG     $1000',
  'START:',
  '    LEA     HELLO,A1',
  '    MOVE.B  #14,D0',
  '    TRAP    #15',
  '    LEA     WORLD,A1',
  '    MOVE.B  #13,D0',
  '    TRAP    #15',
  '    SIMHALT',
  "HELLO DC.B 'Hello',0",
  "WORLD DC.B 'World',0",
  '    END     START',
];

describe.skipIf(!enginesBuilt)(
  'LogService with the real engine (needs engine/dist)',
  { timeout: ENGINE_TEST_TIMEOUT },
  () => {
    let session: HeadlessSession | null = null;
    let example: AssembledProgram;
    let outputExample: AssembledProgram;

    beforeAll(async () => {
      example = await assembleProgram(EXAMPLE_SOURCE);
      outputExample = await assembleProgram(OUTPUT_SOURCE);
    }, LONG);

    afterEach(() => {
      session?.dispose();
      session = null;
    });

    async function memoryVfs(files: Record<string, Bytes>): Promise<Vfs> {
      const vfs = createVfs();
      vfs.mount(new MemoryBackend());
      for (const [path, data] of Object.entries(files)) await vfs.writeFile(path, data);
      return vfs;
    }

    async function create(vfs: Vfs, options: Partial<HeadlessOptions> = {}): Promise<HeadlessSession> {
      session = await createHeadlessSession({
        engines: { create: createSimEngine, release: releaseSimEngine },
        vfs,
        viewFor: () => new MemorySyncFiles(),
        time: new VirtualTime(EXAMPLE_DATE),
        ...options,
      });
      return session;
    }

    /** Waits until the log service has nothing left to write. */
    async function settled(s: HeadlessSession): Promise<void> {
      for (let i = 0; i < 20 && s.log.unsaved; i++) await s.log.flush();
      expect(s.log.unsaved).toBe(false);
    }

    /** Auto Trace until the program halts; between two ticks the simulator is idle. */
    function autoTraceToHalt(s: HeadlessSession, limitMs = 600_000): void {
      s.controller.autoTrace();
      for (let t = 0; t < limitMs && !s.controller.snapshot.halted; t += 16) {
        if (s.controller.alerts.length > 0) s.controller.dismissAlerts();
        s.time.advance(16);
      }
      expect(s.runUntilIdle()).toBe(true);
    }

    /** Trace Into until the program halts (the `Current Log Stopped.` box is answered with OK). */
    function traceToHalt(s: HeadlessSession, limit = 100_000): number {
      let steps = 0;
      while (!s.controller.snapshot.halted && steps < limit) {
        s.controller.traceInto();
        expect(s.runUntilIdle()).toBe(true);
        steps++;
      }
      return steps;
    }

    /** Opens the example, selects the types in the dialog (OK) and presses Log Start. */
    async function exampleRun(
      execType: 1 | 2 | 3,
      outputType: 0 | 1,
      mem = { from: 0, bytes: 0 },
    ): Promise<{ s: HeadlessSession; vfs: Vfs }> {
      const vfs = await memoryVfs({ '/memory/work/hello.S68': example.s68, '/memory/work/hello.L68': example.l68 });
      const s = await create(vfs);
      await s.controller.open('/memory/work/hello.S68', 'open');
      s.log.applyDialog({ ...s.log.state, execType, outputType, memFrom: mem.from, memBytes: mem.bytes });
      expect(s.log.state.startEnabled).toBe(true);
      expect(await s.log.start()).toBe(true);
      expect(s.engine.state().logging).toBe(true);
      expect(traceToHalt(s)).toBe(4);
      expect(s.log.state.logging).toBe(false); // SIMHALT stopped the log ("Current Log Stopped.")
      await settled(s);
      return { s, vfs };
    }

    it('sim-ui §13.4, type 1 `Instruction only`, byte for byte', async () => {
      const { vfs } = await exampleRun(1, 0);
      const log = text(await vfs.readFile('/memory/work/hello_RunLog.txt'));
      expect(log).toBe(
        crlf([
          'EASy68K execution log file: 11/20/2026 3:04:05 PM',
          '',
          'PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0',
          'PC=00001004  Code=43F9 00001012          Line=   10      LEA     MSG,A1',
          'PC=0000100A  Code=4E4F                   Line=   11      TRAP    #15',
          'PC=0000100C  Code=FFFF FFFF              Line=   12      SIMHALT',
        ]),
      );
    });

    it('sim-ui §13.4, type 2 `Instruction and Registers`: the first two entries, byte for byte', async () => {
      const { vfs } = await exampleRun(2, 0);
      const log = text(await vfs.readFile('/memory/work/hello_RunLog.txt'));
      const firstTwo = crlf([
        'EASy68K execution log file: 11/20/2026 3:04:05 PM',
        '',
        '',
        'D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC',
        'D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000',
        'D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000',
        'D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000',
        'PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0',
        '',
        'D0=0000000E D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC',
        'D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000',
        'D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000',
        'D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000',
        'PC=00001004  Code=43F9 00001012          Line=   10      LEA     MSG,A1',
      ]);
      expect(log.startsWith(firstTwo)).toBe(true);
      // Four entries of six lines each after the header.
      expect(log.split('\r\n').filter((line) => line.startsWith('PC='))).toHaveLength(4);
      expect(log.endsWith('Line=   12      SIMHALT\r\n')).toBe(true);
    });

    it('sim-ui §13.4, type 3 with From = 00001012, Bytes = 10: the first entry, byte for byte', async () => {
      const { vfs, s } = await exampleRun(3, 0, { from: 0x1012, bytes: 0x10 });
      const log = text(await vfs.readFile('/memory/work/hello_RunLog.txt'));
      const first = crlf([
        'EASy68K execution log file: 11/20/2026 3:04:05 PM',
        '',
        '',
        '00001010: FF FF 48 65 6C 6C 6F 00 FF FF FF FF FF FF FF FF --Hello---------',
        '',
        'D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC',
        'D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000',
        'D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000',
        'D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000',
        'PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0',
      ]);
      expect(log.startsWith(first)).toBe(true);
      // From and Bytes reached the engine (LogMemFrom, LogMemBytes), and only one row is logged.
      expect(log.split('\r\n').filter((line) => line.startsWith('00001010: '))).toHaveLength(4);
      expect(s.log.tail('exec', 1)).toEqual(['PC=0000100C  Code=FFFF FFFF              Line=   12      SIMHALT']);
    });

    it('sim-ui §13.5, the output-log example, byte for byte (Run at full speed)', async () => {
      const vfs = await memoryVfs({
        '/memory/work/out.S68': outputExample.s68,
        '/memory/work/out.L68': outputExample.l68,
      });
      const s = await create(vfs);
      await s.controller.open('/memory/work/out.S68', 'open');
      s.log.applyDialog({ ...s.log.state, execType: 0, outputType: 1 });
      expect(await s.log.start()).toBe(true);
      s.controller.run();
      expect(s.runUntilIdle()).toBe(true);
      expect(s.log.state.logging).toBe(false);
      await settled(s);
      expect(await vfs.stat('/memory/work/out_RunLog.txt')).toBeNull();
      expect(text(await vfs.readFile('/memory/work/out_OutLog.txt'))).toBe(
        'EASy68K output log file: 11/20/2026 3:04:05 PM\r\n\r\nHelloWorld\n',
      );
    });

    it('Rewind writes its note only if the dialog had been shown with a type selected (sim-ui Q24)', async () => {
      for (const shown of [false, true]) {
        const vfs = await memoryVfs({
          '/memory/work/out.S68': outputExample.s68,
          '/memory/work/out.L68': outputExample.l68,
        });
        const s = await create(vfs, { settings: { execLogType: 1, outputLogType: 1 } });
        await s.controller.open('/memory/work/out.S68', 'open');
        if (shown) s.log.dialogShown(); // the types came from the settings and are already selected
        expect(await s.log.start()).toBe(true);
        s.controller.traceInto();
        expect(s.runUntilIdle()).toBe(true);
        s.controller.rewind();
        s.controller.traceInto();
        expect(s.runUntilIdle()).toBe(true);
        await s.controller.reload();
        expect(s.runUntilIdle()).toBe(true);
        s.log.stop();
        await settled(s);
        const exec = text(await vfs.readFile('/memory/work/out_RunLog.txt'));
        const output = text(await vfs.readFile('/memory/work/out_OutLog.txt'));
        if (shown) {
          expect(exec).toContain('\r\n***** Reset Program Pressed *****\r\n');
          expect(exec).toContain('\r\n***** Reload Program Pressed *****\r\n');
          expect(output).toBe(
            'EASy68K output log file: 11/20/2026 3:04:05 PM\r\n\r\n' +
              '\n***** Reset Program Pressed *****\n\n***** Reload Program Pressed *****\n',
          );
        } else {
          expect(exec).not.toContain('Pressed');
          expect(output).toBe('EASy68K output log file: 11/20/2026 3:04:05 PM\r\n\r\n');
        }
        session?.dispose();
        session = null;
      }
    });

    it('Open stops a running log with `Current Log Stopped.` and recomputes the names', async () => {
      const vfs = await memoryVfs({
        '/memory/work/hello.S68': example.s68,
        '/memory/work/hello.L68': example.l68,
        '/memory/other/out.S68': outputExample.s68,
      });
      const s = await create(vfs, { settings: { execLogType: 1 } });
      await s.controller.open('/memory/work/hello.S68', 'open');
      expect(await s.log.start()).toBe(true);
      await s.controller.open('/memory/other/out.S68', 'open');
      expect(s.controller.alerts.map((alert) => alert.text)).toEqual(['Current Log Stopped.']);
      expect(s.runUntilIdle()).toBe(true);
      expect(s.log.state).toMatchObject({
        logging: false,
        startEnabled: true,
        execFileName: '/memory/other/out_RunLog.txt',
        outputFileName: '/memory/other/out_OutLog.txt',
      });
      await settled(s);
    });

    describe('Log Start while a program runs and the log file exists', () => {
      // A program that writes "0\r\n1\r\n2\r\n..." for ever.
      const COUNTER = [
        '    ORG     $1000',
        'START:',
        '    MOVEQ   #0,D2',
        'LOOP:',
        '    MOVE.L  D2,D1',
        '    MOVEQ   #3,D0',
        '    TRAP    #15',
        '    LEA     CRLF,A1',
        '    MOVEQ   #14,D0',
        '    TRAP    #15',
        '    ADDQ.L  #1,D2',
        '    BRA     LOOP',
        'CRLF DC.B  13,10,0',
        '    END     START',
      ];

      it(
        'every byte written after the click is in the log, however long the question stays open',
        async () => {
          const counter = await assembleProgram(COUNTER);
          for (const questionMs of [0, 250, 30_000]) {
            const vfs = await memoryVfs({
              '/memory/work/count.S68': counter.s68,
              '/memory/work/count.L68': counter.l68,
              '/memory/work/count_OutLog.txt': asciiBytes('an older log\r\n'),
            });
            const time = new VirtualTime(EXAMPLE_DATE);
            const box = {} as { s: HeadlessSession };
            let asked = 0;
            let d2WhileAsked: number[] = [];
            // The application's own pieces: the dialog holds the controller while it is open
            // (4.4.5), the Log Start command holds it for the whole of start() (features/log).
            const log = new LogService({
              vfs,
              clock: time,
              scheduler: time,
              invoke: (fn) => box.s.controller.invoke(fn),
              askFileExists: async () => {
                asked++;
                const release = box.s.controller.hold();
                d2WhileAsked = [box.s.engine.getRegister(Reg.D2)];
                // The user takes their time; frames and timers go on meanwhile.
                for (let t = 0; t < questionMs; t += 50) {
                  time.advance(50);
                  await Promise.resolve();
                }
                d2WhileAsked.push(box.s.engine.getRegister(Reg.D2));
                release();
                return 'Append';
              },
            });
            // A slow speed keeps the text screen's work small; the rule does not depend on the speed.
            const s = await create(vfs, {
              time,
              parts: { log },
              settings: { outputLogType: 1, speed: { mode: 'custom', instructionsPerSecond: 20_000 } },
            });
            box.s = s;
            // Every byte the program writes passes through outputWrite (TextScreen -> LogService).
            const seen: number[] = [];
            const original = log.outputWrite.bind(log);
            log.outputWrite = (data: Bytes) => {
              for (const byte of data) seen.push(byte);
              original(data);
            };

            await s.controller.open('/memory/work/count.S68', 'open');
            s.controller.run();
            time.advance(200);
            expect(s.controller.phase).toBe('running');

            // The click.
            const atClick = seen.length;
            const release = box.s.controller.hold();
            const started = log.start();
            time.advance(100); // frames arrive before the store has answered
            expect(await started).toBe(true);
            release();
            expect(asked).toBe(1);
            expect(d2WhileAsked[0]).toBe(d2WhileAsked[1]); // the program stood still while asked

            time.advance(300);
            log.stop();
            const atStop = seen.length;
            time.advance(200); // the program goes on without the log
            s.controller.pause();
            await settled(s);

            const file = text(await vfs.readFile('/memory/work/count_OutLog.txt'));
            // The date is the moment of the answer, questionMs of virtual time after the click.
            const header = /^an older log\r\nEASy68K output log file: 11\/20\/2026 3:0\d:\d\d PM\r\n\r\n/;
            expect(file).toMatch(header);
            const logged = file.replace(header, '');
            const expected = text(Uint8Array.from(seen.slice(atClick, atStop)));
            expect(atStop - atClick).toBeGreaterThan(100); // the program did write after the click
            expect(logged.length).toBe(expected.length);
            expect(logged).toBe(expected);
            expect(seen.length).toBeGreaterThan(atStop);
            session?.dispose();
            session = null;
          }
        },
        ENGINE_TEST_TIMEOUT,
      );
    });

    describe.skipIf(!groundTruthPresent)(
      'the logs of the official SIM68K.exe under Wine (build/ground-truth/sim/log)',
      () => {
        interface Case {
          label: string;
          program: string;
          exec: 0 | 1 | 2 | 3;
          output: 0 | 1;
          drive: 'autotrace' | 'step' | 'run';
        }
        // The recipes of tests/oracle/wine/sim/sim_proofs.sh (T1, T3).
        const CASES: Case[] = [
          ...['l1_arith', 'l2_bcd_shift', 'l3_memory', 'l4_print', 'l5_branches'].map((program): Case => ({
            label: `${program}-autotrace-type3`,
            program,
            exec: 3,
            output: 0,
            drive: 'autotrace',
          })),
          { label: 'l1_arith-autotrace-type1', program: 'l1_arith', exec: 1, output: 0, drive: 'autotrace' },
          { label: 'l1_arith-autotrace-type2', program: 'l1_arith', exec: 2, output: 0, drive: 'autotrace' },
          { label: 'l1_arith-step-type2', program: 'l1_arith', exec: 2, output: 0, drive: 'step' },
          { label: 'l4_print-run-outlog', program: 'l4_print', exec: 0, output: 1, drive: 'run' },
          { label: 'l4_print-autotrace-both', program: 'l4_print', exec: 2, output: 1, drive: 'autotrace' },
        ];
        const present = groundTruthPresent ? new Set(readdirSync(GROUND_TRUTH)) : new Set<string>();
        const results: string[] = [];

        /** The header's date is the moment of the run: compare it by its form, the rest byte for byte. */
        const HEADER =
          /^(EASy68K (?:execution|output) log file: )(\d{1,2}\/\d{1,2}\/\d{4}(?: \d{1,2}:\d\d:\d\d [AP]M)?)\r\n/;
        const withoutDate = (log: string): string => {
          expect(log).toMatch(HEADER);
          return log.replace(HEADER, '$1<date>\r\n');
        };

        for (const c of CASES) {
          it.runIf(present.has(c.label))(
            c.label,
            async () => {
              const source = oracleSource(c.program);
              if (source === null) {
                console.log(`ground truth ${c.label}: the program ${c.program}.X68 is not available, not compared`);
                return;
              }
              const program = await assembleProgram(source);
              const dir: VPath = '/memory/oracle';
              const vfs = await memoryVfs({
                [`${dir}/${c.program}.S68`]: program.s68,
                [`${dir}/${c.program}.L68`]: program.l68,
              });
              // sim_run.py writes the types into sim68K.dat and sets the auto-trace interval to 10 ms.
              const s = await create(vfs, {
                settings: { execLogType: c.exec, outputLogType: c.output, autoTraceIntervalMs: 10 },
              });
              await s.controller.open(`${dir}/${c.program}.S68`, 'open');
              expect(s.runUntilIdle()).toBe(true); // the engine's log types reach the service a frame later
              expect(s.log.state.startEnabled).toBe(true);
              expect(await s.log.start()).toBe(true);
              if (c.drive === 'autotrace') {
                autoTraceToHalt(s);
              } else if (c.drive === 'run') {
                s.controller.run();
                expect(s.runUntilIdle()).toBe(true);
              } else {
                traceToHalt(s);
              }
              expect(s.controller.snapshot.halted).toBe(true);
              expect(s.log.state.logging).toBe(false);
              await settled(s);

              let matched = true;
              for (const [kind, suffix] of [
                ['exec', '_RunLog.txt'],
                ['output', '_OutLog.txt'],
              ] as const) {
                const truthPath = `${GROUND_TRUTH}/${c.label}/${c.program}${suffix}`;
                const wanted = kind === 'exec' ? c.exec !== 0 : c.output !== 0;
                expect(existsSync(truthPath)).toBe(wanted);
                const ours = await vfs.stat(`${dir}/${c.program}${suffix}`);
                expect(ours !== null).toBe(wanted);
                if (!wanted) continue;
                const truth = readFileSync(truthPath, 'latin1');
                const mine = text(await vfs.readFile(`${dir}/${c.program}${suffix}`));
                if (withoutDate(mine) !== withoutDate(truth)) matched = false;
                expect(withoutDate(mine)).toBe(withoutDate(truth));
              }
              results.push(`${c.label}: ${matched ? 'identical' : 'DIFFERENT'}`);
              console.log(`ground truth ${c.label}: ${matched ? 'identical' : 'DIFFERENT'}`);
            },
            ENGINE_TEST_TIMEOUT,
          );
        }
      },
    );
  },
);

describe('the cost of a flush does not grow with the file (3.3.5)', () => {
  /** Median of the flush times, in milliseconds of real time. */
  async function flushTimes(backend: FileSystemBackend, existingBytes: number, rounds: number): Promise<number[]> {
    const vfs = createVfs();
    vfs.mount(backend);
    const path = `/${backend.mount}/work/big_OutLog.txt`;
    if (existingBytes > 0) await vfs.writeFile(path, new Uint8Array(existingBytes).fill(0x41));
    const appended: number[] = [];
    const spy = new Proxy(vfs, {
      get(target, prop, receiver) {
        if (prop === 'appendFile') {
          return (p: VPath, data: Bytes) => {
            appended.push(data.length);
            return target.appendFile(p, data);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const time = new VirtualTime(EXAMPLE_DATE);
    let started = false;
    const log = new LogService({
      vfs: spy,
      clock: { now: () => performance.now(), wallTime: () => time.wallTime() },
      scheduler: time,
      invoke: (fn) =>
        fn({
          getOption: (option: number) => (option === 4 ? 1 : 0),
          logDialogOpened: () => {},
          startLog: () => {
            started = true;
            log.logState(true);
          },
          stopLog: () => log.logState(false),
          setOption: () => {},
        } as never),
      askFileExists: async () => 'Append',
    });
    log.setLogFileNames(`/${backend.mount}/work/big.S68`);
    expect(await log.start()).toBe(true);
    expect(started).toBe(true);
    const chunk = new Uint8Array(8 * 1024).fill(0x42);
    const times: number[] = [];
    for (let i = 0; i < rounds; i++) {
      log.outputWrite(chunk);
      const t0 = performance.now();
      await log.flush();
      times.push(performance.now() - t0);
    }
    log.stop();
    await log.flush();
    // Every flush handed the store the new bytes only.
    expect(appended.slice(1).every((length) => length === chunk.length)).toBe(true);
    const stat = await vfs.stat(path);
    expect(stat?.size).toBe(existingBytes + appended.reduce((a, b) => a + b, 0));
    return times;
  }

  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;
  const SMALL = 1024;
  const BIG = 30 * 1024 * 1024;

  for (const [name, make] of [
    ['memory backend', () => new MemoryBackend()],
    [
      'browser store (IndexedDB, fake-indexeddb)',
      async () => BrowserBackend.open({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, channel: null }),
    ],
  ] as const) {
    it(
      `${name}: a 30 MB log costs the same per flush as a small one`,
      async () => {
        // Best of three attempts: the machine is shared, and a timing must not fail merely because
        // of load. The structural check (only new bytes reach appendFile) runs every time.
        let best = Infinity;
        let report = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          const small = median(await flushTimes(await make(), SMALL, 40));
          const big = median(await flushTimes(await make(), BIG, 40));
          const ratio = big / Math.max(small, 0.05);
          report = `small ${small.toFixed(3)} ms, 30 MB ${big.toFixed(3)} ms, ratio ${ratio.toFixed(2)}`;
          console.log(`flush cost, ${name}: ${report}`);
          best = Math.min(best, ratio);
          if (best < 2) break;
        }
        // A file-size dependent flush (rewriting 30 MB) would cost tens of milliseconds and more.
        expect(best, report).toBeLessThan(3);
      },
      LONG,
    );
  }
});
