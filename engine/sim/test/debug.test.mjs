// Debugger behaviour: PC breakpoints, advanced breakpoints, Step Over, Run To
// Cursor, Trace Into, Auto Trace, the execution log, the register boxes and
// the "displayed SR" used by the Protected memory range.
// Fixture: test/fixtures/debug.X68 (addresses are in debug.L68).
// Specification: docs/porting/sim-core.md sections 3.1-3.3, 5.4, 7 and 8.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, run, runMessages, fixture } from './helpers.mjs';
import { createSim, Reg, Box, Status, Option, Break, MapKind, Menu, bytesToText } from '../sim68k.mjs';
import { HeadlessHost, drive } from './headless-host.mjs';

const lines = bytesToText(fixture('debug.L68')).split('\r\n');
const lineIndex = (prefix) => lines.findIndex((l, i) => i > 3 && l.startsWith(prefix) && l[10] !== ' ');

// ---------------------------------------------------------------------------
// PC breakpoints
// ---------------------------------------------------------------------------
test('the breakpoint from the listing directive stops before its instruction', async () => {
  const { sim, host, result } = await run('debug');
  assert.equal(result.reason, 'stopped');
  assert.equal(sim.getRegister(Reg.PC), 0x101E);
  assert.deepEqual(runMessages(host), ['break point at 101e']);
  const state = sim.state();
  assert.deepEqual([state.trace, state.halt, state.runMode], [true, false, false]);
  assert.equal(sim.getRegister(Reg.D0 + 3), 0, 'MOVE.W VALUE,D3 has not run');
  assert.equal(host.menu, Menu.ACTIVE);
  assert.equal(sim.listingHighlight, lineIndex('0000101E'));
  // Run again: a breakpoint on the instruction where execution resumes does not trigger.
  sim.cmdRun();
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.equal(sim.state().halt, true);
  assert.equal(sim.getRegister(Reg.D0 + 3), 0x1234);
  assert.equal(host.menu, Menu.TRACE, 'after a halt only Pause, Rewind and Close are available');
});

test('a breakpoint inside the loop stops on every pass', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  assert.equal(sim.setBreakpoint(0x1010), true);
  assert.equal(sim.setBreakpoint(0x1010), true, 'setting it twice is harmless');
  assert.deepEqual(sim.breakpoints(), [0x1010]);
  const counts = [];
  for (let i = 0; i < 3; i++) {
    sim.cmdRun();
    drive(sim, host);
    assert.equal(sim.getRegister(Reg.PC), 0x1010);
    counts.push(sim.readLong(0x2000));
  }
  assert.deepEqual(counts, [1, 2, 3]);
  assert.deepEqual(runMessages(host), ['break point at 1010', 'break point at 1010', 'break point at 1010']);
  sim.clearBreakpoint(0x1010);
  sim.clearBreakpoint(0x9999); // not in the table: ignored
  assert.deepEqual(sim.breakpoints(), []);
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.state().halt, true);
});

test('the breakpoint table holds 100 entries; the 101st shows a message box', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  for (let i = 0; i < 100; i++) assert.equal(sim.setBreakpoint(0x8000 + 2 * i), true);
  assert.equal(sim.setBreakpoint(0x9000), false);
  assert.deepEqual(host.alerts, [{ title: 'Error', text: 'Breakpoint Limit Reached!' }]);
  assert.equal(sim.breakpoints().length, 100);
});

