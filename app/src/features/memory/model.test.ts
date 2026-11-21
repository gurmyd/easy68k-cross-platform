import { describe, expect, it } from 'vitest';
import { SimOption, type FileDialogs, type SaveRequest, type VPath } from '../../contracts';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature as stackFeature } from '../stack';
import { stackModelOf } from '../stack/model';
import { feature, addressArgument } from '.';
import { BLANK_ADDRESS, BLANK_BYTES, PERSIST_DELAY_MS, memoryModelOf } from './model';
import { ASC_LEFT, HEX_LEFT, HEX_RIGHT, MEMSIZE } from './rules';
import {
  ManualScheduler,
  createFakeEngine,
  createSessionDouble,
  openMessageBoxes,
  type SessionDouble,
} from './session-double';

interface Setup {
  app: TestApplication;
  session: SessionDouble;
  scheduler: ManualScheduler;
  saved: VPath[];
  requests: SaveRequest[];
  engine: ReturnType<typeof createFakeEngine>;
}

function setup(options: { savePath?: VPath | null; pokeBumpsView?: boolean } = {}): Setup {
  const scheduler = new ManualScheduler();
  const engine = createFakeEngine();
  const saved: VPath[] = [];
  const requests: SaveRequest[] = [];
  let session!: SessionDouble;
  const fileDialogs: FileDialogs = {
    open: async () => null,
    save: async (request) => {
      requests.push(request);
      const path = options.savePath === undefined ? '/browser/memory.bin' : options.savePath;
      if (path) saved.push(path);
      return path;
    },
    registerProvider: () => () => {},
  };
  const app = createTestApplication({
    features: [feature, stackFeature],
    scheduler,
    services: {
      createSimSession: (ctx) => {
        session = createSessionDouble(createInertSimSession(ctx), engine, () => createFakeEngine({ fill: 0x00 }), {
          ctx,
          pokeBumpsView: options.pokeBumpsView ?? false,
        });
        return session;
      },
      createFileDialogs: () => fileDialogs,
    },
  });
  return { app, session, scheduler, saved, requests, engine };
}

const rowTexts = (app: TestApplication) =>
  memoryModelOf(app.ctx)
    .getState()
    .view.map((row) => row.addressText + row.hex.join('') + row.ascii.join(''));

/** Lets a message box appear (messageBox is called after an await) and answers it with OK. */
async function answerBox(app: TestApplication): Promise<{ title: string; text: string; icon: string }> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const boxes = openMessageBoxes(app.ctx);
  expect(boxes).toHaveLength(1);
  const box = boxes[0]!;
  app.dialogs.close(box.key, 'OK');
  return { title: box.title, text: box.text, icon: box.icon };
}

