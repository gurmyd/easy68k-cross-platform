// Release candidate (ARCHITECTURE.md 6.9, package I3), item 2 "Simulator": the counts and the two
// coverage lists the item asks for, made mechanically from the repository and the engines.
//
//   EASY68K_SIM_REPORT_JSON=<sim.json> npx vitest run --config tests/conformance/sim/vitest.config.ts \
//     --reporter=default --reporter=json --outputFile.json=<vitest.json>
//   node tests/integration/rc/item-02-sim-evidence.mjs --sim-report <sim.json> [--sim-vitest <vitest.json>] [--json <file>]
//
// (npm run check:rc runs both.) Needs engine/dist (the port's assembler assembles every program to
// find what it contains) and nothing else: no browser, no Docker, no network. Takes about a minute.
// It prints, and with --json also writes:
//
//   1. the self-reporting conformance programs (recipe "report" in tests/conformance/sim, header
//      "@recipe"), how many have an official result (golden/manifest.json) and how many of those the
//      port reproduces byte for byte: taken from the comparison's own result (--sim-report, the file
//      conformance.test.ts writes with EASY68K_SIM_REPORT_JSON: what it compared, and every
//      difference it measured), not from the list of known differences (review of the
//      release-candidate check: counting "the programs not listed" would pass with entries deleted
//      from the list and nothing repaired). A measured difference that known-differences.json does
//      not list counts against the item; a listed one the run found equal makes the list stale;
//   2. the execution logs (recipes "log:N" and "log:N+out"): the runs, and the instructions in them,
//      counted as the "PC=" lines of the official logs in golden/logs (not taken from the manifest),
//      and which of them the comparison found identical (from --sim-report, as in 1);
//   3. coverage of the 87 entries of the instruction table of sim-core 3.16 by the self-reporting
//      programs: every program is assembled with the port's assembler (engine/asm), and the first
//      word of every instruction line of the program's own source (dumplib.X68 left out) is decoded
//      with the table's own rule (first match within the opcode's group, i.e. its top four bits).
//      Words written as DC.W are listed apart: they may be opcodes on purpose or data;
//   4. coverage of the TRAP #15 tasks: a TRAP #15 in a program's own source counts for the task
//      whose number the program last loaded into D0 by an immediate (MOVEQ, MOVE.B/W/L #n,D0; only
//      D0.B counts), and for task 32 also the sub-task last loaded into D1 the same way. A task number
//      computed at run time is not seen (stated as a limit, not hidden).
//
// Before these, part 0 sorts the entries of known-differences.json as the correction note of 6.9
// item 2 does (erratum T3 14): accepted, unconfirmed, or counted against the item.
//
// The exit code is 1 when the first two parts of item 2 do not hold as the item reads today: an
// entry of known-differences.json that is neither accepted nor unconfirmed (it counts against the
// item), an accepted one that docs/DIFFERENCES.md does not name, an unconfirmed one that its part 4
// does not name, fewer than 150 self-reporting programs or one without an official result, fewer
// than 20 identical execution logs or 100,000 instructions in them, a table entry or a
// non-interactive task (erratum T3 11) that no self-reporting program contains; with --sim-report,
// a measured difference that is not listed, a listed one found equal, a report of a partial run
// (EASY68K_SIM_ONLY), of the doubles, or older than engine/dist or the goldens; with --sim-vitest
// (Vitest's JSON report of the same run), a failed test of that run. Exit code 2 when nothing of
// that fails but no --sim-report was given: then the identical programs are not shown. The third
// part (the checklists) is item-02-checklists.mjs. Evidence for docs/integration/rc.md item 2
// (I3); it changes nothing.

import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const simDir = join(repo, 'tests', 'conformance', 'sim');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const jsonOut = option('--json');
const simReportPath = option('--sim-report');
const simVitestPath = option('--sim-vitest');

for (const f of ['asm68k.wasm', 'asm68k-loader.mjs']) {
  if (!existsSync(join(repo, 'engine', 'dist', f))) {
    console.error(`engine/dist/${f} is missing: run npm run build:engines (or fetch:engines) first.`);
    process.exit(2);
  }
}

const { ARTIFACT_MASKS, listPrograms, loadGoldenManifest, recipeId } = await import(
  pathToFileURL(join(simDir, 'programs.ts')).href
);
const asm = await import(pathToFileURL(join(repo, 'engine', 'asm', 'asm68k.mjs')).href);

