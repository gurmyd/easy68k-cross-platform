#!/usr/bin/env node
// `npm run oracle:twins`: build the native twins with MSVC and compare them with the WebAssembly
// engines (ARCHITECTURE.md 6.1 L1, 6.2.1); also run the 68000 single-step suite against the
// frozen baseline of the CPU catalogue (L7). Windows only; needs engine/dist.
//
//     node tests/oracle/native-twin/run.mjs [options]
//
//   --local           also the example programs of reference/examples and build/corpus-local
//   --singlestep      fetch the single-step suite if needed and include it (default: included when
//                     it is already in build/singlestep, and always in CI)
//   --no-singlestep   leave it out
//   --engine-twins    also build the assembler engine's own twins (engine/asm/native/build.mjs, into
//                     build/asm-native) and run its test engine/asm/test/native.test.mjs (default in CI)
//   --skip-build      use twins that are already built
//   --jobs N          parallel processes (default 4, at most 6)
//
// Writes build/native-twin/report.md (and appends a summary to $GITHUB_STEP_SUMMARY in CI). Exit
// code 1 on any difference, build failure or baseline change.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseFile, compareWithBaseline, readBaseline } from '../../conformance/cpu/catalogue.mjs';
import { ensureSuite, presentFiles } from '../../conformance/cpu/fetch-suite.mjs';
import { readSuiteFile, scriptFor } from '../../conformance/cpu/singlestep.mjs';
import { ASM_TWIN_VARIANTS, asmTwinPath, buildAsmTwin } from './build-asm-twins.mjs';
import { SIM_TWIN_VARIANTS, buildSimTwin, simTwinPath, simTwinState } from './build-sim-twin.mjs';
import { compareAsm } from './compare-asm.mjs';
import { compareSim } from './compare-sim.mjs';
import { findVcvars32 } from './msvc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const workDir = join(repo, 'build', 'native-twin', 'work');
const reportPath = join(repo, 'build', 'native-twin', 'report.md');

