// Inline assembler markers (ARCHITECTURE.md 2.2, 1.4 note 16). Owner: E2.
//
// For every message of the last assembly of a document: a squiggle under the whole source line
// and a mark in the gutter. The message text appears on hover (title) and while the caret is on
// the line (a tooltip, so that keyboard users get it too). The markers move with edits; the next
// assembly and `Clear Error Messages` replace them (the editor sets them from
// `AppState.messages[documentId]` whenever that list changes).

import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  showTooltip,
  type DecorationSet,
  type Tooltip,
} from '@codemirror/view';
import type { EditorMessage } from '../../contracts';

export interface MarkerMessage {
  /** 1-based source line. */
  line: number;
  text: string;
  severity: EditorMessage['severity'];
}

/** One gutter mark; it also carries the message for the squiggle and the tooltip. */
export class AssemblerMarker extends GutterMarker {
  constructor(readonly messages: readonly MarkerMessage[]) {
    super();
  }
  get severity(): MarkerMessage['severity'] {
    return this.messages.some((m) => m.severity === 'error') ? 'error' : 'warning';
  }
  get text(): string {
    return this.messages.map((m) => m.text).join('\n');
  }
  override eq(other: AssemblerMarker): boolean {
    return other.text === this.text && other.severity === this.severity;
  }
  override toDOM(): Node {
    const span = document.createElement('span');
    span.className = `e68-marker e68-marker--${this.severity}`;
    span.textContent = this.severity === 'error' ? '!' : '?';
    span.title = this.text;
    span.setAttribute('aria-label', this.text);
    return span;
  }
}

/** Replaces the markers of a document. */
export const setMarkers = StateEffect.define<readonly MarkerMessage[]>();

/** The messages of a list, grouped by line, as markers at the line starts of `state`. */
export function markersFor(state: EditorState, messages: readonly MarkerMessage[]): RangeSet<AssemblerMarker> {
  const byLine = new Map<number, MarkerMessage[]>();
  for (const message of messages) {
    if (!Number.isInteger(message.line) || message.line < 1 || message.line > state.doc.lines) continue;
    const list = byLine.get(message.line);
    if (list) list.push(message);
    else byLine.set(message.line, [message]);
  }
  const lines = [...byLine.keys()].sort((a, b) => a - b);
  return RangeSet.of(
    lines.map((line) => new AssemblerMarker(byLine.get(line) as MarkerMessage[]).range(state.doc.line(line).from)),
  );
}

/** Messages of `AppState.messages` as markers (the file column is E5's routing; all rows count). */
export function markerMessages(messages: readonly EditorMessage[] | undefined): MarkerMessage[] {
  return (messages ?? []).map((m) => ({ line: m.line, text: m.text, severity: m.severity }));
}

export const markerField = StateField.define<RangeSet<AssemblerMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    for (const effect of tr.effects) if (effect.is(setMarkers)) return markersFor(tr.state, effect.value);
    if (!tr.docChanged) return markers;
    // Each mark follows the text after it and stays at the start of the line it lands on, so a
    // marker survives edits of its line and of the lines around it.
    const moved = [];
    for (const cursor = markers.iter(); cursor.value; cursor.next()) {
      const at = tr.state.doc.lineAt(tr.changes.mapPos(cursor.from, 1)).from;
      moved.push(cursor.value.range(at));
    }
    return RangeSet.of(moved, true);
  },
});

/** The markers of a state as (1-based line, marker) pairs, in line order. */
export function markerLines(state: EditorState): { line: number; marker: AssemblerMarker }[] {
  const result: { line: number; marker: AssemblerMarker }[] = [];
  const cursor = state.field(markerField, false)?.iter();
  if (!cursor) return result;
  for (; cursor.value; cursor.next()) result.push({ line: state.doc.lineAt(cursor.from).number, marker: cursor.value });
  return result;
}

function squiggles(state: EditorState): DecorationSet {
  const ranges = [];
  for (const { line, marker } of markerLines(state)) {
    const { from, to } = state.doc.line(line);
    if (to > from) {
      ranges.push(
        Decoration.mark({
          class: `e68-squiggle e68-squiggle--${marker.severity}`,
          attributes: { title: marker.text },
        }).range(from, to),
      );
    }
  }
  return Decoration.set(ranges, true);
}

const squiggleDecorations = EditorView.decorations.compute([markerField], squiggles);

/** The tooltip while the caret is on a marked line. */
function caretTooltip(state: EditorState): Tooltip | null {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const found = markerLines(state).find((entry) => entry.line === line.number);
  if (!found) return null;
  return {
    pos: line.from,
    above: false,
    strictSide: false,
    create: () => {
      const dom = document.createElement('div');
      dom.className = `e68-marker-tip e68-marker-tip--${found.marker.severity}`;
      dom.textContent = found.marker.text;
      return { dom };
    },
  };
}

const caretTooltips = showTooltip.compute([markerField, 'selection'], caretTooltip);

const markerGutter = gutter({
  class: 'e68-marker-gutter',
  markers: (view) => view.state.field(markerField),
  initialSpacer: () => new AssemblerMarker([{ line: 1, text: '', severity: 'error' }]),
});

export const markerExtension: Extension = [markerField, markerGutter, squiggleDecorations, caretTooltips];
