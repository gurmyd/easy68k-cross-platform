// The simulator engine behind the contract types (ARCHITECTURE.md 3.2, 3.3; docs/ENGINE-BINDING.md).
//
// engine/sim/sim68k.mjs is plain JavaScript. This file loads it (loader.ts), gives the instance the
// type `SimEngine`, and is the one place that absorbs a difference between the module and the
// contract. Today there is one:
//
// - `releaseSimEngine`: the module has no call for it. The binding drops its reference to the
//   instance, and with it the last reference to the instance's 64 MiB of memory.
//
// Owner: W4.

import {
  type Box,
  type BreakCondition,
  type BreakExpression,
  type Bytes,
  type HardwareControls,
  type HostFiles,
  type HostHardware,
  type HostIoGraphics,
  type HostIoText,
  type HostLog,
  type HostMain,
  type HostNet,
  type HostPrinter,
  type HostSerial,
  type HostSound,
  type HwDevice,
  type LoadKind,
  type MapKind,
  type MapRow,
  type Reg,
  type Registers,
  type RunStatus,
  type SimEngine,
  type SimHost,
  type SimOption,
  type SimStateFlags,
} from '../contracts';
import { loadEngine, type ModuleFactory } from './loader';

/** The value a host method returns when it has nothing to say: what the engine uses for a host without that method. */
type Defaults<Part> = { readonly [K in keyof Part]: Part[K] extends (...args: never[]) => infer R ? R : never };

/**
 * The ten parts of the host (3.3) with every method and its default result: the mirror of
 * `HOST_DEFAULTS` in engine/sim/sim68k.mjs, grouped as the contract groups the methods. The types
 * make a missing or an extra name a compile error, and a test compares the whole with the module.
 */
export const HOST_PART_DEFAULTS: {
  readonly main: Defaults<HostMain>;
  readonly hardware: Defaults<HostHardware>;
  readonly log: Defaults<HostLog>;
  readonly files: Defaults<HostFiles>;
  readonly text: Defaults<HostIoText>;
  readonly graphics: Defaults<HostIoGraphics>;
  readonly sound: Defaults<HostSound>;
  readonly serial: Defaults<HostSerial>;
  readonly net: Defaults<HostNet>;
  readonly printer: Defaults<HostPrinter>;
} = {
  main: {
    message: undefined,
    messagesClear: undefined,
    alert: undefined,
    registersShown: undefined,
    menuState: undefined,
    focusMain: undefined,
    autoTraceTimer: undefined,
    keyCommands: undefined,
    optionChanged: undefined,
    saveSettings: undefined,
    caption: undefined,
    repaint: undefined,
    memoryLivePaint: undefined,
    fontAssign: undefined,
    timeCentiseconds: 0,
  },
  hardware: {
    hardwareUpdate: undefined,
    hardwareState: undefined,
    hardwareTimer: undefined,
    hardwareShow: undefined,
    hardwareControls: undefined,
  },
  log: {
    logWrite: undefined,
    logState: undefined,
    outputLogWrite: undefined,
  },
  files: {
    fileOpen: 0,
    fileRead: null,
    fileWrite: -1,
    fileSeek: -1,
    fileClose: false,
    fileRemove: false,
    fileDialog: undefined,
  },
  text: {
    charOut: undefined,
    textOut: undefined,
    textOutCR: undefined,
    clear: undefined,
    getrc: undefined,
    gotorc: undefined,
    setFontProperties: undefined,
    getCharAt: undefined,
    scrollRect: undefined,
    setWindowSize: undefined,
    getWindowSize: undefined,
    setupWindow: undefined,
    ioShow: undefined,
    ioBringToFront: undefined,
    inputPrompt: undefined,
    erasePrompt: undefined,
    inputEcho: undefined,
    inputBackspace: undefined,
    doCRLF: undefined,
    invalidate: undefined,
  },
  graphics: {
    setLineColor: undefined,
    setFillColor: undefined,
    drawPixel: undefined,
    getPixel: 0,
    line: undefined,
    lineTo: undefined,
    moveTo: undefined,
    rectangle: undefined,
    ellipse: undefined,
    floodFill: undefined,
    unfilledRectangle: undefined,
    unfilledEllipse: undefined,
    setDrawingMode: undefined,
    setPenWidth: undefined,
    formPaint: undefined,
    drawText: undefined,
    getXY: undefined,
  },
  sound: {
    resetSounds: undefined,
    playSound: undefined,
    loadSound: undefined,
    playSoundMem: undefined,
    controlSound: undefined,
    playSoundDX: undefined,
    loadSoundDX: undefined,
    playSoundMemDX: undefined,
    controlSoundDX: undefined,
  },
  serial: {
    initComm: undefined,
    setCommParams: undefined,
    commRead: -3,
    sendComm: undefined,
  },
  net: {
    createNetClient: undefined,
    createNetServer: undefined,
    sendNet: undefined,
    receiveNet: undefined,
    sendPortNet: undefined,
    receivePortNet: undefined,
    closeNetConnection: undefined,
    getLocalIP: undefined,
    netCloseSockets: 0,
  },
  printer: {
    printerBeginDoc: undefined,
    printerEndDoc: undefined,
    printerMetric: 0,
    printerTextOut: undefined,
  },
};

