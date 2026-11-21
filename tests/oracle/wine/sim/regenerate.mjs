#!/usr/bin/env node
// `npm run oracle:wine:sim`: runs the simulator conformance programs (tests/conformance/sim) in the
// OFFICIAL SIM68K.exe v5.16.1 under Wine and records what it produced (ARCHITECTURE.md 6.1 layer
// L4, 6.2.2, 6.4).
//
//     node tests/oracle/wine/sim/regenerate.mjs [options]
//
//   --only text      only programs whose id contains the text (may be given more than once)
//   --containers N   containers to run in parallel (default 4, at most 6; each gets one CPU)
//   --check          change nothing; compare the results with golden/manifest.json, exit 1 when a
//                    hash or a status differs
//   --report         only rewrite golden/REPORT.md from the manifest (no Docker needed)
//   --image NAME     Docker image (default easy68k-oracle-wine, from `npm run oracle:wine:build`)
//   --official DIR   the unpacked official distribution (default reference/official-extracted, or
//                    $EASY68K_OFFICIAL_DIR; see ../common/fetch-official.mjs)
//   --file F --recipe R [--switches "/e /b"] [--out DIR]
//                    run one program of your own with one recipe (report, outlog, log:1..3,
//                    log:N+out) and print what happened; nothing is recorded. F is an .X68 (the
//                    official editor assembles it; it may INCLUDE files beside it) or an .S68 (run
//                    as it is, with the .L68 beside it if there is one). run-report.sh and
//                    run-log.sh call this.
//
// What a run does:
//   1. lists the programs and their recipes (tests/conformance/sim/programs.ts);
//   2. writes a job list and runs it in N containers (sim_corpus.sh, sim_batch.py): each program is
//      assembled by the official EDIT68K.exe, then run by SIM68K.exe once per recipe;
//   3. for every result: hashes the official .S68 and the masked .L68, and the masked artifacts
//      (result.bin, the execution log, the output log); stores the artifacts as goldens under
//      tests/conformance/sim/golden/<suite>/ (execution logs gzipped); a golden is rewritten only
//      when its masked content changed;
//   4. rewrites golden/manifest.json and golden/REPORT.md (every run without a result, and why).
//
// The exit status is 1 when a run that had a result in the manifest has none now, or with --check
// when anything differs. The official programs run only inside the container; nothing of them is
// copied to the host.
//
// Owner: T3.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  GOLDEN_DIR,
  GOLDEN_MANIFEST_PATH,
  REPO_ROOT,
  SIM_CONFORMANCE_DIR,
  artifactsOf,
  countLoggedInstructions,
  listPrograms,
  loadGoldenManifest,
  maskArtifact,
  maskListing,
  officialFilesOf,
  parseHeader,
  parseRecipe,
  recipeId,
  sha256Hex,
} from '../../../conformance/sim/programs.ts';
import {
  DEFAULT_IMAGE,
  OFFICIAL_SHA256,
  assertImageCurrent,
  assertOfficialFolder,
  bind,
  runContainer,
  wineVersion,
} from '../common/docker.mjs';

const DRIVER_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const WINE_DIRECTORY = resolve(DRIVER_DIRECTORY, '..');
const WORK_ROOT = join(REPO_ROOT, 'build', 'oracle-wine', 'sim');
export const REPORT_PATH = join(GOLDEN_DIR, 'REPORT.md');
export const MAX_CONTAINERS = 6;

/** Seconds a recipe may take in the official program when the program does not say. */
export function defaultTimeout(recipe) {
  // Measured: a report program that writes 70 lines needs about 30 s under Wine in a one-CPU container.
  return recipe.kind === 'report' ? 240 : recipe.kind === 'outlog' ? 240 : 1800;
}

// --- 1. jobs ----------------------------------------------------------------------------------------

