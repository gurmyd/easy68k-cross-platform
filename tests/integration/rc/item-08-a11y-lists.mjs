// Release candidate, ARCHITECTURE.md 6.9 item 8 ("Accessibility: the automated scan has no serious
// finding; the manual list is signed off"), as corrected by erratum X1 8. Owner: I3.
//
//   node tests/integration/rc/item-08-a11y-lists.mjs [--log <check-a11y output>]... [--e2e-log <playwright output>]...
//
// No browser. It reads what excuses a serious finding today and says why, and checks that the
// lists are what docs/integration/rc.md says they are:
//
//   - `ALLOWED` of tests/e2e/app/a11y.spec.ts (X1): erratum X1 8 allows exactly one entry,
//     color-contrast on text drawn in a syntax colour of the original;
//   - `KNOWN` and `KNOWN_CHECKS` of tests/a11y/lib/findings.mjs (Q1): empty since the six findings
//     Q1-1 to Q1-6 were repaired; `KNOWN_DROPPED_LABEL` is the check of the former Q1-6, not an excuse;
//   - docs/integration/rc.md marks each of Q1-1 to Q1-6 "**Repaired**".
//
// With --log (the output of `npm run check:a11y`, or a CI job log of the group accessibility
// fetched with `gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`) it also reads the run: its
// "N of N checks passed" lines, no FAIL, nothing printed as "known", and the check that proves each
// of Q1-1 to Q1-6 passing in every browser the log covers. With --e2e-log (the output of
// `npx playwright test ... tests/e2e/app/a11y.spec.ts`, or a CI e2e job log) it counts the
// a11y.spec.ts tests that passed and failed.
//
// Exit code 0 = everything checked holds. "The manual list is signed off" is a person's part and
// is not checked here: it is open until a person has done docs/MANUAL-TEST-MAC.md B7 (V1-V9).

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN, KNOWN_CHECKS, KNOWN_DROPPED_LABEL } from '../../a11y/lib/findings.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const many = (name) => args.flatMap((arg, i) => (args[i - 1] === name ? [resolve(arg)] : []));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
};
// GitHub's job logs start every line with a time stamp and may carry colour codes.
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const clean = (text) =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(COLOUR, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ''));

// --- ALLOWED of the end-to-end scan --------------------------------------------------------------
console.log('[the lists]');
const spec = readFileSync(join(repoRoot, 'tests', 'e2e', 'app', 'a11y.spec.ts'), 'utf8');
const block = spec.slice(spec.indexOf('const ALLOWED'), spec.indexOf('];', spec.indexOf('const ALLOWED')));
const allowed = [...block.matchAll(/rule:\s*'([^']+)'[\s\S]*?owner:\s*'([^']+)'[\s\S]*?reason:\s*'([^']+)'/g)].map(
  (m) => ({
    rule: m[1],
    owner: m[2],
    reason: m[3],
  }),
);
for (const entry of allowed) console.log(`  --   ALLOWED: ${entry.rule}, owner ${entry.owner}: ${entry.reason}`);
check(
  'tests/e2e/app/a11y.spec.ts ALLOWED holds exactly the one entry of erratum X1 8 (color-contrast on syntax colours)',
  allowed.length === 1 && allowed[0].rule === 'color-contrast' && /syntax colour/.test(allowed[0].reason),
  `${allowed.length} entr${allowed.length === 1 ? 'y' : 'ies'}`,
);

// --- KNOWN and KNOWN_CHECKS of the audit ---------------------------------------------------------
for (const entry of KNOWN) console.log(`  --   KNOWN: ${entry.id} ${entry.rule} (${entry.owner}): ${entry.summary}`);
for (const entry of KNOWN_CHECKS) console.log(`  --   KNOWN_CHECKS: ${entry.id} ${entry.match} (${entry.owner})`);
check(
  'tests/a11y/lib/findings.mjs KNOWN is empty (no axe finding is excused as a known defect)',
  KNOWN.length === 0,
  `${KNOWN.length} entries`,
);
check(
  'tests/a11y/lib/findings.mjs KNOWN_CHECKS is empty (no failing audit check is excused)',
  KNOWN_CHECKS.length === 0,
  `${KNOWN_CHECKS.length} entries`,
);
console.log(
  `  --   KNOWN_DROPPED_LABEL ${KNOWN_DROPPED_LABEL}: the element of the former Q1-6, judged by its own check "the File Split digits of EASyBIN have a name that is read" (not an excuse)`,
);

