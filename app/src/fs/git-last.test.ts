// Files below a folder named .git are taken after all others (ARCHITECTURE-PLUS P3.3.10, P1.1 rule 1,
// R6; package N8), in Vfs.snapshot (the assembler's second pass) and in CachedSyncFiles.prepare
// (the simulator's view of a program's folder).
//
// The property that matters for fidelity: while a folder is within the limits, the set of files a
// program reaches is exactly today's. `legacySnapshot` below is the snapshot algorithm as it was
// before N8 (breadth first, names sorted, no special order), and the random trees are compared
// against it, with and without .git folders.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAPSHOT_LIMITS,
  FileMode,
  type Bytes,
  type Scheduler,
  type SnapshotLimits,
  type VPath,
} from '../contracts';
import { ProgramFiles } from '../core/sim-host/files/program-files';
import { MemoryBackend } from './memory-backend';
import { CachedSyncFiles } from './sync/cached';
import { belowGitFolder, createVfs, isGitName } from './vfs';

const text = (s: string): Bytes => Uint8Array.from(s, (c) => c.charCodeAt(0));
const str = (b: Bytes | null | undefined): string | null => (b ? String.fromCharCode(...b) : null);

/** Timers that run only when the test says so (the view's messages go out from a timer). */
function manualScheduler(): Scheduler & { runTimers(): void } {
  let timers: (() => void)[] = [];
  return {
    onFrame: () => () => {},
    setTimer(_delay, fn) {
      timers.push(fn);
      return () => {
        timers = timers.filter((t) => t !== fn);
      };
    },
    runTimers() {
      while (timers.length > 0) {
        const due = timers;
        timers = [];
        for (const fn of due) fn();
      }
    },
  };
}

/** A small seeded random generator (mulberry32), so that a failing tree can be found again. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILE_NAMES = ['a.X68', 'B.txt', 'c.bin', 'data', 'x.L68', 'HEAD', 'index', 'z9.S68', '.git'];
const DIR_NAMES = ['inc', 'sub', 'Lib', 'objects', 'refs', '.github', 'deep'];
const GIT_NAMES = ['.git', '.GIT', '.Git'];

/** A random tree below `demo/`: rel path -> content. With `git`, at least one .git folder. */
function randomTree(random: () => number, git: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const grow = (dir: string, depth: number, forceGit: boolean) => {
    const used = new Set<string>();
    const count = depth > 5 ? 0 : Math.floor(random() * 5) + (forceGit ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const asGit = (forceGit && i === 0) || (git && random() < 0.15);
      const isDir = asGit || random() < 0.35;
      const name = asGit ? pick(GIT_NAMES) : isDir ? pick(DIR_NAMES) : pick(FILE_NAMES);
      if (used.has(name.toLowerCase())) continue;
      used.add(name.toLowerCase());
      const path = `${dir}/${name}`;
      if (isDir) grow(path, depth + 1, false);
      else files[path] = 'x'.repeat(Math.floor(random() * 24));
    }
  };
  grow('demo', 0, git);
  return files;
}

async function vfsWith(files: Record<string, string>) {
  const backend = new MemoryBackend();
  const vfs = createVfs();
  vfs.mount(backend);
  await vfs.mkdirp('/memory/demo');
  for (const [rel, content] of Object.entries(files)) await vfs.writeFile(`/memory/${rel}`, text(content));
  return { vfs, backend };
}

/** Vfs.snapshot as it was before N8 (W1's code, unchanged but for the .git order). */
async function legacySnapshot(backend: MemoryBackend, rootRel: string, limits: SnapshotLimits) {
  const files: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let totalBytes = 0;
  const join = (a: string, b: string) => (a === '' ? b : b === '' ? a : `${a}/${b}`);
  const queue: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }];
  while (queue.length > 0) {
    const { rel, depth } = queue.shift() as { rel: string; depth: number };
    const entries = (await backend.list(join(rootRel, rel))).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(rel, entry.name);
      if (entry.kind === 'dir') {
        if (depth + 1 > limits.maxDepth) skipped.push({ path, reason: 'too-deep' });
        else queue.push({ rel: path, depth: depth + 1 });
        continue;
      }
      if (files.length >= limits.maxFiles) {
        skipped.push({ path, reason: 'too-many' });
        continue;
      }
      const stat = await backend.stat(join(rootRel, path));
      const size = stat?.size ?? 0;
      if (size > limits.maxFileBytes || totalBytes + size > limits.maxTotalBytes) {
        skipped.push({ path, reason: 'too-large' });
        continue;
      }
      totalBytes += size;
      files.push(path);
    }
  }
  return { files, skipped };
}

