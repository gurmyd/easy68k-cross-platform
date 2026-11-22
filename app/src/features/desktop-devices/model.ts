// The model of the Serial Ports dialog (ARCHITECTURE.md 3.3.4): the rows of AppSettings.serialPortMap,
// one port name (`COM4`, what a program passes to task 40) to one device path (`/dev/cu.usbserial-1`).
// Plain functions, tested under Node (model.test.ts).
//
// Owner: DV4.

import type { DesktopDeviceBridge } from '../../contracts';

export interface PortRow {
  name: string;
  device: string;
}

/** A device the main process found (`serial.list`). */
export interface DetectedPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}

/** The longest port name task 40 passes on (the original copies at most 255 characters). */
export const MAX_NAME_LENGTH = 255;
export const MAX_DEVICE_LENGTH = 1024;
/** The dialog offers the names COM1 ... COM<this> for new rows. */
export const MAX_COM = 256;

/** The number of a `COMn` name (any letter case), or null. */
export function comNumber(name: string): number | null {
  const match = /^COM([1-9][0-9]*)$/i.exec(name.trim());
  return match ? Number(match[1]) : null;
}

/** The rows of a map: COM names by number first, then other names alphabetically. */
export function rowsFromMap(map: Readonly<Record<string, string>>): PortRow[] {
  return Object.entries(map)
    .map(([name, device]) => ({ name, device: String(device) }))
    .sort((a, b) => {
      const na = comNumber(a.name);
      const nb = comNumber(b.name);
      if (na !== null && nb !== null) return na - nb;
      if (na !== null) return -1;
      if (nb !== null) return 1;
      return a.name.localeCompare(b.name, 'en');
    });
}

/** What is wrong with a row, and which of its two fields the problem is in. */
export interface RowProblem {
  field: 'name' | 'device';
  text: string;
}

/** What is wrong with each row and in which field (null when nothing is), in the order of `rows`. */
export function rowProblemDetails(rows: readonly PortRow[]): (RowProblem | null)[] {
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const key = row.name.trim().toUpperCase();
    if (key && !seen.has(key)) seen.set(key, index);
  });
  return rows.map((row, index): RowProblem | null => {
    const name = row.name.trim();
    if (name === '') return { field: 'name', text: 'Enter a port name, such as COM1.' };
    if (name.length > MAX_NAME_LENGTH) {
      return { field: 'name', text: `A port name has at most ${MAX_NAME_LENGTH} characters.` };
    }
    if (seen.get(name.toUpperCase()) !== index) return { field: 'name', text: `${name} is in the list twice.` };
    const device = row.device.trim();
    if (device === '') {
      return { field: 'device', text: `Enter the device for ${name}, such as /dev/cu.usbserial-1.` };
    }
    if (device.length > MAX_DEVICE_LENGTH) return { field: 'device', text: 'The device path is too long.' };
    return null;
  });
}

/** What is wrong with each row (null when nothing is), in the order of `rows`. */
export function rowProblems(rows: readonly PortRow[]): (string | null)[] {
  return rowProblemDetails(rows).map((problem) => problem?.text ?? null);
}

/** The map of valid rows (names and devices trimmed); null when a row has a problem. */
export function mapFromRows(rows: readonly PortRow[]): Record<string, string> | null {
  if (rowProblems(rows).some((problem) => problem !== null)) return null;
  const map: Record<string, string> = {};
  for (const row of rows) map[row.name.trim()] = row.device.trim();
  return map;
}

/** The first `COMn` no row uses. */
export function nextPortName(rows: readonly PortRow[]): string {
  const used = new Set(rows.map((row) => comNumber(row.name)).filter((n): n is number => n !== null));
  for (let n = 1; n <= MAX_COM; n++) if (!used.has(n)) return `COM${n}`;
  return '';
}

/** The devices the main process reports, or none (a browser, an older main process, an error). */
export function detectedPorts(bridge: DesktopDeviceBridge | null): DetectedPort[] {
  if (!bridge) return [];
  let reply: unknown;
  try {
    reply = bridge.request('serial.list');
  } catch {
    return [];
  }
  if (!Array.isArray(reply)) return [];
  const ports: DetectedPort[] = [];
  for (const entry of reply.slice(0, 256)) {
    const path = (entry as { path?: unknown } | null)?.path;
    if (typeof path !== 'string' || path === '') continue;
    const manufacturer = (entry as { manufacturer?: unknown }).manufacturer;
    const serialNumber = (entry as { serialNumber?: unknown }).serialNumber;
    ports.push({
      path,
      ...(typeof manufacturer === 'string' && manufacturer ? { manufacturer } : {}),
      ...(typeof serialNumber === 'string' && serialNumber ? { serialNumber } : {}),
    });
  }
  return ports;
}

/** The text of a detected device in the dialog's list. */
export function detectedLabel(port: DetectedPort): string {
  const extra = [port.manufacturer, port.serialNumber].filter(Boolean).join(', ');
  return extra ? `${port.path}  (${extra})` : port.path;
}

/**
 * The window's device bridge: DesktopPlatform.deviceBridge (platform/desktop.ts, DV2), which the
 * contract's Platform does not declare (docs/porting/errata/DV4.md, "Contract"); null on the web.
 */
export function deviceBridgeOf(platform: unknown): DesktopDeviceBridge | null {
  const bridge = (platform as { deviceBridge?: unknown } | null)?.deviceBridge as DesktopDeviceBridge | undefined;
  return bridge && typeof bridge.request === 'function' && typeof bridge.on === 'function' ? bridge : null;
}
