# Errata of DV5 (packaged-app program checks 6-8)

What DV5 found while writing checks 6-8 of `docs/ARCHITECTURE.md` 6.7
(`tests/desktop/packaged/programs/`). No entry asks for a change of `app/src/contracts/`, so there
is no **Contract** section.

## Defects found in other packages

### D1. The desktop app never finds the `.L68` next to an `.S68` (owners: W1, DV2, SH8)

- Seen: after Execute (and after opening an `.S68` from the command line) the message area says
  `Unable to open .L68 file.` and the listing shows "A matching .L68 file was not found. The .L68
  file is used to provide source level debugging. ...", although the `.L68` is in the folder (check
  6 has just compared it with the official file). A student loses source-level debugging, and the
  message area no longer equals the original's. Check 7 fails on this line and names it.
- Reproduced on this PC with the development build of the desktop app (Playwright's Electron
  launcher, hidden windows, the production web build served by `app://`), both for Execute from the
  assembler's status dialog and for `EASy68K tutorial1.S68` on the command line. The code is the
  same on macOS; the GitHub runs of check 7 are in entry 8.
- Cause: the run controller looks for the listing with `vfs.resolve(dirname(path), '<name>.L68')`
  (`app/src/core/run/controller.ts` `readListing`, SH8). `vfs.resolve` (`app/src/fs/vfs.ts`, W1)
  walks from the mount root and lists every folder on the way to find each segment's stored
  spelling. On the `/disk` mount that means listing `/`, `/private`, `/private/var`, ... (on
  Windows `C:`, `C:\Users`, ...), and the desktop main process refuses to list anything outside the
  granted roots (`desktop/src/fs-ipc.ts` `list` through `GrantedRoots.realIfAllowed`, DV2). The
  first refused `list` makes `resolve` return null, so no `.L68` is found, in any folder.
- Possible repairs, for the owners to choose: `vfs.resolve` tries the path as given first (a
  `stat`) and walks only when that fails, or walks only below the deepest folder it may list; or
  the controller lists only the program's own folder (which is granted) and matches the name
  there. Anything else that resolves a name through `vfs.resolve` on `/disk` has the same problem.
- Check 3 (DV3, `association.spec.ts`) does not notice it: it requires `.e68-listing__row` to be
  attached, which the rows of the "not found" text are too. It should require that the first row
  is not "A matching .L68 file was not found. ...".

## Corrections to the document

### 1. The official `.L68` and `.S68` are T1's goldens, not T3's (9.6)

- The task names "T3's committed goldens". The official listing and S-record files of the shipped
  examples are in `tests/conformance/asm/golden/official/<name>.X68/default.{L68,S68}`, written by
  the assembler oracle (T1). T3's part of the checks is the headless harness of 6.4
  (`tests/conformance/sim/harness.ts`), which gives check 7 its expected message lines and surface
  hash. `expected.ts` uses both; it commits nothing.

### 2. 5.9 leaves out that a seek flushes a written file

- 5.9: "A file a program writes appears when the original's C library would have written it: at
  task 56 or task 50, when 512 bytes have accumulated, or when the simulator is restarted".
