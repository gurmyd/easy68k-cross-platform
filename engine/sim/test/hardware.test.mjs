// The Hardware window's logic (devices, memory map, auto-interrupt timers,
// enable / disable) and the guards against unbounded recursion.
// Specification: docs/porting/hardware.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start, run, runMessages, fixture } from './helpers.mjs';
import { createSim, Reg, Status, Option, MapKind, Device, Repaint } from '../sim68k.mjs';
import { HeadlessHost, drive } from './headless-host.mjs';

const SWITCHES = 0xE00012, BUTTONS = 0xE00014;

test('start-up state without a settings file', async () => {
  const host = new HeadlessHost();
  const sim = await createSim(host);
  const hw = sim.hardware();
  assert.deepEqual([hw.seg7, hw.led, hw.switches, hw.pushButtons], [0xE00000, 0xE00010, 0xE00012, 0xE00014]);
  assert.equal(hw.map.every((m) => !m.enabled && m.start === 0 && m.end === 0), true);
  assert.equal(hw.auto.slice(1).every((a) => !a.checked && !a.timerEnabled && a.intervalMs === 1000), true);
  assert.equal(sim.readByte(BUTTONS), 0xFF);
  const r = sim.registers();
  assert.deepEqual([r.pc, r.sr, r.usp, r.ssp, r.cycles], [0, 0x2000, 0x00FF0000, 0x01000000, 0n]);
  assert.equal(sim.memory.every((b) => b === 0xFF), true, 'memory is all $FF');
  const state = sim.state();
  assert.deepEqual([state.hardwareEnabled, state.autoIRQ, state.runMode, state.trace], [true, true, false, false]);
  assert.deepEqual([sim.getOption(Option.EXCEPTIONS), sim.getOption(Option.BITFIELD), sim.getOption(Option.SIMHALT)], [0, 0, 1]);
});

test('toggle switches: the picture decides, the byte follows one bit at a time', async () => {
  const { sim } = await start('debug');
  assert.equal(sim.readByte(SWITCHES), 0x00, 'cleared by the load');
  sim.switchClick(0);
  sim.switchClick(7);
  assert.equal(sim.readByte(SWITCHES), 0x81);
  assert.deepEqual(sim.hardware().switchOn, [true, false, false, false, false, false, false, true]);
  // The program (here: the test) overwrites the byte; the pictures do not follow.
  sim.writeBytes(SWITCHES, [0x00]);
  sim.switchClick(0); // shown "on" -> goes off: clears the bit that is already 0
  assert.equal(sim.readByte(SWITCHES), 0x00);
  sim.switchClick(0);
  assert.equal(sim.readByte(SWITCHES), 0x01);
});

test('push buttons are active low and have no state of their own', async () => {
  const { sim } = await start('debug');
  sim.pushButton(3, true);
  assert.equal(sim.readByte(BUTTONS), 0xF7);
  sim.pushButton(0, true);
  assert.equal(sim.readByte(BUTTONS), 0xF6);
  sim.pushButton(3, false);
  sim.pushButton(0, false);
  assert.equal(sim.readByte(BUTTONS), 0xFF);
});

test('showing the hardware window zeroes the switch byte but not the pictures', async () => {
  const { sim, host } = await start('debug');
  sim.switchClick(2);
  assert.equal(host.callsOf('hardwareUpdate').length, 0, 'no repaint while hidden');
  sim.setHardwareVisible(true);
  assert.equal(sim.readByte(SWITCHES), 0x00);
  assert.equal(sim.hardware().switchOn[2], true);
  sim.switchClick(1);
  assert.equal(sim.readByte(SWITCHES), 0x02);
  assert.equal(host.callsOf('hardwareUpdate').length >= 1, true);
  sim.setHardwareVisible(true); // already visible: nothing happens
  assert.equal(sim.readByte(SWITCHES), 0x02);
});

