// Further cases of the highlighter, each traced through textS.cpp:1144-1571 by hand: the structured
// forms, the relational patterns, the directive and opcode branches and the quirks of the
// original that students see. Owner: E3.

import { describe, expect, it } from 'vitest';
import type { SyntaxElement } from '../../contracts';
import { highlightLine, highlightStyles, toSpans, type HighlightSpan } from './highlight';
import { DIRECTIVES } from './classify';

type Part = readonly [text: string, style: SyntaxElement];

/** The listed parts, left to right, in their styles; every other character Code. */
function spans(line: string, parts: readonly Part[]): HighlightSpan[] {
  const styles = new Array<SyntaxElement>(line.length).fill('code');
  let cursor = 0;
  for (const [text, style] of parts) {
    const at = line.indexOf(text, cursor);
    if (at < 0) throw new Error(`"${text}" not found in "${line}" after column ${cursor}`);
    styles.fill(style, at, at + text.length);
    cursor = at + text.length;
  }
  const out: HighlightSpan[] = [];
  let from = 0;
  for (let i = 1; i <= styles.length; i++) {
    if (i === styles.length || styles[i] !== styles[from]) {
      out.push({ from, to: i, style: styles[from]! });
      from = i;
    }
  }
  return out;
}

const on = { bitField: true };
const check = (line: string, parts: readonly Part[], options = on) =>
  expect(highlightLine(line, options)).toEqual(spans(line, parts));

describe('structured statements (9.5 b)', () => {
  it.each([
    // [line, accepted]
    ['    IF <EQ> THEN', true], // pattern 14
    ['    IF D0 <EQ> #1 AND D1 <NE> #2 THEN', true], // pattern 3
    ['    IF D0 <EQ> #1 OR D1 <NE> #2 THEN', true], // pattern 4
    ['    IF D0 <EQ> #1 AND.L D1 <NE> #2 THEN', true], // pattern 1
    ['    IF D0 <EQ> #1 OR.W D1 <NE> #2 THEN', true], // pattern 2
    ['    IF <EQ> AND.B D1 <NE> #2 THEN', true], // pattern 5
    ['    IF <EQ> OR.B D1 <NE> #2 THEN', true], // pattern 6
    ['    IF <EQ> AND D1 <NE> #2 THEN', true], // pattern 7
    ['    IF <EQ> OR D1 <NE> #2 THEN', true], // pattern 8
    ['    IF D0 <EQ> #1 AND <CS> THEN', true], // pattern 9
    ['    IF D0 <EQ> #1 OR <CS> THEN', true], // pattern 10
    ['    IF <EQ> AND <CS> THEN', true], // pattern 11
    ['    IF <EQ> OR <CS> THEN', true], // pattern 12
    ['    IF D0 <EQ> #1 THEN', true], // pattern 13
    ['    IF D0.B <EQ> #1 THEN', false], // a size suffix on an operand is not accepted
    ['    IF D0 <EQ> #1 AND THEN', false],
    ['    IF D0 <EQUAL> #1 THEN', false],
    ['    IF D0 <EQ> #1', false],
    ['    IF', false],
    ['    WHILE.B D0 <LT> D1 DO', true],
    ['    WHILE <T> DO.S', true],
    ['    WHILE <T> THEN', false],
    ['    WHILE <F> DO', false], // only <T> is special-cased; "<F>" has no '>' as fourth character
    ['    FOR.L D0 = #10 DOWNTO #1 DO.S', true],
    ['    FOR D0 = #1 TO #10 BY #2 THEN', false],
    ['    FOR D0 = #1 UPTO #10 DO', false],
    ['    UNLESS', true],
    ['    UNLESS <F>', true],
    ['    UNLESS <CS>', false], // only <F> stands alone
    ['    UNLESS D0', false],
    ['    UNLESS.L D0 <GT> D1', true],
    ['    DBLOOP D7 = #3', true],
    ['    DBLOOP A0 = #1', false],
    ['    DBLOOP D0 =', false],
    ['    DBLOOP D0 =#1', false], // "=#1" is one token, so token 4 is empty
    ['    UNTIL <NE> DO', true],
    ['    UNTIL D0 <EQ> #0', false],
    ['    ENDF', true],
    ['    ENDW', true],
  ])('%s: %s', (line, accepted) => {
    const statement = line.trimStart();
    check(line, [[statement, accepted ? 'structure' : 'error']]);
  });

  it('the Structured style ends at the statement; what follows is Comment', () => {
    check('    IF D0 <EQ> #1 THEN.L   test it', [
      ['IF D0 <EQ> #1 THEN.L', 'structure'],
      ['test it', 'comment'],
    ]);
    check('    ELSE.S  otherwise', [
      ['ELSE.S', 'structure'],
      ['otherwise', 'comment'],
    ]);
    check('    ENDW.S x', [
      ['ENDW.S', 'structure'],
      ['x', 'comment'],
    ]);
    check('    UNLESS <F> skip', [
      ['UNLESS <F>', 'structure'],
      ['skip', 'comment'],
    ]);
    check('    REPEAT  forever and ever', [
      ['REPEAT', 'structure'],
      ['forever and ever', 'comment'],
    ]);
  });

  it('a label before a structured statement', () => {
    check('TOP  IF D0 <EQ> #1 THEN', [
      ['TOP', 'label'],
      ['IF D0 <EQ> #1 THEN', 'structure'],
    ]);
    check('  top: WHILE <T> DO', [
      ['  top:', 'label'],
      ['WHILE <T> DO', 'structure'],
    ]);
  });

  it('quirk: the <cc> test reads past a short token into the next one (tokenS[n][3])', () => {
    // "<E" is followed in the token buffer by ">X", so its fourth character is '>'.
    check('    IF D0 <E >X THEN', [['IF D0 <E >X THEN', 'structure']]);
    check('    IF D0 <E X THEN', [['IF D0 <E X THEN', 'error']]);
  });
});

