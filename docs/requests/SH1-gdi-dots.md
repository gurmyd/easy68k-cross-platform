# Request from SH1 to T2: GDI reference cases for the pen widths 13-255 (gate I1)

Status: done. Items 1 and 2 by T2 in gate I1 round 2 (suite `pens`, 1,736 cases; T2 errata 1.11);
item 3 by T2 in round 1. The surface equals all 1,228 rectangle cases of `pens`, and the 508 dots of
zero-length lines and one-point ellipses as well (they wait for SH2 in T2's test); SH1 errata entry 13.

The committed GDI references (`tests/conformance/gdi/cases.ts`, 6.5.1) have rectangles with the pen
widths 0-12 and wide lines with 2-14. A pen width is a byte (task 93), and rectangles of every pen
width are SH1's (ARCHITECTURE.md 3.4 rule 5). At gate I1 SH1 measured the rest with T2's own
capture program, on case lists of its own (`docs/porting/errata/SH1.md` entry 14; scratch files in
`build/SH1/capture/`, not committed), and found three things no rule of trap15-b §6.2 or §6.3
predicts:

- the round dot of a wide pen is a polygon's shape, not a disc: of the widths 15-255 only 15 and
  24 are the disc, and 35 widths are not symmetric;
- a one-point rectangle differs from a zero-length line and a one-point ellipse by one or two
  pixels at 15 widths;
- the vertical bar (case B) of a pen exactly 206 wide is sheared by one row.

`app/src/core/sim-host/surface/tables/dots.ts` now holds the measured dot of every width 2-255
and `rect.ts` the sheared bar; the surface equals GDI on all 20,745 cases SH1 captured. But none of
those cases is in the committed references, so the conformance job and `npm run oracle:gdi` do
not guard them, and another Windows (the CI runner) has not been asked.

Requested, in `tests/conformance/gdi/cases.ts` and the golden packs (T2 owns both):

1. A suite of dots, three cases for every pen width 2-255 on a canvas of about 300 x 300:
   `rect x y x y`, `line x y x y` and `ellipse x y x y` (762 cases; as run-length `.pix` they are
   small). The zero-length lines and one-point ellipses are SH2's by the grouping of
   `surface.test.ts`, but they are drawn by the same table and are equal today.
2. Rectangles with pen widths above 12: for every width 13-255 one bar in each direction and one
   frame (case A with and without an interior), and the vertical bar of width 206 at two lengths.
   About 1,000 cases.
3. In `surface.test.ts`: count rectangles of a pen 2 or more wide in the SH1 group (they are
   SH1's and all 8,537 committed ones are equal), so that they are guarded now and not only when
   SH2 delivers. (T2 did this in gate I1 round 1, while this request was being written; it is
   listed here for completeness only.)

SH1's case lists can be regenerated from the scripts in `build/SH1/capture/` on the gate machine
(`capture-dots.mjs`, `capture-dots2.mjs`, `capture-bars.mjs`, `capture-more.mjs`,
`capture-extreme.mjs`); they are plain text in the form `serializeCases` writes, which
`gdi-capture.exe cases <list> <out>` reads.

Until then the table is held by SH1's unit tests: a checksum and the pixel total of the captured
dots (`tables/dots.test.ts`) and the hash of a scene of 1,016 wide-pen rectangles that GDI drew
identically (`WIDE_RECTANGLE_SCENE_HASH` in `surface/testing.ts`, also checked in both browsers by
`check-surface.mjs`).
