// Exception paths, with exceptions disabled (the default: the simulator halts
// with a message) and enabled (stack frames and vectors).
// Fixture: test/fixtures/exc.X68; case n is at $2000 + n * $40.
// Expected values follow docs/porting/sim-core.md sections 3.4, 3.7-3.9, 3.14.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, start, runMessages, standardMap } from './helpers.mjs';
import { Reg, Option, Status } from '../sim68k.mjs';
import { drive } from './headless-host.mjs';

const prepare = (sim) => standardMap(sim);

// ---------------------------------------------------------------------------
// exceptions disabled: exact message texts
// ---------------------------------------------------------------------------
const HALT_MESSAGES = [
  [0, ['Illegal instruction found at location 2000. Execution halted'], 'ILLEGAL'],
  [1, ['supervisor privilege violation at location 2044. Execution halted'], 'MOVE to SR in user mode'],
  [2, ['CHK exception occurred at location 2082. Execution halted'], 'CHK'],
  [3, ['STOP instruction executed at location 20c0. Execution halted'], 'STOP'],
  [4, ['TRAP exception occurred at location 2100. Execution halted'], 'TRAP #1'],
  [5, ['TRAPV exception occurred at location 2144. Execution halted'], 'TRAPV'],
  [6, ['Divide by zero occurred at location 2182. Execution halted'], 'DIVU #0'],
  // a faulting READ is reported to the instruction: two lines
  [7, ['Address Error: Instruction at 21c0 accessing address 3001', 'Execution halted'], 'odd word read'],
  // a faulting WRITE is not (put() discards the result): one line only
  [8, ['Address Error: Instruction at 2206 accessing address 6ffd'], 'BSR with an odd stack pointer'],
  [9, ['Bus Error: Instruction at 2240 accessing address 5000', 'Execution halted'], 'read in an Invalid range'],
  [10, ['TRACE exception occurred at location 2280. Execution halted'], 'T bit set'],
  [11, ['Line 1010 Emulator exception occurred at location 22c0. Execution halted'], 'line A'],
  [12, ['Line 1111 Emulator exception occurred at location 2300. Execution halted'], 'line F'],
  [13, ['TRAP exception occurred at location 2342. Execution halted'], 'TRAP #15, task 26'],
  [14, ['Illegal instruction found at location 2380. Execution halted'], 'opcode $4E7F matches no table entry'],
  [16, ['Bus Error: Instruction at 2402 accessing address 6000'], 'write into a Read-only range'],
  [22, ['supervisor privilege violation at location 2584. Execution halted'], 'ANDI to SR in user mode'],
  [23, ['Address Error: Instruction at 25c0 accessing address 3001', 'Execution halted'], 'JMP to an odd address reads a word there'],
  [24, ['Illegal instruction found at location 2600. Execution halted'], 'ADDI with an illegal mode'],
  [25, ['supervisor privilege violation at location 2644. Execution halted'], 'STOP in user mode'],
  [26, ['supervisor privilege violation at location 2680. Execution halted'], 'STOP #0: the new SR has no S bit'],
];

test('exceptions disabled: each exception halts with its message', async () => {
  for (const [caseNumber, messages, what] of HALT_MESSAGES) {
    const { sim, host, result } = await run('exc', { caseNumber, prepare });
    assert.equal(result.reason, 'stopped', what);
    assert.deepEqual(runMessages(host), messages, what);
    assert.equal(sim.state().halt, true, what);
    assert.equal(sim.readWord(0x4000), 0xFFFF, `${what}: no vector was taken`);
  }
});

test('exceptions disabled: state after particular halts', async () => {
  // STOP: the hardware is disabled and the PC is behind the STOP operand.
  let r = await run('exc', { caseNumber: 3, prepare });
  assert.equal(r.sim.getRegister(Reg.PC), 0x20C4);
  assert.equal(r.sim.state().hardwareEnabled, false);

  // STOP #0 changes SR before it fails (QUIRK, CODE9.CPP:216-221).
  r = await run('exc', { caseNumber: 26, prepare });
  assert.equal(r.sim.getRegister(Reg.SR), 0x0000);

  // A write fault does not stop the instruction: BSR still branches.
  r = await run('exc', { caseNumber: 8, prepare });
  assert.equal(r.sim.getRegister(Reg.PC), 0x220A);
  assert.equal(r.sim.getRegister(Reg.SSP), 0x6FFD);

  // An illegal instruction, CHK ... leave the hardware enabled.
  r = await run('exc', { caseNumber: 0, prepare });
  assert.equal(r.sim.state().hardwareEnabled, true);
  // Address and bus errors disable it (haltSimulator).
  r = await run('exc', { caseNumber: 7, prepare });
  assert.equal(r.sim.state().hardwareEnabled, false);
});

