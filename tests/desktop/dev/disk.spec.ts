// The /disk mount inside the running app, over the real IPC (6.7): DiskBackend passes the backend
// contract suite and DiskSyncFiles the SyncFiles suite against real folders; a path outside the
// granted roots is refused by the asynchronous and by the synchronous handlers; a folder chosen in
// the native dialog becomes a granted root; a change made in one window reaches another.
//
// The page comes from the Vite dev server, so the suites of app/src/fs/backend-contract.ts are
// imported into the page by path and run there.
//
// Owner: DV2.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { relOfRealPath, vpathOfRealPath } from '../../../desktop/src/security';
import {
  launchDesktop,
  mainHook,
  removeQuietly,
  startDevServer,
  warmUpDevPage,
  type Desktop,
  type DevServer,
} from './harness';

let server: DevServer;
let desktop: Desktop;
const scratch = mkdtempSync(join(tmpdir(), 'easy68k-disk-e2e-'));
const granted = join(scratch, 'granted');
const outside = join(scratch, 'outside');

test.beforeAll(async () => {
  test.setTimeout(300_000);
  mkdirSync(granted);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  server = await startDevServer();
  desktop = await launchDesktop({ devServer: server });
  await warmUpDevPage(desktop.page);
  await mainHook(desktop.app, 'grant', granted);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
  await server?.close();
  removeQuietly(scratch);
});

test('the platform is the desktop one and /disk is mounted', async () => {
  const facts = await desktop.page.evaluate(() => {
    const { ctx } = window.__easy68k;
    return {
      kind: ctx.platform.kind,
      mounts: ctx.vfs.backends().map((backend: { mount: string }) => backend.mount),
      diskKind: ctx.platform.disk?.kind,
      sync: ctx.platform.syncFiles !== null,
    };
  });
  expect(facts.kind).toBe('desktop');
  expect(facts.mounts).toContain('disk');
  expect(facts.diskKind).toBe('disk');
  expect(facts.sync).toBe(true);
});

test('DiskBackend passes the backend contract suite over IPC', async () => {
  const failures = await desktop.page.evaluate(
    async (base: string) => {
      const { BACKEND_CONTRACT_CASES } = await import(String('/src/fs/backend-contract.ts'));
      const { DiskBackend } = await import(String('/src/fs/disk-backend.ts'));
      const bridge = window.easy68kDesktop;
      const root = new DiskBackend({ bridge, base });
      const failed: string[] = [];
      let index = 0;
      for (const c of BACKEND_CONTRACT_CASES) {
        const folder = `backend-${++index}`;
        await root.mkdirp(folder);
        try {
          await c.run(new DiskBackend({ bridge, base: `${base}/${folder}` }));
        } catch (error) {
          failed.push(`${c.name}: ${(error as Error).message}`);
        }
      }
      return { failed, count: BACKEND_CONTRACT_CASES.length };
    },
    relOfRealPath(granted) as string,
  );
  expect(failures.count).toBeGreaterThan(10);
  expect(failures.failed).toEqual([]);
});

test('DiskSyncFiles (platform.syncFiles) passes the SyncFiles contract suite over IPC', async () => {
  const failures = await desktop.page.evaluate(
    async (base: string) => {
      const { SYNC_FILES_CONTRACT_CASES } = await import(String('/src/fs/backend-contract.ts'));
      const { ctx } = window.__easy68k;
      const view = ctx.platform.syncFiles;
      const failed: string[] = [];
      let index = 0;
      for (const c of SYNC_FILES_CONTRACT_CASES) {
        const dir = `${base}/sync-${++index}`;
        await ctx.platform.disk.mkdirp(dir.slice('/disk/'.length));
        try {
          await c.run(view, dir);
        } catch (error) {
          failed.push(`${c.name}: ${(error as Error).message}`);
        }
      }
      return { failed, count: SYNC_FILES_CONTRACT_CASES.length };
    },
    vpathOfRealPath(granted) as string,
  );
  expect(failures.count).toBeGreaterThan(5);
  expect(failures.failed).toEqual([]);
});

test('a path outside the granted roots is refused by the asynchronous and the synchronous handlers', async () => {
  const rel = relOfRealPath(join(outside, 'secret.txt')) as string;
  const result = await desktop.page.evaluate(async (path: string) => {
    const { ctx } = window.__easy68k;
    const disk = ctx.platform.disk;
    const sync = ctx.platform.syncFiles;
    const outcome = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return 'done';
      } catch (error) {
        return `${(error as { code?: string }).code}: ${(error as Error).message}`;
      }
    };
    const bytes = new TextEncoder().encode('overwritten');
    const folder = path.slice(0, path.lastIndexOf('/'));
    return {
      async: {
        stat: await outcome(() => disk.stat(path)),
        readFile: await outcome(() => disk.readFile(path)),
        writeFile: await outcome(() => disk.writeFile(path, bytes)),
        appendFile: await outcome(() => disk.appendFile(path, bytes)),
        remove: await outcome(() => disk.remove(path)),
        list: await outcome(() => disk.list(folder)),
        mkdirp: await outcome(() => disk.mkdirp(`${folder}/new`)),
        viaVfs: await outcome(() => ctx.vfs.readFile(`/disk/${path}`)),
        prepare: await outcome(() => sync.prepare(`/disk/${folder}`)),
      },
      sync: {
        resolve: sync.resolve(`/disk/${folder}`, 'secret.txt'),
        stat: sync.stat(`/disk/${path}`),
        read: sync.read(`/disk/${path}`, 0, 6),
        write: sync.write(`/disk/${path}`, 0, bytes),
        create: sync.create(`/disk/${folder}/created.txt`),
        remove: sync.remove(`/disk/${path}`),
      },
      raw: window.easy68kDesktop ? window.easy68kDesktop.fsSync('read', path, 0, 6) : 'no bridge',
    };
  }, rel);
  for (const [name, value] of Object.entries(result.async)) expect(value, name).toMatch(/^io: refused/);
  expect(result.sync).toEqual({ resolve: null, stat: null, read: null, write: false, create: false, remove: false });
  expect(result.raw).toBeNull();
  expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
  expect(existsSync(join(outside, 'created.txt'))).toBe(false);
  expect(existsSync(join(outside, 'new'))).toBe(false);
});

