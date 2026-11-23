// Self-test of two parts of .github/workflows/ci.yml that no CI run shows to be wrong until much
// later. Runs as part of `npm run lint` (vitest run --root tests/lint). Written by the gate's
// configuration engineer (gate I2 round 2).
//
// 1. Cache entries. actions/cache derives an entry's version from its `path` list, so a restore
//    that names other paths than the save never finds the entry, even with the same key. Every
//    cache step with the same key must therefore name the same paths (the e2e-stability job once
//    restored with one path what e2e saved with three).
// 2. The e2e-stability guard of the plan job (ARCHITECTURE.md 6.9 item 10): the 20 repetitions run
//    on a manual run (unless its input is unticked) and on the push of a v* tag, not on every push,
//    pull request or the weekly schedule. The plan step's script is run with bash, as on GitHub.
//    The job itself is split into shards per browser (Chromium 2, WebKit 4), every shard with
//    --repeat-each=20 (gate I3 round 3): its matrix, command, limit and names are checked too, and
//    the global limit that ends a shard whose browser hangs (gate I3 round 4).
// 3. The other guards of the plan job that depend on the event or on the push's changes (gate I3
//    preparation): perf and perf_full (6.9 item 9), readme (DOC1 item 3) and desktop-dev, which
//    also runs when only tests/desktop/dev changed (DV2-desktop-dev-paths.md).
//
// Where no bash is found the guard cases are skipped with a printed note; where CI is set that is a
// failure instead (Git for Windows' bash is found even when it is not on PATH).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// EASY68K_CI_WORKFLOW names another copy of the file, to show that the test fails on an old one.
const workflow = readFileSync(
  process.env.EASY68K_CI_WORKFLOW ?? fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
);
const lines = workflow.split(/\r?\n/);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

interface Step {
  name: string;
  text: string[];
}

/** The steps of every job: from one `- name:` (or `- uses:`) at step depth to the next. */
function steps(): Step[] {
  const out: Step[] = [];
  let current: Step | null = null;
  for (const line of lines) {
    const start = /^ {6}- (?:name|uses|run|id): ?(.*)$/.exec(line);
    if (start || /^ {2}\S/.test(line) || /^ {4}\S/.test(line)) {
      if (current) out.push(current);
      current = start ? { name: start[1] ?? '', text: [line] } : null;
      continue;
    }
    current?.text.push(line);
  }
  if (current) out.push(current);
  return out;
}

/** The value of `key:` and the lines of `path:` (one line or a block) of a cache step. */
function cacheOf(step: Step): { key: string; paths: string[] } | null {
  if (!step.text.some((line) => /uses: actions\/cache(\/restore|\/save)?@/.test(line))) return null;
  let key = '';
  const paths: string[] = [];
  for (let i = 0; i < step.text.length; i++) {
    const line = step.text[i] as string;
    const keyMatch = /^ {10}key: (.*)$/.exec(line);
    if (keyMatch) key = (keyMatch[1] ?? '').trim();
    const pathMatch = /^ {10}path: ?(.*)$/.exec(line);
    if (pathMatch) {
      const inline = (pathMatch[1] ?? '').trim();
      if (inline !== '|' && inline !== '') paths.push(inline);
      else {
        for (let j = i + 1; j < step.text.length && /^ {12}/.test(step.text[j] as string); j++) {
          paths.push((step.text[j] as string).trim());
        }
      }
    }
  }
  return { key, paths };
}

describe('ci.yml: cache steps', () => {
  const caches = steps()
    .map((step) => ({ step: step.name, cache: cacheOf(step) }))
    .filter((entry): entry is { step: string; cache: { key: string; paths: string[] } } => entry.cache !== null);

  it('finds the cache steps (the parser still reads the file)', () => {
    expect(caches.length).toBeGreaterThanOrEqual(8);
    expect(caches.every((entry) => entry.cache.key !== '' && entry.cache.paths.length > 0)).toBe(true);
  });

  it('names the same paths in every step that uses the same key', () => {
    const byKey = new Map<string, { step: string; paths: string }[]>();
    for (const { step, cache } of caches) {
      const list = byKey.get(cache.key) ?? [];
      list.push({ step, paths: cache.paths.join(', ') });
      byKey.set(cache.key, list);
    }
    const mismatched = [...byKey.entries()]
      .filter(([, list]) => new Set(list.map((entry) => entry.paths)).size > 1)
      .map(([key, list]) => `${key}: ${list.map((entry) => `"${entry.step}" -> ${entry.paths}`).join(' | ')}`);
    expect(mismatched).toEqual([]);
  });
});

