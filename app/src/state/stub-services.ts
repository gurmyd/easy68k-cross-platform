// Minimal working services for wave zero and for tests (ARCHITECTURE.md 3.12.3). Owner: W3.
//
// The shell runs before the packages that provide its services exist. Each of these stands in for
// one of them: it has the service's full interface and does as little as possible. The stub
// `index.ts` of the providing feature returns it from its factory, and the owning package replaces
// that factory with the real service; nothing else changes. Tests of the shell keep using these.
//
//   createStubDocumentService   one in-memory document made from the template (owner: E1)
//   createStubFileDialogs       file dialogs that answer Cancel (owner: FS1)
//   createSilentAudioBackend    an audio backend that plays nothing (owner: SH5)
//   createInertSimSession       a simulator session without an engine: nothing runs (owner: SH8)

import {
  Box,
  type AppContext,
  type AudioBackend,
  type DocumentService,
  type DocumentState,
  type FileDialogs,
  type GlyphProvider,
  type RunController,
  type RunSnapshot,
  type SimEngine,
  type SimHost,
  type SimSession,
  type SimStateFlags,
  type SoftTimerApi,
} from '../contracts';
import { ListingView } from '../core/listing/view';
import { SoundDevice } from '../core/sim-host/audio/sound-device';
import { ProgramFiles } from '../core/sim-host/files/program-files';
import { HardwareModel } from '../core/sim-host/hardware/model';
import { OutputKeyboard } from '../core/sim-host/input/keyboard';
import { LogService } from '../core/sim-host/log/log-service';
import { PrinterDevice } from '../core/sim-host/printer';
import { Surface } from '../core/sim-host/surface/surface';
import { TextScreen } from '../core/sim-host/text/text-screen';
import { MemorySyncFiles } from '../fs/sync/memory';

/* ------------------------------------------------------------------ documents */

/** One untitled source document holding the template; it cannot be saved, closed or replaced. */
export function createStubDocumentService(ctx: AppContext): DocumentService {
  const settings = ctx.settings.get().editor;
  let document: DocumentState = {
    id: 'stub-1',
    path: null,
    name: 'untitled1.x68',
    kind: 'source',
    hasName: false,
    tabType: settings.tabType,
    tabSize: settings.fixedTabSize,
    fontName: settings.fontName,
    fontSize: settings.fontSize,
    insertMode: true,
    modified: false,
    revision: 0,
  };
  ctx.store.setState((state) => ({ ...state, documents: { items: [document], activeId: document.id } }));
  return {
    list: () => [document],
    active: () => document,
    text: () => ctx.settings.get().editor.template,
    newSource: () => document,
    open: async () => null,
    save: async () => false,
    saveAs: async () => false,
    reload: async () => {},
    close: async () => false,
    closeAll: async () => true,
    activate: () => {},
    // The members added at gate I1 (contracts/documents.ts), so that they can become required.
    update: (id, patch) => {
      if (id !== document.id) return;
      document = { ...document, ...patch };
      const changed = document;
      ctx.store.setState((state) => ({
        ...state,
        documents: {
          ...state.documents,
          items: state.documents.items.map((item) => (item.id === changed.id ? changed : item)),
        },
      }));
    },
    selection: (id) => (id === document.id ? { selected: '', caret: 0 } : null),
  };
}

/* ------------------------------------------------------------------ file dialogs */

/** File dialogs that answer Cancel. */
export function createStubFileDialogs(): FileDialogs {
  return {
    open: async () => null,
    save: async () => null,
    registerProvider: () => () => {},
    chooseFolder: async () => null,
  };
}

/* ------------------------------------------------------------------ audio */

/** Accepts every sound and plays none. */
export function createSilentAudioBackend(): AudioBackend {
  let next = 1;
  return { load: () => next++, play: () => next++, stop: () => {}, release: () => {}, resume: () => {} };
}

/* ------------------------------------------------------------------ simulator session */

/**
 * An object whose every method does nothing and returns undefined. Used for the host of the inert
 * session: without an engine, nothing ever calls a host method.
 */
function doNothing<T extends object>(): T {
  return new Proxy({}, { get: (_target, key) => (typeof key === 'symbol' ? undefined : () => undefined) }) as T;
}

