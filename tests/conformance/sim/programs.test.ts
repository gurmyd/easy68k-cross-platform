// The conformance programs themselves: headers, recipes, the generated instruction programs, and
// that every program assembles with the port's assembler without errors. Owner: T3.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createAsmEngine } from '../../../app/src/engine';
import { TEST_ASM_OPTIONS, TEST_ASM_TIME } from '../../../app/src/engine/testing';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleConformance, runScenario } from './harness';
import {
  SIM_CONFORMANCE_DIR,
  artifactsOf,
  countLoggedInstructions,
  listPrograms,
  maskArtifact,
  maskListing,
  parseHeader,
  parseRecipe,
  recipeId,
  resultLines,
} from './programs';

const dist = (file: string) => fileURLToPath(new URL(`../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe('program headers', () => {
  it('parses items, recipes, switches, files, timeout and owner', () => {
    const program = parseHeader(
      [
        '* @item one',
        '* @item two',
        '* @recipe report log:3+out',
        '* @switches /e /B',
        '* @files a.bin',
        '* @timeout 9',
        '* @owner SH3',
        '    ORG $1000',
        '* @item not header',
      ].join('\r\n'),
      'trap15-a',
      'x',
      'trap15-a/x.X68',
    );
    expect(program.items).toEqual(['one', 'two']);
    expect(program.recipes.map(recipeId)).toEqual(['report', 'log:3+out']);
    expect(program.switches).toEqual(['/e', '/B']);
    expect(program.files).toEqual(['a.bin']);
    expect(program.timeoutSeconds).toBe(9);
    expect(program.owner).toBe('SH3');
    expect(artifactsOf(program).map((a) => a.golden)).toEqual([
      'trap15-a/x.result.bin',
      'trap15-a/x.log3o.RunLog.txt',
      'trap15-a/x.log3o.OutLog.txt',
    ]);
  });

  it('refuses unknown keys, recipes and switches, and a program without an item', () => {
    expect(() => parseHeader('* @colour red\n', 'logs', 'x', 'x')).toThrow(/unknown header key/);
    expect(() => parseRecipe('log:4')).toThrow(/unknown recipe/);
    expect(() => parseHeader('* @item a\n* @switches /r\n', 'logs', 'x', 'x')).toThrow(/switch/);
    expect(() => parseHeader('* nothing\n', 'logs', 'x', 'x')).toThrow(/no @item/);
    expect(parseHeader('* @item a\n', 'logs', 'x', 'x').recipes.map(recipeId)).toEqual(['log:2']);
  });

  it('masks the dates of logs and listings, and counts logged instructions', () => {
    expect(maskArtifact('runlog', bytes('EASy68K execution log file: 11/20/2026 9:56:12 PM\r\n\r\nPC=1'))).toBe(
      'EASy68K execution log file: <date>\r\n\r\nPC=1',
    );
    expect(maskArtifact('result', bytes('EASy68K output log file: x'))).toBe('EASy68K output log file: x');
    expect(maskListing(bytes('00000000 Starts at 1000\r\nCreated On: 1/1/2026 12:00:00 PM\r\n'))).toBe(
      '00000000 Starts at 1000\r\nCreated On:<date>\r\n',
    );
    expect(countLoggedInstructions('x\r\nPC=00001000 a\r\n\r\nPC=00001002 b')).toBe(2);
    expect(resultLines('A\r\nEND-OF-DUMP\r\n')).toEqual(['A', 'END-OF-DUMP']);
  });
});

describe('the suite', () => {
  const programs = listPrograms();

  it('has at least 150 self-reporting programs and 20 execution logs', () => {
    const reports = programs.filter((p) => p.recipes.some((r) => r.kind === 'report'));
    const logs = programs.flatMap((p) => p.recipes.filter((r) => r.kind === 'log'));
    expect(reports.length).toBeGreaterThanOrEqual(150);
    expect(logs.length).toBeGreaterThanOrEqual(20);
  });

  it('every report program opens, closes and includes the self-report routines', () => {
    const wrong: string[] = [];
    for (const program of programs.filter((p) => p.recipes.some((r) => r.kind === 'report'))) {
      const text = readFileSync(join(SIM_CONFORMANCE_DIR, program.source), 'latin1');
      if (
        !/JSR\s+DMP_OPEN/.test(text) ||
        !/JSR\s+DMP_CLOSE/.test(text) ||
        !/INCLUDE\s+'\.\.\\dumplib\.X68'/.test(text)
      ) {
        wrong.push(program.id);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the network tasks 102-107 each have a self-reporting program that calls them before any task 100 or 101 (errata T3 11)', () => {
    // The not-initialised paths need no peer (trap15-b 12.2): they are not interactive.
    const task = (n: number) => new RegExp(`MOVE\\.L\\s+#\\$ABCD00${n.toString(16).toUpperCase()},D0`, 'i');
    const callers = (n: number) =>
      programs
        .filter((p) => p.recipes.some((r) => r.kind === 'report'))
        .map((p) => readFileSync(join(SIM_CONFORMANCE_DIR, p.source), 'latin1'))
        .filter((text) => task(n).test(text) && !task(100).test(text) && !task(101).test(text));
    const missing = [102, 103, 104, 105, 106, 107].filter((n) => callers(n).length === 0);
    expect(missing).toEqual([]);
  });

  it('the generated instruction programs are what generate-instructions.mjs writes', () => {
    const script = join(SIM_CONFORMANCE_DIR, 'generate-instructions.mjs');
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it.skipIf(!enginesBuilt)(
    'every program assembles with the port without errors (needs engine/dist)',
    async () => {
      const failures: string[] = [];
      for (const program of programs) {
        try {
          await assembleConformance(program);
        } catch (error) {
          failures.push(String(error instanceof Error ? error.message : error).slice(0, 300));
        }
      }
      expect(failures).toEqual([]);
    },
    300_000,
  );

  it.skipIf(!enginesBuilt)(
    'the Windows confirmation programs assemble without errors (needs engine/dist)',
    async () => {
      const folder = join(SIM_CONFORMANCE_DIR, '..', 'windows-confirm');
      const failures: string[] = [];
      const asm = await createAsmEngine();
      for (const name of readdirSync(folder).filter((f) => /\.x68$/i.test(f))) {
        const files = new Map<string, Uint8Array>([
          [`windows-confirm/${name}`, new Uint8Array(readFileSync(join(folder, name)))],
          ['sim/dumplib.X68', new Uint8Array(readFileSync(join(SIM_CONFORMANCE_DIR, 'dumplib.X68')))],
        ]);
        const result = await asm.assemble(`windows-confirm/${name}`, files, TEST_ASM_OPTIONS, TEST_ASM_TIME);
        if (result.fatal !== null || result.errorCount > 0) {
          failures.push(
            `${name}: ${result.fatal ?? result.messages.map((m) => `line ${m.line}: ${m.text}`).join('; ')}`,
          );
        }
      }
      expect(failures).toEqual([]);
    },
    120_000,
  );

  it.skipIf(!enginesBuilt)(
    'every report program reaches its halt in the port and completes result.bin (needs engine/dist)',
    async () => {
      const failures: string[] = [];
      for (const program of programs.filter((p) => p.recipes.some((r) => r.kind === 'report'))) {
        const outcome = await runScenario({
          program: await assembleConformance(program),
          exceptions: program.switches.some((s) => s.toLowerCase() === '/e'),
          bitField: program.switches.some((s) => s.toLowerCase() === '/b'),
          timeLimitMs: 30_000,
        });
        const result = outcome.files['result.bin'];
        const text = result ? String.fromCharCode(...result) : '';
        if (!text.endsWith('END-OF-DUMP\r\n')) {
          failures.push(
            `${program.id}: run ended ${outcome.end}; messages ${JSON.stringify(outcome.messages.slice(-2))}`,
          );
        }
      }
      expect(failures).toEqual([]);
    },
    600_000,
  );
});
