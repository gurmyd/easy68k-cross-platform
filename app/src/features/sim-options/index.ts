// Feature "sim-options": the simulator's Options menu except Log Output, Output Window Size, Text
// Wrap and the port's additions (ARCHITECTURE.md 1.3.4, 1.4 notes 27-29; sim-ui §14.1).
//
//   sim.options.sourceFont   font dialog -> SimSettings.listingFont (the listing, heading and
//                            message area are drawn with it by CSS, 3.3.1)
//   sim.options.outputFont   font dialog -> SimSettings.outputFont and TextScreen.setOptionsFont
//                            (font, style and colour; only name and size are saved, trap15-a §3.2)
//   sim.options.printerFont  font dialog -> SimSettings.printerFont and PrinterDevice.fontChanged
//   sim.options.exceptions   check: SimOption.Exceptions, saved at once
//   sim.options.bitField     check: SimOption.BitField, saved at once
//   sim.options.autoTrace    Auto Trace Options -> SimSettings.autoTraceIntervalMs, .disableDisplay
//                            (the simulator session applies both to a running simulator)
//   sim.options.fullscreen   Fullscreen Options -> SimOption.FullscreenMonitor (never saved)
//
// Every option dialog is modal and holds the program while it is open (4.4.5). Engine calls go
// through the run controller (`controller.invoke`).
//
// Owner: W3 > U4.

import { SimOption, type AppContext, type AppState, type FeatureModule, type SimSettings } from '../../contracts';
import { AutoTraceDialog } from './AutoTraceDialog';
import { FontDialog } from './FontDialog';
import { FullscreenDialog, type FullscreenProps, type FullscreenResult } from './FullscreenDialog';
import {
  AUTO_TRACE_DIALOG_ID,
  FONT_DIALOG_ID,
  FULLSCREEN_ACTIVE_TEXT,
  FULLSCREEN_ACTIVE_TITLE,
  FULLSCREEN_DIALOG_ID,
  clampInterval,
  plainSpec,
  type AutoTraceResult,
  type AutoTraceValues,
  type FontDialogProps,
  type FontDialogResult,
  type FontTargetKind,
} from './model';

export { AUTO_TRACE_DIALOG_ID, FONT_DIALOG_ID, FULLSCREEN_DIALOG_ID } from './model';

function updateSim(ctx: AppContext, patch: Partial<SimSettings>): void {
  ctx.settings.update((settings) => {
    const changed = (Object.keys(patch) as (keyof SimSettings)[]).some((key) => settings.sim[key] !== patch[key]);
    return changed ? { ...settings, sim: { ...settings.sim, ...patch } } : settings;
  });
}

/** One of the three font dialogs. */
export async function chooseFont(ctx: AppContext, target: FontTargetKind): Promise<void> {
  const sim = ctx.settings.get().sim;
  const text = ctx.sim.text.state;
  const props: FontDialogProps =
    target === 'output'
      ? // The Options font of this session, with its style and colour (they last for the session).
        {
          target,
          font: { ...text.optionsFont, name: sim.outputFont.name, size: sim.outputFont.size },
          color: text.optionsFontColor,
        }
      : { target, font: plainSpec(target === 'source' ? sim.listingFont : sim.printerFont), color: 0 };
  const result = await ctx.dialogs.open<FontDialogProps, FontDialogResult>(FONT_DIALOG_ID, props);
  if (!result) return;
  const saved = { name: result.font.name, size: result.font.size };
  if (target === 'source') {
    updateSim(ctx, { listingFont: saved });
  } else if (target === 'output') {
    updateSim(ctx, { outputFont: saved });
    // On OK the font goes to the back buffer and the window, and the cell is measured again
    // (SIM68Ku.cpp:956-963). Every simulator reset re-applies it (TextScreen.fontAssign).
    ctx.sim.text.setOptionsFont(result.font, result.color);
  } else {
    updateSim(ctx, { printerFont: saved });
    ctx.sim.printer.fontChanged(); // initPrint() (SIM68Ku.cpp:967-972)
  }
}

/** Options > Auto Trace Options.... */
export async function chooseAutoTrace(ctx: AppContext): Promise<void> {
  const sim = ctx.settings.get().sim;
  const props: AutoTraceValues = {
    intervalMs: clampInterval(sim.autoTraceIntervalMs),
    disableDisplay: sim.disableDisplay,
  };
  const result = await ctx.dialogs.open<AutoTraceValues, AutoTraceResult>(AUTO_TRACE_DIALOG_ID, props);
  if (!result) return;
  updateSim(ctx, { autoTraceIntervalMs: result.intervalMs, disableDisplay: result.disableDisplay });
}

/** Options > Fullscreen Options.... */
export async function chooseFullscreen(ctx: AppContext): Promise<void> {
  if (ctx.store.getState().sim.output.fullScreen) {
    await ctx.dialogs.messageBox({
      title: FULLSCREEN_ACTIVE_TITLE,
      text: FULLSCREEN_ACTIVE_TEXT,
      icon: 'none',
      buttons: ['OK'],
    });
    return;
  }
  const monitor = ctx.sim.engine.getOption(SimOption.FullscreenMonitor) & 0xff;
  const result = await ctx.dialogs.open<FullscreenProps, FullscreenResult>(FULLSCREEN_DIALOG_ID, {
    screen: monitor + 1,
  });
  if (result === null || result === undefined) return;
  ctx.sim.controller.invoke((engine) => engine.setOption(SimOption.FullscreenMonitor, result - 1));
}

/** A check item of the Options menu that is an engine option saved at once (sim-ui §14.1). */
function toggleOption(ctx: AppContext, key: 'exceptions' | 'bitField', option: SimOption): void {
  const value = !ctx.settings.get().sim[key];
  updateSim(ctx, { [key]: value });
  ctx.sim.controller.invoke((engine) => engine.setOption(option, value));
}

const checkedSetting =
  (key: 'exceptions' | 'bitField') =>
  (state: AppState): boolean =>
    state.settings.sim[key];

export const feature: FeatureModule = {
  id: 'sim-options',
  commands: {
    'sim.options.sourceFont': { run: (ctx) => chooseFont(ctx, 'source') },
    'sim.options.outputFont': { run: (ctx) => chooseFont(ctx, 'output') },
    'sim.options.printerFont': { run: (ctx) => chooseFont(ctx, 'printer') },
    'sim.options.exceptions': {
      run: (ctx) => toggleOption(ctx, 'exceptions', SimOption.Exceptions),
      checked: checkedSetting('exceptions'),
    },
    'sim.options.bitField': {
      run: (ctx) => toggleOption(ctx, 'bitField', SimOption.BitField),
      checked: checkedSetting('bitField'),
    },
    'sim.options.autoTrace': { run: (ctx) => chooseAutoTrace(ctx) },
    'sim.options.fullscreen': { run: (ctx) => chooseFullscreen(ctx) },
  },
  dialogs: {
    [FONT_DIALOG_ID]: FontDialog,
    [AUTO_TRACE_DIALOG_ID]: AutoTraceDialog,
    [FULLSCREEN_DIALOG_ID]: FullscreenDialog,
  },
};
