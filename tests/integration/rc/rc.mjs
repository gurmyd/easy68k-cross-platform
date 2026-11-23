#!/usr/bin/env node
// Release candidate (ARCHITECTURE.md 6.9 and 9.6, package I3): one entry point for the evidence of
// the twelve items of the definition of done. Owner: I3. See README.md in this folder for what
// proves each item and how to run each part alone.
//
//   npm run check:rc [-- --browsers --dist <production build>] [-- --logs <folder>] [-- --out <folder below build/>]
//
// It runs what a developer's machine can run in a few minutes, with Node and the pinned
// dependencies: first the comparisons that items 2 and 5 read (the sim project of
// test:conformance, and the files the unit entries of the parity matrix name; Vitest JSON reports
// in --out, by default build/I3/rc, emptied first), then every judge; and prints one line per item:
//
//   holds                      the local judge of the item exits 0;
//   does not hold              the local judge exits 1 (its own output says why);
//   shown only in CI           the item (or its other half) is shown by a CI run, named on the line
//                              with the command that judges that run's log;
//   open for a person          a part only a person can do (6.8, 6.9 items 5, 8 and 12).
//
// An item can carry several of these, for example "holds here; shown only in CI ...; open for a
// person ...". With --logs <folder>, the CI halves are judged from job logs in that folder, saved
// as <job id>.log (gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<id>/logs >
// <folder>/<id>.log), and the job lists of the runs as run-<run id>.json (gh api
// "repos/<owner>/<repo>/actions/runs/<id>/jobs?per_page=100" > <folder>/run-<id>.json), as far as
// the folder has them (node tests/integration/rc/fetch-ci.mjs <folder> writes both); the ids are
// those of RUNS and JOBS in lib/runs.mjs. A shard log that is missing leaves item 10 "not shown
// yet". With --browsers the two browser
// walks of items 7 and 12 run too (headless Chromium and WebKit, a static server on a free port;
// --dist <dir> takes an existing production build, otherwise each walk builds app/ itself into
// build/I3, which takes a minute or two more).
//
// Needs engine/dist (items 2, 3 and 5) and the reports of the last `npm run test:conformance` in
// build/reports (item 1; with the site set fetched by node tools/fetch-site-examples.mjs, or item 1
// says that the site set was not judged). Starts no browser without --browsers, no Docker, no
// network. (Not named check-*.mjs: it is no browser check of the CI table; tests/lint/ci-workflow.test.ts.)
// Exit code 0 only when no item is "does not hold"; it is 1 today, because item 2 does not
// hold (a51, a52), and with --logs item 6 neither (red jobs). The CI runs are those of commit
// b247e17 (lib/runs.mjs, docs/integration/rc.md); fetch-ci.mjs downloads their logs.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS, RUNS } from './lib/runs.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const here = 'tests/integration/rc';
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const logs = option('--logs');
const dist = option('--dist');
const browsers = args.includes('--browsers');
// The reports of the comparisons this script runs (items 2 and 5); below build/, git-ignored.
const out = resolve(repo, option('--out') ?? 'build/I3/rc');
if (!relative(join(repo, 'build'), out) || relative(join(repo, 'build'), out).startsWith('..')) {
  console.error(`--out must be a folder below build/ (it is emptied first): ${out}`);
  process.exit(2);
}

// The CI runs of the release-candidate check and the jobs each item reads: lib/runs.mjs.
const run = (key) => `${RUNS[key].workflow} run ${RUNS[key].id}`;
const nonEmpty = (f) => existsSync(f) && statSync(f).size > 0;
const logOf = (id) => (logs && nonEmpty(join(logs, `${id}.log`)) ? join(logs, `${id}.log`) : null);
/** The jobs of a run as `gh api repos/<owner>/<repo>/actions/runs/<id>/jobs?per_page=100` prints them, saved as run-<id>.json. */
const jobsOf = (key) =>
  logs && nonEmpty(join(logs, `run-${RUNS[key].id}.json`)) ? join(logs, `run-${RUNS[key].id}.json`) : null;

/** Runs a judge; returns its exit code (null on a time-out) and its last lines. */
function judge(label, command, commandArgs, { timeout = 600_000, env = {}, cwd = repo } = {}) {
  const started = Date.now();
  const r = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    timeout,
    shell: process.platform === 'win32' && command === 'npx',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd().split(/\r?\n/);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const code = r.status;
  console.log(`  [${label}] ${[command, ...commandArgs].join(' ')}: exit ${code ?? 'none (time-out)'} in ${seconds} s`);
  return {
    code,
    out,
    last: (pattern) =>
      [...out]
        .reverse()
        .find((l) => pattern.test(l))
        ?.trim() ?? '',
  };
}
const node = (label, script, extra = [], opts) => judge(label, process.execPath, [`${here}/${script}`, ...extra], opts);