const programs = listPrograms();
const manifest = loadGoldenManifest();
const known = JSON.parse(
  readFileSync(process.env.EASY68K_RC_KNOWN_SIM ?? join(simDir, 'known-differences.json'), 'utf8'),
);
const fails = [];

// ---------------------------------------------------------------- 0. the listed differences
// The correction note of 6.9 item 2 (erratum T3 14) sorts every entry of known-differences.json
// into one of three classes: accepted (the cause is known and recorded; the summary begins
// "Accepted difference"; named in docs/DIFFERENCES.md), unconfirmed (an "unconfirmed" field; named
// under part 4 "Not yet confirmed against the original"; an open item of item 11) and everything
// else, which counts against item 2. EASY68K_RC_KNOWN_SIM=<file> and EASY68K_RC_DIFFERENCES=<file>
// read other copies (to show that the judge fails when the input is broken).
const differencesMd = readFileSync(
  process.env.EASY68K_RC_DIFFERENCES ?? join(repo, 'docs', 'DIFFERENCES.md'),
  'utf8',
).replace(/\r\n?/g, '\n');
const part4Start = differencesMd.indexOf('\n## 4. Not yet confirmed against the original');
const part4 = part4Start < 0 ? '' : differencesMd.slice(part4Start, differencesMd.indexOf('\n## 5.', part4Start));
if (part4Start < 0) fails.push('docs/DIFFERENCES.md has no part "## 4. Not yet confirmed against the original"');
/** @returns {'accepted' | 'unconfirmed' | 'against'} */
function classOf(entry) {
  if (entry.unconfirmed) return 'unconfirmed';
  if (/^Accepted difference/.test(entry.summary ?? '')) return 'accepted';
  return 'against';
}
const listed = Object.entries(known).map(([key, entry]) => {
  const id = key.split('|')[0];
  const cls = classOf(entry);
  const named = cls === 'unconfirmed' ? part4.includes(id) : differencesMd.includes(id);
  return { key, id, cls, named };
});
console.log('0. Listed differences (tests/conformance/sim/known-differences.json, erratum T3 14):');
for (const l of listed)
  console.log(
    `   ${l.cls.padEnd(11)} ${l.key}${l.named ? '' : `  - NOT named in docs/DIFFERENCES.md${l.cls === 'unconfirmed' ? ' part 4' : ''}`}`,
  );
for (const l of listed) {
  if (l.cls === 'against') fails.push(`${l.key} differs from its golden and is neither accepted nor unconfirmed`);
  else if (!l.named)
    fails.push(
      `${l.key} is ${l.cls} but docs/DIFFERENCES.md does not name it${l.cls === 'unconfirmed' ? ' under part 4' : ''}`,
    );
}
const classOfKey = (key) => listed.find((l) => l.key === key)?.cls ?? null;

