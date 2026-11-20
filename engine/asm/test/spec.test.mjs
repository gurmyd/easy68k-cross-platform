// Claims of docs/porting/assembler.md, each stated here with the expected
// value written out by hand (independent of the snapshot in expected.mjs).
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asm, body, check, listing, msgs, raw, records, S0, src } from './helpers.mjs';
import { decodeCp1252 } from '../asm68k.mjs';

/** listing line whose source text (column 40 on) is `text` */
const lineOf = (r, text) => listing(r).find((l) => /^[0-9A-F]{8}/.test(l) && l.slice(40).trim() === text);

test('8.3 #3/#4: the two v5.16.1 regressions in OPPARSE.CPP are reproduced', async () => {
  const r = await asm(['\tORG $1000', 'TABLE\tDC.W 1,2,3,4', '\tMOVE.W (TABLE,PC,D0.W),D1', '\tMOVE.W TABLE(PC,D0.W),D1',
    '\tMOVE.W (PC,D0.W),D1', '\tMOVE.W (PC,A1),D2', '\tMOVE.W ($C,A0),D1', '\tMOVE.W (PTR,A0),D1', '\tMOVE.W (SCORE,A0,D1.L),D2',
    '\tMOVE.W ($1C,A0),D1', '\tBTST #3,(TABLE,PC,D0.W)', 'PTR\tEQU 8', 'SCORE\tEQU 4', '\tEND $1000']);
  check(r, {
    // (TABLE,PC,D0.W) ignores TABLE: displacement $FE; TABLE(PC,D0.W) is right ($1000-$100E = $F2);
    // ($C,A0), (PTR,A0), (SCORE,A0,..) are "Invalid syntax"; BTST's displacement is $FC
    s68: ['S12310000001000200030004323B00FE323B00F2323B00FE343B90FE3228001C083B0003D4', 'S105102000FCCE', 'S804001000EB'],
    msgs: [[7, 'ERROR: Invalid syntax'], [8, 'ERROR: Invalid syntax'], [9, 'ERROR: Invalid syntax']],
    errors: 3, warnings: 0,
  });
});

test('6.4: SIMHALT lists FFFF FFFF but writes the second word at the same address', async () => {
  const r = await asm(['\tORG $1012', '\tSIMHALT', '\tEND $1012']);
  check(r, { s68: ['S1051012FFFFDA', 'S1051012FFFFDA', 'S804001012D9'], msgs: [] });
  assert.equal(lineOf(r, 'SIMHALT').slice(0, 32), '00001012  FFFF FFFF             ');
});

test('1.3: options are not reset between the passes (NOLIST at the end, OPT NOWAR anywhere)', async () => {
  const a = await asm(['\tORG $1000', '\tNOP', '\tMOVE.B #300,D0', '\tNOLIST', '\tEND $1000']);
  // no source line is listed except the one with an error, with a stale address
  assert.deepEqual(body(a), ['Line 1 ERROR: Immediate data exceeds 8 bits', '00001000                             1      MOVE.B #300,D0']);
  const b = await asm(['\tORG $1001', '\tNOP', '\tOPT NOWAR', '\tEND']);
  check(b, { msgs: [], warnings: 2, errors: 0 });   // hidden, still counted
  assert.ok(listing(b).includes('2 warnings generated'));
});

test('9.4.1: CR LF, LF and Ctrl-Z in the main source and in include files', async () => {
  const lines = ['\tORG $1000', 'M\tMACRO', '\tDC.W 1', '\tENDM', '\tM', '\tEND $1000'];
  const crlf = await asm(src(lines));
  const lf = await asm(src(lines, { eol: '\n' }));
  assert.deepEqual(records(lf), records(crlf));
  assert.deepEqual(listing(lf), listing(crlf));
  check(crlf, { s68: ['S10510000001E9', 'S804001000EB'], msgs: [] });
  // Ctrl-Z: the rest of the file is not read (no END, so the END warning counts lines up to it)
  const z = await asm(raw('\tORG $1000\r\n\tDC.W 1\r\n\x1A\tDC.W 2\r\n\tEND $1000\r\n'));
  check(z, { s68: ['S10510000001E9', 'S804000000FB'], msgs: [[3, 'WARNING: END directive missing, starting address not set']] });
  // include files are read in text mode, one by one
  const inc = await asm(['\tORG $1000', '\tINCLUDE a.x68', '\tINCLUDE b.x68', '\tEND $1000'],
    { files: { 'a.x68': raw('\tDC.W 1\n\tDC.W 2\n'), 'b.x68': raw('\tDC.W 3\r\n\x1A\tDC.W 4\r\n') } });
  check(inc, { s68: ['S1091000000100020003E0', 'S804001000EB'], msgs: [] });
});

