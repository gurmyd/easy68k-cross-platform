// Feature "output": the Output panel with its keyboard and mouse (ARCHITECTURE.md 2.5, 2.9.4,
// 3.6; work package SH4).
//
// The panel stands for the original's I/O window. This module contributes
//
//   the panel                      OutputPanel.tsx, in the region `output` of Simulator mode
//   sim.view.output                View > Output Window: leaves full screen, shows and focuses the panel
//   sim.output.fullscreen          toggles full screen (Alt+Enter in the panel; the `/f` switch)
//   sim.output.paste               pastes the clipboard as typed input (Shift+Insert, Cmd+V in the panel)
//   sim.output.releaseKeyboard     Ctrl+Alt+O in the panel: the focus moves to the next panel
//   sim.options.size               Options > Output Window Size (argument: index into OUTPUT_SIZES)
//   sim.options.textWrap           Options > Output Window Text Wrap
//
// and, from the moment the window starts, looks at the session once per frame: the surface size
// and the text-wrap option go into AppState.sim.output for the Options menu, and the screen
// follows the engine's full-screen flag (TRAP #15 task 33, a stop; model.ts, fullscreen.ts).
//
// The three chords of the panel act only while its hidden textarea has the focus, where the panel
// handles them itself (panel-input.ts); the keyboard dispatcher never runs these commands.
//
// Owner: W3 > SH4.

import type { AppContext, FeatureModule } from '../../contracts';
import { shortcutText } from '../../commands/menus';
import { OUTPUT_SIZES } from '../../commands/tables/sim-menu';
import { focusNextPanel, showPanel } from '../../state/panels';
import { keyCommandsEnabled, outputOf } from './model';
import { OutputPanel } from './OutputPanel';

/** Options > Output Window Size: what the original's menu handler does, `simIO->setWindowSize(w, h)`
 *  (sim-ui §14.1). The host owns the surface; the engine only asks it for the size. */
function setOutputSize(ctx: AppContext, index: unknown): void {
  const size = typeof index === 'number' ? OUTPUT_SIZES[index] : undefined;
  if (!size) return;
  ctx.sim.host.setWindowSize(size.width, size.height);
  outputOf(ctx).sync();
}

/** `sim.output.paste` without its key: asks the platform for the clipboard and types it in. */
async function pasteIntoProgram(ctx: AppContext): Promise<void> {
  const output = outputOf(ctx);
  showPanel(ctx, 'output');
  if (ctx.platform.pasteIntoFocus) {
    // Desktop app: the native paste command puts the clipboard into the panel's textarea, whose
    // paste event the panel then treats as this command's.
    output.focusKeys();
    output.input.expectPaste();
    ctx.platform.pasteIntoFocus();
    return;
  }
  try {
    output.input.pasteByCommand(await output.readClipboard());
  } catch {
    // The browser refused to hand out the clipboard (section 1.4 note 45): name the key.
    const state = ctx.store.getState();
    const chord = shortcutText('sim.output.paste', { os: ctx.platform.os, desktop: false, state });
    ctx.dialogs.toast(`Press ${chord ?? 'the paste key'} to paste`);
  }
}

export const feature: FeatureModule = {
  id: 'output',

  panels: [{ id: 'output', title: 'Output', mode: 'simulator', component: OutputPanel }],

  commands: {
    'sim.view.output': {
      run(ctx) {
        // The original leaves full screen if the I/O window is in it, and shows the window
        // otherwise (sim-ui §3.1). Here the panel is shown and focused in both cases.
        outputOf(ctx).fullScreen.set(false, 'command');
        showPanel(ctx, 'output');
      },
    },
    'sim.output.fullscreen': {
      // The argument true or false sets the state; without one the command toggles.
      run(ctx, arg) {
        const { fullScreen } = outputOf(ctx);
        fullScreen.set(typeof arg === 'boolean' ? arg : !fullScreen.wanted, 'command');
      },
    },
    'sim.output.paste': {
      run: pasteIntoProgram,
      // After TRAP #15 task 24 the original ignores Shift+Insert (trap15-a §3.9).
      enabled: (_state, ctx) => keyCommandsEnabled(ctx),
    },
    'sim.output.releaseKeyboard': {
      run(ctx) {
        focusNextPanel(ctx);
      },
    },
    'sim.options.size': {
      run: setOutputSize,
      // The check mark follows the real size, also one set by TRAP #15 task 33; a size that is none
      // of the nine leaves every item unchecked (sim-ui §14.1).
      checked(state, _ctx, arg) {
        const size = typeof arg === 'number' ? OUTPUT_SIZES[arg] : undefined;
        return size !== undefined && size.width === state.sim.output.width && size.height === state.sim.output.height;
      },
    },
    'sim.options.textWrap': {
      run(ctx) {
        const { text } = ctx.sim;
        text.setTextWrap(!text.state.textWrap);
        outputOf(ctx).sync();
      },
      checked: (state) => state.sim.output.textWrap,
    },
  },

  init(ctx) {
    const output = outputOf(ctx);
    output.followEngine();
    output.sync();
    const disposers = [
      // A program changes the surface size and asks for full screen without notice (TRAP #15 task
      // 33), and the engine leaves full screen when execution stops: looked at once per frame.
      ctx.scheduler.onFrame(() => {
        output.followEngine();
        output.sync();
      }),
      ctx.store.subscribe(() => {
        // A full-screen Output panel belongs to Simulator mode.
        if (ctx.store.getState().mode !== 'simulator' && output.fullScreen.phase === 'full') {
          output.fullScreen.set(false, 'command');
        }
      }),
      // A cold start (4.7.1) gives the window a new engine (3.3.2: "full screen left").
      ctx.sim.onEngineReplaced(() => output.engineReplaced()),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  },
};
