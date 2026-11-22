// Delete and Export of a multiple selection in the Files panel (ARCHITECTURE-PLUS P3.2.2, P3.2.3).
// Every delete goes through ctx.history.guard (P3.3.4): there is no second path. Plain async
// functions over FilesDeps, so that the tests drive them under Node with memory backends, fakes of
// the history and the real store (createMemoryHistoryService). Owner: N5.
//
// Also the parts that move.ts and undo.ts share: FilesDeps, the remover of P3.2.2 (only files that
// guard read and that are unchanged, then the item's folders left empty, deepest first), and the
// questions asked through the dialogs.

import type {
  DialogService,
  DocumentService,
  DocumentState,
  HistoryService,
  SeenFile,
  Vfs,
  VPath,
} from '../../contracts';
import { cannotKeepQuestion, type CannotKeepCommand } from '../../core/history/texts';
import { basename, childPath, dirname, isWithin, sameName, splitVPath } from '../../core/paths/winpath';
import type { ZipInput } from '../../fs/zip';
import { writeZip } from '../../fs/zip';
import { findGitHolder, gitRefusalFor, innerName, isGitName } from './git-guard';
import { buildExport, displayPath, locations, sortEntries, type ExportFile } from './store';
import {
  CANNOT_BE_UNDONE,
  DELETE_TITLE,
  EXPORT_ZIP_NAME,
  REMOVE_FROM_LIST_TITLE,
  UNDO_ACTION,
  deleteAndRemoveQuestion,
  deleteQuestion,
  deletedFromFolder,
  deletedToast,
  exportAllCaption,
  exportFileCaption,
  exportFolderCaption,
  exportSeveralCaption,
  gitRefusal,
  removeLinkedQuestion,
  restoreFromTrash,
  type NamedItem,
} from './texts';

// ---- what the operations need ---------------------------------------------------------------------

/** A Trash item with the path it was taken from (P3.3.9: the undo stack keeps ids with paths). */
export interface TrashRef {
  id: string;
  path: VPath;
}

/** One entry of the undo stack of P3.2.7 (P3.3.9): ids and paths, never bytes. */
export type UndoEntry =
  | { kind: 'delete'; items: TrashRef[] }
  | {
      kind: 'move' | 'rename';
      /** Files moved, [from, to]; for a rename, the item itself. */
      pairs: [VPath, VPath][];
      /** Empty folders the move carried over, [from, to]. */
      folders: [VPath, VPath][];
      /** The folders the move created at the target (removed again by Undo when empty). */
      created: VPath[];
      /** The `Replaced` Trash items the move made (P3.2.7). */
      replaced: TrashRef[];
    }
  | {
      kind: 'copy';
      /** The files the copy wrote. */
      copies: VPath[];
      /** The folders the copy created at the target. */
      created: VPath[];
      replaced: TrashRef[];
    };

export interface FilesDeps {
  vfs: Vfs;
  dialogs: DialogService;
  /** Absent in tests that do not need it (P4.4). */
  history: HistoryService | undefined;
  documents: DocumentService;
  /** The wall clock in ms (record's time, the export's dates). */
  now(): number;
  /** The undo stack of this window (undo.ts). */
  undo: {
    push(entry: UndoEntry): void;
    /** Undoes `entry` (a toast's Undo); resolves to the paths brought back. */
    run(entry: UndoEntry, fromToast: boolean): Promise<VPath[]>;
  };
}

/** True when the history promises a copy now (P3.3.4: the question's appended text). */
export function historyReady(deps: Pick<FilesDeps, 'history'>): boolean {
  return deps.history !== undefined && deps.history.state() === 'ready';
}

/** The question of P3.3.4 when no copy can be kept: `warning`, `Yes`, `No`. */
export function cannotKeepConfirm(
  deps: Pick<FilesDeps, 'dialogs'>,
  title: string,
  command: CannotKeepCommand,
  name: string,
  isFolder: boolean,
): () => Promise<boolean> {
  return async () =>
    (await deps.dialogs.messageBox({
      title,
      text: cannotKeepQuestion(command, name, isFolder),
      icon: 'warning',
      buttons: ['Yes', 'No'],
      defaultButton: 'No', // P3.3.4: No has the focus
    })) === 'Yes';
}

