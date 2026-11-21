// Every text the Assemble feature shows, verbatim from the original (section 0, rule 7): double
// spaces, trailing spaces and punctuation are intentional.
//
// Sources: editor-ui §7.3 (message list), §10.2 (File Access Error), §10.4 (status dialog), §10.5
// and ERROR.CPP:257-261 (include notice), §4.2 (context menu); ARCHITECTURE.md 4.9 step 5 (the
// port's own text for an assembler that stopped).
//
// Owner: E5.

import type { MessageBoxRequest } from '../../contracts';

/** Column headers of the message list (textS.dfm:97-124): note the trailing space of `Line `. */
export const LINE_HEADER = 'Line ';
export const MESSAGE_HEADER = 'Error Message';
/** Port addition (1.3.3): shown only when a row belongs to another file than the document's. */
export const FILE_HEADER = 'File';
/** The message list's tool-tip (textS.dfm). */
export const MESSAGES_HINT = 'double click error to highlight in source';
/** Accessible name of the message list (port). */
export const MESSAGES_LABEL = 'Assembler messages';

/** The title of the status dialog (assembleS.cpp:60): `Assembler Status - <file name>`. */
export function statusTitle(fileName: string): string {
  return `Assembler Status - ${fileName}`;
}
/** The two labels of the status dialog (assembleS.dfm Label1, Label2). */
export const WARNINGS_LABEL = 'Warnings:';
export const ERRORS_LABEL = 'Errors:';
/** The three buttons, left to right (assembleS.dfm:117-144). */
export const EXECUTE_CAPTION = '&Execute';
export const LOAD_L68_CAPTION = '&Load L68';
export const CLOSE_CAPTION = '&Close';

/** mainS.cpp:383, MessageDlg(..., mtError): the title of an mtError box is `Error`. */
export const WRITE_ERROR_TEXT =
  'File Access Error.  Please verify that you have write permission to the folder where the selected file is located.';
export function writeErrorBox(): MessageBoxRequest {
  return { title: 'Error', text: WRITE_ERROR_TEXT, icon: 'error', buttons: ['OK'] };
}

/**
 * ERROR.CPP:257-261: ShowMessage, whose title is Application->Title (`EASy68K`, EDIT68K.cpp:24) and
 * which has no icon. Shown once per assembly, for the first message of an include file that is open
 * and modified.
 */
export function includeNoticeBox(fileName: string): MessageBoxRequest {
  return {
    title: 'EASy68K',
    text:
      `An Error occurred in the included file ${fileName}.` +
      '\nThe file is currently open and has been modified.' +
      '\nThe line numbers of errors may not be correct.',
    icon: 'none',
    buttons: ['OK'],
  };
}

/** ARCHITECTURE.md 4.9 step 5: the row the Messages panel shows when the assembler stopped. */
export function stoppedText(fatal: string): string {
  return `The assembler stopped: ${fatal}`;
}

/** A message box the assembler itself raised (AsmResult.dialogs): the caption is the original's. */
export function engineBox(caption: string, text: string): MessageBoxRequest {
  // The engine's boxes (`Error creating temp file.`, `Unable to create listing file`, ...) are
  // titled `Error` (editor-ui §16) and show the error icon; any other caption gets none.
  return { title: caption, text, icon: caption === 'Error' ? 'error' : 'none', buttons: ['OK'] };
}

/** The context menu of the message list (editor-ui §4.2). */
export const CLEAR_MESSAGES_CAPTION = '&Clear Error Messages';
