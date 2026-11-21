# Errata of SH3 (Text screen, fonts, output device)

What SH3 found while writing `app/src/core/sim-host/text/`, `fonts/` and `io.ts`: where
`docs/ARCHITECTURE.md` or a spec is silent, ambiguous or cannot be met as written, what the
repository does, and why. Entries under **Contract** concern declarations other packages compile
against; SH3 never edits `app/src/contracts/` itself. Gate I1 took up entries 1, 4 and 5 there
(errata W1.md entry 11).

T2 measured Windows while SH3 was written and recorded what it found in
`docs/porting/errata/T2.md` and `tests/oracle/gdi-capture/README.md` ("what SH3 has to do").
Entries 5-9, 14 and 25-27 say how SH3 took that up; entry 27 gives the result against T2's GDI
text references.

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
- **Resolved at gate I1:** `OutputDeviceDeps.message?` is in the contract (optional, so that a
  caller without it still compiles), `OutputDeviceExtras` is gone from `io.ts`, and SH8's
  `core/run/compose.ts` passes the writer of the message area. `io.test.ts` covers both the message
  and its absence.

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
- Does: `new AtlasGlyphProvider(load, options?)`, where `load: FontFileLoader` (declared in the
  contracts since gate I1; `atlas-provider.ts` re-exports it) is
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
  - The overhang comes from `textOverhang(font)`, which `AtlasGlyphProvider` and `FontSet` have.
    `TextScreen` calls it when the provider has it and assumes 0 otherwise (the stub provider of
    `stub-host.test.ts`).
- Proposed: `GlyphProvider.textOverhang(font): number`, and a sentence in 3.4 that the opaque box
  is as wide as the advances of the glyphs given.
