# Request from W1 (repair of D1): a case-only rename must compare names without regard to letter case (owner FS1)

Status: open.

Since the repair of D1 (`docs/porting/errata/W1.md` entry 15.1), `vfs.resolve` keeps the spelling as
given for a segment whose folder may not be listed. On `/disk` in the desktop app that is every
segment down to and including a granted root when the walk starts above it. Example, with
`Users/me/demo` granted on a disk that ignores letter case:
`vfs.resolve('/disk/Users/me', 'DEMO')` returns `'/disk/Users/me/DEMO'`, not the stored
`'/disk/Users/me/demo'` (the stored spelling cannot be learnt without listing `Users/me`, which 7.6
forbids).

`renameEntry` in `app/src/features/files/store.ts` (lines 163 to 165) compares that result with
`from` exactly:

```ts
const existing = await vfs.resolve(parent, newName);
if (existing !== null && existing !== from) throw new Error(`"${newName}" already exists.`);
const caseOnly = existing === from;
```

So renaming a granted root folder by letter case only (`demo` to `DEMO`) is refused with
`"DEMO" already exists.` Nothing is lost (before the repair the same rename removed the folder),
but the rename is wrong to refuse. The same holds for any `from` that lies below a folder that may
not be listed.

Asked: compare with `foldCase` from `app/src/core/paths/winpath.ts`, as the dialogs already do:

```ts
const sameEntry = existing !== null && foldCase(existing) === foldCase(from);
if (existing !== null && !sameEntry) throw new Error(`"${newName}" already exists.`);
const caseOnly = sameEntry;
```

A test: the `GrantedDisk` backend of `app/src/fs/vfs.test.ts` (or the real handlers of
`desktop/src/fs-ipc.ts` as in `app/src/fs/disk-backend.test.ts`) with `Users/me/demo` granted on a
case-insensitive store; `renameEntry(vfs, '/disk/Users/me/demo', 'DEMO')` succeeds and the folder
keeps its files.
