#!/usr/bin/env node
// Release candidate (ARCHITECTURE.md 9.6, package I3), evidence for 6.9 item 10 "Stability of the
// tests": the end-to-end suites pass 20 times in a row (--repeat-each=20) on ubuntu-latest in each
// browser with no failure.
//
// It reads the logs of the e2e-stability jobs of ci.yml (one per browser, or one per shard since
// the job was split into shards), as `gh api repos/<owner>/<repo>/actions/jobs/<id>/logs` prints
// them, and prints for each browser: the repetitions, the tests Playwright ran, passed, failed,
// flaky and skipped, every failure by name, and whether the logs together cover every shard.
// With --current it also lists the tests of this checkout per browser and folder
// (`playwright test --list`, which starts no browser and no server) and says whether the logs ran
// exactly that many tests 20 times, so that a run made before a suite existed (tests/e2e/sim, for
// example) is not taken for one that includes it.
//
// Run from the repository root:
//   node tests/integration/rc/item-10-stability.mjs [--current] <job log> [<job log> ...]
// Exit code 0 only when every log is of an Ubuntu runner (its "Image:" line, as
// item-09-perf-verdict.mjs --require-ubuntu reads it), every browser has 20 repetitions, every
// shard, no failed or flaky test and (with --current) the count of this checkout; 1 otherwise.
// Skipped tests (a test that runs in Chromium only, for example) are not failures; they are counted
// and printed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const current = argv.includes('--current');
const files = argv.filter((a) => a !== '--current');
if (files.length === 0) {
  console.error('usage: node tests/integration/rc/item-10-stability.mjs [--current] <job log> ...');
  process.exit(2);
}

const ESC = String.fromCharCode(27);
const COLOUR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const clean = (line) => line.replace(/^\S*?\d{4}-\d\d-\d\dT[\d:.]+Z /, '').replace(COLOUR, '');

/** One job log: the command, the totals and the failures. */
function readLog(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map(clean);
  const command = lines.find((l) => /^> playwright test .*--repeat-each=/.test(l)) ?? '';
  const browser = /--project[ =](\w+)/.exec(command)?.[1] ?? '?';
  const repeat = Number(/--repeat-each=(\d+)/.exec(command)?.[1] ?? 0);
  const shard = /--shard=(\d+)\/(\d+)/.exec(command);
  const running = lines.find((l) => /^Running \d+ tests? using/.test(l)) ?? '';
  const count = (word) => {
    const line = lines.find((l) => new RegExp(`^\\s+\\d+ ${word}\\b`).test(l));
    return line ? Number(line.trim().split(' ')[0]) : 0;
  };
  const failures = [
    ...new Set(lines.filter((l) => /^\s+\d+\) \[\w+\] › /.test(l)).map((l) => l.replace(/^\s+\d+\) /, '').trim())),
  ];
  const failureLines = lines.filter((l) => /^\s+\d+\) \[\w+\] › /.test(l)).length;
  // The runner, from the job's set-up lines ("Image: ubuntu-26.04"), as item-09-perf-verdict.mjs
  // reads it: item 10 asks for ubuntu-latest.
  const image = /^\s*Image: (\S+)/.exec(lines.find((l) => /^\s*Image: /.test(l)) ?? '')?.[1] ?? null;
  const flakyNames = [];
  const flakyAt = lines.findIndex((l) => /^\s+\d+ flaky\b/.test(l));
  if (flakyAt >= 0) for (const l of lines.slice(flakyAt + 1)) if (/^\s+\[\w+\] › /.test(l)) flakyNames.push(l.trim());
  return {
    file,
    command,
    image,
    browser,
    repeat,
    shard: shard ? { index: Number(shard[1]), total: Number(shard[2]) } : null,
    tests: Number(/^Running (\d+)/.exec(running)?.[1] ?? 0),
    passed: count('passed'),
    failed: count('failed'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    interrupted: count('interrupted'),
    didNotRun: count('did not run'),
    failures,
    failureLines,
    flakyNames,
    duration: lines.find((l) => /^\s+\d+ passed \(/.test(l))?.match(/\(([^)]+)\)/)?.[1] ?? '?',
  };
}

/** Tests of this checkout per browser and per folder of tests/e2e, from `playwright test --list`. */
function currentTests(browser) {
  const out = execFileSync(
    process.execPath,
    [
      join(repo, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      '--config',
      'tests/playwright.config.ts',
      '--list',
      '--project',
      browser,
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, E2E_SKIP_BUILD: '1', E2E_DIST: process.env.E2E_DIST ?? 'app/dist' },
      maxBuffer: 64 << 20,
    },
  );
  const folders = {};
  for (const line of out.split(/\r?\n/)) {
    const match = /›\s+(?:tests[\\/])?(e2e|a11y)[\\/](\w+)[\\/]/.exec(line);
    if (match) folders[`${match[1]}/${match[2]}`] = (folders[`${match[1]}/${match[2]}`] ?? 0) + 1;
  }
  return { total: Number(/Total: (\d+) tests?/.exec(out)?.[1] ?? 0), folders };
}

