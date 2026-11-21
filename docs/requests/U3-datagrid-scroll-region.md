# U3: the DataGrid's scrolling body and axe's `scrollable-region-focusable`

Status: done at gate I2 by W2 (the first option): the grid element, which holds the focus, is the scroll container and its header row is sticky; `height` still means the rows' area. axe finds no `scrollable-region-focusable` on such a grid any more (errata W2 entry 20). U3 may drop the "not counted (kit)" filter in `check-breakpoints.mjs`.

## What

A `DataGrid` with a `height` (the Break Points panel's three grids, 49 rows each, six visible)
scrolls its body (`.e68-grid__body`, `role="rowgroup"`) while the keyboard focus stays on the grid
itself. axe-core (`wcag2a`) reports each such body as a serious `scrollable-region-focusable`
violation, because the scrolling element neither takes the focus nor contains anything focusable.

Functionally the grid is keyboard-accessible: the arrow keys, Page Up / Page Down and Ctrl+Home /
Ctrl+End move the selected row and the grid scrolls it into view. axe cannot see that.

## Asked

One of, at the kit owner's choice:

- make the grid element itself the scroll container (the header row can stay visible with
  `position: sticky`), so that the focusable element is the one that scrolls; or
- give the body `tabindex="-1"` plus whatever the kit owner finds acceptable to satisfy the rule
  without adding a second Tab stop; or
- record in the kit that this axe finding is expected for grids with a height, so that every
  check that scans a DataGrid filters it the same way.

## Meanwhile

`app/src/features/breakpoints/check-breakpoints.mjs` prints this finding for nodes matching
`.e68-grid__body` as "not counted (kit)" and counts every other axe finding.
