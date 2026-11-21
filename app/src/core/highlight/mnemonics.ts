// The assembler's instruction table as the highlighter sees it, and `instLookup` (editor-ui §9.5 (c);
// INSTTABL.CPP:733-899, INSTLOOK.CPP:58-148). Owner: E3.
//
// The highlighter needs three facts of an entry: its mnemonic, whether its first "flavor" takes a
// source operand (`flavorPtr && flavorPtr->source`) and whether it is a bit-field instruction
// (`flavorPtr->exec == bitField`). The entries are in the original's order; the lookup is the
// original's binary search over them, so it finds exactly what the original finds.

import { isAlnum, isSpace, MINUS, PERIOD, UNDERSCORE } from './chars';
import type { Tokens } from './tokenize';

/**
 * How an entry of the table behaves in the highlighter:
 * - `source`: the first flavor takes a source operand; the operand field is scanned (9.6);
 * - `none`: a flavor without source operand (ILLEGAL, NOP, RESET, RTE, RTR, RTS, TRAPV): the rest
 *   of the line is Comment;
 * - `bitfield`: like `source`, but "not found" while Assemble Bit Field Instructions is off;
 * - `noFlavor`: no flavor list (directives, structured keywords); the highlighter's earlier tests
 *   catch every one of them, so the lookup never reaches these in practice.
 */
export type MnemonicKind = 'source' | 'none' | 'bitfield' | 'noFlavor';

export interface MnemonicEntry {
  readonly mnemonic: string;
  readonly kind: MnemonicKind;
}

const S: MnemonicKind = 'source';
const N: MnemonicKind = 'none';
const B: MnemonicKind = 'bitfield';
const X: MnemonicKind = 'noFlavor';

/** instTable[] of INSTTABL.CPP:733-899, in the original's order. */
export const INSTRUCTION_TABLE: readonly MnemonicEntry[] = (
  [
    ['ABCD', S],
    ['ADD', S],
    ['ADDA', S],
    ['ADDI', S],
    ['ADDQ', S],
    ['ADDX', S],
    ['AND', S],
    ['ANDI', S],
    ['ASL', S],
    ['ASR', S],
    ['BCC', S],
    ['BCHG', S],
    ['BCLR', S],
    ['BCS', S],
    ['BEQ', S],
    ['BFCHG', B],
    ['BFCLR', B],
    ['BFEXTS', B],
    ['BFEXTU', B],
    ['BFFFO', B],
    ['BFINS', B],
    ['BFSET', B],
    ['BFTST', B],
    ['BGE', S],
    ['BGT', S],
    ['BHI', S],
    ['BHS', S],
    ['BLE', S],
    ['BLO', S],
    ['BLS', S],
    ['BLT', S],
    ['BMI', S],
    ['BNE', S],
    ['BPL', S],
    ['BRA', S],
    ['BSET', S],
    ['BSR', S],
    ['BTST', S],
    ['BVC', S],
    ['BVS', S],
    ['CHK', S],
    ['CLR', S],
    ['CMP', S],
    ['CMPA', S],
    ['CMPI', S],
    ['CMPM', S],
    ['DBCC', S],
    ['DBCS', S],
    ['DBEQ', S],
    ['DBF', S],
    ['DBGE', S],
    ['DBGT', S],
    ['DBHI', S],
    ['DBHS', S],
    ['DBLE', S],
    ['DBLO', S],
    ['DBLOOP', X],
    ['DBLS', S],
    ['DBLT', S],
    ['DBMI', S],
    ['DBNE', S],
    ['DBPL', S],
    ['DBRA', S],
    ['DBT', S],
    ['DBVC', S],
    ['DBVS', S],
    ['DC', X],
    ['DCB', X],
    ['DIVS', S],
    ['DIVU', S],
    ['DS', X],
    ['ELSE', X],
    ['END', X],
    ['ENDF', X],
    ['ENDI', X],
    ['ENDW', X],
    ['EOR', S],
    ['EORI', S],
    ['EQU', X],
    ['EXG', S],
    ['EXT', S],
    ['FAIL', X],
    ['FOR', X],
    ['IF', X],
    ['ILLEGAL', N],
    ['INCBIN', X],
    ['INCLUDE', X],
    ['JMP', S],
    ['JSR', S],
    ['LEA', S],
    ['LINK', S],
    ['LIST', X],
    ['LSL', S],
    ['LSR', S],
    ['MACRO', X],
    ['MEMORY', X],
    ['MOVE', S],
    ['MOVEA', S],
    ['MOVEM', S], // movefl, "only used for syntax highlighting" (INSTTABL.CPP:833)
    ['MOVEP', S],
    ['MOVEQ', S],
    ['MULS', S],
    ['MULU', S],
    ['NBCD', S],
    ['NEG', S],
    ['NEGX', S],
    ['NOLIST', X],
    ['NOP', N],
    ['NOT', S],
    ['OFFSET', X],
    ['OPT', X],
    ['OR', S],
    ['ORG', X],
    ['ORI', S],
    ['PAGE', X],
    ['PEA', S],
    ['REG', X],
    ['REPEAT', X],
    ['RESET', N],
    ['ROL', S],
    ['ROR', S],
    ['ROXL', S],
    ['ROXR', S],
    ['RTE', N],
    ['RTR', N],
    ['RTS', N],
    ['SBCD', S],
    ['SCC', S],
    ['SCS', S],
    ['SECTION', X],
    ['SEQ', S],
    ['SET', X],
    ['SF', S],
    ['SGE', S],
    ['SGT', S],
    ['SHI', S],
    ['SHS', S],
    ['SIMHALT', X],
    ['SLE', S],
    ['SLO', S],
    ['SLS', S],
    ['SLT', S],
    ['SMI', S],
    ['SNE', S],
    ['SPL', S],
    ['ST', S],
    ['STOP', S],
    ['SUB', S],
    ['SUBA', S],
    ['SUBI', S],
    ['SUBQ', S],
    ['SUBX', S],
    ['SVC', S],
    ['SVS', S],
    ['SWAP', S],
    ['TAS', S],
    ['TRAP', S],
    ['TRAPV', N],
    ['TST', S],
    ['UNLESS', X],
    ['UNLK', S],
    ['UNTIL', X],
    ['WHILE', X],
  ] as const
).map(([mnemonic, kind]) => Object.freeze({ mnemonic, kind }));

