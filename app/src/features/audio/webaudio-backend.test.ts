// The Web Audio backend's logic (3.7) with a fake AudioOutput under Node: waiting for the decoder,
// for a gesture and for a suspended context, starting late in step with the program, stop, release.

import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../contracts';
import { createAudioBackend, feature } from './index';
import { LATE_START_S, MAX_VOICES, WebAudioBackend, type AudioOutput, type DecodedSound } from './webaudio-backend';

interface Started {
  sound: DecodedSound;
  loop: boolean;
  offset: number;
  stopped: boolean;
  end(): void;
}

/** An AudioOutput whose decoder and context state the test drives. */
class FakeOutput implements AudioOutput {
  running = false;
  created = false;
  unlocks = 0;
  prepares = 0;
  /** What prepare() does: true = the browser lets a context run without a gesture. */
  autoplay = false;
  readonly decodes: { data: ArrayBuffer; resolve(duration: number): void; reject(): void }[] = [];
  readonly started: Started[] = [];
  private readonly listeners: (() => void)[] = [];
  failStart = false;

  decode(data: ArrayBuffer): Promise<DecodedSound> {
    return new Promise((resolve, reject) => {
      this.decodes.push({ data, resolve: (duration) => resolve({ duration }), reject: () => reject(new Error('bad')) });
    });
  }
  start(sound: DecodedSound, loop: boolean, offset: number, onEnded: () => void): () => void {
    if (this.failStart) throw new Error('InvalidStateError');
    const entry: Started = { sound, loop, offset, stopped: false, end: onEnded };
    this.started.push(entry);
    return () => {
      entry.stopped = true;
    };
  }
  unlock(): void {
    this.unlocks++;
    this.created = true;
  }
  prepare(): void {
    this.prepares++;
    if (this.autoplay) this.setRunning(true);
  }
  onRunning(listener: () => void): void {
    this.listeners.push(listener);
  }
  setRunning(running: boolean): void {
    this.created = true;
    this.running = running;
    if (running) for (const listener of this.listeners) listener();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function rig() {
  const output = new FakeOutput();
  let now = 1000;
  const backend = new WebAudioBackend(output, () => now);
  return {
    output,
    backend,
    advance(ms: number) {
      now += ms;
    },
  };
}

const BYTES = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4]);

