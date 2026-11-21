// The sound device (ARCHITECTURE.md 3.7) against the task tables of trap15-b §11 and the rows of
// §13 about sound (8 to 14), with a fake audio backend and virtual time: nothing here needs a sound
// card or real time.

import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioBackend } from '../../../contracts';
import { VirtualTime } from '../../run/clock';
import { SoundDevice } from './sound-device';
import { FakeAudioBackend, FolderFiles, nameBytes, silentWav } from './testing';

/** 100 ms, 250 ms and 1000 ms sounds at 8000 Hz. */
const SHORT = silentWav(800);
const MEDIUM = silentWav(2000);
const LONG = silentWav(8000);
const MIDI = nameBytes('MThd\0\0\0\x06\0\x01\0\x01\0\x60MTrk');

let time: VirtualTime;
let backend: FakeAudioBackend;
let files: FolderFiles;
let messages: string[];
let device: SoundDevice;
const n = nameBytes;

function build(audio: AudioBackend = backend): SoundDevice {
  return new SoundDevice({
    backend: audio,
    clock: time,
    readProgramFile: files.read,
    message: (t) => messages.push(t),
  });
}

beforeEach(() => {
  time = new VirtualTime();
  backend = new FakeAudioBackend(time);
  files = new FolderFiles();
  files.currentDir = '/prog';
  files.add('/prog/short.wav', SHORT).add('/prog/medium.wav', MEDIUM).add('/prog/long.wav', LONG);
  files.add('/prog/song.mid', MIDI).add('/prog/junk.wav', nameBytes('not a sound at all'));
  messages = [];
  device = build();
});

/** The playbacks the backend has started and not stopped. */
const playing = () => backend.playing();

describe('task 70: play a file with the standard player', () => {
  it('a file that exists: D0.W = 1, the sound plays once, the player is busy for its duration', () => {
    expect(device.playSound(n('short.wav'))).toBe(1);
    expect(playing()).toEqual([expect.objectContaining({ loop: false })]);
    expect(backend.bytesOf(playing()[0]!.playback)).toEqual(SHORT);
    expect(device.busyUntil).toBe(100);
  });

  it('busy: D0.W = 0 and nothing starts, nothing is even read into the backend; free again after the duration', () => {
    device.playSound(n('medium.wav'));
    time.advance(249);
    expect(device.playSound(n('short.wav'))).toBe(0);
    expect(backend.eventsOf('load')).toHaveLength(1);
    time.advance(1);
    expect(device.playSound(n('short.wav'))).toBe(1);
    expect(backend.eventsOf('play').map((e) => e.at)).toEqual([0, 250]);
  });

  it('a missing file: D0 is not written (undefined), "\'<name>\' not found" in the message area (§13 row 8)', () => {
    expect(device.playSound(n('nothere.wav'))).toBeUndefined();
    expect(messages).toEqual(["'nothere.wav' not found"]);
    expect(backend.events).toEqual([]);
  });

  it('a missing file while busy: still undefined, the existence test comes first', () => {
    device.playSound(n('long.wav'));
    expect(device.playSound(n('nothere.wav'))).toBeUndefined();
  });

  it('a file that is not a valid WAVE file counts as duration 0: D0.W = 1, not busy afterwards', () => {
    expect(device.playSound(n('junk.wav'))).toBe(1);
    expect(device.playSound(n('short.wav'))).toBe(1);
  });

  it('does not set currentWave', () => {
    device.loadSound(n('short.wav'), 0);
    device.playSound(n('long.wav'));
    expect(device.controlSound(2, 0)).toBe(0); // currentWave is still -1
    expect(device.controlSound(3, 0)).toBe(1); // stop all stops it
    expect(playing()).toEqual([]);
  });

  it('the name is shown in Windows-1252', () => {
    device.playSound(Uint8Array.from([0x63, 0xe9, 0x80, 0x2e, 0x77, 0x61, 0x76]));
    expect(messages).toEqual(["'cé€.wav' not found"]);
  });
});