test('a ROM range swallows writes silently', async () => {
  const { sim, host } = await run('exc', { caseNumber: 17, prepare });
  assert.deepEqual(runMessages(host), []);
  assert.equal(sim.getRegister(Reg.D1) & 0xFF, 0xFF, 'the byte in ROM is still $FF');
  assert.equal(sim.readByte(0x7000), 0xFF);
});

test('SIMHALT stops silently; with simhalt off the same bytes are a line-F exception', async () => {
  let r = await run('exc', { caseNumber: 21, prepare });
  assert.deepEqual(runMessages(r.host), []);
  assert.equal(r.sim.getRegister(Reg.PC), 0x2544, 'PC is past both $FFFF words');
  assert.equal(r.sim.state().hardwareEnabled, false);

  r = await run('exc', { caseNumber: 21, prepare: (sim) => sim.setOption(Option.SIMHALT, 0) });
  assert.deepEqual(runMessages(r.host), ['Line 1111 Emulator exception occurred at location 2540. Execution halted']);
});

test('RTS with an empty stack: the worked example of sim-core.md 3.14', async () => {
  const { sim, host } = await run('exc', { caseNumber: 15, prepare });
  // RTS pops $FFFFFFFF from address 0 (the stack pointer $01000000 is masked).
  // The next fetch fails: exactly one line, without "Execution halted".
  assert.deepEqual(runMessages(host), ['Address Error: Instruction at ffffffff accessing address ffffffff']);
  assert.equal(sim.getRegister(Reg.PC), 0xFFFFFFFF);
  assert.equal(sim.getRegister(Reg.SSP), 0x01000004);
  // Pause, then Run again: the same line, then the double-fault line.
  sim.cmdPause();
  sim.cmdRun();
  drive(sim, host);
  assert.deepEqual(runMessages(host), [
    'Address Error: Instruction at ffffffff accessing address ffffffff',
    'Address Error: Instruction at ffffffff accessing address ffffffff',
    'Address or Bus error during exception processing. Execution halted',
  ]);
});

// ---------------------------------------------------------------------------
// exceptions enabled: vectors and stack frames
// ---------------------------------------------------------------------------
/** What the handler stub recorded. */
function frame(sim) {
  return {
    vector: sim.readWord(0x4000),
    ssp: sim.readLong(0x4002),
    words: Array.from({ length: 8 }, (_, i) => sim.readWord(0x4006 + 2 * i)),
  };
}

// 6-byte frames: [case, vector address, stacked SR, stacked PC, what]
const SHORT_FRAMES = [
  [0, 0x10, 0x2004, 0x2000, 'illegal instruction: PC of the opcode'],
  [1, 0x20, 0x0000, 0x2046, 'privilege violation: PC is opcode + 2 (QUIRK: a 68000 stacks the opcode address)'],
  [2, 0x18, 0x2007, 0x2086, 'CHK: PC after the instruction'],
  [4, 0x84, 0x2000, 0x2102, 'TRAP #1'],
  [5, 0x1C, 0x2002, 0x2146, 'TRAPV'],
  [6, 0x14, 0x2000, 0x2186, 'divide by zero'],
  [10, 0x24, 0xA000, 0x2286, 'trace: taken after the instruction that follows the one setting T'],
  [11, 0x28, 0x2000, 0x22C2, 'line A: PC is opcode + 2 (QUIRK)'],
  [12, 0x2C, 0x2000, 0x2302, 'line F: PC is opcode + 2 (QUIRK)'],
  [13, 0xBC, 0x2000, 0x2344, 'TRAP #15 with an unserved task goes through vector $BC'],
  [14, 0x10, 0x2000, 0x2380, 'opcode without a table entry'],
  [22, 0x20, 0x0000, 0x2586, 'ANDI to SR: checked before the immediate is fetched, PC points at it'],
  [24, 0x10, 0x2000, 0x2602, 'illegal mode found after the immediate was fetched: PC - 2 is not the opcode'],
  [25, 0x20, 0x0000, 0x2648, 'STOP in user mode: PC is opcode + 4'],
  [26, 0x20, 0x0000, 0x2684, 'STOP #0'],
];