describe('Memory panel model', { timeout: 60_000 }, () => {
  it('paints nRows rows from the engine in the format of sim-ui §10.1', () => {
    const { app, engine } = setup();
    engine.writeBytes(0x1000, [0x10, 0x3c, 0x00, 0x0e, 0x43, 0xf9, 0x00, 0x00, 0x10, 0x12, 0x4e, 0x4f]);
    const model = memoryModelOf(app.ctx);
    model.setRows(3);
    model.setAddress(0x1000);
    expect(model.addressText).toBe('001000');
    expect(rowTexts(app)).toEqual([
      '00001000: 10 3C 00 0E 43 F9 00 00 10 12 4E 4F FF FF FF FF -<--C-----NO----',
      '00001010: FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF ----------------',
      '00001020: FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF ----------------',
    ]);
  });

  it('rounds the Address field down to 16 on every change', () => {
    const { app } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(2);
    model.setAddressText('00123F');
    expect(model.getState().address).toBe(0x1230);
    expect(model.addressText).toBe('001230');
  });

  it('pages and moves by rows within the limits', () => {
    const { app } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(8);
    model.setAddress(0);
    model.rowUp();
    expect(model.getState().address).toBe(0);
    model.pageDown();
    expect(model.getState().address).toBe(0x80);
    model.pageUp();
    model.pageUp();
    expect(model.getState().address).toBe(0);
    model.setAddress(0xfffff0);
    model.rowDown();
    expect(model.getState().address).toBe(0xfffff0);
    model.wheel(-100, 0);
    expect(model.getState().address).toBe(0xffffe0);
    model.wheel(200, 0);
    expect(model.getState().address).toBe(0xfffff0);
    // The rows beyond MEMSIZE are drawn red.
    expect(model.getState().view[1]?.addressInvalid).toBe(true);
  });

  it('edits a byte through the controller, advances the cursor and tells the other panels', () => {
    const { app, session, engine } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(4);
    model.setAddress(0x2000);
    model.place({ row: 0, col: 3 });
    expect(model.getState().cursor).toEqual({ row: 0, col: HEX_LEFT });
    const live = app.ctx.store.getState().sim.liveRevision;
    expect(model.typeKey('1', { ctrl: false, alt: false, meta: false })).toBe(true);
    expect(model.typeKey('a', { ctrl: false, alt: false, meta: false })).toBe(true);
    expect(session.pokes).toEqual([
      [0x2000, 0x1f],
      [0x2000, 0x1a],
    ]);
    expect(engine.memory[0x2000]).toBe(0x1a);
    expect(model.getState().cursor).toEqual({ row: 0, col: 13 });
    expect(app.ctx.store.getState().sim.liveRevision).toBe(live + 2);
    expect(model.getState().view[0]?.hex[0]).toBe('1A ');
    // Not a hex digit: the original beeps, nothing is written.
    expect(model.typeKey('g', { ctrl: false, alt: false, meta: false })).toBe(false);
    expect(session.pokes).toHaveLength(2);
    // Keys that produce no character are not taken.
    expect(model.typeKey('F5', { ctrl: false, alt: false, meta: false })).toBe(null);
  });

  it('stores raw characters in the ASCII area, Enter as $0D', () => {
    const { app, engine } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(4);
    model.setAddress(0x3000);
    model.place({ row: 1, col: ASC_LEFT + 2 });
    model.typeKey('Enter', { ctrl: false, alt: false, meta: false });
    model.typeKey('é', { ctrl: false, alt: false, meta: false });
    expect(engine.memory[0x3012]).toBe(0x0d);
    expect(engine.memory[0x3013]).toBe(0xe9);
    expect(model.getState().view[1]?.ascii.slice(2, 4)).toEqual(['-', '-']);
  });

  it('wraps at the end of the last row by moving the view down one row', () => {
    const { app } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(2);
    model.setAddress(0x4000);
    model.place({ row: 1, col: HEX_RIGHT });
    model.typeCode(0x37);
    expect(model.getState().address).toBe(0x4010);
    expect(model.getState().cursor).toEqual({ row: 1, col: HEX_LEFT });
  });

  it('moves the cursor with the arrow keys and scrolls at the edges', () => {
    const { app } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(2);
    model.setAddress(0x100);
    model.place({ row: 0, col: 20 });
    model.moveCursor('ArrowUp');
    expect(model.getState().address).toBe(0xf0);
    expect(model.getState().cursor).toEqual({ row: 0, col: 20 });
    model.moveCursor('ArrowDown');
    model.moveCursor('ArrowDown');
    expect(model.getState().address).toBe(0x100);
    expect(model.getState().cursor).toEqual({ row: 1, col: 20 });
  });

  it('refuses an edit beyond MEMSIZE', () => {
    const { app, session } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(3);
    model.setAddress(0xfffff0);
    model.place({ row: 2, col: 10 });
    expect(model.typeCode(0x31)).toBe(false);
    expect(session.pokes).toEqual([]);
    expect(MEMSIZE).toBe(0x1000000);
  });

  it('Copy: copies through the controller and shows "Invalid copy range" for a bad range', async () => {
    const { app, session, engine } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(2);
    engine.writeBytes(0x1000, [1, 2, 3, 4, 5, 6, 7, 8]);
    model.setFrom('001000');
    model.setTo('001002');
    model.setBytes('00000008');
    const invokes = session.invokes.count;
    await model.copy();
    expect(session.invokes.count).toBe(invokes + 1);
    expect([...engine.memory.slice(0x1000, 0x100a)]).toEqual([1, 2, 1, 2, 3, 4, 5, 6, 7, 8]);

    model.setTo('001000');
    const done = model.copy();
    expect(await answerBox(app)).toEqual({ title: 'SIM68K', text: 'Invalid copy range', icon: 'none' });
    await done;

    // From > To running into MEMSIZE: the bytes up to it are copied, then the box.
    engine.writeBytes(0xfffffe, [0xaa, 0xbb]);
    model.setFrom('FFFFFE');
    model.setTo('000010');
    model.setBytes('00000004');
    const partial = model.copy();
    expect(await answerBox(app)).toMatchObject({ text: 'Invalid copy range' });
    await partial;
    expect([...engine.memory.slice(0x10, 0x14)]).toEqual([0xaa, 0xbb, 0xff, 0xff]);
  });

  it('Fill: writes the 4-byte pattern From through To; From > To does nothing', async () => {
    const { app, engine } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(2);
    model.setFrom('000100');
    model.setTo('000105');
    model.setBytes('12345678');
    await model.fill();
    expect([...engine.memory.slice(0x100, 0x107)]).toEqual([0x12, 0x34, 0x56, 0x78, 0x12, 0x34, 0xff]);
    model.setFrom('000200');
    model.setTo('0001FF');
    await model.fill();
    expect(openMessageBoxes(app.ctx)).toEqual([]);
  });

  it('Save: writes From through To to the chosen file; "Invalid memory range." for a bad range', async () => {
    const { app, engine, saved, requests } = setup();
    const model = memoryModelOf(app.ctx);
    engine.writeBytes(0x500, [9, 8, 7, 6]);
    model.setFrom('000500');
    model.setTo('000503');
    await model.save();
    expect(saved).toEqual(['/browser/memory.bin']);
    // The original's own question for an existing file (Memory1.cpp:646), asked by the dialog.
    expect(requests[0]).toMatchObject({
      defaultExt: 'bin',
      overwritePrompt: { title: 'Alert', text: 'File exists! OK to replace?' },
    });
    expect([...(await app.ctx.vfs.readFile('/browser/memory.bin'))]).toEqual([9, 8, 7, 6]);

    model.setTo('0004FF');
    const done = model.save();
    expect(await answerBox(app)).toEqual({ title: 'Information', text: 'Invalid memory range.', icon: 'none' });
    await done;
  });

  it('Save: a cancelled dialog writes nothing; a failed write shows the original box', async () => {
    const cancelled = setup({ savePath: null });
    const model = memoryModelOf(cancelled.app.ctx);
    model.setFrom('000000');
    model.setTo('00000F');
    await model.save();
    expect(cancelled.saved).toEqual([]);

    const failing = setup({ savePath: '/nowhere/x.bin' });
    const other = memoryModelOf(failing.app.ctx);
    other.setFrom('000000');
    other.setTo('00000F');
    const done = other.save();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const box = await answerBox(failing.app);
    expect(box).toEqual({ title: 'Information', text: 'Error saving 68K memory to file.', icon: 'information' });
    await done;
  });

  it('repaints at viewRevision changes only, so that it is static during a run without Live', () => {
    const { app, engine } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(1);
    model.setAddress(0x6000);
    engine.writeBytes(0x6000, [0x42]);
    expect(model.getState().view[0]?.hex[0]).toBe('FF ');
    app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, viewRevision: state.sim.viewRevision + 1 } }));
    expect(model.getState().view[0]?.hex[0]).toBe('42 ');
  });

  it('with sim.repaint published, repaints when repaint.memory or liveRevision moves, not at other repaints', () => {
    const { app, engine } = setup();
    const repaint = { listing: 0, breakpoints: 0, memory: 0, stack: 0 };
    app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, repaint } }));
    const model = memoryModelOf(app.ctx);
    model.setRows(1);
    model.setAddress(0x6000);
    const paints = model.getState().paints;
    // A repaint that names only the listing (a breakpoint set from the gutter).
    app.ctx.store.setState((state) => ({
      ...state,
      sim: { ...state.sim, viewRevision: state.sim.viewRevision + 1, repaint: { ...repaint, listing: 1 } },
    }));
    expect(model.getState().paints).toBe(paints);
    engine.writeBytes(0x6000, [0x42]);
    app.ctx.store.setState((state) => ({
      ...state,
      sim: { ...state.sim, viewRevision: state.sim.viewRevision + 1, repaint: { ...repaint, listing: 1, memory: 1 } },
    }));
    expect(model.getState().view[0]?.hex[0]).toBe('42 ');
    engine.writeBytes(0x6000, [0x43]);
    app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, liveRevision: state.sim.liveRevision + 1 } }));
    expect(model.getState().view[0]?.hex[0]).toBe('43 ');
  });

  it('a typed byte redraws a scrolled Stack panel without re-centring it (sim-ui §11.4)', () => {
    // As the real session does at gate I1: pokeMemory bumps viewRevision and liveRevision at once,
    // and the store carries `sim.repaint` (the engine named no panel for a direct write).
    const { app, engine } = setup({ pokeBumpsView: true });
    app.ctx.store.setState((state) => ({
      ...state,
      sim: { ...state.sim, repaint: { listing: 0, breakpoints: 0, memory: 0, stack: 0 } },
    }));
    engine.setRegisters({ ssp: 0x8000, a7: 0x8000 });
    const stack = stackModelOf(app.ctx);
    stack.setRows(5);
    stack.shown();
    stack.scrollUp();
    stack.scrollUp();
    stack.scrollUp();
    expect(stack.getState().midAddr).toBe(0x7ff4);
    const memory = memoryModelOf(app.ctx);
    memory.setRows(2);
    memory.setAddress(0x7ff0);
    memory.place({ row: 0, col: HEX_LEFT + 3 * 4 }); // byte $7FF4
    expect(memory.typeKey('1', { ctrl: false, alt: false, meta: false })).toBe(true);
    expect(engine.memory[0x7ff4]).toBe(0x1f);
    expect(stack.getState().midAddr).toBe(0x7ff4);
    expect(stack.getState().view[2]?.bytes[0]?.text).toBe('1F ');
  });

  it('Live: sets SimOption.MemLive and repaints changed rows once per frame, also at address 0', () => {
    const { app, engine, scheduler } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(2);
    model.setAddress(0);
    model.setLive(true);
    expect(engine.getOption(SimOption.MemLive)).toBe(1);
    expect(scheduler.frameListeners).toBe(1);
    const paints = model.getState().paints;
    scheduler.frame();
    expect(model.getState().paints).toBe(paints);
    engine.writeBytes(0x0000, [0x12]);
    scheduler.frame();
    expect(model.getState().view[0]?.hex[0]).toBe('12 ');
    expect(model.getState().paints).toBe(paints + 1);
    // A write outside the visible rows causes no paint.
    engine.writeBytes(0x8000, [0x34]);
    scheduler.frame();
    expect(model.getState().paints).toBe(paints + 1);
    model.setLive(false);
    expect(engine.getOption(SimOption.MemLive)).toBe(0);
    expect(scheduler.frameListeners).toBe(0);
  });

  it('remembers the address in the settings shortly after the last change', () => {
    const { app, scheduler } = setup();
    const model = memoryModelOf(app.ctx);
    model.setAddress(0x1230);
    model.setAddress(0x2340);
    expect(app.ctx.settings.get().sim.memoryAddress).toBe(0);
    scheduler.advance(PERSIST_DELAY_MS);
    expect(app.ctx.settings.get().sim.memoryAddress).toBe(0x2340);
  });

  it('after a cold start reads the new engine: Live off, fields empty, address from the settings', async () => {
    const { app, session, scheduler } = setup();
    const model = memoryModelOf(app.ctx);
    model.setRows(1);
    model.setFrom('000100');
    model.setTo('000200');
    model.setBytes('ABCDEF01');
    model.setLive(true);
    model.setAddress(0x7770);
    scheduler.advance(PERSIST_DELAY_MS);
    app.ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, memoryAddress: 0x4567 } }));
    expect(model.getState().view[0]?.hex[0]).toBe('FF ');
    await session.coldStart();
    const state = model.getState();
    expect(state.live).toBe(false);
    expect([state.from, state.to, state.bytes]).toEqual([BLANK_ADDRESS, BLANK_ADDRESS, BLANK_BYTES]);
    expect(state.address).toBe(0x4560);
    expect(scheduler.frameListeners).toBe(0);
    // The new engine's memory is zero-filled: the panel shows it.
    expect(state.view[0]?.hex[0]).toBe('00 ');
    // ...and edits go to the new engine.
    model.place({ row: 0, col: 10 });
    model.typeCode(0x39);
    expect(session.engine.memory[0x4560]).toBe(0x90);
    expect(session.engines[0]?.memory[0x4560]).toBe(0xff);
  });

  it('a memory edit redraws the Stack panel without re-centring it', () => {
    const { app, engine } = setup();
    engine.setRegisters({ ssp: 0x8000 });
    const stack = stackModelOf(app.ctx);
    stack.setRows(5);
    stack.updateDisplay();
    stack.scrollDown();
    const mid = stack.getState().midAddr;
    expect(stack.getState().view[2]?.address).toBe(0x8004);
    const memory = memoryModelOf(app.ctx);
    memory.setRows(1);
    memory.setAddress(0x8000);
    memory.place({ row: 0, col: 14 }); // byte $8001, high nibble... col 14 is the low nibble of byte 1
    memory.typeCode(0x30);
    expect(stack.getState().midAddr).toBe(mid);
    expect(stack.getState().view[1]?.bytes[1]?.text).toBe('F0 ');
  });
});

describe('sim.view.memory', { timeout: 60_000 }, () => {
  it('shows the Memory panel and takes an address from the Registers panel', async () => {
    const { app } = setup();
    await app.ctx.commands.run('app.mode.set', 'simulator');
    await app.ctx.commands.run('sim.view.memory', '00FF1234');
    expect(memoryModelOf(app.ctx).getState().address).toBe(0xff1230);
    expect(app.ctx.settings.get().app.layout.panels['memory']?.visible).toBe(true);
    expect(addressArgument(0x12345678)).toBe(0x12345678);
    expect(addressArgument('zz')).toBe(null);
    expect(addressArgument(undefined)).toBe(null);
  });

  it('shows the Stack panel', async () => {
    const { app } = setup();
    await app.ctx.commands.run('app.mode.set', 'simulator');
    await app.ctx.commands.run('sim.view.stack');
    expect(app.ctx.settings.get().app.layout.panels['stack']?.visible).toBe(true);
  });
});
