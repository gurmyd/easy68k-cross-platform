# Differences introduced by SH3 (text screen, fonts, output device)

The text screen is a port, function by function, of the text half of the original's I/O window
(`simIOu.cpp`): control characters, cursor rules, eager wrap, the single scroll, the shadow array and
its stride, the prompt and its timing behave as in the original, quirks included. The text grid
(columns, rows, cursor positions, pen movement) is the one Windows measures for every font, style and
size, because it comes from the measured table and not from the browser. The glyphs of the raster
fonts (Fixedsys, the default, and Courier) are Windows' own in every size and style.

What differs is listed here. DOC1 merges this file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| Task 95 (text at a pixel position) with the bytes `$01`-`$08`, `$0B`, `$0E`-`$1B` | Windows draws them from another, anti-aliased font: a narrow hollow box, 4 or 5 pixels wide in the default font | An empty cell of the full character width | Their pixels depend on the machine's font smoothing (T2). `$09`, `$0A`, `$0D`, `$1C`-`$1F` and `$0C` are as in the original |
| The five bytes Windows-1252 leaves undefined (`$81`, `$8D`, `$8F`, `$90`, `$9D`) in a text of several bytes | Their width inside a text is not their width alone (`$80 $81` is 7 pixels wide in the default font) | Each has its own width, 0 | Measured by T2, not modelled |
| Task 21 with a colour whose top byte is not 0 (`D1.L` above `$00FFFFFF`) | A Windows system colour or palette colour | The low 24 bits are the colour | trap15-a task 21 (the original's result is unverified) |
| Rewind, Reload, Open or Close after a program changed the font with task 21 | Unverified: the window may keep the cell size and the look of the task 21 font until task 21 is called again (trap15-a §12 item 4) | Every reset restores the Options font, its colour and its cell size | The behaviour trap15-a §12 item 4 recommends |
| Text in the outline fonts (Courier New, Lucida Console, Consolas, and Arial where Windows substitutes it) | Windows widens the opaque background of a text by one or two pixels where a letter's ink reaches beyond its cell | The background is exactly as wide as the characters | The port's glyphs for these fonts are substitutes (R-5); Windows' ink extents are not known |
| An outline font at a size for which no atlas exists (other than 8, 9, 10, 11, 12, 14, 16, 18, 24 and 36 points) | Windows draws the outlines at that size | The glyphs of the nearest atlas are scaled to the measured cell (averaged); they look softer. The grid is the measured one. In the proportional substitute (font numbers 5 and 7) the widths of the single letters are scaled too, so the pen position after task 95 can differ by a pixel or two | 3.5.1: text pixels come from data files only, the same in every browser |
| A font file or the metric table cannot be loaded (a file is missing from the server) | Cannot happen: the fonts are part of Windows | Text has the default grid (8 x 15 pixel cells) and empty cells until the files are there; a face whose atlas is missing or damaged has empty cells | The fonts are separate files in the port |
| A request for an output size above 4096 x 4096 | Accepted up to 65535 x 65535 | Clamped; the message area says `Output window size limited to 4096 x 4096` and task 33 reports the clamped size | 2.5 |
