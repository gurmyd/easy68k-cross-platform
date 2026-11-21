// SimUiBridge: the `main` part of the simulator host (ARCHITECTURE.md 3.3.1, 4.6).
//
// In the original these calls go to the main window (TForm1): add a line to the message area, show
// a message box, refresh the registers, enable or disable commands. Here they must return at once
// and must not touch the engine (3.3.2) - several of them arrive before the engine object even
// exists - so the bridge only RECORDS what happened:
//
//   - plain state the interface mirrors into the store (`state`): the message lines, the command
//     state, the caption, whether Auto Trace and key commands are on;
//   - flags the run controller takes after the engine call has returned (`takeRegistersShown`,
//     `takeRepaint`, `takeLive`, `takeAlerts`): the controller then reads the engine and refreshes
//     its snapshot (4.6);
//   - effects outside the simulator (the settings, the keyboard focus), which are kept back until
//     the controller calls `flushEffects()` after the engine call.
//
// Two things act at once, because later host calls of the same engine call depend on them:
// `fontAssign` (the text screen takes its font back during a simulator reset) and the auto-trace
// timer.
//
// Owner: SH8.

import {
  FontTarget,
  type Bytes,
  type Clock,
  type ControllerRequest,
  type PendingAlert,
  type SimUiBridgeApi,
  type SoftTimerApi,
} from '../../contracts';
import { decode } from '../codec/cp1252';

/** `host.optionChanged(option, value)`: which option the engine changed. */
export type ChangedOption = 'exceptions' | 'bitField';

export interface UiBridgeDeps {
  clock: Clock;
  /** Makes the auto-trace timer (4.5.3); the controller checks it with its other timers. */
  timers: { create(onTick: () => void): SoftTimerApi };
  /** The run-controller queue (4.3), for the auto-trace tick. */
  post: (request: ControllerRequest) => void;
  /** `SimSettings.autoTraceIntervalMs`, read each time the engine switches the timer on. */
  autoTraceIntervalMs: () => number;
  /** The engine changed the exceptions or the bit-field option: write it to the settings (sim-ui Q14). */
  optionChanged: (option: ChangedOption, value: boolean) => void;
  /** TRAP #15 task 32/5: the original writes its settings file. */
  saveSettings: () => void;
  /** Give the main window (the Listing panel) the keyboard focus (2.10). */
  focusMain: () => void;
  /** Font targets 1 and 2: the text screen goes back to the Options font (`TextScreen.fontAssign`). */
  textFontAssign: (target: number, source: number) => void;
  /** Font target 6: the printer font was assigned (`PrinterDevice.fontChanged`). */
  printerFontChanged: () => void;
}

/** What the bridge knows about the main window; the interface mirrors it into the store. */
export interface UiBridgeState {
  /** The simulator message area, one decoded line per entry. Replaced, never changed in place. */
  messageLines: readonly string[];
  /** 0 active, 1 busy (sim-ui §3.6). */
  menuState: 0 | 1;
  /** The engine has the auto-trace timer switched on. */
  autoTrace: boolean;
  /** false after TRAP #15 task 24 with D1 = 1. */
  keyCommands: boolean;
  /** The name of the loaded program as the engine gave it, or null before any load. */
  caption: string | null;
}

export class SimUiBridge implements SimUiBridgeApi {
  private readonly autoTrace: SoftTimerApi;
  private lines: string[] = [];
  private linesCopy: readonly string[] | null = [];
  private menu: 0 | 1 = 0;
  private autoTraceOn = false;
  private keyCommandsOn = true;
  private captionText: string | null = null;

  private registersShownFlag = false;
  private repaintBits = 0;
  private liveFlag = false;
  private alerts: PendingAlert[] = [];
  private effects: (() => void)[] = [];
  private changed = false;

  constructor(private readonly deps: UiBridgeDeps) {
    this.autoTrace = deps.timers.create(() => deps.post({ kind: 'autoTraceTick' }));
    this.autoTrace.enabled = false;
  }

  /** The recorded state. `messageLines` stays the same array until a line is added or the area is cleared. */
  get state(): UiBridgeState {
    this.linesCopy ??= this.lines.slice();
    return {
      messageLines: this.linesCopy,
      menuState: this.menu,
      autoTrace: this.autoTraceOn,
      keyCommands: this.keyCommandsOn,
      caption: this.captionText,
    };
  }

  /* ---------------------------------------------------------------- for the run controller */

  /** True once if `registersShown()` ran since the last call. */
  takeRegistersShown(): boolean {
    const shown = this.registersShownFlag;
    this.registersShownFlag = false;
    return shown;
  }

  /** The RepaintBit combination reported since the last call (0 = none). */
  takeRepaint(): number {
    const bits = this.repaintBits;
    this.repaintBits = 0;
    return bits;
  }

