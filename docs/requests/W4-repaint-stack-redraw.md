Status: done (filed by W4 at gate I1 round 3, for the contracts engineer; `RepaintBit.StackRedraw = 16` was in `app/src/contracts/engine.ts` when W4 ran the mirror tests after the rebuild, and both pass). SH8's item 3 remains.

# W4: add `RepaintBit.StackRedraw = 16` to the contracts (item 2 of U2-stack-redraw-bit.md)

Package: W4 (simulator engine and binding). Requested change: `app/src/contracts/engine.ts`
(owner: the gate's contracts engineer). Related: `docs/requests/U2-stack-redraw-bit.md`,
`docs/porting/errata/W1.md` entry 12, `docs/porting/errata/W4.md` (round 3).

## What changed in the engine

Item 1 of `U2-stack-redraw-bit.md` is built in this round:

- `engine/sim/shim/host.h`: `REPAINT_STACK_REDRAW = 16`.
- `engine/sim/sim68k.mjs`: `Repaint = { LISTING: 1, BREAKPOINTS: 2, MEMORY: 4, STACK: 8, STACK_REDRAW: 16 }`.
- `engine/sim/shim/misc.cpp`: `TStackFrm::Repaint()` sends `REPAINT_STACK | REPAINT_STACK_REDRAW`
  (24); `TStackFrm::updateDisplay()` keeps `REPAINT_STACK` (8).

One deliberate difference from the request: `Repaint()` sends **both** bits, not the new bit in
place of the old one. Every host that counts only `Stack` today keeps redrawing the Stack panel for
a Hardware switch click exactly as before (nothing that other packages call changes; ground rule of
this round: add, do not change). A host that also counts `StackRedraw` re-centres only when the
`Stack` counter moved by more than the `StackRedraw` counter.

## What is asked

The one line in `app/src/contracts/engine.ts` (line 189 today), exactly as W1's erratum 12 has it:

    export const RepaintBit = { Listing: 1, Breakpoints: 2, Memory: 4, Stack: 8, StackRedraw: 16 } as const;

`sim68k.mjs` is imported from source, so the engine side is in effect **now**, before and independent
of the rebuild of `engine/dist`. Until this line is in, two mirror tests fail with "expected 4 keys,
got 5" or a toEqual difference:

- `app/src/contracts/contracts.test.ts` "engine mirror" (its rename table already maps
  `StackRedraw` to `STACK_REDRAW`);
- `app/src/engine/sim.test.ts` "the constant objects carry the numbers of the module" (needs no
  change; its upper-snake translation gives `STACK_REDRAW`).

Both must land in the same commit. If the contracts engineer cannot make the change in this round,
tell the orchestrator, who must then not commit the `sim68k.mjs` / `host.h` / `misc.cpp` change of W4
without it.

## Then (not for the contracts engineer)

- SH8 (`features/run`): count `RepaintBit.StackRedraw` into `AppState.sim.repaint.stackRedraw`
  like the other bits (item 3 of the U2 request).
- U2 (`features/stack/model.ts`): re-centre when `repaint.stack` moved by more than
  `repaint.stackRedraw` (not "when only stackRedraw moves": both move for a `Repaint()`).
