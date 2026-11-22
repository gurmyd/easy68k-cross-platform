// The main process's serial ports (desktop/src/serial.ts, DV4) under plain Node, on a stand-in for
// the `serialport` package (unit tests may not import it, 3.1): open, exclusive use, the line
// settings, writes, received data as events, close. The real package and its native module are
// used inside Electron against a pseudo-terminal in tests/desktop/dev/dv4-serial.spec.ts.

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
import { SerialDevices, type SerialPortModule } from '../../../../../desktop/src/serial';

interface Options {
  path: string;
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
  lock: boolean;
}

/** Devices that exist; `echo` sends back what is written. */
let devicesOnSystem: Map<string, { echo: boolean; lockedBy: FakePort | null; written: number[] }>;
let opened: Options[];

class FakePort extends EventEmitter {
  isOpen = false;
  constructor(readonly options: Options) {
    super();
  }
  open(callback: (error: Error | null) => void): void {
    const device = devicesOnSystem.get(this.options.path);
    setTimeout(() => {
      if (!device) return callback(Object.assign(new Error('No such file or directory'), { code: 'ENOENT' }));
      if (device.lockedBy && this.options.lock) return callback(new Error('Resource temporarily unavailable'));
      device.lockedBy = this;
      this.isOpen = true;
      opened.push({ ...this.options });
      callback(null);
    }, 1);
  }
  write(data: Buffer, callback: (error: Error | null) => void): void {
    const device = devicesOnSystem.get(this.options.path);
    if (!this.isOpen || !device) return callback(new Error('Port is not open'));
    device.written.push(...data);
    setTimeout(() => {
      callback(null);
      if (device.echo) this.emit('data', Buffer.from(data));
    }, 1);
  }
  update(options: { baudRate: number }, callback: (error: Error | null) => void): void {
    this.options.baudRate = options.baudRate;
    callback(null);
  }
  close(callback: () => void): void {
    const device = devicesOnSystem.get(this.options.path);
    if (device?.lockedBy === this) device.lockedBy = null;
    this.isOpen = false;
    setTimeout(() => {
      this.emit('close');
      callback();
    }, 1);
  }
  static list() {
    return Promise.resolve([...devicesOnSystem.keys()].map((path) => ({ path, manufacturer: 'Fake' })));
  }
}
const fakeModule = { SerialPort: FakePort } as unknown as SerialPortModule;

let events: { channel: string; args: unknown[] }[];
let devices: SerialDevices;

beforeEach(() => {
  devicesOnSystem = new Map([
    ['/dev/ttyFAKE0', { echo: true, lockedBy: null, written: [] }],
    ['/dev/ttyFAKE1', { echo: false, lockedBy: null, written: [] }],
  ]);
  opened = [];
  events = [];
  devices = new SerialDevices(
    (channel, ...args) => events.push({ channel, args }),
    () => Promise.resolve(fakeModule),
  );
});

const waitFor = async (check: () => boolean, what: string) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 5));
  }
};