/** Significant characters of a symbol (`SIGCHARS`, asm.h:129). */
const SIGCHARS = 33;

/** strcmp of two strings of code units, as the C library compares unsigned characters. */
function compare(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/**
 * instLookup(tokenS[n], ...) as the highlighter uses it: the table entry when the lookup reports
 * no severe error, otherwise null. `bitField` is the assembler option "Assemble Bit Field
 * Instructions" (BITflag). Macro names are never found: the assembler's symbol table is empty
 * while editing (editor-ui §9.5 (c)).
 */
export function lookupMnemonic(tokens: Tokens, n: number, bitField: boolean): MnemonicEntry | null {
  // Collect the opcode: the first character always, then letters, digits, '_' and '-'.
  let opcode = '';
  let ended = false; // a NUL among the collected characters ends the C string `opcode`
  let k = 0;
  let i = 0;
  do {
    if (i < SIGCHARS) {
      const c = tokens.char(n, k);
      if (c === 0) ended = true;
      if (!ended) opcode += String.fromCharCode(c);
      i++;
    }
    k++;
  } while (isAlnum(tokens.char(n, k)) || tokens.char(n, k) === UNDERSCORE || tokens.char(n, k) === MINUS);

  // The size code. INV_SIZE_CODE is a minor error and still counts as found; SYNTAX does not.
  const c = tokens.char(n, k);
  if (c === PERIOD) {
    const after = tokens.char(n, k + 2);
    if (!(isSpace(after) || after === 0)) return null; // SYNTAX
  } else if (!isSpace(c) && c !== 0) {
    return null; // SYNTAX
  }

  // Binary search (INSTLOOK.CPP:99-110).
  let lo = 0;
  let hi = INSTRUCTION_TABLE.length - 1;
  let mid: number;
  let cmp: number;
  do {
    mid = Math.trunc((hi + lo) / 2);
    cmp = compare(opcode, INSTRUCTION_TABLE[mid]!.mnemonic);
    if (cmp > 0) lo = mid + 1;
    else if (cmp < 0) hi = mid - 1;
  } while (cmp !== 0 && hi >= lo);

  if (cmp !== 0) return null; // INV_OPCODE (not a macro either)
  const entry = INSTRUCTION_TABLE[mid]!;
  if (entry.kind === 'bitfield' && !bitField) return null; // INV_OPCODE
  return entry;
}
