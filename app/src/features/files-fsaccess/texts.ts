// The texts of the File System Access additions. "Open folder...", "From this computer...",
// "Open this folder?" and "Open the containing folder..." are quoted in ARCHITECTURE.md 3.8.2 and
// 3.8.5; the others are the port's own (docs/porting/errata/FS2.md).
//
// Owner: FS2.

/** The button of the file dialogs that opens a folder of this computer (3.8.5). */
export const OPEN_FOLDER_LABEL = 'Open folder...';
/** The button of the Open dialog that opens files of this computer, linked (3.8.1, 3.8.2). */
export const FROM_COMPUTER_LABEL = 'From this computer...';
/** The question for a folder dropped on the window (3.8.5); the title is the folder's name. */
export const DROPPED_FOLDER_QUESTION = 'Open this folder?';
/** The action of the banner of a linked file (3.8.2). */
export const OPEN_CONTAINING_FOLDER = 'Open the containing folder...';
/** Title of the message boxes of this feature. */
export const FOLDER_TITLE = 'Open folder';

export const FSACCESS_TEXTS = {
  /** Toast at start: the folder of the last visit, which the browser asks about again. */
  reopen: (name: string) => `The folder "${name}" was open the last time. Open it again?`,
  reopenAction: 'Open folder',
  /** The browser (or the student) refused access. */
  notAllowed: (name: string) =>
    `The browser did not allow this page to use the folder "${name}". Nothing in it has been changed.`,
  /** Another folder cannot be opened while files of the open one are in use. */
  inUse: (name: string, what: string) =>
    `Only one folder can be open at a time. Close what is open from "${name}" first (${what}), ` +
    'then open the other folder.',
  /** The banner of a newly linked file (3.8.2). */
  linked: (name: string) =>
    `"${name}" is opened from this computer: Save writes to that file. The listing and the files a ` +
    'program writes stay in the browser. To keep them beside the file, open its folder.',
  /** After "Open the containing folder...": the document now comes from the folder. */
  moved: (name: string, folder: string) => `"${name}" is now opened from the folder "${folder}".`,
  /** After "Open the containing folder...": a folder that does not hold the file was chosen. */
  notContaining: (name: string, folder: string) =>
    `The folder "${folder}" is open now, but "${name}" is not in it, so the document stays linked to the file.`,
  /** A picker failed for another reason than Cancel. */
  pickerFailed: (detail: string) => `The browser could not show its file chooser (${detail}).`,
} as const;
