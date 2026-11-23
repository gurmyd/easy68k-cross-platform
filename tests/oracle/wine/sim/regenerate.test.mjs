// Unit tests of the host side of the simulator oracle (regenerate.mjs). They start no container and
// need neither Docker nor the official programs. Owner: T3.

import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_MASKS, MASKED_TEXT, REPO_ROOT, parseHeader } from '../../../conformance/sim/programs.ts';
import {
  MAX_CONTAINERS,
  dealOrder,
  defaultTimeout,
  fileWorkDirectory,
  isGzipped,
  jobLine,
  manifestEntryChanges,
  parseArguments,
  planJobs,
  recipeResult,
  rehashManifest,
  renderReport,
  updatedDate,
} from './regenerate.mjs';

const program = (header, suite = 'trap15-a', name = 'x') => parseHeader(header, suite, name, `${suite}/${name}.X68`);
const bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe('planJobs', () => {
  it('makes one job per program and recipe, with the switches as sim68K.dat options', () => {
    const p = program('* @item a\n* @recipe report log:3+out\n* @switches /E\n* @files d.bin\n* @timeout 77\n');
    const jobs = planJobs([p]);
    expect(jobs.map((j) => j.id)).toEqual(['trap15-a/x:report', 'trap15-a/x:log:3+out']);
    expect(jobs[0]).toMatchObject({
      recipe: 'report',
      exceptions: 1,
      bitfield: 0,
      execLog: 0,
      outLog: 0,
      timeout: 77,
      files: ['d.bin'],
    });
    expect(jobs[1]).toMatchObject({
      recipe: 'log',
      execLog: 3,
      outLog: 1,
      switches: '/E',
      out: 'trap15-a__x__log_3_out',
    });
    expect(JSON.parse(jobLine(jobs[1]))).toEqual({
      id: 'trap15-a/x:log:3+out',
      recipe: 'log',
      source: 'trap15-a/x.X68',
      switches: '/E',
      exceptions: 1,
      bitfield: 0,
      execLog: 3,
      outLog: 1,
      timeout: 77,
      files: ['d.bin'],
      out: 'trap15-a__x__log_3_out',
    });
  });

  it('gives each recipe a default time limit', () => {
    expect(defaultTimeout({ kind: 'report' })).toBe(240);
    expect(defaultTimeout({ kind: 'outlog' })).toBe(240);
    expect(defaultTimeout({ kind: 'log', execType: 1, withOutput: false })).toBe(1800);
    expect(planJobs([program('* @item a\n* @recipe outlog\n')])[0]).toMatchObject({
      outLog: 1,
      execLog: 0,
      timeout: 240,
    });
  });
});

describe('dealOrder', () => {
  it('puts the programs with the longest time limit first and keeps the jobs of a program together', () => {
    const jobs = planJobs([
      program('* @item a\n', 'trap15-a', 'a'),
      program('* @item b\n* @recipe log:1 report\n', 'logs', 'b'),
      program('* @item c\n* @timeout 5000\n', 'trap15-b', 'c'),
    ]);
    expect(dealOrder(jobs).map((j) => j.id)).toEqual([
      'trap15-b/c:report',
      'logs/b:log:1',
      'logs/b:report',
      'trap15-a/a:report',
    ]);
  });
});

describe('recipeResult', () => {
  const p = program('* @item a\n* @recipe log:2+out\n', 'logs', 'prog');
  const recipe = p.recipes[0];

  it('hashes the masked artifacts and counts the logged instructions', () => {
    const files = {
      'prog_RunLog.txt': bytes(
        'EASy68K execution log file: 1/2/2026 3:04:05 AM\r\n\r\nx\r\nPC=00001000 a\r\nPC=00001002 b\r\n',
      ),
      'prog_OutLog.txt': bytes('EASy68K output log file: 1/2/2026 3:04:05 AM\r\n\r\nhi\n'),
    };
    const { entry, bytes: kept } = recipeResult(p, recipe, { status: 'ok', seconds: 3 }, (name) => files[name] ?? null);
    expect(entry.status).toBe('ok');
    expect(entry.instructions).toBe(2);
    // Nothing that depends on the machine enters the manifest (run 45034017858).
    expect(entry.seconds).toBeUndefined();
    expect(Object.keys(entry.artifacts)).toEqual(['runlog', 'outlog']);
    expect(Object.keys(kept)).toEqual(['runlog', 'outlog']);
    // The date does not enter the hash.
    const later = {
      ...files,
      'prog_RunLog.txt': bytes(String.fromCharCode(...files['prog_RunLog.txt']).replace('3:04:05 AM', '9:59:59 PM')),
    };
    const again = recipeResult(p, recipe, { status: 'ok' }, (name) => later[name] ?? null).entry;
    expect(again.artifacts.runlog.sha256).toBe(entry.artifacts.runlog.sha256);
  });

  it('fails a run whose files are missing, or that the driver reported as failed', () => {
    const none = recipeResult(p, recipe, { status: 'ok' }, () => null).entry;
    expect(none).toMatchObject({ status: 'failed', error: 'prog_RunLog.txt was not written', artifacts: {} });
    const failed = recipeResult(p, recipe, { status: 'failed', error: 'no box' }, () => bytes('x')).entry;
    expect(failed).toMatchObject({ status: 'failed', error: 'no box' });
    expect(recipeResult(p, recipe, undefined, () => null).entry.error).toMatch(/no record/);
  });
});

