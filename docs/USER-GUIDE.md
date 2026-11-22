# User guide

This guide is for students and teachers who use EASy68K to learn 68000 assembly language and want
to use it on a Mac, on Linux, on a Chromebook, or in a browser on Windows. It explains how this port
differs in use from the Windows program you may know from class. How to write 68000 programs is
not explained here: the original help pages do that, and they are included (Help menu, or F1).

The port is a **preview**. It is tested automatically, but nobody has used it for a course yet. Keep
a copy of your work (see "Where your files are kept"), and if something does not work, the original
EASy68K on a Windows PC is the reference.

## Which version to use

- **The web version**: <https://gurmyd.github.io/easy68k-cross-platform/>. Made for Chrome, Edge
  and Safari on a computer. Nothing to install, nothing to allow. The automatic tests run in the
  engines of Chrome and Safari on Windows, macOS and Linux (Edge is built on Chrome's engine);
  ChromeOS, Firefox and phones are not tested. Firefox will probably work. On a phone or tablet the
  page can be read, but you need a real keyboard to work with it.
- **The Mac app**: the same program as a Mac application, which reads and writes your files directly
  on the disk; it also offers the serial port and network tasks (TRAP #15 tasks 40-43 and 100-107),
  which a browser cannot. Options > Serial Ports... says which device of the Mac each port name of
  a program (`COM1` ...) opens. It has not been released yet. When it
  is, the first start needs a few extra steps, because the app is not notarised by Apple; the
  README's section "Opening the Mac app for the first time" explains them.

**On a Mac managed by your school** you may not be allowed to do those steps. Use the web version:
it does the same, and in Safari you can add it to the Dock (below) so that it opens like an app.

## A first program

1. Open the web version. You see the **Editor** with an empty document `untitled1.x68`.
2. Choose **Help > Examples...**. The **Files** panel opens on the left with a folder `Examples` that
   holds the official example programs.
3. Double-click `tutorial1.X68`. It opens in a tab of the editor.
4. Press **F9** (on a Mac also **Cmd+B**), or choose Project > Assemble Source.... The window
   `Assembler Status` shows the number of warnings and errors. The listing `tutorial1.L68` and the
   program `tutorial1.S68` are written next to the source.
5. Click **Execute**. The application switches to the **Simulator**, starts it afresh and loads the
   program, without running it.
6. Press **F9** to run. The Output panel on the right shows the program's four lines and the status
   bar at the bottom says `Halted`.

The three buttons at the top right, **Editor**, **Simulator** and **EASyBIN**, switch between the three
programs of the original EASy68K, which are one window here. **F4** switches too. Each keeps its state
while another one is shown.

## Writing, assembling and fixing

- **New program**: File > New X68 Source File. It starts from the template, as in the original.
- **Save**: Ctrl+S (Cmd+S on a Mac). The first time, the application's own Save dialog asks for a
  name and a folder. A dot on the tab means the document has changes that are not saved.
- **Errors**: after F9, the **Messages** panel under the editor lists each error with its line
  number, and the line is marked in the editor. Double-click a message (or select it and press Enter)
  to go to the line.
- **Several files**: every open file has a tab. Window > Tile Vertically or Tile Horizontally shows
  two of them side by side.
- **Find and Replace**: Edit > Find... (Ctrl+F, Cmd+F) and Edit > Find And Replace... (Ctrl+R on
  every system).
- **Options**: Options > Assembler Options... and Options > Editor Options... are the original's
  dialogs. Cancel undoes everything you changed in them.
- **Unsaved work** is kept: if the browser closes or crashes while a document has changes, the next
  start offers them back (`Unsaved changes from your last session were found ...`, with Restore and
  Discard).

## Running and debugging

The Simulator looks like the original's main window: the registers at the top left, the listing
below them, the messages at the bottom and the **Output panel** (the original's output window) on
the right.

| What | Menu | Keys on Windows and Linux | Keys on a Mac |
|---|---|---|---|
| Run | Run > Run | F9 | F9 |
| Run to the selected line | Run > Run To Cursor | Ctrl+F9 or Shift+F9 | Ctrl+F9 or Shift+F9 |
| Run one instruction after the other, slowly | Run > Auto Trace | F10 | F10 |
| One instruction, over subroutine calls | Run > Step Over | F8 | F8 |
| One instruction | Run > Trace Into | F7 | F7 |
| Stop | Run > Pause | F6 | F6 |
| Back to the start of the program | Run > Rewind Program | Ctrl+F2 or Shift+F2 | Shift+F2 |
| Load the program again | Run > Reload Program | Ctrl+F3 or Shift+F3 | Shift+F3 |
| Start and stop a log file | Run > Log Start, Log Stop | Shift+F4; Ctrl+F5 or Shift+F5 | Shift+F4; Shift+F5 |
| Find text in the listing | Search > Find... | Ctrl+F | Cmd+F or Ctrl+F |
| Show the line of the PC | Search > Go to PC | Ctrl+G | Cmd+G or Ctrl+G |

On a Mac, keep Fn (or the globe key) pressed for F1 to F12, or switch them to standard function keys
in System Settings > Keyboard ("Use F1, F2, etc. keys as standard function keys"). macOS also uses
Ctrl+F2 to Ctrl+F8 for itself, which is why the Shift forms exist.

- **Breakpoints**: every instruction line of the listing has a hollow green dot at its left. Click
  it and it turns red: Run stops there. Click again to remove it (with the keyboard: select the line
  and press Space). The original's advanced breakpoints are in View > Break Points.
- **Registers** can be changed by typing into their fields while the program is stopped.
- **Memory, Stack, Hardware, Break Points and Log** open from the View menu as tabs under the Output
  panel. **F2** moves the keyboard from one panel to the next (the original used Ctrl+Tab, which a
  browser keeps for itself).
- **After a program halts**, Run and the step commands stay disabled, as in the original. Rewind
  (Shift+F2) or Reload (Shift+F3) to run it again.
- **Speed**: the simulator runs about one million instructions per second on every computer, so a
  delay loop takes the same time on every machine. Options > Execution Speed... can make it faster;
  the status bar shows the setting. The one million is an estimate of how fast the original runs on
  a typical Windows PC; nobody has measured that yet, and the original's speed depended a lot on the
  PC. A program that times itself with TRAP #15 task 8 or waits with task 23 behaves the same at
  any setting; only delays made of counting loops depend on it.

### The Output panel and the keyboard

A running program gets your keys only while the Output panel has the keyboard: click into it, and a
blue frame appears. Then **every** key goes to the program, as in the original's output window,
including F2, F4 and the Shift+F keys. Only the menu shortcuts of the original (F6 to F10, Ctrl+O,
Ctrl+F, Ctrl+G and a few more) still reach the simulator.

To get the keyboard out of the Output panel, press **Ctrl+Alt+O** (on a Mac **Ctrl+Option+O**), or
click somewhere else. That key is the only one the port takes away from programs.

- **Paste into a program**: Shift+Insert on Windows and Linux, Cmd+V on a Mac.
- **Full screen**: Alt+Enter (Option+Return on a Mac) or the button at the top right of the Output
  panel. A browser goes full screen only right after a key press or a click; if a program asks for it
  later, the panel says `Press any key or click to enter full screen`. In Safari, Esc leaves full
  screen and does not reach the program.
- **Zoom**: the `zoom:` box at the top of the Output panel enlarges the picture or fits it to the
  panel; the program's pixels are not changed by it.
- **Sound**: a browser plays sound only after you have pressed a key or clicked in the page. A
  program that starts with sound before that runs normally but is silent until then.

## Where your files are kept

**In the web version, your files are kept by the browser, on your computer.** The Files panel shows
them as **My Programs**; the toolbar button at the far left shows and hides it. Nothing is uploaded
anywhere. This has consequences you should know:

- The files are in **this browser on this computer only**. Another browser, another computer, or the
  Mac app do not see them.
- Clearing the browser's website data deletes them. A private window keeps nothing after it closes.
- **Safari deletes a website's files after seven days in which you did not open it**, unless you
  added it to the Dock (on an iPhone or iPad, to the Home Screen, where every browser follows the
  same rule). And a web app added to the Dock or the Home Screen has its **own, separate** files:
  My Programs is empty there at first.
- So **make a copy regularly**: select a file or a folder in the Files panel and click Export...
  (or right-click > Export...). A folder, or the whole of My Programs, is saved as a `.zip` in your
  Downloads folder. **Import...** brings files or such a `.zip` back, for example into the Dock app.

In Safari (and in any browser on an iPhone or iPad) the Files panel says this itself. From the first
start a short notice above My Programs reads: `This browser may delete the programs kept here after
seven days without a visit to this page. An app made with "Add to Dock" or "Add to Home Screen"
starts with its own, empty My Programs. Use Export... in the Files panel to save them all as a .zip,
and Import... in the app to bring them over.` Its **Export...** button saves the whole of My
Programs as `My Programs.zip`; **Got it** hides the notice in this browser for good. If the Files
panel is hidden, or you start in Simulator mode, the same text appears as a note in the corner when
the first file is saved into My Programs, with **Got it**. In the app made with "Add to Dock" (on an
iPhone or iPad, "Add to Home Screen"), while its My Programs is still empty, the notice reads `This
app keeps its own programs, apart from the browser's: Import... in the Files panel brings over
programs exported there.`, with **Import...** and **Got it**. Other browsers and the Mac app show no
notice.

Other ways to work with files:

- **Open a file from your computer**: File > Open File..., then `From this computer...`. In Chrome
  and Edge the file is then saved back to the same place; in Safari a copy is made in the folder
  `Imported` of My Programs, and Save writes that copy (Export... takes it out again).
- **Work in a folder of your computer** (Chrome and Edge only): File > Open File..., then
  `Open folder...`. The browser asks whether the page may edit the files there. The listing, the
  S-record and the files your program writes then go into that folder too. Use one folder per
  project rather than, for example, your whole Downloads folder.
- **Drag files** onto the window to open them.
- **The Mac app** works directly with the files on your disk, like the original.

The files are the same as the original's: text in Windows-1252 with Windows line ends, so a `.X68`
file can go back and forth between this port and EASy68K on Windows. The settings files
`settings.dat` and `sim68K.dat` of the original can be read and written with Options >
Import/Export Settings....

A program that reads or writes files (TRAP #15 tasks 50 to 59) sees the folder its `.S68` file is
in, as on Windows, but not the rest of the disk. A file name it is shown by the file dialog of task
58 looks like `/browser/My folder/data.txt` instead of `C:\...`; the program can use it as it is.

## Installing the web version as an app

- **Chrome or Edge**: the install button in the address bar (a screen with an arrow), or the browser
  menu (look for "Install" or "Install page as app"). It then opens in a window of its own and from the dock or Start menu.
- **Safari on a Mac** (macOS 14 Sonoma or later): File > Add to Dock.... Remember that the Dock app
  has its own files (above).

After the first visit, the web version also works without a network connection, the help pages
included. When a new version has been published, a message says `A new version is available.
Reload`; the page never reloads by itself while a program is running or a document has changes.

## Shortcuts that differ from the original

On Windows and Linux the shortcuts are the original's, with these exceptions: Log Start is Shift+F4
in a browser (Ctrl+F4 closes the tab), F2 replaces Ctrl+Tab, and F4 switches between Editor,
Simulator and EASyBIN.

On a Mac, every Ctrl+letter shortcut also works with **Cmd**. The ones that differ:

| Command | Windows and Linux | Mac |
|---|---|---|
| Save As | (none) | Shift+Cmd+S |
| Redo | Ctrl+Alt+Z | Shift+Cmd+Z or Ctrl+Option+Z |
| Comment / Uncomment Selection | Ctrl+Alt+C / Ctrl+Alt+U | Cmd+/ / Shift+Cmd+/, or Ctrl+Option+C / Ctrl+Option+U |
| Find Next | F3 | F3 or Cmd+G |
| Find And Replace | Ctrl+R | Ctrl+R (Cmd+R reloads the page; in the Mac app Cmd+R works too) |
| Assemble | F9 | F9 or Cmd+B |
| Insert / Replace mode | Insert | Ctrl+Shift+I, or click `Insert` in the status bar |
| Paste in the editor | Ctrl+V or Shift+Insert | Cmd+V |
| Editor Options | (none) | Cmd+, (Mac app only) |
| Close File, Exit, New Window | (none) | Cmd+W, Cmd+Q, Cmd+N (Mac app only) |

Everything is also in the menus. Some browsers keep a few keys for themselves; if a shortcut does
nothing, use the menu or the toolbar.

## When something does not work

- **A shortcut does nothing on a Mac**: hold Fn for the F keys; for Ctrl+F2 to Ctrl+F8 use Shift+F2
  to Shift+F5 instead.
- **A program waits and ignores my keys**: click into the Output panel first.
- **I cannot leave the Output panel with the keyboard**: Ctrl+Alt+O (Ctrl+Option+O).
- **A program runs very slowly or stops while its tab is in the background**: browsers slow down tabs
  you are not looking at. Keep the tab visible while a program runs (the Mac app does not have this
  problem).
- **Paste from the menu does not work**: the browser asked for permission and did not get it. Use
  Ctrl+V (Cmd+V on a Mac) instead.
- **No sound**: press a key or click into the page once; check that the tab is not muted.
- **My files are gone in Safari**: see "Where your files are kept". Export regularly.
- **The page says that files are NOT being saved**: the browser does not let this page keep files
  (some private windows do that). Use a normal window, and Export... what you want to keep.
- **The simulator or the assembler "could not be loaded"**: reload the page. If it persists, the
  browser may be too old.
- **The message area says `Not available to the program: ...`**: in the web version, a running
  program may open at most 2,000 files of its folder and the folders below it (each at most 32 MB).
  A folder with many other files, for example a Git repository with its `.git` folder, can use up
  that limit. Run the program from a folder that holds only what it needs.
- **Something behaves differently from EASy68K on Windows**: Help > Differences from EASy68K lists
  every known difference and why it exists. If yours is not there, please report it at
  <https://github.com/gurmyd/easy68k-cross-platform/issues>, with the program and what you expected.

## Help

- **F1** in the editor shows the help page of the word under the caret; elsewhere it opens the help.
- **Help > Help** (Editor) and **Help > Sim68K Help** (Simulator) open the original's help pages in a
  panel at the right edge of the window. A filter above the contents finds pages by their title.
- **Help > Examples...** shows the official example programs in the folder `Examples` of My Programs.
  It copies them there only when that folder does not exist, so your changes to them are kept; to get
  the originals back, rename or delete the folder and choose Help > Examples... again.
- **Help > Differences from EASy68K** shows `docs/DIFFERENCES.md`.
- **Help > About** shows the version of the port and of the original it is based on.
