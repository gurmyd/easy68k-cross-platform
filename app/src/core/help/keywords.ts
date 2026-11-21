// The keyword table of the editor's context help (F1), and the page each keyword opens.
// ARCHITECTURE.md 9.2 (H1); editor-ui §15.2, §15.3. Owner: H1.
//
// The rows are the original's, in its order, typos included: `context[]` of Edit68K's help.cpp
// (identical in Sim68K's), 197 entries. The second column is the context identifier of
// `ez68k.h`, the third the page that the help project's `ez68k.ali` maps it to, spelled with the
// letter case of the file in app/public/help (the original's map writes "reference\68ks8e.htm"
// for the folder "Reference"). The original compares ignoring letter case, takes the first match
// and, for a word that is not in the table, opens the introduction page (`IDH_INTRO`).
//
// The table has `SME`, `SSF` and `SST` where the assembler's mnemonics are `SMI`, `SF` and `ST`, and
// it lacks BHS, BLO, DBF, DBT, ELSE, NARG, MEXIT and others: F1 on those words opens the introduction,
// as in the original. `MOVE USP` (with a space) can only match a selection of exactly that text.

/** The introduction page: what F1 opens for a word that is not a keyword. */
export const INTRO_PAGE = 'main.htm';

/** [keyword, context identifier, page]. */
export type KeywordRow = readonly [keyword: string, context: string, page: string];

