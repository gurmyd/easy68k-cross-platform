// TRAP #15 tasks at the boundary between engine and host, and every wait
// state with its resume call.  Fixture: test/fixtures/io.X68 (case n at
// $2000 + n * $80).  The I/O window itself is not under test here; the
// headless host models its text screen (trap15-tasks-0-59.md section 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, start, runMessages, fixture } from './helpers.mjs';
import { Reg, Status, Option, Shift, bytesToText } from '../sim68k.mjs';
import { drive, HeadlessHost } from './headless-host.mjs';

const RESULTS = 0x4000;

test('text output: tasks 14, 13, 0, 1, 6 use exactly the register parts the original reads', async () => {
  const { host } = await run('io', { caseNumber: 0 });
  // doCRLF writes a single "\n" to the output log
  assert.equal(host.outputText, 'ABCDEF\nGHI\nGH!');
  assert.deepEqual(host.screenLines().slice(0, 3), ['ABCDEF', 'GHI', 'GH!']);
});

test('number output: tasks 3, 15, 17, 20', async () => {
  const { host } = await run('io', { caseNumber: 1 });
  assert.equal(host.outputText, '-12345' + 'FF' + '101' + '4294967295' + 'N=42' + '    42' + '-7    ');
});

test('task 2: WAIT_INPUT, then the string is stored through mem_put and D1.L is its length', async () => {
  const { sim, host } = await start('io', { caseNumber: 2 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_INPUT);
  assert.equal(sim.state().inputMode, true);
  assert.equal(sim.run(1000), Status.WAIT_INPUT, 'still waiting: nothing executes');
  for (const ch of 'hi!') sim.keyChar(ch.charCodeAt(0));
  assert.equal(sim.run(1000), Status.WAIT_INPUT, 'no Enter yet');
  assert.equal(sim.readByte(0x5000), 0xFF, 'nothing is stored before Enter');
  sim.keyChar(8); // backspace
  sim.keyChar(13);
  assert.equal(sim.state().inputMode, false);
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.equal(sim.readLong(RESULTS), 2, 'all of D1 is the length');
  assert.deepEqual([...sim.memory.subarray(0x5000, 0x5003)], [0x68, 0x69, 0x00], 'text and its NUL');
  assert.equal(host.outputText, 'hi!\nhi', 'echo (backspace is not logged), CR LF, then task 14');
});

test('task 2: the 80th key ends the input and is discarded', async () => {
  const keys = 'x'.repeat(79) + 'Y' + '\n';
  const { sim, host } = await run('io', { caseNumber: 2, host: { keys } });
  assert.equal(sim.readLong(RESULTS), 79);
  assert.equal(sim.readByte(0x5000 + 78), 0x78);
  assert.equal(sim.readByte(0x5000 + 79), 0x00);
  assert.equal(host.keys.length, 1, 'the Enter of the script was never needed');
  assert.equal(host.outputText, 'x'.repeat(79) + '\n' + 'x'.repeat(79), 'the 80th key is not echoed');
});

test('task 4: numbers are converted with atoi', async () => {
  const { sim } = await run('io', { caseNumber: 3, host: { keys: '123\n-45\nabc\n' } });
  assert.deepEqual([sim.readLong(RESULTS), sim.readLong(RESULTS + 4), sim.readLong(RESULTS + 8)], [123, 0xFFFFFFD3, 0]);
});

test('tasks 7 and 5: key pending flag and character input touch only D1.B', async () => {
  const { sim, host } = await run('io', { caseNumber: 4, host: { keys: 'xy' } });
  assert.equal(sim.readLong(RESULTS), 0xAAAAAA00, 'task 7: no key pending');
  assert.equal(sim.readLong(RESULTS + 4), 0xBBBBBB78, 'task 5: "x"');
  assert.equal(sim.readLong(RESULTS + 8), 0xBBBBBB79);
  assert.equal(host.outputText, 'xy', 'echoed through charOut');
});

test('type-ahead: one key typed before the read is returned at once', async () => {
  const { sim, host } = await start('io', { caseNumber: 4 });
  sim.keyChar(0x41); // nobody is reading: goes to pendingKey
  sim.keyChar(0x42); // overwrites it: only one slot
  assert.equal(sim.state().pendingKey, 0x42);
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_INPUT, 'the second task 5 waits');
  assert.equal(sim.readLong(RESULTS), 0xAAAAAA01, 'task 7 saw the pending key');
  assert.equal(sim.readLong(RESULTS + 4), 0xBBBBBB42, 'task 5 took it without waiting');
  sim.keyChar(0x43);
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.equal(sim.readLong(RESULTS + 8), 0xBBBBBB43);
});