/** The files of `tree` that a prepared view holds in memory, relative to demo/. */
async function loadedByView(files: Record<string, string>, limits: SnapshotLimits) {
  const { vfs } = await vfsWith(files);
  const scheduler = manualScheduler();
  const messages: string[] = [];
  const view = new CachedSyncFiles({ vfs, scheduler, message: (m) => messages.push(m), limits });
  await view.prepare('/memory/demo');
  scheduler.runTimers();
  const loaded = Object.keys(files)
    .filter((rel) => view.stat(`/memory/${rel}`) !== null)
    .map((rel) => rel.slice('demo/'.length));
  view.dispose();
  return { loaded: new Set(loaded), messages };
}

const sorted = (values: Iterable<string>) => [...values].sort();

/** True when a message names a file below a .git folder, or a .git folder (not a file named .git). */
function namesGit(message: string, tree: Record<string, string>): boolean {
  const path = /^Not available to the program: \/memory\/(\S+) \(/.exec(message)?.[1];
  if (path === undefined) return false;
  return path in tree ? belowGitFolder(path) : belowGitFolder(`${path}/.`);
}
const RUNS = 150;

describe('the .git helpers', () => {
  it('belowGitFolder: a path below a folder named .git in any letter case, not the folder or a file named .git', () => {
    expect(belowGitFolder('.git/HEAD')).toBe(true);
    expect(belowGitFolder('a/.GiT/objects/x')).toBe(true);
    expect(belowGitFolder('.git')).toBe(false);
    expect(belowGitFolder('sub/.git')).toBe(false);
    expect(belowGitFolder('.github/workflows/ci.yml')).toBe(false);
    expect(belowGitFolder('prog.X68')).toBe(false);
    expect(isGitName('.GIT')).toBe(true);
    expect(isGitName('git')).toBe(false);
  });
});

describe("within the limits the set of files is exactly today's (property over random trees)", () => {
  it('Vfs.snapshot and CachedSyncFiles.prepare, with and without .git', async () => {
    const random = seeded(0x5eed68);
    for (let run = 0; run < RUNS; run++) {
      const git = run % 2 === 0;
      const tree = randomTree(random, git);
      // Within the limits: the count and the total fit; the per-file limits (size, depth) still
      // leave files out, which they do whatever the order.
      const limits: SnapshotLimits = {
        maxFiles: 10_000,
        maxFileBytes: 4 + Math.floor(random() * 24),
        maxTotalBytes: 1 << 30,
        maxDepth: 1 + Math.floor(random() * 4),
      };
      const { vfs, backend } = await vfsWith(tree);
      const before = await legacySnapshot(backend, 'demo', limits);
      const after = await vfs.snapshot('/memory/demo', limits);
      const label = `run ${run} (${git ? 'with' : 'without'} .git): ${JSON.stringify(limits)} ${JSON.stringify(tree)}`;
      expect(sorted(after.files.keys()), label).toEqual(sorted(before.files));
      expect(sorted(after.skipped.map((s) => `${s.path} ${s.reason}`)), label).toEqual(
        sorted(before.skipped.map((s) => `${s.path} ${s.reason}`)),
      );
      const { loaded } = await loadedByView(tree, limits);
      expect(sorted(loaded), label).toEqual(sorted(before.files));
    }
  }, 120_000);

  it('without .git nothing changes at all, also beyond the limits (order and reasons included)', async () => {
    const random = seeded(0xc0ffee);
    for (let run = 0; run < RUNS; run++) {
      const tree = randomTree(random, false);
      const limits: SnapshotLimits = {
        maxFiles: 1 + Math.floor(random() * 8),
        maxFileBytes: 4 + Math.floor(random() * 24),
        maxTotalBytes: 10 + Math.floor(random() * 80),
        maxDepth: 1 + Math.floor(random() * 4),
      };
      const { vfs, backend } = await vfsWith(tree);
      const before = await legacySnapshot(backend, 'demo', limits);
      const after = await vfs.snapshot('/memory/demo', limits);
      const label = `run ${run}: ${JSON.stringify(limits)} ${JSON.stringify(tree)}`;
      expect([...after.files.keys()], label).toEqual(before.files);
      expect(after.skipped, label).toEqual(before.skipped);
      const { loaded } = await loadedByView(tree, limits);
      expect(sorted(loaded), label).toEqual(sorted(before.files));
    }
  }, 120_000);

  it('beyond the file count, .git files are the ones left out first, and none of them is named', async () => {
    const random = seeded(0xdecade);
    for (let run = 0; run < RUNS; run++) {
      const tree = randomTree(random, true);
      const limits: SnapshotLimits = {
        ...DEFAULT_SNAPSHOT_LIMITS,
        maxFiles: 1 + Math.floor(random() * 8),
        maxDepth: 1 + Math.floor(random() * 4),
      };
      const { vfs, backend } = await vfsWith(tree);
      const before = await legacySnapshot(backend, 'demo', limits);
      const after = await vfs.snapshot('/memory/demo', limits);
      const label = `run ${run}: ${JSON.stringify(limits)} ${JSON.stringify(tree)}`;
      const plain = (paths: Iterable<string>) => [...paths].filter((p) => !belowGitFolder(p));
      // Every program file taken before is taken now, and a .git file only when all program files fit.
      const taken = [...after.files.keys()];
      expect(plain(taken), label).toEqual(expect.arrayContaining(plain(before.files)));
      const reachable = (await legacySnapshot(backend, 'demo', { ...limits, maxFiles: 1e9 })).files;
      if (taken.some(belowGitFolder)) expect(plain(taken).length, label).toBe(plain(reachable).length);
      expect(taken.length, label).toBe(Math.min(limits.maxFiles, reachable.length));
      const { loaded, messages } = await loadedByView(tree, limits);
      expect(sorted(loaded), label).toEqual(sorted(taken));
      expect(
        messages.filter((m) => namesGit(m, tree)),
        label,
      ).toEqual([]);
    }
  }, 120_000);
});

describe('a repository with a large .git folder', () => {
  /** 50 program files and 3,000 files below .git, as a real repository has. */
  function repository(): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++)
      files[`demo/${i < 25 ? '' : 'inc/'}prog${String(i).padStart(2, '0')}.X68`] = `* ${i}\r\n`;
    for (let i = 0; i < 3000; i++) {
      const hex = i.toString(16).padStart(4, '0');
      files[`demo/.git/objects/${hex.slice(0, 2)}/${hex.slice(2)}`] = 'blob';
    }
    files['demo/.git/HEAD'] = 'ref: refs/heads/main\n';
    return files;
  }

  it('loads all 50 program files, and no "Not available" message names a .git file', async () => {
    const tree = repository();
    const programs = Object.keys(tree).filter((rel) => !rel.includes('.git'));
    expect(programs).toHaveLength(50);

    const { loaded, messages } = await loadedByView(tree, DEFAULT_SNAPSHOT_LIMITS);
    for (const rel of programs) expect(loaded.has(rel.slice('demo/'.length)), rel).toBe(true);
    expect(loaded.size).toBe(DEFAULT_SNAPSHOT_LIMITS.maxFiles);
    expect(messages.filter((m) => m.includes('.git'))).toEqual([]);
    expect(messages).toEqual([]);

    const { vfs } = await vfsWith(tree);
    const snap = await vfs.snapshot('/memory/demo', DEFAULT_SNAPSHOT_LIMITS);
    for (const rel of programs) expect(snap.files.has(rel.slice('demo/'.length)), rel).toBe(true);
    expect(snap.files.size).toBe(DEFAULT_SNAPSHOT_LIMITS.maxFiles);
    // What the limits left out are files of .git only, as too many.
    expect(snap.skipped.every((s) => belowGitFolder(s.path) && s.reason === 'too-many')).toBe(true);
    expect(snap.skipped).toHaveLength(3051 - DEFAULT_SNAPSHOT_LIMITS.maxFiles);
  }, 120_000);

  it('a program file beyond the limits outside .git is still named', async () => {
    const { messages } = await loadedByView(
      { 'demo/a.X68': '1', 'demo/b.X68': '2', 'demo/.git/HEAD': 'h', 'demo/.git/config': 'c' },
      { ...DEFAULT_SNAPSHOT_LIMITS, maxFiles: 1 },
    );
    expect(messages).toEqual(['Not available to the program: /memory/demo/b.X68 (too many files)']);
  });

  it('a .git folder beyond the depth limit is not named; another folder is', async () => {
    const { messages } = await loadedByView(
      { 'demo/sub/.git/HEAD': 'h', 'demo/sub/deeper/x.txt': 'x', 'demo/top.X68': 't' },
      { ...DEFAULT_SNAPSHOT_LIMITS, maxDepth: 1 },
    );
    expect(messages).toEqual(['Not available to the program: /memory/demo/sub/deeper (too deep)']);
  });

  it("a file named .git (a work tree's pointer) is not below a .git folder and keeps its place", async () => {
    const { vfs } = await vfsWith({ 'demo/.git': 'gitdir: ../x', 'demo/b.X68': 'b' });
    const snap = await vfs.snapshot('/memory/demo', { ...DEFAULT_SNAPSHOT_LIMITS, maxFiles: 1 });
    expect([...snap.files.keys()]).toEqual(['.git']);
  });
});

