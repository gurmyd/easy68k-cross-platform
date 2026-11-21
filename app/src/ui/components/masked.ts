// The editing model of MaskedField: the original's fixed-width masked edit
// boxes (TMaskEdit). Owner: W2. Pure functions, tested under Node.
//
// Sources: hardware §2.1 (device and memory-map addresses: mask
// 'aaaaaa;0;0', six hex digits), hardware §3.6 (IRQ interval: '!99999999;1;0',
// eight decimal digits), sim-ui §4.1 and §4.4 (registers: 'aaaaaaaa;0;0';
// SR: '9999999999999999;0;0' with its own key handler).
//
// The rules, for every kind:
// - The text always has exactly `width` characters. The blank character is
//   '0' (the third field of the masks): a cleared position shows '0'.
// - Typing overwrites the character at the caret and moves the caret right.
//   With a selection, the selection is cleared to '0' first and the
//   character goes to its start. At the end of the field a key is refused.
//   Hex digits are turned to upper case.
// - A key the field does not accept is refused with a beep (regKeyPress,
//   addrKeyPress, and the mask itself for the decimal field).
// - Backspace clears the position before the caret and moves the caret onto
//   it; Delete clears the position at the caret; with a selection, both clear
//   the selection. (The original's hex key handlers also beep on Backspace,
//   because they reject the #8 character after the mask has acted; that beep
//   is a GUI defect and is not reproduced - docs/differences/W2.md.)
// - The SR field (SR_FIELD) is different (sim-ui §4.4, regSRKeyPress): only
//   '0' and '1'; a selection longer than one character shrinks to one before
//   a key acts; Backspace types a '0' at the caret, and any other key types a
//   '0' at the caret with a beep. Neither moves the caret left.
// - A programmatic value fills from the left and pads with '0' on the right
//   (hex, binary: typing E0 into a cleared field gives E00000), or, for the
//   decimal field whose mask starts with '!', is right-justified and
//   zero-filled on the left (250 shows as 00000250).

export type MaskedKind = 'hex' | 'binary' | 'decimal';

export interface MaskedConfig {
  kind: MaskedKind;
  /** Number of characters: 6 (addresses), 8 (registers, interval), 16 (SR). */
  width: number;
  /** A key that is not a digit of the kind: 'reject' (beep, nothing typed) or 'typeBlank' (beep, '0' typed; SR). */
  invalidKey?: 'reject' | 'typeBlank';
  /** Backspace: 'erase' (clear the position before the caret) or 'typeBlank' (type '0' at the caret; SR). */
  backspace?: 'erase' | 'typeBlank';
  /** A selection longer than this shrinks to this length before a key acts (SR: 1). */
  maxSelection?: number;
}

/** The blank character of every mask of the original. */
export const MASK_BLANK = '0';

/** The SR field of the Registers panel (sim-ui §4.4). */
export const SR_FIELD: MaskedConfig = {
  kind: 'binary',
  width: 16,
  invalidKey: 'typeBlank',
  backspace: 'typeBlank',
  maxSelection: 1,
};

/** D0-D7, A0-A7, US, SS, PC (sim-ui §4.1). */
export const REGISTER_FIELD: MaskedConfig = { kind: 'hex', width: 8 };

/** Device and memory-map addresses of the Hardware panel (hardware §2.1, §4.1). */
export const ADDRESS_FIELD: MaskedConfig = { kind: 'hex', width: 6 };

/** The auto-interval of the Hardware panel, in ms (hardware §3.6). */
export const INTERVAL_FIELD: MaskedConfig = { kind: 'decimal', width: 8 };

export interface MaskedState {
  text: string;
  /** Selection, 0 <= selStart <= selEnd <= width; equal for a caret. */
  selStart: number;
  selEnd: number;
}

export type MaskedEdit =
  | { type: 'char'; char: string }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'paste'; text: string }
  | { type: 'cut' };

export interface MaskedResult {
  state: MaskedState;
  /** The original beeps here (the caller plays the system sound, if any). */
  beep: boolean;
  /** For 'cut': the text that goes to the clipboard. */
  clipboard?: string;
}

/** The character `char` becomes in a field of `kind`, or null when the field refuses it. */
export function acceptChar(kind: MaskedKind, char: string): string | null {
  if (char.length !== 1) return null;
  switch (kind) {
    case 'hex':
      return /^[0-9a-f]$/i.test(char) ? char.toUpperCase() : null;
    case 'binary':
      return char === '0' || char === '1' ? char : null;
    case 'decimal':
      return /^[0-9]$/.test(char) ? char : null;
  }
}

/** A cleared field. */
export function blankText(width: number): string {
  return MASK_BLANK.repeat(width);
}

/**
 * The text a field shows after a program assigns `text` (VCL Text := ...):
 * hex and binary fill from the left and pad with '0' on the right; decimal
 * (the '!' mask) is right-justified and zero-filled. Spaces count as blanks;
 * characters the kind does not accept become '0'. Too long: cut to `width`
 * (the right end is kept for decimal).
 */
