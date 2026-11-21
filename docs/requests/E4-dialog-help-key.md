# Request from E4: F1 inside a modeless dialog (W3, shell)

editor-ui §15.2 and 1.4 note 8: F1 in the **Assembler Options** dialog opens `options.htm`. That
dialog is modeless (2.7). The key dispatcher (`commands/keymap.ts`) listens on `window` in the
capture phase, so while the focus is inside a modeless dialog it resolves F1 first: in Editor mode
`ed.help.help` runs without an argument (the introduction page, `main.htm`) and the event is
stopped, so the dialog's own `onKeyDown` (the kit's `Dialog`, errata W2 entry 18) never sees it.
For modal dialogs the dispatcher steps aside (step 1), which is why F1 works in Editor Options.

Today F1 in Assembler Options therefore opens `main.htm`, which is what the original does by
mistake (`EDIT_OPTIONS` is not in its keyword table), not `options.htm`, which note 8 asks for.
`check-options.mjs` prints this as a note and does not fail on it.

Request (W3), one of:

1. The dispatcher leaves a chord alone while the focus is inside an element that claims it, for
   example `[data-e68-own-keys~="F1"]` (step 0, before step 3), so that the dialog's handler gets
   the event. E4 then puts `data-e68-own-keys="F1"` on its dialog box. The same would serve
   sim-main's modeless Find dialog for F3 (sim-ui §6.7) if U1 wants it.
2. Or: the dispatcher leaves F1 alone whenever the focus is inside any `[role=dialog]`, modal or
   not; every dialog of the port that has a help page handles F1 itself (E4's two option dialogs,
   B1's About box), and a dialog without one would then do nothing on F1, as the original's
   modeless dialogs do.

E4's dialog already handles F1 in its `onKeyDown` (`AssemblerOptionsDialog.tsx`); nothing else in
E4 changes when either form is applied. The check will then report F1 as passed (its note becomes
a check).
