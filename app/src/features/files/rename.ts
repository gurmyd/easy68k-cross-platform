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
//   and the old name removed last;
// - a file that is gone when its old name is to be removed was moved or deleted by someone else
//   (another window, a program): its copy under the new name is removed again, so that the rename
//   never brings back a file that was moved or deleted (errata N5 entry 18).
//
// Plain functions on the Vfs; tested under Node (rename.test.ts). Owner: N5.

import type { Vfs, VPath } from '../../contracts';
import { basename, childPath, dirname, foldCase, splitVPath } from '../../core/paths/winpath';
import { removeEmptyFolders } from './bulk';
import { findGitHolder, innerName } from './git-guard';
import { removeSource, takeBackCopyOfGone, unchangedSince, writtenAs, type SourceSeen } from './move';
import { listTree, makeFolder, renameEntry } from './store';
import { alreadyExists, changedWhileRenaming, gitNameRefused, gitRefusal, noLongerExists } from './texts';

export interface RenameOptions {
  /**
   * Called when files of a renamed folder changed in the moment between the last check and their
   * removal: they stay under the old name (`kept`), and `copies` (the folder under its new name)
   * holds them as they were before the change. The rename itself is made.
   */
  kept?: (kept: readonly VPath[], copies: VPath) => void;
  /**
   * Called when files of a renamed folder were gone in the moment between the last check and their
   * removal (another window moved or deleted them, or a program did): their copies under the new
   * name were removed again (`gone`, the old paths), so that a moved file does not come back and a
   * deleted one does not stay. `copies` is the folder under its new name. The rename itself is made.
   */
  gone?: (gone: readonly VPath[], copies: VPath) => void;
}

/** One file copied to its new name: what was read from the source, and what was written. */
interface Copied {
  source: VPath;
  dest: VPath;
  seen: SourceSeen;
  /** The copy as written; undefined when it could not be read back (it is then never removed). */
  written: SourceSeen | undefined;
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
    written: await writtenAs(vfs, dest, data),
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

/**
 * The folders of the copy that only held files that were gone (a subfolder moved out or deleted
 * whole): each goes when it is empty and its counterpart under the old name no longer exists (asked
 * before the old name's empty folders are removed). A folder whose files alone went stays, empty, as
 * it stays under the old name. The renamed folder itself stays.
 */
async function dropGoneFolders(vfs: Vfs, from: VPath, staging: VPath, gone: readonly VPath[]): Promise<void> {
  const rels = new Set<string>();
  for (const source of gone) {
    const rel = source
      .slice(from.length + 1)
      .split('/')
      .slice(0, -1);
    for (let n = rel.length; n > 0; n--) rels.add(rel.slice(0, n).join('/'));
  }
  // Deepest first, so that a parent is empty when its turn comes.
  for (const rel of [...rels].sort((a, b) => b.split('/').length - a.split('/').length)) {
    const parts = rel.split('/');
    if ((await vfs.stat(childPath(from, ...parts)).catch(() => null)) !== null) continue;
    const copy = childPath(staging, ...parts);
    const entries = await vfs.list(copy).catch(() => null);
    if (entries !== null && entries.length === 0) await vfs.remove(copy).catch(() => {});
  }
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
  // the check above keeps that file under the old name), then its empty folders. A file that is
  // gone by then was moved or deleted by someone else (another window, a program): its copy goes
  // too, while it is still the copy written, so that the rename brings back nothing that was moved
  // or deleted (errata N5 entry 18). A file replaced by another of the same name is a change: it
  // stays, and the copy holds the one that was there before.
  const kept: VPath[] = [];
  const gone: VPath[] = [];
  for (const file of copied) {
    // A source that goes in the moment between the check and its removal (the remove finds nothing)
    // is a source that is gone, as one found gone by the check: its copy is taken back and the
    // rename goes on with the other files (errata N5 entry 18).
    if ((await unchangedSince(vfs, file.source, file.seen)) && (await removeSource(vfs, file.source)) === 'removed') {
      continue;
    }
    const outcome = await takeBackCopyOfGone(vfs, file.source, file.dest, file.written);
    if (outcome === 'taken-back') gone.push(file.source);
    else if (outcome === 'there') kept.push(file.source);
  }
  if (kind === 'dir') {
    // Before the old folders go: a folder that is no longer there was moved or deleted whole.
    await dropGoneFolders(vfs, from, staging, gone);
    await removeEmptyFolders(vfs, from);
  }
  if (kind === 'file' && gone.length > 0) {
    // The file itself went while it was being renamed: nothing is renamed, nothing is left.
    throw new Error(changedWhileRenaming(own, own, false));
  }
  if (gone.length > 0) options.gone?.(gone, staging);
  if (kept.length > 0) {
    // The old folder still holds those files: a change of letter case cannot be finished (the two
    // spellings are one name), so the folder keeps its temporary name, which the message gives.
    options.kept?.(kept, staging);
    return staging;
  }
  return staging === to ? to : renameEntry(vfs, staging, newName);
}
