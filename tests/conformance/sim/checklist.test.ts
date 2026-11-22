// Checklist items that need a person at the original - the Hardware window's buttons and switches,
// Trace Into, typed input - and so have no golden from the Wine oracle: they run headless with
// scripted panel actions and keys (ARCHITECTURE.md 6.4: "hardware §13 ... headless with scripted
// panel actions"; trap15-a §13 Input) and are checked against what the specs dictate.
// Owner: T3 (the hardware items with SH7).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapKind, Reg } from '../../../app/src/contracts';
import { VIRTUAL_FRAME_MS } from '../../../app/src/core/run/clock';
import { createHeadlessSession, type HeadlessAnswers } from '../../../app/src/core/run/headless';
import { MemorySettingsStorage, createSettingsService } from '../../../app/src/core/settings/service';
import { programPathOf } from '../../../app/src/core/sim-host/files/program-files';
import { createSimEngine, releaseSimEngine } from '../../../app/src/engine';
import { assembleProgram } from '../../../app/src/engine/testing';
import { MemoryBackend } from '../../../app/src/fs/memory-backend';
import { createVfs } from '../../../app/src/fs/vfs';
import {
  PROGRAM_DIR,
  createFolderView,
  createWineGlyphs,
  runScenario,
  type AssembledConformance,
  type Scenario,
} from './harness';

const dist = (file: string) => fileURLToPath(new URL(`../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const LONG = 120_000;

/** The address of a label, read from the symbol table of the listing. */
function addressOf(p: AssembledConformance, label: string): number {
  const text = String.fromCharCode(...p.l68);
  const match = new RegExp(`^${label}\\s+([0-9A-F]+)\\s*$`, 'm').exec(text); // the symbol table
  if (!match) throw new Error(`no label ${label} in the listing`);
  return Number.parseInt(match[1] as string, 16);
}

async function program(lines: string[]): Promise<AssembledConformance> {
  const { s68, l68 } = await assembleProgram(lines);
  return { stem: 'program', s68, l68, files: {} };
}

/** Runs `scenario` and records engine values at the given virtual times. */
async function runWithProbes(
  scenario: Scenario,
  probes: Record<string, { atMs: number; read: (s: Parameters<NonNullable<Scenario['onFrame']>>[0]) => number }>,
) {
  const seen: Record<string, number> = {};
  const outcome = await runScenario({
    ...scenario,
    onFrame(session, elapsed) {
      for (const [name, probe] of Object.entries(probes)) {
        if (seen[name] === undefined && elapsed >= probe.atMs) seen[name] = probe.read(session);
      }
    },
  });
  return { outcome, seen };
}

const byte = (address: number) => (s: Parameters<NonNullable<Scenario['onFrame']>>[0]) =>
  s.engine.memory[address] ?? -1;
const reg = (r: Reg) => (s: Parameters<NonNullable<Scenario['onFrame']>>[0]) => s.engine.getRegister(r) >>> 0;

describe.skipIf(!enginesBuilt)('hardware §13 with panel actions (needs engine/dist)', () => {
  it(
    'item 4: a click on switch 3 sets bit 3 of $E00012, a second click clears it, other bits stay',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE.B  #$00,$E00012',
        'LOOP:   BRA     LOOP',
        '        END     START',
      ]);
      const { seen } = await runWithProbes(
        {
          program: p,
          timeLimitMs: 1000,
          actions: [
            { atMs: 100, action: { kind: 'switchClick', bit: 3 } },
            { atMs: 300, action: { kind: 'switchClick', bit: 3 } },
            { atMs: 500, action: { kind: 'pause' } },
          ],
        },
        { afterFirst: { atMs: 200, read: byte(0xe00012) }, afterSecond: { atMs: 400, read: byte(0xe00012) } },
      );
      expect(seen).toEqual({ afterFirst: 0x08, afterSecond: 0x00 });
    },
    LONG,
  );

  it(
    'item 7: holding push button 2 reads $FB, releasing $FF; after the program wrote $00 a press and release gives $04',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  NOP',
        'LOOP:   BRA     LOOP',
        '        END     START',
      ]);
      const { seen } = await runWithProbes(
        {
          program: p,
          timeLimitMs: 1000,
          actions: [
            { atMs: 100, action: { kind: 'pushButton', bit: 2, down: true } },
            { atMs: 300, action: { kind: 'pushButton', bit: 2, down: false } },
            { atMs: 600, action: { kind: 'pause' } },
          ],
        },
        { held: { atMs: 200, read: byte(0xe00014) }, released: { atMs: 400, read: byte(0xe00014) } },
      );
      expect(seen).toEqual({ held: 0xfb, released: 0xff });
      const q = await program([
        '        ORG     $1000',
        'START:  MOVE.B  #$00,$E00014',
        'LOOP:   BRA     LOOP',
        '        END     START',
      ]);
      const second = await runWithProbes(
        {
          program: q,
          timeLimitMs: 1000,
          actions: [
            { atMs: 100, action: { kind: 'pushButton', bit: 2, down: true } },
            { atMs: 200, action: { kind: 'pushButton', bit: 2, down: false } },
            { atMs: 400, action: { kind: 'pause' } },
          ],
        },
        { after: { atMs: 300, read: byte(0xe00014) } },
      );
      expect(second.seen).toEqual({ after: 0x04 });
    },
    LONG,
  );

  it(
    'item 11: exceptions off, an IRQ click on a loaded idle program starts it, adds 44 cycles, enters no handler',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D7',
        '        SIMHALT',
        'HANDLER MOVEQ   #9,D6',
        '        RTE',
        '        ORG     $6C',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        start: false,
        timeLimitMs: 2000,
        actions: [{ atMs: 100, action: { kind: 'irq', level: 3 } }],
      });
      expect(outcome.registers.d[7]).toBe(1);
      expect(outcome.registers.d[6]).toBe(0);
      expect(outcome.cycles).toBe(44 + 4); // the request, then MOVEQ; SIMHALT costs nothing
    },
    LONG,
  );

  it(
    'item 12: exceptions on, mask 0, an IRQ click enters the handler after one more instruction with mask = n, S = 1, T = 0',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE    #$2000,SR',
        'NEXT:   MOVEQ   #1,D7',
        '        SIMHALT',
        'HANDLER MOVE    SR,D6',
        '        MOVE.L  2(SP),D5',
        '        MOVE.W  (SP),D4',
        '        SIMHALT',
        '        ORG     $68',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        start: false,
        exceptions: true,
        timeLimitMs: 2000,
        actions: [{ atMs: 100, action: { kind: 'irq', level: 2 } }],
      });
      expect((outcome.registers.d[6] ?? 0) & 0xffff).toBe(0x2200);
      // MOVE #$2000,SR (4 bytes) ran, then the interrupt: the frame holds the address of NEXT and the old SR.
      expect(outcome.registers.d[5]).toBe(0x1004);
      expect((outcome.registers.d[4] ?? 0) & 0xffff).toBe(0x2000);
      expect(outcome.registers.d[7]).toBe(0);
      expect(outcome.registers.a[7]).toBe(0x01000000 - 6);
    },
    LONG,
  );

  it(
    'item 15: in trace mode an IRQ click runs nothing; the next step lands in the handler',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D0',
        '        MOVEQ   #2,D1',
        '        MOVEQ   #3,D2',
        '        SIMHALT',
        'HANDLER NOP',
        '        RTE',
        '        ORG     $68',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      const { seen } = await runWithProbes(
        {
          program: p,
          start: false,
          exceptions: true,
          timeLimitMs: 1200,
          actions: [
            { atMs: 50, action: { kind: 'traceInto' } },
            { atMs: 150, action: { kind: 'irq', level: 2 } },
            { atMs: 300, action: { kind: 'traceInto' } },
          ],
        },
        { afterClick: { atMs: 250, read: reg(Reg.PC) }, afterStep: { atMs: 400, read: reg(Reg.PC) } },
      );
      expect(seen.afterClick).toBe(0x1002); // nothing ran after the click
      // The step executes MOVEQ #2,D1 and then takes the interrupt: the PC is the handler's.
      expect(seen.afterStep).toBe(0x100a);
    },
    LONG,
  );

  it(
    'item 20: STOP with exceptions on halts with its message; an IRQ click resumes; the stacked PC is the second instruction after STOP',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  STOP    #$2000',
        'FIRST:  MOVEQ   #1,D7',
        'SECOND: MOVEQ   #2,D6',
        '        SIMHALT',
        'HANDLER MOVE.L  2(SP),D5',
        '        RTE',
        '        ORG     $68',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        exceptions: true,
        timeLimitMs: 2000,
        actions: [{ atMs: 200, action: { kind: 'irq', level: 2 } }],
      });
      expect(outcome.messages).toContain('STOP instruction. Execution halted');
      expect(outcome.registers.d[5]).toBe(0x1006); // SECOND: FIRST ran before the handler (quirk)
      expect(outcome.registers.d[7]).toBe(1);
      expect(outcome.registers.d[6]).toBe(2);
    },
    LONG,
  );

  it(
    'item 21: STOP with exceptions off prints its message with the location and IRQ clicks do nothing',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  STOP    #$2000',
        '        MOVEQ   #1,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        timeLimitMs: 2000,
        actions: [{ atMs: 200, action: { kind: 'irq', level: 7 } }],
      });
      expect(
        outcome.messages.some((m) => /^STOP instruction executed at location 100[04]\. Execution halted$/i.test(m)),
      ).toBe(true);
      expect(outcome.registers.d[7]).toBe(0);
    },
    LONG,
  );

  it(
    'item 22: after SIMHALT an IRQ click delivers nothing and starts nothing',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE    #$2000,SR',
        '        SIMHALT',
        '        MOVEQ   #1,D7',
        'HANDLER MOVEQ   #9,D6',
        '        RTE',
        '        ORG     $68',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        exceptions: true,
        timeLimitMs: 2000,
        actions: [{ atMs: 300, action: { kind: 'irq', level: 2 } }],
      });
      expect(outcome.registers.d[6]).toBe(0);
      expect(outcome.registers.d[7]).toBe(0);
    },
    LONG,
  );

  it(
    'item 23: Reset loads SSP and PC from vectors 0 and 4, SR = $2700, adds 84 cycles, keeps D and A registers, and the program runs',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE.L  #$00010000,$0',
        '        MOVE.L  #$00002000,$4',
        '        MOVE.L  #$1234,D3',
        'LOOP:   BRA     LOOP',
        '        ORG     $2000',
        'AFTER:  MOVE    SR,D4',
        '        SIMHALT',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        timeLimitMs: 2000,
        actions: [{ atMs: 200, action: { kind: 'hwReset' } }],
      });
      expect(outcome.registers.a[7]).toBe(0x00010000);
      expect((outcome.registers.d[4] ?? 0) & 0xffff).toBe(0x2700);
      expect(outcome.registers.d[3]).toBe(0x1234);
      expect(outcome.registers.pc).toBe(0x2006);
    },
    LONG,
  );
});

describe.skipIf(!enginesBuilt)('trap15-a §13 Input with typed keys (needs engine/dist)', () => {
  const input = (task: number) => [
    '        ORG     $1000',
    'START:  MOVE.L  #$FFFFFFFF,D1',
    '        LEA     BUF,A1',
    `        MOVEQ   #${task},D0`,
    '        TRAP    #15',
    '        SIMHALT',
    'BUF:    DCB.B   84,$EE',
    '        END     START',
  ];

  it(
    'task 2: abc Enter stores 61 62 63 00 and D1.L = 3; ab, Backspace, c gives ac; 79 characters then any key end the input',
    async () => {
      const p = await program(input(2));
      const buf = addressOf(p, 'BUF');
      const bufAt = (outcome: Awaited<ReturnType<typeof runScenario>>) => outcome.memory.get(buf) ?? new Uint8Array();
      const abc = await runScenario({ program: p, keys: ['abc\n'], capture: [{ address: buf, length: 84 }] });
      expect(abc.registers.d[1]).toBe(3);
      expect([...bufAt(abc).subarray(0, 5)]).toEqual([0x61, 0x62, 0x63, 0x00, 0xee]);
      const edited = await runScenario({ program: p, keys: ['ab\bc\n'], capture: [{ address: buf, length: 84 }] });
      expect(edited.registers.d[1]).toBe(2);
      expect([...bufAt(edited).subarray(0, 3)]).toEqual([0x61, 0x63, 0x00]);
      const long = await runScenario({
        program: p,
        keys: [`${'x'.repeat(79)}y`],
        capture: [{ address: buf, length: 84 }],
      });
      expect(long.end).toBe('halted');
      expect(long.registers.d[1]).toBe(79);
      expect(bufAt(long)[79]).toBe(0);
    },
    LONG,
  );

  it(
    'task 4: 123 -> 123, -45 -> $FFFFFFD3, 12x -> 12, x -> 0, empty -> 0, $10 -> 0',
    async () => {
      const p = await program(input(4));
      const cases: [string, number][] = [
        ['123\n', 123],
        ['-45\n', 0xffffffd3],
        ['12x\n', 12],
        ['x\n', 0],
        ['\n', 0],
        ['$10\n', 0],
      ];
      for (const [typed, value] of cases) {
        const outcome = await runScenario({ program: p, keys: [typed] });
        expect(outcome.registers.d[1], JSON.stringify(typed)).toBe(value);
      }
    },
    LONG,
  );

  it(
    'task 5: Enter gives D1.B = $0D, keeps bits 31..8 and moves to column 0 of the next row (same row after task 16 D1.B = 2)',
    async () => {
      const lines = (lfOff: boolean) => [
        '        ORG     $1000',
        'START:  LEA     AB,A1',
        '        MOVEQ   #14,D0',
        '        TRAP    #15',
        ...(lfOff ? ['        MOVEQ   #2,D1', '        MOVEQ   #16,D0', '        TRAP    #15'] : []),
        '        MOVE.L  #$12345600,D1',
        '        MOVEQ   #5,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        '        MOVE.W  #$00FF,D1',
        '        MOVEQ   #11,D0',
        '        TRAP    #15',
        '        SIMHALT',
        "AB:     DC.B    'AB',0",
        '        END     START',
      ];
      const normal = await runScenario({ program: await program(lines(false)), keys: ['\n'] });
      expect(normal.registers.d[7]).toBe(0x1234560d);
      expect((normal.registers.d[1] ?? 0) & 0xffff).toBe(0x0001);
      const sameRow = await runScenario({ program: await program(lines(true)), keys: ['\n'] });
      expect((sameRow.registers.d[1] ?? 0) & 0xffff).toBe(0x0000);
    },
    LONG,
  );
});

