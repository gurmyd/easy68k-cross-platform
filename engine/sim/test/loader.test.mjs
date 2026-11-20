// The S-record loader (loadSrec, SIMOPS2.CPP:203-379) and program loading
// (TForm1::OpenFile, SIM68Ku.cpp:270-363): every record type, bad input, the
// memory-map records, the start address rules and the listing directives.
// The S-record files are built here, byte by byte.
// Specification: docs/porting/sim-core.md sections 2.3-2.6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, Reg, Box, MapKind, Status, textToBytes, bytesToText } from '../sim68k.mjs';
import { HeadlessHost, drive } from './headless-host.mjs';
import { fixture } from './helpers.mjs';

const hex2 = (n) => (n & 0xFF).toString(16).toUpperCase().padStart(2, '0');

/**
 * One S-record line (without line end).
 * @param {string} type '0'..'9' @param {number} address @param {number[]} data
 * @param {{addressBytes?: number, badChecksum?: boolean}} [o]
 */
function srec(type, address, data = [], o = {}) {
  const addressBytes = o.addressBytes ?? { 0: 2, 1: 2, 2: 3, 3: 4, 5: 2, 7: 4, 8: 3, 9: 2 }[type];
  const addr = [];
  for (let i = addressBytes - 1; i >= 0; i--) addr.push((address >>> (8 * i)) & 0xFF);
  const count = addr.length + data.length + 1;
  let sum = count;
  for (const b of [...addr, ...data]) sum += b;
  let checksum = ~sum & 0xFF;
  if (o.badChecksum) checksum ^= 0x55;
  return 'S' + type + hex2(count) + [...addr, ...data, checksum].map(hex2).join('');
}
const text = (s) => [...s].map((c) => c.charCodeAt(0));
const HEADER = srec('0', 0, text('68KPROG   20CREATED BY EASY68K'));
/** Lines to file bytes with CR LF line ends, like the EASy68K assembler writes. */
const file = (lines, eol = '\r\n') => textToBytes(lines.map((l) => l + eol).join(''));

async function fresh() {
  const host = new HeadlessHost();
  const sim = await createSim(host);
  return { sim, host };
}

test('header, S1 data and S9 start address', async () => {
  const { sim, host } = await fresh();
  sim.load(file([HEADER, srec('1', 0x1000, [0x4E, 0x71, 0xFF, 0xFF, 0xFF, 0xFF]), srec('9', 0x1000)]));
  assert.deepEqual(host.messages, ['S0 = 68KPROG   20CREATED BY EASY68K', '.S68 file read successful', 'Unable to open .L68 file.']);
  assert.deepEqual([...sim.memory.subarray(0x1000, 0x1006)], [0x4E, 0x71, 0xFF, 0xFF, 0xFF, 0xFF]);
  assert.equal(sim.getRegister(Reg.PC), 0x1000);
  assert.equal(sim.boxText(Box.PC), '00001000');
  assert.equal(sim.state().startPC, 0x1000);
  assert.equal(host.captionText, 'program.S68');
  assert.equal(sim.listingLineCount, 9, 'the nine lines of explanation when there is no listing');
  assert.equal(bytesToText(sim.listingLine(0)), 'A matching .L68 file was not found. The .L68 file');
});

test('S2, S3, S5, S7 and S8 records', async () => {
  let { sim, host } = await fresh();
  sim.load(file([
    srec('2', 0x012345, [0xAA, 0xBB]),
    srec('3', 0x00FFFFF0, [0xCC]),
    srec('5', 2),
    srec('7', 0x00012344),
  ]));
  assert.deepEqual(host.messages.slice(0, 1), ['.S68 file read successful']);
  assert.equal(sim.readWord(0x012345), 0xAABB);
  assert.equal(sim.readByte(0xFFFFF0), 0xCC);
  assert.equal(sim.getRegister(Reg.PC), 0x00012344, 'S7: 32-bit start address');

  ({ sim, host } = await fresh());
  sim.load(file([srec('1', 0x2000, [1]), srec('8', 0x002000)]));
  assert.equal(sim.getRegister(Reg.PC), 0x2000, 'S8: 24-bit start address');
});

