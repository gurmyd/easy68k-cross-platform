# Errata and decisions of SH7 (hardware model and panel)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum SH7 <n>" or naming this file: 1, 5 (hardware.md 2.6, 2.5); 2, 4 (ARCHITECTURE.md 3.3.3); 3 (ARCHITECTURE.md 3.10). Nothing to merge, because no statement of a document is wrong or missing: 6 (a record of the acceptance tests; its finding on timer periods was withdrawn, and the rule is merged from SH8 26 (ARCHITECTURE.md 4.5.3)); 7, 8, 9 (records of the browser check).

Where the code of `app/src/core/sim-host/hardware/**` and `app/src/features/hardware/**` differs
from ARCHITECTURE.md or the specs, or decides something they leave open. No contract change was
needed.

## 1. When the address-conflict colours are recomputed (hardware §2.6, 3.3.3)

- Says: 3.3.3 puts `addressConflict` into `HardwareView` "by the rule of hardware §2.6"; §2.6 says
  the original recolours the four device fields on every key release in any of the twelve address
  boxes, and not when addresses are set by the program (start-up settings).
- Does: `HardwareModel` keeps the colours as state and recomputes them, from the engine's
  `hardware()`, inside the queued engine call of `actions.setAddress` (every change of a device
  field) and of `actions.setMap` when the row carries `start` or `end` (a memory-map field). A map
  check box, the cold start's `setDeviceAddress` calls and anything else leave them as they are.
  `resetToStartup()` clears them. A change is treated as the key release that caused it (they come
  in one browser event).

## 2. `hardwareTimer` repeats are guarded (3.3.3, 4.5.3)

- Says: "`hardwareTimer` arms SoftTimer n"; 4.5.3: setting `intervalMs` while enabled restarts the
  period.
- Does: the model writes `intervalMs` only when it differs and `enabled` only when it differs, and
  sets the interval before enabling. The engine already reports only real changes (TTimer.SetEnabled
  / SetInterval, `engine/sim/shim/hardware.cpp:40-53`); the guard keeps a repeated report from
  restarting a running period, which the original's TTimer would not do either (V3).

## 3. Who writes the saved device addresses (3.10 `SimSettings`, hardware §2.1)

- Says: `SimSettings` holds `seg7Address`, `ledAddress`, `switchAddress`, `buttonAddress`; the
  original saves the four boxes into `sim68K.dat` on Exit and on the other `SaveSettings` moments
  (sim-ui §14.3). No package is named as the writer.
- Does: the Hardware panel writes the field's value into `SimSettings` on every change the user
  makes to a device address (the port's settings are written at once, not at Exit). The cold start
  (SH8, 4.7.1 step 4) reads them as before.

## 4. Visibility: the feature tells the engine on every change, and once at start (2.4, 3.3.3)

- Says: 2.4 "showing the Hardware panel zeroes the switch byte"; 4.7.1 step 4 has the cold start
  call `setHardwareVisible(true)` when the panel is visible; 3.3.3 has `hardwareShow()` call
  `showPanel()` and then `setVisible(true)` through the queue.
- Does: `features/hardware` watches the panel's visibility (`panelVisible(ctx, 'hardware')` after
  every settings change) and calls `actions.setVisible(visible)` whenever it changes, and
  `setVisible(true)` once at `init` when the restored layout shows the panel. So View > Hardware,
  the panel's tab, task 32/0 and a restored layout all reach the engine the same way, and hiding the
  panel tells the engine, so that the next show zeroes the byte again (hardware §8, last row).
  Calls that repeat the engine's current state change nothing (`sim_hw_set_visible` runs FormShow
  only on hidden -> visible; tested), so the cold start's own call and this one may both happen.
  The feature does not re-send after a cold start; 4.7.1 step 4 does that for the new engine.

## 5. Push-button keys (hardware §2.5)

- Says: "any key that reaches a focused push button ... presses it while held".
- Does: every key except Tab, Escape and the modifier keys alone. In a VCL form Tab is taken by the
  form's dialog-key handling before `OnKeyDown` (it moves the focus); the modifiers are not keys a
  user means as a press. Ctrl/Cmd chords are left to the dispatcher. Space and Enter do not also
  click the button.

