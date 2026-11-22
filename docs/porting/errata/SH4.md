# Errata of SH4 (Keyboard, mouse, Output panel)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum SH4 <n>" or naming this file: 1, 6 (ARCHITECTURE.md 2.5 (first round)); 2 (ARCHITECTURE.md 3.12.1); 3, 4, 8, 9, 10, 11, 12, 13, 19 (ARCHITECTURE.md 3.6); 5, 14, 15, 17, 25 (ARCHITECTURE.md 2.5); 7 (ARCHITECTURE.md 2.9.4); 18 (ARCHITECTURE.md 2.9.4 rule 4 (through W3 29)); 21 (the manual list, `docs/MANUAL-TEST-MAC.md` (L1, L2, L4, M9)). Nothing to merge, because no statement of a document is wrong or missing: 16, 22, 23, 24 (records of the browser check); 20 (answers to other packages' notes).

What SH4 found while building `app/src/core/sim-host/input/` and `app/src/features/output/` from
`docs/ARCHITECTURE.md` sections 2.5, 2.9.4, 2.10, 3.6 and 4.3 and from trap15-a §3.9, tasks 19 and
24, trap15-b §8 and §9: where the document is silent, contradicts itself or cannot be met as
written, what the repository does, and why. Entries under **Contract** concern declarations or
conventions that other packages build against.

## Contract

### 1. Who makes the screen follow the full-screen flag (2.5, 3.12.1, `OutputDeviceDeps.setFullScreen`)

- Says: 2.5, the engine calls `host.setupWindow(true / false)` and "the panel" enters or leaves;
  when the user toggles, "the panel tells the engine (`SimOption.Fullscreen`)". 3.12.1 has
  `AppState.sim.output.fullScreen`. Nothing says how `OutputDeviceDeps.setFullScreen`, which the
  session (SH8) supplies, reaches the panel, or who writes the store's flag.
- Does: the Output feature follows **the engine's own flag**. Once per frame it reads
  `engine.getOption(SimOption.Fullscreen)` (`OutputModel.followEngine`, `features/output/model.ts`)
  and enters or leaves when the flag differs from what the panel shows. That one read covers every
  case of 2.5 - task 33 with `D1.L` = 1 or 2, the engine's own `setupWindow(false)` when execution
  stops in trace mode or halts - and needs nothing from `setFullScreen`. When the user toggles
  (Alt+Enter, the button, the command), when the browser refuses, and when the browser ends full
  screen, the feature sets the engine's flag with
  `controller.invoke((engine) => engine.setOption(SimOption.Fullscreen, on))`; until the flag is
  seen to have that value (the controller may queue the call), the engine's answer is not acted on.
