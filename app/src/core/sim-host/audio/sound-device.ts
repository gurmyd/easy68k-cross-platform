// Sound of the simulator (ARCHITECTURE.md 3.7): the standard and the DirectX player of
// trap15-b §11 over an AudioBackend.
//
// Everything a 68000 program can observe is decided here, from the file bytes and the injected
// clock, and never from the audio device: the D0 results (and the cases where D0 is not written,
// `undefined`), the standard player's busy flag, `currentWave`, the sticky looping of a DirectX
// slot, and what a simulator reset keeps. The backend only makes the sound; whether the browser
// lets it be heard (autoplay policy, a suspended context in a background tab, a failed decode)
// changes nothing a program sees.
//
// The two players of the original (simIOu.cpp:1593-1846):
//
//   standard (tasks 70, 71, 72, 76)  Windows' PlaySound with SND_ASYNC | SND_NOSTOP: one voice; a
//       request while a sound started by this process still plays is refused with D0.W = 0. The
//       port knows when that is from the WAV header: busyUntil = start + duration, Infinity for a
//       loop, 0 after a stop. 256 slots of raw file bytes (task 71 does not check them).
//   DirectX (tasks 73, 74, 75, 77)   DirectMusic: any number of overlapping voices; 256 slots of
//       loaded segments. Reported as available (trap15-b §11.1). A file the loader rejects (here:
//       anything that is not a RIFF WAVE file) gives `'<name>' Error loading ` and D0.W = 0.
//
// File names are passed as the program gave them to `readProgramFile`, which resolves them against
// the simulated program's current directory exactly as the program's own file tasks do (3.8.4);
// nothing here remembers a name, so a file changed or added on disk is read anew at every task.
//
// Owner: W1 > SH5.

import type { Bytes, SoundDeviceApi, SoundDeviceDeps, SoundId } from '../../../contracts';
import { decode } from '../../codec/cp1252';
import { parseWav } from './types';

export type { SoundDeviceDeps } from '../../../contracts';

/** Slots of each player (WAVES in the original). Tasks pass `D1.B`, so 0-255. */
export const SOUND_SLOTS = 256;

/** A slot of the standard player: the file bytes, registered with the backend when loaded. */
interface StandardSlot {
  sound: SoundId;
  durationMs: number;
}

/** The one voice of the standard player. */
interface StandardVoice {
  playback: number;
  sound: SoundId;
  /** The device releases `sound` when this voice ends: a task 70 file, or a slot reloaded meanwhile. */
  owned: boolean;
}

/** A playback of the DirectX player, with the time it ends by itself (Infinity for a loop). */
interface DxVoice {
  playback: number;
  endsAt: number;
}

/** A slot of the DirectX player. */
interface DxSlot {
  sound: SoundId;
  durationMs: number;
  /** Task 77 command 1 sets it; later plays of the slot loop too, until the slot is reloaded or reset. */
  looping: boolean;
  voices: DxVoice[];
}

/** A task 73 sound: it cannot be stopped by a program and plays on across a simulator reset. */
interface FileVoice extends DxVoice {
  sound: SoundId;
}

export class SoundDevice implements SoundDeviceApi {
  private standard: (StandardSlot | null)[] = new Array<StandardSlot | null>(SOUND_SLOTS).fill(null);
  private voice: StandardVoice | null = null;
  private standardBusyUntil = 0;
  /** The slot last handed to task 72 or 76 (commands 0 and 1); a reset keeps it (trap15-b §3.2). */
  private currentWave = -1;

  private dx: (DxSlot | null)[] = new Array<DxSlot | null>(SOUND_SLOTS).fill(null);
  /** Voices of DirectX slots that were loaded again: they play on, but no slot names them any more. */
  private dxOrphans: DxVoice[] = [];
  private fileVoices: FileVoice[] = [];

  constructor(private readonly deps: SoundDeviceDeps) {}

  /** Standard player: time on the injected clock until which a new request is refused. */
  get busyUntil(): number {
    return this.standardBusyUntil;
  }

  /* ---------------------------------------------------------------- standard player */

  /** Task 70: play a file. 1 started, 0 busy; a missing file leaves D0 as it is. */
  playSound(fileName: Bytes): number | undefined {
    this.prune();
    const data = this.read(fileName);
    if (data === null) return undefined;
    if (this.busy()) return 0;
    const sound = this.deps.backend.load(data);
    this.startStandard(sound, parseWav(data).durationMs, false, true);
    return 1;
  }

