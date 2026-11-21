# Errata of SH8 (Run controller and session)

What SH8 found while building `app/src/core/run/**`, `app/src/core/sim-host/index.ts` and
`app/src/features/run/**` from `docs/ARCHITECTURE.md` sections 3.3.1, 3.3.2, 3.11 and 4: where the
document is silent, contradicts itself or cannot be done as written, what the repository does, and
why. Entries under **Contract** concern declarations other packages compile against; W1 is asked to
take them into `app/src/contracts/` between waves. Every behaviour named here has a test in
`app/src/core/run/*.test.ts` or `app/src/features/run/*.test.ts`.

## The queue and the wait states (4.2, 4.3, 4.4)

### 1. An input edge waits for an executed sub-slice, not for the next tick (4.2, 4.3)

- Says: 4.3, "While the program is running, the controller therefore delivers **at most one input
  edge per sub-slice**; the next one follows `subslice(ips)` instructions later". The pseudo-code
  stops `deliverQueue()` after an edge `if phase == running`, and delivers again at the start of
  the next tick.
- Problem: a tick can end without executing anything - the allowance is below one instruction, or
  the frame's time budget is used up. The next tick's `deliverQueue()` would then deliver the next
  edge with no instruction between the two, and a program that polls task 19 would miss the key.
- Does: the controller remembers that an edge reached the executing program and delivers the next
  edge only after `engine.run()` has executed at least one instruction (`edgeDelivered` in
  `controller.ts`). Entries behind a waiting edge wait with it, in order.
- Also: "if phase == running" is read as "the program is executing": phase `running` **and** no
  hold and no open message box. While a dialog holds the controller the program executes nothing,
  and the original's modal loop would drain its queue at once, as 4.3 says of "the other phases".
- Proposed text for the pseudo-code of 4.3: `if the program is executing and entry is an input
  edge: the next input edge waits until a sub-slice has run`.

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

## Contract

### C1. The glyph provider has no declared name or constructor (3.5.1, 3.11.2)

- `SimSession.glyphs` is a `GlyphProvider`; errata W1.md entry 6 leaves the class of
  `core/sim-host/fonts/atlas-provider.ts` to SH3. The session must construct it and give it a way
  to read `app/public/fonts/` (`core/` cannot fetch).
- Does: `features/run/glyphs.ts` uses what SH3 wrote in this wave, `new AtlasGlyphProvider(load)`
  with `FontFileLoader = (path) => Promise<Bytes | null>`, and loads with `fetch` relative to
  `document.baseURI`. If SH3 renames either, that one file is the place to change.
- For W1: declare the provider's class name and constructor like the other parts of 3.3.1.

### C2. `PrinterDeps.submit` has no receiver (3.8.4)

- "to the Printer Output dialog and `Platform.print`": the dialog is SH6's (`features/sim-files`),
  the session is SH8's, and a feature may not import another feature.
- Does: the session keeps finished jobs: `RunSession.printJobs` and `RunSession.onPrintJob()`
  (`features/run/session.ts`), members beyond `SimSession`.
- For W1: a slot on `SimSession` (for example `printJobs` and `onPrintJob`) or on `AppContext`.

### C3. Props of the two dialogs the session opens for other packages (2.7)

- `sim.fileDialog` (SH6) and `sim.logFileExists` (U4) are opened by the session, because
  `ProgramFilesDeps.showFileDialog` and `LogDeps.askFileExists` are its to supply.
- Does: `features/run/session.ts` declares and uses
  `SimFileDialogProps { mode, title, filter, initialName }`, result `VPath | null`, and
  `LogFileExistsProps { kind: 'exec' | 'output', fileName }`, result `'Replace' | 'Append' |
  'Cancel'`. A dialog id nobody registered counts as Cancel.
- For W1: move the two declarations into `contracts/` so that SH6 and U4 compile against them.

### C4. Program files: "write through now" and "is it stale" (3.8.4, 4.2, 4.8)

- 4.2: on `Stopped` "program files are written through"; 4.8: Run revalidates "if needed".
  `ProgramFilesApi` has neither a call for the first nor a way to ask the second.
- Does: the session calls `SyncFiles.settled()` on every cached view it created (SH6: that call
  must start the pending writes, not only wait for them). The controller keeps its own flag:
  `SimRunController.markFilesStale()`, which the session calls together with
  `ProgramFilesApi.markStale()` when the window loses the focus.

### C5. `SimSession` has no start, no end and no "ready" (3.11.2)

- Does: `RunSession` adds `start()`, `dispose()`, `ui`, `sync()`, `bridge` and `timers`. Code that
  has only the contract and needs the real engine can `await ctx.sim.controller.coldStart()`,
  which waits for the start and is skipped while the simulator is still in start-up state.

### C6. Who writes `AppState.sim.output` (3.12.1, 2.5)

- No owner is stated. Does: the session mirrors `width`, `height` (from `surface.back`) and
  `textWrap` (from `text.state`) once per frame. `fullScreen` is shared: the session writes it
  when the engine asks (`host.setupWindow`) and at a cold start (false); the Output panel writes
  it when the user toggles full screen or the browser ends it. Neither overwrites the other's
  value with old news.

### C7. `Platform.confirmBeforeUnload` is one flag for several interested parties (3.13, 3.8.4)

- Documents (E1) and the simulator (`files.unsaved`, `log.unsaved`) each need the "leave site?"
  prompt. The session does not call it, so that it cannot switch off a guard E1 has set. At page
  close it calls `files.exitNow()` and `log.exit()` (`pagehide`).
- For W1 / the gate: a counted or named form (`confirmBeforeUnload(who, needed)`).

### C8. The journal has one key per origin (3.8.4)

- `ProgramFilesDeps.journal` is one text. Does: `localStorage` key `easy68k.sim.journal.v1`; two
  windows that close abruptly at the same time overwrite each other's journal. SH6 decides whether
  the key should carry the window.
