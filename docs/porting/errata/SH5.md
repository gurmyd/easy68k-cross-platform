# Errata and decisions of SH5 (sound)

Where the code of `app/src/core/sim-host/audio/**` and `app/src/features/audio/**` differs from
ARCHITECTURE.md 3.7 or trap15-b §11, or decides something they leave open. What a user hears that
differs from the original is listed in `docs/differences/SH5.md`.

## 1. Files of the package

| File | What |
|---|---|
| `core/sim-host/audio/types.ts` | `parseWav` (contract) and the helpers `readWavHeader`, `wavDurationMs` |
| `core/sim-host/audio/sound-device.ts` | `SoundDevice` (contract); `SOUND_SLOTS` |
| `core/sim-host/audio/testing.ts` | test doubles for others too: `FakeAudioBackend`, `FolderFiles`, `silentWav`, `nameBytes` |
| `features/audio/webaudio-backend.ts` | `WebAudioBackend` (the real `AudioBackend`), `createBrowserAudioOutput` |
| `features/audio/index.ts` | `feature`, `createAudioBackend` (contract) |
| `features/audio/check-audio.mjs` | the browser check |

## 2. The duration of a WAV file (3.7 `parseWav`)

- Says: "RIFF header only; PCM duration from the data chunk."
- Does: walks the chunk list (even padding, chunks in any order, unknown chunks skipped; tick.wav and
  tock.wav have a `LIST` chunk after `data`). Valid = `RIFF....WAVE` with a `fmt ` chunk of at least
  16 bytes, a `data` chunk, channels > 0 and a sample rate > 0. Duration for PCM, IEEE float and
  WAVE_FORMAT_EXTENSIBLE: whole frames (`data size / blockAlign`, blockAlign worked out from channels
  and bits when 0) / sample rate. For compressed formats, which 3.7 does not mention: the `fact`
  chunk's frame count / sample rate, else `data size / byte rate`. A `data` size beyond the end of
  the file (truncated file, streaming size `$FFFFFFFF`) is cut to the bytes present. Durations are not
  rounded (the busy time is `now + durationMs` exactly).

## 3. Decisions the task tables leave to the port