- Seen in check 8 (rehearsal on this PC, and the CI log prints it every run): `fileio.X68` writes
  24 bytes with task 54; they are not on disk after the task 54 TRAP and are there after the task
  55 TRAP (set the file position). That is what the C library does: `fseek` writes the buffer
  first. So the behaviour matches the original; the list in 5.9 is incomplete ("... or when the
  program sets the file position (task 55)"). For DOC1 / the owner of 5.9; nothing in the code
  changes.

## Decisions where the document is silent

### 3. "Open tutorial1.X68 from a temporary folder" is the command line of 5.7

- The program is copied from `app/public/examples` (the source the app ships) into a new
  temporary folder (its real path: `/var/folders` is a link to `/private/var/folders`) and given
  to the app's binary on the command line, which 5.7 defines (Editor mode opens it) and which
  grants its folder (`desktop/src/main.ts`). A native open dialog cannot be driven over CDP, and
  System Events on a file panel would be slow and fragile on a shared runner.

### 4. Toolbar buttons, not shortcuts

- Assemble, Run and Trace Into are pressed with their toolbar buttons
  (`.e68-shell__toolbar [data-command=...]`), Execute with the status dialog's button. The
  shortcuts and the native menu are proved elsewhere (DV2's menu tests, X1/X2, the manual list of
  6.8); these checks are about what a program does in the packaged app.

### 5. "As soon as the program has closed it": Trace Into over the close

- `fileio.X68` deletes its file with task 57 two instructions after task 50 closes it, so a Run
  would leave nothing to look at. The check traces instruction by instruction, notes after every
  step whether the file is there and how long it is, and after the TRAP of task 50 requires the
  file with the expected bytes within one second of the moment the PC field shows the next
  instruction (measured: 1 ms in the rehearsal). Then Run: Halted, and the file is gone, as in
  the original.
- The expected bytes and addresses are read off the assembled program, not typed in: the bytes at
  the label `data`, `datasize` of them, from the S-records; the TRAP of task 50 and the next
  instruction from the listing (`model.ts`). A unit test also pins them to `'this is a test'`,
  1 to 9 and 0.

### 6. The headless run of check 7

- `runScenario` with the `report` recipe (the program loaded and run, as Execute then Run does),
  `metrics: 'windows'` (the app's own glyphs from `app/public/fonts`, which check 1 proves are in
  the bundle byte for byte; the default `wine` cells are for the comparison with the Wine oracle),
  and the app's default Auto Trace interval and Disable Display setting instead of the oracle's.
  The message lines, the surface hash and the text rows are compared. The surface hash is computed
  from the Output canvas's backing store (`getImageData`), whose bytes equal the surface's opaque
  `$AABBGGRR` pixels; the canvas has one pixel per surface pixel (640 x 480 measured).

### 7. Where the tests run

- `model.spec.ts` (unit tests and the build step) and `programs.spec.ts` are in the project
  `packaged` of DV3's configuration, which already matched `programs/**/*.spec.ts`; DV3's project
  `unit` matches only `unit.spec.ts`. The unit tests and the build step need no Mac and run
  anywhere with `--project=packaged`; the three checks skip off macOS with DV3's reason.
- release.yml did not have to change, so there is no `docs/requests/DV5-release.md`.

## Runs on GitHub

### 8. Runs of release.yml on the branch gate3/dv5

- Run 44960702355 (commit b3ed49f, manual, `draft_release` unticked): `version`, `engines`, `web`
  passed; `mac-arm64` (job 137018680443) and `mac-x64` (job 137018680427) built, signed and
  checked the bundle as before, then the packaged suite: 58 passed, 1 failed on each. DV3's
  checks 1-5 passed. DV5's unit tests and build step passed (the engine reproduced both official
  examples byte for byte on the runners). `checksums` and `publish` were skipped because the mac
  jobs failed.
  - Check 6 passed on both: status dialog 0 errors, 0 warnings; `tutorial1.L68` (7714 bytes; the
    golden has 7713, its date line is one character shorter) and `tutorial1.S68` (576 bytes) in
    the temporary folder, equal to the official files but the date line.
  - Check 7 failed on both, only on D1: the message area had a third line,
    `Unable to open .L68 file.`. The rest held: Halted 236 ms (arm64) and 638 ms (x64) after Run;
    the Output canvas 640 x 480, hash `377357e7...088170` equal to the headless harness's; the
    text rows `D1 contains: 8`, `D2 contains: 520`, `D3 contains: 68020`, `Program End` equal.
    The screenshot (artifact `desktop-packaged-results-<arch>`,
    `screenshots/programs-tutorial1-tutorial1-halted.png`) shows the "A matching .L68 file was
    not found" text where the listing should be.
  - Check 8 passed on both: `test1.txt` held the 24 bytes after the TRAP of task 50 (0 ms and
    1 ms after the PC moved); the bytes were on disk from the task 55 TRAP on (entry 2); Run
    halted and task 57 deleted the file.