// ---------------------------------------------------------------- the comparison's own result
// conformance.test.ts writes, with EASY68K_SIM_REPORT_JSON, what it compared and every difference
// it measured (compare.ts mismatchRecords: state "measured", or "pending" for a listed entry without
// an official result). Without it, nothing here is compared and the identical programs are not shown.
let comparison = null;
if (simReportPath) {
  const data = JSON.parse(readFileSync(simReportPath, 'utf8'));
  const written = new Date(data.written ?? 0);
  const measured = new Set(
    (data.mismatches ?? []).filter((m) => m.state === 'measured').map((m) => `${m.program}|${m.recipe}|${m.artifact}`),
  );
  comparison = { data, written, measured, notCompared: new Set(data.notCompared ?? []) };
  console.log(
    `The comparison (${simReportPath}): written ${written.toISOString()}, ${data.programs} programs, ${data.artifactsCompared} artifacts compared, ${data.equal} equal, ${measured.size} measured differences, ${comparison.notCompared.size} recipes not compared; ${data.parts}`,
  );
  if (data.programs !== programs.length)
    fails.push(
      `the comparison ran ${data.programs} of the ${programs.length} programs (EASY68K_SIM_ONLY?): run the whole sim project`,
    );
  if (data.parts !== 'the classes at their final paths')
    fails.push(`the comparison ran with ${data.parts}, not the classes at their final paths`);
  if (data.equal + measured.size !== data.artifactsCompared)
    fails.push(
      `the comparison's counts do not add up: ${data.equal} equal + ${measured.size} differences != ${data.artifactsCompared} compared`,
    );
  for (const input of [
    'engine/dist/sim68k.wasm',
    'engine/dist/asm68k.wasm',
    'tests/conformance/sim/golden/manifest.json',
    'tests/conformance/sim/known-differences.json',
  ]) {
    const at = join(repo, input);
    if (existsSync(at) && statSync(at).mtime > written)
      fails.push(`the comparison was written before ${input} changed: run the sim project again`);
  }
  // Every measured difference must be listed, and every listed one (of a compared run, not one whose
  // bytes ARTIFACT_MASKS masks) must have been measured.
  for (const key of measured)
    if (!known[key])
      fails.push(
        `${key} differs from its golden (measured by the comparison) and known-differences.json does not list it`,
      );
  for (const l of listed) {
    const [id, recipe] = l.key.split('|');
    if (!measured.has(l.key) && !ARTIFACT_MASKS[l.key] && !comparison.notCompared.has(`${id}:${recipe}`))
      fails.push(`${l.key} is listed in known-differences.json, but the comparison found it equal (the list is stale)`);
  }
}
if (simVitestPath) {
  const run = JSON.parse(readFileSync(simVitestPath, 'utf8'));
  const failed = (run.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).filter((a) => a.status === 'failed').map((a) => a.fullName ?? a.title),
  );
  console.log(
    `The comparison's Vitest run (${simVitestPath}): ${run.numPassedTests} passed, ${run.numFailedTests} failed, ${run.numPendingTests} skipped of ${run.numTotalTests}`,
  );
  if (run.numFailedTests > 0 || failed.length > 0 || run.success === false)
    fails.push(
      `the comparison's run did not pass: ${run.numFailedTests} failed${failed.length ? ` (${failed.slice(0, 5).join('; ')})` : ''}`,
    );
}
/** compared: the comparison ran it; differs: it measured a difference. Null without --sim-report. */
const compared = (id, recipe, kind) =>
  comparison === null
    ? null
    : !comparison.notCompared.has(`${id}:${recipe}`) && {
        differs: comparison.measured.has(`${id}|${recipe}|${kind}`),
      };

// ---------------------------------------------------------------- 1. self-reporting programs
const reporting = programs.filter((p) => p.recipes.some((r) => recipeId(r) === 'report'));
const withGolden = reporting.filter((p) => manifest?.programs[p.id]?.recipes?.report?.status === 'ok');
const withoutGolden = reporting.filter((p) => !withGolden.includes(p));
// With the comparison: the programs it measured as differing; without it, the list (printed as such).
const listedReport = withGolden.filter((p) =>
  comparison ? compared(p.id, 'report', 'result')?.differs : known[`${p.id}|report|result`],
);
const notComparedReport = comparison ? withGolden.filter((p) => compared(p.id, 'report', 'result') === false) : [];
const reproduced = comparison ? withGolden.length - listedReport.length - notComparedReport.length : null;
const byClass = { accepted: [], unconfirmed: [], against: [] };
for (const p of listedReport) byClass[classOfKey(`${p.id}|report|result`) ?? 'against'].push(p.id);
if (notComparedReport.length > 0)
  fails.push(
    `self-reporting programs with an official result that the comparison did not compare: ${notComparedReport.map((p) => p.id).join(', ')}`,
  );
const bySuite = {};
for (const p of reporting) bySuite[p.suite] = (bySuite[p.suite] ?? 0) + 1;
console.log(
  `1. Self-reporting programs: ${reporting.length} (${Object.entries(bySuite)
    .map(([s, n]) => `${s} ${n}`)
    .join(', ')})`,
);
console.log(
  comparison
    ? `   with an official result: ${withGolden.length}; result.bin byte-identical, as the comparison measured: ${reproduced}; differing: ${listedReport.length}`
    : `   with an official result: ${withGolden.length}; NOT COMPARED here (no --sim-report): listed as differing in known-differences.json ${listedReport.length}; the identical ones are not shown`,
);
console.log(`   accepted differences (do not count against the item): ${byClass.accepted.join(', ') || 'none'}`);
console.log(
  `   unconfirmed goldens (do not count against item 2; open items of item 11): ${byClass.unconfirmed.join(', ') || 'none'}`,
);
console.log(`   COUNTED AGAINST ITEM 2: ${byClass.against.join(', ') || 'none'}`);
if (comparison)
  console.log(
    `   produce the golden or an accepted or unconfirmed difference: ${reproduced + byClass.accepted.length + byClass.unconfirmed.length} of ${reporting.length}`,
  );
