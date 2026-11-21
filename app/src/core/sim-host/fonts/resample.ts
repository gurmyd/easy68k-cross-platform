// Resampling of glyph bitmaps (ARCHITECTURE.md 3.5.1): when no atlas has exactly the measured cell,
// the glyph of the nearest atlas is brought to the measured cell - by whole-number pixel repetition
// for raster faces when the factor is whole (which is what Windows does with them), by area
// averaging otherwise.
//
// Both functions use whole-number arithmetic only, so the result is the same in every JavaScript
// engine.
//
// Owner: SH3.

/** Every pixel becomes a block of `kx` x `ky` pixels. */
export function repeatPixels(source: Uint8Array, width: number, height: number, kx: number, ky: number): Uint8Array {
  const result = new Uint8Array(width * kx * height * ky);
  const resultWidth = width * kx;
  for (let y = 0; y < height; y++) {
    const firstRow = y * ky * resultWidth;
    for (let x = 0; x < width; x++) {
      const value = source[y * width + x] as number;
      if (value !== 0) result.fill(value, firstRow + x * kx, firstRow + (x + 1) * kx);
    }
    for (let copy = 1; copy < ky; copy++) {
      result.copyWithin(firstRow + copy * resultWidth, firstRow, firstRow + resultWidth);
    }
  }
  return result;
}

/**
 * Scales a bitmap to `newWidth` x `newHeight` with a box filter: every result pixel is the average
 * of the source area it covers, each source pixel weighted by the part of it that lies inside.
 */
export function areaAverage(
  source: Uint8Array,
  width: number,
  height: number,
  newWidth: number,
  newHeight: number,
): Uint8Array {
  const result = new Uint8Array(newWidth * newHeight);
  if (width === 0 || height === 0) return result;
  // In units of 1 / (width * newWidth) of the bitmap's width, source column i covers
  // [i * newWidth, (i + 1) * newWidth) and result column x covers [x * width, (x + 1) * width).
  // The same holds for rows. A result pixel therefore has the total weight width * height.
  const total = width * height;
  const half = total >> 1;
  for (let y = 0; y < newHeight; y++) {
    const top = y * height;
    const bottom = top + height;
    const firstRow = Math.floor(top / newHeight);
    const lastRow = Math.min(height - 1, Math.floor((bottom - 1) / newHeight));
    for (let x = 0; x < newWidth; x++) {
      const left = x * width;
      const right = left + width;
      const firstColumn = Math.floor(left / newWidth);
      const lastColumn = Math.min(width - 1, Math.floor((right - 1) / newWidth));
      let sum = 0;
      for (let j = firstRow; j <= lastRow; j++) {
        const rowWeight = Math.min(bottom, (j + 1) * newHeight) - Math.max(top, j * newHeight);
        for (let i = firstColumn; i <= lastColumn; i++) {
          const value = source[j * width + i] as number;
          if (value === 0) continue;
          const columnWeight = Math.min(right, (i + 1) * newWidth) - Math.max(left, i * newWidth);
          sum += value * rowWeight * columnWeight;
        }
      }
      result[y * newWidth + x] = Math.floor((sum + half) / total);
    }
  }
  return result;
}
