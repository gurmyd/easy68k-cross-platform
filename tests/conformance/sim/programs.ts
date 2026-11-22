// The simulator conformance programs and what is run of each (ARCHITECTURE.md 6.2.2, 6.4). Owner: T3.
//
// Every `.X68` in a suite folder of tests/conformance/sim is a program. Its first comment block
// says what it checks and how it is run, in lines of the form `* @key value`:
//
//   * @item trap15-a §13 Text output: Task 14 with 'AB',0 at home ...   what it checks (repeatable)
//   * @recipe report                     run with /r; the program writes result.bin (the default)
//   * @recipe outlog                     run with F9 and the text-output log on: the bytes printed
//   * @recipe log:2                      the execution log of an Auto Trace, log type 1, 2 or 3;
//   * @recipe log:2+out                    `+out` also takes the text-output log
//   * @switches /e /b                    start-up switches of SIM68K.exe (exceptions, bit field)
//   * @files data.bin notes.txt          files beside the program when it runs
//   * @timeout 120                       seconds the official run may take (default 60, logs 600)
//   * @owner SH3                         the package a mismatch most likely belongs to (a hint)
//
// A program may name several recipes. The official results of each run are stored in
// golden/<suite>/<name>.<artifact> (see `artifactsOf`), their hashes in golden/manifest.json.
//
// Read by Node directly (tests/oracle/wine/sim/regenerate.mjs, type stripping) and by Vitest, so
// this file imports nothing but Node's own modules (docs/porting/errata/T1.md entry 15).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** tests/conformance/sim */
export const SIM_CONFORMANCE_DIR: string = fileURLToPath(new URL('.', import.meta.url));
/** The repository root. */
export const REPO_ROOT: string = join(SIM_CONFORMANCE_DIR, '..', '..', '..');
export const GOLDEN_DIR: string = join(SIM_CONFORMANCE_DIR, 'golden');
export const GOLDEN_MANIFEST_PATH: string = join(GOLDEN_DIR, 'manifest.json');
/** The self-report routines every report program includes as `..\dumplib.X68`. */
export const DUMPLIB_PATH: string = join(SIM_CONFORMANCE_DIR, 'dumplib.X68');
/** The file a report program writes (6.2.2). */
export const RESULT_FILE = 'result.bin';
/** The last line of a complete result file. */
export const END_OF_DUMP = 'END-OF-DUMP';

/** The suite folders, in report order (6.4, plus the instruction groups of sim-core §3.16). */
export const SUITES = ['instructions', 'exceptions', 'trap15-a', 'trap15-b', 'hardware', 'quirks', 'logs'] as const;
export type Suite = (typeof SUITES)[number];

export type Recipe =
  { kind: 'report' } | { kind: 'outlog' } | { kind: 'log'; execType: 1 | 2 | 3; withOutput: boolean };

export interface ConformanceProgram {
  /** `<suite>/<name>`, e.g. `trap15-a/t14-text-ab`. */
  id: string;
  suite: Suite;
  /** The file name without `.X68`. */
  name: string;
  /** Path of the source below tests/conformance/sim, with `/`. */
  source: string;
  items: string[];
  recipes: Recipe[];
  /** Start-up switches, e.g. ['/e']. */
  switches: string[];
  /** Data files beside the program (names below the program's folder). */
  files: string[];
  timeoutSeconds: number | null;
  owner: string | null;
}

export function recipeId(recipe: Recipe): string {
  if (recipe.kind !== 'log') return recipe.kind;
  return `log:${recipe.execType}${recipe.withOutput ? '+out' : ''}`;
}

export function parseRecipe(text: string): Recipe {
  if (text === 'report' || text === 'outlog') return { kind: text };
  const match = /^log:([123])(\+out)?$/.exec(text);
  if (!match) throw new Error(`unknown recipe "${text}" (report, outlog, log:1..3, log:N+out)`);
  return { kind: 'log', execType: Number(match[1]) as 1 | 2 | 3, withOutput: match[2] !== undefined };
}

