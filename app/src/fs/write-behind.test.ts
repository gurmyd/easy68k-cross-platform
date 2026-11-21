import { describe, expect, it } from 'vitest';
import type { Bytes, VPath } from '../contracts';
import { WriteBehind } from './write-behind';

/** A writer whose writes finish when the test says so. */
function controlledWriter() {
  const writes: { path: VPath; data: string; finish: (error?: Error) => void }[] = [];
  const write = (path: VPath, data: Bytes) =>
    new Promise<void>((resolve, reject) => {
      writes.push({ path, data: String.fromCharCode(...data), finish: (e) => (e ? reject(e) : resolve()) });
    });
  return { writes, write };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WriteBehind', () => {
  it('starts a write at once and takes the data when it starts', async () => {
    const { writes, write } = controlledWriter();
    const behind = new WriteBehind(write);
    let content = 'v1';
    behind.schedule('/m/a', () => Uint8Array.from(content, (c) => c.charCodeAt(0)));
    content = 'v2';
    expect(writes.map((w) => w.data)).toEqual(['v1']);
    expect(behind.busy).toBe(true);
    expect(behind.isPending('/m/a')).toBe(true);
    writes[0]?.finish();
    await behind.settled();
    expect(behind.busy).toBe(false);
  });

  it('keeps one write in flight per path and writes the newest bytes next, once', async () => {
    const { writes, write } = controlledWriter();
    const behind = new WriteBehind(write);
    let content = 'a';
    const data = () => Uint8Array.from(content, (c) => c.charCodeAt(0));
    behind.schedule('/m/f', data);
    content = 'b';
    behind.schedule('/m/f', data);
    content = 'c';
    behind.schedule('/m/f', data);
    expect(writes).toHaveLength(1);
    content = 'd';
    writes[0]?.finish();
    await tick();
    expect(writes.map((w) => w.data)).toEqual(['a', 'd']); // the data is taken when the write starts
    writes[1]?.finish();
    await behind.settled();
    expect(writes).toHaveLength(2);
  });

  it('writes different paths independently', async () => {
    const { writes, write } = controlledWriter();
    const behind = new WriteBehind(write);
    behind.schedule('/m/a', () => Uint8Array.of(0x41));
    behind.schedule('/m/b', () => Uint8Array.of(0x42));
    expect(writes.map((w) => w.path)).toEqual(['/m/a', '/m/b']);
    writes[1]?.finish();
    await tick();
    expect(behind.isPending('/m/a')).toBe(true);
    expect(behind.isPending('/m/b')).toBe(false);
    writes[0]?.finish();
    await behind.settled();
  });

  it('reports a failed write and still settles', async () => {
    const { writes, write } = controlledWriter();
    const errors: [VPath, unknown][] = [];
    const behind = new WriteBehind(write, (path, error) => errors.push([path, error]));
    behind.schedule('/m/x', () => Uint8Array.of(1));
    const settled = behind.settled();
    writes[0]?.finish(new Error('disk full'));
    await settled;
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[0]).toBe('/m/x');
  });

  it('a getter or writer that throws is reported as a failure', async () => {
    const errors: unknown[] = [];
    const behind = new WriteBehind(
      () => {
        throw new Error('sync failure');
      },
      (_p, e) => errors.push(e),
    );
    behind.schedule('/m/y', () => Uint8Array.of(1));
    await behind.settled();
    expect(errors).toHaveLength(1);
  });

  it('settled() resolves at once when idle', async () => {
    await new WriteBehind(async () => {}).settled();
  });
});
