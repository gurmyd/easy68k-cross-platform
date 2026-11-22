// The network tasks of TRAP #15 (100-107) in the desktop app (ARCHITECTURE.md 3.3.4, 9.6 DV4;
// trap15-b §12): 68000 programs run by the app's own simulator talk to echo servers this test
// starts, and two windows of the app talk to each other, over UDP and TCP on 127.0.0.1. Also: the
// byte-swapped port of tasks 106 and 107, the result codes of §12.2, task 100 with a host name,
// task 105, receives answered from the page-side buffer without a bridge call, and the socket
// closed by a simulator reset.
//
// The page comes from the Vite dev server (window.__easy68k; the page's own modules by path). The
// main process counts its device calls in test mode (desktop/src/net.ts deviceTestHooks).
//
// Owner: DV4 (a spec of its own in DV2's folder; docs/porting/errata/DV4.md).

import { expect, test, type Page } from '@playwright/test';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import {
  enginesAvailable,
  launchDesktop,
  startDevServer,
  waitForApplication,
  warmUpDevPage,
  type Desktop,
  type DevServer,
} from './harness';
import {
  closedTcpPort,
  coldStart,
  deviceCalls,
  freePort,
  hex,
  programs,
  readMemory,
  readSlots,
  startProgram,
  startTcpEcho,
  startUdpEcho,
  startUdpListener,
  textOf,
  waitDone,
} from './dv4-helpers';

let server: DevServer;
let desktop: Desktop;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startDevServer();
  desktop = await launchDesktop({ devServer: server });
  await warmUpDevPage(desktop.page);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
  await server?.close();
});
test.beforeEach(() => {
  test.skip(!enginesAvailable(), 'engine/dist is missing (npm run build:engines or fetch:engines)');
});
test.afterEach(async () => {
  // Each test leaves the window as Execute would: a fresh simulator, every socket closed.
  await coldStart(desktop.page).catch(() => {});
  expect(desktop.errors, 'console errors of the app').toEqual([]);
});

const SENDER = 0x4400;
const BUFFER = 0x4000;

/** The dotted address at (A2) as task 103 writes it: 16 bytes, zero padded. */
async function senderOf(page: Page): Promise<string> {
  const bytes = await readMemory(page, SENDER, 16);
  return textOf(bytes).replace(/\0+$/, '') + `|${bytes.filter((b) => b === 0).length} zero bytes`;
}

