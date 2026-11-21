# B1: F1 for EASyBIN Help

Status: done at gate I1 (W3): `tables/keys.ts` binds F1 to `bin.help.help` on both key maps. Menus show no shortcut for it (`NOT_SHOWN_IN_MENUS`), because the original's Help action has no ShortCut in Form1u.dfm, as for `ed.help.help`; docs/differences/W3.md. check-shell.mjs presses F1 in EASyBIN mode.

Package: B1 (EASyBIN). Requested change: `app/src/commands/tables/keys.ts` (owner W3).

## What

Bind F1 to `bin.help.help` on both key maps, as `ed.help.help` is bound:

    'bin.help.help': { win: ['F1'], mac: ['F1'] },

## Why

The original opens `easybin.htm` with F1 in its memory area and its Address field
(`Form1u.cpp:465-467, 722-724`; docs/porting/easybin.md 15.2), and the menu should show the key.
Without the binding the dispatcher has no F1 in EASyBIN mode, and the browser's own F1 help could
open. Until the binding exists, B1's workspace handles an F1 that reaches the memory area or the
Address field itself (errata B1 entry 8); with the binding the dispatcher takes F1 first and that
local handler simply never runs, so nothing else has to change.
