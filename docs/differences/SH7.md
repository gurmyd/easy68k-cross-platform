# Differences introduced by SH7 (Hardware panel)

Deliberate differences from the original's "EASy68K Hardware" window. None of them changes what a
68000 program can observe (section 0, rule 1): every memory side effect of hardware §2.4 and §2.5,
every interrupt request and every engine control goes to the engine unchanged. DOC1 merges this
file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| Window | A separate fixed-size window (`EASy68K Hardware`), position saved in `sim68K.dat` | A tool panel (tab under the Output panel); no position | The port's window structure (2.1-2.3) |
| Display refresh | Segments and LEDs are recoloured only by the triggers of hardware §2.7; after a file open they stay all lit even if the S-records wrote device bytes, until the next trigger | The panel re-reads the displayed bytes once per display frame, so it also shows bytes written by a load, the Memory panel's Copy / Fill / pokes and task file reads | hardware §2.7 allows refreshing more often; not observable by a program |
| Group boxes | Maroon group boxes with white bold captions; grey Memory Map box | Themed group frames (both themes); captions verbatim (` Interrupt `, `Auto Interval`, `Reset`, `Memory Map`) | Contrast rules of 2.8; the device pictures keep their fixed colours |
| Switch, push-button, IRQ and Reset pictures | Bitmaps `toggleswitch.bmp`, `pushbutton3.bmp`, `pushbutton2glyphs.bmp` | Drawn by the port after them (2.6); a held push button is drawn sunken (the original has no pressed image) | 2.6; feedback for the held state |
| IRQ and Reset buttons and the focus | Speed buttons: cannot take the focus, not in the tab order | Ordinary buttons that can take the focus (keyboard access); leaving an address field for one of them does not count as leaving it (no commit), as in the original | Accessibility (2.11); the commit rule of hardware §2.4 is kept |
| Address fields: refused key | `addrKeyPress` beeps on a key that is not a hex digit | The key is refused silently | No system beep in a browser; a GUI defect at most |
| Level list of the Auto Interval group | An editable combo box: text can be typed, leaving no item selected (V10) | A list with the items `1`..`7` and the empty eighth item; nothing can be typed | Typing into it only reaches the "no item selected" state, in which the original's handlers do nothing - the same as the empty item |
| Push buttons and lost input | A key or mouse release that never arrives leaves the bit at 0 (hardware §9.2 item 8, unverified) | Pointer cancel, lost pointer capture, the window losing the focus and the page being hidden release every held button | 3.3.3 |
| Push buttons, mouse buttons | Any mouse button presses | Any mouse button presses; the context menu is suppressed on the buttons | Same behaviour; the browser's menu would end the press |
| Address-conflict colours | Red text | Red text (`--c-danger`) plus `aria-invalid` and a tool-tip | Accessibility |
