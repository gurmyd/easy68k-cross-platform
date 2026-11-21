// The behaviour every file-system backend and every SyncFiles view must show (ARCHITECTURE.md 3.8.1,
// 3.8.4), as reusable test cases. They do not depend on a test framework, so the same cases run
// under Vitest in Node and in a browser page driven by Playwright:
//
//     import { BACKEND_CONTRACT_CASES } from '../fs/backend-contract';
//     describe('my backend', () => {
//       for (const c of BACKEND_CONTRACT_CASES) it(c.name, async () => c.run(await makeEmptyBackend()));
//     });
//
// Each case gets a fresh, EMPTY backend (or, for SyncFiles, a view and an empty folder it may write
// in) and throws a ContractFailure when the behaviour differs.
//
// Error codes: where a case expects a failure it expects a rejection with the FsErrorCode of
// contracts/fs.ts in `code` (fs/vfs.ts: fsError()).
//
// What is not checked here because a backend cannot be driven into it generically: read-only files,
// external changes, the cost of appendFile. Each backend's own tests cover those.
//
// Owner: W1. The cases are contract: a package that needs a case changed asks W1.

import type { Bytes, FileSystemBackend, FsErrorCode, SyncFiles, VPath } from '../contracts';

export class ContractFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractFailure';
  }
}

export interface BackendContractCase {
  name: string;
  run(backend: FileSystemBackend): Promise<void>;
}

export interface SyncFilesContractCase {
  name: string;
  /** dir: an existing, empty folder inside what the view may reach. */
  run(view: SyncFiles, dir: VPath): Promise<void>;
}

// ---- small assertion helpers (no test framework) ------------------------------------------------

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ContractFailure(message);
}

function show(value: unknown): string {
  if (value instanceof Uint8Array) return `bytes[${value.length}] ${[...value.slice(0, 16)].join(',')}`;
  return JSON.stringify(value);
}

function equal(actual: unknown, expected: unknown, what: string): void {
  check(Object.is(actual, expected), `${what}: expected ${show(expected)}, got ${show(actual)}`);
}

function sameBytes(actual: Bytes | null, expected: Bytes, what: string): void {
  check(actual instanceof Uint8Array, `${what}: expected bytes, got ${show(actual)}`);
  check(
    actual.length === expected.length && actual.every((b, i) => b === expected[i]),
    `${what}: expected ${show(expected)}, got ${show(actual)}`,
  );
}

async function rejects(promise: Promise<unknown>, code: FsErrorCode, what: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: unknown } | null)?.code;
    check(actual === code, `${what}: expected a rejection with code '${code}', got ${show(actual)} (${String(error)})`);
    return;
  }
  throw new ContractFailure(`${what}: expected a rejection with code '${code}', but it resolved`);
}

function bytes(...values: number[]): Bytes {
  return Uint8Array.from(values);
}

