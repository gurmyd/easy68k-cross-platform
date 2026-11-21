// The tokeniser as the highlighter calls it (editor-ui §9.4; `tokenize`, ASSEMBLE.CPP:821-881).
// Owner: E3.
//
// The original copies the tokens one after the other, each ended by a NUL, into one buffer
// (`tokensS[512]`) and points `tokenS[n]` into it. The highlighter sometimes reads past the end of
// a short token (`tokenS[n][3]` in the `<cc>` test, `p[1]`/`p[2]` in `instLookup`) and then sees
// the first characters of the next token. This module keeps the same buffer so that those reads
// give the same answers. Bytes that were never written in this call (the original buffer keeps
// whatever an earlier line left there) read as NUL, and so does every character of an unused
// token (the original's `empty`).

import { isSpace, LF, PERIOD, QUOTE, LPAREN, RPAREN, SEMICOLON, SPACE, STAR, TAB } from './chars';

/** Maximum number of tokens (`MAXT`, ASSEMBLE.CPP:139). */
export const MAXT = 128;
/** Size of the token buffer (`MAX_SIZE`, ASSEMBLE.CPP:140). */
export const MAX_SIZE = 512;

/** The tokens of one line: the buffer, where each token starts in it, and where it ended in the line. */
export class Tokens {
  /** The token buffer. A few spare elements absorb the original's possible overrun at the very end. */
  readonly buffer = new Uint16Array(MAX_SIZE + 4);
  /** Start of token n in `buffer`, or -1 for an unused token (the original's `empty`). */
  readonly start = new Int32Array(MAXT).fill(-1);
  /** Position in the line where token n ended (`tokenEnd[n]`), or -1 (NULL). */
  readonly end = new Int32Array(MAXT).fill(-1);

  /** Character `k` of token `n`, reading on into the buffer past the token's NUL as C does. */
  char(n: number, k: number): number {
    const start = n >= 0 && n < MAXT ? this.start[n]! : -1;
    if (start < 0) return 0;
    const index = start + k;
    return index < MAX_SIZE ? this.buffer[index]! : 0;
  }

  /** Token `n` as a string (up to its NUL). */
  text(n: number): string {
    let out = '';
    for (let k = 0; ; k++) {
      const c = this.char(n, k);
      if (c === 0) return out;
      out += String.fromCharCode(c);
    }
  }

  /** strcmp(tokenS[n], word) == 0 */
  is(n: number, word: string): boolean {
    for (let k = 0; k < word.length; k++) {
      if (this.char(n, k) !== word.charCodeAt(k)) return false;
    }
    return this.char(n, word.length) === 0;
  }

  /** `tokenEnd[n]`, or -1 when it is NULL. */
  endOf(n: number): number {
    return n >= 0 && n < MAXT ? this.end[n]! : -1;
  }
}

/** The highlighter's delimiter set ". \t\n" (textS.cpp:1184). */
function isDelimiter(c: number): boolean {
  return c === PERIOD || c === SPACE || c === TAB || c === LF;
}

/**
 * tokenize(instr, ". \t\n", tokenS, tokensS) with `instr` = position `from` of `cap` (a
 * NUL-terminated line from `capitalise`). Returns the tokens; positions in `end` are positions in
 * `cap`.
 */
export function tokenize(cap: Uint16Array, from: number): Tokens {
  const tokens = new Tokens();
  const { buffer, start, end } = tokens;
  let instr = from;
  let tokN = 0;
  let quoted = false;

  while (cap[instr] !== 0 && isSpace(cap[instr]!)) instr++; // skip leading spaces
  if (cap[instr] !== STAR && cap[instr] !== SEMICOLON) {
    // not a comment line
    if (from !== instr) tokN = 1; // no label
    let size = 0;
    while (cap[instr] !== 0 && tokN < MAXT && size < MAX_SIZE) {
      let parenCount = 0;
      start[tokN] = size;
      while (cap[instr] !== 0 && isSpace(cap[instr]!)) instr++;
      if (cap[instr] === QUOTE && cap[instr + 1] === QUOTE) {
        // argument starts with '' (NULL)
        buffer[size++] = 0;
        instr += 2;
      }
      if (cap[instr] === PERIOD) buffer[size++] = cap[instr++]!; // a period starts the next token
      while (cap[instr] !== 0 && (!isDelimiter(cap[instr]!) || parenCount > 0 || quoted) && size < MAX_SIZE - 1) {
        const c = cap[instr]!;
        if (c === QUOTE) quoted = !quoted;
        if (c === LPAREN) parenCount++;
        else if (c === RPAREN) parenCount--;
        buffer[size++] = c;
        instr++;
      }
      buffer[size++] = 0; // terminate
      end[tokN] = instr; // token end position in the line
      if (cap[instr] !== 0 && cap[instr] !== PERIOD) instr++; // skip the delimiter
      tokN++;
      while (cap[instr] !== 0 && isSpace(cap[instr]!)) instr++; // skip trailing spaces
    }
  }
  return tokens;
}