describe('directives (9.5 a)', () => {
  it('recognises all 32 directives, with or without a size', () => {
    expect(DIRECTIVES).toHaveLength(32);
    for (const name of DIRECTIVES) {
      const line = `    ${name}`;
      check(line, [[name, 'directive']]);
      check(`    ${name.toLowerCase()}.l`, [[`${name.toLowerCase()}.l`, 'directive']]);
    }
  });

  it('the first seven take no operand: the rest of the line is Comment', () => {
    for (const name of ['ENDC', 'ENDM', 'LIST', 'NOLIST', 'PAGE', 'MEXIT', 'SIMHALT']) {
      check(`    ${name}  D0,D1 more`, [
        [name, 'directive'],
        ['D0,D1 more', 'comment'],
      ]);
    }
  });

  it('the others scan one operand field; MEMORY scans two', () => {
    check('    OPT     CRE,MEX   options', [
      ['OPT', 'directive'],
      ['options', 'comment'],
    ]);
    check('    ORG     $1000 $2000', [
      ['ORG', 'directive'],
      ['$2000', 'comment'],
    ]);
    check('    MEMORY  ROM $1000 $2000', [
      ['MEMORY', 'directive'],
      ['$2000', 'comment'],
    ]);
    check('    DC.W    1 , 2 ,3   blanks around commas', [
      ['DC.W', 'directive'],
      ['blanks around commas', 'comment'],
    ]);
  });

  it('FAIL leaves the rest of the line in Code', () => {
    check('ERR  FAIL    no "quotes" scanned', [
      ['ERR', 'label'],
      ['FAIL', 'directive'],
    ]);
  });

  it('strings in single and double quotes are Text; an unclosed one is Structure Error', () => {
    check('    DC.B    "Hi",13,10,\'x\'', [
      ['DC.B', 'directive'],
      ['"Hi"', 'text'],
      ["'x'", 'text'],
    ]);
    check('    DC.B    "open', [
      ['DC.B', 'directive'],
      ['"open', 'error'],
    ]);
    check("    DC.B    '',0", [
      ['DC.B', 'directive'],
      ["''", 'text'],
    ]);
  });

  it('an unclosed parenthesis of a directive is an error from the operand field', () => {
    check('    DC.W    (1+2', [
      ['DC.W', 'directive'],
      ['(1+2', 'error'],
    ]);
  });
});

