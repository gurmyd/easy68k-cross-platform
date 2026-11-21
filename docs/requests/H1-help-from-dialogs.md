# Request from H1: opening help from a modal dialog (gate; W3, E4)

editor-ui §15.2: F1 and the `Help` button of the Editor Options and Assembler Options dialogs open
`options.htm`. `CommandRegistry.run` does nothing while a modal dialog is open (3.12.2), and a
feature may not import another feature's function, so a dialog of E4 cannot reach H1's help.

H1's `ed.help.help` and `sim.help.help` take the page as the argument (`run('ed.help.help',
'options.htm')`; `ENTRY_PAGES` of `core/help` names the pages). The Help panel is a drawer, so it
can stay open next to a modal dialog; the dialog's backdrop would cover it, though.

Request (W3): either let `CommandRegistry.run` accept an option `{ allowInModal: true }` that only
a dialog's own code passes, or add `ctx.help.open(page)` to `AppContext` that H1 fills. For the
Options dialogs the page should open in a way that is visible above the dialog (the Help panel's
region has a lower `z-index` than a modal dialog, `--z-modal`).
