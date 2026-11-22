// The serial and network devices of the desktop app through the real simulator engine (engine/dist):
// what a 68000 program sees in D0, D1 and memory when DesktopNet and DesktopSerial answer, and
// that a browser (NullNet, NullSerial) and a desktop window without a main process give the values
// of note 37 (ARCHITECTURE.md 1.4, 3.3.4). The programs come from testing/programs.ts, the same
// ones the browser check and the desktop tests run.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DesktopDeviceBridge, SimHostParts } from '../../contracts';
import { DesktopNet, swap16 } from '../../core/sim-host/net/desktop';
import { NullNet } from '../../core/sim-host/net/null';
import { DesktopSerial } from '../../core/sim-host/serial/desktop';
import { NullSerial } from '../../core/sim-host/serial/null';
import { assembleProgram, createTestEngine, runProgram, type TestEngine } from '../../engine/testing';
import {
  BUFFER,
  buildProgram,
  DONE,
  NOTE_37,
  netSettings,
  noteThirtySevenProgram,
  SENDER,
  type BuiltProgram,
} from './testing/programs';

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const enginesBuilt = ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((f) =>
  existsSync(repo(`engine/dist/${f}`)),
);
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail(
    'EASY68K_REQUIRE_ENGINES is 1 but engine/dist lacks sim68k or asm68k: run `npm run build:engines` first.',
  );
});

