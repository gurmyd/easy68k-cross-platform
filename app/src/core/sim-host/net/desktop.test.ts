// DesktopNet: the original's Net.cpp model in the page, against a scripted main process.
// The real sockets are tested in desktop-main.test.ts and, inside Electron, in
// tests/desktop/dev/dv4-net.spec.ts.

import { describe, expect, it } from 'vitest';
import type { DesktopDeviceBridge } from '../../../contracts';
import { encode } from '../../codec/cp1252';
import { DesktopNet, inetAddr, inetNtoa, INADDR_NONE, netResult, swap16, winsockError } from './desktop';
import { NULL_NET_CREATE, NULL_NET_NO_SOCKET, NullNet } from './null';

type Handler = (...args: unknown[]) => unknown;

/** A main process scripted per channel; records every request and can push events. */
class FakeMain implements DesktopDeviceBridge {
  readonly calls: { channel: string; args: unknown[] }[] = [];
  readonly handlers: Record<string, Handler> = {};
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
  count(channel: string): number {
    return this.calls.filter((call) => call.channel === channel).length;
  }
}

/** A main process whose sockets always work: ids from 1, sends send everything. */
function workingMain(): FakeMain {
  const main = new FakeMain();
  let next = 1;
  main.handlers['net.open'] = () => next++;
  main.handlers['net.bind'] = () => null;
  main.handlers['net.connect'] = () => ({ state: 'connected' });
  main.handlers['net.send'] = (_id, _address, _port, bytes) => ({ sent: (bytes as Uint8Array).length });
  main.handlers['net.close'] = () => true;
  main.handlers['net.lookup'] = (name) => (name === 'localhost' ? '127.0.0.1' : null);
  main.handlers['net.localIp'] = () => '192.168.1.20';
  return main;
}

function setup(main = workingMain()) {
  const memory = new Uint8Array(0x1000000);
  const net = new DesktopNet({ bridge: main, memory: () => memory });
  return { main, memory, net };
}

const ascii = (text: string) => encode(text).bytes;
/** D1 of tasks 100 and 101: port in the high word, protocol in the low byte. */
const settings = (port: number, protocol: number) => (port << 16) | protocol | 0;
const UDP = 0;
const TCP = 1;
const readText = (memory: Uint8Array, address: number, length: number) =>
  String.fromCharCode(...memory.subarray(address, address + length));

describe('addresses', () => {
  it('inet_addr reads the four forms and the three number bases, and refuses the rest', () => {
    expect(inetNtoa(inetAddr('127.0.0.1'))).toBe('127.0.0.1');
    expect(inetNtoa(inetAddr('192.168.001.010'))).toBe('192.168.1.8'); // octal parts
    expect(inetNtoa(inetAddr('0x7f.1'))).toBe('127.0.0.1');
    expect(inetNtoa(inetAddr('10.1.258'))).toBe('10.1.1.2');
    expect(inetNtoa(inetAddr('3232235777'))).toBe('192.168.1.1');
    expect(inetNtoa(inetAddr('1.2.3.4 trailing'))).toBe('1.2.3.4');
    for (const bad of ['', 'localhost', '1.2.3.256', '1.2.3.4.5', '1..2', '08.1.1.1', '255.255.255.255']) {
      expect(inetAddr(bad), bad).toBe(INADDR_NONE);
    }
  });

  it('swap16 exchanges the two bytes (the missing htons and ntohs of tasks 106 and 107)', () => {
    expect(swap16(0x0800)).toBe(8);
    expect(swap16(8)).toBe(0x0800);
    expect(swap16(40000)).toBe(0x409c);
  });

  it('maps POSIX error names to the Winsock numbers', () => {
    expect(winsockError('ECONNREFUSED')).toBe(0x274d);
    expect(winsockError('EADDRINUSE')).toBe(0x2740);
    expect(winsockError('ECONNRESET')).toBe(10054);
    expect(winsockError('ESOMETHINGNEW')).toBe(10050);
    expect(netResult(0x274d, 1)).toBe(0x274d0001);
  });
});

