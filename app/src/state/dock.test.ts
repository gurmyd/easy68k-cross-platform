// N0's stub of the dock controller (ARCHITECTURE-PLUS P4.4): every member does nothing.

import { describe, expect, it } from 'vitest';
import type { AppContext } from '../contracts';
import { dockOf } from './dock';

describe('dockOf (stub of N0)', () => {
  it('gives one controller per window whose members do nothing', () => {
    const a = {} as AppContext;
    const b = {} as AppContext;
    const dock = dockOf(a);
    expect(dockOf(a)).toBe(dock);
    expect(dockOf(b)).not.toBe(dock);
    expect(dock.acceptsTransient()).toBe(false);
    let closed = false;
    expect(
      dock.openTransient({
        id: 'viewer:1',
        title: 'a.pdf',
        tooltip: 'a.pdf',
        render: () => null,
        onClose: () => (closed = true),
      }),
    ).toBe(false);
    expect(closed).toBe(false);
    expect(dock.selectTransient('viewer:1')).toBe(false);
    expect(dock.present('files')).toBe(false);
    expect(dock.locked()).toBe(true);
    dock.setLocked(false);
    expect(dock.locked()).toBe(true);
    expect(dock.describe()).toEqual([]);
    dock.reveal('files', { select: true });
    dock.park('files');
    dock.move('files', { kind: 'edge', side: 'left' });
    dock.closeTransient('viewer:1');
    dock.reset();
    const unsubscribe = dock.subscribe(() => {});
    unsubscribe();
  });
});
