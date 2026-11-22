// Network of the desktop app (ARCHITECTURE.md 3.3.4; trap15-b §12), through the Electron main process.
//
// The model of the original's Net.cpp lives here, in the page, call for call: one socket for the
// whole simulator, the variables `mode`, `type`, `netInitialized`, `bound` and `remote`, Winsock's
// start-up count, and the result codes `(Winsock error << 16) + code`. The main process
// (desktop/src/net.ts) only owns the real sockets of this window and answers plain questions:
// open a socket, bind it, connect it, send, close, look up a name, name the local address.
//
// - Open, bind, connect, send, close, name lookup and local address are synchronous bridge calls
//   (DesktopDeviceBridge.request, one `ipcRenderer.sendSync`): the page waits for the answer, as
//   the original's window waits in the same Winsock calls.
// - Receives (tasks 103 and 107) are answered from a buffer in the page, which the events of the
//   main process fill as data arrives ('net.data', 'net.accepted', 'net.end', 'net.error'). A
//   polling loop makes no bridge call at all.
//
// The main process reports POSIX error names (`ECONNREFUSED`); WINSOCK_ERRORS below turns them into
// the Winsock numbers the original would report.
//
// Owner: W1 > DV4.

import type { Bytes, DesktopNetApi, DesktopNetDeps } from '../../../contracts';
import { decode } from '../../codec/cp1252';

export type { DesktopDeviceBridge, DesktopNetDeps } from '../../../contracts';

/* ------------------------------------------------------------------ result codes (Net.h:22-31) */

export const NET_OK = 0;
export const NET_ERROR = 1;
export const NET_INIT_FAILED = 2;
export const NET_INVALID_SOCKET = 3;
export const NET_BIND_FAILED = 5;
export const NET_DOMAIN_NOT_FOUND = 8;
/** The Winsock code the original puts into the high word for a TCP peer that closed. */
export const REMOTE_DISCONNECT = 0x2775;

/** Winsock error numbers the model uses itself. */
export const WSAEACCES = 10013;
export const WSAEINVAL = 10022;
export const WSAENOTSOCK = 10038;
export const WSAEMSGSIZE = 10040;
export const WSAEADDRNOTAVAIL = 10049;
export const WSAENETDOWN = 10050;
export const WSAENOTCONN = 10057;
export const WSASYSNOTREADY = 10091;
export const WSANOTINITIALISED = 10093;

/**
 * POSIX error names (as Node reports them in the main process) -> Winsock error numbers
 * (WSABASEERR 10000 + the BSD number, as winsock.h defines them). A name not in the table becomes
 * WSAENETDOWN.
 */
export const WINSOCK_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  EINTR: 10004,
  EBADF: 10009,
  EACCES: 10013,
  EPERM: 10013,
  EFAULT: 10014,
  EINVAL: 10022,
  EMFILE: 10024,
  EAGAIN: 10035,
  EWOULDBLOCK: 10035,
  EINPROGRESS: 10036,
  EALREADY: 10037,
  ENOTSOCK: 10038,
  EDESTADDRREQ: 10039,
  EMSGSIZE: 10040,
  EPROTOTYPE: 10041,
  ENOPROTOOPT: 10042,
  EPROTONOSUPPORT: 10043,
  EOPNOTSUPP: 10045,
  ENOTSUP: 10045,
  EAFNOSUPPORT: 10047,
  EADDRINUSE: 10048,
  EADDRNOTAVAIL: 10049,
  ENETDOWN: 10050,
  ENETUNREACH: 10051,
  ENETRESET: 10052,
  ECONNABORTED: 10053,
  ECONNRESET: 10054,
  // Winsock has no EPIPE: a send on a connection the peer has reset is WSAECONNRESET there.
  EPIPE: 10054,
  ENOBUFS: 10055,
  EISCONN: 10056,
  ENOTCONN: 10057,
  ESHUTDOWN: 10058,
  ETIMEDOUT: 10060,
  ECONNREFUSED: 10061,
  EHOSTDOWN: 10064,
  EHOSTUNREACH: 10065,
});

