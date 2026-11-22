Status: closed (checked in the round before gate I3, W1 and W3): B1 calls `setModeTitle(ctx, 'easybin', ...)` (`features/easybin/commands.ts`), so nothing of this request remains. The line "Status: open" under the heading below is the request's original status.

Status (contract part, W1): declined at gate I1, because the request's second form is being done instead and needs no contract: the shell's `setModeTitle(ctx, mode, title | null)` in `app/src/state/shell.ts`. `AppState` gets no `easybin` member. B1 calls `setModeTitle(ctx, 'easybin', caption)` when a file is opened and `setModeTitle(ctx, 'easybin', null)` after New. Details: `docs/porting/errata/W1.md`, entry 11. The `Status:` line below is the shell engineer's.

Status: done at gate I1 (W3), in the request's second form: `setModeTitle(ctx, mode, title | null)` in `app/src/state/shell.ts`; `windowTitle()` in `bootstrap.ts` uses it before the fixed title, and the bootstrap updates the title when it changes. B1 still has to call it (errata W3.md entry 30).

# B1: the opened file in the window title of EASyBIN mode

Status: open

Package: B1 (EASyBIN). Requested change: `app/src/contracts/store.ts` (W1) and
`windowTitle()` in `app/src/bootstrap.ts` (W3).

## What

Either

- `AppState.easybin: { caption: string }`, written by the EASyBIN feature, and `windowTitle()`
  using it in EASyBIN mode as it uses `sim.program.title` in Simulator mode; or
- a small hook in the shell through which a mode's feature supplies its title.

## Why

The original's title bar shows `EASyBIN v2.5.0`, the full path of the file last opened (Open
S-Record, Open Binary, a dropped file), and `EASyBIN v2.5.0` again after New
(docs/porting/easybin.md 1.2). Today `windowTitle()` shows the fixed title in EASyBIN mode and the
contract has nowhere to carry the caption. B1 shows it in the status bar of EASyBIN mode meanwhile
(errata B1 entry 7, Contract C2); the caption is `easybinOf(ctx).model.getState().caption` in
`app/src/features/easybin/session.ts`.
