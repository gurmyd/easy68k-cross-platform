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
| `tests/conformance/gdi/golden/nibs.json`          | the nib of every pen width 2-255 and the widened paths of a few tie directions (below, "Pen nibs")                                                                                                                  |
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

Under each differing output the run prints what differs (`describe-difference.ts`): for an atlas
the glyphs (as byte ranges) and advances, for a JSON file the paths with both values, for a pack the
cases, for the TSV the rows. The report repeats it, and the captured files are copied to
`build/gdi-capture/run/differences/<path>`, so that a CI log is enough to judge another Windows.

The second CI run (run 44913261966, 21 Nov 2026) on 10.0.26100 found 24 outputs that differ:
`metrics.json`, `spots.json`, and the raster atlases of Courier 9x16, 12x20 and 15x25 and of
Fixedsys 8x15 in all five styles, and the underline and strike-out atlases of Courier 8x13; the
`text` suite was equal. That run printed no details yet; the next one does.

### What another Windows may draw differently: the other-font bytes

The third run (run 44919519853, gate I1 round 2) printed the details, and its capture (the
`gdi-capture-run` artifact) was reviewed with `--from`. All 24 outputs differed only in what the
control bytes `$00-$08 $0B $0E-$1B` draw. In the raster faces Windows takes these bytes from a
fallback font, not from the face (trap15-b 6.7, "a narrow box"), and the fallback font depends on the
Windows: Windows 11 10.0.26300 paints an anti-aliased box 4 pixels wide, Windows Server 10.0.26100 a
box 6 pixels wide without anti-aliasing. So their glyph pixels in the atlases differ (and with them
the atlases' `glyphWidth` and `blankBytes` in `metrics.json`), so does the length of their underline
(`lineExceptions`) and the cell they fill between "A" and "B" (`spots.json` `controlBytes`), and four
italic cells were marked `"ruleHolds": false` because the capture let these unsheared boxes decide
whether the italic rule holds. Every advance (theirs included), every pixel of every other byte, the
metric table, the primitives and every compared text suite were equal.

The references never promised those pixels: the port draws these bytes blank (they are the atlases'
`blankBytes`), and the text cases with them are the machine-dependent suite `text-control`. So the
comparison now leaves them out (`machine-dependent.ts`, `OTHER_FONT_BYTES`), as it leaves out font
smoothing and the theme:

- an atlas is compared by its cell, all 256 advances and the pixels of every other byte;
- `metrics.json` without the atlases' `glyphWidth`, and without these bytes in `blankBytes` and
  `lineExceptions`; the metric table, the rules, every cell's native atlas, factors, line rows and
  `ruleHolds` stay;
- `spots.json` without the `cellRight` of these bytes (the pen after them stays);
- `capture.cpp` decides whether a raster rule holds from the bytes the face draws
  (`otherFontByte()`); on 10.0.26300 this leaves every output byte for byte as it was.

An output that is equal only without these bytes is printed as `same*`, with what differs in them, so
the log still shows another Windows' fallback font. `--all` compares them too. On another Windows the
run is therefore green when everything the references guarantee is equal, and red when anything else
differs. `other-windows.json` records 10.0.26100 as reviewed with no accepted difference.
`tests/conformance/gdi/machine-dependent.test.ts` checks all this on every system against files of
that run's capture (`tests/conformance/gdi/golden/windows-10.0.26100/`).

`--from <dir>` judges a capture made elsewhere instead of capturing (any system; it never writes the
references; the report goes to `build/gdi-capture/review/`). To review a CI run:

    gh run download <run id> -n gdi-capture-run -D build/gdi-capture/ci
    node tests/oracle/gdi-capture/run.mjs --from build/gdi-capture/ci

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
cells are the advance boxes; `text-outline` comparisons leave those pixels out. How far
(`outlineWidening` in `text-model.ts`, measured with fresh captures in gate I1 round 3): in plain and
bold a tenth of the cell height, at least 3 pixels, on each side; in italic one pixel more on the left
and on the right up to 0.35 of the cell height (Lucida Console 29 pt italic: 13 of 39 rows). In those
pixels only the fill colour or the smoothed edge of the ink (a blend of background and font colour)
may appear; in the rows of an underline or strike-out outside the cell only the fill colour. The
machine-dependent suite `text-outline-italic` holds italic strings at the sizes with the widest
overhang.

## Text strings in the monospaced outline faces

`text-model.ts` (`layoutOutlineText`, `outlineCells`) gives the cell and the pen of a Courier New,
Lucida Console or Consolas string; the suites `text-outline` and `text-outline-zero` are checked
against it. Measured against fresh captures (gate I1, review round 2, defect 14):

- **Pen:** the rule of the raster faces with the per-byte advances: every byte has the cell width,
  except Consolas `$0D`, which has 0 at every size and style (`OUTLINE_ZERO_ADVANCE`), and `$7F` in a
  string that also has a byte of `$80` or above, which takes `delInHighString`.
- **Cell:** the sum of the drawn widths. A zero-width byte takes none, even alone (a string of
  zero-width bytes only fills no cell, only a sliver of the widening), and `$7F` always takes
  `delInHighString`, with or without a byte of `$80` or above (Courier New 9 `"A" $7F "B"`: cell 18,
  pen 21).
- Not modelled: a string that draws only `$7F` gets the fallback font's cell, which is one row lower
  than the face's in Courier New 8 and Lucida Console 10 (its height is not measured); such cases are
  captured but not compared.

## Ellipse cases

When SH2 adds `tests/conformance/gdi/cases-ellipse.ts` (exporting `generateEllipseCases():
GdiCase[]`, erasable TypeScript only, no relative imports), `run.mjs` captures those cases too, into
packs named after their suites. SH2's suites are `ellipses`, `ellipses-large` and `ellipses-wide`; their
packs (`tests/conformance/gdi/golden/ellipses*.pixpack.gz`) are outputs of `run.mjs` like every other
pack and live with them in T2's `golden/` (ARCHITECTURE.md section 8: `conformance/gdi/**` is T2's
except `cases-ellipse.ts`). SH2 owns the case list; a change to it is followed by
`npm run oracle:gdi -- --write`, not by an edit of a pack.

