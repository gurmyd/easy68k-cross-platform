// The constants and texts of EASyBIN v2.5.0 (docs/porting/easybin.md). Owner: B1.
//
// Every caption and message is the original's, letter for letter (ARCHITECTURE.md 0 rule 7),
// including the misspelt `Error openning`. `\n` is a line break of the message box.

import type { FileFilter } from '../../contracts';

/** The original's version string (def.h:20); the window title and the About box title. */
export const TITLE = 'EASyBIN v2.5.0';
/** Application->Title (EASyBIN.cpp:22): the caption of every ShowMessage box. */
export const APP_TITLE = 'EASyBIN';

/** 16 MB, the 68000's address space (def.h:23). Valid addresses are 0 .. MEMSIZE-1. */
export const MEMSIZE = 0x0100_0000;

/** Character columns of a memory row (Form1u.cpp:29-32): `%08X: ` + 16 x `XX ` + 16 characters. */
export const HEX_LEFT = 10;
export const HEX_RIGHT = 56;
export const ASC_LEFT = 58;
export const ASC_RIGHT = 73;

/** The column header above the rows (Form1u.dfm, Label12); it starts above column 10. */
export const COLUMN_HEADER = '00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 0123456789ABCDEF';

/** The maximum number of data bytes in one S-record written by Save S-Record (fileIO.cpp:376). */
export const SRECDATA = 32;
/** The header record of every S-record EASyBIN writes (fileIO.cpp:417), before `finish`. */
export const S0_HEADER = 'S0210000535245434F5244202020313143524541544544204259204541535942494E';

/** The three items of the split radio group (Form1u.dfm, OutputSplit) and the split they give. */
export const SPLIT_ITEMS = [
  { split: 0, caption: '1 File - All Bytes' },
  { split: 2, caption: '2 Files - Every 2nd Byte' },
  { split: 4, caption: '4 Files - Every 4th Byte' },
] as const;
export type Split = 0 | 2 | 4;

/** Captions of the window (Form1u.dfm). Group captions keep the spaces the group frames need. */
export const CAPTIONS = {
  s68Group: ' S-Record File ',
  startAddress: 'Start Address:',
  lastAddress: 'Last Address:',
  length: 'Length:',
  splitGroup: ' Binary Input/Output Split ',
  binaryGroup: ' Binary File(s) ',
  firstAddress: 'First Address:',
  fileSplit: 'File Split:',
  from: 'From:',
  to: 'To:',
  size: 'Size:',
  copy: 'Copy',
  fill: 'Fill',
  address: 'Address:',
  row: 'Row',
  page: 'Page',
  dollar: '$',
  zeroByte: '00',
} as const;

/** The file dialogs' filters (Form1u.cpp:272, 289, 315, 340), as FS1's dialogs take them. */
export const OPEN_SREC_FILTERS: readonly FileFilter[] = [
  { label: 'EASy68K S-Record [.S68]', patterns: ['*.S68'] },
  { label: 'Motorola S-Record [.S3][.S19]', patterns: ['*.S3', '*.S19'] },
  { label: 'Other S-Record', patterns: ['*.*'] },
];
export const SAVE_SREC_FILTERS: readonly FileFilter[] = [
  { label: 'EASy68K S-Record [.S68]', patterns: ['*.S68'] },
  { label: 'Motorola S-Record [.S3]', patterns: ['*.S3'] },
  { label: 'Other S-Record', patterns: ['*.*'] },
];
export const SAVE_SREC_DEFAULT_EXT = 'S68';
export const OPEN_BINARY_FILTERS: readonly FileFilter[] = [
  { label: 'Binary File [.BIN]', patterns: ['*.BIN'] },
  { label: 'Any File', patterns: ['*.*'] },
];
export const SAVE_BINARY_FILTERS: readonly FileFilter[] = [
  { label: 'Binary File [.BIN]', patterns: ['*.BIN'] },
  { label: 'Other Binary File', patterns: ['*.*'] },
];
export const SAVE_BINARY_DEFAULT_EXT = 'BIN';
/** The original sets no dialog titles; Windows shows these. */
export const OPEN_DIALOG_TITLE = 'Open';
export const SAVE_DIALOG_TITLE = 'Save As';

/** Message texts (docs/porting/easybin.md section 16). */
export const MESSAGES = {
  newCaution: 'The current environment will be lost, click OK to continue.',
  newCautionTitle: 'Caution',
  cannotOpenSrec: (name: string) => `error: cannot open file ${name}`,
  srecLoaded: (s0: string) => `S Record loaded successfully.\n\nS0 description record contains:\n${s0}`,
  addressExceeds: 'ERROR, Address exceeds $FFFFFF\n',
  invalidData: (prefix: string, line: number, raw: string) =>
    `${prefix}Invalid data on line ${line}\n${line}: ${raw}\n\nOpen stopped.`,
  unexpectedSrec: 'Unexpected Error reading S-Record file',
  openingAsBinary: 'Opening as binary file.',
  cannotOpenBinary: (name: string) => `Error openning ${name}`,
  srecConfirm: (from: string, to: string, start: string) =>
    `S-Record file information:\n\nFrom:$${from}  To:$${to}\nStart Address:$${start}\n\nCreate S-Record?`,
  srecConfirmTitle: 'S-Record Creation',
  invalidRange: 'Invalid memory range.',
  invalidRangeTitle: 'Information',
  fileExists: 'File exists! OK to replace?',
  fileExistsTitle: 'Alert',
  errorCreating: (name: string) => `Error creating ${name}`,
  errorSavingBinary: 'Error saving 68K memory to file.',
  errorSavingSrec: 'Error saving S-Record file.',
  invalidCopy: 'Invalid copy range',
  invalidFill: 'Invalid memory range',
} as const;

/** The About box (aboutS.dfm, aboutS.cpp). */
export const ABOUT = {
  windowTitle: 'About EASyBIN',
  title: TITLE,
  comments:
    'The author of this software assumes no liability for its functionality and is not responsible for damages, losses or liabilities as a result of using this software.  Use at your own risk.',
  license: 'EASyBIN is distributed under the GNU general public use license. See Help for more information.',
  copyright: 'By: Chuck Kelly',
  web: 'www.easy68k.com',
  forum: 'Use the EASy68K forum to report undocumented features.',
  ok: 'OK',
} as const;

/** Help pages (help.cpp:24-28, ez68k.ali): `EASyBIN` and `CHUCK`. */
export const HELP_PAGE = 'easybin.htm';
export const CREDITS_PAGE = 'credits.htm';