async function main() {
  const argv = process.argv.slice(2);
  const has = (flag) => argv.includes(flag);
  const jobsAt = argv.indexOf('--jobs');
  const jobs = Math.max(1, Math.min(jobsAt >= 0 ? Number(argv[jobsAt + 1]) : 4, 6));
  const ci = process.env.CI === 'true';
  const log = (line) => console.log(line);
  const started = Date.now();
  if (process.platform !== 'win32') {
    console.log('oracle:twins: the native twins are built with MSVC and run on Windows only; nothing to do here.');
    return 0;
  }
  for (const file of ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs']) {
    if (!existsSync(join(repo, 'engine', 'dist', file))) {
      console.error(
        `oracle:twins: engine/dist/${file} is missing; build the engines (npm run build:engines) or fetch them first.`,
      );
      return 1;
    }
  }
  const failures = [];
  const md = ['# Native twins', '', `Run of \`tests/oracle/native-twin/run.mjs\` on ${new Date().toISOString()}.`, ''];

  // ---- build ------------------------------------------------------------------------------
  log(`MSVC: ${findVcvars32()}`);
  for (const v of SIM_TWIN_VARIANTS) {
    // --skip-build keeps only a twin built from today's sources; a stale one is rebuilt
    const state = has('--skip-build') ? simTwinState(v) : 'missing';
    if (state === 'current') continue;
    if (state === 'stale') log(`sim-${v} was built from other sources than today's; rebuilding it`);
    try {
      log(`built ${await buildSimTwin(v)}`);
    } catch (error) {
      failures.push(
        `build of sim-${v} failed: ${String(error instanceof Error ? error.message : error).slice(0, 2000)}`,
      );
    }
  }
  for (const v of ASM_TWIN_VARIANTS) {
    if (has('--skip-build') && existsSync(asmTwinPath(v))) continue;
    try {
      log(`built ${await buildAsmTwin(v, { log })}`);
    } catch (error) {
      failures.push(
        `build of asm-${v} failed: ${String(error instanceof Error ? error.message : error).slice(0, 2000)}`,
      );
    }
  }

  // ---- the assembler engine's own twins and test ---------------------------------------------
  if (has('--engine-twins') || ci) {
    const env = { ...process.env, VCVARS32: findVcvars32() };
    const build = spawnSync(process.execPath, [join(repo, 'engine', 'asm', 'native', 'build.mjs')], {
      env,
      encoding: 'utf8',
    });
    log(`engine/asm/native/build.mjs: exit ${build.status}\n${(build.stdout + build.stderr).trim()}`);
    if (build.status !== 0) failures.push(`engine/asm/native/build.mjs failed (exit ${build.status})`);
    else {
      const test = spawnSync(process.execPath, ['--test', 'test/native.test.mjs'], {
        cwd: join(repo, 'engine', 'asm'),
        env,
        encoding: 'utf8',
      });
      const tail = (test.stdout + test.stderr)
        .trim()
        .split(/\r?\n/)
        .filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l));
      log(`engine/asm/test/native.test.mjs: exit ${test.status}; ${tail.join('; ')}`);
      md.push(
        "## The assembler engine's own twins",
        '',
        `\`node --test engine/asm/test/native.test.mjs\`: exit ${test.status}; ${tail.join('; ')}`,
        '',
      );
      if (test.status !== 0)
        failures.push(`engine/asm/test/native.test.mjs failed:\n${(test.stdout + test.stderr).slice(-3000)}`);
    }
  }

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // ---- assembler ---------------------------------------------------------------------------------
  const asm = await compareAsm({
    variants: ASM_TWIN_VARIANTS,
    local: has('--local'),
    jobs,
    log,
    workDir: join(workDir, 'asm'),
  });
  failures.push(...asm.failures);
  md.push(
    '## Assembler twins against the WebAssembly assembler',
    '',
    `${asm.caseRuns} runs of the engine's test programs and ${asm.programs} corpus programs x 2 option sets.`,
    '',
    '| Twin | Same | Differs where a patch applies | Failed |',
    '|---|---:|---:|---:|',
  );
  for (const [v, c] of Object.entries(asm.counts))
    md.push(`| asm-${v} | ${c.same} | ${c['differs (patch applies)']} | ${c.failed} |`);
  md.push('');
  for (const v of ASM_TWIN_VARIANTS)
    if (!asm.counts[v]) failures.push(`asm-${v} was not built, so it was not compared`);

  // ---- simulator, with the single-step suite --------------------------------------------------
  const extraJobs = [];
  const baseline = readBaseline();
  const cpu = { files: 0, tests: 0, deviating: 0, problems: [] };
  let suitePaths = presentFiles();
  if (!has('--no-singlestep') && (has('--singlestep') || ci) && !suitePaths)
    suitePaths = await ensureSuite({ jobs, log });
  if (has('--no-singlestep')) suitePaths = null;
  if (suitePaths) {
    const ssDir = join(workDir, 'singlestep');
    mkdirSync(ssDir, { recursive: true });
    for (const path of suitePaths) {
      const name = basename(path);
      let tests = null;
      extraJobs.push({
        id: `singlestep-${name.replace(/\.json\.gz$/, '')}`,
        label: `single-step ${name}`,
        dir: ssDir,
        get script() {
          tests ??= readSuiteFile(path);
          return scriptFor(tests);
        },
        onWasm: (transcript) => {
          tests ??= readSuiteFile(path);
          const result = analyseFile(name, tests, transcript);
          cpu.files++;
          cpu.tests += result.tests;
          cpu.deviating += result.deviating;
          cpu.problems.push(...compareWithBaseline(name, result, baseline?.files?.[name]));
          tests = null;
        },
      });
    }
  }
  const sim = await compareSim({
    variants: SIM_TWIN_VARIANTS,
    local: has('--local'),
    // each worker runs three processes at once (wasm, /O2 twin, /Od twin)
    jobs: Math.max(1, Math.floor(jobs / 3)),
    log,
    workDir: join(workDir, 'sim'),
    extraJobs,
  });
  failures.push(...sim.failures);
  md.push(
    '## Simulator twins against the WebAssembly simulator',
    '',
    `${sim.scripts} scripts; transcripts identical: ${sim.compared} of ${sim.scripts * SIM_TWIN_VARIANTS.length} twin runs.`,
    '',
    '| Kind | Identical twin runs |',
    '|---|---:|',
  );
  for (const [kind, n] of Object.entries(sim.byKind)) md.push(`| ${kind} | ${n} |`);
  md.push('');
  for (const v of SIM_TWIN_VARIANTS)
    if (!existsSync(simTwinPath(v))) failures.push(`sim-${v} was not built, so it was not compared`);

  if (suitePaths) {
    md.push(
      '## CPU catalogue baseline (68000 single-step suite)',
      '',
      `${cpu.files} files, ${cpu.tests} tests, ${cpu.deviating} deviate from the real 68000; ${cpu.problems.length ? `${cpu.problems.length} difference(s) from baseline.json` : 'matches tests/conformance/cpu/baseline.json'}.`,
      '',
    );
    failures.push(...cpu.problems.map((p) => `CPU baseline: ${p}`));
  } else {
    md.push(
      '## CPU catalogue baseline',
      '',
      'Not run: the single-step suite is not in build/singlestep (use --singlestep).',
      '',
    );
  }

  const notes = [...asm.notes, ...sim.notes];
  md.push('## Expected differences', '', notes.length ? `${notes.length} (not failures):` : 'None.', '');
  for (const n of notes) md.push(`- ${n}`);
  md.push('');
  md.push(
    '## Result',
    '',
    failures.length ? `**${failures.length} failure(s):**` : '**No unexpected differences.**',
    '',
  );
  for (const f of failures) md.push(`- ${f.replace(/\r?\n/g, ' ').slice(0, 1500)}`);
  md.push('', `Time: ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, md.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  log(md.slice(4).join('\n'));
  log(`report: ${reportPath}`);
  return failures.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(String(error instanceof Error ? error.stack : error));
    process.exit(1);
  });