  /** True once if `memoryLivePaint()` ran since the last call. */
  takeLive(): boolean {
    const live = this.liveFlag;
    this.liveFlag = false;
    return live;
  }

  /** The message boxes the engine opened since the last call, oldest first. */
  takeAlerts(): PendingAlert[] {
    const alerts = this.alerts;
    this.alerts = [];
    return alerts;
  }

  /** True once if the state changed since the last call. */
  takeChanged(): boolean {
    const changed = this.changed;
    this.changed = false;
    return changed;
  }

  /** Runs the effects the host calls asked for (settings, focus). Called after the engine call. */
  flushEffects(): void {
    while (this.effects.length > 0) {
      const effects = this.effects;
      this.effects = [];
      for (const effect of effects) effect();
    }
  }

  /** Pause forces the command state to active (note 24): the engine leaves it busy during Auto Trace. */
  forceMenuActive(): void {
    this.setMenu(0);
  }

  /**
   * The auto-trace interval of the settings changed (the Auto Trace Options dialog was confirmed):
   * the timer takes it at once, as the original's does; a running timer starts a fresh period.
   */
  autoTraceIntervalChanged(): void {
    this.autoTrace.intervalMs = this.deps.autoTraceIntervalMs();
  }

  /** A line for the message area that does not come from the engine (the restart notice of 4.8). */
  addMessage(text: string): void {
    this.lines.push(text);
    this.linesCopy = null;
    this.changed = true;
  }

  /**
   * The state of the original program right after start (3.3.2): message area empty, commands
   * active, no caption, Auto Trace off, key commands on; nothing pending.
   */
  resetToStartup(): void {
    this.lines = [];
    this.linesCopy = null;
    this.menu = 0;
    this.autoTraceOn = false;
    this.autoTrace.enabled = false;
    this.keyCommandsOn = true;
    this.captionText = null;
    this.registersShownFlag = false;
    this.repaintBits = 0;
    this.liveFlag = false;
    this.alerts = [];
    this.effects = [];
    this.changed = true;
  }

  /* ---------------------------------------------------------------- HostMain */

  message(text: Bytes): void {
    this.addMessage(decode(text));
  }

  messagesClear(): void {
    this.lines = [];
    this.linesCopy = null;
    this.changed = true;
  }

  alert(title: Bytes, text: Bytes): void {
    this.alerts.push({ title: decode(title), text: decode(text) });
  }

  registersShown(): void {
    this.registersShownFlag = true;
  }

  menuState(state: number): void {
    this.setMenu(state === 0 ? 0 : 1);
  }

  focusMain(): void {
    this.effects.push(this.deps.focusMain);
  }

  autoTraceTimer(enabled: boolean): void {
    if (enabled) this.autoTrace.intervalMs = this.deps.autoTraceIntervalMs();
    this.autoTrace.enabled = enabled;
    if (this.autoTraceOn !== enabled) {
      this.autoTraceOn = enabled;
      this.changed = true;
    }
  }

  keyCommands(enabled: boolean): void {
    if (this.keyCommandsOn !== enabled) {
      this.keyCommandsOn = enabled;
      this.changed = true;
    }
  }

  optionChanged(option: number, value: number): void {
    const changed: ChangedOption | null = option === 0 ? 'exceptions' : option === 1 ? 'bitField' : null;
    if (changed) this.effects.push(() => this.deps.optionChanged(changed, value !== 0));
  }

  saveSettings(): void {
    this.effects.push(this.deps.saveSettings);
  }

  caption(text: Bytes): void {
    this.captionText = decode(text);
    this.changed = true;
  }

  repaint(what: number): void {
    this.repaintBits |= what;
  }

  memoryLivePaint(_address: number): void {
    this.liveFlag = true;
  }

  fontAssign(target: number, source: number): void {
    if (target === FontTarget.IoBackBuffer || target === FontTarget.IoWindow) {
      this.deps.textFontAssign(target, source);
    } else if (target === FontTarget.Printer) {
      this.deps.printerFontChanged();
    }
    // Targets 3 to 5 (listing, headings, messages) are CSS, driven by SimSettings.listingFont.
  }

  /** Task 8: hundredths of a second since midnight, local time (4.5.2). */
  timeCentiseconds(): number {
    const time = this.deps.clock.wallTime();
    return (
      time.getHours() * 360000 +
      time.getMinutes() * 6000 +
      time.getSeconds() * 100 +
      Math.floor(time.getMilliseconds() / 10)
    );
  }

  private setMenu(state: 0 | 1): void {
    if (this.menu !== state) {
      this.menu = state;
      this.changed = true;
    }
  }
}
