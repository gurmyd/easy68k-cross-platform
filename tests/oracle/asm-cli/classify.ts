// L3 of the test strategy (ARCHITECTURE.md 6.1): the port's assembler against `asy68k.exe`, the
// command-line port of the EASy68K assembler v5.15.4, on the same text and options. The two must
// agree except where a documented difference between the command-line port and v5.16.1 applies
// (docs/porting/assembler.md §8.2, §8.3; docs/porting/official-oracle.md §3.5). This module decides
// whether a difference is one of those; run.mjs does the assembling.
//
// The decision is made per program, from its source text, and it errs on the side of "unexplained":
// a class is accepted only when the source contains the construct that causes it.
//
// No run-time imports (run.mjs loads this file directly; see tests/corpus/index.ts).

export interface Outputs {
  listing: Uint8Array | null;
  sRecord: Uint8Array | null;
}

/** Memory addresses `from` (included) to `to` (not included), as in tests/conformance/asm/compare.ts. */
type AddressRange = readonly [from: number, to: number];

/** The canonical forms of tests/conformance/asm/compare.ts, passed in by the caller. */
export interface Canonical {
  canonicalListing(listing: Uint8Array): Uint8Array;
  undefinedSymbolRanges(listing: Uint8Array): AddressRange[];
  canonicalSRecord(sRecord: Uint8Array, masked: readonly AddressRange[]): Uint8Array;
}

export type DifferenceClass =
  /** The command-line port prints generated labels as `_0000000e`, the original as `_0000000E` (§8.2). */
  | 'structured-label-case'
  /** Object code of a statement with an undefined symbol: uninitialised in both (official-oracle §3.5). */
  | 'undefined-symbol'
  /** §8.2: the command-line port does not upper-case a line that contains INCLUDE or INCBIN. */
  | 'cli-include-line'
  /** §8.2: the command-line port writes `Could not open file` into the listing. */
  | 'cli-could-not-open'
  /** §8.3 #3 and #4: the two operand changes of v5.16.1 in OPPARSE.CPP. */
  | 'v5.16.1-operand';

export interface Classification {
  verdict: 'identical' | 'explained' | 'unexplained';
  classes: DifferenceClass[];
  /** For `unexplained`: the first differing line of each file. */
  detail?: string;
}

const decode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const encode = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'latin1'));

/**
 * The listing without its three header lines (start address, assembler name, date) and the empty
 * lines after them: the command-line port names itself differently and prints one more empty line.
 */
export function listingBody(listing: Uint8Array): string[] {
  const lines = decode(listing).split('\r\n');
  let start = lines.findIndex((line) => line.startsWith('Created On:'));
  start = start < 0 ? 0 : start + 1;
  while (start < lines.length && lines[start] === '') start++;
  return lines.slice(start);
}

/** `_0000000e` -> `_0000000E`: the generated labels of structured statements. */
const upperLabels = (line: string): string => line.replace(/_[0-9A-Fa-f]{8}\b/g, (label) => label.toUpperCase());

/**
 * A line the command-line port mistreats (§8.2): the text INCLUDE or INCBIN anywhere in it, in any
 * case, and at least one lower-case letter outside quotes that upper-casing would have changed.
 */
export function hasCliIncludeLine(source: string): boolean {
  return source.split(/\r\n|\n|\r/).some((line) => /include|incbin/i.test(line) && /[a-z]/.test(line.replace(/'[^']*'/g, '')));
}

/**
 * An operand v5.16.1 assembles differently (§8.3): `(d,PC,Xn)` and `(PC,Xn)` with everything inside
 * the parentheses (not the spelling `d(PC,Xn)`), or `(d,An...)` whose displacement text starts with
 * `P` or has `C` as its second character.
 */
export function hasChangedOperand(source: string): boolean {
  return source.split(/\r\n|\n|\r/).some((line) => {
    if (/^\s*[*;]/.test(line)) return false;
    const text = line.toUpperCase();
    return /\([^()]*,\s*PC\s*,/.test(text) || /(?<![\w.$)'])\(\s*PC\s*,/.test(text) || /\((?:P|[^,()]C)[^,()]*,\s*(?:A[0-7]|SP)\b/.test(text);
  });
}

function firstDifference(name: string, a: string[], b: string[]): string {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] !== b[index]) {
      return `${name} line ${index + 1}\n  command-line port: ${a[index] ?? '(no such line)'}\n  port:              ${b[index] ?? '(no such line)'}`;
    }
  }
  return '';
}

/**
 * Compares the outputs of the command-line port (`cli`) and of the port (`port`) for one program.
 * `sources` are the texts of the main source and of every file it may include.
 */
export function classify(cli: Outputs, port: Outputs, sources: string[], canonical: Canonical): Classification {
  if (cli.listing === null || port.listing === null || cli.sRecord === null || port.sRecord === null) {
    const missing = [cli.listing, cli.sRecord, port.listing, port.sRecord].map((file) => (file === null ? 'missing' : 'present'));
    return { verdict: 'unexplained', classes: [], detail: `outputs (cli .L68, cli .S68, port .L68, port .S68): ${missing.join(', ')}` };
  }
  const classes: DifferenceClass[] = [];
  let cliBody = listingBody(cli.listing);
  let portBody = listingBody(port.listing);
  let cliRecords = decode(cli.sRecord).split('\r\n');
  let portRecords = decode(port.sRecord).split('\r\n');
  const same = (): boolean => cliBody.join('\n') === portBody.join('\n') && cliRecords.join('\n') === portRecords.join('\n');
  if (same()) return { verdict: 'identical', classes };

  // File-level causes that change messages and addresses: nothing below them can be compared.
  if (cliBody.some((line) => line.startsWith('Could not open file'))) classes.push('cli-could-not-open');
  if (sources.some(hasCliIncludeLine)) classes.push('cli-include-line');
  if (sources.some(hasChangedOperand)) classes.push('v5.16.1-operand');
  if (classes.length > 0) return { verdict: 'explained', classes };

  // Line-level causes: remove them one by one and compare again.
  if (cliBody.some((line, index) => line !== portBody[index] && upperLabels(line) === upperLabels(portBody[index] ?? ''))) {
    classes.push('structured-label-case');
    cliBody = cliBody.map(upperLabels);
    portBody = portBody.map(upperLabels);
    if (same()) return { verdict: 'explained', classes };
  }
  if (portBody.some((line) => /^Line \d+ ERROR: Undefined symbol$/.test(line))) {
    const mask = (body: string[]): string[] => decode(canonical.canonicalListing(encode(body.join('\r\n')))).split('\r\n');
    // Only the bytes of the statements that report the undefined symbol, in either listing.
    const masked = [...canonical.undefinedSymbolRanges(cli.listing), ...canonical.undefinedSymbolRanges(port.listing)];
    const maskRecords = (records: string[]): string[] => decode(canonical.canonicalSRecord(encode(records.join('\r\n')), masked)).split('\r\n');
    cliBody = mask(cliBody);
    portBody = mask(portBody);
    cliRecords = maskRecords(cliRecords);
    portRecords = maskRecords(portRecords);
    if (same()) return { verdict: 'explained', classes: [...classes, 'undefined-symbol'] };
  }
  const detail = [firstDifference('.L68', cliBody, portBody), firstDifference('.S68', cliRecords, portRecords)].filter(Boolean).join('\n');
  return { verdict: 'unexplained', classes, detail };
}
