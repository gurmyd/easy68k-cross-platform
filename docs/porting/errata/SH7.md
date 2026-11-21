# Errata and decisions of SH7 (hardware model and panel)

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
