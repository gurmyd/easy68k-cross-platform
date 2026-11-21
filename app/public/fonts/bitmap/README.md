# Raster-font atlases (Fixedsys, Courier)

**Origin.** Every `.bin` file in this folder was captured from Microsoft Windows 11 (build 10.0.26300)
by `tests/oracle/gdi-capture` (`npm run oracle:gdi`): the program asks Windows GDI for the raster
fonts *Fixedsys* (`vgafix.fon`) and *Courier* (`coure.fon`), which are part of Windows, draws every
byte `$00`-`$FF` into memory, and stores the two-colour pixels. The glyph shapes are therefore
Microsoft's. They are shipped so that the simulator's default output font is pixel-identical to the
original's, as decided by the project owner (ARCHITECTURE.md 10.2, decision O-3: "Ship glyph
atlases captured from the Windows raster fonts Fixedsys and Courier? Yes, with their origin stated;
reconsider on any objection").

**Replacing them.** The atlases are data, not code. To replace them, put other atlases of the same
format and cell sizes in this folder (or delete it; the port then falls back to the outline atlases)
and keep the file names listed in `../metrics.json` under `raster.atlases`. No code needs to change.

**Contents.** One atlas per native cell of each face, plain, and the four styles at that native
size. GDI makes every other size and style from these by whole-number pixel repetition and its own
bold, italic, underline and strike-out simulation; `../metrics.json` (`raster.rules`, `raster.cells`)
states those rules, and the capture program checked them against Windows for every size and style
(none failed). Format: ARCHITECTURE.md 6.5.3 (`E68F`, version 2, 1 bit per pixel).

Bytes that Windows does not draw from the raster font itself (the control bytes it draws from an
anti-aliased fallback font) are stored blank and listed as `blankBytes` in `../metrics.json`.
