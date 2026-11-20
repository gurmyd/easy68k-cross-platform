// docs/porting/assembler.md 9.6: "Run the regression suite at -O0 and at the
// release level and diff the outputs: any difference is new undefined
// behaviour." This runs every case of cases.mjs through an -O0 build of the
// engine and compares with expected.mjs (which the -O2 build must match, see
// cases.test.mjs). Build the -O0 copy first:
//
//     node engine/asm/build.mjs --debug --out build/asm-dist-O0
//
// Skipped when that copy does not exist.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initAssembler } from '../asm68k.mjs';
import { CASES } from './cases.mjs';
import { EXPECTED } from './expected.mjs';
import { asm } from './helpers.mjs';
import { expandCases, repo, summarize } from './tools/native-run.mjs';

const dir = join(repo, 'build', 'asm-dist-O0');
const available = existsSync(join(dir, 'asm68k.wasm')) && existsSync(join(dir, 'asm68k-loader.mjs'));

test('-O0 build gives the same outputs as the -O2 build', { skip: !available && `${dir} not built` }, async () => {
  await initAssembler({ wasmUrl: pathToFileURL(join(dir, 'asm68k.wasm')), loaderUrl: pathToFileURL(join(dir, 'asm68k-loader.mjs')) });
  for (const run of expandCases(CASES)) {
    const r = await asm(run.c.main, { files: run.c.files, options: run.options, name: run.c.mainName });
    assert.deepEqual(summarize(r), EXPECTED[run.key], run.key);
  }
});