const lines = [];
let notHolding = 0;
const item = (n, title, parts) => {
  if (parts.some((p) => p.includes('does not hold'))) notHolding += 1;
  lines.push(`item ${String(n).padStart(2)} ${title}: ${parts.join('; ')}`);
};
const verdict = (r, holds = 'holds', fails = 'does not hold') =>
  r.code === 0 ? holds : r.code === 1 ? fails : `not shown here (the judge exited ${r.code ?? 'on a time-out'})`;

console.log('Running the local judges (tests/integration/rc/README.md):');

// The comparisons the judges of items 2 and 5 read, as Vitest JSON reports in <out>: the sim
// project of npm run test:conformance (every conformance program run and compared with its golden;
// conformance.test.ts also writes what it compared and measured, EASY68K_SIM_REPORT_JSON), and the
// files that the unit entries of tests/parity/matrix.json name, each with the Vitest configuration
// of its folder (four workers).
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const SIM_CONFIG = 'tests/conformance/sim/vitest.config.ts';
const simReport = join(out, 'sim-report.json');
const simVitest = join(out, 'sim-vitest.json');
const vitestJson = (file) => ['--maxWorkers=4', '--reporter=default', '--reporter=json', `--outputFile.json=${file}`];
const sim = judge('2, 5', 'npx', ['vitest', 'run', '--config', SIM_CONFIG, ...vitestJson(simVitest)], {
  timeout: 900_000,
  env: { EASY68K_SIM_REPORT_JSON: simReport },
});
/** The nearest vitest.config.ts above a file or folder of the repository. */
function configOf(path) {
  for (let dir = statSync(join(repo, path)).isDirectory() ? path : posix.dirname(path); dir && dir !== '.';) {
    if (existsSync(join(repo, dir, 'vitest.config.ts'))) return `${dir}/vitest.config.ts`;
    const up = posix.dirname(dir);
    dir = up === dir ? '' : up;
  }
  return null;
}
const matrix = JSON.parse(readFileSync(join(repo, 'tests/parity/matrix.json'), 'utf8'));
const unitFiles = [
  ...new Set(matrix.rows.flatMap((row) => (row.verifiedBy ?? []).filter((e) => e.kind === 'unit').map((e) => e.file))),
].filter((file) => existsSync(join(repo, file)));
const byConfig = new Map();
for (const file of unitFiles) {
  const config = configOf(file);
  if (config === SIM_CONFIG || config === null) continue; // the sim run above covers it (or item 5 says it is absent)
  if (!byConfig.has(config)) byConfig.set(config, []);
  byConfig.get(config).push(file);
}
const unitReports = existsSync(simVitest) ? [simVitest] : [];
for (const [config, files] of byConfig) {
  const cwd = join(repo, dirname(config));
  const report = join(out, `unit-${dirname(config).replace(/[\\/]/g, '-')}.json`);
  const filters = files.map((f) => relative(cwd, join(repo, f)).replace(/\\/g, '/'));
  // The config by its full path: npx runs in the nearest folder with a package.json (for a file
  // under tests/ that is tests/, the workspace), not in `cwd`, so a bare `vitest.config.ts` named
  // tests/vitest.config.ts, which does not exist (integration pass of the stage of additions).
  judge('5', 'npx', ['vitest', 'run', '--config', join(repo, config), ...filters, ...vitestJson(report)], {
    timeout: 900_000,
    cwd,
  });
  if (existsSync(report)) unitReports.push(report);
}

// 1. Assembler
const i1 = node('1', 'item-01-asm-evidence.mjs');
item(1, 'assembler', [
  `${verdict(i1)} here (${i1.code === 2 ? 'no conformance report, or one older than the manifest, the list or engine/dist: run npm run test:conformance first' : i1.last(/item 1 /)})`,
  `the site set is judged only where it is fetched (this machine, and oracle.yml ${RUNS.oracle.id})`,
]);

