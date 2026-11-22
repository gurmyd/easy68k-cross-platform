#!/usr/bin/env node
// Release candidate (ARCHITECTURE.md 9.6, package I3), evidence for 6.9 item 6 "Platforms".
//
// Part 1, always: the workflows of .github/workflows against the table of ARCHITECTURE.md 7.4,
// line by line. For every job, system and browser 7.4 prescribes it checks that the workflow has
// it (trigger, job, runs-on, matrix); that every action is pinned by a commit hash; that the
// workflows ask for `contents: read` and only the jobs 7.4 and erratum T1 14 name ask for more.
//
// Part 2, given the jobs of finished runs: that every prescribed job of that workflow concluded
// "success" (a job 7.4 runs only on a manual run or a tag may be "skipped" on a push), and which
// jobs did not. A run's jobs are what
//   gh api "repos/<owner>/<repo>/actions/runs/<run id>/jobs?per_page=100"
// prints (JSON); give one file per run with --run <workflow>=<file>, workflow one of ci, release,
// pages, oracle.
//
// Part 3, given the logs of the release.yml mac jobs (gh api .../actions/jobs/<id>/logs): that
// each of the eight packaged-app checks of 6.7 passed on arm64 and on Intel, by the tests that
// carry it (the map CHECKS below, from tests/desktop/packaged), with the Playwright totals.
//
// Run from the repository root:
//   node tests/integration/rc/item-06-platforms.mjs
//   node tests/integration/rc/item-06-platforms.mjs --run ci=<jobs.json> --run release=<jobs.json> \
//     --mac arm64=<log of mac-arm64> --mac x64=<log of mac-x64>
// Exit code 0 when everything that was given holds, 1 otherwise; every problem is printed.
// Needs js-yaml, which the lockfile pins (a dependency of ESLint).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const yaml = createRequire(join(repo, 'package.json'))('js-yaml');
const workflow = (name) => yaml.load(readFileSync(join(repo, '.github', 'workflows', name), 'utf8'));

const args = { runs: [], mac: [] };
for (let i = 2; i < process.argv.length; i += 2) {
  const [flag, value] = [process.argv[i], process.argv[i + 1] ?? ''];
  const [name, file] = value.split(/=(.*)/s);
  if (!name || !file || (flag !== '--run' && flag !== '--mac')) {
    console.error(`usage: --run <workflow>=<jobs.json> | --mac <arm64|x64>=<log>; got ${flag} ${value}`);
    process.exit(2);
  }
  (flag === '--run' ? args.runs : args.mac).push({ name, file });
}

const problems = [];
const lines = [];
const ok = (text) => lines.push(`  ok    ${text}`);
const bad = (text) => {
  lines.push(`  MISS  ${text}`);
  problems.push(text);
};
const check = (condition, text) => (condition ? ok(text) : bad(text));
const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
const triggers = (wf) => Object.keys(wf.on ?? wf[true] ?? {}); // js-yaml reads `on:` as a key "on"

// ---------------------------------------------------------------------------------------------
// Part 1: the table of 7.4

const ci = workflow('ci.yml');
const release = workflow('release.yml');
const pages = workflow('pages.yml');
const oracle = workflow('oracle.yml');
const engines = workflow('engines.yml');

