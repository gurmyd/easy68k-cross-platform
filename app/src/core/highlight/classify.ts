// Classification of a statement (editor-ui §9.5; TTextStuff::highlightLine, textS.cpp:1304-1491,
// and checkRelational, textS.cpp:1236-1296). Owner: E3.
//
// The tests run in the original's order: directives, structured keywords, opcodes; everything
// else is UNKNOWN (Macro/Other).

import { GREATER, isDigit, LESS, PERIOD, skipSpace, EQUALS } from './chars';
import { DIRECTIVE, paint, STRUCTURE, type LineState } from './line-state';
import { lookupMnemonic } from './mnemonics';
import { highlightOperand } from './operand';
import type { Tokens } from './tokenize';

/** What the classification leaves for the final colouring of the line (textS.cpp:1191-1203). */
export type StatementResult = 'opcode' | 'comment' | 'unknown' | 'error';

/** The 32 directives (textS.cpp:1308-1314); the first seven take no operand. */
export const DIRECTIVES: readonly string[] = [
  'ENDC',
  'ENDM',
  'LIST',
  'NOLIST',
  'PAGE',
  'MEXIT',
  'SIMHALT',
  'DC',
  'DCB',
  'DS',
  'END',
  'EQU',
  'FAIL',
  'INCLUDE',
  'MACRO',
  'MEMORY',
  'OFFSET',
  'OPT',
  'ORG',
  'REG',
  'SECTION',
  'SET',
  'IFC',
  'IFNC',
  'IFEQ',
  'IFNE',
  'INCBIN',
  'IFLT',
  'IFLE',
  'IFGT',
  'IFGE',
  'NARG',
];
const NO_OPERAND_COUNT = 7;

/** Structured keywords that stand alone (textS.cpp:1317); the code relies on ELSE being first. */
export const STRUCTURE_SINGLES: readonly string[] = ['ELSE', 'ENDI', 'ENDF', 'ENDW', 'REPEAT'];

/**
 * The relational patterns, widest first (textS.cpp:1241-1256): `*` any non-empty token, `<` a
 * token with `<` first and `>` fourth, `&` AND, `|` OR, `.` a token starting with a period, and a
 * blank for "matched".
 */
export const RELATIONAL_PATTERNS: readonly string[] = [
  '*<*&.*<* ',
  '*<*|.*<* ',
  '*<*&*<*  ',
  '*<*|*<*  ',
  '<&.*<*   ',
  '<|.*<*   ',
  '<&*<*    ',
  '<|*<*    ',
  '*<*&<    ',
  '*<*|<    ',
  '<&<      ',
  '<|<      ',
  '*<*      ',
  '<        ',
];

/** `tokenS[n][0] == '<' && tokenS[n][3] == '>'` (which may read into the next token, as in C). */
function isCondition(tokens: Tokens, n: number): boolean {
  return tokens.char(n, 0) === LESS && tokens.char(n, 3) === GREATER;
}

/** checkRelational(n): the number of the token after the matched expression, or 0 for no match. */
export function checkRelational(tokens: Tokens, n: number): number {
  for (const row of RELATIONAL_PATTERNS) {
    for (let col = 0; col < row.length; col++) {
      const t = n + col;
      const kind = row[col];
      if (kind === '<' && !isCondition(tokens, t)) break;
      if (kind === '|' && !tokens.is(t, 'OR')) break;
      if (kind === '&' && !tokens.is(t, 'AND')) break;
      if (kind === '.' && tokens.char(t, 0) !== PERIOD) break;
      if (kind === '*' && tokens.char(t, 0) === 0) break;
      if (kind === ' ') return n + col; // matching relational found
    }
  }
  return 0;
}

/**
 * highlightLine: classifies the statement whose operation starts at `state.p` (= `syntaxStart`)
 * with the tokens of the line, paints directive, structured, string and error ranges, and returns
 * what the caller paints over the rest of the line. `state.p` and `state.syntaxStart` are left
 * where the original leaves them.
 */