describe('opcodes (9.5 c)', () => {
  it('opcodes without a source operand: the rest of the line is Comment', () => {
    for (const name of ['ILLEGAL', 'NOP', 'RESET', 'RTE', 'RTR', 'RTS', 'TRAPV']) {
      check(`    ${name}    D0,D1`, [['D0,D1', 'comment']]);
      check(`    ${name}`, []);
    }
  });

  it('the operand field of an opcode ends at the first word not preceded by a comma', () => {
    check('    MOVE.L  D0 , D1 now', [['now', 'comment']]);
    check('    LEA     (A0,D0.W),A1   index', [['index', 'comment']]);
    check("    CMP.B   #' ',D0   blank", [
      ["' '", 'text'],
      ['blank', 'comment'],
    ]);
  });

  it('a ";" right after the operands is not special', () => {
    check('    MOVE D0,D1;nocomment', []);
    check('    MOVE D0,D1;no comment', [['comment', 'comment']]);
  });

  it('an unclosed parenthesis of an opcode is an error from the mnemonic', () => {
    check('    JMP (A0', [['JMP (A0', 'error']]);
  });

  it('quirk: after a string the error range starts behind the string', () => {
    check("    MOVE.B  #'A',(A0", [
      ["'A'", 'text'],
      [',(A0', 'error'],
    ]);
  });

  it("quirk: an operand that starts with '' is an empty token, so the operands are not scanned", () => {
    check("    MOVE.B  '' 'x", []);
  });

  it('bit-field mnemonics depend on the option', () => {
    for (const name of ['BFCHG', 'BFCLR', 'BFEXTS', 'BFEXTU', 'BFFFO', 'BFINS', 'BFSET', 'BFTST']) {
      check(`    ${name}  (A0){0:8}`, []);
      check(`    ${name}  (A0){0:8}`, [[`${name}  (A0){0:8}`, 'unknown']], { bitField: false });
    }
  });

  it('mnemonics end at a character other than a letter, digit, "_" or "-"', () => {
    check('    MOVE(A0),D0', [['MOVE(A0),D0', 'unknown']]);
    check('    MOVE-X D0', [['MOVE-X D0', 'unknown']]);
    check('    MOVEX D0', [['MOVEX D0', 'unknown']]);
    check('    nop', []);
  });

  it('macro calls are never recognised, even next to their definition', () => {
    check('PRINT   MACRO', [
      ['PRINT', 'label'],
      ['MACRO', 'directive'],
    ]);
    check('        PRINT   msg', [['PRINT   msg', 'unknown']]);
  });
});

describe('labels and comments (9.3)', () => {
  it('an indented * or ; makes the whole line a comment', () => {
    check('\t* note', [['\t* note', 'comment']]);
  });

  it('a column-0 run is the label, even without a colon or with an opcode name', () => {
    check('START', [['START', 'label']]);
    check('MOVE.B D0,D1', [
      ['MOVE.B', 'label'],
      ['D0,D1', 'unknown'],
    ]);
    check('$1000   DC.B 1', [
      ['$1000', 'label'],
      ['DC.B', 'directive'],
    ]);
  });

  it('a comment right after the label', () => {
    check('START;note', [
      ['START', 'label'],
      [';note', 'comment'],
    ]);
    check('  here:   * note', [
      ['  here:', 'label'],
      ['* note', 'comment'],
    ]);
  });

  it('quirk: a label with an interior period shifts the operation, which shows as Macro/Other', () => {
    check('my.label  MOVE D0,D1', [
      ['my.label', 'label'],
      ['MOVE D0,D1', 'unknown'],
    ]);
  });

  it('quirk: a column-0 label glued to its operation with ":" makes the line Macro/Other', () => {
    check('LOOP:ADD D0,D1', [
      ['LOOP:', 'label'],
      ['ADD D0,D1', 'unknown'],
    ]);
  });

  it('quirk: a zero-length label in column 0 makes the whole line Macro/Other', () => {
    check('#1 junk', [['#1 junk', 'unknown']]);
  });

  it('quirk 9.7: the local label after a branch is taken for a size suffix', () => {
    check('    BRA     .loop', []);
    check('    BRA     .loop   back', []);
    check('    BRA     .loop   go back', [['back', 'comment']]);
  });

  it('tabs separate fields like blanks', () => {
    check('START\tMOVE.B\t#1,D0\t; comment', [
      ['START', 'label'],
      ['; comment', 'comment'],
    ]);
  });
});

describe('robustness', () => {
  it('handles lines far longer than the original 255-character buffer', () => {
    const text = 'x'.repeat(2000);
    const line = `    DC.B    '${text}'   end`;
    check(line, [
      ['DC.B', 'directive'],
      [`'${text}'`, 'text'],
      ['end', 'comment'],
    ]);
    const many = `    DC.B    ${Array.from({ length: 400 }, (_, i) => String(i)).join(' ')}`;
    expect(highlightLine(many, on).at(-1)!.to).toBe(many.length);
  });

  it('a NUL ends the line for the analysis, as c_str() does', () => {
    check('    NOP\0 rest', []);
  });

  it('characters outside ASCII are neither letters nor blanks', () => {
    // A zero-length label in column 0: "ÄBC" is token 0, NOP the operation.
    check('ÄBC  NOP', []);
    check('ÄBC  PRINT', [['ÄBC  PRINT', 'unknown']]);
    check("    DC.B    'é€'  ünïcode", [
      ['DC.B', 'directive'],
      ["'é€'", 'text'],
      ['ünïcode', 'comment'],
    ]);
  });

  it('highlightStyles and toSpans agree', () => {
    const line = "LBL  DC.B 'a',0  text";
    expect(toSpans(highlightStyles(line, on))).toEqual(highlightLine(line, on));
  });
});
