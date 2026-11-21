// The hardware model with the real simulator engine (engine/dist): items 1-10 of hardware §13
// driven through HardwareActions, the auto-interrupt timers under virtual time, the Hardware panel's
// visibility and the one-input-edge rule of 4.3 for push buttons. Work package SH7, acceptance.
//
// The run controller, SoftTimer and VirtualTime are SH8's and are written at the same time as this
// package; these tests use the small stand-ins of ./testing.ts, built from the contracts and the rules
// of ARCHITECTURE.md 4.3 and 4.5.3, so that they keep passing when the real controller is joined.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HwDevice, MapKind, SimOption, type SimEngine } from '../../../contracts';
import { assembleProgram, createTestEngine, textOf, type TestEngine } from '../../../engine/testing';
import { HardwareModel } from './model';
import { MiniController, TestClock, createTestTimers, type TestTimers } from './testing';

const repo = (file: string) => fileURLToPath(new URL(`../../../../../${file}`, import.meta.url));
const simBuilt = existsSync(repo('engine/dist/sim68k.wasm')) && existsSync(repo('engine/dist/sim68k-loader.mjs'));
const asmBuilt = existsSync(repo('engine/dist/asm68k.wasm')) && existsSync(repo('engine/dist/asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** Time limit of each test: the engines load and the assembler runs, on a busy machine. */
const SLOW = 60_000;

interface Rig {
  test: TestEngine;
  engine: SimEngine;
  model: HardwareModel;
  controller: MiniController;
  clock: TestClock;
  timers: TestTimers;
  /** Assembles and loads a program (File > Open). */
  load(lines: string[]): Promise<void>;
  /** Runs the loaded program until it stops. */
  runToStop(): void;
  byte(address: number): number;
  /** Virtual time: `ms` steps of 1 ms, checking the timers and executing `ipms` instructions each. */
  advance(ms: number, ipms?: number): void;
}

/** The engine in the state the application gives it after a cold start with default settings. */
async function rig(): Promise<Rig> {
  const clock = new TestClock();
  const timers = createTestTimers(clock);
  let current: SimEngine | null = null;
  const controller = new MiniController(() => {
    if (!current) throw new Error('no engine yet');
    return current;
  });
  const model = new HardwareModel({ post: controller.post, timers, showPanel: () => {} });
  const test = await createTestEngine({ hardware: model });
  current = test.engine;
  const engine = test.engine;
  // What the cold start does with the saved settings (4.7.1 step 4): the four device addresses.
  model.actions.setAddress(HwDevice.Seg7, 0xe00000, false);
  model.actions.setAddress(HwDevice.Led, 0xe00010, false);
  model.actions.setAddress(HwDevice.Switch, 0xe00012, false);
  model.actions.setAddress(HwDevice.PushButton, 0xe00014, false);
  controller.deliver();
  return {
    test,
    engine,
    model,
    controller,
    clock,
    timers,
    async load(lines) {
      const program = await assembleProgram(lines);
      engine.load(program.s68, program.l68, { name: 'program.X68', kind: 'open' });
    },
    runToStop() {
      controller.run();
      controller.settle();
    },
    byte: (address) => engine.memory[address] as number,
    advance(ms, ipms = 1000) {
      for (let t = 0; t < ms; t++) {
        clock.advance(1);
        timers.checkAll(clock.now());
        controller.tick(ipms);
      }
    },
  };
}

const HALT = ['        SIMHALT', '        END     START'];

it.runIf(enginesRequired && !(simBuilt && asmBuilt))(
  'engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)',
  () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist lacks sim68k or asm68k: run `npm run build:engines` first. ' +
        'Without the variable the engine tests are skipped.',
    );
  },
);