describe('without a main process (a missing handler): the values of note 37', () => {
  const none = new FakeMain(); // answers undefined to everything

  it('every task returns what NullNet returns', () => {
    const { net } = setup(none);
    const nul = new NullNet();
    expect(net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000)).toBe(NULL_NET_CREATE);
    expect(net.createNetServer(settings(4000, UDP))).toBe(NULL_NET_CREATE);
    expect(net.sendNet(5, 0x2000, ascii('127.0.0.1'))).toEqual(nul.sendNet(5, 0x2000, ascii('127.0.0.1')));
    expect(net.receiveNet(5, 0x2000, 0x3000)).toEqual(nul.receiveNet(5, 0x2000, 0x3000));
    expect(net.sendPortNet(5, 0x2000, ascii('127.0.0.1'))).toEqual({ d0: NULL_NET_NO_SOCKET });
    expect(net.receivePortNet(5, 0x2000, 0x3000)).toEqual(nul.receivePortNet(5, 0x2000, 0x3000));
    expect(net.closeNetConnection(0)).toBe(NULL_NET_NO_SOCKET);
    expect(net.getLocalIP(0x3000)).toBe(NULL_NET_NO_SOCKET);
  });
});

describe('result codes before anything is open (trap15-b §12.2, §12.4)', () => {
  it('send, close and local address report "not initialised"; receive reports nothing', () => {
    const { main, net } = setup();
    expect(net.sendNet(4, 0x2000, ascii('1.2.3.4'))).toEqual({ result: 0x276d0001 });
    expect(net.closeNetConnection(0)).toBe(0x276d0001);
    expect(net.getLocalIP(0x3000)).toBe(0x276d0001);
    expect(net.receiveNet(16, 0x2000, 0x3000)).toEqual({ result: 0, count: 0 });
    expect(net.receivePortNet(16, 0x2000, 0x3000)).toEqual({ d0: 0, d1: 0 });
    expect(net.netCloseSockets()).toBe(0x276d0001); // the reset of a program that used no network
    expect(main.calls).toEqual([]);
  });

  it('an unsupported protocol returns plain 2 and leaves Winsock started (§12.3)', () => {
    const { main, net } = setup();
    expect(net.createNetClient(settings(4000, 2), ascii('127.0.0.1'), 0x1000)).toBe(2);
    expect(main.count('net.open')).toBe(0);
    // The socket handle is NULL, but Winsock is started: closesocket reports "not a socket".
    expect(net.closeNetConnection(0)).toBe(0x27360001);
    // ...and gethostname works.
    expect(net.getLocalIP(0x3000)).toBe(0);
  });
});

