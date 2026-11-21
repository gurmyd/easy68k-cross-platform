// The texts and rules of the logging interface (ARCHITECTURE.md 2.6, 2.7; sim-ui §13.2, §13.3),
// as plain data and functions, so that they can be tested under Node.
//
// Owner: U4.

import type { LogDialogValues, LogState } from '../../contracts';

/** Dialog ids (2.7). `sim.logFileExists` is opened by the simulator session (features/run). */
export const LOG_OUTPUT_DIALOG_ID = 'sim.logOutput';
export const LOG_FILE_EXISTS_DIALOG_ID = 'sim.logFileExists';

/** The Log Output dialog (`logU.dfm`). */
export const LOG_OUTPUT_TITLE = 'Log Output';
export const EXEC_NAME_LABEL = 'Execution Log File Name:';
export const OUTPUT_NAME_LABEL = 'Output Log File Name:';
export const EXEC_TYPE_TITLE = 'Execution Log Type';
export const OUTPUT_TYPE_TITLE = 'Output Log Type';
export const MEM_RANGE_TITLE = 'Memory Range to Log';
export const MEM_FROM_LABEL = 'From:';
export const MEM_BYTES_LABEL = 'Bytes';
export const EXEC_TYPE_ITEMS = [
  'Disabled',
  'Instruction only',
  'Instruction and Registers',
  'Instruction, Registers and Memory',
] as const;
export const OUTPUT_TYPE_ITEMS = ['Disabled', 'Text Only'] as const;
/** The folder buttons' Save dialogs (`ELogSaveDlg`, `OLogSaveDlg`). */
export const SAVE_DIALOG_TITLE = 'Save As';
export const SAVE_FILTER = { label: 'Text File', patterns: ['*.txt'] };
export const EXEC_SAVE_NAME = 'EASy68kELog.txt';
export const OUTPUT_SAVE_NAME = 'EASy68kOLog.txt';
/** `MemFromExit` (logU.cpp:269-275): a From address at or above MEMSIZE. */
export const INVALID_ADDRESS_TEXT = 'Invalid Address';
export const INVALID_ADDRESS_TITLE = 'Information';
export const MEMSIZE = 0x01000000;

/** The `Log File Options` question (`LogfileDialogu.dfm`, logU.cpp:116 and 162). */
export const LOG_FILE_OPTIONS_TITLE = 'Log File Options';
export function fileExistsMessage(kind: 'exec' | 'output'): string {
  return kind === 'exec' ? 'Execution Log File exists!' : 'Output Log File exists!';
}

/** The box after a file that cannot be opened (logU.cpp:133, 179; `Error number %d` of a NULL FILE*). */
export const OPEN_ERROR_TITLE = 'Error';
export function openErrorText(kind: 'exec' | 'output'): string {
  return kind === 'exec' ? "Can't open log file. Check log file name., Error number 0" : "Can't open log file, error 0";
}

/** The Log panel (2.6): file names, state and the last lines of each file. */
export const LOG_PANEL_LINES = 200;
export const LOG_PANEL_LOGGING = 'Logging';
export const LOG_PANEL_STOPPED = 'Stopped';

/** The two hex fields of `Memory Range to Log`: `aaaaaaaa;0;0` and `aa;0;0`. */
export const MEM_FROM_FIELD = { kind: 'hex', width: 8 } as const;
export const MEM_BYTES_FIELD = { kind: 'hex', width: 2 } as const;

/** What the Log Output dialog edits: the six values of `LogDialogValues`, the numbers as field text. */
export interface LogDialogDraft {
  execFileName: string;
  outputFileName: string;
  execType: LogState['execType'];
  outputType: LogState['outputType'];
  memFromText: string;
  memBytesText: string;
}

const hex = (value: number, digits: number): string =>
  (value >>> 0).toString(16).toUpperCase().padStart(digits, '0').slice(-digits);

/** The draft the dialog starts from: the service's current values. */
export function draftOf(state: LogDialogValues): LogDialogDraft {
  return {
    execFileName: state.execFileName,
    outputFileName: state.outputFileName,
    execType: state.execType,
    outputType: state.outputType,
    memFromText: hex(state.memFrom, 8),
    memBytesText: hex(state.memBytes & 0xff, 2),
  };
}

/** A hex field's text as a number (`StrToInt("0x" + EditText)`); blanks and empty text are 0. */
export function hexValue(text: string): number {
  const digits = text.replace(/[^0-9A-Fa-f]/g, '');
  return digits === '' ? 0 : parseInt(digits, 16) >>> 0;
}

/** True when leaving `From` shows `Invalid Address` (address < 0 or >= MEMSIZE). */
export function isInvalidLogAddress(text: string): boolean {
  return hexValue(text) >= MEMSIZE;
}

/** The values OK hands to `LogService.applyDialog`. */
export function valuesOf(draft: LogDialogDraft): LogDialogValues {
  return {
    execFileName: draft.execFileName,
    outputFileName: draft.outputFileName,
    execType: draft.execType,
    outputType: draft.outputType,
    memFrom: hexValue(draft.memFromText),
    memBytes: hexValue(draft.memBytesText),
  };
}

/** `Memory Range to Log` is visible only while item 3 is selected (logU.cpp:247-254). */
export function memRangeVisible(execType: number): boolean {
  return execType === 3;
}

/** The folder of a path of the port ("/browser/work/p_RunLog.txt" -> "/browser/work"), or null. */
export function folderOf(name: string): string | null {
  if (!name.startsWith('/') || name.endsWith('/')) return null;
  const slash = name.lastIndexOf('/');
  return slash <= 0 ? null : name.slice(0, slash);
}
