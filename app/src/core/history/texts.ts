// The texts of the safety net that more than one package shows (ARCHITECTURE-PLUS P3.3.4, P3.3.7).
// Written final by N0, then owned by N3 (N0 > N3). N4 (the History and Trash dialogs) and N5 (the
// Files panel) show them; N3's store builds none of them itself.

/** The question of P3.3.4 when no copy can be kept, by command. */
export type CannotKeepCommand = 'delete' | 'replace' | 'restore' | 'undo-copy';

/** Said instead of a promise of the Trash when the history is not `ready` (P3.3.4). */
export const CANNOT_BE_UNDONE = 'This cannot be undone.';

/**
 * `EASy68K cannot keep a copy of <what>. <Do it> anyway? This cannot be undone.` (P3.3.4; a
 * messageBox titled with the command, icon `warning`, buttons `Yes` and `No`, No has the focus).
 *
 * | command   | <what>                                                   | <Do it>                      |
 * | delete    | "prog.X68" in the Trash (a folder: the folder "demo" ...) | Delete it                    |
 * | replace   | the current "prog.X68"                                    | Replace it                   |
 * | restore   | the current "prog.X68"                                    | Restore the earlier version  |
 * | undo-copy | "prog.X68" in the Trash                                   | Remove the copy              |
 */
export function cannotKeepQuestion(command: CannotKeepCommand, name: string, isFolder: boolean): string {
  const inTrash = isFolder ? `the folder "${name}" in the Trash` : `"${name}" in the Trash`;
  const [what, doIt] =
    command === 'delete'
      ? [inTrash, 'Delete it']
      : command === 'replace'
        ? [`the current "${name}"`, 'Replace it']
        : command === 'restore'
          ? [`the current "${name}"`, 'Restore the earlier version']
          : [inTrash, 'Remove the copy'];
  return `EASy68K cannot keep a copy of ${what}. ${doIt} anyway? ${CANNOT_BE_UNDONE}`;
}

/** P3.3.4 step 4: a Replace's `act` finds the file changed since it was read. */
export function changedWhileReplacing(name: string): string {
  return `"${name}" changed while it was being replaced. It was not replaced.`;
}

/** P3.3.4 step 4: a Restore's `act` finds the file changed since it was read. */
export function changedWhileRestoring(name: string): string {
  return `"${name}" changed while it was being restored. It was not restored.`;
}

/** P3.3.8, P4.4: `read(path, seq)` of a version that is gone (pruned since the list was shown). */
export const VERSION_NOT_KEPT = 'This version is no longer kept.';

/**
 * P3.3.10, P1.1 rule 2: `guard` rejects, without calling `act`, a path below a `.git` folder
 * (`below`), a `.git` folder itself (`is`) and a folder that holds one (`holds`) (errata N3).
 */
export function gitRefused(path: string, how: 'below' | 'is' | 'holds'): string {
  const what = how === 'below' ? 'is in a .git folder' : how === 'is' ? 'is a .git folder' : 'holds a Git repository';
  return `"${path}" ${what}: EASy68K changes nothing there.`;
}

/** P3.3.4: the toast, shown once per window when `state()` becomes `tight`; it stays until dismissed. */
export const STORAGE_TIGHT_TOAST =
  "The browser's storage for this site is nearly full. To keep room for your files, EASy68K keeps no new earlier versions or Trash items until there is room again, and removes its oldest ones.";

/** P3.3.7: above the list of a dialog when single records did not parse. */
export function unreadableEntries(count: number): string {
  return `${count} entries could not be read.`;
}

/** P3.3.7: in the dialogs when the history is unavailable in this window. */
export function historyUnreadable(detail: string): string {
  return `The history cannot be read (${detail}). Your files are not affected.`;
}

/**
 * A change of the history that could not be made even when tried again (`Delete for Good`, `Empty
 * Trash`, `Delete Earlier Versions`, a move's history, deleting the database): the store rejects
 * with it rather than report success, and the dialogs show it (errata N3, "When a transaction
 * fails"). Built on P3.3.7's `The history cannot be read (<detail>).`, which the document gives;
 * this one it does not give.
 */
export function historyNotChanged(detail: string): string {
  return `The history could not be changed (${detail}). Your files are not affected.`;
}

/** P3.3.7: the button that deletes the database, and its confirmation (`Yes`, `No`). */
export const DELETE_HISTORY_BUTTON = 'Delete History and Trash';
export const DELETE_HISTORY_QUESTION =
  'Delete all earlier versions and everything in the Trash for good? Your current files are not affected.';

/** P3.3.7 and P3.5: what clearing the site's data removes. */
export const CLEARING_SITE_DATA =
  "Clearing this site's data in the browser removes My Programs, earlier versions and the Trash.";
