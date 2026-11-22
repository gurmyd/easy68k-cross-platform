// Moving and copying in the Files panel (ARCHITECTURE-PLUS P3.2.4): by dragging rows onto a folder
// or with the context menu's `Move To...` (the dialog `files.moveTo`, MoveToDialog.tsx). Within a
// store a move (copy, then remove: nothing is removed until every copy is written); between stores
// a copy. Every overwrite goes through ctx.history.guard (P3.3.4); the history follows a moved file
// (ctx.history.moved) and so does its open document (DocumentService.relocate). Owner: N5.

import type { DocumentState, VPath } from '../../contracts';
import { basename, childPath, dirname, foldCase, isWithin, sameName, splitVPath } from '../../core/paths/winpath';
import {
  confirmFor,
  outermostItems,
  documentAt,
  emptyFoldersBelow,
  filesBelow,
  historyReady,
  inform,
  isLinkedPath,
  openDocumentsAt,
  removeEmptyFolders,
  showError,
  type FilesDeps,
  type TrashRef,
  type UndoEntry,
} from './bulk';
import { findGitHolder, innerName, touchesGit } from './git-guard';
import { displayPath, locations, sortEntries, storedSpelling } from './store';
import { changedWhileReplacing } from '../../core/history/texts';
import {
  COPY_TITLE,
  MOVE_TITLE,
  UNDO_ACTION,
  alreadyExists,
  gitRefusal,
  movedToast,
  openInEditor,
  replaceManyQuestion,
  replaceOneQuestion,
  unsavedReplace,
} from './texts';

export const MOVE_TO_DIALOG_ID = 'files.moveTo';

export type TransferMode = 'move' | 'copy';

/** Move within a store; copy when any item comes from another store (P3.2.4). */
export function transferModeOf(items: readonly VPath[], targetDir: VPath): TransferMode {
  const target = splitVPath(targetDir).mount;
  return items.every((item) => splitVPath(item).mount === target) ? 'move' : 'copy';
}

/**
 * The items a move or copy carries: neither a store's root nor a linked file, nor an item inside
 * another selected folder (that folder carries it: outermostItems).
 */
export function movableItems(items: readonly VPath[]): VPath[] {
  return outermostItems(items.filter((item) => !isLinkedPath(item) && splitVPath(item).rel !== ''));
}

/** An item that is in `targetDir` already: a move or copy leaves it where it is. */
function alreadyIn(item: VPath, targetDir: VPath): boolean {
  return sameName(dirname(item), targetDir);
}

/**
 * A target the items cannot go to (P3.2.4): "Opened from this computer", a folder named .git or
 * below one, a folder that is one of the items or below one, and the folder all of them are in
 * already (nothing would change).
 */
export function refusedTarget(items: readonly VPath[], targetDir: VPath): boolean {
  if (isLinkedPath(targetDir) || touchesGit(targetDir)) return true;
  const carried = movableItems(items);
  if (carried.length === 0) return true;
  if (carried.some((item) => isWithin(targetDir, item))) return true;
  return carried.every((item) => alreadyIn(item, targetDir));
}

/** The folder a drop onto a row goes into: the folder or root itself, a file's folder. */
export function dropFolderOf(row: { path: VPath; kind: 'root' | 'dir' | 'file' }): VPath {
  return row.kind === 'file' ? dirname(row.path) : row.path;
}

/** A folder the `Move To` dialog lists. */
export interface MoveTarget {
  path: VPath;
  /** The folder's name; a root's label. */
  label: string;
  /** 0 for a store's root. */
  depth: number;
  mount: string;
}

/** The folders of every store except "Opened from this computer", without refused ones (P3.2.4). */
export async function moveTargets(deps: Pick<FilesDeps, 'vfs'>, items: readonly VPath[]): Promise<MoveTarget[]> {
  const out: MoveTarget[] = [];
  const carried = movableItems(items);
  const walk = async (dir: VPath, depth: number, mount: string) => {
    for (const entry of sortEntries(await deps.vfs.list(dir).catch(() => []))) {
      if (entry.kind !== 'dir') continue;
      const path = childPath(dir, entry.name);
      if (touchesGit(path) || carried.some((item) => isWithin(path, item))) continue;
      out.push({ path, label: entry.name, depth, mount });
      await walk(path, depth + 1, mount);
    }
  };
  for (const location of locations(deps.vfs)) {
    const mount = location.backend.mount;
    out.push({ path: location.root, label: location.label, depth: 0, mount });
    await walk(location.root, 1, mount);
  }
  return out;
}

/** The name the toast gives the target ("demo"; a root: its label). */
function targetName(deps: Pick<FilesDeps, 'vfs'>, dir: VPath): string {
  return splitVPath(dir).rel === '' ? displayPath(deps.vfs, dir) : basename(dir);
}

interface PlannedFile {
  from: VPath;
  to: VPath;
  /** Path below the target folder, for the question ("demo/b.X68"). */
  rel: string;
  conflict: boolean;
  skip: boolean;
}