describe('task 71: load a file into a standard slot', () => {
  it('writes no register; the bytes are registered with the backend at once (decoding starts ahead of play)', () => {
    expect(device.loadSound(n('short.wav'), 3)).toBeUndefined();
    expect(backend.eventsOf('load')).toHaveLength(1);
    expect(device.playSoundMem(3)).toBe(1);
  });

  it('the contents are not checked: a file that is no WAVE file loads, and plays with duration 0', () => {
    device.loadSound(n('song.mid'), 0);
    expect(device.playSoundMem(0)).toBe(1);
    expect(device.playSoundMem(0)).toBe(1);
    expect(messages).toEqual([]);
  });

  it('a missing file: message, the slot keeps what it had', () => {
    device.loadSound(n('short.wav'), 1);
    device.loadSound(n('gone.wav'), 1);
    expect(messages).toEqual(["'gone.wav' not found"]);
    device.playSoundMem(1);
    expect(backend.bytesOf(playing()[0]!.playback)).toEqual(SHORT);
  });

  it('reloading a slot while its sound plays: the sound plays on, its bytes are released only when it stops', () => {
    device.loadSound(n('long.wav'), 2);
    device.playSoundMem(2);
    const first = backend.eventsOf('load')[0]!.sound;
    device.loadSound(n('short.wav'), 2);
    expect(playing()).toHaveLength(1);
    expect(backend.released.has(first)).toBe(false);
    device.controlSound(3, 0);
    expect(backend.released.has(first)).toBe(true);
  });

  it('reloading an idle slot releases the old sound', () => {
    device.loadSound(n('long.wav'), 2);
    const first = backend.eventsOf('load')[0]!.sound;
    device.loadSound(n('short.wav'), 2);
    expect(backend.released.has(first)).toBe(true);
  });

  it('D1.B: only the low byte names the slot', () => {
    device.loadSound(n('short.wav'), 0x105);
    expect(device.playSoundMem(5)).toBe(1);
  });
});

describe('task 72: play a standard slot', () => {
  it('loaded and free: D0.W = 1', () => {
    device.loadSound(n('short.wav'), 0);
    expect(device.playSoundMem(0)).toBe(1);
    expect(device.busyUntil).toBe(100);
  });

  it('an empty slot: nothing happens and D0 is not written (§13 row 9)', () => {
    expect(device.playSoundMem(7)).toBeUndefined();
    expect(backend.events).toEqual([]);
    expect(messages).toEqual([]);
  });

  it('busy: D0.W = 0, but currentWave is set to the slot all the same', () => {
    device.loadSound(n('long.wav'), 0);
    device.loadSound(n('short.wav'), 1);
    device.playSoundMem(0);
    expect(device.playSoundMem(1)).toBe(0);
    // currentWave = 1 now, so "stop slot 0" does nothing and "stop slot 1" stops slot 0's sound.
    expect(device.controlSound(2, 0)).toBe(0);
    expect(playing()).toHaveLength(1);
    expect(device.controlSound(2, 1)).toBe(1);
    expect(playing()).toEqual([]);
    expect(device.busyUntil).toBe(0);
  });

  it("graphicSound.X68's wait loop: the second sound starts exactly when the first one's duration is over", () => {
    device.loadSound(n('short.wav'), 1);
    device.loadSound(n('medium.wav'), 0);
    expect(device.playSoundMem(1)).toBe(1);
    let tries = 0;
    while (device.playSoundMem(0) === 0) {
      tries++;
      time.advance(1);
    }
    expect(time.now()).toBe(100);
    expect(tries).toBe(100);
  });
});

