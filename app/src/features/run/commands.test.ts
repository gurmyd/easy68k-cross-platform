// When the run commands are available (commands.ts; 4.8, errata SH8.md entries 47 and 50): the
// handlers read what the controller keeps through the RunController contract, so any controller
// that publishes `keepsCommands` is honoured, not only the SimRunController class.

import { describe, expect, it } from 'vitest';
import type { AppContext, AppState, CommandId, RunController } from '../../contracts';
import { commands } from './commands';

const KEPT: readonly CommandId[] = [
  'sim.run.run',
  'sim.run.runToCursor',
  'sim.run.autoTrace',
  'sim.run.stepOver',
  'sim.run.traceInto',
  'sim.run.pause',
  'sim.run.rewind',
];

function stateOf(phase: string, menuState: number): AppState {
  return { sim: { phase, menuState } } as unknown as AppState;
}

/** A context whose controller is a plain object of the contract, not a SimRunController. */
function contextWith(controller: Partial<RunController> | undefined): AppContext {
  return { sim: controller ? { controller } : undefined } as unknown as AppContext;
}

function enabled(id: CommandId, state: AppState, ctx: AppContext): boolean {
  const handler = commands[id];
  if (!handler) throw new Error(`no handler for ${id}`);
  return handler.enabled ? handler.enabled(state, ctx) : true;
}

describe('run commands and the controller contract', () => {
  it('a contract controller that keeps commands during a load enables them', () => {
    const ctx = contextWith({ phase: 'loading', keepsCommands: true });
    for (const id of KEPT) expect(enabled(id, stateOf('loading', 1), ctx), id).toBe(true);
    for (const id of ['sim.file.open', 'sim.file.openData', 'sim.file.close'] as const) {
      expect(enabled(id, stateOf('loading', 1), ctx), id).toBe(false);
    }
  });

  it('a controller that keeps nothing, or does not publish keepsCommands, follows the phase', () => {
    for (const ctx of [
      contextWith({ phase: 'loading', keepsCommands: false }),
      contextWith({ phase: 'loading' }),
      contextWith(undefined),
    ]) {
      for (const id of KEPT) expect(enabled(id, stateOf('loading', 0), ctx), id).toBe(false);
    }
  });

  it('outside a load the busy state alone decides the five run commands', () => {
    const ctx = contextWith({ phase: 'idle', keepsCommands: false });
    expect(enabled('sim.run.run', stateOf('idle', 0), ctx)).toBe(true);
    expect(enabled('sim.run.run', stateOf('idle', 1), ctx)).toBe(false);
    expect(enabled('sim.run.pause', stateOf('idle', 1), ctx)).toBe(true);
  });
});
