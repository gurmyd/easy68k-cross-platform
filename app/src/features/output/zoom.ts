// Scaling of the Output surface on screen (ARCHITECTURE.md 2.5).
//
// The canvas's backing store is always exactly the surface (640x480 at start). CSS shows it at a
// whole-number scale with `image-rendering: pixelated`, so every surface pixel is a square of
// equal screen pixels and nothing is smoothed:
//
//   Fit    the largest whole-number scale at which the surface fits the panel; 1 if even that
//          does not fit (the panel then scrolls)
//   100%   scale 1
//   200%   scale 2
//
// Full screen always shows the surface centred at the Fit scale of the screen.

import type { AppSettings } from '../../contracts';

export type OutputZoom = AppSettings['layout']['outputZoom']; // 'fit' | 1 | 2

export interface Size {
  width: number;
  height: number;
}

/** The zoom choices of the header strip, in order, with the value a <select> holds for each. */
export const ZOOM_CHOICES: readonly { value: string; zoom: OutputZoom; label: string }[] = [
  { value: 'fit', zoom: 'fit', label: 'Fit' },
  { value: '1', zoom: 1, label: '100%' },
  { value: '2', zoom: 2, label: '200%' },
];

/** The zoom of a <select> value; Fit for anything unknown. */
export function zoomOfValue(value: string): OutputZoom {
  return ZOOM_CHOICES.find((choice) => choice.value === value)?.zoom ?? 'fit';
}

/** The largest whole-number scale at which `surface` fits into `available`; at least 1. */
export function fitScale(surface: Size, available: Size): number {
  if (surface.width <= 0 || surface.height <= 0) return 1;
  const scale = Math.floor(Math.min(available.width / surface.width, available.height / surface.height));
  return Number.isFinite(scale) && scale >= 1 ? scale : 1;
}

/** The scale at which the surface is shown for a zoom choice. */
export function outputScale(zoom: OutputZoom, surface: Size, available: Size): number {
  return zoom === 'fit' ? fitScale(surface, available) : zoom;
}

/**
 * Where the scaled surface stands in the panel: centred, on whole pixels (a canvas at half a
 * pixel would be blurred), and at the top left corner in a direction in which it does not fit,
 * so that scrolling reaches all of it.
 */
export function outputPlacement(surface: Size, scale: number, available: Size): Size & { left: number; top: number } {
  const width = surface.width * scale;
  const height = surface.height * scale;
  return {
    width,
    height,
    left: Math.max(0, Math.floor((available.width - width) / 2)),
    top: Math.max(0, Math.floor((available.height - height) / 2)),
  };
}

/** The surface size as the header strip and the Options menu write it: `640x480`. */
export function sizeText(size: Size): string {
  return `${size.width}x${size.height}`;
}
