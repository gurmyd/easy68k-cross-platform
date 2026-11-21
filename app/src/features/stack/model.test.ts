import { describe, expect, it } from 'vitest';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { ManualScheduler, createFakeEngine, createSessionDouble, type SessionDouble } from '../memory/session-double';
import { feature } from '.';
import { stackModelOf, stackRecentreDue } from './model';

function setup(): { app: TestApplication; session: SessionDouble; engine: ReturnType<typeof createFakeEngine> } {
  const engine = createFakeEngine({ fill: 0 });
  let session!: SessionDouble;
  const app = createTestApplication({
    features: [feature],
    scheduler: new ManualScheduler(),
    services: {
      createSimSession: (ctx) => {
        session = createSessionDouble(createInertSimSession(ctx), engine, () =>
          createFakeEngine({ fill: 0, registers: { ssp: 0x2000, a7: 0x2000 } }),
        );
        return session;
      },
    },
  });
  return { app, session, engine };
}

const bumpView = (app: TestApplication) =>
  app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, viewRevision: state.sim.viewRevision + 1 } }));
const bumpLive = (app: TestApplication) =>
  app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, liveRevision: state.sim.liveRevision + 1 } }));

describe('Stack panel model', { timeout: 60_000 }, () => {
  it('starts on SS, the saved choice, at the start-up state of the engine', () => {
    const { app } = setup();
    const model = stackModelOf(app.ctx);
    model.setRows(9);
    model.shown();
    const state = model.getState();
    expect(state.choice).toBe(8);
    expect(state.view[4]?.address).toBe(0);
    expect(state.view[4]?.bytes[0]?.mark).toBe('sp');
    expect(state.view.flatMap((row) => row.bytes).some((byte) => byte.mark === 'reg')).toBe(false);
  });

  it('re-centres on the selected register at every viewRevision change (scrshow)', () => {
    const { app, engine } = setup();
    const model = stackModelOf(app.ctx);
    model.setRows(5);
    model.setChoice(0);
    engine.setRegisters({ a: [0x1234, 0, 0, 0, 0, 0, 0] });
    model.scrollDown();
    model.scrollDown();
    bumpView(app);
    expect(model.getState().midAddr).toBe(0x1234);
    expect(model.getState().view[2]?.address).toBe(0x1234);
    expect(model.getState().view[2]?.bytes[0]?.mark).toBe('reg');
  });

  it('a liveRevision change redraws without re-centring, but not during a full-speed run', () => {
    const { app, session, engine } = setup();
    const model = stackModelOf(app.ctx);
    model.setRows(3);
    model.setChoice(1);
    engine.setRegisters({ a: [0, 0x400, 0, 0, 0, 0, 0] });
    model.updateDisplay();
    model.scrollUp();
    expect(model.getState().midAddr).toBe(0x3fc);
    engine.writeBytes(0x3fc, [0x77]);
    bumpLive(app);
    expect(model.getState().midAddr).toBe(0x3fc);
    expect(model.getState().view[1]?.bytes[0]?.text).toBe('77 ');

    app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, phase: 'running' } }));
    session.phase = 'running';
    engine.writeBytes(0x3fc, [0x88]);
    bumpLive(app);
    expect(model.getState().view[1]?.bytes[0]?.text).toBe('77 ');
  });

  it('with sim.repaint published, re-centres only when repaint.stack moves', () => {
    const { app, engine } = setup();
    const repaint = { listing: 0, breakpoints: 0, memory: 0, stack: 0 };
    app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, repaint } }));
    const model = stackModelOf(app.ctx);
    model.setRows(5);
    model.setChoice(0);
    engine.setRegisters({ a: [0x1234, 0, 0, 0, 0, 0, 0] });
    model.scrollDown();
    // viewRevision alone (a direct memory write, a listing-only repaint): no re-centre.
    app.ctx.store.setState((state) => ({
      ...state,
      sim: { ...state.sim, viewRevision: state.sim.viewRevision + 1, repaint: { ...repaint, listing: 1 } },
    }));
    expect(model.getState().midAddr).toBe(4);
    app.ctx.store.setState((state) => ({
      ...state,
      sim: { ...state.sim, viewRevision: state.sim.viewRevision + 1, repaint: { ...repaint, listing: 1, stack: 1 } },
    }));
    expect(model.getState().midAddr).toBe(0x1234);
  });

  it('stackRecentreDue falls back on viewRevision while sim.repaint is absent', () => {
    const { app } = setup();
    const sim = app.ctx.store.getState().sim;
    expect(stackRecentreDue(sim, { ...sim, liveRevision: sim.liveRevision + 1 })).toBe(false);
    expect(stackRecentreDue(sim, { ...sim, viewRevision: sim.viewRevision + 1 })).toBe(true);
  });

  it('remembers the View choice in the settings', () => {
    const { app } = setup();
    const model = stackModelOf(app.ctx);
    model.setChoice(7);
    expect(app.ctx.settings.get().sim.whichStack).toBe(7);
  });

  it('shows the Invalid range of the memory map in red', () => {
    const { app, engine } = setup();
    engine.setRegisters({ ssp: 0x500 });
    engine.setInvalid({ enabled: true, start: 0x500, end: 0x503 });
    const model = stackModelOf(app.ctx);
    model.setRows(3);
    model.updateDisplay();
    expect(model.getState().view[1]?.bytes.map((byte) => byte.invalid)).toEqual([true, true, true, true]);
    expect(model.getState().view[0]?.bytes.some((byte) => byte.invalid)).toBe(false);
  });

  it('after a cold start reads the new engine and the saved choice', async () => {
    const { app, session } = setup();
    const model = stackModelOf(app.ctx);
    model.setRows(3);
    model.setChoice(2);
    app.ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, whichStack: 8 } }));
    await session.coldStart();
    expect(model.getState().choice).toBe(8);
    expect(model.getState().midAddr).toBe(0x2000);
    expect(model.getState().view[1]?.bytes[0]?.mark).toBe('reg');
    // ...and keeps reading it afterwards.
    session.engine.writeBytes(0x2000, [0x5a]);
    model.displayStack();
    expect(model.getState().view[1]?.bytes[0]?.text).toBe('5A ');
  });
});