const logs = files.map(readLog);
const problems = [];
console.log('6.9 item 10 (stability): e2e suites 20 times in a row on ubuntu-latest, per browser');
for (const log of logs) {
  console.log(
    `- ${log.file}\n    runner: ${log.image ?? 'not a GitHub log (no "Image:" line)'}\n    ${log.command || 'NO playwright command with --repeat-each found'}\n    browser ${log.browser}, repeat-each ${log.repeat}${log.shard ? `, shard ${log.shard.index}/${log.shard.total}` : ''}: ` +
      `${log.tests} tests run (${log.repeat ? log.tests / log.repeat : '?'} per repetition); passed ${log.passed}, failed ${log.failed}, flaky ${log.flaky}, skipped ${log.skipped}` +
      `${log.interrupted ? `, interrupted ${log.interrupted}` : ''}${log.didNotRun ? `, did not run ${log.didNotRun}` : ''} (${log.duration})`,
  );
  for (const failure of log.failures) console.log(`    FAILED: ${failure}`);
  if (log.failureLines > log.failures.length)
    console.log(`    (${log.failureLines} failing results of ${log.failures.length} distinct test(s))`);
  for (const flaky of log.flakyNames) console.log(`    FLAKY: ${flaky}`);
}

for (const log of logs)
  if (!log.image || !/^ubuntu/i.test(log.image))
    problems.push(
      `${log.file}: ${log.image ? `runner image ${log.image}` : 'no "Image:" line'}, not an Ubuntu runner (item 10 asks for ubuntu-latest)`,
    );

const browsers = [...new Set(logs.map((l) => l.browser))].sort();
for (const wanted of ['chromium', 'webkit'])
  if (!browsers.includes(wanted)) problems.push(`no log of the ${wanted} stability job`);
for (const browser of browsers) {
  const own = logs.filter((l) => l.browser === browser);
  const total = own.reduce((sum, l) => sum + l.tests, 0);
  const sum = (key) => own.reduce((s, l) => s + l[key], 0);
  const shardTotal = own[0]?.shard?.total ?? 1;
  const shardSet = new Set(own.map((l) => l.shard?.index ?? 1));
  const complete = shardSet.size === shardTotal && own.every((l) => (l.shard?.total ?? 1) === shardTotal);
  const repeats = [...new Set(own.map((l) => l.repeat))];
  console.log(
    `${browser}: ${own.length} log(s), shards ${[...shardSet].sort().join(',')} of ${shardTotal}${complete ? '' : ' (INCOMPLETE)'}; repeat-each ${repeats.join('/')}; ` +
      `${total} tests run = ${repeats[0] ? total / repeats[0] : '?'} tests x ${repeats.join('/')}; passed ${sum('passed')}, failed ${sum('failed')}, flaky ${sum('flaky')}, skipped ${sum('skipped')}`,
  );
  if (!complete)
    problems.push(`${browser}: the logs do not cover every shard (${[...shardSet].join(',')} of ${shardTotal})`);
  if (repeats.length !== 1 || repeats[0] !== 20)
    problems.push(`${browser}: repeat-each is ${repeats.join('/')}, not 20`);
  if (sum('failed') > 0) problems.push(`${browser}: ${sum('failed')} failed`);
  if (sum('flaky') > 0) problems.push(`${browser}: ${sum('flaky')} flaky`);
  if (sum('interrupted') + sum('didNotRun') > 0)
    problems.push(`${browser}: ${sum('interrupted')} interrupted, ${sum('didNotRun')} did not run`);
  if (sum('passed') + sum('skipped') + sum('failed') + sum('flaky') !== total)
    problems.push(
      `${browser}: the counts (${sum('passed')}+${sum('skipped')}+${sum('failed')}+${sum('flaky')}) do not add up to ${total}`,
    );
  if (current) {
    const here = currentTests(browser);
    const perRepetition = repeats[0] ? total / repeats[0] : 0;
    console.log(
      `  this checkout lists ${here.total} ${browser} tests: ${JSON.stringify(here.folders)}; the logs ran ${perRepetition} per repetition`,
    );
    if (perRepetition !== here.total)
      problems.push(
        `${browser}: the logs ran ${perRepetition} tests per repetition, this checkout has ${here.total} (${JSON.stringify(here.folders)}): they are of another version of the suites`,
      );
  }
}
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
