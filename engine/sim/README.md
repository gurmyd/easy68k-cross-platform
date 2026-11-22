# engine/sim - the Sim68K simulator core as a WebAssembly module

This directory builds the 68000 simulator of EASy68K v5.16.1 into
`engine/dist/sim68k.wasm` and wraps it in a small JavaScript API. It contains
no user interface. The instruction set, exceptions, interrupts, memory map,
S-record loader, breakpoints, run control, cycle counting and execution-log
text are the **original C++ code**, compiled with Emscripten; a program
therefore behaves here as it does in the Windows original, quirks included.

```
src/     the original core files, with the marked changes listed in PATCHES.md
shim/    stand-ins for the Windows GUI forms the core was entangled with,
         the exported C API (api.h) and the host imports (host.h)
sim68k.mjs          public JavaScript API (createSim, class Sim68k, SimHost)
build.mjs           builds engine/dist/sim68k.wasm + sim68k-loader.mjs
check-patches.mjs   compares src/ with the original sources
test/    tests (node --test), fixtures, the headless reference host,
         the command-line runner run-s68.mjs, corpus-smoke.mjs
```

Licence: GPL-2.0-or-later, like the original. No npm dependencies.

## Build and test

```
node engine/sim/build.mjs          # needs Emscripten: EMSDK set, or .toolchain/emsdk
                                   # (a separate git worktree has no .toolchain of its own:
                                   #  set EMSDK to the main checkout's .toolchain/emsdk, also for
                                   #  npm run build:engines)
cd engine/sim && node --test       # 170+ tests, a few seconds
node engine/sim/check-patches.mjs  # needs the original sources (reference/)
```

`build.mjs --debug` builds without optimisation and with Emscripten's
assertions and stack-overflow checks; `--asan` builds with AddressSanitizer.
The test suite passes with all three builds (optimised, unoptimised,
sanitised), which is the practical check that no result depends on undefined
behaviour. The same two output files load in Node and in
browsers; the `.wasm` is a separate file next to the loader.

## Using it

```js
import { createSim, Status, Reg } from './engine/sim/sim68k.mjs';

const host = { textOut: (bytes) => ..., message: (bytes) => ..., /* see SimHost */ };
const sim = await createSim(host);
sim.load(s68Bytes, l68Bytes);          // File > Open; l68Bytes may be null
sim.cmdRun();                          // Run (F9)
for (;;) {
  const status = sim.run(50000);       // at most 50000 instructions, then back to the caller
  if (status === Status.RUNNING) continue;           // (a browser would yield to the event loop here)
  if (status === Status.STOPPED) break;              // halted, breakpoint, paused ...
  if (status === Status.WAIT_INPUT) { sim.keyChar(nextKey()); continue; }
  ...                                                // the other wait states, see below
}
console.log(sim.registers(), sim.cycles);
```

`sim68k.mjs` documents every method. `test/headless-host.mjs` is a complete
host without a user interface, and its `drive()` function is the loop above
with every wait state handled; start there.

Programs, listings, file names and all text are **bytes** (`Uint8Array`,
Windows-1252 as in the original). Nothing is ever decoded on the way.

## The boundary

The original core calls its GUI in about 150 places and blocks inside
instructions. The port cuts along this line:

- **Inside the module** (deterministic, testable without a UI): instruction
  execution, exceptions, interrupt latching and delivery, the memory map, the
  loader, reset / rewind / reload, breakpoints of every kind, Step Over and
  Run To Cursor, cycle counting, the execution-log text, the TRAP #15
  dispatcher (`CODE9.CPP`, so that tasks read and write exactly the register
  parts the original does), the keyboard-input state machine, key and mouse
  state, and the Hardware window's logic.
- **Host imports** (`shim/host.h`; one method of the `SimHost` object each):
  everything that draws, plays, prints, stores files or tells the time. The
  import surface mirrors the original call surface: `simIO->charOut(ch)` is
  `host.charOut(ch)`, `Form1->Message->Lines->Add(text)` is
  `host.message(text)`, and so on; the JSDoc of `SimHost` names the original
  for each.
