# Errata and decisions of SH5 (sound)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum SH5 <n>" or naming this file: 2, 4, 4a (ARCHITECTURE.md 3.7); 3 (trap15-tasks-60-up.md 11.3, 11.4). Nothing to merge, because no statement of a document is wrong or missing: 1 (the package's file list); 5 (contract remarks; no change asked (`app/src/contracts/` is the authority)); 6 (notes for other packages); 7 (manual checks, in `docs/MANUAL-TEST-MAC.md` (S1-S6, D6)).

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
| `features/audio/pcm.ts` | `decodePcmWav`: uncompressed WAVE data as samples, for an AudioBuffer made at once (section 4a) |
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
  file. Since gate I2 round 2 an uncompressed WAVE file waits for no decoder (4a).
- Gestures: besides the run commands and the Output panel's keys (3.7, other packages' code), the
  feature's `init` listens for `pointerdown` and `keydown` on the window (capture) and for the page
  becoming visible, and calls `WebAudioBackend.resumeIfWanted()`: it resumes only an audio context
  that exists or that a playback waits for, so a page that never plays a sound never starts audio.
- Where the page has no `AudioContext` (Node; Playwright's WebKit build on Windows has no Web Audio
  at all) the backend plays nothing and never throws.
- `createBrowserAudioOutput().prepare()` creates the context outside a gesture only when
  `navigator.userActivation.hasBeenActive` is true (or the browser has no `userActivation`), so that
  the browser does not log its autoplay warning.

## 4a. graphicSound.X68: "zero" began while "one" still sounded (gate I2, repaired in round 2)

- **Seen.** check-wave2 (CI, every system with a running audio context): 0.wav heard 208 to 286 ms
  after 1.wav, which lasts 302 ms; roger.wav 374 to 405 ms after 0.wav (356 ms). check-audio passed,
  because it timed the device's `play()` calls, which were right.
- **What the original does** (simIOu.cpp:1658-1670, trap15-b §11.3, §11.6): task 72 calls
  `PlaySound(..., SND_ASYNC | SND_NOSTOP | SND_MEMORY)`; the busy flag is Windows' own: it clears
  when the sound has really ended. One voice: a sound can never be heard while the one before it is.
- **The port's clock is right.** By 3.7 and hazard H6 the busy flag is `start + duration` on the
  injected clock (RealClock, `performance.now()`, in the application), from the WAV header; the
  durations are right (`parseWav`: header data size, whole frames, 302.13 ms for 1.wav) and the
  device frees the player at exactly that time (Node: 302.13; check-audio: 302.5 to 314 ms).
- **The cause was what is heard.** Task 71 starts `decodeAudioData` and task 72 follows at once; in
  Chromium the decode took 50 to 100 ms, so 1.wav waited for it and then, the wait being under
  `LATE_START_S`, started from its beginning, 50 to 100 ms late. 0.wav, decoded by then, started on
  time, while 1.wav still sounded. roger.wav (task 70) waited for its decoder the same way.
