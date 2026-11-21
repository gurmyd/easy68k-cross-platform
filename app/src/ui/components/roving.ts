// Arrow-key movement inside composite widgets (toolbar, tab list, menu bar,
// menus, list box, radio group). Owner: W2.
//
// 2.11: a toolbar is one tab stop with arrow-key movement; tab lists, menu
// bars and menus follow the WAI-ARIA patterns. The arithmetic lives here so it
// can be tested under Node; the components only apply the result.

export type Orientation = 'horizontal' | 'vertical';

export interface MoveOptions {
  orientation: Orientation;
  /** Wrap from the last item to the first and back. Default true. */
  wrap?: boolean;
  /** Items that cannot take the focus are skipped. */
  isSkipped?: (index: number) => boolean;
}

/**
 * The index the focus moves to for `key`, or null when the key does not move
 * it (another orientation's arrow, a letter, ...) or no item can take focus.
 * `current` may be -1 (nothing focused yet): the next key then starts from
 * the beginning (forward keys) or the end (backward keys).
 */
export function moveIndex(count: number, current: number, key: string, options: MoveOptions): number | null {
  const { orientation, wrap = true, isSkipped = () => false } = options;
  const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const backward = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  if (count <= 0) return null;
  switch (key) {
    case 'Home':
      return firstFrom(count, 0, 1, isSkipped);
    case 'End':
      return firstFrom(count, count - 1, -1, isSkipped);
    case forward:
    case backward: {
      const step = key === forward ? 1 : -1;
      if (current < 0) return firstFrom(count, step > 0 ? 0 : count - 1, step, isSkipped);
      for (let i = 1; i <= count; i++) {
        let candidate = current + step * i;
        if (candidate < 0 || candidate >= count) {
          if (!wrap) return current;
          candidate = ((candidate % count) + count) % count;
        }
        if (!isSkipped(candidate)) return candidate;
      }
      return null;
    }
    default:
      return null;
  }
}

/** The first index from `start` in direction `step` that is not skipped, or null. */
export function firstFrom(count: number, start: number, step: 1 | -1, isSkipped: (index: number) => boolean) {
  for (let i = start; i >= 0 && i < count; i += step) if (!isSkipped(i)) return i;
  return null;
}

/** Page Up / Page Down in a list: `page` rows at a time, clamped, not wrapped. */
export function pageIndex(count: number, current: number, key: 'PageUp' | 'PageDown', page: number): number {
  if (count <= 0) return -1;
  const step = Math.max(1, page - 1);
  const next = key === 'PageDown' ? current + step : current - step;
  return Math.min(count - 1, Math.max(0, next));
}
