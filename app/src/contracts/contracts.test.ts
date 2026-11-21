// The contracts carry exactly the declarations of ARCHITECTURE.md section 3 (W1 acceptance), and the
// engine mirror in engine.ts and host.ts matches the real engine modules.
//
// Three kinds of check:
// - Exported names: every contract file is read as text and its `export interface|type|const|class|
//   function` names are compared with the lists below (types do not exist at run time).
// - Member names: the objects below list every member of SimEngine, SimHost, AsmOptions and
//   AsmResult. `satisfies Record<keyof X, true>` makes `npm run typecheck` fail when a list and the
//   interface differ; the tests then compare the same lists with the engine modules.
// - Additions of gate I1 (docs/porting/errata/W1.md, entry 11): every member added after wave one
//   is listed at the end of this file. `npm run typecheck` fails when one of them stops being
//   optional (an object written against the wave-one contracts must still satisfy them), and the
//   tests read the contract files to see that each one is there.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AppContext,
  AppState,
  AsmOptions,
  AsmResult,
  CommandRegistry,
  DialogService,
  DocumentService,
  FileDialogs,
  FileSourceProvider,
  GlyphProvider,
  OutputDeviceDeps,
  Platform,
  SaveRequest,
  SimEngine,
  SimHost,
  SimSession,
  Vfs,
} from '.';
import * as contracts from '.';
import { MemoryBackend } from '../fs/memory-backend';
import { createVfs } from '../fs/vfs';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const repo = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));

/** The names a contract file exports, read from its source. */
function exportedNames(file: string): string[] {
  const source = readFileSync(here(file), 'utf8');
  const names = new Set<string>();
  for (const match of source.matchAll(/^export (?:declare )?(?:interface|type|const|class|function) (\w+)/gm)) {
    names.add(match[1] as string);
  }
  return [...names].sort();
}

