import { describe, expect, it } from 'vitest';
import type { BreakCondition, BreakExpression, MessageBoxRequest, SimEngine } from '../../contracts';
import { MAX_ROWS } from '../../core/breakpoints';
import type { DialogServiceStore } from '../../state/dialogs';
import { createTestApplication } from '../../state/testing';
import { feature } from '.';
import { BreakpointsModel, breakpointsModelOf, confirmText, type BreakpointsDeps } from './model';

/** Fake application side: answers message boxes from a list, records the engine calls. */
function fakeDeps(answers: string[] = []) {
  const boxes: MessageBoxRequest[] = [];
  const calls: unknown[][] = [];
  const replaced = new Set<() => void>();
  const engine = {
    setBreakCondition: (index: number, condition: BreakCondition) => void calls.push(['condition', index, condition]),
    setBreakExpression: (index: number, expression: BreakExpression) => {
      calls.push(['expression', index, expression]);
      return true;
    },
    setBreakCounts: (counts: object) => void calls.push(['counts', counts]),
  } as unknown as SimEngine;
  const deps: BreakpointsDeps = {
    messageBox: (request) => {
      boxes.push(request);
      return Promise.resolve(answers.shift() ?? 'OK');
    },
    invoke: (fn) => fn(engine),
    onEngineReplaced: (listener) => {
      replaced.add(listener);
      return () => replaced.delete(listener);
    },
  };
  return { deps, boxes, calls, coldStart: () => replaced.forEach((listener) => listener()), replaced };
}

/** A model with three register conditions, one memory condition and three expressions. */
async function filled(answers: string[] = []) {
  const fake = fakeDeps(answers);
  const model = new BreakpointsModel(fake.deps);
  model.start();
  for (const register of [0, 1, 2]) {
    model.edit('registers', MAX_ROWS - 1);
    model.updateRegister({ register, value: `0000000${register + 1}` });
    await model.set('registers');
  }
  model.edit('memory', 0);
  model.updateMemory({ address: '00002000', readWrite: 2, op: 6 });
  await model.set('memory');
  const expression = async (parts: [string, string][]) => {
    model.edit('expressions', MAX_ROWS - 1);
    for (const [kind, n] of parts) {
      if (kind === 'R' || kind === 'A') {
        model.setBuilderField(kind === 'R' ? 'register' : 'memory', n);
        await model.appendCondition(kind === 'R' ? 'reg' : 'mem');
      } else model.appendSymbol(kind as 'AND');
    }
    await model.set('expressions');
  };
  await expression([
    ['R', '01'],
    ['AND', ''],
    ['R', '03'],
  ]);
  await expression([['R', '02']]);
  await expression([
    ['R', '03'],
    ['OR', ''],
    ['A', '01'],
  ]);
  fake.calls.length = 0;
  return { ...fake, model };
}

