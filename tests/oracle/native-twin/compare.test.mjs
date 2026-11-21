// Unit tests of the comparison helpers of the native-twin oracle (no build needed; the test of how
// programs are handed to the assembler needs engine/dist and skips without it).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { engineNativeFlags, ORIGINAL_ARCHIVE, systemTarPath, unpackZip } from './build-asm-twins.mjs';
import { engineSourceLists } from './build-sim-twin.mjs';
import { classifyUnpatched, patchTriggeredBy, unpatchedDiffers } from './compare-asm.mjs';
import { firstDifferentLine, knownDifference, standardScript } from './compare-sim.mjs';
import { assemblerModule, corpusFiles, loadProgram } from './corpus.mjs';

describe('assembler comparison', () => {
  const W = [
    'Line 3 ERROR: Undefined symbol',
    '00001000  4EB9 00000000             3          JSR     NOWHERE',
    '00001006  4E75                      4          RTS',
  ];

  it('accepts a difference in the object field of a line with an error (P7)', () => {
    const U = [W[0], '00001000  4EB9 C0FFEE00             3          JSR     NOWHERE', W[2]];
    expect(classifyUnpatched(W, U)).toBeNull();
  });

  it('rejects any other difference', () => {
    expect(classifyUnpatched(W, [W[0], W[1], '00001006  4E71                      4          RTS'])).toMatch(/^line 3/);
    expect(classifyUnpatched(W, W.slice(0, 2))).toMatch(/line counts differ/);
    expect(classifyUnpatched(W, null)).toBe('listing missing');
  });

  it('reads the list of engine cases in which the unpatched twin must differ', () => {
    const keys = unpatchedDiffers();
    expect(keys.size).toBeGreaterThanOrEqual(5);
    for (const key of keys) expect(key).toMatch(/#\d+$/);
  });

  it('reads the engine build scripts it mirrors', () => {
    const flags = engineNativeFlags();
    expect(flags).toEqual(expect.arrayContaining(['/EHa', '/MT', '/nologo', '/c']));
    expect(flags).not.toContain('/Od');
    expect(ORIGINAL_ARCHIVE.sha256).toMatch(/^[0-9a-f]{64}$/);
    const { original, shim } = engineSourceLists();
    expect(original).toContain('RUN.CPP');
    expect(shim).toContain('hostfile.cpp');
  });

  it('unpacks with the System32 bsdtar, never a tar found on PATH', () => {
    expect(systemTarPath({ SystemRoot: 'D:\\Win' })).toBe(join('D:\\Win', 'System32', 'tar.exe'));
    expect(systemTarPath({})).toBe(join('C:\\Windows', 'System32', 'tar.exe'));
  });

  it.runIf(process.platform === 'win32')(
    'unpacks a zip at a drive-letter path while GNU tar comes first on PATH',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 't4-unzip-'));
      const savedPath = process.env.PATH;
      try {
        mkdirSync(join(dir, 'src'));
        writeFileSync(join(dir, 'src', 'ASSEMBLE.CPP'), 'x');
        const made = spawnSync(systemTarPath(), ['-a', '-c', '-f', join(dir, 'a.zip'), 'ASSEMBLE.CPP'], {
          cwd: join(dir, 'src'),
          windowsHide: true,
        });
        expect(made.status).toBe(0);
        mkdirSync(join(dir, 'out'));
        // A fake GNU-style 'tar' first on PATH: a bare spawn of 'tar' would run it and fail.
        mkdirSync(join(dir, 'bin'));
        writeFileSync(
          join(dir, 'bin', 'tar.cmd'),
          '@echo Cannot connect to C: resolve failed 1>&2\r\n@exit /b 128\r\n',
        );
        writeFileSync(join(dir, 'bin', 'tar.bat'), '@exit /b 128\r\n');
        const gitTar = 'C:\\Program Files\\Git\\usr\\bin';
        process.env.PATH = [join(dir, 'bin'), ...(existsSync(gitTar) ? [gitTar] : []), savedPath].join(';');
        unpackZip(join(dir, 'a.zip'), join(dir, 'out'));
        expect(readFileSync(join(dir, 'out', 'ASSEMBLE.CPP'), 'utf8')).toBe('x');
      } finally {
        process.env.PATH = savedPath;
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('never takes a corpus file from reference/examples/github/easy68k-qt', () => {
    for (const path of corpusFiles({ local: true })) expect(path.toLowerCase()).not.toContain('easy68k-qt');
  });
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const enginesBuilt = existsSync(join(repoRoot, 'engine', 'dist', 'asm68k.wasm'));

describe('the programs of the comparison', () => {
  it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)(
    'engine/dist holds the assembler (EASY68K_REQUIRE_ENGINES=1)',
    () => {
      expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist/asm68k.wasm is missing: run `npm run build:engines`.');
    },
  );

  // The simulator conformance programs INCLUDE '..\dumplib.X68'. Before the parent folder was
  // handed to the assembler, every one of them failed to assemble and the simulator comparison
  // skipped it without a word.
  it.skipIf(!enginesBuilt)(
    'assembles a program that includes a file of its parent folder',
    async () => {
      const withParent = corpusFiles().filter((p) => /\bINCLUDE\s+'\.\.\\/i.test(readFileSync(p, 'latin1')));
      expect(withParent.length).toBeGreaterThan(0);
      const { assemble } = await assemblerModule();
      const failed = [];
      for (const path of withParent.slice(0, 5)) {
        const p = await loadProgram(path);
        expect(p.mainName).toBe(`${basename(dirname(path))}/${basename(path)}`);
        expect(p.inputs.map(([name]) => name)).toContain(p.mainName);
        const result = await assemble(p.mainName, new Map(p.inputs), {}, { year: 2026, month: 1, day: 1 });
        if (result.fatal || !result.sRecord || result.errorCount)
          failed.push(`${p.rel}: ${result.errorCount} error(s)`);
      }
      expect(failed).toEqual([]);
      // a program without such a reference keeps its plain name
      const plain = corpusFiles().find(
        (p) => p.replaceAll('\\', '/').includes('/tests/corpus/') && !/\.\.[\\/]/.test(readFileSync(p, 'latin1')),
      );
      expect(plain).toBeDefined();
      expect((await loadProgram(plain)).mainName).toBe(basename(plain));
    },
    60_000,
  );
});

describe('simulator comparison', () => {
  it('builds the standard script', () => {
    const s = standardScript('My Prog.X68', true).split('\n');
    expect(s).toContain('load prog.S68 prog.L68 "My_Prog.X68"');
    expect(s).toContain('run 300000');
    expect(s).toContain('dump crc 0 16777216');
    expect(s).toContain('trace 300');
    expect(standardScript('a.S68', false)).toContain('load prog.S68 - "a.S68"');
  });

  it('skips the known difference D1 (task 0/1 text after 255 bytes) and nothing else', () => {
    const s255 = '\\xFF'.repeat(255);
    const wasm = `@textOutCR "${s255}"`;
    expect(knownDifference(wasm, `@textOutCR "${s255}\\xFDA"`)).toBe('D1');
    expect(knownDifference(wasm, '@textOutCR #600:0123ABCD')).toBe('D1');
    expect(knownDifference(wasm, `@textOut "${s255}A"`)).toBeNull();
    expect(knownDifference(`@textOutCR "${'\\xFF'.repeat(254)}"`, `@textOutCR "${s255}A"`)).toBeNull();
    expect(knownDifference(wasm, `@textOutCR "${'\\xFE'.repeat(255)}A"`)).toBeNull();
    const known = [];
    expect(firstDifferentLine(`a\n${wasm}\nb\n`, `a\n@textOutCR "${s255}Z"\nb\n`, known)).toBeNull();
    expect(known).toEqual([{ line: 2, defect: 'D1' }]);
    expect(firstDifferentLine(`a\n${wasm}\nb\n`, `a\n@textOutCR "${s255}Z"\nc\n`)).toMatchObject({ line: 3 });
  });

  it('names the corpus programs that exercise a patched assembler defect', () => {
    expect(patchTriggeredBy('tests/conformance/asm/checklist/programs/macro-10-expanded-line/prog.X68')).toMatch(/^P8/);
    expect(patchTriggeredBy('tests/corpus/official/x.X68')).toBeNull();
  });

  it('finds the first differing transcript line', () => {
    expect(firstDifferentLine('a\nb\n', 'a\nb\n')).toBeNull();
    expect(firstDifferentLine('a\nb\n', 'a\nc\n')).toEqual({ line: 2, wasm: 'b', twin: 'c' });
    expect(firstDifferentLine('a\n', 'a\nb\n')).toEqual({ line: 2, wasm: '', twin: 'b' });
  });
});
