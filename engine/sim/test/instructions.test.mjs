// Instruction semantics: every instruction group and every addressing mode,
// with registers, flags and memory asserted.  The programs are in
// test/fixtures (moves, arith, logic, bitfield, flow); the expected records
// are in expected-records.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, start, records, hex } from './helpers.mjs';
import * as expected from './expected-records.mjs';
import { Reg, Status } from '../sim68k.mjs';

for (const name of ['moves', 'arith', 'logic', 'bitfield']) {
  test(`${name}: every record of the fixture`, async () => {
    const { sim, result } = await run(name);
    assert.equal(result.reason, 'stopped');
    assert.equal(sim.state().halt, true, 'the program reached SIMHALT');
    const got = records(sim);
    const want = expected[name];
    assert.equal(got.length, want.length, 'number of records');
    want.forEach(([ccr, value, label], i) => {
      assert.equal(`${got[i].ccr} ${hex(got[i].value)}`, `${ccr} ${hex(value)}`, `record ${i + 1}: ${label}`);
    });
  });
}

test('moves: MOVE to SR sets the interrupt mask; final register state', async () => {
  const { sim } = await run('moves');
  const r = sim.registers();
  assert.equal(sim.readWord(0x4000 + 60 * 6), 0x2700, 'SR recorded after MOVE #$2700,SR');
  assert.equal(r.usp, 0x00123456);
  assert.equal(r.ssp, 0x00008000);
  assert.equal(r.sr, 0x2000);
});

test('bitfield: the listing directive switched the option on; without it the instruction is illegal', async () => {
  const withListing = await run('bitfield');
  assert.equal(withListing.sim.state().halt, true);
  assert.deepEqual(withListing.host.messages.filter((m) => m.includes('Illegal')), []);

  const without = await run('bitfield', { listing: false });
  assert.match(without.host.messages.at(-1), /^Illegal instruction found at location 1016. Execution halted$/);
});

test('flow: conditions, branches, DBcc, JSR/JMP modes, RTR, CHK, TRAPV', async () => {
  const { sim } = await run('flow');
  const w = (offset) => sim.readWord(0x4000 + offset);
  // Sixteen Scc results per CCR pattern, T in bit 15 ... LE in bit 0
  // (T F HI LS CC CS NE EQ VC VS PL MI GE LT GT LE).
  assert.equal(w(0), 0xAAAA, 'CCR = none');
  assert.equal(w(2), 0x99A9, 'CCR = Z');
  assert.equal(w(4), 0xAA5A, 'CCR = N V');
  assert.equal(w(6), 0x9695, 'CCR = N C');
  assert.equal(w(8), 0x0002, 'Bcc: only the not-taken BNE fell through');
  assert.equal(w(10), 5, 'DBF with D3 = 4 runs the loop five times');
  assert.equal(w(12), 0xFFFF, 'DBF leaves the counter word at $FFFF');
  assert.equal(w(14), 9, 'DBEQ with the condition true does not decrement');
  assert.equal(sim.readLong(0x4010), 0x0001FFFF, 'DBcc counts in the low word only');
  assert.equal(w(20), 0x0406, 'JSR abs.L, (An), d16(An), d8(An,Xn), d16(PC), abs.W');
  assert.equal(w(22), 0x0406, 'JMP (An) and JMP d16(PC) skipped the increments');
  assert.equal(sim.readLong(0x4018), 0x00008000, 'stack balanced after the subroutine calls');
  assert.equal(w(28), 0x2015, 'RTR restored the condition codes from the stack');
  // CHK without a trap: N from the register; this simulator INVERTS Z, V and C
  // (cc_update(N_A, GEN, UND, UND, UND ...), CODE9.CPP:157).
  assert.equal(w(30), 0x2007, 'CHK in bounds');
  assert.equal(w(32), 0x600D, 'TRAPV with V clear does nothing');
});

