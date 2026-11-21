// The log service (ARCHITECTURE.md 3.3.5, 5.5; sim-ui §13; trap15-a §3.11): the execution-log and
// output-log files.
//
// The engine decides what goes into the execution log - header, records, the Rewind and Reload
// notes - and hands the bytes over through `logWrite` (CR LF line ends already in place). The
// output log is the host's: `TextScreen` passes every byte it logs to `outputWrite`, the engine
// passes its notes to `outputLogWrite`, and this service writes the header. Everything is stored
// unchanged.
//
// What this service owns:
//
//   - the two file names (recomputed on every Open, sim-ui §13.1) and the dialog's other values;
//   - Log Start: the `Log File Options` question for a file that exists, the first write of each
//     file (Replace and new files with `vfs.writeFile`, Append with `vfs.appendFile`), then
//     `engine.startLog(time)`; Cancel or a file that cannot be written leave logging off (note 41);
//   - the buffers. Bytes are kept in memory and appended about once per second and after every
//     stop of execution (`flush`, called by the run controller), always with `vfs.appendFile`, so
//     that a flush costs what it writes and not what the file already holds. Flushes never
//     overlap: one write per file at a time, and bytes that arrive meanwhile wait for the next
//     one. The next timed flush is never sooner than twenty times the duration of the previous
//     one, so a slow store cannot take more than about 5 % of the time;
//   - the enabled states of Log Start and Log Stop (sim-ui §13.6) and the tail of each file for
//     the Log panel.
//
// The program must not run between the click on Log Start and the first logged byte. While the
// question is open the dialog service holds the run controller (4.4.5); the Log Start command
// holds it as well for the whole of `start()` (features/log), which covers the moments before and
// after the question, when this service waits for the store.
//
// Owner: W1 > U4.

import {
  SimOption,
  type Bytes,
  type LogDeps,
  type LogDialogValues,
  type LogServiceApi,
  type LogStartFailure,
  type LogState,
  type SimEngine,
  type VPath,
} from '../../../contracts';
import { decode } from '../../codec/cp1252';
import { dirname, isVPath, resolveLexically } from '../../paths/winpath';
import { defaultLogFileNames, formatUsDateTime, outputLogHeader } from './format';

export type { LogDeps, LogDialogValues, LogStartFailure, LogState } from '../../../contracts';

/** A flush is due this long after the first byte that is not in storage yet (3.3.5). */
export const FLUSH_INTERVAL_MS = 1000;
/** ... but never sooner than this many times the duration of the previous flush. */
export const FLUSH_DURATION_FACTOR = 20;
/** How long the Log panel may lag behind the bytes; state changes are told at once. */
export const TAIL_NOTIFY_MS = 100;
/** Bytes of each file kept in memory for the Log panel (2.6: the last 200 lines). */
export const TAIL_BYTES = 256 * 1024;

export type LogKind = LogStartFailure['kind'];

/**
 * Which file the last `start()` could not open, or null (it started, or the user cancelled). The
 * contract's `start()` resolves false for both; the Log Start command needs to know which, to show
 * the original's error box (sim-ui §13.3 step 4). The member is optional in the contract (errata
 * W1.md): a service without it reports null.
 */
export function logStartFailure(log: LogServiceApi): LogStartFailure | null {
  return log.startFailure ?? null;
}

/** The last failure of a flush, or null after a flush that succeeded (for the Log panel). */
export function logWriteError(log: LogServiceApi): string | null {
  return log.writeError ?? null;
}

function startupState(): LogState {
  return {
    execFileName: '',
    outputFileName: '',
    execType: 0,
    outputType: 0,
    memFrom: 0,
    memBytes: 0,
    logging: false,
    startEnabled: false,
    stopEnabled: false,
  };
}

type WriteMode = 'write' | 'append';

/** One open (or closing) log file: the bytes not yet in storage and how to write them. */
class LogSink {
  private chunks: Bytes[] = [];
  private pendingBytes = 0;
  /** `write` until the first write has been made: it creates or truncates the file. */
  mode: WriteMode;
  /** The file has been written once (header, or nothing yet but created). */
  touched = false;
  /** Accepts bytes; false once logging has stopped (what is pending is still written). */
  open = true;