describe('a program and the files of .git', () => {
  async function program(files: Record<string, string>) {
    const { vfs } = await vfsWith(files);
    const scheduler = manualScheduler();
    const messages: string[] = [];
    const view = new CachedSyncFiles({ vfs, scheduler, message: (m) => messages.push(m) });
    const host = new ProgramFiles({
      viewFor: () => view,
      message: (m) => messages.push(m),
      showFileDialog: async () => null,
      post: () => {},
      journal: { write: () => {}, read: () => null },
    });
    await host.setCurrentDir('/memory/demo' as VPath);
    return { vfs, view, host, messages, scheduler };
  }

  it('reads .git/x.txt of a small repository with fileOpen, as in the original', async () => {
    const { host } = await program({ 'demo/prog.X68': 'p', 'demo/.git/x.txt': 'from git', 'demo/.git/HEAD': 'h' });
    const handle = host.fileOpen(text('.git\\x.txt'), FileMode.Read);
    expect(handle).toBeGreaterThan(0);
    expect(str(host.fileRead(handle, 100))).toBe('from git');
    expect(host.fileClose(handle)).toBe(true);
  });

  it('writes .git/x.txt: there is no write guard for .git (P1.1 rule 2)', async () => {
    const { host, view, vfs } = await program({ 'demo/prog.X68': 'p', 'demo/.git/x.txt': 'old' });
    const update = host.fileOpen(text('.git/x.txt'), FileMode.Create);
    expect(update).toBeGreaterThan(0);
    expect(host.fileWrite(update, text('written by the program'))).toBe('written by the program'.length);
    expect(host.fileClose(update)).toBe(true);
    const created = host.fileOpen(text('.git/new.txt'), FileMode.Create);
    expect(created).toBeGreaterThan(0);
    expect(host.fileWrite(created, text('new'))).toBe(3);
    expect(host.fileClose(created)).toBe(true);
    await view.settled();
    expect(str(await vfs.readFile('/memory/demo/.git/x.txt'))).toBe('written by the program');
    expect(str(await vfs.readFile('/memory/demo/.git/new.txt'))).toBe('new');
    expect(host.fileRemove(text('.git/new.txt'))).toBe(true);
    await view.settled();
    expect(await vfs.stat('/memory/demo/.git/new.txt')).toBeNull();
  });

  it('Vfs writes below .git as before (Save, Import)', async () => {
    const { vfs } = await vfsWith({});
    await vfs.writeFile('/memory/demo/.git/x.txt', text('saved'));
    await vfs.appendFile('/memory/demo/.git/x.txt', text('+'));
    expect(str(await vfs.readFile('/memory/demo/.git/x.txt'))).toBe('saved+');
  });
});
