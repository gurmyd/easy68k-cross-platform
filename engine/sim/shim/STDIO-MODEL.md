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
SDK; addresses below) and then tested against the official program running under Wine with the
probe programs of section 9. Each rule is marked:

- **measured**: a probe run in the official program shows it;
- **read**: it is what the machine code does, and no probe shows it (because no 68000 program can
  reach the state, or the oracle cannot set it up); stated so that an implementation does not have
  to guess.

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
   (a `w+b` does not create or truncate it). **read** (probe p07 measures the count, section 8).
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
| `__read(fd, buf, n)` | `n == 0` or `n == 0xFFFFFFFF`: returns 0 without a system call. Otherwise `ReadFile(n)`: the count read (0 at the end of the file), or -1. A count of 2 GB or more fails (-1): the buffer range is invalid (**measured** under Wine with `n = 0xFFFFFE00`, trap15-a `a32`; on Windows `ReadFile` refuses such a range before it reads). |
| `__write(fd, buf, n)` | `n == 0` or `n == 0xFFFFFFFF` (-1): returns 0 without a system call. Otherwise `WriteFile(n)`: the count written, or -1. A count of 2 GB or more fails (-1) and writes nothing (**measured**: a53, the close whose flush is `__write(-3)`). Writing to a handle opened `"rb"` fails (**read**). |
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

- **R1** (measured: p06, a30, a59, a60) Reads of a file go through the buffer: a read of fewer than
  512 bytes fills the buffer with up to 512 bytes from the handle's position and hands out from it;
  512 or more go straight to the program's memory in multiples of 512, the rest through the buffer.
- **R2** (measured: p04, a30) A read that runs into the end of the file returns what there was
  (`D0 = 0`, `D2` = count) and sets `EOF`; the next read gives `D0 = 1`. `EOF` does not stop a read:
  a later read asks the handle again (and gets bytes another stream has written since, p05 A).
- **R3** (measured: a51, p01, p02) **A read in the write state** (`level < 0`, after a task 54 with
  no seek since) takes `n` bytes from the buffer at `curp`, whatever is there - nothing comes from
  the file - and makes `level` more negative by `n`. The read succeeds with `D2 = n` (for any `n`
  below 4 GB minus 512). The bytes are those of the buffer after the written ones: what the buffer
  held before (section 7). Because `level` moved, the next flush writes `n` bytes fewer than were
  written (R6).
- **R4** (read) A read of 512 bytes or more in the read state with data in the buffer takes the
  buffer's bytes first, then reads straight from the handle's position - which is the end of what
  the buffer was filled with, not the stream's position, when a write in the read state (R8) moved
  `curp`.
- **R5** (measured: p02 G) Once `ERR` is set, a read of fewer than 512 bytes from an empty buffer
  fails (`D0 = 2`) even after a seek (`fseek` does not clear `ERR`); a read of 512 or more still
  reads the multiples of 512 straight from the handle.

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

- **R6** (measured: a51, a53, p02) A flush writes `bsize + level + 1` bytes from the **start** of
  the buffer, at the handle's position. After writes only that is what was written. After a read in
  the write state (R3) it is fewer: write 10 and read 3 leave 7 to write; write 5 and read 5 leave
  0 (the flush writes nothing and succeeds); write 5 and read 6 or more leave a negative count,
  whose `__write` fails (-1 is answered with 0 without a system call; -2 and below go to
  `WriteFile` with a count above 4 GB and fail): the flush fails and sets `ERR`.
- **R7** (measured: a59, p06) The write buffer holds up to 512 bytes: a write that fits (also one
  that fills it exactly, and one of exactly 512 bytes into an empty buffer) is only copied; one
  that does not fit flushes the buffer first; one of more than 512 bytes is written at once.
- **R8** (measured: a52, p03) **A write in the read state** (`level > 0`, after a task 53 with
  data left in the buffer, no seek since) of up to 512 bytes is copied into the buffer at `curp`
  over the bytes read ahead, `level` grows by `n`, and nothing reaches the file - then or later:
  `fflush` does nothing while `level > 0`, a seek and a close discard the buffer. The task reports
  success. A later read in the same state returns the bytes after the written ones from the buffer
  (and, when the written bytes ran past the data that was read, bytes of the buffer that never came
  from the file: section 7).
- **R9** (measured: p03 B) A write of more than 512 bytes in the read state goes to the file at
  once, at the handle's position: after the block that was read ahead (for a file shorter than 512
  bytes: at its end), not at the stream's position. The buffer and `level` stay as they were.
- **R10** (measured: p03 D, E) A write after a read that emptied the buffer exactly (`level == 0`;
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

- **R11** (measured: p02 G, a53) A seek after a failed flush fails once (`D0 = 2`; the flush already
  emptied the buffer), the next one succeeds.
- **R12** (measured: a53, p05 B) A stream whose close failed keeps its handle: the file cannot be
  deleted; it can be opened again; the slot of the 68000 program is free.
- **R13** (read) At the end of the process the run-time flushes every stream with `READ` or `WRIT`
  and `level != 0` - including streams that `initSim` forgot (a reset, a new program with files
  still open) and streams whose close failed (whose flush fails again).

## 7. The buffer's memory

The buffer comes from the heap. What a read in the write state (R3) or a read past the data in the
read state (R8) returns is whatever those bytes hold.

> MEASUREMENT PENDING (p01): fresh blocks, reused blocks, the bytes past the end of the 512.

## 8. The stream table

> MEASUREMENT PENDING (p07): how many streams can be open (or leaked) at once.

## 9. The probes

The probes are 68000 programs that drive tasks 50 to 59 and write, after every task, a line with
`D0`, `D1`, `D2` and the bytes read (routines of `tests/conformance/sim/dumplib.X68`). They were run
in the official `SIM68K.exe` under Wine (`tests/oracle/wine/sim/regenerate.mjs --file`) and in the
port. The ones that cover every rule are conformance programs with goldens (`tests/conformance/sim/
trap15-a/a61`... below); the others, with their official results, are kept outside the repository.

> TABLE PENDING.

## 10. In the port

`shim/hostfile.cpp` implements sections 1 to 6 literally over the host's file interface
(`host_file_open`, `_read`, `_write`, `_seek`, `_close`, `_remove`; unchanged). The host
(`app/src/core/sim-host/files/program-files.ts`) is used as the operating system of section 3:

- The host buffers on its own (it was written to imitate this run-time while the engine passed every
  request through): it keeps up to 512 written bytes of a handle pending until the next seek,
  read or close of that handle or a write that does not fit, and it serves reads from the last
  512-byte block it read. The engine's reads always continue where the previous one ended, so the
  host's read block never answers them; a write that the host would keep pending (512 bytes or
  fewer) is followed by `host_file_seek(h, 0, SEEK_CUR)`, which makes the host write it.
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
  ends in the original's handler `ERROR: An exception occurred in routine 'exec_inst'.` as the
  original's access violation would.
