#!/usr/bin/env node
// `npm run oracle:wine:asm`: assembles the test corpus with the OFFICIAL EDIT68K.exe v5.16.1 under
// Wine and records what it produced (ARCHITECTURE.md 6.1 layer L2, 6.2.2, 6.3).
//
//     node tests/oracle/wine/asm/regenerate.mjs [options]
//
//   --sets a,b       sets to run: official, github-mit, conformance, site
//                    (default: the three tracked sets; `site` needs tools/fetch-site-examples.mjs first)
//   --only text      only programs whose id contains the text (may be given more than once)
//   --containers N   containers to run in parallel (default 4)
//   --timeout S      seconds allowed per program (default 300)
//   --cpus N         CPUs for all containers together (docker run --cpus, shared out evenly;
//                    default: no limit)
//   --large          also try sources over 1 MB (the editor needs over an hour for them under Wine;
//                    give a matching --timeout). Without it such a run is not tried, and a result
//                    an earlier --large run recorded for the same source is kept
//   --check          change nothing; compare the results with tests/corpus/manifest.json and exit 1
//                    when a hash, a count or a status differs
//   --report         only rewrite golden/REPORT.md from the manifest (no Docker needed)
//   --rehash         only recompute the hashes of the manifest from the stored official outputs
//                    (golden/ and build/golden-local/), after a change of the canonical forms of
//                    compare.ts (no Docker needed; exit 1 when a stored output is missing)
//   --image NAME     Docker image (default easy68k-oracle-wine, from `npm run oracle:wine:build`)
//   --official DIR   the unpacked official distribution (default reference/official-extracted, or
//                    $EASY68K_OFFICIAL_DIR; see ../common/fetch-official.mjs)
//   --file F.X68 [--settings settings.dat] [--out DIR]
//                    assemble one file of your own and print what happened; nothing is recorded
//                    (this is what run.sh calls). With --out the outputs go to DIR and the run's
//                    work files to DIR/work; without it both go to a new folder below
//                    build/oracle-wine/asm
//
// What a run does:
//   1. lists the programs (tests/corpus/official, tests/corpus/github, the conformance programs of
//      tests/conformance/asm, and the `site` set when it was fetched) and the option sets of each;
//   2. writes one settings.dat per option set and a job list, and runs them in N containers;
//   3. for every result: checks the text the official editor handed to its assembler against the
//      editor model, hashes the canonical outputs (../../../conformance/asm/compare.ts), and
//      - tracked sets: stores `<label>.L68` / `<label>.S68` under tests/conformance/asm/golden/
//        (a file is rewritten only when it changed in more than its date line),
//      - `site`: stores the files under build/golden-local/ (git-ignored); only hashes are kept;
//   4. rewrites tests/corpus/manifest.json and tests/conformance/asm/golden/REPORT.md, which
//      names every run the automation could not complete and why.
//
// A run in which the official editor shows a window it must not show (anything but its
// help-viewer message boxes, see asm_batch.py) is a failed run, like a crash. When the editor had
// finished assembling by then, the files it wrote are kept as `<label>.failed.L68` / `.S68`. The one
// exception are the runs of HOST_DEPENDENT_RUNS, whose end after the outputs depends on the host.
// The exit status is 1 when a run that had a result in the manifest has none now.
//
// The official programs run only inside the container. Nothing of them is copied to the host.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  canonicalHashes,
  canonicalListing,
  canonicalSRecord,
  editorLoad,
  listingCounts,
  undefinedSymbolRanges,
} from '../../../conformance/asm/compare.ts';
import {
  GOLDEN_TRACKED,
  MANIFEST_PATH,
  REPO,
  SET_DIRECTORIES,
  goldenDirectory,
  hasOfficialOutput,
  loadManifest,
  outputStem,
  loadOptionSubset,
  sha256Hex,
  sourceFlags,
  sourcePath,
} from '../../../corpus/index.ts';
import {
  DEFAULT_IMAGE,
  assertImageCurrent,
  assertOfficialFolder,
  bind,
  docker,
  runContainer,
  wineVersion,
} from '../common/docker.mjs';
import {
  infrastructureReason,
  repetitionSummary,
  reportRepetitions,
  runWithRepetitions,
} from '../common/infrastructure.mjs';
import { CORPUS_OPTION_SETS, SINGLE_OPTION_SETS, buildSettingsDat, listingOnLabel, optionLabel } from './settings.ts';

const WINE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_INDEX_PATH = join(REPO, 'tests', 'corpus', 'site-examples.json');
const CHECKLIST_PROGRAMS_PATH = join(REPO, 'tests', 'conformance', 'asm', 'checklist', 'programs.json');
export const REPORT_PATH = join(REPO, GOLDEN_TRACKED, 'REPORT.md');
const WORK_ROOT = join(REPO, 'build', 'oracle-wine', 'asm');

/** Sources above this size are not tried unless --large is given (official-oracle §3.2.1). */
export const LARGE_SOURCE_BYTES = 1_000_000;
/** An output above this size is not committed; only its hash is (the manifest says `golden: false`). */
export const MAX_GOLDEN_BYTES = 512 * 1024;

const TRACKED_SETS = ['official', 'github-mit', 'conformance'];
const ALL_SETS = [...TRACKED_SETS, 'site'];

const ORIGIN = {
  official: 'EASy68K v5.16.1 distribution, Examples\\ (http://www.easy68k.com/files/EASy68K.zip)',
  'pacman-mc68000': 'https://github.com/andreumassanet/pacman-mc68000 at 13ca2bcd2ee24cc09a6b55ab3855e58e133b5c57',
  '68k-assembly-learning':
    'https://github.com/sbs-henrywrightson/68k-assembly-learning at 28859a1eddd00f35b5f948fc69b3b39709b851c9',
};

