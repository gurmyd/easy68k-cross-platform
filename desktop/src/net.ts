// The network sockets of the desktop app's windows (ARCHITECTURE.md 3.3.4, 7.6), on Node's `dgram`
// and `net`, in the main process.
//
// The original's model (Net.cpp: one socket per simulator, its `mode`, `type`, `bound` and
// `remote`, the result codes) lives in the page, in app/src/core/sim-host/net/desktop.ts. This file
// only owns the real sockets and answers the page's synchronous device calls:
//
//   net.open(kind)                         'udp' | 'tcp' -> socket id
//   net.bind(id, port)                     null, or the POSIX error name (EADDRINUSE ...)
//   net.connect(id, address, port, waitMs) { state: 'connected' | 'pending' } | { error }
//   net.send(id, address, port, bytes)     { sent } | { error }   (TCP: address and port null)
//   net.close(id)                          true
//   net.lookup(name)                       the dotted IPv4 address, or null
//   net.localIp()                          the first non-internal IPv4 address, or 127.0.0.1
//
// Received data goes to the page as events, so that a receive needs no bridge call:
//
//   net.data(id, bytes, address, port)     a datagram (UDP) or a piece of the stream (TCP)
//   net.accepted(id, address, port)        the one client of a TCP server
//   net.end(id)                            the TCP peer closed its side
//   net.error(id, code)                    the TCP connection failed after it was made
//
// Every window has its own sockets (3.8.6, 7.6): they are closed when its page navigates or
// reloads and when the window closes.
//
// Owner: DV4.

import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { lookup as dnsLookup } from 'node:dns';
import { createServer, connect as tcpConnect, isIPv4, type Server, type Socket as TcpSocket } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import type { WebContents } from 'electron';
import { registerDeviceHandler, sendDeviceEvent } from './sync-ipc';

/** One step of the original's connect loop (Net.cpp:209, `Sleep(500)`). */
export const CONNECT_STEP_MS = 500;
/** The most a page may ask the main process to wait for a connection (the original's 5000 ms). */
export const CONNECT_MAX_WAIT_MS = 5000;
/** The most bytes one send carries: the 16-bit count of tasks 102 and 106. */
export const MAX_SEND_BYTES = 0xffff;

export type NetEmit = (channel: string, ...args: unknown[]) => void;
export type ConnectReply = { state: 'connected' | 'pending' } | { error: string };
export type SendReply = { sent: number } | { error: string };

interface UdpRecord {
  kind: 'udp';
  socket: UdpSocket;
}
interface TcpRecord {
  kind: 'tcp';
  server: Server | null;
  conn: TcpSocket | null;
  connected: boolean;
  /** A connect that failed before it was made, kept until the page asks (net.connect). */
  connectError: string | null;
  /** The connection failed after it was made; reported once as net.error. */
  failed: string | null;
}
type SocketRecord = UdpRecord | TcpRecord;

/** The error name of a Node error (`ECONNREFUSED`), or a stand-in for one without a code. */
export function errorName(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return 'ENETDOWN';
  // Node's own argument errors for what Winsock reports as an address that is not available.
  if (code === 'ERR_SOCKET_BAD_PORT' || code === 'ERR_INVALID_ARG_VALUE') return 'EADDRNOTAVAIL';
  if (code === 'ERR_SOCKET_DGRAM_NOT_RUNNING' || code === 'ERR_SOCKET_CLOSED') return 'ENOTSOCK';
  if (code === 'ERR_STREAM_DESTROYED' || code === 'ERR_STREAM_WRITE_AFTER_END') return 'ECONNRESET';
  return code;
}

/** The first non-internal IPv4 address of the machine, else 127.0.0.1 (task 105). */
export function localIPv4(interfaces = networkInterfaces()): string {
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isIPv4(entry.address)) return entry.address;
    }
  }
  return '127.0.0.1';
}

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The sockets of one window. Plain Node: tests/desktop/dev and the unit tests use it directly. */
export class NetDevices {
  private readonly sockets = new Map<number, SocketRecord>();
  private nextId = 1;

