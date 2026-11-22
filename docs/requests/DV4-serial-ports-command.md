# DV4: a command that opens the Serial Ports dialog (for W3)

Status: items 1 and 2 done in the round before gate I3 (W3): `sim.options.serialPorts`, caption `Serial &Ports...`, no keys, no icon (`commands/ids.ts`, `specs.ts`), at the end of Simulator mode's Options menu after `sim.options.speed`, below a separator (`tables/sim-menu.ts`; `tables.test.ts` pins it). The item is in the menu on the web too, greyed there by DV4's handler (no platform-dependent menu rows exist in the tables, and adding them is a change of the table shape). Item 3 (the parity matrix row) is for DOC1/X2; not edited by W3. Errata W3.md entry 43.

Status (item 3, close-out of the round before gate I3): half done. The row "Serial Ports... (desktop app)" is in the port-only rows of ARCHITECTURE.md 1.5 (DOC1, this round). The row of the parity matrix itself is still open: `tests/parity` is not on the main branch yet (X2, branch `gate3/x2`); X2 adds the row when that branch is merged.

(Original status: open. Nothing on DV4's branch depends on it; the dialog is reachable through
`openSerialPortsDialog(ctx)` (app/src/features/desktop-devices/index.ts) until it exists.)

9.6 gives DV4 "the `COMn` to device mapping dialog" (`features/desktop-devices`), but no command
id opens it, and the command registry refuses a handler for an id that `commands/specs.ts` does
not list. Asked for:

1. `app/src/commands/specs.ts`: the id `sim.options.serialPorts` with the caption
   `Serial &Ports...` (no keys, no icon).
2. `app/src/commands/tables/sim-menu.ts`: the item in Simulator mode's Options menu, after
   `sim.options.speed`, below a separator (a command the port added: 1.3 puts those after the
   original items of their menu).
3. The parity matrix of 1.3 (DOC1/X2): one row "Serial Ports... (desktop app)" in the port-only
   rows.

The handler is in DV4's feature already and registers itself as soon as the id exists
(`commands()` in `features/desktop-devices/index.ts` looks the id up in `COMMAND_SPECS`). It is
enabled only when `ctx.platform.kind === 'desktop'`; on the web the item is greyed out (or the
menu table may leave it out there, as W3 prefers).
