// A simulator session without a user interface (ARCHITECTURE.md 6.4): the real engine, the real
// host parts and the real run controller under Node, with virtual time and answers given in
// advance where the application would ask the user. For unit tests of the host packages, for the
// conformance harness (tests/conformance/sim/harness.ts) and for anything else that wants to run
// a 68000 program to its end and look at what it did.
//
//   const session = await createHeadlessSession({
//     engines: { create: createSimEngine, release: releaseSimEngine },   // app/src/engine
//     vfs,                                                                // a Vfs with a backend
//     viewFor: () => new MemorySyncFiles(),                               // app/src/fs/sync/memory
//   });
//   await session.controller.open('/memory/demo/prog.S68', 'open');
//   session.controller.run();
//   session.runUntilIdle();            // advances virtual time until the program has stopped
//   session.messages();                // the message area
//   session.text.state.text;           // the text shadow array, session.surface.back the pixels
//
// core/ may not import the engine binding or the file system (3.1), which is why the caller
// passes them in; everything else has a default.
//
// Owner: SH8.

import type {
  AudioBackend,
  GlyphProvider,
  HostNet,
  HostSerial,
  PrintJob,
  SimEngineFactory,
  SimSettings,
  SyncFiles,
  Vfs,
  VPath,
} from '../../contracts';
import { DEFAULT_SIM_SETTINGS } from '../settings/defaults';
import { VirtualTime, VIRTUAL_FRAME_MS } from './clock';
import { composeSession, type ComposedSession, type SessionPartOverrides } from './compose';
import type { CommandLineSwitches } from './controller';

/** What a headless session answers where the application would ask the user. */
export interface HeadlessAnswers {
  /** The `Caution` question; default true (OK). */
  caution?: () => boolean;
  /** The task 58 dialog: the chosen path, or null for Cancel; default null. */
  fileDialog?: (mode: number, title: string, filter: string, initialName: string) => VPath | null;
  /** The `Log File Options` question; default 'Replace'. */
  logFileExists?: (kind: 'exec' | 'output') => 'Replace' | 'Append' | 'Cancel';
}

export interface HeadlessOptions {
  /** `{ create: createSimEngine, release: releaseSimEngine }` of app/src/engine. */
  engines: SimEngineFactory;
  /** Where the `.S68`, the `.L68` and the log files are. */
  vfs: Vfs;
  /** The synchronous file view of a program folder (3.8.4), e.g. a MemorySyncFiles. */
  viewFor: (dir: VPath) => SyncFiles;
  /** Called when execution stops, to write the views through; default nothing. */
  settleFiles?: () => void;
  /** Default: a new VirtualTime. */
  time?: VirtualTime;
  /** Laid over the defaults of sim-ui §14.3. */
  settings?: Partial<SimSettings>;
  /** Default: every cell 8 x 16 pixels, every glyph blank. */
  glyphs?: GlyphProvider;
  /** Default: an audio backend that plays nothing. */
  audio?: AudioBackend;
  serial?: HostSerial | null;
  net?: HostNet | null;
  os?: 'mac' | 'windows' | 'linux';
  commandLine?: Partial<CommandLineSwitches>;
  answers?: HeadlessAnswers;
  /** Objects to use instead of the host parts at their final paths. */
  parts?: Partial<SessionPartOverrides>;
  /** false: the caller starts the session itself (`session.start()`). */
  start?: boolean;
}

export interface HeadlessSession extends ComposedSession {
  readonly time: VirtualTime;
  /** The settings in force; change a member to change the setting. */
  readonly settings: SimSettings;
  /** The simulator message area. */
  messages(): readonly string[];
  /** What the interface was asked to do, in order: 'showOutput', 'inputStarted', 'focusMain', 'fullScreen:true' ... */
  readonly uiLog: string[];
  /** The print jobs task 10 has finished. */
  readonly printJobs: PrintJob[];
  /** Failures reported through `report` (they would go to the console in the application). */
  readonly reports: { what: string; error: unknown }[];
  /**
   * Advances virtual time frame by frame until the simulator is idle with nothing queued, or
   * `limitMs` of virtual time have passed. Message boxes of the engine are answered with OK.
   * True if it became idle.
   */
  runUntilIdle(limitMs?: number): boolean;
}

