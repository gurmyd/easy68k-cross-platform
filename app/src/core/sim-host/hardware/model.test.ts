// Unit tests of the hardware model without the engine: timers, view, actions, conflict rule.
// The tests with the real engine are in engine.test.ts.

import { describe, expect, it } from 'vitest';
import { HwDevice, MapKind, type ControllerRequest, type HardwareControls, type SimEngine } from '../../../contracts';
import { HardwareModel, MEMSIZE, addressConflicts, displayedBytes } from './model';
import { TestClock, createTestTimers } from './testing';

function controls(overrides: Partial<HardwareControls> = {}): HardwareControls {
  return {
    seg7: 0xe00000,
    led: 0xe00010,
    switches: 0xe00012,
    pushButtons: 0xe00014,
    map: [0, 1, 2, 3].map(() => ({ enabled: false, start: 0, end: 0 })),
    auto: [null, ...[1, 2, 3, 4, 5, 6, 7].map(() => ({ checked: false, timerEnabled: false, intervalMs: 1000 }))],
    switchOn: new Array<boolean>(8).fill(false),
    visible: true,
    selectedAutoIrq: 1,
    intervalBox: 1000,
    ...overrides,
  };
}

/** Just enough of a SimEngine for the model: memory, hardware() and the calls the actions make. */
function fakeEngine(state: HardwareControls = controls()) {
  const memory = new Uint8Array(MEMSIZE).fill(0xff);
  const calls: string[] = [];
  const engine = {
    memory,
    hardware: () => structuredClone(state),
    setDeviceAddress(device: number, address: number, options?: { commit?: boolean }) {
      calls.push(`setDeviceAddress ${device} ${address.toString(16)} ${options?.commit ? 'commit' : ''}`.trim());
      if (device === HwDevice.Seg7) state.seg7 = address;
      if (device === HwDevice.Led) state.led = address;
      if (device === HwDevice.Switch) state.switches = address;
      if (device === HwDevice.PushButton) state.pushButtons = address;
    },
    setMemoryMap(kind: number, row: object) {
      calls.push(`setMemoryMap ${kind} ${JSON.stringify(row)}`);
    },
    setAutoIrq: (level: number, on: boolean) => calls.push(`setAutoIrq ${level} ${on}`),
    selectAutoIrq: (level: number) => calls.push(`selectAutoIrq ${level}`),
    setAutoInterval: (ms: number) => calls.push(`setAutoInterval ${ms}`),
    setHardwareVisible: (visible: boolean) => calls.push(`setHardwareVisible ${visible}`),
  } as unknown as SimEngine;
  return { engine, memory, calls, state };
}

function setup() {
  const clock = new TestClock();
  const timers = createTestTimers(clock);
  const posted: ControllerRequest[] = [];
  let shown = 0;
  const model = new HardwareModel({ post: (r) => posted.push(r), timers, showPanel: () => shown++ });
  /** Delivers the posted engine calls to `engine`, as the controller does. */
  const deliver = (engine: SimEngine) => {
    for (const request of posted.splice(0)) if (request.kind === 'call') request.fn(engine);
  };
  return { clock, timers, posted, model, deliver, shown: () => shown };
}

