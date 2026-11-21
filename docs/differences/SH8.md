# Differences introduced by SH8 (run controller and session)

Deliberate differences from the original that the run controller and the simulator session
introduce or carry out. The first table is what a 68000 program can observe; every row there is a
decision of `docs/ARCHITECTURE.md`, implemented here. The second table is interface only. DOC1
merges this file into `docs/DIFFERENCES.md`.

## What a program can observe

| Where | Original | Port | Why |
|---|---|---|---|
| Execution speed | One instruction, then the Windows message queue twice: an estimated 0.3 to 3 million instructions per second, different on every PC | Governed by instruction count: `EASy68K-like` = 1,000,000 instructions per second on every computer; `Maximum`; or a custom rate (`Options > Execution Speed...`). The cycle counter is not affected | 4.5.6, O-1. A delay loop takes the same time everywhere; programs that must keep time use task 23 or task 8 |
| TRAP #15 task 23, one unit | One `Sleep(10)`: 10 to 15.6 ms depending on the machine's timer | Exactly 10 ms of real time; 100 units are one second whatever the frame rate. A modal dialog or message box that is open stops the delay for as long as it is open, as in the original | 4.4.2, O-8 |
| When keys, mouse events and interrupt requests reach the program | After every single instruction | Between sub-slices: at most 2000 instructions, that is 2 ms of program time, later. While the program executes, two input edges (a key press and its release, two clicks) that arrive together reach it one sub-slice of executed instructions apart (2000 at the default speed, 2 ms of program time at any speed), so a program that polls sees each state as it does in the original | 4.2, 4.3 |
| Auto-interrupt timers and the auto-trace timer | Windows timers: 15.6 ms resolution, intervals below 10 ms count as 10 ms, no catch-up | The same rules; resolution one display frame (16.7 ms at 60 Hz) | 4.5.3 |
| A page that is hidden or gets no display frames for a while | Does not exist | The program runs slower: time without frames is made up only up to 50 ms. Delays, time of day and timers stay correct, only coarser | 4.5.5, R-12 |
| `Execute` in the editor | Starts another SIM68K process | Restarts this window's simulator from process-start state (new engine, every host part reset, saved settings applied), then loads the file. Nothing of the program before is left | 4.7.1, note 20 |
| The simulator engine fails internally (a WebAssembly trap) | The original's own internal faults show `ERROR: An exception occurred in routine 'exec_inst'.` and stop the program | The same box, then the simulator restarts from start-up state and the message area reads `The simulator was restarted after an internal error. Load the program again.` | 4.8: a new engine next to host parts in their old state would be inconsistent |
| The bell character `$07` | `Beep()`: the system's default sound | A tone of 800 Hz, 150 ms, through the audio backend | A page has no system sound |

## Interface only

| Where | Original | Port | Why |
|---|---|---|---|
| Run To Cursor on a row without an address, or with no row selected | Shows `Selected line does not have a valid address.` or `Invalid Run-To-Cursor Selection`, then runs the program anyway | Shows the same box and does not run | note 23 |
| Pause during Auto Trace | Run, Step and Trace stay disabled until a second Pause or Rewind | The commands are enabled at once | note 24 |
| `File > Open` and `Reload Program` after a halt and while a program runs | Open is disabled after a halt until Pause or Rewind | Both stay enabled. Open while a program is running, and Execute while one is running or waiting, ask `The current debug environment will be lost, click OK to continue.` first | notes 20 and 22, O-16 |
| `/e` and `/b` on the command line | Take effect at once, are written to `sim68K.dat` at exit | Take effect at once and are stored at once | The port stores every settings change when it is made |
| Switches when the first argument is not an `.S68` file that exists | SIM68K ignores the argument and processes the switches; its window is the simulator | The switches are processed the same way, but the file decides what the window shows: another existing file opens in Editor mode, otherwise a new document. `/r` with nothing loaded halts at once as in the original; `/f` shows only once the simulator is in front | 5.7: one command line stands for the editor and the simulator |
| `File > Exit` in a browser | Ends the program | Runs the close prompts of the documents, stops the program and the log, writes the program's files out and shows `You can close this tab.` | note 4 |
| Status bar | Two panels, always empty | Run state, PC, speed setting, exceptions and bit field (`Stopped   PC=00001004   speed: EASy68K-like   exceptions off   bit field off`) | note 34 |
| The engine files cannot be loaded | Cannot happen | The simulator message area shows `The simulator engine could not be loaded: ...`; the simulator's commands do nothing until a later cold start succeeds | The engine is a separate file in the port |
