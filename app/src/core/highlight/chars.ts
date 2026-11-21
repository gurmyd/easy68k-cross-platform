// Character tests and case folding of the original highlighter (editor-ui §9.3, ASSEMBLE.CPP).
// Owner: E3.
//
// The original works on a C string `capLine` with the C runtime's ctype functions in the "C"
// locale. A line of the editor is a JavaScript string; every UTF-16 code unit stands for one
// character of the original's line (the document is Windows-1252, one byte per character).
//
// Characters at or above 0x80 are neither letters, digits nor white space here, and `strcap`
// leaves them unchanged. What the original's runtime did with them is not knowable from the
// source (signed `char` passed to the ctype macros); no table of the highlighter contains such a
// character, so the choice can only move where a label or a mnemonic ends when one is typed.
// See docs/porting/errata/E3.md.

export const NUL = 0x00;
export const TAB = 0x09;
export const LF = 0x0a;
export const SPACE = 0x20;
export const QUOTE = 0x27; // '
export const DQUOTE = 0x22; // "
export const LPAREN = 0x28; // (
export const RPAREN = 0x29; // )
export const STAR = 0x2a; // *
export const COMMA = 0x2c; // ,
export const MINUS = 0x2d; // -
export const PERIOD = 0x2e; // .
export const COLON = 0x3a; // :
export const SEMICOLON = 0x3b; // ;
export const EQUALS = 0x3d; // =
export const LESS = 0x3c; // <
export const GREATER = 0x3e; // >
export const DOLLAR = 0x24; // $
export const UNDERSCORE = 0x5f; // _

/** isspace() in the "C" locale: space, tab, line feed, vertical tab, form feed, carriage return. */
export function isSpace(c: number): boolean {
  return c === SPACE || (c >= 0x09 && c <= 0x0d);
}

/** isdigit() in the "C" locale. */
export function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/** isalnum() in the "C" locale. */
export function isAlnum(c: number): boolean {
  return isDigit(c) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** toupper() in the "C" locale: only a-z change. */
export function toUpper(c: number): number {
  return c >= 0x61 && c <= 0x7a ? c - 0x20 : c;
}

/**
 * The line as the C string the original works on: `strcap` applied (ASSEMBLE.CPP:233-258), ended
 * by a NUL. A NUL inside the line ends the C string there, as `c_str()` would.
 */
export function capitalise(line: string): Uint16Array {
  const nul = line.indexOf('\0');
  const length = nul < 0 ? line.length : nul;
  const cap = new Uint16Array(length + 1); // the last element stays NUL
  let capFlag = true;
  for (let i = 0; i < length; i++) {
    const c = line.charCodeAt(i);
    cap[i] = capFlag ? toUpper(c) : c;
    if (c === QUOTE) capFlag = !capFlag;
  }
  return cap;
}

/**
 * strcap (ASSEMBLE.CPP:233-258): every character upper-cased except those between single quotes;
 * a flag toggles at each `'`. Double quotes do not toggle.
 */
export function strcap(line: string): string {
  const cap = capitalise(line);
  let out = '';
  for (let i = 0; i < cap.length - 1; i++) out += String.fromCharCode(cap[i]!);
  return out;
}

/** skipSpace (ASSEMBLE.CPP:261-273) on a NUL-terminated array: the first position that is not white space. */
export function skipSpace(cap: Uint16Array, p: number): number {
  while (isSpace(cap[p]!)) p++;
  return p;
}
