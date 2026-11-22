# Release candidate

The release candidate's file belongs to I3 (ARCHITECTURE.md 8, 9.6). The section below is Q1's
(9.6 Q1: "defect entries in `docs/integration/rc.md`"); I3 owns everything else in this file.

## Q1 - accessibility and keyboard audit

Run on 21 November 2026 on the working tree after commit `d771d77`, Windows 11, Node 24, the
pinned Playwright Chromium and WebKit, `engine/dist` as built on this PC.

How to run it: `node tests/a11y/check-a11y.mjs` (options `--browser chromium|webkit|all`,
`--out <dir>`, `--only scan,structure,contrast,walk-edit,walk-run`); unit tests of its logic:
`npx vitest run --config tests/a11y/vitest.config.ts`. `docs/requests/Q1-a11y-ci.md` asks for
`check:a11y` in the job `browser-checks` and for the unit tests in `test:conformance`.

What it covers (sections 2.9 to 2.11):

- **scan**: axe-core 4 (WCAG 2.0 and 2.1, A and AA) over Editor mode (start-up document, with
  assembler messages, with the Help panel, with the waiting-for-input toast), Simulator mode (a
  program loaded, every tool panel, each tool tab in front, a program waiting for input, the layout
  below 1100 px) and EASyBIN mode, and every dialog the features register (24, read from the
  running application), each in the light and the dark theme, in Chromium (Windows key map) and
  WebKit (macOS key map). For each dialog also: the dialog role, `aria-modal` exactly when modal,
  a title that labels it, the focus inside, Tab and Shift+Tab kept inside, Escape closes it, the
  focus returns.
- **structure**: menu bar and every menu by keyboard (Down reaches every item, Right goes on,
  submenus, Escape), View > Memory by keyboard; toolbars (one tab stop, arrows, Home, End, names);
  panels as named regions; the tool tablist; a visible focus indicator of at least 2 px and 3:1
  on every tab stop of the three modes (both themes); the live regions of both message areas, the
  halt announcement; register labels; the Output canvas and its text mirror, whose update rate is
  measured (at most twice a second: shortest gap 501 to 528 ms); breakpoint dots by shape; reduced
  motion.
- **contrast**: the original's syntax colours, gutter dots and Hardware colours with their numbers
  (differences, `docs/differences/Q1.md`) and the dark theme's Auto palette (the port's own; all
  meet 4.5:1).
- **walk-edit** and **walk-run**: the two keyboard-only walk-throughs of the acceptance list, on
  the Windows and the macOS key map in both browsers (four runs each), with Safari's Tab rule on
  the macOS key map. Both workflows can be done with the keyboard alone.

No serious or critical axe finding in any mode or dialog, in either theme or browser. The defects
below come from the rules of 2.10 and 2.11 that axe does not judge. Q1-3 and Q1-5 are major
against 2.11; the others are minor. All six are defects of the application, in their owners'
paths, and stand until those owners repair them: a green `check:a11y` does NOT mean that the
application has no accessibility defect. Each is listed in
`tests/a11y/lib/findings.mjs` (`KNOWN_CHECKS`): the check prints it as "known" with its id instead
of failing, and says so when it passes again, so that the entry can then be removed.

### Q1-1 - New Folder: Cancel leaves the focus on the Files tree, not on the button (owner FS1)

- Rule: 2.10, "Dialog closes - the element that had the focus before it opened".
- Evidence: Editor mode, both themes, Chromium and WebKit. Focus on the Files panel's
  `New Folder...` button, press it, the dialog `files.name` (New Folder) opens; Escape (Cancel)
  closes it and the focus is on the tree `div[role=tree]` "Files", not on the button. Check
  "dialog files.name: the focus returns to where it was".
- Cause: `app/src/features/files/FilesPanel.tsx` `doNewFolder` calls `treeRef.current?.focus()`
  whether or not a folder was made (the same in `doRename`).
- Suggested repair: focus the tree only when a folder was made (`if (created)`), so that Cancel
  leaves the dialog service's own focus return in place. Minor.

### Q1-2 - After Execute the focus is nowhere (owner E5)

