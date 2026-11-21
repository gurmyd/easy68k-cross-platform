// A program file saved outside the simulator and then used at once by Run (3.8.4; gate I2).
//
// SH6's review (second defect): the cached view of the program files reads a change that the Vfs
// reports asynchronously (75-95 ms in WebKit), so Rewind and Run right after a save read the old
// bytes. The run controller now waits for the views before a run command and a load
// (`RunControllerDeps.filesCatchingUp`, composed in compose.ts). The real CachedSyncFiles, the real
// engine, virtual time.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bytes, FileSystemBackend } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { CachedSyncFiles } from '../../fs/sync/cached';
import { createVfs } from '../../fs/vfs';
import { VirtualTime } from './clock';
import { createHeadlessSession, createSilentAudio, type HeadlessSession } from './headless';
import { createDeviceDoubles } from './test-kit';

const dist = (file: string) => fileURLToPath(new URL(`../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const ENGINE_TEST_TIMEOUT = 60_000;
const text = (s: string): Bytes => Uint8Array.from(s, (c) => c.charCodeAt(0));
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A backend whose reads take a few turns of the event loop, as IndexedDB's do. */
class SlowReadBackend extends MemoryBackend {
  override async readFile(path: string): Promise<Bytes> {
    for (let i = 0; i < 5; i++) await settle();
    return super.readFile(path);
  }
}

// Opens input.txt, reads up to 40 bytes, keeps the count read (D2) at $5000, halts.
const SOURCE = [
  '        ORG     $1000',
  'START:  LEA     INPUT,A1',
  '        MOVE.L  #51,D0',
  '        TRAP    #15',
  '        LEA     BUF,A1',
  '        MOVEQ   #40,D2',
  '        MOVE.L  #53,D0',
  '        TRAP    #15',
  '        MOVE.L  D2,$5000',
  '        MOVE.L  #50,D0',
  '        TRAP    #15',
  '        SIMHALT',
  "INPUT:  DC.B    'input.txt',0",
  '        DS.W    0',
  'BUF:    DS.B    64',
  '        END     START',
];

describe.skipIf(!enginesBuilt)('program files saved outside the simulator (needs engine/dist)', () => {
  let session: HeadlessSession | null = null;
  let view: CachedSyncFiles | null = null;

  afterEach(() => {
    session?.dispose();
    view?.dispose();
    session = null;
    view = null;
  });

  async function start(backend: FileSystemBackend) {
    const vfs = createVfs();
    vfs.mount(backend);
    await vfs.mkdirp('/memory/demo');
    await vfs.writeFile('/memory/demo/input.txt', text('old'));
    const program = await assembleProgram(SOURCE);
    await vfs.writeFile('/memory/demo/prog.S68', program.s68);
    await vfs.writeFile('/memory/demo/prog.L68', program.l68);
    const time = new VirtualTime();
    const files = new CachedSyncFiles({ vfs, scheduler: time, message: () => {} });
    view = files;
    const doubles = createDeviceDoubles();
    session = await createHeadlessSession({
      engines: { create: createSimEngine, release: releaseSimEngine },
      vfs,
      viewFor: () => files,
      settleFiles: () => void files.settled(),
      time,
      audio,
      parts: { log: doubles.parts.log },
    });
    await session.controller.open('/memory/demo/prog.S68', 'open');
    return { vfs, session };
  }

  /** Counts the unlocks of audio that the run commands ask for (3.7). */
  let resumes = 0;
  const audio = { ...createSilentAudio(), resume: () => void resumes++ };

  async function runToHalt(s: HeadlessSession): Promise<number> {
    s.controller.run();
    for (let i = 0; i < 2000; i++) {
      if (s.controller.phase === 'idle' && s.engine.state().halt) {
        const m = s.engine.memory;
        return ((m[0x5000]! << 24) | (m[0x5001]! << 16) | (m[0x5002]! << 8) | m[0x5003]!) >>> 0;
      }
      s.time.advance(16);
      await settle();
    }
    throw new Error(`the program did not halt (phase ${s.controller.phase})`);
  }

  it(
    'Rewind and Run right after a save read the saved bytes',
    async () => {
      const { vfs, session: s } = await start(new SlowReadBackend());
      expect(await runToHalt(s)).toBe(3); // 'old'
      await vfs.writeFile('/memory/demo/input.txt', text('new version'));
      s.controller.rewind();
      // The view has not read the change yet: the command waits for it instead of running now,
      // and unlocks audio inside the command, while it is still the user's gesture (3.7).
      const unlocked = resumes;
      s.controller.run();
      expect(s.controller.phase).toBe('loading');
      expect(resumes).toBe(unlocked + 1);
      expect(await runToHalt(s)).toBe(11);
    },
    ENGINE_TEST_TIMEOUT,
  );

  it(
    'with nothing saved meanwhile, Run starts in the command itself',
    async () => {
      const { session: s } = await start(new MemoryBackend());
      await settle();
      s.controller.run();
      // Not 'loading': the program ran (this one halts within the command's first slice).
      expect(s.controller.phase).not.toBe('loading');
      expect(s.engine.state().halt).toBe(true);
    },
    ENGINE_TEST_TIMEOUT,
  );

  it(
    'a load waits for a change saved just before it',
    async () => {
      const { vfs, session: s } = await start(new SlowReadBackend());
      await vfs.writeFile('/memory/demo/input.txt', text('saved before Reload'));
      await s.controller.open('/memory/demo/prog.S68', 'reload');
      expect(await runToHalt(s)).toBe(19);
    },
    ENGINE_TEST_TIMEOUT,
  );
});
