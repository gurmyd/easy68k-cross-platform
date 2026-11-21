// Font types of the text screen (ARCHITECTURE.md 3.5.1). The declarations live in
// contracts/devices.ts so that every package can use them; this file is their home in the font
// module.
//
// Owner: W1 > SH3.

import type { FontSpec, Glyph } from '../../../contracts';

export type { CellMetrics, FontFileLoader, FontSpec, Glyph, GlyphProvider } from '../../../contracts';

/**
 * What the port's own glyph provider knows beyond the contract's `GlyphProvider`
 * (docs/porting/errata/SH3.md, "Contract"). In the outline faces Windows draws the byte $7F from a
 * fallback font when the text also has a byte of $80 or above, and the byte then takes that font's
 * width instead of its own advance. `TextScreen` asks for the glyph when the provider has the
 * method and draws the byte's own glyph otherwise.
 */
export interface FallbackGlyphs {
  /**
   * The glyph of $7F inside a text that has a byte of $80 or above: without ink, as wide as
   * Windows' fallback glyph. Null for a font in which the byte keeps its own glyph (the raster
   * faces) or whose font files do not say.
   */
  delInHighText(font: FontSpec): Glyph | null;
}