describe.skipIf(!(simBuilt && asmBuilt))('hardware §13 items 1-10 through HardwareActions (needs engine/dist)', () => {
  it(
    '1. after a load with the panel visible: all segments and LEDs lit, $E00012 = $00, $E00014 = $FF',
    async () => {
      const r = await rig();
      r.model.actions.setVisible(true);
      r.controller.deliver();
      await r.load(['        ORG     $1000', 'START   NOP', ...HALT]);
      const view = r.model.view(r.engine);
      expect([...view.seg7Bytes]).toEqual(new Array(8).fill(0xff));
      expect(view.ledByte).toBe(0xff);
      expect(r.byte(0xe00012)).toBe(0x00);
      expect(r.byte(0xe00014)).toBe(0xff);
      r.test.release();
    },
    SLOW,
  );

  it(
    '2, 3. program writes to the display and the LEDs',
    async () => {
      const r = await rig();
      r.model.actions.setVisible(true);
      r.controller.deliver();
      await r.load([
        '        ORG     $1000',
        'START   MOVE.B  #$3F,$E00000',
        '        MOVE.B  #$80,$E0000E',
        '        MOVE.W  #$0600,$E00002',
        '        MOVE.B  #$A5,$E00010',
        ...HALT,
      ]);
      r.test.forget();
      r.runToStop();
      const view = r.model.view(r.engine);
      expect(view.seg7Bytes[0]).toBe(0x3f); // segments a-f of the leftmost digit: "0"
      expect(view.seg7Bytes[7]).toBe(0x80); // only the rightmost decimal point
      expect(view.seg7Bytes[1]).toBe(0x06); // "1" on the second digit
      expect(r.byte(0xe00003)).toBe(0x00);
      expect(view.ledByte).toBe(0xa5); // LEDs 7, 5, 2, 0
      expect(r.test.callsTo('hardwareUpdate').length).toBeGreaterThan(0); // the panel was told
      r.test.release();
    },
    SLOW,
  );

  it(
    '4. clicking switch 3 sets bit 3 of $E00012, clicking again clears it, other bits untouched',
    async () => {
      const r = await rig();
      await r.load(['        ORG     $1000', 'START   NOP', ...HALT]);
      r.engine.writeBytes(0xe00012, [0x41]);
      r.model.actions.clickSwitch(3);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0x49);
      expect(r.model.view(r.engine).controls.switchOn[3]).toBe(true);
      r.model.actions.clickSwitch(3);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0x41);
      expect(r.model.view(r.engine).controls.switchOn[3]).toBe(false);
      r.test.release();
    },
    SLOW,
  );

  it(
    '5. a program writes $FF to $E00012: pictures stay; a click on an off switch draws it on, again clears the bit',
    async () => {
      const r = await rig();
      await r.load(['        ORG     $1000', 'START   MOVE.B  #$FF,$E00012', ...HALT]);
      r.runToStop();
      expect(r.byte(0xe00012)).toBe(0xff);
      expect(r.model.view(r.engine).controls.switchOn).toEqual(new Array(8).fill(false));
      r.model.actions.clickSwitch(6);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0xff);
      expect(r.model.view(r.engine).controls.switchOn[6]).toBe(true);
      r.model.actions.clickSwitch(6);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0xbf);
      expect(r.model.view(r.engine).controls.switchOn[6]).toBe(false);
      r.test.release();
    },
    SLOW,
  );

  it(
    '6. hiding and showing the panel with a switch on: byte $00, picture stays on, next click leaves 0 and draws off',
    async () => {
      const r = await rig();
      r.model.actions.setVisible(true);
      r.controller.deliver();
      await r.load(['        ORG     $1000', 'START   NOP', ...HALT]);
      r.model.actions.clickSwitch(1);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0x02);
      r.model.actions.setVisible(false);
      r.model.actions.setVisible(true);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0x00);
      expect(r.model.view(r.engine).controls.switchOn[1]).toBe(true);
      r.model.actions.clickSwitch(1);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0x00);
      expect(r.model.view(r.engine).controls.switchOn[1]).toBe(false);
      r.test.release();
    },
    SLOW,
  );

  it(
    '7. holding push button 2 reads $FB, releasing $FF; after the program writes $00, press and release give $04',
    async () => {
      const r = await rig();
      await r.load(['        ORG     $1000', 'START   MOVE.B  #$00,$E00014', ...HALT]);
      r.model.actions.pressButton(2);
      r.controller.deliver();
      expect(r.byte(0xe00014)).toBe(0xfb);
      r.model.actions.releaseButton(2);
      r.controller.deliver();
      expect(r.byte(0xe00014)).toBe(0xff);
      r.runToStop();
      expect(r.byte(0xe00014)).toBe(0x00);
      r.model.actions.pressButton(2);
      r.model.actions.releaseButton(2);
      r.controller.deliver();
      expect(r.byte(0xe00014)).toBe(0x04);
      r.test.release();
    },
    SLOW,
  );

  it(
    '8. a write to a hardware address inside an enabled ROM, Read, Protected or Invalid range succeeds',
    async () => {
      for (const kind of [MapKind.Rom, MapKind.Read, MapKind.Protected, MapKind.Invalid]) {
        const r = await rig();
        await r.load([
          '        ORG     $1000',
          'START   MOVE.W  #$0000,SR', // user mode, so that Protected applies as well
          '        MOVE.B  #$5A,$E00010',
          '        MOVE.B  #$3F,$E00000',
          '        MOVE.B  #$12,$E00014',
          ...HALT,
        ]);
        r.model.actions.setMap(kind, { start: 0xe00000, end: 0xe000ff });
        r.model.actions.setMap(kind, { enabled: true });
        r.controller.deliver();
        expect(r.model.view(r.engine).controls.map[kind]).toEqual({ enabled: true, start: 0xe00000, end: 0xe000ff });
        r.test.forget();
        r.runToStop();
        const messages = r.test.callsTo('message').map(([text]) => textOf(text));
        expect(
          messages.some((text) => text.includes('Bus Error')),
          messages.join(' | '),
        ).toBe(false);
        expect([r.byte(0xe00010), r.byte(0xe00000), r.byte(0xe00014)]).toEqual([0x5a, 0x3f, 0x12]);
        r.test.release();
      }
    },
    SLOW,
  );

  it(
    '9. moving the display to $100000: the digits follow $100000, $100002, ...; task 32/1 returns $00100000',
    async () => {
      const r = await rig();
      r.model.actions.setVisible(true);
      r.model.actions.setAddress(HwDevice.Seg7, 0x100000, true);
      r.controller.deliver();
      await r.load([
        '        ORG     $1000',
        'START   MOVE.B  #$06,$100000',
        '        MOVE.B  #$5B,$100002',
        '        MOVE.B  #$4F,$10000E',
        '        MOVE.B  #1,D1',
        '        MOVE.B  #32,D0',
        '        TRAP    #15',
        '        MOVE.L  D1,$3000',
        ...HALT,
      ]);
      r.runToStop();
      const view = r.model.view(r.engine);
      expect(view.controls.seg7).toBe(0x100000);
      expect([view.seg7Bytes[0], view.seg7Bytes[1], view.seg7Bytes[7]]).toEqual([0x06, 0x5b, 0x4f]);
      expect(r.engine.readLong(0x3000) >>> 0).toBe(0x00100000);
      r.test.release();
    },
    SLOW,
  );

  it(
    '10. task 32 sub-tasks 1, 2, 3, 7 return the default addresses and 4 the version',
    async () => {
      const r = await rig();
      const lines = ['        ORG     $1000', 'START   LEA     $3000,A0'];
      for (const sub of [1, 2, 3, 7, 4]) {
        lines.push(
          `        MOVE.B  #${sub},D1`,
          '        MOVE.B  #32,D0',
          '        TRAP    #15',
          '        MOVE.L  D1,(A0)+',
        );
      }
      await r.load([...lines, ...HALT]);
      r.runToStop();
      const results = [0, 4, 8, 12, 16].map((offset) => r.engine.readLong(0x3000 + offset) >>> 0);
      expect(results).toEqual([0x00e00000, 0x00e00010, 0x00e00012, 0x00e00014, 0x00051001]);
      r.test.release();
    },
    SLOW,
  );
});

