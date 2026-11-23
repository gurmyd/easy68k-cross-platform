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
3. Open the folder: click the small arrow in front of `Examples`. Then double-click
   `tutorial1.X68`. It opens in a tab of the editor.
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
  panel (where they are at first; panels can be moved, see "Beyond the original"). **F2** moves the keyboard from one panel to the next (the original used Ctrl+Tab, which a
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
- So **make a copy regularly**: select a file, a folder or several items in the Files panel and click
  the Export button (its tool tip says what it exports), or right-click and choose the Export item of
  the menu. A folder, several items, or the whole of My Programs, is saved as a `.zip` in your
  Downloads folder. The earlier versions and the Trash ("Beyond the
  original", below) are kept in the same browser data, so they are lost with your files: they are not
  a copy. **Import...** brings files or such a `.zip` back, for example into the Dock app.

In Safari (and in any browser on an iPhone or iPad) the Files panel says this itself. From the first
start a short notice above My Programs reads: `This browser may delete the programs kept here after
seven days without a visit to this page. An app made with "Add to Dock" or "Add to Home Screen"
starts with its own, empty My Programs. Use Export... in the Files panel to save them all as a .zip,
and Import... in the app to bring them over.` The notice's own **Export...** button, which that text
names, saves the whole of My Programs as `My Programs.zip`; **Got it** hides the notice in this browser for good. If the Files
panel is hidden, or you start in Simulator mode, the same text appears as a note in the corner when
the first file is saved into My Programs, with **Got it**. In the app made with "Add to Dock" (on an
iPhone or iPad, "Add to Home Screen"), while its My Programs is still empty, the notice reads `This
app keeps its own programs, apart from the browser's: Import... in the Files panel brings over
programs exported there.`, with **Import...** and **Got it**. Other browsers and the Mac app show no
notice.

Other ways to work with files:

- **Open a file from your computer**: File > Open File..., then `From this computer...`. In Chrome
  and Edge the file is then saved back to the same place; in Safari a copy is made in the folder
  `Imported` of My Programs, and Save writes that copy (the Export button of the Files panel takes it out again).
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

## Beyond the original

<!-- How this section marks the texts of the application (tools/check-guide-strings.mjs reads it and
fails when a text is not the one the code has):
  **bold**        a caption: a menu item, a button, a column, the title of a dialog. Menu paths are
                  written **Menu > Item**; every part is checked. Emphasis is written *italic*.
  `one backtick`  a text the application shows (a question, a message, a status line). A text that
                  has a name in it is quoted with one of the example names below.
  ``two``         anything else in code type: file names, folder names, chords. Not checked.
Keep to this in this section, and only in this section. A part of a text that the code fills in
may stand only for what the code puts there (a number, or a text the code itself gives in that
place); a part that it takes from outside (a file's name, a panel's title, a detail of an error)
must be one of these names or values (names joined by "/" for a path):

Example names: prog.X68, a.X68, b.X68, lab1.X68, demo, Lab, Courses, lab3, My Programs,
  prog (restored).X68, report.pdf, data.bin, Editor, Files, EASy68K export.zip, no detail is known,
  .git
-->

The original EASy68K has panels that stay where they are, a Files panel that did not exist, and no
way back from a deleted or overwritten file. This port adds four things for that. They change nothing
a program does (except which files are left out first in a folder beyond the web version's limits,
see "When something does not work"), no file the application writes, and nothing of the original's menus, commands or
keys: the original's items stay where they were, and the new ones come after them, below a
separator. None has a shortcut key.

### Moving panels

At first the window looks as the original's does. The panels (in the Editor: Files, Editor and
Messages; in the Simulator: Registers, Listing, Messages, Output, Memory, Stack, Hardware, Break
Points and Log) can be moved, and every move can be made without a mouse.

- **Window > Move Panel To...** (in the Simulator: **View > Move Panel To...**) opens a dialog with the
  title **Move Panel**. Choose the panel, then the place: **Into the group of** another panel **as a
  tab**, **Beside** another panel (on its left, right, above or below it), or **At the edge of the
  window:** (left, right, top or bottom). OK moves it, and the keyboard goes into the moved panel.
- **Window > Lock Layout** (in the Simulator: **View > Lock Layout**) is checked at first. While it is
  checked, a panel's tab shows only where it did in the original, and tabs cannot be dragged. Uncheck
  it and every group of panels shows its tab strip. Drag a tab onto the middle or the strip of another
  group to make it a tab there, onto a side of a group to put it beside that group, or onto an edge
  of the window; Esc cancels. Drag along a strip to change the order of its tabs. Move Panel To... works
  with the layout locked too.
- A right click on a tab (or Shift+F10, or the context-menu key, on a tab that has the keyboard) opens a
  menu with **Move To...**, **Move Left**, **Move Right**, **Move Up**, **Move Down**, **Move Tab
  Earlier**, **Move Tab Later** and **Close**. **Close** is there for the panels that have an ``x``.
- **Window > Reset Layout** (in the Simulator: **View > Reset Layout**) puts the panels of the current
  mode back where the original has them. It does not show or hide any panel and does not change Lock
  Layout.
- Showing a panel from the View menu, or with its key, works wherever the panel is now. Moving a panel
  never shows or hides it; this matters for the Hardware panel, which clears its switches only when
  you show it, as before. The Editor panel can be moved but not closed. The Help drawer stays at the
  right edge of the window.
- A screen reader hears a moved panel announced, for example `Files moved beside Editor, left.` or
  `Layout reset.`
- The arrangement is kept in this browser, separately for each window, and is there after a reload.
  Where a touch screen cannot drag, use Move Panel To....
- **Window > Split Editor Right**, **Window > Split Editor Down** and **Window > Close Split** show two
  documents side by side, one above the other, or together again. With one pane, the first two do
  what the original's Tile Vertically and Tile Horizontally do; with two panes, they move the active
  document to the other pane. Close Split does what Cascade does. Dragging a document's tab onto the
  other pane moves the document there.

### The Files panel: several files at once

- Click selects one row. Shift+click selects from the row clicked last to this one. Ctrl+click
  (Cmd+click on a Mac) adds a row or takes it away. With the keyboard: Shift+Up and Shift+Down extend
  the selection, Ctrl+A selects every visible row, Esc leaves a selection of several. Below the
  strip a line says `5 items selected`.
- **Delete** (the button, the Delete key, the context menu) acts on the whole selection and always
  asks first, with No already chosen: `Delete "prog.X68"?`, or `Delete the folder
  "demo" and everything in it (14 files)?`, or `Delete 5 items: "a.X68", "b.X68", the folder "demo" (14
  files) and 2 more?` It adds `You can restore it from the Trash.` (for several items: `You can
  restore them from the Trash.`), or, when nothing can be kept, `This cannot be undone.` In a folder
  of your computer it adds `It is deleted from the folder "Lab" on this computer. A copy stays in the
  Trash of EASy68K for up to 30 days.` Afterwards a message such as `Deleted 5 items.` offers
  **Undo**.
- A folder that holds a Git repository (a folder named ``.git``, at any depth) is never deleted, moved,
  copied or renamed here, and no name can become ``.git``. The message says `The folder "Courses" holds a
  Git repository ("Courses/lab3"). Nothing was deleted. Delete it with your own tools if you are
  sure.` The Files panel does not list a ``.git`` folder; the tool tip of its folder says `Git
  repository (its .git folder is not shown)`, and an export leaves it out. The panel's Delete,
  Rename, New Folder, Move, Copy and Undo never write below one. Import, Save and your programs
  write there as in the original. If you open a ``.git`` folder itself as a folder of your computer,
  those commands of the panel say `The folder ".git" is the .git folder of a Git repository. Nothing
  was changed in it.`
- The Export button says what it will export: **Export all of My Programs as My Programs.zip** when
  nothing is selected, **Export "prog.X68"**, **Export the folder "demo" as demo.zip**, or **Export 5
  items as EASy68K export.zip**. Several items become one ``.zip`` with each item at the top, and
  afterwards `Exported 23 files as EASy68K export.zip.` appears.
- Drag the selected rows onto a folder (or onto My Programs) to move them; between My Programs and a
  folder of your computer they are copied. With the keyboard use **Move To...** in the context
  menu, which opens a dialog **Move To** with a list of folders and the buttons **Move** (or **Copy**)
  and **Cancel**. Rename... is in the same menu. `Moved 3 items to demo.` appears with **Undo**. If a
  file of that name is at the target: `"prog.X68" already exists in My Programs/demo. Replace it? The
  file there now goes to the Trash. Choose No to skip this item.` When no copy can be kept, the
  question says `This cannot be undone.` instead of the sentence about the Trash, and No is already
  chosen. A file that is open in the editor follows its move or rename.
- **Undo** (Ctrl+Z, Cmd+Z, the toast, or **Undo Delete**, **Undo Move**, **Undo Rename**, **Undo Copy**
  in the context menu) takes back the last of up to twenty things done in the Files panel of this
  window; they are forgotten when the page is reloaded, and an import cannot be undone.
- A file opened with From this computer... is listed under **Opened from this computer** with the
  secondary text `edited in place`. **Remove from List** only takes it off the list: `Remove
  "lab1.X68" from the Files panel? The file on this computer is not changed.` The status bar and the
  tab's tool tip of such a document add `- on this computer, edited in place` to its name, and for a
  file in an opened folder `- in the folder "Lab" on this computer`.
- The line at the bottom of the panel, for example `This site uses 3.4 MB in this browser`, is a
  button that opens the Storage part of Port Additions (below). Before a large import (more than 100
  files or 10 MB) the panel asks `Import 312 files (48.2 MB) into My Programs/demo?`, and when it
  would not fit: `There is not enough room in this browser's storage for 312 files (48.2 MB): about
  20.1 MB is free. Import fewer files, or delete files you no longer need.`

### Earlier versions and the Trash

You do not have to do anything for this. The application keeps, in this browser, the earlier versions
of the files you save and the files you delete or replace in the Files panel. It says nothing while it
does.

- *What is kept.* Each save of a file is kept as a version, and so is a file as it was when you
  opened it, before an import replaces it, and before a restore or a replace overwrites it. Not kept:
  listings and S-record files (Assemble makes them again), files larger than 1 MB, files that are not
  text, and files in a ``.git`` folder. A file has at most 200 versions; older ones are thinned out (all
  of the last ten, then one for every five minutes of the last day, one an hour for a week, one a
  day for two months). The total is limited, so a busy term can push out the oldest versions.
- **File > Earlier Versions...** (also in the Files panel's and the editor's context menus) opens
  **Earlier Versions of prog.X68**, a list with the columns **Kept**, **Size** and **Kind** (`Saved`,
  `As opened`, `Before import`, `Before restore`, `Before replace`, `Before delete`) and, below it,
  the selected version beside the file as it is **Now**. **Restore** puts the version back. The file as
  it was stays in the list: usually it is the newest `Saved` version already, and when it is not, it
  is kept as `Before restore`. **Open as New Document** opens the version's text as a new
  document; **Close** closes the dialog. A file with no versions says `No earlier versions are kept for
  this file yet. A version is kept each time you save it.` or, for example, `Earlier versions are not
  kept for files in a .git folder.`
- **File > Trash...** (and the button **Trash...** in the Files panel) opens **Trash** with the columns
  **Name**, **Was in**, **Why** (`Deleted` or `Replaced`), **When** and **Size**. A deleted file stays
  there for 30 days; when the Trash is full the oldest go first. **Restore** puts the selected items back.
  If something is there now: `"My Programs/demo/prog.X68" exists. Replace it with the one from the Trash? The file
  there now goes to the Trash. Choose No to keep both: the restored file is named "prog
  (restored).X68".` A file with unsaved changes in the editor is skipped: `"prog.X68" has changes
  that are not saved. Save it or close it first, then restore.` **Delete for Good** asks `Delete the 2
  selected items for good?`, and **Empty Trash** asks `Delete everything in the Trash for good? (12
  items, 1.4 MB)`. These questions, and every other question of the additions whose Yes deletes or
  overwrites something for good, have No already chosen, so Enter changes nothing. An empty Trash says `The
  Trash is empty. Files you delete in the Files panel stay here for up to 30 days; when the Trash is
  full, the oldest go first.`
- *When no copy can be kept.* With the switch below off, the questions of Delete and Replace already
  end with `This cannot be undone.`, and nothing more is asked. When a question promised a copy but
  none can be kept after all (the storage is nearly full, or the file is too large), the application
  asks once more before it goes on: `EASy68K cannot keep a copy of "prog.X68" in the Trash. Delete it
  anyway? This cannot be undone.` No leaves the file as it is. When storage is
  nearly full, a note says `The browser's storage for this site is nearly full. To keep room for your
  files, EASy68K keeps no new earlier versions or Trash items until there is room again, and removes
  its oldest ones.` Your files always come first: a save never fails because of the history.
- *Where it lives.* The versions and the Trash are in the same browser data as My Programs. They are
  never written into a folder of your computer. Clearing the site's data removes all of it: `Clearing
  this site's data in the browser removes My Programs, earlier versions and the Trash.` They are not
  a backup and an export does not contain them. The Mac app keeps them in its own storage. If the
  history cannot be read, the dialogs say so (`The history cannot be read (no detail is known). Your
  files are not affected.`) and offer **Delete History and Trash**; files can still be saved.
- *Other windows.* A version saved in one window shows in the list of another that has the dialog
  open. When a file you have open, unchanged, is changed by another window, or by another program in a
  folder of your computer, a message says `"prog.X68" was changed outside this window.` with
  **Reload**.

### PDF files and pictures

Opening a ``.pdf`` or a picture (``.png``, ``.jpg``, ``.jpeg``, ``.gif``, ``.bmp``, ``.webp``, ``.svg``, ``.ico``) from the Files panel,
File > Open File... or a drop shows it in a viewer: a tab beside the Editor, named after the file. Files
of the original (``.X68``, ``.L68``, ``.S68``) always open as text. A viewer is not a document: Save and
Assemble do not act on it, the Window menu does not list it, and it is closed after a reload. A
document you open, create or choose in the Window menu comes in front of the viewer; the viewer's
tab stays beside the Editor's.

- The strip has the name and the size, **Open as Text** (opens the file as a document, as the
  original would), **Export** (in the browser: downloads the file) and, for a picture, **Actual Size**,
  which switches between one pixel to one pixel and scaled to fit.
- A PDF is drawn by the browser's own PDF viewer. A link inside the PDF does not take the viewer
  elsewhere: it shows its PDF again. (In Safari a link to another site can leave the box empty;
  close the viewer's tab and open the file again.) Under the strip: `If the PDF does not appear, use
  Export and open it with another program.` In the Mac app: `If the PDF does not appear, open it from
  its folder with another program.` If your browser shows no PDF at all, the viewer says `"report.pdf"
  cannot be shown here because this browser does not show PDF files.` No person has tried the PDF
  viewer yet, in any browser or in the Mac app. On Windows, a test machine saw it draw a PDF in
  Chromium, Chrome, Edge and the desktop app; Safari has not been tried at all.
- Another file with a zero byte near its start gets `"data.bin" does not look like text. Opened as
  text, it will probably look like nonsense.` with **Open as Text** and **Export**.
- The include files that the assembler names in its messages always open as text.

### Port Additions

**Options > Port Additions...** (in the Editor and the Simulator) opens **Port Additions**. Its two boxes
are **Show PDF files and pictures in a viewer instead of as text** and **Keep earlier versions of saved
files and a Trash for deleted files**; both are checked at first. Unchecked, every file opens as text,
and nothing is kept: Delete, Replace and Restore then say `This cannot be undone.` What was kept
before stays until you delete it. OK stores the boxes; Cancel does not.

The group **Storage** shows how much is used: **My Programs:**, **Earlier versions:** and **Trash:**
with a number of files and a size each, and a line such as `This site uses 7.9 MB in this browser,
about 1.8 GB free`. **Empty Trash** and **Delete Earlier Versions** act at once, after a question; the
second asks `Delete all earlier versions of all files for good? Your current files are not
affected.`

### Taking your work out

A copy of your files outside the browser is still the only backup. In the Files panel, select what you
want (one file, a folder, several items with Ctrl+click, or My Programs itself) and click the Export
button: a file comes as itself, anything else as one ``.zip`` in your Downloads folder. Import...
brings it back. In a folder of your computer, or in the Mac app, your files are already on the disk.

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
  (some private windows do that). Use a normal window, and export what you want to keep (the Export button of the Files panel).
- **The page says that files are NOT being saved right now, because the browser's storage did not
  answer**: another tab of this site, or a page that was closed during a save, may still be holding
  the storage. Your saved programs are still there: reload the page in a minute. Until then,
  export what you want to keep (the Export button of the Files panel).
- **The simulator or the assembler "could not be loaded"**: reload the page. If it persists, the
  browser may be too old.
- **The message area says `Not available to the program: ...`**: in the web version, a running
  program may open at most 2,000 files of its folder and the folders below it (each at most 32 MB).
  A folder with many other files can use up that limit. The files of a `.git` folder are counted
  after all the others, so a Git repository no longer crowds out a program's own files, and a
  `.git` file that is left out is not named. Run the program from a folder that holds only what it
  needs.
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
