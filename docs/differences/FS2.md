# Differences from the original introduced by FS2

All but the last of these concern how the editor saves files of the student's computer in a
Chromium browser and cannot change what a 68000 program observes. The last one can.

- **A file changed by another program is not overwritten unasked.** The original writes the file
  on Save whatever happened to it meanwhile. The port asks first (3.8.6 rule 3, owned by E1), and
  for a linked single file whose real file it could not look at since a reload, it refuses the Save
  with a message and leaves the other program's version in place (docs/porting/errata/FS2.md,
  entry 2). Save As still saves.
- **Linked single files keep their outputs in the browser.** A file opened with `From this
  computer...` is saved back to its place, but the `.L68`, the `.S68` and the files a program
  writes go to a folder of the browser (3.8.2) until the student opens the file's folder with
  `Open the containing folder...`. The original writes them beside the source.
- **One folder of the computer at a time** (errata FS2.md, entry 7). The original reaches the whole
  disk.
- **A read-only file in an opened folder looks writable to a program.** The File System Access API
  cannot tell whether a file has the read-only attribute, so every file of `/folder` reports
  `readOnly: false` (errata FS2.md, entry 4). In the original, TRAP #15 task 51 (open) and task 59
  (file information) give `D0.W = 3` for a read-only file, and a write to it gives 2
  (trap15-tasks-0-59.md). In the port, on `/folder`, both give 0, and the write is refused only
  when the data reaches the disk, which the editor reports as a file that could not be saved. (My
  Programs, `/browser`, has no read-only files at all, so the question arises only for a real
  folder.) Asking the browser for a writable stream at `stat` time would not tell either: Chromium
  writes into a swap file first and fails only when it replaces the file.