test('exceptions enabled: six-byte frames', async () => {
  for (const [caseNumber, vector, sr, pc, what] of SHORT_FRAMES) {
    const { sim, host } = await run('exc', { caseNumber, prepare, exceptions: true });
    const f = frame(sim);
    assert.equal(f.vector, vector, `${what}: vector`);
    assert.equal(f.ssp, 0x7FFA, `${what}: six bytes pushed`);
    assert.equal(f.words[0], sr, `${what}: stacked SR`);
    assert.equal((f.words[1] << 16 | f.words[2]) >>> 0, pc, `${what}: stacked PC`);
    assert.deepEqual(runMessages(host), [], what);
  }
});

// 14-byte frames: [case, vector, info word, access address, instruction register, SR, PC, what]
const LONG_FRAMES = [
  [7, 0x0C, 0x0015, 0x00003001, 0x3038, 0x2000, 0x21C4, 'address error on a read: R/W = read, PC at the fault'],
  [9, 0x08, 0x0005, 0x00005000, 0x1038, 0x2000, 0x2242, 'bus error on a READ is stacked as a write (QUIRK); PC = opcode + 2'],
  [16, 0x08, 0x0005, 0x00006000, 0x11C0, 0x2000, 0x2404, 'bus error on a write into a Read-only range'],
  [23, 0x0C, 0x0015, 0x00003001, 0x4EF9, 0x2000, 0x25C6, 'JMP to an odd address: a read address error in the JMP'],
];

test('exceptions enabled: fourteen-byte frames of address and bus errors', async () => {
  for (const [caseNumber, vector, info, address, ir, sr, pc, what] of LONG_FRAMES) {
    const { sim } = await run('exc', { caseNumber, prepare, exceptions: true });
    const f = frame(sim);
    assert.equal(f.vector, vector, `${what}: vector`);
    assert.equal(f.ssp, 0x7FF2, `${what}: fourteen bytes pushed`);
    assert.equal(f.words[0], info, `${what}: information word`);
    assert.equal((f.words[1] << 16 | f.words[2]) >>> 0, address, `${what}: access address`);
    assert.equal(f.words[3], ir, `${what}: instruction register`);
    assert.equal(f.words[4], sr, `${what}: SR`);
    assert.equal((f.words[5] << 16 | f.words[6]) >>> 0, pc, `${what}: PC`);
  }
});

test('exceptions enabled: STOP halts once with its own message and keeps the hardware enabled', async () => {
  const { sim, host } = await run('exc', { caseNumber: 3, prepare, exceptions: true });
  assert.deepEqual(runMessages(host), ['STOP instruction. Execution halted']);
  const state = sim.state();
  assert.equal(state.stopInstruction, true);
  assert.equal(state.hardwareEnabled, true);
  assert.equal(sim.getRegister(Reg.PC), 0x20C4);
});

test('exceptions enabled: an uninitialised vector leads into the address-error handler', async () => {
  // TRAP #2 loads PC = $FFFFFFFF; the fetch there is an address error, whose
  // vector is valid in this fixture.  The frame names the PREVIOUS opcode
  // (TRAP #2 = $4E42) because the failed fetch left "inst" unchanged, and
  // the access is "program" (function code 6) because it is the fetch itself.
  const { sim } = await run('exc', { caseNumber: 18, prepare, exceptions: true });
  const f = frame(sim);
  assert.equal(f.vector, 0x0C);
  assert.equal(f.ssp, 0x7FEC, '6 + 14 bytes');
  assert.deepEqual(f.words.slice(0, 7), [0x0016, 0xFFFF, 0xFFFF, 0x4E42, 0x2000, 0xFFFF, 0xFFFF]);
});