/** The Winsock number of a POSIX error name. */
export function winsockError(code: unknown): number {
  return (typeof code === 'string' && WINSOCK_ERRORS[code]) || WSAENETDOWN;
}

/** `(error << 16) + status`, as a 32-bit value for D0.L. */
export function netResult(error: number, status: number): number {
  return ((error << 16) + status) | 0;
}

/* ------------------------------------------------------------------ addresses */

/** INADDR_NONE: what inet_addr returns for a string that is no address (and for 255.255.255.255). */
export const INADDR_NONE = 0xffffffff;

/** One part of a dotted address as inet_addr reads it: decimal, octal (leading 0) or hex (0x). */
function parsePart(text: string): number | null {
  if (/^0[xX][0-9a-fA-F]*$/.test(text)) return text.length === 2 ? 0 : parseInt(text.slice(2), 16);
  if (/^0[0-7]*$/.test(text)) return parseInt(text, 8);
  if (/^[1-9][0-9]*$/.test(text)) return parseInt(text, 10);
  return null;
}

/**
 * Winsock's inet_addr: "a.b.c.d", "a.b.c" (c is 16 bits), "a.b" (b is 24 bits) or "a" (32 bits),
 * each part decimal, octal or hex; the text ends at its first space. Returns the address in host
 * order (a in the top byte), or INADDR_NONE when the text is no address. As in the original,
 * "255.255.255.255" gives INADDR_NONE too (trap15-b §12.2, task 100).
 */
export function inetAddr(text: string): number {
  const head = text.split(/[ \t\n\r]/, 1)[0] ?? '';
  if (head === '') return INADDR_NONE;
  const parts = head.split('.');
  if (parts.length > 4) return INADDR_NONE;
  const values: number[] = [];
  for (const part of parts) {
    const value = parsePart(part);
    if (value === null || !Number.isFinite(value)) return INADDR_NONE;
    values.push(value);
  }
  const last = values[values.length - 1] as number;
  const leading = values.slice(0, -1);
  if (leading.some((value) => value > 0xff)) return INADDR_NONE;
  const lastBits = 32 - 8 * leading.length;
  if (last >= 2 ** lastBits) return INADDR_NONE;
  let address = 0;
  for (const [index, value] of leading.entries()) address += value * 2 ** (24 - 8 * index);
  return (address + last) >>> 0;
}

/** inet_ntoa: the dotted form of a host-order address. */
export function inetNtoa(address: number): string {
  const a = address >>> 0;
  return `${a >>> 24}.${(a >>> 16) & 0xff}.${(a >>> 8) & 0xff}.${a & 0xff}`;
}

/** The two bytes of a 16-bit value exchanged: what `sin_port` holds for a port, and back. */
export function swap16(value: number): number {
  return ((value & 0xff) << 8) | ((value >>> 8) & 0xff);
}

/* ------------------------------------------------------------------ the model */

/** `mode` of Net.cpp. */
export const NetMode = { Uninitialized: 0, Server: 1, Client: 2 } as const;
export type NetMode = (typeof NetMode)[keyof typeof NetMode];
/** `type` of Net.cpp. */
export const NetType = { Unconnected: -1, Udp: 0, UnconnectedTcp: 2, ConnectedTcp: 3 } as const;
export type NetType = (typeof NetType)[keyof typeof NetType];

/** A datagram, or a piece of a TCP stream, the main process pushed. */
interface Arrival {
  bytes: Uint8Array;
  address: number;
  port: number;
}

/** What the page knows about the window's one socket in the main process. */
interface SocketState {
  id: number;
  kind: 'udp' | 'tcp';
  /** False after netCloseSockets: the handle the original keeps in `sock` is a closed one. */
  live: boolean;
  /** UDP: bound by task 101 or by a successful send (Winsock binds on the first sendto). */
  bound: boolean;
  datagrams: Arrival[];
  datagramBytes: number;
  stream: Uint8Array[];
  streamBytes: number;
  /** TCP server: the main process accepted the one client. */
  accepted: boolean;
  /** TCP: the peer closed its side (FIN). */
  ended: boolean;
  /** TCP: the connection failed after it was made (ECONNRESET and the like). */
  error: string | null;
}

