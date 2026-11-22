# Differences introduced by SH2 (ellipses and wide pens)

The surface draws ellipses and lines of pens 2 or more pixels wide by GDI's own rules, measured on
Windows 11 (`docs/porting/gdi-deviations.md` section 3): every one-pixel ellipse T2 and SH2 captured
(8,192 small and 3,000 large boxes), every wide line and every pen dot are Windows' pixel for pixel.
What still differs is listed here, with the figures of `docs/porting/gdi-deviations.md`, the
regression baseline. DOC1 merges this file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why | Can a program observe it? |
|---|---|---|---|---|
| Ellipses (tasks 88 and 91) drawn with a pen 2 to 8 pixels wide (trap15-b V11) | GDI's widened shape | Windows' pixels in 496 of the 500 boxes of SH2's suite `ellipses-wide`; in the other four 1 to 3 pixels more: `ellipses-wide-00125` (3 pixels), `-00158` (3), `-00195` (2: pen 3, box 3 x 75, the pixels one above the top centre and one below the bottom centre), `-00428` (1). They are filled ellipses in Copy mode whose box has an odd side of 3 to 11 pixels, and the extra pixels lie at a narrow end, where GDI's join between two very short segments is not modelled exactly. Further families measured by SH2's verifications (very small boxes, pens wider than a narrow box, mid-size pens) differ in a few cases by 1 to 16 pixels | GDI's choice of the join there was not found (`docs/porting/gdi-deviations.md` section 2); ARCHITECTURE.md 6.5.2 reports these figures and sets no threshold for them in version 1 | Yes, through task 83 on those few pixels |