test('1.2 / 5: every output line ends in CR LF; listing header as the original writes it', async () => {
  const r = await asm(['\tORG $1000', '\tNOP', '\tEND $1000']);
  const l = decodeCp1252(r.listing);
  assert.ok(!/[^\r]\n/.test(l) && l.endsWith('\r\n'));
  assert.deepEqual(listing(r).slice(0, 4), ['00001000 Starting Address', 'Assembler used: EASy68K Editor/Assembler v5.16.01',
    'Created On: 11/20/2026 1:07:46 PM', '']);
  const s = decodeCp1252(r.sRecord);
  assert.ok(!/[^\r]\n/.test(s) && s.startsWith(S0 + '\r\n'));
});

test('5.1: "Created On:" uses DateTimeToStr with the US-English locale', async () => {
  const cases = [
    [{ year: 2018, month: 3, day: 15, hour: 14, minute: 41, second: 7 }, 'Created On: 3/15/2018 2:41:07 PM'],
    [{ year: 2026, month: 12, day: 31, hour: 0, minute: 5, second: 9 }, 'Created On: 12/31/2026 12:05:09 AM'],
    [{ year: 2026, month: 1, day: 2, hour: 12, minute: 0, second: 0 }, 'Created On: 1/2/2026 12:00:00 PM'],
    [{ year: 2026, month: 1, day: 2, hour: 0, minute: 0, second: 0 }, 'Created On: 1/2/2026'],      // midnight: date only
    [new Date(2030, 6, 4, 23, 59, 58), 'Created On: 7/4/2030 11:59:58 PM'],
  ];
  for (const [time, line] of cases) {
    const r = await asm(['\tEND $1000'], { time });
    assert.equal(listing(r)[2], line);
  }
});

test('3.4.1: INCLUDE lists an "end include" line that repeats the last object code; messages name the file', async () => {
  const r = await asm(['\tORG $1000', '\tINCLUDE r.x68', '\tEND $1000'], { files: { 'r.x68': raw('\tNOP\r\n\tBOGUS\r\n\tRTS') } });
  const l = listing(r);
  assert.ok(l.includes('00001002  4E75                       6  -------------------- end include --------------------'));
  assert.deepEqual(r.messages.map((m) => [m.line, m.text, m.file, m.resolvedFile, m.severity]),
    [[2, 'ERROR: Invalid opcode', 'R.X68', 'r.x68', 'error']]);
});

test('3.4.1: INCLUDE / INCBIN names: case, \\ and /, quotes, folder of the main file, absolute paths', async () => {
  const files = {
    'course/lab/Sub/Defs.X68': ['\tDC.W 1'], 'course/lab/data.BIN': raw('\x01\x02\x03'),
    'C:\\abs\\x.x68': ['\tDC.W 2'],
  };
  const r = await asm(['\tORG $1000', '\tINCLUDE sub\\DEFS.x68', "\tINCLUDE 'Sub/defs.X68'", '\tINCBIN "DATA.bin"',
    "\tINCLUDE 'C:\\ABS\\X.X68'", '\tINCLUDE ..\\lab\\sub\\defs.x68', '\tEND $1000'], { files, name: 'course/lab/prog.X68' });
  // sub\DEFS, Sub/defs, 3 INCBIN bytes (loc odd), C:\ABS\X aligned to $1008, ..\lab\sub\defs
  check(r, { s68: ['S10A100000010001010203DD', 'S107100800020001DD', 'S804001000EB'], msgs: [] });
  assert.equal(r.listingName, 'course/lab/prog.L68');
});

