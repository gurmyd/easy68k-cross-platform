// The hardware model inside the real simulator session (engine/dist): SH8's run controller, its
// SoftTimers and VirtualTime, composed by core/run/headless.ts exactly as the application composes
// them. engine.test.ts drives the same scenarios on the stand-ins of ./testing.ts; this file shows that
// they hold on the real parts too (gate I1). Work package SH7, acceptance.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SimOption, type Vfs } from '../../../contracts';
import { createSimEngine, releaseSimEngine } from '../../../engine';
import { assembleProgram } from '../../../engine/testing';
import { MemoryBackend } from '../../../fs/memory-backend';
import { MemorySyncFiles } from '../../../fs/sync/memory';
import { createVfs } from '../../../fs/vfs';
import { createHeadlessSession, type HeadlessSession } from '../../run/headless';

const dist = (file: string) => fileURLToPath(new URL(`../../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

/** Every test runs the real engine and the assembler; on a busy machine one can take seconds. */
const SLOW = 60_000;

const PROGRAMS: Record<string, string[]> = {
  // Counts level-1 autovector interrupts in $3000.
  timer: [
    '        ORG     $1000',
    'START   MOVE.L  #0,$3000',
    '        MOVE.L  #HANDLER,$64',
    '        MOVE.W  #$2000,SR',
    'LOOP    BRA     LOOP',
    'HANDLER ADDQ.L  #1,$3000',
    '        RTE',
    '        END     START',
  ],
  // Writes every new value of the push-button byte to $3000, $3001 ...
  poll: [
    '        ORG     $1000',
    'START   LEA     $3000,A0',
    '        MOVE.B  $E00014,D1',
    'LOOP    MOVE.B  $E00014,D0',
    '        CMP.B   D0,D1',
    '        BEQ     LOOP',
    '        MOVE.B  D0,(A0)+',
    '        MOVE.B  D0,D1',
    '        BRA     LOOP',
    '        END     START',
  ],
  display: [
    '        ORG     $1000',
    'START   MOVE.B  #$3F,$E00000',
    '        MOVE.B  #$A5,$E00010',
    '        SIMHALT',
    '        END     START',
  ],
};

describe.skipIf(!enginesBuilt)('the hardware model in the real session (needs engine/dist)', { timeout: SLOW }, () => {
  let vfs: Vfs;
  let session: HeadlessSession | null = null;

  beforeAll(async () => {
    vfs = createVfs();
    vfs.mount(new MemoryBackend());
    for (const [name, lines] of Object.entries(PROGRAMS)) {
      const program = await assembleProgram(lines);
      await vfs.writeFile(`/memory/hw/${name}.S68`, program.s68);
      await vfs.writeFile(`/memory/hw/${name}.L68`, program.l68);
    }
  }, SLOW);

  afterEach(() => {
    session?.dispose();
    session = null;
  });

  async function open(name: string): Promise<HeadlessSession> {
    session ??= await createHeadlessSession({
      engines: { create: createSimEngine, release: releaseSimEngine },
      vfs,
      viewFor: () => new MemorySyncFiles(),
    });
    await session.controller.open(`/memory/hw/${name}.S68`, 'open');
    expect(session.controller.phase).toBe('idle');
    return session;
  }

  /** The cold start gave the engine the four addresses of the settings (4.7.1 step 4). */
  it('the session builds one HardwareModel for the session and the host; the cold start set the addresses', async () => {
    const s = await open('display');
    const { controls } = s.hardware.view(s.engine);
    expect([controls.seg7, controls.led, controls.switches, controls.pushButtons]).toEqual([
      0xe00000, 0xe00010, 0xe00012, 0xe00014,
    ]);
  });

  it('the panel shows what a program wrote; a switch click sets its bit through the queue', async () => {
    const s = await open('display');
    s.hardware.actions.setVisible(true);
    s.controller.run();
    expect(s.runUntilIdle()).toBe(true);
    const view = s.hardware.view(s.engine);
    expect(view.seg7Bytes[0]).toBe(0x3f);
    expect(view.ledByte).toBe(0xa5);
    expect(s.engine.memory[0xe00012]).toBe(0x00); // setVisible(true) cleared the switch byte
    s.hardware.actions.clickSwitch(3);
    s.time.advance(16);
    expect(s.engine.memory[0xe00012]).toBe(0x08);
    expect(s.hardware.view(s.engine).controls.switchOn[3]).toBe(true);
  });

  it('a push-button press and release posted in the same instant are both seen by a polling program (4.3)', async () => {
    const s = await open('poll');
    s.controller.run();
    s.time.advance(48);
    s.hardware.actions.pressButton(2);
    s.hardware.actions.releaseButton(2);
    s.hardware.actions.pressButton(7);
    s.hardware.actions.releaseButton(7);
    s.time.advance(160);
    expect([...s.engine.memory.subarray(0x3000, 0x3004)]).toEqual([0xfb, 0xff, 0x7f, 0xff]);
    s.controller.pause();
  });

  it('a checked box with interval 500: 19 ticks in 10 s at 16 ms frames while running, every one handled, none after Pause', async () => {
    const s = await open('timer');
    s.controller.invoke((engine) => engine.setOption(SimOption.Exceptions, true));
    // The user: level 1 in the list, 500 in the interval box, check box 1, then Run.
    s.hardware.actions.selectLevel(1);
    s.hardware.actions.setAutoInterval(500);
    s.hardware.actions.setAutoChecked(1, true);
    s.time.advance(0);
    expect(s.hardware.view(s.engine).controls.auto[1]).toEqual({ checked: true, timerEnabled: false, intervalMs: 500 });

    s.controller.run();
    s.time.advance(0);
    expect(s.hardware.view(s.engine).autoLabel).toBe('Automatic Enabled');
    s.time.advance(10_000);
    const handled = s.engine.readLong(0x3000);
    // The real timers are checked once per 16 ms frame and start each period when the late tick is
    // handled (SoftTimer.check: due = now + interval), as a Windows timer does (measured on Windows
    // 11, errata SH8.md entry 26), so a 500 ms timer fires at 512, 1024 ...: 19 in 10 s (errata
    // SH7.md item 6).
    expect(handled).toBe(19);

    s.controller.pause();
    s.time.advance(0);
    expect(s.hardware.view(s.engine).autoLabel).toBe('Automatic Disabled');
    s.time.advance(3_000);
    expect(s.engine.readLong(0x3000)).toBe(handled);
  });
});
