// Unit tests of the conformance harness and its doubles (harness.ts, doubles.ts). The harness tests
// run the real engines and skip without engine/dist (and fail with EASY68K_REQUIRE_ENGINES=1).
// Owner: T3.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FileMode } from '../../../app/src/contracts';
import { ConformanceFiles, ConformanceLog, fileKey } from './doubles';
import { assembleConformance, createWineGlyphs, runScenario } from './harness';
import { maskArtifact, parseHeader, type ConformanceProgram } from './programs';

const dist = (file: string) => fileURLToPath(new URL(`../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (data: Uint8Array | null) => (data ? String.fromCharCode(...data) : null);

describe('ConformanceFiles', () => {
  it('opens, reads, writes, seeks and closes like C streams over a flat folder', () => {
    const files = new ConformanceFiles({
      'Data.TXT': { data: bytes('hello') },
      'ro.bin': { data: bytes('x'), readOnly: true },
    });
    expect(fileKey('sub\\data.txt')).toBe('DATA.TXT');
    expect(files.fileOpen(bytes('missing'), FileMode.Read)).toBe(0);
    expect(files.fileOpen(bytes('ro.bin'), FileMode.Update)).toBe(0); // r+b fails on a read-only file
    const ro = files.fileOpen(bytes('RO.BIN'), FileMode.Read);
    expect(ro).toBeGreaterThan(0);
    expect(files.fileWrite(ro, bytes('y'))).toBe(-1);
    const h = files.fileOpen(bytes('c:\\x\\data.txt'), FileMode.Update);
    expect(text(files.fileRead(h, 3))).toBe('hel');
    expect(text(files.fileRead(h, 10))).toBe('lo'); // short read
    expect(text(files.fileRead(h, 10))).toBe(''); // empty at the end
    expect(files.fileSeek(h, 7, 0)).toBe(7);
    expect(files.fileWrite(h, bytes('!'))).toBe(1);
    expect(text(files.fileBytes('DATA.txt'))).toBe('hello\0\0!');
    expect(files.fileSeek(h, -9, 2)).toBe(-1);
    expect(files.fileRemove(bytes('data.txt'))).toBe(false); // open
    expect(files.fileClose(h)).toBe(true);
    expect(files.fileClose(h)).toBe(false);
    expect(files.fileRemove(bytes('data.txt'))).toBe(true);
    const c = files.fileOpen(bytes('new.bin'), FileMode.Create);
    expect(files.fileWrite(c, bytes('ab'))).toBe(2);
    expect(Object.keys(files.allFiles()).sort()).toEqual(['new.bin', 'ro.bin']);
  });

  it('answers the task 58 dialog with the scenario answers, then Cancel', () => {
    const posted: unknown[] = [];
    const files = new ConformanceFiles({}, [{ accepted: true, path: 'pick.txt' }], (request) => posted.push(request));
    files.fileDialog(0, bytes('t'), bytes('f'), bytes(''));
    files.fileDialog(0, bytes('t'), bytes('f'), bytes(''));
    expect(posted).toEqual([
      { kind: 'fileDialogReply', accepted: true, path: bytes('pick.txt') },
      { kind: 'fileDialogReply', accepted: false, path: null },
    ]);
  });
});

describe('ConformanceLog', () => {
  it('keeps the execution log and, while an output log is on, the output bytes', async () => {
    const calls: string[] = [];
    const log = new ConformanceLog({ invoke: () => calls.push('invoke') }, () => 'DATE');
    log.setTypes(2, 1);
    log.outputWrite(bytes('early')); // not logging yet
    expect(await log.start()).toBe(true);
    log.logState(true);
    log.logWrite(bytes('EASy68K execution log file: DATE\r\n'));
    log.outputWrite(bytes('AB\n'));
    expect(calls).toEqual(['invoke']);
    expect(text(Uint8Array.from(log.outputBytes))).toBe('EASy68K output log file: DATE\r\n\r\nAB\n');
    expect(maskArtifact('outlog', Uint8Array.from(log.outputBytes))).toBe(
      'EASy68K output log file: <date>\r\n\r\nAB\n',
    );
    log.logState(false);
    log.outputWrite(bytes('late'));
    expect(log.outputBytes.length).toBe(36);
  });
});

describe('Wine glyphs', () => {
  it('give Fixedsys an 11 x 14 cell and remember fonts they do not know', () => {
    const glyphs = createWineGlyphs();
    const font = { name: 'Fixedsys', size: 9, bold: false, italic: false, underline: false, strikeOut: false };
    expect(glyphs.metrics(font)).toEqual({ colWidth: 11, rowHeight: 14 });
    expect(glyphs.metrics({ ...font, name: 'Courier New', size: 10 })).toEqual({ colWidth: 12, rowHeight: 15 });
    expect(glyphs.glyph(font, 65).advance).toBe(11);
    glyphs.metrics({ ...font, name: 'Consolas', size: 12 });
    expect([...glyphs.unknown]).toEqual(['Consolas 12']);
  });
});

/** A program of the suite's form, written here (it is assembled from its folder name). */
function inline(id: string): ConformanceProgram {
  const [suite, name] = id.split('/') as ['trap15-a', string];
  return parseHeader('* @item harness test\n', suite, name, `${suite}/${name}.X68`);
}

describe.skipIf(!enginesBuilt)('runScenario (needs engine/dist)', () => {
  it('runs a report program to its halt; result.bin, text grid and registers come back', async () => {
    const program = await assembleConformance(inline('trap15-a/a00-grid-default-font'));
    const outcome = await runScenario({ program });
    expect(outcome.end).toBe('halted');
    expect(outcome.grid).toEqual({ cols: 58, rows: 34 });
    const result = text(outcome.files['result.bin'] ?? null) ?? '';
    expect(result.endsWith('END-OF-DUMP\r\n')).toBe(true);
    expect(outcome.reports).toEqual([]);
    const windows = await runScenario({ program, metrics: 'windows' });
    expect(windows.grid).toEqual({ cols: 80, rows: 32 });
  }, 120_000);

  it('produces an execution log with Auto Trace and an output log with Run', async () => {
    const program = await assembleConformance(inline('logs/l01-arith'));
    const log = await runScenario({ program, recipe: { kind: 'log', execType: 2, withOutput: false } });
    expect(log.end).toBe('halted');
    const runLog = text(log.execLog) ?? '';
    expect(runLog.startsWith('EASy68K execution log file: ')).toBe(true);
    expect(runLog).toContain('PC=00001000');
    expect(log.alerts).toContain('Information: Current Log Stopped.');
    const printing = await assembleConformance(inline('trap15-a/a13-text-tasks'));
    const out = await runScenario({ program: printing, recipe: { kind: 'outlog' } });
    expect(text(out.outputLog)?.startsWith('EASy68K output log file: ')).toBe(true);
  }, 120_000);
});
