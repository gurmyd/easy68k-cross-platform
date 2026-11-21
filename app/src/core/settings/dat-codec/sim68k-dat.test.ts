// sim68K.dat (sim-ui §14.3, ARCHITECTURE.md 3.10): the shipped file, the raw bytes on lines 2, 3
// and 34, the positional rule, and the writer against a checked fixture.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SimSettings } from '../../../contracts';
import { decode } from '../../codec/cp1252';
import { DEFAULT_SIM_SETTINGS } from '../defaults';
import {
  SIM68K_DAT_DEFAULTS,
  SIM68K_DAT_HEADER,
  parseSim68KDat,
  simSettingsFromDat,
  writeSim68KDat,
  type DatSimSettings,
} from './sim68k-dat';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))));
const SHIPPED = fixture('shipped-sim68K.dat');

/** The lines of a file as byte arrays (split at CR LF), without the final empty piece. */
function byteLines(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      lines.push(bytes.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  return lines;
}
function join(lines: Uint8Array[]): Uint8Array {
  const parts = lines.flatMap((line) => [line, Uint8Array.of(0x0d, 0x0a)]);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
/** The shipped file with line `n` (1-based) replaced. */
function shippedWith(n: number, line: Uint8Array | string): Uint8Array {
  const lines = byteLines(SHIPPED);
  lines[n - 1] = typeof line === 'string' ? ascii(line) : line;
  return join(lines);
}

/** sim-ui §14.3, column "Default", which the shipped 5.16.1 file holds as well. */
const SHIPPED_SETTINGS: DatSimSettings = {
  execLogType: 0,
  outputLogType: 0,
  exceptions: false,
  memoryAddress: 0,
  whichStack: 8,
  seg7Address: 0xe00000,
  ledAddress: 0xe00010,
  switchAddress: 0xe00012,
  buttonAddress: 0xe00014,
  outputFont: { name: 'Fixedsys', size: 9 },
  listingFont: { name: 'Courier New', size: 10 },
  printerFont: { name: 'Courier New', size: 10 },
  bitField: false,
  autoTraceIntervalMs: 200,
  disableDisplay: false,
};

/** Every setting of the file away from its default (written-sim68K.dat is its file). */
export const CHANGED_SIM: SimSettings = {
  ...structuredClone(DEFAULT_SIM_SETTINGS),
  execLogType: 3,
  outputLogType: 1,
  exceptions: true,
  memoryAddress: 0x00abcd,
  whichStack: 2,
  seg7Address: 0xe01000,
  ledAddress: 0xe01010,
  switchAddress: 0xe01012,
  buttonAddress: 0xe01014,
  outputFont: { name: 'Courier New', size: 12 },
  listingFont: { name: 'Lucida Console', size: 14 },
  printerFont: { name: 'Arial', size: 11 },
  bitField: true,
  autoTraceIntervalMs: 650,
  disableDisplay: true,
};
const CHANGED_PANELS = { memory: true, stack: false, hardware: true };

function datPart(settings: SimSettings): DatSimSettings {
  const { speed: _s, highlightChangedRegisters: _h, ...rest } = settings;
  return rest;
}

describe('parseSim68KDat: the shipped file', () => {
  it('begins lines 2, 3 and 34 with a NUL byte (sim-ui §14.3)', () => {
    const lines = byteLines(SHIPPED);
    expect(lines).toHaveLength(37);
    expect([lines[1]?.[0], lines[2]?.[0], lines[33]?.[0]]).toEqual([0, 0, 0]);
    expect(decode(lines[1]!.slice(1))).toBe('$exec log');
    expect(decode(lines[33]!.slice(1))).toBe('$fullscreen monitor');
  });

  it('parses to the defaults of sim-ui §14.3, all three panels hidden', () => {
    const parsed = parseSim68KDat(SHIPPED);
    const { panels, ...settings } = parsed;
    expect(settings).toEqual(SHIPPED_SETTINGS);
    expect(panels).toEqual({ memory: false, stack: false, hardware: false });
  });
});

describe('parseSim68KDat: raw bytes on lines 2 and 3', () => {
  it('line 2 takes a raw byte 0..3: a digit is rejected (0x31 is out of range)', () => {
    for (const raw of [0, 1, 2, 3]) {
      expect(parseSim68KDat(shippedWith(2, Uint8Array.of(raw, ...ascii('$exec log')))).execLogType).toBe(raw);
    }
    expect('execLogType' in parseSim68KDat(shippedWith(2, '1$exec log'))).toBe(false);
    expect('execLogType' in parseSim68KDat(shippedWith(2, Uint8Array.of(4, ...ascii('$exec log'))))).toBe(false);
    // The byte is a signed char: $FF is -1, out of range.
    expect('execLogType' in parseSim68KDat(shippedWith(2, Uint8Array.of(0xff, ...ascii('$exec log'))))).toBe(false);
  });

  it('line 3 takes a raw byte 0..1', () => {
    expect(parseSim68KDat(shippedWith(3, Uint8Array.of(1, ...ascii('$output log')))).outputLogType).toBe(1);
    expect('outputLogType' in parseSim68KDat(shippedWith(3, Uint8Array.of(2, ...ascii('$output log'))))).toBe(false);
    expect('outputLogType' in parseSim68KDat(shippedWith(3, '0$output log'))).toBe(false);
  });

  it('line 34 is never taken, and a non-zero byte there does not disturb the lines after it', () => {
    const parsed = parseSim68KDat(shippedWith(34, Uint8Array.of(1, ...ascii('$fullscreen monitor'))));
    expect(parsed.autoTraceIntervalMs).toBe(200);
    const changed = parseSim68KDat(writeSim68KDat(CHANGED_SIM, CHANGED_PANELS));
    expect(changed.bitField).toBe(true);
    expect(changed.disableDisplay).toBe(true);
  });
});

describe('parseSim68KDat: how each kind of line is read (SIM68Ku.cpp:1551-2034)', () => {
  it('on/off lines: 1 = on', () => {
    expect(parseSim68KDat(shippedWith(4, '1$exceptions')).exceptions).toBe(true);
    expect(parseSim68KDat(shippedWith(35, '1$bit field enabled')).bitField).toBe(true);
    expect(parseSim68KDat(shippedWith(37, '1$disable display')).disableDisplay).toBe(true);
    expect(parseSim68KDat(shippedWith(15, '1$memory visible')).panels.memory).toBe(true);
    expect(parseSim68KDat(shippedWith(20, '1$stack visible')).panels.stack).toBe(true);
    expect(parseSim68KDat(shippedWith(27, '1$hardware visible')).panels.hardware).toBe(true);
    expect(parseSim68KDat(shippedWith(27, '2$hardware visible')).panels.hardware).toBe(false);
  });

  it('addresses: hexadecimal text of up to six digits', () => {
    expect(parseSim68KDat(shippedWith(14, '00A0F0$memory address')).memoryAddress).toBe(0xa0f0);
    expect(parseSim68KDat(shippedWith(14, '1000$memory address')).memoryAddress).toBe(0x1000);
    expect(parseSim68KDat(shippedWith(23, 'f00000$7-segment address')).seg7Address).toBe(0xf00000);
    expect('memoryAddress' in parseSim68KDat(shippedWith(14, 'XYZ$memory address'))).toBe(false);
    expect('memoryAddress' in parseSim68KDat(shippedWith(14, '1234567$memory address'))).toBe(false);
    expect('ledAddress' in parseSim68KDat(shippedWith(24, '$LED address'))).toBe(false);
  });

  it('which stack: atoi, 0..8', () => {
    expect(parseSim68KDat(shippedWith(19, '0$which stack')).whichStack).toBe(0);
    expect(parseSim68KDat(shippedWith(19, '5$which stack')).whichStack).toBe(5);
    expect('whichStack' in parseSim68KDat(shippedWith(19, '9$which stack'))).toBe(false);
  });

  it('fonts: name as text, size with atoi; one of the pair alone keeps the default of the other', () => {
    const parsed = parseSim68KDat(shippedWith(28, 'Consolas$output font name'));
    expect(parsed.outputFont).toEqual({ name: 'Consolas', size: 9 });
    expect(parseSim68KDat(shippedWith(31, '14$listing font size')).listingFont).toEqual({
      name: 'Courier New',
      size: 14,
    });
    const bad = byteLines(SHIPPED);
    bad[27] = ascii('Consolas output font name');
    bad[28] = ascii('0$output font size');
    expect('outputFont' in parseSim68KDat(join(bad))).toBe(false);
  });

  it('auto trace interval: atoi, kept within the up/down control 10..1000', () => {
    expect(parseSim68KDat(shippedWith(36, '650$auto trace interval')).autoTraceIntervalMs).toBe(650);
    expect(parseSim68KDat(shippedWith(36, '5$auto trace interval')).autoTraceIntervalMs).toBe(10);
    expect(parseSim68KDat(shippedWith(36, '5000$auto trace interval')).autoTraceIntervalMs).toBe(1000);
  });

  it('window lines and the I/O window line are read and ignored', () => {
    const lines = byteLines(SHIPPED);
    lines[4] = ascii('9999$main top');
    lines[10] = ascii('0$simIO visible');
    const { panels: _p, ...settings } = parseSim68KDat(join(lines));
    expect(settings).toEqual(SHIPPED_SETTINGS);
  });
});

describe('parseSim68KDat: positional rule', () => {
  const changed = byteLines(writeSim68KDat(CHANGED_SIM, CHANGED_PANELS));

  it('a line removed in the middle: settings before it load, every setting after it is a default', () => {
    const lines = [...changed];
    lines.splice(19, 1); // line 20, $stack visible
    const parsed = parseSim68KDat(join(lines));
    expect(parsed.execLogType).toBe(3);
    expect(parsed.memoryAddress).toBe(0xabcd);
    expect(parsed.whichStack).toBe(2);
    expect(parsed.panels).toEqual({ memory: true });
    for (const key of ['seg7Address', 'outputFont', 'bitField', 'autoTraceIntervalMs'] as const) {
      expect(key in parsed).toBe(false);
    }
    // The last read runs past the end and matches the stale "$disable display" with a NUL as its
    // value: off, the default anyway.
    expect(parsed.disableDisplay).toBe(false);
    const imported = simSettingsFromDat(join(lines));
    expect(imported.settings.seg7Address).toBe(0xe00000);
    expect(imported.settings.autoTraceIntervalMs).toBe(200);
    expect(imported.panels).toEqual({ memory: true, stack: false, hardware: false });
  });

  it('an import of no bytes gives the defaults with every panel hidden', () => {
    expect(simSettingsFromDat(new Uint8Array())).toEqual({
      settings: SIM68K_DAT_DEFAULTS,
      panels: { memory: false, stack: false, hardware: false },
    });
  });
});

describe('writeSim68KDat (SIM68Ku.cpp:1430-1485)', () => {
  it('writes 37 lines with CR LF and the v5.16.1 header', () => {
    const lines = byteLines(writeSim68KDat(DEFAULT_SIM_SETTINGS, {}));
    expect(lines).toHaveLength(37);
    expect(decode(lines[0]!)).toBe(SIM68K_DAT_HEADER);
    expect(decode(lines[0]!)).toBe('$Settings for EASy68K Simulator v5.16.1  DO NOT EDIT THIS FILE!!!!');
  });

  it('writes raw bytes, not digits, on lines 2, 3 and 34', () => {
    const lines = byteLines(writeSim68KDat(CHANGED_SIM, CHANGED_PANELS));
    expect(Array.from(lines[1]!)).toEqual([3, ...ascii('$exec log')]);
    expect(Array.from(lines[2]!)).toEqual([1, ...ascii('$output log')]);
    expect(Array.from(lines[33]!)).toEqual([0, ...ascii('$fullscreen monitor')]);
  });

  it('equals the checked fixture written-sim68K.dat, which loads back to the same settings', () => {
    const written = writeSim68KDat(CHANGED_SIM, CHANGED_PANELS);
    const checked = fixture('written-sim68K.dat');
    expect(Array.from(written)).toEqual(Array.from(checked));
    const { panels, ...settings } = parseSim68KDat(checked);
    expect(settings).toEqual(datPart(CHANGED_SIM));
    expect(panels).toEqual(CHANGED_PANELS);
  });

  it('the shipped settings, written, are the shipped file except the header and the window lines', () => {
    const written = byteLines(writeSim68KDat({ ...DEFAULT_SIM_SETTINGS, ...SHIPPED_SETTINGS }, {}));
    const shipped = byteLines(SHIPPED);
    // The shipped file holds a developer's window positions (lines 5-10).
    for (let i = 1; i < 37; i++) {
      if (i >= 4 && i <= 9) continue;
      expect(Array.from(written[i]!), `line ${i + 1}`).toEqual(Array.from(shipped[i]!));
    }
    expect(
      byteLines(writeSim68KDat(DEFAULT_SIM_SETTINGS, {}))
        .slice(4, 10)
        .map((l) => decode(l)),
    ).toEqual([
      '100$main top',
      '100$main left',
      '500$main height',
      '744$main width',
      '300$simIO top',
      '200$simIO left',
    ]);
  });
});
