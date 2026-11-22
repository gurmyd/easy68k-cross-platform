// Rename and Undo Rename of the Files panel (ARCHITECTURE-PLUS P3.2.4, P3.2.7), with the checks of
// the stage around FS1's renameEntry (store.ts), which is not changed (P5 N5):
//
// - nothing is renamed to .git, in any letter case (P1.1 rule 2; errata N5 entry 15);
// - a folder that holds another entry whose name equals the new one but for letter case is refused
//   (a store that keeps case apart; errata N5 entry 14);
// - a folder that holds .git is refused (P3.2.4), also for Undo Rename;
// - the old name is removed only while every file below it is still the one that was copied: a save
//   from another window, or a program's write, that lands during the copy is never taken away from
//   the current file (P3.3.1 property 1; errata N5 entry 18). renameEntry copies, then removes the
//   whole folder, so this module makes the copy itself and keeps renameEntry's order and names: the
//   copy first, a change of letter case through `<name>.renaming-<time>` (P1.1 rule 2's exception),
//   and the old name removed last.
//
// Plain functions on the Vfs; tested under Node (rename.test.ts). Owner: N5.

import type { Vfs, VPath } from '../../contracts';
import { basename, childPath, dirname, foldCase, splitVPath } from '../../core/paths/winpath';
import { removeEmptyFolders } from './bulk';
import { findGitHolder, innerName } from './git-guard';
import { unchangedSince, type SourceSeen } from './move';
import { listTree, makeFolder, renameEntry } from './store';
import { alreadyExists, changedWhileRenaming, gitNameRefused, gitRefusal, noLongerExists } from './texts';

export interface RenameOptions {
  /**
   * Called when files of a renamed folder changed in the moment between the last check and their
   * removal: they stay under the old name (`kept`), and `copies` (the folder under its new name)
   * holds them as they were before the change. The rename itself is made.
   */
  kept?: (kept: readonly VPath[], copies: VPath) => void;
}

/** One file copied to its new name: what was read from the source, and what was written. */
interface Copied {
  source: VPath;
  dest: VPath;
  seen: SourceSeen;
  /** The copy as written; undefined when it could not be read back (it is then never removed). */
  written: SourceSeen | undefined;
}

async function seenOf(vfs: Vfs, path: VPath, data: Uint8Array): Promise<SourceSeen | undefined> {
  const stat = await vfs.stat(path).catch(() => null);
  return stat?.kind === 'file' ? { mtime: stat.mtime, size: stat.size, data } : undefined;
}

async function copyFile(vfs: Vfs, source: VPath, dest: VPath): Promise<Copied> {
  // The time is taken before the bytes: a write in between gives a time that no longer matches, so
  // the file counts as changed (never the other way round).
  const before = await vfs.stat(source);
  if (before?.kind !== 'file') throw new Error(noLongerExists(basename(source)));
  const data = await vfs.readFile(source);
  await vfs.writeFile(dest, data);
  return {
    source,
    dest,
    seen: { mtime: before.mtime, size: before.size, data },
    written: await seenOf(vfs, dest, data),
  };
}

/**
 * Copies a file, or a folder with everything below it, to `dest`; parents before children. Each
 * file is added to `copied` as soon as it is written, so that a failure half way knows the copies
 * made so far.
 */
async function copyItem(vfs: Vfs, from: VPath, dest: VPath, kind: 'file' | 'dir', copied: Copied[]): Promise<void> {
  if (kind === 'file') {
    copied.push(await copyFile(vfs, from, dest));
    return;
  }
  await makeFolder(vfs, dest);
  for (const item of await listTree(vfs, from)) {
    const source = childPath(from, ...item.rel.split('/'));
    const target = childPath(dest, ...item.rel.split('/'));
    if (item.kind === 'dir') await makeFolder(vfs, target);
    else copied.push(await copyFile(vfs, source, target));
  }
}

/** The first file below `from` that is not the one copied (changed, gone, or new), or null. */
async function firstChange(
  vfs: Vfs,
  from: VPath,
  kind: 'file' | 'dir',
  copied: readonly Copied[],
): Promise<VPath | null> {
  for (const file of copied) {
    if (!(await unchangedSince(vfs, file.source, file.seen))) return file.source;
  }
  if (kind === 'dir') {
    const known = new Set(copied.map((file) => file.source));
    for (const item of await listTree(vfs, from).catch(() => [])) {
      const path = childPath(from, ...item.rel.split('/'));
      if (item.kind === 'file' && !known.has(path)) return path;
    }
  }
  return null;
}

