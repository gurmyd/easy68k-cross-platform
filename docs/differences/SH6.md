# Differences introduced by SH6 (program files, file dialog, printer)

Deliberate differences from the original. DOC1 merges this file into `docs/DIFFERENCES.md`. The
stream model itself (buffered writes and reads, streams a reset forgets, remove refused while a file
is open, bytes written at the process's exit) follows the original; see ARCHITECTURE.md 3.8.4 and the
measurements of docs/porting/errata/T3.md F2.

| Where | Original | Port | Why |
|---|---|---|---|
| Files a program can reach, browser store and opened folder | Any path on the disk | The folders the program has been given (its own folder, the Open Data folder, a task 58 folder) and their sub-folders, four levels deep; files beyond the limits of 3.8.4 are named once in the message area (`Not available to the program: ...`) and cannot be used | A browser has no synchronous file access: the folder is held in memory (docs/porting/errata/SH6.md entries 1, 2) |
| Path a task 58 dialog returns | `C:\...\data.txt` | `/browser/demo/data.txt` in a browser; the real path in the desktop app | 3.8.4; the program uses it as a name, which works |
| Task 58 Open dialog | The program's name (with any folder part) is in the File name field | The dialog starts in the folder of that name and the field shows the file name only (the request carries it since gate I2; the field stays empty until FS1's dialog reads `OpenRequest.initialName`, still not read at gate I2 round 2) | The port's dialog lists one folder at a time (errata Contract C1) |
| Task 58 Save dialog without a name | Starts in the process's current directory | Starts in the folder the last dialog ended in, until FS1's dialog reads `SaveRequest.startDir` (task 58 sends the program's current directory there since gate I2) | Errata Contract C1 |
| Closing the tab while a program has unwritten bytes | Not possible: the bytes are written when the simulator exits | The browser asks "Leave site?"; if the tab closes anyway, the bytes are written or kept in the browser and written at the next start | 3.8.4 |
| Page put into the back-forward cache | - | The pending bytes are written to the file, the files stay open | The page may come back (errata entry 7) |
| File names `NUL`, `CON`, `PRN`, `AUX`, `COM1`... | Windows devices | Ordinary files | No devices in a browser store; T3 is asked to confirm what the original does |
| Printing (task 10) | Each form feed sends a page to the Windows printer at once | Each form feed adds a job to the `Printer Output` dialog, which opens by itself; `Print...` opens the system print dialog. `File > Printer Setup...` opens the same dialog | 1.4 note 2: a page cannot print without the print dialog |
| Printer page | The real printer's page and the Printer Font measured on it | A letter page at 600 dpi, cell from the Printer Font size (3.8.4) | No printer to ask in a browser |
| Printer Font changed in the middle of a page | The next character makes the printer library fail ("Printing in progress"), which the simulator reports as `ERROR: An exception occurred in routine 'exec_inst'.` and switches to trace mode | The open job is ended as it stands and a new one starts | A defect of the original caused by the user's action; recorded so it can be reverted if it must be reproduced |

## The stream's buffer memory (gate I3, stdio work; engine/sim/shim/STDIO-MODEL.md)

Since gate I3 the engine has the file streams of the Borland run-time linked into SIM68K.exe, so
the sequences C leaves undefined - a read right after a write, a write right after a read, without
a seek between them - give the official results (trap15-a `a51`, `a52`, `a53`). What remains
different is memory the program never wrote. A read right after a write takes its bytes from the
stream's 512-byte buffer behind the written ones (in `a51` the 4 bytes after `ABCDE`), and a read
in the read state after a write there can run past the bytes that came from the file. In the
original those bytes are whatever the heap block of the buffer held: zero in a block never used
before (most likely), bytes of an earlier stream's file in a block that an earlier `fclose` freed,
and beyond the 512 bytes the next heap block. The port gives zero for a fresh block, reuses the
block of the stream closed last with its old bytes, and gives zero past the 512 bytes (bytes a
write put there stay with the stream instead of overwriting another block). These rules are
inferred, not measured: the official program could not be run for it during gate I3 (the probe
`p01-garbage.X68` of STDIO-MODEL.md section 9 measures them). The bytes of `a51`'s read are not
part of its golden. A program that seeks between a write and a read, as C requires, never sees
any of this. Two smaller differences: if a stream that has been read in the write state is left
open while a task 58 dialog moves the current folder, the bytes the host writes for it at the end
of the program can be more than the original's flush would write (STDIO-MODEL.md section 10); and
a copy of a read in the write state whose count wrapped the bounds test of task 53 ends in the
`exec_inst` error box without copying anything, where the original copied heap memory until its
access violation.
