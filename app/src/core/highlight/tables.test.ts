// strcap, the tokeniser, the instruction table and the presets. Owner: E3.

import { describe, expect, it } from 'vitest';
import { capitalise, strcap } from './chars';
import { checkRelational } from './classify';
import { INSTRUCTION_TABLE, lookupMnemonic } from './mnemonics';
import {
  AUTO_DARK,
  AUTO_LIGHT,
  COLOR1_STYLES,
  COLOR2_STYLES,
  colorRefToHex,
  DISABLED_STYLES,
  hexToColorRef,
  NO_COLOR_STYLES,
  presetStyles,
  SYNTAX_ELEMENTS,
} from './presets';
import { MAXT, tokenize, type Tokens } from './tokenize';

const tokensOf = (line: string, from = 0): Tokens => tokenize(capitalise(line), from);
const texts = (tokens: Tokens): string[] => {
  const out: string[] = [];
  for (let n = 0; n < MAXT; n++) if (tokens.start[n]! >= 0) out[n] = tokens.text(n);
  return out;
};

describe('strcap', () => {
  it('upper-cases everything except between single quotes', () => {
    expect(strcap("  move.b #'a',d0 ; 'x' y")).toBe("  MOVE.B #'a',D0 ; 'x' Y");
    expect(strcap('dc.b "abc"')).toBe('DC.B "ABC"'); // double quotes do not toggle
    expect(strcap("it''s ok")).toBe("IT''S OK");
    expect(strcap('äöü ß')).toBe('äöü ß'); // only a-z change; the length never changes
  });
});

describe('tokenize with ". \\t\\n"', () => {
  it('token 0 is the label only when the string starts with it', () => {
    expect(texts(tokensOf('LOOP DBRA D0,LOOP'))).toEqual(['LOOP', 'DBRA', 'D0,LOOP']);
    expect(texts(tokensOf('    DBRA D0,LOOP'))).toEqual([undefined, 'DBRA', 'D0,LOOP']);
  });

  it('a period ends a token and begins the next', () => {
    expect(texts(tokensOf('    MOVE.B  D0,D1'))).toEqual([undefined, 'MOVE', '.B', 'D0,D1']);
    expect(texts(tokensOf('    THEN.S'))).toEqual([undefined, 'THEN', '.S']);
  });

  it('parentheses and single quotes keep delimiters inside a token', () => {
    expect(texts(tokensOf('    LEA (A0, D0.W),A1'))).toEqual([undefined, 'LEA', '(A0, D0.W),A1']);
    expect(texts(tokensOf("    DC.B 'a b.c',0"))).toEqual([undefined, 'DC', '.B', "'a b.c',0"]);
  });

  it('the quote flag is not reset between tokens', () => {
    expect(texts(tokensOf("    X 'a b c"))).toEqual([undefined, 'X', "'a b c"]);
  });

  it("'' at the start of a token makes it empty, and the token still takes the characters after it", () => {
    const tokens = tokensOf("    DC.B ''AB C");
    expect(texts(tokens)).toEqual([undefined, 'DC', '.B', '', 'C']);
    expect([tokens.char(3, 1), tokens.char(3, 2)]).toEqual([0x41, 0x42]); // "AB" behind the NUL
  });

  it('records where each token ended in the line', () => {
    const line = '    MOVE.B  D0,D1   x';
    const tokens = tokensOf(line);
    expect([tokens.endOf(1), tokens.endOf(2), tokens.endOf(3), tokens.endOf(4), tokens.endOf(5)]).toEqual([
      8, 10, 17, 21, -1,
    ]);
  });

  it('reads past a token into the next one, as C does', () => {
    const tokens = tokensOf('    IF D0 <E >X THEN');
    expect(tokens.text(3)).toBe('<E');
    expect(String.fromCharCode(tokens.char(3, 3))).toBe('>');
    expect(tokens.char(40, 3)).toBe(0); // an unused token reads as NUL
  });

  it('a comment line has no tokens', () => {
    expect(texts(tokensOf('   * x y'))).toEqual([]);
  });

  it('stops at MAXT tokens', () => {
    const tokens = tokensOf(`    ${Array.from({ length: 300 }, (_, i) => String(i % 10)).join(' ')}`);
    expect(tokens.text(MAXT - 1)).toBe(String((MAXT - 2) % 10));
    expect(texts(tokens).filter((t) => t !== undefined)).toHaveLength(MAXT - 1);
  });

  it('stops when the 512-byte token buffer is full', () => {
    const tokens = tokensOf(`    ${Array.from({ length: 300 }, (_, i) => `T${i}`).join(' ')}`);
    // T0-T9 take 3 bytes, T10-T99 4, T100 and up 5: after T123 two bytes are left, for "T" and its NUL.
    expect(tokens.text(124)).toBe('T123');
    expect(tokens.text(125)).toBe('T');
    expect(tokens.start[126]).toBe(-1);
  });
});

