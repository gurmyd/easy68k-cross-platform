// Tab expansion for printing (editor-ui §13.1 step 2, §8.1). Owner: E6.
//
// The original copies the text to print into a temporary edit control and runs `replaceTabs`
// (textS.cpp:498-534) over all of it. Every tab character is replaced by the number of blanks the
// rule of editor-ui §8.1 gives for the column it stands in, with the document's own tab type and
// fixed tab size:
//
//   Assembly tabs:  x <= 12 -> 12 - x;  x <= 20 -> 20 - x;  otherwise 44 - x
//   Fixed tabs:     size - (x % size)
//
// `x` is the column counted by that loop, which starts at 0 on every line (the temporary control
// holds only the printed text, so the first line of a printed selection counts from 0 even when
// the selection began in the middle of a line). Two details of the loop are kept exactly:
//
//   - the number of blanks can be 0 or negative (Assembly tabs at column 12, 20 or 44 and beyond;
//     a negative fixed size): no blank is written, the tab character is still removed, and the
//     column moves by that number (`x += t`), so it can go back;
//   - a fixed size of 0 divides by zero; the original's print job then ends with its error box.
//     `expandTabs` throws `PrintTabSizeError` for it, and only when a tab character is met.

import { TabType } from '../../contracts';

/** Assembly tab stops, 0-based columns (asm.h:236-238). */
export const TAB1 = 12;
export const TAB2 = 20;
export const TAB3 = 44;

/** The fixed tab size was 0 and the text has a tab character (division by zero in the original). */
export class PrintTabSizeError extends Error {
  constructor() {
    super('The fixed tab size is 0: tab characters cannot be expanded');
    this.name = 'PrintTabSizeError';
  }
}

/** The number of blanks a tab at column `x` stands for (editor-ui §8.1); may be 0 or negative. */
export function blanksForTab(x: number, tabType: TabType, tabSize: number): number {
  if (tabType === TabType.Assembly) {
    if (x <= TAB1) return TAB1 - x;
    if (x <= TAB2) return TAB2 - x;
    return TAB3 - x;
  }
  if (tabSize === 0 || !Number.isFinite(tabSize)) throw new PrintTabSizeError();
  const size = Math.trunc(tabSize);
  // C++ `%` keeps the sign of the dividend; JavaScript's `%` does the same.
  return size - (x % size);
}

/**
 * Replaces every tab character of `text` by blanks, as `replaceTabs` does for printing. Lines are
 * separated by "\n" (the documents' line separator); a "\r" counts as a character, as it does in
 * the original's text.
 */
export function expandTabs(text: string, tabType: TabType, tabSize: number): string {
  if (!text.includes('\t')) return text;
  let out = '';
  let x = 0;
  // By UTF-16 unit: the editor's characters (text decoded from Windows-1252 is one unit per byte).
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '\t') {
      const t = blanksForTab(x, tabType, tabSize);
      if (t > 0) out += ' '.repeat(t);
      x += t;
    } else if (ch === '\n') {
      out += ch;
      x = 0;
    } else {
      out += ch;
      x++;
    }
  }
  return out;
}
