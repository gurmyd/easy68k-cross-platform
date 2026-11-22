// DesktopSerial: the original's TsimIO serial rules in the page, against a scripted main process.
// The main process's ports (desktop/src/serial.ts) are tested in desktop-main.test.ts with
// serialport's mock binding and, inside Electron against a pseudo-terminal, in
// tests/desktop/dev/dv4-serial.spec.ts.

import { describe, expect, it } from 'vitest';
import type { DesktopDeviceBridge } from '../../../contracts';
import { encode } from '../../codec/cp1252';
import { BAUD_RATES, DesktopSerial, devicePathOf, lineSettingsOf } from './desktop';
import { NullSerial } from './null';

type Handler = (...args: unknown[]) => unknown;

class FakeMain implements DesktopDeviceBridge {
  readonly calls: { channel: string; args: unknown[] }[] = [];
  readonly handlers: Record<string, Handler> = {
    'serial.open': () => true,
    'serial.configure': () => true,
    'serial.write': (_cid, bytes) => ({ sent: (bytes as Uint8Array).length }),
    'serial.close': () => true,
  };
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  request(channel: string, ...args: unknown[]): unknown {
    this.calls.push({ channel, args });
    return this.handlers[channel]?.(...args);
  }
  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);
    return () => set.delete(listener);
  }
  push(channel: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(channel) ?? []) listener(...args);
  }
}

const ascii = (text: string) => encode(text).bytes;
const MAP = { COM4: '/dev/ttys004', COM5: '/dev/cu.usbserial-1' };

function setup(main = new FakeMain(), map: Record<string, string> = MAP) {
  return { main, serial: new DesktopSerial({ bridge: main, portMap: () => map }) };
}

describe('task 41 settings word', () => {
  it('decodes baud, parity, data bits and stop bits as simIOu.cpp:2141-2240 does', () => {
    expect(lineSettingsOf(0)).toEqual({ baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1 });
    expect(lineSettingsOf(12 | (2 << 8) | (1 << 10) | (1 << 12))).toEqual({
      baudRate: 115200,
      parity: 'even',
      dataBits: 7,
      stopBits: 2,
    });
    expect(lineSettingsOf(1 | (3 << 8) | (2 << 10))).toEqual({
      baudRate: 110,
      parity: 'mark',
      dataBits: 6,
      stopBits: 1,
    });
    // Data bits 3 is 8 (the default case); bits 31..13 are ignored.
    expect(lineSettingsOf(14 | (3 << 10) | 0xffffe000)).toMatchObject({ baudRate: 256000, dataBits: 8 });
    expect(BAUD_RATES).toHaveLength(15);
    // 15 to 255: no case in the original, the port keeps its settings.
    expect(lineSettingsOf(15)).toBeNull();
    expect(lineSettingsOf(255)).toBeNull();
  });
});

describe('port names', () => {
  it('maps COMn through AppSettings.serialPortMap, ignoring letter case; unmapped names have no path', () => {
    expect(devicePathOf('COM4', MAP)).toBe('/dev/ttys004');
    expect(devicePathOf('com5', MAP)).toBe('/dev/cu.usbserial-1');
    expect(devicePathOf('COM6', MAP)).toBeNull();
    expect(devicePathOf('', MAP)).toBeNull();
    expect(devicePathOf('COM7', { COM7: '' })).toBeNull();
  });
});