/** The script of the plan job's step `guards`, dedented. */
function guardScript(): string {
  const at = lines.findIndex((line) => /^ {8}id: guards$/.test(line));
  expect(at).toBeGreaterThan(0);
  const run = lines.findIndex((line, i) => i > at && /^ {8}run: \|$/.test(line));
  expect(run).toBeGreaterThan(at);
  const body: string[] = [];
  for (let i = run + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() !== '' && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}

/** The table `checks` of the guard script: output name -> the file that turns its step on. */
function checkTable(): Map<string, string> {
  const script = guardScript();
  const start = script.indexOf("checks='");
  const end = script.indexOf("'", start + "checks='".length);
  expect(start).toBeGreaterThan(0);
  const table = new Map<string, string>();
  for (const row of script.slice(start + "checks='".length, end).split('\n')) {
    const [name, file] = row.trim().split(/\s+/);
    if (name && file) table.set(name, file);
  }
  return table;
}

/** Every browser check script (check-<name>.mjs) of the application and of tests/. */
function checkScripts(): string[] {
  const found: string[] = [];
  const walk = (relativeDir: string): void => {
    for (const entry of readdirSync(join(repoRoot, relativeDir), { withFileTypes: true })) {
      const path = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'test-results', 'playwright-report'].includes(entry.name)) walk(path);
      } else if (/^check-[\w-]+\.mjs$/.test(entry.name)) found.push(path);
    }
  };
  walk('app/src');
  walk('tests');
  // tools/ holds checks too since the gate of the stage of additions (check-frame-policy.mjs).
  walk('tools');
  return found.sort();
}

/** Scripts that run another table row's file: check:engine-browsers runs the binding's browser suite. */
const RUNNER_OF: Record<string, string> = { 'tools/check-engine-browsers.mjs': 'app/src/engine/browser.test.ts' };

describe('ci.yml and package.json: every browser check runs in CI', () => {
  // A check script nobody runs proves nothing (X3, DV4, P1 and Q1 each waited a gate for this).
  const table = checkTable();
  const files = new Set(table.values());
  const scripts = (
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  ).scripts;

  it('finds the table of the plan step', () => {
    expect(table.size).toBeGreaterThanOrEqual(28);
  });

  // Checks with a job of their own instead of a step of browser-checks: file -> root script.
  const OWN_JOBS: Record<string, string> = { 'tests/perf/check-perf.mjs': 'check:perf' };

  /** tools/check-*.mjs that start no browser: a step of the job `check` runs them (docs/requests/N10-check-guide.md). */
  const NOT_BROWSER_CHECKS: Record<string, string> = { 'tools/check-guide-strings.mjs': 'check:guide' };

  it.each(checkScripts().filter((file) => !(file in OWN_JOBS) && !(file in NOT_BROWSER_CHECKS)))(
    "%s is in the plan step's table",
    (file) => {
      expect([...files]).toContain(RUNNER_OF[file] ?? file);
    },
  );

  it.each(Object.entries(NOT_BROWSER_CHECKS).map(([file, script]) => ({ file, script })))(
    '$file: the root script $script runs it and the job check of ci.yml runs that script',
    ({ file, script }) => {
      expect(scripts[script]).toMatch(new RegExp(`^node ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`));
      const step = steps().find((candidate) => candidate.text.some((line) => line.trim() === `run: npm run ${script}`));
      expect(step, `no step runs "npm run ${script}"`).toBeDefined();
    },
  );

  it.each(Object.entries(OWN_JOBS).map(([file, script]) => ({ file, script })))(
    '$file: the root script $script runs it and a job of ci.yml runs that script',
    ({ file, script }) => {
      expect(scripts[script]).toBe(`node ${file}`);
      expect(workflow).toMatch(new RegExp(`npm run ${script} -- `));
    },
  );

  it.each([...table.entries()].map(([name, file]) => ({ name, file })))(
    '$name: a root script runs $file and a step of ci.yml runs that script under its guard',
    ({ name, file }) => {
      // check:engine-browsers runs the binding's browser suite through tools/check-engine-browsers.mjs.
      const runs = name === 'engine_browsers' ? 'tools/check-engine-browsers.mjs' : file;
      const script = Object.entries(scripts).find(([, command]) => command === `node ${runs}`)?.[0];
      expect(script, `no root script "node ${runs}"`).toBeDefined();
      const guarded = new RegExp(`needs\\.plan\\.outputs\\.${name} == 'true'`);
      const step = steps().find(
        (candidate) =>
          candidate.text.some((line) => guarded.test(line)) &&
          candidate.text.some((line) => new RegExp(`run: npm run ${script}( |$)`).test(line.trim())),
      );
      expect(step, `no step runs "npm run ${script}" under needs.plan.outputs.${name}`).toBeDefined();
    },
  );
});

