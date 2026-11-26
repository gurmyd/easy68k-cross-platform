// The Hardware panel's logic that needs no DOM (hardware §2-§5), so that it can be tested under Node.
// The component (HardwarePanel.tsx) only draws what these functions say.
//
// Owner: W3 > SH7.

import {
  ADDRESS_FIELD,
  INTERVAL_FIELD,
  formatMaskedValue,
  parseMaskedText,
  type MaskedConfig,
  type SelectOption,
} from '../../ui/components';
import { HwDevice, MapKind, type HardwareView } from '../../contracts';

/* ------------------------------------------------------------------ 7-segment display (hardware §2.2) */

export interface SegmentShape {
  bit: number;
  name: string; // the shape suffix of the original: a .. h
  x: number; // relative to the digit's origin, in the original's pixels
  y: number;
  w: number;
  h: number;
}

/** Bit to segment, with the geometry of the original's shapes (hardwareu.dfm, hardware §2.2). */
export const SEGMENTS: readonly SegmentShape[] = [
  { bit: 0, name: 'a', x: 4, y: 8, w: 20, h: 5 },
  { bit: 1, name: 'b', x: 24, y: 12, w: 5, h: 20 },
  { bit: 2, name: 'c', x: 24, y: 36, w: 5, h: 20 },
  { bit: 3, name: 'd', x: 4, y: 56, w: 20, h: 5 },
  { bit: 4, name: 'e', x: 0, y: 36, w: 5, h: 20 },
  { bit: 5, name: 'f', x: 0, y: 12, w: 5, h: 20 },
  { bit: 6, name: 'g', x: 4, y: 32, w: 20, h: 5 },
  { bit: 7, name: 'h', x: 32, y: 56, w: 5, h: 5 },
];

/** x of each digit's origin inside the black panel, leftmost (seg7, byte seg7+0) first. */
export const DIGIT_ORIGINS: readonly number[] = [8, 48, 88, 128, 168, 208, 248, 288];

/** The black display panel and the grey LED panel, in the original's pixels. */
export const DISPLAY_SIZE = { width: 329, height: 69 } as const;
export const LED_PANEL_SIZE = { width: 329, height: 33 } as const;

/** Whether `bit` of `byte` is lit (1 = on). */
export function lit(byte: number, bit: number): boolean {
  return ((byte >> bit) & 1) === 1;
}

/** The bit columns, left to right: 7 .. 0 (LEDs, switches, push buttons; hardware §2.3). */
export const BITS_LEFT_TO_RIGHT: readonly number[] = [7, 6, 5, 4, 3, 2, 1, 0];
/** The IRQ levels, left to right: 7 .. 1 (hardware §5, row 5). */
export const LEVELS_LEFT_TO_RIGHT: readonly number[] = [7, 6, 5, 4, 3, 2, 1];

/** Left of LED n inside the grey panel: 16 + 40 * (7 - n), top 8, 17 x 17 (hardware §2.3). */
export function ledLeft(bit: number): number {
  return 16 + 40 * (7 - bit);
}

/** The display as text, for screen readers: the eight bytes in hex, leftmost first. */
export function displayDescription(seg7Bytes: ArrayLike<number>): string {
  return `7-segment display: ${Array.from({ length: 8 }, (_, i) => hex2(seg7Bytes[i] ?? 0)).join(' ')}`;
}

/** The LEDs as text, for screen readers: the eight bits, bit 7 first. */
export function ledDescription(ledByte: number): string {
  return `LEDs: ${(ledByte & 0xff).toString(2).padStart(8, '0')}`;
}