  /** Task 71: load a file into a slot. No register is written; a missing file leaves the slot. */
  loadSound(fileName: Bytes, waveIndex: number): void {
    this.prune();
    const data = this.read(fileName);
    if (data === null) return;
    const slot = waveIndex & 0xff;
    this.dropStandardSlot(slot);
    this.standard[slot] = { sound: this.deps.backend.load(data), durationMs: parseWav(data).durationMs };
  }

  /** Task 72: play a slot. 1 started, 0 busy; an empty slot leaves D0 as it is. */
  playSoundMem(waveIndex: number): number | undefined {
    this.prune();
    const slot = waveIndex & 0xff;
    const loaded = this.standard[slot];
    if (!loaded) return undefined;
    this.currentWave = slot; // set even when the player is busy and nothing starts
    return this.playStandardSlot(loaded, false);
  }

  /** Task 76: control the standard player (trap15-b §11.3, table). D0.W is always written. */
  controlSound(control: number, waveIndex: number): number | undefined {
    this.prune();
    const slot = waveIndex & 0xff;
    const loaded = this.standard[slot];
    let result = 0;
    if (loaded) {
      if (control === 0 || control === 1) {
        this.currentWave = slot;
        result = this.playStandardSlot(loaded, control === 1);
      } else if (control === 2 && slot === this.currentWave) {
        this.stopStandard(); // stops whatever the standard player plays, not only this slot
        result = 1;
      }
    }
    if (control === 3) {
      this.stopStandard(); // with any D1.B, loaded or not
      result = 1;
    }
    return result;
  }

  /* ---------------------------------------------------------------- DirectX player */

  /** Task 73: play a file once. 1 played; 0 for a missing file or one the loader rejects. */
  playSoundDX(fileName: Bytes): number | undefined {
    this.prune();
    const data = this.read(fileName);
    if (data === null) return 0;
    const info = parseWav(data);
    if (!info.valid) {
      this.loadError(fileName);
      return 0;
    }
    const sound = this.deps.backend.load(data);
    const playback = this.deps.backend.play(sound, false);
    this.fileVoices.push({ sound, playback, endsAt: this.deps.clock.now() + info.durationMs });
    return 1;
  }

  /** Task 74: load a file into a slot. 1 loaded; 0 for a missing file (slot kept) or a rejected one (slot empty). */
  loadSoundDX(fileName: Bytes, waveIndex: number): number | undefined {
    this.prune();
    const data = this.read(fileName);
    if (data === null) return 0;
    const slot = waveIndex & 0xff;
    const old = this.dx[slot];
    if (old) {
      // Released, not stopped (simIOu.cpp:1752-1753): what it plays goes on, out of the program's reach.
      this.dxOrphans.push(...old.voices);
      this.deps.backend.release(old.sound);
      this.dx[slot] = null;
    }
    const info = parseWav(data);
    if (!info.valid) {
      this.loadError(fileName); // the original leaves the slot undefined; the port treats it as empty
      return 0;
    }
    this.dx[slot] = { sound: this.deps.backend.load(data), durationMs: info.durationMs, looping: false, voices: [] };
    return 1;
  }

  /** Task 75: one more playback of a slot. 1 played, 0 empty slot. */
  playSoundMemDX(waveIndex: number): number | undefined {
    this.prune();
    const loaded = this.dx[waveIndex & 0xff];
    if (!loaded) return 0;
    this.playDx(loaded, loaded.looping);
    return 1;
  }

  /** Task 77: control the DirectX player (trap15-b §11.4, table). Nothing at all for an empty slot. */
  controlSoundDX(control: number, waveIndex: number): number | undefined {
    this.prune();
    const loaded = this.dx[waveIndex & 0xff];
    if (!loaded) return 0; // "stop all" too: everything is inside the test of the slot
    switch (control) {
      case 0:
        this.playDx(loaded, loaded.looping);
        return 1;
      case 1:
        loaded.looping = true; // sticky: SetRepeats on the segment is never undone
        this.playDx(loaded, true);
        return 1;
      case 2:
        this.stopDxSlot(loaded);
        return 1;
      case 3:
        for (const slot of this.dx) if (slot) this.stopDxSlot(slot);
        return 1;
      default:
        return 0;
    }
  }

