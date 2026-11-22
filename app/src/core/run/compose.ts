// The simulator session, composed (ARCHITECTURE.md 3.3.1, 3.11.2, 4.7.1).
//
// One function builds everything a window's simulator consists of - the host parts, the composed
// host, the software timers and the run controller - and ties them to each other. It is used
// twice:
//
//   features/run/session.ts   the application: time, files, dialogs and panels of the real page
//   core/run/headless.ts      tests and conformance runs under Node: virtual time, files in memory
//
// so both run the same parts wired the same way. What differs comes in as `SessionEnv`. The parts
// are the classes at their final paths (3.3.1); a caller may put its own object in place of any of
// them (`SessionEnv.parts`), which is how a test replaces a device by a double.
//
// Owner: SH8.

import {
  HwDevice,
  SimOption,
  type AudioBackend,
  type Clock,
  type ControllerRequest,
  type FontSpec,
  type GlyphProvider,
  type HardwareModelApi,
  type HostNet,
  type HostSerial,
  type InputEvent68k,
  type ListingViewApi,
  type LogServiceApi,
  type OutputDeviceApi,
  type OutputKeyboardApi,
  type PrinterDeviceApi,
  type PrintJob,
  type ProgramFilesApi,
  type Scheduler,
  type SimEngine,
  type SimEngineFactory,
  type SimSession,
  type SimSettings,
  type SoundDeviceApi,
  type SurfaceApi,
  type SyncFiles,
  type TextScreenApi,
  type Vfs,
  type VPath,
} from '../../contracts';
import { ListingView } from '../listing/view';
import { SoundDevice } from '../sim-host/audio/sound-device';
import { ProgramFiles } from '../sim-host/files/program-files';
import { HardwareModel } from '../sim-host/hardware/model';
import { createSimHost } from '../sim-host/index';
import { OutputKeyboard } from '../sim-host/input/keyboard';
import { OutputDevice } from '../sim-host/io';
import { LogService } from '../sim-host/log/log-service';
import { NullNet } from '../sim-host/net/null';
import { PrinterDevice } from '../sim-host/printer';
import { NullSerial } from '../sim-host/serial/null';
import { Surface } from '../sim-host/surface/surface';
import { TextScreen } from '../sim-host/text/text-screen';
import { SimRunController, type CommandLineSwitches } from './controller';
import { TimerSet } from './timers';
import { SimUiBridge, type ChangedOption } from './ui-bridge';

/** The size of the Output window when the original starts (3.3.2). */
export const STARTUP_WIDTH = 640;
export const STARTUP_HEIGHT = 480;

/** Parts a caller may supply instead of the classes at the final paths. */
export interface SessionPartOverrides {
  surface: SurfaceApi;
  text: TextScreenApi;
  /** The `text` and `graphics` host parts. */
  output: OutputDeviceApi;
  keyboard: OutputKeyboardApi;
  sound: SoundDeviceApi;
  hardware: HardwareModelApi;
  log: LogServiceApi;
  files: ProgramFilesApi;
  printer: PrinterDeviceApi;
  listing: ListingViewApi;
}

/** What the session shows, asks and is told through the user interface. */
export interface SessionUi {
  /** Text output: make the Output panel visible if it is collapsed; the focus stays (2.10). */
  showOutput(): void;
  /** `host.ioShow()`: a keyboard-input task starts; the Output panel gets the keyboard (2.10). */
  inputStarted(): void;
  /** `host.ioBringToFront()`: Run was pressed; bring the Output panel forward with the keyboard. */
  bringOutputToFront(): void;
  /** `host.setupWindow(fullScreen)`, and the end of full screen at a cold start (2.5). */
  setFullScreen(on: boolean): void;
  /** `host.hardwareShow()` (task 32/0): make the Hardware panel visible. */
  showHardwarePanel(): void;
  /** The Hardware panel is visible: a cold start then tells the engine so (4.7.1 step 4). */
  hardwarePanelVisible(): boolean;
  /** The bell character (trap15-a §3.5). */
  beep(): void;
  /** `host.focusMain()`: the keyboard focus goes to the Listing panel (2.10). */
  focusMain(): void;
  /** The engine changed the exceptions or bit-field option (sim-ui Q14). */
  optionChanged(option: ChangedOption, value: boolean): void;
  /** Task 32/5: the original writes its settings file. */
  saveSettings(): void;
  /** The task 58 dialog; resolves to the chosen path or null. */
  showFileDialog(mode: number, title: string, filter: string, initialName: string): Promise<VPath | null>;
  /** The `Log File Options` question for an existing log file. */
  askLogFileExists(kind: 'exec' | 'output'): Promise<'Replace' | 'Append' | 'Cancel'>;
  /** A finished print job of task 10. */
  submitPrintJob(job: PrintJob): void;
  /** Bytes that must survive an abrupt close of the page (3.8.4). */
  journal: { write(text: string | null): void; read(): string | null };
  /** The `Caution` question (sim-ui §8.4); true = OK. */
  confirmCaution(): Promise<boolean>;
  /** The `/f` switch: the full-screen command of the Output panel. */
  enterFullScreen(): void;
  /** The path as the user sees it (4.7 step 6). */
  displayName(path: VPath): string;
  /** The switches this application was started with (sim-ui §8.1). */
  commandLine(): CommandLineSwitches;
  /** A cold start has put the panels' own state back to its start (3.3.2, last row of the table). */
  resetPanels(): void;
  report(what: string, error: unknown): void;
  /** The listing row selected now, -1 = none: read by a Run To Cursor kept during a load. */
  cursorRow?(): number;
}