test('device addresses: change, commit, and the task that reports them', async () => {
  const { sim } = await start('debug');
  sim.switchClick(4);
  sim.setDeviceAddress(Device.SWITCH, 0x00A000);
  assert.equal(sim.hardware().switches, 0xA000);
  assert.equal(sim.hardware().switchOn[4], false, 'a new address shows all switches off');
  assert.equal(sim.readByte(0xA000), 0xFF, 'nothing written yet');
  sim.setDeviceAddress(Device.SWITCH, 0x00A000, { commit: true });
  assert.equal(sim.readByte(0xA000), 0x00, 'Enter / leaving the field writes 0');
  sim.writeBytes(0xB000, [0x12]);
  sim.setDeviceAddress(Device.PUSH_BUTTON, 0x00B000, { commit: true });
  assert.equal(sim.readByte(0xB000), 0xFF);
  sim.pushButton(1, true);
  assert.equal(sim.readByte(0xB000), 0xFD);
});

test('writes to the display addresses ask the host to redraw (only while the window is visible)', async () => {
  const { sim, host } = await start('debug');
  sim.setHardwareVisible(true);
  const before = host.callsOf('hardwareUpdate').length;
  // MOVE.B #$3F,$E00000 ; MOVE.B #1,$E0000C(-4 margin: $E0000C is inside) ; MOVE.B #1,$3000 ; SIMHALT
  sim.writeBytes(0x3000, [0x13, 0xFC, 0x00, 0x3F, 0x00, 0xE0, 0x00, 0x00,
                          0x13, 0xFC, 0x00, 0x01, 0x00, 0xE0, 0x00, 0x0C,
                          0x13, 0xFC, 0x00, 0x01, 0x00, 0x00, 0x40, 0x00, 0xFF, 0xFF, 0xFF, 0xFF]);
  sim.setRegister(Reg.PC, 0x3000);
  sim.cmdRun();
  drive(sim, host);
  assert.equal(host.callsOf('hardwareUpdate').length - before, 2, 'two writes in the 7-segment range, one elsewhere');
  assert.equal(sim.readByte(0xE00000), 0x3F);
});

test('memory map: reads test the first byte only, writes the whole extent; device addresses are exempt', async () => {
  const program = (bytes) => async (exceptions = false) => {
    const { sim, host } = await start('debug', { listing: false, exceptions });
    sim.setMemoryMap(MapKind.INVALID, { enabled: true, start: 0x5000, end: 0x50FF });
    sim.writeBytes(0x3000, [...bytes, 0xFF, 0xFF, 0xFF, 0xFF]);
    sim.setRegister(Reg.PC, 0x3000);
    sim.cmdRun();
    drive(sim, host);
    return { sim, host, messages: runMessages(host) };
  };
  // MOVE.L $4FFE,D0: starts two bytes below the range and runs into it
  let r = await program([0x20, 0x38, 0x4F, 0xFE])();
  assert.deepEqual(r.messages, [], 'a read is tested at its first byte only');
  // TST.B $50FF / TST.B $5100
  r = await program([0x4A, 0x38, 0x50, 0xFF])();
  assert.deepEqual(r.messages, ['Bus Error: Instruction at 3000 accessing address 50ff', 'Execution halted']);
  r = await program([0x4A, 0x38, 0x51, 0x00])();
  assert.deepEqual(r.messages, []);
  // PEA-free pure write: MOVEA.L #$5002,A7 ; BSR.S *+2 pushes at $4FFE..$5001: overlaps
  r = await program([0x2E, 0x7C, 0x00, 0x00, 0x50, 0x02, 0x61, 0x00, 0x00, 0x02])();
  assert.deepEqual(r.messages, ['Bus Error: Instruction at 3006 accessing address 4ffe']);

  // A device inside an Invalid range stays accessible.
  const { sim, host } = await start('debug', { listing: false });
  sim.setMemoryMap(MapKind.INVALID, { enabled: true, start: 0xE00000, end: 0xE000FF });
  // MOVE.B #$55,$E00010 (LED) ; MOVE.B $E00012,D1 (switches) ; MOVE.B $E00011,D2 (not a device) ; SIMHALT
  sim.writeBytes(0x3000, [0x13, 0xFC, 0x00, 0x55, 0x00, 0xE0, 0x00, 0x10,
                          0x12, 0x39, 0x00, 0xE0, 0x00, 0x12,
                          0x14, 0x39, 0x00, 0xE0, 0x00, 0x11, 0xFF, 0xFF, 0xFF, 0xFF]);
  sim.setRegister(Reg.PC, 0x3000);
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.readByte(0xE00010), 0x55);
  assert.deepEqual(runMessages(host), ['Bus Error: Instruction at 300e accessing address e00011', 'Execution halted']);
});

