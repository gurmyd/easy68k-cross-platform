// The hardware feature in a test application: the command, the panel and the visibility rule.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AppContext, ControllerRequest, InputEvent68k, SimEngine, SimSession } from '../../contracts';
import { HardwareModel } from '../../core/sim-host/hardware/model';
import { MiniController, TestClock, createTestTimers } from '../../core/sim-host/hardware/testing';
import { assembleProgram, createTestEngine } from '../../engine/testing';
import { hidePanel, panelVisible, showPanel } from '../../state/panels';
import { withPanelVisible } from '../../state/layout';
import { createInertController, createInertSimSession } from '../../state/stub-services';
import { MemorySettingsStorage } from '../../core/settings/service';
import { createTestApplication } from '../../state/testing';
import { feature } from './index';

type Entry = ControllerRequest | InputEvent68k;

/** A session whose hardware model posts into `posted`, and delivers the engine calls to `engine`. */
function sessionWith(post: (entry: Entry) => void, engine?: SimEngine) {
  return (ctx: AppContext): SimSession => {
    const inert = createInertSimSession(ctx);
    const hardware = new HardwareModel({ post, timers: createTestTimers(new TestClock()), showPanel: () => {} });
    return {
      ...inert,
      engine: engine ?? inert.engine,
      hardware,
      controller: { ...createInertController(), post },
    };
  };
}

const visibilityCalls = (posted: Entry[]) => {
  const seen: boolean[] = [];
  const probe = { setHardwareVisible: (visible: boolean) => seen.push(visible) } as unknown as SimEngine;
  for (const entry of posted) if (entry.kind === 'call') entry.fn(probe);
  return seen;
};

describe('feature "hardware"', () => {
  it('contributes the Hardware panel of Simulator mode and the View > Hardware command', () => {
    expect(feature.panels?.map((p) => [p.id, p.mode, p.title])).toEqual([['hardware', 'simulator', 'Hardware']]);
    expect(Object.keys(feature.commands ?? {})).toEqual(['sim.view.hardware']);
  });

  it('View > Hardware shows the panel and tells the engine setHardwareVisible(true) through the queue', async () => {
    const posted: Entry[] = [];
    const app = createTestApplication({
      features: [feature],
      services: { createSimSession: sessionWith((e) => posted.push(e)) },
    });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    expect(panelVisible(app.ctx, 'hardware')).toBe(false);
    expect(app.ctx.commands.isEnabled('sim.view.hardware')).toBe(true);
    await app.ctx.commands.run('sim.view.hardware');
    expect(panelVisible(app.ctx, 'hardware')).toBe(true);
    expect(app.shell.getState().activeTool).toBe('hardware');
    expect(visibilityCalls(posted)).toEqual([true]);
    // Showing it again changes nothing.
    await app.ctx.commands.run('sim.view.hardware');
    expect(visibilityCalls(posted)).toEqual([true]);
    app.dispose();
  });

  it('hiding the panel tells the engine; other settings changes do not', () => {
    const posted: Entry[] = [];
    const app = createTestApplication({
      features: [feature],
      services: { createSimSession: sessionWith((e) => posted.push(e)) },
    });
    showPanel(app.ctx, 'hardware', { focus: false });
    app.ctx.settings.update((s) => ({ ...s, app: { ...s.app, theme: 'dark' } }));
    hidePanel(app.ctx, 'hardware');
    showPanel(app.ctx, 'memory', { focus: false });
    showPanel(app.ctx, 'hardware', { focus: false });
    expect(visibilityCalls(posted)).toEqual([true, false, true]);
    app.dispose();
  });

  it('a layout restored with the panel visible tells the engine at the start', () => {
    const storage = new MemorySettingsStorage();
    const first = createTestApplication({ storage, features: [feature] });
    first.ctx.settings.update((s) => withPanelVisible(s, 'hardware', true));
    first.dispose();
    const posted: Entry[] = [];
    const second = createTestApplication({
      storage,
      features: [feature],
      services: { createSimSession: sessionWith((e) => posted.push(e)) },
    });
    expect(panelVisible(second.ctx, 'hardware')).toBe(true);
    expect(visibilityCalls(posted)).toEqual([true]);
    second.dispose();
  });
});

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const enginesBuilt =
  existsSync(repo('engine/dist/sim68k.wasm')) &&
  existsSync(repo('engine/dist/sim68k-loader.mjs')) &&
  existsSync(repo('engine/dist/asm68k.wasm'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

describe.skipIf(!enginesBuilt)('with the real engine (needs engine/dist)', () => {
  it('showing the panel: switch byte $00, switch pictures kept', async () => {
    let current: SimEngine | null = null;
    const controller = new MiniController(() => current as SimEngine);
    // The session's model is the engine's hardware part, as in the application (3.3.1).
    const model = new HardwareModel({
      post: controller.post,
      timers: createTestTimers(new TestClock()),
      showPanel: () => {},
    });
    const test = await createTestEngine({ hardware: model });
    current = test.engine;
    const app = createTestApplication({
      features: [feature],
      services: {
        createSimSession: (ctx) => ({
          ...createInertSimSession(ctx),
          engine: test.engine,
          hardware: model,
          controller: { ...createInertController(), post: controller.post },
        }),
      },
    });
    const program = await assembleProgram([
      '        ORG     $1000',
      'START   NOP',
      '        SIMHALT',
      '        END     START',
    ]);
    test.engine.load(program.s68, program.l68, { name: 'program.X68', kind: 'open' });
    test.engine.setDeviceAddress(2, 0xe00012);
    app.ctx.sim.hardware.actions.clickSwitch(2);
    app.ctx.sim.hardware.actions.clickSwitch(5);
    controller.deliver();
    expect(test.engine.memory[0xe00012]).toBe(0x24);

    await app.ctx.commands.run('sim.view.hardware');
    controller.deliver();
    expect(test.engine.hardware().visible).toBe(true);
    expect(test.engine.memory[0xe00012]).toBe(0x00);
    expect(
      test.engine
        .hardware()
        .switchOn.map((on, bit) => (on ? bit : -1))
        .filter((b) => b >= 0),
    ).toEqual([2, 5]);
    const view = app.ctx.sim.hardware.view(test.engine);
    expect(view.controls.switchOn[2] && view.controls.switchOn[5]).toBe(true);
    test.release();
    app.dispose();
  }, 60_000);
});
