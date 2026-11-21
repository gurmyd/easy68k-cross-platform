# Errata of SH4 (Keyboard, mouse, Output panel)

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
  is on, or on its way") at every change and once per frame, and never reads it. SH8's session
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
- Does: the Output feature copies `ctx.sim.surface.back.width / height` and
  `ctx.sim.text.state.textWrap` into the store once per frame and after its own commands
  (`OutputModel.sync`). SH8's session writes the same three values from the same objects; the two
  cannot disagree.

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
  under Electron by SH4**; `tests/desktop/dev` should paste `HELLO` into a task 5 loop and expect
  `HO`. If the paste arrives later than that, the text still arrives, as typed characters.

### 4. `core/sim-host/input/mouse.ts` (3.6; W1 erratum 6)

- Says: 3.6 describes `input/mouse.ts` in one paragraph and declares nothing; `SimSession` has no
  mouse member.
- Does: the file exports `OutputMouse` (`constructor(deps: { post })`, `down`, `up`, `move`,
  `cancel`, `resetToStartup`, `leftHeld`), `mouseShift(event, kind)`, `surfacePoint(...)` and the
  types `MouseLike`, `ClientBox`, `SurfaceSize`. The Output feature owns the one instance
  (`outputOf(ctx).mouse`) and posts to `ctx.sim.controller.post`; it resets it when the session
  reports a new engine (`onEngineReplaced`). Nothing has to change in the contracts.

### 5. No notice when the desktop window leaves full screen (3.13, 2.5)

- Says: 2.5, "Full screen ends without the port asking ...: the panel sees `fullscreenchange`".
  In the desktop app the window is full screen, not the page (`Platform.setFullScreen`), and
  `Platform` has no event for it.
- Does: the desktop driver cannot notice that the user left full screen with the system's own
  means (the green button, Ctrl+Cmd+F). The panel then still covers the window; Alt+Enter or
  `View > Output Window` puts both back in step.
- For W1 and DV2: `Platform.onFullScreenChange(listener: (on: boolean) => void): () => void`; the
  Output feature would call `fullScreen.driverChanged(on)`.

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
| Ctrl + `[`, `\`, `]`, `^`, `_` | `$1B`-`$1F` | the control column of the US layout (Notepad shows them) |
| Ctrl + Space | `$20` | same table |
| Ctrl + any other key that types something (digits, punctuation) | none | Windows sends no WM_CHAR |
| Alt + key (without Ctrl) | none | Windows sends WM_SYSCHAR, which the form's `OnKeyPress` never sees; Alt+Enter must not put `$0D` into a pending read |
| Ctrl+Alt + key (AltGr) | the character, unless it is a plain ASCII letter or digit | AltGr types `@`, `€`, `{`; where the layout has no AltGr character the browser reports the plain key, and Windows sends nothing |
| Meta (Windows or Command key) + key | none | a system or application shortcut |
| Ctrl + letter | from the letter the key types, from the position where it types no ASCII letter | Ctrl+C on a Russian layout is still `$03` on Windows |
| Tab | `$09`; none with Ctrl | plain Tab never reaches the function (rule 3) |

On macOS Option types characters, as AltGr does. `OutputKeyboard` therefore asks `charFromKey`
without the Alt flag when Option is held with a key that types a character (Option+G is `$A9`),
and with it for named keys (Option+Return, the full-screen chord, types nothing). None of this is
verified on real Windows; trap15-a §12 already lists the VCL's key handling as UNVERIFIED.

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
  runs under Node in `engine.test.ts`. `docs/requests/SH4-output-check.md` asks for the CI step.
- What the script cannot do with real keys, and does with events made in the page: a dead key
  (`key: 'Dead'`), keys during a composition, and the clipboard's content for a paste (the
  machine's clipboard is not written to). A real composition is driven through Chromium's own
  input-method interface; WebKit has none in Playwright.
- Everything the script does to a page counts as a user gesture there for five seconds, so the
  "program asks without a gesture" checks let the program wait 6.5 s (task 23) before it asks.