lines.push('ci.yml (7.4: push, pull request)');
check(
  ['push', 'pull_request'].every((t) => triggers(ci).includes(t)),
  `triggers ${triggers(ci).join(', ')} include push and pull_request`,
);
check(ci.jobs.engines?.uses === './.github/workflows/engines.yml', 'engines: the reusable engines.yml');
check(ci.jobs.check?.['runs-on'] === 'ubuntu-latest', 'check on ubuntu-latest');
const checkSteps = (ci.jobs.check?.steps ?? []).map((s) => s.run ?? '').join('\n');
check(
  ['npm run typecheck', 'npm run lint', 'npm run format:check'].every((c) => checkSteps.includes(c)),
  'check runs typecheck, lint, format check',
);
check(
  same(ci.jobs.unit?.strategy?.matrix?.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']),
  'unit on ubuntu, windows, macos',
);
check(
  (ci.jobs.unit?.steps ?? []).some((s) => s.run === 'npm test'),
  'unit runs npm test',
);
check(
  same(ci.jobs.conformance?.strategy?.matrix?.os, ['ubuntu-latest', 'macos-latest']),
  'conformance on ubuntu and macos',
);
check(
  (ci.jobs.conformance?.steps ?? []).some((s) => s.run === 'npm run test:conformance'),
  'conformance runs npm run test:conformance',
);
check(
  same(ci.jobs.e2e?.strategy?.matrix?.os, ['ubuntu-latest', 'macos-latest', 'windows-latest']) &&
    same(ci.jobs.e2e?.strategy?.matrix?.browser, ['chromium', 'webkit']),
  'e2e on ubuntu, macos, windows x chromium, webkit (6 jobs)',
);
const stability = ci.jobs['e2e-stability'];
// The browsers of the job: a plain matrix (browser: [...]) or one split into shards (include).
const stabilityMatrix = stability?.strategy?.matrix ?? {};
const stabilityBrowsers = [
  ...new Set([...(stabilityMatrix.browser ?? []), ...(stabilityMatrix.include ?? []).map((entry) => entry.browser)]),
];
const shards = (stabilityMatrix.include ?? []).filter((entry) => entry.shard !== undefined);
check(
  stability?.['runs-on'] === 'ubuntu-latest' && same(stabilityBrowsers, ['chromium', 'webkit']),
  `e2e-stability on ubuntu-latest x ${stabilityBrowsers.join(', ')}${shards.length ? ` (${shards.length} shard jobs: ${shards.map((s) => `${s.browser} ${s.shard}/${s.shards}`).join(', ')})` : ''}`,
);
if (shards.length) {
  for (const browser of stabilityBrowsers) {
    const own = shards.filter((s) => s.browser === browser);
    const count = own[0]?.shards;
    const complete =
      own.length === count && own.every((s) => s.shards === count) && new Set(own.map((s) => s.shard)).size === count;
    check(complete, `e2e-stability ${browser}: shards 1 to ${count} each once (together the whole suite)`);
  }
}
check(
  (stability?.steps ?? []).some((s) => /--repeat-each=20/.test(s.run ?? '')),
  `e2e-stability runs --repeat-each=20 (${(stability?.steps ?? []).map((s) => s.run ?? '').find((r) => /repeat-each/.test(r)) ?? 'no such step'})`,
);
const planText = JSON.stringify(ci.jobs.plan ?? {});
check(
  /workflow_dispatch:\*\)/.test(planText) && /push:refs\/tags\/v\*\) e2e_stability=true/.test(planText),
  'e2e-stability on a manual run and on a v* tag (plan step)',
);
const oracleSteps = (ci.jobs['windows-oracles']?.steps ?? []).map((s) => s.name ?? '');
check(ci.jobs['windows-oracles']?.['runs-on'] === 'windows-latest', 'windows-oracles on windows-latest');
for (const [what, pattern] of [
  ['GDI capture regenerate-and-compare', /GDI capture, regenerate and compare/],
  ['native twins', /Native twins/],
  ['command-line assembler oracle', /Command-line assembler oracle/],
  ['weekly Windows engine build compared with Linux (7.3)', /Build the engines on Windows and compare/],
]) {
  check(
    oracleSteps.some((name) => pattern.test(name)),
    `windows-oracles step: ${what}`,
  );
}
check(ci.jobs['desktop-dev']?.['runs-on'] === 'macos-15', 'desktop-dev on macos-15');
const extraCi = Object.keys(ci.jobs).filter(
  (id) =>
    !['engines', 'check', 'unit', 'conformance', 'e2e', 'e2e-stability', 'windows-oracles', 'desktop-dev'].includes(id),
);
lines.push(`  note  jobs beyond 7.4 in ci.yml: ${extraCi.join(', ')}`);