## Pen nibs

`gdi-capture nibs <dir>` writes `nibs.json` (docs/requests/SH2-gdi-nibs.md): for every pen width
2-255 the polygon GDI makes of the pen, its _nib_, which `app/src/core/sim-host/surface/tables/pens.ts`
holds. Measured as SH2 measured it: `GM_ADVANCED` with a world transform of 1/16, so that the path
keeps GDI's 28.4 coordinates; `CreatePenIndirect(PS_SOLID, 16 * w)`; for 360 directions `MoveToEx(0,
0)`, `LineTo(16000 cos a, 16000 sin a)` inside a path, `WidenPath`, `GetPath`. The widened path is `P0 +
offset, cap..., P0 - offset, P1 - offset, cap..., P1 + offset`; the nib is the union of the cap
vertices at P0 over the directions, as `"x,y"` pairs by increasing angle from -180 degrees (the
format of `penNib()`). The cap at P1 is not used: relative to P1 many directions give vertices one
sixteenth further out (width 2 at 1 degree: `8,16` and `16,0` where the nib has `7,15` and `15,0`).
`ties` records the whole widened path of the integer directions at which SH2's review found the
port's wide lines one pixel or more off (width 2 `(-1,2)`, 7 `(-16,39)`, 9 and 12 `(-7,17)`, 11
`(-13,31)` and their opposites): a segment from `(0, 0)` to `16 * (dx, dy)`, each point as
`x,y,type` with GetPath's type (6 = move to, 2 = line to, 3 = line to and close).

`tests/conformance/gdi/nibs.test.ts` holds `pens.ts` to `nibs.json` on every system. On this
reference Windows all 254 nibs equal `pens.ts`.

`tests/conformance/gdi/surface.test.ts` holds the port's surface to every compared case. Ellipses
and lines drawn with a pen 2 or more pixels wide are SH2's (ARCHITECTURE.md 3.4 rules 4 and 6);
while `surface/ellipse.ts` or `surface/widepen.ts` is still SH1's stub (its header starts with
`// STUB written by SH1`), their cases wait: they are reported as skipped tests that give their
number and reason. When SH2 replaces a file, its cases are compared from then on.