describe('UDP client', () => {
  it('sends to the server, receives a datagram from the page-side buffer and names its sender', () => {
    const { main, memory, net } = setup();
    expect(net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000)).toBe(0);
    memory.set(ascii('HELLO'), 0x2000);
    expect(net.sendNet(5, 0x2000, ascii('ignored'))).toEqual({ result: 0, count: 5 });
    const sent = main.calls.find((call) => call.channel === 'net.send');
    expect(sent?.args.slice(1, 3)).toEqual(['127.0.0.1', 4000]);
    expect(Array.from(sent?.args[3] as Uint8Array)).toEqual(Array.from(ascii('HELLO')));

    const before = main.calls.length;
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 }); // nothing yet
    main.push('net.data', 1, ascii('OLLEH'), '127.0.0.1', 4000);
    memory.fill(0x55, 0x5000, 0x5012);
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 5 });
    expect(readText(memory, 0x4000, 5)).toBe('OLLEH');
    // strncpy(senderIP, ..., 16): the address and zero bytes, 16 in all; byte 17 untouched.
    expect(readText(memory, 0x5000, 9)).toBe('127.0.0.1');
    expect(Array.from(memory.subarray(0x5009, 0x5010))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(memory[0x5010]).toBe(0x55);
    expect(main.calls.length).toBe(before); // receives make no bridge call
  });

  it('the UDP socket is not bound until it has sent, so a receive before that reports nothing', () => {
    const { net, main } = setup();
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000);
    main.push('net.data', 1, ascii('X'), '127.0.0.1', 4000);
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 });
  });

  it('`bound` is never cleared: a later client receives on an unbound socket and gets $27260001', () => {
    const { net } = setup();
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000);
    expect(net.sendNet(1, 0x2000, ascii(''))).toEqual({ result: 0, count: 1 });
    expect(net.closeNetConnection(0)).toBe(0);
    expect(net.createNetClient(settings(4001, UDP), ascii('127.0.0.1'), 0x1000)).toBe(0);
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0x27260001 });
  });

  it('a datagram larger than the buffer: $27380001, the first part in the buffer, D1 and (A2) unchanged', () => {
    const { memory, net, main } = setup();
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000);
    net.sendNet(1, 0x2000, ascii(''));
    main.push('net.data', 1, ascii('ABCDEFGH'), '10.0.0.9', 5000);
    memory.fill(0x55, 0x5000, 0x5010);
    expect(net.receiveNet(4, 0x4000, 0x5000)).toEqual({ result: 0x27380001 });
    expect(readText(memory, 0x4000, 4)).toBe('ABCD');
    expect(memory[0x4004]).toBe(0);
    expect(memory[0x5000]).toBe(0x55);
    // The datagram is gone; recvfrom overwrote `remote`, so the next send goes to its sender.
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 });
    net.sendNet(1, 0x2000, ascii(''));
    expect(main.calls.at(-1)?.args.slice(1, 3)).toEqual(['10.0.0.9', 5000]);
  });

  it('task 107 returns the sender port byte-swapped and the byte count; nothing received gives 0', () => {
    const { net, main } = setup();
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000);
    net.sendNet(1, 0x2000, ascii(''));
    expect(net.receivePortNet(0x12340040, 0x4000, 0x5000)).toEqual({ d0: 0, d1: 0 });
    main.push('net.data', 1, ascii('abc'), '127.0.0.1', 0x0800);
    expect(net.receivePortNet(64, 0x4000, 0x5000)).toEqual({ d0: 0, d1: (8 << 16) | 3 });
  });

  it('task 106 in client mode ignores the port and clears the high word of D1', () => {
    const { net, main } = setup();
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000);
    expect(net.sendPortNet((0x0800 << 16) | 3, 0x2000, ascii(''))).toEqual({ d0: 0, d1: 3 });
    expect(main.calls.at(-1)?.args.slice(1, 3)).toEqual(['127.0.0.1', 4000]);
  });
});

describe('UDP server', () => {
  it('task 106 sends to the byte-swapped port; answering with the port of task 107 reaches the sender', () => {
    const { net, main } = setup();
    expect(net.createNetServer(settings(7000, UDP))).toBe(0);
    expect(main.calls.find((call) => call.channel === 'net.bind')?.args).toEqual([1, 7000]);
    expect(net.sendPortNet((0x0800 << 16) | 2, 0x2000, ascii('127.0.0.1'))).toEqual({ d0: 0, d1: 2 });
    expect(main.calls.at(-1)?.args.slice(1, 3)).toEqual(['127.0.0.1', 8]);

    main.push('net.data', 1, ascii('hi'), '127.0.0.1', 51000);
    const reply = net.receivePortNet(64, 0x4000, 0x5000);
    expect(reply.d0).toBe(0);
    const port = ((reply.d1 as number) >>> 16) & 0xffff;
    expect(port).toBe(swap16(51000));
    net.sendPortNet((port << 16) | 2, 0x2000, ascii('127.0.0.1'));
    expect(main.calls.at(-1)?.args.slice(1, 3)).toEqual(['127.0.0.1', 51000]);
  });

  it('task 102 in server mode sends to (A2) on the port in `remote`; a bad address is a broadcast', () => {
    const { net, main } = setup();
    net.createNetServer(settings(7000, UDP));
    expect(net.sendNet(2, 0x2000, ascii('10.1.2.3'))).toEqual({ result: 0, count: 2 });
    expect(main.calls.at(-1)?.args.slice(1, 3)).toEqual(['10.1.2.3', 7000]);
    // inet_addr("no address") is INADDR_NONE, 255.255.255.255: broadcast without SO_BROADCAST.
    expect(net.sendNet(2, 0x2000, ascii('no address'))).toEqual({ result: 0x271d0001 });
  });

  it('a port in use: (WSAEADDRINUSE << 16) + 5', () => {
    const main = workingMain();
    main.handlers['net.bind'] = () => 'EADDRINUSE';
    const { net } = setup(main);
    expect(net.createNetServer(settings(7000, UDP))).toBe(0x27400005);
    // The socket exists, but nothing is bound: the next receive reports nothing.
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 });
  });
});

