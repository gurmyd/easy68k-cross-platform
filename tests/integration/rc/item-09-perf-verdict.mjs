// Release candidate, ARCHITECTURE.md 6.9 item 9 ("Performance, measured by tests/perf/ in Chromium on
// ubuntu-latest"), with errata P1 1 to P1 4, P1 10 and P1 13. Owner: I3.
//
//   node tests/integration/rc/item-09-perf-verdict.mjs <log> [--rule document|as-printed] [--require-ubuntu]
//
// No browser, no measurement of its own. It reads the output of tests/perf/check-perf.mjs - a local
// run (`npm run check:perf -- --browser chromium > perf.log`) or a CI job log of the job
// `perf (ubuntu-latest, chromium)` of ci.yml, fetched with
//   gh api repos/gurmyd/easy68k-cross-platform/actions/jobs/<job id>/logs > perf.log
// - and judges the four thresholds of item 9 from the figures printed there (the best run of
// each, as check-perf.mjs judges):
//
//   1. TaskDuration: spin.X68 at the default speed, 30 s, the 60 Hz frame source: < 4.5 s
//      (judged at 60 Hz, printed at 120 Hz: erratum P1 3);
//   2. frame intervals while draw.X68 runs: p95 < 20 ms with the 60 Hz source, < 12 ms with 120 Hz;
//   3. Maximum, spin.X68 for 10 s, judged with the 60 Hz frame source (the 120 Hz one is printed;
//      erratum P1 13):
//        --rule document (default)   the rule of the document: at least 100 million AND at least
//                                    85 % of what the engine alone executes in 5 s on the same
//                                    runner in the same job (6.9 item 9 with the architect's
//                                    correction note of 22 November 2026, erratum P1 13; the figure
//                                    of "the engine alone" is check-perf.mjs's summary line "the
//                                    engine alone, the best of N blocks of 5 s: R instructions per
//                                    second", R x 5; a log without that line misses);
//        --rule as-printed           at least 200 million (the bullet's figure before the note; for
//                                    information only, it is not the rule);
//      (--rule corrected is accepted as another name of document.) Both are always printed;
//   4. assembling the largest corpus file under Node: < 1 s, as GFX.X68 alone and as MAIN.X68 with
//      its includes (erratum P1 4).
//
// Where the log comes from is printed (a GitHub log names its runner image). 6.9 sets the
// thresholds for Chromium on ubuntu-latest only; elsewhere the verdicts are for information.
// --require-ubuntu fails unless the log is a GitHub log of an Ubuntu runner and a full run (all
// parts, not the `--only calibrate --only surface` of a push).
//
// Exit code 0 = every threshold holds under the chosen rule (and, with --require-ubuntu, the log is
// the right one); 1 = a threshold misses or a figure is missing; 2 = wrong arguments.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const file = args.find((arg, i) => !arg.startsWith('--') && !['--rule'].includes(args[i - 1]));
const rule = option('--rule', 'document').replace(/^corrected$/, 'document');
if (!file || !['document', 'as-printed'].includes(rule)) {
  console.error(
    'usage: node tests/integration/rc/item-09-perf-verdict.mjs <log> [--rule document|as-printed] [--require-ubuntu]',
  );
  process.exit(2);
}

// GitHub's job logs start every line with a time stamp and may carry colour codes.
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const lines = readFileSync(file, 'utf8')
  .replace(/\r/g, '')
  .split('\n')
  .map((line) => line.replace(COLOUR, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ''));

const number = (text) => Number(text.replace(/,/g, ''));
/** The first line matching every pattern, and the value of `value` in it. */
function figure(patterns, value) {
  const line = lines.find((l) => patterns.every((p) => p.test(l)));
  const match = line?.match(value);
  return match ? { value: number(match[1]), line: line.trim() } : null;
}