if (reporting.length < 150) fails.push(`only ${reporting.length} self-reporting programs (150 required)`);
if (withoutGolden.length > 0)
  fails.push(`self-reporting programs without an official result: ${withoutGolden.map((p) => p.id).join(', ')}`);

// ---------------------------------------------------------------- 2. execution logs
const logRuns = [];
for (const p of programs) {
  for (const r of p.recipes) {
    if (r.kind !== 'log') continue;
    const rid = recipeId(r);
    const entry = manifest?.programs[p.id]?.recipes?.[rid];
    const golden = join(
      simDir,
      'golden',
      p.suite,
      `${p.name}.log${r.execType}${r.withOutput ? 'o' : ''}.RunLog.txt.gz`,
    );
    const text = existsSync(golden) ? gunzipSync(readFileSync(golden)).toString('latin1') : null;
    const counted = text === null ? 0 : (text.match(/(^|\n)PC=/g) ?? []).length;
    logRuns.push({
      id: p.id,
      recipe: rid,
      status: entry?.status ?? 'missing',
      instructions: counted,
      manifestInstructions: entry?.instructions ?? null,
      listedAsDiffering: Boolean(known[`${p.id}|${rid}|runlog`]),
      // With the comparison: true / false as measured, 'not compared'; without it: null.
      differs: (() => {
        const c = compared(p.id, rid, 'runlog');
        return c === null ? null : c === false ? 'not compared' : c.differs;
      })(),
    });
  }
}
const okLogs = logRuns.filter((l) => l.status === 'ok');
const totalInstr = okLogs.reduce((s, l) => s + l.instructions, 0);
const identicalLogs = comparison ? okLogs.filter((l) => l.differs === false) : [];
const identicalInstr = identicalLogs.reduce((s, l) => s + l.instructions, 0);
console.log(
  `2. Execution-log runs with an official log: ${okLogs.length} of ${logRuns.length}; instructions logged: ${totalInstr}`,
);
console.log(
  comparison
    ? `   byte-identical after masking the date, as the comparison measured: ${identicalLogs.length} runs, ${identicalInstr} instructions`
    : '   NOT COMPARED here (no --sim-report): the identical logs are not shown',
);
for (const l of logRuns) {
  const note = l.manifestInstructions !== l.instructions ? ` (manifest says ${l.manifestInstructions})` : '';
  const state =
    l.differs === true
      ? ' - differs'
      : l.differs === 'not compared'
        ? ' - not compared'
        : l.differs === null && l.listedAsDiffering
          ? ' - listed as differing'
          : '';
  console.log(`   ${l.id} ${l.recipe}: ${l.instructions}${note}${state}`);
}
if (comparison) {
  if (identicalLogs.length < 20) fails.push(`only ${identicalLogs.length} identical execution logs (20 required)`);
  if (identicalInstr < 100_000)
    fails.push(`execution logs total ${identicalInstr} instructions, ${100_000 - identicalInstr} short of 100,000`);
}

