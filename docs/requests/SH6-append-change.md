# Request from SH6: let a local append say what it appended (contracts/fs.ts, fs/vfs.ts)

Status (SH6, round before gate I3): closed. SH6's side is in place: `CachedSyncFiles` (`fs/sync/cached.ts`, `applyAppend`) adds `appended.data` to its copy without a read when the copy is unchanged by the program and exactly `at` bytes long and storage is now exactly `at + data.length`; otherwise it reads the whole file as before. Tests in `fs/sync/cached.test.ts`; errata SH6.md entry 13.

Status: done as asked in the round before gate I3 (W1, contracts and `fs/vfs.ts`). `VfsChange.appended?: { at: number; data: Bytes }` in `contracts/fs.ts`; `Vfs.appendFile` sets it on its 'local' change, with `at` from a `stat` taken inside the path's queue just before the append, and `data` a copy made at the call (the file stores the same copy). It is absent for every other change, and for an append whose size before could not be learnt (the `stat` failed). Tests: four in `fs/vfs.test.ts` ("an append says where it appended and what; ..."), `contracts.test.ts`. SH6 may now apply the bytes to its copy in `CachedSyncFiles` (U4's 30 MB log). Errata W1.md entry 16.2.

(Original status: open (gate I2 round 1). Optional; nothing breaks without it. For the contracts engineer
(`VfsChange` in `app/src/contracts/fs.ts`) and the owner of `app/src/fs/vfs.ts`.)

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
