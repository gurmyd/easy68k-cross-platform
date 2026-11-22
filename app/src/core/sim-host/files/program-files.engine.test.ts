// ProgramFiles and CachedSyncFiles with the real engine (ARCHITECTURE.md 3.8.4, acceptance of SH6
// in 9.4): 68000 programs written for the purpose, assembled with the real assembler, run on the
// headless session of 6.4 (real simulator, real run controller, virtual time). Storage is a
// MemoryBackend behind a real Vfs, seen through the cached view the browser store uses.
//
// The log and the sound device belong to other packages of this wave; they are doubles here.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Bytes, FileSystemBackend, SnapshotLimits, SoundDeviceApi, Vfs, VPath } from '../../../contracts';
import { createSimEngine, releaseSimEngine } from '../../../engine';
import { assembleProgram } from '../../../engine/testing';
import { MemoryBackend } from '../../../fs/memory-backend';
import { CachedSyncFiles, unavailableMessage } from '../../../fs/sync/cached';
import { createVfs } from '../../../fs/vfs';
import { VirtualTime } from '../../run/clock';
import { createHeadlessSession, type HeadlessAnswers, type HeadlessSession } from '../../run/headless';
import { createDeviceDoubles, partOf } from '../../run/test-kit';
import { FakeAudioBackend, silentWav } from '../audio/testing';
import { ProgramFiles, STDIO_BUFFER } from './program-files';

