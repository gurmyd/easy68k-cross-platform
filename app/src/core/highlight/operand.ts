// The operand field scanner (editor-ui §9.6; TTextStuff::highlightOperand, textS.cpp:1496-1571).
// Owner: E3.

import { COMMA, DQUOTE, isSpace, LPAREN, QUOTE, RPAREN, skipSpace, SPACE, TAB } from './chars';
import { ERROR, paint, TEXT, type LineState } from './line-state';

/**
 * Scans the operand field from `state.p`: strings get the Text style, an unclosed string or
 * parenthesis the Structure Error style. Moves `state.p` (and, after a string, `state.syntaxStart`)
 * as the original does and returns the new `p`: the first character after the operand field.
 */
export function highlightOperand(state: LineState): number {
  const { cap } = state;
  let p = state.p;
  let more: boolean;
  do {
    let parenCount = 0;
    // find a delimiter
    while (
      cap[p] !== 0 &&
      cap[p] !== LPAREN &&
      cap[p] !== QUOTE &&
      cap[p] !== DQUOTE &&
      cap[p] !== COMMA &&
      cap[p] !== SPACE &&
      cap[p] !== TAB
    ) {
      p++;
    }
    if (cap[p] === 0) {
      state.p = p;
      return p;
    } else if (cap[p] === LPAREN) {
      p++;
      parenCount++;
      while (cap[p] !== 0 && parenCount) {
        // find the matching )
        if (cap[p] === LPAREN) parenCount++;
        else if (cap[p] === RPAREN) parenCount--;
        p++;
      }
      if (cap[p] === 0 && parenCount) {
        // no matching )
        paint(state, state.syntaxStart, p - state.syntaxStart, ERROR);
        state.p = p;
        return p;
      }
      if (cap[p] !== 0 && !isSpace(cap[p]!)) {
        p++; // skip one character: more operand
        more = true;
        continue;
      }
    } else if (cap[p] === QUOTE || cap[p] === DQUOTE) {
      const quote = cap[p];
      state.syntaxStart = p;
      do {
        // find the matching quote
        p++;
        while (cap[p] === QUOTE && cap[p + 1] === QUOTE) p += 2; // skip ''
      } while (cap[p] !== 0 && cap[p] !== quote);
      if (cap[p] === 0) {
        // no matching quote
        paint(state, state.syntaxStart, p - state.syntaxStart, ERROR);
        state.p = p;
        return p;
      }
      p++;
      paint(state, state.syntaxStart, p - state.syntaxStart, TEXT);
      state.syntaxStart = p;
      if (cap[p] !== 0 && !isSpace(cap[p]!)) {
        p++; // skip one character: more operand
        more = true;
        continue;
      }
    }
    p = skipSpace(cap, p);
    if (cap[p] === COMMA) {
      p++;
      p = skipSpace(cap, p);
      more = true;
    } else {
      more = false; // end of the operand field
    }
  } while (more);
  state.p = p;
  return p;
}
