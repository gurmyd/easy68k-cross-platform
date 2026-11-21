// Network of the desktop app (ARCHITECTURE.md 3.3.4), through the Electron main process.
//
// STUB written by W1 (wave 0). DV4 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). Until then it answers like NullNet.
//
// Owner: W1 > DV4.

import type { Bytes, DesktopNetApi, DesktopNetDeps } from '../../../contracts';
import { NullNet } from './null';

export type { DesktopDeviceBridge, DesktopNetDeps } from '../../../contracts';

export class DesktopNet implements DesktopNetApi {
  private readonly fallback = new NullNet();

  constructor(private readonly deps: DesktopNetDeps) {}

  createNetClient(settings: number, server: Bytes, serverAddress?: number): number | undefined {
    return this.fallback.createNetClient(settings, server, serverAddress);
  }
  createNetServer(settings: number): number | undefined {
    return this.fallback.createNetServer(settings);
  }
  sendNet(settings: number, dataAddress: number, remoteIP: Bytes): { result: number; count?: number } | undefined {
    return this.fallback.sendNet(settings, dataAddress, remoteIP);
  }
  receiveNet(
    settings: number,
    bufferAddress: number,
    senderIPAddress: number,
  ): { result: number; count?: number } | undefined {
    return this.fallback.receiveNet(settings, bufferAddress, senderIPAddress);
  }
  sendPortNet(d1: number, dataAddress: number, remoteIP: Bytes): { d0: number; d1?: number } | undefined {
    return this.fallback.sendPortNet(d1, dataAddress, remoteIP);
  }
  receivePortNet(d1: number, bufferAddress: number, senderIPAddress: number): { d0: number; d1?: number } | undefined {
    return this.fallback.receivePortNet(d1, bufferAddress, senderIPAddress);
  }
  closeNetConnection(closeIP: number): number | undefined {
    return this.fallback.closeNetConnection(closeIP);
  }
  getLocalIP(localIPAddress: number): number | undefined {
    return this.fallback.getLocalIP(localIPAddress);
  }
  netCloseSockets(): number {
    return this.fallback.netCloseSockets();
  }
  resetToStartup(): void {}
}