const dist = (file: string) => fileURLToPath(new URL(`../../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const ENGINE_TEST_TIMEOUT = 120_000;
const text = (s: string): Bytes => Uint8Array.from(s, (c) => c.charCodeAt(0));
const str = (b: Bytes | null | undefined): string | null => (b ? String.fromCharCode(...b) : null);

/* ---------------------------------------------------------------- writing the 68000 programs */

/** Where every program stores its results, one long word each. */
const RESULTS = 0x5000;
const trap = (task: number) => [`        MOVE.L  #${task},D0`, '        TRAP    #15'];
const rec = (reg: string) => [`        MOVE.L  ${reg},(A5)+`];
const program = (body: string[], data: string[]) => [
  '        ORG     $1000',
  `START:  LEA     $${RESULTS.toString(16)},A5`,
  ...body,
  '        SIMHALT',
  ...data,
  'BUF:    DS.B    300',
  '        END     START',
];

/* ---------------------------------------------------------------- the world of one test */

interface World {
  vfs: Vfs;
  backend: MemoryBackend;
  view: CachedSyncFiles;
  session: HeadlessSession;
  heard: (string | null)[];
  /** With `realSound`: what SH5's real sound device handed to the audio backend. */
  audio: FakeAudioBackend | null;
}

let world: World | null = null;
afterEach(() => {
  world?.session.dispose();
  world?.view.dispose();
  world = null;
});

async function createWorld(
  files: Record<string, string | Bytes>,
  options: { limits?: SnapshotLimits; answers?: HeadlessAnswers; readOnly?: string[]; realSound?: boolean } = {},
): Promise<World> {
  const backend = new MemoryBackend();
  const vfs = createVfs();
  vfs.mount(backend);
  await vfs.mkdirp('/memory/demo');
  for (const [rel, content] of Object.entries(files)) {
    await vfs.writeFile(`/memory/${rel}`, typeof content === 'string' ? text(content) : content);
  }
  for (const rel of options.readOnly ?? []) backend.setReadOnly(rel);
  const time = new VirtualTime();
  const messages: string[] = [];
  const view = new CachedSyncFiles({
    vfs,
    scheduler: time,
    message: (m) => messages.push(m),
    ...(options.limits ? { limits: options.limits } : {}),
  });
  const heard: (string | null)[] = [];
  let session: HeadlessSession | null = null;
  // A sound device that only says whether the program's file is there (SH5 builds the real one).
  const sound = partOf<SoundDeviceApi>({
    resetToStartup: () => {},
    playSound(name: Bytes) {
      heard.push(str(session?.files.read(name)));
      return 0;
    },
  });
  const doubles = createDeviceDoubles();
  // With realSound the session composes SH5's SoundDevice over the real ProgramFiles, as the app does.
  const audio = options.realSound ? new FakeAudioBackend(time) : null;
  session = await createHeadlessSession({
    engines: { create: createSimEngine, release: releaseSimEngine },
    vfs,
    viewFor: () => view,
    settleFiles: () => void view.settled(),
    time,
    parts: audio ? { log: doubles.parts.log } : { log: doubles.parts.log, sound },
    ...(audio ? { audio } : {}),
    ...(options.answers ? { answers: options.answers } : {}),
  });
  // The view's messages go where the session's go (the session passes its own writer in the app).
  view['deps'].message = (m: string) => session?.bridge.addMessage(m);
  for (const m of messages) session.bridge.addMessage(m);
  world = { vfs, backend, view, session, heard, audio };
  return world;
}

async function load(w: World, source: string[], path: VPath = '/memory/demo/prog.S68'): Promise<void> {
  const assembled = await assembleProgram(source);
  await w.vfs.writeFile(path, assembled.s68);
  await w.vfs.writeFile(path.replace(/\.S68$/, '.L68'), assembled.l68);
  await w.view.whenCurrent();
  await w.session.controller.open(path, 'open');
}

/** Runs until the program stops, letting promises (dialogs, storage) settle between frames. */
async function runToStop(w: Pick<World, 'session'>): Promise<void> {
  w.session.controller.run();
  for (let i = 0; i < 2000; i++) {
    if (w.session.runUntilIdle(64)) {
      w.session.time.advance(16); // timers set at the stop (the view's messages) run
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`the program did not stop (phase ${w.session.controller.phase})`);
}

function results(w: World, count: number): number[] {
  const memory = w.session.engine.memory;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = RESULTS + i * 4;
    out.push(((memory[a]! << 24) | (memory[a + 1]! << 16) | (memory[a + 2]! << 8) | memory[a + 3]!) >>> 0);
  }
  return out;
}

const word = (value: number) => value & 0xffff;
const stored = async (w: World, rel: string) =>
  (await w.vfs.stat(`/memory/${rel}`)) ? str(await w.vfs.readFile(`/memory/${rel}`)) : null;

/* ---------------------------------------------------------------- the tests */

describe.skipIf(!enginesBuilt)(
  'program files with the real engine (needs engine/dist)',
  { timeout: ENGINE_TEST_TIMEOUT },
  () => {
    beforeAll(async () => {
      await assembleProgram(['        ORG $1000', 'S: SIMHALT', '        END S']); // warm the assembler
    }, ENGINE_TEST_TIMEOUT);

    it('the "Files" checks of trap15-a §13', async () => {
      const w = await createWorld({ 'demo/ro.txt': 'RO', 'demo/t.bin': '' }, { readOnly: ['demo/ro.txt'] });
      await load(
        w,
        program(
          [
            // 52 't.bin' -> 0, FID 0; 52 'u.bin' -> FID 1; close 0; 52 'v.bin' -> FID 0 again
            '        LEA     TBIN,A1',
            ...trap(52),
            ...rec('D0'),
            ...rec('D1'),
            '        LEA     UBIN,A1',
            ...trap(52),
            ...rec('D1'),
            '        MOVEQ   #0,D1',
            ...trap(56),
            ...rec('D0'),
            '        LEA     VBIN,A1',
            ...trap(52),
            ...rec('D1'),
            ...trap(50),
            ...rec('D0'),
            // nine opens: the ninth fails
            '        MOVEQ   #8,D7',
            'NINE:   LEA     TBIN,A1',
            ...trap(52),
            '        DBRA    D7,NINE',
            ...rec('D0'),
            ...rec('D1'),
            ...trap(50),
            // 51 on a missing file: 2, -1, not created; 59 on it: 2, D1 untouched
            '        LEA     MISSING,A1',
            ...trap(51),
            ...rec('D0'),
            ...rec('D1'),
            '        MOVE.L  #$55AA55AA,D1',
            '        LEA     MISSING,A1',
            ...trap(59),
            ...rec('D0'),
            ...rec('D1'),
            // 51 on a read-only file: 3 and a FID; 53 works; 54 gives 2
            '        LEA     ROTXT,A1',
            ...trap(51),
            ...rec('D0'),
            '        MOVE.L  D1,D7',
            '        LEA     BUF,A1',
            '        MOVEQ   #2,D2',
            ...trap(53),
            ...rec('D0'),
            ...rec('D2'),
            '        MOVE.L  D7,D1',
            '        LEA     BUF,A1',
            '        MOVEQ   #1,D2',
            ...trap(54),
            ...rec('D0'),
            '        MOVE.L  D7,D1',
            ...trap(56),
            // 59: read-only 3, writable 0
            '        LEA     ROTXT,A1',
            ...trap(59),
            ...rec('D0'),
            '        LEA     TBIN,A1',
            ...trap(59),
            ...rec('D0'),
            // write 10, seek 0, read 20: 0 and 10; read again: 1 and D2 still 20
            '        LEA     TEN,A1',
            ...trap(52),
            '        MOVE.L  D1,D6',
            '        LEA     DIGITS,A1',
            '        MOVEQ   #10,D2',
            ...trap(54),
            '        MOVE.L  D6,D1',
            '        MOVEQ   #0,D2',
            ...trap(55),
            '        MOVE.L  D6,D1',
            '        LEA     BUF,A1',
            '        MOVEQ   #20,D2',
            ...trap(53),
            ...rec('D0'),
            ...rec('D2'),
            '        MOVE.L  D6,D1',
            '        LEA     BUF,A1',
            '        MOVEQ   #20,D2',
            ...trap(53),
            ...rec('D0'),
            ...rec('D2'),
            // a fresh open: 53 with D2 = 0 gives 2; 54 with D2 = 0 gives 0 (T3 F3)
            '        LEA     TEN,A1',
            ...trap(51),
            '        MOVE.L  D1,D7',
            '        LEA     BUF,A1',
            '        MOVEQ   #0,D2',
            ...trap(53),
            ...rec('D0'),
            '        MOVE.L  D7,D1',
            '        LEA     BUF,A1',
            '        MOVEQ   #0,D2',
            ...trap(54),
            ...rec('D0'),
            // 53 at $2000 with D2 = $FFFFFFFF on the 10-byte file: 0, D2 kept (T3 F4)
            '        MOVE.L  D7,D1',
            '        LEA     $2000,A1',
            '        MOVE.L  #$FFFFFFFF,D2',
            ...trap(53),
            ...rec('D0'),
            ...rec('D2'),
            // FID 8, -1 and a closed FID with 53, 54, 55, 56: 2
            ...['#8', '#-1', '#5'].flatMap((fid) =>
              [53, 54, 55, 56].flatMap((task) => [
                `        MOVE.L  ${fid},D1`,
                '        LEA     BUF,A1',
                '        MOVEQ   #1,D2',
                ...trap(task),
                ...rec('D0'),
              ]),
            ),
            // 53 at $FFFFF0 with $20 bytes: 2
            '        MOVE.L  D7,D1',
            '        LEA     $FFFFF0,A1',
            '        MOVEQ   #$20,D2',
            ...trap(53),
            ...rec('D0'),
            // 55 with D2 = $FFFFFFFF: 2
            '        MOVE.L  D7,D1',
            '        MOVE.L  #$FFFFFFFF,D2',
            ...trap(55),
            ...rec('D0'),
            '        MOVE.L  D6,D1',
            ...trap(56),
            '        MOVE.L  D7,D1',
            ...trap(56),
            // 57 on an existing closed file: 0; again: 2
            '        LEA     TBIN,A1',
            ...trap(57),
            ...rec('D0'),
            '        LEA     TBIN,A1',
            ...trap(57),
            ...rec('D0'),
            // 50 with nothing open: 0, the high word of D0 kept
            '        MOVE.L  #$ABCD0000,D0',
            '        MOVE.B  #50,D0',
            '        TRAP    #15',
            ...rec('D0'),
          ],
          [
            "TBIN:   DC.B    't.bin',0",
            "UBIN:   DC.B    'u.bin',0",
            "VBIN:   DC.B    'v.bin',0",
            "MISSING: DC.B   'missing.bin',0",
            "ROTXT:  DC.B    'ro.txt',0",
            "TEN:    DC.B    'ten.bin',0",
            "DIGITS: DC.B    '0123456789',0",
          ],
        ),
      );
      await runToStop(w);
      const r = results(w, 43);
      const next = (() => {
        let i = 0;
        return () => r[i++] as number;
      })();
      expect(word(next()), '52 t.bin: D0').toBe(0);
      expect(next(), '52 t.bin: FID').toBe(0);
      expect(next(), '52 u.bin: FID').toBe(1);
      expect(word(next()), '56 FID 0').toBe(0);
      expect(next(), '52 v.bin: lowest free FID').toBe(0);
      expect(word(next()), '50').toBe(0);
      expect(word(next()), 'ninth open: D0').toBe(2);
      expect(next(), 'ninth open: D1').toBe(0xffffffff);
      expect(word(next()), '51 missing: D0').toBe(2);
      expect(next(), '51 missing: D1').toBe(0xffffffff);
      expect(word(next()), '59 missing: D0').toBe(2);
      expect(next(), '59 missing: D1 unchanged').toBe(0x55aa55aa);
      expect(word(next()), '51 read-only: D0').toBe(3);
      expect(word(next()), '53 on read-only: D0').toBe(0);
      expect(next(), '53 on read-only: D2').toBe(2);
      // The Borland fwrite does not look at the mode: the bytes go into the buffer and the task
      // succeeds; the flush at the close fails (engine/sim/shim/STDIO-MODEL.md R7, R12).
      expect(word(next()), '54 on read-only: D0').toBe(0);
      expect(word(next()), '59 read-only').toBe(3);
      expect(word(next()), '59 writable').toBe(0);
      expect(word(next()), 'read 20 after write 10: D0').toBe(0);
      expect(next(), 'read 20 after write 10: D2').toBe(10);
      expect(word(next()), 'read again: D0').toBe(1);
      expect(next(), 'read again: D2 unchanged').toBe(20);
      expect(word(next()), '53 with D2 = 0').toBe(2);
      // The original's answers, measured under Wine (docs/porting/errata/T3.md F3 and F4; the engine
      // reproduces them since gate I2, engine/sim/shim/hostfile.cpp): a zero-length write succeeds,
      // and a count that wraps the bounds test "succeeds", reads nothing and leaves D2 as it was.
      expect(word(next()), '54 with D2 = 0').toBe(0);
      expect(word(next()), '53 at $2000 with D2 = $FFFFFFFF: D0').toBe(0);
      expect(next(), '53 at $2000 with D2 = $FFFFFFFF: D2').toBe(0xffffffff);
      for (const fid of ['8', '-1', 'closed']) {
        for (const task of [53, 54, 55, 56]) expect(word(next()), `task ${task} FID ${fid}`).toBe(2);
      }
      expect(word(next()), '53 at $FFFFF0').toBe(2);
      expect(word(next()), '55 to -1').toBe(2);
      expect(word(next()), '57 existing').toBe(0);
      expect(word(next()), '57 again').toBe(2);
      expect(next(), '50: D0.W = 0, high word kept').toBe(0xabcd0000);
      expect(await w.vfs.stat('/memory/demo/missing.bin')).toBeNull();
      await w.view.settled();
      expect(await stored(w, 'demo/ten.bin')).toBe('0123456789');
      expect(await w.vfs.stat('/memory/demo/t.bin')).toBeNull();
    });

    // T3 ran this program on the official SIM68K.exe under Wine (docs/porting/errata/T3.md F2): what
    // the Borland run-time's buffers let a second stream see, byte by byte, after large writes, and
    // what a reading stream keeps. The port must write the same result.bin.
    it('stdio-buffer.X68 writes the result.bin of the official simulator', async () => {
      const confirm = (file: string) =>
        fileURLToPath(new URL(`../../../../../tests/conformance/${file}`, import.meta.url));
      const source = readFileSync(confirm('windows-confirm/stdio-buffer.X68'), 'latin1')
        .replace("INCLUDE '..\\sim\\dumplib.X68'", "INCLUDE 'dumplib.X68'")
        .split(/\r?\n/);
      const golden = readFileSync(confirm('windows-confirm/stdio-buffer.wine.result.bin'));
      const assembled = await assembleProgram(source, { 'dumplib.X68': readFileSync(confirm('sim/dumplib.X68')) });
      const w = await createWorld({});
      await w.vfs.writeFile('/memory/demo/prog.S68', assembled.s68);
      await w.vfs.writeFile('/memory/demo/prog.L68', assembled.l68);
      await w.view.whenCurrent();
      await w.session.controller.open('/memory/demo/prog.S68', 'open');
      await runToStop(w);
      await w.view.settled();
      const result = await w.vfs.readFile('/memory/demo/result.bin');
      expect(String.fromCharCode(...result)).toBe(String.fromCharCode(...golden));
    });

    it('names in another letter case and with backslashes open; a read-only file gives result 3', async () => {
      const w = await createWorld(
        { 'demo/Data.TXT': 'data', 'demo/Sub/Inner.bin': 'inner', 'demo/locked.txt': 'L' },
        { readOnly: ['demo/locked.txt'] },
      );
      await load(
        w,
        program(
          [
            '        LEA     N1,A1',
            ...trap(51),
            ...rec('D0'),
            '        LEA     N2,A1',
            ...trap(51),
            ...rec('D0'),
            '        LEA     BUF,A1',
            '        MOVEQ   #20,D2',
            ...trap(53),
            ...rec('D0'),
            ...rec('D2'),
            '        LEA     N3,A1',
            ...trap(51),
            ...rec('D0'),
            ...trap(50),
          ],
          ["N1:     DC.B    'DATA.txt',0", "N2:     DC.B    'sub\\INNER.BIN',0", "N3:     DC.B    '.\\LOCKED.TXT',0"],
        ),
      );
      await runToStop(w);
      const [d1, d2, read, count, d3] = results(w, 5);
      expect(word(d1 as number)).toBe(0);
      expect(word(d2 as number)).toBe(0);
      expect(word(read as number)).toBe(0);
      expect(count).toBe(5);
      expect(word(d3 as number)).toBe(3);
    });

    it('write buffering: 10 bytes are not there for a second open; after task 56, or a large write, they are', async () => {
      const w = await createWorld({});
      await load(
        w,
        program(
          [
            // writer: 52 out.txt, write 10 bytes, do not close
            '        LEA     OUT,A1',
            ...trap(52),
            '        MOVE.L  D1,D6',
            '        MOVE.L  D6,D1',
            '        LEA     DIGITS,A1',
            '        MOVEQ   #10,D2',
            ...trap(54),
            // reader: 51 out.txt, read 10: end of file
            '        LEA     OUT,A1',
            ...trap(51),
            '        MOVE.L  D1,D7',
            '        LEA     BUF,A1',
            '        MOVEQ   #10,D2',
            ...trap(53),
            ...rec('D0'),
            // task 56 on the writer; the reader seeks back and reads the 10 bytes
            '        MOVE.L  D6,D1',
            ...trap(56),
            '        MOVE.L  D7,D1',
            '        MOVEQ   #0,D2',
            ...trap(55),
            '        MOVE.L  D7,D1',
            '        LEA     BUF,A1',
            '        MOVEQ   #10,D2',
            ...trap(53),
            ...rec('D0'),
            ...rec('D2'),
            // 600 bytes to big.bin in one task 54: a large write goes out whole (T3 errata F2)
            '        LEA     BIG,A1',
            ...trap(52),
            '        MOVE.L  D1,D6',
            '        MOVE.L  D6,D1',
            '        LEA     $3000,A1',
            '        MOVE.L  #600,D2',
            ...trap(54),
            '        LEA     BIG,A1',
            ...trap(51),
            '        MOVE.L  D1,D7',
            '        LEA     $4000,A1',
            '        MOVE.L  #1000,D2',
            ...trap(53),
            ...rec('D0'),
            ...rec('D2'),
            ...trap(50),
          ],
          ["OUT:    DC.B    'out.txt',0", "BIG:    DC.B    'big.bin',0", "DIGITS: DC.B    '0123456789',0"],
        ),
      );
      await runToStop(w);
      const [eof, afterClose, count, bigD0, bigCount] = results(w, 5);
      expect(word(eof as number), 'D0.W after reading a file whose bytes are pending').toBe(1);
      expect(word(afterClose as number)).toBe(0);
      expect(count).toBe(10);
      expect(word(bigD0 as number)).toBe(0);
      expect(bigCount, `bytes visible after one write of 600 (>= ${STDIO_BUFFER}: not buffered)`).toBe(600);
      await w.view.settled();
      expect(await stored(w, 'demo/out.txt')).toBe('0123456789');
      expect((await w.vfs.readFile('/memory/demo/big.bin')).length).toBe(600); // task 50 closed it
    });

    it('abandoned streams: after Rewind task 57 fails and a new open misses the pending bytes; a cold start writes them', async () => {
      const w = await createWorld({});
      await load(
        w,
        program(
          [
            '        TST.B   FLAG',
            '        BNE     SECOND',
            '        MOVE.B  #1,FLAG',
            // first run: write 5 bytes and halt without closing
            '        LEA     LEFT,A1',
            ...trap(52),
            '        LEA     HELLO,A1',
            '        MOVEQ   #5,D2',
            ...trap(54),
            '        SIMHALT',
            // second run (after Rewind): delete fails; open and read sees end of file
            'SECOND: LEA     LEFT,A1',
            ...trap(57),
            ...rec('D0'),
            '        LEA     LEFT,A1',
            ...trap(51),
            ...rec('D0'),
            '        LEA     BUF,A1',
            '        MOVEQ   #5,D2',
            ...trap(53),
            ...rec('D0'),
          ],
          ["LEFT:   DC.B    'left.txt',0", "HELLO:  DC.B    'HELLO',0", 'FLAG:   DC.B    0', '        DS.W    0'],
        ),
      );
      await runToStop(w);
      expect(w.session.files.unsaved).toBe(true);
      w.session.controller.rewind();
      await runToStop(w);
      const [remove, open, read] = results(w, 3);
      expect(word(remove as number), 'task 57 on a file an abandoned stream holds').toBe(2);
      expect(word(open as number)).toBe(0);
      expect(word(read as number), 'the new open does not see the pending bytes').toBe(1);
      await w.view.settled();
      expect(await stored(w, 'demo/left.txt')).toBe('');
      await w.session.controller.coldStart();
      expect(await stored(w, 'demo/left.txt'), 'the cold start is the process exit').toBe('HELLO');
      expect(w.session.files.unsaved).toBe(false);
    });

    it('liveness: files saved through the Vfs, added by another window, and a sound file, are seen at the next Rewind and Run', async () => {
      // No whenCurrent() of the test's own between a change and Rewind: the session catches the
      // views up itself (core/run/compose.ts), which is what a student relies on.
      const w = await createWorld({}, { realSound: true });
      const audio = w.audio as FakeAudioBackend;
      const wav = silentWav(800);
      await load(
        w,
        program(
          [
            '        LEA     INPUT,A1',
            ...trap(51),
            ...rec('D0'),
            '        LEA     BUF,A1',
            '        MOVEQ   #40,D2',
            ...trap(53),
            ...rec('D2'),
            ...trap(50),
            '        LEA     WAV,A1',
            ...trap(70),
          ],
          ["INPUT:  DC.B    'input.txt',0", "WAV:    DC.B    'tick.wav',0"],
        ),
      );
      await runToStop(w);
      expect(word(results(w, 1)[0] as number), 'no input.txt yet').toBe(2);
      expect(audio.eventsOf('play')).toEqual([]);
      expect(w.session.messages()).toContain("'tick.wav' not found");

      // Saved as the editor saves: through the Vfs. A sound file is added the same way.
      await w.vfs.writeFile('/memory/demo/input.txt', text('first version'));
      await w.vfs.writeFile('/memory/demo/tick.wav', wav);
      w.session.controller.rewind();
      await runToStop(w);
      expect(word(results(w, 1)[0] as number)).toBe(0);
      expect(str(w.session.engine.memory.slice(...bufRange(w, 13)))).toBe('first version');
      const plays = audio.eventsOf('play');
      expect(plays, 'the added sound file plays').toHaveLength(1);
      expect([...(audio.bytesOf(plays[0]!.playback) ?? [])]).toEqual([...wav]);

      // Changed in another window: the backend reports it.
      await w.backend.externalWrite('demo/input.txt', text('from window two'));
      w.session.controller.rewind();
      await runToStop(w);
      expect(str(w.session.engine.memory.slice(...bufRange(w, 15)))).toBe('from window two');
    });

    it('the limits message, and a file beyond the limits does not open', async () => {
      const w = await createWorld(
        { 'demo/big.dat': 'x'.repeat(5000) },
        { limits: { maxFiles: 50, maxFileBytes: 4096, maxTotalBytes: 1 << 20, maxDepth: 4 } },
      );
      await load(w, program(['        LEA     NAME,A1', ...trap(51), ...rec('D0')], ["NAME:   DC.B    'big.dat',0"]));
      await runToStop(w);
      expect(word(results(w, 1)[0] as number)).toBe(2);
      expect(w.session.messages()).toContain(unavailableMessage('/memory/demo/big.dat', 'too-large'));
      expect(w.session.messages().filter((m) => m.startsWith('Not available')).length).toBe(1);
    });

    it('task 58: Cancel; OK in Open mode moves the current directory; a Save-mode path that task 52 creates', async () => {
      const answers: (VPath | null)[] = [null, '/memory/data/in.txt', '/memory/out/saved.txt'];
      const asked: unknown[] = [];
      const w = await createWorld(
        { 'data/in.txt': 'input data', 'out/keep.txt': '' },
        {
          answers: {
            fileDialog: (mode, title, filter, initialName) => {
              asked.push({ mode, title, filter, initialName });
              return answers.shift() ?? null;
            },
          },
        },
      );
      await load(
        w,
        program(
          [
            // Cancel: D1 = 0, buffer untouched
            '        MOVE.B  #$EE,PATH',
            '        MOVEQ   #0,D1',
            '        LEA     TITLE,A1',
            '        LEA     FILTER,A2',
            '        LEA     PATH,A3',
            ...trap(58),
            ...rec('D0'),
            ...rec('D1'),
            '        MOVE.B  PATH,D3',
            ...rec('D3'),
            // OK, Open mode
            '        CLR.B   PATH',
            '        MOVEQ   #0,D1',
            '        LEA     TITLE,A1',
            '        LEA     FILTER,A2',
            '        LEA     PATH,A3',
            ...trap(58),
            ...rec('D1'),
            // the relative name now resolves in the chosen folder
            '        LEA     INNAME,A1',
            ...trap(51),
            ...rec('D0'),
            ...trap(50),
            // Save mode: a file that does not exist; task 52 creates it at that path
            '        MOVEQ   #1,D1',
            '        MOVE.L  #0,A1',
            '        MOVE.L  #0,A2',
            '        LEA     SUGGEST,A3',
            ...trap(58),
            ...rec('D1'),
            '        LEA     SUGGEST,A1',
            ...trap(52),
            ...rec('D0'),
            '        LEA     SAVED,A1',
            '        MOVEQ   #5,D2',
            ...trap(54),
            ...trap(50),
          ],
          [
            "TITLE:  DC.B    'Choose a file',0",
            "FILTER: DC.B    '*.txt',0",
            "INNAME: DC.B    'IN.TXT',0",
            "SAVED:  DC.B    'SAVED',0",
            '        DS.W    0',
            'PATH:   DS.B    256',
            "SUGGEST: DC.B   'saved.txt',0",
            '        DS.B    256',
          ],
        ),
      );
      await runToStop(w);
      const [d0, cancelD1, untouched, okD1, openD0, saveD1, createD0] = results(w, 7);
      expect(word(d0 as number)).toBe(0);
      expect(cancelD1).toBe(0);
      expect((untouched as number) & 0xff).toBe(0xee);
      expect(okD1).toBe(1);
      expect(word(openD0 as number), 'IN.TXT in the folder of the chosen file').toBe(0);
      expect(saveD1).toBe(1);
      expect(word(createD0 as number)).toBe(0);
      // The first call's initial name is whatever the program left at (A3): $EE and what follows.
      expect(asked[0]).toMatchObject({ mode: 0, title: 'Choose a file', filter: '*.txt|*.txt' });
      expect(asked.slice(1)).toEqual([
        { mode: 0, title: 'Choose a file', filter: '*.txt|*.txt', initialName: '' },
        { mode: 1, title: '', filter: '', initialName: 'saved.txt' },
      ]);
      expect(w.session.files.currentDir).toBe('/memory/out');
      await w.view.settled();
      expect(await stored(w, 'out/saved.txt')).toBe('SAVED');
      // The path at (A3): the port's own path, zero bytes after it up to offset 255.
      const memory = w.session.engine.memory;
      const suggest = findLabel(w, 'SUGGEST');
      const path = '/memory/out/saved.txt';
      expect(str(memory.slice(suggest, suggest + path.length))).toBe(path);
      expect(memory.slice(suggest + path.length, suggest + 256).every((b) => b === 0)).toBe(true);
    });

    it('exitNow() at an abrupt close, then recoverJournal() in a new instance, leaves every byte in storage', async () => {
      const storage = new MemoryBackend();
      await storage.mkdirp('demo');
      const journal = { text: null as string | null };
      const source = program(
        [
          // log.bin: 700 bytes (one large write: committed, then written to storage), then 20 more, never closed
          '        LEA     LOG,A1',
          ...trap(52),
          '        MOVE.L  D1,D6',
          '        LEA     $3000,A1',
          '        MOVE.L  #700,D2',
          ...trap(54),
          '        MOVE.L  #100,D1', // task 23: one second; the write-behind timer runs meanwhile
          ...trap(23),
          '        MOVE.L  D6,D1',
          '        LEA     $3000,A1',
          '        MOVEQ   #20,D2',
          ...trap(54),
          // note.txt: written and closed
          '        LEA     NOTE,A1',
          ...trap(52),
          '        MOVE.L  D1,D7',
          '        LEA     NOTE,A1',
          '        MOVEQ   #8,D2',
          ...trap(54),
          '        MOVE.L  D7,D1',
          ...trap(56),
        ],
        ["LOG:    DC.B    'log.bin',0", "NOTE:   DC.B    'note.txt',0"],
      );
      const assembled = await assembleProgram(source);
      await storage.writeFile('demo/prog.S68', assembled.s68);
      await storage.writeFile('demo/prog.L68', assembled.l68);

      /** One page: a Vfs over `backend`, the cached view, and ProgramFiles with the shared journal. */
      const page = async (backend: FileSystemBackend) => {
        const vfs = createVfs();
        vfs.mount(backend);
        const time = new VirtualTime();
        const view = new CachedSyncFiles({ vfs, scheduler: time, message: () => {} });
        let session: HeadlessSession | null = null;
        const files = new ProgramFiles({
          viewFor: () => view,
          message: () => {},
          showFileDialog: async () => null,
          post: (request) => session?.controller.post(request),
          journal: { write: (t) => (journal.text = t), read: () => journal.text },
        });
        const doubles = createDeviceDoubles();
        session = await createHeadlessSession({
          engines: { create: createSimEngine, release: releaseSimEngine },
          vfs,
          viewFor: () => view,
          settleFiles: () => void view.settled(),
          time,
          parts: { log: doubles.parts.log, sound: doubles.parts.sound, files },
        });
        return { vfs, view, session, files };
      };

      let dead = false;
      const hang = <T>(): Promise<T> => new Promise<T>(() => {});
      const mortal: FileSystemBackend = {
        mount: storage.mount,
        kind: storage.kind,
        label: storage.label,
        stat: (rel) => storage.stat(rel),
        readFile: (rel) => storage.readFile(rel),
        writeFile: (rel, data) => (dead ? hang() : storage.writeFile(rel, data)),
        appendFile: (rel, data) => (dead ? hang() : storage.appendFile(rel, data)),
        remove: (rel) => (dead ? hang() : storage.remove(rel)),
        list: (rel) => storage.list(rel),
        mkdirp: (rel) => storage.mkdirp(rel),
      };

      const a = await page(mortal);
      await a.session.controller.open('/memory/demo/prog.S68', 'open');
      a.session.controller.run();
      // Run until the delay: the 700 bytes reach the view, and storage through the timer.
      for (let i = 0; i < 50 && a.session.controller.phase !== 'waitDelay'; i++) a.session.time.advance(16);
      a.session.time.advance(600);
      await a.view.settled();
      expect((await storage.readFile('demo/log.bin')).length).toBe(700);
      dead = true; // the storage stops answering: the tab is being closed
      await runToStop(a);
      const expectedLog = a.session.engine.memory.slice(0x3000, 0x3000 + 700);
      a.files.exitNow(); // pagehide
      expect(journal.text).not.toBeNull();
      expect((await storage.readFile('demo/log.bin')).length).toBe(700);
      expect(await storage.stat('demo/note.txt')).toBeNull();
      a.session.dispose();

      // The next start: a new page over the same storage applies the journal before any program runs.
      const b = await page(storage);
      expect(journal.text).toBeNull();
      const log = await storage.readFile('demo/log.bin');
      expect(log.length).toBe(720);
      expect([...log.slice(0, 700)]).toEqual([...expectedLog]);
      expect([...log.slice(700)]).toEqual([...expectedLog.slice(0, 20)]);
      expect(str(await storage.readFile('demo/note.txt'))).toBe('note.txt');
      b.session.dispose();
    });

    // trap15-a/a58 and a61, errata SH6.md entry 14: NUL is the null device, CON does not open.
    it('NUL: task 52, 54, 55, 56, 59, 51, 53, 57 as the original on Windows; nothing is created', async () => {
      const w = await createWorld({ 'demo/sub/keep.txt': 'k' });
      const onName = (label: string) => [
        `        LEA     ${label},A1`,
        ...trap(52),
        ...rec('D0'),
        '        MOVE.L  D1,D6',
        '        LEA     ABC,A1',
        '        MOVEQ   #3,D2',
        ...trap(54),
        ...rec('D0'),
        '        MOVE.L  D6,D1',
        '        MOVEQ   #5,D2',
        ...trap(55),
        ...rec('D0'),
        '        MOVE.L  D6,D1',
        ...trap(56),
        ...rec('D0'),
        `        LEA     ${label},A1`,
        ...trap(59),
        ...rec('D0'),
        `        LEA     ${label},A1`,
        ...trap(51),
        ...rec('D0'),
        '        MOVE.L  D1,D6',
        '        LEA     BUF,A1',
        '        MOVEQ   #3,D2',
        ...trap(53),
        ...rec('D0'),
        ...rec('D2'),
        '        MOVE.L  D6,D1',
        ...trap(56),
        ...rec('D0'),
        `        LEA     ${label},A1`,
        ...trap(57),
        ...rec('D0'),
      ];
      await load(
        w,
        program(
          [...onName('NUL'), ...onName('SUBNUL'), '        LEA     CON,A1', ...trap(52), ...rec('D0'), ...rec('D1')],
          [
            "NUL:    DC.B    'nul.',0",
            "SUBNUL: DC.B    'sub\\NUL',0",
            "CON:    DC.B    'CON',0",
            "ABC:    DC.B    'abc'",
            '        DS.W    0',
          ],
        ),
      );
      await runToStop(w);
      const nul = [0, 0, 0, 0, 0, 0, 1, 3, 0, 2];
      expect(results(w, 22).map(word)).toEqual([...nul, ...nul, 2, 0xffff]);
      await w.view.settled();
      expect((await w.vfs.list('/memory/demo')).map((entry) => entry.name).sort()).toEqual([
        'prog.L68',
        'prog.S68',
        'sub',
      ]);
      expect((await w.vfs.list('/memory/demo/sub')).map((entry) => entry.name)).toEqual(['keep.txt']);
    });
  },
);

/** The address of a label, from the listing's symbol table. */
function findLabel(w: World, label: string): number {
  const rows = w.session.listing.rows;
  // The symbol table at the end of the listing: "SUGGEST             11BC".
  for (const row of rows) {
    const match = new RegExp(`^${label}\\s+([0-9A-F]+)$`).exec(row.trim());
    if (match) return parseInt(match[1] as string, 16);
  }
  throw new Error(`no label ${label} in the listing`);
}

function bufRange(w: World, length: number): [number, number] {
  const start = findLabel(w, 'BUF');
  return [start, start + length];
}
