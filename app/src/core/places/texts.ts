// The texts a person reads for a place of a file (ARCHITECTURE-PLUS P3.2.5, P4.5). Owner: N0.
//
// Used by display.ts and by the tests; the Files panel (N5) and the editor's status bar (N8) show
// them through placeText and placeShort.

/** After a linked file's name in the status bar and the document tab's tool-tip. */
export const LINKED_SUFFIX = ' - on this computer, edited in place';
/** After a linked file's name in a message. */
export const LINKED_SHORT_SUFFIX = ' (on this computer)';
/** After a path in an opened folder: ` - in the folder "Lab" on this computer`. */
export const folderSuffix = (label: string): string => ` - in the folder "${label}" on this computer`;
/**
 * The linked store's root or one of its internal id folders when the store is not mounted, so that
 * /linked/<id> is never shown (P3.2.5). The same words as the backend's label (LINKED_LABEL in
 * fs/fsaccess-backend.ts, which core may not import).
 */
export const LINKED_FALLBACK_LABEL = 'Linked files';
/**
 * The words before an opened folder's own name in its backend's label: FS2's `folderLabel(name)` in
 * fs/fsaccess-backend.ts (which core may not import) is `Folder: Lab`, and P3.2.5 names the folder
 * `Lab` (docs/requests/N8-folder-place-text.md).
 */
export const FOLDER_LABEL_PREFIX = 'Folder: ';
/** The opened folder's root itself (P3.2.5 gives its secondary text `on this computer`). */
export const FOLDER_ROOT_SUFFIX = ' - on this computer';
