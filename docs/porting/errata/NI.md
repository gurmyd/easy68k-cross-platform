# Errata of NI (integration), the closing pass of version 1.1

The closing pass of version 1.1 (`docs/ARCHITECTURE-PLUS.md` P9; 25 and 26 November 2026, branch
`arrange` from `019ac66`), the role P5 and P6.4 call NI. Where it changed a file of another
package, why; where P9 and the code differ, what the code does. Nothing here changes what a 68000
program can observe, a file the application writes, the visibility of a panel, or an original
menu item, command or key (P1.1). The record of the pass, with its numbers, is section 7 of
`docs/integration/plus.md`.

## 1. The end-to-end test expected the first Floating Tools (C-1)

`tests/e2e/plus/arrange.spec.ts` (M3's) still asserted the order and sizes of Floating Tools before
M2's repair (erratum M2 entry 4): Memory first, then Hardware, both at one size. P9.4 says "every
tool panel floats, cascaded from the top right, at its default size", and M2 reads "its default
size" as each panel's own (Hardware 540 by 640, Memory 640 by 360, Stack 300 by 360, title bar
included) with the Hardware panel first, because only the first place of the cascade leaves it room
to be whole at 1366 by 768. That reading is within P9.4, so the test follows it; no assertion P9
requires was loosened, and the test now checks more than before:

- `floatingWindows` is `['Hardware', 'Memory']` (twice), and `['Hardware', 'Memory', 'Stack']` once
  Stack is shown: the reading order of the floating windows is the order in which they were made to
  float (P9.2), and Floating Tools floats them in M2's order, a hidden panel keeping its place.
- The old lines "Hardware below and left of Memory", "steps of 24 pixels" and "the same size" are
  replaced by one exact rule per window (`expectInCascade`): the n-th window of the cascade lies n
  steps of 24 px in from the dock's top right corner, at its own default size, made smaller only
  where the dock is too small (never below 160 by 96), within one pixel. That rule contains each old
  one that P9.4 asks for (inside the right edge, cascaded from the top right, below the toolbar, in
  steps of 24) and pins the sizes and places exactly. Stack, shown later, is checked by the same rule
  at place 3.

## 2. CI, the contracts and the requests (C-2)

- `.github/workflows/ci.yml` has check-arrange as `docs/requests/M2-ci-arrange.md` asks: the plan
  table's comment row and row `arrange`, the plan job's output, the step "Arrange check (M2)" in
  group `simulator` with the engines' condition and a limit of 20 minutes, and the screenshots'
  path. `tests/lint/ci-workflow.test.ts` passes (`npm run lint` is green). actionlint 1.7.12 reports
  nothing with `-shellcheck=`; with ShellCheck 0.11.0 it did not finish in 300 s on this PC, for
  1.0.0's `ci.yml` (`git show 60d77d2:.github/workflows/ci.yml`) as well, so that is the machine,
  not this change.
- The step limits of the checks that got longer in 1.1, measured on this PC one at a time, 1.0.0
  (`60d77d2`, exported) against this build, both browsers: check:dock 407 s to 688 s (642 to 808
  checks), check:hardware 15 s to 23 s, check:sim-main 107 s to 128 s, check:memory-stack 32 s to
  53 s. On GitHub (main's run 45718196506) 1.0.0's dock step took 8.5 min on macOS, 7.4 on Windows,
  6.5 on Ubuntu; scaled by 1.69 that is about 14.5 min on macOS, too near its 15-minute limit, so
  the step "Dock layout check (N1)" now has 30 minutes (its job, 28 min on macOS then, has 60). The
  other three took at most 3.5 min (sim-main, macOS) and stay inside 15; with check:arrange (about 2
  min here) the simulator group, 14 min on macOS then, stays far inside its 45.
- `PlusSettings` gains `arrangeTipAnswered?: boolean` (`docs/requests/M2-plus-arrange-tip.md`,
  done); `StoredPlus` in `core/plus/settings.ts` is now `PlusSettings`, and `readPlus` names its two
  switches explicitly (the optional member has no default).
- `docs/requests/M1-dock-floating.md` is not applied: its shape predates M1's repair (a stored
  window's `place`, a mode's `origin`), and nothing depends on the contract having it, since
  `ui/dock/stored.ts` validates everything it reads. Its status line says so.

## 3. The button Arrange Panels in a narrow window (C-3)

