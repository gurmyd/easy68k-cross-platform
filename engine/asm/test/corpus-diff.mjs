#!/usr/bin/env node
// corpus-diff.mjs - differential run of every .X68 program under
// reference/examples through
//   wasm       the WebAssembly build (engine/dist), through asm68k.mjs
//   patched    the native MSVC twin built from engine/asm/src (native/build.mjs)
//   unpatched  the native MSVC twin built from the UNPATCHED v5.16.1 sources
//   oracle     the v5.15.4 command-line port (build/oracle/asm-cli-5.15.4/bin/asy68k.exe)
// with the default options and again with all expansion options on, and a
// comparison of .L68 (ignoring only the "Created On:" line) and .S68 byte for
// byte.
//
//     node engine/asm/test/corpus-diff.mjs [--limit N] [--filter text] [--jobs N]
//
// The report goes to build/reports/asm-corpus-diff.md, the raw outputs to
// build/asm-corpus/. Nothing is written into reference/.
//
// How each program is run, as the editor would:
//   - the main file is loaded the way the editor loads it (loadEditorText):
//     the *~Font name~ / *~Tab type~ ... trailer lines are removed and the
//     tab settings they carry become the document's tab settings;
//   - every other file of the program's own folder is available to INCLUDE
//     and INCBIN under its own name (that folder is the current directory).
//
// The v5.15.4 oracle differs from 5.16.1 by design in ways listed in
// docs/porting/assembler.md section 8: its listing header line 2 (version)
// and its tab expansion (always Assembly tabs). It is therefore compared
// against an extra wasm run with Assembly tabs ("wasm-asmtabs"), with listing
// lines 2 and 3 ignored. Its own known differences are classified in the report.
//
// Licence note: the corpora are only read. Files of
// reference/examples/github/easy68k-qt are used as test input only (its
// .x68/.inc/.bin files); nothing else of that project is read.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { assemble, loadEditorText, decodeCp1252 } from '../asm68k.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const examples = join(repo, 'reference', 'examples');
const work = join(repo, 'build', 'asm-corpus');
const reportFile = join(repo, 'build', 'reports', 'asm-corpus-diff.md');
const EXE = {
  patched: join(repo, 'build', 'asm-native', 'patched', 'ez68k-asm.exe'),
  unpatched: join(repo, 'build', 'asm-native', 'unpatched', 'ez68k-asm.exe'),
  oracle: join(repo, 'build', 'oracle', 'asm-cli-5.15.4', 'bin', 'asy68k.exe'),
};

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const limit = Number(arg('--limit', '0')) || Infinity;
const filter = arg('--filter', '');
const jobs = Number(arg('--jobs', String(Math.max(2, Math.min(8, availableParallelism())))));

const TIME = { year: 2026, month: 11, day: 20, hour: 13, minute: 7, second: 46 };
const TIME_ARG = '2026,11,20,13,7,46';
const OPTION_SETS = {
  default: { name: 'default', digits: '11011001', options: {}, oracleArgs: [] },
  expanded: {
    name: 'expanded', digits: '11111111',
    options: { constantsExpanded: true, macrosExpanded: true, structuredExpanded: true },
    oracleArgs: ['--macroexpand', '--structureexpan', '--expandconstants'],
  },
};

// ---------------------------------------------------------------- discovery

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.x68$/i.test(entry.name)) out.push(p);
  }
  return out;
}

const QT = join(examples, 'github', 'easy68k-qt');
/** Files of a program's folder that INCLUDE / INCBIN may read. */
function folderFiles(dir) {
  const isQt = dir.toLowerCase().startsWith(QT.toLowerCase());
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (ext === '.l68' || ext === '.s68') continue;               // outputs, never inputs
    if (isQt && !['.x68', '.inc', '.bin', '.asm', '.s'].includes(ext)) continue;
    const p = join(dir, entry.name);
    if (statSync(p).size > 16 * 1024 * 1024) continue;
    files.push(p);
  }
  return files;
}

// ---------------------------------------------------------------- running

function runProcess(exe, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('error', (e) => { clearTimeout(timer); resolvePromise({ code: -1, out: String(e) }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolvePromise({ code: code ?? -1, signal, out }); });
  });
}

const readOrNull = (p) => (existsSync(p) ? readFileSync(p) : null);

