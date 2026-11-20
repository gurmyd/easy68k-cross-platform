// Every program of cases.mjs through the WebAssembly build, compared with the
// outputs of the native twin recorded in expected.mjs: the whole listing
// (CR LF line ends checked), every S-record, the message list with codes and
// include-file names, and the error / warning counts.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASES } from './cases.mjs';
import { EXPECTED } from './expected.mjs';
import { asm } from './helpers.mjs';
import { expandCases, summarize } from './tools/native-run.mjs';

const runs = expandCases(CASES);

test('every case has an expected result and vice versa', () => {
  assert.deepEqual(runs.map((r) => r.key).sort(), Object.keys(EXPECTED).sort());
});

for (const run of runs) {
  test(`${run.key} [spec ${run.c.spec}]`, async () => {
    const r = await asm(run.c.main, { files: run.c.files, options: run.options, name: run.c.mainName });
    assert.equal(r.fatal, null);
    const got = summarize(r);
    const want = EXPECTED[run.key];
    assert.deepEqual(got.msgs, want.msgs, 'message list');
    assert.equal(got.errors, want.errors, 'error count');
    assert.equal(got.warnings, want.warnings, 'warning count');
    assert.deepEqual(got.s68, want.s68, 'S-records');
    assert.deepEqual(got.listing, want.listing, 'listing');
    assert.equal(r.executeEnabled, want.errors === 0, 'Execute button');
  });
}
