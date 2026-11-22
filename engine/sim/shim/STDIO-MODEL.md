# The file streams of SIM68K.exe: a model of its C run-time

TRAP #15 tasks 50 to 59 (`SIMOPS2.CPP` lines 30-190 of the original) use `fopen`, `fread`,
`fwrite`, `fseek`, `fclose`, `feof` and `remove` of the C run-time library. The official
`SIM68K.exe` v5.16.1 links the run-time of Borland C++ Builder 6 statically (the distribution ships
no run-time DLL), so what these functions do is part of the program, the same under Wine as on
Windows; only the operating-system calls below them (`ReadFile`, `WriteFile`, `SetFilePointer`,
`CloseHandle`, `DeleteFile`) belong to the system. Where C leaves a sequence undefined - a read
right after a write without a seek, a write right after a read - the run-time's state machine
decides what a 68000 program sees. This document states that state machine precisely enough to
implement it; `shim/hostfile.cpp` is the implementation.

**Sources.** Every rule was read in the machine code of the official `SIM68K.exe` (SHA-256 of
`docs/porting/ground-truth.md` section 2; disassembled with `llvm-objdump` of the pinned Emscripten
SDK; addresses below) and then measured in the official program under Wine with the probe
programs of section 9. Each rule names the programs that show it: the conformance programs of
`tests/conformance/sim/trap15-a` (`aNN`, with goldens from the official program, which the port
reproduces) and the probes kept outside the repository (`pNN`, `xN`, `eN`, and the reviewer's
`qNN`; section 9). Every rule of sections 1-6 and 8 is measured. Section 7 (the heap behind the
buffer) is measured as far as it goes and says where the original's answer depends on more than the
68000 program did; there the port makes a stated choice, recorded as a difference.

| Function | Address in SIM68K.exe | Called from |
|---|---|---|
| `fopen` | `4de980` (`__openfp` `4de8a8`, mode parser `4de7cc`, free stream `4de954`) | `fileOp`, `openFile`, `newFile` (`41a24c`, `41a298`, `41a388`) |
| `fclose` | `4de4b8` | `closeFile` `41a538`, `fileOp`, `closeFiles` |
| `fflush` | `4de558` | `fclose`, `fseek`, `_fwrite` |
| `fread` / `_fread` | `4debf8` / `4deac8` | `readFile` `41a41c` |
| `_fgetc` / `_ffill` | `4df6e0` / `4df65c` | `_fread` |
| `fwrite` / `_fwrite` | `4def4c` / `4de9ec` | `writeFile` `41a498` |
| `fseek` | `4dec98` | `positionFile` `41a4ec` |
| `feof` | inline in `readFile`: `testb $0x20, 0x12(fp)` | `readFile` |
| `setvbuf` (inner) | `4de2bc` | `fopen` |
| `__read` / `__write` / `lseek` / `close` | `4ddef8` / `4de040` / `4ddc04` / `4ddaac` | the stream functions |
| `remove` | `4df974` | `deleteFile` |

## 1. The stream

A stream (`FILE`, 24 bytes) has these fields; the offsets are those of the machine code:

| Field | Offset | Meaning |
|---|---|---|
| `curp` | 0 | pointer into the buffer: the next byte to read or the next place to write |
| `buffer` | 4 | the buffer, 512 bytes from the heap |
| `level` | 8 | **one** signed counter for both directions: `> 0` bytes left to read at `curp`; `< 0` while writing, `-(free bytes + 1)`; `0` nothing buffered |
| `bsize` | 12 | 512 (0 once closed) |
| `flags` | 18 | see below |
| `fd` | 22 | the file handle (`-1`: the stream is free) |

Flags (`_F_...`): `READ` 0x0001, `WRIT` 0x0002, `BUF` 0x0004 (the run-time allocated the buffer),
`LBUF` 0x0008 (line buffered), `ERR` 0x0010, `EOF` 0x0020, `BIN` 0x0040, `IN` 0x0080, `OUT` 0x0100,
`TERM` 0x0200 (the handle is a terminal). A disk file never has `LBUF` or `TERM`; nothing in the
stream functions sets `OUT`.

