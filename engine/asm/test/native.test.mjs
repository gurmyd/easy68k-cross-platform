// The native twins (MSVC, x86, /Od; native/build.mjs) on every program of
// cases.mjs, compared with the WebAssembly build:
//   - the twin built from the SAME patched sources must agree exactly
//     (a different compiler exposes anything that still depends on undefined
//     behaviour);
//   - the twin built from the UNPATCHED v5.16.1 sources must agree everywhere
//     except in the runs listed in UNPATCHED_DIFFERS, each of which exercises
//     one of the patches (PATCHES.md) - proof that the patches change nothing
//     else.
// Skipped when the twins have not been built (they need Windows and MSVC).
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CASES } from './cases.mjs';
import { asm } from './helpers.mjs';
import { expandCases, nativeExe, repo, runNative, summarize } from './tools/native-run.mjs';

/** Runs in which the unpatched build is expected to differ, and the patch responsible. */
export const UNPATCHED_DIFFERS = {
  'line/local label whose mangled name reaches 33 characters#0': 'P7: operand of an undefined symbol is uninitialised',
  'expr/undefined symbol followed by +, -, * and inside parentheses#0': 'P7: operand / DC value of an undefined symbol is uninitialised',
  'dir/FAIL with and without text, FAIL.W, FAIL with %#0': 'P5: FAIL text used as a printf format ("%D" makes the CRT drop the message)',
  'macro/binary constants and a valid printf conversion in macro body lines#0': 'P5: macro body line used as a printf format ("% d" prints a garbage number)',
  'macro/expanded line longer than 255 characters#0': 'P8: line[] overrun; the unpatched build crashes',
  'stc/missing THEN / DO, unknown condition, mismatched and empty-stack terminators#0': 'P7: branch to an undefined label, uninitialised displacement',
  'stc/unclosed IF, indented LBL: IF, IF with VAR.L, more than 9 IFs (hex labels)#0': 'P7: branch to an undefined label, uninitialised displacement',
  'output/undefined symbol in a structured line, label of a rejected mnemonic#0': 'P7: branch to an undefined label, uninitialised displacement',
  'dir/SET and MACRO lines reached only in pass 2 (forward reference in IFNE)#0':
    'P7: pass 1 evaluates IFNE FWD with the uninitialised local t of eval(); with garbage the block is assembled in pass 1 too',
};

const runs = expandCases(CASES);
const scratch = (kind) => join(repo, 'build', 'asm-native-test', kind);

for (const kind of ['patched', 'unpatched']) {
  const available = existsSync(nativeExe(kind));
  for (const run of runs) {
    test(`${kind} twin: ${run.key}`, { skip: !available && `${nativeExe(kind)} not built` }, async () => {
      const wasm = summarize(await asm(run.c.main, { files: run.c.files, options: run.options, name: run.c.mainName }));
      const nat = runNative(kind, run, scratch(kind));
      if (kind === 'unpatched' && UNPATCHED_DIFFERS[run.key]) {
        const same = nat.exitCode === 0 && JSON.stringify(wasm) === JSON.stringify(summarize(nat));
        assert.equal(same, false, `expected a difference (${UNPATCHED_DIFFERS[run.key]})`);
        return;
      }
      assert.equal(nat.exitCode, 0, 'native exit code');
      assert.deepEqual(summarize(nat), wasm);
    });
  }
}