- **Exports** (`shim/api.h`; one method of `Sim68k` each): what a user, a
  timer or the keyboard does to the original program: Run, Pause, a key press,
  an IRQ button, typing into a register box ...

Rules: an import returns at once and must not call back into the engine. Host
events are delivered by calling an export between two `run()` calls - that is
between two instructions, where the original's message loop delivers them.

### Wait states: every place where the original blocks

The engine never blocks (no Asyncify, no threads). Where the original waits,
`run()` (or `cmdTraceInto()`, `autoTraceTick()`) returns a status; the host
does its part and calls `run()` again, which continues the suspended step at
the same statement.

| Original blocking point | Where | Status returned | The host then ... |
|---|---|---|---|
| Message loop after every instruction (`ProcessMessages`) | `SIM68Ku.cpp:258`, `RUN.CPP:647` | `RUNNING` when the instruction budget of `run(n)` is used up | handles its events, calls `run()` again |
| Wait for keyboard input, TRAP #15 tasks 2, 4, 5, 18: `do { ... Sleep(10); } while (inputMode && runMode)` | `RUN.CPP:646-650` | `WAIT_INPUT` | delivers characters with `keyChar()`, then `run()`. The step continues once the read is complete (Enter, or one key for task 5). |
| TRAP #15 task 23 delay: `while (n-- > 0 && runMode) { ...; Sleep(10); }` | `CODE9.CPP:881-884` | `WAIT_DELAY` | waits, reports elapsed 1/100 s periods with `delayElapsed(n)` (`delayRemaining` tells how many are left), then `run()` |
| TRAP #15 task 58 file dialog (`OpenDialogIO->Execute()`, `SaveDialogIO->Execute()`) | `simIOu.cpp:512, 542` | `WAIT_HOST` (after `host.fileDialog(...)`) | shows a dialog, answers with `fileDialogReply(accepted, name)`, then `run()` |
| "Current Log Stopped." box (`Log->stopLogWithAnnounce()`): SIMHALT, task 9, STOP with exceptions off, bus / address error with exceptions off | `logU.cpp:220` via `CODE9.CPP:788, 1318`, `RUN.CPP:954, 1127` | `WAIT_ALERT` (after `host.alert(...)`) | shows the box, calls `dismissAlert()` when it is closed, then `run()` |
| Error box of `exec_inst` ("ERROR: An exception occurred in routine 'exec_inst'") | `RUN.CPP:1011` | `WAIT_ALERT` | same |
| "Breakpoint Limit Reached!", "Selected line does not have a valid address.", "Invalid Run-To-Cursor Selection" | `BREAKPOINTSu.cpp:125`, `SIM68Ku.cpp:490, 494` | `WAIT_ALERT` from the next `run()` | same |
| Full-screen failure boxes in `setupWindow` | `simIOu.cpp:290-333` | none: `host.setupWindow()` is the host's own code | - |
| Serial port read / write with time-outs (tasks 42, 43) | `simIOu.cpp:2318, 2362` | none: `host.commRead` / `host.sendComm` answer at once with what is available | - |
| Network calls (tasks 100-107) | `Net.cpp` | none: synchronous host methods | - |
| Printing (`BeginDoc`, `EndDoc`), `PlaySound` | `CODE9.CPP:51-104`, `simIOu.cpp:1626-1694` | none: host methods that queue the work | - |
| Modal dialogs opened by user commands while a program runs | `SIM68Ku.cpp`, `logU.cpp`, ... | none: the host does not call `run()` while its own dialog is open | - |

Further statuses: `STOPPED` (not running), `ERROR` (the original's
"Unexpected error in runLoop"), `BUSY` (a command that executes was refused
because a step is suspended).

Where the suspended step continues: a delay, a file dialog and the boxes of
task 9 / SIMHALT are waited for *inside* the instruction, before its
exception and interrupt processing (`RUN.CPP`, wait point after the handler),
so that an interrupt requested during a delay is taken at the end of that
same TRAP, as in the original. A keyboard read is waited for *after* the
instruction, before the breakpoint tests of `runprog`.