/**
 * A bash that runs the guard script as GitHub does. On Windows, `bash` on PATH may be missing or be
 * WSL's launcher, so Git for Windows' own bash (next to the git that is on PATH) is tried first.
 */
function findBash(): string | null {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
    if (exec.status === 0 && exec.stdout.trim() !== '') {
      // <Git>/mingw64/libexec/git-core -> <Git>
      const gitRoot = resolve(exec.stdout.trim(), '..', '..', '..');
      candidates.push(join(gitRoot, 'bin', 'bash.exe'), join(gitRoot, 'usr', 'bin', 'bash.exe'));
    }
  }
  candidates.push('bash');
  for (const candidate of candidates) {
    if (candidate !== 'bash' && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === 'ok') return candidate;
  }
  return null;
}

const bash = findBash();
const NO_BASH =
  'tests/lint/ci-workflow.test.ts: no bash found (not on PATH, and no Git for Windows next to git), so the ' +
  "cases that run the plan job's guard script are SKIPPED here. Install Git for Windows or put bash on PATH " +
  'to run them; CI has bash and runs them.';
if (bash === null) console.warn(NO_BASH);

describe('ci.yml: a bash for the guard cases', () => {
  // Where CI is set a missing bash is a failure, so that the guard cases cannot vanish silently.
  it.runIf(bash === null && process.env.CI !== undefined && process.env.CI !== '')('is found (required in CI)', () => {
    expect.fail(NO_BASH);
  });
  it.runIf(bash !== null)(`is found: ${bash ?? ''}`, () => {
    expect(bash).not.toBeNull();
  });
});

/** Environment that isolates a scratch Git repository from the user's and the system's Git settings. */
function isolatedGitEnv(dir: string): NodeJS.ProcessEnv {
  const config = join(dir, 'gitconfig');
  writeFileSync(config, '');
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'ci-guard-test',
    GIT_AUTHOR_EMAIL: 'ci-guard-test@example.invalid',
    GIT_COMMITTER_NAME: 'ci-guard-test',
    GIT_COMMITTER_EMAIL: 'ci-guard-test@example.invalid',
  };
}

/**
 * Runs the plan job's guard script with bash -eo pipefail (GitHub's `shell: bash`) in `cwd` and
 * returns its outputs and step summary.
 */
