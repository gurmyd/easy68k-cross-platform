// Undo in the Files panel (ARCHITECTURE-PLUS P3.2.7, P3.3.9): Ctrl+Z (Cmd+Z) in the tree, a toast's
// `Undo` and the context menu item undo the last file operation of this window. The stack holds the
// last 20 operations, in memory only; a 21st drops the oldest. Imports are not undone.
//
//   Delete        its Trash items come back through restoreWithQuestions (core/trash-restore)
//   Move, Rename  each file moves back (never over anything), and the history follows (moved)
//   Copy          each copy is removed through ctx.history.guard(path, 'delete', ...)
//   ... and then the `Replaced` items a Move or Copy made come back through restoreWithQuestions.
//
// Owner: N5.

import type { AppContext, HistoryService, VPath } from '../../contracts';
import { placeShort } from '../../core/places/display';
import { basename, dirname, sameName, splitVPath } from '../../core/paths/winpath';
import { restoreWithQuestions } from '../../core/trash-restore/restore-flow';
import {
  cannotKeepConfirm,
  inform,
  openDocumentsAt,
  remover,
  showError,
  type FilesDeps,
  type RemoveTally,
  type TrashRef,
  type UndoEntry,
} from './bulk';
import { gitRefusalFor } from './git-guard';
import { takeBackCopyOfGone, unchangedSince, writtenAs } from './move';
import { renameChecked } from './rename';
import { displayPath } from './store';
import {
  UNDO_TITLE,
  cannotMoveBackExists,
  cannotMoveBackGone,
  changedAfterRenaming,
  changedWhileMoving,
  goneAfterRenaming,
  goneWhileMoving,
  openInEditor,
  type UndoKind,
} from './texts';

export const UNDO_LIMIT = 20;

/** The undo stack of one window. */
export class UndoStack {
  private readonly entries: UndoEntry[] = [];
  private readonly listeners = new Set<() => void>();

  push(entry: UndoEntry): void {
    this.entries.push(entry);
    if (this.entries.length > UNDO_LIMIT) this.entries.shift();
    this.notify();
  }

  /** The newest entry, without taking it. */
  peek(): UndoEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  /** Takes `entry` off the stack (the newest, or the one a toast offered). */
  take(entry?: UndoEntry): UndoEntry | null {
    const index = entry ? this.entries.lastIndexOf(entry) : this.entries.length - 1;
    if (index < 0) return null;
    const [taken] = this.entries.splice(index, 1);
    this.notify();
    return taken ?? null;
  }

  get size(): number {
    return this.entries.length;
  }

