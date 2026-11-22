// The Serial Ports dialog's model, and the feature module under a test application.

import { describe, expect, it } from 'vitest';
import type { DesktopDeviceBridge } from '../../contracts';
import { createTestApplication } from '../../state/testing';
import { feature, SERIAL_PORTS_DIALOG_ID } from './index';
import {
  comNumber,
  detectedLabel,
  detectedPorts,
  deviceBridgeOf,
  mapFromRows,
  nextPortName,
  rowProblemDetails,
  rowProblems,
  rowsFromMap,
} from './model';

describe('rows of AppSettings.serialPortMap', () => {
  it('sorts COM names by number, then the other names', () => {
    expect(rowsFromMap({ COM10: '/dev/b', tty: '/dev/t', COM2: '/dev/a', Aux: '/dev/x' })).toEqual([
      { name: 'COM2', device: '/dev/a' },
      { name: 'COM10', device: '/dev/b' },
      { name: 'Aux', device: '/dev/x' },
      { name: 'tty', device: '/dev/t' },
    ]);
    expect(comNumber('com7')).toBe(7);
    expect(comNumber('COM0')).toBeNull();
    expect(comNumber('COMX')).toBeNull();
  });

  it('finds empty names and devices and names used twice (in any letter case)', () => {
    const rows = [
      { name: 'COM1', device: '/dev/a' },
      { name: '', device: '/dev/b' },
      { name: 'com1', device: '/dev/c' },
      { name: 'COM3', device: '  ' },
    ];
    expect(rowProblems(rows)).toEqual([
      null,
      'Enter a port name, such as COM1.',
      'com1 is in the list twice.',
      'Enter the device for COM3, such as /dev/cu.usbserial-1.',
    ]);
    // The dialog marks the field the problem is in: a name problem is never shown on the device.
    expect(rowProblemDetails(rows).map((problem) => problem?.field ?? null)).toEqual([null, 'name', 'name', 'device']);
    expect(rowProblemDetails([{ name: 'X'.repeat(256), device: '/dev/a' }])[0]?.field).toBe('name');
    expect(rowProblemDetails([{ name: 'COM1', device: 'x'.repeat(1025) }])[0]?.field).toBe('device');
    expect(mapFromRows(rows)).toBeNull();
    expect(mapFromRows([{ name: ' COM4 ', device: ' /dev/ttys004 ' }])).toEqual({ COM4: '/dev/ttys004' });
    expect(mapFromRows([])).toEqual({});
  });

  it('offers the first free COM name for a new row', () => {
    expect(nextPortName([])).toBe('COM1');
    expect(
      nextPortName([
        { name: 'COM1', device: '' },
        { name: 'com3', device: '' },
      ]),
    ).toBe('COM2');
  });
});

describe('devices the main process lists', () => {
  const bridge = (reply: unknown): DesktopDeviceBridge => ({ request: () => reply, on: () => () => {} });

  it('keeps entries with a path; a browser or a failing call lists none', () => {
    expect(
      detectedPorts(
        bridge([
          { path: '/dev/cu.usbserial-1', manufacturer: 'FTDI', serialNumber: 'A1' },
          { path: '' },
          null,
          { path: 7 },
        ]),
      ),
    ).toEqual([{ path: '/dev/cu.usbserial-1', manufacturer: 'FTDI', serialNumber: 'A1' }]);
    expect(detectedPorts(bridge(undefined))).toEqual([]);
    expect(detectedPorts(null)).toEqual([]);
    expect(
      detectedPorts({
        request: () => {
          throw new Error('gone');
        },
        on: () => () => {},
      }),
    ).toEqual([]);
    expect(detectedLabel({ path: '/dev/x', manufacturer: 'FTDI' })).toBe('/dev/x  (FTDI)');
    expect(detectedLabel({ path: '/dev/x' })).toBe('/dev/x');
  });

  it('finds the bridge of the desktop platform and none on the web', () => {
    const devices = bridge([]);
    expect(deviceBridgeOf({ deviceBridge: devices })).toBe(devices);
    expect(deviceBridgeOf({ kind: 'web' })).toBeNull();
    expect(deviceBridgeOf(null)).toBeNull();
  });
});

describe('the feature module', () => {
  it('registers the dialog; the application builds with it', async () => {
    expect(Object.keys(feature.dialogs ?? {})).toEqual([SERIAL_PORTS_DIALOG_ID]);
    const app = await createTestApplication({ features: [feature] });
    expect(app).toBeTruthy();
  }, 60_000);
});