/** `confirm` for guard: asks when the command's own question promised a copy, else Yes at once. */
export function confirmFor(
  deps: Pick<FilesDeps, 'dialogs'>,
  promised: boolean,
  title: string,
  command: CannotKeepCommand,
  name: string,
  isFolder: boolean,
): () => Promise<boolean> {
  return promised ? cannotKeepConfirm(deps, title, command, name, isFolder) : async () => true;
}

export async function inform(deps: Pick<FilesDeps, 'dialogs'>, title: string, text: string): Promise<void> {
  await deps.dialogs.messageBox({ title, text, icon: 'information', buttons: ['OK'] });
}

export async function showError(deps: Pick<FilesDeps, 'dialogs'>, title: string, error: unknown): Promise<void> {
  await deps.dialogs.messageBox({
    title,
    text: error instanceof Error ? error.message : String(error),
    icon: 'error',
    buttons: ['OK'],
  });
}

/** The open documents at or below `path` (letter case as stored). */
export function openDocumentsAt(documents: DocumentService, path: VPath): DocumentState[] {
  return documents.list().filter((doc) => doc.path !== null && isWithin(doc.path, path));
}

/** The document open at exactly `path` (letter case ignored), or undefined. */
export function documentAt(documents: DocumentService, path: VPath): DocumentState | undefined {
  return documents.list().find((doc) => doc.path !== null && sameName(doc.path, path));
}

// ---- walking an item -----------------------------------------------------------------------------------

/** The files below a folder (or the file itself), never below a folder named .git. */
export async function filesBelow(vfs: Vfs, path: VPath): Promise<VPath[]> {
  const stat = await vfs.stat(path).catch(() => null);
  if (!stat) return [];
  if (stat.kind === 'file') return [path];
  const out: VPath[] = [];
  const walk = async (dir: VPath) => {
    for (const entry of sortEntries(await vfs.list(dir).catch(() => []))) {
      if (entry.kind === 'dir' && isGitName(entry.name)) continue;
      const child = childPath(dir, entry.name);
      if (entry.kind === 'dir') await walk(child);
      else out.push(child);
    }
  };
  await walk(path);
  return out;
}

/** The empty folders at or below `path`, parents before children. */
export async function emptyFoldersBelow(vfs: Vfs, path: VPath): Promise<VPath[]> {
  const out: VPath[] = [];
  const walk = async (dir: VPath) => {
    const entries = await vfs.list(dir).catch(() => null);
    if (entries === null) return;
    if (entries.length === 0) {
      out.push(dir);
      return;
    }
    for (const entry of sortEntries(entries)) {
      if (entry.kind === 'dir' && !isGitName(entry.name)) await walk(childPath(dir, entry.name));
    }
  };
  const stat = await vfs.stat(path).catch(() => null);
  if (stat?.kind === 'dir') await walk(path);
  return out;
}

/**
 * Removes the folders at and below `root` that are empty, deepest first; a folder that still
 * holds something stays, with the folders above it. Never touches a folder named .git or a store's
 * root. Returns the folders removed.
 */
export async function removeEmptyFolders(vfs: Vfs, root: VPath): Promise<VPath[]> {
  const removed: VPath[] = [];
  const walk = async (dir: VPath): Promise<boolean> => {
    const entries = await vfs.list(dir).catch(() => null);
    if (entries === null) return false;
    let empty = true;
    for (const entry of entries) {
      if (entry.kind === 'file' || isGitName(entry.name)) {
        empty = false;
        continue;
      }
      if (!(await walk(childPath(dir, entry.name)))) empty = false;
    }
    if (!empty || splitVPath(dir).rel === '') return false;
    await vfs.remove(dir);
    removed.push(dir);
    return true;
  };
  const stat = await vfs.stat(root).catch(() => null);
  if (stat?.kind === 'dir') await walk(root);
  return removed;
}

/** What a remover did: files removed, and files that stayed because they changed or appeared. */
export interface RemoveTally {
  removed: number;
  kept: number;
}

