Status (item 2, contracts, W1): half done at gate I1 round 2. `AppState.sim.repaint` has the optional counter `stackRedraw?: number` (`contracts/store.ts`). `RepaintBit.StackRedraw = 16` is not added yet: `RepaintBit` must equal the engine's `Repaint` object exactly (`contracts/contracts.test.ts` "engine mirror" and `engine/sim.test.ts` compare them), so it goes in with item 1 and the rebuild of `engine/dist`, in the same change, by whoever the gate gives item 1 to. The line is `export const RepaintBit = { Listing: 1, Breakpoints: 2, Memory: 4, Stack: 8, StackRedraw: 16 } as const;`; the mirror test's table already maps `StackRedraw` to `STACK_REDRAW`. Details: `docs/porting/errata/W1.md`, entry 12.

# U2: tell the Stack panel a redraw (`StackFrm->Repaint()`) from a re-centre (`updateDisplay()`)

Package: U2 (Memory and Stack panels). Requested change: the simulator engine (`engine/sim`, its
shim and `sim68k.mjs`), the contracts (`app/src/contracts/engine.ts` `RepaintBit`,
`app/src/contracts/store.ts` `AppState.sim.repaint`) and the session that counts the bits (SH8,
`features/run`). U2 may edit none of them. Found by the gate I1 round-1 review (defect "A Hardware
switch click or push button still re-centres a Stack panel the user has scrolled").

## What happens now

sim-ui §11.4: only `updateDisplay()` re-centres the Stack window on the selected register;
`Repaint()` redraws it where it is. The original's Hardware window calls `StackFrm->Repaint()` for
a switch click, a push button, `FormShow` and the switch / push-button address commits
(`engine/sim/shim/hardware.cpp` lines 86, 193, 201, 207, 215, 250, 259). The shim maps both calls to
the same bit:

    engine/sim/shim/misc.cpp:31  void TStackFrm::updateDisplay() { host_repaint(REPAINT_STACK); }
    engine/sim/shim/misc.cpp:32  void TStackFrm::Repaint()       { host_repaint(REPAINT_STACK); }

so `AppState.sim.repaint.stack` moves for both, and the Stack panel (`stackRecentreDue` in
`app/src/features/stack/model.ts`) cannot tell them apart: after the user scrolled the Stack panel,
clicking a Hardware switch or push button puts it back on the register. No program can observe
this; only the user's scroll position is lost.

U2 cannot work around it on its side: `updateDisplay()` is also called without any other bit
(the register edits, `SIM68Ku.cpp:1093-1183`, shim `form1.cpp` lines 284-331), so no combination
of the existing counters separates the two cases.

## What is asked

1. Engine (`engine/sim`): a fifth bit, for example `REPAINT_STACK_REDRAW = 16` (`Repaint.StackRedraw`
   in `sim68k.mjs`), sent by `TStackFrm::Repaint()` in place of `REPAINT_STACK`. `updateDisplay()`
   keeps `REPAINT_STACK`.
2. Contracts: `RepaintBit.StackRedraw = 16` and an optional counter `stackRedraw` in
   `AppState.sim.repaint` (optional, so that a session without it stays valid).
3. SH8 (session): count the new bit like the others.

U2 then redraws without re-centring when only `repaint.stackRedraw` moves (a change of a few lines
in `stack/model.ts`, with a unit test on the real engine: scroll, `switchClick(0)`, the middle row
stays). Until then the remaining case is recorded in `docs/porting/errata/U2.md` C2.

Priority: low (no program-visible effect). It needs a rebuild of `engine/dist`, which only the gate
may do.
