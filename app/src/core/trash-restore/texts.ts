// The questions and messages of a restore from the Trash (ARCHITECTURE-PLUS P3.3.8, P3.2.7).
// Owner: N0 > N4. Shown by restoreWithQuestions (restore-flow.ts) for the Trash dialog (N4) and
// the Files panel's Undo (N5).

import { VERSION_NOT_KEPT } from '../history/texts';

/** The folder of My Programs that takes files whose store is not available (P3.3.8). */
export const RESTORED_FOLDER = 'Restored';

/** `prog (restored).X68`, then `prog (restored 2).X68`, ... (P3.3.8). `n` counts from 1. */
export function restoredName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  return `${stem} (restored${n > 1 ? ` ${n}` : ''})${ext}`;
}

/**
 * Something is at the place of a file to restore (`Yes`, `No`, `Cancel`). `where` is the path as the
 * student reads it ("demo/prog.X68"), `beside` the name the file gets with No. When the history is
 * not `ready`, the second sentence is `This cannot be undone.` (P3.3.4).
 */
export function existsQuestion(where: string, beside: string, historyReady: boolean): string {
  const second = historyReady ? 'The file there now goes to the Trash.' : 'This cannot be undone.';
  return `"${where}" exists. Replace it with the one from the Trash? ${second} Choose No to keep both: the restored file is named "${beside}".`;
}

/** An open, modified document is skipped (`Restore`, `information`, `OK`). */
export function unsavedChanges(name: string): string {
  return `"${name}" has changes that are not saved. Save it or close it first, then restore.`;
}

/** The item was in an opened folder that is not open now (`Yes`, `No`). */
export function folderNotOpen(name: string, folder: string): string {
  return `"${name}" was in the folder "${folder}", which is not open. Restore it into My Programs/${RESTORED_FOLDER} instead? Choose No to leave it in the Trash.`;
}

/** The item was on the desktop app's disk outside a granted root (`Yes`, `No`). */
export function placeUnreachable(name: string, where: string): string {
  return `"${name}" was in "${where}", which EASy68K cannot reach now. Restore it into My Programs/${RESTORED_FOLDER} instead? Choose No to leave it in the Trash.`;
}

/**
 * A restore that wrote some of an item's files but not all (`Restore` or `Undo`, `information`,
 * `OK`). `lost`: how many of the files not written are no longer in the Trash.
 */
export function partlyRestored(restored: number, total: number, lost: number): string {
  const others = total - restored;
  const second =
    lost === 0
      ? 'The others are still in the Trash.'
      : lost >= others
        ? 'The others are no longer in the Trash.'
        : lost === 1
          ? '1 of the others is no longer in the Trash.'
          : `${lost} of the others are no longer in the Trash.`;
  return `${restored} of ${total} files were restored. ${second}`;
}

/** P3.2.7: an item that expired or was emptied (`Undo` or `Restore`, `information`, `OK`). */
export function noLongerInTrash(name: string): string {
  return `"${name}" cannot be brought back: it is no longer in the Trash.`;
}

/** P3.3.8: Earlier Versions' Restore of a version pruned since the list was shown (the store's
 *  rejection of `read` says the same, core/history/texts.ts). */
export const VERSION_NO_LONGER_KEPT = VERSION_NOT_KEPT;

/**
 * The folder's name in `folderNotOpen` when the store cannot tell it (an item of an opened folder
 * whose roots entry is gone; errata N4 entry 3). The store gives the name in every other case.
 */
export const UNKNOWN_FOLDER_NAME = 'opened folder';
