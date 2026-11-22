// The fixed programs of the performance package on the real engines, under Node with virtual time
// (ARCHITECTURE.md 6.9 item 9, 9.6). Owner: P1.
//
// What a program observes is exact by design: under virtual time the governor grants exactly
// `instructionsPerSecond` instructions per second of the program's own clock, so calibrate.X68 must
// report that rate, and its own arithmetic (a 32-bit division written in 68000 code) must give the
// integer quotient of what it counted. The browser measurements of wall-clock figures are
// check-perf.mjs; these tests show that the programs themselves do what the measurements assume.
//
// Needs engine/dist; without it the tests skip (and fail with EASY68K_REQUIRE_ENGINES=1).

import { describe, expect, it } from 'vitest';
import { Reg, type SimSettings } from '../../app/src/contracts';
import { DEFAULT_IPS } from '../../app/src/core/run/governor';
import { createHeadlessSession, type HeadlessSession } from '../../app/src/core/run/headless';
import { createAsmEngine, createSimEngine, releaseSimEngine } from '../../app/src/engine';
import { TEST_ASM_OPTIONS, TEST_ASM_TIME } from '../../app/src/engine/testing';
import { mirrorRows } from '../../app/src/features/output/mirror';
import { MemoryBackend } from '../../app/src/fs/memory-backend';
import { MemorySyncFiles } from '../../app/src/fs/sync/memory';
import { createVfs } from '../../app/src/fs/vfs';
import { CALIBRATE, judgeCalibrate, parseCalibrateReport } from './perf-verdicts.mjs';
import { PERF_PROGRAMS, SURFACE_GREEN, enginesBuilt, perfSource, type PerfProgram } from './programs';

const built = enginesBuilt();
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !built)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const DIR = '/memory/perf';

async function assemble(name: PerfProgram) {
  const asm = await createAsmEngine();
  const file = `${name}.X68`;
  return asm.assemble(file, new Map([[file, perfSource(name)]]), TEST_ASM_OPTIONS, TEST_ASM_TIME);
}

/** A headless session with `name` loaded; the program's folder is one in-memory view. */
async function load(name: PerfProgram, settings: Partial<SimSettings> = {}) {
  const result = await assemble(name);
  if (!result.sRecord || !result.listing) throw new Error(`${name}.X68 did not assemble`);
  const vfs = createVfs();
  vfs.mount(new MemoryBackend());
  await vfs.writeFile(`${DIR}/${name}.S68`, result.sRecord);
  await vfs.writeFile(`${DIR}/${name}.L68`, result.listing);
  const view = new MemorySyncFiles();
  const session = await createHeadlessSession({
    engines: { create: createSimEngine, release: releaseSimEngine },
    vfs,
    viewFor: () => view,
    settings,
  });
  await session.controller.open(`${DIR}/${name}.S68`, 'open');
  return { session, view };
}

const reg = (session: HeadlessSession, r: Reg) => session.engine.getRegister(r) >>> 0;

function fileText(view: MemorySyncFiles, name: string): string {
  const path = view.resolve(DIR, name);
  const data = path === null ? undefined : view.get(path);
  return data ? String.fromCharCode(...data) : '';
}

