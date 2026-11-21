// Contract: the classes of the simulator host and their plain data types (ARCHITECTURE.md 3.1,
// "Classes, their interfaces, and their stubs").
//
// Every class that section 3 declares for the simulator side has an interface `<Name>Api` here with
// its public members, next to the plain data types it uses and the `Deps` object of its
// constructor. The class implements its Api; every other package depends on the Api only. The
// classes themselves live at their final paths (3.3.1, section 8); W1 created each as a stub and
// the owning package replaces the body:
//
//   Surface          core/sim-host/surface/surface.ts          W1 > SH1
//   TextScreen       core/sim-host/text/text-screen.ts         W1 > SH3
//   OutputDevice     core/sim-host/io.ts                       W1 > SH3
//   OutputKeyboard   core/sim-host/input/keyboard.ts           W1 > SH4
//   SoundDevice      core/sim-host/audio/sound-device.ts       W1 > SH5
//   ProgramFiles     core/sim-host/files/program-files.ts      W1 > SH6
//   PrinterDevice    core/sim-host/printer.ts                  W1 > SH6
//   HardwareModel    core/sim-host/hardware/model.ts           W1 > SH7
//   LogService       core/sim-host/log/log-service.ts          W1 > U4
//   ListingView      core/listing/view.ts                      W1 > U1
//   NullSerial       core/sim-host/serial/null.ts              W1
//   NullNet          core/sim-host/net/null.ts                 W1
//   DesktopSerial    core/sim-host/serial/desktop.ts           W1 > DV4
//   DesktopNet       core/sim-host/net/desktop.ts              W1 > DV4
//   CachedSyncFiles  fs/sync/cached.ts (Api: SyncFiles)        W1 > SH6
//   AtlasGlyphProvider  core/sim-host/fonts/atlas-provider.ts (Api: GlyphProvider;
//                       constructor(load: FontFileLoader))     SH3, no W1 stub
//   SimUiBridge, SoftTimer, RealClock, FrameScheduler, VirtualTime: core/run/ (SH8, no W1 stub;
//     see docs/porting/errata/W1.md)
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { Bytes, HardwareControls, HwDevice, MapKind, MapRow, SimEngine } from './engine';
import type { SyncFiles, Vfs, VPath } from './fs';
import type {
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
} from './host';
import type { ControllerRequest } from './run';

/* ------------------------------------------------------------------ time (3.11.1, 4.5.3) */

export interface Clock {
  now(): number; // monotonic milliseconds
  wallTime(): Date; // local date and time (task 8, log headers, listing header)
}
export interface Scheduler {
  /** Calls fn once per display frame. If no frame has arrived for 250 ms (hidden tab, minimised or
   *  covered window) it calls fn from a timer instead, whatever the page's visibility state says. */
  onFrame(fn: (now: number) => void): () => void;
  setTimer(delayMs: number, fn: () => void): () => void; // returns cancel; delay 0 = as soon as possible
}
/** RealClock (core/run/clock.ts, SH8): performance.now(), new Date(). */
export type RealClockApi = Clock;
/** FrameScheduler (core/run/clock.ts, SH8): requestAnimationFrame + watchdog timer (4.5.5). */
export type FrameSchedulerApi = Scheduler;
/** VirtualTime (core/run/clock.ts, SH8): for tests, time moves only by advance(). advance(ms) moves
 *  the clock forward in steps: at every multiple of 16 ms of virtual time it runs the frame
 *  callbacks, and at each timer's due time it runs that timer, all in time order; a timer set during
 *  advance() for a time inside the span runs in the same call. */
export interface VirtualTimeApi extends Clock, Scheduler {
  advance(ms: number): void;
}
/** SoftTimer (core/run/timers.ts, SH8; constructor(clock: Clock, onTick: () => void)). */
export interface SoftTimerApi {
  intervalMs: number; // setting it while enabled restarts the period
  enabled: boolean; // false -> true starts a fresh period; first tick one interval later
  /** Called by the controller. Fires at most once per call, then schedules now + interval. */
  check(now: number): void;
}

/* ------------------------------------------------------------------ main window (3.3.1) */

/** SimUiBridge (core/run/ui-bridge.ts, SH8): the `main` host part. */
export type SimUiBridgeApi = HostMain;

/* ------------------------------------------------------------------ drawing surface (3.4) */

