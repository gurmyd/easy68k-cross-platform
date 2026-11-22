// Small stand-ins for two host parts of the conformance harness, ProgramFiles (SH6) and LogService
// (U4), written while those packages were being written in the same wave (ARCHITECTURE.md 9.4).
// The harness runs with the real classes by default; EASY68K_CONFORMANCE_PARTS=doubles (or
// parts: 'doubles') selects these, and harness.test.ts keeps the two in agreement. Owner: T3.
//
// What the doubles model, and nothing more:
//
//   ConformanceFiles  the program's folder as a map of names to bytes; names are matched without
//                     regard to letter case and with `\` or `/` (trap15-a §11 item 14); a name
//                     with a folder in it names a folder that does not exist. C library
//                     streams: "r+b" fails on a missing or read-only file, "rb" on a missing one,
//                     "w+b" creates or truncates (fails on a read-only file). No buffering: written
//                     bytes are visible at once (the 512-byte buffer of 3.8.4 is SH6's), so a
//                     program whose result shows the buffers is listed in NOT_MODELLED_BY_DOUBLES
//                     and skipped in that mode. Short reads,
//                     an empty read at the end, seeks past the end, a write on a read-only stream
//                     fails. The task 58 dialog answers with the scenario's answers.
//   ConformanceLog    keeps the execution-log bytes the engine writes and the output-log bytes the
//                     text screen hands over while an output log is on; Log Start writes the
//                     output-log header and calls engine.startLog.
//
// Neither touches the engine except through what the contracts give it.

import {
  FileMode,
  type Bytes,
  type ControllerRequest,
  type LogDeps,
  type LogDialogValues,
  type LogServiceApi,
  type LogState,
  type ProgramFilesApi,
  type SimEngine,
  type VPath,
} from '../../../app/src/contracts';

const latin1Of = (bytes: Bytes): string => String.fromCharCode(...bytes);

/**
 * The key a name is found under: the name upper case, without `.\` (the folder is flat). A name
 * with a folder in it (`sub\x.bin`, `..\x.bin`, `\x.bin`) gives '' and so no file: that folder does
 * not exist, and the original's fopen fails there, as the real ProgramFiles does. As on Windows,
 * trailing periods and spaces are dropped (`DATA.TXT.` is `data.txt`), and a name with `?` or `*`
 * names no file (trap15-a/a57).
 */
export function fileKey(name: string): string {
  const parts = name.split(/[\\/]/).filter((part) => part !== '.');
  if (parts.length !== 1) return '';
  const key = (parts[0] as string).replace(/[. ]+$/u, '').toUpperCase();
  return /[?*]/u.test(key) ? '' : key;
}

/**
 * Programs whose result depends on what the doubles deliberately do not model (the C library's
 * buffers), so that the comparison with EASY68K_CONFORMANCE_PARTS=doubles skips them; with the real
 * parts (the default) they are compared like every other program.
 */
export const NOT_MODELLED_BY_DOUBLES: Readonly<Record<string, string>> = {
  'trap15-a/a51-files-read-after-write': 'a read right after a write on one stream (the write buffer)',
  'trap15-a/a52-files-write-after-read': 'a write right after a read on one stream (the read buffer)',
  'trap15-a/a53-files-past-end-then-read': 'a read after a write past the end (the write buffer)',
  'trap15-a/a56-files-same-file-twice':
    "the first stream's read after a task 52 truncated the file returns the bytes it had buffered",
  'trap15-a/a59-files-buffer-edges': 'what a second stream sees of the 512-byte write buffer',
  'trap15-a/a60-files-large-read': "the first stream's next read returns the bytes of the block it had buffered",
};

interface OpenStream {
  key: string;
  position: number;
  readable: boolean;
  writable: boolean;
}

export interface FileDialogAnswer {
  accepted: boolean;
  path?: string;
}

/** ProgramFilesApi over a flat folder in memory. */
export class ConformanceFiles implements ProgramFilesApi {
  readonly currentDir: VPath | null = null;
  readonly unsaved = false;
  /** Files by upper-case name: their name as written last and their bytes. */
  readonly files = new Map<string, { name: string; data: number[]; readOnly: boolean }>();
  /** Every host call, for the record: `open RESULT.BIN 2 -> 1`. */
  readonly journal: string[] = [];
  private readonly streams = new Map<number, OpenStream>();
  private nextHandle = 1;
  private readonly dialogAnswers: FileDialogAnswer[];

  constructor(
    initial: Readonly<Record<string, { data: Bytes; readOnly?: boolean }>> = {},
    dialogAnswers: readonly FileDialogAnswer[] = [],
    private readonly post: (request: ControllerRequest) => void = () => {},
  ) {
    for (const [name, file] of Object.entries(initial)) {
      this.files.set(fileKey(name), { name, data: [...file.data], readOnly: file.readOnly ?? false });
    }
    this.dialogAnswers = [...dialogAnswers];
  }

  /** The bytes of a file of the folder, or null. */
  fileBytes(name: string): Uint8Array | null {
    const file = this.files.get(fileKey(name));
    return file ? Uint8Array.from(file.data) : null;
  }

  /** Every file of the folder by the name it was last written under. */
  allFiles(): Record<string, Uint8Array> {
    return Object.fromEntries([...this.files.values()].map((file) => [file.name, Uint8Array.from(file.data)]));
  }