describe('timers (3.3.3, 4.5.3)', () => {
  it('creates seven timers that post timerTick with their level', () => {
    const { timers, posted, clock, model } = setup();
    expect(timers.all).toHaveLength(7);
    for (let level = 1; level <= 7; level++) model.hardwareTimer(level, true, 100 * level);
    clock.advance(700);
    timers.checkAll(clock.now());
    expect(posted).toEqual([1, 2, 3, 4, 5, 6, 7].map((level) => ({ kind: 'timerTick', level })));
  });

  it('arms the timer the engine names, with its interval; disabling stops it', () => {
    const { timers, posted, clock, model } = setup();
    model.hardwareTimer(3, true, 250);
    expect(timers.all[2]).toMatchObject({ enabled: true, intervalMs: 250 });
    for (let t = 0; t < 1000; t++) {
      clock.advance(1);
      timers.checkAll(clock.now());
    }
    expect(posted).toHaveLength(4);
    model.hardwareTimer(3, false, 250);
    clock.advance(5000);
    timers.checkAll(clock.now());
    expect(posted).toHaveLength(4);
  });

  it('an unchanged report does not restart a running period', () => {
    const { timers, posted, clock, model } = setup();
    model.hardwareTimer(1, true, 500);
    clock.advance(400);
    model.hardwareTimer(1, true, 500); // same values again
    clock.advance(100);
    timers.checkAll(clock.now());
    expect(posted).toEqual([{ kind: 'timerTick', level: 1 }]);
  });

  it('ignores levels outside 1..7', () => {
    const { timers, model } = setup();
    model.hardwareTimer(0, true, 10);
    model.hardwareTimer(8, true, 10);
    expect(timers.all.every((t) => !t.enabled)).toBe(true);
  });

  it('resetToStartup switches all seven off and forgets the reported state', () => {
    const { timers, model } = setup();
    const { engine } = fakeEngine();
    for (let level = 1; level <= 7; level++) model.hardwareTimer(level, true, 1000);
    model.hardwareState(false, true);
    model.resetToStartup();
    expect(timers.all.every((t) => !t.enabled)).toBe(true);
    const view = model.view(engine);
    expect(view.autoLabel).toBe('Automatic');
    expect(view.buttonsEnabled).toBe(true);
  });
});

describe('view', () => {
  it('reads the eight even 7-segment bytes and the LED byte', () => {
    const { model } = setup();
    const { engine, memory } = fakeEngine();
    for (let i = 0; i < 16; i++) memory[0xe00000 + i] = i;
    memory[0xe00010] = 0xa5;
    const view = model.view(engine);
    expect([...view.seg7Bytes]).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(view.ledByte).toBe(0xa5);
    expect(view.controls.seg7).toBe(0xe00000);
  });

  it('labels and buttons follow hardwareState; "Automatic" before the first report', () => {
    const { model } = setup();
    const { engine } = fakeEngine();
    expect(model.view(engine)).toMatchObject({ autoLabel: 'Automatic', buttonsEnabled: true });
    model.hardwareState(true, true);
    expect(model.view(engine)).toMatchObject({ autoLabel: 'Automatic Enabled', buttonsEnabled: true });
    model.hardwareState(false, false);
    expect(model.view(engine)).toMatchObject({ autoLabel: 'Automatic Disabled', buttonsEnabled: false });
  });

  it('digits keep their last bytes while seg7 >= MEMSIZE - 8', () => {
    const previous = { seg7Bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), ledByte: 9 };
    const memory = new Uint8Array(MEMSIZE);
    expect([...displayedBytes(memory, 0xfffff8, 0xe00010, previous).seg7Bytes]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...displayedBytes(memory, 0xfffff7, 0xe00010, previous).seg7Bytes]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(displayedBytes(memory, 0, MEMSIZE, previous).ledByte).toBe(9);
  });

  it('notifies on hardwareUpdate, hardwareControls, hardwareState and hardwareTimer', () => {
    const { model } = setup();
    let count = 0;
    const unsubscribe = model.subscribe(() => count++);
    model.hardwareUpdate();
    model.hardwareControls();
    model.hardwareState(true, false);
    model.hardwareTimer(1, true, 10);
    expect(count).toBe(4);
    unsubscribe();
    model.hardwareUpdate();
    expect(count).toBe(4);
  });
});

