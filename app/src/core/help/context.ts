// What F1 looks up in the editor, and which page each entry point of the help opens.
// ARCHITECTURE.md 9.2 (H1), 1.4 note 10; editor-ui §15.2, §15.3; sim-ui §16.1. Owner: H1.

import { INTRO_PAGE, pageForKeyword, trimControl } from './keywords';

/** The editor's text around the caret, as the original's F1 handler sees it. */
export interface EditorWordContext {
  /** The selected text, '' when nothing is selected. */
  selected: string;
  /** The document text (or the part of it around the caret). */
  text: string;
  /** Caret offset in `text`: the number of characters before the caret (`SelStart`). */
  caret: number;
}

/** The characters `isalnum` accepts in the original's "C" locale. */
function isAlnum(char: string | undefined): boolean {
  return char !== undefined && /^[A-Za-z0-9]$/.test(char);
}

/** The characters `isspace` accepts in the "C" locale. */
function isSpace(char: string | undefined): boolean {
  return char !== undefined && /^[ \t\n\v\f\r]$/.test(char);
}

/**
 * The keyword F1 passes to the help (`textS.cpp:294-312`, editor-ui §15.3), or null when the
 * original does nothing (the caret is at the very start of the text, where its lookup fails).
 *
 *  - A selection: the trimmed selection, whatever it holds.
 *  - No selection and white space before the caret: "INTRO" (not a keyword: the introduction).
 *  - Otherwise: the run of letters and digits around the caret.
 *
 * The original's string indexes are 1-based and `SelStart` counts the characters before the caret,
 * so `Text[SelStart]` is the character immediately before the caret. The word search is written
 * here with the same 1-based indexes, quirks included: the word starts at the character before the
 * caret (whatever it is) and extends left over letters and digits, and the character that ends the
 * text is never part of a word.
 */
export function helpKeywordAt(context: EditorWordContext): string | null {
  if (context.selected !== '') return trimControl(context.selected);
  const { text, caret } = context;
  const at = (index1: number): string | undefined => text[index1 - 1]; // Text[index1] of the original
  if (caret < 1 || caret > text.length) return null;
  if (isSpace(at(caret))) return 'INTRO';
  let start = caret;
  while (start > 1 && isAlnum(at(start - 1))) start--;
  let end = caret + 1;
  while (end < text.length && isAlnum(at(end))) end++;
  return text.slice(start - 1, end - 1);
}

/** The page F1 opens in the editor for this context: the keyword's page, the introduction, or null. */
export function editorHelpPage(context: EditorWordContext): string | null {
  const keyword = helpKeywordAt(context);
  return keyword === null ? null : pageForKeyword(keyword);
}

/**
 * The pages of the entry points that the original sends to the introduction by mistake open the page
 * they were meant for (1.4 note 10, sim-ui §16.1). Paths are those of app/public/help.
 */
export const ENTRY_PAGES = {
  /** Help > Help, F1 on the Editor frame, the table's `INTRO` and `MAIN`. */
  contents: INTRO_PAGE,
  /** Help > Sim68K Help, F1 in the Simulator's main window (`SIM_BASIC`). */
  simulator: 'SIMHELP/BasicOperation.htm',
  /** F1 in the Log Output dialog (`SIM_OPTIONS`). */
  simulatorOptions: 'SIMHELP/SimOptions.htm',
  /** F1 in the Memory panel (`MEMORY`, which the original sends to the assembler's directive). */
  memory: 'SIMHELP/Memory.htm',
  /** F1 in the Stack panel. */
  stack: 'SIMHELP/Stack.htm',
  /** F1 in the Break Points panel. */
  breakpoints: 'SIMHELP/AdvBreakpoints.htm',
  /** F1 in the Hardware panel. */
  hardware: 'SIMHELP/Hardware.htm',
  /** F1 in the Editor Options and Assembler Options dialogs (`EDIT_OPTIONS`). */
  editorOptions: 'options.htm',
  /** Help > Differences from EASy68K (generated from docs/DIFFERENCES.md). */
  differences: 'Port/differences.htm',
} as const;

/** The page F1 opens in Simulator mode while `panel` (a panel id of 2.4, or null) has the focus. */
export function simulatorHelpPage(panel: string | null): string {
  switch (panel) {
    case 'memory':
      return ENTRY_PAGES.memory;
    case 'stack':
      return ENTRY_PAGES.stack;
    case 'breakpoints':
      return ENTRY_PAGES.breakpoints;
    case 'hardware':
      return ENTRY_PAGES.hardware;
    case 'log':
      return ENTRY_PAGES.simulatorOptions;
    default:
      return ENTRY_PAGES.simulator;
  }
}
