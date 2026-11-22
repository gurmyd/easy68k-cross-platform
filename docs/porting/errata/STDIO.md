# Errata of the stdio work (gate I3, branch `gate3/stdio`)

The simulator engine's file streams (TRAP #15 tasks 50-59) now follow the Borland C++ Builder 6
run-time library that is linked into the official `SIM68K.exe`: `engine/sim/shim/STDIO-MODEL.md`
is the model (read in the program's machine code, measured in the official program under Wine),
`engine/sim/shim/hostfile.cpp` the implementation, `engine/sim/PATCHES.md` section 3 the record.
These entries name the places where the documents say something else.

## Document

1. **ARCHITECTURE.md 3.2 (table "what stays in the engine", row "The file-task results and the
   eight-slot table") and 3.8.4 ("Layer 2 - what the program observes: the C library's files").**
   Both say the engine's file streams are unbuffered and pass every read, write, seek and close to
   the host in program order, so that `ProgramFiles` models the run-time's buffering itself. Since
   this work the engine has the run-time's streams: a 512-byte buffer per stream, one `level`
   counter for both directions, the flags, the 47 free entries of the run-time's stream table, and
   what each of `fread`, `fwrite`, `fseek`, `fclose`, `feof` does in every state (STDIO-MODEL.md
   sections 1-6). The host is the operating system below it (`ReadFile`, `WriteFile`,
   `SetFilePointer`, `CloseHandle`, `DeleteFile`). The host interface is unchanged, and
   `ProgramFiles` is unchanged: its own buffering never answers the engine's requests in a way the
   engine does not intend, and the engine relies on two of its properties (a write of 512 bytes or
   fewer stays pending until the next call on the handle; pending bytes are written at `exit()` /
   `exitNow()`), through which the bytes a stream's flush would write reach the file at the end of
   the process as they do in the original (STDIO-MODEL.md section 10). What the host now sees: a
   read of fewer than 512 bytes arrives as a read of 512 at the run-time's position; writes arrive
   when the run-time's buffer is flushed (and, as pending bytes, while it fills); seeks arrive as
   they did. The sentence "the engine passes the program's operations to the host unbuffered and
   in order (3.2), so `ProgramFiles` models the stream itself" should read: "the engine has the
   run-time's streams (engine/sim/shim/STDIO-MODEL.md) and uses the host as the operating system
   below them; `ProgramFiles` is that operating system, and its pending bytes carry the bytes a
   stream's flush would write to the end of the process."

2. **trap15-tasks-0-59.md, task 51 (line 806: "writes to it fail with 2"), task 54 (line 832:
   "Writing to a handle opened read-only (task 51 result 3) returns 2") and section 13 (line 1058:
   "task 54 gives 2").** The run-time's `fwrite` does not look at the stream's mode (`_fwrite`,
   `SIM68K.exe` `4de9ec`): a write of up to 512 bytes to a read-only stream is copied into its
   buffer and task 54 gives `D0.W = 0`; the flush fails, so task 56 gives 2 and the stream and its
   handle stay open until the program ends (the file cannot be deleted meanwhile). A write of more
   than 512 bytes goes to `WriteFile` at once and gives 2. Measured in the official program under
   Wine with the probe `e3` (STDIO-MODEL.md section 9: the file on a read-only mount, since the
   oracle's own recipes cannot make a file read-only): open 3, write of 2 bytes 0, close 2, task 59
   still 3, a write of 600 bytes 2. The port now does this; the tests that expected 2
   (`program-files.engine.test.ts`, `tests/conformance/sim/checklist.test.ts` files-4) are changed
   on this branch (`docs/requests/STDIO-program-files-test.md`).

3. **trap15-tasks-0-59.md task 53, and errata T3.md F4 ("a count that wraps the bounds test
   succeeds, reads nothing and leaves D2").** That holds for `D2 = $FFFFFFFF` only: `ReadFile`
   refuses the count and returns -1, and the run-time compares the -1 with the requested count
   (`_fread` step 3, STDIO-MODEL.md section 4), which matches only for `$FFFFFFFF`. Any other
   count of 2 GB or more (one that wraps the bounds test, e.g. A1 = $2000, D2 = $FFFFF000) sets the
   error flag and gives `D0.W = 2`. Until this work the engine answered every count above
   `INT_MAX` like `$FFFFFFFF`.

4. **The undefined sequences (T3.md "Seen only under Wine", items a51, a52, a53; errata T3.md
   F7).** All three are the run-time's answers, not Wine's (STDIO-MODEL.md R3, R6, R8, R12): a read
   right after a write takes its bytes from the buffer and moves `level` (a51: the read succeeds,
   the flush then writes 5 - 4 = 1 byte); a write right after a read goes into the read buffer and
   is never written (a52); in a53 the read moves `level` so far that the flush has a count of -3,
   which `__write` passes to `WriteFile` as a count above 4 GB, which fails - on Windows as under
   Wine, since the buffer range cannot be valid - so the close fails and leaves the handle open,
   the file keeps its 5 bytes, and task 57 fails. The port now produces all three goldens, and
   their entries are gone from `tests/conformance/sim/known-differences.json`. The steps of
   `docs/porting/windows-confirmation.md` part A for these three programs remain a useful
   confirmation but no longer decide anything.

5. **New facts a document does not state yet**, each measured in the official program
   (STDIO-MODEL.md names the conformance program or probe for each):
   - The run-time has 47 free stream entries (`_streams[50]`, three taken by the standard
     streams). A stream whose close failed, and a stream that a simulator reset forgot (`initSim`
     drops the eight slots without closing them), keeps its entry until the program ends. When no
     entry is free, tasks 51, 52 and 59 fail without opening the file (a task 52 then does not
     create or truncate it). (`a66`; the forgotten stream after Rewind: probe e2.)
   - The error flag (`ERR`) set by a failed flush or read is not cleared by a seek; while it is set
     a read of fewer than 512 bytes from an empty buffer returns nothing and sets the end-of-file
     flag (`D0.W = 1`), and a read of 512 or more still reads the multiples of 512 from the file
     (`a61`, `a67`).
   - A write of more than 512 bytes after a read goes to the file at the end of the block that was
     read ahead, not at the stream's position (R9); a write after a read that emptied the buffer
     writes, at the flush, the bytes at the start of the buffer (R10) (`a62`).
   - The buffer's memory (STDIO-MODEL.md section 7): a new stream gets the freed buffer that was
     allocated first, with its old bytes from the ninth on; a write in the read state that runs
     more than 4 bytes past the end of the buffer damages the heap, and the next open or close of
     a file ends in `ERROR: An exception occurred in routine 'exec_inst'.` (`a68`; probes p10, p12).
     What a read returns of memory the program never wrote (`a51`: `0A 00 00 44`) is residue of the
     original's heap, the same in every run of one program; the port gives zeros
     (docs/differences/SH6.md).
   - At the end of the process the run-time writes the bytes of every stream not closed, also of
     streams a Rewind forgot (probes e1, e2).
   - While a log runs, the execution log and the output log are streams of the same table, so
     the program has one or two entries fewer (`a69`, probe e5).
   - A write past the end of a buffer: what the original does depends on the bytes and on the
     heap's layout (even the program file's name changes it), so the port makes a stated choice
     (STDIO-MODEL.md section 7; docs/differences/SH6.md).

## For other owners

6. **W4** (`app/src/engine/testing.test.ts`, `trap15.test.ts`): two expectations encoded the old
   unbuffered engine (`fileRead` with the program's count instead of the buffer's 512 bytes).
   Filed as `docs/requests/STDIO-engine-tests.md`; applied on this branch at the merge of main (the
   orchestrator assigned the files for it).

7. **SH6** (`app/src/core/sim-host/files/program-files.engine.test.ts`): the write to a read-only
   stream, entry 2, and the header comment of `program-files.ts` ("The engine passes the program's
   file operations to the host unbuffered and in order"), out of date for the same reason as entry
   1. Filed as `docs/requests/STDIO-program-files-test.md`; applied on this branch at the merge of
   main.

8. **T3** (`tests/conformance/sim/`): the entries of a51, a52 and a53 are removed from
   `known-differences.json`; `MISMATCHES.md` is generated again; the programs `trap15-a/a61`-`a68`
   are added with goldens from the official program (`regenerate.mjs --only`); `checklist.test.ts`
   files-4 expects the measured read-only write (entry 2). `doubles.ts` still lists a51-a53 in
   `NOT_MODELLED_BY_DOUBLES`, which stays true for the doubles (the new programs need the real
   parts as well; the doubles mode was not run).