/**
 * `remove(seen)` of P3.2.2: removes, one by one, the files of `seen` whose modification time and
 * size are still the ones `seen` gives, then the folders of the item that are then empty, deepest
 * first. A file that changed or appeared meanwhile stays, with its folders.
 */
export function remover(vfs: Vfs, root: VPath, tally: RemoveTally): (seen: readonly SeenFile[]) => Promise<void> {
  return async (seen) => {
    for (const file of seen) {
      const now = await vfs.stat(file.path).catch(() => null);
      if (now?.kind === 'file' && now.mtime === file.mtime && now.size === file.size) {
        await vfs.remove(file.path);
        tally.removed++;
      }
    }
    await removeEmptyFolders(vfs, root);
    tally.kept = (await filesBelow(vfs, root)).length;
  };
}

// ---- names and places ------------------------------------------------------------------------------------

/** The name of an opened folder of the student's computer ("Lab"), from its backend. */
export function folderNameOf(vfs: Pick<Vfs, 'backends'>, mount: string): string {
  const backend = vfs.backends().find((b) => b.mount === mount) as
    ({ label: string; rootHandle?: { name?: string } } & object) | undefined;
  if (!backend) return mount;
  const name = backend.rootHandle?.name;
  if (typeof name === 'string' && name !== '') return name;
  return backend.label.replace(/^Folder: /, '');
}

/** The name the questions give a store's place ("My Programs/demo"; a root: its label). */
export function placeOf(vfs: Vfs, dir: VPath): string {
  return displayPath(vfs, dir);
}

/**
 * The selection as a bulk command takes it: without the items that lie inside another selected item
 * (after Ctrl+A a folder and the files in it are all selected; the folder carries them). A store's
 * root never swallows what is below it (a root itself is neither deleted, moved nor copied). The
 * order of `paths` is kept; a path given twice counts once.
 */
export function outermostItems(paths: readonly VPath[]): VPath[] {
  const containers = paths.filter((p) => splitVPath(p).rel !== '');
  const out: VPath[] = [];
  for (const path of paths) {
    if (out.includes(path)) continue;
    if (containers.some((outer) => outer !== path && isWithin(path, outer))) continue;
    out.push(path);
  }
  return out;
}

/** A linked file's row: /linked/<id>/<name>. */
export function isLinkedPath(path: VPath): boolean {
  return splitVPath(path).mount === 'linked';
}

/** The folder of a linked file's link, /linked/<id>. */
export function linkFolderOf(path: VPath): VPath {
  const { rel } = splitVPath(path);
  return `/linked/${rel.split('/')[0]}`;
}

// ---- Delete (P3.2.2) ----------------------------------------------------------------------------------

export interface DeleteOutcome {
  /** The question was answered Yes (false: refused or No). */
  confirmed: boolean;
  /** Items deleted (something of each was removed). */
  deleted: VPath[];
  /** Linked files removed from the list. */
  removedLinked: VPath[];
  /** Items not deleted after a stop (No to P3.3.4's question, a failed removal): they stay selected. */
  remaining: VPath[];
  /** The undo entry pushed, when an item was kept in the Trash. */
  undo: UndoEntry | null;
  /** The toast shown, or null. */
  toast: string | null;
  /** The toast offered Undo. */
  offeredUndo: boolean;
}

interface Planned {
  path: VPath;
  item: NamedItem;
}

/**
 * Delete of the selection, `paths` in the tree's order (P3.2.2): the .git refusal, one question,
 * then each item through ctx.history.guard; linked files are removed from the list instead.
 */