describe('the Break Points model', () => {
  it('sends the stored rows to the engine, slot by slot, and nothing for an entry in progress', async () => {
    const fake = fakeDeps();
    const model = new BreakpointsModel(fake.deps);
    model.edit('registers', 3);
    model.updateRegister({ register: 0, value: '0000002A', op: 3 });
    expect(fake.calls).toEqual([]);
    await model.set('registers');
    expect(fake.calls).toEqual([
      ['condition', 0, { enabled: true, id: 0, type: 0, typeId: 0, op: 3, value: 42, size: 2 }],
      ['counts', { registers: 1, addresses: 0, expressions: 0 }],
    ]);
    fake.calls.length = 0;
    model.edit('expressions', 0);
    model.setBuilderField('register', '01');
    await model.appendCondition('reg');
    model.updateExpression({ count: '10' });
    expect(fake.calls).toEqual([]);
    await model.set('expressions');
    expect(fake.calls).toEqual([
      ['expression', 0, { enabled: true, id: 1, count: 10, postfix: [0] }],
      ['counts', { registers: 1, addresses: 0, expressions: 1 }],
    ]);
    expect(fake.boxes).toEqual([]);
  });

  it('shows the original message boxes: title Error, no icon, OK', async () => {
    const fake = fakeDeps();
    const model = new BreakpointsModel(fake.deps);
    await model.clear('registers');
    model.edit('expressions', 0);
    await model.appendCondition('reg');
    await model.appendCondition('mem');
    model.edit('registers', 0);
    model.updateRegister({ value: '' });
    await model.set('registers');
    expect(fake.boxes).toEqual([
      { title: 'Error', text: 'Select a Valid Row.', icon: 'none', buttons: ['OK'] },
      {
        title: 'Error',
        text: 'Invalid PC/Reg Breakpoint. Set PC/Reg in Registers area first.',
        icon: 'none',
        buttons: ['OK'],
      },
      {
        title: 'Error',
        text: 'Invalid Memory Breakpoint. Set Memory in Memory area first.',
        icon: 'none',
        buttons: ['OK'],
      },
      { title: 'Error', text: 'Entry not stored.  Fields missing.', icon: 'none', buttons: ['OK'] },
    ]);
    expect(fake.calls).toEqual([]);
  });

  it('Clear of a condition that expressions use asks first; Cancel changes nothing', async () => {
    const { model, boxes, calls } = await filled(['Cancel']);
    const before = model.tables;
    model.select('registers', 1);
    await model.clear('registers');
    expect(boxes.at(-1)).toEqual({
      title: 'Break Points',
      text: 'Expression 2 uses this condition and is removed with it.',
      icon: 'confirmation',
      buttons: ['OK', 'Cancel'],
    });
    expect(model.tables.registers).toEqual(before.registers);
    expect(model.tables.expressions).toEqual(before.expressions);
    expect(calls).toEqual([]);
  });

  it('after OK the rows move up, the expressions are renumbered and the engine gets the new slots', async () => {
    const { model, calls } = await filled(['OK']);
    model.select('registers', 1);
    await model.clear('registers');
    expect(model.tables.registers.map((r) => r.register)).toEqual([0, 2]);
    expect(model.tables.expressions.map((e) => e.tokens)).toEqual([
      [0, 100, 1],
      [1, 101, 50],
    ]);
    expect(calls).toEqual([
      ['condition', 1, { enabled: true, id: 1, type: 0, typeId: 2, op: 0, value: 3, size: 2 }],
      ['condition', 2, { enabled: false, id: 2, type: 0, typeId: 0, op: 0, value: 0, size: 2 }],
      ['expression', 0, { enabled: true, id: 1, count: 1, postfix: [0, 1, 100] }],
      ['expression', 1, { enabled: true, id: 2, count: 1, postfix: [1, 50, 101] }],
      ['expression', 2, { enabled: false, id: 3, count: 1, postfix: [] }],
      ['counts', { registers: 2, addresses: 1, expressions: 2 }],
    ]);
  });

  it('Clear All of the memory conditions names every expression it removes', async () => {
    const { model, boxes } = await filled(['OK']);
    await model.clearAll('memory');
    expect(boxes.at(-1)?.text).toBe('Expression 3 uses these conditions and is removed with them.');
    expect(model.tables.memory).toEqual([]);
    expect(model.tables.expressions).toHaveLength(2);
  });

  it('Clear without dependent expressions does not ask', async () => {
    const { model, boxes } = await filled();
    model.select('expressions', 0);
    await model.clear('expressions');
    await model.clearAll('expressions');
    expect(boxes).toEqual([]);
    expect(model.tables.expressions).toEqual([]);
  });

  it('a cold start empties the grids; the new engine is sent nothing until the next change', async () => {
    const { model, calls, coldStart } = await filled();
    let notified = 0;
    model.subscribe(() => notified++);
    coldStart();
    expect(notified).toBe(1);
    expect([model.tables.registers, model.tables.memory, model.tables.expressions]).toEqual([[], [], []]);
    expect(model.getState().buttons.registers).toEqual({ set: false, clear: false, clearAll: false });
    expect(calls).toEqual([]);
    model.edit('registers', 0);
    await model.set('registers');
    expect(calls).toEqual([
      ['condition', 0, { enabled: true, id: 0, type: 0, typeId: 16, op: 0, value: 0, size: 2 }],
      ['counts', { registers: 1, addresses: 0, expressions: 0 }],
    ]);
  });

  it('start() returns the function that stops following cold starts', () => {
    const fake = fakeDeps();
    const stop = new BreakpointsModel(fake.deps).start();
    expect(fake.replaced.size).toBe(1);
    stop();
    expect(fake.replaced.size).toBe(0);
  });

  it('confirmation texts', () => {
    expect(confirmText([2], false)).toBe('Expression 2 uses this condition and is removed with it.');
    expect(confirmText([1, 3], false)).toBe('Expressions 1, 3 use this condition and are removed with it.');
    expect(confirmText([1, 3], true)).toBe('Expressions 1, 3 use these conditions and are removed with them.');
  });
});

describe('the feature in the application', () => {
  it('contributes the panel and View > Break Points, which shows it', async () => {
    const app = createTestApplication({ features: [feature] });
    expect(feature.panels?.map((p) => [p.id, p.title, p.mode])).toEqual([['breakpoints', 'Break Points', 'simulator']]);
    await app.ctx.commands.run('sim.view.breakpoints');
    expect(app.ctx.settings.get().app.layout.panels.breakpoints?.visible).toBe(true);
  });

  it('message boxes go through the dialog service; the model is one per window', async () => {
    const app = createTestApplication({ features: [feature] });
    const model = breakpointsModelOf(app.ctx);
    expect(breakpointsModelOf(app.ctx)).toBe(model);
    const done = model.clear('memory');
    const open = app.ctx.store.getState().dialogs.stack.filter((d) => d.id === 'message');
    expect(open.map((d) => d.props)).toEqual([
      { title: 'Error', text: 'Select a Valid Row.', icon: 'none', buttons: ['OK'] },
    ]);
    (app.ctx.dialogs as DialogServiceStore).close(open[0]?.key ?? -1, 'OK');
    await done;
  });
});
