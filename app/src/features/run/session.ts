// The simulator session of a window (ARCHITECTURE.md 3.1, 3.3.1, 3.11.2): the composition root.
//
// `createSimSession(ctx, env)` builds the window's one simulator - host parts, composed host, run
// controller (core/run/compose.ts) - and connects it to the application:
//
//   - what the simulator asks of the interface (show the Output panel, a question, a dialog) goes
//     to the panels and dialogs of the AppContext;
//   - the simulator's state is mirrored into `AppState.sim` (mirror.ts), which is what menus, the
//     keyboard dispatcher, the window title and the panels read;
//   - settings reach the engine at every cold start, and options the engine changes go back into
//     the settings;
//   - the page's own events that matter to a program's files (the window lost the focus, the page
//     is closing) reach the program files.
//
// No other package edits this file (3.1); a host part delivered later is picked up through its
// class at its final path, which core/run/compose.ts constructs.
//
// Owner: SH8.

import {
  SimOption,
  type AppContext,
  type GlyphProvider,
  type PrintJob,
  type SimSession,
  type SimSessionEnv,
  type SyncFiles,
  type VPath,
} from '../../contracts';
import { mountOf } from '../../core/paths/winpath';
import {
  composeSession,
  type ComposedSession,
  type SessionPartOverrides,
  type SessionUi,
} from '../../core/run/compose';
import { focusPanel, panelVisible, showPanel } from '../../state/panels';
import { createBeep } from './beep';
import { createGlyphProvider } from './glyphs';
import { mirrorSim } from './mirror';

/** The `Caution` question of the original (sim-ui §8.4). */
export const CAUTION_TITLE = 'Caution';
export const CAUTION_TEXT = 'The current debug environment will be lost, click OK to continue.';

/** The toast in Editor mode when a program asks for keyboard input (2.10). */
export const INPUT_TOAST = 'The program is waiting for keyboard input';
export const INPUT_TOAST_ACTION = 'Simulator';

/** localStorage key of the program-files journal (3.8.4). */
export const JOURNAL_KEY = 'easy68k.sim.journal.v1';

/** The props of the task 58 dialog `sim.fileDialog` (features/sim-files); it resolves to a path or null. */
export interface SimFileDialogProps {
  /** 0 = Open, 1 = Save (trap15-a task 58). */
  mode: number;
  title: string;
  filter: string;
  initialName: string;
}

/** The props of the `Log File Options` dialog `sim.logFileExists` (features/log). */
export interface LogFileExistsProps {
  kind: 'exec' | 'output';
  fileName: string;
}

/** For tests: other parts, other fonts, no start. */
export interface SimSessionOptions {
  /** Objects to use instead of the host parts at their final paths. */
  parts?: Partial<SessionPartOverrides>;
  /** Default: the font atlases of app/public/fonts (glyphs.ts). */
  glyphs?: GlyphProvider;
  /** false: the caller starts the session with `start()`. Default: it starts right after bootstrap. */
  autoStart?: boolean;
}

/** The session as this feature built it: the contract's `SimSession` and a few members more. */
export interface RunSession extends ComposedSession {
  /** What the simulator asks of the interface, as this session answers it. */
  readonly ui: SessionUi;
  /** Print jobs of task 10 that have finished, oldest first. */
  readonly printJobs: PrintJob[];
  onPrintJob(listener: (job: PrintJob) => void): () => void;
  /** Brings `AppState.sim` up to date with the simulator now. */
  sync(): void;
}

/** The session `createSimSession` built for a context, for this feature's own use; null for another session. */
export function runSessionOf(session: SimSession): RunSession | null {
  return sessions.has(session) ? (session as RunSession) : null;
}
const sessions = new WeakSet<SimSession>();

/** A VPath as the user sees it: a file on disk by its real path, anything else as it is. */
export function displayPath(path: VPath): string {
  return path === '/disk' || path.startsWith('/disk/') ? path.slice('/disk'.length) || '/' : path;
}

