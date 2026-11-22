// The headless conformance harness (ARCHITECTURE.md 6.4): a 68000 program runs in the port's real
// simulator under Node - the real engine, the real run controller, the real host parts, virtual
// time, files in memory, silent audio - following a scenario, and the harness returns what the
// program did: the message lines, the text shadow array, a hash of the surface, the files written,
// the logs and the final registers. Owner: T3.
//
//   const program = await assembleConformance(programs[0]);         // the port's assembler
//   const outcome = await runScenario({ program, recipe: { kind: 'report' } });
//   outcome.files['result.bin'];                                     // what the program wrote
//
// It starts the program the way the Wine oracle starts the official SIM68K.exe
// (tests/oracle/wine/sim/sim_batch.py): `prog.S68 /r [/e] [/b]` for a report, Log Start and Run for
// an output log, Log Start and Auto Trace for an execution log - here as a load with the origin
// 'commandLine' and the same switches (sim-ui §8.1), then the controller's commands.
//
// Two choices the comparison with the Wine oracle needs (docs/porting/errata/T3.md):
//   - metrics 'wine' (the default for comparisons): the text cell of the default output font is
//     what GDI under Wine measures for "Fixedsys" 9 (11 x 14: Wine has no Fixedsys raster font),
//     so that the grid logic (wrap, scroll, stride aliasing) is compared with the original's on the
//     same grid. 'windows' uses the real glyph provider (app/public/fonts, Windows' metrics).
//   - parts 'final' (the default since gate I2): every host part is the class at its final path,
//     ProgramFiles (SH6) and LogService (U4) included, as 6.4 says. 'doubles' (or
//     EASY68K_CONFORMANCE_PARTS=doubles) replaces those two by the doubles of doubles.ts, which T3
//     used while SH6 and U4 were being written; harness.test.ts keeps the two modes in agreement.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  Reg,
  type Bytes,
  type ControllerRequest,
  type FontSpec,
  type Glyph,
  type GlyphProvider,
  type SimSettings,
} from '../../../app/src/contracts';
import { VIRTUAL_FRAME_MS } from '../../../app/src/core/run/clock';
import { createHeadlessSession, type HeadlessSession } from '../../../app/src/core/run/headless';
import { AtlasGlyphProvider } from '../../../app/src/core/sim-host/fonts/atlas-provider';
import { defaultLogFileNames } from '../../../app/src/core/sim-host/log/format';
import { createAsmEngine, createSimEngine, releaseSimEngine } from '../../../app/src/engine';
import { TEST_ASM_OPTIONS, TEST_ASM_TIME } from '../../../app/src/engine/testing';
import { MemoryBackend } from '../../../app/src/fs/memory-backend';
import { MemorySyncFiles } from '../../../app/src/fs/sync/memory';
import { createVfs } from '../../../app/src/fs/vfs';
import { ConformanceFiles, ConformanceLog, type FileDialogAnswer } from './doubles';
import { DUMPLIB_PATH, REPO_ROOT, SIM_CONFORMANCE_DIR, type ConformanceProgram, type Recipe } from './programs';

/* ------------------------------------------------------------------------------------ assembling */

export interface AssembledConformance {
  /** File name without extension: the S68 is `<stem>.S68`. */
  stem: string;
  s68: Bytes;
  l68: Bytes;
  /** The data files the program needs beside it, by name. */
  files: Record<string, Bytes>;
}

const bytesFromFile = (path: string): Bytes => new Uint8Array(readFileSync(path));

/**
 * Assembles a conformance program with the port's assembler and the options of a fresh
 * installation (the official run uses the shipped settings.dat: the same options). The source
 * keeps its folder below tests/conformance/sim, so that `INCLUDE '..\dumplib.X68'` resolves.
 */
