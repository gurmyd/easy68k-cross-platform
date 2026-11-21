// The original's Beep() (Form1u.cpp, fileIO.cpp: a refused key, an address past the end, an invalid
// save range). A web page has no system sound, so the port plays a short quiet tone through the
// window's audio backend (ctx.devices.audio, ARCHITECTURE.md 3.7). Owner: B1.

import type { AppContext, AudioBackend, Bytes, SoundId } from '../../contracts';

const RATE = 8000;
const FREQUENCY = 880;
const DURATION_MS = 70;
const AMPLITUDE = 24; // of 127: quiet

/** A mono 8-bit PCM WAV file of the beep tone (a sine with short fades). */
export function beepWave(): Bytes {
  const samples = Math.round((RATE * DURATION_MS) / 1000);
  const fade = Math.round(RATE * 0.005);
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  for (let index = 0; index < samples; index++) {
    const envelope = Math.min(1, index / fade, (samples - 1 - index) / fade);
    bytes[44 + index] = 128 + Math.round(Math.sin((2 * Math.PI * FREQUENCY * index) / RATE) * AMPLITUDE * envelope);
  }
  return bytes;
}

const loaded = new WeakMap<AudioBackend, SoundId>();

/** Plays the beep once. Never throws. */
export function beep(ctx: Pick<AppContext, 'devices'>): void {
  try {
    const backend = ctx.devices.audio;
    let sound = loaded.get(backend);
    if (sound === undefined) {
      sound = backend.load(beepWave());
      loaded.set(backend, sound);
    }
    backend.play(sound, false);
  } catch {
    // A missing or failing audio device only loses the sound.
  }
}
