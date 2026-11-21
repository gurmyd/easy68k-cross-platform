// Which files the assembler gets (ARCHITECTURE.md 3.8.3; assembler §3.4.1).
//
// The assembler engine reads INCLUDE and INCBIN files from the map it is given, never from storage.
// This module builds that map for one document:
//
//   - The file tree is the document's mount: `mainName` is the document's path inside its mount
//     (`demo/prog.X68` for `/browser/demo/prog.X68`) and every key is a path in the same mount, so
//     that `..` in an INCLUDE name works as far as the mount reaches. The engine resolves names
//     against the folder of `mainName` without regard to letter case, with `\` and `/` alike.
//   - The entry of `mainName` is the editor buffer (encodeForAssembler of the document's text), not
//     the stored file. Every other entry is a file as stored.
//   - The main text and, transitively, every text file found are scanned for INCLUDE and INCBIN
//     lines (scanIncludeNames). Each name, as Win32 reads it (win32Name: trailing dots and spaces
//     dropped, as the engine's file layer does), is resolved with Vfs.resolve against the program
//     directory (the folder of the main source: the original resolves nested includes against the
//     current directory as well) and the files found are added.
//   - When the assembler still reports `ERROR: Unable to access specified file`, the whole program
//     directory is added (Vfs.snapshot) and the program is assembled once more; the second result
//     is the result (assembleCollected). That covers names built by macros.
//
// Names with a drive letter or a leading `\` or `/` are not resolved (Vfs.resolve refuses them);
// the assembler then reports `Unable to access specified file`, which is what the original reports
// for a path that does not exist.
//
// Owner: E5. No DOM: runs under Node.

import {
  DEFAULT_SNAPSHOT_LIMITS,
  type AsmEngine,
  type AsmOptions,
  type AsmResult,
  type Bytes,
  type VPath,
  type Vfs,
} from '../../contracts';
import { decode } from '../../core/codec/cp1252';
import { dirname, foldCase, joinVPath, splitVPath } from '../../core/paths/winpath';

/** The message of a file the assembler could not open (assembler §4.3, FILE_ERROR). */
export const FILE_ERROR_TEXT = 'ERROR: Unable to access specified file';

export interface IncludeName {
  directive: 'INCLUDE' | 'INCBIN';
  /** The name as the assembler reads it (assembler §3.4.1). */
  name: string;
}

/**
 * The operand of an INCLUDE or INCBIN line as DIRECTIV.CPP:668-691 reads it (assembler §3.4.1):
 * leading white space skipped; a name in quotes runs to the matching quote (single quotes keep
 * the case, double quotes upper-case it); an unquoted name runs to the first SPACE (a tab does not
 * end it) and is upper-cased, then trailing white space is trimmed. null = no operand.
 */
export function operandName(operand: string): string | null {
  const rest = operand.replace(/^[ \t]+/, '');
  if (rest === '') return null;
  const quote = rest[0];
  if (quote === "'" || quote === '"') {
    const end = rest.indexOf(quote, 1);
    const name = end < 0 ? rest.slice(1) : rest.slice(1, end);
    return quote === "'" ? name : name.toUpperCase();
  }
  const space = rest.indexOf(' ');
  const name = (space < 0 ? rest : rest.slice(0, space)).replace(/[ \t\r\n]+$/, '');
  return name === '' ? null : name.toUpperCase();
}

const DIRECTIVE = /^(INCLUDE|INCBIN)$/i;

/**
 * The INCLUDE and INCBIN names of a source text, in order. The scan is deliberately loose (3.8.3):
 * any line whose mnemonic field is one of the two words, in any letter case, counts, also inside
 * a block that conditional assembly skips. A file found too many costs nothing; one missing is
 * found by the snapshot retry. Comment lines (`*` or `;` first) are skipped.
 */
export function scanIncludeNames(text: string): IncludeName[] {
  const found: IncludeName[] = [];
  // Text mode (assembler §9.4.1): Ctrl-Z ends the file.
  const end = text.indexOf('\x1a');
  const body = end < 0 ? text : text.slice(0, end);
  for (const line of body.split(/\r\n|\n|\r/)) {
    const first = line[0];
    if (first === undefined || first === '*' || first === ';') continue;
    // Fields: an optional label from column 1, then white space and the mnemonic (assembler §3.1.1).
    // Loosely: the first or the second token may be the mnemonic.
    const match = /^([^ \t]*)[ \t]+([^ \t]+)(.*)$/.exec(line);
    const candidates: [string, string][] = [];
    if (match) {
      const [, label = '', mnemonic = '', after = ''] = match;
      if (label === '') {
        candidates.push([mnemonic, after]);
      } else {
        candidates.push([mnemonic, after]);
        // `INCLUDE name` written from column 1 (no label): the original takes it as a label, the
        // loose scan takes the file anyway.
        candidates.push([label, line.slice(label.length)]);
      }
    }
    for (const [word, operand] of candidates) {
      const directive = DIRECTIVE.exec(word.replace(/:$/, ''));
      if (!directive) continue;
      const name = operandName(operand);
      if (name !== null)
        found.push({ directive: (directive[1] as string).toUpperCase() as IncludeName['directive'], name });
      break;
    }
  }
  return found;
}

