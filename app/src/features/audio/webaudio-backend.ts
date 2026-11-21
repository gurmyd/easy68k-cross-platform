// The audio backend of the browser (ARCHITECTURE.md 3.7): the AudioBackend the simulator's sound
// device, and the beeps of the simulator and EASyBIN, play through. Web Audio decodes the sounds
// (decodeAudioData) and mixes any number of them.
//
// The program's view never depends on this file. The sound device decides every result and the
// standard player's busy time from the WAV header and the injected clock; this backend only makes
// the sound, as well as the browser allows:
//
// - Autoplay. A browser starts audio only after the person has clicked or pressed a key. `resume()`
//   is called from those gestures (every run command, every key in the Output panel, 3.7); until
//   then playbacks wait.
// - A suspended context (a background tab in Safari, the system taking the audio device). Playbacks
//   requested meanwhile wait too.
// - Decoding is asynchronous. `load()` starts it at once (task 71 and 74 load ahead of play); a
//   playback asked for before its sound is decoded waits for it.
//
// A playback that had to wait starts where it would be by now had it started on time, so that what
// is heard stays in step with what the program sees: a sound whose time is over by then is not
// played at all, a loop joins at the right place. A wait shorter than LATE_START_S starts the sound
// from its beginning (a decode usually takes a few milliseconds and a tick should not lose its
// attack). A sound that cannot be decoded is silent; nothing is reported, as nothing would be on
// the original for a sound it cannot play.
//
// The logic (WebAudioBackend) depends on Web Audio only through the small AudioOutput interface, so
// it is tested under Node with a fake output; createBrowserAudioOutput() is the real one.
//
// Owner: SH5.

import type { AudioBackend, Bytes, SoundId } from '../../contracts';

/** A decoded sound; `duration` in seconds (AudioBuffer.duration). */
export interface DecodedSound {
  readonly duration: number;
}

/** What WebAudioBackend needs from Web Audio. */
export interface AudioOutput {
  /** Sound can be heard now: the audio context exists and runs. */
  readonly running: boolean;
  /** Decodes a whole file. The buffer is the output's to keep (decodeAudioData detaches it). */
  decode(data: ArrayBuffer): Promise<DecodedSound>;
  /** Starts a sound now at `offset` seconds; calls onEnded when it ends by itself. Returns stop. */
  start(sound: DecodedSound, loop: boolean, offset: number, onEnded: () => void): () => void;
  /** In a user gesture: creates the audio context if there is none and asks it to run. */
  unlock(): void;
  /** Outside a gesture: creates the audio context if the browser would let it run. */
  prepare(): void;
  /** Whether the audio context has been created. */
  readonly created: boolean;
  /** Calls `listener` each time the audio context starts running. */
  onRunning(listener: () => void): void;
}

/** A wait shorter than this (seconds) starts a sound from its beginning rather than part-way. */
export const LATE_START_S = 0.2;
/** More sounds than this at once are not started (a program that plays a slot in a tight loop). */
export const MAX_VOICES = 64;
/** Waiting playbacks beyond this many are checked for ones whose time has passed. */
const PRUNE_PENDING_AT = 64;

interface SoundEntry {
  decoded: DecodedSound | null;
  failed: boolean;
  released: boolean;
}

interface Playback {
  sound: SoundId;
  loop: boolean;
  /** When the playback was asked for, in milliseconds of `now()`. */
  requestedAt: number;
  /** Set once it has started. */
  stop: (() => void) | null;
}

export class WebAudioBackend implements AudioBackend {
  private readonly sounds = new Map<SoundId, SoundEntry>();
  private readonly playbacks = new Map<number, Playback>();
  private next = 1;

  /**
   * output: null where there is no Web Audio (the backend then plays nothing).
   * now: milliseconds, any origin (performance.now in the browser).
   */
  constructor(
    private readonly output: AudioOutput | null,
    private readonly now: () => number,
  ) {
    output?.onRunning(() => this.startWaiting());
  }