/** True when a message line reports a bus error (hardware §4.3 with exceptions off). */
const busError = (outcome: Awaited<ReturnType<typeof runScenario>>) =>
  outcome.messages.some((m) => /^Bus Error/i.test(m));

describe.skipIf(!enginesBuilt)('hardware §13 interrupts and the memory map (needs engine/dist)', () => {
  it(
    'item 25: exceptions off, after "Illegal instruction found" an IRQ click resumes after the offending word',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D6',
        '        DC.W    $4AFC',
        '        MOVEQ   #2,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        timeLimitMs: 2000,
        actions: [{ atMs: 300, action: { kind: 'irq', level: 3 } }],
      });
      expect(outcome.messages.some((m) => /^Illegal instruction found at location/i.test(m))).toBe(true);
      expect(outcome.registers.d[6]).toBe(1);
      expect(outcome.registers.d[7]).toBe(2);
      expect(outcome.end).toBe('halted');
    },
    LONG,
  );

  it(
    'item 26: exceptions off, an IRQ latched during the run is taken at the end of TRAP #15 task 32/5, stacking the PC after the TRAP',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE    #$2000,SR',
        '        MOVE.L  #200000,D2',
        'LOOP:   SUBQ.L  #1,D2',
        '        BNE     LOOP',
        '        MOVE.B  #5,D1',
        '        MOVE.B  #32,D0',
        '        TRAP    #15',
        'AFTER:  MOVEQ   #1,D7',
        '        SIMHALT',
        'HANDLER MOVE.L  2(SP),D5',
        '        MOVEQ   #9,D6',
        '        RTE',
        '        ORG     $68',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        timeLimitMs: 5000,
        actions: [{ atInstruction: 1000, action: { kind: 'irq', level: 2 } }],
      });
      expect(outcome.registers.d[2]).toBe(0); // the click came while the loop ran
      expect(outcome.registers.d[6]).toBe(9);
      expect(outcome.registers.d[5]).toBe(addressOf(p, 'AFTER'));
      expect(outcome.registers.d[7]).toBe(1);
    },
    LONG,
  );

  it(
    'item 27: exceptions on, an SSP inside ROM: the handler is entered, the six stack bytes stay',
    async () => {
      const p = await program([
        '        MEMORY  ROM $8000,$8FFF',
        '        ORG     $1000',
        'START:  LEA     $8100,SP',
        'LOOP:   BRA     LOOP',
        'HANDLER MOVEQ   #9,D6',
        '        SIMHALT',
        '        ORG     $80FA',
        '        DC.B    1,2,3,4,5,6',
        '        ORG     $68',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        exceptions: true,
        timeLimitMs: 2000,
        actions: [{ atMs: 200, action: { kind: 'irq', level: 2 } }],
        capture: [{ address: 0x80fa, length: 6 }],
      });
      expect(outcome.registers.d[6]).toBe(9);
      expect([...(outcome.memory.get(0x80fa) ?? [])]).toEqual([1, 2, 3, 4, 5, 6]);
      expect(outcome.registers.a[7]).toBe(0x8100 - 6);
    },
    LONG,
  );

  it(
    'item 27: exceptions on, a 16-byte Read range right below the SSP: the IRQ handler is entered, 200 cycles on top of 78, SSP 62 bytes lower',
    async () => {
      const p = await program([
        '        MEMORY  READ $80F0,$80FF',
        '        ORG     $1000',
        'START:  LEA     $8100,SP',
        'HANDLER MOVEQ   #9,D6',
        '        SIMHALT',
        '        ORG     $68',
        '        DC.L    HANDLER',
        '        END     START',
      ]);
      // As in item 12: a click on the loaded, idle program runs one instruction, then the interrupt.
      const outcome = await runScenario({
        program: p,
        start: false,
        exceptions: true,
        timeLimitMs: 2000,
        actions: [{ atMs: 100, action: { kind: 'irq', level: 2 } }],
      });
      expect(outcome.registers.d[6]).toBe(9); // its own handler, not the bus-error vector
      expect(outcome.registers.a[7]).toBe(0x8100 - 62);
      // LEA (abs).L, the interrupt, four nested faults, the handler's MOVEQ (SIMHALT costs nothing).
      expect(outcome.cycles).toBe(12 + 78 + 200 + 4);
    },
    LONG,
  );

  it(
    'item 31: Read range: a write raises a bus error (vector $8 with exceptions on; message and halt with them off); reads work',
    async () => {
      const lines = (write: boolean) => [
        '        MEMORY  READ $9000,$9FFF',
        '        ORG     $1000',
        'START:  MOVE.B  $9000,D3',
        '        MOVEQ   #1,D6',
        ...(write ? ['        MOVE.B  D3,$9000'] : []),
        '        MOVEQ   #2,D7',
        '        SIMHALT',
        'BUSERR  MOVEQ   #8,D5',
        '        SIMHALT',
        '        ORG     $8',
        '        DC.L    BUSERR',
        '        ORG     $9000',
        '        DC.B    $5A',
        '        END     START',
      ];
      const read = await runScenario({ program: await program(lines(false)), timeLimitMs: 2000 });
      expect(busError(read)).toBe(false);
      expect(read.registers.d[3]).toBe(0x5a);
      expect(read.registers.d[7]).toBe(2);
      const off = await runScenario({ program: await program(lines(true)), timeLimitMs: 2000 });
      expect(off.messages.some((m) => /^Bus Error: Instruction at .* accessing address /i.test(m))).toBe(true);
      expect(off.registers.d[6]).toBe(1);
      expect(off.registers.d[7]).toBe(0);
      expect(off.end).toBe('halted');
      const on = await runScenario({ program: await program(lines(true)), exceptions: true, timeLimitMs: 2000 });
      expect(on.registers.d[5]).toBe(8);
      expect(on.registers.d[7]).toBe(0);
      expect(busError(on)).toBe(false);
    },
    LONG,
  );

  it(
    'item 32: Invalid range: reads and writes in it raise a bus error; a long read 2 bytes below does not, a long write 2 bytes below does',
    async () => {
      const access = (instruction: string) => [
        '        MEMORY  INVALID $A000,$AFFF',
        '        ORG     $1000',
        `START:  ${instruction}`,
        '        MOVEQ   #2,D7',
        '        SIMHALT',
        '        END     START',
      ];
      const cases: [string, boolean][] = [
        ['MOVE.B  $A000,D0', true],
        ['MOVE.B  D0,$AFFF', true],
        ['MOVE.L  $9FFE,D0', false],
        ['MOVE.L  D0,$9FFE', true],
      ];
      for (const [instruction, faults] of cases) {
        const outcome = await runScenario({ program: await program(access(instruction)), timeLimitMs: 2000 });
        expect(busError(outcome), instruction).toBe(faults);
        expect(outcome.registers.d[7], instruction).toBe(faults ? 0 : 2);
      }
    },
    LONG,
  );

  it(
    'item 33: Protected range: a Run started in supervisor mode can still access it from user mode; single-stepping the same code faults',
    async () => {
      const p = await program([
        '        MEMORY  PROTECTED $9000,$9FFF',
        '        ORG     $1000',
        'START:  MOVE    #$0000,SR',
        '        MOVE.B  $9000,D3',
        '        MOVEQ   #2,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      const run = await runScenario({ program: p, timeLimitMs: 2000 });
      expect(busError(run)).toBe(false);
      expect(run.registers.d[7]).toBe(2);
      const stepped = await runScenario({
        program: p,
        start: false,
        timeLimitMs: 2000,
        actions: [
          { atMs: 50, action: { kind: 'traceInto' } },
          { atMs: 150, action: { kind: 'traceInto' } },
          { atMs: 250, action: { kind: 'traceInto' } },
          { atMs: 350, action: { kind: 'traceInto' } },
        ],
      });
      expect(busError(stepped)).toBe(true);
      expect(stepped.registers.d[7]).toBe(0);
    },
    LONG,
  );
});