describe('task 76: control the standard player (every row of the table of trap15-b §11.3)', () => {
  beforeEach(() => {
    device.loadSound(n('short.wav'), 0);
    device.loadSound(n('long.wav'), 1);
  });

  it('D2 = 0, slot loaded: currentWave = slot, D0.W = 1 started', () => {
    expect(device.controlSound(0, 0)).toBe(1);
    expect(playing()).toEqual([expect.objectContaining({ loop: false })]);
    expect(device.busyUntil).toBe(100);
  });
  it('D2 = 0, slot loaded, busy: D0.W = 0', () => {
    device.playSoundMem(1);
    expect(device.controlSound(0, 0)).toBe(0);
  });
  it('D2 = 0, slot empty: D0.W = 0', () => {
    expect(device.controlSound(0, 9)).toBe(0);
    expect(playing()).toEqual([]);
  });

  it('D2 = 1, slot loaded: loops until stopped, D0.W = 1; the player stays busy for ever', () => {
    expect(device.controlSound(1, 0)).toBe(1);
    expect(playing()).toEqual([expect.objectContaining({ loop: true })]);
    expect(device.busyUntil).toBe(Infinity);
    time.advance(3_600_000);
    expect(device.playSoundMem(1)).toBe(0);
    expect(device.playSound(n('short.wav'))).toBe(0);
  });
  it('D2 = 1, busy with any standard-player sound: D0.W = 0 (§13 row 11)', () => {
    device.playSound(n('long.wav'));
    expect(device.controlSound(1, 0)).toBe(0);
    expect(playing()).toHaveLength(1);
  });
  it('D2 = 1, slot empty: D0.W = 0', () => {
    expect(device.controlSound(1, 9)).toBe(0);
  });

  it('D2 = 2, slot == currentWave: stops whatever the standard player plays, D0.W = 1', () => {
    device.controlSound(1, 0);
    expect(device.controlSound(2, 0)).toBe(1);
    expect(playing()).toEqual([]);
    expect(device.busyUntil).toBe(0);
    expect(device.playSoundMem(1)).toBe(1);
  });
  it('D2 = 2, slot == currentWave, nothing playing: D0.W = 1 all the same', () => {
    device.playSoundMem(0);
    time.advance(500);
    expect(device.controlSound(2, 0)).toBe(1);
  });
  it('D2 = 2, a task 70 sound is stopped "by accident" when currentWave names the slot', () => {
    device.playSoundMem(0);
    time.advance(100);
    device.playSound(n('long.wav'));
    expect(device.controlSound(2, 0)).toBe(1);
    expect(playing()).toEqual([]);
  });
  it('D2 = 2, slot loaded but not currentWave: D0.W = 0, nothing stops', () => {
    device.playSoundMem(1);
    expect(device.controlSound(2, 0)).toBe(0);
    expect(playing()).toHaveLength(1);
    expect(device.busyUntil).toBe(1000);
  });
  it('D2 = 2, slot empty: D0.W = 0', () => {
    device.playSoundMem(1);
    expect(device.controlSound(2, 9)).toBe(0);
    expect(playing()).toHaveLength(1);
  });

  it('D2 = 3, slot loaded: stop all, D0.W = 1', () => {
    device.controlSound(1, 1);
    expect(device.controlSound(3, 0)).toBe(1);
    expect(playing()).toEqual([]);
    expect(device.busyUntil).toBe(0);
  });
  it('D2 = 3, slot empty: the same, with any D1.B', () => {
    device.controlSound(1, 1);
    expect(device.controlSound(3, 200)).toBe(1);
    expect(playing()).toEqual([]);
  });

  it('other D2 values (all 32 bits compared): D0.W = 0, nothing happens, currentWave unchanged', () => {
    device.playSoundMem(1);
    for (const control of [4, 5, 255, -1, 0x10000, 0x100, -0x80000000]) {
      expect(device.controlSound(control, 0)).toBe(0);
      expect(device.controlSound(control, 9)).toBe(0);
    }
    expect(playing()).toHaveLength(1);
    expect(device.controlSound(2, 1)).toBe(1);
  });

  it('D0 is always written: 0 is a number, never undefined', () => {
    expect(device.controlSound(2, 9)).toBe(0);
    expect(device.controlSound(7, 9)).toBe(0);
  });
});

describe('the busy flag clears by time, whatever the audio device does', () => {
  it('a backend that never plays anything (audio suspended, refused or failed): the same results at the same times', () => {
    const dead: AudioBackend = { load: () => 0, play: () => 0, stop: () => {}, release: () => {}, resume: () => {} };
    const silent = build(dead);
    silent.loadSound(n('medium.wav'), 0);
    expect(silent.playSoundMem(0)).toBe(1);
    time.advance(249);
    expect(silent.playSoundMem(0)).toBe(0);
    time.advance(1);
    expect(silent.playSoundMem(0)).toBe(1);
  });

  it('busyUntil is a time on the injected clock', () => {
    time.advance(1234);
    device.playSound(n('long.wav'));
    expect(device.busyUntil).toBe(2234);
  });
});