## 6. Acceptance with stand-ins for SH8's parts

- Says: 9.2 SH7, acceptance "with the real engine (`createTestEngine`) and virtual time".
- Does: SoftTimer, VirtualTime and the run controller are SH8's and were written at the same time.
  The tests use `core/sim-host/hardware/testing.ts`: `TestClock`, `TestSoftTimer` (the rules of
  4.5.3) and `MiniController` (the queue of 4.3 with one input edge per sub-slice while running, the
  wake-up rule, Run and Pause). They are written from the contracts only, so the tests keep their
  meaning when the real controller is joined; gate I1 should re-run the same scenarios on SH8's
  controller.
- The "two `timerTick` posts per second" are measured with timers checked every 1 ms of virtual
  time. With checks only once per 16 ms frame a 500 ms timer fires every 512 ms (a late timer
  schedules `now + interval`, 4.5.3), i.e. 19 ticks in 10 s; that is the frame resolution 4.5.3
  accepts, not a defect of the model.

  Gate I1: the scenarios now also run on SH8's real parts
  (`core/sim-host/hardware/session.test.ts`, on `core/run/headless.ts`: the real run controller,
  `TimerSet`/`SoftTimer` and `VirtualTime`). There a 500 ms timer gives 19 handled interrupts in
  10 s (ticks at 512, 1024 ... ms), none after Pause; the test accepts 19 or 20. A Windows timer
  keeps its period (the next tick is due one interval after the previous due time, not after the
  late check), so the original gives 20 in 10 s; a program that counts interrupts can see the
  difference. Keeping the period in `SoftTimer.check` (`due += period`, skipping whole periods that
  were missed, so a late timer still fires once) would give 20; that is SH8's file and a change to
  the wording of 4.5.3, so it is left to SH8 and the gate.

  Gate I1, round 3: withdrawn. SH8 measured a Windows `SetTimer` timer of 500 ms on Windows 11
  (errata SH8.md entry 26): 19 ticks in 10 s, each period starting when the late tick is handled,
  rounded up to the clock tick. So the original does not keep its period either, and the statement
  above that it gives 20 was wrong; `due += period` would make the port differ. The session test now
  pins the rule SH8 pinned in `timers.test.ts`: exactly 19 handled interrupts in 10 s at 16 ms
  frames, none after Pause.

## 7. The browser check runs on the application's real session (gate I1)

- Was: part 2 of `check-hardware.mjs` swapped the parts of the shell's inert session for the real
  engine and the stand-in controller. The real session of SH8 (`features/run/session.ts`) has
  read-only parts, so the swap threw.
- Does: part 2 uses `ctx.sim` as the application built it, loads programs with File > Open
  (`ctx.sim.controller.open`) from the browser store, and writes memory through
  `controller.invoke`. Every step waits for the state it expects instead of a number of frames.

## 8. The browser check without engine/dist (gate I1, round 2)

- Was: the round-1 reviewers found that part 1 of `check-hardware.mjs` failed on a machine without
  `engine/dist`: opening Simulator mode makes the real session fetch its engine, and the two 404s and
  "The simulator engine could not be created" counted as console errors, while the CI step runs
  without an engines guard.
- Does: without the engines those three messages are printed but not counted (any other error still
  is); part 2 is skipped, or fails with `EASY68K_REQUIRE_ENGINES=1`. The new switch
  `--without-engines` answers every request for `engine/dist` with 404 so the case can be run on a
  machine that has the engines. The auto-interrupt check box is now clicked with `locator.check()`
  on its input, since the kit's Checkbox passes pointer events to it (round 1 clicked the label).

## 9. The browser check without engine/dist, measured on a real server (gate I1, round 3)

- Was: the round-2 reviewer answered every engine/dist request with 200 text/html (his reading of
  what the development server does, from a plain `fetch` probe) and Chromium then logged "Failed to
  load module script: Expected a JavaScript-or-Wasm module script but the server responded with a
  MIME type of "text/html"", which the check counted.