/** Every method of `SimHost` with its default result (the parts above in one object). */
export const HOST_DEFAULTS: Defaults<SimHost> = {
  ...HOST_PART_DEFAULTS.main,
  ...HOST_PART_DEFAULTS.hardware,
  ...HOST_PART_DEFAULTS.log,
  ...HOST_PART_DEFAULTS.files,
  ...HOST_PART_DEFAULTS.text,
  ...HOST_PART_DEFAULTS.graphics,
  ...HOST_PART_DEFAULTS.sound,
  ...HOST_PART_DEFAULTS.serial,
  ...HOST_PART_DEFAULTS.net,
  ...HOST_PART_DEFAULTS.printer,
};

/** The names of the 93 host methods. */
export const HOST_METHODS = Object.keys(HOST_DEFAULTS) as (keyof SimHost)[];

/** The exports of engine/sim/sim68k.mjs that the binding uses. */
interface SimModule {
  /** Resolves to a `Sim68k`, which has the members of `SimEngine` (the mirror tests keep that true). */
  createSim(host: Partial<SimHost>, options: { createModule: ModuleFactory }): Promise<SimEngine>;
}

const RELEASED = 'This simulator engine was released with releaseSimEngine(); create a new one with createSimEngine().';

/**
 * What the application holds as its `SimEngine`: every member forwards to the engine's own object,
 * until `releaseSimEngine` cuts the connection.
 */
class SimBinding implements SimEngine {
  #sim: SimEngine | null = null;

  /** Connects the binding to the engine's instance. */
  static attach(binding: SimBinding, sim: SimEngine): void {
    binding.#sim = sim;
  }

  /** Disconnects it; every later use throws. */
  static detach(binding: SimBinding): void {
    binding.#sim = null;
  }

  get #engine(): SimEngine {
    if (!this.#sim) throw new Error(RELEASED);
    return this.#sim;
  }

  /* memory */
  get memory(): Uint8Array {
    return this.#engine.memory;
  }
  readByte(address: number): number {
    return this.#engine.readByte(address);
  }
  readWord(address: number): number {
    return this.#engine.readWord(address);
  }
  readLong(address: number): number {
    return this.#engine.readLong(address);
  }
  writeBytes(address: number, bytes: ArrayLike<number>): void {
    this.#engine.writeBytes(address, bytes);
  }

  /* loading */
  load(s68: Bytes | null, l68?: Bytes | null, options?: { name?: string | Bytes; kind?: LoadKind }): void {
    this.#engine.load(s68, l68, options);
  }
  loadData(s68: Bytes | null, name?: string | Bytes): boolean {
    return this.#engine.loadData(s68, name);
  }
  close(): void {
    this.#engine.close();
  }
  rewind(): void {
    this.#engine.rewind();
  }

