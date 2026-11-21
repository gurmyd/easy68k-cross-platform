// Row arithmetic of VirtualList (pure, tested under Node). Owner: W2.

export interface RowWindow {
  /** First row to render. */
  start: number;
  /** One past the last row to render. */
  end: number;
}

/** The rows to render for a scroll position: the visible ones plus `overscan` on each side. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 4,
): RowWindow {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  return {
    start: Math.max(0, Math.min(count, first - overscan)),
    end: Math.max(0, Math.min(count, first + visible + overscan)),
  };
}

export type ScrollAlign = 'auto' | 'start' | 'center' | 'end';

/**
 * The scroll position that shows row `index`. 'auto' scrolls as little as
 * possible (nothing when the row is fully visible).
 */
export function scrollTopFor(
  index: number,
  align: ScrollAlign,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
): number {
  const maxTop = Math.max(0, count * rowHeight - viewportHeight);
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  let next: number;
  switch (align) {
    case 'start':
      next = top;
      break;
    case 'end':
      next = bottom - viewportHeight;
      break;
    case 'center':
      next = top - (viewportHeight - rowHeight) / 2;
      break;
    case 'auto':
      if (top < scrollTop) next = top;
      else if (bottom > scrollTop + viewportHeight) next = bottom - viewportHeight;
      else next = scrollTop;
      break;
  }
  return Math.min(maxTop, Math.max(0, Math.round(next)));
}

/** Number of whole rows a viewport shows (at least 1), for Page Up / Page Down. */
export function rowsPerPage(viewportHeight: number, rowHeight: number): number {
  return Math.max(1, Math.floor(viewportHeight / rowHeight));
}