describe('checkRelational', () => {
  it('returns the token after the matched pattern, or 0', () => {
    expect(checkRelational(tokensOf('    IF D0 <EQ> #1 THEN'), 2)).toBe(5);
    expect(checkRelational(tokensOf('    IF <EQ> THEN'), 2)).toBe(3);
    expect(checkRelational(tokensOf('    IF D0 <EQ> #1 AND.B D1 <NE> D2 THEN'), 2)).toBe(10);
    expect(checkRelational(tokensOf('    IF D0 = #1 THEN'), 2)).toBe(0);
  });
});

/** The 68000 mnemonics of editor-ui §9.5 (c). */
const SPEC_MNEMONICS = `ABCD ADD ADDA ADDI ADDQ
  ADDX AND ANDI ASL ASR BCC BCHG BCLR BCS BEQ BFCHG BFCLR BFEXTS BFEXTU BFFFO BFINS BFSET
  BFTST BGE BGT BHI BHS BLE BLO BLS BLT BMI BNE BPL BRA BSET BSR BTST BVC BVS CHK CLR CMP
  CMPA CMPI CMPM DBCC DBCS DBEQ DBF DBGE DBGT DBHI DBHS DBLE DBLO DBLS DBLT DBMI DBNE DBPL
  DBRA DBT DBVC DBVS DIVS DIVU EOR EORI EXG EXT ILLEGAL JMP JSR LEA LINK LSL LSR MOVE MOVEA
  MOVEM MOVEP MOVEQ MULS MULU NBCD NEG NEGX NOP NOT OR ORI PEA RESET ROL ROR ROXL ROXR RTE
  RTR RTS SBCD SCC SCS SEQ SF SGE SGT SHI SHS SLE SLO SLS SLT SMI SNE SPL ST STOP SUB SUBA
  SUBI SUBQ SUBX SVC SVS SWAP TAS TRAP TRAPV TST UNLK`
  .split(/\s+/)
  .filter(Boolean);

describe('the instruction table', () => {
  it('is in strictly ascending strcmp order, so the binary search finds every entry', () => {
    for (let i = 1; i < INSTRUCTION_TABLE.length; i++) {
      expect(INSTRUCTION_TABLE[i - 1]!.mnemonic < INSTRUCTION_TABLE[i]!.mnemonic).toBe(true);
    }
    for (const { mnemonic } of INSTRUCTION_TABLE) {
      expect(lookupMnemonic(tokensOf(`    ${mnemonic}`), 1, true)?.mnemonic).toBe(mnemonic);
    }
  });

  it('holds the 68000 mnemonics of editor-ui §9.5 (c) and otherwise only directives and structured words', () => {
    const withFlavor = INSTRUCTION_TABLE.filter((e) => e.kind !== 'noFlavor').map((e) => e.mnemonic);
    expect(withFlavor).toEqual(SPEC_MNEMONICS);
    expect(INSTRUCTION_TABLE).toHaveLength(SPEC_MNEMONICS.length + 31);
  });

  it('exactly seven mnemonics take no source operand', () => {
    expect(INSTRUCTION_TABLE.filter((e) => e.kind === 'none').map((e) => e.mnemonic)).toEqual([
      'ILLEGAL',
      'NOP',
      'RESET',
      'RTE',
      'RTR',
      'RTS',
      'TRAPV',
    ]);
  });

  it('bit-field mnemonics are not found while the option is off', () => {
    expect(lookupMnemonic(tokensOf('    BFTST'), 1, false)).toBeNull();
    expect(lookupMnemonic(tokensOf('    BFTST'), 1, true)?.kind).toBe('bitfield');
  });

  it('only letters, digits, "_" and "-" continue a mnemonic; anything else but a blank is a syntax error', () => {
    expect(lookupMnemonic(tokensOf('    MOVE(A0)'), 1, true)).toBeNull();
    expect(lookupMnemonic(tokensOf('    MOVE_X'), 1, true)).toBeNull();
    expect(lookupMnemonic(tokensOf('    '), 1, true)).toBeNull(); // no token at all
  });
});