describe.skipIf(!enginesBuilt)('sim-ui §19 quirks that affect results (needs engine/dist)', () => {
  it(
    'Q3: a running program that reaches address 0 is paused there with no message; Run continues from address 0',
    async () => {
      const p = await program([
        '        ORG     0',
        'ZERO:   MOVEQ   #7,D7',
        '        SIMHALT',
        '        ORG     $1000',
        'START:  MOVEQ   #1,D6',
        '        JMP     ZERO',
        '        END     START',
      ]);
      const paused = await runScenario({ program: p, timeLimitMs: 2000 });
      const loaded = await runScenario({ program: p, start: false, timeLimitMs: 500 });
      expect(paused.end).toBe('stopped');
      expect(paused.registers.pc).toBe(0);
      expect(paused.registers.d[6]).toBe(1);
      expect(paused.registers.d[7]).toBe(0);
      expect(paused.messages).toEqual(loaded.messages); // no message of its own
      const resumed = await runScenario({
        program: p,
        timeLimitMs: 3000,
        actions: [{ whenIdle: true, action: { kind: 'run' } }],
      });
      expect(resumed.registers.d[7]).toBe(7);
      expect(resumed.end).toBe('halted');
    },
    LONG,
  );

  it(
    'Q10: Rewind keeps memory; a file left open is forgotten without being closed (its buffered bytes are not written)',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  ADDQ.B  #1,COUNT',
        '        MOVE.B  COUNT,D7',
        '        LEA     NAME,A1',
        '        MOVEQ   #52,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D6',
        '        LEA     DATA,A1',
        '        MOVEQ   #10,D2',
        '        MOVEQ   #54,D0',
        '        TRAP    #15',
        '        SIMHALT',
        "NAME:   DC.B    'open.bin',0",
        "DATA:   DC.B    '0123456789'",
        'COUNT:  DC.B    0',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        parts: 'final', // the 512-byte stream buffer of 3.8.4 is the real ProgramFiles'
        timeLimitMs: 5000,
        actions: [
          { whenIdle: true, action: { kind: 'rewind' } },
          { atMs: 2000, action: { kind: 'run' } },
        ],
      });
      expect(outcome.registers.d[7]).toBe(2); // COUNT kept its 1 across the Rewind
      expect(outcome.files['open.bin']?.length).toBe(0); // created, written into the buffer, never closed
    },
    LONG,
  );

  it(
    'Q24: Rewind writes its note to the output log only after the Log Output dialog was shown with a non-zero type',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  LEA     HELLO,A1',
        '        MOVEQ   #14,D0',
        '        TRAP    #15',
        'LOOP:   BRA     LOOP',
        "HELLO:  DC.B    'Hello',0",
        '        END     START',
      ]);
      const note = '***** Reset Program Pressed *****';
      const scenario: Scenario = {
        program: p,
        recipe: { kind: 'outlog' },
        timeLimitMs: 2000,
        actions: [{ atMs: 300, action: { kind: 'rewind' } }],
      };
      for (const parts of ['doubles', 'final'] as const) {
        const silent = await runScenario({ ...scenario, parts });
        const silentLog = String.fromCharCode(...(silent.outputLog ?? []));
        expect(silentLog, parts).toContain('Hello');
        expect(silentLog, parts).not.toContain(note);
        const shown = await runScenario({ ...scenario, parts, logDialogShown: true });
        expect(String.fromCharCode(...(shown.outputLog ?? [])), parts).toContain(`Hello\n${note}\n`);
      }
    },
    LONG,
  );
});

