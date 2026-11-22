Status: open.

# Request from the stdio work (branch `gate3/stdio`) to SH6 (`app/src/core/sim-host/files/`)

Since this branch the simulator engine has the file streams of the Borland run-time that is linked
into SIM68K.exe (`engine/sim/shim/STDIO-MODEL.md`). One expectation of
`program-files.engine.test.ts` ("the 'Files' checks of trap15-a §13") encodes the engine before
it:

```ts
expect(word(next()), '54 on read-only: D0').toBe(2);
```

In the run-time, `fwrite` does not look at the stream's mode: a write of up to 512 bytes to a
stream opened `"rb"` (task 51 result 3) is copied into the stream's buffer and the task reports
success, `D0.W = 0`. The failure comes with the flush: task 56 then gives 2, and because the flush
failed the run-time keeps the stream and its handle open (the file cannot be deleted until the
program ends; STDIO-MODEL.md sections 5 and 6, rules R7 and R12). A write of more than 512 bytes
goes to `WriteFile` at once and gives 2 at once. This was read in the machine code of `_fwrite`
(`SIM68K.exe` at `4de9ec`); the Wine oracle cannot make a read-only file, so it is not measured
(trap15-a §13's "task 54 gives 2" was derived from the source, where `fwrite` is a library call).

**Asked.** Expect 0 for this write. With that one value changed every other expectation of the test
holds with the rebuilt engine (checked with a copy of the test outside the repository: 9 passed, 1
skipped). Nothing in `program-files.ts` needs to change: the engine uses its five file calls as the
operating system below the run-time (`ReadFile`, `WriteFile`, `SetFilePointer`, `CloseHandle`) and
relies on two properties it has: a write of 512 bytes or fewer stays pending until the next call on
the handle, and pending bytes are written at `exit()` / `exitNow()` (STDIO-MODEL.md section 10).
Please keep both, or tell the engine's owner if they change.