- No further run was made: nothing in DV5's paths can change the outcome. Once D1 is repaired,
  the same run (`gh workflow run release.yml --ref <branch> -f draft_release=false`) should pass
  check 7 unchanged.

### 9. Repair round 1 (after the independent verification)

- D1 is still present: `origin/main` has no change to `vfs.ts`, `controller.ts` or `fs-ipc.ts`
  since run 44960702355. Reproduced again at the branch head without a Mac: a `MemoryBackend`
  mounted as `disk` whose `list` refuses every folder above the program's folder (as `fs-ipc.ts`
  does outside the granted roots); `vfs.stat` of `.../tutorial1.L68` returns the file and
  `vfs.resolve(folder, 'tutorial1.L68')` returns null (scratch test, not committed: it tests W1's
  code). D1 is routed to its owners in `docs/requests/DV5-l68-resolve.md`, together with the
  tightening of DV3's check 3. Check 7 is left as it is: it fails for the right reason, and making
  it pass in DV5's paths would hide a defect a student meets.
- The x64 artifact of run 44960702355 (`desktop-packaged-results-x64`) was downloaded and its
  screenshots looked at: `programs-tutorial1-assembled.png` (status dialog, 0 warnings, 0 errors,
  the path under `/disk/private/var/folders/...`), `programs-tutorial1-tutorial1-halted.png` (the
  three message lines including `Unable to open .L68 file.`, the "not found" text in the listing,
  the output `D1 contains: 8` to `Program End`, Halted, PC=$1074) and `programs-fileio-end.png`
  (Halted, PC=$84C, the trace lines of the TRAPs in the message area). They agree with the arm64
  ones and with the log. In the halted screenshot the toolbar's tooltip ("Program halted. Rewind
  or Reload to run it again.") covers the D0 row, because the pointer is still on Run; cosmetic,
  the check reads the fields from the page, not the picture.
- The unit tests and the build step (`--project=packaged programs/`) pass on this PC: 6 passed, the
  three Mac checks skipped.

### 10. Repair of D1 (W1, with DV2's and DV3's tests)

- Repaired in `app/src/fs/vfs.ts` (`docs/porting/errata/W1.md` entry 15): a folder that may not
  be listed no longer makes `resolve` return null; its segment is kept as given and the path is
  confirmed by a later listing or a `stat`. No file of DV5 changed; check 3 (DV3) now fails on the
  "not found" text, and the development suite has `tests/desktop/dev/programs.spec.ts`.
- Run 44967365766 (commit e4f0106, manual, `draft_release` unticked): every job passed
  (`publish` skipped as it should). `mac-arm64` (job 137039373000) and `mac-x64` (job
  137039373023): 59 passed each. Check 7 passed on both with the message area
  `["S0 = 68KPROG   20CREATED BY EASY68K",".S68 file read successful"]` (no
  `Unable to open .L68 file.`); checks 6 and 8 passed; check 3 printed a first listing row
  beginning with an address on both.
- CI run 44967358502 (push of e4f0106), job desktop-dev (macos-15, job 137045009543): 67 passed,
  1 skipped; the three tests of `programs.spec.ts` passed on the Mac (status dialog 0 errors, first
  listing row `00001000 Starting Address`, PC row marked, output rows `Data file read` and both
  included texts, the case-only rename kept `CASE.TXT`). The jobs unit ("Integration scenarios
  under Node (I1)") and browser-checks (integration) fail on all three systems in this run as in
  the run before the repair (44961997281), outside the paths of this repair: unit fails in the
  wave-2 scenario's settings import ("the first Execute after the import ... exceptions"), and
  browser-checks (integration) in check:wave2's graphicSound.X68 sequence (0.wav starts about 280 ms
  after 1.wav, which lasts 302 ms), which fails the same way here on the code before the repair.

