// DiskSyncFiles against the real handlers of the main process (desktop/src/sync-ipc.ts and
// fs-ipc.ts) and real temporary folders, under plain Node: the bridge is a direct function call
// instead of IPC. The same view inside Electron is tested by tests/desktop/dev (6.7).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDiskFsHandlers } from '../../../../desktop/src/fs-ipc';
import { GrantedRoots, vpathOfRealPath } from '../../../../desktop/src/security';
import { createDiskSyncHandlers } from '../../../../desktop/src/sync-ipc';
import { SYNC_FILES_CONTRACT_CASES } from '../backend-contract';
import { DiskSyncFiles, type DiskSyncBridge } from './disk';

const scratch = mkdtempSync(join(tmpdir(), 'easy68k-disksync-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function emptyFolder(grants: GrantedRoots): string {
  const dir = join(scratch, `case-${++counter}`);
  mkdirSync(dir);
  grants.add(dir);
  return dir;
}

function viewFor(grants: GrantedRoots): DiskSyncFiles {
  const sync = createDiskSyncHandlers({ grants });
  const async = createDiskFsHandlers({ grants });
  const bridge: DiskSyncBridge = {
    fsSync: (op, ...args) => sync[op](...args),
    fs: (op, ...args) => async[op](...args),
  };
  return new DiskSyncFiles({ bridge });
}

const text = (s: string) => new TextEncoder().encode(s);

/** The 8.3 short form of an existing Windows path (cmd's %~s), or null if cmd cannot say. */
function shortPathOf(path: string): string | null {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${path}") do @echo %~sI"`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
    timeout: 30_000,
  });
  const out = result.status === 0 ? result.stdout.trim() : '';
  return out === '' ? null : out;
}

describe('DiskSyncFiles passes the SyncFiles contract on real folders', () => {
  for (const c of SYNC_FILES_CONTRACT_CASES) {
    it(
      c.name,
      async () => {
        const grants = new GrantedRoots();
        const dir = emptyFolder(grants);
        await c.run(viewFor(grants), vpathOfRealPath(dir) as string);
      },
      120_000,
    );
  }
});

describe('DiskSyncFiles', () => {
  it('sees a file the moment it is on disk, and writes reach the disk at once', async () => {
    const grants = new GrantedRoots();
    const dir = emptyFolder(grants);
    const vdir = vpathOfRealPath(dir) as string;
    const view = viewFor(grants);
    await view.prepare(vdir);
    const path = view.resolve(vdir, 'Data.Txt') as string;
    expect(view.stat(path)).toBeNull();
    writeFileSync(join(dir, 'DATA.TXT'), 'hello');
    // The stored spelling is found without regard to case.
    const stored = view.resolve(vdir, 'data.txt') as string;
    expect(stored.endsWith('/DATA.TXT')).toBe(true);
    expect(view.stat(stored)).toEqual({ size: 5, readOnly: false });
    expect(view.write(stored, 5, text(' world'))).toBe(true);
    expect(readFileSync(join(dir, 'DATA.TXT'), 'latin1')).toBe('hello world');
    expect(view.unsettled).toBe(false);
  });

  it('refuses names and paths outside the granted roots, synchronously and in prepare', async () => {
    const grants = new GrantedRoots();
    const dir = emptyFolder(grants);
    const outside = join(scratch, `outside-${++counter}`);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    const view = viewFor(grants);
    const vdir = vpathOfRealPath(dir) as string;
    const vout = vpathOfRealPath(join(outside, 'secret.txt')) as string;
    expect(view.resolve(vdir, `..\\outside-${counter}\\secret.txt`)).toBeNull();
    expect(view.stat(vout)).toBeNull();
    expect(view.read(vout, 0, 10)).toBeNull();
    expect(view.write(vout, 0, text('x'))).toBe(false);
    expect(view.create(vout)).toBe(false);
    expect(view.remove(vout)).toBe(false);
    expect(readFileSync(join(outside, 'secret.txt'), 'latin1')).toBe('secret');
    await expect(view.prepare(vpathOfRealPath(outside) as string)).rejects.toMatchObject({ code: 'io' });
  });

  it('cannot create a file in a folder that does not exist (fopen)', async () => {
    const grants = new GrantedRoots();
    const dir = emptyFolder(grants);
    const view = viewFor(grants);
    const vdir = vpathOfRealPath(dir) as string;
    expect(view.create(view.resolve(vdir, 'nofolder\\a.txt') as string)).toBe(false);
    mkdirSync(join(dir, 'Sub'));
    const inSub = view.resolve(vdir, 'SUB\\a.txt') as string;
    expect(inSub.endsWith('/Sub/a.txt')).toBe(true);
    expect(view.create(inSub)).toBe(true);
    expect(view.create(view.resolve(vdir, 'Sub') as string)).toBe(false); // a folder is not a file
  });

  // Gate 1: on GitHub's Windows runner the temporary folder is C:\Users\RUNNER~1\..., an 8.3
  // short name that no folder listing contains. resolve() gave up at that segment and returned
  // the rest in the program's spelling. A student's folder can have a short name as well.
  it.skipIf(process.platform !== 'win32')(
    'keeps the stored spelling below a folder named by its 8.3 short name (Windows)',
    async (context) => {
      const grants = new GrantedRoots();
      const dir = emptyFolder(grants);
      const longDir = join(dir, 'A Long Folder Name');
      mkdirSync(longDir);
      const short = shortPathOf(longDir);
      if (short === null || short.toLowerCase() === longDir.toLowerCase()) {
        context.skip('this volume makes no 8.3 short names (fsutil 8dot3name)');
        return;
      }
      writeFileSync(join(longDir, 'Data.Txt'), 'hello');
      mkdirSync(join(longDir, 'Sub'));
      const view = viewFor(grants);
      const vshort = vpathOfRealPath(short) as string;
      expect(vshort).toMatch(/~\d/);
      const stored = view.resolve(vshort, 'DATA.TXT') as string;
      expect(stored).toBe(`${vshort}/Data.Txt`);
      expect(view.stat(stored)).toEqual({ size: 5, readOnly: false });
      expect(view.resolve(vshort, 'sub\\NEW.TXT')).toBe(`${vshort}/Sub/NEW.TXT`);
    },
    60_000,
  );

  // The same branch on macOS and Linux: a folder that may be entered but not listed (mode 0o311).
  it.skipIf(process.platform === 'win32')(
    'keeps the stored spelling below a folder it may enter but not list (macOS, Linux)',
    async (context) => {
      const grants = new GrantedRoots();
      const dir = emptyFolder(grants);
      const hidden = join(dir, 'Hidden');
      mkdirSync(join(hidden, 'Inner'), { recursive: true });
      writeFileSync(join(hidden, 'Inner', 'Data.Txt'), 'hello');
      chmodSync(hidden, 0o311);
      try {
        let listable = true;
        try {
          readdirSync(hidden);
        } catch {
          listable = false;
        }
        if (listable) {
          context.skip('this user can list any folder (root)');
          return;
        }
        const view = viewFor(grants);
        const vdir = vpathOfRealPath(dir) as string;
        // "Hidden" itself is listed in its parent; "Inner" is not listable, so it keeps the
        // spelling given, and the walk still finds the stored spelling of the file below it.
        expect(view.resolve(vdir, 'Hidden/Inner/inner2/x')).toBe(`${vdir}/Hidden/Inner/inner2/x`);
        expect(view.resolve(vdir, 'hidden/Inner/DATA.TXT')).toBe(`${vdir}/Hidden/Inner/Data.Txt`);
      } finally {
        chmodSync(hidden, 0o755);
      }
    },
    60_000,
  );

  it('reports read-only files and cannot write them', async () => {
    const grants = new GrantedRoots();
    const dir = emptyFolder(grants);
    writeFileSync(join(dir, 'ro.txt'), 'ro');
    chmodSync(join(dir, 'ro.txt'), 0o444);
    const view = viewFor(grants);
    const path = view.resolve(vpathOfRealPath(dir) as string, 'ro.txt') as string;
    expect(view.stat(path)).toEqual({ size: 2, readOnly: true });
    expect(view.write(path, 0, text('x'))).toBe(false);
    expect(view.create(path)).toBe(false);
    chmodSync(join(dir, 'ro.txt'), 0o666);
  });

  it('answers paths of other mounts and bad arguments without asking the main process', () => {
    let asked = 0;
    const view = new DiskSyncFiles({
      bridge: {
        fsSync: () => {
          asked++;
          return true;
        },
        fs: async () => ({ ok: true, value: undefined }),
      },
    });
    expect(view.resolve('/browser/demo', 'a.txt')).toBeNull();
    expect(view.stat('/memory/a')).toBeNull();
    expect(view.read('/disk/a', -1, 1)).toBeNull();
    expect(view.read('/disk/a', 0, 1.5)).toBeNull();
    expect(view.write('/disk/a', -1, text('x'))).toBe(false);
    expect(view.create('/disk')).toBe(false);
    expect(view.remove('not a path')).toBe(false);
    expect(view.resolve('/disk/x', 'C:\\a.txt')).toBeNull();
    expect(asked).toBe(0);
  });

  it('treats malformed replies as failures', () => {
    const view = new DiskSyncFiles({
      bridge: { fsSync: () => ({ size: 'big' }), fs: async () => ({ ok: true, value: undefined }) },
    });
    expect(view.stat('/disk/a')).toBeNull();
    expect(view.read('/disk/a', 0, 1)).toBeNull();
    expect(view.write('/disk/a', 0, text('x'))).toBe(false);
    expect(view.resolve('/disk', 'a')).toBeNull();
  });
});
