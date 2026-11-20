// Behaviour of Sim68K that differs from a real 68000 (or from what a reader
// would expect) and that student programs can depend on.  Each test says
// where the behaviour comes from in the original source; the expected values
// were worked out from that source, not from running the port.
// Fixture: test/fixtures/quirks.X68 (case n at $2000 + n * $40).
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, start, runMessages } from './helpers.mjs';
import { Reg, Status, Break } from '../sim68k.mjs';
import { drive } from './headless-host.mjs';

const RESULTS = 0x4000;

test('LEA: the result is a 24-bit address; only abs.W is sign-extended', async () => {
  // CODE2.CPP:68: A[n] = EA1 - memory, and EA1 was built with "& ADDRMASK".
  const { sim } = await run('quirks', { caseNumber: 0 });
  assert.equal(sim.getRegister(Reg.A1), 0x00345678, 'LEA $12345678,A1');
  assert.equal(sim.getRegister(Reg.A0 + 3), 0x00FFFFFF, 'LEA -1(A2),A3 with A2 = 0');
  assert.equal(sim.getRegister(Reg.A0 + 4), 0xFFFF8000, 'LEA $8000.W,A4');
});

test('PEA pushes the same 24-bit value', async () => {
  const { sim } = await run('quirks', { caseNumber: 1 });
  assert.equal(sim.getRegister(Reg.D1), 0x00345678);
});

test('LINK A7 in supervisor mode uses the user stack pointer as the frame register', async () => {
  // CODE2.CPP:146-149 index A[reg] without a_reg(): for register 7 that is
  // always the USP, while the push and the displacement use the active (SSP).
  const { sim } = await run('quirks', { caseNumber: 2 });
  assert.equal(sim.getRegister(Reg.D2), 0x00005000, 'the USP was pushed on the supervisor stack');
  assert.equal(sim.getRegister(Reg.A0 + 2), 0x00007FFC, 'USP = address of the pushed value');
  assert.equal(sim.getRegister(Reg.D1), 0x00007FF8, 'SSP = $8000 - 4 - 4');
});

test('ADDQ.B / SUBQ.B to an address register work on the whole register', async () => {
  // CODE3.CPP:171, 389: mode An forces LONG_MASK whatever the size field says.
  const { sim } = await run('quirks', { caseNumber: 3 });
  assert.equal(sim.getRegister(Reg.A1), 0x00010100);
  assert.equal(sim.getRegister(Reg.A0 + 2), 0x0000FFFF);
});

test('byte operations on A7: -(A7) and (A7)+ step by 2, but ADDX, CMPM and ABCD step by 1', async () => {
  // RUN.CPP eff_addr uses 2 for register 7; CODE3.CPP:215, CODE4.CPP:505,
  // CODE5.CPP:62 use the plain operand size.
  const { sim } = await run('quirks', { caseNumber: 4 });
  const l = (i) => sim.readLong(RESULTS + 4 * i);
  assert.equal(l(0), 0x7FFE, 'MOVE.B #,-(A7)');
  assert.equal(l(1), 0x8000, 'MOVE.B (A7)+,D0');
  assert.equal(l(2), 0x7FFF, 'ADDX.B -(A1),-(A7)');
  assert.equal(l(3), 0x8001, 'CMPM.B (A1)+,(A7)+');
  assert.equal(l(4), 0x7FFF, 'ABCD -(A1),-(A7)');
});

test('MULS leaves the V flag as it was', async () => {
  // CODE4.CPP:288 passes CASE_9 as the V method, which cc_update does not know.
  const { sim } = await run('quirks', { caseNumber: 6 });
  assert.equal(sim.getRegister(Reg.D0), 15);
  assert.equal(sim.getRegister(Reg.D1) & 0x1F, 0x02, 'V still set (a 68000 clears it)');
});

test('a branch displacement byte of $FF means -1', async () => {
  // CODE8.CPP: the byte is sign-extended; there is no 68020 long form.
  const { sim, host } = await run('quirks', { caseNumber: 7 });
  assert.equal(sim.getRegister(Reg.PC), 0x21C1, 'target = $21C0 + 2 - 1');
  assert.deepEqual(runMessages(host), ['Address Error: Instruction at 21c1 accessing address 21c1']);
});