export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  /** One Uint32 per pixel, value 0xFF000000 | $00BBGGRR. On little-endian hosts this is the RGBA byte
   *  order of ImageData, so the same ArrayBuffer backs the ImageData that is presented. */
  readonly data: Uint32Array;
}

export interface GraphicsState {
  penColor: number; // resolved RGB ($00BBGGRR) after the colour rule of trap15-b §4.6
  fillColor: number; // resolved RGB
  penWidth: number; // 0-255 as set; drawing uses max(width, 1)
  penMode: number; // 0-255 as set; effective operation = MODE_TABLE[penMode] (trap15-b §5.4)
  doubleBuffer: boolean;
  backPen: { x: number; y: number }; // pen position of the back buffer
  windowPen: { x: number; y: number }; // pen position of the window canvas (task 96 reads this)
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
} // right, bottom exclusive

export interface OverlayCell {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint32Array;
}

/** Surface (constructor(width: number, height: number)). The constructor takes any size from 1 x 1
 *  to the surface's maximum; the 640 x 480 minimum is applied by `resize` only. */
export interface SurfaceApi {
  readonly back: PixelBuffer; // always drawn
  /** Image on screen while double buffering is on; null while it is off (the screen shows `back`). */
  readonly window: PixelBuffer | null;
  readonly state: GraphicsState;

  /* the drawing methods of HostIoGraphics, same names and arguments */
  setLineColor(color: number): void;
  setFillColor(color: number): void;
  drawPixel(x: number, y: number): void;
  getPixel(x: number, y: number): number;
  line(x1: number, y1: number, x2: number, y2: number): void;
  lineTo(x: number, y: number): void;
  moveTo(x: number, y: number): void;
  getXY(): [number, number];
  rectangle(x1: number, y1: number, x2: number, y2: number): void;
  unfilledRectangle(x1: number, y1: number, x2: number, y2: number): void;
  ellipse(x1: number, y1: number, x2: number, y2: number): void;
  unfilledEllipse(x1: number, y1: number, x2: number, y2: number): void;
  floodFill(x: number, y: number): void;
  setDrawingMode(mode: number): void;
  setPenWidth(width: number): void;
  formPaint(): void; // window := back (task 94, mode 16, invalidate)

  /* block operations used by TextScreen */
  fillBlack(rect: Rect): void;
  /** Overlapping copies behave like GDI BitBlt. Never scales: rectangles of different size copy
   *  the size they have in common. Pixels outside the surface are neither read nor written. */
  copyRect(dest: Rect, source: Rect): void;
  /** TextOut: opaque cell in the fill colour, glyph in fontColor, then pen := (x + extent, y).
   *  target 'both' = back buffer and (unless double buffering) window; 'window' = overlay only.
   *  The cell is as wide as the advances of `glyphs` together and as high as the tallest glyph;
   *  `extent` only moves the pen. The caller leaves zero-width bytes out of `glyphs`, passes one
   *  blank glyph for a text that has only such bytes, and appends an ink-less glyph as wide as
   *  GlyphProvider.textOverhang for a simulated bold or italic face. No glyphs: nothing is painted
   *  and the pen still moves. `fontColor` may be raw or resolved: the colour rule of trap15-b §4.6
   *  is applied inside and changes no resolved colour. */
  textOut(
    x: number,
    y: number,
    glyphs: readonly Glyph[],
    extent: number,
    fontColor: number,
    target: 'both' | 'window',
  ): void;
  resize(width: number, height: number): void; // setWindowSize: black both, backPen := windowPen
  resetToStartup(): void; // 3.3.2: 640x480, black, pens at (0,0), default state

  /* presentation */
  /** Region of the on-screen image changed since the last call, or null. Clears the record. One
   *  bounding box inside the surface; it also covers every place where `overlay` appeared, changed
   *  or went away, so presenting the region and then drawing `overlay` is always right. */
  takeDirty(): Rect | null;
  readonly overlay: OverlayCell | null; // prompt cell drawn over the presented image
}

/* ------------------------------------------------------------------ fonts (3.5.1) */

