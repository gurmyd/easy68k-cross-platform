// The sound device with the real simulator engine (needs engine/dist): what a 68000 program sees in
// D0 after each sound task, what a reset (Rewind) keeps, and the official example graphicSound.X68
// running under the real run controller with virtual time and the six official sound files.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg, type AudioBackend } from '../../../contracts';
import { createSimEngine, releaseSimEngine } from '../../../engine';
import { assembleProgram, createTestEngine, runProgram, type AssembledProgram } from '../../../engine/testing';
import { MemoryBackend } from '../../../fs/memory-backend';
import { CachedSyncFiles } from '../../../fs/sync/cached';
import { MemorySyncFiles } from '../../../fs/sync/memory';
import { createVfs } from '../../../fs/vfs';
import { VirtualTime } from '../../run/clock';
import { createHeadlessSession, type HeadlessSession } from '../../run/headless';
import { SoundDevice } from './sound-device';
import { FakeAudioBackend, FolderFiles, silentWav } from './testing';

const dist = (file: string) => fileURLToPath(new URL(`../../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const official = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../../tests/corpus/official/${name}`, import.meta.url))));

/** Every test here runs the real engine; on a busy machine one can take seconds. */
const ENGINE_TEST_TIMEOUT = 60_000;
const RESULTS = 0x3000;

/**
 * Each step loads D0 with a marker in the high word and the task in the low byte, calls the task
 * and stores D0.L at RESULTS + 4 * step.
 */
const STEPS: { lines: string[]; d0: number; what: string }[] = [
  { what: 'task 70, missing file: D0 not written', lines: ['LEA MISSING,A1'], d0: 0x12340046 },
  {
    what: 'task 71, load short.wav into slot 1: no register written',
    lines: ['LEA SHORT,A1', 'MOVEQ #1,D1'],
    d0: 0x23450047,
  },
  { what: 'task 72, empty slot 9: D0 not written', lines: ['MOVEQ #9,D1'], d0: 0x34560048 },
  { what: 'task 72, slot 1: started', lines: ['MOVEQ #1,D1'], d0: 0x45670001 },
  { what: 'task 72, slot 1 again: busy', lines: ['MOVEQ #1,D1'], d0: 0x56780000 },
  { what: 'task 70, a file that exists while busy: busy', lines: ['LEA SHORT,A1'], d0: 0x67890000 },
  { what: 'task 76, command 7: 0', lines: ['MOVEQ #1,D1', 'MOVEQ #7,D2'], d0: 0x789a0000 },
  {
    what: 'task 76, command $00010002 (all 32 bits compared): 0',
    lines: ['MOVEQ #1,D1', 'MOVE.L #$00010002,D2'],
    d0: 0x89ab0000,
  },
  {
    what: 'task 76, command 3 with D1.B = 200 (empty): stop all, 1',
    lines: ['MOVE.L #200,D1', 'MOVEQ #3,D2'],
    d0: 0x9abc0001,
  },
  { what: 'task 76, command 1 slot 1: loop, 1', lines: ['MOVEQ #1,D1', 'MOVEQ #1,D2'], d0: 0xabcd0001 },
  { what: 'task 73, missing file: 0', lines: ['LEA MISSING,A1'], d0: 0xbcde0000 },
  { what: 'task 73, long.wav: 1', lines: ['LEA LONG,A1'], d0: 0xcdef0001 },
  { what: 'task 74, a MIDI file into slot 2: Error loading, 0', lines: ['LEA MIDI,A1', 'MOVEQ #2,D1'], d0: 0xdef00000 },
  { what: 'task 74, long.wav into slot 2: 1', lines: ['LEA LONG,A1', 'MOVEQ #2,D1'], d0: 0xef010001 },
  { what: 'task 75, empty slot 3: 0', lines: ['MOVEQ #3,D1'], d0: 0xf0120000 },
  { what: 'task 77, command 3 with an empty slot in D1.B: 0', lines: ['MOVEQ #3,D1', 'MOVEQ #3,D2'], d0: 0x01230000 },
  {
    what: 'task 77, command 1 with D1 = $102 (slot 2): loop, 1',
    lines: ['MOVE.L #$102,D1', 'MOVEQ #1,D2'],
    d0: 0x12340001,
  },
  { what: 'task 75, slot 2: 1 (loops: sticky)', lines: ['MOVEQ #2,D1'], d0: 0x23450001 },
  { what: 'task 77, command 9 slot 2: 0', lines: ['MOVEQ #2,D1', 'MOVEQ #9,D2'], d0: 0x34560000 },
];
/** The task of each step, from the low byte of the expected D0 where the task writes nothing. */
const TASKS = [70, 71, 72, 72, 72, 70, 76, 76, 76, 76, 73, 73, 74, 74, 75, 77, 77, 75, 77];

