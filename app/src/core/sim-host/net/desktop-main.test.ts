// The main process's sockets (desktop/src/net.ts, DV4) on real loopback sockets under plain Node:
// UDP and TCP against echo servers this test starts, binds in use, refused connections, the
// connect steps of 500 ms, name lookup and the local address. The page's model on top of them is
// tested in desktop.test.ts; both together inside Electron in tests/desktop/dev/dv4-net.spec.ts.

import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CONNECT_STEP_MS, errorName, localIPv4, NetDevices } from '../../../../../desktop/src/net';

interface Event {
  channel: string;
  args: unknown[];
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function devices(): { net: NetDevices; events: Event[]; next(channel: string): Promise<Event> } {
  const events: Event[] = [];
  const waiting: { channel: string; done: (event: Event) => void }[] = [];
  const net = new NetDevices((channel, ...args) => {
    const event = { channel, args };
    events.push(event);
    const index = waiting.findIndex((entry) => entry.channel === channel);
    if (index >= 0) waiting.splice(index, 1)[0]?.done(event);
  });
  cleanups.push(() => net.closeAll());
  return {
    net,
    events,
    next: (channel) => {
      const seen = events.find((event) => event.channel === channel);
      if (seen) {
        events.splice(events.indexOf(seen), 1);
        return Promise.resolve(seen);
      }
      return new Promise((done) =>
        waiting.push({
          channel,
          done: (event) => {
            events.splice(events.indexOf(event), 1);
            done(event);
          },
        }),
      );
    },
  };
}

async function udpEcho(): Promise<{ socket: UdpSocket; port: number }> {
  const socket = createSocket('udp4');
  socket.on('message', (message, info) => socket.send(message, info.port, info.address));
  await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>((done) => socket.close(() => done())));
  return { socket, port: socket.address().port };
}

async function tcpEcho(): Promise<{ server: Server; port: number }> {
  const server = createServer((conn) => conn.on('data', (chunk) => conn.write(chunk)));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  const address = server.address();
  return { server, port: typeof address === 'object' && address ? address.port : 0 };
}

/** A port nobody listens on (taken from the system and given back). */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  return typeof address === 'object' && address ? address.port : 1;
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: unknown) => new TextDecoder().decode(data as Uint8Array);

