// Release candidate (ARCHITECTURE.md 6.9, package I3), item 2, third part: "every automatable item
// of trap15-a §13, hardware §13 and the 'affects program results' rows of sim-ui §19 has a passing
// test". The three lists, item by item with the tests that prove each, are in
// item-02-checklists.json (built by hand from the specs and the test sources). This script checks
// that list against the repository and counts it:
//
//   node tests/integration/rc/item-02-checklists.mjs
//
//   - every item of trap15-a §13 and hardware §13 is in the list (the spec's bullets and numbered
//     items are counted from the spec files, so an item added to a spec fails the script), and every
//     row of sim-ui §19 whose answer is not "No", "Debugger only" or "Display only";
//   - a "program" proof names a program of tests/conformance/sim with an official result for all its
//     recipes, not listed in known-differences.json (or listed and marked "accepted" in the json);
//   - an "asm" proof names a run of the assembler corpus with an official result;
//   - a "test" proof names a file that exists and contains the title fragment.
//
// Whether the named tests pass is shown by the runs they belong to (npm run test:conformance,
// npm test, node --test in engine/sim and engine/asm, and in CI the jobs conformance and unit); this
// script proves that they exist and that the list is complete. Exit code 1 when an item is not
// proved (verdict partial or none), or when a proof does not exist. No browser, no network, a
// second. Evidence for docs/integration/rc.md item 2 (I3); it changes nothing.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const list = JSON.parse(readFileSync(new URL('./item-02-checklists.json', import.meta.url), 'utf8'));
const simDir = join(repo, 'tests', 'conformance', 'sim');
const { listPrograms, loadGoldenManifest, recipeId } = await import(pathToFileURL(join(simDir, 'programs.ts')).href);
const programs = new Map(listPrograms().map((p) => [p.id, p]));
const goldens = loadGoldenManifest();
const knownSim = JSON.parse(readFileSync(join(simDir, 'known-differences.json'), 'utf8'));
const corpus = JSON.parse(readFileSync(join(repo, 'tests', 'corpus', 'manifest.json'), 'utf8'));
const spec = (name) => readFileSync(join(repo, 'docs', 'porting', name), 'utf8');
const problems = [];

/** The lines of a section of a spec, from its heading to the next heading of the same level. */
function section(text, heading) {
  const start = text.indexOf(heading);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}
const expected = {
  'trap15-a 13': section(spec('trap15-tasks-0-59.md'), '## 13. Conformance checks')
    .split('\n')
    .filter((l) => l.startsWith('- ')).length,
  'hardware 13': section(spec('hardware.md'), '## 13. Conformance checklist')
    .split('\n')
    .filter((l) => /^\d+\. /.test(l)).length,
  'sim-ui 19 (affects program results)': section(spec('sim-ui.md'), '## 19. Register of quirks')
    .split('\n')
    .filter((l) => /^\| Q\d+ \|/.test(l))
    .filter((l) => !/^\s*(No\b|Debugger only|Display only)/.test(l.split('|')[3] ?? '')).length,
};

function checkProof(proof) {
  if (proof.program) {
    const p = programs.get(proof.program);
    if (!p) return `program ${proof.program} does not exist`;
    for (const r of p.recipes) {
      const id = recipeId(r);
      if (goldens?.programs[p.id]?.recipes?.[id]?.status !== 'ok')
        return `program ${p.id} has no official result for ${id}`;
      const listed = Object.keys(knownSim).some((k) => k.startsWith(`${p.id}|${id}|`));
      if (listed && !proof.accepted)
        return `program ${p.id} (${id}) differs from the official result (known-differences.json)`;
    }
    return null;
  }
  if (proof.asm) {
    const p = corpus.programs.find((x) => x.id === proof.asm);
    if (!p) return `assembler program ${proof.asm} does not exist`;
    if (!Object.values(p.runs).some((r) => r.status === 'ok'))
      return `assembler program ${proof.asm} has no official result`;
    return null;
  }
  if (proof.test) {
    const path = join(repo, proof.test);
    if (!existsSync(path)) return `test file ${proof.test} does not exist`;
    if (!readFileSync(path, 'utf8').includes(proof.title)) return `${proof.test} has no test titled "${proof.title}"`;
    return null;
  }
  return `unknown proof ${JSON.stringify(proof)}`;
}

let notProved = 0;
for (const l of list.lists) {
  const counts = { proved: 0, partial: 0, none: 0, manual: 0 };
  const open = [];
  for (const item of l.items) {
    counts[item.verdict] = (counts[item.verdict] ?? 0) + 1;
    for (const proof of item.proofs) {
      const problem = checkProof(proof);
      if (problem) problems.push(`${l.name} ${item.id}: ${problem}`);
    }
    if (item.verdict === 'proved' && item.proofs.length === 0)
      problems.push(`${l.name} ${item.id}: proved without a proof`);
    if (item.verdict !== 'proved') open.push(`${item.id} (${item.verdict}${item.note ? `: ${item.note}` : ''})`);
  }
  if (expected[l.name] !== l.items.length)
    problems.push(`${l.name}: the spec has ${expected[l.name]} items, the list ${l.items.length}`);
  notProved += open.length;
  console.log(
    `${l.name}: ${l.items.length} items (spec: ${expected[l.name]}); proved ${counts.proved}, partial ${counts.partial}, none ${counts.none}${counts.manual ? `, manual ${counts.manual}` : ''}`,
  );
  for (const o of open) console.log(`   not proved: ${o}`);
}
for (const p of problems) console.log(`PROBLEM ${p}`);
console.log(problems.length === 0 ? 'every named proof exists' : `${problems.length} proofs do not hold`);
process.exit(problems.length === 0 && notProved === 0 ? 0 : 1);
