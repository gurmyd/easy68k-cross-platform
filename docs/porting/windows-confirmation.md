# One session on real Windows: what to run, what to send back

Some answers can come only from the official EASy68K v5.16.1 on real Windows. The Wine oracle
(`tests/oracle/wine`) runs the official programs under Wine 8.0, and in a few places Wine is not
Windows. This page lists everything that waits for such a run, in the order to do it, so that **one
session of about twenty minutes** settles all of it. Owner of the page: T3. Decision O-2 (the
owner runs the official binaries on real Windows, in Windows Sandbox or a throw-away virtual
machine) covers every part.

| Part | What it settles | Who acts on the answer | Time |
| ---- | --------------- | ---------------------- | ---- |
| [A](#a-two-conformance-programs-and-one-key) | two conformance programs whose official result was seen only under Wine (`unconfirmed` in `tests/conformance/sim/known-differences.json`), and one key (Ctrl+Shift+2) | T3 (golden or entry), then SH6, W1 or SH4 | 7 min |
| [B](#b-the-speed-of-the-original) | the original's instructions per second (decision O-1) | SH8, W1, DOC1 | 5 min |
| [C](#c-the-other-windows-only-questions) | the three programs of `tests/conformance/windows-confirm` (6.8) | T3 | 5 min, optional |

Every item that is not yet confirmed against the original is listed, each with what the port does
and how it could be confirmed, in [`docs/DIFFERENCES.md`](../DIFFERENCES.md) part 4 ("Not yet
confirmed against the original"); the entries there that this session settles name its part.

## What to copy to the Windows PC

1. The official EASy68K v5.16.1 folder (the one the repository's `reference/official-extracted`
   holds: `EDIT68K.exe`, `SIM68K.exe` and their files).
2. A folder `C:\confirm` with this layout (each program in a folder of its own, because the
   programs create files in their current folder and must not see each other's files; the
   programs include `..\dumplib.X68`, so `dumplib.X68` sits one level up):

   ```
   C:\confirm\dumplib.X68                                 <- tests\conformance\sim\dumplib.X68
   C:\confirm\a53\a53-files-past-end-then-read.X68        <- tests\conformance\sim\trap15-a\
   C:\confirm\b19\b19-net-send-uninitialised.X68          <- tests\conformance\sim\trap15-b\
   C:\confirm\speed\calibrate.X68                         <- tests\perf\calibrate.X68
   C:\confirm\wc\...                                      <- tests\conformance\windows-confirm\* (part C)
   ```

   Copy the `.X68` files as they are (they have CR LF line ends; do not let an editor change them).

## A. Two conformance programs and one key

Four programs that were in this part have left it: `a58` (the device `NUL`) was the port's
difference and is repaired; `b06` (drawing modes 18-23) was settled by measuring the GDI calls on
Windows 11; and `a51` and `a52` (a read right after a write, a write right after a read, without a
seek) need no Windows run, because the C run-time that decides them is inside `SIM68K.exe` and
behaves the same under Wine; the port follows that run-time since gate I3 and produces their
goldens (`docs/differences/T3.md`, "Seen only under Wine"). If you run `a51` or `a52` anyway, in the
same way as below, nothing is lost: send their folders with the others.

`a53` stays for one point only. The port produces its golden too, and every step of it is the
run-time's except one system call: the run-time asks `WriteFile` to write a count above 4 GB (its
flush count of -3). Under Wine that call fails without writing (measured), which is why the close
fails and the file keeps 5 bytes. The Windows run confirms that Windows refuses it the same way.

For each of the two folders, in either order:

1. Start `EDIT68K.exe`, File > Open, choose the program (for example
   `C:\confirm\a53\a53-files-past-end-then-read.X68`).
2. Project > Assemble Source (F9). The assembler reports no errors; close its window with
   **Execute**: `SIM68K.exe` starts with the program loaded and `C:\confirm\a53` as its current
   folder.
3. In `SIM68K.exe` check that Options > Enable Exceptions is **off** (neither program uses
   exceptions), then press Run (F9). The program runs for a few seconds and stops at its
   `SIMHALT`. The official program shows no box and adds **no line** to the message area when a
   program halts (`docs/porting/sim-ui.md` 9.12), and its status bar stays empty (7.3). You can tell
   that it has ended because Run, Step Over and Trace Into are greyed out (only Pause, Rewind
   Program, Reload and Close stay available; 3.6) and the PC field shows the address after the
   `SIMHALT`. Close `SIM68K.exe`.
4. The folder now holds `result.bin` (and the files the program made). Nothing else is needed.

Then zip `C:\confirm\a53` and `b19` (the whole folders) and send the zip back. T3 compares each
`result.bin` with the golden `tests/conformance/sim/golden/<suite>/<name>.result.bin` (the official
result under Wine) and with the port's result:

- **Windows result = golden**: Wine is not the cause. For a53 nothing more is to be done (the port
  already gives the golden); for b19 the difference is the port's: W1 repairs it, T3 removes the
  `unconfirmed` mark now and the entry when the repair lands.
- **Windows result = the port's** (b19): the golden was Wine's. T3 replaces the golden with the Windows
  result (committed as the golden, the Windows version in the commit message) and removes the
  entry; the port needs nothing.
- **a53 differs from the golden on Windows**: Windows wrote the count above 4 GB (or part of it); T3
  replaces the golden and the engine's `osWrite` (`engine/sim/shim/hostfile.cpp`) follows Windows.
- **Anything else**: a third answer; T3 records it and the owner of the spec decides.

If you want to read the answer on the spot instead (open `result.bin` in Notepad; each line is the
registers after one step, `D0=... D1=...`), these are the lines that decide. "Wine" is what the
golden holds, "port" what the port writes today.

| Program | Line of `result.bin` | Wine (golden) | Port | What the line is |
| ------- | -------------------- | ------------- | ---- | ---------------- |
| a53 | 3 | `D0=00000002` | `D0=00000002` | task 56 (close) of that stream: fails if `WriteFile` refused the count above 4 GB; `D0=00000000` on Windows would mean it wrote |
| a53 | 5 | `D2=00000005` | `D2=00000005` | bytes a new stream reads: 5 (`ABCDE`) as under Wine, or more if Windows wrote |
| b19 | 1, 2 | `D0=27360001` | `D0=276D0001` | task 102 and task 106 before any network task: "not a socket" (Wine) or "Winsock not initialised" (the Winsock documentation) |

What each difference is, and why Wine is or is not the suspect: `docs/differences/T3.md`
("Seen only under Wine").

**The key Ctrl+Shift+2 (one minute).** On a US keyboard Windows makes the character `$00` of
Ctrl+Shift+2; whether the original's framework hands that character to a program is not confirmed
(`docs/porting/errata/SH4.md` entry 10; `docs/DIFFERENCES.md` part 4). The port delivers it like any
character. In `EDIT68K.exe`, File > New, type this program (the spaces before the words matter),
save it as `C:\confirm\key\key.X68`, assemble it and Execute it, press Run (F9), click into the
Output window and press **Ctrl+Shift+2** once:

```
        ORG     $1000
START   CLR.L   D1
        MOVE.B  #5,D0       read one character into D1
        TRAP    #15
        MOVE.B  #3,D0       show D1 as a number
        TRAP    #15
        SIMHALT
        END     START
```

Write down what the Output window shows: `0` (the character reached the program, as in the port)
or nothing (then press `A`: the window shows `65`, and the character `$00` never arrived). Send the
answer with the zip. If it was nothing, SH4 stops delivering `$00` for Ctrl+Shift+2.

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