describe('what depends on the host stays out of the manifest (run 45034017858)', () => {
  it('hashes an artifact of ARTIFACT_MASKS without the bytes it names', () => {
    const a55 = program('* @item a55\n* @recipe outlog\n', 'trap15-a', 'a55-task0-negative-count-first');
    expect(ARTIFACT_MASKS['trap15-a/a55-task0-negative-count-first|outlog|outlog']).toBeDefined();
    const recipe = a55.recipes[0];
    const log = (third, fourth) =>
      bytes(`EASy68K output log file: x\r\n\r\n${'A'.repeat(255)}${third}\n${'A'.repeat(255)}${fourth}\n`);
    const name = 'a55-task0-negative-count-first_OutLog.txt';
    // Lines 3 and 4 as Docker Desktop's Wine wrote them, and as GitHub's did (run 45034017858).
    const here = recipeResult(a55, recipe, { status: 'ok' }, (n) => (n === name ? log('\xc0', '\xc0') : null));
    const github = recipeResult(a55, recipe, { status: 'ok' }, (n) => (n === name ? log('', '\xc0') : null));
    expect(github.entry.artifacts.outlog.sha256).toBe(here.entry.artifacts.outlog.sha256);
    expect(MASKED_TEXT).toBe('<masked>');
    // Any other program keeps every byte.
    const other = program('* @item o\n* @recipe outlog\n', 'trap15-a', 'other');
    const read = (third) => (n) => (n === 'other_OutLog.txt' ? log(third, '') : null);
    expect(recipeResult(other, recipe, { status: 'ok' }, read('')).entry.artifacts.outlog.sha256).not.toBe(
      recipeResult(other, recipe, { status: 'ok' }, read('\xc0')).entry.artifacts.outlog.sha256,
    );
  });

  it('moves the date of the manifest only when its content changes', () => {
    const before = { wine: 'w', updated: '2026-11-21', programs: { a: { s68Sha256: '1' } } };
    expect(updatedDate(before, { ...before, updated: '' }, '2026-11-22')).toBe('2026-11-21');
    expect(updatedDate(before, { ...before, updated: '', programs: { a: { s68Sha256: '2' } } }, '2026-11-22')).toBe(
      '2026-11-22',
    );
    expect(updatedDate(null, { ...before, updated: '' }, '2026-11-22')).toBe('2026-11-22');
  });
});

