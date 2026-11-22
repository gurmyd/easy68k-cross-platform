// The serial ports of the desktop app's windows (ARCHITECTURE.md 3.3.4, 7.6), on the `serialport`
// package, in the main process.
//
// The original's rules (CID checks, "close first" in task 40, the settings word of task 41, the
// result codes) live in the page, in app/src/core/sim-host/serial/desktop.ts. This file owns the
// real ports and answers the page's synchronous device calls:
//
//   serial.open(cid, path, generation)   true once the port is open (9600,N,8,1), else false
//   serial.configure(cid, line)          true once the line settings are applied, else false
//   serial.write(cid, bytes)             { sent } once the bytes are written, else false
//   serial.close(cid)                    true
//   serial.list()                        [{ path, manufacturer?, serialNumber? }] (the dialog)
//
// Received bytes go to the page as events, so that task 42 needs no bridge call:
//
//   serial.data(cid, generation, bytes)
//   serial.error(cid, generation)        the port failed or went away
//
// `serialport` and its native module are loaded at the first serial call, not at start-up: a
// window that never opens a port never loads them, and a module that cannot be loaded makes the
// open fail (result 2) instead of the app.
//
// Ports stay open across the simulator's Rewind and Reload (the page never closes them then); they
// are closed by the page at a cold start, and here when the window's page navigates or the window
// closes.
//
// Owner: DV4.

import type { SerialPort as SerialPortClass } from 'serialport';
import { deviceTestHooks, PerWindow, type DeviceRegistrationOptions } from './net';
import { registerDeviceHandler, sendDeviceEvent } from './sync-ipc';

/** The line settings the page sends (LineSettings of app/src/core/sim-host/serial/desktop.ts). */
export interface LineSettings {
  baudRate: number;
  parity: 'none' | 'odd' | 'even' | 'mark';
  dataBits: 6 | 7 | 8;
  stopBits: 1 | 2;
}

/** 9600,N,8,1: what task 40 sets (setCommParams with settings 0). */
export const DEFAULT_LINE: LineSettings = Object.freeze({ baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1 });

/** The most bytes one write carries: task 43's count is one byte. */
export const MAX_WRITE_BYTES = 255;

export type SerialEmit = (channel: string, ...args: unknown[]) => void;

/** What the devices need of `serialport` (the real package, or a mock binding in tests). */
export interface SerialPortModule {
  SerialPort: {
    new (options: {
      path: string;
      baudRate: number;
      dataBits: 6 | 7 | 8;
      parity: LineSettings['parity'];
      stopBits: 1 | 2;
      autoOpen: false;
      lock: boolean;
    }): SerialPortClass;
    list(): Promise<{ path: string; manufacturer?: string | undefined; serialNumber?: string | undefined }[]>;
  };
}

export type SerialPortLoader = () => Promise<SerialPortModule>;

/** Loads the real package once; a failure is remembered and reported once. */
function defaultLoader(): SerialPortLoader {
  let loading: Promise<SerialPortModule> | null = null;
  return () => {
    loading ??= import('serialport').then(
      (module) => module as unknown as SerialPortModule,
      (error: unknown) => {
        console.error('serialport could not be loaded:', error);
        throw error;
      },
    );
    return loading;
  };
}

export function isLineSettings(value: unknown): value is LineSettings {
  const line = value as Partial<LineSettings> | null;
  return (
    typeof line === 'object' &&
    line !== null &&
    typeof line.baudRate === 'number' &&
    Number.isInteger(line.baudRate) &&
    line.baudRate > 0 &&
    line.baudRate <= 4_000_000 &&
    (line.parity === 'none' || line.parity === 'odd' || line.parity === 'even' || line.parity === 'mark') &&
    (line.dataBits === 6 || line.dataBits === 7 || line.dataBits === 8) &&
    (line.stopBits === 1 || line.stopBits === 2)
  );
}

function isCid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 16;
}

interface OpenPort {
  port: SerialPortClass;
  path: string;
  generation: number;
  line: LineSettings;
}

/** The ports of one window. */
export class SerialDevices {
  private readonly ports = new Map<number, OpenPort>();

  constructor(
    private readonly emit: SerialEmit,
    private readonly load: SerialPortLoader = defaultLoader(),
  ) {}

  /** The open CIDs (tests). */
  get open(): number[] {
    return [...this.ports.keys()];
  }

  /** Opens `path` for exclusive use with 9600,N,8,1 as CID `cid`; an open CID is closed first. */
  async openPort(cid: unknown, path: unknown, generation: unknown): Promise<boolean> {
    if (
      !isCid(cid) ||
      typeof path !== 'string' ||
      path === '' ||
      path.length > 1024 ||
      typeof generation !== 'number'
    ) {
      return false;
    }
    await this.closePort(cid);
    const port = await this.openDevice(path, DEFAULT_LINE);
    if (!port) return false;
    const entry: OpenPort = { port, path, generation, line: { ...DEFAULT_LINE } };
    this.ports.set(cid, entry);
    this.watch(cid, entry);
    return true;
  }

