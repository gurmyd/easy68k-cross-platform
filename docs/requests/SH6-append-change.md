# Request from SH6: let a local append say what it appended (contracts/fs.ts, fs/vfs.ts)

Status: open (gate I2 round 1). Optional; nothing breaks without it. For the contracts engineer
(`VfsChange` in `app/src/contracts/fs.ts`) and the owner of `app/src/fs/vfs.ts`.

## Why

U4 measured (needs.json, gate I2): with an execution log of 30 MB in the program's folder, every log
flush (once a second) makes SH6's `CachedSyncFiles` read the whole file again, because a
`VfsChange` says only `kind: 'write'`. In Chromium a flush then costs about 122 ms instead of 5 ms.
The view cannot read just the tail: the `Vfs` has no ranged read, and a grown file may as well have
been rewritten. Deferring the read is no answer (docs/porting/errata/SH6.md entry 5a).

## What

An optional member on `VfsChange`, set by `Vfs.appendFile` for changes made through the same Vfs
(origin `'local'`), where the Vfs has the bytes in hand:

```ts
export interface VfsChange {
  path: VPath;
  kind: 'write' | 'remove';
  origin: 'local' | 'external';
  /** Set when the change was an append through this Vfs: the file was `at` bytes long and `data`
   *  was added at its end. Absent for every other change. */
  appended?: { at: number; data: Bytes };
}
```

SH6 then applies the bytes to its copy when the copy is exactly `at` bytes long and the program has
not changed it, with no read at all, and reads the whole file otherwise. If the size before the
append is costly for the Vfs to know, `data` alone is enough: SH6 then compares a `stat` of the file
with its copy's size plus `data.length`, which still saves the read of the whole file.
