// What the Files panel and the dialogs do with the stores, on top of the Vfs (ARCHITECTURE.md
// 3.8.1, 3.8.5): the locations to show, folders, recursive listing, rename, import and export.
// Plain async functions on the Vfs; tested under Node with memory backends.
//
// Owner: FS1.

import type { Bytes, DirEntry, FileSystemBackend, Vfs, VPath } from '../../contracts';
import {
  basename,
  childPath,
  dirname,
  foldCase,
  isVPath,
  isWithin,
  joinVPath,
  matchName,
  splitVPath,
} from '../../core/paths/winpath';
import { placeShort } from '../../core/places/display';
import { looksLikeZip, readZip, writeZip, type ZipInput, type ZipSkipped } from '../../fs/zip';
import { LINKED_ROOT_LABEL } from './texts';

/** The folder "From this computer..." and dropped files are copied into (3.8.1). */
export const IMPORTED_DIR: VPath = '/browser/Imported';
export const BROWSER_ROOT: VPath = '/browser';

export interface Location {
  root: VPath;
  label: string;
  backend: FileSystemBackend;
}

/**
 * The stores the dialogs and the Files panel show, in mount order: the browser store, an opened
 * folder, the desktop app's disk. Linked files (/linked) are copies the port manages for itself,
 * and memory backends serve tests, except the stand-in at /browser.
 *
 * With `{ linked: true }` (the Files panel, ARCHITECTURE-PLUS P3.2.5) the linked files' store comes
 * last as the root "Opened from this computer"; the file dialogs keep today's list (errata N5.md).
 */
export function locations(vfs: Vfs, options: { linked?: boolean } = {}): Location[] {
  const out: Location[] = vfs
    .backends()
    .filter((b) => b.mount !== 'linked' && (b.kind !== 'memory' || b.mount === 'browser'))
    .sort((a, b) => (a.mount === 'browser' ? -1 : b.mount === 'browser' ? 1 : 0))
    .map((backend) => ({ root: `/${backend.mount}`, label: backend.label, backend }));
  if (options.linked) {
    const linked = vfs.backends().find((b) => b.mount === 'linked');
    if (linked) out.push({ root: '/linked', label: LINKED_ROOT_LABEL, backend: linked });
  }
  return out;
}

/** The location a path lies in, or undefined. */
export function locationOf(vfs: Vfs, path: VPath): Location | undefined {
  if (!isVPath(path)) return undefined;
  const { mount } = splitVPath(path);
  return locations(vfs).find((location) => location.backend.mount === mount);
}

/**
 * "My Programs/demo/prog.X68": a path as the user reads it, the short place text of
 * ARCHITECTURE-PLUS P4.5 (`placeShort`): a linked file is "lab1.X68 (on this computer)", and the
 * store's internal path `/linked/<id>/` is never shown (gate I2 review; errata FS1.md entry 22).
 */
export function displayPath(vfs: Vfs, path: VPath): string {
  if (!isVPath(path)) return path;
  return placeShort(
    vfs.backends().map(({ mount, label, kind }) => ({ mount, label, kind })),
    path,
  );
}

/** The first of `candidates` that is an existing folder; else the browser store; else the first location. */
export async function chooseStartDir(
  vfs: Vfs,
  candidates: readonly (VPath | null | undefined)[],
): Promise<VPath | null> {
  for (const candidate of candidates) {
    if (!candidate || !isVPath(candidate) || !locationOf(vfs, candidate)) continue;
    try {
      if ((await vfs.stat(candidate))?.kind === 'dir') return candidate;
    } catch {
      // not reachable
    }
  }
  return locations(vfs)[0]?.root ?? null;
}

/**
 * Creates a folder and its parents (Vfs.mkdirp, added at gate I1 for FS1's Contract C1: it runs in
 * the queue of its path and is reported to the Vfs subscribers as a 'write' of the folder).
 */
export async function makeFolder(vfs: Vfs, path: VPath): Promise<void> {
  await vfs.mkdirp(path);
}

/** Folders first, then files; each without regard to letter case (as Explorer sorts). */
export function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    const x = a.name.toLocaleLowerCase();
    const y = b.name.toLocaleLowerCase();
    return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

export interface TreeItem {
  /** Path relative to the listed folder, '/' separators. */
  rel: string;
  kind: 'file' | 'dir';
}