describe('NetDevices (desktop/src/net.ts)', () => {
  it('UDP: a datagram to an echo server comes back as a net.data event with its sender', async () => {
    const echo = await udpEcho();
    const { net, next } = devices();
    const id = net.open('udp');
    expect(id).toBe(1);
    expect(await net.send(id, '127.0.0.1', echo.port, bytes('HELLO'))).toEqual({ sent: 5 });
    const event = await next('net.data');
    expect(event.args[0]).toBe(id);
    expect(text(event.args[1])).toBe('HELLO');
    expect(event.args.slice(2)).toEqual(['127.0.0.1', echo.port]);
  }, 20_000);

  it('UDP: bind to a port in use reports EADDRINUSE; a free port binds and receives', async () => {
    const holder = createSocket('udp4');
    await new Promise<void>((done) => holder.bind(0, '0.0.0.0', done));
    cleanups.push(() => new Promise<void>((done) => holder.close(() => done())));
    const taken = holder.address().port;
    const { net, next } = devices();
    expect(await net.bind(net.open('udp'), taken)).toBe('EADDRINUSE');

    const server = net.open('udp');
    expect(await net.bind(server, 0)).toBeNull();
    // A bound socket receives: what it sends to an echo server comes back to it.
    const sender = await udpEcho();
    expect(await net.send(server, '127.0.0.1', sender.port, bytes('x'))).toEqual({ sent: 1 });
    const echoed = await next('net.data');
    expect(text(echoed.args[1])).toBe('x');
  }, 20_000);

  it('UDP: sends to port 0 or to no IPv4 address are refused as EADDRNOTAVAIL', async () => {
    const { net } = devices();
    const id = net.open('udp');
    expect(await net.send(id, '127.0.0.1', 0, bytes('x'))).toEqual({ error: 'EADDRNOTAVAIL' });
    expect(await net.send(id, 'not an address', 9, bytes('x'))).toEqual({ error: 'EADDRNOTAVAIL' });
  });

  it('TCP client: connects to an echo server in the first 500 ms step and exchanges data', async () => {
    const echo = await tcpEcho();
    const { net, next } = devices();
    const id = net.open('tcp');
    const started = Date.now();
    expect(await net.connect(id, '127.0.0.1', echo.port, 5000)).toEqual({ state: 'connected' });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(CONNECT_STEP_MS - 20);
    expect(took).toBeLessThan(5000);
    expect(await net.send(id, null, null, bytes('PING'))).toEqual({ sent: 4 });
    let received = '';
    while (received.length < 4) received += text((await next('net.data')).args[1]);
    expect(received).toBe('PING');
  }, 20_000);

  it('TCP client: a refused connection is reported at the first step; the next attempt starts anew', async () => {
    const port = await closedPort();
    const { net } = devices();
    const id = net.open('tcp');
    expect(await net.connect(id, '127.0.0.1', port, 5000)).toEqual({ error: 'ECONNREFUSED' });
    // waitMs 0: the retry of a send starts a new connection and answers at once.
    expect(await net.connect(id, '127.0.0.1', port, 0)).toEqual({ state: 'pending' });
  }, 20_000);

  it('TCP server: accepts exactly one client, then reports its data and its end', async () => {
    const { net, next } = devices();
    const id = net.open('tcp');
    const holder = createServer();
    await new Promise<void>((done) => holder.listen(0, '0.0.0.0', done));
    const address = holder.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise<void>((done) => holder.close(() => done()));
    expect(await net.bind(id, port)).toBeNull();

    const client = devices();
    const other = client.net.open('tcp');
    expect(await client.net.connect(other, '127.0.0.1', port, 5000)).toEqual({ state: 'connected' });
    const accepted = await next('net.accepted');
    expect(accepted.args[0]).toBe(id);
    expect(await client.net.send(other, null, null, bytes('one'))).toEqual({ sent: 3 });
    expect(text((await next('net.data')).args[1])).toBe('one');
    expect(await net.send(id, null, null, bytes('two'))).toEqual({ sent: 3 });
    expect(text((await client.next('net.data')).args[1])).toBe('two');

    // The listening socket is gone: a second client is refused.
    const third = client.net.open('tcp');
    expect(await client.net.connect(third, '127.0.0.1', port, 5000)).toEqual({ error: 'ECONNREFUSED' });

    client.net.close(other);
    expect((await next('net.end')).args).toEqual([id]);
  }, 30_000);

  it('TCP: a send before the connection is made is "not connected"', async () => {
    const { net } = devices();
    expect(await net.send(net.open('tcp'), null, null, bytes('x'))).toEqual({ error: 'ENOTCONN' });
  });

  it('close and closeAll end every socket; events stop', async () => {
    const echo = await udpEcho();
    const { net, events } = devices();
    const id = net.open('udp');
    expect(net.size).toBe(1);
    expect(net.close(id)).toBe(true);
    expect(net.close(id)).toBe(false);
    expect(await net.send(id, '127.0.0.1', echo.port, bytes('x'))).toEqual({ error: 'ENOTSOCK' });
    net.open('tcp');
    net.closeAll();
    expect(net.size).toBe(0);
    expect(events).toEqual([]);
  });

  it('lookup finds localhost and fails for a name in .invalid; the local address is IPv4', async () => {
    const { net } = devices();
    expect(await net.lookup('localhost')).toBe('127.0.0.1');
    expect(await net.lookup('no-such-host.invalid')).toBeNull();
    expect(net.localIp()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(
      localIPv4({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', mac: '', cidr: null }],
        en0: [
          { address: 'fe80::1', family: 'IPv6', internal: false, netmask: '', mac: '', cidr: null, scopeid: 0 },
          { address: '192.168.5.7', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null },
        ],
      }),
    ).toBe('192.168.5.7');
    expect(localIPv4({})).toBe('127.0.0.1');
  }, 20_000);

  it('errorName keeps POSIX names and maps Node argument errors', () => {
    expect(errorName({ code: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
    expect(errorName({ code: 'ERR_SOCKET_BAD_PORT' })).toBe('EADDRNOTAVAIL');
    expect(errorName(new Error('no code'))).toBe('ENETDOWN');
  });
});