export function createSimSession(ctx: AppContext, env: SimSessionEnv, options: SimSessionOptions = {}): RunSession {
  const report = (what: string, error: unknown): void => console.error(`Simulator: ${what}:`, error);
  const inSimulatorMode = (): boolean => ctx.store.getState().mode === 'simulator';

  /* ---- program files: one synchronous view per mount (table of 3.8.4) */
  const cachedViews = new Map<string, SyncFiles>();
  const viewFor = (dir: VPath): SyncFiles => {
    const mount = mountOf(dir);
    if (mount === 'disk' && ctx.platform.syncFiles) return ctx.platform.syncFiles;
    let view = cachedViews.get(mount);
    if (!view) {
      view = env.createCachedSyncFiles({
        vfs: ctx.vfs,
        scheduler: ctx.scheduler,
        message: (text) => session.bridge.addMessage(text),
      });
      cachedViews.set(mount, view);
    }
    return view;
  };
  const settleFiles = (): void => {
    for (const view of cachedViews.values()) {
      void view.settled().catch((error: unknown) => report('a program file could not be written to storage', error));
    }
  };

  /* ---- what the parts report that only the session knows */
  // `sim.output.fullScreen` is shared with the Output panel, which also writes it when the user
  // toggles full screen or the browser ends it (2.5). The session therefore writes it only when it
  // has news: a request of the engine (host.setupWindow) or a cold start. The news waits here until
  // the next look at the store, because the request arrives in the middle of an engine call.
  let fullScreenRequest: boolean | null = null;
  const beep = createBeep(ctx.devices.audio);
  const printJobs: PrintJob[] = [];
  const printListeners = new Set<(job: PrintJob) => void>();

  const ui: SessionUi = {
    // Text output while the Output panel is collapsed expands it; the focus stays (2.10).
    showOutput: () => showPanel(ctx, 'output', { focus: false }),
    // A keyboard-input task starts (host.ioShow) or Run was pressed (host.ioBringToFront): the
    // Output panel gets the keyboard. In another mode the user is told instead (2.10).
    inputStarted() {
      if (inSimulatorMode()) showPanel(ctx, 'output');
      else {
        ctx.dialogs.toast(INPUT_TOAST, {
          label: INPUT_TOAST_ACTION,
          run: () => void ctx.commands.run('app.mode.set', 'simulator'),
        });
      }
    },
    bringOutputToFront() {
      if (inSimulatorMode()) showPanel(ctx, 'output');
    },
    // The Output panel reads `sim.output.fullScreen` and enters or leaves full screen (2.5).
    setFullScreen(on) {
      fullScreenRequest = on;
    },
    showHardwarePanel: () => showPanel(ctx, 'hardware', { focus: false }),
    hardwarePanelVisible: () => panelVisible(ctx, 'hardware'),
    beep,
    focusMain() {
      if (inSimulatorMode()) focusPanel(ctx, 'listing');
    },
    // The engine changed an option (a `*[sim68k]bitfield` line, task 32/5, /e, /b): the setting
    // follows at once (sim-ui Q14). Every settings update is persisted, so "save" has nothing to do.
    optionChanged(option, value) {
      ctx.settings.update((settings) =>
        settings.sim[option] === value ? settings : { ...settings, sim: { ...settings.sim, [option]: value } },
      );
    },
    saveSettings: () => {},
    async showFileDialog(mode, title, filter, initialName) {
      const props: SimFileDialogProps = { mode, title, filter, initialName };
      try {
        return await ctx.dialogs.open<SimFileDialogProps, VPath | null>('sim.fileDialog', props);
      } catch (error) {
        report('the file dialog of TRAP #15 task 58 could not be opened', error);
        return null; // as Cancel
      }
    },
    async askLogFileExists(kind) {
      const state = session.log.state;
      const props: LogFileExistsProps = {
        kind,
        fileName: kind === 'exec' ? state.execFileName : state.outputFileName,
      };
      try {
        return await ctx.dialogs.open<LogFileExistsProps, 'Replace' | 'Append' | 'Cancel'>('sim.logFileExists', props);
      } catch (error) {
        report('the Log File Options question could not be asked', error);
        return 'Cancel';
      }
    },
    submitPrintJob(job) {
      printJobs.push(job);
      for (const listener of [...printListeners]) listener(job);
    },
    journal: {
      write(text) {
        try {
          if (text === null) globalThis.localStorage?.removeItem(JOURNAL_KEY);
          else globalThis.localStorage?.setItem(JOURNAL_KEY, text);
        } catch (error) {
          report('the program-files journal could not be written', error);
        }
      },
      read() {
        try {
          return globalThis.localStorage?.getItem(JOURNAL_KEY) ?? null;
        } catch {
          return null;
        }
      },
    },
    // The controller holds the program itself while it asks, whatever the mode (4.7 step 2).
    async confirmCaution() {
      const answer = await ctx.dialogs.messageBox(
        { title: CAUTION_TITLE, text: CAUTION_TEXT, icon: 'none', buttons: ['OK', 'Cancel'] },
        { holdsProgram: false },
      );
      return answer === 'OK';
    },
    enterFullScreen: () => void ctx.commands.run('sim.output.fullscreen'),
    displayName: displayPath,
    commandLine() {
      const { run, fullScreen: full, exceptions, bitField } = ctx.platform.startupArgs();
      return { run, fullScreen: full, exceptions, bitField };
    },
    // 3.3.2, last row: listing selection none, full screen left. Panels that keep state of their
    // own (the Memory panel's Live box, the Break Points grids) reset it on `onEngineReplaced`.
    resetPanels() {
      fullScreenRequest = false;
      ctx.store.setState((state) =>
        state.sim.selectedRow === -1 ? state : { ...state, sim: { ...state.sim, selectedRow: -1 } },
      );
    },
    report,
  };

  const session: ComposedSession = composeSession({
    clock: ctx.clock,
    scheduler: ctx.scheduler,
    engines: env.engines,
    vfs: ctx.vfs,
    viewFor,
    settleFiles,
    audio: ctx.devices.audio,
    glyphs: options.glyphs ?? createGlyphProvider(),
    serial: ctx.platform.serial,
    net: ctx.platform.net,
    os: ctx.platform.os,
    settings: () => ctx.settings.get().sim,
    ...(options.parts ? { parts: options.parts } : {}),
    ui,
  });

  /* ---- AppState.sim mirrors the simulator (3.12.1, 4.6) */
  const { controller, bridge } = session;
  let logging = false;
  let breakpoints: readonly number[] = [];
  const sync = (): void => {
    const state = bridge.state;
    const { snapshot } = controller;
    const fullScreen = fullScreenRequest;
    fullScreenRequest = null;
    ctx.store.setState((appState) => {
      const sim = mirrorSim(appState.sim, {
        phase: controller.phase,
        program: controller.program,
        menuState: state.menuState,
        halted: snapshot.halted,
        autoTrace: state.autoTrace,
        keyCommands: state.keyCommands,
        logging,
        regsRevision: snapshot.revision,
        viewRevision: controller.viewRevision,
        liveRevision: controller.liveRevision,
        messageLines: state.messageLines,
        breakpoints,
        output: {
          width: session.surface.back.width,
          height: session.surface.back.height,
          fullScreen: fullScreen ?? appState.sim.output.fullScreen,
          textWrap: session.text.state.textWrap,
        },
      });
      return sim === appState.sim ? appState : { ...appState, sim };
    });
  };
  /** What only the engine knows; not read during a load, when nothing touches the engine (4.7). */
  const readEngine = (): void => {
    if (controller.phase === 'loading') return;
    try {
      logging = controller.engine.state().logging;
      breakpoints = controller.engine.breakpoints();
    } catch (error) {
      report('the engine state could not be read', error);
    }
  };
  controller.subscribe(() => {
    readEngine();
    sync();
  });
  // The Output size and text wrap can change without the controller hearing of it (a menu command
  // of the Output panel acts on the parts), and a full-screen request waits for its turn: look
  // once per frame.
  const stopFrames = ctx.scheduler.onFrame(sync);

  /* ---- two settings act on a simulator that is running (the Auto Trace Options dialog) */
  // The interval goes to the auto-trace timer at once, as the original's OK button sets it, and the
  // host keeps the engine's "disable display update" option equal to the setting (4.6). Every other
  // setting reaches the engine through its own command, and all of them at a cold start (4.7.1).
  let autoTrace = ctx.settings.get().sim;
  const stopSettings = ctx.settings.subscribe(() => {
    const { autoTraceIntervalMs, disableDisplay } = ctx.settings.get().sim;
    if (autoTraceIntervalMs !== autoTrace.autoTraceIntervalMs) bridge.autoTraceIntervalChanged();
    if (disableDisplay !== autoTrace.disableDisplay) {
      controller.invoke((engine) => engine.setOption(SimOption.DisableDisplay, disableDisplay));
    }
    autoTrace = ctx.settings.get().sim;
  });

  /* ---- events of the page that matter to a program's files (3.8.4) */
  const page = globalThis as {
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  const onBlur = (): void => {
    // The window had the focus elsewhere: files may have changed behind a cached view.
    session.files.markStale();
    controller.markFilesStale();
  };
  const onPageHide = (): void => {
    // The page is closing without notice: commit what can be committed, journal the rest.
    session.files.exitNow();
    void session.log.exit().catch(() => {});
  };
  page.addEventListener?.('blur', onBlur);
  page.addEventListener?.('pagehide', onPageHide);

  const dispose = session.dispose;
  const runSession: RunSession = Object.assign(session, {
    ui,
    printJobs,
    onPrintJob(listener: (job: PrintJob) => void) {
      printListeners.add(listener);
      return () => {
        printListeners.delete(listener);
      };
    },
    sync() {
      readEngine();
      sync();
    },
    dispose() {
      stopFrames();
      stopSettings();
      page.removeEventListener?.('blur', onBlur);
      page.removeEventListener?.('pagehide', onPageHide);
      dispose();
    },
  });
  sessions.add(runSession);

  if (options.autoStart !== false) {
    // After bootstrap() has finished with the context: the engine's start-up calls may show panels.
    void Promise.resolve().then(async () => {
      await session.files.recoverJournal().catch((error: unknown) => report('the journal could not be applied', error));
      await runSession.start();
    });
  }
  return runSession;
}