test('task 18: prompt, then number', async () => {
  const { sim, host } = await run('io', { caseNumber: 5, host: { keys: '77\n' } });
  assert.equal(sim.readLong(RESULTS), 77);
  assert.equal(host.outputText, 'N=77\n');
});

test('task 12 echo off: nothing echoed, the cursor still moves, CR LF still done; task 16', async () => {
  const { sim, host } = await run('io', { caseNumber: 6, host: { keys: 'secret\n\r' } });
  assert.equal(sim.readLong(RESULTS), 6);
  assert.equal(bytesToText(sim.memory.subarray(0x5000, 0x5006)), 'secret');
  // input: no echo, "\n" from doCRLF.  Then task 5 with echo on and
  // "LF display" off: the CR is echoed without an LF.
  assert.equal(host.outputText, '\n\r');
  assert.equal(sim.readLong(RESULTS + 4) & 0xFF, 13);
});

test('task 11 cursor and task 22 read character: D1.W / D1.B only', async () => {
  const { sim, host } = await run('io', { caseNumber: 7 });
  assert.equal(sim.readLong(RESULTS), 0x12340B05, 'column 11, row 5 in D1.W; upper word kept');
  assert.equal(sim.readLong(RESULTS + 4), 0x00050058, '"X" in D1.B');
  assert.equal(sim.readLong(RESULTS + 8), 0x00000000, 'home after clear screen');
  assert.equal(host.screenLines().every((line) => line === ''), true, 'screen cleared');
});

test('task 8 time comes from the host; tasks 30 / 31 cycles; task 32 hardware addresses and version', async () => {
  const { sim } = await run('io', { caseNumber: 8, host: { startCentiseconds: 1234567 } });
  assert.equal(sim.readLong(RESULTS), 1234567);
  assert.equal(sim.readLong(RESULTS + 4), 8, 'NOP + MOVEQ since the counter was cleared');
  assert.deepEqual([8, 12, 16, 20].map((o) => sim.readLong(RESULTS + o)), [0xE00000, 0xE00010, 0xE00012, 0xE00014]);
  assert.equal(sim.readLong(RESULTS + 24), 0x00051001, 'version 5.16.1');
});

test('task 23: WAIT_DELAY until the host reports the time', async () => {
  const { sim, host } = await start('io', { caseNumber: 9 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_DELAY);
  assert.equal(sim.delayRemaining, 50);
  assert.equal(host.outputText, 'ABC');
  sim.delayElapsed(20);
  assert.equal(sim.run(1000), Status.WAIT_DELAY);
  assert.equal(sim.delayRemaining, 30);
  sim.delayElapsed(1000); // more than needed is fine
  assert.equal(sim.run(1000), Status.STOPPED);
  assert.equal(host.outputText, 'ABCDEF');
});

test('task 23 with the headless clock: 50 periods are half a second', async () => {
  const { sim, host } = await run('io', { caseNumber: 9 });
  assert.equal(sim.readLong(RESULTS), 12 * 360000 + 50);
  assert.ok(host.timeMs >= 500);
});

test('task 23 is skipped in trace mode (Trace Into)', async () => {
  const { sim, host } = await start('io', { caseNumber: 9 });
  sim.cmdRunToAddress(0x248E); // the TRAP #15 of the delay
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x248E);
  assert.equal(sim.cmdTraceInto(), Status.STOPPED, 'runMode is false: no delay');
  assert.equal(sim.delayRemaining, 0);
});