describe('actions go to the controller queue (3.3.3)', () => {
  it('switches, push buttons, IRQ and Reset are queue entries', () => {
    const { model, posted } = setup();
    model.actions.clickSwitch(3);
    model.actions.pressButton(2);
    model.actions.releaseButton(2);
    model.actions.requestIrq(5);
    model.actions.reset();
    model.actions.clickSwitch(8); // out of range: nothing
    model.actions.requestIrq(0);
    expect(posted).toEqual([
      { kind: 'switchClick', bit: 3 },
      { kind: 'pushButton', bit: 2, down: true },
      { kind: 'pushButton', bit: 2, down: false },
      { kind: 'irq', level: 5 },
      { kind: 'hwReset' },
    ]);
  });

  it('a press and a release posted at once stay two entries', () => {
    const { model, posted } = setup();
    model.actions.pressButton(0);
    model.actions.releaseButton(0);
    expect(posted).toHaveLength(2);
  });

  it('the other actions are engine calls through the queue, never direct', () => {
    const { model, posted, deliver } = setup();
    const { engine, calls } = fakeEngine();
    model.actions.setAutoChecked(1, true);
    model.actions.selectLevel(8);
    model.actions.setAutoInterval(250);
    model.actions.setAddress(HwDevice.Switch, 0xe00020, true);
    model.actions.setMap(MapKind.Rom, { enabled: true, start: 0x2000, end: 0x2fff });
    model.actions.setVisible(true);
    expect(calls).toEqual([]);
    expect(posted.every((r) => r.kind === 'call')).toBe(true);
    let notified = 0;
    model.subscribe(() => notified++);
    deliver(engine);
    expect(calls).toEqual([
      'setAutoIrq 1 true',
      'selectAutoIrq 8',
      'setAutoInterval 250',
      'setDeviceAddress 2 e00020 commit',
      'setMemoryMap 0 {"enabled":true,"start":8192,"end":12287}',
      'setHardwareVisible true',
    ]);
    expect(notified).toBe(6);
  });

  it('hardwareShow shows the panel, then asks for setHardwareVisible(true) through the queue', () => {
    const { model, posted, deliver, shown } = setup();
    const { engine, calls } = fakeEngine();
    model.hardwareShow();
    expect(shown()).toBe(1);
    expect(calls).toEqual([]);
    deliver(engine);
    expect(calls).toEqual(['setHardwareVisible true']);
    expect(posted).toEqual([]);
  });
});

describe('address-conflict colouring (hardware §2.6)', () => {
  const base = { seg7: 0xe00000, led: 0xe00010, switches: 0xe00012, pushButtons: 0xe00014 };

  it('the default layout has no conflict', () => {
    expect(addressConflicts(base)).toEqual({ seg7: false, led: false, sw: false, pb: false });
  });

  it('a device inside the 16 bytes of the display colours both', () => {
    expect(addressConflicts({ ...base, led: 0xe0000f })).toEqual({ seg7: true, led: true, sw: false, pb: false });
    expect(addressConflicts({ ...base, pushButtons: 0xe00000 })).toEqual({
      seg7: true,
      led: false,
      sw: false,
      pb: true,
    });
  });

  it('two one-byte devices on one address colour both', () => {
    expect(addressConflicts({ ...base, switches: 0xe00010 })).toEqual({ seg7: false, led: true, sw: true, pb: false });
    expect(addressConflicts({ ...base, pushButtons: 0xe00012 })).toEqual({
      seg7: false,
      led: false,
      sw: true,
      pb: true,
    });
  });

  it('a display at or above MEMSIZE - 8 is red by itself', () => {
    expect(addressConflicts({ ...base, seg7: 0xfffff8 }).seg7).toBe(true);
    expect(addressConflicts({ ...base, seg7: 0xfffff7 }).seg7).toBe(false);
  });

  it('is recomputed when the user edits an address, not when addresses come from elsewhere', () => {
    const { model, deliver } = setup();
    const fake = fakeEngine();
    fake.state.led = 0xe00012; // set "programmatically": no recolouring
    expect(model.view(fake.engine).addressConflict).toEqual({ seg7: false, led: false, sw: false, pb: false });
    model.actions.setAddress(HwDevice.PushButton, 0xe00014, false); // a key release in any field
    deliver(fake.engine);
    expect(model.view(fake.engine).addressConflict).toEqual({ seg7: false, led: true, sw: true, pb: false });
    model.actions.setAddress(HwDevice.Led, 0xe00010, false);
    deliver(fake.engine);
    expect(model.view(fake.engine).addressConflict).toEqual({ seg7: false, led: false, sw: false, pb: false });
  });

  it('a memory-map range edit recolours too; a map check box does not', () => {
    const { model, deliver } = setup();
    const fake = fakeEngine();
    fake.state.switches = 0xe00014;
    model.actions.setMap(MapKind.Read, { enabled: true });
    deliver(fake.engine);
    expect(model.view(fake.engine).addressConflict.sw).toBe(false);
    model.actions.setMap(MapKind.Read, { start: 0x100 });
    deliver(fake.engine);
    expect(model.view(fake.engine).addressConflict).toMatchObject({ sw: true, pb: true });
  });
});
