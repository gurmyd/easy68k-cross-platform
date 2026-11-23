// The size formatter of the stage's texts (ARCHITECTURE-PLUS P3.2.6, P3.3.8, P3.5). Owner: N3.
//
// Pure; runs under Node. "Sizes are written with one decimal and the units bytes, kB, MB, GB
// (1 kB = 1024 bytes)": 7.3 kB, 48.2 MB, 1.8 GB. A size below 1 kB is a whole number of bytes
// (`512 bytes`, `1 byte`), since bytes have no decimals (errata N3).

const UNITS = ['kB', 'MB', 'GB'] as const;

/** `bytes` as the texts of the stage write a size. */
export function formatSize(bytes: number): string {
  const value = Math.max(0, Math.round(bytes));
  if (value < 1024) return value === 1 ? '1 byte' : `${value} bytes`;
  let size = value / 1024;
  let unit = 0;
  // Move to the next unit when one decimal would round up to 1024.0 of this one.
  while (unit < UNITS.length - 1 && Math.round(size * 10) / 10 >= 1024) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(1)} ${UNITS[unit]}`;
}