test('loading stops at the first S7/S8/S9; its checksum is never verified', async () => {
  const { sim, host } = await fresh();
  sim.load(file([srec('1', 0x1000, [0x11]), srec('8', 0x001000, [], { badChecksum: true }), srec('1', 0x1001, [0x22])]));
  assert.deepEqual(host.messages.slice(0, 1), ['.S68 file read successful']);
  assert.equal(sim.readByte(0x1000), 0x11);
  assert.equal(sim.readByte(0x1001), 0xFF, 'the record after S8 was not read');
});

test('a checksum error is only a message: the bytes are loaded and loading continues', async () => {
  const { sim, host } = await fresh();
  sim.load(file([srec('1', 0x1000, [0x12, 0x34], { badChecksum: true }), srec('1', 0x1002, [0x56]), srec('9', 0x1000)]));
  assert.deepEqual(host.messages.slice(0, 2), ['Checksum error on line 1...', '.S68 file read successful']);
  assert.deepEqual([...sim.memory.subarray(0x1000, 0x1003)], [0x12, 0x34, 0x56]);
});

test('the byte count field is not used: every pair before the last one is data', async () => {
  const { sim } = await fresh();
  // count says 3 bytes (address + checksum), but four data bytes follow
  sim.load(file(['S1031000' + '0102030455', srec('9', 0x1000)]));
  assert.deepEqual([...sim.memory.subarray(0x1000, 0x1005)], [1, 2, 3, 4, 0xFF]);
});

test('an unknown record type stops the load with three messages', async () => {
  const { sim, host } = await fresh();
  const bad = srec('4', 0x1000, [0x99]);
  sim.load(file([srec('1', 0x1000, [0x11]), bad, srec('1', 0x1001, [0x22])]));
  assert.deepEqual(host.messages.slice(0, 3), [
    'Invalid data on line 2 of .S68 file...',
    `2: ${bad}\n`, // the raw line with its newline (the CR is gone: text mode)
    'Remainder of load stopped...',
  ]);
  assert.equal(sim.readByte(0x1000), 0x11, 'records before the error stay loaded');
  assert.equal(sim.readByte(0x1001), 0xFF);
});

test('a file that does not start with S is rejected on line 1', async () => {
  const { host, sim } = await fresh();
  sim.load(textToBytes('hello\r\n'));
  assert.deepEqual(host.messages.slice(0, 3), ['Invalid data on line 1 of .S68 file...', '1: hello\n', 'Remainder of load stopped...']);
});

test('an S3 address above $FFFFFF: invalid address, checksum error, load stopped', async () => {
  const { sim, host } = await fresh();
  const bad = srec('3', 0x01000000, [0x77]);
  sim.load(file([bad]));
  assert.deepEqual(host.messages.slice(0, 5), [
    'Invalid Address on line 1...',
    'Checksum error on line 1...',
    'Invalid data on line 1 of .S68 file...',
    `1: ${bad}\n`,
    'Remainder of load stopped...',
  ]);
  assert.equal(sim.readByte(0), 0xFF, 'nothing was stored through the address mask');
});

test('data that runs past $FFFFFF: the bytes below the limit are stored, then the load stops', async () => {
  const { sim, host } = await fresh();
  sim.load(file([srec('2', 0xFFFFFE, [0x01, 0x02, 0x03, 0x04])]));
  assert.equal(sim.readWord(0xFFFFFE), 0x0102);
  assert.equal(sim.readByte(0), 0xFF, 'no wrap to address 0');
  assert.equal(host.messages[0], 'Invalid Address on line 1...');
  assert.equal(host.messages.includes('Remainder of load stopped...'), true);
});

