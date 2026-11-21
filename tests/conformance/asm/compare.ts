// Comparing assembler output with the output of the official EASy68K v5.16.1 (ARCHITECTURE.md 6.1
// layer L2, 6.2.2; docs/porting/official-oracle.md sections 3 and 4).
//
// Three things in an official `.L68` / `.S68` pair are not reproducible and are taken out before two
// files are compared (official-oracle §4):
//
//   1. the date line (`Created On:`), which carries the clock of the run;
//   2. the object code of a statement with an undefined symbol: the original encodes uninitialised
//      memory there (official-oracle §3.5), the port a zero;
//   3. what follows from 2: the object-code field of that statement in the listing, and the bytes
//      of that statement in the S-records.
//
// `canonicalListing` and `canonicalSRecord` do exactly that and nothing else. For a program without
// an undefined symbol the canonical S-record is the file itself and the canonical listing differs
// from the file only in the date line. For a program with one, every byte outside the statements
// that report it is still compared.
//
// The module also holds the model of what the editor hands to its assembler (`editorLoad`), which
// the oracle run checks against the text it captured from the official editor.
//
// This file has no imports that exist at run time besides node:*, so that Node can load it directly
// (`import ... from './compare.ts'` in a .mjs script) as well as Vitest.

import { createHash } from 'node:crypto';

const decode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const encode = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'latin1'));

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// --- the editor's load ---------------------------------------------------------------------------

export interface EditorLoad {
  /** The text the editor hands to the assembler (`EASy68Ks.tmp`). */
  text: Uint8Array;
  /** From a `*~Tab type~N~` line: 0 = Assembly, 1 = Fixed. Absent: the Editor Options value. */
  tabType?: 0 | 1;
  /** From a `*~Tab size~N~` line. Absent: the Editor Options value. */
  tabSize?: number;
}

const TRAILER = ['*~Tab size~', '*~Tab type~', '*~Font size~', '*~Font name~'];

/**
 * What EDIT68K does with a source file before it assembles it (official-oracle §3.3):
 *
 * - the file is loaded into the RichEdit control as plain text; CR LF, a lone LF and a lone CR each
 *   end a line;
 * - the lines `*~Font name~`, `*~Font size~`, `*~Tab type~`, `*~Tab size~` among the last four lines
 *   are deleted, and the two tab lines set the document's tab type and size (textS.cpp:140-173: the
 *   loop looks at the line indices count .. count-4 and deletes as it goes);
 * - the text is saved with CR LF after every line; the last line gets one only if the file ended in
 *   a line break.
 *
 * The oracle run compares this model with the text captured from the official editor under Wine for
 * every program; where they differ the manifest says so (`receivedFile`).
 */
export function editorLoad(source: Uint8Array): EditorLoad {
  const text = decode(source);
  const endsWithBreak = text.endsWith('\n') || text.endsWith('\r');
  const lines = text.split(/\r\n|\n|\r/);
  if (endsWithBreak) lines.pop();
  const result: { tabType?: 0 | 1; tabSize?: number } = {};
  const count = lines.length;
  for (let index = count; index > count - 5; index--) {
    const line = index >= 0 && index < lines.length ? lines[index] : undefined;
    if (line === undefined || !TRAILER.some((prefix) => line.startsWith(prefix))) continue;
    if (line.startsWith('*~Tab size~')) {
      // Up to two characters, ended by '~', read with atoi (textS.cpp:146-150).
      const digits = /^[^~]{0,2}/.exec(line.slice(11))?.[0] ?? '';
      const value = Number.parseInt(digits, 10);
      result.tabSize = Number.isNaN(value) ? 0 : value;
    } else if (line.startsWith('*~Tab type~')) {
      result.tabType = line.charAt(11) === '0' ? 0 : 1;
    }
    lines.splice(index, 1);
  }
  let out = lines.join('\r\n');
  if (endsWithBreak && lines.length > 0) out += '\r\n';
  return { text: encode(out), ...result };
}

// --- reading a listing ---------------------------------------------------------------------------