  constructor(private readonly emit: NetEmit) {}

  /** The number of open sockets (tests). */
  get size(): number {
    return this.sockets.size;
  }

  open(kind: unknown): number | null {
    if (kind !== 'udp' && kind !== 'tcp') return null;
    const id = this.nextId++;
    if (kind === 'udp') {
      const socket = createSocket({ type: 'udp4' });
      socket.on('message', (message, info) => {
        if (this.sockets.get(id)?.kind === 'udp') {
          this.emit('net.data', id, new Uint8Array(message), info.address, info.port);
        }
      });
      // Errors of a datagram socket are reported to the send or bind that caused them.
      socket.on('error', () => {});
      this.sockets.set(id, { kind: 'udp', socket });
    } else {
      this.sockets.set(id, {
        kind: 'tcp',
        server: null,
        conn: null,
        connected: false,
        connectError: null,
        failed: null,
      });
    }
    return id;
  }

  /** bind() to every local address on `port` (task 101). TCP also listens: Node cannot bind alone. */
  bind(id: unknown, port: unknown): Promise<string | null> {
    const record = this.record(id);
    if (!record || !isPort(port)) return Promise.resolve('EINVAL');
    if (record.kind === 'udp') {
      return new Promise((resolve) => {
        const onError = (error: unknown) => {
          record.socket.off('listening', onListening);
          resolve(errorName(error));
        };
        const onListening = () => {
          record.socket.off('error', onError);
          resolve(null);
        };
        record.socket.once('error', onError);
        record.socket.once('listening', onListening);
        try {
          record.socket.bind({ port, address: '0.0.0.0', exclusive: true });
        } catch (error) {
          record.socket.off('error', onError);
          record.socket.off('listening', onListening);
          resolve(errorName(error));
        }
      });
    }
    if (record.server || record.conn) return Promise.resolve('EINVAL');
    const server = createServer({ allowHalfOpen: true });
    record.server = server;
    // An error after listening has nobody to tell; an unhandled 'error' would end the main process.
    server.on('error', () => {});
    server.on('connection', (conn) => {
      // Exactly one client is ever accepted; the listening socket is then closed (§12.2, task 101).
      if (record.conn || this.sockets.get(id as number) !== record) {
        conn.destroy();
        return;
      }
      record.conn = conn;
      record.connected = true;
      server.close();
      record.server = null;
      this.watchConnection(id as number, record, conn);
      this.emit('net.accepted', id, conn.remoteAddress ?? '0.0.0.0', conn.remotePort ?? 0);
    });
    return new Promise((resolve) => {
      server.once('error', (error) => {
        record.server = null;
        resolve(errorName(error));
      });
      server.listen({ port, host: '0.0.0.0', exclusive: true }, () => resolve(null));
    });
  }

  /**
   * One round of the original's connect loop. The first call starts the connection; `waitMs` 0
   * answers at once (the retry inside tasks 102 and 106), otherwise the answer comes at the first
   * 500 ms step at which the connection is made or has failed, and after `waitMs` the connection is
   * still pending (Net.cpp:195-216: checks after the sleeps, none after the last one).
   */
  async connect(id: unknown, address: unknown, port: unknown, waitMs: unknown): Promise<ConnectReply> {
    const record = this.record(id);
    if (!record || record.kind !== 'tcp' || typeof address !== 'string' || !isIPv4(address) || !isPort(port)) {
      return { error: 'EINVAL' };
    }
    if (record.server) return { error: 'EINVAL' }; // a listening socket does not connect
    const wait =
      typeof waitMs === 'number' && Number.isFinite(waitMs) ? Math.max(0, Math.min(waitMs, CONNECT_MAX_WAIT_MS)) : 0;
    if (!record.conn) this.startConnect(id as number, record, address, port);
    const now = (): ConnectReply | null => {
      if (record.connected) return { state: 'connected' };
      if (record.connectError !== null) {
        const error = record.connectError;
        // The next attempt starts afresh, as a new connect() on the socket would.
        record.connectError = null;
        record.conn = null;
        return { error };
      }
      return null;
    };
    const steps = Math.floor(wait / CONNECT_STEP_MS);
    if (steps === 0) return now() ?? { state: 'pending' };
    for (let step = 1; step <= steps; step++) {
      await delay(CONNECT_STEP_MS);
      if (this.sockets.get(id as number) !== record) return { error: 'ENOTSOCK' };
      if (step < steps) {
        const reply = now();
        if (reply) return reply;
      }
    }
    return { state: 'pending' };
  }

