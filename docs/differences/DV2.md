# Differences introduced by DV2 (Electron shell)

None of these changes what a 68000 program can observe.

- **Help window.** The desktop app shows the original's help pages in a window of their own with
  JavaScript switched off (the original used an embedded browser control with scripts). Links to
  other sites open in the system browser after a confirmation.
- **Closing with unsaved work.** Closing a window or quitting while the page asks for it
  (`Platform.confirmBeforeUnload`) shows a macOS question `Leave EASy68K?` with `Leave` and `Stay`,
  in addition to the original's own save prompts, which the page shows before it gets there.
- **Files a program can reach.** In the desktop app a program, an INCLUDE and every file call reach
  only the granted folders (the folder of the program, folders and files chosen in a dialog or
  opened from Finder, and the app's own folder). The original could open any path on the disk; a
  name outside those folders gives the result of a missing file (7.6, 3.8.4).
- **Several windows.** `New Window` (Cmd+N) opens another complete editor and simulator; the
  original started separate programs. Each window has its own simulator.
