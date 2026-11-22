Status: open (filed by SH6 at gate I2 round 2, for T3, the owner of `tests/conformance/sim`).

# SH6: remove a59 from `tests/conformance/sim/known-differences.json`

T3's measurement F8 (`trap15-a/a59-files-buffer-edges`) is repaired in `ProgramFiles.fileWrite`
(`app/src/core/sim-host/files/program-files.ts`): a write that fits into what is left of the
512-byte buffer is copied into it even when it fills it exactly, so one write of exactly 512 bytes
on a fresh stream leaves nothing visible to a second stream, as in the official program. A write
that does not fit commits the buffer first and goes out whole when it is 512 bytes or more
(docs/porting/errata/SH6.md entry 12).

With the repair, `EASY68K_REQUIRE_ENGINES=1 npx vitest run --config tests/vitest.workspace.ts`
reports exactly one failure, and only this message:

```
trap15-a/a59-files-buffer-edges|report|result: listed in known-differences.json but now equal; remove the entry
```

## What is asked

Remove the entry `trap15-a/a59-files-buffer-edges|report|result` from `known-differences.json`
(and from MISMATCHES.md if it lists it), and mark item 1 of F8 in `docs/porting/errata/T3.md` as
repaired by SH6. The suite is then green again; until then it is red on this one entry, on every
system.

The entries for a51, a52, a53 and a58 stay: SH6 repairs them once they are confirmed on Windows,
as their `unconfirmed` texts say. One more probe would settle the last unmeasured buffering case,
a read of 512 bytes or more (docs/porting/errata/SH6.md, "What T3 is asked to confirm", item 1).