- **Resolved at gate I1:** `GlyphProvider.textOverhang?(font)` is in the contract as an optional
  member, and the comment of `SurfaceApi.textOut` says that the box is the advances of the glyphs
  given. The local interface `StyleOverhang` of `fonts/types.ts` is gone. What remains local is
  `FallbackGlyphs.delInHighText(font)` (entry 25).

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
  are estimated (entry 26), so the pen after task 95 in such a font can differ from Windows.

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
- Measured (trap15-b §6.7 itself, confirmed and extended by T2, errata T2.md section 2, "Additions
  to 6.7"; corrected by T2 after its first verification, and this entry with it):
  - only `$09 $0A $0D $1C-$1F` take no width, and only inside a text of two or more bytes: they
    paint nothing and the bytes after them are drawn where the drawn bytes before them end;
    `$0C` is the font's solid block in a full cell;
  - the pen moves by the advances of all bytes, the zero-width ones included, **except that the
    zero-width bytes count nothing when the text also has a byte of `$80` or above**, in every
    style (the first version of this entry, after T2's first version, had "with underline or
    strike-out" as the condition; fresh captures showed the condition is the high byte);
  - the opaque box is as wide as the advances of the drawn bytes plus the style overhang of the
    font (entry 5); a text of zero-width bytes only fills the cell of its first byte plus that
    overhang (bold `$0A` in Fixedsys 9: 10 columns);
  - with italic, the overhang is left out when two or more bytes are drawn and the text has a
    zero-width byte (trailing ones included) or has `$7F` and a drawn byte other than `$7F`: the
    box is then the wider of the advances and the first advance plus the overhang;
  - `$7F` in an outline face, in a text with a byte of `$80` or above: entry 25;
  - the fixed-pitch outline faces (Courier New, Lucida Console, Consolas) build the box another
    way: entry 28.
- Does: exactly those rules (`TextScreen.layout`, used by `drawText`; `charOut`, the echo and the
  prompt hand the surface one byte and take the same path), because T2's font data and T2's GDI
  references make them reproducible pixel for pixel; entry 27 has the numbers. The usual case, a
  text that ends in CR, LF, is the same under either rule.
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
- Found: the original assigns the register to the canvas font (`Font->Color = (TColor)c`,
  `simIOu.cpp:935-994`), and the VCL selects a font colour into the device context with
  `SetTextColor(Handle, ColorToRGB(Font.Color))` - the same `ColorToRGB` that trap15-b §4.6
  establishes from the binary for pens, brushes and pixels, followed by the same GDI handling of a
  palette index. The rule of §4.6 therefore applies to text as well: a set bit 31 is a system
  colour, a set bit 24 an entry of the stock palette, any other top byte is ignored. Using the low
  24 bits would draw `$80000005` (system colour 5, white) as `$000005`, nearly black.
- Does (changed at gate I1 from the first version, which masked the colour): `TextState.fontColor`
  and `optionsFontColor` hold the 32 bits as given, unsigned (`textColor` in `text-screen.ts`), and
  SH1's `textOut` resolves the colour with the rule of §4.6 when it draws (SH1 erratum 4). Task 21,
  the Options colour, the echo and the prompt all take that path; `text-screen.test.ts` has nine
  colours with a non-zero top byte.
- Verified (gate I1 round 3): T2 captured the ten colours of `docs/requests/SH3-gdi-text-colour.md`
  (`$01000005 $0100000D $01000014 $0100FF05 $7F000007 $02336699 $80000005 $80000008 $8000000F
  $FF336699`, Fixedsys 9, "AB"; errata T2 section 1 item 15) in the suite `text`, and Windows
  agrees with the rule of §4.6 in all of them. `gdi-references.test.ts` replays them with every
  other case of `text` and the port draws all ten pixel for pixel as Windows does (entry 27). The
  request is done.

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
  asked for the root script and the CI step; gate I1 added both (`npm run check:text`, job
  `browser-checks` on Ubuntu, macOS and Windows).
- Since gate I1 the check also runs both scenarios on the real `Surface` with the fonts of
  `app/public/fonts` (fetched by the browsers as the application fetches them), and replays the
  four text suites of T2's GDI capture (entry 27) in each browser, which must give exactly the
  pictures and pen positions of the Node run. Nothing in it depends on the operating system or on
  the speed of the machine: the fonts are data files, the comparisons are of whole numbers, and no
  step waits for a time.

### 23. Test doubles of this package

- `text/testing.ts`: `TestSurface` (a `SurfaceApi` for tests; pixels, lines and rectangles drawn
  plainly, not GDI; colours resolved with SH1's `resolveColor`, as the real surface does),
  `ManualScheduler`, `createTextRig()`. `text/gdi-replay.ts`: replays a case of T2's GDI capture
  on the real `OutputDevice`, `TextScreen` and `Surface` (entry 27). `fonts/synthetic.ts`: a complete
  synthetic font set, by default in the layout of T2's files (native raster atlases with rules,
  outline atlases with their index), optionally with only what 6.5.3 describes. None of them is
  imported by the application. Other packages may use them in tests.

## Gate I1

### 24. `OutputDevice.setWindowSize` without `setupWindow()` and `WindowSizeChecked()` (trap15-b §4.3)

- Original: `setWindowSize` (`simIOu.cpp:187-233`) ends with `setupWindow()`, which lays the window
  out again in its windowed or full-screen form (in full screen it switches the display to the new
  size), and `Form1->WindowSizeChecked()`, which sets the radio marks of the size menu.
- Does: neither. The Output panel lays the surface out from its size on every frame, in a window
  and in full screen, and the size menu reads its marks from the same size; so a program sees the
  same thing. The full-screen flag is the engine's (`host.setupWindow(fullScreen)`): `OutputDevice`
  passes it on in `setupWindow` only, and must not send a remembered value of it on a size change.
  `io.test.ts` ("does not ask the Output panel to lay itself out again") holds that.
- Nothing a program can observe differs (task 33 answers the clamped size either way); no row in
  `docs/differences/SH3.md`.

### 25. `$7F` in an outline face, in a text with a byte of `$80` or above (T2 erratum, "Additions to 6.7")

- Found by T2 in gate I1: in such a text Windows draws `$7F` from a fallback font, and the byte then
  takes that glyph's width, for the pen and for the box, instead of the face's advance (Courier New
  9: 4 pixels, not 7). The width is measured per atlas: `delInHighString` in `scalable/index.json`.
  The raster faces do not do this.
- Does: `parseOutlineIndex` reads `delInHighString` (and the point size `size`, entry 26) when
  present. `FontSet.delInHighText(font)` gives, for an outline face whose atlas has the field, a
  glyph without ink of that width (scaled with the em at a size without an atlas; the line of an
  underlined or struck-out font is drawn across it); null otherwise. `TextScreen` uses it in place
  of the byte's own glyph for every `$7F` of a text that has a byte of `$80` or above.
- Contract: `GlyphProvider` has no such method; it is the optional local interface
  `FallbackGlyphs` (`fonts/types.ts`), which `AtlasGlyphProvider` and `FontSet` implement.
  `TextScreen` draws the byte's own glyph with a provider that lacks it. Proposed:
  `GlyphProvider.delInHighText?(font): Glyph | null`, beside `textOverhang` (and, since entry 28,
  `GlyphProvider.monospacedOutline?(font): boolean`).
- Not reproduced: the glyph itself (another font's, anti-aliased) is left blank; its pixels are
  machine dependent and T2's `text-outline` suite draws the text in the fill colour.

### 26. Outline faces at a size without an atlas (3.5.1; T2 erratum 1.3)

- T2 stores outline atlases at 8-18, 24 and 36 points only (no 48 and 72 points, no `-u`/`-s`
  atlases), to stay within its size budget; its erratum 1.3, which the gate's reviewer proposed to
  accept, leaves the rest to the provider.
- Does:
  - a size above 36 points takes the 36 point atlas of the same face and style (bold, italic, or
    plain for underline and strike-out, whose line comes from the list, entry 10), resampled to
    the measured cell. `font-set.listed.test.ts` and `gdi-references.test.ts` check every size from
    37 to 255 in every style of the five outline names;
  - an advance as wide as the atlas cell becomes the measured column width (every glyph of a
    fixed-pitch face, and the "W" of the proportional one, whose width is what the metric table
    holds). Any other advance (a letter of the proportional face) grows with the em, `emPixels(size)
    = MulDiv(size, 96, 72)` as the VCL asks Windows for the font, when the list gives the atlas its
    point size; without it, like the cell. The picture is stretched with its advance. At 1 point an
    advance may round to 0, as on Windows.
- Result against Windows (`text-outline`, the proportional substitute at 1, 5, 100 and 255 points,
  where no atlas exists): the pen is Windows' in 16 of 32 cases; the others are 1-8 pixels off on
  texts 230-620 pixels wide (largest: 255 points bold, 611 against 619, 1.3 %). The test requires
  2 %. Recorded in `docs/differences/SH3.md`.

### 27. The text screen against T2's GDI text references (6.5.3; the I1 integration test SH3 proposed)

`text/gdi-references.test.ts` (unit test, Node) and `check-text.mjs` (Node, Chromium, WebKit)
replay every text case of `tests/conformance/gdi/golden` as a 68000 program causes it - task 21 for
font and colour, task 95 for the text - on the real `OutputDevice`, `TextScreen` and `Surface`
with the application's `AtlasGlyphProvider` loading `app/public/fonts`, and compare with what GDI
drew on Windows 11. Numbers at gate I1 round 3 (round 2 in brackets where they differ):

| Suite | What is compared | Result |
|---|---|---|
| `text` (raster faces: Fixedsys 0-121 pt, Courier 0-199 pt, five styles, every byte, random strings, every zero-width rule) | every pixel and the pen | 2,132 of 2,132 equal (2,122: T2 added the ten text colours of entry 17) |
| `text-outline`, Courier New, Lucida Console, Consolas (15 sizes, four styles) | cell rectangles and pen | 198 of 198 equal |
| `text-outline`, the proportional substitute at the 11 sizes with an atlas (incl. size 0) | cell rectangles and pen | 88 of 88 equal |
| `text-outline`, the proportional substitute at 1, 5, 100, 255 pt | pen | 16 of 32 equal, all within 2 % (entry 26) |
| `text-outline-zero` (zero-width bytes and `$7F`, Courier New, Lucida Console, Consolas; entry 28), texts that draw something other than `$7F` | cell rectangles and pen | 336 of 336 equal (96 of 336 before entry 28) |
| `text-outline-zero`, texts that draw only `$7F` | pen | 72 of 72 equal (cells: 60 of 72; the cell height is not measured, entry 28) |
| `text-outline-glyphs` (outline faces with visible glyphs) | pen | 75 of 75 equal |
| `text-control` (machine-dependent strings; not required) | every pixel and the pen | 44 of 252 equal (pictures 46, pens 217) |

The 208 `text-control` cases that differ, by T2's reason (`textUnmodelled` in `cases.ts`):

- a byte Windows draws from an anti-aliased fallback font (`$01-$08 $0B $0E-$1B`): 90 cases, 16
  equal, pens equal in 85. The port paints an empty cell of the byte's own width where Windows
  paints a narrow smoothed box; the 5 pens that differ are strings where the fallback glyph's
  width is not the byte's width;
- a byte Windows-1252 leaves undefined (`$81 $8D $8F $90 $9D`): 34 cases, 4 equal. Inside a string
  GDI takes such a byte's width from elsewhere; not modelled (T2);
- zero-width bytes only, at the sizes where Windows 11 draws a thin fallback bar instead of filling
  the cell (`ZERO_WIDTH_BAR_SIZES`): 111 cases, 16 equal, pens equal in all 111. The port fills the
  cell, as at every other size;
- italic strings with `$86 $87 $88 $98`, whose overhang Windows decides by script itemization: 11
  cases, 2 equal, pens equal in all 11; the port leaves the overhang in;
- `$0C`, `@` or `$80` that Windows may draw from a fallback font: 6 cases, all equal.

These depend on the machine's font smoothing or on Windows' script itemization, which T2 did not
model; the port keeps the rule of the ordinary case. `docs/differences/SH3.md` lists them.
### 28. Zero-width bytes and `$7F` in the fixed-pitch outline faces (T2 erratum, section 2, "Outline faces, cells and pens"; gate I1 round 3)

- Found by T2 in the review of gate I1 round 2 (suite `text-outline-zero`, 408 cases): in Courier
  New, Lucida Console and Consolas Windows builds the opaque box from the widths it draws, not from
  the rule of entry 14. A zero-width byte (`$09 $0A $0D $1C-$1F`) takes no room even when it is the
  only byte, so a text of zero-width bytes only fills no cell; `$7F` is always drawn from a
  fallback font and takes that glyph's width (`delInHighString`) in the box, also without a byte of
  `$80` or above, where the pen still counts the face's advance (Courier New 9 `"A" $7F "B"`: box
  18, pen 21). Consolas' `$0D` advances 0. The port had the rule of entry 14 there and differed from
  Windows in 240 of the 336 modelled cases (the reviewer counted 312 of 408 with the 72 texts below).
- Does: `FallbackGlyphs` (`fonts/types.ts`) has a new optional method `monospacedOutline(font)`,
  which `FontSet` and `AtlasGlyphProvider` implement: true for an outline face (not a raster face
  of the metric table) whose atlas is fixed-pitch (every byte `$20-$7E` as wide as the cell); the
  proportional substitute of font numbers 5 and 7 is not. `TextScreen.layout` hands such a font to
  `outlineLayout`: the box is the sum of the drawn glyphs, zero-width bytes are never drawn, `$7F`
  is `delInHighText`; the pen follows entry 14 and entry 25 unchanged. Consolas' `$0D` needs nothing
  of its own: its advance in the atlases is 0 at every size, which `gdi-references.test.ts` checks.
  A character written at the cursor takes the same path for `$7F` (`textOutChar`), as charOut hands
  Windows one byte. A provider without the method (the contract's `GlyphProvider` does not have it)
  keeps the rules of entry 14.
- Result: `text-outline-zero` 336 of 336 cases equal in cells and pens (96 before); the other text
  suites are unchanged (entry 27 has all numbers, before and after). `gdi-references.test.ts` and
  `check-text.mjs` now read the suite, and a test shows that the old rule fails it.
- Not modelled (as in T2's model): a text that draws only `$7F` gets the fallback font's cell
  height on Windows, which was not measured. The port fills the face's own height; the pens of all
  72 such cases are Windows', and their cells in 60 (the 12 others are Courier New 8 and Lucida
  Console 10, plain and bold, one row). In `docs/differences/SH3.md`.
- Proportional substitute (Arial): not changed. T2 did not measure these rules there and lists the
  zero-width bytes of Arial as not modelled.