describe.skipIf(!built)('the fixed programs', () => {
  it('each assembles with no error and no warning', async () => {
    for (const name of PERF_PROGRAMS) {
      const result = await assemble(name);
      expect([name, result.fatal, result.errorCount, result.warningCount]).toEqual([name, null, 0, 0]);
    }
  }, 60_000);

  // Three rates: the default, a low custom one, and one that is not a round number, so that the
  // division routine meets a remainder.
  for (const ips of [DEFAULT_IPS, 250_000, 3_333_333]) {
    it(`calibrate.X68 reports ${ips.toLocaleString('en-US')} instructions per second by its own clock`, async () => {
      const speed: SimSettings['speed'] =
        ips === DEFAULT_IPS
          ? { mode: 'original', instructionsPerSecond: DEFAULT_IPS }
          : { mode: 'custom', instructionsPerSecond: ips };
      const { session, view } = await load('calibrate', { speed });
      try {
        session.controller.run();
        expect(session.runUntilIdle(20_000)).toBe(true);
        expect(session.controller.snapshot.halted).toBe(true);
        const registers = {
          instructions: reg(session, Reg.D4),
          hundredths: reg(session, Reg.D3),
          ips: reg(session, Reg.D7),
        };
        // The arithmetic of the program, and the governor's rate within the 10 ms of task 8 and
        // the one block by which the run overshoots its ten seconds.
        const verdict = judgeCalibrate(registers, { expected: ips, tolerance: 0.005 });
        console.log(`calibrate.X68 under virtual time at ${ips.toLocaleString('en-US')}: ${verdict.detail}`);
        expect(verdict.ok, verdict.detail).toBe(true);
        expect(registers.instructions % CALIBRATE.PERBLK).toBe(0);
        // The screen and result.bin say the same.
        const screen = mirrorRows(session.text.state).join('\n');
        expect(parseCalibrateReport(screen)).toEqual(registers);
        const file = fileText(view, 'result.bin');
        expect(parseCalibrateReport(file)).toEqual(registers);
        expect(file.endsWith('END-OF-DUMP\r\n')).toBe(true);
        expect(file.split('\r\n')).toHaveLength(5);
      } finally {
        session.dispose();
      }
    }, 120_000);
  }

  it('spin.X68 keeps running at the governed rate', async () => {
    const { session } = await load('spin');
    try {
      const before = session.engine.stepCount;
      session.controller.run();
      session.time.advance(2000);
      expect(session.controller.phase).toBe('running');
      const executed = (session.engine.stepCount - before) >>> 0;
      expect(Math.abs(executed - 2 * DEFAULT_IPS)).toBeLessThanOrEqual(2 * 2000);
      // D0 counts iterations of two instructions each.
      expect(Math.abs(reg(session, Reg.D0) * 2 - executed)).toBeLessThanOrEqual(2);
    } finally {
      session.dispose();
    }
  }, 60_000);

  it('draw.X68 draws without end, double buffered', async () => {
    const { session } = await load('draw');
    try {
      session.controller.run();
      session.time.advance(1000);
      expect(session.controller.phase).toBe('running');
      const passes = reg(session, Reg.D7);
      expect(passes).toBeGreaterThan(100);
      const { window, back } = session.surface;
      expect(window).not.toBeNull();
      expect([back.width, back.height]).toEqual([640, 480]);
      const colours = new Set<number>();
      for (const pixel of window!.data) colours.add(pixel & 0xffffff);
      // Black, the eight rectangle colours, white and yellow (some may be covered at a moment).
      expect(colours.size).toBeGreaterThanOrEqual(6);
    } finally {
      session.dispose();
    }
  }, 60_000);

  it('surface.X68 resizes to 4096 x 4096, clears it and fills every pixel', async () => {
    const { session } = await load('surface');
    try {
      session.controller.run();
      expect(session.runUntilIdle(10_000)).toBe(true);
      expect(session.controller.snapshot.halted).toBe(true);
      expect(reg(session, Reg.D3)).toBe(0x10001000);
      expect(reg(session, Reg.A2)).toBe(0x0000c000);
      expect(reg(session, Reg.A3)).toBe(0x0000c000);
      const { back, window } = session.surface;
      expect([back.width, back.height]).toEqual([4096, 4096]);
      expect(window).toBeNull();
      let other = 0;
      for (const pixel of back.data) if (pixel !== SURFACE_GREEN) other++;
      expect(other).toBe(0);
      // The program's clock: the times are in order (under virtual time no host call takes time).
      const times = [Reg.D7, Reg.D6, Reg.D5, Reg.D4].map((r) => reg(session, r));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    } finally {
      session.dispose();
    }
  }, 60_000);
});