function registerProgram(): string[] {
  const lines = ['        ORG     $1000', 'START:  LEA     $3000,A2'];
  STEPS.forEach((step, index) => {
    const marker = (step.d0 & 0xffff0000) >>> 0;
    lines.push(`* ${step.what}`);
    for (const line of step.lines) lines.push(`        ${line}`);
    lines.push(
      `        MOVE.L  #$${((marker | TASKS[index]!) >>> 0).toString(16)},D0`,
      '        TRAP    #15',
      '        MOVE.L  D0,(A2)+',
    );
  });
  lines.push(
    '        SIMHALT',
    "MISSING: DC.B   'missing.wav',0",
    "SHORT:  DC.B    'short.wav',0",
    "LONG:   DC.B    'LONG.WAV',0",
    "MIDI:   DC.B    'song.mid',0",
    '        END     START',
  );
  return lines;
}

describe.skipIf(!enginesBuilt)(
  'the sound tasks with the real engine (needs engine/dist)',
  { timeout: ENGINE_TEST_TIMEOUT },
  () => {
    let program: AssembledProgram;
    let graphicSound: AssembledProgram;
    let session: HeadlessSession | null = null;

    beforeAll(async () => {
      program = await assembleProgram(registerProgram());
      expect(program.result.errorCount).toBe(0);
      graphicSound = await assembleProgram(new TextDecoder('windows-1252').decode(official('graphicSound.X68')));
    }, 120_000);

    afterEach(() => {
      session?.dispose();
      session = null;
    });

    it('D0 after every step: written, not written, high word kept', async () => {
      const time = new VirtualTime();
      const backend = new FakeAudioBackend(time);
      const files = new FolderFiles();
      files
        .add('/short.wav', silentWav(800))
        .add('/long.wav', silentWav(8000))
        .add('/song.mid', Uint8Array.from([77, 84, 104, 100]));
      const messages: string[] = [];
      const sound = new SoundDevice({
        backend,
        clock: time,
        readProgramFile: files.read,
        message: (t) => messages.push(t),
      });
      const test = await createTestEngine({ sound });
      try {
        test.engine.load(program.s68, program.l68, { name: 'sound.S68' });
        const report = runProgram(test.engine);
        expect(report.halted).toBe(true);
        const results = STEPS.map((_, index) => test.engine.readLong(RESULTS + 4 * index) >>> 0);
        expect(results.map((value) => value.toString(16))).toEqual(STEPS.map((step) => (step.d0 >>> 0).toString(16)));
        // what D0 holds where nothing was written: the value the program loaded (task in the low byte)
        expect(results[0]).toBe(0x12340046);
        expect(results[2]).toBe(0x34560048);
        expect(messages).toEqual(["'missing.wav' not found", "'missing.wav' not found", "'song.mid' Error loading "]);
        expect(files.asked).toEqual([
          'missing.wav',
          'short.wav',
          'short.wav',
          'missing.wav',
          'LONG.WAV',
          'song.mid',
          'LONG.WAV',
        ]);
        // Playing now: the standard loop (slot 1), the task 73 sound, and two loops of DirectX slot 2.
        expect(backend.playing().map((p) => p.loop)).toEqual([true, false, true, true]);

        // Rewind resets the simulator (initSim -> ResetSounds): only the task 73 sound plays on.
        test.engine.rewind();
        expect(backend.playing()).toEqual([expect.objectContaining({ loop: false })]);
        expect(backend.bytesOf(backend.playing()[0]!.playback)).toEqual(silentWav(8000));
        expect(sound.busyUntil).toBe(0);
        // A cold start stops it too.
        sound.resetToStartup();
        expect(backend.playing()).toEqual([]);
      } finally {
        test.release();
      }
    });

    /** graphicSound.X68 in a headless session: [virtual time of each play, file it played]. */
    async function runGraphicSound(audio: AudioBackend, time: VirtualTime): Promise<string[]> {
      const vfs = createVfs();
      vfs.mount(new MemoryBackend());
      await vfs.writeFile('/memory/examples/graphicSound.S68', graphicSound.s68);
      const files = new FolderFiles();
      files.currentDir = '/memory/examples';
      for (const name of ['0.wav', '1.wav', 'roger.wav']) files.add(`/memory/examples/${name}`, official(name));
      const messages: string[] = [];
      const sound = new SoundDevice({
        backend: audio,
        clock: time,
        readProgramFile: files.read,
        message: (t) => messages.push(t),
      });
      session = await createHeadlessSession({
        engines: { create: createSimEngine, release: releaseSimEngine },
        vfs,
        viewFor: () => new MemorySyncFiles(),
        time,
        parts: { sound },
      });
      await session.controller.open('/memory/examples/graphicSound.S68', 'open');
      session.controller.run();
      expect(session.runUntilIdle(20_000)).toBe(true);
      expect(session.engine?.state().halt).toBe(true);
      expect(messages).toEqual([]);
      return files.asked;
    }

    it('graphicSound.X68: each sound starts when the one before has played for its duration, by the virtual clock', async () => {
      const time = new VirtualTime();
      const backend = new FakeAudioBackend(time);
      const asked = await runGraphicSound(backend, time);
      // Task 70 in the wait loop reads the file at every try, as the original tests FileExists each time.
      expect([...new Set(asked)]).toEqual(['0.wav', '1.wav', 'roger.wav']);
      expect(asked.filter((name) => name === 'roger.wav').length).toBeGreaterThan(1);
      const plays = backend.eventsOf('play');
      const names = plays.map((play) => {
        const bytes = backend.bytesOf(play.playback)!;
        return ['0.wav', '1.wav', 'roger.wav'].find((name) => official(name).length === bytes.length);
      });
      expect(names).toEqual(['1.wav', '0.wav', 'roger.wav']);
      const [one, zero, roger] = plays.map((play) => play.at) as [number, number, number];
      // 1.wav plays 302.13 ms, 0.wav 355.96 ms; the wait loop tries again every instruction batch,
      // and the controller runs a batch per 16 ms frame of virtual time.
      expect(zero - one).toBeGreaterThanOrEqual(302.13);
      expect(zero - one).toBeLessThan(302.13 + 17);
      expect(roger - zero).toBeGreaterThanOrEqual(355.96);
      expect(roger - zero).toBeLessThan(355.96 + 17);
    });

    it('graphicSound.X68 with an audio device that plays nothing: the same plays at the same times', async () => {
      const reference = new VirtualTime();
      const recorded = new FakeAudioBackend(reference);
      await runGraphicSound(recorded, reference);
      session?.dispose();
      session = null;

      const time = new VirtualTime();
      const attempts: number[] = [];
      let next = 1;
      const dead: AudioBackend = {
        load: () => next++,
        play: () => {
          attempts.push(time.now());
          return next++;
        },
        stop: () => {},
        release: () => {},
        resume: () => {},
      };
      await runGraphicSound(dead, time);
      expect(attempts).toEqual(recorded.eventsOf('play').map((play) => play.at));
      expect(session!.engine!.getRegister(Reg.D0) & 0xffff).toBe(1);
    });

    it('graphicSound.X68 composed as in the application: the real ProgramFiles over the cached view, and what task 70 costs in its wait loop', async () => {
      // No part is replaced: the session composes the real SoundDevice over the real ProgramFiles,
      // which reads through the CachedSyncFiles view the browser's store uses (SH6).
      const time = new VirtualTime();
      const backend = new FakeAudioBackend(time);
      const vfs = createVfs();
      vfs.mount(new MemoryBackend());
      await vfs.writeFile('/memory/examples/graphicSound.S68', graphicSound.s68);
      for (const name of ['0.wav', '1.wav', 'roger.wav'])
        await vfs.writeFile(`/memory/examples/${name}`, official(name));
      const view = new CachedSyncFiles({ vfs, scheduler: time, message: () => {} });
      // Every whole-file read of the sound device passes through view.read; count and time them.
      const reads = { count: 0, ms: 0 };
      const read = view.read.bind(view);
      view.read = (path, position, count) => {
        const started = performance.now();
        const bytes = read(path, position, count);
        reads.ms += performance.now() - started;
        reads.count += 1;
        return bytes;
      };
      try {
        await view.whenCurrent();
        session = await createHeadlessSession({
          engines: { create: createSimEngine, release: releaseSimEngine },
          vfs,
          viewFor: () => view,
          settleFiles: () => void view.settled(),
          time,
          audio: backend,
        });
        const messages: string[] = [];
        const original = session.bridge.addMessage.bind(session.bridge);
        session.bridge.addMessage = (line: string) => {
          messages.push(line);
          original(line);
        };
        await session.controller.open('/memory/examples/graphicSound.S68', 'open');
        messages.length = 0; // the loader's own lines; what follows is the program's
        const wallStart = performance.now();
        session.controller.run();
        let idle = false;
        for (let i = 0; i < 2000 && !idle; i++) {
          idle = session.runUntilIdle(64);
          if (!idle) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const wallMs = performance.now() - wallStart;
        expect(idle).toBe(true);
        expect(session.engine?.state().halt).toBe(true);
        expect(messages).toEqual([]);

        const plays = backend.eventsOf('play');
        const names = plays.map((play) => {
          const bytes = backend.bytesOf(play.playback)!;
          return ['0.wav', '1.wav', 'roger.wav'].find((name) => official(name).length === bytes.length);
        });
        expect(names).toEqual(['1.wav', '0.wav', 'roger.wav']);
        const [one, zero, roger] = plays.map((play) => play.at) as [number, number, number];
        expect(zero - one).toBeGreaterThanOrEqual(302.13);
        expect(zero - one).toBeLessThan(302.13 + 17);
        expect(roger - zero).toBeGreaterThanOrEqual(355.96);
        expect(roger - zero).toBeLessThan(355.96 + 17);

        // The wait loop reads the file at every try (the original tests FileExists each time).
        const perRead = reads.ms / reads.count;
        const virtualMs = roger - one;
        console.info(
          `task 70 in the wait loop: ${reads.count} whole-file reads over ${virtualMs.toFixed(0)} ms of program time ` +
            `(${((reads.count * 1000) / virtualMs).toFixed(0)} per second), ${reads.ms.toFixed(1)} ms in all, ` +
            `${(perRead * 1000).toFixed(1)} us each; the whole run took ${wallMs.toFixed(0)} ms of wall time`,
        );
        expect(reads.count).toBeGreaterThan(10);
        // A read is a copy of a file of a few kilobytes: microseconds. The bound is a hundred times
        // that, so a loaded machine does not fail it, while a read that walked the store would.
        expect(perRead).toBeLessThan(0.5);
      } finally {
        view.dispose();
      }
    });
  },
);
