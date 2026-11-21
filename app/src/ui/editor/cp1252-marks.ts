// Marks on characters that Windows-1252 cannot store (ARCHITECTURE.md 3.9.3). Owner: E2.
//
// EASy68K reads and writes Windows-1252 (5.1). A character typed or pasted that has no byte there is
// saved as `?`. The editor marks each such character as it appears: a wavy underline and the hover
// text `Not in Windows-1252: saved as ?`. (The question at Save is E1's.)

import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { byteForCodePoint } from '../../core/codec/cp1252';

export const NOT_1252_TEXT = 'Not in Windows-1252: saved as ?';

/** A quick filter: every character outside $00-$7F and $A0-$FF needs a closer look. */
const MAYBE = /[\u0080-\u009f\u0100-\uffff]/;

/**
 * The ranges [from, to) of characters in `text` (offsets relative to `text`) that have no
 * Windows-1252 byte. A surrogate pair is one character.
 */
export function unmappableRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  if (!MAYBE.test(text)) return ranges;
  let offset = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) as number;
    if (byteForCodePoint(codePoint) === null) ranges.push({ from: offset, to: offset + char.length });
    offset += char.length;
  }
  return ranges;
}

const mark = Decoration.mark({ class: 'e68-not1252', attributes: { title: NOT_1252_TEXT } });

function marks(view: EditorView): DecorationSet {
  const ranges = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const range of unmappableRanges(text)) ranges.push(mark.range(from + range.from, from + range.to));
  }
  return Decoration.set(ranges, true);
}

export const cp1252Marks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = marks(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = marks(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