lines.push('pages.yml (7.4: push to main)');
check(same(pages.on?.push?.branches ?? pages[true]?.push?.branches, ['main']), 'push to main');
check(pages.jobs.engines?.uses === './.github/workflows/engines.yml', 'engines: the reusable engines.yml');
const pagesSteps = JSON.stringify(pages.jobs);
check(/upload-pages-artifact/.test(pagesSteps), 'uploads the Pages artifact');
check(/deploy-pages/.test(pagesSteps), 'deploys with actions/deploy-pages');

lines.push('oracle.yml (7.4: weekly, manual)');
check(
  triggers(oracle).includes('schedule') && triggers(oracle).includes('workflow_dispatch'),
  `triggers ${triggers(oracle).join(', ')}`,
);
const oracleText = JSON.stringify(oracle.jobs);
check(/oracle:wine:asm/.test(oracleText), 'regenerates the assembler goldens (oracle:wine:asm)');
check(/oracle:wine:sim/.test(oracleText), 'regenerates the simulator goldens (oracle:wine:sim)');
check(
  Boolean(oracle.jobs.propose) && /gh pr create/.test(oracleText),
  'opens a pull request when a golden changed (job propose)',
);
check(/site/.test(oracleText) && /manifest/.test(oracleText), 'fetches the site set and compares with the manifest');
check(Boolean(oracle.jobs.singlestep), 'single-step suites re-checked against the frozen baseline (job singlestep)');

lines.push('release.yml (7.4: tag v*)');
check(
  JSON.stringify(release.on?.push?.tags ?? release[true]?.push?.tags) === JSON.stringify(['v*']),
  'push of a v* tag',
);
check(release.jobs.engines?.uses === './.github/workflows/engines.yml', 'engines: the reusable engines.yml');
check(release.jobs.web?.['runs-on'] === 'ubuntu-latest', 'web: build and zip app/dist');
const macs = release.jobs.mac?.strategy?.matrix?.include ?? [];
check(
  macs.some((m) => m.arch === 'arm64' && m.runner === 'macos-15'),
  'mac-arm64 on macos-15',
);
check(
  macs.some((m) => m.arch === 'x64' && m.runner === 'macos-15-intel'),
  'mac-x64 on macos-15-intel',
);
const macSteps = (release.jobs.mac?.steps ?? []).map((s) => s.run ?? '').join('\n');
check(/npm run desktop:dist/.test(macSteps), 'mac: npm run desktop:dist');
check(
  /npm run desktop:test -- packaged/.test(macSteps),
  'mac: the packaged-app checks of 6.7 (npm run desktop:test -- packaged)',
);
check(
  Boolean(release.jobs.publish) && /--draft/.test(JSON.stringify(release.jobs.publish)),
  'publish: a draft GitHub Release',
);
check(Boolean(release.jobs.checksums), 'checksums: SHA256SUMS.txt on every run (errata DV3 2, 20)');

lines.push('engines.yml (7.3)');
check(
  triggers(engines).includes('workflow_call') && engines.jobs.build?.['runs-on'] === 'ubuntu-latest',
  'reusable, on ubuntu-latest',
);

lines.push('all workflows (7.4: actions pinned by commit hash; contents: read by default)');
const allowedWrite = new Set(['pages.yml:deploy', 'pages.yml:build', 'release.yml:publish', 'oracle.yml:propose']);
for (const [name, wf] of [
  ['ci.yml', ci],
  ['release.yml', release],
  ['pages.yml', pages],
  ['oracle.yml', oracle],
  ['engines.yml', engines],
]) {
  const uses = [];
  for (const job of Object.values(wf.jobs)) for (const step of job.steps ?? []) if (step.uses) uses.push(step.uses);
  const unpinned = uses.filter((u) => !u.startsWith('./') && !/@[0-9a-f]{40}$/.test(u));
  check(
    unpinned.length === 0,
    `${name}: ${uses.length} action uses, unpinned: ${unpinned.length}${unpinned.length ? ` (${unpinned.join(', ')})` : ''}`,
  );
  check(
    JSON.stringify(wf.permissions) === JSON.stringify({ contents: 'read' }),
    `${name}: permissions contents: read at the top`,
  );
  for (const [id, job] of Object.entries(wf.jobs)) {
    if (!job.permissions) continue;
    const writes = Object.entries(job.permissions).filter(([, v]) => v === 'write');
    const asks = Object.entries(job.permissions).some(([k, v]) => !(k === 'contents' && v === 'read'));
    if (asks)
      check(
        allowedWrite.has(`${name}:${id}`),
        `${name}: job ${id} asks for ${JSON.stringify(job.permissions)}${writes.length ? '' : ' (read only)'}`,
      );
  }
}