const DATE_LINE = 2; // third line: "Created On: 11/20/2026 9:20:04 PM"
const DATE_MASK = 'Created On: <date>';
const MESSAGE = /^Line \d+ (?:ERROR|WARNING): /;
const UNDEFINED_SYMBOL = /^Line \d+ ERROR: Undefined symbol$/;
/** A continuation line of a statement's object code: no address, no source text. */
const CONTINUATION = /^ {10}[0-9A-F]/;
/**
 * Columns of the object-code field of a listing line: after the address and its two-character
 * separator, up to the line number. The original prints the address and the code as one field of
 * 32 characters and the line number in the six columns after it (LISTING.CPP:129, 159-161).
 */
const OBJECT_FIELD: readonly [number, number] = [10, 32];
/** A listing line that starts with the location counter (`00001000  ` or, for data, `00001000= `). */
const ADDRESS = /^([0-9A-F]{8})[ =] /;
/** The first line of the listing trailer; the lines of the program end above it. */
const ERROR_COUNT = /^(?:No errors detected|\d+ errors? detected)$/;

/**
 * The time of the `Created On:` line as a local time, or null when the listing has none or the
 * time does not exist in this machine's time zone.
 */
export function createdOn(listing: Uint8Array): Date | null {
  const line = decode(listing.subarray(0, 400)).split('\r\n')[DATE_LINE] ?? '';
  const match = /^Created On: (\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+) (AM|PM)$/.exec(line);
  if (!match) return null;
  const [month, day, year, hour12, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const hour = (hour12 % 12) + (match[7] === 'PM' ? 12 : 0);
  const date = new Date(year, month - 1, day, hour, minute, second);
  // The line was written by another clock: a time that does not exist here (the hour a time zone
  // skips when its summer time begins) cannot be handed to an assembler as local time.
  const exists =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === second;
  return exists ? date : null;
}

/** The counts of the listing trailer (`No errors detected` / `3 errors detected`, and warnings). */
export function listingCounts(listing: Uint8Array): { errors: number | null; warnings: number | null } {
  const text = decode(listing);
  const errors = /^(\d+) errors? detected\r?$/m.exec(text);
  const warnings = /^(\d+) warnings? generated\r?$/m.exec(text);
  return {
    errors: errors ? Number(errors[1]) : /^No errors detected\r?$/m.test(text) ? 0 : null,
    warnings: warnings ? Number(warnings[1]) : /^No warnings generated\r?$/m.test(text) ? 0 : null,
  };
}

/** Whether the listing reports an undefined symbol. */
export function hasUndefinedSymbols(listing: Uint8Array): boolean {
  return decode(listing)
    .split('\r\n')
    .some((line) => UNDEFINED_SYMBOL.test(line));
}

const maskHex = (text: string): string => text.replace(/[0-9A-F]/g, '#');

function maskObjectField(line: string): string {
  const [from, to] = OBJECT_FIELD;
  return line.slice(0, from) + maskHex(line.slice(from, to)) + line.slice(to);
}

/**
 * The statements of a listing that report an undefined symbol: for each, the indices of the
 * listing lines that show its object code, the source line first.
 *
 * The original prints the message directly above the LAST listing line of the statement: the
 * source line itself, or, when the object code continues on further lines ("Constants Expanded"),
 * the last continuation line; then the lines above the message up to and including the source line
 * belong to the statement too.
 */
function undefinedStatements(lines: readonly string[]): number[][] {
  const statements: number[][] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!UNDEFINED_SYMBOL.test(lines[index] ?? '')) continue;
    // The first line below the block of messages this one is part of.
    let below = index + 1;
    while (below < lines.length && MESSAGE.test(lines[below] ?? '')) below++;
    if (below >= lines.length) continue;
    const statement = [below];
    if (CONTINUATION.test(lines[below] ?? '')) {
      // Upwards: skip the message block, then the continuation lines, then the source line.
      let above = index - 1;
      while (above >= 0 && MESSAGE.test(lines[above] ?? '')) above--;
      while (above >= 0 && CONTINUATION.test(lines[above] ?? '')) statement.unshift(above--);
      if (above >= 0) statement.unshift(above);
    }
    statements.push(statement);
  }
  return statements;
}

/**
 * The listing with everything removed that the original does not reproduce:
 *
 * - the date line becomes `Created On: <date>`;
 * - for every statement with an `Undefined symbol` message, the hexadecimal digits of its
 *   object-code field become `#`, on every listing line of the statement;
 * - in the symbol table of such a listing, the value of an entry whose name cannot be a label
 *   (it does not start with a letter, `.`, `_` or `$`) becomes `#`: the original creates such an
 *   entry from a failed operand and leaves its value uninitialised.
 */