export async function assembleConformance(program: ConformanceProgram): Promise<AssembledConformance> {
  const files = new Map<string, Bytes>([
    [program.source, bytesFromFile(join(SIM_CONFORMANCE_DIR, program.source))],
    ['dumplib.X68', bytesFromFile(DUMPLIB_PATH)],
  ]);
  const data: Record<string, Bytes> = {};
  for (const name of program.files) {
    const bytes = bytesFromFile(join(SIM_CONFORMANCE_DIR, program.suite, name));
    files.set(`${program.suite}/${name}`, bytes);
    data[name] = bytes;
  }
  const asm = await createAsmEngine();
  const result = await asm.assemble(program.source, files, TEST_ASM_OPTIONS, TEST_ASM_TIME);
  if (result.fatal !== null) throw new Error(`${program.id}: ${result.fatal}`);
  if (result.errorCount > 0 || !result.sRecord || !result.listing) {
    const messages = result.messages.map((m) => `line ${m.line}: ${m.text}`).join('; ');
    throw new Error(`${program.id} does not assemble: ${result.errorCount} error(s): ${messages}`);
  }
  return { stem: program.name, s68: result.sRecord, l68: result.listing, files: data };
}

/* ---------------------------------------------------------------------------------------- glyphs */

/**
 * The cells GDI under Wine 8.0 (the oracle image) measures with TextWidth("W") / TextHeight("Xp"),
 * found with probe programs (task 22 stride and task 11 bottom row; task 95/96 pen advance): the
 * image has no Fixedsys raster font, so Wine substitutes a font with an 11 x 14 cell, which makes the
 * default grid 58 x 34 in the 640 x 480 window. Courier New 10: 12 x 15 (53 x 32).
 */
export const WINE_CELLS: Readonly<Record<string, { colWidth: number; rowHeight: number }>> = {
  fixedsys: { colWidth: 11, rowHeight: 14 },
  'courier new/10': { colWidth: 12, rowHeight: 15 },
};

/** A glyph provider with Wine's cells and blank glyphs as wide as the cell. */
export function createWineGlyphs(): GlyphProvider & { unknown: Set<string> } {
  const unknown = new Set<string>();
  const cellOf = (font: FontSpec) => {
    const name = font.name.toLowerCase();
    const cell = WINE_CELLS[`${name}/${font.size}`] ?? WINE_CELLS[name];
    if (cell) return cell;
    unknown.add(`${font.name} ${font.size}`);
    return WINE_CELLS['fixedsys'] as { colWidth: number; rowHeight: number };
  };
  const glyphs = new Map<string, Glyph>();
  return {
    unknown,
    ready: Promise.resolve(),
    metrics: (font) => cellOf(font),
    glyph(font) {
      const { colWidth, rowHeight } = cellOf(font);
      const key = `${colWidth}x${rowHeight}`;
      let glyph = glyphs.get(key);
      if (!glyph) {
        glyph = {
          advance: colWidth,
          width: colWidth,
          height: rowHeight,
          coverage: new Uint8Array(colWidth * rowHeight),
        };
        glyphs.set(key, glyph);
      }
      return glyph;
    },
  };
}

/** The application's glyph provider, reading app/public/fonts from disk. */
export function createWindowsGlyphs(): GlyphProvider {
  const fonts = join(REPO_ROOT, 'app', 'public', 'fonts');
  return new AtlasGlyphProvider(async (path) => {
    try {
      return bytesFromFile(join(fonts, ...path.split('/')));
    } catch {
      return null;
    }
  });
}

/* ------------------------------------------------------------------------------------- scenarios */

/** Something a user does in a panel while the program runs. */
export type PanelAction =
  | { kind: 'irq'; level: number }
  | { kind: 'hwReset' }
  | { kind: 'switchClick'; bit: number }
  | { kind: 'pushButton'; bit: number; down: boolean }
  | { kind: 'pause' }
  | { kind: 'run' }
  | { kind: 'traceInto' }
  | { kind: 'rewind' };

export interface ScheduledAction {
  /** After this many instructions (checked frame by frame) ... */
  atInstruction?: number;
  /** ... or this many milliseconds of virtual time after the start ... */
  atMs?: number;
  /** ... or as soon as the simulator is idle (stopped or halted). */
  whenIdle?: boolean;
  action: PanelAction;
}

