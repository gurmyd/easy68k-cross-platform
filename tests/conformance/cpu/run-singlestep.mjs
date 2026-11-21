#!/usr/bin/env node
// Checks the frozen baseline of the 68000 single-step suite: the entry point of the job
// `singlestep` in .github/workflows/oracle.yml (weekly, on Linux), which runs this file when it
// exists (ARCHITECTURE.md 6.1 L7, 6.2.4).
//
//     node tests/conformance/cpu/run-singlestep.mjs [--only NAME,...] [--report <file.md>]
//
// Downloads and verifies the suite into build/singlestep/ if needed, runs all of it through the
// WebAssembly simulator and compares the outcome with tests/conformance/cpu/baseline.json; exit
// code 1 on any difference. It is run-catalogue.mjs without --write-baseline: this entry point only
// checks. Without engine/dist it says so and exits 0, unless EASY68K_REQUIRE_ENGINES=1 (CI), in
// which case a missing engine fails. On Windows, `npm run oracle:twins` checks the same baseline
// on every push, and also through the two native simulator twins.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

/** Whether engine/dist holds the built simulator that the check needs. */
export function simulatorBuilt(root = repo) {
  return (
    existsSync(join(root, 'engine', 'dist', 'sim68k.wasm')) &&
    existsSync(join(root, 'engine', 'dist', 'sim68k-loader.mjs'))
  );
}

/**
 * @param {string[]} argv the arguments after the script name
 * @param {{ env?: NodeJS.ProcessEnv, root?: string, log?: (line: string) => void }} [options]
 * @returns {Promise<number>} the exit code
 */
export async function runSingleStep(argv, options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line) => console.log(line));
  if (argv.includes('--write-baseline') || argv.includes('--from-baseline')) {
    log('run-singlestep.mjs only checks the baseline; use run-catalogue.mjs to rewrite or report it.');
    return 2;
  }
  if (!simulatorBuilt(options.root)) {
    if (env.EASY68K_REQUIRE_ENGINES === '1') {
      log('EASY68K_REQUIRE_ENGINES is 1 but engine/dist/sim68k.wasm is missing: the baseline cannot be checked.');
      return 1;
    }
    log('engine/dist/sim68k.wasm is missing (npm run build:engines or npm run fetch:engines): nothing checked.');
    return 0;
  }
  const { runCatalogue } = await import('./run-catalogue.mjs');
  return runCatalogue(argv);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  runSingleStep(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(String(error instanceof Error ? error.stack : error));
      process.exit(1);
    });
}
