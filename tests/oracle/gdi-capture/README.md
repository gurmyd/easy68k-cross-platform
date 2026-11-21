# GDI capture (ARCHITECTURE.md 6.2.3)

`npm run oracle:gdi` builds `capture.cpp` with MSVC (`build.mjs`), runs it, and compares what it
measures with the committed references (`--write` updates them instead). Windows only; it needs the
MSVC build tools (`vcvars64.bat`, found with vswhere or through `VCVARS64`).

The program re-measures on real Windows what `docs/porting/trap15-tasks-60-up.md` says about GDI
and writes the references that the port's drawing surface (SH1, SH2) and text screen (SH3) are
held to. It draws only into memory device contexts holding a 32-bit DIB section, never creates a
window, and is DPI-unaware (`gdi-capture.manifest`), so GDI works at 96 DPI as for SIM68K.exe. It
makes the calls the C++Builder VCL makes for SIM68K.exe: pens from `CreatePenIndirect`, solid
brushes, `SetROP2` from the VCL's `PenModes` table (modes 18-255 through the exception table of
trap15-b 5.4), `MoveToEx`/`LineTo` plus `SetPixel` on the end point, `Rectangle`/`Ellipse` with the
`+1` of `simIOu.cpp`, `ExtFloodFill(FLOODFILLSURFACE)`, and `TextOut` as `ExtTextOut` on an opaque
cell followed by `MoveTo(x + TextWidth, y)`. Fonts are created as `TFont.GetHandle` does
(`lfHeight = -MulDiv(size, 96, 72)`, `ANSI_CHARSET`, `DEFAULT_QUALITY`, `DEFAULT_PITCH`).

## Outputs

