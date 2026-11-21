# Differences from the original introduced by FS2

None of these can change what a 68000 program observes; they concern how the editor saves files of
the student's computer in a Chromium browser.

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