const START_FLAGS: SimStateFlags = {
  runMode: false,
  trace: false,
  sstep: false,
  halt: false,
  inputMode: false,
  hardwareEnabled: false,
  autoIRQ: false,
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

/** The register boxes of a simulator that has just started (sim-ui §4.1). */
function startBoxes(): string[] {
  const boxes = new Array<string>(20).fill('00000000');
  boxes[Box.A7] = '01000000';
  boxes[Box.US] = '00FF0000';
  boxes[Box.SS] = '01000000';
  boxes[Box.SR] = '0010000000000000';
  return boxes;
}

/** A SimEngine that holds no program and executes nothing. Reads give the start-up values. */
export function createInertEngine(): SimEngine {
  let memory: Uint8Array | null = null;
  const boxes = startBoxes();
  const none = () => {};
  return {
    // 16 MiB of $FF, as after start-up; created only if something actually looks at memory.
    get memory() {
      memory ??= new Uint8Array(0x1000000).fill(0xff);
      return memory;
    },
    readByte: () => 0xff,
    readWord: () => 0xffff,
    readLong: () => 0xffffffff,
    writeBytes: none,
    load: none,
    loadData: () => false,
    close: none,
    rewind: none,
    cmdRun: none,
    cmdRunToCursor: none,
    cmdRunToAddress: none,
    cmdStepOver: none,
    cmdTraceInto: () => 1,
    cmdPause: none,
    cmdAutoTrace: none,
    autoTraceTick: () => 1,
    run: () => 1,
    stepCount: 0,
    dismissAlert: none,
    delayRemaining: 0,
    delayElapsed: none,
    fileDialogReply: none,
    keyChar: none,
    keyDown: () => true,
    keyUp: none,
    ioActivated: none,
    mouseDown: none,
    mouseUp: none,
    mouseMove: none,
    getRegister: () => 0,
    setRegister: none,
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
    clearCycles: none,
    state: () => ({ ...START_FLAGS }),
    setOption: none,
    getOption: () => 0,
    logDialogOpened: none,
    startLog: none,
    stopLog: none,
    irq: () => false,
    hardwareReset: () => false,
    timerTick: () => false,
    switchClick: none,
    pushButton: none,
    setDeviceAddress: none,
    setMemoryMap: none,
    setAutoIrq: none,
    selectAutoIrq: none,
    setAutoInterval: none,
    setHardwareVisible: none,
    hardware: () => ({
      seg7: 0xe00000,
      led: 0xe00010,
      switches: 0xe00012,
      pushButtons: 0xe00014,
      map: [0, 1, 2, 3].map(() => ({ enabled: false, start: 0, end: 0 })),
      auto: [null, ...[1, 2, 3, 4, 5, 6, 7].map(() => ({ checked: false, timerEnabled: false, intervalMs: 1000 }))],
      switchOn: new Array<boolean>(8).fill(false),
      visible: false,
      selectedAutoIrq: 8,
      intervalBox: 1000,
    }),
    setBreakpoint: () => false,
    clearBreakpoint: none,
    clearAllBreakpoints: none,
    breakpoints: () => [],
    setBreakCondition: none,
    setBreakExpression: () => false,
    setBreakCounts: none,
    listingLineCount: 0,
    listingLine: () => new Uint8Array(0),
    listingHighlight: -1,
  };
}

/**
 * A RunController that never runs anything. `hold()` works, because the dialog service holds the
 * controller for modal dialogs of Simulator mode whether or not a program exists (4.4.5).
 */
export function createInertController(): RunController {
  const listeners = new Set<() => void>();
  const snapshot: RunSnapshot = { boxes: startBoxes(), cycles: 0n, highlight: -1, halted: false, revision: 0 };
  let holds = 0;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const none = () => {};
  const done = async () => {};
  return {
    phase: 'idle',
    get held() {
      return holds > 0;
    },
    program: null,
    snapshot,
    alerts: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: done,
    openData: done,
    reload: done,
    close: done,
    coldStart: done,
    run: none,
    runToCursor: none,
    stepOver: none,
    traceInto: none,
    autoTrace: none,
    pause: none,
    rewind: none,
    dismissAlerts: none,
    post: none,
    invoke: none,
    hold() {
      holds++;
      notify();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        notify();
      };
    },
    editBox: none,
    pokeMemory: none,
    clearCycles: none,
  };
}

const blankGlyphs: GlyphProvider = {
  ready: Promise.resolve(),
  metrics: () => ({ colWidth: 8, rowHeight: 16 }),
  glyph: () => ({ advance: 8, width: 8, height: 16, coverage: new Uint8Array(8 * 16) }),
};

/**
 * A simulator session without an engine: every part exists and can be read, nothing executes, and
 * no simulator command has a handler, so all of them are shown disabled.
 */
export function createInertSimSession(ctx: AppContext): SimSession {
  const engine = createInertEngine();
  const controller = createInertController();
  const surface = new Surface(640, 480);
  const softTimer = (): SoftTimerApi => ({ intervalMs: 1000, enabled: false, check: () => {} });
  const files = new MemorySyncFiles();
  const text = new TextScreen({
    surface,
    glyphs: blankGlyphs,
    scheduler: ctx.scheduler,
    outputLog: () => {},
    beep: () => {},
    show: () => {},
  });
  return {
    engine,
    host: doNothing<SimHost>(),
    controller,
    surface,
    text,
    keyboard: new OutputKeyboard({ post: () => {}, os: ctx.platform.os }),
    sound: new SoundDevice({
      backend: ctx.devices.audio,
      clock: ctx.clock,
      readProgramFile: () => null,
      message: () => {},
    }),
    hardware: new HardwareModel({ post: () => {}, timers: { create: softTimer }, showPanel: () => {} }),
    listing: new ListingView(() => engine),
    log: new LogService({
      vfs: ctx.vfs,
      clock: ctx.clock,
      scheduler: ctx.scheduler,
      invoke: () => {},
      askFileExists: async () => 'Cancel',
    }),
    files: new ProgramFiles({
      viewFor: () => files,
      message: () => {},
      showFileDialog: async () => null,
      post: () => {},
      journal: { write: () => {}, read: () => null },
    }),
    printer: new PrinterDevice({ font: () => ctx.settings.get().sim.printerFont, submit: () => {} }),
    glyphs: blankGlyphs,
    onEngineReplaced: () => () => {},
    // Members added at gate I1 (contracts/run.ts): nothing prints here.
    printJobs: [],
    onPrintJob: () => () => {},
  };
}