test('RTE pops six bytes and loads all sixteen SR bits', async () => {
  const { sim } = await run('quirks', { caseNumber: 8 });
  assert.equal(sim.getRegister(Reg.D1), 0x3FFF, 'unimplemented SR bits are stored too');
  assert.equal(sim.getRegister(Reg.D2), 0x8000);
});

test('ORI to CCR ORs the whole immediate word into SR, without a privilege check', async () => {
  // CODE6.CPP:227-240: SR |= temp.  From user mode this sets S and the mask.
  const { sim } = await run('quirks', { caseNumber: 9 });
  assert.equal(sim.getRegister(Reg.D1), 0x2700);
});

test('MOVE to CCR stores all eight low bits', async () => {
  // CODE1.CPP:226: put((long *)&SR, EV1, BYTE_MASK)
  const { sim } = await run('quirks', { caseNumber: 10 });
  assert.equal(sim.getRegister(Reg.D1), 0x20FF);
});

test('ASL: the V flag for shift counts of 32 and more', async () => {
  // UTILS.CPP:722-726, count 40, word size:
  //   mask = ~($FFFF >> ((40+1) mod 32)) & $FFFF = $FF80   (x86 shift modulo 32)
  //   "shiftCount > (size-1) & source" is (40 > 15) & source: true iff bit 0 of the source is set
  //   otherwise V = !((mask & source) == 0 || (mask & ~source) == 0)
  const { sim } = await run('quirks', { caseNumber: 11 });
  assert.equal(sim.getRegister(Reg.D2) & 0x1F, 0x06, 'source $0001: bit 0 set -> V; result 0 -> Z');
  assert.equal(sim.getRegister(Reg.D3) & 0x1F, 0x06, 'source $7F80: mixed bits under the mask -> V');
  assert.equal(sim.getRegister(Reg.D0 + 4) & 0x1F, 0x04, 'source $FF80: all ones under the mask -> no V (a 68000 sets V)');
});

test('MOVEM to -(An) with An in the list stores the initial An', async () => {
  // CODE1.CPP:317-320 (saveAn)
  const { sim } = await run('quirks', { caseNumber: 12 });
  assert.equal(sim.getRegister(Reg.D1), 0x00006000);
  assert.equal(sim.getRegister(Reg.D2), 0x00005FF8);
});

test('BCHG with an immediate destination is accepted', async () => {
  // CODE7.CPP:256: eff_addr(size, DATA_ADDR, true) for all four bit operations.
  const { sim, host } = await run('quirks', { caseNumber: 13 });
  assert.deepEqual(runMessages(host), []);
  assert.equal(sim.getRegister(Reg.D1) & 0x04, 0x04, 'Z: bit 0 of the immediate was 0');
});

test('MOVEA with an illegal source mode: cycles are added before the mode is rejected', async () => {
  // CODE1.CPP:183-187 reads move_bw_times[12][1] / move_l_times[12][1], one row
  // past the tables.  The port adds what the next table most probably holds:
  // 4 for MOVEA.W, 0 for MOVEA.L (PATCHES.md).
  const word = await run('quirks', { caseNumber: 14 });
  const long = await run('quirks', { caseNumber: 15 });
  assert.deepEqual(runMessages(word.host), ['Illegal instruction found at location 2380. Execution halted']);
  assert.deepEqual(runMessages(long.host), ['Illegal instruction found at location 23c0. Execution halted']);
  assert.equal(word.sim.cycles - long.sim.cycles, 4n);
});

test('DIVS overflow: V set, N Z C unchanged, register unchanged', async () => {
  // CODE4.CPP:198-199: only "SR |= vbit" on overflow.
  const { sim } = await run('quirks', { caseNumber: 16 });
  assert.equal(sim.getRegister(Reg.D0), 0x7FFFFFFF);
  assert.equal(sim.getRegister(Reg.D1) & 0x1F, 0x0F);
});

test('CHK compares the unsigned low word of Dn with the signed bound', async () => {
  // CODE9.CPP:155-161: dest = D[reg] & WORD_MASK is never negative.
  const { sim, host } = await run('quirks', { caseNumber: 17 });
  assert.deepEqual(runMessages(host), ['CHK exception occurred at location 2446. Execution halted']);
  // N from the register word, Z V C inverted (they were 0 after MOVE.L).
  assert.equal(sim.getRegister(Reg.SR) & 0x1F, 0x0F);
});

