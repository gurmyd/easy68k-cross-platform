// Pure rules of the listing selection (ARCHITECTURE.md 3.11.4; sim-ui §6.4, §6.7).

/**
 * The scroll rule of highlight() and find() (SIM68Ku.cpp:798-805): when the selected row is not
 * on screen, the list scrolls so that it becomes the third visible row (`TopIndex = ItemIndex - 2`;
 * a list box never scrolls past its first row or so far that its last page is not full).
 *
 * Returns the new first visible row, or null when the list stays where it is.
 *
 * "On screen" means fully visible. The original tests `ItemIndex > TopIndex + Height/ItemHeight`,
 * which also counts the row just below the window as on screen, so a selection there stayed
 * hidden; the port scrolls it into view (docs/differences/U1.md).
 */
export function thirdRowScroll(row: number, topRow: number, visibleRows: number, count: number): number | null {
  if (row < 0 || row >= count) return null;
  const shown = Math.max(1, Math.floor(visibleRows));
  if (row >= topRow && row < topRow + shown) return null;
  const lastTop = Math.max(0, count - shown);
  return Math.min(lastTop, Math.max(0, row - 2));
}

/** The fully visible rows of a scrolled list: the first one and how many. */
export function fullyVisibleRows(
  scrollTop: number,
  clientHeight: number,
  rowHeight: number,
): { top: number; shown: number } {
  if (rowHeight <= 0) return { top: 0, shown: 1 };
  const top = Math.max(0, Math.ceil(Math.max(0, scrollTop) / rowHeight - 1e-6));
  const bottom = Math.floor((Math.max(0, scrollTop) + Math.max(0, clientHeight)) / rowHeight + 1e-6);
  return { top, shown: Math.max(1, bottom - top) };
}

/**
 * Font size in px and row height of the listing and the message area for a font size in points.
 * The original draws Courier New 13 px (10 pt at 96 dpi) in rows of 16 px (sim-ui §6.1); other
 * sizes keep that proportion.
 */
export function listingMetrics(points: number): { fontPx: number; rowHeight: number } {
  const size = Number.isFinite(points) && points > 0 ? points : 10;
  const fontPx = Math.round(((size * 96) / 72) * 100) / 100;
  return { fontPx, rowHeight: Math.max(12, Math.round(fontPx * 1.2)) };
}

/** Expands tab characters to 8-column stops, as ListBox1DrawItem does (sim-ui §6.1). */
export function expandTabs(text: string, stop = 8): string {
  if (!text.includes('\t')) return text;
  let out = '';
  for (const char of text) {
    if (char === '\t') out += ' '.repeat(stop - (out.length % stop));
    else out += char;
  }
  return out;
}

/** The text of the cycle counter (sim-ui §5; section 1.4 note 32: the full 64-bit value). */
export function cyclesText(cycles: bigint): string {
  return cycles > 0xffffffffffffn ? 'Overflow' : cycles.toString();
}
