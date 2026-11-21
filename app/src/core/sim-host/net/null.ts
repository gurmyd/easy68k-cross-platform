// The network a browser has: none (ARCHITECTURE.md 3.3.4, note 37 of 1.4; trap15-b §12.4 option 1).
// Tasks 100 and 101 return $276B0002, 102 and 106 $276D0001, 103 and 107 return 0 with 0 bytes,
// 104 and 105 $276D0001. The desktop app uses DesktopNet instead.
//
// Owner: W1.

import type { Bytes, NetDeviceApi } from '../../../contracts';

/** Tasks 100, 101: creating a client or server failed. */
export const NULL_NET_CREATE = 0x276b0002;
/** Tasks 102, 104, 105, 106: no socket. */
export const NULL_NET_NO_SOCKET = 0x276d0001;

export class NullNet implements NetDeviceApi {
  createNetClient(_settings: number, _server: Bytes, _serverAddress?: number): number {
    return NULL_NET_CREATE;
  }
  createNetServer(_settings: number): number {
    return NULL_NET_CREATE;
  }
  sendNet(_settings: number, _dataAddress: number, _remoteIP: Bytes): { result: number } {
    return { result: NULL_NET_NO_SOCKET };
  }
  receiveNet(_settings: number, _bufferAddress: number, _senderIPAddress: number): { result: number; count: number } {
    return { result: 0, count: 0 };
  }
  sendPortNet(_d1: number, _dataAddress: number, _remoteIP: Bytes): { d0: number } {
    return { d0: NULL_NET_NO_SOCKET };
  }
  receivePortNet(_d1: number, _bufferAddress: number, _senderIPAddress: number): { d0: number; d1: number } {
    return { d0: 0, d1: 0 };
  }
  closeNetConnection(_closeIP: number): number {
    return NULL_NET_NO_SOCKET;
  }
  getLocalIP(_localIPAddress: number): number {
    return NULL_NET_NO_SOCKET;
  }
  netCloseSockets(): number {
    return 0;
  }
  resetToStartup(): void {
    // nothing is ever open
  }
}
