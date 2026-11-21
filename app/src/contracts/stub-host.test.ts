// W1 acceptance (9.1): every stub can be constructed with its declared Deps, a host composed of the
// stubs has exactly the keys of the engine's HOST_DEFAULTS, and it lets the engine's own fixtures
// (engine/sim/test/fixtures/*.S68 with their .L68) run to their halt under Node.
//
// The parts are built here the way features/run/session.ts (SH8) builds them, with inert
// dependencies. The `main` part is a local stand-in: SimUiBridge belongs to SH8 (errata W1.md).
// The engine is engine/sim/sim68k.mjs itself, because the binding of app/src/engine (W4) does not
// exist in wave 0. The test keeps running when the owners replace the stubs: it then checks that
// the real classes are still constructible from the same Deps and still host the fixtures.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AudioBackend,
  Bytes,
  Clock,
  ControllerRequest,
  HostFiles,
  HostHardware,
  HostIoGraphics,
  HostIoText,
  HostLog,
  HostMain,
  HostNet,
  HostPrinter,
  HostSerial,
  HostSound,
  RunStatus,
  Scheduler,
  SimEngine,
  SimHost,
  SoftTimerApi,
} from '.';
import * as contracts from '.';

const Status = contracts.RunStatus;
import { ListingView } from '../core/listing/view';
import { SoundDevice } from '../core/sim-host/audio/sound-device';
import { ProgramFiles } from '../core/sim-host/files/program-files';
import { HardwareModel } from '../core/sim-host/hardware/model';
import { OutputKeyboard } from '../core/sim-host/input/keyboard';
import { OutputDevice } from '../core/sim-host/io';
import { LogService } from '../core/sim-host/log/log-service';
import { DesktopNet } from '../core/sim-host/net/desktop';
import { NullNet } from '../core/sim-host/net/null';
import { PrinterDevice } from '../core/sim-host/printer';
import { DesktopSerial } from '../core/sim-host/serial/desktop';
import { NullSerial } from '../core/sim-host/serial/null';
import { Surface } from '../core/sim-host/surface/surface';
import { TextScreen } from '../core/sim-host/text/text-screen';
import { MemoryBackend } from '../fs/memory-backend';
import { CachedSyncFiles } from '../fs/sync/cached';
import { MemorySyncFiles } from '../fs/sync/memory';
import { createVfs } from '../fs/vfs';

const repo = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
const simBuilt = existsSync(repo('engine/dist/sim68k.wasm')) && existsSync(repo('engine/dist/sim68k-loader.mjs'));
const fixtureDir = repo('engine/sim/test/fixtures');

// ---- inert dependencies ------------------------------------------------------------------------

const clock: Clock = { now: () => 0, wallTime: () => new Date(2026, 10, 20, 12, 0, 0) };
const scheduler: Scheduler = { onFrame: () => () => {}, setTimer: () => () => {} };
const posted: ControllerRequest[] = [];
const post = (request: ControllerRequest) => posted.push(request);
const softTimer = (): SoftTimerApi => ({ intervalMs: 1000, enabled: false, check: () => {} });
const silentAudio: AudioBackend = { load: () => 0, play: () => 0, stop: () => {}, release: () => {}, resume: () => {} };
const bridge = { request: () => undefined, on: () => () => {} };

/** The `main` part: SimUiBridge is SH8's and has no W1 stub; this inert stand-in has its methods. */
const main: HostMain = {
  message: () => {},
  messagesClear: () => {},
  alert: () => {},
  registersShown: () => {},
  menuState: () => {},
  focusMain: () => {},
  autoTraceTimer: () => {},
  keyCommands: () => {},
  optionChanged: () => {},
  saveSettings: () => {},
  caption: () => {},
  repaint: () => {},
  memoryLivePaint: () => {},
  fontAssign: () => {},
  timeCentiseconds: () => 0,
};

