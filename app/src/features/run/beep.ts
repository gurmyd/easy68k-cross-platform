// The bell (trap15-a §3.4): the character $07 makes the original call the Windows `Beep()`, the
// system's default sound. A page has no system sound, so the port plays a short tone of its own
// through the audio backend. A program cannot observe the difference.
//
// Owner: SH8.

import type { AudioBackend, Bytes } from '../../contracts';

const SAMPLE_RATE = 11025;
const TONE_HZ = 800;
const DURATION_MS = 150;
/** The last milliseconds fade out, so that the tone does not end with a click. */
const FADE_MS = 20;

/** A short sine tone as a WAV file: 8-bit unsigned mono PCM. */
export function beepWav(): Bytes {
  const samples = Math.round((SAMPLE_RATE * DURATION_MS) / 1000);
  const fade = Math.round((SAMPLE_RATE * FADE_MS) / 1000);
  const wav = new Uint8Array(44 + samples);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // size of the format chunk
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // bytes per second
  view.setUint16(32, 1, true); // bytes per sample frame
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) {
    const volume = 0.4 * Math.min(1, (samples - i) / fade);
    wav[44 + i] = Math.round(128 + 127 * volume * Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE));
  }
  return wav;
}

/** The session's `beep`: the tone is given to the audio backend the first time it is needed. */
export function createBeep(audio: AudioBackend): () => void {
  let sound: number | null = null;
  return () => {
    sound ??= audio.load(beepWav());
    audio.play(sound, false);
  };
}
