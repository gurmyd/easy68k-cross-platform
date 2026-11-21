// The test corpus (ARCHITECTURE.md 6.3): which 68000 programs exist, where their files are, and
// what the official EASy68K v5.16.1 produced for each of them.
//
// `manifest.json` beside this file is the list. This module reads it and hands out a program's
// files as the assembler wants them (bytes by name). Every package that tests against the corpus
// uses it; nothing here knows about a particular assembler or simulator.
//
// This file has no imports that exist at run time besides node:*, so that Node can load it directly
// (`import ... from '../corpus/index.ts'` in a .mjs script) as well as Vitest.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AsmOptions } from '../../app/src/contracts';

/** The repository root. */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The four sets of 6.3. */
export type CorpusSet = 'official' | 'github-mit' | 'conformance' | 'site';

/**
 * Where the files of each set are, relative to the repository. The first three are tracked; `site`
 * may not be redistributed and exists only after `node tools/fetch-site-examples.mjs` (6.3).
 */
export const SET_DIRECTORIES: Readonly<Record<CorpusSet, string>> = {
  official: 'tests/corpus/official',
  'github-mit': 'tests/corpus/github',
  conformance: 'tests/conformance/asm',
  site: 'build/corpus-local/site',
};

/**
 * Where official outputs are kept (6.2.2): for the tracked sets in the repository, for `site`
 * outside it. A program's outputs are in `<folder>/<program id>/<option label>.L68` and `.S68`.
 */
export const GOLDEN_TRACKED = 'tests/conformance/asm/golden';
export const GOLDEN_LOCAL = 'build/golden-local/asm';

export type CorpusFlag =
  /** Bytes >= $80, a line longer than 255 characters, a lone LF or lone CR, a tab or Ctrl-Z (6.2.2). */
  | 'richedit-sensitive'
  /** Has an INCLUDE or INCBIN line: the program needs the other files of its folder. */
  | 'needs-include'
  /** Reads the keyboard or the mouse: it does not run to its end unattended. */
  | 'interactive';

/** What the official EDIT68K.exe did with a program under one set of options. */
export interface ExpectedRun {
  /** The assembler options that differ from a fresh installation. */
  options: Partial<AsmOptions>;
  /** `ok`: the official program assembled the file. `failed`: the automation got no result. */
  status: 'ok' | 'failed';
  /** For `failed`: what happened (the report of the T1 acceptance). */
  reason?: string;
  /**
   * SHA-256 of the text the official editor handed to its assembler. When `receivedFile` is true the
   * text differs from the editor model (`editorLoad` in tests/conformance/asm/compare.ts) and is kept
   * as `<label>.received.txt` beside the golden files.
   */
  received?: string;
  receivedFile?: boolean;
  /** The counts of the listing trailer; null when no listing was produced. */
  errors: number | null;
  warnings: number | null;
  /** SHA-256 of the canonical `.L68` and `.S68` (compare.ts); null when the file was not produced. */
  l68: string | null;
  s68: string | null;
  /** True when the listing reports an undefined symbol: the hashes are of the masked forms. */
  undefinedSymbols?: boolean;
  /**
   * True when `<label>.L68` / `<label>.S68` are in the repository (`goldenDirectory`). False: only
   * the hashes are (a `site` program, or an output too large to commit); the files are then in the
   * git-ignored folder of the machine that ran the oracle.
   */
  golden: boolean;
  /** Things the run showed that a reader should know (a stray window, a renamed status dialog). */
  notes?: string[];
}

export interface CorpusProgram {
  /**
   * Unique and stable: `official/<file>`, `github/<repository>/<path>`, `site/<category>/<archive>/<path>`,
   * `checklist/<program>` or `richedit/<file>`.
   */
  id: string;
  set: CorpusSet;
  /** Where the program comes from. */
  origin: string;
  /** Licence class: decides whether the file may be in the repository. */
  licence: string;
  /** The source file, relative to the set's folder, with `/`. */
  file: string;
  /** The folder (relative to the set's folder) whose files the program may INCLUDE or INCBIN. */
  root: string;
  /** SHA-256 and size of the source file. */
  sha256: string;
  bytes: number;
  flags: CorpusFlag[];
  /** Expected results by option label (`default`, `expand`, or a label of settings.ts). */
  runs: Record<string, ExpectedRun>;
}

