# Request from DV5: the desktop app must find the `.L68` next to an `.S68` (owners W1, DV2, SH8; DV3)

Status: done in the repair of D1. Item 1 (W1, `app/src/fs/vfs.ts`): a folder that may not be listed no longer
ends the walk; its segment is kept as given and the path is confirmed by a later listing or a `stat`
(rule and tests: `docs/porting/errata/W1.md` entry 15). Items 2 and 3 not needed and not taken (3 would
show the page names above the granted roots; DV2.md entry D1). Item 4 done (DV3.md entry 22). The runs
of release.yml are in `docs/porting/errata/DV5.md` entry 10.

Check 7 of `docs/ARCHITECTURE.md` 6.7 (`tests/desktop/packaged/programs/programs.spec.ts`, DV5)
fails on both Mac runners of release.yml (run 44960702355, jobs `mac-arm64` and `mac-x64`) on one
line only: after Execute the message area has a third line, `Unable to open .L68 file.`, and the
listing shows "A matching .L68 file was not found ...", although the `.L68` is in the program's
folder (check 6 has just compared it with the official file). A student using the macOS app loses
source-level debugging. The surface hash and the text rows of check 7 match. The full analysis is
`docs/porting/errata/DV5.md` entry D1.

Cause, in short: the run controller (`app/src/core/run/controller.ts` `readListing`, SH8) asks
`vfs.resolve(dirname(path), '<name>.L68')`. `vfs.resolve` (`app/src/fs/vfs.ts`, W1) lists every
folder from the mount root down to find each segment's stored spelling. On the desktop's `/disk`
mount the main process refuses to list folders outside the granted roots
(`desktop/src/fs-ipc.ts` `list`, DV2), so the walk fails at `/` and `resolve` returns null. A
scratch reproduction with `MemoryBackend` whose `list` refuses everything above the program folder:
`vfs.stat` of the `.L68` returns the file, `vfs.resolve` of the same folder and name returns null.

Requests (the owners choose one of 1 to 3; 4 is separate):

1. **W1** (`app/src/fs/vfs.ts`): `resolve` tries the lexical path first (one `stat`) and walks only
   when that does not find it, or walks only below the deepest folder it may list; a refused
   `list` of an ancestor is not "not found". Add a unit test with a backend that refuses to list
   above a granted folder.
2. **SH8** (`controller.ts` `readListing`): list only the program's own folder (which is granted)
   and match the name there with `matchName`.
3. **DV2** (`desktop/src/fs-ipc.ts`): let `list` of an ancestor of a granted root answer with the
   entries on the way to the granted roots only (no other names leak).
4. **DV3** (`tests/desktop/packaged/association.spec.ts`, check 3): require that the first
   `.e68-listing__row` is not "A matching .L68 file was not found. ..."; today any row passes,
   including the rows of that text.

After the repair, run release.yml on the branch that carries it (`draft_release=false`): check 7
should pass without a change in DV5's files.