/** The job list of sim_batch.py for these programs: one job per program and recipe. */
export function planJobs(programs) {
  const jobs = [];
  for (const program of programs) {
    for (const recipe of program.recipes) {
      const lower = program.switches.map((s) => s.toLowerCase());
      jobs.push({
        id: `${program.id}:${recipeId(recipe)}`,
        program: program.id,
        recipe: recipe.kind,
        recipeId: recipeId(recipe),
        source: program.source,
        switches: program.switches.join(' '),
        // The shipped sim68K.dat has exceptions and bit field off; the switches turn them on.
        exceptions: lower.includes('/e') ? 1 : 0,
        bitfield: lower.includes('/b') ? 1 : 0,
        execLog: recipe.kind === 'log' ? recipe.execType : 0,
        outLog: recipe.kind === 'outlog' || (recipe.kind === 'log' && recipe.withOutput) ? 1 : 0,
        timeout: program.timeoutSeconds ?? defaultTimeout(recipe),
        files: program.files,
        out: `${program.id.replace('/', '__')}__${recipeId(recipe).replace(/[:+]/g, '_')}`,
      });
    }
  }
  return jobs;
}

/**
 * The jobs in the order sim_batch.py deals their programs out to the containers (every N-th program
 * to container K, in the order of first appearance): the programs with the longest allowed time first,
 * so that the execution logs spread over all containers instead of queueing in one or two.
 */
