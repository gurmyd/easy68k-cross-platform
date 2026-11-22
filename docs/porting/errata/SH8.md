# Errata of SH8 (Run controller and session)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum SH8 <n>" or naming this file: 1, 22, 25 (ARCHITECTURE.md 4.3, 4.5.5, 5.7 (first round)); 2, 3 (ARCHITECTURE.md 4.3); 4 (ARCHITECTURE.md 4.4.2); 5, 6, 13 (ARCHITECTURE.md 4.8); 7, 8, 12, 27, 31, 34 (ARCHITECTURE.md 4.7 (12 also sim-ui.md 8.3)); 9, 10, 11, 21, 23, 28, 38 (ARCHITECTURE.md 4.7.1); 14, 17, 26 (ARCHITECTURE.md 4.5.3 (26 confirms the rule as written)); 15, 16 (ARCHITECTURE.md 3.11.1); 18, 24, 32, 33 (ARCHITECTURE.md 4.6); 19 (ARCHITECTURE.md 2.10); 20, 29, 36 (ARCHITECTURE.md 2.3); 35 (ARCHITECTURE.md 3.8.4); 39 (ARCHITECTURE.md 4.8, the Close row, in the text). Nothing to merge, because no statement of a document is wrong or missing: 30, 37 (records of the run feature's browser check); C1-C7, C9, C10 (contract entries; `app/src/contracts/` is the authority); C8 (merged by SH6 6 (ARCHITECTURE.md 3.8.4)).

What SH8 found while building `app/src/core/run/**`, `app/src/core/sim-host/index.ts` and
`app/src/features/run/**` from `docs/ARCHITECTURE.md` sections 3.3.1, 3.3.2, 3.11 and 4: where the
document is silent, contradicts itself or cannot be done as written, what the repository does, and
why. Entries under **Contract** concern declarations other packages compile against; W1 is asked to
take them into `app/src/contracts/` between waves. Every behaviour named here has a test in
`app/src/core/run/*.test.ts` or `app/src/features/run/*.test.ts`.

Entries 22 to 27 and the lines marked "Gate I1" were written in the first round of integration
gate I1, when the review's open points were repaired and the neighbours' real parts were joined;
entry 28 and the lines marked "Gate I1, round 2" in its second round.

## The queue and the wait states (4.2, 4.3, 4.4)

### 1. Two input edges are `subslice(ips)` executed instructions apart (4.2, 4.3)

- Says: 4.3, "While the program is running, the controller therefore delivers **at most one input
  edge per sub-slice**; the next one follows `subslice(ips)` instructions later". The pseudo-code
  stops `deliverQueue()` after an edge `if phase == running`, and delivers again at the start of
  the next tick and after every `engine.run(n)` of a slice.
