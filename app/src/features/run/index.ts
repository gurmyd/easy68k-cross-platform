// Feature "run": the simulator session, the Run-menu commands, the simulator status bar.
//
//   session.ts       createSimSession: the composition root of the window's simulator (3.1)
//   commands.ts      File > Open / Open Data / Close / Exit, the Run menu, Options > Execution Speed
//   alerts.ts        the engine's message boxes as modal boxes (4.4.4)
//   startup.ts       start-up arguments and file associations (5.7)
//   StatusBar.tsx    the status bar of Simulator mode (2.3)
//   SpeedDialog.tsx  the dialog `sim.speed` (4.5.6)
//   mirror.ts        AppState.sim, the store's mirror of the simulator (3.12.1)
//
// The run controller itself, the clocks, the timers and the UI bridge are framework-free and live
// in app/src/core/run/.
//
// Owner: W3 > SH8.

import type { AppContext, FeatureModule } from '../../contracts';
import { presentAlerts } from './alerts';
import { SPEED_DIALOG_ID, commands } from './commands';
import { runSessionOf } from './session';
import { SpeedDialog } from './SpeedDialog';
import { openAssociatedFiles, openStartupFile } from './startup';
import { SimStatusBar } from './StatusBar';

export { createSimSession } from './session';

function init(ctx: AppContext): () => void {
  const report = (error: unknown): void => console.error('Simulator:', error);
  const stopAlerts = presentAlerts({ controller: ctx.sim.controller, dialogs: ctx.dialogs, report });
  const stopOpenFiles = ctx.platform.onOpenFiles((files) => void openAssociatedFiles(ctx, files).catch(report));
  void openStartupFile(ctx).catch(report);
  return () => {
    stopAlerts();
    stopOpenFiles();
    // The session ends with the window: frames, timers and the engine instance.
    runSessionOf(ctx.sim)?.dispose();
  };
}

export const feature: FeatureModule = {
  id: 'run',
  commands,
  panels: [{ id: 'status', title: 'Status bar', mode: 'simulator', component: SimStatusBar }],
  dialogs: { [SPEED_DIALOG_ID]: SpeedDialog },
  init,
};