  constructor(
    readonly kind: LogKind,
    readonly path: VPath,
    mode: WriteMode,
  ) {
    this.mode = mode;
  }

  get pending(): number {
    return this.pendingBytes;
  }
  /** True while something remains to be done for this file. */
  get due(): boolean {
    return this.pendingBytes > 0 || !this.touched;
  }

  push(data: Bytes): void {
    if (data.length === 0) return;
    // The engine reuses its buffer: keep a copy.
    this.chunks.push(data.slice());
    this.pendingBytes += data.length;
  }

  take(): Bytes {
    const out = concat(this.chunks, this.pendingBytes);
    this.chunks = [];
    this.pendingBytes = 0;
    return out;
  }

  /** A write failed: its bytes go back in front of what arrived meanwhile. */
  putBack(data: Bytes): void {
    if (data.length === 0) return;
    this.chunks.unshift(data);
    this.pendingBytes += data.length;
  }

  drop(): void {
    this.chunks = [];
    this.pendingBytes = 0;
  }
}

/** The last bytes written to one file, for the Log panel. */
class TailBuffer {
  private chunks: Bytes[] = [];
  private size = 0;
  /** Bytes were dropped at the front: the first line shown may be cut. */
  private cut = false;

  push(data: Bytes): void {
    if (data.length === 0) return;
    this.chunks.push(data.slice());
    this.size += data.length;
    while (this.size > TAIL_BYTES && this.chunks.length > 1) {
      const first = this.chunks.shift() as Bytes;
      this.size -= first.length;
      this.cut = true;
    }
    if (this.size > TAIL_BYTES) {
      const only = this.chunks[0] as Bytes;
      this.chunks[0] = only.slice(only.length - TAIL_BYTES);
      this.size = TAIL_BYTES;
      this.cut = true;
    }
  }

  clear(): void {
    this.chunks = [];
    this.size = 0;
    this.cut = false;
  }

  lines(count: number): string[] {
    if (count <= 0 || this.size === 0) return [];
    const lines = decode(concat(this.chunks, this.size)).split(/\r\n|\n|\r/);
    if (lines[lines.length - 1] === '') lines.pop(); // the text ends with a line end
    if (this.cut) lines.shift(); // the front of the first line is gone
    return lines.slice(-count);
  }
}