export async function deleteItems(deps: FilesDeps, selected: readonly VPath[]): Promise<DeleteOutcome> {
  const paths = outermostItems(selected);
  const outcome: DeleteOutcome = {
    confirmed: false,
    deleted: [],
    removedLinked: [],
    remaining: [...paths],
    undo: null,
    toast: null,
    offeredUndo: false,
  };
  const { vfs } = deps;
  const linked = paths.filter((p) => isLinkedPath(p) && splitVPath(p).rel.includes('/'));
  const planned: Planned[] = [];
  for (const path of paths) {
    if (isLinkedPath(path) || splitVPath(path).rel === '') continue; // a store itself is not deleted
    const stat = await vfs.stat(path).catch(() => null);
    if (!stat) continue;
    const isFolder = stat.kind === 'dir';
    planned.push({
      path,
      item: { name: basename(path), isFolder, files: isFolder ? (await filesBelow(vfs, path)).length : 1 },
    });
  }
  if (planned.length === 0 && linked.length === 0) return outcome;

  // Nothing below a folder named .git is removed (P1.1 rule 2), nor in an opened folder that is
  // itself a repository's .git folder (errata N5 entry 15).
  const gitText = gitRefusalFor(
    vfs,
    planned.map((p) => p.path),
  );
  if (gitText !== null) {
    await inform(deps, DELETE_TITLE, gitText);
    return outcome;
  }

  // A folder that holds .git is not deleted: nothing is (the first in the tree's order is named).
  for (const { path, item } of planned) {
    if (!item.isFolder) continue;
    const holder = await findGitHolder(vfs, path);
    if (holder) {
      await inform(deps, DELETE_TITLE, gitRefusal(item.name, innerName(path, holder), 'delete'));
      return outcome;
    }
  }

  // The question, with the sentence the history's state gives when it is asked.
  const promised = planned.length > 0 && historyReady(deps);
  let text: string;
  if (planned.length === 0) {
    text = removeLinkedQuestion(linked.map((p) => basename(p)));
  } else {
    text =
      linked.length > 0
        ? deleteAndRemoveQuestion(planned.length, linked.length)
        : deleteQuestion(planned.map((p) => p.item));
    text += ` ${appendedSentence(deps, planned, promised)}`;
  }
  const answer = await deps.dialogs.messageBox({
    title: planned.length === 0 ? REMOVE_FROM_LIST_TITLE : DELETE_TITLE,
    text,
    icon: 'confirmation',
    buttons: ['Yes', 'No'],
    defaultButton: 'No', // P3.2.2: No has the focus
  });
  if (answer !== 'Yes') return outcome;
  outcome.confirmed = true;

  // Linked files leave the list; the files on the student's computer are not touched.
  for (const path of linked) {
    try {
      await vfs.remove(linkFolderOf(path));
      outcome.removedLinked.push(path);
    } catch (error) {
      await showError(deps, REMOVE_FROM_LIST_TITLE, error);
    }
  }

  const kept: TrashRef[] = [];
  let forGood = 0;
  let changedKept = 0;
  let stopped: number | null = null;
  for (let i = 0; i < planned.length; i++) {
    const { path, item } = planned[i] as Planned;
    const tally: RemoveTally = { removed: 0, kept: 0 };
    if (!deps.history) {
      // Without a history (tests): as today.
      try {
        await vfs.remove(path);
        outcome.deleted.push(path);
      } catch (error) {
        await showError(deps, DELETE_TITLE, error);
        stopped = i;
        break;
      }
      continue;
    }
    let result: Awaited<ReturnType<HistoryService['guard']>>;
    try {
      result = await deps.history.guard(
        path,
        'delete',
        remover(vfs, path, tally),
        confirmFor(deps, promised, DELETE_TITLE, 'delete', item.name, item.isFolder),
      );
    } catch (error) {
      if (tally.removed > 0) outcome.deleted.push(path);
      await showError(deps, DELETE_TITLE, error);
      stopped = i;
      break;
    }
    if (result.outcome === 'declined') {
      stopped = i;
      break;
    }
    if (tally.removed === 0 && tally.kept > 0) {
      changedKept += tally.kept; // nothing of it went: it changed meanwhile
      continue;
    }
    if (tally.removed === 0 && !result.item) continue; // it was gone already
    outcome.deleted.push(path);
    changedKept += tally.kept;
    if (result.outcome === 'not-kept') forGood++;
    else if (result.item) kept.push({ id: result.item, path });
  }
  outcome.remaining = stopped === null ? [] : planned.slice(stopped).map((p) => p.path);

  if (kept.length > 0) {
    outcome.undo = { kind: 'delete', items: kept };
    deps.undo.push(outcome.undo);
  }
  const count = outcome.deleted.length;
  if (count > 0) {
    const only = count === 1 ? basename(outcome.deleted[0] as VPath) : null;
    const allKept = promised && forGood === 0 && kept.length === count;
    outcome.toast = deletedToast(count, only, promised ? forGood : 0, changedKept);
    if (allKept && outcome.undo) {
      const entry = outcome.undo;
      outcome.offeredUndo = true;
      deps.dialogs.toast(outcome.toast, { label: UNDO_ACTION, run: () => void deps.undo.run(entry, true) });
    } else {
      deps.dialogs.toast(outcome.toast);
    }
  }
  return outcome;
}

