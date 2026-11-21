// Helpers of DV4's desktop tests (dv4-net.spec.ts, dv4-serial.spec.ts): run a 68000 program in a
// window of the app, read what it recorded, count the device calls of the main process, and the
// echo servers and the pseudo-terminal the tests start themselves.
//
// The programs are built by app/src/features/desktop-devices/testing/programs.ts, assembled by the
// real assembler in the page and run by the window's own simulator through its run controller, as
// File > Open and Run do it.
//
// Owner: DV4 (a file of its own in DV2's folder; docs/porting/errata/DV4.md).

import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import type * as ProgramsModule from '../../../app/src/features/desktop-devices/testing/programs';
import type { BuiltProgram } from '../../../app/src/features/desktop-devices/testing/programs';
import { removeQuietly, windowIdOf } from './harness';

export const PROGRAMS_MODULE = '/src/features/desktop-devices/testing/programs.ts';

/** D0 and D1 of a slot as 8-digit hex, for readable failures. */
export interface Slot {
  d0: string;
  d1: string;
}
export type Slots = Record<string, Slot>;

export const hex = (n: number) => `$${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

export type LoadOrigin = 'open' | 'execute';

/**
 * Assembles `program` in the page, loads it as File > Open (or Execute: a cold start first) and
 * presses Run. Does not wait for the end: see waitDone().
 */
export async function startProgram(
  page: Page,
  program: BuiltProgram,
  name: string,
  origin: LoadOrigin = 'open',
): Promise<string> {
  const file = await page.evaluate(
    async ({ source, name, origin }) => {
      const engine = await import(String('/src/engine/testing.ts'));
      const { ctx } = window.__easy68k;
      if (ctx.store.getState().mode !== 'simulator') await ctx.commands.run('app.mode.set', 'simulator');
      const { s68, l68 } = await engine.assembleProgram(source);
      const path = `/browser/dv4/${name}-${Date.now()}.S68`;
      await ctx.vfs.writeFile(path, s68);
      await ctx.vfs.writeFile(path.replace(/S68$/, 'L68'), l68);
      await ctx.sim.controller.open(path, origin, { confirmed: true });
      return path;
    },
    { source: program.source, name, origin },
  );
  await expect
    .poll(() => page.evaluate((path) => window.__easy68k.ctx.store.getState().sim.program?.path === path, file), {
      timeout: 60_000,
      message: `the program ${name} is loaded`,
    })
    .toBe(true);
  await page.evaluate(() => window.__easy68k.ctx.sim.controller.run());
  return file;
}

/** Waits until run number `run` since the load has reached the program's end (DONE), then reads
 *  every slot. */
export async function waitDone(
  page: Page,
  program: BuiltProgram,
  what: string,
  run = 1,
  timeout = 60_000,
): Promise<Slots> {
  const DONE = 0x2ff0;
  try {
    await expect
      .poll(() => page.evaluate((done) => window.__easy68k.ctx.sim.engine.readLong(done) >>> 0, DONE), {
        timeout,
        message: `${what} reaches its end`,
      })
      .toBe(run);
  } finally {
    // Whatever happened, the log shows what the program had recorded so far.
    const slots = await readSlots(page, program);
    console.log(`${what}: ${JSON.stringify(slots)}`);
  }
  return readSlots(page, program);
}

export function readSlots(page: Page, program: BuiltProgram): Promise<Slots> {
  return page.evaluate((slots) => {
    const engine = window.__easy68k.ctx.sim.engine;
    const hex = (n: number) => `$${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
    const out: Record<string, { d0: string; d1: string }> = {};
    for (const [name, at] of Object.entries(slots)) {
      out[name] = { d0: hex(engine.readLong(at)), d1: hex(engine.readLong(at + 4)) };
    }
    return out;
  }, program.slots);
}

/** `count` bytes of the window's 68000 memory from `address`. */
export function readMemory(page: Page, address: number, count: number): Promise<number[]> {
  return page.evaluate(
    ({ address, count }) => {
      const engine = window.__easy68k.ctx.sim.engine;
      return Array.from({ length: count }, (_, i) => engine.readByte(address + i) & 0xff);
    },
    { address, count },
  );
}

export const textOf = (bytes: number[]) => String.fromCharCode(...bytes);

/** Builds a program in the test process (the same module the page uses). */
export async function programs(): Promise<typeof ProgramsModule> {
  return import('../../../app/src/features/desktop-devices/testing/programs');
}

/** The device calls the main process has answered so far, per channel (test mode only). */
export function deviceCalls(app: ElectronApplication): Promise<Record<string, number>> {
  return app.evaluate(() => {
    const hooks = (globalThis as Record<string, unknown>)['__easy68kDevicesTest'] as
      { counts: Record<string, number> } | undefined;
    return { ...(hooks?.counts ?? {}) };
  });
}

/**
 * A PNG of the window's page, made by the main process (webContents.capturePage): a hidden test
 * window paints no frames for Playwright's screenshot. Returns false when the capture failed.
 */