  /** What the context menu item names (P3.2.7): null when there is nothing to undo. */
  kind(): UndoKind | null {
    return this.peek()?.kind ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

const STACKS = new WeakMap<AppContext, UndoStack>();
const UNDONE = new WeakMap<AppContext, Set<(paths: VPath[]) => void>>();

/** The undo stack of the window of `ctx`. */
export function undoStackOf(ctx: AppContext): UndoStack {
  let stack = STACKS.get(ctx);
  if (!stack) {
    stack = new UndoStack();
    STACKS.set(ctx, stack);
  }
  return stack;
}

/** The Files panel hears when a toast's Undo brought items back (it moves the focus there). */
export function onUndoneFromToast(ctx: AppContext, listener: (paths: VPath[]) => void): () => void {
  let set = UNDONE.get(ctx);
  if (!set) {
    set = new Set();
    UNDONE.set(ctx, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

/** The deps of the Files panel's operations for a window. */
export function filesDeps(ctx: AppContext): FilesDeps {
  const stack = undoStackOf(ctx);
  const deps: FilesDeps = {
    vfs: ctx.vfs,
    dialogs: ctx.dialogs,
    history: ctx.history,
    documents: ctx.documents,
    now: () => ctx.clock.wallTime().getTime(),
    undo: {
      push: (entry) => stack.push(entry),
      run: async (entry, fromToast) => {
        if (!stack.take(entry)) return [];
        const back = await undoEntry(deps, entry);
        if (fromToast) for (const listener of [...(UNDONE.get(ctx) ?? [])]) listener(back);
        return back;
      },
    },
  };
  return deps;
}

/** Undoes the newest operation of the stack (Ctrl+Z, the context menu). */
export async function undoLast(deps: FilesDeps, stack: UndoStack): Promise<VPath[]> {
  const entry = stack.take();
  return entry ? undoEntry(deps, entry) : [];
}

function labelsOf(deps: Pick<FilesDeps, 'vfs'>) {
  return deps.vfs.backends().map(({ mount, label, kind }) => ({ mount, label, kind }));
}

/** Brings Trash items back with the questions of P3.3.8, titled `Undo`. */
async function restoreItems(deps: FilesDeps, items: readonly TrashRef[]): Promise<VPath[]> {
  if (!deps.history || items.length === 0) return [];
  const result = await restoreWithQuestions(
    {
      history: deps.history,
      dialogs: deps.dialogs,
      documents: deps.documents,
      placeShort: (path) => placeShort(labelsOf(deps), path),
    },
    items,
    UNDO_TITLE,
  );
  return result.restored;
}

/** Undoes one entry; resolves to the paths brought back, in order. */
export async function undoEntry(deps: FilesDeps, entry: UndoEntry): Promise<VPath[]> {
  if (entry.kind === 'delete') return restoreItems(deps, entry.items);
  if (entry.kind === 'rename') return undoRename(deps, entry);
  const back = entry.kind === 'copy' ? await undoCopy(deps, entry) : await undoMove(deps, entry);
  await removeCreated(deps, entry.created);
  back.push(...(await restoreItems(deps, entry.replaced)));
  return back;
}

/** The place a file is named by in the refusal: its path within its store ("demo/prog.X68"). */
function relOf(path: VPath): string {
  return splitVPath(path).rel;
}

async function exists(deps: FilesDeps, path: VPath): Promise<boolean> {
  return (await deps.vfs.stat(path).catch(() => null)) !== null;
}

/** Moves back each file of a move; never replaces anything; a content change moves with it. */
async function undoMove(deps: FilesDeps, entry: Extract<UndoEntry, { kind: 'move' | 'rename' }>): Promise<VPath[]> {
  const { vfs, documents } = deps;
  const back: VPath[] = [];
  if (!documents.relocate) {
    for (const [, to] of entry.pairs) {
      const open = openDocumentsAt(documents, to)[0];
      if (open?.path) {
        await inform(deps, UNDO_TITLE, openInEditor(basename(open.path), 'move'));
        return back;
      }
    }
  }
  for (const [from, to] of entry.pairs) {
    const name = basename(from);
    // Nothing is moved back into or out of a folder named .git (P1.1 rule 2, errata N5 entry 15).
    const gitText = gitRefusalFor(vfs, [from, to]);
    if (gitText !== null) {
      await inform(deps, UNDO_TITLE, gitText);
      continue;
    }
    if (!(await exists(deps, to))) {
      await inform(deps, UNDO_TITLE, cannotMoveBackGone(name));
      continue;
    }
    if (await exists(deps, from)) {
      await inform(deps, UNDO_TITLE, cannotMoveBackExists(name, relOf(from)));
      continue;
    }
    try {
      const before = await vfs.stat(to);
      const data = await vfs.readFile(to);
      await vfs.writeFile(from, data);
      const copy = await writtenAs(vfs, from, data);
      // The file changed after its bytes were taken: it stays, with the change (entry 16). One that
      // is gone was moved or deleted by someone else: its copy goes again (entry 18).
      const seen = before ? { mtime: before.mtime, size: before.size, data } : undefined;
      if (!(await unchangedSince(vfs, to, seen))) {
        const gone = await takeBackCopyOfGone(vfs, to, from, copy);
        if (gone === 'taken-back') {
          await inform(deps, UNDO_TITLE, goneWhileMoving(basename(to), displayPath(vfs, dirname(from)), true));
        } else if (gone === 'there') {
          await inform(deps, UNDO_TITLE, changedWhileMoving(basename(to), displayPath(vfs, dirname(from)), true));
        }
        continue;
      }
      await vfs.remove(to);
    } catch (error) {
      await showError(deps, UNDO_TITLE, error);
      continue;
    }
    await deps.history?.moved(to, from).catch(() => {});
    if (documents.list().some((doc) => doc.path === to)) await documents.relocate?.(to, from).catch(() => {});
    back.push(from);
  }
  for (const [from] of entry.folders) {
    if (!(await exists(deps, from))) await vfs.mkdirp(from).catch(() => {});
  }
  return back;
}

/** A rename goes back through renameChecked (a change of letter case only included). */
async function undoRename(deps: FilesDeps, entry: Extract<UndoEntry, { kind: 'move' | 'rename' }>): Promise<VPath[]> {
  const { vfs, documents } = deps;
  const pair = entry.pairs[0];
  if (!pair) return [];
  const [from, to] = pair;
  const name = basename(from);
  const gitText = gitRefusalFor(vfs, [from, to]);
  if (gitText !== null) {
    await inform(deps, UNDO_TITLE, gitText);
    return [];
  }
  if (!(await exists(deps, to))) {
    await inform(deps, UNDO_TITLE, cannotMoveBackGone(name));
    return [];
  }
  const caseOnly = sameName(from, to);
  // A case-only rename back: "exists" there is the file itself, unless the folder holds a second
  // entry of the old spelling (a store that keeps case apart).
  const twin = caseOnly
    ? ((await vfs.list(dirname(from)).catch(() => null))?.some((e) => e.name === name && e.name !== basename(to)) ??
      false)
    : await exists(deps, from);
  if (twin) {
    await inform(deps, UNDO_TITLE, cannotMoveBackExists(name, relOf(from)));
    return [];
  }
  if (!documents.relocate && openDocumentsAt(documents, to).length > 0) {
    await inform(deps, UNDO_TITLE, openInEditor(basename(to), 'move'));
    return [];
  }
  let renamed: VPath;
  const kept: VPath[] = [];
  const gone: VPath[] = [];
  let copies: VPath | null = null;
  try {
    renamed = await renameChecked(vfs, to, basename(from), {
      kept: (files, folder) => {
        kept.push(...files);
        copies = folder;
      },
      gone: (files) => void gone.push(...files),
    });
  } catch (error) {
    await showError(deps, UNDO_TITLE, error);
    return [];
  }
  // A file that changed at the last moment stayed under the name it had; one that was moved or
  // deleted meanwhile has no copy under the old name (errata N5 entry 18).
  for (const file of kept) {
    await inform(deps, UNDO_TITLE, changedAfterRenaming(basename(file), displayPath(vfs, copies ?? renamed)));
  }
  for (const file of gone) {
    await inform(deps, UNDO_TITLE, goneAfterRenaming(basename(file), displayPath(vfs, renamed)));
  }
  await deps.history?.moved(to, renamed).catch(() => {});
  if (openDocumentsAt(documents, to).length > 0) await documents.relocate?.(to, renamed).catch(() => {});
  return [renamed];
}

/**
 * Removes each copy through guard, so that an edited copy can still come back from the Trash. Undo
 * of a Copy asks no question of its own, so `confirm` always asks P3.3.4's question when guard
 * cannot keep a copy (P3.2.7), whatever the history's state: it never answers Yes unasked.
 */
async function undoCopy(deps: FilesDeps, entry: Extract<UndoEntry, { kind: 'copy' }>): Promise<VPath[]> {
  const history: HistoryService | undefined = deps.history;
  for (const copy of entry.copies) {
    const gitText = gitRefusalFor(deps.vfs, [copy]);
    if (gitText !== null) {
      await inform(deps, UNDO_TITLE, gitText);
      continue;
    }
    if (!(await exists(deps, copy))) continue;
    const tally: RemoveTally = { removed: 0, kept: 0 };
    if (!history) {
      await deps.vfs.remove(copy).catch((error: unknown) => showError(deps, UNDO_TITLE, error));
      continue;
    }
    try {
      await history.guard(
        copy,
        'delete',
        remover(deps.vfs, copy, tally),
        cannotKeepConfirm(deps, UNDO_TITLE, 'undo-copy', basename(copy), false),
      );
    } catch (error) {
      await showError(deps, UNDO_TITLE, error);
    }
  }
  return [];
}

/** The folders a Move or Copy created at the target go again when they are empty, deepest first. */
async function removeCreated(deps: FilesDeps, created: readonly VPath[]): Promise<void> {
  const deepest = [...created].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const dir of deepest) {
    const entries = await deps.vfs.list(dir).catch(() => null);
    if (entries !== null && entries.length === 0) await deps.vfs.remove(dir).catch(() => {});
  }
}