describe('task 73: play a file with the DirectX player', () => {
  it('D0.W = 1; sounds overlap', () => {
    expect(device.playSoundDX(n('long.wav'))).toBe(1);
    expect(device.playSoundDX(n('long.wav'))).toBe(1);
    expect(playing()).toHaveLength(2);
    expect(device.busyUntil).toBe(0); // the standard player knows nothing of it
    expect(device.playSound(n('short.wav'))).toBe(1);
  });

  it('a missing file: a clean D0.W = 0 and the message', () => {
    expect(device.playSoundDX(n('none.wav'))).toBe(0);
    expect(messages).toEqual(["'none.wav' not found"]);
  });

  it('a file the loader rejects (a MIDI file, junk): D0.W = 0 and "\'<name>\' Error loading "', () => {
    expect(device.playSoundDX(n('song.mid'))).toBe(0);
    expect(device.playSoundDX(n('junk.wav'))).toBe(0);
    expect(messages).toEqual(["'song.mid' Error loading ", "'junk.wav' Error loading "]);
    expect(backend.events).toEqual([]);
  });

  it('cannot be stopped by a program: task 77 command 3 and task 76 command 3 leave it', () => {
    device.loadSoundDX(n('short.wav'), 0);
    device.playSoundDX(n('long.wav'));
    expect(device.controlSoundDX(3, 0)).toBe(1);
    expect(device.controlSound(3, 0)).toBe(1);
    expect(playing()).toHaveLength(1);
  });

  it('its bytes are released once it has ended by itself', () => {
    device.playSoundDX(n('short.wav'));
    const sound = backend.eventsOf('load')[0]!.sound;
    time.advance(99);
    device.playSoundMemDX(0);
    expect(backend.released.has(sound)).toBe(false);
    time.advance(1);
    device.playSoundMemDX(0);
    expect(backend.released.has(sound)).toBe(true);
  });
});

describe('task 74: load a file into a DirectX slot', () => {
  it('D0.W = 1 on success', () => {
    expect(device.loadSoundDX(n('short.wav'), 4)).toBe(1);
    expect(device.playSoundMemDX(4)).toBe(1);
  });

  it('a missing file: D0.W = 0, message, the slot is unchanged', () => {
    device.loadSoundDX(n('short.wav'), 4);
    expect(device.loadSoundDX(n('none.wav'), 4)).toBe(0);
    expect(messages).toEqual(["'none.wav' not found"]);
    device.playSoundMemDX(4);
    expect(backend.bytesOf(playing()[0]!.playback)).toEqual(SHORT);
  });

  it('a rejected file: D0.W = 0, "Error loading ", the old sound released, the slot empty', () => {
    device.loadSoundDX(n('short.wav'), 4);
    const old = backend.eventsOf('load')[0]!.sound;
    expect(device.loadSoundDX(n('song.mid'), 4)).toBe(0);
    expect(messages).toEqual(["'song.mid' Error loading "]);
    expect(backend.released.has(old)).toBe(true);
    expect(device.playSoundMemDX(4)).toBe(0);
    expect(device.controlSoundDX(0, 4)).toBe(0);
  });

  it('reloading releases the old sound without stopping what it plays', () => {
    device.loadSoundDX(n('long.wav'), 4);
    device.controlSoundDX(1, 4);
    const old = backend.eventsOf('load')[0]!.sound;
    expect(device.loadSoundDX(n('short.wav'), 4)).toBe(1);
    expect(backend.released.has(old)).toBe(true);
    expect(playing()).toHaveLength(1);
    // the old loop is out of the program's reach: command 2 on the slot stops only the new sound's voices
    device.playSoundMemDX(4);
    expect(device.controlSoundDX(2, 4)).toBe(1);
    expect(playing()).toHaveLength(1);
    // a reset stops it
    device.resetSounds();
    expect(playing()).toEqual([]);
  });

  it('reloading ends the sticky looping, even with the same file', () => {
    device.loadSoundDX(n('short.wav'), 4);
    device.controlSoundDX(1, 4);
    device.loadSoundDX(n('short.wav'), 4);
    device.playSoundMemDX(4);
    expect(backend.eventsOf('play').map((e) => e.loop)).toEqual([true, false]);
  });
});