/** Exported names of each contract file: the declarations of section 3 plus W1's documented additions. */
const EXPORTS: Record<string, string[]> = {
  'engine.ts': [
    // 3.2
    'Bytes',
    'TabType',
    'AsmOptions',
    'AsmMessage',
    'AsmDialog',
    'AsmResult',
    'AsmEngine',
    'RunStatus',
    'Reg',
    'Box',
    'SimOption',
    'MapKind',
    'HwDevice',
    'ShiftBit',
    'RepaintBit',
    'FileMode',
    'FontTarget',
    'FontSource',
    'PrinterMetric',
    'SimStateFlags',
    'MapRow',
    'Registers',
    'HardwareControls',
    'BreakCondition',
    'BreakExpression',
    'LoadKind',
    'SimEngine',
  ],
  'host.ts': [
    // 3.3
    'HostMain',
    'HostHardware',
    'HostLog',
    'HostFiles',
    'HostIoText',
    'HostIoGraphics',
    'HostSound',
    'HostSerial',
    'HostNet',
    'HostPrinter',
    'SimHost',
    // 3.3.1 (moved from core/sim-host/index.ts, docs/requests/W4-contracts.md)
    'SimHostParts',
  ],
  'fs.ts': [
    // 3.8.1
    'VPath',
    'FileStat',
    'DirEntry',
    'BackendChange',
    'FileSystemBackend',
    'SnapshotLimits',
    'DirSnapshot',
    'VfsChange',
    'Vfs',
    'DEFAULT_SNAPSHOT_LIMITS',
    'SyncFiles',
    // 3.8.5
    'FileFilter',
    'OpenRequest',
    'SaveRequest',
    'FileSourceProvider',
    'FileDialogs',
    // W1 additions (errata W1.md)
    'FsErrorCode',
    'FsError',
    'CachedSyncFilesDeps',
    // gate I1 (errata W1.md, entry 11)
    'OverwritePrompt',
    'FolderRequest',
  ],
  'documents.ts': [
    // 3.9
    'DocKind',
    'DocumentState',
    'DocDefaults',
    'DocumentService',
    // gate I1 (errata W1.md, entry 11)
    'DocumentPatch',
    'DocumentSelection',
  ],
  'settings.ts': [
    // 3.10
    'SyntaxStyle',
    'SyntaxElement',
    'EditorSettings',
    'SimSettings',
    'AppSettings',
    'Settings',
    'SettingsService',
  ],
  'run.ts': [
    // 3.11.2
    'SimPhase',
    'LoadOrigin',
    'ProgramInfo',
    'RunSnapshot',
    'PendingAlert',
    'RunController',
    'ControllerRequest',
    'SimSession',
  ],
  'store.ts': ['Store', 'AppState', 'Mode', 'EditorMessage', 'AssembleSummary'], // 3.12.1
  'commands.ts': [
    // 3.12.2
    'CommandId',
    'CommandSpec',
    'CommandHandler',
    'CommandRegistry',
    // gate I1 (errata W1.md, entry 11)
    'CommandRunOptions',
    // gate I1 round 2 (errata W1.md, entry 12)
    'FilesRevealArg',
  ],
  'features.ts': [
    // 3.12.3
    'AppContext',
    'PanelSpec',
    'FeatureModule',
    // 3.12.3, moved from state/services.ts (docs/requests/W3-layer-rule.md, item 2)
    'SimEngineFactory',
    'SimSessionEnv',
    'ServiceFactories',
    // 3.12.4
    'DialogProps',
    'DialogInstance',
    'MessageBoxRequest',
    'DialogService',
    // stand-in for @codemirror/state (errata W1.md)
    'Extension',
    // gate I1 (errata W1.md, entry 11)
    'BuildFacts',
    'ToastOptions',
    'SimFileDialogProps',
    'SimFileDialogResult',
    'LogFileExistsProps',
    'LogFileExistsResult',
  ],
  'platform.ts': [
    // 3.13
    'StartupArgs',
    'NativeMenuItem',
    'Platform',
    // gate I1 (errata W1.md, entry 11)
    'NativeFileDialogs',
    'DroppedEntry',
    'DesktopDeviceSources',
  ],
  'devices.ts': [
    // 3.11.1, 4.5.3
    'Clock',
    'Scheduler',
    'RealClockApi',
    'FrameSchedulerApi',
    'VirtualTimeApi',
    'SoftTimerApi',
    'SimUiBridgeApi',
    // 3.4
    'PixelBuffer',
    'GraphicsState',
    'Rect',
    'OverlayCell',
    'SurfaceApi',
    // 3.5
    'FontSpec',
    'CellMetrics',
    'Glyph',
    'GlyphProvider',
    'TextState',
    'TextScreenDeps',
    'TextScreenApi',
    'OutputDeviceDeps',
    'OutputDeviceApi',
    // 3.6
    'KeyLike',
    'InputEvent68k',
    'KeyboardDeps',
    'OutputKeyboardApi',
    // 3.7
    'WavInfo',
    'SoundId',
    'AudioBackend',
    'SoundDeviceDeps',
    'SoundDeviceApi',
    // 3.3.3
    'HardwareView',
    'HardwareActions',
    'HardwareDeps',
    'HardwareModelApi',
    // 3.3.5
    'LogState',
    'LogDialogValues',
    'LogDeps',
    'LogServiceApi',
    // 3.8.4
    'ProgramFilesDeps',
    'ProgramFilesApi',
    'PrintedChar',
    'PrintJob',
    'PrinterDeps',
    'PrinterDeviceApi',
    // 3.11.4
    'ListingViewApi',
    // 3.3.4
    'SerialDeviceApi',
    'NetDeviceApi',
    'DesktopSerialApi',
    'DesktopNetApi',
    'DesktopDeviceBridge',
    'DesktopSerialDeps',
    'DesktopNetDeps',
    // gate I1 (errata W1.md, entry 11)
    'FontFileLoader',
  ],
};