describe('SerialDevices (desktop/src/serial.ts)', () => {
  it('opens a device for exclusive use with 9600,N,8,1, writes, and reports arrivals with the generation', async () => {
    expect(await devices.openPort(0, '/dev/ttyFAKE0', 7)).toBe(true);
    expect(opened).toEqual([
      { path: '/dev/ttyFAKE0', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false, lock: true },
    ]);
    expect(devices.open).toEqual([0]);
    expect(await devices.write(0, new TextEncoder().encode('PING'))).toEqual({ sent: 4 });
    await waitFor(() => events.some((event) => event.channel === 'serial.data'), 'the echo');
    const data = events.find((event) => event.channel === 'serial.data');
    expect(data?.args.slice(0, 2)).toEqual([0, 7]);
    expect(new TextDecoder().decode(data?.args[2] as Uint8Array)).toBe('PING');
  });

  it('a device that does not exist, a bad CID or a bad path cannot be opened', async () => {
    expect(await devices.openPort(0, '/dev/does-not-exist', 1)).toBe(false);
    expect(await devices.openPort(16, '/dev/ttyFAKE0', 1)).toBe(false);
    expect(await devices.openPort(0, '', 1)).toBe(false);
    expect(devices.open).toEqual([]);
  });

  it('opening a CID again closes its first port; a device in use cannot be opened twice', async () => {
    expect(await devices.openPort(0, '/dev/ttyFAKE0', 1)).toBe(true);
    expect(await devices.openPort(1, '/dev/ttyFAKE0', 2)).toBe(false);
    expect(await devices.openPort(0, '/dev/ttyFAKE1', 3)).toBe(true);
    expect(await devices.openPort(1, '/dev/ttyFAKE0', 4)).toBe(true);
    // Closing ourselves is no device failure.
    expect(events.filter((event) => event.channel === 'serial.error')).toEqual([]);
  });

  it('configure: the same settings do nothing, a new baud rate is an update, other settings reopen', async () => {
    await devices.openPort(0, '/dev/ttyFAKE1', 1);
    const line = { baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1 } as const;
    expect(await devices.configure(0, line)).toBe(true);
    expect(await devices.configure(0, { ...line, baudRate: 19200 })).toBe(true);
    expect(opened).toHaveLength(1);
    expect(await devices.configure(0, { ...line, baudRate: 19200, parity: 'even', dataBits: 7 })).toBe(true);
    expect(opened.at(-1)).toMatchObject({ baudRate: 19200, parity: 'even', dataBits: 7, stopBits: 1 });
    expect(await devices.write(0, new Uint8Array([1, 2, 3]))).toEqual({ sent: 3 });
    expect(devicesOnSystem.get('/dev/ttyFAKE1')?.written).toEqual([1, 2, 3]);
    expect(await devices.configure(0, { baudRate: -1 })).toBe(false);
    expect(await devices.configure(5, line)).toBe(false);
    expect(events.filter((event) => event.channel === 'serial.error')).toEqual([]);
  });

  it('a device that goes away is reported as serial.error', async () => {
    await devices.openPort(2, '/dev/ttyFAKE1', 9);
    const port = [...devicesOnSystem.values()][1]?.lockedBy;
    port?.emit('close');
    expect(events).toContainEqual({ channel: 'serial.error', args: [2, 9] });
  });

  it('writes on a CID that is not open, or longer than 255 bytes, fail', async () => {
    expect(await devices.write(0, new Uint8Array(1))).toBe(false);
    await devices.openPort(0, '/dev/ttyFAKE1', 1);
    expect(await devices.write(0, new Uint8Array(256))).toBe(false);
    expect(await devices.write(0, new Uint8Array(0))).toEqual({ sent: 0 });
  });

  it('close and closeAll free the devices', async () => {
    await devices.openPort(0, '/dev/ttyFAKE0', 1);
    await devices.openPort(1, '/dev/ttyFAKE1', 2);
    expect(await devices.closePort(0)).toBe(true);
    expect(devices.open).toEqual([1]);
    devices.closeAll();
    expect(devices.open).toEqual([]);
    await waitFor(() => [...devicesOnSystem.values()].every((device) => device.lockedBy === null), 'the close');
  });

  it('lists the ports of the system', async () => {
    expect(await devices.list()).toEqual([
      { path: '/dev/ttyFAKE0', manufacturer: 'Fake' },
      { path: '/dev/ttyFAKE1', manufacturer: 'Fake' },
    ]);
  });

  it('a serialport that cannot be loaded makes every open fail, not the app', async () => {
    const broken = new SerialDevices(
      () => {},
      () => Promise.reject(new Error('no native module')),
    );
    expect(await broken.openPort(0, '/dev/ttyFAKE0', 1)).toBe(false);
    expect(await broken.list()).toEqual([]);
  });
});
