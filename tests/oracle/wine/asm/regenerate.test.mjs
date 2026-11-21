// Tests of the parts of regenerate.mjs that need no Docker: the plan, the step from a result of the
// container to a manifest entry, and the report.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalHashes } from '../../../conformance/asm/compare.ts';
import { loadManifest, sha256Hex } from '../../../corpus/index.ts';
import {
  LARGE_SOURCE_BYTES,
  REPORT_PATH,
  ingestRun,
  looksInteractive,
  planPrograms,
  renderReport,
  runDifferences,
} from './regenerate.mjs';

const bytes = (text) => Uint8Array.from(Buffer.from(text, 'latin1'));
const scratch = mkdtempSync(join(tmpdir(), 'easy68k-regenerate-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('planPrograms', () => {
  const programs = planPrograms(['official', 'github-mit', 'conformance']);
  const ids = programs.map((program) => program.id);

  it('finds the tracked sets of 6.3 and the conformance programs', () => {
    expect(ids.filter((id) => id.startsWith('official/'))).toHaveLength(10);
    expect(ids.filter((id) => id.startsWith('github/pacman-mc68000/'))).toHaveLength(24);
    expect(ids.filter((id) => id.startsWith('github/68k-assembly-learning/'))).toHaveLength(18);
    expect(ids.filter((id) => id.startsWith('checklist/')).length).toBeGreaterThanOrEqual(98);
    expect(ids.filter((id) => id.startsWith('richedit/'))).toHaveLength(24);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assembles every example with the shipped and the expansion options', () => {
    for (const program of programs.filter((candidate) => candidate.set !== 'conformance')) {
      expect(
        program.runs.map((run) => run.label),
        program.id,
      ).toEqual(['default', 'expand']);
    }
    const tutorial = programs.find((program) => program.id === 'official/tutorial1.X68');
    expect(tutorial).toMatchObject({
      set: 'official',
      file: 'tutorial1.X68',
      root: '',
      available: true,
      licence: 'GPL (EASy68K distribution)',
    });
    expect(tutorial.runs[1].options).toEqual({
      macrosExpanded: true,
      structuredExpanded: true,
      constantsExpanded: true,
    });
  });

  it('gives a conformance program the option sets of programs.json, each with its own label', () => {
    const matrix = programs.find((program) => program.id.startsWith('checklist/output-08-'));
    const labels = matrix.runs.map((run) => run.label);
    expect(labels).toHaveLength(66);
    expect(new Set(labels).size).toBe(66);
    expect(labels).toContain('default');
    expect(labels).toContain('nolist');
    expect(matrix.root).toBe(matrix.file.replace(/\/prog\.X68$/, ''));
  });

  it('gives a program of a GitHub repository the repository as its root and names the commit', () => {
    const main = programs.find((program) => program.id === 'github/pacman-mc68000/GAME/MAIN.X68');
    expect(main).toMatchObject({ file: 'pacman-mc68000/GAME/MAIN.X68', root: 'pacman-mc68000', licence: 'MIT' });
    expect(main.origin).toMatch(/^https:\/\/github\.com\/.+ at [0-9a-f]{40}$/);
    expect(main.flags).toContain('needs-include');
    const gfx = programs.find((program) => program.id === 'github/pacman-mc68000/GAME/GFX.X68');
    expect(gfx.bytes).toBeGreaterThan(LARGE_SOURCE_BYTES);
  });
});

describe('looksInteractive', () => {
  it('sees an input task loaded into D0 as a number', () => {
    expect(looksInteractive(bytes('    MOVE.B  #5,D0\r\n    TRAP #15\r\n'))).toBe(true);
    expect(looksInteractive(bytes('\tmoveq\t#4,d0\r\n'))).toBe(true);
    expect(looksInteractive(bytes('  MOVE.W #$13,D0   key state\r\n'))).toBe(true);
    expect(looksInteractive(bytes('  move.l #61,d0\r\n'))).toBe(true);
  });

  it('does not take output tasks, other registers or comments for input', () => {
    expect(looksInteractive(bytes('    MOVE.B  #14,D0\r\n    MOVE.B #5,D1\r\n'))).toBe(false);
    expect(looksInteractive(bytes('* MOVE.B #5,D0 would read a character\r\n'))).toBe(false);
    expect(looksInteractive(bytes('    MOVE.B  #50,D0\r\n'))).toBe(false);
  });
});