  load(data: Bytes): SoundId {
    const sound = this.next++;
    const entry: SoundEntry = { decoded: null, failed: false, released: false };
    this.sounds.set(sound, entry);
    if (!this.output) {
      entry.failed = true;
      return sound;
    }
    try {
      // A copy: decodeAudioData detaches the buffer it is given, and the caller keeps its bytes.
      const copy = data.slice().buffer;
      this.output.decode(copy).then(
        (decoded) => {
          entry.decoded = decoded;
          this.startWaiting(sound);
        },
        () => this.decodeFailed(sound, entry),
      );
    } catch {
      this.decodeFailed(sound, entry);
    }
    return sound;
  }

  play(sound: SoundId, loop: boolean): number {
    const handle = this.next++;
    const entry = this.sounds.get(sound);
    if (!this.output || !entry || entry.failed) return handle;
    if (this.playbacks.size >= PRUNE_PENDING_AT) this.dropExpired();
    const playback: Playback = { sound, loop, requestedAt: this.now(), stop: null };
    this.playbacks.set(handle, playback);
    this.tryStart(handle, playback);
    return handle;
  }

  stop(playback: number): void {
    const entry = this.playbacks.get(playback);
    if (!entry) return;
    this.playbacks.delete(playback);
    try {
      entry.stop?.();
    } catch {
      // already ended
    }
    this.freeIfDone(entry.sound);
  }

  release(sound: SoundId): void {
    const entry = this.sounds.get(sound);
    if (!entry) return;
    entry.released = true; // playbacks already asked for still play; the source nodes hold their buffers
    this.freeIfDone(sound);
  }

  resume(): void {
    try {
      this.output?.unlock();
    } catch {
      // no audio: the sound only is lost
    }
  }

  /**
   * For gestures anywhere in the window: resumes the audio context only if one exists already or a
   * playback is waiting, so that a page that never plays a sound never starts audio.
   */
  resumeIfWanted(): void {
    if (this.output && (this.output.created || this.waitingCount() > 0)) this.resume();
  }

  /** Playbacks asked for and not started yet (for tests and the browser check). */
  waitingCount(): number {
    let count = 0;
    for (const playback of this.playbacks.values()) if (!playback.stop) count++;
    return count;
  }

  /** Playbacks that have started and have not ended (for tests and the browser check). */
  soundingCount(): number {
    return this.playbacks.size - this.waitingCount();
  }

  /** The duration of a decoded sound in seconds; null while decoding or if it failed (tests, check). */
  decodedDuration(sound: SoundId): number | null {
    return this.sounds.get(sound)?.decoded?.duration ?? null;
  }

