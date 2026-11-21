// A scripted AsmEngine for unit tests and for the wave-0 stub services (ARCHITECTURE.md 9, "two
// packages outside this document"; 3.12.3). It does not assemble anything: each assemble() call is
// recorded and answered from a script. It is not a substitute for the real engine in acceptance
// tests.
//
//     const asm = new FakeAsmEngine();
//     asm.enqueue({ errorCount: 1, messages: [fakeMessage(3, 'ERROR: Invalid syntax')] });
//     const result = await asm.assemble('demo/prog.X68', files, options, new Date());
//     asm.calls[0].options.generateListing;
//
// Answers, in this order: the next enqueued answer; otherwise the responder given to the
// constructor; otherwise a clean result (no messages, Execute enabled, an empty .L68 and .S68 if
// the options ask for them). An answer may be a partial result (completed with fakeAsmResult) or
// a function of the call. An answer that is an Error makes assemble() reject with it.
//
// Owner: W1.

import type { AsmEngine, AsmMessage, AsmOptions, AsmResult, Bytes } from '../contracts';

export interface FakeAsmCall {
  mainName: string;
  /** A copy of the map that was passed (the byte arrays themselves are not copied). */
  files: Map<string, Bytes>;
  options: AsmOptions;
  timestamp: Date;
}

export type FakeAsmAnswer = Partial<AsmResult> | Error | ((call: FakeAsmCall) => Partial<AsmResult> | Error);

/** VCL ChangeFileExt, as asm68k.mjs uses it for listingName and sRecordName. */
function changeFileExt(name: string, ext: string): string {
  const cut = Math.max(name.lastIndexOf('\\'), name.lastIndexOf('/'), name.lastIndexOf(':'));
  const dot = name.lastIndexOf('.');
  return (dot > cut ? name.slice(0, dot) : name) + ext;
}

/** A complete result for `mainName`: the defaults of a clean assembly, overridden by `partial`. */
export function fakeAsmResult(mainName: string, partial: Partial<AsmResult> = {}, options?: AsmOptions): AsmResult {
  const errorCount = partial.errorCount ?? (partial.messages ?? []).filter((m) => m.severity === 'error').length;
  const warningCount = partial.warningCount ?? (partial.messages ?? []).filter((m) => m.severity === 'warning').length;
  return {
    listing: options && !options.generateListing ? null : new Uint8Array(0),
    listingName: changeFileExt(mainName, '.L68'),
    sRecord: options && !options.generateSRecord ? null : new Uint8Array(0),
    sRecordName: changeFileExt(mainName, '.S68'),
    messages: [],
    dialogs: [],
    status: 0,
    fatal: null,
    executeEnabled: errorCount === 0,
    ...partial,
    errorCount,
    warningCount,
  };
}

/** A message row of the main document. `text` starts with "ERROR: " or "WARNING: ". */
export function fakeMessage(line: number, text: string, code = text.startsWith('WARNING') ? 0x101 : 0x401): AsmMessage {
  return {
    line,
    severity: text.startsWith('WARNING') ? 'warning' : 'error',
    code,
    text,
    file: null,
    resolvedFile: null,
  };
}

export class FakeAsmEngine implements AsmEngine {
  /** Every call, in order. */
  readonly calls: FakeAsmCall[] = [];
  private readonly queue: FakeAsmAnswer[] = [];

  constructor(private readonly responder?: (call: FakeAsmCall) => Partial<AsmResult> | Error) {}

  /** Adds answers for the next calls, one call each. */
  enqueue(...answers: FakeAsmAnswer[]): this {
    this.queue.push(...answers);
    return this;
  }

  async assemble(
    mainName: string,
    files: ReadonlyMap<string, Bytes>,
    options: AsmOptions,
    timestamp: Date,
  ): Promise<AsmResult> {
    const call: FakeAsmCall = { mainName, files: new Map(files), options: { ...options }, timestamp };
    this.calls.push(call);
    let answer: FakeAsmAnswer | undefined = this.queue.shift() ?? this.responder;
    if (typeof answer === 'function') answer = answer(call);
    if (answer instanceof Error) throw answer;
    return fakeAsmResult(mainName, answer ?? {}, options);
  }
}
