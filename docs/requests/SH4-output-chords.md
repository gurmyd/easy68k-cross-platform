# Request from SH4: the I/O window's own chords with further modifiers held (for W3, gate I1)

Status: done at gate I1 (W3) as requested: items 1 and 2 (Alt+Enter with any further modifiers; Ctrl+Tab with any further modifiers in the desktop app, first match in the original's order), item 3 (Shift+Insert stays exact) and item 4 (Cmd+V exact). `commands/output-keys.ts`, tests in `output-keys.test.ts`; errata W3.md entry 29.

Found by the review of SH4 and confirmed in the original's source. The code that decides is
`app/src/commands/output-keys.ts` (`outputPanelKeyAction`, owner W3); the Output panel (SH4,
`features/output/panel-input.ts`) only follows its answer, so nothing changes in SH4's files
whatever is decided.

## What the original does

`simIOu.cpp:434-444`, after the key was recorded for the program and only while key commands are
enabled:

```cpp
if (Key == VK_TAB && Shift.Contains(ssCtrl))            // if Ctrl-Tab
  MemoryFrm->BringToFront();
else if (Key == VK_RETURN && Shift.Contains(ssAlt)) {   // if Alt-Enter
  fullScreen = !fullScreen; setupWindow();
} else if (Key == VK_INSERT && Shift.Contains(ssShift)) {   // if Shift-Insert
  ... paste the clipboard
}
```

`Shift.Contains` is true whatever else is held. So in the original Shift+Alt+Enter and
Ctrl+Alt+Enter toggle full screen, Ctrl+Shift+Tab moves to the next window, and Ctrl+Shift+Insert
and Alt+Shift+Insert paste. The first match wins (Ctrl+Tab before Alt+Enter before Shift+Insert).

## What the port does

`outputPanelKeyAction` compares the normalised chord with the chord table, so only the exact
chords act: `Alt+Enter`, `Shift+Insert` (macOS `Cmd+V`) and, in the desktop app, `Ctrl+Tab`. With
a further modifier the answer is `{ kind: 'program', then: null }`: the key reaches the program,
as in the original, and nothing else happens. 2.9.4 names the chords without saying "exactly" or
"at least".

## Requested

1. **Alt+Enter**: answer `then: 'fullscreen'` for the Enter key whenever Alt (macOS Option) is
   held, whatever else is held. Nothing a program can observe depends on it; it is the original's
   behaviour and costs one comparison.
2. **Ctrl+Tab** (desktop app): answer `then: 'nextPanel'` for the Tab key whenever Ctrl is held
   (Ctrl+Shift+Tab too). Plain Tab and Shift+Tab stay rule 3.
3. **Shift+Insert with further modifiers: leave it exact.** This is the one case a program can
   observe (it gets the pasted characters in the original), but a browser cannot give it: the
   panel pastes by leaving the key-down to the browser, which then fires `paste`, and a browser
   fires `paste` for its own paste chord only. Run in headless Chromium and WebKit (Playwright,
   Windows 11) with a textarea focused: Shift+Insert fires one `paste` event in both;
   Ctrl+Shift+Insert and Alt+Shift+Insert fire none in either. An answer `then: 'paste'` for
   Ctrl+Shift+Insert would leave the key-down uncancelled and no text would come. Reading the
   clipboard through the Clipboard API instead would show the browser's permission question in
   the middle of a program's input. `docs/differences/SH4.md` lists this as a difference a
   program can observe.
4. The macOS paste chord `Cmd+V` is the port's own; exact, as now.

The rules before these (release chord, menu shortcuts, plain Tab) are not touched: none of their
keys is Enter, Insert or Ctrl+Tab.

Tests that would pin it, in `commands/output-keys.test.ts`: `Shift+Alt+Enter` and `Ctrl+Alt+Enter`
give `fullscreen`; `Ctrl+Shift+Tab` gives `nextPanel` in the desktop app and `null` in a browser;
`Ctrl+Shift+Insert` gives `null`; after task 24 all of them give `null`. SH4's
`features/output/panel.test.tsx` ("the three chords of the panel") holds the answers the panel
relies on and needs no change for items 1 and 2.

If the gate prefers to keep all three exact, `docs/differences/SH4.md` already says so for
Alt+Enter and Ctrl+Tab as well; the row then only loses its reference to this request.