// The methods each part contributes to the host. `satisfies` ties each list to its interface.
const PART_METHODS = {
  main: [
    'message',
    'messagesClear',
    'alert',
    'registersShown',
    'menuState',
    'focusMain',
    'autoTraceTimer',
    'keyCommands',
    'optionChanged',
    'saveSettings',
    'caption',
    'repaint',
    'memoryLivePaint',
    'fontAssign',
    'timeCentiseconds',
  ] satisfies (keyof HostMain)[],
  hardware: [
    'hardwareUpdate',
    'hardwareState',
    'hardwareTimer',
    'hardwareShow',
    'hardwareControls',
  ] satisfies (keyof HostHardware)[],
  log: ['logWrite', 'logState', 'outputLogWrite'] satisfies (keyof HostLog)[],
  files: [
    'fileOpen',
    'fileRead',
    'fileWrite',
    'fileSeek',
    'fileClose',
    'fileRemove',
    'fileDialog',
  ] satisfies (keyof HostFiles)[],
  text: [
    'charOut',
    'textOut',
    'textOutCR',
    'clear',
    'getrc',
    'gotorc',
    'setFontProperties',
    'getCharAt',
    'scrollRect',
    'setWindowSize',
    'getWindowSize',
    'setupWindow',
    'ioShow',
    'ioBringToFront',
    'inputPrompt',
    'erasePrompt',
    'inputEcho',
    'inputBackspace',
    'doCRLF',
    'invalidate',
  ] satisfies (keyof HostIoText)[],
  graphics: [
    'setLineColor',
    'setFillColor',
    'drawPixel',
    'getPixel',
    'line',
    'lineTo',
    'moveTo',
    'rectangle',
    'ellipse',
    'floodFill',
    'unfilledRectangle',
    'unfilledEllipse',
    'setDrawingMode',
    'setPenWidth',
    'formPaint',
    'drawText',
    'getXY',
  ] satisfies (keyof HostIoGraphics)[],
  sound: [
    'resetSounds',
    'playSound',
    'loadSound',
    'playSoundMem',
    'controlSound',
    'playSoundDX',
    'loadSoundDX',
    'playSoundMemDX',
    'controlSoundDX',
  ] satisfies (keyof HostSound)[],
  serial: ['initComm', 'setCommParams', 'commRead', 'sendComm'] satisfies (keyof HostSerial)[],
  net: [
    'createNetClient',
    'createNetServer',
    'sendNet',
    'receiveNet',
    'sendPortNet',
    'receivePortNet',
    'closeNetConnection',
    'getLocalIP',
    'netCloseSockets',
  ] satisfies (keyof HostNet)[],
  printer: ['printerBeginDoc', 'printerEndDoc', 'printerMetric', 'printerTextOut'] satisfies (keyof HostPrinter)[],
};
type PartName = keyof typeof PART_METHODS;

/** Builds every part from its declared Deps, with inert dependencies. */
function buildParts() {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend());
  const surface = new Surface(640, 480);
  const text = new TextScreen({
    surface,
    glyphs: {
      ready: Promise.resolve(),
      metrics: () => ({ colWidth: 8, rowHeight: 15 }),
      glyph: () => ({ advance: 8, width: 8, height: 15, coverage: new Uint8Array(120) }),
    },
    scheduler,
    outputLog: () => {},
    beep: () => {},
    show: () => {},
  });
  const output = new OutputDevice({ surface, text, show: () => {}, bringToFront: () => {}, setFullScreen: () => {} });
  const files = new ProgramFiles({
    viewFor: () => new MemorySyncFiles(),
    message: () => {},
    showFileDialog: async () => null,
    post,
    journal: { write: () => {}, read: () => null },
  });
  const parts = {
    main,
    hardware: new HardwareModel({ post, timers: { create: () => softTimer() }, showPanel: () => {} }),
    log: new LogService({
      vfs,
      clock,
      scheduler,
      invoke: () => {},
      askFileExists: async () => 'Cancel' as const,
    }),
    files,
    text: output,
    graphics: output,
    sound: new SoundDevice({
      backend: silentAudio,
      clock,
      readProgramFile: (n: Bytes) => files.read(n),
      message: () => {},
    }),
    serial: new NullSerial(),
    net: new NullNet(),
    printer: new PrinterDevice({ font: () => ({ name: 'Courier New', size: 10 }), submit: () => {} }),
  };
  return { parts, surface, text, vfs };
}

/** Binds the host methods of every part into one flat object, refusing duplicates (as createSimHost of 3.3.1). */
function composeHost(parts: Record<PartName, object>): SimHost {
  const host: Record<string, unknown> = {};
  for (const [part, methods] of Object.entries(PART_METHODS) as [PartName, string[]][]) {
    const object = parts[part] as Record<string, unknown>;
    for (const name of methods) {
      const method = object[name];
      if (typeof method !== 'function') throw new Error(`part ${part} has no method ${name}`);
      if (name in host) throw new Error(`two parts define ${name}`);
      host[name] = (method as (...args: unknown[]) => unknown).bind(object);
    }
  }
  return host as unknown as SimHost;
}

// ---- the engine module, loaded by URL (plain JavaScript without declarations) -------------------

interface SimModule {
  HOST_DEFAULTS: Record<string, unknown>;
  createSim(host: object): Promise<SimEngine>;
}
const simModuleUrl = new URL('../../../engine/sim/sim68k.mjs', import.meta.url).href;
const loadSim = () => import(/* @vite-ignore */ simModuleUrl) as Promise<SimModule>;