export interface FontSpec {
  name: string; // as requested, e.g. "Fixedsys", "Courier New", "Lucida Sans Typerwriter"
  size: number; // points, 0-255 (task 21 passes any byte)
  bold: boolean; // at most one of the four styles is set (trap15-a task 21)
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
}
export interface CellMetrics {
  colWidth: number;
  rowHeight: number;
} // TextWidth("W"), TextHeight("Xp")
export interface Glyph {
  advance: number; // text extent of this byte in pixels
  width: number; // width may exceed advance (italic overhang)
  height: number;
  coverage: Uint8Array; // width * height values 0..255, row-major
}
export interface GlyphProvider {
  /** Resolves when the metric table and every atlas are in memory. The controller awaits it before
   *  the first load (4.7), so that task 21 can switch fonts synchronously. */
  readonly ready: Promise<void>;
  metrics(font: FontSpec): CellMetrics;
  glyph(font: FontSpec, ch: number): Glyph; // ch = one Windows-1252 byte
  /**
   * Pixels by which the opaque box of a text in this font reaches beyond its last advance: Windows'
   * simulated bold (1) and italic (half the cell height) of the raster faces, 0 otherwise. Added at
   * gate I1 as an optional member (docs/porting/errata/W1.md, entry 11): a provider without it has
   * no overhang.
   */
  textOverhang?(font: FontSpec): number;
  /**
   * The glyph Windows draws for byte $7F inside a text that has a byte of $80 or above: without ink,
   * as wide as the fallback font's glyph (an outline face measures it per atlas, errata SH3.md entry
   * 25). Null for a font in which the byte keeps its own glyph (the raster faces) or whose font files
   * do not say. Added at gate I1 round 3 as an optional member (docs/porting/errata/W1.md, entry
   * 13): a provider without it draws the byte's own glyph.
   */
  delInHighText?(font: FontSpec): Glyph | null;
}
/**
 * Reads one file below app/public/fonts/ for the glyph provider of the application
 * (`new AtlasGlyphProvider(load)`, core/sim-host/fonts/atlas-provider.ts, SH3): "metrics.json",
 * "scalable/index.json", "bitmap/Fixedsys-15.bin" ... null = no such file. The composition root
 * supplies it (a fetch relative to the page), because core/ may not fetch. Added at gate I1.
 */
export type FontFileLoader = (path: string) => Promise<Bytes | null>;

/* ------------------------------------------------------------------ text screen (3.5.2) */

export interface TextState {
  row: number; // cursor in cells
  col: number;
  textX: number; // pixel position of the cursor cell
  textY: number;
  colWidth: number;
  rowHeight: number;
  textRows: number; // capped at 128 x 256
  textCols: number;
  text: Uint8Array; // 32768 bytes, the shadow array of trap15-a §3.7
  textWrap: boolean;
  optionsFont: FontSpec; // Options > Output Window Font
  optionsFontColor: number;
  font: FontSpec; // font in use (task 21)
  fontColor: number;
  promptEnabled: boolean; // blink state
  promptVisible: boolean;
}
export interface TextScreenDeps {
  surface: SurfaceApi;
  glyphs: GlyphProvider;
  /** The 500 ms prompt timer: TextScreen runs it itself with setTimer and calls promptTick(). The
   *  run controller does not tick the prompt. */
  scheduler: Scheduler;
  outputLog: (data: Bytes) => void; // LogService.outputWrite; no-op unless the output log is active
  beep: () => void;
  /** Make the Output panel visible. Called for every character written, so it must be cheap and
   *  must do nothing, and move no focus, while the panel is visible. */
  show: () => void;
}
/** TextScreen (constructor(deps: TextScreenDeps)). */
export interface TextScreenApi {
  readonly state: TextState;
  /* the text methods of HostIoText, same names */
  charOut(ch: number): void;
  textOut(text: Bytes): void;
  textOutCR(text: Bytes): void;
  doCRLF(): void;
  clear(): void;
  gotorc(row: number, col: number): void;
  getrc(): number;
  getCharAt(row: number, col: number): number;
  scrollRect(row: number, col: number, height: number, width: number, dir: number): void;
  setFontProperties(color: number, style: number): void;
  inputPrompt(mode: number): void;
  erasePrompt(): void;
  inputEcho(ch: number, echo: boolean): void;
  inputBackspace(echo: boolean): void;
  drawText(text: Bytes, x: number, y: number): void;
  /** One tick of the 500 ms prompt timer (3.5.3, 4.5.3): draws '_' or a blank into the overlay. */
  promptTick(): void;
  /* called by OutputDevice and by options */
  setTextSize(): void; // re-measure the cell and the grid
  setTextWrap(on: boolean): void;
  setOptionsFont(font: FontSpec, color: number): void; // Options dialog OK (trap15-a §3.2)
  fontAssign(target: number, source: number): void; // simulator reset: back to the Options font and colour
  resetToStartup(): void;
}