test('Pause during a delay ends the delay and the suspended step finishes at once', async () => {
  const { sim, host } = await start('io', { caseNumber: 9 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_DELAY);
  sim.cmdPause();
  assert.equal(sim.state().phase, 0);
  assert.equal(sim.run(1000), Status.STOPPED);
  assert.equal(sim.getRegister(Reg.PC), 0x2490, 'stopped after the TRAP of the delay');
  assert.equal(sim.delayRemaining, 0);
  assert.equal(sim.state().trace, true);
  sim.cmdRun();
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.equal(host.outputText, 'ABCDEF');
});

test('Pause during a keyboard read cancels it; the program continues without input (QUIRK)', async () => {
  const { sim, host } = await start('io', { caseNumber: 2 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_INPUT);
  sim.keyChar(0x61);
  sim.cmdPause();
  assert.equal(sim.state().inputMode, false);
  assert.equal(sim.run(1000), Status.STOPPED);
  assert.equal(sim.getRegister(Reg.PC), 0x2110, 'after the TRAP');
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.readLong(RESULTS), 0xAAAAAAAA, 'D1 was never written');
  assert.equal(sim.readByte(0x5000), 0xFF, 'nor the buffer');
});

test('Rewind during a keyboard read: the suspended step finishes on the reset machine', async () => {
  const { sim, host } = await start('io', { caseNumber: 2 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_INPUT);
  sim.rewind();
  // The reset itself sets OLD_PC = -1; the rest of the interrupted runprog()
  // then runs on the reset machine and ends with OLD_PC = PC.  (After a
  // Rewind with nothing suspended, OLD_PC stays -1: see interrupts.test.mjs.)
  assert.equal(sim.state().phase, 0, 'no step is suspended any more');
  assert.equal(sim.getRegister(Reg.OLD_PC), 0x1000);
  assert.equal(sim.run(1000), Status.STOPPED);
  const r = sim.registers();
  assert.equal(r.pc, 0x1000, 'PC = start address');
  assert.equal(r.cycles, 0n);
  assert.equal(r.ssp, 0x01000000);
  assert.equal(sim.state().inputMode, false);
  // and it runs again from the start (D7 was cleared, so this is case 0)
  sim.cmdRun();
  drive(sim, host);
  assert.equal(host.outputText.endsWith('ABCDEF\nGHI\nGH!'), true);
});

test('Reload during a delay: the suspended step finishes on the newly loaded program', async () => {
  const { sim, host } = await start('io', { caseNumber: 9 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_DELAY);
  sim.load(fixture('io.S68'), fixture('io.L68'), { kind: 'reload' });
  assert.equal(sim.run(1000), Status.STOPPED);
  assert.equal(sim.delayRemaining, 0);
  assert.equal(sim.getRegister(Reg.PC), 0x1000);
  assert.equal(sim.cycles, 0n);
  sim.cmdRun();
  assert.equal(drive(sim, host).reason, 'stopped');
});

test('file tasks 50-59 against the host file system', async () => {
  const { sim, host } = await run('io', { caseNumber: 10 });
  const w = (o) => sim.readWord(RESULTS + o);
  const l = (o) => sim.readLong(RESULTS + o);
  assert.equal(w(0), 0, 'task 52 new file');
  assert.equal(w(2), 0, 'task 54 write');
  assert.equal(w(4), 0, 'task 56 close');
  assert.equal(w(6), 0, 'task 51 open existing');
  assert.equal(w(8), 0, 'task 53 read');
  assert.equal(l(10), 5, 'D2 = bytes actually read');
  assert.equal(w(14), 1, 'task 53 at end of file: F_EOF');
  assert.equal(l(16), 10, 'and D2 is left unchanged');
  assert.equal(w(20), 0, 'task 55 position');
  assert.equal(w(22), 0, 'task 53 after positioning');
  assert.equal(w(24), 2, 'task 54 with a length of 0: F_ERROR (fwrite returns 0)');
  assert.equal(w(26), 0, 'task 50 close all');
  assert.equal(w(28), 0, 'task 59: file exists');
  assert.equal(w(30), 0, 'task 57 delete');
  assert.equal(w(32), 2, 'task 59: file does not exist');
  assert.equal(w(34), 2, 'task 51 on a missing file');
  assert.equal(l(36), 0xFFFFFFFF, 'D1 = -1');
  assert.equal(w(40), 2, 'task 56 with a file number out of range');
  assert.equal(bytesToText(sim.memory.subarray(0x5000, 0x5005)), 'GHIJK');
  assert.equal(bytesToText(sim.memory.subarray(0x5008, 0x500A)), 'JK');
  assert.equal(host.file('OUT.TXT'), undefined, 'deleted');
  assert.equal(host.handles.size, 0, 'all handles closed');
});

test('task 59 distinguishes writable and read-only files; task 51 opens read-only files as such', async () => {
  const { sim } = await start('io', { caseNumber: 10, host: { files: { 'out.txt': 'x' }, readOnlyFiles: ['OUT.TXT'] } });
  // call fileOp directly: LEA FNAME,A1 / MOVEQ #59,D0 / TRAP #15 / SIMHALT at $3000
  sim.writeBytes(0x3000, [0x70, 59, 0x4E, 0x4F, 0x70, 51, 0x4E, 0x4F, 0xFF, 0xFF, 0xFF, 0xFF]);
  sim.setRegister(Reg.PC, 0x3000);
  const name = [...sim.memory.subarray(0x2000, 0x3000)].findIndex((b, i, m) => b === 0x4F && m[i + 1] === 0x55 && m[i + 2] === 0x54 && m[i + 3] === 0x2E);
  sim.setRegister(Reg.A1, 0x2000 + name);
  sim.cmdTraceInto();
  sim.cmdTraceInto();
  assert.equal(sim.getRegister(Reg.D0) & 0xFFFF, 3, 'F_READONLY');
  sim.cmdTraceInto();
  sim.cmdTraceInto();
  assert.equal(sim.getRegister(Reg.D0) & 0xFFFF, 3, 'opened read-only');
  assert.equal(sim.getRegister(Reg.D1), 0, 'file number 0');
});

test('task 58 file dialog: WAIT_HOST until the host replies; D1, D0.W and the path buffer', async () => {
  const { sim, host } = await start('io', { caseNumber: 13 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_HOST);
  assert.deepEqual(host.dialogs, [{ mode: 0, title: 'ABC', filter: 'DEF|DEF', fileName: '' }]);
  assert.equal(sim.run(1000), Status.WAIT_HOST, 'nothing happens until the reply');
  assert.equal(sim.state().fileDialogOpen, true);
  sim.fileDialogReply(true, 'C:\\DATA\\FILE.TXT');
  assert.equal(sim.run(1000), Status.STOPPED);
  assert.equal(sim.readLong(RESULTS), 1, 'D1 = 1: a file was chosen');
  assert.equal(sim.readLong(RESULTS + 4), 0xFFFF0000, 'D0.W = 0 (success), upper word kept');
  assert.equal(bytesToText(sim.memory.subarray(0x5000, 0x5011)), 'C:\\DATA\\FILE.TXT\0');
  // strncpy(inPath, name, 255) pads with zero bytes up to 255 characters
  assert.equal(sim.memory.subarray(0x5000 + 16, 0x5000 + 256).every((b) => b === 0), true);
  assert.equal(sim.readByte(0x5100), 0xFF, 'and not beyond');
});

test('task 58 cancelled: D1 = 0, buffer untouched', async () => {
  const { sim } = await run('io', { caseNumber: 13 }); // the headless host cancels by default
  assert.equal(sim.readLong(RESULTS), 0);
  assert.equal(sim.readByte(0x5000), 0x00);
  assert.equal(sim.readByte(0x5001), 0xFF);
});

test('task 9 halts like SIMHALT without moving the PC', async () => {
  const { sim, host } = await run('io', { caseNumber: 14 });
  assert.equal(sim.getRegister(Reg.PC), 0x2704);
  assert.equal(sim.readLong(RESULTS), 0xFFFFFFFF, 'nothing after it ran');
  const state = sim.state();
  assert.equal(state.halt, true);
  assert.equal(state.hardwareEnabled, false);
  assert.deepEqual(runMessages(host), []);
});

test('tasks 19, 60, 61, 62: key and mouse state live in the engine', async () => {
  const { sim, host } = await start('io', { caseNumber: 15 });
  sim.keyDown(0x41);
  sim.keyDown(0x10);
  sim.keyUp(0x10);
  sim.mouseDown(100, 50, Shift.LEFT | Shift.CTRL);
  sim.mouseMove(300, 200, Shift.SHIFT);
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.readLong(RESULTS), 0x000000FF, 'task 19: "A" is down');
  assert.equal(sim.readLong(RESULTS + 4), 0x00100010, 'task 19 with D1 = 0: last key up (hi word) and key down');
  assert.equal(sim.readLong(RESULTS + 8), 0x11, 'task 61 current: left button still down (from the down event), Shift from the move');
  assert.equal(sim.readLong(RESULTS + 12), (200 << 16) | 300);
  assert.equal(sim.readLong(RESULTS + 16), 0x41, 'task 61 at button down: left + Ctrl');
  assert.equal(sim.readLong(RESULTS + 20), (50 << 16) | 100);
});

test('key and mouse events request interrupts at the level set with tasks 62 and 60', async () => {
  const { sim, host } = await run('io', { caseNumber: 15 });
  // the program has ended; a reset re-enables the hardware and clears the levels,
  // so run it again up to the tasks and stop before SIMHALT
  sim.rewind();
  sim.setRegister(Reg.D7, 15);
  sim.cmdRunToAddress(0x27B0);
  drive(sim, host);
  sim.keyDown(0x20);
  assert.equal(sim.state().irq, 0x02, 'key down: level 2');
  sim.mouseDown(1, 1, Shift.LEFT);
  assert.equal(sim.state().irq, 0x06, 'mouse down: level 3');
  sim.mouseUp(1, 1, 0);
  sim.mouseMove(2, 2, 0);
  assert.equal(sim.state().irq, 0x06, 'mouse up and move were not armed');
});

test('graphics, sound and window tasks are forwarded with the reduced arguments', async () => {
  const results = { getXY: [70, -2], getPixel: 0x00C0FFEE, playSound: 1 };
  const { sim, host } = await run('io', { caseNumber: 16, host: { results } });
  const colours = host.callsOf('setLineColor');
  assert.deepEqual(colours[0], [0xFFFFFF], 'every simulator reset sets the pen to clWhite');
  assert.deepEqual(colours.at(-1), [0x00FF8040], 'task 80');
  assert.deepEqual(host.callsOf('drawPixel'), [[-2, 3]], 'low words, sign-extended');
  assert.deepEqual(host.callsOf('line'), [[1, 2, 3, 4]]);
  assert.deepEqual(host.callsOf('rectangle'), [[1, 2, 3, 4]]);
  assert.equal(sim.readLong(RESULTS), 0x11110046, 'task 96 wrote D1.W only');
  assert.equal(sim.readLong(RESULTS + 4), 0x3333FFFE, 'and D2.W only');
  assert.equal(sim.readLong(RESULTS + 8), 0x00C0FFEE, 'task 83: all of D0');
  assert.deepEqual(host.callsOf('drawText').map(([t, x, y]) => [bytesToText(t), x, y]), [['ABC', 10, 20]]);
  assert.equal(sim.readLong(RESULTS + 12), (800 << 16) | 600, 'task 33 set and get size');
  assert.equal(sim.readLong(RESULTS + 16), 0xFFFF0001, 'task 70: result in D0.W only');
  assert.deepEqual(host.callsOf('playSound').map(([n]) => bytesToText(n)), ['ABC']);
  assert.deepEqual(host.callsOf('scrollRect'), [[0, 1, 2, 3, 1]]);
  assert.equal(host.keyCommandsEnabled, false, 'task 24');
  assert.equal(sim.state().keyCommandsDisabled, true);
});

test('a host method that returns nothing leaves the register unchanged', async () => {
  const { sim } = await run('io', { caseNumber: 16 });
  assert.equal(sim.readLong(RESULTS), 0x11112222);
  assert.equal(sim.readLong(RESULTS + 4), 0x33334444);
  assert.equal(sim.readLong(RESULTS + 16), 0xFFFFFF46, 'D0 still holds the task number');
});

test('task 0 / 1 with a negative count in D1.W prints the whole string (guarded out-of-bounds write)', async () => {
  const { host } = await run('io', { caseNumber: 19 });
  assert.equal(host.outputText, 'GHIJK');
});

test('TRAP #15 with D0.B >= $80 or an unassigned number is an ordinary TRAP exception', async () => {
  const { host } = await run('io', { caseNumber: 20 });
  assert.deepEqual(runMessages(host), ['TRAP exception occurred at location 2a06. Execution halted']);
});

test('SIMHALT while logging: the "Current Log Stopped." box is a wait state', async () => {
  const { sim, host } = await start('io', { caseNumber: 14 });
  sim.setOption(Option.EXEC_LOG_TYPE, 1);
  sim.startLog('1/1/2000 12:00:00 AM');
  assert.equal(sim.state().logging, true);
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_ALERT);
  assert.deepEqual(host.alerts, [{ title: 'Information', text: 'Current Log Stopped.' }]);
  assert.equal(sim.run(1000), Status.WAIT_ALERT, 'until the box is dismissed');
  sim.dismissAlert();
  assert.equal(sim.run(1000), Status.STOPPED);
  assert.equal(sim.state().logging, false);
  assert.equal(host.logging, false);
});

test('the text screen model: control characters, clamping and scrolling', () => {
  const host = new HeadlessHost();
  for (const ch of 'AB') host.charOut(ch.charCodeAt(0));
  host.charOut(8); // backspace does not erase
  host.charOut(0x43);
  assert.equal(host.screenLines()[0], 'AC');
  host.charOut(9); // tab = five columns, not a tab stop
  host.charOut(0x44);
  assert.equal(host.screenLines()[0], 'AC     D');
  host.charOut(13);
  host.charOut(8); // at column 0 stays there
  assert.equal(host.col, 0);
  host.charOut(1); // ignored
  host.charOut(11); // vertical tab = four rows
  assert.equal(host.row, 4);
  host.gotorc(40, 0); // below the bottom: one scroll, last row
  assert.equal(host.row, 31);
  assert.equal(host.screenLines()[0], '', 'the first line scrolled away');
  host.textOut(Uint8Array.from('Z'.repeat(85), (c) => c.charCodeAt(0)));
  assert.equal(host.col, 85, 'no wrap by default: the cursor leaves the screen');
  host.charOut(12);
  assert.deepEqual([host.row, host.col], [0, 0], 'form feed clears');
});

test('task 10 printing: the page arithmetic stays in the engine, the host draws characters', async () => {
  const metrics = [20, 10, 1100, 800]; // row height, column width, page height, page width
  const { sim, host } = await start('io', { caseNumber: 0, host: { results: { printerMetric: (which) => metrics[which] } } });
  sim.writeBytes(0x5000, [0x41, 0x0D, 0x42, 0x0A, 0x43, 0x00]); // "A" CR "B" LF "C"
  sim.writeBytes(0x3000, [0x43, 0xF8, 0x50, 0x00, 0x70, 0x0A, 0x4E, 0x4F, 0xFF, 0xFF, 0xFF, 0xFF]); // LEA $5000,A1 / MOVEQ #10,D0 / TRAP #15 / SIMHALT
  sim.setRegister(Reg.PC, 0x3000);
  sim.cmdRun();
  drive(sim, host);
  assert.equal(host.callsOf('printerBeginDoc').length, 1);
  assert.deepEqual(host.callsOf('fontAssign').at(-1), [6, 103], 'printer font from the printer font dialog');
  // margins: top = page height / 11, left = page width / 8 (CODE9.CPP:82-87)
  assert.deepEqual(host.callsOf('printerTextOut'), [[100, 100, 0x41], [100, 100, 0x42], [110, 120, 0x43]]);
  assert.equal(host.callsOf('printerEndDoc').length, 0, 'the page is ended by a form feed only');
});

test('task 42 serial read: result code, count in D1.B, and the stale tail of the receive buffer (QUIRK)', async () => {
  const replies = [Uint8Array.from([0x48, 0x45, 0x4C, 0x4C, 0x4F]), Uint8Array.from([0x41, 0x42]), -3];
  const { sim, host } = await start('io', { caseNumber: 0, host: { results: { commRead: () => replies.shift() } } });
  // MOVE.L #$0003002A,D0 / MOVEQ #5,D1 / LEA $5000,A1 / TRAP #15, three times, then SIMHALT
  const read = [0x20, 0x3C, 0x00, 0x03, 0x00, 0x2A, 0x72, 0x05, 0x43, 0xF8, 0x50, 0x00, 0x4E, 0x4F];
  sim.writeBytes(0x3000, [...read, ...read, ...read, 0xFF, 0xFF, 0xFF, 0xFF]);
  sim.setRegister(Reg.PC, 0x3000);
  const step4 = () => { for (let i = 0; i < 4; i++) sim.cmdTraceInto(); };
  step4();
  assert.deepEqual(host.callsOf('commRead')[0], [3, 5], 'port number from the high word of D0');
  assert.equal(sim.getRegister(Reg.D0), 0x00030000, 'D0.W = 0: success');
  assert.equal(sim.getRegister(Reg.D1) & 0xFF, 5);
  assert.equal(bytesToText(sim.memory.subarray(0x5000, 0x5006)), 'HELLO\0');
  step4();
  assert.equal(sim.getRegister(Reg.D0) & 0xFFFF, 4, 'fewer bytes than asked for: time-out');
  assert.equal(sim.getRegister(Reg.D1) & 0xFF, 2);
  // strcpy(str, InBuff) copies up to the first NUL of the receive buffer,
  // which still holds the end of the previous, longer read (simIOu.cpp:2332).
  assert.equal(bytesToText(sim.memory.subarray(0x5000, 0x5006)), 'ABLLO\0');
  step4();
  assert.equal(sim.getRegister(Reg.D0) & 0xFFFF, 3, 'port not initialised');
});

test('Option.MEM_LIVE: the host is told about every successful memory write', async () => {
  const { sim, host } = await start('debug');
  sim.clearAllBreakpoints();
  sim.cmdRun();
  drive(sim, host);
  assert.equal(host.callsOf('memoryLivePaint').length, 0, 'off by default');
  sim.rewind();
  sim.setOption(Option.MEM_LIVE, 1);
  sim.cmdRun();
  drive(sim, host);
  const writes = host.callsOf('memoryLivePaint').map(([a]) => a);
  assert.equal(writes.filter((a) => a === 0x2000).length, 3, 'MOVE.L D0,COUNT, three times');
  assert.equal(writes.filter((a) => a === 0xFFFFFC).length, 4, 'four return addresses pushed');
});