export function classifyStatement(state: LineState): StatementResult {
  const tokens = state.tokens!;
  const { cap } = state;
  let n = 1; // token number
  if (tokens.char(2, 0) === PERIOD) n = 2; // token 2 is .? (a size suffix, or so it is taken)

  // directives
  for (let i = 0; i < DIRECTIVES.length; i++) {
    if (!tokens.is(1, DIRECTIVES[i]!)) continue;
    if (tokens.endOf(n) >= 0) state.p = tokens.endOf(n); // end of the directive
    paint(state, state.syntaxStart, state.p - state.syntaxStart, DIRECTIVE);
    state.p = skipSpace(cap, state.p);
    state.syntaxStart = state.p;
    if (tokens.is(1, 'FAIL')) return 'opcode';
    if (i < NO_OPERAND_COUNT) {
      state.syntaxStart = state.p;
      return 'comment';
    }
    highlightOperand(state); // the operands of the directive
    if (tokens.is(1, 'MEMORY')) highlightOperand(state); // its additional operands
    state.syntaxStart = state.p;
    return 'comment'; // the rest of the line is comment
  }

  // structured
  //  token number
  //    1     2     3     4     5     6     7     8     9    10    11    12
  //   IF    .B    D0    <cc>  D1    AND   .B    D2    <cc>  D3   THEN   .S
  let result: StatementResult | 'structure';
  if (tokens.is(1, 'IF')) {
    n = checkRelational(tokens, n + 1);
    result = n && tokens.is(n, 'THEN') ? 'structure' : 'error';
  } else if (tokens.is(1, 'WHILE')) {
    if (tokens.is(n + 1, '<T>')) n += 2;
    else n = checkRelational(tokens, n + 1);
    result = n && tokens.is(n, 'DO') ? 'structure' : 'error';
  } else if (tokens.is(1, 'FOR')) {
    // op1 = op2 TO|DOWNTO op3 [BY op4] DO
    if (tokens.is(n + 2, '=') && (tokens.is(n + 4, 'TO') || tokens.is(n + 4, 'DOWNTO'))) {
      if (tokens.is(n + 6, 'BY'))
        n += 8; // number of the last token of the statement
      else n += 6;
      result = tokens.is(n, 'DO') ? 'structure' : 'error';
    } else {
      result = 'error';
    }
  } else if (tokens.is(1, 'DBLOOP')) {
    // Dn = op1
    if (
      tokens.char(n + 1, 0) === 0x44 /* D */ &&
      isDigit(tokens.char(n + 1, 1)) &&
      tokens.char(n + 2, 0) === EQUALS &&
      tokens.char(n + 3, 0) !== 0
    ) {
      n += 3;
      result = 'structure';
    } else {
      result = 'error';
    }
  } else if (tokens.is(1, 'UNLESS')) {
    // nothing, <F>, or op1 <cc> op2
    if (tokens.char(n + 1, 0) === 0) {
      result = 'structure';
    } else if (tokens.is(n + 1, '<F>')) {
      result = 'structure';
      n += 1;
    } else if (isCondition(tokens, n + 2) && tokens.char(n + 3, 0) !== 0) {
      result = 'structure';
      n += 3;
    } else {
      result = 'error';
    }
  } else if (tokens.is(1, 'UNTIL')) {
    n = checkRelational(tokens, n + 1);
    result = n && tokens.is(n, 'DO') ? 'structure' : 'error';
  } else {
    result = 'unknown';
    // single structure words
    for (let i = 0; i < STRUCTURE_SINGLES.length; i++) {
      if (tokens.is(1, STRUCTURE_SINGLES[i]!)) {
        if (i === 0 && tokens.char(n + 1, 0) === PERIOD) n++;
        result = 'structure';
        break;
      }
    }

    if (result === 'unknown') {
      // opcodes
      const entry = lookupMnemonic(tokens, 1, state.bitField);
      if (entry) {
        if (tokens.endOf(n) >= 0) state.p = tokens.endOf(n); // end of the mnemonic
        state.p = skipSpace(cap, state.p);
        if (tokens.char(n + 1, 0) === 0) return 'opcode'; // opcode only
        if (entry.kind === 'source' || entry.kind === 'bitfield') highlightOperand(state);
        state.p = skipSpace(cap, state.p);
        if (cap[state.p] === 0) return 'opcode';
        state.syntaxStart = state.p;
        return 'comment'; // the rest of the line is comment
      }
    }
  }

  if (result === 'structure') {
    if (tokens.char(n + 1, 0) === PERIOD) n++; // the last token is followed by .?
    if (tokens.endOf(n) >= 0) state.p = tokens.endOf(n); // end of the last token
    paint(state, state.syntaxStart, state.p - state.syntaxStart, STRUCTURE);
    state.p = skipSpace(cap, state.p);
    state.syntaxStart = state.p;
    return 'comment'; // the rest of the line is comment
  }
  return result;
}