// ---------------------------------------------------------------- 3. instruction table (sim-core 3.16)
// [index, mask, val, name] exactly as the table of sim-core 3.16 (inst_arr), in index order.
const TABLE = [
  [0, 0x0000, 0x0a3c, 'EORI_TO_CCR'],
  [1, 0x0000, 0x0a7c, 'EORI_TO_SR'],
  [2, 0x0000, 0x003c, 'ORI_TO_CCR'],
  [3, 0x0000, 0x007c, 'ORI_TO_SR'],
  [4, 0x0000, 0x023c, 'ANDI_TO_CCR'],
  [5, 0x0000, 0x027c, 'ANDI_TO_SR'],
  [6, 0x0ec7, 0x0108, 'MOVEP'],
  [7, 0x00ff, 0x0200, 'ANDI'],
  [8, 0x00ff, 0x0000, 'ORI'],
  [9, 0x00ff, 0x0400, 'SUBI'],
  [10, 0x00ff, 0x0600, 'ADDI'],
  [11, 0x00ff, 0x0800, 'BIT_OP (static)'],
  [12, 0x00ff, 0x0a00, 'EORI'],
  [13, 0x00ff, 0x0c00, 'CMPI'],
  [14, 0x0eff, 0x0100, 'BIT_OP (dynamic)'],
  [15, 0x0fff, 0x1000, 'MOVEB'],
  [16, 0x0e3f, 0x2040, 'MOVEAL'],
  [17, 0x0fff, 0x2000, 'MOVEL'],
  [18, 0x0e3f, 0x3040, 'MOVEAW'],
  [19, 0x0fff, 0x3000, 'MOVEW'],
  [20, 0x0000, 0x4afc, 'ILLEGAL'],
  [21, 0x0000, 0x4e70, 'RESET'],
  [22, 0x0000, 0x4e71, 'NOP'],
  [23, 0x0000, 0x4e72, 'STOP'],
  [24, 0x0000, 0x4e73, 'RTE'],
  [25, 0x0000, 0x4e75, 'RTS'],
  [26, 0x0000, 0x4e76, 'TRAPV'],
  [27, 0x0000, 0x4e77, 'RTR'],
  [28, 0x0007, 0x4e50, 'LINK'],
  [29, 0x0007, 0x4e58, 'UNLK'],
  [30, 0x0007, 0x4e60, 'MOVE_TO_USP'],
  [31, 0x0007, 0x4e68, 'MOVE_FR_USP'],
  [32, 0x0007, 0x4840, 'SWAP'],
  [33, 0x0007, 0x4880, 'EXT (word)'],
  [34, 0x0007, 0x48c0, 'EXT (long)'],
  [35, 0x000f, 0x4e40, 'TRAP'],
  [36, 0x003f, 0x40c0, 'MOVE_FR_SR'],
  [37, 0x003f, 0x44c0, 'MOVE_TO_CCR'],
  [38, 0x003f, 0x46c0, 'MOVE_TO_SR'],
  [39, 0x003f, 0x4800, 'NBCD'],
  [40, 0x003f, 0x4840, 'PEA'],
  [41, 0x003f, 0x4ac0, 'TAS'],
  [42, 0x003f, 0x4e80, 'JSR'],
  [43, 0x003f, 0x4ec0, 'JMP'],
  [44, 0x007f, 0x4c80, 'MOVEM_TO_REG'],
  [45, 0x007f, 0x4880, 'MOVEM_TO_EA'],
  [46, 0x00ff, 0x4200, 'CLR'],
  [47, 0x00ff, 0x4000, 'NEGX'],
  [48, 0x00ff, 0x4400, 'NEG'],
  [49, 0x00ff, 0x4600, 'NOT'],
  [50, 0x00ff, 0x4a00, 'TST'],
  [51, 0x0e3f, 0x4180, 'CHK'],
  [52, 0x0e3f, 0x41c0, 'LEA'],
  [53, 0x0f07, 0x50c8, 'DBCC'],
  [54, 0x0f3f, 0x50c0, 'SCC'],
  [55, 0x0eff, 0x5100, 'SUBQ'],
  [56, 0x0eff, 0x5000, 'ADDQ'],
  [57, 0x00ff, 0x6000, 'BRA'],
  [58, 0x00ff, 0x6100, 'BSR'],
  [59, 0x0fff, 0x6000, 'BCC'],
  [60, 0x0eff, 0x7000, 'MOVEQ'],
  [61, 0x0e0f, 0x8100, 'SBCD'],
  [62, 0x0e3f, 0x80c0, 'DIVU'],
  [63, 0x0e3f, 0x81c0, 'DIVS'],
  [64, 0x0fff, 0x8000, 'OR'],
  [65, 0x0f3f, 0x90c0, 'SUBA'],
  [66, 0x0ecf, 0x9100, 'SUBX'],
  [67, 0x0fff, 0x9000, 'SUB'],
  [68, 0x0fff, 0xa000, 'LINE_1010'],
  [69, 0x0f3f, 0xb0c0, 'CMPA'],
  [70, 0x0ec7, 0xb108, 'CMPM'],
  [71, 0x0eff, 0xb000, 'CMP'],
  [72, 0x0eff, 0xb100, 'EOR'],
  [73, 0x0e07, 0xc140, 'EXG_D'],
  [74, 0x0e07, 0xc148, 'EXG_A'],
  [75, 0x0e07, 0xc188, 'EXG_D_AND_A'],
  [76, 0x0e0f, 0xc100, 'ABCD'],
  [77, 0x0e3f, 0xc1c0, 'MULS'],
  [78, 0x0e3f, 0xc0c0, 'MULU'],
  [79, 0x0fff, 0xc000, 'AND'],
  [80, 0x0f3f, 0xd0c0, 'ADDA'],
  [81, 0x0ecf, 0xd100, 'ADDX'],
  [82, 0x0fff, 0xd000, 'ADD'],
  [83, 0x073f, 0xe8c0, 'BIT_FIELD'],
  [84, 0x073f, 0xe0c0, 'SHIFT_ROT (memory)'],
  [85, 0x0fff, 0xe000, 'SHIFT_ROT (register)'],
  [86, 0x0fff, 0xf000, 'LINE_1111'],
];
function decode(word) {
  for (const [index, mask, val, name] of TABLE) {
    if (val >> 12 !== word >> 12) continue; // the group is the top four bits of the opcode
    if ((word & ~mask & 0xffff) === val) return { index, name };
  }
  return null;
}

