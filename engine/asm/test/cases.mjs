// Test programs for the assembler engine, one per behaviour, grouped as in
// docs/porting/assembler.md section 3. Every program here was written for
// this test suite (GPL-2.0-or-later, like the rest of easy68k-mac).
//
// Each case: { group, name, spec, main, files?, options?, variants? }
//   main     source lines (CR LF is added after each) or a Uint8Array
//   files    other files: name -> lines or Uint8Array
//   spec     the section of assembler.md the expectation was checked against
//   variants optional list of option sets; the case runs once per variant
// The expected outputs are in expected.mjs, produced from the NATIVE twin
// (tools/snapshot.mjs) and checked against the spec; spec.test.mjs states
// the key claims of the spec independently of that snapshot.

import { raw, src } from './helpers.mjs';

export const CASES = [
  // ------------------------------------------------------------------ 3.1 line anatomy
  {
    group: 'line', name: 'label in column 1, indented label with colon, label alone at an odd address', spec: '3.1.3',
    main: ['START\tORG\t$1000', '\tDC.B\t1', 'ODD', '  IND: NOP', 'L3:NOP', '\tBRA\tODD', '\tEND\tSTART'],
  },
  {
    group: 'line', name: 'opcode in column 1 is a label', spec: '3.1.3',
    main: ['NOP', '\tORG $1000', 'END START'],
  },
  {
    group: 'line', name: '32-, 33- and 40-character labels', spec: '3.1.3',
    main: ['\tORG $1000',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345\tNOP',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456\tNOP',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD\tNOP',
      '\tBRA ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456', '\tEND $1000'],
  },
  {
    group: 'line', name: 'dot, underscore and dollar in labels; a label with a dot cannot be referenced', spec: '3.1.3',
    main: ['\tORG $1000', '_A$B\tNOP', 'A.B\tNOP', '\tBRA _A$B', '\tMOVE.W A.B,D0', '\tEND $1000'],
  },
  {
    group: 'line', name: 'illegal first character', spec: '3.1.3',
    main: ['\tORG $1000', '1ABC\tNOP', '\t@NOP', '\tNOP', '\tEND $1000'],
  },
  {
    group: 'line', name: 'local labels and what ends their scope', spec: '3.1.3',
    main: ['\tORG $1000', 'MAIN\tNOP', '.loop\tBRA .loop', 'VAL\tEQU 5', '.a\tNOP', '\tBRA .a',
      'M\tMACRO', '.x\tNOP', '\tENDM', '.y\tNOP', '\tM', '\tEND $1000'],
    options: { macrosExpanded: true },
  },
  {
    group: 'line', name: 'local label whose mangled name reaches 33 characters', spec: '3.1.3',
    main: ['\tORG $1000', 'ABCDEFGHIJKLMNOPQRSTUVWXY\tNOP', '.LOCALXX\tNOP', '\tBRA .LOCALXX', '\tEND $1000'],
  },
  {
    group: 'line', name: 'duplicate definitions with equal and different values; phase error', spec: '3.1.3',
    main: ['X\tEQU 5', 'X\tEQU 5', 'Y\tEQU 1', 'Y\tEQU 2', '\tORG $1000', '\tBRA FWD', '\tMOVE.L #LATER,D0',
      'FWD\tNOP', 'LATER\tEQU 3', '\tEND $1000'],
  },
  {
    group: 'line', name: 'comment forms', spec: '3.1.2',
    main: ['* star comment', '; semicolon comment', '   * indented star', '\tORG $1000', 'L1 ; after label',
      'L2 * after label', '\tNOP anything goes here', '\tMOVE.L #1 + 2,D0', '\tNOP;x', '\tEND $1000'],
  },
  {
    group: 'line', name: 'lines of 255, 256 and 300 characters are split after 255', spec: '1.3',
    main: ['\tORG $1000', '\tNOP' + ' '.repeat(251), '\tNOP' + ' '.repeat(247) + 'xxxxx',
      '\tNOP' + ' '.repeat(251) + 'NOP' + ' '.repeat(42), '\tEND $1000'],
  },
  {
    group: 'line', name: 'lower case and mixed case', spec: '3.1.1',
    main: ['\torg $1000', 'start\tmove.l #$ff,d0', '\tMove.W D0,D1', '\tdc.b \'aB\',"x"', '\tend start'],
  },
  {
    group: 'line', name: 'bytes >= $80 in strings, comments and labels', spec: '3.3, 9.2',
    main: raw('\tORG $1000\r\n\tDC.B \'\xE9\xE8\'\t; caf\xE9\r\n\tDC.W \'A\xE9\'\r\n\tMOVE.W #\'A\xE9\',D0\r\n\xC9T\tNOP\r\n\tEND $1000\r\n'),
  },

  // ------------------------------------------------------------------ line ends and text mode
  {
    group: 'textmode', name: 'LF-only main source assembles like CR LF', spec: '9.4.1',
    main: src(['\tORG $1000', 'M\tMACRO', '\tNOP', '\tENDM', '\tM', '\tEND $1000'], { eol: '\n' }),
  },
  {
    group: 'textmode', name: 'last line without line end gets one (editor save)', spec: '9.4.1',
    main: src(['\tORG $1000', '\tNOP', '\tEND $1000'], { final: false }),
  },
  {
    group: 'textmode', name: 'Ctrl-Z ends the main source', spec: '9.4.1',
    main: raw('\tORG $1000\r\n\tNOP\r\n\x1A\tNOP\r\n\tEND $1000\r\n'),
  },
  {
    group: 'textmode', name: 'macro temp file counts CR LF: second macro value', spec: '9.4.2',
    main: ['A\tMACRO', '\tNOP', '\tNOP', '\tENDM', 'B\tMACRO', '\tNOP', '\tENDM', '\tORG $1000', '\tA', '\tB', '\tEND $1000'],
  },

  // ------------------------------------------------------------------ 3.2 mnemonic and size
  {
    group: 'size', name: 'size suffix forms', spec: '3.2',
    main: ['\tORG $1000', '\tMOVE.  D0,D1', '\tMOVE. D0,D1', '\tNOP.', '\tMOVE.X D0,D1', '\tMOVE.BD0,D1',
      '\tMOVEC D0,VBR', '\tRTD #4', '\tEND $1000'],
  },
  {
    group: 'size', name: 'bit-field mnemonics with "Assemble Bit Field" off', spec: '2, 3.2',
    main: ['\tORG $1000', '\tBFTST D0{2:4}', '\tEND $1000'],
    options: { bitFieldInstructions: false },
  },
  {
    group: 'size', name: 'OPT BIT enables bit fields and writes the simulator marker', spec: '2, 5.4',
    main: ['\tORG $1000', '\tOPT BIT', '\tBFTST D0{2:4}', '\tBFINS D1,(A0){3:4}', '\tBFEXTU (A1){D2:D3},D4', '\tEND $1000'],
    options: { bitFieldInstructions: false },
  },

  // ------------------------------------------------------------------ 3.3 expressions
  {
    group: 'expr', name: 'operators and the unusual precedence', spec: '3.3',
    main: ['\tORG $1000', '\tDC.L 1+2*3&4>>1', '\tDC.L $F0&$3C!1', '\tDC.L 7\\4', '\tDC.L 10/3', '\tDC.L 6^3',
      '\tDC.L -1+2', '\tDC.L ~0&$F', '\tDC.L --1', '\tDC.L (1+2)*3', '\tDC.L 1<<4|1', '\tDC.L $80000000>>31',
      '\tDC.L %1010', '\tDC.L @17', '\tDC.L -7/2', '\tDC.L -7\\2', '\tDC.L *', '\tDC.L *,*', '\tEND $1000'],
  },
  {
    group: 'expr', name: 'character constants, too-long constants and numbers', spec: '3.3',
    main: ['\tORG $1000', '\tDC.L 0+\'A\',0+\'AB\',0+\'ABC\',0+\'ABCD\'', '\tDC.L 0+\'ABCDE\'', '\tDC.L \'ABC\'', '\tDC.L \'ABCDE\'',
      '\tDC.L \'IT\'\'S\'', '\tDC.L $123456789', '\tDC.L 4294967296', '\tMOVE.L #\'\',D0', '\tEND $1000'],
  },
  {
    group: 'expr', name: 'division by zero, single > and spaces in expressions', spec: '3.3',
    main: ['\tORG $1000', '\tDC.W 1/0', '\tDC.W 1\\0', '\tDC.W 2>1', '\tMOVE.W #(1 + 2),D0', '\tMOVE.W #1 + 2,D0',
      '\tMOVE.W ( 4, A0 ),D0', '\tMOVE.W 12( A0 ),D0', '\tEND $1000'],
  },
  {
    group: 'expr', name: 'undefined symbol followed by +, -, * and inside parentheses', spec: '3.3 error protocol',
    main: ['\tORG $1000', '\tMOVE.W UNDEF,D0', '\tMOVE.W UNDEF+2,D0', '\tMOVE.W UNDEF-2,D0', '\tMOVE.W #UNDEF*2,D0',
      '\tMOVE.W (UNDEF+1),D0', '\tDC.W UNDEF+1,5', '\tDC.W 7,UNDEF', 'AFTER\tNOP', '\tEND $1000'],
  },
  {
    group: 'expr', name: 'INT_MIN divided by -1 raises the exception of routine eval', spec: '9.2, P12',
    main: ['\tORG $1000', '\tDC.L $80000000/-1', '\tDC.L $80000000\\-1', '\tDC.L 5', '\tEND $1000'],
  },
  {
    group: 'expr', name: 'shift counts of 32 and more are taken modulo 32', spec: '9.2, P11',
    main: ['\tORG $1000', '\tDC.L 1<<32', '\tDC.L 1<<33', '\tDC.L $80000000>>33', '\tDC.L 1<<-1', '\tEND $1000'],
  },

  // ------------------------------------------------------------------ 3.4 directives
  {
    group: 'dir', name: 'ORG: odd value, forward reference, size, missing operand', spec: '3.4',
    main: ['\tORG $1001', '\tNOP', '\tORG FWD', '\tORG.W $2000', '\tORG', 'FWD\tNOP', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'SECTION: labels are section numbers, location per section', spec: '3.4',
    main: ['\tORG $1000', '\tNOP', 'S1\tSECTION 1', '\tORG $2000', '\tNOP', '\tSECTION 0', '\tNOP', '\tSECTION 1', '\tNOP',
      'S5\tSECTION', '\tSECTION 16', '\tSECTION 2 JUNK', '\tSECTION', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'OFFSET ... ORG * round trip, OFFSET with a label', spec: '3.4',
    main: ['\tORG $1000', '\tNOP', '\tOFFSET 0', 'F1\tDS.W 1', 'F2\tDS.L 1', '\tNOP', '\tORG *', 'BACK\tNOP',
      'LBL\tOFFSET 4', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'END without operand', spec: '3.4',
    main: ['\tORG $1000', '\tNOP', '\tEND'],
  },
  {
    group: 'dir', name: 'END ; comment is invalid syntax', spec: '3.1.2',
    main: ['\tORG $1000', '\tNOP', '\tEND ; comment'],
  },
  {
    group: 'dir', name: 'END * comment makes the current location the start address', spec: '3.1.2',
    main: ['\tORG $1000', '\tNOP', '\tEND * comment'],
  },
  {
    group: 'dir', name: 'END with a label does not set the start address', spec: '3.4',
    main: ['\tORG $1000', '\tNOP', 'L\tEND $1000'],
  },
  {
    group: 'dir', name: 'END missing; odd END address', spec: '3.4, 4.3',
    main: ['\tORG $1000', '\tNOP'],
  },
  {
    group: 'dir', name: 'END with an odd address', spec: '3.4',
    main: ['\tORG $1000', '\tNOP', '\tEND $1001'],
  },
  {
    group: 'dir', name: 'EQU and SET', spec: '3.4',
    main: ['A\tEQU 5', 'B\tEQU.W 6', '\tEQU 7', 'C\tEQU FWD', 'D\tEQU 1 JUNK', 'E\tEQU 1+', 'S\tSET 1', 'S\tSET S+1',
      'A\tSET 9', '\tORG $1000', 'FWD\tDC.W S,A', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'SET and MACRO lines reached only in pass 2 (forward reference in IFNE)', spec: '9.3.9, P14',
    main: ['\tORG $1000', '\tIFNE FWD', 'S\tSET 5', '\tDC.B S', 'M\tMACRO', '\tNOP', '\tENDM', '\tENDC', 'FWD\tEQU 1', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'DC strings versus constants', spec: '3.4',
    main: ['\tORG $1000', '\tDC.W \'ABC\'', '\tDC.L \'ABCDE\'', '\tDC.B \'AB\', \'C\'', '\tDC.B \'AB\',\'C\'', '\tDC.B \'\'',
      '\tDC.B \'A\'+1', '\tDC.B 1 , 2', '\tDC.W 5(A0)', '\tDC.B 1,"x",2', '\tDC.B 256', '\tDC.W 65536', '\tDC.S 1',
      '\tDC.B', '\tDC.B \'IT\'\'S\'', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'alignment of DC.W, DS, labels and instructions after an odd DC.B', spec: '3.4, 3.1.3',
    main: ['\tORG $1000', '\tDC.B 1', 'W\tDC.W 2', '\tDC.B 3', 'L\tDS.W 1', '\tDC.B 4', 'B\tDS.B 1', 'N\tNOP', '\tDC.B 5',
      'Z\tDS.W 0', '\tDC.B 6', '\tSIMHALT', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'DCB and DS errors', spec: '3.4',
    main: ['\tORG $1000', '\tDCB.B 3,$AA', '\tDCB.W 2,$1234', '\tDCB.L FWD,1', '\tDCB.B -1,0', '\tDCB.B 3 ,1',
      '\tDS.B -1', '\tDS.L FWD', '\tDCB.B $FFFFFF,0', 'FWD\tNOP', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'OPT: words, unknown word in a list, comment as operand, label', spec: '3.4',
    main: ['\tOPT FOO,MEX', '\tOPT ;x', 'L\tOPT CRE', '\tOPT', '\tOPT -MEX', '\tORG $1000',
      'M\tMACRO', '\tNOP', '\tENDM', '\tM', '\tEND $1000'],
    options: { crossReference: false },
  },
  {
    group: 'dir', name: 'FAIL with and without text, FAIL.W, FAIL with %', spec: '3.4, 9.3.4',
    main: ['\tORG $1000', '\tFAIL This is \'my\' text', '\tFAIL', '\tFAIL.W text', '\tFAIL 100% wrong %d %s', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'MEMORY directives and S0 map records', spec: '3.4, 6.3',
    main: ['\tORG $1000', 'X\tNOP', '\tMEMORY ROM $8000,$8FFF', '\tMEMORY READ $9000,$9FFF', '\tMEMORY protected $A000,$AFFF',
      '\tMEMORY INVALID $FF000000,$FFFFFFFF', '\tMEMORY ROM $C000,$CFFF', 'L\tMEMORY READ 0,1', '\tMEMORY FOO 1,2',
      '\tMEMORY ROM FWD,1', 'FWD\tNOP', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'SIMHALT writes its second word at the same address', spec: '3.4, 6.4',
    main: ['\tORG $1000', '\tNOP', '\tDC.B 1', '\tSIMHALT', '\tNOP', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'PAGE marker and label error', spec: '3.4, 5.4',
    main: ['\tORG $1000', '\tNOP', '\tPAGE', 'L\tPAGE', '\tNOP', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'REG and MOVEM', spec: '3.4',
    main: ['\tORG $1000', 'R\tREG D0-D2/A0/A5-A6', 'R2\tREG D7-A1', 'N\tEQU 5', 'BAD\tREG N', '\tREG D0',
      '\tMOVEM.L R,-(SP)', '\tMOVEM.W (SP)+,R', '\tMOVEM D0/D1,(A0)', '\tMOVEM.B D0,(A0)', '\tMOVEM.L D0,N',
      '\tMOVEM.L D0-D1-D2,(A0)', '\tMOVEM.L R3,(A0)', 'R3\tREG D1', '\tMOVEM.L D0,D1', '\tMOVEM.L (A0),N', '\tMOVEM.L (A0),R4', 'R4\tREG D2', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'LIST / NOLIST and an evaluated IF under NOLIST', spec: '3.4, 3.5, 5.2',
    main: ['\tORG $1000', '\tNOP', '\tNOLIST', '\tNOP', '\tIFEQ 0', '\tNOP', '\tENDC', '\tMOVE.B #300,D0', '\tLIST', 'L\tNOP',
      '\tEND $1000'],
  },
  {
    group: 'dir', name: 'pass-1 option leak: a source ending in NOLIST lists no source lines', spec: '1.3',
    main: ['\tORG $1000', '\tNOP', '\tMOVE.B #300,D0', '\tNOLIST', '\tEND $1000'],
  },
  {
    group: 'dir', name: 'pass-1 option leak: OPT NOWAR hides warnings above it, still counted', spec: '1.3, 2',
    main: ['\tORG $1001', '\tNOP', '\tOPT NOWAR', '\tEND'],
  },
  {
    group: 'dir', name: 'pass-1 option leak: OPT MEX at the end expands earlier calls', spec: '2',
    main: ['M\tMACRO', '\tNOP', '\tENDM', '\tORG $1000', '\tM', '\tOPT MEX', '\tEND $1000'],
  },

  // ------------------------------------------------------------------ 3.4.1 INCLUDE / INCBIN
  {
    group: 'include', name: 'INCLUDE quoted, unquoted, in a sub-folder with \\ and /, any case', spec: '3.4.1',
    main: ['\tORG $1000', '\tINCLUDE \'inc1.x68\'', '\tINCLUDE INC2.X68', '\tinclude "sub\\Inc3.x68"', '\tINCLUDE sub/inc4.X68', '\tEND $1000'],
    files: { 'inc1.x68': ['\tNOP'], 'INC2.x68': ['\tRTS'], 'SUB/inc3.X68': ['\tDC.W 3'], 'sub/INC4.x68': ['\tDC.W 4'] },
  },
  {
    group: 'include', name: 'INCLUDE: missing file, no operand, size suffix, label, tab ends no name', spec: '3.4.1',
    main: ['\tORG $1000', '\tINCLUDE missing.x68', '\tINCLUDE', '\tINCLUDE.W inc1.x68', 'L\tINCLUDE inc1.x68',
      '\tINCLUDE inc1.x68\tcomment', '\tBRA L', '\tEND $1000'],
    files: { 'inc1.x68': ['\tNOP'] },
  },
  {
    group: 'include', name: 'INCLUDE: * lines and ~ second-character lines are skipped, trailer ignored', spec: '3.4.1',
    main: ['\tORG $1000', '\tINCLUDE inc.x68', '\tEND $1000'],
    files: { 'inc.x68': ['* skipped comment', ' * listed comment', '; listed comment', '\tNOP', 'X~ not assembled', '',
      '*~Font name~Courier New~', '*~Tab type~1~'] },
  },
  {
    group: 'include', name: 'INCLUDE: error inside, nested include, line numbers and file of messages', spec: '3.4.1, 4.4',
    main: ['\tORG $1000', '\tNOP', '\tINCLUDE a.x68', '\tMOVE.B #300,D0', '\tEND $1000'],
    files: { 'a.x68': ['\tNOP', '\tBOGUS', '\tINCLUDE b.x68', '\tBOGUS2'], 'b.x68': ['\tNOP', '\tNOP', '\tBOGUS3'] },
  },
  {
    group: 'include', name: 'INCLUDE: END inside the include ends the assembly', spec: '3.4.1',
    main: ['\tORG $1000', '\tINCLUDE e.x68', '\tNOP', '\tBOGUS'],
    files: { 'e.x68': ['\tNOP', '\tEND $1000', '\tBOGUS'] },
  },
  {
    group: 'include', name: 'INCLUDE: last line without line end (bare label) and object code on the end line', spec: '3.1.3, 3.4.1',
    main: ['\tORG $1000', '\tINCLUDE l.x68', '\tINCLUDE r.x68', '\tEND $1000'],
    files: { 'l.x68': raw('\tNOP\r\nLAST'), 'r.x68': raw('\tNOP\r\n\tRTS') },
  },
  {
    group: 'include', name: 'INCLUDE file: CR LF, LF and Ctrl-Z (text mode per file)', spec: '9.4.1',
    main: ['\tORG $1000', '\tINCLUDE crlf.x68', '\tINCLUDE lf.x68', '\tINCLUDE z.x68', '\tEND $1000'],
    files: {
      'crlf.x68': raw('M\tMACRO\r\n\tNOP\r\n\tENDM\r\n\tM\r\n'),
      'lf.x68': raw('\tDC.W 1\n\tDC.W 2\n'),
      'z.x68': raw('\tDC.W 3\r\n\x1A\tDC.W 4\r\n'),
    },
  },
  {
    group: 'include', name: 'INCLUDE file with a lone CR inside a line', spec: '9.4.1 (ez_file.cpp EZ_TEXT_DROP_ALL_CR)',
    main: ['\tORG $1000', '\tINCLUDE cr.x68', '\tEND $1000'],
    files: { 'cr.x68': raw('\tDC.W 1\r\tDC.W 2\r\n') },
  },
  {
    group: 'include', name: 'INCLUDE that includes itself stops when no file can be opened', spec: '3.4.1 (open-file limit)',
    main: ['\tORG $1000', '\tINCLUDE self.x68', '\tEND $1000'],
    files: { 'self.x68': ['\tNOP', '\tINCLUDE self.x68'] },
  },
  {
    group: 'incbin', name: 'INCBIN odd length, missing file, label, binary bytes untouched', spec: '3.4.1',
    main: ['\tORG $1000', 'DATA\tINCBIN \'data.bin\'', '\tINCBIN nothere.bin', '\tNOP', '\tLEA DATA,A0', '\tEND $1000'],
    files: { 'data.bin': raw('\r\n\x1A\x00\xFF\n\r') },
  },

  // ------------------------------------------------------------------ 3.5 conditionals
  {
    group: 'cond', name: 'IFxx true and false, nesting three deep, comments in skipped blocks', spec: '3.5',
    main: ['\tORG $1000', '\tIFEQ 0', '\tDC.B 1', '\tENDC', '\tIFNE 0', '\tDC.B 2', '* listed comment', '\tIFEQ 0', '\tDC.B 3',
      '\tIFEQ 0', '\tDC.B 4', '\tENDC', '\tENDC', '\tDC.B 5', '\tENDC', '\tIFLT -1', '\tDC.B 6', '\tENDC', '\tIFLE 1', '\tDC.B 7',
      '\tENDC', '\tIFGT 1', '\tDC.B 8', '\tENDC', '\tIFGE -1', '\tDC.B 9', '\tENDC', '\tIFC ABC,abc', '\tDC.B 10', '\tENDC',
      '\tIFNC A,B', '\tDC.B 11', '\tENDC', '\tEND $1000'],
  },
  {
    group: 'cond', name: 'label on IFxx, missing operand, undefined symbol, IFC A ,A', spec: '3.5',
    main: ['\tORG $1000', 'L\tIFEQ 0', '\tDC.B 1', '\tENDC', '\tIFEQ', '\tDC.B 2', '\tENDC', '\tIFNC A', '\tDC.B 3', '\tENDC',
      '\tIFNE UNDEF', '\tDC.B 4', '\tENDC', '\tIFNE \'A\'', '\tDC.B 5', '\tENDC', '\tIFC A ,A', '\tDC.B 6', '\tENDC',
      '\tIFC A  A', '\tDC.B 7', '\tENDC', '\tEND $1000'],
  },
  {
    group: 'cond', name: 'missing ENDC skips to the end of the file', spec: '3.5',
    main: ['\tORG $1000', '\tNOP', '\tIFNE 0', '\tNOP', '\tEND $1000'],
  },

  // ------------------------------------------------------------------ 3.6 macros
  {
    group: 'macro', name: 'arguments \\0..\\9, \\A, NARG, \\@ and the size argument', spec: '3.6',
    main: ['M\tMACRO', '\tDC.\\0 \\1,\\2,\\A', 'L\\@\tDC.B NARG', '\tENDM', '\tORG $1000', '\tM 1,2,3,4,5,6,7,8,9,10',
      '\tM.B 3,4', '\tM.L 5', '\tM.S 6', '\tM', '\tEND $1000'],
    options: { macrosExpanded: true },
  },
  {
    group: 'macro', name: '<text> arguments, \'\' null arguments, A, B versus A ,B', spec: '3.6',
    main: ['M\tMACRO', '\tDC.B NARG', '\tDC.B \'\\1\'', '\tENDM', '\tORG $1000', '\tM <1,2>', '\tM <A<B>C>', '\tM <<GT>>',
      '\tM \'IT\'\'S\'', '\tM A, B', '\tM A ,B', '\tM \'\',X', '\tM this is a comment', '\tEND $1000'],
    options: { macrosExpanded: true },
  },
  {
    group: 'macro', name: '35 and 36 arguments', spec: '3.6',
    main: ['M\tMACRO', '\tDC.B NARG', '\tENDM', '\tORG $1000',
      '\tM ' + Array.from({ length: 35 }, (_, k) => String(k + 1)).join(','),
      '\tM ' + Array.from({ length: 36 }, (_, k) => String(k + 1)).join(','), '\tEND $1000'],
  },
  {
    group: 'macro', name: 'continuation lines and the line numbers after them', spec: '3.6, 4.4',
    main: ['M\tMACRO', '\tDC.B \\1,\\2,\\3', '\tENDM', '\tORG $1000', '\tM 1,', '& 2,', '& 3', '\tM 4,', 'no ampersand',
      '\tMOVE.B #300,D0', '\tEND $1000'],
  },
  {
    group: 'macro', name: 'IFARG, MEXIT, nested macros and \\@ numbering', spec: '3.6',
    main: ['INNER\tMACRO', 'I\\@\tDC.B 1', '\tENDM', 'OUTER\tMACRO', 'O\\@\tDC.B 2', '\tIFARG 1', '\tDC.B \\1', '\tENDC',
      '\tINNER', '\tMEXIT', '\tDC.B 99', '\tENDM', '\tORG $1000', '\tOUTER 7', '\tOUTER', '\tEND $1000'],
    options: { macrosExpanded: true },
  },
  {
    group: 'macro', name: 'IFARG inside a false IFxx, argument present and absent', spec: '3.6',
    main: ['M\tMACRO', '\tIFEQ 1', '\tIFARG 1', '\tENDC', '\tDC.B 2', '\tENDC', '\tDC.B 3', '\tENDM', '\tORG $1000', '\tM X', '\tM',
      '\tEND $1000'],
  },
  {
    group: 'macro', name: 'forward use, duplicate definition, MACRO without label', spec: '3.6',
    main: ['\tORG $1000', '\tFWD', 'AFTER\tNOP', 'FWD\tMACRO', '\tNOP', '\tENDM', 'FWD\tMACRO', '\tDC.W 1', '\tENDM',
      '\tMACRO', '\tNOP', '\tENDM', '\tEND $1000'],
  },
  {
    group: 'macro', name: 'missing ENDM disables macro expansion', spec: '3.6',
    main: ['\tORG $1000', 'OK\tMACRO', '\tNOP', '\tENDM', '\tOK', 'BAD\tMACRO', '\tNOP', '\tEND $1000'],
  },
  {
    group: 'macro', name: 'binary constants and a valid printf conversion in macro body lines', spec: '9.3.4, P5',
    main: ['M\tMACRO', '\tAND.B #%00001111,D0 ; 50% done', '\tDC.B \'%d%s%%\'', '\tENDM', '\tORG $1000', '\tM', '\tEND $1000'],
    options: { macrosExpanded: true },
  },
  {
    group: 'macro', name: 'expanded line longer than 255 characters', spec: '9.3.8, P8',
    main: ['M\tMACRO', '\tDC.B \\1,\\1,\\1', '\tENDM', '\tORG $1000', '\tM <' + '1,'.repeat(60) + '1>', '\tNOP', '\tEND $1000'],
  },
  {
    group: 'macro', name: 'structured code inside a macro, label on the call', spec: '3.6',
    main: ['M\tMACRO', '\tIF D0 <EQ> #1 THEN', '\tNOP', '\tENDI', '\tENDM', '\tORG $1000', 'CALL\tM', '\tBRA CALL', '\tEND $1000'],
    options: { macrosExpanded: true, structuredExpanded: true },
  },

  // ------------------------------------------------------------------ 3.7 structured
  {
    group: 'stc', name: 'IF/ELSE/ENDI, WHILE/ENDW, REPEAT/UNTIL with sizes, extents, AND, OR', spec: '3.7',
    main: ['\tORG $1000', '\tIF.B D0 <GT> #5 THEN.S', '\tNOP', '\tELSE', '\tNOP', '\tENDI', '\tIF D1 <EQ> D2 AND.L D3 <NE> #0 THEN',
      '\tNOP', '\tENDI', '\tIF <CS> OR <VS> THEN', '\tNOP', '\tENDI', '\tWHILE.W (A0)+ <NE> (A1)+ DO', '\tNOP', '\tENDW',
      '\tWHILE <T> DO', '\tNOP', '\tENDW', '\tREPEAT', '\tNOP', '\tUNTIL.L #5 <LE> D4', '\tEND $1000'],
    options: { structuredExpanded: true },
  },
  {
    group: 'stc', name: 'FOR TO/DOWNTO/BY and DBLOOP/UNLESS', spec: '3.7',
    main: ['\tORG $1000', '\tFOR.L D0 = #1 TO #10 DO.S', '\tNOP', '\tENDF', '\tFOR D1 = D1 DOWNTO #0 BY #2 DO', '\tNOP', '\tENDF',
      '\tDBLOOP D4 = #5', '\tNOP', '\tUNLESS', '\tDBLOOP D5 = D5', '\tNOP', '\tUNLESS.B D0 <EQ> #3', '\tDBLOOP D6 = #1', '\tUNLESS <F>',
      '\tEND $1000'],
    options: { structuredExpanded: true },
  },
  {
    group: 'stc', name: 'missing THEN / DO, unknown condition, mismatched and empty-stack terminators', spec: '3.7, 9.3.6',
    main: ['\tORG $1000', '\tENDI', '\tIF D0 <EQ> #1', '\tNOP', '\tENDW', '\tWHILE D0 <XX> #1 DO', '\tENDF', '\tREPEAT', '\tUNTIL D0 <EQ> D1',
      '\tUNLESS', '\tEND $1000'],
  },
  {
    group: 'stc', name: 'unclosed IF, indented LBL: IF, IF with VAR.L, more than 9 IFs (hex labels)', spec: '3.7',
    main: ['\tORG $1000', ...Array.from({ length: 11 }, () => ['\tIF D0 <EQ> #1 THEN', '\tENDI']).flat(),
      '  LBL: IF D0 <EQ> #1 THEN', 'VAR\tDC.L 1', '\tIF D0 <EQ> VAR.L THEN', '\tENDI', '\tIF D1 <NE> D2 THEN', '\tEND $1000'],
    options: { structuredExpanded: true },
  },

  // ------------------------------------------------------------------ 3.8 extensions and quirks
  {
    group: 'quirk', name: 'automatic MOVEQ / ADDQ / SUBQ and #n.L', spec: '3.8',
    main: ['\tORG $1000', '\tMOVE.L #5,D0', '\tMOVE.L #5.L,D0', '\tMOVE.L #FWD,D0', '\tADD.W #8,D1', '\tADDI.L #1,(A0)',
      '\tSUB.W #3,A1', '\tADD.W #100,D0', '\tAND.W #1,D0', '\tMOVEQ #200,D0', '\tMOVEQ #300,D0', '\tMOVE.L #5.W,D0', 'FWD\tEQU 5',
      '\tEND $1000'],
  },
  {
    group: 'quirk', name: 'branch sizing and absolute short/long', spec: '3.8',
    main: ['\tORG $1000', 'B\tNOP', '\tBRA B', '\tBRA F', '\tBRA.S F', '\tBRA.L B', '\tBRA.S N', 'N\tNOP', 'F\tNOP',
      '\tMOVE.W $1234,D0', '\tMOVE.W $12345,D0', '\tMOVE.W $FFFF8000,D0', '\tMOVE.W $1234.L,D0', '\tMOVE.W $12345.W,D0',
      '\tMOVE.W FWD2,D0', 'FWD2\tNOP', '\tEND $1000'],
  },
  {
    group: 'quirk', name: '5.16.1 regressions in OPPARSE.CPP: (d,An) and (d,PC,Xn)', spec: '8.3',
    main: ['\tORG $1000', 'TABLE\tDC.W 1,2,3,4', 'PTR\tEQU 8', 'SCORE\tEQU 4', '\tMOVE.W (TABLE,PC,D0.W),D1', '\tMOVE.W TABLE(PC,D0.W),D1',
      '\tMOVE.W (PC,D0.W),D1', '\tMOVE.W (PC,A1),D2', '\tMOVE.W ($C,A0),D1', '\tMOVE.W (PTR,A0),D1', '\tMOVE.W (SCORE,A0,D1.L),D2',
      '\tMOVE.W ($1C,A0),D1', '\tJMP (TABLE,PC,D1.W)', '\tLEA (TABLE,PC,D0.L),A0', '\tBTST #3,(TABLE,PC,D0.W)', '\tMOVE.W (SCORE,PC),D0',
      '\tMOVE.W PTR(A0),D0', '\tEND $1000'],
  },
  {
    group: 'quirk', name: 'parenthesised absolute address next to An; (PC) forms; NULL from eval in opParse', spec: '3.8, 8.3, P13',
    main: ['\tORG $1000', 'TABLE\tDC.L 0', '\tMOVE.L (TABLE+4),D0', '\tMOVE.L D0,(TABLE+4)', '\tMOVE.L (TABLE+4),A0', '\tLEA (TABLE),A1',
      '\tMOVE.W D0,(TABLE) ; x,A0', '\tJMP (PC)', '\tMOVE.W (1+,A0),D0', '\tMOVE.W (1+,PC),D0', '\tEND $1000'],
  },
  {
    group: 'quirk', name: 'index registers, address-mode spellings, SP', spec: '3.8',
    main: ['\tORG $1000', '\tMOVE.W 4(A0,D1),D0', '\tMOVE.W 4(A0,D1.L),D0', '\tMOVE.W (4,A0,A1.W),D0', '\tMOVE.W (A0,D1),D0',
      '\tMOVE.W -(SP),(SP)+', '\tMOVE.W (SP),D0', '\tMOVE.L USP,A0', '\tMOVE SR,D0', '\tMOVE #1,CCR', '\tMOVE.W 4(A0,SP),D0',
      '\tMOVE.W 4(A0,D1.X),D0', '\tEND $1000'],
  },

  // ------------------------------------------------------------------ outputs
  {
    group: 'output', name: 'S1 / S2 / S3 records, record splitting, S8 with a 3-byte address', spec: '6',
    main: ['\tORG $FFF0', '\tDCB.B 40,$11', '\tORG $123456', '\tDC.L 1,2', '\tORG $01000000', '\tDC.W 3', '\tORG $1000',
      'S\tDCB.W 20,$2222', '\tEND S'],
  },
  {
    group: 'output', name: 'long DC with Constants Expanded off and on', spec: '5.3',
    main: ['\tORG $1000', '\tDC.B 1,2,3,4,5,6,7,8,9', '\tDC.W 1,2,3,4,5', '\tDC.L 1,2,3', '\tDCB.B 9,1', '\tEND $1000'],
    variants: [{}, { constantsExpanded: true }],
  },
  {
    group: 'output', name: 'symbol table order and contents', spec: '5.5',
    main: ['\tORG $1000', 'zeta\tNOP', 'ALPHA\tNOP', '_under\tNOP', 'A\tNOP', 'VERYLONGSYMBOLNAME_X\tNOP', 'M\tMACRO', '\tENDM',
      'R\tREG D0', 'NEG\tEQU -1', 'S\tSECTION 3', '.loc\tNOP', '\tIF D0 <EQ> #1 THEN', '\tENDI', '\tEND $1000'],
  },
  {
    group: 'output', name: 'tab expansion: Fixed sizes and Assembly tabs', spec: '5.2',
    main: ['\tORG\t$1000', 'LBL\tMOVE.L\t#1,D0\t; comment', 'A2345678901\tNOP\tx\ty\tz', '\tEND\t$1000'],
    variants: [{ tabType: 'fixed', tabSize: 4 }, { tabType: 'fixed', tabSize: 8 }, { tabType: 'assembly' },
      { tabType: 'fixed', tabSize: 20 }],
  },
  {
    group: 'output', name: 'fixed tab size 0: every listed line with a tab raises the listLine exception', spec: '9.3.9',
    main: ['\tORG $1000', ' NOP', '\tNOP', ' END $1000'],
    options: { tabType: 'fixed', tabSize: 0 },
  },
  {
    group: 'output', name: 'listing and S-record switched off', spec: '2',
    main: ['\tORG $1000', '\tNOP', '\tMOVE.B #300,D0', '\tEND $1000'],
    variants: [{ generateListing: false }, { generateSRecord: false }, { showWarnings: false, crossReference: false }],
  },
  {
    group: 'output', name: 'undefined symbol in a structured line, label of a rejected mnemonic', spec: '1.5, 3.1.3',
    main: ['\tORG $1000', 'LBL\tBOGUS D0', '\tBRA LBL', '\tEND $1000'],
  },
];