test('auto-interrupt timers: check box and master flag together arm a timer', async () => {
  const { sim, host } = await start('irq', { caseNumber: 0, exceptions: true });
  assert.equal(sim.state().autoIRQ, false, 'a load leaves "Automatic Disabled"');
  sim.selectAutoIrq(3);
  sim.setAutoInterval(250);
  sim.setAutoIrq(3, true);
  let hw = sim.hardware();
  assert.deepEqual(hw.auto[3], { checked: true, timerEnabled: false, intervalMs: 250 });
  assert.equal(host.timers[3].enabled, false);
  sim.cmdRun(); // RunExecute: autoIRQon()
  assert.equal(sim.state().autoIRQ, true);
  assert.equal(host.timers[3].enabled, true);
  assert.equal(host.timers[3].intervalMs, 250);
  sim.run(100);
  sim.cmdPause(); // autoIRQoff()
  sim.run(1);
  assert.equal(host.timers[3].enabled, false);
  assert.equal(sim.hardware().auto[3].checked, true, 'the box stays checked');
  // A tick from a timer that is not enabled is ignored.
  const cycles = sim.cycles;
  assert.equal(sim.timerTick(3), false);
  assert.equal(sim.cycles, cycles);
  assert.equal(sim.state().irq, 0);
});

test('after Rewind a checked auto interrupt starts the program by itself (QUIRK)', async () => {
  const { sim, host } = await start('irq', { caseNumber: 0, exceptions: true });
  sim.setAutoIrq(2, true);
  sim.rewind(); // initSim(): Hardware->enable() -> autoIRQon()
  assert.equal(sim.state().autoIRQ, true);
  assert.equal(host.timers[2].enabled, true);
  assert.equal(sim.state().runMode, false);
  assert.equal(sim.timerTick(2), true, 'the tick sets runMode: the program runs without Run being pressed');
  assert.equal(sim.run(1), Status.RUNNING);
  // ... whereas a load unchecks the boxes.
  sim.load(fixture('irq.S68'), fixture('irq.L68'));
  assert.equal(sim.hardware().auto[2].checked, false);
  assert.equal(host.timers[2].enabled, false);
});

test('TRAP #15 task 32/6: "enable" after "disable all" does not start the timer (QUIRK)', async () => {
  const { sim, host } = await start('debug', { listing: false });
  // MOVEQ #32,D0 ; MOVEQ #6,D1 ; MOVEQ #0,D2 ; TRAP #15       disable all
  // MOVEQ #32,D0 ; MOVE.B #$81,D2 ; MOVEQ #50,D3 ; TRAP #15    enable IRQ 1 every 50 ms
  // NOP ; SIMHALT
  sim.writeBytes(0x3000, [0x70, 32, 0x72, 6, 0x74, 0, 0x4E, 0x4F,
                          0x70, 32, 0x14, 0x3C, 0x00, 0x81, 0x76, 50, 0x4E, 0x4F,
                          0x4E, 0x71, 0xFF, 0xFF, 0xFF, 0xFF]);
  sim.setRegister(Reg.PC, 0x3000);
  sim.cmdRunToAddress(0x3012);
  drive(sim, host);
  // run-to-address stopped in trace mode, which switched the timers off anyway;
  // look at the state the two tasks produced:
  const hw = sim.hardware();
  assert.deepEqual(hw.auto[1], { checked: true, timerEnabled: false, intervalMs: 50 });
  assert.equal(hw.intervalBox, 50, 'level 1 is the one selected in the combo box, so the interval is echoed');
  assert.deepEqual([host.timers[1].enabled, host.timers[1].intervalMs], [false, 50],
    'the host was told the new interval, and that the timer is not running');
});

