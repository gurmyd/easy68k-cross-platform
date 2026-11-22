import { describe, expect, it } from 'vitest';
import {
  createFrameWatch,
  createRestoreGuard,
  readFrameAddress,
  RESTORE_LIMIT,
  RESTORE_WINDOW_MS,
} from './frame-watch';

const OWN = 'blob:http://127.0.0.1:5173/0b5c7c3e-8d7a-4b1e-9d55-5d1f0f6b9a11';
const UNREADABLE = { unreadable: true } as const;

describe("which addresses of the PDF frame count as not the viewer's own document (decision D-c)", () => {
  it('its own blob: address is ours, also with a fragment the PDF viewer adds', () => {
    const watch = createFrameWatch(OWN);
    expect(watch.observe(OWN)).toBe('ours');
    expect(watch.observe(`${OWN}#page=2`)).toBe('ours');
  });

  it("the application's own page, its ?open= address and any other readable address are not", () => {
    for (const address of [
      'http://127.0.0.1:5173/index.html',
      'http://127.0.0.1:5173/',
      'http://127.0.0.1:5173/?open=/browser/demo.X68',
      'http://127.0.0.1:5173/easy68k-cross-platform/help/main.htm',
      'blob:http://127.0.0.1:5173/11111111-2222-3333-4444-555555555555',
      `${OWN}x`,
    ]) {
      const watch = createFrameWatch(OWN);
      expect([address, watch.observe(address)]).toEqual([address, 'foreign']);
    }
  });

  it('about:blank and a frame without a window decide nothing (WebKit shows its own PDF so)', () => {
    const watch = createFrameWatch(OWN);
    expect(watch.observe('about:blank')).toBe('undecided');
    expect(watch.observe('')).toBe('undecided');
    expect(watch.observe(null)).toBe('undecided');
  });

  it('an address the page cannot read is foreign only after its own document was seen there', () => {
    const before = createFrameWatch(OWN);
    // A browser whose PDF viewer the page cannot read: no loop.
    expect(before.observe(UNREADABLE)).toBe('undecided');
    expect(before.observe(UNREADABLE)).toBe('undecided');
    const after = createFrameWatch(OWN);
    expect(after.observe(OWN)).toBe('ours');
    // Chromium's error page for another site or a data: document refused by frame-src.
    expect(after.observe(UNREADABLE)).toBe('foreign');
  });
});

describe('the restore guard', () => {
  it(`allows ${RESTORE_LIMIT} restores within ${RESTORE_WINDOW_MS} ms, then none until the oldest is that old`, () => {
    const guard = createRestoreGuard();
    for (let i = 0; i < RESTORE_LIMIT; i++) expect(guard.allow(1000 + i)).toBe(true);
    expect(guard.allow(2000)).toBe(false);
    expect(guard.allow(1000 + RESTORE_WINDOW_MS - 1)).toBe(false);
    expect(guard.allow(1000 + RESTORE_WINDOW_MS)).toBe(true);
  });
});

describe('readFrameAddress', () => {
  it('reads the address, null without a window, unreadable when reading throws', () => {
    expect(readFrameAddress({ contentWindow: { location: { href: OWN } } })).toBe(OWN);
    expect(readFrameAddress({ contentWindow: null })).toBeNull();
    const crossOrigin = {
      get contentWindow(): { location: { href: string } } {
        return {
          get location(): { href: string } {
            throw new Error('SecurityError');
          },
        };
      },
    };
    expect(readFrameAddress(crossOrigin)).toEqual(UNREADABLE);
  });
});