export const KEYWORDS: readonly KeywordRow[] = [
  ['EASY68K', 'IDH_INTRO', 'main.htm'],
  ['68000', 'IDH_QUICKREF', 'Quick Reference.htm'],
  ['ABCD', 'IDH_ABCD', 'Reference/68ks8e.htm'],
  ['ADD', 'IDH_ADD', 'Reference/68ks5a.htm'],
  ['ADDA', 'IDH_ADDA', 'Reference/68ks5b.htm'],
  ['ADDI', 'IDH_ADDI', 'Reference/68ks5c.htm'],
  ['ADDQ', 'IDH_ADDQ', 'Reference/68ks5d.htm'],
  ['ADDX', 'IDH_ADDX', 'Reference/68ks5e.htm'],
  ['AND', 'IDH_AND', 'Reference/68ks6a.htm'],
  ['ANDI', 'IDH_ANDI', 'Reference/68ks6b.htm'],
  ['ASCII', 'IDH_ASCII', 'ASCII.htm'],
  ['ASL', 'IDH_ASL', 'Reference/68ks7a.htm'],
  ['ASR', 'IDH_ASR', 'Reference/68ks7b.htm'],
  ['ASSEMBLER', 'IDH_ASSEMBLER_BASIC_OPERATION', 'BasicOperation.htm'],
  ['OPTIONS', 'IDH_EDIT_OPTIONS', 'options.htm'],
  ['BCC', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BCS', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BEQ', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BNE', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BGE', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BGT', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BHI', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BLE', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BLS', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BLT', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BMI', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BPL', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BVC', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BVS', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BRA', 'IDH_BCC', 'Reference/68ks9a.htm'],
  ['BCHG', 'IDH_BCHG', 'Reference/68ks8a.htm'],
  ['BCLR', 'IDH_BCLR', 'Reference/68ks8b.htm'],
  ['BFCHG', 'IDH_BFCHG', 'Reference/bfchg.htm'],
  ['BFCLR', 'IDH_BFCLR', 'Reference/bfclr.htm'],
  ['BFEXTS', 'IDH_BFEXTS', 'Reference/bfexts.htm'],
  ['BFEXTU', 'IDH_BFEXTU', 'Reference/bfextu.htm'],
  ['BFFFO', 'IDH_BFFFO', 'Reference/bfffo.htm'],
  ['BFINS', 'IDH_BFINS', 'Reference/bfins.htm'],
  ['BFSET', 'IDH_BFSET', 'Reference/bfset.htm'],
  ['BFTST', 'IDH_BFTST', 'Reference/bftst.htm'],
  ['BREAKPOINT', 'IDH_SIM_ADVBREAK', 'SIMHELP/AdvBreakpoints.htm'],
  ['BSET', 'IDH_BSET', 'Reference/68ks8c.htm'],
  ['BSR', 'IDH_BSR', 'Reference/68ks9b.htm'],
  ['BTST', 'IDH_BTST', 'Reference/68ks8d.htm'],
  ['CHK', 'IDH_CHK', 'Reference/68ks10a.htm'],
  ['CLR', 'IDH_CLR', 'Reference/68ks5f.htm'],
  ['CMP', 'IDH_CMP', 'Reference/68ks5g.htm'],
  ['CMPA', 'IDH_CMPA', 'Reference/68ks5h.htm'],
  ['CMPI', 'IDH_CMPI', 'Reference/68ks5i.htm'],
  ['CMPM', 'IDH_CMPM', 'Reference/68ks5j.htm'],
  ['CONDITIONAL', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['CREDITS', 'IDH_CREDITS', 'credits.htm'],
  ['DBCC', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBCS', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBEQ', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBNE', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBGE', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBGT', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBHI', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBLE', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBLS', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBLT', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBMI', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBPL', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBVC', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBVS', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBRA', 'IDH_DBCC', 'Reference/68ks9c.htm'],
  ['DBLOOP', 'IDH_STRUCCONTROL_DBLOOP', 'StrucControl/DBloop.htm'],
  ['DC', 'IDH_DIRECT_DC', 'Directives/dc.htm'],
  ['DCB', 'IDH_DIRECT_DCB', 'Directives/dcb.htm'],
  ['DIVS', 'IDH_DIVS', 'Reference/68ks5k.htm'],
  ['DIVU', 'IDH_DIVU', 'Reference/68ks5l.htm'],
  ['DS', 'IDH_DIRECT_DS', 'Directives/ds.htm'],
  ['END', 'IDH_DIRECT_END', 'Directives/end.htm'],
  ['ENDC', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['ENDF', 'IDH_STRUCCONTROL_FOR', 'StrucControl/For.htm'],
  ['ENDI', 'IDH_STRUCCONTROL_IF', 'StrucControl/If.htm'],
  ['ENDM', 'IDH_MACRO', 'Directives/macro.htm'],
  ['ENDW', 'IDH_STRUCCONTROL_WHILE', 'StrucControl/While.htm'],
  ['EOR', 'IDH_EOR', 'Reference/68ks6c.htm'],
  ['EORI', 'IDH_EORI', 'Reference/68ks6d.htm'],
  ['EQU', 'IDH_DIRECT_EQU', 'Directives/equ.htm'],
  ['ERROR', 'IDH_ASSEMBLER_ERROR', 'errors.htm'],
  ['EXCEPTIONS', 'IDH_SIM_EXCEPTIONS', 'SIMHELP/Exceptions.htm'],
  ['EXG', 'IDH_EXG', 'Reference/68ks4a.htm'],
  ['EXPRESSION', 'IDH_STRUCCONTROL_EXSYNTAX', 'StrucControl/ExSyntax.htm'],
  ['EXT', 'IDH_EXT', 'Reference/68ks5m.htm'],
  ['FAIL', 'IDH_DIRECT_FAIL', 'Directives/fail.htm'],
  ['FILE', 'IDH_IO_FILE', 'fileio.htm'],
  ['FOR', 'IDH_STRUCCONTROL_FOR', 'StrucControl/For.htm'],
  ['GOD', 'IDH_PSALMS', 'Reference/68ks23.htm'],
  ['GRAPHICS', 'IDH_IO_GRAPHICS', 'graphics.htm'],
  ['HARDWARE', 'IDH_SIM_HARDWARE', 'SIMHELP/Hardware.htm'],
  ['IF', 'IDH_STRUCCONTROL_IF', 'StrucControl/If.htm'],
  ['IFC', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['IFEQ', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['IFGE', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['IFGT', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['IFLE', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['IFLT', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['IFNC', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['IFNE', 'IDH_CONDITIONAL', 'Directives/conditional.htm'],
  ['ILLEGAL', 'IDH_ILLEGAL', 'Reference/68ks10h.htm'],
  ['INCBIN', 'IDH_DIRECT_INCBIN', 'Directives/incbin.htm'],
  ['INCLUDE', 'IDH_DIRECT_INCLUDE', 'Directives/include.htm'],
  ['JMP', 'IDH_JMP', 'Reference/68ks9d.htm'],
  ['JSR', 'IDH_JSR', 'Reference/68ks9e.htm'],
  ['LEA', 'IDH_LEA', 'Reference/68ks4b.htm'],
  ['LINK', 'IDH_LINK', 'Reference/68ks4c.htm'],
  ['LIST', 'IDH_LIST', 'Directives/list.htm'],
  ['LSL', 'IDH_LSL', 'Reference/68ks7c.htm'],
  ['LSR', 'IDH_LSR', 'Reference/68ks7d.htm'],
  ['MACRO', 'IDH_MACRO', 'Directives/macro.htm'],
  ['MOUSE', 'IDH_IO_PERIPHERAL', 'peripheralio.htm'],
  ['MOVE', 'IDH_MOVE', 'Reference/68ks4d.htm'],
  ['MOVEA', 'IDH_MOVEA', 'Reference/68ks4e.htm'],
  ['MOVEM', 'IDH_MOVEM', 'Reference/68ks4f.htm'],
  ['MOVEP', 'IDH_MOVEP', 'Reference/68ks4g.htm'],
  ['MOVEQ', 'IDH_MOVEQ', 'Reference/68ks4h.htm'],
  ['MOVE USP', 'IDH_MOVE_USP', 'Reference/68ks10b.htm'],
  ['MULS', 'IDH_MULS', 'Reference/68ks5n.htm'],
  ['MULU', 'IDH_MULU', 'Reference/68ks5o.htm'],
  ['NBCD', 'IDH_NBCD', 'Reference/68ks8f.htm'],
  ['NEG', 'IDH_NEG', 'Reference/68ks5p.htm'],
  ['NEGX', 'IDH_NEGX', 'Reference/68ks5q.htm'],
  ['NOLIST', 'IDH_NOLIST', 'Directives/list.htm'],
  ['NOT', 'IDH_NOT', 'Reference/68ks6e.htm'],
  ['NOP', 'IDH_NOP', 'Reference/68ks10i.htm'],
  ['OFFSET', 'IDH_DIRECT_OFFSET', 'Directives/offset.htm'],
  ['OPT', 'IDH_DIRECT_OPT', 'Directives/opt.htm'],
  ['MEX', 'IDH_DIRECT_OPT', 'Directives/opt.htm'],
  ['NOMEX', 'IDH_DIRECT_OPT', 'Directives/opt.htm'],
  ['NOSEX', 'IDH_DIRECT_OPT', 'Directives/opt.htm'],
  ['NOWAR', 'IDH_DIRECT_OPT', 'Directives/opt.htm'],
  ['SEX', 'IDH_DIRECT_OPT', 'Directives/opt.htm'],
  ['WAR', 'IDH_DIRECT_OPT', 'Directives/opt.htm'],
  ['OR', 'IDH_OR', 'Reference/68ks6f.htm'],
  ['ORG', 'IDH_DIRECT_ORG', 'Directives/org.htm'],
  ['ORI', 'IDH_ORI', 'Reference/68ks6g.htm'],
  ['PAGE', 'IDH_DIRECT_PAGE', 'Directives/page.htm'],
  ['PEA', 'IDH_PEA', 'Reference/68ks4i.htm'],
  ['REG', 'IDH_DIRECT_REG', 'Directives/reg.htm'],
  ['REPEAT', 'IDH_STRUCCONTROL_REPEAT', 'StrucControl/Repeat.htm'],
  ['RESET', 'IDH_RESET', 'Reference/68ks10c.htm'],
  ['ROL', 'IDH_ROL', 'Reference/68ks7e.htm'],
  ['ROR', 'IDH_ROR', 'Reference/68ks7f.htm'],
  ['ROXL', 'IDH_ROXL', 'Reference/68ks7g.htm'],
  ['ROXR', 'IDH_ROXR', 'Reference/68ks7h.htm'],
  ['RTE', 'IDH_RTE', 'Reference/68ks10d.htm'],
  ['RTR', 'IDH_RTR', 'Reference/68ks9f.htm'],
  ['RTS', 'IDH_RTS', 'Reference/68ks9g.htm'],
  ['SBCD', 'IDH_SBCD', 'Reference/68ks8g.htm'],
  ['SCC', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SCS', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SEQ', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SGE', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SGT', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SHI', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SLE', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SLS', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SLT', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SME', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SNE', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SPL', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SVC', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SVS', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SSF', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SST', 'IDH_SCC', 'Reference/68ks9h.htm'],
  ['SECTION', 'IDH_DIRECT_SECTION', 'Directives/section.htm'],
  ['SET', 'IDH_DIRECT_SET', 'Directives/set.htm'],
  ['SIMHALT', 'IDH_DIRECT_SIMHALT', 'Directives/simhalt.htm'],
  ['MEMORY', 'IDH_DIRECT_MEMORY', 'Directives/memory.htm'],
  ['SERIAL', 'IDH_IO_SERIAL', 'SerialIo.htm'],
  ['SIMULATOR', 'IDH_SIM_BASIC', 'SIMHELP/BasicOperation.htm'],
  ['SOUND', 'IDH_IO_SOUND', 'sound.htm'],
  ['STACK', 'IDH_SIM_STACK', 'SIMHELP/Stack.htm'],
  ['STOP', 'IDH_STOP', 'Reference/68ks10e.htm'],
  ['STRUCTURED', 'IDH_STRUCCONTROL_INTRO', 'StrucControl/Introduction.htm'],
  ['SUB', 'IDH_SUB', 'Reference/68ks5r.htm'],
  ['SUBA', 'IDH_SUBA', 'Reference/68ks5s.htm'],
  ['SUBI', 'IDH_SUBI', 'Reference/68ks5t.htm'],
  ['SUBQ', 'IDH_SUBQ', 'Reference/68ks5u.htm'],
  ['SUBX', 'IDH_SUBX', 'Reference/68ks5v.htm'],
  ['SWAP', 'IDH_SWAP', 'Reference/68ks4j.htm'],
  ['TAS', 'IDH_TAS', 'Reference/68ks5w.htm'],
  ['TEXT', 'IDH_IO_TEXT', 'textio.htm'],
  ['TRAP', 'IDH_TRAP', 'Reference/68ks10f.htm'],
  ['TRAPV', 'IDH_TRAPV', 'Reference/68ks10g.htm'],
  ['TST', 'IDH_TST', 'Reference/68ks5x.htm'],
  ['UNLK', 'IDH_UNLK', 'Reference/68ks4k.htm'],
  ['UNLESS', 'IDH_STRUCCONTROL_DBLOOP', 'StrucControl/DBloop.htm'],
  ['UNTIL', 'IDH_STRUCCONTROL_REPEAT', 'StrucControl/Repeat.htm'],
  ['WARNING', 'IDH_ASSEMBLER_ERROR', 'errors.htm'],
  ['WHILE', 'IDH_STRUCCONTROL_WHILE', 'StrucControl/While.htm'],
  ['CHARLES', 'IDH_CREDITS', 'credits.htm'],
  ['CURT', 'IDH_CREDITS', 'credits.htm'],
  ['AARON', 'IDH_CREDITS', 'credits.htm'],
];

/**
 * Contexts of the original that no keyword reaches (editor-ui §15.3), with their pages. The port
 * uses the pages of the Simulator ones directly (see ENTRY_PAGES).
 */
export const UNREACHABLE_CONTEXTS: readonly (readonly [context: string, page: string])[] = [
  ['IDH_EASYBIN', 'easybin.htm'],
  ['IDH_IO_NETWORK', 'networkio.htm'],
  ['IDH_SIM_BREAKPOINT', 'SIMHELP/BasicOperation.htm'],
  ['IDH_SIM_MEMORY', 'SIMHELP/Memory.htm'],
  ['IDH_SIM_OPTIONS', 'SIMHELP/SimOptions.htm'],
  ['IDH_SRECORD', 'SRecordDescription.htm'],
];

const BY_KEYWORD: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [keyword, , page] of KEYWORDS) {
    const key = asciiLower(keyword);
    if (!map.has(key)) map.set(key, page); // the first match wins, as in the original's loop
  }
  return map;
})();

/** The case fold of the C library's strcmpi in the "C" locale: only A-Z change (not U+212A and the like). */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** Delphi's Trim: removes the characters up to and including the space (code <= U+0020), nothing else. */
export function trimControl(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start++;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end--;
  return text.slice(start, end);
}

/** The page for a word: a case-insensitive exact match of the table, else the introduction. */
export function pageForKeyword(word: string): string {
  return BY_KEYWORD.get(asciiLower(word)) ?? INTRO_PAGE;
}

/** True if the word is in the table. */
export function isKeyword(word: string): boolean {
  return BY_KEYWORD.has(asciiLower(word));
}
