# Errata of SH8 (Run controller and session)

What SH8 found while building `app/src/core/run/**`, `app/src/core/sim-host/index.ts` and
`app/src/features/run/**` from `docs/ARCHITECTURE.md` sections 3.3.1, 3.3.2, 3.11 and 4: where the
document is silent, contradicts itself or cannot be done as written, what the repository does, and
why. Entries under **Contract** concern declarations other packages compile against; W1 is asked to
take them into `app/src/contracts/` between waves. Every behaviour named here has a test in
`app/src/core/run/*.test.ts` or `app/src/features/run/*.test.ts`.

Entries 22 to 27 and the lines marked "Gate I1" were written in the first round of integration
gate I1, when the review's open points were repaired and the neighbours' real parts were joined.

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