// ---------------------------------------------------------------------------
// Trace Into, Step Over, Run To Cursor, Pause
// ---------------------------------------------------------------------------
test('Trace Into executes one instruction and prints its trace line', async () => {
  const { sim, host } = await start('debug');
  const pcs = [];
  for (let i = 0; i < 5; i++) {
    assert.equal(sim.cmdTraceInto(), Status.STOPPED);
    pcs.push(sim.getRegister(Reg.PC));
  }
  assert.deepEqual(pcs, [0x1002, 0x1004, 0x1006, 0x102A, 0x102C], 'Trace Into follows the BSR');
  assert.deepEqual(runMessages(host), [
    'PC=00001000  Code=7000  MOVEQ       ',
    'PC=00001002  Code=7203  MOVEQ       ',
    'PC=00001004  Code=5280  ADDQ        ',
    'PC=00001006  Code=6100  BSR         ',
    'PC=0000102A  Code=5285  ADDQ        ',
  ]);
  assert.equal(host.registersShownCount >= 5, true, 'the display is refreshed after every step');
  assert.equal(sim.boxText(Box.PC), '0000102C');
  assert.equal(sim.listingHighlight, lineIndex('0000102C'));
});

test('Step Over runs a subroutine as one step and is a plain step elsewhere', async () => {
  const { sim, host } = await start('debug');
  const step = () => {
    sim.cmdStepOver();
    assert.equal(drive(sim, host).reason, 'stopped');
    return sim.getRegister(Reg.PC);
  };
  assert.equal(step(), 0x1002);
  assert.equal(step(), 0x1004);
  assert.equal(step(), 0x1006);
  assert.equal(step(), 0x100A, 'over the BSR');
  assert.equal(sim.getRegister(Reg.D0 + 5), 2, 'the subroutine ran');
  assert.deepEqual(runMessages(host).at(-1), 'PC=00001006  Code=6100  BSR         ', 'nothing inside the subroutine is traced');
  assert.equal(sim.state().stepToAddr, 0);
});

test('Step Over stops at a breakpoint inside the subroutine', async () => {
  const { sim, host } = await start('debug');
  sim.setBreakpoint(0x102C);
  sim.cmdRunToAddress(0x1006);
  drive(sim, host);
  sim.cmdStepOver();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x102C);
  assert.equal(runMessages(host).at(-1), 'break point at 102c');
});

test('Run To Cursor stops at the selected line, silently and once', async () => {
  const { sim, host } = await start('debug');
  sim.cmdRunToCursor(lineIndex('0000100A'));
  assert.equal(sim.state().runToAddr, 0x100A);
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x100A);
  assert.deepEqual(runMessages(host), []);
  assert.equal(sim.state().runToAddr, 0, 'used up');
  assert.equal(sim.state().trace, true);
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x101E, 'the next Run goes on to the breakpoint');
});

test('Run To Cursor on a line without code shows a box and runs anyway', async () => {
  const { sim, host } = await start('debug');
  sim.cmdRunToCursor(5); // a comment line
  assert.equal(sim.run(1000), Status.WAIT_ALERT);
  assert.deepEqual(host.alerts, [{ title: 'Error', text: 'Selected line does not have a valid address.' }]);
  sim.dismissAlert();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x101E);

  const other = await start('debug');
  other.sim.cmdRunToCursor(-1); // nothing selected
  assert.deepEqual(other.host.alerts, [{ title: 'Error', text: 'Invalid Run-To-Cursor Selection' }]);
});

test('Pause stops a running program between two instructions', async () => {
  const { sim, host } = await start('irq', { caseNumber: 0 });
  sim.cmdRun();
  assert.equal(host.menu, Menu.TRACE);
  assert.equal(sim.run(500), Status.RUNNING);
  const shown = host.registersShownCount;
  sim.cmdPause();
  assert.equal(sim.run(500), Status.STOPPED);
  assert.equal(host.registersShownCount, shown + 1);
  assert.equal(host.menu, Menu.ACTIVE);
  assert.equal(sim.state().trace, true);
  assert.equal(sim.boxText(Box.PC), sim.getRegister(Reg.PC).toString(16).toUpperCase().padStart(8, '0'));
});