There is **no** flag for "the last operation was a read / a write". `fread` and `fwrite` look at
`level` only, and they compare it in ways that make the undefined sequences do something definite
(sections 4 and 5).

## 2. Opening (`fopen`)

1. The run-time takes the first free entry of its stream table (`_streams[50]`, three taken by
   stdin, stdout, stderr). If there is none, `fopen` returns `NULL` **without** opening the file
   (a `w+b` does not create or truncate it). Measured: `a66` (section 8).
2. The mode sets the flags: `"r+b"` and `"w+b"` give `READ|WRIT|BIN`, `"rb"` gives `READ|BIN`.
3. The file is opened (`w+b` creates or truncates it). If that fails, the entry stays free and
   `fopen` returns `NULL`.
4. `setvbuf(fp, NULL, _IOFBF, 512)`: a 512-byte buffer is taken from the heap, `flags |= BUF`,
   `bsize = 512`, `curp = buffer`. `level` is 0 (every free entry has 0).

The tasks: 51 tries `"r+b"`, then `"rb"` (result 3); 52 `"w+b"`; 59 `"r+b"`, then `"rb"`, and closes
again at once. The 68000 program has 8 slots of its own (`files[]`, `MAXFILES`); a slot is free
again after task 56 whatever `fclose` returned.

## 3. The operating system below the run-time