// --- 1. the programs and their option sets ---------------------------------------------------------

function listFiles(directory, prefix = '') {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(join(directory, entry.name), name));
    else out.push(name);
  }
  return out;
}

const isSource = (name) => /\.x68$/i.test(name);

/**
 * A guess, from the source text, whether a program reads the keyboard or the mouse: it loads one
 * of the input tasks of TRAP #15 (2, 4, 5, 7, 19 or 61) into D0 as a number. It misses a program
 * that names the task by a symbol, so the flag is a hint for the simulator tests, not a fact.
 */
export function looksInteractive(source) {
  const text = Buffer.from(source).toString('latin1');
  for (const match of text.matchAll(/^[^*;\r\n]*\bMOVE(?:Q|\.[BWL])?\s+#(\$[0-9A-F]+|\d+)\s*,\s*D0\b/gim)) {
    const literal = match[1];
    const task = literal.startsWith('$') ? Number.parseInt(literal.slice(1), 16) : Number.parseInt(literal, 10);
    if ([2, 4, 5, 7, 19, 61].includes(task)) return true;
  }
  return false;
}

const corpusRuns = () => Object.entries(CORPUS_OPTION_SETS).map(([label, options]) => ({ label, options }));

function describeSource(set, file, interactiveHint) {
  const path = sourcePath({ set, file });
  if (!existsSync(path)) return null;
  const source = new Uint8Array(readFileSync(path));
  const flags = sourceFlags(source);
  if (interactiveHint && looksInteractive(source)) flags.push('interactive');
  return { sha256: sha256Hex(source), bytes: source.length, flags };
}

/**
 * Every program of the given sets with the option sets it is assembled with. A `site` program
 * whose file is not on this machine is returned with `available: false` (its entry in the manifest
 * is then left as it is).
 */
export function planPrograms(sets = TRACKED_SETS) {
  const programs = [];
  const add = (program, interactiveHint) => {
    const facts = describeSource(program.set, program.file, interactiveHint);
    programs.push({ ...program, ...(facts ?? {}), available: facts !== null });
  };
  if (sets.includes('official')) {
    for (const file of listFiles(join(REPO, SET_DIRECTORIES.official)).filter(isSource)) {
      add(
        {
          id: `official/${file}`,
          set: 'official',
          origin: ORIGIN.official,
          licence: 'GPL (EASy68K distribution)',
          file,
          root: '',
          runs: corpusRuns(),
        },
        true,
      );
    }
  }
  if (sets.includes('github-mit')) {
    for (const file of listFiles(join(REPO, SET_DIRECTORIES['github-mit'])).filter(isSource)) {
      const repository = file.split('/')[0];
      add(
        {
          id: `github/${file}`,
          set: 'github-mit',
          origin: ORIGIN[repository],
          licence: 'MIT',
          file,
          root: repository,
          runs: corpusRuns(),
        },
        true,
      );
    }
  }
  if (sets.includes('conformance')) {
    const checklist = JSON.parse(readFileSync(CHECKLIST_PROGRAMS_PATH, 'utf8'));
    for (const program of checklist.programs) {
      const root = `checklist/programs/${program.id}`;
      add({
        id: `checklist/${program.id}`,
        set: 'conformance',
        origin: `written for this project (${program.from === 'T1' ? 'tests/conformance/asm' : program.from}): ${program.title}`,
        licence: 'GPL-2.0-or-later',
        file: `${root}/prog.X68`,
        root,
        runs: program.runs.map((options) => ({ label: optionLabel(options), options })),
      });
    }
    for (const file of listFiles(join(REPO, SET_DIRECTORIES.conformance, 'richedit')).filter(isSource)) {
      add({
        id: `richedit/${file}`,
        set: 'conformance',
        origin: 'written for this project (tests/oracle/wine/asm/gen_richedit_stress.py)',
        licence: 'GPL-2.0-or-later',
        file: `richedit/${file}`,
        root: 'richedit',
        runs: [{ label: 'default', options: {} }],
      });
    }
  }
  if (sets.includes('site')) {
    const index = JSON.parse(readFileSync(SITE_INDEX_PATH, 'utf8'));
    for (const archive of index.archives) {
      for (const entry of archive.files.filter((candidate) => isSource(candidate.path))) {
        const root = `${archive.category}/${archive.name}`;
        const file = `${root}/${entry.path}`;
        const facts = describeSource('site', file, true);
        if (facts && facts.sha256 !== entry.sha256) {
          throw new Error(
            `${file} in ${SET_DIRECTORIES.site} is not the listed file; run node tools/fetch-site-examples.mjs`,
          );
        }
        programs.push({
          id: `site/${file}`,
          set: 'site',
          origin: archive.url,
          licence: 'not redistributable (docs/porting/ground-truth.md 3.2)',
          file,
          root,
          sha256: entry.sha256,
          bytes: entry.bytes,
          flags: facts?.flags,
          available: facts !== null,
          runs: corpusRuns(),
        });
      }
    }
  }
  addSingleOptionRuns(programs);
  return programs;
}

/**
 * Gives every program of the fixed subset (tests/corpus/option-subset.json, 6.9 item 1) one run per
 * assembler option switched alone (SINGLE_OPTION_SETS), after its own runs; a run it already has
 * under the same label is not added twice. Throws when the list names a program of the tracked sets
 * that does not exist, or a label that is not one of the eight.
 */
export function addSingleOptionRuns(programs, subset = loadOptionSubset()) {
  const labels = Object.keys(SINGLE_OPTION_SETS);
  if (subset.options.join() !== labels.join()) {
    throw new Error(
      `option-subset.json names the options ${subset.options.join(', ')}, settings.ts ${labels.join(', ')}`,
    );
  }
  const ids = new Set(subset.files.map((file) => file.id));
  // Checked only against the sets that were planned (a run of `--sets site` plans none of them).
  const planned = new Set(programs.map((program) => program.set));
  for (const id of ids) {
    if (setOfId(id) === 'site')
      throw new Error(`option-subset.json names ${id}: the site set may not be redistributed`);
    if (planned.has(setOfId(id)) && !programs.some((program) => program.id === id)) {
      throw new Error(`option-subset.json names ${id}, which is not a program of the corpus`);
    }
  }
  for (const program of programs) {
    if (!ids.has(program.id)) continue;
    for (const [label, options] of Object.entries(SINGLE_OPTION_SETS)) {
      if (!program.runs.some((run) => run.label === label)) program.runs.push({ label, options });
    }
  }
  return programs;
}

/** The set a program id belongs to, from its first part. */
function setOfId(id) {
  const head = id.split('/')[0];
  return head === 'official' ? 'official' : head === 'github' ? 'github-mit' : head === 'site' ? 'site' : 'conformance';
}

// --- 2. running the official editor ----------------------------------------------------------------

/**
 * Runs jobs in containers. A job: { id, mountKey, source, label, settings: Uint8Array }.
 * `mounts`: { key: host folder } - each is visible to the job as `<key>/<source>`.
 * Resolves with a Map from job id to the record asm_batch.py wrote for it, plus the folder with its
 * outputs in `record.outDirectory`.
 */
export async function runJobs(jobs, { image, official, mounts, containers, timeout, workDirectory, cpus }) {
  const jobDirectory = join(workDirectory, 'job');
  const outDirectory = join(workDirectory, 'out');
  mkdirSync(join(jobDirectory, 'settings'), { recursive: true });
  mkdirSync(outDirectory, { recursive: true });
  const settingsFiles = new Map();
  const lines = jobs.map((job, index) => {
    const key = sha256Hex(job.settings).slice(0, 16);
    if (!settingsFiles.has(key)) {
      settingsFiles.set(key, `settings/${key}.dat`);
      writeFileSync(join(jobDirectory, 'settings', `${key}.dat`), job.settings);
    }
    return JSON.stringify({
      id: job.id,
      source: `${job.mountKey}/${job.source}`,
      options: job.label,
      settings: settingsFiles.get(key),
      out: String(index).padStart(5, '0'),
    });
  });
  // The shards take every N-th job, so the slow programs of one folder spread over the containers.
  writeFileSync(join(jobDirectory, 'jobs.jsonl'), `${lines.join('\n')}\n`);

  const count = Math.max(1, Math.min(containers, jobs.length));
  const run = `${process.pid}-${Date.now().toString(36)}`;
  const mountArguments = [
    ...bind(official, '/mnt/official'),
    ...Object.entries(mounts).flatMap(([key, directory]) => bind(directory, `/mnt/corpus/${key}`)),
    ...bind(jobDirectory, '/mnt/job'),
    ...bind(outDirectory, '/mnt/out', false),
  ];
  // --cpus: the CPUs of all containers together, shared out evenly (docker run --cpus).
  const cpusEach = cpus ? Math.max(0.1, Math.floor((cpus / count) * 100) / 100) : undefined;
  const statuses = await Promise.all(
    Array.from({ length: count }, (_, shard) =>
      runContainer({
        name: `easy68k-oracle-asm-${run}-${shard}`,
        image,
        ...(cpusEach ? { cpus: cpusEach } : {}),
        mounts: mountArguments,
        env: { ASM_TIMEOUT: String(timeout) },
        command: ['/oracle/asm_corpus.sh', String(shard), String(count)],
        logFile: join(workDirectory, `container-${shard}.log`),
      }),
    ),
  );
  const records = new Map();
  for (const name of readdirSync(outDirectory).filter((entry) => /^manifest-shard\d+\.jsonl$/.test(entry))) {
    for (const line of readFileSync(join(outDirectory, name), 'utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      const index = jobs.findIndex((job) => job.id === record.id);
      records.set(record.id, { ...record, outDirectory: join(outDirectory, String(index).padStart(5, '0')) });
    }
  }
  const failedContainers = statuses.flatMap((status, shard) => (status === 0 ? [] : [shard]));
  if (failedContainers.length > 0) {
    console.error(`container(s) ${failedContainers.join(', ')} ended with an error; see ${workDirectory}`);
  }
  return records;
}

// --- 3. from a result to a manifest entry ----------------------------------------------------------

function findOutput(directory, extension) {
  if (!existsSync(directory)) return null;
  const name = readdirSync(directory).find((entry) => entry.toLowerCase().endsWith(extension));
  return name ? new Uint8Array(readFileSync(join(directory, name))) : null;
}

/**
 * Why a failed record of asm_batch.py is a failure of the machine (../common/infrastructure.mjs), or
 * null. The texts are the error and Wine's error lines; any .L68 or .S68 the run left rules it out.
 */
export function asmInfrastructureReason(record) {
  if (!record) return null;
  return infrastructureReason({
    failed: record.status !== 'ok',
    texts: [record.error, record.wine_err],
    // Files count as outputs once the editor had finished assembling (its status dialog was up),
    // as for ingestRun: before that they are half written and never kept (injected in errata T1 28:
    // the display stopped under an editor that had begun its listing).
    outputs: typeof record.status_title === 'string' ? (record.outputs ?? []).length : 0,
  });
}

/**
 * Why a record of asm_batch.py is not the record of a clean run, or null when it is one.
 * A record that lists an unexpected window is never clean, whatever status it carries: the
 * driver ends such a run itself, and a driver that only dismissed the window (as the first
 * version did) must not pass here either (ARCHITECTURE.md 6.2.2).
 */
export function failureOf(record) {
  if (!record) return 'the container wrote no result for this run';
  if (record.status !== 'ok') return withoutWineThreadIds(record.error ?? 'unknown');
  const stray = record.stray_windows ?? [];
  if (stray.length > 0) return `unexpected window "${stray[0].title}" was dismissed by the driver`;
  return null;
}

/**
 * Wine's debug lines start with the id of the thread (`01e0:err:virtual:...`), which differs from run
 * to run; the manifest keeps the text without it, so that a crash is recorded the same way every time
 * (run 45034017858: the two stack overflows of the checklist changed only in that id).
 */
export function withoutWineThreadIds(text) {
  return text.replace(/\b[0-9a-f]{4}:(err|fixme|warn|trace):/g, '$1:');
}

/**
 * Runs in which what the official editor does AFTER it has written its outputs depends on the host
 * (erratum T1 27). For these a run that the driver ends because of one of the windows named in
 * `failures` counts like a clean one when it left both outputs, and either way the manifest records
 * the same entry: `status: "ok"` and `note`. The outputs are still compared by their hashes, so an
 * incomplete listing still shows as a difference.
 */
export const HOST_DEPENDENT_RUNS = {
  'richedit/s03_long_line_4000.X68#default': {
    failures: [
      /^unexpected window "Error" while the editor assembled$/,
      /^unexpected window "EASy68K" above the Assembler Status dialog$/,
      /^unexpected window "EASy68K" after Alt\+F4$/,
    ],
    note:
      'host-dependent end of the run: after writing its outputs the official editor reads through a pointer made of ' +
      "the 4000-character line's text (official-oracle §3.4); depending on the host it then shows nothing (GitHub's " +
      'ubuntu-24.04 runner), "Access violation at address 00479971 ... Read of address 58585B44" above the status ' +
      'dialog, or "File Access Error" (Docker Desktop on Windows 11); the outputs are the same in all three (erratum T1 27)',
  },
};

/**
 * What the manifest records for one run, from the record of asm_batch.py and the files it left.
 * Returns the entry and the files to keep ({ listing, sRecord, received } as bytes or null).
 * `maskingListing`: for a run without a listing, the official listing of the same program and
 * options with the listing on, whose undefined-symbol statements are masked in the S-records
 * (compare.ts, erratum T1 20).
 *
 * A failed run keeps its outputs when the editor had finished assembling - its status dialog was
 * up, so the record has `status_title` - and a file is there with something in it (a crash during
 * assembly leaves two empty files). Such an entry has `outputsKept` and the hashes of those files.
 */
export function ingestRun({ options, record, source, maskingListing = null, hostDependent = null }) {
  const failure = failureOf(record);
  const nonEmpty = (bytes) => (bytes && bytes.length > 0 ? bytes : null);
  const tolerated =
    hostDependent !== null &&
    failure !== null &&
    hostDependent.failures.some((pattern) => pattern.test(failure)) &&
    nonEmpty(findOutput(record.outDirectory, '.l68')) !== null &&
    nonEmpty(findOutput(record.outDirectory, '.s68')) !== null;
  const reason = tolerated ? null : failure;
  const assembled = reason === null || typeof record?.status_title === 'string';
  const found = (extension) => (assembled ? findOutput(record.outDirectory, extension) : null);
  const listing = reason === null ? found('.l68') : nonEmpty(found('.l68'));
  const sRecord = reason === null ? found('.s68') : nonEmpty(found('.s68'));
  if (reason !== null && listing === null && sRecord === null) {
    return {
      run: { options, status: 'failed', reason, errors: null, warnings: null, l68: null, s68: null, golden: false },
      files: {},
    };
  }
  const received = found('.received.txt') ?? new Uint8Array();
  const hashes = canonicalHashes({ listing, sRecord, maskingListing: listing === null ? maskingListing : null });
  const counts = listing ? listingCounts(listing) : { errors: null, warnings: null };
  const modelText = editorLoad(source).text;
  const receivedDiffers = Buffer.compare(Buffer.from(modelText), Buffer.from(received)) !== 0;
  const notes = [];
  if (record.warning) notes.push(record.warning);
  for (const box of record.help_boxes ?? []) {
    notes.push(`help-viewer message box dismissed ${box.when === 'exit' ? 'at exit' : 'at start-up'}`);
  }
  if (record.exit && record.exit !== 'clean' && hostDependent === null) notes.push(`the editor was ${record.exit}`);
  if (hostDependent !== null && reason === null) notes.push(hostDependent.note);
  const run = {
    options,
    ...(reason === null ? { status: 'ok' } : { status: 'failed', reason, outputsKept: true }),
    received: sha256Hex(received),
    ...(receivedDiffers ? { receivedFile: true } : {}),
    errors: counts.errors,
    warnings: counts.warnings,
    l68: hashes.l68,
    s68: hashes.s68,
    ...(hashes.undefinedSymbols ? { undefinedSymbols: true } : {}),
    golden: false,
    ...(notes.length > 0 ? { notes } : {}),
  };
  return {
    run,
    files: {
      listing,
      sRecord,
      received: receivedDiffers ? received : null,
      maskingListing: listing === null ? maskingListing : null,
    },
  };
}

/** Writes `bytes` unless the file already holds the same canonical content; returns whether it wrote. */
function writeIfChanged(path, bytes, canonical) {
  if (existsSync(path)) {
    const old = new Uint8Array(readFileSync(path));
    if (Buffer.compare(Buffer.from(canonical(old)), Buffer.from(canonical(bytes))) === 0) return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return true;
}

/** The extensions of the files a run may have in its golden folder. */
const OUTPUT_EXTENSIONS = ['L68', 'S68', 'received.txt'];

/**
 * Stores the outputs of one run and completes its manifest entry (`golden`). Tracked sets go to the
 * repository unless a file is too large; `site` and oversized files go to build/golden-local/.
 * The files of a failed run that left outputs are stored the same way under `<label>.failed.*`.
 * Returns the number of files written.
 */
export function storeRun(program, label, run, files) {
  const tracked = goldenDirectory(program, true);
  const local = goldenDirectory(program, false);
  const stem = outputStem(label, run);
  const removeStale = (keep) => {
    for (const name of [label, `${label}.failed`]) {
      if (name === keep) continue;
      for (const extension of OUTPUT_EXTENSIONS) rmSync(join(tracked, `${name}.${extension}`), { force: true });
    }
  };
  if (!hasOfficialOutput(run)) {
    removeStale(null);
    return 0;
  }
  const tooLarge = [files.listing, files.sRecord].some((bytes) => bytes && bytes.length > MAX_GOLDEN_BYTES);
  run.golden = program.set !== 'site' && !tooLarge;
  const directory = run.golden ? tracked : local;
  removeStale(run.golden ? stem : null);
  let written = 0;
  const identity = (bytes) => bytes;
  // With undefined symbols the stored object code is uninitialised memory of that run: a file is
  // replaced only when it changed in something that is compared.
  const maskSource = files.listing ?? files.maskingListing ?? null;
  const masked = maskSource ? undefinedSymbolRanges(maskSource) : [];
  const put = (extension, bytes, canonical) => {
    const path = join(directory, `${stem}.${extension}`);
    if (bytes) written += writeIfChanged(path, bytes, canonical) ? 1 : 0;
    else rmSync(path, { force: true });
  };
  put('L68', files.listing, canonicalListing);
  put('S68', files.sRecord, (bytes) => canonicalSRecord(bytes, masked));
  put('received.txt', files.received, identity);
  return written;
}

/**
 * `--rehash`: the hashes of every run again, from the stored official outputs, after a change of
 * the canonical forms. `readOutput(program, label, run, extension)` returns the bytes of a stored
 * file or null. Changes `manifest` in place and returns what happened to each run that has
 * outputs: `{ unchanged, changed, missing }`, the last two as lists of `<id> (<label>)`.
 */
export function rehashManifest(manifest, readOutput) {
  const result = { unchanged: 0, changed: [], missing: [] };
  for (const program of manifest.programs) {
    for (const [label, run] of Object.entries(program.runs)) {
      if (!hasOfficialOutput(run)) continue;
      const name = `${program.id} (${label})`;
      const listing = run.l68 === null ? null : readOutput(program, label, run, 'L68');
      const sRecord = run.s68 === null ? null : readOutput(program, label, run, 'S68');
      if ((run.l68 !== null && listing === null) || (run.s68 !== null && sRecord === null)) {
        result.missing.push(name);
        continue;
      }
      const companion = listingOnLabel(run.options);
      const companionRun = companion === null ? undefined : program.runs[companion];
      const maskingListing =
        listing === null && companionRun && hasOfficialOutput(companionRun) && companionRun.l68 !== null
          ? readOutput(program, companion, companionRun, 'L68')
          : null;
      const hashes = canonicalHashes({ listing, sRecord, maskingListing });
      if (
        hashes.l68 === run.l68 &&
        hashes.s68 === run.s68 &&
        hashes.undefinedSymbols === (run.undefinedSymbols ?? false)
      ) {
        result.unchanged++;
        continue;
      }
      // Rebuilt in the key order of ingestRun, with `undefinedSymbols` right after the hashes.
      const { undefinedSymbols: _old, ...rest } = run;
      const rebuilt = {};
      for (const [key, value] of Object.entries(rest)) {
        rebuilt[key] = key === 'l68' ? hashes.l68 : key === 's68' ? hashes.s68 : value;
        if (key === 's68' && hashes.undefinedSymbols) rebuilt.undefinedSymbols = true;
      }
      program.runs[label] = rebuilt;
      result.changed.push(name);
    }
  }
  return result;
}

/** The stored output file of a run: in the repository when the run is `golden`, else in build/golden-local/. */
function readStoredOutput(program, label, run, extension) {
  const path = join(goldenDirectory(program, run.golden), `${outputStem(label, run)}.${extension}`);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

// --- 4. the manifest and the report ----------------------------------------------------------------

function emptyManifest() {
  return { version: 1, oracle: { program: '', wine: '', generated: '' }, programs: [] };
}

/** The manifest entry of a program, without its runs. */
function programEntry(program, previous) {
  return {
    id: program.id,
    set: program.set,
    origin: program.origin,
    licence: program.licence,
    file: program.file,
    root: program.root,
    sha256: program.sha256,
    bytes: program.bytes,
    flags: program.flags ?? previous?.flags ?? [],
    runs: {},
  };
}

/** What differs between the recorded and the new result of a run, as text; empty when nothing does. */
export function runDifferences(recorded, now) {
  const out = [];
  if (!recorded) return ['not in the manifest'];
  for (const key of ['status', 'received', 'errors', 'warnings', 'l68', 's68']) {
    if ((recorded[key] ?? null) !== (now[key] ?? null))
      out.push(`${key}: manifest ${recorded[key] ?? 'none'}, now ${now[key] ?? 'none'}`);
  }
  return out;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** tests/conformance/asm/golden/REPORT.md, from the manifest alone. */
export function renderReport(manifest) {
  const lines = [
    '# Assembler oracle report',
    '',
    'Generated by `tests/oracle/wine/asm/regenerate.mjs` from `tests/corpus/manifest.json`; do not edit.',
    '',
    `Oracle: ${manifest.oracle.program}, ${manifest.oracle.wine}. Last run: ${manifest.oracle.generated}.`,
    '',
    'A "run" is one program assembled with one set of options. "Golden" means the `.L68` and `.S68` of',
    'the official program are in this folder; "hash only" means the manifest holds their SHA-256 and the',
    'files are not in the repository (a program of the `site` set, or an output over 512 KiB). "No',
    'result" means that the run was not a clean run of the official program.',
    '',
    '| Set | Programs | Runs | Golden | Hash only | No result |',
    '|---|---|---|---|---|---|',
  ];
  const groups = new Map();
  for (const program of manifest.programs) {
    const key = program.set === 'conformance' ? `conformance (${program.id.split('/')[0]})` : program.set;
    const group = groups.get(key) ?? { programs: 0, runs: 0, golden: 0, hashOnly: 0, failed: 0 };
    group.programs++;
    for (const run of Object.values(program.runs)) {
      group.runs++;
      if (run.status !== 'ok') group.failed++;
      else if (run.golden) group.golden++;
      else group.hashOnly++;
    }
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    lines.push(
      `| ${key} | ${group.programs} | ${group.runs} | ${group.golden} | ${group.hashOnly} | ${group.failed} |`,
    );
  }
  const section = (title, intro, rows) => {
    lines.push('', `## ${title}`, '', ...intro, '');
    if (rows.length === 0) lines.push('None.');
    else lines.push(...rows);
  };
  const runs = manifest.programs.flatMap((program) =>
    Object.entries(program.runs).map(([label, run]) => ({ program, label, run })),
  );
  section(
    'Runs without a result',
    [
      'The automation could not get a clean run of the official program for these: it crashed, took',
      'too long, or showed a window that a run must not show. No golden exists and the comparison test',
      'skips them, except where the next section says that the outputs were kept.',
    ],
    runs
      .filter(({ run }) => run.status !== 'ok')
      .map(({ program, label, run }) => `- \`${program.id}\` (${label}): ${run.reason}`),
  );
  section(
    'Outputs kept from a failed run',
    [
      'In these runs the official program had finished assembling (its status dialog was up) when the',
      'run went wrong. The `.L68` and `.S68` it had written are kept as `<label>.failed.L68` / `.S68`',
      '(official-oracle §4 item 7), and the comparison test compares them like goldens.',
    ],
    runs
      .filter(({ run }) => run.status !== 'ok' && run.outputsKept)
      .map(
        ({ program, label, run }) =>
          `- \`${program.id}\` (${label}): ${plural(run.errors ?? 0, 'error')}, ${plural(run.warnings ?? 0, 'warning')}; ${run.golden ? 'in this folder' : 'hash only'}`,
      ),
  );
  section(
    'Text that differs from the editor model',
    [
      'For these the text the official editor handed to its assembler under Wine is not what the model',
      '(`editorLoad`) gives. Whether Windows does the same is not known (official-oracle §3.4); the',
      'captured text is kept as `<label>.received.txt` and the comparison assembles that text.',
    ],
    runs.filter(({ run }) => run.receivedFile).map(({ program, label }) => `- \`${program.id}\` (${label})`),
  );
  section(
    'Outputs kept as hashes only although the program is tracked',
    ['Too large to commit.'],
    runs
      .filter(({ program, run }) => program.set !== 'site' && run.status === 'ok' && !run.golden)
      .map(({ program, label }) => `- \`${program.id}\` (${label})`),
  );
  section(
    'Notes of the runs',
    ['What the driver saw besides the expected windows.'],
    runs
      .filter(({ run }) => run.notes)
      .map(({ program, label, run }) => `- \`${program.id}\` (${label}): ${run.notes.join('; ')}`),
  );
  const undefinedRuns = runs.filter(({ run }) => run.undefinedSymbols).length;
  lines.push(
    '',
    '## Undefined symbols',
    '',
    `Runs that report an undefined symbol: ${undefinedRuns}. The original encodes uninitialised memory for such a`,
    'symbol (official-oracle §3.5), so for these runs the object code of the statements that report one',
    'is masked before comparing, in the listing and in the S-records; every other byte is compared.',
    'The manifest marks these runs `undefinedSymbols`.',
    '',
  );
  return lines.join('\n');
}

/**
 * The official listing of the run `label` of a program: from this invocation's result when that
 * run was clean, else the stored one of the manifest's entry; null when there is none.
 */
function officialListing(program, before, label, records) {
  if (label === null) return null;
  const record = records.get(`${program.id}#${label}`);
  if (record && failureOf(record) === null) return findOutput(record.outDirectory, '.l68');
  const recorded = before?.runs[label];
  return recorded && hasOfficialOutput(recorded) && recorded.l68 !== null
    ? readStoredOutput(program, label, recorded, 'L68')
    : null;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}

/**
 * Throws unless the driver inside the image passes its own test of the window rule
 * (`asm_batch.py --self-test`): which windows it dismisses and which fail a run.
 */
export function assertDriverSelfTest(image) {
  const result = docker(['run', '--rm', '--entrypoint', 'python3', image, '/oracle/asm_batch.py', '--self-test']);
  if (result.status !== 0) {
    throw new Error(`the driver in ${image} fails its self-test:\n${result.stdout}${result.stderr}`);
  }
}

// --- the command line ------------------------------------------------------------------------------

function parseArguments(argv) {
  const options = {
    sets: TRACKED_SETS,
    only: [],
    containers: 4,
    timeout: 300,
    cpus: null,
    large: false,
    check: false,
    report: false,
    rehash: false,
    image: DEFAULT_IMAGE,
    official: resolve(process.env.EASY68K_OFFICIAL_DIR ?? join(REPO, 'reference', 'official-extracted')),
    file: null,
    settings: null,
    out: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${argument} needs a value`);
      return next;
    };
    if (argument === '--sets') options.sets = value().split(',');
    else if (argument === '--only') options.only.push(value());
    else if (argument === '--containers') options.containers = Number(value());
    else if (argument === '--timeout') options.timeout = Number(value());
    else if (argument === '--cpus') options.cpus = Number(value());
    else if (argument === '--large') options.large = true;
    else if (argument === '--check') options.check = true;
    else if (argument === '--report') options.report = true;
    else if (argument === '--rehash') options.rehash = true;
    else if (argument === '--image') options.image = value();
    else if (argument === '--official') options.official = resolve(value());
    else if (argument === '--file') options.file = resolve(value());
    else if (argument === '--settings') options.settings = resolve(value());
    else if (argument === '--out') options.out = resolve(value());
    else throw new Error(`unknown argument ${argument}`);
  }
  const unknown = options.sets.filter((set) => !ALL_SETS.includes(set));
  if (unknown.length > 0) throw new Error(`unknown set ${unknown.join(', ')} (known: ${ALL_SETS.join(', ')})`);
  if (!Number.isInteger(options.containers) || options.containers < 1)
    throw new Error('--containers needs a positive integer');
  if (!(options.timeout > 0)) throw new Error('--timeout needs a positive number of seconds');
  if (options.cpus !== null && !(options.cpus > 0)) throw new Error('--cpus needs a positive number');
  return options;
}

function newWorkDirectory(name) {
  const directory = join(WORK_ROOT, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** The work folder of a `--file` run given `--out`: `<out>/work`, emptied first. */
export function fileWorkDirectory(out) {
  const directory = join(out, 'work');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** `--file`: one program of the caller's, nothing recorded. */
async function runOneFile(options) {
  const shipped = new Uint8Array(readFileSync(join(options.official, 'settings.dat')));
  const settings = options.settings ? new Uint8Array(readFileSync(options.settings)) : shipped;
  // With --out every file of the run stays below that folder (its work files in <out>/work), so
  // that a caller who keeps scratch output in a folder of its own writes nothing elsewhere.
  const workDirectory = options.out ? fileWorkDirectory(options.out) : newWorkDirectory('file');
  const id = basename(options.file);
  const records = await runJobs([{ id, mountKey: 'source', source: id, label: 'given', settings }], {
    image: options.image,
    official: options.official,
    mounts: { source: dirname(options.file) },
    containers: 1,
    timeout: options.timeout,
    workDirectory,
  });
  const record = records.get(id);
  if (!record) throw new Error(`the container wrote no result; see ${workDirectory}`);
  const out = options.out ?? join(workDirectory, 'result');
  if (existsSync(record.outDirectory)) cpSync(record.outDirectory, out, { recursive: true });
  const { outDirectory: _ignored, ...shown } = record;
  console.log(JSON.stringify(shown, null, 1));
  const failure = failureOf(record);
  console.log(failure === null ? `outputs: ${out}` : `FAILED: ${failure}\nwhat the editor left: ${out}`);
  return failure === null ? 0 : 1;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.report) {
    writeFileSync(REPORT_PATH, renderReport(loadManifest()));
    console.log(`${relative(REPO, REPORT_PATH)} written`);
    return 0;
  }
  if (options.rehash) {
    const manifest = loadManifest();
    const result = rehashManifest(manifest, readStoredOutput);
    writeJson(MANIFEST_PATH, manifest);
    writeFileSync(REPORT_PATH, renderReport(manifest));
    console.log(
      `hashes from the stored official outputs: ${plural(result.changed.length, 'run')} changed, ${result.unchanged} unchanged; ${relative(REPO, MANIFEST_PATH)} written`,
    );
    if (result.missing.length > 0) {
      console.log(
        `${plural(result.missing.length, 'run')} left as they are, because their outputs are not on this machine (run them through the official program instead):`,
      );
      for (const name of result.missing.slice(0, 40)) console.log(`  ${name}`);
      if (result.missing.length > 40) console.log(`  ... and ${result.missing.length - 40} more`);
    }
    return result.missing.length > 0 ? 1 : 0;
  }
  assertOfficialFolder(options.official);
  assertImageCurrent(options.image, WINE_DIRECTORY);
  assertDriverSelfTest(options.image);
  if (options.file) return runOneFile(options);

  const planned = planPrograms(options.sets).filter(
    (program) => options.only.length === 0 || options.only.some((text) => program.id.includes(text)),
  );
  const missing = planned.filter((program) => !program.available);
  if (missing.length > 0) {
    console.log(
      `${plural(missing.length, 'program')} of the site set are not on this machine and are left as they are (node tools/fetch-site-examples.mjs fetches them)`,
    );
  }
  const programs = planned.filter((program) => program.available);
  const shipped = new Uint8Array(readFileSync(join(options.official, 'settings.dat')));
  const jobs = [];
  const skipped = new Map(); // job id -> reason
  for (const program of programs) {
    for (const run of program.runs) {
      const id = `${program.id}#${run.label}`;
      if (program.bytes > LARGE_SOURCE_BYTES && !options.large) {
        skipped.set(
          id,
          `not tried: the source has ${program.bytes.toLocaleString('en-US')} bytes, and under Wine the official editor needs more than an hour to load a source above about 1 MB (official-oracle §3.2.1)`,
        );
        continue;
      }
      jobs.push({
        id,
        mountKey: program.set,
        source: program.file,
        label: run.label,
        settings: buildSettingsDat(shipped, run.options),
      });
    }
  }
  console.log(
    `${plural(programs.length, 'program')}, ${plural(jobs.length, 'run')} in ${Math.min(options.containers, jobs.length)} container(s); limit ${options.timeout} s per run`,
  );
  const workDirectory = newWorkDirectory(options.check ? 'check' : 'regenerate');
  const started = Date.now();
  const mounts = Object.fromEntries(
    [...new Set(programs.map((program) => program.set))].map((set) => [set, join(REPO, SET_DIRECTORIES[set])]),
  );
  // A run that the machine failed (no display; Wine's crash dialog before the editor's window) is
  // run again in fresh containers, at most twice (../common/infrastructure.mjs, errata T1 28).
  const { records, repeated } =
    jobs.length > 0
      ? await runWithRepetitions(
          jobs,
          workDirectory,
          (some, directory) =>
            runJobs(some, {
              image: options.image,
              official: options.official,
              mounts,
              containers: Math.min(options.containers, some.length),
              timeout: options.timeout,
              workDirectory: directory,
              cpus: options.cpus,
            }),
          asmInfrastructureReason,
        )
      : { records: new Map(), repeated: [] };
  console.log(
    `the containers took ${Math.round((Date.now() - started) / 1000)} s; work folder ${relative(REPO, workDirectory)}`,
  );
  const restarted = [...records.values()].filter((record) => record.display_restarts).map((record) => record.id);
  if (restarted.length > 0) {
    console.log(
      `the driver started a fresh display before ${plural(restarted.length, 'run')}: ${restarted.join(', ')}`,
    );
  }
  reportRepetitions(
    repetitionSummary(
      options.check ? 'Assembler oracle (check)' : 'Assembler oracle',
      repeated,
      [...new Set(repeated.map((entry) => entry.id))].filter((id) => failureOf(records.get(id)) !== null),
    ),
  );

  const manifest = existsSync(MANIFEST_PATH) ? loadManifest() : emptyManifest();
  const previous = new Map(manifest.programs.map((program) => [program.id, program]));
  const differences = [];
  const lost = []; // runs that had a result in the manifest and have none now
  let ok = 0;
  let failed = 0;
  let written = 0;
  for (const program of programs) {
    const source = new Uint8Array(readFileSync(sourcePath(program)));
    const before = previous.get(program.id);
    const entry = programEntry(program, before);
    // Runs of this program that this invocation did not plan stay as they are (--only is by program).
    for (const { label, options: runOptions } of program.runs) {
      const id = `${program.id}#${label}`;
      const recorded = before?.runs[label];
      if (skipped.has(id) && recorded?.status === 'ok' && before.sha256 === program.sha256) {
        // Not tried this time (a large source), but an earlier run with --large has a result: keep it.
        entry.runs[label] = recorded;
        ok++;
        continue;
      }
      const { run, files } = skipped.has(id)
        ? {
            run: {
              options: runOptions,
              status: 'failed',
              reason: skipped.get(id),
              errors: null,
              warnings: null,
              l68: null,
              s68: null,
              golden: false,
            },
            files: {},
          }
        : ingestRun({
            options: runOptions,
            record: records.get(id),
            source,
            maskingListing: officialListing(program, before, listingOnLabel(runOptions), records),
            hostDependent: HOST_DEPENDENT_RUNS[id] ?? null,
          });
      if (run.status === 'ok') ok++;
      else failed++;
      if (recorded?.status === 'ok' && run.status !== 'ok') lost.push(`${program.id} (${label}): ${run.reason}`);
      const changed = runDifferences(before?.runs[label], run);
      if (changed.length > 0) differences.push(`${program.id} (${label}): ${changed.join('; ')}`);
      if (options.check) run.golden = before?.runs[label]?.golden ?? false;
      else written += storeRun(program, label, run, files);
      entry.runs[label] = run;
    }
    previous.set(program.id, entry);
  }
  console.log(`${plural(ok, 'run')} with a result, ${failed} without`);
  if (differences.length > 0) {
    console.log(`${plural(differences.length, 'run')} differ from the manifest:`);
    for (const line of differences.slice(0, 40)) console.log(`  ${line}`);
    if (differences.length > 40) console.log(`  ... and ${differences.length - 40} more`);
  } else {
    console.log('every run equals the manifest');
  }
  if (lost.length > 0) {
    console.log(
      `${plural(lost.length, 'run')} had a result in the manifest and ${lost.length === 1 ? 'has' : 'have'} none now:`,
    );
    for (const line of lost) console.log(`  ${line}`);
  }
  const imageWine = wineVersion(options.image);
  if (manifest.oracle.wine && manifest.oracle.wine !== imageWine) {
    console.log(`note: the manifest was made with ${manifest.oracle.wine}, this image has ${imageWine}`);
  }
  if (options.check) return differences.length > 0 ? 1 : 0;

  // A full run of a set also drops the programs that are no longer part of it.
  if (options.only.length === 0) {
    const kept = new Set(planned.map((program) => program.id));
    for (const [id, program] of previous) {
      if (options.sets.includes(program.set) && !kept.has(id)) {
        previous.delete(id);
        rmSync(goldenDirectory(program, true), { recursive: true, force: true });
      }
    }
  }
  const next = {
    version: 1,
    oracle: {
      program: 'official EDIT68K.exe v5.16.1 under Wine in Docker (tests/oracle/wine)',
      wine: imageWine,
      generated:
        differences.length > 0 || !manifest.oracle.generated
          ? new Date().toISOString().slice(0, 10)
          : manifest.oracle.generated,
    },
    programs: [...previous.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  writeJson(MANIFEST_PATH, next);
  writeFileSync(REPORT_PATH, renderReport(next));
  console.log(
    `${plural(written, 'output file')} written; ${relative(REPO, MANIFEST_PATH)} and ${relative(REPO, REPORT_PATH)} updated`,
  );
  // Everything is written, so that the change can be looked at; but a lost result is an error.
  return lost.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (status) => process.exit(status),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