export interface Scenario {
  program: AssembledConformance;
  /** How the program is started; default { kind: 'report' }. */
  recipe?: Recipe;
  /** false: only load the program (the switches apply, Run is not pressed); actions start it. */
  start?: boolean;
  /** The /e and /b switches. */
  exceptions?: boolean;
  bitField?: boolean;
  /** Typed at each keyboard wait, in order: text (`\n` is Enter) or key strokes with modifiers. */
  keys?: (string | KeyStroke[])[];
  /** Answers to the task 58 dialog, in order. */
  dialogs?: FileDialogAnswer[];
  /** Data files in the program's folder, beyond the program's own: name -> bytes (read-only optional). */
  folder?: Record<string, { data: Bytes; readOnly?: boolean }>;
  actions?: ScheduledAction[];
  /** Virtual time allowed; default 60 s for a report, 2 h for an execution log. */
  timeLimitMs?: number;
  metrics?: 'wine' | 'windows';
  parts?: 'doubles' | 'final';
  settings?: Partial<SimSettings>;
  /** Memory ranges copied into the outcome at the end. */
  capture?: { address: number; length: number }[];
  /**
   * Log recipes: the Log Output dialog is shown (and confirmed) before Log Start, so that the
   * engine's snapshot of the log types is non-zero and Rewind/Reload notes reach the logs (sim-ui
   * §13.5, Q24). Default false: the oracle never opens the dialog.
   */
  logDialogShown?: boolean;
  /** Called after every frame of virtual time (for checks of a state in the middle of a run). */
  onFrame?: (session: HeadlessSession, elapsedMs: number) => void;
}

export interface Outcome {
  end: 'halted' | 'stopped' | 'waiting for input' | 'time limit';
  messages: string[];
  /** The text shadow array as rows of `textCols` bytes (latin-1), trailing blanks kept. */
  textRows: string[];
  /** The grid: columns and rows (trap15-a §3.2). */
  grid: { cols: number; rows: number };
  /** The text cursor in cells at the end (trap15-a §3.3). */
  cursor: { row: number; col: number };
  /** SHA-256 of the back buffer's pixels and its size. */
  surfaceHash: string;
  /** Files of the program's folder after the run, by name: what storage has (bytes still buffered in an open stream of the real ProgramFiles are not there yet). */
  files: Record<string, Uint8Array>;
  execLog: Uint8Array | null;
  outputLog: Uint8Array | null;
  registers: { d: number[]; a: number[]; pc: number; sr: number; ssp: number; usp: number };
  cycles: number;
  instructions: number;
  alerts: string[];
  reports: string[];
  uiLog: string[];
  /** Font requests the Wine metrics did not know. */
  unknownFonts: string[];
  /** The ranges of `capture`, by start address. */
  memory: Map<number, Uint8Array>;
}

export const PROGRAM_DIR = '/memory/conformance';
/** Virtual time a stopped program is given before the run counts as ended (an interrupt may restart it). */
export const IDLE_GRACE_MS = 1000;
const END_MARK = 'END-OF-DUMP\r\n';

/** The file ends with the marker line of dumplib.X68 (a complete result). */
function endsWithMark(bytes: Uint8Array | null): boolean {
  if (!bytes || bytes.length < END_MARK.length) return false;
  const tail = bytes.subarray(bytes.length - END_MARK.length);
  return [...tail].every((byte, i) => byte === END_MARK.charCodeAt(i));
}

export function partsMode(scenario: Pick<Scenario, 'parts'>): 'doubles' | 'final' {
  return scenario.parts ?? (process.env.EASY68K_CONFORMANCE_PARTS === 'doubles' ? 'doubles' : 'final');
}

