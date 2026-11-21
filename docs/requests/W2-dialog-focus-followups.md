# For W2 at the next gate: four small follow-ups on the focus of modal dialogs

Status: open. Found by the independent review of the macOS repair (commits 7b5e072, 63a824a,
71e8179; errata `docs/porting/errata/W2.md`, entries 12 and 13). None of them is met by a control
that exists in the application today, and the second and third are older than that repair. They are
written down here so that they are repaired before dialogs with such controls are built.

1. **A control that hands its focus to a child is skipped by Tab.** `moveTab` accepts a candidate
   only when `document.activeElement` is the candidate itself. A `tabindex="0"` container whose
   `onFocus` focuses a `tabindex="-1"` child is therefore treated as refusing the focus.
   Repair: accept the candidate when it contains the active element.

2. **After the focused control is disabled, a focus moved outside the dialog stays outside.**
   `onFocusIn` gives the focus back to the last control inside; a disabled control that is still in
   the document refuses it, and there is no second choice.
   Repair: after giving the focus back, check that it is inside the dialog; if not, go to the lost
   control's neighbour, as `moveTab` does, or to the first control.

3. **With the focus on the body (the focused control was removed or hidden), Escape, Enter and the
   access keys do nothing.** Only Tab is handled for keys pressed outside the dialog.
   Repair: move the focus to the neighbour as soon as the focused control disappears, or send
   Escape and Enter pressed on the body to the top-most modal dialog.

4. **No check in CI covers "a disabled control drops the focus to the body".** In the gallery check
   the button "Disable me" keeps the focus after it disables itself, in both browsers, so the check
   would pass with the old code; the branch of `moveTab` for that case was exercised only by the
   reviewer's probe. The errata entry claims more coverage than the check gives.
   Repair: in the check, blur the button after disabling it (or disable it from outside while it
   has the focus), assert that the focus is on the body, then press Shift+Tab. Correct the errata
   entry.

Not verified by anyone yet: a real input method (only a synthetic key with `isComposing`), and
Safari on a Mac with a person at the keyboard (only Playwright's WebKit on GitHub's macOS runner).
Both belong on the manual test list (`docs/MANUAL-TEST-MAC.md`).
