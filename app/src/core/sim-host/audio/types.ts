// Audio types and the WAV header reader (ARCHITECTURE.md 3.7). The interfaces live in
// contracts/devices.ts; this file is their home in the audio module.
//
// parseWav is a STUB written by W1 (wave 0): SH5 replaces its body; its name and signature are
// contract (section 8, "Stubs"). The stub reports every file as not a valid WAV (duration 0).
//
// Owner: W1 > SH5.

import type { Bytes, WavInfo } from '../../../contracts';

export type { AudioBackend, SoundDeviceDeps, SoundId, WavInfo } from '../../../contracts';

/** RIFF header only; PCM duration from the data chunk. */
export function parseWav(_data: Bytes): WavInfo {
  return { valid: false, durationMs: 0 };
}