/** Runs one scenario in a fresh headless session and returns what happened. */
export async function runScenario(scenario: Scenario): Promise<Outcome> {
  const recipe: Recipe = scenario.recipe ?? { kind: 'report' };
  const { program } = scenario;
  const vfs = createVfs();
  vfs.mount(new MemoryBackend());
  const path = `${PROGRAM_DIR}/${program.stem}.S68`;
  await vfs.writeFile(path, program.s68);
  await vfs.writeFile(`${PROGRAM_DIR}/${program.stem}.L68`, program.l68);
  const folder: Record<string, { data: Bytes; readOnly?: boolean }> = {};
  for (const [name, data] of Object.entries(program.files)) folder[name] = { data };
  Object.assign(folder, scenario.folder ?? {});
  for (const [name, file] of Object.entries(folder)) await vfs.writeFile(`${PROGRAM_DIR}/${name}`, file.data);

  const metrics = scenario.metrics ?? 'wine';
  const wineGlyphs = metrics === 'wine' ? createWineGlyphs() : null;
  const glyphs = wineGlyphs ?? createWindowsGlyphs();
  // The atlases are read from disk asynchronously: text drawn before they are there would use the
  // provider's fallback (note of X3, errata X3.md entry 5). Wine's cells resolve at once.
  await glyphs.ready;

  let session: HeadlessSession | null = null;
  const theSession = (): HeadlessSession => {
    if (!session) throw new Error('the session is not there yet');
    return session;
  };
  const post = (request: ControllerRequest) => theSession().controller.post(request);
  const doubles = partsMode(scenario) === 'doubles';
  const files = doubles ? new ConformanceFiles(folder, scenario.dialogs ?? [], post) : null;
  const log = doubles ? new ConformanceLog({ invoke: (fn) => theSession().controller.invoke(fn) }) : null;
  const execType = recipe.kind === 'log' ? recipe.execType : 0;
  const outputType = recipe.kind === 'outlog' || (recipe.kind === 'log' && recipe.withOutput) ? 1 : 0;
  log?.setTypes(execType, outputType);

  // With the real ProgramFiles, the program's folder is one synchronous view seeded with the
  // folder's files, shared by every call of viewFor, and read back at the end (collect).
  const view = doubles ? null : createFolderView(folder);
  const folderBytes = (name: string): Uint8Array | null =>
    files ? files.fileBytes(name) : viewFileBytes(view as MemorySyncFiles, name);

  const dialogAnswers = [...(scenario.dialogs ?? [])];
  session = await createHeadlessSession({
    engines: { create: createSimEngine, release: releaseSimEngine },
    vfs,
    viewFor: () => view ?? new MemorySyncFiles(),
    glyphs,
    settings: {
      execLogType: execType,
      outputLogType: outputType,
      // The oracle's Auto Trace runs at the 10 ms interval with the display update off (sim_run.py).
      autoTraceIntervalMs: 10,
      disableDisplay: true,
      ...scenario.settings,
    },
    commandLine: {
      run: recipe.kind === 'report' && scenario.start !== false,
      exceptions: scenario.exceptions ?? false,
      bitField: scenario.bitField ?? false,
    },
    answers: {
      fileDialog: () => {
        const answer = dialogAnswers.shift();
        return answer?.accepted && answer.path ? answer.path : null;
      },
    },
    ...(doubles ? { parts: { files: files!, log: log! } } : {}),
  });
  const s = session;
  const alerts: string[] = [];
  try {
    const { controller } = s;
    await controller.open(path, 'commandLine');
    if (recipe.kind !== 'report') {
      if (scenario.logDialogShown) s.log.dialogShown();
      const started = await s.log.start();
      if (!started) throw new Error('Log Start did not start a log (the log part refused)');
      if (recipe.kind === 'outlog') controller.run();
      else controller.autoTrace();
    }
    const limit = scenario.timeLimitMs ?? (recipe.kind === 'log' ? 2 * 3600_000 : 60_000);
    const keys = [...(scenario.keys ?? [])];
    const pending = [...(scenario.actions ?? [])];
    let end: Outcome['end'] = 'time limit';
    let idleSince: number | null = null;
    for (let elapsed = 0; elapsed <= limit; elapsed += VIRTUAL_FRAME_MS) {
      for (const alert of controller.alerts) alerts.push(`${alert.title}: ${alert.text}`);
      if (controller.alerts.length > 0) controller.dismissAlerts();
      // Between the ticks of an Auto Trace the controller is idle; the trace goes on while its timer runs.
      const idle = controller.phase === 'idle' && controller.queueLength === 0 && !s.bridge.state.autoTrace;
      const due = pending.filter(
        (a) =>
          (a.atMs !== undefined && elapsed >= a.atMs) ||
          (a.atInstruction !== undefined && s.engine.stepCount >>> 0 >= a.atInstruction) ||
          (a.whenIdle === true && idle),
      );
      for (const action of due) {
        pending.splice(pending.indexOf(action), 1);
        perform(s, action.action);
      }
      if (due.length === 0 && idle && pending.every((a) => !a.whenIdle)) {
        // A halted program can still be started again by an interrupt (STOP, sim-core 3.12): the
        // run ends when the result is complete, or after a second of idle virtual time.
        idleSince ??= elapsed;
        const complete = endsWithMark(folderBytes('result.bin'));
        const settled = (recipe.kind === 'report' && complete) || elapsed - idleSince >= IDLE_GRACE_MS;
        if (settled && (pending.length === 0 || pending.every((a) => a.atInstruction !== undefined))) {
          end = controller.snapshot.halted ? 'halted' : 'stopped';
          break;
        }
      } else {
        idleSince = null;
      }
      if (controller.phase === 'waitInput') {
        const next = keys.shift();
        if (next === undefined) {
          end = 'waiting for input';
          break;
        }
        if (typeof next === 'string') typeKeys(s, next);
        else for (const stroke of next) typeStroke(s, stroke);
        continue;
      }
      s.time.advance(VIRTUAL_FRAME_MS);
      scenario.onFrame?.(s, elapsed);
    }
    let logs: { exec: Uint8Array | null; output: Uint8Array | null };
    if (log) {
      logs = { exec: Uint8Array.from(log.execBytes), output: Uint8Array.from(log.outputBytes) };
    } else {
      // The real LogService buffers and appends to the two files beside the program (sim-ui §13.1).
      await s.log.flush();
      const names = defaultLogFileNames(path);
      const readLog = async (name: string, on: boolean) =>
        on && (await vfs.stat(name)) ? new Uint8Array(await vfs.readFile(name)) : null;
      logs = { exec: await readLog(names.exec, execType !== 0), output: await readLog(names.output, outputType !== 0) };
    }
    const folderFiles = files ? files.allFiles() : viewFiles(view as MemorySyncFiles);
    const outcome = collect(s, end, alerts, folderFiles, logs, wineGlyphs?.unknown);
    for (const { address, length } of scenario.capture ?? []) {
      outcome.memory.set(address, s.engine.memory.slice(address, address + length));
    }
    return outcome;
  } finally {
    s.dispose();
  }
}

