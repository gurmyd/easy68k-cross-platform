# SH2 request: capture the pen nibs with the GDI capture program

- From: SH2 (ellipses and wide pens). To: T2 (owner of `tests/oracle/gdi-capture/`).
- Status: done by T2 in gate I2 round 1. `gdi-capture nibs` writes `tests/conformance/gdi/golden/nibs.json` (the cap vertices at P0 over 360 directions, widths 2-255, plus the widened paths of the tie directions of SH2's review); `npm run oracle:gdi` regenerates and compares it on Windows (`--only nibs` alone), and `tests/conformance/gdi/nibs.test.ts` holds `pens.ts` to it on every system: all 254 nibs equal on this Windows (10.0.26300). Note for SH2: relative to P1 the cap vertices of many directions lie one sixteenth further out than the nib (README.md "Pen nibs"; the `ties` paths show it).

## What

Add an output to `capture.cpp` / `run.mjs` that measures, for every pen width 2-255, the polygon
GDI makes of the pen (its "nib"), and compare it with `app/src/core/sim-host/surface/tables/pens.ts`
in `npm run oracle:gdi` (so that CI's `windows-oracles` job notices when Windows changes it).

How SH2 measured it (scratch probe, `docs/porting/gdi-deviations.md` section 4): a memory DC with a
32-bit DIB section; `SetGraphicsMode(GM_ADVANCED)`; world transform scale 1/16 in x and y; a pen
`CreatePenIndirect(PS_SOLID, 16 * w)`; for each of 360 directions `BeginPath`, `MoveToEx(0, 0)`,
`LineTo(16000 cos a, 16000 sin a)`, `EndPath`, `WidenPath`, `GetPath`. The widened path is
`P0 + offset, cap vertices..., P0 - offset, P1 - offset, cap vertices..., P1 + offset`; the nib is
the union of the cap vertices over the directions (relative to P0 or P1). `pens.ts` stores the half
of each nib with angles in (-180, 0] degrees; the test next to it holds a checksum of the capture.

## Why

`pens.ts` is a measured table like `tables/dots.ts`, but unlike the dots (T2's suite `pens`) it has
no committed reference that the capture regenerates. The wide-line suites (`widelines`, `pens`,
`modes`, `clip`, `polylines`) guard it indirectly for the widths 2-14 and the zero-length lines of
every width; a direct capture would guard every vertex of every width.
