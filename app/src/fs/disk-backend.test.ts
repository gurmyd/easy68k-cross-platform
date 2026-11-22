// DiskBackend against the real handlers of the main process (desktop/src/fs-ipc.ts) and real
// temporary folders, under plain Node: the bridge is a direct function call instead of IPC. The
// same backend inside Electron is tested by tests/desktop/dev (6.7).

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDiskFsHandlers, type DiskChange } from '../../../desktop/src/fs-ipc';
import { GrantedRoots, relOfRealPath, vpathOfRealPath } from '../../../desktop/src/security';
import { BACKEND_CONTRACT_CASES } from './backend-contract';
import { DiskBackend, type DiskFsBridge } from './disk-backend';
import { createVfs, isFsError } from './vfs';

const scratch = mkdtempSync(join(tmpdir(), 'easy68k-disk-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** A new empty folder, granted. */
function emptyFolder(grants: GrantedRoots): string {
  const dir = join(scratch, `case-${++counter}`);
  mkdirSync(dir);
  grants.add(dir);
  return dir;
}

function bridgeFor(grants: GrantedRoots, changes: DiskChange[] = []): DiskFsBridge {
  const handlers = createDiskFsHandlers({ grants, onChange: (change) => changes.push(change) });
  return { fs: (op, ...args) => handlers[op](...args) };
}

function backendIn(dir: string, grants: GrantedRoots, changes?: DiskChange[]): DiskBackend {
  return new DiskBackend({ bridge: bridgeFor(grants, changes), base: relOfRealPath(dir) as string });
}

const text = (s: string) => new TextEncoder().encode(s);

describe('DiskBackend passes the backend contract on real folders', () => {
  for (const c of BACKEND_CONTRACT_CASES) {
    it(
      c.name,
      async () => {
        const grants = new GrantedRoots();
        await c.run(backendIn(emptyFolder(grants), grants));
      },
      120_000,
    );
  }
});

describe('DiskBackend', () => {
  it('is the disk mount', () => {
    const backend = new DiskBackend({ bridge: { fs: async () => null } });
    expect([backend.mount, backend.kind, backend.label]).toEqual(['disk', 'disk', 'This Mac']);
  });

  it('refuses every path outside the granted roots', async () => {
    const grants = new GrantedRoots();
    const granted = emptyFolder(grants);
    const outside = join(scratch, `outside-${++counter}`);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'x');
    const backend = new DiskBackend({ bridge: bridgeFor(grants) });
    const rel = relOfRealPath(join(outside, 'secret.txt')) as string;
    for (const call of [
      () => backend.stat(rel),
      () => backend.readFile(rel),
      () => backend.writeFile(rel, text('y')),
      () => backend.appendFile(rel, text('y')),
      () => backend.remove(rel),
      () => backend.list(relOfRealPath(outside) as string),
      () => backend.mkdirp(`${relOfRealPath(outside) as string}/new`),
    ]) {
      const error = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect(isFsError(error, 'io')).toBe(true);
      expect(String((error as Error).message)).toMatch(/^refused/);
    }
    // The granted folder itself works.
    await new DiskBackend({ bridge: bridgeFor(grants) }).writeFile(
      `${relOfRealPath(granted) as string}/ok.txt`,
      text('ok'),
    );
  });

  it('does not let ".." or a symbolic link leave a granted root', async () => {
    const grants = new GrantedRoots();
    const granted = emptyFolder(grants);
    const outside = join(scratch, `outside-${++counter}`);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'x');
    const backend = backendIn(granted, grants);
    await expect(backend.readFile('../secret.txt')).rejects.toMatchObject({ code: 'invalid-path' });
    let linked = true;
    try {
      symlinkSync(outside, join(granted, 'link'), 'junction');
    } catch {
      linked = false; // no permission to create links on this machine
    }
    if (linked) {
      await expect(backend.readFile('link/secret.txt')).rejects.toMatchObject({ code: 'io' });
      await expect(backend.writeFile('link/new.txt', text('x'))).rejects.toMatchObject({ code: 'io' });
    }
  });

  it('reports a read-only file', async () => {
    const grants = new GrantedRoots();
    const dir = emptyFolder(grants);
    writeFileSync(join(dir, 'ro.txt'), 'x');
    chmodSync(join(dir, 'ro.txt'), 0o444);
    const backend = backendIn(dir, grants);
    expect((await backend.stat('ro.txt'))?.readOnly).toBe(true);
    await expect(backend.writeFile('ro.txt', text('y'))).rejects.toMatchObject({ code: 'read-only' });
    chmodSync(join(dir, 'ro.txt'), 0o666);
  });

  it('turns a bridge failure into an FsError and a missing answer into io', async () => {
    const backend = new DiskBackend({
      bridge: { fs: async () => ({ ok: false, code: 'not-found', message: 'gone' }) },
    });
    await expect(backend.readFile('x')).rejects.toMatchObject({ code: 'not-found', message: 'gone' });
    const silent = new DiskBackend({ bridge: { fs: async () => undefined } });
    await expect(silent.readFile('x')).rejects.toMatchObject({ code: 'io' });
    const odd = new DiskBackend({ bridge: { fs: async () => ({ ok: false, code: 'weird', message: 'm' }) } });
    await expect(odd.readFile('x')).rejects.toMatchObject({ code: 'io' });
  });

  it('refuses malformed paths before asking the main process', async () => {
    let asked = 0;
    const backend = new DiskBackend({
      bridge: {
        fs: async () => {
          asked++;
          return { ok: true, value: null };
        },
      },
    });
    for (const rel of ['/abs', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'trailing/']) {
      await expect(backend.stat(rel)).rejects.toMatchObject({ code: 'invalid-path' });
    }
    expect(asked).toBe(0);
  });

  it('reports the changes it makes, and those of other windows through onExternalChange', async () => {
    const grants = new GrantedRoots();
    const dir = emptyFolder(grants);
    const changes: DiskChange[] = [];
    const backend = backendIn(dir, grants, changes);
    await backend.writeFile('a.txt', text('1'));
    await backend.appendFile('a.txt', text('2'));
    await backend.remove('a.txt');
    const base = relOfRealPath(dir) as string;
    expect(changes).toEqual([
      { rel: `${base}/a.txt`, kind: 'write' },
      { rel: `${base}/a.txt`, kind: 'write' },
      { rel: `${base}/a.txt`, kind: 'remove' },
    ]);

    let push: ((change: { rel: string; kind: 'write' | 'remove' }) => void) | null = null;
    const watched = new DiskBackend({
      base,
      bridge: {
        fs: async () => null,
        onFsChange: (listener) => {
          push = listener;
          return () => {
            push = null;
          };
        },
      },
    });
    const seen: unknown[] = [];
    const stop = watched.onExternalChange((change) => seen.push(change));
    push!({ rel: `${base}/sub/b.X68`, kind: 'write' });
    push!({ rel: 'elsewhere/c.X68', kind: 'remove' });
    expect(seen).toEqual([{ rel: 'sub/b.X68', kind: 'write' }]);
    stop();
    expect(push).toBeNull();
  });
});