**Pause, Rewind and Reload during a wait** behave as in the original, where
they arrive in the message loop of the waiting code: `cmdPause()` clears
`runMode` (and cancels a keyboard read: the program later continues without
input - an original quirk), `rewind()` and `load()` reset the machine. As in
the original, the wait then ends at once and the interrupted step runs its
remaining statements on the new state before anything else happens (for
example it replaces the `OLD_PC = -1` of a reset by `OLD_PC = PC`); these
three calls do that themselves, and the next `run()` returns `STOPPED`.
A file dialog or message box that is open keeps the step suspended, as a
modal window does.

In trace mode (`cmdTraceInto`) the original does not wait for a keyboard read
or a delay either (`runMode` is false): the step returns `STOPPED` with
`state().inputMode` still true, and keys typed later complete the read.

### State that the original kept in GUI controls

| Original | In the engine | Updated when |
|---|---|---|
| SR text box, read by the Protected-range test (`Form1->regSR->EditText[3]`) | the same text box, as a string (`boxText(Box.SR)`) | only by `scrshow()` - at every stop, Pause, simulator reset, first STOP, the Reset button, input completed in trace mode - and by `editBox()`. During a free run it is stale, exactly like the original: a program that drops to user mode while running can still read a Protected range. |
| The other 19 register boxes, read back by Run / Step Over / Trace Into (`loadRegs`) | text boxes too | as above. `editBox()` is "the user typed": D0-D7, SR and PC change only the text until the next run command (and are lost at the next refresh); A0-A6, A7, US, SS write through at once. `setRegister()` writes register and box together. |
| PC box as the store of the start address during a load, and as key of the execution-log listing lookup | the PC box | as the original: a listing whose first line is not an address makes the PC fall back to the value displayed before the load. |
| Hardware window: address boxes, memory-map check boxes and range boxes, auto-interrupt check boxes, interval box, level selector, switch pictures, window visibility | `THardware` stand-in with the same controls and handlers | by `setDeviceAddress`, `setMemoryMap`, `setAutoIrq`, `selectAutoIrq`, `setAutoInterval`, `switchClick`, `setHardwareVisible`, by S0 records of a program and by TRAP #15 task 32. Showing the window zeroes the switch byte, as in the original. |
| Auto-trace timer enabled; menu state (which commands are available) | `state().autoTraceTimer`, `state().menuState` | `host.autoTraceTimer`, `host.menuState` report changes. |
| Listing lines (list box) | kept in the engine (`listingLine(i)`, `listingHighlight`) | loaded with the program; used for the start address, the `*[sim68k]` directives, Run To Cursor and the execution log. |
| Log types as they were when the Log dialog was last opened | `logDialogOpened()` | decides whether Rewind / Reload write their note into the log (original quirk). |

### Time

The engine never reads a clock, so a run is reproducible.

- TRAP #15 task 8 asks `host.timeCentiseconds()`.
- Task 23 is the `WAIT_DELAY` state.
- The seven auto-interrupt timers and the auto-trace timer are *state* in the
  engine (enabled, interval) and *ticks* from the host: `host.hardwareTimer(
  level, enabled, intervalMs)` and `host.autoTraceTimer(enabled)` announce
  changes; the host calls `timerTick(level)` / `autoTraceTick()` when a timer
  fires, between two `run()` calls.
- Speed: the engine executes over ten million instructions per second, far
  more than the original (which pumps Windows messages after every
  instruction). Throttling, if wanted, is the host's choice of budget per
  `run()` call; the cycle counter is unaffected.

### Decisions where the original's outcome depends on a race or on undefined behaviour