test('3.4.1: INCBIN takes the bytes as they are (binary mode), odd length leaves loc odd', async () => {
  const r = await asm(['\tORG $1000', 'D\tINCBIN b.bin', 'E\tDC.B 9', '\tEND $1000'], { files: { 'b.bin': raw('\r\n\x1A') } });
  check(r, { s68: ['S10710000D0A1A09AE', 'S804001000EB'], msgs: [] });
});

test('9.3.4 / P5: macro body lines with % keep every character (binary constants, %d)', async () => {
  const r = await asm(['M\tMACRO', '\tMOVE.B #%00001111,D0', "\tDC.B '%d%%'", '\tENDM', '\tORG $1000', '\tM', '\tEND $1000']);
  check(r, { s68: ['S10B1000103C000F25642525B6', 'S804001000EB'], msgs: [] });
});

test('3.6 / 9.3.7: 256 nested macro calls work, the 257th level is "Nested Macro calls are too many levels deep"', async () => {
  const prog = (n) => ['N\tSET 0', 'R\tMACRO', 'N\tSET N+1', '\tIFLT N-\\1', '\tR \\1', '\tENDC', '\tDC.B 1', '\tENDM',
    '\tORG $1000', `\tR ${n}`, '\tEND $1000'];
  const ok = await asm(prog(256));
  check(ok, { msgs: [], errors: 0 });
  assert.equal(ok.sRecord.length > 0, true);
  const too = await asm(prog(300));
  check(too, { msgs: [[10, 'ERROR: Nested Macro calls are too many levels deep']], errors: 1 });
});

test('1.3: a line of 255 or more characters is split after 255 (the rest is the next line)', async () => {
  const r = await asm(['\tORG $1000', '\tDC.B 1' + ' '.repeat(240) + 'DC.B 2 more', '\tEND $1000']);
  // 255 characters: "\tDC.B 1" + 240 blanks + "DC.B 2 m"; then "ore" is a line of its own: a label in column 1
  check(r, { s68: ['S104100001EA', 'S804001000EB'], msgs: [] });
  assert.ok(listing(r).some((l) => /^00001001 {29}3  ore$/.test(l)));
});

test('9.4.2: macro symbol values are temp-file offsets that count CR LF', async () => {
  const r = await asm(['A\tMACRO', '\tNOP', '\tNOP', '\tENDM', 'B\tMACRO', '\tENDM', '\tEND $1000']);
  // body of A: "\tNOP\r\n" x2 + "\tENDM\r\n" = 6 + 6 + 7 = 19 = $13
  assert.ok(listing(r).includes('B                   13'));
});

test('4.4: message line numbers: macro continuation lines are not counted', async () => {
  const r = await asm(['M\tMACRO', '\tDC.B \\1,\\2', '\tENDM', '\tORG $1000', '\tM 1,', '& 2', '\tBOGUS', '\tEND $1000']);
  assert.deepEqual(msgs(r), [[6, 'ERROR: Invalid opcode']]);     // source line 7
});

test('9.3.6: structured terminator with an empty stack is "Invalid syntax"', async () => {
  const r = await asm(['\tORG $1000', '\tENDW', '\tUNTIL D0 <EQ> D1', '\tENDF', '\tEND $1000']);
  check(r, { msgs: [[2, 'ERROR: Invalid syntax'], [3, 'ERROR: Invalid syntax'], [4, 'ERROR: Invalid syntax']], errors: 3 });
});

test('1.8: every assembly starts from a fresh state (same input, same output)', async () => {
  const prog = ['\tORG $1000', '\tIFNE 0', '\tNOP', '\tEND START'];  // leaves nestLevel and lineIdent dirty
  const a = await asm(prog);
  const b = await asm(prog);
  assert.deepEqual(a.listing, b.listing);
  assert.deepEqual(a.sRecord, b.sRecord);
  const c = await asm(['\tORG $1000', '\tIFEQ 1', '\tENDC', '\tNOP', '\tEND $1000']);
  check(c, { s68: ['S10510004E712B', 'S804001000EB'], msgs: [] });
});

test('9.2: two-character constant with a byte >= $80 is sign-extended (char is signed)', async () => {
  const r = await asm(raw("\tORG $1000\r\n\tDC.W 'A\xE9'+0\r\n\tEND $1000\r\n"));
  check(r, { s68: ['S105100040E9C1', 'S804001000EB'] });
});
