// Tests of the parts of regenerate.mjs that need no Docker: the plan, the step from a result of the
// container to a manifest entry, and the report.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalHashes } from '../../../conformance/asm/compare.ts';
import { goldenDirectory, loadManifest, sha256Hex } from '../../../corpus/index.ts';
import {
  LARGE_SOURCE_BYTES,
  REPORT_PATH,
  failureOf,
  ingestRun,
  looksInteractive,
  planPrograms,
  rehashManifest,
  renderReport,
  runDifferences,
  storeRun,
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

  it('notes what a clean run showed: a help-viewer box, another file in the status title, a kill', () => {
    const record = {
      status: 'ok',
      exit: 'killed (did not exit after Alt+F4)',
      warning: 'status dialog names another file: Assembler Status - MOUSE.X68',
      stray_windows: [],
      help_boxes: [
        { title: 'EASy68K', when: 'start' },
        { title: 'EASy68K', when: 'exit' },
      ],
      outDirectory: outputs('notes', modelText),
    };
    const { run } = ingestRun({ options: {}, record, source });
    expect(run.status).toBe('ok');
    expect(run.notes).toEqual([
      'status dialog names another file: Assembler Status - MOUSE.X68',
      'help-viewer message box dismissed at start-up',
      'help-viewer message box dismissed at exit',
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

  describe('a run with an unexpected window is a failed run (6.2.2)', () => {
    const failed = {
      status: 'fail',
      error: 'unexpected window "EASy68K" above the Assembler Status dialog',
      status_title: 'Assembler Status - prog.X68',
      stray_windows: [{ title: 'EASy68K', when: 'status' }],
    };

    it('whatever status the record carries: a driver that only dismissed the window does not pass', () => {
      // What the first version of asm_batch.py wrote for such a run.
      const dismissed = { status: 'ok', exit: 'clean', stray_windows: [{ title: 'Confirm' }] };
      expect(failureOf(dismissed)).toBe('unexpected window "Confirm" was dismissed by the driver');
      expect(failureOf({ status: 'ok', exit: 'clean', stray_windows: [] })).toBeNull();
      expect(
        failureOf({ status: 'ok', exit: 'clean', stray_windows: [], help_boxes: [{ title: 'EASy68K' }] }),
      ).toBeNull();
      expect(failureOf(failed)).toBe(failed.error);
      expect(failureOf(undefined)).toMatch(/no result/);
      const { run } = ingestRun({
        options: {},
        record: { ...dismissed, outDirectory: outputs('dismissed', modelText) },
        source,
      });
      expect(run.status).toBe('failed');
      expect(run.reason).toBe('unexpected window "Confirm" was dismissed by the driver');
    });

    it('keeps the outputs the editor had written when its status dialog was up', () => {
      const { run, files } = ingestRun({
        options: {},
        record: { ...failed, outDirectory: outputs('kept', modelText) },
        source,
      });
      expect(run).toEqual({
        options: {},
        status: 'failed',
        reason: failed.error,
        outputsKept: true,
        received: sha256Hex(modelText),
        errors: 0,
        warnings: 0,
        ...(({ l68, s68 }) => ({ l68, s68 }))(canonicalHashes({ listing, sRecord })),
        golden: false,
      });
      expect(files.listing).toEqual(listing);
      expect(files.sRecord).toEqual(sRecord);
    });

    it('keeps nothing when the editor had not finished assembling, or left empty files', () => {
      // No status dialog yet: whatever is in the files may be half written.
      const early = {
        ...failed,
        status_title: undefined,
        error: 'unexpected window "Error" while the editor assembled',
      };
      const { run, files } = ingestRun({
        options: {},
        record: { ...early, outDirectory: outputs('early', modelText) },
        source,
      });
      expect(run).toMatchObject({ status: 'failed', l68: null, s68: null, golden: false });
      expect(run.outputsKept).toBeUndefined();
      expect(files).toEqual({});
      // A crash during assembly leaves two empty files (official-oracle §3.2).
      const directory = join(scratch, 'empty');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'prog.L68'), '');
      writeFileSync(join(directory, 'prog.S68'), '');
      const crashed = ingestRun({ options: {}, record: { ...failed, outDirectory: directory }, source });
      expect(crashed.run.outputsKept).toBeUndefined();
      expect(crashed.run.l68).toBeNull();
    });
  });
});

describe('storeRun', () => {
  // A program of the `site` set: its outputs go to build/golden-local/ (git-ignored), never to the
  // repository, so the test can write real files.
  const program = { id: `site/_regenerate-test-${process.pid}/x.X68`, set: 'site' };
  const directory = goldenDirectory(program, false);
  afterAll(() => rmSync(dirname(directory), { recursive: true, force: true }));

  const listing = bytes(
    '00001000 Starting Address\r\nAssembler used: EASy68K Editor/Assembler v5.16.01\r\nCreated On: 11/20/2026 9:20:04 PM\r\n\r\n' +
      '00001000  4E71                       2  START NOP\r\n\r\nNo errors detected\r\nNo warnings generated\r\n',
  );
  const sRecord = bytes('S10510004E71DB\r\nS804001000EB\r\n');
  const names = () => (existsSync(directory) ? readdirSync(directory).sort() : []);

  it('stores the outputs of a clean run under the option label', () => {
    const run = { status: 'ok', golden: false };
    expect(storeRun(program, 'default', run, { listing, sRecord, received: null })).toBe(2);
    expect(run.golden).toBe(false); // a site program: hashes only
    expect(names()).toEqual(['default.L68', 'default.S68']);
    expect(new Uint8Array(readFileSync(join(directory, 'default.L68')))).toEqual(listing);
  });

  it('does not rewrite a file that changed only in its date line', () => {
    const later = bytes(Buffer.from(listing).toString('latin1').replace('9:20:04 PM', '10:01:59 AM'));
    expect(
      storeRun(program, 'default', { status: 'ok', golden: false }, { listing: later, sRecord, received: null }),
    ).toBe(0);
    expect(new Uint8Array(readFileSync(join(directory, 'default.L68')))).toEqual(listing);
  });

  it('stores what a failed run left as <label>.failed.*, and nothing for a failed run without outputs', () => {
    const kept = { status: 'failed', reason: 'unexpected window', outputsKept: true, golden: false };
    expect(storeRun(program, 'expand', kept, { listing, sRecord, received: bytes('text') })).toBe(3);
    expect(names()).toEqual([
      'default.L68',
      'default.S68',
      'expand.failed.L68',
      'expand.failed.S68',
      'expand.failed.received.txt',
    ]);
    expect(storeRun(program, 'nolist', { status: 'failed', reason: 'crash', golden: false }, {})).toBe(0);
    expect(names()).toHaveLength(5);
  });
});

describe('rehashManifest', () => {
  const listing = bytes(
    '00001000 Starting Address\r\nAssembler used: EASy68K Editor/Assembler v5.16.01\r\nCreated On: 11/20/2026 9:20:04 PM\r\n\r\n' +
      '00001000  4E71                       2  START NOP\r\n\r\nNo errors detected\r\nNo warnings generated\r\n',
  );
  const sRecord = bytes('S10510004E71DB\r\nS804001000EB\r\n');
  const current = canonicalHashes({ listing, sRecord });
  const run = (fields) => ({ options: {}, status: 'ok', errors: 0, warnings: 0, golden: true, ...fields });
  const manifest = () => ({
    version: 1,
    oracle: { program: '', wine: '', generated: '' },
    programs: [
      {
        id: 'official/a.X68',
        runs: {
          default: run({ l68: current.l68, s68: current.s68 }),
          expand: run({ l68: 'hash of an older canonical form', s68: current.s68 }),
          nolist: run({ l68: null, s68: 'older' }),
        },
      },
      {
        id: 'site/x/x.X68',
        runs: {
          default: run({ l68: 'older', s68: 'older', golden: false }),
          expand: {
            options: {},
            status: 'failed',
            reason: 'crash',
            errors: null,
            warnings: null,
            l68: null,
            s68: null,
          },
        },
      },
      {
        id: 'richedit/s03.X68',
        runs: {
          default: run({
            status: 'failed',
            reason: 'unexpected window',
            outputsKept: true,
            l68: 'older',
            s68: 'older',
          }),
        },
      },
    ],
  });

  it('recomputes the hashes of every run that has outputs, from the stored files', () => {
    const subject = manifest();
    const asked = [];
    const result = rehashManifest(subject, (program, label, entry, extension) => {
      asked.push(`${program.id} ${label} ${extension}`);
      return extension === 'L68' ? listing : sRecord;
    });
    expect(result).toEqual({
      unchanged: 1,
      changed: [
        'official/a.X68 (expand)',
        'official/a.X68 (nolist)',
        'site/x/x.X68 (default)',
        'richedit/s03.X68 (default)',
      ],
      missing: [],
    });
    const [official, site, kept] = subject.programs;
    expect(official.runs.expand).toMatchObject({ l68: current.l68, s68: current.s68 });
    // A file the run did not produce is not asked for and stays null.
    expect(official.runs.nolist).toMatchObject({ l68: null, s68: sha256Hex(sRecord) });
    expect(asked).not.toContain('official/a.X68 nolist L68');
    expect(site.runs.default).toMatchObject({ l68: current.l68, s68: current.s68, golden: false });
    expect(site.runs.expand.l68).toBeNull();
    expect(kept.runs.default).toMatchObject({ status: 'failed', outputsKept: true, l68: current.l68 });
  });

  it('leaves a run as it is when its outputs are not on this machine, and says so', () => {
    const subject = manifest();
    const result = rehashManifest(subject, (program) => (program.id.startsWith('site/') ? null : listing));
    expect(result.missing).toEqual(['site/x/x.X68 (default)']);
    expect(subject.programs[1].runs.default).toMatchObject({ l68: 'older', s68: 'older' });
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
      {
        id: 'richedit/s03.X68',
        set: 'conformance',
        runs: {
          default: {
            status: 'failed',
            reason: 'unexpected window "EASy68K" above the Assembler Status dialog',
            outputsKept: true,
            errors: 14,
            warnings: 1,
            golden: true,
          },
        },
      },
      { id: 'site/games/x/x.X68', set: 'site', runs: { default: { status: 'ok', golden: false } } },
    ],
  };
  const report = renderReport(manifest);
  const section = (title) => report.split(`## ${title}`)[1].split('##')[0];

  it('counts programs and runs by set; a failed run has no result even when its outputs are kept', () => {
    expect(report).toContain('| official | 1 | 2 | 1 | 1 | 0 |');
    expect(report).toContain('| conformance (checklist) | 1 | 1 | 0 | 0 | 1 |');
    expect(report).toContain('| conformance (richedit) | 2 | 2 | 1 | 0 | 1 |');
    expect(report).toContain('| site | 1 | 1 | 0 | 1 | 0 |');
  });

  it('names the failed runs whose outputs are kept, with what the outputs say', () => {
    expect(section('Runs without a result')).toContain(
      '- `richedit/s03.X68` (default): unexpected window "EASy68K" above the Assembler Status dialog',
    );
    expect(section('Outputs kept from a failed run')).toContain(
      '- `richedit/s03.X68` (default): 14 errors, 1 warning; in this folder',
    );
    expect(section('Outputs kept from a failed run')).not.toContain('macro-13');
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

describe('asm_batch.py, the driver inside the container', () => {
  // The rule which windows a run may show is Python, because it runs beside Wine. regenerate.mjs
  // runs this self-test inside the image before every run; here it runs where Python 3 is installed.
  const python = ['python3', 'python'].find((name) => {
    const result = spawnSync(name, ['--version'], { encoding: 'utf8' });
    return result.status === 0 && /^Python 3\./.test(`${result.stdout}${result.stderr}`);
  });
  const script = join(dirname(fileURLToPath(import.meta.url)), 'asm_batch.py');

  it.skipIf(!python)(
    'passes the self-test of its window rule (needs Python 3; skipped without it)',
    () => {
      // -B: no __pycache__ folder in the repository.
      const result = spawnSync(python, ['-B', script, '--self-test'], { encoding: 'utf8' });
      expect(`${result.stdout}${result.stderr}`).toMatch(/self-test: (\d+) of \1 cases passed/);
      expect(result.status).toBe(0);
    },
    60_000,
  );
});
