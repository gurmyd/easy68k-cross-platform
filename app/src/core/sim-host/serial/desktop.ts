// Serial ports of the desktop app (ARCHITECTURE.md 3.3.4; trap15-a §6), through the Electron main
// process.
//
// The original's TsimIO serial code (simIOu.cpp:2048-2369) is modelled here, in the page: the CID
// checks, "close first" in task 40, the settings word of task 41 and the result codes. The main
// process (desktop/src/serial.ts) owns the real ports of this window, on the `serialport` package.
//
// - Open, configure, send and close are synchronous bridge calls (DesktopDeviceBridge.request).
// - Task 42 reads what has arrived, from a buffer in the page that the main process fills with
//   'serial.data' events; no bridge call. The original waits up to `count + 1` ms for bytes that
//   have not arrived yet; the port does not wait (a timing difference, docs/differences/DV4.md).
// - Port names: `COM1` ... are mapped to device paths by AppSettings.serialPortMap (the dialog of
//   features/desktop-devices). A name without an entry cannot be opened (result 2), as a COM port
//   that does not exist cannot.
// - Lifetime: ports stay open across Rewind, Reload, Open and Close, as in the original; the cold
//   start (resetToStartup) closes them, and the main process closes them with the window.
//
// Owner: W1 > DV4.

import type { Bytes, DesktopSerialApi, DesktopSerialDeps } from '../../../contracts';
import { decode } from '../../codec/cp1252';
import { INVALID_CID_RESULT, isInvalidCid } from './null';

export type { DesktopSerialDeps } from '../../../contracts';

/** Results of tasks 40-43 (D0.W). */
export const COMM_OK = 0;
export const COMM_ERROR = 2;
export const COMM_NOT_INITIALISED = 3;
export const COMM_TIMEOUT = 4;

/** Bytes that wait in the page per port at most; later ones are dropped, as a full driver buffer
 *  drops them. */
export const SERIAL_BUFFER_LIMIT = 64 * 1024;

/** The line settings of task 41, as the main process applies them. */
export interface LineSettings {
  baudRate: number;
  parity: 'none' | 'odd' | 'even' | 'mark';
  dataBits: 6 | 7 | 8;
  stopBits: 1 | 2;
}

/** Baud rates of bits 7..0 of task 41 (simIOu.cpp:2141-2201); index 0 is the default, 9600. */
export const BAUD_RATES: readonly number[] = Object.freeze([
  9600, 110, 300, 600, 1200, 2400, 4800, 9600, 19200, 38400, 56000, 57600, 115200, 128000, 256000,
]);
const PARITIES: readonly LineSettings['parity'][] = ['none', 'odd', 'even', 'mark'];
const DATA_BITS: readonly LineSettings['dataBits'][] = [8, 7, 6, 8];

/**
 * The line settings of a task 41 settings word, or null for a baud index of 15 to 255: the
 * original has no case for those, BuildCommDCB gets a malformed string, its failure is ignored and
 * the port keeps its settings (trap15-a §6, task 41).
 */
export function lineSettingsOf(settings: number): LineSettings | null {
  const baudRate = BAUD_RATES[settings & 0xff];
  if (baudRate === undefined) return null;
  return {
    baudRate,
    parity: PARITIES[(settings >>> 8) & 3] as LineSettings['parity'],
    dataBits: DATA_BITS[(settings >>> 10) & 3] as LineSettings['dataBits'],
    stopBits: (settings >>> 12) & 1 ? 2 : 1,
  };
}

/** The device path of a port name: the map's entry, compared without regard to letter case as
 *  Windows compares device names; null when the name has none. */
export function devicePathOf(name: string, map: Readonly<Record<string, string>>): string | null {
  const key = name.trim();
  if (key === '') return null;
  const exact = map[key];
  if (typeof exact === 'string' && exact !== '') return exact;
  const upper = key.toUpperCase();
  for (const [entry, path] of Object.entries(map)) {
    if (entry.toUpperCase() === upper && typeof path === 'string' && path !== '') return path;
  }
  return null;
}

interface PortState {
  /** Numbers the opens of this window, so that events of a closed port are ignored. */
  generation: number;
  chunks: Uint8Array[];
  waiting: number;
  /** The device reported an error or went away: reads and sends fail with 2. */
  failed: boolean;
}

