# Differences from the original introduced by FS1

None of these changes what a student's program can observe.

- **Dropped files are copied before they are opened (browser).** The original opens a dropped file
  where it lies. A browser gives the page the file's bytes but no path it can keep, so the port
  copies it into `My Programs/Imported/` and opens the copy; saving writes the copy. Use the Export
  button of the Files panel to take it out again. The desktop app opens a dropped file where it lies, as the original does,
  and shows the Open dialog in a dropped folder.
- **Names that differ only in letter case are one name in every store.** As on Windows, Rename...
  refuses a name that exists in another spelling, and Import... and dropped files replace (after the
  question) the file that is already there under another spelling, keeping its spelling, instead of
  adding a second spelling beside it.
- **A dropped `.S68` brings its listing along.** The original loads only the first dropped file. The
  port still loads only that one, but also copies a dropped `.L68` with the same base name into the
  same folder, so that the simulator finds the listing beside the program instead of showing the
  nine explanatory lines.
- **A dropped `.S68` in Simulator mode may ask one more question (browser).** As in the original,
  `The current debug environment will be lost, click OK to continue.` (`Caution`) comes first when a
  program is loaded, and Cancel leaves everything as it was. After OK the port copies the file into
  `My Programs/Imported/` before loading it; if an earlier copy with other contents is already there,
  `"My Programs/Imported/<name>" already exists with other contents. Replace it with the new file?`
  (title `Drop`) is asked then. The desktop app loads a dropped `.S68` where it lies and asks only
  `Caution`, as the original does.
- **The port's own Open and Save dialogs (browser).** They list the browser store ("My Programs")
  and an opened folder instead of the disk, offer `From this computer...` (and `Open folder...` where
  the browser can), and say in a short note where files are kept. Names are checked against
  Windows' rules (no `\ / : * ? " < > |`, no reserved device names, no trailing space or period) so
  that exported files work on Windows. Only one file can be chosen from the list; several files can
  be brought in at once with `From this computer...` where the opener asks for several.
- **The Files panel** (an addition, 1.5): the browser store as a tree with New Folder...,
  Import..., an Export button, Rename... and Delete. Delete and Import ask before removing or replacing
  anything.
- **A browser storage that is slow to answer does not hold up the start.** After three seconds the
  application is shown and the Files panel says that My Programs is still opening; what is opened
  or saved meanwhile waits for the storage (at most 20 s, after which the session keeps files in
  memory and says so).
- **A notice about Safari's storage rules (an addition; risk R-10).** In Safari, and in every
  browser on an iPhone or iPad, the Files panel shows a short notice above the tree from the first
  start: the browser may delete the programs kept in it after seven days without a visit, and an
  app made with "Add to Dock" or "Add to Home Screen" starts with its own, empty My Programs. It
  offers Export... (the whole store as a `.zip`) and `Got it`, which hides it for good in that
  browser. The Dock or Home Screen app shows, while its store is empty, one sentence with
  Import.... When the Files panel is hidden, or the visit starts in Simulator mode, the same text
  appears as a note at the first file written into the browser, until `Got it` or the note is
  closed. The desktop app and other browsers show none.
- **A full or blocked browser storage is reported.** The original writes to the disk and shows the
  run-time library's error. The port says in plain words that the file was not saved and that
  nothing saved before is lost, or that the browser keeps no files at all (some private windows).