const hex = (n: number) => `$${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

/** Runs `program` on an engine with `parts`; returns D0 and D1 of every slot and the engine. */
async function run(
  program: BuiltProgram,
  parts: (engine: () => TestEngine['engine']) => Partial<SimHostParts>,
): Promise<{ slots: Record<string, { d0: string; d1: string }>; test: TestEngine }> {
  const assembled = await assembleProgram(program.source);
  let test: TestEngine | null = null;
  test = await createTestEngine(parts(() => (test as TestEngine).engine));
  test.engine.load(assembled.s68, assembled.l68, { name: 'program.S68', kind: 'open' });
  const report = runProgram(test.engine);
  expect(report.halted, `statuses ${report.statuses.join(',')}`).toBe(true);
  expect(test.engine.readLong(DONE)).toBe(1);
  const slots: Record<string, { d0: string; d1: string }> = {};
  for (const [name, at] of Object.entries(program.slots)) {
    slots[name] = { d0: hex(test.engine.readLong(at)), d1: hex(test.engine.readLong(at + 4)) };
  }
  return { slots, test };
}

const d0s = (slots: Record<string, { d0: string }>) =>
  Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, slot.d0]));
const note37 = Object.fromEntries(Object.entries(NOTE_37).map(([name, value]) => [name, hex(value)]));

/** A bridge with no main process behind it: every request answers undefined. */
const noMainProcess: DesktopDeviceBridge = { request: () => undefined, on: () => () => {} };

describe.skipIf(!enginesBuilt)('note 37 through the real engine (needs engine/dist)', () => {
  it('the browser devices (NullSerial, NullNet) give the values of note 37', async () => {
    const { slots, test } = await run(noteThirtySevenProgram(), () => ({
      serial: new NullSerial(),
      net: new NullNet(),
    }));
    test.release();
    expect(d0s(slots)).toEqual(note37);
  }, 60_000);

  it('DesktopSerial and DesktopNet without a main process give the same values', async () => {
    const { slots, test } = await run(noteThirtySevenProgram(), (engine) => ({
      serial: new DesktopSerial({ bridge: noMainProcess, portMap: () => ({ COM1: '/dev/ttys001' }) }),
      net: new DesktopNet({ bridge: noMainProcess, memory: () => engine().memory }),
    }));
    test.release();
    expect(d0s(slots)).toEqual(note37);
  }, 60_000);
});

describe.skipIf(!enginesBuilt)('DesktopNet through the real engine, against a scripted main process', () => {
  /** A main process with one UDP socket whose peer answers every datagram from port $0800. */
  function scriptedMain(): DesktopDeviceBridge & { sends: unknown[][] } {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const sends: unknown[][] = [];
    return {
      sends,
      request(channel, ...args) {
        switch (channel) {
          case 'net.open':
            return 1;
          case 'net.bind':
            return null;
          case 'net.lookup':
            return args[0] === 'localhost' ? '127.0.0.1' : null;
          case 'net.localIp':
            return '10.20.30.40';
          case 'net.send':
            sends.push(args);
            // The answer arrives as an event, as the main process pushes it.
            listeners.get('net.data')?.(1, new TextEncoder().encode('REPLY'), '127.0.0.1', 0x0800);
            return { sent: (args[3] as Uint8Array).length };
          default:
            return true;
        }
      },
      on(channel, listener) {
        listeners.set(channel, listener);
        return () => listeners.delete(channel);
      },
    };
  }

  it('task 100 with a host name, 102, 107 with the swapped port, 106 back to it, 105, 104', async () => {
    const main = scriptedMain();
    const program = buildProgram({
      strings: { HOST: 'localhost', BAD: 'no-such-host.invalid', DATA: 'HELLO', TO: '127.0.0.1' },
      steps: [
        { kind: 'call', task: 100, d1: netSettings(4000, 0), a2: 'BAD', save: 'badName' },
        { kind: 'call', task: 100, d1: netSettings(4000, 0), a2: 'HOST', save: 'client' },
        { kind: 'call', task: 102, d1: 0xabcd0005, a1: 'DATA', a2: 'TO', save: 'send' },
        { kind: 'call', task: 107, d1: 64, a1: 'BUFFER', a2: 'SENDER', save: 'receive' },
        { kind: 'call', task: 105, a2: 'SENDER', save: 'localIp' },
        { kind: 'call', task: 104, save: 'close' },
        { kind: 'call', task: 101, d1: netSettings(7000, 0), save: 'server' },
        { kind: 'call', task: 106, d1: (0x0008 << 16) | 5, a1: 'DATA', a2: 'TO', save: 'sendPort' },
      ],
    });
    const { slots, test } = await run(program, (engine) => ({
      net: new DesktopNet({ bridge: main, memory: () => engine().memory }),
    }));
    try {
      const memory = test.engine.memory;
      expect(slots['badName']?.d0).toBe(hex(8));
      expect(slots['client']?.d0).toBe(hex(0));
      // (A2) of task 100: "localhost" became 16 bytes, the address padded with zero bytes. The
      // strings start at $5000 (testing/programs.ts); "localhost" is the first of them.
      const text = new TextDecoder().decode(memory.subarray(0x5000, 0x5040));
      expect(text).toContain('127.0.0.1\0\0\0\0\0\0\0');
      // Task 102: D1.L = 5, the bytes HELLO to the server's address and port.
      expect(slots['send']).toEqual({ d0: hex(0), d1: hex(5) });
      expect(main.sends[0]?.slice(1, 3)).toEqual(['127.0.0.1', 4000]);
      // Task 107: D1 = (sender port byte-swapped << 16) | bytes.
      expect(slots['receive']).toEqual({ d0: hex(0), d1: hex((swap16(0x0800) << 16) | 5) });
      expect(new TextDecoder().decode(memory.subarray(BUFFER, BUFFER + 5))).toBe('REPLY');
      // Task 105 wrote over the sender address of 107: the dotted string and its terminator.
      expect(new TextDecoder().decode(memory.subarray(SENDER, SENDER + 12))).toBe('10.20.30.40\0');
      expect(slots['localIp']?.d0).toBe(hex(0));
      expect(slots['close']?.d0).toBe(hex(0));
      expect(slots['server']?.d0).toBe(hex(0));
      // Task 106 as a server: port 8 given, so the datagram goes to $0800 = 2048; D1 = 5.
      expect(slots['sendPort']).toEqual({ d0: hex(0), d1: hex(5) });
      expect(main.sends[1]?.slice(1, 3)).toEqual(['127.0.0.1', 2048]);
    } finally {
      test.release();
    }
  }, 60_000);
});

describe.skipIf(!enginesBuilt)('DesktopSerial through the real engine, against a scripted main process', () => {
  it('tasks 40-43: D0.W keeps the CID in the high word, D1.B counts, task 42 appends what arrived', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const main: DesktopDeviceBridge = {
      request(channel, ...args) {
        if (channel === 'serial.write') {
          // The device echoes, in two pieces, as a real line may deliver it.
          const bytes = args[1] as Uint8Array;
          listeners.get('serial.data')?.(args[0], 1, bytes.subarray(0, 1));
          listeners.get('serial.data')?.(args[0], 1, bytes.subarray(1));
          return { sent: bytes.length };
        }
        return true;
      },
      on(channel, listener) {
        listeners.set(channel, listener);
        return () => listeners.delete(channel);
      },
    };
    const program = buildProgram({
      strings: { PORT: 'COM4', DATA: 'PING' },
      steps: [
        { kind: 'call', task: 40, d0High: 5, a1: 'PORT', save: 'open' },
        { kind: 'call', task: 43, d0High: 5, d1: 0xffffff04, a1: 'DATA', save: 'send' },
        { kind: 'readSerial', cid: 5, want: 4, tries: 10, save: 'read' },
        { kind: 'call', task: 42, d0High: 5, d1: 0x12345608, a1: 'BUFFER', save: 'short' },
      ],
    });
    const { slots, test } = await run(program, () => ({
      serial: new DesktopSerial({ bridge: main, portMap: () => ({ COM4: '/dev/ttys004' }) }),
    }));
    try {
      expect(slots['open']?.d0).toBe(hex(5 << 16));
      // D1.B = bytes sent; bits 31..8 kept.
      expect(slots['send']).toEqual({ d0: hex(5 << 16), d1: hex(0xffffff04) });
      // Read in pieces until 4 bytes: the last read's D0 and the bytes in all.
      expect(slots['read']).toEqual({ d0: hex(5 << 16), d1: hex(4) });
      expect(new TextDecoder().decode(test.engine.memory.subarray(BUFFER, BUFFER + 4))).toBe('PING');
      // Nothing more has arrived: result 4 (timeout), D1.B = 0, bits 31..8 kept.
      expect(slots['short']).toEqual({ d0: hex((5 << 16) | 4), d1: hex(0x12345600) });
    } finally {
      test.release();
    }
  }, 60_000);
});