/* ------------------------------------------------------------------ output device (3.3.1) */

/** Constructor argument of OutputDevice (core/sim-host/io.ts), which composes TextScreen and
 *  Surface into the `text` and `graphics` host parts. Not given in section 3; fixed by W1. */
export interface OutputDeviceDeps {
  surface: SurfaceApi;
  text: TextScreenApi;
  /** ioShow(): make the Output panel visible. */
  show: () => void;
  /** ioBringToFront(): bring the Output panel forward and give it the keyboard. */
  bringToFront: () => void;
  /** setupWindow(fullScreen): enter or leave full screen (2.5). */
  setFullScreen: (on: boolean) => void;
  /** One line for the simulator message area: `Output window size limited to 4096 x 4096` (2.5).
   *  Added at gate I1 as an optional member; without it the message is not shown. */
  message?: (text: string) => void;
}
/** OutputDevice (constructor(deps: OutputDeviceDeps)): the `text` and `graphics` parts. */
export type OutputDeviceApi = HostIoText & HostIoGraphics;

/* ------------------------------------------------------------------ keyboard and mouse (3.6) */

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}
export type InputEvent68k =
  /** One key press as Windows delivers it: WM_KEYDOWN, then its WM_CHAR if it has one, then - only if
   *  the engine says key commands are enabled - the pasted text of a paste chord. */
  | { kind: 'keyDown'; vk: number; ch?: number; paste?: Bytes }
  | { kind: 'keyUp'; vk: number }
  | { kind: 'char'; ch: number } // text from a dead key or an input method
  | { kind: 'ioActivated' }
  | { kind: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; shift: number }; // ShiftBit
export interface KeyboardDeps {
  post: (event: InputEvent68k) => void; // run-controller queue (4.3)
  os: 'mac' | 'windows' | 'linux';
}
/** OutputKeyboard (constructor(deps: KeyboardDeps)). */
export interface OutputKeyboardApi {
  /** Key-down of rule 4 of 2.9.4. pasteChord = the platform's paste chord with key commands enabled. */
  keydown(ev: KeyLike & { repeat: boolean; shiftKey: boolean }, pasteChord: boolean): void;
  keyup(ev: KeyLike): void;
  text(composed: string): void; // from the textarea: dead keys, input methods
  paste(text: string): void; // the textarea's paste event
  focusGained(): void; // posts ioActivated (the key table is cleared)
  focusLost(): void; // posts nothing; forgets the keys it saw go down
  resetToStartup(): void;
}

/* ------------------------------------------------------------------ audio (3.7) */

export interface WavInfo {
  valid: boolean;
  durationMs: number;
}
export type SoundId = number;
export interface AudioBackend {
  /** Registers the bytes and starts decoding in the background. Never throws. */
  load(data: Bytes): SoundId;
  /** Starts playback now, or as soon as decoding finishes. Returns a playback handle. */
  play(sound: SoundId, loop: boolean): number;
  stop(playback: number): void;
  release(sound: SoundId): void;
  /** Called from user gestures (any run command, any key in the Output panel) to unlock audio. */
  resume(): void;
}
export interface SoundDeviceDeps {
  backend: AudioBackend;
  clock: Clock;
  readProgramFile: (name: Bytes) => Bytes | null; // ProgramFiles.read: current directory rules of 3.8.4
  message: (text: string) => void; // "'<name>' not found"
}
/** SoundDevice (constructor(deps: SoundDeviceDeps)): the `sound` part. */
export interface SoundDeviceApi extends HostSound {
  resetToStartup(): void;
  /** Standard player: time on the injected clock until which a new request is refused. */
  readonly busyUntil: number;
}

/* ------------------------------------------------------------------ hardware (3.3.3) */