export interface SessionEnv {
  clock: Clock;
  scheduler: Scheduler;
  engines: SimEngineFactory;
  vfs: Vfs;
  /** The synchronous view of a program folder, by mount (table of 3.8.4). */
  viewFor: (dir: VPath) => SyncFiles;
  /** Starts writing what the views hold to storage now ("when execution stops", 3.8.4). */
  settleFiles: () => void;
  audio: AudioBackend;
  glyphs: GlyphProvider;
  /** The desktop app's serial and network devices; absent in a browser (3.3.4). */
  serial?: HostSerial | null;
  net?: HostNet | null;
  os: 'mac' | 'windows' | 'linux';
  /** The current `SimSettings`. */
  settings: () => SimSettings;
  ui: SessionUi;
  parts?: Partial<SessionPartOverrides>;
}

/** The session with what its owner needs beyond the contract. */
export interface ComposedSession extends SimSession {
  readonly controller: SimRunController;
  readonly bridge: SimUiBridge;
  readonly timers: TimerSet;
  /** The print jobs task 10 has finished, oldest first (3.8.4; `SimSession.printJobs`). */
  readonly printJobs: PrintJob[];
  /** Called with each print job when it is finished, after `SessionUi.submitPrintJob`. */
  onPrintJob(listener: (job: PrintJob) => void): () => void;
  /** The application's own start: process-start state (4.7.1). Resolves when the engine is there. */
  start(): Promise<void>;
  /** Ends the session: frames, timers and the engine. */
  dispose(): void;
}

/** A font of the settings, without a style, as the text screen takes it. */
export function plainFont(font: { name: string; size: number }): FontSpec {
  return { name: font.name, size: font.size, bold: false, italic: false, underline: false, strikeOut: false };
}

/**
 * The saved SimSettings applied to a new engine, as the original's LoadSettings applies sim68K.dat
 * (4.7.1 step 4): exceptions, bit field, both log types, the display option of Auto Trace, and the
 * four device addresses (whose handlers also set the push-button byte, hardware §8). The fonts are
 * in place before the engine exists (`resetParts`); the auto-trace interval is read when the timer
 * starts (ui-bridge.ts); the Stack and Memory panels read their choices from the settings.
 */
export function applySimSettings(engine: SimEngine, settings: SimSettings, hardwareVisible: boolean): void {
  engine.setOption(SimOption.Exceptions, settings.exceptions);
  engine.setOption(SimOption.BitField, settings.bitField);
  engine.setOption(SimOption.ExecLogType, settings.execLogType);
  engine.setOption(SimOption.OutputLogType, settings.outputLogType);
  engine.setOption(SimOption.DisableDisplay, settings.disableDisplay);
  engine.setDeviceAddress(HwDevice.Seg7, settings.seg7Address);
  engine.setDeviceAddress(HwDevice.Led, settings.ledAddress);
  engine.setDeviceAddress(HwDevice.Switch, settings.switchAddress);
  engine.setDeviceAddress(HwDevice.PushButton, settings.buttonAddress);
  // Showing the Hardware window zeroes the switch byte, as at the original's start.
  if (hardwareVisible) engine.setHardwareVisible(true);
}

/**
 * The saved settings a cold start puts in place, in a fixed order (4.7.1 steps 2 and 4): the engine
 * options and device addresses of `applySimSettings`, the fonts, the Stack and Memory panel choices,
 * and whether the Hardware panel is visible. Not in it: what acts on a running simulator as soon as
 * it changes (the speed, read at every slice; the auto-trace interval, passed on by the session;
 * the highlighting of changed registers, a choice of the register display).
 */
