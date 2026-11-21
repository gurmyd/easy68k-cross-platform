// The command handlers of the run feature (ARCHITECTURE.md 1.3.4, 4.8, 9.7): File > Open, Open
// Data, Close and Exit of Simulator mode, the Run menu except logging, and Options > Execution
// Speed.
//
// Each handler is a few lines: the work is the run controller's (core/run/controller.ts). What a
// handler adds is the user interface around it - a file dialog, the listing's selected row - and
// when the command is available (4.8):
//
//   Run, Run To Cursor, Auto Trace, Step Over, Trace Into   commands active, not loading
//   Pause, Rewind, Open, Open Data                          not loading
//   Close                                                   a program is present
//   Reload                                                  a program has been loaded
//
// Owner: SH8.

import type {
  AppContext,
  AppState,
  CommandHandler,
  CommandId,
  FileFilter,
  OpenRequest,
  SimSettings,
} from '../../contracts';
import { dirname } from '../../core/paths/winpath';
import { showExitScreen } from '../../state/shell';

/** The filter of the simulator's Open dialog (sim-ui §8.3). */
export const S68_FILTERS: readonly FileFilter[] = [
  { label: 'EASy68K S-Record (*.S68)', patterns: ['*.S68'] },
  { label: 'All Files (*.*)', patterns: ['*.*'] },
];

/** The id of the Execution Speed dialog (2.7). */
export const SPEED_DIALOG_ID = 'sim.speed';

const notLoading = (state: AppState): boolean => state.sim.phase !== 'loading';
/** The five commands that execute: disabled in the busy state, that is while running and after a halt. */
const canExecute = (state: AppState): boolean => state.sim.menuState === 0 && notLoading(state);

/** Shows the simulator's Open dialog, starting in the folder of the loaded program. */
async function chooseSRecord(ctx: AppContext): Promise<string | null> {
  const program = ctx.sim.controller.program;
  const request: OpenRequest = { title: 'Open', filters: [...S68_FILTERS], multiple: false };
  if (program) request.startDir = dirname(program.path);
  const chosen = await ctx.fileDialogs.open(request);
  return chosen?.[0] ?? null;
}

/**
 * File > Exit (sim-ui §1.5, 1.4 note 4): the close prompts of the open documents, the program
 * stops, the log stops and the program's files get their pending bytes; then the desktop app
 * quits and the web app shows `You can close this tab.`. Settings need no saving: every change is
 * stored when it is made.
 */
export async function exitSimulator(ctx: AppContext): Promise<void> {
  if (!(await ctx.documents.closeAll())) return;
  const { controller, log, files } = ctx.sim;
  controller.pause();
  await log.exit();
  await files.exit();
  if (ctx.platform.kind === 'desktop') ctx.platform.quit();
  else showExitScreen(ctx);
}

export const commands: Record<CommandId, CommandHandler> = {
  'sim.file.open': {
    async run(ctx) {
      // PC breakpoints are cleared only when a file was chosen (note 39): the load does it.
      const path = await chooseSRecord(ctx);
      if (path !== null) await ctx.sim.controller.open(path, 'open');
    },
    enabled: notLoading,
  },
  'sim.file.openData': {
    async run(ctx) {
      const path = await chooseSRecord(ctx);
      if (path !== null) await ctx.sim.controller.openData(path);
    },
    enabled: notLoading,
  },
  'sim.file.close': {
    run: (ctx) => ctx.sim.controller.close(),
    enabled: (state) => state.sim.program !== null && notLoading(state),
  },
  'sim.file.exit': {
    run: exitSimulator,
  },

  'sim.run.run': {
    run: (ctx) => ctx.sim.controller.run(),
    enabled: canExecute,
  },
  'sim.run.runToCursor': {
    // The "cursor" is the selected listing row (sim-ui §9.4); -1 = none.
    run: (ctx) => ctx.sim.controller.runToCursor(ctx.store.getState().sim.selectedRow),
    enabled: canExecute,
  },
  'sim.run.autoTrace': {
    run: (ctx) => ctx.sim.controller.autoTrace(),
    enabled: canExecute,
  },
  'sim.run.stepOver': {
    run: (ctx) => ctx.sim.controller.stepOver(),
    enabled: canExecute,
  },
  'sim.run.traceInto': {
    run: (ctx) => ctx.sim.controller.traceInto(),
    enabled: canExecute,
  },
  'sim.run.pause': {
    run: (ctx) => ctx.sim.controller.pause(),
    enabled: notLoading,
  },
  'sim.run.rewind': {
    run: (ctx) => ctx.sim.controller.rewind(),
    enabled: notLoading,
  },
  'sim.run.reload': {
    run: (ctx) => ctx.sim.controller.reload(),
    enabled: (state) => state.sim.program !== null && notLoading(state),
  },

  'sim.options.speed': {
    async run(ctx) {
      const current = ctx.settings.get().sim.speed;
      const chosen = await ctx.dialogs.open<SimSettings['speed'], SimSettings['speed'] | null>(
        SPEED_DIALOG_ID,
        current,
      );
      if (!chosen) return; // Cancel changes nothing (note 8)
      ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, speed: chosen } }));
    },
  },
};