/* ------------------------------------------------------------------------------------------------
 * Round I3 (ARCHITECTURE.md 6.9 item 2): the checklist items the release-candidate evidence found
 * without a test or with only a partial one (build/I3/item-02.md section 5). Each test names its item.
 * ---------------------------------------------------------------------------------------------- */

type Session = Parameters<NonNullable<Scenario['onFrame']>>[0];

interface KeyStep {
  key: string;
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  /** Only the key-down (the key stays held). */
  hold?: boolean;
  /** Only the key-up. */
  release?: boolean;
}

/** One key as the Output panel delivers it: key-down, a frame, key-up, a frame. */
function pressKey(s: Session, step: KeyStep): void {
  const event = {
    key: step.key,
    code: step.code,
    ctrlKey: step.ctrlKey ?? false,
    shiftKey: step.shiftKey ?? false,
    altKey: false,
    metaKey: false,
    repeat: false,
  };
  if (!step.release) s.keyboard.keydown(event, false);
  s.time.advance(VIRTUAL_FRAME_MS);
  if (step.hold) return;
  s.keyboard.keyup(event);
  s.time.advance(VIRTUAL_FRAME_MS);
}

const letter = (ch: string): KeyStep => ({ key: ch, code: `Key${ch.toUpperCase()}` });
const ENTER: KeyStep = { key: 'Enter', code: 'Enter' };
const BACKSPACE: KeyStep = { key: 'Backspace', code: 'Backspace' };
const CTRL_I: KeyStep = { key: 'i', code: 'KeyI', ctrlKey: true };

/** An onFrame that presses keys at given virtual times (ms after the start), whatever the program does. */
function keysAt(plan: { atMs: number; step: KeyStep }[]): NonNullable<Scenario['onFrame']> {
  const pending = [...plan];
  return (s, elapsed) => {
    while (pending.length > 0 && elapsed >= (pending[0] as { atMs: number }).atMs) {
      pressKey(s, (pending.shift() as { step: KeyStep }).step);
    }
  };
}

/** Task 11 with D1.W = $00FF: afterwards D1.W = column << 8 | row. */
const CURSOR_TO_D1 = ['        MOVE.W  #$00FF,D1', '        MOVEQ   #11,D0', '        TRAP    #15'];

const text = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

/** A session of the real parts with programs in one folder, for items that need two loads or none. */
async function openSession(
  programs: Record<string, AssembledConformance>,
  options: {
    exceptions?: boolean;
    bitField?: boolean;
    settings?: Scenario['settings'];
    answers?: HeadlessAnswers;
  } = {},
) {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend());
  for (const [stem, p] of Object.entries(programs)) {
    await vfs.writeFile(`${PROGRAM_DIR}/${stem}.S68`, p.s68);
    await vfs.writeFile(`${PROGRAM_DIR}/${stem}.L68`, p.l68);
  }
  const view = createFolderView({});
  const glyphs = createWineGlyphs();
  await glyphs.ready;
  const session = await createHeadlessSession({
    engines: { create: createSimEngine, release: releaseSimEngine },
    vfs,
    viewFor: () => view,
    glyphs,
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.answers ? { answers: options.answers } : {}),
    commandLine: { exceptions: options.exceptions ?? false, bitField: options.bitField ?? false },
  });
  const path = (stem: string) => `${PROGRAM_DIR}/${stem}.S68`;
  const settle = (ms = 2000) => session.runUntilIdle(ms);
  const d = (n: number) => session.engine.getRegister((Reg.D0 + n) as Reg) >>> 0;
  return { session, path, settle, d };
}

type OpenSession = Awaited<ReturnType<typeof openSession>>['session'];

/**
 * Lets virtual time pass frame by frame and yields to the event loop between frames, so that an
 * asynchronous host answer (the file dialog of task 58) arrives, until the program has halted.
 * Returns false when it has not halted within `limitMs` of virtual time.
 */
