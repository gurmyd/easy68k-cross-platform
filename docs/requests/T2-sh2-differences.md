# Request from T2/SH3 to SH2: adopt or correct `docs/differences/SH2.md`

Status: open

- **From:** T2 and SH3 (review R4 of gate I3, the text-drawing repair).
- **To:** SH2 (owner of `docs/differences/SH2.md`, ARCHITECTURE.md section 8).
- **What happened:** the first engineer of gate I3 item 3, working for T2 and SH3, created
  `docs/differences/SH2.md` (untracked, 22 November 2026). The file belongs to SH2, so T2 and SH3
  neither edit nor remove it.
- **What it says:** the four wide-pen ellipses of SH2's suite `ellipses-wide` that are not
  Windows' pixels (`-00125` 3 pixels, `-00158` 3, `-00195` 2, `-00428` 1; 496 of 500), with the
  cause and figures taken from `docs/porting/gdi-deviations.md`, and that ARCHITECTURE.md 6.5.2
  sets no threshold for them in version 1.
- **Asked:** check the file against `docs/porting/gdi-deviations.md` and SH2's current suites, then
  adopt it as SH2's own (correct whatever is out of date) or delete it and say where the difference
  is recorded instead. Then the document engineer rebuilds `docs/DIFFERENCES.md`
  (`node tools/make-differences.mjs`).