export function canonicalListing(listing: Uint8Array): Uint8Array {
  const lines = decode(listing).split('\r\n');
  if (lines[DATE_LINE]?.startsWith('Created On: ')) lines[DATE_LINE] = DATE_MASK;
  const statements = undefinedStatements(lines);
  for (const index of statements.flat()) lines[index] = maskObjectField(lines[index] ?? '');
  if (lines.some((line) => UNDEFINED_SYMBOL.test(line))) {
    const table = lines.indexOf('SYMBOL TABLE INFORMATION');
    for (let index = table < 0 ? lines.length : table + 3; index < lines.length; index++) {
      const entry = /^(\S+)(\s+)([0-9A-F]+)$/.exec(lines[index] ?? '');
      if (entry && !/^[A-Za-z._$]/.test(entry[1] ?? '')) lines[index] = `${entry[1]}${entry[2]}#`;
    }
  }
  return encode(lines.join('\r\n'));
}

/** Memory addresses `from` (included) to `to` (not included). */
export type AddressRange = readonly [from: number, to: number];

const addressOf = (line: string | undefined): number | null => {
  const match = ADDRESS.exec(line ?? '');
  return match ? Number.parseInt(match[1] as string, 16) : null;
};

/**
 * Where the statements with an undefined symbol put their object code, read off the listing: these
 * are the only bytes of the S-records that are not compared.
 *
 * A statement's bytes start at the address of its listing line and end where the next listing line
 * starts. That covers code the listing does not show (`...` without "Constants Expanded", the body
 * of a macro call that is not expanded). When no line follows, or the next one is at a lower
 * address (an `ORG` backwards), the statement has the bytes its object-code field shows.
 */
