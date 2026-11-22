// Feature "desktop-devices": the serial ports and the network of the desktop app (ARCHITECTURE.md
// 3.3.4). The devices themselves are host parts (core/sim-host/serial/desktop.ts and
// net/desktop.ts) that the desktop platform makes; this feature contributes the Serial Ports
// dialog, which maps the port names of TRAP #15 task 40 (`COM1` ...) to device paths
// (AppSettings.serialPortMap).
//
//   model.ts               the dialog's rows, checks and the devices the main process lists
//   SerialPortsDialog.tsx  the dialog `desktop-devices.serialPorts`
//   testing/programs.ts    68000 programs for tasks 40-43 and 100-107 (tests and checks)
//   check-desktop-devices.mjs  the browser check: the web build gives the values of note 37
//
// The command `sim.options.serialPorts` (Options > Serial Ports..., Simulator mode; W3 added it in
// the round before gate I3, docs/requests/DV4-serial-ports-command.md) opens the dialog; it is
// enabled in the desktop app only. The handler is registered only while commands/specs.ts has the
// id (the registry refuses a handler for an unknown id). openSerialPortsDialog(ctx) is the same
// way in for tests and checks.
//
// Owner: W3 > DV4.

import type { AppContext, CommandHandler, CommandId, FeatureModule } from '../../contracts';
import { COMMAND_SPECS } from '../../commands/specs';
import { deviceBridgeOf, detectedPorts } from './model';
import { SerialPortsDialog, type SerialPortsDialogProps } from './SerialPortsDialog';

export const SERIAL_PORTS_DIALOG_ID = 'desktop-devices.serialPorts';
/** The command the request asks for (Options menu of Simulator mode, desktop app only). */
export const SERIAL_PORTS_COMMAND = 'sim.options.serialPorts';

/** Opens the Serial Ports dialog; OK stores the new map in the settings. Resolves true on OK. */
export async function openSerialPortsDialog(ctx: AppContext): Promise<boolean> {
  const props: SerialPortsDialogProps = {
    map: ctx.settings.get().app.serialPortMap,
    detected: detectedPorts(deviceBridgeOf(ctx.platform)),
  };
  const result = await ctx.dialogs.open<SerialPortsDialogProps, Record<string, string> | null>(
    SERIAL_PORTS_DIALOG_ID,
    props,
  );
  if (!result) return false;
  ctx.settings.update((settings) => ({ ...settings, app: { ...settings.app, serialPortMap: result } }));
  return true;
}

const serialPortsCommand: CommandHandler = {
  run: (ctx) => openSerialPortsDialog(ctx).then(() => undefined),
  enabled: (_state, ctx) => ctx.platform.kind === 'desktop',
};

/** The handler of the command, once the command tables have its id (a command id without a spec
 *  is refused by the registry). */
function commands(): Record<CommandId, CommandHandler> {
  const known = Object.prototype.hasOwnProperty.call(COMMAND_SPECS, SERIAL_PORTS_COMMAND);
  return (known ? { [SERIAL_PORTS_COMMAND]: serialPortsCommand } : {}) as Record<CommandId, CommandHandler>;
}

export const feature: FeatureModule = {
  id: 'desktop-devices',
  commands: commands(),
  dialogs: { [SERIAL_PORTS_DIALOG_ID]: SerialPortsDialog },
};
