// Every text a person reads in Options > Port Additions... (ARCHITECTURE-PLUS P3.5), copied from
// the document character by character, and the functions that put figures into them. Code and tests
// use these constants. Owner: N7.

import { CLEARING_SITE_DATA as HISTORY_CLEARING_SITE_DATA } from '../../core/history/texts';
import { formatSize } from '../../core/history/size';

/** The dialog's id in the dialog host (P3.5). */
export const ADDITIONS_DIALOG_ID = 'plus.options';

/** The command that opens it (P3.6). */
export const ADDITIONS_COMMAND = 'app.additions.options';

/** Title bar (P3.5). */
export const ADDITIONS_TITLE = 'Port Additions';

/** The two boxes, `AppSettings.plus.viewer` and `.history` (P3.5, P4.2). */
export const VIEWER_CAPTION = '&Show PDF files and pictures in a viewer instead of as text';
export const HISTORY_CAPTION = '&Keep earlier versions of saved files and a Trash for deleted files';

/** The group (P3.5). */
export const STORAGE_GROUP_CAPTION = 'Storage';

/** The labels of the three figures (P3.5). */
export const MY_PROGRAMS_LABEL = 'My Programs:';
export const EARLIER_VERSIONS_LABEL = 'Earlier versions:';
export const TRASH_LABEL = 'Trash:';

/** P3.5, P3.3.7: what clearing the site's data removes (one text with core/history/texts.ts). */
export const CLEARING_SITE_DATA = HISTORY_CLEARING_SITE_DATA;

/** P3.5, desktop app: in place of the browser's last two lines of the group. */
export const DESKTOP_STORAGE_LINE = "Earlier versions and Trash are kept in the app's own storage.";

/** The buttons (P3.5). They act at once, not on OK. */
export const EMPTY_TRASH_CAPTION = 'Empty Trash';
export const DELETE_VERSIONS_CAPTION = 'Delete Earlier Versions';
export const OK_CAPTION = 'OK';
export const CANCEL_CAPTION = 'Cancel';

/** P3.5: the question of `Delete Earlier Versions` (`Yes`, `No`). */
export const DELETE_VERSIONS_QUESTION =
  'Delete all earlier versions of all files for good? Your current files are not affected.';

/** P3.3.8: the empty state of the Trash, said when `Empty Trash` finds nothing to delete (errata N7). */
export const TRASH_EMPTY_TEXT =
  'The Trash is empty. Files you delete in the Files panel stay here for up to 30 days; when the Trash is full, the oldest go first.';

/** `<n> <word>s`, with the singular for one (errata N7: P3.5 shows only plurals). */
function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** P3.3.8: the question of `Empty Trash` (`Yes`, `No`): `... for good? (12 items, 1.4 MB)`. */
export function emptyTrashQuestion(items: number, bytes: number): string {
  return `Delete everything in the Trash for good? (${count(items, 'item')}, ${formatSize(bytes)})`;
}

/** P3.5: `37 files, 3.4 MB`. */
export function filesFigure(files: number, bytes: number): string {
  return `${count(files, 'file')}, ${formatSize(bytes)}`;
}

/** P3.5: `212 versions, 0.9 MB`. */
export function versionsFigure(versions: number, bytes: number): string {
  return `${count(versions, 'version')}, ${formatSize(bytes)}`;
}

/** P3.5: `4 items, 0.3 MB`. */
export function trashFigure(items: number, bytes: number): string {
  return `${count(items, 'item')}, ${formatSize(bytes)}`;
}

/**
 * P3.5: `This site uses 7.9 MB in this browser, about 1.8 GB free`. Without a quota in the estimate
 * the free part is left out (errata N7); without an estimate the line is not shown at all (P3.2.6).
 */
export function siteUsageLine(usage: number, free: number | null): string {
  const used = `This site uses ${formatSize(usage)} in this browser`;
  return free === null ? used : `${used}, about ${formatSize(Math.max(0, free))} free`;
}