describe('ingestRun', () => {
  const source = bytes(
    '    ORG $1000\r\nSTART NOP\r\n    END START\r\n\r\n*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~\r\n',
  );
  const modelText = bytes('    ORG $1000\r\nSTART NOP\r\n    END START\r\n\r\n');
  const listing = bytes(
    '00001000 Starting Address\r\nAssembler used: EASy68K Editor/Assembler v5.16.01\r\nCreated On: 11/20/2026 9:20:04 PM\r\n\r\n' +
      '00001000  4E71                       2  START NOP\r\n\r\nNo errors detected\r\nNo warnings generated\r\n',
  );
  const sRecord = bytes('S10510004E71DB\r\nS804001000EB\r\n');

  function outputs(name, received) {
    const directory = join(scratch, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'prog.L68'), listing);
    writeFileSync(join(directory, 'prog.S68'), sRecord);
    writeFileSync(join(directory, 'prog.received.txt'), received);
    return directory;
  }

  it('records hashes, counts and the captured text of a successful run', () => {
    const record = { status: 'ok', exit: 'clean', stray_windows: [], outDirectory: outputs('ok', modelText) };
    const { run, files } = ingestRun({ options: {}, record, source });
    expect(run).toEqual({
      options: {},
      status: 'ok',
      received: sha256Hex(modelText),
      errors: 0,
      warnings: 0,
      ...(({ l68, s68 }) => ({ l68, s68 }))(canonicalHashes({ listing, sRecord })),
      golden: false,
    });
    expect(files.listing).toEqual(listing);
    expect(files.sRecord).toEqual(sRecord);
    expect(files.received).toBeNull(); // equal to the model: not kept
  });

  it('keeps the captured text when it is not what the editor model gives', () => {
    const received = bytes('    ORG $1000\r\n'); // as if the editor had cut the text
    const record = { status: 'ok', exit: 'clean', stray_windows: [], outDirectory: outputs('cut', received) };
    const { run, files } = ingestRun({ options: {}, record, source });
    expect(run.receivedFile).toBe(true);
    expect(run.received).toBe(sha256Hex(received));
    expect(files.received).toEqual(received);
  });

  it('notes what the driver saw besides the expected windows', () => {
    const record = {
      status: 'ok',
      exit: 'killed (did not exit after Alt+F4)',
      warning: 'status dialog names another file: Assembler Status - MOUSE.X68',
      stray_windows: [{ title: 'EASy68K' }],
      outDirectory: outputs('notes', modelText),
    };
    expect(ingestRun({ options: {}, record, source }).run.notes).toEqual([
      'status dialog names another file: Assembler Status - MOUSE.X68',
      'unexpected window "EASy68K" was dismissed',
      'the editor was killed (did not exit after Alt+F4)',
    ]);
  });

  it('records a failed run with the reason and no hashes', () => {
    const record = {
      status: 'fail',
      error: 'EDIT68K exited unexpectedly (crash?) exit code 1',
      outDirectory: join(scratch, 'none'),
    };
    expect(ingestRun({ options: { macrosExpanded: true }, record, source }).run).toEqual({
      options: { macrosExpanded: true },
      status: 'failed',
      reason: 'EDIT68K exited unexpectedly (crash?) exit code 1',
      errors: null,
      warnings: null,
      l68: null,
      s68: null,
      golden: false,
    });
    expect(ingestRun({ options: {}, record: undefined, source }).run.reason).toMatch(/no result/);
  });
});

describe('runDifferences', () => {
  const run = { status: 'ok', received: 'r', errors: 0, warnings: 1, l68: 'a', s68: 'b', golden: true };

  it('is empty for the same result, whatever the golden flag and the notes say', () => {
    expect(runDifferences(run, { ...run, golden: false, notes: ['x'] })).toEqual([]);
  });

  it('names every field that changed', () => {
    expect(runDifferences(run, { ...run, errors: 2, l68: 'c' })).toEqual([
      'errors: manifest 0, now 2',
      'l68: manifest a, now c',
    ]);
    expect(runDifferences(run, { status: 'failed', errors: null, warnings: null, l68: null, s68: null })).toHaveLength(
      6,
    );
    expect(runDifferences(undefined, run)).toEqual(['not in the manifest']);
  });
});

describe('renderReport', () => {
  const manifest = {
    version: 1,
    oracle: { program: 'official EDIT68K.exe', wine: 'wine-8.0', generated: '2026-11-20' },
    programs: [
      {
        id: 'official/a.X68',
        set: 'official',
        runs: {
          default: { status: 'ok', golden: true },
          expand: { status: 'ok', golden: false, undefinedSymbols: true, notes: ['status dialog names another file'] },
        },
      },
      {
        id: 'checklist/macro-13-x',
        set: 'conformance',
        runs: { default: { status: 'failed', reason: 'EDIT68K exited unexpectedly' } },
      },
      {
        id: 'richedit/s12.X68',
        set: 'conformance',
        runs: { default: { status: 'ok', golden: true, receivedFile: true } },
      },
      { id: 'site/games/x/x.X68', set: 'site', runs: { default: { status: 'ok', golden: false } } },
    ],
  };
  const report = renderReport(manifest);

  it('counts programs and runs by set', () => {
    expect(report).toContain('| official | 1 | 2 | 1 | 1 | 0 |');
    expect(report).toContain('| conformance (checklist) | 1 | 1 | 0 | 0 | 1 |');
    expect(report).toContain('| conformance (richedit) | 1 | 1 | 1 | 0 | 0 |');
    expect(report).toContain('| site | 1 | 1 | 0 | 1 | 0 |');
  });

  it('names every run without a result with its reason, and the other special cases', () => {
    expect(report).toContain('- `checklist/macro-13-x` (default): EDIT68K exited unexpectedly');
    expect(report).toContain('- `richedit/s12.X68` (default)');
    expect(report).toContain('- `official/a.X68` (expand): status dialog names another file');
    // Hash only although tracked: the official run, not the site run.
    expect(report.split('## Outputs kept as hashes only')[1].split('##')[0]).toContain('`official/a.X68` (expand)');
    expect(report.split('## Outputs kept as hashes only')[1].split('##')[0]).not.toContain('site/');
    expect(report).toContain('Runs that report an undefined symbol: 1.');
  });

  it('is what tests/conformance/asm/golden/REPORT.md holds for the committed manifest', () => {
    expect(readFileSync(REPORT_PATH, 'utf8')).toBe(renderReport(loadManifest()));
  });
});
