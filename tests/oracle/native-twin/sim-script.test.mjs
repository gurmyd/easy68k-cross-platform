// Unit tests of the twin script language as run through the WebAssembly engine (sim-script.mjs),
// and, where the twin has been built (Windows, MSVC), of the twin giving the same transcript.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { simTwinPath } from './build-sim-twin.mjs';
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
    expect(s.remove(bytes('DATA.bin'))).toBe(true);
    expect(s.dump()).toEqual(['files 0']);
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

  const twin = simTwinPath('Od');
  it.skipIf(!enginesBuilt || !existsSync(twin))(
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