test('the hardware stays disabled after SIMHALT even if the program is continued with Pause and Run', async () => {
  const { sim, host } = await run('irq', { caseNumber: 0, exceptions: true, prepare: (s) => s.setRegister(Reg.D5, 1) });
  assert.equal(sim.state().hardwareEnabled, false);
  sim.cmdPause();
  sim.cmdRun(); // autoIRQon(), but hardwareEnabled stays false
  assert.deepEqual([sim.state().hardwareEnabled, sim.state().autoIRQ], [false, true]);
  assert.equal(sim.irq(1), true, 'runMode is true because of Run, not because of the request');
  assert.equal(sim.state().irq, 0, 'the request was dropped');
  drive(sim, host);
});

test('keyboard input completed in trace mode re-enables the hardware', async () => {
  const { sim, host } = await start('io', { caseNumber: 14 }); // task 9: hardware disabled
  sim.cmdRun();
  drive(sim, host);
  assert.equal(sim.state().hardwareEnabled, false);
  // TRAP #15 task 5 at $3000, traced: the read stays pending after the step
  sim.writeBytes(0x3000, [0x70, 5, 0x4E, 0x4F, 0xFF, 0xFF, 0xFF, 0xFF]);
  sim.setRegister(Reg.PC, 0x3000);
  sim.cmdTraceInto();
  assert.equal(sim.cmdTraceInto(), Status.STOPPED, 'Trace Into does not wait for the key');
  assert.equal(sim.state().inputMode, true);
  sim.keyChar(0x41);
  assert.equal(sim.state().inputMode, false);
  assert.equal(sim.getRegister(Reg.D1) & 0xFF, 0x41);
  assert.equal(sim.state().hardwareEnabled, true);
});

// ---------------------------------------------------------------------------
// recursion (sim-core.md 11.9, hardware.md 4.4 items 3 and 4)
// ---------------------------------------------------------------------------
test('bus-error vector inside an Invalid range: the endless recursion ends in the exec_inst error box', async () => {
  const { sim, host } = await start('exc', { caseNumber: 9, exceptions: true });
  sim.setMemoryMap(MapKind.INVALID, { enabled: true, start: 0x5000, end: 0x50FF });
  sim.cmdRunToAddress(0x2240);
  drive(sim, host);
  // now also make the vector table invalid and step into the faulting read
  sim.setMemoryMap(MapKind.INVALID, { enabled: true, start: 0x0000, end: 0x50FF });
  // (the program itself is at $1000-$2FFF, inside the range: its next fetch
  // faults, which is exactly the situation)
  const status = sim.cmdTraceInto();
  assert.equal(status, Status.WAIT_ALERT);
  assert.equal(host.alerts.length, 1);
  assert.equal(host.alerts[0].title, 'Error');
  assert.match(host.alerts[0].text, /^ERROR: An exception occurred in routine 'exec_inst'\.\nPC=[0-9A-F]{8} {2}Code=[0-9A-F]{4}$/);
  sim.dismissAlert();
  assert.equal(sim.run(0), Status.STOPPED);
  assert.equal(sim.state().trace, true);
  // the engine is intact: remove the map and carry on
  sim.setMemoryMap(MapKind.INVALID, { enabled: false });
  sim.setRegister(Reg.PC, 0x2240);
  sim.setRegister(Reg.SSP, 0x8000);
  assert.equal(sim.cmdTraceInto(), Status.STOPPED);
  assert.equal(sim.getRegister(Reg.PC), 0x2244);
});