test('exceptions enabled: double fault halts with the message of runprog', async () => {
  const { sim, host } = await run('exc', { caseNumber: 27, prepare, exceptions: true });
  assert.deepEqual(runMessages(host), ['Address or Bus error during exception processing. Execution halted']);
  assert.equal(sim.getRegister(Reg.PC), 0xFFFFFFFF);
  assert.equal(sim.getRegister(Reg.SSP), 0x8000 - 6 - 14 - 14, 'one trap frame and two address-error frames');
  assert.equal(sim.state().hardwareEnabled, true, 'this halt does not disable the hardware');
});

test('exceptions enabled: a zero vector stops silently at address 0 (run-to-address quirk)', async () => {
  // runprog tests "PC == runToAddr" unconditionally and runToAddr is 0 when
  // unused (RUN.CPP:669), so reaching PC = 0 switches to trace mode.
  const { sim, host } = await run('exc', { caseNumber: 19, prepare, exceptions: true });
  assert.deepEqual(runMessages(host), []);
  assert.equal(sim.getRegister(Reg.PC), 0);
  const state = sim.state();
  assert.equal(state.trace, true);
  assert.equal(state.halt, false);
  assert.equal(sim.getRegister(Reg.SSP), 0x7FFA, 'the frame was pushed');
});

test('exceptions enabled: an odd supervisor stack pointer stops exception processing', async () => {
  const { sim, host } = await run('exc', { caseNumber: 20, prepare, exceptions: true });
  assert.deepEqual(runMessages(host), [
    'Error during Exception Handler: SSP odd or outside memory space ',
    'at location 7001',
  ]);
  assert.equal(sim.getRegister(Reg.SSP), 0x7001, 'nothing was pushed');
  assert.equal(sim.getRegister(Reg.SR), 0x2000, 'SR unchanged');
  assert.equal(sim.state().trace, true);
  assert.notEqual(sim.getRegister(Reg.PC), 0x2508, 'the vector was already loaded');
});

test('exceptions enabled: write fault with a bad stack: the instruction still completes', async () => {
  // BSR with A7 = $7001 (exc case 8): mem_put loads the address-error vector,
  // exceptionHandler refuses the odd SSP, and BSR then overwrites the PC.
  const { sim, host } = await run('exc', { caseNumber: 8, prepare, exceptions: true });
  assert.deepEqual(runMessages(host), [
    'Error during Exception Handler: SSP odd or outside memory space ',
    'at location 6ffd',
  ]);
  assert.equal(sim.getRegister(Reg.PC), 0x220A);
});

test('exceptions enabled: cycle cost of exception processing', async () => {
  // Same program up to the exception; the difference between "off" and "on"
  // is the exception time plus the handler stub (identical for all vectors).
  const cost = async (caseNumber) => {
    const off = await run('exc', { caseNumber, prepare });
    const on = await run('exc', { caseNumber, prepare, exceptions: true });
    return Number(on.sim.cycles - off.sim.cycles);
  };
  const illegal = await cost(0);
  assert.equal(await cost(4) - illegal, 38 - 34, 'TRAP costs 38, illegal 34');
  assert.equal(await cost(6) - illegal, 42 - 34, 'divide by zero costs 42');
  assert.equal(await cost(2) - illegal, 44 - 34, 'CHK costs 44');
  assert.equal(await cost(11) - illegal, 0, 'line A costs 34');
  assert.equal(await cost(7) - illegal, 50 - 34, 'address error costs 50');
});

test('trace mode: Status.STOPPED after each step and the trace line in the message area', async () => {
  const { sim, host } = await start('exc', { caseNumber: 14, prepare });
  // run up to the case code
  sim.cmdRunToAddress(0x2380);
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x2380);
  host.messages.length = 0;
  assert.equal(sim.cmdTraceInto(), Status.STOPPED);
  // For an opcode that matches no entry the name printed is that of the
  // first entry of the NEXT group: "DBCC" for group 4 (QUIRK, RUN.CPP:776).
  assert.deepEqual(host.messages, [
    'PC=00002380  Code=4E7F  DBCC        ',
    'Illegal instruction found at location 2380. Execution halted',
  ]);
});
