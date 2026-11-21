// The contracts carry exactly the declarations of ARCHITECTURE.md section 3 (W1 acceptance), and the
// engine mirror in engine.ts and host.ts matches the real engine modules.
//
// Two kinds of check:
// - Exported names: every contract file is read as text and its `export interface|type|const|class|
//   function` names are compared with the lists below (types do not exist at run time).
// - Member names: the objects below list every member of SimEngine, SimHost, AsmOptions and
//   AsmResult. `satisfies Record<keyof X, true>` makes `npm run typecheck` fail when a list and the
//   interface differ; the tests then compare the same lists with the engine modules.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AsmOptions, AsmResult, SimEngine, SimHost } from '.';
import * as contracts from '.';

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
  ],
  'documents.ts': ['DocKind', 'DocumentState', 'DocDefaults', 'DocumentService'], // 3.9
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
  'commands.ts': ['CommandId', 'CommandSpec', 'CommandHandler', 'CommandRegistry'], // 3.12.2
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
  ],
  'platform.ts': ['StartupArgs', 'NativeMenuItem', 'Platform'], // 3.13
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
        { Listing: 'LISTING', Breakpoints: 'BREAKPOINTS', Memory: 'MEMORY', Stack: 'STACK' },
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
