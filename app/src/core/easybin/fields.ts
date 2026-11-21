// The value fields of the EASyBIN window (docs/porting/easybin.md 4). Owner: B1.
//
// Every number the original takes from a field is `StrToInt("0x" + EditText)`: hexadecimal, up to
// eight digits, an `int` (so "FFFFFFF0" is -16). The fields hold text, because the original keeps
// texts in its mask edits and reads them back: a six-digit field can hold eight digits after the
// program assigned them (4.1).

/** VCL StrToInt("0x" + text) as a signed 32-bit number; null where the VCL raises EConvertError. */
export function hexValue(text: string): number | null {
  if (!/^[0-9A-Fa-f]{1,8}$/.test(text)) return null;
  return parseInt(text, 16) | 0;
}

/** The same number as an unsigned 32-bit value (the C `unsigned int` the original assigns it to). */
export function hexUnsigned(text: string): number | null {
  const value = hexValue(text);
  return value === null ? null : value >>> 0;
}

/** C `sprintf("%0<digits>X", value)` of an unsigned 32-bit value: at least `digits` digits. */
export function hexText(value: number, digits: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}

/** The texts of the window's fields and labels, with their values at start (Form1u.dfm). */
export interface EasybinFields {
  /** S-Record File: Start Address (8 digits). */
  startAddress: string;
  /** S-Record File: Last Address (label, 6 digits after the grey `00`). */
  lastAddress: string;
  /** S-Record File: Length (label). */
  s68Length: string;
  /** Binary File(s): First Address. */
  firstAddress: string;
  /** Binary File(s): Length. */
  outLength: string;
  /** The Address field: the top row's address. */
  address: string;
  from: string;
  to: string;
  /** Size (Copy). */
  bytes: string;
  fillByte: string;
}

/** Empty mask edits show their blank character `0` (VCL); FillByte starts as `FF`. */
export const INITIAL_FIELDS: EasybinFields = {
  startAddress: '00000000',
  lastAddress: '000000',
  s68Length: '000000',
  firstAddress: '000000',
  outLength: '000000',
  address: '000000',
  from: '000000',
  to: '000000',
  bytes: '000000',
  fillByte: 'FF',
};

/** The number of digits each edit field takes from the keyboard (MaxLength). */
export const FIELD_WIDTHS = {
  startAddress: 8,
  firstAddress: 6,
  outLength: 6,
  address: 6,
  from: 6,
  to: 6,
  bytes: 6,
  fillByte: 2,
} as const;
export type EditableField = keyof typeof FIELD_WIDTHS;
