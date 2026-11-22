// The focus after printing (focus.ts), with a fake page. Owner: E6.

import { describe, expect, it } from 'vitest';
import { focusKeeper, keepingFocus, type FocusEnvironment, type FocusTarget } from './focus';

/** A page with named elements; `active` is the one with the focus, `removed` are out of the document. */
function fakePage(active: string | null) {
  const page = { active, removed: new Set<string>(), log: [] as string[] };
  const elements = new Map<string, FocusTarget & { name: string }>();
  const element = (name: string) => {
    let found = elements.get(name);
    if (!found) {
      found = {
        name,
        focus: () => {
          page.log.push(`focus ${name}`);
          page.active = name;
        },
      };
      elements.set(name, found);
    }
    return found;
  };
  const env: FocusEnvironment = {
    active: () => (page.active === null ? null : element(page.active)),
    usable: (target) => !page.removed.has((target as FocusTarget & { name: string }).name),
    focusWindow: () => page.log.push('focus window'),
  };
  return { page, env };
}

describe('the focus after printing', () => {
  it('goes back to the element that had it when the command started, after the top window', async () => {
    const { page, env } = fakePage('editor');
    const result = await keepingFocus(env, async () => {
      page.active = 'print frame'; // the platform focuses its frame and removes it again
      page.removed.add('print frame');
      page.active = null;
      return true;
    });
    expect(result).toBe(true);
    expect(page.log).toEqual(['focus window', 'focus editor']);
    expect(page.active).toBe('editor');
  });

  it('also when the job fails (a failure, a cancelled dialog): the error still reaches the caller', async () => {
    const { page, env } = fakePage('files tree');
    await expect(
      keepingFocus(env, async () => {
        page.active = null;
        throw new Error('no printer');
      }),
    ).rejects.toThrow('no printer');
    expect(page.active).toBe('files tree');
  });

  it('prefers the element remembered last (after a dialog of its own), when it is still there', async () => {
    const { page, env } = fakePage('menu item');
    await keepingFocus(env, async (keeper) => {
      page.removed.add('menu item'); // the menu closed and gave the focus to the editor
      page.active = 'editor';
      keeper.remember();
      page.active = null;
    });
    expect(page.active).toBe('editor');
  });

  it('skips a remembered element that is gone and falls back to an earlier one', () => {
    const { page, env } = fakePage('editor');
    const keeper = focusKeeper(env);
    keeper.remember();
    page.active = 'range dialog button';
    keeper.remember();
    page.removed.add('range dialog button');
    page.active = null;
    keeper.restore();
    expect(page.active).toBe('editor');
  });

  it('with nothing focused before, only gives the window the focus back', async () => {
    const { page, env } = fakePage(null);
    await keepingFocus(env, async () => undefined);
    expect(page.log).toEqual(['focus window']);
  });

  it('without a page (Node, a worker) does nothing', async () => {
    await expect(keepingFocus(null, async () => 7)).resolves.toBe(7);
  });
});
