// The engine's outer surface: the host interface is complete and consistent
// between its three descriptions (C imports, JavaScript glue, JSDoc typedef),
// the engine runs with an empty host, the command-line runner works, and the
// source files match the originals except for the documented changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSim, HOST_DEFAULTS, Status, Reg } from '../sim68k.mjs';
import { fixture, start } from './helpers.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('every import of host.h has glue, every glue function calls one documented host method', () => {
  const header = read('shim/host.h');
  const glue = read('shim/host-imports.js');
  const api = read('sim68k.mjs');
  const imports = [...header.matchAll(/\b(host_[a-zA-Z0-9_]+)\s*\(/g)].map((m) => m[1]);
  const glued = [...glue.matchAll(/^\s{2}(host_[a-zA-Z0-9_]+): \(/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(imports)].sort(), [...new Set(glued)].sort(), 'host.h and host-imports.js list the same imports');

  const called = [...glue.matchAll(/simHost\(\)\.([a-zA-Z0-9]+)\(/g)].map((m) => m[1]);
  const methods = Object.keys(HOST_DEFAULTS);
  assert.deepEqual([...new Set(called)].sort(), methods.slice().sort(), 'the glue calls exactly the methods of HOST_DEFAULTS');
  assert.equal(new Set(called).size, glued.length, 'one host method per import');

  const typedef = api.slice(api.indexOf('@typedef {object} SimHost'), api.indexOf('export const HOST_DEFAULTS'));
  const documentedMethods = [...typedef.matchAll(/@property \{.*\} \[([a-zA-Z0-9]+)\]/g)].map((m) => m[1]);
  assert.deepEqual(documentedMethods.slice().sort(), methods.slice().sort(), 'the SimHost typedef documents every method');
});

test('the build output is a loader plus a separate .wasm file', () => {
  const loader = new URL('../../dist/sim68k-loader.mjs', import.meta.url);
  const wasm = new URL('../../dist/sim68k.wasm', import.meta.url);
  assert.equal(existsSync(loader) && existsSync(wasm), true, 'run node engine/sim/build.mjs first');
  const text = readFileSync(loader, 'utf8');
  assert.equal(text.includes('sim68k.wasm'), true);
  assert.equal(/^import\s/m.test(text), false, 'no static import: the same file loads in browsers and in Node');
  const bytes = readFileSync(wasm);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6D]);
});

test('the engine runs with a host that implements nothing', async () => {
  const sim = await createSim();
  sim.load(fixture('io.S68'), fixture('io.L68'));
  sim.cmdRun();
  assert.equal(sim.run(100000), Status.STOPPED);
  assert.equal(sim.state().halt, true);
  // and with the caller supplying the wasm bytes itself (a browser that has
  // fetched the file, a bundler): nothing is loaded from the loader's location
  const other = await createSim({}, {
    wasmBinary: readFileSync(new URL('../../dist/sim68k.wasm', import.meta.url)),
    locateFile: (file) => `/no/such/place/${file}`,
  });
  assert.equal(other.getRegister(Reg.SSP), 0x01000000);
});

test('instances are independent', async () => {
  const a = await start('debug');
  const b = await start('debug');
  a.sim.cmdTraceInto();
  a.sim.writeBytes(0x9000, [1]);
  assert.equal(b.sim.getRegister(Reg.PC), 0x1000);
  assert.equal(b.sim.readByte(0x9000), 0xFF);
});

test('createSim({ wasmModule }): every instance comes from the compiled module, never from the file', async (t) => {
  const wasmModule = await WebAssembly.compile(readFileSync(new URL('../dist/sim68k.wasm', root)));
  const instantiate = t.mock.method(WebAssembly, 'instantiate');
  const a = await createSim({}, { wasmModule, locateFile: () => { throw new Error('the file was asked for'); } });
  const b = await createSim({}, { wasmModule });
  assert.deepEqual(instantiate.mock.calls.map((c) => c.arguments[0]), [wasmModule, wasmModule]);
  assert.notEqual(a.memory.buffer, b.memory.buffer, 'independent instances');
  assert.equal(a.getRegister(Reg.SSP), 0x01000000, 'in start-up state');
});

test('createSim({ wasmModule }): an instance that cannot be created rejects createSim, and the next one works', async (t) => {
  const wasmModule = await WebAssembly.compile(readFileSync(new URL('../dist/sim68k.wasm', root)));
  const instantiate = t.mock.method(WebAssembly, 'instantiate', () => Promise.reject(new RangeError('Out of memory')));
  await assert.rejects(createSim({}, { wasmModule }), /Out of memory/);
  instantiate.mock.restore();
  const sim = await createSim({}, { wasmModule });
  assert.equal(sim.getRegister(Reg.SSP), 0x01000000);
});