// Oracle run 45086336888 ran after midnight and changed 53 sizes by one byte: the logs' headers hold
// the date and time of the run (erratum T3 18). The entry of a run must not depend on them.
describe('the manifest entry does not depend on when the official program ran', () => {
  const p = program('* @item a\n* @recipe log:2+out\n', 'logs', 'prog');
  const recipe = p.recipes[0];
  const runLog = (when) => bytes(`EASy68K execution log file: ${when}\r\n\r\nx\r\nPC=00001000 a\r\n`);
  const outLog = (when, text = 'hi') => bytes(`EASy68K output log file: ${when}\r\n\r\n${text}\n`);
  const entryAt = (when, text) =>
    recipeResult(p, recipe, { status: 'ok' }, (name) =>
      name === 'prog_RunLog.txt' ? runLog(when) : name === 'prog_OutLog.txt' ? outLog(when, text) : null,
    ).entry;
  const COMMITTED = '11/22/2026 9:56:12 PM';

  it('is the same for a one-digit and a two-digit hour, another day and another month', () => {
    const times = [
      COMMITTED,
      '11/23/2026 12:05:47 AM', // run 45086336888: after midnight, a two-digit hour
      '1/1/2027 1:00:00 AM', // a one-digit month and day
      '12/31/2026 11:59:59 PM', // the end of a 31-day month
      '2/28/2027 10:30:00 AM', // the end of a 28-day month
    ];
    const entries = times.map((when) => entryAt(when));
    for (const entry of entries.slice(1)) expect(entry).toEqual(entries[0]);
    // The size is that of the masked file, not of the file.
    expect(entries[0].artifacts.outlog.bytes).toBe('EASy68K output log file: <date>\r\n\r\nhi\n'.length);
  });

  it('still changes with one byte of what the program wrote', () => {
    const committed = entryAt(COMMITTED);
    const changed = entryAt(COMMITTED, 'hI');
    expect(changed.artifacts.outlog.sha256).not.toBe(committed.artifacts.outlog.sha256);
    expect(manifestEntryChanges({ recipes: { r: committed } }, { recipes: { r: changed } })).toEqual([
      expect.stringMatching(/^recipes\.r\.artifacts\.outlog\.sha256: /),
    ]);
  });

  it('manifestEntryChanges lists every differing field, and nothing for equal entries', () => {
    const a = {
      sourceSha256: 'x',
      recipes: { report: { status: 'ok', artifacts: { result: { sha256: 'h', bytes: 3 } } } },
    };
    expect(manifestEntryChanges(a, structuredClone(a))).toEqual([]);
    const b = structuredClone(a);
    b.recipes.report.artifacts.result.bytes = 4;
    expect(manifestEntryChanges(a, b)).toEqual(['recipes.report.artifacts.result.bytes: 3 -> 4']);
    expect(manifestEntryChanges(undefined, a)).toEqual([expect.stringMatching(/^entry: none -> /)]);
  });

  it('--rehash recomputes hash and masked size from the stored goldens, and not the date', () => {
    const entry = entryAt(COMMITTED);
    const stored = { 'logs/prog.log2o.RunLog.txt': runLog(COMMITTED), 'logs/prog.log2o.OutLog.txt': outLog(COMMITTED) };
    const rawSize = stored['logs/prog.log2o.OutLog.txt'].length;
    const manifest = {
      updated: '2026-11-22',
      programs: {
        'logs/prog': {
          recipes: {
            'log:2+out': {
              ...entry,
              artifacts: { ...entry.artifacts, outlog: { ...entry.artifacts.outlog, bytes: rawSize } },
            },
          },
        },
      },
    };
    const result = rehashManifest(manifest, [p], (name) => stored[name] ?? null);
    expect(result.changed).toEqual([`logs/prog.log2o.OutLog.txt: bytes ${rawSize} -> ${entry.artifacts.outlog.bytes}`]);
    expect(result.unchanged).toBe(1);
    expect(manifest.programs['logs/prog'].recipes['log:2+out'].artifacts.outlog).toEqual(entry.artifacts.outlog);
    expect(manifest.updated).toBe('2026-11-22');
    expect(rehashManifest(manifest, [p], () => null).missing).toHaveLength(2);
  });
});

describe('renderReport', () => {
  it('counts runs, reports and logs and lists every run without a result', () => {
    const a = program('* @item a\n', 'trap15-a', 'a');
    const b = program('* @item b\n* @recipe log:1 report\n', 'logs', 'b');
    const manifest = {
      wine: 'wine-8.0',
      updated: '2026-01-01',
      programs: {
        'trap15-a/a': { recipes: { report: { status: 'ok', artifacts: {} } } },
        'logs/b': {
          recipes: {
            'log:1': { status: 'ok', instructions: 12, artifacts: {} },
            report: { status: 'failed', error: 'a|b' },
          },
        },
      },
    };
    const text = renderReport(manifest, [a, b]);
    expect(text).toContain('| Runs (program x recipe) | 3 |');
    expect(text).toContain('| Runs with an official result | 2 |');
    expect(text).toContain('| - self-reporting programs (result.bin) | 1 |');
    expect(text).toContain('| - execution logs | 1 (12 instructions) |');
    expect(text).toContain('| `logs/b` | report | a\\|b |');
  });
});

describe('parseArguments and goldens', () => {
  it('reads the options and caps the containers', () => {
    const o = parseArguments([
      '--only',
      'trap15',
      '--only',
      'logs',
      '--containers',
      '9',
      '--check',
      '--file',
      'p.X68',
      '--recipe',
      'log:2',
      '--switches',
      '/e',
    ]);
    expect(o.only).toEqual(['trap15', 'logs']);
    expect(o.containers).toBe(MAX_CONTAINERS);
    expect(o.check).toBe(true);
    expect(o.recipe).toBe('log:2');
    expect(o.switches).toBe('/e');
    expect(() => parseArguments(['--recipe', 'log:9'])).toThrow(/unknown recipe/);
    expect(() => parseArguments(['--bogus'])).toThrow(/unknown argument/);
    expect(() => parseArguments(['--containers', '0'])).toThrow(/containers/);
  });

  // Review of T3, round 2: a --file run with --out wrote its work folder below build/oracle-wine/sim.
  it('keeps the work folder of a --file run below --out when there is one', () => {
    const out = resolve('build', 'mine', 'probe');
    expect(fileWorkDirectory(out, '42-x')).toBe(join(out, '.work-42-x'));
    expect(fileWorkDirectory(null, '42-x')).toBe(join(REPO_ROOT, 'build', 'oracle-wine', 'sim', 'file-42-x'));
  });

  it('gzips execution logs only', () => {
    expect(isGzipped('logs/l01.log2.RunLog.txt')).toBe(true);
    expect(isGzipped('logs/l01.log2o.OutLog.txt')).toBe(false);
    expect(isGzipped('trap15-a/a01.result.bin')).toBe(false);
  });
});