/** At most this many bytes of datagrams wait in the page; later ones are dropped, as a full socket
 *  buffer drops them. */
export const UDP_BUFFER_LIMIT = 256 * 1024;
/** Steps of the original's connect loop (Net.cpp:195-216): 500 ms each, at most 5000 ms. */
export const CONNECT_WAIT_MS = 5000;

/** The reply of the main process to `net.connect`. */
export type ConnectReply = { state: 'connected' | 'pending' } | { error: string };
/** The reply of the main process to `net.send`. */
export type SendReply = { sent: number } | { error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class DesktopNet implements DesktopNetApi {
  /* Net.cpp's globals. */
  private mode: NetMode = NetMode.Uninitialized;
  private type: NetType = NetType.Unconnected;
  private netInitialized = false;
  private bound = false;
  /** `remote.sin_addr` (host order) and the port that `remote.sin_port` stands for (host order). */
  private remoteAddress = 0;
  private remotePort = 0;
  /** WSAStartup calls not yet matched by a WSACleanup. */
  private winsockStarted = 0;
  /** `sock`: null while no socket was ever made (the original's NULL). */
  private socket: SocketState | null = null;

  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: DesktopNetDeps) {}

  /** The model's variables, for tests and for diagnosing a program (read only). */
  get state(): {
    mode: NetMode;
    type: NetType;
    netInitialized: boolean;
    bound: boolean;
    remote: string;
    remotePort: number;
    winsockStarted: number;
    socket: { id: number; kind: 'udp' | 'tcp'; live: boolean; waiting: number } | null;
  } {
    const socket = this.socket;
    return {
      mode: this.mode,
      type: this.type,
      netInitialized: this.netInitialized,
      bound: this.bound,
      remote: inetNtoa(this.remoteAddress),
      remotePort: this.remotePort,
      winsockStarted: this.winsockStarted,
      socket: socket && {
        id: socket.id,
        kind: socket.kind,
        live: socket.live,
        waiting: socket.datagramBytes + socket.streamBytes,
      },
    };
  }

  /* ---------------------------------------------------------------- HostNet */

  createNetClient(settings: number, server: Bytes, serverAddress?: number): number {
    const protocol = settings & 0xff;
    const port = (settings >>> 16) & 0xffff;
    const status = this.netInit(port, protocol);
    if (status !== NET_OK) return status;

    const name = decode(server);
    // Net.cpp:173 assigns `remote.sin_addr.s_addr = inet_addr(server)` before it looks the
    // name up, so a name that is not a dotted quad leaves remote at INADDR_NONE
    // (255.255.255.255) even when the lookup then fails: a later send goes to broadcast.
    this.remoteAddress = inetAddr(name);
    if (this.remoteAddress === INADDR_NONE) {
      const found = this.request('net.lookup', name);
      if (typeof found !== 'string') return NET_DOMAIN_NOT_FOUND;
      // Any answer of gethostbyname is success, 255.255.255.255 included (Net.cpp:174-185
      // has no further check): inet_addr of it is INADDR_NONE again, which is what remote holds.
      this.remoteAddress = inetAddr(found);
      // strncpy(server, inet_ntoa(remote.sin_addr), 16): exactly 16 bytes, zero padded.
      if (serverAddress !== undefined) this.writeString(serverAddress, inetNtoa(this.remoteAddress), 16);
    }
    this.mode = NetMode.Client;

    if (this.type === NetType.UnconnectedTcp) {
      const reply = this.connect(CONNECT_WAIT_MS);
      if ('error' in reply) return netResult(winsockError(reply.error), NET_ERROR);
      // 'pending': the 5000 ms ran out; the task still succeeds and later sends retry.
    }
    return NET_OK;
  }

  createNetServer(settings: number): number {
    const protocol = settings & 0xff;
    const port = (settings >>> 16) & 0xffff;
    const status = this.netInit(port, protocol);
    if (status !== NET_OK) return status;
    const socket = this.socket as SocketState;
    const reply = this.request('net.bind', socket.id, port);
    if (reply !== null) return netResult(winsockError(reply), NET_BIND_FAILED);
    socket.bound = true;
    this.bound = true;
    this.mode = NetMode.Server;
    return NET_OK;
  }

  sendNet(settings: number, dataAddress: number, remoteIP: Bytes): { result: number; count?: number } {
    const outcome = this.send(settings & 0xffff, dataAddress, remoteIP, null);
    return outcome.result === NET_OK ? { result: NET_OK, count: outcome.size } : { result: outcome.result };
  }

  receiveNet(settings: number, bufferAddress: number, senderIPAddress: number): { result: number; count?: number } {
    const outcome = this.receive(settings & 0xffff, bufferAddress, senderIPAddress);
    return outcome.result === NET_OK ? { result: NET_OK, count: outcome.size } : { result: outcome.result };
  }

  sendPortNet(d1: number, dataAddress: number, remoteIP: Bytes): { d0: number; d1?: number } {
    const size = d1 & 0xffff;
    const portNum = (d1 >>> 16) & 0xffff;
    const outcome = this.send(size, dataAddress, remoteIP, portNum);
    // `*D1 = size`: the port in the high word is cleared.
    return outcome.result === NET_OK ? { d0: NET_OK, d1: outcome.size } : { d0: outcome.result };
  }

  receivePortNet(d1: number, bufferAddress: number, senderIPAddress: number): { d0: number; d1?: number } {
    const outcome = this.receive(d1 & 0xffff, bufferAddress, senderIPAddress);
    if (outcome.result !== NET_OK) return { d0: outcome.result };
    // `port = remote.sin_port` without ntohs: the sender's port byte-swapped (Net.cpp:468). With
    // nothing received the original's port variable is uninitialised; the port returns 0 there.
    const portNum = outcome.size > 0 ? swap16(this.remotePort) : 0;
    return { d0: NET_OK, d1: (portNum << 16) | (outcome.size & 0xffff) | 0 };
  }

  closeNetConnection(_closeIP: number): number {
    return this.netCloseSockets();
  }

  getLocalIP(localIPAddress: number): number {
    // netLocalIP: gethostname and gethostbyname need Winsock started (task 100 or 101 first).
    if (this.winsockStarted === 0) return netResult(WSANOTINITIALISED, NET_ERROR);
    const found = this.request('net.localIp');
    const text = typeof found === 'string' && inetAddr(found) !== INADDR_NONE ? found : '127.0.0.1';
    // sprintf(localIP, "%d.%d.%d.%d", ...): the dotted string and its terminator.
    this.writeString(localIPAddress, text, text.length + 1);
    return NET_OK;
  }

  /** netCloseSockets (Net.cpp:478-499): at every simulator reset and for task 104. */
  netCloseSockets(): number {
    this.type = NetType.Unconnected;
    if (this.winsockStarted === 0) return netResult(WSANOTINITIALISED, NET_ERROR);
    const socket = this.socket;
    if (!socket || !socket.live) return netResult(WSAENOTSOCK, NET_ERROR);
    this.request('net.close', socket.id);
    socket.live = false;
    this.clearArrivals(socket);
    this.netInitialized = false;
    this.winsockStarted--;
    return NET_OK;
  }

  /** Cold start: the socket closed, every variable as at program start (trap15-b §12.1). */
  resetToStartup(): void {
    if (this.socket?.live) this.request('net.close', this.socket.id);
    this.socket = null;
    this.mode = NetMode.Uninitialized;
    this.type = NetType.Unconnected;
    this.netInitialized = false;
    this.bound = false;
    this.remoteAddress = 0;
    this.remotePort = 0;
    this.winsockStarted = 0;
  }

  /* ---------------------------------------------------------------- Net.cpp */

  /** netInit (Net.cpp:35-104). */
  private netInit(port: number, protocol: number): number {
    if (this.netInitialized) this.netCloseSockets();
    this.mode = NetMode.Uninitialized;
    this.winsockStarted++; // WSAStartup(1.1)
    if (protocol !== 0 && protocol !== 1) return NET_INIT_FAILED; // no WSACleanup: the leak of §12.3
    const kind = protocol === 0 ? 'udp' : 'tcp';
    const id = this.request('net.open', kind);
    if (typeof id !== 'number') {
      // No network in this window's main process: what a browser gets (note 37).
      this.winsockStarted--;
      return netResult(WSASYSNOTREADY, NET_INIT_FAILED);
    }
    this.subscribe();
    this.socket = {
      id,
      kind,
      live: true,
      bound: false,
      datagrams: [],
      datagramBytes: 0,
      stream: [],
      streamBytes: 0,
      accepted: false,
      ended: false,
      error: null,
    };
    this.type = protocol === 0 ? NetType.Udp : NetType.UnconnectedTcp;
    this.remotePort = port;
    this.netInitialized = true;
    return NET_OK;
  }

  /** One `connect` round of the original's loops, waiting at most `waitMs` in the main process. */
  private connect(waitMs: number): ConnectReply {
    const socket = this.socket as SocketState;
    // Winsock's connect() refuses a remote address that is not valid, such as INADDR_ANY
    // (WSAEADDRNOTAVAIL), at once. Node, Linux and macOS would instead connect 0.0.0.0 to the
    // local machine, so the page answers it itself, as sendto() does for UDP. Port 0 gets the
    // same answer (the main process already gave it, through Node's ERR_SOCKET_BAD_PORT).
    if (this.remoteAddress === 0 || this.remotePort === 0) return { error: 'EADDRNOTAVAIL' };
    const reply = this.request('net.connect', socket.id, inetNtoa(this.remoteAddress), this.remotePort, waitMs);
    if (!isObject(reply)) return { error: 'ENETDOWN' };
    if (typeof reply['error'] === 'string') return { error: reply['error'] };
    if (reply['state'] === 'connected') {
      this.type = NetType.ConnectedTcp;
      return { state: 'connected' };
    }
    return { state: 'pending' };
  }

  /** netSendData, both forms (Net.cpp:234-330). `portNum` is task 106's port, null for task 102. */
  private send(
    size: number,
    dataAddress: number,
    remoteIP: Bytes,
    portNum: number | null,
  ): { result: number; size: number } {
    if (this.mode === NetMode.Server) {
      this.remoteAddress = inetAddr(decode(remoteIP));
      // `remote.sin_port = port;` without htons (Net.cpp:298): the datagram goes to the swapped port.
      if (portNum !== null) this.remotePort = swap16(portNum);
    }
    if (this.mode === NetMode.Client && this.type === NetType.UnconnectedTcp && this.socket?.live) {
      const reply = this.connect(0);
      if ('error' in reply) return { result: netResult(winsockError(reply.error), NET_ERROR), size: 0 };
      if (reply.state === 'pending') return { result: NET_OK, size: 0 }; // no connection yet
    }
    const error = this.sendto(size, dataAddress);
    if (typeof error === 'number') return { result: netResult(error, NET_ERROR), size: 0 };
    this.bound = true; // automatic binding by sendto
    return { result: NET_OK, size: error.sent };
  }

  /** sendto(sock, data, size, 0, &remote): a Winsock error number, or the bytes sent. */
  private sendto(size: number, dataAddress: number): number | { sent: number } {
    if (this.winsockStarted === 0) return WSANOTINITIALISED;
    const socket = this.socket;
    if (!socket || !socket.live) return WSAENOTSOCK;
    const data = this.readMemory(dataAddress, size);
    if (socket.kind === 'udp') {
      if (this.remoteAddress === 0 || this.remotePort === 0) return WSAEADDRNOTAVAIL;
      // Broadcast needs SO_BROADCAST, which the original never sets.
      if (this.remoteAddress === INADDR_NONE) return WSAEACCES;
      const reply = this.request('net.send', socket.id, inetNtoa(this.remoteAddress), this.remotePort, data);
      if (!isObject(reply)) return WSAENETDOWN;
      if (typeof reply['error'] === 'string') return winsockError(reply['error']);
      socket.bound = true;
      return { sent: typeof reply['sent'] === 'number' ? reply['sent'] : 0 };
    }
    // TCP: only a connected socket sends; the listening socket of a server that has not accepted
    // anyone yet, or a client that never connected, is "not connected".
    if (this.type !== NetType.ConnectedTcp) return WSAENOTCONN;
    if (socket.error !== null) return winsockError(socket.error);
    const reply = this.request('net.send', socket.id, null, null, data);
    if (!isObject(reply)) return WSAENETDOWN;
    if (typeof reply['error'] === 'string') return winsockError(reply['error']);
    return { sent: typeof reply['sent'] === 'number' ? reply['sent'] : 0 };
  }

  /** netReadData, both forms (Net.cpp:345-473), from the buffer in the page. */
  private receive(size: number, bufferAddress: number, senderIPAddress: number): { result: number; size: number } {
    if (!this.bound) return { result: NET_OK, size: 0 }; // no receive from an unbound socket
    const socket = this.socket;

    if (this.mode === NetMode.Server && this.type === NetType.UnconnectedTcp) {
      // listen(), then a non-blocking accept().
      if (this.winsockStarted === 0) return { result: netResult(WSANOTINITIALISED, NET_ERROR), size: 0 };
      if (!socket || !socket.live) return { result: netResult(WSAENOTSOCK, NET_ERROR), size: 0 };
      if (!socket.accepted) return { result: NET_OK, size: 0 }; // no connection yet
      this.type = NetType.ConnectedTcp;
    }
    if (this.mode === NetMode.Client && this.type === NetType.UnconnectedTcp) return { result: NET_OK, size: 0 };
    if (!socket) return { result: NET_OK, size: 0 }; // `sock` still NULL: recvfrom is not called

    // recvfrom(sock, data, size, 0, &remote, ...)
    if (this.winsockStarted === 0) return { result: netResult(WSANOTINITIALISED, NET_ERROR), size: 0 };
    if (!socket.live) return { result: netResult(WSAENOTSOCK, NET_ERROR), size: 0 };
    let received = 0;
    if (socket.kind === 'udp') {
      // A UDP socket that was never bound: Winsock's "invalid argument" (§12.3, `bound` is global).
      if (!socket.bound) return { result: netResult(WSAEINVAL, NET_ERROR), size: 0 };
      const datagram = socket.datagrams.shift();
      if (datagram) {
        socket.datagramBytes -= datagram.bytes.length;
        this.remoteAddress = datagram.address;
        this.remotePort = datagram.port;
        if (datagram.bytes.length > size) {
          // WSAEMSGSIZE: the first part is in the buffer already; D1 and (A2) stay as they were.
          this.writeMemory(bufferAddress, datagram.bytes.subarray(0, size));
          return { result: netResult(WSAEMSGSIZE, NET_ERROR), size: 0 };
        }
        this.writeMemory(bufferAddress, datagram.bytes);
        received = datagram.bytes.length;
      }
    } else {
      if (this.type !== NetType.ConnectedTcp) return { result: netResult(WSAENOTCONN, NET_ERROR), size: 0 };
      if (socket.error !== null) return { result: netResult(winsockError(socket.error), NET_ERROR), size: 0 };
      if (socket.streamBytes > 0 && size > 0) {
        const bytes = this.takeStream(socket, size);
        this.writeMemory(bufferAddress, bytes);
        received = bytes.length;
      } else if (socket.ended && socket.streamBytes === 0) {
        // recv returned 0 on a connected TCP socket: the peer closed gracefully.
        return { result: netResult(REMOTE_DISCONNECT, NET_ERROR), size: 0 };
      }
    }
    // strncpy(senderIP, inet_ntoa(remote.sin_addr), 16); for TCP `remote` is what it held already.
    if (received > 0) this.writeString(senderIPAddress, inetNtoa(this.remoteAddress), 16);
    return { result: NET_OK, size: received };
  }

  /* ---------------------------------------------------------------- events of the main process */

  private subscribe(): void {
    if (this.unsubscribe) return;
    const bridge = this.deps.bridge;
    const stops = [
      bridge.on('net.data', (id, bytes, address, port) => this.onData(id, bytes, address, port)),
      bridge.on('net.accepted', (id) => {
        const socket = this.socketOf(id);
        if (socket) socket.accepted = true;
      }),
      bridge.on('net.end', (id) => {
        const socket = this.socketOf(id);
        if (socket) socket.ended = true;
      }),
      bridge.on('net.error', (id, code) => {
        const socket = this.socketOf(id);
        if (socket && socket.error === null) socket.error = typeof code === 'string' ? code : 'ENETDOWN';
      }),
    ];
    this.unsubscribe = () => stops.forEach((stop) => stop());
  }

  private socketOf(id: unknown): SocketState | null {
    const socket = this.socket;
    return socket && socket.live && socket.id === id ? socket : null;
  }

  private onData(id: unknown, bytes: unknown, address: unknown, port: unknown): void {
    const socket = this.socketOf(id);
    if (!socket || !(bytes instanceof Uint8Array)) return;
    if (socket.kind === 'udp') {
      if (socket.datagramBytes + bytes.length > UDP_BUFFER_LIMIT) return;
      const from = typeof address === 'string' ? inetAddr(address) : 0;
      socket.datagrams.push({
        bytes: new Uint8Array(bytes),
        address: from === INADDR_NONE ? 0 : from,
        port: typeof port === 'number' ? port & 0xffff : 0,
      });
      socket.datagramBytes += bytes.length;
    } else if (bytes.length > 0) {
      socket.stream.push(new Uint8Array(bytes));
      socket.streamBytes += bytes.length;
    }
  }

  private takeStream(socket: SocketState, size: number): Uint8Array {
    const out = new Uint8Array(Math.min(size, socket.streamBytes));
    let filled = 0;
    while (filled < out.length) {
      const head = socket.stream[0] as Uint8Array;
      const take = Math.min(head.length, out.length - filled);
      out.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.length) socket.stream.shift();
      else socket.stream[0] = head.subarray(take);
    }
    socket.streamBytes -= out.length;
    return out;
  }

  private clearArrivals(socket: SocketState): void {
    socket.datagrams = [];
    socket.datagramBytes = 0;
    socket.stream = [];
    socket.streamBytes = 0;
  }

  /* ---------------------------------------------------------------- helpers */

  /** A synchronous bridge call; undefined when the main process has no answer. */
  private request(channel: string, ...args: unknown[]): unknown {
    try {
      return this.deps.bridge.request(channel, ...args);
    } catch {
      return undefined;
    }
  }

  /** The bytes of 68000 memory from `address` on (stops at the end of memory, as no copy wraps). */
  private readMemory(address: number, count: number): Uint8Array {
    const memory = this.deps.memory();
    const start = Math.min(address >>> 0, memory.length);
    return memory.slice(start, Math.min(start + count, memory.length));
  }

  /** Writes into 68000 memory with no memory-map check, as the original's pointers do. */
  private writeMemory(address: number, bytes: Uint8Array): void {
    const memory = this.deps.memory();
    const start = address >>> 0;
    if (start >= memory.length) return;
    memory.set(bytes.subarray(0, memory.length - start), start);
  }

  /** strncpy(dest, text, length): the text, then zero bytes up to `length` bytes in all. */
  private writeString(address: number, text: string, length: number): void {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < Math.min(text.length, length); index++) bytes[index] = text.charCodeAt(index) & 0xff;
    this.writeMemory(address, bytes);
  }
}
