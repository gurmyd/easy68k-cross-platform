// The editing rules of EASy68K's editor that a stock code editor does not have, as pure functions
// from an EditorState to a transaction (editor-ui §8.2, §8.4-§8.6; ARCHITECTURE.md 2.4, 1.4 notes 5,
// 6, 12). Owner: E2.
//
// Each function returns the TransactionSpec the editor dispatches, or null when the key or command
// does nothing. They need no DOM, so the unit tests check them transaction by transaction.
//
//   tabKey            Tab (and nothing else) - blanks to the next stop, or one tab character with
//                     Real Tabs on
//   shiftTabKey       Shift+Tab - delete the blanks before the caret back to the previous stop
//   enterKey          Enter - a plain line break; autoIndentAfterEnter then fills an empty new line
//                     with the leading white space of the line the caret was on (a separate step)
//   insertInSelection / deleteFromSelection - Comment, Uncomment, Indent, Outdent (editor-ui §8.5)
//   overwriteInput    typing in Replace mode (editor-ui §8.6)

import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { tabKeySpaces, previousTabStop, visualColumn, type TabSettings } from './tab-model';

export interface TabKeyOptions extends TabSettings {
  /** The global Real Tabs option (editor-ui §8.2). */
  realTabs: boolean;
}

/** Each of these commands is one undo step of its own, never merged with typing (editor-ui §8.9). */
const ONE_STEP = isolateHistory.of('full');

/**
 * Tab (editor-ui §8.2, note 12).
 *
 * Real Tabs off: blanks are inserted at the END of the selection, up to the next stop of the
 * document's tab model counted from the true visual column there; the selection is dropped and the
 * caret ends after the blanks (with a selection the original neither deletes nor indents it). No
 * tab character is ever stored. Where the next stop is the column itself nothing is inserted (Fixed
 * tabs with a size that is not positive) but the selection is still dropped.
 *
 * Real Tabs on: one tab character replaces the selection, as the edit control does.
 */
export function tabKey(state: EditorState, options: TabKeyOptions): TransactionSpec {
  const range = state.selection.main;
  if (options.realTabs) {
    return {
      changes: { from: range.from, to: range.to, insert: '\t' },
      selection: EditorSelection.cursor(range.from + 1),
      scrollIntoView: true,
      userEvent: 'input.type',
    };
  }
  const at = range.to;
  const line = state.doc.lineAt(at);
  const column = visualColumn(line.text, at - line.from, options);
  const count = tabKeySpaces(column, options);
  return {
    changes: count > 0 ? { from: at, insert: ' '.repeat(count) } : [],
    selection: EditorSelection.cursor(at + count),
    scrollIntoView: true,
    userEvent: 'input.type',
    annotations: ONE_STEP,
  };
}

/**
 * Shift+Tab (note 12): deletes the blanks immediately before the caret, back to the previous stop
 * of the tab model (never past a character that is not a blank). With a selection the caret is
 * its end, and the selection is dropped, as for Tab. Null when there is nothing to delete.
 */
export function shiftTabKey(state: EditorState, settings: TabSettings): TransactionSpec | null {
  const range = state.selection.main;
  const at = range.to;
  const line = state.doc.lineAt(at);
  const offset = at - line.from;
  const column = visualColumn(line.text, offset, settings);
  const target = previousTabStop(column, settings);
  let from = offset;
  // Blanks are one column each, so walking back over blanks lowers the column one by one.
  while (from > 0 && line.text.charCodeAt(from - 1) === 32 && column - (offset - from) > target) from--;
  if (from === offset) {
    if (range.empty) return null;
    return { selection: EditorSelection.cursor(at), scrollIntoView: true };
  }
  return {
    changes: { from: line.from + from, to: at },
    selection: EditorSelection.cursor(line.from + from),
    scrollIntoView: true,
    userEvent: 'delete',
    annotations: ONE_STEP,
  };
}

/** The leading white space (blanks and tabs, as they are) of a line (editor-ui §8.4). */
export function leadingWhiteSpace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? '';
}

/**
 * Enter: the line break replaces the selection, splitting the line at the caret. Plain - no
 * indentation of its own; the auto indent of editor-ui §8.4 follows as a separate change
 * (autoIndentAfterEnter).
 */
export function enterKey(state: EditorState): TransactionSpec {
  const range = state.selection.main;
  return {
    changes: { from: range.from, to: range.to, insert: '\n' },
    selection: EditorSelection.cursor(range.from + 1),
    scrollIntoView: true,
    userEvent: 'input',
  };
}

/**
 * The white space to remember when Enter is pressed: the leading white space of the line the
 * caret is on, wherever the caret is in that line (editor-ui §8.4, key down).
 */
export function whiteSpaceBeforeEnter(state: EditorState): string {
  return leadingWhiteSpace(state.doc.lineAt(state.selection.main.head).text);
}