/** The program's folder as one in-memory view for the real ProgramFiles, with the folder's files. */
export function createFolderView(
  folder: Readonly<Record<string, { data: Bytes; readOnly?: boolean }>>,
): MemorySyncFiles {
  const entries = Object.entries(folder);
  return new MemorySyncFiles({
    files: Object.fromEntries(entries.map(([name, file]) => [`${PROGRAM_DIR}/${name}`, file.data])),
    readOnly: entries.filter(([, file]) => file.readOnly).map(([name]) => `${PROGRAM_DIR}/${name}`),
  });
}

/** A file of the program's folder in the view, found as the program would name it; null if missing. */
function viewFileBytes(view: MemorySyncFiles, name: string): Uint8Array | null {
  const path = view.resolve(PROGRAM_DIR, name);
  const size = path === null ? null : (view.stat(path)?.size ?? null);
  if (path === null || size === null) return null;
  return new Uint8Array(view.read(path, 0, size) ?? []);
}

/** Every file of the program's folder in the view, by its name as stored (the folder is flat). */
function viewFiles(view: MemorySyncFiles): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  for (const path of view.paths()) {
    if (!path.startsWith(`${PROGRAM_DIR}/`)) continue;
    const data = view.get(path);
    if (data) result[path.slice(PROGRAM_DIR.length + 1)] = new Uint8Array(data);
  }
  return result;
}

