// createSimHost (ARCHITECTURE.md 3.3.1): the keys of the composed host equal the engine's
// HOST_DEFAULTS, each method is bound to its part, and clashes are refused.

import { describe, expect, it } from 'vitest';
import type { SimHost, SimHostParts } from '../../contracts';
import { HOST_DEFAULTS, HOST_PART_DEFAULTS } from '../../engine/sim';
import { HOST_PART_METHODS, createSimHost } from '.';

/** A part of plain functions that return the engine's defaults and say who they are. */
function inertParts(calls: string[] = []): SimHostParts {
  const parts: Record<string, Record<string, unknown>> = {};
  for (const [partName, defaults] of Object.entries(HOST_PART_DEFAULTS)) {
    const part: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(defaults)) {
      part[name] = (...args: unknown[]) => {
        calls.push(`${partName}.${name}(${args.join(',')})`);
        return value;
      };
    }
    parts[partName] = part;
  }
  return parts as unknown as SimHostParts;
}

describe('createSimHost', () => {
  it('composes exactly the methods of HOST_DEFAULTS', () => {
    const host = createSimHost(inertParts());
    expect(Object.keys(host).sort()).toEqual(Object.keys(HOST_DEFAULTS).sort());
    expect(Object.keys(host)).toHaveLength(93);
    for (const method of Object.values(host)) expect(method).toBeTypeOf('function');
  });

  it('lists per part the methods the engine binding lists', () => {
    const mine = Object.fromEntries(
      Object.entries(HOST_PART_METHODS).map(([part, names]) => [part, [...names].sort()]),
    );
    const binding = Object.fromEntries(
      Object.entries(HOST_PART_DEFAULTS).map(([part, defaults]) => [part, Object.keys(defaults).sort()]),
    );
    expect(mine).toEqual(binding);
  });

  it('forwards each call to its part and returns the result of the part', () => {
    const calls: string[] = [];
    const host = createSimHost(inertParts(calls));
    expect(host.fileOpen(new Uint8Array(0), 1)).toBe(0);
    expect(host.getPixel(3, 4)).toBe(0);
    host.hardwareTimer(2, true, 500);
    expect(host.timeCentiseconds()).toBe(0);
    expect(host.commRead(1, 8)).toBe(-3);
    expect(calls).toEqual([
      'files.fileOpen(,1)',
      'graphics.getPixel(3,4)',
      'hardware.hardwareTimer(2,true,500)',
      'main.timeCentiseconds()',
      'serial.commRead(1,8)',
    ]);
  });

  it('binds methods to their part, so a part may be a class with state', () => {
    class Counter {
      count = 0;
      resetToStartup(): void {
        this.count = -1;
      }
    }
    class Printer extends Counter {
      printerBeginDoc(): void {
        this.count++;
      }
      printerEndDoc(): void {
        this.count += 10;
      }
      printerMetric(): number {
        return this.count;
      }
      printerTextOut(): void {}
    }
    const printer = new Printer();
    const host = createSimHost({ ...inertParts(), printer });
    const { printerBeginDoc, printerEndDoc, printerMetric } = host;
    printerBeginDoc();
    printerEndDoc();
    expect(printerMetric(0)).toBe(11);
  });

  it('takes only host methods: members that several parts share do not clash and are not copied', () => {
    const parts = inertParts() as unknown as Record<string, Record<string, unknown>>;
    for (const part of Object.values(parts)) {
      part.resetToStartup = () => {};
      part.subscribe = () => () => {};
      part.state = {};
    }
    const host = createSimHost(parts as unknown as SimHostParts) as unknown as Record<string, unknown>;
    expect(host.resetToStartup).toBeUndefined();
    expect(host.subscribe).toBeUndefined();
    expect(Object.keys(host)).toHaveLength(93);
  });

  it('accepts one object as both the text and the graphics part (the output device)', () => {
    const parts = inertParts();
    const output = { ...parts.text, ...parts.graphics };
    const host = createSimHost({ ...parts, text: output, graphics: output });
    expect(Object.keys(host)).toHaveLength(93);
  });

  it('throws when a part lacks a host method, naming both', () => {
    const parts = inertParts();
    const { lineTo: _lineTo, ...graphics } = parts.graphics;
    expect(() => createSimHost({ ...parts, graphics: graphics as SimHostParts['graphics'] })).toThrow(
      'the part "graphics" has no method lineTo()',
    );
    expect(() => createSimHost({ ...parts, sound: undefined as unknown as SimHostParts['sound'] })).toThrow(
      'the part "sound" is missing',
    );
  });

  it('gives a host the real engine accepts', () => {
    // The type says so: createSimHost returns the contract's SimHost.
    const host: SimHost = createSimHost(inertParts());
    expect(host.netCloseSockets()).toBe(0);
  });
});
