// Every message box, file-dialog filter and name of the document commands, with the original's
// exact texts (editor-ui §6, §16; ARCHITECTURE.md 3.8.6, 3.9.3, 3.9.4). Two consecutive spaces and
// the original's punctuation are intentional (section 0, rule 7).
//
// Titles: the original shows these through VCL's MessageDlg, whose title is the name of the icon
// type (mtConfirmation "Confirm", mtError "Error", mtInformation "Information", mtWarning
// "Warning").
//
// Owner: E1.

import type { FileFilter, MessageBoxRequest } from '../../contracts';

/** editor-ui §6.2 step 1, mainS.cpp:278. */
export const FILE_ACCESS_ERROR =
  'File Access Error.  Please verify the file name and that you have the proper permissions to open the file.';

/** The internal exception message of TTextStuff::LoadFile (textS.cpp:202). */
export const LOAD_FILE_ERROR = 'Error in LoadFile()';

export function fileAccessError(): MessageBoxRequest {
  return { title: 'Error', text: FILE_ACCESS_ERROR, icon: 'error', buttons: ['OK'] };
}

export function loadFileError(): MessageBoxRequest {
  return { title: 'Information', text: LOAD_FILE_ERROR, icon: 'information', buttons: ['OK'] };
}

/** editor-ui §6.2 step 2, mainS.cpp:291-292: `<file name> is already open. ...` (Yes / No). */
export function alreadyOpenQuestion(name: string): MessageBoxRequest {
  return {
    title: 'Confirm',
    text: `${name} is already open. Do you want to discard changes and reopen?`,
    icon: 'confirmation',
    buttons: ['Yes', 'No'],
  };
}

/** editor-ui §6.6, textS.cpp:934-936 (Yes / No / Cancel). */
export function closeQuestion(name: string): MessageBoxRequest {
  return {
    title: 'Confirm',
    text: `File modified, do you wish to save '${name}' before closing?`,
    icon: 'confirmation',
    buttons: ['Yes', 'No', 'Cancel'],
  };
}

/** editor-ui §6.5, textS.cpp:1004-1005 (Yes / No). */
export function reloadQuestion(name: string): MessageBoxRequest {
  return {
    title: 'Confirm',
    text: `${name} is modified. Do you want to discard changes and reopen?`,
    icon: 'confirmation',
    buttons: ['Yes', 'No'],
  };
}

/** ARCHITECTURE.md 3.8.6 rule 3: the file changed in storage since it was loaded or saved (Yes / No). */
export function changedOutsideQuestion(name: string): MessageBoxRequest {
  return {
    title: 'Confirm',
    text: `'${name}' has been changed outside this window. Save anyway?`,
    icon: 'confirmation',
    buttons: ['Yes', 'No'],
  };
}

/** ARCHITECTURE.md 3.9.3: characters without a Windows-1252 byte (OK / Cancel). */
export function unmappableQuestion(count: number): MessageBoxRequest {
  return {
    title: 'Warning',
    text: `This file contains ${count} characters that EASy68K cannot store. They will be saved as "?".`,
    icon: 'warning',
    buttons: ['OK', 'Cancel'],
  };
}

/**
 * A file could not be written. The original leaves this to the VCL, which shows the exception's
 * message (EFCreateError, `Cannot create file "<name>"`) and keeps the document modified
 * (editor-ui §6.4). The port names the file the same way and adds the reason it was given.
 */
export function writeError(path: string, reason: string): MessageBoxRequest {
  const text = reason ? `Cannot create file "${path}". ${reason}` : `Cannot create file "${path}".`;
  return { title: 'Error', text, icon: 'error', buttons: ['OK'] };
}

/** ARCHITECTURE.md 3.9.4, the drafts of a window that is gone. Buttons `Restore` and `Discard`. */
export function draftsText(names: readonly string[]): string {
  return `Unsaved changes from your last session were found for ${names.join(', ')}.`;
}

/** The title of the drafts dialog (port addition). */
export const DRAFTS_TITLE = 'EASy68K';

/** Open dialog (editor-ui §6.2, mainS.dfm:223-231): title `Open File`, five filters, first preselected. */
export const OPEN_TITLE = 'Open File';
export const OPEN_FILTERS: readonly FileFilter[] = [
  { label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] },
  { label: '68K Source  [.ASM] [.M68]', patterns: ['*.ASM', '*.M68'] },
  { label: 'EASy68K Listing  [.L68]', patterns: ['*.L68'] },
  { label: '68K S Record  [.S68]', patterns: ['*.S68'] },
  { label: 'Any File  [*.*]', patterns: ['*.*'] },
];

/**
 * Save dialog (editor-ui §6.4, mainS.dfm:232-237). The original's TSaveDialog has no title of its
 * own, so Windows shows `Save As`. A name typed without an extension gets `.X68` when the first
 * filter is selected (1.4 note 1); `defaultExt` carries it with its dot.
 */
export const SAVE_TITLE = 'Save As';
export const SAVE_FILTERS: readonly FileFilter[] = [
  { label: '68K Source File  [.X68]', patterns: ['*.X68'] },
  { label: 'Any File  [*.*]', patterns: ['*.*'] },
];
export const SAVE_DEFAULT_EXT = '.X68';
