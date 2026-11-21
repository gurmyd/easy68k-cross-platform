// Unit tests of the host side of the simulator oracle (regenerate.mjs). They start no container and
// need neither Docker nor the official programs. Owner: T3.

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../../conformance/sim/programs.ts';
import {
  MAX_CONTAINERS,
  dealOrder,
  defaultTimeout,
  isGzipped,
  jobLine,
  parseArguments,
  planJobs,
  recipeResult,
  renderReport,
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
    expect(entry.seconds).toBe(3);
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

  it('gzips execution logs only', () => {
    expect(isGzipped('logs/l01.log2.RunLog.txt')).toBe(true);
    expect(isGzipped('logs/l01.log2o.OutLog.txt')).toBe(false);
    expect(isGzipped('trap15-a/a01.result.bin')).toBe(false);
  });
});
