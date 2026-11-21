// The fonts of the Output window as the session gets them (ARCHITECTURE.md 3.5.1).
//
// Text pixels come from data files only: the metric table and the glyph atlases under
// `app/public/fonts/`, read by the glyph provider of core/sim-host/fonts (owner SH3). The provider
// cannot fetch (core/ has no network access), so the session gives it a loader. This file is the
// one place that knows where the font files are served from.
//
// Owner: SH8.

import type { Bytes, FontFileLoader, GlyphProvider } from '../../contracts';
import { AtlasGlyphProvider } from '../../core/sim-host/fonts/atlas-provider';

/** The folder of the font files, relative to the page. */
export const FONTS_FOLDER = 'fonts/';

/**
 * Reads a file of the fonts folder with `fetch`, relative to the document, so that it works at any
 * base path and under the desktop app's own protocol. Null when the file does not exist.
 */
export function fetchFontFile(baseUrl: string): FontFileLoader {
  return async (path: string): Promise<Bytes | null> => {
    const response = await fetch(new URL(FONTS_FOLDER + path, baseUrl));
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  };
}

/**
 * The glyph provider of a window. Without a document (unit tests under Node) there is nothing to
 * load from: the provider then keeps its fallback, the default cell with empty glyphs.
 */
export function createGlyphProvider(): GlyphProvider {
  const baseUrl = (globalThis as { document?: { baseURI?: string } }).document?.baseURI;
  return new AtlasGlyphProvider(baseUrl ? fetchFontFile(baseUrl) : async () => null);
}