describe.skipIf(!(simBuilt && asmBuilt))('timers, visibility and the queue (needs engine/dist)', () => {
  it(
    'a checked box with interval 500 gives two timerTick posts per second during a run and none after Pause',
    async () => {
      const r = await rig();
      await r.load([
        '        ORG     $1000',
        'START   MOVE.L  #0,$3000',
        '        MOVE.L  #HANDLER,$64',
        '        MOVE.W  #$2000,SR',
        'LOOP    BRA     LOOP',
        'HANDLER ADDQ.L  #1,$3000',
        '        RTE',
        '        END     START',
      ]);
      r.engine.setOption(SimOption.Exceptions, true);
      // The user: level 1 in the list, 500 in the interval box, check box 1, then Run.
      r.model.actions.selectLevel(1);
      r.model.actions.setAutoInterval(500);
      r.model.actions.setAutoChecked(1, true);
      r.controller.deliver();
      const controls = r.model.view(r.engine).controls;
      expect(controls.auto[1]).toEqual({ checked: true, timerEnabled: false, intervalMs: 500 });
      expect(r.model.view(r.engine).autoLabel).toBe('Automatic Disabled'); // a load switches the master flag off
      const ticks = () => r.controller.posted.filter((entry) => entry.kind === 'timerTick').length;

      r.controller.run();
      expect(r.model.view(r.engine).autoLabel).toBe('Automatic Enabled');
      expect(r.timers.all[0]).toMatchObject({ enabled: true, intervalMs: 500 });
      r.advance(1000);
      expect(ticks()).toBe(2);
      r.advance(9000);
      expect(ticks()).toBe(20);
      expect(r.engine.readLong(0x3000)).toBe(20); // every tick reached the program's handler

      r.controller.pause();
      expect(r.model.view(r.engine).autoLabel).toBe('Automatic Disabled');
      expect(r.timers.all[0]?.enabled).toBe(false);
      r.advance(3000);
      expect(ticks()).toBe(20);
      r.test.release();
    },
    SLOW,
  );

  it(
    'showing the panel calls setHardwareVisible(true): switch byte zero, pictures kept',
    async () => {
      const r = await rig();
      await r.load(['        ORG     $1000', 'START   NOP', ...HALT]);
      r.model.actions.clickSwitch(0);
      r.model.actions.clickSwitch(4);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0x11);
      expect(r.engine.hardware().visible).toBe(false);
      r.model.actions.setVisible(true);
      r.controller.deliver();
      expect(r.engine.hardware().visible).toBe(true);
      expect(r.byte(0xe00012)).toBe(0x00);
      expect(r.engine.hardware().switchOn.filter(Boolean)).toHaveLength(2);
      // Already visible: showing again changes nothing.
      r.engine.writeBytes(0xe00012, [0x11]);
      r.model.actions.setVisible(true);
      r.controller.deliver();
      expect(r.byte(0xe00012)).toBe(0x11);
      r.test.release();
    },
    SLOW,
  );

  it(
    'task 32/0 shows the panel through the model (hardwareShow)',
    async () => {
      let shown = 0;
      const clock = new TestClock();
      let current: SimEngine | null = null;
      const controller = new MiniController(() => current as SimEngine);
      const model = new HardwareModel({
        post: controller.post,
        timers: createTestTimers(clock),
        showPanel: () => shown++,
      });
      const test = await createTestEngine({ hardware: model });
      current = test.engine;
      const program = await assembleProgram([
        '        ORG     $1000',
        'START   MOVE.B  #0,D1',
        '        MOVE.B  #32,D0',
        '        TRAP    #15',
        ...HALT,
      ]);
      test.engine.load(program.s68, program.l68, { name: 'program.X68', kind: 'open' });
      controller.run();
      controller.settle();
      expect(shown).toBe(1);
      expect(test.engine.hardware().visible).toBe(true);
      test.release();
    },
    SLOW,
  );

  it(
    'a push-button press and release posted in the same instant are both seen by a polling program (4.3)',
    async () => {
      const r = await rig();
      await r.load([
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
      ]);
      r.controller.run();
      r.controller.tick(1000);
      r.model.actions.pressButton(2);
      r.model.actions.releaseButton(2);
      r.model.actions.pressButton(7);
      r.model.actions.releaseButton(7);
      r.controller.tick(5000);
      expect([...r.engine.memory.subarray(0x3000, 0x3004)]).toEqual([0xfb, 0xff, 0x7f, 0xff]);
      r.test.release();
    },
    SLOW,
  );

  it(
    'the IRQ and Reset buttons follow hardwareState: disabled after SIMHALT, enabled after Rewind',
    async () => {
      const r = await rig();
      await r.load(['        ORG     $1000', 'START   NOP', ...HALT]);
      expect(r.model.view(r.engine).buttonsEnabled).toBe(true);
      r.runToStop();
      expect(r.model.view(r.engine).buttonsEnabled).toBe(false);
      r.engine.rewind();
      expect(r.model.view(r.engine)).toMatchObject({ buttonsEnabled: true, autoLabel: 'Automatic Enabled' });
      r.test.release();
    },
    SLOW,
  );
});