test('Auto Trace: one step per timer tick; a halt switches the timer off', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.cmdAutoTrace();
  assert.equal(host.autoTraceTimerOn, true);
  let ticks = 0;
  while (host.autoTraceTimerOn && ticks < 1000) {
    assert.equal(sim.autoTraceTick(), Status.STOPPED);
    ticks++;
  }
  assert.equal(sim.state().halt, true);
  assert.equal(sim.getRegister(Reg.PC), 0x102A, 'SIMHALT at $1026 leaves the PC behind it');
  // 2 + 3 * (ADDQ BSR ADDQ ADDQ RTS MOVE SUBQ BNE) + MOVE.B JSR ADDQ ADDQ RTS MOVE.W NOP SIMHALT
  assert.equal(ticks, 2 + 3 * 8 + 8);
  assert.equal(sim.stepCount, ticks);
});

// ---------------------------------------------------------------------------
// advanced breakpoints
// ---------------------------------------------------------------------------
test('register condition: D0 == 2', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.setBreakCondition(0, { type: Break.PC_REG_TYPE, typeId: 0, op: Break.EQUAL, value: 2, size: Break.LONG });
  sim.setBreakExpression(0, { postfix: [0] });
  sim.setBreakCounts({ registers: 1, expressions: 1 });
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x1006, 'right after the ADDQ that made D0 = 2');
  assert.deepEqual(runMessages(host), ['break point at 1006']);
});

test('hit count: the expression must be true on that many steps', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.setBreakCondition(0, { type: Break.PC_REG_TYPE, typeId: 0, op: Break.EQUAL, value: 2, size: Break.LONG });
  sim.setBreakExpression(0, { postfix: [0], count: 3 });
  sim.setBreakCounts({ registers: 1, expressions: 1 });
  sim.cmdRun();
  drive(sim, host);
  // D0 is 2 after the steps ending at $1006, $102A, $102C: the third one breaks.
  assert.equal(sim.getRegister(Reg.PC), 0x102C);
});

test('PC condition combined with a register condition: AND and OR in postfix', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.setBreakCondition(0, { type: Break.PC_REG_TYPE, typeId: Break.PC_TYPE_ID, op: Break.EQUAL, value: 0x1010, size: Break.LONG });
  sim.setBreakCondition(1, { type: Break.PC_REG_TYPE, typeId: 1, op: Break.LT_EQUAL, value: 2, size: Break.LONG });
  sim.setBreakExpression(0, { postfix: [0, 1, Break.AND] });
  sim.setBreakCounts({ registers: 2, expressions: 1 });
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x1010);
  assert.equal(sim.getRegister(Reg.D1), 2, 'second pass: D1 is 3 on the first');
  assert.equal(sim.setBreakExpression(1, { postfix: [0, Break.AND] }), false, 'a postfix that would pop an empty stack is refused');
  assert.equal(sim.setBreakExpression(1, { postfix: [0, 1, Break.OR] }), true);
});

test('memory conditions see only the LAST read and the LAST write of an instruction', async () => {
  const condition = (readWrite) => async () => {
    const { sim, host } = await start('debug');
    sim.clearAllBreakpoints();
    sim.setBreakCondition(50, { type: Break.ADDR_TYPE, typeId: 0x2000, op: Break.NA_OP, value: 0, size: Break.LONG, readWrite });
    sim.setBreakExpression(0, { postfix: [50] });
    sim.setBreakCounts({ addresses: 1, expressions: 1 });
    sim.cmdRun();
    drive(sim, host);
    return sim.getRegister(Reg.PC);
  };
  // MOVE.L D0,COUNT reads COUNT (before and after the write) and writes it.
  assert.equal(await condition(Break.RW)(), 0x1010, 'read or write');
  assert.equal(await condition(Break.READ)(), 0x1010, 'the destination of a MOVE counts as read');
  // BPoint::isBreak tests "read" first and only then "write" (else if), so a
  // location that was both read and written is never a "write" (QUIRK).
  assert.equal(await condition(Break.WRITE)(), 0x102A, 'the write-only condition never fires: the program runs to SIMHALT');
});