describe('presets', () => {
  it('COLORREF conversions', () => {
    expect(colorRefToHex(0xff0000)).toBe('#0000FF'); // clBlue
    expect(colorRefToHex(8421376)).toBe('#008080'); // clTeal
    expect(hexToColorRef('#800080')).toBe(8388736); // clPurple
    expect(hexToColorRef(colorRefToHex(0x123456))).toBe(0x123456);
  });

  it('Color1 is the default table of editor-ui §9.2 (settings.dat values)', () => {
    const stored = Object.fromEntries(SYNTAX_ELEMENTS.map((e) => [e, COLOR1_STYLES[e].color]));
    expect(stored).toEqual({
      code: 0,
      comment: 16711680,
      directive: 32768,
      label: 8388736,
      unknown: 32896,
      structure: 128,
      error: 255,
      text: 8421376,
    });
  });

  it('Color2, No Color and Disabled as editorOptions.cpp:601-649 sets them', () => {
    const hex = (styles: typeof COLOR2_STYLES) =>
      Object.fromEntries(SYNTAX_ELEMENTS.map((e) => [e, colorRefToHex(styles[e].color)]));
    expect(hex(COLOR2_STYLES)).toEqual({
      code: '#000000',
      unknown: '#800080',
      directive: '#0000FF',
      comment: '#008000',
      label: '#000080',
      structure: '#0000FF',
      error: '#FF0000',
      text: '#800000',
    });
    const attributes = (styles: typeof NO_COLOR_STYLES) =>
      Object.fromEntries(
        SYNTAX_ELEMENTS.map((e) => [
          e,
          `${styles[e].bold ? 'B' : ''}${styles[e].italic ? 'I' : ''}${styles[e].underline ? 'U' : ''}`,
        ]),
      );
    expect(attributes(NO_COLOR_STYLES)).toEqual({
      code: '',
      unknown: 'IU',
      directive: 'B',
      comment: 'I',
      label: 'B',
      structure: 'B',
      error: 'U',
      text: '',
    });
    for (const styles of [NO_COLOR_STYLES, DISABLED_STYLES]) {
      expect(SYNTAX_ELEMENTS.every((e) => styles[e].color === 0)).toBe(true);
    }
    expect(Object.values(attributes(DISABLED_STYLES)).join('')).toBe('');
  });

  it('presetStyles: Custom and "none" change nothing; Disabled turns highlighting off', () => {
    expect(presetStyles(3)).toBeNull();
    expect(presetStyles(-1)).toBeNull();
    expect(presetStyles(4)).toEqual({ styles: DISABLED_STYLES, highlightDisabled: true });
    expect(presetStyles(0)!.highlightDisabled).toBe(false);
    expect(presetStyles(5)!.styles).toBe(COLOR1_STYLES);
  });

  it('the Auto palettes of ARCHITECTURE.md 2.8', () => {
    expect(colorRefToHex(AUTO_LIGHT.background)).toBe('#FFFFFF');
    expect(AUTO_LIGHT.styles).toBe(COLOR1_STYLES);
    expect(colorRefToHex(AUTO_DARK.background)).toBe('#1B1F24');
    expect(Object.fromEntries(SYNTAX_ELEMENTS.map((e) => [e, colorRefToHex(AUTO_DARK.styles[e].color)]))).toEqual({
      code: '#E6EDF3',
      comment: '#6CB6FF',
      directive: '#6BC46D',
      label: '#D2A8FF',
      unknown: '#D4B24C',
      structure: '#FF938A',
      error: '#FF5F56',
      text: '#56D4DD',
    });
  });
});
