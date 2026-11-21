// The run controller (ARCHITECTURE.md 3.11.2, section 4): the one place that changes the simulator
// engine, and the only code that calls `engine.run()`.
//
// The engine never blocks and never reads a clock. It executes instructions when it is told to and
// reports where the original program would have waited (keyboard input, a delay, a file dialog, a
// message box). The controller does what the original's message loop does around that:
//
//   tick()            the one way to make progress: once per display frame, when a delay ends, when
//                     something is posted, and directly after a run command. Ticks never nest.
//   runSlice()        executes instructions in sub-slices, as many as the speed setting allows
//                     (governor.ts) and the frame's time budget permits.
//   the queue         keys, mouse events, interrupt requests and other engine calls of host parts
//                     are delivered BETWEEN instructions, in order; while the program executes, at
//                     most one input edge per sub-slice, so that a program that polls sees each.
//   wait states       input, delay (task 23, in real time), the task 58 dialog, message boxes.
//   loads             open, reload, close, cold start: phase 'loading' from beginning to end, during
//                     which nothing else reaches the engine.
//   afterEngineCall   after EVERY engine call: what the host calls recorded (ui-bridge.ts) is turned
//                     into a refreshed snapshot, revision counters and message boxes.
//   failure           an engine call that throws (a WebAssembly trap) shows the original's box for
//                     internal faults and restarts the simulator from start-up state.
//
// The controller is framework-free: time, engines, files and every question to the user come in
// through `RunControllerDeps`, so the same code runs in the application and under Node with
// virtual time.
//
// Owner: SH8.

import {
  Box,
  RunStatus,
  SimOption,
  type Clock,
  type ControllerRequest,
  type GlyphProvider,
  type InputEvent68k,
  type ListingViewApi,
  type LoadKind,
  type LoadOrigin,
  type LogServiceApi,
  type PendingAlert,
  type ProgramFilesApi,
  type ProgramInfo,
  type RunController,
  type RunSnapshot,
  type Scheduler,
  type SimEngine,
  type SimEngineFactory,
  type SimHost,
  type SimPhase,
  type Vfs,
  type VPath,
} from '../../contracts';
import { encode } from '../codec/cp1252';
import { basename, changeFileExt, dirname } from '../paths/winpath';
import { Governor, instructionsPerSecond, stepsBetween, subslice, type SpeedSetting } from './governor';
import { createStartupEngine, startupBoxes } from './startup-engine';
import type { TimerSet } from './timers';
import type { SimUiBridge } from './ui-bridge';

/** The switches of a command line (sim-ui §8.1), applied by a load with origin 'commandLine'. */
export interface CommandLineSwitches {
  run: boolean; // /r
  fullScreen: boolean; // /f
  exceptions: boolean; // /e
  bitField: boolean; // /b
}

/** What a cold start and a stop ask of the host parts (4.7.1, 4.2). */
export interface SessionLifecycle {
  /**
   * 4.7.1 step 1, the old simulator exits as the original's process does: the log stops without a
   * message box, the program's files receive their pending bytes, an open print job is closed,
   * full screen is left.
   */
  exit(): Promise<void>;
  /**
   * 4.7.1 step 2: `resetToStartup()` of every part, and whatever the saved settings put in place
   * before the engine's start-up reset runs (the original loads its settings first: the fonts).
   */
  resetToStartup(): void;
  /** 4.7.1 step 4: the saved SimSettings, applied to the new engine as LoadSettings applies sim68K.dat. */
  applySettings(engine: SimEngine): void;
  /** Execution stopped (4.2, `Stopped` and `Error`): write program files through, flush the logs. */
  stopped(): void;
}

/** The questions and effects that need a user interface. */
export interface ControllerUi {
  /** The `Caution` question (sim-ui §8.4); true = OK. The controller holds the program meanwhile. */
  confirmCaution(): Promise<boolean>;
  /** A run command is a user gesture: unlock audio (3.7). */
  resumeAudio(): void;
  /** The `/f` switch: the full-screen command of the Output panel. */
  enterFullScreen(): void;
  /** The path as the user sees it: the name given to the engine for its messages and the caption. */
  displayName(path: VPath): string;
  /** The switches of this start; read when a 'commandLine' load reaches step 9 of 4.7. */
  commandLine(): CommandLineSwitches;
  /** Something failed that the user cannot be shown in the simulator's own terms. */
  report(what: string, error: unknown): void;
}

export interface RunControllerDeps {
  clock: Clock;
  scheduler: Scheduler;
  /** Creates and releases engine instances (app/src/engine, reached through the session's env). */
  engines: SimEngineFactory;
  /** The composed host, given to every instance. */
  host: SimHost;
  /** The `main` part of that host: it records what the engine reports (4.6). */
  bridge: SimUiBridge;
  /** The software timers: checked in every tick (4.5.3), all switched off by a cold start (4.7.1). */
  timers: Pick<TimerSet, 'check' | 'disableAll'>;
  /** `SimSettings.speed`, read at every slice. */
  speed: () => SpeedSetting;
  /** Reads the `.S68` and finds the `.L68` (4.7 step 5). */
  vfs: Pick<Vfs, 'readFile' | 'resolve'>;
  glyphs: Pick<GlyphProvider, 'ready'>;
  files: Pick<ProgramFilesApi, 'setCurrentDir' | 'revalidateIfStale'>;
  log: Pick<LogServiceApi, 'setLogFileNames'>;
  listing: Pick<ListingViewApi, 'refresh' | 'isInstruction'>;
  lifecycle: SessionLifecycle;
  ui: ControllerUi;
  /**
   * True while the host parts are still as a cold start left them, for the parts the user can
   * change without the controller hearing of it (the Output size, text wrap). A cold start is
   * skipped only when the controller has done nothing since the last one AND this is true (4.7.1).
   */
  partsUntouched?: () => boolean;
}

