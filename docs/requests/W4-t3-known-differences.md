Status: done. a31, a32 and a47 are no longer in `known-differences.json` (removed at gate I2),
and F3 and F4 of docs/porting/errata/T3.md say "Repaired by the engine at gate I2". T4 keeps the
`knownDifference()` id D1 of `compare-sim.mjs` until a twin built from the patched source has run
(docs/porting/errata/T4.md D1). Closed by T3 in the round before gate I3. (Filed by W4 at gate I2
round 1, for T3, the owner of `tests/conformance/sim`.)

# W4: remove a31 and a32 from `tests/conformance/sim/known-differences.json`

T3's note for the engine owner (F3, F4) is done. With the engine rebuilt at gate I2
(`engine/dist/sim68k.wasm` sha256 `33679296aa95df3ba41b8fb676cb2c42575815d51512d84bf8dcd05bb6d8b38f`):

- `trap15-a/a31-files-zero-length`: task 54 with D2 = 0 gives D0.W = 0, as the official binary.
- `trap15-a/a32-files-bounds`: task 53 with A1 = $2000, D2 = $FFFFFFFF gives D0.W = 0, leaves D2 and
  memory unchanged, as the official binary.

How: `fread` / `fwrite` of `SIMOPS2.CPP` now answer these two requests as the Borland run-time
library does (`engine/sim/shim/hostfile.cpp`, `easy68k_fread` / `easy68k_fwrite`; recorded in
`engine/sim/PATCHES.md` section 3). No original file was edited for it.

`EASY68K_REQUIRE_ENGINES=1 npx vitest run --config tests/conformance/sim/vitest.config.ts` now
reports, for both programs, "listed in known-differences.json but now equal; remove the entry".
(The same message appears for `trap15-a/a47-serial-without-port`, which W1's change to
`core/sim-host/serial/null.ts` made equal; that one is W1's and T3's, not the engine's.)

## What is asked

Remove the entries `trap15-a/a31-files-zero-length|report|result` and
`trap15-a/a32-files-bounds|report|result` from `known-differences.json`, regenerate MISMATCHES.md,
and mark F3 and F4 in `docs/porting/errata/T3.md` as repaired by the engine. Before the rebuild the
suite gave 232 passed, 1 failed (a47), 4 skipped; after it 230 passed, 3 failed (a31, a32, a47:
each only "now equal; remove the entry"), 4 skipped. With the three entries removed it should give
233 passed, 4 skipped.

T4's D1 (tasks 0 and 1 with a negative D1.W) is also done in the engine: P24 now ends the string at
character 255 explicitly (`engine/sim/PATCHES.md` P24), which is what T3's F1 measured. Nothing
changes in the WebAssembly build's output; `knownDifference()` id `D1` in T4's `compare-sim.mjs`
can stay or go as T4 decides (a native twin built from the same `engine/sim/src` should now print
255 characters too; W4 has not run the twin).
