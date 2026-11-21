// Tests of reveal.ts: requests reach the mounted Files panel, and a remembered request waits for it.

import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../contracts';
import { registerFilesRevealer, requestReveal, revealPathOf } from './reveal';

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