function ascii(text: string): Bytes {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function names(entries: { name: string; kind: string }[]): string[] {
  return entries.map((e) => `${e.name}:${e.kind}`).sort();
}

// ---- backends -------------------------------------------------------------------------------------

export const BACKEND_CONTRACT_CASES: readonly BackendContractCase[] = [
  {
    name: 'an empty backend has an empty root folder',
    async run(b) {
      const root = await b.stat('');
      check(root !== null, "stat('') of an empty backend must describe the root folder");
      equal(root.kind, 'dir', "stat('').kind");
      equal((await b.list('')).length, 0, "list('').length of an empty backend");
    },
  },
  {
    name: 'stat of a missing path is null',
    async run(b) {
      equal(await b.stat('missing.txt'), null, "stat('missing.txt')");
      equal(await b.stat('no/such/dir/file.txt'), null, "stat('no/such/dir/file.txt')");
    },
  },
  {
    name: 'writeFile then readFile returns the same bytes, all 256 byte values',
    async run(b) {
      const all = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff);
      await b.writeFile('all.bin', all);
      sameBytes(await b.readFile('all.bin'), all, "readFile('all.bin')");
      const stat = await b.stat('all.bin');
      check(stat !== null, "stat('all.bin') after writeFile");
      equal(stat.kind, 'file', 'kind');
      equal(stat.size, 512, 'size');
      equal(stat.readOnly, false, 'readOnly');
      check(typeof stat.mtime === 'number' && Number.isFinite(stat.mtime), 'mtime must be a finite number');
    },
  },
  {
    name: 'an empty file exists with size 0',
    async run(b) {
      await b.writeFile('empty.txt', new Uint8Array(0));
      equal((await b.stat('empty.txt'))?.size, 0, "stat('empty.txt').size");
      equal((await b.readFile('empty.txt')).length, 0, "readFile('empty.txt').length");
    },
  },
  {
    name: 'writeFile creates the parent folders',
    async run(b) {
      await b.writeFile('a/b/c/prog.X68', ascii('x'));
      equal((await b.stat('a'))?.kind, 'dir', "stat('a').kind");
      equal((await b.stat('a/b/c'))?.kind, 'dir', "stat('a/b/c').kind");
      check(names(await b.list('a/b/c')).join() === 'prog.X68:file', "list('a/b/c') must hold prog.X68");
      check(names(await b.list('')).join() === 'a:dir', "list('') must hold the folder a");
    },
  },
  {
    name: 'writeFile replaces the whole file',
    async run(b) {
      await b.writeFile('f.txt', ascii('a longer first content'));
      await b.writeFile('f.txt', ascii('short'));
      sameBytes(await b.readFile('f.txt'), ascii('short'), 'content after the second writeFile');
      equal((await b.stat('f.txt'))?.size, 5, 'size after the second writeFile');
    },
  },
  {
    name: 'the backend keeps its own copy of the bytes',
    async run(b) {
      const data = ascii('ABC');
      await b.writeFile('copy.txt', data);
      data[0] = 0x5a;
      const first = await b.readFile('copy.txt');
      sameBytes(first, ascii('ABC'), 'changing the written array afterwards must not change the file');
      first[1] = 0x5a;
      sameBytes(await b.readFile('copy.txt'), ascii('ABC'), 'changing a read array must not change the file');
    },
  },
  {
    name: 'appendFile creates a missing file and appends in call order',
    async run(b) {
      await b.appendFile('log/exec.txt', ascii('one\r\n'));
      await b.appendFile('log/exec.txt', ascii('two\r\n'));
      await b.appendFile('log/exec.txt', new Uint8Array(0));
      await b.appendFile('log/exec.txt', ascii('three\r\n'));
      sameBytes(await b.readFile('log/exec.txt'), ascii('one\r\ntwo\r\nthree\r\n'), 'appended content');
      equal((await b.stat('log/exec.txt'))?.size, 17, 'size after appends');
      await b.writeFile('log/exec.txt', ascii('new'));
      await b.appendFile('log/exec.txt', ascii('+'));
      sameBytes(await b.readFile('log/exec.txt'), ascii('new+'), 'append after a rewrite');
    },
  },
  {
    name: 'many small appends keep every byte',
    async run(b) {
      const expected: number[] = [];
      for (let i = 0; i < 300; i++) {
        await b.appendFile('many.bin', bytes(i & 0xff, (i >> 8) & 0xff));
        expected.push(i & 0xff, (i >> 8) & 0xff);
      }
      sameBytes(await b.readFile('many.bin'), Uint8Array.from(expected), 'content after 300 appends');
    },
  },
  {
    name: 'remove deletes a file',
    async run(b) {
      await b.writeFile('dir/gone.txt', ascii('x'));
      await b.writeFile('dir/stays.txt', ascii('y'));
      await b.remove('dir/gone.txt');
      equal(await b.stat('dir/gone.txt'), null, 'stat after remove');
      check(names(await b.list('dir')).join() === 'stays.txt:file', "list('dir') after remove");
    },
  },
  {
    name: 'remove deletes a folder with everything in it',
    async run(b) {
      await b.writeFile('tree/a.txt', ascii('a'));
      await b.writeFile('tree/sub/b.txt', ascii('b'));
      await b.writeFile('other.txt', ascii('o'));
      await b.remove('tree');
      equal(await b.stat('tree'), null, "stat('tree') after remove");
      equal(await b.stat('tree/sub/b.txt'), null, "stat('tree/sub/b.txt') after remove");
      check(names(await b.list('')).join() === 'other.txt:file', "list('') after removing the folder");
    },
  },
  {
    name: 'missing paths are rejected with not-found',
    async run(b) {
      await rejects(b.readFile('missing.txt'), 'not-found', "readFile('missing.txt')");
      await rejects(b.remove('missing.txt'), 'not-found', "remove('missing.txt')");
      await rejects(b.list('missing'), 'not-found', "list('missing')");
    },
  },
  {
    name: 'files and folders are not confused',
    async run(b) {
      await b.writeFile('d/f.txt', ascii('x'));
      await rejects(b.readFile('d'), 'is-directory', 'readFile of a folder');
      await rejects(b.writeFile('d', ascii('x')), 'is-directory', 'writeFile over a folder');
      await rejects(b.list('d/f.txt'), 'not-directory', 'list of a file');
      await rejects(b.writeFile('d/f.txt/inner.txt', ascii('x')), 'not-directory', 'writeFile below a file');
      await rejects(b.mkdirp('d/f.txt/sub'), 'not-directory', 'mkdirp below a file');
    },
  },
  {
    name: 'mkdirp creates nested folders and may be repeated',
    async run(b) {
      await b.mkdirp('x/y/z');
      await b.mkdirp('x/y/z');
      await b.mkdirp('x');
      equal((await b.stat('x/y/z'))?.kind, 'dir', "stat('x/y/z').kind");
      equal((await b.list('x/y/z')).length, 0, "list('x/y/z').length");
      check(names(await b.list('x')).join() === 'y:dir', "list('x')");
    },
  },
  {
    name: 'names keep their letter case, spaces and non-ASCII characters',
    async run(b) {
      await b.writeFile('Übung 1/Prüfung Teil-2.X68', ascii('x'));
      await b.writeFile('Übung 1/MixedCase.L68', ascii('y'));
      check(
        names(await b.list('Übung 1')).join() === 'MixedCase.L68:file,Prüfung Teil-2.X68:file',
        `list('Übung 1') must give the names as written, got ${names(await b.list('Übung 1')).join()}`,
      );
      sameBytes(await b.readFile('Übung 1/Prüfung Teil-2.X68'), ascii('x'), 'read by the exact name');
    },
  },
  {
    name: 'mtime does not go backwards when a file is rewritten',
    async run(b) {
      await b.writeFile('t.txt', ascii('1'));
      const first = (await b.stat('t.txt'))?.mtime ?? NaN;
      await b.writeFile('t.txt', ascii('2'));
      const second = (await b.stat('t.txt'))?.mtime ?? NaN;
      check(second >= first, `mtime went backwards: ${first} then ${second}`);
    },
  },
  {
    name: 'concurrent writes to different files all arrive',
    async run(b) {
      await Promise.all(Array.from({ length: 20 }, (_, i) => b.writeFile(`p/f${i}.bin`, bytes(i))));
      equal((await b.list('p')).length, 20, "list('p').length");
      for (let i = 0; i < 20; i++) sameBytes(await b.readFile(`p/f${i}.bin`), bytes(i), `p/f${i}.bin`);
    },
  },
];