/** Everything below a folder, parents before children. */
export async function listTree(vfs: Vfs, dir: VPath): Promise<TreeItem[]> {
  const out: TreeItem[] = [];
  const walk = async (path: VPath, prefix: string) => {
    for (const entry of sortEntries(await vfs.list(path))) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      out.push({ rel, kind: entry.kind });
      if (entry.kind === 'dir') await walk(childPath(path, entry.name), rel);
    }
  };
  await walk(dir, '');
  return out;
}

/**
 * The path as the store already spells it. Names are matched without regard to letter case, as on
 * Windows, so that the port never makes two entries whose names differ only in case (a .zip of
 * them could not be unpacked on Windows, and a program's file lookup would find either). Every
 * part of `path` that exists is replaced by its stored spelling (the exact one if there is one);
 * the parts below the first missing one keep the given spelling.
 */
export async function storedSpelling(vfs: Vfs, path: VPath): Promise<VPath> {
  const { mount, rel } = splitVPath(path);
  const segments = rel === '' ? [] : rel.split('/');
  let current = joinVPath(mount, '');
  let i = 0;
  for (; i < segments.length; i++) {
    let entries: DirEntry[];
    try {
      entries = await vfs.list(current);
    } catch {
      break; // not a folder, or not there
    }
    const isLast = i === segments.length - 1;
    const match = matchName(
      entries.filter((entry) => isLast || entry.kind === 'dir').map((entry) => entry.name),
      segments[i] as string,
    );
    if (match === null) break;
    current = childPath(current, match);
  }
  return i < segments.length ? childPath(current, ...segments.slice(i)) : current;
}

/** True if something exists at the path. */
export async function exists(vfs: Vfs, path: VPath): Promise<boolean> {
  try {
    return (await vfs.stat(path)) !== null;
  } catch {
    return false;
  }
}

/**
 * Renames (moves within its folder) a file or a folder. The Vfs has no rename, so the bytes are
 * copied first and the old name removed only when every copy has been written: a failure leaves
 * the original in place.
 */
export async function renameEntry(vfs: Vfs, from: VPath, newName: string): Promise<VPath> {
  const parent = dirname(from);
  const to = childPath(parent, newName);
  if (to === from) return to;
  // Names are compared without regard to letter case (storedSpelling): an entry whose name differs
  // from the new one only in case is "already there", unless it is the entry being renamed.
  // The comparison ignores case too: below a folder that may not be listed (the desktop app's
  // granted roots, 7.6) resolve keeps the spelling as given, so the entry being renamed comes back
  // as `to`, not as `from` (docs/requests/W1-case-only-rename.md; errata FS1.md entry 25).
  const existing = await vfs.resolve(parent, newName);
  const sameEntry = existing !== null && foldCase(existing) === foldCase(from);
  if (existing !== null && !sameEntry) throw new Error(`"${newName}" already exists.`);
  const caseOnly = sameEntry;
  // A case-only rename goes through a temporary name beside the entry. Where that folder may not be
  // used (above a granted root) the store refuses it: find that out before anything is moved.
  if (caseOnly) await vfs.list(parent);
  const stat = await vfs.stat(from);
  if (!stat) throw new Error(`"${basename(from)}" no longer exists.`);
  if (stat.kind === 'file') {
    const data = await vfs.readFile(from);
    if (caseOnly) {
      // A change of letter case only: through a temporary name, so that the store never holds
      // both spellings and a store that ignores case (a disk) does not lose the file.
      const temp = childPath(parent, `${newName}.renaming-${Date.now()}`);
      await vfs.writeFile(temp, data);
      await vfs.remove(from);
      await vfs.writeFile(to, data);
      await vfs.remove(temp);
    } else {
      await vfs.writeFile(to, data);
      await vfs.remove(from);
    }
    return to;
  }
  if (isWithin(to, from)) throw new Error('A folder cannot be moved into itself.');
  const items = await listTree(vfs, from);
  const staging = caseOnly ? childPath(parent, `${newName}.renaming-${Date.now()}`) : to;
  await makeFolder(vfs, staging);
  for (const item of items) {
    const source = childPath(from, ...item.rel.split('/'));
    const dest = childPath(staging, ...item.rel.split('/'));
    if (item.kind === 'dir') await makeFolder(vfs, dest);
    else await vfs.writeFile(dest, await vfs.readFile(source));
  }
  await vfs.remove(from);
  if (staging !== to) return renameEntry(vfs, staging, newName);
  return to;
}

/**
 * renameEntry, refused first when the folder holds another entry whose name equals `newName` but
 * for letter case: a store that keeps case apart (a Linux disk, a memory store) can hold `r.X68`
 * beside `R.X68`, and renameEntry's case-only path would write over that other file (it takes the
 * exact match that resolve finds for the entry being renamed). The Files panel's Rename and Undo
 * Rename go through here; renameEntry itself is not changed (P5 N5).
 */