export async function captureWindow(app: ElectronApplication, page: Page, path: string): Promise<boolean> {
  const id = await windowIdOf(app, page);
  const base64 = await app
    .evaluate(async ({ BrowserWindow }, windowId) => {
      const window = BrowserWindow.fromId(windowId);
      if (!window) return '';
      const image = await window.webContents.capturePage(undefined, { stayHidden: true });
      return image.isEmpty() ? '' : image.toPNG().toString('base64');
    }, id)
    .catch(() => '');
  if (!base64) return false;
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return true;
}

/** Stops whatever runs in the window and gives it a fresh simulator (Execute's cold start). */
export async function coldStart(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const controller = window.__easy68k.ctx.sim.controller;
    try {
      controller.pause();
    } catch {
      // not running
    }
    await controller.coldStart();
  });
}

/* ------------------------------------------------------------------ peers the tests start */

export interface UdpEcho {
  port: number;
  received: { text: string; port: number }[];
  close(): Promise<void>;
}

/** A UDP echo server on 127.0.0.1 (a free port the system gives). */
export async function startUdpEcho(): Promise<UdpEcho> {
  const socket = createSocket('udp4');
  const received: UdpEcho['received'] = [];
  socket.on('message', (message, info) => {
    received.push({ text: message.toString('latin1'), port: info.port });
    socket.send(message, info.port, info.address);
  });
  await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
  return {
    port: socket.address().port,
    received,
    close: () => new Promise<void>((done) => socket.close(() => done())),
  };
}

export interface TcpEcho {
  port: number;
  connections: Socket[];
  received: string[];
  close(): Promise<void>;
}

/** A TCP echo server on 127.0.0.1. */
export async function startTcpEcho(): Promise<TcpEcho> {
  const connections: Socket[] = [];
  const received: string[] = [];
  const server: Server = createServer((conn) => {
    connections.push(conn);
    conn.on('data', (chunk) => {
      received.push(chunk.toString('latin1'));
      conn.write(chunk);
    });
    conn.on('error', () => {});
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    connections,
    received,
    close: () =>
      new Promise<void>((done) => {
        for (const conn of connections) conn.destroy();
        server.close(() => done());
      }),
  };
}

/** A UDP socket the test listens on, bound to a port the system gives. */
export async function startUdpListener(): Promise<{ socket: UdpSocket; port: number; close(): Promise<void> }> {
  const socket = createSocket('udp4');
  await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
  return { socket, port: socket.address().port, close: () => new Promise<void>((done) => socket.close(() => done())) };
}

/** A TCP port nobody listens on. */
export async function closedTcpPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  return typeof address === 'object' && address ? address.port : 1;
}

/** A free port for a server of the app (taken from the system and given back). */
export async function freePort(kind: 'udp' | 'tcp'): Promise<number> {
  if (kind === 'tcp') return closedTcpPort();
  const socket = createSocket('udp4');
  await new Promise<void>((done) => socket.bind(0, '0.0.0.0', done));
  const port = socket.address().port;
  await new Promise<void>((done) => socket.close(() => done()));
  return port;
}

/* ------------------------------------------------------------------ the pseudo-terminal */

/**
 * A pseudo-terminal pair made by the system's own Python 3 (macOS and Linux runners have it): the
 * script opens the pair, prints the slave's device path, and echoes every byte that arrives on the
 * master back to it, so that what the app writes to the slave comes back to the app. It also
 * records what it saw, one line per chunk on stderr. Ends when its stdin closes.
 */
export interface Pty {
  path: string;
  log: string[];
  close(): Promise<void>;
}

const PTY_SCRIPT = String.raw`
import os, pty, select, sys, tty
master, slave = pty.openpty()
tty.setraw(slave)
sys.stdout.write(os.ttyname(slave) + "\n")
sys.stdout.flush()
while True:
    ready, _, _ = select.select([master, sys.stdin], [], [], 1.0)
    if sys.stdin in ready:
        if not os.read(sys.stdin.fileno(), 1024):
            break
    if master in ready:
        try:
            data = os.read(master, 1024)
        except OSError as error:
            sys.stderr.write("read error %s\n" % error)
            sys.stderr.flush()
            continue
        if not data:
            continue
        sys.stderr.write("echo %r\n" % data)
        sys.stderr.flush()
        os.write(master, data)
`;

export async function startPty(): Promise<Pty> {
  const dir = mkdtempSync(join(tmpdir(), 'easy68k-dv4-pty-'));
  const script = join(dir, 'pty_echo.py');
  writeFileSync(script, PTY_SCRIPT);
  const child: ChildProcess = spawn('python3', ['-I', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  const log: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => log.push(...chunk.toString().split('\n').filter(Boolean)));
  const path = await new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`the pty script printed no path: ${log.join(' | ')}`)), 20_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const line = out.split('\n')[0];
      if (out.includes('\n') && line) {
        clearTimeout(timer);
        resolve(line.trim());
      }
    });
  });
  return {
    path,
    log,
    close: async () => {
      child.stdin?.end();
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          try {
            if (child.pid !== undefined) process.kill(child.pid);
          } catch {
            // already gone
          }
          done();
        }, 5000);
        child.once('exit', () => {
          clearTimeout(timer);
          done();
        });
      });
      removeQuietly(dir);
    },
  };
}