describe('task 75: play a DirectX slot', () => {
  it('loaded: D0.W = 1, and a slot that is playing starts one more overlapping copy', () => {
    device.loadSoundDX(n('long.wav'), 0);
    expect(device.playSoundMemDX(0)).toBe(1);
    expect(device.playSoundMemDX(0)).toBe(1);
    expect(playing()).toHaveLength(2);
  });
  it('empty: D0.W = 0', () => {
    expect(device.playSoundMemDX(0)).toBe(0);
    expect(backend.events).toEqual([]);
  });
});

describe('task 77: control the DirectX player (every row of the table of trap15-b §11.4)', () => {
  beforeEach(() => {
    device.loadSoundDX(n('long.wav'), 0);
    device.loadSoundDX(n('medium.wav'), 1);
  });

  it('D2 = 0: play once, D0.W = 1', () => {
    expect(device.controlSoundDX(0, 0)).toBe(1);
    expect(playing()).toEqual([expect.objectContaining({ loop: false })]);
  });
  it('D2 = 1: loop until stopped, D0.W = 1', () => {
    expect(device.controlSoundDX(1, 0)).toBe(1);
    expect(playing()).toEqual([expect.objectContaining({ loop: true })]);
  });
  it('D2 = 2: stops every playing copy of this slot, D0.W = 1, other slots play on', () => {
    device.playSoundMemDX(0);
    device.controlSoundDX(1, 0);
    device.playSoundMemDX(1);
    expect(device.controlSoundDX(2, 0)).toBe(1);
    expect(playing()).toHaveLength(1);
    expect(backend.bytesOf(playing()[0]!.playback)).toEqual(MEDIUM);
  });
  it('D2 = 2: D0.W = 1 whether or not the slot was sounding', () => {
    expect(device.controlSoundDX(2, 0)).toBe(1);
  });
  it('D2 = 3: stops every loaded slot, D0.W = 1', () => {
    device.controlSoundDX(1, 0);
    device.controlSoundDX(1, 1);
    expect(device.controlSoundDX(3, 1)).toBe(1);
    expect(playing()).toEqual([]);
  });
  it('other D2: nothing, D0.W = 0', () => {
    device.controlSoundDX(1, 0);
    for (const control of [4, -1, 0x10000, 0x100]) expect(device.controlSoundDX(control, 0)).toBe(0);
    expect(playing()).toHaveLength(1);
  });

  it('an empty slot in D1.B: D0.W = 0 and nothing happens, whatever the command - "stop all" too (§13 rows 12, 23)', () => {
    device.controlSoundDX(1, 0);
    for (const control of [0, 1, 2, 3, 4]) expect(device.controlSoundDX(control, 99)).toBe(0);
    expect(playing()).toHaveLength(1);
  });

  it('sticky looping (§13 row 13): after command 1, task 75 and command 0 loop too', () => {
    device.controlSoundDX(1, 0);
    device.controlSoundDX(2, 0);
    device.playSoundMemDX(0);
    device.controlSoundDX(0, 0);
    expect(backend.eventsOf('play').map((e) => e.loop)).toEqual([true, true, true]);
    // per slot: slot 1 is not affected
    device.playSoundMemDX(1);
    expect(backend.eventsOf('play').at(-1)!.loop).toBe(false);
  });
});