async function settleAsync(session: OpenSession, limitMs = 5000): Promise<boolean> {
  for (let elapsed = 0; elapsed < limitMs; elapsed += VIRTUAL_FRAME_MS) {
    if (session.controller.snapshot.halted) return true;
    session.time.advance(VIRTUAL_FRAME_MS);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return session.controller.snapshot.halted;
}

describe.skipIf(!enginesBuilt)('trap15-a §13 Input, round I3 (needs engine/dist)', () => {
  it(
    'input-3: Backspace on an empty line does nothing: no pixel, no cursor move, and the line is what follows',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  LEA     AB,A1',
        '        MOVEQ   #14,D0',
        '        TRAP    #15',
        '        LEA     BUF,A1',
        '        MOVEQ   #2,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        ...CURSOR_TO_D1,
        '        SIMHALT',
        "AB:     DC.B    'AB',0",
        'BUF:    DCB.B   84,$EE',
        '        END     START',
      ]);
      const buf = addressOf(p, 'BUF');
      // Waiting with nothing typed, and waiting after two Backspaces: the same picture, the same cursor.
      // Windows' glyphs (metrics 'windows'), so that a glyph drawn or erased changes the pixels.
      const waiting = await runScenario({ program: p, keys: [], metrics: 'windows' });
      const backspaced = await runScenario({ program: p, keys: [[BACKSPACE, BACKSPACE]], metrics: 'windows' });
      expect(waiting.end).toBe('waiting for input');
      expect(backspaced.end).toBe('waiting for input');
      expect(backspaced.cursor).toEqual({ row: 0, col: 2 });
      expect(backspaced.cursor).toEqual(waiting.cursor);
      expect(backspaced.surfaceHash).toBe(waiting.surfaceHash);
      expect(backspaced.textRows).toEqual(waiting.textRows);
      const outcome = await runScenario({
        program: p,
        keys: [[BACKSPACE, BACKSPACE, letter('x'), ENTER]],
        capture: [{ address: buf, length: 4 }],
      });
      expect(outcome.end).toBe('halted');
      expect(outcome.registers.d[7]).toBe(1);
      expect([...(outcome.memory.get(buf) ?? [])]).toEqual([0x78, 0x00, 0xee, 0xee]);
      expect((outcome.registers.d[1] ?? 0) & 0xffff).toBe(0x0001); // Enter: column 0 of row 1
    },
    LONG,
  );

  it(
    'input-4: task 2 after task 16 with D1.B = 2: Enter still moves to column 0 of the next row',
    async () => {
      const lines = (lfOff: boolean) => [
        '        ORG     $1000',
        'START:  LEA     AB,A1',
        '        MOVEQ   #14,D0',
        '        TRAP    #15',
        ...(lfOff ? ['        MOVEQ   #2,D1', '        MOVEQ   #16,D0', '        TRAP    #15'] : []),
        '        LEA     BUF,A1',
        '        MOVEQ   #2,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        ...CURSOR_TO_D1,
        '        SIMHALT',
        "AB:     DC.B    'AB',0",
        'BUF:    DS.B    84',
        '        END     START',
      ];
      for (const lfOff of [false, true]) {
        const outcome = await runScenario({ program: await program(lines(lfOff)), keys: ['c\n'] });
        expect(outcome.registers.d[7], `task 16 D1.B = 2: ${lfOff}`).toBe(1);
        expect((outcome.registers.d[1] ?? 0) & 0xffff, `task 16 D1.B = 2: ${lfOff}`).toBe(0x0001);
      }
    },
    LONG,
  );

  it(
    'input-7: a key during a task 23 delay: task 7 gives 1, task 5 returns it at once, task 7 then 0; of three keys only the last',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #100,D1',
        '        MOVEQ   #23,D0',
        '        TRAP    #15',
        '        MOVE.L  #$12345600,D1',
        '        MOVEQ   #7,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        '        MOVE.L  #$ABCDEF00,D1',
        '        MOVEQ   #5,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D6',
        '        MOVE.L  #$12345600,D1',
        '        MOVEQ   #7,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D5',
        '        SIMHALT',
        '        END     START',
      ]);
      const one = await runScenario({ program: p, onFrame: keysAt([{ atMs: 200, step: letter('k') }]) });
      expect(one.end).toBe('halted'); // task 5 did not wait
      expect(one.registers.d[7]).toBe(0x12345601);
      expect(one.registers.d[6]).toBe(0xabcdef6b);
      expect(one.registers.d[5]).toBe(0x12345600);
      const three = await runScenario({
        program: p,
        onFrame: keysAt([
          { atMs: 200, step: letter('a') },
          { atMs: 300, step: letter('b') },
          { atMs: 400, step: letter('c') },
        ]),
      });
      expect(three.end).toBe('halted');
      expect(three.registers.d[6]).toBe(0xabcdef63); // 'c'
      expect(three.registers.d[5]).toBe(0x12345600);
    },
    LONG,
  );

  it(
    "input-12: task 19 with D1 = 'ASDF' while S is held gives $00FF0000; with D1 = 0 after Q pressed and released, $00510051",
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #30,D1',
        '        MOVEQ   #23,D0',
        '        TRAP    #15',
        "        MOVE.L  #'ASDF',D1",
        '        MOVEQ   #19,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        '        MOVEQ   #30,D1',
        '        MOVEQ   #23,D0',
        '        TRAP    #15',
        '        MOVEQ   #0,D1',
        '        MOVEQ   #19,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D6',
        '        SIMHALT',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        onFrame: keysAt([
          { atMs: 100, step: { ...letter('s'), hold: true } },
          { atMs: 400, step: { ...letter('s'), release: true } },
          { atMs: 450, step: letter('q') },
        ]),
      });
      expect(outcome.end).toBe('halted');
      expect(outcome.registers.d[7]).toBe(0x00ff0000);
      expect(outcome.registers.d[6]).toBe(0x00510051);
    },
    LONG,
  );

  it(
    'input-14, the part a session shows: Run of a program that reads a line brings the Output panel forward, and typed keys reach task 2 without a click',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  LEA     BUF,A1',
        '        MOVEQ   #2,D0',
        '        TRAP    #15',
        '        SIMHALT',
        'BUF:    DS.B    84',
        '        END     START',
      ]);
      const outcome = await runScenario({ program: p, keys: ['ok\n'] });
      expect(outcome.registers.d[1]).toBe(2);
      expect(outcome.uiLog.some((entry) => entry === 'bringOutputToFront' || entry === 'showOutput')).toBe(true);
      expect(outcome.uiLog).toContain('inputStarted');
    },
    LONG,
  );

  it(
    'input-15: Ctrl+I in task 2 is echoed as one glyph, the cursor advances one column, $09 is stored; task 5 Ctrl+I gives $09 and the cursor moves five columns',
    async () => {
      const line = await program([
        '        ORG     $1000',
        'START:  LEA     BUF,A1',
        '        MOVEQ   #2,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        '        SIMHALT',
        'BUF:    DCB.B   84,$EE',
        '        END     START',
      ]);
      const buf = addressOf(line, 'BUF');
      const typed = await runScenario({
        program: line,
        keys: [[CTRL_I, letter('x'), ENTER]],
        capture: [{ address: buf, length: 4 }],
      });
      expect(typed.end).toBe('halted');
      expect(typed.registers.d[7]).toBe(2);
      expect([...(typed.memory.get(buf) ?? [])]).toEqual([0x09, 0x78, 0x00, 0xee]);
      // While the line is still open: Ctrl+I took one cell and moved the cursor one column. (What
      // the glyph of $09 looks like is the font's, layer L5 of 6.1; its pixels are not compared here.)
      const waiting = await runScenario({ program: line, keys: [] });
      const echoed = await runScenario({ program: line, keys: [[CTRL_I]] });
      expect(echoed.end).toBe('waiting for input');
      expect(waiting.cursor).toEqual({ row: 0, col: 0 });
      expect(echoed.cursor).toEqual({ row: 0, col: 1 });
      const key = await program([
        '        ORG     $1000',
        'START:  MOVE.L  #$12345600,D1',
        '        MOVEQ   #5,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        ...CURSOR_TO_D1,
        '        SIMHALT',
        '        END     START',
      ]);
      const read = await runScenario({ program: key, keys: [[CTRL_I]] });
      expect(read.end).toBe('halted');
      expect(read.registers.d[7]).toBe(0x12345609);
      expect((read.registers.d[1] ?? 0) & 0xffff).toBe(0x0500); // column 5, row 0
    },
    LONG,
  );

  it(
    'input-18: task 2 with A1 = $FFFFFE: abc Enter lands at $FFFFFE, $FFFFFF, $000000, $000001 (24-bit wrap)',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEA.L #$FFFFFE,A1',
        '        MOVEQ   #2,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        keys: ['abc\n'],
        capture: [
          { address: 0xfffffe, length: 2 },
          { address: 0, length: 2 },
        ],
      });
      expect(outcome.registers.d[7]).toBe(3);
      expect([...(outcome.memory.get(0xfffffe) ?? [])]).toEqual([0x61, 0x62]);
      expect([...(outcome.memory.get(0) ?? [])]).toEqual([0x63, 0x00]);
    },
    LONG,
  );
});