| Call | Rule |
|---|---|
| `__read(fd, buf, n)` | `n == 0` or `n == 0xFFFFFFFF`: returns 0 without a system call. Otherwise `ReadFile(n)`: the count read (0 at the end of the file), or -1. A count of 2 GB or more fails (-1): the buffer range is invalid (measured under Wine: `a32`, `a67`; on Windows `ReadFile` refuses such a range before it reads). |
| `__write(fd, buf, n)` | `n == 0` or `n == 0xFFFFFFFF` (-1): returns 0 without a system call. Otherwise `WriteFile(n)`: the count written, or -1. A count of 2 GB or more fails (-1) and writes nothing (measured under Wine: `a53`, whose flush is `__write(-3)`, and `a67`). Writing to a handle opened `"rb"` fails (measured: probe `e3`, a file on a read-only mount, which the oracle's recipes cannot set up). |
| `lseek(fd, off, SEEK_SET)` | `SetFilePointer`: the new position, or -1 for a negative one (trap15-a `a34`). A position past the end is allowed; a later write there fills the gap with zero bytes. |
| `close(fd)` | `CloseHandle`: 0 or -1. |

All bytes reach the file at once: what one handle wrote, every other handle reads. A file that is
open cannot be deleted (`remove` fails, task 57 gives 2); it can be opened again (trap15-a `a56`,
`a53`).

## 4. Reading: `fread(buf, 1, n, fp)` (task 53)

`fread` returns `(n - left) / 1`, where `left` is the result of `_fread(buf, n, fp)`, the number of
bytes **not** read. `readFile` then gives `D0.W = 0` and `D2.L = count` if the count is at least 1;
else `D0.W = 1` if `EOF` is set, 2 if not (D2 unchanged). `n == 0`: `fread` returns 0 at once.

`_fread(ptr, n, fp)`, repeated until it returns:

1. `n == 0`: return 0.
2. If `level != 0`: `k = min(level, n)` where the comparison is **unsigned** (`level < 0` counts as
   a number above 4,000,000,000, so `k = n`). Copy `k` bytes from `curp` to `ptr`; `curp += k`;
   `level -= k`. If `k == n` return 0. Else `ptr += k`, `n -= k`.
3. If `n >= 512`: `m = n - n % 512`; `r = __read(fd, ptr, m)` straight into the program's memory.
   If `r == n` (compared as 32-bit numbers: `r = -1` equals `n = 0xFFFFFFFF`) return 0. If `r == -1`:
   `flags |= ERR`, return `n`. Else `ptr += r`, `n -= r`; if `r != m`: `flags |= EOF`, return `n`.
4. `c = _fgetc(fp)`. If `c == EOF`: `flags |= EOF`, return `n`. Else `*ptr++ = c`, `n -= 1`; if
   `n == 0` return 0; go to 2.

`_fgetc(fp)`:

1. `level > 0`: `level -= 1`, return the byte at `curp++`.
2. If `level < 0`, or `flags` has `OUT` or `ERR`, or lacks `READ`: `flags |= ERR`, return `EOF`.
3. `flags |= IN`; `_ffill(fp)`; if that failed return `EOF`; else `level -= 1`, return the byte at
   `curp++`.

`_ffill(fp)`: `curp = buffer`; `level = __read(fd, buffer, 512)`. `level > 0`: clear `EOF`, success.
`level == 0`: `flags = (flags & ~(IN|OUT)) | EOF`, failure. `level == -1`: `level = 0`,
`flags |= ERR`, failure.

Consequences a program sees:

- **R1** (measured: a30, a59, a60, a63, a65) Reads of a file go through the buffer: a read of fewer than
  512 bytes fills the buffer with up to 512 bytes from the handle's position and hands out from it;
  512 or more go straight to the program's memory in multiples of 512, the rest through the buffer.
- **R2** (measured: a30, a63, a64) A read that runs into the end of the file returns what there was
  (`D0 = 0`, `D2` = count) and sets `EOF`; the next read gives `D0 = 1`. `EOF` does not stop a read:
  a later read asks the handle again (and gets bytes another stream has written since, p05 A).
- **R3** (measured: a51, a53, a61; the bytes: section 7) **A read in the write state** (`level < 0`, after a task 54 with
  no seek since) takes `n` bytes from the buffer at `curp`, whatever is there - nothing comes from
  the file - and makes `level` more negative by `n`. The read succeeds with `D2 = n` (for any `n`
  below 4 GB minus 512). The bytes are those of the buffer after the written ones: what the buffer
  held before (section 7). Because `level` moved, the next flush writes `n` bytes fewer than were
  written (R6).
- **R4** (measured: a68 "R4") A read of 512 bytes or more in the read state with data in the
  buffer takes the buffer's bytes first, then reads multiples of 512 straight from the handle's
  position, which is the end of what the buffer was filled with. After a write in the read state
  (R8) the buffer's part runs past the 512 bytes (`level` grew by the written count), so that case
  returns bytes of section 7 and has no conformance program of its own; the handle's position is
  the same rule as R9 (`a62` B).
- **R5** (measured: a61 G, a67 A) Once `ERR` is set, a read of fewer than 512 bytes from an
  empty buffer gets nothing even after a seek (`fseek` does not clear `ERR`): `_fgetc` refuses,
  and `_fread` then sets `EOF`, so the task gives `D0 = 1` (end of file), not 2. A read of 512 or
  more still reads the multiples of 512 straight from the handle. `ERR` is set by a flush that
  failed (R6) and by a `ReadFile` that failed (a count that wrapped the bounds test of task 53,
  other than `$FFFFFFFF`, which gives `D0 = 2`).

## 5. Writing: `fwrite(buf, n, 1, fp)` (task 54)

`fwrite` with `n == 0` returns 1 (task 54 with `D2 = 0` succeeds, trap15-a `a31`). Otherwise it
returns `_fwrite(buf, n, fp) / n` and `writeFile` gives `D0.W = 0` for 1, 2 for 0.

`_fwrite(ptr, n, fp)`:

1. If `n <= bsize` (512): if `level + n >= 0` (signed): if `level == 0`, `level = -513`; else if
   `fflush(fp)` fails return 0. Then copy `n` bytes from `ptr` to `curp`; `level += n`;
   `curp += n`; return `n`.
2. Else (more than 512): if `level != 0` and `fflush(fp)` fails return 0. `r = __write(fd, ptr, n)`;
   return `n` if `r != -1` and `r >= n`, else 0.

`fflush(fp)`:

1. `level >= 0`: return 0 **and change nothing** (a read buffer is not discarded).
2. Else `count = bsize + level + 1`; `level = -513`; `curp = buffer`;
   `r = __write(fd, buffer, count)`; if `r != count`: `flags |= ERR`, return -1. Return 0.

Consequences:

- **R6** (measured: a51, a53, a61) A flush writes `bsize + level + 1` bytes from the **start** of
  the buffer, at the handle's position. After writes only that is what was written. After a read in
  the write state (R3) it is fewer: write 10 and read 3 leave 7 to write; write 5 and read 5 leave
  0 (the flush writes nothing and succeeds); write 5 and read 6 or more leave a negative count,
  whose `__write` fails (-1 is answered with 0 without a system call; -2 and below go to
  `WriteFile` with a count above 4 GB and fail): the flush fails and sets `ERR`.
- **R7** (measured: a59, a65 B; a read-only stream, probe e3: the write gives 0, the close 2) The write buffer holds up to 512 bytes: a write that fits (also one
  that fills it exactly, and one of exactly 512 bytes into an empty buffer) is only copied; one
  that does not fit flushes the buffer first; one of more than 512 bytes is written at once.
- **R8** (measured: a52, a62) **A write in the read state** (`level > 0`, after a task 53 with
  data left in the buffer, no seek since) of up to 512 bytes is copied into the buffer at `curp`
  over the bytes read ahead, `level` grows by `n`, and nothing reaches the file - then or later:
  `fflush` does nothing while `level > 0`, a seek and a close discard the buffer. The task reports
  success. A later read in the same state returns the bytes after the written ones from the buffer
  (and, when the written bytes ran past the data that was read, bytes of the buffer that never came
  from the file: section 7).
- **R9** (measured: a62 B, a67 D) A write of more than 512 bytes in the read state goes to the file at
  once, at the handle's position: after the block that was read ahead (for a file shorter than 512
  bytes: at its end), not at the stream's position. The buffer and `level` stay as they were.
