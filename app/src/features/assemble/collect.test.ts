// collect.ts: the INCLUDE / INCBIN scan, the files handed to the assembler and the snapshot retry
// (ARCHITECTURE.md 3.8.3; assembler §3.4.1). The engine itself is not needed here: FakeAsmEngine
// records what it was given.

import { describe, expect, it } from 'vitest';
import type { Vfs } from '../../contracts';
import { TEST_ASM_OPTIONS, bytesOf, textOf } from '../../engine/testing';
import { FakeAsmEngine, fakeMessage } from '../../engine/fake-asm';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import {
  FILE_ERROR_TEXT,
  assembleCollected,
  assemblyTree,
  collectFiles,
  operandName,
  pathOfKey,
  scanIncludeNames,
  win32Name,
} from './collect';

async function vfsWith(files: Record<string, string>): Promise<Vfs> {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' }));
  for (const [path, text] of Object.entries(files)) await vfs.writeFile(path, bytesOf(text));
  return vfs;
}

describe('win32Name: the name as Win32 and the engine file layer open it', () => {
  it('drops trailing dots and spaces of every component and keeps `.` and `..`', () => {
    expect(win32Name('lib.x68.')).toBe('lib.x68');
    expect(win32Name('lib.x68 . ')).toBe('lib.x68');
    expect(win32Name('..\\Lib. /four.x68')).toBe('..\\Lib\\four.x68');
    expect(win32Name('q\\..\\.\\lib.x68')).toBe('q\\..\\.\\lib.x68');
    expect(win32Name('a\\\\b')).toBe('a\\b');
  });
  it('keeps what Vfs.resolve refuses refused: rooted names, drive letters, nothing left', () => {
    expect(win32Name('\\lib.x68')).toBe('\\lib.x68');
    expect(win32Name('C:\\lib.x68')).toBe('C:\\lib.x68');
    expect(win32Name('. .')).toBe('');
  });
  it('collectFiles finds `lib.x68.` and a name with `..` after a folder that does not exist', async () => {
    const vfs = await vfsWith({ '/browser/p/lib.x68': ' NOP\r\n', '/browser/top.x68': ' NOP\r\n' });
    const main = bytesOf("    INCLUDE 'lib.x68.'\r\n    INCLUDE '..\\nothere\\..\\top.x68 '\r\n");
    const collected = await collectFiles(vfs, '/browser/p/main.x68', main);
    expect([...collected.files.keys()]).toEqual(['p/main.x68', 'p/lib.x68', 'top.x68']);
    expect(collected.includes).toEqual(['/browser/p/lib.x68', '/browser/top.x68']);
  });
});

describe('operandName (assembler §3.4.1)', () => {
  it('single quotes keep the case, double quotes and no quotes upper-case', () => {
    expect(operandName(" 'Macros\\io.x68'")).toBe('Macros\\io.x68');
    expect(operandName(' "Macros\\io.x68"')).toBe('MACROS\\IO.X68');
    expect(operandName('\tmacros/io.x68')).toBe('MACROS/IO.X68');
  });
  it('an unquoted name runs to the first space; a tab does not end it', () => {
    expect(operandName(' file.x68 comment')).toBe('FILE.X68');
    expect(operandName(' file.x68\tcomment')).toBe('FILE.X68\tCOMMENT');
    expect(operandName(' file.x68\t')).toBe('FILE.X68');
  });
  it('a quoted name runs to the matching quote; no operand is null', () => {
    expect(operandName(" 'a b.x68' ; comment")).toBe('a b.x68');
    expect(operandName(" 'unterminated")).toBe('unterminated');
    expect(operandName('   ')).toBeNull();
    expect(operandName('')).toBeNull();
  });
});

describe('scanIncludeNames (3.8.3 step 1)', () => {
  it('finds INCLUDE and INCBIN in the mnemonic field, any case, with or without a label', () => {
    const text = [
      '*  INCLUDE comment.x68',
      '; INCLUDE comment2.x68',
      ' include a.x68',
      'LABEL INCLUDE b.x68',
      'L2: IncBin data.bin',
      'INCLUDE c.x68',
      '  MOVE.B #1,D0  INCLUDE not.x68',
      ' INCLUDE.L sized.x68',
      ' INCLUDE',
    ].join('\r\n');
    expect(scanIncludeNames(text)).toEqual([
      { directive: 'INCLUDE', name: 'A.X68' },
      { directive: 'INCLUDE', name: 'B.X68' },
      { directive: 'INCBIN', name: 'DATA.BIN' },
      { directive: 'INCLUDE', name: 'C.X68' },
    ]);
  });
  it('stops at Ctrl-Z (text mode) and accepts every line end', () => {
    expect(scanIncludeNames(' INCLUDE a.x68\r INCLUDE b.x68\n INCLUDE c.x68\x1a INCLUDE d.x68')).toEqual([
      { directive: 'INCLUDE', name: 'A.X68' },
      { directive: 'INCLUDE', name: 'B.X68' },
      { directive: 'INCLUDE', name: 'C.X68' },
    ]);
  });
});

