// MaskedField's editing model against hardware §2.1, §3.6 and sim-ui §4.1, §4.4.

import { describe, expect, it } from 'vitest';
import {
  ADDRESS_FIELD,
  INTERVAL_FIELD,
  REGISTER_FIELD,
  SR_FIELD,
  applyMaskedEdit,
  blankText,
  formatMaskedValue,
  normalizeText,
  parseMaskedText,
  type MaskedConfig,
  type MaskedEdit,
  type MaskedState,
} from './masked';

/** State from a picture: '|' is the caret, '[...]' a selection. */
function at(picture: string): MaskedState {
  const caret = picture.indexOf('|');
  if (caret >= 0) return { text: picture.replace('|', ''), selStart: caret, selEnd: caret };
  const start = picture.indexOf('[');
  const end = picture.indexOf(']') - 1;
  return { text: picture.replace('[', '').replace(']', ''), selStart: start, selEnd: end };
}

function picture(state: MaskedState): string {
  const { text, selStart, selEnd } = state;
  if (selStart === selEnd) return `${text.slice(0, selStart)}|${text.slice(selStart)}`;
  return `${text.slice(0, selStart)}[${text.slice(selStart, selEnd)}]${text.slice(selEnd)}`;
}

/** Applies keys in turn: a character, '⌫' for Backspace, '⌦' for Delete. Returns the picture and the beeps. */
function type(config: MaskedConfig, start: string, keys: string) {
  let state = at(start);
  let beeps = 0;
  for (const key of keys) {
    const edit: MaskedEdit =
      key === '⌫' ? { type: 'backspace' } : key === '⌦' ? { type: 'delete' } : { type: 'char', char: key };
    const result = applyMaskedEdit(state, edit, config);
    state = result.state;
    if (result.beep) beeps++;
  }
  return { picture: picture(state), beeps };
}

describe('hex address field (hardware §2.1: six hex digits, blank 0)', () => {
  it('typing E0 into a cleared field gives E00000', () => {
    expect(type(ADDRESS_FIELD, '|000000', 'E0')).toEqual({ picture: 'E0|0000', beeps: 0 });
    expect(normalizeText('E0', ADDRESS_FIELD)).toBe('E00000');
  });

  it('turns lower-case hex digits to upper case', () => {
    expect(type(ADDRESS_FIELD, '|E00000', 'abcdef').picture).toBe('ABCDEF|');
  });

  it('refuses non-hex characters with a beep and leaves the text alone', () => {
    expect(type(ADDRESS_FIELD, 'E0|0000', 'gZ -$')).toEqual({ picture: 'E0|0000', beeps: 5 });
  });

  it('overwrites at the caret and refuses a key at the end', () => {
    expect(type(ADDRESS_FIELD, 'E00|010', '2')).toEqual({ picture: 'E002|10', beeps: 0 });
    expect(type(ADDRESS_FIELD, 'E00010|', '5')).toEqual({ picture: 'E00010|', beeps: 1 });
  });

  it('replaces a selection: the selection becomes 0 and the key goes to its start', () => {
    expect(type(ADDRESS_FIELD, '[E00010]', 'F')).toEqual({ picture: 'F|00000', beeps: 0 });
    expect(type(ADDRESS_FIELD, 'E0[001]0', '7')).toEqual({ picture: 'E07|000', beeps: 0 });
  });

  it('Backspace clears the position before the caret and moves onto it', () => {
    expect(type(ADDRESS_FIELD, 'E0001|0', '⌫')).toEqual({ picture: 'E000|00', beeps: 0 });
    expect(type(ADDRESS_FIELD, 'E00014|', '⌫⌫')).toEqual({ picture: 'E000|00', beeps: 0 });
    expect(type(ADDRESS_FIELD, '|E00014', '⌫')).toEqual({ picture: '|E00014', beeps: 0 });
    expect(type(ADDRESS_FIELD, 'E[0001]4', '⌫')).toEqual({ picture: 'E|00004', beeps: 0 });
  });

  it('Delete clears the position at the caret and keeps the caret', () => {
    expect(type(ADDRESS_FIELD, 'E|00014', '⌦')).toEqual({ picture: 'E|00014', beeps: 0 });
    expect(type(ADDRESS_FIELD, 'E000|14', '⌦⌦')).toEqual({ picture: 'E000|04', beeps: 0 });
    expect(type(ADDRESS_FIELD, '[E00014]', '⌦')).toEqual({ picture: '|000000', beeps: 0 });
    expect(type(ADDRESS_FIELD, 'E00014|', '⌦')).toEqual({ picture: 'E00014|', beeps: 0 });
  });

  it('keeps the text exactly six characters whatever happens', () => {
    let state = at('|E00000');
    const edits: MaskedEdit[] = [
      { type: 'char', char: '1' },
      { type: 'backspace' },
      { type: 'delete' },
      { type: 'paste', text: 'ABCDEFABCDEF' },
      { type: 'cut' },
      { type: 'char', char: 'x' },
    ];
    for (const edit of edits) {
      state = applyMaskedEdit(state, edit, ADDRESS_FIELD).state;
      expect(state.text).toHaveLength(6);
    }
  });
});

describe('register fields (sim-ui §4.1, §4.4: eight hex digits)', () => {
  it('select-all on focus then typing replaces from the left (AutoSelect)', () => {
    expect(type(REGISTER_FIELD, '[0000ABCD]', '12')).toEqual({ picture: '12|000000', beeps: 0 });
  });

  it('formats like "%08lX" and reads like StrToInt("0x" + text)', () => {
    expect(formatMaskedValue(0x1000, REGISTER_FIELD)).toBe('00001000');
    expect(formatMaskedValue(-1, REGISTER_FIELD)).toBe('FFFFFFFF');
    expect(formatMaskedValue(0x1_0000_0000 + 5, REGISTER_FIELD)).toBe('00000005');
    expect(parseMaskedText('FFFFFFFF', 'hex')).toBe(0xffffffff);
    expect(parseMaskedText('00FF0000', 'hex')).toBe(0x00ff0000);
  });
});