export function normalizeText(text: string, config: Pick<MaskedConfig, 'kind' | 'width'>): string {
  const { kind, width } = config;
  // A space is a blank position ('    1   ' in the IRQ interval's DFM shows as 00001000).
  const chars = Array.from(text, (ch) => (ch === ' ' ? MASK_BLANK : (acceptChar(kind, ch) ?? MASK_BLANK))).join('');
  if (kind === 'decimal') return chars.padStart(width, MASK_BLANK).slice(-width);
  return chars.padEnd(width, MASK_BLANK).slice(0, width);
}

/** The text of `value` in a field: '%0<width>X' for hex, binary digits, decimal digits. */
export function formatMaskedValue(value: number, config: Pick<MaskedConfig, 'kind' | 'width'>): string {
  const radix = config.kind === 'hex' ? 16 : config.kind === 'binary' ? 2 : 10;
  const unsigned = config.kind === 'decimal' ? Math.max(0, Math.trunc(value)) : value >>> 0;
  return unsigned.toString(radix).toUpperCase().padStart(config.width, MASK_BLANK).slice(-config.width);
}

/**
 * The number a field's text stands for, as the original reads it:
 * StrToInt("0x" + EditText) for hex (unsigned here: FFFFFFFF is 4294967295),
 * bit by bit for SR, EditText.ToInt() for the interval.
 */
export function parseMaskedText(text: string, kind: MaskedKind): number {
  const radix = kind === 'hex' ? 16 : kind === 'binary' ? 2 : 10;
  const value = parseInt(text, radix);
  return Number.isNaN(value) ? 0 : value;
}

function put(text: string, index: number, char: string): string {
  return text.slice(0, index) + char + text.slice(index + 1);
}

function clearRange(text: string, start: number, end: number): string {
  return text.slice(0, start) + MASK_BLANK.repeat(end - start) + text.slice(end);
}

function caret(text: string, at: number): MaskedState {
  return { text, selStart: at, selEnd: at };
}

/** Applies one user edit to a field (see the rules at the top of this file). */
export function applyMaskedEdit(state: MaskedState, edit: MaskedEdit, config: MaskedConfig): MaskedResult {
  const width = config.width;
  const text = state.text.length === width ? state.text : normalizeText(state.text, config);
  const start = Math.min(Math.max(0, Math.min(state.selStart, state.selEnd)), width);
  let end = Math.min(Math.max(start, Math.max(state.selStart, state.selEnd)), width);
  const unchanged: MaskedResult = { state: { text, selStart: start, selEnd: end }, beep: false };

  /** Types `char` (already accepted) at the selection. */
  const type = (char: string, from: number, to: number): MaskedResult => {
    if (from === to) {
      if (from >= width) return { ...unchanged, beep: true };
      return { state: caret(put(text, from, char), from + 1), beep: false };
    }
    return { state: caret(put(clearRange(text, from, to), from, char), from + 1), beep: false };
  };
  /** The SR rule: '0' at the caret, selection dropped. */
  const typeBlankAtCaret = (beep: boolean): MaskedResult => {
    if (start >= width) return { ...unchanged, state: caret(text, start), beep };
    return { state: caret(put(text, start, MASK_BLANK), start + 1), beep };
  };

  if (config.maxSelection !== undefined && (edit.type === 'char' || edit.type === 'backspace')) {
    end = Math.min(end, start + config.maxSelection);
  }

  switch (edit.type) {
    case 'char': {
      const accepted = acceptChar(config.kind, edit.char);
      if (accepted !== null) return type(accepted, start, end);
      if (config.invalidKey === 'typeBlank') return typeBlankAtCaret(true);
      return { ...unchanged, beep: true };
    }
    case 'backspace': {
      if (config.backspace === 'typeBlank') return typeBlankAtCaret(false);
      if (start !== end) return { state: caret(clearRange(text, start, end), start), beep: false };
      if (start === 0) return unchanged;
      return { state: caret(put(text, start - 1, MASK_BLANK), start - 1), beep: false };
    }
    case 'delete': {
      if (start !== end) return { state: caret(clearRange(text, start, end), start), beep: false };
      if (start >= width) return unchanged;
      return { state: caret(put(text, start, MASK_BLANK), start), beep: false };
    }
    case 'cut': {
      if (start === end) return unchanged;
      return { state: caret(clearRange(text, start, end), start), beep: false, clipboard: text.slice(start, end) };
    }
    case 'paste': {
      // Characters the field does not accept are left out (docs/differences/W2.md).
      const accepted = Array.from(edit.text)
        .map((ch) => acceptChar(config.kind, ch))
        .filter((ch): ch is string => ch !== null);
      if (accepted.length === 0) return { ...unchanged, beep: edit.text.length > 0 };
      let result = start !== end ? clearRange(text, start, end) : text;
      let at = start;
      for (const ch of accepted) {
        if (at >= width) break;
        result = put(result, at, ch);
        at++;
      }
      return { state: caret(result, at), beep: false };
    }
  }
}