test('a folder chosen in the native dialog becomes a granted root', async () => {
  const chosen = join(scratch, 'chosen');
  mkdirSync(chosen);
  writeFileSync(join(chosen, 'prog.X68'), '\tEND\r\n');
  // The dialog answers as if the user had chosen the file (no dialog appears).
  await desktop.app.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    },
    join(chosen, 'prog.X68'),
  );
  const before = await desktop.page.evaluate(
    async (path: string) => (window.easy68kDesktop ? window.easy68kDesktop.fsSync('stat', path) : 'no bridge'),
    relOfRealPath(join(chosen, 'prog.X68')) as string,
  );
  expect(before).toBeNull();
  const chosenPaths = await desktop.page.evaluate(() =>
    window.__easy68k.ctx.platform.nativeFileDialogs.open({
      title: 'Open File',
      filters: [{ label: 'Source', patterns: ['*.X68'] }],
      multiple: false,
    }),
  );
  expect(chosenPaths).toEqual([vpathOfRealPath(join(chosen, 'prog.X68'))]);
  const after = await desktop.page.evaluate(
    async (vpath: string) => window.__easy68k.ctx.platform.syncFiles.stat(vpath),
    vpathOfRealPath(join(chosen, 'prog.X68')) as string,
  );
  expect(after).toEqual({ size: 6, readOnly: false });
  const roots = await mainHook<string[]>(desktop.app, 'roots');
  expect(roots.some((root) => root.toLowerCase().endsWith('chosen'))).toBe(true);
});

test('the folder of a file the user dropped becomes a granted root; a File the page made is refused', async () => {
  const droppedDir = join(scratch, 'dropped');
  mkdirSync(droppedDir);
  const file = join(droppedDir, 'drop.X68');
  writeFileSync(file, '\tEND\r\n');
  const vpath = vpathOfRealPath(file) as string;
  expect(await desktop.page.evaluate((path) => window.__easy68k.ctx.platform.syncFiles.stat(path), vpath)).toBeNull();
  // A File with a real path, as a drop's DataTransfer.files gives it: Playwright fills a file
  // input the way the user's choice would (no dialog appears).
  await desktop.page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'e68-test-drop';
    input.style.display = 'none';
    document.body.append(input);
  });
  await desktop.page.setInputFiles('#e68-test-drop', file);
  const result = await desktop.page.evaluate(async () => {
    const input = document.getElementById('e68-test-drop') as HTMLInputElement;
    const real = input.files?.[0];
    input.remove();
    const platform = window.__easy68k.ctx.platform;
    return {
      dropped: real ? await platform.grantDroppedFile(real) : 'no file',
      made: await platform.grantDroppedFile(new File(['x'], 'made.X68')),
    };
  });
  expect(result).toEqual({ dropped: { path: vpath, kind: 'file' }, made: null });
  expect(await desktop.page.evaluate((path) => window.__easy68k.ctx.platform.syncFiles.stat(path), vpath)).toEqual({
    size: 6,
    readOnly: false,
  });
  const roots = await mainHook<string[]>(desktop.app, 'roots');
  expect(roots.some((root) => root.toLowerCase().endsWith('dropped'))).toBe(true);
});

test('a change made in one window reaches the backend of another (3.8.6)', async () => {
  const before = (await desktop.app.windows()).length;
  await desktop.page.evaluate(() => window.__easy68k.ctx.commands.run('app.window.new'));
  await expect.poll(async () => (await desktop.app.windows()).length, { timeout: 60_000 }).toBe(before + 1);
  const pages = desktop.app.windows();
  const second = pages.find((page) => page !== desktop.page);
  if (!second) throw new Error('no second window');
  await warmUpDevPage(second);
  const base = relOfRealPath(granted) as string;
  await second.evaluate((prefix: string) => {
    const seen: unknown[] = [];
    (window as unknown as { __seen: unknown[] }).__seen = seen;
    window.__easy68k.ctx.platform.disk.onExternalChange((change: unknown) => seen.push(change));
    void prefix;
  }, base);
  await desktop.page.evaluate(
    (path: string) => window.__easy68k.ctx.platform.disk.writeFile(path, new TextEncoder().encode('x')),
    `${base}/shared.txt`,
  );
  await expect
    .poll(() => second.evaluate(() => (window as unknown as { __seen: unknown[] }).__seen), { timeout: 15_000 })
    .toEqual([{ rel: `${base}/shared.txt`, kind: 'write' }]);
  await second.close();
});
