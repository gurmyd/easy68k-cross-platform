Status: accepted in its first form at gate I1 (contracts engineer, W1). `contracts/commands.ts` has `CommandRunOptions { allowInModal? }` and `CommandRegistry.run(id, arg?, options?: CommandRunOptions)`; the shell's registry honours it. Only the open dialog's own code passes `{ allowInModal: true }` (E4's option dialogs: `ctx.commands.run('ed.help.help', 'options.htm', { allowInModal: true })`; B1's About box may do the same for F1). `ctx.help.open(page)` is not added. Showing the page above the dialog is for H1 and the shell. Details: `docs/porting/errata/W1.md`, entry 11.

Status (shell part, W3): done at gate I1. The registry honours `{ allowInModal: true }` (`commands/registry.ts`), and while a modal dialog is open the Help drawer is drawn above the dialog's backdrop (`data-modal` on the shell, `ui/shell/shell.css`); the dialog keeps the focus. check-shell.mjs opens `options.htm` from a message box and finds the drawer on top. E4 passes the option from its dialogs.

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