  /* run control */
  cmdRun(): void {
    this.#engine.cmdRun();
  }
  cmdRunToCursor(listingLine: number): void {
    this.#engine.cmdRunToCursor(listingLine);
  }
  cmdRunToAddress(address: number): void {
    this.#engine.cmdRunToAddress(address);
  }
  cmdStepOver(): void {
    this.#engine.cmdStepOver();
  }
  cmdTraceInto(): RunStatus {
    return this.#engine.cmdTraceInto();
  }
  cmdPause(): void {
    this.#engine.cmdPause();
  }
  cmdAutoTrace(): void {
    this.#engine.cmdAutoTrace();
  }
  autoTraceTick(): RunStatus {
    return this.#engine.autoTraceTick();
  }
  run(maxInstructions?: number): RunStatus {
    return this.#engine.run(maxInstructions);
  }
  get stepCount(): number {
    return this.#engine.stepCount;
  }

  /* ending a wait state */
  dismissAlert(): void {
    this.#engine.dismissAlert();
  }
  get delayRemaining(): number {
    return this.#engine.delayRemaining;
  }
  delayElapsed(periods: number): void {
    this.#engine.delayElapsed(periods);
  }
  fileDialogReply(accepted: boolean, fileName?: Bytes | string): void {
    this.#engine.fileDialogReply(accepted, fileName);
  }

  /* keyboard and mouse of the I/O window */
  keyChar(ch: number): void {
    this.#engine.keyChar(ch);
  }
  keyDown(virtualKey: number): boolean {
    return this.#engine.keyDown(virtualKey);
  }
  keyUp(virtualKey: number): void {
    this.#engine.keyUp(virtualKey);
  }
  ioActivated(): void {
    this.#engine.ioActivated();
  }
  mouseDown(x: number, y: number, shift: number): void {
    this.#engine.mouseDown(x, y, shift);
  }
  mouseUp(x: number, y: number, shift: number): void {
    this.#engine.mouseUp(x, y, shift);
  }
  mouseMove(x: number, y: number, shift: number): void {
    this.#engine.mouseMove(x, y, shift);
  }

  /* CPU state and the register boxes */
  getRegister(reg: Reg): number {
    return this.#engine.getRegister(reg);
  }
  setRegister(reg: Reg, value: number): void {
    this.#engine.setRegister(reg, value);
  }
  registers(): Registers {
    return this.#engine.registers();
  }
  boxText(box: Box): string {
    return this.#engine.boxText(box);
  }
  editBox(box: Box, text: string): boolean {
    return this.#engine.editBox(box, text);
  }
  get cycles(): bigint {
    return this.#engine.cycles;
  }
  get cyclesText(): string {
    return this.#engine.cyclesText;
  }
  clearCycles(): void {
    this.#engine.clearCycles();
  }
  state(): SimStateFlags {
    return this.#engine.state();
  }

  /* options and logging */
  setOption(option: SimOption, value: number | boolean): void {
    this.#engine.setOption(option, value);
  }
  getOption(option: SimOption): number {
    return this.#engine.getOption(option);
  }
  logDialogOpened(): void {
    this.#engine.logDialogOpened();
  }
  startLog(timeString: string | Bytes): void {
    this.#engine.startLog(timeString);
  }
  stopLog(): void {
    this.#engine.stopLog();
  }

  /* hardware form */
  irq(level: number): boolean {
    return this.#engine.irq(level);
  }
  hardwareReset(): boolean {
    return this.#engine.hardwareReset();
  }
  timerTick(level: number): boolean {
    return this.#engine.timerTick(level);
  }
  switchClick(n: number): void {
    this.#engine.switchClick(n);
  }
  pushButton(n: number, down: boolean): void {
    this.#engine.pushButton(n, down);
  }
  setDeviceAddress(device: HwDevice, address: number, options?: { commit?: boolean }): void {
    this.#engine.setDeviceAddress(device, address, options);
  }
  setMemoryMap(kind: MapKind, row: Partial<MapRow>): void {
    this.#engine.setMemoryMap(kind, row);
  }
  setAutoIrq(level: number, checked: boolean): void {
    this.#engine.setAutoIrq(level, checked);
  }
  selectAutoIrq(level: number): void {
    this.#engine.selectAutoIrq(level);
  }
  setAutoInterval(ms: number): void {
    this.#engine.setAutoInterval(ms);
  }
  setHardwareVisible(visible: boolean): void {
    this.#engine.setHardwareVisible(visible);
  }
  hardware(): HardwareControls {
    return this.#engine.hardware();
  }