export function coldStartSettingsKey(settings: SimSettings, hardwareVisible: boolean): string {
  const font = (f: { name: string; size: number }): string => `${f.name}/${f.size}`;
  return JSON.stringify([
    settings.exceptions,
    settings.bitField,
    settings.execLogType,
    settings.outputLogType,
    settings.disableDisplay,
    settings.seg7Address,
    settings.ledAddress,
    settings.switchAddress,
    settings.buttonAddress,
    font(settings.outputFont),
    font(settings.listingFont),
    font(settings.printerFont),
    settings.whichStack,
    settings.memoryAddress,
    hardwareVisible,
  ]);
}

/**
 * Knows whether a change saved outside the simulator (the editor, the Files panel, another window)
 * may not have reached a view of the program files yet (3.8.4; gate I2, SH6's review): a cached
 * view reads such a change asynchronously after the Vfs reports it, so a Run right after a save
 * would otherwise read the old bytes. Every change the Vfs reports counts; a view that has nothing
 * to read resolves at once, so the program's own writes cost a microtask.
 */
function trackFileChanges(
  vfs: Vfs,
  views: () => Iterable<SyncFiles>,
): {
  pending: () => Promise<void> | null;
  dispose: () => void;
} {
  let pending: Promise<void> | null = null;
  let epoch = 0;
  const onChange = (): void => {
    const mine = ++epoch;
    // The views' own listeners run in the same notification, some after this one (they subscribe
    // when they prepare a folder): ask them once all have heard of the change.
    const waiting = Promise.resolve()
      .then(() => Promise.all([...views()].map((view) => view.whenCurrent?.())))
      .then(
        () => {},
        () => {},
      );
    pending = waiting;
    void waiting.then(() => {
      if (epoch === mine) pending = null;
    });
  };
  const unsubscribe = typeof vfs.subscribe === 'function' ? vfs.subscribe('/', onChange) : () => {};
  return { pending: () => pending, dispose: unsubscribe };
}