describe('TCP', () => {
  it('client: task 100 waits for the connection in the main process (5000 ms at most) and returns 0', () => {
    const { net, main } = setup();
    expect(net.createNetClient(settings(4000, TCP), ascii('127.0.0.1'), 0x1000)).toBe(0);
    expect(main.calls.find((call) => call.channel === 'net.connect')?.args).toEqual([1, '127.0.0.1', 4000, 5000]);
    expect(net.state.type).toBe(3);
  });

  it('client: a refused connection returns (WSAECONNREFUSED << 16) + 1', () => {
    const main = workingMain();
    main.handlers['net.connect'] = () => ({ error: 'ECONNREFUSED' });
    const { net } = setup(main);
    expect(net.createNetClient(settings(4000, TCP), ascii('127.0.0.1'), 0x1000)).toBe(0x274d0001);
  });

  it('client: still pending after 5000 ms returns 0; sends retry and report 0 bytes until connected', () => {
    const main = workingMain();
    let state = 'pending';
    main.handlers['net.connect'] = () => ({ state });
    const { net, memory } = setup(main);
    expect(net.createNetClient(settings(4000, TCP), ascii('127.0.0.1'), 0x1000)).toBe(0);
    expect(net.sendNet(3, 0x2000, ascii(''))).toEqual({ result: 0, count: 0 });
    expect(main.calls.at(-1)).toEqual({ channel: 'net.connect', args: [1, '127.0.0.1', 4000, 0] });
    // A receive of a client that is not connected yet reports nothing.
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 });
    state = 'connected';
    memory.set(ascii('abc'), 0x2000);
    expect(net.sendNet(3, 0x2000, ascii(''))).toEqual({ result: 0, count: 3 });
  });

  it('client: data, then the peer closes: $27750001; (A2) gets the server address', () => {
    const { net, main, memory } = setup();
    net.createNetClient(settings(4000, TCP), ascii('127.0.0.1'), 0x1000);
    net.sendNet(1, 0x2000, ascii(''));
    main.push('net.data', 1, ascii('stream'), null, null);
    main.push('net.end', 1);
    expect(net.receiveNet(4, 0x4000, 0x5000)).toEqual({ result: 0, count: 4 });
    expect(readText(memory, 0x5000, 9)).toBe('127.0.0.1');
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 2 });
    expect(readText(memory, 0x4000, 2)).toBe('am');
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0x27750001 });
  });

  it('client: a connection reset reaches the receive and the send', () => {
    const { net, main } = setup();
    net.createNetClient(settings(4000, TCP), ascii('127.0.0.1'), 0x1000);
    expect(net.sendNet(1, 0x2000, ascii(''))).toEqual({ result: 0, count: 1 });
    main.push('net.error', 1, 'ECONNRESET');
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0x27460001 });
    expect(net.sendNet(1, 0x2000, ascii(''))).toEqual({ result: 0x27460001 });
  });

  it('server: before a client is accepted a send is "not connected" and a receive reports nothing', () => {
    const { net, main, memory } = setup();
    expect(net.createNetServer(settings(7000, TCP))).toBe(0);
    expect(net.sendNet(1, 0x2000, ascii('127.0.0.1'))).toEqual({ result: 0x27490001 });
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 });
    main.push('net.accepted', 1, '127.0.0.1', 50123);
    main.push('net.data', 1, ascii('ping'), null, null);
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 4 });
    // For TCP recvfrom fills in no address: (A2) gets what `remote` holds, for a server the
    // address given to its last send (trap15-b §12.2, task 103).
    expect(readText(memory, 0x5000, 10)).toBe('127.0.0.1\0');
    expect(net.sendNet(4, 0x4000, ascii('127.0.0.1'))).toEqual({ result: 0, count: 4 });
    expect(main.calls.at(-1)?.args.slice(1, 3)).toEqual([null, null]);
  });
});