/** What a recipe produces, as `{ artifact kind: file name the official program writes }`. */
export function officialFilesOf(recipe: Recipe, stem: string): Record<string, string> {
  switch (recipe.kind) {
    case 'report':
      return { result: RESULT_FILE };
    case 'outlog':
      return { outlog: `${stem}_OutLog.txt` };
    case 'log':
      return recipe.withOutput
        ? { runlog: `${stem}_RunLog.txt`, outlog: `${stem}_OutLog.txt` }
        : { runlog: `${stem}_RunLog.txt` };
  }
}

/** The golden file of one artifact of one recipe, relative to golden/. */
export function goldenName(program: Pick<ConformanceProgram, 'suite' | 'name'>, recipe: Recipe, kind: string): string {
  const tag = recipe.kind === 'log' ? `log${recipe.execType}${recipe.withOutput ? 'o' : ''}.` : '';
  const extension = kind === 'result' ? 'result.bin' : kind === 'runlog' ? 'RunLog.txt' : 'OutLog.txt';
  return `${program.suite}/${program.name}.${tag}${extension}`;
}

/** Every artifact of every recipe of a program: { recipe id, kind, golden name }. */
export function artifactsOf(program: ConformanceProgram): { recipe: string; kind: string; golden: string }[] {
  return program.recipes.flatMap((recipe) =>
    Object.keys(officialFilesOf(recipe, program.name)).map((kind) => ({
      recipe: recipeId(recipe),
      kind,
      golden: goldenName(program, recipe, kind),
    })),
  );
}

/** Parses the `* @key value` lines of a program's first comment block. */
export function parseHeader(text: string, suite: Suite, name: string, source: string): ConformanceProgram {
  const program: ConformanceProgram = {
    id: `${suite}/${name}`,
    suite,
    name,
    source,
    items: [],
    recipes: [],
    switches: [],
    files: [],
    timeoutSeconds: null,
    owner: null,
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === '') continue;
    if (!line.startsWith('*')) break; // the first statement ends the header
    const match = /^\*\s*@(\w+)\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match as unknown as [string, string, string];
    switch (key) {
      case 'item':
        program.items.push(value);
        break;
      case 'recipe':
        for (const word of value.split(/\s+/).filter(Boolean)) program.recipes.push(parseRecipe(word));
        break;
      case 'switches':
        program.switches.push(...value.split(/\s+/).filter(Boolean));
        break;
      case 'files':
        program.files.push(...value.split(/\s+/).filter(Boolean));
        break;
      case 'timeout':
        program.timeoutSeconds = Number(value);
        break;
      case 'owner':
        program.owner = value;
        break;
      default:
        throw new Error(`${source}: unknown header key @${key}`);
    }
  }
  for (const s of program.switches) {
    if (!['/e', '/b'].includes(s.toLowerCase())) throw new Error(`${source}: switch ${s} is not /e or /b`);
  }
  if (program.recipes.length === 0) program.recipes.push(suite === 'logs' ? parseRecipe('log:2') : { kind: 'report' });
  if (program.items.length === 0) throw new Error(`${source}: no @item line`);
  return program;
}

/** Every conformance program, sorted by id. */
export function listPrograms(root: string = SIM_CONFORMANCE_DIR): ConformanceProgram[] {
  const programs: ConformanceProgram[] = [];
  for (const suite of SUITES) {
    const directory = join(root, suite);
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      if (!/\.x68$/i.test(entry) || !statSync(join(directory, entry)).isFile()) continue;
      const name = entry.replace(/\.x68$/i, '');
      const source = `${suite}/${entry}`;
      programs.push(parseHeader(readFileSync(join(directory, entry), 'latin1'), suite, name, source));
    }
  }
  return programs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const sha256Hex = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/* --------------------------------------------------------------------------------- golden manifest */

export interface ArtifactRecord {
  /** SHA-256 of the official file after `maskArtifact`. */
  sha256: string;
  bytes: number;
}

export interface RecipeRecord {
  status: 'ok' | 'failed';
  /** Why the official run gave no result (time limit, a window, the assembler). */
  error?: string;
  seconds?: number;
  artifacts: Record<string, ArtifactRecord>;
  /** Instructions in the execution log (log recipes). */
  instructions?: number;
}