test('a write condition fires for a pure write (the return address pushed by BSR)', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.setBreakCondition(50, { type: Break.ADDR_TYPE, typeId: 0x00FFFFFC, op: Break.EQUAL, value: 0x0000100A, size: Break.LONG, readWrite: Break.WRITE });
  sim.setBreakExpression(0, { postfix: [50] });
  sim.setBreakCounts({ addresses: 1, expressions: 1 });
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x102A, 'stopped at the first instruction of the subroutine');
  assert.equal(sim.state().halt, false);
});

test('Run resets the hit counters; a count of 0 breaks on every step until the expression is first true (QUIRK)', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.setBreakCondition(0, { type: Break.PC_REG_TYPE, typeId: 0, op: Break.EQUAL, value: 1, size: Break.LONG });
  sim.setBreakExpression(0, { postfix: [0], count: 0 });
  sim.setBreakCounts({ registers: 1, expressions: 1 });
  const stops = [];
  for (let i = 0; i < 4; i++) {
    sim.cmdRun();
    drive(sim, host);
    stops.push(sim.getRegister(Reg.PC));
  }
  // count == counter (0 == 0) on every step while D0 has not been 1 yet: the
  // first two runs stop after one instruction each.  In the third run D0
  // becomes 1, the counter leaves 0 and never returns: the program runs to
  // SIMHALT (PC behind it: $102A).  Run resets the counter, so the fourth
  // run stops after one instruction again.
  assert.deepEqual(stops, [0x1002, 0x1004, 0x102A, 0x102C]);
});

// ---------------------------------------------------------------------------
// execution log
// ---------------------------------------------------------------------------
const labelled = (line) => 'PC=' + line.slice(0, 10) + 'Code=' + line.slice(10, 33) + 'Line=' + line.slice(33);

test('execution log, type 1: header, then one listing line per traced instruction, CR LF line ends', async () => {
  const { sim, host } = await start('debug');
  sim.setOption(Option.EXEC_LOG_TYPE, 1);
  sim.startLog('11/20/2026 1:07:46 PM');
  assert.equal(host.logging, true);
  for (let i = 0; i < 3; i++) sim.cmdTraceInto();
  sim.stopLog();
  assert.equal(host.logging, false);
  assert.equal(host.execLogText, [
    'EASy68K execution log file: 11/20/2026 1:07:46 PM',
    '',
    labelled(lines[lineIndex('00001000')]),
    labelled(lines[lineIndex('00001002')]),
    labelled(lines[lineIndex('00001004')]),
    '',
  ].join('\r\n'));
  assert.equal(labelled(lines[lineIndex('00001000')]),
    'PC=00001000  Code=7000' + ' '.repeat(19) + 'Line=   11  START:  MOVEQ   #0,D0');
});

test('execution log, type 2: the register block is written before the instruction executes', async () => {
  const { sim, host } = await start('debug');
  sim.setOption(Option.EXEC_LOG_TYPE, 2);
  sim.startLog('T');
  sim.cmdTraceInto();
  sim.cmdTraceInto();
  sim.cmdTraceInto();
  const log = host.execLogText.split('\r\n');
  assert.deepEqual(log.slice(0, 8), [
    'EASy68K execution log file: T',
    '',
    '',
    'D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC',
    'D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000',
    'D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000',
    'D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000',
    labelled(lines[lineIndex('00001000')]),
  ]);
  // third record: after MOVEQ #0,D0 (Z set) and MOVEQ #3,D1
  assert.equal(log[16], 'D1=00000003 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000');
  assert.equal(log[10], 'D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000100');
});