test('a last line without a line end loses its final data byte (QUIRK)', async () => {
  // The loader takes the pair that is followed by at most two characters for
  // the checksum.  Without "\n" that is the last DATA pair.
  const { sim, host } = await fresh();
  const line = srec('1', 0x1000, [0x0A, 0x0B, 0x0C]);
  sim.load(textToBytes(line));
  assert.deepEqual([...sim.memory.subarray(0x1000, 0x1003)], [0x0A, 0x0B, 0xFF]);
  assert.deepEqual(host.messages.slice(0, 2), ['Checksum error on line 1...', '.S68 file read successful']);
});

test('line ends: CR LF and LF files load identically; Ctrl-Z ends the file (text mode)', async () => {
  const lines = [HEADER, srec('1', 0x1000, [1, 2, 3]), srec('9', 0x1000)];
  const a = await fresh();
  const b = await fresh();
  a.sim.load(file(lines, '\r\n'));
  b.sim.load(file(lines, '\n'));
  assert.deepEqual(a.host.messages, b.host.messages);
  assert.deepEqual([...a.sim.memory.subarray(0x1000, 0x1004)], [...b.sim.memory.subarray(0x1000, 0x1004)]);

  const c = await fresh();
  c.sim.load(textToBytes(srec('1', 0x1000, [1]) + '\r\n\x1A' + srec('1', 0x1001, [2]) + '\r\n'));
  assert.equal(c.sim.readByte(0x1000), 1);
  assert.equal(c.sim.readByte(0x1001), 0xFF, 'nothing after Ctrl-Z is read');
});

test('a file that cannot be opened', async () => {
  const { sim, host } = await fresh();
  sim.load(null, null, { name: 'missing.S68' });
  assert.deepEqual(host.messages, ['error: cannot open file missing.S68']);
  assert.equal(sim.listingLineCount, 0, 'OpenFile does nothing more');
});

test('S0 memory-map records after the EASy68K header switch the map on', async () => {
  const { sim, host } = await fresh();
  const rom = srec('0', 0, text('      ROM 002000,002FFF'));
  assert.equal(rom, 'S01A0000202020202020524F4D203030323030302C30303246464665', 'the example of hardware.md 4.2');
  sim.load(file([
    HEADER,
    srec('1', 0x2000, [0xAB]), // loading into a range that will be ROM works: the loader bypasses the map
    rom,
    srec('0', 0, text('     READ 003000,0030FF')),
    srec('0', 0, text('PROTECTED 004000,0040FF')),
    srec('0', 0, text('  INVALID 005000,0050FF')),
    srec('8', 0x001000),
  ]));
  assert.deepEqual(host.messages.slice(0, 6), [
    'S0 = 68KPROG   20CREATED BY EASY68K',
    'S0 =       ROM 002000,002FFF',
    'S0 =      READ 003000,0030FF',
    'S0 = PROTECTED 004000,0040FF',
    'S0 =   INVALID 005000,0050FF',
    '.S68 file read successful',
  ]);
  assert.deepEqual(sim.hardware().map, [
    { enabled: true, start: 0x2000, end: 0x2FFF },
    { enabled: true, start: 0x3000, end: 0x30FF },
    { enabled: true, start: 0x4000, end: 0x40FF },
    { enabled: true, start: 0x5000, end: 0x50FF },
  ]);
  assert.equal(sim.readByte(0x2000), 0xAB);

  // The map is never switched off by a load: a program without map records keeps it.
  sim.load(file([HEADER, srec('8', 0x001000)]));
  assert.equal(sim.hardware().map[0].enabled, true);
});

test('map records are ignored without (or before) the EASy68K header', async () => {
  const { sim } = await fresh();
  sim.load(file([srec('0', 0, text('      ROM 002000,002FFF')), HEADER, srec('8', 0x001000)]));
  assert.equal(sim.hardware().map[0].enabled, false);
});