describe('task 100 with a host name', () => {
  it('success writes exactly 16 bytes, the dotted address and zero bytes, at (A2)', () => {
    const { net, memory, main } = setup();
    memory.set(ascii('localhost\0'), 0x1000);
    memory.fill(0x55, 0x100a, 0x1020);
    expect(net.createNetClient(settings(4000, UDP), ascii('localhost'), 0x1000)).toBe(0);
    expect(readText(memory, 0x1000, 9)).toBe('127.0.0.1');
    expect(Array.from(memory.subarray(0x1009, 0x1010))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(memory[0x1010]).toBe(0x55);
    expect(main.calls.find((call) => call.channel === 'net.lookup')?.args).toEqual(['localhost']);
  });

  it('failure returns plain 8 and leaves (A2) alone; a dotted address is never looked up or rewritten', () => {
    const { net, memory, main } = setup();
    memory.set(ascii('no-such-host.invalid\0'), 0x1000);
    expect(net.createNetClient(settings(4000, UDP), ascii('no-such-host.invalid'), 0x1000)).toBe(8);
    expect(readText(memory, 0x1000, 12)).toBe('no-such-host');
    memory.set(ascii('127.000.0.1\0'), 0x1000);
    expect(net.createNetClient(settings(4000, UDP), ascii('127.000.0.1'), 0x1000)).toBe(0);
    expect(readText(memory, 0x1000, 11)).toBe('127.000.0.1');
    expect(main.count('net.lookup')).toBe(1);
  });
});

describe('task 105', () => {
  it('after task 100 or 101 writes the machine address with its terminator', () => {
    const { net, memory } = setup();
    expect(net.getLocalIP(0x3000)).toBe(0x276d0001);
    net.createNetServer(settings(7000, UDP));
    memory.fill(0x55, 0x3000, 0x3020);
    expect(net.getLocalIP(0x3000)).toBe(0);
    expect(readText(memory, 0x3000, 12)).toBe('192.168.1.20');
    expect(memory[0x300c]).toBe(0);
    expect(memory[0x300d]).toBe(0x55);
  });
});

describe('resets', () => {
  it('netCloseSockets (every simulator reset) closes the socket but keeps `bound` and `mode`', () => {
    const { net, main } = setup();
    net.createNetServer(settings(7000, UDP));
    expect(net.netCloseSockets()).toBe(0);
    expect(main.count('net.close')).toBe(1);
    expect(net.state).toMatchObject({ mode: 1, bound: true, netInitialized: false, winsockStarted: 0 });
    // A receive after the reset reaches the closed handle: "not initialised" (Winsock cleaned up).
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0x276d0001 });
    // The second close is an error, as closing twice is in the original.
    expect(net.closeNetConnection(0)).toBe(0x276d0001);
  });

  it('task 100 or 101 again closes the previous socket first', () => {
    const { net, main } = setup();
    net.createNetServer(settings(7000, UDP));
    net.createNetClient(settings(7001, UDP), ascii('127.0.0.1'), 0x1000);
    expect(main.calls.map((call) => call.channel)).toEqual(['net.open', 'net.bind', 'net.close', 'net.open']);
    expect(net.state.winsockStarted).toBe(1);
  });

  it('the cold start closes the socket and clears every variable, `bound` and `mode` too', () => {
    const { net, main } = setup();
    net.createNetServer(settings(7000, UDP));
    net.resetToStartup();
    expect(main.count('net.close')).toBe(1);
    expect(net.state).toEqual({
      mode: 0,
      type: -1,
      netInitialized: false,
      bound: false,
      remote: '0.0.0.0',
      remotePort: 0,
      winsockStarted: 0,
      socket: null,
    });
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 });
  });

  it('events of a closed socket are ignored', () => {
    const { net, main } = setup();
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000);
    net.sendNet(1, 0x2000, ascii(''));
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000); // socket 2
    net.sendNet(1, 0x2000, ascii(''));
    main.push('net.data', 1, ascii('old'), '127.0.0.1', 4000);
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 0 });
    main.push('net.data', 2, ascii('new'), '127.0.0.1', 4000);
    expect(net.receiveNet(64, 0x4000, 0x5000)).toEqual({ result: 0, count: 3 });
  });
});

describe('memory edges', () => {
  it('a send near the end of memory sends what memory holds; writes stop at its end', () => {
    const { net, main, memory } = setup();
    net.createNetClient(settings(4000, UDP), ascii('127.0.0.1'), 0x1000);
    expect(net.sendNet(16, 0xfffffc, ascii(''))).toEqual({ result: 0, count: 4 });
    main.push('net.data', 1, ascii('abcdefgh'), '127.0.0.1', 4000);
    expect(net.receiveNet(64, 0xfffffe, 0x5000)).toEqual({ result: 0, count: 8 });
    expect(readText(memory, 0xfffffe, 2)).toBe('ab');
  });
});
