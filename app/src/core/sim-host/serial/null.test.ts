import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleProgram, createTestEngine, runProgram } from '../../../engine/testing';
import { NullSerial } from './null';
import { DesktopSerial } from './desktop';

const repo = (file: string) => fileURLToPath(new URL(`../../../../../${file}`, import.meta.url));
const enginesBuilt = ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((f) =>
  existsSync(repo(`engine/dist/${f}`)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

const name = Uint8Array.from('COM1', (c) => c.charCodeAt(0));

describe('NullSerial (3.3.4, note 37)', () => {
  const serial = new NullSerial();
  it('task 40 returns 2', () => expect(serial.initComm(0, name)).toBe(2));
  it('task 41 returns 3', () => expect(serial.setCommParams(0, 0x1234)).toBe(3));
  it('task 42: the device read reports "not initialised" (-3)', () => expect(serial.commRead(0, 10)).toBe(-3));
  it('task 43 returns 3', () => expect(serial.sendComm(0, name)).toEqual({ result: 3 }));
  it('has a resetToStartup', () => expect(() => serial.resetToStartup()).not.toThrow());
  it('CID 15 is still valid', () => {
    expect(serial.initComm(15, name)).toBe(2);
    expect(serial.setCommParams(15, 0)).toBe(3);
    expect(serial.commRead(15, 1)).toBe(-3);
    expect(serial.sendComm(15, name)).toEqual({ result: 3 });
  });
});

// trap15-a §6 "Common rules" and T3 finding F5 (trap15-a/a47-serial-without-port): the original checks
// the CID before it touches a port, so a CID of 16 or more, or a negative one (D0 bit 31 set), gives 1.
describe('NullSerial: a CID outside 0..15 gives "invalid CID" (simIOu.cpp:2072)', () => {
  const serial = new NullSerial();
  for (const cid of [16, 255, 0x7fff, 0xffff, -1, -32768]) {
    it(`CID ${cid}`, () => {
      expect(serial.initComm(cid, name)).toBe(1);
      expect(serial.setCommParams(cid, 0)).toBe(1);
      expect(serial.commRead(cid, 10)).toBe(-1); // the engine turns -1 into 1 (shim/simio.cpp readComm)
      expect(serial.sendComm(cid, name)).toEqual({ result: 1 });
    });
  }
  it('the DesktopSerial stub answers the same', () => {
    const desktop = new DesktopSerial({} as never);
    expect(desktop.initComm(16, name)).toBe(1);
    expect(desktop.initComm(0, name)).toBe(2);
  });
});

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail(
    'EASY68K_REQUIRE_ENGINES is 1 but engine/dist lacks sim68k or asm68k: run `npm run build:engines` first. ' +
      'Without the variable this check is skipped.',
  );
});

// Tasks 40-43 through the real engine on NullSerial: D0.W gets the result, the CID in D0's high word
// stays. Expected values from the original's TsimIO (simIOu.cpp:2068-2368) and trap15-a §6.
describe.skipIf(!enginesBuilt)('tasks 40-43 on NullSerial through the real engine (needs engine/dist)', () => {
  it('a valid CID without a port gives 2 / 3 / 3 / 3; CID 16 and CID $8000 give 1', async () => {
    const cases: [cid: number, task: number][] = [];
    for (const cid of [0, 15, 16, 0x8000]) for (const task of [40, 41, 42, 43]) cases.push([cid, task]);
    const hex = (n: number) => `$${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
    const RESULTS = 0x4000;
    const lines = ['    ORG $1000', `START LEA ${hex(RESULTS)},A2`];
    for (const [cid, task] of cases) {
      lines.push(
        `    MOVE.L #${hex((cid << 16) | task)},D0`,
        '    LEA NAME,A1',
        '    MOVE.L #1,D1',
        '    TRAP #15',
        '    MOVE.L D0,(A2)+',
      );
    }
    lines.push('    SIMHALT', "NAME DC.B 'COM1',0", '    END START');
    const program = await assembleProgram(lines);
    const test = await createTestEngine({ serial: new NullSerial() });
    try {
      test.engine.load(program.s68, program.l68, { name: 'program.S68', kind: 'open' });
      const report = runProgram(test.engine);
      expect(report.halted, `statuses ${report.statuses.join(',')}`).toBe(true);
      const got = cases.map((_, i) => hex(test.engine.readLong(RESULTS + 4 * i)));
      const want = cases.map(([cid, task]) => hex((cid << 16) | (cid > 15 ? 1 : task === 40 ? 2 : 3)));
      expect(got).toEqual(want);
    } finally {
      test.release();
    }
  }, 60_000);
});