test('JMP keeps 24 bits of the target address', async () => {
  const { sim } = await run('quirks', { caseNumber: 18 });
  assert.equal(sim.getRegister(Reg.D1), 0x600D600D);
  assert.equal(sim.getRegister(Reg.PC), 0x0000249A);
});

test('MOVE reads its memory destination before (and after) writing it', async () => {
  // eff_addr reads every memory operand (RUN.CPP) and MOVE re-reads the
  // destination for the flags (CODE1.CPP:98).  Visible through a READ
  // breakpoint on an address that the program only writes.
  const { sim, host } = await start('quirks', { caseNumber: 19 });
  sim.setBreakCondition(50, { type: Break.ADDR_TYPE, typeId: 0x3000, op: Break.NA_OP, value: 0, size: Break.WORD, readWrite: Break.READ });
  sim.setBreakExpression(0, { postfix: [50] });
  sim.setBreakCounts({ addresses: 1, expressions: 1 });
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x24C6, 'stopped right after the MOVE');
  assert.deepEqual(runMessages(host), ['break point at 24c6']);
});

test('a long access at $FFFFFE runs past the end of memory and does not wrap', async () => {
  // UTILS.CPP:388-391, 490-491 index memory[loc+2], memory[loc+3] unmasked.
  // The port has padding there (PATCHES.md).
  const { sim } = await run('quirks', { caseNumber: 20 });
  assert.equal(sim.getRegister(Reg.D1), 0x11223344, 'the long reads back whole');
  assert.equal(sim.getRegister(Reg.D2), 0xFFFF1122, 'only two of its bytes are 68000 memory');
  assert.equal(sim.getRegister(Reg.D3) & 0xFF, 0xFF, 'address 0 was not touched');
});

test('the top byte of an address is ignored', async () => {
  const { sim } = await run('quirks', { caseNumber: 21 });
  assert.equal(sim.getRegister(Reg.D1), 0xAABBCCDD);
});

test('SIMHALT leaves the PC behind both $FFFF words and adds no cycles', async () => {
  const { sim } = await start('quirks', { caseNumber: 22 });
  sim.cmdRunToAddress(0x2582);
  sim.run(1000);
  const cycles = sim.cycles;
  sim.cmdRun();
  sim.run(1000);
  assert.equal(sim.getRegister(Reg.PC), 0x2586);
  assert.equal(sim.cycles, cycles);
});

test('trace line of an opcode without a table entry names the next group: $71xx shows SBCD', async () => {
  // RUN.CPP:776 prints inst_arr[i].name with i one past the group.
  const { sim, host } = await start('quirks', { caseNumber: 23 });
  sim.cmdRunToAddress(0x25C0);
  sim.run(1000);
  host.messages.length = 0;
  sim.cmdTraceInto();
  assert.equal(host.messages[0], 'PC=000025C0  Code=7100  SBCD        ');
});

test('STOP with the trace bit set: two trace frames (QUIRK)', async () => {
  // CODE9.CPP:223 returns TRACE_EXCEPTION; exec_inst takes one trace exception
  // for trace_bit and a second one for that result (RUN.CPP:882-888, 919-922).
  const { sim } = await run('quirks', { caseNumber: 24, exceptions: true });
  assert.equal(sim.getRegister(Reg.D0 + 4), 2, 'the trace handler ran twice');
  assert.equal(sim.readLong(RESULTS), 0x261C, 'first return address: the handler itself');
  assert.equal(sim.readLong(RESULTS + 4), 0x2616, 'second: the instruction after STOP');
  assert.equal(sim.state().halt, true, 'and the program went on to SIMHALT instead of stopping');
});

test('Run stops silently when the PC becomes 0 (run-to-address test with no target)', async () => {
  // RUN.CPP:669: if (PC == runToAddr) with runToAddr == 0.
  const { sim, host } = await start('quirks', { caseNumber: 0 });
  sim.writeBytes(0x2000, [0x4E, 0xF8, 0x00, 0x00]); // JMP $0000.W
  sim.writeBytes(0, [0x4E, 0x71, 0x4E, 0x71]);       // NOP NOP at address 0
  sim.cmdRun();
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.equal(sim.getRegister(Reg.PC), 0);
  assert.deepEqual(runMessages(host), []);
  assert.equal(sim.state().halt, false);
  assert.equal(sim.state().trace, true);
  assert.equal(sim.cmdTraceInto(), Status.STOPPED, 'and can be continued');
  assert.equal(sim.getRegister(Reg.PC), 2);
});
