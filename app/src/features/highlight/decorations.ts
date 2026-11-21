// Mark decorations for the highlighted lines of a document. Owner: E3.
//
// Every character of a highlighted line gets a mark, Code included: an attribute such as
// underline on a parent element cannot be taken back by a child, so the attributes of each element
// must sit on its own mark rather than on the whole content.

import { RangeSetBuilder, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import type { SyntaxElement } from '../../contracts';
import { ELEMENTS, highlightStyles, SYNTAX_ELEMENTS, type HighlightOptions } from '../../core/highlight';
import { syntaxClass } from './colors';

const MARKS: Readonly<Record<SyntaxElement, Decoration>> = Object.fromEntries(
  SYNTAX_ELEMENTS.map((element) => [element, Decoration.mark({ class: syntaxClass(element) })]),
) as Record<SyntaxElement, Decoration>;

/** The mark decoration of each style index of core/highlight (ELEMENTS order). */
const MARK_BY_INDEX: readonly Decoration[] = ELEMENTS.map((element) => MARKS[element]);

export interface DocRange {
  from: number;
  to: number;
}

/**
 * Decorations for every line that touches one of `ranges` (sorted, as EditorView.visibleRanges
 * are). Each line is highlighted on its own (editor-ui §9.1: no state passes between lines).
 */
export function buildHighlightDecorations(
  doc: Text,
  ranges: readonly DocRange[],
  options: HighlightOptions,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let nextLine = 1; // lines before this one are done
  for (const range of ranges) {
    const first = Math.max(doc.lineAt(range.from).number, nextLine);
    const last = doc.lineAt(Math.min(range.to, doc.length)).number;
    for (let number = first; number <= last; number++) {
      const line = doc.line(number);
      const styles = highlightStyles(line.text, options);
      let from = 0;
      for (let i = 1; i <= styles.length; i++) {
        if (i === styles.length || styles[i] !== styles[from]) {
          builder.add(line.from + from, line.from + i, MARK_BY_INDEX[styles[from]!]!);
          from = i;
        }
      }
    }
    nextLine = Math.max(nextLine, last + 1);
  }
  return builder.finish();
}
