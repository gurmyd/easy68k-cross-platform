// The texts of the Files panel of the stage of additions (ARCHITECTURE-PLUS P3.2, P1.3), exactly as
// the document gives them. The code and the tests use these constants and functions. Texts shared
// with other packages live in core/history/texts.ts (the question when no copy can be kept) and
// core/trash-restore/texts.ts (a restore from the Trash). Owner: N5.

import { CANNOT_BE_UNDONE } from '../../core/history/texts';

export { CANNOT_BE_UNDONE };

const quoted = (name: string) => `"${name}"`;
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

// ---- P3.2.1 selection ------------------------------------------------------------------------------

/** Below the strip while more than one row is selected (`role="status"`). */
export const selectedCount = (n: number): string => `${n} items selected`;

// ---- P3.2.5 roots ---------------------------------------------------------------------------------

/** The third kind of root: the linked files. */
export const LINKED_ROOT_LABEL = 'Opened from this computer';
/** The secondary text of a linked file's row. */
export const LINKED_SECONDARY = 'edited in place';
/** The tool-tip of a linked file's row. */
export const linkedTooltip = (name: string): string => `Saving writes to the file "${name}" on this computer.`;
/** The secondary text of the opened folder's root. */
export const FOLDER_SECONDARY = 'on this computer';
/** The tool-tip of the opened folder's root. */
export const folderTooltip = (name: string): string =>
  `Files here are the files of the folder "${name}" on this computer.`;
/** The tool-tip line of a root or folder that holds a .git folder. */
export const GIT_TOOLTIP_LINE = 'Git repository (its .git folder is not shown)';

// ---- P3.2.2 delete --------------------------------------------------------------------------------

export const DELETE_TITLE = 'Delete';
export const REMOVE_FROM_LIST_TITLE = 'Remove from List';
export const UNDO_ACTION = 'Undo';

/** What the item is, for the questions: `"prog.X68"` or `the folder "demo" (14 files)`. */
export interface NamedItem {
  name: string;
  isFolder: boolean;
  /** Files below a folder (the folder's own count). */
  files: number;
}

function itemText(item: NamedItem, withCount: boolean): string {
  if (!item.isFolder) return quoted(item.name);
  return withCount ? `the folder ${quoted(item.name)} (${files(item.files)})` : `the folder ${quoted(item.name)}`;
}