// ---------------------------------------------------------------------------------------------
// Part 2: finished runs

const prescribed = {
  ci: [
    'engines / build (linux)',
    'check (typecheck, lint, format)',
    'unit (ubuntu-latest)',
    'unit (windows-latest)',
    'unit (macos-latest)',
    'conformance (ubuntu-latest)',
    'conformance (macos-latest)',
    ...['ubuntu-latest', 'macos-latest', 'windows-latest'].flatMap((os) =>
      ['chromium', 'webkit'].map((b) => `e2e (${os}, ${b})`),
    ),
    'e2e stability (ubuntu-latest, chromium, 20 repetitions)',
    'e2e stability (ubuntu-latest, webkit, 20 repetitions)',
    'windows-oracles',
    'desktop-dev (macos-15)',
  ],
  release: ['engines / build (linux)', 'web', 'mac-arm64', 'mac-x64', 'checksums', 'publish (draft)'],
  pages: ['engines / build (linux)', 'build', 'deploy'],
  oracle: ['engines / build (linux)', 'wine (official EDIT68K.exe and SIM68K.exe)', 'propose', 'singlestep'],
};
/** Jobs that 7.4 runs only on some events; on the others GitHub reports them as skipped. */
const skippedAllowed = {
  ci: (name, event) => name.startsWith('e2e stability') && event === 'push',
  release: (name) => name === 'publish (draft)', // a manual run without draft_release
  pages: () => false,
  oracle: (name) => name === 'propose', // runs only when a golden changed
};
for (const { name, file } of args.runs) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const jobs = data.jobs ?? [];
  const runId = jobs[0]?.run_id ?? '?';
  const event = data.event ?? (jobs[0]?.name === undefined ? '?' : 'push');
  lines.push(
    `run ${runId} of ${name}.yml (${jobs.length} jobs, file ${file}${data.event ? `, event ${data.event}` : ''})`,
  );
  for (const wanted of prescribed[name] ?? []) {
    const stabilityOf = /^e2e stability \(ubuntu-latest, (\w+),/.exec(wanted)?.[1];
    if (stabilityOf) {
      // One job per browser, or one per shard (named "..., <browser>, 20 repetitions, shard n of m");
      // on a push GitHub lists one skipped job whose name still holds ${{ matrix.browser }}.
      const own = jobs.filter(
        (j) =>
          j.name.startsWith(`e2e stability (ubuntu-latest, ${stabilityOf},`) ||
          (j.name.startsWith('e2e stability') && j.name.includes('${{')),
      );
      if (own.length === 0) bad(`${name} run ${runId}: no job "${wanted}" (or its shards) in the run`);
      else if (own.every((j) => j.conclusion === 'success'))
        ok(`${wanted}: success (${own.map((j) => `job ${j.id}`).join(', ')})`);
      else if (own.every((j) => j.conclusion === 'skipped') && skippedAllowed[name]?.(wanted, data.event ?? event))
        lines.push(
          `  skip  ${wanted}: skipped on this event, as 7.4 says (${own.map((j) => `job ${j.id}`).join(', ')})`,
        );
      else
        bad(
          `${name} run ${runId}: ${wanted}: ${own.map((j) => `${j.name}: ${j.status} ${j.conclusion ?? ''} (job ${j.id})`).join('; ')}`,
        );
      continue;
    }
    const job = jobs.find(
      (j) => j.name === wanted || (wanted.startsWith('engines') && /^engines \/ build/.test(j.name)),
    );
    if (!job) bad(`${name} run ${runId}: job "${wanted}" is not in the run`);
    else if (job.conclusion === 'success') ok(`${wanted}: success (job ${job.id})`);
    else if (job.conclusion === 'skipped' && skippedAllowed[name]?.(wanted, data.event ?? event))
      lines.push(`  skip  ${wanted}: skipped on this event, as 7.4 says (job ${job.id})`);
    else bad(`${name} run ${runId}: ${wanted}: ${job.status} ${job.conclusion ?? ''} (job ${job.id})`);
  }
  const others = jobs.filter((j) => !(prescribed[name] ?? []).includes(j.name) && !/^engines \/ build/.test(j.name));
  const otherBad = others.filter((j) => j.conclusion !== 'success' && j.conclusion !== 'skipped');
  lines.push(
    `  note  jobs beyond 7.4: ${others.length}, not successful: ${otherBad.length}${otherBad.map((j) => `\n          - ${j.name}: ${j.status} ${j.conclusion ?? ''} (job ${j.id})`).join('')}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Part 3: the packaged-app checks of 6.7 in the logs of the mac jobs

/** The tests of tests/desktop/packaged that carry each check of 6.7 (erratum DV3 3). */
const CHECKS = {
  1: [
    'codesign --verify --deep --strict passes and the signature is ad hoc',
    'every .node file, helper and framework carries a valid signature of its own',
    'the bundle contains both engines, the help, the fonts and the examples',
    'the main binary and every .node file have the expected architecture',
    'npx @electron/fuses read shows the fuses of 7.6',
  ],
  2: [
    'the page loads without a Content Security Policy violation',
    'both engines start',
    'the window title is the one of 1.3.3',
    'window.easy68kDesktop has exactly the documented functions; no require, no process',
  ],
  3: ['an .S68 opened through Launch Services starts Simulator mode with the program loaded, not running'],
  4: ['quit with a modified document asks first, and Cancel (Stay) keeps the app running'],
  5: ['a program in a task 23 delay of 300 units finishes within 3.5 s while the window is minimised'],
  6: ['check 6: tutorial1.X68 opened from a temporary folder and assembled: .L68 and .S68 there equal the goldens'],
  7: ['check 7: Execute and Run: the message area and the surface hash equal the headless harness'],
  8: ['check 8: the file fileio.X68 writes is on disk with the expected bytes as soon as it is closed'],
};
const ESC = String.fromCharCode(27);
const COLOUR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
for (const { name, file } of args.mac) {
  const text = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\S+Z /, '').replace(COLOUR, ''));
  const machine = text.find((l) => /^processor: /.test(l)) ?? 'processor: ?';
  const macos = (text.find((l) => /^ProductVersion:/.test(l)) ?? '').replace(/\s+/g, ' ');
  const total = text.find((l) => /^Running \d+ tests/.test(l)) ?? 'no "Running N tests" line';
  const summary = text.filter((l) => /^\s+\d+ (passed|failed|flaky|skipped|did not run)/.test(l)).map((l) => l.trim());
  lines.push(
    `packaged-app checks of 6.7, ${name} (${machine}, ${macos}; ${total}; ${summary.join(', ') || 'no summary line'})`,
  );
  for (const [number, titles] of Object.entries(CHECKS)) {
    const states = titles.map((title) => {
      const line = text.find((l) => l.includes(`› ${title} (`) || l.endsWith(`› ${title}`));
      if (!line) return 'absent';
      return /^\s+(✓|ok)\s/.test(line) ? 'passed' : /^\s+-\s/.test(line) ? 'skipped' : 'failed';
    });
    const passed = states.filter((s) => s === 'passed').length;
    check(
      passed === titles.length,
      `${name} check ${number}: ${passed} of ${titles.length} tests passed${passed === titles.length ? '' : ` (${states.join(', ')})`}`,
    );
  }
  if (summary.some((s) => /failed|flaky/.test(s))) bad(`${name}: the packaged suite reports ${summary.join(', ')}`);
}

console.log('6.9 item 6 (platforms): .github/workflows against ARCHITECTURE.md 7.4, runs, packaged-app checks of 6.7');
console.log(lines.join('\n'));
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
