// The hardware model (ARCHITECTURE.md 3.3.3): the thin layer between the engine's hardware form and
// the Hardware panel.
//
// The engine holds the original form's controls and logic (switch pictures, auto-interrupt check
// boxes and their arming rule, the interval box, the memory-map boxes; engine/sim/shim/hardware.cpp).
// This class adds what the engine cannot do itself:
//
//   - it remembers what `hardwareState` reported (IRQ and Reset buttons enabled, the label
//     `Automatic Enabled` / `Automatic Disabled`);
//   - it runs the seven auto-interrupt timers the engine asks for through `hardwareTimer`; a tick of
//     timer n posts { kind: 'timerTick', level: n } (4.5.3);
//   - it builds the view the panel draws (`view(engine)`): the engine's controls, the eight displayed
//     7-segment bytes, the LED byte and the address-conflict colours of hardware §2.6;
//   - it forwards the panel's actions to the run controller's queue (`actions`), so that every one of
//     them reaches the engine between two instructions (4.3, hardware §7).
//
// Rules this class keeps (3.3.2): no host method calls the engine; reading `engine.memory` happens
// only in `view()`, which interface code calls outside engine calls. The engine's own writes to
// memory (`writeBytes`, the Memory panel's pokes, a load) cause no host call, so the panel re-reads
// the view on every display frame as well as when this model notifies (features/hardware).
//
// Owner: W1 > SH7.

import {
  HwDevice,
  MapKind,
  type ControllerRequest,
  type HardwareActions,
  type HardwareControls,
  type HardwareDeps,
  type HardwareModelApi,
  type HardwareView,
  type MapRow,
  type SimEngine,
  type SoftTimerApi,
} from '../../../contracts';

export type { HardwareActions, HardwareDeps, HardwareView } from '../../../contracts';

/** Size of the simulator's memory (`MEMSIZE`, def.h:56). */
export const MEMSIZE = 0x1000000;

/** The levels of the seven auto-interrupt timers. */
export const IRQ_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const;

export type AddressConflict = HardwareView['addressConflict'];

/** No field red: the state at start-up and whenever addresses are set by the program (2.6). */
export const NO_CONFLICT: Readonly<AddressConflict> = Object.freeze({ seg7: false, led: false, sw: false, pb: false });

/**
 * The colours of the four device address fields after a key release in any address field
 * (`addrKeyUp`, hardwareu.cpp:676-712; hardware §2.6). true = red. Comparisons with MEMSIZE are
 * unsigned in the original (hardware §9.1 item 10), so a negative value counts as very large.
 */
export function addressConflicts(
  addresses: Pick<HardwareControls, 'seg7' | 'led' | 'switches' | 'pushButtons'>,
): AddressConflict {
  const seg7 = addresses.seg7 >>> 0;
  const led = addresses.led >>> 0;
  const sw = addresses.switches >>> 0;
  const pb = addresses.pushButtons >>> 0;
  const inSeg7 = (address: number) => address >= seg7 && address <= seg7 + 15;
  return {
    seg7: seg7 >= MEMSIZE - 8 || inSeg7(led) || inSeg7(sw) || inSeg7(pb),
    led: led >= MEMSIZE || inSeg7(led) || led === sw || led === pb,
    sw: sw >= MEMSIZE || inSeg7(sw) || sw === led || sw === pb,
    pb: pb >= MEMSIZE || inSeg7(pb) || pb === led || pb === sw,
  };
}

/**
 * The bytes the display shows, read from memory as `THardware::update()` does (hardware §2.2, §2.3):
 * digit i (0 = leftmost) shows memory[seg7 + 2i], only while seg7 < MEMSIZE - 8; otherwise the digits
 * keep what they showed last (`previous`). The LED byte is read while led < MEMSIZE. The original
 * reads up to 6 bytes past its array for seg7 in $FFFFF2..$FFFFF7; those bytes read as 0 here.
 */
export function displayedBytes(
  memory: ArrayLike<number>,
  seg7: number,
  led: number,
  previous: { seg7Bytes: Uint8Array; ledByte: number },
): { seg7Bytes: Uint8Array; ledByte: number } {
  const seg7Bytes = new Uint8Array(previous.seg7Bytes);
  const seg7Address = seg7 >>> 0;
  if (seg7Address < MEMSIZE - 8) {
    for (let digit = 0; digit < 8; digit++) seg7Bytes[digit] = memory[seg7Address + 2 * digit] ?? 0;
  }
  const ledAddress = led >>> 0;
  const ledByte = ledAddress < MEMSIZE ? (memory[ledAddress] ?? 0) : previous.ledByte;
  return { seg7Bytes, ledByte };
}

const isLevel = (level: number) => Number.isInteger(level) && level >= 1 && level <= 7;
const isBit = (bit: number) => Number.isInteger(bit) && bit >= 0 && bit <= 7;

export class HardwareModel implements HardwareModelApi {
  readonly actions: HardwareActions;

  /** Index = level 1..7; index 0 is unused. */
  private readonly timers: (SoftTimerApi | null)[];
  private readonly listeners = new Set<() => void>();
  /** What `hardwareState` reported last; null = never called (the form's design-time caption). */
  private reported: { hardwareEnabled: boolean; autoIRQ: boolean } | null = null;
  private conflict: AddressConflict = { ...NO_CONFLICT };
  /** All segments and LEDs are drawn lit before the first refresh (hardware §2.2: DFM colours). */
  private shown: { seg7Bytes: Uint8Array; ledByte: number } = {
    seg7Bytes: new Uint8Array(8).fill(0xff),
    ledByte: 0xff,
  };

