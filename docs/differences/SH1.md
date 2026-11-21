# Differences introduced by SH1 (drawing surface)

The surface draws the pixels of the output window with the port's own code, following the rules
measured on Windows GDI (`docs/porting/trap15-tasks-60-up.md` §4-§7). What a 68000 program reads
back - task 83 pixels, task 96 pen positions, the result of a flood fill - is meant to equal the
original in every case below unless the row says otherwise. DOC1 merges this file into
`docs/DIFFERENCES.md`.

| Where | Original | Port | Why | Can a program observe it? |
|---|---|---|---|---|
| Windows system colours (a colour value with bit 31 set, for example `$80000005`) | `GetSysColor`: the colour of the user's Windows theme | the fixed colours of a default Windows 11 desktop | there is no Windows theme to ask | Only if the original ran under a theme that is not the default |
| Flood fill (task 89) in a drawing mode other than 4 | combined through the mode last used on that canvas, which depends on what was drawn just before and on window messages in between (trap15-b §5.4, item V4) | always combined through the current mode | the original is not deterministic here; the port takes the case the original shows right after a pen primitive | Yes, where the original happens to fill in Copy mode instead |
| The window while double buffering is off | drawn separately from the back buffer, each call a second time. `LineTo` on the window starts at the window canvas's own pen position, and a flood fill reads the window's own pixel, so the window can show something else than the back buffer (after an input prompt moved the window pen; while the window is partly covered) | the screen shows the back buffer | one picture (ARCHITECTURE.md 3.4 rule 9; trap15-b §4.1, task 89) | No. Task 83 reads the back buffer in the original too. The picture on screen can differ in those two rare cases |
| The input prompt (`_`) and its erasing blank | painted on the window and left there until something is drawn over the cell or Windows repaints the window | a cell laid over the picture, removed at the next drawing call, task 94 or mode 16 | ARCHITECTURE.md 3.5.3 | No (task 83 never sees the prompt in either) |
| Size of the surface | any size up to 65535 x 65535 that Windows grants | each side at most 4096 (`MAX_SURFACE`) | memory; ARCHITECTURE.md 2.5 | Yes: task 33 with `D1.L = 0` then returns the clamped size |
| Ellipses and lines of a pen 2 or more pixels wide (until SH2 delivers) | GDI's shapes | stubs: an ideal ellipse; the band of a wide line without its round caps | wave order (ARCHITECTURE.md 9.2, 9.4) | Yes, pixel by pixel, until wave 2 |
| Round dots of pens wider than 14 pixels (one-point rectangles, zero-length lines) | GDI's shapes | a plain disc of the pen's diameter (`docs/porting/errata/SH1.md` entry 10); the dots of the widths 2-14 are GDI's, pixel for pixel | not measured; the GDI capture stops at width 14 | Possibly, at single edge pixels of such a dot |
