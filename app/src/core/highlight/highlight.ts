// The per-line highlighting algorithm (editor-ui §9.3; TTextStuff::HighlightTimerTimer,
// textS.cpp:1144-1206). Owner: E3.
//
// The result for a line depends only on its text and on the assembler option "Assemble Bit Field
// Instructions" (editor-ui §9.1). The original first paints the whole range in the Code style and
// then paints the parts it recognises; `highlightLine` returns the outcome as runs of one style.

import type { SyntaxElement } from '../../contracts';
import { capitalise, COLON, DOLLAR, isAlnum, PERIOD, SEMICOLON, skipSpace, STAR, UNDERSCORE } from './chars';
import { classifyStatement } from './classify';
import { COMMENT, ELEMENTS, ERROR, LABEL, paint, paintToEnd, UNKNOWN, type LineState } from './line-state';
import { tokenize } from './tokenize';

export interface HighlightOptions {
  /** The assembler option "Assemble Bit Field Instructions" (EditorSettings.assembleBitField). */
  bitField: boolean;
}

/** A run of characters [from, to) of one line in one style. */
export interface HighlightSpan {
  from: number;
  to: number;
  style: SyntaxElement;
}

/**
 * The style of every character of `line` (a line of a source document without its line break), as
 * indices into ELEMENTS (0 = Code). Exposed for callers that want the raw array.
 */
export function highlightStyles(line: string, options: HighlightOptions): Uint8Array {
  const cap = capitalise(line);
  const state: LineState = {
    cap,
    lineLength: line.length,
    styles: new Uint8Array(line.length), // all Code
    bitField: options.bitField,
    tokens: null,
    p: 0,
    syntaxStart: 0,
  };

  let p = skipSpace(cap, 0); // skip leading white space
  let start = p;
  if (cap[p] === 0) return state.styles; // empty or blank line

  if (cap[p] === STAR || cap[p] === SEMICOLON) {
    // comment line
    paintToEnd(state, 0, COMMENT);
    return state.styles;
  }

  // skip a possible label
  while (isAlnum(cap[p]!) || cap[p] === PERIOD || cap[p] === UNDERSCORE || cap[p] === DOLLAR) p++;
  if (start === 0 || cap[p] === COLON) {
    // label
    if (cap[p] === COLON) p++; // skip :
    paint(state, 0, p, LABEL);
    p = skipSpace(cap, p); // skip spaces after the label
    if (cap[p] === 0) return state.styles;
  } else {
    // not a label
    p = start; // back to the start of the code on the line
    start = 0; // and the start of the line for the tokeniser
  }

  if (cap[p] === STAR || cap[p] === SEMICOLON) {
    // comment after the label
    paintToEnd(state, p, COMMENT);
    return state.styles;
  }

  // the rest of the line
  state.tokens = tokenize(cap, start);
  state.p = p;
  state.syntaxStart = p; // start of the syntax
  const result = classifyStatement(state);

  if (result === 'error') paintToEnd(state, state.syntaxStart, ERROR);
  else if (result === 'comment') paintToEnd(state, state.p, COMMENT);
  else if (result === 'unknown') paintToEnd(state, state.syntaxStart, UNKNOWN);
  return state.styles;
}

/**
 * Highlights one line of a source document: runs of one style that together cover the whole line
 * (an empty line gives no run). Blank lines and unrecognised parts are Code.
 */
export function highlightLine(line: string, options: HighlightOptions): HighlightSpan[] {
  return toSpans(highlightStyles(line, options));
}

/** Runs of equal style in a style array. */
export function toSpans(styles: Uint8Array): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  let from = 0;
  for (let i = 1; i <= styles.length; i++) {
    if (i === styles.length || styles[i] !== styles[from]) {
      spans.push({ from, to: i, style: ELEMENTS[styles[from]!]! });
      from = i;
    }
  }
  return spans;
}