// ---------------------------------------------------------------------------
// Cycle counts.  One instruction is poked into memory and single-stepped.
// Expected values follow docs/porting/sim-core.md section 3.16 (they are the
// simulator's estimates, not always those of a real 68000).
// ---------------------------------------------------------------------------
const CYCLES = [
  // [opcode words, cycles, what]
  [[0x4E71], 4, 'NOP'],
  [[0x7001], 4, 'MOVEQ #1,D0'],
  [[0x2200], 4, 'MOVE.L D0,D1'],
  [[0x203C, 0x1234, 0x5678], 12, 'MOVE.L #imm,D0'],
  [[0x3080], 8, 'MOVE.W D0,(A0)'],
  [[0x23C0, 0x0000, 0x3000], 20, 'MOVE.L D0,abs.L'],
  [[0xD280], 8, 'ADD.L D0,D1 (long, register source)'],
  [[0xD240], 4, 'ADD.W D0,D1'],
  [[0xD290], 14, 'ADD.L (A0),D1: 6 + 8 for the address mode'],
  [[0xD190], 20, 'ADD.L D0,(A0): 12 + 8'],
  [[0x41F9, 0x0000, 0x3000], 12, 'LEA abs.L,A0'],
  [[0x41D0], 4, 'LEA (A0),A0'],
  [[0x4868, 0x0004], 16, 'PEA 4(A0)'],
  [[0x4ED0], 8, 'JMP (A0)'],
  [[0x4EB9, 0x0000, 0x3000], 20, 'JSR abs.L'],
  [[0x6002], 10, 'BRA.S'],
  [[0x6702], 8, 'BEQ.S not taken (Z clear)'],
  [[0x6700, 0x0004], 12, 'BEQ.W not taken'],
  [[0x6602], 10, 'BNE.S taken'],
  [[0x51C8, 0xFFFE], 10, 'DBF D0 that branches (D0 = 5)'],
  [[0x50C8, 0xFFFE], 12, 'DBT: condition true'],
  [[0xC0FC, 0x0003], 46, 'MULU #3,D0: 38 + 2 per 1 bit + 4 for the immediate'],
  [[0x4E70], 132, 'RESET'],
  [[0xE588], 12, 'LSL.L #2,D0: 8 + 2 per bit'],
  [[0xE548], 10, 'LSL.W #2,D0: 6 + 2 per bit'],
  [[0x4E75], 16, 'RTS'],
  [[0x4E4F], 0, 'TRAP #15 task 30 (clear cycle counter): the task itself is free'],
];

test('cycle counts of single instructions', async () => {
  for (const [words, cycles, what] of CYCLES) {
    const { sim } = await start('moves', { listing: false });
    const bytes = words.flatMap((word) => [word >> 8, word & 0xFF]);
    sim.writeBytes(0x1000, bytes);
    sim.writeBytes(0x1000 + bytes.length, [0xFF, 0xFF, 0xFF, 0xFF]);
    sim.setRegister(Reg.PC, 0x1000);
    sim.setRegister(Reg.A0, 0x3000);
    sim.setRegister(Reg.D0, what.startsWith('TRAP') ? 30 : 5);
    sim.setRegister(Reg.A7, 0x8000);
    assert.equal(sim.cmdTraceInto(), Status.STOPPED, what);
    assert.equal(sim.cycles, BigInt(cycles), what);
  }
});

test('DBF that runs out costs 14 cycles', async () => {
  const { sim } = await start('moves', { listing: false });
  sim.writeBytes(0x1000, [0x51, 0xC8, 0xFF, 0xFE]);
  sim.setRegister(Reg.PC, 0x1000);
  sim.setRegister(Reg.D0, 0);
  sim.cmdTraceInto();
  assert.equal(sim.cycles, 14n);
  assert.equal(sim.getRegister(Reg.PC), 0x1004);
  assert.equal(sim.getRegister(Reg.D0), 0x0000FFFF);
});

test('privileged instructions: EORI to SR, RESET and RTE in supervisor and in user mode', async () => {
  const poke = async (words, { user = false } = {}) => {
    const { sim, host } = await start('moves', { listing: false });
    const bytes = words.flatMap((word) => [word >> 8, word & 0xFF]);
    sim.writeBytes(0x3000, [...bytes, 0xFF, 0xFF, 0xFF, 0xFF]);
    sim.setRegister(Reg.PC, 0x3000);
    if (user) sim.setRegister(Reg.SR, 0x0000);
    sim.cmdRun();
    sim.run(1000);
    return { sim, host };
  };
  let r = await poke([0x0A7C, 0x0715]); // EORI #$0715,SR
  assert.equal(r.sim.getRegister(Reg.SR), 0x2715);
  assert.equal(r.sim.cycles, 20n);
  r = await poke([0x0A7C, 0x0715], { user: true });
  assert.equal(r.host.messages.at(-1), 'supervisor privilege violation at location 3000. Execution halted');
  assert.equal(r.sim.getRegister(Reg.SR), 0x0000, 'unchanged');
  r = await poke([0x4E70], { user: true }); // RESET
  assert.equal(r.host.messages.at(-1), 'supervisor privilege violation at location 3000. Execution halted');
  r = await poke([0x4E73], { user: true }); // RTE
  assert.equal(r.host.messages.at(-1), 'supervisor privilege violation at location 3000. Execution halted');
  r = await poke([0x4E60], { user: true }); // MOVE A0,USP
  assert.equal(r.host.messages.at(-1), 'supervisor privilege violation at location 3000. Execution halted');
  r = await poke([0x40C0, 0x44FC, 0x001F], { user: true }); // MOVE SR,D0 and MOVE #$1F,CCR are not privileged
  assert.equal(r.sim.getRegister(Reg.D0) & 0xFFFF, 0x0000);
  assert.equal(r.sim.getRegister(Reg.SR), 0x001F);
  assert.equal(r.sim.state().halt, true, 'reached SIMHALT');
});
