// Unit tests of the twin script language as run through the WebAssembly engine (sim-script.mjs),
// and, where the twin has been built (Windows, MSVC), of the twin giving the same transcript.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { simTwinInputsDigest, simTwinPath, simTwinState } from './build-sim-twin.mjs';
import {
  crc32,
  escapeBytes,
  formatBytesArgument,
  isPlainName,
  parseNumber,
  runScript,
  Sandbox,
  tokenize,
} from './sim-script.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const enginesBuilt =
  existsSync(join(repo, 'engine', 'dist', 'sim68k.wasm')) &&
  existsSync(join(repo, 'engine', 'dist', 'sim68k-loader.mjs'));
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';
const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('script syntax', () => {
  it('splits words and quoted strings with escapes', () => {
    expect(tokenize('keys "a b\\r\\x41\\\\\\"" x')).toEqual([
      { text: 'keys', quoted: false },
      { text: 'a b\rA\\"', quoted: true },
      { text: 'x', quoted: false },
    ]);
    expect(() => tokenize('keys "open')).toThrow(/unterminated/);
    expect(() => tokenize('keys "\\q"')).toThrow(/bad escape/);
  });

  it('reads $hex, 0xhex and decimal numbers and wraps them to 32 bits', () => {
    expect(parseNumber('$FF')).toBe(255);
    expect(parseNumber('0x10')).toBe(16);
    expect(parseNumber('-1')).toBe(-1);
    expect(parseNumber('$FFFFFFFF')).toBe(-1);
    expect(parseNumber('$100000000')).toBe(0);
    expect(() => parseNumber('12a')).toThrow(/bad number/);
    expect(() => parseNumber('$')).toThrow(/bad number/);
  });
});

describe('transcript format', () => {
  it('escapes bytes like driver.cpp', () => {
    expect(escapeBytes(bytes('A "q" \\ \x00\xff'))).toBe('"A \\x22q\\x22 \\x5C \\x00\\xFF"');
  });
  it('writes long byte arguments as length and CRC-32', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('6789'), crc32(bytes('12345')))).toBe(0xcbf43926);
    expect(formatBytesArgument(new Uint8Array(512).fill(0x41))).toBe(`"${'A'.repeat(512)}"`);
    expect(formatBytesArgument(new Uint8Array(513).fill(0xff))).toMatch(/^#513:[0-9A-F]{8}$/);
  });
});

describe('the sandbox of program files', () => {
  it('accepts plain names only', () => {
    for (const ok of ['a.txt', 'Output.BIN', 'x_y-z', '9']) expect(isPlainName(ok), ok).toBe(true);
    for (const bad of ['', '.hidden', 'C:\\x.txt', 'a/b', 'a b', 'x'.repeat(65)])
      expect(isPlainName(bad), bad).toBe(false);
  });

  // Gate I2: T3's programs a57 and a58 open 'DATA.TXT.' and 'NUL', which the twin's real Windows
  // files resolve to data.txt and the null device; the in-memory side cannot, so both refuse them.
  it('refuses a trailing dot and the Windows device names', () => {
    for (const bad of ['DATA.TXT.', 'a.', 'NUL', 'nul.txt', 'Con', 'PRN', 'aux.bin', 'COM1', 'lpt9.x', 'COM0'])
      expect(isPlainName(bad), bad).toBe(false);
    for (const ok of ['NULL', 'nul_x', 'COM10', 'console.txt', 'LPT', 'a.b.c']) expect(isPlainName(ok), ok).toBe(true);
  });

  // Gate I2: T3's programs a35 and a56 remove an open file and open one file twice. The twin
  // keeps a file open in at most one stream (sim-twin/host-native.cpp); the sandbox must agree.
  it('lets a file be open in one stream at a time and not be removed while open', () => {
    const s = new Sandbox();
    const w = s.open(bytes('two.bin'), 2);
    expect(s.write(w, bytes('ABCD'))).toBe(4);
    expect(s.open(bytes('TWO.bin'), 0)).toBe(0);
    expect(s.open(bytes('two.bin'), 2)).toBe(0);
    expect(s.remove(bytes('two.bin'))).toBe(false);
    expect(s.close(w)).toBe(true);
    const r = s.open(bytes('two.bin'), 1);
    expect(r).toBeGreaterThan(0);
    expect(s.open(bytes('two.bin'), 1)).toBe(0);
    expect(s.close(r)).toBe(true);
    expect(s.remove(bytes('two.bin'))).toBe(true);
  });

  it('has the semantics of fopen r+b / rb / w+b on a case-insensitive file system', () => {
    const s = new Sandbox();
    expect(s.open(bytes('missing.txt'), 0)).toBe(0);
    const w = s.open(bytes('Data.BIN'), 2);
    expect(w).toBeGreaterThan(0);
    expect(s.write(w, bytes('hello'))).toBe(5);
    expect(s.seek(w, 8, 0)).toBe(8);
    expect(s.write(w, bytes('!'))).toBe(1);
    expect(s.close(w)).toBe(true);
    const r = s.open(bytes('data.bin'), 1);
    expect(s.write(r, bytes('x'))).toBe(-1);
    expect([...s.read(r, 100)]).toEqual([...bytes('hello'), 0, 0, 0, 0x21]);
    expect(s.read(r, 10)).toHaveLength(0);
    expect(s.seek(r, -1, 0)).toBe(-1);
    expect(s.dump()).toEqual(['files 1', 'file "Data.BIN" 9 68656C6C6F00000021']);
    expect(s.close(r)).toBe(true);
    expect(s.remove(bytes('DATA.bin'))).toBe(true);
    expect(s.dump()).toEqual(['files 0']);
  });
});