/** The sentence appended to the question of P3.2.2. */
function appendedSentence(deps: FilesDeps, planned: readonly Planned[], promised: boolean): string {
  if (!promised) return CANNOT_BE_UNDONE;
  const one = planned.length === 1;
  const outside = planned.find((p) => splitVPath(p.path).mount !== 'browser');
  if (!outside) return restoreFromTrash(one);
  const { mount } = splitVPath(outside.path);
  const label = mount === 'disk' ? basename(dirname(outside.path)) : folderNameOf(deps.vfs, mount);
  return deletedFromFolder(one, label);
}

// ---- Export (P3.2.3) -----------------------------------------------------------------------------------

/** A selected row as the export caption needs it. */
export interface ExportRow {
  path: VPath;
  kind: 'root' | 'dir' | 'file';
  /** A root's label. */
  label: string;
}

/** The Export button's accessible name and tool-tip, and the context menu item's caption (P3.2.3). */
export function exportCaption(vfs: Vfs, rows: readonly ExportRow[]): string {
  if (rows.length === 0) return exportAllCaption(locations(vfs)[0]?.label ?? 'My Programs');
  if (rows.length > 1) return exportSeveralCaption(rows.length);
  const only = rows[0] as ExportRow;
  if (only.kind === 'root') return exportAllCaption(only.label);
  if (only.kind === 'dir') return exportFolderCaption(basename(only.path));
  return exportFileCaption(basename(only.path));
}

/** `prog.X68`, then `prog (2).X68`, `prog (3).X68` ...; a folder `demo (2)` (P3.2.3). */
export function uniqueName(name: string, isFolder: boolean, taken: Set<string>): string {
  const key = (n: string) => n.toLowerCase();
  if (!taken.has(key(name))) {
    taken.add(key(name));
    return name;
  }
  const dot = isFolder ? -1 : name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(key(candidate))) {
      taken.add(key(candidate));
      return candidate;
    }
  }
}

/**
 * What Export downloads for the selection: one item as today (buildExport, without .git); several
 * as `EASy68K export.zip` with each item at its top level. Items from different stores may be mixed.
 */
export async function exportItems(vfs: Vfs, paths: readonly VPath[], now: number): Promise<ExportFile> {
  if (paths.length === 1) return buildExport(vfs, paths[0] as VPath, now);
  const inputs: ZipInput[] = [];
  const taken = new Set<string>();
  let files = 0;
  for (const path of paths) {
    const stat = await vfs.stat(path);
    if (!stat) throw new Error(`"${basename(path)}" no longer exists.`);
    const top = uniqueName(basename(path), stat.kind === 'dir', taken);
    if (stat.kind === 'file') {
      inputs.push({ path: top, data: await vfs.readFile(path), mtime: stat.mtime || now });
      files++;
      continue;
    }
    inputs.push({ path: `${top}/`, mtime: stat.mtime || now });
    const walk = async (dir: VPath, prefix: string) => {
      for (const entry of sortEntries(await vfs.list(dir))) {
        if (entry.kind === 'dir' && isGitName(entry.name)) continue;
        const child = childPath(dir, entry.name);
        const childStat = await vfs.stat(child);
        if (entry.kind === 'dir') {
          inputs.push({ path: `${prefix}${entry.name}/`, mtime: childStat?.mtime || now });
          await walk(child, `${prefix}${entry.name}/`);
        } else {
          inputs.push({
            path: `${prefix}${entry.name}`,
            data: await vfs.readFile(child),
            mtime: childStat?.mtime || now,
          });
          files++;
        }
      }
    };
    await walk(path, `${top}/`);
  }
  return { name: EXPORT_ZIP_NAME, bytes: writeZip(inputs), kind: 'zip', files };
}