/** Removes the copies again (each only while it is still the copy written), then their empty folders. */
async function takeBack(vfs: Vfs, dest: VPath, kind: 'file' | 'dir', copied: readonly Copied[]): Promise<void> {
  for (const file of copied) {
    if (await unchangedSince(vfs, file.dest, file.written)) await vfs.remove(file.dest).catch(() => {});
  }
  if (kind === 'dir') await removeEmptyFolders(vfs, dest).catch(() => []);
}

/** `changed` as a path below the folder that holds the renamed item ("lab/prog.X68"). */
function shownPath(parent: VPath, changed: VPath): string {
  const rel = splitVPath(changed).rel;
  const base = splitVPath(parent).rel;
  return base === '' ? rel : rel.startsWith(`${base}/`) ? rel.slice(base.length + 1) : basename(changed);
}

/**
 * Renames the file or folder `from` to `newName` within its folder; resolves to the new path. Throws
 * (with the text to show) when the rename is refused or not made; the store is then as it was,
 * except for a file that another window wrote meanwhile.
 */
export async function renameChecked(
  vfs: Vfs,
  from: VPath,
  newName: string,
  options: RenameOptions = {},
): Promise<VPath> {
  // Nothing of the student is renamed to .git (P1.1 rule 2): a folder of that name and its files
  // would vanish from the tree, and the history treats a path named .git as a Git one (errata N5
  // entry 15). A file too, so that the two never disagree.
  if (foldCase(newName) === foldCase('.git')) throw new Error(gitNameRefused(newName));
  const parent = dirname(from);
  const own = basename(from);
  const entries = await vfs.list(parent).catch(() => null);
  if (entries?.some((entry) => entry.name !== own && foldCase(entry.name) === foldCase(newName))) {
    throw new Error(alreadyExists(newName));
  }
  const to = childPath(parent, newName);
  if (to === from) return to;
  // renameEntry's rules: an entry whose name differs from the new one only in case is "already
  // there", unless it is the entry being renamed (compared without regard to case: errata FS1 25).
  const existing = await vfs.resolve(parent, newName);
  const caseOnly = existing !== null && foldCase(existing) === foldCase(from);
  if (existing !== null && !caseOnly) throw new Error(alreadyExists(newName));
  // A case-only rename goes through a temporary name beside the entry; where that folder may not be
  // used (above a granted root) the store refuses it before anything is written.
  if (caseOnly) await vfs.list(parent);
  const stat = await vfs.stat(from);
  if (!stat) throw new Error(noLongerExists(own));
  const kind = stat.kind === 'dir' ? 'dir' : 'file';
  // A folder that holds .git is not renamed (P3.2.4): the copy would write below .git. Rename asks
  // this first (renameRefused); Undo Rename meets it when a repository appeared there since.
  if (kind === 'dir') {
    const holder = await findGitHolder(vfs, from);
    if (holder !== null) throw new Error(gitRefusal(own, innerName(from, holder), 'rename'));
  }
  const staging = caseOnly ? childPath(parent, `${newName}.renaming-${Date.now()}`) : to;

  const copied: Copied[] = [];
  try {
    await copyItem(vfs, from, staging, kind, copied);
  } catch (error) {
    await takeBack(vfs, staging, kind, copied);
    throw error;
  }
  // Every file must still be the one copied before anything is removed; otherwise nothing is
  // renamed, and the copies go again.
  const changed = await firstChange(vfs, from, kind, copied);
  if (changed !== null) {
    await takeBack(vfs, staging, kind, copied);
    throw new Error(changedWhileRenaming(own, shownPath(parent, changed), kind === 'dir'));
  }
  // The old name goes file by file, each only while it is unchanged (a change in the moment since
  // the check above keeps that file under the old name), then its empty folders.
  const kept: VPath[] = [];
  for (const file of copied) {
    if (await unchangedSince(vfs, file.source, file.seen)) await vfs.remove(file.source);
    else kept.push(file.source);
  }
  if (kind === 'dir') await removeEmptyFolders(vfs, from);
  if (kept.length > 0) {
    // The old folder still holds those files: a change of letter case cannot be finished (the two
    // spellings are one name), so the folder keeps its temporary name, which the message gives.
    options.kept?.(kept, staging);
    return staging;
  }
  return staging === to ? to : renameEntry(vfs, staging, newName);
}