test('execution log, type 3: memory rows of 16 bytes; bytes from $80 show as "-"', async () => {
  const { sim, host } = await start('debug');
  sim.setOption(Option.EXEC_LOG_TYPE, 3);
  sim.setOption(Option.LOG_MEM_FROM, 0x1005); // rounded down to $1000
  sim.setOption(Option.LOG_MEM_BYTES, 0x11);  // rounded up to $20
  sim.writeBytes(0x101C, [0x41, 0x7F, 0x80, 0x1F]); // 'A', DEL, a byte >= $80, a control code (not executed here)
  sim.startLog('T');
  sim.cmdTraceInto();
  const log = host.execLogText.split('\r\n');
  assert.equal(log[2], '');
  assert.equal(log[3], '00001000: 70 00 72 03 52 80 61 00 00 22 23 C0 00 00 20 00 p-r-R-a--"#--- -');
  // signed char comparison "memory[..] >= ' '": $7F prints as itself, $80-$FF as "-"
  assert.equal(log[4], '00001010: 53 81 66 F0 14 3C 00 0A 4E B9 00 00 41 7F 80 1F S-f--<--N---A\x7F--');
  assert.equal(log[5], '');
  assert.equal(log[6].startsWith('D0=00000000'), true);
});

test('execution log: a "%" in the source line is written literally', async () => {
  const { sim, host } = await start('debug');
  sim.cmdRunToAddress(0x1014);
  drive(sim, host);
  sim.setOption(Option.EXEC_LOG_TYPE, 1);
  sim.startLog('T');
  sim.cmdTraceInto();
  assert.equal(host.execLogText.split('\r\n')[2],
    'PC=00001014  Code=143C 000A' + ' '.repeat(14) + 'Line=   18          MOVE.B  #%1010,D2');
});

test('execution log: only single-stepped instructions are logged; Step Over logs the call only', async () => {
  const { sim, host } = await start('debug');
  sim.setOption(Option.EXEC_LOG_TYPE, 1);
  sim.startLog('T');
  sim.cmdRunToAddress(0x1006);
  drive(sim, host); // free run: nothing logged
  assert.equal(host.execLogText.split('\r\n').length, 3);
  sim.cmdStepOver();
  drive(sim, host);
  assert.deepEqual(host.execLogText.split('\r\n').slice(2), [labelled(lines[lineIndex('00001006')]), '']);
});

test('execution log: the listing search, including its misses, against an independent implementation', async () => {
  // lineToLog (SIM68Ku.cpp:869) does a binary search over ALL listing lines
  // from index 3, including blank lines and the summary lines at the end,
  // which are not in address order; so it can miss a line that exists, and
  // then the short form "PC=... Code=... NAME" is written instead.
  const listing = lines.slice(0, lines.at(-1) === '' ? -1 : undefined);
  const expectedLine = (pc, shortForm) => {
    const key = pc.toString(16).toUpperCase().padStart(8, '0');
    let bot = listing.length, top = 3, mid, found = false;
    do {
      mid = Math.floor((bot - top) / 2) + top;
      const prefix = listing[mid].slice(0, 8);
      if (key === prefix) found = true;
      else if (key < prefix) bot = mid - 1;
      else top = mid + 1;
    } while (!found && top <= bot);
    if (!found) return shortForm;
    do { mid++; } while (listing[mid].slice(0, 8) === key);
    return labelled(listing[mid - 1]);
  };
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.setOption(Option.EXEC_LOG_TYPE, 1);
  sim.startLog('T');
  const expectedLog = [];
  let status;
  do {
    const pc = sim.getRegister(Reg.PC);
    host.messages.length = 0;
    status = sim.cmdTraceInto();
    expectedLog.push(expectedLine(pc, host.messages[0])); // messages[0] is the trace line = the short form
  } while (status === Status.STOPPED && !sim.state().halt);
  assert.equal(status, Status.WAIT_ALERT, 'SIMHALT stops the log with a message box');
  assert.deepEqual(host.alerts, [{ title: 'Information', text: 'Current Log Stopped.' }]);
  sim.dismissAlert();
  assert.equal(sim.run(0), Status.STOPPED);
  assert.deepEqual(host.execLogText.split('\r\n').slice(2, -1), expectedLog);
  assert.equal(expectedLog.length, 34);
  assert.equal(expectedLog.at(-1).includes('SIMHALT'), true);
});

