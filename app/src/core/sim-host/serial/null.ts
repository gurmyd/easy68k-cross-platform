// The serial ports a browser has: none (ARCHITECTURE.md 3.3.4, note 37 of 1.4).
// Task 40 returns 2, tasks 41-43 return 3 (trap15-a §6). The desktop app uses DesktopSerial instead.
//
// A CID outside 0..15 gives 1 ("invalid CID") for every task, before anything else: the original
// makes that check in TsimIO::initComm, setCommParams, readComm and sendComm itself
// (simIOu.cpp:2072, 2129, 2306, 2351; MAX_COMM = 16, def.h:248), so the host part must make it
// (trap15-a §6 "Common rules"; T3 finding F5, trap15-a/a47; errata W1.md entry 14).
//
// Owner: W1.

import type { Bytes, SerialDeviceApi } from '../../../contracts';

/** initComm result: the port cannot be opened. */
export const NULL_INIT_COMM = 2;
/** setCommParams / sendComm result, and the commRead device result -3 ("port not initialised"), which
 *  the engine turns into 3 for task 42. */
export const NULL_COMM_RESULT = 3;
/** Result of every task for a CID outside 0..15; commRead reports it as the device result -1. */
export const INVALID_CID_RESULT = 1;
/** The original's MAX_COMM: CIDs 0..15 are valid. */
export const MAX_COMM = 16;

/** True for a CID the original refuses (`cid < 0 || cid >= MAX_COMM`). */
export function isInvalidCid(cid: number): boolean {
  return !Number.isInteger(cid) || cid < 0 || cid >= MAX_COMM;
}

export class NullSerial implements SerialDeviceApi {
  initComm(cid: number, _portName: Bytes): number {
    return isInvalidCid(cid) ? INVALID_CID_RESULT : NULL_INIT_COMM;
  }
  setCommParams(cid: number, _settings: number): number {
    return isInvalidCid(cid) ? INVALID_CID_RESULT : NULL_COMM_RESULT;
  }
  commRead(cid: number, _count: number): number {
    return isInvalidCid(cid) ? -1 : -3;
  }
  sendComm(cid: number, _data: Bytes): { result: number } {
    return { result: isInvalidCid(cid) ? INVALID_CID_RESULT : NULL_COMM_RESULT };
  }
  resetToStartup(): void {
    // nothing is ever open
  }
}