describe.skipIf(!enginesBuilt)('trap15-a §13 Files and Memory map, round I3 (needs engine/dist)', () => {
  it(
    'files-4: task 51 on a read-only file gives 3 and a valid FID; task 53 reads through it; task 54 gives 2',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  LEA     NAME,A1',
        '        MOVE.L  #$ABCD0033,D0',
        '        TRAP    #15',
        '        MOVE.L  D0,D7',
        '        MOVE.L  D1,D6',
        '        LEA     BUF,A1',
        '        MOVEQ   #5,D2',
        '        MOVE.L  #$ABCD0035,D0',
        '        TRAP    #15',
        '        MOVE.L  D0,D5',
        '        MOVE.L  D2,D4',
        '        MOVE.L  D6,D1',
        '        LEA     BUF,A1',
        '        MOVEQ   #2,D2',
        '        MOVE.L  #$ABCD0036,D0',
        '        TRAP    #15',
        '        MOVE.L  D0,D3',
        '        MOVE.L  D6,D1',
        '        MOVEQ   #56,D0',
        '        TRAP    #15',
        '        SIMHALT',
        "NAME:   DC.B    'ro.txt',0",
        'BUF:    DCB.B   8,$EE',
        '        END     START',
      ]);
      const buf = addressOf(p, 'BUF');
      const outcome = await runScenario({
        program: p,
        folder: { 'ro.txt': { data: text('hello'), readOnly: true } },
        capture: [{ address: buf, length: 6 }],
      });
      expect(outcome.end).toBe('halted');
      expect(outcome.registers.d[7]).toBe(0xabcd0003);
      expect(outcome.registers.d[6]).toBeLessThan(8); // a valid FID
      expect(outcome.registers.d[5]).toBe(0xabcd0000);
      expect(outcome.registers.d[4]).toBe(5);
      expect([...(outcome.memory.get(buf) ?? [])]).toEqual([...text('hello'), 0xee]);
      expect(outcome.registers.d[3]).toBe(0xabcd0002);
      expect([...(outcome.files['ro.txt'] ?? [])]).toEqual([...text('hello')]); // nothing written
    },
    LONG,
  );

  it(
    'files-11: task 59 on a writable file 0, on a read-only file 3, on a missing file 2; D1 unchanged',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE.L  #$13572468,D1',
        '        LEA     RW,A1',
        '        MOVE.L  #$ABCD003B,D0',
        '        TRAP    #15',
        '        MOVE.L  D0,D7',
        '        LEA     RO,A1',
        '        MOVE.L  #$ABCD003B,D0',
        '        TRAP    #15',
        '        MOVE.L  D0,D6',
        '        LEA     NONE,A1',
        '        MOVE.L  #$ABCD003B,D0',
        '        TRAP    #15',
        '        MOVE.L  D0,D5',
        '        SIMHALT',
        "RW:     DC.B    'rw.txt',0",
        "RO:     DC.B    'ro.txt',0",
        "NONE:   DC.B    'none.txt',0",
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        folder: { 'rw.txt': { data: text('a') }, 'ro.txt': { data: text('b'), readOnly: true } },
      });
      expect(outcome.end).toBe('halted');
      expect(outcome.registers.d[7]).toBe(0xabcd0000);
      expect(outcome.registers.d[6]).toBe(0xabcd0003);
      expect(outcome.registers.d[5]).toBe(0xabcd0002);
      expect(outcome.registers.d[1]).toBe(0x13572468);
      expect(Object.keys(outcome.files).sort()).toEqual(['ro.txt', 'rw.txt']); // nothing created
    },
    LONG,
  );

  it(
    'files-15: task 58 OK: D1 = 1, the path at (A3) and zeros after it up to offset 255; byte 256 untouched',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #0,D1',
        '        MOVEA.L #0,A1',
        '        MOVEA.L #0,A2',
        '        LEA     BUF,A3',
        '        MOVEQ   #58,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        '        SIMHALT',
        'BUF:    DCB.B   260,$EE',
        '        END     START',
      ]);
      const buf = addressOf(p, 'BUF');
      // The real ProgramFiles (SH6) and the real run controller: task 58 asks the session's
      // showFileDialog, which answers asynchronously as the application's dialog does, and the program
      // waits for the reply (no double).
      const chosen = `${PROGRAM_DIR}/chosen.txt`;
      const asked: string[] = [];
      const { session, path, d } = await openSession(
        { p },
        {
          answers: {
            fileDialog: (mode, title, filter, initialName) => {
              asked.push(JSON.stringify({ mode, title, filter, initialName }));
              return chosen;
            },
          },
        },
      );
      try {
        await session.controller.open(path('p'), 'open');
        session.runUntilIdle(2000);
        session.controller.run();
        expect(await settleAsync(session), 'the program ends after the dialog answered').toBe(true);
        expect(asked).toHaveLength(1); // the dialog was asked, once
        expect(d(7)).toBe(1);
        const bytes = [...session.engine.memory.slice(buf, buf + 260)];
        const end = bytes.indexOf(0);
        // The path at (A3) is exactly what the real part posts: the chosen file's program path.
        expect(String.fromCharCode(...bytes.slice(0, end))).toBe(programPathOf(chosen));
        expect(bytes.slice(end, 256).every((b) => b === 0)).toBe(true);
        expect(bytes.slice(256)).toEqual([0xee, 0xee, 0xee, 0xee]);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'map-1: MEMORY INVALID $8000, exceptions off: task 14 at $8000 and task 13 at $7FFE halt with the bus-error message naming the first byte; an empty string raises nothing',
    async () => {
      const lines = (call: string[], data: string) => [
        '        MEMORY  INVALID $8000,$8FFF',
        '        ORG     $1000',
        ...call.map((l) => `        ${l}`),
        'AT:     TRAP    #15',
        '        MOVEQ   #2,D7',
        '        SIMHALT',
        '        ORG     $7FFE',
        `        DC.B    ${data}`,
        '        END     $1000',
      ];
      const cases: { name: string; call: string[]; data: string; address: string | null }[] = [
        {
          name: 'task 14 at $8000',
          call: ['LEA     $8000,A1', 'MOVEQ   #14,D0'],
          data: "'xy','ABC',0",
          address: '8000',
        },
        { name: 'task 13 at $7FFE', call: ['LEA     $7FFE,A1', 'MOVEQ   #13,D0'], data: "'ABCD',0", address: '7ffe' },
        { name: 'empty string at $8000', call: ['LEA     $8000,A1', 'MOVEQ   #14,D0'], data: "'xy',0", address: null },
      ];
      for (const c of cases) {
        const p = await program(lines(c.call, c.data));
        const outcome = await runScenario({ program: p, timeLimitMs: 2000 });
        const at = addressOf(p, 'AT').toString(16);
        if (c.address === null) {
          expect(busError(outcome), c.name).toBe(false);
          expect(outcome.registers.d[7], c.name).toBe(2);
          continue;
        }
        const index = outcome.messages.findIndex((m) =>
          new RegExp(`^Bus Error: Instruction at 0*${at} accessing address 0*${c.address}$`, 'i').test(m),
        );
        expect(index, `${c.name}: ${JSON.stringify(outcome.messages)}`).toBeGreaterThanOrEqual(0);
        expect(outcome.messages[index + 1], c.name).toBe('Execution halted');
        expect(outcome.end, c.name).toBe('halted');
        expect(outcome.registers.d[7], c.name).toBe(0);
        expect(
          outcome.textRows.every((row) => row.trim() === ''),
          `${c.name}: nothing displayed`,
        ).toBe(true);
      }
    },
    LONG,
  );

  it(
    'map-2: MEMORY ROM $8000, task 2 with A1 = $8000: the input works, D1.L is the length, memory is unchanged',
    async () => {
      const p = await program([
        '        MEMORY  ROM $8000,$8FFF',
        '        ORG     $1000',
        'START:  LEA     $8000,A1',
        '        MOVEQ   #2,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,D7',
        '        SIMHALT',
        '        ORG     $8000',
        '        DC.B    $11,$22,$33,$44',
        '        END     START',
      ]);
      const outcome = await runScenario({ program: p, keys: ['abc\n'], capture: [{ address: 0x8000, length: 4 }] });
      expect(outcome.end).toBe('halted');
      expect(outcome.registers.d[7]).toBe(3);
      expect([...(outcome.memory.get(0x8000) ?? [])]).toEqual([0x11, 0x22, 0x33, 0x44]);
      expect(outcome.cursor).toEqual({ row: 1, col: 0 }); // the line was entered and ended
    },
    LONG,
  );
});