describe('SR field (sim-ui §4.4, regSRKeyPress)', () => {
  const sr = '0010000000000000';

  it('accepts 0 and 1, overwriting at the caret', () => {
    expect(type(SR_FIELD, `|${sr}`, '1')).toEqual({ picture: `1|${sr.slice(1)}`, beeps: 0 });
    expect(type(SR_FIELD, `00|${sr.slice(2)}`, '0')).toEqual({ picture: `000|${sr.slice(3)}`, beeps: 0 });
  });

  it('Backspace types a 0 at the caret (no beep) and does not move left', () => {
    expect(type(SR_FIELD, `00|1${sr.slice(3)}`, '⌫')).toEqual({ picture: `000|${sr.slice(3)}`, beeps: 0 });
  });

  it('any other key types a 0 at the caret with a beep', () => {
    expect(type(SR_FIELD, `00|1${sr.slice(3)}`, '7')).toEqual({ picture: `000|${sr.slice(3)}`, beeps: 1 });
    expect(type(SR_FIELD, `|1111`.padEnd(17, '1'), 'x')).toEqual({ picture: `0|${'1'.repeat(15)}`, beeps: 1 });
  });

  it('a selection longer than one character shrinks to one before a key acts', () => {
    // '1' replaces only the first selected character; the rest is untouched.
    expect(type(SR_FIELD, '[1111]000000000000', '0').picture).toBe('0|111000000000000');
    // Backspace and invalid keys drop the selection and type '0' at its start.
    expect(type(SR_FIELD, '00[1111]0000000000', '⌫').picture).toBe('000|1110000000000');
    expect(type(SR_FIELD, '00[1111]0000000000', 'q')).toEqual({ picture: '000|1110000000000', beeps: 1 });
  });

  it('at the end nothing is typed', () => {
    expect(type(SR_FIELD, `${sr}|`, '⌫')).toEqual({ picture: `${sr}|`, beeps: 0 });
    expect(type(SR_FIELD, `${sr}|`, '5')).toEqual({ picture: `${sr}|`, beeps: 1 });
  });

  it('formats and reads the 16 bits, bit 15 first', () => {
    expect(formatMaskedValue(0x2000, SR_FIELD)).toBe(sr);
    expect(formatMaskedValue(0xa71f, SR_FIELD)).toBe('1010011100011111');
    expect(parseMaskedText('1010011100011111', 'binary')).toBe(0xa71f);
  });
});

describe('IRQ interval (hardware §3.6: !99999999, decimal, right-justified)', () => {
  it("shows the DFM text '    1   ' as 00001000", () => {
    expect(normalizeText('    1   ', INTERVAL_FIELD)).toBe('00001000');
    expect(parseMaskedText(normalizeText('    1   ', INTERVAL_FIELD), 'decimal')).toBe(1000);
  });

  it('right-justifies a value assigned as a plain decimal string (250 -> 00000250)', () => {
    expect(normalizeText('250', INTERVAL_FIELD)).toBe('00000250');
    expect(formatMaskedValue(250, INTERVAL_FIELD)).toBe('00000250');
  });

  it('typing 5 over 00001000 at the first position makes 50001000 (overwrite style)', () => {
    const result = type(INTERVAL_FIELD, '|00001000', '5');
    expect(result.picture).toBe('5|0001000');
    expect(parseMaskedText('50001000', 'decimal')).toBe(50001000);
  });

  it('admits digits only', () => {
    expect(type(INTERVAL_FIELD, '|00001000', 'a-')).toEqual({ picture: '|00001000', beeps: 2 });
  });
});

describe('clipboard', () => {
  it('paste overwrites from the caret with the accepted characters only', () => {
    const result = applyMaskedEdit(at('E0|0000'), { type: 'paste', text: '1 2-g3' }, ADDRESS_FIELD);
    expect(picture(result.state)).toBe('E0123|0');
    expect(result.beep).toBe(false);
  });

  it('paste clears the selection first and stops at the end', () => {
    const result = applyMaskedEdit(at('E0[00]14'), { type: 'paste', text: 'FFFFFFFF' }, ADDRESS_FIELD);
    expect(picture(result.state)).toBe('E0FFFF|');
  });

  it('paste of nothing usable beeps', () => {
    expect(applyMaskedEdit(at('|E00000'), { type: 'paste', text: 'xyz' }, ADDRESS_FIELD).beep).toBe(true);
  });

  it('cut returns the selection and clears it', () => {
    const result = applyMaskedEdit(at('E0[0014]'), { type: 'cut' }, ADDRESS_FIELD);
    expect(result.clipboard).toBe('0014');
    expect(picture(result.state)).toBe('E0|0000');
  });
});

describe('helpers', () => {
  it('blankText is all zeros', () => {
    expect(blankText(6)).toBe('000000');
  });

  it('normalizeText pads, cuts and cleans', () => {
    expect(normalizeText('e00010', ADDRESS_FIELD)).toBe('E00010');
    expect(normalizeText('E000100', ADDRESS_FIELD)).toBe('E00010');
    expect(normalizeText('E0 0x1', ADDRESS_FIELD)).toBe('E00001');
    expect(normalizeText('123456789', INTERVAL_FIELD)).toBe('23456789');
    expect(normalizeText('101', SR_FIELD)).toBe('1010000000000000');
  });
});
