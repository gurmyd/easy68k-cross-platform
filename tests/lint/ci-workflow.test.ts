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

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// EASY68K_CI_WORKFLOW names another copy of the file, to show that the test fails on an old one.
const workflow = readFileSync(
  process.env.EASY68K_CI_WORKFLOW ?? fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
);
const lines = workflow.split(/\r?\n/);

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

const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
const haveBash = bash.status === 0 && bash.stdout.trim() === 'ok';

describe.skipIf(!haveBash)('ci.yml: the e2e-stability guard (6.9 item 10)', () => {
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
      const dir = mkdtempSync(join(tmpdir(), 'ci-guards-'));
      try {
        const script = join(dir, 'guards.sh');
        writeFileSync(script, guardScript());
        const output = join(dir, 'output.txt');
        const summary = join(dir, 'summary.txt');
        writeFileSync(output, '');
        writeFileSync(summary, '');
        const repo = fileURLToPath(new URL('../..', import.meta.url));
        const result = spawnSync('bash', [script.replaceAll('\\', '/')], {
          cwd: repo,
          encoding: 'utf8',
          env: {
            ...process.env,
            EVENT: event,
            REF: ref,
            STABILITY_INPUT: input,
            BEFORE: '',
            PR_BASE: '',
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: summary,
          },
        });
        expect(result.status, result.stderr).toBe(0);
        const outputs = readFileSync(output, 'utf8');
        const e2e = /^e2e=(true|false)$/m.exec(outputs)?.[1];
        // The job needs the e2e suites; with none (never on main) the guard is false whatever the event.
        const expected = stability && e2e === 'true';
        expect(outputs).toMatch(new RegExp(`^e2e_stability=${expected}$`, 'm'));
        expect(readFileSync(summary, 'utf8')).toMatch(/^e2e stability: /m);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
