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
