// Audio types and the WAV header reader (ARCHITECTURE.md 3.7). The interfaces live in
// contracts/devices.ts; this file is their home in the audio module.
//
// parseWav reads the RIFF header of a sound file and nothing else: whether the file is a WAVE file
// the original's players accept, and how long it plays. The standard player's busy flag is computed
// from that duration (trap15-b §11.3, hazard H6), never from the audio device, so a program that
// waits for the player to become free sees the same timing whether or not sound is heard.
//
// Owner: W1 > SH5.

import type { Bytes, WavInfo } from '../../../contracts';

export type { AudioBackend, SoundDeviceDeps, SoundId, WavInfo } from '../../../contracts';

/** What parseWav reports for anything that is not a WAVE file it can read. */
const NOT_A_WAV: WavInfo = Object.freeze({ valid: false, durationMs: 0 });

/** WAVE format tags whose data chunk holds whole frames of `blockAlign` bytes. */
const FORMAT_PCM = 0x0001;
const FORMAT_IEEE_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;

/** The fields of the header that the duration needs. */
export interface WavHeader {
  formatTag: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  /** Bytes of sound data: the data chunk's size, cut to the bytes the file really has. */
  dataBytes: number;
  /** Sample frames according to the `fact` chunk, or null without one. */
  factFrames: number | null;
  /** Where the sound data starts in the file (the body of the `data` chunk). */
  dataOffset: number;
  /** WAVE_FORMAT_EXTENSIBLE: the format tag of its sub-format GUID; null for other formats or a short chunk. */
  subFormatTag: number | null;
}

const ascii = (data: Bytes, at: number, text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    if (data[at + index] !== text.charCodeAt(index)) return false;
  }
  return true;
};
const u16 = (data: Bytes, at: number): number => (data[at] as number) | ((data[at + 1] as number) << 8);
const u32 = (data: Bytes, at: number): number => (u16(data, at) + u16(data, at + 2) * 0x10000) >>> 0;

/**
 * The header of a RIFF WAVE file: the `fmt ` chunk, the size of the `data` chunk and the `fact`
 * chunk, found by walking the chunk list (chunks are padded to an even size). Null if the file does
 * not start with `RIFF....WAVE`, or has no `fmt ` or no `data` chunk, or its format has no channels
 * or no sample rate.
 */
export function readWavHeader(data: Bytes): WavHeader | null {
  if (data.length < 12 || !ascii(data, 0, 'RIFF') || !ascii(data, 8, 'WAVE')) return null;
  let format: Omit<WavHeader, 'dataBytes' | 'factFrames' | 'dataOffset'> | null = null;
  let dataBytes: number | null = null;
  let dataOffset = 0;
  let factFrames: number | null = null;
  for (let at = 12; at + 8 <= data.length;) {
    const size = u32(data, at + 4);
    const body = at + 8;
    if (ascii(data, at, 'fmt ') && format === null && size >= 16 && body + 16 <= data.length) {
      const formatTag = u16(data, body);
      // WAVEFORMATEXTENSIBLE: cbSize (22) at 16, then 22 bytes; the GUID's first two bytes at 24.
      const extensible = formatTag === FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= data.length;
      format = {
        formatTag,
        channels: u16(data, body + 2),
        sampleRate: u32(data, body + 4),
        byteRate: u32(data, body + 8),
        blockAlign: u16(data, body + 12),
        bitsPerSample: u16(data, body + 14),
        subFormatTag: extensible ? u16(data, body + 24) : null,
      };
    } else if (ascii(data, at, 'fact') && factFrames === null && size >= 4 && body + 4 <= data.length) {
      factFrames = u32(data, body);
    } else if (ascii(data, at, 'data') && dataBytes === null) {
      // A truncated file (or a streaming header with size $FFFFFFFF) plays what is there.
      dataBytes = Math.min(size, data.length - body);
      dataOffset = body;
    }
    if (format !== null && dataBytes !== null && factFrames !== null) break;
    at = body + size + (size & 1);
  }
  if (format === null || dataBytes === null || format.channels === 0 || format.sampleRate === 0) return null;
  return { ...format, dataBytes, factFrames, dataOffset };
}

/** How long the sound of a WAVE header plays, in milliseconds. */
export function wavDurationMs(header: WavHeader): number {
  const { formatTag, channels, sampleRate, byteRate, blockAlign, bitsPerSample, dataBytes, factFrames } = header;
  if (formatTag === FORMAT_PCM || formatTag === FORMAT_IEEE_FLOAT || formatTag === FORMAT_EXTENSIBLE) {
    const frameBytes = blockAlign > 0 ? blockAlign : channels * Math.ceil(bitsPerSample / 8);
    return frameBytes > 0 ? (Math.floor(dataBytes / frameBytes) * 1000) / sampleRate : 0;
  }
  // Compressed WAVE (ADPCM, mu-law ...): the frame count of the fact chunk, else the byte rate.
  if (factFrames !== null) return (factFrames * 1000) / sampleRate;
  return byteRate > 0 ? (dataBytes * 1000) / byteRate : 0;
}

/** RIFF header only; PCM duration from the data chunk. */
export function parseWav(data: Bytes): WavInfo {
  const header = readWavHeader(data);
  return header === null ? NOT_A_WAV : { valid: true, durationMs: wavDurationMs(header) };
}
