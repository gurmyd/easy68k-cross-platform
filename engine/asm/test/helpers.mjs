// Test helpers for the assembler engine (node --test).
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import assert from 'node:assert/strict';
import { assemble, decodeCp1252, encodeCp1252 } from '../asm68k.mjs';

/** The S0 header record every .S68 starts with (OBJECT.CPP:160). */
export const S0 = 'S021000036384B50524F47202020323043524541544544204259204541535936384B6D';

/** A fixed time for the "Created On:" line. */
export const TIME = { year: 2026, month: 11, day: 20, hour: 13, minute: 7, second: 46 };

/**
 * Source lines -> Windows-1252 bytes with CR LF after every line (what the
 * editor hands to the assembler). A string is split at '\n'.
 * @param {string[] | string} lines
 * @param {{ eol?: string, final?: boolean }} [opt]
 */
export function src(lines, opt = {}) {
  const eol = opt.eol ?? '\r\n';
  const list = Array.isArray(lines) ? lines : lines.split('\n');
  const text = list.join(eol) + (opt.final === false ? '' : eol);
  return encodeCp1252(text);
}

/** Raw bytes from a string of code points 0..255. */
export function raw(text) {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/**
 * Assemble a single-file or multi-file test program.
 * @param {Uint8Array | string[] | string} main  main source (bytes, or lines)
 * @param {object} [o]
 * @param {Record<string, Uint8Array | string[] | string>} [o.files] other files (lines are CR LF-terminated)
 * @param {object} [o.options] AssembleOptions
 * @param {string} [o.name] main file name (default prog.X68)
 * @param {any} [o.time]
 */
export async function asm(main, o = {}) {
  const name = o.name ?? 'prog.X68';
  const files = new Map();
  for (const [k, v] of Object.entries(o.files ?? {})) files.set(k, v instanceof Uint8Array ? v : src(v));
  files.set(name, main instanceof Uint8Array ? main : src(main));
  return assemble(name, files, o.options ?? {}, o.time ?? TIME);
}

/** The .S68 as an array of records (without line ends). */
export function records(result) {
  assert.ok(result.sRecord, 'no S-record file');
  const text = decodeCp1252(result.sRecord);
  assert.ok(text.endsWith('\r\n'), 'S-record file must end in CR LF');
  return text.slice(0, -2).split('\r\n');
}

/** The listing as an array of lines (without line ends). */
export function listing(result) {
  assert.ok(result.listing, 'no listing');
  const text = decodeCp1252(result.listing);
  return text.split('\r\n');
}

/** The listing lines from line 5 to the blank line before the error count. */
export function body(result) {
  const l = listing(result);
  const end = l.findIndex((s, i) => i > 3 && /^(No errors detected|\d+ errors? detected)$/.test(s));
  return l.slice(4, end - 1);
}

/** Compact message list: [line, text] or [line, text, file]. */
export function msgs(result) {
  return result.messages.map((m) => (m.file ? [m.line, m.text, m.file] : [m.line, m.text]));
}

/**
 * Assert the S-records (header included automatically), the message list and the counts.
 * @param {any} r
 * @param {{ s68?: string[], msgs?: Array<[number, string] | [number, string, string]>, errors?: number, warnings?: number }} e
 */
export function check(r, e) {
  assert.equal(r.fatal, null);
  if (e.s68) assert.deepEqual(records(r), [S0, ...e.s68]);
  if (e.msgs) assert.deepEqual(msgs(r), e.msgs);
  if (e.errors !== undefined) assert.equal(r.errorCount, e.errors, 'error count');
  if (e.warnings !== undefined) assert.equal(r.warningCount, e.warnings, 'warning count');
}
