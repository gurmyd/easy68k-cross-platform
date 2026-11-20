// The JavaScript API of asm68k.mjs: argument handling, the editor helpers
// and the shape of the result.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, changeFileExt, decodeCp1252, DEFAULT_OPTIONS, encodeCp1252, loadEditorText } from '../asm68k.mjs';
import { raw, src, TIME } from './helpers.mjs';

test('defaults are the shipped EASy68K 5.16.1 assembler options', () => {
  assert.deepEqual({ ...DEFAULT_OPTIONS }, {
    generateListing: true, generateSRecord: true, constantsExpanded: false, bitFieldInstructions: true,
    crossReference: true, macrosExpanded: false, structuredExpanded: false, showWarnings: true,
    tabType: 'fixed', tabSize: 4,
  });
});

test('result shape for a clean program', async () => {
  const r = await assemble('prog.X68', new Map([['prog.X68', src(['\tORG $1000', 'S\tMOVE.B #9,D0', '\tEND S'])]]), {}, TIME);
  assert.equal(r.fatal, null);
  assert.equal(r.status, 0);
  assert.equal(r.errorCount, 0);
  assert.equal(r.warningCount, 0);
  assert.equal(r.executeEnabled, true);
  assert.deepEqual(r.messages, []);
  assert.deepEqual(r.dialogs, []);
  assert.equal(r.listingName, 'prog.L68');
  assert.equal(r.sRecordName, 'prog.S68');
  assert.ok(r.listing instanceof Uint8Array && r.sRecord instanceof Uint8Array);
});

test('messages carry line, severity, code, text, file and resolved file', async () => {
  const files = { 'prog.X68': src(['\tORG $1001', '\tINCLUDE \'Inc.x68\'', '\tFAIL stop', '\tEND $1000']), 'INC.X68': src(['\tBOGUS']) };
  const r = await assemble('prog.X68', files, {}, TIME);
  assert.deepEqual(r.messages, [
    { line: 1, severity: 'warning', code: 0x105, text: 'WARNING: Origin value is odd (Location counter set to next highest address)', file: null, resolvedFile: null },
    { line: 1, severity: 'error', code: 0x402, text: 'ERROR: Invalid opcode', file: 'Inc.x68', resolvedFile: 'INC.X68' },
    { line: 3, severity: 'error', code: 0x20E, text: 'STOP', file: null, resolvedFile: null },
  ]);
  assert.equal(r.errorCount, 2);
  assert.equal(r.warningCount, 1);
  assert.equal(r.executeEnabled, false);
});

test('main file is found case-insensitively; plain object works as the file map', async () => {
  const r = await assemble('Sub/PROG.x68', { 'sub\\prog.X68': src(['\tEND $1000']) }, {}, TIME);
  assert.equal(r.fatal, null);
  assert.equal(r.listingName, 'Sub/PROG.L68');
});

test('argument errors are thrown, not reported as assembler messages', async () => {
  const files = { 'a.X68': src(['\tEND $1000']) };
  await assert.rejects(assemble('b.X68', files, {}, TIME), /no entry for the main source/);
  await assert.rejects(assemble('a.X68', { 'a.X68': 'text' }, {}, TIME), TypeError);
  await assert.rejects(assemble('a.X68', files, { tabType: 'smart' }, TIME), TypeError);
  await assert.rejects(assemble('a.X68', files, { tabSize: 100 }, TIME), RangeError);
  await assert.rejects(assemble('a.X68', files, { macrosExpanded: 'yes' }, TIME), TypeError);
  await assert.rejects(assemble('a.X68', files, {}, 'now'), TypeError);
});

test('tabType accepts the names and the original numbers', async () => {
  const files = { 'a.X68': src(['L\tNOP', '\tEND $1000']) };
  const a = await assemble('a.X68', files, { tabType: 'assembly' }, TIME);
  const b = await assemble('a.X68', files, { tabType: 0 }, TIME);
  assert.deepEqual(a.listing, b.listing);
});

test('loadEditorText removes the font/tab trailer and reports its settings', () => {
  const file = raw('\tNOP\r\n\r\n\r\n*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~0~\r\n*~Tab size~8~\r\n');
  const t = loadEditorText(file);
  assert.equal(decodeCp1252(t.text), '\tNOP\r\n\r\n\r\n');
  assert.deepEqual([t.tabType, t.tabSize, t.fontName, t.fontSize], ['assembly', 8, 'Courier New', 10]);
  // only the last four lines are looked at; other lines stay
  const u = loadEditorText(raw('*~Tab size~3~\r\nA\r\nB\r\nC\r\nD\r\n'));
  assert.equal(decodeCp1252(u.text), '*~Tab size~3~\r\nA\r\nB\r\nC\r\nD\r\n');
  assert.equal(u.tabSize, null);
  // a last line without line end gets one; LF line ends become CR LF
  assert.equal(decodeCp1252(loadEditorText(raw('A\nB')).text), 'A\r\nB\r\n');
  assert.equal(loadEditorText(raw('\tNOP\r\n*~Tab type~1~\r\n')).tabType, 'fixed');
});

test('Windows-1252 conversion round-trips every byte', () => {
  const all = Uint8Array.from({ length: 256 }, (_, k) => k);
  assert.deepEqual(encodeCp1252(decodeCp1252(all)), all);
  assert.equal(decodeCp1252(raw('\x80\xE9')), '\u20AC\u00E9');
  assert.deepEqual(encodeCp1252('\u20AC\u4E00'), Uint8Array.from([0x80, 0x3F]));
});

test('changeFileExt follows the VCL rules', () => {
  assert.equal(changeFileExt('C:\\x\\prog.X68', '.L68'), 'C:\\x\\prog.L68');
  assert.equal(changeFileExt('dir.v2/prog', '.S68'), 'dir.v2/prog.S68');
  assert.equal(changeFileExt('a.b.c', '.L68'), 'a.b.L68');
});

test('the main source is saved as the editor saves it: CR LF, LF and lone CR are line breaks', async () => {
  const want = await assemble('a.X68', { 'a.X68': raw('\tORG $1000\r\n\tNOP\r\n\tEND $1000\r\n') }, {}, TIME);
  for (const text of ['\tORG $1000\r\tNOP\r\tEND $1000', '\tORG $1000\n\tNOP\n\tEND $1000\n', '\tORG $1000\r\n\tNOP\r\n\tEND $1000']) {
    const r = await assemble('a.X68', { 'a.X68': raw(text) }, {}, TIME);
    assert.deepEqual(r.listing, want.listing, JSON.stringify(text));
    assert.deepEqual(r.sRecord, want.sRecord);
  }
});

test('a Date timestamp is read in local time', async () => {
  const r = await assemble('a.X68', { 'a.X68': src(['\tEND $1000']) }, {}, new Date(2001, 1, 3, 4, 5, 6));
  assert.equal(decodeCp1252(r.listing).split('\r\n')[2], 'Created On: 2/3/2001 4:05:06 AM');
});

test('a source with no files to include still sees its own name as a file', async () => {
  // INCLUDE of the main file reads the file as supplied (the editor buffer is the same bytes here)
  const r = await assemble('self.X68', { 'self.X68': src(['\tIFNE 0', '\tINCLUDE self.x68', '\tENDC', '\tDC.B 1', '\tEND 0']) }, {}, TIME);
  assert.equal(r.errorCount, 0);
});
