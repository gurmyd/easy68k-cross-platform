// Tests of reveal.ts: requests reach the mounted Files panel, and a remembered request waits for it.

import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../contracts';
import { PENDING_REVEAL_MS, forgetPendingReveal, registerFilesRevealer, requestReveal, revealPathOf } from './reveal';

const fakeCtx = () => ({}) as AppContext;

describe('reveal', () => {
  it('a mounted panel takes requests at once; after unregistering it takes none', () => {
    const ctx = fakeCtx();
    const seen: string[] = [];
    const unregister = registerFilesRevealer(ctx, (path) => seen.push(path));
    expect(requestReveal(ctx, '/browser/demo')).toBe(true);
    unregister();
    expect(requestReveal(ctx, '/browser/other')).toBe(false);
    expect(seen).toEqual(['/browser/demo']);
  });

  it('a remembered request waits for the panel to mount; an unremembered one is dropped', () => {
    const ctx = fakeCtx();
    expect(requestReveal(ctx, '/browser/dropped')).toBe(false);
    expect(requestReveal(ctx, '/browser/first', true)).toBe(false);
    expect(requestReveal(ctx, '/browser/Examples', true)).toBe(false);
    const seen: string[] = [];
    registerFilesRevealer(ctx, (path) => seen.push(path));
    expect(seen).toEqual(['/browser/Examples']);
    // Handed over once only.
    registerFilesRevealer(ctx, (path) => seen.push(`again ${path}`));
    expect(seen).toEqual(['/browser/Examples']);
  });

  it('a remembered request is dropped when the panel does not mount within PENDING_REVEAL_MS', () => {
    // Gate I1 round 3 review: a remembered path stayed pending forever and was revealed whenever
    // the Files panel next mounted, possibly much later and unrelated.
    vi.useFakeTimers();
    try {
      const ctx = fakeCtx();
      expect(requestReveal(ctx, '/browser/Examples', true)).toBe(false);
      vi.advanceTimersByTime(PENDING_REVEAL_MS + 1);
      const seen: string[] = [];
      registerFilesRevealer(ctx, (path) => seen.push(path));
      expect(seen).toEqual([]);
      // Within the limit it is still handed over.
      const other = fakeCtx();
      requestReveal(other, '/browser/Examples', true);
      vi.advanceTimersByTime(PENDING_REVEAL_MS - 100);
      registerFilesRevealer(other, (path) => seen.push(path));
      expect(seen).toEqual(['/browser/Examples']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a request made outside Editor mode waits for the switch to Editor mode, then for the limit', () => {
    vi.useFakeTimers();
    try {
      let state = { mode: 'simulator' };
      const listeners = new Set<() => void>();
      const ctx = {
        store: {
          getState: () => state,
          subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
        },
      } as unknown as AppContext;
      const setMode = (mode: string) => {
        state = { mode };
        for (const listener of [...listeners]) listener();
      };
      requestReveal(ctx, '/browser/Examples', true);
      vi.advanceTimersByTime(PENDING_REVEAL_MS * 10); // a long time in Simulator mode
      setMode('easybin');
      const seen: string[] = [];
      setMode('editor');
      vi.advanceTimersByTime(PENDING_REVEAL_MS - 100);
      registerFilesRevealer(ctx, (path) => seen.push(path));
      expect(seen).toEqual(['/browser/Examples']);
      expect(listeners.size).toBe(0);

      // In Editor mode with a panel that never mounts: dropped after the limit.
      const other = { ...ctx } as AppContext;
      requestReveal(other, '/browser/x', true);
      vi.advanceTimersByTime(PENDING_REVEAL_MS + 1);
      const late: string[] = [];
      registerFilesRevealer(other, (path) => late.push(path));
      expect(late).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgetPendingReveal drops a waiting request (a toggle without a path)', () => {
    const ctx = fakeCtx();
    requestReveal(ctx, '/browser/Examples', true);
    forgetPendingReveal(ctx);
    const seen: string[] = [];
    registerFilesRevealer(ctx, (path) => seen.push(path));
    expect(seen).toEqual([]);
  });

  it('unregistering an older panel leaves the newer one registered', () => {
    const ctx = fakeCtx();
    const seen: string[] = [];
    const first = registerFilesRevealer(ctx, (path) => seen.push(`first ${path}`));
    registerFilesRevealer(ctx, (path) => seen.push(`second ${path}`));
    first();
    expect(requestReveal(ctx, '/browser/x')).toBe(true);
    expect(seen).toEqual(['second /browser/x']);
  });

  it('revealPathOf accepts only { reveal: "/..." }', () => {
    expect(revealPathOf({ reveal: '/browser/Examples' })).toBe('/browser/Examples');
    for (const arg of [undefined, null, 'files', { reveal: 3 }, { reveal: 'relative' }, {}]) {
      expect(revealPathOf(arg)).toBeNull();
    }
  });
});
