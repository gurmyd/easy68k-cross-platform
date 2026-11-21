// File filters and file names of the file dialogs (ARCHITECTURE.md 3.8.5; editor-ui §6.2, §6.4;
// sim-ui §8.3). Plain functions, tested under Node.
//
// The filters of the original's dialogs are written here exactly as the original shows them. The
// commands that open the dialogs (E1: ed.file.open, ed.file.saveAs; SH8: sim.file.open) pass
// their own copy in the OpenRequest or SaveRequest, because a feature may not import another
// feature (3.1); these constants are the reference those copies are checked against.
//
// Owner: FS1.

import type { FileFilter, SaveRequest } from '../../contracts';
import { extractFileExt, foldCase } from '../../core/paths/winpath';

/** Open File in Editor mode (editor-ui §6.2, mainS.dfm:223-231); the first is preselected. */
export const EDITOR_OPEN_FILTERS: readonly FileFilter[] = [
  { label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] },
  { label: '68K Source  [.ASM] [.M68]', patterns: ['*.ASM', '*.M68'] },
  { label: 'EASy68K Listing  [.L68]', patterns: ['*.L68'] },
  { label: '68K S Record  [.S68]', patterns: ['*.S68'] },
  { label: 'Any File  [*.*]', patterns: ['*.*'] },
];

/** Save As in Editor mode (editor-ui §6.4, mainS.dfm:232-237). */
export const EDITOR_SAVE_FILTERS: readonly FileFilter[] = [
  { label: '68K Source File  [.X68]', patterns: ['*.X68'] },
  { label: 'Any File  [*.*]', patterns: ['*.*'] },
];

/** The original's DefaultExt of both editor dialogs, malformed as it is (editor-ui §6.2, §6.4). */
export const EDITOR_DEFAULT_EXT = '*.X68';

/** File > Open and Open Data in Simulator mode (sim-ui §8.3, SIM68Ku.dfm:2238; section 5.4). */
export const SIM_OPEN_FILTERS: readonly FileFilter[] = [
  { label: 'EASy68K S-Record (*.S68)', patterns: ['*.S68'] },
  { label: 'All Files (*.*)', patterns: ['*.*'] },
];

/** The title and text of the overwrite question (editor-ui §6.4, mainS.cpp:188; MB_YESNO, no icon). */
export const OVERWRITE_TITLE = 'Caution!';
export const OVERWRITE_TEXT = 'File exists! OK to overwrite?';

/**
 * Windows filters as a 68000 program gives them to task 58 ("Text|*.txt|All|*.*"): description
 * and pattern list alternate; patterns are separated by ';'. An empty or malformed string gives
 * one "All Files" filter.
 */
export function parseWindowsFilter(filter: string): FileFilter[] {
  const parts = filter.split('|');
  const out: FileFilter[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const patterns = (parts[i + 1] as string)
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    if (patterns.length > 0) out.push({ label: parts[i] as string, patterns });
  }
  return out.length > 0 ? out : [{ label: 'All Files (*.*)', patterns: ['*.*'] }];
}

function patternToRegExp(pattern: string): RegExp {
  // Windows: '*.*' matches every name, also one without a dot; '?' is one character.
  if (pattern === '*.*' || pattern === '*') return /^.*$/su;
  let source = '';
  for (const ch of foldCase(pattern)) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'su');
}

/** True if a file name matches one of the filter's patterns, without regard to letter case. */
export function matchesFilter(name: string, filter: FileFilter | undefined): boolean {
  if (!filter) return true;
  const folded = foldCase(name);
  return filter.patterns.some((pattern) => patternToRegExp(pattern).test(folded));
}

/** The extension a SaveRequest's defaultExt names, with its dot ('*.X68', 'X68', '.X68' -> '.X68'); '' if none. */
export function normalizeDefaultExt(defaultExt: string): string {
  const bare = defaultExt.trim().replace(/^\*?\.?/, '');
  if (bare === '' || /[*?\\/.]/.test(bare)) return '';
  return `.${bare}`;
}

/**
 * The default extension rule of the save dialog (editor-ui §6.4, recommended behaviour): a typed
 * name without an extension gets the request's default extension while the FIRST filter is
 * selected; with another filter the name is taken as typed.
 */
export function applyDefaultExtension(
  name: string,
  request: Pick<SaveRequest, 'defaultExt'>,
  filterIndex: number,
): string {
  if (filterIndex !== 0 || extractFileExt(name) !== '') return name;
  const ext = normalizeDefaultExt(request.defaultExt);
  return ext === '' ? name : name + ext;
}

/** The value of an <input type="file" accept="..."> for a filter ('' = anything). */
export function acceptFor(filter: FileFilter | undefined): string {
  if (!filter) return '';
  const exts: string[] = [];
  for (const pattern of filter.patterns) {
    const match = /^\*(\.[^*?.]+)$/.exec(pattern);
    if (!match) return '';
    exts.push((match[1] as string).toLowerCase());
  }
  return exts.join(',');
}

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Why a file or folder name cannot be used, or null if it can. The browser store could keep more,
 * but the files must be exportable to Windows and work there (5.9), so Windows' rules apply.
 */
export function invalidNameReason(name: string): string | null {
  if (name.trim() === '') return 'A name is required.';
  if (/[\\/:*?"<>|]/.test(name)) return 'A name cannot contain any of these characters: \\ / : * ? " < > |';
  // eslint-disable-next-line no-control-regex -- control characters are what this looks for
  if (/[\u0000-\u001f]/.test(name)) return 'A name cannot contain control characters.';
  if (/[ .]$/.test(name)) return 'A name cannot end with a space or a period.';
  if (RESERVED.test(name)) return `"${name}" is a name Windows reserves for a device.`;
  if (name.length > 255) return 'A name can be at most 255 characters long.';
  return null;
}