- Problem: the pseudo-code does not do what the prose says. A tick can end without executing
  anything (the allowance is below one instruction, or the frame's time budget is used up), and
  the last `engine.run(n)` of a slice is as short as the allowance that is left:
  `n = min(subslice(ips), floor(allowance))`. Delivering "at the next tick" or "after the next
  `run()`" therefore lets two edges through with no instruction, or only a few, between them.
  Measured at 1,000,000 instructions per second with edges posted at arbitrary moments: 128 of 900
  gaps were shorter than 2000 instructions, the shortest 41, and a program that looks at a key
  every 250 instructions saw 299 of 300 presses (the review's probe; now tests of
  `controller.queue.test.ts`).
- Does: the prose. When an edge reaches the executing program the controller notes
  `subslice(ips)` (`edgeGap` in `controller.ts`) and counts it down by what `engine.stepCount` says
  was executed; the next edge is delivered when it has reached zero. While an edge waits, an
  engine call ends where the edge is due, so the edge follows **exactly** `subslice(ips)`
  instructions after the one before it, whatever sizes the sub-slices in between had. Entries
  behind a waiting edge wait with it, in order. If the speed setting is lowered meanwhile, the
  distance still to go is cut to the new `subslice(ips)`.
- Also: "if phase == running" is read as "the program is executing": phase `running` **and** no
  hold and no open message box. While a dialog holds the controller, and in every phase but
  `running`, the program executes nothing and the original's own message pump would drain its
  queue at once, as 4.3 says of "the other phases"; so does the port, and an edge delivered that
  way does not make the next one wait.
- Proposed text for the pseudo-code of 4.3: `if the program is executing and entry is an input
  edge: edgeGap = subslice(ips); stop when the next entry is an input edge and edgeGap > 0`, and
  in `runSlice`: `n = min(subslice(ips), floor(allowance), edgeGap if an edge is waiting)`;
  `edgeGap -= executed`.

### 2. `handleStatus(engine.run(subslice))` counts against the allowance (4.2, 4.3, 4.4)

- Says: the queue entries `char`, `keyDown` (in `waitInput`) and `fileDialogReply`, the release of
  the last hold and `dismissAlerts()` call `handleStatus(engine.run(subslice))`; "Entering
  `running` ... sets `allowance = subslice(ips)`, so the first instructions execute at once".
- Read literally, a completed input executes one sub-slice in the queue entry and a second one in
  the slice of the same tick.
- Does: the call enters `running` (allowance = one sub-slice), executes, and deducts what
  `stepCount` says was executed (`runBurst()`); at most one sub-slice executes at once.

### 3. A queue entry does not call `run()` while the controller is held or a box is open (4.3, 4.4.5)

- Says: 4.3, table: `char` - "if the phase is `waitInput`: `handleStatus(engine.run(subslice))`";
  4.4.5: "A held controller delivers the queue and fires timers but calls neither `run()` nor
  `serviceDelay()`".
- Does: 4.4.5 wins. While held, or while a message box is open, the entry is delivered and the
  `run()` is left to the catch-up call that 4.4.5 already provides for the release of the last
  hold. The same catch-up runs after `dismissAlerts()` for the phases `waitInput` and `waitHost`
  (4.4.4 names `waitAlert` only), in case an entry completed the wait while the box was open.

### 4. A delay also stands still while a message box of the engine is open (4.4.2, 4.4.4)

- Says: 4.4.2 moves `delayStart` forward by the time a **hold** lasted. 4.2 does not service the
  delay while `alerts` is not empty either, but says nothing about the time.
- Does: holds and open boxes are one condition ("the program may not execute"); the time it lasts
  is added to `delayStart` in both cases, as the original's delay loop stands still inside either
  modal loop.

### 5. `Pause` and `Rewind` with a modal window of the engine open (4.8)

- Says: 4.8, "Pause: `engine.cmdPause()` ...; `phase = idle`".
- Engine (`engine/sim/README.md`): "A file dialog or message box that is open keeps the step
  suspended, as a modal window does."
- Does: after `cmdPause()`, `rewind()` and every `Stopped` status the controller looks at
  `engine.state()`: with `fileDialogOpen` the phase is `waitHost`, with an engine box open it is
  `waitAlert`, otherwise `idle`. The reply or the dismissal then finishes the step. A user cannot
  get there (the dialog is modal); a program or a test calling the controller can.

### 6. The run commands check their availability in the controller too (4.8)

- Says: the second table of 4.8 gives command availability ("`menuState == 0` and the phase is not
  `loading`") as a property of the commands.
- Does: `run()`, `runToCursor()`, `stepOver()`, `traceInto()` and `autoTrace()` do nothing unless
  the commands are active and the phase is not `loading`; `pause()`, `rewind()`, `editBox()`,
  `pokeMemory()` and `clearCycles()` do nothing during `loading`. A caller that does not go through
  the command registry (the conformance harness, a test) therefore cannot do what the original's
  disabled buttons prevent.

## Loads and the cold start (4.7, 4.7.1)

### 7. A file that cannot be read (4.7 steps 5-7)

- Says: "Read the `.S68` bytes from the `Vfs` (`null` if it cannot be read)" and "Set `program`".
- Original (sim-ui §8.2 step 6): the simulator is reset, the message area says `error: cannot open
  file ...`, the title is unchanged, Reload is not enabled by this load; the file dialog's name is
  the new file.
- Does: with `null`, `program` stays `null` if nothing had been loaded; otherwise it keeps its
  title and gets the new path and `hasListing: false`.

### 8. `/e` and `/b` are written to the settings when they are applied (4.7 step 9)

- Says: "apply `/e` and `/b` with `engine.setOption`"; sim-ui §8.1: "not written to the settings
  file at that moment, but ... on exit".
- Engine: `setOption(Exceptions | BitField, ...)` reports through `host.optionChanged`, which the
  bridge writes to `SimSettings` at once (4.7, last paragraph but one). The port stores every
  settings change when it is made, so there is no "at exit".

### 9. "Still exactly in that state" needs the parts' word (4.7.1, last paragraph)

- Says: "A cold start is skipped when the simulator is still exactly in that state: nothing has
  been loaded, run or changed since the last one".
- Problem: the controller knows what went through it. The Output size and text wrap can be changed
  on the host parts directly (the Output panel's menu commands), and both survive a load.
- Does: skipped only when no engine call has gone through the controller since the last cold start
  **and** `RunControllerDeps.partsUntouched()` says so; the session answers with "the surface is
  640x480 and text wrap is off" (`core/run/compose.ts`).

### 10. Order of step 4: the Output font is in place before the engine exists (4.7.1)

- Says: step 3 creates the engine, step 4 applies the saved settings, "the Output, listing and
  printer fonts" among them.
- Original: `LoadSettings()` runs before `initSim()`, and `initSim()` assigns the Output font.
  The engine's start-up reset does that inside `createSimEngine` (step 3).
- Does: `TextScreen.setOptionsFont(settings font, the screen's current options colour)` is called
  in step 2, right after the parts' `resetToStartup()`. The engine options and the four device
  addresses are applied in step 4 as written. The auto-trace interval is read from the settings
  each time the engine switches the timer on.
- Between cold starts the session passes on two settings itself when they change: the auto-trace
  interval goes to the running timer (the original's OK button sets it at once), and
  `SimOption.DisableDisplay` follows `SimSettings.disableDisplay` ("the host only keeps
  `SimOption.DisableDisplay` equal to the setting", 4.6). Every other setting reaches a running
  engine through the command of the package that owns it.

### 11. "All timers are cancelled" (4.7.1 step 1)

- Does: `TimerSet.disableAll()` switches off every software timer (the seven auto-interrupt timers
  and the auto-trace timer), the delay timer and the pending tick are cancelled, and each part's
  `resetToStartup()` follows in step 2.

### 12. Open Data while a program runs moves the PC (4.7, sim-ui §8.3) - for the spec

- sim-ui §8.3 says of Open Data: "`loadSrec` sets the global `PC` from the data file's termination
  record, but the display is not refreshed and the next run command reloads PC from the PC field,
  so the change is normally lost".
- Seen with the engine: while a program is **running** there is no next run command; execution
  continues at the data file's start address. (A counting loop stopped counting after an Open Data
  whose `END` named the data.) This follows from the same source lines and is kept; the spec's
  sentence holds only for a stopped simulator.

### 22. The switches of the command line without a program (5.7, sim-ui §8.1)

- Says: 5.7, "A first argument ending in `.S68` (any case) that exists: Simulator mode, load it,
  then the switches of sim-ui §8.1 (only from the second argument on). Any other existing file:
  Editor mode, open it. Otherwise a new document." sim-ui §8.1: "Argument 1 is always treated as a
  file name ... Otherwise it is silently ignored. Switches are still processed when argument 1 was
  not a loadable file."
- Problem: 5.7 names the switches only in its first case. Until gate I1 the port then ignored
  `/r /f /e /b` (web: `run=1`, `fullscreen=1`, `exceptions=1`, `bitfield=1`) whenever argument 1
  was not an `.S68` name, and always in the desktop app when the file did not exist (it reports
  such a file as `file: null`); only a web URL naming a missing `.S68` got them, together with a
  switch to Simulator mode that 5.7 does not ask for. The review listed this.
- Does (`features/run/startup.ts`): the simulator's part of the command line is SIM68K's. An
  existing `.S68` is loaded in Simulator mode and the load applies the switches (4.7 steps 9 and
  10). Anything else is nothing to the simulator: no message, **no change of mode** (the editor
  opens another existing file, or shows a new document), and the switches are processed all the
  same: `/e` and `/b` through `engine.setOption` (stored at once, entry 8), `/f` through the
  command `sim.output.fullscreen` with the argument `true`, `/r` through the Run command, last.
- What the user sees of `/r` and `/f` in that case: Run with nothing loaded halts at once, as in
  the original (memory is all `$FF`, the SIMHALT pattern; sim-ui §3.6), so the simulator is in the
  halted state when the user switches to it; the Output panel leaves full screen outside
  Simulator mode (SH4), so `/f` has no lasting effect there. A URL with switches and no `open=`
  is treated the same way; the original's command line cannot express it (position 1 is always
  the file name).
- Proposed text for 5.7, first row: "... Otherwise a new document. The switches of sim-ui §8.1
  are processed in all three cases; without a loaded program `/r` halts at once and `/f` acts
  only once Simulator mode is shown."

### 23. The journal of the program files is applied by the start itself (3.8.4, 4.7.1)

- Says: 3.8.4 has `recoverJournal()` applied "at the next start"; 4.7.1 does not name it.
- Was: the session called `files.recoverJournal()` and then `start()` in a task of its own, while
  a program named at start-up called `controller.open()`, which starts the engine as well. Which
  came first was not determined, so a program could have been loaded before the bytes of the
  journal were back in its files.
- Does: `SessionLifecycle.recover()` (`controller.ts`; `compose.ts` passes
  `files.recoverJournal()`) is the first step of `controller.start()`, before the first engine is
  created. Every load waits for the start (entry 21), so no program sees its files earlier.

## Engine failure (4.8)

### 13. Where the opcode comes from, and when the cold start begins

- Says: "shows `ERROR: An exception occurred in routine 'exec_inst'.` with the PC and opcode from
  the last snapshot ... and then performs a cold start".
- `RunSnapshot` has no opcode. Does: when a snapshot is taken the controller also reads the word at
  the snapshot's PC; the box shows `PC=<PC box>  Code=<that word>` (the original prints `PC-2` and
  the instruction it had fetched).
- The box is an alert of the controller's own (it is not answered with `engine.dismissAlert()`);
  the cold start begins at once and does not wait for OK. While it runs the phase is `loading`.
- Two cases the document does not name:
  - the engine fails again while it is restarted: the stand-in engine of `startup-engine.ts` stays
    in place (reads give start-up values, commands do nothing) and the message area reads `The
    simulator engine failed again while it was restarted.`; the next cold start tries again;
  - `createSimEngine` rejects (the engine files cannot be loaded): the same stand-in, and the
    message area shows the `EngineLoadError` text.

## Time (3.11.1, 4.5.3, 4.6)

### 14. `SoftTimer`: a new value restarts the period, the same value does not

- Says: "`intervalMs` - setting it while enabled restarts the period".
- hardware §3.6: "an enable request only changes the interval (restarting the period if the timer
  is running and the value differs)", which is the VCL's `SetInterval`. Does: that. Likewise
  `enabled = true` on a timer that is enabled changes nothing.

### 15. `VirtualTime`: order at one instant

- Says: "all in time order". Does: timers due at the same time run in the order they were set, and
  timers due at a frame time run before that frame. A timer with delay 0 set inside a callback
  runs before `advance()` returns; one set outside runs at the start of the next call,
  `advance(0)` included.

### 16. `RealClock`, `FrameScheduler` and the lint rule for `core/` (3.1, 3.11.1)

- Says: 3.1, `core/` uses no `performance`, timers or `requestAnimationFrame` "except through the
  injected `Clock` and `Scheduler`"; 3.11.1 puts the two classes that implement them into
  `app/src/core/run/clock.ts`.
- Does: `clock.ts` switches the lint rule off for the four lines that reach the browser's clock
  and timers, with the reason next to each. `FrameScheduler` takes a second optional argument,
  the timer functions, so that its watchdog can be tested without real time.
- The application's clock and scheduler are W3's `createRealClock()` and `createFrameScheduler()`
  (`state/browser.ts`, errata W3.md entry 12), which bootstrap puts on the context; the session
  uses `ctx.clock` and `ctx.scheduler`, so that the whole window has one of each. The classes of
  `clock.ts` behave the same and serve callers without an `AppContext`.

### 17. Which timers are `SoftTimer`s (4.5.3)

- Says: the table lists four: auto-interrupt, auto trace, input prompt, log flush.
- Contracts: `TextScreenDeps` and `LogDeps` have a `Scheduler`, not a timer factory. Does: the
  controller's `TimerSet` holds the seven auto-interrupt timers (made by `HardwareModel` through
  `HardwareDeps.timers`) and the auto-trace timer (made by `SimUiBridge`); the prompt and the log
  flush run on the scheduler in their own packages.