// 2. Simulator
const i2a = node('2', 'item-02-sim-evidence.mjs', [
  ...(existsSync(simReport) ? ['--sim-report', simReport] : []),
  ...(existsSync(simVitest) ? ['--sim-vitest', simVitest] : []),
]);
const i2b = node('2', 'item-02-checklists.mjs');
item(2, 'simulator', [
  i2a.code === 0 && i2b.code === 0 ? 'holds' : i2a.code === 1 || i2b.code === 1 ? 'does not hold' : 'not shown here',
  `${i2a.last(/COUNTED AGAINST ITEM 2/) || i2a.last(/item 2 /)}; ${i2a.last(/byte-identical, as the comparison measured/) || 'the results NOT compared'}; checklists: ${i2b.last(/proof/)}`,
  `the comparison: the sim project of npm run test:conformance, run here (exit ${sim.code ?? 'none'}: ${sim.last(/^\s*Tests /) || 'no total'})`,
]);

// 3. Drawing
const i3 = judge('3', 'npx', ['vitest', 'run', '--config', `${here}/item-03-vitest.config.ts`, '--silent=false'], {
  timeout: 900_000,
});
item(3, 'drawing (6.5)', [
  `${verdict(i3)} here (${i3.last(/6\.5\.3 required/) || i3.last(/Tests /)})`,
  `the browser half (check:text, check:examples, check:surface) and the second Windows build's pens shown only in CI (${run('push')}, browser-checks and windows-oracles)`,
]);

// 4. Twins
const winOracles = logOf(JOBS.windowsOracles);
if (winOracles) {
  const i4 = node('4', 'item-04-twins.mjs', ['--report', winOracles]);
  item(4, 'twins', [`${verdict(i4)} on the windows-oracles log (${i4.last(/item 4 /)})`]);
} else
  item(4, 'twins', [
    `shown only in CI: ${run('push')}, job windows-oracles ${JOBS.windowsOracles}; judge its log with node ${here}/item-04-twins.mjs --report <log>`,
  ]);

// 5. Parity
const e2eArgs = Object.entries(JOBS.e2e).flatMap(([name, id]) => {
  const f = logOf(id);
  return f ? ['--web', `${name.split(' ')[1]}=${f}`] : [];
});
const deskArgs = [JOBS.desktopDev, JOBS.releaseArm64, JOBS.releaseX64].flatMap((id) =>
  logOf(id) ? ['--desktop', logOf(id)] : [],
);
const i5 = node('5', 'item-05-parity.mjs', [...e2eArgs, ...deskArgs, ...unitReports.flatMap((r) => ['--unit', r])]);
item(5, 'parity', [
  `${verdict(i5)} here (${i5.last(/^problems/)}; ${i5.last(/^unit entries passed/) || 'unit entries not judged'}${e2eArgs.length ? `; ${e2eArgs.length / 2} e2e logs judged` : ''})`,
  ...(e2eArgs.length ? [] : [`e2e and desktop results shown only in CI (${run('push')}, ${run('release')})`]),
  'open for a person: the 15 manual entries (8 items of 6.8) signed off in the release copy of docs/MANUAL-TEST-MAC.md',
]);

// 6. Platforms
const i6 = node('6', 'item-06-platforms.mjs');
const runArgs = [
  ['ci', 'push'],
  ['ci', 'manual'],
  ['release', 'release'],
  ['oracle', 'oracle'],
].flatMap(([workflow, key]) => (jobsOf(key) ? ['--run', `${workflow}=${jobsOf(key)}`] : []));
const macArgs = [
  ['arm64', JOBS.releaseArm64],
  ['x64', JOBS.releaseX64],
].flatMap(([arch, id]) => (logOf(id) ? ['--mac', `${arch}=${logOf(id)}`] : []));
const i6ci = runArgs.length || macArgs.length ? node('6', 'item-06-platforms.mjs', [...runArgs, ...macArgs]) : null;
item(6, 'platforms', [
  `the workflows against 7.4: ${verdict(i6)} here (${i6.last(/^problems/)})`,
  i6ci
    ? `the jobs of ${runArgs.length / 2} runs and ${macArgs.length / 2} packaged-app logs: ${verdict(i6ci)} (${i6ci.last(/^problems/)})`
    : `green matrix and packaged-app checks shown only in CI (${run('push')}, ${run('manual')}, ${run('oracle')}, ${run('release')}; node ${here}/item-06-platforms.mjs --run ci=<jobs json> --mac arm64=<log> --mac x64=<log>)`,
]);

// 7. Offline; 12. Manual (browser walks only with --browsers)
let i7 = null;
let i12a = null;
if (browsers) {
  const d = dist ? ['--dist', dist] : [];
  i7 = node('7', 'item-07-check-offline.mjs', ['--browser', 'all', ...d], { timeout: 900_000 });
  i12a = node('12', 'item-12-check-part-a.mjs', ['--browser', 'all', ...d], { timeout: 900_000 });
}
item(7, 'offline', [
  i7 ? `the offline walk: ${verdict(i7)} here (${i7.last(/checks passed/)})` : 'the offline walk not run (--browsers)',
  `offline.spec.ts and check:pwa shown only in CI (${run('push')})`,
  'open for a person: installing from a real Chrome; Safari offline and Add to Dock (manual B2, B13)',
]);

