Status: item 1 done by FS1 in gate I1 round 3 (features/files/index.ts and reveal.ts; errata FS1.md entry 17; a `reveal` that is not an absolute path toggles like any other argument); since gate I2 round 1 a remembered reveal waits at most 5 s for the panel. Item 2 done by H1 (features/help/commands.ts `showExamples` calls `app.files.toggle` with `{ reveal: WEB_EXAMPLES_DIR }`; examples.test.ts and check-help.mjs check it). Both items closed at gate I2 round 1. Filed by the contracts engineer, W1, at gate I1 round 3. Addressed to FS1 (item 1) and H1 (item 2).

# W1: implement and use `FilesRevealArg` of `app.files.toggle`

Package: W1 (contracts). Requested change: `app/src/features/files/index.ts` (FS1) and
`app/src/features/help/commands.ts` (H1). W1 may edit neither. Found by the independent review of
gate I1 round 2 (defect "FilesRevealArg defines app.files.toggle behaviour that no handler
implements, and no owner was told").

## What the contract says

`app/src/contracts/commands.ts` has, since gate I1 round 2 (errata W1.md, entry 12.3):

```ts
export interface FilesRevealArg {
  reveal: VPath;
}
```

`ctx.commands.run('app.files.toggle', { reveal })` shows the Files panel (it never hides it then)
and reveals `reveal` in its tree. Without an argument the command toggles the panel, as before.
This is how H1's Help > Examples... in a browser "shows it in the Files panel" (ARCHITECTURE.md
5.8) without importing FS1 (features may not import each other, 3.1) and without a new command id
(the ids are those of 1.3; W3 declined `app.files.reveal`, errata W3.md entry 30).

## What happens now

`features/files/index.ts` registers `run: (ctx) => togglePanel(ctx, 'files')` and ignores the
argument. A caller that passes `{ reveal: '/browser/Examples' }` while the Files panel is open
hides it, the opposite of what the contract promises. H1 therefore still calls
`showPanel(ctx, 'files')` and shows a toast (`features/help/commands.ts`, `showExamples`).

## What is asked

1. **FS1**, handler of `app.files.toggle`: when `arg` is an object with a string member `reveal`,
   show the Files panel (`showPanel`, never `togglePanel`), expand the folders above that path,
   select it and scroll it into view; a path that does not exist (yet) selects nothing and shows
   no error. Any other argument (none, `undefined`, a menu's or toolbar's call) toggles as now.
   `checked` stays `panelVisible(ctx, 'files')`. A unit test with `createTestApplication`: panel
   open + `{ reveal }` leaves it open; panel closed + `{ reveal }` opens it; no argument toggles.
2. **H1**, `showExamples` in a browser, after copying: replace `showPanel(ctx, 'files')` with
   `await ctx.commands.run('app.files.toggle', { reveal: WEB_EXAMPLES_DIR } satisfies FilesRevealArg)`
   once item 1 is in. Whether the toast stays is H1's decision (5.8 asks only for the panel).

Item 2 depends on item 1: until FS1's handler honours the argument, H1 keeps `showPanel`, which is
correct today.