  /** sendto(): a datagram to `address:port` (UDP), or the bytes on the connection (TCP). */
  send(id: unknown, address: unknown, port: unknown, bytes: unknown): Promise<SendReply> {
    const record = this.record(id);
    if (!record) return Promise.resolve({ error: 'ENOTSOCK' });
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_SEND_BYTES) return Promise.resolve({ error: 'EINVAL' });
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
    if (record.kind === 'udp') {
      if (typeof address !== 'string' || !isIPv4(address) || !isPort(port) || port === 0) {
        return Promise.resolve({ error: 'EADDRNOTAVAIL' });
      }
      return new Promise((resolve) => {
        try {
          record.socket.send(data, port, address, (error, sent) =>
            resolve(error ? { error: errorName(error) } : { sent: sent ?? data.length }),
          );
        } catch (error) {
          resolve({ error: errorName(error) });
        }
      });
    }
    const conn = record.conn;
    if (!conn || !record.connected) return Promise.resolve({ error: 'ENOTCONN' });
    if (record.failed !== null) return Promise.resolve({ error: record.failed });
    if (conn.destroyed || !conn.writable) return Promise.resolve({ error: 'ECONNRESET' });
    return new Promise((resolve) => {
      try {
        conn.write(data, (error) => resolve(error ? { error: errorName(error) } : { sent: data.length }));
      } catch (error) {
        resolve({ error: errorName(error) });
      }
    });
  }

  close(id: unknown): boolean {
    const record = this.record(id);
    if (!record) return false;
    this.sockets.delete(id as number);
    closeRecord(record);
    return true;
  }

  closeAll(): void {
    for (const record of this.sockets.values()) closeRecord(record);
    this.sockets.clear();
  }

  /** gethostbyname: the first IPv4 address of `name` (the machine's own name for an empty one). */
  lookup(name: unknown): Promise<string | null> {
    if (typeof name !== 'string' || name.length > 255) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        dnsLookup(name === '' ? hostname() : name, { family: 4 }, (error, address) =>
          resolve(error || typeof address !== 'string' ? null : address),
        );
      } catch {
        resolve(null);
      }
    });
  }

  localIp(): string {
    try {
      return localIPv4();
    } catch {
      return '127.0.0.1';
    }
  }

  /* ---------------------------------------------------------------- internals */

  private record(id: unknown): SocketRecord | null {
    return typeof id === 'number' ? (this.sockets.get(id) ?? null) : null;
  }

  private startConnect(id: number, record: TcpRecord, address: string, port: number): void {
    const conn = tcpConnect({ host: address, port, allowHalfOpen: true });
    record.conn = conn;
    record.connected = false;
    record.connectError = null;
    conn.once('connect', () => {
      if (record.conn !== conn) return;
      record.connected = true;
    });
    conn.on('error', (error) => {
      if (record.conn !== conn) return;
      if (!record.connected) record.connectError = errorName(error);
    });
    this.watchConnection(id, record, conn);
  }

  /** Data, end and errors of a TCP connection go to the page as events. */
  private watchConnection(id: number, record: TcpRecord, conn: TcpSocket): void {
    conn.on('data', (chunk: Buffer) => {
      if (this.sockets.get(id) === record && record.conn === conn) {
        this.emit('net.data', id, new Uint8Array(chunk), null, null);
      }
    });
    conn.on('end', () => {
      if (this.sockets.get(id) === record && record.conn === conn) this.emit('net.end', id);
    });
    conn.on('error', (error) => {
      if (this.sockets.get(id) !== record || record.conn !== conn || !record.connected) return;
      if (record.failed === null) {
        record.failed = errorName(error);
        this.emit('net.error', id, record.failed);
      }
    });
  }
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function closeRecord(record: SocketRecord): void {
  try {
    if (record.kind === 'udp') record.socket.close();
    else {
      record.server?.close();
      record.conn?.destroy();
      record.server = null;
      record.conn = null;
    }
  } catch {
    // already closed
  }
}