  /** Resolves when the sound is decoded or has failed: its duration in seconds, or null. */
  async whenDecoded(sound: SoundId): Promise<number | null> {
    for (;;) {
      const entry = this.sounds.get(sound);
      if (!entry || entry.failed) return null;
      if (entry.decoded) return entry.decoded.duration;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private decodeFailed(sound: SoundId, entry: SoundEntry): void {
    entry.failed = true;
    for (const [handle, playback] of this.playbacks) {
      if (playback.sound === sound && !playback.stop) this.playbacks.delete(handle);
    }
    this.freeIfDone(sound);
  }

  /** Starts what waits: the playbacks of one sound, or all of them. */
  private startWaiting(sound?: SoundId): void {
    for (const [handle, playback] of [...this.playbacks]) {
      if (!playback.stop && (sound === undefined || playback.sound === sound)) this.tryStart(handle, playback);
    }
  }

  private tryStart(handle: number, playback: Playback): void {
    const output = this.output;
    const entry = this.sounds.get(playback.sound);
    if (!output || !entry?.decoded) return; // waits for the decoder
    try {
      if (!output.running) output.prepare();
      // prepare() may have started it already, through the onRunning listener
      if (playback.stop || this.playbacks.get(handle) !== playback) return;
      if (!output.running) return; // waits for a gesture or for the context to run again
      const offset = this.offsetNow(playback, entry.decoded);
      if (offset === null || this.soundingCount() >= MAX_VOICES) {
        this.playbacks.delete(handle);
        this.freeIfDone(playback.sound);
        return;
      }
      playback.stop = output.start(entry.decoded, playback.loop, offset, () => {
        if (this.playbacks.get(handle) === playback) this.playbacks.delete(handle);
      });
      this.freeIfDone(playback.sound);
    } catch {
      this.playbacks.delete(handle);
    }
  }

  /** Where a playback starts now, in seconds; null if a once-only sound's time is over. */
  private offsetNow(playback: Playback, decoded: DecodedSound): number | null {
    const late = (this.now() - playback.requestedAt) / 1000;
    if (late < LATE_START_S) return 0;
    if (playback.loop) return decoded.duration > 0 ? late % decoded.duration : 0;
    return late < decoded.duration ? late : null;
  }

  /** Forgets waiting once-only playbacks whose time is over. */
  private dropExpired(): void {
    for (const [handle, playback] of [...this.playbacks]) {
      if (playback.stop || playback.loop) continue;
      const decoded = this.sounds.get(playback.sound)?.decoded;
      if (decoded && this.offsetNow(playback, decoded) === null) {
        this.playbacks.delete(handle);
        this.freeIfDone(playback.sound);
      }
    }
  }

  /** Drops a released sound once no playback waits for it. */
  private freeIfDone(sound: SoundId): void {
    const entry = this.sounds.get(sound);
    if (!entry?.released) return;
    for (const playback of this.playbacks.values()) if (playback.sound === sound && !playback.stop) return;
    this.sounds.delete(sound);
  }
}

/** Options of the browser's output. */
export interface BrowserAudioOptions {
  /** Where the sounds go; default the context's destination (the browser check puts an analyser between). */
  destination?: (context: AudioContext) => AudioNode;
}

/** The browser's Web Audio as an AudioOutput; null where the page has no AudioContext. */
export function createBrowserAudioOutput(options: BrowserAudioOptions = {}): AudioOutput | null {
  if (typeof AudioContext === 'undefined') return null;
  let context: AudioContext | null = null;
  let destination: AudioNode | null = null;
  let decoder: BaseAudioContext | null = null;
  const listeners: (() => void)[] = [];

  const create = (): AudioContext | null => {
    if (context) return context;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    const created = context;
    destination = options.destination ? options.destination(created) : created.destination;
    created.addEventListener('statechange', () => {
      if (created.state === 'running') for (const listener of listeners) listener();
    });
    return created;
  };
  /** Decoding needs no running context: before there is one, an offline context decodes. */
  const decodingContext = (): BaseAudioContext => {
    if (context) return context;
    decoder ??= new OfflineAudioContext(1, 1, 44100);
    return decoder;
  };

  return {
    get running() {
      return context?.state === 'running';
    },
    get created() {
      return context !== null;
    },
    decode: (data) => decodingContext().decodeAudioData(data),
    start(sound, loop, offset, onEnded) {
      const active = create();
      if (!active || !destination) return () => {};
      const source = active.createBufferSource();
      source.buffer = sound as AudioBuffer;
      source.loop = loop;
      source.connect(destination);
      source.addEventListener('ended', () => {
        source.disconnect();
        onEnded();
      });
      source.start(0, offset);
      return () => source.stop();
    },
    unlock() {
      const active = create();
      if (active && active.state !== 'running' && active.state !== 'closed') void active.resume().catch(() => {});
    },
    prepare() {
      // Without a past gesture the browser would refuse to start a new context, and say so in the
      // console; with one (sticky activation) it lets it run.
      const activation = (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation;
      if (!context && activation && !activation.hasBeenActive) return;
      const active = create();
      if (active && active.state === 'suspended' && activation?.hasBeenActive) void active.resume().catch(() => {});
    },
    onRunning(listener) {
      listeners.push(listener);
    },
  };
}