// Defect D1 (docs/porting/errata/W1.md entry 15): the handlers refuse to list the folders above a
// granted root, and vfs.resolve must still find what lies inside it, in any letter case.
describe('vfs.resolve on /disk through the real handlers', () => {
  function diskVfs() {
    const grants = new GrantedRoots();
    const dir = emptyFolder(grants);
    mkdirSync(join(dir, 'Sub'));
    writeFileSync(join(dir, 'tutorial1.L68'), 'listing');
    writeFileSync(join(dir, 'Sub', 'Data.TXT'), 'data');
    const outside = join(scratch, `outside-${++counter}`);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'x');
    const vfs = createVfs();
    vfs.mount(new DiskBackend({ bridge: bridgeFor(grants) }));
    return { vfs, dir: vpathOfRealPath(dir) as string, outside };
  }

  it('the root of /disk may not be listed, the granted folder may', async () => {
    const { vfs, dir } = diskVfs();
    await expect(vfs.list('/disk')).rejects.toMatchObject({ code: 'io' });
    expect((await vfs.list(dir)).map((e) => e.name).sort()).toEqual(['Sub', 'tutorial1.L68']);
  });

  it('finds a file of the granted folder as given and in another letter case', async () => {
    const { vfs, dir } = diskVfs();
    expect(await vfs.resolve(dir, 'tutorial1.L68')).toBe(`${dir}/tutorial1.L68`);
    expect(await vfs.resolve(dir, 'TUTORIAL1.l68')).toBe(`${dir}/tutorial1.L68`);
    expect(await vfs.resolve(dir, 'sub\\DATA.txt')).toBe(`${dir}/Sub/Data.TXT`);
    expect(await vfs.resolve(dir, 'Sub')).toBe(`${dir}/Sub`);
    expect(await vfs.resolve(dir, 'missing.L68')).toBeNull();
    expect(await vfs.resolve(dir, 'missing\\x.txt')).toBeNull();
  });

  it('does not find what lies outside the granted roots', async () => {
    const { vfs, dir, outside } = diskVfs();
    const name = `..\\${outside.slice(outside.lastIndexOf(sep) + 1)}\\secret.txt`;
    expect(await vfs.resolve(dir, name)).toBeNull();
    expect(await vfs.resolve(dir, '..')).toBeNull();
  });
});
