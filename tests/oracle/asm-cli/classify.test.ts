import { describe, expect, it } from 'vitest';
import { canonicalListing, canonicalSRecord, undefinedSymbolRanges } from '../../conformance/asm/compare';
import { classify, hasChangedOperand, hasCliIncludeLine, listingBody } from './classify';

const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'latin1'));
const file = (...lines: string[]): Uint8Array => bytes(lines.join('\r\n') + '\r\n');
const canonical = { canonicalListing, canonicalSRecord, undefinedSymbolRanges };

const PORT_HEADER = ['00001000 Starting Address', 'Assembler used: EASy68K Editor/Assembler v5.16.01', 'Created On: 11/20/2026 12:00:00 PM', ''];
// The command-line port names itself differently and prints one more empty line.
const CLI_HEADER = ['00001000 Starting Address', 'Assembler used: ASy68K Assembler v5.15.04', 'Created On: 11/20/2026 11:58:10 PM', '', ''];
const END = ['', 'No errors detected', 'No warnings generated'];
const S68 = file('S10510004E71DB', 'S804001000EB');
const body = (code: string): string[] => [`00001000  ${code}                       1      NOP`];
const outputs = (header: string[], lines: string[], sRecord = S68): { listing: Uint8Array; sRecord: Uint8Array } => ({
  listing: file(...header, ...lines, ...END),
  sRecord,
});

describe('listingBody', () => {
  it('drops the three header lines and the empty lines after them, for both programs', () => {
    expect(listingBody(file(...PORT_HEADER, 'x', '', 'y'))).toEqual(['x', '', 'y', '']);
    expect(listingBody(file(...CLI_HEADER, 'x', '', 'y'))).toEqual(['x', '', 'y', '']);
  });
});

describe('classify', () => {
  it('calls outputs identical that differ only in the header', () => {
    expect(classify(outputs(CLI_HEADER, body('4E71')), outputs(PORT_HEADER, body('4E71')), ['  NOP'], canonical)).toEqual({
      verdict: 'identical',
      classes: [],
    });
  });

  it('leaves a difference unexplained when the source has no construct that causes one', () => {
    const result = classify(outputs(CLI_HEADER, body('4E71')), outputs(PORT_HEADER, body('4E72')), ['  NOP'], canonical);
    expect(result.verdict).toBe('unexplained');
    expect(result.detail).toContain('.L68 line 1');
    expect(result.detail).toContain('command-line port: 00001000  4E71');
  });

  it('accepts the lower-case generated labels of the command-line port', () => {
    const cli = outputs(CLI_HEADER, ['00001004  6600 0006                  3s     BNE _0000000e']);
    const port = outputs(PORT_HEADER, ['00001004  6600 0006                  3s     BNE _0000000E']);
    expect(classify(cli, port, ['  IF D0 <EQ> D1 THEN'], canonical)).toEqual({ verdict: 'explained', classes: ['structured-label-case'] });
  });

  it('accepts other object code only on a statement with an undefined symbol', () => {
    const line = (code: string): string[] => ['Line 1 ERROR: Undefined symbol', `00001000  41F9 ${code}             1      LEA X,A0`];
    const cli = outputs(CLI_HEADER, line('004DBD16'), file('S109100041F9004DBD1695', 'S804001000EB'));
    const port = outputs(PORT_HEADER, line('00000000'), file('S109100041F900000000B5', 'S804001000EB'));
    expect(classify(cli, port, ['  LEA X,A0'], canonical)).toEqual({ verdict: 'explained', classes: ['undefined-symbol'] });
    // The same listings, but an S-record byte that differs outside the statement ($1006).
    const next = '00001006  4E71                       2      NOP';
    const cliNext = outputs(CLI_HEADER, [...line('004DBD16'), next], file('S10B100041F9004DBD164E7100', 'S804001000EB'));
    const portNext = outputs(PORT_HEADER, [...line('00000000'), next], file('S10B100041F9000000004E72D4', 'S804001000EB'));
    expect(classify(cliNext, portNext, ['  LEA X,A0'], canonical).verdict).toBe('unexplained');
    const elsewhere = outputs(PORT_HEADER, [...line('00000000'), '00001006  4E72                       2      NOP']);
    const cliElsewhere = outputs(CLI_HEADER, [...line('004DBD16'), '00001006  4E71                       2      NOP']);
    expect(classify(cliElsewhere, elsewhere, ['  LEA X,A0'], canonical).verdict).toBe('unexplained');
  });

  it('accepts any difference when the source has a line the command-line port mistreats', () => {
    const cli = outputs(CLI_HEADER, ['Line 1 ERROR: Invalid opcode', "00001000                             1      include 'x.x68'"]);
    const port = outputs(PORT_HEADER, body('4E71'));
    expect(classify(cli, port, ["  include 'x.x68'"], canonical)).toEqual({ verdict: 'explained', classes: ['cli-include-line'] });
    const v516 = classify(outputs(CLI_HEADER, body('323B 00F6')), outputs(PORT_HEADER, body('323B 00FE')), ['  MOVE.W (TABLE,PC,D0.W),D1'], canonical);
    expect(v516).toEqual({ verdict: 'explained', classes: ['v5.16.1-operand'] });
  });

  it('never explains a missing output', () => {
    const port = outputs(PORT_HEADER, body('4E71'));
    expect(classify({ listing: null, sRecord: null }, port, ["  include 'x'"], canonical).verdict).toBe('unexplained');
  });
});

describe('the constructs that explain a difference', () => {
  it('a line with INCLUDE or INCBIN that is not all upper case (assembler §8.2)', () => {
    expect(hasCliIncludeLine("    include 'macros.X68'")).toBe(true);
    expect(hasCliIncludeLine('    move d0,d1 ; include this')).toBe(true);
    expect(hasCliIncludeLine('    INCLUDE "VARS.X68"')).toBe(false);
    expect(hasCliIncludeLine("    INCLUDE 'vars.x68'")).toBe(false); // lower case only inside quotes
    expect(hasCliIncludeLine('    MOVE D0,D1')).toBe(false);
  });

  it('the operands v5.16.1 assembles differently (assembler §8.3)', () => {
    for (const line of ['  MOVE.W (TABLE,PC,D0.W),D1', '  move.w (pc,d0.w),d1', '  MOVE.W ($C,A0),D1', '  MOVE.W (PTR,A0),D1', '  MOVE.W (SCORE,A0,D1.L),D2']) {
      expect(hasChangedOperand(line), line).toBe(true);
    }
    for (const line of ['  MOVE.W ($1C,A0),D1', '  MOVE.W TABLE(PC,D0.W),D1', '  MOVE.W 12(A0),D1', '* MOVE.W (PTR,A0),D1', '  LEA (A0),A1']) {
      expect(hasChangedOperand(line), line).toBe(false);
    }
  });
});
