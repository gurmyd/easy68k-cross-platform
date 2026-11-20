// Interrupt requests, the mask, STOP, the Reset button and the
// auto-interrupt timers.  Fixture: test/fixtures/irq.X68 (case n at
// $2000 + n * $40).  Expected behaviour: docs/porting/sim-core.md 3.10-3.12
// and docs/porting/hardware.md section 3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, runMessages } from './helpers.mjs';
import { Reg, Status, Option } from '../sim68k.mjs';
import { drive } from './headless-host.mjs';

const COUNTS = 0x3000;
const LOG = 0x4000;

/** Entries the interrupt handlers logged: level, SR in the handler, stacked SR, stacked PC. */
function log(sim) {
  const entries = [];
  for (let a = LOG; sim.readWord(a) !== 0xFFFF; a += 10) {
    entries.push({ level: sim.readWord(a), sr: sim.readWord(a + 2), stackedSR: sim.readWord(a + 4), stackedPC: sim.readLong(a + 6) });
  }
  return entries;
}

/** Start a case and run a little so that the program is in its loop. */
async function spinning(caseNumber, options = {}) {
  const { sim, host } = await start('irq', { caseNumber, exceptions: options.exceptions ?? true });
  sim.cmdRun();
  assert.equal(sim.run(200), Status.RUNNING);
  return { sim, host };
}

function finish(sim, host) {
  sim.setRegister(Reg.D5, 1); // the spin loops end when D5 is non-zero
  const result = drive(sim, host);
  assert.equal(result.reason, 'stopped');
}

test('an interrupt is taken after the next instruction, through its autovector', async () => {
  const { sim, host } = await spinning(0);
  const before = sim.cycles;
  assert.equal(sim.irq(3), true, 'the program is running');
  assert.equal(sim.cycles - before, 44n, '44 cycles at request time');
  assert.equal(sim.state().irq, 0x04, 'level 3 latched as bit 2');
  assert.equal(sim.run(1), Status.RUNNING);
  assert.equal(sim.state().irq, 0, 'taken at the end of the next instruction');
  assert.equal(sim.getRegister(Reg.SR) & 0x2700, 0x2300, 'supervisor, mask = 3');
  assert.equal(sim.getRegister(Reg.PC), sim.readLong(0x6C), 'PC from the level-3 autovector at $6C');
  assert.equal(sim.getRegister(Reg.SSP), 0x8000 - 6);
  finish(sim, host);
  const entries = log(sim);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, 3);
  assert.equal(entries[0].stackedSR & 0x2700, 0x2000, 'the old mask is on the stack');
  assert.equal(sim.readByte(COUNTS + 3), 1);
  assert.equal(sim.getRegister(Reg.SSP), 0x8000, 'RTE removed the frame');
});

test('request + service cost 44 + 34 cycles', async () => {
  const { sim, host } = await start('irq', { caseNumber: 0, exceptions: true });
  sim.cmdRunToAddress(0x2004); // SPIN0: ADDQ.L #1,D4
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x2004);
  const before = sim.cycles;
  sim.irq(1);
  assert.equal(sim.cycles - before, 44n, 'request');
  assert.equal(sim.cmdTraceInto(), Status.STOPPED);
  assert.equal(sim.cycles - before, 44n + 8n + 34n, 'ADDQ.L #1,D4 (8) and the interrupt service (34)');
  assert.equal(sim.getRegister(Reg.PC), sim.readLong(0x64));
});

test('the highest pending level is taken first; the lower one waits for the mask', async () => {
  const { sim, host } = await spinning(0);
  sim.irq(2);
  sim.irq(5);
  assert.equal(sim.state().irq, 0x12);
  finish(sim, host);
  assert.deepEqual(log(sim).map((e) => e.level), [5, 2]);
  assert.equal(log(sim)[0].sr & 0x0700, 0x0500, 'mask raised to the level taken');
});

