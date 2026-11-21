import { describe, expect, it } from 'vitest';
import type { BackendChange } from '../contracts';
import { BACKEND_CONTRACT_CASES } from './backend-contract';
import { MemoryBackend } from './memory-backend';

describe('MemoryBackend passes the backend contract', () => {
  for (const c of BACKEND_CONTRACT_CASES) it(c.name, () => c.run(new MemoryBackend()));
});

describe('MemoryBackend', () => {
  it('has the mount, kind and label it is given', () => {
    const plain = new MemoryBackend();
    expect([plain.mount, plain.kind, plain.label]).toEqual(['memory', 'memory', 'Memory']);
    const other = new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' });
    expect([other.mount, other.kind, other.label]).toEqual(['browser', 'browser', 'My Programs']);
  });

  it('read-only files refuse writes, appends and removal', async () => {
    const b = new MemoryBackend();
    await b.writeFile('ro.txt', Uint8Array.of(1));
    b.setReadOnly('ro.txt');
    expect((await b.stat('ro.txt'))?.readOnly).toBe(true);
    await expect(b.writeFile('ro.txt', Uint8Array.of(2))).rejects.toMatchObject({ code: 'read-only' });
    await expect(b.appendFile('ro.txt', Uint8Array.of(2))).rejects.toMatchObject({ code: 'read-only' });
    await expect(b.remove('ro.txt')).rejects.toMatchObject({ code: 'read-only' });
    b.setReadOnly('ro.txt', false);
    await b.remove('ro.txt');
  });

  it('modification times come from the clock and always increase', async () => {
    const b = new MemoryBackend({ now: () => 1000 });
    await b.writeFile('a', Uint8Array.of(1));
    await b.writeFile('b', Uint8Array.of(1));
    const ta = (await b.stat('a'))?.mtime as number;
    const tb = (await b.stat('b'))?.mtime as number;
    expect(ta).toBeGreaterThanOrEqual(1000);
    expect(tb).toBeGreaterThan(ta);
  });

  it('reports external changes to its listeners', async () => {
    const b = new MemoryBackend();
    const seen: BackendChange[] = [];
    const stop = b.onExternalChange((c) => seen.push(c));
    await b.externalWrite('x/y.txt', Uint8Array.of(7));
    await b.externalRemove('x/y.txt');
    stop();
    b.emitExternal({ rel: 'z', kind: 'write' });
    expect(seen).toEqual([
      { rel: 'x/y.txt', kind: 'write' },
      { rel: 'x/y.txt', kind: 'remove' },
    ]);
  });

  it('rejects malformed paths', async () => {
    const b = new MemoryBackend();
    for (const rel of ['/a', 'a/', 'a//b', 'a/../b', './a', 'a\\b']) {
      await expect(b.writeFile(rel, Uint8Array.of(1)), rel).rejects.toMatchObject({ code: 'invalid-path' });
    }
    await expect(b.remove('')).rejects.toMatchObject({ code: 'invalid-path' });
  });

  it('appending does not copy the file (the cost depends on the new bytes)', async () => {
    const b = new MemoryBackend();
    await b.writeFile('big', new Uint8Array(20 << 20));
    const start = performance.now();
    for (let i = 0; i < 1000; i++) await b.appendFile('big', new Uint8Array(1024));
    const elapsed = performance.now() - start;
    expect((await b.stat('big'))?.size).toBe((20 << 20) + 1000 * 1024);
    expect(elapsed).toBeLessThan(1000); // a copy of 20 MB per append would take far longer
  });
});
