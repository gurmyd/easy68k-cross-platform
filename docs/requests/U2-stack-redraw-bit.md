Status (item 1, engine, W4): done at gate I1 round 3, with one difference: `StackFrm->Repaint()` sends `Repaint.STACK | Repaint.STACK_REDRAW` (8 | 16), not 16 in place of 8, so hosts that count only `Stack` behave as before; re-centre when `repaint.stack` moved by more than `repaint.stackRedraw`. The contracts line is asked for in `docs/requests/W4-repaint-stack-redraw.md` (same commit). Items 2 (contracts) and 3 (SH8) remain. Details: `docs/porting/errata/W4.md`, round 3. Item 3 (SH8): done at gate I1 round 3, after `RepaintBit.StackRedraw` appeared in the contracts: the controller counts it into `repaintCounts.stackRedraw` and the session mirrors it into `AppState.sim.repaint.stackRedraw` (`core/run/controller.ts`, `features/run/mirror.ts`; tests "counts StackFrm->Repaint() as stackRedraw apart from a re-centre" in `controller.commands.test.ts` and "carries stackRedraw" in `logic.test.ts`).

Status (item 2, contracts, W1): done at gate I1 round 3. `RepaintBit` is `{ Listing: 1, Breakpoints: 2, Memory: 4, Stack: 8, StackRedraw: 16 }` (`contracts/engine.ts`), matching the engine's `Repaint.STACK_REDRAW` built in the same round; `AppState.sim.repaint.stackRedraw?` (round 2) is documented with the engine's encoding: `Repaint()` sends `Stack | StackRedraw`, `updateDisplay()` sends `Stack`, so the Stack panel re-centres only when `stack` moved by more than `stackRedraw`. The mirror tests (`contracts/contracts.test.ts`, `engine/sim.test.ts`) pass with the rebuilt `engine/dist`. Item 3 (SH8 counting the bit) is done as well (the SH8 line above; checked at gate I2 in `core/run/controller.ts`), so all three items are done. Details: `docs/porting/errata/W1.md`, entries 13 and 14.

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

## Owners of the items (added by U2 at gate I1 round 3)

The round-2 review found that items 1 and 3 had no named owner. They are:

- Item 1: the simulator engine's owner (`engine/sim/shim/host.h`, `misc.cpp:32`, `sim68k.mjs`),
  and the gate for the rebuild of `engine/dist`. In the same change the contracts engineer (W1)
  adds `StackRedraw: 16` to `RepaintBit` (the mirror tests need both at once). At round 3 the
  working tree already carried an uncommitted shim change: `REPAINT_STACK_REDRAW = 16` in
  `host.h`, and `TStackFrm::Repaint()` sending `REPAINT_STACK | REPAINT_STACK_REDRAW`, that is
  BOTH bits, so a host that only knows the Stack bit still redraws.
- Item 3: SH8 (`features/run`, the session that counts the bits into `AppState.sim.repaint`):
  count bit 16 into `repaint.stackRedraw`, as it counts the others. With the encoding above, a
  `Repaint()` moves both `stack` and `stackRedraw`.
- U2's part is done at round 3, ahead of items 1 and 3: `stackRecentreDue` in
  `app/src/features/stack/model.ts` re-centres only when `repaint.stack` moved by more than
  `repaint.stackRedraw` did, and the new `stackRedrawDue` redraws in place when only the
  `Repaint()` pairs came. Without the counter the behaviour is unchanged. Unit tests in
  `model.test.ts`. On the real session with the rebuilt engine and SH8's counter,
  `check-memory-stack.mjs` scrolls the Stack panel, clicks Hardware switch 0 and finds the middle
  row unchanged, with `repaint.stack` and `repaint.stackRedraw` both moved by one (passes in
  Chromium and WebKit at round 3). Defect 9 is closed on U2's side.