/** Every member of SimEngine (3.2); the same list must be the methods and getters of Sim68k.prototype. */
const SIM_ENGINE_MEMBERS = {
  memory: true,
  readByte: true,
  readWord: true,
  readLong: true,
  writeBytes: true,
  load: true,
  loadData: true,
  close: true,
  rewind: true,
  cmdRun: true,
  cmdRunToCursor: true,
  cmdRunToAddress: true,
  cmdStepOver: true,
  cmdTraceInto: true,
  cmdPause: true,
  cmdAutoTrace: true,
  autoTraceTick: true,
  run: true,
  stepCount: true,
  dismissAlert: true,
  delayRemaining: true,
  delayElapsed: true,
  fileDialogReply: true,
  keyChar: true,
  keyDown: true,
  keyUp: true,
  ioActivated: true,
  mouseDown: true,
  mouseUp: true,
  mouseMove: true,
  getRegister: true,
  setRegister: true,
  registers: true,
  boxText: true,
  editBox: true,
  cycles: true,
  cyclesText: true,
  clearCycles: true,
  state: true,
  setOption: true,
  getOption: true,
  logDialogOpened: true,
  startLog: true,
  stopLog: true,
  irq: true,
  hardwareReset: true,
  timerTick: true,
  switchClick: true,
  pushButton: true,
  setDeviceAddress: true,
  setMemoryMap: true,
  setAutoIrq: true,
  selectAutoIrq: true,
  setAutoInterval: true,
  setHardwareVisible: true,
  hardware: true,
  setBreakpoint: true,
  clearBreakpoint: true,
  clearAllBreakpoints: true,
  breakpoints: true,
  setBreakCondition: true,
  setBreakExpression: true,
  setBreakCounts: true,
  listingLineCount: true,
  listingLine: true,
  listingHighlight: true,
} as const satisfies Record<keyof SimEngine, true>;

/** Every method of SimHost (3.3); the same list must be the keys of HOST_DEFAULTS. */
const SIM_HOST_METHODS = {
  // HostMain
  message: true,
  messagesClear: true,
  alert: true,
  registersShown: true,
  menuState: true,
  focusMain: true,
  autoTraceTimer: true,
  keyCommands: true,
  optionChanged: true,
  saveSettings: true,
  caption: true,
  repaint: true,
  memoryLivePaint: true,
  fontAssign: true,
  timeCentiseconds: true,
  // HostHardware
  hardwareUpdate: true,
  hardwareState: true,
  hardwareTimer: true,
  hardwareShow: true,
  hardwareControls: true,
  // HostLog
  logWrite: true,
  logState: true,
  outputLogWrite: true,
  // HostFiles
  fileOpen: true,
  fileRead: true,
  fileWrite: true,
  fileSeek: true,
  fileClose: true,
  fileRemove: true,
  fileDialog: true,
  // HostIoText
  charOut: true,
  textOut: true,
  textOutCR: true,
  clear: true,
  getrc: true,
  gotorc: true,
  setFontProperties: true,
  getCharAt: true,
  scrollRect: true,
  setWindowSize: true,
  getWindowSize: true,
  setupWindow: true,
  ioShow: true,
  ioBringToFront: true,
  inputPrompt: true,
  erasePrompt: true,
  inputEcho: true,
  inputBackspace: true,
  doCRLF: true,
  invalidate: true,
  // HostIoGraphics
  setLineColor: true,
  setFillColor: true,
  drawPixel: true,
  getPixel: true,
  line: true,
  lineTo: true,
  moveTo: true,
  rectangle: true,
  ellipse: true,
  floodFill: true,
  unfilledRectangle: true,
  unfilledEllipse: true,
  setDrawingMode: true,
  setPenWidth: true,
  formPaint: true,
  drawText: true,
  getXY: true,
  // HostSound
  resetSounds: true,
  playSound: true,
  loadSound: true,
  playSoundMem: true,
  controlSound: true,
  playSoundDX: true,
  loadSoundDX: true,
  playSoundMemDX: true,
  controlSoundDX: true,
  // HostSerial
  initComm: true,
  setCommParams: true,
  commRead: true,
  sendComm: true,
  // HostNet
  createNetClient: true,
  createNetServer: true,
  sendNet: true,
  receiveNet: true,
  sendPortNet: true,
  receivePortNet: true,
  closeNetConnection: true,
  getLocalIP: true,
  netCloseSockets: true,
  // HostPrinter
  printerBeginDoc: true,
  printerEndDoc: true,
  printerMetric: true,
  printerTextOut: true,
} as const satisfies Record<keyof SimHost, true>;

const ASM_OPTIONS_KEYS = {
  generateListing: true,
  generateSRecord: true,
  constantsExpanded: true,
  bitFieldInstructions: true,
  crossReference: true,
  macrosExpanded: true,
  structuredExpanded: true,
  showWarnings: true,
  tabType: true,
  tabSize: true,
} as const satisfies Record<keyof AsmOptions, true>;

const ASM_RESULT_KEYS = {
  listing: true,
  listingName: true,
  sRecord: true,
  sRecordName: true,
  messages: true,
  errorCount: true,
  warningCount: true,
  executeEnabled: true,
  dialogs: true,
  status: true,
  fatal: true,
} as const satisfies Record<keyof AsmResult, true>;