export interface CorpusManifest {
  version: 1;
  /** How the expected results were produced. */
  oracle: {
    program: string;
    wine: string;
    /** ISO date of the last regeneration of any entry. */
    generated: string;
  };
  programs: CorpusProgram[];
}

export const MANIFEST_PATH = join(REPO, 'tests', 'corpus', 'manifest.json');

export function loadManifest(path: string = MANIFEST_PATH): CorpusManifest {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as CorpusManifest;
  if (manifest.version !== 1) throw new Error(`${path}: unknown manifest version ${String(manifest.version)}`);
  return manifest;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The absolute path of a program's source file. */
export function sourcePath(program: Pick<CorpusProgram, 'set' | 'file'>): string {
  return join(REPO, SET_DIRECTORIES[program.set], ...program.file.split('/'));
}

/** The absolute folder that holds the official outputs of a program (may not exist). */
export function goldenDirectory(program: Pick<CorpusProgram, 'set' | 'id'>, tracked = program.set !== 'site'): string {
  return join(REPO, tracked ? GOLDEN_TRACKED : GOLDEN_LOCAL, ...program.id.split('/'));
}

/** Whether the program's source is on this machine (the `site` set is not in the repository). */
export function programAvailable(program: Pick<CorpusProgram, 'set' | 'file'>): boolean {
  return existsSync(sourcePath(program));
}

/** Files larger than this are never offered to the assembler as INCLUDE / INCBIN candidates. */
const MAX_PROJECT_FILE = 16 * 1024 * 1024;

function walk(directory: string, prefix: string, into: Map<string, Uint8Array>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(path, name, into);
    else if (entry.isFile() && statSync(path).size <= MAX_PROJECT_FILE) into.set(name, new Uint8Array(readFileSync(path)));
  }
}

const projectCache = new Map<string, Map<string, Uint8Array>>();

/**
 * The program as the assembler wants it: every file of the program's root folder by its path below
 * that folder (with `/`), and the name of the main source among them. The map is a fresh copy; the
 * caller replaces the main entry with the editor's text before assembling.
 */
export function readProgram(program: Pick<CorpusProgram, 'set' | 'file' | 'root'>): {
  mainName: string;
  files: Map<string, Uint8Array>;
} {
  const rootDirectory = join(REPO, SET_DIRECTORIES[program.set], ...program.root.split('/').filter(Boolean));
  let files = projectCache.get(rootDirectory);
  if (!files) {
    files = new Map();
    walk(rootDirectory, '', files);
    projectCache.set(rootDirectory, files);
  }
  const mainName = program.root === '' ? program.file : program.file.slice(program.root.length + 1);
  if (!files.has(mainName)) throw new Error(`corpus program ${program.file} is not in its root folder "${program.root}"`);
  return { mainName, files: new Map(files) };
}

/**
 * The flags that can be read off the source bytes: `richedit-sensitive` (6.2.2) and `needs-include`.
 * (`interactive` is about what the program does when it runs and is set by hand or by the importer.)
 */
export function sourceFlags(source: Uint8Array): CorpusFlag[] {
  const flags: CorpusFlag[] = [];
  const text = Buffer.from(source).toString('latin1');
  const longLine = text.split(/\r\n|\n|\r/).some((line) => line.length > 255);
  const loneBreak = /\r(?!\n)|(?<!\r)\n/.test(text);
  // eslint-disable-next-line no-control-regex -- the bytes are the point
  if (/[\x80-\xff\t\x1a]/.test(text) || longLine || loneBreak) flags.push('richedit-sensitive');
  // An optional label, white space, then the directive (assembler §3.1.1).
  if (/^(?:[^\s*;]\S*)?[ \t]+(?:INCLUDE|INCBIN)\b/im.test(text)) flags.push('needs-include');
  return flags;
}
