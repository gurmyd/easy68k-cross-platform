# Differences from the original introduced by FS1

None of these changes what a student's program can observe.

- **Dropped files are copied before they are opened (browser).** The original opens a dropped file
  where it lies. A browser gives the page the file's bytes but no path it can keep, so the port
  copies it into `My Programs/Imported/` and opens the copy; saving writes the copy. Use Export...
  to take it out again.
- **A dropped `.S68` brings its listing along.** The original loads only the first dropped file. The
  port still loads only that one, but also copies a dropped `.L68` with the same base name into the
  same folder, so that the simulator finds the listing beside the program instead of showing the
  nine explanatory lines.
- **The port's own Open and Save dialogs (browser).** They list the browser store ("My Programs")
  and an opened folder instead of the disk, offer `From this computer...` (and `Open folder...` where
  the browser can), and say in a short note where files are kept. Names are checked against
  Windows' rules (no `\ / : * ? " < > |`, no reserved device names, no trailing space or period) so
  that exported files work on Windows. Only one file can be chosen from the list; several files can
  be brought in at once with `From this computer...` where the opener asks for several.
- **The Files panel** (an addition, 1.5): the browser store as a tree with New Folder...,
  Import..., Export..., Rename... and Delete. Delete and Import ask before removing or replacing
  anything.
- **A full or blocked browser storage is reported.** The original writes to the disk and shows the
  run-time library's error. The port says in plain words that the file was not saved and that
  nothing saved before is lost, or that the browser keeps no files at all (some private windows).