### 18. Publishing (4.2, 4.6)

- Says: "`if isFrame: publishRevisions()` - at most one store update per frame".
- Does: frame ticks publish at most once per frame, and so does everything a free run changes.
  Commands, loads, `invoke`, `hold` and `dismissAlerts` publish when they return: they are user
  actions, and the interface must not wait a frame to show `loading` or a traced instruction.
- A frame is counted for the frame interval also during `loading` (the pseudo-code returns first).

### 24. `pokeMemory`, the repaint counters and the two writers of `liveRevision` (3.11.2, 3.12.1, 4.6)

- Says: 4.6, `repaint(what)`: "`afterEngineCall()` bumps `viewRevision`; the panels named by the
  `RepaintBit`s ... re-read their data"; `AppState.sim` had the one counter. 3.11.2:
  `pokeMemory` is "Memory panel: direct write".
- Was: `pokeMemory` bumped `viewRevision` and `liveRevision`. The Stack panel re-centres on every
  repaint, so typing in the Memory panel re-centred a Stack panel the user had scrolled, which
  the original does not do (sim-ui §11.4; the U2 review found it in the joined application).
- Does, with the contract of gate I1 (`docs/porting/errata/W1.md` entry 11):
  - `pokeMemory` bumps `liveRevision` only. The Memory and Stack panels redraw on it, the Stack
    panel without re-centring; the Hardware panel redraws at every notification of the
    controller, which `pokeMemory` gives.
  - the controller counts the repaints by panel (`SimRunController.repaintCounts`: `listing`,
    `breakpoints`, `memory`, `stack`), and the session mirrors them as `AppState.sim.repaint`.
    `viewRevision` still moves with every repaint. Seen with the engine: a trace step, a stop,
    Run, Rewind and a load name the listing, the Memory and the Stack window; a load also the
    Break Points window; a PC breakpoint set from the gutter the listing only.
  - `sim.liveRevision` has a second writer: interface code that writes memory through `invoke`
    bumps the store's counter itself (the Memory panel's Copy and Fill). The session therefore
    adds what the controller counted since its last look to the store's value instead of writing
    the controller's number over it (`session.ts`, `mirror.ts`); the counter never goes back.

### 25. The watchdog's pace once it has taken over (3.11.1, 4.5.5)

- Says: 4.5.5, "A watchdog timer, re-armed by every frame, takes over whenever no frame has
  arrived for 250 ms and calls the frame callbacks itself until frames return ... The desktop app
  disables background throttling, so there the watchdog keeps a program at its speed when the
  window is hidden or minimised."
- Problem: how often the watchdog calls the callbacks after it has taken over is not said. Both
  schedulers of wave one - `FrameScheduler` here and the application's `createFrameScheduler()`
  (`state/browser.ts`, W3) - came back every 250 ms. The governor makes up at most
  `MAX_CATCHUP_MS` = 50 ms per tick, so a program in a page without frames ran at 50 / 250 = a
  fifth of its speed, also where no browser slows the timers down. Measured in the real
  application with `requestAnimationFrame` withheld (`check-run.mjs`, "no display frames"):
  199,930 instructions per second in Chromium and 167,414 in WebKit instead of 1,000,000. Delays
  were exact (they have a timer of their own); the software timers of 4.5.3 had a resolution of
  250 ms.
- Does: `FrameScheduler` (`core/run/clock.ts`) waits 250 ms for a frame as before; once it has
  taken over it comes back every `WATCHDOG_FRAME_MS` = 1000/60 ms, the pace of a display, until a
  frame arrives. The application uses W3's scheduler (entry 16), which has to change in the same
  way for the sentence about the desktop app to hold: `docs/requests/SH8-frame-watchdog.md`.
  The browser check reports the rate of a page without frames and does not judge it.
- Gate I1, round 2: W3 applied the request (status line of `docs/requests/SH8-frame-watchdog.md`,
  errata W3.md entry 32); it is no longer open. CI run 44919519853 measured without frames
  1,000,650 / 1,004,000 instructions per second on Ubuntu, 1,002,543 / 1,001,499 on Windows,
  516,053 (Chromium) / 991,031 (WebKit) on macOS, where Chromium's timers were 69 ms late.
- Gate I1, round 3: `check-run.mjs` now judges that rate. It records when the watchdog's timer
  (`WATCHDOG_FRAME_MS`) fires and requires what the frames pass requires: the program executes
  what the ticks it really had grant (3 %, best of up to five windows of 2 s), never more. Where
  the timers keep the pace that is a million per second (1,001,988 in Chromium on this PC); where
  they are late (Chromium on the macOS runner) it is less, by the design of `MAX_CATCHUP_MS`.
- Proposed text for 4.5.5: "... takes over whenever no frame has arrived for 250 ms and then
  calls the frame callbacks itself about 60 times per second until frames return."

### 26. `SoftTimer` and the period of a Windows timer (4.5.3; errata SH7.md entry 6)

- SH7 measured on these timers that an auto-interrupt timer of 500 ms gives 19 interrupts in 10 s
  under virtual time (ticks at 512, 1024 ... ms, because a late timer schedules `now` +
  interval and the frames of `VirtualTime` are 16 ms apart), and proposed to keep the period
  (`due += period`), expecting 20 from the original.
- Measured at gate I1 on Windows 11 with a `SetTimer` timer of 500 ms (a
  `System.Windows.Forms.Timer` in a message loop without a window, the mechanism of the VCL's
  `TTimer`), twice: 19 ticks within 10 s both times, mean period 506.4 and 504.1 ms; with 200 ms:
  mean period 203.0 ms (thirteen clock ticks of 15.6 ms). A Windows timer does not keep its
  period either: each period is rounded up to the timer resolution, which is what 4.5.3
  specifies for the port with a display frame in the place of the clock tick.
- Does: nothing changed; `SoftTimer.check` schedules `now` + interval as 4.5.3 says. The machine
  was busy during the measurement, so the figures show the rule, not the exact period of an idle
  PC.
- Gate I1, round 2: the review of round 1 repeated SH7's proposal, with "or record the
  difference" as the alternative. Neither is done: by the measurement above the original's timer
  has the same rule (each period starts when the late tick is handled, rounded up to the clock
  tick), so `due += period` would make the port differ from the original, not agree with it, and
  there is no difference to record beyond the resolution, which `docs/differences/SH8.md` already
  states (one display frame against 15.6 ms). `core/sim-host/hardware/session.test.ts` (SH7)
  accepts 19 or 20 and needs no change.
- Gate I1, round 3: SH7 asked again (round-2 needs: "keep the period, or record the difference").
  Declined for the reason above; `timers.test.ts` now pins the rule ("starts each period when the
  late tick is handled": 19 ticks of a 500 ms timer in 10 s at 16 ms frames, at 512, 1024, 1536
  ms), and the comment of `SoftTimer.check` names this entry. SH7's "exactly 20 interrupts in 10 s"
  is therefore not a criterion the port should meet; ARCHITECTURE.md 4.5.3 already says "then
  schedules now + interval".

