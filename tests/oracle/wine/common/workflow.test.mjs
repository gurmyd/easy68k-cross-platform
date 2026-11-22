// Tests of the order and the conditions of the job `wine` in .github/workflows/oracle.yml.
//
// Run 45003265263 showed what a failed image build did when the later steps had only
// `!cancelled()`: the download of the official programs was skipped, the regenerations failed
// with secondary errors, "What changed" reported that the official programs had produced what the
// repository holds, and the conformance tests passed against goldens that nothing had
// regenerated (erratum T1 23). Run 45034017858 showed two more: the conformance tests compared the
// committed MISMATCHES.md with what the regenerated goldens give, and the job `propose` failed
// because the repository does not let GitHub Actions open pull requests (erratum T1 27). These
// tests read the workflow (js-yaml, which the lockfile pins as
// a dependency of ESLint) and need neither Docker nor GitHub.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const yaml = createRequire(join(repo, 'package.json'))('js-yaml');
const workflow = yaml.load(readFileSync(join(repo, '.github', 'workflows', 'oracle.yml'), 'utf8'));
/** @type {{ name: string, id?: string, if?: string, run?: string, uses?: string, env?: Record<string, string> }[]} */
const steps = workflow.jobs.wine.steps;

const index = (pattern) => {
  const i = steps.findIndex((step) => pattern.test(step.run ?? '') || pattern.test(step.name));
  if (i < 0) throw new Error(`oracle.yml, job wine: no step matches ${pattern}`);
  return i;
};
const condition = (i) => String(steps[i].if ?? '');
const READY = "steps.ready.outputs.ok == 'true'";

const fetchOfficial = index(/fetch-official\.mjs/);
const restoreImage = index(/^Restore the Wine image$/);
const buildImage = index(/oracle:wine:build/);
const loadImage = index(/docker load/);
const ready = steps.findIndex((step) => step.id === 'ready');
const regenerateAsm = index(/oracle:wine:asm/);
const regenerateSim = index(/oracle:wine:sim/);
const whatChanged = steps.findIndex((step) => step.id === 'diff');
const siteCheck = index(/--sets site --check/);
const committed = steps.findIndex((step) => step.id === 'committed');
const regenerated = steps.findIndex((step) => step.id === 'regenerated');
const committedVerdict = steps.findIndex((step) =>
  /steps\.committed\.outcome == 'failure'/.test(String(step.if ?? '')),
);
const candidateVerdict = steps.findIndex(
  (step) => step.id !== 'diff' && /steps\.diff\.outputs\.changed == 'true'/.test(String(step.if ?? '')) && step.run,
);
const propose = workflow.jobs.propose;