function concat(chunks: readonly Bytes[], size: number): Bytes {
  if (chunks.length === 1) return chunks[0] as Bytes;
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A flush that failed, with the file it failed on. */
class SinkWriteError extends Error {
  constructor(
    readonly kind: LogKind,
    readonly path: VPath,
    readonly reason: unknown,
  ) {
    super(`The ${kind === 'exec' ? 'execution' : 'output'} log ${path} could not be written: ${describe(reason)}`, {
      cause: reason,
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const clampExecType = (value: number): LogState['execType'] => (value === 1 || value === 2 || value === 3 ? value : 0);

export class LogService implements LogServiceApi {
  private current: LogState = startupState();
  private readonly listeners = new Set<() => void>();
  private sinks: LogSink[] = [];
  private readonly tails: Record<LogKind, TailBuffer> = { exec: new TailBuffer(), output: new TailBuffer() };
  /** Folder of the loaded program: names typed without a folder are taken relative to it. */
  private programDir: VPath | null = null;
  private starting = false;
  private flushRunning: Promise<void> | null = null;
  private flushQueued: Promise<void> | null = null;
  private cancelFlushTimer: (() => void) | null = null;
  private cancelTailNotify: (() => void) | null = null;
  private lastFlushMs = 0;
  private failure: LogStartFailure | null = null;
  private lastWriteError: string | null = null;

  constructor(private readonly deps: LogDeps) {}

  get state(): LogState {
    return this.current;
  }
  /** See logStartFailure(). */
  get startFailure(): LogStartFailure | null {
    return this.failure;
  }
  /** See logWriteError(). */
  get writeError(): string | null {
    return this.lastWriteError;
  }
  /** Bytes not yet in storage, or a write still under way (the unload guard). */
  get unsaved(): boolean {
    return this.flushRunning !== null || this.sinks.some((sink) => sink.pending > 0);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ------------------------------------------------------------------ names and the dialog */

  setLogFileNames(programPath: VPath): void {
    const names = defaultLogFileNames(programPath);
    this.programDir = programDir(programPath);
    // The engine has stopped a running log itself, with its `Current Log Stopped.` box (sim-ui
    // §13.1). Log Start is enabled if a log type is selected: the types are the engine's, which
    // can be read only once the load has finished.
    this.update({ execFileName: names.exec, outputFileName: names.output });
    this.enableStartIfTypeSelected();
    this.deps.invoke((engine) => {
      this.readOptions(engine);
      this.enableStartIfTypeSelected();
    });
  }

  dialogShown(): void {
    // TLog::FormShow remembers the two types for the Rewind and Reload notes (sim-ui Q24).
    this.deps.invoke((engine) => {
      engine.logDialogOpened();
      this.readOptions(engine);
    });
  }

  applyDialog(values: LogDialogValues): void {
    const execType = clampExecType(values.execType);
    const outputType: LogState['outputType'] = values.outputType === 1 ? 1 : 0;
    const memFrom = values.memFrom >>> 0;
    const memBytes = values.memBytes >>> 0;
    this.update({
      execFileName: values.execFileName,
      outputFileName: values.outputFileName,
      execType,
      outputType,
      memFrom,
      memBytes,
    });
    this.deps.invoke((engine) => {
      engine.setOption(SimOption.ExecLogType, execType);
      engine.setOption(SimOption.OutputLogType, outputType);
      engine.setOption(SimOption.LogMemFrom, memFrom);
      engine.setOption(SimOption.LogMemBytes, memBytes);
    });
    // OK enables Log Start when a type is selected (logU.cpp:80). The original does so even while
    // logging, which would let a second Log Start open the files again; the port does not.
    this.enableStartIfTypeSelected();
  }

  /* ------------------------------------------------------------------ Log Start and Log Stop */

  async start(): Promise<boolean> {
    if (this.starting || this.current.logging) return false;
    this.starting = true;
    this.failure = null;
    const wasEnabled = this.current.startEnabled;
    this.update({ startEnabled: false });
    let started = false;
    try {
      started = await this.startSteps();
      return started;
    } finally {
      this.starting = false;
      if (!started && !this.current.logging) this.update({ startEnabled: wasEnabled || this.failure !== null });
    }
  }

  private async startSteps(): Promise<boolean> {
    // The types in force are the engine's; read them now if the engine can be reached.
    this.deps.invoke((engine) => this.readOptions(engine));
    // The files of an earlier log are written out before anything is asked about them.
    await this.drain();

    const { execType, outputType, execFileName, outputFileName } = this.current;
    const plan: { kind: LogKind; path: VPath; mode: WriteMode }[] = [];
    const wanted: { kind: LogKind; name: string }[] = [];
    if (execType !== 0) wanted.push({ kind: 'exec', name: execFileName });
    if (outputType !== 0) wanted.push({ kind: 'output', name: outputFileName });
    for (const { kind, name } of wanted) {
      const path = this.resolveName(name);
      if (path === null) {
        this.failure = { kind, fileName: name };
        return false;
      }
      // A store that cannot be reached is reported by the first write below.
      const exists = await this.deps.vfs.stat(path).then(
        (stat) => stat !== null,
        () => false,
      );
      let mode: WriteMode = 'write';
      if (exists) {
        const answer = await this.ask(kind);
        if (answer === 'Cancel') return false;
        mode = answer === 'Append' ? 'append' : 'write';
      }
      plan.push({ kind, path, mode });
    }

    // From here to startLog nothing waits: no byte can fall between the header and the first
    // logged instruction or character.
    const time = formatUsDateTime(this.deps.clock.wallTime());
    for (const { kind, path, mode } of plan) {
      const sink = new LogSink(kind, path, mode);
      this.tails[kind].clear();
      if (kind === 'output') this.append(sink, outputLogHeader(time));
      this.sinks.push(sink);
    }
    this.deps.invoke((engine) => engine.startLog(time));

    // The first write of each file creates, truncates or appends to it, with its header.
    try {
      await this.flush();
    } catch (error) {
      const failed = error instanceof SinkWriteError ? error : null;
      const sink = plan.find((entry) => entry.kind === failed?.kind) ?? plan[0];
      this.failure = sink ? { kind: sink.kind, fileName: sink.kind === 'exec' ? execFileName : outputFileName } : null;
      // The files are given up before the engine stops, so that its stop writes nothing more.
      this.closeSinks(true);
      this.deps.invoke((engine) => engine.stopLog());
      if (this.current.logging) this.update({ logging: false, stopEnabled: false });
      return false;
    }
    return true;
  }

  private async ask(kind: LogKind): Promise<'Replace' | 'Append' | 'Cancel'> {
    try {
      const answer = await this.deps.askFileExists(kind);
      return answer === 'Replace' || answer === 'Append' ? answer : 'Cancel';
    } catch {
      return 'Cancel';
    }
  }

  stop(): void {
    this.deps.invoke((engine) => engine.stopLog());
  }

  async exit(): Promise<void> {
    // The engine may already be gone (a cold start); the files are closed here either way.
    this.deps.invoke((engine) => engine.stopLog());
    if (this.current.logging || this.sinks.some((sink) => sink.open)) this.stopped();
    await this.drain();
  }

  /* ------------------------------------------------------------------ bytes */

  outputWrite(data: Bytes): void {
    if (!this.current.logging || this.current.outputType !== 1) return;
    const sink = this.openSink('output');
    if (sink) this.append(sink, data);
  }

  logWrite(data: Bytes): void {
    const sink = this.openSink('exec');
    if (sink) this.append(sink, data);
  }

  outputLogWrite(data: Bytes): void {
    // The engine has tested `logging && oLogType` (the stale snapshot of sim-ui Q24).
    const sink = this.openSink('output');
    if (sink) this.append(sink, data);
  }

  logState(logging: boolean): void {
    if (logging) {
      this.update({ logging: true, startEnabled: false, stopEnabled: true });
      return;
    }
    this.stopped();
  }

  /** Logging has ended: no more bytes are taken, and what is buffered goes to storage. */
  private stopped(): void {
    this.closeSinks(false);
    this.update({ logging: false, startEnabled: true, stopEnabled: false });
    this.flushInBackground();
  }

  private openSink(kind: LogKind): LogSink | undefined {
    for (let i = this.sinks.length - 1; i >= 0; i--) {
      const sink = this.sinks[i] as LogSink;
      if (sink.kind === kind && sink.open) return sink;
    }
    return undefined;
  }

  private append(sink: LogSink, data: Bytes): void {
    if (data.length === 0) return;
    sink.push(data);
    this.tails[sink.kind].push(data);
    this.armFlushTimer();
    this.tailChanged();
  }

  private closeSinks(dropPending: boolean): void {
    for (const sink of this.sinks) {
      sink.open = false;
      if (dropPending) sink.drop();
    }
    if (dropPending) this.sinks = [];
  }

  /* ------------------------------------------------------------------ flushing */

  flush(): Promise<void> {
    if (!this.flushRunning) {
      const run = this.flushOnce().finally(() => {
        if (this.flushRunning === run) this.flushRunning = null;
        this.armFlushTimer();
      });
      this.flushRunning = run;
      return run;
    }
    // One write per file at a time: bytes that arrived meanwhile go with the next flush.
    if (!this.flushQueued) {
      const running = this.flushRunning;
      const queued = running
        .catch(() => {})
        .then(() => {
          if (this.flushQueued === queued) this.flushQueued = null;
          return this.flush();
        });
      this.flushQueued = queued;
    }
    return this.flushQueued;
  }

  private async flushOnce(): Promise<void> {
    this.cancelFlushTimer?.();
    this.cancelFlushTimer = null;
    const started = this.deps.clock.now();
    const due = this.sinks.filter((sink) => sink.due);
    const results = await Promise.allSettled(due.map((sink) => this.writeSink(sink)));
    this.lastFlushMs = Math.max(0, this.deps.clock.now() - started);
    // A file that has stopped and has nothing left is done with.
    this.sinks = this.sinks.filter((sink) => sink.open || sink.due);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    const message = failed ? describe(failed.reason) : null;
    if (message !== this.lastWriteError) {
      this.lastWriteError = message;
      this.emit();
    }
    if (failed) throw failed.reason;
  }

  private async writeSink(sink: LogSink): Promise<void> {
    const data = sink.take();
    const mode = sink.mode;
    try {
      if (mode === 'write') await this.deps.vfs.writeFile(sink.path, data);
      else await this.deps.vfs.appendFile(sink.path, data);
      sink.mode = 'append';
      sink.touched = true;
    } catch (error) {
      sink.putBack(data);
      throw new SinkWriteError(sink.kind, sink.path, error);
    }
  }

  private flushInBackground(): void {
    // A failure is kept in `writeError` and the bytes wait for the next flush.
    void this.flush().catch(() => {});
  }

  private armFlushTimer(): void {
    if (this.cancelFlushTimer || this.flushRunning) return;
    if (!this.sinks.some((sink) => sink.pending > 0)) return;
    const delay = Math.max(FLUSH_INTERVAL_MS, FLUSH_DURATION_FACTOR * this.lastFlushMs);
    this.cancelFlushTimer = this.deps.scheduler.setTimer(delay, () => {
      this.cancelFlushTimer = null;
      this.flushInBackground();
    });
  }

  /** Flushes until every closed file is in storage; gives up on a file the store keeps refusing. */
  private async drain(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.sinks.some((sink) => sink.due) && !this.flushRunning) return;
      try {
        await this.flush();
      } catch {
        // tried again below
      }
    }
    if (this.flushRunning) await this.flushRunning.catch(() => {});
    // What cannot be written now is dropped with the files that stopped; open files keep theirs.
    this.sinks = this.sinks.filter((sink) => sink.open);
  }

  /* ------------------------------------------------------------------ the Log panel */

  tail(kind: LogKind, lines: number): string[] {
    return this.tails[kind].lines(lines);
  }

  /* ------------------------------------------------------------------ start-up state */

  resetToStartup(): void {
    this.cancelFlushTimer?.();
    this.cancelFlushTimer = null;
    this.cancelTailNotify?.();
    this.cancelTailNotify = null;
    this.sinks = [];
    this.tails.exec.clear();
    this.tails.output.clear();
    this.programDir = null;
    this.failure = null;
    this.lastWriteError = null;
    this.current = startupState();
    this.emit();
    // The new engine receives the saved log types (4.7.1 step 4); the mirrors follow them.
    this.deps.invoke((engine) => this.readOptions(engine));
  }

  /* ------------------------------------------------------------------ helpers */

  private readOptions(engine: SimEngine): void {
    this.update({
      execType: clampExecType(engine.getOption(SimOption.ExecLogType)),
      outputType: engine.getOption(SimOption.OutputLogType) === 1 ? 1 : 0,
      memFrom: engine.getOption(SimOption.LogMemFrom) >>> 0,
      memBytes: engine.getOption(SimOption.LogMemBytes) >>> 0,
    });
  }

  private enableStartIfTypeSelected(): void {
    const { execType, outputType, logging, startEnabled } = this.current;
    if (!startEnabled && !logging && !this.starting && (execType !== 0 || outputType !== 0)) {
      this.update({ startEnabled: true });
    }
  }

  /** A name from the dialog: a path of the port, or a name relative to the program's folder. */
  private resolveName(name: string): VPath | null {
    if (isVPath(name)) return name;
    if (this.programDir === null) return null;
    return resolveLexically(this.programDir, name);
  }

  private update(patch: Partial<LogState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof LogState)[]) {
      if (this.current[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    this.current = { ...this.current, ...patch };
    this.emit();
  }

  private tailChanged(): void {
    if (this.cancelTailNotify) return;
    this.cancelTailNotify = this.deps.scheduler.setTimer(TAIL_NOTIFY_MS, () => {
      this.cancelTailNotify = null;
      this.emit();
    });
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The folder of a program path; null for a name that is not a path of the port. */
function programDir(path: VPath): VPath | null {
  return isVPath(path) ? dirname(path) : null;
}