test('execution log: Rewind and Reload write their note only if the log dialog saw a log type (QUIRK)', async () => {
  const { sim, host } = await start('debug');
  sim.setOption(Option.EXEC_LOG_TYPE, 1);
  sim.startLog('T');
  sim.rewind();
  assert.equal(host.execLogText.includes('Reset Program'), false, 'the dialog was never opened with a type selected');
  sim.logDialogOpened(); // TLog::FormShow remembers ElogFlag = 1
  sim.rewind();
  sim.load(fixture('debug.S68'), fixture('debug.L68'), { kind: 'reload' });
  assert.equal(host.execLogText.endsWith('\r\n***** Reset Program Pressed *****\r\n\r\n***** Reload Program Pressed *****\r\n'), true);
  assert.equal(sim.state().logging, true, 'neither stops the log');
  sim.load(fixture('debug.S68'), fixture('debug.L68'), { kind: 'open' });
  assert.equal(sim.state().logging, false, 'File > Open does');
  assert.deepEqual(host.alerts, [{ title: 'Information', text: 'Current Log Stopped.' }]);
});

// ---------------------------------------------------------------------------
// register boxes and the displayed SR
// ---------------------------------------------------------------------------
test('register boxes: D, SR and PC edits are taken over by the next run command only', async () => {
  const { sim, host } = await start('debug');
  assert.equal(sim.boxText(Box.SR), '0010000000000000');
  assert.equal(sim.editBox(Box.D0 + 4, '0000BEEF'), true);
  assert.equal(sim.getRegister(Reg.D0 + 4), 0, 'not yet');
  assert.equal(sim.cmdTraceInto(), Status.STOPPED); // loadRegs()
  assert.equal(sim.getRegister(Reg.D0 + 4), 0xBEEF);

  sim.editBox(Box.D0 + 6, '12345678');
  sim.cmdPause(); // scrshow() refreshes the boxes from the registers: the edit is lost
  assert.equal(sim.boxText(Box.D0 + 6), '00000000');

  sim.editBox(Box.PC, '0000100A');
  assert.equal(sim.getRegister(Reg.PC), 0x1002, 'PC variable unchanged');
  assert.equal(sim.listingHighlight, lineIndex('0000100A'), 'but the highlight follows the box');
  sim.cmdTraceInto();
  assert.equal(sim.getRegister(Reg.PC), 0x1010, 'executed MOVE.L D0,COUNT at the edited PC');
  assert.equal(sim.editBox(Box.D0, 'XYZ'), true, 'not hexadecimal: accepted as text ...');
  assert.equal(sim.cmdTraceInto(), Status.WAIT_ALERT, '... and refused when the registers are loaded');
  sim.dismissAlert();
});

test('register boxes: address registers are written through at once', async () => {
  const { sim } = await start('debug');
  sim.editBox(Box.A0 + 2, '00004444');
  assert.equal(sim.getRegister(Reg.A0 + 2), 0x4444);
  // supervisor mode is displayed: A7 is the SS box
  sim.editBox(Box.A7, '00009000');
  assert.equal(sim.getRegister(Reg.SSP), 0x9000);
  assert.equal(sim.boxText(Box.SS), '00009000');
  sim.editBox(Box.US, '00008000');
  assert.equal(sim.getRegister(Reg.USP), 0x8000);
  assert.equal(sim.boxText(Box.A7), '00009000', 'A7 box unchanged: user mode is not displayed');
  // clearing the S bit in the SR box re-displays A7 from the user stack pointer
  sim.editBox(Box.SR, '0000000000000000');
  assert.equal(sim.boxText(Box.A7), '00008000');
  assert.equal(sim.getRegister(Reg.SR), 0x2000, 'SR itself changes at the next run command');
});

