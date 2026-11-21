Status: item 1 (SH8) done at gate I1 round 3: `SimRunController.confirmLoad(origin)` and `open(path, origin, { confirmed: true })` in `app/src/core/run/controller.ts`, tests in `controller.load.test.ts` ("confirmLoad: step 2 on its own"); the hold ends with the answer (errata SH8.md entry 31). Item 2 (FS1) open. (Filed by the contracts engineer, W1, at gate I1 round 3. Addressed to SH8 (item 1) and FS1 (item 2).)

# W1: ask `Caution` before a dropped `.S68` is copied (`RunController.confirmLoad`, `LoadOptions`)

Package: W1 (contracts). Requested change: `app/src/core/run/controller.ts` (SH8) and the drop
handling of `app/src/features/files` (FS1). W1 may edit neither. Asked by FS1 in gate I1 round 2
(needs list: "to ask 'Caution' before a dropped .S68 is copied, RunController would need e.g.
open(path, 'drop', { confirmed: true }) or a confirmDiscard()").

## Why

The original asks `The current debug environment will be lost, click OK to continue.` first when a
program file is dropped on the simulator with a program loaded, and does nothing on Cancel
(sim-ui §8.4; ARCHITECTURE.md 4.7 step 2). In a browser the port must first copy the dropped file
into `My Programs/Imported/` and the controller asks the question only inside `open`, so today the
copy happens before the question and stays on Cancel (`docs/differences/FS1.md`).

## What the contract now has (errata W1.md, entry 13)

`app/src/contracts/run.ts`, both optional, so every existing controller and caller stays valid:

```ts
export interface LoadOptions {
  confirmed?: boolean; // the caller has just asked step 2 with confirmLoad(origin) and got OK
}
open(path: VPath, origin: LoadOrigin, options?: LoadOptions): Promise<void>;
confirmLoad?(origin: LoadOrigin): Promise<boolean>;
```

`confirmLoad(origin)` is step 2 of 4.7 on its own: it asks the `Caution` question exactly when
`open(path, origin)` would ask it now, holding the program meanwhile, and resolves true when the
load may go on (no question needed, or OK) and false on Cancel. `open(..., { confirmed: true })`
then skips step 2. A controller that has `confirmLoad` honours `confirmed`; a caller passes
`confirmed` only to a controller that has `confirmLoad`.

## What is asked

1. **SH8**: implement `confirmLoad(origin)` by moving the question of step 2 out of `open` into a
   function both use, and skip it in `open` when `options?.confirmed` is true. Steps 1 and 3-10
   are unchanged; a request during `loading` is still ignored. Unit tests: `confirmLoad('drop')`
   with no program resolves true without a question; with a program it asks once and resolves the
   answer; `open(p, 'drop', { confirmed: true })` asks nothing.
2. **FS1**, a dropped `.S68` in Simulator mode in a browser: when `ctx.run.controller.confirmLoad`
   (or however the controller reaches the drop code) exists, first
   `if (!(await controller.confirmLoad('drop'))) return;`, then copy into `My Programs/Imported/`
   (with its own replace question), then `controller.open(copy, 'drop', { confirmed: true })`.
   Without `confirmLoad`, keep today's order. Remove the entry from `docs/differences/FS1.md` once
   the new order is in.

Item 2 depends on item 1.