// ---- SyncFiles views --------------------------------------------------------------------------------

export const SYNC_FILES_CONTRACT_CASES: readonly SyncFilesContractCase[] = [
  {
    name: 'a missing file has no stat and cannot be read or written',
    async run(view, dir) {
      await view.prepare(dir);
      const path = view.resolve(dir, 'missing.txt');
      check(path !== null, 'resolve must accept a plain name that does not exist yet');
      equal(view.stat(path), null, 'stat of a missing file');
      equal(view.read(path, 0, 10), null, 'read of a missing file');
      equal(view.write(path, 0, ascii('x')), false, 'write to a missing file');
      equal(view.remove(path), false, 'remove of a missing file');
    },
  },
  {
    name: 'create, write, read back; short reads at the end of the file',
    async run(view, dir) {
      await view.prepare(dir);
      const path = view.resolve(dir, 'data.bin') as VPath;
      equal(view.create(path), true, 'create');
      equal(view.stat(path)?.size, 0, 'size after create');
      const all = Uint8Array.from({ length: 256 }, (_, i) => i);
      equal(view.write(path, 0, all), true, 'write');
      equal(view.stat(path)?.size, 256, 'size after write');
      sameBytes(view.read(path, 0, 256), all, 'read everything');
      sameBytes(view.read(path, 250, 100), all.slice(250), 'short read at the end');
      sameBytes(view.read(path, 256, 10), new Uint8Array(0), 'read at the end gives an empty array');
      sameBytes(view.read(path, 1000, 10), new Uint8Array(0), 'read past the end gives an empty array');
    },
  },
  {
    name: 'a write past the end fills the gap with zero bytes',
    async run(view, dir) {
      await view.prepare(dir);
      const path = view.resolve(dir, 'gap.bin') as VPath;
      view.create(path);
      view.write(path, 0, ascii('AB'));
      equal(view.write(path, 5, ascii('Z')), true, 'write at 5');
      sameBytes(view.read(path, 0, 10), bytes(0x41, 0x42, 0, 0, 0, 0x5a), 'content with the gap');
      equal(view.write(path, 1, ascii('x')), true, 'overwrite inside the file');
      sameBytes(view.read(path, 0, 10), bytes(0x41, 0x78, 0, 0, 0, 0x5a), 'content after overwrite');
    },
  },
  {
    name: 'create truncates an existing file',
    async run(view, dir) {
      await view.prepare(dir);
      const path = view.resolve(dir, 'trunc.txt') as VPath;
      view.create(path);
      view.write(path, 0, ascii('hello'));
      equal(view.create(path), true, 'second create');
      equal(view.stat(path)?.size, 0, 'size after the second create');
    },
  },
  {
    name: 'remove deletes a file',
    async run(view, dir) {
      await view.prepare(dir);
      const path = view.resolve(dir, 'rm.txt') as VPath;
      view.create(path);
      equal(view.remove(path), true, 'remove');
      equal(view.stat(path), null, 'stat after remove');
      equal(view.remove(path), false, 'second remove');
    },
  },
  {
    name: 'resolve follows the Windows name rules',
    async run(view, dir) {
      await view.prepare(dir);
      const stored = view.resolve(dir, 'Sub.Dat') as VPath;
      check(stored !== null, "resolve(dir, 'Sub.Dat')");
      view.create(stored);
      equal(view.resolve(dir, 'SUB.DAT'), stored, 'a different letter case finds the stored name');
      equal(view.resolve(dir, '.\\sub.dat'), stored, "'.\\' and a different case");
      equal(view.resolve(dir, 'x\\..\\Sub.Dat'), stored, "'..' inside the folder");
      equal(view.resolve(dir, 'x/../Sub.Dat'), stored, "'/' as separator");
      equal(view.resolve(dir, 'C:\\Sub.Dat'), null, 'a drive letter');
      equal(view.resolve(dir, `${'..\\'.repeat(64)}Sub.Dat`), null, "'..' beyond what the view may reach");
      equal(view.resolve(dir, ''), null, 'an empty name');
    },
  },
  {
    name: 'settled resolves and leaves the view settled',
    async run(view, dir) {
      await view.prepare(dir);
      const path = view.resolve(dir, 'settle.txt') as VPath;
      view.create(path);
      view.write(path, 0, ascii('data'));
      await view.settled();
      equal(view.unsettled, false, 'unsettled after settled()');
      sameBytes(view.read(path, 0, 10), ascii('data'), 'content after settled()');
    },
  },
];
