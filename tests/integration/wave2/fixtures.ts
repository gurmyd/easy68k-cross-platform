// Programs, goldens and the application builder of the wave 2 integration scenario (ARCHITECTURE.md
// 9.5). Owner: I2.
//
// Two users:
//   - scenario.test.ts builds the APPLICATION under Node (bootstrap with createTestApplication): the
//     real document service, assembler, Assemble feature, simulator session, run controller and host
//     parts, log, breakpoints and find features, with virtual time; nothing in between is a double
//     except the audio output (a recorder, since Node has no sound) and the glyph atlases (blank);
//   - check-wave2.mjs uses programs.ts (re-exported here) for the programs and goldens.
//
// Nothing is copied from reference/: the examples are the ones the application ships
// (app/public/examples, which the wave 1 scenario checks against tests/corpus/official), the goldens
// are the official program's results already committed under tests/conformance.

import type { AudioBackend, Bytes, Clock, FeatureModule, SoundId } from '../../../app/src/contracts';
import { VirtualTime } from '../../../app/src/core/run/clock';
import { BLANK_GLYPHS } from '../../../app/src/core/run/headless';
import { createAsmEngine, createSimEngine, releaseSimEngine } from '../../../app/src/engine';
import { feature as assembleFeature } from '../../../app/src/features/assemble/index';
import { feature as breakpointsFeature } from '../../../app/src/features/breakpoints/index';
import { createDocumentService } from '../../../app/src/features/documents';
import { feature as findFeature } from '../../../app/src/features/find/index';
import { feature as logFeature } from '../../../app/src/features/log/index';
import { mirrorRows } from '../../../app/src/features/output/mirror';
import { feature as runFeature } from '../../../app/src/features/run/index';
import { createSimSession, runSessionOf, type RunSession } from '../../../app/src/features/run/session';
import { feature as simMainFeature } from '../../../app/src/features/sim-main/index';
import { MemoryBackend } from '../../../app/src/fs/memory-backend';
import { CachedSyncFiles } from '../../../app/src/fs/sync/cached';
import { MESSAGE_DIALOG_ID } from '../../../app/src/state/dialogs';
import { createTestApplication, type TestApplication } from '../../../app/src/state/testing';

export * from './programs';
/* ------------------------------------------------------------------------ the application */

/** An AudioBackend that plays nothing and records what it is asked to play, by the session's clock. */
export function recordingAudio(clock: Pick<Clock, 'now'>) {
  const sounds = new Map<SoundId, Bytes>();
  const plays: { at: number; data: Bytes; loop: boolean }[] = [];
  let next = 1;
  const backend: AudioBackend = {
    load(data) {
      const id = next++;
      sounds.set(id, data);
      return id;
    },
    play(sound, loop) {
      plays.push({ at: clock.now(), data: sounds.get(sound) ?? new Uint8Array(), loop });
      return plays.length;
    },
    stop() {},
    release() {},
    resume() {},
  };
  return { backend, plays };
}

export interface ScenarioApp {
  app: TestApplication;
  time: VirtualTime;
  session: RunSession;
  /** The wall time the assembler writes into `Created On:`; set it before an assembly. */
  setWallTime(date: Date): void;
  plays: { at: number; data: Bytes; loop: boolean }[];
  /** How often the session replaced its engine (a cold start). */
  engineReplacements(): number;
}

/** The features of the scenario. Each one's own feature module, as main.tsx lists them. */
const FEATURES: readonly FeatureModule[] = [
  assembleFeature,
  runFeature,
  simMainFeature,
  logFeature,
  breakpointsFeature,
  findFeature,
];

let asmEngine: ReturnType<typeof createAsmEngine> | undefined;

/** One window of the application under Node, with a browser store at /browser. */
export async function startApplication(): Promise<ScenarioApp> {
  const time = new VirtualTime();
  let wall = new Date(2026, 10, 21, 12, 0, 0);
  const clock: Clock = { now: () => time.now(), wallTime: () => wall };
  const audio = recordingAudio(time);
  const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
  const app = createTestApplication({
    clock,
    scheduler: time,
    backends: [backend],
    asm: await (asmEngine ??= createAsmEngine()),
    session: {
      engines: { create: createSimEngine, release: releaseSimEngine },
      createCachedSyncFiles: (deps) => new CachedSyncFiles(deps),
    },
    features: FEATURES,
    services: {
      createDocumentService,
      createAudioBackend: () => audio.backend,
      createSimSession: (ctx, env) => createSimSession(ctx, env, { glyphs: BLANK_GLYPHS, autoStart: false }),
    },
  });
  const session = runSessionOf(app.ctx.sim) as RunSession;
  let replaced = 0;
  app.ctx.sim.onEngineReplaced(() => void replaced++);
  await session.start();
  return {
    app,
    time,
    session,
    setWallTime: (date) => void (wall = date),
    plays: audio.plays,
    engineReplacements: () => replaced,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Waits for `done()`: real promises settle (wasm, the memory store) and virtual time moves on one
 * frame per turn. Message boxes of the engine are NOT answered here. False after `limitMs` of
 * virtual time or 2000 turns.
 */
export async function until(s: ScenarioApp, done: () => boolean, limitMs = 10_000): Promise<boolean> {
  for (let turn = 0, elapsed = 0; turn < 20_000; turn++) {
    if (done()) return true;
    if (elapsed >= limitMs) return false;
    await tick();
    if (turn % 4 === 3) {
      s.time.advance(16);
      elapsed += 16;
    }
  }
  return done();
}

/** The open dialogs of the window, newest last. */
export const dialogs = (s: ScenarioApp) => s.app.ctx.store.getState().dialogs.stack;
/** The open message boxes (the engine's and the features'), as `title: text`. */
export const boxes = (s: ScenarioApp) =>
  dialogs(s)
    .filter((dialog) => dialog.id === MESSAGE_DIALOG_ID)
    .map((dialog) => {
      const props = dialog.props as { title: string; text: string };
      return `${props.title}: ${props.text}`;
    });

/** Closes the newest open dialog with the id `id`, with `result`. False if none is open. */
export function answer(s: ScenarioApp, id: string, result: unknown): boolean {
  const dialog = [...dialogs(s)].reverse().find((entry) => entry.id === id);
  if (!dialog) return false;
  s.app.dialogs.close(dialog.key, result);
  return true;
}

/** The text of the Output panel: rows of the text screen, trailing blanks and blank rows removed. */
export function outputText(s: ScenarioApp): string[] {
  const rows = mirrorRows(s.app.ctx.sim.text.state).map((row) => row.replace(/\s+$/, ''));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}