describe('oracle.yml, job wine', () => {
  it('fetches the official programs before it builds or loads the image (the download needs no image)', () => {
    expect(fetchOfficial).toBeLessThan(restoreImage);
    expect(fetchOfficial).toBeLessThan(buildImage);
    expect(fetchOfficial).toBeLessThan(loadImage);
    expect(condition(fetchOfficial)).toBe('');
  });

  it('has one step without a condition after the download and the image that marks both ready', () => {
    expect(ready).toBeGreaterThan(Math.max(fetchOfficial, buildImage, loadImage));
    expect(condition(ready)).toBe('');
    expect(steps[ready].run).toContain('ok=true');
    expect(steps[ready].run).toContain('$GITHUB_OUTPUT');
  });

  it('runs an official program only when the image and the official programs are ready', () => {
    for (const i of [regenerateAsm, regenerateSim, siteCheck]) {
      expect(i, steps[i].name).toBeGreaterThan(ready);
      expect(condition(i), steps[i].name).toContain(READY);
    }
    expect(steps[regenerateAsm].id).toBe('asm');
    expect(steps[regenerateSim].id).toBe('sim');
  });

  it('runs the conformance tests against the committed goldens before anything is regenerated', () => {
    expect(committed).toBeGreaterThanOrEqual(0);
    expect(steps[committed].run).toContain('npm run test:conformance');
    expect(committed).toBeLessThan(Math.min(regenerateAsm, regenerateSim));
    // Its failure does not stop the regeneration, but a later step fails the job for it.
    expect(steps[committed]['continue-on-error']).toBe(true);
    expect(committedVerdict).toBeGreaterThan(committed);
    expect(steps[committedVerdict].run).toContain('exit 1');
  });

  it('runs the conformance tests against the regenerated goldens only after a completed regeneration', () => {
    expect(regenerated).toBeGreaterThan(Math.max(regenerateAsm, regenerateSim, siteCheck));
    expect(steps[regenerated].run).toContain('npm run test:conformance');
    expect(condition(regenerated)).toContain("steps.asm.outcome == 'success'");
    // There MISMATCHES.md is written from the regenerated goldens, not compared with the committed one.
    expect(steps[regenerated].env).toMatchObject({ EASY68K_SIM_REPORT: '1' });
    // ... before "What changed", so that a changed report is part of the candidate.
    expect(whatChanged).toBeGreaterThan(regenerated);
  });

  it('fails while the official programs produce something the repository does not hold, naming the files', () => {
    expect(candidateVerdict).toBeGreaterThan(whatChanged);
    expect(condition(candidateVerdict)).toContain('!cancelled()');
    const script = steps[candidateVerdict].run ?? '';
    expect(script).toContain('changed.txt');
    expect(script).toContain('exit 1');
    expect(steps[whatChanged].run).toContain('$GITHUB_STEP_SUMMARY');
    expect(steps[whatChanged].run).toContain('git diff --cached --name-status');
  });

  it('proposes no files and claims no result unless every regeneration that ran completed', () => {
    const step = steps[whatChanged];
    expect(whatChanged).toBeGreaterThan(regenerateSim);
    expect(step.env).toMatchObject({
      READY: '${{ steps.ready.outputs.ok }}',
      ASM_OUTCOME: '${{ steps.asm.outcome }}',
      SIM_OUTCOME: '${{ steps.sim.outcome }}',
    });
    const script = step.run ?? '';
    const claim = script.indexOf('The official programs produced what the repository holds.');
    const notReady = script.indexOf('[ "$READY" != \'true\' ]');
    const incomplete = script.indexOf('[ "$ASM_OUTCOME" != \'success\' ]');
    expect(notReady).toBeGreaterThanOrEqual(0);
    expect(incomplete).toBeGreaterThan(notReady);
    expect(claim).toBeGreaterThan(incomplete);
    // Both early exits report changed=false before they leave.
    for (const start of [notReady, incomplete]) {
      const branch = script.slice(start, script.indexOf('exit 0', start));
      expect(branch).toContain('echo "changed=false" >> "$GITHUB_OUTPUT"');
    }
  });
});

describe('oracle.yml, job propose', () => {
  const script = propose.steps.map((step) => step.run ?? '').join('\n');

  it('runs only for a candidate of the job wine, also when that job failed for it', () => {
    expect(propose.needs).toEqual(['wine']);
    expect(String(propose.if)).toContain("needs.wine.outputs.changed == 'true'");
    expect(String(propose.if)).toContain('!cancelled()');
  });

  it('pushes the branch and names the address of a new pull request instead of opening one', () => {
    expect(propose.permissions).toEqual({ contents: 'write' });
    expect(script).not.toMatch(/gh pr create/);
    expect(script).toContain('git push');
    expect(script).toContain('$GITHUB_STEP_SUMMARY');
    const env = Object.assign({}, ...propose.steps.map((step) => step.env ?? {}));
    expect(env.NEW_PR_URL).toBe(
      '${{ github.server_url }}/${{ github.repository }}/pull/new/oracle/regenerated-${{ github.run_id }}',
    );
    expect(env.BRANCH).toBe('oracle/regenerated-${{ github.run_id }}');
  });
});
