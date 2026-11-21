// The search and replace rules of the editor (editor-ui §14.2, §14.3; ARCHITECTURE.md 1.4 note 7).
// Owner: E6.
//
// Plain functions over a text and a selection, so that every rule is tested under Node. Offsets
// count characters (UTF-16 units) of the document text, lines separated by "\n".
//
// The original (TMain::FindDialogFind, mainS.cpp:601-642):
//   - always forward, no wrap option, no regular expressions;
//   - with a selection the search starts just after it; without one at the top of the document;
//   - found: the match is selected; not found: `End of document reached.` and the selection is
//     collapsed to its start, so the next search starts from the top again.
// Note 7 changes one thing: without a selection the search starts at the caret. The restart from
// the top after `End of document reached.` is kept (`FindStart.restart`).
//
// Replace (TMain::ReplaceDialogReplace, mainS.cpp:663-691) with note 7's two corrections:
//   - the selection is replaced only when it is a match; a selection that is not a match counts as
//     no selection with the caret at its start (the next match from there is found and replaced);
//   - an empty replacement leaves the caret at the place of the deleted match and the next search
//     starts there, so a match that begins right there is not skipped (the original selected one
//     character with max(1, length) and searched after it).
//
// Whole word (the edit control's own rule, not documented by the original): a match counts when
// the character before it and the character after it are not word characters. Word characters
// are letters, digits and the underscore (errata/E6.md).

export interface FindOptions {
  wholeWord: boolean;
  matchCase: boolean;
}

/** A selection: `from` <= `to`; empty when they are equal (then it is the caret). */
export interface Selection {
  from: number;
  to: number;
}

/** A letter, a digit or the underscore. */
export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && ch !== '' && /[\p{L}\p{N}_]/u.test(ch);
}

function sameChar(a: string, b: string): boolean {
  if (a === b) return true;
  return a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase();
}

/** True when `query` occurs at `at` in `text` under the options. */
export function matchesAt(text: string, at: number, query: string, options: FindOptions): boolean {
  if (query === '' || at < 0 || at + query.length > text.length) return false;
  if (options.matchCase) {
    if (!text.startsWith(query, at)) return false;
  } else {
    for (let i = 0; i < query.length; i++) {
      if (!sameChar(text.charAt(at + i), query.charAt(i))) return false;
    }
  }
  if (options.wholeWord) {
    if (isWordChar(text.charAt(at - 1) || undefined)) return false;
    if (isWordChar(text.charAt(at + query.length) || undefined)) return false;
  }
  return true;
}

/** The first match at or after `start`, or -1. */
export function findFrom(text: string, query: string, start: number, options: FindOptions): number {
  if (query === '') return -1;
  const last = text.length - query.length;
  if (options.matchCase && !options.wholeWord) {
    const at = text.indexOf(query, Math.max(0, start));
    return at;
  }
  for (let at = Math.max(0, start); at <= last; at++) {
    if (matchesAt(text, at, query, options)) return at;
  }
  return -1;
}

/** True when the selection is exactly a match of `query` (note 7: only such a selection is replaced). */
export function selectionIsMatch(text: string, selection: Selection, query: string, options: FindOptions): boolean {
  return selection.to - selection.from === query.length && matchesAt(text, selection.from, query, options);
}

/** Where a search starts (14.2 with note 7). */
export interface FindStart {
  /** The selection when the search is asked for. */
  selection: Selection;
  /** True right after `End of document reached.` while nothing changed: the search starts at the top. */
  restart: boolean;
}

export function searchStart({ selection, restart }: FindStart): number {
  if (selection.to > selection.from) return selection.to;
  return restart ? 0 : selection.from;
}

/** The result of one search: the match to select, or null for `End of document reached.`. */
export function findNext(text: string, query: string, options: FindOptions, start: FindStart): Selection | null {
  const at = findFrom(text, query, searchStart(start), options);
  return at < 0 ? null : { from: at, to: at + query.length };
}

/** One text change, in the coordinates of the text before the replacement. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface ReplaceResult {
  /** The changes, in order, in the coordinates of the original text; empty when nothing was replaced. */
  changes: TextChange[];
  /** The selection afterwards, in the coordinates of the new text: the next match, or (when
   *  `endReached`) the last replacement, collapsed to its start once the message has been shown. */
  selection: Selection;
  /** True when the last search failed: the caller shows `End of document reached.` and then
   *  collapses the selection to its start. */
  endReached: boolean;
  /** The text after the changes. */
  text: string;
}

export interface ReplaceRequest {
  text: string;
  selection: Selection;
  /** The restart flag of a Find Next right before (see FindStart). */
  restart: boolean;
  query: string;
  replacement: string;
  options: FindOptions;
  /** Replace All: repeat until the search fails. */
  all: boolean;
}

/**
 * Replace and Replace All (14.3 with note 7). Replace: make sure a match is selected (finding the
 * next one when the selection is not a match), replace it, then select the next match. Replace
 * All repeats that to the end of the document; it never wraps.
 */
export function replace(request: ReplaceRequest): ReplaceResult {
  const { query, replacement, options } = request;
  let text = request.text;
  const changes: TextChange[] = [];
  // How far the current text is ahead of the original at the place of the last change.
  let delta = 0;

  let selection: Selection | null = request.selection;
  if (!selectionIsMatch(text, selection, query, options)) {
    // No selection, or one that is not a match: search from the caret, or from the selection's start.
    const caret = selection.from;
    selection = findNext(text, query, options, {
      selection: { from: caret, to: caret },
      restart: request.restart && selection.from === selection.to,
    });
  }
  if (!selection) {
    const caret = request.selection.from;
    return { changes, selection: { from: caret, to: caret }, endReached: true, text };
  }

  for (;;) {
    const start = selection.from;
    changes.push({ from: start - delta, to: selection.to - delta, insert: replacement });
    text = text.slice(0, start) + replacement + text.slice(selection.to);
    delta += replacement.length - (selection.to - start);
    const replaced: Selection = { from: start, to: start + replacement.length };
    const next = findNext(text, query, options, { selection: replaced, restart: false });
    if (!next) return { changes, selection: replaced, endReached: true, text };
    selection = next;
    if (!request.all) return { changes, selection, endReached: false, text };
  }
}
