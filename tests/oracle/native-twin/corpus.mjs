// The programs the twins are compared on (ARCHITECTURE.md 6.2.1, 6.3).
//
//   tracked   every .X68 file under tests/ (the official and github-mit corpus of tests/corpus,
//             the conformance programs of tests/conformance/*, the oracles' own test programs):
//             always, and the only set in CI
//   local     the example programs under reference/examples and build/corpus-local (not in the
//             repository; used when present and asked for with --local)
//
// The folder reference/examples/github/easy68k-qt is never read (ARCHITECTURE.md 6.3).
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '..', '..', '..');
const FORBIDDEN = join(repo, 'reference', 'examples', 'github', 'easy68k-qt').toLowerCase();

const isForbidden = (path) => {
  const p = resolve(path).toLowerCase();
  return p === FORBIDDEN || p.startsWith(FORBIDDEN + sep);
};

function walk(dir, out) {
  if (!existsSync(dir) || isForbidden(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.x68$/i.test(entry.name)) out.push(p);
  }
  return out;
}

/** @param {{ local?: boolean }} [options] @returns {string[]} absolute paths, sorted */
export function corpusFiles(options = {}) {
  const files = walk(join(repo, 'tests'), []);
  if (options.local) {
    walk(join(repo, 'reference', 'examples'), files);
    walk(join(repo, 'build', 'corpus-local'), files);
  }
  return files.filter((p) => !isForbidden(p)).sort();
}

/** The files of a program's folder that INCLUDE and INCBIN may read (outputs excluded). */
export function folderFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (ext === '.l68' || ext === '.s68') continue;
    const p = join(dir, entry.name);
    if (statSync(p).size > 16 * 1024 * 1024) continue;
    files.push(p);
  }
  return files;
}

let asmModule = null;
/** engine/asm/asm68k.mjs (needs engine/dist). */
export async function assemblerModule() {
  asmModule ??= await import(pathToFileURL(join(repo, 'engine', 'asm', 'asm68k.mjs')).href);
  return asmModule;
}

/** An INCLUDE or INCBIN of a file in the parent folder, as `INCLUDE '..\dumplib.X68'`. */
const PARENT_REFERENCE = /\b(?:INCLUDE|INCBIN)\s+['"]?\.\.[\\/]/i;

/**
 * A program as the editor would assemble it: the main file loaded as the editor loads it (trailer
 * removed, its tab settings applied), every other file of its folder available by name.
 *
 * A program that INCLUDEs or INCBINs a file of its parent folder (`..\dumplib.X68`, as the
 * simulator conformance programs of tests/conformance/sim do) is named relative to that parent
 * instead: the main file is `<folder>/<name>`, the files of its folder `<folder>/<file>` and the
 * files of the parent folder plain `<file>`, so that the reference resolves as in the original's
 * folder. Without that such a program does not assemble and the simulator comparison skips it.
 *
 * `inputs` lists every [name, bytes] pair to hand to the assembler, the main file included.
 * @param {string} path
 */
export async function loadProgram(path) {
  const { loadEditorText } = await assemblerModule();
  const loaded = loadEditorText(new Uint8Array(readFileSync(path)));
  const dir = dirname(path);
  const stripped = new Uint8Array(loaded.text);
  const folder = folderFiles(dir);
  const usesParent = PARENT_REFERENCE.test(Buffer.from(stripped).toString('latin1'));
  const prefix = usesParent ? `${basename(dir)}/` : '';
  const mainName = prefix + basename(path);
  const bytesOf = (f) => (f === path ? stripped : new Uint8Array(readFileSync(f)));
  /** @type {Array<[string, Uint8Array]>} */
  const inputs = folder.map((f) => [prefix + basename(f), bytesOf(f)]);
  if (usesParent) for (const f of folderFiles(dirname(dir))) inputs.push([basename(f), bytesOf(f)]);
  if (!inputs.some(([name]) => name === mainName)) inputs.push([mainName, stripped]);
  return {
    path,
    rel: relative(repo, path).replaceAll('\\', '/'),
    dir,
    mainName,
    stripped,
    folder,
    inputs,
    tabType: loaded.tabType === 'assembly' ? 0 : 1,
    tabSize: loaded.tabSize ?? 4,
  };
}
