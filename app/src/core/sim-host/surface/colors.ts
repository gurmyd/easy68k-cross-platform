// Colours of the graphics tasks (ARCHITECTURE.md 3.4 rule 1; trap15-b §4.6).
//
// A program passes a colour as a 32-bit value, normally $00BBGGRR. The original hands that value to
// the VCL as a TColor, so a top byte that is not zero has the meaning Windows gives it:
//
//   bit 31 set           a Windows system colour, chosen by the low byte (GetSysColor)
//   else bit 24 set      an entry of GDI's stock palette, chosen by the low 16 bits
//   else                 the low 24 bits as they are
//
// Pen, fill and font colours all take this path. A resolved colour is a plain $00BBGGRR value, so
// resolving it a second time changes nothing.
//
// Owner: SH1.

/** $00BBGGRR from red, green and blue. */
const rgb = (red: number, green: number, blue: number): number => (blue << 16) | (green << 8) | red;

/**
 * GDI's stock palette, $00BBGGRR. All 20 entries were measured on Windows 11 (trap15-b §4.6).
 * An index of 20 or more is black.
 */
export const STOCK_PALETTE: readonly number[] = [
  0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0xc0dcc0, 0xf0caa6, 0xf0fbff,
  0xa4a0a0, 0x808080, 0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
];

/**
 * The Windows system colours 0-30 (`GetSysColor`) of a default Windows 11 desktop, $00BBGGRR. On the
 * original they follow the user's Windows theme; the port fixes them. An index above 30 is black.
 *
 * These are the colours Windows 10 and 11 ship with. They equal what the GDI capture read with
 * `GetSysColor` on a default Windows 11 desktop (tests/conformance/gdi/golden/spots.json).
 */
export const SYSTEM_COLORS: readonly number[] = [
  rgb(200, 200, 200), //  0 scroll bar
  rgb(0, 0, 0), //  1 desktop
  rgb(153, 180, 209), //  2 active caption
  rgb(191, 205, 219), //  3 inactive caption
  rgb(240, 240, 240), //  4 menu
  rgb(255, 255, 255), //  5 window
  rgb(100, 100, 100), //  6 window frame
  rgb(0, 0, 0), //  7 menu text
  rgb(0, 0, 0), //  8 window text
  rgb(0, 0, 0), //  9 caption text
  rgb(180, 180, 180), // 10 active border
  rgb(244, 247, 252), // 11 inactive border
  rgb(171, 171, 171), // 12 application workspace
  rgb(0, 120, 215), // 13 highlight
  rgb(255, 255, 255), // 14 highlight text
  rgb(240, 240, 240), // 15 button face
  rgb(160, 160, 160), // 16 button shadow
  rgb(109, 109, 109), // 17 grey text
  rgb(0, 0, 0), // 18 button text
  rgb(0, 0, 0), // 19 inactive caption text
  rgb(255, 255, 255), // 20 button highlight
  rgb(105, 105, 105), // 21 dark shadow
  rgb(227, 227, 227), // 22 light
  rgb(0, 0, 0), // 23 tooltip text
  rgb(255, 255, 225), // 24 tooltip background
  rgb(0, 0, 0), // 25 not a system colour
  rgb(0, 102, 204), // 26 hot-tracked item
  rgb(185, 209, 234), // 27 active caption gradient
  rgb(215, 228, 242), // 28 inactive caption gradient
  rgb(0, 120, 215), // 29 menu highlight
  rgb(240, 240, 240), // 30 menu bar
];

/** The colour a program's 32-bit colour value draws with, as $00BBGGRR. */
export function resolveColor(color: number): number {
  if (color & 0x80000000) return SYSTEM_COLORS[color & 0xff] ?? 0x000000;
  if (color & 0x01000000) return STOCK_PALETTE[color & 0xffff] ?? 0x000000;
  return color & 0x00ffffff;
}
