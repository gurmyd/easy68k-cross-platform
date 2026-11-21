// Test doubles for the hardware model's neighbours. For unit tests and the panel's browser check
// only; nothing in the application imports this file.
//
// The real software timers, the virtual clock and the run controller belong to SH8 (core/run/) and
// are written at the same time as this package. Until they are joined, the hardware tests use these
// small stand-ins, written from the interfaces of contracts/devices.ts and contracts/run.ts and the
// rules of ARCHITECTURE.md 4.3 and 4.5.3 - nothing more:
//
//   TestClock          time that moves only by advance()
//   createTestTimers   SoftTimerApi objects with the rules of 4.5.3, checked by checkAll(now)
//   MiniController     the queue of 4.3 (one input edge per sub-slice while running) and a run loop
//
// Owner: SH7.

import {
  RunStatus,
  type Clock,
  type ControllerRequest,
  type InputEvent68k,
  type SimEngine,
  type SoftTimerApi,
} from '../../../contracts';

/** A clock that stands still until advance() moves it. */
export class TestClock implements Clock {
  private time = 0;
  now(): number {
    return this.time;
  }
  wallTime(): Date {
    return new Date(2026, 0, 1, 12, 0, 0, this.time);
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

/**
 * A software timer with the rules of 4.5.3: an interval of 0 never fires; 1 to 9 ms behave as 10 ms;
 * a late timer fires once, with no catch-up burst, and then schedules now + interval; enabling starts
 * a fresh period (first tick one interval later); setting the interval while enabled restarts the
 * period.
 */
export class TestSoftTimer implements SoftTimerApi {
  private interval = 1000;
  private on = false;
  private due = 0;

  constructor(
    private readonly clock: Clock,
    private readonly onTick: () => void,
  ) {}

  get intervalMs(): number {
    return this.interval;
  }
  set intervalMs(value: number) {
    this.interval = value;
    if (this.on) this.due = this.clock.now() + effective(value);
  }
  get enabled(): boolean {
    return this.on;
  }
  set enabled(value: boolean) {
    if (value && !this.on) this.due = this.clock.now() + effective(this.interval);
    this.on = value;
  }
  check(now: number): void {
    if (!this.on || this.interval <= 0 || now < this.due) return;
    this.due = now + effective(this.interval);
    this.onTick();
  }
}

function effective(interval: number): number {
  return interval > 0 && interval < 10 ? 10 : interval;
}

export interface TestTimers {
  /** HardwareDeps.timers. */
  create(onTick: () => void): SoftTimerApi;
  /** Every timer created so far, in order of creation. */
  readonly all: TestSoftTimer[];
  /** What the controller does once per frame: check every timer. */
  checkAll(now: number): void;
}

export function createTestTimers(clock: Clock): TestTimers {
  const all: TestSoftTimer[] = [];
  return {
    create(onTick) {
      const timer = new TestSoftTimer(clock, onTick);
      all.push(timer);
      return timer;
    },
    all,
    checkAll(now) {
      for (const timer of all) timer.check(now);
    },
  };
}

type Entry = ControllerRequest | InputEvent68k;

const INPUT_EDGES = new Set<string>(['keyDown', 'keyUp', 'char', 'mouseDown', 'mouseUp', 'pushButton', 'switchClick']);

/** Whether a queue entry is an input edge of 4.3 (at most one per sub-slice while running). */
export function isInputEdge(entry: Entry): boolean {
  return INPUT_EDGES.has(entry.kind);
}

/**
 * The part of the run controller (4.3) the hardware tests need: one FIFO, delivered between
 * instructions with at most one input edge per sub-slice while the program runs; the wake-up rule
 * (idle + run mode -> running); Run and Pause. Wait states are served the simple way: input waits
 * end the run, delays are skipped, alerts are dismissed.
 */
export class MiniController {
  phase: 'idle' | 'running' = 'idle';
  readonly queue: Entry[] = [];
  /** Every entry posted, in order (what the model sent). */
  readonly posted: Entry[] = [];
  /** Instructions executed since the controller was made. */
  instructions = 0;

  constructor(
    private readonly engineOf: () => SimEngine,
    readonly subslice = 100,
  ) {}

  get engine(): SimEngine {
    return this.engineOf();
  }

  /** HardwareDeps.post and RunController.post. */
  readonly post = (entry: Entry): void => {
    this.posted.push(entry);
    this.queue.push(entry);
  };

  run(): void {
    this.engine.cmdRun();
    this.phase = 'running';
  }

  pause(): void {
    this.engine.cmdPause();
    this.phase = 'idle';
  }

  /** deliverQueue() of 4.3. */
  deliver(): void {
    while (this.queue.length > 0) {
      const entry = this.queue.shift() as Entry;
      this.apply(entry);
      if (this.phase === 'idle' && this.engine.state().runMode) this.phase = 'running';
      if (this.phase === 'running' && isInputEdge(entry)) break;
    }
  }

  /** One tick: deliver, then execute up to `budget` instructions in sub-slices, delivering between them. */
  tick(budget: number): void {
    let left = budget;
    this.deliver();
    while (this.phase === 'running' && left > 0) {
      const slice = Math.min(this.subslice, left);
      const before = this.engine.stepCount;
      const status = this.engine.run(slice);
      const done = (this.engine.stepCount - before) >>> 0;
      this.instructions += done;
      left -= Math.max(done, 1);
      this.handle(status);
      this.deliver();
    }
  }

  /** Delivers everything and, if the program runs, executes until it stops (at most `limit`). */
  settle(limit = 1_000_000): void {
    this.deliver();
    let left = limit;
    while ((this.phase === 'running' || this.queue.length > 0) && left > 0) {
      this.tick(Math.min(10_000, left));
      left -= 10_000;
    }
  }

  private handle(status: RunStatus): void {
    switch (status) {
      case RunStatus.Running:
        return;
      case RunStatus.WaitDelay:
        this.engine.delayElapsed(this.engine.delayRemaining);
        return;
      case RunStatus.WaitAlert:
        this.engine.dismissAlert();
        return;
      case RunStatus.WaitHost:
        this.engine.fileDialogReply(false, '');
        return;
      default:
        this.phase = 'idle';
    }
  }

  private apply(entry: Entry): void {
    const engine = this.engine;
    switch (entry.kind) {
      case 'irq':
        engine.irq(entry.level);
        break;
      case 'hwReset':
        engine.hardwareReset();
        break;
      case 'timerTick':
        engine.timerTick(entry.level);
        break;
      case 'pushButton':
        engine.pushButton(entry.bit, entry.down);
        break;
      case 'switchClick':
        engine.switchClick(entry.bit);
        break;
      case 'call':
        entry.fn(engine);
        break;
      case 'autoTraceTick':
        engine.autoTraceTick();
        break;
      case 'fileDialogReply':
        engine.fileDialogReply(entry.accepted, entry.path ?? '');
        break;
      default:
        // Keyboard and mouse entries are not used by the hardware tests.
        break;
    }
  }
}
