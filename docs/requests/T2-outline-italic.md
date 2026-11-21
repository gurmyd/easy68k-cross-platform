# Request from T2 to SH3: the widening of italic outline cells (gate I1 round 3)

Status: open (optional for SH3; nothing of SH3's fails today).

T2 measured how far GDI widens the opaque cell of an outline-face text beyond its advance box
(errata T2 section 1 item 18). Plain and bold stay within `max(3, ceil(h / 10))` on each side, the
margin that `app/src/core/sim-host/text/gdi-replay.ts` `outsideTheBoxes` uses. Italic does not: on
the right GDI's ink reaches up to a third of the cell height (Lucida Console 29 pt italic: 13 of 39
rows; 90 pt: 32 of 120), on the left one pixel more than the plain margin (Consolas 19 pt: 4).
`tests/conformance/gdi/text-model.ts` now exports

    outlineWidening(style: number, cellHeight: number): [left: number, right: number]
    // style 2 (italic): [max(3, ceil(h / 10)) + 1, max(3, ceil(0.35 * h))]; otherwise both max(3, ceil(h / 10))

and `outlineCells()` uses it (with a new member `widening(x, y)`).

Asked of SH3, only if SH3 wants task 95 in italic outline faces compared against Windows:

1. Use the same margins in `outsideTheBoxes` (copy the two lines; the conformance folder is not an
   import the application may take).
2. Then add the new suite `text-outline-italic` (177 cases, machine-dependent because the ink
   outside the cell is smoothed) to `gdi-references.test.ts` with the `cells` comparison, as for
   `text-outline-zero`. golden.test.ts shows that `outlineCells` explains all of them.

Until then nothing changes for SH3: `gdi-references.test.ts` does not read the new suite.
