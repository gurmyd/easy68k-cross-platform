# Request from U1: `ListBox1->Items->Clear()` must drop the listing's selection (engine owner, gate)

Status: done (engine owner, W4; gate I1 round 3, recorded at gate I2): `listingItemsCleared` in
`engine/sim/shim/form1.cpp`, `engine/sim/PATCHES.md` section 3, errata W4 entry 9; built into
`engine/dist` since gate I1 round 3 (commit 5c13516). Gate I2 confirmed the whole load path against
the official SIM68K.exe (errata W4 entry 12).

## What happens now

`TForm1::OpenFile` empties the listing with `ListBox1->Items->Clear()` (shim
`engine/sim/shim/form1.cpp`, the line after `initSim()` in `OpenFile`, around line 366 at commit
c4d3dfa). In the VCL that call is `TListBoxStrings.Clear`, which sends `LB_RESETCONTENT`; after it
`LB_GETCURSEL`, that is `ItemIndex`, is -1. The shim's `TStrings::Clear` empties the strings but
leaves `ListBox1->ItemIndex` alone (only `TListBox::Clear`, `form1.cpp` lines 47-49, resets it), and
`highlight()` (`form1.cpp` lines 170-180) never sets -1 itself.

A student can see the difference: open a program, select or reach a row, then open the same
program again WITHOUT File > Close while the PC field already reads its start address. The load
assigns `regPC->EditText` the same text, so `OnChange` (`regPCChange`, the only `highlight()` after
the rows are loaded) does not run, and:

- the port keeps the old row selected (observed at gate I1 round 2 with `demo`: `listingHighlight`
  is 6, the `MOVE.L` start row);
- the original selects nothing (`ItemIndex` -1 after `LB_RESETCONTENT`).

The full trace, and the related Close-then-Open case that already matches the original, are in
`docs/porting/errata/U1.md` entry 8.

## What is asked

1. Engine (`engine/sim/shim/form1.cpp`): clearing `ListBox1->Items` sets `ListBox1->ItemIndex` to
   -1, as `LB_RESETCONTENT` does. For example a `cleared` callback on the list box's `TStrings`
   that resets `ItemIndex`, installed in `TForm1::TForm1()`. Record it in the shim's
   `PATCHES.md` like the other VCL behaviours.
2. Gate: rebuild `engine/dist` with it (`npm run build:engines`), and run the engine's own tests
   and the execution-log comparison against the official binary (`docs/porting/official-oracle.md`)
   once more; the change touches no execution log, because no trace output reads `ItemIndex`.

U1's panel needs no change: it shows `engine.listingHighlight` whatever the engine selects
(`app/src/features/sim-main/real-session.test.ts`, "Open of the same program again without
Close"). Once the rebuilt `engine/dist` is in, U1 tightens that test from "the panel follows the
engine row, and the old click is gone" to "`listingHighlight` is -1 and nothing is selected".

## Note at filing

While this request was written, `engine/sim/shim/form1.cpp` in the working tree already carried an
uncommitted change of exactly this kind (`listingItemsCleared`, installed as
`ListBox1->Items->cleared`), and `engine/dist` was rebuilt with it during gate I1 round 3. With
that build U1 has tightened the test: `real-session.test.ts` now expects `listingHighlight` -1 and
no selected row after the second Open, and passes. What remains for the engine owner and the gate
is only to record the change (PATCHES.md, errata) and to commit the shim with the rebuild.

Priority: low (a selection highlight after an unusual sequence; no program output changes).