test('requests at or below the mask stay latched', async () => {
  const { sim, host } = await spinning(1); // mask 3
  sim.irq(3);
  sim.irq(2);
  sim.run(100);
  assert.equal(sim.state().irq, 0x06, 'levels 2 and 3 are still pending');
  sim.irq(4);
  finish(sim, host);
  assert.deepEqual(log(sim).map((e) => e.level), [4]);
  assert.equal(sim.state().irq, 0x06);
});

test('level 7 is not maskable', async () => {
  const { sim, host } = await spinning(6); // mask 7
  sim.irq(6);
  sim.irq(7);
  finish(sim, host);
  assert.deepEqual(log(sim).map((e) => e.level), [7]);
  assert.equal(sim.state().irq, 0x20, 'level 6 still latched');
});

test('exceptions disabled: a request is latched, costs 44 cycles, is never serviced', async () => {
  const { sim, host } = await spinning(0, { exceptions: false });
  const before = sim.cycles;
  sim.irq(3);
  assert.equal(sim.cycles - before, 44n);
  finish(sim, host);
  assert.deepEqual(log(sim), []);
  assert.equal(sim.state().irq, 0x04);
});

test('a request while idle starts the program without the Run command (QUIRK)', async () => {
  const { sim } = await start('irq', { caseNumber: 0, exceptions: true });
  assert.equal(sim.state().runMode, false);
  assert.equal(sim.getRegister(Reg.OLD_PC), 0xFFFFFFFF, 'OLD_PC is -1 after a load and stays so: no loadRegs()');
  assert.equal(sim.irq(1), true, 'IRQprocess sets runMode when not tracing');
  assert.equal(sim.state().menuState, 0, 'and the menus do not change');
  // The first instruction (MOVEA.L #$8000,A7) runs, then the interrupt is
  // taken - through a vector the program has not installed yet.
  assert.equal(sim.run(1), Status.RUNNING);
  assert.equal(sim.getRegister(Reg.SSP), 0x8000 - 6);
  assert.equal(sim.getRegister(Reg.PC), 0xFFFFFFFF);
  assert.equal(sim.readLong(0x8000 - 4), 0x1006, 'return address: the second instruction');
});

test('a request in trace mode only latches', async () => {
  const { sim } = await start('irq', { caseNumber: 0, exceptions: true });
  sim.cmdTraceInto();
  assert.equal(sim.irq(1), false);
  assert.equal(sim.state().irq, 0x01);
  assert.equal(sim.state().runMode, false);
});

test('STOP: an interrupt wakes it; one instruction runs before the interrupt is taken (QUIRK)', async () => {
  const { sim, host } = await start('irq', { caseNumber: 2, exceptions: true });
  sim.cmdRun();
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.deepEqual(runMessages(host), ['STOP instruction. Execution halted']);
  assert.equal(sim.getRegister(Reg.PC), 0x2084);
  assert.equal(sim.state().stopInstruction, true);
  assert.equal(sim.irq(1), true, 'the request restarts the run loop');
  assert.equal(drive(sim, host).reason, 'stopped');
  const entries = log(sim);
  assert.equal(entries.length, 1);
  // The instruction after STOP ($2084) executed first; the stacked return
  // address is that of the SECOND instruction after STOP.
  assert.equal(entries[0].stackedPC, 0x2086);
  assert.equal(sim.getRegister(Reg.D3), 2);
});

test('STOP: a masked request neither wakes it nor costs cycles', async () => {
  const { sim, host } = await start('irq', { caseNumber: 3, exceptions: true });
  sim.cmdRun();
  drive(sim, host);
  const before = sim.cycles;
  assert.equal(sim.irq(3), false, 'mask is 5');
  assert.equal(sim.cycles, before);
  assert.equal(sim.state().irq, 0x04, 'but it is latched');
  assert.equal(sim.irq(6), true);
  drive(sim, host);
  assert.deepEqual(log(sim).map((e) => e.level), [6]);
});