export function composeSession(env: SessionEnv): ComposedSession {
  const { clock, scheduler, ui, parts = {} } = env;
  const timers = new TimerSet(clock);

  // The views of the program files the session handed out, and the changes they may still read.
  const views = new Set<SyncFiles>();
  const viewFor = (dir: VPath): SyncFiles => {
    const view = env.viewFor(dir);
    views.add(view);
    return view;
  };
  const fileChanges = trackFileChanges(env.vfs, () => views);

  // The parts post to the controller's queue and the controller is built from the parts, so the
  // queue is reached through this binding, which is set a few lines below.
  let controller: SimRunController | null = null;
  const theController = (): SimRunController => {
    if (!controller) throw new Error('The run controller was used before the session was composed');
    return controller;
  };
  const post = (entry: InputEvent68k | ControllerRequest): void => theController().post(entry);

  const bridge = new SimUiBridge({
    clock,
    timers,
    post,
    autoTraceIntervalMs: () => env.settings().autoTraceIntervalMs,
    optionChanged: (option, value) => ui.optionChanged(option, value),
    saveSettings: () => ui.saveSettings(),
    focusMain: () => ui.focusMain(),
    textFontAssign: (target, source) => text.fontAssign(target, source),
    printerFontChanged: () => printer.fontChanged(),
  });
  const message = (line: string): void => bridge.addMessage(line);

  // Finished print jobs are kept for the session's life (errata SH8.md C2).
  const printJobs: PrintJob[] = [];
  const printListeners = new Set<(job: PrintJob) => void>();
  const submitPrintJob = (job: PrintJob): void => {
    printJobs.push(job);
    ui.submitPrintJob(job);
    for (const listener of [...printListeners]) listener(job);
  };

  // The saved settings the last cold start put in place: read at its step 2 (the Output font) and
  // at its step 4 (the engine). A cold start is skipped only while they are still the same (4.7.1).
  let settingsAtReset: string | null = null;
  let settingsApplied: string | null = null;
  const settingsKey = (): string => coldStartSettingsKey(env.settings(), ui.hardwarePanelVisible());

  const log: LogServiceApi =
    parts.log ??
    new LogService({
      vfs: env.vfs,
      clock,
      scheduler,
      invoke: (fn) => theController().invoke(fn),
      askFileExists: (kind) => ui.askLogFileExists(kind),
    });
  const surface: SurfaceApi = parts.surface ?? new Surface(STARTUP_WIDTH, STARTUP_HEIGHT);
  const text: TextScreenApi =
    parts.text ??
    new TextScreen({
      surface,
      glyphs: env.glyphs,
      scheduler,
      outputLog: (data) => log.outputWrite(data),
      beep: () => ui.beep(),
      show: () => ui.showOutput(),
    });
  const output: OutputDeviceApi =
    parts.output ??
    new OutputDevice({
      surface,
      text,
      show: () => ui.inputStarted(),
      bringToFront: () => ui.bringOutputToFront(),
      setFullScreen: (on) => ui.setFullScreen(on),
      // `Output window size limited to 4096 x 4096` (2.5) goes to the simulator message area.
      message,
    });
  const keyboard: OutputKeyboardApi = parts.keyboard ?? new OutputKeyboard({ post, os: env.os });
  const files: ProgramFilesApi =
    parts.files ??
    new ProgramFiles({
      viewFor,
      message,
      showFileDialog: (mode, title, filter, initialName) => ui.showFileDialog(mode, title, filter, initialName),
      post,
      journal: ui.journal,
    });
  const sound: SoundDeviceApi =
    parts.sound ?? new SoundDevice({ backend: env.audio, clock, readProgramFile: (name) => files.read(name), message });
  const hardware: HardwareModelApi =
    parts.hardware ??
    new HardwareModel({
      post,
      timers: { create: (onTick) => timers.create(onTick) },
      showPanel: () => ui.showHardwarePanel(),
    });
  const printer: PrinterDeviceApi =
    parts.printer ??
    new PrinterDevice({ font: () => env.settings().printerFont, submit: (job) => submitPrintJob(job) });
  const serial: HostSerial = env.serial ?? new NullSerial();
  const net: HostNet = env.net ?? new NullNet();
  const listing: ListingViewApi = parts.listing ?? new ListingView(() => theController().engine);

  const host = createSimHost({
    main: bridge,
    hardware,
    log,
    files,
    text: output,
    graphics: output,
    sound,
    serial,
    net,
    printer,
  });

  /** `resetToStartup()` of a device that came from the platform and may not have one. */
  const resetDevice = (device: object): void => {
    (device as { resetToStartup?: () => void }).resetToStartup?.();
  };

  controller = new SimRunController({
    clock,
    scheduler,
    engines: env.engines,
    host,
    bridge,
    timers,
    speed: () => env.settings().speed,
    vfs: env.vfs,
    glyphs: env.glyphs,
    files,
    log,
    listing,
    lifecycle: {
      // Bytes an abrupt close of the page left in the journal reach the files before any program
      // can look at them (3.8.4).
      recover: () => files.recoverJournal(),
      // The old simulator exits as the original's process does (4.7.1 step 1).
      async exit() {
        await log.exit();
        await files.exit();
        ui.setFullScreen(false);
      },
      // Every part back to the state right after start (4.7.1 step 2, table of 3.3.2). The printer's
      // reset submits an open job as it stands, which is how the old simulator's print job is closed.
      resetToStartup() {
        surface.resetToStartup();
        text.resetToStartup();
        keyboard.resetToStartup();
        sound.resetToStartup();
        files.resetToStartup();
        printer.resetToStartup();
        hardware.resetToStartup();
        log.resetToStartup();
        resetDevice(serial);
        resetDevice(net);
        ui.resetPanels();
        // The original loads its settings before the simulator's first reset: the Output Window
        // Font must be in place when the engine's start-up reset assigns it.
        text.setOptionsFont(plainFont(env.settings().outputFont), text.state.optionsFontColor);
        settingsAtReset = settingsKey();
      },
      applySettings(engine) {
        applySimSettings(engine, env.settings(), ui.hardwarePanelVisible());
        settingsApplied = settingsKey();
      },
      stopped() {
        env.settleFiles();
        void log.flush().catch((error: unknown) => ui.report('The log files could not be written', error));
      },
    },
    ui: {
      confirmCaution: () => ui.confirmCaution(),
      resumeAudio: () => env.audio.resume(),
      enterFullScreen: () => ui.enterFullScreen(),
      displayName: (path) => ui.displayName(path),
      commandLine: () => ui.commandLine(),
      report: (what, error) => ui.report(what, error),
      ...(ui.cursorRow ? { cursorRow: () => ui.cursorRow?.() ?? -1 } : {}),
    },
    // The two things a user can change without the controller hearing of it (4.7.1, last paragraph).
    partsUntouched: () =>
      surface.back.width === STARTUP_WIDTH && surface.back.height === STARTUP_HEIGHT && !text.state.textWrap,
    settingsUnchanged: () =>
      settingsApplied !== null && settingsAtReset === settingsApplied && settingsKey() === settingsApplied,
    filesCatchingUp: fileChanges.pending,
  });
  const built = controller;

  return {
    get engine() {
      return built.engine;
    },
    host,
    controller: built,
    surface,
    text,
    keyboard,
    sound,
    hardware,
    listing,
    log,
    files,
    printer,
    glyphs: env.glyphs,
    onEngineReplaced: (listener) => built.onEngineReplaced(listener),
    bridge,
    timers,
    printJobs,
    onPrintJob(listener) {
      printListeners.add(listener);
      return () => {
        printListeners.delete(listener);
      };
    },
    start: () => built.start(),
    dispose: () => {
      fileChanges.dispose();
      built.dispose();
    },
  };
}