- Rule: 2.10 (the focus is always somewhere useful; "Dialog closes - the element that had the
  focus before it opened"), 2.11 "Focus is always visible".
- Evidence: walk-run, all four runs (Chromium and WebKit, Windows and macOS key maps): Enter on
  `Execute` in the Assembler Status dialog loads the program and switches to Simulator mode, and
  `document.activeElement` is the page body. The element the dialog would return to is the editor,
  which is in the hidden Editor workspace. A keyboard user's next Tab starts from the top of the
  page; chords still work, so the workflow is not blocked. Check "after Execute the focus is in a
  panel of Simulator mode".
- Suggested repair: after the switch to Simulator mode on Execute (`features/assemble/index.ts`,
  the `'execute'` answer), move the focus to the Listing panel with `focusPanel(ctx, 'listing')`,
  as a stop in trace mode does (2.10 `host.focusMain()`). (W3 may prefer a general rule in the
  dialog host: when the element to return to is hidden, focus the active mode's first panel.)

### Q1-3 - The assembler's messages are not announced (owner E5)

- Rule: 2.11, "The message areas (editor and simulator) are `log` live regions with polite
  announcements".
- Evidence: Editor mode, both themes, both browsers: the Messages panel
  (`[data-e68-workspace=editor] [data-e68-panel=messages]`) contains only the `grid` "Assembler
  messages"; no element with `role=log` or `aria-live=polite`. Simulator mode's Messages panel has
  one (`e68-messages__announce`). Check "the Messages panel of Editor mode has a polite log region".
- Suggested repair: as U1 did in `features/sim-main/MessagesPanel.tsx`: a visually hidden
  `role="log" aria-live="polite"` element in `features/assemble/MessagesPanel.tsx` that receives
  the new messages of an assembly (or "No errors" style summary of the counts) when the list
  changes.

### Q1-4 - A breakpoint (and the PC marker) is not told to a screen reader (owner U1)

- Rule: 2.11, "Nothing depends on colour alone: breakpoints also differ in shape"; WCAG 1.3.1.
- Evidence: Simulator mode, both themes, both browsers: after Space sets a breakpoint on the row
  of `ADD.L D0,D0`, the row (`role=option`) is read as "00001002 D080 4 ADD.L D0,D0"; the gutter
  is `aria-hidden`, and nothing (name, description, state) says that a breakpoint is set or which
  row holds the PC. Sighted users see filled and hollow dots (that part passes). Check "a row with
  a breakpoint says so to a screen reader".
- Suggested repair: in `features/sim-main/ListingPanel.tsx` `rowProps`, add an
  `aria-description` (or a visually hidden suffix referenced by `aria-describedby`) "breakpoint"
  on rows with `data-bp="on"` and "current instruction" on the PC row.

### Q1-5 - A halt is not announced (owner SH8)

- Rule: 2.11, "a halt and `Current Log Stopped.` are announced".
- Evidence: both themes, both browsers: a program that ends with `SIMHALT`, run with F9 until
  `snapshot.halted`; the live regions said only ".S68 file read successful" (the load) and
  nothing about the halt within 1.2 s. The status bar shows `Halted` (`features/run/StatusBar.tsx`)
  but the cell is not a live region. Check "a halt is announced by a live region".
  (`Current Log Stopped.` is an `alertdialog`, which screen readers announce by its role; it was not
  triggered by the audit.)
- Suggested repair: make the run-state cell of the simulator's status bar `role="status"` (polite),
  so that `Halted` (and `Stopped`, `Running`) are announced when they change.

### Q1-6 - EASyBIN's "File Split" count has a label that is not exposed (owner B1)

- Rule: WCAG 4.1.2 / ARIA: `aria-label` on an element without a role is not announced. axe lists
  it as "needs review" (`aria-prohibited-attr`), not as a violation.
- Evidence: EASyBIN mode, both themes, both browsers:
  `span.e68-easybin__digits[aria-label="File Split: 1 file(s)"]`
  (`features/easybin/EasybinWorkspace.tsx`, line 263) has no role, so the label is dropped.
  Check "axe ... easybin: no aria-label on an element whose role drops it" (every axe scan runs
  this check over axe's `aria-prohibited-attr` review items; only the scans of EASyBIN mode and of its About dialog, which is scanned over the workspace,
  find one).
- Suggested repair: `role="img"` (it is a drawn group of digits) or a visually hidden text with the
  same words. Minor.

### Not defects, for the record

- The original's syntax colours (Color1 = light Auto: Macro/Other `#808000` 4.19:1, Structure
  Error `#FF0000` 3.99:1; Color2: Structure Error 3.99:1) and the Hardware panel's LED colours
  (`#400000` off on black 1.21:1, `#FF0000` on grey 1.01:1) are below WCAG AA. They follow from
  fidelity and are recorded in `docs/differences/Q1.md` with all the numbers; no change is asked.
- axe's other "needs review" items are empty containers before a program is loaded (the Listing,
  the simulator's Messages list, the editor's message grid without rows:
  `aria-required-children`) and the listing's text, whose background axe cannot decide because the
  gutter strip is a gradient behind the rows; the audit measures that text itself (part
  `contrast`): 17.73:1 / 12.48:1 (row / selected row, light), 14.01:1 / 7.49:1 (dark). None is a
  defect.
- The Output panel's keyboard field is visually hidden; its focus is shown by the panel (the check
  sees the pixels change; the ring's contrast is not measured there).
