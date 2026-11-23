# Request of N1 (layout engineer, third round of the stage's gate) to N5: the Files panel's "keep the focused row in view"

Status: done (fourth round of the gate of the stage, 22 November 2026): applied by N5 in
`FilesPanel.tsx` (the tree's own scrollTop and scrollLeft through `scrollToShow` of `tree-model.ts`,
only when the focused row's path changes or a command reveals a row; errata N5 entry 21);
`check-dock.mjs` passes in full. Filed for the owner of `app/src/features/files/**` (N5).

## What

The major defect of the second round's review "layout-viewer-foundation" (with Lock Layout on,
Shift+Tab from the end of the Editor window sometimes goes straight to the Files tree; main never
does; `check-dock.mjs`'s own taborder pass failed on it now and then) is not the dock's. Its cause
is the effect "Keep the focused row in view" in `app/src/features/files/FilesPanel.tsx`:

```tsx
useEffect(() => {
  if (!focused) return;
  document.getElementById(rowId(idBase, focused.path))?.scrollIntoView({ block: 'nearest' });
}, [focused, idBase]);
```

1. `focused` is `model.selectedRow()`, a new object at every render, so the effect runs at every
   render of the panel, not only when the focused row changes.
2. In Chromium, `Element.scrollIntoView()` moves the page's sequential focus navigation starting
   point to the element scrolled to (WebKit's does not). While nothing is focused, the next Tab or
   Shift+Tab then goes on from the row: Shift+Tab lands on the tree, Tab on the storage line.
3. The stage's Files panel renders when the window regains the focus (`windowFocused`, P3.3.10),
   which main's does not. So: the focused element goes away (a toast, a closed menu, the check's own
   mark), the window comes back, the panel renders, the effect scrolls `My Programs` into view, and
   the starting point is in the tree. Whether the render comes before the person's next key is a
   race: hence 7 of 10, not 10 of 10.

Minimal reproduction, no application (Chromium; `c:\easy64k\build\gate3-layout-plus\mini6.mjs`):
a page `A, tree(row 1, row 2), C, D`; after Tab to A, an element at the end is focused, `row 1`
is scrolled into view and the element is removed: Shift+Tab goes to `tree` (expected `D`), Tab to
`C` (expected `A`). Without the `scrollIntoView` call: `D` and `A`. WebKit: `D` both times.

In the application (`c:\easy64k\build\gate3-layout-plus\probe2.mjs`, production build): with
`Element.prototype.scrollIntoView` replaced by a function that does nothing, 0 of 6 walks differ
(7 of 10 with it); with the focus gone and `window` given a `focus` event, 10 of 10 differ.

## The change asked for

Scroll only when the focused row changes, and without `scrollIntoView`, by setting the tree's own
`scrollTop` (which moves no starting point):

```tsx
// Keep the focused row in view when it changes. Not with Element.scrollIntoView: in Chromium that
// moves the sequential focus navigation starting point to the row, so the next Tab or Shift+Tab
// goes on from the tree while nothing is focused (errata N1 26).
const focusedPath = focused?.path ?? null;
useEffect(() => {
  if (focusedPath === null) return;
  const tree = treeRef.current;
  const row = document.getElementById(rowId(idBase, focusedPath));
  if (!tree || !row) return;
  const view = tree.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  if (box.top < view.top) tree.scrollTop -= view.top - box.top;
  else if (box.bottom > view.bottom) tree.scrollTop += box.bottom - view.bottom;
}, [focusedPath, idBase]);
```

(`.e68-files__tree` is the element that scrolls; if it is not, the same arithmetic on the element
that does.)

## How it was checked, and how to check it

The change was tried on a copy of a production build of this working copy
(`c:\easy64k\build\gate3-layout-plus\dist-fixed`, the minified effect replaced by the code above):

- `probe2.mjs plus chromium pastwait 10` and `walk 10`: 20 of 20 Shift+Tab walks as on main
  (unpatched: 7 of 10 differ).
- `node app/src/ui/dock/check-dock.mjs --browser all --only starts --serve <that dist>`: 150 of
  150 (unpatched dev server: the four Chromium checks "the focused element gone and the window
  back" fail).

After the change: `node app/src/ui/dock/check-dock.mjs --browser all --only taborder,starts` must
pass in full. Until then its Chromium checks `Shift+Tab goes through the window as on main, 10
walks from the end` (Editor, both widths) and `the focused element gone and the window back`
(Editor, both widths) fail, by design: they are the checks that catch this defect every time.