  /* ---------------------------------------------------------------- reset */

  /**
   * The engine's reset (initSim, trap15-b §11.5): the standard player stops, both slot arrays are
   * emptied, every slot's voices stop. The task 73 sounds play on; `currentWave` stays.
   */
  resetSounds(): void {
    this.stopStandard();
    for (let slot = 0; slot < SOUND_SLOTS; slot++) this.dropStandardSlot(slot);
    for (let slot = 0; slot < SOUND_SLOTS; slot++) {
      const loaded = this.dx[slot];
      if (!loaded) continue;
      this.stopDxSlot(loaded);
      this.deps.backend.release(loaded.sound);
      this.dx[slot] = null;
    }
    for (const orphan of this.dxOrphans) this.deps.backend.stop(orphan.playback);
    this.dxOrphans = [];
  }

  /** A cold start (4.7.1): as a reset, and the task 73 sounds stop and `currentWave` is -1 again. */
  resetToStartup(): void {
    this.resetSounds();
    for (const voice of this.fileVoices) {
      this.deps.backend.stop(voice.playback);
      this.deps.backend.release(voice.sound);
    }
    this.fileVoices = [];
    this.currentWave = -1;
  }

  /* ---------------------------------------------------------------- helpers */

  /** The whole file, or null after adding `'<name>' not found` to the message area. */
  private read(fileName: Bytes): Bytes | null {
    const data = this.deps.readProgramFile(fileName);
    if (data === null) this.deps.message(`'${decode(fileName)}' not found`);
    return data;
  }

  private loadError(fileName: Bytes): void {
    this.deps.message(`'${decode(fileName)}' Error loading `);
  }

  /** A sound started by this process is still playing (SND_NOSTOP refuses the request). */
  private busy(): boolean {
    return this.deps.clock.now() < this.standardBusyUntil;
  }

  private playStandardSlot(slot: StandardSlot, loop: boolean): number {
    if (this.busy()) return 0;
    this.startStandard(slot.sound, slot.durationMs, loop, false);
    return 1;
  }

  /** Starts the one voice; the previous one has ended by itself (the player is not busy). */
  private startStandard(sound: SoundId, durationMs: number, loop: boolean, owned: boolean): void {
    this.endVoice(false);
    const playback = this.deps.backend.play(sound, loop);
    this.voice = { playback, sound, owned };
    this.standardBusyUntil = loop ? Infinity : this.deps.clock.now() + durationMs;
  }

  /** PlaySound(NULL, NULL, SND_PURGE). */
  private stopStandard(): void {
    this.endVoice(true);
    this.standardBusyUntil = 0;
  }

  private endVoice(stop: boolean): void {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    if (stop) this.deps.backend.stop(voice.playback);
    if (voice.owned) this.deps.backend.release(voice.sound);
  }

  /** Empties a standard slot. A voice still playing its sound keeps it (the original leaks the buffer). */
  private dropStandardSlot(slot: number): void {
    const old = this.standard[slot];
    if (!old) return;
    this.standard[slot] = null;
    if (this.voice && this.voice.sound === old.sound && !this.voice.owned) this.voice.owned = true;
    else this.deps.backend.release(old.sound);
  }

  private playDx(slot: DxSlot, loop: boolean): void {
    const playback = this.deps.backend.play(slot.sound, loop);
    slot.voices.push({ playback, endsAt: loop ? Infinity : this.deps.clock.now() + slot.durationMs });
  }

  private stopDxSlot(slot: DxSlot): void {
    for (const voice of slot.voices) this.deps.backend.stop(voice.playback);
    slot.voices = [];
  }

  /** Forgets voices that have ended by themselves, and releases the task 73 sounds they used. */
  private prune(): void {
    const now = this.deps.clock.now();
    const playing = (voice: DxVoice): boolean => now < voice.endsAt;
    for (const slot of this.dx) if (slot && slot.voices.length > 0) slot.voices = slot.voices.filter(playing);
    if (this.dxOrphans.length > 0) this.dxOrphans = this.dxOrphans.filter(playing);
    if (this.fileVoices.length > 0) {
      const ended = this.fileVoices.filter((voice) => !playing(voice));
      for (const voice of ended) this.deps.backend.release(voice.sound);
      if (ended.length > 0) this.fileVoices = this.fileVoices.filter(playing);
    }
  }
}