function hex2(value: number): string {
  return (value & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

/* ------------------------------------------------------------------ address and interval fields */

export interface DeviceRow {
  device: HwDevice;
  /** For screen readers; every row's visible label is `Address:` (hardware §5). */
  name: string;
  conflict: keyof HardwareView['addressConflict'];
  value: (view: HardwareView) => number;
  /** Enter and leaving the field have their own effect (hardware §2.4, §2.5). */
  commits: boolean;
}

export const DEVICE_ROWS: readonly DeviceRow[] = [
  { device: HwDevice.Seg7, name: '7-segment display', conflict: 'seg7', value: (v) => v.controls.seg7, commits: false },
  { device: HwDevice.Led, name: 'LEDs', conflict: 'led', value: (v) => v.controls.led, commits: false },
  {
    device: HwDevice.Switch,
    name: 'Toggle switches',
    conflict: 'sw',
    value: (v) => v.controls.switches,
    commits: true,
  },
  {
    device: HwDevice.PushButton,
    name: 'Push buttons',
    conflict: 'pb',
    value: (v) => v.controls.pushButtons,
    commits: true,
  },
];

export interface MapRowSpec {
  kind: MapKind;
  label: string;
  note: string;
}

/** The Memory Map group, top to bottom, with the original's captions (hardware §4.1). */
export const MAP_ROWS: readonly MapRowSpec[] = [
  { kind: MapKind.Rom, label: 'ROM:', note: 'Writes are ignored' },
  { kind: MapKind.Read, label: 'Read:', note: 'Bus error on write' },
  { kind: MapKind.Protected, label: 'Protected:', note: 'Supervisor access' },
  { kind: MapKind.Invalid, label: 'Invalid:', note: 'Bus error on access' },
];

/** The level list of the Auto Interval group: items '1'..'7' and an eighth, empty item (hardware §3.6). */
export const LEVEL_OPTIONS: readonly SelectOption<string>[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((level) => ({ value: String(level), label: String(level) })),
  { value: '8', label: '' },
];

/** The text an address field shows for a value: six hex digits (hardware §2.1). */
export function addressText(value: number): string {
  return formatMaskedValue(value & 0xffffff, ADDRESS_FIELD);
}

/** The text the interval field shows: eight decimal digits, zero-filled on the left (250 -> 00000250). */
export function intervalText(ms: number): string {
  return formatMaskedValue(ms, INTERVAL_FIELD);
}

/**
 * What a field shows when the engine's value is `value` and the field currently holds `current`.
 * The field keeps the user's text while it stands for the same number (the engine has caught up
 * with what was typed, or the user typed a different spelling of the same number); otherwise the
 * engine changed the value by itself (a load, task 32/6, another level selected) and the field
 * shows the engine's value.
 */
export function syncFieldText(current: string, value: number, config: MaskedConfig): string {
  if (parseMaskedText(current, config.kind) === value) return current;
  return formatMaskedValue(value, config);
}

/* ------------------------------------------------------------------ push buttons (hardware §2.5) */

/**
 * Which push buttons are held, and by what (a pointer id or the keyboard). A button is pressed for
 * the program when its first holder arrives and released when its last holder leaves, so that a
 * key and a pointer on one button, or a repeated key-down, give one press and one release. Every
 * way a hold can end without its "up" event (pointer cancel, lost capture, leaving the window,
 * blur) ends in `releaseAll` or `release`, so that no bit stays 0 by accident (hardware §9.2
 * item 8; ARCHITECTURE.md 3.3.3).
 */
export class ButtonHolds {
  private readonly holders = new Map<number, Set<string>>();

  constructor(private readonly actions: { pressButton(bit: number): void; releaseButton(bit: number): void }) {}

  press(bit: number, holder: string): void {
    let set = this.holders.get(bit);
    if (!set) {
      set = new Set();
      this.holders.set(bit, set);
    }
    if (set.has(holder)) return;
    set.add(holder);
    if (set.size === 1) this.actions.pressButton(bit);
  }

  release(bit: number, holder: string): void {
    const set = this.holders.get(bit);
    if (!set?.delete(holder)) return;
    if (set.size === 0) {
      this.holders.delete(bit);
      this.actions.releaseButton(bit);
    }
  }

  /** Ends every hold of `holder` (a pointer that was cancelled), or every hold at all. */
  releaseAll(holder?: string): void {
    for (const [bit, set] of [...this.holders]) {
      if (holder === undefined) {
        set.clear();
      } else if (!set.delete(holder)) {
        continue;
      }
      if (set.size === 0) {
        this.holders.delete(bit);
        this.actions.releaseButton(bit);
      }
    }
  }

  isHeld(bit: number): boolean {
    return this.holders.has(bit);
  }
}

/**
 * Whether a key that reaches a focused push button presses it. The original presses on any key
 * (pbNKeyDown ignores Key); keys that move the focus or only modify do not reach the button in a
 * VCL form and do not press it here.
 */
export function pressesButton(key: string): boolean {
  return !['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Escape'].includes(key);
}

/* ------------------------------------------------------------------ change detection */

/**
 * A short text that changes whenever anything the panel draws changes; the panel re-renders only
 * then. It is computed once per display frame.
 */
export function viewSignature(view: HardwareView): string {
  return JSON.stringify([
    view.controls,
    Array.from(view.seg7Bytes),
    view.ledByte,
    view.buttonsEnabled,
    view.autoLabel,
    view.addressConflict,
  ]);
}

/* ------------------------------------------------------------------ scrolling */

/** A box in the page's coordinates (getBoundingClientRect). */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where the panel's scroll area must scroll so that `target` (a control that got the focus) is in
 * view inside `view` (the area's visible box), with `margin` px around it where there is room; the
 * scroll position unchanged when it is in view already. A target larger than the view shows its top
 * and left edge.
 */
export function revealScroll(
  view: Box,
  scroll: { top: number; left: number },
  target: Box,
  margin = 4,
): { top: number; left: number } {
  const axis = (start: number, size: number, viewStart: number, viewSize: number, current: number): number => {
    const before = start - viewStart;
    const after = start + size - (viewStart + viewSize);
    if (before < 0) return Math.max(0, current + before - margin);
    if (after > 0) {
      const by = size + 2 * margin > viewSize ? before - margin : after + margin;
      return Math.max(0, current + Math.max(0, by));
    }
    return current;
  };
  return {
    top: Math.round(axis(target.top, target.height, view.top, view.height, scroll.top)),
    left: Math.round(axis(target.left, target.width, view.left, view.width, scroll.left)),
  };
}