/** `a`, `a and b`, `a, b and c`, `a, b, c and 2 more` (at most three names, P3.2.2). */
function listOf(names: readonly string[]): string {
  if (names.length <= 3) {
    if (names.length === 1) return names[0] as string;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/** The question of P3.2.2 without its appended sentence. */
export function deleteQuestion(list: readonly NamedItem[]): string {
  if (list.length === 1) {
    const only = list[0] as NamedItem;
    return only.isFolder
      ? `Delete the folder ${quoted(only.name)} and everything in it (${files(only.files)})?`
      : `Delete ${quoted(only.name)}?`;
  }
  return `Delete ${list.length} items: ${listOf(list.map((item) => itemText(item, true)))}?`;
}

/** Linked files only: `Remove "lab1.X68" from the Files panel? ...`. */
export function removeLinkedQuestion(names: readonly string[]): string {
  return names.length === 1
    ? `Remove ${quoted(names[0] as string)} from the Files panel? The file on this computer is not changed.`
    : `Remove ${names.length} files from the Files panel? The files on this computer are not changed.`;
}

/** A selection that mixes linked and other rows. */
export function deleteAndRemoveQuestion(deleted: number, linked: number): string {
  return `Delete ${items(deleted)} and remove ${linked} linked ${linked === 1 ? 'file' : 'files'} from the Files panel?`;
}

/** Appended to the question when the history is ready, in the browser store. */
export const restoreFromTrash = (one: boolean): string =>
  one ? 'You can restore it from the Trash.' : 'You can restore them from the Trash.';

/** Appended when the history is ready, in an opened folder or the desktop app's disk. */
export const deletedFromFolder = (one: boolean, label: string): string =>
  one
    ? `It is deleted from the folder "${label}" on this computer. A copy stays in the Trash of EASy68K for up to 30 days.`
    : `They are deleted from the folder "${label}" on this computer. A copy stays in the Trash of EASy68K for up to 30 days.`;

/**
 * A folder of the selection holds a folder named .git (P3.2.2, P3.2.4). `inner`: where the .git is,
 * as "Courses/lab3", or null when the selected folder itself holds it.
 */
export function gitRefusal(
  folder: string,
  inner: string | null,
  command: 'delete' | 'move' | 'copy' | 'rename',
): string {
  const head = `The folder ${quoted(folder)} holds a Git repository${inner === null ? '' : ` (${quoted(inner)})`}.`;
  switch (command) {
    case 'delete':
      return `${head} Nothing was deleted. Delete it with your own tools if you are sure.`;
    case 'move':
      return `${head} Move it with your own tools.`;
    case 'copy':
      return `${head} Copy it with your own tools.`;
    default:
      return `${head} Rename it with your own tools.`;
  }
}

/**
 * Rename or New Folder was given the name .git in some letter case (P1.1 rule 2; errata N5 entry
 * 15): shown as the commands show a name that cannot be used (`warning`, `OK`), then the name is
 * asked again. `name` is the name as typed (`.Git`).
 */
export const gitNameRefused = (name: string): string =>
  `The name ${quoted(name)} cannot be used in the Files panel: a folder named .git holds a Git repository's own files, and the Files panel does not show it or write into it. Choose another name.`;

/**
 * Move, Copy, Delete or Undo was given an item or a target named .git, or one inside a folder named
 * .git (the tree lists none; errata N5 entry 15): the command's title, `information`, `OK`.
 */
export const gitPathRefused = (name: string): string =>
  `${quoted(name)} belongs to a Git repository: the Files panel does not write, move, copy or delete anything named .git or inside a folder named .git. Use your own tools.`;

/**
 * The opened folder is itself a repository's .git folder (errata N5 entries 15 and 19): the stage's
 * own commands there (Delete, Rename, New Folder, Move, Copy, Undo). Import is not refused there
 * (P1.1 rule 2, entry 19).
 */
export const gitStoreRefused = (name: string): string =>
  `The folder ${quoted(name)} is the .git folder of a Git repository. The Files panel changes nothing in it.`;

/** The toast after a delete (P3.2.2). `only` names the one item deleted. */
export function deletedToast(count: number, only: string | null, forGood: number, changedKept: number): string {
  let text: string;
  if (forGood > 0) {
    text =
      count === 1 && only !== null
        ? `Deleted ${quoted(only)} for good.`
        : `Deleted ${count} items. ${forGood} of them ${forGood === 1 ? 'was' : 'were'} deleted for good.`;
  } else {
    text = count === 1 && only !== null ? `Deleted ${quoted(only)}.` : `Deleted ${count} items.`;
  }
  if (changedKept > 0) text += ` ${changedWhileDeleting(changedKept)}`;
  return text;
}

/** P3.2.2: files that changed or appeared while a folder was being deleted stay. */
export const changedWhileDeleting = (n: number): string =>
  n === 1
    ? '1 file changed while it was being deleted and was kept.'
    : `${n} files changed while they were being deleted and were kept.`;

// ---- P3.2.3 export --------------------------------------------------------------------------------

export const EXPORT_ZIP_NAME = 'EASy68K export.zip';
export const exportAllCaption = (label: string): string => `Export all of ${label} as ${label}.zip`;
export const exportFileCaption = (name: string): string => `Export ${quoted(name)}`;
export const exportFolderCaption = (name: string): string => `Export the folder ${quoted(name)} as ${name}.zip`;
export const exportSeveralCaption = (n: number): string => `Export ${n} items as ${EXPORT_ZIP_NAME}`;
/** Today's toast after an export to a .zip. */
export const exportedToast = (n: number, name: string): string => `Exported ${files(n)} as ${name}.`;

// ---- P3.2.4 moving --------------------------------------------------------------------------------

export const MOVE_TITLE = 'Move';
export const COPY_TITLE = 'Copy';
export const RENAME_TITLE = 'Rename';
/** New Folder...'s question and messages (FS1's title). */
export const NEW_FOLDER_TITLE = 'New Folder';
/** The name New Folder... offers first (FS1's). */
export const NEW_FOLDER_INITIAL_NAME = 'New Folder';
export const MOVE_TO_DIALOG_TITLE = 'Move To';
export const MOVE_BUTTON = 'Move';
export const COPY_BUTTON = 'Copy';
export const CANCEL_BUTTON = 'Cancel';
export const MOVE_TO_LIST_LABEL = 'Folders';

/** The target's tool-tip while a drag from another store is over it. */
export const copyTo = (place: string): string => `Copy to ${place}`;

/** One file at the target exists already (P3.2.4): `Yes`, `No`, `Cancel`. */
export function replaceOneQuestion(name: string, place: string, ready: boolean): string {
  const second = ready ? 'The file there now goes to the Trash.' : CANNOT_BE_UNDONE;
  return `${quoted(name)} already exists in ${place}. Replace it? ${second} Choose No to skip this item.`;
}

/** Several files at the target exist already. */
export function replaceManyQuestion(n: number, place: string, ready: boolean): string {
  const second = ready ? 'The files there now go to the Trash.' : CANNOT_BE_UNDONE;
  return `${n} of the items already exist in ${place}. Replace them? ${second} Choose No to skip them.`;
}

/**
 * An item that cannot go to the target because something of the same name is there already: one of
 * the other kind, a second selected item of that name, or a file that appeared meanwhile (`Move` or
 * `Copy`, `error`, `OK`; FS1's rename text, errata N5 entries 7 and 13).
 */
export const alreadyExists = (name: string): string => `${quoted(name)} already exists.`;

/** The item to rename is gone (FS1's renameEntry text; `Rename` or `Undo`, `error`, `OK`). */
export const noLongerExists = (name: string): string => `${quoted(name)} no longer exists.`;

/** A file to be replaced is open and modified (`Move`, `information`, `OK`). */
export const unsavedReplace = (name: string): string =>
  `${quoted(name)} has changes that are not saved. Save it or close it first, then replace it.`;

/** While DocumentService.relocate does not exist, an open file is not moved or renamed. */
export const openInEditor = (name: string, command: 'move' | 'rename'): string =>
  `${quoted(name)} is open in the editor. Close it first, then ${command === 'move' ? 'move' : 'rename'} it.`;

/**
 * A moved file changed after its bytes were copied and before its source was removed (another
 * window saved it, a program wrote it): the source is not removed (`Move` or `Undo`, `information`,
 * `OK`; errata N5 entry 16). `place` is where the earlier copy was written.
 */
export const changedWhileMoving = (name: string, place: string, back: boolean): string =>
  back
    ? `${quoted(name)} changed while it was being moved back, so it stays where it is. The copy in ${place} holds it as it was before the change.`
    : `${quoted(name)} changed while it was being moved, so it stays where it was. The copy in ${place} holds it as it was before the change.`;

/**
 * A file was moved or deleted by someone else (another window, a program) between its copy and its
 * removal: its copy was removed again, so that the move does not bring it back (`Move` or `Undo`,
 * `information`, `OK`; errata N5 entry 18). `place` is the folder that would have held the copy.
 */
export const goneWhileMoving = (name: string, place: string, back: boolean): string =>
  back
    ? `${quoted(name)} was moved or deleted while it was being moved back, so ${place} does not hold a copy of it.`
    : `${quoted(name)} was moved or deleted while it was being moved, so ${place} does not hold a copy of it.`;

/**
 * A file changed (or appeared) between its copy and the removal of the old name, found before
 * anything was removed: the rename is not made, the copies made so far are removed again (`Rename`
 * or `Undo`, `error`, `OK`, as renameEntry's own refusals; errata N5 entry 18). `item` is the file or folder being renamed,
 * `changed` the file within it, as a path below the item's folder ("lab/prog.X68").
 */
export const changedWhileRenaming = (item: string, changed: string, isFolder: boolean): string =>
  isFolder
    ? `The folder ${quoted(item)} was not renamed: ${quoted(changed)} changed while it was being renamed. Rename it again to use the new name.`
    : `${quoted(item)} was not renamed: it changed while it was being renamed. Rename it again to use the new name.`;

/**
 * A file of a renamed folder changed in the moment between the last check and its removal: it stays
 * under the old name, and the renamed folder holds it as it was before the change (`Rename` or
 * `Undo`, `information`, `OK`; errata N5 entry 18).
 */
export const changedAfterRenaming = (changed: string, place: string): string =>
  `${quoted(changed)} changed while its folder was being renamed, so it stays where it was. The copy in ${place} holds it as it was before the change.`;

/**
 * A file of a renamed folder was moved or deleted (by another window, or a program) in the moment
 * between the last check and its removal: its copy under the new name was removed again, so that the
 * rename does not bring it back (`Rename` or `Undo`, `information`, `OK`; errata N5 entry 18).
 */
export const goneAfterRenaming = (gone: string, place: string): string =>
  `${quoted(gone)} was moved or deleted while its folder was being renamed, so ${place} does not hold a copy of it.`;

/** The toast after a move (P3.2.4), with `Undo`. `only` names the one item moved. */
export function movedToast(count: number, only: string | null, target: string, copied: boolean): string {
  const verb = copied ? 'Copied' : 'Moved';
  return count === 1 && only !== null
    ? `${verb} ${quoted(only)} to ${target}.`
    : `${verb} ${count} items to ${target}.`;
}

// ---- P3.2.7 undo ----------------------------------------------------------------------------------

export const UNDO_TITLE = 'Undo';
export type UndoKind = 'delete' | 'move' | 'rename' | 'copy';
/** The context menu item's caption (with its access key). */
export function undoCaption(kind: UndoKind | null): string {
  if (kind === null) return '&Undo';
  return `&Undo ${kind === 'delete' ? 'Delete' : kind === 'move' ? 'Move' : kind === 'rename' ? 'Rename' : 'Copy'}`;
}
export const cannotMoveBackExists = (name: string, where: string): string =>
  `${quoted(name)} cannot be moved back: ${quoted(where)} exists now.`;
export const cannotMoveBackGone = (name: string): string =>
  `${quoted(name)} cannot be moved back: it no longer exists.`;

// ---- P3.2.6 storage and the import question ---------------------------------------------------------

export const IMPORT_TITLE = 'Import';

/** 1 kB = 1024 bytes; one decimal (bytes are whole numbers). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} bytes`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function largeImportQuestion(count: number, bytes: number, where: string, free: number | null): string {
  const first = `Import ${files(count)} (${formatSize(bytes)}) into ${where}?`;
  return free === null ? first : `${first} The browser has about ${formatSize(free)} free for this site.`;
}

export function notEnoughRoom(count: number, bytes: number, free: number): string {
  return `There is not enough room in this browser's storage for ${files(count)} (${formatSize(bytes)}): about ${formatSize(Math.max(0, free))} is free. Import fewer files, or delete files you no longer need.`;
}

export const siteUses = (bytes: number): string => `This site uses ${formatSize(bytes)} in this browser`;
export const historyUses = (bytes: number): string => `Earlier versions and Trash: ${formatSize(bytes)}`;
export const aboutFree = (bytes: number): string => `About ${formatSize(bytes)} free`;
export const STORAGE_SEPARATOR = ' - ';

// ---- the strip and the context menu -------------------------------------------------------------------

export const TRASH_BUTTON = 'Trash...';
export const MOVE_TO_CAPTION = '&Move To...';
export const EARLIER_VERSIONS_CAPTION = 'Earlier &Versions...';
export const REMOVE_FROM_LIST_CAPTION = 'Re&move from List';