// 8. Accessibility
const a11yLogs = Object.values(JOBS.accessibility).flatMap((id) => (logOf(id) ? ['--log', logOf(id)] : []));
const e2eLogs = Object.values(JOBS.e2e).flatMap((id) => (logOf(id) ? ['--e2e-log', logOf(id)] : []));
const i8 = node('8', 'item-08-a11y-lists.mjs', [...a11yLogs, ...e2eLogs]);
const beyond = i8.last(/beyond the automated scan failed/);
item(8, 'accessibility', [
  `the lists${a11yLogs.length ? `, the axe scan of ${a11yLogs.length / 2} audit logs` : ''}${e2eLogs.length ? ` and a11y.spec.ts in ${e2eLogs.length / 2} e2e logs` : ''}: ${verdict(i8)} (${i8.last(/checks passed/)})`,
  ...(beyond ? [beyond.replace(/\.$/, '')] : []),
  ...(a11yLogs.length ? [] : [`the automated scan shown only in CI (${run('push')}, browser-checks accessibility)`]),
  'open for a person: the manual list (MANUAL-TEST-MAC.md B7 V1-V9, X4) signed off',
]);

// 9. Performance
const perfLog = logOf(JOBS.perfUbuntuChromium);
if (perfLog) {
  const i9 = node('9', 'item-09-perf-verdict.mjs', [perfLog, '--require-ubuntu']);
  item(9, 'performance', [
    `${verdict(i9)} on the log of ${run('manual')}, job perf (ubuntu-latest, chromium) ${JOBS.perfUbuntuChromium} (${i9.last(/verdicts? hold/)})`,
  ]);
} else
  item(9, 'performance', [
    `shown only in CI: ${run('manual')}, job perf (ubuntu-latest, chromium) ${JOBS.perfUbuntuChromium}; judge with node ${here}/item-09-perf-verdict.mjs <log> --require-ubuntu`,
  ]);

// 10. Stability
const shardLogs = JOBS.stability.map(logOf).filter(Boolean);
if (shardLogs.length) {
  const i10 = node('10', 'item-10-stability.mjs', ['--current', ...shardLogs]);
  // A shard log that is missing (the job had not finished) leaves the item not shown yet, unless a
  // shard that is there already has a failed or flaky test.
  const failedSome = i10.out.some((l) => /(failed|flaky) [1-9]/.test(l));
  item(10, 'stability', [
    `${shardLogs.length < JOBS.stability.length && !failedSome ? 'not shown yet' : verdict(i10)} on ${shardLogs.length} of the ${JOBS.stability.length} shard logs of ${run('manual')} (${i10.last(/^chromium:/)}; ${i10.last(/^webkit:/)}${i10.code ? `; ${i10.last(/^problems/)}` : ''})`,
  ]);
} else
  item(10, 'stability', [
    `shown only in CI: ${run('manual')}, the six e2e stability shards (${JOBS.stability.join(', ')}); judge with node ${here}/item-10-stability.mjs --current <six logs>`,
  ]);

// 11. Open verification items
const i11 = node('11', 'item-11-unverified.mjs');
item(11, 'open verification items', [
  `${verdict(i11)} here (${i11.last(/open and in NEITHER place/)})`,
  'the Windows session (docs/porting/windows-confirmation.md, decision O-2) would settle the listed items; it needs the owner',
]);

// 12. Manual
const i12 = node('12', 'item-12-manual-coverage.mjs');
item(12, 'manual', [
  `the manual against 6.8 and the application: ${verdict(i12)} (${i12.last(/checks passed/)})`,
  ...(i12a ? [`part A walked by a browser: ${verdict(i12a)} (${i12a.last(/checks passed/)})`] : []),
  'open for a person: docs/MANUAL-TEST-MAC.md completed on a real Mac for the release candidate; part B3 needs a downloadable build',
]);

console.log('\nThe twelve items of ARCHITECTURE.md 6.9 (docs/integration/rc.md):');
for (const l of lines) console.log(l);
console.log(
  `\n${notHolding === 0 ? 'No item' : `${notHolding} item${notHolding === 1 ? '' : 's'}`} found not to hold here; the parts shown only in CI and the parts open for a person are listed above.`,
);
process.exit(notHolding === 0 ? 0 : 1);
