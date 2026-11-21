// The working state of the highlighter for one line: the original's globals `capLine`, `p`,
// `syntaxStart`, the tokens, and the styles painted so far. Owner: E3.

import type { SyntaxElement } from '../../contracts';
import type { Tokens } from './tokenize';

/** The eight style elements by number; 0 is Code, which the whole line starts in. */
export const ELEMENTS: readonly SyntaxElement[] = [
  'code',
  'comment',
  'directive',
  'label',
  'unknown',
  'structure',
  'error',
  'text',
];

export const CODE = 0;
export const COMMENT = 1;
export const DIRECTIVE = 2;
export const LABEL = 3;
export const UNKNOWN = 4;
export const STRUCTURE = 5;
export const ERROR = 6;
export const TEXT = 7;

export interface LineState {
  /** The line through `strcap`, NUL-terminated (`capLine`). Positions below are indices into it. */
  readonly cap: Uint16Array;
  /** Length of the line in the editor (the end of "to the end of the line"). */
  readonly lineLength: number;
  /** Style element of every character of the line (index into ELEMENTS). */
  readonly styles: Uint8Array;
  readonly bitField: boolean;
  tokens: Tokens | null;
  /** The original's `p`. */
  p: number;
  /** The original's `syntaxStart`. */
  syntaxStart: number;
}

/**
 * setFontStyle on the selection [from, from + length): the characters take `element`, replacing
 * whatever they had (colour and attributes are set together, textS.cpp:1577-1600). The range is
 * clipped to the line; a negative length selects backwards, as a rich edit control does.
 */
export function paint(state: LineState, from: number, length: number, element: number): void {
  let a = from;
  let b = from + length;
  if (b < a) [a, b] = [b, a];
  a = Math.max(0, a);
  b = Math.min(state.lineLength, b);
  if (b > a) state.styles.fill(element, a, b);
}

/** Paint from `from` to the end of the line. */
export function paintToEnd(state: LineState, from: number, element: number): void {
  paint(state, from, state.lineLength - from, element);
}
