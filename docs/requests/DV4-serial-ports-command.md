# DV4: a command that opens the Serial Ports dialog (for W3)

Status: open. Nothing on DV4's branch depends on it; the dialog is reachable through
`openSerialPortsDialog(ctx)` (app/src/features/desktop-devices/index.ts) until it exists.

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
