// Uncompressed WAVE data as samples (ARCHITECTURE.md 3.7, trap15-b §11.6), so that the browser's
// backend can make an AudioBuffer at once instead of waiting for decodeAudioData.
//
// Why: decodeAudioData is asynchronous and in Chromium takes 30 to 100 ms even for a sound of a few
// kilobytes. The standard player's busy time starts when the program asks for the sound (the
// program's own clock, never the audio device), so a sound that waited for its decoder was heard
// that much later than the program believes it started, and the next sound, decoded ahead by
// task 71, started while it still sounded: graphicSound.X68's "one" and "zero" overlapped by 20 to
// 100 ms in every browser (gate I2). The original's one voice cannot do that. Every official sound
// is 8- or 16-bit PCM; for those the samples are converted here synchronously, the way the browsers'
// own WAV decoders convert them, and only other formats (ADPCM, mu-law ...) still wait for the
// decoder.
//
// Owner: SH5.

import type { Bytes } from '../../contracts';
import { readWavHeader } from '../../core/sim-host/audio/types';

/** The samples of a sound, one array per channel, as an AudioBuffer holds them (-1 to 1). */
export interface PcmSound {
  readonly sampleRate: number;
  /** Frames: the length of every channel array. */
  readonly length: number;
  readonly channels: Float32Array[];
}

const FORMAT_PCM = 0x0001;
const FORMAT_IEEE_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;

/** Web Audio's limit on the channels of a buffer. */
const MAX_CHANNELS = 32;

/**
 * The samples of an uncompressed WAVE file (integer PCM of 8, 16, 24 or 32 bits, IEEE float of 32
 * or 64 bits, also as WAVE_FORMAT_EXTENSIBLE), or null for anything else (the caller then lets the
 * browser decode it). 8-bit samples are unsigned, the others signed little-endian; an integer
 * sample of n bytes is divided by 2^(8n-1), as decodeAudioData does. Only whole frames are used.
 */
export function decodePcmWav(data: Bytes): PcmSound | null {
  const header = readWavHeader(data);
  if (header === null) return null;
  const tag = header.formatTag === FORMAT_EXTENSIBLE ? header.subFormatTag : header.formatTag;
  if (tag !== FORMAT_PCM && tag !== FORMAT_IEEE_FLOAT) return null;
  const { channels, sampleRate, dataBytes, dataOffset } = header;
  if (channels > MAX_CHANNELS) return null;
  const frameBytes = header.blockAlign > 0 ? header.blockAlign : channels * Math.ceil(header.bitsPerSample / 8);
  const sampleBytes = frameBytes / channels;
  if (!Number.isInteger(sampleBytes)) return null;
  const read = sampleReader(tag === FORMAT_IEEE_FLOAT, sampleBytes);
  if (read === null) return null;
  const length = Math.floor(dataBytes / frameBytes);
  if (length === 0) return null;
  const view = new DataView(data.buffer, data.byteOffset + dataOffset, length * frameBytes);
  const out: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel++) out.push(new Float32Array(length));
  for (let frame = 0, at = 0; frame < length; frame++) {
    for (let channel = 0; channel < channels; channel++, at += sampleBytes) {
      (out[channel] as Float32Array)[frame] = read(view, at);
    }
  }
  return { sampleRate, length, channels: out };
}

type SampleReader = (view: DataView, at: number) => number;

function sampleReader(float: boolean, bytes: number): SampleReader | null {
  if (float) {
    if (bytes === 4) return (view, at) => view.getFloat32(at, true);
    if (bytes === 8) return (view, at) => view.getFloat64(at, true);
    return null;
  }
  switch (bytes) {
    case 1:
      return (view, at) => (view.getUint8(at) - 128) / 128;
    case 2:
      return (view, at) => view.getInt16(at, true) / 32768;
    case 3:
      return (view, at) => (((view.getUint8(at + 2) << 24) | (view.getUint16(at, true) << 8)) >> 8) / 8388608;
    case 4:
      return (view, at) => view.getInt32(at, true) / 2147483648;
    default:
      return null;
  }
}