describe.skipIf(!enginesBuilt)('hardware §13, round I3 (needs engine/dist)', () => {
  it(
    'item 17: opening a file unchecks all seven automatic boxes and the label reads Automatic Disabled',
    async () => {
      const a = await program(['        ORG     $1000', 'START:  SIMHALT', '        END     START']);
      const { session, path, settle } = await openSession({ a, b: a });
      try {
        await session.controller.open(path('a'), 'open');
        settle();
        for (const level of [1, 3, 7]) session.hardware.actions.setAutoChecked(level, true);
        settle();
        const before = session.hardware.view(session.engine);
        expect(before.controls.auto.filter((row) => row?.checked).length).toBe(3);
        await session.controller.open(path('b'), 'open');
        settle();
        const after = session.hardware.view(session.engine);
        expect(after.controls.auto.slice(1, 8).map((row) => row?.checked)).toEqual(Array(7).fill(false));
        expect(after.autoLabel).toBe('Automatic Disabled');
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'item 24: fresh start, no file, window shown: a click on any IRQ button (1-7) halts at once (SIMHALT at 0) and leaves IRQ and Reset disabled until a file is opened or Reset Program',
    async () => {
      const a = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      // "Any IRQ button": each of the seven levels, each followed by both ways out.
      for (const level of [1, 2, 3, 4, 5, 6, 7]) {
        for (const then of ['open', 'rewind'] as const) {
          const what = `IRQ ${level}, then ${then}`;
          const { session, path, settle } = await openSession({ a });
          try {
            session.hardware.actions.setVisible(true);
            settle();
            expect(session.hardware.view(session.engine).buttonsEnabled, what).toBe(true);
            session.hardware.actions.requestIrq(level);
            settle();
            expect(session.controller.snapshot.halted, what).toBe(true);
            expect(session.engine.getRegister(Reg.PC) >>> 0, what).toBe(4); // after the SIMHALT ($FFFF $FFFF) at 0
            expect(session.hardware.view(session.engine).buttonsEnabled, what).toBe(false);
            if (then === 'open') await session.controller.open(path('a'), 'open');
            else session.controller.rewind();
            settle();
            expect(session.hardware.view(session.engine).buttonsEnabled, what).toBe(true);
          } finally {
            session.dispose();
          }
        }
      }
    },
    LONG,
  );

  it(
    'item 21: after STOP with exceptions off the model reports the IRQ and Reset buttons disabled (the panel draws them dark maroon from that)',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  STOP    #$2000',
        '        SIMHALT',
        '        END     START',
      ]);
      const { session, path, settle } = await openSession({ p });
      try {
        await session.controller.open(path('p'), 'open');
        settle();
        session.hardware.actions.setVisible(true);
        settle();
        expect(session.hardware.view(session.engine).buttonsEnabled).toBe(true);
        session.controller.run();
        settle();
        expect(session.messages().some((m) => /^STOP instruction executed at location/i.test(m))).toBe(true);
        expect(session.hardware.view(session.engine).buttonsEnabled).toBe(false);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'item 30: ROM $2000: a long write at $1FFE is ignored completely, also its two bytes below the range; execution continues',
    async () => {
      const p = await program([
        '        MEMORY  ROM $2000,$2FFF',
        '        ORG     $1000',
        'START:  MOVE.L  #$11223344,D0',
        '        MOVE.L  D0,$1FFE',
        '        MOVE.B  D0,$2000',
        '        MOVEQ   #2,D7',
        '        SIMHALT',
        '        ORG     $1FFC',
        '        DC.B    $A1,$A2,$A3,$A4,$A5,$A6,$A7,$A8',
        '        END     START',
      ]);
      const outcome = await runScenario({ program: p, timeLimitMs: 2000, capture: [{ address: 0x1ffc, length: 8 }] });
      expect(busError(outcome)).toBe(false);
      expect(outcome.registers.d[7]).toBe(2);
      expect([...(outcome.memory.get(0x1ffc) ?? [])]).toEqual([0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8]);
    },
    LONG,
  );

  it(
    "item 34: a second program without MEMORY directives leaves the first program's map enabled",
    async () => {
      const first = await program([
        '        MEMORY  ROM $8000,$8FFF',
        '        ORG     $1000',
        'START:  SIMHALT',
        '        END     START',
      ]);
      const second = await program([
        '        ORG     $1000',
        'START:  MOVE.B  #$55,$8000',
        '        MOVE.B  $8000,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      const { session, path, settle, d } = await openSession({ first, second });
      try {
        await session.controller.open(path('first'), 'open');
        settle();
        expect(session.engine.hardware().map[MapKind.Rom]?.enabled).toBe(true);
        await session.controller.open(path('second'), 'open');
        settle();
        const rom = session.engine.hardware().map[MapKind.Rom];
        expect(rom).toMatchObject({ enabled: true, start: 0x8000, end: 0x8fff });
        session.controller.run();
        settle();
        expect(session.controller.snapshot.halted).toBe(true);
        expect(d(7)).not.toBe(0x55); // the write went into ROM and was ignored
        expect(session.engine.memory[0x8000]).not.toBe(0x55);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'item 35: the S-record loader places data inside ROM, Read and Invalid ranges',
    async () => {
      const p = await program([
        '        MEMORY  ROM $8000,$80FF',
        '        MEMORY  READ $9000,$90FF',
        '        MEMORY  INVALID $A000,$A0FF',
        '        ORG     $1000',
        'START:  SIMHALT',
        '        ORG     $8000',
        '        DC.B    $11,$12',
        '        ORG     $9000',
        '        DC.B    $21,$22',
        '        ORG     $A000',
        '        DC.B    $31,$32',
        '        END     START',
      ]);
      const outcome = await runScenario({
        program: p,
        start: false,
        timeLimitMs: 500,
        capture: [
          { address: 0x8000, length: 2 },
          { address: 0x9000, length: 2 },
          { address: 0xa000, length: 2 },
        ],
      });
      expect([...(outcome.memory.get(0x8000) ?? [])]).toEqual([0x11, 0x12]);
      expect([...(outcome.memory.get(0x9000) ?? [])]).toEqual([0x21, 0x22]);
      expect([...(outcome.memory.get(0xa000) ?? [])]).toEqual([0x31, 0x32]);
      expect(busError(outcome)).toBe(false);
    },
    LONG,
  );

  it(
    'item 37: Protected 0-$400, exceptions on, user code single-stepped into TRAP #1: the port stops with an error report, does not hang, and stays usable',
    async () => {
      const p = await program([
        '        MEMORY  PROTECTED $0,$400',
        '        ORG     $1000',
        'START:  MOVE    #$0000,SR',
        '        TRAP    #1',
        '        MOVEQ   #2,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      const other = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #5,D7',
        '        SIMHALT',
        '        END     START',
      ]);
      const { session, path, settle, d } = await openSession({ p, other }, { exceptions: true });
      try {
        await session.controller.open(path('p'), 'commandLine'); // the /e switch applies to this load
        settle();
        const alerts: string[] = [];
        // MOVE to SR (user mode), then TRAP #1: its vector fetch faults in the Protected range.
        for (let step = 0; step < 2; step++) {
          session.controller.traceInto();
          for (let ms = 0; ms < 100; ms += VIRTUAL_FRAME_MS) {
            session.time.advance(VIRTUAL_FRAME_MS);
            for (const alert of session.controller.alerts) alerts.push(`${alert.title}: ${alert.text}`);
            session.controller.dismissAlerts();
          }
        }
        // No endless recursion in the bus-error path: the session settles.
        expect(settle()).toBe(true);
        // The error report: the engine's error box for the exception in exec_inst (sim-core 9).
        expect(
          alerts.some((a) => /exception occurred in routine 'exec_inst'/.test(a)),
          JSON.stringify(alerts),
        ).toBe(true);
        expect(d(7)).toBe(0); // the trap was not silently delivered, the program did not go on
        expect(session.reports).toEqual([]);
        // Still usable: another program loads and runs to its end.
        await session.controller.open(path('other'), 'open');
        settle();
        session.controller.run();
        expect(settle()).toBe(true);
        expect(session.controller.snapshot.halted).toBe(true);
        expect(d(7)).toBe(5);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );
});

describe.skipIf(!enginesBuilt)('sim-ui §19 quirks that affect results, round I3 (needs engine/dist)', () => {
  it(
    'Q4: a Run To Cursor interrupted by Pause leaves its target: a later Run stops there once, the next Run goes on',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  TST.B   FLAG',
        '        BEQ     START',
        'TARGET: MOVEQ   #1,D7',
        '        MOVEQ   #2,D6',
        '        SIMHALT',
        'FLAG:   DC.B    0',
        '        END     START',
      ]);
      const target = addressOf(p, 'TARGET');
      const flag = addressOf(p, 'FLAG');
      const { session, path, settle, d } = await openSession({ p });
      try {
        await session.controller.open(path('p'), 'open');
        settle();
        const rows = session.listing.rows;
        const row = rows.findIndex(
          (_, i) => session.listing.isInstruction(i) && session.listing.addressOf(i) === target,
        );
        expect(row).toBeGreaterThanOrEqual(0);
        session.controller.runToCursor(row);
        session.time.advance(200);
        session.controller.pause();
        settle();
        expect(session.controller.snapshot.halted).toBe(false);
        session.controller.pokeMemory(flag, 1); // the loop may end now
        session.controller.run();
        settle();
        expect(session.engine.getRegister(Reg.PC) >>> 0).toBe(target); // stopped by the stale target
        expect(d(7)).toBe(0);
        expect(session.controller.snapshot.halted).toBe(false);
        session.controller.run();
        settle();
        expect(session.controller.snapshot.halted).toBe(true);
        expect(d(6)).toBe(2);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'Q14: /e and /b change the saved options; a later session started with the saved settings and no switches has both on (round trip through the stored settings document)',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE.L  #HANDLER,$14',
        '        MOVE.L  #$12345678,D0',
        '        BFEXTU  D0{8:8},D1',
        '        MOVEQ   #0,D2',
        '        DIVU    D2,D0',
        '        SIMHALT',
        'HANDLER MOVEQ   #9,D6',
        '        RTE',
        '        END     START',
      ]);
      // The settings file: the settings service (core/settings/service.ts) on a storage that outlives
      // the window, as localStorage does. The first launch starts from the defaults (both off).
      const storage = new MemorySettingsStorage();
      const firstWindow = createSettingsService(storage.window());
      expect(firstWindow.get().sim.exceptions).toBe(false);
      expect(firstWindow.get().sim.bitField).toBe(false);
      const first = await openSession({ p }, { exceptions: true, bitField: true });
      try {
        await first.session.controller.open(first.path('p'), 'commandLine');
        first.settle();
        expect(first.session.settings.exceptions).toBe(true);
        expect(first.session.settings.bitField).toBe(true);
        // What the application's session does with each option the engine changed
        // (features/run/session.ts, optionChanged): one settings update per option.
        for (const option of ['exceptions', 'bitField'] as const) {
          const value = first.session.settings[option];
          firstWindow.update((settings) =>
            settings.sim[option] === value ? settings : { ...settings, sim: { ...settings.sim, [option]: value } },
          );
        }
      } finally {
        first.session.dispose();
        firstWindow.dispose();
      }
      // The stored document holds both, and a later launch (a new window on the stored text) reads them.
      expect(storage.text).not.toBeNull();
      const stored = JSON.parse(storage.text as string) as { sim?: { exceptions?: unknown; bitField?: unknown } };
      expect(stored.sim).toMatchObject({ exceptions: true, bitField: true });
      const laterWindow = createSettingsService(new MemorySettingsStorage(storage.text).window());
      const saved = laterWindow.get().sim;
      laterWindow.dispose();
      expect(saved).toMatchObject({ exceptions: true, bitField: true });
      const later = await openSession({ p }, { settings: saved });
      try {
        await later.session.controller.open(later.path('p'), 'open');
        later.settle();
        later.session.controller.run();
        later.settle();
        expect(later.d(1)).toBe(0x34); // BFEXTU ran: the bit-field option
        expect(later.d(6)).toBe(9); // the divide-by-zero handler ran: the exceptions option
      } finally {
        later.session.dispose();
      }
    },
    LONG,
  );

  it(
    'Q19: Memory window writes (one byte, and the Copy and Fill path) bypass the memory map: they land in ROM and Invalid ranges, and the program reads them',
    async () => {
      const p = await program([
        '        MEMORY  ROM $8000,$80FF',
        '        MEMORY  INVALID $A000,$A0FF',
        '        ORG     $1000',
        'START:  MOVE.B  $8000,D7',
        '        MOVE.L  $8010,D6',
        '        SIMHALT',
        '        END     START',
      ]);
      const { session, path, settle, d } = await openSession({ p });
      try {
        await session.controller.open(path('p'), 'open');
        settle();
        session.controller.pokeMemory(0x8000, 0x5a);
        session.controller.invoke((engine) => engine.writeBytes(0x8010, [1, 2, 3, 4]));
        session.controller.pokeMemory(0xa000, 0x6b);
        session.controller.invoke((engine) => engine.writeBytes(0xa010, [5, 6, 7, 8]));
        settle();
        expect(session.engine.memory[0xa000]).toBe(0x6b);
        expect([...session.engine.memory.slice(0xa010, 0xa014)]).toEqual([5, 6, 7, 8]);
        session.controller.run();
        settle();
        expect(session.controller.snapshot.halted).toBe(true);
        expect(d(7)).toBe(0x5a);
        expect(d(6)).toBe(0x01020304);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'Q21: a break condition on A7 tests the user stack pointer, not the supervisor one',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  LEA     $5000,SP',
        '        MOVEQ   #1,D1',
        '        LEA     $5000,A0',
        '        MOVE.L  A0,USP',
        'AFTER:  MOVEQ   #2,D2',
        '        SIMHALT',
        '        END     START',
      ]);
      const { session, path, settle, d } = await openSession({ p });
      try {
        await session.controller.open(path('p'), 'open');
        settle();
        session.controller.invoke((engine) => {
          engine.setBreakCondition(0, { type: 0, typeId: 15, op: 0, value: 0x5000, size: 2, enabled: true });
          engine.setBreakExpression(0, { postfix: [0], count: 1, enabled: true });
          engine.setBreakCounts({ registers: 1, addresses: 0, expressions: 1 });
        });
        session.controller.run();
        settle();
        expect(session.controller.snapshot.halted).toBe(false);
        expect(session.engine.getRegister(Reg.PC) >>> 0).toBe(addressOf(p, 'AFTER'));
        expect(d(1)).toBe(1);
        expect(d(2)).toBe(0);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'Q21: evaluating a word memory condition on an odd address raises an address error (exceptions off: the program halts)',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D1',
        '        MOVEQ   #2,D2',
        '        MOVEQ   #3,D3',
        '        SIMHALT',
        '        END     START',
      ]);
      const { session, path, settle, d } = await openSession({ p });
      try {
        await session.controller.open(path('p'), 'open');
        settle();
        session.controller.invoke((engine) => {
          engine.setBreakCondition(50, {
            type: 1,
            typeId: 0x2001,
            op: 6,
            value: 0,
            size: 1,
            readWrite: 3,
            enabled: true,
          });
          engine.setBreakExpression(0, { postfix: [50], count: 1, enabled: true });
          engine.setBreakCounts({ registers: 0, addresses: 1, expressions: 1 });
        });
        session.controller.run();
        settle();
        expect(
          session.messages().some((m) => /address error/i.test(m)),
          JSON.stringify(session.messages()),
        ).toBe(true);
        expect(session.controller.snapshot.halted).toBe(true);
        expect(d(3)).toBe(0);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );

  it(
    'Q21: evaluating a memory condition reads the address, and that read satisfies a Read test of a condition evaluated after it in the same step',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D1',
        'SECOND: MOVEQ   #2,D2',
        '        MOVEQ   #3,D3',
        '        SIMHALT',
        '        END     START',
      ]);
      const run = async (postfix: number[]) => {
        const { session, path, settle, d } = await openSession({ p });
        try {
          await session.controller.open(path('p'), 'open');
          settle();
          session.controller.invoke((engine) => {
            // 50: $3000, no access test, no comparison (true, and it reads $3000); 51: $3000, Read.
            engine.setBreakCondition(50, {
              type: 1,
              typeId: 0x3000,
              op: 6,
              value: 0,
              size: 0,
              readWrite: 3,
              enabled: true,
            });
            engine.setBreakCondition(51, {
              type: 1,
              typeId: 0x3000,
              op: 6,
              value: 0,
              size: 0,
              readWrite: 1,
              enabled: true,
            });
            engine.setBreakExpression(0, { postfix, count: 1, enabled: true });
            engine.setBreakCounts({ registers: 0, addresses: 2, expressions: 1 });
          });
          session.controller.run();
          settle();
          return { halted: session.controller.snapshot.halted, pc: session.engine.getRegister(Reg.PC) >>> 0, d3: d(3) };
        } finally {
          session.dispose();
        }
      };
      // The program never reads $3000: the Read condition alone never breaks.
      expect(await run([51])).toMatchObject({ halted: true, d3: 3 });
      // After condition 50 has read $3000, condition 51 sees that read: a break after the first instruction.
      expect(await run([50, 51, 100])).toEqual({ halted: false, pc: addressOf(p, 'SECOND'), d3: 0 });
    },
    LONG,
  );

  it(
    "Q21: a memory condition's address is not masked to 24 bits (BPoint.cpp:130): $01003000 reads the byte at $003000, but its R/W test never matches an access there",
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVE.B  #$5A,$3000',
        'SECOND: MOVEQ   #2,D2',
        '        MOVEQ   #3,D3',
        '        SIMHALT',
        '        END     START',
      ]);
      const run = async (typeId: number, value: number, readWrite = 3, op = 0) => {
        const { session, path, settle, d } = await openSession({ p });
        try {
          await session.controller.open(path('p'), 'open');
          settle();
          // Byte condition (default: no access test, == value), as the Break Points window sends it
          // for an address typed as 01003000: core/breakpoints/slots.ts keeps all 32 bits.
          session.controller.invoke((engine) => {
            engine.setBreakCondition(50, { type: 1, typeId, op, value, size: 0, readWrite, enabled: true });
            engine.setBreakExpression(0, { postfix: [50], count: 1, enabled: true });
            engine.setBreakCounts({ registers: 0, addresses: 1, expressions: 1 });
          });
          session.controller.run();
          settle();
          return { halted: session.controller.snapshot.halted, pc: session.engine.getRegister(Reg.PC) >>> 0, d3: d(3) };
        } finally {
          session.dispose();
        }
      };
      // $01003000 compares the byte the program wrote at $3000: a break right after the write.
      expect(await run(0x01003000, 0x5a)).toEqual({ halted: false, pc: addressOf(p, 'SECOND'), d3: 0 });
      // The same with $00003000, and no break when the value differs.
      expect(await run(0x00003000, 0x5a)).toEqual({ halted: false, pc: addressOf(p, 'SECOND'), d3: 0 });
      expect(await run(0x01003000, 0x5b)).toMatchObject({ halted: true, d3: 3 });
      // The access test compares the condition's unmasked location with the masked ones the accesses
      // recorded (readEA, writeEA = &memory[loc], UTILS.CPP:394, 496; sim-core 7.2: "a memory
      // condition with an address above $FFFFFF can never satisfy a read/write test"): an R/W test
      // on $00003000 sees the MOVE.B (it writes and re-reads $3000), the same test on $01003000 never does.
      expect(await run(0x00003000, 0, 0, 6)).toEqual({ halted: false, pc: addressOf(p, 'SECOND'), d3: 0 });
      expect(await run(0x01003000, 0, 0, 6)).toMatchObject({ halted: true, d3: 3 });
    },
    LONG,
  );

  it(
    'Q21: a word memory condition on $01003001 (odd, not masked) raises the address error like $003001 (exceptions off: the program halts)',
    async () => {
      const p = await program([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D1',
        '        MOVEQ   #2,D2',
        '        MOVEQ   #3,D3',
        '        SIMHALT',
        '        END     START',
      ]);
      const { session, path, settle, d } = await openSession({ p });
      try {
        await session.controller.open(path('p'), 'open');
        settle();
        session.controller.invoke((engine) => {
          engine.setBreakCondition(50, {
            type: 1,
            typeId: 0x01003001,
            op: 6,
            value: 0,
            size: 1,
            readWrite: 3,
            enabled: true,
          });
          engine.setBreakExpression(0, { postfix: [50], count: 1, enabled: true });
          engine.setBreakCounts({ registers: 0, addresses: 1, expressions: 1 });
        });
        session.controller.run();
        settle();
        expect(
          session.messages().some((m) => /address error/i.test(m)),
          JSON.stringify(session.messages()),
        ).toBe(true);
        expect(session.controller.snapshot.halted).toBe(true);
        expect(d(3)).toBe(0);
      } finally {
        session.dispose();
      }
    },
    LONG,
  );
});