export interface TransferOutcome {
  mode: TransferMode;
  /** The command ran (false: refused, cancelled or nothing to do). */
  done: boolean;
  /** [from, to] of each file written at the target (and, for a move, removed from its place). */
  written: [VPath, VPath][];
  /** Items of which something was written. */
  items: VPath[];
  undo: UndoEntry | null;
  toast: string | null;
}

/**
 * Moves or copies `items` (the selection, in the tree's order) into `targetDir` with the questions
 * and refusals of P3.2.4.
 */
export async function transferItems(
  deps: FilesDeps,
  items: readonly VPath[],
  targetDir: VPath,
  forced?: TransferMode,
): Promise<TransferOutcome> {
  const { vfs, documents } = deps;
  const carried = movableItems(items);
  const mode = forced ?? transferModeOf(carried, targetDir);
  const title = mode === 'move' ? MOVE_TITLE : COPY_TITLE;
  const outcome: TransferOutcome = { mode, done: false, written: [], items: [], undo: null, toast: null };
  if (refusedTarget(carried, targetDir)) return outcome;
  if ((await vfs.stat(targetDir).catch(() => null))?.kind !== 'dir') return outcome;

  // The items, their files and empty folders, where each goes.
  const planned: PlannedFile[] = [];
  const emptyFolders: [VPath, VPath][] = [];
  const tops: { item: VPath; to: VPath }[] = [];
  // The targets this command claims, letter case ignored: a second selected item of the same name
  // (from another folder) would land on the first one's copy, so it stays where it is (erratum 13).
  const claimed = new Set<string>();
  // An item already in the target folder stays where it is: writing it "over itself" and then
  // removing the source would lose it.
  for (const item of carried.filter((path) => !alreadyIn(path, targetDir))) {
    const stat = await vfs.stat(item).catch(() => null);
    if (!stat) continue;
    if (claimed.has(foldCase(basename(item)))) {
      await showError(deps, title, new Error(alreadyExists(basename(item))));
      continue;
    }
    if (stat.kind === 'dir') {
      const holder = await findGitHolder(vfs, item);
      if (holder) {
        await inform(deps, title, gitRefusal(basename(item), innerName(item, holder), mode));
        return outcome;
      }
    }
    const to = await storedSpelling(vfs, childPath(targetDir, basename(item)));
    const there = await vfs.stat(to).catch(() => null);
    if (there && there.kind !== stat.kind) {
      await showError(deps, title, new Error(alreadyExists(basename(to))));
      continue;
    }
    if (stat.kind === 'dir' && there?.kind === 'dir') {
      // Folders never conflict: merged file by file, unless the folder there holds .git.
      const holder = await findGitHolder(vfs, to);
      if (holder) {
        await inform(deps, title, gitRefusal(basename(to), innerName(to, holder), mode));
        return outcome;
      }
    }
    tops.push({ item, to });
    claimed.add(foldCase(basename(item)));
    for (const file of await filesBelow(vfs, item)) {
      const target = await storedSpelling(vfs, `${to}${file.slice(item.length)}`);
      const exists = (await vfs.stat(target).catch(() => null)) !== null;
      planned.push({ from: file, to: target, rel: target.slice(targetDir.length + 1), conflict: exists, skip: false });
    }
    for (const folder of await emptyFoldersBelow(vfs, item)) {
      emptyFolders.push([folder, await storedSpelling(vfs, `${to}${folder.slice(item.length)}`)]);
    }
  }
  if (planned.length === 0 && emptyFolders.length === 0) return outcome;

  // Without DocumentService.relocate an open file is not moved (P3.2.4).
  if (mode === 'move' && !documents.relocate) {
    for (const { item } of tops) {
      const open = openDocumentsAt(documents, item)[0];
      if (open?.path) {
        await inform(deps, MOVE_TITLE, openInEditor(basename(open.path), 'move'));
        return outcome;
      }
    }
  }

  // Files that exist at both places: (1) an open, modified document there is skipped; (2) one
  // question for the others, counted as Import counts them.
  for (const file of planned) {
    if (!file.conflict) continue;
    const doc = documentAt(documents, file.to);
    if (doc?.modified) {
      await inform(deps, title, unsavedReplace(basename(file.to)));
      file.skip = true;
    }
  }
  const asked = planned.filter((file) => file.conflict && !file.skip);
  const ready = historyReady(deps);
  if (asked.length > 0) {
    const place = displayPath(vfs, targetDir);
    const answer = await deps.dialogs.messageBox({
      title,
      text:
        asked.length === 1
          ? replaceOneQuestion((asked[0] as PlannedFile).rel, place, ready)
          : replaceManyQuestion(asked.length, place, ready),
      icon: 'confirmation',
      buttons: ['Yes', 'No', 'Cancel'],
    });
    if (answer === 'Cancel') return outcome;
    if (answer !== 'Yes') for (const file of asked) file.skip = true;
  }

  // The folders the command creates at the target (Undo removes them again when empty).
  const created: VPath[] = [];
  const noteFolders = async (path: VPath) => {
    const chain: VPath[] = [];
    for (let dir = path; isWithin(dir, targetDir) && dir !== targetDir; dir = dirname(dir)) chain.unshift(dir);
    for (const dir of chain) {
      if (created.includes(dir)) continue;
      if ((await vfs.stat(dir).catch(() => null)) === null) created.push(dir);
    }
  };
  for (const file of planned) if (!file.skip) await noteFolders(dirname(file.to));
  for (const [, to] of emptyFolders) await noteFolders(to);

  // (3) the writes: a Replace through guard; nothing is removed until every copy is written.
  const replaced: TrashRef[] = [];
  const replacedDocs: { path: VPath; doc: DocumentState }[] = [];
  let failed = false;
  for (const file of planned) {
    if (file.skip) continue;
    let data;
    try {
      data = await vfs.readFile(file.from);
    } catch (error) {
      await showError(deps, title, error);
      file.skip = true;
      continue;
    }
    if (file.conflict && deps.history) {
      const name = basename(file.to);
      try {
        const result = await deps.history.guard(
          file.to,
          'replace',
          async (seen) => {
            for (const s of seen) {
              const now = await vfs.stat(s.path).catch(() => null);
              if (!now || now.mtime !== s.mtime || now.size !== s.size) throw new Error(changedWhileReplacing(name));
            }
            await vfs.writeFile(file.to, data);
          },
          confirmFor(deps, ready, title, 'replace', name, false),
        );
        if (result.outcome === 'declined') {
          file.skip = true;
          continue;
        }
        if (result.item) replaced.push({ id: result.item, path: file.to });
      } catch (error) {
        await showError(deps, title, error);
        file.skip = true;
        continue;
      }
    } else {
      // Nothing is written over a file without guard: one that appeared since the plan stays.
      if ((await vfs.stat(file.to).catch(() => null)) !== null) {
        await showError(deps, title, new Error(alreadyExists(basename(file.to))));
        file.skip = true;
        continue;
      }
      try {
        await vfs.writeFile(file.to, data);
      } catch (error) {
        await showError(deps, title, error);
        file.skip = true;
        failed = true;
        break;
      }
    }
    outcome.written.push([file.from, file.to]);
    const doc = file.conflict ? documentAt(documents, file.to) : undefined;
    if (doc && !doc.modified) replacedDocs.push({ path: file.to, doc });
  }
  if (!failed) {
    for (const [, to] of emptyFolders) {
      try {
        await vfs.mkdirp(to);
      } catch (error) {
        await showError(deps, title, error);
      }
    }
  }

  const written = outcome.written;
  const effective: TransferMode = failed ? 'copy' : mode; // a failed write removes nothing
  if (effective === 'move') {
    // Remove what was written at the target, then the item's folders left empty.
    const moved: [VPath, VPath][] = [];
    for (const [from, to] of written) {
      if (sameName(from, to)) continue; // never remove the file just written (cannot happen: alreadyIn)
      try {
        await vfs.remove(from);
        moved.push([from, to]);
      } catch (error) {
        await showError(deps, title, error);
      }
    }
    const carriedFolders: [VPath, VPath][] = [];
    for (const { item } of tops) {
      if ((await vfs.stat(item).catch(() => null))?.kind !== 'dir') continue;
      const removed = await removeEmptyFolders(vfs, item).catch(() => [] as VPath[]);
      for (const [from, to] of emptyFolders) if (removed.includes(from)) carriedFolders.push([from, to]);
    }
    // The history follows each file actually moved, and so does its open document.
    for (const [from, to] of moved) await deps.history?.moved(from, to).catch(() => {});
    for (const [from, to] of moved) {
      const replacedDoc = replacedDocs.find((r) => r.path === to);
      const own = documents.list().find((doc) => doc.path === from);
      if (replacedDoc && own) {
        await documents.close(replacedDoc.doc.id).catch(() => false);
        replacedDocs.splice(replacedDocs.indexOf(replacedDoc), 1);
      }
      if (own && documents.relocate) await documents.relocate(from, to).catch(() => {});
    }
    outcome.written = moved;
    outcome.undo = { kind: 'move', pairs: moved, folders: carriedFolders, created, replaced };
  } else {
    outcome.undo = { kind: 'copy', copies: written.map(([, to]) => to), created, replaced };
  }
  // A replaced file whose document is open and not modified is reloaded.
  for (const { doc } of replacedDocs) await documents.reload(doc.id).catch(() => {});

  outcome.items = tops
    .filter(
      ({ item }) =>
        written.some(([from]) => isWithin(from, item)) || emptyFolders.some(([from]) => isWithin(from, item)),
    )
    .map(({ item }) => item);
  outcome.done = outcome.items.length > 0;
  if (!outcome.done) return outcome;
  const entry = outcome.undo;
  deps.undo.push(entry);
  const only = outcome.items.length === 1 ? basename(outcome.items[0] as VPath) : null;
  outcome.toast = movedToast(outcome.items.length, only, targetName(deps, targetDir), effective === 'copy');
  deps.dialogs.toast(outcome.toast, { label: UNDO_ACTION, run: () => void deps.undo.run(entry, true) });
  return outcome;
}