| File                                              | Content                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/conformance/gdi/golden/<suite>.pixpack.gz` | one `.pix` (6.5.3) per case of `tests/conformance/gdi/cases.ts`, packed per suite (format in `pix.ts`), with GDI's pen position after each case                                                                     |
| `tests/conformance/gdi/golden/spots.json`         | spot values: system colours, stock palette, colour forms, the 16 operations, raw ROP2 values 0-255, dots of widths 0-14, task 95 control bytes                                                                      |
| `app/public/fonts/metrics.json`                   | the metric table of 3.5.1 (6.5.3 format) and the raster rules (below)                                                                                                                                               |
| `app/public/fonts/bitmap/*.bin`                   | raster atlases (origin: `app/public/fonts/bitmap/README.md`)                                                                                                                                                        |
| `tools/fonts-src/windows-outline-metrics.tsv`     | for `tools/make-font-atlases.mjs`: cells, ascents, advances, underline and strike-out of the outline faces at the atlas sizes, and the width of `$7F` in a string with a byte of `$80` or above (`delInHighString`) |

Every output except the atlas files records the machine in `capturedOn`: Windows version, ANSI code
page, `LOGPIXELSY`, and the font-smoothing settings (`SPI_GETFONTSMOOTHING`, type, contrast,
orientation). The atlas formats (6.5.3) have no room for it; `metrics.json` lists the raster atlases
and carries their `capturedOn`, and the outline atlases are drawn from `windows-outline-metrics.tsv`,
whose first line holds it. Inside `build/gdi-capture/run/` the program also leaves the raw `.pix`
files, `metrics.tsv`, `atlases.tsv` and `raster-rules.tsv`, which are useful when a comparison fails.

## What is compared

The comparison ignores `capturedOn`. It skips the suites marked `machine` in `cases.ts` (system
colours follow the Windows theme; outline glyph pixels follow font smoothing, as do the control
bytes Windows draws from an anti-aliased fallback font) and the theme's system colours in
`spots.json`, unless `--all` is given. Everything else must be equal; a difference means Windows
changed GDI (or the program changed) and fails the run. A file is rewritten by `--write` only when
its content changed, so a second run leaves every file as it was. The run ends with a report
(`build/gdi-capture/run/report.txt`, and the job summary on GitHub Actions).

## Another Windows

The committed references were captured on one Windows (`capturedOn` in `metrics.json`). Another
Windows may draw some things differently: the first CI run on GitHub's Windows Server runner
(build 10.0.26100; the references come from 10.0.26300) found four raster cells that the rules
below do not make. The references are the standard, and `windows-policy.ts` decides what a run on
another Windows does. A Windows is named by its version, ANSI code page and `LOGPIXELSY` (font
smoothing only affects outputs that are not compared):

- `--write` refuses to replace the references on another Windows, unless
  `--replace-references-from-other-windows` is given (to move the references on purpose).
- On the references' Windows every difference fails the run.
- On another Windows, the differences must be exactly those recorded for that Windows in
  `other-windows.json` (each output with a fingerprint of what that Windows produces). A new or
  changed difference fails: that Windows changed. A recorded output that no longer differs is
  reported. With no record for that Windows every difference fails, and the report prints the record
  to add once a person has looked at the differences (`build/gdi-capture/run`) and accepted them as
  that Windows' own.
- A raster cell that no rule reproduces no longer stops the run: it is written to `metrics.json`
  with `"ruleHolds": false`, so that `metrics.json` differs and is reported like any other output.

`--as-windows "<version> cp<code page> <dpi>dpi"` judges a run as if it were on that Windows, to try
the policy out.

## Raster fonts

GDI makes every size of a raster face from a few native sizes by whole-number pixel repetition
(independent factors `kx`, `ky`; Fixedsys 40x90 is 8x15 times 5 and 6) and simulates the styles on
the scaled glyph. The program captures the native plain cells, and the styled glyphs at native size,
and checks for **every** face, style and size that the following rules reproduce GDI exactly; a cell
that no rule reproduced would be stored as its own atlas and marked `"ruleHolds": false` in
`metrics.json` (on the references' Windows none is; on Windows Server 10.0.26100 four are, see
"Another Windows"):

- plain: `P(x, y) = native(floor(x / kx), floor(y / ky))`, advance `kx *` native advance;
- bold: `P(x, y) | P(x - 1, y)`, advance + 1 (bytes whose advance is 0 stay 0);
- italic: `P(x - (floor((h - 1) / 2) - floor(y / 2)), y)`, `h` the cell height, advance unchanged;
- underline, strike-out: `P` plus the rows GDI draws under a space, across the byte's advance;
  for the control bytes listed in `lineExceptions` the line has another length (often 0).

At sizes where Windows gives up the raster face (Fixedsys from 122 pt, Courier from 200 pt) it uses
Arial; `metrics.json` says so per size.

## Text strings (task 95) in the raster faces

`tests/conformance/gdi/text-model.ts` reproduces every case of the `text` suite pixel for pixel and
pen for pen from the atlases and these rules, all measured (they are what SH3 has to do). The suite
has strings with zero-width bytes, with and without bytes of `$80` and above, in every style and at
several sizes; random probes of about 12,000 further strings against fresh captures found no
difference outside the cases listed as not modelled below.

- Inside a string of two or more bytes the zero-width bytes `$09 $0A $0D $1C-$1F` paint nothing and
  take no room; every other byte is drawn at x + the sum of the drawn advances before it.
- **Pen (TextWidth):** the sum of the single-byte advances, except that the zero-width bytes count 0
  when the string also contains a byte of `$80` or above. Style plays no part (`$1C "9"` underlined
  moves 16 in Fixedsys 9; `$1C $AA $1D $1D` plain moves 8). The same holds in the outline faces with
  their own per-byte advances (in Consolas `$0D` has advance 0 by itself), except for `$7F` in a
  string that also has a byte of `$80` or above: Windows draws it from a fallback font, and it takes
  that glyph's width, `delInHighString` (Courier New 9: `$E9 $7F` moves 11, not 14). The raster faces
  keep `$7F`'s own advance.
- **Opaque cell:** cell-height high, as wide as the drawn advances plus the style overhang of the
  raster faces: bold 1, italic `floor((h - 1) / 2)`. A string made of zero-width bytes only fills the
  first byte's cell plus that overhang.
- **Italic overhang left out:** when two or more bytes are drawn and the string contains a
  zero-width byte (anywhere, trailing ones included), or contains `$7F` and a drawn byte other than
  `$7F`. Then only the first glyph's overhang is kept where it reaches past the advances: the cell is
  `max(sum of drawn advances, first advance + overhang)` (Fixedsys 72 italic `"A" $0D "B"`: 84).

Not modelled, so cases with them go to the machine-dependent suite `text-control` (the predicate is
`textUnmodelled()` in `cases.ts`); Windows takes these from a fallback font or decides them by
script itemization:

- the bytes Windows draws from an anti-aliased fallback font (`$01-$08 $0B $0E-$1B`) and the five
  undefined Windows-1252 bytes (`$81 $8D $8F $90 $9D`; `$80 $81` measures 7 in Fixedsys, not 8);
- `$0C`, `@` and `$80` in a string that contains one of `$7F $86 $87 $88 $98`, or a zero-width byte:
  they may be drawn from a fallback font with another width (`$80` in Fixedsys 9 takes 7 pixels,
  in Courier 10 5; `@` in Courier 19 4 more than its cell);
- italic strings of two or more bytes with `$86 $87 $88` or `$98` (whether the overhang stays depends
  on the classes of the neighbouring bytes: `"A" $86` loses it, `"[" $86` keeps it);
- a string of zero-width bytes only, in plain, bold or italic, at the requested sizes where Windows 11
  draws it as a thin fallback bar instead of a filled cell (`ZERO_WIDTH_BAR_SIZES` in `cases.ts`,
  measured at every raster size: 29 Fixedsys sizes from 19 to 104 pt, 52 Courier sizes from 3 to
  145 pt; some strings of several zero-width bytes fill the cell there, others do not). The suite
  `text` holds a lone `$0D` at every raster size, which keeps the list exact.

In the outline faces GDI widens the opaque cell by the first and last glyph's ink overhang (1-2
pixels at 8-18 pt, more at large sizes) and draws the TrueType underline below the cell. The port's
cells are the advance boxes; `text-outline` comparisons leave those pixels out.

## Ellipse cases

When SH2 adds `tests/conformance/gdi/cases-ellipse.ts` (exporting `generateEllipseCases():
GdiCase[]`, erasable TypeScript only, no relative imports), `run.mjs` captures those cases too, into
packs named after their suites.

`tests/conformance/gdi/surface.test.ts` holds the port's surface to every compared case. Ellipses
and lines drawn with a pen 2 or more pixels wide are SH2's (ARCHITECTURE.md 3.4 rules 4 and 6);
while `surface/ellipse.ts` or `surface/widepen.ts` is still SH1's stub (its header starts with
`// STUB written by SH1`), their cases wait: they are reported as skipped tests that give their
number and reason. When SH2 replaces a file, its cases are compared from then on.
