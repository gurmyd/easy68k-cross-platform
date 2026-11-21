// The round dots of wide pens (ARCHITECTURE.md 3.4 rule 4; trap15-b §6.2): what GDI draws for a
// zero-length line, a one-point rectangle or a one-point ellipse when the pen is 2 or more pixels
// wide, and the shape of the round caps at the ends of a wide line.
//
// A dot is centred on its point and is symmetric left-right and top-bottom, so it is stored as the
// half-widths of its rows from the centre row outwards: `[2, 2, 1]` is
//
//      .###.
//      #####
//      #####     <- centre row, half-width 2
//      #####
//      .###.
//
// Where the shapes come from:
//
//   widths 2-9     measured on Windows GDI, pixel by pixel (the figure of trap15-b §6.2).
//   widths 10-14   trap15-b §6.2 gives only their pixel counts (69, 89, 101, 129, 145) and diameters
//                  (9, 11, 11, 13, 13). The rows below are those of a regular twelve-sided polygon
//                  inscribed in the circle of diameter `width`, with a flat side at the top: the one
//                  simple shape that reproduces the measured dots of the widths 4, 5, 7, 8 and 9 and
//                  the measured counts of 10-14. The GDI capture has since confirmed them pixel for
//                  pixel (tests/conformance/gdi: one-point rectangles of the widths 2-12, zero-length
//                  lines of the widths 2-14, in every drawing mode).
//   widths 15-255  NOT measured. The pixels whose centre lies inside the circle of diameter `width`
//                  around the centre of the pen's pixel.
//
// First version by SH1 for the rectangle rule of trap15-b §6.3 (case C) and the wide-line stub.
// SH2 replaces the unmeasured widths with captured shapes and owns this file from then on. What the
// rest of the surface uses is `dotRows`.
//
// Owner: SH1 > SH2.

/** Rows of the dots of the pen widths 2-14, from the centre row outwards. */
const DOTS: Readonly<Record<number, readonly number[]>> = {
  2: [0],
  3: [1, 0],
  4: [1, 1],
  5: [2, 2, 1],
  6: [2, 2, 1],
  7: [3, 3, 2, 1],
  8: [3, 3, 3, 2],
  9: [4, 4, 3, 3, 1],
  10: [4, 4, 4, 3, 2],
  11: [5, 5, 4, 4, 3, 1],
  12: [5, 5, 5, 4, 4, 2],
  13: [6, 6, 6, 5, 4, 3, 2],
  14: [6, 6, 6, 6, 5, 4, 3],
};

/** The dots of the widths above 14, computed when first asked for. */
const computed = new Map<number, readonly number[]>();

/** The pixels strictly inside the circle of diameter `width` around a pixel centre. */
function circleRows(width: number): readonly number[] {
  const limit = width * width; // (2 * distance)^2 must stay below this
  const rows: number[] = [];
  for (let dy = 0; 4 * dy * dy < limit; dy++) {
    let half = 0;
    while (4 * ((half + 1) * (half + 1) + dy * dy) < limit) half++;
    rows.push(half);
  }
  return rows;
}

/**
 * The dot of a pen `width` pixels wide (2-255): entry i is the half-width of the row i pixels above
 * the centre and of the row i pixels below it, so the row covers x - half .. x + half.
 */
export function dotRows(width: number): readonly number[] {
  const known = DOTS[width];
  if (known) return known;
  let rows = computed.get(width);
  if (!rows) {
    rows = circleRows(width);
    computed.set(width, rows);
  }
  return rows;
}
