// Checklist items that need a person at the original - the Hardware window's buttons and switches,
// Trace Into, typed input - and so have no golden from the Wine oracle: they run headless with
// scripted panel actions and keys (ARCHITECTURE.md 6.4: "hardware §13 ... headless with scripted
// panel actions"; trap15-a §13 Input) and are checked against what the specs dictate.
// Owner: T3 (the hardware items with SH7).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Reg } from '../../../app/src/contracts';
import { assembleProgram } from '../../../app/src/engine/testing';
import { runScenario, type AssembledConformance, type Scenario } from './harness';

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