- `AppState.sim.output.fullScreen`: the Output feature writes it from its own state ("full screen
  is on, or on its way") at every change and once per frame (`OutputModel.publishFullScreen`), and
  never reads it. SH8's session
  writes the same member when the engine asks (`host.setupWindow`) and at a cold start (its
  erratum C6). The two agree: the engine's flag changes in exactly those calls, and the feature
  follows the flag within a frame and writes the same value. Readers of the store (the box
  `Please deactivate fullscreen mode ...` of Fullscreen Options) therefore see "on" from the
  moment full screen is asked for, also while the panel still waits for a user gesture.
- The command `sim.output.fullscreen` toggles without an argument (the session runs it for the
  `/f` switch) and sets the state with the argument `true` or `false`.
- Proposed text for 2.5: "The engine's flag `SimOption.Fullscreen` is the state; the Output feature
  reads it once per frame and makes the screen follow, and sets it whenever the state changes on
  the user's or the browser's side."

### 2. `AppState.sim.output.width`, `height`, `textWrap` (3.12.1)

- Says: nothing about who writes them. The check mark of `Output Window Size` "follows the real
  size", also a size set by task 33, which no host callback reports to the interface.
- Does, since gate I1: **the session (SH8) is the one writer.** It mirrors
  `surface.back.width / height` and `text.state.textWrap` into the store once per frame
  (`features/run/session.ts`). The Output feature reads them there for the check marks of
  `Output Window Size` and `Output Window Text Wrap` and writes none of them; its two commands
  act on the session's parts (`host.setWindowSize`, `text.setTextWrap`) and the check marks follow
  at the next frame. Before the gate the feature wrote the same three values itself
  (`OutputModel.sync`), because the session did not exist yet.
- The panel itself does not wait for the mirror: the size in its header strip and the size of the
  canvas on screen come from the surface, in the same frame callback that resizes the canvas's
  backing store (`OutputPanel.tsx`). So the backing store and its size on screen always change
  together, whichever of the session's and the panel's frame callbacks runs first.
- A composition without SH8's session has to mirror the three values itself: the test bed of
  `features/output/testing/bed.ts` does, once per frame.

### 3. The zero-delay timer of a paste chord is the panel's (3.6, `KeyboardDeps`)

- Says: 3.6, "If no `paste` event follows (empty clipboard), the entry is posted without it from a
  zero-delay timer." `KeyboardDeps` is `{ post, os }`: `OutputKeyboard` lives in `core/` and has no
  timer.
- Does: the panel (`features/output/panel-input.ts`) arms the timer on `ctx.scheduler` and calls
  `keyboard.paste('')`, which sends the waiting key-down without text. `OutputKeyboard` also sends
  a waiting key-down by itself before anything else it is told (the next key-down, a key-up, text,
  a focus change), so the order of the entries never depends on when the timer fires.
- `OutputKeyboardApi.paste(text)` with **no** key-down waiting (the browser's own Paste command
  from its menu; a paste event that arrives after the key was already sent) posts the text as
  `char` entries, cut to 254 bytes. `InputEvent68k` has no entry for "pasted text without a key",
  and a second `keyDown` would record the key twice.
- Desktop app (for DV2): there the paste of Cmd+V comes back from the application's Edit menu
  through the main process, after the key-down has been handled by the page. The panel therefore
  waits `PASTE_WAIT_MS.desktop` = 150 ms instead of 0 before it sends the key alone. **Not run
  under Electron by SH4** (only DV2 starts Electron on the build machine, and the path exists on
  macOS only); `tests/desktop/dev` should paste `HELLO` into a task 5 loop and expect `HO`. If
  the paste arrives later than that, the text still arrives, as typed characters. The assumption
  that the page sees the key-down of Cmd+V before the Edit menu acts on it is the same one DV2's
  menu handling rests on (its errata, R-20); entry 21 says how a person or DV2 can settle both.

### 4. `core/sim-host/input/mouse.ts` (3.6; W1 erratum 6)

- Says: 3.6 describes `input/mouse.ts` in one paragraph and declares nothing; `SimSession` has no
  mouse member.
- Does: the file exports `OutputMouse` (`constructor(deps: { post })`, `down`, `up`, `move`,
  `cancel`, `resetToStartup`, `leftHeld`), `mouseShift(event, kind)`, `surfacePoint(...)` and the
  types `MouseLike`, `ClientBox`, `SurfaceSize`. The Output feature owns the one instance
  (`outputOf(ctx).mouse`) and posts to `ctx.sim.controller.post`; it resets it when the session
  reports a new engine (`onEngineReplaced`). Nothing has to change in the contracts.

### 5. Notice when the desktop window leaves full screen (3.13, 2.5)

- Says: 2.5, "Full screen ends without the port asking ...: the panel sees `fullscreenchange`".
  In the desktop app the window is full screen, not the page (`Platform.setFullScreen`), and
  `Platform` had no event for it.
- Gate I1: W1 added `Platform.onFullScreenChange?(listener: (on: boolean) => void): () => void`
  (its erratum 11.1). The Output feature listens from the window's start
  (`features/output/index.ts`) and calls `fullScreen.driverChanged(on)`: when the system ends full
  screen (the green button, Ctrl+Cmd+F) the panel is windowed again and the engine's flag is
  cleared, as in a browser. A notice while the panel is not full screen means nothing to it.
- Open, for DV2: `platform/desktop.ts` has to implement the member (W1 erratum 11.5). Until it
  does, the behaviour is the old one: the panel still covers the window, and Alt+Enter or
  `View > Output Window` puts both back in step. Checked here with a platform double only
  (`panel.test.tsx`, `engine.test.ts`, `check-output.mjs`).

## Design

### 6. The Fullscreen API is asked for the page's root element, not the panel's (2.5 table)

- Says: "Mechanism | Browser: Fullscreen API on the panel's container".
- Found: a browser shows nothing but the element that is full screen and what is inside it. The
  port's dialogs, message boxes, menus and toasts are drawn by the shell, outside the panel. With
  the panel as the full-screen element, the file dialog of TRAP #15 task 58, the engine's message
  boxes and the refusal box of 2.5 itself would be open and invisible, and the program would wait
  for an answer nobody can give.
- Does: `requestFullscreen()` is called on `document.documentElement`, and the panel covers the
  window with `position: fixed` below the dialog layers (`output.css`), which is the layout 2.5
  gives the desktop app ("the window itself goes full screen and the Output panel fills it").
  What the user sees is the same: the unchanged surface, centred, at the largest whole-number
  scale, black around it. `check-output.mjs` opens a message box in full screen and finds it on top.
- Proposed text: "Fullscreen API on the page's root element; the Output panel then fills the
  window, as in the desktop app".

### 7. Key-downs that are not cancelled: one more case (2.9.4)

- Says: not cancelled are `Dead`, `Process`, `Unidentified`, a key-down during composition, and
  the paste chord.
- Does: also a key-down whose `key` is text of several characters and not the name of a key (a
  dead key followed by a letter it does not combine with can arrive that way). It is handled like
  a dead key: no character from the key-down, the text from the textarea.
- During composition the key is passed on with `key: 'Process'`, because Safari reports the letter
  itself there (with `keyCode` 229) and `KeyLike` has no `isComposing`.
- A line break in text that the browser inserted is delivered as `$0D` (a virtual keyboard sends
  Enter as text).

### 8. A key the virtual-key table does not know (3.6, trap15-b §9.1)

- Says: `vkFromCode` answers 0 for an unknown key; 3.6: "`keydown` posts one `keyDown` entry".
- Found: `engine.keyDown(0)` would set entry 0 of the key table, and task 19 reads that entry for
  every zero byte of a request (`simIOu.cpp:596-606`), so one unknown key would make "no key"
  read as held (`$FF`) in every later answer.
- Does: for a key with code 0 (the Windows / Command key, the menu key, the extra key of ISO
  keyboards, F13 and up) no `keyDown` and no `keyUp` is posted. If it types a character, that is
  posted as `char`.
- The table holds exactly the keys of trap15-b §9.1, as the acceptance asks. Proposed for the
  spec: add the standard Windows codes of keys that exist on real keyboards (`$5B`/`$5C` Windows
  keys, `$5D` menu key, `$E2` the ISO key next to left Shift, `$7C`-`$87` F13-F24).

### 9. Virtual keys follow the position of a key, which differs from Windows on other layouts (3.6, 6.8)

- Says: `vk` from `vkFromCode(ev.code, numLock)`; `KeyboardEvent.code` names a position.
- Found: a Windows virtual key follows the active keyboard layout: on an AZERTY keyboard the key
  labelled A sends `$41`. The port reports `$51` for it (the position of Q on a US keyboard). A
  program that says "press A" and polls `$41` behaves differently for a French or German student
  than under the original. W3's erratum 24 decided the same question for command chords in favour
  of the label.
- Does: what 3.6 says (position). `charFromKey` is not affected: characters, and Ctrl+letter, come
  from what the key types.
- Not done, proposed for a decision: take a letter key's code from `key` when that is an ASCII
  letter and from the position otherwise, as `commands/chords.ts` does. Punctuation cannot be
  mapped that way (Windows assigns the `VK_OEM_*` codes per layout), so the result would still be
  a mixture. Listed in `docs/differences/SH4.md`.

### 10. `charFromKey`: what the list of 3.6 leaves open

3.6 lists printable characters, Enter, Backspace, Esc, Ctrl+letter, Ctrl+Enter and
Ctrl+Backspace. The function also has to answer for everything else; it follows Windows:

| Key | Answer | Why |
|---|---|---|
| Ctrl + `@` (Ctrl+Shift+2 on a US keyboard) | `$00` | the Shift+Ctrl column of the US layout. A character like any other for the program: task 5 returns 0, task 2 stores the byte, outside a read it replaces the key of type-ahead (`simIOu.cpp:1334-1411`). Added at gate I1; the review found that it was missing |
| Ctrl + `[`, `\`, `]`, `^`, `_` | `$1B`-`$1F` | the control columns of the US layout |
| Ctrl + Space | `$20` | same table |
| Ctrl + any other key that types something (digits, punctuation) | none | Windows sends no WM_CHAR |
| Alt + key (without Ctrl) | none | Windows sends WM_SYSCHAR, which the form's `OnKeyPress` never sees; Alt+Enter must not put `$0D` into a pending read |
| Ctrl+Alt + key (AltGr) | the character, unless it is a plain ASCII letter or digit | AltGr types `@`, `€`, `{`; where the layout has no AltGr character the browser reports the plain key, and Windows sends nothing |
| Meta (Windows or Command key) + key | none | a system or application shortcut |
| Ctrl + letter | from the letter the key types, from the position where it types no ASCII letter | Ctrl+C on a Russian layout is still `$03` on Windows |
| Tab | `$09`; none with Ctrl | plain Tab never reaches the function (rule 3) |

On macOS Option types characters, as AltGr does. `OutputKeyboard` therefore asks `charFromKey`
without the Alt flag when Option is held with a key that types a character (Option+G is `$A9`),
and with it for named keys (Option+Return, the full-screen chord, types nothing).

Verified at gate I1 as far as Windows itself goes: `ToUnicodeEx`, the translation that
`TranslateMessage` uses to make WM_CHAR, was asked on Windows 11 with the US layout (a read-only
call; no key was pressed and no layout loaded). It gives one character for Ctrl+Shift+2 (`$00`),
Ctrl+Shift+6 (`$1E`), Ctrl+Shift+- (`$1F`), Ctrl+[ (`$1B`), Ctrl+\ (`$1C`), Ctrl+] (`$1D`),
Ctrl+Space (`$20`), Ctrl+A (`$01`), Ctrl+H (`$08`), Ctrl+Z (`$1A`), Ctrl+Shift+A (`$01`),
Ctrl+Enter (`$0A`), Ctrl+Backspace (`$7F`), Enter, Backspace, Esc and Tab, and none for Ctrl+2,
Ctrl+6, Ctrl+-, Ctrl+1, Ctrl+;, Ctrl+/, Ctrl+Shift+[ and Ctrl+Tab. `charFromKey` answers the same
for every one of them (`chars.test.ts`). Still UNVERIFIED, as trap15-a §12 says of the VCL's key
handling in general: that the VCL hands a WM_CHAR with the value 0 to the form's `OnKeyPress`.
The VCL's `TWinControl.DoKeyPress` calls the handler before it looks at the character, so it
should; the port follows that reading (section 0 rule 1: when in doubt, reproduce).

### 11. NumLock comes from the event's `key` (3.6)

- Says: `vkFromCode(ev.code, numLock)`; `KeyLike` has no NumLock state.
- Does: for keypad keys NumLock counts as off when `key` names a navigation key (`Insert`, `End`,
  `ArrowLeft`, `Clear`, ...) and as on otherwise. This also gives Windows' answer for Shift with
  NumLock on, where the keypad acts as the navigation block. macOS: always on, as 3.6 says.
- A key goes up with the code it went down with, so a keypad key held across a NumLock change
  cannot stay "down" for task 19 under another code.

### 12. Plain Tab is refused in `OutputKeyboard.keydown` as well (2.9.4 rule 3)

The panel never passes Tab on. `OutputKeyboard.keydown` ignores Tab without Ctrl and Alt all the
same, so that the rule holds for every caller; `keyup` posts its key-up.

### 13. `pasteBytes` stops at the first NUL (3.6)

The original's loop is `for (i = 0; inBuf[i]; i++)` over a buffer that `GetTextBuf` filled
(`simIOu.cpp:440-443`): a NUL ends the text. A browser's clipboard text can hold one.

### 14. A program's request with a gesture still active enters at once (2.5)

- Says: "A program asks without a gesture ...: the panel shows `Press any key or click to enter
  full screen`".
- Does: the prompt appears only when no user gesture is active (`navigator.userActivation`). A
  program that asks for full screen within a few seconds of the key or click that started it
  (F9, then task 33) gets it at once, as in the original. Where the browser does not say whether
  a gesture is active, the request waits.
- A key or click that carries no user activation (Esc; in some browsers a bare modifier) does not
  carry the request out; the next one does. Alt+Enter pressed while the prompt is shown enters
  full screen and does not toggle it straight back.

### 15. Smaller points

- **A collapse button in the header strip.** 2.5 lists title, size, zoom and the full-screen
  button; 1.4 note 35 says the panel "can be collapsed". The strip has a small button
  `Collapse the Output panel` (`hidePanel(ctx, 'output')`); it is hidden where the panel is a tab
  (the narrow layout of 2.3), which cannot collapse.
- **Leaving Simulator mode leaves full screen.** A full-screen Output panel belongs to the
  simulator's workspace, which is hidden in the other modes.
- **`View > Output Window`** leaves full screen and shows and focuses the panel (1.3.4 says both;
  the original does one or the other, sim-ui §3.1).
- **The command `sim.output.paste`** (no key behind it) reads the clipboard through the browser's
  Clipboard API, or `Platform.pasteIntoFocus` in the desktop app, and delivers it as the chord
  does: the chord's key-down with the text in one entry, then its key-up. If the browser refuses,
  a toast says `Press Shift+Insert to paste` (`Cmd+V` on macOS), after 1.4 note 45.
- **A release the browser could not report** (the left button let go outside the browser window
  after the capture was lost) is posted when the next move shows that no button is held.
- **`lostpointercapture` is not used** to release the left button: browsers fire it after every
  normal release as well, and its order relative to `mouseup` is not the same everywhere. Only
  `pointercancel` releases (2.10).
- **Safari before 16.4** has the Fullscreen API only with a prefix; the port does not use it and
  shows the refusal box there.
- **Device pixel ratios that are not whole numbers** (125 %, 150 % on Windows): a whole-number
  scale in CSS pixels is then not a whole number of screen pixels, and the browser's nearest-
  neighbour scaling gives pixel columns of unequal width. 2.5 asks for whole-number CSS scales;
  this is what they give. Not addressed; see `docs/differences/SH4.md`.

## Tests

### 16. Where the browser acceptance runs (9.2, 6.6)

- Says: "With the real engine and the real panel in Chromium and WebKit: each rule of 2.9.4 has
  a test ...". Unit tests have no DOM; `tests/e2e/sim` belongs to X2; the surface, the text screen
  and the run controller are written in the same wave.
- Does: `app/src/features/output/check-output.mjs` (the convention of `check-shell.mjs`) drives
  the real shell with the real Output panel and the real engine in headless Chromium and WebKit.
  `app/src/features/output/testing/` holds doubles for exactly the three parts that other packages
  own (`PixelSurface`, `TextGrid`, `MiniController`) and the 68000 programs. The same test bed
  runs under Node in `engine.test.ts`. `docs/requests/SH4-output-check.md` asked for the CI step
  (applied at gate I1).
- Since gate I1 the doubles are no longer the whole story: `real-session.test.ts` runs the
  panel's keyboard, mouse, presenter and text mirror against the real run controller, surface and
  text screen under Node (`core/run/headless.ts`), and the group `app` of `check-output.mjs`
  repeats the acceptance list in the application itself (`index.html`, its real session, the real
  fonts) in both browsers. The doubles stay for what only they can show: every entry that reached
  the engine, both key maps on one machine, and the desktop app's platform.
- What the script cannot do with real keys, and does with events made in the page: a dead key
  (`key: 'Dead'`), keys during a composition, and the clipboard's content for a paste (the
  machine's clipboard is not written to). A real composition is driven through Chromium's own
  input-method interface; WebKit has none in Playwright.
- Everything the script does to a page counts as a user gesture there for five seconds, so the
  "program asks without a gesture" checks let the program wait 6.5 s (task 23) before it asks.
  The script does not sleep through that time and hope: the page reports each change of the
  full-screen phase on its console, and the script waits for that line without touching the page.

## Gate I1, round 1

What the review of SH4 left open, what the neighbours' real parts changed, and what SH4 answered
to the notes addressed to it. Entries 2, 5, 10 and 16 above were brought up to date in place.

### 17. The refusal box has no icon (2.5, 2.7)

- Says: 2.5 gives the text and the title `Information`; 2.7 asks for "the original's title, text,
  icon class and buttons".
- Found by the review: the port showed the (i) picture of an information box. The original's call
  is `Application->MessageBoxA(text, "Information")` (`simIOu.cpp:290`), which names no flags:
  MB_OK, one OK button and no icon. "Information" is only the caption.
- Does: `FULL_SCREEN_REFUSED` (`features/output/fullscreen.ts`) is the whole request, with
  `icon: 'none'` and `buttons: ['OK']`.

### 18. The I/O window's chords with further modifiers held (2.9.4)

- Says: rule 4 names "Alt+Enter", "Shift+Insert" and "Ctrl+Tab".
- Found by the review: the original tests `Shift.Contains(...)` (`simIOu.cpp:434-439`), so
  Shift+Alt+Enter, Ctrl+Alt+Enter, Ctrl+Shift+Tab and Ctrl+Shift+Insert act there too.
  `commands/output-keys.ts` (W3) matches the exact chords, and the panel follows its answer.
- Does: nothing in SH4's files. `docs/requests/SH4-output-chords.md` asked W3 for the original's
  rule for Alt+Enter and Ctrl+Tab, and explained why the paste chord has to stay exact: a browser
  fires `paste` for its own paste chord only (run in Chromium and WebKit: no event for
  Ctrl+Shift+Insert or Alt+Shift+Insert). W3 applied it in the same round (its erratum 29):
  Alt+Enter and, in the desktop app, Ctrl+Tab act with any further modifiers held. SH4's tests pin
  the answers the panel relies on (`panel.test.tsx`, `engine.test.ts`, the `keys` group of
  `check-output.mjs`). The paste chord with further modifiers is a row of
  `docs/differences/SH4.md`, marked **program**.

### 19. Text pasted without the chord after task 24 (2.9.4, 3.6)

- Says: "After task 24 none of the three acts." A paste event can also reach the hidden textarea
  without the chord: the browser's own Paste command, the Edit menu of the desktop app.
- Does: such a paste is typed in as characters while key commands are enabled (entry 3) and is
  dropped after task 24, because the original's window has no way to paste then
  (`PanelInput.paste`).

### 20. Notes of the other packages, answered

- **SH8, "do not write `sim.output.width / height / textWrap`"**: done, entry 2. `fullScreen` is
  shared as SH8's note and entry 1 describe; with the real session the two writers were seen to
  agree in every case the `app` group of the check runs through (Alt+Enter, a stop in trace mode,
  a program's request that waits, a program's request for windowed mode).
- **SH3's review, "`OutputDevice.setWindowSize` does not call `setupWindow` as the original
  does ... or call `deps.setFullScreen` with the current state if the Output panel needs it"**:
  the panel does not need it. It reads the surface size every frame and scales and centres
  whatever it finds, also in full screen; `check-output.mjs` sets 800x600 with task 33 while full
  screen is on and finds the new surface centred at its own whole-number scale.
- **SH1, "present from `surface.window ?? surface.back` ... `takeDirty()` already includes the
  overlay cell's old and new place"** and **SH3, "the overlay cell can be wider than a character
  cell"**: the presenter does the first, relies on neither the second nor a cell size (it takes
  the overlay's own rectangle), and was run against the real surface and the real prompt: the
  prompt is on the canvas and not in the back buffer (`app` group), the picture survives a resize
  and a cold start (`real-session.test.ts`, `app` group).
- **SH7, "start Vite with `hmr: false, watch: null`"**: the script always did.
- **W1, `Platform.onFullScreenChange`**: used, entry 5.
- **SH4's own note to W3 about the narrow layout** (below 1100 px `showPanel(ctx, 'output')` did
  not bring the Output tab forward): the shell repaired it in this round (`outputInFront`), and
  the `app` group now checks it with the Memory tab in front.

### 21. What only a person, or DV2 on a Mac, can still settle (6.8)

Two acceptance items of 9.2 are met as far as a headless browser can show and stay "partly" for
that reason; a third point concerns the desktop app. For `docs/MANUAL-TEST-MAC.md` (DOC1), with
the programs of `app/src/features/output/testing/programs.ts` or any program that reads a line
with task 2:

1. **A dead-key sequence and a composed character arrive in task 2.** On a keyboard layout with
   dead keys (US-International on Windows; any Mac layout with Option+E): in the Output panel,
   at a task 2 prompt, type the accent key and then `e`, then Option+E and `a` on a Mac, then a
   character of an input method. Expected: one `é`, one `á`, the composed character once, each
   echoed once; nothing doubled, nothing lost. Automated so far: the same event sequences made in
   the page, and one real composition through Chromium's input-method interface.
2. **A held letter repeats.** Hold `a` at the same prompt for two seconds. Expected: the letter
   repeats at the system's repeat rate, and on a Mac no accent menu appears. Automated so far:
   key-downs marked as repeats by the test driver; the system's own repeat needs a real key.
3. **Paste in the desktop app on macOS.** At a task 5 loop (`charLoopProgram`), copy `HELLO` and
   press Cmd+V. Expected: the program stores `HO` (the first character ends the read, the last
   one is left as type-ahead), and task 19 saw the V key once. If it stores `HELLO`, the paste
   event arrived more than `PASTE_WAIT_MS.desktop` (150 ms) after the key-down, or the page never
   saw the key-down; the number, or the fact, goes back to SH4. DV2 can automate the same in
   `tests/desktop/dev` by pressing Cmd+V and then calling the Edit menu's Paste item (or
   `webContents.paste()`) from the main process, which is the real path.

## Gate I1, round 2

### 22. The browser check waited a fixed time for a frame (CI, Ubuntu, WebKit)

- Found: the first CI run of `check-output.mjs` on all three systems (run 44913261966) passed on
  Windows and macOS and failed one check on Ubuntu: `webkit/ratio 1.5: the canvas holds the pixels
  the program drew, unscaled`. The pass read the canvas as soon as the program had counted its
  picture as drawn; the presenter copies the surface to the canvas only at the next animation
  frame, which a slow runner may give later. The passes at ratio 1 and 2 waited a fixed 100 ms
  instead, which is the same race with more room.
- Does: every read of a drawn pixel first waits, up to 30 s, until the canvas shows it
  (`untilPresented` in `pageTools`); the check then reports the pixels it found. Nothing in the
  panel changed: the frame-to-canvas path is what 2.5 asks for.
- Not reproduced on this PC (525 of 525 before and after); the cause is read from the code and the
  CI log, and the repair removes the race rather than lengthening a pause.

## Gate I1, round 3

### 23. Device pixel ratios that are not whole numbers: reproduced, and the product is right

- Asked: the round-1 failure of entry 22 (`webkit/ratio 1.5`, Ubuntu) might be a real defect: a
  canvas that does not hold the program's pixels at a fractional ratio would show a student
  blurred or wrong pixels.
- Reproduced at ratios 1.25, 1.5, 2 and 3, in WebKit and Chromium, twice over: on this PC
  (Windows WebKit), and with the browsers of Linux, in the Playwright container
  `mcr.microsoft.com/playwright:v1.65.1-noble` (the same Playwright version, so the same WebKit
  build as the Ubuntu runner), through the new diagnosis options `--browser-server` and
  `--page-host`. At every ratio in both browsers the backing store is 640x480, the 3x3 pixels
  around the red pixel are exactly the program's (red in the centre, black around), the green
  box's corners are exact, and on screen every device pixel around the red pixel is a whole
  surface colour (red, black, or the white of the text), never a blend. WebKit places the
  canvas at a fractional CSS position at 1.25 and 1.5 (top 248.796875 and 248.65625), which is
  a whole device pixel within WebKit's 1/64 layout unit; at 1.5 one surface pixel covers one or
  two device pixels, as any nearest-neighbour scale by 1.5 must.
- Cause of the round-1 failure: the version of commit 8611609 read the canvas without waiting
  for the presenter's frame (entry 22). The repair of round 2 was proven by CI run 44919519853
  (commit c4d3dfa): the Output panel check passed on Ubuntu, macOS and Windows.
- Does now: the fractional pass runs at 1.25, 1.5 and 3 (2 and 1 are the full presentation
  passes), fails if the frame never came ("presented NOT within ... ms"), and prints in the CI
  log the 3x3 backing pixels, how long the presenter took, the canvas position, and the device
  pixels on screen with the surface colours nearby. It checks, in addition, that no device pixel
  on screen blends two surface colours - what the product guarantees with
  `image-rendering: pixelated` at any ratio. How many device pixels one surface pixel covers at a
  fractional ratio is the browser's business and is not checked.
- Only the next CI run can prove: the new on-screen blend check on the macOS runner (WebKit and
  Chromium) and on the Ubuntu runner outside a container.

### 24. Entry 21 item 3 is automated (DV2)

`tests/desktop/dev/output.spec.ts` (DV2) pastes `HELLO` with Cmd+V into a task 5 loop in the
desktop app, checks `HO`, checks that the paste event came less than 150 ms
(`PASTE_WAIT_MS.desktop`) after the key-down, pastes again with `sim.output.paste` through
`Platform.pasteIntoFocus`, and checks `Platform.onFullScreenChange` and Alt+Enter in the window.
All passed on macos-15 in CI run 44919519853 (job desktop-dev). Item 3 of entry 21 can leave the
manual list; items 1 and 2 (real dead keys and input methods, the system's key repeat and the
macOS accent menu) still need a person.

## Gate I2, round 1

### 25. The picture's scroll region is a Tab stop (axe scrollable-region-focusable, found by X1)

- Found by X1's axe scan of Simulator mode (`tests/e2e/app/a11y.spec.ts`, "Simulator mode with the
  tool panels"): `scrollable-region-focusable` (serious) on `.e68-output__viewport`, in both
  browsers and themes. The viewport scrolls whenever the zoomed surface is larger than the panel
  (2.9.2), and nothing in it could take the focus: the program's key field lies beside it, not in
  it. A keyboard user could not scroll a picture that does not fit (WCAG 2.1.1).
- SH4's own scan did not see it because the check's panel showed the surface at 100 % in a window
  large enough for it; axe reports the rule only while the region actually overflows.
- Reproduced in `check-output.mjs`: at 200 % (the panel scrolls) an axe run of that rule on the
  panel, and a check that the region takes the focus, has a name and scrolls with ArrowDown and
  PageDown. Both failed before the change ("scrollable-region-focusable: .e68-output__viewport";
  no role, no name).
- Does: the viewport is `role="region"`, `aria-label="Output picture"`, `tabIndex={0}`, with the
  focus ring on `:focus-visible`. A click on it (or on the canvas) still gives the program the
  keyboard, as before; only Tab reaches the region itself, and keys pressed there scroll the
  picture and reach no program (the program's keys are those of the field, 2.9.4). An addition
  of the port's panel layout, recorded in docs/differences/SH4.md (nothing a program observes
  changes).

## Round before gate I3

### 26. The scroll check of entry 25 read the scroll position before the browser had scrolled (CI runs 44972001171 and 191e768)

- Found: once, Chromium on GitHub's macOS runner (ratio 1): "200%: the picture's scroll region
  takes the focus, has a name and scrolls with the keys" with `scrollTop` 0 after ArrowDown and
  PageDown; it passed on the rerun, and never failed on Ubuntu or Windows.
- Product or check: the check. The region had the focus before the keys were pressed (the check
  focuses it and asserts `document.activeElement` in the same step, and nothing in the panel moves
  the focus: no keydown handler on the region, `attachKeys` focuses the key field only when the
  program asks for input, which the drawing program of this check does not). But Chromium scrolls a
  region by the keys smoothly, as an animation on display frames, and the check read `scrollTop`
  at once. Measured on this PC with a reading a second later added: Chromium 85 at once, 114 after
  8 ms, 183 a second later (and 93, 93, 183); WebKit 183 at once (it scrolls without animation).
  GitHub's Mac runner at times delivers no frames for a while (SH8 errata entry 30), so the
  animation had not begun when the check read 0.
- Again in the CI run of main's head 191e768 (Chromium, ratio 2 this time; log in
  build/gate3/ci-191e768-mac-sim-failed.log): focused, named, a region, scrollTop 0. Its ratio 1 in
  the same job read 32, an animation caught at its very start (ArrowDown plus PageDown end at 183),
  and WebKit read 115 and 117. There was something to scroll: the Fit check of the same pass reports
  a room of 699x777 for a picture shown 960 high. So the same cause: no frame had come yet to move
  the animation.
- Does: the check records where each key event lands (the target, and whether it was cancelled),
  then waits up to 10 s for `scrollTop` to become larger than 0, polling every 100 ms by a timer
  (Playwright's default polls on animation frames, which that runner withholds, so a frame-polled
  wait could not end either), and prints the content and room heights, the reading at once, after
  the wait and a second later, the keys and the focus after them. The assertion is the same (focus,
  name, role, and the region scrolled); only the moment of reading changed. A product that lost the
  keys, or a picture that fits, still fails, with the reason in the log.
- Evidence on this PC: `check-output.mjs --browser all`, 567 of 567; Chromium read 99 and 94 at
  once, 127 after 17 ms and 183 after 62 ms, 183 a second later (the smooth scroll caught midway);
  WebKit 183 at once; content 960 of 777 high; both keys on the region. Whether the macOS runner's
  frames come back within 10 s only the next CI run there can show.