describe('WebAudioBackend', () => {
  it('load() starts decoding at once, with a copy of the bytes (decodeAudioData detaches its buffer)', () => {
    const { output, backend } = rig();
    backend.load(BYTES);
    expect(output.decodes).toHaveLength(1);
    expect(new Uint8Array(output.decodes[0]!.data)).toEqual(BYTES);
    expect(output.decodes[0]!.data).not.toBe(BYTES.buffer);
  });

  it('a playback asked for before the sound is decoded starts when decoding ends', async () => {
    const { output, backend } = rig();
    output.setRunning(true);
    const sound = backend.load(BYTES);
    backend.play(sound, false);
    expect(output.started).toHaveLength(0);
    expect(backend.waitingCount()).toBe(1);
    output.decodes[0]!.resolve(1);
    await flush();
    expect(output.started).toEqual([expect.objectContaining({ loop: false, offset: 0 })]);
    expect(backend.soundingCount()).toBe(1);
    expect(backend.decodedDuration(sound)).toBe(1);
  });

  it('before any gesture (context not running): the playback waits, prepare() is tried, resume() unlocks', async () => {
    const { output, backend } = rig();
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(2);
    await flush();
    backend.play(sound, true);
    expect(output.prepares).toBe(1);
    expect(output.started).toHaveLength(0);
    backend.resume();
    expect(output.unlocks).toBe(1);
    output.setRunning(true);
    expect(output.started).toEqual([expect.objectContaining({ loop: true, offset: 0 })]);
  });

  it('where the browser allows audio without a new gesture, prepare() lets the sound start at once', async () => {
    const { output, backend } = rig();
    output.autoplay = true;
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(2);
    await flush();
    backend.play(sound, false);
    expect(output.started).toHaveLength(1);
  });

  it(`a wait of more than ${LATE_START_S} s: a once-only sound starts part-way, or not at all when its time is over`, async () => {
    const { output, backend, advance } = rig();
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(1);
    await flush();
    backend.play(sound, false); // asked at 1000 ms
    advance(150);
    backend.play(sound, false); // asked at 1150 ms
    advance(350); // 1500 ms: the first is 0.5 s late, the second 0.35 s
    output.setRunning(true);
    expect(output.started.map((s) => s.offset)).toEqual([0.5, 0.35]);

    output.setRunning(false);
    backend.play(sound, false);
    advance(1000);
    output.setRunning(true);
    expect(output.started).toHaveLength(2); // its second is over: never heard
    expect(backend.waitingCount()).toBe(0);
  });

  it('a short wait starts the sound from its beginning', async () => {
    const { output, backend, advance } = rig();
    output.setRunning(true);
    const sound = backend.load(BYTES);
    backend.play(sound, false);
    advance(50);
    output.decodes[0]!.resolve(0.1);
    await flush();
    expect(output.started[0]!.offset).toBe(0);
  });

  it('a loop that waited joins at the place it would have reached', async () => {
    const { output, backend, advance } = rig();
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(0.4);
    await flush();
    backend.play(sound, true);
    advance(1000);
    output.setRunning(true);
    expect(output.started[0]!.offset).toBeCloseTo(0.2, 9);
  });

  it('stop(): a waiting playback never starts; a sounding one is stopped', async () => {
    const { output, backend } = rig();
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(1);
    await flush();
    const waiting = backend.play(sound, false);
    backend.stop(waiting);
    output.setRunning(true);
    expect(output.started).toHaveLength(0);
    const sounding = backend.play(sound, true);
    expect(output.started).toHaveLength(1);
    backend.stop(sounding);
    expect(output.started[0]!.stopped).toBe(true);
    expect(backend.soundingCount()).toBe(0);
    backend.stop(sounding); // twice: nothing
    backend.stop(12345); // unknown: nothing
  });

  it('a sound that ends by itself is forgotten', async () => {
    const { output, backend } = rig();
    output.setRunning(true);
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(1);
    await flush();
    backend.play(sound, false);
    output.started[0]!.end();
    expect(backend.soundingCount()).toBe(0);
  });

  it('release(): what was asked for still plays; afterwards the sound is gone', async () => {
    const { output, backend } = rig();
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(1);
    await flush();
    backend.play(sound, false);
    backend.release(sound);
    expect(backend.decodedDuration(sound)).toBe(1); // a playback waits for it
    output.setRunning(true);
    expect(output.started).toHaveLength(1);
    expect(backend.decodedDuration(sound)).toBeNull();
    backend.play(sound, false);
    expect(output.started).toHaveLength(1);
  });

  it('release() during decoding, and a playing sound released: playback goes on', async () => {
    const { output, backend } = rig();
    output.setRunning(true);
    const sound = backend.load(BYTES);
    backend.play(sound, true);
    backend.release(sound);
    output.decodes[0]!.resolve(1);
    await flush();
    expect(output.started).toHaveLength(1);
    expect(output.started[0]!.stopped).toBe(false);
  });

  it('a sound that cannot be decoded is silent: no start, no throw, waiting playbacks dropped', async () => {
    const { output, backend } = rig();
    output.setRunning(true);
    const sound = backend.load(BYTES);
    const handle = backend.play(sound, false);
    output.decodes[0]!.reject();
    await flush();
    expect(backend.waitingCount()).toBe(0);
    expect(typeof handle).toBe('number');
    expect(typeof backend.play(sound, false)).toBe('number');
    expect(output.started).toHaveLength(0);
    expect(await backend.whenDecoded(sound)).toBeNull();
  });

  it(`at most ${MAX_VOICES} sounds at once`, async () => {
    const { output, backend } = rig();
    output.setRunning(true);
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(10);
    await flush();
    for (let index = 0; index < MAX_VOICES + 10; index++) backend.play(sound, false);
    expect(output.started).toHaveLength(MAX_VOICES);
  });

  it('many playbacks waiting while audio is suspended: those whose time is over are dropped', async () => {
    const { output, backend, advance } = rig();
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(0.05);
    await flush();
    for (let index = 0; index < 200; index++) {
      backend.play(sound, false);
      advance(10);
    }
    expect(backend.waitingCount()).toBeLessThan(80);
  });

  it('an output that throws on start: the playback is dropped, nothing propagates', async () => {
    const { output, backend } = rig();
    output.setRunning(true);
    output.failStart = true;
    const sound = backend.load(BYTES);
    output.decodes[0]!.resolve(1);
    await flush();
    expect(() => backend.play(sound, false)).not.toThrow();
    expect(backend.waitingCount()).toBe(0);
  });

  it('resumeIfWanted() starts no audio on a page that never played a sound', () => {
    const { output, backend } = rig();
    backend.resumeIfWanted();
    expect(output.unlocks).toBe(0);
    backend.play(backend.load(BYTES), false);
    backend.resumeIfWanted();
    expect(output.unlocks).toBe(1);
  });

  it('without Web Audio (output null): everything works and nothing is heard', async () => {
    const backend = new WebAudioBackend(null, () => 0);
    const sound = backend.load(BYTES);
    const playback = backend.play(sound, true);
    expect(() => {
      backend.stop(playback);
      backend.release(sound);
      backend.resume();
      backend.resumeIfWanted();
    }).not.toThrow();
    expect(await backend.whenDecoded(sound)).toBeNull();
  });
});

describe('feature "audio" under Node', () => {
  it('createAudioBackend() gives a backend that plays nothing and never throws where there is no AudioContext', () => {
    const backend = createAudioBackend({} as AppContext);
    expect(backend).toBeInstanceOf(WebAudioBackend);
    const sound = backend.load(BYTES);
    expect(() => backend.stop(backend.play(sound, false))).not.toThrow();
    expect(() => backend.resume()).not.toThrow();
  });

  it('init() without a window does nothing', () => {
    expect(feature.id).toBe('audio');
    expect(feature.init?.({} as AppContext)).toBeUndefined();
  });
});