describe('the source stamp of a built twin', () => {
  it("tells a twin built from today's sources from a stale or missing one", () => {
    const digest = simTwinInputsDigest();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(simTwinInputsDigest()).toBe(digest);
    const dir = join(repo, 'build', 'native-twin', `unit-stamp-${process.pid}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const exe = join(dir, 'sim-twin.exe');
    try {
      expect(simTwinState('Od', digest, exe)).toBe('missing');
      writeFileSync(exe, '');
      // built before stamps existed (the case that compared a twin from older engine sources)
      expect(simTwinState('Od', digest, exe)).toBe('stale');
      writeFileSync(join(dir, 'sources.sha256'), `${'0'.repeat(64)}\n`);
      expect(simTwinState('Od', digest, exe)).toBe('stale');
      writeFileSync(join(dir, 'sources.sha256'), `${digest}\n`);
      expect(simTwinState('Od', digest, exe)).toBe('current');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('running a script through the WebAssembly simulator', () => {
  it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds the simulator (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist/sim68k.wasm is missing: run `npm run build:engines` first.',
    );
  });

  const script = [
    '# MOVEQ #5,D0 ; ADDQ.L #3,D0 ; then a SIMHALT',
    'poke $1000 70055680FFFFFFFF',
    'reg PC $1000',
    'hostlog off',
    'trace 2',
    'dump regs',
    'dump mem $1000 4',
    'dump bytes $1001 $1003',
    'dump crc $1000 8',
    'echo done "x y"',
    '',
  ].join('\n');

  it.skipIf(!enginesBuilt)('executes, dumps and echoes', async () => {
    // (the host calls of the simulator's start-up come before the first script line)
    const lines = (await runScript(script)).split('\n').filter((l) => !l.startsWith('@'));
    expect(lines[0]).toBe('status 1 steps 2');
    expect(lines[1]).toMatch(/^regs D0=00000008 .* PC=00001004 SR=2000 cycles=\d+$/);
    expect(lines[2]).toBe('mem 001000 70055680');
    expect(lines[3]).toBe('bytes 0580');
    expect(lines[4]).toBe(
      `crc 001000 8 ${crc32(Uint8Array.from([0x70, 5, 0x56, 0x80, 0xff, 0xff, 0xff, 0xff]))
        .toString(16)
        .toUpperCase()
        .padStart(8, '0')}`,
    );
    expect(lines[5]).toBe('echo done x y');
  });

  it.skipIf(!enginesBuilt)('reports script errors with the line number', async () => {
    await expect(runScript('reg Q9 1\n')).rejects.toThrow(/script line 1: unknown register: Q9/);
  });

  // Only a twin built from today's sources is compared: one built before an edit of engine/sim
  // differs wherever the edit changed behaviour, which says nothing about the compiler.
  const twin = simTwinPath('Od');
  const twinState = simTwinState('Od');
  if (twinState === 'stale')
    console.log(
      `sim-script.test.mjs: ${twin} was built from other sources than today's engine/sim; not compared. ` +
        'Rebuild it with: node tests/oracle/native-twin/build-sim-twin.mjs',
    );
  it.skipIf(!enginesBuilt || twinState !== 'current')(
    'the built twin gives the same transcript (with host calls)',
    async () => {
      const dir = join(repo, 'build', 'native-twin', 'unit-test');
      rmSync(dir, { recursive: true, force: true });
      for (const sub of ['sandbox', 'work']) mkdirSync(join(dir, sub), { recursive: true });
      const withHost = script.replace('hostlog off', 'hostlog on');
      writeFileSync(join(dir, 'unit.sim'), withHost);
      const r = spawnSync(twin, [
        '--script',
        join(dir, 'unit.sim'),
        '--sandbox',
        join(dir, 'sandbox'),
        '--work',
        join(dir, 'work'),
        '--out',
        join(dir, 'out.txt'),
      ]);
      expect(r.status).toBe(0);
      expect(readFileSync(join(dir, 'out.txt'), 'latin1')).toBe(await runScript(withHost));
      rmSync(dir, { recursive: true, force: true });
    },
  );
});
