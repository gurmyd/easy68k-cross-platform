// A stand-in for the simulator engine while no real instance exists.
//
// The session needs an engine object from its first moment, but the real engine is created
// asynchronously (the WebAssembly module is fetched and compiled), and during a cold start the old
// instance is released before the new one exists (4.7.1). In those gaps `session.engine` is this
// object: every read answers with the values of a simulator that has just started (sim-ui §4.1,
// hardware §8), every command does nothing, and nothing ever executes. Panels can therefore draw
// themselves at any time without asking whether the engine is there yet.
//
// Owner: SH8.

import { Box, RunStatus, type HardwareControls, type SimEngine, type SimStateFlags } from '../../contracts';

const MEMORY_SIZE = 0x01000000;

const START_FLAGS: SimStateFlags = {
  runMode: false,
  trace: false,
  sstep: false,
  halt: false,
  inputMode: false,
  hardwareEnabled: true,
  autoIRQ: true,
  stopInstruction: false,
  logging: false,
  autoTraceTimer: false,
  menuState: 0,
  phase: 0,
  irq: 0,
  alertOpen: false,
  pendingKey: 0,
  keyCommandsDisabled: false,
  startPC: 0,
  errflg: false,
  stepToAddr: 0,
  runToAddr: 0,
  autoTraceInProgress: false,
  fileDialogOpen: false,
};

/** The twenty register boxes right after start (sim-ui §4.1). */
export function startupBoxes(): string[] {
  const boxes = new Array<string>(20).fill('00000000');
  boxes[Box.A7] = '01000000';
  boxes[Box.US] = '00FF0000';
  boxes[Box.SS] = '01000000';
  boxes[Box.SR] = '0010000000000000';
  return boxes;
}

function startupHardware(): HardwareControls {
  return {
    seg7: 0xe00000,
    led: 0xe00010,
    switches: 0xe00012,
    pushButtons: 0xe00014,
    map: [0, 1, 2, 3].map(() => ({ enabled: false, start: 0, end: 0 })),
    auto: [null, ...[1, 2, 3, 4, 5, 6, 7].map(() => ({ checked: false, timerEnabled: false, intervalMs: 1000 }))],
    switchOn: new Array<boolean>(8).fill(false),
    visible: false,
    selectedAutoIrq: 1,
    intervalBox: 1000,
  };
}

/** An engine that holds no program and executes nothing; reads give the start-up values. */
export function createStartupEngine(): SimEngine {
  let memory: Uint8Array | null = null;
  const boxes = startupBoxes();
  const nothing = (): void => {};
  return {
    // 16 MiB of $FF, as after start-up; allocated only if something really looks at memory.
    get memory() {
      memory ??= new Uint8Array(MEMORY_SIZE).fill(0xff);
      return memory;
    },
    readByte: () => 0xff,
    readWord: () => 0xffff,
    readLong: () => 0xffffffff,
    writeBytes: nothing,
    load: nothing,
    loadData: () => false,
    close: nothing,
    rewind: nothing,
    cmdRun: nothing,
    cmdRunToCursor: nothing,
    cmdRunToAddress: nothing,
    cmdStepOver: nothing,
    cmdTraceInto: () => RunStatus.Stopped,
    cmdPause: nothing,
    cmdAutoTrace: nothing,
    autoTraceTick: () => RunStatus.Stopped,
    run: () => RunStatus.Stopped,
    stepCount: 0,
    dismissAlert: nothing,
    delayRemaining: 0,
    delayElapsed: nothing,
    fileDialogReply: nothing,
    keyChar: nothing,
    keyDown: () => true,
    keyUp: nothing,
    ioActivated: nothing,
    mouseDown: nothing,
    mouseUp: nothing,
    mouseMove: nothing,
    getRegister: () => 0,
    setRegister: nothing,
    registers: () => ({
      d: new Array<number>(8).fill(0),
      a: new Array<number>(7).fill(0),
      usp: 0xff0000,
      ssp: 0x1000000,
      a7: 0x1000000,
      pc: 0,
      sr: 0x2000,
      cycles: 0n,
    }),
    boxText: (box) => boxes[box] ?? '',
    editBox: () => false,
    cycles: 0n,
    cyclesText: '0',
    clearCycles: nothing,
    state: () => ({ ...START_FLAGS }),
    setOption: nothing,
    getOption: () => 0,
    logDialogOpened: nothing,
    startLog: nothing,
    stopLog: nothing,
    irq: () => false,
    hardwareReset: () => false,
    timerTick: () => false,
    switchClick: nothing,
    pushButton: nothing,
    setDeviceAddress: nothing,
    setMemoryMap: nothing,
    setAutoIrq: nothing,
    selectAutoIrq: nothing,
    setAutoInterval: nothing,
    setHardwareVisible: nothing,
    hardware: startupHardware,
    setBreakpoint: () => false,
    clearBreakpoint: nothing,
    clearAllBreakpoints: nothing,
    breakpoints: () => [],
    setBreakCondition: nothing,
    setBreakExpression: () => false,
    setBreakCounts: nothing,
    listingLineCount: 0,
    listingLine: () => new Uint8Array(0),
    listingHighlight: -1,
  };
}
