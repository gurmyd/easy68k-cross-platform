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
| `NUL` behind a folder or a drive that does not exist (`nofolder\NUL`, `Q:NUL`) | The open fails (`D0.W = 2`), measured on Windows 11 and under Wine (errata SH6.md entry 17) | The null device: the open succeeds, a read is at end of file | The port's file views cannot say whether a folder exists without a file in it (`SyncFiles` has no such question); every other way of naming `NUL` behaves as on Windows (errata SH6.md entry 14) |
| `CON`, `PRN`, `AUX`, `COM1`-`COM9`, `LPT1`-`LPT9`, `CONIN$`, `CONOUT$` as the whole name | Windows devices: on a PC that has such a port the program opens it (`AUX` and `COMn` reach a serial port, `PRN` and `LPTn` a parallel port); without one, and for `CON` in the simulator (it has no console), the open fails | The open always fails (`D0.W = 2`, task 59 gives 2, task 57 fails), and no file of that name is created or removed | No ports to reach through a file name; what a student sees is what a PC without the port shows (the official program under Wine fails the same way; a70 leaves these names out, because a PC with the port answers otherwise). With a folder or an extension (`sub\COM1`, `COM1.txt`) these are ordinary files, as on Windows 11 |
| `NUL.txt`, `CON.txt` (a device name with an extension) | Microsoft's naming documentation says these are the device, and older Windows treat them so; Windows 11 10.0.26300 opens an ordinary file (measured); the official program under Wine opens the device, so it differs from Windows 11 here and a70 leaves these names out (errata SH6.md entry 17) | An ordinary file | The port follows Windows 11, the reference machine (errata SH6.md entry 14) |
| Printing (task 10) | Each form feed sends a page to the Windows printer at once | Each form feed adds a job to the `Printer Output` dialog, which opens by itself; `Print...` opens the system print dialog. `File > Printer Setup...` opens the same dialog | 1.4 note 2: a page cannot print without the print dialog |
| Printer page | The real printer's page and the Printer Font measured on it | A letter page at 600 dpi, cell from the Printer Font size (3.8.4) | No printer to ask in a browser |
| Printer Font changed in the middle of a page | The next character makes the printer library fail ("Printing in progress"), which the simulator reports as `ERROR: An exception occurred in routine 'exec_inst'.` and switches to trace mode | The open job is ended as it stands and a new one starts | A defect of the original caused by the user's action; recorded so it can be reverted if it must be reproduced |

## The stream's buffer memory (gate I3, stdio work; engine/sim/shim/STDIO-MODEL.md)

Since gate I3 the engine has the file streams of the Borland run-time linked into SIM68K.exe, so
the sequences C leaves undefined - a read right after a write, a write right after a read, without
a seek between them - give the official results (trap15-a `a51`, `a52`, `a53`, and `a61`-`a69`).
Two things remain different, both reached only through those undefined sequences. All of it was
measured in the official program under Wine (STDIO-MODEL.md sections 7 and 9).

**Heap residue.** A stream's 512-byte buffer comes from the original's heap. A read right after a
write takes its bytes from the buffer behind the written ones (in `a51` the 4 bytes after
`ABCDE`), a read in the read state after a write there can run past the bytes that came from the
file, and a flush after a read in the write state writes such bytes into the file. Those bytes are
whatever the heap held: remains of what the simulator loaded before (text of the listing such as
`00001000 Starting Address`, Windows help strings such as `Primary screen = 1`), the heap's own
bookkeeping (pointers and sizes in bytes 0-7 of a buffer that an earlier stream freed, e.g. `3A 02`
in bytes 2-3, a small number in byte 5), and heap pointers past the end of the buffer. They are the
same in every run of one program but differ between programs, and depend on more than the program
did. In `a51` they are `0A 00 00 44`. The port does what is measured about which block a stream gets
(the lowest freed one, with its old bytes from the ninth on) and gives zeros for everything that
depends on the heap's history: `00 00 00 00` in `a51`. What a student sees: in the original, a few
bytes the program never wrote - in its memory after such a read, and in the file after such a flush
(a file that ends in, say, `27 00` after a program wrote `ABCDE`, read 2 and wrote 4 without a
seek); in the port, zero bytes in the same places, the file of the same length.

**A write past the end of the buffer.** A write right after a read that had left the buffer nearly
empty (fewer free bytes than the write's length) is copied past the end of the buffer over the
next heap block. In the original, 1 to 3 bytes past the end were harmless in every run; 4 bytes
were harmless in most layouts, but in the reviewer's program q02 under the file name
`q02-end-of-buffer.X68` the simulator process ended at once (the same program under another name
completed); 5 or more bytes made the next open, close or task 59 end in the box `ERROR: An exception
occurred in routine 'exec_inst'.` in most layouts, but 8 zero bytes in one layout were harmless.
So the outcome depends on the bytes and on the heap's layout, which even the program file's name
changes. The port's choice: up to 4 bytes are harmless; from 5 bytes on the next and every later
open or close of a file (and task 59) shows that box, which is what the original did after the
first box in every probe (e4: OK and Run, then each later open showed the box again, D0.W = 2,
D1 = -1). A student who writes past a stream's buffer therefore sees the box in the port where
the original showed it in most measured cases, sees nothing where the original ended (q02's 4
bytes), and sees the box where the original's heap happened to accept the bytes (x3's zeros).

**A log started with a nearly full stream table.** While a log runs, its files are streams of the
same table as the program's files (STDIO-MODEL.md section 8; this the port reproduces). When a log
starts and the table has no free entry for one of its files, the original does not open that file:
measured (probe e6: 46 streams whose close failed, then Log Start with both logs selected), the
execution log was created, the box `Error` / `Can't open log file, error 0` appeared, the output
log was not written, and the log stayed marked as running. In the port the log service opens and
writes both logs; no box appears. A student meets this only after more than 44 opened files whose
close failed in one session. Read in the code, not measured: the original's Log Stop closes the
execution log's file pointer even when only an output log was started, so a pointer left from an
earlier execution log could close a program's stream that has since taken its entry; the port
has no such pointer.

Two smaller differences: if a stream that has been read in the write state is left open while a
task 58 dialog moves the current folder, the bytes the host writes for it at the end of the program
can be more than the original's flush would write (STDIO-MODEL.md section 10); and a copy of a read
in the write state whose count wrapped the bounds test of task 53 ends in the `exec_inst` error box
in both (probe p13), but the port copies nothing first, while the original copies heap memory into
the 68000 memory until its access violation (how far is not measured).
