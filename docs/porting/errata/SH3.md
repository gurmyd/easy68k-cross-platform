# Errata of SH3 (Text screen, fonts, output device)

What SH3 found while writing `app/src/core/sim-host/text/`, `fonts/` and `io.ts`: where
`docs/ARCHITECTURE.md` or a spec is silent, ambiguous or cannot be met as written, what the
repository does, and why. Entries under **Contract** concern declarations other packages compile
against; none of them changes `app/src/contracts/`.

T2 measured Windows while SH3 was written and recorded what it found in
`docs/porting/errata/T2.md` and `tests/oracle/gdi-capture/README.md` ("what SH3 has to do").
Entries 5-9 and 14 say how SH3 took that up.

## Contract

### 1. `OutputDeviceDeps` has no way to report the size-limit message (2.5, 3.3.1)

- Says: 2.5, "larger requests are clamped and reported in the message area as `Output window size
  limited to 4096 x 4096`". The requested size reaches only `OutputDevice.setWindowSize`; its
  `Deps` (`surface`, `text`, `show`, `bringToFront`, `setFullScreen`, fixed by W1) have nothing
  that writes to the message area, and `Surface.resize` has no return value (SH1 erratum 8 says the
  message is the caller's).
- Does: `OutputDevice`'s constructor takes `OutputDeviceDeps & OutputDeviceExtras`, where
  `OutputDeviceExtras` is `{ message?: (text: string) => void }` (declared in `io.ts`). A caller
  that passes exactly the contract's object compiles and works; the message is then not shown.
  The text is built from `MAX_SURFACE` of `surface/surface.ts`.
- Proposed: add `message: (text: string) => void` to `OutputDeviceDeps`; SH8's `session.ts` passes
  the writer of the simulator message area.

### 2. Who runs the prompt timer (3.5.2, 3.5.3, 4.5.3)

- Says: `TextScreenDeps.scheduler` is commented "500 ms prompt timer" and 3.5.3 says "the prompt
  timer runs on the injected `Scheduler`"; the table of 4.5.3 lists `Input prompt | 500 ms |
  TextScreen.promptTick()` among the `SoftTimer`s the controller checks.
- Does: `TextScreen` runs the timer itself with `deps.scheduler.setTimer(500, ...)`, re-armed at
  every tick. It follows the original's `TTimer`: switching it on while it is on changes nothing,
  switching it on starts a full period. `promptTick()` is public for tests and is what the timer
  calls. **The controller must not tick the prompt as well**, or it blinks at double speed.
- Proposed text for 4.5.3: drop the "Input prompt" row, or say "runs inside `TextScreen` on the
  `Scheduler`, not on a `SoftTimer`".

### 3. `TextScreenDeps.show` is called for every character (3.5.2)

- Says: `show: () => void; // make the Output panel visible`.
- Found: the original's `charOut` begins with `if (simIO->Visible == false) simIO->Show();`
  (`simIOu.cpp:814-815`). `TextScreen` cannot know whether the panel is visible, so it calls
  `show()` at every `charOut`.
- Consequence for the composition root: `show` must be cheap, must do nothing while the panel is
  visible, and must not move the focus when it does nothing (the original calls `Show()` only for a
  hidden window). `OutputDeviceDeps.show` (`ioShow`, once per keyboard-input task) is the call that
  is allowed to bring the panel forward.

### 4. The class and the loader of `fonts/atlas-provider.ts` (3.5.1; W1 erratum 6)

- Says: "`fonts/atlas-provider.ts` implements `GlyphProvider`"; no class name, no constructor.
  `core/` may not use `fetch`.
- Does: `new AtlasGlyphProvider(load, options?)`, where `load: FontFileLoader` is
  `(path: string) => Promise<Bytes | null>` for a path below `app/public/fonts/` (`metrics.json`,
  `scalable/index.json`, `bitmap/Fixedsys-15.bin`, ...); `null` means "no such file". The
  composition root supplies the loader (a `fetch` relative to the page). The synchronous core is
  `FontSet` (`fonts/font-set.ts`); `fontSetFromFiles(files)` builds one from files in memory.
- `ready` rejects only when `metrics.json` is missing or unreadable (or `scalable/index.json` is
  there but unreadable). Until `ready` resolves, and after a rejection, the provider answers with
  the cell of the default font (8 x 15) and empty glyphs, so that the host calls of the engine's
  start-up reset (3.3.2) find a usable grid. A missing or damaged atlas only leaves its face
  without glyphs; `provider.problems` says which.