let failed = 0;
let judged = 0;
const verdict = (name, found, ok, needs) => {
  judged += 1;
  if (!found) {
    failed += 1;
    console.log(`  MISSING ${name}: no such figure in the log`);
    return;
  }
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'holds' : 'MISSES'}  ${name}: ${found} (needs ${needs})`);
};

// --- where the log comes from --------------------------------------------------------------------
const image = lines.find((l) => /^\s*Image: /.test(l))?.trim() ?? null;
const os = lines.find((l) => /^\s*(Ubuntu|macOS|Microsoft Windows)/.test(l))?.trim() ?? null;
const command = lines.find((l) => /node tests\/perf\/check-perf\.mjs/.test(l))?.trim() ?? null;
const full = command ? !/--only/.test(command) : lines.some((l) => /\[chromium, Maximum/.test(l));
const ubuntu = Boolean(image && /ubuntu/i.test(image));
console.log(`log: ${file}`);
console.log(`  runner: ${image ?? 'not a GitHub log (no "Image:" line)'}${os ? `, ${os}` : ''}`);
console.log(
  `  command: ${command ?? '(not printed)'}; ${full ? 'every part' : 'NOT every part (the thresholds are not measured)'}`,
);
console.log(`  rule for Maximum: ${rule}`);

// --- 1. TaskDuration -----------------------------------------------------------------------------
console.log('\n[1] TaskDuration over 30 s of spin.X68 at the default speed (Chromium)');
const td60 = figure(
  [/chromium: spin\.X68 at the default speed with the 60 Hz frame source: TaskDuration/],
  /best ([\d.]+) s/,
);
const td120 = figure(
  [/chromium: spin\.X68 at the default speed with the 120 Hz frame source: TaskDuration/],
  /best ([\d.]+) s/,
);
verdict('60 Hz frame source', td60 && `${td60.value} s`, td60 && td60.value < 4.5, '< 4.5 s');
console.log(
  `  --     120 Hz frame source (printed, not judged; erratum P1 3): ${td120 ? `${td120.value} s` : 'not printed'}`,
);

// --- 2. frames -----------------------------------------------------------------------------------
console.log('\n[2] Frame intervals while draw.X68 runs, 95th percentile (Chromium)');
const f60 = figure([/chromium: frame intervals while draw\.X68 runs, the 60 Hz frame source/], /best ([\d.]+) ms p95/);
const f120 = figure(
  [/chromium: frame intervals while draw\.X68 runs, the 120 Hz frame source/],
  /best ([\d.]+) ms p95/,
);
verdict('60 Hz frame source', f60 && `${f60.value} ms`, f60 && f60.value < 20, '< 20 ms');
verdict('120 Hz frame source', f120 && `${f120.value} ms`, f120 && f120.value < 12, '< 12 ms');

// --- 3. Maximum ----------------------------------------------------------------------------------
console.log('\n[3] engine.stepCount at Maximum in 10 s, spin.X68 (Chromium)');
const m60 = figure(
  [/chromium: spin\.X68 at Maximum with the 60 Hz frame source: at least/],
  /best ([\d,]+) instructions/,
);
const m120 = figure(
  [/chromium: spin\.X68 at Maximum with the 120 Hz frame source: at least/],
  /best ([\d,]+) instructions/,
);
// check-perf.mjs (since the fixup of round 5) measures two 5 s blocks of the engine alone, one before
// and one after the 60 Hz Maximum runs, and prints the better one on this summary line.
const alone = figure(
  [/chromium: the engine alone, the best of \d+ blocks? of 5 s/],
  /: ([\d,]+) instructions per second/,
);
const inFive = alone ? alone.value * 5 : null;
const floor = inFive ? Math.ceil(0.85 * inFive) : null;
const fmt = (n) => n.toLocaleString('en-US');
console.log(
  `  --     the engine alone: ${alone ? `${fmt(alone.value)} per second, so ${fmt(inFive)} in 5 s; 85 % of that: ${fmt(floor)}` : 'not printed'}`,
);
for (const [name, m] of [
  ['60 Hz frame source', m60],
  ['120 Hz frame source', m120],
]) {
  const printed = m ? m.value >= 200_000_000 : false;
  const doc = m && floor ? m.value >= 100_000_000 && m.value >= floor : false;
  const shortPrinted = m && !printed ? `, short by ${fmt(200_000_000 - m.value)}` : '';
  console.log(
    `  --     ${name}: ${m ? fmt(m.value) : 'not printed'}; the document's rule (>= 100,000,000 and >= ${floor ? fmt(floor) : '?'}): ${doc ? 'holds' : 'misses'}; the figure as printed before the note (>= 200,000,000, information): ${printed ? 'holds' : 'misses'}${shortPrinted}`,
  );
  // Erratum P1 13: the 60 Hz source is judged, the 120 Hz source printed.
  if (name.startsWith('60'))
    verdict(
      `${name} (${rule} rule)`,
      m && fmt(m.value),
      rule === 'as-printed' ? printed : doc,
      rule === 'as-printed'
        ? '>= 200,000,000'
        : `>= 100,000,000 and >= ${floor ? fmt(floor) : '85 % of the engine alone in 5 s (its line is missing)'}`,
    );
}

// --- 4. assembly ---------------------------------------------------------------------------------
console.log('\n[4] Assembling the largest corpus file under Node');
const gfx = figure([/assembling .*GFX\.X68, [\d,]+ bytes, takes less than a second/], /best (\d[\d,]*) ms/);
const main = figure([/assembling .*MAIN\.X68, which includes it/], /best (\d[\d,]*) ms/);
verdict('GFX.X68 alone', gfx && `${gfx.value} ms`, gfx && gfx.value < 1000, '< 1,000 ms');
verdict('MAIN.X68 with its includes', main && `${main.value} ms`, main && main.value < 1000, '< 1,000 ms');

// --- result --------------------------------------------------------------------------------------
if (args.includes('--require-ubuntu')) {
  judged += 1;
  const ok = ubuntu && full;
  if (!ok) failed += 1;
  console.log(`\n  ${ok ? 'holds' : 'MISSES'}  the log is a full run on GitHub's ubuntu-latest runner`);
}
console.log(
  `\n${judged - failed} of ${judged} verdicts hold${failed ? `, ${failed} do not` : ''} (Maximum by the ${rule} rule).`,
);
if (!ubuntu)
  console.log(
    'Not a log of ubuntu-latest: 6.9 item 9 sets these thresholds there only; these verdicts are for information.',
  );
process.exitCode = failed ? 1 : 0;
