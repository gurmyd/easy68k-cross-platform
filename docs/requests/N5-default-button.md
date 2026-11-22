# N5: a message box whose default button is not the first

Status: open. For: the gate's contracts engineer (`app/src/contracts/features.ts`) and the owner of
the kit's `MessageBox` and of the DialogService that renders it (W2, W3). Filed by N5.

## What is wrong

P3.3.4 gives the question asked when no copy can be kept as "titled with the command, `warning`,
`Yes`, `No`; No has the focus". `MessageBoxRequest` has no member that names the button with the
focus, and the kit's `MessageBox` gives the focus to the first button, so Yes has the focus and
Enter answers Yes: the one question of the safety net that warns "This cannot be undone." is the
one that a stray Enter answers the dangerous way. The Files panel asks it for Delete, Replace (Move,
Copy) and Undo of a Copy (`cannotKeepConfirm` in `app/src/features/files/bulk.ts`); N4's Restore
asks it too.

## What N5 did

Nothing outside its paths: the buttons stay `Yes`, `No` in that order (the original's order), and
Yes has the focus (errata N5 entry 2).

## Asked

An optional member of `MessageBoxRequest`:

    /** The button that has the focus when the box opens (absent: the first). */
    defaultButton?: MessageBoxRequest['buttons'][number];

honoured by the kit's `MessageBox` (and the DialogService that renders it), with a gallery case.
When it is there, N5 passes `defaultButton: 'No'` in `cannotKeepConfirm` (one line) and adds a
check to `check-files.mjs` that Enter on the question answers No.
