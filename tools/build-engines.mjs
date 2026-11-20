#!/usr/bin/env node
// `npm run build:engines` (ARCHITECTURE.md 7.2, 7.3): runs each engine's own
// build script. Output: engine/dist/ (asm68k.wasm, asm68k-loader.mjs,
// sim68k.wasm, sim68k-loader.mjs).
//
//     node tools/build-engines.mjs [--require-all] [--only asm|sim] [-- <args for the engine builds>]
//
// For each engine (engine/asm, engine/sim):
//   - the folder is missing            -> reported as "missing", skipped
//   - the folder has no build.mjs      -> reported as "no build script", skipped
//   - `node engine/<x>/build.mjs` fails -> reported as "FAILED" with its exit code
//   - otherwise its output files are checked and listed with size and SHA-256
//
// Exit code: 1 if a present engine failed to build or did not produce its
// files; with --require-all (the release build) also if an engine is
// missing; 0 otherwise. A summary line per engine is always printed, and in
// GitHub Actions the summary is also written to $GITHUB_OUTPUT as
// `built=<space-separated list>` and `missing=<list>`.
//
// Emscripten: each engine's build.mjs finds em++ through EMSDK or in
// .toolchain/emsdk (`npm run setup:emsdk`). Contributors without Emscripten
// can use `npm run fetch:engines` instead.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repo, 'engine', 'dist');

/** The engines and the files each build must leave in engine/dist. */
const ENGINES = [
  { id: 'asm', dir: 'engine/asm', outputs: ['asm68k.wasm', 'asm68k-loader.mjs'] },
  { id: 'sim', dir: 'engine/sim', outputs: ['sim68k.wasm', 'sim68k-loader.mjs'] },
];

function parseArgs(argv) {
  const options = { requireAll: false, only: null, passThrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      options.passThrough = argv.slice(i + 1);
      break;
    } else if (arg === '--require-all') {
      options.requireAll = true;
    } else if (arg === '--only') {
      options.only = argv[++i];
      if (!ENGINES.some((engine) => engine.id === options.only))
        usage(`--only takes asm or sim, not "${options.only}"`);
    } else if (arg === '--help' || arg === '-h') {
      usage();
    } else {
      usage(`unknown argument "${arg}"`);
    }
  }
  return options;
}

function usage(error) {
  const text =
    'usage: node tools/build-engines.mjs [--require-all] [--only asm|sim] [-- <args for engine/<x>/build.mjs>]';
  if (error) {
    console.error(`build-engines: ${error}\n${text}`);
    process.exit(2);
  }
  console.log(text);
  process.exit(0);
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function buildEngine(engine, passThrough) {
  const dir = join(repo, engine.dir);
  if (!existsSync(dir)) {
    return { status: 'missing', detail: `${engine.dir}/ does not exist` };
  }
  const script = join(dir, 'build.mjs');
  if (!existsSync(script)) {
    return { status: 'no-script', detail: `${engine.dir}/build.mjs does not exist` };
  }
  console.log(
    `\n=== ${engine.dir}: node ${relative(repo, script).replaceAll('\\', '/')} ${passThrough.join(' ')}`.trimEnd(),
  );
  const started = Date.now();
  const result = spawnSync(process.execPath, [script, ...passThrough], { cwd: repo, stdio: 'inherit' });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error) return { status: 'failed', detail: `could not start node: ${result.error.message}` };
  if (result.status !== 0) {
    return {
      status: 'failed',
      detail: `build.mjs exited with code ${result.status ?? result.signal} after ${seconds} s (if em++ was not found: npm run setup:emsdk, or npm run fetch:engines)`,
    };
  }
  const missing = engine.outputs.filter((name) => !existsSync(join(distDir, name)));
  if (missing.length) {
    return {
      status: 'failed',
      detail: `build.mjs succeeded but did not write engine/dist/${missing.join(', engine/dist/')}`,
    };
  }
  const files = engine.outputs.map((name) => {
    const file = join(distDir, name);
    return `${name} ${statSync(file).size} bytes sha256 ${sha256(file)}`;
  });
  return { status: 'built', detail: `built in ${seconds} s`, files };
}

const options = parseArgs(process.argv.slice(2));
const selected = ENGINES.filter((engine) => !options.only || engine.id === options.only);
const results = selected.map((engine) => ({ engine, ...buildEngine(engine, options.passThrough) }));

const LABEL = {
  built: 'built',
  missing: 'MISSING (skipped)',
  'no-script': 'NO BUILD SCRIPT (skipped)',
  failed: 'FAILED',
};
console.log('\nEngine build summary');
for (const { engine, status, detail, files } of results) {
  console.log(`  ${engine.dir.padEnd(11)} ${LABEL[status]}: ${detail}`);
  for (const line of files ?? []) console.log(`      engine/dist/${line}`);
}

const built = results.filter((r) => r.status === 'built').map((r) => r.engine.id);
const absent = results.filter((r) => r.status === 'missing' || r.status === 'no-script').map((r) => r.engine.id);
const failed = results.filter((r) => r.status === 'failed').map((r) => r.engine.id);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `built=${built.join(' ')}\nmissing=${absent.join(' ')}\n`);
}
if (absent.length && !failed.length) {
  console.log(
    `\nNot built: ${absent.map((id) => `engine/${id}`).join(', ')}. Work that needs ${absent.length > 1 ? 'them' : 'it'} is skipped until ${absent.length > 1 ? 'they exist' : 'it exists'}.`,
  );
}
if (failed.length) {
  console.error(`\nbuild-engines: ${failed.map((id) => `engine/${id}`).join(', ')} failed to build.`);
  process.exit(1);
}
if (options.requireAll && absent.length) {
  console.error(
    `\nbuild-engines: --require-all, but ${absent.map((id) => `engine/${id}`).join(', ')} cannot be built.`,
  );
  process.exit(1);
}
