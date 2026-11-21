// Test doubles for the sound device (ARCHITECTURE.md 3.7): an AudioBackend that records what it is
// asked and plays nothing, and a program-file reader that resolves names against a current
// directory that a test can change. Neither needs a sound card or real time.
//
// Owner: SH5.

import type { AudioBackend, Bytes, Clock, SoundId } from '../../../contracts';
import { parseWav } from './types';

export type FakeAudioEvent =
  | { kind: 'load'; sound: SoundId; bytes: number; at: number }
  | { kind: 'play'; sound: SoundId; playback: number; loop: boolean; at: number }
  | { kind: 'stop'; playback: number; at: number }
  | { kind: 'release'; sound: SoundId; at: number }
  | { kind: 'resume'; at: number };

/**
 * An AudioBackend that records every call. `sounds` holds the bytes each SoundId was loaded from;
 * `playing()` lists the playbacks that were started and not stopped (a test decides with its own
 * clock whether a once-only playback has ended by itself).
 */
export class FakeAudioBackend implements AudioBackend {
  readonly events: FakeAudioEvent[] = [];
  readonly sounds = new Map<SoundId, Bytes>();
  readonly released = new Set<SoundId>();
  private readonly active = new Map<number, { sound: SoundId; loop: boolean; at: number }>();
  private next = 1;

  /** `clock`: stamps the events (0 without one). */
  constructor(private readonly clock: Clock | null = null) {}

  private now(): number {
    return this.clock ? this.clock.now() : 0;
  }

  load(data: Bytes): SoundId {
    const sound = this.next++;
    this.sounds.set(sound, data.slice());
    this.events.push({ kind: 'load', sound, bytes: data.length, at: this.now() });
    return sound;
  }
  play(sound: SoundId, loop: boolean): number {
    const playback = this.next++;
    this.active.set(playback, { sound, loop, at: this.now() });
    this.events.push({ kind: 'play', sound, playback, loop, at: this.now() });
    return playback;
  }
  stop(playback: number): void {
    this.active.delete(playback);
    this.events.push({ kind: 'stop', playback, at: this.now() });
  }
  release(sound: SoundId): void {
    this.released.add(sound);
    this.events.push({ kind: 'release', sound, at: this.now() });
  }
  resume(): void {
    this.events.push({ kind: 'resume', at: this.now() });
  }

  /**
   * Playbacks started, not stopped and not yet over, in the order they started. A once-only
   * playback is over when the duration of its WAV header has passed on the clock (at once for
   * bytes that are no WAV file); without a clock it never ends by itself.
   */
  playing(): { playback: number; sound: SoundId; loop: boolean; at: number }[] {
    const now = this.now();
    return [...this.active]
      .filter(([, entry]) => {
        if (entry.loop || !this.clock) return true;
        const bytes = this.sounds.get(entry.sound);
        return bytes !== undefined && now < entry.at + parseWav(bytes).durationMs;
      })
      .map(([playback, entry]) => ({ playback, ...entry }));
  }
  /** The events of one kind. */
  eventsOf<K extends FakeAudioEvent['kind']>(kind: K): Extract<FakeAudioEvent, { kind: K }>[] {
    return this.events.filter((event): event is Extract<FakeAudioEvent, { kind: K }> => event.kind === kind);
  }
  /** The bytes of the sound a playback plays. */
  bytesOf(playback: number): Bytes | undefined {
    const play = this.eventsOf('play').find((event) => event.playback === playback);
    return play ? this.sounds.get(play.sound) : undefined;
  }
}

/**
 * A stand-in for `ProgramFiles.read` (3.8.4): files by folder, a relative name resolved against
 * `currentDir`, `\` and `/` both separators, letter case ignored. A test of the sound device needs
 * nothing more; the real rules are SH6's.
 */
export class FolderFiles {
  currentDir = '/';
  /** Every name asked for, as text, in order. */
  readonly asked: string[] = [];
  private readonly files = new Map<string, Bytes>();

  /** path: absolute, e.g. '/prog/tick.wav'. */
  add(path: string, data: Bytes): this {
    this.files.set(FolderFiles.key(path), data);
    return this;
  }
  remove(path: string): void {
    this.files.delete(FolderFiles.key(path));
  }

  readonly read = (name: Bytes): Bytes | null => {
    const text = String.fromCharCode(...name);
    this.asked.push(text);
    const path = /^[\\/]/.test(text) ? text : `${this.currentDir}/${text}`;
    return this.files.get(FolderFiles.key(path)) ?? null;
  };

  private static key(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').toUpperCase();
  }
}

/** A mono 8-bit PCM WAV file of `frames` silent frames at `rate` frames per second. */
export function silentWav(frames: number, rate = 8000): Bytes {
  const bytes = new Uint8Array(44 + frames).fill(128);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++) bytes[at + index] = text.charCodeAt(index);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, frames, true);
  return bytes;
}

/** Text as bytes, one byte per character (file names in tests). */
export function nameBytes(text: string): Bytes {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
}
