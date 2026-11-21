// The log service (ARCHITECTURE.md 3.3.5): the execution-log and output-log files.
//
// STUB written by W1 (wave 0). U4 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub writes nothing; Log Start
// resolves false (as on Cancel).
//
// Owner: W1 > U4.

import type { Bytes, LogDeps, LogDialogValues, LogServiceApi, LogState, VPath } from '../../../contracts';

export type { LogDeps, LogDialogValues, LogState } from '../../../contracts';

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

export class LogService implements LogServiceApi {
  state: LogState = startupState();
  readonly unsaved: boolean = false;

  constructor(private readonly deps: LogDeps) {}

  subscribe(_listener: () => void): () => void {
    return () => {};
  }
  setLogFileNames(_programPath: VPath): void {}
  dialogShown(): void {}
  applyDialog(_values: LogDialogValues): void {}
  async start(): Promise<boolean> {
    return false;
  }
  stop(): void {}
  async exit(): Promise<void> {}
  outputWrite(_data: Bytes): void {}
  async flush(): Promise<void> {}
  tail(_kind: 'exec' | 'output', _lines: number): string[] {
    return [];
  }
  resetToStartup(): void {
    this.state = startupState();
  }

  /* HostLog */
  logWrite(_data: Bytes): void {}
  logState(_logging: boolean): void {}
  outputLogWrite(_data: Bytes): void {}
}
