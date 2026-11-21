// The tab model of the editor (editor-ui §8.1-§8.3, §7.2; ARCHITECTURE.md 2.4, 1.4 note 12). Owner: E2.
//
// EASy68K's tab stops are unlike any other editor's, and students' files depend on them:
//
//   Assembly tabs   stops at the 0-based columns 12, 20 and 44 (label, opcode, operand, comment
//                   fields; asm.h TAB1..TAB3), then every multiple of the document's fixed tab size
//                   beyond 44;
//   Fixed tabs      stops at every multiple of the document's tab size.
//
// Three different rules use these stops, and they must not be confused:
//
//   1. DISPLAY of a tab character (editor-ui §8.3; 2.4): the character reaches the next stop after
//      the column it starts in. `nextTabStop()`.
//   2. The TAB KEY with Real Tabs off (note 12 of ARCHITECTURE.md 1.4): blanks up to the next stop
//      (12 > 20 > 44 > next multiple of the fixed size). The original inserts NOTHING at columns 12,
//      20 and 44 or beyond (its `<=` rule, `originalTabSpaces()` below); the port advances instead.
//      This changes only what is typed, never how a file is assembled or listed. `tabKeySpaces()`.
//   3. The LISTING and PRINTING expansion of the original (editor-ui §8.1, LISTING.CPP:132-150): the
//      `<=` rule. The assembler engine applies it itself; `originalTabSpaces()` is kept here as the
//      reference for tests and for the print package (E6), which needs the same rule.
//
// Shift+Tab (note 12) deletes the blanks before the caret back to the previous stop.
//
// Columns are 0-based character columns; a tab character occupies the columns up to its stop.

import { TabType } from '../../contracts';

/** The Assembly tab stops of the original (asm.h:236-238). */
export const TAB1 = 12;
export const TAB2 = 20;
export const TAB3 = 44;

/** The tab size used for display when a document's size is 0 or negative (editor-ui §8.3). */
export const FALLBACK_TAB_SIZE = 8;

export interface TabSettings {
  tabType: TabType;
  /** The document's fixed tab size (`DocumentState.tabSize`). */
  tabSize: number;
}

/** The size used for stops: the document's size, or 8 when that is not a positive integer. */
export function effectiveTabSize(tabSize: number): number {
  return Number.isInteger(tabSize) && tabSize > 0 ? tabSize : FALLBACK_TAB_SIZE;
}

/** The first stop after `column` (column >= 0). */
export function nextTabStop(column: number, settings: TabSettings): number {
  const size = effectiveTabSize(settings.tabSize);
  if (settings.tabType === TabType.Assembly) {
    if (column < TAB1) return TAB1;
    if (column < TAB2) return TAB2;
    if (column < TAB3) return TAB3;
    // Beyond 44: the multiples of the fixed size (editor-ui §8.3, ARCHITECTURE.md 2.4).
    return (Math.floor(column / size) + 1) * size;
  }
  return (Math.floor(column / size) + 1) * size;
}

/** The last stop before `column`, or 0 (column 0 counts as a stop for this purpose). */
export function previousTabStop(column: number, settings: TabSettings): number {
  if (column <= 0) return 0;
  const size = effectiveTabSize(settings.tabSize);
  if (settings.tabType === TabType.Assembly) {
    if (column <= TAB1) return 0;
    if (column <= TAB2) return TAB1;
    if (column <= TAB3) return TAB2;
    const multiple = Math.floor((column - 1) / size) * size;
    return multiple > TAB3 ? multiple : TAB3;
  }
  return Math.floor((column - 1) / size) * size;
}

/**
 * The visual column at `offset` characters into `line` (0-based): ordinary characters advance one
 * column, a tab character advances to the next stop. This is the "true visual column" the status
 * bar shows (ARCHITECTURE.md 1.4 note 17 and editor-ui §19.3, which replace the original's
 * count-the-tabs rule of §7.2), and the column the Tab key works from.
 */
export function visualColumn(line: string, offset: number, settings: TabSettings): number {
  let column = 0;
  const end = Math.min(offset, line.length);
  for (let i = 0; i < end; i++) {
    column = line.charCodeAt(i) === 9 ? nextTabStop(column, settings) : column + 1;
  }
  return column;
}

/** The widths (in columns) of the tab characters of `line`, in order. */
export function tabWidths(line: string, settings: TabSettings): number[] {
  const widths: number[] = [];
  let column = 0;
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) === 9) {
      const stop = nextTabStop(column, settings);
      widths.push(stop - column);
      column = stop;
    } else {
      column++;
    }
  }
  return widths;
}

/**
 * The number of blanks the Tab key inserts at visual column `column` with Real Tabs off
 * (note 12): up to the next stop. Fixed tabs with a size that is not positive insert nothing, as
 * in the original (editor-ui §8.2: the modulo fails and the exception is swallowed).
 */
export function tabKeySpaces(column: number, settings: TabSettings): number {
  if (settings.tabType === TabType.Fixed && !(Number.isInteger(settings.tabSize) && settings.tabSize > 0)) return 0;
  return nextTabStop(column, settings) - column;
}

/**
 * The original's spaces-for-a-tab rule (editor-ui §8.1), used by its Tab key, its printing and
 * the assembler's listing. With Assembly tabs it gives 0 at columns 12 and 20 and 0 or less at 44
 * and beyond (the result is clamped to 0 here: no space is produced). Fixed tabs with a size that
 * is not positive give 0.
 */
export function originalTabSpaces(column: number, settings: TabSettings): number {
  if (settings.tabType === TabType.Assembly) {
    let t: number;
    if (column <= TAB1) t = TAB1 - column;
    else if (column <= TAB2) t = TAB2 - column;
    else t = TAB3 - column;
    return Math.max(t, 0);
  }
  if (!(Number.isInteger(settings.tabSize) && settings.tabSize > 0)) return 0;
  return settings.tabSize - (column % settings.tabSize);
}

/** The stops of a document as the status bar names them: `Assembly tabs` or `Fixed tabs <n>`. */
export function tabModeText(settings: TabSettings): string {
  return settings.tabType === TabType.Assembly ? 'Assembly tabs' : `Fixed tabs ${settings.tabSize}`;
}