/**
 * The name as Win32 opens it, and as the engine's file layer resolves it (engine/asm/shim/ez_file.cpp,
 * ezCanonicalPath): trailing dots and spaces of every component are dropped, and a component left
 * empty disappears; `.` and `..` are kept for Vfs.resolve, which applies them lexically (so `q\..`
 * cancels out whether or not q exists). `lib.x68.` and `Lib. \four.x68` name `lib.x68` and
 * `Lib\four.x68`. Separators become `\`.
 */
export function win32Name(name: string): string {
  const parts: string[] = [];
  for (const part of name.split(/[\\/]/)) {
    if (part === '.' || part === '..') {
      parts.push(part);
      continue;
    }
    const trimmed = part.replace(/[. ]+$/, '');
    if (trimmed !== '') parts.push(trimmed);
  }
  // A leading separator (a rooted name) is kept, so that Vfs.resolve refuses it as before.
  return (/^[\\/]/.test(name) ? '\\' : '') + parts.join('\\');
}

/** The tree an assembly sees: the document's mount, its program directory and its main name. */
export interface AssemblyTree {
  mount: string;
  /** The folder of the main source (the original's current directory). */
  programDir: VPath;
  /** The main source's path inside the mount. */
  mainName: string;
}

export function assemblyTree(mainPath: VPath): AssemblyTree {
  const { mount, rel } = splitVPath(mainPath);
  return { mount, programDir: dirname(mainPath), mainName: rel };
}

/** The key of `files` for a path of the tree's mount. */
function keyOf(tree: AssemblyTree, path: VPath): string | null {
  const { mount, rel } = splitVPath(path);
  return mount === tree.mount && rel !== '' ? rel : null;
}

/** The VPath of a key of `files` (AsmMessage.resolvedFile). */
export function pathOfKey(tree: AssemblyTree, key: string): VPath {
  return joinVPath(tree.mount, key.split('\\').join('/'));
}

export interface CollectedFiles extends AssemblyTree {
  files: Map<string, Bytes>;
  /** The INCLUDE files that were found, in the order they were first named. */
  includes: VPath[];
  /** True once the whole program directory has been added. */
  snapshot: boolean;
}

export type CollectVfs = Pick<Vfs, 'resolve' | 'readFile' | 'snapshot'>;

/**
 * Steps 1 and 2 of 3.8.3: the editor buffer under `mainName`, and every INCLUDE and INCBIN file
 * that the main text and the text files it includes name, transitively.
 */
export async function collectFiles(vfs: CollectVfs, mainPath: VPath, buffer: Bytes): Promise<CollectedFiles> {
  const tree = assemblyTree(mainPath);
  const files = new Map<string, Bytes>([[tree.mainName, buffer]]);
  const includes: VPath[] = [];
  const scanned = new Set<string>([foldCase(mainPath)]);
  const queue: string[] = [decode(buffer)];
  while (queue.length > 0) {
    const text = queue.shift() as string;
    for (const { directive, name } of scanIncludeNames(text)) {
      const path = await vfs.resolve(tree.programDir, win32Name(name)).catch(() => null);
      if (path === null) continue;
      const key = keyOf(tree, path);
      if (key === null) continue;
      const folded = foldCase(path);
      const isMain = folded === foldCase(mainPath);
      if (directive === 'INCLUDE' && !isMain && !includes.some((p) => foldCase(p) === folded)) includes.push(path);
      if (files.has(key) && (directive === 'INCBIN' || scanned.has(folded))) continue;
      let data: Bytes;
      try {
        data = await vfs.readFile(path);
      } catch {
        continue; // a folder, or unreadable: the assembler reports what the original reports
      }
      if (!files.has(key)) files.set(key, data);
      if (directive === 'INCLUDE' && !scanned.has(folded)) {
        scanned.add(folded);
        queue.push(decode(data));
      }
    }
  }
  return { ...tree, files, includes, snapshot: false };
}

/** Step 3 of 3.8.3: adds every file of the program directory that is not in the map yet. */
export async function addProgramDirectory(vfs: CollectVfs, collected: CollectedFiles): Promise<void> {
  collected.snapshot = true;
  let snapshot;
  try {
    snapshot = await vfs.snapshot(collected.programDir, DEFAULT_SNAPSHOT_LIMITS);
  } catch {
    return;
  }
  const prefix = splitVPath(collected.programDir).rel;
  for (const [rel, { data }] of snapshot.files) {
    const key = prefix === '' ? rel : `${prefix}/${rel}`;
    if (!collected.files.has(key)) collected.files.set(key, data);
  }
}

/** True when the result reports a file the assembler could not open. */
export function reportsMissingFile(result: AsmResult): boolean {
  return result.messages.some((message) => message.text === FILE_ERROR_TEXT);
}

/**
 * Collects the files, assembles, and assembles once more with the whole program directory when the
 * first result reports `Unable to access specified file` (3.8.3 step 3).
 */
export async function assembleCollected(
  asm: AsmEngine,
  vfs: CollectVfs,
  mainPath: VPath,
  buffer: Bytes,
  options: AsmOptions,
  timestamp: Date,
): Promise<{ result: AsmResult; collected: CollectedFiles }> {
  const collected = await collectFiles(vfs, mainPath, buffer);
  let result = await asm.assemble(collected.mainName, collected.files, options, timestamp);
  if (result.fatal === null && reportsMissingFile(result) && !collected.snapshot) {
    const before = collected.files.size;
    await addProgramDirectory(vfs, collected);
    if (collected.files.size > before) {
      result = await asm.assemble(collected.mainName, collected.files, options, timestamp);
    }
  }
  return { result, collected };
}
