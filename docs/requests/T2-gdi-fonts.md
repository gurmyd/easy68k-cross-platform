# Requests of T2 (GDI capture, references, fonts)

Status: item 1 applied before this gate (`/tools/fonts-src/** -text` is in `.gitattributes` since commit 539028a). Item 2 checked in gate I1 round 1: the steps match how the suites start; the GDI, twins and asm-CLI steps of `windows-oracles` now each run even when an earlier one failed. Item 3 declined: `@napi-rs/canvas` is still used by DV1's `app/src/features/pwa/icons/make-icons.mjs`.

1. **`.gitattributes`: keep `tools/fonts-src/` byte-exact.** Add `/tools/fonts-src/** -text`.
   The folder holds third-party licence texts and font files whose SHA-256 is recorded in
   `tools/fonts-src/sources.json`, and `windows-outline-metrics.tsv`; a checkout with
   `core.autocrlf=true` (the Git for Windows default, also on GitHub's Windows runners) would turn
   the text files into CR LF and change their hashes. The tools already tolerate CR LF, so nothing
   breaks today; the hashes in `sources.json` simply stop describing the checkout.

2. **CI: nothing new is needed, but note what runs where.**
   - `windows-oracles` already runs `npm run oracle:gdi` (guarded by `tests/oracle/gdi-capture/run.mjs`,
     which now exists). It builds with MSVC (`vcvars64.bat` via vswhere), needs about 4 minutes on
     a loaded developer PC and fails when a committed reference differs.
   - `conformance` (Linux, macOS) picks up `tests/conformance/gdi/vitest.config.ts` by glob. It
     includes `atlases.test.ts`, which runs `node tools/make-font-atlases.mjs --check` and so proves
     on every platform that the outline atlases are reproduced byte for byte (T2 acceptance).
   - `surface.test.ts` holds SH1's surface (and later SH2's ellipses and wide pens) to the capture;
     it fails until the surface passes, which is intended.

3. **`@napi-rs/canvas` is not needed by the font-atlas tool** (it has its own rasteriser, for
   byte-identical output on every platform). The gate may drop the dependency if no other package
   uses it.

4. **No browser check script**: T2's acceptance list names no browser; nothing to add to
   `browser-checks`.

5. **Gate I1 round 2, for information (no configuration change needed).**
   - `conformance`: `surface.test.ts` no longer fails on SH2's cases; while `surface/ellipse.ts` or
     `surface/widepen.ts` is SH1's stub those cases are reported as skipped tests named with their
     count ("N cases wait for SH2"), and they are compared by themselves once SH2 replaces the files.
   - `windows-oracles`: `npm run oracle:gdi` now compares on another Windows instead of stopping, and
     fails while the runner's Windows (10.0.26100) has no record in
     `tests/oracle/gdi-capture/other-windows.json`. The step prints the record (also into the job
     summary); after a person has looked at the listed differences, adding that record to the file
     (T2's path) turns the step green and keeps it guarding against changes of the runner's Windows.