describe('reset (resetSounds, trap15-b §11.5) and the cold start (resetToStartup)', () => {
  it('a reset stops the standard player and empties its slots: busy is over, task 72 leaves D0 again', () => {
    device.loadSound(n('long.wav'), 0);
    device.controlSound(1, 0);
    device.resetSounds();
    expect(playing()).toEqual([]);
    expect(device.busyUntil).toBe(0);
    expect(device.playSoundMem(0)).toBeUndefined();
    expect(device.controlSound(0, 0)).toBe(0);
    expect(backend.released.has(backend.eventsOf('load')[0]!.sound)).toBe(true);
  });

  it('a reset stops and releases every DirectX slot; the sticky looping is gone with them', () => {
    device.loadSoundDX(n('long.wav'), 0);
    device.controlSoundDX(1, 0);
    device.playSoundMemDX(0);
    device.resetSounds();
    expect(playing()).toEqual([]);
    expect(device.playSoundMemDX(0)).toBe(0);
    device.loadSoundDX(n('long.wav'), 0);
    device.playSoundMemDX(0);
    expect(backend.eventsOf('play').at(-1)!.loop).toBe(false);
  });

  it('a reset keeps the task 73 voice playing', () => {
    device.playSoundDX(n('long.wav'));
    device.loadSoundDX(n('short.wav'), 0);
    device.controlSoundDX(1, 0);
    device.resetSounds();
    expect(playing()).toHaveLength(1);
    expect(backend.bytesOf(playing()[0]!.playback)).toEqual(LONG);
  });

  it('a reset keeps currentWave', () => {
    device.loadSound(n('short.wav'), 5);
    device.playSoundMem(5);
    device.resetSounds();
    device.loadSound(n('long.wav'), 5);
    device.playSound(n('long.wav')); // task 70 does not set currentWave
    expect(device.controlSound(2, 5)).toBe(1); // currentWave is still 5
    expect(playing()).toEqual([]);
  });

  it('resetToStartup() stops the task 73 voice, empties everything and sets currentWave to -1', () => {
    device.playSoundDX(n('long.wav'));
    device.loadSound(n('short.wav'), 5);
    device.playSoundMem(5);
    device.resetToStartup();
    expect(playing()).toEqual([]);
    expect(device.busyUntil).toBe(0);
    for (const sound of backend.sounds.keys()) expect(backend.released.has(sound)).toBe(true);
    device.loadSound(n('short.wav'), 5);
    time.advance(1000);
    device.playSound(n('short.wav'));
    expect(device.controlSound(2, 5)).toBe(0); // currentWave is -1
  });

  it('a program end is no reset: a loop loops on until the next reset', () => {
    device.loadSound(n('short.wav'), 0);
    device.controlSound(1, 0);
    time.advance(60_000);
    expect(playing()).toHaveLength(1);
  });
});

describe('file names follow the current directory', () => {
  it('the name goes to readProgramFile as the program gave it, at every task: nothing is cached', () => {
    files.add('/other/short.wav', LONG);
    device.playSound(n('short.wav'));
    files.currentDir = '/other';
    time.advance(100);
    device.playSound(n('short.wav'));
    const plays = backend.eventsOf('play');
    expect(backend.bytesOf(plays[0]!.playback)).toEqual(SHORT);
    expect(backend.bytesOf(plays[1]!.playback)).toEqual(LONG);
    expect(files.asked).toEqual(['short.wav', 'short.wav']);
  });

  it('every task that takes a name reads it through the same view: 70, 71, 73, 74', () => {
    files.currentDir = '/nowhere';
    device.playSound(n('short.wav'));
    device.loadSound(n('short.wav'), 0);
    device.playSoundDX(n('short.wav'));
    device.loadSoundDX(n('short.wav'), 0);
    expect(messages).toHaveLength(4);
    files.currentDir = '/prog';
    device.loadSound(n('SHORT.WAV'), 0);
    expect(device.loadSoundDX(n('\\prog\\short.wav'), 0)).toBe(1);
    expect(device.playSoundMem(0)).toBe(1);
  });

  it('a file added to the folder after a failed attempt is found by the next task', () => {
    expect(device.playSoundDX(n('new.wav'))).toBe(0);
    files.add('/prog/new.wav', SHORT);
    expect(device.playSoundDX(n('new.wav'))).toBe(1);
  });
});

describe('the device never asks the backend to resume and never waits for it', () => {
  it('load, play, stop and release only', () => {
    device.loadSound(n('short.wav'), 0);
    device.controlSound(1, 0);
    device.controlSound(3, 0);
    device.playSoundDX(n('short.wav'));
    device.resetToStartup();
    expect(backend.eventsOf('resume')).toEqual([]);
  });
});