/* ------------------------------------------------------------------ registration */

/** Counts of the device calls per channel, for tests/desktop/dev (installed in test mode only). */
export interface DeviceCallCounts {
  counts: Record<string, number>;
}

/** The device call counter of test mode, shared by net.ts and serial.ts. */
export function deviceTestHooks(testMode: boolean): DeviceCallCounts | null {
  if (!testMode) return null;
  const global = globalThis as Record<string, unknown>;
  const existing = global['__easy68kDevicesTest'] as DeviceCallCounts | undefined;
  if (existing) return existing;
  const hooks: DeviceCallCounts = { counts: {} };
  global['__easy68kDevicesTest'] = hooks;
  return hooks;
}

/**
 * The devices of each window, created at its first device call and closed when its page navigates
 * (a reload starts a new page with a new simulator) or the window goes.
 */
export class PerWindow<T> {
  private readonly devices = new Map<number, T>();

  constructor(
    private readonly create: (sender: WebContents) => T,
    private readonly dispose: (devices: T) => void,
  ) {}

  of(sender: WebContents): T {
    const known = this.devices.get(sender.id);
    if (known) return known;
    const devices = this.create(sender);
    this.devices.set(sender.id, devices);
    const id = sender.id;
    const end = () => {
      const current = this.devices.get(id);
      if (current !== devices) return;
      this.devices.delete(id);
      sender.off('did-start-navigation', onNavigation);
      this.dispose(devices);
    };
    const onNavigation = (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
      if (details?.isMainFrame && !details.isSameDocument) end();
    };
    sender.once('destroyed', end);
    sender.on('did-start-navigation', onNavigation);
    return devices;
  }

  /** Every window's devices (tests). */
  all(): T[] {
    return [...this.devices.values()];
  }
}

export interface DeviceRegistrationOptions {
  /** EASY68K_DESKTOP_TEST_WINDOWS is set (never in a packaged app): count the calls for the tests. */
  testMode: boolean;
}

/** Registers the net.* device channels (desktop/src/main.ts calls it once). */
export function registerNetDevices(options: DeviceRegistrationOptions): () => void {
  const hooks = deviceTestHooks(options.testMode);
  const windows = new PerWindow<NetDevices>(
    (sender) => new NetDevices((channel, ...args) => sendDeviceEvent(sender, channel, ...args)),
    (devices) => devices.closeAll(),
  );
  const handle = (channel: string, run: (devices: NetDevices, ...args: unknown[]) => unknown) =>
    registerDeviceHandler(channel, (sender, ...args) => {
      if (hooks) hooks.counts[channel] = (hooks.counts[channel] ?? 0) + 1;
      return run(windows.of(sender), ...args);
    });
  const stops = [
    handle('net.open', (devices, kind) => devices.open(kind)),
    handle('net.bind', (devices, id, port) => devices.bind(id, port)),
    handle('net.connect', (devices, id, address, port, waitMs) => devices.connect(id, address, port, waitMs)),
    handle('net.send', (devices, id, address, port, bytes) => devices.send(id, address, port, bytes)),
    handle('net.close', (devices, id) => devices.close(id)),
    handle('net.lookup', (devices, name) => devices.lookup(name)),
    handle('net.localIp', (devices) => devices.localIp()),
  ];
  return () => stops.forEach((stop) => stop());
}
