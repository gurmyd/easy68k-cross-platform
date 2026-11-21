// Font types of the text screen (ARCHITECTURE.md 3.5.1). The declarations live in
// contracts/devices.ts so that every package can use them; this file is their home in the font
// module.
//
// Owner: W1 > SH3.

import type { FontSpec } from '../../../contracts';

export type { CellMetrics, FontSpec, Glyph, GlyphProvider } from '../../../contracts';

/**
 * What the port's own glyph provider knows beyond the contract's `GlyphProvider`
 * (docs/porting/errata/SH3.md, "Contract"): Windows' simulated bold and italic of the raster faces
 * make the opaque box of a text wider than the sum of its advances (tmOverhang: 1 pixel for bold,
 * half the cell height for italic). `TextScreen` asks for it when the provider has the method and
 * assumes 0 otherwise.
 */
export interface StyleOverhang {
  /** Pixels by which the opaque box of a text in this font reaches beyond its last advance. */
  textOverhang(font: FontSpec): number;
}
