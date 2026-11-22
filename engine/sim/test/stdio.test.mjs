// easy68k-mac: the file streams of TRAP #15 tasks 50-59 as the Borland run-time of SIM68K.exe has
// them (shim/STDIO-MODEL.md; the rules R1-R13 named below are its sections 4-6).
//
// The fixture stdio.X68 stores D0.W and D2.L after every task. The headless host is an
// operating system without buffers, so what the engine hands it shows directly in host.file().
// Every rule was measured in the official program (STDIO-MODEL.md names the conformance program or
// probe for each); these tests pin the engine's side, also of what the oracle's recipes cannot
// drive (Rewind, the end of the process, the heap damage).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.mjs';
import { Reg } from '../sim68k.mjs';
import { drive } from './headless-host.mjs';

const RESULTS = 0x8000;

/** The (D0.W, D2.L) pairs the fixture stored. */
function results(sim, count) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push([sim.readWord(RESULTS + 6 * i), sim.readLong(RESULTS + 6 * i + 2)]);
  }
  return list;
}
const text = (bytes) => String.fromCharCode(...(bytes ?? []));

test('a read right after a write takes the bytes from the buffer and shortens the flush (R3, R6)', async () => {
  const { sim, host } = await run('stdio', { caseNumber: 0 });
  const [made, written, read, closed] = results(sim, 4);
  assert.equal(made[0], 0);
  assert.equal(written[0], 0);
  assert.deepEqual(read, [0, 4], 'success, 4 bytes (the buffer after ABCDE)');
  assert.equal(closed[0], 0);
  assert.equal(text(host.file('XA.BIN')), 'A', 'the flush wrote 5 - 4 = 1 byte');
  assert.equal(host.handles.size, 0);
});

test('a write right after a read goes into the read buffer and never reaches the file (R8)', async () => {
  const { sim, host } = await run('stdio', { caseNumber: 1 });
  const list = results(sim, 6);
  assert.deepEqual(list.map(([d0]) => d0), [0, 0, 0, 0, 0, 0], 'every task reports success');
  assert.equal(list[3][1], 2, 'the read got 2 bytes');
  assert.equal(text(host.file('XA.BIN')), 'ABCDE', 'the X is lost');
});

test('a flush of a negative count fails: the close fails and the file stays open (R6, R12)', async () => {
  const { sim, host } = await run('stdio', { caseNumber: 2 });
  const list = results(sim, 7);
  assert.deepEqual(list[4], [0, 4], 'the read in the write state succeeds');
  assert.equal(list[5][0], 2, 'close: D0.W = 2');
  assert.equal(list[6][0], 2, 'delete: D0.W = 2, the handle is still open');
  assert.equal(host.handles.size, 1);
  assert.equal(text(host.file('XA.BIN')), 'ABCDE', 'the X was never written, the file kept 5 bytes');
});

test('the error flag survives a seek: small reads end the file, reads of 512 or more do not (R5, R11)', async () => {
  const { sim, host } = await run('stdio', { caseNumber: 3 });
  const list = results(sim, 9);
  assert.equal(list[1][0], 0, '600 bytes written');
  assert.equal(list[2][0], 0, '5 bytes buffered');
  assert.deepEqual(list[3], [0, 7], 'read 7 in the write state');
  assert.equal(list[4][0], 2, 'the first seek fails (its flush has a count of -2)');
  assert.equal(list[5][0], 0, 'the second one succeeds');
  assert.equal(list[6][0], 1, 'read 3: nothing, and _fread sets the end-of-file flag: D0.W = 1');
  assert.deepEqual(list[7], [0, 512], 'read 600: the 512 read straight from the file');
  assert.equal(list[8][0], 0, 'close');
  assert.equal(host.file('XA.BIN').length, 600);
});

test('a write after a read that emptied the buffer writes the buffer from its start (R10)', async () => {
  const data = new Uint8Array(300).map((_, i) => (i % 251) + 1);
  const { sim, host } = await run('stdio', { caseNumber: 4, host: { files: { 'in.bin': data } } });
  const list = results(sim, 5);
  assert.deepEqual(list.map(([d0]) => d0), [0, 0, 0, 0, 0]);
  const file = host.file('IN.BIN');
  assert.equal(file.length, 302);
  assert.deepEqual([...file.subarray(300)], [1, 2], 'the first two bytes of the buffer, not XY');
});

test('a stream whose close failed keeps its entry: 47 streams in all (section 8)', async () => {
  const { sim, host } = await run('stdio', { caseNumber: 5 });
  assert.equal(60 - sim.readWord(RESULTS), 47, 'streams opened before an open failed');
  assert.equal(host.handles.size, 47);
});

test('a stream that a Rewind forgets keeps its bytes and the file until the end (R13; probe e2)', async () => {
  const { sim, host } = await run('stdio', { caseNumber: 6 });
  assert.equal(host.file('XA.BIN').length, 0, 'the bytes are in the forgotten buffer');
  sim.rewind();
  sim.setRegister(Reg.D7, 6);
  sim.cmdRun();
  drive(sim, host);
  const list = results(sim, 4);
  assert.equal(list[0][0], 0, 'the second run opens the file');
  assert.equal(list[1][0], 1, 'and reads nothing (end of file)');
  assert.equal(list[3][0], 2, 'the forgotten stream keeps the file open: the delete fails');
  host.exit(); // the process ends: the run-time flushes every stream
  assert.equal(text(host.file('XA.BIN')), 'ABCDE');
});

test('a write more than 4 bytes past the buffer damages the heap: the next release fails (section 7; p10a, p12)', async () => {
  const data = new Uint8Array(1100).fill(0x41);
  const { sim, host } = await run('stdio', { caseNumber: 7, host: { files: { 'in.bin': data } } });
  const list = results(sim, 3);
  assert.deepEqual(list.map(([d0]) => d0), [0, 0, 0], 'open, read and write report success');
  assert.equal(sim.readWord(RESULTS + 18), 0xffff, 'the close never returned');
  assert.ok(host.alerts.some((a) => a.text.includes("exception occurred in routine 'exec_inst'")), JSON.stringify(host.alerts));
});