describe('collectFiles (3.8.3 steps 1 and 2)', () => {
  it('the tree is the mount; the main entry is the editor buffer, not the stored file', async () => {
    const vfs = await vfsWith({ '/browser/course/lab1/prog.X68': 'STORED' });
    const collected = await collectFiles(vfs, '/browser/course/lab1/prog.X68', bytesOf('BUFFER'));
    expect(assemblyTree('/browser/course/lab1/prog.X68')).toEqual({
      mount: 'browser',
      programDir: '/browser/course/lab1',
      mainName: 'course/lab1/prog.X68',
    });
    expect(collected.mainName).toBe('course/lab1/prog.X68');
    expect([...collected.files.keys()]).toEqual(['course/lab1/prog.X68']);
    expect(textOf(collected.files.get('course/lab1/prog.X68')!)).toBe('BUFFER');
  });

  it('quoted, unquoted, other letter case, backslash path, `..` into a sibling folder, nested', async () => {
    const vfs = await vfsWith({
      '/browser/course/lab1/prog.X68': '',
      '/browser/course/lab1/MACROS/io.X68': ' INCLUDE nested.x68\r\n',
      '/browser/course/lab1/Nested.X68': 'nested',
      '/browser/course/Shared/Data.X68': 'data',
      '/browser/course/Shared/blob.bin': 'BIN',
      '/browser/course/lab1/Upper.x68': 'upper',
      '/browser/course/lab1/unused.x68': 'never named',
    });
    const main = [
      " INCLUDE 'Macros\\IO.x68'",
      ' INCLUDE ../shared/data.x68',
      ' INCBIN "..\\SHARED/BLOB.BIN"',
      ' include upper.X68',
      ' INCLUDE missing.x68',
      ' INCLUDE C:\\abs\\x.x68',
      ' INCLUDE \\rooted.x68',
      ' INCLUDE ../../../outside.x68',
    ].join('\r\n');
    const collected = await collectFiles(vfs, '/browser/course/lab1/prog.X68', bytesOf(main));
    expect([...collected.files.keys()].sort()).toEqual(
      [
        'course/Shared/Data.X68',
        'course/Shared/blob.bin',
        'course/lab1/MACROS/io.X68',
        'course/lab1/Nested.X68',
        'course/lab1/Upper.x68',
        'course/lab1/prog.X68',
      ].sort(),
    );
    // Nested includes resolve against the main file's folder, as in the original.
    expect(collected.includes).toEqual([
      '/browser/course/lab1/MACROS/io.X68',
      '/browser/course/Shared/Data.X68',
      '/browser/course/lab1/Upper.x68',
      '/browser/course/lab1/Nested.X68',
    ]);
    expect(pathOfKey(collected, 'course/Shared/Data.X68')).toBe('/browser/course/Shared/Data.X68');
  });

  it('a file named twice and an include cycle are read once', async () => {
    const vfs = await vfsWith({
      '/browser/p/main.X68': '',
      '/browser/p/a.x68': ' INCLUDE b.x68\r\n',
      '/browser/p/b.x68': ' INCLUDE a.x68\r\n INCLUDE main.X68\r\n',
    });
    const collected = await collectFiles(vfs, '/browser/p/main.X68', bytesOf(' INCLUDE a.x68\r\n INCLUDE A.X68\r\n'));
    expect([...collected.files.keys()].sort()).toEqual(['p/a.x68', 'p/b.x68', 'p/main.X68']);
    expect(collected.includes).toEqual(['/browser/p/a.x68', '/browser/p/b.x68']);
  });
});

describe('assembleCollected (3.8.3 step 3: the snapshot retry)', () => {
  it('a name the scan cannot see: the program directory is added and the second result is the result', async () => {
    const vfs = await vfsWith({
      '/browser/m/prog.X68': '',
      '/browser/m/part1.x68': 'p1',
      '/browser/m/sub/deep.x68': 'deep',
      '/browser/other/x.x68': 'not in the program directory',
    });
    const asm = new FakeAsmEngine().enqueue(
      { errorCount: 1, messages: [fakeMessage(3, FILE_ERROR_TEXT)] },
      { errorCount: 0, messages: [] },
    );
    const { result, collected } = await assembleCollected(
      asm,
      vfs,
      '/browser/m/prog.X68',
      bytesOf(' INCLUDE \\1\r\n'),
      TEST_ASM_OPTIONS,
      new Date(2026, 0, 1),
    );
    expect(asm.calls).toHaveLength(2);
    expect([...asm.calls[0]!.files.keys()]).toEqual(['m/prog.X68']);
    expect([...asm.calls[1]!.files.keys()].sort()).toEqual(['m/part1.x68', 'm/prog.X68', 'm/sub/deep.x68']);
    // The buffer is never replaced by the stored file.
    expect(textOf(asm.calls[1]!.files.get('m/prog.X68')!)).toBe(' INCLUDE \\1\r\n');
    expect(result.errorCount).toBe(0);
    expect(collected.snapshot).toBe(true);
  });

  it('no retry without that message, and none when the snapshot adds nothing', async () => {
    const vfs = await vfsWith({ '/browser/m/prog.X68': '' });
    const clean = new FakeAsmEngine();
    await assembleCollected(clean, vfs, '/browser/m/prog.X68', bytesOf(''), TEST_ASM_OPTIONS, new Date());
    expect(clean.calls).toHaveLength(1);
    const missing = new FakeAsmEngine().enqueue({ messages: [fakeMessage(1, FILE_ERROR_TEXT)] });
    const { result } = await assembleCollected(
      missing,
      vfs,
      '/browser/m/prog.X68',
      bytesOf(''),
      TEST_ASM_OPTIONS,
      new Date(),
    );
    expect(missing.calls).toHaveLength(1);
    expect(result.errorCount).toBe(1);
  });
});