function runGuards(cwd: string, vars: Record<string, string>): { outputs: string; summary: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ci-guards-'));
  try {
    const script = join(dir, 'guards.sh');
    writeFileSync(script, guardScript());
    const output = join(dir, 'output.txt');
    const summary = join(dir, 'summary.txt');
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const result = spawnSync(
      bash as string,
      ['--noprofile', '--norc', '-eo', 'pipefail', script.replaceAll('\\', '/')],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          EVENT: 'push',
          REF: 'refs/heads/main',
          STABILITY_INPUT: '',
          README_INPUT: '',
          BEFORE: '',
          PR_BASE: '',
          ...vars,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    return { outputs: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const valueOf = (outputs: string, name: string): string | undefined =>
  new RegExp(`^${name}=(true|false)$`, 'm').exec(outputs)?.[1];

describe.skipIf(bash === null)('ci.yml: the e2e-stability guard (6.9 item 10)', () => {
  const cases: { event: string; ref: string; input: string; stability: boolean }[] = [
    { event: 'push', ref: 'refs/heads/main', input: '', stability: false },
    { event: 'push', ref: 'refs/heads/gate3/x', input: '', stability: false },
    { event: 'pull_request', ref: 'refs/pull/7/merge', input: '', stability: false },
    { event: 'schedule', ref: 'refs/heads/main', input: '', stability: false },
    { event: 'push', ref: 'refs/tags/v1.0.0', input: '', stability: true },
    { event: 'workflow_dispatch', ref: 'refs/heads/main', input: 'true', stability: true },
    { event: 'workflow_dispatch', ref: 'refs/heads/main', input: 'false', stability: false },
  ];

  it.each(cases)(
    '$event on $ref (input "$input"): e2e_stability=$stability',
    ({ event, ref, input, stability }) => {
      const { outputs, summary } = runGuards(repoRoot, { EVENT: event, REF: ref, STABILITY_INPUT: input });
      // The job needs the e2e suites; with none the guard is false whatever the event.
      const expected = stability && valueOf(outputs, 'e2e') === 'true';
      expect(outputs).toMatch(new RegExp(`^e2e_stability=${expected}$`, 'm'));
      expect(summary).toMatch(/^e2e stability: /m);
    },
    30_000,
  );
});

/** The lines of one job, from `  <id>:` to the next job (or the end of the file). */
function jobLines(id: string): string[] {
  const at = lines.findIndex((line) => line === `  ${id}:`);
  expect(at, `no job ${id}`).toBeGreaterThan(0);
  const end = lines.findIndex((line, i) => i > at && /^ {2}\S/.test(line));
  return lines.slice(at, end < 0 ? lines.length : end);
}

describe('ci.yml: the e2e-stability job is split into shards (6.9 item 10, gate I3 round 3)', () => {
  // One browser's 20 repetitions took about 76 min (Chromium) and 184 min (WebKit) on GitHub, over
  // the limit of 180: each browser's run is split with --shard, every shard with --repeat-each=20.
  const job = jobLines('e2e-stability');
  const text = job.join('\n');
  const shards = job
    .map((line) => /^ {10}- \{ browser: (\w+), shard: (\d+), shards: (\d+) \}$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ browser: match[1] as string, shard: Number(match[2]), shards: Number(match[3]) }));

  it('runs Chromium in 2 shards and WebKit in 4, each browser shard 1 to n exactly once', () => {
    expect(shards).toEqual([
      { browser: 'chromium', shard: 1, shards: 2 },
      { browser: 'chromium', shard: 2, shards: 2 },
      { browser: 'webkit', shard: 1, shards: 4 },
      { browser: 'webkit', shard: 2, shards: 4 },
      { browser: 'webkit', shard: 3, shards: 4 },
      { browser: 'webkit', shard: 4, shards: 4 },
    ]);
    // Nothing else in the matrix (a `browser:` list would add unsharded jobs).
    expect(text).not.toMatch(/^ {8}browser: \[/m);
  });

  it('runs every shard with --repeat-each=20 and its own --shard, under the guard and the limit of 180', () => {
    expect(text).toMatch(/^ {4}if: needs\.plan\.outputs\.e2e_stability == 'true'$/m);
    expect(text).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
    expect(text).toMatch(/^ {4}timeout-minutes: 180$/m);
    const runs = job.filter((line) => /^ {8}run: npm run test:e2e /.test(line));
    expect(runs).toEqual([
      '        run: npm run test:e2e -- --project ${{ matrix.browser }} --repeat-each=20 --shard=${{ matrix.shard }}/${{ matrix.shards }} --global-timeout=7200000 --reporter=dot,html',
    ]);
  });

  // Gate I3 round 4: a hang of one browser (a WebKit worker that stopped answering between two tests
  // on the development PC, which neither the test limit nor Playwright ended) must end the shard
  // with a failure and its report, not stall it until the job's limit, which uploads nothing.
  it('ends a shard after a global limit well above its expected time and well below the job limit', () => {
    const limit = /--global-timeout=(\d+)/.exec(text);
    expect(limit, 'the Playwright command has --global-timeout').not.toBeNull();
    const minutes = Number(limit?.[1]) / 60_000;
    const longestShard = Math.max(76 / 2, 184 / 4); // measured unsharded minutes / shards (gate I3 round 3)
    expect(minutes).toBeGreaterThanOrEqual(2.5 * longestShard);
    expect(minutes).toBeLessThanOrEqual(180 - 45); // time left for install, build and the report upload
  });

  it('names each job and its report artifact by browser and shard', () => {
    expect(text).toContain(
      '    name: e2e stability (ubuntu-latest, ${{ matrix.browser }}, 20 repetitions, shard ${{ matrix.shard }} of ${{ matrix.shards }})',
    );
    expect(text).toContain(
      '          name: playwright-report-stability-${{ matrix.browser }}-shard-${{ matrix.shard }}-of-${{ matrix.shards }}',
    );
  });
});

describe('ci.yml: the history model test runs its whole range (ARCHITECTURE-PLUS P5 N3)', () => {
  // docs/requests/N3-model-test-ci.md: npm test runs a quick 200 seeds; the job history-model runs
  // seeds 1 to 2,000 in two parts of 1,000, each on a runner of its own, on the three systems.
  const job = jobLines('history-model');
  const text = job.join('\n');
  const parts = job
    .map((line) => /^ {10}- \{ first: (\d+), last: (\d+) \}$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ first: Number(match[1]), last: Number(match[2]) }));

  it('splits seeds 1 to 2,000 into parts that meet end to end, each of the size it asks for', () => {
    expect(parts).toEqual([
      { first: 1, last: 1000 },
      { first: 1001, last: 2000 },
    ]);
    expect(text).toMatch(/^ {8}os: \[ubuntu-latest, windows-latest, macos-latest\]$/m);
    expect(text).toContain('EASY68K_HISTORY_FIRST: ${{ matrix.seeds.first }}');
    expect(text).toContain("EASY68K_HISTORY_SEEDS: '1000'");
    expect(text).toContain("EASY68K_HISTORY_SHARDS: '4'");
    expect(text).toContain('run: npx vitest run src/fs/history-model.test.ts');
  });

  it('npm test in the job unit runs the quick 200 seeds', () => {
    const unit = jobLines('unit');
    const at = unit.findIndex((line) => line === '      - name: Unit tests');
    expect(at).toBeGreaterThan(0);
    expect(unit.slice(at, at + 4)).toEqual([
      '      - name: Unit tests',
      '        run: npm test',
      '        env:',
      "          EASY68K_HISTORY_SEEDS: '200'",
    ]);
  });
});

describe.skipIf(bash === null)('ci.yml: the perf and readme guards (6.9 item 9, DOC1 item 3)', () => {
  // perf: the functional parts on every push and pull request; the whole check (perf_full, the
  // thresholds of 6.9 item 9 judged) on a manual run and a v* tag; nothing on the weekly schedule.
  // readme: weekly, and on a manual run with its input ticked.
  const cases: { event: string; ref: string; input: string; perf: boolean; full: boolean; readme: boolean }[] = [
    { event: 'push', ref: 'refs/heads/main', input: '', perf: true, full: false, readme: false },
    { event: 'pull_request', ref: 'refs/pull/7/merge', input: '', perf: true, full: false, readme: false },
    { event: 'push', ref: 'refs/tags/v1.0.0', input: '', perf: true, full: true, readme: false },
    { event: 'workflow_dispatch', ref: 'refs/heads/main', input: 'false', perf: true, full: true, readme: false },
    { event: 'workflow_dispatch', ref: 'refs/heads/main', input: 'true', perf: true, full: true, readme: true },
    { event: 'schedule', ref: 'refs/heads/main', input: '', perf: false, full: false, readme: true },
  ];

  it.each(cases)(
    '$event on $ref (readme input "$input"): perf=$perf, perf_full=$full, readme=$readme',
    ({ event, ref, input, perf, full, readme }) => {
      const { outputs } = runGuards(repoRoot, { EVENT: event, REF: ref, README_INPUT: input });
      const havePerf = existsSync(join(repoRoot, 'tests', 'perf', 'check-perf.mjs'));
      expect(valueOf(outputs, 'perf')).toBe(String(perf && havePerf));
      expect(valueOf(outputs, 'perf_full')).toBe(String(full && havePerf));
      expect(valueOf(outputs, 'readme')).toBe(String(readme));
    },
    30_000,
  );
});

describe.skipIf(bash === null)('ci.yml: the desktop-dev guard (7.4; docs/requests/DV2-desktop-dev-paths.md)', () => {
  // A scratch repository with the desktop suite's configuration; each case commits one changed file
  // on top of the base commit and runs the guard script as for a push from the base.
  const cases: { changed: string; desktopDev: boolean }[] = [
    { changed: 'docs/notes.md', desktopDev: false },
    { changed: 'tests/e2e/x.spec.ts', desktopDev: false },
    { changed: 'tests/desktop/dev/programs.spec.ts', desktopDev: true },
    { changed: 'app/src/x.ts', desktopDev: true },
    { changed: 'desktop/src/x.ts', desktopDev: true },
  ];

  it.each(cases)(
    'a push that changes only $changed: desktop_dev=$desktopDev',
    ({ changed, desktopDev }) => {
      const dir = mkdtempSync(join(tmpdir(), 'ci-desktop-dev-'));
      try {
        const env = isolatedGitEnv(dir);
        const repo = join(dir, 'repo');
        const git = (...args: string[]): string => {
          const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env });
          expect(result.status, `git ${args.join(' ')}: ${result.stderr}`).toBe(0);
          return result.stdout.trim();
        };
        const put = (path: string, text: string): void => {
          mkdirSync(dirname(join(repo, path)), { recursive: true });
          writeFileSync(join(repo, path), text);
        };
        mkdirSync(repo);
        git('init', '-q');
        put('tests/desktop/dev/playwright.config.ts', 'export default {};\n');
        put('README.md', 'base\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'base');
        const base = git('rev-parse', 'HEAD');
        put(changed, 'changed\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'change');
        const { outputs, summary } = runGuards(repo, { EVENT: 'push', BEFORE: base });
        expect(valueOf(outputs, 'desktop_dev')).toBe(String(desktopDev));
        expect(summary).toContain(`tests/desktop/dev/** changed: ${desktopDev}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('a push without a usable base (a new branch) runs it', () => {
    const { outputs } = runGuards(repoRoot, {
      EVENT: 'push',
      BEFORE: '0000000000000000000000000000000000000000',
    });
    const haveSuite = existsSync(join(repoRoot, 'tests', 'desktop', 'dev', 'playwright.config.ts'));
    expect(valueOf(outputs, 'desktop_dev')).toBe(String(haveSuite));
  }, 30_000);
});

describe('ci.yml: the node:test suites of the check scripts run (docs/requests/W0-check-ending-test.md)', () => {
  // Every node:test file of tests/browser-checks must be named by a root script that a step of the
  // job `check` runs. Named, not found: on Windows Node 24's `node --test <folder>` finds nothing.
  const scripts = (
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  ).scripts;
  const checkJob = (() => {
    const at = lines.findIndex((line) => /^ {2}check:$/.test(line));
    expect(at).toBeGreaterThan(0);
    const end = lines.findIndex((line, i) => i > at && /^ {2}\S/.test(line));
    return lines.slice(at, end === -1 ? undefined : end).join('\n');
  })();
  const files = readdirSync(join(repoRoot, 'tests', 'browser-checks')).filter((name) => name.endsWith('.test.mjs'));

  it('finds the test of the shared ending', () => {
    expect(files).toContain('ending.test.mjs');
  });

  it.each(files)('tests/browser-checks/%s is run by a root script in the job check', (file) => {
    const named = Object.entries(scripts).filter(
      ([, command]) => /^node --test /.test(command) && command.includes(`tests/browser-checks/${file}`),
    );
    expect(
      named.map(([name]) => name),
      'a root script "node --test tests/browser-checks/<file>"',
    ).not.toEqual([]);
    const run = named.filter(([name]) =>
      new RegExp(`^ {8}run: npm run ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(checkJob),
    );
    expect(
      run.map(([name]) => name),
      'a step of the job check that runs that script',
    ).not.toEqual([]);
  });
});
