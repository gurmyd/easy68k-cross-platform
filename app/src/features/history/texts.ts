// The texts of the Earlier Versions and Trash dialogs (ARCHITECTURE-PLUS P3.3.3, P3.3.8). Owner: N4.
//
// Copied character by character from the document; code and tests use these constants. The texts
// that more than one package shows are in core/history/texts.ts (N3: the question of P3.3.4, the
// storage-tight toast, the texts of P3.3.7) and core/trash-restore/texts.ts (N4: the questions of a
// restore from the Trash, which N5's Undo shows too).

import type { VersionReason } from '../../contracts';

/* ---- ids ---- */

/** The dialog ids (P3.3.8). */
export const VERSIONS_DIALOG_ID = 'history.versions';
export const TRASH_DIALOG_ID = 'history.trash';

/* ---- Earlier Versions (P3.3.8) ---- */

/** `Earlier Versions of prog.X68`. */
export function versionsTitle(name: string): string {
  return `Earlier Versions of ${name}`;
}

/** The columns of the list. */
export const VERSIONS_COLUMNS = { kept: 'Kept', size: 'Size', kind: 'Kind' } as const;

/** The `Shown as` column of P3.3.3. */
export const REASON_SHOWN_AS: Readonly<Record<VersionReason, string>> = {
  saved: 'Saved',
  opened: 'As opened',
  'before-import': 'Before import',
  'before-restore': 'Before restore',
  'before-replace': 'Before replace',
  'before-delete': 'Before delete',
};

/** The heading of the comparison's right side; the left one is the version's date. */
export const NOW_HEADING = 'Now';

/** The buttons. */
export const RESTORE_BUTTON = 'Restore';
export const OPEN_AS_NEW_BUTTON = 'Open as New Document';
export const CLOSE_BUTTON = 'Close';

/** Title of Restore's messages and questions. */
export const RESTORE_TITLE = 'Restore';

/** Empty states, by the reason of `untracked` (P3.3.8, P4.4). */
export const NO_VERSIONS_YET =
  'No earlier versions are kept for this file yet. A version is kept each time you save it.';
export const NOT_KEPT_GENERATED =
  'Earlier versions are not kept for listing and S-record files: Assemble makes them again.';
export const NOT_KEPT_LARGE_OR_BINARY =
  'Earlier versions are not kept for files larger than 1 MB or for files that are not text.';
export const NOT_KEPT_GIT = 'Earlier versions are not kept for files in a .git folder.';

/** Above the list while the `history` switch is off (P3.3.8). */
export const SWITCHED_OFF_LINE =
  'Keeping earlier versions is switched off (Options > Port Additions...). Versions kept before are listed below.';

/** The accessible names of the list and the comparison (not given by the document; errata N4). */
export const VERSIONS_LIST_LABEL = 'Earlier versions';
export const COMPARISON_LABEL = 'Comparison of the selected version with the file now';

/* ---- Trash (P3.3.8) ---- */

export const TRASH_TITLE = 'Trash';

/** The columns. */
export const TRASH_COLUMNS = { name: 'Name', wasIn: 'Was in', why: 'Why', when: 'When', size: 'Size' } as const;

/** The `Why` column, from the item's `cause`. */
export const CAUSE_SHOWN_AS = { deleted: 'Deleted', replaced: 'Replaced' } as const;

/** The buttons. */
export const DELETE_FOR_GOOD_BUTTON = 'Delete for Good';
export const EMPTY_TRASH_BUTTON = 'Empty Trash';

/**
 * `Delete the 2 selected items for good?` (`Yes`, `No`). The document gives the plural only; one
 * item reads `Delete the selected item for good?` (errata N4).
 */
export function deleteForGoodQuestion(count: number): string {
  return count === 1 ? 'Delete the selected item for good?' : `Delete the ${count} selected items for good?`;
}

/**
 * `Delete everything in the Trash for good? (12 items, 1.4 MB)` (`Yes`, `No`). `size` is written by
 * formatSize (core/history/size.ts). One item reads `(1 item, ...)` (errata N4).
 */
export function emptyTrashQuestion(count: number, size: string): string {
  return `Delete everything in the Trash for good? (${count} ${count === 1 ? 'item' : 'items'}, ${size})`;
}

/** Empty state of the Trash. */
export const TRASH_EMPTY =
  'The Trash is empty. Files you delete in the Files panel stay here for up to 30 days; when the Trash is full, the oldest go first.';

/** The accessible name of the list (not given by the document; errata N4). */
export const TRASH_LIST_LABEL = 'Items in the Trash';

/** `<detail>` of P3.3.7 when the store gives none. */
export const UNKNOWN_DETAIL = 'no detail is known';
