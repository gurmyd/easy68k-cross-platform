// Value arithmetic of the Splitter (pure, tested under Node). Owner: W2.

export interface SplitterRange {
  min: number;
  max: number;
  /** Size restored by a double-click or Enter (2.3). */
  defaultValue?: number;
  /** Keyboard step in px. Default 10; with Shift five times as much. */
  step?: number;
  /** 'vertical': a vertical bar between left and right panes; 'horizontal': between top and bottom. */
  orientation: 'vertical' | 'horizontal';
  /** The sized pane is after the bar (right or bottom): moving the bar right or down makes it smaller. */
  invert?: boolean;
}

export function clampSize(value: number, range: Pick<SplitterRange, 'min' | 'max'>): number {
  return Math.round(Math.min(Math.max(value, range.min), Math.max(range.min, range.max)));
}

/** The new size for a key on the focused splitter, or null when the key does nothing. */
export function splitterKeyValue(key: string, shift: boolean, value: number, range: SplitterRange): number | null {
  const step = (range.step ?? 10) * (shift ? 5 : 1);
  const sign = range.invert ? -1 : 1;
  const grow = range.orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
  const shrink = range.orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
  switch (key) {
    case grow:
      return clampSize(value + step * sign, range);
    case shrink:
      return clampSize(value - step * sign, range);
    case 'Home':
      return clampSize(range.min, range);
    case 'End':
      return clampSize(range.max, range);
    case 'Enter':
      return range.defaultValue === undefined ? null : clampSize(range.defaultValue, range);
    default:
      return null;
  }
}

/** The new size while dragging: `delta` px of pointer movement since the drag started. */
export function splitterDragValue(startValue: number, delta: number, range: SplitterRange): number {
  return clampSize(startValue + (range.invert ? -delta : delta), range);
}
