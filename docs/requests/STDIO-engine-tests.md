Status: open.

# Request from the stdio work (branch `gate3/stdio`) to W4 (`app/src/engine/`)

Since this branch the simulator engine has the file streams of the Borland run-time that is linked
into SIM68K.exe (`engine/sim/shim/STDIO-MODEL.md`, `engine/sim/shim/hostfile.cpp`). A task 53 of
fewer than 512 bytes therefore reaches the host as `fileRead(handle, 512)`: the run-time fills its
512-byte buffer from the file and hands the program the bytes it asked for out of it, as
`ReadFile(512)` does in the original (STDIO-MODEL.md rule R1; measured under Wine by the conformance
programs trap15-a `a30`, `a59`, `a60`). The host interface did not change.

Two expectations of W4's tests encode the engine before this change, when it passed every request
to the host with the program's own count:

1. `app/src/engine/testing.test.ts`, "createTestEngine(parts): the engine talks to the given part":
   `expect(test.callsTo('fileRead')).toEqual([[1, 4]])` - the program reads 4 bytes of a 4-byte
   file; the engine now asks for `[[1, 512]]` (one fill; the file has 4 bytes, the read returns
   them).
2. `app/src/engine/trap15.test.ts`, "the tour on the real engine ... the program got the results
   of the host and of the keyboard": `expect(tour.log).toContain('fileRead(1,2)')` - the tour's
   task 53 reads 2 bytes; the log now has `fileRead(1,512)`.

**Asked.** Change the two expected values to `[[1, 512]]` and `'fileRead(1,512)'` (or assert that
a `fileRead` of handle 1 happened, if the count is not what the tests mean to pin). Every other test
of `app/src/engine` passes with the rebuilt engine (`npx vitest run src/engine`: 2 failures, these
two; 1,214 other tests of `src/core/sim-host` and `src/engine` pass).
