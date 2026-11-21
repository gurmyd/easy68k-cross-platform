import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markerField, markerLines, markerMessages, setMarkers } from './markers';

const messages = markerMessages([
  { file: null, line: 2, text: 'ERROR: Invalid opcode', severity: 'error' },
  { file: null, line: 3, text: 'WARNING: END directive missing, starting address not set', severity: 'warning' },
  { file: null, line: 3, text: 'ERROR: Undefined symbol', severity: 'error' },
  { file: null, line: 99, text: 'ERROR: beyond the end', severity: 'error' },
]);

function withMarkers(doc: string) {
  const state = EditorState.create({ doc, extensions: [markerField] });
  return state.update({ effects: setMarkers.of(messages) }).state;
}

describe('inline assembler markers (2.2)', () => {
  it('one marker per line with messages; lines beyond the end are ignored', () => {
    const state = withMarkers('a\nb\nc\nd');
    const lines = markerLines(state);
    expect(lines.map((entry) => entry.line)).toEqual([2, 3]);
    expect(lines[0]?.marker.severity).toBe('error');
    expect(lines[1]?.marker.text).toBe(
      'WARNING: END directive missing, starting address not set\nERROR: Undefined symbol',
    );
    expect(lines[1]?.marker.severity).toBe('error');
  });

  it('markers move with edits', () => {
    let state = withMarkers('a\nb\nc\nd');
    state = state.update({ changes: { from: 0, insert: 'new line\n\n' } }).state;
    expect(markerLines(state).map((entry) => entry.line)).toEqual([4, 5]);
    // Deleting a marked line's text keeps the marker on the line that is left.
    state = state.update({ changes: { from: 0, to: state.doc.line(3).to + 1 } }).state;
    expect(markerLines(state).map((entry) => entry.line)).toEqual([1, 2]);
  });

  it('the next assembly or Clear Error Messages replaces them', () => {
    let state = withMarkers('a\nb\nc');
    state = state.update({ effects: setMarkers.of([]) }).state;
    expect(markerLines(state)).toEqual([]);
  });
});