### 5. `GlyphProvider` and `SurfaceApi.textOut` cannot say how wide the opaque box of a text is (3.4, 3.5.1)

- Found by T2 (its erratum 4 and the README of the capture): Windows' simulated bold and italic of
  the raster faces make the opaque box of a text wider than the sum of the advances - by 1 pixel
  for bold, by `floor((h - 1) / 2)` for italic (`tmOverhang`) - while the pen moves by the advances
  alone. `textOut(x, y, glyphs, extent, ...)` has the pen movement (`extent`) but no box width, and
  `GlyphProvider` has no overhang.
- Does, without a contract change:
  - SH1's surface fills the sum of the advances of the glyphs it is given (SH1 erratum 3).
    `TextScreen` therefore appends **one glyph without ink, as wide as the overhang**, to the
    glyphs of every text in such a font, and passes the true pen movement as `extent`.
  - The overhang comes from an optional method beside the contract, `StyleOverhang.textOverhang(font)`
    (`fonts/types.ts`), which `AtlasGlyphProvider` and `FontSet` have. `TextScreen` calls it when
    the provider has it and assumes 0 otherwise (the stub provider of `stub-host.test.ts`).
- Proposed: `GlyphProvider.textOverhang(font): number`, and a sentence in 3.4 that the opaque box
  is as wide as the advances of the glyphs given.

## File formats (6.5.3) and T2's files

### 6. Atlas: the size of the version field and the bit order

- Says: "bytes `E68F`, version 2, cell width (u8), ...": every later field has a size, the version
  has none; "rows of 1-bit glyphs padded to whole bytes" without a bit order.
- Does: the writer (`encodeAtlas`) writes the version as one byte and the leftmost pixel of a row as
  bit 7 of its first byte. T2's files are the same. The reader (`decodeAtlas`) also accepts a
  version of two or four bytes (little-endian), told apart by the file length.
- Proposed text: "version (u8) = 2", "leftmost pixel in the highest bit".

### 7. `metrics.json`: style keys, face entries, and what T2 added

- Says: `"<style>": [[colWidth, rowHeight, faceIndex], ...]` without naming the keys.
- T2 writes `plain`, `bold`, `italic`, `underline`, `strikeOut` (the names of `FontSpec`), and so
  does SH3's writer. The reader also accepts, without regard to letter case, the letters of the
  atlas names (`b`, `i`, `u`, `s`) and a few other spellings; any other key is refused with a
  message that names it. A style that is absent has the plain cells. An entry of `faces` is the
  face name, or an object with a `name`.
- T2's additions (its erratum 1 items 2-5), all read when present and not required: `faceKinds`,
  `raster.atlases` (file, face, style, `blankBytes`), `raster.cells` (the rule of every raster
  cell), and the separate file `scalable/index.json` (file, face, style, and for plain atlases
  `underline` and `strikeOut` as `[first row, rows]`). Other keys (`about`, `raster.rules`, sizes,
  sources) are ignored.

### 8. How the provider learns which atlas files exist

