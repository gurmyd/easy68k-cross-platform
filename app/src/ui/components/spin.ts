// Value arithmetic of SpinField (pure, tested under Node). Owner: W2.

export interface SpinRange {
  min: number;
  max: number;
  /** Arrow keys and the buttons. Default 1. */
  step?: number;
  /** Page Up / Page Down. Default 10 steps. */
  page?: number;
}

export function clampSpin(value: number, range: SpinRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** The value after `key` on a spin button, or null for other keys (WAI-ARIA spinbutton). */
export function spinKeyValue(key: string, value: number, range: SpinRange): number | null {
  const step = range.step ?? 1;
  const page = range.page ?? step * 10;
  switch (key) {
    case 'ArrowUp':
      return clampSpin(value + step, range);
    case 'ArrowDown':
      return clampSpin(value - step, range);
    case 'PageUp':
      return clampSpin(value + page, range);
    case 'PageDown':
      return clampSpin(value - page, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return null;
  }
}

/** The number typed into the field, clamped; null when the text is not a whole number. */
export function parseSpinText(text: string, range: SpinRange): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return clampSpin(parseInt(trimmed, 10), range);
}