test('setRegister writes register and box; PC does not touch OLD_PC', async () => {
  const { sim } = await start('debug');
  sim.setRegister(Reg.D0 + 2, 0xCAFE);
  sim.setRegister(Reg.SR, 0x0700);
  sim.setRegister(Reg.PC, 0x1004);
  assert.equal(sim.boxText(Box.D0 + 2), '0000CAFE');
  assert.equal(sim.boxText(Box.SR), '0000011100000000');
  assert.equal(sim.boxText(Box.PC), '00001004');
  assert.equal(sim.getRegister(Reg.OLD_PC), 0xFFFFFFFF);
  sim.setRegister(Reg.A7, 0x6000); // user mode now: A7 is the USP
  assert.equal(sim.getRegister(Reg.USP), 0x6000);
  assert.equal(sim.boxText(Box.US), '00006000');
});

test('the cycle display shows the low 32 bits; Clear Cycles', async () => {
  const { sim, host } = await run('debug');
  assert.equal(sim.cyclesText, String(sim.cycles));
  sim.clearCycles();
  assert.equal(sim.cycles, 0n);
  assert.equal(sim.cyclesText, '0');
  assert.equal(host.registersShownCount > 0, true);
});

test('Protected range: the supervisor test uses the DISPLAYED S bit (QUIRK)', async () => {
  // ANDI #$DFFF,SR ; MOVE.B $6000,D0 ; SIMHALT
  const program = [0x02, 0x7C, 0xDF, 0xFF, 0x10, 0x38, 0x60, 0x00, 0xFF, 0xFF, 0xFF, 0xFF];
  const prepare = async () => {
    const r = await start('debug', { listing: false });
    r.sim.writeBytes(0x3000, program);
    r.sim.writeBytes(0x6000, [0x5A]);
    r.sim.setRegister(Reg.PC, 0x3000);
    r.sim.setMemoryMap(MapKind.PROTECTED, { enabled: true, start: 0x6000, end: 0x60FF });
    return r;
  };
  // Free run: the display was last refreshed in supervisor mode, so the read
  // from user mode is allowed.
  let { sim, host } = await prepare();
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.D0) & 0xFF, 0x5A);
  assert.deepEqual(runMessages(host), []);

  // Single-stepping refreshes the display after every instruction.
  ({ sim, host } = await prepare());
  sim.cmdTraceInto();
  assert.equal(sim.boxText(Box.SR)[2], '0');
  sim.cmdTraceInto();
  assert.deepEqual(runMessages(host).slice(-2), ['Bus Error: Instruction at 3004 accessing address 6000', 'Execution halted']);

  // Typing a 0 into the S position of the SR box has the same effect at once,
  // even in supervisor mode.
  ({ sim, host } = await prepare());
  sim.writeBytes(0x3000, [0x4E, 0x71, 0x4E, 0x71]); // two NOPs instead of ANDI
  sim.cmdTraceInto();
  sim.editBox(Box.SR, '0000000000000000');
  sim.cmdRun(); // (loadRegs then takes the edited SR over as well)
  drive(sim, host);
  assert.equal(runMessages(host).some((m) => m.startsWith('Bus Error: Instruction at 3004')), true);
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------
test('determinism: the same inputs give the same cycles, registers, memory and output', async () => {
  const once = async () => {
    const host = new HeadlessHost({ keys: 'hello\n' });
    const sim = await createSim(host);
    const outcomes = [];
    for (const [name, d7] of [['arith', 0], ['io', 2], ['io', 9], ['irq', 4], ['exc', 18]]) {
      sim.load(fixture(`${name}.S68`), fixture(`${name}.L68`));
      sim.setRegister(Reg.D7, d7);
      sim.setOption(Option.EXCEPTIONS, name === 'exc' ? 1 : 0);
      sim.cmdRun();
      const result = drive(sim, host);
      let hash = 0;
      const memory = sim.memory;
      for (let i = 0; i < 0x10000; i++) hash = (Math.imul(hash, 31) + memory[i]) | 0;
      outcomes.push({ result: result.reason, registers: sim.registers(), hash, steps: sim.stepCount, time: host.timeMs });
    }
    return { outcomes, output: host.outputText, messages: host.messages.slice() };
  };
  const a = await once();
  const b = await once();
  assert.deepEqual(a, b);
  assert.equal(a.outcomes.every((o) => o.result === 'stopped'), true);
});