/** A glyph provider without fonts: the default cell, nothing drawn. */
export const BLANK_GLYPHS: GlyphProvider = {
  ready: Promise.resolve(),
  metrics: () => ({ colWidth: 8, rowHeight: 16 }),
  glyph: () => ({ advance: 8, width: 8, height: 16, coverage: new Uint8Array(8 * 16) }),
};

/** An audio backend that accepts every sound and plays none. */
export function createSilentAudio(): AudioBackend {
  let next = 1;
  return { load: () => next++, play: () => next++, stop: () => {}, release: () => {}, resume: () => {} };
}

export async function createHeadlessSession(options: HeadlessOptions): Promise<HeadlessSession> {
  const time = options.time ?? new VirtualTime();
  const settings: SimSettings = { ...structuredClone(DEFAULT_SIM_SETTINGS), ...options.settings };
  const answers = options.answers ?? {};
  const uiLog: string[] = [];
  const printJobs: PrintJob[] = [];
  const reports: { what: string; error: unknown }[] = [];
  let journal: string | null = null;

  const session = composeSession({
    clock: time,
    scheduler: time,
    engines: options.engines,
    vfs: options.vfs,
    viewFor: options.viewFor,
    settleFiles: options.settleFiles ?? (() => {}),
    audio: options.audio ?? createSilentAudio(),
    glyphs: options.glyphs ?? BLANK_GLYPHS,
    serial: options.serial ?? null,
    net: options.net ?? null,
    os: options.os ?? 'windows',
    settings: () => settings,
    ...(options.parts ? { parts: options.parts } : {}),
    ui: {
      showOutput: () => void uiLog.push('showOutput'),
      inputStarted: () => void uiLog.push('inputStarted'),
      bringOutputToFront: () => void uiLog.push('bringOutputToFront'),
      setFullScreen: (on) => void uiLog.push(`fullScreen:${on}`),
      showHardwarePanel: () => void uiLog.push('showHardwarePanel'),
      hardwarePanelVisible: () => false,
      beep: () => void uiLog.push('beep'),
      focusMain: () => void uiLog.push('focusMain'),
      optionChanged(option, value) {
        settings[option] = value; // the engine changed it: the settings follow (sim-ui Q14)
      },
      saveSettings: () => void uiLog.push('saveSettings'),
      showFileDialog: async (mode, title, filter, initialName) =>
        answers.fileDialog?.(mode, title, filter, initialName) ?? null,
      askLogFileExists: async (kind) => answers.logFileExists?.(kind) ?? 'Replace',
      submitPrintJob: (job) => void printJobs.push(job),
      journal: {
        write(text) {
          journal = text;
        },
        read: () => journal,
      },
      confirmCaution: async () => answers.caution?.() ?? true,
      enterFullScreen: () => void uiLog.push('enterFullScreen'),
      displayName: (path) => path,
      commandLine: () => ({
        run: false,
        fullScreen: false,
        exceptions: false,
        bitField: false,
        ...options.commandLine,
      }),
      resetPanels: () => void uiLog.push('resetPanels'),
      report: (what, error) => void reports.push({ what, error }),
    },
  });

  const headless: HeadlessSession = Object.assign(session, {
    time,
    settings,
    uiLog,
    printJobs,
    reports,
    messages: () => session.bridge.state.messageLines,
    runUntilIdle(limitMs = 60_000): boolean {
      const { controller } = session;
      const settled = () =>
        controller.phase === 'idle' && controller.queueLength === 0 && controller.alerts.length === 0;
      for (let elapsed = 0; ; elapsed += VIRTUAL_FRAME_MS) {
        if (controller.alerts.length > 0) controller.dismissAlerts();
        if (settled()) return true;
        if (elapsed >= limitMs) return false;
        time.advance(VIRTUAL_FRAME_MS);
      }
    },
  });

  if (options.start !== false) await headless.start();
  return headless;
}