function perform(session: HeadlessSession, action: PanelAction): void {
  const { controller } = session;
  switch (action.kind) {
    case 'pause':
      controller.pause();
      break;
    case 'run':
      controller.run();
      break;
    case 'traceInto':
      controller.traceInto();
      break;
    case 'rewind':
      controller.rewind();
      break;
    default:
      controller.post(action);
  }
}

/** One key as the Output panel's keyboard gets it, e.g. `{ key: 'i', code: 'KeyI', ctrlKey: true }`. */
export interface KeyStroke {
  key: string;
  code: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** Presses and releases one key (a frame of virtual time after each). */
export function typeStroke(session: HeadlessSession, stroke: KeyStroke): void {
  const event = {
    key: stroke.key,
    code: stroke.code,
    ctrlKey: stroke.ctrlKey ?? false,
    shiftKey: stroke.shiftKey ?? false,
    altKey: stroke.altKey ?? false,
    metaKey: false,
    repeat: false,
  };
  session.keyboard.keydown(event, false);
  session.time.advance(VIRTUAL_FRAME_MS);
  session.keyboard.keyup(event);
  session.time.advance(VIRTUAL_FRAME_MS);
}

/** Types text as key presses into the Output panel's keyboard; `\n` is Enter. */
export function typeKeys(session: HeadlessSession, text: string): void {
  const plain = { ctrlKey: false, altKey: false, metaKey: false, repeat: false };
  for (const ch of text) {
    const enter = ch === '\n' || ch === '\r';
    const key = enter ? 'Enter' : ch;
    const code = enter
      ? 'Enter'
      : /[a-z]/i.test(ch)
        ? `Key${ch.toUpperCase()}`
        : /[0-9]/.test(ch)
          ? `Digit${ch}`
          : ch === ' '
            ? 'Space'
            : '';
    const event = { key, code, ...plain, shiftKey: /[A-Z]/.test(ch) };
    session.keyboard.keydown(event, false);
    session.time.advance(VIRTUAL_FRAME_MS);
    session.keyboard.keyup(event);
    session.time.advance(VIRTUAL_FRAME_MS);
  }
}

const latin1 = (bytes: ArrayLike<number>): string => {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i] as number);
  return text;
};

function collect(
  session: HeadlessSession,
  end: Outcome['end'],
  alerts: string[],
  files: Record<string, Uint8Array>,
  logs: { exec: Uint8Array | null; output: Uint8Array | null },
  unknownFonts: Set<string> | undefined,
): Outcome {
  const { engine, text, surface } = session;
  const state = text.state;
  const rows: string[] = [];
  for (let r = 0; r < state.textRows; r++)
    rows.push(latin1(state.text.subarray(r * state.textCols, (r + 1) * state.textCols)));
  const back = surface.back;
  const hash = createHash('sha256');
  hash.update(`${back.width}x${back.height}:`);
  hash.update(new Uint8Array(back.data.buffer, back.data.byteOffset, back.data.byteLength));
  const reg = (r: Reg) => engine.getRegister(r) >>> 0;
  return {
    end,
    messages: [...session.messages()],
    textRows: rows,
    grid: { cols: state.textCols, rows: state.textRows },
    cursor: { row: state.row, col: state.col },
    surfaceHash: hash.digest('hex'),
    files,
    execLog: logs.exec,
    outputLog: logs.output,
    registers: {
      d: [Reg.D0, Reg.D1, Reg.D2, Reg.D3, Reg.D4, Reg.D5, Reg.D6, Reg.D7].map(reg),
      a: [Reg.A0, Reg.A1, Reg.A2, Reg.A3, Reg.A4, Reg.A5, Reg.A6, Reg.A7].map(reg),
      pc: reg(Reg.PC),
      sr: reg(Reg.SR) & 0xffff,
      ssp: reg(Reg.SSP),
      usp: reg(Reg.USP),
    },
    cycles: Number(engine.cycles),
    instructions: engine.stepCount >>> 0,
    alerts,
    reports: session.reports.map((r) => `${r.what}: ${String(r.error)}`),
    uiLog: [...session.uiLog],
    unknownFonts: [...(unknownFonts ?? [])],
    memory: new Map(),
  };
}