async function runNative(kind, prog, set, outBase) {
  const l68 = outBase + '.L68', s68 = outBase + '.S68', json = outBase + '.json';
  for (const p of [l68, s68, json]) rmSync(p, { force: true });
  const r = await runProcess(EXE[kind], ['--manifest', prog.manifest, '--main', prog.mainName,
    '--source', prog.strippedPath, '--options', set.digits, '--tabs', `${prog.tabType},${prog.tabSize}`,
    '--time', TIME_ARG, '--l68', l68, '--s68', s68, '--json', json]);
  if (r.code !== 0) return { failed: `exit code ${r.code}${r.signal ? ' ' + r.signal : ''} ${r.out.trim().slice(0, 300)}` };
  const meta = JSON.parse(readFileSync(json, 'latin1'));
  return { l68: readOrNull(l68), s68: readOrNull(s68), meta };
}

async function runWasm(prog, set, tabTypeOverride) {
  const files = new Map();
  for (const p of prog.folder) files.set(basename(p), readFileSync(p));
  files.set(prog.mainName, prog.stripped);
  const options = { ...set.options, tabType: tabTypeOverride ?? (prog.tabType ? 'fixed' : 'assembly'), tabSize: prog.tabSize };
  const r = await assemble(prog.mainName, files, options, TIME);
  if (r.fatal) return { failed: r.fatal };
  return {
    l68: r.listing ? Buffer.from(r.listing) : null,
    s68: r.sRecord ? Buffer.from(r.sRecord) : null,
    meta: {
      errorCount: r.errorCount, warningCount: r.warningCount,
      messages: r.messages.map((m) => ({ line: m.line, code: m.code, text: m.text, file: m.file || '' })),
    },
  };
}

async function runOracle(prog, set) {
  const dir = prog.mirrorDir;
  const name = `__EZ_${prog.id}${set.name[0]}.X68`;
  const src = join(dir, name);
  writeFileSync(src, prog.stripped);
  const l68 = join(dir, `__EZ_${prog.id}${set.name[0]}.L68`), s68 = join(dir, `__EZ_${prog.id}${set.name[0]}.S68`);
  rmSync(l68, { force: true }); rmSync(s68, { force: true });
  const r = await runProcess(EXE.oracle, [...set.oracleArgs, name], dir);
  const out = { l68: readOrNull(l68), s68: readOrNull(s68), code: r.code };
  rmSync(src, { force: true }); rmSync(l68, { force: true }); rmSync(s68, { force: true });
  rmSync(src + '.tmp', { force: true });
  if (!out.l68 && !out.s68) return { failed: `no output (exit code ${r.code}${r.signal ? ' ' + r.signal : ''}) ${r.out.trim().slice(0, 300)}` };
  return out;
}

// ---------------------------------------------------------------- comparing

/** Split into lines keeping no terminators; masks the given 0-based line numbers. */
function lines(buf, mask) {
  const s = decodeCp1252(new Uint8Array(buf));
  const ls = s.split('\r\n');
  for (const i of mask) if (i < ls.length) ls[i] = '<masked>';
  return ls;
}

/** null when equal, else { line, a, b } (first difference, 1-based line). */
function diffListing(a, b, mask) {
  if (!a && !b) return null;
  if (!a || !b) return { line: 0, a: a ? 'present' : 'missing', b: b ? 'present' : 'missing' };
  const la = lines(a, mask), lb = lines(b, mask);
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return { line: i + 1, a: la[i] ?? '<end of file>', b: lb[i] ?? '<end of file>', countA: la.length, countB: lb.length };
  }
  return null;
}

function diffBytes(a, b) {
  if (!a && !b) return null;
  if (!a || !b) return { line: 0, a: a ? 'present' : 'missing', b: b ? 'present' : 'missing' };
  if (Buffer.compare(a, b) === 0) return null;
  const la = a.toString('latin1').split('\r\n'), lb = b.toString('latin1').split('\r\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, a: la[i] ?? '<end of file>', b: lb[i] ?? '<end of file>' };
  }
  return { line: 0, a: `${a.length} bytes`, b: `${b.length} bytes` };
}

