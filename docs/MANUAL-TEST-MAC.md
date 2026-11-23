# Manual test on a real Mac

The automatic tests of this project run on GitHub's Mac, Windows and Linux machines, in the engines
of Chrome and Safari. Some things they cannot see: what macOS shows when you open the app, what
you hear, what a real keyboard sends, what Safari itself (not its test engine) does with a key. This
list is for a person with a Mac. Nobody has worked through it yet.

You do not need to know anything about how the port is built. You need a Mac, Safari, Chrome, and
about **thirty minutes for part A**, the core of this list: a student with a Mac can do it in one
sitting. **Parts B and C are optional**: they need more time, other equipment (a printer, a serial
adapter, a second keyboard layout, a Windows PC) or the Mac app; do whatever of them you can. Every
check says what to do and what you should see. If you see something else, that is exactly what we
want to know.

**What must exist before you start.**

- Part A and most of part B need only the web version (below) and a network connection for the
  first visit. For a report on a release candidate, test the web version as it is after the
  commit the candidate names (the web version is rebuilt from the main branch a few minutes after
  every change, so write the date and time of your test into the report).
- The checks marked "Mac app" (B3, B6, the app rows D6 to D10 and F2, and E4) need **a download of the
  macOS app**. None exists yet: there is no release and no pre-release. The project's owner has to
  publish one (with the `.dmg` and `.zip` for Apple silicon and Intel) at
  <https://github.com/gurmyd/easy68k-cross-platform/releases> before anyone can do those checks.
- Part C needs a Windows PC and the project owner's permission.

**How to report.** Copy the report form at the end of this page, fill it in as you go, and post it as
an issue on <https://github.com/gurmyd/easy68k-cross-platform/issues> with the title
`Manual test report`. A photo or screenshot of anything odd helps (Shift+Cmd+4 takes a screenshot of
an area). Do not include anything personal.

**What happens with a check that fails.** Nothing of what you report is lost: a maintainer reads
each report and answers in the issue. A check that shows the application doing something wrong
becomes an issue of its own. A shortcut that a browser keeps for itself (a cell of A2 that is not
**ok**) is not a defect the page can repair: the maintainer adds it to part 3 of
`docs/DIFFERENCES.md` ("Shortcuts a browser does not give up"), with the browser, its version and
what happened, and that page then tells every user which menu entry to use instead.

**Words used here.**

- The **web version** is <https://gurmyd.github.io/easy68k-cross-platform/>.
- The **Mac app** is the downloadable app. There is none yet; the checks that need it say so.
- **Fn**: on most Mac keyboards the keys F1 to F12 change brightness and volume unless you hold
  the Fn (or globe) key. "Press F9" means Fn+F9 on such a keyboard.
- The **mode switch** is the group of three buttons at the top right: Editor, Simulator, EASyBIN.
- The **Output panel** is the black area on the right in Simulator mode. A program receives your
  keys only after you have clicked into it (a blue frame shows that it has the keyboard).

## Before you start

Write down in the report form:

1. Your Mac: Apple menu > About This Mac. Note the chip (Apple M1, M2 ... or Intel) and the macOS
   version.
2. Your keyboard: built into the Mac or separate; with a Touch Bar or not; the keyboard layout you
   use (the input menu at the top right of the screen, or System Settings > Keyboard > Text Input).
3. The versions of your browsers: Safari > About Safari; Chrome > Google Chrome > About Google Chrome;
   Edge if you have it.

## The three test programs

Some checks use one of these small programs. To use one: open the web version, choose File > New X68
Source File in Editor mode, delete the text in the new document (Cmd+A, then Delete), copy the program
from this page and paste it with Cmd+V. Then press F9 (or Cmd+B) to assemble, click **Execute** in the
window that opens, and press F9 again to run it. Each program was tried in the application before it
was put here.

**echo** and **keys** never end by themselves. If one of them is still running (or waiting for a
key) when you click Execute for the next program, a box `Caution` asks first:
`The current debug environment will be lost, click OK to continue.` That is the original's
question, and it is expected: click **OK**, and the new program replaces the old one (Cancel keeps
the old one).

**echo** reads a line you type and shows it again:

```
        ORG     $1000
START   LEA     PROMPT,A1
        MOVE.B  #14,D0          display the prompt, no new line
        TRAP    #15
        LEA     LINE,A1
        MOVE.B  #2,D0           read a line into LINE
        TRAP    #15
        LEA     SHOW,A1
        MOVE.B  #14,D0
        TRAP    #15
        LEA     LINE,A1
        MOVE.B  #13,D0          display the line and a new line
        TRAP    #15
        BRA     START

PROMPT  DC.B    'Type a line: ',0
SHOW    DC.B    'You typed:   ',0
LINE    DS.B    82
        END     START
```