- **R10** (measured: a62 D, E) A write after a read that emptied the buffer exactly (`level == 0`;
  also after a read that hit the end of the file) starts writing with `curp` where the read left
  it, but the flush writes from the start of the buffer: write 2 bytes after reading all 300 bytes
  of a file, and the file gets 2 more bytes - the first two of the buffer, which are the file's
  first two bytes - at its end. After a read that hit the end of the file `curp` is at the start
  (`_ffill` set it there), so the written bytes are appended as expected.

## 6. Seeking, closing, feof

`fseek(fp, off, SEEK_SET)` (task 55): if `fflush(fp)` fails, return -1 and change nothing more.
Else clear `EOF`, `IN`, `OUT` (not `ERR`), `level = 0`, `curp = buffer`, `lseek(fd, off, SEEK_SET)`;
return 0, or -1 if `lseek` failed (the buffer is emptied all the same).

`fclose(fp)` (task 56): if `level < 0` and `fflush(fp)` fails, return -1 **and leave the stream as
it is**: its entry of the stream table, its buffer and its open handle stay until the program ends
(**measured**: a53 - the close gives 2 and task 57 on the file then gives 2). Else free the buffer,
`close(fd)`, mark the entry free (`flags = 0`, `bsize = 0`, `level = 0`, `fd = -1`); return what
`close` returned.

`feof(fp)` is `flags & EOF`.

Consequences:

- **R11** (measured: a61 G) A seek after a failed flush fails once (`D0 = 2`; the flush already
  emptied the buffer), the next one succeeds.
- **R12** (measured: a53, a61 C, a64 B) A stream whose close failed keeps its handle: the file cannot be
  deleted; it can be opened again; the slot of the 68000 program is free.
- **R13** (measured: probes e1, e2) At the end of the process the run-time flushes every stream
  with `READ` or `WRIT` and `level != 0` - including streams that `initSim` forgot (a reset, a new
  program with files still open) and streams whose close failed (whose flush fails again). Until
  then a forgotten stream keeps its bytes and its handle: after Rewind, the program finds the file
  without the bytes and cannot delete it (e2: open 0, read 1, delete 2); after File > Exit the file
  holds them (e1, e2). The oracle's recipes press neither Rewind nor exit the simulator before they
  collect a result, so these two have no conformance program; `engine/sim/test/stdio.test.mjs`
  pins them in the port.

## 7. The buffer's memory