export interface ProgramRecord {
  sourceSha256: string;
  /** The official assembler's S-record file; the port's must have the same hash. */
  s68Sha256: string | null;
  /** The official assembler's listing with the `Created On:` line masked. */
  l68Sha256: string | null;
  recipes: Record<string, RecipeRecord>;
}

export interface GoldenManifest {
  /** `wine --version` in the image that produced the goldens. */
  wine: string;
  /** SHA-256 of the official SIM68K.exe and EDIT68K.exe the run checked. */
  official: Record<string, string>;
  updated: string;
  programs: Record<string, ProgramRecord>;
}

export function loadGoldenManifest(path: string = GOLDEN_MANIFEST_PATH): GoldenManifest | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GoldenManifest;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------------------------------- masking */

const CR_LF = '\r\n';

/** Text as latin-1 (one character per byte), the way the logs are compared. */
export function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return text;
}

/**
 * Bytes of an official artifact that the official program does not fix: undefined behaviour of the
 * original whose value differs between hosts, so that no golden can hold it (erratum T3 entry 16).
 * They are replaced by MASKED_TEXT in the official artifact and in the port's alike, before the
 * comparison and before the hash of golden/manifest.json. Keyed like known-differences.json
 * (`<program id>|<recipe>|<artifact kind>`); every key is listed there too, with its cause.
 */
export interface ArtifactMask {
  /** 1-based lines (split at LF) whose tail is masked. */
  lines: number[];
  /** The first masked column (1-based): from it to the end of the line, without its CR. */
  fromColumn: number;
  /** Why these bytes are not fixed, and the evidence. */
  reason: string;
}

export const MASKED_TEXT = '<masked>';

export const ARTIFACT_MASKS: Readonly<Record<string, ArtifactMask>> = {
  'trap15-a/a55-task0-negative-count-first|outlog|outlog': {
    lines: [3, 4, 5, 6],
    fromColumn: 256,
    reason:
      "What task 0 prints after the 255th character of a string without a NUL is the official program's " +
      'host-stack residue (strncpy without a terminator). The same image (Wine 8.0~repack-4) gave, every ' +
      'time, $C0 after lines 3 and 4 on Docker Desktop (WSL 2 kernel 6.18.33.1) and $C0 after line 4 only ' +
      "on GitHub's ubuntu-24.04 runner (oracle run 45034017858).",
  },
};

/**
 * The form in which an artifact is compared and hashed: the header date of a log
 * (`EASy68K execution log file: 11/20/2026 9:56:12 PM`, `EASy68K output log file: ...`) becomes
 * `<date>`, and for an artifact named in ARTIFACT_MASKS (`key`) the bytes it names become
 * MASKED_TEXT. Everything else, line ends included, is compared byte for byte.
 */
export function maskArtifact(kind: string, bytes: Uint8Array, key?: string): string {
  const text = latin1(bytes);
  const dated =
    kind === 'result' ? text : text.replace(/^(EASy68K (?:execution|output) log file: )[^\r\n]*/, '$1<date>');
  const mask = key === undefined ? undefined : ARTIFACT_MASKS[key];
  if (!mask) return dated;
  return dated
    .split('\n')
    .map((line, index) => {
      if (!mask.lines.includes(index + 1)) return line;
      const cr = line.endsWith('\r') ? '\r' : '';
      return `${line.slice(0, mask.fromColumn - 1)}${MASKED_TEXT}${cr}`;
    })
    .join('\n');
}

/** The key of ARTIFACT_MASKS and known-differences.json for one artifact of one recipe. */
export function artifactKey(programId: string, recipe: string, kind: string): string {
  return `${programId}|${recipe}|${kind}`;
}

/** The listing with its `Created On:` line masked (assembler §6, line 3). */
export function maskListing(bytes: Uint8Array): string {
  return latin1(bytes).replace(/^(Created On:)[^\r\n]*/m, '$1<date>');
}

/** The lines of a result file, without the line ends; the marker line ends the list. */
export function resultLines(text: string): string[] {
  const lines = text.split(CR_LF);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Number of instructions in an execution log (one `PC=` line each). */
export function countLoggedInstructions(text: string): number {
  return (text.match(/\nPC=/g) ?? []).length;
}