test('a map record with a range that is not hexadecimal: "Unexpected Error reading .S68 file"', async () => {
  // The edit box's change handler does StrToInt("0x" + text), which throws;
  // loadSrec catches it and reports FAILURE, so OpenFile does nothing more.
  const { sim, host } = await fresh();
  sim.load(file([HEADER, srec('0', 0, text('      ROM 00ZZ00,002FFF')), srec('8', 0x001000)]));
  assert.deepEqual(host.messages, ['S0 = 68KPROG   20CREATED BY EASY68K', 'S0 =       ROM 00ZZ00,002FFF', 'Unexpected Error reading .S68 file']);
  assert.equal(sim.hardware().map[0].enabled, true, 'the check box had been set before the range failed');
  assert.equal(sim.listingLineCount, 0);
});

test('a file without a start record and without a listing leaves the PC where it was', async () => {
  const { sim } = await fresh();
  sim.setRegister(Reg.PC, 0x4321);
  sim.load(file([srec('1', 0x1000, [1])]));
  assert.equal(sim.getRegister(Reg.PC), 0x4321);
});

test('the first eight characters of the listing override the S-record start address', async () => {
  const { sim } = await fresh();
  const listing = textToBytes('00002000 Starting Address\r\nAssembler used: test\r\nCreated On: never\r\n\r\n');
  sim.load(file([srec('1', 0x1000, [1]), srec('8', 0x001000)]), listing);
  assert.equal(sim.getRegister(Reg.PC), 0x2000);
  assert.equal(sim.state().startPC, 0x2000);
  assert.equal(sim.listingLineCount, 4);
});

test('a listing whose first line is not an address: PC falls back to the PC displayed before the load (QUIRK)', async () => {
  const { sim } = await fresh();
  sim.setRegister(Reg.PC, 0x7770);
  sim.load(file([srec('8', 0x001000)]), textToBytes('Not a listing\r\n'));
  // initSim() at the start of the load re-displayed PC = $7770; loadSrec set
  // the variable to $1000 but not the box; OpenFile then reads the box.
  assert.equal(sim.getRegister(Reg.PC), 0x7770);
  assert.equal(sim.state().startPC, 0x7770);
});

test('an empty listing file: "Unexpected error in OpenFile"; the next Run starts at the displayed PC', async () => {
  const { sim, host } = await fresh();
  sim.setRegister(Reg.PC, 0x7770);
  sim.load(file([srec('1', 0x7770, [0x4E, 0x71, 0xFF, 0xFF, 0xFF, 0xFF]), srec('8', 0x001000)]), new Uint8Array(0));
  assert.equal(host.messages.at(-1), 'Unexpected error in OpenFile');
  assert.equal(sim.getRegister(Reg.PC), 0x1000, 'the variable has the S-record address');
  assert.equal(sim.boxText(Box.PC), '00007770', 'but the box still shows the old PC');
  sim.cmdRun(); // loadRegs() copies the box into PC
  drive(sim, host);
  assert.equal(sim.getRegister(Reg.PC), 0x7776, 'ran NOP and SIMHALT at $7770');
});

test('listing directives: break, bitfield (set only), simhalt_off', async () => {
  const { sim, host } = await fresh();
  sim.load(fixture('debug.S68'), fixture('debug.L68'));
  assert.deepEqual(sim.breakpoints(), [0x101E], '*[sim68k]break sets a breakpoint on the following instruction');
  assert.equal(sim.getOption(1), 0);

  sim.load(fixture('bitfield.S68'), fixture('bitfield.L68'));
  assert.equal(sim.getOption(1), 1, '*[sim68k]bitfield');
  assert.deepEqual(host.callsOf('optionChanged'), [[1, 1]]);
  assert.deepEqual(sim.breakpoints(), [], 'File > Open clears the PC breakpoints');
  sim.load(fixture('debug.S68'), fixture('debug.L68'));
  assert.equal(sim.getOption(1), 1, 'and nothing ever clears the bit-field option again');

  // simhalt_off: built from the debug listing by replacing the directive
  const listing = bytesToText(fixture('debug.L68')).replace('*[sim68k]break', '*[SIM68K]SimHalt_Off');
  sim.load(fixture('debug.S68'), textToBytes(listing));
  assert.equal(sim.getOption(2), 0, 'case-insensitive');
  sim.load(fixture('debug.S68'), fixture('debug.L68'));
  assert.equal(sim.getOption(2), 1, 'every load switches SIMHALT back on');
});