export async function renameChecked(vfs: Vfs, from: VPath, newName: string): Promise<VPath> {
  const own = basename(from);
  const entries = await vfs.list(dirname(from)).catch(() => null);
  if (entries?.some((entry) => entry.name !== own && foldCase(entry.name) === foldCase(newName))) {
    throw new Error(`"${newName}" already exists.`);
  }
  return renameEntry(vfs, from, newName);
}

// ---- import ----------------------------------------------------------------------------------------

/** One thing to import: a file (read() gives its bytes) or a folder (rel ends in '/'). */
export interface ImportItem {
  /** Path below the import folder, '/' separators; a folder ends in '/'. */
  rel: string;
  read(): Promise<Bytes>;
  /** The size in bytes when it is known before reading (a File; a .zip entry), for the question
   *  before a large import (ARCHITECTURE-PLUS P3.2.6). */
  size?: number;
}

/** Called before an import writes over an existing file (ARCHITECTURE-PLUS P3.2.4, P3.3.4: the
 *  import keeps the current bytes as `before-import`, without waiting for the history). */
export type BeforeReplace = (path: VPath) => Promise<void>;

export interface ImportPlan {
  dir: VPath;
  items: ImportItem[];
  /** Items whose file already exists (folders never conflict). */
  conflicts: ImportItem[];
  /** Names that cannot be imported (they leave the folder or are not valid names). */
  refused: string[];
}

export interface ImportResult {
  written: VPath[];
  skipped: { rel: string; reason: string }[];
}

function targetOf(dir: VPath, rel: string): VPath | null {
  const segments = rel.split('/').filter((s) => s !== '');
  if (segments.length === 0) return null;
  try {
    return childPath(dir, ...segments);
  } catch {
    return null;
  }
}

/**
 * Which items would replace a file: one that exists already, or one an earlier item of the same
 * batch writes. Names are compared without regard to letter case (storedSpelling), so a .zip made
 * on Linux or macOS that holds both 'A.X68' and 'a.x68' asks the replace question for the second.
 */
export async function planImport(vfs: Vfs, dir: VPath, items: readonly ImportItem[]): Promise<ImportPlan> {
  const plan: ImportPlan = { dir, items: [], conflicts: [], refused: [] };
  const earlier = new Set<string>(); // folded targets of the files planned so far
  for (const item of items) {
    const target = targetOf(dir, item.rel);
    if (target === null) {
      plan.refused.push(item.rel);
      continue;
    }
    plan.items.push(item);
    if (!item.rel.endsWith('/')) {
      const folded = foldCase(target);
      // An existing file whose name differs only in letter case is the same file (storedSpelling).
      const clash =
        earlier.has(folded) || (await vfs.stat(await storedSpelling(vfs, target)).catch(() => null)) !== null;
      if (clash) plan.conflicts.push(item);
      earlier.add(folded);
    }
  }
  return plan;
}

/**
 * Writes the items of a plan. `replace` decides for each conflicting item; items that cannot be
 * read are skipped and listed.
 */