  /* breakpoints */
  setBreakpoint(address: number): boolean {
    return this.#engine.setBreakpoint(address);
  }
  clearBreakpoint(address: number): void {
    this.#engine.clearBreakpoint(address);
  }
  clearAllBreakpoints(): void {
    this.#engine.clearAllBreakpoints();
  }
  breakpoints(): number[] {
    return this.#engine.breakpoints();
  }
  setBreakCondition(index: number, condition: BreakCondition): void {
    this.#engine.setBreakCondition(index, condition);
  }
  setBreakExpression(index: number, expression: BreakExpression): boolean {
    return this.#engine.setBreakExpression(index, expression);
  }
  setBreakCounts(counts: { registers?: number; addresses?: number; expressions: number }): void {
    this.#engine.setBreakCounts(counts);
  }

  /* listing pane */
  get listingLineCount(): number {
    return this.#engine.listingLineCount;
  }
  listingLine(index: number): Bytes {
    return this.#engine.listingLine(index);
  }
  get listingHighlight(): number {
    return this.#engine.listingHighlight;
  }
}

/** The names of the members of the binding: the keys of `SimEngine` (for the mirror test). */
export const SIM_ENGINE_MEMBERS: string[] = Object.getOwnPropertyNames(SimBinding.prototype).filter(
  (name) => name !== 'constructor',
);

/** What `releaseSimEngine` does for each object it knows: the bindings and their wrappers. */
const releasers = new WeakMap<object, () => void>();

/**
 * The host as the engine gets it: every method of `host`, bound to it. The engine passes every
 * argument of the contract itself, `createNetClient`'s 68000 address of the server string
 * (`A2 & $FFFFFF`, CODE9.CPP:1266) included.
 */
function bindHost(host: SimHost): Partial<SimHost> {
  const bound: Record<string, unknown> = {};
  const methods = host as unknown as Record<string, unknown>;
  for (const name of HOST_METHODS) {
    const method = methods[name];
    // A method the host lacks is left out: the engine then answers with its default.
    if (typeof method === 'function') bound[name] = (method as (...args: unknown[]) => unknown).bind(host);
  }
  return bound as Partial<SimHost>;
}

/**
 * A new simulator in the state of the original program right after start-up. May be called any
 * number of times; every call gives an independent WebAssembly instance of the once-compiled module.
 * The host receives calls already while this function runs (3.3.2).
 */
export async function createSimEngine(host: SimHost): Promise<SimEngine> {
  const engine = await loadEngine('sim');
  const { createSim } = engine.api as unknown as SimModule;
  const binding = new SimBinding();
  const sim = await createSim(bindHost(host), { createModule: engine.createModule });
  SimBinding.attach(binding, sim);
  releasers.set(binding, () => SimBinding.detach(binding));
  return binding;
}

/**
 * Drops every reference the binding holds to this instance so that its 64 MiB of memory can be
 * collected. The engine must not be used afterwards: every member then throws. Releasing twice, or
 * releasing an object that did not come from `createSimEngine`, does nothing.
 */
export function releaseSimEngine(engine: SimEngine): void {
  releasers.get(engine)?.();
}

/**
 * Makes `releaseSimEngine(wrapper)` release `engine`. For objects that stand in front of an engine,
 * such as the fault injector of testing.ts.
 */
export function releaseThrough(wrapper: SimEngine, engine: SimEngine): void {
  releasers.set(wrapper, () => releaseSimEngine(engine));
}
