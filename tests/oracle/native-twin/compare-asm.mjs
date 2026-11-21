// Assembler twins against the WebAssembly assembler (ARCHITECTURE.md 6.2.1):
//
//   - the engine's own test programs (engine/asm/test/cases.mjs, every variant) and
//   - every corpus program (corpus.mjs) with the default options and with the three expansion
//     options on,
//
// through engine/dist/asm68k.wasm and through each built twin. The twins built from the patched
// sources (/O2 and /Od) must agree exactly: listing, S-records, message list and counts. The twins
// built from the unpatched sources must agree too, except where an input triggers one of the
// defects the patches fix: for the engine's cases that is the list UNPATCHED_DIFFERS of
// engine/asm/test/native.test.mjs; for corpus programs the only patch that ordinary programs reach
// is P7 (the operand bytes of a line with an undefined symbol are uninitialised in the unpatched
// sources), recognised by classifyUnpatched(). Any other difference is a failure.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { asmTwinPath } from './build-asm-twins.mjs';
import { assemblerModule, corpusFiles, loadProgram, repo } from './corpus.mjs';

const TIME = { year: 2026, month: 11, day: 20, hour: 13, minute: 7, second: 46 };
const TIME_ARG = '2026,11,20,13,7,46';
const FLAG_ORDER = [
  'generateListing',
  'generateSRecord',
  'constantsExpanded',
  'bitFieldInstructions',
  'crossReference',
  'macrosExpanded',
  'structuredExpanded',
  'showWarnings',
];
export const OPTION_SETS = Object.freeze({
  default: {},
  expanded: { constantsExpanded: true, macrosExpanded: true, structuredExpanded: true },
});

const engineTest = (path) => import(pathToFileURL(join(repo, 'engine', 'asm', 'test', ...path.split('/'))).href);

/** The keys of UNPATCHED_DIFFERS in engine/asm/test/native.test.mjs (read as text: importing the
 *  file would register its node:test tests). */
export function unpatchedDiffers() {
  const text = readFileSync(join(repo, 'engine', 'asm', 'test', 'native.test.mjs'), 'utf8');
  const body = /export const UNPATCHED_DIFFERS = \{([\s\S]*?)\n\};/.exec(text);
  if (!body) throw new Error('engine/asm/test/native.test.mjs: UNPATCHED_DIFFERS not found');
  return new Set([...body[1].matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'")));
}

/**
 * Corpus programs written to exercise a defect that a patch of engine/asm/PATCHES.md fixes, so
 * the unpatched twins may differ on them in any way (crash included). They are T1's assembler
 * checklist programs that correspond one to one to entries of UNPATCHED_DIFFERS.
 */
export const UNPATCHED_CORPUS = Object.freeze({
  'tests/conformance/asm/checklist/programs/dir-11-':
    'P7: pass 1 evaluates IFNE FWD with the uninitialised local t of eval()',
  'tests/conformance/asm/checklist/programs/dir-16-': 'P5: FAIL text used as a printf format',
  'tests/conformance/asm/checklist/programs/macro-09-': 'P5: macro body line used as a printf format',
  'tests/conformance/asm/checklist/programs/macro-10-': 'P8: line[] overrun; the unpatched build crashes',
  'tests/conformance/asm/checklist/programs/stc-03-': 'P7: branch to an undefined label, uninitialised displacement',
});

/** @param {string} rel repository-relative path @returns {string|null} */
export function patchTriggeredBy(rel) {
  const hit = Object.entries(UNPATCHED_CORPUS).find(([prefix]) => rel.startsWith(prefix));
  return hit ? hit[1] : null;
}

function runProcess(exe, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, out: String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, out });
    });
  });
}

/**
 * Run a twin. inputs: [virtual name, bytes][]; the main source is mainName.
 * @returns {Promise<{ exitCode: number, listing: Uint8Array|null, sRecord: Uint8Array|null, meta: any, out: string }>}
 */