/** Runs a loaded program until it halts. Plays the run controller's part for the wait states. */
function runToHalt(sim: SimEngine): { halted: boolean; instructions: number; statuses: RunStatus[] } {
  const statuses: RunStatus[] = [];
  let instructions = 0;
  sim.cmdRun();
  for (let round = 0; round < 10_000 && instructions < 20_000_000; round++) {
    const before = sim.stepCount;
    const status = sim.run(200_000);
    instructions += (sim.stepCount - before) >>> 0;
    if (statuses[statuses.length - 1] !== status) statuses.push(status);
    switch (status) {
      case Status.Running:
        break;
      case Status.WaitAlert:
        sim.dismissAlert();
        break;
      case Status.WaitInput:
        for (const ch of 'W1\r') sim.keyChar(ch.charCodeAt(0));
        break;
      case Status.WaitDelay:
        sim.delayElapsed(sim.delayRemaining);
        break;
      case Status.WaitHost:
        sim.fileDialogReply(false);
        break;
      case Status.Stopped:
        if (sim.state().halt) return { halted: true, instructions, statuses };
        sim.cmdRun(); // a *[sim68k]break directive or a breakpoint: continue
        break;
      default:
        return { halted: false, instructions, statuses };
    }
  }
  return { halted: false, instructions, statuses };
}

/** Case number (D7) per dispatcher fixture; 0 otherwise. Case 0 of irq spins until an interrupt
 *  that a test requests from outside, so case 2 is used: STOP with exceptions off halts. */
const CASE_NUMBER: Record<string, number> = { irq: 2 };

const fixtures = existsSync(fixtureDir)
  ? readdirSync(fixtureDir)
      .filter((f) => f.endsWith('.S68'))
      .map((f) => f.slice(0, -4))
      .sort()
  : [];

describe('stubs of section 3.3.1 and 3.1', () => {
  it('every stub can be constructed with its declared Deps', () => {
    const { parts, surface, text, vfs } = buildParts();
    expect(Object.keys(parts).sort()).toEqual(Object.keys(PART_METHODS).sort());
    expect(surface.back.width).toBe(640);
    expect(text.state.textCols).toBeGreaterThan(0);
    const engine = () => ({}) as SimEngine;
    const others = [
      new ListingView(engine),
      new OutputKeyboard({ post: () => {}, os: 'mac' }),
      new CachedSyncFiles({ vfs, scheduler, message: () => {} }),
      new DesktopSerial({ bridge, portMap: () => ({}) }),
      new DesktopNet({ bridge, memory: () => new Uint8Array(0x1000000) }),
    ];
    for (const object of others) expect(object).toBeTypeOf('object');
  });

  it('a host composed of the stubs has exactly the keys of HOST_DEFAULTS', async () => {
    const { HOST_DEFAULTS } = await loadSim();
    const host = composeHost(buildParts().parts);
    expect(Object.keys(host).sort()).toEqual(Object.keys(HOST_DEFAULTS).sort());
  });

  it('every resetToStartup() can be called', () => {
    const { parts, surface, text } = buildParts();
    for (const part of [parts.hardware, parts.log, parts.files, parts.sound, parts.serial, parts.net, parts.printer]) {
      part.resetToStartup();
    }
    surface.resetToStartup();
    text.resetToStartup();
    expect(surface.back.width * surface.back.height).toBe(640 * 480);
  });
});

describe.skipIf(!simBuilt)(
  'the engine runs its own fixtures to their halt on the stub host (needs engine/dist)',
  () => {
    it('finds the fixtures', () => {
      expect(fixtures.length).toBeGreaterThanOrEqual(10);
    });
    for (const name of fixtures) {
      it(name, async () => {
        const { createSim } = await loadSim();
        const host = composeHost(buildParts().parts);
        const sim = await createSim(host);
        const s68 = new Uint8Array(readFileSync(`${fixtureDir}/${name}.S68`));
        const l68Path = `${fixtureDir}/${name}.L68`;
        const l68 = existsSync(l68Path) ? new Uint8Array(readFileSync(l68Path)) : null;
        sim.load(s68, l68, { name: `${name}.S68`, kind: 'open' });
        sim.setRegister(contracts.Reg.D7, CASE_NUMBER[name] ?? 0);
        const result = runToHalt(sim);
        expect(result, `${name}: statuses ${result.statuses.join(',')}`).toMatchObject({ halted: true });
        expect(result.instructions).toBeGreaterThan(0);
      });
    }
  },
);