// TRAP #15 tasks (trap15-a 1.2, trap15-b 2.1) and which of them need a person or a device.
const TASKS = [
  ...Array.from({ length: 26 }, (_, i) => i),
  30,
  31,
  32,
  33,
  40,
  41,
  42,
  43,
  ...Array.from({ length: 10 }, (_, i) => 50 + i),
  60,
  61,
  62,
  ...Array.from({ length: 8 }, (_, i) => 70 + i),
  ...Array.from({ length: 17 }, (_, i) => 80 + i),
  ...Array.from({ length: 8 }, (_, i) => 100 + i),
];
/**
 * Interactive: what the task returns needs a person or a device outside the simulator. Exactly the
 * table of erratum T3 11 as corrected after its review (entry 13): tasks 102-104, 106 and 107 are
 * interactive only after a task 100 or 101, and their paths before it have programs, so they count
 * as non-interactive here.
 */
const INTERACTIVE = {
  2: 'returns what a person types',
  4: 'returns what a person types',
  5: 'returns what a person types',
  18: 'returns what a person types',
  10: 'its only effect is on paper; it returns nothing a program can read',
  58: 'returns what a person chooses in the file dialog',
  61: 'reads the mouse',
  100: "depends on the machine's network",
  101: "depends on the machine's network",
};

const dumplibLines = readFileSync(join(simDir, 'dumplib.X68'), 'latin1').split(/\r\n|\n|\r/);
if (dumplibLines.at(-1) === '') dumplibLines.pop();
/**
 * A listing line: address and object code share columns 1-32 (assembler LISTING.CPP: address in
 * 1-8, code from 11), the line number is right-aligned in columns 33-38, the source starts at 41.
 * Returns [whole, address, code, line number, source] like a regular-expression match, or null.
 */
function listingLine(line) {
  if (!/^[0-9A-F]{8}[= ] /.test(line) || !/^ *\d+$/.test(line.slice(32, 38))) return null;
  return [line, line.slice(0, 8), line.slice(10, 32), line.slice(32, 38).trim(), line.slice(40)];
}

const entryCover = new Map(TABLE.map(([i]) => [i, []]));
const entryCoverDcw = new Map(TABLE.map(([i]) => [i, []]));
const taskCover = new Map(TASKS.map((t) => [t, []]));
const sub32Cover = new Map(Array.from({ length: 8 }, (_, i) => [i, []]));
const unknownTaskTraps = [];
const tableDrivenSeen = [];
/** Programs whose TRAP #15 takes D0 (task) or D1 (task 32 sub-task) from a DC.L table. */
const TABLE_DRIVEN = {
  'trap15-a/a45-settings-tasks-registers': { label: 'CASES', kind: 'task', stride: 2 },
  'trap15-a/a23-task32-values': { label: 'SUBS', kind: 'sub32', stride: 1 },
};