export function dealOrder(jobs) {
  const longest = new Map();
  for (const job of jobs) longest.set(job.source, Math.max(longest.get(job.source) ?? 0, job.timeout));
  return [...jobs].sort(
    (a, b) =>
      (longest.get(b.source) ?? 0) - (longest.get(a.source) ?? 0) ||
      (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
  );
}

/** The job's fields that sim_batch.py reads. */
export function jobLine(job) {
  const { id, recipe, source, switches, exceptions, bitfield, execLog, outLog, timeout, files, out } = job;
  return JSON.stringify({ id, recipe, source, switches, exceptions, bitfield, execLog, outLog, timeout, files, out });
}

// --- 2. containers ----------------------------------------------------------------------------------

async function runJobs(jobs, { image, official, corpus, containers, workDirectory }) {
  const jobDirectory = join(workDirectory, 'job');
  const outDirectory = join(workDirectory, 'out');
  mkdirSync(jobDirectory, { recursive: true });
  mkdirSync(outDirectory, { recursive: true });
  writeFileSync(join(jobDirectory, 'jobs.jsonl'), `${dealOrder(jobs).map(jobLine).join('\n')}\n`);
  const sources = new Set(jobs.map((job) => job.source));
  const count = Math.max(1, Math.min(containers, sources.size));
  const run = `${process.pid}-${Date.now().toString(36)}`;
  const mounts = [
    ...bind(official, '/mnt/official'),
    ...bind(DRIVER_DIRECTORY, '/mnt/sim-driver'),
    ...bind(corpus, '/mnt/corpus'),
    ...bind(jobDirectory, '/mnt/job'),
    ...bind(outDirectory, '/mnt/out', false),
    // One CPU per container, so that a run never takes more than MAX_CONTAINERS CPUs of the host.
    '--cpus',
    '1',
  ];
  const started = Date.now();
  const statuses = await Promise.all(
    Array.from({ length: count }, (_, shard) =>
      runContainer({
        name: `easy68k-oracle-sim-${run}-${shard}`,
        image,
        mounts,
        command: ['bash', '/mnt/sim-driver/sim_corpus.sh', String(shard), String(count)],
        logFile: join(workDirectory, `container-${shard}.log`),
      }),
    ),
  );
  const records = new Map();
  for (const name of readdirSync(outDirectory).filter((entry) => /^manifest-shard\d+\.jsonl$/.test(entry))) {
    for (const line of readFileSync(join(outDirectory, name), 'utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      const job = jobs.find((j) => j.id === record.id);
      if (job) records.set(record.id, { ...record, outDirectory: join(outDirectory, job.out) });
    }
  }
  const failed = statuses.flatMap((status, shard) => (status === 0 ? [] : [shard]));
  if (failed.length > 0) console.error(`container(s) ${failed.join(', ')} ended with an error; see ${workDirectory}`);
  console.log(`${records.size} of ${jobs.length} jobs reported in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return records;
}

// --- 3. results -------------------------------------------------------------------------------------

/** Reads a file of a job's output folder, matching the name without regard to letter case. */
function readOutput(directory, name) {
  if (!existsSync(directory)) return null;
  const found = readdirSync(directory).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return found ? new Uint8Array(readFileSync(join(directory, found))) : null;
}

/** Golden files are stored as the official program wrote them; execution logs gzipped. */
export function isGzipped(goldenName) {
  return goldenName.endsWith('.RunLog.txt');
}

export function readGolden(goldenName) {
  const path = join(GOLDEN_DIR, goldenName + (isGzipped(goldenName) ? '.gz' : ''));
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return new Uint8Array(isGzipped(goldenName) ? gunzipSync(bytes) : bytes);
}

function writeGolden(goldenName, bytes) {
  const path = join(GOLDEN_DIR, goldenName + (isGzipped(goldenName) ? '.gz' : ''));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, isGzipped(goldenName) ? gzipSync(bytes, { level: 9 }) : bytes);
}

/**
 * The manifest entry of one recipe from what sim_batch.py recorded, and the artifacts' bytes.
 * A run counts only when every file the recipe should produce is there.
 */
export function recipeResult(program, recipe, record, read) {
  const stem = program.name;
  if (!record) return { entry: { status: 'failed', error: 'no record (the container ended early)', artifacts: {} } };
  const files = officialFilesOf(recipe, stem);
  const artifacts = {};
  const bytes = {};
  let missing = null;
  for (const [kind, file] of Object.entries(files)) {
    const data = read(file);
    if (!data) {
      missing ??= file;
      continue;
    }
    bytes[kind] = data;
    artifacts[kind] = { sha256: sha256Hex(maskArtifact(kind, data)), bytes: data.length };
  }
  const ok = record.status === 'ok' && missing === null;
  const entry = {
    status: ok ? 'ok' : 'failed',
    ...(ok ? {} : { error: record.error ?? `${missing} was not written` }),
    ...(record.seconds !== undefined ? { seconds: record.seconds } : {}),
    artifacts: ok ? artifacts : {},
  };
  if (ok && bytes.runlog) entry.instructions = countLoggedInstructions(maskArtifact('runlog', bytes.runlog));
  return { entry, bytes: ok ? bytes : {} };
}

/** golden/REPORT.md: the counts, and every run without a result. */
export function renderReport(manifest, programs) {
  const lines = [
    '# Official SIM68K.exe results of the simulator conformance programs',
    '',
    'Written by `npm run oracle:wine:sim` (tests/oracle/wine/sim/regenerate.mjs); do not edit.',
    `Wine: ${manifest.wine}. Updated: ${manifest.updated}.`,
    '',
  ];
  let runs = 0;
  let ok = 0;
  let logs = 0;
  let instructions = 0;
  let reports = 0;
  const failures = [];
  for (const program of programs) {
    const record = manifest.programs[program.id];
    for (const recipe of program.recipes) {
      const id = recipeId(recipe);
      runs += 1;
      const entry = record?.recipes[id];
      if (entry?.status === 'ok') {
        ok += 1;
        if (recipe.kind === 'report') reports += 1;
        if (recipe.kind === 'log') {
          logs += 1;
          instructions += entry.instructions ?? 0;
        }
      } else {
        failures.push(`| \`${program.id}\` | ${id} | ${(entry?.error ?? 'not run yet').replace(/\|/g, '\\|')} |`);
      }
    }
  }
  lines.push(
    `| | Count |`,
    `|---|---|`,
    `| Programs | ${programs.length} |`,
    `| Runs (program x recipe) | ${runs} |`,
    `| Runs with an official result | ${ok} |`,
    `| - self-reporting programs (result.bin) | ${reports} |`,
    `| - execution logs | ${logs} (${instructions} instructions) |`,
    '',
  );
  if (failures.length > 0) {
    lines.push(
      '## Runs without an official result',
      '',
      '| Program | Recipe | Why |',
      '|---|---|---|',
      ...failures,
      '',
    );
  } else {
    lines.push('Every run has an official result.', '');
  }
  return lines.join('\n');
}