| Situation | Original | Here |
|---|---|---|
| Reset button clicked while a program runs | Handled in one of two message loops; in one of them the next instruction sees the stale `OLD_PC` (wrong base for a first `BRA`/`Bcc`/`BSR`/`DBcc`), in the other not. | Always the stale `OLD_PC` (events are delivered where `runLoop` pumps). When idle the original is deterministic (stale) and so is this. |
| Interrupt request arriving in the message loop right after a STOP executed | The wake-up is lost in one of the two loops. | Never lost: the request arrives when the simulator is already stopped and restarts it. |
| Interrupt request arriving just before a STOP executes | Taken in the STOP step, then the simulator halts anyway (handler not run). | Same (delivering the request before that `run()` reproduces it); tested. |
| Deep recursion with the stack or vector 8 in a faulting memory-map range | Stack overflow of the Windows program; visible outcome unverified. | After 1000 nested levels: the `exec_inst` error box and trace mode. PATCHES.md section 4. |
| Text of a listing line containing `%` in the execution log | Printed through `fprintf` as a format string: depends on stack contents. | Written literally. |
| Timer ticks while a "Current Log Stopped." box is open after a bus / address error | Cannot do anything (hardware disabled first). | Same; that box is reported at the next checkpoint of the step instead of inside `mem_req`. |
| S-record file read in text mode | Borland: CR removed, Ctrl-Z ends the file. | Emulated in `shim/hostfile.cpp`. |
| TRAP #15 file tasks: a read right after a write, a write right after a read (C: undefined) | Decided by the Borland run-time's stream (one buffer, one `level` counter for both directions). | The same stream, `shim/hostfile.cpp`, specified in `shim/STDIO-MODEL.md`; the bytes of the original's heap that a read can return without the program having written them (residue of earlier strings) are zeros here (STDIO-MODEL.md section 7). |
| Uninitialised locals, accesses past the end of memory, `MOVEA` timing-table overrun, `fclose(NULL)` | Unknowable / benign. | Made deterministic; PATCHES.md sections 3 and 4. |

## Reference host and tools

- `test/headless-host.mjs` - `HeadlessHost`: text screen model with the
  original's character rules and a transcript of what the output log would
  contain; scripted keyboard; in-memory files; simulated clock (time follows
  the cycle counter at 8 MHz and task-23 delays) driving the auto-interrupt
  timers; recording stubs (`host.calls`) for graphics, sound, serial, network,
  printer. `drive(sim, host)` runs a program to its end.
- `test/run-s68.mjs program.S68 [program.L68] [options]` - runs a program
  headless and prints the message area, the text output, the final registers
  and cycle count; `--log 1|2|3` single-steps it and prints the execution log
  in the original's format; `--json` for tools. See the header of the file.
- `test/corpus-smoke.mjs DIR...` - assembles and runs every `.X68` below the
  directories and classifies the outcome (halted, waits for input, still
  running, stopped with a message, engine crash).

## Tests

`node --test` in this directory. Test programs are in `test/fixtures`
(`.X68` sources written for this project, with their `.S68` and `.L68`, so
no assembler is needed). They cover: every instruction group and addressing
mode with registers, flags and memory (`instructions.test.mjs`); behaviour
that differs from a real 68000 (`quirks.test.mjs`); every exception with
exceptions off (exact messages) and on (frames, vectors) and the double-fault
rules (`exceptions.test.mjs`); interrupts, mask, STOP, Reset, auto interrupts
(`interrupts.test.mjs`); TRAP #15 at the boundary and every wait state with
Pause / Rewind / Reload during a wait (`io.test.mjs`); the loader and program
loading (`loader.test.mjs`); breakpoints, Step Over, Run To Cursor, the
execution log, register boxes, the displayed-SR rule, determinism
(`debug.test.mjs`); hardware logic, memory map, recursion guards
(`hardware.test.mjs`); the host interface and the runner (`api.test.mjs`).

Expected values were derived from the original source and the specification
in `docs/porting/` (not from the port's own output), and each fixture's
results were checked by hand before being written down.

## Not in this directory

The I/O window (text drawing, graphics, sound, serial, network, printing,
the output log file), the Hardware and Memory windows as pictures, file
dialogs, settings files: all are host work behind the imports. Not verified
here: a comparison against the Windows binary itself (planned as a separate
differential test driving `run-s68.mjs`), and loading in an actual browser.