- **Repair.** Uncompressed WAVE data (PCM 8/16/24/32-bit, IEEE float 32/64, also as
  WAVE_FORMAT_EXTENSIBLE: every official sound) is converted to samples within `load()`
  (`pcm.ts`, the same conversion as the browsers' decoders) and put into an `AudioBuffer` made at
  once (`AudioOutput.fromPcm`, an optional member of SH5's own interface); the sound starts within
  the task that asked for it. Other formats, or a buffer the browser refuses (a sample rate outside
  its range), still go to `decodeAudioData`. In addition the device stops the standard voice when
  it starts the next standard sound (`startStandard`): by its clock the old one has ended, so this
  changes nothing a program observes, and the one voice can no longer sound twice even when a
  compressed sound had to wait for its decoder.
- **Measured after the repair** (this PC): check-wave2 Chromium 0.wav 314 ms after 1.wav, roger.wav
  357 ms after 0.wav; check-audio, heard: Chromium 307.4/356.7, 310.9/356.7, 314.5/356.6 ms. With
  the PCM path switched off, the new heard check fails as CI did: 214.3/393.1, 225.3/394.5,
  229.5/394.2 ms.
- **New check.** check-audio now also times what is heard (`AudioBufferSourceNode.start`, its
  offset included) and fails when a sound is heard before the one before it has ended.

## 5. Contract

No contract change was needed. Two remarks for W1:

- `AudioBackend.release` says nothing about playbacks already started. Proposed comment: "The
  backend may drop the bytes; playbacks already asked for play on." (what `WebAudioBackend` does).
- Performance proposal (optional member, not used yet): `SoundDeviceDeps.programFileExists?(name):
  boolean`. Task 70 in graphicSound.X68's wait loop calls `readProgramFile` - a whole file - at every
  try, because the original tests `FileExists` each time and a missing file must give its message even
  while the player is busy. Under the real controller that is thousands of whole-file reads per second
  of waiting (roger.wav is 11 kB). With an existence test the device would read only when the player
  is free.

  **Measured at gate I2 (round 1), not requested.** With the real `ProgramFiles` over SH6's
  `CachedSyncFiles` (a copy per read):
  - Headless, virtual time (`sound-device.engine.test.ts`, the test "composed as in the
    application"): about 73,600 reads over the 672 ms of program time of the two waits (about 110,000
    per second at EASy68K-like speed), 16 to 22 us each on this PC (a `slice` of 11 kB is about 7 us,
    resolving the name about 6 us).
  - In the application (`check-audio.mjs`, Chromium, three runs): about 15,000 reads per run, 240 to
    260 ms of reading in the 660 ms of waiting (16 to 17 us each); the sounds start 0.3 to 0.5 ms after
    the durations in the best run, the display delivers about 40 frames in that time, and the longest
    frame gap is 50 to 83 ms (also seen without sound in the load step). WebKit (Windows build): 22 to
    61 us per read, the sounds start within 4 ms in the best run.

  **These figures are of the CachedSyncFiles before gate I2's changes.** SH6 then made a whole-file
  read return one cached copy (errata SH6.md 5b; check-audio afterwards: 6 to 7 us per read in
  Chromium, 9 to 10 us in WebKit) and, in round 2, keeps name lookups (SH6.md 5c): the read is now
  about 1 us in Chromium and 2 us in WebKit (check-audio: 66,506 to 71,836 reads, 82 to 84 ms per
  run in Chromium; 51,426 to 54,002 reads, 87 to 97 ms in WebKit), and under Node 15 us went to
  1 us. The loop spins about three times as often in the same wait; nothing is copied.

  The cost only lowers how often the wait loop spins (the governor's time budget is shared), which the
  program cannot observe: the busy flag clears by the clock, not by the number of tries. The optional
  member is therefore not requested; it stays a possible improvement if a slower machine shows long
  frames while a program waits for a sound.

  **A refused task 70 decodes nothing** (SH8's question at gate I2). The original tests
  `FileExists` (a directory lookup, not a read) and then calls `PlaySound` with `SND_NOSTOP`, which
  Windows refuses while its sound plays; whether Windows opens the file before refusing cannot be
  seen from the sources and makes no difference a program can see. The port reads the file (its
  only existence test), returns 0 while busy and hands nothing to the backend, so no decode and no
  `AudioBuffer` per refused try (sound-device.test.ts, "busy: D0.W = 0 and nothing starts, nothing is
  even read into the backend"). Tasks 73 and 74 are never refused: each call is a new sound or
  slot, and loads it, as on the original.

## 6. For other packages

- **SH6** (`ProgramFiles.read`): called by the sound device at every task 70, 71, 73 and 74, with the
  name bytes exactly as the program gave them (already cut to 255 bytes by the engine); null = the
  file does not exist. Task 70 in a wait loop calls it at every try (see 5); since gate I2 round 2
  such a read costs about 1 us and copies nothing (SH6.md 5b, 5c).
- **Integration (gate I2)**: graphicSound.X68 runs in the application with the real `ProgramFiles`:
  `check-audio.mjs` assembles it with the application's assembler, writes it and its three sounds into
  the browser store, opens it in the simulator and presses Run, three times, in Chromium and WebKit.
  That step needs `engine/dist` (skipped with a note without it, failing when
  `EASY68K_REQUIRE_ENGINES=1`). clockWithSound.X68 runs in check-wave1's tour (I1), which does not
  check its sounds.
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