export class DesktopSerial implements DesktopSerialApi {
  private readonly ports = new Map<number, PortState>();
  private generation = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: DesktopSerialDeps) {}

  /** The open CIDs and the bytes waiting for each, for tests and diagnosis. */
  get state(): { cid: number; waiting: number; failed: boolean }[] {
    return [...this.ports.entries()].map(([cid, port]) => ({ cid, waiting: port.waiting, failed: port.failed }));
  }

  /** Task 40 (simIOu.cpp:2068-2098). */
  initComm(cid: number, portName: Bytes): number {
    if (isInvalidCid(cid)) return INVALID_CID_RESULT;
    if (this.ports.has(cid)) this.closeComm(cid); // CID in use: close the port and reuse the CID
    let path: string | null;
    try {
      path = devicePathOf(decode(portName), this.deps.portMap());
    } catch {
      path = null;
    }
    if (path === null) return COMM_ERROR;
    const generation = ++this.generation;
    this.subscribe();
    if (this.request('serial.open', cid, path, generation) !== true) return COMM_ERROR;
    this.ports.set(cid, { generation, chunks: [], waiting: 0, failed: false });
    return this.setCommParams(cid, 0); // the default parameters, 9600,N,8,1
  }

  /** Task 41 (simIOu.cpp:2121-2273). */
  setCommParams(cid: number, settings: number): number {
    if (isInvalidCid(cid)) return INVALID_CID_RESULT;
    const port = this.ports.get(cid);
    if (!port) return COMM_NOT_INITIALISED;
    if (port.failed) return COMM_ERROR; // GetCommState fails on a port that went away
    const line = lineSettingsOf(settings);
    if (line === null) return COMM_OK;
    return this.request('serial.configure', cid, line) === true ? COMM_OK : COMM_ERROR;
  }

  /** Task 42: the bytes that have arrived, at most `count`; -1 invalid CID, -2 error, -3 not open. */
  commRead(cid: number, count: number): Bytes | number {
    if (isInvalidCid(cid)) return -1;
    const port = this.ports.get(cid);
    if (!port) return -3;
    if (port.failed) return -2;
    const out = new Uint8Array(Math.max(0, Math.min(count, port.waiting)));
    let filled = 0;
    while (filled < out.length) {
      const head = port.chunks[0] as Uint8Array;
      const take = Math.min(head.length, out.length - filled);
      out.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.length) port.chunks.shift();
      else port.chunks[0] = head.subarray(take);
    }
    port.waiting -= out.length;
    return out;
  }

  /** Task 43 (simIOu.cpp:2345-2369). */
  sendComm(cid: number, data: Bytes): { result: number; sent?: number } {
    if (isInvalidCid(cid)) return { result: INVALID_CID_RESULT };
    const port = this.ports.get(cid);
    if (!port) return { result: COMM_NOT_INITIALISED };
    if (port.failed) return { result: COMM_ERROR };
    const reply = this.request('serial.write', cid, data);
    const sent =
      typeof reply === 'object' && reply !== null && typeof (reply as { sent?: unknown }).sent === 'number'
        ? (reply as { sent: number }).sent
        : null;
    if (sent === null) return { result: COMM_ERROR };
    return { result: sent < data.length ? COMM_TIMEOUT : COMM_OK, sent };
  }

  /** Cold start: every port closed. */
  resetToStartup(): void {
    for (const cid of [...this.ports.keys()]) this.closeComm(cid);
  }

  /* ---------------------------------------------------------------- helpers */

  private closeComm(cid: number): void {
    this.ports.delete(cid);
    this.request('serial.close', cid);
  }

  private subscribe(): void {
    if (this.unsubscribe) return;
    const bridge = this.deps.bridge;
    const stops = [
      bridge.on('serial.data', (cid, generation, bytes) => {
        const port = this.portOf(cid, generation);
        if (!port || !(bytes instanceof Uint8Array) || bytes.length === 0) return;
        const room = SERIAL_BUFFER_LIMIT - port.waiting;
        if (room <= 0) return;
        const kept = new Uint8Array(bytes.subarray(0, room));
        port.chunks.push(kept);
        port.waiting += kept.length;
      }),
      bridge.on('serial.error', (cid, generation) => {
        const port = this.portOf(cid, generation);
        if (port) port.failed = true;
      }),
    ];
    this.unsubscribe = () => stops.forEach((stop) => stop());
  }

  private portOf(cid: unknown, generation: unknown): PortState | null {
    if (typeof cid !== 'number') return null;
    const port = this.ports.get(cid);
    return port && port.generation === generation ? port : null;
  }

  private request(channel: string, ...args: unknown[]): unknown {
    try {
      return this.deps.bridge.request(channel, ...args);
    } catch {
      return undefined;
    }
  }
}