### 11. Review of the D1 repair (four minor findings)

- Merge commit 6b891d1 (git's default message, `origin/main` into `gate3/dv5`) has no
  Co-Authored-By line. It is pushed and is not rewritten (no force-push); every other commit of the
  repair has the line. Left as git's default message.
- The Mac proof of entry 10 ran on e4f0106; the head then, 798d958, changed only errata. CI run
  44970150937 (push of 798d958) skipped desktop-dev, as its plan job does for a push that changes
  documents only. The proof was repeated on the commit of this entry's round (below, entry 12).
- Above a granted root `resolve` keeps the spelling as given, on every disk, not only on a
  case-sensitive one: `W1.md` entry 15.1 now says so in the proposed 3.8.1 text and in a new row,
  and a unit test pins it. Its consequence for FS1's `renameEntry` (a case-only rename of a granted
  root folder is refused) is routed to FS1 in `docs/requests/W1-case-only-rename.md`.
- Failures in the CI runs of the branch that are not caused by D1 and fail the same way before the
  repair: unit (all three systems), the I2 wave-2 scenario's settings import; browser-checks
  (ubuntu, integration), check:wave2's graphicSound.X68 timing; e2e (macos-latest, chromium),
  `tests/e2e/editor/editing.spec.ts:212` "Undo reverses typing, a paste and a comment" (an editor
  test that does not reach `vfs.resolve`). Routed to I2, the wave-2 audio owner and the e2e owner.

### 12. Second Mac proof of D1 (after the review)

- Commit b255dcb (b06b365, the review's changes, merged with `origin/main` at 7845093). The commit
  that records this entry changes only this file.
- Release run 44972000916 (manual, `draft_release` unticked): every job passed (`publish`
  skipped). `mac-arm64` (job 137053657347) and `mac-x64` (job 137053657425): `59 passed` each,
  `check 7: passed` on both; check 3 printed the first listing rows
  `00000000                            10  * This program is public domain.` (arm64) and
  `00001000 Starting Address` (x64), a listing row on both, not the "not found" text.
- CI run 44972001171 (push of b255dcb), job desktop-dev (macos-15, job 137053748182): `78 passed`,
  `1 skipped`, with the three tests of `tests/desktop/dev/programs.spec.ts` passing ("assembles with
  both INCLUDEs found; Execute shows its listing with the PC row marked", "Run: the data file named
  in another letter case is read, and the included texts are shown", "the other callers of
  Vfs.resolve find names on /disk in any letter case").

### 13. Round before gate I3: the review's open points

- Check 7 on both Mac runners: met since entry 12 (release run 44972000916, `check 7: passed` on
  `mac-arm64` and `mac-x64`, 59 of 59 each). No release.yml run was started in this round (none is
  allowed to make a release, and nothing in DV5's checks changed).
- A test of the defect that needs no Mac: in the repository since the repair of D1 (W1's
  `app/src/fs/vfs.test.ts`, "a folder that may not be listed for another reason: the name as
  given, if it is there", and DV2's `app/src/fs/disk-backend.test.ts`, "the root of /disk may not
  be listed, the granted folder may", which uses the real handlers of `desktop/src/fs-ipc.ts`);
  both run in `npm test` on all three systems.
- The x64 screenshots of the release run have still not been looked at by a person (the logs show
  the same figures as arm64). The manual list (docs/MANUAL-TEST-MAC.md D2, D6) asks for the app on
  an Intel Mac.
- The whole-tree checks (typecheck, lint, format check, `npm test`, `npm run test:conformance`)
  were run at the end of this round by the engineer who holds DV5's paths; the results are in that
  engineer's report.