### 30. What the browser check of the run feature measures on a slow runner (4.2, 4.4.2, 4.5.5)

- Found: CI run 44913261966 (round 1), Chromium on macos-latest: the default speed 618,792 to
  785,397 instructions per second (frame gaps up to 133 ms), a task 23 delay of 50 units 52 to 55
  hundredths by the program's own clock (59 to 61 without frames). WebKit on the same runner, and
  both browsers on Ubuntu and Windows, were exact.
- Product or runner: the runner, for each figure.
  - Delay: its end is a timer of the page (4.4.2); when it fires the controller makes the program
    continue in the same tick (`serviceDelay` then `runSlice`), so the program's task 8 sees the
    time at which the browser fired the timer. Two reference timers of 500 ms set alongside showed
    Chromium's timers on that runner 23 to 69 ms late (run 44919519853). The check therefore
    allows 50 hundredths plus one, plus the reference timers' lateness, and never fewer than 50.
    The port cannot end a delay earlier than the browser fires a timer.
  - Speed: the governor grants at most `MAX_CATCHUP_MS` = 50 ms of instructions per frame (4.2), so
    frames 100 to 133 ms apart give a rate well below a million by design. Run 44919519853 measured
    766,641 per second there, 98 % of what the frames the page really had grant; WebKit on the same
    runner 1,000,000 (100 %). The check judges the rate against that grant (3 %, one window in up
    to five), never against the wall clock, and never lets the program execute more than it.
    Carrying the allowance over long gaps (the scenario's suggestion) would contradict 4.2 ("the
    allowance is capped after the addition") and was not done.
  - Without frames: the same rule against the watchdog's ticks (entry 25).
- The check prints, per window, the rate, the share of the grant, the longest gap and how many
  gaps exceeded 50 ms, and for the delays how late the reference timers were, so that a failure in
  CI can be told apart from the log alone. When no window is exact, at least half the grant is
  required (a governor that loses time fails; a frame whose 8 ms budget did not suffice for its
  50,000 instructions, seen once at 85 % in WebKit on this busy PC, does not).

### 31. `confirmLoad(origin)`: the hold ends with the answer (4.7 step 2; errata W1.md entry 13)

- Asked: `docs/requests/W1-load-confirm.md` item 1, so that FS1 can ask `Caution` before a dropped
  `.S68` is copied into the browser store, as the original asks before it loads (sim-ui §8.4).
- Does: `confirmLoad(origin)` asks exactly when `open(path, origin)` would (one function,
  `needsCaution`, serves both), holds the program while the question is open, and resolves true
  (no question, or OK) or false (Cancel; also when a load or another question is under way, which
  `open` would ignore). `open(path, origin, { confirmed: true })` skips step 2.
- Difference from `open` alone: there the controller goes to `loading` before the hold ends, so
  the old program executes nothing after OK. With `confirmLoad` the hold ends with the answer and
  a running program goes on while the caller copies the file, until its `open` call; a hold kept
  past the answer would freeze the program for good if the caller then stopped (a cancelled
  replace question, a failed copy). The copy takes milliseconds; no program can tell.

### 32. The repaint counter `stackRedraw` (4.6; docs/requests/U2-stack-redraw-bit.md item 3)

- Does: since the engine sends `RepaintBit.StackRedraw` with `Stack` for `StackFrm->Repaint()`
  (W4, round 3), `repaintCounts` has a fifth counter `stackRedraw`, mirrored into
  `AppState.sim.repaint.stackRedraw`. The cold start's repaint of every panel (`ALL_PANELS`) does
  not include it: a cold start re-centres the Stack panel. The start-up of a new engine sends it
  once, and loads and traces do not. Since gate I2 the counters count calls, not engine calls
  (entry 33): the start-up of a new engine now measures `{ listing: 1, breakpoints: 0, memory: 2,
  stack: 3, stackRedraw: 1 }` (at gate I1 it read `memory: 1, stack: 1`).

### 33. The repaint counters count `host.repaint()` calls, not engine calls (4.6; gate I2)

- Says: 4.6, the controller counts per panel how often the engine named it; entry 32 and the
  contract (`AppState.sim.repaint.stackRedraw`): the Stack panel re-centres when `stack` moved by
  more than `stackRedraw`.
- Problem (major defect carried from gate I1 round 3): the UI bridge ORed the bits of every
  `host.repaint()` of one engine call, and the controller added one per bit. One trace over TRAP
  #15 task 32 with D1 = 0 makes the calls `[4, 24, 8, 1, 8, 4]`: `Hardware->FormShow`'s
  `StackFrm->Repaint()` (Stack | StackRedraw) and then `regPCChange`'s `updateDisplay()` (Stack).
  ORed, `stack` and `stackRedraw` each moved by one and a Stack panel the user had scrolled was
  redrawn in place instead of re-centred, unlike the original.
- Does: `SimUiBridge.takeRepaintCalls()` counts each call by panel (`RepaintCalls`), and the
  controller adds those counts (`takeRepaint()` stays, for callers of the bits). `viewRevision`
  still moves once per engine call. The rule of the Stack panel needs no change: any
  `updateDisplay()` in a call (or between two store updates) re-centres, which is also where the
  original ends whatever the order. Tests: `ui-bridge.test.ts` ("counts the repaint calls by
  panel"), `controller.commands.test.ts` ("counts every host.repaint() of one engine call"), on
  the real session `features/stack/real-session.test.ts`, and the browser pass `stack` of
  `check-run.mjs` (the scrolled panel is centred on SP again after the trace).

### 34. A run command and a load wait until the cached program files have read a save (3.8.4; gate I2)

- Says: 3.8.4, a change saved outside the simulator (editor, Files panel, another window) is seen
  by the program; Run revalidates "if needed" (4.8).
- Problem (SH6's review, second defect): `CachedSyncFiles` reads such a change asynchronously
  after the Vfs reports it, 75-95 ms in WebKit, so Rewind and Run straight after a save read the
  old bytes.
- Does: the session (`compose.ts`) listens to the Vfs; after any change it asks every view it
  handed out for `whenCurrent()` (SH6's member beyond `SyncFiles`; a view without it counts as
  current). `RunControllerDeps.filesCatchingUp()` returns that promise while it is pending. A run
  command from the idle state then goes through `loading` as the stale-folder case does, and a
  load waits before reading the program. With nothing outstanding the command still acts inside
  itself. Because the action may now run after the click handler has returned, a waiting run
  command unlocks audio (`resumeAudio`, 3.7) before it waits, inside the user's gesture.
  Tests: `files-catch-up.test.ts` (real `CachedSyncFiles`, a backend whose reads take several
  turns, the real engine); without the wait the first test reads 3 bytes instead of 11, which the
  control case of the same file shows: the same view with `whenCurrent` hidden reads 3 (gate I2
  review).

### 35. The session ends the cached views it made (3.8.4; SH6's note)

- Does: `RunSession.dispose()` calls `settled()` on each view (which starts its pending writes)
  and then SH6's `dispose()` (beyond the contract: stops listening to the Vfs and the timers; the
  writes already started go on). Test: `session.test.ts` ("the end of a session").

### 36. The toolbar's `LOGGING` label with both log types Disabled (1.3.1; errata U4.md entry 5)

- Problem: `AppState.sim.logging` mirrored the engine's flag, which Log Start sets whatever the
  types; the original's `startLog` shows the label only when it opened a file.
- Does: the session reads the two types from `log.state` when the engine's flag goes on and
  reports `logging` only if one of them was not Disabled. Test: `session.test.ts` ("shows LOGGING
  only when a log type was enabled at Log Start").

### 37. The verdicts of the run check have a module of their own (gate I1 round 3 review, minor defects)

- `features/run/run-verdicts.mjs` holds `judgeDelays` and `judgeRate`, so that
  `run-verdicts.test.ts` holds them to their rules without a browser. The default-speed verdict
  accepts half the grant only when every window had gaps over 50 ms; when any window had steady
  frames one window must be exact, as in round 2. The detail prints the grant per second beside
  the rate per second, and the window's length.

### 38. A skipped cold start leaves nothing out, and whether it is skipped does not depend on frames (4.7.1; gate I2)

- Says: 4.7.1, last paragraph: "A cold start is skipped when the simulator is still exactly in that
  state: nothing has been loaded, run or changed since the last one". Entry 9 added the parts the
  user can change directly.
- Problem (integration scenario of gate I2, round 1): a new window imports sim68K.dat (exceptions
  on, execution log type 2), then Execute. The settings changed without an engine call, so the
  controller skipped the cold start and the program ran with exceptions off and no log type: not
  the settings the student sees, and not what the original's new `SIM68K.EXE` reads. Besides, every
  engine call counted as a change, including the log service's read of the log types that the cold
  start itself queues in its step 2 (3.3.5). Whether that read had been delivered when Execute came
  depended on display frames: in the browsers it always had (so no Execute was ever skipped), under
  Node or before the first frame it had not.
- Does: "changed" covers three things, and a skipped cold start is therefore exactly the state a
  cold start would make. (a) The engine: every call through the controller since the last cold
  start, except the entries that the cold start's own synchronous steps queued (step 2, the parts'
  `resetToStartup`, and steps 4 and 5, `applySettings` and the `onEngineReplaced` listeners);
  those belong to it, as the original's start-up belongs to the new process, and they are delivered
  after the next load either way. (b) The parts (entry 9). (c) The saved settings the cold start
  puts in place: `RunControllerDeps.settingsUnchanged()`, which the session answers by comparing
  `coldStartSettingsKey()` (compose.ts: the options and addresses of `applySimSettings`, the three
  fonts, the Stack and Memory choices, whether the Hardware panel is visible) with what the last
  cold start read in its steps 2 and 4. Not in it: the speed, the auto-trace interval and the
  highlighting of changed registers, which act on a running simulator when they change.
- So the first Execute of a new window in which nothing was done to the simulator is skipped,
  in every browser and under Node; after an import that changed any of those settings it is a cold
  start with the imported settings. Tests: `controller.load.test.ts` ("does not skip it when the
  saved settings changed", "a call the cold start queued itself does not count as a change", run
  with the queued read delivered and still queued; without the repair the delivered case fails),
  `headless.test.ts` ("the cold start of Execute and the saved settings"), and the integration
  scenario `tests/integration/wave2/scenario.test.ts` (settings; "each Execute is a cold start",
  whose first Execute is now asserted to be 0 cold starts).

### 39. Close is enabled at start-up, with no program (4.8; sim-ui §3.6)

- Says: 4.8, availability table: Close "a listing or program is present".
- Original (sim-ui §3.6): start-up runs `initSim`, which enables all nine commands, Close among
  them (`STARTSIM.CPP:83`), and `setMenuTrace` enables Close again in the busy state. Close is never
  disabled. Reported by the shell's engineer at gate I2 (screenshot of the Simulator menu).
- Does: Close is enabled whenever the phase is not `loading`; with no program it asks the
  `Caution` question and on OK leaves the simulator in start-up state (sim-ui §8.5). For the spec:
  4.8's row should read "the phase is not `loading`". Tests: `session.test.ts` ("follows the
  command table of 4.8", "Close at start-up, with no program").

### 40. A sub-slice is bounded by time as well as by count (4.2; docs/porting/speed.md 4.1, round before gate I3)

- Says: 4.2, the slice loop runs `engine.run(n)` with `n` a sub-slice of up to `SUBSLICE`
  instructions while the frame's time budget (8 ms, or half the frame interval) lasts; it looks at
  the clock only between two calls.
- Problem (P1, speed.md 4.1; needs of the last round): a TRAP #15 drawing task costs far more than
  an instruction. While `draw.X68` ran, one `engine.run(2000)` took 6 to 21 ms (95th percentile),
  longer than the whole budget at 120 Hz (4.2 ms) and at times than the 8 ms at 60 Hz; the budget
  rule cannot stop a call that is already running, so frames overran by up to one call and the
  interface stuttered, where the original pumps its message queue after every instruction.
- Does: the proposal of speed.md 4.1. The governor keeps the engine time per executed
  instruction, smoothed over the last calls (`Governor.timed`, weight 1/2), and the next call is
  `min(next(speed), fits(remaining budget))`, where `fits` is the remaining budget divided by that
  cost, at least 1 (`Governor.fits`). Until a call has been timed, and while calls take no
  measurable time (virtual time in tests; a call shorter than the clock's resolution), there is no
  bound. A program of plain instructions keeps sub-slices of 2000 (they take well under a
  millisecond); a drawing program gets sub-slices of a few passes. Nothing a program can observe
  changes: the allowance, the instruction counts and the spacing of input edges (one edge per
  `subslice(ips)` executed instructions, 4.3) count instructions, not calls, and queued input is
  delivered between two calls as before, only sooner in a dear slice (as in the original, which
  delivers between any two instructions). For the document: 4.2's loop should read
  `n = min(subslice, allowance, max(1, floor(remaining budget / measured ms per instruction)))`.
- Tests: `governor.test.ts` ("the time bound of a sub-slice": no bound until timed or while calls
  take no time; the fit at the smoothed cost; back to whole sub-slices when calls are cheap again);
  `controller.governor.test.ts` ("bounds a sub-slice by the time the frame has left": an engine
  whose instructions cost 0.01 ms each; without the bound every frame took 20 ms, with it 8 ms
  plus at most one instruction; the existing tests of the 8 ms and 120 Hz budgets are unchanged).
- Not done: the second proposal of speed.md (4.3, publish and present only when something changed):
  the controller already publishes only when something changed (`publish()` returns when nothing
  is dirty, and a free-running slice is "quiet"); what TaskDuration still spends per frame there is
  the Output panel's and the browser's, not measured again this round. `DEFAULT_IPS` stays
  1,000,000 until the owner has measured the original (speed.md 5, decision O-1). `SLICE_FRAME_SHARE`
  and the Maximum threshold of 6.9 item 9 are the architect's (speed.md 4.2): not changed.

### 41. The Maximum check of check-run.mjs proves "unthrottled", not the runner's speed (CI runs 44972001171 and that of 191e768)

- Problem: the check "F9 runs; at Maximum the program executes far more than a million
  instructions per second (best of three)" asked for more than 2.5 million per second of wall
  clock: its caption said one million, its number was two and a half. It failed on GitHub's macOS
  runner, Chromium only, twice: 1,611,516, 1,059,007 and 1,510,280 (run 44972001171, rerun), and
  2,210,180, 1,940,008 and 1,354,003 (the run of main's head 191e768, job "browser-checks
  (macos-latest, simulator)"; log in build/gate3/ci-191e768-mac-sim-failed.log). The same job's
  figures show why: that Chromium delivered frames 55 to 133 ms apart (the default-speed check: 7 of
  15 gaps over 50 ms; 18 frames per second at Maximum), and the time budget is per frame by design
  (4.2: 8 ms per frame), so 18 frames give the engine about 144 ms of each second. WebKit on the same
  runner, at 61 frames per second, made 8.9 to 10.1 million per second. The product did what 4.2
  says; the threshold measured the runner. A first repair in this round (ratio to the default's
  computed grant, factor 2.5, the wall-clock figure kept on steady frames) would have given about
  2.4 for the 191e768 figures and failed again: any rule of the form "Maximum's rate > k x
  something" depends on the engine's raw speed when the frames are slow.
- What the check is for: 4.2 and 4.5.6 promise that at `Maximum` no instruction count throttles
  the program, only the engine's time budget per frame. How fast that is on a given machine is
  section 6.9 item 9's figure (200 million in 10 s at Maximum), which belongs to Chromium on
  ubuntu-latest and is measured by tests/perf (P1); the browser check does not repeat it.
- Does: three pairs of half-second windows, back to back in the same run of `counter.X68`: one
  at the default speed, then one at Maximum (the speed is changed through the settings while the
  program runs; 200 ms to settle). In each window the page times the controller's `engine.run`
  calls (an own-property wrapper around the engine's method, removed after the window), counts the
  display frames and adds up the time budget the governor allows for them (`budgetFor(gap)` =
  min(8, gap / 2) per gap, the constants of `governor.ts`, asserted equal in the unit test).
  `judgeMaximum` passes when one pair shows both: the engine ran at least 60 % of its budget at
  Maximum (`BUSY_SHARE`: what stopped it was the time, not a count), and the program executed at
  least twice the default's rate of the same pair (`MAXIMUM_FACTOR`: under the same frames and the
  same load). Both hold on any machine, fast or slow, with any frame rate; a Maximum that falls back
  to a rate, or that a count stops early, fails either one. The detail prints per pair the two
  rates, the factor, the engine time against the budget and the engine's own rate while it ran, and
  the frames and gaps, so that the CI log alone tells the runner from the product.
- Evidence on this PC (Windows, loaded by four other engineers): Chromium 12.4 to 12.7 million per
  second at Maximum, 12.1 to 12.7 times the default, engine 95 to 96 % of its budget (27 million per
  second while it ran; 17 of 240 ms at the default); WebKit 4.0 to 4.7 million, 4.1 to 6.6 times,
  96 to 101 % (WebKit at 4.0 million would have come close to the old 2.5 million rule on a busy
  machine). `check-run.mjs --browser all`: 102 of 102. Estimated for the 191e768 macOS figures: 2.2
  million against a default of 0.6 to 0.8 million is 2.8 to 3.7 times, and an engine held by an 8 ms
  budget at 18 frames per second is busy close to 100 % of it. Only the next CI run on macos-latest
  can show the real figures there. Tests: `run-verdicts.test.ts` ("judgeMaximum": the governor
  constants, steady frames, the macOS figures, a throttled Maximum, a Maximum stopped early by a
  count, a busy engine no faster than the default, both conditions needed in the same pair).

### 42. A halt is announced: the run-state cell of the status bar is a status region (2.11; finding Q1-5)

- Says: 2.11, "a halt and `Current Log Stopped.` are announced". Q1's audit (docs/integration/rc.md,
  Q1-5) ran a program to `SIMHALT` and heard only the load's message: the status bar shows `Halted`
  but was no live region.
- Does: the run-state cell (`data-e68-status="run"`, `features/run/StatusBar.tsx`) has
  `role="status"` (polite, atomic), so `Halted`, `Stopped`, `Running`, `Waiting for input` and the
  others are announced when they change. The other cells are not live: the PC changes at every step,
  and the speed and the two flags change only by the user's own action. `Current Log Stopped.` is
  an `alertdialog` (U4), announced by its role. Tests: `StatusBar.test.tsx` (one status region, the
  run cell); `node tests/a11y/check-a11y.mjs --only structure`: "a halt is announced by a live
  region" passes in Chromium and WebKit, both key maps and both themes (the live regions said
  `Halted`). Replaced by entry 43: the cell is no longer the live region.

### 43. Only settled run states are announced, from a hidden region (2.11; review of f17e78a)

- Problem (review of f17e78a): the live cell of entry 42 announced every state it passed through.
  Reproduced with the new pass "announcements" of `check-run.mjs` on the status bar of f17e78a
  (Chromium): a program that reads six keys with task 5 made the region say `Waiting for input`,
  and a running program said `Running`, besides the `Halted` and `Stopped` that matter. Measured
  rather than assumed: a Trace Into step did **not** announce `Stopped` there (the step is
  synchronous, the cell's text never changed), and Auto Trace's ticks did not flip the cell either;
  the review's claim for those two did not hold, the one for the waits did.
- Decided list (2.11 names "a halt"; sim-ui §9 lists what ends execution: SIMHALT, task 9, STOP,
  the errors of 7.2 with exceptions off, breakpoints, Pause, Run To Cursor, Step Over, the end of
  Auto Trace):
  - `Halted`: after every halt, also one reached with Trace Into.
  - `Stopped`: after a run that stopped without a halt (a breakpoint, Run To Cursor, Step Over, Pause
    or Rewind of a running program, Pause of Auto Trace). Not after a Trace Into step: the Listing
    moves its selection to the new line, which a screen reader reads already. Not after Pause or
    Rewind while nothing was running.
  - `Auto trace`: once, when Auto Trace starts; not at its ticks.
  - Not announced: `Running`, `Waiting for input`, `Waiting`, `Loading` (passing states). Errors
    are not announced here: the engine's error texts go to the Messages panel, whose own polite log
    region reads them, and message boxes are `alertdialog`s; the stop that follows says `Halted` or
    `Stopped`.
- Does: the visible cell (`data-e68-status="run"`) is unchanged in look and text but has no role.
  A hidden `e68-sr` span with `role="status"` (`data-e68-run-announce`, `StatusBar.tsx`) gets the
  words; each announcement is a new element, so a second `Halted` is read again. The decision is
  `features/run/announce.ts` (`stopAnnouncement`, `RunAnnouncer`), fed by a new, additive member of
  the controller, `SimRunController.lastStop` (`{ count, after: 'run' | 'trace' | 'autoTrace',
  wasRunning }`, set in `stop()` when the phase becomes idle). A stop is judged 0.5 s after it
  (`ANNOUNCE_SETTLE_MS`) by the state of that moment, so a program that runs again at once says
  nothing; two announcements are at least 1 s apart (`ANNOUNCE_MIN_GAP_MS`), so Step Over held
  down is told at most once a second.
- Tests: `announce.test.ts` (virtual time: a halt once; a key-reading loop of 200 waits says
  nothing; Trace steps say nothing, the halting one `Halted`; Pause `Stopped`; a run restarted before
  it settles says nothing; Auto Trace once and `Stopped` at its end; never two within 1 s),
  `controller.commands.test.ts` ("records every stop with the command that set execution going"),
  `StatusBar.test.tsx` (one status region, hidden; the cells are not live). Browser:
  `node app/src/features/run/check-run.mjs --pass announcements` (7 checks per browser, 14 of 14 in
  Chromium and WebKit; the same pass against f17e78a's status bar failed 2 of 7 as above), and the
  audit's "a halt is announced by a live region" (`tests/a11y`, `--only structure`) passes with the
  hidden region and fails without it.

### 44. The frames check of check-run.mjs compares Maximum with the default speed (4.2; CI run 44999787233 of 4bd5f68)

- Problem: "the page keeps its frames while the program runs at Maximum" counted
  `requestAnimationFrame` callbacks for half a second at Maximum and asked for more than 15 per
  second, an absolute figure. On GitHub's macOS runner (job "browser-checks (macos-latest,
  simulator)") Chromium printed 11 and failed; it had passed there with 23 two runs earlier and
  failed with 12 on another branch. The Maximum check of the same run shows why: the half-second
  windows had 8 and 7, 8 and 9, 9 and 8 frames (Maximum, default), so that Chromium delivers about
  15 frames per second whatever the program does, at the default speed (engine 10 of 63 ms) as at
  Maximum (engine 63 of 69 ms). WebKit there: 60 per second, 30 and 29 frames per window. The
  threshold judged the runner.
- What the check is for: 4.2 gives the engine at most half of each frame's time (8 ms, or half the
  interval), so running at Maximum takes no frame from a page whose display delivers them. That is
  a comparison with the same page on the same machine while the engine takes almost no time.
- Does: `judgeFrames` (`run-verdicts.mjs`) judges the frames of the three pairs of windows that the
  Maximum check (entry 41) already measures back to back; the separate frame count is gone, and
  nothing the Maximum check proves changed. A pair passes when Maximum's frame rate is at least
  70 % of the default's in the same pair (`FRAME_KEEP_SHARE`) and at least 4 per second
  (`FROZEN_FPS`, a frozen page). Two of the three pairs must pass. The line prints per pair both
  counts, both window lengths, both rates and the share, so that the CI log alone tells the runner
  from the product.
  - Why 70 %: a window counts a steady stream of frames to plus or minus one, so with 6 frames or
    more at the default (`MIN_JUDGED_FRAMES`, 12 per second) a page that keeps its frames measures
    at least 5/6 to 5/7 (83 to 71 %), and the macOS runner's worst pair was 7 against 9 (78 %). An
    engine that overruns the frame halves the rate on a display bound to its refresh (WebKit
    here), which at the fewest frames judged is at most 4 of 6 (67 %). 70 % lies between.
  - Why a majority, not the best pair: a loss the product causes is systematic (Maximum fills the
    engine's budget in every window) and shows in every pair. The best pair would let one window
    the runner disturbed in the product's favour (a stall in a default window) pass a real loss; a
    majority keeps one disturbed window, either way, from deciding alone.
  - Too few frames: a pair whose default window had fewer than 6 frames cannot carry a share (one
    frame is a sixth or more); it is judged by the floor alone, and a note says how many pairs were.
    A page frozen at Maximum fails in every case.
- Evidence on this PC (Windows, loaded): `npm run check:run`, 116 of 116; Chromium 31/30, 30/30,
  30/30 frames (103, 100, 102 %), WebKit 29/26, 22/26, 25/24 (112, 85, 107 %). That it can still
  fail: a scratch copy of the script (`build/SH8-frames/make-busy-copy.mjs`, not in the tree) makes
  the page busy-wait after every `engine.run` call in the Maximum windows. 40 ms: Chromium 13 of 30
  frames (40, 41, 40 %), WebKit 9 to 12 of 30 to 32 (28 to 34 %), both fail ("the engine took the
  page's frames"). 20 ms (a call longer than the 16.7 ms frame): WebKit 17/29, 16/26, 17/21 (56, 60,
  78 %), fails 1 of 3; Chromium, whose headless frames are not bound to a refresh, kept 25 of 30
  (76 to 79 %) and passed: a loss of a quarter is within the rule, a loss of a third or more is not.
  12 ms (the call still fits in the frame): no frame lost in either browser, rightly a pass.
  Estimate for the macOS runner from run 44999787233: Chromium 114, 89 and 113 %, WebKit about
  100 %: a pass. Only the next CI run on macos-latest shows the real figures there. Tests:
  `run-verdicts.test.ts` ("judgeFrames": the runner's Chromium and WebKit figures, this PC's, a page
  that loses most or half of its frames, a frozen page, too few frames at the default, the majority,
  windows of different lengths).

### 45. judgeFrames: pairs passed by the floor, and longer windows (review R4 of gate I3; entry 44)

- Problem (found by the review): below `MIN_JUDGED_FRAMES` frames at the default only the floor of
  4 per second applied, and the detail still said that every passing pair "kept at least 70 % of
  the default's frame rate". `judgeFrames` of three pairs of 2 frames at Maximum against 5 at the
  default (a loss of 60 %) passed with "3 of 3 pairs kept at least 70 %". The doc comment's "an
  engine that overruns the frame halves the rate or worse" also did not hold for headless
  Chromium, where entry 44's own 20 ms busy wait passed at 76 to 79 %.
- Does: (1) the detail counts the two kinds apart: "K of N pairs kept at least 70 % ..., F passed by
  the floor of 4 per second alone (too few frames at the default for a share)". (2) The cause is a
  window too short for the machine's frame rate, so `check-run.mjs` now measures the frames again
  when a default window had fewer than 6: three new pairs of windows `frameWindowMs(pairs)` long,
  twice the time the slowest such window needs for 6 frames, at least 1 s and at most 4 s
  (`MAX_FRAME_WINDOW_MS`), and judges those; a note says so. A page with fewer than 1.5 frames
  per second at the default still has fewer than 6 in 4 s and is judged by the floor, and the detail
  says so. The
  Maximum check keeps its half-second pairs. (3) The doc comment states what entry 44 measured:
  on a display bound to its refresh (WebKit) an overrunning engine halves the rate; headless
  Chromium loses only about a quarter at 20 ms (passes) and 60 % at 40 ms (fails).
- Evidence: `run-verdicts.test.ts`, 26 tests (3 new: the reviewer's figures give "0 of 3 pairs
  kept ..., 3 passed by the floor"; `frameWindowMs` gives null, 1000, 1200, 2000 and 4000 ms where
  it should; in 1.2 s windows the reviewer's page of 10 frames per second that loses 60 % fails).
  `check-run.mjs --browser all` on this PC: 116 of 116, the line unchanged in form ("3 of 3 pairs
  kept ...": Chromium 60/60 per second, WebKit 62/63), no second measurement. A scratch copy that
  always takes the second measurement (`build/SH3-R4/make-long-copy.mjs`, not in the tree),
  `--pass run`: 82 of 82; both browsers print "measured again in windows of 1000 ms" and judge 60
  to 65 frames per window (98 to 101 %).

### 28. A session or controller disposed before it starts stays inert (3.12.3, 4.7.1)

- Says: nothing about a session that is disposed before its start. The session starts in the
  microtask after bootstrap (entry 21).
- Problem: an application built and disposed at once (W3's `bootstrap.test.ts`, "bootstrap
  without the test defaults") disposed the session before that microtask. The start then ran on
  the disposed controller: it subscribed to frames that nothing cancelled any more, applied the
  journal and asked for an engine; in CI the last step printed `Simulator: The simulator engine
  could not be created: Error: unused`. Reported by the engine-binding engineer in round 1.
- Does: `SimRunController.start()` returns at once after `dispose()` (no frames, no journal, no
  engine), and the session's own start is skipped when the session was disposed first;
  `RunSession.dispose()` may be called twice. Tests: `controller.load.test.ts` ("start() after
  dispose()") and `session.test.ts` ("a session disposed before it starts").

## Interface (2.3, 2.10)

### 19. Two "show the Output panel" hooks (2.10, 3.3.1)

- 2.10 gives text output ("the panel expands; focus unchanged") and `host.ioShow()` ("Output panel"
  gets the focus; "in Editor mode a toast") different effects, and W1's `OutputDeviceDeps.show` and
  `TextScreenDeps.show` are two functions. Does: `SessionUi.showOutput()` for text output and
  `SessionUi.inputStarted()` for `ioShow`; `ioBringToFront` (Run) focuses the panel in Simulator
  mode only.

### 20. Status bar: `Auto trace` (2.3)

- The drawing of 2.3 shows `Stopped`. During Auto Trace the simulator is idle between two ticks;
  the bar then says `Auto trace`. The other words are W3's (`Loading`, `Running`, `Waiting for
  input`, `Waiting`, `Halted`, `Stopped`).

### 29. Status bar: `Halted` only while the halt keeps the commands busy (2.3; sim-ui §3.6, §9.9)

- Says: 1.4 note 34, the status bar shows the run state; 2.3 draws `Stopped`. `AppState.sim.halted`
  (W1) mirrors `RunSnapshot.halted`, which is the engine's `halt` flag.
- Problem: that flag is set by a halt and cleared only when the next run starts (`runprog`,
  sim-ui §9.2 step 1); `initSim()` (§9.9) leaves it alone. So after Rewind, after Open or Close
  then Open, and after Pause, the flag was still set and the bar said `Halted` while Run was
  enabled (integration scenario of gate I1, both browsers, every system: "Rewind: the status bar
  no longer says Halted").
- Does: `runStateText` says `Halted` when the simulator is idle, the flag is set and the commands
  are busy (`menuState` 1: a halt calls `setMenuTrace`, §3.6); Rewind, Open and Pause put them back
  into the active state, and the bar says `Stopped`. A caller that passes no `menuState` keeps the
  former reading. Tests: `logic.test.ts` ("says Halted only while the halt keeps the commands
  busy"); `check-run.mjs` ("after Rewind Run is enabled and the status bar says Stopped", "after
  Pause the status bar says Stopped"). `AppState.sim.halted` itself stays the raw flag, as other
  packages read it; for W3's tool-tip `HALTED_HINT` (`commands/menus.ts`), which has the same
  problem, the same test applies (`phase === 'idle' && menuState === 1 && halted`).

### 21. The session starts its engine right after bootstrap (3.12.3, 4.7.1)

- Says: "The application's own start is the same function" (the cold start).
- Does: `createSimSession` returns at once (the factory is synchronous) and starts the engine in
  the next microtask, after bootstrap has finished with the context. Until the engine exists
  `session.engine` is a stand-in that reads as a simulator in start-up state, and `sim.phase` is
  `loading` (the native menu is disabled for those milliseconds). A load requested meanwhile waits
  for the start instead of being ignored.

### 27. `/f` and the full-screen command (4.7 step 10)

- `sim.output.fullscreen` (SH4) toggles without an argument and sets the state with one. The
  session and the start-up code pass `true`: `/f` asks for full screen, it does not toggle.

## Contract

### C1. The glyph provider has no declared name or constructor (3.5.1, 3.11.2)

- `SimSession.glyphs` is a `GlyphProvider`; errata W1.md entry 6 leaves the class of
  `core/sim-host/fonts/atlas-provider.ts` to SH3. The session must construct it and give it a way
  to read `app/public/fonts/` (`core/` cannot fetch).
- Does: `features/run/glyphs.ts` uses what SH3 wrote in this wave, `new AtlasGlyphProvider(load)`
  with `FontFileLoader = (path) => Promise<Bytes | null>`, and loads with `fetch` relative to
  `document.baseURI`. If SH3 renames either, that one file is the place to change.
- For W1: declare the provider's class name and constructor like the other parts of 3.3.1.
- Gate I1: done. `FontFileLoader` is in `contracts/devices.ts` and `AtlasGlyphProvider(load)` is
  named in its table of classes; `glyphs.ts` uses the contract's type.

### C2. `PrinterDeps.submit` has no receiver (3.8.4)

- "to the Printer Output dialog and `Platform.print`": the dialog is SH6's (`features/sim-files`),
  the session is SH8's, and a feature may not import another feature.
- Does: the session keeps finished jobs: `RunSession.printJobs` and `RunSession.onPrintJob()`
  (`features/run/session.ts`), members beyond `SimSession`.
- For W1: a slot on `SimSession` (for example `printJobs` and `onPrintJob`) or on `AppContext`.
- Gate I1: done. `SimSession.printJobs?` and `onPrintJob?(listener)` are in `contracts/run.ts`, in
  the form `RunSession` has.
- Gate I2: the composed session (`composeSession`, core/run/compose.ts) keeps the jobs and has both
  members, so the headless session has them too and the contracts engineer may make them required
  on `SimSession`. The session uses `SyncFiles.whenCurrent?()` and `dispose?()` from the contract
  instead of a type of its own.

### C3. Props of the two dialogs the session opens for other packages (2.7)

- `sim.fileDialog` (SH6) and `sim.logFileExists` (U4) are opened by the session, because
  `ProgramFilesDeps.showFileDialog` and `LogDeps.askFileExists` are its to supply.
- Does: `features/run/session.ts` declares and uses
  `SimFileDialogProps { mode, title, filter, initialName }`, result `VPath | null`, and
  `LogFileExistsProps { kind: 'exec' | 'output', fileName }`, result `'Replace' | 'Append' |
  'Cancel'`. A dialog id nobody registered counts as Cancel.
- For W1: move the two declarations into `contracts/` so that SH6 and U4 compile against them.
- Gate I1: done. `SimFileDialogProps`, `SimFileDialogResult`, `LogFileExistsProps` and
  `LogFileExistsResult` are in `contracts/features.ts`; `session.ts` uses them and no longer
  declares its own. The two dialog ids are `FILE_DIALOG_ID` and `LOG_FILE_EXISTS_DIALOG_ID` there.

### C4. Program files: "write through now" and "is it stale" (3.8.4, 4.2, 4.8)

- 4.2: on `Stopped` "program files are written through"; 4.8: Run revalidates "if needed".
  `ProgramFilesApi` has neither a call for the first nor a way to ask the second.
- Does: the session calls `SyncFiles.settled()` on every cached view it created (SH6: that call
  must start the pending writes, not only wait for them). The controller keeps its own flag:
  `SimRunController.markFilesStale()`, which the session calls together with
  `ProgramFilesApi.markStale()` when the window loses the focus.
- Gate I1: the contract now says that `SyncFiles.settled()` starts the pending writes at once; a
  stale flag on `ProgramFilesApi` was declined (`revalidateIfStale()` resolves at once when
  nothing is stale). The controller keeps its own flag, because a Run that always waited for a
  promise would no longer start the program in the command itself.

### C5. `SimSession` has no start, no end and no "ready" (3.11.2)

- Does: `RunSession` adds `start()`, `dispose()`, `ui`, `sync()`, `bridge` and `timers`. Code that
  has only the contract and needs the real engine can `await ctx.sim.controller.coldStart()`,
  which waits for the start and is skipped while the simulator is still in start-up state.
- Gate I1: declined as a contract change; the comment of `SimSession.engine` now describes the
  stand-in. Nothing changed here.

### C6. Who writes `AppState.sim.output` (3.12.1, 2.5)

- No owner is stated. Does: the session mirrors `width`, `height` (from `surface.back`) and
  `textWrap` (from `text.state`) once per frame. `fullScreen` is shared: the session writes it
  when the engine asks (`host.setupWindow`) and at a cold start (false); the Output panel writes
  it when the user toggles full screen or the browser ends it. Neither overwrites the other's
  value with old news.
- Gate I1: `contracts/store.ts` states these writers. `liveRevision` has a second writer too
  (entry 24).

### C7. `Platform.confirmBeforeUnload` is one flag for several interested parties (3.13, 3.8.4)

- Documents (E1) and the simulator (`files.unsaved`, `log.unsaved`) each need the "leave site?"
  prompt. The session does not call it, so that it cannot switch off a guard E1 has set. At page
  close it calls `files.exitNow()` and `log.exit()` (`pagehide`).
- For W1 / the gate: a counted or named form (`confirmBeforeUnload(who, needed)`).
- Gate I1: the contract has `confirmBeforeUnload(needed, who?)`. The session now calls it with
  `who` = `'simulator'` whenever `files.unsaved || log.unsaved` changes (looked at once per frame
  and at every notification of the controller), and withdraws it when the session ends. It never
  calls it while it has nothing to guard, so a platform that still has one flag for all parties
  is not switched off by the session before it has been switched on by it. `platform/web.ts`
  keeps one flag per party; `platform/desktop.ts` (DV2) must do the same, or the session's
  "no longer needed" ends the documents' guard there.

### C8. The journal has one key per origin (3.8.4)

- `ProgramFilesDeps.journal` is one text. Does: `localStorage` key `easy68k.sim.journal.v1`; two
  windows that close abruptly at the same time overwrite each other's journal. SH6 decides whether
  the key should carry the window.
- Gate I1: left to SH6, as proposed.

### C9. The desktop app's devices need the port map and the memory (3.3.4; errata DV2.md entry 3)

- `Platform.serial` and `Platform.net` exist before any session. Gate I1 added
  `Platform.bindDeviceSources?(sources)`; the session calls it once when it is made, with
  `portMap` = `AppSettings.serialPortMap` and `memory` = `engine.memory` of the current engine,
  both read at each use (a cold start replaces the engine).

### C10. `OutputDeviceDeps.message` (2.5; errata SH3.md Contract 1)

- Gate I1 added the optional member; `compose.ts` passes the writer of the simulator message
  area, so `Output window size limited to 4096 x 4096` appears there.