The buffer is `malloc(512)` through the run-time's memory manager (`fopen` -> `setvbuf`
`4de2bc` -> `4db2c8`, a call through the pointer at `528214`) and `free` at `fclose`. A read in the
write state (R3) and a read in the read state past the bytes that came from the file (R8) return
what the block holds; a flush after a read in the write state can write such bytes into the file
(R6: p02 case E wrote `41 42 43 44 45 27 00`, the last two never written by the program). Measured
(probes p01, p02, p09, p11, the reviewer's q05; p01 and p09 run twice with the same result; `a68`):

- **Which block.** A new stream gets the freed block that was allocated first (p11, `a68`: of two
  freed blocks the earlier one, although it was freed last); with none free, a block of the heap.
  The port does the same.
- **A freed block keeps its bytes from the ninth on** (p01 T3, T4, `a68`); bytes 0-7 are the heap's
  bookkeeping after `free` (pointers and sizes: `3A 02` in bytes 2-3 in q05, a small number in
  byte 5 and zeros in bytes 6-7 in p01 and p02). The port keeps the bytes from the ninth on and
  gives zeros for bytes 0-7.
- **A block of the heap** (never a stream buffer before) holds what earlier users of the memory
  left: in p01 the text `Primary screen = 1  Secondary screens = 2 and up.` (Windows help
  strings), in p01 T5 `00001000 Starting Address` (a line of the listing), zeros elsewhere. Past
  the end of the 512 bytes come the next block's bookkeeping (heap pointers such as
  `60 D8 39 02`). The same bytes appear in every run of one program; another program (another
  listing, other strings loaded before) gets other bytes. **`a51`'s read returns `0A 00 00 44`**
  (p09, two runs). The port gives zeros for all of these (`00 00 00 00` in `a51`).

  What a student can see of this: only by reading, without the seek C requires, what the program
  did not write. Then the original shows a few bytes of that residue - in the 68000 memory after
  a read, and, after a flush, in the file (a file that holds a few bytes the program never wrote,
  such as `27 00` in p02 E). The port shows zero bytes in the same places (the file has the same
  length, with zeros where the original has residue). Recorded in docs/differences/SH6.md.