test('a request latched before STOP is taken in the STOP step, and the simulator still halts (QUIRK)', async () => {
  // sim-core.md 3.12: the interrupt test comes before the STOP_TRAP case.
  const { sim, host } = await start('irq', { caseNumber: 2, exceptions: true });
  sim.cmdRunToAddress(0x2080);
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x2080);
  sim.irq(1); // trace mode: latched only
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.state().halt, true);
  assert.equal(sim.getRegister(Reg.PC), sim.readLong(0x64), 'halted at the first instruction of the handler');
  assert.equal(sim.getRegister(Reg.SR) & 0x0700, 0x0100);
  assert.equal(sim.readLong(0x8000 - 4), 0x2084, 'return address: the instruction after STOP');
  assert.deepEqual(log(sim), [], 'the handler has not run');
});

test('an interrupt in the same step as a TRAP: both frames, the trap handler runs (QUIRK)', async () => {
  // hardware.md 9.2 item 3.
  const { sim, host } = await start('irq', { caseNumber: 7, exceptions: true });
  sim.cmdRunToAddress(0x21CE); // the TRAP #1 instruction
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x21CE);
  sim.irq(2);
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.readWord(LOG), 0x7A7A, 'the TRAP handler ran');
  assert.equal(sim.readWord(LOG + 2) & 0x2700, 0x2200, 'its stacked SR has the mask the interrupt set');
  assert.equal(sim.readLong(LOG + 4), 0x21D0, 'same return address in both frames');
  assert.equal(sim.readLong(0x8000 - 4), 0x21D0);
  assert.equal(sim.getRegister(Reg.SSP), 0x8000 - 12, 'two six-byte frames');
  assert.equal(sim.readByte(COUNTS + 2), 0, 'the interrupt handler never ran');
  assert.equal(sim.state().irq, 0, 'but its request is gone');
});

test('Reset button: SR, SSP and PC from the vectors, 40 + 44 cycles, pending requests survive', async () => {
  const { sim, host } = await spinning(1); // mask 3
  sim.irq(2); // stays pending
  const before = sim.cycles;
  assert.equal(sim.hardwareReset(), true);
  assert.equal(sim.cycles - before, 84n);
  assert.equal(sim.getRegister(Reg.SR) & 0xA700, 0x2700);
  assert.equal(sim.getRegister(Reg.SSP), 0x00009000);
  assert.equal(sim.getRegister(Reg.PC), sim.readLong(4));
  assert.equal(sim.state().irq, 0x02);
  drive(sim, host);
  assert.equal(sim.readWord(0x3008), 0x5E5E, 'the reset code ran');
  assert.equal(sim.readLong(0x300A), 0x00009000);
});

test('Reset button and interrupt requests are ignored while the hardware is disabled', async () => {
  const { sim, host } = await spinning(0);
  finish(sim, host); // SIMHALT disables the hardware
  assert.equal(sim.state().hardwareEnabled, false);
  const pc = sim.getRegister(Reg.PC), cycles = sim.cycles;
  assert.equal(sim.irq(4), false);
  assert.equal(sim.hardwareReset(), false);
  assert.equal(sim.state().irq, 0);
  assert.equal(sim.getRegister(Reg.PC), pc);
  assert.equal(sim.cycles, cycles);
});

test('auto interrupts set up by the program (TRAP #15 task 32) with the simulated clock', async () => {
  const { sim, host } = await start('irq', { caseNumber: 4 });
  sim.cmdRun();
  const result = drive(sim, host);
  assert.equal(result.reason, 'stopped');
  assert.equal(sim.readByte(COUNTS + 2), 3);
  assert.equal(sim.getOption(Option.EXCEPTIONS), 1, 'task 32/5 enabled exceptions');
  assert.deepEqual(host.callsOf('optionChanged'), [[0, 1]]);
  assert.equal(host.callsOf('saveSettings').length, 1);
  assert.equal(host.timers[2].intervalMs, 100);
  assert.ok(host.timeMs >= 300 && host.timeMs < 320, `three ticks of 100 ms, got ${host.timeMs}`);
  const hw = sim.hardware();
  assert.equal(hw.auto[2].checked, false, 'task 32/6 with D2 = 0 unchecked every box');
  assert.equal(hw.auto[2].timerEnabled, false);
});