export interface HardwareView {
  controls: HardwareControls; // engine.hardware()
  seg7Bytes: Uint8Array; // the 8 displayed bytes: memory[seg7 + 0, 2, ... 14], leftmost first
  ledByte: number; // memory[led]
  buttonsEnabled: boolean; // IRQ and Reset buttons (hardwareState)
  autoLabel: 'Automatic' | 'Automatic Enabled' | 'Automatic Disabled';
  addressConflict: { seg7: boolean; led: boolean; sw: boolean; pb: boolean }; // rule of hardware §2.6
}
export interface HardwareActions {
  // called by the panel; every one goes to the controller queue
  clickSwitch(bit: number): void; // { kind: 'switchClick' }
  pressButton(bit: number): void; // { kind: 'pushButton', down: true }
  releaseButton(bit: number): void; // { kind: 'pushButton', down: false }
  requestIrq(level: number): void; // { kind: 'irq' }
  reset(): void; // { kind: 'hwReset' }
  setAutoChecked(level: number, on: boolean): void; // engine.setAutoIrq
  selectLevel(level: number): void; // engine.selectAutoIrq
  setAutoInterval(ms: number): void; // engine.setAutoInterval
  setAddress(device: HwDevice, address: number, commit: boolean): void; // every change; commit = Enter / blur
  setMap(kind: MapKind, row: Partial<MapRow>): void; // engine.setMemoryMap
  setVisible(visible: boolean): void; // engine.setHardwareVisible
}
export interface HardwareDeps {
  post: (request: ControllerRequest) => void; // run-controller queue (4.3)
  timers: { create(onTick: () => void): SoftTimerApi }; // 4.5.3
  showPanel: () => void; // make the Hardware panel visible
}
/** HardwareModel (constructor(deps: HardwareDeps)): the `hardware` part. */
export interface HardwareModelApi extends HostHardware {
  view(engine: SimEngine): HardwareView;
  readonly actions: HardwareActions;
  subscribe(listener: () => void): () => void; // fires when the view may have changed
  resetToStartup(): void;
}

/* ------------------------------------------------------------------ log service (3.3.5) */

export interface LogState {
  execFileName: string; // editable; recomputed on every Open (5.5)
  outputFileName: string;
  execType: 0 | 1 | 2 | 3; // mirrors of SimOption.ExecLogType / OutputLogType
  outputType: 0 | 1;
  memFrom: number; // dialog fields for type 3
  memBytes: number;
  logging: boolean; // from logState()
  startEnabled: boolean; // sim-ui §13.6
  stopEnabled: boolean;
}
export type LogDialogValues = Pick<
  LogState,
  'execFileName' | 'outputFileName' | 'execType' | 'outputType' | 'memFrom' | 'memBytes'
>;
export interface LogDeps {
  vfs: Vfs;
  clock: Clock;
  scheduler: Scheduler;
  invoke: (fn: (engine: SimEngine) => void) => void; // RunController.invoke
  /** Replace / Append / Cancel question for an existing file. */
  askFileExists: (kind: 'exec' | 'output') => Promise<'Replace' | 'Append' | 'Cancel'>;
}
/** LogService (constructor(deps: LogDeps)): the `log` part. */
export interface LogServiceApi extends HostLog {
  readonly state: LogState;
  subscribe(listener: () => void): () => void;
  setLogFileNames(programPath: VPath): void; // recompute the two default names
  dialogShown(): void; // engine.logDialogOpened()
  applyDialog(values: LogDialogValues): void; // OK: engine.setOption(...) for the four values
  /** Log Start: questions for existing files, open the buffers, write the output-log header, then
   *  engine.startLog(formatUsDateTime(now)). Resolves false, with logging off, on Cancel or failure. */
  start(): Promise<boolean>;
  stop(): void; // Log Stop: engine.stopLog()
  /** The original's exit: stop without a message box and write everything out. */
  exit(): Promise<void>;
  outputWrite(data: Bytes): void; // from TextScreen; kept only while logging and outputType == 1
  flush(): Promise<void>; // append what is buffered to the files
  readonly unsaved: boolean; // bytes not yet in storage (unload guard)
  tail(kind: 'exec' | 'output', lines: number): string[]; // for the Log panel
  resetToStartup(): void;
}

/* ------------------------------------------------------------------ program files (3.8.4) */