- **A write that runs past the end of the buffer** (R8: a write in the read state copied at
  `curp` near the end of the buffer) overwrites the heap block behind the buffer. What follows was
  measured in eighteen runs and does **not** follow from what the 68000 program did alone:
  - 1 to 3 bytes past the end: harmless in every run (p10b, p12-overrun2, the reviewer's
    q02w1-q02w3).
  - 4 bytes past the end: harmless in p12-overrun4, x1, x2, the reviewer's q02a, and three runs
    of the reviewer's program q02 under the file name `q02-review*.X68`; **fatal** (the simulator
    process ends at once, no box, nothing written) in the same program under the file name
    `q02-end-of-buffer.X68` (the reviewer's two runs and one of mine). The program, its bytes and
    the bytes written past the end were the same; the name of the program file (which the
    simulator keeps in strings on the same heap, so the layout behind the buffer changes) decided.
  - 5 or more bytes past the end: in most layouts the next allocation or release of a stream
    buffer fails with an access violation, which SIM68K reports as `ERROR: An exception occurred in
    routine 'exec_inst'.` (p10a, p10c, p12-overrun5, p12-overrun8 under two file names, x4, x5:
    the next close, open or task 59); but 8 zero bytes in the layout of p12 were harmless under
    two file names (x3, x3b).
  - After the first error box the student can press OK and Run again. Every later allocation or
    release of a stream buffer fails the same way: in e4 the next task 52, task 59 and task 52
    each showed the box again (D0.W = 2, D1 = -1); tasks that need no buffer (a write or a close
    on the failed FID) gave 2 without a box.

  The port's choice, since no rule decided by the program exists: up to 4 bytes past the end are
  harmless (every measured run with 1-3 bytes, and all but one layout with 4); from 5 bytes on the
  next allocation or release of a buffer throws the access violation, and so does every later one
  (the outcome of most measured runs, and of e4 after the first box). Bytes written past the end
  stay with the block and are read back by the same stream, as in p10a. The differences that
  remain - the 4-byte case of q02, the harmless zeros of x3 - are recorded in
  docs/differences/SH6.md. A program meets them only by writing right after a read, without the
  seek C requires, when the read had left the buffer nearly empty.

## 8. The stream table

`_streams[]` has 50 entries (`nfiles` at `52a030` is 50; `fopen` searches the table for an entry
whose `fd` is negative, `4de954`), three of them stdin, stdout and stderr; the handle table has 50
entries too, three taken. So 47 streams can be open at once, counting those whose close failed
(R12), those a reset forgot (R13), and **the log files**: while a log runs, the execution log and
the output log (each when it is selected) are streams of the same table (`logU.cpp`
`prepareLogFile`). When none is free, `fopen` returns `NULL` before it opens anything. Measured:
`a66` (with `result.bin` open, 46 streams whose close failed, then every open fails); `a69` (with
the output log running and no `result.bin`, 46); probe e5 (a66 with the output log: 45, with the
execution log: 45, with both: 44). When a log starts with too few free entries, the log file that
gets none is not opened (`prepareLogFile` opens the execution log first, then the output log): in
probe e6 (46 streams whose close failed, then Log Start with both logs selected) the execution log
was created, the box `Error` / `Can't open log file, error 0` appeared, no output log was written,
and the log stayed marked as running (`LOGGING`). The port does not do this: the log files belong
to the host's log service, which opens and writes them whatever the table holds; the engine only
counts the entries that are free (a difference, docs/differences/SH6.md). Read in the code only,
not measured: `stopLog` closes `ElogFile` even when only an output log was started, so a pointer
left from an earlier execution log could close a program's stream that has since taken that entry;
the port has no such pointer. The port counts the log files while a log runs
(`easy68k_files_log_streams`, called by Log Start and Log Stop in `shim/log.cpp`).

## 9. The probes

The probes are 68000 programs that drive tasks 50 to 59 and write, after every task, a line with
`D0`, `D1`, `D2` and the bytes read (routines of `tests/conformance/sim/dumplib.X68`). They were run
in the official `SIM68K.exe` under Wine 8.0 (`tests/oracle/wine/sim/regenerate.mjs --file ...
--recipe report`; e1-e5 with a script of their own in a container of the same image, which pressed
Rewind and File > Exit and mounted a read-only folder) and in the port. Every line of every
official result equals the port's except as said below. The conformance programs
`trap15-a/a61`-`a68` are probes with those bytes left out, and `a69` counts the streams with the
output log running; the probes and their official results are kept outside the repository (the
engineer's scratch folder). Every official result equals the port's except the residue bytes of
section 7 and the overruns section 7 lists as differences (q02-end-of-buffer: the original ends,
the port completes; x3, x3b: the original completes, the port shows the error box at the next
close).

| Probe | Conformance program | Rules | What it does |
|---|---|---|---|
| `p01-garbage` | - | section 7 | bytes a read in the write state returns: a heap block, past 512, the block of a closed stream, two closed streams, after task 59 |
| `p02-write-state-reads` | `a61` | R3, R5, R6, R11, R12 | write n, read k for k < n, k = n, k > n; write after it; seek after it; the error flag |
| `p03-read-state-writes` | `a62` | R8, R9, R10 | writes after reads: small, over 512, after the end of the file, after a read that emptied the buffer, followed by a seek |
| `p04-defined` | `a63` | R1, R2 | the sequences C defines (seek between write and read), reads of 0 bytes, a write past the end |
| `p05-handles` | `a64` | R2, R12 | two streams on one file, tasks 57 and 59 on an open and on a leaked stream, a stale read buffer |
| `p06-crossing` | `a65` (without case C) | R1, R7, section 7 | reads and writes of 511-1025 bytes across the buffer; case C writes 10 bytes past the buffer and crashes at the close |
| `p07-limit` | `a66` | section 8 | streams leaked until `fopen` fails |
| `p08-edges` | `a67` | R5, R9, section 3 | counts that wrap the bounds test (`$FFFFF000`, `$FFFFFFFF`), reads of 0 bytes, the end-of-file flag |
| `p09-a51-bytes` | - | section 7 | a51 with the 4 bytes of its read dumped: `0A 00 00 44` |
| `p10a`-`p10c`, `p12-overrun2`-`8`, `p12b` | - | section 7 | writes 1 to 10 bytes past the end of the buffer; where it crashes; p12b is p12-overrun8 under another file name |
| `x1`-`x5`, `x3b` | - | section 7 | the 4- and 5-byte overruns with other bytes (`1111`, `XYZW`, zeros, `ABCDE`) in the layouts of q02 and p12; x3b is x3 under another file name |
| `q02-end-of-buffer`, `q02-review`(-b, -c) (the reviewer's q02) | - | section 7 | the same program, 4 bytes past the end: the process ends under the first name, completes under the second |
| `e4` | - | section 7 | 8 bytes past the end, then OK and Run after each error box: every later open, close and task 59 that needs a buffer fails again |
| `e5` (a66 with Log Start) | `a69` | section 8 | the output log, the execution log, both: 45, 45, 44 streams |
| `p13-wrapped-write-state` | - | section 10 | a read in the write state whose count wraps the bounds test: the `exec_inst` box in both |
| `p11-reuse-order` | `a68` | section 7, R4 | which freed block a new stream gets, and its old bytes; a read of 1050 that starts in the buffer (run again after its last change; equal to the port) |
| `e1`, `e2` | - | R13 | a stream never closed, then File > Exit; a stream a Rewind forgot, then a second run and File > Exit |
| `e3` | - | section 3, R7 | a read-only file (on a read-only mount): open 3, write 2 bytes 0, close 2; a write of 600 bytes 2 |

## 10. In the port

`shim/hostfile.cpp` implements sections 1 to 6 literally over the host's file interface
(`host_file_open`, `_read`, `_write`, `_seek`, `_close`, `_remove`; unchanged). The host
(`app/src/core/sim-host/files/program-files.ts`) is used as the operating system of section 3:

- The host buffers on its own (it was written to imitate this run-time while the engine passed every
  request through): it keeps up to 512 written bytes of a handle pending until the next seek,
  read or close of that handle or a write that does not fit, and it serves reads from the last
  512-byte block it read. The engine's reads always continue where the previous one ended, so the
  host's read block never answers them; a write of 512 bytes or fewer that is not the mirror
  (below) is followed by `host_file_seek(h, 0, SEEK_CUR)`, which makes the host write it.
- **The mirror.** The bytes a flush of the stream would write (`buffer[0 .. bsize + level + 1)`
  while `level < 0`) are always held by the host as the handle's pending bytes. When the stream
  flushes, the host writes them at the next call on the handle (every caller of `fflush` makes one
  within the same task). When the process ends without a close - the page closes, the simulator
  starts cold, a reset forgot the stream - the host writes them as it writes every pending byte at
  its exit (`ProgramFiles.exit`, `exitNow`), which is R13.
- When a read in the write state shrinks what a flush would write (R3, R6), the host's pending
  bytes are too many and cannot be taken back. The engine then lets the host write them and puts
  back what the file held (read through a second handle opened by the file's name, which does not
  see pending bytes; a file that was shorter is truncated with a create and rewritten), and then
  mirrors the right bytes. If the program's current folder moved since the open (a task 58 dialog),
  the name may mean another file: the repair is not made, and if the stream is then flushed the
  host writes the stale bytes before the right ones (a difference, docs/differences/SH6.md).
- A handle that the host refuses a write on (a read-only stream, storage that refuses) is not
  mirrored; its flush writes for itself, and fails as `WriteFile` fails.
- The engine's memory for a buffer is a block of 512 bytes; bytes written past its end (R8) are kept
  with the block (up to 1 MB) instead of overwriting other heap memory, and bytes read past what was
  ever written come out as described in section 7. A copy into the 68000 memory that would run past
  its end (a read in the write state whose count wrapped the bounds test of task 53) throws, which
  ends in the original's handler `ERROR: An exception occurred in routine 'exec_inst'.`, as the
  original's access violation does (probe p13); the original first copies heap memory into the
  68000 memory, the port copies nothing (docs/differences/SH6.md).