// --- 4. command line --------------------------------------------------------------------------------

export function parseArguments(argv) {
  const options = {
    only: [],
    containers: 4,
    check: false,
    reportOnly: false,
    image: DEFAULT_IMAGE,
    official: process.env.EASY68K_OFFICIAL_DIR ?? join(REPO_ROOT, 'reference', 'official-extracted'),
    file: null,
    recipe: 'report',
    switches: '',
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${argument} needs a value`);
      return next;
    };
    if (argument === '--only') options.only.push(value());
    else if (argument === '--containers') options.containers = Number(value());
    else if (argument === '--check') options.check = true;
    else if (argument === '--report') options.reportOnly = true;
    else if (argument === '--image') options.image = value();
    else if (argument === '--official') options.official = resolve(value());
    else if (argument === '--file') options.file = resolve(value());
    else if (argument === '--recipe') options.recipe = value();
    else if (argument === '--switches') options.switches = value();
    else if (argument === '--out') options.out = resolve(value());
    else throw new Error(`unknown argument ${argument} (see the comment at the top of regenerate.mjs)`);
  }
  if (!Number.isInteger(options.containers) || options.containers < 1)
    throw new Error('--containers must be 1 or more');
  options.containers = Math.min(options.containers, MAX_CONTAINERS);
  parseRecipe(options.recipe);
  return options;
}

function preflight(options) {
  assertOfficialFolder(options.official);
  assertImageCurrent(options.image, WINE_DIRECTORY);
}

/** --file: one program of the caller's; prints what happened, records nothing. */
async function runOneFile(options) {
  preflight(options);
  // A program of the suite keeps its folder structure, so that its INCLUDE '..\dumplib.X68' works.
  const inSuite = !relative(SIM_CONFORMANCE_DIR, options.file).startsWith('..');
  const folder = inSuite ? SIM_CONFORMANCE_DIR : dirname(options.file);
  const source = relative(folder, options.file).replaceAll('\\', '/');
  const name = source.split('/').pop();
  const program = parseHeader(
    [`* @item ${name}`, `* @recipe ${options.recipe}`, options.switches ? `* @switches ${options.switches}` : ''].join(
      '\n',
    ),
    'logs',
    name.replace(/\.(x68|s68)$/i, ''),
    source,
  );
  const workDirectory = join(WORK_ROOT, `file-${process.pid}-${Date.now().toString(36)}`);
  const records = await runJobs(planJobs([program]), {
    ...options,
    corpus: folder,
    containers: 1,
    workDirectory,
  });
  const record = [...records.values()][0];
  console.log(JSON.stringify(record ?? { error: 'no record' }, null, 2));
  const out = options.out ?? join(workDirectory, 'out');
  if (record && options.out) {
    mkdirSync(out, { recursive: true });
    for (const entry of readdirSync(record.outDirectory)) {
      writeFileSync(join(out, entry), readFileSync(join(record.outDirectory, entry)));
    }
  }
  console.log(`outputs: ${record ? (options.out ?? record.outDirectory) : workDirectory}`);
  return record?.status === 'ok' ? 0 : 1;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.file) return runOneFile(options);
  const all = listPrograms();
  const previous = loadGoldenManifest();
  if (options.reportOnly) {
    if (!previous) throw new Error(`${relative(REPO_ROOT, GOLDEN_MANIFEST_PATH)} does not exist yet`);
    writeFileSync(REPORT_PATH, renderReport(previous, all));
    return 0;
  }
  const programs = options.only.length ? all.filter((p) => options.only.some((text) => p.id.includes(text))) : all;
  if (programs.length === 0) throw new Error('no program matches');
  preflight(options);
  const workDirectory = join(WORK_ROOT, `${new Date().toISOString().replace(/[:.]/g, '-')}`);
  rmSync(workDirectory, { recursive: true, force: true });
  const jobs = planJobs(programs);
  console.log(
    `${programs.length} programs, ${jobs.length} runs, ${options.containers} containers; work: ${workDirectory}`,
  );
  const records = await runJobs(jobs, { ...options, corpus: SIM_CONFORMANCE_DIR, workDirectory });

  const manifest = {
    wine: wineVersion(options.image),
    official: { ...OFFICIAL_SHA256 },
    updated: new Date().toISOString().slice(0, 10),
    programs: { ...(previous?.programs ?? {}) },
  };
  // Programs that no longer exist leave the manifest.
  for (const id of Object.keys(manifest.programs)) if (!all.some((p) => p.id === id)) delete manifest.programs[id];

  const differences = [];
  let lost = 0;
  for (const program of programs) {
    const source = readFileSync(join(SIM_CONFORMANCE_DIR, program.source));
    const before = previous?.programs[program.id];
    const entry = { sourceSha256: sha256Hex(source), s68Sha256: null, l68Sha256: null, recipes: {} };
    for (const recipe of program.recipes) {
      const id = recipeId(recipe);
      const record = records.get(`${program.id}:${id}`);
      const read = (file) => (record ? readOutput(record.outDirectory, file) : null);
      const s68 = read(`${program.name}.S68`);
      const l68 = read(`${program.name}.L68`);
      if (s68 && entry.s68Sha256 === null) entry.s68Sha256 = sha256Hex(s68);
      if (l68 && entry.l68Sha256 === null) entry.l68Sha256 = sha256Hex(maskListing(l68));
      const { entry: result, bytes } = recipeResult(program, recipe, record, read);
      entry.recipes[id] = result;
      const old = before?.recipes[id];
      if (old?.status === 'ok' && result.status !== 'ok') {
        lost += 1;
        console.error(`LOST ${program.id} ${id}: ${result.error}`);
      }
      for (const artifact of artifactsOf(program).filter((a) => a.recipe === id)) {
        const now = result.artifacts[artifact.kind]?.sha256;
        const was = old?.artifacts?.[artifact.kind]?.sha256;
        if (now && was && now !== was)
          differences.push(`${artifact.golden}: ${was.slice(0, 12)} -> ${now.slice(0, 12)}`);
        if (!options.check && now && bytes[artifact.kind]) {
          const stored = readGolden(artifact.golden);
          if (!stored || sha256Hex(maskArtifact(artifact.kind, stored)) !== now)
            writeGolden(artifact.golden, bytes[artifact.kind]);
        }
      }
      console.log(
        `${result.status === 'ok' ? 'ok    ' : 'FAILED'} ${program.id} ${id}${result.error ? `: ${result.error}` : ''}`,
      );
    }
    if (before && before.s68Sha256 && entry.s68Sha256 && before.s68Sha256 !== entry.s68Sha256) {
      differences.push(`${program.id}.S68: ${before.s68Sha256.slice(0, 12)} -> ${entry.s68Sha256.slice(0, 12)}`);
    }
    manifest.programs[program.id] = entry;
  }
  manifest.programs = Object.fromEntries(Object.entries(manifest.programs).sort(([a], [b]) => (a < b ? -1 : 1)));

  if (options.check) {
    for (const line of differences) console.error(`DIFFERS ${line}`);
    console.log(
      differences.length === 0 && lost === 0 ? 'The official program produced what the repository holds.' : '',
    );
    return differences.length === 0 && lost === 0 ? 0 : 1;
  }
  // Goldens of programs or recipes that no longer exist are removed.
  const wanted = new Set(all.flatMap((p) => artifactsOf(p).map((a) => a.golden + (isGzipped(a.golden) ? '.gz' : ''))));
  for (const suite of readdirSync(GOLDEN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(join(GOLDEN_DIR, suite.name))) {
      if (!wanted.has(`${suite.name}/${file}`)) rmSync(join(GOLDEN_DIR, suite.name, file));
    }
  }
  writeFileSync(GOLDEN_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(REPORT_PATH, renderReport(manifest, all));
  for (const line of differences) console.log(`changed ${line}`);
  console.log(`wrote ${relative(REPO_ROOT, GOLDEN_MANIFEST_PATH)} and ${relative(REPO_ROOT, REPORT_PATH)}`);
  return lost === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (status) => process.exit(status),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}
