// The display font of a document (ARCHITECTURE.md 2.4; editor-ui §19.2 item 11). Owner: E2.
//
// Each document carries the font name and size of its trailer (Courier New 10 by default). The
// editor shows the document in that font where the system has it, and in a monospace fallback
// where it does not (Fixedsys exists only on Windows; macOS has no Courier New on some systems).
// The stored name is never rewritten (DocumentState.fontName): the substitution is display only.

/** CSS font-family for a document font name; always ends in the kit's monospace stack. */
export function fontFamilyFor(name: string): string {
  const clean = name.replace(/["\\\n\r]/g, '').trim();
  const first = clean.length > 0 ? `"${clean}", ` : '';
  return `${first}var(--font-mono)`;
}

/** CSS font-size for a size in points; sizes that make no sense fall back to the default 10 pt. */
export function fontSizeFor(points: number): string {
  const size = Number.isFinite(points) && points >= 4 && points <= 96 ? points : 10;
  return `${size}pt`;
}
