// Simulator twins against the WebAssembly simulator (ARCHITECTURE.md 6.2.1).
//
// Every script is run through engine/dist/sim68k.wasm (sim-script.mjs) and through each built
// simulator twin (sim-twin.exe, /O2 and /Od); the transcripts must be byte-identical. The scripts:
//
//   - the hand-written scripts of scripts/ (with their programs, assembled here);
//   - a standard script (standardScript) for every test program of the simulator engine
//     (engine/sim/test/fixtures) and for every corpus program (corpus.mjs) that assembles to an
//     S-record file: run it with typed input, dump registers, state, register boxes, a CRC of all
//     16 MB of memory and the program's files; then rewind it and single-step it with the
//     execution log of type 3 (registers and memory) on, and dump the log;
//   - optionally the 124 files of the single-step suite (tests/conformance/cpu), about one
//     million instructions.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simTwinPath } from './build-sim-twin.mjs';
import { assemblerModule, corpusFiles, loadProgram, repo } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TIME = { year: 2026, month: 11, day: 20, hour: 13, minute: 7, second: 46 };

/** The standard script for a program whose files are prog.S68 and (if there is one) prog.L68. */
export function standardScript(name, hasListing) {
  return [
    `# standard twin script for ${name}`,
    'time 4321098',
    'keys "Hello, twin\\r42\\r-7\\r65535\\rYn\\r\\r\\r0\\r1\\r"',
    `load prog.S68 ${hasListing ? 'prog.L68' : '-'} "${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'run 300000',
    'dump regs',
    'dump state',
    'dump boxes',
    'dump crc 0 16777216',
    'dump files',
    'option elog 3',
    'option logmemfrom $1000',
    'option logmembytes 64',
    'logdialog',
    'rewind',
    'logstart "11/20/2026 1:07:46 PM"',
    'trace 300',
    'logstop',
    'dump log',
    'dump regs',
    'dump crc 0 16777216',
    '',
  ].join('\n');
}

function runProcess(exe, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, err: String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, err });
    });
  });
}

/** The number of bytes an escaped transcript string stands for, and its prefix check. */
const unescapeLength = (s) => s.replace(/\\x[0-9A-F]{2}/g, '.').length;

/**
 * Known differences: a pair of transcript lines that differ for a reason already reported to the
 * owner of the code (docs/porting/errata/T4.md, "Defect reports"). Returns the defect id, or null.
 *
 * D1 - TRAP #15 tasks 0 and 1 with a negative D1.W and a string of 255 bytes or more: the
 * original copies 255 bytes with strncpy() and, with the engine's patch P24, writes no NUL, so the
 * text ends at whatever follows in the uninitialised stack buffer `buf`. The WebAssembly build
 * prints exactly 255 bytes only because Clang zero-fills locals (-ftrivial-auto-var-init=zero);
 * MSVC prints the stack contents after them.
 */
export function knownDifference(wasmLine, twinLine) {
  const m = /^@(textOut|textOutCR) "(.*)"$/.exec(wasmLine ?? '');
  const n = /^@(textOut|textOutCR) (?:"(.*)"|#(\d+):[0-9A-F]{8})$/.exec(twinLine ?? '');
  if (!m || !n || m[1] !== n[1] || unescapeLength(m[2]) !== 255) return null;
  if (n[2] !== undefined) return n[2].startsWith(m[2]) && unescapeLength(n[2]) > 255 ? 'D1' : null;
  return Number(n[3]) > 255 ? 'D1' : null;
}

/**
 * First differing line of two transcripts (1-based), or null; lines that differ only by a known
 * difference are skipped and listed in `known`.
 * @returns {{ line: number, wasm: string, twin: string } | null}
 */
export function firstDifferentLine(a, b, known = []) {
  if (a === b) return null;
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const defect = knownDifference(x[i], y[i]);
    if (defect) {
      known.push({ line: i + 1, defect });
      continue;
    }
    return { line: i + 1, wasm: (x[i] ?? '<end>').slice(0, 300), twin: (y[i] ?? '<end>').slice(0, 300) };
  }
  return known.length ? null : { line: 0, wasm: `${a.length} bytes`, twin: `${b.length} bytes` };
}

/**
 * @typedef {{ id: string, label: string, dir: string, script: string, onWasm?: (transcript: string) => void }} ScriptJob
 */

/** Hand-written scripts: copy scripts/ to dir, assemble every .X68 there. @returns {Promise<ScriptJob[]>} */
async function handWritten(workDir) {
  const { assemble } = await assemblerModule();
  const dir = join(workDir, 'scripts');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const source = join(here, 'scripts');
  for (const name of readdirSync(source)) {
    copyFileSync(join(source, name), join(dir, name));
    if (extname(name).toLowerCase() !== '.x68') continue;
    const result = await assemble(name, { [name]: new Uint8Array(readFileSync(join(source, name))) }, {}, TIME);
    if (result.errorCount || !result.sRecord)
      throw new Error(`scripts/${name} does not assemble: ${JSON.stringify(result.messages)}`);
    writeFileSync(join(dir, result.sRecordName), result.sRecord);
    writeFileSync(join(dir, result.listingName), result.listing);
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sim'))
    .map((name) => ({
      id: `script-${basename(name, '.sim')}`,
      label: `scripts/${name}`,
      dir,
      script: readFileSync(join(dir, name), 'latin1'),
    }));
}

/** Standard scripts for the engine's fixtures and the corpus. @returns {Promise<ScriptJob[]>} */
async function standardJobs(workDir, local, log) {
  const jobs = [];
  const fixtures = join(repo, 'engine', 'sim', 'test', 'fixtures');
  if (existsSync(fixtures)) {
    for (const name of readdirSync(fixtures)
      .filter((n) => /\.S68$/i.test(n))
      .sort()) {
      const dir = join(workDir, 'fixtures', basename(name, extname(name)));
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(fixtures, name), join(dir, 'prog.S68'));
      const l68 = join(fixtures, basename(name, extname(name)) + '.L68');
      if (existsSync(l68)) copyFileSync(l68, join(dir, 'prog.L68'));
      jobs.push({
        id: `fixture-${basename(name, extname(name))}`,
        label: `engine/sim/test/fixtures/${name}`,
        dir,
        script: standardScript(name, existsSync(l68)),
      });
    }
  }
  const { assemble } = await assemblerModule();
  let index = 0;
  let skipped = 0;
  for (const path of corpusFiles({ local })) {
    const p = await loadProgram(path);
    const files = new Map(
      p.folder.map((f) => [basename(f), f === path ? p.stripped : new Uint8Array(readFileSync(f))]),
    );
    files.set(p.mainName, p.stripped);
    const result = await assemble(
      p.mainName,
      files,
      { tabType: p.tabType ? 'fixed' : 'assembly', tabSize: p.tabSize },
      TIME,
    );
    if (!result.sRecord || result.fatal) {
      skipped++;
      continue;
    }
    const dir = join(workDir, 'corpus', String(index).padStart(4, '0'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'prog.S68'), result.sRecord);
    if (result.listing) writeFileSync(join(dir, 'prog.L68'), result.listing);
    jobs.push({ id: `corpus-${index}`, label: p.rel, dir, script: standardScript(p.mainName, !!result.listing) });
    index++;
  }
  log(`simulator twins: ${jobs.length} standard scripts (${skipped} corpus files without an S-record skipped)`);
  return jobs;
}

/**
 * @param {{ variants: string[], workDir: string, local?: boolean, jobs?: number, log?: (l: string) => void,
 *   extraJobs?: ScriptJob[], standard?: boolean }} options
 * @returns {Promise<{ failures: string[], compared: number, byKind: Record<string, number> }>}
 */
export async function compareSim(options) {
  const log = options.log ?? (() => {});
  const variants = options.variants.filter((v) => existsSync(simTwinPath(v)));
  const jobs = [
    ...(await handWritten(options.workDir)),
    ...(options.standard === false ? [] : await standardJobs(options.workDir, options.local, log)),
    ...(options.extraJobs ?? []),
  ];
  const failures = [];
  const notes = [];
  const byKind = {};
  let compared = 0;
  const queue = jobs.slice();
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const scriptPath = join(job.dir, `${job.id}.sim`);
      writeFileSync(scriptPath, job.script, 'latin1');
      const runs = variants.map(async (v) => {
        const base = join(options.workDir, 'runs', `${job.id}-${v}`);
        rmSync(base, { recursive: true, force: true });
        for (const sub of ['sandbox', 'work']) mkdirSync(join(base, sub), { recursive: true });
        const out = join(base, 'transcript.txt');
        const r = await runProcess(
          simTwinPath(v),
          ['--script', scriptPath, '--sandbox', join(base, 'sandbox'), '--work', join(base, 'work'), '--out', out],
          600_000,
        );
        return { v, base, code: r.code, err: r.err, transcript: existsSync(out) ? readFileSync(out, 'latin1') : '' };
      });
      // The WebAssembly side runs in its own Node process too (sim-script.mjs), so that the workers
      // run in parallel rather than one after another on this thread.
      const wasmOut = join(options.workDir, 'runs', `${job.id}-wasm.txt`);
      mkdirSync(dirname(wasmOut), { recursive: true });
      const w = await runProcess(
        process.execPath,
        [join(here, 'sim-script.mjs'), '--script', scriptPath, '--out', wasmOut],
        600_000,
      );
      if (w.code !== 0 || !existsSync(wasmOut)) {
        failures.push(`wasm, ${job.label}: exit code ${w.code} ${w.err.trim().slice(0, 300)}`);
        await Promise.all(runs);
        continue;
      }
      const wasm = readFileSync(wasmOut, 'latin1');
      rmSync(wasmOut, { force: true });
      job.onWasm?.(wasm);
      for (const r of await Promise.all(runs)) {
        if (r.code !== 0) {
          failures.push(`sim-${r.v}, ${job.label}: exit code ${r.code} ${r.err.trim().slice(0, 300)}`);
          continue;
        }
        const known = [];
        const diff = firstDifferentLine(wasm, r.transcript, known);
        for (const k of known)
          notes.push(`sim-${r.v}, ${job.label}: transcript line ${k.line}: known defect ${k.defect}`);
        if (diff) {
          writeFileSync(join(r.base, 'wasm-transcript.txt'), wasm, 'latin1');
          failures.push(
            `sim-${r.v}, ${job.label}: transcript line ${diff.line}: wasm \`${diff.wasm}\` / twin \`${diff.twin}\` (kept in ${r.base})`,
          );
        } else {
          rmSync(r.base, { recursive: true, force: true });
          compared++;
          const kind = job.id.replace(/-.*/, '');
          byKind[kind] = (byKind[kind] ?? 0) + 1;
        }
      }
      if (!failures.some((f) => f.includes(job.label))) rmSync(scriptPath, { force: true });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.jobs ?? 3, 6)) }, worker));
  return { failures, notes, compared, byKind, scripts: jobs.length };
}