- Measured: a scratch copy of the tree without `engine/dist` (`build/SH7/noeng`), Vite 8.3.8, both
  browsers. The development server answers the module import of `sim68k-loader.mjs` with 404 (the
  browser's request is a script request, which gets no index.html fallback) and the `fetch` of
  `sim68k.wasm` with 200 text/html (its index.html). The check passed there unchanged (16 of 16 in
  Chromium); the MIME message appears only with a server that answers module requests with HTML, as
  a static host with a start-page fallback does.
- Does: the MIME and module-import messages of both browsers ("Failed to load module script",
  "... MIME type ...", "Importing a module script failed") are left out like "Failed to load
  resource", and only when the message names a file of engine/dist (the location's URL is appended).
  `--without-engines` now takes `--engine-answer vite|html|404`: `vite` (the default) reproduces the
  measured answers, `html` the static host with a fallback, `404` a plain static host. All three
  pass in both browsers, and the run in the copy without engines passes too (32 of 32). Every answer
  to an engine/dist request, the system, the browser versions and every counted error are printed,
  so a failure on a CI runner can be read from its log.
- Also: the development server takes a dependency cache of its own below `--out`, the page is
  loaded again (up to three times) when React reports an invalid hook call (two bundles of React
  after a re-bundle with a fresh cache), not only after a 504, and a screenshot that times out is
  tried once more and then printed, not counted (it is a record for a person; the panel's contents
  are checked from the DOM).

## 10. The panel scrolls inside a region smaller than what it holds (version 1.1, M1b)

- Says: ARCHITECTURE.md 2.6 places the Hardware window's six rows in a tool panel; nothing says
  what happens when the panel's region is smaller than they are. In 1.0.0 the panel's root
  (`.e68-hw`, `min-width: max-content`) simply overflowed the region, which clips (`.e68-region`,
  `overflow: hidden`): docked below the Output panel at 1366 x 768 the region is 682 x 241 px and
  the rows are 595 px high, so the groups Interrupt, Auto Interval and Reset and the Memory Map were
  cut off and out of reach, and nothing scrolled. The owner of the project met it in the released
  version; ARCHITECTURE-PLUS P9 (floating windows, as small as 160 x 96) makes it more likely.
- Code: `HardwarePanel.tsx` wraps the rows in a scroll area of the panel's own
  (`.e68-hw-scroll`, `data-hw-scroll`: `flex: 1 1 0; min-width: 0; min-height: 0; overflow: auto`).
  It takes the region's size; the rows inside it keep their size (`min-width: max-content` as
  before), so a smaller region scrolls vertically and horizontally, by the wheel, the scroll bars
  and the keyboard. Where the rows fit, nothing scrolls and nothing moves: the rows start at the
  area's top left, which is where they started in the region (the area has no border or padding),
  and no scroll bar appears.
- A control that gets the focus is scrolled into view by the area itself (`revealFocused`, the pure
  rule `revealScroll` (in `panel-logic.ts` until the closing pass of 1.1 moved it to `ui/components/reveal.ts`): the smallest scroll that shows it with 4 px around it; a
  control larger than the area shows its top left). Never `scrollIntoView`: in Chromium it moves the
  page's starting point for the Tab key (errata N1 26) and it could scroll the dock's own boxes.
  So the first address field, which gets the focus when the panel is shown or floats, is in view,
  also in a narrow floating window, which therefore opens scrolled to the right column.
- Checked: `check-hardware.mjs` part 3 (`short region`), Chromium and WebKit: docked below the
  Output panel at 1366 x 768 and floating at 360 x 280 the area scrolls (595 px of rows in 241 and
  248 px; 521 px wide in 358 px floating); the wheel reaches the Memory Map, down and across; a
  real click reaches its last check box; Tab and Shift+Tab through all 49 controls find each one
  inside the area's visible box, and no other box of the page scrolled (every ancestor's scroll
  offsets 0); floating at 900 x 640 nothing scrolls and the rows start at the area's top left. The
  checks of parts 1 and 2 and `check-dock.mjs` are unchanged and pass. Screenshots:
  `<out>/<browser>-docked-under-output-1366x768-{light,dark}.png`,
  `<out>/<browser>-floating-360x280-{light,dark}.png`.

## 11. The wheel check of the short region waited for the first scroll, not the last (CI run 45809923850)

