// decodePcmWav (pcm.ts): the official sounds and every uncompressed sample format, converted the
// way the browsers' WAV decoders convert them; compressed formats are left to the browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWav, readWavHeader } from '../../core/sim-host/audio/types';
import { decodePcmWav } from './pcm';

const official = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../tests/corpus/official/${name}`, import.meta.url))));

const le32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const le16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const text = (value: string) => Array.from(value, (ch) => ch.charCodeAt(0));
const chunk = (id: string, body: number[]) => [
  ...text(id),
  ...le32(body.length),
  ...body,
  ...(body.length & 1 ? [0] : []),
];
const fmt = (tag: number, channels: number, rate: number, align: number, bits: number, extra: number[] = []) =>
  chunk('fmt ', [
    ...le16(tag),
    ...le16(channels),
    ...le32(rate),
    ...le32(rate * align),
    ...le16(align),
    ...le16(bits),
    ...extra,
  ]);
const riff = (...chunks: number[][]) => {
  const body = [...text('WAVE'), ...chunks.flat()];
  return Uint8Array.from([...text('RIFF'), ...le32(body.length), ...body]);
};
/** The 22 bytes after cbSize of WAVEFORMATEXTENSIBLE, with the sub-format's tag first in the GUID. */
const extensible = (bits: number, subTag: number) => [
  ...le16(22),
  ...le16(bits),
  ...le32(0),
  ...le16(subTag),
  ...[0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71],
];

describe('decodePcmWav', () => {
  for (const name of ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav']) {
    it(`${name}: every frame, at the file's rate, as long as parseWav says`, () => {
      const data = official(name);
      const header = readWavHeader(data)!;
      const pcm = decodePcmWav(data)!;
      expect(pcm).not.toBeNull();
      expect(pcm.sampleRate).toBe(header.sampleRate);
      expect(pcm.channels).toHaveLength(header.channels);
      expect((pcm.length / pcm.sampleRate) * 1000).toBeCloseTo(parseWav(data).durationMs, 9);
      for (const samples of pcm.channels) {
        expect(samples).toHaveLength(pcm.length);
        for (const sample of samples) expect(Math.abs(sample)).toBeLessThanOrEqual(1);
      }
      // The first sample, by hand.
      const at = header.dataOffset;
      const first =
        header.bitsPerSample === 8
          ? ((data[at] as number) - 128) / 128
          : ((((data[at] as number) | ((data[at + 1] as number) << 8)) << 16) >> 16) / 32768;
      expect(pcm.channels[0]![0]).toBeCloseTo(first, 9);
    });
  }

  it('8-bit unsigned, 16-, 24- and 32-bit signed integers: divided by 2^(bits-1)', () => {
    const u8 = decodePcmWav(riff(fmt(1, 1, 8000, 1, 8), chunk('data', [0, 128, 255])))!;
    expect([...u8.channels[0]!]).toEqual([-1, 0, 127 / 128]);
    const s16 = decodePcmWav(
      riff(fmt(1, 1, 8000, 2, 16), chunk('data', [...le16(0x8000), ...le16(0x7fff), ...le16(1)])),
    )!;
    expect([...s16.channels[0]!]).toEqual([-1, 32767 / 32768, 1 / 32768].map(Math.fround));
    const s24 = decodePcmWav(
      riff(fmt(1, 1, 8000, 3, 24), chunk('data', [0, 0, 0x80, 0xff, 0xff, 0x7f, 0xff, 0xff, 0xff])),
    )!;
    expect([...s24.channels[0]!]).toEqual([-1, 8388607 / 8388608, -1 / 8388608].map(Math.fround));
    const s32 = decodePcmWav(riff(fmt(1, 1, 8000, 4, 32), chunk('data', [...le32(0x80000000), ...le32(0x40000000)])))!;
    expect([...s32.channels[0]!]).toEqual([-1, 0.5]);
  });

  it('IEEE float of 32 and 64 bits as they are; channels interleaved by frame', () => {
    const f32 = new Uint8Array(new Float32Array([0.25, -0.5, 1, -1]).buffer);
    const stereo = decodePcmWav(riff(fmt(3, 2, 8000, 8, 32), chunk('data', [...f32])))!;
    expect(stereo.length).toBe(2);
    expect([...stereo.channels[0]!]).toEqual([0.25, 1]);
    expect([...stereo.channels[1]!]).toEqual([-0.5, -1]);
    const f64 = new Uint8Array(new Float64Array([0.125]).buffer);
    expect([...decodePcmWav(riff(fmt(3, 1, 8000, 8, 64), chunk('data', [...f64])))!.channels[0]!]).toEqual([0.125]);
  });

  it('WAVE_FORMAT_EXTENSIBLE by its sub-format; whole frames only; data before fmt', () => {
    const pcm = decodePcmWav(
      riff(fmt(0xfffe, 1, 8000, 2, 16, extensible(16, 1)), chunk('data', [0, 0x40, 0, 0xc0, 9])),
    )!;
    expect([...pcm.channels[0]!]).toEqual([0.5, -0.5]);
    const float = new Uint8Array(new Float32Array([0.75]).buffer);
    expect([
      ...decodePcmWav(riff(chunk('data', [...float]), fmt(0xfffe, 1, 8000, 4, 32, extensible(32, 3))))!.channels[0]!,
    ]).toEqual([0.75]);
  });

  it('null for what the browser must decode or cannot hold: compressed, odd sizes, no frames, not a WAVE file', () => {
    expect(decodePcmWav(riff(fmt(2, 1, 8000, 256, 4), chunk('data', [1, 2, 3, 4])))).toBeNull(); // MS ADPCM
    expect(decodePcmWav(riff(fmt(7, 1, 8000, 1, 8), chunk('data', [1, 2, 3, 4])))).toBeNull(); // mu-law
    expect(decodePcmWav(riff(fmt(0xfffe, 1, 8000, 1, 8, extensible(8, 7)), chunk('data', [1])))).toBeNull();
    expect(decodePcmWav(riff(fmt(0xfffe, 1, 8000, 2, 16), chunk('data', [1, 2])))).toBeNull(); // no sub-format
    expect(decodePcmWav(riff(fmt(1, 2, 8000, 3, 12), chunk('data', [1, 2, 3])))).toBeNull(); // 1.5 bytes a sample
    expect(decodePcmWav(riff(fmt(1, 1, 8000, 5, 40), chunk('data', [1, 2, 3, 4, 5])))).toBeNull();
    expect(decodePcmWav(riff(fmt(3, 1, 8000, 2, 16), chunk('data', [1, 2])))).toBeNull(); // 16-bit float
    expect(decodePcmWav(riff(fmt(1, 1, 8000, 2, 16), chunk('data', [1])))).toBeNull(); // no whole frame
    expect(decodePcmWav(riff(fmt(1, 33, 8000, 33, 8), chunk('data', new Array(33).fill(0))))).toBeNull();
    expect(decodePcmWav(Uint8Array.from(text('MThd\0\0\0\x06')))).toBeNull();
  });

  it('reads the bytes where they are inside a larger buffer (a view of the file store)', () => {
    const file = riff(fmt(1, 1, 8000, 1, 8), chunk('data', [255, 0]));
    const store = new Uint8Array(file.length + 10);
    store.set(file, 7);
    expect([...decodePcmWav(store.subarray(7, 7 + file.length))!.channels[0]!]).toEqual([127 / 128, -1]);
  });
});