/**
 * After Enter with Auto Indent on (editor-ui §8.4, key up): if the line the caret is now on is
 * empty, it receives `lead` and the caret ends after it. A separate change and a separate undo
 * step. Null when the line is not empty (Enter split a line) or there is nothing to insert.
 */
export function autoIndentAfterEnter(state: EditorState, lead: string): TransactionSpec | null {
  if (lead.length === 0) return null;
  const line = state.doc.lineAt(state.selection.main.head);
  if (line.length !== 0) return null;
  return {
    changes: { from: line.from, insert: lead },
    selection: EditorSelection.cursor(line.from + lead.length),
    scrollIntoView: true,
    userEvent: 'input.indent',
    annotations: ONE_STEP,
  };
}

/**
 * The lines Comment, Uncomment, Indent and Outdent act on (editor-ui §8.5): from the line that
 * holds the selection's start to the line that holds its LAST SELECTED CHARACTER, so a selection
 * that ends at the very beginning of a line leaves that line out. Without a selection: the caret
 * line (note 6 - the original does nothing at column 0 of any line but the first).
 * Returns 1-based line numbers.
 */
export function affectedLines(state: EditorState): { first: number; last: number } {
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from).number;
  if (range.empty) return { first, last: first };
  const last = state.doc.lineAt(range.to - 1).number;
  return { first, last: Math.max(first, last) };
}

/**
 * The new selection after Comment/Uncomment/Indent/Outdent with a selection (editor-ui §8.5):
 * it starts at the same character offset as before and its length changes by the number of
 * characters added or removed. Without a selection the caret moves with its text (note 6).
 */
function selectionAfter(state: EditorState, delta: number, changes: { from: number; to?: number; insert?: string }[]) {
  const range = state.selection.main;
  if (range.empty) {
    const changeSet = state.changes(changes);
    return EditorSelection.cursor(changeSet.mapPos(range.head, 1));
  }
  const length = Math.max(0, range.to - range.from + delta);
  const docLength = state.doc.length + delta;
  return EditorSelection.range(Math.min(range.from, docLength), Math.min(range.from + length, docLength));
}

/**
 * Comment Selection (`*`) and Indent (one blank): `text` is inserted at column 0 of every
 * affected line, unconditionally (a comment line gets a second `*`). One undo step.
 */
export function insertInSelection(state: EditorState, text: string, userEvent: string): TransactionSpec {
  const { first, last } = affectedLines(state);
  const changes: { from: number; insert: string }[] = [];
  for (let n = first; n <= last; n++) changes.push({ from: state.doc.line(n).from, insert: text });
  return {
    changes,
    selection: selectionAfter(state, changes.length * text.length, changes),
    scrollIntoView: true,
    userEvent,
    annotations: ONE_STEP,
  };
}

/**
 * Uncomment Selection (`*`) and Outdent (one blank): on each affected line the first character is
 * deleted only if it is `text`; only column 0 counts, one character per command. Null when no
 * line starts with it.
 */
export function deleteFromSelection(state: EditorState, text: string, userEvent: string): TransactionSpec | null {
  const { first, last } = affectedLines(state);
  const changes: { from: number; to: number }[] = [];
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    if (line.text.startsWith(text)) changes.push({ from: line.from, to: line.from + text.length });
  }
  if (changes.length === 0) return null;
  return {
    changes,
    selection: selectionAfter(state, -changes.length * text.length, changes),
    scrollIntoView: true,
    userEvent,
    annotations: ONE_STEP,
  };
}

export const commentSelection = (state: EditorState) => insertInSelection(state, '*', 'input.comment');
export const uncommentSelection = (state: EditorState) => deleteFromSelection(state, '*', 'delete.uncomment');
export const indentSelection = (state: EditorState) => insertInSelection(state, ' ', 'input.indent');
export const outdentSelection = (state: EditorState) => deleteFromSelection(state, ' ', 'delete.dedent');

/**
 * Typing in Replace (overwrite) mode (editor-ui §8.6): the typed text replaces as many following
 * characters of the same line as it has characters; it never eats the line break. Text that
 * contains a line break, and typing over a selection, behave as in Insert mode (null = let the
 * editor insert normally). Unlike the original, overwrite typing is undoable (note 5).
 */
export function overwriteInput(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
  if (from !== to || text.length === 0 || /[\r\n]/.test(text)) return null;
  const line = state.doc.lineAt(from);
  const count = [...text].length;
  let end = from;
  for (let i = 0; i < count && end < line.to; i++) {
    const code = state.doc.sliceString(end, end + 1).charCodeAt(0);
    // A surrogate pair is one character.
    end += code >= 0xd800 && code <= 0xdbff && end + 2 <= line.to ? 2 : 1;
  }
  return {
    changes: { from, to: end, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
    userEvent: 'input.type',
  };
}

/** Line breaks of pasted or dropped text become "\n", the documents' only line separator (3.9.1). */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
