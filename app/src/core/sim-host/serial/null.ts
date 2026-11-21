// The serial ports a browser has: none (ARCHITECTURE.md 3.3.4, note 37 of 1.4).
// Task 40 returns 2, tasks 41-43 return 3 (trap15-a §6). The desktop app uses DesktopSerial instead.
//
// Owner: W1.

import type { Bytes, SerialDeviceApi } from '../../../contracts';

/** initComm result: the port cannot be opened. */
export const NULL_INIT_COMM = 2;
/** setCommParams / sendComm result, and the commRead device result -3 ("port not initialised"), which
 *  the engine turns into 3 for task 42. */
export const NULL_COMM_RESULT = 3;

export class NullSerial implements SerialDeviceApi {
  initComm(_cid: number, _portName: Bytes): number {
    return NULL_INIT_COMM;
  }
  setCommParams(_cid: number, _settings: number): number {
    return NULL_COMM_RESULT;
  }
  commRead(_cid: number, _count: number): number {
    return -3;
  }
  sendComm(_cid: number, _data: Bytes): { result: number } {
    return { result: NULL_COMM_RESULT };
  }
  resetToStartup(): void {
    // nothing is ever open
  }
}