**keys** shows the code of the last key pressed and the last key released (TRAP #15 task 19), and
whether the A key is down (`FF`) or up (`0`). A line `released/pressed: 410042` means: the last key
released was `$41` (A), the last key pressed was `$42` (B).

```
        ORG     $1000
START   MOVE.L  #-1,D6          last codes shown
        MOVE.L  #-1,D5          last state of A shown
LOOP    CLR.L   D1
        MOVE.B  #19,D0          D1 = released << 16 + pressed
        TRAP    #15
        MOVE.L  D1,D3
        MOVE.L  #$41,D1         is the A key down?
        MOVE.B  #19,D0
        TRAP    #15
        MOVE.L  D1,D4
        CMP.L   D6,D3
        BNE     SHOWIT
        CMP.L   D5,D4
        BEQ     LOOP
SHOWIT  MOVE.L  D3,D6
        MOVE.L  D4,D5
        LEA     UPDOWN,A1
        MOVE.B  #14,D0
        TRAP    #15
        MOVE.L  D3,D1
        MOVE.B  #16,D2          in hexadecimal
        MOVE.B  #15,D0
        TRAP    #15
        LEA     AKEY,A1
        MOVE.B  #14,D0
        TRAP    #15
        MOVE.L  D4,D1
        MOVE.B  #16,D2
        MOVE.B  #15,D0
        TRAP    #15
        LEA     CRLF,A1
        MOVE.B  #14,D0
        TRAP    #15
        BRA     LOOP

UPDOWN  DC.B    'released/pressed: ',0
AKEY    DC.B    '   A down: ',0
CRLF    DC.B    $D,$A,0
        END     START
```

**fonts** writes a line in each of the seven fonts a program can choose, adds up the colours of the
pixels in that area and shows the sum. With the default settings the sum is `B4818F4C` in Chrome's
and Safari's test engines.

```
        ORG     $1000
START   MOVEQ   #1,D6           font number 1 to 7
FONT    MOVE.L  #$00FFFFFF,D1   white
        MOVE.L  D6,D2
        ROR.L   #8,D2           font number into the top byte
        ORI.L   #$000C0000,D2   12 points, plain
        MOVE.B  #21,D0
        TRAP    #15
        LEA     TEXT,A1
        MOVE.B  #13,D0
        TRAP    #15
        ADDQ.L  #1,D6
        CMP.L   #8,D6
        BNE     FONT

        CLR.L   D5              the sum
        CLR.L   D2              y
ROW     CLR.L   D1              x
PIXEL   MOVE.B  #83,D0          D0 = colour of the pixel at D1, D2
        TRAP    #15
        ROL.L   #1,D5
        ADD.L   D0,D5
        ADDQ.W  #1,D1
        CMP.W   #320,D1
        BNE     PIXEL
        ADDQ.W  #1,D2
        CMP.W   #160,D2
        BNE     ROW

        MOVE.L  #$00FFFFFF,D1   back to the Options font
        CLR.L   D2
        MOVE.B  #21,D0
        TRAP    #15
        LEA     SUM,A1
        MOVE.B  #14,D0
        TRAP    #15
        MOVE.L  D5,D1
        MOVE.B  #16,D2
        MOVE.B  #15,D0
        TRAP    #15
        SIMHALT

TEXT    DC.B    'EASy68K 0123456789 {[(<>)]} @#$%&*',0
SUM     DC.B    'Sum: ',0
        END     START
```

## A fourth test program: sound

**sound** plays the sound files of the examples with every sound task, TRAP #15 tasks 70 to 77, one
step after the other. Before each step it writes what you should hear; you press a key for the next
step. It needs the examples' sound files, so it must be saved in the folder `Examples`:

1. Choose Help > Examples... once (it puts the folder `Examples` into My Programs).
2. File > New X68 Source File, delete the text (Cmd+A, then Delete), copy the program below from
   this page and paste it with Cmd+V.
3. File > Save As..., double-click the folder `Examples` in the list (the box `Look in:` then
   says `Examples`), type `sound.X68` into `File name:` and click **Save**.
4. Press F9, click **Execute**, press F9 again, and click into the Output panel (black, on the
   right) so that it gets your keys. Each step ends with `Press Space.`; press the space bar for
   the next one.

```
* sound: TRAP #15 tasks 70 to 77 one after the other (docs/MANUAL-TEST-MAC.md, B14)
        ORG     $1000
START   LEA     STEP1,A1        standard player, tasks 70, 71, 72, 76
        BSR     SAY
        LEA     ONE,A1
PLAY70  MOVE.W  #70,D0          task 70: play 1.wav
        TRAP    #15
        TST.W   D0              0 = the player is busy: try again
        BEQ     PLAY70
        LEA     ZERO,A1
        MOVE.B  #0,D1
        MOVE.W  #71,D0          task 71: 0.wav into slot 0
        TRAP    #15
PLAY72  MOVE.B  #0,D1
        MOVE.W  #72,D0          task 72: play slot 0
        TRAP    #15
        TST.W   D0
        BEQ     PLAY72
        LEA     ROGER,A1
        MOVE.B  #1,D1
        MOVE.W  #71,D0          task 71: roger.wav into slot 1
        TRAP    #15
PLAY76  MOVE.B  #1,D1
        CLR.L   D2              command 0: play once
        MOVE.W  #76,D0          task 76
        TRAP    #15
        TST.W   D0
        BEQ     PLAY76
        BSR     WAIT

        LEA     STEP2,A1        DirectX player, tasks 73, 74, 75, 77
        BSR     SAY
        LEA     CHIME,A1
        MOVE.W  #73,D0          task 73: play chime.wav
        TRAP    #15
        BSR     WAIT
        LEA     STEP3,A1
        BSR     SAY
        LEA     ROGER,A1
        MOVE.B  #2,D1
        MOVE.W  #74,D0          task 74: roger.wav into slot 2
        TRAP    #15
        MOVE.B  #2,D1
        MOVE.W  #75,D0          task 75: play slot 2
        TRAP    #15
        BSR     WAIT
        LEA     STEP4,A1
        BSR     SAY
        MOVE.B  #2,D1
        CLR.L   D2              command 0: play once
        MOVE.W  #77,D0          task 77
        TRAP    #15
        BSR     WAIT

        LEA     STEP5,A1        a loop, stopped, and started again
        BSR     SAY
        LEA     TICK,A1
        MOVE.B  #3,D1
        MOVE.W  #74,D0          task 74: tick.wav into slot 3
        TRAP    #15
        MOVE.B  #3,D1
        MOVEQ   #1,D2           command 1: loop
        MOVE.W  #77,D0
        TRAP    #15
        BSR     WAIT
        LEA     STEP6,A1
        BSR     SAY
        MOVE.B  #3,D1
        MOVEQ   #2,D2           command 2: stop this slot
        MOVE.W  #77,D0
        TRAP    #15
        BSR     WAIT
        LEA     STEP7,A1
        BSR     SAY
        MOVE.B  #3,D1
        MOVE.W  #75,D0          task 75 on the slot that looped
        TRAP    #15
        BSR     WAIT
        LEA     STEP8,A1
        BSR     SAY
        MOVE.B  #3,D1
        MOVEQ   #3,D2           command 3: stop all
        MOVE.W  #77,D0
        TRAP    #15
        BSR     WAIT

        LEA     STEP9,A1        two loops that outlive the program
        BSR     SAY
        LEA     TOCK,A1
        MOVE.B  #4,D1
        MOVE.W  #71,D0          task 71: tock.wav into slot 4
        TRAP    #15
        MOVE.B  #4,D1
        MOVEQ   #1,D2           command 1: loop
        MOVE.W  #76,D0          task 76
        TRAP    #15
        MOVE.B  #3,D1
        MOVEQ   #1,D2           command 1: loop
        MOVE.W  #77,D0          task 77
        TRAP    #15
        LEA     LAST,A1
        BSR     SAY
        SIMHALT

SAY     MOVE.W  #13,D0          the text at A1 and a new line
        TRAP    #15
        RTS
WAIT    LEA     PRESS,A1
        MOVE.W  #14,D0
        TRAP    #15
        MOVE.W  #5,D0           wait for a key (it is shown)
        TRAP    #15
        LEA     CRLF,A1
        MOVE.W  #14,D0
        TRAP    #15
        RTS

STEP1   DC.B    '1. You hear one, zero, roger, each once, in this order.',0
STEP2   DC.B    '2. You hear the chime once.',0
STEP3   DC.B    '3. You hear roger once.',0
STEP4   DC.B    '4. You hear roger once more.',0
STEP5   DC.B    '5. You hear tick, again and again.',0
STEP6   DC.B    '6. The ticking stops at once.',0
STEP7   DC.B    '7. Tick again and again, or only once: write down which.',0
STEP8   DC.B    '8. Silence.',0
STEP9   DC.B    '9. You hear tock and tick, again and again.',0
LAST    DC.B    'The program halts now. Both loops go on. Press Shift+F2.',0
PRESS   DC.B    '   Press Space.',0
CRLF    DC.B    $D,$A,0
ONE     DC.B    '1.wav',0
ZERO    DC.B    '0.wav',0
ROGER   DC.B    'roger.wav',0
CHIME   DC.B    'chime.wav',0
TICK    DC.B    'tick.wav',0
TOCK    DC.B    'tock.wav',0
        END     START
```

## Part A: half an hour with a Mac

The times in the headings add up to about half an hour (27 minutes), counted as a person does the
steps: pasting and assembling the test programs, each row in every browser it names. If you have
less time, do A1, A2 and A6 first.

### A1. A first program in Safari (3 minutes)

1. Open the web version in Safari.
2. Help > Examples... The Files panel opens on the left with a folder `Examples`, selected but
   closed.
3. Open the folder: click the small arrow in front of `Examples` (or click `Examples` and press
   the Right arrow key).
   Its files appear below it. Double-click `tutorial1.X68`. It opens in the editor.
4. Press F9 (or Cmd+B). A window `Assembler Status - tutorial1.X68` says 0 warnings and 0 errors.
5. Click **Execute**. The application switches to Simulator mode with the program loaded.
6. Press F9. The Output panel shows four lines: `D1 contains: 8`, `D2 contains: 520`,
   `D3 contains: 68020`, `Program End`. The status bar at the bottom says `Halted`.

Repeat steps 1 to 6 in Chrome.

### A2. Shortcuts the browser must leave to the page (8 minutes)

A web page can ask the browser not to act on a key, and this application does for the keys below.
Whether a real browser obeys cannot be tested automatically. For each row, prepare what the column
"Before" says, press the key, and write in the table what happened: **ok** if the application did
what the row says and the browser did nothing of its own; otherwise what you saw (for example "the
page reloaded" or "Safari's own Save dialog"). A cell that is not **ok** is not your mistake and
not a failed test of yours: it is exactly the finding this table is for. Write down what you saw;
the maintainers add it to part 3 of `docs/DIFFERENCES.md` (see "What happens with a check that
fails" above).

Preparation: do A1 first. For Editor rows, click into the text of `tutorial1.X68`. For Simulator
rows, use the program as A1 left it (Execute again if it has halted). The F keys need Fn on most
Mac keyboards.

| # | Before | Press | The application must | The browser must not | Safari | Chrome | Edge |
|---|---|---|---|---|---|---|---|
| K1 | Simulator, program loaded, click on the listing | F5 | do nothing | reload the page | | | |
| K2 | Simulator: open `clockDigital.X68` from Examples, F9, Execute, F9 (it keeps running) | F6 | Pause: the status bar says `Stopped` | move the focus to the address bar | | | |
| K3 | Simulator, program stopped | F7 | Trace Into: the highlighted listing line moves on | ask about caret browsing | | | |
| K4 | Simulator, program stopped | F10 | Auto Trace: the listing steps on by itself; F6 stops it | open or focus a browser menu | | | |
| K5 | Editor, a changed document | Cmd+S | Save (the dot on the tab and `Modified` go away, or the application's own Save As dialog appears) | show its "Save page" dialog | | | |
| K6 | Editor | Ctrl+S | the same as Cmd+S | the same | | | |
| K7 | Editor | Cmd+P | Print: a print dialog whose preview shows only the program text | print the whole page with menus | | | |
| K8 | Editor | Ctrl+P | the same as Cmd+P | the same | | | |
| K9 | Editor | Cmd+O | the application's own Open dialog (it lists My Programs) | show the system's file chooser | | | |
| K10 | Editor | Ctrl+O | the same as Cmd+O | the same | | | |
| K11 | Editor | Cmd+F | the application's Find dialog (top right of the editor) | show its own find bar | | | |
| K12 | Editor | Ctrl+F | the same as Cmd+F | the same | | | |
| K13 | Editor, after a Find | Cmd+G | Find Next | find in the page | | | |
| K14 | Simulator, program stopped | Ctrl+G | Go to PC: the listing shows the PC's line | find in the page | | | |
| K15 | Editor | Ctrl+R | the Find And Replace dialog | reload the page | | | |

Cmd+R is not in the table: in a browser on a Mac it is left to the browser (it reloads the page;
Find And Replace is Ctrl+R there).

### A3. The keyboard of a Mac (4 minutes)

Use Safari unless the row says otherwise.

| # | Do | Expected |
|---|---|---|
| M1 | Simulator, program loaded: press F9 with Fn and, if your keyboard's F keys are set to brightness and volume, without Fn | With Fn: Run. Without Fn: the Mac changes brightness or volume and the program does not run. (With "Use F1, F2, etc. keys as standard function keys" switched on in System Settings > Keyboard, it is the other way round.) |
| M2 | Simulator, program loaded: Shift+F2, Shift+F3, Shift+F4, Shift+F5 (with Fn if needed) | Rewind Program, Reload Program, Log Start (a log file dialog), Log Stop. Cancel any dialog. |
| M3 | Simulator: Ctrl+F2 | Either Rewind Program, or macOS moves the focus to the menu bar of the screen (its standard shortcut, System Settings > Keyboard > Keyboard Shortcuts > Keyboard). Write down which. |
| M4 | Editor: type a word, then Cmd+Z, then Ctrl+Option+Z | Undo, then Redo: the word comes back |
| M5 | Editor: select two lines, Ctrl+Option+C, then Ctrl+Option+U | A `*` is put in front of each line, then removed |
| M6 | Simulator: run **keys**, click into the Output panel, press Ctrl+Option+O | The blue frame leaves the Output panel; the program shows no new line |
| M7 | Run **keys**, click into the Output panel, press Option+Return | The Output panel goes full screen. Option+Return again (or Esc in Safari) leaves it |
| M8 | Only with a Touch Bar: hold Fn and look at the Touch Bar, press F9 there in Simulator mode | F1 to F12 appear; F9 runs the program |
| M9 | Run **echo**, click into the Output panel, hold the A key for two seconds, then Return | The letter repeats at your usual repeat rate, no accent menu appears, and the line comes back after `You typed:` |
| M10 | Run **keys**, click into the Output panel, hold Cmd, press and release A, then release Cmd | While Cmd is held the line may say `A down: FF`; after you release Cmd the last line says `A down: 0` (the A key does not stay down) |
| M11 | Only with a numeric keypad: run **keys**, press the keypad digits 0 to 9 | Codes `60` to `69` (or the codes of the arrow keys if the keypad is in navigation mode); write down what you see |

### A4. Cut, Copy and Paste (4 minutes)

| # | Do | Expected |
|---|---|---|
| P1 | Copy the text `HELLO` from anywhere. Run **echo**, click into the Output panel, press Cmd+V, then Return | `You typed:   HELLO` (in Safari and in Chrome) |
| P2 | Editor: Edit > Paste in the menu | Safari shows a small `Paste` button next to the pointer; click it and the text is pasted. Chrome asks once for permission to see the clipboard; after Allow it pastes. If the browser refuses, a message says `Press Cmd+V to paste` |
| P3 | Editor: the Paste button of the toolbar, and Paste in the menu of a right-click (Ctrl+click) into the text | The same as P2 |
| P4 | Editor, in Safari and in Chrome: type a line with a tab in it (Options > Editor Options..., Real Tabs on, or paste one), select it, Edit > Copy, then the Copy button of the toolbar, then Cmd+C, each time followed by Cmd+V into TextEdit. Then Edit > Cut and Cmd+V into TextEdit again, and Cmd+Z in the editor. Last, copy two lines in TextEdit and paste them into the editor with Cmd+V | TextEdit gets the selected text each time, the tab kept; Cut removes it from the editor and Cmd+Z brings it back; the two lines from TextEdit arrive as two lines |

### A5. Sound (4 minutes)

Use the examples (Help > Examples...), speakers or headphones on. The program **sound**, which
plays every sound task in turn, is part B14.

| # | Do | Expected |
|---|---|---|
| S1 | Open `graphicSound.X68`, F9, Execute, F9 | You hear "one", then "zero", then "roger", each once, in this order, without overlapping; the program halts after "roger" starts |
| S2 | Open `clockWithSound.X68`, F9, Execute, F9, and wait until the drawn clock passes the next full minute (at most one minute) | Tick and tock every second, in step with the drawn clock; a chime at the full minute |
| S3 | While S2 runs: Run > Rewind Program (Shift+F2) | The sounds stop |
| S4 | Run `graphicSound.X68` and switch to another tab at once; come back after five seconds | The program has halted; no sound plays late in a burst |
| S5 | Reload the page, open `graphicSound.X68`, and do everything with the keyboard only (F9, Return on Execute, F9) | The sound is heard (a key press is enough to let a page play sound) |

### A6. Recording what your keyboard sends (4 minutes)

The keyboard tests of this project use key presses recorded from real keyboards. None has been
recorded yet. This step records yours. It does not use the application.

1. In Chrome, open a new tab, type `about:blank` in the address bar and press Return.
2. Open the developer console: View > Developer > JavaScript Console (Option+Cmd+J).
3. Paste this and press Return:

   ```js
   addEventListener(
     'keydown',
     (e) => {
       e.preventDefault(); // keeps the browser from acting on Ctrl+S, Cmd+O and the like
       const { key, code, ctrlKey, altKey, shiftKey, metaKey } = e;
       console.log(JSON.stringify({ key, code, ctrlKey, altKey, shiftKey, metaKey }));
     },
     true,
   );
   ```

4. Click into the empty page and press, with the U.S. or ABC layout: Cmd+O, Ctrl+O, Shift+Cmd+S,
   Shift+Cmd+Z, Option+O, Ctrl+Option+O, Ctrl+Option+Z, Ctrl+Option+C, Ctrl+Option+U, Cmd+/,
   Shift+Cmd+/, Cmd+, (comma), Cmd+G, Cmd+B, Ctrl+R, Ctrl+Shift+I, Option+Return, Shift+F2,
   Shift+F4, Ctrl+F9, Cmd+V. If you have switched off the system's Ctrl+F<n> shortcuts (System
   Settings > Keyboard > Keyboard Shortcuts > Keyboard), also Ctrl+F2 and Ctrl+F4.
5. If you can add the Russian input source: switch to it and press Cmd + the O position, Ctrl + the
   O position, Ctrl+Option + the O position (the O position is the key where O is on a U.S.
   keyboard).
6. Do the same in Safari (Develop > Show JavaScript Console; if there is no Develop menu, switch it on
   in Safari > Settings > Advanced).
7. Right-click in the console, choose to save or copy everything, and attach it to the report with
   your macOS and browser versions, the keyboard model and the layout.

Do **not** press Cmd+Q, Cmd+W, Cmd+N or Cmd+T: the browser closes or opens windows before the page
sees them.

## Part B (optional): with more time or other equipment

Every section of part B stands alone; do any of them, in any order.

### B1. Another keyboard layout (5 minutes)

Add a second layout if you have only one (System Settings > Keyboard > Text Input > Edit > +; for
example French, or U.S. International - PC, or ABC - Extended). Switch to it with the input menu.

| # | Do | Expected |
|---|---|---|
| L1 | Run **echo**, click into the Output panel. Type an accented letter with a dead key: Option+E then E (gives é on most layouts). Then Option+U then A (ä). Return | The line shows `é` and `ä`, each once; nothing doubled, nothing missing |
| L2 | Same prompt: type a few Option characters, for example Option+G (©), Option+2 (™), Option+8 (•) on U.S.; on French, the € and @ keys. Return | The characters appear as typed, if Windows-1252 has them (©, ™, •, €, @ do); a character it does not have is left out |
| L3 | Run **keys** with the French layout (AZERTY). Press the key labelled A | The pressed code is `51`: the port reports where the key is on a US keyboard (Q), not its label. This is a known difference (`docs/DIFFERENCES.md`, part SH4). Write down what you see |
| L4 | Only if you use an input method (Japanese, Chinese, Korean): in **echo**, type a word with it and confirm it, then Return | The composed word appears once. Characters Windows-1252 does not have are left out, so it may come back empty: write down what you saw |

### B2. Safari itself (15 minutes)

| # | Do | Expected |
|---|---|---|
| W0 | First, in Safari > Settings > Privacy > Manage Website Data..., remove the site of the web version if it is listed. Open the web version | Above `My Programs` in the Files panel a notice says: `This browser may delete the programs kept here after seven days without a visit to this page. An app made with "Add to Dock" or "Add to Home Screen" starts with its own, empty My Programs. Use Export... in the Files panel to save them all as a .zip, and Import... in the app to bring them over.` Click its **Export...**: `My Programs.zip` is downloaded. Click **Got it**: the notice goes, and it does not come back when you reload the page. (Chrome shows no such notice) |
| W1 | Open the web version, wait until it shows the editor, close the tab and open the web version again (the second visit is the one the stored copy serves). Switch Wi-Fi off. Reload the page. Then Help > Help, click two links from one help page to another, and Help > Differences from EASy68K | The application loads and works (assemble tutorial1) without a network. The help pages show, their links lead to the other help pages, and the Differences page shows, all with Wi-Fi off (Playwright's WebKit is not Safari: this is the only test of it in Safari itself; erratum H1 11) |
| W2 | Safari > File > Add to Dock... (macOS 14 Sonoma or later), then open EASy68K from the Dock | It opens in a window of its own. Its Files panel (My Programs) is empty: a Dock app has its own storage. That is Apple's rule, not a defect. Above the empty My Programs a notice says: `This app keeps its own programs, apart from the browser's: Import... in the Files panel brings over programs exported there.`, with **Import...** and **Got it** (leave it; W4 uses Import...) |
| W3 | In the Safari tab: click `My Programs` in the Files panel, then the Export button of the panel (its tool tip reads Export all of My Programs as My Programs.zip) | A file `My Programs.zip` is downloaded |
| W4 | In the Dock app: Import... in the Files panel, choose that `My Programs.zip` | The files of the Safari tab appear in the Dock app |
| W5 | Safari > File > New Private Window, open the web version, run **fonts**. Then close the private window, open a new one and run it again | `Sum: B4818F4C` both times (Safari changes some pictures in private windows to stop tracking; this checks that the application's text is not affected) |
| W6 | Normal Safari window: run **fonts** | `Sum: B4818F4C` |
| W7 | Only if you have an iPhone or iPad at hand (it is not tested anywhere else): open the web version in Safari there, after removing its website data (Settings > Apps > Safari > Advanced > Website Data). Then Share > Add to Home Screen, and open it from the Home Screen | In Safari, the Files panel (left; the toolbar button at the far left shows it) has the notice of W0, word for word. The Home Screen app has an empty My Programs with the notice of W2, word for word. Write down the device and its iOS or iPadOS version |
| W8 | You need one large file of 200 MB or more, for example a film. (Or make one: open Terminal, type `mkfile 200m ~/Desktop/big.bin` and press Return; the file `big.bin` appears on the Desktop.) In a normal Safari window open the web version and choose Help > Examples... so that My Programs holds something. In the Files panel click Import... and choose the large file. At once, while it is being imported, force Safari to quit: press Option+Cmd+Esc, select Safari, click Force Quit. Open Safari and the web version again. Then do it all a second time, but this time close the tab with Cmd+W during the import instead of force-quitting | Each time, within a few seconds the editor is shown and My Programs lists the folder `Examples` and everything saved before. The large file is either not there or whole (the same size as the original), never cut short. If the Files panel says `My Programs is still opening`, count the seconds: within 20 s it must show your files, or this text: `Files are NOT being saved right now: the browser's storage did not answer (reading the list of files took longer than 20 s; another tab of this site, or a page that was closed during a save, may still be holding it). The programs you saved before are still in the browser: reload the page in a minute to see them. What you save until then is lost when this tab closes. Use the Export button of the Files panel to keep it.` If you see that text, wait a minute and reload the page: every file saved before must be there. If they are not there yet, reload again once a minute, up to five minutes, and write down after how many minutes they came back. If they still have not come back, quit Safari completely (Safari > Quit Safari), open it and the web version again, and write down whether they are there now. Write down which of these you saw, for each of the two tries how many seconds the Files panel took to show your files, and the macOS and Safari versions |

### B3. The Mac app (only once a release exists)

There is no release yet. When there is one, download the `.dmg` for your Mac from
<https://github.com/gurmyd/easy68k-cross-platform/releases>. The first start needs the steps below
(the same text as in the README and in the notes of every release; `docs/differences/DV3.md` holds
the original). Follow them exactly, and note in D1 where what you see differs from what they say.

<!-- first-start:begin -->
The Mac app is not notarised by Apple (the project has no paid Apple developer account), so macOS
blocks it the first time. This happens once; after that EASy68K opens like any other app. If you
cannot or do not want to do this (for example on a Mac managed by your school, where these settings
may be locked), use the web version instead: it does the same in Safari or Chrome and needs no
installation.

The Mac app needs macOS 13 (Ventura) or later.

**Install.** Download the `.dmg` for your Mac (`arm64` for Apple silicon, M1 and later; `x64` for
Intel; Apple menu > About This Mac tells you which), open it and drag **EASy68K** into
**Applications**. (Or download the `.zip`, which macOS unpacks into `EASy68K.app`, and move that
into Applications.)

**What you will see.** When you open EASy68K for the first time, macOS shows a message instead of
starting it. On macOS 15 (Sequoia) and later it reads "“EASy68K” Not Opened. Apple could not verify
“EASy68K” is free of malware that may harm your Mac or compromise your privacy.", with the buttons
**Done** and **Move to Trash**; older versions say "“EASy68K” cannot be opened because the developer
cannot be verified." Some versions instead say that "“EASy68K” is damaged and can't be opened". The
app is not damaged: this is how macOS words the same block for an app that is not notarised. Click
**Done** (or **Cancel**), never **Move to Trash**.

**Way 1: System Settings** (for the "Not Opened" or "developer cannot be verified" message)

1. Open **System Settings** (Apple menu > System Settings) and choose **Privacy & Security** in the
   sidebar.
2. Scroll down to the **Security** section. It shows "“EASy68K” was blocked to protect your Mac."
   (The line appears for about an hour after you tried to open the app; if it is gone, try to open
   EASy68K once more.)
3. Click **Open Anyway** and confirm with your password or Touch ID.
4. Open EASy68K again. macOS asks a last time; click **Open Anyway** (or **Open**).

On macOS 14 (Sonoma) and earlier you can instead Control-click (or right-click) EASy68K in
Applications, choose **Open** from the menu and then click **Open** in the message.

**Way 2: Terminal** (works for every message, including "is damaged")

1. Open **Terminal** (Applications > Utilities > Terminal).
2. Paste this line and press Return. It removes the quarantine mark from the app, and asks for
   nothing:

   ```
   xattr -dr com.apple.quarantine /Applications/EASy68K.app
   ```

3. Open EASy68K as usual.

If you put the app somewhere else than Applications, use its path in the command instead (you can
type `xattr -dr com.apple.quarantine ` and then drag the app onto the Terminal window).
<!-- first-start:end -->

| # | Do | Expected |
|---|---|---|
| D1 | First start after the download, following the steps above | macOS refuses to open it. Write down the exact text of the message and its buttons, and which of the two ways worked. Note any message about XProtect or malware |
| D2 | The same on the other kind of Mac (Apple silicon or Intel) and on the two most recent macOS versions, if you have them | As D1 |
| D3 | In Finder, double-click a `.X68`, a `.L68` and a `.S68` file | `.X68` and `.L68` open in Editor mode; `.S68` opens in Simulator mode with the program loaded and not running. Write down what icon Finder shows on these files, and what Get Info > Open with says (EASy68K is expected) |
| D4 | Look at the Dock while the app runs | The EASy68K icon is there, with a dot under it |
| D5 | Change a document without saving, then Cmd+Q | A question about the unsaved document appears; Cancel (or Stay) keeps the app running |
| D6 | Repeat A1, S1 and S2 in the app; during S2 switch the sound output to headphones | The same results; the sound moves to the headphones and goes on |
| D7 | Run **echo** in the app, Cmd+V into the prompt | As P1 |
| D8 | Run **keys** in the app, full screen with Option+Return, press Esc | The program shows code `1B` and the panel stays full screen (in Safari, Esc leaves full screen instead: see F2) |
| D9 | Simulator mode: Options > Serial Ports... (with a USB serial adapter plugged in, if you have one). Add Port, type `COM4` twice as a name | The dialog lists the ports set up (none at first) and offers `Detected devices...` with your adapter (`/dev/cu.<something>`); with no adapter it says `No serial devices were found on this computer.` With a name twice, the second Name field says `com4 is in the list twice.` under it, the rows stay aligned and OK is greyed. Cancel changes nothing |
| D10 | In the app's editor: Edit > Paste, then the Paste button of the toolbar, then Paste in the right-click menu of the text, with a word copied in TextEdit; then P4 in the app | The word is pasted each time, with no question and no message (the app reads the clipboard itself); P4's results as in the browsers |

### B4. Full screen, display and trackpad

| # | Do | Expected |
|---|---|---|
| F1 | Run **keys**, Option+Return, on the built-in display and on an external monitor | The output fills the screen at the largest whole size, black around it |
| F2 | In full screen, press Esc in Chrome, in Safari and in the Mac app | Chrome and the app: the program shows code `1B` and full screen stays. Safari: full screen ends and the program gets no key (a known difference, note 36 of `docs/DIFFERENCES.md`) |
| F3 | On a Retina display: Output panel zoom `200%`, run `graphicSound.X68` | Sharp square pixels, no blur |
| F4 | Run `mouseWindowSize.X68` (it shows the mouse position and buttons and draws a green crosshair): tap the trackpad, click with two fingers (right-click), drag | The program shows the left button for a tap, the right button for a two-finger click, and the position follows while dragging |

### B5. Printing (needs a printer)

| # | Do | Expected |
|---|---|---|
| R1 | Editor: open `tutorial1.X68`, File > Print, print on a real printer | The program text, nothing of the application around it |
| R2 | A program that prints with TRAP #15 task 10 (A1 = the address of a text ending in a zero byte, `MOVE.B #10,D0`, `TRAP #15`; a byte `$0C` in the text ends a page) | A `Printer Output` dialog opens by itself at each `$0C`; its Print... button shows the system's print dialog and the page comes out of the printer |

### B6. Serial port and network (needs the Mac app)

| # | Do | Expected |
|---|---|---|
| N1 | A USB serial adapter, mapped to `COM1` in Options > Serial Ports... (D9), and a program using TRAP #15 tasks 40-43, with the adapter looped back (or connected to another computer's terminal program) | The program opens the port, sends and receives; a change of baud rate, parity or stop bits with task 41 reaches the other side. Rewind and Reload leave the port open; Execute (or a new program) closes it. (The automatic tests use a pseudo-terminal, never a real adapter, and never the downloaded app.) |
| N2 | Two windows of the app (File > New Window, Cmd+N), one program as server and one as client with the network tasks 100-107 | They exchange data |
| N3 | The same on two Macs in the same network | They exchange data |
| N4 | A TCP client (task 100) to an address in your network where no computer answers | The program waits about five seconds in task 100, then goes on with D0 = 0; its later sends report 0 bytes. The window stays usable while it waits |

### B7. VoiceOver and the keyboard alone

For V1 to V7, V10 and V11, switch VoiceOver on with Cmd+F5 (Fn+Cmd+F5). Write down what it says, and anything you
cannot reach. V8 and V9 are done without VoiceOver.

| # | Do | Expected |
|---|---|---|
| V1 | The menu bar of the application (Tab to it, or click File) | The menus and their items are read |
| V2 | Assemble a program with an error; the Assembler Status window | Its title, Warnings and Errors and the buttons are read |
| V3 | The Messages panel under the editor after that | The message line is read |
| V4 | Run tutorial1; move VoiceOver to the Output panel | The program's text is read (the panel has a text copy for screen readers) |
| V5 | In Safari, Tab through a dialog (Options > Editor Options...) | Tab reaches every control of the dialog |
| V6 | Run tutorial1 to its end (F9 until the status bar says `Halted`) | VoiceOver says `Halted` (or the program's end) without you moving to the status bar |
| V7 | Execute tutorial1; Options > Log Output..., set the execution log to anything but Disabled, OK; Run > Log Start (Shift+F4), accept the log file; then run the program to its end with F9 | When the program halts, the message box `Current Log Stopped.` (title `Information`) appears, and VoiceOver reads it as soon as it appears |
| V8 | VoiceOver off. Do A1 in Safari with the keyboard only: Tab, the arrow keys, Return, Space, F9 and Ctrl+Option+O, no mouse or trackpad. Once with Safari > Settings > Advanced > "Press Tab to highlight each item on a webpage" off (the default), once on | You can open the example, assemble, Execute, run, set a breakpoint on a listing line (Space) and step (F7), and you always see where the focus is. Write down any place where the focus disappeared or got stuck |
| V9 | In the light and in the dark theme (the button at the top right): Tab into the Output panel | The frame that shows the panel has the keyboard is clearly visible against the black panel and the window around it |
| V10 | VoiceOver on, Editor mode. Window > Move Panel To... Choose the panel Files, the choice `Into the group of`, the panel Editor, and press OK | The dialog's controls are read with their names. After OK VoiceOver says `Files moved into the group of Editor.` without you moving to it, and the keyboard is inside the moved panel |
| V11 | VoiceOver on, in Simulator mode, with the Memory panel shown (View menu), at any window size. View > Lock Layout (so that it is unchecked). In a wide window the Memory panel has a group of its own; put it into the group of the Output panel first: View > Move Panel To..., the panel Memory, the choice `Into the group of`, the panel Output, OK (in a window narrower than about 1100 pixels the two already share a group: skip this). Then move to the tab of the Memory panel, open its menu (Shift+F10, or VoiceOver's own context menu command) and choose Move Tab Earlier; then open the menu of the Registers tab and choose Move Right | The menu is read (`Panel tab`) with its items; each choice is announced, in one of the forms `<panel> moved into the group of <panel>.`, `<panel> moved to position <n> of its group.`, `<panel> moved beside <panel>, right.` or `<panel> moved to the right edge of the window.`; the panels are read in the order they are on the screen, from left to right and top to bottom |

### B8. A long session in Safari (30 minutes)

| # | Do | Expected |
|---|---|---|
| T1 | In one Safari tab: open `tutorial1.X68`, then repeat F9 (assemble), Execute, F9 (run) one hundred times | No error, no slowdown, no reload needed |
| T2 | In the same tab: press F9 in the editor several hundred times | Every assembly ends with 0 errors |

### B9. A folder of your computer (Chrome or Edge, Mac or Windows)

Safari cannot open folders; Chrome and Edge can. Use a folder with a copy of some `.X68` files.

| # | Do | Expected |
|---|---|---|
| G1 | File > Open File..., `Open folder...`, choose the folder | Chrome asks "Let site edit files?"; after Allow the folder appears in the dialog and the Files panel |
| G2 | Reload the page | A message `The folder "<name>" was open the last time. Open it again?`; its button shows Chrome's permission question; after Allow the folder is back. With "Allow on every visit" the next reload opens it without asking |
| G3 | In the Open dialog, `From this computer...`, choose a `.X68`, change it, Save | Chrome asks to save changes to the file; the file on the disk has the new text (open it in TextEdit) |
| G4 | Change that file in another editor while it is open in the application, then Save in the application | `'<name>' has been changed outside this window. Save anyway?`; No keeps the other version |
| G5 | After a reload, change the file in another editor, open it again in the application without changing it, Save | The application refuses to save and the file keeps the other editor's version |
| G6 | Drag a folder from Finder onto the window | `Open this folder?`; Yes opens it |
| G7 | A read-only file in the folder (Finder: Get Info > Sharing & Permissions, your name: Read only): open it, change it, Save | An error message; the file is unchanged |
| G8 | A folder containing a symbolic link (alias made with `ln -s` in Terminal) to a folder outside it | Nothing outside the folder can be opened through the link |
| G9 | While a folder is open: Chrome's site settings (the icon left of the address) > remove file access; then Save | `The browser does not allow this page to use "<name>" at the moment...` |
| G10 | On a file opened with `From this computer...`: `Open the containing folder...` | The folder chooser starts in the file's folder |

### B10. Windows PC: the same shortcut table, paste, keyboards

If you also have a Windows PC, do A2 in Chrome and Edge on Windows. There the keys are Ctrl, not
Cmd: only rows K1 to K4, K6, K8, K10, K12, K14 and K15 apply, and in K13 press F3. Also:

| # | Do | Expected |
|---|---|---|
| X1 | Chrome on Windows: run **echo**, copy `HELLO`, click into the Output panel, Shift+Insert, Enter | `You typed:   HELLO` |
| X2 | Chrome on Windows: Paste from the editor's Edit menu, its toolbar and its right-click menu | As P2 |
| X5 | Chrome on Windows: P4 with Ctrl+C, Ctrl+X, Ctrl+V and Ctrl+Z, and Notepad instead of TextEdit | As P4 |
| X3 | Record the keyboard as in A6, in Chrome and in Firefox, pressing for each keyboard and layout you have: **Windows or Linux, US**: Ctrl+O, Ctrl+S, Ctrl+Z, Ctrl+Alt+Z, Ctrl+Alt+C, Ctrl+Alt+U, Ctrl+Alt+O, Ctrl+O with Caps Lock, F9, Ctrl+F9, Shift+F4, F1, Insert, Shift+Insert, Ctrl+Shift+. (period), Ctrl+Shift+, (comma), Alt+Enter, Alt + the keypad's Enter, Alt+F, A. **the same, numeric keypad**: NumLock off: 0, Shift+0, . (Del), 1 to 9, Ctrl+7; NumLock on: 0, Ctrl+1, . (decimal), +. **Windows, German (QWERTZ)**: Ctrl + the key labelled Z, Ctrl + the key labelled Y, Ctrl+Alt + the keys labelled Z, Y, C and U, AltGr+Q, AltGr+E, Ctrl+Shift+. (period). **Windows, French (AZERTY)**: Ctrl + the key labelled A, Ctrl + the key labelled Z, Ctrl + the key labelled M, Ctrl+Alt + the keys labelled A, Z and W, AltGr + the key labelled 0 (types @). **Windows, Russian**: Ctrl + the positions of O, S, Z and F of a US keyboard, Ctrl+Alt + the C position, F7. **Windows, Greek**: Ctrl + the positions of F, G and P of a US keyboard. | Send the console output with Windows, browser and keyboard versions. Do not press Ctrl+W, Ctrl+N, Ctrl+T, Ctrl+F4 or Ctrl+Tab |

A layout can be recorded without its keyboard: add it in the system's settings, switch to it and
press the key at the position named.

| # | Do | Expected |
|---|---|---|
| X4 | Only with the NVDA screen reader on Windows: repeat V1 to V7 in Chrome | As V1 to V7; write down what NVDA says |

### B11. The beep

| # | Do | Expected |
|---|---|---|
| S6 | Simulator, a program loaded: click into the D0 field of the register panel and type `G` (not a hexadecimal digit) | A short, quiet tone; the field does not change |

### B12. Build and test from the README on a Mac (for contributors, about an hour)

No automatic job follows the README's build steps literally on macOS: GitHub's Mac machines run the
tests, but the engines are built on Linux only, and the type check and lint run on Linux only.

| # | Do | Expected |
|---|---|---|
| B12 | On a Mac with Git and Node.js 24 (and the Xcode command line tools), run the commands of the README's section "For contributors: build and test" one after the other, exactly as written, then `npm run typecheck`, `npm run lint` and `npm run test:conformance` | Every command ends without an error; `npm test` and `npm run test:conformance` say that every test passed. Write down the first command that failed and its last lines |

### B13. Installing the web version from Chrome (2 minutes)

| # | Do | Expected |
|---|---|---|
| I1 | Open the web version in Chrome on the Mac and wait until the editor shows. Look at the right end of the address bar, or open Chrome's menu (the three dots) > Cast, save and share | Chrome offers to install it (an install icon in the address bar, or the menu entry `Install EASy68K...` or `Install page as app...`). After Install it opens in a window of its own, named EASy68K, and can be started again from the Dock or Launchpad. Write down the exact words Chrome used. (Uninstall it afterwards from its window's menu if you like.) |

### B14. Every sound task in turn (8 minutes)

Use Safari or Chrome, speakers or headphones on. It needs the fourth test program, **sound**,
saved in `Examples` as its section says (about three minutes).

| # | Do | Expected |
|---|---|---|
| S7 | Run **sound** (the fourth test program, saved in `Examples` as it says) and press Space after each step, up to step 8 | Each step sounds as its line says: 1 "one", "zero", "roger", each once, in this order, not overlapping; 2 the chime; 3 "roger"; 4 "roger" again; 5 tick, repeating; 6 the ticking stops at once; 7 tick repeating again (the port keeps a slot looping until it is loaded again or the program is reset; write down what you hear); 8 silence |
| S8 | Go on with Space to step 9, wait until the program has halted (status bar `Halted`), listen for five seconds, then press Shift+F2 (Rewind Program) | After the halt tock and tick go on repeating; Shift+F2 stops both at once |

### B15. A PDF in the viewer (Safari, Chrome and Edge; 10 minutes)

This is the check that `docs/requests/N0.md` (section 5) and `docs/ARCHITECTURE-PLUS.md` P3.4.2 leave to a person: that the browser's own PDF viewer draws a PDF inside the viewer's frame under the production policy. Use any small PDF file (a page of your course notes will do) and a picture (a `.png`). Repeat E1 and E2 in each browser you have: Safari, Chrome and Edge on the Mac, and, on a Windows PC, Chrome and Edge.

| # | Do | Expected |
|---|---|---|
| E1 | Open the web version. Files panel: Import..., choose the PDF. Double-click it in the Files panel | A tab named after the file opens beside the Editor, and the browser's own PDF viewer shows the pages, with its toolbar. Under the strip: `If the PDF does not appear, use Export and open it with another program.` If the box stays empty, write down the browser and its version: that is risk R4 for that browser. Open the browser's developer console (Safari: Develop > Show JavaScript Console; Chrome and Edge: Option+Cmd+J on a Mac, Ctrl+Shift+J on Windows) and write down any red line that names `frame-src` or `object-src` |
| E2 | In the viewer's strip: click Export, then Open as Text | Export downloads the PDF. Open as Text closes the viewer and opens the PDF's bytes as a text document (nonsense, as in the original). Reload the page: no viewer tab comes back |
| E3 | Import the picture and double-click it. Click Actual Size twice | The picture is shown scaled to fit, then at one pixel to one pixel with scroll bars, then scaled again. The button is pressed in the second state |
| E4 | Only with the Mac app (once a release exists): open the PDF from the Files panel of the app | The PDF is drawn. The strip has no Export. Under it: `If the PDF does not appear, open it from its folder with another program.` |
| E5 | Only with the Mac app (once a release exists): open a PDF that contains a link to a web page and a link to `index.html`, and click each in the viewer | Each time the viewer shows the PDF again within two seconds, never a second copy of the application, and the PDF does not flicker or reload by itself while you read it |

## Part C (optional): on real Windows, once (for the project's maintainers)

These need the official EASy68K on a real Windows PC, which the project's rules allow only once and
only with the owner's permission (decision O-2 in `docs/ARCHITECTURE.md`, section 10.2), in Windows
Sandbox or a throw-away virtual machine.

| # | Do | Expected |
|---|---|---|
| C1 | Run the programs in `tests/conformance/windows-confirm/` in the official SIM68K.exe | Each writes its findings to a file; they settle UNVERIFIED items of `docs/porting/trap15-tasks-0-59.md` section 12 and `docs/porting/trap15-tasks-60-up.md` section 15 that Wine cannot: how text is drawn and where it leaves the pen (`gdi-text.X68`), which keys reach a program (`keys-tab-f-keys.X68`) and the C library's file buffer of `docs/ARCHITECTURE.md` 3.8.4 (`stdio-buffer.X68`). The edge cases of reading and writing files were measured under Wine already (`docs/DIFFERENCES.md` part 4); `docs/porting/windows-confirmation.md` is the whole session |
| C2 | The RichEdit spot check of `docs/ARCHITECTURE.md` 6.2.2 | The official assembler gives the same output on Windows as under Wine for the flagged files |
| C3 | The speed measurement for `DEFAULT_IPS` with `tests/perf/calibrate.X68` (decision O-1; the steps are in `docs/porting/speed.md` section 5) | A measured instruction rate of the original |
| C4 | A program that calls TRAP #15 task 100 with the host name `255.255.255.255` written as text (A2 pointing to it) | D0 = 0 (the name is accepted) or D0 = 8 (not found). Write down which: the port gives 0 (`docs/porting/errata/DV4.md` entry 14) |
| C5 | TRAP #15 task 100 over TCP to an address where no computer answers, then task 102 a few times | Task 100 returns 0 after about five seconds and the sends report 0 bytes (the port's reading of Net.cpp, item V14 of `docs/porting/trap15-tasks-60-up.md` section 15). Write down what really happens |
| C6 | Run `graphicSound.X68`, `clockWithSound.X68`, `tutorial2.X68` and `mouseWindowSize.X68` of the examples in the official SIM68K.exe and in the port, and take a screenshot of each output window at the same point | The pictures look the same. (The port's whole-program pictures are checked only against the port itself, `tests/conformance/examples`; nothing has compared them with the original on Windows) |
| C7 | In SIM68K.exe, with a program loaded: click into the SR field of the main window between two digits and press Backspace | Write down what happens: a `0` typed at the caret (what `docs/porting/sim-ui.md` 4.4 and the port do), or the digit before the caret cleared (erratum W2 7) |

## Which check covers which item of the plan

`docs/ARCHITECTURE.md` section 6.8 lists what only a person can check. Every item is above:

| Item of 6.8 | Checks |
|---|---|
| First launch of the downloaded app: the Gatekeeper dialogs and the way through them, on the two most recent macOS versions, Apple silicon and Intel | D1, D2 |
| Double-click on `.X68`, `.L68`, `.S68` in Finder; icons; the app in the Dock; Cmd+Q with unsaved work | D3, D4, D5 |
| Sound: tasks 70-77 audible, in order, loops stop on reset | S1-S5, S7, S8, D6 |
| Browser shortcut table (Safari, Chrome, Edge on macOS; Chrome, Edge on Windows) | A2 (K1-K15), B10 |
| Keyboard on a real MacBook: function keys with and without Fn; Shift+F2..F5; the Option chords Ctrl+Option+Z, C, U and O; Option+Return; Touch Bar; a non-US layout (dead keys and Option characters into task 2, the key position for task 19); a held letter repeats with no accent menu; a key released while Cmd is held does not stay down; keypad digits | M1-M11, L1-L4 |
| Paste into a task 2 prompt with Cmd+V in Safari, Chrome and the app, with Shift+Insert in Chrome on Windows; Paste from the editor's menu, toolbar and context menu in each; Cut, Copy and Paste between the editor and another program, in each browser and in the app (the words of erratum DOC1 10) | P1-P4, D7, D10, X1, X2, X5 |
| Full screen on the built-in display and an external monitor; Esc in Chrome, the app and Safari; sharpness on Retina; trackpad tap, right-click and drag | M7, F1-F4, D8 |
| Printing a source file and task 10 output on a real printer | R1, R2 |
| A serial adapter with tasks 40-43; two windows, and two machines on a LAN, with the network tasks | N1-N4, D9 |
| VoiceOver: menu bar, dialogs, message area, the Output text mirror | V1-V7 |
| The PDF viewer of the stage of additions: a PDF appears under the production policy in Chrome and Edge on macOS and on Windows, in Safari, and in the desktop app | E1-E4 |
| Safari itself: the web app, offline reload, Add to Dock, a `.zip` exported from the Safari tab imported into the Dock app; Private Browsing: text in every font the same on every run; My Programs after Safari was force-quit or the tab closed during a save | A1, W1-W6, W8 |
| A long session: one hundred Execute cycles and several hundred assemblies in Safari | T1, T2 |
| On real Windows, once: the UNVERIFIED items, the RichEdit spot check, the speed measurement | C1-C7 |

And what the parts of the port left for a person:

| From | Checks |
|---|---|
| `docs/requests/W3-key-recording.md` (keys recorded from real keyboards) | A6, X3 |
| `docs/porting/errata/SH4.md` entry 21 (dead keys, input methods, key repeat, the accent menu) | L1, L2, L4, M9 |
| `docs/porting/errata/SH5.md` section 7 (what is heard), items 1-8: items 5 and 6 (a loop after SIMHALT, task 77 on a looping slot) with the test program **sound** | S1-S8, D6 |
| `docs/porting/errata/FS2.md`, "Manual checks" (real folders) | G1-G10 |
| `docs/requests/W2-dialog-focus-followups.md` (Safari with a person at the keyboard, a real input method) | V5, L4 |
| `docs/porting/errata/DV3.md` entries 11 and 21, `docs/differences/DV3.md` (the exact first-start messages, Cmd+Q, XProtect) | D1, D2, D5 |
| `docs/ENGINE-BINDING.md` section 7 (many cold starts and assemblies in real Safari) | T1, T2 |
| `docs/porting/errata/DV4.md` (a real USB serial adapter, the packaged app loading the serial module, the Serial Ports dialog on a real Mac; entry 14: a host name of `255.255.255.255` on Windows; entry 8 and V14: a TCP connection still pending after five seconds) | N1, N4, D9, C4, C5 |
| `docs/porting/errata/DV5.md` and `docs/porting/errata/DV3.md` (the downloaded app on an Intel Mac, whose screenshots in CI nobody has looked at) | D2, D6 |
| `docs/requests/N0.md` section 5.2 and 5.4 (the PDF in a real Safari, Chrome and Edge, not tried by a person), `docs/ARCHITECTURE-PLUS.md` P3.4.2 | E1-E4 |
| `docs/porting/errata/N6.md` entry 14 (the viewer's frame sent to another address in the desktop app, which has no service worker) | E5 |
| `docs/ARCHITECTURE-PLUS.md` P3.1.8 (a screen reader over a move of a panel and over the order of the panels) | V10, V11 |
| `docs/integration/rc.md`, the accessibility audit (the walk-throughs on a real Mac with Safari's Tab setting, a halt and `Current Log Stopped.` announced, the focus frame of the Output panel, real screen readers) | V6-V9, X4 |
| `docs/porting/errata/X3.md` entry 6 (a real Safari's canvas keeps colours exact; whole-program pictures against the original) | W5, W6, C6 |
| `docs/porting/errata/DOC1.md` (the README's build steps followed literally on a Mac) | B12 |
| `docs/porting/errata/W2.md` entry 7 (Backspace in the SR field of the original) | C7 |
| `docs/ARCHITECTURE.md` 6.9 item 7 (the app installs in Chromium: that a real Chrome offers it) | I1 |

## Report form

Copy this into the issue and fill it in. Leave out what you did not do.

```
Manual test report

Date:
Mac (chip, model):
macOS version:
Keyboard (built-in / separate, Touch Bar yes/no, layout):
Safari version:
Chrome version:
Edge version (if used):
Mac app version (if used):

A1 first program:   Safari:        Chrome:
A2 shortcuts (ok, or what happened):
  K1  F5        Safari:      Chrome:      Edge:
  K2  F6        Safari:      Chrome:      Edge:
  K3  F7        Safari:      Chrome:      Edge:
  K4  F10       Safari:      Chrome:      Edge:
  K5  Cmd+S     Safari:      Chrome:      Edge:
  K6  Ctrl+S    Safari:      Chrome:      Edge:
  K7  Cmd+P     Safari:      Chrome:      Edge:
  K8  Ctrl+P    Safari:      Chrome:      Edge:
  K9  Cmd+O     Safari:      Chrome:      Edge:
  K10 Ctrl+O    Safari:      Chrome:      Edge:
  K11 Cmd+F     Safari:      Chrome:      Edge:
  K12 Ctrl+F    Safari:      Chrome:      Edge:
  K13 Cmd+G     Safari:      Chrome:      Edge:
  K14 Ctrl+G    Safari:      Chrome:      Edge:
  K15 Ctrl+R    Safari:      Chrome:      Edge:
A3 keyboard: M1:   M2:   M3:   M4:   M5:   M6:   M7:   M8:   M9:   M10:   M11:
A4 cut, copy, paste: P1 Safari:   P1 Chrome:   P2 Safari:   P2 Chrome:   P3:   P4 Safari:   P4 Chrome:
A5 sound: S1:   S2:   S3:   S4:   S5:
A6 key recording: attached yes/no
B1 layouts (which layout): L1:   L2:   L3:   L4:
B2 Safari: W0:   W1:   W2:   W3:   W4:   W5 (both sums):   W6 (sum):   W7 (device, version):   W8 (what you saw, seconds for each try, minutes until a reload showed the files or whether quitting Safari was needed, macOS and Safari versions):
B3 Mac app (exact first-start message, which way worked): D1:   D2:   D3:   D4:   D5:   D6:   D7:   D8:   D9:   D10:
B7 VoiceOver and keyboard only: V1:   V2:   V3:   V4:   V5:   V6:   V7:   V8:   V9:   V10:   V11:
B13 Chrome install (its exact words): I1:
B14 sound program (browser): S7 (step 7: looping or once?):   S8:
B15 PDF viewer (browser and version for each): E1:   E2:   E3:   E4:   E5:
Other parts of B (any you did):
Anything else you noticed:
```
