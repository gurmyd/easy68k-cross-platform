// Serial ports of the desktop app (ARCHITECTURE.md 3.3.4), through the Electron main process.
//
// STUB written by W1 (wave 0). DV4 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). Until then it answers like NullSerial.
//
// Owner: W1 > DV4.

import type { Bytes, DesktopSerialApi, DesktopSerialDeps } from '../../../contracts';
import { NullSerial } from './null';

export type { DesktopSerialDeps } from '../../../contracts';

export class DesktopSerial implements DesktopSerialApi {
  private readonly fallback = new NullSerial();

  constructor(private readonly deps: DesktopSerialDeps) {}

  initComm(cid: number, portName: Bytes): number | undefined {
    return this.fallback.initComm(cid, portName);
  }
  setCommParams(cid: number, settings: number): number | undefined {
    return this.fallback.setCommParams(cid, settings);
  }
  commRead(cid: number, count: number): Bytes | number {
    return this.fallback.commRead(cid, count);
  }
  sendComm(cid: number, data: Bytes): { result: number; sent?: number } | undefined {
    return this.fallback.sendComm(cid, data);
  }
  resetToStartup(): void {}
}