test('supervisor stack inside a Read-only range: nested faults until the stack leaves the range', async () => {
  // hardware.md 4.4 item 4, worked example: a 16-byte Read range immediately
  // below the SSP and one interrupt give four nested faults (200 cycles),
  // the interrupt handler is entered and the SSP ends 62 bytes lower.
  const { sim, host } = await start('irq', { caseNumber: 0, exceptions: true });
  sim.cmdRunToAddress(0x2004);
  drive(sim, host);
  sim.setMemoryMap(MapKind.READ, { enabled: true, start: 0x8000 - 16, end: 0x8000 - 1 });
  sim.writeBytes(0x08, [0x00, 0x00, 0x60, 0x00]); // a bus-error vector, never reached
  const before = sim.cycles;
  sim.irq(1);
  assert.equal(sim.cmdTraceInto(), Status.STOPPED);
  assert.equal(sim.getRegister(Reg.SSP), 0x8000 - 62);
  assert.equal(sim.cycles - before, 44n + 8n + 4n * 50n + 34n, 'request, ADDQ, four bus errors, interrupt');
  assert.equal(sim.getRegister(Reg.PC), sim.readLong(0x64), 'irqHandler loads its vector after the frames');
  assert.deepEqual(runMessages(host).filter((m) => !m.startsWith('PC=')), []);
});

test('a large Read-only range below the stack: the recursion guard stops it with the error box', async () => {
  const { sim, host } = await start('irq', { caseNumber: 0, exceptions: true });
  sim.cmdRunToAddress(0x2004);
  drive(sim, host);
  sim.setMemoryMap(MapKind.READ, { enabled: true, start: 0x3000, end: 0x8000 - 1 });
  sim.irq(1);
  assert.equal(sim.cmdTraceInto(), Status.WAIT_ALERT);
  assert.match(host.alerts[0].text, /An exception occurred in routine 'exec_inst'/);
  sim.dismissAlert();
  assert.equal(sim.run(0), Status.STOPPED);
  // still usable
  sim.setMemoryMap(MapKind.READ, { enabled: false });
  sim.rewind();
  sim.setRegister(Reg.D5, 1);
  sim.cmdRun();
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.equal(sim.state().halt, true);
});

test('repaint bits: StackFrm->Repaint() sends STACK | STACK_REDRAW, updateDisplay() only STACK', async () => {
  // The Hardware window redraws the Stack window with StackFrm->Repaint()
  // (hardwareu.cpp: switch click, push button, FormShow); a register change
  // re-centres it with updateDisplay() (sim-ui 11.4).  docs/requests/U2-stack-redraw-bit.md.
  const bits = [];
  const host = new HeadlessHost();
  host.repaint = (what) => bits.push(what); // host methods are bound when the simulator is created
  const sim = await createSim(host);
  sim.load(fixture('debug.S68'), fixture('debug.L68'));
  sim.setHardwareVisible(true);
  bits.length = 0;
  sim.switchClick(0);
  assert.ok(bits.includes(Repaint.STACK | Repaint.STACK_REDRAW), `switch click: ${bits}`);
  assert.ok(!bits.includes(Repaint.STACK), `switch click does not re-centre: ${bits}`);
  bits.length = 0;
  sim.pushButton(1, true);
  assert.ok(bits.includes(Repaint.STACK | Repaint.STACK_REDRAW), `push button: ${bits}`);
  bits.length = 0;
  sim.setRegister(Reg.A0 + 7, 0x8000);
  sim.cmdTraceInto();
  assert.ok(bits.some((b) => (b & Repaint.STACK) !== 0 && (b & Repaint.STACK_REDRAW) === 0), `a step re-centres: ${bits}`);
});