function diffMessages(a, b) {
  const norm = (m) => JSON.stringify((m.messages || []).map((x) => [x.line, x.code, x.text, x.file || '']));
  if (a.errorCount !== b.errorCount || a.warningCount !== b.warningCount) {
    return `counts ${a.errorCount}/${a.warningCount} vs ${b.errorCount}/${b.warningCount}`;
  }
  return norm(a) === norm(b) ? null : 'message lists differ';
}

const EXIT_NAMES = { [-1073741571]: 'stack overflow', [-1073741819]: 'access violation', [3221225725]: 'stack overflow', [3221225477]: 'access violation' };

/**
 * Classes of a difference between the 5.15.4 oracle and the wasm build (run
 * with Assembly tabs), by docs/porting/assembler.md section 8 and 9.3.3.
 * Every differing line is classified; a class starting with "unclassified"
 * needs a human.
 * @returns {string[]}
 */
function classifyOracle(wasmBuf, oracleBuf, exitCode) {
  if (!oracleBuf || oracleBuf.length === 0) {
    return [`oracle wrote an empty listing: it crashed (exit code ${exitCode}${EXIT_NAMES[exitCode] ? ' = ' + EXIT_NAMES[exitCode] : ''})`];
  }
  const W = lines(wasmBuf, [1, 2]);
  let O = lines(oracleBuf, [1, 2]);
  const classes = new Set();
  const notFound = O.filter((l) => /^Could not open file ::.*::$/.test(l)).length;
  if (notFound) {
    classes.add('8.2: the CLI writes "Could not open file ::name::" into the listing');
    O = O.filter((l) => !/^Could not open file ::.*::$/.test(l));
  }
  for (let i = 0; i + 1 < O.length; i++) {
    // the CLI skips upper-casing for any line containing INCLUDE / INCBIN, in any case,
    // also inside another word or a comment (cli/ASSEMBLE.CPP:414-420)
    if (/^Line \d+ (ERROR|WARNING): /.test(O[i]) && /include|incbin/i.test(O[i + 1].slice(32)) &&
        /[a-z]/.test(O[i + 1].slice(32)) && W.indexOf(O[i]) < 0) {
      classes.add('8.2: the CLI does not upper-case lines that contain "include"/"incbin" (mixed-case INCLUDE line is an invalid opcode there); everything after it follows from that');
      return [...classes];
    }
  }
  if (W.length !== O.length) {
    classes.add(`unclassified: line counts differ (${W.length} / ${O.length})`);
    return [...classes];
  }
  const hasErrorAbove = (i) => {
    // a CEX group is a numbered line followed by continuation lines (10 blanks); its
    // message is printed after the first part, i.e. inside or right after the group
    let k = i;
    if (/^ {10}/.test(W[k])) {                               // back to the numbered line
      while (k > 0 && (/^ {10}/.test(W[k]) || /^Line \d+ /.test(W[k]))) k--;
    }
    if (k > 0 && /^Line \d+ ERROR: /.test(W[k - 1])) return true;
    let e = k + 1;
    while (e < W.length && (/^ {10}/.test(W[e]) || /^Line \d+ /.test(W[e]))) {
      if (/^Line \d+ ERROR: /.test(W[e])) return true;
      e++;
    }
    return false;
  };
  for (let i = 0; i < W.length; i++) {
    const a = W[i], b = O[i];
    if (a === b) continue;
    if (/_[0-9a-f]{8}/.test(b) && a.toUpperCase() === b.toUpperCase()) { classes.add('8.2: generated structured labels listed in lower-case hex (IntToHex "%08x")'); continue; }
    if (/\(\s*[^,()]*,\s*PC\s*,/i.test(a) || /\(\s*PC\s*,/i.test(a)) { classes.add('8.3 #4: (d,PC,Xn) assembles with displacement $FE in 5.16.1'); continue; }
    if (/\(\s*(P[^,]*|.C[^,]*),\s*(A[0-7]|SP)/i.test(a)) { classes.add('8.3 #3: (d,An) with a displacement starting with P or having C second is an error in 5.16.1'); continue; }
    if (a.slice(32) === b.slice(32) && a.slice(0, 10) === b.slice(0, 10) && hasErrorAbove(i)) {
      classes.add('9.3.3: operand bytes of a line with an error (undefined symbol) are uninitialised in the original; the port emits 0');
      continue;
    }
    classes.add(`unclassified: line ${i + 1}: wasm \`${a}\` / oracle \`${b}\``);
    break;
  }
  return [...classes];
}

/**
 * Classes of a difference between the unpatched twin and the wasm build. The
 * only patch that can show in ordinary programs is P7 (operand bytes of lines
 * with an error); everything else is reported as unclassified.
 * @returns {string[]}
 */
function classifyUnpatched(wasmBuf, unpBuf, msgDiff) {
  if (!unpBuf) return ['unclassified: unpatched twin wrote no listing'];
  const W = lines(wasmBuf, [2]), U = lines(unpBuf, [2]);
  if (W.length !== U.length) return [`unclassified: line counts differ (${W.length} / ${U.length})`];
  if (msgDiff) return [`unclassified: message lists differ (${msgDiff})`];
  const isMsg = (s) => /^Line \d+ /.test(s);
  const classes = new Set();
  for (let i = 0; i < W.length; i++) {
    if (W[i] === U[i]) continue;
    // object field only (columns 10-31), and an error message belongs to the line or its CEX group
    let k = i;
    while (k > 0 && (/^ {10}/.test(W[k]) || isMsg(W[k]))) k--;
    let e = k + 1, err = k > 0 && /^Line \d+ ERROR: /.test(W[k - 1]);
    while (!err && e < W.length && (/^ {10}/.test(W[e]) || isMsg(W[e]))) { if (/^Line \d+ ERROR: /.test(W[e])) err = true; e++; }
    if (err && W[i].slice(0, 10) === U[i].slice(0, 10) && W[i].slice(32) === U[i].slice(32)) {
      classes.add('P7: operand bytes of a line with an error (undefined symbol) are uninitialised in the unpatched sources; the port emits 0');
      continue;
    }
    classes.add(`unclassified: line ${i + 1}: wasm \`${W[i]}\` / unpatched \`${U[i]}\``);
    break;
  }
  return [...classes];
}

// ---------------------------------------------------------------- main

async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function main() {
  const missing = Object.entries(EXE).filter(([, p]) => !existsSync(p)).map(([k, p]) => `${k} (${p})`);
  if (missing.length) console.log(`not available, skipped: ${missing.join(', ')}`);
  const have = (k) => existsSync(EXE[k]);

  let programs = walk(examples, []).sort();
  if (filter) programs = programs.filter((p) => p.toLowerCase().includes(filter.toLowerCase()));
  programs = programs.slice(0, limit);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  // prepare every program
  const progs = programs.map((path, index) => {
    const rel = relative(examples, path);
    const id = String(index).padStart(4, '0');
    const dir = dirname(path);
    const loaded = loadEditorText(readFileSync(path));
    const stripped = Buffer.from(loaded.text);
    const strippedPath = join(work, 'stripped', id + '.X68');
    mkdirSync(dirname(strippedPath), { recursive: true });
    writeFileSync(strippedPath, stripped);
    const folder = folderFiles(dir);
    const mainName = basename(path);
    const manifest = join(work, 'manifest', id + '.txt');
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, folder.map((p) => `${basename(p)}\t${p === path ? strippedPath : p}`).join('\n') + '\n', 'latin1');
    const mirrorDir = join(work, 'mirror', relative(examples, dir));
    return {
      path, rel, id, dir, mainName, stripped, strippedPath, folder, manifest, mirrorDir,
      tabType: loaded.tabType === 'assembly' ? 0 : 1, tabSize: loaded.tabSize ?? 4,
      trailer: loaded.tabType !== null || loaded.tabSize !== null,
      results: {},
    };
  });
  if (have('oracle')) {
    const done = new Set();
    for (const p of progs) {
      if (done.has(p.mirrorDir)) continue;
      done.add(p.mirrorDir);
      mkdirSync(p.mirrorDir, { recursive: true });
      for (const f of p.folder) copyFileSync(f, join(p.mirrorDir, basename(f)));
    }
  }

  const started = Date.now();
  let finished = 0;
  const tasks = [];
  for (const p of progs) for (const set of Object.values(OPTION_SETS)) tasks.push({ p, set });
  await pool(tasks, jobs, async ({ p, set }) => {
    const r = {};
    const outDir = join(work, set.name);
    mkdirSync(outDir, { recursive: true });
    try { r.wasm = await runWasm(p, set); } catch (e) { r.wasm = { failed: String(e && e.stack || e) }; }
    if (have('oracle')) {
      try { r.wasmAsmTabs = await runWasm(p, set, 'assembly'); } catch (e) { r.wasmAsmTabs = { failed: String(e) }; }
      r.oracle = await runOracle(p, set);
    }
    if (have('patched')) r.patched = await runNative('patched', p, set, join(outDir, p.id + '.patched'));
    if (have('unpatched')) r.unpatched = await runNative('unpatched', p, set, join(outDir, p.id + '.unpatched'));
    for (const [k, v] of Object.entries(r)) {
      if (v && v.l68) writeFileSync(join(outDir, `${p.id}.${k}.L68`), v.l68);
      if (v && v.s68) writeFileSync(join(outDir, `${p.id}.${k}.S68`), v.s68);
    }
    p.results[set.name] = r;
    if (++finished % 50 === 0) console.log(`${finished}/${tasks.length} runs (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  });

  // ------------------------------------------------------------ compare and report
  const DATE_LINE = [2];          // 0-based: line 3 "Created On: ..."
  const ORACLE_MASK = [1, 2];     // + line 2 "Assembler used: ..."
  const rows = [];
  const tally = { total: progs.length, runs: tasks.length };
  const cls = {};
  const bump = (k) => { cls[k] = (cls[k] || 0) + 1; };
  for (const p of progs) {
    for (const set of Object.values(OPTION_SETS)) {
      const r = p.results[set.name];
      const row = { p, set: set.name, notes: [] };
      if (r.wasm.failed) { row.notes.push(`wasm FAILED: ${r.wasm.failed}`); bump('wasm failed'); }
      for (const twin of ['patched', 'unpatched']) {
        const t = r[twin];
        if (!t) continue;
        if (t.failed) { row.notes.push(`${twin} FAILED: ${t.failed}`); bump(`${twin} failed`); row[twin] = 'failed'; continue; }
        if (r.wasm.failed) continue;
        const dl = diffListing(r.wasm.l68, t.l68, DATE_LINE);
        const ds = diffBytes(r.wasm.s68, t.s68);
        const dm = diffMessages(r.wasm.meta, t.meta);
        row[twin] = !dl && !ds && !dm ? 'same' : 'differs';
        if (row[twin] === 'differs') {
          const classes = twin === 'unpatched'
            ? classifyUnpatched(r.wasm.l68, t.l68, dm)
            : ['unclassified: the patched twin must agree exactly'];
          for (const c of classes) bump(`${twin} class: ${c.startsWith('unclassified') ? 'UNCLASSIFIED' : c}`);
          row[twin + 'Classes'] = classes;
          row.notes.push(`${twin} classes: ${classes.join('; ')}`);
        }
        if (dl) row.notes.push(`${twin} L68 line ${dl.line}: wasm \`${dl.a}\` / ${twin} \`${dl.b}\``);
        if (ds) row.notes.push(`${twin} S68 line ${ds.line}: wasm \`${ds.a}\` / ${twin} \`${ds.b}\``);
        if (dm) row.notes.push(`${twin} messages: ${dm}`);
        bump(`${twin} ${row[twin]}`);
      }
      if (r.oracle) {
        if (r.oracle.failed) { row.oracle = 'failed'; row.notes.push(`oracle FAILED: ${r.oracle.failed}`); bump('oracle failed'); }
        else if (r.wasmAsmTabs && !r.wasmAsmTabs.failed) {
          const dl = diffListing(r.wasmAsmTabs.l68, r.oracle.l68, ORACLE_MASK);
          const ds = diffBytes(r.wasmAsmTabs.s68, r.oracle.s68);
          row.oracle = !dl && !ds ? 'same' : 'differs';
          if (dl || ds) {
            const classes = classifyOracle(r.wasmAsmTabs.l68, r.oracle.l68, r.oracle.code);
            row.oracleClasses = classes;
            for (const c of classes) bump(`oracle class: ${c.startsWith('unclassified') ? 'UNCLASSIFIED' : c}`);
            row.notes.push(`oracle classes: ${classes.join('; ')}`);
          }
          if (dl) row.notes.push(`oracle L68 first difference, line ${dl.line}: wasm \`${dl.a}\` / oracle \`${dl.b}\``);
          if (ds) row.notes.push(`oracle S68 first difference, line ${ds.line}: wasm \`${ds.a}\` / oracle \`${ds.b}\``);
          bump(`oracle ${row.oracle}`);
        }
      }
      rows.push(row);
    }
  }

  const md = [];
  md.push('# Assembler corpus differential run', '');
  md.push(`Generated by \`engine/asm/test/corpus-diff.mjs\` on ${new Date().toISOString()} in ${((Date.now() - started) / 1000).toFixed(0)} s.`, '');
  md.push(`Programs: ${progs.length} (.X68 files under reference/examples), option sets: default (${OPTION_SETS.default.digits}) and expanded (${OPTION_SETS.expanded.digits}), ${tasks.length} program runs per runner.`, '');
  md.push('Runners: `wasm` = engine/dist/asm68k.wasm through asm68k.mjs; `patched` / `unpatched` = native MSVC x86 /Od twins (engine/asm/src and the unpatched reference sources, same shim); `oracle` = v5.15.4 CLI port, compared against a wasm run with Assembly tabs, listing lines 2-3 ignored.', '');
  md.push('## Tally', '');
  md.push('| Class | Runs |', '|---|---|');
  for (const [k, v] of Object.entries(cls).sort()) md.push(`| ${k} | ${v} |`);
  md.push('');
  const filesSameAll = progs.filter((p) => Object.values(OPTION_SETS).every((s) => {
    const row = rows.find((x) => x.p === p && x.set === s.name);
    return row && row.patched === 'same' && row.unpatched === 'same' && !p.results[s.name].wasm.failed;
  })).length;
  md.push(`Files identical across wasm and both native twins in both option sets: **${filesSameAll} of ${progs.length}**.`, '');

  // per file: a file "differs" for a runner when it differs in either option set
  const fileRows = (p) => rows.filter((x) => x.p === p);
  const perFile = (runner) => {
    const out = { same: 0, differs: 0, failed: 0, classes: {} };
    for (const p of progs) {
      const rs = fileRows(p);
      const st = rs.map((x) => x[runner]);
      if (st.includes('failed')) out.failed++;
      else if (st.includes('differs')) {
        out.differs++;
        const cs = new Set(rs.flatMap((x) => x[runner + 'Classes'] || []).map((c) => (c.startsWith('unclassified') ? 'UNCLASSIFIED' : c)));
        for (const c of cs) out.classes[c] = (out.classes[c] || 0) + 1;
      } else if (st.every((s) => s === 'same')) out.same++;
    }
    return out;
  };
  md.push('## Per file (a file counts as different if it differs in either option set)', '');
  for (const runner of ['patched', 'unpatched', 'oracle']) {
    if (!have(runner)) { md.push(`- ${runner}: not available`); continue; }
    const f = perFile(runner);
    md.push(`- **${runner}** vs wasm: ${f.same} identical, ${f.differs} different, ${f.failed} could not be run.`);
    for (const [c, n] of Object.entries(f.classes).sort((a, b) => b[1] - a[1])) md.push(`  - ${n} file(s): ${c}`);
  }
  const wasmFailed = progs.filter((p) => Object.values(p.results).some((r) => r.wasm.failed)).length;
  md.push(`- **wasm** could not run: ${wasmFailed} file(s).`, '');
  md.push('## Differences', '');
  for (const row of rows) {
    if (!row.notes.length) continue;
    md.push(`### ${row.p.rel.replace(/\\/g, '/')} (${row.set})`, '');
    for (const n of row.notes) md.push(`- ${n.replace(/\r?\n/g, ' ')}`);
    md.push('');
  }
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, md.join('\n') + '\n');
  writeFileSync(join(work, 'summary.json'), JSON.stringify({ cls, filesSameAll, programs: progs.length,
    rows: rows.filter((r) => r.notes.length).map((r) => ({ file: r.p.rel, id: r.p.id, set: r.set, notes: r.notes })) }, null, 1));
  console.log(JSON.stringify(cls, null, 1));
  console.log(`identical across wasm + both twins: ${filesSameAll}/${progs.length}`);
  console.log(`report: ${reportFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