/** The message area after the recovery from an engine failure (4.8). */
export const RESTART_NOTICE = 'The simulator was restarted after an internal error. Load the program again.';

/** Title of the boxes the original opens with a null caption, and of its internal-fault box. */
export const ERROR_TITLE = 'Error';
/** Run To Cursor on a row that is not an instruction row (sim-ui §9.4). */
export const NO_VALID_ADDRESS = 'Selected line does not have a valid address.';
/** Run To Cursor with no row selected (sim-ui §9.4). */
export const INVALID_RUN_TO_CURSOR = 'Invalid Run-To-Cursor Selection';

/** The original's box for its own internal faults (sim-ui §9.12, RUN.CPP:1010). */
export function engineFaultText(pc: string, opcode: number): string {
  const code = (opcode & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `ERROR: An exception occurred in routine 'exec_inst'.\nPC=${pc}  Code=${code}`;
}

type QueueEntry = InputEvent68k | ControllerRequest;

/** Entries between which the original always executes an instruction (4.3). */
const INPUT_EDGES: ReadonlySet<QueueEntry['kind']> = new Set([
  'keyDown',
  'keyUp',
  'char',
  'mouseDown',
  'mouseUp',
  'pushButton',
  'switchClick',
]);

/** A message box of `controller.alerts`: the engine's own, or one the controller raised itself. */
interface Alert {
  /** The object in `controller.alerts`; it stays the same object for as long as the box is open. */
  box: PendingAlert;
  fromEngine: boolean;
}

/** Thrown through the controller's own frames after an engine call failed. It never leaves the controller. */
const ENGINE_FAILED = Symbol('the simulator engine failed');

/** Row indexes 0-2 of a listing are its header (sim-ui §6.1). */
const FIRST_PROGRAM_ROW = 3;

/** Longest stretch a delay timer waits before the controller looks again (4.4.2). */
const DELAY_TIMER_MAX_MS = 1000;
/** One unit of TRAP #15 task 23 (4.4.2). */
const DELAY_UNIT_MS = 10;

/** The governor's figures, for tests and for the performance package. */
export interface GovernorReading {
  allowance: number;
  frameInterval: number;
  usedThisFrame: number;
  /** Engine time one frame gets, in milliseconds. */
  frameBudget: number;
}

export class SimRunController implements RunController {
  private current: SimEngine = createStartupEngine();
  /** `current` is a real engine instance (not the stand-in of startup-engine.ts). */
  private live = false;
  private phaseNow: SimPhase = 'loading';
  private holds = 0;
  private programNow: ProgramInfo | null = null;
  private snapshotNow: RunSnapshot = { boxes: startupBoxes(), cycles: 0n, highlight: -1, halted: false, revision: 0 };
  private alertList: Alert[] = [];
  private alertsView: readonly PendingAlert[] = [];
  private readonly queue: QueueEntry[] = [];
  private readonly governor = new Governor();
  private readonly listeners = new Set<() => void>();
  private readonly replacedListeners = new Set<() => void>();

  private viewRev = 0;
  private liveRev = 0;
  private livePending = false;
  private dirty = false;

  /** An engine method is executing: `invoke` must queue. */
  private inEngine = false;
  private ticking = false;
  private cancelTickTimer: (() => void) | null = null;
  private cancelFrames: (() => void) | null = null;

  /* task 23 (4.4.2) */
  private delayStart = 0;
  private delayReported = 0;
  private delayStep = -1;
  private cancelDelayTimer: (() => void) | null = null;
  /** Since when a hold or an open box keeps the program from running; null = it may run. */
  private frozenAt: number | null = null;

  /** The Caution question is open: a second load request is ignored like one made during a load. */
  private asking = false;
  /** Nothing has reached the engine since the last cold start (4.7.1). */
  private pristine = false;
  /** The window had the focus elsewhere: program files may have changed (3.8.4). */
  private filesStale = false;
  /** The instruction word at the PC of the last snapshot, for the internal-fault box. */
  private lastOpcode = 0xffff;
  /** Instructions the last `runEngine` executed. */
  private executed = 0;
  /** An input edge reached the executing program and no instruction has run since (4.3). */
  private edgeDelivered = false;
  private recovering = false;
  private disposed = false;
  private startup: Promise<void> | null = null;

  constructor(private readonly deps: RunControllerDeps) {}

  /* ================================================================== state */

  get phase(): SimPhase {
    return this.phaseNow;
  }
  get held(): boolean {
    return this.holds > 0;
  }
  get program(): ProgramInfo | null {
    return this.programNow;
  }
  get snapshot(): RunSnapshot {
    return this.snapshotNow;
  }
  get alerts(): readonly PendingAlert[] {
    return this.alertsView;
  }

  /** The current engine instance; before the first one exists and between two, a stand-in. */
  get engine(): SimEngine {
    return this.current;
  }
  /** Bumped when a panel named by a RepaintBit must re-read its data (4.6). */
  get viewRevision(): number {
    return this.viewRev;
  }
  /** Bumped at most once per frame when memory or the hardware display changed (4.6). */
  get liveRevision(): number {
    return this.liveRev;
  }
  get governorReading(): GovernorReading {
    const { allowance, frameInterval, usedThisFrame } = this.governor;
    return { allowance, frameInterval, usedThisFrame, frameBudget: this.governor.budget() + usedThisFrame };
  }
  /** Entries posted and not yet delivered. */
  get queueLength(): number {
    return this.queue.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fires after a cold start has replaced the engine and reset every part (3.11.2). */
  onEngineReplaced(listener: () => void): () => void {
    this.replacedListeners.add(listener);
    return () => {
      this.replacedListeners.delete(listener);
    };
  }

  /**
   * The application's own start (4.7.1): begins listening to display frames and brings the
   * simulator into process-start state. Safe to call more than once; loads requested before it has
   * finished wait for it.
   */
  start(): Promise<void> {
    if (!this.startup) {
      this.cancelFrames = this.deps.scheduler.onFrame(() => this.tick(true));
      this.startup = this.coldStartSteps()
        .catch((error: unknown) => this.deps.ui.report('The simulator could not be started', error))
        .then(() => this.finishLoading());
    }
    return this.startup;
  }

  /** Stops frames and timers and releases the engine. The controller cannot be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrames?.();
    this.cancelTickTimer?.();
    this.cancelDelayTimer?.();
    this.queue.length = 0;
    if (this.live) this.deps.engines.release(this.current);
    this.live = false;
    this.current = createStartupEngine();
  }

  /** The window had the focus elsewhere: the next run command or Reload revalidates the files (3.8.4). */
  markFilesStale(): void {
    this.filesStale = true;
  }

  /* ================================================================== loads (4.7) */

  async open(path: VPath, origin: LoadOrigin): Promise<void> {
    await this.start();
    if (this.phaseNow === 'loading' || this.asking) return;
    const active = this.phaseNow !== 'idle';
    const ask =
      (origin === 'drop' && this.programNow !== null) || ((origin === 'open' || origin === 'execute') && active);
    if (ask) {
      if (!(await this.confirmThenLoad())) return;
    } else {
      this.setPhase('loading');
    }
    this.publish();
    await this.load(path, origin);
  }

  async reload(): Promise<void> {
    await this.start();
    if (this.phaseNow === 'loading' || this.asking || !this.programNow) return;
    this.setPhase('loading');
    this.publish();
    await this.load(this.programNow.path, 'reload');
  }

  /** File > Open Data: S-records on top of what is in memory, with no reset of any kind (sim-ui §8.3). */
  async openData(path: VPath): Promise<void> {
    await this.start();
    if (this.phaseNow === 'loading' || this.asking) return;
    const before = this.phaseNow;
    this.setPhase('loading');
    this.publish();
    try {
      const bytes = await this.readOrNull(path);
      const name = encode(this.deps.ui.displayName(path)).bytes;
      this.call((engine) => engine.loadData(bytes, name));
      // The original's file dialog moved the process's current directory (3.8.4) and now names the
      // data file, so Reload loads it as if it were the program (sim-ui Q11; kept).
      await this.attempt('prepare the folder of the data file', () => this.deps.files.setCurrentDir(dirname(path)));
      if (this.programNow) this.setProgram({ ...this.programNow, path });
    } catch (error) {
      if (error === ENGINE_FAILED) return;
      this.deps.ui.report('Open Data failed', error);
    }
    // Nothing was reset: the program goes on where it was.
    this.finishLoading(before);
  }

  /** File > Close: the Caution question, then `engine.close()` (sim-ui §8.5). */
  async close(): Promise<void> {
    await this.start();
    if (this.phaseNow === 'loading' || this.asking) return;
    if (!(await this.confirmThenLoad())) return;
    this.publish();
    this.guard(() => {
      this.call((engine) => engine.close());
      this.deps.listing.refresh();
      // The title is not reset and Reload still loads the last file (sim-ui §8.5).
      if (this.programNow) this.setProgram({ ...this.programNow, hasListing: false });
      this.finishLoading();
    });
  }

  /** Process-start state without a program (4.7.1). */
  async coldStart(): Promise<void> {
    await this.start();
    if (this.phaseNow === 'loading' || this.asking) return;
    this.setPhase('loading');
    this.publish();
    await this.coldStartSteps();
    this.finishLoading();
  }

  /** Asks the Caution question with the program held; on OK the controller is in 'loading' when it returns. */
  private async confirmThenLoad(): Promise<boolean> {
    this.asking = true;
    const release = this.hold();
    let confirmed = false;
    try {
      confirmed = await this.deps.ui.confirmCaution();
    } catch (error) {
      this.deps.ui.report('The Caution question failed', error);
    }
    this.asking = false;
    // 'loading' before the hold ends: the old program must not execute another instruction.
    if (confirmed && !this.disposed) this.setPhase('loading');
    release();
    return confirmed && !this.disposed;
  }

  /** Steps 4 to 10 of 4.7. The phase is 'loading' on entry. */
  private async load(path: VPath, origin: LoadOrigin): Promise<void> {
    try {
      if (origin === 'execute' || origin === 'commandLine' || origin === 'association') {
        if (!(await this.coldStartSteps())) {
          this.finishLoading();
          return;
        }
      }
      await this.attempt('load the fonts', () => this.deps.glyphs.ready);
      const s68 = await this.readOrNull(path);
      const l68 = await this.readListing(path);
      if (origin === 'reload') {
        await this.attempt('revalidate the program folder', () => this.deps.files.revalidateIfStale());
      } else {
        await this.attempt('prepare the program folder', () => this.deps.files.setCurrentDir(dirname(path)));
      }
      this.filesStale = false;
      if (this.disposed) return;

      const kind: LoadKind = origin === 'open' ? 'open' : origin === 'reload' ? 'reload' : 'drop';
      const name = encode(this.deps.ui.displayName(path)).bytes;
      this.call((engine) => engine.load(s68, l68, { name, kind }));
      this.deps.listing.refresh();
      const title = this.deps.bridge.state.caption;
      if (s68 !== null) {
        this.setProgram({ path, title: title ?? this.deps.ui.displayName(path), hasListing: l68 !== null });
      } else if (this.programNow) {
        // The file could not be read: the engine has reset and says so in the message area. The
        // title stays; Reload now names this file, as the original's dialog does (sim-ui §8.2 step 6).
        this.setProgram({ ...this.programNow, path, hasListing: false });
      }
      if (origin !== 'reload') this.deps.log.setLogFileNames(path);

      const switches = origin === 'commandLine' ? this.deps.ui.commandLine() : null;
      if (switches?.exceptions || switches?.bitField) {
        // The engine reports each change through host.optionChanged, which writes it to the settings.
        this.call((engine) => {
          if (switches.exceptions) engine.setOption(SimOption.Exceptions, true);
          if (switches.bitField) engine.setOption(SimOption.BitField, true);
        });
      }
      this.finishLoading();
      if (switches?.fullScreen) this.deps.ui.enterFullScreen();
      if (switches?.run) this.run();
    } catch (error) {
      if (error === ENGINE_FAILED) return; // the recovery of fail() ends the 'loading' phase
      // A host part failed. The load must not leave the simulator locked in 'loading'.
      this.deps.ui.report(`Loading ${path} failed`, error);
      this.finishLoading();
    }
  }

  /**
   * 4.7.1: the window's one simulator gets the state of a program that has just started. The phase
   * is 'loading' on entry and stays so. False if no engine could be created; the stand-in is then
   * in place and the message area says why.
   */
  private async coldStartSteps(): Promise<boolean> {
    const { bridge, lifecycle, engines } = this.deps;
    if (this.live && this.pristine && (this.deps.partsUntouched?.() ?? true)) return true;

    // 1. The old simulator exits.
    await this.attempt('shut the simulator down', () => lifecycle.exit());
    this.deps.timers.disableAll();
    this.cancelDelayTimer?.();
    this.cancelDelayTimer = null;
    this.queue.length = 0;
    const old = this.current;
    const wasLive = this.live;
    this.current = createStartupEngine();
    this.live = false;
    if (wasLive) engines.release(old);
    this.alertList = this.alertList.filter((alert) => !alert.fromEngine);
    this.updateAlertsView();

    // 2. Every part goes back to its start-up state.
    try {
      lifecycle.resetToStartup();
    } catch (error) {
      this.deps.ui.report('A simulator part could not be reset', error);
    }
    bridge.resetToStartup();
    this.setProgram(null);

    // 3. A new engine. The host receives the start-up reset's calls while it is created; they only
    //    record (3.3.2), and nothing here looks at the engine before it exists.
    let created: SimEngine;
    try {
      created = await engines.create(this.deps.host);
    } catch (error) {
      this.deps.ui.report('The simulator engine could not be created', error);
      this.withoutEngine(error);
      return false;
    }
    if (this.disposed) {
      engines.release(created);
      return false;
    }
    this.current = created;
    this.live = true;

    // 4. and 5. Saved settings, then what the start-up reset reported.
    const inRecovery = this.recovering;
    try {
      this.call((engine) => lifecycle.applySettings(engine));
    } catch (error) {
      if (error !== ENGINE_FAILED) throw error;
      // The new engine failed at once. If this cold start was itself the recovery from a failure,
      // there is nothing left to try: the stand-in stays. Otherwise fail() has begun a recovery.
      if (inRecovery) {
        engines.release(created);
        this.withoutEngine(new Error('The simulator engine failed again while it was restarted.'));
      }
      return false;
    }
    this.deps.listing.refresh();
    this.pristine = true;
    this.notifyReplaced();
    return true;
  }

  /** No engine could be had: the stand-in is in place, in start-up state, and the message area says why. */
  private withoutEngine(reason: unknown): void {
    this.current = createStartupEngine();
    this.live = false;
    this.deps.bridge.takeRegistersShown();
    this.deps.bridge.takeAlerts();
    this.deps.bridge.addMessage(reason instanceof Error ? reason.message : String(reason));
    this.snapshotNow = {
      boxes: startupBoxes(),
      cycles: 0n,
      highlight: -1,
      halted: false,
      revision: this.snapshotNow.revision + 1,
    };
    this.viewRev++;
    this.dirty = true;
    this.deps.listing.refresh();
    this.notifyReplaced();
  }

  private notifyReplaced(): void {
    for (const listener of [...this.replacedListeners]) listener();
  }

  /**
   * The end of a load: the phase leaves 'loading' and what waited in the queue is delivered. While
   * the recovery from an engine failure is under way, only the recovery itself ends the phase.
   */
  private finishLoading(to: SimPhase = 'idle', endOfRecovery = false): void {
    if (this.disposed || (this.recovering && !endOfRecovery)) return;
    if (this.phaseNow === 'loading') {
      this.setPhase(to);
      this.updateFreeze();
    }
    if (this.queue.length > 0 || this.phaseNow !== 'idle') this.requestTick();
    this.publish();
  }

  private async readOrNull(path: VPath): Promise<Uint8Array | null> {
    try {
      return await this.deps.vfs.readFile(path);
    } catch {
      return null; // the engine reports "error: cannot open file ..."
    }
  }

  /** The listing: the file in the same folder with the program's name and `.L68`, in any letter case. */
  private async readListing(path: VPath): Promise<Uint8Array | null> {
    try {
      const found = await this.deps.vfs.resolve(dirname(path), changeFileExt(basename(path), '.L68'));
      return found === null ? null : await this.deps.vfs.readFile(found);
    } catch {
      return null;
    }
  }

  /** Awaits a step of a host part; a failure is reported and the load goes on. */
  private async attempt(what: string, step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.deps.ui.report(`Could not ${what}`, error);
    }
  }

  private setProgram(program: ProgramInfo | null): void {
    this.programNow = program;
    this.dirty = true;
  }

  /* ================================================================== commands (4.8) */

  run(): void {
    this.runCommand(() => {
      this.call((engine) => engine.cmdRun());
      this.deps.ui.resumeAudio();
      this.setPhase('running');
      this.tick(false);
    });
  }

  runToCursor(row: number): void {
    if (!this.runCommandsAvailable()) return;
    // The port checks the row itself: the engine, like the original, would show its box and then
    // run the program anyway (note 23).
    if (row < FIRST_PROGRAM_ROW || !this.deps.listing.isInstruction(row)) {
      this.raise(ERROR_TITLE, row < 0 ? INVALID_RUN_TO_CURSOR : NO_VALID_ADDRESS);
      this.publish();
      return;
    }
    this.runCommand(() => {
      this.call((engine) => engine.cmdRunToCursor(row));
      this.deps.ui.resumeAudio();
      this.setPhase('running');
      this.tick(false);
    });
  }

  stepOver(): void {
    this.runCommand(() => {
      this.call((engine) => engine.cmdStepOver());
      this.deps.ui.resumeAudio();
      this.setPhase('running');
      this.tick(false);
    });
  }

  traceInto(): void {
    this.runCommand(() => {
      const status = this.call((engine) => engine.cmdTraceInto());
      this.deps.ui.resumeAudio();
      this.handleStatus(status);
    });
  }

  autoTrace(): void {
    this.runCommand(() => {
      this.call((engine) => engine.cmdAutoTrace());
      this.deps.ui.resumeAudio();
    });
  }

  pause(): void {
    if (this.phaseNow === 'loading') return;
    this.guard(() => {
      this.call((engine) => engine.cmdPause());
      // During Auto Trace the engine, like the original, leaves the commands busy (sim-ui Q9).
      this.deps.bridge.forceMenuActive();
      this.stop();
    });
    this.publish();
  }

  rewind(): void {
    if (this.phaseNow === 'loading') return;
    this.guard(() => {
      this.call((engine) => engine.rewind());
      this.stop();
    });
    this.publish();
  }

  dismissAlerts(): void {
    if (this.alertList.length === 0) return;
    const engineHadBox = this.alertList.some((alert) => alert.fromEngine);
    this.alertList = [];
    this.updateAlertsView();
    this.guard(() => {
      if (engineHadBox && this.live && this.phaseNow !== 'loading') this.call((engine) => engine.dismissAlert());
      this.updateFreeze();
      this.resumeIfReady();
    });
    this.publish();
  }

  editBox(box: Box, text: string): void {
    if (this.phaseNow === 'loading') return;
    this.guard(() => void this.call((engine) => engine.editBox(box, text)));
    this.publish();
  }

  pokeMemory(address: number, value: number): void {
    if (this.phaseNow === 'loading') return;
    this.guard(() => {
      this.call((engine) => engine.writeBytes(address, [value & 0xff]));
      // The engine reports nothing for a direct write: the panels that show memory re-read it.
      this.viewRev++;
      this.liveRev++;
      this.dirty = true;
    });
    this.publish();
  }

  clearCycles(): void {
    if (this.phaseNow === 'loading') return;
    this.guard(() => {
      this.call((engine) => engine.clearCycles());
      this.refreshSnapshot();
    });
    this.publish();
  }

  /** Run, Run To Cursor, Auto Trace, Step Over, Trace Into: available while the commands are active. */
  private runCommandsAvailable(): boolean {
    return this.phaseNow !== 'loading' && this.deps.bridge.state.menuState === 0 && !this.disposed;
  }

  /**
   * A run command. From the idle state the program's files are brought up to date first if the
   * window has had the focus elsewhere (3.8.4); the phase is 'loading' meanwhile.
   */
  private runCommand(action: () => void): void {
    if (!this.runCommandsAvailable()) return;
    const go = () => {
      this.guard(action);
      this.publish();
    };
    if (!this.filesStale || this.phaseNow !== 'idle') {
      go();
      return;
    }
    this.setPhase('loading');
    this.publish();
    void this.attempt('revalidate the program folder', () => this.deps.files.revalidateIfStale()).then(() => {
      this.filesStale = false;
      if (this.disposed || this.phaseNow !== 'loading') return;
      this.setPhase('idle');
      go();
      this.finishLoading();
    });
  }

  /* ================================================================== queue, invoke, hold (4.3, 4.4.5) */

  post(entry: InputEvent68k | ControllerRequest): void {
    if (this.disposed) return;
    const last = this.queue[this.queue.length - 1];
    if (entry.kind === 'mouseMove' && last?.kind === 'mouseMove') {
      this.queue[this.queue.length - 1] = entry; // consecutive moves are merged into the last one
    } else {
      this.queue.push(entry);
    }
    this.requestTick();
  }

  invoke(fn: (engine: SimEngine) => void): void {
    if (this.disposed) return;
    if (this.inEngine || this.phaseNow === 'loading') {
      this.post({ kind: 'call', fn });
      return;
    }
    this.guard(() => {
      this.call(fn);
      this.wakeIfRunMode();
    });
    this.publish();
  }

  hold(): () => void {
    this.holds++;
    this.updateFreeze();
    this.dirty = true;
    this.publish();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      this.dirty = true;
      this.guard(() => {
        this.updateFreeze();
        if (this.holds === 0) this.resumeIfReady();
      });
      this.publish();
    };
  }

  /** Nothing keeps the program from executing: no hold, no open message box. */
  private canRun(): boolean {
    return this.holds === 0 && this.alertList.length === 0;
  }

  /**
   * A hold or a message box began or ended. A task 23 delay stands still meanwhile, as the
   * original's delay loop does inside the dialog's message loop (4.4.2): when the program may run
   * again, the start of the delay is moved forward by the time it could not.
   */
  private updateFreeze(): void {
    const now = this.deps.clock.now();
    if (!this.canRun()) {
      this.frozenAt ??= now;
    } else if (this.frozenAt !== null) {
      if (this.phaseNow === 'waitDelay') this.delayStart += now - this.frozenAt;
      this.frozenAt = null;
    }
  }

  /**
   * The last hold was released or the boxes were closed. A wait that a queue entry completed
   * meanwhile, or that the closed box was, is continued with one engine call (4.4.4, 4.4.5).
   */
  private resumeIfReady(): void {
    if (!this.canRun() || this.phaseNow === 'loading') return;
    if (this.phaseNow === 'waitAlert' || this.phaseNow === 'waitInput' || this.phaseNow === 'waitHost') {
      this.runBurst();
    }
    if (this.phaseNow !== 'idle' || this.queue.length > 0) this.requestTick();
  }

  private requestTick(): void {
    if (this.cancelTickTimer || this.disposed) return;
    this.cancelTickTimer = this.deps.scheduler.setTimer(0, () => {
      this.cancelTickTimer = null;
      this.tick(false);
    });
  }

  /* ================================================================== ticks (4.2) */

  private tick(isFrame: boolean): void {
    if (this.disposed) return;
    if (!this.ticking) {
      this.ticking = true;
      try {
        this.guard(() => {
          const now = this.deps.clock.now();
          if (isFrame) this.governor.frame(now);
          if (this.phaseNow === 'loading') return; // 4.7: nothing touches the engine during a load
          this.deliverQueue();
          this.deps.timers.check(now);
          if (this.canRun()) {
            if (this.phaseNow === 'waitDelay') this.serviceDelay(now);
            if (this.phaseNow === 'running') this.runSlice(now);
          }
        });
      } finally {
        this.ticking = false;
      }
    }
    if (isFrame) {
      if (this.livePending) {
        this.livePending = false;
        this.liveRev++;
        this.dirty = true;
      }
      this.publish();
    }
  }

  private runSlice(now: number): void {
    const { clock } = this.deps;
    const speed = this.deps.speed();
    const governor = this.governor;
    governor.refill(now, speed);
    const budget = governor.budget();
    const start = clock.now();
    try {
      while (this.phaseNow === 'running' && this.canRun() && governor.allowance >= 1 && clock.now() - start < budget) {
        const status = this.runEngine(governor.next(speed));
        governor.spend(this.executed);
        this.handleStatus(status); // leaves the phase 'running' only for RunStatus.Running
        this.deliverQueue();
        this.deps.timers.check(clock.now());
      }
    } finally {
      governor.used(clock.now() - start);
    }
  }

  /** `engine.run(n)`, with the instructions it executed in `this.executed`. */
  private runEngine(maxInstructions: number): RunStatus {
    const status = this.call((engine) => {
      const before = engine.stepCount;
      const result = engine.run(maxInstructions);
      this.executed = stepsBetween(before, engine.stepCount);
      return result;
    }, true);
    if (this.executed > 0) this.edgeDelivered = false; // the next input edge may follow
    return status;
  }

  /**
   * The `handleStatus(engine.run(subslice))` of 4.3 and 4.4: one engine call that continues a wait
   * which has just been completed. What it executes counts against the allowance.
   */
  private runBurst(): void {
    this.setPhase('running');
    const status = this.runEngine(subslice(instructionsPerSecond(this.deps.speed())));
    this.governor.spend(this.executed);
    this.handleStatus(status);
  }

  private handleStatus(status: RunStatus): void {
    switch (status) {
      case RunStatus.Running:
        this.setPhase('running');
        break;
      case RunStatus.Stopped:
      case RunStatus.Error: // "Unexpected error in runLoop": the engine has put it in the message area
        this.stop();
        break;
      case RunStatus.WaitInput:
        this.setPhase('waitInput');
        break;
      case RunStatus.WaitDelay:
        this.waitDelay();
        break;
      case RunStatus.WaitHost:
        this.setPhase('waitHost');
        break;
      case RunStatus.WaitAlert:
        this.setPhase('waitAlert');
        break;
      case RunStatus.Busy: // the command did nothing: a step is suspended
        break;
    }
  }

  /**
   * Execution has stopped. The phase is 'idle' unless the engine still has a modal window open - a
   * task 58 dialog or a message box keeps the step suspended, as in the original - in which case
   * the reply or the dismissal finishes the step.
   */
  private stop(): void {
    const flags = this.live ? this.peek((engine) => engine.state()) : null;
    if (flags?.fileDialogOpen) this.setPhase('waitHost');
    else if (flags?.alertOpen && this.alertList.some((alert) => alert.fromEngine)) this.setPhase('waitAlert');
    else this.setPhase('idle');
    try {
      this.deps.lifecycle.stopped();
    } catch (error) {
      this.deps.ui.report('Writing files after the program stopped failed', error);
    }
  }

  private setPhase(next: SimPhase): void {
    const previous = this.phaseNow;
    if (previous === next) return;
    if (previous === 'waitDelay') {
      this.cancelDelayTimer?.();
      this.cancelDelayTimer = null;
    }
    this.phaseNow = next;
    // Entering 'running': the first instructions execute at once. Leaving it: no allowance is kept.
    if (next === 'running') this.governor.enter(this.deps.clock.now(), this.deps.speed());
    else if (previous === 'running') this.governor.leave();
    this.dirty = true;
  }

  /* ================================================================== task 23 (4.4.2) */

  /** `run()` returned WaitDelay: a new delay, or the one already being waited for. */
  private waitDelay(): void {
    const step = this.peek((engine) => engine.stepCount);
    if (this.phaseNow === 'waitDelay' && step === this.delayStep) return;
    const now = this.deps.clock.now();
    this.delayStart = now;
    this.delayReported = 0;
    this.delayStep = step;
    this.setPhase('waitDelay');
    this.armDelayTimer(
      now,
      this.peek((engine) => engine.delayRemaining),
    );
  }

  private serviceDelay(now: number): void {
    let remaining = this.peek((engine) => engine.delayRemaining);
    const due = Math.floor((now - this.delayStart) / DELAY_UNIT_MS) - this.delayReported;
    const periods = Math.min(due, remaining);
    if (periods > 0) {
      this.call((engine) => engine.delayElapsed(periods));
      this.delayReported += periods;
      remaining = this.peek((engine) => engine.delayRemaining);
    }
    if (this.phaseNow !== 'waitDelay') return;
    if (remaining === 0)
      this.setPhase('running'); // the TRAP finishes in the next run()
    else this.armDelayTimer(now, remaining);
  }

  /** The timer ends when the last period does, so that the program continues in that same tick. */
  private armDelayTimer(now: number, remaining: number): void {
    this.cancelDelayTimer?.();
    const end = this.delayStart + (this.delayReported + remaining) * DELAY_UNIT_MS;
    const delay = Math.min(Math.max(end - now, 0), DELAY_TIMER_MAX_MS);
    this.cancelDelayTimer = this.deps.scheduler.setTimer(delay, () => {
      this.cancelDelayTimer = null;
      this.tick(false);
    });
  }

  /* ================================================================== the queue (4.3) */

  /**
   * Delivers the queue in order. While the program is executing, an input edge is delivered only
   * when a sub-slice has run since the last one, so that a key press and its release, or two
   * clicks, are always separated by executed instructions as they are in the original, which looks
   * at its message queue after every instruction. In every other state all of it is delivered at
   * once, as the original's own pump would.
   */
  private deliverQueue(): void {
    while (this.queue.length > 0 && this.phaseNow !== 'loading') {
      const entry = this.queue[0] as QueueEntry;
      const edge = INPUT_EDGES.has(entry.kind);
      if (edge && this.edgeDelivered && this.executing()) return; // it follows a sub-slice later
      this.queue.shift();
      this.apply(entry);
      this.wakeIfRunMode();
      if (edge) this.edgeDelivered = this.executing();
    }
  }

  /** The program is executing instructions: running, with no hold and no open box in the way. */
  private executing(): boolean {
    return this.phaseNow === 'running' && this.canRun();
  }

  /**
   * Wake-up (hardware §3.1 items 4 and 7): a request made while the simulator is idle starts
   * execution, without the effects of the Run command.
   */
  private wakeIfRunMode(): void {
    if (this.phaseNow !== 'idle' || !this.live) return;
    if (this.peek((engine) => engine.state().runMode)) {
      this.setPhase('running');
      this.requestTick();
    }
  }

  private apply(entry: QueueEntry): void {
    switch (entry.kind) {
      case 'keyDown': {
        // One key press as Windows delivers it, with no instruction in between: the key, its
        // character, and the pasted text if the engine says key commands are enabled.
        const waiting = this.phaseNow === 'waitInput';
        let typed = false;
        this.call((engine) => {
          const enabled = engine.keyDown(entry.vk);
          if (entry.ch !== undefined) {
            engine.keyChar(entry.ch);
            typed = true;
          }
          if (entry.paste && enabled) {
            for (const byte of entry.paste) engine.keyChar(byte);
            typed ||= entry.paste.length > 0;
          }
        });
        if (waiting && typed) this.continueInput();
        break;
      }
      case 'keyUp':
        this.call((engine) => engine.keyUp(entry.vk));
        break;
      case 'char': {
        const waiting = this.phaseNow === 'waitInput';
        this.call((engine) => engine.keyChar(entry.ch));
        if (waiting) this.continueInput();
        break;
      }
      case 'ioActivated':
        this.call((engine) => engine.ioActivated());
        break;
      case 'mouseDown':
        this.call((engine) => engine.mouseDown(entry.x, entry.y, entry.shift));
        break;
      case 'mouseUp':
        this.call((engine) => engine.mouseUp(entry.x, entry.y, entry.shift));
        break;
      case 'mouseMove':
        this.call((engine) => engine.mouseMove(entry.x, entry.y, entry.shift));
        break;
      case 'pushButton':
        this.call((engine) => engine.pushButton(entry.bit, entry.down));
        break;
      case 'switchClick':
        this.call((engine) => engine.switchClick(entry.bit));
        break;
      case 'irq':
        this.call((engine) => engine.irq(entry.level));
        break;
      case 'hwReset':
        this.call((engine) => engine.hardwareReset());
        break;
      case 'timerTick':
        this.call((engine) => engine.timerTick(entry.level));
        break;
      case 'autoTraceTick':
        this.handleStatus(this.call((engine) => engine.autoTraceTick()));
        break;
      case 'fileDialogReply': {
        const waiting = this.phaseNow === 'waitHost';
        this.call((engine) => engine.fileDialogReply(entry.accepted, entry.path ?? ''));
        // After Run the program continues; after Trace Into the same call finishes the step.
        if (waiting && this.canRun()) this.runBurst();
        break;
      }
      case 'call':
        this.call(entry.fn);
        break;
    }
  }

  /** A character reached a pending keyboard read: one `run()` continues the program or waits on. */
  private continueInput(): void {
    if (this.phaseNow === 'waitInput' && this.canRun()) this.runBurst();
  }

  /* ================================================================== engine calls (4.3, 4.6, 4.8) */

  /**
   * Every call that changes the engine goes through here: it marks the engine busy (so that
   * `invoke` queues), turns a throw into the failure recovery of 4.8, and runs afterEngineCall().
   */
  private call<T>(fn: (engine: SimEngine) => T, quiet = false): T {
    if (this.inEngine) throw new Error('RunController: the engine was called from inside an engine call (3.3.2)');
    this.inEngine = true;
    let result: T;
    try {
      result = fn(this.current);
    } catch (error) {
      this.inEngine = false;
      this.fail(error);
      throw ENGINE_FAILED;
    }
    this.inEngine = false;
    this.pristine = false;
    // A command, a queue entry or interface code may have changed what the interface shows without
    // a host call saying so (logging, breakpoints). A slice of a free run changes nothing of that
    // kind unless a host call reports it ("quiet").
    if (!quiet) this.dirty = true;
    this.afterEngineCall();
    return result;
  }

  /** Reads from the engine; a throw is an engine failure like any other. */
  private peek<T>(fn: (engine: SimEngine) => T): T {
    try {
      return fn(this.current);
    } catch (error) {
      this.fail(error);
      throw ENGINE_FAILED;
    }
  }

  /** Runs an entry point of the controller; the unwinding after an engine failure ends here. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      if (error !== ENGINE_FAILED) throw error;
    }
  }

  /**
   * After every engine call (4.3, 4.6): if `host.registersShown()` ran, the snapshot is refreshed;
   * if `host.repaint()` ran, the panels re-read; if `host.alert()` ran, the box is shown; effects
   * outside the simulator that host calls asked for happen now.
   */
  private afterEngineCall(): void {
    const { bridge } = this.deps;
    if (bridge.takeRegistersShown()) this.refreshSnapshot();
    if (bridge.takeRepaint() !== 0) {
      this.viewRev++;
      this.dirty = true;
    }
    if (bridge.takeLive()) this.livePending = true;
    const boxes = bridge.takeAlerts();
    if (boxes.length > 0) {
      for (const box of boxes) this.alertList.push({ box, fromEngine: true });
      this.updateAlertsView();
      this.updateFreeze();
    }
    if (bridge.takeChanged()) this.dirty = true;
    try {
      bridge.flushEffects();
    } catch (error) {
      this.deps.ui.report('An effect of a simulator call failed', error);
    }
  }

  /** Copies what the register display shows out of the engine (4.6). */
  private refreshSnapshot(): void {
    const engine = this.current;
    try {
      const boxes: string[] = [];
      for (let box = 0; box < 20; box++) boxes.push(engine.boxText(box as Box));
      const pc = Number.parseInt(boxes[Box.PC] ?? '', 16);
      this.lastOpcode = Number.isNaN(pc) ? 0xffff : engine.readWord(pc);
      this.snapshotNow = {
        boxes,
        cycles: engine.cycles,
        highlight: engine.listingHighlight,
        halted: engine.state().halt,
        revision: this.snapshotNow.revision + 1,
      };
    } catch (error) {
      this.fail(error);
      throw ENGINE_FAILED;
    }
    this.dirty = true;
  }

  /** A message box of the controller's own (not the engine's). */
  private raise(title: string, text: string): void {
    this.alertList.push({ box: { title, text }, fromEngine: false });
    this.updateAlertsView();
    this.updateFreeze();
  }

  private updateAlertsView(): void {
    this.alertsView = this.alertList.map((alert) => alert.box);
    this.dirty = true;
  }

  /**
   * Engine failure (4.8): the original's box for its own internal faults, with the PC and the
   * instruction word of the last snapshot, then a cold start. A new engine next to host parts in
   * their old state would be inconsistent, so nothing is kept.
   */
  private fail(error: unknown): void {
    this.inEngine = false;
    this.deps.ui.report('The simulator engine failed', error);
    if (this.recovering || this.disposed) return;
    this.recovering = true;
    this.raise(ERROR_TITLE, engineFaultText(this.snapshotNow.boxes[Box.PC] ?? '00000000', this.lastOpcode));
    this.setPhase('loading');
    this.pristine = false;
    this.publish();
    void this.coldStartSteps()
      .then((restarted) => {
        if (restarted) this.deps.bridge.addMessage(RESTART_NOTICE);
        this.dirty = true;
      })
      .catch((failure: unknown) => this.deps.ui.report('The simulator could not be restarted', failure))
      .finally(() => {
        this.finishLoading('idle', true);
        this.recovering = false;
      });
  }

  /* ================================================================== publishing (4.6) */

  /** Tells the subscribers, once, that something they show may have changed. */
  private publish(): void {
    if (this.deps.bridge.takeChanged()) this.dirty = true;
    if (!this.dirty || this.disposed) return;
    this.dirty = false;
    for (const listener of [...this.listeners]) listener();
  }
}
