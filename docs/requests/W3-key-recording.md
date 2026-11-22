# Request from W3: record the key fixtures on real keyboards (DOC1, the manual list of 6.8)

Status (checked by W3 in the round before gate I3): the DOC1 part is done: `docs/MANUAL-TEST-MAC.md` has the step (A6 on a Mac, X3 on Windows and Linux; its table of requests names this file). The recording itself is open until a person runs that list and sends the lines; W3 then replaces the fixtures.

ARCHITECTURE.md 2.9.2 asks that the tests of the chord table use "key and code pairs recorded from
real keyboards". The pairs in `app/src/commands/key-fixtures.ts` were not recorded: W3 had no
access to the keyboards, and an automated browser cannot stand in (it types through its own US
table, not through a keyboard layout). `docs/porting/errata/W3.md`, entry 9, says what stands
behind each list today. This request is the part only a person can do.

## Request

**DOC1**: add the step below to the manual list (`docs/MANUAL-TEST-MAC.md`, 6.8).
**Whoever runs the list**: send the recorded lines to W3 (an issue or a pull request is fine). W3
replaces the fixtures with them and changes the header of `key-fixtures.ts` and erratum 9.

No dependency, script or CI change is needed.

## The step

1. Open a new tab on `about:blank` in Chrome, and again in Safari (macOS) or Firefox (Windows).
   Not the application: its dispatcher would act on the keys.
2. Open the developer console and paste the recorder:

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

3. Click into the page and press the chords of the table for the keyboard in front of you. Each
   press prints one line per key; the line of the last key (not of a modifier) is the one wanted.
4. Copy the console output together with: operating system and version, browser and version,
   keyboard model, and the name of the active input source or layout.

Do **not** press Cmd+Q, Cmd+W, Cmd+N, Cmd+T (macOS) or Ctrl+W, Ctrl+N, Ctrl+T, Ctrl+F4, Ctrl+Tab
(Windows, Linux): the browser acts on them before the page sees them. They are desktop-only
chords and are checked in the desktop app (6.7).

| Keyboard and layout | Press | Fixture list |
|---|---|---|
| Mac, U.S. or ABC | Cmd+O, Ctrl+O, Shift+Cmd+S, Shift+Cmd+Z, Option+O, Ctrl+Option+O, Ctrl+Option+Z, Ctrl+Option+C, Ctrl+Option+U, Cmd+/, Shift+Cmd+/, Cmd+, (comma), Cmd+G, Cmd+B, Ctrl+R, Ctrl+Shift+I, Option+Return, Shift+F2, Shift+F4, Ctrl+F9, Cmd+V; with the system's Ctrl+F<n> shortcuts switched off (System Settings > Keyboard > Keyboard Shortcuts > Keyboard) also Ctrl+F2 and Ctrl+F4 | `MAC_US` |
| Mac, Russian input source | Cmd + the O position, Ctrl + the O position, Ctrl+Option + the O position | `MAC_RUSSIAN` |
| Windows or Linux, US | Ctrl+O, Ctrl+S, Ctrl+Z, Ctrl+Alt+Z, Ctrl+Alt+C, Ctrl+Alt+U, Ctrl+Alt+O, Ctrl+O with Caps Lock, F9, Ctrl+F9, Shift+F4, F1, Insert, Shift+Insert, Ctrl+Shift+. (period), Ctrl+Shift+, (comma), Alt+Enter, Alt + the keypad's Enter, Alt+F, A | `WINDOWS_US` |
| the same, numeric keypad | NumLock off: 0, Shift+0, . (Del), 1 to 9, Ctrl+7; NumLock on: 0, Ctrl+1, . (decimal), + | `WINDOWS_KEYPAD` |
| Windows, German (QWERTZ) | Ctrl + the key labelled Z, Ctrl + the key labelled Y, Ctrl+Alt + the keys labelled Z, Y, C and U, AltGr+Q, AltGr+E, Ctrl+Shift+. (period) | `WINDOWS_GERMAN` |
| Windows, French (AZERTY) | Ctrl + the key labelled A, Ctrl + the key labelled Z, Ctrl + the key labelled M, Ctrl+Alt + the keys labelled A, Z and W, AltGr + the key labelled 0 (types @) | `WINDOWS_FRENCH` |
| Windows, Russian | Ctrl + the positions of O, S, Z and F of a US keyboard, Ctrl+Alt + the C position, F7 | `WINDOWS_RUSSIAN` |
| Windows, Greek | Ctrl + the positions of F, G and P of a US keyboard | `WINDOWS_GREEK` |

A layout can be recorded without its physical keyboard: add the layout or input source in the
system's settings, switch to it, and press the key at the position named. The position is what
`code` reports; the layout decides `key`.

## What is already known

The `key` characters of the five Windows lists agree with the layout tables Windows 11 uses
(`KBDUS.DLL`, `KBDGR.DLL`, `KBDFR.DLL`, `KBDRU.DLL`, `KBDHE.DLL`), 23 values of 23. That confirms
the characters, not what a browser puts into `key` while Ctrl is held, and nothing on macOS.

The Ctrl+Alt presses of the German and French rows other than the first of each (the keys labelled
Z, C and U; Z and W; AltGr + 0) were added at the gate after wave zero from the published layouts.
They were not compared with the layout tables and matter most: on Windows the application takes
the letter of a Ctrl+Alt chord from `key` (`docs/porting/errata/W3.md`, entry 24).