test('a break directive on the last listing line: "Unexpected error in OpenFile"', async () => {
  const { sim, host } = await fresh();
  const line = '0000101E'.padEnd(32, ' ') + '    20  *[sim68k]break';
  sim.load(file([srec('8', 0x001000)]), textToBytes(['00001000 Starting Address', 'x', 'y', '', line].join('\r\n')));
  assert.equal(host.messages.at(-1), 'Unexpected error in OpenFile');
});

test('Reload keeps the PC breakpoints, File > Open clears them; both reset the machine and refill memory', async () => {
  const { sim, host } = await fresh();
  sim.load(fixture('debug.S68'), fixture('debug.L68'));
  sim.setBreakpoint(0x1004);
  sim.cmdRun();
  drive(sim, host);
  sim.writeBytes(0x8000, [1, 2, 3]);
  sim.switchClick(0);
  sim.load(fixture('debug.S68'), fixture('debug.L68'), { kind: 'reload' });
  assert.deepEqual(sim.breakpoints(), [0x101E, 0x1004], 'kept (and the directive found its breakpoint already there)');
  assert.equal(sim.readByte(0x8000), 0xFF, 'memory refilled with $FF');
  assert.equal(sim.readByte(0xE00012), 0x00, 'the switch byte is cleared');
  assert.equal(sim.hardware().switchOn[0], false, 'and the switches are shown off');
  const r = sim.registers();
  assert.deepEqual([r.pc, r.sr, r.usp, r.ssp, r.cycles], [0x1000, 0x2000, 0x00FF0000, 0x01000000, 0n]);
  sim.load(fixture('debug.S68'), fixture('debug.L68'), { kind: 'open' });
  assert.deepEqual(sim.breakpoints(), [0x101E]);
});

test('Open Data loads records without resetting; its start address is lost at the next Run (QUIRK)', async () => {
  const { sim, host } = await fresh();
  sim.load(fixture('debug.S68'), fixture('debug.L68'));
  sim.setRegister(Reg.D0 + 3, 0x1234);
  assert.equal(sim.loadData(file([srec('1', 0x3000, [0xDA, 0x7A]), srec('8', 0x003000)])), true);
  assert.equal(sim.readWord(0x3000), 0xDA7A);
  assert.equal(sim.getRegister(Reg.D0 + 3), 0x1234, 'no reset');
  assert.equal(sim.getRegister(Reg.PC), 0x3000, 'the variable changed');
  assert.equal(sim.boxText(Box.PC), '00001000', 'the PC box did not');
  sim.cmdRun();
  assert.equal(sim.getRegister(Reg.PC), 0x1000, 'Run took the PC from the box');
  drive(sim, host);
  assert.equal(sim.loadData(null), false, 'a data file that cannot be opened');
});

test('Rewind restores the start address and the registers but not memory', async () => {
  const { sim, host } = await fresh();
  sim.load(fixture('debug.S68'), fixture('debug.L68'));
  sim.clearAllBreakpoints();
  sim.cmdRun();
  assert.equal(drive(sim, host).reason, 'stopped');
  assert.equal(sim.readLong(0x2000), 3, 'the program stored its counter');
  sim.rewind();
  const r = sim.registers();
  assert.deepEqual([r.pc, r.d[0], r.d[5], r.sr, r.cycles], [0x1000, 0, 0, 0x2000, 0n]);
  assert.equal(sim.readLong(0x2000), 3, 'memory keeps what the program wrote');
  assert.equal(sim.state().hardwareEnabled, true);
  assert.equal(sim.cmdTraceInto(), Status.STOPPED);
});