  async setCurrentDir(_dir: VPath): Promise<void> {}
  read(name: Bytes): Bytes | null {
    return this.fileBytes(latin1Of(name));
  }
  markStale(): void {}
  async revalidateIfStale(): Promise<void> {}
  async exit(): Promise<void> {
    this.streams.clear();
  }
  exitNow(): void {
    this.streams.clear();
  }
  async recoverJournal(): Promise<void> {}
  resetToStartup(): void {
    this.streams.clear();
  }

  fileOpen(nameBytes: Bytes, mode: number): number {
    const name = latin1Of(nameBytes);
    const key = fileKey(name);
    let file = this.files.get(key);
    let handle = 0;
    if (mode === FileMode.Create) {
      if (!file?.readOnly && key !== '') {
        file = { name, data: [], readOnly: false };
        this.files.set(key, file);
        handle = this.add({ key, position: 0, readable: true, writable: true });
      }
    } else if (file && !(mode === FileMode.Update && file.readOnly)) {
      handle = this.add({ key, position: 0, readable: true, writable: mode === FileMode.Update });
    }
    this.journal.push(`open ${name} ${mode} -> ${handle}`);
    return handle;
  }

  private add(stream: OpenStream): number {
    const handle = this.nextHandle++;
    this.streams.set(handle, stream);
    return handle;
  }

  fileRead(handle: number, count: number): Bytes | null {
    const stream = this.streams.get(handle);
    const file = stream ? this.files.get(stream.key) : undefined;
    if (!stream || !file || !stream.readable) return null;
    const bytes = Uint8Array.from(file.data.slice(stream.position, stream.position + Math.max(0, count)));
    stream.position += bytes.length;
    return bytes;
  }

  fileWrite(handle: number, data: Bytes): number {
    const stream = this.streams.get(handle);
    const file = stream ? this.files.get(stream.key) : undefined;
    if (!stream || !file || !stream.writable) return -1;
    while (file.data.length < stream.position) file.data.push(0);
    for (const byte of data) file.data[stream.position++] = byte;
    return data.length;
  }

  fileSeek(handle: number, offset: number, whence: number): number {
    const stream = this.streams.get(handle);
    const file = stream ? this.files.get(stream.key) : undefined;
    if (!stream || !file) return -1;
    const base = whence === 0 ? 0 : whence === 1 ? stream.position : file.data.length;
    const position = base + offset;
    if (position < 0) return -1;
    stream.position = position;
    return position;
  }

  fileClose(handle: number): boolean {
    this.journal.push(`close ${handle}`);
    return this.streams.delete(handle);
  }

  fileRemove(nameBytes: Bytes): boolean {
    const key = fileKey(latin1Of(nameBytes));
    const file = this.files.get(key);
    if (!file || file.readOnly) return false;
    // Windows refuses to delete an open file; the C library's remove() fails then.
    if ([...this.streams.values()].some((stream) => stream.key === key)) return false;
    return this.files.delete(key);
  }

  fileDialog(_mode: number, _title: Bytes, _filter: Bytes, _fileName: Bytes): void {
    const answer = this.dialogAnswers.shift() ?? { accepted: false };
    const path =
      answer.accepted && answer.path !== undefined ? Uint8Array.from(answer.path, (c) => c.charCodeAt(0)) : null;
    this.post({ kind: 'fileDialogReply', accepted: answer.accepted, path });
  }
}

const OUTPUT_HEADER = 'EASy68K output log file: ';

/** LogServiceApi that keeps both logs in memory. */
export class ConformanceLog implements LogServiceApi {
  state: LogState = ConformanceLog.startupState();
  readonly unsaved = false;
  /** Bytes of the execution log (from engine.startLog on), and of the output log. */
  readonly execBytes: number[] = [];
  readonly outputBytes: number[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private readonly deps: Pick<LogDeps, 'invoke'>,
    /** The text of the date the logs' headers carry (masked by the comparison). */
    private readonly now: () => string = () => '1/1/2026 12:00:00 PM',
  ) {}

  private static startupState(): LogState {
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setLogFileNames(_programPath: VPath): void {}
  dialogShown(): void {
    this.deps.invoke((engine) => engine.logDialogOpened());
  }
  applyDialog(values: LogDialogValues): void {
    this.state = { ...this.state, ...values };
  }
  /** The log types in force: the harness sets them from the scenario. */
  setTypes(execType: 0 | 1 | 2 | 3, outputType: 0 | 1): void {
    this.state = { ...this.state, execType, outputType };
  }
  async start(): Promise<boolean> {
    if (this.state.outputType === 1) {
      for (const ch of `${OUTPUT_HEADER}${this.now()}\r\n\r\n`) this.outputBytes.push(ch.charCodeAt(0) & 0xff);
    }
    const time = this.now();
    this.deps.invoke((engine: SimEngine) => engine.startLog(time));
    return true;
  }
  stop(): void {
    this.deps.invoke((engine) => engine.stopLog());
  }
  async exit(): Promise<void> {}
  outputWrite(data: Bytes): void {
    if (this.state.logging && this.state.outputType === 1) this.outputBytes.push(...data);
  }
  async flush(): Promise<void> {}
  tail(_kind: 'exec' | 'output', _lines: number): string[] {
    return [];
  }
  resetToStartup(): void {
    this.state = { ...ConformanceLog.startupState(), execType: this.state.execType, outputType: this.state.outputType };
  }

  /* HostLog */
  logWrite(data: Bytes): void {
    this.execBytes.push(...data);
  }
  logState(logging: boolean): void {
    this.state = { ...this.state, logging };
    for (const listener of this.listeners) listener();
  }
  outputLogWrite(data: Bytes): void {
    if (this.state.outputType === 1) this.outputBytes.push(...data);
  }
}