- Says: nothing. A web page cannot list `app/public/fonts/bitmap/`.
- Does: `options.atlasPaths` of the provider if the caller gives it. Otherwise the raster atlases
  are the files of `raster.atlases` and the outline atlases the files of `scalable/index.json`
  (T2's lists; a listed file that is missing is reported in `problems`). Face and style come from
  the lists, the cell size from the atlas header; file names are not interpreted, so
  `Courier_New-16x8-b.bin` needs no rule.
- For a font set that has only what 6.5.3 itself describes (no lists) - the `plain` layout of the
  synthetic fonts - the provider derives the names 3.5.1 and 6.5.3 give
  (`expectedAtlasPaths`: `bitmap/<face>-<cell height>[-<style>].bin` for Fixedsys and Courier,
  `scalable/<face>-<cell height>[-<style>].bin` at the point sizes of 3.5.1 for the others) and
  skips those that do not exist.

### 9. Glyphs of the raster faces: Windows' rules, not styled atlases (3.5.1)

- Says: "takes the atlas of the face the table names, in the requested style, whose cell is nearest
  to the measured cell", resampled "by whole-number pixel repetition for raster faces".
- T2 found (its erratum 1 item 2) that Windows makes every raster cell from a few native bitmaps by
  whole-number repetition with independent factors and applies the style **after** enlarging: bold
  is `P(x, y) | P(x - 1, y)` with the advance one more, italic shears by
  `floor((h - 1) / 2) - floor(y / 2)`, underline and strike-out are rows across the advance.
  Enlarging a styled native atlas gives other pixels (a bold twice as fat).
- Does: when the table has `raster.cells`, a glyph of a raster face is made by that rule from the
  native atlas (`ruledGlyph` in `font-set.ts`), with the bytes of `blankBytes` empty. An atlas that
  `raster.cells` names for the cell is used only when the native one is not loaded. Without
  `raster.cells`, and for every outline face, the nearest-atlas rule of 3.5.1 holds (entry 11).
- Checked against T2's files and T2's own reader (`tests/conformance/gdi/fonts.ts`, which
  reproduces GDI's text references): for all 1,610 raster entries of `metrics.json` (two names,
  five styles, the sizes at which Windows uses the raster face) the cell is the table's, and the
  102,235 glyphs compared (every byte for cells up to 45 pixels high, eleven bytes above) are equal
  pixel for pixel and in advance. A scratch run, not a committed test: SH3's tests may not depend
  on T2's files.

### 10. Underline and strike-out of the outline faces (3.5.1 last bullet)

- Says: "drawn by the atlas tool at the positions the metric capture records".
- T2 stores no such atlases (its erratum 1 item 3): the line of each plain atlas is in
  `scalable/index.json`, and Windows draws the TrueType underline **below** the cell at some sizes.
- Does: an underlined or struck-out glyph of an outline face is the plain glyph plus a line of full
  coverage across its advance at the listed rows; a line below the cell makes the glyph that much
  higher than the cell (the surface's opaque box grows with it, and the line covers the extra
  rows). At a size without an atlas the line is scaled with the glyph. A `-u` or `-s` atlas, if a
  set has one, is used instead.

## The provider (3.5.1)

### 11. "Nearest" atlas, and resampling

- Does: the atlas with the same cell if there is one. Otherwise, for a raster face without rules,
  the largest atlas of which the measured cell is a whole multiple in both directions; otherwise
  the smallest difference in height, then in width, then the larger atlas. Resampling is
  whole-number repetition for a raster atlas with whole factors, area averaging otherwise.
- A style without an atlas for the face uses the face's plain atlas; a face without any atlas has
  empty glyphs of the measured cell.
- Known limit (T2 erratum 4, second item): the advances of the proportional face (Arial, behind
  `Lucida Sans Typerwriter` and `Terminal`) are known at the atlas sizes only; at other sizes they
  are scaled, so the pen after task 95 in such a font can differ from Windows by rounding.

### 12. "A name that is not in the table is the Options font's name"

- Found: `GlyphProvider` has no access to the Options font, and task 21 never produces an unknown
  name (an unknown font number keeps the Options font's name inside `TextScreen`). An unknown name
  can therefore only be the Options font's own, from a settings file.
- Does: a name that is not in the table (exact, then without regard to letter case, as Windows
  compares font names) uses the entries of `Fixedsys`, the default Options font
  (`options.fallbackName` changes it); if the table lacks that too, its first name.

### 13. A font with more than one style flag

- Says: `FontSpec`, "at most one is set (trap15-a task 21)"; the table has five single styles.
- Does: `styleOf` takes the last of bold, italic, underline, strike-out that is set, as the highest
  bit wins in task 21. (Relevant if the Options font dialog lets the user tick several.)

## TextScreen (3.5.2, 3.5.3; trap15-a, trap15-b)

### 14. Task 95: which bytes paint (3.5.1 last sentence, trap15-b §6.7)

- Says: 3.5.1, "bytes below `$20` paint nothing but count one cell in the extent" (the PORT rule of
  trap15-b §6.7).
- Measured (trap15-b §6.7 itself, confirmed and extended by T2): only `$09 $0A $0D $1C-$1F` take
  no width, and only inside a text of two or more bytes; `$0C` is the font's solid block in a full
  cell; a text of zero-width bytes only fills one cell; with underline or strike-out a zero-width
  byte that is not among the trailing ones does not count in the extent; the italic overhang
  (entry 5) is left out when the text, without its trailing zero-width bytes, has two or more
  bytes and one of them is zero-width or `$7F`.
- Does: exactly those rules (`TextScreen.drawText`), because T2's font data and T2's GDI references
  make them reproducible pixel for pixel. The usual case, a text that ends in CR, LF, is the same
  under either rule.
- Not reproduced (T2 lists them as machine dependent): the bytes Windows draws from an
  anti-aliased fallback font (`$01-$08 $0B $0E-$1B`) are empty cells of their single-byte width
  instead of a narrow hollow box; the five undefined Windows-1252 bytes; the 1-2 pixels by which
  GDI widens the box of an outline font.

### 15. `fontAssign(target, source)`

- Says: "simulator reset: back to the Options font and colour"; trap15-a §12 item 4 leaves open
  what real EASy68K restores and recommends "on every reset, restore the Options font, colour and
  cell metrics on both surfaces".
- Does: for target 1 or 2 (`FontTarget.IoBackBuffer`, `IoWindow`) with source 101
  (`FontSource.IoDialog`): font and colour of the Options font, and the cell is measured again
  (`setTextSize()`); the cursor is not placed again (the reset has just homed it). Everything else
  is ignored.

### 16. `resetToStartup()` and the Options font

- Says: 3.3.2, "font and colour = the Options font".
- Does: the Options font itself goes back to the default of a fresh installation (Fixedsys 9,
  white, no style), which is the state "right after start, before a file is loaded"; step 4 of the
  cold start (4.7.1) then applies the saved font with `setOptionsFont`. The `state` object stays
  the same object.

### 17. The text colour

- Says: trap15-a task 21, "values with a non-zero top byte are VCL/GDI special colours;
  UNVERIFIED - the port should use the low 24 bits".
- Does: that, for task 21 and for the Options colour; `TextState.fontColor` holds the masked value.
- Note for the spec owner: the VCL sets the text colour of a canvas through the same
  `ColorToRGB` that trap15-b §4.6 describes for pens and brushes, so the rule there very probably
  applies to the font colour too. SH1's `textOut` already applies that rule to the colour it is
  given (SH1 erratum 3); passing the unmasked value from `TextScreen` is then a one-line change.

### 18. Three places where the original would fail and the port does not

- `gotorc`, wrap branch: with a cell wider than the canvas the original's `doCRLF()` -> `gotorc()`
  recursion never ends. The port wraps once.
- `scroll`: with no text row at all (a cell higher than the canvas) the original's unsigned loop
  bound `textRows-1` wraps around. The port moves the pixels and leaves the shadow array.
- `setTextSize`: a cell width or height of 0 from the provider is taken as 1.
- None is reachable with a font Windows has (the largest cell of the table is smaller than the
  smallest canvas).

### 19. Task 25 with a rectangle wider than the grid (addition to trap15-a task 25)

- Found: `scrollRect` is tested against the allocated grid only (`c+w < 256`), and its loops
  address `text[i*textCols + j]`. With `w > textCols` the columns beyond `textCols` are the bytes
  of the following rows, so the "up" loop moves most bytes twice: row 0 takes row 1, every later
  row takes the row **two** below it, while the picture moves by one row. The port does the same
  (the loops are ported literally); `text-screen.test.ts` has the case.

### 20. What repaints

- `textOut` ends with the original's `this->Repaint()` when double buffering is off: the port calls
  `surface.formPaint()`, also for an empty text. `inputEcho` and `inputBackspace` call
  `surface.formPaint()` themselves (the engine's shim folds the original's `Invalidate()` into
  these two host calls). `OutputDevice.invalidate()` is `surface.formPaint()` as well.
- The output log gets one `outputLog` call per byte, as the original writes and flushes per
  character.

### 21. New for trap15-a §12 item 2 (answered by T2): bold changes the grid

- Bold is one pixel per column wider in the raster faces: Fixedsys bold has cells of 9 x 15 and
  71 columns on 640 pixels. Nothing in `TextScreen` is special for it - the cell comes from the
  metric table - but tests and hand-outs that assume 80 columns after task 21 with bit 0 are wrong.

## Tests

### 22. Where the browser check lives (9.2, "the same text gives the same pixels under Node, Chromium and WebKit")

- Unit tests have no DOM and `tests/e2e` belongs to a later package, so the check is the script
  `app/src/core/sim-host/text/check-text.mjs` (wave-zero convention). It runs the two scenarios of
  `text/pixel-scenario.ts` under Node, in Chromium and in WebKit and compares pixels;
  `pixel-scenario.test.ts` holds the Node half with fixed hashes. `docs/requests/SH3-text-check.md`
  asks for the root script and the CI step.

### 23. Test doubles of this package

- `text/testing.ts`: `TestSurface` (a `SurfaceApi` for tests; pixels, lines and rectangles drawn
  plainly, not GDI), `ManualScheduler`, `createTextRig()`. `fonts/synthetic.ts`: a complete
  synthetic font set, by default in the layout of T2's files (native raster atlases with rules,
  outline atlases with their index), optionally with only what 6.5.3 describes. Neither is imported
  by the application. Other packages may use them in tests.
