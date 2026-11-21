// Feature "log": logging (ARCHITECTURE.md 1.3.4, 1.3.7, 2.6, 3.3.5; sim-ui §13).
//
//   sim.run.logStart       Log Start: the `Log File Options` question for a file that exists, then
//                          logging. The program is held from the click until the engine logs, so
//                          that nothing it writes meanwhile is lost (3.3.5). A file that cannot be
//                          opened shows the original's `Error` box; for the execution log the Log
//                          Output dialog follows (sim-ui §13.3 step 4).
//   sim.run.logStop        Log Stop.
//   sim.options.logOutput  the modeless Log Output dialog (`sim.logOutput`); OK selects what is
//                          logged and stores the two types in the settings.
//   dialogs                `sim.logOutput`, `sim.logFileExists` (the latter opened by the session)
//   panel `log`            the Log panel
//
// The work is the log service's (core/sim-host/log/log-service.ts), reached as `ctx.sim.log`.
//
// Owner: W3 > U4.

import type { AppContext, AppState, FeatureModule, LogServiceApi } from '../../contracts';
import { logStartFailure } from '../../core/sim-host/log/log-service';
import { LogFileExistsDialog } from './LogFileExistsDialog';
import { LogOutputDialog, type LogOutputProps, type LogOutputResult } from './LogOutputDialog';
import { LogPanel } from './LogPanel';
import { LOG_FILE_EXISTS_DIALOG_ID, LOG_OUTPUT_DIALOG_ID, OPEN_ERROR_TITLE, openErrorText } from './model';

export { LOG_FILE_EXISTS_DIALOG_ID, LOG_OUTPUT_DIALOG_ID } from './model';

/** Contexts whose Log Output dialog is open: the command shows it once (the original's Log->Show()). */
const dialogOpen = new WeakSet<AppContext>();

const notLoading = (state: AppState): boolean => state.sim.phase !== 'loading';

/** Options > Log Output...: the modeless dialog; OK applies the values and stores the two types. */
export async function showLogOutput(ctx: AppContext): Promise<void> {
  if (dialogOpen.has(ctx)) return;
  dialogOpen.add(ctx);
  try {
    const log = ctx.sim.log;
    log.dialogShown(); // the engine's snapshot for the Rewind and Reload notes (sim-ui Q24)
    const { execFileName, outputFileName, execType, outputType, memFrom, memBytes } = log.state;
    const values = { execFileName, outputFileName, execType, outputType, memFrom, memBytes };
    const result = await ctx.dialogs.open<LogOutputProps, LogOutputResult>(
      LOG_OUTPUT_DIALOG_ID,
      { values },
      { modal: false },
    );
    if (result === null || result === undefined) return;
    log.applyDialog(result);
    // The two types are persisted (sim-ui §14.2); the original writes them at the next Log Start
    // or exit, the port at once. File names and the memory range are not remembered.
    ctx.settings.update((settings) =>
      settings.sim.execLogType === result.execType && settings.sim.outputLogType === result.outputType
        ? settings
        : { ...settings, sim: { ...settings.sim, execLogType: result.execType, outputLogType: result.outputType } },
    );
  } finally {
    dialogOpen.delete(ctx);
  }
}

/** Run > Log Start. */
export async function startLogging(ctx: AppContext): Promise<boolean> {
  const log = ctx.sim.log;
  // Held from the click until the engine logs: whatever the program writes after the click is in
  // the log, also while the store is asked whether the file exists (3.3.5, 4.4.5).
  const release = ctx.sim.controller.hold();
  let started: boolean;
  try {
    started = await log.start();
  } finally {
    release();
  }
  if (started) return true;
  const failure = logStartFailure(log);
  if (failure) {
    await ctx.dialogs.messageBox({
      title: OPEN_ERROR_TITLE,
      text: openErrorText(failure.kind),
      icon: 'none',
      buttons: ['OK'],
    });
    // "for the execution log the Log Output dialog is then shown" (logU.cpp:136)
    if (failure.kind === 'exec') void showLogOutput(ctx);
  }
  return false;
}

/** Menus, the toolbar and the keys ask again when the service's state changes. */
function followLog(ctx: AppContext, log: LogServiceApi): () => void {
  let last = log.state;
  return log.subscribe(() => {
    const now = log.state;
    if (now.startEnabled === last.startEnabled && now.stopEnabled === last.stopEnabled) return;
    last = now;
    ctx.store.setState((state) => ({ ...state }));
  });
}

export const feature: FeatureModule = {
  id: 'log',
  commands: {
    'sim.run.logStart': {
      async run(ctx) {
        await startLogging(ctx);
      },
      enabled: (state, ctx) => notLoading(state) && ctx.sim.log.state.startEnabled,
    },
    'sim.run.logStop': {
      run: (ctx) => ctx.sim.log.stop(),
      enabled: (state, ctx) => notLoading(state) && ctx.sim.log.state.stopEnabled,
    },
    'sim.options.logOutput': {
      run: (ctx) => void showLogOutput(ctx),
    },
  },
  panels: [{ id: 'log', title: 'Log', mode: 'simulator', component: LogPanel }],
  dialogs: {
    [LOG_OUTPUT_DIALOG_ID]: LogOutputDialog,
    [LOG_FILE_EXISTS_DIALOG_ID]: LogFileExistsDialog,
  },
  init(ctx) {
    return followLog(ctx, ctx.sim.log);
  },
};