test('a command that executes is refused while a step is suspended', async () => {
  const { sim } = await start('io', { caseNumber: 9 });
  sim.cmdRun();
  assert.equal(sim.run(1000), Status.WAIT_DELAY);
  assert.equal(sim.cmdTraceInto(), Status.BUSY);
  assert.equal(sim.autoTraceTick(), Status.BUSY);
  assert.equal(sim.delayRemaining, 50, 'nothing changed');
});

test('load() insists on bytes', async () => {
  const sim = await createSim();
  assert.throws(() => sim.load('S9030000FC'), TypeError);
});

// ---------------------------------------------------------------------------
// run-s68.mjs
// ---------------------------------------------------------------------------
const runner = fileURLToPath(new URL('./run-s68.mjs', import.meta.url));
const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [runner, ...args], { encoding: 'latin1', env: { ...process.env, NODE_TEST_CONTEXT: '' } });

test('run-s68: text output, registers, cycle count, exit code', () => {
  const r = cli(fixturePath('debug.S68'), '--no-listing');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, [
    '--- messages ---',
    'S0 = 68KPROG   20CREATED BY EASY68K',
    '.S68 file read successful',
    'Unable to open .L68 file.',
    '--- output ---',
    '',
    '--- registers ---',
    'D0=00000003 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC',
    'D1=00000000 D5=00000008 A1=00000000 A5=00000000 SR=0010000000000000',
    'D2=0000000A D6=00000000 A2=00000000 A6=00000000 US=00FF0000',
    'D3=00001234 D7=00000000 A3=00000000 A7=01000000 SS=01000000',
    'PC=0000102A',
    // 8 (two MOVEQ) + 3 loop passes (96 + 96 + 94) + 8 + 20 + 32 + 16 + 4, per the timing tables
    'Cycles=374',
    '--- end: stopped ---',
    '',
  ].join('\n'));
});

test('run-s68: the listing next to the .S68 is used; --keys; --json', () => {
  // debug.L68 carries a breakpoint directive: the run ends there
  let r = cli(fixturePath('debug.S68'), '--json');
  let result = JSON.parse(r.stdout);
  assert.equal(result.reason, 'stopped');
  assert.equal(result.registers.pc, 0x101E);
  assert.equal(result.halt, false);

  r = cli(fixturePath('io.S68'), '--keys', 'abc\\n', '--json');
  result = JSON.parse(r.stdout);
  assert.equal(result.output, 'ABCDEF\nGHI\nGH!', 'case 0 of the io fixture');
});

test('run-s68: waiting for input ends the run with "input"', () => {
  const r = cli(fixturePath('hello-input.S68'), '--json');
  const result = JSON.parse(r.stdout);
  assert.equal(result.reason, 'input');
  assert.equal(result.output, 'Name? ');
  assert.equal(r.status, 0);
  const again = JSON.parse(cli(fixturePath('hello-input.S68'), '--keys', 'Ada\\n', '--json').stdout);
  assert.equal(again.reason, 'stopped');
  assert.equal(again.output, 'Name? Ada\nHello, Ada\n');
});

test('run-s68 --log 2: the per-instruction trace in execution-log format', () => {
  const r = cli(fixturePath('hello-input.S68'), '--keys', 'Z\\n', '--log', '2', '--log-time', 'NOW');
  assert.equal(r.status, 0, r.stderr);
  const log = r.stdout.slice(r.stdout.indexOf('--- execution log ---\n') + 22).split('\r\n');
  assert.equal(log[0], 'EASy68K execution log file: NOW');
  assert.equal(log[3], 'D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC');
  assert.equal(log[7].startsWith('PC=00001000  Code='), true);
  assert.equal(r.stdout.includes('[message box "Information"] Current Log Stopped.'), true);
  assert.equal(r.stdout.includes('Hello, Z'), true);
});

test('run-s68: usage errors', () => {
  assert.equal(cli().status, 1);
  assert.equal(cli(fixturePath('debug.S68'), '--bogus').status, 1);
});

// ---------------------------------------------------------------------------
// the ported sources against the originals
// ---------------------------------------------------------------------------
test('src/ differs from the original v5.16.1 files only by the changes listed in PATCHES.md', (t) => {
  const script = fileURLToPath(new URL('../check-patches.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  if (r.status === 2) {
    t.skip('the original sources (reference/src-sim68k) are not present');
    return;
  }
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /43 changed regions in 22 files; 0 problems\./);
});