describe('DesktopSerial', () => {
  it('a CID outside 0..15 gives 1 for every task (-1 for the read), before any bridge call', () => {
    const { main, serial } = setup();
    const nul = new NullSerial();
    for (const cid of [-1, 16, 0x8000, -32768]) {
      expect(serial.initComm(cid, ascii('COM4'))).toBe(nul.initComm(cid, ascii('COM4')));
      expect(serial.setCommParams(cid, 0)).toBe(1);
      expect(serial.commRead(cid, 4)).toBe(-1);
      expect(serial.sendComm(cid, ascii('x'))).toEqual({ result: 1 });
    }
    expect(main.calls).toEqual([]);
  });

  it('tasks 41-43 on a port that is not open give 3 (-3 for the read), as NullSerial', () => {
    const { serial } = setup();
    expect(serial.setCommParams(0, 0)).toBe(3);
    expect(serial.commRead(0, 4)).toBe(-3);
    expect(serial.sendComm(0, ascii('x'))).toEqual({ result: 3 });
  });

  it('task 40: an unmapped name or a device that cannot be opened gives 2', () => {
    const main = new FakeMain();
    main.handlers['serial.open'] = () => false;
    const { serial } = setup(main);
    expect(serial.initComm(0, ascii('COM9'))).toBe(2);
    expect(main.calls).toEqual([]);
    expect(serial.initComm(0, ascii('COM4'))).toBe(2);
    expect(serial.setCommParams(0, 0)).toBe(3);
  });

  it('task 40 opens the mapped device and applies 9600,N,8,1; task 41 applies its word', () => {
    const { main, serial } = setup();
    expect(serial.initComm(3, ascii('COM4'))).toBe(0);
    expect(main.calls).toEqual([
      { channel: 'serial.open', args: [3, '/dev/ttys004', 1] },
      { channel: 'serial.configure', args: [3, { baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1 }] },
    ]);
    expect(serial.setCommParams(3, 8 | (1 << 8))).toBe(0);
    expect(main.calls.at(-1)?.args[1]).toEqual({ baudRate: 19200, parity: 'odd', dataBits: 8, stopBits: 1 });
    // An index without a case: 0, and nothing changes.
    const count = main.calls.length;
    expect(serial.setCommParams(3, 99)).toBe(0);
    expect(main.calls.length).toBe(count);
    // Settings the device refuses: 2 (SetCommState failed).
    main.handlers['serial.configure'] = () => false;
    expect(serial.setCommParams(3, 1 | (3 << 8))).toBe(2);
  });

  it('task 40 on an open CID closes the port first', () => {
    const { main, serial } = setup();
    serial.initComm(0, ascii('COM4'));
    serial.initComm(0, ascii('COM5'));
    expect(main.calls.map((call) => call.channel)).toEqual([
      'serial.open',
      'serial.configure',
      'serial.close',
      'serial.open',
      'serial.configure',
    ]);
    expect(main.calls[3]?.args).toEqual([0, '/dev/cu.usbserial-1', 2]);
  });

  it('task 42 reads what has arrived from the page-side buffer, with no bridge call', () => {
    const { main, serial } = setup();
    serial.initComm(0, ascii('COM4'));
    const calls = main.calls.length;
    expect(Array.from(serial.commRead(0, 4) as Uint8Array)).toEqual([]);
    main.push('serial.data', 0, 1, ascii('AB'));
    main.push('serial.data', 0, 1, ascii('CDEF'));
    expect(String.fromCharCode(...(serial.commRead(0, 3) as Uint8Array))).toBe('ABC');
    expect(String.fromCharCode(...(serial.commRead(0, 255) as Uint8Array))).toBe('DEF');
    expect(main.calls.length).toBe(calls);
  });

  it('events of an earlier open of the CID, or of another CID, are not mixed in', () => {
    const { main, serial } = setup();
    serial.initComm(0, ascii('COM4')); // generation 1
    serial.initComm(0, ascii('COM4')); // generation 2
    serial.initComm(1, ascii('COM5')); // generation 3
    main.push('serial.data', 0, 1, ascii('old'));
    main.push('serial.data', 0, 2, ascii('new'));
    main.push('serial.data', 1, 3, ascii('one'));
    expect(String.fromCharCode(...(serial.commRead(0, 10) as Uint8Array))).toBe('new');
    expect(String.fromCharCode(...(serial.commRead(1, 10) as Uint8Array))).toBe('one');
  });

  it('task 43 sends through the main process; fewer bytes sent is 4, a failed write is 2', () => {
    const { main, serial } = setup();
    serial.initComm(0, ascii('COM4'));
    expect(serial.sendComm(0, ascii('PING'))).toEqual({ result: 0, sent: 4 });
    expect(Array.from(main.calls.at(-1)?.args[1] as Uint8Array)).toEqual(Array.from(ascii('PING')));
    main.handlers['serial.write'] = () => ({ sent: 2 });
    expect(serial.sendComm(0, ascii('PING'))).toEqual({ result: 4, sent: 2 });
    main.handlers['serial.write'] = () => false;
    expect(serial.sendComm(0, ascii('PING'))).toEqual({ result: 2 });
  });

  it('a port that failed (the device went away) gives 2 for 41-43 and -2 for the read', () => {
    const { main, serial } = setup();
    serial.initComm(0, ascii('COM4'));
    main.push('serial.error', 0, 1);
    expect(serial.commRead(0, 1)).toBe(-2);
    expect(serial.sendComm(0, ascii('x'))).toEqual({ result: 2 });
    expect(serial.setCommParams(0, 0)).toBe(2);
    // Task 40 again opens it afresh.
    expect(serial.initComm(0, ascii('COM4'))).toBe(0);
    expect(serial.commRead(0, 1)).toEqual(new Uint8Array(0));
  });

  it('the cold start closes every port; nothing else does', () => {
    const { main, serial } = setup();
    serial.initComm(0, ascii('COM4'));
    serial.initComm(7, ascii('COM5'));
    expect(serial.state.map((port) => port.cid)).toEqual([0, 7]);
    serial.resetToStartup();
    expect(main.calls.filter((call) => call.channel === 'serial.close').map((call) => call.args)).toEqual([[0], [7]]);
    expect(serial.sendComm(0, ascii('x'))).toEqual({ result: 3 });
    expect(serial.state).toEqual([]);
  });

  it('without a main process (no handler answers) task 40 gives 2, as in a browser', () => {
    const main = new FakeMain();
    for (const key of Object.keys(main.handlers)) delete main.handlers[key];
    const { serial } = setup(main);
    expect(serial.initComm(0, ascii('COM4'))).toBe(2);
    expect(serial.sendComm(0, ascii('x'))).toEqual({ result: 3 });
  });
});
