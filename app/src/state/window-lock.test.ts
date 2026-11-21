// Window identity (ARCHITECTURE.md 3.8.6 rule 1; W3 acceptance: "the window lock of 3.8.6 is held
// and released"). The same lock in real browsers is checked by ui/shell/check-shell.mjs.

import { describe, expect, it } from 'vitest';
import { FakeLocks, createTestApplication } from './testing';
import { createWindowId, holdWindowLock, liveWindowIds, windowLockName } from './window-lock';

/** Lets pending promise continuations run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the window lock', () => {
  it('is named easy68k.window.<id>', () => {
    expect(windowLockName('abc')).toBe('easy68k.window.abc');
  });

  it('is held from the request until release()', async () => {
    const locks = new FakeLocks();
    const lock = holdWindowLock('w1', locks);
    await expect(lock.held).resolves.toBe(true);
    expect([...locks.held]).toEqual(['easy68k.window.w1']);
    lock.release();
    await settle();
    expect([...locks.held]).toEqual([]);
  });

  it('can be released before it was granted', async () => {
    // A lock manager that grants on a later tick.
    const locks = new FakeLocks();
    const slow = {
      request: async (name: string, callback: (lock: unknown) => Promise<unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return locks.request(name, callback);
      },
    };
    const lock = holdWindowLock('w2', slow);
    lock.release();
    await expect(lock.held).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect([...locks.held]).toEqual([]);
  });

  it('reports false where the Web Locks API does not exist or refuses', async () => {
    await expect(holdWindowLock('w3', null).held).resolves.toBe(false);
    await expect(holdWindowLock('w3', undefined).held).resolves.toBe(false);
    const refusing = { request: () => Promise.reject(new Error('SecurityError')) };
    await expect(holdWindowLock('w3', refusing).held).resolves.toBe(false);
  });
});

describe('liveWindowIds', () => {
  it('lists the windows whose lock is held, and no other locks', async () => {
    const locks = new FakeLocks();
    const a = holdWindowLock('a', locks);
    const b = holdWindowLock('b', locks);
    void locks.request('some.other.lock', () => new Promise(() => {}));
    await Promise.all([a.held, b.held]);
    expect(await liveWindowIds(locks)).toEqual(new Set(['a', 'b']));
    a.release();
    await settle();
    // A lock that is no longer held means its window is gone.
    expect(await liveWindowIds(locks)).toEqual(new Set(['b']));
  });

  it('is null where the browser cannot tell', async () => {
    expect(await liveWindowIds(null)).toBeNull();
    expect(await liveWindowIds({ request: async () => undefined })).toBeNull();
  });
});

describe('createWindowId', () => {
  it('gives 24 hex digits, different every time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createWindowId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('the application', () => {
  it('holds the lock of its window while it lives and releases it when disposed', async () => {
    const app = createTestApplication();
    await expect(app.windowLock).resolves.toBe(true);
    expect([...app.locks.held]).toEqual([`easy68k.window.${app.ctx.platform.windowId}`]);
    app.dispose();
    await settle();
    expect([...app.locks.held]).toEqual([]);
  });
});