export async function runImport(
  vfs: Vfs,
  plan: ImportPlan,
  replace: (item: ImportItem) => boolean,
  beforeReplace?: BeforeReplace,
): Promise<ImportResult> {
  const result: ImportResult = { written: [], skipped: [] };
  const conflicts = new Set(plan.conflicts);
  const written = new Set<string>(); // folded paths this run has written
  for (const item of plan.items) {
    try {
      // Resolved now, not when planned: an earlier item may have made a folder in another spelling.
      const target = await storedSpelling(vfs, targetOf(plan.dir, item.rel) as VPath);
      if (item.rel.endsWith('/')) {
        await makeFolder(vfs, target);
        continue;
      }
      // A file an earlier item of this run wrote is a conflict too, whatever the plan said.
      const conflict = conflicts.has(item) || written.has(foldCase(target));
      if (conflict && !replace(item)) {
        result.skipped.push({ rel: item.rel, reason: 'exists' });
        continue;
      }
      const stat = await vfs.stat(target).catch(() => null);
      if (stat?.kind === 'dir') {
        result.skipped.push({ rel: item.rel, reason: 'a folder has this name' });
        continue;
      }
      const data = await item.read();
      if (stat?.kind === 'file' && beforeReplace) await beforeReplace(target).catch(() => {});
      await vfs.writeFile(target, data);
      result.written.push(target);
      written.add(foldCase(target));
    } catch (error) {
      result.skipped.push({ rel: item.rel, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** The entries of a .zip as import items. */
export async function itemsFromZip(bytes: Bytes): Promise<{ items: ImportItem[]; skipped: ZipSkipped[] }> {
  const { entries, skipped } = await readZip(bytes);
  return {
    items: entries.map((entry) => ({ rel: entry.path, read: async () => entry.data, size: entry.data.length })),
    skipped,
  };
}

/** True if a file should be unpacked instead of copied (Import... of a .zip). */
export function isZipName(name: string, bytes?: Bytes): boolean {
  return /\.zip$/i.test(name) && (bytes === undefined || looksLikeZip(bytes));
}

/**
 * Copies one file into a folder for opening (From this computer..., a dropped file). An existing
 * file with the same bytes is reused; one with other bytes is replaced only if `replace` says so,
 * otherwise the existing file is kept and its path returned. Before it replaces a file with other
 * bytes, `keep` receives the current bytes (ARCHITECTURE-PLUS P3.2.4: such a copy is an import and
 * keeps a `Before import` version; `keep` must not wait for the history).
 */
export async function importOne(
  vfs: Vfs,
  dir: VPath,
  name: string,
  data: Bytes,
  replace: (path: VPath) => Promise<boolean>,
  keep?: (path: VPath, current: Bytes) => void,
): Promise<VPath> {
  const target = await storedSpelling(vfs, childPath(dir, name));
  const stat = await vfs.stat(target).catch(() => null);
  if (stat !== null) {
    const existing = target;
    if (stat.kind === 'file') {
      const old = await vfs.readFile(existing);
      const same = old.length === data.length && old.every((b, i) => b === data[i]);
      if (same) return existing;
      if (!(await replace(existing))) return existing;
      try {
        keep?.(existing, old);
      } catch {
        // the history never makes an import fail (P3.3.1 property 3)
      }
      await vfs.writeFile(existing, data);
      return existing;
    }
  }
  await vfs.writeFile(target, data);
  return target;
}

// ---- export ----------------------------------------------------------------------------------------

export interface ExportFile {
  /** The download's file name. */
  name: string;
  bytes: Bytes;
  /** 'file': the file itself; 'zip': a folder or the whole store. */
  kind: 'file' | 'zip';
  files: number;
}

/**
 * What Export... downloads for a path (3.8.1): a file as itself; a folder as "<folder>.zip" that
 * holds the folder; a store's root as "<label>.zip" holding everything at the top level, so that
 * importing it into an empty store gives the same store.
 */
export async function buildExport(vfs: Vfs, path: VPath, now: number): Promise<ExportFile> {
  const stat = await vfs.stat(path);
  if (!stat) throw new Error(`"${basename(path)}" no longer exists.`);
  const { mount, rel } = splitVPath(path);
  if (stat.kind === 'file') {
    return { name: basename(path), bytes: await vfs.readFile(path), kind: 'file', files: 1 };
  }
  const isRoot = rel === '';
  const prefix = isRoot ? '' : `${basename(path)}/`;
  const inputs: ZipInput[] = [];
  if (!isRoot) inputs.push({ path: prefix, mtime: stat.mtime || now });
  let files = 0;
  // Folders named .git (any letter case) and everything below them are left out of every export
  // (ARCHITECTURE-PLUS P3.2.3).
  const isGit = (segment: string) => foldCase(segment) === foldCase('.git');
  const tree = (await listTree(vfs, path)).filter(
    (item) =>
      !item.rel.split('/').some((segment, i, all) => isGit(segment) && (i < all.length - 1 || item.kind === 'dir')),
  );
  for (const item of tree) {
    const source = childPath(path, ...item.rel.split('/'));
    if (item.kind === 'dir') {
      const dirStat = await vfs.stat(source);
      inputs.push({ path: `${prefix}${item.rel}/`, mtime: dirStat?.mtime || now });
    } else {
      const fileStat = await vfs.stat(source);
      inputs.push({ path: `${prefix}${item.rel}`, data: await vfs.readFile(source), mtime: fileStat?.mtime || now });
      files++;
    }
  }
  const label = locations(vfs).find((l) => l.backend.mount === mount)?.label ?? mount;
  return { name: `${isRoot ? label : basename(path)}.zip`, bytes: writeZip(inputs), kind: 'zip', files };
}

/** The VPath of the store root a path's mount has (for "the whole store"). */
export function rootOf(path: VPath): VPath {
  return joinVPath(splitVPath(path).mount, '');
}