- **Task 70 with a file that is not a WAVE file** (V14 unverified): `D0.W = 1`, duration 0 (3.7: "A
  file that is not a valid WAV counts as duration 0"). The bytes still go to the backend, which fails
  to decode them silently.
- **Task 70 while busy** reads the file first (the original tests `FileExists` before `PlaySound`), so
  a missing file gives the message and leaves D0 even while busy. Consequence: see 6.
- **Tasks 73 and 74: what "the loader rejects" means.** The device has to answer synchronously,
  before any decoding: a file is rejected when `parseWav` says it is no valid RIFF WAVE file (so MIDI
  and segment files are rejected, as 3.7 requires). A WAVE file the browser then cannot decode is
  accepted and silent.
- **Task 74 over a loaded slot.** The old sound is released and not stopped (simIOu.cpp:1752); its
  playbacks are kept as "orphans" that no task reaches; a reset stops them. Looping is cleared by any
  reload (3.7: "until the slot is reloaded").
- **Task 77 command 3** stops the voices of every loaded slot, not orphans (the original calls
  `StopEx` on the 256 current segments only).
- **`currentWave`** is not changed by a reset (trap15-b §3.2: `initSim()` leaves it) and is -1 again
  after `resetToStartup()`.
- **Releasing sounds.** A standard slot's sound is released when the slot is emptied, unless the
  standard voice is playing it; then when that voice ends (next start, stop or reset). A task 70
  sound is released when its voice ends that way. A task 73 sound is released once its duration has
  passed (checked at the next sound task) or at `resetToStartup()`.

## 4. The backend (3.7, trap15-b §11.6)

- `load()` starts decoding at once (tasks 71 and 74 therefore decode ahead of play, 11.6's first
  option); a `play()` before the decode is done waits for it (11.6's second option).
- Decoding uses the window's `AudioContext` when there is one and an `OfflineAudioContext` (44100 Hz)
  before, so that loading a sound starts no audio before a gesture.
- **The contract's `release(sound)` does not stop playbacks** in this backend: what was asked for
  plays on (a source node holds its buffer). The device does not rely on this except for task 74
  ("released, not stopped"), which is what the original does.
- Playbacks that wait (decoder, locked or suspended audio) start late in step with the program, or
  not at all (`LATE_START_S` = 0.2 s); at most `MAX_VOICES` = 64 play at once. See the differences
  file.
- Gestures: besides the run commands and the Output panel's keys (3.7, other packages' code), the
  feature's `init` listens for `pointerdown` and `keydown` on the window (capture) and for the page
  becoming visible, and calls `WebAudioBackend.resumeIfWanted()`: it resumes only an audio context
  that exists or that a playback waits for, so a page that never plays a sound never starts audio.
- Where the page has no `AudioContext` (Node; Playwright's WebKit build on Windows has no Web Audio
  at all) the backend plays nothing and never throws.
- `createBrowserAudioOutput().prepare()` creates the context outside a gesture only when
  `navigator.userActivation.hasBeenActive` is true (or the browser has no `userActivation`), so that
  the browser does not log its autoplay warning.

## 5. Contract

No contract change was needed. Two remarks for W1:

- `AudioBackend.release` says nothing about playbacks already started. Proposed comment: "The
  backend may drop the bytes; playbacks already asked for play on." (what `WebAudioBackend` does).
- Performance proposal (optional member, not used yet): `SoundDeviceDeps.programFileExists?(name):
  boolean`. Task 70 in graphicSound.X68's wait loop calls `readProgramFile` - a whole file - at every
  try, because the original tests `FileExists` each time and a missing file must give its message even
  while the player is busy. Under the real controller that is thousands of whole-file reads per second
  of waiting (roger.wav is 11 kB). With an existence test the device would read only when the player
  is free. Whether this matters depends on what `ProgramFiles.read` costs (SH6: a copy or a view); I2
  should measure it with graphicSound.X68 in the application.

## 6. For other packages

- **SH6** (`ProgramFiles.read`): called by the sound device at every task 70, 71, 73 and 74, with the
  name bytes exactly as the program gave them (already cut to 255 bytes by the engine); null = the
  file does not exist. Task 70 in a wait loop calls it at every try (see 5): a cheap `read` (no copy
  of unchanged bytes) helps.
- **SH8 / I2**: nothing to change in `compose.ts`; `resetToStartup()` of the device is already called
  there. The clock given to the device must be the session clock (RealClock in the application,
  VirtualTime headless), as it is.
- **B1, SH8 (beeps)**: `ctx.devices.audio` is now the real backend. A beep before any gesture waits
  and is dropped if it cannot start within its 70 ms + 0.2 s; a beep in a key handler is a gesture,
  so it is heard.
- **Tests of others** may use `FakeAudioBackend` and `FolderFiles` from `core/sim-host/audio/testing.ts`.

## 7. Manual test (what only a person with speakers can confirm)

A headless browser shows that the audio context runs and that an analyser node in front of the
speakers sees the signal; whether anything is heard, and how it sounds, needs a person. With the
official examples (Help > Examples) in Chrome, Safari and the macOS app:

1. graphicSound.X68: Run. Heard: "one", then "zero" right after it, then "roger", each once, no
   overlap, no gap longer than a frame; the program halts after "roger" starts.
2. clockWithSound.X68: the tick and tock alternate every second, the chime at the full minute; leave
   it running for two minutes; the sound stays in step with the drawn clock.
3. Run graphicSound.X68 in a tab, switch to another tab at once, come back after five seconds: the
   program has halted (it did not wait for the sound); nothing plays late in a burst on return.
4. Open the page fresh and start a program with sound with the keyboard only (F9): the sound is
   heard (a key press unlocks audio).
5. A small program with task 76 command 1 (loop), then SIMHALT: the loop goes on after the halt;
   Rewind stops it. Task 73 of a long sound (chime.wav) followed by Rewind: the sound plays on; the
   editor's Execute of a program (a cold start, 4.7.1): it stops.
6. Task 77 command 1 on a slot, command 2: the loop stops at once; task 75 on the same slot afterwards
   loops (sticky).
7. The beep: type a wrong character into a register field: a short quiet tone.
8. macOS app: the same as 1 and 2; and with the system output switched to headphones during a loop,
   the loop continues there.