async function runTwin(exe, workDir, inputs, mainName, options) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const manifest = inputs.map(([name, bytes], k) => {
    const disk = join(workDir, `in${k}.bin`);
    writeFileSync(disk, bytes);
    return `${name}\t${disk}`;
  });
  writeFileSync(join(workDir, 'manifest.txt'), manifest.join('\n') + '\n', 'latin1');
  const { DEFAULT_OPTIONS } = await assemblerModule();
  const o = { ...DEFAULT_OPTIONS, ...options };
  const digits = FLAG_ORDER.map((k) => (o[k] ? '1' : '0')).join('');
  const tabType = o.tabType === 'assembly' || o.tabType === 0 ? 0 : 1;
  const l68 = join(workDir, 'out.L68');
  const s68 = join(workDir, 'out.S68');
  const json = join(workDir, 'out.json');
  const r = await runProcess(exe, [
    '--manifest',
    join(workDir, 'manifest.txt'),
    '--main',
    mainName,
    '--options',
    digits,
    '--tabs',
    `${tabType},${o.tabSize}`,
    '--time',
    TIME_ARG,
    '--l68',
    l68,
    '--s68',
    s68,
    '--json',
    json,
  ]);
  const result = {
    exitCode: r.code,
    out: r.out,
    listing: existsSync(l68) ? new Uint8Array(readFileSync(l68)) : null,
    sRecord: existsSync(s68) ? new Uint8Array(readFileSync(s68)) : null,
    meta: existsSync(json) ? JSON.parse(readFileSync(json, 'latin1')) : null,
  };
  rmSync(workDir, { recursive: true, force: true });
  return result;
}

/**
 * Is every difference between the wasm and the unpatched listing of class P7 (the object field of
 * a line that has an error)? Same rule as engine/asm/test/corpus-diff.mjs.
 * @param {string[]|null} W wasm listing lines @param {string[]|null} U unpatched listing lines
 * @returns {string|null} null when all differences are P7, else a description
 */
export function classifyUnpatched(W, U) {
  if (!W || !U) return 'listing missing';
  if (W.length !== U.length) return `line counts differ (${W.length} / ${U.length})`;
  const isMsg = (s) => /^Line \d+ /.test(s);
  for (let i = 0; i < W.length; i++) {
    if (W[i] === U[i]) continue;
    let k = i;
    while (k > 0 && (/^ {10}/.test(W[k]) || isMsg(W[k]))) k--;
    let err = k > 0 && /^Line \d+ ERROR: /.test(W[k - 1]);
    for (let e = k + 1; !err && e < W.length && (/^ {10}/.test(W[e]) || isMsg(W[e])); e++)
      if (/^Line \d+ ERROR: /.test(W[e])) err = true;
    if (err && W[i].slice(0, 10) === U[i].slice(0, 10) && W[i].slice(32) === U[i].slice(32)) continue;
    return `line ${i + 1}: wasm \`${W[i]}\` / unpatched \`${U[i]}\``;
  }
  return null;
}

/** First difference between two summaries, or null. */
function firstDifference(a, b) {
  for (const key of ['errors', 'warnings']) if (a[key] !== b[key]) return `${key} ${a[key]} / ${b[key]}`;
  if (JSON.stringify(a.msgs) !== JSON.stringify(b.msgs)) return 'message lists differ';
  for (const key of ['listing', 's68']) {
    const x = a[key];
    const y = b[key];
    if (!x && !y) continue;
    if (!x || !y) return `${key} ${x ? 'present' : 'missing'} / ${y ? 'present' : 'missing'}`;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] !== y[i]) return `${key} line ${i + 1}: wasm \`${x[i] ?? '<end>'}\` / twin \`${y[i] ?? '<end>'}\``;
    }
  }
  return null;
}

async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

/**
 * @param {{ variants: string[], local?: boolean, jobs?: number, log?: (l: string) => void, workDir: string }} options
 * @returns {Promise<{ failures: string[], notes: string[], counts: Record<string, Record<string, number>> }>}
 */
