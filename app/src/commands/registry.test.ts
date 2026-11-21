// The command registry (ARCHITECTURE.md 3.12.2).

import { describe, expect, it, vi } from 'vitest';
import type { AppContext, AppState } from '../contracts';
import { COMMAND_IDS } from './ids';
import { createCommandRegistry } from './registry';

function setup(options: { modal?: () => boolean } = {}) {
  const state = { mode: 'editor' } as AppState;
  const ctx = { store: { getState: () => state } } as AppContext;
  const errors: [string, unknown][] = [];
  const registry = createCommandRegistry({
    context: () => ctx,
    isModalOpen: options.modal ?? (() => false),
    onError: (id, error) => errors.push([id, error]),
  });
  return { registry, ctx, state, errors };
}

describe('CommandRegistry', () => {
  it('has a specification for every id of section 1.3 and refuses unknown ids', async () => {
    const { registry } = setup();
    expect(registry.ids().sort()).toEqual([...COMMAND_IDS].sort());
    expect(registry.spec('ed.file.save').caption).toBe('&Save');
    expect(() => registry.spec('ed.file.nonsense')).toThrow(/Unknown command id/);
    expect(() => registry.spec('toString')).toThrow(/Unknown command id/);
    expect(() => registry.isEnabled('nope')).toThrow(/Unknown command id/);
    expect(() => registry.register('nope', { run: () => {} })).toThrow(/Unknown command id/);
    await expect(registry.run('nope')).rejects.toThrow(/Unknown command id/);
  });

  it('shows a command without a handler as disabled, and running it does nothing', async () => {
    const { registry, errors } = setup();
    for (const id of COMMAND_IDS) {
      expect(registry.isEnabled(id), id).toBe(false);
      expect(registry.isChecked(id), id).toBe(false);
      expect(registry.hasHandler(id), id).toBe(false);
    }
    await registry.run('ed.file.save');
    expect(errors).toEqual([]);
  });

  it('runs the handler with the context and the argument', async () => {
    const { registry, ctx } = setup();
    const run = vi.fn();
    registry.register('sim.options.size', { run });
    expect(registry.isEnabled('sim.options.size')).toBe(true);
    await registry.run('sim.options.size', 3);
    expect(run).toHaveBeenCalledExactlyOnceWith(ctx, 3);
  });

  it('accepts exactly one handler per id', () => {
    const { registry } = setup();
    registry.register('ed.file.new', { run: () => {} });
    expect(() => registry.register('ed.file.new', { run: () => {} })).toThrow(/already has a handler/);
  });

  it('asks the handler whether the command is enabled and checked', async () => {
    const { registry, state, ctx } = setup();
    const run = vi.fn();
    let enabled = false;
    registry.register('sim.options.exceptions', {
      run,
      enabled: (givenState, givenCtx) => {
        expect(givenState).toBe(state);
        expect(givenCtx).toBe(ctx);
        return enabled;
      },
      checked: (_state, _ctx, arg) => arg === 'on',
    });
    expect(registry.isEnabled('sim.options.exceptions')).toBe(false);
    await registry.run('sim.options.exceptions');
    expect(run).not.toHaveBeenCalled();
    enabled = true;
    expect(registry.isEnabled('sim.options.exceptions')).toBe(true);
    await registry.run('sim.options.exceptions');
    expect(run).toHaveBeenCalledTimes(1);
    expect(registry.isChecked('sim.options.exceptions', 'on')).toBe(true);
    expect(registry.isChecked('sim.options.exceptions', 'off')).toBe(false);
  });

  it('runs nothing while a modal dialog is open (2.9.1 step 1)', async () => {
    let modal = true;
    const { registry } = setup({ modal: () => modal });
    const run = vi.fn();
    registry.register('sim.run.run', { run });
    await registry.run('sim.run.run');
    expect(run).not.toHaveBeenCalled();
    // The command itself stays enabled: it is the open dialog that blocks it.
    expect(registry.isEnabled('sim.run.run')).toBe(true);
    modal = false;
    await registry.run('sim.run.run');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits for an asynchronous handler and reports a failure instead of rejecting', async () => {
    const { registry, errors } = setup();
    const order: string[] = [];
    registry.register('ed.file.save', {
      run: async () => {
        await Promise.resolve();
        order.push('saved');
      },
    });
    registry.register('ed.file.open', {
      run: async () => {
        throw new Error('disk on fire');
      },
    });
    registry.register('ed.file.new', {
      run: () => {
        throw new Error('synchronous');
      },
      enabled: () => {
        throw new Error('enabled() threw');
      },
    });
    await registry.run('ed.file.save');
    order.push('after');
    expect(order).toEqual(['saved', 'after']);
    await expect(registry.run('ed.file.open')).resolves.toBeUndefined();
    expect(errors.map(([id, error]) => [id, (error as Error).message])).toEqual([['ed.file.open', 'disk on fire']]);
    // A handler whose enabled() throws counts as disabled.
    expect(registry.isEnabled('ed.file.new')).toBe(false);
    expect(errors).toHaveLength(2);
  });

  it('tells subscribers when a handler is registered', () => {
    const { registry } = setup();
    const listener = vi.fn();
    const stop = registry.subscribe(listener);
    registry.register('ed.file.new', { run: () => {} });
    stop();
    registry.register('ed.file.open', { run: () => {} });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