for (const p of reporting) {
  const files = { [p.source]: new Uint8Array(readFileSync(join(simDir, p.source))) };
  files['dumplib.X68'] = new Uint8Array(readFileSync(join(simDir, 'dumplib.X68')));
  for (const name of p.files) files[`${p.suite}/${name}`] = new Uint8Array(readFileSync(join(simDir, p.suite, name)));
  const result = await asm.assemble(p.source, files, {}, new Date(2026, 0, 1));
  if (result.errorCount > 0 || !result.listing) {
    fails.push(`${p.id} does not assemble (${result.errorCount} errors)`);
    continue;
  }
  const lines = Buffer.from(result.listing).toString('latin1').split(/\r\n/);
  let includeAt = null;
  let d0 = null;
  let d1 = null;
  let unknownHere = 0;
  const seenEntries = new Set();
  const seenDcw = new Set();
  const seenTasks = new Set();
  const seenSub = new Set();
  for (const line of lines) {
    const m = listingLine(line);
    if (!m) continue;
    const lineNo = Number(m[3]);
    const source = m[4];
    if (includeAt !== null && lineNo > includeAt && lineNo <= includeAt + dumplibLines.length) continue;
    if (/^\s*INCLUDE\s+['"]?\.\.[\\/]dumplib\.X68/i.test(source)) {
      includeAt = lineNo;
      continue;
    }
    const code = m[2].trim();
    if (code === '' || /^[*;]/.test(source)) continue;
    // The operation field: the first token after an optional label in column 1.
    const tokens = source.trim().split(/\s+/);
    const op = (/^\s/.test(source) ? tokens[0] : (tokens[1] ?? '')).toUpperCase();
    const words = code.replace(/\s+/g, '');
    if (op.startsWith('DC.W') || op === 'DC') {
      for (let i = 0; i + 4 <= words.length; i += 4) {
        const hit = decode(parseInt(words.slice(i, i + 4), 16));
        if (hit) seenDcw.add(hit.index);
      }
      continue;
    }
    if (op.startsWith('DC') || op.startsWith('DS') || op.startsWith('DCB')) continue;
    const first = parseInt(words.slice(0, 4), 16);
    if (Number.isNaN(first)) continue;
    const hit = decode(first);
    if (hit) seenEntries.add(hit.index);
    // Immediates into D0 and D1.
    if ((first & 0xff00) === 0x7000) d0 = first & 0xff;
    else if (first === 0x103c || first === 0x303c) d0 = parseInt(words.slice(4, 8), 16) & 0xff;
    else if (first === 0x203c) d0 = parseInt(words.slice(8, 12), 16) & 0xff;
    if ((first & 0xff00) === 0x7200) d1 = first & 0xff;
    else if (first === 0x123c || first === 0x323c) d1 = parseInt(words.slice(4, 8), 16) & 0xff;
    else if (first === 0x223c) d1 = parseInt(words.slice(8, 12), 16) & 0xff;
    if (first === 0x4e4f) {
      if (d0 === null) unknownHere += 1;
      else {
        if (taskCover.has(d0)) seenTasks.add(d0);
        if (d0 === 32 && d1 !== null && d1 < 8) seenSub.add(d1);
      }
    }
  }
  // Two programs take D0 or D1 from a table (MOVE.L (An)+,Dn) instead of an immediate; their
  // tables are read here from the source, so that they count as well (and are shown as such).
  const tableDriven = TABLE_DRIVEN[p.id];
  if (tableDriven) {
    const text = readFileSync(join(simDir, p.source), 'latin1');
    const row = new RegExp(`^${tableDriven.label}\\s+DC\\.L\\s+(.*)$`, 'm').exec(text);
    const values = (row?.[1] ?? '')
      .split(/\s*,\s*/)
      .map((v) => (v.startsWith('$') ? parseInt(v.slice(1), 16) : Number(v)));
    const end = values.indexOf(-1);
    const list = values.slice(0, end < 0 ? values.length : end).filter((_, i) => i % tableDriven.stride === 0);
    for (const v of list) {
      if (tableDriven.kind === 'task' && taskCover.has(v & 0xff)) seenTasks.add(v & 0xff);
      if (tableDriven.kind === 'sub32' && (v & 0xff) < 8) seenSub.add(v & 0xff);
    }
    tableDrivenSeen.push(
      `${p.id} (${tableDriven.kind === 'task' ? 'tasks' : 'task 32 sub-tasks'} ${list.map((v) => v & 0xff).join(', ')} from ${tableDriven.label})`,
    );
    if (unknownHere > 0) unknownHere = 0;
  }
  for (const i of seenEntries) entryCover.get(i).push(p.id);
  for (const i of seenDcw) if (!seenEntries.has(i)) entryCoverDcw.get(i).push(p.id);
  for (const t of seenTasks) taskCover.get(t).push(p.id);
  for (const s of seenSub) sub32Cover.get(s).push(p.id);
  if (unknownHere > 0) unknownTaskTraps.push(`${p.id} (${unknownHere})`);
}

const shortList = (ids) =>
  ids.length <= 4 ? ids.join(', ') : `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more`;
console.log(`3. sim-core 3.16 instruction table: ${TABLE.length} entries`);
const entryGaps = [];
for (const [index, , , name] of TABLE) {
  const ids = entryCover.get(index);
  const dcw = entryCoverDcw.get(index);
  const tag =
    ids.length > 0
      ? `${ids.length} programs: ${shortList(ids)}`
      : dcw.length > 0
        ? `only as DC.W words in ${shortList(dcw)}`
        : 'NO PROGRAM';
  if (ids.length === 0) entryGaps.push(`${index} ${name}${dcw.length > 0 ? ' (DC.W only)' : ''}`);
  console.log(`   #${String(index).padStart(2)} ${name.padEnd(22)} ${tag}`);
}
console.log(
  `   covered as instructions: ${TABLE.length - entryGaps.length} of ${TABLE.length}; not covered: ${entryGaps.join('; ') || 'none'}`,
);
const hardEntryGaps = TABLE.filter(([i]) => entryCover.get(i).length === 0 && entryCoverDcw.get(i).length === 0);
if (hardEntryGaps.length > 0)
  fails.push(
    `instruction-table entries no self-reporting program contains: ${hardEntryGaps.map((e) => `${e[0]} ${e[3]}`).join(', ')}`,
  );

console.log(`4. TRAP #15 tasks: ${TASKS.length} tasks, ${Object.keys(INTERACTIVE).length} counted as interactive`);
const taskGaps = [];
for (const t of TASKS) {
  const ids = taskCover.get(t);
  const kind = INTERACTIVE[t] ? `interactive (${INTERACTIVE[t]})` : 'non-interactive';
  if (ids.length === 0 && !INTERACTIVE[t]) taskGaps.push(t);
  console.log(
    `   task ${String(t).padStart(3)} ${kind.padEnd(40)} ${ids.length > 0 ? `${ids.length}: ${shortList(ids)}` : 'NO PROGRAM'}`,
  );
}
for (const [s, ids] of sub32Cover)
  console.log(
    `   task  32/${s} ${''.padEnd(37)} ${ids.length > 0 ? `${ids.length}: ${shortList(ids)}` : 'NO PROGRAM'}`,
  );
console.log(`   non-interactive tasks without a self-reporting program: ${taskGaps.join(', ') || 'none'}`);
console.log(`   taken from a table in the source: ${tableDrivenSeen.join('; ') || 'none'}`);
console.log(
  `   TRAP #15 with no immediate task number in D0 before it (not attributed): ${unknownTaskTraps.join(', ') || 'none'}`,
);
if (taskGaps.length > 0)
  fails.push(`non-interactive TRAP #15 tasks no self-reporting program calls: ${taskGaps.join(', ')}`);

if (jsonOut) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify(
      {
        reporting: reporting.map((p) => p.id),
        withGolden: withGolden.length,
        reproduced,
        listedReport: listedReport.map((p) => p.id),
        logRuns,
        totalInstr,
        identicalInstr,
        entries: TABLE.map(([i, , , n]) => ({
          index: i,
          name: n,
          programs: entryCover.get(i),
          dcwOnly: entryCoverDcw.get(i),
        })),
        tasks: TASKS.map((t) => ({ task: t, interactive: INTERACTIVE[t] ?? null, programs: taskCover.get(t) })),
        task32: [...sub32Cover].map(([s, ids]) => ({ sub: s, programs: ids })),
        unknownTaskTraps,
        fails,
      },
      null,
      2,
    )}\n`,
  );
}
console.log(
  fails.length > 0
    ? `item 2 thresholds missed:\n - ${fails.join('\n - ')}`
    : comparison
      ? 'item 2 counts and coverage: all thresholds met'
      : 'item 2 not shown: no threshold missed, but without --sim-report the results were not compared',
);
process.exit(fails.length > 0 ? 1 : comparison ? 0 : 2);