export async function compareAsm(options) {
  const log = options.log ?? (() => {});
  const jobs = Math.max(1, Math.min(options.jobs ?? 6, 6));
  const variants = options.variants.filter((v) => existsSync(asmTwinPath(v)));
  const { assemble } = await assemblerModule();
  const { summarize, expandCases } = await engineTest('tools/native-run.mjs');
  const { src } = await engineTest('helpers.mjs');
  const { CASES } = await engineTest('cases.mjs');
  const differs = unpatchedDiffers();
  const failures = [];
  const notes = [];
  /** counts[variant][outcome] */
  const counts = Object.fromEntries(variants.map((v) => [v, { same: 0, 'differs (patch applies)': 0, failed: 0 }]));
  const bump = (v, outcome) => (counts[v][outcome] = (counts[v][outcome] ?? 0) + 1);

  // ---- 1. the engine's own cases ----------------------------------------------------------
  const runs = expandCases(CASES);
  let n = 0;
  await pool(runs, jobs, async (run) => {
    const id = `case-${n++}`;
    const mainName = run.c.mainName ?? 'prog.X68';
    const inputs = [...Object.entries(run.c.files ?? {}), [mainName, run.c.main]].map(([name, content]) => [
      name,
      content instanceof Uint8Array ? content : src(content),
    ]);
    const wasm = summarize(await assemble(mainName, new Map(inputs), run.options, TIME));
    for (const v of variants) {
      const nat = await runTwin(asmTwinPath(v), join(options.workDir, `${id}-${v}`), inputs, mainName, run.options);
      const diff = nat.exitCode === 0 ? firstDifference(wasm, summarize(nat)) : `exit code ${nat.exitCode}`;
      if (!diff) bump(v, 'same');
      else if (v.startsWith('unpatched') && differs.has(run.key)) bump(v, 'differs (patch applies)');
      else {
        bump(v, 'failed');
        failures.push(`asm-${v}, engine case ${run.key}: ${diff}`);
      }
    }
  });
  log(`assembler twins: ${runs.length} engine test runs compared`);

  // ---- 2. the corpus --------------------------------------------------------------------------
  const files = corpusFiles({ local: options.local });
  const tasks = [];
  for (const path of files)
    for (const [setName, set] of Object.entries(OPTION_SETS)) tasks.push({ path, setName, set, index: tasks.length });
  let done = 0;
  await pool(tasks, jobs, async ({ path, setName, set, index }) => {
    const p = await loadProgram(path);
    const inputs = p.folder.map((f) => [basename(f), f === path ? p.stripped : new Uint8Array(readFileSync(f))]);
    if (!inputs.some(([name]) => name === p.mainName)) inputs.push([p.mainName, p.stripped]);
    const opts = { ...set, tabType: p.tabType ? 'fixed' : 'assembly', tabSize: p.tabSize };
    const result = await assemble(p.mainName, new Map(inputs), opts, TIME);
    if (result.fatal) {
      failures.push(`wasm, ${p.rel} (${setName}): ${result.fatal}`);
      return;
    }
    const wasm = summarize(result);
    for (const v of variants) {
      const nat = await runTwin(
        asmTwinPath(v),
        join(options.workDir, `corpus-${index}-${v}`),
        inputs,
        p.mainName,
        opts,
      );
      const diff =
        nat.exitCode === 0
          ? firstDifference(wasm, summarize(nat))
          : `exit code ${nat.exitCode} ${nat.out.trim().slice(0, 200)}`;
      if (!diff) {
        bump(v, 'same');
        continue;
      }
      const sameMessages =
        nat.exitCode === 0 &&
        JSON.stringify(wasm.msgs) === JSON.stringify(summarize(nat).msgs) &&
        wasm.errors === summarize(nat).errors &&
        wasm.warnings === summarize(nat).warnings;
      const p7 =
        v.startsWith('unpatched') && sameMessages && wasm.errors > 0
          ? classifyUnpatched(wasm.listing, summarize(nat).listing)
          : 'not P7';
      const triggers = v.startsWith('unpatched') ? patchTriggeredBy(p.rel) : null;
      if (p7 === null) {
        bump(v, 'differs (patch applies)');
        notes.push(`asm-${v}, ${p.rel} (${setName}): P7 only (operand bytes of a line with an error)`);
      } else if (triggers) {
        bump(v, 'differs (patch applies)');
        notes.push(`asm-${v}, ${p.rel} (${setName}): ${triggers}`);
      } else {
        bump(v, 'failed');
        failures.push(`asm-${v}, ${p.rel} (${setName}): ${diff}`);
      }
    }
    if (++done % 100 === 0) log(`assembler twins: ${done}/${tasks.length} corpus runs`);
  });
  log(
    `assembler twins: ${tasks.length} corpus runs (${files.length} programs x ${Object.keys(OPTION_SETS).length} option sets) compared`,
  );
  return { failures, notes, counts, programs: files.length, caseRuns: runs.length };
}