export function undefinedSymbolRanges(listing: Uint8Array): AddressRange[] {
  const lines = decode(listing).split('\r\n');
  const trailer = lines.findIndex((line) => ERROR_COUNT.test(line));
  const end = trailer < 0 ? lines.length : trailer;
  const ranges: AddressRange[] = [];
  for (const statement of undefinedStatements(lines)) {
    const from = addressOf(lines[statement[0] as number]);
    if (from === null) continue;
    let to: number | null = null;
    for (let index = (statement.at(-1) as number) + 1; index < end && to === null; index++) {
      to = addressOf(lines[index]);
    }
    if (to === null || to < from) {
      const [left, right] = OBJECT_FIELD;
      const shown = statement.map((index) => (lines[index] ?? '').slice(left, right)).join('');
      to = from + (shown.match(/[0-9A-F#]/g)?.length ?? 0) / 2;
    }
    if (to > from) ranges.push([from, to]);
  }
  return ranges;
}

/**
 * The S-record file as it can be compared: the file itself, except that the data bytes of the S1,
 * S2 and S3 records at the addresses of `masked` (`undefinedSymbolRanges` of the listing of the
 * same run) become `##`, and so does the checksum of a record that holds such a byte. Type,
 * length and address of every record and every other byte are compared.
 */
export function canonicalSRecord(sRecord: Uint8Array, masked: readonly AddressRange[]): Uint8Array {
  if (masked.length === 0) return sRecord;
  const isMasked = (address: number): boolean => masked.some(([from, to]) => address >= from && address < to);
  const addressDigits: Record<string, number> = { S1: 4, S2: 6, S3: 8 };
  const lines = decode(sRecord)
    .split('\r\n')
    .map((line) => {
      const digits = addressDigits[line.slice(0, 2)];
      const head = 4 + (digits ?? 0); // type, length, address
      // A record that is not well formed is left alone, so it is compared as it is.
      if (digits === undefined || !/^[0-9A-F]*$/.test(line.slice(2)) || (line.length - head) % 2 !== 0) return line;
      const start = Number.parseInt(line.slice(4, head), 16);
      const data = line.slice(head, -2);
      let out = '';
      for (let offset = 0; offset < data.length; offset += 2) {
        out += isMasked(start + offset / 2) ? '##' : data.slice(offset, offset + 2);
      }
      return out === data ? line : `${line.slice(0, head)}${out}##`;
    });
  return encode(lines.join('\r\n'));
}

// --- comparing -----------------------------------------------------------------------------------

export interface Outputs {
  listing: Uint8Array | null;
  sRecord: Uint8Array | null;
}

export interface FileVerdict {
  /** `identical`: the canonical forms are equal. */
  equal: boolean;
  /** For a difference: the first lines that differ (1-based line number, expected, actual). */
  differences: { line: number; expected: string | null; actual: string | null }[];
  differingLines: number;
}

function compareText(expected: Uint8Array | null, actual: Uint8Array | null, limit: number): FileVerdict {
  if (expected === null || actual === null) {
    const equal = expected === null && actual === null;
    return {
      equal,
      differences: equal
        ? []
        : [{ line: 0, expected: expected ? '(file)' : '(no file)', actual: actual ? '(file)' : '(no file)' }],
      differingLines: equal ? 0 : 1,
    };
  }
  if (Buffer.compare(expected, actual) === 0) return { equal: true, differences: [], differingLines: 0 };
  const a = decode(expected).split('\r\n');
  const b = decode(actual).split('\r\n');
  const differences: FileVerdict['differences'] = [];
  let differingLines = 0;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === b[index]) continue;
    differingLines++;
    if (differences.length < limit) {
      differences.push({ line: index + 1, expected: a[index] ?? null, actual: b[index] ?? null });
    }
  }
  return { equal: false, differences, differingLines };
}

export interface Verdict {
  /** Both files equal in their canonical forms. */
  equal: boolean;
  /** True when the comparison had to mask undefined-symbol statements. */
  undefinedSymbols: boolean;
  listing: FileVerdict;
  sRecord: FileVerdict;
}

/**
 * Compares what the official program produced with what another assembler produced for the same
 * text and options. `limit` is the number of differing lines kept per file for the report.
 */
export function compareOutputs(expected: Outputs, actual: Outputs, limit = 5): Verdict {
  const undefinedSymbols =
    (expected.listing !== null && hasUndefinedSymbols(expected.listing)) ||
    (actual.listing !== null && hasUndefinedSymbols(actual.listing));
  // The statements of either side: when the two listings agree, they name the same bytes.
  const masked = [expected.listing, actual.listing].flatMap((listing) =>
    listing === null ? [] : undefinedSymbolRanges(listing),
  );
  const canonL = (bytes: Uint8Array | null): Uint8Array | null => (bytes === null ? null : canonicalListing(bytes));
  const canonS = (bytes: Uint8Array | null): Uint8Array | null =>
    bytes === null ? null : canonicalSRecord(bytes, masked);
  const listing = compareText(canonL(expected.listing), canonL(actual.listing), limit);
  const sRecord = compareText(canonS(expected.sRecord), canonS(actual.sRecord), limit);
  return { equal: listing.equal && sRecord.equal, undefinedSymbols, listing, sRecord };
}

/** The two hashes the corpus manifest stores for a run (null for a file that was not produced). */
export function canonicalHashes(outputs: Outputs): {
  l68: string | null;
  s68: string | null;
  undefinedSymbols: boolean;
} {
  const undefinedSymbols = outputs.listing !== null && hasUndefinedSymbols(outputs.listing);
  const masked = outputs.listing === null ? [] : undefinedSymbolRanges(outputs.listing);
  return {
    l68: outputs.listing === null ? null : sha256Hex(canonicalListing(outputs.listing)),
    s68: outputs.sRecord === null ? null : sha256Hex(canonicalSRecord(outputs.sRecord, masked)),
    undefinedSymbols,
  };
}

/** A few lines of text that say where two outputs differ, for a test failure or a report. */
export function describeVerdict(verdict: Verdict): string {
  const part = (name: string, file: FileVerdict): string[] =>
    file.equal
      ? []
      : [
          `${name}: ${file.differingLines} differing line${file.differingLines === 1 ? '' : 's'}`,
          ...file.differences.flatMap((d) => [
            `  line ${d.line} official: ${d.expected ?? '(no such line)'}`,
            `  line ${d.line} ours:     ${d.actual ?? '(no such line)'}`,
          ]),
        ];
  return [...part('.L68', verdict.listing), ...part('.S68', verdict.sRecord)].join('\n');
}