**What CI saw.** On Ubuntu, WebKit only, `check-hardware.mjs` part 3: `short region: docked: the
wheel scrolls the panel to its end; the Memory Map is then in view` failed with `scrollTop` 148 of
354, and with it `a click reaches the last Memory Map check box`.

**Measured in a Linux container** (Playwright 1.65.1, Ubuntu 24.04), six wheel notches of 400 px over
the docked panel at 1366 x 768, the offset read after each notch and then every 100 ms: Chromium is
at 354 (the end) after the first notch, on Windows and Linux, and WebKit on Windows too; WebKit on
Linux scrolls smoothly: 0, 17, 54, 85, 117, 145 after the notches, then 282 after 100 ms and 354
(the end) after 200 ms, where it stays. So the panel scrolls to its end with the wheel on Linux as
everywhere (no defect of the product); the check read the offset as soon as it had left 0, while
WebKit's smooth scroll was still on its way.

**The check now** waits, after the notches, until the area has come to rest (its offsets unchanged
for 10 frames in a row, at most 5 s) and then judges where the wheel took it, by the same rules
as before (the Memory Map inside the visible box, nothing else scrolled, a real click on the last
check box). Where the browser does not scroll smoothly the offsets are at rest at once, so the check
is as strict on this PC as before. Checked: the whole check, Chromium and WebKit, on this PC and in
the Linux container (100 of 100; the docked wheel at `scrollTop` 354 in both browsers).

## 12. The Tab walks counted their stops by a number that is only true where Tab stops at buttons (CI run 45809923850)

**What CI saw.** On GitHub's macOS runner, WebKit only, the Tab walks of the parts added for
version 1.1 failed by their number of stops and by nothing else (no control out of view, nothing
outside the panel scrolled): `check-hardware.mjs` part 3 with 14 stops against a floor of 20 (four
checks), `check-sim-main.mjs` "narrow region (registers)" with 20 against 21 (eight checks) and
`check-memory-stack.mjs` "narrow region (memory)" with 5 forward and 6 back against 12 (eight
checks). Chromium on the same runner passed.

**Cause: the checks, not the product.** Safari's engine on a Mac, with the system's default setting
("Keyboard navigation" off), stops with Tab only at text fields, lists and elements with an explicit
tabindex; buttons and check boxes are reached with Option+Tab (errata W2 entries 13 and 14; the
accessibility audit and `check-dock.mjs` have followed that rule since 1.0.0). The three floors were
counted on Windows, where Playwright's WebKit stops at every control.

**The rule now** (`tests/browser-checks/tab-stops.mjs`, with a unit test of its pure part that
`npm run test:check-ending` runs): before the first Tab, with the focus where the walk starts, the
check reads the panel's controls from the page (not disabled, `tabIndex` of 0 or more, visible) and
counts the walk's stops twice: with every control, and by Safari's rule (`isSafariTabStop` of
`tests/a11y/lib/keys.mjs`; the control the check itself put the focus on counts whatever it is). A
probe says which of the two the browser follows (does Tab go from a field to a plain button?). The
walk must have at least that many stops, and where Tab stops at buttons never fewer than the floor
the check held before; every stop in view and nothing else scrolled, as before. So the check is
stricter than it was on Windows and Linux (the page's own count, which is higher than the old
floors), and on a Mac it asks for what the system's Tab reaches.

**Measured on this PC**, Chromium and WebKit alike, every situation of each part:

| Panel | Stops walked | Counted in the page | By Safari's rule | The macOS runner had |
| --- | --- | --- | --- | --- |
| Hardware | 49 | 49 | 14 | 14 |
| Registers | 21 | 21 | 20 | 20 |
| Memory, forward | 13 | 13 | 5 | 5 |
| Memory, back | 13 | 13 | 6 | 6 |

The rule gives exactly the figures the macOS runner produced, so the same walks pass there by the
rule. All three checks pass on this PC in both browsers (100 of 100, 218 of 218, 220 of 220).

**Not covered.** With Option+Tab Safari goes through the buttons and check boxes too; that walk is
not made (the buttons are brought into view by the same code as the fields, which the walks on
Windows and Linux cover in WebKit).
