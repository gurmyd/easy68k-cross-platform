# Programs to run once on real Windows

`docs/ARCHITECTURE.md` 6.8: some behaviour of EASy68K v5.16.1 can be settled neither from the
source nor under Wine, because it belongs to Windows itself (GDI, the VCL's key handling) or because
the question was never measured. These programs answer such questions on real Windows. Each writes
its findings to `result.bin` in its folder (with `../sim/dumplib.X68`), so the answer is a file that
can be committed next to the program as `<program>.windows.result.bin` with the Windows version and
display settings in the commit message. Owner: work package T3.

Running the official binaries on the development PC needs the owner's permission (decision O-2).

| Program               | Question                                                                                                                                                                            | Interactive             | Under Wine (oracle image, 2026-11-21)                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `stdio-buffer.X68`    | When does written data become visible to a second stream (the C library's buffer size), does a large write bypass the buffer, does a reading stream keep stale bytes (3.8.4, O-15)? | no                      | `stdio-buffer.wine.result.bin`: 512-byte blocks, large writes whole, reads buffered (`docs/porting/errata/T3.md` F2) |
| `gdi-text.X68`        | Pen position after task 95 for several texts, including bytes 1-31 (trap15-b V2, V13); the pixels of a printed "A" on a red fill colour (V1, the cell box)                          | no                      | not meaningful (Wine has no Fixedsys)                                                                                |
| `keys-tab-f-keys.X68` | Does Tab ever reach task 19 / task 5; are F6 and F9 swallowed while key commands are on, and delivered after task 24 (trap15-a §12 item 13, trap15-b V10)?                          | yes: follow the prompts | not run (needs a keyboard)                                                                                           |

## How

1. Assemble the program with the official `EDIT68K.exe` (copy `../sim/dumplib.X68` into a folder
   `sim` beside the folder of the program, or change the INCLUDE line), or with the port.
2. Run `SIM68K.exe <program>.S68 /r` from a folder you can write to; for the interactive program,
   click into the Output window and follow the prompts it prints.
3. Copy `result.bin` next to the program as `<program>.windows.result.bin`.

Under Wine (how `stdio-buffer.wine.result.bin` was made): `run-report.sh` mounts only the folder of
the program, so copy the program and `../sim/dumplib.X68` into a scratch folder below `build/`,
change the INCLUDE line to `INCLUDE 'dumplib.X68'`, and run
`bash tests/oracle/wine/sim/run-report.sh build/<folder>/<program>.X68`.

Programs of the conformance suite that also need Windows, because the port differs from the
official program under Wine and the difference is marked `unconfirmed` in
`../sim/known-differences.json`. Compare each Windows `result.bin` with the golden in
`../sim/golden/<suite>/`:

- `../sim/trap15-b/b06-modes-above-15.X68` (drawing modes 18-23, trap15-b V8). Under Wine it draws
  the copy mode for all of them (`docs/porting/errata/T3.md` F6).
- `../sim/trap15-a/a51-files-read-after-write.X68`, `a52-files-write-after-read.X68`,
  `a53-files-past-end-then-read.X68` (reads and writes on one stream without a seek between them,
  F7).
- `../sim/trap15-a/a58-files-devices.X68` (the device name `NUL`, F8).

If the Windows result equals the golden, the owner named in `known-differences.json` repairs the
port; if not, the golden is replaced by the Windows result.