  /** Applies the line settings of task 41. Only the baud rate can be changed on an open port; for
   *  the others the port is closed and opened again with the new settings. */
  async configure(cid: unknown, line: unknown): Promise<boolean> {
    if (!isCid(cid) || !isLineSettings(line)) return false;
    const entry = this.ports.get(cid);
    if (!entry) return false;
    const same = (key: keyof LineSettings) => entry.line[key] === line[key];
    if (same('baudRate') && same('parity') && same('dataBits') && same('stopBits')) return true;
    if (same('parity') && same('dataBits') && same('stopBits')) {
      const updated = await new Promise<boolean>((resolve) => {
        try {
          entry.port.update({ baudRate: line.baudRate }, (error) => resolve(!error));
        } catch {
          resolve(false);
        }
      });
      if (updated) entry.line = { ...line };
      return updated;
    }
    // Reopen with the new settings. The page's buffer is not affected; bytes the driver held are.
    this.ports.delete(cid);
    await closeDevice(entry.port);
    const port = await this.openDevice(entry.path, line);
    if (!port) {
      // The old settings once more, so that the CID stays usable as it does in the original.
      const again = await this.openDevice(entry.path, entry.line);
      if (again) {
        const restored: OpenPort = { ...entry, port: again };
        this.ports.set(cid, restored);
        this.watch(cid, restored);
      } else {
        this.emit('serial.error', cid, entry.generation);
      }
      return false;
    }
    const next: OpenPort = { ...entry, port, line: { ...line } };
    this.ports.set(cid, next);
    this.watch(cid, next);
    return true;
  }

  /** Writes the bytes; resolves when the system has taken them. */
  async write(cid: unknown, bytes: unknown): Promise<{ sent: number } | false> {
    if (!isCid(cid) || !(bytes instanceof Uint8Array) || bytes.length > MAX_WRITE_BYTES) return false;
    const entry = this.ports.get(cid);
    if (!entry) return false;
    if (bytes.length === 0) return { sent: 0 };
    return new Promise((resolve) => {
      try {
        entry.port.write(Buffer.from(bytes), (error) => resolve(error ? false : { sent: bytes.length }));
      } catch {
        resolve(false);
      }
    });
  }

  async closePort(cid: unknown): Promise<boolean> {
    if (!isCid(cid)) return false;
    const entry = this.ports.get(cid);
    if (!entry) return true;
    this.ports.delete(cid);
    await closeDevice(entry.port);
    return true;
  }

  closeAll(): void {
    for (const entry of this.ports.values()) void closeDevice(entry.port);
    this.ports.clear();
  }

  async list(): Promise<{ path: string; manufacturer?: string; serialNumber?: string }[]> {
    try {
      const { SerialPort } = await this.load();
      const found = await SerialPort.list();
      return found.slice(0, 256).map((info) => ({
        path: String(info.path),
        ...(typeof info.manufacturer === 'string' ? { manufacturer: info.manufacturer } : {}),
        ...(typeof info.serialNumber === 'string' ? { serialNumber: info.serialNumber } : {}),
      }));
    } catch {
      return [];
    }
  }

  /* ---------------------------------------------------------------- internals */

  private async openDevice(path: string, line: LineSettings): Promise<SerialPortClass | null> {
    let module: SerialPortModule;
    try {
      module = await this.load();
    } catch {
      return null;
    }
    let port: SerialPortClass;
    try {
      port = new module.SerialPort({ path, ...line, autoOpen: false, lock: true });
    } catch {
      return null;
    }
    // An error that no call is waiting for must not end the main process.
    port.on('error', () => {});
    return new Promise((resolve) => {
      try {
        port.open((error) => resolve(error ? null : port));
      } catch {
        resolve(null);
      }
    });
  }

  private watch(cid: number, entry: OpenPort): void {
    const current = () => this.ports.get(cid) === entry;
    entry.port.on('data', (chunk: Buffer) => {
      if (current()) this.emit('serial.data', cid, entry.generation, new Uint8Array(chunk));
    });
    entry.port.on('error', () => {
      if (current()) this.emit('serial.error', cid, entry.generation);
    });
    entry.port.on('close', () => {
      // Closed by the system (the device went away), not by us: we delete the entry first.
      if (current()) this.emit('serial.error', cid, entry.generation);
    });
  }
}

function closeDevice(port: SerialPortClass): Promise<void> {
  return new Promise((resolve) => {
    if (!port.isOpen) {
      resolve();
      return;
    }
    try {
      port.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

/* ------------------------------------------------------------------ registration */

/** Registers the serial.* device channels (desktop/src/main.ts calls it once). */
export function registerSerialDevices(options: DeviceRegistrationOptions & { load?: SerialPortLoader }): () => void {
  const hooks = deviceTestHooks(options.testMode);
  const load = options.load ?? defaultLoader();
  const windows = new PerWindow<SerialDevices>(
    (sender) => new SerialDevices((channel, ...args) => sendDeviceEvent(sender, channel, ...args), load),
    (devices) => devices.closeAll(),
  );
  const handle = (channel: string, run: (devices: SerialDevices, ...args: unknown[]) => unknown) =>
    registerDeviceHandler(channel, (sender, ...args) => {
      if (hooks) hooks.counts[channel] = (hooks.counts[channel] ?? 0) + 1;
      return run(windows.of(sender), ...args);
    });
  const stops = [
    handle('serial.open', (devices, cid, path, generation) => devices.openPort(cid, path, generation)),
    handle('serial.configure', (devices, cid, line) => devices.configure(cid, line)),
    handle('serial.write', (devices, cid, bytes) => devices.write(cid, bytes)),
    handle('serial.close', (devices, cid) => devices.closePort(cid)),
    handle('serial.list', (devices) => devices.list()),
  ];
  return () => stops.forEach((stop) => stop());
}