  constructor(private readonly deps: HardwareDeps) {
    this.timers = [
      null,
      ...IRQ_LEVELS.map((level) => deps.timers.create(() => this.post({ kind: 'timerTick', level }))),
    ];
    this.actions = this.createActions();
  }

  view(engine: SimEngine): HardwareView {
    const controls = engine.hardware();
    this.shown = displayedBytes(engine.memory, controls.seg7, controls.led, this.shown);
    const reported = this.reported;
    return {
      controls,
      seg7Bytes: new Uint8Array(this.shown.seg7Bytes),
      ledByte: this.shown.ledByte,
      buttonsEnabled: reported?.hardwareEnabled ?? true,
      autoLabel: reported === null ? 'Automatic' : reported.autoIRQ ? 'Automatic Enabled' : 'Automatic Disabled',
      addressConflict: { ...this.conflict },
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start-up state (3.3.2): all seven timers off; the view is rebuilt from the new engine. */
  resetToStartup(): void {
    for (const timer of this.timers) if (timer) timer.enabled = false;
    this.reported = null;
    this.conflict = { ...NO_CONFLICT };
    this.shown = { seg7Bytes: new Uint8Array(8).fill(0xff), ledByte: 0xff };
    this.notify();
  }

  /* ---------------------------------------------------------------- HostHardware */

  /** `Hardware->update()` while the form is visible: the panel re-reads the view. */
  hardwareUpdate(): void {
    this.notify();
  }

  /** `enable()`, `disable()`, `autoIRQon()`, `autoIRQoff()`. */
  hardwareState(hardwareEnabled: boolean, autoIRQ: boolean): void {
    this.reported = { hardwareEnabled, autoIRQ };
    this.notify();
  }

  /**
   * Timer `level` was enabled, disabled or got a new interval. The engine reports only real
   * changes (TTimer.SetEnabled / SetInterval do nothing for an unchanged value); the same guard here
   * keeps a repeated report from restarting a running period. The interval is set before the timer
   * is enabled, so that enabling starts a fresh period of the new length (4.5.3).
   */
  hardwareTimer(level: number, enabled: boolean, intervalMs: number): void {
    const timer = isLevel(level) ? this.timers[level] : null;
    if (!timer) return;
    if (timer.intervalMs !== intervalMs) timer.intervalMs = intervalMs;
    if (timer.enabled !== enabled) timer.enabled = enabled;
    this.notify();
  }

  /** TRAP #15 task 32/0. The engine has already marked its form visible (and zeroed the switch byte
   *  if it was hidden); the panel is shown, and `setHardwareVisible(true)` follows through the queue
   *  so that the engine and the panel agree whatever happened in between. */
  hardwareShow(): void {
    this.deps.showPanel();
    this.actions.setVisible(true);
  }

  /** The engine changed a control (S0 memory-map record, auto check box, interval, switch pictures). */
  hardwareControls(): void {
    this.notify();
  }

  /* ---------------------------------------------------------------- internals */

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private post(request: ControllerRequest): void {
    this.deps.post(request);
  }

  /** An engine call through the queue, followed by a notification. */
  private call(fn: (engine: SimEngine) => void): void {
    this.post({
      kind: 'call',
      fn: (engine) => {
        fn(engine);
        this.notify();
      },
    });
  }

  private createActions(): HardwareActions {
    return {
      clickSwitch: (bit) => {
        if (isBit(bit)) this.post({ kind: 'switchClick', bit });
      },
      pressButton: (bit) => {
        if (isBit(bit)) this.post({ kind: 'pushButton', bit, down: true });
      },
      releaseButton: (bit) => {
        if (isBit(bit)) this.post({ kind: 'pushButton', bit, down: false });
      },
      requestIrq: (level) => {
        if (isLevel(level)) this.post({ kind: 'irq', level });
      },
      reset: () => this.post({ kind: 'hwReset' }),
      setAutoChecked: (level, on) => {
        if (isLevel(level)) this.call((engine) => engine.setAutoIrq(level, on));
      },
      // 1..7, or 8 for the combo box's empty eighth entry (hardware §3.6).
      selectLevel: (level) => {
        if (Number.isInteger(level) && level >= 1 && level <= 8) this.call((engine) => engine.selectAutoIrq(level));
      },
      setAutoInterval: (ms) => this.call((engine) => engine.setAutoInterval(Math.max(0, Math.trunc(ms)))),
      setAddress: (device, address, commit) =>
        this.call((engine) => {
          engine.setDeviceAddress(device, address & 0xffffff, commit ? { commit: true } : undefined);
          // The user typed in an address field: addrKeyUp recolours the four device fields.
          this.conflict = addressConflicts(engine.hardware());
        }),
      setMap: (kind, row) =>
        this.call((engine) => {
          const masked: Partial<MapRow> = { ...row };
          if (masked.start !== undefined) masked.start &= 0xffffff;
          if (masked.end !== undefined) masked.end &= 0xffffff;
          engine.setMemoryMap(kind, masked);
          // A key released in a memory-map field recolours the device fields too (hardware §2.6).
          if (row.start !== undefined || row.end !== undefined) this.conflict = addressConflicts(engine.hardware());
        }),
      setVisible: (visible) => this.call((engine) => engine.setHardwareVisible(visible)),
    };
  }
}

/** The device of each address field, top to bottom (hardware §5). */
export const DEVICE_ORDER: readonly HwDevice[] = [HwDevice.Seg7, HwDevice.Led, HwDevice.Switch, HwDevice.PushButton];
/** The memory-map rows, top to bottom (hardware §4.1). */
export const MAP_ORDER: readonly MapKind[] = [MapKind.Rom, MapKind.Read, MapKind.Protected, MapKind.Invalid];
