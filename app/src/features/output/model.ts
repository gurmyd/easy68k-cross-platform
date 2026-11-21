// The Output feature's state of one window (ARCHITECTURE.md 2.5, 3.6): what the panel, the
// feature's commands and its start-up code share. One per AppContext, reached with outputOf(ctx).
//
// It holds
//   - the full-screen controller (fullscreen.ts) with its connections to the engine, the store
//     and the dialog service. The engine's flag (SimOption.Fullscreen) is the one truth about
//     "the I/O window is full screen": the engine sets it for TRAP #15 task 33 and clears it when
//     execution stops, the panel sets it when the user toggles. followEngine() makes the screen
//     follow it, whoever changed it;
//   - the mouse translator (core/sim-host/input/mouse.ts), posting to the run controller;
//   - the mirror of the Output window's state in AppState.sim.output: the surface size and the
//     text-wrap option, which the Options menu shows (the check mark of Output Window Size
//     "follows the real size"), and whether full screen is on.

import { SimOption, type AppContext, type AppState } from '../../contracts';
import { OutputMouse } from '../../core/sim-host/input/mouse';
import { focusNextPanel, showPanel } from '../../state/panels';
import { FULL_SCREEN_REFUSED, FullScreenController, type FullScreenDriver } from './fullscreen';
import { PanelInput } from './panel-input';

export interface OutputModel {
  readonly fullScreen: FullScreenController;
  readonly input: PanelInput;
  readonly mouse: OutputMouse;
  /** The panel on screen gives its full-screen driver; the returned function takes it away. */
  attachDriver(driver: FullScreenDriver): () => void;
  /** The panel on screen says how its hidden textarea takes the focus; returns the detach function. */
  attachKeys(focus: () => void): () => void;
  /** Gives the hidden textarea the focus at once, if the panel is on screen. (Code that can wait
   *  for the next render uses showPanel / focusPanel of state/panels.ts instead.) */
  focusKeys(): void;
  /** A key-down or click in the panel: audio may start, a waiting full-screen request is carried
   *  out. True if full screen was entered by it. */
  gesture(): boolean;
  /** Brings AppState.sim.output up to date: the surface size, the text-wrap option, and whether
   *  full screen is on (or on its way). Writes nothing when nothing changed. */
  sync(): void;
  /** Looks at the engine's full-screen flag and enters or leaves full screen if it has changed
   *  (task 33, a stop in trace mode, a halt). Called once per frame. */
  followEngine(): void;
  /** A cold start has replaced the engine: full screen is left, the mouse state is forgotten. */
  engineReplaced(): void;
  /** Reads the system clipboard as text for `sim.output.paste`; rejects where the browser refuses. */
  readClipboard(): Promise<string>;
}

const models = new WeakMap<object, OutputModel>();

function withOutput(state: AppState, change: Partial<AppState['sim']['output']>): AppState {
  const output = state.sim.output;
  const keys = Object.keys(change) as (keyof typeof change)[];
  if (keys.every((key) => output[key] === change[key])) return state;
  return { ...state, sim: { ...state.sim, output: { ...output, ...change } } };
}

function createOutputModel(ctx: AppContext): OutputModel {
  let driver: FullScreenDriver | null = null;
  let focusKeys: (() => void) | null = null;
  /** The value the engine's flag was told to take and has not been seen to have yet. */
  let awaited: boolean | null = null;

  /** The engine's flag, or null while the engine cannot be asked (a load, a cold start). */
  const engineFlag = (): boolean | null => {
    if (ctx.sim.controller.phase === 'loading') return null;
    try {
      return ctx.sim.engine.getOption(SimOption.Fullscreen) !== 0;
    } catch {
      return null; // the engine is being replaced
    }
  };

  const fullScreen = new FullScreenController({
    driver: () => driver,
    // The engine's flag is changed like every other engine state: through the run controller,
    // which may have to queue the call. Until the flag is seen to have the value, what the engine
    // says is old news (followEngine).
    tellEngine(on) {
      awaited = on;
      ctx.sim.controller.invoke((engine) => engine.setOption(SimOption.Fullscreen, on));
      if (engineFlag() === on) awaited = null;
    },
    publish: (on) => ctx.store.setState((state) => withOutput(state, { fullScreen: on })),
    refused: () =>
      void ctx.dialogs.messageBox({
        title: FULL_SCREEN_REFUSED.title,
        text: FULL_SCREEN_REFUSED.text,
        icon: 'information',
        buttons: ['OK'],
      }),
    // A full-screen Output panel is the only thing on screen: it is shown and gets the keyboard.
    entered: () => showPanel(ctx, 'output'),
  });

  const input = new PanelInput({
    os: ctx.platform.os,
    desktop: ctx.platform.kind === 'desktop',
    keyboard: () => ctx.sim.keyboard,
    keyCommandsEnabled: () => keyCommandsEnabled(ctx),
    commands: ctx.commands,
    gesture: () => model.gesture(),
    toggleFullScreen: () => fullScreen.toggle(),
    nextPanel: () => void focusNextPanel(ctx),
    setTimer: (delayMs, fn) => ctx.scheduler.setTimer(delayMs, fn),
  });

  const model: OutputModel = {
    fullScreen,
    input,
    mouse: new OutputMouse({ post: (event) => ctx.sim.controller.post(event) }),
    attachDriver(next) {
      driver = next;
      return () => {
        if (driver === next) driver = null;
      };
    },
    attachKeys(focus) {
      focusKeys = focus;
      return () => {
        if (focusKeys === focus) focusKeys = null;
      };
    },
    focusKeys: () => focusKeys?.(),
    gesture() {
      ctx.devices.audio.resume(); // 3.7: any key in the Output panel unlocks audio
      return fullScreen.gesture();
    },
    sync() {
      const { width, height } = ctx.sim.surface.back;
      const { textWrap } = ctx.sim.text.state;
      ctx.store.setState((state) => withOutput(state, { width, height, textWrap, fullScreen: fullScreen.wanted }));
    },
    followEngine() {
      const flag = engineFlag();
      if (flag === null) return;
      if (awaited !== null) {
        if (flag !== awaited) return;
        awaited = null;
      }
      if (flag !== fullScreen.wanted) fullScreen.set(flag, 'program');
    },
    engineReplaced() {
      awaited = null;
      fullScreen.set(false, 'program'); // the new engine's flag is off (3.3.2)
      model.mouse.resetToStartup();
      model.sync();
    },
    readClipboard() {
      const clipboard = (globalThis as { navigator?: Navigator }).navigator?.clipboard;
      if (!clipboard?.readText) return Promise.reject(new Error('This browser has no clipboard access'));
      return clipboard.readText();
    },
  };
  return model;
}

/**
 * False after TRAP #15 task 24 with D1.L = 1 (2.9.4). The engine is asked itself, so that a key
 * pressed right after the task is judged correctly; while it cannot be asked, the store's copy
 * (AppState.sim.keyCommands) answers.
 */
export function keyCommandsEnabled(ctx: AppContext): boolean {
  if (ctx.sim.controller.phase !== 'loading') {
    try {
      return !ctx.sim.engine.state().keyCommandsDisabled;
    } catch {
      // The engine is being replaced.
    }
  }
  return ctx.store.getState().sim.keyCommands;
}

/** The Output feature's state of the window that `ctx` belongs to. */
export function outputOf(ctx: AppContext): OutputModel {
  let model = models.get(ctx);
  if (!model) {
    model = createOutputModel(ctx);
    models.set(ctx, model);
  }
  return model;
}