// --- rc.md: Q1-1 to Q1-6 -------------------------------------------------------------------------
const rc = readFileSync(join(repoRoot, 'docs', 'integration', 'rc.md'), 'utf8');
for (let n = 1; n <= 6; n += 1) {
  const start = rc.indexOf(`### Q1-${n} `);
  const end = rc.indexOf('\n### ', start + 1);
  const section = start < 0 ? '' : rc.slice(start, end < 0 ? undefined : end);
  const title = section.split('\n')[0].replace(/^### /, '');
  check(`docs/integration/rc.md: ${title || `Q1-${n} (missing)`} is marked repaired`, /\*\*Repaired\*\*/.test(section));
}

// --- logs of the audit ---------------------------------------------------------------------------
/** The check of check-a11y.mjs that proves each finding repaired (docs/integration/rc.md). */
const PROOF = {
  'Q1-1': /dialog files\.name: the focus returns to where it was/,
  'Q1-2': /walk-run: after Execute the focus is in a panel of Simulator mode/,
  'Q1-3': /the Messages panel of Editor mode has a polite log region for the assembler's messages/,
  'Q1-4': /a row with a breakpoint says so to a screen reader/,
  'Q1-5': /a halt is announced by a live region/,
  'Q1-6': /the File Split digits of EASyBIN have a name that is read/,
};
for (const file of many('--log')) {
  console.log(`\n[check-a11y log ${file}]`);
  const lines = clean(readFileSync(file, 'utf8'));
  const totals = lines.filter((line) => /^\d+ of \d+ checks passed/.test(line));
  check(
    'the audit printed its totals, each "N of N checks passed"',
    totals.length > 0 && totals.every((line) => /^(\d+) of \1 checks passed\.?$/.test(line)),
    totals.join(' | '),
  );
  const fails = lines.filter((line) => /^\s+FAIL /.test(line));
  check('no check failed', fails.length === 0, fails.slice(0, 3).join(' | '));
  const known = lines.filter((line) => /^\s+known /.test(line));
  check('nothing was printed as "known"', known.length === 0, known.slice(0, 3).join(' | '));
  const browsers = ['chromium', 'webkit'].filter((browser) =>
    lines.some((line) => line.includes(` ${browser} `) || line.includes(` ${browser}/`)),
  );
  for (const [id, pattern] of Object.entries(PROOF)) {
    for (const browser of browsers) {
      const hits = lines.filter((line) => pattern.test(line) && new RegExp(`\\b${browser}\\b`).test(line));
      const ok = hits.length > 0 && hits.every((line) => /^\s+ok /.test(line));
      check(
        `${id}: its check passes in ${browser}`,
        ok,
        `${hits.filter((l) => /^\s+ok /.test(l)).length} of ${hits.length} runs ok`,
      );
    }
  }
}

// --- logs of the end-to-end scan -----------------------------------------------------------------
for (const file of many('--e2e-log')) {
  console.log(`\n[end-to-end log ${file}]`);
  const lines = clean(readFileSync(file, 'utf8')).filter((line) => /a11y\.spec\.ts/.test(line));
  const ok = lines.filter((line) => /^\s*(✓|ok)\s/.test(line));
  const bad = lines.filter((line) => /^\s*(✘|x)\s/.test(line));
  check(
    'tests/e2e/app/a11y.spec.ts: every test that ran passed',
    ok.length > 0 && bad.length === 0,
    `${ok.length} passed, ${bad.length} failed`,
  );
}

console.log(`\n${passed} of ${passed + failed} checks passed${failed ? `, ${failed} failed` : ''}.`);
console.log('Open for a person: "the manual list is signed off" (docs/MANUAL-TEST-MAC.md B7, V1-V9, and X4).');
process.exitCode = failed ? 1 : 0;
