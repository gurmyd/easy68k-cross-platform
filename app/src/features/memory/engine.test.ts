// The Memory and Stack panels on the real simulator engine (engine/dist), through a session
// double that follows the SimSession contract, including a cold start that replaces the engine.
// (Features may not import the real session of features/run; check-memory-stack.mjs drives the
// panels on the real session in a browser.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SimEngine } from '../../contracts';
import { assembleProgram, createTestEngine, runProgram, type TestEngine } from '../../engine/testing';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature as stackFeature } from '../stack';
import { stackModelOf } from '../stack/model';
import { feature } from '.';
import { memoryModelOf } from './model';
import { ManualScheduler, createSessionDouble, type SessionDouble } from './session-double';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const simBuilt = existsSync(repo('engine/dist/sim68k.wasm'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

const PROGRAM = [
  '    ORG $1000',
  'START LEA $8000,A7',
  '    MOVE.L #$11223344,-(A7)',
  '    MOVE.L #$41424300,$2000',
  '    MOVEA.L A7,A3',
  '    SIMHALT',
  '    END START',
];

describe('Memory and Stack panels on the real engine', () => {
  it.runIf(enginesRequired && !simBuilt)('engine/dist holds the simulator (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist/sim68k.wasm is missing: run `npm run build:engines`.');
  });

  const engines: TestEngine[] = [];
  let app: TestApplication;
  let session: SessionDouble;
  let program: { s68: Uint8Array; l68: Uint8Array };

  beforeAll(async () => {
    if (!simBuilt) return;
    program = await assembleProgram(PROGRAM);
    const first = await createTestEngine();
    engines.push(first);
    app = createTestApplication({
      features: [feature, stackFeature],
      scheduler: new ManualScheduler(),
      services: {
        createSimSession: (ctx) => {
          session = createSessionDouble(
            createInertSimSession(ctx),
            first.engine,
            async () => {
              const next = await createTestEngine();
              engines.push(next);
              return next.engine;
            },
            { ctx, pokeBumpsView: true },
          );
          return session;
        },
      },
    });
  }, 120_000);

  afterAll(() => {
    for (const engine of engines) engine.release();
  });

  const load = (engine: SimEngine) => {
    engine.load(program.s68, program.l68, { name: 'program.S68', kind: 'open' });
    runProgram(engine);
  };

  it.skipIf(!simBuilt)(
    'shows what the program wrote, rows and ASCII',
    () => {
      load(session.engine);
      const memory = memoryModelOf(app.ctx);
      memory.setRows(2);
      memory.setAddress(0x2000);
      const row = memory.getState().view[0]!;
      expect(row.addressText + row.hex.slice(0, 4).join('') + row.ascii.slice(0, 4).join('')).toBe(
        '00002000: 41 42 43 00 ABC-',
      );
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'the Stack panel centres on SS and marks the pushed long word; A3 is aqua when chosen',
    () => {
      const stack = stackModelOf(app.ctx);
      stack.setRows(5);
      stack.setChoice(3); // A3 = $7FFC
      const middle = stack.getState().view[2]!;
      expect(middle.address).toBe(0x7ffc);
      expect(middle.bytes.map((byte) => byte.text).join('')).toBe('11 22 33 44 ');
      expect(middle.bytes[0]?.mark).toBe('reg');
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'a Memory edit writes the engine through the controller and redraws the Stack panel',
    () => {
      const memory = memoryModelOf(app.ctx);
      memory.setAddress(0x7ff0);
      memory.place({ row: 0, col: 10 + 12 * 3 }); // byte $7FFC, high nibble
      memory.typeCode(0x41); // 'A'
      expect(session.engine.readByte(0x7ffc)).toBe(0xa1);
      expect(stackModelOf(app.ctx).getState().view[2]?.bytes[0]?.text).toBe('A1 ');
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'after a cold start both panels read the new engine',
    async () => {
      const old = session.engine;
      await session.coldStart();
      expect(session.engine).not.toBe(old);
      const memory = memoryModelOf(app.ctx);
      memory.setAddress(0x2000);
      // A fresh simulator: memory filled with $FF, the program's bytes are gone.
      expect(memory.getState().view[0]?.hex.slice(0, 4).join('')).toBe('FF FF FF FF ');
      const stack = stackModelOf(app.ctx).getState();
      // Back on SS ($01000000 at start-up): the yellow mark on 00000000 in the middle row.
      expect(stack.choice).toBe(3); // the saved choice (whichStack) survives the cold start
      memory.place({ row: 0, col: 10 });
      memory.typeCode(0x35);
      expect(session.engine.readByte(0x2000)).toBe(0x5f);
      expect(old.readByte(0x2000)).not.toBe(0x5f);
    },
    120_000,
  );
});