test('UDP: a program sends to an echo server and receives the datagram back (tasks 100, 102, 103, 104)', async () => {
  test.setTimeout(180_000);
  const P = await programs();
  const echo = await startUdpEcho();
  try {
    const program = P.buildProgram({
      strings: { HOST: '127.0.0.1', DATA: 'HELLO UDP' },
      steps: [
        { kind: 'call', task: 100, d1: P.netSettings(echo.port, 0), a2: 'HOST', save: 'create' },
        { kind: 'call', task: 102, d1: 9, a1: 'DATA', a2: 'HOST', save: 'send' },
        { kind: 'poll', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receive', tries: 1000, delay: 1 },
        { kind: 'call', task: 104, save: 'close' },
      ],
    });
    await startProgram(desktop.page, program, 'udp-echo');
    const slots = await waitDone(desktop.page, program, 'the UDP echo program');
    expect(slots['create']?.d0).toBe(hex(0));
    expect(slots['send']).toEqual({ d0: hex(0), d1: hex(9) });
    expect(slots['receive']).toEqual({ d0: hex(0), d1: hex(9) });
    expect(textOf(await readMemory(desktop.page, BUFFER, 9))).toBe('HELLO UDP');
    expect(await senderOf(desktop.page)).toBe('127.0.0.1|7 zero bytes');
    expect(slots['close']?.d0).toBe(hex(0));
    expect(echo.received.map((entry) => entry.text)).toEqual(['HELLO UDP']);
  } finally {
    await echo.close();
  }
});

test('TCP: a program connects to an echo server, exchanges data, and sees the peer close ($27750001)', async () => {
  test.setTimeout(180_000);
  const P = await programs();
  const echo = await startTcpEcho();
  try {
    const program = P.buildProgram({
      strings: { HOST: '127.0.0.1', DATA: 'HELLO TCP' },
      steps: [
        { kind: 'call', task: 100, d1: P.netSettings(echo.port, 1), a2: 'HOST', save: 'create' },
        { kind: 'call', task: 102, d1: 9, a1: 'DATA', a2: 'HOST', save: 'send' },
        { kind: 'poll', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receive', tries: 1000, delay: 1 },
        // The test closes the connection once it has seen 'receive'; the program waits for that.
        { kind: 'poll', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'disconnect', tries: 3000, delay: 1 },
        { kind: 'call', task: 104, save: 'close' },
      ],
    });
    const started = Date.now();
    await startProgram(desktop.page, program, 'tcp-echo');
    await expect
      .poll(async () => (await readSlots(desktop.page, program))['receive']?.d1, {
        timeout: 60_000,
        message: 'the program received the echo',
      })
      .toBe(hex(9));
    console.log(`TCP echo: the program had its echo ${Date.now() - started} ms after the load`);
    for (const conn of echo.connections) conn.end();
    const slots = await waitDone(desktop.page, program, 'the TCP echo program');
    expect(slots['create']?.d0).toBe(hex(0));
    expect(slots['send']).toEqual({ d0: hex(0), d1: hex(9) });
    expect(textOf(await readMemory(desktop.page, BUFFER, 9))).toBe('HELLO TCP');
    // TCP: (A2) gets what `remote` holds, the server's address.
    expect(await senderOf(desktop.page)).toBe('127.0.0.1|7 zero bytes');
    expect(slots['disconnect']?.d0).toBe(hex(0x27750001));
    expect(slots['close']?.d0).toBe(hex(0));
    expect(echo.received.join('')).toBe('HELLO TCP');
  } finally {
    await echo.close();
  }
});

test('tasks 106 and 107: the byte-swapped port, both ways, and the two cancel out', async () => {
  test.setTimeout(180_000);
  const P = await programs();
  const peer = await startUdpListener();
  const got: { text: string; port: number }[] = [];
  peer.socket.on('message', (message, info) => got.push({ text: message.toString('latin1'), port: info.port }));
  const serverPort = await freePort('udp');
  const swap16 = (value: number) => ((value & 0xff) << 8) | ((value >>> 8) & 0xff);
  try {
    const program = P.buildProgram({
      strings: { TO: '127.0.0.1', DATA: 'SWAP' },
      steps: [
        { kind: 'call', task: 101, d1: P.netSettings(serverPort, 0), save: 'server' },
        { kind: 'poll', task: 107, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receive', tries: 3000, delay: 1 },
        // The port exactly as task 107 gave it: the reply reaches the sender.
        { kind: 'd1From', from: 'receive' },
        { kind: 'call', task: 106, a1: 'BUFFER', a2: 'SENDER', save: 'answer' },
        // The listener's own port number as a program would write it: it arrives byte-swapped.
        { kind: 'call', task: 106, d1: (peer.port << 16) | 4, a1: 'DATA', a2: 'TO', save: 'plain' },
      ],
    });
    await startProgram(desktop.page, program, 'swap');
    await expect
      .poll(async () => (await readSlots(desktop.page, program))['server']?.d0, { timeout: 60_000 })
      .toBe(hex(0));
    // A listener for the swapped port of the second send, if it is free.
    const swapped = createSocket('udp4');
    const swappedGot: string[] = [];
    swapped.on('message', (message) => swappedGot.push(message.toString('latin1')));
    const swappedBound = await new Promise<boolean>((done) => {
      swapped.once('error', () => done(false));
      swapped.bind(swap16(peer.port), '127.0.0.1', () => done(true));
    });
    peer.socket.send('ABC', serverPort, '127.0.0.1');
    const slots = await waitDone(desktop.page, program, 'the swap program');
    expect(slots['receive']).toEqual({ d0: hex(0), d1: hex((swap16(peer.port) << 16) | 3) });
    expect(await senderOf(desktop.page)).toBe('127.0.0.1|7 zero bytes');
    // Task 106: D1 = bytes sent, the port in the high word cleared.
    expect(slots['answer']).toEqual({ d0: hex(0), d1: hex(3) });
    await expect.poll(() => got.map((entry) => entry.text)).toEqual(['ABC']);
    expect(got[0]?.port).toBe(serverPort);
    expect(slots['plain']).toEqual({ d0: hex(0), d1: hex(4) });
    console.log(
      `swap: listener ${peer.port}, its swapped port ${swap16(peer.port)} ${swappedBound ? 'bound' : 'was in use'}`,
    );
    if (swappedBound) await expect.poll(() => swappedGot).toEqual(['SWAP']);
    // Whatever the swapped port was, nothing went to the listener's own port.
    expect(got.map((entry) => entry.text)).toEqual(['ABC']);
    await new Promise<void>((done) => swapped.close(() => done()));
  } finally {
    await peer.close();
  }
});

test('two windows of the app: a UDP server and a TCP server in one, their clients in the other', async () => {
  test.setTimeout(300_000);
  const P = await programs();
  const windowPromise = desktop.app.waitForEvent('window', { timeout: 120_000 });
  await desktop.page.evaluate(() => window.__easy68k.ctx.commands.run('app.window.new'));
  const second = await windowPromise;
  second.on('console', (message) => {
    if (message.type() === 'error') desktop.errors.push(`second window: ${message.text()}`);
  });
  await waitForApplication(second);
  try {
    for (const protocol of [0, 1] as const) {
      const name = protocol === 0 ? 'UDP' : 'TCP';
      const port = await freePort(protocol === 0 ? 'udp' : 'tcp');
      const serverProgram = P.buildProgram({
        steps: [
          { kind: 'call', task: 101, d1: P.netSettings(port, protocol), save: 'server' },
          { kind: 'poll', task: 107, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receive', tries: 3000, delay: 1 },
          { kind: 'd1From', from: 'receive' },
          { kind: 'call', task: 106, a1: 'BUFFER', a2: 'SENDER', save: 'answer' },
          // TCP: the client closes first; the server sees it.
          ...(protocol === 1
            ? [
                {
                  kind: 'poll',
                  task: 103,
                  d1: 64,
                  a1: 'BUFFER',
                  a2: 'SENDER',
                  save: 'end',
                  tries: 3000,
                  delay: 1,
                } as const,
              ]
            : []),
        ],
      });
      const clientProgram = P.buildProgram({
        strings: { HOST: '127.0.0.1', DATA: `PING ${name}` },
        steps: [
          { kind: 'call', task: 100, d1: P.netSettings(port, protocol), a2: 'HOST', save: 'client' },
          { kind: 'call', task: 102, d1: 8, a1: 'DATA', a2: 'HOST', save: 'send' },
          { kind: 'poll', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'reply', tries: 3000, delay: 1 },
          { kind: 'call', task: 104, save: 'close' },
        ],
      });
      await startProgram(second, serverProgram, `server-${name}`);
      await expect
        .poll(async () => (await readSlots(second, serverProgram))['server']?.d0, { timeout: 60_000 })
        .toBe(hex(0));
      await startProgram(desktop.page, clientProgram, `client-${name}`);
      const client = await waitDone(desktop.page, clientProgram, `the ${name} client window`);
      const served = await waitDone(second, serverProgram, `the ${name} server window`);
      expect(client['client']?.d0, name).toBe(hex(0));
      expect(client['send'], name).toEqual({ d0: hex(0), d1: hex(8) });
      expect(client['reply'], name).toEqual({ d0: hex(0), d1: hex(8) });
      expect(textOf(await readMemory(desktop.page, BUFFER, 8)), name).toBe(`PING ${name}`);
      expect(textOf(await readMemory(second, BUFFER, 8)), name).toBe(`PING ${name}`);
      expect(served['server']?.d0, name).toBe(hex(0));
      expect(served['receive']?.d0, name).toBe(hex(0));
      expect((parseInt(served['receive']?.d1.slice(1) ?? '0', 16) & 0xffff) >>> 0, name).toBe(8);
      expect(served['answer'], name).toEqual({ d0: hex(0), d1: hex(8) });
      if (protocol === 1) expect(served['end']?.d0, name).toBe(hex(0x27750001));
      await coldStart(second);
    }
  } finally {
    await second.close().catch(() => {});
  }
});

test('result codes of trap15-b §12.2 with real sockets', async () => {
  test.setTimeout(180_000);
  const P = await programs();
  // Ports the test holds, so that a bind fails as "address in use".
  const udpHolder = createSocket('udp4');
  await new Promise<void>((done) => udpHolder.bind(0, '0.0.0.0', done));
  const tcpHolder = createServer();
  await new Promise<void>((done) => tcpHolder.listen(0, '0.0.0.0', done));
  const tcpTaken = (tcpHolder.address() as { port: number }).port;
  const refused = await closedTcpPort();
  const tcpFree = await freePort('tcp');
  try {
    const program = P.buildProgram({
      strings: { HOST: '127.0.0.1', DATA: 'X' },
      steps: [
        { kind: 'call', task: 102, d1: 1, a1: 'DATA', a2: 'HOST', save: 'sendFirst' },
        { kind: 'call', task: 104, save: 'closeFirst' },
        { kind: 'call', task: 105, a2: 'SENDER', save: 'localFirst' },
        { kind: 'call', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receiveFirst' },
        { kind: 'call', task: 101, d1: P.netSettings(udpHolder.address().port, 0), save: 'udpInUse' },
        { kind: 'call', task: 101, d1: P.netSettings(tcpTaken, 1), save: 'tcpInUse' },
        { kind: 'call', task: 100, d1: P.netSettings(refused, 1), a2: 'HOST', save: 'refused' },
        { kind: 'call', task: 101, d1: P.netSettings(tcpFree, 1), save: 'tcpServer' },
        { kind: 'call', task: 102, d1: 1, a1: 'DATA', a2: 'HOST', save: 'notConnected' },
        { kind: 'call', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'noClient' },
        { kind: 'call', task: 104, save: 'close' },
        { kind: 'call', task: 104, save: 'closeAgain' },
        { kind: 'call', task: 100, d1: P.netSettings(4000, 2), a2: 'HOST', save: 'badProtocol' },
        { kind: 'call', task: 104, save: 'closeAfterBadProtocol' },
      ],
    });
    await startProgram(desktop.page, program, 'codes');
    const slots = await waitDone(desktop.page, program, 'the result-code program');
    const d0 = Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, slot.d0]));
    expect(d0).toEqual({
      sendFirst: hex(0x276d0001), // not initialised
      closeFirst: hex(0x276d0001),
      localFirst: hex(0x276d0001),
      receiveFirst: hex(0), // nothing bound: 0 bytes
      udpInUse: hex(0x27400005), // WSAEADDRINUSE, NET_BIND_FAILED
      tcpInUse: hex(0x27400005),
      refused: hex(0x274d0001), // WSAECONNREFUSED, NET_ERROR
      tcpServer: hex(0),
      notConnected: hex(0x27490001), // WSAENOTCONN: the listening socket of a server
      noClient: hex(0), // no client accepted yet: 0 bytes
      close: hex(0),
      closeAgain: hex(0x276d0001),
      badProtocol: hex(2), // NET_INIT_FAILED without an extended code
      closeAfterBadProtocol: hex(0x27360001), // Winsock left started, no socket (§12.3)
    });
    expect(slots['receiveFirst']?.d1).toBe(hex(0));
    expect(slots['noClient']?.d1).toBe(hex(0));
  } finally {
    await new Promise<void>((done) => udpHolder.close(() => done()));
    await new Promise<void>((done) => tcpHolder.close(() => done()));
  }
});

test('task 100 with a host name (16 bytes at (A2), or 8), task 105, and a datagram too large ($27380001)', async () => {
  test.setTimeout(180_000);
  const P = await programs();
  const peer = await startUdpListener();
  const serverPort = await freePort('udp');
  try {
    const program = P.buildProgram({
      // At $5000 BAD (21 bytes, then one to align), at $5016 NAME (10 bytes), at $5020 AFTER.
      strings: { BAD: 'no-such-host.invalid', NAME: 'localhost', AFTER: 'MARK' },
      steps: [
        { kind: 'call', task: 100, d1: P.netSettings(serverPort, 0), a2: 'BAD', save: 'badName' },
        // Net.cpp:173 set remote to INADDR_NONE before the failed lookup: the send is a broadcast
        // without SO_BROADCAST, WSAEACCES.
        { kind: 'call', task: 102, d1: 1, a1: 'AFTER', a2: 'BAD', save: 'sendAfterBadName' },
        { kind: 'call', task: 100, d1: P.netSettings(serverPort, 0), a2: 'NAME', save: 'name' },
        { kind: 'call', task: 105, a2: 'SENDER', save: 'local' },
        { kind: 'call', task: 101, d1: P.netSettings(serverPort, 0), save: 'server' },
        { kind: 'poll', task: 103, d1: 8, a1: 'BUFFER', a2: 'SENDER', save: 'tooLarge', tries: 3000, delay: 1 },
      ],
    });
    // The app runs on this machine: its addresses are the test process's own.
    const local = Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry?.address);
    await startProgram(desktop.page, program, 'names');
    await expect
      .poll(async () => (await readSlots(desktop.page, program))['server']?.d0, { timeout: 60_000 })
      .toBe(hex(0));
    const localText = textOf(await readMemory(desktop.page, SENDER, 17));
    peer.socket.send('0123456789ABCDEF', serverPort, '127.0.0.1');
    const slots = await waitDone(desktop.page, program, 'the host-name program');
    expect(slots['badName']?.d0).toBe(hex(8));
    expect(slots['sendAfterBadName']?.d0).toBe(hex(0x271d0001));
    expect(slots['name']?.d0).toBe(hex(0));
    const strings = await readMemory(desktop.page, 0x5000, 0x30);
    // A failed name is left as it was.
    expect(textOf(strings.slice(0, 21))).toBe('no-such-host.invalid\0');
    // "localhost" became exactly 16 bytes, 127.0.0.1 and seven zeros: strncpy(server, ..., 16)
    // writes past the 10 bytes of the string, over the start of AFTER, as the original does.
    expect(textOf(strings.slice(0x16, 0x26))).toBe('127.0.0.1\0\0\0\0\0\0\0');
    expect(strings[0x26]).toBe(0xff); // memory is $FF where the program put nothing
    expect(slots['local']?.d0).toBe(hex(0));
    const dotted = localText.split('\0')[0] ?? '';
    console.log(`task 105 wrote "${dotted}"; the machine's IPv4 addresses: ${JSON.stringify(local)}`);
    expect(dotted).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(local.length ? local.includes(dotted) : dotted === '127.0.0.1').toBe(true);
    expect(slots['tooLarge']?.d0).toBe(hex(0x27380001));
    // D1 unchanged (8, as the program set it); the first 8 bytes are in the buffer.
    expect(slots['tooLarge']?.d1).toBe(hex(8));
    expect(textOf(await readMemory(desktop.page, BUFFER, 8))).toBe('01234567');
  } finally {
    await peer.close();
  }
});

test('receives are answered from the page-side buffer: 2000 polls of task 103 make no bridge call', async () => {
  test.setTimeout(180_000);
  const P = await programs();
  const peer = await startUdpListener();
  try {
    const program = P.buildProgram({
      strings: { HOST: '127.0.0.1', DATA: 'X' },
      steps: [
        { kind: 'call', task: 100, d1: P.netSettings(peer.port, 0), a2: 'HOST', save: 'create' },
        { kind: 'call', task: 102, d1: 1, a1: 'DATA', a2: 'HOST', save: 'send' },
        // Nobody answers: every poll finds nothing; `count` keeps the number of calls made.
        { kind: 'poll', task: 103, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receive', tries: 2000, count: 'polls' },
        {
          kind: 'poll',
          task: 107,
          d1: 64,
          a1: 'BUFFER',
          a2: 'SENDER',
          save: 'receivePort',
          tries: 2000,
          count: 'polls107',
        },
        { kind: 'call', task: 104, save: 'close' },
      ],
    });
    const before = await deviceCalls(desktop.app);
    await startProgram(desktop.page, program, 'polls');
    const slots = await waitDone(desktop.page, program, 'the polling program');
    const after = await deviceCalls(desktop.app);
    const delta = Object.fromEntries(
      Object.keys(after)
        .filter((channel) => channel.startsWith('net.') && (after[channel] ?? 0) !== (before[channel] ?? 0))
        .map((channel) => [channel, (after[channel] ?? 0) - (before[channel] ?? 0)]),
    );
    console.log(`bridge calls during 4000 receives: ${JSON.stringify(delta)}`);
    expect(slots['receive']).toEqual({ d0: hex(0), d1: hex(0) });
    expect(slots['polls']?.d1).toBe(hex(2000));
    expect(slots['polls107']?.d1).toBe(hex(2000));
    // One open, one send, one close: nothing for the 4000 receives.
    expect(delta).toEqual({ 'net.open': 1, 'net.send': 1, 'net.close': 1 });
  } finally {
    await peer.close();
  }
});

test('a simulator reset (Rewind) closes the socket; `bound` and `mode` survive it, the cold start clears them', async () => {
  test.setTimeout(180_000);
  const P = await programs();
  const port = await freePort('udp');
  const program = P.buildProgram({
    steps: [{ kind: 'call', task: 101, d1: P.netSettings(port, 0), save: 'server' }],
  });
  await startProgram(desktop.page, program, 'reset');
  const slots = await waitDone(desktop.page, program, 'the server program');
  expect(slots['server']?.d0).toBe(hex(0));
  const bindable = async () => {
    const probe = createSocket('udp4');
    const ok = await new Promise<boolean>((done) => {
      probe.once('error', () => done(false));
      probe.bind(port, '0.0.0.0', () => done(true));
    });
    await new Promise<void>((done) => probe.close(() => done()));
    return ok;
  };
  expect(await bindable(), 'the app holds the port while the program has its server').toBe(false);
  const closesBefore = (await deviceCalls(desktop.app))['net.close'] ?? 0;
  await desktop.page.evaluate(() => window.__easy68k.ctx.sim.controller.rewind());
  await expect.poll(async () => (await deviceCalls(desktop.app))['net.close'] ?? 0).toBe(closesBefore + 1);
  expect(await bindable(), 'Rewind closed the socket').toBe(true);
  const state = await desktop.page.evaluate(() => window.__easy68k.ctx.platform.net.state);
  expect(state).toMatchObject({ mode: 1, bound: true, netInitialized: false });
  await coldStart(desktop.page);
  const cleared = await desktop.page.evaluate(() => window.__easy68k.ctx.platform.net.state);
  expect(cleared).toMatchObject({ mode: 0, bound: false, socket: null });
});
