# Differences from the original introduced by SH5 (sound)

What a 68000 program observes through TRAP #15 tasks 70-77 is the original's (trap15-b §11 and §13):
every D0 result, the cases in which D0 is not written, the standard player's busy flag, `currentWave`,
the sticky looping of a DirectX slot and what a reset keeps. The differences below are in what is
heard, or in cases the original leaves undefined.

- **The standard player's busy time comes from the WAV header.** The original asks Windows whether a
  sound is still playing; the port computes `start + duration` from the file's `fmt ` and `data`
  chunks (`parseWav`), so a program's wait loop ends on time even when the browser plays nothing
  (audio locked before the first click, a suspended context, a sound that cannot be decoded).
  Windows' own buffering makes its busy time a little longer than the sound; the port's is the
  sound's exact length.
- **A file that exists but is not a WAVE file** counts as a sound of length 0 for tasks 70 and 72/76:
  `D0.W = 1` and the player is free at once (on Windows `PlaySound` may play the default system sound
  instead; trap15-b V14, unverified). Nothing is heard.
- **The DirectX player (tasks 73, 74, 75, 77) accepts RIFF WAVE files only.** MIDI and DirectMusic
  segment files, which DirectMusic also loads, give `'<name>' Error loading ` and `D0.W = 0`
  (ARCHITECTURE.md 3.7). A WAVE file whose codec the browser cannot decode loads (`D0.W = 1`) and is
  silent.
- **One decoded sound per DirectX slot.** DirectMusic's loader cache may make two slots loaded from
  one file the same object, and may keep a slot's looping across a reload and a reset (trap15-b §11.4,
  V6, unverified). The port keeps each slot separate; looping stays set for a slot until the slot is
  loaded again or the simulator is reset, the recommended port behaviour.
- **Task 74 over a slot whose sound plays.** The original releases the old segment without stopping
  it; the port lets the old sound play on too, and stops a sound left looping that way at the next
  simulator reset (in the original it is unspecified whether it ever stops).
- **Task 73 sounds stop at a cold start** (a new simulator), because the original's process has
  ended by then; a reset (Rewind, opening a program) does not stop them, as in the original.
- **A sound that had to wait is heard in step with the program.** A sound asked for while audio is
  locked or suspended starts, once audio runs, where it would be by then; a sound whose time is over
  by then is not played at all, and a loop joins at the right place. Uncompressed WAVE files (every
  official sound) never wait for a decoder; a compressed one (ADPCM, mu-law ...) may wait for the
  browser's decoder, and a wait of less than 0.2 s starts it from its beginning. If the standard
  player's next sound starts while such a late sound still plays, the late one is cut off at that
  moment: the original's one voice never sounds two sounds at once.
- **At most 64 sounds at once.** A program that starts more overlapping sounds than that (task 75 in a
  tight loop) is not heard beyond the 64th; the results in D0 are unchanged.
- **Unlocking.** Browsers start audio only after the person has clicked or pressed a key: every run
  command, every key in the Output panel and any click or key in the window once a sound is waiting
  unlocks it. Until then programs run as usual and are silent.
