// parseWav (ARCHITECTURE.md 3.7): the six official sounds and the corner cases of the RIFF header.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { silentWav } from './testing';
import { parseWav, readWavHeader } from './types';

const official = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../../tests/corpus/official/${name}`, import.meta.url))));

/** Little-endian helpers to build headers by hand. */
const le32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const le16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const text = (value: string) => Array.from(value, (ch) => ch.charCodeAt(0));
const chunk = (id: string, body: number[], declared = body.length) => [
  ...text(id),
  ...le32(declared),
  ...body,
  ...(body.length & 1 ? [0] : []),
];
const fmt = (tag: number, channels: number, rate: number, byteRate: number, align: number, bits: number) =>
  chunk('fmt ', [...le16(tag), ...le16(channels), ...le32(rate), ...le32(byteRate), ...le16(align), ...le16(bits)]);
const riff = (...chunks: number[][]) => {
  const body = [...text('WAVE'), ...chunks.flat()];
  return Uint8Array.from([...text('RIFF'), ...le32(body.length), ...body]);
};

describe('parseWav: the six official sounds of tests/corpus/official', () => {
  // Durations from the headers, worked out by hand: data bytes / block align = frames; frames / rate.
  const cases: [string, number][] = [
    ['0.wav', (7849 / 22050) * 1000], // mono 8-bit 22050 Hz, 7849 bytes
    ['1.wav', (6662 / 22050) * 1000], // mono 8-bit 22050 Hz, 6662 bytes
    ['chime.wav', (34804 / 22050) * 1000], // stereo 8-bit 22050 Hz, 69608 bytes
    ['roger.wav', (11045 / 11025) * 1000], // mono 8-bit 11025 Hz, 11045 bytes
    ['tick.wav', (1178 / 11025) * 1000], // mono 16-bit 11025 Hz, 2356 bytes, a LIST chunk after the data
    ['tock.wav', (838 / 11025) * 1000], // mono 16-bit 11025 Hz, 1676 bytes, a LIST chunk after the data
  ];
  for (const [name, durationMs] of cases) {
    it(`${name}: valid, ${durationMs.toFixed(3)} ms`, () => {
      const info = parseWav(official(name));
      expect(info.valid).toBe(true);
      expect(info.durationMs).toBeCloseTo(durationMs, 6);
    });
  }
  it('rounded: 356, 302, 1578, 1002, 107 and 76 ms', () => {
    expect(cases.map(([name]) => Math.round(parseWav(official(name)).durationMs))).toEqual([
      356, 302, 1578, 1002, 107, 76,
    ]);
  });
});

describe('parseWav: the header', () => {
  it('a file written by silentWav: 8000 frames at 8000 Hz = 1000 ms', () => {
    expect(parseWav(silentWav(8000))).toEqual({ valid: true, durationMs: 1000 });
  });

  it('not a WAVE file: invalid, duration 0', () => {
    expect(parseWav(new Uint8Array())).toEqual({ valid: false, durationMs: 0 });
    expect(parseWav(Uint8Array.from(text('MThd\0\0\0\x06\0\x01\0\x01\0\x60')))).toEqual({
      valid: false,
      durationMs: 0,
    });
    expect(parseWav(Uint8Array.from(text('RIFF\x04\0\0\0AVI ')))).toEqual({ valid: false, durationMs: 0 });
    expect(parseWav(Uint8Array.from(text('RIFF')))).toEqual({ valid: false, durationMs: 0 });
  });

  it('no data chunk, no fmt chunk, a fmt chunk too short, no channels or no rate: invalid', () => {
    expect(parseWav(riff(fmt(1, 1, 8000, 8000, 1, 8))).valid).toBe(false);
    expect(parseWav(riff(chunk('data', [1, 2, 3, 4]))).valid).toBe(false);
    expect(parseWav(riff(chunk('fmt ', [1, 0, 1, 0]), chunk('data', [1, 2]))).valid).toBe(false);
    expect(parseWav(riff(fmt(1, 0, 8000, 8000, 1, 8), chunk('data', [1, 2]))).valid).toBe(false);
    expect(parseWav(riff(fmt(1, 1, 0, 8000, 1, 8), chunk('data', [1, 2]))).valid).toBe(false);
  });

  it('an empty data chunk is a valid sound of duration 0', () => {
    expect(parseWav(riff(fmt(1, 1, 8000, 8000, 1, 8), chunk('data', [])))).toEqual({ valid: true, durationMs: 0 });
  });

  it('chunks of odd size are padded; unknown chunks are skipped; data may come before fmt', () => {
    const header = readWavHeader(
      riff(chunk('LIST', [1, 2, 3]), chunk('data', new Array(400).fill(0)), fmt(1, 2, 1000, 4000, 4, 16)),
    );
    expect(header).toMatchObject({ channels: 2, sampleRate: 1000, blockAlign: 4, dataBytes: 400 });
    expect(
      parseWav(riff(chunk('LIST', [1, 2, 3]), fmt(1, 2, 1000, 4000, 4, 16), chunk('data', new Array(400).fill(0)))),
    ).toEqual({ valid: true, durationMs: 100 });
  });

  it('whole frames only: 7 bytes of 16-bit stereo are one frame', () => {
    expect(parseWav(riff(fmt(1, 2, 1000, 4000, 4, 16), chunk('data', [0, 0, 0, 0, 0, 0, 0]))).durationMs).toBe(1);
  });

  it('a block align of 0 is worked out from channels and bits', () => {
    expect(parseWav(riff(fmt(1, 2, 1000, 0, 0, 16), chunk('data', new Array(40).fill(0)))).durationMs).toBe(10);
  });

  it('a truncated file plays the bytes it has; a streaming size of $FFFFFFFF too', () => {
    const full = riff(fmt(1, 1, 1000, 1000, 1, 8), chunk('data', new Array(100).fill(0)));
    expect(parseWav(full.slice(0, full.length - 50)).durationMs).toBe(50);
    expect(
      parseWav(riff(fmt(1, 1, 1000, 1000, 1, 8), chunk('data', new Array(20).fill(0), 0xffffffff))).durationMs,
    ).toBe(20);
  });

  it('IEEE float and WAVE_FORMAT_EXTENSIBLE count frames like PCM', () => {
    expect(parseWav(riff(fmt(3, 1, 1000, 4000, 4, 32), chunk('data', new Array(400).fill(0)))).durationMs).toBe(100);
    expect(parseWav(riff(fmt(0xfffe, 1, 1000, 2000, 2, 16), chunk('data', new Array(400).fill(0)))).durationMs).toBe(
      200,
    );
  });

  it('compressed WAVE: the fact chunk gives the frames, else the byte rate the time', () => {
    // IMA ADPCM, 4000 frames at 8000 Hz in the fact chunk: 500 ms.
    expect(
      parseWav(
        riff(fmt(0x11, 1, 8000, 4055, 256, 4), chunk('fact', le32(4000)), chunk('data', new Array(2048).fill(0))),
      ).durationMs,
    ).toBe(500);
    // mu-law without fact: 8000 bytes per second, 2000 bytes: 250 ms.
    expect(parseWav(riff(fmt(7, 1, 8000, 8000, 1, 8), chunk('data', new Array(2000).fill(0)))).durationMs).toBe(250);
    // no fact and no byte rate: 0
    expect(parseWav(riff(fmt(7, 1, 8000, 0, 1, 8), chunk('data', new Array(2000).fill(0)))).durationMs).toBe(0);
  });
});
