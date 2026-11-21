// The text mirror of the Output panel (ARCHITECTURE.md 2.5, 2.11): the contents of the text
// screen's shadow array as lines of text, for screen readers. The canvas is a picture; this is
// what a program has written on it with the text tasks (the array that TRAP #15 task 22 reads,
// trap15-a §3.7). The panel shows the lines in an off-screen live region and refreshes them at
// most twice per second.

import type { TextState } from '../../contracts';
import { decode } from '../../core/codec/cp1252';

/** Milliseconds between two refreshes of the mirror (2.11: two updates per second). */
export const MIRROR_INTERVAL_MS = 500;

/**
 * The rows of the text screen, top to bottom, without trailing blanks and without the empty rows
 * below the last line that holds text. Bytes that are not printable (the NUL bytes of a screen
 * that was never written) read as blanks.
 */
export function mirrorRows(state: Pick<TextState, 'text' | 'textRows' | 'textCols'>): string[] {
  const { text } = state;
  // Every access to the array uses the stride textCols (3.5.2).
  const cols = Math.max(0, Math.min(state.textCols, 256));
  if (cols === 0) return [];
  const rowCount = Math.max(0, Math.min(state.textRows, 128, Math.floor(text.length / cols)));
  const rows: string[] = [];
  let last = -1;
  for (let row = 0; row < rowCount; row++) {
    const bytes = text.subarray(row * cols, (row + 1) * cols);
    const line = decode(bytes)
      // eslint-disable-next-line no-control-regex -- control bytes are exactly what is replaced here
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .trimEnd();
    rows.push(line);
    if (line !== '') last = row;
  }
  return rows.slice(0, last + 1);
}

/** True if the two lists hold the same lines. */
export function sameRows(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}
