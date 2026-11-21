# Request from SH3 to T2: GDI reference cases for text in a colour with a non-zero top byte (gate I1)

Status: done (gate I1 round 3). T2 captured the ten cases in the suite `text` (errata T2 section 1 item 15); Windows agrees with the rule of trap15-b §4.6, and `gdi-references.test.ts` shows the port draws all ten as Windows does (errata SH3.md entry 17).

Task 21 takes the text colour from `D1.L` as a VCL `TColor` (`Font->Color = (TColor)c`). The VCL
selects a font colour with `SetTextColor(Handle, ColorToRGB(Font.Color))`, the same `ColorToRGB`
that trap15-b §4.6 establishes for pens and brushes, so the port draws text with the rule of §4.6:
bit 31 = a system colour, bit 24 = an entry of the stock palette, any other top byte ignored
(`docs/porting/errata/SH3.md` entry 17). trap15-a task 21 still calls this UNVERIFIED and
recommends the low 24 bits, and T2's colour suites (`colors`, `colors-system`) draw pixels, lines,
rectangles and fills, never text. So the rule for text rests on the VCL alone.

Asked of T2 (`tests/conformance/gdi/cases.ts` and a capture on the Windows CI runner, as for the
other suites):

1. Text cases in which the font colour (`{ op: 'fontcolor', color }`) takes the forms the suite
   `colors` already uses for pens: `$01000005`, `$0100000D`, `$01000014`, `$0100FF05`, `$7F000007`,
   `$02336699`, `$80000005`, `$80000008`, `$8000000F`, `$FF336699`. One case each: Fixedsys 9, a
   fill colour of `$800000`, the text "AB" at (2, 2). They fit the suite `text` (system colours 5, 8
   and 15 have the values of a default desktop there, as in `colors`); any other system colour
   belongs in `colors-system`.
2. Nothing else changes: `gdi-replay.ts` already replays `fontcolor` as task 21 with the colour as
   given, so `gdi-references.test.ts` checks the new cases as soon as they are in the golden pack.

If Windows disagrees with the rule, SH3 changes `textColor` in
`app/src/core/sim-host/text/text-screen.ts` (one line) and the nine cases of `text-screen.test.ts`.
