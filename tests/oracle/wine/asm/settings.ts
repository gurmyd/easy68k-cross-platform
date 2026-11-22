// settings.dat for the official EDIT68K.exe (ARCHITECTURE.md 6.2.2: "Options are selected by writing
// settings.dat first").
//
// The editor reads settings.dat beside the EXE when it starts and takes every assembler option from
// it (assembler §2). A line is `<value>$<key>`; the editor uses a line only if the key text matches
// exactly and it reads the lines by position, so this module changes values in the shipped file and
// never adds, removes or reorders a line.
//
// This file has no imports that exist at run time, so that Node can load it directly
// (`import ... from './settings.ts'` in regenerate.mjs) as well as Vitest.

import type { AsmOptions } from '../../../../app/src/contracts';

/** The options of one assembly that differ from a fresh installation (the shipped settings.dat). */
export type OracleOptions = Partial<AsmOptions>;

/** The two option sets every corpus program is assembled with (official-oracle §3.2). */
export const CORPUS_OPTION_SETS: Readonly<Record<'default' | 'expand', OracleOptions>> = {
  default: {},
  expand: { macrosExpanded: true, structuredExpanded: true, constantsExpanded: true },
};

/**
 * The eight assembler options of the Assembler Options dialog, each switched alone from its shipped
 * value, by the label `optionLabel` gives the run (ARCHITECTURE.md 6.9 item 1). The programs of
 * tests/corpus/option-subset.json are assembled with each of them besides their other runs.
 */
export const SINGLE_OPTION_SETS: Readonly<Record<string, OracleOptions>> = {
  nolist: { generateListing: false },
  nosrec: { generateSRecord: false },
  nowar: { showWarnings: false },
  nocre: { crossReference: false },
  mex: { macrosExpanded: true },
  sex: { structuredExpanded: true },
  cex: { constantsExpanded: true },
  nobit: { bitFieldInstructions: false },
};

/**
 * For a run with Generate Listing off: the label of the run with the same options and the listing
 * on, whose listing names the undefined-symbol statements to mask in this run's S-records (erratum
 * T1 20). Null for a run that has a listing of its own.
 */
export function listingOnLabel(options: OracleOptions): string | null {
  return options.generateListing === false ? optionLabel({ ...options, generateListing: true }) : null;
}

/** Key text of settings.dat for each assembler option (optionsS.cpp:157-173). */
const KEYS: Readonly<Record<keyof AsmOptions, string>> = {
  generateListing: 'generate list',
  generateSRecord: 'generate s-record',
  showWarnings: 'show warnings',
  crossReference: 'cross reference',
  macrosExpanded: 'macros expanded',
  structuredExpanded: 'structured expand',
  constantsExpanded: 'constants expand',
  tabType: 'tab type',
  tabSize: 'fixed tab size',
  bitFieldInstructions: 'assemble bit field',
};

/** What a fresh installation assembles with: the values of the shipped settings.dat (assembler §2). */
export const SHIPPED_OPTIONS: Readonly<AsmOptions> = {
  generateListing: true,
  generateSRecord: true,
  showWarnings: true,
  crossReference: true,
  macrosExpanded: false,
  structuredExpanded: false,
  constantsExpanded: false,
  tabType: 1,
  tabSize: 4,
  bitFieldInstructions: true,
};

function valueText(key: keyof AsmOptions, value: boolean | number): string {
  if (key === 'tabSize') {
    if (!Number.isInteger(value) || (value as number) < -99 || (value as number) > 99) {
      throw new RangeError(`tabSize must be an integer from -99 to 99, got ${String(value)}`);
    }
    return String(value);
  }
  if (key === 'tabType') {
    if (value !== 0 && value !== 1) throw new RangeError(`tabType must be 0 (Assembly) or 1 (Fixed)`);
    return String(value);
  }
  if (typeof value !== 'boolean') throw new TypeError(`${key} must be a boolean`);
  return value ? '1' : '0';
}

/**
 * The shipped settings.dat with the given options set. Bytes in, bytes out: the file is
 * Windows-1252 with CR LF, and nothing but the value in front of a `$key` is changed.
 * Throws when the shipped file lacks the line of an option that is asked for.
 */
export function buildSettingsDat(shipped: Uint8Array, options: OracleOptions): Uint8Array {
  const lines = Buffer.from(shipped).toString('latin1').split('\r\n');
  for (const [name, value] of Object.entries(options) as [keyof AsmOptions, boolean | number][]) {
    const key = KEYS[name];
    if (key === undefined) throw new TypeError(`unknown assembler option "${name}"`);
    const index = lines.findIndex((line) => line.slice(line.indexOf('$')) === `$${key}`);
    if (index < 0) throw new Error(`settings.dat has no "$${key}" line`);
    lines[index] = `${valueText(name, value)}$${key}`;
  }
  return Uint8Array.from(Buffer.from(lines.join('\r\n'), 'latin1'));
}

/** The assembler options a settings.dat selects (the inverse of buildSettingsDat, for checks). */
export function readSettingsDat(settings: Uint8Array): AsmOptions {
  const lines = Buffer.from(settings).toString('latin1').split('\r\n');
  const out: Record<string, boolean | number> = { ...SHIPPED_OPTIONS };
  for (const [name, key] of Object.entries(KEYS) as [keyof AsmOptions, string][]) {
    const line = lines.find((candidate) => candidate.slice(candidate.indexOf('$')) === `$${key}`);
    if (line === undefined) continue;
    const text = line.slice(0, line.indexOf('$'));
    if (name === 'tabSize') out[name] = Number.parseInt(text, 10);
    else if (name === 'tabType')
      out[name] = text === '0' ? 0 : 1; // optionsS.cpp:363: only '0' is Assembly
    else out[name] = text === '1'; // any other character means off
  }
  return out as unknown as AsmOptions;
}

/**
 * A short, file-name-safe label for an option set: "default" for the shipped options, otherwise
 * the options that differ, in a fixed order, e.g. "mex+sex+cex" or "nolist+tab-assembly".
 */
export function optionLabel(options: OracleOptions): string {
  const parts: string[] = [];
  const flag = (name: keyof AsmOptions, on: string, off: string): void => {
    const value = options[name];
    if (value !== undefined && value !== SHIPPED_OPTIONS[name]) parts.push(value ? on : off);
  };
  flag('generateListing', 'list', 'nolist');
  flag('generateSRecord', 'srec', 'nosrec');
  flag('showWarnings', 'war', 'nowar');
  flag('crossReference', 'cre', 'nocre');
  flag('macrosExpanded', 'mex', 'nomex');
  flag('structuredExpanded', 'sex', 'nosex');
  flag('constantsExpanded', 'cex', 'nocex');
  flag('bitFieldInstructions', 'bit', 'nobit');
  const tabType = options.tabType ?? SHIPPED_OPTIONS.tabType;
  const tabSize = options.tabSize ?? SHIPPED_OPTIONS.tabSize;
  if (tabType === 0) parts.push('tab-assembly');
  if (tabSize !== SHIPPED_OPTIONS.tabSize) parts.push(`tab-fixed-${tabSize}`);
  return parts.length === 0 ? 'default' : parts.join('+');
}