The text button (`ui/shell/toolbar-text-button.css`, M2's) had `min-width: 0` and could shrink
below its caption, which then overflowed its frame and was drawn over the neighbouring buttons (at
600 px the Editor's button was 44 px wide). Now the button is the one item of the row that gives
way: the icon buttons before it do not shrink (`flex: none`, the kit's), so they keep their
places; the button shrinks no further than an icon button (28 px) and cuts its caption with an
ellipsis inside its own frame. Its accessible name and tool-tip keep the whole text.

check-arrange gains a pass `narrow` (at 1366, 1024, 800, 600 and 500 px, Editor and Simulator, both
browsers: every button of 1.0.0's row has the box it has without the addition, the button covers no
other control and its caption stays inside it, at least 28 px wide, and the row does not overflow
where 1.0.0's left room; a screenshot of each toolbar). Compared with a dev server of 1.0.0 itself
(`60d77d2`'s `app` exported with `git archive`), every original button has 1.0.0's box at every
width in both browsers. The one item that moves is the theme button at 500 px in the Editor: 1.0.0's
row is already 35 px wider than the window there (the theme button at x 507 is drawn outside it),
and the addition's separator and smallest button push it 41 px further. At 600 px and wider it is
where 1.0.0 has it.

## 4. One helper instead of three (C-5)

`revealScroll` and `revealInArea` (a focused control scrolled into view by its own area's offsets,
never `scrollIntoView`) existed three times, identically: `features/hardware/panel-logic.ts` with
`HardwarePanel.tsx`'s `revealFocused`, `features/memory/reveal.ts` and `features/sim-main/reveal.ts`,
because one feature does not import another. They are now one file of the component kit,
`ui/components/reveal.ts` (exported from its index as `revealScroll`, `revealInArea`, `RevealBox`,
with the unit tests of the copies as `reveal.test.ts`); the three panels import it. The kit's
`revealInArea` takes any event target and ignores one that is not an element inside the area (the
union of the copies' two guards). Behaviour unchanged: check-hardware, check-sim-main and
check-memory-stack pass as before, and a probe compared every box of the three panels with 1.0.0's.

## 5. Move and Size chosen with the mouse did nothing (found in this pass)

A floating window's title-bar menu is rendered by the kit's `ContextMenu` inside the title bar's
React tree (a portal). React passes a portal's pointer events up the React tree, so a press on the
menu's `Move` or `Size` reached the title bar's `onPointerDown`, which captured the pointer for the
bar; the item's click then never started Move or Size. With the keyboard (Enter on the item) they
worked, which is all the tests used. `ui/dock/FloatChrome.tsx` now ignores pointer and context-menu
events whose target is not inside the bar itself. check-dock's pass `floating` gains two checks
(Move and Size chosen with the mouse from the right-click menu, then the arrows), both browsers.

## 6. The accessibility audit with a floating window (P9.6)

P9.6 asks that "the accessibility audit passes with a floating window open in both themes". The
audit's structure part already floats the Hardware panel (M1), but its axe scans never ran with a
window floating. `tests/a11y/lib/scan.mjs` (the stage's screens) now floats the Hardware and Memory
panels over the Simulator in each theme and scans: no serious or critical finding in Chromium or
WebKit.

## 7. What was verified of M1's repairs after its second verification (m1b, m1c)

Nobody had verified them independently. Probes of this pass (not tracked; in
`c:\easy64k\build\close-arrange`):

- Float then Dock of every docked panel gives the arrangement it started from (the stored tree with
  its weights to 4 decimals, the floating list, and every shown panel's box within 1 px): in the
  Simulator from the default, Classic, Wide Output, Side by Side and Floating Tools, with the default
  visibility and with every tool panel shown, and in the Editor's default; 48 of 48 round trips in
  Chromium and in WebKit. (The weights differ in the 14th digit after some round trips: the same
  shares, not a defect.)
- The Hardware panel, the registers and the Memory panel docked in the default arrangement at 1366
  by 768 and 1024 by 700, with the left column dragged to its smallest, and floating at 360 by 280:
  every control reached by Tab is in view inside every clipping box, a wheel over the panel brings
  each control into view and a click at its centre hits it, nothing outside the panel is scrolled:
  1,355 of 1,355 checks in Chromium and in WebKit.
- Where they fit (1400 by 900, 1920 by 1080, 1366 by 768; the Hardware panel at 1600 by 1900), the
  boxes of the registers' fields, the Memory panel's rows and fields and the Hardware panel's
  controls are 1.0.0's to half a pixel, in both browsers.
- No defect was found in them.