export interface ProgramFilesDeps {
  viewFor: (dir: VPath) => SyncFiles; // by mount, table of 3.8.4
  message: (text: string) => void; // simulator message area
  /** Opens the task 58 dialog; resolves to the chosen path or null. */
  showFileDialog: (mode: number, title: string, filter: string, initialName: string) => Promise<VPath | null>;
  post: (request: ControllerRequest) => void; // to answer with { kind: 'fileDialogReply' }
  /** Small synchronous store for bytes that must survive an abrupt page close (localStorage). */
  journal: { write(text: string | null): void; read(): string | null };
}
/** ProgramFiles (constructor(deps: ProgramFilesDeps)): the `files` part. */
export interface ProgramFilesApi extends HostFiles {
  /** The directory relative names resolve against (the original's current directory). */
  readonly currentDir: VPath | null;
  setCurrentDir(dir: VPath): Promise<void>; // prepares the view of dir
  /** Whole file for other host parts (sound). Same name rules as fileOpen; sees committed bytes. */
  read(name: Bytes): Bytes | null;
  markStale(): void; // the window had the focus elsewhere
  revalidateIfStale(): Promise<void>;
  /** The original's process exit: commit the pending bytes of every stream, open or abandoned, in the
   *  order the streams were opened, close them all, and wait until storage has everything. */
  exit(): Promise<void>;
  /** Synchronous part of exit() for an abrupt page close: commit what can be committed and write the
   *  rest to the journal. recoverJournal() applies it at the next start. */
  exitNow(): void;
  recoverJournal(): Promise<void>;
  readonly unsaved: boolean; // pending bytes, or changes not yet in storage
  resetToStartup(): void;
}

/* ------------------------------------------------------------------ printer (3.8.4) */

export interface PrintedChar {
  x: number;
  y: number;
  ch: number;
} // printer pixels, one byte
export interface PrintJob {
  font: { name: string; size: number };
  chars: PrintedChar[];
}
export interface PrinterDeps {
  font: () => { name: string; size: number }; // SimSettings.printerFont
  submit: (job: PrintJob) => void; // to the Printer Output dialog and Platform.print
}
/** PrinterDevice (constructor(deps: PrinterDeps)): the `printer` part. */
export interface PrinterDeviceApi extends HostPrinter {
  fontChanged(): void; // Options > Printer Font, or a simulator reset
  resetToStartup(): void; // an open job is submitted as it stands
}

/* ------------------------------------------------------------------ listing view (3.11.4) */

/** ListingView (constructor(engine: () => SimEngine)). */
export interface ListingViewApi {
  /** Re-reads all rows. The run controller calls it after a load, a close and a cold start: the
   *  rows change at no other time. RepaintBit.Listing alone (every trace step, every breakpoint
   *  toggle) redraws the panel and does not call it. `rows` is a new array after every call. */
  refresh(): void;
  readonly rows: readonly string[]; // Windows-1252 decoded, no line ends
  isInstruction(row: number): boolean; // sim-ui §6.2
  addressOf(row: number): number | null; // first 8 characters as hex
  find(text: string, fromRow: number): number; // sim-ui §6.7; -1 = none
}

/* ------------------------------------------------------------------ serial and network (3.3.4) */

/** NullSerial (constructor()), DesktopSerial (constructor(deps: DesktopSerialDeps)): the `serial` part. */
export interface SerialDeviceApi extends HostSerial {
  resetToStartup(): void; // every port closed
}
/** NullNet (constructor()), DesktopNet (constructor(deps: DesktopNetDeps)): the `net` part. */
export interface NetDeviceApi extends HostNet {
  resetToStartup(): void; // socket closed; `bound` and `mode` back to their initial values
}
export type DesktopSerialApi = SerialDeviceApi;
export type DesktopNetApi = NetDeviceApi;

/**
 * The page side of the desktop app's device bridge (3.3.4): the preload script exposes it on
 * window.easy68kDesktop and platform/desktop.ts (DV2) hands it to DesktopSerial and DesktopNet.
 * Not given in section 3; fixed by W1 so that the two constructors are contract from wave 0.
 */
export interface DesktopDeviceBridge {
  /** A synchronous bridge call (ipcRenderer.sendSync): open, configure, send, close, name lookup. */
  request(channel: string, ...args: unknown[]): unknown;
  /** Events the main process pushes (received data); returns the unsubscribe function. */
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}
export interface DesktopSerialDeps {
  bridge: DesktopDeviceBridge;
  /** AppSettings.serialPortMap: "COM4" -> device path. */
  portMap: () => Readonly<Record<string, string>>;
}
export interface DesktopNetDeps {
  bridge: DesktopDeviceBridge;
  /** engine.memory, re-read on every call (tasks 100-107 read and write 68000 memory). */
  memory: () => Uint8Array;
}
