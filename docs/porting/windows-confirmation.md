# One session on real Windows: what to run, what to send back

Some answers can come only from the official EASy68K v5.16.1 on real Windows. The Wine oracle
(`tests/oracle/wine`) runs the official programs under Wine 8.0, and in a few places Wine is not
Windows. This page lists everything that waits for such a run, in the order to do it, so that **one
session of about twenty minutes** settles all of it. Owner of the page: T3. Decision O-2 (the
owner runs the official binaries on real Windows, in Windows Sandbox or a throw-away virtual
machine) covers every part.

| Part | What it settles | Who acts on the answer | Time |
| ---- | --------------- | ---------------------- | ---- |
| [A](#a-six-conformance-programs) | six conformance programs whose official result was seen only under Wine (`unconfirmed` in `tests/conformance/sim/known-differences.json`) | T3 (golden or entry), then SH6, SH1 or W1 | 10 min |
| [B](#b-the-speed-of-the-original) | the original's instructions per second (decision O-1) | SH8, W1, DOC1 | 5 min |
| [C](#c-the-other-windows-only-questions) | the three programs of `tests/conformance/windows-confirm` (6.8) | T3 | 5 min, optional |

## What to copy to the Windows PC

1. The official EASy68K v5.16.1 folder (the one the repository's `reference/official-extracted`
   holds: `EDIT68K.exe`, `SIM68K.exe` and their files).
2. A folder `C:\confirm` with this layout (each program in a folder of its own, because the
   programs create files in their current folder and must not see each other's files; the
   programs include `..\dumplib.X68`, so `dumplib.X68` sits one level up):

   ```
   C:\confirm\dumplib.X68                                 <- tests\conformance\sim\dumplib.X68
   C:\confirm\a51\a51-files-read-after-write.X68          <- tests\conformance\sim\trap15-a\
   C:\confirm\a52\a52-files-write-after-read.X68          <- tests\conformance\sim\trap15-a\
   C:\confirm\a53\a53-files-past-end-then-read.X68        <- tests\conformance\sim\trap15-a\
   C:\confirm\a58\a58-files-devices.X68                   <- tests\conformance\sim\trap15-a\
   C:\confirm\b06\b06-modes-above-15.X68                  <- tests\conformance\sim\trap15-b\
   C:\confirm\b19\b19-net-send-uninitialised.X68          <- tests\conformance\sim\trap15-b\
   C:\confirm\speed\calibrate.X68                         <- tests\perf\calibrate.X68
   C:\confirm\wc\...                                      <- tests\conformance\windows-confirm\* (part C)
   ```

   Copy the `.X68` files as they are (they have CR LF line ends; do not let an editor change them).

## A. Six conformance programs

For each of the six folders, in any order:

1. Start `EDIT68K.exe`, File > Open, choose the program (for example
   `C:\confirm\a51\a51-files-read-after-write.X68`).
2. Project > Assemble Source (F9). The assembler reports no errors; close its window with
   **Execute**: `SIM68K.exe` starts with the program loaded and `C:\confirm\a51` as its current
   folder.
3. In `SIM68K.exe` check that Options > Enable Exceptions is **off** (none of the six uses
   exceptions), then press Run (F9). The program runs for a few seconds and ends with
   `Execution halted` in the message area. Close `SIM68K.exe`.
4. The folder now holds `result.bin` (and the files the program made). Nothing else is needed.

Then zip `C:\confirm\a51`, `a52`, `a53`, `a58`, `b06` and `b19` (the whole folders) and send the zip
back. T3 compares each `result.bin` with the golden `tests/conformance/sim/golden/<suite>/<name>.result.bin`
(the official result under Wine) and with the port's result:

- **Windows result = golden**: Wine is not the cause; the difference is the port's. The owner in
  `known-differences.json` (SH6 for a51-a58, SH1 for b06, W1 for b19) repairs the port, T3 removes the
  `unconfirmed` mark now and the entry when the repair lands.
- **Windows result = the port's**: the golden was Wine's. T3 replaces the golden with the Windows
  result (committed as the golden, the Windows version in the commit message) and removes the
  entry; the port needs nothing.
- **Anything else**: a third answer; T3 records it and the owner of the spec decides.

If you want to read the answer on the spot instead (open `result.bin` in Notepad; each line is the
registers after one step, `D0=... D1=...`), these are the lines that decide. "Wine" is what the
golden holds, "port" what the port writes today.

| Program | Line of `result.bin` | Wine (golden) | Port | What the line is |
| ------- | -------------------- | ------------- | ---- | ---------------- |
| a51 | 2 | `D0=00000000` | `D0=00000001` | task 53 (read 4 bytes) right after writing `ABCDE`, no seek: success or end of file |
| a51 | 5 | `000010A0: 41 EE EE ...` | `000010A0: 41 42 43 44 45 EE ...` | what a new stream reads from the file after the close: 1 byte or all 5 |
| a52 | 7 | `000010CC: 41 42 43 44 45 ...` | `000010CC: 41 42 43 58 45 ...` | the file after write `ABCDE`, seek 1, read 2, write `X`, close: unchanged or `ABCXE` |
| a53 | 2 | `D0=00000000` | `D0=00000001` | task 53 right after a write 20 bytes past the end |
| a53 | 3 | `D0=00000002` | `D0=00000000` | task 56 (close) of that stream: fails or succeeds |
| a53 | 5 | `D2=00000005` | `D2=0000001A` | bytes a new stream reads: 5 (`ABCDE`) or 26 (`ABCDE`, 20 zeros, `X`) |
| a58 | 6 | `D0=00000001` | `D0=00000000` | task 53 on `NUL` after writing 3 bytes to it: end of file or the 3 bytes back |
| b06 | 1-6 | `D0=000000FF` on every line | `D0=00FFFFFF` (lines 1, 3, 4, 5, 6), `D0=00FFFF00` (line 2) | the pixel a red pen draws on black in mode 20, 22, 18, 19, 21, 23: red (the copy mode kept) or white / the inverse |
| b19 | 1, 2 | `D0=27360001` | `D0=276D0001` | task 102 and task 106 before any network task: "not a socket" (Wine) or "Winsock not initialised" (the Winsock documentation) |

What each difference is, and why Wine is or is not the suspect: `docs/differences/T3.md`
("Seen only under Wine").

## B. The speed of the original

The steps are those of `docs/porting/speed.md` section 5 (decision O-1), with the program in
`C:\confirm\speed`:

1. Open `C:\confirm\speed\calibrate.X68` in `EDIT68K.exe`, Project > Assemble Source (F9), then
   Execute.
2. In `SIM68K.exe` press Run (F9) and leave the windows alone for about 15 seconds.
3. Read the three lines in the output window (or `result.bin` in `C:\confirm\speed`). Repeat twice;
   the highest `instructions per second` is the figure. Note the PC (processor, Windows version)
   and whether it was a sandbox or a VM, and try once more while moving the mouse over the window.

Send the figures with the zip. What is done with them is in `speed.md` section 5, step 5.

## C. The other Windows-only questions

Optional in the same session: the three programs of `tests/conformance/windows-confirm`
(the stream buffer, GDI text and the pen position, Tab and the F-keys). Their README says how to
run them and what to send back; `keys-tab-f-keys.X68` needs the keyboard and prints its prompts.

## After the session

T3 commits the Windows results (part A: goldens or removed entries; part C:
`<program>.windows.result.bin` beside each program), updates `known-differences.json`,
`docs/differences/T3.md` and this page, and `npm run test:conformance` shows the outcome.