const sorted = (keys: Iterable<string>) => [...keys].sort();

// The engine modules are plain JavaScript without type declarations; load them by URL.
type AnyModule = Record<string, unknown>;
const simModuleUrl = new URL('../../../engine/sim/sim68k.mjs', import.meta.url).href;
const asmModuleUrl = new URL('../../../engine/asm/asm68k.mjs', import.meta.url).href;
const loadSim = () => import(/* @vite-ignore */ simModuleUrl) as Promise<AnyModule>;
const loadAsm = () => import(/* @vite-ignore */ asmModuleUrl) as Promise<AnyModule>;
const asmBuilt = existsSync(repo('engine/dist/asm68k.wasm')) && existsSync(repo('engine/dist/asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

describe('contract files export the declarations of section 3', () => {
  it('has exactly the contract files of the W1 entry of 9.1', () => {
    for (const file of [...Object.keys(EXPORTS), 'index.ts']) expect(existsSync(here(file)), file).toBe(true);
  });
  for (const [file, names] of Object.entries(EXPORTS)) {
    it(file, () => {
      expect(exportedNames(file)).toEqual(sorted(names));
    });
  }
  it('index.ts re-exports every contract file', () => {
    const source = readFileSync(here('index.ts'), 'utf8');
    for (const file of Object.keys(EXPORTS)) {
      expect(source, file).toContain(`export * from './${file.replace(/\.ts$/, '')}';`);
    }
  });
  it('contract files import nothing but other contract files (3.1)', () => {
    for (const file of Object.keys(EXPORTS)) {
      const source = readFileSync(here(file), 'utf8');
      for (const match of source.matchAll(/^\s*(?:import|export)[^'"]*from\s+'([^']+)'/gm)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(/^\.\/[a-z]+$/);
      }
    }
  });
});

describe('engine mirror (3.2) against engine/sim/sim68k.mjs', () => {
  it('SimEngine has the methods and getters of Sim68k.prototype', async () => {
    const { Sim68k } = (await loadSim()) as { Sim68k: { prototype: object } };
    const names = Object.getOwnPropertyNames(Sim68k.prototype).filter((n) => n !== 'constructor' && !n.startsWith('_'));
    expect(sorted(names)).toEqual(sorted(Object.keys(SIM_ENGINE_MEMBERS)));
    expect(names.length).toBe(66);
  });

  it('SimHost has the methods of HOST_DEFAULTS', async () => {
    const { HOST_DEFAULTS } = (await loadSim()) as { HOST_DEFAULTS: object };
    expect(sorted(Object.keys(HOST_DEFAULTS))).toEqual(sorted(Object.keys(SIM_HOST_METHODS)));
    expect(Object.keys(HOST_DEFAULTS).length).toBe(93);
  });

  it('the constant objects carry the numbers of the module', async () => {
    const sim = (await loadSim()) as Record<string, Record<string, number>>;
    const pairs: [Record<string, number>, Record<string, number>, Record<string, string>][] = [
      [
        contracts.RunStatus,
        sim.Status as Record<string, number>,
        {
          Running: 'RUNNING',
          Stopped: 'STOPPED',
          WaitInput: 'WAIT_INPUT',
          WaitDelay: 'WAIT_DELAY',
          WaitHost: 'WAIT_HOST',
          WaitAlert: 'WAIT_ALERT',
          Error: 'ERROR',
          Busy: 'BUSY',
        },
      ],
      [contracts.Reg, sim.Reg as Record<string, number>, { OldPC: 'OLD_PC' }],
      [contracts.Box, sim.Box as Record<string, number>, {}],
      [
        contracts.SimOption,
        sim.Option as Record<string, number>,
        {
          Exceptions: 'EXCEPTIONS',
          BitField: 'BITFIELD',
          SimHalt: 'SIMHALT',
          ExecLogType: 'EXEC_LOG_TYPE',
          OutputLogType: 'OUTPUT_LOG_TYPE',
          LogMemFrom: 'LOG_MEM_FROM',
          LogMemBytes: 'LOG_MEM_BYTES',
          DisableDisplay: 'DISABLE_DISPLAY',
          MemLive: 'MEM_LIVE',
          MainMonitor: 'MAIN_MONITOR',
          FullscreenMonitor: 'FULLSCREEN_MONITOR',
          Fullscreen: 'FULLSCREEN',
        },
      ],
      [
        contracts.MapKind,
        sim.MapKind as Record<string, number>,
        { Rom: 'ROM', Read: 'READ', Protected: 'PROTECTED', Invalid: 'INVALID' },
      ],
      [
        contracts.HwDevice,
        sim.Device as Record<string, number>,
        { Seg7: 'SEG7', Led: 'LED', Switch: 'SWITCH', PushButton: 'PUSH_BUTTON' },
      ],
      [
        contracts.ShiftBit,
        sim.Shift as Record<string, number>,
        { Shift: 'SHIFT', Alt: 'ALT', Ctrl: 'CTRL', Left: 'LEFT', Right: 'RIGHT', Middle: 'MIDDLE', Double: 'DOUBLE' },
      ],
      [
        contracts.RepaintBit,
        sim.Repaint as Record<string, number>,
        // StackRedraw: ready for docs/requests/U2-stack-redraw-bit.md (errata W1.md, entry 12)
        {
          Listing: 'LISTING',
          Breakpoints: 'BREAKPOINTS',
          Memory: 'MEMORY',
          Stack: 'STACK',
          StackRedraw: 'STACK_REDRAW',
        },
      ],
      [
        contracts.FileMode,
        sim.FileMode as Record<string, number>,
        { Update: 'UPDATE', Read: 'READ', Create: 'CREATE' },
      ],
    ];
    for (const [ours, theirs, rename] of pairs) {
      const expected = Object.fromEntries(Object.keys(ours).map((k) => [k, theirs[rename[k] ?? k]]));
      expect(ours).toEqual(expected);
      expect(Object.keys(ours).length).toBe(Object.keys(theirs).length);
    }
  });
});

describe('assembler mirror (3.2) against engine/asm/asm68k.mjs', () => {
  it('AsmOptions has the keys of DEFAULT_OPTIONS', async () => {
    const { DEFAULT_OPTIONS } = (await loadAsm()) as { DEFAULT_OPTIONS: object };
    expect(sorted(Object.keys(DEFAULT_OPTIONS))).toEqual(sorted(Object.keys(ASM_OPTIONS_KEYS)));
  });

  it.runIf(enginesRequired && !asmBuilt)('engine/dist holds the assembler (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist/asm68k.wasm or asm68k-loader.mjs is missing: ' +
        'run `npm run build:engines` first. Without the variable this check is skipped.',
    );
  });

  it.skipIf(!asmBuilt)('AsmResult has the keys of a real assembly result (needs engine/dist)', async () => {
    const { assemble } = (await loadAsm()) as {
      assemble: (name: string, files: Map<string, Uint8Array>, options: object, time: Date) => Promise<object>;
    };
    const source = new TextEncoder().encode('    ORG $1000\r\nSTART MOVE.L #1,D0\r\n    SIMHALT\r\n    END START\r\n');
    const result = await assemble(
      't.X68',
      new Map([['t.X68', source]]),
      { tabType: contracts.TabType.Fixed },
      new Date(),
    );
    expect(sorted(Object.keys(result))).toEqual(sorted(Object.keys(ASM_RESULT_KEYS)));
    expect((result as AsmResult).errorCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ additions of gate I1 */
// docs/porting/errata/W1.md, entry 11. Twenty packages were built against the contracts as they
// stood after wave one, so every member added at the gate must leave their code valid: it is
// optional, or (Vfs.mkdirp) implemented by W1's own Vfs.

/** true when A is assignable to B. */
type Assignable<A, B> = [A] extends [B] ? true : false;
/** true when an object without the members K still satisfies T, that is, when every K is optional. */
type StillValidWithout<T, K extends keyof T> = Assignable<Omit<T, K>, T>;

/**
 * The optional additions, by interface. Each entry must have the type `true`: `npm run typecheck`
 * fails here when a listed member becomes required (or is removed or renamed, since K must be a
 * key of T).
 */
const OPTIONAL_ADDITIONS = {
  saveRequest: true satisfies StillValidWithout<SaveRequest, 'overwritePrompt'>,
  fileSourceProvider: true satisfies StillValidWithout<FileSourceProvider, 'chooseFolder'>,
  fileDialogs: true satisfies StillValidWithout<FileDialogs, 'chooseFolder'>,
  documentService: true satisfies StillValidWithout<DocumentService, 'update' | 'selection'>,
  platform: true satisfies StillValidWithout<
    Platform,
    'nativeFileDialogs' | 'grantDroppedFile' | 'userDataDir' | 'bindDeviceSources' | 'onFullScreenChange'
  >,
  appContext: true satisfies StillValidWithout<AppContext, 'build'>,
  simState: true satisfies StillValidWithout<AppState['sim'], 'repaint'>,
  simRepaint: true satisfies StillValidWithout<NonNullable<AppState['sim']['repaint']>, 'stackRedraw'>,
  simSession: true satisfies StillValidWithout<SimSession, 'printJobs' | 'onPrintJob'>,
  glyphProvider: true satisfies StillValidWithout<GlyphProvider, 'textOverhang'>,
  outputDeviceDeps: true satisfies StillValidWithout<OutputDeviceDeps, 'message'>,
};

// Three methods gained an optional last parameter. A function with the parameters of wave one is
// still an implementation, and a call with the arguments of wave one is still a call.
const WAVE_ONE_SIGNATURES = {
  run: true satisfies Assignable<(id: string, arg?: unknown) => Promise<void>, CommandRegistry['run']>,
  toast: true satisfies Assignable<
    (text: string, action?: { label: string; run(): void }) => void,
    DialogService['toast']
  >,
  confirmBeforeUnload: true satisfies Assignable<(needed: boolean) => void, Platform['confirmBeforeUnload']>,
};
const NEW_ARGUMENTS = {
  run: ['ed.help.help', 'options.htm', { allowInModal: true }] satisfies Parameters<CommandRegistry['run']>,
  runAsBefore: ['ed.help.help'] satisfies Parameters<CommandRegistry['run']>,
  toast: ['A new version is available.', { label: 'Reload', run() {} }, { duration: 0 }] satisfies Parameters<
    DialogService['toast']
  >,
  toastAsBefore: ['Saved'] satisfies Parameters<DialogService['toast']>,
  confirmBeforeUnload: [true, 'documents'] satisfies Parameters<Platform['confirmBeforeUnload']>,
  confirmBeforeUnloadAsBefore: [false] satisfies Parameters<Platform['confirmBeforeUnload']>,
};

/** Where each addition is declared, as it is written in the contract file. */
const ADDED_DECLARATIONS: Record<string, string[]> = {
  'fs.ts': [
    'mkdirp(path: VPath): Promise<void>;',
    'overwritePrompt?: OverwritePrompt | null;',
    'chooseFolder?(request: FolderRequest): Promise<VPath | null>;',
  ],
  'platform.ts': [
    'readonly nativeFileDialogs?: NativeFileDialogs | null;',
    'grantDroppedFile?(file: File): Promise<DroppedEntry | null>;',
    'readonly userDataDir?: VPath | null;',
    'bindDeviceSources?(sources: DesktopDeviceSources): void;',
    'onFullScreenChange?(listener: (on: boolean) => void): () => void;',
    'confirmBeforeUnload(needed: boolean, who?: string): void;',
  ],
  'documents.ts': [
    'update?(id: string, patch: DocumentPatch): void;',
    'selection?(id: string): DocumentSelection | null;',
  ],
  'commands.ts': [
    'run(id: CommandId, arg?: unknown, options?: CommandRunOptions): Promise<void>;',
    'export interface FilesRevealArg { reveal: VPath; }',
  ],
  'features.ts': [
    'readonly build?: BuildFacts;',
    'toast(text: string, action?: { label: string; run(): void }, options?: ToastOptions): void;',
  ],
  'store.ts': [
    'repaint?: { listing: number; breakpoints: number; memory: number; stack: number; stackRedraw?: number };',
  ],
  'run.ts': [
    'readonly printJobs?: readonly PrintJob[];',
    'onPrintJob?(listener: (job: PrintJob) => void): () => void;',
  ],
  'devices.ts': ['textOverhang?(font: FontSpec): number;', 'message?: (text: string) => void;'],
};

describe('additions of gate I1 (errata W1.md, entry 11)', () => {
  it('every added member is optional, so code written against the wave-one contracts stays valid', () => {
    // The types above are the check (npm run typecheck); this keeps the tables in the test run.
    for (const table of [OPTIONAL_ADDITIONS, WAVE_ONE_SIGNATURES]) {
      for (const [name, ok] of Object.entries(table)) expect(ok, name).toBe(true);
    }
    expect(Object.keys(NEW_ARGUMENTS)).toHaveLength(6);
  });

  for (const [file, declarations] of Object.entries(ADDED_DECLARATIONS)) {
    it(`${file} declares its additions`, () => {
      // Prettier may wrap a long member over several lines: compare with white space collapsed.
      const source = readFileSync(here(file), 'utf8').replace(/\s+/g, ' ');
      for (const declaration of declarations) expect(source, declaration).toContain(declaration);
    });
  }

  it('objects with exactly the members of wave one satisfy the changed interfaces', async () => {
    const fileDialogs: FileDialogs = {
      open: async () => null,
      save: async () => null,
      registerProvider: () => () => {},
    };
    const provider: FileSourceProvider = { id: 'upload', label: 'From this computer...', available: () => true };
    const request: SaveRequest = { title: 'Save As', filters: [], defaultExt: '.X68' };
    const glyphs: GlyphProvider = {
      ready: Promise.resolve(),
      metrics: () => ({ colWidth: 8, rowHeight: 15 }),
      glyph: () => ({ advance: 8, width: 8, height: 15, coverage: new Uint8Array(8 * 15) }),
    };
    expect(fileDialogs.chooseFolder).toBeUndefined();
    expect(provider.chooseFolder).toBeUndefined();
    expect(request.overwritePrompt).toBeUndefined();
    expect(glyphs.textOverhang?.({} as never) ?? 0).toBe(0);
    expect(await fileDialogs.save(request)).toBeNull();
  });

  it('SaveRequest.overwritePrompt tells "ask this" from "ask nothing" from "ask as usual"', () => {
    const usual: SaveRequest = { title: 'Save As', filters: [], defaultExt: '.X68' };
    const own: SaveRequest = { ...usual, overwritePrompt: { title: 'Alert', text: 'File exists! OK to replace?' } };
    const none: SaveRequest = { ...usual, overwritePrompt: null };
    expect('overwritePrompt' in usual).toBe(false);
    expect(own.overwritePrompt).toEqual({ title: 'Alert', text: 'File exists! OK to replace?' });
    expect(none.overwritePrompt).toBeNull();
  });

  it("Vfs.mkdirp is the one required addition, and W1's Vfs has it", async () => {
    const vfs: Vfs = createVfs();
    vfs.mount(new MemoryBackend());
    await vfs.mkdirp('/memory/Examples/Sub');
    expect((await vfs.stat('/memory/Examples/Sub'))?.kind).toBe('dir');
  });

  // Entry 12 (review of round 1): mkdirp may be required only while createVfs() is the one Vfs.
  // A second implementation, or a fake typed as a whole Vfs, would have to grow every later
  // member; it must take Pick<Vfs, ...> or call createVfs() instead.
  it('fs/vfs.ts is the only implementation of Vfs in the repository', () => {
    const roots = ['app/src', 'desktop/src', 'tests'];
    const self = here('contracts.test.ts');
    // `class X implements A, Vfs`, `const x: Vfs = {`, `{...} as Vfs`, `{...} satisfies Vfs`
    const implementsVfs =
      /\bimplements\s+(?:[\w.]+\s*,\s*)*Vfs\b(?![\w.])|:\s*Vfs\s*=\s*\{|\b(?:as|satisfies)\s+Vfs\b(?![\w.<])/;
    const found: string[] = [];
    for (const root of roots) {
      const dir = repo(root);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
        if (!/\.(?:ts|tsx|mts|mjs)$/.test(entry) || /(?:^|[\\/])(?:node_modules|dist)[\\/]/.test(entry)) continue;
        const file = `${dir}/${entry}`.replace(/\\/g, '/');
        if (file === self.replace(/\\/g, '/')) continue;
        if (implementsVfs.test(readFileSync(file, 'utf8'))) found.push(`${root}/${entry.replace(/\\/g, '/')}`);
      }
    }
    expect(found).toEqual(['app/src/fs/vfs.ts']);
    // and the pattern sees each of the forms it names
    for (const form of ['class V implements Vfs {', 'class V implements A, Vfs {', 'const v: Vfs = {', '{} as Vfs;'])
      expect(implementsVfs.test(form), form).toBe(true);
    for (const form of ['vfs: Pick<Vfs, "stat">', 'Promise<Vfs>', 'implements VfsLike {'])
      expect(implementsVfs.test(form), form).toBe(false);
  }, 30_000);
});
