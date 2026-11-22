// The comparison of the Earlier Versions dialog (ARCHITECTURE-PLUS P3.3.8). Owner: N4.
//
// This module imports @codemirror/merge and is itself loaded only with import() (VersionsDialog
// .tsx), so that the merge view stays out of the first load; the service worker precaches every
// file of the build, this chunk included, so it loads offline after the first visit.
//
//   - side by side: @codemirror/merge's MergeView, the version left (A), the file now right (B);
//   - below 700 px of dialog width: the unified view of the same package (the file now, with the
//     version's deleted lines as blocks above), `mergeControls: false`.
//
// Both sides are read-only (EditorState.readOnly) and not editable. The package's own gutter is off
// (`gutter: false`); this module's gutter marks each deleted line `-` and each inserted line `+`
// (diff-marks.ts), so that nothing depends on colour alone. Colours come from the theme tokens
// (history.css): inserted lines --c-ok at 15 %, deleted lines --c-danger at 15 %.

import { MergeView, getChunks, getOriginalDoc, unifiedMergeView, type Chunk } from '@codemirror/merge';
import { EditorState, type Extension, type Text } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, type BlockInfo } from '@codemirror/view';
import { DELETED_MARK, INSERTED_MARK, changedLines, deletedLineCount } from './diff-marks';

export interface ComparisonOptions {
  /** The earlier version's text ("\n" line ends). */
  before: string;
  /** The file's text now. */
  now: string;
  /** The unified view (below 700 px of dialog width) instead of two sides. */
  unified: boolean;
  /** The editor's font (ui/editor/fonts.ts). */
  fontFamily: string;
  fontSize: string;
  /** Accessible names of the two sides (the headings: the version's date and `Now`). */
  beforeLabel: string;
  nowLabel: string;
}

export interface Comparison {
  /** Removes the comparison from its parent. */
  destroy(): void;
}

class Mark extends GutterMarker {
  constructor(
    readonly text: string,
    readonly lines = 1,
  ) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof Mark && other.text === this.text && other.lines === this.lines;
  }
  override toDOM(): Node {
    const element = document.createElement('span');
    element.className =
      this.text === DELETED_MARK ? 'e68-diff-mark e68-diff-mark--deleted' : 'e68-diff-mark e68-diff-mark--inserted';
    element.textContent = Array.from({ length: this.lines }, () => this.text).join('\n');
    return element;
  }
}
const DELETED = new Mark(DELETED_MARK);
const INSERTED = new Mark(INSERTED_MARK);

/** The hidden spacer that gives the gutter the width of one mark; not a mark itself. */
class Spacer extends GutterMarker {
  override toDOM(): Node {
    const element = document.createElement('span');
    element.className = 'e68-diff-spacer';
    element.textContent = INSERTED_MARK;
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
}
const SPACER = new Spacer();

/** The lines one editor marks, computed once per set of chunks and document. */
const cache = new WeakMap<readonly Chunk[], WeakMap<Text, ReadonlySet<number>>>();

/**
 * The lines this editor marks: in side A (the version) the deleted lines, in side B and in the
 * unified view (which holds the file now) the inserted ones. The two editors of a MergeView share
 * one set of chunks, so the cache is keyed by the editor's document as well.
 */
function markedLines(state: EditorState, side: 'a' | 'b' | 'unified'): ReadonlySet<number> | null {
  const found = getChunks(state);
  if (!found) return null;
  let byDoc = cache.get(found.chunks);
  if (!byDoc) {
    byDoc = new WeakMap();
    cache.set(found.chunks, byDoc);
  }
  let lines = byDoc.get(state.doc);
  if (!lines) {
    const doc = state.doc;
    lines =
      side === 'a'
        ? changedLines(found.chunks, doc, doc).deleted
        : changedLines(found.chunks, side === 'unified' ? getOriginalDoc(state) : doc, doc).inserted;
    byDoc.set(state.doc, lines);
  }
  return lines;
}

/** N4's gutter: `-` beside deleted lines of side A, `+` beside inserted lines of side B. */
function markGutter(side: 'a' | 'b' | 'unified'): Extension {
  return gutter({
    class: 'e68-diff-gutter',
    lineMarker(view, line) {
      const lines = markedLines(view.state, side);
      if (!lines || !lines.has(view.state.doc.lineAt(line.from).number)) return null;
      return side === 'a' ? DELETED : INSERTED;
    },
    // The unified view shows deleted lines as a block widget above the place they were removed.
    widgetMarker(view, _widget, block: BlockInfo) {
      if (side !== 'unified') return null;
      const found = getChunks(view.state);
      if (!found) return null;
      const chunk = found.chunks.find((c) => c.fromB === block.from && c.toA > c.fromA);
      if (!chunk) return null;
      return new Mark(DELETED_MARK, deletedLineCount(chunk, getOriginalDoc(view.state)));
    },
    lineMarkerChange: (update) => update.docChanged || update.viewportChanged,
    // Gives the gutter its width; drawn hidden by CodeMirror.
    initialSpacer: () => SPACER,
  });
}

function sideExtensions(options: ComparisonOptions, side: 'a' | 'b' | 'unified', label: string): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ 'aria-label': label }),
    EditorView.theme({
      '&': { fontFamily: options.fontFamily, fontSize: options.fontSize },
      '.cm-content, .cm-gutters': { fontFamily: options.fontFamily },
    }),
    markGutter(side),
  ];
}

/** Draws the comparison into `parent`; destroy() removes it. */
export function mountComparison(parent: HTMLElement, options: ComparisonOptions): Comparison {
  if (options.unified) {
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: options.now,
        extensions: [
          ...sideExtensions(options, 'unified', options.nowLabel),
          unifiedMergeView({ original: options.before, mergeControls: false, gutter: false }),
        ],
      }),
    });
    return { destroy: () => view.destroy() };
  }
  const merge = new MergeView({
    parent,
    gutter: false,
    a: { doc: options.before, extensions: sideExtensions(options, 'a', options.beforeLabel) },
    b: { doc: options.now, extensions: sideExtensions(options, 'b', options.nowLabel) },
  });
  return { destroy: () => merge.destroy() };
}
